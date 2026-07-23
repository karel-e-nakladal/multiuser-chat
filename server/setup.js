/**
 * Setup Script for Multi-User Chat Server Plugin
 * 
 * Patches SillyTavern's server.js to wire in the Socket.IO server.
 * Run this from the HOST (not inside Docker) so changes survive restarts.
 *
 * Usage:
 *   node server/setup.js
 *   node server/setup.js --undo   (remove the plugin from server.js)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UNDO = process.argv.includes('--undo');

// ---------------------------------------------------------------------------
// Detect if we're running inside a Docker container
// ---------------------------------------------------------------------------
function isInsideDocker() {
    try {
        return readFileSync('/proc/1/cgroup', 'utf-8').includes('docker');
    } catch {
        // /home/node/app is the SillyTavern Docker image's standard WORKDIR
        return existsSync('/home/node/app/server.js') && __dirname.startsWith('/home/node/app');
    }
}

// ---------------------------------------------------------------------------
// Walk up from our directory to find server.js (up to 12 levels)
// ---------------------------------------------------------------------------
function findServerJs(startDir) {
    let dir = resolve(startDir);
    for (let i = 0; i < 12; i++) {
        const candidate = join(dir, 'server.js');
        try {
            readFileSync(candidate);
            return { serverJs: candidate, rootDir: dir };
        } catch (_) { /* keep walking */ }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Strip leading rootDir from pluginPath, produce a POSIX relative import
// ---------------------------------------------------------------------------
function computeImportPath(rootDir, pluginPath) {
    const rel = pluginPath
        .replace(rootDir, '')
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/');
    return './' + rel;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const inDocker = isInsideDocker();

if (inDocker) {
    console.log('');
    console.log('⚠  Detected Docker environment.');
    console.log('   Changes made inside the container will be LOST on "docker compose down -v".');
    console.log('   Run setup.js on the HOST instead:');
    console.log('');
    console.log('   node public/scripts/extensions/third-party/multiuser-chat/server/setup.js');
    console.log('');
    console.log('   Continuing anyway (will work until the next docker compose down -v)...');
    console.log('');
}

const result = findServerJs(__dirname);

if (!result) {
    console.log('');
    console.log('⚠  Could not find server.js automatically.');
    console.log('   Add these three lines to your SillyTavern server.js:');
    console.log('');
    console.log("   import { initMultiUserChatServer, addMultiUserRoutes } from './public/scripts/extensions/third-party/multiuser-chat/server/plugin.js';");
    console.log('   const io = initMultiUserChatServer(httpServer);   // after http.createServer');
    console.log('   addMultiUserRoutes(app);                          // before server.listen');
    console.log('');
    process.exit(1);
}

const { serverJs, rootDir } = result;
const pluginFile = join(__dirname, 'plugin.js');
const importPath = computeImportPath(rootDir, pluginFile);

const IMPORT_REGEX = /^import\s*\{[^}]*\binitMultiUserChatServer\b[^}]*\}\s*from\s*['"][^'"]+['"];?\s*\n?/m;
const INIT_REGEX  = /^const\s+io\s*=\s*initMultiUserChatServer\s*\(\s*httpServer\s*\);?\s*\n?/m;
const ROUTES_REGEX = /^addMultiUserRoutes\s*\(\s*app\s*\);?\s*\n?/m;

const newImport = `import { initMultiUserChatServer, addMultiUserRoutes } from '${importPath}';\n`;
const newInit   = `const io = initMultiUserChatServer(httpServer);\n`;
const newRoutes = `addMultiUserRoutes(app);\n`;

try {
    let content = readFileSync(serverJs, 'utf-8');

    if (UNDO) {
        const hadImport = IMPORT_REGEX.test(content);
        const hadInit   = INIT_REGEX.test(content);
        const hadRoutes = ROUTES_REGEX.test(content);

        content = content.replace(IMPORT_REGEX, '');
        content = content.replace(INIT_REGEX, '');
        content = content.replace(ROUTES_REGEX, '');

        if (hadImport || hadInit || hadRoutes) {
            writeFileSync(serverJs, content, 'utf-8');
            console.log('✓ Removed MultiUserChat plugin from server.js');
        } else {
            console.log('✓ Nothing to undo.');
        }
        process.exit(0);
    }

    let modified = false;

    // Strip any stale lines from previous (possibly broken) runs
    if (IMPORT_REGEX.test(content)) { content = content.replace(IMPORT_REGEX, ''); modified = true; }
    if (INIT_REGEX.test(content))  { content = content.replace(INIT_REGEX, '');  modified = true; }
    if (ROUTES_REGEX.test(content)) { content = content.replace(ROUTES_REGEX, ''); modified = true; }

    // Insert fresh import after the last existing import
    if (!content.includes('initMultiUserChatServer')) {
        const imports = [...content.matchAll(/^import\s+.*$/gm)];
        if (imports.length > 0) {
            const last = imports[imports.length - 1];
            const pos = last.index + last[0].length;
            content = content.slice(0, pos) + '\n' + newImport + content.slice(pos);
        } else {
            content = newImport + '\n' + content;
        }
        modified = true;
    }

    // Insert init after http(s).createServer call
    if (!INIT_REGEX.test(content) && !content.includes('initMultiUserChatServer(httpServer)')) {
        const m = content.match(/const\s+\w+\s*=\s*https?\.createServer\(app\)/);
        if (m) {
            const pos = m.index + m[0].length;
            content = content.slice(0, pos) + '\n' + newInit + content.slice(pos);
            modified = true;
        }
    }

    // Insert routes before .listen()
    if (!ROUTES_REGEX.test(content) && !content.includes('addMultiUserRoutes(app)')) {
        const m = content.match(/\b(?:server|app|httpServer)\.listen\(/);
        if (m) {
            content = content.slice(0, m.index) + newRoutes + '\n' + content.slice(m.index);
            modified = true;
        }
    }

    if (modified) {
        writeFileSync(serverJs, content, 'utf-8');
        console.log(`✓ Patched ${serverJs}`);
        console.log(`  Import path: ${importPath}`);
        if (!inDocker) {
            console.log('  Restart SillyTavern for changes to take effect.');
        } else {
            console.log('  Run "docker compose down && docker compose up -d" (no -v) to apply.');
        }
    } else {
        console.log('✓ Already up-to-date. Nothing to do.');
    }

} catch (err) {
    console.error('Error:', err.message);
    console.log('');
    console.log('Add these lines manually to', serverJs, ':');
    console.log(`  ${newImport.trim()}`);
    console.log(`  ${newInit.trim()}`);
    console.log(`  ${newRoutes.trim()}`);
}

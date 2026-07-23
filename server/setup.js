/**
 * Setup Script for Multi-User Chat Server Plugin
 * Auto-patches SillyTavern's server.js — run from the extension's server/ directory.
 *
 * Usage:
 *   cd public/scripts/extensions/third-party/multiuser-chat/server
 *   node setup.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Walk up from our directory to find server.js (up to 12 levels for Docker)
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
// Compute a POSIX relative path from rootDir to the plugin file
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
const result = findServerJs(__dirname);

if (!result) {
    console.log('');
    console.log('⚠  Could not find server.js automatically.');
    console.log('   Add these lines to your SillyTavern server.js manually:');
    console.log('');
    console.log('   import { initMultiUserChatServer, addMultiUserRoutes } from \'./public/scripts/extensions/third-party/multiuser-chat/server/plugin.js\';');
    console.log('   const io = initMultiUserChatServer(httpServer);   // after http.createServer');
    console.log('   addMultiUserRoutes(app);                          // before server.listen');
    console.log('');
    process.exit(1);
}

const { serverJs, rootDir } = result;
const pluginFile = join(__dirname, 'plugin.js');
const importPath = computeImportPath(rootDir, pluginFile);

const IMPORT_PATTERN = /^import\s*\{[^}]*\binitMultiUserChatServer\b[^}]*\}\s*from\s*['"][^'"]+['"];?\s*\n?/m;
const INIT_PATTERN  = /^const\s+io\s*=\s*initMultiUserChatServer\s*\(\s*httpServer\s*\);?\s*\n?/m;
const ROUTES_PATTERN = /^addMultiUserRoutes\s*\(\s*app\s*\);?\s*\n?/m;

const newImport = `import { initMultiUserChatServer, addMultiUserRoutes } from '${importPath}';\n`;
const newInit   = `const io = initMultiUserChatServer(httpServer);\n`;
const newRoutes = `addMultiUserRoutes(app);\n`;

try {
    let content = readFileSync(serverJs, 'utf-8');
    let modified = false;

    // 1. Remove any stale import / init / routes lines from previous runs
    if (IMPORT_PATTERN.test(content)) {
        content = content.replace(IMPORT_PATTERN, '');
        modified = true;
    }
    if (INIT_PATTERN.test(content)) {
        content = content.replace(INIT_PATTERN, '');
        modified = true;
    }
    if (ROUTES_PATTERN.test(content)) {
        content = content.replace(ROUTES_PATTERN, '');
        modified = true;
    }

    // 2. Insert the import after the LAST existing import line
    if (!content.includes('initMultiUserChatServer')) {
        const importMatches = [...content.matchAll(/^import\s+.*$/gm)];
        if (importMatches.length > 0) {
            const last = importMatches[importMatches.length - 1];
            const insertAt = last.index + last[0].length;
            content = content.slice(0, insertAt) + '\n' + newImport + content.slice(insertAt);
        } else {
            // No imports at all — prepend
            content = newImport + '\n' + content;
        }
        modified = true;
    }

    // 3. Insert socket init after httpServer creation (handles http AND https)
    if (!INIT_PATTERN.test(content) && !content.includes('initMultiUserChatServer(httpServer)')) {
        const m = content.match(/const\s+\w+\s*=\s*https?\.createServer\(app\)/);
        if (m) {
            const pos = m.index + m[0].length;
            content = content.slice(0, pos) + '\n' + newInit + content.slice(pos);
            modified = true;
        }
    }

    // 4. Insert routes before server.listen (or app.listen)
    if (!ROUTES_PATTERN.test(content) && !content.includes('addMultiUserRoutes(app)')) {
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
        console.log('  Restart SillyTavern for changes to take effect.');
    } else {
        console.log('✓ Already up-to-date. Nothing to do.');
    }

} catch (err) {
    console.error('Error patching server.js:', err.message);
    console.log('');
    console.log('Add these lines manually:');
    console.log(`  ${newImport.trim()}`);
    console.log(`  ${newInit.trim()}`);
    console.log(`  ${newRoutes.trim()}`);
}

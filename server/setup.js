/**
 * Setup Script for Multi-User Chat Server Plugin
 *
 * Patches SillyTavern's src/server-startup.js to wire in the Socket.IO server.
 * Run this from the HOST (not inside Docker) so changes survive restarts.
 *
 * Usage:
 *   node server/setup.js
 *   node server/setup.js --undo   (remove the plugin)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UNDO = process.argv.includes('--undo');

// ---------------------------------------------------------------------------
// Detect Docker
// ---------------------------------------------------------------------------
function isInsideDocker() {
    try {
        return readFileSync('/proc/1/cgroup', 'utf-8').includes('docker');
    } catch {
        return existsSync('/home/node/app/server.js') && __dirname.startsWith('/home/node/app');
    }
}

// ---------------------------------------------------------------------------
// Walk up from the script directory to find the SillyTavern root
// (where server.js lives alongside src/server-startup.js)
// ---------------------------------------------------------------------------
function findStRoot(startDir) {
    let dir = resolve(startDir);
    for (let i = 0; i < 12; i++) {
        const candidate = join(dir, 'server.js');
        const startup = join(dir, 'src', 'server-startup.js');
        try {
            readFileSync(candidate);
            readFileSync(startup);
            return { rootDir: dir, startupJs: startup };
        } catch (_) { /* keep walking */ }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Compute a POSIX relative import path from startDir to plugin.js
// ---------------------------------------------------------------------------
function computeImportPath(fromDir, pluginPath) {
    const rel = relative(fromDir, pluginPath).replace(/\\/g, '/');
    return rel.startsWith('.') ? rel : './' + rel;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------
const SIGNATURE = 'initMultiUserChatServer'; // unique string we inject

const IMPORT_REGEX = /^import\s*\{[^}]*\binitMultiUserChatServer\b[^}]*\}\s*from\s*['"][^'"]+['"];?\s*\n?/m;
const ROUTES_REGEX = /^addMultiUserRoutes\s*\(\s*this\.app\s*\);?\s*\n?/m;

// Matches the line inside #createHttpServer: "const server = http.createServer(this.app);"
const HTTP_CREATE  = 'const server = http.createServer(this.app);';
// Matches the line inside #createHttpsServer: "const server = https.createServer(sslOptions, this.app);"
const HTTPS_CREATE = 'const server = https.createServer(sslOptions, this.app);';

// What we insert after http.createServer / https.createServer
const INIT_LINE = '\n        if (!this._io) { this._io = initMultiUserChatServer(server); }';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const inDocker = isInsideDocker();

if (inDocker) {
    console.log('');
    console.log('⚠  Detected Docker environment.');
    console.log('   Changes made inside the container will be LOST on "docker compose down -v".');
    console.log('   Run setup.js on the HOST instead.');
    console.log('');
    console.log('   Continuing anyway (will work until next docker compose down -v)...');
    console.log('');
}

const found = findStRoot(__dirname);

if (!found) {
    console.log('');
    console.log('⚠  Could not find SillyTavern root (server.js + src/server-startup.js).');
    console.log('   Add these lines manually:');
    console.log('');
    console.log('   In src/server-startup.js:');
    console.log("     import { initMultiUserChatServer, addMultiUserRoutes } from '../extensions/multiuser-chat/server/plugin.js';");
    console.log('     In start() before #startHTTPorHTTPS:   addMultiUserRoutes(this.app);');
    console.log('     After "const server = http.createServer(this.app);":');
    console.log('       if (!this._io) { this._io = initMultiUserChatServer(server); }');
    console.log('     After "const server = https.createServer(sslOptions, this.app);":');
    console.log('       if (!this._io) { this._io = initMultiUserChatServer(server); }');
    console.log('');
    process.exit(1);
}

const { rootDir, startupJs } = found;
const pluginFile = join(__dirname, 'plugin.js');

// Import path must be relative to startupJs (src/), not the root
const importPath = computeImportPath(dirname(startupJs), pluginFile);

const newImport = `import { initMultiUserChatServer, addMultiUserRoutes } from '${importPath}';\n`;

try {
    let content = readFileSync(startupJs, 'utf-8');
    let modified = false;

    if (UNDO) {
        // Remove import
        if (IMPORT_REGEX.test(content)) { content = content.replace(IMPORT_REGEX, ''); modified = true; }
        // Remove routes line
        if (ROUTES_REGEX.test(content)) { content = content.replace(ROUTES_REGEX, ''); modified = true; }
        // Remove init lines (the guard + init line after createServer)
        if (content.includes('if (!this._io) { this._io = initMultiUserChatServer(server); }')) {
            content = content.replaceAll('if (!this._io) { this._io = initMultiUserChatServer(server); }', '');
            modified = true;
        }
        if (modified) {
            writeFileSync(startupJs, content, 'utf-8');
            console.log('✓ Removed MultiUserChat plugin from', startupJs);
        } else {
            console.log('✓ Nothing to undo.');
        }
        process.exit(0);
    }

    // --- Strip any stale lines from previous runs ---
    if (IMPORT_REGEX.test(content)) { content = content.replace(IMPORT_REGEX, ''); modified = true; }
    if (ROUTES_REGEX.test(content)) { content = content.replace(ROUTES_REGEX, ''); modified = true; }
    if (content.includes('if (!this._io) { this._io = initMultiUserChatServer(server); }')) {
        content = content.replaceAll('if (!this._io) { this._io = initMultiUserChatServer(server); }', '');
        modified = true;
    }

    // --- 1. Add import after the last existing import ---
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

    // --- 2. Add init after http.createServer(this.app) ---
    if (content.includes(HTTP_CREATE) && !content.includes(HTTP_CREATE + INIT_LINE)) {
        content = content.replace(HTTP_CREATE, HTTP_CREATE + INIT_LINE);
        modified = true;
    }

    // --- 3. Add init after https.createServer(sslOptions, this.app) ---
    if (content.includes(HTTPS_CREATE) && !content.includes(HTTPS_CREATE + INIT_LINE)) {
        content = content.replace(HTTPS_CREATE, HTTPS_CREATE + INIT_LINE);
        modified = true;
    }

    // --- 4. Add routes before #startHTTPorHTTPS in start() ---
    if (!ROUTES_REGEX.test(content) && !content.includes('addMultiUserRoutes(this.app)')) {
        // Look for "const [v6Failed, v4Failed" which is right before #startHTTPorHTTPS call
        const m = content.match(/const\s+\[v6Failed,\s*v4Failed/);
        if (m) {
            content = content.slice(0, m.index) + 'addMultiUserRoutes(this.app);\n        ' + content.slice(m.index);
            modified = true;
        }
    }

    if (modified) {
        writeFileSync(startupJs, content, 'utf-8');
        console.log(`✓ Patched ${startupJs}`);
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
    console.log('Add these lines manually to', startupJs, ':');
    console.log(`  ${newImport.trim()}`);
    console.log('  In start(), before const [v6Failed:   addMultiUserRoutes(this.app);');
    console.log('  After http.createServer(this.app):     if (!this._io) { this._io = initMultiUserChatServer(server); }');
    console.log('  After https.createServer(...):         if (!this._io) { this._io = initMultiUserChatServer(server); }');
}

/**
 * Setup Script for Multi-User Chat Server Plugin
 * Auto-patches SillyTavern's server.js. Run from anywhere.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up to find SillyTavern root (where server.js lives)
function findServerJs(startDir) {
    let dir = resolve(startDir);
    for (let i = 0; i < 10; i++) {
        const candidate = join(dir, 'server.js');
        try { readFileSync(candidate); return { serverJs: candidate, rootDir: dir }; }
        catch (_) {}
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function computeImportPath(rootDir, pluginPath) {
    return './' + pluginPath.replace(rootDir, '').replace(/^\//, '').replace(/\\/g, '/');
}

const result = findServerJs(__dirname);

if (!result) {
    console.error('Could not find server.js. Add these lines manually:');
    console.error(`
import { initMultiUserChatServer, addMultiUserRoutes } from './extensions/multiuser-chat/server/plugin.js';

// After const server = http.createServer(app):
const io = initMultiUserChatServer(httpServer);

// Before server.listen():
addMultiUserRoutes(app);
`);
    process.exit(1);
}

const { serverJs, rootDir } = result;
const pluginFile = join(__dirname, 'plugin.js');
const importPath = computeImportPath(rootDir, pluginFile);

const IMPORT_LINE = `import { initMultiUserChatServer, addMultiUserRoutes } from '${importPath}';`;
const INIT_LINE = `const io = initMultiUserChatServer(httpServer);`;
const ROUTES_LINE = `addMultiUserRoutes(app);`;

try {
    let content = readFileSync(serverJs, 'utf-8');

    if (content.includes('initMultiUserChatServer')) {
        console.log('✓ Already registered. Nothing to do.');
        process.exit(0);
    }

    let modified = false;

    // Add import after last import line
    if (!content.includes(IMPORT_LINE)) {
        const lastImport = content.lastIndexOf('import ');
        const lineEnd = content.indexOf('\n', lastImport);
        if (lastImport >= 0 && lineEnd >= 0) {
            content = content.slice(0, lineEnd + 1) + IMPORT_LINE + '\n' + content.slice(lineEnd + 1);
            modified = true;
        }
    }

    // Add init after httpServer creation
    if (!content.includes('initMultiUserChatServer(httpServer)')) {
        const m = content.match(/const\s+server\s*=\s*http\.createServer\(app\)/);
        if (m) {
            const pos = m.index + m[0].length;
            content = content.slice(0, pos) + '\n' + INIT_LINE + content.slice(pos);
            modified = true;
        }
    }

    // Add routes before server.listen
    if (!content.includes('addMultiUserRoutes(app)')) {
        const m = content.match(/server\.listen\(/);
        if (m) {
            content = content.slice(0, m.index) + ROUTES_LINE + '\n' + content.slice(m.index);
            modified = true;
        }
    }

    if (modified) {
        writeFileSync(serverJs, content, 'utf-8');
        console.log(`✓ Patched ${serverJs} successfully.`);
        console.log('  Restart SillyTavern for changes to take effect.');
    } else {
        console.log('⚠ Could not find insertion points. Add manually:');
        console.log(`\n${IMPORT_LINE}\n${INIT_LINE}\n${ROUTES_LINE}`);
    }

} catch (err) {
    console.error('Error:', err.message);
}

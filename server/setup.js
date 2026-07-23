/**
 * Setup Script for Multi-User Chat Server Plugin
 * 
 * This script patches SillyTavern's server.js to register the multi-user chat
 * Socket.IO server. Run from the SillyTavern root directory:
 * 
 *   node public/scripts/extensions/multiuser-chat/server/setup.js
 * 
 * Or manually add the imports to your server.js file.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_JS_PATH = join(__dirname, '..', '..', '..', '..', '..', 'server.js');

const IMPORT_LINE = `import { initMultiUserChatServer, addMultiUserRoutes } from './public/scripts/extensions/multiuser-chat/server/plugin.js';`;
const INIT_LINE = `    const io = initMultiUserChatServer(httpServer);`;
const ROUTES_LINE = `    addMultiUserRoutes(app);`;

try {
    let content = readFileSync(SERVER_JS_PATH, 'utf-8');
    let modified = false;

    // Check if already patched
    if (content.includes('initMultiUserChatServer')) {
        console.log('✓ Multi-User Chat server plugin is already registered.');
        process.exit(0);
    }

    // Add import near other extension imports
    if (!content.includes(IMPORT_LINE)) {
        // Find the last import from './public/scripts/extensions'
        const importRegex = /import.*from\s+['"]\.\/public\/scripts\/extensions\/[^'"]+['"];?/g;
        const imports = [...content.matchAll(importRegex)];
        
        if (imports.length > 0) {
            const lastImport = imports[imports.length - 1];
            const insertPos = lastImport.index + lastImport[0].length;
            content = content.slice(0, insertPos) + '\n' + IMPORT_LINE + content.slice(insertPos);
            modified = true;
        }
    }

    // Add init after httpServer creation
    // Find: const server = http.createServer(app);
    // Or: httpServer.listen(...
    if (!content.includes('initMultiUserChatServer(httpServer)')) {
        // Find where httpServer is created
        const serverMatch = content.match(/(const\s+server\s*=\s*http\.createServer\(app\))/);
        if (serverMatch) {
            const insertAfter = serverMatch.index + serverMatch[0].length;
            content = content.slice(0, insertAfter) + '\n' + INIT_LINE + content.slice(insertAfter);
            modified = true;
        }
    }

    // Add routes
    if (!content.includes('addMultiUserRoutes(app)')) {
        const listenMatch = content.match(/(server\.listen\(|httpServer\.listen\()/);
        if (listenMatch) {
            const insertBefore = listenMatch.index;
            content = content.slice(0, insertBefore) + ROUTES_LINE + '\n' + content.slice(insertBefore);
            modified = true;
        }
    }

    if (modified) {
        writeFileSync(SERVER_JS_PATH, content, 'utf-8');
        console.log('✓ Successfully patched server.js for Multi-User Chat Rooms.');
        console.log('  Please restart SillyTavern for changes to take effect.');
    } else {
        console.log('⚠ Could not automatically patch server.js.');
        console.log('  Please add the following lines manually:');
        console.log(`\n  1. Add import near top:`);
        console.log(`     ${IMPORT_LINE}`);
        console.log(`\n  2. After httpServer creation:`);
        console.log(`     ${INIT_LINE}`);
        console.log(`\n  3. Before server.listen():`);
        console.log(`     ${ROUTES_LINE}`);
    }

} catch (err) {
    console.error('Failed to setup Multi-User Chat server plugin:', err.message);
    console.error('Please add the following to your server.js manually:');
    console.error(`\n  ${IMPORT_LINE}`);
    console.error(`  ${INIT_LINE}`);
    console.error(`  ${ROUTES_LINE}`);
}

/**
 * Server-side Plugin Entry Point
 * 
 * This file is loaded by SillyTavern's Express server on startup.
 * It attaches the Socket.IO server to the existing HTTP server.
 * 
 * To register this, add the following line to SillyTavern's server.js
 * or provide it as a server-side extension hook:
 * 
 *   import { initMultiUserChatServer } from './public/scripts/extensions/multiuser-chat/server/plugin.js';
 *   initMultiUserChatServer(httpServer);
 */

import { initSocketServer, getRoomManager } from './index.js';

/**
 * Initialize the Multi-User Chat server plugin
 * @param {http.Server} httpServer - The existing HTTP server instance
 * @returns {SocketIOServer} The Socket.IO server instance
 */
export function initMultiUserChatServer(httpServer) {
    console.log('[MultiUserChat Plugin] Initializing server-side plugin...');
    const io = initSocketServer(httpServer);
    console.log('[MultiUserChat Plugin] Server-side plugin initialized successfully.');
    return io;
}

/**
 * Add REST API routes for multi-user chat functionality
 * @param {express.Application} app - Express app instance
 */
export function addMultiUserRoutes(app) {
    const manager = getRoomManager();

    app.get('/api/multiuser/health', (_req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
        });
    });
    
    // Get public room count
    app.get('/api/multiuser/stats', (_req, res) => {
        const roomsList = manager.listRooms();
        
        res.json({
            activeRooms: roomsList.length,
            totalUsers: roomsList.reduce((sum, r) => sum + (r.users?.length || 0), 0),
        });
    });
}

export default {
    initMultiUserChatServer,
    addMultiUserRoutes,
};

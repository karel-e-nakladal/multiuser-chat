/**
 * Multi-User Chat Server - Socket.IO based real-time collaboration
 *
 * Provides:
 * - Room creation & management
 * - Real-time message broadcasting
 * - User presence tracking
 * - Invite code generation & validation
 * - Chat history sync
 */

import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

// In-memory stores (use a database for production)
const rooms = new Map();       // roomId -> room data
const invites = new Map();     // inviteCode -> { roomId, expires, maxUses, uses }
const userSockets = new Map(); // socketId -> { userId, username, roomId }

/**
 * @typedef {Object} RoomUser
 * @property {string} id - Unique user ID
 * @property {string} username - Display name
 * @property {string} role - 'host' | 'participant'
 * @property {string} joinedAt - ISO timestamp
 * @property {boolean} isOnline
 */

/**
 * @typedef {Object} ChatRoom
 * @property {string} id - Unique room ID
 * @property {string} name - Room display name
 * @property {string} hostId - User ID of the host
 * @property {RoomUser[]} users - Connected users
 * @property {Array} messages - Chat message history
 * @property {string} createdAt - ISO timestamp
 * @property {boolean} isGroupChat - Whether this uses group chat (multiple AI chars)
 * @property {string[]} characterNames - Names of AI characters in the room
 * @property {Object} settings - Room settings
 */

/**
 * Initialize the Socket.IO server on the existing HTTP server
 * @param {http.Server} httpServer - Existing HTTP server instance
 */
export function initSocketServer(httpServer) {
    const io = new SocketIOServer(httpServer, {
        path: '/api/multiuser/socket.io',
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });

    // =========================================================================
    // Authentication Middleware
    // =========================================================================
    io.use((socket, next) => {
        const username = socket.handshake.auth?.username || `User-${socket.id.substring(0, 6)}`;
        const userId = socket.handshake.auth?.userId || uuidv4();
        const roomId = socket.handshake.auth?.roomId;
        const inviteCode = socket.handshake.auth?.inviteCode;

        socket.data.userId = userId;
        socket.data.username = username;
        socket.data.roomId = roomId;
        socket.data.inviteCode = inviteCode;

        next();
    });

    // =========================================================================
    // Connection Handler
    // =========================================================================
    io.on('connection', (socket) => {
        const { userId, username, roomId, inviteCode } = socket.data;

        console.log(`[MultiUserChat] User connected: ${username} (${userId})`);
        userSockets.set(socket.id, { userId, username, roomId: null });

        // --- Room Operations ---

        /**
         * Create a new chat room
         */
        socket.on('room:create', (data, callback) => {
            try {
                const newRoomId = uuidv4();
                const room = {
                    id: newRoomId,
                    name: data.name || `${username}'s Room`,
                    hostId: userId,
                    users: [{
                        id: userId,
                        username: username,
                        role: 'host',
                        joinedAt: new Date().toISOString(),
                        isOnline: true,
                    }],
                    messages: data.initialMessages || [],
                    createdAt: new Date().toISOString(),
                    isGroupChat: data.isGroupChat || false,
                    characterNames: data.characterNames || [],
                    settings: data.settings || {},
                };

                rooms.set(newRoomId, room);
                socket.join(newRoomId);
                socket.data.roomId = newRoomId;
                userSockets.get(socket.id).roomId = newRoomId;

                console.log(`[MultiUserChat] Room created: ${room.name} (${newRoomId})`);

                // Notify others about new room (optional global lobby)
                callback({ success: true, room });
            } catch (err) {
                console.error('[MultiUserChat] Room creation error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Join an existing room via invite code
         */
        socket.on('room:join', (data, callback) => {
            try {
                const { code } = data;
                const invite = invites.get(code);

                if (!invite) {
                    return callback({ success: false, error: 'Invalid or expired invite code.' });
                }

                if (invite.expires && Date.now() > invite.expires) {
                    invites.delete(code);
                    return callback({ success: false, error: 'This invite code has expired.' });
                }

                if (invite.maxUses && invite.uses >= invite.maxUses) {
                    invites.delete(code);
                    return callback({ success: false, error: 'This invite code has reached its maximum uses.' });
                }

                const room = rooms.get(invite.roomId);
                if (!room) {
                    return callback({ success: false, error: 'Room no longer exists.' });
                }

                // Check if user already in room
                const existingUser = room.users.find(u => u.id === userId);
                if (existingUser) {
                    existingUser.isOnline = true;
                } else {
                    room.users.push({
                        id: userId,
                        username: username,
                        role: 'participant',
                        joinedAt: new Date().toISOString(),
                        isOnline: true,
                    });
                }

                invite.uses++;
                if (invite.maxUses && invite.uses >= invite.maxUses) {
                    invites.delete(code);
                }

                socket.join(invite.roomId);
                socket.data.roomId = invite.roomId;
                userSockets.get(socket.id).roomId = invite.roomId;

                console.log(`[MultiUserChat] ${username} joined room: ${room.name}`);

                // Broadcast user-joined to others in room
                socket.to(invite.roomId).emit('room:user-joined', {
                    userId,
                    username,
                    role: 'participant',
                    joinedAt: new Date().toISOString(),
                });

                // Send all users to the new participant
                callback({
                    success: true,
                    room: {
                        ...room,
                        messages: room.messages.slice(-200), // Last 200 messages
                    },
                    users: room.users,
                });
            } catch (err) {
                console.error('[MultiUserChat] Room join error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Join room directly by room ID (for host reconnection)
         */
        socket.on('room:rejoin', (data, callback) => {
            try {
                const room = rooms.get(data.roomId);
                if (!room) {
                    return callback({ success: false, error: 'Room not found.' });
                }

                const user = room.users.find(u => u.id === userId);
                if (!user) {
                    return callback({ success: false, error: 'You are not a member of this room.' });
                }

                user.isOnline = true;
                socket.join(data.roomId);
                socket.data.roomId = data.roomId;
                userSockets.get(socket.id).roomId = data.roomId;

                socket.to(data.roomId).emit('room:user-online', { userId, username });

                callback({ success: true, room, users: room.users });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Leave a room
         */
        socket.on('room:leave', (data, callback) => {
            try {
                const roomId = data?.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (room) {
                    const user = room.users.find(u => u.id === userId);
                    if (user) {
                        user.isOnline = false;
                    }
                    socket.leave(roomId);
                    socket.to(roomId).emit('room:user-offline', { userId, username });

                    // If host leaves, reassign or destroy
                    if (room.hostId === userId && data?.destroy) {
                        rooms.delete(roomId);
                        // Invalidate all invites for this room
                        for (const [code, invite] of invites) {
                            if (invite.roomId === roomId) invites.delete(code);
                        }
                        io.to(roomId).emit('room:destroyed', { roomId });
                        io.in(roomId).socketsLeave(roomId);
                    }
                }

                userSockets.get(socket.id).roomId = null;
                if (callback) callback({ success: true });
            } catch (err) {
                if (callback) callback({ success: false, error: err.message });
            }
        });

        // --- Invite Operations ---

        /**
         * Generate an invite code for a room
         */
        socket.on('invite:generate', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room) {
                    return callback({ success: false, error: 'Room not found.' });
                }
                if (room.hostId !== userId) {
                    return callback({ success: false, error: 'Only the host can generate invites.' });
                }

                const code = generateInviteCode();
                const expiresMs = data.expiresInHours
                    ? Date.now() + data.expiresInHours * 3600000
                    : null;
                const maxUses = data.maxUses || 0; // 0 = unlimited

                invites.set(code, {
                    roomId,
                    code,
                    expires: expiresMs,
                    maxUses,
                    uses: 0,
                    createdBy: userId,
                    createdAt: new Date().toISOString(),
                });

                console.log(`[MultiUserChat] Invite generated for room ${room.name}: ${code}`);

                callback({
                    success: true,
                    invite: {
                        code,
                        expires: expiresMs ? new Date(expiresMs).toISOString() : null,
                        maxUses: maxUses || 'unlimited',
                    },
                });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Validate an invite code
         */
        socket.on('invite:validate', (data, callback) => {
            try {
                const { code } = data;
                const invite = invites.get(code);

                if (!invite) {
                    return callback({ success: false, error: 'Invalid invite code.' });
                }
                if (invite.expires && Date.now() > invite.expires) {
                    invites.delete(code);
                    return callback({ success: false, error: 'Invite expired.' });
                }
                if (invite.maxUses && invite.uses >= invite.maxUses) {
                    invites.delete(code);
                    return callback({ success: false, error: 'Invite limit reached.' });
                }

                const room = rooms.get(invite.roomId);
                callback({
                    success: true,
                    roomName: room?.name || 'Unknown Room',
                    roomId: invite.roomId,
                    characterNames: room?.characterNames || [],
                    userCount: room?.users?.length || 0,
                });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * List all active invites for a room (host only)
         */
        socket.on('invite:list', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room || room.hostId !== userId) {
                    return callback({ success: false, error: 'Unauthorized.' });
                }

                const roomInvites = [];
                for (const [code, invite] of invites) {
                    if (invite.roomId === roomId) {
                        roomInvites.push({
                            code,
                            expires: invite.expires ? new Date(invite.expires).toISOString() : null,
                            maxUses: invite.maxUses || 'unlimited',
                            uses: invite.uses,
                            createdAt: invite.createdAt,
                        });
                    }
                }

                callback({ success: true, invites: roomInvites });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Revoke an invite code (host only)
         */
        socket.on('invite:revoke', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room || room.hostId !== userId) {
                    return callback({ success: false, error: 'Unauthorized.' });
                }

                invites.delete(data.code);
                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        // --- Chat Operations ---

        /**
         * Send a message to the room
         */
        socket.on('message:send', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room) {
                    return callback({ success: false, error: 'Room not found.' });
                }

                const message = {
                    id: uuidv4(),
                    senderId: userId,
                    senderName: data.senderName || username,
                    content: data.content,
                    type: data.type || 'user',       // 'user' or 'ai'
                    characterName: data.characterName || null,
                    timestamp: new Date().toISOString(),
                    metadata: data.metadata || {},
                };

                room.messages.push(message);

                // Keep message history manageable
                if (room.messages.length > 1000) {
                    room.messages = room.messages.slice(-500);
                }

                // Broadcast to everyone EXCEPT sender
                socket.to(roomId).emit('message:received', message);

                // Also broadcast typing stop
                socket.to(roomId).emit('user:typing-stop', { userId, username });

                callback({ success: true, message });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Sync AI-generated message to all users
         */
        socket.on('message:ai-response', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room) {
                    return callback({ success: false, error: 'Room not found.' });
                }

                const message = {
                    id: uuidv4(),
                    senderId: 'ai',
                    senderName: data.characterName || 'AI',
                    content: data.content,
                    type: 'ai',
                    characterName: data.characterName || null,
                    timestamp: new Date().toISOString(),
                    metadata: data.metadata || {},
                };

                room.messages.push(message);

                if (room.messages.length > 1000) {
                    room.messages = room.messages.slice(-500);
                }

                socket.to(roomId).emit('message:received', message);
                callback({ success: true, message });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Typing indicator
         */
        socket.on('user:typing-start', (data) => {
            const roomId = data.roomId || socket.data.roomId;
            if (roomId) {
                socket.to(roomId).emit('user:typing-start', {
                    userId,
                    username,
                    characterName: data.characterName || null,
                });
            }
        });

        socket.on('user:typing-stop', (data) => {
            const roomId = data.roomId || socket.data.roomId;
            if (roomId) {
                socket.to(roomId).emit('user:typing-stop', { userId, username });
            }
        });

        /**
         * Sync chat state / settings
         */
        socket.on('room:update-settings', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room) {
                    return callback({ success: false, error: 'Room not found.' });
                }
                if (room.hostId !== userId) {
                    return callback({ success: false, error: 'Only the host can change settings.' });
                }

                room.settings = { ...room.settings, ...data.settings };
                room.name = data.name || room.name;
                room.isGroupChat = data.isGroupChat ?? room.isGroupChat;
                room.characterNames = data.characterNames || room.characterNames;

                socket.to(roomId).emit('room:settings-updated', {
                    name: room.name,
                    settings: room.settings,
                    isGroupChat: room.isGroupChat,
                    characterNames: room.characterNames,
                });

                callback({ success: true, room });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Request room info (for re-sync)
         */
        socket.on('room:info', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);
                if (!room) {
                    return callback({ success: false, error: 'Room not found.' });
                }
                callback({ success: true, room, users: room.users });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Kick a user (host only)
         */
        socket.on('room:kick-user', (data, callback) => {
            try {
                const roomId = data.roomId || socket.data.roomId;
                const room = rooms.get(roomId);

                if (!room || room.hostId !== userId) {
                    return callback({ success: false, error: 'Unauthorized.' });
                }

                const targetUser = room.users.find(u => u.id === data.targetUserId);
                if (targetUser) {
                    targetUser.isOnline = false;
                }

                // Notify the kicked user
                socket.to(roomId).emit('room:user-kicked', {
                    userId: data.targetUserId,
                    reason: data.reason || 'You have been removed from the room.',
                });

                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        // --- Disconnection ---
        socket.on('disconnect', () => {
            const userData = userSockets.get(socket.id);
            if (userData?.roomId) {
                const room = rooms.get(userData.roomId);
                if (room) {
                    const user = room.users.find(u => u.id === userData.userId);
                    if (user) {
                        user.isOnline = false;
                    }
                    socket.to(userData.roomId).emit('room:user-offline', {
                        userId: userData.userId,
                        username: userData.username,
                    });
                }
            }
            userSockets.delete(socket.id);
            console.log(`[MultiUserChat] User disconnected: ${userData?.username || 'unknown'}`);
        });
    });

    console.log('[MultiUserChat] Socket.IO server initialized');
    return io;
}

/**
 * Generate a human-friendly invite code
 */
function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
    let code = '';
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        if (i < 2) code += '-';
    }
    return code;
}

/**
 * Get room manager for external API access
 */
export function getRoomManager() {
    return {
        rooms,
        invites,
        getRoom: (id) => rooms.get(id) || null,
        getInvite: (code) => invites.get(code) || null,
        listRooms: () => Array.from(rooms.values()),
    };
}

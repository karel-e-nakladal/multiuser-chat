/**
 * Multi-User Chat Rooms Extension
 *
 * Enables real-time collaborative chat rooms with:
 * - Multiple human users chatting together
 * - AI character group chats
 * - Invite-based room joining
 * - Presence indicators & typing notifications
 * - Chat history sync
 */

import {
    chat,
    chat_metadata,
    characters,
    eventSource,
    event_types,
    getRequestHeaders,
    this_chid,
    system_message_types,
} from '../../../script.js';

import { extension_settings, saveExtensionSettings } from '../../extensions.js';
import { selected_group } from '../../../group-chats.js';
import { t } from '../../../i18n.js';
import { debounceAsync } from '../../../utils.js';

// =============================================================================
// Constants
// =============================================================================
const EXTENSION_NAME = 'multiuser-chat';
const EXTENSION_PATH = `scripts/extensions/${EXTENSION_NAME}`;

const defaultSettings = {
    username: '',
    userId: '',
    isEnabled: false,
    autoConnect: false,
    serverUrl: '', // Leave empty to use same server
    rooms: {},     // roomId -> { name, isHost, inviteCodes, ... }
};

// =============================================================================
// Globals
// =============================================================================
let settings = defaultSettings;
let socket = null;
let currentRoom = null;          // Currently joined room info
let isConnected = false;
let typingTimeout = null;
let io = null;                   // socket.io-client library instance

// UI Elements
let $container = null;
let $panel = null;
let $userList = null;
let $messageFeed = null;
let $inviteDisplay = null;
let $connectionStatus = null;

// =============================================================================
// Utility Functions
// =============================================================================

function log(...args) {
    console.log(`[MultiUserChat]`, ...args);
}

function warn(...args) {
    console.warn(`[MultiUserChat]`, ...args);
}

function generateUserId() {
    return `user-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function getOrCreateUserId() {
    if (!settings.userId) {
        settings.userId = generateUserId();
        saveSettings();
    }
    return settings.userId;
}

function getOrCreateUsername() {
    if (!settings.username) {
        settings.username = `User-${Math.floor(Math.random() * 9000) + 1000}`;
        saveSettings();
    }
    return settings.username;
}

function saveSettings() {
    extension_settings[EXTENSION_NAME] = settings;
    saveExtensionSettings();
}

// =============================================================================
// Socket.IO Connection Management
// =============================================================================

async function loadSocketIO() {
    if (typeof io !== 'undefined') return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.4/socket.io.min.js';
        script.onload = () => {
            io = window.io;
            resolve();
        };
        script.onerror = () => reject(new Error('Failed to load Socket.IO client'));
        document.head.appendChild(script);
    });
}

function connectToServer() {
    if (socket && socket.connected) return;

    const serverUrl = settings.serverUrl || window.location.origin;

    socket = io(serverUrl, {
        path: '/api/multiuser/socket.io',
        auth: {
            username: getOrCreateUsername(),
            userId: getOrCreateUserId(),
        },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => {
        isConnected = true;
        updateConnectionStatus('connected', 'Connected');
        log('Connected to multi-user server');

        // Auto-rejoin if we were in a room
        if (currentRoom && currentRoom.id) {
            socket.emit('room:rejoin', { roomId: currentRoom.id }, (res) => {
                if (res.success) {
                    updateRoomState(res.room, res.users);
                }
            });
        }
    });

    socket.on('disconnect', () => {
        isConnected = false;
        updateConnectionStatus('disconnected', 'Disconnected');
        log('Disconnected from multi-user server');
    });

    socket.on('connect_error', (err) => {
        isConnected = false;
        updateConnectionStatus('error', `Connection error: ${err.message}`);
        warn('Connection error:', err.message);
    });

    // --- Message handlers ---
    socket.on('message:received', (message) => {
        handleIncomingMessage(message);
    });

    socket.on('room:user-joined', (user) => {
        addUserToList(user);
        addSystemMessage(`${user.username} joined the room.`);
    });

    socket.on('room:user-online', (data) => {
        updateUserOnlineStatus(data.userId, true);
        addSystemMessage(`${data.username} is now online.`);
    });

    socket.on('room:user-offline', (data) => {
        updateUserOnlineStatus(data.userId, false);
        addSystemMessage(`${data.username} went offline.`);
    });

    socket.on('room:user-kicked', (data) => {
        if (data.userId === getOrCreateUserId()) {
            leaveRoom(true);
            showToast(`You have been removed: ${data.reason}`, 'warning');
        }
    });

    socket.on('room:destroyed', (data) => {
        leaveRoom(true);
        showToast('The room has been closed by the host.', 'info');
    });

    socket.on('room:settings-updated', (data) => {
        if (currentRoom) {
            currentRoom.name = data.name || currentRoom.name;
            currentRoom.isGroupChat = data.isGroupChat ?? currentRoom.isGroupChat;
            currentRoom.characterNames = data.characterNames || currentRoom.characterNames;
            updateRoomDisplay();
        }
    });

    socket.on('user:typing-start', (data) => {
        showTypingIndicator(data.userId, data.username, data.characterName, true);
    });

    socket.on('user:typing-stop', (data) => {
        showTypingIndicator(data.userId, data.username, null, false);
    });
}

function disconnectFromServer() {
    if (socket) {
        if (currentRoom) {
            socket.emit('room:leave', { destroy: false });
        }
        socket.disconnect();
        socket = null;
    }
    isConnected = false;
    updateConnectionStatus('disconnected', 'Disconnected');
}

// =============================================================================
// Room Operations
// =============================================================================

function createRoom(roomName, isGroupChat = false, characterNames = []) {
    if (!socket || !isConnected) {
        showToast('Not connected to server. Please connect first.', 'error');
        return;
    }

    socket.emit('room:create', {
        name: roomName,
        isGroupChat,
        characterNames,
        settings: {
            allowTypingIndicators: true,
            maxMessageLength: 4000,
            allowUserMessages: true,
        },
    }, (res) => {
        if (res.success) {
            currentRoom = res.room;
            updateRoomDisplay();
            updateUserList(res.room.users);
            $panel.removeClass('hidden');
            updateConnectionStatus('in-room', `In room: ${res.room.name}`);
            showToast(`Room "${res.room.name}" created!`, 'success');
            saveRoomToSettings(res.room);
        } else {
            showToast(`Failed to create room: ${res.error}`, 'error');
        }
    });
}

function joinRoom(inviteCode) {
    if (!socket || !isConnected) {
        showToast('Not connected to server. Please connect first.', 'error');
        return;
    }

    socket.emit('room:join', { code: inviteCode.toUpperCase().trim() }, (res) => {
        if (res.success) {
            currentRoom = res.room;
            updateRoomDisplay();
            updateUserList(res.users);
            $panel.removeClass('hidden');
            updateConnectionStatus('in-room', `In room: ${res.room.name}`);
            showToast(`Joined "${res.room.name}"!`, 'success');
            saveRoomToSettings(res.room);

            // Sync messages
            if (res.room.messages) {
                res.room.messages.forEach(msg => {
                    if (msg.type === 'user') {
                        addMessageToFeed(msg);
                    }
                });
            }
        } else {
            showToast(`Failed to join: ${res.error}`, 'error');
        }
    });
}

function leaveRoom(destroyIfHost = false) {
    if (!socket || !currentRoom) return;

    socket.emit('room:leave', {
        roomId: currentRoom.id,
        destroy: destroyIfHost && currentRoom.hostId === getOrCreateUserId(),
    }, (res) => {
        if (res?.success || !res) {
            removeRoomFromSettings(currentRoom.id);
            currentRoom = null;
            $panel.addClass('hidden');
            $userList.empty();
            $messageFeed.empty();
            updateConnectionStatus('connected', 'Connected (no room)');
        }
    });
}

function generateInvite(expiresInHours = 24, maxUses = 0) {
    if (!socket || !currentRoom) {
        showToast('You must be in a room to generate invites.', 'error');
        return;
    }

    socket.emit('invite:generate', {
        roomId: currentRoom.id,
        expiresInHours,
        maxUses,
    }, (res) => {
        if (res.success) {
            displayInviteCode(res.invite);
        } else {
            showToast(`Failed to generate invite: ${res.error}`, 'error');
        }
    });
}

function validateInvite(code, callback) {
    if (!socket || !isConnected) {
        callback({ success: false, error: 'Not connected.' });
        return;
    }
    socket.emit('invite:validate', { code: code.toUpperCase().trim() }, callback);
}

function kickUser(targetUserId) {
    if (!socket || !currentRoom) return;
    socket.emit('room:kick-user', { targetUserId }, (res) => {
        if (res.success) {
            showToast('User removed from room.', 'success');
        } else {
            showToast(`Failed to kick user: ${res.error}`, 'error');
        }
    });
}

// =============================================================================
// Message Handling
// =============================================================================

function sendMessage(content, type = 'user', characterName = null) {
    if (!socket || !currentRoom) {
        showToast('You are not in a room.', 'error');
        return;
    }

    socket.emit('message:send', {
        content,
        type,
        characterName,
        senderName: getOrCreateUsername(),
    }, (res) => {
        if (res.success && type === 'user') {
            addMessageToFeed(res.message, true);
        }
    });
}

function sendAiResponse(content, characterName) {
    if (!socket || !currentRoom) return;

    socket.emit('message:ai-response', {
        content,
        characterName,
    }, (res) => {
        if (res.success) {
            addMessageToFeed(res.message);
        }
    });
}

function handleIncomingMessage(message) {
    if (message.type === 'user' || message.type === 'ai') {
        addMessageToFeed(message);
    }
}

function sendTypingStart(characterName = null) {
    if (!socket || !currentRoom) return;
    socket.emit('user:typing-start', { characterName });
}

function sendTypingStop() {
    if (!socket || !currentRoom) return;
    socket.emit('user:typing-stop', {});
}

// =============================================================================
// UI Rendering
// =============================================================================

function renderUI() {
    const html = `
    <div id="multiuser-chat-container" class="multiuser-chat-container">
        <div class="mu-header">
            <div class="mu-header-left">
                <h3 class="mu-title">
                    <i class="fa-solid fa-users"></i>
                    <span data-i18n="Multi-User Chat">Multi-User Chat</span>
                </h3>
                <span id="mu-connection-status" class="mu-status mu-status-disconnected">Disconnected</span>
            </div>
            <div class="mu-header-right">
                <button id="mu-btn-connect" class="mu-btn mu-btn-primary" title="Connect to server">
                    <i class="fa-solid fa-plug"></i> Connect
                </button>
                <button id="mu-btn-settings" class="mu-btn mu-btn-icon" title="Settings">
                    <i class="fa-solid fa-cog"></i>
                </button>
            </div>
        </div>

        <!-- Connection Panel -->
        <div id="mu-connection-panel" class="mu-panel">
            <div class="mu-form-group">
                <label>Username</label>
                <input type="text" id="mu-username" placeholder="Enter your display name" maxlength="30" />
            </div>
            <div class="mu-form-group">
                <label>Server URL <small>(leave empty for same server)</small></label>
                <input type="text" id="mu-server-url" placeholder="http://localhost:8000" />
            </div>
            <button id="mu-btn-do-connect" class="mu-btn mu-btn-success">
                <i class="fa-solid fa-plug"></i> Connect to Server
            </button>
        </div>

        <!-- Room Join/Create Panel -->
        <div id="mu-room-actions" class="mu-panel hidden">
            <div class="mu-tabs">
                <button class="mu-tab active" data-tab="create">Create Room</button>
                <button class="mu-tab" data-tab="join">Join Room</button>
            </div>

            <!-- Create Room Tab -->
            <div id="mu-tab-create" class="mu-tab-content">
                <div class="mu-form-group">
                    <label>Room Name</label>
                    <input type="text" id="mu-room-name" placeholder="My Chat Room" maxlength="50" />
                </div>
                <div class="mu-form-group">
                    <label class="mu-checkbox">
                        <input type="checkbox" id="mu-group-chat-toggle" />
                        <span>Enable Group Chat (multiple AI characters)</span>
                    </label>
                </div>
                <div id="mu-character-select" class="mu-character-select hidden">
                    <label>AI Characters in Room</label>
                    <div id="mu-character-list" class="mu-character-list"></div>
                </div>
                <button id="mu-btn-create-room" class="mu-btn mu-btn-success">
                    <i class="fa-solid fa-plus-circle"></i> Create Room
                </button>
            </div>

            <!-- Join Room Tab -->
            <div id="mu-tab-join" class="mu-tab-content hidden">
                <div class="mu-form-group">
                    <label>Invite Code</label>
                    <div class="mu-invite-input-wrap">
                        <input type="text" id="mu-invite-code" placeholder="XXX-XXX-XXX" maxlength="11" />
                        <button id="mu-btn-validate-invite" class="mu-btn mu-btn-secondary">
                            <i class="fa-solid fa-search"></i> Validate
                        </button>
                    </div>
                </div>
                <div id="mu-invite-preview" class="hidden"></div>
                <button id="mu-btn-join-room" class="mu-btn mu-btn-success">
                    <i class="fa-solid fa-door-open"></i> Join Room
                </button>
            </div>
        </div>

        <!-- Active Room Panel -->
        <div id="mu-room-panel" class="mu-panel hidden">
            <div class="mu-room-header">
                <div class="mu-room-info">
                    <h4 id="mu-room-display-name">Room Name</h4>
                    <span id="mu-room-type-badge" class="mu-badge">Single Chat</span>
                    <span id="mu-user-count" class="mu-badge mu-badge-users">0 users</span>
                </div>
                <div class="mu-room-actions">
                    <button id="mu-btn-invite" class="mu-btn mu-btn-accent" title="Generate invite code">
                        <i class="fa-solid fa-user-plus"></i> Invite
                    </button>
                    <button id="mu-btn-leave-room" class="mu-btn mu-btn-danger" title="Leave room">
                        <i class="fa-solid fa-right-from-bracket"></i> Leave
                    </button>
                </div>
            </div>

            <!-- Invite Display -->
            <div id="mu-invite-display" class="mu-invite-display hidden">
                <div class="mu-invite-card">
                    <span class="mu-invite-label">Invite Code:</span>
                    <span id="mu-invite-code-display" class="mu-invite-code-text"></span>
                    <button id="mu-btn-copy-invite" class="mu-btn mu-btn-sm">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                    <span id="mu-invite-expiry" class="mu-invite-expiry"></span>
                </div>
            </div>

            <!-- User List -->
            <div class="mu-section">
                <h5 class="mu-section-title">
                    <i class="fa-solid fa-users"></i> Participants
                </h5>
                <div id="mu-user-list" class="mu-user-list"></div>
            </div>

            <!-- Message Feed -->
            <div class="mu-section">
                <h5 class="mu-section-title">
                    <i class="fa-solid fa-message"></i> Recent Messages
                </h5>
                <div id="mu-message-feed" class="mu-message-feed"></div>
            </div>
        </div>

        <!-- Settings Panel -->
        <div id="mu-settings-panel" class="mu-panel hidden">
            <h4>Settings</h4>
            <div class="mu-form-group">
                <label class="mu-checkbox">
                    <input type="checkbox" id="mu-auto-connect" />
                    <span>Auto-connect on startup</span>
                </label>
            </div>
            <div class="mu-form-group">
                <label class="mu-checkbox">
                    <input type="checkbox" id="mu-show-typing" />
                    <span>Show typing indicators</span>
                </label>
            </div>
            <button id="mu-btn-save-settings" class="mu-btn mu-btn-primary">Save Settings</button>
        </div>
    </div>`;

    return html;
}

function renderCharacterSelector() {
    const $charList = $('#mu-character-list');
    $charList.empty();

    characters.forEach((char, idx) => {
        if (char && char.name) {
            $charList.append(`
                <label class="mu-checkbox mu-char-item">
                    <input type="checkbox" value="${idx}" class="mu-char-checkbox" />
                    <span class="mu-char-name">${escapeHtml(char.name)}</span>
                </label>
            `);
        }
    });
}

function updateConnectionStatus(status, text) {
    const $status = $('#mu-connection-status');
    $status.removeClass('mu-status-connected mu-status-disconnected mu-status-error mu-status-in-room');
    $status.addClass(`mu-status-${status}`);
    $status.text(text);
}

function updateRoomDisplay() {
    if (!currentRoom) return;
    $('#mu-room-display-name').text(currentRoom.name);
    $('#mu-room-type-badge').text(currentRoom.isGroupChat ? 'Group Chat' : 'Single Chat');
    $('#mu-user-count').text(`${currentRoom.users?.length || 0} users`);
}

function updateUserList(users) {
    const $list = $('#mu-user-list');
    $list.empty();

    if (!users || users.length === 0) return;

    const currentUserId = getOrCreateUserId();

    users.forEach(user => {
        const isHost = user.role === 'host';
        const isMe = user.id === currentUserId;
        const onlineClass = user.isOnline ? 'online' : 'offline';

        $list.append(`
            <div class="mu-user-item ${onlineClass}" data-user-id="${user.id}">
                <span class="mu-user-status-dot"></span>
                <span class="mu-user-name">${escapeHtml(user.username)}${isMe ? ' (You)' : ''}</span>
                ${isHost ? '<span class="mu-badge mu-badge-host">Host</span>' : ''}
                ${!isMe && currentRoom?.hostId === currentUserId ? `
                    <button class="mu-btn mu-btn-xs mu-btn-danger mu-kick-btn" data-user-id="${user.id}" title="Kick user">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                ` : ''}
            </div>
        `);
    });

    $('#mu-user-count').text(`${users.length} users`);
}

function addUserToList(user) {
    const users = currentRoom?.users || [];
    if (!users.find(u => u.id === user.id)) {
        users.push(user);
    } else {
        const existing = users.find(u => u.id === user.id);
        if (existing) existing.isOnline = true;
    }
    updateUserList(users);
}

function updateUserOnlineStatus(userId, isOnline) {
    if (!currentRoom?.users) return;
    const user = currentRoom.users.find(u => u.id === userId);
    if (user) {
        user.isOnline = isOnline;
        updateUserList(currentRoom.users);
    }
}

function addMessageToFeed(message, isOwn = false) {
    const $feed = $('#mu-message-feed');
    const isAi = message.type === 'ai';

    const msgHtml = `
        <div class="mu-message-item ${isOwn ? 'mu-own-message' : ''} ${isAi ? 'mu-ai-message' : ''}">
            <div class="mu-message-header">
                <span class="mu-message-sender">${escapeHtml(message.senderName)}</span>
                ${message.characterName ? `<span class="mu-message-char">as ${escapeHtml(message.characterName)}</span>` : ''}
                <span class="mu-message-time">${formatTime(message.timestamp)}</span>
            </div>
            <div class="mu-message-content">${escapeHtml(message.content)}</div>
        </div>
    `;

    $feed.append(msgHtml);
    $feed.scrollTop($feed[0].scrollHeight);
}

function addSystemMessage(text) {
    const $feed = $('#mu-message-feed');
    $feed.append(`
        <div class="mu-system-message">
            <span>${escapeHtml(text)}</span>
        </div>
    `);
    $feed.scrollTop($feed[0].scrollHeight);
}

function showTypingIndicator(userId, username, characterName, isTyping) {
    const $feed = $('#mu-message-feed');
    const indicatorId = `typing-${userId}`;

    if (isTyping) {
        // Remove existing indicator for this user if any
        $(`#${indicatorId}`).remove();

        const typingText = characterName
            ? `${username} (as ${characterName}) is typing...`
            : `${username} is typing...`;

        $feed.append(`
            <div id="${indicatorId}" class="mu-typing-indicator">
                <span class="mu-typing-dots"><span>.</span><span>.</span><span>.</span></span>
                <span>${escapeHtml(typingText)}</span>
            </div>
        `);
        $feed.scrollTop($feed[0].scrollHeight);
    } else {
        $(`#${indicatorId}`).fadeOut(200, () => $(this).remove());
    }
}

function displayInviteCode(invite) {
    const $display = $('#mu-invite-display');
    $('#mu-invite-code-display').text(invite.code);
    $('#mu-invite-expiry').text(invite.expires
        ? `Expires: ${new Date(invite.expires).toLocaleString()}`
        : 'No expiry');
    $display.removeClass('hidden');
}

// =============================================================================
// Event Handlers
// =============================================================================

function setupEventHandlers() {
    // Connect button
    $('#mu-btn-connect').on('click', () => {
        $('#mu-connection-panel').toggleClass('hidden');
    });

    $('#mu-btn-do-connect').on('click', () => {
        const username = $('#mu-username').val().trim();
        const serverUrl = $('#mu-server-url').val().trim();

        if (username) {
            settings.username = username;
            saveSettings();
        }
        if (serverUrl) {
            settings.serverUrl = serverUrl;
            saveSettings();
        }

        connectAsUser();
    });

    // Settings
    $('#mu-btn-settings').on('click', () => {
        $('#mu-settings-panel').toggleClass('hidden');
        $('#mu-auto-connect').prop('checked', settings.autoConnect);
    });

    $('#mu-btn-save-settings').on('click', () => {
        settings.autoConnect = $('#mu-auto-connect').is(':checked');
        saveSettings();
        $('#mu-settings-panel').addClass('hidden');
        showToast('Settings saved.', 'success');
    });

    // Tabs
    $(document).on('click', '.mu-tab', function () {
        const tab = $(this).data('tab');
        $('.mu-tab').removeClass('active');
        $(this).addClass('active');
        $('.mu-tab-content').addClass('hidden');
        $(`#mu-tab-${tab}`).removeClass('hidden');
    });

    // Group chat toggle
    $('#mu-group-chat-toggle').on('change', function () {
        $('#mu-character-select').toggleClass('hidden', !this.checked);
        if (this.checked) {
            renderCharacterSelector();
        }
    });

    // Create room
    $('#mu-btn-create-room').on('click', () => {
        const roomName = $('#mu-room-name').val().trim() || `${getOrCreateUsername()}'s Room`;
        const isGroupChat = $('#mu-group-chat-toggle').is(':checked');
        let characterNames = [];

        if (isGroupChat) {
            $('.mu-char-checkbox:checked').each(function () {
                const idx = parseInt($(this).val());
                if (characters[idx]) {
                    characterNames.push(characters[idx].name);
                }
            });
        }

        createRoom(roomName, isGroupChat, characterNames);
    });

    // Validate invite
    $('#mu-btn-validate-invite').on('click', () => {
        const code = $('#mu-invite-code').val().trim();
        if (!code) return;

        validateInvite(code, (res) => {
            const $preview = $('#mu-invite-preview');
            if (res.success) {
                $preview.removeClass('hidden').html(`
                    <div class="mu-invite-preview-card">
                        <strong>${escapeHtml(res.roomName)}</strong>
                        <span>${res.userCount} user(s) online</span>
                        ${res.characterNames?.length ? `<span>Characters: ${res.characterNames.join(', ')}</span>` : ''}
                    </div>
                `);
            } else {
                $preview.removeClass('hidden').html(`
                    <div class="mu-invite-preview-card mu-error">${escapeHtml(res.error)}</div>
                `);
            }
        });
    });

    // Join room
    $('#mu-btn-join-room').on('click', () => {
        const code = $('#mu-invite-code').val().trim();
        if (!code) return;
        joinRoom(code);
    });

    // Invite button
    $('#mu-btn-invite').on('click', () => {
        if ($('#mu-invite-display').hasClass('hidden')) {
            generateInvite(24, 0);
        } else {
            $('#mu-invite-display').toggleClass('hidden');
        }
    });

    // Copy invite
    $('#mu-btn-copy-invite').on('click', () => {
        const code = $('#mu-invite-code-display').text();
        navigator.clipboard?.writeText(code).then(() => {
            showToast('Invite code copied!', 'success');
        }).catch(() => {
            // Fallback
            const $input = $('<input>').val(code).appendTo('body').select();
            document.execCommand('copy');
            $input.remove();
            showToast('Invite code copied!', 'success');
        });
    });

    // Leave room
    $('#mu-btn-leave-room').on('click', () => {
        if (currentRoom?.hostId === getOrCreateUserId()) {
            if (confirm('You are the host. Closing this room will disconnect all users. Continue?')) {
                leaveRoom(true);
            }
        } else {
            leaveRoom(false);
        }
    });

    // Kick user
    $(document).on('click', '.mu-kick-btn', function () {
        const userId = $(this).data('user-id');
        if (userId && confirm('Kick this user from the room?')) {
            kickUser(userId);
        }
    });

    // User message input integration - hook into SillyTavern's send
    // We intercept messages sent in group chats when multi-user mode is active

    // Clean up on chat change
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // Optionally auto-sync
    });

    // App ready
    eventSource.on(event_types.APP_READY, () => {
        if (settings.autoConnect && settings.isEnabled) {
            connectAsUser();
        }
    });
}

// =============================================================================
// Core Functions
// =============================================================================

async function connectAsUser() {
    try {
        await loadSocketIO();
        connectToServer();

        $('#mu-connection-panel').addClass('hidden');
        $('#mu-room-actions').removeClass('hidden');

        // Fill username
        $('#mu-username').val(getOrCreateUsername());
        $('#mu-server-url').val(settings.serverUrl || '');

        settings.isEnabled = true;
        saveSettings();
    } catch (err) {
        showToast(`Failed to connect: ${err.message}`, 'error');
        warn('Connection failed:', err);
    }
}

function saveRoomToSettings(room) {
    if (!settings.rooms) settings.rooms = {};
    settings.rooms[room.id] = {
        id: room.id,
        name: room.name,
        isHost: room.hostId === getOrCreateUserId(),
    };
    saveSettings();
}

function removeRoomFromSettings(roomId) {
    if (settings.rooms && settings.rooms[roomId]) {
        delete settings.rooms[roomId];
        saveSettings();
    }
}

function showToast(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        toastr[type](message);
    } else {
        console.log(`[MultiUserChat Toast - ${type}]`, message);
    }
}

// =============================================================================
// Utilities
// =============================================================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// =============================================================================
// API Exposure
// =============================================================================

/**
 * Public API for other extensions to interact with multi-user chat
 */
export const MultiUserChatAPI = {
    get isActive() { return isConnected && !!currentRoom; },
    get currentRoom() { return currentRoom; },
    get users() { return currentRoom?.users || []; },

    /**
     * Send a user message to the multi-user room
     */
    sendUserMessage(content) {
        sendMessage(content, 'user');
    },

    /**
     * Broadcast an AI response to all users in the room
     */
    sendAiMessage(content, characterName) {
        sendAiResponse(content, characterName);
    },

    /**
     * Create a room from an existing group chat
     */
    createFromGroupChat(groupChatName, characterNames) {
        createRoom(groupChatName, true, characterNames);
    },

    /**
     * Join a room by invite code
     */
    joinByInvite(code) {
        joinRoom(code);
    },

    /**
     * Leave the current room
     */
    leaveRoom() {
        leaveRoom(false);
    },

    /**
     * Get the generated invite code for the current room
     */
    generateInviteCode(expiresInHours, maxUses) {
        generateInvite(expiresInHours, maxUses);
    },
};

// =============================================================================
// Extension Lifecycle
// =============================================================================

export async function init() {
    log('Initializing Multi-User Chat Rooms extension');

    // Load settings
    if (extension_settings[EXTENSION_NAME]) {
        settings = { ...defaultSettings, ...extension_settings[EXTENSION_NAME] };
    } else {
        settings = { ...defaultSettings };
        extension_settings[EXTENSION_NAME] = settings;
        saveExtensionSettings();
    }

    // Render UI
    const $extBlock = $('#extensions_settings');
    if ($extBlock.length) {
        const html = renderUI();
        $extBlock.append(html);
    }

    // Cache DOM references
    $container = $('#multiuser-chat-container');
    $panel = $('#mu-room-panel');
    $userList = $('#mu-user-list');
    $messageFeed = $('#mu-message-feed');
    $inviteDisplay = $('#mu-invite-display');
    $connectionStatus = $('#mu-connection-status');

    // Setup event handlers
    setupEventHandlers();

    // Fill username
    $('#mu-username').val(getOrCreateUsername());
    $('#mu-server-url').val(settings.serverUrl || '');

    // Expose API globally
    globalThis.MultiUserChatAPI = MultiUserChatAPI;

    log('Multi-User Chat Rooms extension initialized');
}

// Cleanup on deactivation
export function cleanup() {
    disconnectFromServer();
    currentRoom = null;
    log('Multi-User Chat Rooms extension cleaned up');
}

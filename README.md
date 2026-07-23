# Multi-User Chat Rooms Extension for SillyTavern

A SillyTavern extension that enables real-time multi-user chat rooms with AI character group chat support. Convert any chat room into a collaborative space where multiple human users can chat together alongside AI characters.

## Features

- **Multi-User Chat Rooms**: Create rooms where multiple human users can chat simultaneously
- **Group Chat Conversion**: Convert existing SillyTavern group chats (multi-AI-character) into multi-user rooms
- **Invite System**: Generate shareable invite codes for other users to join your room
- **Real-Time Sync**: Messages, typing indicators, and user presence synced via WebSocket (Socket.IO)
- **User Management**: Host controls, kick users, manage participants
- **AI Integration**: AI character responses are broadcast to all room participants
- **Presence Indicators**: See who's online, typing, and active
- **Chat History**: Recent messages persisted and synced to new joiners

## Architecture

```
extensions/multiuser-chat/
├── manifest.json          # Extension manifest (loaded by ST)
├── index.js              # Client-side extension logic
├── style.css             # UI styles
├── README.md             # This file
└── server/
    ├── plugin.js         # Server entry point (Express plugin)
    ├── index.js          # Socket.IO server & room management
    └── package.json      # Server dependencies
```

## Installation

### 1. Install Server Dependencies

```bash
cd SillyTavern
cd public/scripts/extensions/multiuser-chat/server
npm install
```

### 2. Register the Server Plugin

Add the following to your SillyTavern `server.js` file (near the other extension imports):

```js
// Near the top of server.js, add:
import { initMultiUserChatServer, addMultiUserRoutes } from './public/scripts/extensions/multiuser-chat/server/plugin.js';

// After httpServer is created and before listen():
const io = initMultiUserChatServer(httpServer);

// After app is created, to add REST routes:
addMultiUserRoutes(app);
```

### 3. Enable the Extension

1. Start SillyTavern
2. Go to **Extensions** in the top menu
3. Find **Multi-User Chat Rooms** and enable it
4. The extension panel will appear in the extensions area

## Usage

### Hosting a Room

1. **Connect**: Enter your display name and click "Connect to Server"
2. **Create Room**: Go to the "Create Room" tab
3. Enter a room name
4. (Optional) Enable "Group Chat" and select AI characters to include
5. Click "Create Room"
6. **Invite Others**: Click the "Invite" button to generate a shareable invite code

### Joining a Room

1. **Connect**: Enter your display name and click "Connect to Server"
2. **Join Room**: Go to the "Join Room" tab
3. Enter the invite code shared by the host
4. Click "Validate" to preview the room
5. Click "Join Room"

### Invite Codes

- Invite codes are in the format `XXX-XXX-XXX` (e.g., `A3F-K9M-W2P`)
- Codes can be configured with:
  - **Expiration time** (e.g., 24 hours)
  - **Maximum uses** (e.g., 5 joins per code)
- Only the room host can generate invites
- Invite codes can be revoked at any time

## API for Other Extensions

The extension exposes a global `MultiUserChatAPI` object:

```js
// Check if multi-user mode is active
if (MultiUserChatAPI.isActive) {
    // Send a user message to all room participants
    MultiUserChatAPI.sendUserMessage('Hello everyone!');
    
    // Broadcast an AI response
    MultiUserChatAPI.sendAiMessage('Greetings, humans.', 'AI Assistant');
    
    // Get current room info
    console.log(MultiUserChatAPI.currentRoom);
    
    // Get online users
    console.log(MultiUserChatAPI.users);
}
```

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `username` | Your display name in rooms | Auto-generated |
| `autoConnect` | Connect automatically on startup | `false` |
| `serverUrl` | Server URL (empty = same server) | `""` |

## How It Works

1. The host creates a room via Socket.IO, which is stored in server memory
2. Other users connect and join via invite codes
3. When a user sends a message, it's broadcast to all room members
4. AI character responses can be injected by the host and synced to all participants
5. Typing indicators and presence are synced in real-time

## Limitations & Future Plans

- **In-Memory Storage**: Rooms and messages are stored in memory (lost on server restart). Future versions may add database persistence.
- **No E2E Encryption**: Messages are not encrypted end-to-end. Use trusted servers only.
- **Single Host**: Each room has one host with admin privileges.
- **Future**: File sharing, voice chat integration, webhook support, proper authentication

## Troubleshooting

### Socket.IO fails to load
The extension loads Socket.IO from CDN. Ensure you have internet access on first use.

### Can't connect to server
- Verify the server URL is correct
- Check that the server plugin is properly registered in `server.js`
- Check browser console for CORS errors

### Invite code doesn't work
- Invite codes may have expired
- The room may have been closed by the host
- The maximum uses for the code may have been reached

## License

AGPL-3.0 (same as SillyTavern)

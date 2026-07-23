# Multi-User Chat Rooms for SillyTavern

Real-time collaborative chat rooms with AI character group chat support. Multiple human users can chat together alongside AI characters in the same room.

## Features

- Create rooms where multiple users chat simultaneously
- Group chat support — include multiple AI characters in a room
- Invite system with shareable codes (`XXX-XXX-XXX`)
- Real-time messaging via Socket.IO (WebSocket)
- Typing indicators and online/offline presence
- Host controls — kick users, manage room settings
- AI responses broadcast to all participants
- Chat history sync for late joiners

## Quick Install

### 1. Install via SillyTavern button

1. Go to **Extensions** → click **"Install Extension"**
2. Paste the repo URL: `https://github.com/SillyTavern/SillyTavern-MultiUserChat`
3. Click **Install** — the UI, JS, and CSS are installed
4. Enable the extension in the Extensions panel

### 2. Install server dependencies

```bash
cd SillyTavern/public/scripts/extensions/third-party/SillyTavern-MultiUserChat/server
npm install
```

### 3. Register the server plugin

Add these lines to SillyTavern's `server.js`:

```js
// Near the top, with other imports:
import { initMultiUserChatServer, addMultiUserRoutes }
  from './public/scripts/extensions/third-party/SillyTavern-MultiUserChat/server/plugin.js';

// After const server = http.createServer(app):
const io = initMultiUserChatServer(httpServer);

// Before server.listen():
addMultiUserRoutes(app);
```

Or run the auto-patcher:

```bash
node public/scripts/extensions/third-party/SillyTavern-MultiUserChat/server/setup.js
```

### 4. Restart SillyTavern

---

## Usage

### Host a Room

1. In the extension panel, enter your **display name** and click **Connect to Server**
2. Go to the **Create Room** tab
3. Enter a room name
4. *(Optional)* Enable **Group Chat** and select AI characters
5. Click **Create Room**
6. Click **Invite** to generate a shareable code

### Join a Room

1. Click **Connect to Server**
2. Go to the **Join Room** tab
3. Enter the invite code from the host
4. Click **Validate** to preview the room
5. Click **Join Room**

### Invite Codes

- Format: `XXX-XXX-XXX` (e.g. `A3F-K9M-W2P`)
- Only the host can generate invites
- Codes can be set to expire or have max uses

---

## File Structure

```
repo-root/
├── manifest.json     # Extension manifest
├── index.html        # UI template
├── index.js          # Client-side extension logic
├── style.css         # UI styles
└── server/
    ├── plugin.js     # Express plugin entry point
    ├── index.js      # Socket.IO server + room management
    ├── setup.js      # Auto-patcher for server.js
    └── package.json  # Server dependencies (socket.io, uuid)
```

## API for Other Extensions

```js
// Send a message to all room participants
MultiUserChatAPI.sendUserMessage('Hello everyone!');

// Broadcast an AI response
MultiUserChatAPI.sendAiMessage('Greetings!', 'Character Name');

// Check if active
if (MultiUserChatAPI.isActive) {
    console.log(MultiUserChatAPI.currentRoom);
    console.log(MultiUserChatAPI.users);
}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `[object Event]` load error | Check browser console (F12) for import errors |
| Socket.IO fails to load | Needs internet on first use (loads from CDN) |
| Can't connect to server | Verify server plugin is registered in `server.js` and ST was restarted |
| Invite code doesn't work | Code may have expired or room was closed by host |
| Extension not visible | Go to Extensions panel and enable "Multi-User Chat Rooms" |

To view extension logs, open the browser console (**F12** → **Console**) and look for `[MultiUserChat]`.

## License

AGPL-3.0

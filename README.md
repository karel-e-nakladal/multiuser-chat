# Multi-User Chat Rooms for SillyTavern

Real-time collaborative chat rooms. Multiple human users chat together in the same room, with optional AI characters participating via group chat.

## Features

- **Rooms** — create, join via invite codes, leave/destroy
- **Real-time messaging** — Socket.IO WebSocket transport
- **Group chat** — include multiple AI characters in a room
- **Invite codes** — human-friendly `XXX-XXX-XXX` format with optional expiry & max uses
- **Presence** — online/offline indicators, typing notifications
- **Host controls** — kick users, manage room settings, revoke invites
- **Chat history sync** — late joiners receive the last 200 messages
- **Public API** — other extensions can send/receive messages via `MultiUserChatAPI`

---

## Installation

### 1. Install the extension files

**Option A — SillyTavern's built-in installer:**

1. SillyTavern → **Extensions** → **Install Extension**
2. Paste the repo URL
3. Click **Install**

**Option B — Manual copy:**

```bash
cp -r extensions/multiuser-chat \
     /path/to/SillyTavern/public/scripts/extensions/third-party/multiuser-chat
```

### 2. Install server dependencies

```bash
cd SillyTavern/public/scripts/extensions/third-party/multiuser-chat/server
npm install
```

### 3. Wire the plugin into SillyTavern

Run the auto-patcher **from the host** (not inside Docker):

```bash
node SillyTavern/public/scripts/extensions/third-party/multiuser-chat/server/setup.js
```

This adds three lines to `server.js`:
- An import for the plugin (after the last existing import)
- Socket.IO initialization (after the HTTP server is created)
- REST API routes (before the server starts listening)

If the patcher can't find `server.js`, it prints the exact lines to add manually.

To undo: `node setup.js --undo`

**Docker users:** run setup.js on the **host machine**, not inside the container.
Changes made inside the container are lost on `docker compose down -v`.

### 4. Restart SillyTavern

```bash
# Bare-metal — stop and start however you normally do

# Docker (no -v!)
docker compose down && docker compose up -d
```

### 5. Enable the extension

SillyTavern → **Extensions** → find **Multi-User Chat Rooms** → toggle it on.

---

## Usage

### Connect

1. In the extension panel, enter a **display name** (or keep the generated one)
2. Leave **Server URL** empty — it uses the same server you're already on
3. Click **Connect to Server**
4. Status dot turns green: *"Connected"*

### Create a room & invite others

1. **Create Room** tab → enter a room name
2. *(Optional)* toggle **Group Chat** to include AI characters, then check the ones you want
3. Click **Create Room**
4. Click the **Invite** button → a code like `A3F-K9M-W2P` appears
5. Click **Copy** and send it to the other person

### Join someone else's room

1. Get the 9-character invite code from the host
2. **Join Room** tab → paste it in
3. Click **Validate** to preview the room (name, users online, characters)
4. Click **Join Room**

### Leave / close a room

- **Leave Room** as a participant → you leave; room stays alive for others
- **Leave Room** as the host → prompted "close the room for everyone?"
  - Yes → destroys the room and disconnects all users
  - No → you leave but the room becomes orphaned (no host)

### Kick a user (host only)

Click the ✕ next to a user's name in the user list. Kicked users cannot rejoin.

---

## Invite codes

| Property | Default | Description |
|----------|---------|-------------|
| Format | `XXX-XXX-XXX` | 9 characters, no I/O/0/1 (unambiguous) |
| Expiry | 24 hours | Set via the API; UI defaults to 24h |
| Max uses | Unlimited | 0 = unlimited; set a number to cap it |

Only the room host can generate, list, or revoke invite codes.

---

## API for other extensions

The client exposes `globalThis.MultiUserChatAPI`:

```js
// Check if a multi-user session is active
if (MultiUserChatAPI.isActive) {
    console.log(MultiUserChatAPI.currentRoom); // { id, name, users, ... }
    console.log(MultiUserChatAPI.users);       // array of connected users
}

// Send a user message to the room
MultiUserChatAPI.sendUserMessage('Hello everyone!');

// Broadcast an AI response to all participants
MultiUserChatAPI.sendAiMessage('Greetings, travelers.', 'Gandalf');

// Create a room from a group chat
MultiUserChatAPI.createFromGroupChat('Adventure Room', ['Gandalf', 'Frodo']);

// Join by invite code
MultiUserChatAPI.joinByInvite('A3F-K9M-W2P');

// Leave the current room
MultiUserChatAPI.leaveRoom();

// Generate an invite (host only)
MultiUserChatAPI.generateInviteCode(24, 10); // 24h expiry, max 10 uses
```

---

## File structure

```
multiuser-chat/
├── manifest.json          # SillyTavern extension manifest
├── index.html             # UI template injected into Extensions panel
├── index.js               # Client-side logic (socket.io, UI, API)
├── style.css              # UI styles
└── server/
    ├── package.json       # socket.io, uuid
    ├── plugin.js          # Express plugin — init + REST routes
    ├── index.js           # Socket.IO server — rooms, invites, messaging
    └── setup.js           # Auto-patcher for SillyTavern's server.js
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension not visible in menu | Go to Extensions panel and enable it; check browser console (F12) for import errors |
| `saveExtensionSettings is not exported` | Outdated `index.js` — recopy the latest version |
| `ERR_MODULE_NOT_FOUND … plugin.js` on startup | Stale import path in `server.js` — re-run `setup.js` |
| `404` on `/api/multiuser/socket.io/` | Plugin not registered in `server.js` — run `setup.js` and restart |
| `xhr poll error` when connecting | Server isn't running Socket.IO — verify all 3 lines in `server.js` |
| Changes lost after Docker restart | You ran setup inside the container — run it on the **host** |
| AI messages show *"Gandalf as Gandalf"* | Fixed in latest `index.js` — recopy it |
| Users appear offline right after joining | Fixed in latest `index.js` — recopy it |
| Kicked users can rejoin with new invite | Fixed in latest `server/index.js` — recopy it |

To view logs: browser console (**F12 → Console**) filter for `[MultiUserChat]`.
Server-side logs appear in the SillyTavern terminal or `docker logs` output.

---

## License

AGPL-3.0

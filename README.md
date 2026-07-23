# Multi-User Chat Rooms Extension for SillyTavern 
# FULLY VIBECODED

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

## Installation

### Option A: Via SillyTavern "Install Extension" button

1. **Click** the "Install Extension" button in SillyTavern's Extensions panel
2. **Paste** this repo's GitHub URL: `https://github.com/SillyTavern/Extension-MultiUserChat`
3. **Click Install** — the frontend (manifest, JS, CSS) will be installed to `third-party/`
4. **Complete the two manual steps below** for the server component

### Option B: Manual installation

1. Copy/clone this repo into `SillyTavern/public/scripts/extensions/third-party/SillyTavern-MultiUserChat/`

---

### Required Manual Steps (both options)

These two steps are required because the server-side Socket.IO component needs `npm` dependencies and server registration:
#### Step 1 — Install server dependencies



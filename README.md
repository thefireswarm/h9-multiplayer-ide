# 🚀 H9 Multiplayer Offline Code Editor

A web-based, collaborative in-browser IDE modeled after Visual Studio Code. Built as a **Multiplayer Offline-First IDE** powered by **Yjs CRDTs**, WebSockets/WebRTC, and **IndexedDB** for local persistence and seamless offline-to-online reconciliation.

## ✨ Features

- **Real-time Collaboration** — Multiple users edit simultaneously with live cursor tracking
- **Offline-First** — Edit without internet; changes sync automatically when back online
- **CRDT Conflict Resolution** — Uses Lamport Timestamps & Unique Client Vectors
- **IndexedDB Persistence** — All edits are saved locally, zero data loss
- **WebRTC + WebSocket** — Peer-to-peer and server-relayed sync
- **VS Code-like UI** — Monaco-style editor with syntax highlighting, file explorer, minimap
- **Integrated Terminal** — In-browser shell with basic commands
- **Live Preview** — Preview HTML output in real time

## 🚀 Live Demo

👉 [https://heartfelt-swan-d1d830.netlify.app/?room=h9-main-workspace](https://heartfelt-swan-d1d830.netlify.app/?room=h9-main-workspace)

## 🛠️ Tech Stack

- **Yjs** — CRDT library for conflict-free collaborative editing
- **WebRTC / WebSockets** — Real-time peer communication
- **IndexedDB** — Offline persistence layer
- **Monaco Editor** (style) — Code editor UI
- **Netlify** — Hosting & deployment

## 🏃 Getting Started

Simply open `index.html` in your browser — no build step required!

```bash
# Or serve locally
npx serve .
```

To join a shared room, append `?room=your-room-name` to the URL.

## 👥 Multiplayer

- Share the URL with teammates to collaborate in real time
- Each user gets a unique Hacker ID
- Offline edits queue and sync automatically on reconnect

## 📄 License

MIT

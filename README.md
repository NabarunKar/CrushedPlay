# CrushedPlay

CrushedPlay is a lightweight watch-party app foundation for watching locally owned videos with friends.

This scaffold intentionally does **not** implement room creation, video uploads, playback, or synchronized playback yet.

## Stack

- React + Vite + TypeScript frontend
- Node.js + Express + TypeScript backend
- `ws` WebSocket server initialized without room/sync logic
- npm workspaces monorepo

## Commands

```sh
npm install
npm run dev
```

Frontend: <http://localhost:5173>

Backend: <http://localhost:3000>

Health check: <http://localhost:3000/health>

## Project layout

```txt
client/   React/Vite application
server/   Express/WebSocket server
```

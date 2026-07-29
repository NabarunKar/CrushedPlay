# CrushedPlay — Architectural Design Document

A lightweight watch-party web app for 2–5 people that synchronizes playback of locally owned movies while preserving the original quality.

---

## Section 1 — Existing Open-Source Projects

### 1.1 Media Player

| Candidate | Advantages | Disadvantages | Maturity | Maintenance | Licence | Recommend? |
|:---|:---|:---|:---|:---|:---|:---|
| **Native `<video>` + custom controls** | Zero dependencies; full control over sync events; smallest possible bundle; no abstraction leak | Must build your own UI from scratch; cross-browser quirks with fullscreen/PiP | N/A (browser API) | N/A | N/A | ✅ **Yes (MVP)** |
| **Plyr** | Beautiful default UI; lightweight (~3 kB gzip); excellent subtitle/track support via native `<track>`; easy to theme with CSS | Adds a layer of abstraction over the native `<video>` element; slightly complicates hooking sync events; some edge cases around dynamic track changes | Mature (~26k ★) | Active | MIT | ✅ **Yes (recommended)** |
| **Video.js** | Most extensible; huge plugin ecosystem; handles edge cases well; v10 modernisation underway | Much heavier bundle (~100 kB+); enterprise-grade complexity is overkill for 2–5 users; plugin model adds cognitive overhead | Very Mature (~38k ★) | Active | Apache 2.0 | ❌ Over-engineered for this project |
| **hls.js / dash.js** | Industry-standard adaptive streaming | We are playing *local files*, not HLS/DASH streams — completely irrelevant | Mature | Active | Apache 2.0 | ❌ Not applicable |

> [!TIP]
> **Verdict:** Start with **Plyr** for its polished UI, native `<track>` subtitle support, and small footprint. If Plyr's event abstraction interferes with sync logic, fall back to the **native `<video>` element** with custom CSS controls — this is trivial since Plyr wraps the same element.

---

### 1.2 Synchronized Playback

| Candidate | Advantages | Disadvantages | Maturity | Maintenance | Licence | Recommend? |
|:---|:---|:---|:---|:---|:---|:---|
| **Custom sync over WebSocket (DIY)** | Total control; simple state machine; ~100 lines of code; no dependency | Must write the drift-correction yourself | N/A | N/A | N/A | ✅ **Yes** |
| **sync-video-player** | Pre-built multi-video sync | Designed for syncing multiple `<video>` elements on the *same page*, not across a network; tiny project with few stars | Immature | Low activity | MIT | ❌ Wrong use case |
| **howardchung/watchparty** | Full-featured reference (YouTube, screen share, chat) | Massive scope; React-based; tightly coupled to its own backend; not a library you can import | Moderate | Active | MIT | ❌ Reference only |

> [!TIP]
> **Verdict:** Roll a **simple custom sync protocol** over WebSockets. The logic is straightforward (broadcast play/pause/seek + periodic heartbeat for drift correction). There is no mature, minimal library that solves exactly our problem without pulling in an entire application.

---

### 1.3 Subtitle Handling & SRT → WebVTT Conversion

| Candidate | Advantages | Disadvantages | Maturity | Maintenance | Licence | Recommend? |
|:---|:---|:---|:---|:---|:---|:---|
| **srt-webvtt** | Purpose-built for browser; takes a `File`/`Blob` → returns a `URL.createObjectURL()` ready for `<track src>` | Small project (~54 ★); only does SRT → VTT; no parsing/manipulation | Small but stable | Low | MIT | ✅ **Yes (MVP)** |
| **subtitle.js** (gsantiago) | Stream-based parse/stringify; supports SRT + VTT + manipulation; TypeScript | Heavier; overkill if we only need "SRT in → VTT out" | Moderate (~433 ★) | Active | MIT | 🟡 Good alternative if we need more power later |
| **subtitle-converter** | Supports SRT, VTT, SSA, ASS, TTML | Heavier; we don't need SSA/ASS/TTML yet | Moderate | Active | MIT | ❌ Overkill for MVP |

> [!TIP]
> **Verdict:** Use **`srt-webvtt`** for the MVP — it's a single-purpose tool that converts an SRT file to a blob URL in one function call. If we later need ASS/SSA or subtitle manipulation, swap in `subtitle.js`.

---

### 1.4 WebSocket Communication

| Candidate | Advantages | Disadvantages | Maturity | Maintenance | Licence | Recommend? |
|:---|:---|:---|:---|:---|:---|:---|
| **`ws`** | Smallest footprint; spec-compliant; zero bloat; 33M+ weekly downloads; perfect for 2–5 users | No built-in rooms, reconnection, or broadcasting — must build yourself | Very Mature | Active | MIT | ✅ **Yes** |
| **Socket.IO** | Built-in rooms, namespaces, auto-reconnection, broadcasting, HTTP fallback | Much heavier; custom protocol (not standard WebSocket); requires both client + server library; HTTP long-polling upgrade dance adds latency | Very Mature | Active | MIT | ❌ Over-engineered for 2–5 users |

> [!TIP]
> **Verdict:** Use **`ws`** on the server. The browser already has `new WebSocket()` built in — no client library needed. Rooms and broadcasting for 2–5 users is ~20 lines of code. Socket.IO's reconnection logic is nice, but we can implement a simple reconnect loop in <10 lines.

---

### 1.5 Server Framework

| Candidate | Advantages | Disadvantages | Maturity | Maintenance | Licence | Recommend? |
|:---|:---|:---|:---|:---|:---|:---|
| **Express.js** | Ubiquitous; enormous ecosystem; every tutorial uses it; Express 5.0 stable | Slower than alternatives (irrelevant at our scale); verbose middleware pattern | Very Mature | Active | MIT | ✅ **Yes** |
| **Fastify** | Faster; schema-first validation; good plugin system | More opinionated; smaller ecosystem; marginal benefit at our scale | Mature | Active | MIT | 🟡 Viable but no advantage here |
| **Hono** | Ultra-lightweight; multi-runtime (Edge, Bun, Deno) | Newer ecosystem; edge-focus is irrelevant for our Node+WS server | Growing | Active | MIT | ❌ No advantage here |

> [!TIP]
> **Verdict:** Use **Express.js**. We need exactly three routes (serve the SPA, create a room, health check). Express's ecosystem and familiarity are more valuable than any performance difference at this scale. The `ws` library integrates directly with Express's HTTP server via `server.on('upgrade')`.

---

### 1.6 Room ID Generation

| Candidate | Advantages | Disadvantages | Maturity | Maintenance | Licence | Recommend? |
|:---|:---|:---|:---|:---|:---|:---|
| **nanoid** | 130 bytes gzipped; URL-safe; cryptographically strong; customisable length; zero deps | None for this use case | Very Mature (~24k ★) | Active | MIT | ✅ **Yes** |
| **uuid** | Standard RFC 4122 UUIDs | 36-character IDs are unwieldy for shareable links | Very Mature | Active | MIT | ❌ Too long for room URLs |
| **crypto.randomUUID()** | Built-in; no dependency | Same 36-char problem; not customisable length | N/A | N/A | N/A | ❌ Too long |

> [!TIP]
> **Verdict:** Use **`nanoid`** with a short length (e.g., `nanoid(8)`) for human-friendly room URLs like `/room/a1b2c3d4`.

---

### 1.7 Frontend Build Tool

| Candidate | Advantages | Disadvantages | Licence | Recommend? |
|:---|:---|:---|:---|:---|
| **Vite (vanilla template)** | Blazing fast HMR; `npm create vite@latest -- --template vanilla`; produces optimised static build; no framework lock-in | Adds a build step (acceptable trade-off) | MIT | ✅ **Yes** |
| **No build tool (raw HTML/JS)** | Zero setup | No HMR; no bundling; no tree-shaking; painful to manage imports in production | N/A | ❌ Impractical beyond prototyping |

> [!TIP]
> **Verdict:** Use **Vite** with the `vanilla` template. It gives us ES module support, HMR during development, and an optimised production build with zero framework overhead.

---

## Section 2 — Proposed Architecture

### 2.1 Overview Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User A's Browser                         │
│                                                                 │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────────────┐  │
│  │ File     │───▶│ Object    │───▶│ <video> element (Plyr)   │  │
│  │ picker   │    │ URL       │    │ + <track> for subtitles  │  │
│  └──────────┘    └───────────┘    └──────────────────────────┘  │
│                                              │                  │
│                                   play/pause/seek events        │
│                                              │                  │
│                                   ┌──────────▼──────────┐       │
│                                   │ Sync Client (WS)    │       │
│                                   └──────────┬──────────┘       │
└──────────────────────────────────────────────┼──────────────────┘
                                               │ WebSocket
                                               │
                              ┌────────────────▼────────────────┐
                              │       Node.js Server            │
                              │                                 │
                              │  Express ── serves static SPA   │
                              │  ws ────── sync relay           │
                              │  In-memory Map ── room state    │
                              │                                 │
                              └────────────────▲────────────────┘
                                               │ WebSocket
                                               │
┌──────────────────────────────────────────────┼──────────────────┐
│                                   ┌──────────┴──────────┐       │
│                                   │ Sync Client (WS)    │       │
│                                   └──────────▲──────────┘       │
│                                              │                  │
│                                   play/pause/seek events        │
│                                              │                  │
│  ┌──────────┐    ┌───────────┐    ┌──────────┴───────────────┐  │
│  │ File     │───▶│ Object    │───▶│ <video> element (Plyr)   │  │
│  │ picker   │    │ URL       │    │ + <track> for subtitles  │  │
│  └──────────┘    └───────────┘    └──────────────────────────┘  │
│                                                                 │
│                        User B's Browser                         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Frontend

| Concern | Solution |
|:---|:---|
| **Build tool** | Vite (vanilla JS, no framework) |
| **Video player** | Plyr wrapping a native `<video>` element |
| **File loading** | `<input type="file">` → `URL.createObjectURL()` → set as `<video src>` |
| **Subtitles (embedded)** | Browser natively renders tracks embedded in MP4 containers |
| **Subtitles (external SRT)** | `srt-webvtt` converts the uploaded SRT `File` to a VTT blob URL → injected as a `<track>` element |
| **Styling** | Vanilla CSS with CSS custom properties for theming |
| **State management** | Simple module-level variables; no Redux/Zustand needed |

### 2.3 Backend

| Concern | Solution |
|:---|:---|
| **Runtime** | Node.js |
| **HTTP server** | Express.js (serves the Vite build output + REST endpoints) |
| **WebSocket server** | `ws`, attached to the same HTTP server |
| **Room state** | In-memory `Map<roomId, RoomState>` — no database needed |
| **Room ID generation** | `nanoid(8)` |

### 2.4 Communication Protocol

All messages are JSON over WebSocket.

#### Client → Server

| Message | Payload | When |
|:---|:---|:---|
| `join` | `{ roomId }` | User opens a room URL |
| `sync` | `{ action: "play" \| "pause" \| "seek", time: number }` | User interacts with the player |
| `heartbeat` | `{ time: number, playing: boolean }` | Every 5 seconds |

#### Server → Client

| Message | Payload | When |
|:---|:---|:---|
| `room-state` | `{ time: number, playing: boolean, users: number }` | On join (initial state) |
| `sync` | `{ action, time, from: userId }` | Relayed from another user |
| `user-count` | `{ users: number }` | User joins/leaves |

#### Sync Strategy

1. **Event-driven:** When any user triggers play/pause/seek, the event is sent to the server, which broadcasts it to all *other* clients in the room.
2. **Server is the source of truth:** The server stores `{ time, playing, lastUpdate }` for each room.
3. **Drift correction:** Every 5 seconds, clients send a heartbeat with their current playback time. If drift exceeds **1 second**, the server sends a corrective `seek` command.
4. **Debouncing:** Rapid seek events are debounced (200 ms) to prevent feedback loops.
5. **"Remote" flag:** When a client receives a sync command from the server, it sets a `isRemoteAction = true` flag before applying the action, so its own event listeners don't re-broadcast it.

### 2.5 Video Serving

> [!IMPORTANT]
> **No video data passes through the server.** Each user loads their own local copy of the movie file. The file is read via `<input type="file">` and played through a local `blob:` URL. This is the key architectural decision that enables free hosting and preserves original quality.

**Assumption:** Both users possess the same movie file. The app does not verify this — it's the users' responsibility.

### 2.6 Subtitle Pipeline

```
User uploads .srt file
        │
        ▼
  ┌─────────────┐
  │ srt-webvtt   │  (browser-side, no server)
  │ converts to  │
  │ VTT blob URL │
  └──────┬──────┘
         │
         ▼
  <track kind="subtitles"
         src="blob:..."
         label="External SRT"
         default>
```

- **Embedded subtitles** (in MP4): The browser handles these natively via the `<video>` element's built-in track support.
- **Embedded subtitles** (in MKV): Not supported in MVP — MKV container is not natively supported by browsers.
- **External SRT**: Converted client-side to WebVTT using `srt-webvtt`, then injected as a `<track>` element.

### 2.7 Room State (Server-Side)

```javascript
// Conceptual model — not implementation code
rooms = new Map();

rooms.set("a1b2c3d4", {
  id: "a1b2c3d4",
  clients: Set<WebSocket>,    // connected clients
  playing: false,
  time: 0,                    // last known playback time (seconds)
  lastUpdate: Date.now(),     // timestamp of last sync event
});
```

- Rooms are created on first `join`.
- Rooms are deleted when the last client disconnects (with a 30-second grace period for reconnection).
- No persistence needed — this is an ephemeral watch session.

---

## Section 3 — Repository Structure

```
CrushedPlay/
├── client/                      # Vite vanilla JS app
│   ├── index.html               # Entry point
│   ├── vite.config.js           # Vite configuration
│   ├── package.json
│   ├── public/
│   │   └── favicon.svg
│   └── src/
│       ├── main.js              # App entry — routing, init
│       ├── style.css            # Global styles + CSS custom properties
│       ├── pages/
│       │   ├── home.js          # Landing page — create/join room
│       │   └── room.js          # Watch room — player + sync
│       ├── lib/
│       │   ├── player.js        # Plyr wrapper + event hooks
│       │   ├── sync.js          # WebSocket sync client
│       │   ├── subtitles.js     # SRT upload + conversion
│       │   └── router.js        # Minimal hash-based SPA router
│       └── components/
│           ├── file-picker.js   # Drag-and-drop file selector
│           └── user-count.js    # "2 viewers" badge
│
├── server/                      # Node.js backend
│   ├── package.json
│   ├── index.js                 # Express + ws setup
│   ├── rooms.js                 # Room state management
│   └── sync.js                  # WebSocket message handlers
│
├── package.json                 # Root workspace (npm workspaces)
├── README.md
└── .gitignore
```

> [!NOTE]
> The project uses **npm workspaces** (`client/` and `server/`) so that `npm install` at the root installs everything, and a single `npm run dev` can start both the Vite dev server and the Node.js server concurrently.

---

## Section 4 — Development Phases

Each phase ends with something you can run and test.

---

### Phase 1 — Skeleton & Local Playback
**Goal:** Open a local video file and play it in the browser.

- [ ] Scaffold Vite vanilla project in `client/`
- [ ] Scaffold Express server in `server/`
- [ ] Set up npm workspaces and `concurrently` for dev
- [ ] Build a file picker (`<input type="file" accept=".mp4,.mkv,.webm">`)
- [ ] Create `URL.createObjectURL()` from selected file
- [ ] Render video in a styled `<video>` element (no Plyr yet — raw HTML5)
- [ ] Basic responsive CSS layout (dark theme)

**Testable result:** Open `localhost:5173`, pick a local `.mp4`, watch it play.

---

### Phase 2 — Room Creation & Joining
**Goal:** Create a room and get a shareable link.

- [ ] Add `POST /api/rooms` endpoint → returns `{ roomId }` (using `nanoid(8)`)
- [ ] Add room state management (`rooms.js`)
- [ ] Build the home page UI: "Create Room" button
- [ ] On room creation, redirect to `/#/room/<roomId>`
- [ ] Build a minimal hash-based SPA router
- [ ] Display the shareable link in the room page
- [ ] Copy-to-clipboard button

**Testable result:** Click "Create Room", get redirected to a room URL, see the shareable link.

---

### Phase 3 — WebSocket Sync (Core Feature)
**Goal:** Play/pause/seek stays synchronized between two browser tabs.

- [ ] Set up `ws` WebSocket server attached to Express's HTTP server
- [ ] Implement `join` message handler (associates WS connection with a room)
- [ ] Implement `sync` message handler (relay play/pause/seek to other clients)
- [ ] Build the `sync.js` client module (WebSocket connection + message handling)
- [ ] Hook `<video>` events (`play`, `pause`, `seeked`) → send sync messages
- [ ] Receive sync messages → apply to local player (with `isRemoteAction` guard)
- [ ] Handle user join/leave → update user count
- [ ] Room cleanup on last disconnect (with 30s grace period)

**Testable result:** Open two tabs with the same room URL, pick the same video in both, press play in one → the other plays. Seek in one → the other seeks.

---

### Phase 4 — Drift Correction
**Goal:** Playback stays in sync even after network hiccups.

- [ ] Implement client heartbeat (every 5 seconds: send current time + playing state)
- [ ] Server compares heartbeats, detects drift > 1 second
- [ ] Server sends corrective `seek` to drifted client
- [ ] Debounce rapid seek events (200 ms)
- [ ] Handle edge cases: buffering, stalling, tab backgrounded

**Testable result:** Pause network for 5 seconds in one tab (DevTools throttling), resume → playback re-syncs within one heartbeat cycle.

---

### Phase 5 — Plyr Integration & Polished UI
**Goal:** Replace the raw `<video>` element with Plyr for a premium look.

- [ ] Install Plyr; wrap the `<video>` element
- [ ] Reconnect sync hooks to Plyr's event API
- [ ] Style the landing page (glassmorphism card, gradient background, micro-animations)
- [ ] Style the room page (cinema-dark theme, floating controls)
- [ ] Add drag-and-drop file selection with visual feedback
- [ ] Responsive layout (mobile + desktop)
- [ ] Add Google Fonts (Inter or similar)
- [ ] Viewer count badge with subtle animation

**Testable result:** A visually polished app with Plyr controls, working sync, beautiful landing page.

---

### Phase 6 — External SRT Subtitles
**Goal:** Upload an `.srt` file and see subtitles on the video.

- [ ] Add "Upload Subtitles" button in the room UI
- [ ] Use `srt-webvtt` to convert the uploaded SRT to a VTT blob URL
- [ ] Inject a `<track>` element into the video player
- [ ] Ensure Plyr's subtitle menu reflects the new track
- [ ] Handle multiple subtitle uploads (replace previous)

**Testable result:** Upload an SRT file → subtitles appear over the video, selectable from Plyr's CC menu.

---

### Phase 7 — Reconnection & Error Handling
**Goal:** Graceful handling of disconnections and edge cases.

- [ ] Client auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- [ ] On reconnect, re-join room and request current state
- [ ] Visual connection status indicator (green dot / "Reconnecting..." toast)
- [ ] Handle room-not-found error
- [ ] Handle "file not selected" state when joining a room

**Testable result:** Kill the server, restart it → clients reconnect and re-sync automatically.

---

### Phase 8 — Deployment
**Goal:** Deploy the app so it's accessible over the internet.

- [ ] Add `npm run build` script (builds Vite → `client/dist/`)
- [ ] Configure Express to serve `client/dist/` in production
- [ ] Add a `Dockerfile` (optional, for self-hosting)
- [ ] Deploy to Render free tier (or a $3–5/month VPS)
- [ ] Test with two users over the internet

**Testable result:** Share a link with a friend, watch a movie together.

---

## Section 5 — Risks

### MVP Blockers

| Risk | Impact | Mitigation |
|:---|:---|:---|
| **MKV files don't play in browsers** | Users with MKV files can't use the app | Document this limitation clearly. MVP supports MP4 + WebM only. MKV support is a future enhancement (requires client-side remuxing via `ffmpeg.wasm` or `web-demuxer`). |
| **Codec unsupported by browser** | Video file plays on one user's browser but not another's (e.g., H.265/HEVC on Firefox) | Show a clear error message with codec information. Document supported codecs. Most MP4 files use H.264 + AAC, which is universally supported. |
| **Large file + `createObjectURL()` memory** | Browser may struggle with very large files (10+ GB) | `URL.createObjectURL()` creates a reference, not a copy — memory usage is the file size. Modern browsers handle this well. Test with large files and document any limits. |
| **Tab backgrounded → playback drift** | Browser throttles timers in background tabs | The heartbeat + drift correction system (Phase 4) handles this. Additionally, `requestAnimationFrame` based heartbeats would be throttled — use `setInterval` instead. |
| **Free hosting spin-down** | Render's free tier spins down after 15 min of inactivity, dropping WebSocket connections | Acceptable for MVP/hobby use. Client reconnect logic (Phase 7) handles this. For reliable hosting, use a $3–5/month VPS. |

### Future Enhancements (Not MVP Blockers)

| Risk / Limitation | Notes |
|:---|:---|
| **MKV container support** | Requires `ffmpeg.wasm` or `web-demuxer` to remux MKV to MP4/WebM client-side. Heavy WASM dependency (~30 MB). Phase 2 enhancement. |
| **Embedded MKV subtitles** | MKV can contain SRT, ASS/SSA, PGS (image-based) subtitles. Extracting these requires WASM demuxing. ASS/SSA rendering needs a library like `libass.js`. |
| **ASS/SSA subtitle upload** | MVP only supports SRT. Could add `subtitle-converter` or `subtitle.js` later. |
| **Image-based subtitles (PGS/VobSub)** | These are bitmap images, not text — cannot be converted to WebVTT. Would require canvas overlay rendering. Very complex. |
| **H.265/HEVC playback** | Safari supports HEVC natively; Chrome/Firefox do not (without hardware decoding flags). No easy fix — users would need to re-encode to H.264. |
| **AV1 codec** | Growing support but not universal. Firefox and Chrome support it; Safari added support recently. |
| **Audio codecs (AC3/DTS/TrueHD)** | Browsers generally do not support Dolby/DTS audio codecs. Files with these codecs will have no audio. Users would need AAC/Opus/MP3 audio tracks. |
| **Multiple rooms** | The architecture already supports this (the `Map` holds any number of rooms). Just not tested/UI'd for MVP. |
| **Chat feature** | Easy to add over the same WebSocket connection. |
| **Scalability beyond 5 users** | The in-memory model doesn't scale horizontally. Would need Redis pub/sub or similar. Not needed for the target audience. |
| **Video file verification** | No way to verify both users have the same file. Could add file hash comparison, but it's slow for large files. |

---

## Section 6 — Recommendation

### Recommended Stack

| Layer | Technology | Why This Over Alternatives |
|:---|:---|:---|
| **Build tool** | **Vite** (vanilla JS template) | Instant HMR, zero-config, no framework lock-in. Raw HTML/JS lacks bundling; React/Vue would be over-engineering for a single-page app with two views. |
| **Video player** | **Plyr** | Beautiful out-of-the-box UI with native `<track>` subtitle support. Video.js is too heavy; raw `<video>` requires building an entire UI from scratch. Plyr sits in the sweet spot. |
| **SRT → WebVTT** | **srt-webvtt** | Single-purpose, browser-side, returns a blob URL ready for `<track src>`. `subtitle.js` is more powerful but more than we need. |
| **Server runtime** | **Node.js** | Universal choice for JS full-stack. No reason to introduce Go/Python/Rust for a relay server this simple. |
| **HTTP framework** | **Express.js** | Three routes and static file serving. Fastify and Hono offer no advantage at this scale. Express has the most tutorials, the most StackOverflow answers, and the lowest learning curve. |
| **WebSocket library** | **`ws`** | Spec-compliant, zero-overhead, 33M+ weekly downloads. Socket.IO's rooms/reconnection/broadcasting are features we can write in ~30 lines. Its custom protocol and forced client library add unnecessary coupling. |
| **Room IDs** | **nanoid** | 130 bytes, URL-safe, customisable length. UUID is too long for shareable links. |
| **Styling** | **Vanilla CSS** | CSS custom properties for theming, no build dependency for styles. Tailwind is unnecessary overhead for a two-page app. |
| **Hosting** | **Render (free tier)** or **$3–5 VPS** | Render works for demos/hobby use despite spin-down. A cheap VPS (Hetzner, DigitalOcean) is the most reliable option for always-on WebSocket connections. |

### Why NOT:

| Rejected Technology | Reason |
|:---|:---|
| React / Vue / Svelte | Two pages, no complex state — a framework adds bundle size and complexity with no benefit. |
| Socket.IO | Adds ~50 kB client bundle, requires matching client+server versions, uses a non-standard protocol. `ws` + native `WebSocket` is simpler and lighter. |
| Database (SQLite, Postgres) | Room state is ephemeral — an in-memory `Map` is sufficient. Rooms last minutes to hours, not days. |
| Redis | Only needed for horizontal scaling across multiple server instances. We have one server and 2–5 users. |
| WebRTC | Designed for peer-to-peer media streaming. We're not streaming video — each user has their own local file. WebRTC's complexity (STUN/TURN servers, ICE negotiation) is entirely unnecessary. |
| ffmpeg.wasm (MVP) | ~30 MB WASM binary for client-side MKV remuxing. Important for future MKV support, but too heavy and complex for the MVP. |
| Docker (MVP) | Nice-to-have for deployment, but a `node server/index.js` command is sufficient initially. Add in Phase 8 if needed. |

### Total NPM Dependencies (Production)

| Package | Size | Purpose |
|:---|:---|:---|
| `express` | ~200 kB | HTTP server |
| `ws` | ~60 kB | WebSocket server |
| `nanoid` | ~1 kB | Room ID generation |
| `plyr` | ~30 kB (client) | Video player UI |
| `srt-webvtt` | ~3 kB (client) | SRT → WebVTT conversion |
| `concurrently` | dev only | Run client + server together |

**Total production dependencies: 5 packages.** This is about as lean as it gets.

---

## Open Questions

> [!IMPORTANT]
> **Q1: Project name.** The workspace is called `CrushedPlay`. Should we use this as the official project name, or do you have a different name in mind?

> [!IMPORTANT]
> **Q2: MKV support priority.** Should MKV support be deferred entirely to post-MVP, or do you want a "best-effort" approach in the MVP where MKV files containing WebM-compatible codecs (VP8/VP9 + Vorbis/Opus) might work if renamed to `.webm`?

> [!IMPORTANT]
> **Q3: Hosting target.** Are you planning to self-host on a VPS, use Render's free tier, or something else? This affects whether we need a Dockerfile.

> [!IMPORTANT]
> **Q4: Authentication.** The current design has no authentication — anyone with the room link can join. Is that acceptable, or do you want even a simple room password?

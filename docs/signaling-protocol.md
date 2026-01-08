# WebRTC Signaling Protocol

This document describes the signaling protocol used for establishing WebRTC peer-to-peer connections in the file sharing application.

## Overview

The application uses a Cloudflare Durable Object as the signaling server to facilitate WebRTC connection establishment between peers: an **offerer** (sender) and **answerers** (receivers).

### Technology Stack

- **Framework**: [Hono](https://hono.dev/) - Fast web framework for Cloudflare Workers
- **Frontend**: [Vite SSR Components](https://github.com/lideming/vite-ssr-components) - SSR with client-side hydration
- **Rendering**: JSX (Hono JSX for SSR, Hono JSX/DOM for client)
- **WebRTC**: Native browser APIs for P2P data transfer
- **Deployment**: Cloudflare Workers + Durable Objects

## Architecture

The application supports **1:N P2P connections**, where one sender (offerer) can distribute files to multiple receivers (answerers) simultaneously.

### Basic Signaling Flow (1:1 Example)

```
┌─────────────┐         ┌─────────────────────┐         ┌─────────────┐
│   Offerer   │◄───────►│  Durable Object     │◄───────►│  Answerer   │
│  (Sender)   │   WS    │  (Signaling Server) │   WS    │ (Receiver)  │
└─────────────┘         └─────────────────────┘         └─────────────┘
       │                                                       │
       └───────────────── WebRTC P2P ──────────────────────────┘
```

### 1:N Distribution

```
                          ┌─────────────────────┐
                          │  Durable Object     │
                     ┌───►│  (Signaling Server) │◄────┐
                     │    └─────────────────────┘     │
                     │WS                            WS│
┌─────────────┐      │                                │     ┌─────────────┐
│   Offerer   │──────┘                                └─────│ Answerer 1  │
│  (Sender)   │────────────── WebRTC P2P ─────────────────►│ (Receiver)  │
└─────────────┘                                             └─────────────┘
       │                                                     ┌─────────────┐
       └────────────────── WebRTC P2P ─────────────────────►│ Answerer 2  │
                                                             └─────────────┘
```

## Message Types

### Server → Client Messages

| Type | Description | Payload |
|------|-------------|---------|
| `role` | Assigns role to client | `{ role: "offerer" \| "answerer", cid: string }` |
| `peers` | Current peer count in room | `{ count: number }` |
| `wait` | Answerer is in queue | `{ position?: number }` |
| `start` | Begin connection with specific peer | `{ peerId?: string }` |
| `peer-left` | Notifies that a peer disconnected | `{ peerId: string }` |

### Client → Client Messages (via Server Relay)

| Type | Description | Payload |
|------|-------------|---------|
| `offer` | WebRTC SDP offer | `{ from: string, to: string, sid: number, sdp: RTCSessionDescriptionInit }` |
| `answer` | WebRTC SDP answer | `{ from: string, to: string, sid: number, sdp: RTCSessionDescriptionInit }` |
| `candidate` | ICE candidate | `{ from: string, to: string, sid: number, candidate: RTCIceCandidateInit }` |

### Client → Server Messages

| Type | Description | Payload |
|------|-------------|---------|
| `transfer-done` | Notify completion of file transfer to specific peer | `{ peerId: string }` |

## Connection Flow

The server implements a **queue system** to manage concurrent connections. When `maxConcurrent` is set (e.g., 3), only that many answerers can actively transfer at once. Additional answerers wait in queue until a slot becomes available.

### Initial Connection (1:1 Example)

```
Offerer                    Server                    Answerer
   │                         │                          │
   │──── WS Connect ────────►│                          │
   │◄─── role: offerer ──────│                          │
   │◄─── peers: 1 ───────────│                          │
   │                         │                          │
   │                         │◄──── WS Connect ─────────│
   │                         │───── role: answerer ────►│
   │                         │───── wait ──────────────►│
   │◄─── peers: 2 ───────────│───── peers: 2 ─────────►│
   │                         │                          │
   │◄─── start (peerId) ─────│───── start ─────────────►│
   │                         │                          │
   │──── offer (sid:1) ─────►│───── offer (sid:1) ────►│
   │                         │                          │
   │◄─── answer (sid:1) ─────│◄──── answer (sid:1) ────│
   │                         │                          │
   │◄───► candidate ◄───────►│◄────► candidate ◄──────►│
   │                         │                          │
   ├─────────── WebRTC P2P Connection ─────────────────┤
   │                         │                          │
   │ (transfer complete)     │                          │
   │──── transfer-done ─────►│                          │
```

### 1:N with Queue (maxConcurrent = 2)

```
Offerer            Server           Answerer 1       Answerer 2       Answerer 3
   │                 │                   │                │                │
   │─── connect ────►│                   │                │                │
   │◄── role ────────│                   │                │                │
   │                 │◄─── connect ──────│                │                │
   │                 │──── role ────────►│                │                │
   │                 │──── wait ────────►│                │                │
   │                 │◄─── connect ──────┼────────────────│                │
   │                 │──── role ──────────────────────────►│                │
   │                 │──── wait ──────────────────────────►│                │
   │                 │◄─── connect ──────┼────────────────┼────────────────│
   │                 │──── role ──────────────────────────────────────────►│
   │                 │──── wait ──────────────────────────────────────────►│
   │                 │                   │                │                │
   │◄── start (A1) ──│─── start ────────►│                │                │
   │◄── start (A2) ──│─── start ──────────────────────────►│                │
   │                 │                   │                │                │
   │   (A3 waits in queue)              │                │                │
   │                 │                   │                │                │
   │ (P2P with A1)  │ (P2P with A2)    │                │                │
   │                 │                   │                │                │
   │─ transfer-done(A1) ──►│             │                │                │
   │◄── start (A3) ──│─── start ──────────────────────────────────────────►│
   │                 │                   │                │                │
   │ (P2P with A3)  │                   │                │                │
```

## Session ID (sid)

The `sid` (session ID) is used to prevent stale messages from being processed during reconnection scenarios:

- Incremented by offerer for each new offer
- Must match in offer/answer/candidate messages
- Messages with mismatched sid are ignored

## Key State Variables

### Server-side State (Room Durable Object)

| Variable | Type | Description |
|----------|------|-------------|
| `config` | `RoomConfig` | Room configuration including `maxConcurrent` |
| `SocketAttachment.role` | `"offerer" \| "answerer"` | Client role |
| `SocketAttachment.state` | `"waiting" \| "active" \| "done"` | Answerer state in queue |
| `SocketAttachment.cid` | `string` | Client ID (persistent across page reloads) |
| `SocketAttachment.joinedAt` | `number` | Timestamp for queue ordering |

### Client-side State (Offerer)

| Variable | Type | Description |
|----------|------|-------------|
| `roleRef` | `"offerer" \| "answerer" \| null` | Assigned role |
| `peersRef` | `number` | Current peer count |
| `offererPeersRef` | `Map<string, OffererPeer>` | Map of peerId → peer connection state |
| `OffererPeer.pc` | `RTCPeerConnection` | WebRTC peer connection |
| `OffererPeer.dc` | `RTCDataChannel \| null` | Data channel for file transfer |
| `OffererPeer.signalSid` | `number` | Session ID for signaling |

### Client-side State (Answerer)

| Variable | Type | Description |
|----------|------|-------------|
| `roleRef` | `"offerer" \| "answerer" \| null` | Assigned role |
| `peersRef` | `number` | Current peer count |
| `pcRef` | `RTCPeerConnection \| null` | Current peer connection |
| `dcRef` | `RTCDataChannel \| null` | Current data channel |
| `activeSidRef` | `number \| null` | Current session ID |

## Queue Management

### Slot Allocation Algorithm

The `fillSlots()` function manages concurrent connections:

1. **Count active connections**: Count answerers with `state === "active"`
2. **Calculate available slots**: `maxConcurrent - activeCount`
3. **Select waiting answerers**: Sort by `joinedAt` timestamp (FIFO)
4. **Activate next in queue**: Send `start` to both answerer and offerer

### When fillSlots() is Called

- When a new answerer joins
- When an answerer disconnects (`webSocketClose`)
- When offerer signals `transfer-done` for a peer

### State Transitions

```
Answerer joins → waiting
fillSlots() with available slot → active
transfer completes → done
fillSlots() called → next waiting → active
```

## Data Channel

Once WebRTC connection is established:
- Channel name: `"file"`
- Ordered delivery: `true`
- Binary type: `arraybuffer`

### File Transfer Protocol

```
Sender                                    Receiver
   │                                          │
   │──── { type: "meta", name, size, ... } ──►│
   │                                          │
   │──── [binary chunk 1] ───────────────────►│
   │──── [binary chunk 2] ───────────────────►│
   │──── ...                                  │
   │                                          │
   │──── { type: "done" } ───────────────────►│
```

#### Metadata Message

```typescript
{
  type: "meta",
  name: string,        // File name
  size: number,        // File size in bytes
  mime: string,        // MIME type
  encrypted: boolean   // Whether chunks are encrypted
}
```

### End-to-End Encryption (Optional)

When encryption is enabled:

1. **Key Exchange**: 256-bit AES key shared via URL hash fragment (`#k=base64url`)
2. **Algorithm**: AES-GCM for authenticated encryption
3. **Chunk Format**: `[12-byte IV][encrypted data]`
4. **Key Properties**:
   - Never sent to server (hash fragment not transmitted in HTTP)
   - Unique per room session
   - Base64url-encoded for URL safety

**Note**: Server never sees the encryption key or decrypted content. All encryption/decryption happens client-side.

## Error Handling

### PeerConnection State Changes

| State | Action |
|-------|--------|
| `connected` | Cancel reconnection timer, update status |
| `disconnected` | Arm reconnection timer (answerer), log event (offerer) |
| `failed` | Reset PeerConnection, attempt reconnection |

### Stale Event Filtering

**Offerer**: PeerConnection event handlers check that the `pc` instance exists in `offererPeersRef.current` Map to ignore events from removed connections.

**Answerer**: Event handlers check `pcRef.current === pc` to ignore events from old/replaced connections.

### Duplicate Connection Prevention

When a client reconnects with the same `cid` (Client ID):
- Server closes existing WebSocket with that `cid`
- New connection replaces the old one
- Prevents duplicate connections from same user (e.g., after page reload)

## Files

### Server-side

| File | Description |
|------|-------------|
| `src/index.tsx` | Hono router, routes to Durable Object |
| `src/room.ts` | Durable Object (signaling server) |

### Client-side

| File | Description |
|------|-------------|
| `src/client/room.tsx` | WebRTC connection logic and file transfer |
| `src/client/home.tsx` | Home page interactive logic (room creation/join) |

### UI Components (SSR)

| File | Description |
|------|-------------|
| `src/ui/layout.tsx` | Layout shell component |
| `src/ui/top.tsx` | Top page UI template |
| `src/ui/room.tsx` | Room page UI template |

# WebRTC Signaling Protocol

This document describes the signaling protocol used for establishing WebRTC peer-to-peer connections in the file sharing application.

## Overview

The application uses a Cloudflare Durable Object as the signaling server to facilitate WebRTC connection establishment between two peers: an **offerer** (sender) and an **answerer** (receiver).

## Architecture

```
┌─────────────┐         ┌─────────────────────┐         ┌─────────────┐
│   Offerer   │◄───────►│  Durable Object     │◄───────►│  Answerer   │
│  (Sender)   │   WS    │  (Signaling Server) │   WS    │ (Receiver)  │
└─────────────┘         └─────────────────────┘         └─────────────┘
       │                                                       │
       └───────────────── WebRTC P2P ──────────────────────────┘
```

## Message Types

### Server → Client Messages

| Type | Description | Payload |
|------|-------------|---------|
| `role` | Assigns role to client | `{ role: "offerer" \| "answerer" }` |
| `peers` | Current peer count in room | `{ count: number }` |
| `peer-left` | Notifies that the other peer disconnected | none |
| `room-full` | Room is at capacity (2 peers) | none |

### Client → Client Messages (via Server Relay)

| Type | Description | Payload |
|------|-------------|---------|
| `request-ready` | Offerer requests answerer readiness | none |
| `ready` | Answerer confirms readiness | none |
| `offer` | WebRTC SDP offer | `{ sid: number, sdp: RTCSessionDescriptionInit }` |
| `answer` | WebRTC SDP answer | `{ sid: number, sdp: RTCSessionDescriptionInit }` |
| `candidate` | ICE candidate | `{ sid: number, candidate: RTCIceCandidateInit }` |

## Connection Flow

### Initial Connection

```
Offerer                    Server                    Answerer
   │                         │                          │
   │──── WS Connect ────────►│                          │
   │◄─── role: offerer ──────│                          │
   │◄─── peers: 1 ───────────│                          │
   │                         │                          │
   │                         │◄──── WS Connect ─────────│
   │                         │───── role: answerer ────►│
   │◄─── peers: 2 ───────────│───── peers: 2 ─────────►│
   │                         │                          │
   │──── request-ready ─────►│───── request-ready ────►│
   │                         │                          │
   │◄─── ready ──────────────│◄──── ready ─────────────│
   │                         │                          │
   │──── offer (sid:1) ─────►│───── offer (sid:1) ────►│
   │                         │                          │
   │◄─── answer (sid:1) ─────│◄──── answer (sid:1) ────│
   │                         │                          │
   │◄───► candidate ◄───────►│◄────► candidate ◄──────►│
   │                         │                          │
   ├─────────── WebRTC P2P Connection ─────────────────┤
```

### Reconnection (Answerer Reloads)

```
Offerer                    Server                    Answerer
   │                         │                          │
   │ (connected)             │                (reload)  X
   │                         │                          │
   │◄─── peer-left ──────────│                          │
   │◄─── peers: 1 ───────────│                          │
   │                         │                          │
   │  (reset PeerConnection) │◄──── WS Connect ─────────│
   │  (awaitingPeer = true)  │───── role: answerer ────►│
   │                         │                          │
   │◄─── peers: 2 ───────────│───── peers: 2 ─────────►│
   │                         │                          │
   │──── request-ready ─────►│───── request-ready ────►│
   │                         │                          │
   │◄─── ready ──────────────│◄──── ready ─────────────│
   │                         │                          │
   │──── offer (sid:2) ─────►│───── offer (sid:2) ────►│
   │                         │                          │
   │◄─── answer (sid:2) ─────│◄──── answer (sid:2) ────│
   │                         │                          │
   ├─────────── WebRTC P2P Reconnected ────────────────┤
```

## Session ID (sid)

The `sid` (session ID) is used to prevent stale messages from being processed during reconnection scenarios:

- Incremented by offerer for each new offer
- Must match in offer/answer/candidate messages
- Messages with mismatched sid are ignored

## Key State Variables

### Client-side References

| Variable | Type | Description |
|----------|------|-------------|
| `roleRef` | `"offerer" \| "answerer" \| null` | Assigned role |
| `peersRef` | `number` | Current peer count |
| `awaitingPeerRef` | `boolean` | Waiting for peer to join/rejoin |
| `peerReadyRef` | `boolean` | Whether answerer has signaled ready |
| `pcRef` | `RTCPeerConnection \| null` | Current peer connection |
| `dcRef` | `RTCDataChannel \| null` | Current data channel |
| `activeSidRef` | `number \| null` | Current session ID |

## Timing Considerations

### The Ready Handshake Problem

When a peer reconnects, there's a race condition:
1. Server broadcasts `peers: 2` immediately when new socket connects
2. But the new client's WebSocket `onmessage` handler may not be set up yet

**Solution**: The `request-ready` / `ready` handshake ensures:
1. Offerer sends `request-ready` only after its handler is ready
2. Answerer responds with `ready` only after receiving `request-ready`
3. Offerer sends `offer` only after receiving `ready`

This guarantees the answerer's WebSocket handler is fully initialized before receiving the offer.

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

## Error Handling

### PeerConnection State Changes

| State | Action |
|-------|--------|
| `connected` | Cancel reconnection timer, update status |
| `disconnected` | Arm reconnection timer |
| `failed` | Reset PeerConnection, attempt reconnection |

### Stale Event Filtering

All PeerConnection event handlers check `pcRef.current === pc` to ignore events from old/replaced connections.

## Files

| File | Description |
|------|-------------|
| `src/room.ts` | Server-side Durable Object (signaling server) |
| `src/client/room.tsx` | Client-side WebRTC logic and UI |
| `src/index.tsx` | Hono router, routes to Durable Object |

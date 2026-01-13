# Pairlane

[日本語](./README.ja.md) | [中文](./README.zh.md)

**Live Demo: https://getpairlane.com/**

A P2P file sharing tool using WebRTC. Transfer files directly between browsers without going through a server.

## Features

- **P2P Transfer**: Files are sent directly between browsers, not through a server
- **E2E Encryption (Optional)**: AES-GCM encryption with key in URL fragment (`#k=...`), never sent to server
- **Serverless**: Runs on Cloudflare Workers + Durable Objects, no file storage on server
- **Multiple Receivers**: One sender can transfer to multiple receivers simultaneously (configurable concurrency)
- **Drag & Drop**: File selection UI supports drag and drop

## How It Works

1. Sender creates a room
2. Share the link (or room code) with receivers
3. Receivers join the room
4. Sender selects a file and sends
5. P2P transfer via WebRTC DataChannel

## Tech Stack

- [Hono](https://hono.dev/) - Lightweight web framework
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge computing
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) - WebSocket signaling
- [Vite](https://vite.dev/) - SSR-enabled build tool
- WebRTC - P2P data transfer

## CLI

Send and receive files directly from your terminal. Works with browsers and other terminals.

### Quick Start

```sh
# Send a file
npx pairlane send /path/to/file

# Receive a file
npx pairlane receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

### Encryption

Encryption is enabled by default. The `send` command prints a room URL with `#k=...` that you can share:

```sh
npx pairlane send /path/to/file
# → Share the printed URL: https://getpairlane.com/r/<ROOM_ID>#k=<KEY>

npx pairlane receive "https://getpairlane.com/r/<ROOM_ID>#k=<KEY>"
```

To disable encryption, pass `--no-encrypt`.

### Options

| Option | Description |
|--------|-------------|
| `--output-dir` | Directory to save received files |
| `--key <KEY>` | Provide decryption key explicitly (base64url) |
| `--stay-open` | Keep running after transfer for additional transfers |
| `--no-encrypt` | Disable encryption for send |

### Custom Endpoint

By default, the CLI connects to `https://getpairlane.com`. Override with:

```sh
PAIRLANE_ENDPOINT=https://your-server.com npx pairlane send /path/to/file
```

### Supported Platforms

- **Linux** (x86_64)
- **macOS** (Intel / Apple Silicon)

### Build from Source

```sh
cd cli
cargo run --release -- send /path/to/file
cargo run --release -- receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

## Prerequisites

- [Bun](https://bun.sh/) runtime

## Development

```sh
bun install
bun run dev
```

Vite dev server runs SSR on `http://localhost:5173`.

## Build

```sh
bun run build
```

## Deploy

```sh
bun run deploy
```

## Generate Cloudflare Types

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
bun run cf-typegen
```

## Bindings Configuration

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.tsx
type Bindings = CloudflareBindings & { ROOM: DurableObjectNamespace }
const app = new Hono<{ Bindings: Bindings }>()
```

## License

MIT

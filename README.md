# Pairlane

[日本語](./README.ja.md) | [中文](./README.zh.md)

**Live Demo: https://share-files.karakuri-maker.com/**

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

## CLI (Rust)

The `cli/` directory contains a Rust-based CLI that can send or receive files using the same WebRTC signaling flow, enabling browser ⇄ terminal and terminal ⇄ terminal transfers.

### Supported Platforms

- **Linux** (x86_64)
- **macOS** (Intel / Apple Silicon)

Builds are automatically tested via GitHub Actions on push/PR to the `cli/` directory.

### Quick Start (npx)

```sh
npx pairlane send /path/to/file
npx pairlane receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

### Build from source

```sh
cd cli
cargo run --release -- send /path/to/file
cargo run --release -- receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

Encrypted transfers are enabled by default for `send`. The command prints a room URL with `#k=...` that you can pass directly to `receive`:

```sh
npx pairlane send /path/to/file
npx pairlane receive "https://share-files.karakuri-maker.com/r/ROOM#k=..."
```

To disable encryption for `send`, pass `--no-encrypt`.

If you want to provide the decryption key explicitly, pass `--key` (base64url) to `receive`:

```sh
npx pairlane receive <ROOM_ID> --key <BASE64URL_KEY> --output-dir ./downloads
```

By default, `send` and `receive` exit after a successful transfer. Use `--stay-open` to keep the process running for additional transfers.

Note: URLs with `#k=...` should be quoted in the shell. Legacy flags `--file` and `--room-id` are still accepted.

By default it connects to the demo endpoint. Override it with the `PAIRLANE_ENDPOINT` environment variable (legacy `SHARE_FILES_ENDPOINT` also supported):

```sh
PAIRLANE_ENDPOINT=https://share-files.karakuri-maker.com \
  npx pairlane send /path/to/file
```

You can also provide `--room-id` explicitly if you want to join an existing room.

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

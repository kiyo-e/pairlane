---
name: pairlane
description: "Use the Pairlane CLI through npx pairlane for peer-to-peer file transfers. Trigger when Codex needs to send or receive files with Pairlane, create or join a Pairlane room, run a transfer against getpairlane.com or a custom endpoint, explain Pairlane CLI syntax, verify CLI behavior, or troubleshoot Pairlane send/receive command output."
---

# Pairlane

## Overview

Use Pairlane as an executable CLI tool. Prefer `npx -y pairlane` for user-facing operation and verification.

Pairlane transfers file bytes peer-to-peer over WebRTC. The service endpoint creates rooms and coordinates signaling; file contents are not uploaded for storage.

## Workflow

1. Use help output when syntax is uncertain:

```sh
npx -y pairlane --help
npx -y pairlane send --help
npx -y pairlane receive --help
```

2. Run `send` and `receive` in long-lived terminal sessions because each side waits for a peer.
3. Keep the sender session open until the receiver connects and the transfer completes.
4. Treat room URLs containing `#k=` as secret-bearing transfer links. Share them only where the user intends.
5. If `npx` needs network access and the environment blocks it, request approval for the `npx` command.

## Commands

Create a room and send a file:

```sh
npx -y pairlane send /path/to/file
```

Receive from a room URL:

```sh
npx -y pairlane receive "https://getpairlane.com/r/ROOM_ID#k=KEY" --output-dir ./downloads
```

Receive from a room ID when encryption is disabled:

```sh
npx -y pairlane receive ROOM_ID --output-dir ./downloads
```

Send to an existing room or URL:

```sh
npx -y pairlane send /path/to/file "ROOM_ID_OR_URL"
```

Disable encryption only when requested:

```sh
npx -y pairlane send /path/to/file --no-encrypt
```

Keep a sender or receiver open for additional transfers:

```sh
npx -y pairlane send /path/to/file --stay-open
npx -y pairlane receive "ROOM_ID_OR_URL" --output-dir ./downloads --stay-open
```

Use a custom endpoint:

```sh
npx -y pairlane send /path/to/file --endpoint https://your-server.example
npx -y pairlane receive "ROOM_ID_OR_URL" --endpoint https://your-server.example --output-dir ./downloads
```

Use an endpoint through the environment:

```sh
PAIRLANE_ENDPOINT=https://your-server.example npx -y pairlane send /path/to/file
PAIRLANE_ENDPOINT=https://your-server.example npx -y pairlane receive "ROOM_ID_OR_URL" --output-dir ./downloads
```

## Transfer Checks

For a full CLI transfer check:

1. Start the sender and capture the printed `[room] url`.
2. Start the receiver with that URL and a chosen `--output-dir`.
3. Wait for both commands to report completion.
4. Compare file size or checksum when the user needs proof of integrity.

Capture these details in the final answer:

- Exact commands run.
- Endpoint used.
- Room ID or redacted room URL when a key is present.
- Sender and receiver completion lines.
- Saved output path for received files.

## Troubleshooting

- `binary not found`: reinstall or rerun `npx -y pairlane`; the npm package downloads the platform binary during install.
- Room role error on `send`: the sender must connect before receivers unless sending to an existing sender-created room.
- Room role error on `receive`: connect after the sender has created the room.
- WebSocket connection failure: check the endpoint, network access, and whether the endpoint supports Pairlane signaling routes.
- Decryption failure: verify that the URL fragment key (`#k=...`) or `--key` value matches the sender key.
- File write failure: verify `--output-dir` exists or can be created by the current user.

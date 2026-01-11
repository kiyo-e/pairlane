# Pairlane

[English](./README.md) | [日本語](./README.ja.md)

**在线演示: https://share-files.karakuri-maker.com/**

基于WebRTC的P2P文件共享工具。无需经过服务器，直接在浏览器之间传输文件。

## 特点

- **P2P传输**: 文件直接在浏览器之间发送，不经过服务器
- **端到端加密（可选）**: 使用URL片段中的密钥（`#k=...`）进行AES-GCM加密，密钥永不发送到服务器
- **无服务器**: 运行在Cloudflare Workers + Durable Objects上，服务器不存储任何文件
- **多接收者**: 一个发送者可以同时向多个接收者传输（可配置并发数）
- **拖放支持**: 文件选择界面支持拖放操作

## 工作流程

1. 发送者创建房间
2. 将链接（或房间代码）分享给接收者
3. 接收者加入房间
4. 发送者选择文件并发送
5. 通过WebRTC DataChannel进行P2P传输

## 技术栈

- [Hono](https://hono.dev/) - 轻量级Web框架
- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) - WebSocket信令
- [Vite](https://vite.dev/) - 支持SSR的构建工具
- WebRTC - P2P数据传输

## CLI (Rust)

`cli/` 目录包含一个Rust编写的CLI工具，使用相同的WebRTC信令流程发送和接收文件，支持浏览器⇄终端和终端⇄终端的传输。

### 支持的平台

- **Linux** (x86_64)
- **macOS** (Intel / Apple Silicon)

通过GitHub Actions，在向 `cli/` 目录push/PR时自动测试构建。

### npx快速开始

```sh
npx pairlane send /path/to/file
npx pairlane receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

### 从源码构建

```sh
cd cli
cargo run --release -- send /path/to/file
cargo run --release -- receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

`send` 默认启用加密。`send` 输出的带有 `#k=...` 的URL可以直接传给 `receive`：

```sh
npx pairlane send /path/to/file
npx pairlane receive "https://share-files.karakuri-maker.com/r/ROOM#k=..."
```

要禁用加密，请使用 `--no-encrypt`。

如需显式指定解密密钥，请向 `receive` 传递 `--key`（base64url编码）：

```sh
npx pairlane receive <ROOM_ID> --key <BASE64URL_KEY> --output-dir ./downloads
```

默认情况下，`send` 和 `receive` 在传输成功后会退出。如需保持运行以进行更多传输，请使用 `--stay-open`。

※ 包含 `#k=...` 的URL在shell中需要用引号包裹。传统的 `--file` / `--room-id` 参数仍然可用。

默认连接到演示环境。可通过 `PAIRLANE_ENDPOINT` 环境变量覆盖（旧 `SHARE_FILES_ENDPOINT` 也可用）：

```sh
PAIRLANE_ENDPOINT=https://share-files.karakuri-maker.com \
  npx pairlane send /path/to/file
```

如需加入现有房间，请显式指定 `--room-id`。

## 环境要求

- [Bun](https://bun.sh/) 运行时

## 开发

```sh
bun install
bun run dev
```

Vite开发服务器在 `http://localhost:5173` 运行SSR。

## 构建

```sh
bun run build
```

## 部署

```sh
bun run deploy
```

## 生成Cloudflare类型

[根据Worker配置生成/同步类型](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
bun run cf-typegen
```

## Bindings配置

实例化`Hono`时将`CloudflareBindings`作为泛型传入:

```ts
// src/index.tsx
type Bindings = CloudflareBindings & { ROOM: DurableObjectNamespace }
const app = new Hono<{ Bindings: Bindings }>()
```

## 许可证

MIT

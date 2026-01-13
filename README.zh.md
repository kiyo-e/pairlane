# Pairlane

[English](./README.md) | [日本語](./README.ja.md)

**在线演示: https://getpairlane.com/**

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

## CLI

直接从终端发送和接收文件。支持与浏览器和其他终端之间的传输。

### 快速开始

```sh
# 发送文件
npx pairlane send /path/to/file

# 接收文件
npx pairlane receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

### 加密

加密默认启用。`send` 命令会输出带有 `#k=...` 的URL，可以直接分享：

```sh
npx pairlane send /path/to/file
# → 分享输出的URL: https://getpairlane.com/r/<ROOM_ID>#k=<KEY>

npx pairlane receive "https://getpairlane.com/r/<ROOM_ID>#k=<KEY>"
```

要禁用加密，请使用 `--no-encrypt`。

### 选项

| 选项 | 说明 |
|------|------|
| `--output-dir` | 接收文件的保存目录 |
| `--key <KEY>` | 显式指定解密密钥（base64url） |
| `--stay-open` | 传输后保持运行以进行更多传输 |
| `--no-encrypt` | 禁用发送时的加密 |

### 自定义端点

默认连接到 `https://getpairlane.com`。可通过环境变量覆盖：

```sh
PAIRLANE_ENDPOINT=https://your-server.com npx pairlane send /path/to/file
```

### 支持的平台

- **Linux** (x86_64)
- **macOS** (Intel / Apple Silicon)

### 从源码构建

```sh
cd cli
cargo run --release -- send /path/to/file
cargo run --release -- receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

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

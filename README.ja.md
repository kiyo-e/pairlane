# Pairlane

[English](./README.md) | [中文](./README.zh.md)

**デモサイト: https://getpairlane.com/**

WebRTCを使ったP2Pファイル共有ツール。サーバーを経由せずブラウザ間で直接ファイルを転送します。

## 特徴

- **P2P転送**: ファイルはサーバーを経由せず、ブラウザ間で直接送受信
- **E2E暗号化（オプション）**: リンクの`#k=...`部分に鍵を含めることで、サーバーに鍵を送らずにAES-GCM暗号化
- **サーバーレス**: Cloudflare Workers + Durable Objectsで動作、ファイルはサーバーに保存されない
- **複数受信者対応**: 1人の送信者から複数人が同時にファイルを受信可能（同時接続数は設定可能）
- **ドラッグ＆ドロップ**: ファイル選択UIはドラッグ＆ドロップに対応

## 動作の流れ

1. 送信者がルームを作成
2. リンク（またはルームコード）を受信者に共有
3. 受信者がルームに参加
4. 送信者がファイルを選択して送信
5. WebRTC DataChannelでP2P転送

## 技術スタック

- [Hono](https://hono.dev/) - 軽量Webフレームワーク
- [Cloudflare Workers](https://workers.cloudflare.com/) - エッジコンピューティング
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) - WebSocketシグナリング
- [Vite](https://vite.dev/) - SSR対応ビルドツール
- WebRTC - P2Pデータ転送

## CLI

ターミナルから直接ファイルを送受信できます。ブラウザや他のターミナルとの転送に対応。

### クイックスタート

```sh
# ファイルを送信
npx pairlane send /path/to/file

# ファイルを受信
npx pairlane receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

### 暗号化

暗号化はデフォルトで有効です。`send` コマンドは `#k=...` 付きのURLを出力するので、それを共有してください：

```sh
npx pairlane send /path/to/file
# → 出力されたURLを共有: https://getpairlane.com/r/<ROOM_ID>#k=<KEY>

npx pairlane receive "https://getpairlane.com/r/<ROOM_ID>#k=<KEY>"
```

暗号化を無効にするには `--no-encrypt` を指定します。

### オプション

| オプション | 説明 |
|-----------|------|
| `--output-dir` | 受信ファイルの保存先ディレクトリ |
| `--key <KEY>` | 復号鍵を明示的に指定（base64url） |
| `--stay-open` | 転送後も継続して待機 |
| `--no-encrypt` | 送信時の暗号化を無効化 |

### カスタムエンドポイント

デフォルトでは `https://getpairlane.com` に接続します。変更するには：

```sh
PAIRLANE_ENDPOINT=https://your-server.com npx pairlane send /path/to/file
```

### 対応プラットフォーム

- **Linux** (x86_64)
- **macOS** (Intel / Apple Silicon)

### ソースからビルド

```sh
cd cli
cargo run --release -- send /path/to/file
cargo run --release -- receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

## 必要環境

- [Bun](https://bun.sh/) ランタイム

## 開発

```sh
bun install
bun run dev
```

Vite開発サーバーが `http://localhost:5173` でSSRを実行します。

## ビルド

```sh
bun run build
```

## デプロイ

```sh
bun run deploy
```

## Cloudflare型生成

[Worker設定に基づいて型を生成/同期するには](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
bun run cf-typegen
```

## Bindings設定

`Hono`のインスタンス化時に`CloudflareBindings`をジェネリクスとして渡します:

```ts
// src/index.tsx
type Bindings = CloudflareBindings & { ROOM: DurableObjectNamespace }
const app = new Hono<{ Bindings: Bindings }>()
```

## ライセンス

MIT

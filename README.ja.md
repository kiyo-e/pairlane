# Pairlane

[English](./README.md) | [中文](./README.zh.md)

**デモサイト: https://share-files.karakuri-maker.com/**

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

## CLI (Rust)

`cli/` ディレクトリに Rust 製のCLIを用意しています。ブラウザ⇄ターミナル、ターミナル⇄ターミナルの転送に対応します。

### 対応プラットフォーム

- **Linux** (x86_64)
- **macOS** (Intel / Apple Silicon)

GitHub Actionsにより、`cli/` ディレクトリへのpush/PR時にビルドが自動テストされます。

### npxで実行

```sh
npx pairlane send /path/to/file
npx pairlane receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

### ソースからビルド

```sh
cd cli
cargo run --release -- send /path/to/file
cargo run --release -- receive <ROOM_ID_OR_URL> --output-dir ./downloads
```

暗号化は `send` のデフォルトです。`send` が出力する `#k=...` 付きのURLを、そのまま `receive` に渡せます。

```sh
npx pairlane send /path/to/file
npx pairlane receive "https://share-files.karakuri-maker.com/r/ROOM#k=..."
```

暗号化を無効にする場合は `--no-encrypt` を指定してください。

復号鍵を明示したい場合は `receive` に `--key`（base64url）を渡します。

```sh
npx pairlane receive <ROOM_ID> --key <BASE64URL_KEY> --output-dir ./downloads
```

デフォルトでは、`send` と `receive` は転送成功後に終了します。継続して待ちたい場合は `--stay-open` を指定してください。

※ `#k=...` を含むURLはシェルでクォートしてください。従来の `--file` / `--room-id` も引き続き利用できます。

デフォルトではデモ環境へ接続します。`PAIRLANE_ENDPOINT` 環境変数で上書きできます（旧 `SHARE_FILES_ENDPOINT` も利用可）。

```sh
PAIRLANE_ENDPOINT=https://share-files.karakuri-maker.com \
  npx pairlane send /path/to/file
```

既存ルームに参加したい場合は `--room-id` を明示指定してください。

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

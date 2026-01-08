/**
 * Top page UI for share-files.
 * See README.md for the user flow; pairs with RoomPage and the home script.
 */

import { Script } from "vite-ssr-components/hono";
import { Layout } from "./layout";

export function TopPage() {
  return (
    <Layout
      title="SHARE-FILES"
      scripts={<Script src="/src/client/home.tsx" />}
    >
      <section id="homeView" class="card home">
        <div class="homeGrid">
          <div class="homeHero">
            <div class="eyebrow">DIRECT—PRIVATE—INSTANT</div>
            <h1>ファイルを<br />直接送る</h1>
            <p class="lead">
              サーバにアップロードせず、端末間で直接転送。接続の取り次ぎだけサーバを使います。
            </p>
            <div class="heroChips">
              <span class="chip">NO SERVER STORAGE</span>
              <span class="chip">1:N P2P</span>
              <span class="chip">WEBRTC</span>
            </div>
            <div class="steps">
              <div class="step"><span>1</span> ルーム作成</div>
              <div class="step"><span>2</span> リンク共有</div>
              <div class="step"><span>3</span> 送信</div>
            </div>
          </div>

          <div class="homePanel">
            <div class="panelBlock">
              <div class="panelTitle">送信を開始</div>
            <label class="toggle">
              <input id="encryptToggle" type="checkbox" checked />
              <span>E2E暗号化ON</span>
            </label>
            <label class="row gap">
              <span class="muted small">同時送信上限</span>
              <input id="maxConcurrent" class="input" type="number" min="1" max="10" value="3" />
            </label>
            <button id="createBtn" class="btn primary">ルーム作成</button>
          </div>

            <hr class="sep" />

            <div class="panelBlock">
              <div class="panelTitle">受信に参加</div>
              <div class="row gap wrap">
                <input id="joinCode" class="input" placeholder="コード入力（例: ABCD...）" />
                <button id="joinBtn" class="btn">参加</button>
              </div>
              <p class="muted small">
                暗号化ONならリンクに鍵が含まれます。
              </p>
            </div>
          </div>
        </div>

        <div class="foot muted">
          P2Pのみ。ネットワーク条件によっては接続不可
        </div>
      </section>
    </Layout>
  );
}

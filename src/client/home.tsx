/** @jsxImportSource hono/jsx/dom */
/**
 * Home client app for share-files.
 * See README.md; pairs with src/ui/top.tsx.
 */

import { render, useCallback, useState } from "hono/jsx/dom";

const root = document.querySelector("main.container");
if (root && document.getElementById("homeView")) {
  render(<HomeApp />, root);
}

function HomeApp() {
  const [encryptEnabled, setEncryptEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(3);

  const handleEncryptToggle = useCallback((ev: Event) => {
    const target = ev.currentTarget as HTMLInputElement;
    setEncryptEnabled(target.checked);
  }, []);

  const handleJoinInput = useCallback((ev: Event) => {
    const target = ev.currentTarget as HTMLInputElement;
    setJoinCode(target.value);
  }, []);

  const handleMaxConcurrentInput = useCallback((ev: Event) => {
    const target = ev.currentTarget as HTMLInputElement;
    const next = Number.parseInt(target.value, 10);
    if (Number.isFinite(next)) {
      setMaxConcurrent(Math.max(1, Math.min(10, next)));
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { roomId } = await apiCreateRoom({ maxConcurrent });
      if (encryptEnabled) {
        const rawKey = crypto.getRandomValues(new Uint8Array(32));
        const k = b64urlEncode(rawKey);
        location.href = `/r/${roomId}#k=${k}`;
      } else {
        location.href = `/r/${roomId}`;
      }
    } finally {
      setBusy(false);
    }
  }, [busy, encryptEnabled]);

  const handleJoin = useCallback(() => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    location.href = `/r/${code}${location.hash || ""}`;
  }, [joinCode]);

  return (
    <section id="homeView" class="card home">
      <div class="homeGrid">
        <div class="homeHero">
          <div class="eyebrow">DIRECT—PRIVATE—INSTANT</div>
          <h1>
            ファイルを<br />直接送る
          </h1>
          <p class="lead">
            サーバにアップロードせず、端末間で直接転送。接続の取り次ぎだけサーバを使います。
          </p>
          <div class="heroChips">
            <span class="chip">NO SERVER STORAGE</span>
            <span class="chip">1:N P2P</span>
            <span class="chip">WEBRTC</span>
          </div>
          <div class="steps">
            <div class="step">
              <span>1</span> ルーム作成
            </div>
            <div class="step">
              <span>2</span> リンク共有
            </div>
            <div class="step">
              <span>3</span> 送信
            </div>
          </div>
        </div>

        <div class="homePanel">
          <div class="panelBlock">
            <div class="panelTitle">送信を開始</div>
            <label class="toggle">
              <input
                id="encryptToggle"
                type="checkbox"
                checked={encryptEnabled}
                disabled={busy}
                onInput={handleEncryptToggle}
              />
              <span>E2E暗号化ON</span>
            </label>
            <label class="row gap">
              <span class="muted small">同時送信上限</span>
              <input
                id="maxConcurrent"
                class="input"
                type="number"
                min="1"
                max="10"
                value={String(maxConcurrent)}
                disabled={busy}
                onInput={handleMaxConcurrentInput}
              />
            </label>
            <button id="createBtn" class="btn primary" disabled={busy} onClick={handleCreate}>
              ルーム作成
            </button>
          </div>

          <hr class="sep" />

          <div class="panelBlock">
            <div class="panelTitle">受信に参加</div>
            <div class="row gap wrap">
              <input
                id="joinCode"
                class="input"
                placeholder="コード入力（例: ABCD...）"
                value={joinCode}
                disabled={busy}
                onInput={handleJoinInput}
              />
              <button id="joinBtn" class="btn" disabled={busy} onClick={handleJoin}>
                参加
              </button>
            </div>
            <p class="muted small">暗号化ONならリンクに鍵が含まれます。</p>
          </div>
        </div>
      </div>

      <div class="foot muted">P2Pのみ。ネットワーク条件によっては接続不可（TURN無し）</div>
    </section>
  );
}

async function apiCreateRoom(body: { maxConcurrent: number }): Promise<{ roomId: string }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("ルーム作成に失敗しました");
  return res.json();
}

function b64urlEncode(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @jsxImportSource hono/jsx/dom */
/**
 * Home client app for Pairlane.
 * See README.md; pairs with src/ui/top.tsx.
 */

import { render, useCallback, useState } from "hono/jsx/dom";
import { getT } from "../i18n/client";

const creatorCid = getClientId();
const t = getT();

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
      const { roomId } = await apiCreateRoom({ maxConcurrent, creatorCid });
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
          <div class="eyebrow">{t.home.eyebrow}</div>
          <h1 dangerouslySetInnerHTML={{ __html: t.home.heroTitle }} />
          <p class="lead">{t.home.heroLead}</p>
          <div class="heroChips">
            <span class="chip">NO SERVER STORAGE</span>
            <span class="chip">1:N P2P</span>
            <span class="chip">WEBRTC</span>
          </div>
          <div class="steps">
            <div class="step">
              <span>1</span> {t.home.step1}
            </div>
            <div class="step">
              <span>2</span> {t.home.step2}
            </div>
            <div class="step">
              <span>3</span> {t.home.step3}
            </div>
          </div>
        </div>

        <div class="homePanel">
          <div class="panelBlock">
            <div class="panelTitle">{t.home.sendTitle}</div>
            <label class="toggle">
              <input
                id="encryptToggle"
                type="checkbox"
                checked={encryptEnabled}
                disabled={busy}
                onInput={handleEncryptToggle}
              />
              <span>{t.home.encryptOn}</span>
            </label>
            <label class="row gap">
              <span class="muted small">{t.home.maxConcurrent}</span>
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
              {t.home.createRoom}
            </button>
          </div>

          <hr class="sep" />

          <div class="panelBlock">
            <div class="panelTitle">{t.home.receiveTitle}</div>
            <div class="row gap wrap">
              <input
                id="joinCode"
                class="input"
                placeholder={t.home.codePlaceholder}
                value={joinCode}
                disabled={busy}
                onInput={handleJoinInput}
              />
              <button id="joinBtn" class="btn" disabled={busy} onClick={handleJoin}>
                {t.home.join}
              </button>
            </div>
            <p class="muted small">{t.home.encryptHint}</p>
          </div>
        </div>
      </div>

      <div class="foot muted">{t.home.footer}</div>
    </section>
  );
}

async function apiCreateRoom(body: { maxConcurrent: number; creatorCid: string }): Promise<{ roomId: string }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(t.error.roomCreationFailed);
  return res.json();
}

function b64urlEncode(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getClientId() {
  const key = "pairlane-client-id";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

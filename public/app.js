const $ = (id) => document.getElementById(id);

const homeView = $("homeView");
const roomView = $("roomView");

const encryptToggle = $("encryptToggle");
const createBtn = $("createBtn");
const joinCode = $("joinCode");
const joinBtn = $("joinBtn");

const roomIdLabel = $("roomIdLabel");
const statusEl = $("status");
const roleLabel = $("roleLabel");
const peersLabel = $("peersLabel");
const copyLinkBtn = $("copyLinkBtn");
const copyCodeBtn = $("copyCodeBtn");

const senderPane = $("senderPane");
const receiverPane = $("receiverPane");

const drop = $("drop");
const fileInput = $("fileInput");
const sendBtn = $("sendBtn");
const fileInfo = $("fileInfo");
const sendBar = $("sendBar");
const sendText = $("sendText");

const recvBar = $("recvBar");
const recvText = $("recvText");
const downloadArea = $("downloadArea");
const downloadLink = $("downloadLink");
const downloadMeta = $("downloadMeta");

/** ---------- routing ---------- */
const route = parseRoute();
if (route.page === "home") showHome();
else showRoom(route.roomId);

createBtn.onclick = async () => {
  setHomeBusy(true);
  try {
    const { roomId } = await apiCreateRoom();
    const useEncrypt = encryptToggle.checked;
    if (useEncrypt) {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const k = b64urlEncode(rawKey);
      navigate(`/r/${roomId}#k=${k}`);
    } else {
      navigate(`/r/${roomId}`);
    }
  } finally {
    setHomeBusy(false);
  }
};

joinBtn.onclick = () => {
  const code = joinCode.value.trim().toUpperCase();
  if (!code) return;
  navigate(`/r/${code}${location.hash || ""}`);
};

function showHome() {
  homeView.classList.remove("hidden");
  roomView.classList.add("hidden");
}

function showRoom(roomId) {
  homeView.classList.add("hidden");
  roomView.classList.remove("hidden");
  bootRoom(roomId).catch((e) => {
    setStatus(`エラー: ${String(e?.message || e)}`);
  });
}

function parseRoute() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "r") return { page: "room", roomId: parts[1] };
  return { page: "home" };
}

function navigate(path) {
  history.pushState({}, "", path);
  const r = parseRoute();
  if (r.page === "home") showHome();
  else showRoom(r.roomId);
}

window.onpopstate = () => {
  const r = parseRoute();
  if (r.page === "home") showHome();
  else showRoom(r.roomId);
};

/** ---------- room logic ---------- */
async function bootRoom(roomId) {
  roomIdLabel.textContent = roomId;
  copyLinkBtn.onclick = () => copyText(location.href);
  copyCodeBtn.onclick = () => copyText(roomId);

  setStatus("シグナリング接続中...");
  const ws = await connectSignaling(roomId);

  /** @type {"offerer"|"answerer"|null} */
  let role = null;
  let peers = 0;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  });

  let dc = null;
  let remoteDescSet = false;
  const pendingCandidates = [];
  let offerInFlight = false;

  const keyParam = new URLSearchParams(location.hash.slice(1)).get("k");
  const cryptoKey = keyParam ? await importAesKey(b64urlDecode(keyParam)) : null;

  let selectedFile = null;
  let incomingMeta = null;
  let recvChunks = [];
  let recvBytes = 0;

  pc.onicecandidate = (ev) => {
    if (ev.candidate) sendWS(ws, { type: "candidate", candidate: ev.candidate });
  };

  pc.oniceconnectionstatechange = () => {
    console.info("[rtc] iceConnectionState:", pc.iceConnectionState);
  };

  pc.onicegatheringstatechange = () => {
    console.info("[rtc] iceGatheringState:", pc.iceGatheringState);
  };

  pc.onsignalingstatechange = () => {
    console.info("[rtc] signalingState:", pc.signalingState);
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.info("[rtc] connectionState:", s);
    if (s === "connected") setStatus("P2P接続完了");
    else if (s === "failed") setStatus("P2P接続失敗（ネットワーク条件の可能性）");
    else if (s === "connecting") setStatus("P2P接続中...");
    else setStatus(`状態: ${s}`);
  };

  pc.ondatachannel = (ev) => {
    dc = ev.channel;
    wireDataChannel(dc);
  };

  async function ensureOffer() {
    if (role !== "offerer") return;
    if (peers < 2) return;
    if (offerInFlight) return;
    if (pc.signalingState !== "stable") return;
    if (pc.localDescription) return;
    offerInFlight = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWS(ws, { type: "offer", sdp: pc.localDescription });
    } finally {
      offerInFlight = false;
    }
  }

  ws.onmessage = async (ev) => {
    const msg = safeJson(ev.data);
    if (!msg) return;
    console.info("[ws] message:", msg.type);

    if (msg.type === "role") {
      role = msg.role;
      roleLabel.textContent = role === "offerer" ? "送信側（offerer）" : "受信側（answerer）";
      if (role === "offerer") {
        senderPane.classList.remove("hidden");
        receiverPane.classList.add("hidden");
        setupSenderUI();
      } else {
        receiverPane.classList.remove("hidden");
        senderPane.classList.add("hidden");
      }
      if (role === "offerer") {
        dc = pc.createDataChannel("file", { ordered: true });
        wireDataChannel(dc);
      }
      return;
    }

    if (msg.type === "peers") {
      peers = msg.count;
      peersLabel.textContent = String(peers);
      if (peers < 2) setStatus("相手の参加待ち...");
      else if (pc.connectionState !== "connected") setStatus("P2P確立中...");
      ensureOffer();
      if (role === "offerer") {
        sendBtn.disabled = !(selectedFile && dc && dc.readyState === "open" && peers >= 2);
      }
      return;
    }

    if (msg.type === "peer-left") {
      setStatus("相手が退出しました");
      sendBtn.disabled = true;
      return;
    }

    if (msg.type === "offer") {
      await pc.setRemoteDescription(msg.sdp);
      remoteDescSet = true;
      await flushCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWS(ws, { type: "answer", sdp: pc.localDescription });
      return;
    }

    if (msg.type === "answer") {
      await pc.setRemoteDescription(msg.sdp);
      remoteDescSet = true;
      await flushCandidates();
      return;
    }

    if (msg.type === "candidate") {
      if (!remoteDescSet) pendingCandidates.push(msg.candidate);
      else await pc.addIceCandidate(msg.candidate);
    }
  };

  ws.onclose = () => setStatus("シグナリング切断");
  ws.onerror = () => console.warn("[ws] error");

  function wireDataChannel(ch) {
    ch.binaryType = "arraybuffer";
    ch.onopen = () => {
      console.info("[rtc] datachannel open");
      setStatus("データチャネル準備完了");
      if (role === "offerer") sendBtn.disabled = !selectedFile || peers < 2;
    };
    ch.onclose = () => {
      console.info("[rtc] datachannel close");
      setStatus("データチャネル切断");
    };
    ch.onerror = () => {
      console.warn("[rtc] datachannel error");
      setStatus("データチャネルエラー");
    };

    ch.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        const m = safeJson(ev.data);
        if (!m) return;

        if (m.type === "meta") {
          incomingMeta = m;
          recvChunks = [];
          recvBytes = 0;
          setRecvProgress(0, incomingMeta.size);

          if (incomingMeta.encrypted && !cryptoKey) {
            setStatus("暗号化リンクの鍵が見つかりません（#k=... が必要）");
            return;
          }
          setStatus(`受信中: ${incomingMeta.name}`);
        }

        if (m.type === "done") {
          await finalizeDownload();
        }
        return;
      }

      if (!incomingMeta) return;
      const ab = await toArrayBuffer(ev.data);

      let plain = ab;
      if (incomingMeta.encrypted) {
        plain = await decryptChunk(ab, cryptoKey);
      }
      recvChunks.push(new Uint8Array(plain));
      recvBytes += plain.byteLength;
      setRecvProgress(recvBytes, incomingMeta.size);
    };
  }

  async function flushCandidates() {
    while (pendingCandidates.length) {
      const c = pendingCandidates.shift();
      await pc.addIceCandidate(c);
    }
  }

  function setupSenderUI() {
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add("hover");
    };
    drop.ondragleave = () => drop.classList.remove("hover");
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove("hover");
      const f = e.dataTransfer?.files?.[0];
      if (f) pickFile(f);
    };
    fileInput.onchange = () => {
      const f = fileInput.files?.[0];
      if (f) pickFile(f);
    };

    sendBtn.onclick = async () => {
      if (!dc || dc.readyState !== "open" || !selectedFile) return;
      if (peers < 2) return;
      await sendFile(selectedFile);
    };
  }

  function pickFile(f) {
    selectedFile = f;
    fileInfo.textContent = `${f.name} (${formatBytes(f.size)})`;
    sendBtn.disabled = !(dc && dc.readyState === "open" && peers >= 2);
  }

  async function sendFile(file) {
    const encrypted = !!cryptoKey;
    const meta = {
      type: "meta",
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      encrypted,
    };
    dc.send(JSON.stringify(meta));

    setStatus("送信中...");
    setSendProgress(0, file.size);

    let sent = 0;

    dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;
    const waitDrain = () =>
      new Promise((resolve) => {
        if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) return resolve();
        dc.onbufferedamountlow = () => {
          dc.onbufferedamountlow = null;
          resolve();
        };
      });

    const sendChunk = async (value) => {
      const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      let payload = chunk;
      if (encrypted) payload = await encryptChunk(chunk, cryptoKey);
      dc.send(payload);
      sent += value.byteLength;
      setSendProgress(sent, file.size);
      if (dc.bufferedAmount > 8 * 1024 * 1024) await waitDrain();
    };

    const chunkSize = 16 * 1024;
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + chunkSize);
      const buf = await slice.arrayBuffer();
      const value = new Uint8Array(buf);
      if (value.byteLength === 0) break;
      await sendChunk(value);
      offset += value.byteLength;
    }

    dc.send(JSON.stringify({ type: "done" }));
    setStatus("送信完了");
  }

  async function finalizeDownload() {
    if (!incomingMeta) return;
    setStatus("ファイル生成中...");

    const blob = new Blob(recvChunks, { type: incomingMeta.mime });
    const url = URL.createObjectURL(blob);

    downloadLink.href = url;
    downloadLink.download = incomingMeta.name;
    downloadMeta.textContent = `${incomingMeta.name} (${formatBytes(incomingMeta.size)})`;

    downloadArea.classList.remove("hidden");
    setStatus("受信完了");
  }
}

/** ---------- signaling ---------- */
function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

function connectSignaling(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(`/ws/${roomId}`));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("WebSocket接続に失敗しました"));
  });
}

function sendWS(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ---------- UI helpers ---------- */
function setStatus(text) {
  statusEl.textContent = text;
}

function setHomeBusy(b) {
  createBtn.disabled = b;
  joinBtn.disabled = b;
  encryptToggle.disabled = b;
}

function setSendProgress(sent, total) {
  const pct = total ? Math.floor((sent / total) * 100) : 0;
  sendBar.style.width = `${pct}%`;
  sendText.textContent = `${pct}% (${formatBytes(sent)} / ${formatBytes(total)})`;
}

function setRecvProgress(got, total) {
  const pct = total ? Math.floor((got / total) * 100) : 0;
  recvBar.style.width = `${pct}%`;
  recvText.textContent = `${pct}% (${formatBytes(got)} / ${formatBytes(total)})`;
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function formatBytes(n) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

async function apiCreateRoom() {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("ルーム作成に失敗しました");
  return res.json();
}

async function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Blob) return data.arrayBuffer();
  return new Response(data).arrayBuffer();
}

/** ---------- crypto (optional E2E) ---------- */
async function importAesKey(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptChunk(plainAb, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainAb);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out.buffer;
}

async function decryptChunk(frameAb, key) {
  const u8 = new Uint8Array(frameAb);
  const iv = u8.slice(0, 12);
  const ct = u8.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return pt;
}

function b64urlEncode(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

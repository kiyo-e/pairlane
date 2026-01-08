/** @jsxImportSource hono/jsx/dom */
/**
 * Room client app for share-files.
 * See README.md; pairs with src/ui/room.tsx.
 */

import { render, useCallback, useEffect, useMemo, useRef, useState } from "hono/jsx/dom";

type RoomRole = "offerer" | "answerer" | null;

type RoomMessage =
  | { type: "role"; role: "offerer" | "answerer"; cid: string }
  | { type: "peers"; count: number }
  | { type: "wait"; position?: number }
  | { type: "start"; peerId?: string }
  | { type: "peer-left"; peerId: string }
  | { type: "offer"; from: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; from: string; sid: number; candidate: RTCIceCandidateInit };

type SignalOut =
  | { type: "offer"; to: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; to: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; to: string; sid: number; candidate: RTCIceCandidateInit };

type ClientMessage = SignalOut | { type: "transfer-done"; peerId: string };

type IncomingMeta = {
  type: "meta";
  name: string;
  size: number;
  mime: string;
  encrypted: boolean;
};

type DoneMessage = { type: "done" };

type DataMessage = IncomingMeta | DoneMessage;

type OutgoingMeta = IncomingMeta;

type PendingCandidate = { sid: number; candidate: RTCIceCandidateInit };

type AnyWebSocket = WebSocket;

type DataChannel = RTCDataChannel;

type BufferLike = ArrayBuffer | Blob;

type RoomCryptoKey = CryptoKey | null;

type DownloadInfo = {
  url: string;
  name: string;
  size: number;
};

type OffererPeer = {
  peerId: string;
  pc: RTCPeerConnection;
  dc: DataChannel | null;
  signalSid: number;
  activeSid: number | null;
  remoteDescSet: boolean;
  pendingCandidates: PendingCandidate[];
  offerInFlight: boolean;
  sending: boolean;
  sent: boolean;
};

const clientId = getClientId();

const root = document.querySelector("main.container");
const roomId = document.body.dataset.roomId;
if (root && roomId && document.getElementById("roomView")) {
  render(<RoomApp roomId={roomId} />, root);
}

type RoomAppProps = {
  roomId: string;
};

function RoomApp({ roomId }: RoomAppProps) {
  const [status, setStatus] = useState("初期化中...");
  const [role, setRole] = useState<RoomRole>(null);
  const [peers, setPeers] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [recvProgress, setRecvProgress] = useState({ got: 0, total: 0 });
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const roleRef = useRef<RoomRole>(role);
  const peersRef = useRef(peers);
  const selectedFileRef = useRef<File | null>(null);
  const sendIntentRef = useRef(false);
  const wsRef = useRef<AnyWebSocket | null>(null);
  const cryptoKeyRef = useRef<RoomCryptoKey>(null);

  const offererPeersRef = useRef<Map<string, OffererPeer>>(new Map());

  const receiverPcRef = useRef<RTCPeerConnection | null>(null);
  const receiverDcRef = useRef<DataChannel | null>(null);
  const receiverPeerIdRef = useRef<string | null>(null);
  const receiverRemoteDescSetRef = useRef(false);
  const receiverPendingCandidatesRef = useRef<PendingCandidate[]>([]);
  const receiverActiveSidRef = useRef<number | null>(null);

  const incomingMetaRef = useRef<IncomingMeta | null>(null);
  const recvChunksRef = useRef<Uint8Array[]>([]);
  const recvBytesRef = useRef(0);
  const downloadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const resetPeerSends = useCallback(() => {
    for (const peer of offererPeersRef.current.values()) {
      peer.sent = false;
      peer.sending = false;
    }
  }, []);

  const handleCopyLink = useCallback(() => {
    copyText(location.href);
  }, []);

  const handleCopyCode = useCallback(() => {
    copyText(roomId);
  }, [roomId]);

  const handleDragOver = useCallback((ev: DragEvent) => {
    ev.preventDefault();
    setDropHover(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropHover(false);
  }, []);

  const handleDrop = useCallback((ev: DragEvent) => {
    ev.preventDefault();
    setDropHover(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) {
      sendIntentRef.current = false;
      resetPeerSends();
      setSelectedFile(f);
    }
  }, [resetPeerSends]);

  const handleFileInput = useCallback((ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) {
      sendIntentRef.current = false;
      resetPeerSends();
      setSelectedFile(f);
    }
  }, [resetPeerSends]);

  const finalizeDownload = useCallback(async () => {
    const meta = incomingMetaRef.current;
    if (!meta) return;
    setStatus("ファイル生成中...");

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
    }

    const blob = new Blob(recvChunksRef.current, { type: meta.mime });
    const url = URL.createObjectURL(blob);
    downloadUrlRef.current = url;

    setDownload({ url, name: meta.name, size: meta.size });
    setStatus("受信完了");
  }, []);

  const sendFileToPeer = useCallback(async (peer: OffererPeer, file: File) => {
    const dc = peer.dc;
    if (!dc) return;

    const encrypted = !!cryptoKeyRef.current;
    const meta: OutgoingMeta = {
      type: "meta",
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      encrypted,
    };
    log("[send] starting:", meta.name, "size:", meta.size, "peer:", peer.peerId);
    dc.send(JSON.stringify(meta));

    setStatus("送信中...");
    setSendProgress({ sent: 0, total: file.size });

    let sent = 0;

    dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;
    const waitDrain = () =>
      new Promise<void>((resolve) => {
        if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) return resolve();
        dc.onbufferedamountlow = () => {
          dc.onbufferedamountlow = null;
          resolve();
        };
      });

    const sendChunk = async (value: Uint8Array) => {
      const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      let payload: ArrayBuffer = chunk;
      if (encrypted) payload = await encryptChunk(chunk, cryptoKeyRef.current);
      dc.send(payload);
      sent += value.byteLength;
      setSendProgress({ sent, total: file.size });
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

    dc.send(JSON.stringify({ type: "done" } satisfies DoneMessage));
    log("[send] completed, peer:", peer.peerId);
    setStatus("送信完了");
    peer.sent = true;

    if (wsRef.current) {
      sendWS(wsRef.current, { type: "transfer-done", peerId: peer.peerId });
    }
  }, []);

  const trySendPeer = useCallback(async (peer: OffererPeer, reason: string) => {
    if (!sendIntentRef.current) return;
    if (peer.sending || peer.sent) return;
    const file = selectedFileRef.current;
    if (!file) return;
    const dc = peer.dc;
    if (!dc || dc.readyState !== "open") return;

    log("[send] triggered:", reason, "peer:", peer.peerId);
    peer.sending = true;
    await sendFileToPeer(peer, file);
    peer.sending = false;
  }, [sendFileToPeer]);

  const trySendAll = useCallback((reason: string) => {
    for (const peer of offererPeersRef.current.values()) {
      void trySendPeer(peer, reason);
    }
  }, [trySendPeer]);

  const handleSend = useCallback(async () => {
    if (!selectedFile) return;
    sendIntentRef.current = true;
    trySendAll("manual");
  }, [selectedFile, trySendAll]);

  useEffect(() => {
    const boot = async () => {
      setStatus("シグナリング接続中...");

      const keyParam = new URLSearchParams(location.hash.slice(1)).get("k");
      cryptoKeyRef.current = keyParam ? await importAesKey(b64urlDecode(keyParam)) : null;

      const ws = await connectSignaling(roomId, clientId);
      wsRef.current = ws;

      const wireOffererDataChannel = (peer: OffererPeer, ch: DataChannel) => {
        ch.binaryType = "arraybuffer";
        ch.onopen = () => {
          log("[rtc] datachannel open (peer:", peer.peerId + ")");
          setStatus("データチャネル準備完了");
          void trySendPeer(peer, "datachannel-open");
        };
        ch.onclose = () => {
          log("[rtc] datachannel close (peer:", peer.peerId + ")");
        };
        ch.onerror = () => {
          console.warn("[rtc] datachannel error (peer:", peer.peerId + ")");
        };
      };

      const createOffererPeer = (peerId: string) => {
        const existing = offererPeersRef.current.get(peerId);
        if (existing) return existing;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        });

        const peer: OffererPeer = {
          peerId,
          pc,
          dc: null,
          signalSid: 0,
          activeSid: null,
          remoteDescSet: false,
          pendingCandidates: [],
          offerInFlight: false,
          sending: false,
          sent: false,
        };

        pc.onicecandidate = (ev) => {
          if (!ev.candidate) return;
          const sid = peer.activeSid;
          if (sid == null) return;
          if (!wsRef.current) return;
          sendWS(wsRef.current, {
            type: "candidate",
            to: peer.peerId,
            sid,
            candidate: ev.candidate.toJSON(),
          });
        };

        pc.onconnectionstatechange = () => {
          log("[rtc] connectionState:", pc.connectionState, "(peer:", peer.peerId + ")");
        };

        const dc = pc.createDataChannel("file", { ordered: true });
        peer.dc = dc;
        wireOffererDataChannel(peer, dc);

        offererPeersRef.current.set(peerId, peer);
        return peer;
      };

      const closeOffererPeer = (peerId: string) => {
        const peer = offererPeersRef.current.get(peerId);
        if (!peer) return;
        peer.dc?.close();
        peer.pc.close();
        offererPeersRef.current.delete(peerId);
      };

      const flushOffererCandidates = async (peer: OffererPeer) => {
        const pending = peer.pendingCandidates;
        let i = 0;
        while (i < pending.length) {
          const item = pending[i];
          if (item.sid !== peer.activeSid) {
            pending.splice(i, 1);
            continue;
          }
          pending.splice(i, 1);
          await peer.pc.addIceCandidate(item.candidate);
        }
      };

      const sendOffer = async (peer: OffererPeer) => {
        if (peer.offerInFlight) return;
        if (peer.pc.signalingState !== "stable") return;

        peer.offerInFlight = true;
        const sid = ++peer.signalSid;
        peer.activeSid = sid;

        const offer = await peer.pc.createOffer({ iceRestart: true });
        await peer.pc.setLocalDescription(offer);
        if (wsRef.current) {
          sendWS(wsRef.current, { type: "offer", to: peer.peerId, sid, sdp: peer.pc.localDescription! });
        }
        peer.offerInFlight = false;
      };

      const wireReceiverDataChannel = (ch: DataChannel) => {
        ch.binaryType = "arraybuffer";
        ch.onopen = () => {
          log("[rtc] datachannel open (receiver)");
          setStatus("データチャネル準備完了");
        };
        ch.onclose = () => {
          log("[rtc] datachannel close (receiver)");
          setStatus("データチャネル切断");
        };
        ch.onerror = () => {
          console.warn("[rtc] datachannel error (receiver)");
          setStatus("データチャネルエラー");
        };

        ch.onmessage = async (ev) => {
          if (typeof ev.data === "string") {
            const m = safeJson(ev.data) as DataMessage | null;
            if (!m) return;

            if (m.type === "meta") {
              log("[recv] starting:", m.name, "size:", m.size);
              incomingMetaRef.current = m;
              recvChunksRef.current = [];
              recvBytesRef.current = 0;
              setDownload(null);
              setRecvProgress({ got: 0, total: m.size });

              if (m.encrypted && !cryptoKeyRef.current) {
                setStatus("暗号化リンクの鍵が見つかりません（#k=... が必要）");
                return;
              }
              setStatus(`受信中: ${m.name}`);
            }

            if (m.type === "done") {
              log("[recv] completed");
              await finalizeDownload();
            }
            return;
          }

          if (!incomingMetaRef.current) return;
          const ab = await toArrayBuffer(ev.data as BufferLike);

          let plain = ab;
          if (incomingMetaRef.current.encrypted) {
            plain = await decryptChunk(ab, cryptoKeyRef.current);
          }
          recvChunksRef.current.push(new Uint8Array(plain));
          recvBytesRef.current += plain.byteLength;
          setRecvProgress({ got: recvBytesRef.current, total: incomingMetaRef.current.size });
        };
      };

      const createReceiverPc = (peerId: string) => {
        if (receiverPcRef.current) return receiverPcRef.current;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        });
        receiverPcRef.current = pc;
        receiverPeerIdRef.current = peerId;
        receiverRemoteDescSetRef.current = false;
        receiverPendingCandidatesRef.current = [];

        pc.onicecandidate = (ev) => {
          if (!ev.candidate) return;
          const sid = receiverActiveSidRef.current;
          const to = receiverPeerIdRef.current;
          if (sid == null || !to || !wsRef.current) return;
          sendWS(wsRef.current, {
            type: "candidate",
            to,
            sid,
            candidate: ev.candidate.toJSON(),
          });
        };

        pc.onconnectionstatechange = () => {
          log("[rtc] connectionState:", pc.connectionState, "(receiver)");
        };

        pc.ondatachannel = (ev) => {
          receiverDcRef.current = ev.channel;
          wireReceiverDataChannel(ev.channel);
        };

        return pc;
      };

      const flushReceiverCandidates = async () => {
        const pc = receiverPcRef.current;
        const sid = receiverActiveSidRef.current;
        if (!pc || sid == null) return;

        const pending = receiverPendingCandidatesRef.current;
        let i = 0;
        while (i < pending.length) {
          const item = pending[i];
          if (item.sid !== sid) {
            pending.splice(i, 1);
            continue;
          }
          pending.splice(i, 1);
          await pc.addIceCandidate(item.candidate);
        }
      };

      ws.onmessage = async (ev) => {
        const msg = safeJson(ev.data) as RoomMessage | null;
        if (!msg) return;
        log("[ws] message:", msg.type, "(role:", roleRef.current + ")");

        if (msg.type === "role") {
          roleRef.current = msg.role;
          setRole(msg.role);
          if (msg.role === "offerer") {
            setStatus("送信側として待機中...");
          } else {
            setStatus("受信側として待機中...");
          }
          return;
        }

        if (msg.type === "peers") {
          peersRef.current = msg.count;
          setPeers(msg.count);
          return;
        }

        if (msg.type === "wait") {
          if (roleRef.current === "answerer") {
            setStatus("順番待ち...");
          }
          return;
        }

        if (msg.type === "start") {
          if (roleRef.current === "offerer" && msg.peerId) {
            const peer = createOffererPeer(msg.peerId);
            await sendOffer(peer);
            return;
          }
          if (roleRef.current === "answerer") {
            setStatus("接続準備中...");
          }
          return;
        }

        if (msg.type === "peer-left") {
          if (roleRef.current === "offerer") {
            closeOffererPeer(msg.peerId);
          }
          return;
        }

        if (msg.type === "offer") {
          if (roleRef.current !== "answerer") return;
          const pc = createReceiverPc(msg.from);
          receiverActiveSidRef.current = msg.sid;
          await pc.setRemoteDescription(msg.sdp);
          receiverRemoteDescSetRef.current = true;
          await flushReceiverCandidates();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (wsRef.current) {
            sendWS(wsRef.current, {
              type: "answer",
              to: msg.from,
              sid: msg.sid,
              sdp: pc.localDescription!,
            });
          }
          return;
        }

        if (msg.type === "answer") {
          if (roleRef.current !== "offerer") return;
          const peer = offererPeersRef.current.get(msg.from);
          if (!peer) return;
          if (peer.activeSid == null || msg.sid !== peer.activeSid) return;

          await peer.pc.setRemoteDescription(msg.sdp);
          peer.remoteDescSet = true;
          await flushOffererCandidates(peer);
          return;
        }

        if (msg.type === "candidate") {
          if (roleRef.current === "offerer") {
            const peer = offererPeersRef.current.get(msg.from);
            if (!peer) return;
            if (peer.activeSid == null || msg.sid !== peer.activeSid) return;

            if (!peer.remoteDescSet) {
              peer.pendingCandidates.push({ sid: msg.sid, candidate: msg.candidate });
            } else {
              await peer.pc.addIceCandidate(msg.candidate);
            }
            return;
          }

          if (roleRef.current === "answerer") {
            if (msg.from !== receiverPeerIdRef.current) return;
            const pc = receiverPcRef.current;
            if (!pc) return;

            if (!receiverRemoteDescSetRef.current) {
              receiverPendingCandidatesRef.current.push({ sid: msg.sid, candidate: msg.candidate });
            } else {
              await pc.addIceCandidate(msg.candidate);
            }
          }
        }
      };

      ws.onclose = () => setStatus("シグナリング切断");
      ws.onerror = () => console.warn("[ws] error");
    };

    boot().catch((e) => {
      setStatus(`エラー: ${String(e?.message || e)}`);
    });

    return () => {
      wsRef.current?.close();
      receiverDcRef.current?.close();
      receiverPcRef.current?.close();
      for (const peer of offererPeersRef.current.values()) {
        peer.dc?.close();
        peer.pc.close();
      }
      offererPeersRef.current.clear();
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
        downloadUrlRef.current = null;
      }
    };
  }, [roomId, finalizeDownload, trySendPeer]);

  const roleLabel = useMemo(() => {
    if (role === "offerer") return "送信側（offerer）";
    if (role === "answerer") return "受信側（answerer）";
    return "—";
  }, [role]);

  const peersLabel = useMemo(() => String(peers), [peers]);

  const sendPct = useMemo(
    () => progressPercent(sendProgress.sent, sendProgress.total),
    [sendProgress]
  );
  const sendText = useMemo(
    () => progressText(sendProgress.sent, sendProgress.total),
    [sendProgress]
  );

  const recvPct = useMemo(
    () => progressPercent(recvProgress.got, recvProgress.total),
    [recvProgress]
  );
  const recvText = useMemo(
    () => progressText(recvProgress.got, recvProgress.total),
    [recvProgress]
  );

  const selectedFileLabel = useMemo(() => {
    if (!selectedFile) return "";
    return `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
  }, [selectedFile]);

  const canSend = role === "offerer" && !!selectedFile;
  const showSender = role === "offerer";
  const showReceiver = role === "answerer";

  return (
    <section id="roomView" class="card room">
      <div class="roomHeader">
        <div class="roomTitle">
          <div class="eyebrow">ROOM—SESSION</div>
          <h2>
            ROOM <span id="roomIdLabel" class="mono">{roomId}</span>
          </h2>
          <div id="status" class="status">{status}</div>
        </div>
        <div class="right">
          <button id="copyLinkBtn" class="btn" onClick={handleCopyLink}>LINK</button>
          <button id="copyCodeBtn" class="btn" onClick={handleCopyCode}>CODE</button>
        </div>
      </div>

      <div class="roomGrid">
        <div class="roomSide">
          <div class="kv">
            <div class="k">ROLE</div>
            <div class="v" id="roleLabel">{roleLabel}</div>
            <div class="k">PEERS</div>
            <div class="v" id="peersLabel">{peersLabel}</div>
          </div>
          <div class="sideCard muted small">
            暗号化ONの場合、リンクの「#」以降に復号鍵が含まれます（サーバには送られません）。
          </div>
        </div>

        <div class="roomMain">
          <div id="senderPane" class={`pane${showSender ? "" : " hidden"}`}>
            <div
              id="drop"
              class={`drop${dropHover ? " hover" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div class="dropTitle">DROP FILE HERE</div>
              <div class="muted small">または</div>
              <label class="btn">
                SELECT
                <input id="fileInput" type="file" hidden onChange={handleFileInput} />
              </label>
            </div>

            <div class="row gap wrap">
              <button id="sendBtn" class="btn primary" disabled={!canSend} onClick={handleSend}>
                SEND
              </button>
              <div class="muted small" id="fileInfo">{selectedFileLabel}</div>
            </div>

            <div class="progress">
              <div class="bar">
                <div
                  id="sendBar"
                  class="fill"
                  style={{ width: `${sendPct}%` }}
                ></div>
              </div>
              <div class="muted small" id="sendText">{sendText}</div>
            </div>
          </div>

          <div id="receiverPane" class={`pane${showReceiver ? "" : " hidden"}`}>
            <div class="muted">送信側がファイルを選ぶのを待っています...</div>

            <div class="progress">
              <div class="bar">
                <div
                  id="recvBar"
                  class="fill"
                  style={{ width: `${recvPct}%` }}
                ></div>
              </div>
              <div class="muted small" id="recvText">{recvText}</div>
            </div>

            <div id="downloadArea" class={download ? "" : "hidden"}>
              <a
                id="downloadLink"
                class="btn primary"
                href={download?.url ?? "#"}
                download={download?.name}
              >
                DOWNLOAD
              </a>
              <div id="downloadMeta" class="muted small">
                {download ? `${download.name} (${formatBytes(download.size)})` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** ---------- signaling ---------- */
function wsUrl(path: string) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

function connectSignaling(roomId: string, clientId: string) {
  return new Promise<AnyWebSocket>((resolve, reject) => {
    const url = new URL(wsUrl(`/ws/${roomId}`));
    url.searchParams.set("cid", clientId);
    const ws = new WebSocket(url.toString());
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("WebSocket接続に失敗しました"));
  });
}

function sendWS(ws: AnyWebSocket, obj: ClientMessage) {
  ws.send(JSON.stringify(obj));
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** タイムスタンプ付きログ */
function log(...args: unknown[]) {
  const now = new Date();
  const ts = now.toISOString().slice(11, 23); // HH:mm:ss.SSS
  console.info(`[${ts}]`, ...args);
}

/** ---------- UI helpers ---------- */
function progressPercent(sent: number, total: number) {
  return total ? Math.floor((sent / total) * 100) : 0;
}

function progressText(sent: number, total: number) {
  if (!total) return "0%";
  const pct = progressPercent(sent, total);
  return `${pct}% (${formatBytes(sent)} / ${formatBytes(total)})`;
}

async function copyText(s: string) {
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

function formatBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function getClientId() {
  const key = "share-files-client-id";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

async function toArrayBuffer(data: BufferLike) {
  if (data instanceof ArrayBuffer) return data;
  return data.arrayBuffer();
}

/** ---------- crypto (optional E2E) ---------- */
async function importAesKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptChunk(plainAb: ArrayBuffer, key: RoomCryptoKey) {
  if (!key) return plainAb;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainAb);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out.buffer;
}

async function decryptChunk(frameAb: ArrayBuffer, key: RoomCryptoKey) {
  if (!key) return frameAb;
  const u8 = new Uint8Array(frameAb);
  const iv = u8.slice(0, 12);
  const ct = u8.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return pt;
}

function b64urlDecode(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

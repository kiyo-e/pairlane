// Design: see README.md for the P2P signaling flow; this Durable Object pairs with src/index.tsx.

type Role = "offerer" | "answerer";

type AnswererState = "waiting" | "active" | "done";

type ServerToClient =
  | { type: "role"; role: Role; cid: string }
  | { type: "peers"; count: number }
  | { type: "wait"; position?: number }
  | { type: "start"; peerId?: string }
  | { type: "peer-left"; peerId: string }
  | { type: "offer"; from: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; from: string; sid: number; candidate: RTCIceCandidateInit };

type ClientToServer =
  | { type: "offer"; to: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; to: string; sid: number; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; to: string; sid: number; candidate: RTCIceCandidateInit }
  | { type: "transfer-done"; peerId: string };

type SocketAttachment = {
  cid: string;
  role: Role;
  state?: AnswererState;
  joinedAt?: number;
};

type RoomConfig = {
  maxConcurrent: number;
  creatorCid?: string;
};

const DEFAULT_MAX_CONCURRENT = 3;
const MAX_MAX_CONCURRENT = 10;

function normalizeMaxConcurrent(value?: number) {
  const base = Number.isFinite(value) ? Math.floor(value!) : DEFAULT_MAX_CONCURRENT;
  return Math.min(MAX_MAX_CONCURRENT, Math.max(1, base));
}

function toText(message: ArrayBuffer | string) {
  return typeof message === "string" ? message : new TextDecoder().decode(message);
}

type Bindings = CloudflareBindings;

const DurableObjectBase =
  (globalThis as { DurableObject?: typeof DurableObject }).DurableObject ??
  class {
    ctx: DurableObjectState;
    constructor(state: DurableObjectState) {
      this.ctx = state;
    }
  };

export class Room extends DurableObjectBase {
  // Design: README.md (multi-receiver queue); related: src/index.tsx routes and src/client/room.tsx signaling.
  private ctx: DurableObjectState;
  private config: RoomConfig | null = null;
  private activePairs = new Map<string, string>();
  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
    this.ctx = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/config") {
      if (request.method === "POST") {
        const body = (await request.json()) as { maxConcurrent?: number; creatorCid?: string };
        const maxConcurrent = normalizeMaxConcurrent(body.maxConcurrent);
        const creatorCid = typeof body.creatorCid === "string" ? body.creatorCid : undefined;
        this.config = { maxConcurrent, creatorCid };
        await this.ctx.storage.put("config", this.config);
        return new Response("OK");
      }
      if (request.method === "GET") {
        await this.ensureConfig();
        return Response.json(this.config ?? { maxConcurrent: DEFAULT_MAX_CONCURRENT });
      }
      return new Response("Expected POST or GET", { status: 400 });
    }

    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    if (request.method !== "GET") {
      return new Response("Expected GET", { status: 400 });
    }

    await this.ensureConfig();

    const clientId = url.searchParams.get("cid") ?? crypto.randomUUID();

    this.closeDuplicateClient(clientId);
    const role = this.pickRole(clientId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const attachment: SocketAttachment = {
      cid: clientId,
      role,
      joinedAt: Date.now(),
    };
    if (role === "answerer") attachment.state = "waiting";

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    this.sendJson(server, { type: "role", role, cid: clientId });
    if (role === "answerer") {
      this.sendJson(server, { type: "wait" });
    }

    this.broadcastPeers();
    this.fillSlots();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const text = toText(message);
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    let msg: ClientToServer | null = null;
    try {
      msg = JSON.parse(text) as ClientToServer;
    } catch {
      return;
    }

    if (msg.type === "transfer-done") {
      if (attachment.role !== "offerer") return;
      const peerSocket = this.socketByCid(msg.peerId);
      if (peerSocket) {
        this.setAnswererState(peerSocket, "done");
      }
      this.fillSlots();
      return;
    }

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "candidate") {
      if (msg.type === "offer") {
        if (attachment.role !== "offerer") return;
        if (this.activePairs.get(msg.to) !== attachment.cid) return;
      }
      if (msg.type === "answer") {
        if (attachment.role !== "answerer") return;
        if (this.activePairs.get(attachment.cid) !== msg.to) return;
      }
      if (msg.type === "candidate") {
        if (attachment.role === "offerer") {
          if (this.activePairs.get(msg.to) !== attachment.cid) return;
        } else if (attachment.role === "answerer") {
          if (this.activePairs.get(attachment.cid) !== msg.to) return;
        } else {
          return;
        }
      }
      const target = this.socketByCid(msg.to);
      if (!target) return;

      const payload =
        msg.type === "offer"
          ? { type: "offer", from: attachment.cid, sid: msg.sid, sdp: msg.sdp }
          : msg.type === "answer"
            ? { type: "answer", from: attachment.cid, sid: msg.sid, sdp: msg.sdp }
            : { type: "candidate", from: attachment.cid, sid: msg.sid, candidate: msg.candidate };

      this.sendJson(target, payload);
    }
  }

  webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;

    if (attachment?.role === "answerer") {
      const hasReplacement = attachment.cid && this.hasOpenSocket(attachment.cid, "answerer");
      if (hasReplacement) {
        this.broadcastPeers();
        return;
      }
      if (attachment.cid) {
        this.activePairs.delete(attachment.cid);
      }
      const offerer = this.getOffererSocket();
      if (offerer && attachment.cid) {
        this.sendJson(offerer, { type: "peer-left", peerId: attachment.cid });
      }
      this.fillSlots();
    }

    if (attachment?.role === "offerer") {
      const hasReplacement = attachment.cid && this.hasOpenSocket(attachment.cid, "offerer");
      if (hasReplacement) {
        this.broadcastPeers();
        return;
      }
      this.activePairs.clear();
      for (const socket of this.answererSockets()) {
        this.setAnswererState(socket, "waiting");
        this.sendJson(socket, { type: "wait" });
      }
    }

    this.broadcastPeers();
  }

  webSocketError() {
    this.broadcastPeers();
  }

  private async ensureConfig() {
    if (this.config) return this.config;
    const stored = await this.ctx.storage.get<RoomConfig>("config");
    if (stored?.maxConcurrent) {
      this.config = {
        ...stored,
        maxConcurrent: normalizeMaxConcurrent(stored.maxConcurrent),
      };
    } else {
      this.config = { maxConcurrent: DEFAULT_MAX_CONCURRENT };
    }
    return this.config;
  }

  private broadcastPeers() {
    const sockets = this.openSockets();
    const payload = JSON.stringify({ type: "peers", count: sockets.length } satisfies ServerToClient);
    for (const socket of sockets) this.sendText(socket, payload);
  }

  private pickRole(clientId: string) {
    const creatorCid = this.config?.creatorCid;
    if (creatorCid) {
      return creatorCid === clientId ? "offerer" : "answerer";
    }
    const offerer = this.getOffererSocket();
    if (!offerer) return "offerer";
    return "answerer";
  }

  private getOffererSocket() {
    for (const socket of this.openSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.role === "offerer") return socket;
    }
    return null;
  }

  private answererSockets() {
    const out: WebSocket[] = [];
    for (const socket of this.openSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.role === "answerer") out.push(socket);
    }
    return out;
  }

  private socketByCid(cid: string) {
    for (const socket of this.openSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.cid === cid) return socket;
    }
    return null;
  }

  private setAnswererState(socket: WebSocket, state: AnswererState) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    attachment.state = state;
    socket.serializeAttachment(attachment);
  }

  private fillSlots() {
    const offerer = this.getOffererSocket();
    if (!offerer) return;
    const offererAttachment = offerer.deserializeAttachment() as SocketAttachment | null;
    const offererCid = offererAttachment?.cid;
    if (!offererCid) return;

    const maxConcurrent = this.config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

    const active = this.answererSockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      return attachment?.state === "active";
    });

    const waiting = this.answererSockets()
      .filter((socket) => {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        return attachment?.state === "waiting";
      })
      .sort((a, b) => {
        const aJoined = (a.deserializeAttachment() as SocketAttachment | null)?.joinedAt ?? 0;
        const bJoined = (b.deserializeAttachment() as SocketAttachment | null)?.joinedAt ?? 0;
        return aJoined - bJoined;
      });

    const available = maxConcurrent - active.length;
    if (available <= 0) return;

    const toActivate = waiting.slice(0, available);
    for (const socket of toActivate) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      this.setAnswererState(socket, "active");
      if (attachment.cid) {
        this.activePairs.set(attachment.cid, offererCid);
      }
      this.sendJson(socket, { type: "start" });
      this.sendJson(offerer, { type: "start", peerId: attachment.cid });
    }
  }

  private closeDuplicateClient(clientId: string, keepSocket?: WebSocket) {
    for (const socket of this.ctx.getWebSockets()) {
      if (keepSocket && socket === keepSocket) continue;
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.cid === clientId) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, "replaced");
        }
      }
    }
  }

  private openSockets() {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private hasOpenSocket(cid: string, role?: Role) {
    for (const socket of this.openSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || attachment.cid !== cid) continue;
      if (role && attachment.role !== role) continue;
      return true;
    }
    return false;
  }

  private sendJson(socket: WebSocket, payload: ServerToClient) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  private sendText(socket: WebSocket, payload: string) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(payload);
  }
}

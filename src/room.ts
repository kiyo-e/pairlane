// Design: see README.md for the P2P signaling flow; this Durable Object pairs with src/index.ts.

type Role = "offerer" | "answerer";

type ServerToClient =
  | { type: "role"; role: Role }
  | { type: "peers"; count: number }
  | { type: "peer-left" }
  | { type: "room-full" };

type SocketAttachment = {
  cid: string;
  role: Role;
};

function toText(message: ArrayBuffer | string) {
  return typeof message === "string" ? message : new TextDecoder().decode(message);
}

/** タイムスタンプ付きログ */
function log(...args: unknown[]) {
  const now = new Date();
  const ts = now.toISOString().slice(11, 23); // HH:mm:ss.SSS
  console.info(`[${ts}]`, ...args);
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
  private ctx: DurableObjectState;

  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
    this.ctx = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    if (request.method !== "GET") {
      return new Response("Expected GET", { status: 400 });
    }

    const url = new URL(request.url);
    const clientId = url.searchParams.get("cid") ?? crypto.randomUUID();

    log("[room] new connection, cid:", clientId, "current sockets:", this.ctx.getWebSockets().length);
    this.closeDuplicateClient(clientId);
    log("[room] after closeDuplicate, sockets:", this.ctx.getWebSockets().length);
    const role = this.pickRole(clientId);
    log("[room] assigned role:", role, "to cid:", clientId);
    if (!role) {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid: clientId, role } satisfies SocketAttachment);

    server.send(
      JSON.stringify({ type: "role", role } satisfies ServerToClient)
    );

    this.broadcastPeers();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const text = toText(message);
    const fromAttachment = ws.deserializeAttachment() as SocketAttachment | null;
    const sockets = this.ctx.getWebSockets();

    // メッセージの種類を確認
    let msgType = "unknown";
    try {
      const parsed = JSON.parse(text);
      msgType = parsed.type || "unknown";
    } catch {}

    log("[room] relaying message:", msgType, "from:", fromAttachment?.cid, "(", fromAttachment?.role, ") to", sockets.length - 1, "other sockets");

    for (const other of sockets) {
      if (other !== ws) {
        const toAttachment = other.deserializeAttachment() as SocketAttachment | null;
        log("[room]   -> sending to:", toAttachment?.cid, "(", toAttachment?.role, ")");
        other.send(text);
      }
    }
  }

  webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    log("[room] webSocketClose, cid:", attachment?.cid, "role:", attachment?.role, "remaining sockets:", this.ctx.getWebSockets().length);
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) {
        other.send(JSON.stringify({ type: "peer-left" } satisfies ServerToClient));
      }
    }
    this.broadcastPeers();
  }

  webSocketError() {
    this.broadcastPeers();
  }

  private broadcastPeers() {
    const count = this.ctx.getWebSockets().length;
    const payload = JSON.stringify({ type: "peers", count } satisfies ServerToClient);
    for (const socket of this.ctx.getWebSockets()) socket.send(payload);
  }

  private pickRole(clientId: string) {
    const roles = this.activeRoles(clientId);
    if (!roles.has("offerer")) return "offerer";
    if (!roles.has("answerer")) return "answerer";
    return null;
  }

  private activeRoles(excludeCid?: string) {
    const roles = new Set<Role>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment?.role) continue;
      if (excludeCid && attachment.cid === excludeCid) continue;
      roles.add(attachment.role);
    }
    return roles;
  }

  private closeDuplicateClient(clientId: string) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.cid === clientId) {
        log("[room] closing duplicate client, cid:", clientId, "role:", attachment.role);
        socket.close(1000, "replaced");
      }
    }
  }
}

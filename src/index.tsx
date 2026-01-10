import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { Room } from "./room";
import { RoomPage, TopPage } from "./ui";
import { detectLocale, getTranslations, supportedLocales, type Locale } from "./i18n";

type Bindings = CloudflareBindings & {
  ROOM: DurableObjectNamespace;
  ROOM_RATE_LIMITER: RateLimit;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", jsxRenderer());

const DEFAULT_MAX_CONCURRENT = 3;
const MAX_MAX_CONCURRENT = 10;

function normalizeMaxConcurrent(value?: number) {
  const base = Number.isFinite(value) ? Math.floor(value!) : DEFAULT_MAX_CONCURRENT;
  return Math.min(MAX_MAX_CONCURRENT, Math.max(1, base));
}

app.use("/api/rooms", async (c, next) => {
  if (c.req.method !== "POST") return next();
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const key = `create-room:${ip}`;
  const outcome = await c.env.ROOM_RATE_LIMITER.limit({ key });
  if (!outcome.success) {
    return c.text("Rate limit exceeded", 429);
  }
  return next();
});

function getLocaleFromRequest(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }): Locale {
  // Check query parameter first (for language switcher)
  const queryLang = c.req.query("lang");
  if (queryLang && supportedLocales.includes(queryLang as Locale)) {
    return queryLang as Locale;
  }
  // Fall back to Accept-Language header
  return detectLocale(c.req.header("Accept-Language"));
}

app.get("/", (c) => {
  const locale = getLocaleFromRequest(c);
  const t = getTranslations(locale);
  return c.render(<TopPage t={t} locale={locale} />);
});

app.get("/r/:roomId", async (c) => {
  const locale = getLocaleFromRequest(c);
  const t = getTranslations(locale);
  const roomId = c.req.param("roomId");
  const id = c.env.ROOM.idFromName(roomId);
  const stub = c.env.ROOM.get(id);
  const config = (await stub.fetch("https://room/config").then((res) => res.json())) as { maxConcurrent?: number };
  const maxConcurrent = normalizeMaxConcurrent(config.maxConcurrent);
  return c.render(<RoomPage roomId={roomId} maxConcurrent={maxConcurrent} t={t} locale={locale} />);
});

app.post("/api/rooms", async (c) => {
  const body = (await c.req.json()) as { maxConcurrent?: number; creatorCid?: string };
  const maxConcurrent = normalizeMaxConcurrent(body.maxConcurrent);
  const creatorCid = typeof body.creatorCid === "string" ? body.creatorCid : undefined;
  const roomId = generateRoomId(10);
  const id = c.env.ROOM.idFromName(roomId);
  const stub = c.env.ROOM.get(id);
  await stub.fetch("https://room/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxConcurrent, creatorCid }),
  });
  return c.json({ roomId });
});

app.get("/ws/:roomId", (c) => {
  const upgrade = c.req.header("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  const roomId = c.req.param("roomId");
  const id = c.env.ROOM.idFromName(roomId);
  const stub = c.env.ROOM.get(id);
  return stub.fetch(c.req.raw);
});

app.get("*", (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export { Room };
export default app;

function generateRoomId(len: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

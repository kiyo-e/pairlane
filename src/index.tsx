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
const LANG_COOKIE = "lang";

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

function getLocaleFromRequest(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }): { locale: Locale; source: "query" | "cookie" | "accept" } {
  // Check query parameter first (for language switcher)
  const queryLang = c.req.query("lang");
  if (queryLang && supportedLocales.includes(queryLang as Locale)) {
    return { locale: queryLang as Locale, source: "query" };
  }

  const cookieLang = getLocaleFromCookie(c.req.header("Cookie"));
  if (cookieLang) return { locale: cookieLang, source: "cookie" };

  // Fall back to Accept-Language header
  return { locale: detectLocale(c.req.header("Accept-Language")), source: "accept" };
}

function getLocaleFromCookie(cookieHeader?: string): Locale | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== LANG_COOKIE) continue;
    const value = valueParts.join("=");
    if (supportedLocales.includes(value as Locale)) {
      return value as Locale;
    }
  }
  return null;
}

function persistLocaleCookie(c: { header: (name: string, value: string) => void }, locale: Locale) {
  c.header("Set-Cookie", `${LANG_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
}

app.get("/", (c) => {
  const { locale, source } = getLocaleFromRequest(c);
  if (source === "query") persistLocaleCookie(c, locale);
  const t = getTranslations(locale);
  return c.render(<TopPage t={t} locale={locale} />);
});

app.get("/r/:roomId", async (c) => {
  const { locale, source } = getLocaleFromRequest(c);
  if (source === "query") persistLocaleCookie(c, locale);
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

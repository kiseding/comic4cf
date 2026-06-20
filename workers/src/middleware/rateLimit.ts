import type { Context, Next } from "hono";

const memCounters = new Map<string, { count: number; resetAt: number }>();
const MEM_TTL = 120_000;
let lastSweep = Date.now();

function sweepExpired(now: number) {
  for (const [k, v] of memCounters) {
    if (v.resetAt < now) memCounters.delete(k);
  }
  lastSweep = now;
}

function memIncr(key: string): number {
  const now = Date.now();
  if (now - lastSweep > 60_000) sweepExpired(now);
  let entry = memCounters.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + MEM_TTL };
    memCounters.set(key, entry);
    return 1;
  }
  entry.count++;
  if (memCounters.size > 10000) sweepExpired(now);
  return entry.count;
}

export function rateLimit(limit: number = 60) {
  return async function rateLimitMiddleware(c: Context, next: Next) {
    const env = c.env as { CACHE?: KVNamespace };
    const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / 60);
    const key = `ratelimit:${limit}:${ip}:${window}`;

    const memCount = memIncr(key);
    if (memCount >= limit) {
      return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
    }

    const cache = env.CACHE;
    if (cache) {
      try {
        const kvCount = await cache.get<number>(key, "json");
        if (kvCount && kvCount >= limit) {
          return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
        }
        await cache.put(key, JSON.stringify((kvCount || 0) + 1), { expirationTtl: 120 });
      } catch {}
    }

    return next();
  };
}

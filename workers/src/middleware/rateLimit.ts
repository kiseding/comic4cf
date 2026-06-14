// IP-based rate limiting middleware using KV store
import type { Context, Next } from "hono";

export function rateLimit(limit: number = 60) {
  return async function rateLimitMiddleware(c: Context, next: Next) {
    const env = c.env as { CACHE?: KVNamespace };
    const cache = env.CACHE;
    if (!cache) return next();

    const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / 60);
    const key = `ratelimit:${limit}:${ip}:${window}`;

    try {
      const count = await cache.get<number>(key, "json");
      if (count && count >= limit) {
        return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
      }
      await cache.put(key, JSON.stringify((count || 0) + 1), { expirationTtl: 120 });
    } catch {}

    return next();
  };
}

// API routes for the comic reader
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { signToken, verifyToken, extractToken, type JwtPayload } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import * as db from "../db/schema";
import { getRegistry } from "../sites/registry";
import type { SearchResult, SiteRegistry } from "../sites/registry";
import type { Context, Next } from "hono";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { rateLimit } from "../middleware/rateLimit";

type Bindings = {
  DB?: D1Database;
  CACHE?: KVNamespace;
  JWT_SECRET?: string;
};

type Variables = {
  user: JwtPayload;
};

interface LoginInput {
  username: string;
  password: string;
}

interface BookshelfInput {
  site: string;
  comicId: string;
  title?: string;
  author?: string;
  coverUrl?: string;
  description?: string;
  sourceUrl?: string;
}

interface HistoryInput {
  site: string;
  comicId: string;
  title?: string;
  author?: string;
  coverUrl?: string;
  chapterId?: string;
  chapterTitle?: string;
}

interface AdminUserInput {
  username: string;
  password: string;
}

interface ProgressInput {
  chapterIndex: number;
  chapterId: string;
  chapterTitle: string;
  title?: string;
  author?: string;
  coverUrl?: string;
}

const api = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function DB(c: { env: Bindings }): D1Database {
  if (!c.env.DB) throw new Response(JSON.stringify({ error: "数据库未配置" }), { status: 500, headers: { "Content-Type": "application/json" } });
  return c.env.DB;
}

async function getCache<T>(c: { env: Bindings }, key: string): Promise<T | null> {
  if (!c.env.CACHE) return null;
  try { return await c.env.CACHE.get(key, "json") as T; } catch { return null; }
}

// ========== Auth middleware ==========
async function authMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const token = extractToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "未登录" }, 401);
  const secret = c.env.JWT_SECRET as string;
  const payload = await verifyToken(token, secret);
  if (!payload) return c.json({ error: "登录已过期" }, 401);
  c.set("user", payload);
  return next();
}

async function adminMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const user = c.get("user") as JwtPayload;
  if (user.userId !== 1) return c.json({ error: "需要管理员权限" }, 403);
  return next();
}

// ========== Auth routes ==========
api.post("/auth/login", async (c) => {
  const d = DB(c);
  const { username, password } = await c.req.json<LoginInput>();
  if (!username || !password) return c.json({ error: "用户名和密码不能为空" }, 400);
  const user = await db.getUserByUsername(d, username);
  if (!user) return c.json({ error: "用户名或密码错误" }, 401);
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: "用户名或密码错误" }, 401);
  const token = await signToken({ userId: user.id, username: user.username }, c.env.JWT_SECRET!);
  return c.json({ token, user: { id: user.id, username: user.username, isAdmin: user.id === 1 } });
});

api.get("/auth/me", authMiddleware, async (c) => {
  const user = c.get("user") as JwtPayload;
  return c.json({ user: { ...user, isAdmin: user.userId === 1 } });
});

api.put("/auth/change-password", authMiddleware, async (c) => {
  const d = DB(c);
  const user = c.get("user") as JwtPayload;
  const { oldPassword, newPassword } = await c.req.json();
  if (!oldPassword || !newPassword) return c.json({ error: "请输入新旧密码" }, 400);
  if (newPassword.length < 6) return c.json({ error: "新密码至少6个字符" }, 400);
  const u = await db.getUserById(d, user.userId);
  if (!u) return c.json({ error: "用户不存在" }, 404);
  const valid = await verifyPassword(oldPassword, u.password_hash);
  if (!valid) return c.json({ error: "旧密码错误" }, 400);
  const hash = await hashPassword(newPassword);
  await db.updateUserPassword(d, user.userId, hash);
  return c.json({ ok: true });
});

// ========== Admin routes ==========
api.get("/admin/users", authMiddleware, adminMiddleware, async (c) => {
  const d = DB(c);
  const users = await db.listUsers(d);
  return c.json({ users });
});

api.post("/admin/users", authMiddleware, adminMiddleware, async (c) => {
  const d = DB(c);
  const { username, password } = await c.req.json<AdminUserInput>();
  if (!username || !password) return c.json({ error: "用户名和密码不能为空" }, 400);
  if (username.length < 2 || username.length > 20) return c.json({ error: "用户名2-20个字符" }, 400);
  if (password.length < 6) return c.json({ error: "密码至少6个字符" }, 400);
  const existing = await db.getUserByUsername(d, username);
  if (existing) return c.json({ error: "用户名已存在" }, 409);
  const hash = await hashPassword(password);
  const user = await db.createUser(d, username, hash);
  return c.json({ user: { id: user.id, username: user.username } }, 201);
});

api.delete("/admin/users/:id", authMiddleware, adminMiddleware, async (c) => {
  const d = DB(c);
  const id = parseInt(c.req.param("id"));
  if (id === 1) return c.json({ error: "不能删除管理员" }, 400);
  await db.deleteUser(d, id);
  return c.json({ ok: true });
});

api.put("/admin/users/:id/reset-password", authMiddleware, adminMiddleware, async (c) => {
  const d = DB(c);
  const id = parseInt(c.req.param("id"));
  const { password } = await c.req.json();
  if (!password || password.length < 6) return c.json({ error: "密码至少6个字符" }, 400);
  const hash = await hashPassword(password);
  await db.updateUserPassword(d, id, hash);
  return c.json({ ok: true });
});

// ========== Sources ==========
api.get("/sources", (c) => {
  return c.json({ sources: getRegistry().getSearchableSources() });
});

// ========== Homepage / Category ==========
api.get("/homepage", async (c) => {
  const tag = c.req.query("tag") || "";
  const cacheKey = tag ? "homepage:" + tag : "homepage";
  const cached = await getCache<{ books: SearchResult[] }>(c, cacheKey);
  if (cached?.books?.length) return c.json(cached);
  try {
    const books = await getRegistry().getCategoryBooks(tag);
    if (c.env.CACHE) await c.env.CACHE.put(cacheKey, JSON.stringify({ books }), { expirationTtl: 1800 });
    return c.json({ books });
  } catch (e: any) {
    console.error("Homepage fetch failed:", e?.message || e);
    return c.json({ books: [], error: e?.message || "加载失败" });
  }
});

// ========== Search ==========
api.post("/search", async (c) => {
  const { keyword, sites } = await c.req.json<{ keyword: string; sites?: string[] }>();
  if (!keyword || !keyword.trim()) return c.json({ results: [] });
  const kw = keyword.trim();

  // URL detection
  try { new URL(kw); } catch {}
  const registry = getRegistry();
  const resolved = registry.resolveURL(kw);
  if (resolved) {
    try {
      const detail = await registry.getComicDetail(resolved.siteKey, resolved.comicId);
      return c.json({ urlSearch: true, item: { site: resolved.siteKey, comicId: resolved.comicId, title: detail.title, author: detail.author, description: detail.description, coverUrl: detail.coverUrl, url: kw, latestChapter: "", status: detail.status, categories: detail.categories } });
    } catch (e: any) { return c.json({ error: e?.message || "链接解析失败" }, 502); }
  }

  const cacheKey = "search:" + kw.toLowerCase();
  const cached = await getCache<{ results: SearchResult[] }>(c, cacheKey);
  if (cached?.results?.length) return c.json(cached);

  try {
    const results = await registry.searchAll(sites || [], kw, 30);
    if (c.env.CACHE) await c.env.CACHE.put(cacheKey, JSON.stringify({ results }), { expirationTtl: 300 });
    return c.json({ results });
  } catch (e: any) {
    console.error("Search failed:", e?.message || e);
    return c.json({ results: [], error: e?.message || "搜索失败" });
  }
});

api.post("/search/stream", async (c) => {
  const { keyword, sites } = await c.req.json<{ keyword: string; sites?: string[] }>();
  if (!keyword || !keyword.trim()) return c.json({ results: [] });
  const kw = keyword.trim();
  const registry = getRegistry();
  const targetSources = (sites || []).length > 0
    ? sites!.map(k => registry.getSource(k)).filter(Boolean)
    : registry.getSearchableSources().map(m => registry.getSource(m.key)).filter(Boolean);

  return streamSSE(c, async (stream) => {
    const promises = targetSources.map(async (source) => {
      try {
        const items = await source!.search(kw, 10);
        await stream.writeSSE({ data: JSON.stringify({ site: source!.key, results: items }) });
      } catch (e: any) {
        await stream.writeSSE({ data: JSON.stringify({ site: source!.key, error: e?.message || "失败" }) });
      }
    });
    await Promise.all(promises);
    await stream.writeSSE({ data: JSON.stringify({ done: true }) });
  });
});

// ========== Comic detail ==========
api.get("/comics/:site/:comicId", async (c) => {
  const { site, comicId } = c.req.param();
  const cacheKey = "comic:" + site + ":" + comicId;
  const cached = await getCache<any>(c, cacheKey);
  if (cached) return c.json(cached);
  try {
    const detail = await getRegistry().getComicDetail(site, comicId);
    if (c.env.CACHE) await c.env.CACHE.put(cacheKey, JSON.stringify(detail), { expirationTtl: 600 });
    return c.json(detail);
  } catch (e: any) {
    console.error("Comic detail fetch failed:", e?.message || e);
    return c.json({ error: "服务暂时不可用" }, 502);
  }
});

// ========== Chapter images ==========
api.get("/comics/:site/:comicId/:chapterId", async (c) => {
  const { site, comicId, chapterId } = c.req.param();
  try {
    const rawImages = await getRegistry().getChapterImages(site, comicId, {
      id: chapterId,
      url: c.req.query("url") || "",
      title: c.req.query("title") || "",
    });
    return c.json({
      id: chapterId,
      title: c.req.query("title") || "",
      total: rawImages.length,
      images: rawImages,
    });
  } catch (e: any) {
    console.error("Chapter images fetch failed:", e?.message || e);
    return c.json({ error: e?.message || "服务暂时不可用", unavailable: true, images: [], total: 0 }, 200);
  }
});

api.get("/comics/:site/:comicId/:chapterId/stream", async (c) => {
  const { site, comicId, chapterId } = c.req.param();
  try {
    const rawImages = await getRegistry().getChapterImages(site, comicId, {
      id: chapterId,
      url: c.req.query("url") || "",
      title: c.req.query("title") || "",
    });
    const encoder = new TextEncoder();
    let skipped = 0;
    const signal = c.req.raw.signal;
    const stream = new ReadableStream({
      async start(controller) {
        for (const url of rawImages) {
          if (signal.aborted) break;
          try {
            const imgResp = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
            if (!imgResp.ok) { skipped++; continue; }
            const imgBuf = await imgResp.arrayBuffer();
            const ct = imgResp.headers.get("content-type") || "image/jpeg";
            const ctBytes = encoder.encode(ct);
            const ctLen = new Uint8Array([ctBytes.length & 0xFF, (ctBytes.length >> 8) & 0xFF]);
            const dataLenBytes = new Uint8Array([
              imgBuf.byteLength & 0xFF,
              (imgBuf.byteLength >> 8) & 0xFF,
              (imgBuf.byteLength >> 16) & 0xFF,
              (imgBuf.byteLength >> 24) & 0xFF,
            ]);
            controller.enqueue(ctLen);
            controller.enqueue(ctBytes);
            controller.enqueue(dataLenBytes);
            controller.enqueue(new Uint8Array(imgBuf));
          } catch { if (signal.aborted) break; skipped++; }
        }
        controller.enqueue(new Uint8Array([0xFF, 0xFF]));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
        "X-Skipped-Images": String(skipped),
      },
    });
  } catch (e: any) {
    console.error("Stream fetch failed:", e?.message || e);
    return c.json({ error: e?.message || "流获取失败", unavailable: true }, 200);
  }
});

// ========== Bookshelf (authenticated) ==========
api.get("/bookshelf", authMiddleware, async (c) => {
  const d = DB(c); const items = await db.listBookshelf(d, (c.get("user") as JwtPayload).userId);
  return c.json({ items });
});

api.post("/bookshelf", authMiddleware, async (c) => {
  const d = DB(c); const u = c.get("user") as JwtPayload; const b = await c.req.json<BookshelfInput>();
  const item = await db.addToBookshelf(d, u.userId, {
    site: b.site, comicId: b.comicId, title: b.title || "", author: b.author || "",
    coverUrl: b.coverUrl || "", description: b.description || "", sourceUrl: b.sourceUrl || "",
  });
  return c.json({ item }, 201);
});

api.delete("/bookshelf/:site/:comicId", authMiddleware, async (c) => {
  const d = DB(c); const u = c.get("user") as JwtPayload; const { site, comicId } = c.req.param();
  const removed = await db.removeFromBookshelf(d, u.userId, site, comicId);
  if (!removed) return c.json({ error: "未找到" }, 404);
  return c.json({ ok: true });
});

// ========== History (authenticated) ==========
api.get("/history", authMiddleware, async (c) => {
  const d = DB(c); const items = await db.listHistory(d, (c.get("user") as JwtPayload).userId);
  return c.json({ items });
});

api.post("/history", authMiddleware, async (c) => {
  const d = DB(c); const u = c.get("user") as JwtPayload; const b = await c.req.json<HistoryInput>();
  await db.addHistory(d, u.userId, {
    site: b.site, comicId: b.comicId, title: b.title || "", author: b.author || "",
    coverUrl: b.coverUrl || "", chapterId: b.chapterId || "", chapterTitle: b.chapterTitle || "",
  });
  return c.json({ ok: true });
});

api.delete("/history", authMiddleware, async (c) => {
  const d = DB(c);
  await d.prepare("DELETE FROM history WHERE user_id = ?").bind((c.get("user") as JwtPayload).userId).run();
  return c.json({ ok: true });
});

// ========== Reading progress ==========
api.put("/progress/:site/:comicId", authMiddleware, async (c) => {
  const d = DB(c);
  const u = c.get("user") as JwtPayload;
  const { site, comicId } = c.req.param();
  const { chapterIndex, chapterId, chapterTitle, title, author, coverUrl } = await c.req.json<ProgressInput>();
  const result = await d.prepare(
    "UPDATE bookshelf SET chapter_index = ?, chapter_id = ?, chapter_title = ?, updated_at = datetime('now') WHERE user_id = ? AND site = ? AND comic_id = ?"
  ).bind(chapterIndex, chapterId, chapterTitle, u.userId, site, comicId).run();
  if (result.meta.changes === 0) {
    await d.prepare(
      "INSERT INTO bookshelf (user_id, site, comic_id, title, author, cover_url, chapter_index, chapter_id, chapter_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, site, comic_id) DO UPDATE SET chapter_index = excluded.chapter_index, chapter_id = excluded.chapter_id, chapter_title = excluded.chapter_title, updated_at = datetime('now')"
    ).bind(u.userId, site, comicId, title || "", author || "", coverUrl || "", chapterIndex, chapterId, chapterTitle).run();
  }
  return c.json({ ok: true });
});

// ========== Proxy image ==========
api.get("/proxy-image", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url required" }, 400);
  try {
    const resp = await fetch(url, { headers: { Referer: new URL(url).origin }, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return c.json({ error: "image fetch failed" }, 502);
    return new Response(resp.body, {
      headers: {
        "Content-Type": resp.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e: any) {
    return c.json({ error: e?.message || "proxy failed" }, 502);
  }
});

export default api;

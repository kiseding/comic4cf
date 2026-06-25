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

interface AdminResetPasswordInput {
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
  const id = parseInt(c.req.param("id")!);
  if (id === 1) return c.json({ error: "不能删除管理员" }, 400);
  await db.deleteUser(d, id);
  return c.json({ ok: true });
});

api.put("/admin/users/:id/reset-password", authMiddleware, adminMiddleware, async (c) => {
  const d = DB(c);
  const id = parseInt(c.req.param("id")!);
  const { password } = await c.req.json<AdminResetPasswordInput>();
  if (!password || password.length < 6) return c.json({ error: "密码至少6个字符" }, 400);
  const hash = await hashPassword(password);
  await db.updateUserPassword(d, id, hash);
  return c.json({ ok: true });
});

// ========== Rate limiting for public endpoints ==========
api.use("/auth/login", rateLimit(10));
api.use("/auth/change-password", rateLimit(10));
api.use("/sources", rateLimit());
api.use("/homepage", rateLimit());
api.use("/search", rateLimit());

// ========== Source list ==========
api.get("/sources", async (c) => {
  return c.json({ sources: getRegistry().getSearchableSources() });
});

// ========== Image proxy (for HTTP-only sources like yymanhua) ==========
api.get("/proxy-image", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "缺少url参数" }, 400);

  // Only allow proxying from known domains
  const allowed = ["cover.yymanhua.com", "image.yymanhua.com", "cover.xmanhua.com", "image.xmanhua.com"];
  try {
    const target = new URL(url);
    if (!allowed.some(d => target.hostname === d)) {
      return c.json({ error: "不允许的域名" }, 403);
    }
  } catch {
    return c.json({ error: "无效URL" }, 400);
  }

  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://yymanhua.com/" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return c.json({ error: "图片获取失败" }, 502);
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("content-type") || "image/jpeg";
    return new Response(buf, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return c.json({ error: "图片代理失败" }, 502);
  }
});

// ========== Homepage ==========
api.get("/homepage", async (c) => {
  const tag = c.req.query("tag") || "";
  // KV cache so repeated chip taps don't hammer source sites
  const cacheKey = `v2:homepage:${tag || "_top"}`;
  const cachedHome = await getCache<any>(c, cacheKey);
  if (cachedHome) return c.json(cachedHome);
  try {
    const books = tag
      ? await getRegistry().getCategoryBooks(tag)
      : await getRegistry().getHomepageBooks();
    const resp = { books, tag };
    if (c.env.CACHE && books.length > 0) {
      c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(resp), { expirationTtl: 1800 }));
    }
    return c.json(resp);
  } catch {
    console.error("Homepage fetch failed"); return c.json({ error: "服务暂时不可用" }, 502);
  }
});

const cacheLocks = new Map<string, Promise<void>>();
function withCacheLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = cacheLocks.get(key);
  if (existing) {
    return existing.then(() => fn());
  }
  const p = fn().finally(() => cacheLocks.delete(key));
  cacheLocks.set(key, p as unknown as Promise<void>);
  return p;
}

async function resolveURLAsSearch(c: { env: Bindings }, registry: SiteRegistry, keyword: string) {
  if (!keyword.startsWith('http://') && !keyword.startsWith('https://')) return null;
  try {
    new URL(keyword);
    const resolved = registry.resolveURL(keyword);
    if (resolved) {
      const detail = await registry.getComicDetail(resolved.siteKey, resolved.comicId);
      return { urlSearch: true, item: { key: `${resolved.siteKey}|${resolved.comicId}`, site: resolved.siteKey, comicId: resolved.comicId, title: detail.title, author: detail.author, description: detail.description, coverUrl: detail.coverUrl, url: detail.sourceUrl } };
    }
  } catch {}
  return null;
}

// ========== Search ==========
api.post("/search", async (c) => {
  const { keyword, sites } = await c.req.json();
  if (!keyword?.trim()) return c.json({ error: "关键词不能为空" }, 400);

  const cacheKey = `v2:comic-search:${keyword.trim().toLowerCase()}`;
  const cachedSearch = await getCache<any>(c, cacheKey);
  if (cachedSearch) return c.json(cachedSearch);

  const registry = getRegistry();
  const urlResult = await resolveURLAsSearch(c, registry, keyword);
  if (urlResult) return c.json(urlResult);
  const { results } = await withCacheLock(cacheKey, async () => {
    const recheck = await getCache<any>(c, cacheKey);
    if (recheck) return recheck;
    const results = await registry.searchAll(sites || [], keyword.trim(), 50);
    if (c.env.CACHE) c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify({ results }), { expirationTtl: 300 }));
    return { results };
  });
  return c.json({ results });
});

// ========== Search (SSE streaming) ==========
api.post("/search/stream", async (c) => {
  const { keyword, sites } = await c.req.json();
  if (!keyword?.trim()) return c.json({ error: "关键词不能为空" }, 400);

  const registry = getRegistry();
  const kw = keyword.trim();

  const urlResult = await resolveURLAsSearch(c, registry, kw);
  if (urlResult) return c.json(urlResult);

  const targetSources: string[] = (sites && sites.length > 0)
    ? sites.filter((k: string) => registry.getSource(k))
    : registry.getSearchableSources().map(s => s.key);

  // KV cache: replay aggregated results immediately, grouped by site to keep onResult(site, items) semantics.
  const cacheKey = `v2:comic-search:${kw.toLowerCase()}`;
  const cached = await getCache<{ results: SearchResult[] }>(c, cacheKey);

  return streamSSE(c, async (stream) => {
    const aborted = () => c.req.raw.signal.aborted;
    if (aborted()) return;

    if (cached?.results?.length) {
      const bySite = new Map<string, SearchResult[]>();
      for (const it of cached.results) {
        const arr = bySite.get(it.site) || [];
        arr.push(it);
        bySite.set(it.site, arr);
      }
      for (const [site, items] of bySite) {
        if (aborted()) return;
        try { await stream.writeSSE({ data: JSON.stringify({ site, results: items }) }); } catch { return; }
      }
      try { await stream.writeSSE({ data: JSON.stringify({ done: true }) }); } catch {}
      return;
    }

    const aggregated: SearchResult[] = [];
    const pending = targetSources.map(async (siteKey: string) => {
      try {
        const items = await registry.getSource(siteKey)!.search(kw, 10);
        for (const item of items) {
          if (aborted()) return;
          aggregated.push({ ...item, site: siteKey });
          try { await stream.writeSSE({ data: JSON.stringify({ site: siteKey, results: [item] }) }); } catch { return; }
        }
      } catch (e) {
        console.error(e);
        try { await stream.writeSSE({ data: JSON.stringify({ site: siteKey, error: "搜索失败" }) }); } catch {}
      }
    });
    await Promise.all(pending);
    if (aborted()) return;
    try { await stream.writeSSE({ data: JSON.stringify({ done: true }) }); } catch {}
    if (c.env.CACHE && aggregated.length) {
      c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify({ results: aggregated }), { expirationTtl: 300 }));
    }
  });
});

// ========== Comic detail ==========
api.get("/comics/:site/:comicId", async (c) => {
  const { site, comicId } = c.req.param();
  const cacheKey = `v5:comic:${site}:${comicId}`;
  const cached = await getCache<any>(c, cacheKey);
  if (cached) return c.json(cached);
  try {
    const detail = await getRegistry().getComicDetail(site, comicId);
    if (c.env.CACHE) { c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(detail), { expirationTtl: 600 })); }
    return c.json(detail);
  } catch { console.error("Comic detail fetch failed"); return c.json({ error: "服务暂时不可用" }, 502); }
});

// ========== DEBUG chapterimage ==========

api.get("/debug/chapterimage", async (c) => {
  const site = c.req.query("site") || "yymanhua";
  const chapterUrl = c.req.query("url") || "";
  const altBase = site === "yymanhua" ? "http://yymanhua.com" : "https://xmanhua.com";
  try {
    const html = await fetch(chapterUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: altBase + "/",
      },
      signal: AbortSignal.timeout(15000),
    }).then(r => r.text()).catch(e => "FETCH_ERROR: " + (e?.message || e));

    const extractVar = (name: string): string => {
      const re = new RegExp("(?:var|let|const)\\s+" + name + "\\s*=\\s*\"([^\"]*)\"");
      const m = (typeof html === "string" ? html : "").match(re);
      return m ? m[1] : "";
    };
    const extractNum = (name: string): number => {
      const re = new RegExp("(?:var|let|const)\\s+" + name + "\\s*=\\s*(\\d+)");
      const m = (typeof html === "string" ? html : "").match(re);
      return m ? parseInt(m[1]) : 0;
    };
    const cid = extractNum("YYMANHUA_CID") || extractNum("MANGABZ_CID") || extractNum("MH_CID");
    const mid = extractNum("YYMANHUA_MID") || extractNum("MANGABZ_MID") || extractNum("MH_MID");
    const sign = extractVar("YYMANHUA_VIEWSIGN");
    const signDt = extractVar("YYMANHUA_VIEWSIGN_DT");
    const imageCount = extractNum("YYMANHUA_IMAGE_COUNT");

    let ashxBody = "";
    let ashxStatus = 0;
    if (sign && imageCount > 0 && cid > 0) {
      const params = new URLSearchParams({ cid: String(cid), page: "1", key: "", _cid: String(cid), _mid: String(mid), _dt: signDt, _sign: sign });
      try {
        const r = await fetch(altBase + "/chapterimage.ashx?" + params.toString(), {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Referer: chapterUrl, "X-Requested-With": "XMLHttpRequest" },
          signal: AbortSignal.timeout(10000),
        });
        ashxStatus = r.status;
        ashxBody = await r.text();
      } catch (e: any) { ashxBody = "FETCH_ERROR: " + (e?.message || e); }
    }

    return c.json({
      chapterUrl, altBase,
      htmlLen: typeof html === "string" ? html.length : 0,
      htmlHead: typeof html === "string" ? html.substring(0, 800) : html,
      vars: { cid, mid, sign: sign ? sign.substring(0, 20) + "..." : "", signDt, imageCount },
      ashxStatus,
      ashxBodyLen: ashxBody.length,
      ashxBodyHead: ashxBody.substring(0, 500),
      ashxBodyTail: ashxBody.length > 500 ? ashxBody.substring(ashxBody.length - 300) : "",

      // Test manual unpacking
      unpackedPreview: (() => {
        try {
          const m = ashxBody.match(/\x27([^\x27]*)\x27,(\d+),(\d+),\x27([^\x27]*)\x27\)\)?;?\s*$/s);
          if (!m) return "NO MATCH";
          const [, pkd, rad, cnt, kys] = m;
          const radix = parseInt(rad);
          const keys = kys.split("|");
          const decode = (c: number): string => {
            if (c < radix) return "";
            return decode(Math.floor(c / radix)) + (c % radix > 35 ? String.fromCharCode(c % radix + 29) : (c % radix).toString(36));
          };
          const dict: Record<string,string> = {};
          for (let i = 0; i < parseInt(cnt); i++) { const enc = decode(i); if (enc) dict[enc] = keys[i] || enc; }
          let upk = pkd;
          const toks = Object.keys(dict).sort((a,b) => b.length - a.length);
          for (const t of toks) upk = upk.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"), dict[t]);
          return upk.substring(0, 500);
        } catch (e: any) { return "ERROR: " + (e?.message || e); }
      })(),
    });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

// Convert HTTP image URLs from known sources to proxy URLs so they work on HTTPS pages
const proxyImageUrls = (urls: string[]): string[] => urls.map(url => {
  try {
    const u = new URL(url);
    const proxyDomains = ["image.yymanhua.com", "cover.yymanhua.com", "image.xmanhua.com", "cover.xmanhua.com"];
    if (u.protocol === "http:" && proxyDomains.some(d => u.hostname === d)) {
      return "/api/proxy-image?url=" + encodeURIComponent(url);
    }
  } catch {}
  return url;
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
      images: proxyImageUrls(rawImages),
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
    `UPDATE bookshelf SET chapter_index = ?, chapter_id = ?, chapter_title = ?, updated_at = datetime('now')
     WHERE user_id = ? AND site = ? AND comic_id = ?`
  ).bind(chapterIndex, chapterId, chapterTitle, u.userId, site, comicId).run();
  if (result.meta.changes === 0) {
    await d.prepare(
      `INSERT INTO bookshelf (user_id, site, comic_id, title, author, cover_url, chapter_index, chapter_id, chapter_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, site, comic_id) DO UPDATE SET
         chapter_index = excluded.chapter_index, chapter_id = excluded.chapter_id,
         chapter_title = excluded.chapter_title, updated_at = datetime('now')`
    ).bind(u.userId, site, comicId, title || "", author || "", coverUrl || "", chapterIndex, chapterId, chapterTitle).run();
  }
  return c.json({ ok: true });
});
export default api;

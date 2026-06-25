// www.zaimanhua.com (再漫画)
// API base: https://manhua.zaimanhua.com
// ComicId format: pinyin name (e.g. "beats"), numeric ID fetched from detail API internally.
import type { SiteSource, SearchResult, ComicDetail, ResolvedURL, ChapterItem } from "../types";
import { t2sDeep } from "../utils/zhconv";

const API_BASE = "https://www.zaimanhua.com";
// Anonymous auth params embedded in the Nuxt SPA
const AUTH = {
  channel: "pc",
  app_name: "zmh",
  version: "1.0.0",
  uid: "113119197",
};

function apiParams(extra: Record<string, string | number>): string {
  const p = new URLSearchParams();
  p.set("channel", AUTH.channel);
  p.set("app_name", AUTH.app_name);
  p.set("version", AUTH.version);
  p.set("timestamp", String(Date.now()));
  p.set("uid", AUTH.uid);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

async function apiGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = `${API_BASE}${path}?${apiParams(params)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.zaimanhua.com/", Platform: "pc" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json<{ errno: number; errmsg: string; data: T }>();
  if (json.errno !== 0) throw new Error(json.errmsg || "API error");
  return json.data;
}

export class ZaiManhuaSource implements SiteSource {
  readonly key = "zaimanhua";
  readonly displayName = "再漫画";
  readonly tags = ["中文", "国漫", "日漫"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (u.hostname !== "www.zaimanhua.com" && u.hostname !== "manhua.zaimanhua.com") return null;

      // /info/{pinyin}.html
      const infoMatch = u.pathname.match(/^\/info\/([^/]+)\.html$/);
      if (infoMatch) return { siteKey: this.key, comicId: infoMatch[1], canonical: url };

      // /view/{pinyin}/{comic_id}/{chapter_id}
      const viewMatch = u.pathname.match(/^\/view\/([^/]+)\/(\d+)\/(\d+)/);
      if (viewMatch) {
        return { siteKey: this.key, comicId: viewMatch[1], chapterId: viewMatch[3], canonical: url };
      }

      // /details/{comicName}/{pinyin}.html
      const detailMatch = u.pathname.match(/^\/details\/[^/]+\/([^/]+)\.html$/);
      if (detailMatch) return { siteKey: this.key, comicId: detailMatch[1], canonical: url };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const data = await apiGet<{ list: any[] }>("/app/v1/search/index", { keyword });
    return (data.list || []).slice(0, limit).map((item: any) => t2sDeep({
      site: this.key,
      comicId: item.comic_py || String(item.id),
      title: item.title || "",
      author: item.authors || "",
      description: "",
      url: `https://www.zaimanhua.com/info/${item.comic_py}.html`,
      coverUrl: item.cover || "",
      latestChapter: item.last_name || "",
      status: item.status === "已完结" ? "已完结" : "连载中",
    }));
  }

  async getCategoryBooks(tag: string): Promise<SearchResult[]> {
    const params: Record<string, string | number> = {};
    if (tag) params.tag = tag;
    const data = await apiGet<{ list: any[] }>("/api/v1/comic1/filter", params);
    return (data.list || []).slice(0, 30).map((item: any) => t2sDeep({
      site: this.key,
      comicId: item.comic_py || String(item.id),
      title: item.title || "",
      author: item.authors || "",
      description: "",
      url: `https://www.zaimanhua.com/info/${item.comic_py}.html`,
      coverUrl: item.cover || "",
      latestChapter: item.last_name || "",
      status: item.status === "已完结" ? "已完结" : "连载中",
    }));
  }

  async getDetail(comicId: string): Promise<ComicDetail> {
    const data = await apiGet<{ comicInfo: any }>("/api/v1/comic1/comic/detail", {
      comic_py: comicId,
    });
    const info = data.comicInfo;
    if (!info) throw new Error("漫画不存在");

    const chapters: ChapterItem[] = [];
    if (info.chapterList) {
      for (const group of info.chapterList) {
        if (!group.data) continue;
        for (const ch of group.data) {
          chapters.push(t2sDeep({
            id: String(ch.chapter_id),
            title: ch.chapter_title || "",
            url: `https://www.zaimanhua.com/view/${info.comicPy}/${info.id}/${ch.chapter_id}`,
            order: ch.chapter_order || chapters.length + 1,
          }));
        }
      }
    }

    return t2sDeep({
      site: this.key,
      comicId,
      title: info.title || comicId,
      author: info.authorInfo?.authorName || "未知",
      description: info.description || "",
      coverUrl: info.cover || "",
      sourceUrl: `https://www.zaimanhua.com/info/${comicId}.html`,
      status: info.status === "已完结" ? "已完结" : "连载中",
      categories: (info.types || "").split("/").filter(Boolean).map((t: string) => t.trim()),
      chapters,
    });
  }

  async getChapterImages(
    _comicId: string,
    chapter: { id: string; url: string; title: string },
  ): Promise<string[]> {
    // Need numeric comic_id — extract from chapter.url
    let numericId = "";
    try {
      const u = new URL(chapter.url);
      const parts = u.pathname.split("/").filter(Boolean);
      // /view/{pinyin}/{comic_id}/{chapter_id}
      numericId = parts[2] || "";
    } catch {}

    if (!numericId) {
      // Fallback: fetch detail to get the numeric ID
      try {
        const detail = await apiGet<{ comicInfo: any }>("/api/v1/comic1/comic/detail", {
          comic_py: _comicId,
        });
        numericId = String(detail.comicInfo?.id || "");
      } catch {}
    }

    if (!numericId) throw new Error("无法获取漫画ID");

    const data = await apiGet<{ chapterInfo: any }>("/api/v1/comic1/chapter/detail", {
      comic_id: numericId,
      chapter_id: chapter.id,
    });

    return data.chapterInfo?.page_url || [];
  }
}

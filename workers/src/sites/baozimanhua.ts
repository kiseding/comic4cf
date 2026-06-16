// baozimh.com (包子漫画) — ported from keiyoushi/extensions-source Baozi.kt
// Comic page: /comic/<id>; chapter quick page: /comic/chapter/<id>/<section>_<chapter>.html
import type { SiteSource, SearchResult, ComicDetail, ResolvedURL, ChapterItem } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

async function asyncPool<T>(items: string[], limit: number, fn: (url: string) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(
      r => { results.push({ status: "fulfilled" as const, value: r }); },
      err => { results.push({ status: "rejected" as const, reason: err }); }
    );
    executing.add(p.then(() => {}, () => {}));
    const cleanup = () => executing.delete(p);
    p.then(cleanup, cleanup);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}

const MIRRORS = [
  "www.baozimh.com",
  "baozimh.com",
  "www.baozimh.net",
  "baozimh.net",
  "www.baozimh.cc",
  "www.webmota.com",
  "webmota.com",
  "tw.webmota.com",
  "www.kukuc.co",
  "tw.kukuc.co",
  "www.twmanga.com",
  "tw.twmanga.com",
];
const PRIMARY = "https://www.baozimh.com";
// Search must hit baozimh.com directly (other mirrors don't host /search).
const SEARCH_BASE = "https://www.baozimh.com";

export class BaoziManhuaSource implements SiteSource {
  readonly key = "baozimh";
  readonly displayName = "包子漫画";
  readonly tags = ["中文", "国漫", "日漫"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!MIRRORS.some(d => u.hostname === d || u.hostname.endsWith("." + d.replace(/^www\./, "")))) return null;
      // /comic/<id>  or  /user/page_direct?comic_id=<id>&...
      const m = u.pathname.match(/^\/comic\/([^/?#]+)/);
      if (m) {
        const chapterMatch = u.pathname.match(/^\/comic\/chapter\/([^/]+)\/([^/]+)\.html/);
        if (chapterMatch) {
          return { siteKey: this.key, comicId: chapterMatch[1], chapterId: chapterMatch[2], canonical: `${PRIMARY}${u.pathname}` };
        }
        return { siteKey: this.key, comicId: m[1], canonical: `${PRIMARY}${u.pathname}` };
      }
      if (u.pathname.startsWith("/user/page_direct")) {
        const cid = u.searchParams.get("comic_id") || "";
        const section = u.searchParams.get("section_slot") || "";
        const chapter = u.searchParams.get("chapter_slot") || "";
        if (cid) return { siteKey: this.key, comicId: cid, chapterId: section && chapter ? `${section}_${chapter}` : undefined, canonical: u.toString() };
      }
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const url = `${SEARCH_BASE}/search?q=${encodeURIComponent(keyword)}`;
    const html = await fetchHTML(url, { headers: { Referer: SEARCH_BASE + "/" } });
    return this.parseListing(html, SEARCH_BASE).slice(0, limit);
  }

  async getCategoryBooks(tag: string): Promise<SearchResult[]> {
    const url = `${PRIMARY}/classify?type=${encodeURIComponent(tag)}&region=all&state=all&filter=*&page=1`;
    const html = await fetchHTML(url, { headers: { Referer: PRIMARY + "/" } });
    return this.parseListing(html, PRIMARY).slice(0, 30);
  }

  parseListing(html: string, base: string): SearchResult[] {
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("div.pure-g div a.comics-card__poster").each((_, el) => {
      const href = $(el).attr("href") || "";
      const m = href.match(/\/comic\/([^/?#]+)/);
      if (!m) return;
      const comicId = m[1];
      if (seen.has(comicId)) return;
      seen.add(comicId);

      const title = cleanText($(el).attr("title") || $(el).find("amp-img").attr("alt") || "");
      if (!title) return;

      const cover = $(el).find("amp-img").attr("src") || $(el).find("img").attr("src") || "";

      results.push({
        site: this.key,
        comicId,
        title,
        author: "",
        description: "",
        url: absolutizeURL(base, href),
        coverUrl: absolutizeURL(base, cover),
        latestChapter: "",
      });
    });

    return results;
  }

  async getDetail(comicId: string): Promise<ComicDetail> {
    const url = `${PRIMARY}/comic/${comicId}`;
    const html = await fetchHTML(url, { headers: { Referer: PRIMARY + "/" } });
    const $ = parseHTML(html);

    const title = cleanText($("h1.comics-detail__title").first().text());
    const author = cleanText($("h2.comics-detail__author").first().text());
    const description = cleanText($("p.comics-detail__desc").first().text());
    const coverUrl = absolutizeURL(PRIMARY, $("div.pure-g div > amp-img").first().attr("src") || "");

    const statusText = cleanText($("div.tag-list > span.tag").first().text());
    const status = statusText.includes("完结") || statusText.includes("完結") ? "已完结" : "连载中";

    // categories: tag-list span.tag (excluding the status one which is the first one)
    const categories: string[] = [];
    $("div.tag-list > span.tag").each((i, el) => {
      if (i === 0) return; // skip status
      const t = cleanText($(el).text());
      if (t) categories.push(t);
    });

    // Chapter list: prefer the section under "章节目录/章節目錄" header (full list, source order is old→new, reverse to new→old).
    // Fallback: latest chapters block when full list isn't present.
    const chapters: ChapterItem[] = [];

    const fullTitle = $(".section-title").filter((_, el) => {
      const t = $(el).text();
      return t.includes("章节目录") || t.includes("章節目錄");
    }).first();

    const chapterEls = fullTitle.length > 0
      ? fullTitle.parent().find(".comics-chapters").toArray()
      : $(".comics-chapters").toArray();

    for (const el of chapterEls) {
      const a = $(el).find("a").first();
      const href = a.attr("href") || "";
      const name = cleanText($(el).text());
      if (!href || !name) continue;
      const abs = absolutizeURL(PRIMARY, href);
      // Build a stable id from comic_id + section_slot + chapter_slot when present, else last url segment.
      let id = "";
      try {
        const cu = new URL(abs);
        const section = cu.searchParams.get("section_slot");
        const chap = cu.searchParams.get("chapter_slot");
        if (section && chap) id = `${section}_${chap}`;
        else id = cu.pathname.split("/").filter(Boolean).pop() || abs;
      } catch {
        id = abs;
      }
      chapters.push({ id, title: name, url: abs, order: chapters.length + 1 });
    }
    chapters.forEach((c, i) => { c.order = i + 1; });

    return {
      site: this.key,
      comicId,
      title: title || comicId,
      author: author || "未知",
      description,
      coverUrl,
      sourceUrl: url,
      status,
      categories,
      chapters,
    };
  }

  async getChapterImages(comicId: string, chapter: { id: string; url: string; title: string }): Promise<string[]> {
    const startUrl = this.toQuickPageUrl(comicId, chapter);
    const images: string[] = [];

    const fetchPage = async (url: string): Promise<{ images: string[]; nextUrl: string | null }> => {
      const html = await fetchHTML(url, { headers: { Referer: PRIMARY + "/" } });
      const $ = parseHTML(html);
      const pageImages: string[] = [];
      $(".comic-contain amp-img").each((_, img) => {
        const src = $(img).attr("src") || "";
        if (src) {
          const rewritten = src
            .replace("bzcdn.net", "baozicdn.com")
            .replace("baozicdn.com", "baozicdn.com");
          pageImages.push(rewritten);
        }
      });
      const nextEl = $("#next-chapter").first();
      const nextText = cleanText(nextEl.text());
      const nextHref = nextEl.attr("href") || "";
      const nextUrl = (nextText === "下一页" || nextText === "下一頁") && nextHref
        ? absolutizeURL(PRIMARY, nextHref)
        : null;
      return { images: pageImages, nextUrl };
    };

    // Page 1 — always sequential
    const page1 = await fetchPage(startUrl);
    images.push(...page1.images);
    if (!page1.nextUrl) return images;

    // Page 2 — fetch to confirm pagination URL pattern
    const page2 = await fetchPage(page1.nextUrl);
    images.push(...page2.images);
    if (!page2.nextUrl) return images;

    // Detect pattern: /path/base.html → /path/base_2.html → /path/base_3.html
    const dotIdx = startUrl.lastIndexOf('.');
    let parallelUrls: string[] = [];
    if (dotIdx > 0) {
      const base = startUrl.substring(0, dotIdx);
      const ext = startUrl.substring(dotIdx);
      if (page1.nextUrl === `${base}_2${ext}`) {
        for (let p = 3; p <= 30; p++) parallelUrls.push(`${base}_${p}${ext}`);
      }
    }

    if (parallelUrls.length > 0) {
      const results = await asyncPool(parallelUrls, 4, async (url) => {
        const r = await fetchPage(url);
        return { url, ...r };
      });
      for (const result of results) {
        if (result.status === "rejected") break;
        const page = result.value;
        images.push(...page.images);
        if (!page.nextUrl) break;
      }
    } else {
      // Sequential fallback when pattern can't be determined
      let next: string | null = page2.nextUrl;
      let safety = 28;
      while (next && safety-- > 0) {
        const page = await fetchPage(next);
        images.push(...page.images);
        next = page.nextUrl;
      }
    }

    return images;
  }

  private toQuickPageUrl(comicId: string, chapter: { id: string; url: string }): string {
    // chapter.id is "<section_slot>_<chapter_slot>" when we built it from the listing.
    const m = chapter.id.match(/^([^_]+)_(.+)$/);
    if (m) return `${PRIMARY}/comic/chapter/${comicId}/${m[1]}_${m[2]}.html`;

    // Fallback: derive from chapter.url (page_direct?...)
    try {
      const cu = new URL(chapter.url);
      const section = cu.searchParams.get("section_slot");
      const chap = cu.searchParams.get("chapter_slot");
      const cid = cu.searchParams.get("comic_id") || comicId;
      if (section && chap) return `${PRIMARY}/comic/chapter/${cid}/${section}_${chap}.html`;
    } catch {}
    // Last resort: use the original URL.
    return chapter.url || `${PRIMARY}/comic/${comicId}`;
  }
}

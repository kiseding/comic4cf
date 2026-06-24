// yymanhua.com (mangabz 系列) — 日本漫画在线阅读第一站
// Manga detail: /<id>yy/; Chapter: /m<id>/; Chapter list: /template-<mid>-s2/
// Image API: chapterimage.ashx?cid=&page=&_sign=&_dt=...
import type { SiteSource, SearchResult, ComicDetail, ResolvedURL, ChapterItem } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";
import { t2s, t2sDeep } from "../utils/zhconv";

const BASE = "http://www.yymanhua.com";
const ALT_BASE = "http://yymanhua.com";

export class YymanhuaSource implements SiteSource {
  readonly key = "yymanhua";
  readonly displayName = "YY漫画";
  readonly tags = ["中文", "日漫", "繁體"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (u.hostname !== "www.yymanhua.com" && u.hostname !== "yymanhua.com") return null;

      // /<id>yy/ — manga detail
      const mangaMatch = u.pathname.match(/^\/(\d+)yy\/$/);
      if (mangaMatch) {
        return { siteKey: this.key, comicId: mangaMatch[1], canonical: `${BASE}/${mangaMatch[1]}yy/` };
      }

      // /m<id>/ — chapter view
      const chapterMatch = u.pathname.match(/^\/m(\d+)\/$/);
      if (chapterMatch) {
        return { siteKey: this.key, comicId: "", chapterId: chapterMatch[1], canonical: `${BASE}/m${chapterMatch[1]}/` };
      }

      return null;
    } catch {
      return null;
    }
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const url = `${ALT_BASE}/search?title=${encodeURIComponent(keyword)}`;
    const html = await fetchHTML(url, { headers: { Referer: ALT_BASE + "/" } });
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("a.detail-list-form-item").each((_, el) => {
      const href = $(el).attr("href") || "";
      const m = href.match(/^\/(\d+)yy\/$/);
      if (!m) return;
      const comicId = m[1];
      if (seen.has(comicId)) return;
      seen.add(comicId);

      const title = cleanText($(el).attr("title") || $(el).text());
      if (!title) return;

      // Get the cover from a nearby element — the search results page
      // typically doesn't include covers inline; we fetch them on detail
      results.push(t2sDeep({
        site: this.key,
        comicId,
        title,
        author: "",
        description: "",
        url: `${BASE}/${comicId}yy/`,
        coverUrl: "",
        latestChapter: "",
      }));
    });

    return results.slice(0, limit);
  }

  async getDetail(comicId: string): Promise<ComicDetail> {
    const url = `${ALT_BASE}/${comicId}yy/`;
    const html = await fetchHTML(url, { headers: { Referer: ALT_BASE + "/" } });
    const $ = parseHTML(html);

    // Title: from <title> tag or h1
    let title = cleanText($("title").first().text());
    // Strip site suffix: "一拳超人漫畫_重置版278話已更新_一拳超人漫畫在線閱讀"
    // → "一拳超人"
    const titleParts = title.split(/[_\-\|]/);
    if (titleParts.length > 0) {
      // First part is usually the manga name
      title = cleanText(titleParts[0].replace(/漫畫$/, "").replace(/漫画$/, ""));
    }
    if (!title) {
      title = cleanText($("h1").first().text()) || comicId;
    }

    // Author & description — mangabz template usually has these in .detail-info-*
    const author = cleanText($(".detail-info-tip:contains('作者')").next().text() ||
      $(".detail-info-author").text() ||
      $("p:contains('作者')").text().replace(/^.*作者[：:]/, "")) || "未知";

    const description = cleanText(
      $("meta[name='Description']").attr("content") ||
      $("meta[name='description']").attr("content") ||
      $(".detail-info-content").first().text() ||
      ""
    );

    // Cover image
    let coverUrl = absolutizeURL(ALT_BASE,
      $(".detail-info-cover img").first().attr("src") ||
      $(".detail-info-img img").first().attr("src") ||
      $("img.detail-info-cover").first().attr("src") ||
      ""
    );
    // Fallback: cover.yymanhua.com
    if (!coverUrl || coverUrl === absolutizeURL(ALT_BASE, "")) {
      coverUrl = `http://cover.yymanhua.com/2/${comicId}/cover.jpg`;
    }

    // Status
    const statusText = cleanText($(".detail-info-tip:contains('狀態')").next().text() ||
      $("p:contains('狀態')").text() || "");
    const status = statusText.includes("完結") || statusText.includes("完结") ? "已完结" : "连载中";

    // Categories
    const categories: string[] = [];
    $(".detail-info-tip:contains('類型')").next().find("a").each((_, el) => {
      const t = cleanText($(el).text());
      if (t) categories.push(t);
    });
    if (categories.length === 0) {
      $(".detail-info-tag a, .detail-info-tip:contains('標籤')").next().find("a").each((_, el) => {
        const t = cleanText($(el).text());
        if (t) categories.push(t);
      });
    }

    // Chapter list — from template API
    const templateUrl = `${ALT_BASE}/template-${comicId}-s2/`;
    let chapters: ChapterItem[] = [];
    try {
      const tmplHtml = await fetchHTML(templateUrl, { headers: { Referer: url } });
      const $$ = parseHTML(tmplHtml);
      const seen = new Set<string>();
      $$("a.detail-list-form-item").each((_, el) => {
        const href = $$(el).attr("href") || "";
        const chMatch = href.match(/^\/m(\d+)\/$/);
        if (!chMatch) return;
        const chapterId = chMatch[1];
        if (seen.has(chapterId)) return;
        seen.add(chapterId);
        let chapterTitle = cleanText($$(el).attr("title") || $$(el).text());
        // Remove page count suffix like "（22P）"
        chapterTitle = chapterTitle.replace(/[（(]\d+\s*[Pp][)）]$/, "").trim();
        chapters.push({
          id: chapterId,
          title: chapterTitle || `第${chapters.length + 1}话`,
          url: `${BASE}/m${chapterId}/`,
          order: chapters.length + 1,
        });
      });
    } catch {
      // Fallback: parse from manga detail page
      const $m = $;
      const seenFallback = new Set<string>();
      $m("a.detail-list-form-item").each((_, el) => {
        const href = $m(el).attr("href") || "";
        const chMatch = href.match(/^\/m(\d+)\/$/);
        if (!chMatch) return;
        const chapterId = chMatch[1];
        if (seenFallback.has(chapterId)) return;
        seenFallback.add(chapterId);
        let chapterTitle = cleanText($m(el).attr("title") || $m(el).text());
        chapterTitle = chapterTitle.replace(/[（(]\d+\s*[Pp][)）]$/, "").trim();
        chapters.push({
          id: chapterId,
          title: chapterTitle || `第${chapters.length + 1}话`,
          url: `${BASE}/m${chapterId}/`,
          order: chapters.length + 1,
        });
      });
    }

    return t2sDeep({
      site: this.key,
      comicId,
      title: title || comicId,
      author: author || "未知",
      description,
      coverUrl,
      sourceUrl: url,
      status,
      categories: categories.map(t2s),
      chapters,
    });
  }

  async getChapterImages(_comicId: string, chapter: { id: string; url: string; title: string }): Promise<string[]> {
    const chapterUrl = chapter.url || `${BASE}/m${chapter.id}/`;
    const html = await fetchHTML(chapterUrl, { headers: { Referer: ALT_BASE + "/" } });

    // Extract JS variables from the chapter page
    const extractVar = (name: string): string => {
      const re = new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`);
      const m = html.match(re);
      return m ? m[1] : "";
    };
    const extractNum = (name: string): number => {
      const re = new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)`);
      const m = html.match(re);
      return m ? parseInt(m[1]) : 0;
    };

    const cid = extractVar("YYMANHUA_CID") || chapter.id;
    const mid = extractVar("YYMANHUA_MID") || _comicId;
    const sign = extractVar("YYMANHUA_VIEWSIGN");
    const signDt = extractVar("YYMANHUA_VIEWSIGN_DT");
    const imageCount = extractNum("YYMANHUA_IMAGE_COUNT");

    if (!sign || imageCount <= 0) {
      throw new Error("无法获取章节签名或页数");
    }

    const allImages: string[] = [];
    const imageBase = `${ALT_BASE}/chapterimage.ashx`;

    // Fetch images page by page (up to 30 pages safe limit)
    for (let page = 1; page <= Math.min(imageCount, 100); page++) {
      const params = new URLSearchParams({
        cid,
        page: String(page),
        key: "",
        _cid: cid,
        _mid: mid,
        _dt: signDt,
        _sign: sign,
      });

      const resp = await fetch(`${imageBase}?${params.toString()}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: chapterUrl,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        // If we've already got some images, return what we have
        if (allImages.length > 0) break;
        throw new Error(`图片服务器返回 ${resp.status}`);
      }

      const body = await resp.text();
      // Response is JS: var d = ["url1","url2",...];  — parse out the URLs
      const imgMatches = body.matchAll(/"((?:https?:)?\/\/[^"]*\.(?:jpg|png|webp|jpeg)[^"]*)"/gi);
      for (const m of imgMatches) {
        let imgUrl = m[1];
        // Ensure protocol-relative URLs are absolute
        if (imgUrl.startsWith("//")) {
          imgUrl = "http:" + imgUrl;
        }
        allImages.push(imgUrl);
      }

      // If we got fewer images than expected and it's the last page, we're done
      if (page >= imageCount) break;
    }

    if (allImages.length === 0) {
      throw new Error("未获取到任何图片");
    }

    return allImages;
  }
}

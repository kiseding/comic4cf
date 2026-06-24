// yymanhua.com / xmanhua.com (mangabz 系列)
// Manga detail: /<id>yy/ or /<id>xm/; Chapter: /m<id>/
// Chapter list: /template-<mid>-s2/; Image API: chapterimage.ashx
import type { SiteSource, SearchResult, ComicDetail, ResolvedURL, ChapterItem } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";
import { t2s, t2sDeep } from "../utils/zhconv";

interface MangabzConfig {
  key: string;
  displayName: string;
  tags: string[];
  base: string;             // "http://www.yymanhua.com" or "https://www.xmanhua.com"
  altBase: string;          // bare domain
  suffix: string;           // "yy" or "xm"
}

function makeMangabzSource(cfg: MangabzConfig): SiteSource {
  const { key, displayName, tags, base, altBase, suffix } = cfg;

  // Proxy HTTP-only CDN covers through the Worker so they work on HTTPS pages
  const proxyCover = (url: string): string => {
    if (!url) return "";
    try {
      const u = new URL(url);
      if (u.hostname.includes("yymanhua.com") || u.hostname.includes("xmanhua.com")) {
        return `/api/proxy-image?url=${encodeURIComponent(url)}`;
      }
    } catch {}
    return url;
  };

  return {
    key,
    displayName,
    tags,

    resolveURL(url: string): ResolvedURL | null {
      try {
        const u = new URL(url);
        const hostOk = u.hostname === new URL(base).hostname || u.hostname === new URL(altBase).hostname;
        if (!hostOk) return null;

        const mangaMatch = u.pathname.match(new RegExp(`^/(\\d+)${suffix}/$`));
        if (mangaMatch) {
          return { siteKey: key, comicId: mangaMatch[1], canonical: `${base}/${mangaMatch[1]}${suffix}/` };
        }

        const chapterMatch = u.pathname.match(/^\/m(\d+)\/$/);
        if (chapterMatch) {
          return { siteKey: key, comicId: "", chapterId: chapterMatch[1], canonical: `${base}/m${chapterMatch[1]}/` };
        }

        return null;
      } catch {
        return null;
      }
    },

    async search(keyword: string, limit: number): Promise<SearchResult[]> {
      const url = `${altBase}/search?title=${encodeURIComponent(keyword)}`;
      const html = await fetchHTML(url, { headers: { Referer: altBase + "/" } });
      const $ = parseHTML(html);
      const results: SearchResult[] = [];
      const seen = new Set<string>();

      // xmanhua/yymanhua search result item: div.mh-item > a[href$="${suffix}/"] > img.mh-cover
      // followed by h2.title > a[href]
      $(`a[href$="${suffix}/"]`).each((_, el) => {
        const href = $(el).attr("href") || "";
        const m = href.match(new RegExp(`^/(\\d+)${suffix}/$`));
        if (!m) return;
        const comicId = m[1];
        if (seen.has(comicId)) return;
        seen.add(comicId);

        let title = $(el).attr("title") || cleanText($(el).text());
        if (!title) {
          // xmanhua: title might be on the parent h2 > a
          title = $(el).closest(".mh-item").find("h2.title a").attr("title") ||
                  $(el).closest(".mh-item").find("h2.title a").text();
        }
        title = cleanText(title);
        if (!title) return;

        const coverImg = $(el).closest(".mh-item").find("img.mh-cover").attr("src") || "";

        results.push(t2sDeep({
          site: key,
          comicId,
          title,
          author: "",
          description: "",
          url: `${base}/${comicId}${suffix}/`,
          coverUrl: proxyCover(coverImg ? absolutizeURL(base, coverImg) : ""),
          latestChapter: "",
        }));
      });

      // Fallback: old yymanhua detail-list-form-item pattern
      if (results.length === 0) {
        $("a.detail-list-form-item").each((_, el) => {
          const href = $(el).attr("href") || "";
          const m = href.match(new RegExp(`^/(\\d+)${suffix}/$`));
          if (!m) return;
          const comicId = m[1];
          if (seen.has(comicId)) return;
          seen.add(comicId);
          const title = cleanText($(el).attr("title") || $(el).text());
          if (!title) return;
          results.push(t2sDeep({
            site: key,
            comicId,
            title,
            author: "",
            description: "",
            url: `${base}/${comicId}${suffix}/`,
            coverUrl: "",
            latestChapter: "",
          }));
        });
      }

      return results.slice(0, limit);
    },

    async getDetail(comicId: string): Promise<ComicDetail> {
      const url = `${altBase}/${comicId}${suffix}/`;
      const html = await fetchHTML(url, { headers: { Referer: altBase + "/" } });
      const $ = parseHTML(html);

      let title = cleanText($("title").first().text());
      const titleParts = title.split(/[_\-\|]/);
      if (titleParts.length > 0) {
        title = cleanText(titleParts[0].replace(/漫畫$/, "").replace(/漫画$/, ""));
      }
      if (!title) {
        title = cleanText($("h1").first().text()) || comicId;
      }

      const author = cleanText(
        $(".detail-info-tip:contains('作者')").next().text() ||
        $(".detail-info-author").text() ||
        $("p:contains('作者')").text().replace(/^.*作者[：:]/, "")
      ) || "未知";

      const description = cleanText(
        $("meta[name='Description']").attr("content") ||
        $("meta[name='description']").attr("content") ||
        $(".detail-info-content").first().text() ||
        ""
      );

      let coverUrl = proxyCover(absolutizeURL(altBase,
        $(".detail-info-cover img").first().attr("src") ||
        $(".detail-info-img img").first().attr("src") ||
        $("img.detail-info-cover").first().attr("src") ||
        $("img.mh-cover").first().attr("src") ||
        ""
      ));
      if (!coverUrl) {
        const coverDomain = altBase.replace(/https?:\/\/(www\.)?/, "cover.");
        // cover.yymanhua.com only works over HTTP; proxy it through Worker
        coverUrl = proxyCover(`http://${coverDomain}/2/${comicId}/cover.jpg`);
      }

      const statusText = cleanText(
        $(".detail-info-tip:contains('狀態')").next().text() ||
        $("p:contains('狀態')").text() || ""
      );
      const status = statusText.includes("完結") || statusText.includes("完结") ? "已完结" : "连载中";

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

      // Chapter list from template API
      const templateUrl = `${altBase}/template-${comicId}-s2/`;
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
          chapterTitle = chapterTitle.replace(/[（(]\d+\s*[Pp][)）]$/, "").trim();
          chapters.push({
            id: chapterId,
            title: chapterTitle || `第${chapters.length + 1}话`,
            url: `${base}/m${chapterId}/`,
            order: chapters.length + 1,
          });
        });
      } catch {
        // Fallback: parse from manga detail page
      }

      return t2sDeep({
        site: key,
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
    },

    async getChapterImages(_comicId: string, chapter: { id: string; url: string; title: string }): Promise<string[]> {
      const chapterUrl = chapter.url || `${base}/m${chapter.id}/`;

      // Use the same fetchHTML that works for search/detail pages
      const html = await fetchHTML(chapterUrl, { headers: { Referer: altBase + "/" } });

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

      const cid = String(extractNum("YYMANHUA_CID")) || chapter.id;
      const mid = String(extractNum("YYMANHUA_MID")) || _comicId;
      const sign = extractVar("YYMANHUA_VIEWSIGN");
      const signDt = extractVar("YYMANHUA_VIEWSIGN_DT");
      const imageCount = extractNum("YYMANHUA_IMAGE_COUNT");

      if (!sign || imageCount <= 0) {
        // Dump page snippet for debugging
        const snippet = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500);
        throw new Error(`无法获取章节签名(sign=${sign ? "有" : "无"}, pages=${imageCount}, cid=${cid}, mid=${mid}). 页面片段: ${snippet}`);
      }

      const allImages: string[] = [];

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

        const resp = await fetch(`${altBase}/chapterimage.ashx?${params.toString()}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: chapterUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          if (allImages.length > 0) break;
          throw new Error(`图片服务器返回 ${resp.status}`);
        }

        const body = await resp.text();
        // chapterimage.ashx returns packed JavaScript: eval(function(p,a,c,k,e,d){...})
        // Execute it to get the d array containing image URLs
        let d: string[] = [];
        try {
          d = (0, eval)(body) as string[];
        } catch {
          // if eval fails, try regex fallback
          const imgMatches = body.matchAll(/"((?:https?:)?\/\/[^"]*\.(?:jpg|png|webp|jpeg)[^"]*)"/gi);
          for (const m of imgMatches) d.push(m[1]);
        }
        for (const url of d) {
          let imgUrl = url;
          if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
          // Proxy images through Worker so HTTP image.yymanhua.com works on HTTPS pages
          allImages.push(proxyCover(imgUrl));
        }

        if (page >= imageCount) break;
      }

      if (allImages.length === 0) {
        throw new Error("未获取到任何图片");
      }

      return allImages;
    },
  };
}

export const YymanhuaSource: SiteSource = makeMangabzSource({
  key: "yymanhua",
  displayName: "YY漫画",
  tags: ["中文", "日漫", "繁體"],
  base: "http://www.yymanhua.com",
  altBase: "http://yymanhua.com",
  suffix: "yy",
});

export const XmanhuaSource: SiteSource = makeMangabzSource({
  key: "xmanhua",
  displayName: "X漫画",
  tags: ["中文", "日漫", "繁體"],
  base: "https://www.xmanhua.com",
  altBase: "https://xmanhua.com",
  suffix: "xm",
});

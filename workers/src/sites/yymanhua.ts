function unpackChapterImages(body: string, siteKey: string, page: number): string[] {
  const payloadStart = body.lastIndexOf("}(");
  if (payloadStart < 0) { console.log("[" + siteKey + "] Page " + page + ": no }( found"); return []; }
  const payloadEnd = body.lastIndexOf("))");
  if (payloadEnd < 0 || payloadEnd <= payloadStart) { console.log("[" + siteKey + "] Page " + page + ": no )) found"); return []; }
  const payload = body.substring(payloadStart + 2, payloadEnd).trim();
  const keyQuoteStart = payload.lastIndexOf(",'");
  if (keyQuoteStart < 0) { console.log("[" + siteKey + "] Page " + page + ": no keys found"); return []; }
  const keysStr = payload.substring(keyQuoteStart + 2).replace(/^'/, "").replace(/'$/, "");
  const beforeKeys = payload.substring(0, keyQuoteStart);
  const parts = beforeKeys.split(",");
  if (parts.length < 3) { console.log("[" + siteKey + "] Page " + page + ": cannot parse radix/count"); return []; }
  const radix = parseInt(parts[parts.length - 2]);
  const count = parseInt(parts[parts.length - 1]);
  const packedWithQuote = parts.slice(0, parts.length - 2).join(",");
  const packed = packedWithQuote.replace(/^'/, "").replace(/'$/, "");
  const keys = keysStr.split("|");
  if (isNaN(radix) || isNaN(count) || keys.length === 0) { console.log("[" + siteKey + "] Page " + page + ": invalid radix/count/keys"); return []; }

  // Must use function declaration (not const arrow) for recursion
  function decode(c: number): string {
    if (c < radix) return "";
    const s = decode(Math.floor(c / radix));
    c = c % radix;
    return s + (c > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  }

  const dict: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const encoded = decode(i);
    if (encoded) dict[encoded] = keys[i] || encoded;
  }

  let unpacked = packed;
  const sortedTokens = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const token of sortedTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    unpacked = unpacked.replace(new RegExp(escaped, "g"), dict[token]);
  }

  console.log("[" + siteKey + "] Page " + page + ": unpacked code: " + unpacked.substring(0, 200));

  const pixMatch = unpacked.match(/pix\s*=\s*"([^"]+)"/);
  const pathsMatch = unpacked.match(/pvalue\s*=\s*\[([^\]]+)\]/);
  if (pixMatch && pathsMatch) {
    const pix = pixMatch[1];
    const pathStrs = pathsMatch[1].match(/"([^"]+)"/g);
    if (pathStrs) {
      const urls: string[] = [];
      for (const ps of pathStrs) {
        const path = ps.replace(/"/g, "");
        const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const suffixRe = new RegExp(escapedPath + "\\+['\"]([^'\"]*)['\"]");
        const suffixMatch = unpacked.match(suffixRe);
        urls.push(pix + path + (suffixMatch ? suffixMatch[1] : ""));
      }
      return urls;
    }
  }

  const imgRegex = /https?:\/\/[^"'\s]+\.(?:jpg|png|webp|jpeg|gif)[^"'\s]*/gi;
  const rawUrls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(unpacked)) !== null) {
    rawUrls.push(m[0]);
  }
  return rawUrls;
}


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

function unpackChapterImages(body: string, siteKey: string, page: number): string[] {
  const payloadStart = body.lastIndexOf("}(");
  if (payloadStart < 0) { console.log("[" + siteKey + "] Page " + page + ": no }( found"); return []; }
  const payloadEnd = body.lastIndexOf("))");
  if (payloadEnd < 0 || payloadEnd <= payloadStart) { console.log("[" + siteKey + "] Page " + page + ": no )) found"); return []; }
  const payload = body.substring(payloadStart + 2, payloadEnd).trim();
  const keyQuoteStart = payload.lastIndexOf(",'");
  if (keyQuoteStart < 0) { console.log("[" + siteKey + "] Page " + page + ": no keys found"); return []; }
  const keysStr = payload.substring(keyQuoteStart + 2).replace(/^'/, "").replace(/'$/, "");
  const beforeKeys = payload.substring(0, keyQuoteStart);
  const parts = beforeKeys.split(",");
  if (parts.length < 3) { console.log("[" + siteKey + "] Page " + page + ": cannot parse radix/count"); return []; }
  const radix = parseInt(parts[parts.length - 2]);
  const count = parseInt(parts[parts.length - 1]);
  const packedWithQuote = parts.slice(0, parts.length - 2).join(",");
  const packed = packedWithQuote.replace(/^'/, "").replace(/'$/, "");
  const keys = keysStr.split("|");
  if (isNaN(radix) || isNaN(count) || keys.length === 0) { console.log("[" + siteKey + "] Page " + page + ": invalid radix/count/keys"); return []; }
  const decode = (c: number): string => { if (c < radix) return ""; const s = decode(Math.floor(c / radix)); c = c % radix; return s + (c > 35 ? String.fromCharCode(c + 29) : c.toString(36)); };
  const dict: Record<string, string> = {};
  for (let i = 0; i < count; i++) { const encoded = decode(i); if (encoded) dict[encoded] = keys[i] || encoded; }
  let unpacked = packed;
  const sortedTokens = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const token of sortedTokens) { const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); unpacked = unpacked.replace(new RegExp(escaped, "g"), dict[token]); }
  console.log("[" + siteKey + "] Page " + page + ": unpacked code: " + unpacked.substring(0, 200));
  const pixMatch = unpacked.match(/pix\s*=\s*"([^"]+)"/);
  const pathsMatch = unpacked.match(/pvalue\s*=\s*\[([^\]]+)\]/);
  if (pixMatch && pathsMatch) {
    const pix = pixMatch[1];
    const pathStrs = pathsMatch[1].match(/"([^"]+)"/g);
    if (pathStrs) { const urls: string[] = []; for (const ps of pathStrs) { const path = ps.replace(/"/g, ""); const suffixRe = new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\+['\"]([^'\"]*)['\"]"); const suffixMatch = unpacked.match(suffixRe); urls.push(pix + path + (suffixMatch ? suffixMatch[1] : "")); } return urls; }
  }
  const imgRegex = /https?:\/\/[^"'\s]+\.(?:jpg|png|webp|jpeg|gif)[^"'\s]*/gi;
  const rawUrls: string[] = []; let m; while ((m = imgRegex.exec(unpacked)) !== null) { rawUrls.push(m[0]); }
  return rawUrls;
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

      // Fetch chapter page — use fetchHTML for proper encoding (GBK/UTF-8) and UA rotation
      let html: string;
      try {
        html = await fetchHTML(chapterUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": `${altBase}/`,
          },
        });
      } catch (e: any) {
        throw new Error(`获取章节页失败: ${e?.message || e}`);
      }

      const extractVar = (name: string): string => {
        const re = new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*"([^"]*)"`);
        const m = html.match(re);
        return m ? m[1] : "";
      };
      const extractNum = (name: string): number => {
        const re = new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*(\\d+)`);
        const m = html.match(re);
        return m ? parseInt(m[1]) : 0;
      };

      // Try multiple naming conventions (sites may rename variables over time)
      const cidRaw = extractNum("YYMANHUA_CID") || extractNum("MANGABZ_CID") || extractNum("MH_CID");
      const midRaw = extractNum("YYMANHUA_MID") || extractNum("MANGABZ_MID") || extractNum("MH_MID");
      // Fix: extractNum returns 0 on failure, but String(0) is "0" (truthy!), nullify 0 explicitly
      const cid = cidRaw > 0 ? String(cidRaw) : chapter.id;
      const mid = midRaw > 0 ? String(midRaw) : _comicId;
      const sign = extractVar("YYMANHUA_VIEWSIGN");
      const signDt = extractVar("YYMANHUA_VIEWSIGN_DT");
      const imageCount = extractNum("YYMANHUA_IMAGE_COUNT");

      // Diagnostic: log what we found for debugging
      console.log(`[${key}] Chapter ${chapter.id}: cid=${cid} mid=${mid} sign=${sign ? "found" : "MISSING"} dt=${signDt ? "found" : "MISSING"} imageCount=${imageCount}`);

      if (!sign || imageCount <= 0) {
        // Include a snippet of the HTML for debugging
        const snippet = html.substring(0, 500).replace(/\s+/g, " ");
        console.error(`[${key}] Var extraction failed. sign="${sign}" imageCount=${imageCount}. HTML head: ${snippet}`);
        throw new Error("无法获取章节签名或页数（站点可能已更新反爬机制）");
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
        // chapterimage.ashx returns packed JavaScript: eval(function(p,a,c,k,e,d){...}('...'))
        // The packed code assigns to global `d` via indirect eval. Capture from globalThis.
        // chapterimage.ashx returns Dean Edwards packed JS: eval(function(p,a,c,k,e,d){...}(...))
        // eval is blocked in Cloudflare Workers, so we manually unpack the packed code.
        let d: string[] = [];
        try {
          d = unpackChapterImages(body, key, page);
        } catch (e: any) {
          console.log(`[${key}] Page ${page}: unpack failed (${e?.message || e}), trying regex fallback`);
          const imgMatches = body.matchAll(/"((?:https?:)?\/\/[^"]*\.(?:jpg|png|webp|jpeg)[^"]*)"/gi);
          for (const m of imgMatches) d.push(m[1]);
        }
        if (page === 1) {
          console.log(`[${key}] Page 1 body preview (first 300 chars): ${body.substring(0, 300).replace(/\s+/g, " ")}`);
          console.log(`[${key}] Page 1 extracted ${d.length} URLs`);
        }
        for (const url of d) {
          let imgUrl = url;
          if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
          allImages.push(imgUrl);
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


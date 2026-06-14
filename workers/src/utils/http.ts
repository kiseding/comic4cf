// HTTP utility for source sites — mirrors go-novel-dl's requestutil
import { load } from "cheerio";

// Rotate User-Agent per request to reduce fingerprinting
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
];
let _uaIdx = 0;
function pickUA(): string {
  _uaIdx = (_uaIdx + 1) % UAS.length;
  return UAS[_uaIdx];
}

export async function fetchHTML(url: string, opts?: RequestInit): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": pickUA(),
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      ...(opts?.headers as Record<string, string>),
    },
    ...opts,
    signal: opts?.signal || AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${url}`);
  }
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return resp.text();
  }
  // Decode bytes as GBK if not UTF-8 (common for Chinese novel sites)
  const buf = await resp.arrayBuffer();
  const decoder = new TextDecoder("gbk");
  return decoder.decode(buf);
}

export function parseHTML(html: string) {
  return load(html);
}

export function absolutizeURL(base: string, href: string): string {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export function cleanText(text: string): string {
  return text.replace(/[\s　]+/g, " ").trim();
}



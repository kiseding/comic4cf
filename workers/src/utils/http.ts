import { load } from "cheerio";

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
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(buf);
  }
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buf);
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return new TextDecoder("gbk").decode(buf);
  }
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

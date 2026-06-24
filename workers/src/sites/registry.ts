// Comic site source registry
import type { SiteSource, SearchResult, ComicDetail } from "../types";
export type { SearchResult };

import { BaoziManhuaSource } from "./baozimanhua";
import { ZaiManhuaSource } from "./zaimanhua";
import { YymanhuaSource, XmanhuaSource } from "./yymanhua";

export interface SourceMeta {
  key: string;
  displayName: string;
  tags: string[];
  searchable: boolean;
}

const SOURCES: SiteSource[] = [
  new BaoziManhuaSource(),
  new ZaiManhuaSource(),
  YymanhuaSource,
  XmanhuaSource,
];

export class SiteRegistry {
  private sources: Map<string, SiteSource>;
  private meta: SourceMeta[];

  constructor() {
    this.sources = new Map();
    this.meta = [];
    for (const s of SOURCES) {
      this.sources.set(s.key, s);
      this.meta.push({ key: s.key, displayName: s.displayName, tags: s.tags, searchable: true });
    }
  }

  getSource(key: string): SiteSource | undefined { return this.sources.get(key); }
  getSearchableSources(): SourceMeta[] { return this.meta.filter(m => m.searchable); }

  resolveURL(url: string): { siteKey: string; comicId: string; chapterId?: string } | null {
    for (const source of this.sources.values()) {
      const resolved = source.resolveURL(url);
      if (resolved) return resolved;
    }
    return null;
  }

  async getHomepageBooks(): Promise<SearchResult[]> {
    try {
      const { fetchHTML } = await import("../utils/http");
      const html = await fetchHTML("https://www.baozimh.com");
      const baozi = this.sources.get("baozimh") as BaoziManhuaSource | undefined;
      if (!baozi) return [];
      return baozi.parseListing(html, "https://www.baozimh.com").slice(0, 30);
    } catch {
      return [];
    }
  }

  async getCategoryBooks(tag: string): Promise<SearchResult[]> {
    if (!tag) return this.getHomepageBooks();
    const all: SearchResult[] = [];
    const promises = Array.from(this.sources.values())
      .filter(s => typeof s.getCategoryBooks === "function")
      .map(async s => {
        try {
          return await s.getCategoryBooks!(tag);
        } catch { return [] as SearchResult[]; }
      });
    const results = await Promise.all(promises);
    for (const items of results) all.push(...items);
    return all.slice(0, 60);
  }

  async searchAll(sites: string[], keyword: string, limit: number): Promise<SearchResult[]> {
    const targetSources = sites.length > 0
      ? sites.map(k => this.sources.get(k)).filter(Boolean) as SiteSource[]
      : Array.from(this.sources.values());

    const results: SearchResult[] = [];
    const promises = targetSources.map(async (source) => {
      try {
        return await source.search(keyword, Math.min(limit, 10));
      } catch { return [] as SearchResult[]; }
    });
    const allResults = await Promise.all(promises);
    for (const items of allResults) results.push(...items);
    return results.slice(0, limit || results.length);
  }

  async getComicDetail(siteKey: string, comicId: string): Promise<ComicDetail> {
    const source = this.sources.get(siteKey);
    if (!source) throw new Error(`未找到书源: ${siteKey}`);
    return source.getDetail(comicId);
  }

  async getChapterImages(siteKey: string, comicId: string, chapter: { id: string; url: string; title: string }): Promise<string[]> {
    const source = this.sources.get(siteKey);
    if (!source) throw new Error(`未找到书源: ${siteKey}`);
    return source.getChapterImages(comicId, chapter);
  }
}

let registry: SiteRegistry | null = null;
export function getRegistry(): SiteRegistry {
  if (!registry) registry = new SiteRegistry();
  return registry;
}

// Comic source types — mirrors novel-reader's types with image support

export interface SearchResult {
  site: string;
  comicId: string;
  title: string;
  author: string;
  description: string;
  url: string;
  coverUrl: string;
  latestChapter: string;
  status?: string;      // 连载中/已完结
  categories?: string[]; // 分类标签
}

export interface ComicDetail {
  site: string;
  comicId: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  sourceUrl: string;
  status: string;
  categories: string[];
  chapters: ChapterItem[];
}

export interface ChapterItem {
  id: string;
  title: string;
  url: string;
  order: number;
}

export interface ResolvedURL {
  siteKey: string;
  comicId: string;
  chapterId?: string;
  canonical: string;
}

export interface SiteSource {
  readonly key: string;
  readonly displayName: string;
  readonly tags: string[];
  search(keyword: string, limit: number): Promise<SearchResult[]>;
  getDetail(comicId: string): Promise<ComicDetail>;
  getChapterImages(comicId: string, chapter: { id: string; url: string; title: string }): Promise<string[]>;
  getChapterImagesStream?(comicId: string, chapter: { id: string; url: string; title: string }): ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;
  resolveURL(url: string): ResolvedURL | null;
  // Optional: provide a recommendation list filtered by a category slug.
  getCategoryBooks?(tag: string): Promise<SearchResult[]>;
}


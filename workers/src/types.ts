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
  resolveURL(url: string): ResolvedURL | null;
  // Optional: provide a recommendation list filtered by a category slug.
  getCategoryBooks?(tag: string): Promise<SearchResult[]>;
}

export interface BookshelfItem {
  id: number;
  user_id: number;
  site: string;
  comic_id: string;
  title: string;
  author: string;
  cover_url: string;
  description: string;
  source_url: string;
  latest_chapter: string;
  chapter_index: number;
  chapter_id: string;
  chapter_title: string;
  created_at: string;
  updated_at: string;
}

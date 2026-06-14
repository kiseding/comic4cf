import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import type { SearchItem } from "../lib/api";
import ComicCard from "../components/ComicCard";
import { useSearch } from "../hooks/useSearch";

function GridCover({ url, title }: { url: string; title: string }) {
  const [coverError, setCoverError] = useState(false);
  return (
    <div className="aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 mb-2">
      {url && !coverError ? (
        <img src={url} alt={title} className="w-full h-full object-cover" loading="lazy" onError={() => setCoverError(true)} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">📱</div>
      )}
    </div>
  );
}

function scoreResult(item: SearchItem, keyword: string): number {
  const kw = keyword.toLowerCase();
  const title = (item.title || "").toLowerCase();
  if (title === kw) return 100;
  if (title.startsWith(kw)) return 80;
  if (title.includes(kw)) return 60;
  let c = 0;
  for (const ch of kw) { if (title.includes(ch)) c++; }
  return c * 5;
}

export default function HomePage() {
  const { keyword, results, loading, sourceErrors, exactMatch } = useSearch();
  const CACHE_KEY = "lx_homepage";
  const CACHE_TTL = 30 * 60 * 1000; // 30min

  const [books, setBooks] = useState<SearchItem[]>(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.ts && Date.now() - cached.ts < CACHE_TTL) return cached.books;
      }
    } catch {}
    return [];
  });
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState("");

  const loadHomepage = useCallback(() => {
    setHomeLoading(true);
    setHomeError("");
    api.getHomepage()
      .then(res => {
        setBooks(res.books);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ books: res.books, ts: Date.now() })); } catch {}
      })
      .catch(e => { setHomeError(e.message || "加载失败"); setBooks([]); })
      .finally(() => setHomeLoading(false));
  }, []);

  useEffect(() => {
    if (keyword) return;
    loadHomepage();
  }, [keyword, loadHomepage]);

  const exactKey = exactMatch ? `${exactMatch.site}|${exactMatch.comicId}` : null;
  const otherResults = exactKey
    ? results.filter(r => `${r.site}|${r.comicId}` !== exactKey)
    : results;
  const sorted = [...otherResults].sort((a, b) => scoreResult(b, keyword) - scoreResult(a, keyword));
  const showSearch = !!keyword;

  return (
    <div className="max-w-5xl mx-auto px-4 pt-2 pb-8">
      {showSearch ? (
        <>
          {sourceErrors.length > 0 && (
            <div className="mb-3 p-2.5 rounded-lg text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
              {sourceErrors.length} 个源失败：{sourceErrors.map(s => s.site).join("、")}
            </div>
          )}
          {exactMatch && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">完全匹配</span>
                <span className="text-xs text-gray-500">{loading ? "继续搜索其他源中..." : "已完成"}</span>
              </div>
              <ComicCard {...exactMatch} />
            </div>
          )}
          {loading && sorted.length === 0 && !exactMatch ? (
            <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[--primary] border-t-transparent" /></div>
          ) : sorted.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-2">
                {exactMatch ? "其他相关结果" : `找到 ${sorted.length} 个结果`}{loading ? "，搜索中..." : ""}
              </p>
              {sorted.map((item, i) => <ComicCard key={`${item.site}|${item.comicId}|${i}`} {...item} />)}
            </div>
          ) : !loading && !exactMatch ? (
            <div className="text-center py-16 text-gray-500">没有找到相关漫画</div>
          ) : null}
        </>
      ) : (
        <>
            <h1 className="text-lg font-bold mb-4">🔥 热门漫画</h1>
          {homeLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {[1,2,3,4,5,6,7,8,9,10].map(i => <div key={i} className="skeleton h-48 rounded-xl" />)}
            </div>
          ) : books.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {books.map((b, i) => (
                <Link key={`${b.site}|${b.comicId}|${i}`} to={`/comic/${b.site}/${b.comicId}`}
                  className="card p-3 active:scale-[0.98] transition-transform">
                  <GridCover url={b.coverUrl} title={b.title} />
                  <h3 className="text-xs font-medium line-clamp-2 leading-snug">{b.title}</h3>
                  <span className="text-[10px] text-gray-400 mt-0.5">{b.site}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-500">
              <div className="text-4xl mb-4">📚</div>
              <p className="mb-3">{homeError || "暂无数据"}</p>
              <button className="btn-ghost text-sm" onClick={loadHomepage}>重新加载</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

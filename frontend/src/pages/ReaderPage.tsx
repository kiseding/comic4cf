import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import * as api from "../lib/api";
import type { ComicDetail } from "../lib/api";

const BATCH = 3;

export default function ReaderPage() {
  const { site, comicId, chapterId } = useParams<{ site: string; comicId: string; chapterId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chapterTitle = searchParams.get("title") || "";
  const chapterUrl = searchParams.get("url") || "";
  const comicTitle = searchParams.get("comicTitle") || "";

  const [images, setImages] = useState<string[]>([]);
  const [title, setTitle] = useState(chapterTitle);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const prevImages = useRef<string[]>([]);
  const prevTitle = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showToc, setShowToc] = useState(false);
  const tocRef = useRef<HTMLButtonElement>(null);
  const [chapters, setChapters] = useState<{ id: string; title: string; url: string }[]>([]);
  const [chIdx, setChIdx] = useState(-1);

  const [showHeader, setShowHeader] = useState(true);
  const lastScrollTop = useRef(0);
  const chapterCacheRef = useRef<Map<string, { images: string[]; title: string }>>(new Map());
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const MAX_CACHE = 10;
  function setCache(key: string, value: { images: string[]; title: string }) {
    const map = chapterCacheRef.current;
    while (map.size >= MAX_CACHE) {
      const first = map.keys().next().value;
      if (first) map.delete(first);
    }
    map.set(key, value);
  }

  const recordedRef = useRef<string | null>(null);

  // Batch loading: only render images[0..batchEnd)
  const [batchEnd, setBatchEnd] = useState(0);
  const loadedCount = useRef(0);

  useEffect(() => {
    loadedCount.current = 0;
    setBatchEnd(Math.min(BATCH, images.length) || 0);
  }, [images]);

  const handleBatch = () => {
    loadedCount.current++;
    if (loadedCount.current % BATCH === 0) {
      const next = Math.min(loadedCount.current + BATCH, images.length);
      if (next > batchEnd) setBatchEnd(next);
    }
  };

  // Fetch chapter images
  useEffect(() => {
    if (!site || !comicId || !chapterId) return;
    let stale = false;
    const cacheKey = `${site}/${comicId}/${chapterId}`;

    const cached = chapterCacheRef.current.get(cacheKey);
    if (cached) {
      prevImages.current = cached.images;
      prevTitle.current = cached.title;
      setImages(cached.images);
      setTitle(cached.title);
      setLoading(false);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
      if (recordedRef.current !== chapterId) {
        recordedRef.current = chapterId;
        api.addHistory({ site, comicId, title: comicTitle, author: "", coverUrl: "", chapterId, chapterTitle: cached.title }).catch(() => {});
        const idx = chaptersRef.current.findIndex(c => c.id === chapterId);
        if (idx >= 0) api.updateProgress(site!, comicId!, idx, chapterId!, cached.title).catch(() => {});
      }
      return;
    }

    prevImages.current = [];
    setImages([]);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setLoading(true); setError("");

    api.getChapterImages(site, comicId, chapterId, chapterTitle, chapterUrl)
      .then(r => {
        if (stale) return;
        setTitle(r.title);
        prevTitle.current = r.title;
        if (r.total === 0 || !r.images.length) {
          setLoading(false);
          return;
        }
        setImages(r.images);
        prevImages.current = r.images;
        setLoading(false);
        setCache(cacheKey, { images: r.images, title: r.title });
        if (recordedRef.current !== chapterId) {
          recordedRef.current = chapterId;
          api.addHistory({ site, comicId, title: comicTitle, author: "", coverUrl: "", chapterId, chapterTitle: r.title }).catch(() => {});
        }
        const idx = chaptersRef.current.findIndex(c => c.id === chapterId);
        if (idx >= 0) api.updateProgress(site!, comicId!, idx, chapterId!, r.title).catch(() => {});
      })
      .catch(e => { if (!stale) { setError(e.message); setLoading(false); } });

    return () => { stale = true; };
  }, [site, comicId, chapterId]);

  // Chapter list
  useEffect(() => {
    if (!site || !comicId) return;
    api.getComicDetail(site, comicId).then((b: ComicDetail) =>
      setChapters(b.chapters.map(ch => ({ id: ch.id, title: ch.title, url: ch.url || "" })))
    ).catch(() => {});
  }, [site, comicId]);

  useEffect(() => {
    if (chapters.length) setChIdx(chapters.findIndex(ch => ch.id === chapterId));
  }, [chapters, chapterId]);

  // Preload next chapter — cancelled on chapter change
  useEffect(() => {
    if (!site || !comicId || images.length === 0 || loading) return;
    const nextId = nextChapterId(1);
    if (!nextId) return;
    const next = chapters.find(ch => ch.id === nextId);
    if (!next) return;
    const cacheKey = `${site}/${comicId}/${nextId}`;
    if (chapterCacheRef.current.has(cacheKey)) return;

    let stale = false;
    api.getChapterImages(site, comicId, next.id, next.title, next.url)
      .then(r => {
        if (stale || !r.images || !r.images.length) return;
        setCache(cacheKey, { images: r.images, title: next.title });
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [site, comicId, images, loading, chIdx, chapters, chapterId]);

  function chapterSortId(id: string) {
    const parts = (id || "").split("_").map(Number);
    return parts.reduce((acc, n, i) => acc + (n || 0) * Math.pow(10000, parts.length - 1 - i), 0);
  }

  function nextChapterId(dir: 1 | -1) {
    const cur = chapters[chIdx];
    if (!cur) return null;
    const curKey = chapterSortId(cur.id);
    let bestId: string | null = null;
    let bestKey = dir > 0 ? Infinity : -Infinity;
    for (const ch of chapters) {
      const k = chapterSortId(ch.id);
      if (dir > 0 && k > curKey && k < bestKey) { bestKey = k; bestId = ch.id; }
      if (dir < 0 && k < curKey && k > bestKey) { bestKey = k; bestId = ch.id; }
    }
    return bestId;
  }

  const goChapter = useCallback((id: string) => {
    const ch = chapters.find(c => c.id === id);
    if (!ch) return;
    navigate(`/read/${site}/${comicId}/${id}?title=${encodeURIComponent(ch.title)}&url=${encodeURIComponent(ch.url)}`);
  }, [site, comicId, chapters, navigate]);

  // Keyboard navigation
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (showToc) return;
      if (e.key === "ArrowLeft" || e.key === "a") { const id = nextChapterId(-1); if (id) goChapter(id); }
      if (e.key === "ArrowRight" || e.key === "d") { const id = nextChapterId(1); if (id) goChapter(id); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showToc, chIdx, chapters, goChapter]);

  // Touch swipe
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const dt = Date.now() - touchStart.current.t;
    touchStart.current = null;
    if (dt < 500 && Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const dir = dx < -60 ? 1 as const : dx > 60 ? -1 as const : null;
      if (dir) { const id = nextChapterId(dir); if (id) goChapter(id); }
    }
  };

  const hasPrevCh = !!nextChapterId(-1);
  const hasNextCh = !!nextChapterId(1);

  // Scroll to current chapter when TOC opens
  useEffect(() => {
    if (showToc) {
      requestAnimationFrame(() => tocRef.current?.scrollIntoView({ block: "center" }));
    }
  }, [showToc]);

  // Scroll handler for header show/hide
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const st = el.scrollTop;
      if (st <= 0) { setShowHeader(true); lastScrollTop.current = st; return; }
      if (st > lastScrollTop.current + 8) setShowHeader(false);
      else if (st < lastScrollTop.current - 8) setShowHeader(true);
      lastScrollTop.current = st;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [loading]);

  // Loading / Error states
  if (loading && prevImages.current.length === 0) return <div className="w-full h-dvh bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[#6366f1] border-t-transparent" /></div>;
  if (error) return <div className="w-full h-dvh bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex items-center justify-center"><div className="text-center"><p className="text-red-500 mb-4">{error}</p><button onClick={() => navigate(-1)} className="btn-ghost min-h-[44px]">返回</button></div></div>;

  const displayTitle = title || prevTitle.current;
  const visibleImages = images.slice(0, batchEnd);
  const hasMore = batchEnd < images.length;

  return (
    <div className="w-full h-dvh bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain touch-pan-y" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className={`sticky top-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur flex items-center justify-between px-4 py-1.5 border-b border-gray-200 dark:border-gray-700 transition-all duration-300 ${showHeader ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"}`}>
          <Link to={`/comic/${site}/${comicId}`} className="text-base text-[#6366f1] hover:underline whitespace-nowrap min-h-[44px] flex items-center">← 返回</Link>
          <span className="text-sm font-medium line-clamp-1 text-center mx-2 flex-1 min-w-0">{displayTitle}</span>
          <button onClick={() => setShowToc(true)} className="text-base text-[#6366f1] hover:underline whitespace-nowrap min-h-[44px] flex items-center">{chIdx + 1}/{chapters.length} 目录</button>
        </div>
        <div className="flex flex-col items-center">
          {visibleImages.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`Page ${i + 1}`}
              className="w-full max-w-[800px]"
              decoding="async"
              fetchPriority={i < 2 ? "high" : "auto"}
              onLoad={handleBatch}
              onError={handleBatch}
            />
          )}
          {visibleImages.length === 0 && !loading && (
            <div className="text-center py-16 text-gray-500">
              <p className="mb-4">该章节暂无图片</p>
              <button className="btn-ghost" onClick={() => navigate(-1)}>返回</button>
            </div>
          )}
          {hasMore && (
            <div className="flex items-center justify-center py-8 w-full">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#6366f1] border-t-transparent" />
                <span>加载更多...</span>
              </div>
            </div>
          )}

          {chapters.length > 0 && !hasMore && (
            <div className="flex justify-between w-full max-w-[800px] py-6 px-4">
              <button className="btn-ghost text-base min-h-[48px] px-4" disabled={!hasPrevCh}
                onClick={() => { if (hasPrevCh) goChapter(nextChapterId(-1) || ""); }}>← 上一话</button>
              <span className="text-sm text-gray-400 self-center">{chIdx + 1}/{chapters.length}</span>
              <button className="btn-ghost text-base min-h-[48px] px-4" disabled={!hasNextCh}
                onClick={() => { if (hasNextCh) goChapter(nextChapterId(1) || ""); }}>下一话 →</button>
            </div>
          )}
        </div>
      </div>

      <Modal open={showToc} onClose={() => setShowToc(false)} title="目录">
        <div className="max-h-96 overflow-y-auto space-y-1">
          {chapters.map((ch, i) => (
            <button
              key={ch.id}
              ref={i === chIdx ? tocRef : undefined}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${i === chIdx ? 'bg-[#6366f1]/10 text-[#6366f1] font-medium border-l-2 border-[#6366f1]' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
              onClick={() => { goChapter(chapters[i].id); setShowToc(false); }}
            >
              <span className="text-xs text-gray-400 mr-2">{i + 1}/{chapters.length}</span>
              {ch.title}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

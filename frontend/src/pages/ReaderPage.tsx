import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import * as api from "../lib/api";
import type { ComicDetail } from "../lib/api";

/** Save last-read chapter so ComicDetailPage can scroll to it on return */
function saveLastChapter(site: string, comicId: string, chapterId: string) {
  try { sessionStorage.setItem(`lastCh:${site}/${comicId}`, chapterId); } catch {}
}

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
  const [comicName, setComicName] = useState(comicTitle);
  const [chIdx, setChIdx] = useState(-1);

  const chapterCacheRef = useRef<Map<string, { images: string[]; title: string }>>(new Map());
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const MAX_CACHE = 10;
  function setCache(key: string, value: { images: string[]; title: string }) {
    const map = chapterCacheRef.current;
    if (map.has(key)) {
      map.delete(key);
    } else if (map.size >= MAX_CACHE) {
      const first = map.keys().next().value;
      if (first) map.delete(first);
    }
    map.set(key, value);
  }

  const recordedRef = useRef<string | null>(null);

  // Sliding window: always keep 2 images loading ahead
  const [loadedCount, setLoadedCount] = useState(0);
  const windowEnd = Math.min(loadedCount + 2, images.length);

  useEffect(() => { setLoadedCount(0); }, [images]);

  // 3 秒无进展则跳过挂起的图片
  useEffect(() => {
    if (images.length === 0) return;
    const t = setInterval(() => {
      setLoadedCount(prev => {
        if (prev >= images.length) return prev;
        return Math.min(prev + 3, images.length);
      });
    }, 3000);
    return () => clearInterval(t);
  }, [images.length]);

  const handleLoad = () => {
    setLoadedCount(prev => Math.min(prev + 1, images.length));
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
        api.addHistory({ site, comicId, title: comicName || comicTitle, author: "", coverUrl: "", chapterId, chapterTitle: cached.title }).then(() => { recordedRef.current = chapterId; }).catch(() => {});
        const idx = chaptersRef.current.findIndex(c => c.id === chapterId);
        if (idx >= 0) api.updateProgress(site!, comicId!, idx, chapterId!, cached.title, { title: comicName || comicTitle }).catch(() => {});
      }
      return;
    }

    prevImages.current = [];
    setImages([]);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setLoading(true); setError("");

    (async () => {
      const SIZE = 30;
      const all: string[] = [];
      let p = 1; let more = true;
      while (more) {
        const r = await api.getChapterImages(site, comicId, chapterId, chapterTitle, chapterUrl, p, SIZE);
        if (p === 1) { setTitle(r.title); prevTitle.current = r.title; }
        for (const img of r.images) all.push(img);
        if (stale) return;
        setImages([...all]); prevImages.current = all;
        if (p === 1) setLoading(false);
        more = r.hasMore;
        p++;
      }
      if (all.length === 0) { setLoading(false); return; }
      setCache(cacheKey, { images: all, title: prevTitle.current });
      const dt = prevTitle.current || chapterTitle;
      if (recordedRef.current !== chapterId) { api.addHistory({ site, comicId, title: comicName || comicTitle, author: "", coverUrl: "", chapterId, chapterTitle: dt }).then(() => { recordedRef.current = chapterId; }).catch(() => {}); }
      const idx = chaptersRef.current.findIndex(c => c.id === chapterId);
      if (idx >= 0) api.updateProgress(site!, comicId!, idx, chapterId!, dt, { title: comicName || comicTitle }).catch(() => {});
    })().catch((err: any) => {
      if (!stale) setError(err.message || "Failed");
      setLoading(false);
    })

    return () => { stale = true; };
  }, [site, comicId, chapterId]);

  // Chapter list
  useEffect(() => {
    if (!site || !comicId) return;
    api.getComicDetail(site, comicId).then((b: ComicDetail) => {
      setChapters(b.chapters.map(ch => ({ id: ch.id, title: ch.title, url: ch.url || "" })));
      if (b.title) setComicName(b.title);
    }).catch(() => {});
  }, [site, comicId]);

  useEffect(() => {
    if (chapters.length) setChIdx(chapters.findIndex(ch => ch.id === chapterId));
  }, [chapters, chapterId]);

  // Keep sessionStorage in sync so ComicDetailPage can scroll here on return
  useEffect(() => {
    if (site && comicId && chapterId) saveLastChapter(site, comicId, chapterId);
  }, [site, comicId, chapterId]);

  // Preload next chapter — cache URLs + pre-download all images in parallel
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
        r.images.slice(0, 10).forEach(url => { const img = new Image(); img.src = url; });
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [site, comicId, images, loading, chIdx, chapters, chapterId]);

  function nextChapterId(dir: 1 | -1) {
    const cur = chapters[chIdx];
    if (!cur) return null;
    const curIdx = chIdx;
    const next = curIdx + dir;
    if (next < 0 || next >= chapters.length) return null;
    return chapters[next].id;
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
      // Modal uses createPortal + visible state animation, wait for DOM to settle
      const t = setTimeout(() => {
        tocRef.current?.scrollIntoView({ block: "center" });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showToc]);

  // Loading / Error states
  if (loading && prevImages.current.length === 0) return <div className="w-full h-dvh bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[#6366f1] border-t-transparent" /></div>;
  if (error) return <div className="w-full h-dvh bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex items-center justify-center"><div className="text-center"><p className="text-red-500 mb-4">{error}</p><button onClick={() => navigate(`/comic/${site}/${comicId}`)} className="btn-ghost min-h-[44px]">返回</button></div></div>;

  const displayTitle = title || prevTitle.current;

  return (
    <div className="w-full h-dvh bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain touch-pan-y" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="sticky top-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <button onClick={() => navigate(`/comic/${site}/${comicId}`)} className="text-sm text-[#6366f1] hover:underline whitespace-nowrap">← 返回</button>
          <span className="text-sm font-medium line-clamp-1 text-center mx-2 flex-1 min-w-0">{displayTitle}</span>
          <button onClick={() => setShowToc(true)} className="text-sm text-[#6366f1] hover:underline whitespace-nowrap">{chIdx + 1}/{chapters.length} 目录</button>
        </div>
        <div className="flex flex-col items-center">
          {images.slice(0, windowEnd).map((url, i) => (
            <img
              key={`${chapterId}-${i}`}
              src={url}
              alt={`Page ${i + 1}`}
              className="w-full max-w-[800px]"
              decoding="async"
              fetchPriority={i < 2 ? "high" : "auto"}
              style={{ animation: 'fadeIn 0.3s ease' }}
              onLoad={handleLoad}
              onError={handleLoad}
            />
          ))}
          {images.length === 0 && !loading && (
            <div className="text-center py-16 text-gray-500">
              <p className="mb-4">该章节暂无图片</p>
              <button className="btn-ghost" onClick={() => navigate(`/comic/${site}/${comicId}`)}>返回</button>
            </div>
          )}

          {chapters.length > 0 && (
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

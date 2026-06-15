import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import type { ComicDetail, BookshelfItem } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export default function ComicDetailPage() {
  const { site, comicId } = useParams<{ site: string; comicId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [comic, setComic] = useState<ComicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inBookshelf, setInBookshelf] = useState(false);
  const [progress, setProgress] = useState<{ chapterId: string; chapterTitle: string; chapterUrl: string } | null>(null);
  const [shelfLoading, setShelfLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    if (!site || !comicId) return;
    setLoading(true); setError("");

    const loadDetail = api.getComicDetail(site, comicId);
    const loadShelf = user ? api.getBookshelf() : Promise.resolve(null);
    const loadHistory = user ? api.getHistory() : Promise.resolve(null);

    Promise.all([loadDetail, loadShelf, loadHistory]).then(([rawComic, rawShelf, rawHistory]) => {
      const comicData = rawComic as ComicDetail;
      const shelfData = rawShelf as { items: BookshelfItem[] } | null;
      const historyData = rawHistory as { items: any[] } | null;
      setComic(comicData);

      if (shelfData) {
        const found = shelfData.items.find(
          (i: BookshelfItem) => i.site === site && i.comic_id === comicId,
        );
        setInBookshelf(!!found);

        // History takes priority for reading progress
        if (historyData) {
          const hItems = historyData.items || [];
          const his = hItems.find((i: any) => i.site === site && i.comic_id === comicId);
          if (his?.chapter_id) {
            const ch = comicData.chapters.find(c => c.id === his.chapter_id);
            setProgress({
              chapterId: his.chapter_id,
              chapterTitle: his.chapter_title || ch?.title || '',
              chapterUrl: ch?.url || '',
            });
            return;
          }
        }

        // Fallback to bookshelf progress
        if (found?.chapter_id) {
          const ch = comicData.chapters.find(c => c.id === found.chapter_id);
          setProgress({
            chapterId: found.chapter_id,
            chapterTitle: found.chapter_title,
            chapterUrl: ch?.url || '',
          });
        }
      }
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [site, comicId, user]);

  const toggleBookshelf = async () => {
    if (!user) { navigate("/login"); return; }
    if (!comic) return;
    setShelfLoading(true);
    try {
      if (inBookshelf) { await api.removeFromBookshelf(site!, comicId!); setInBookshelf(false); setMsg("已移出书架"); }
      else { await api.addToBookshelf({ site: site!, comicId: comicId!, title: comic.title, author: comic.author, coverUrl: comic.coverUrl, description: comic.description, sourceUrl: comic.sourceUrl }); setInBookshelf(true); setMsg("已加入书架"); }
      setTimeout(() => setMsg(""), 2000);
    } catch (e: any) { setError(e.message); }
    finally { setShelfLoading(false); }
  };

  if (loading) return <div className="max-w-3xl mx-auto px-4 pt-8"><div className="flex gap-4"><div className="skeleton w-28 h-[150px] shrink-0" /><div className="flex-1 space-y-3"><div className="skeleton h-6 w-3/4" /><div className="skeleton h-4 w-1/3" /><div className="skeleton h-4 w-2/3" /></div></div></div>;
  if (error) return <div className="max-w-3xl mx-auto px-4 pt-16 text-center"><p className="text-red-500">{error}</p><button onClick={() => navigate(-1)} className="btn-ghost mt-4">返回</button></div>;
  if (!comic) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
      <div className="flex gap-4 mb-6">
        <div className="w-28 h-[150px] shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
          {comic.coverUrl && !coverError ? <img src={comic.coverUrl} alt={comic.title} className="w-full h-full object-cover" onError={() => setCoverError(true)} /> : <div className="w-full h-full flex items-center justify-center text-3xl">📱</div>}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold line-clamp-2">{comic.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{comic.author}</p>
          <p className="text-xs text-gray-400 mt-1">共 {comic.chapters.length} 话 · {comic.site}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${comic.status === "已完结" ? "bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400" : "bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"}`}>{comic.status}</span>
            {comic.categories.map((c, i) => <span key={i} className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{c}</span>)}
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            {(() => {
              const target = progress
                ? { id: progress.chapterId, title: progress.chapterTitle, url: progress.chapterUrl, label: "继续阅读" }
                : (comic.chapters[0]
                    ? { id: comic.chapters[0].id, title: comic.chapters[0].title, url: comic.chapters[0].url, label: "开始阅读" }
                    : null);
              if (!target) return null;
              return (
                <button
                  className="btn-primary text-xs px-4 min-h-[44px]"
                  onClick={() => navigate(`/read/${site}/${comicId}/${target.id}?comicTitle=${encodeURIComponent(comic.title)}&title=${encodeURIComponent(target.title)}&url=${encodeURIComponent(target.url || "")}`)}
                >
                  {target.label}
                </button>
              );
            })()}
            <button className={`btn text-xs px-4 min-h-[44px] ${inBookshelf ? "bg-gray-200 dark:bg-gray-700 text-gray-500" : "btn-primary"}`}
              onClick={toggleBookshelf} disabled={shelfLoading}>
              {shelfLoading ? "..." : inBookshelf ? "已加入" : "加入书架"}
            </button>
          </div>
          {msg && <span className="text-xs text-green-500 mt-1 block">{msg}</span>}
        </div>
      </div>

      {comic.description && <details open className="mb-6"><summary className="text-sm font-medium text-gray-500 cursor-pointer">简介</summary><p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{comic.description}</p></details>}

      <h2 className="text-sm font-medium mb-3">目录</h2>
      <div className="space-y-0.5">
        {comic.chapters.map(ch => (
          <Link key={ch.id} to={`/read/${site}/${comicId}/${ch.id}?comicTitle=${encodeURIComponent(comic.title)}&title=${encodeURIComponent(ch.title)}&url=${encodeURIComponent(ch.url || "")}`}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors min-h-[44px]">
            <span className="line-clamp-1 flex-1">{ch.title}</span>
            <span className="text-[10px] text-gray-400 shrink-0 ml-2">{ch.order}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

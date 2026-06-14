import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import type { BookshelfItem } from "../lib/api";

export default function BookshelfPage() {
  const [items, setItems] = useState<BookshelfItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.getBookshelf().then(res => setItems(res.items)).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[#6366f1] border-t-transparent" /></div>;

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
      <h1 className="text-lg font-bold mb-4">我的书架</h1>
      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-4">📚</div>
          <p>书架为空，去搜索添加漫画吧</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <Link key={item.id} to={`/comic/${item.site}/${item.comic_id}`}
              className="card flex gap-3 p-3 active:scale-[0.98] transition-transform">
              <div className="w-16 h-20 shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                {item.cover_url ? <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover" loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <div className="w-full h-full flex items-center justify-center">📱</div>}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm line-clamp-1">{item.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{item.author}</p>
                {item.chapter_title && <p className="text-xs mt-1 line-clamp-1" style={{ color: "#6366f1" }}>看到 {item.chapter_title}</p>}
                <span className="text-[10px] text-gray-400">{item.site}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

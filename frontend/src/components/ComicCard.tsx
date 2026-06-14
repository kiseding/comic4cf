import { useState } from "react";
import { Link } from "react-router-dom";

interface Props {
  site: string;
  comicId: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  latestChapter?: string;
  status?: string;
  categories?: string[];
  showDescription?: boolean;
}

export default function ComicCard({
  site, comicId, title, author, description, coverUrl, latestChapter, status, categories, showDescription,
}: Props) {
  const [coverError, setCoverError] = useState(false);
  const showFallback = !coverUrl || coverError;

  return (
    <Link to={`/comic/${site}/${comicId}`} className="card flex gap-3 p-3 active:scale-[0.98] transition-transform">
      <div className="w-20 h-[106px] shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
        {showFallback ? (
          <div className="w-full h-full flex items-center justify-center text-2xl">📱</div>
        ) : (
          <img src={coverUrl} alt={title} className="w-full h-full object-cover" loading="lazy"
            onError={() => setCoverError(true)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm line-clamp-1">{title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{author}</p>
        {showDescription && description && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-2">{description}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${status === "已完结" ? "bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400" : "bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"}`}>
              {status}
            </span>
          )}
          {categories?.slice(0, 2).map((c, i) => (
            <span key={i} className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{c}</span>
          ))}
          <span className="text-[10px] text-gray-400">{site}</span>
        </div>
        {latestChapter && <p className="text-xs mt-1 line-clamp-1" style={{ color: "#6366f1" }}>{latestChapter}</p>}
      </div>
    </Link>
  );
}

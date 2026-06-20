import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSearch } from "../hooks/useSearch";
import * as api from "../lib/api";
import UserMenu from "./UserMenu";

export default function Navbar() {
  const { user } = useAuth();
  const location = useLocation();
  const { setKeyword, addResults, setResults, setLoading, addSourceError, clearSourceErrors, setExactMatch, clear } = useSearch();
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const path = location.pathname;

  useEffect(() => {
    const el = searchInputRef.current;
    if (el && document.activeElement === el) el.blur();
  }, [path]);

  const doSearch = useCallback(async () => {
    const kw = input.trim();
    if (!kw) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    clear();
    setLoading(true); setKeyword(kw);

    const kwNorm = kw.toLowerCase();
    const checkExact = (items: any[]) => {
      for (const it of items) {
        if ((it.title || "").trim().toLowerCase() === kwNorm) {
          setExactMatch(it);
          return;
        }
      }
    };

    let isUrl = false;
    try { new URL(kw); isUrl = true; } catch {}
    if (isUrl) {
      try {
        const res = await api.search(kw);
        if (ctrl.signal.aborted) return;
        if (res.urlSearch && res.item) { setExactMatch(res.item); setResults([res.item]); }
        else if (res.results) { checkExact(res.results); setResults(res.results); }
      } catch {}
      finally { setLoading(false); }
      return;
    }

    try {
      api.streamSearch(
        kw, [],
        (_, items) => {
          if (ctrl.signal.aborted) return;
          checkExact(items);
          addResults(items);
        },
        () => { if (!ctrl.signal.aborted) setLoading(false); },
        () => { if (!ctrl.signal.aborted) setLoading(false); },
        (site, error) => { if (!ctrl.signal.aborted) addSourceError({ site, error }); },
        ctrl.signal,
      );
    } catch {}
  }, [input]);

  if (path === "/login" || path.startsWith("/read")) return null;

  const isHome = path === "/";

  const onSearchFocus = () => { window.scrollTo(0, 0); };

  return (
    <header className="shrink-0" style={{ background: "var(--bg)" }}>
      <nav className="border-b border-theme">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2">
          <Link to="/" onClick={() => { if (isHome) clear(); }} className={`btn-ghost text-base px-3 shrink-0 ${isHome ? "font-medium" : ""}`} style={{ color: isHome ? "var(--primary)" : "var(--t)" }}>首页</Link>
          {user && <Link to="/bookshelf" className={`btn-ghost text-base px-3 shrink-0 ${path === "/bookshelf" ? "font-medium" : ""}`} style={{ color: path === "/bookshelf" ? "var(--primary)" : "var(--t)" }}>书架</Link>}
          {user && <Link to="/history" className={`btn-ghost text-base px-3 shrink-0 ${path === "/history" ? "font-medium" : ""}`} style={{ color: path === "/history" ? "var(--primary)" : "var(--t)" }}>历史</Link>}
          <div className="flex-1" />
          {user ? <UserMenu /> : <Link to="/login" className="btn-primary text-xs px-3 shrink-0">登录</Link>}
        </div>
      </nav>
      {isHome && (
        <div className="border-b border-theme">
          <div className="max-w-5xl mx-auto px-4 py-2 flex gap-1">
            <div className="flex-1 relative">
              <input
                ref={searchInputRef}
                className="input pr-8"
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                placeholder="搜索漫画或粘贴链接"
                value={input}
                autoFocus={false}
                onFocus={onSearchFocus}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); doSearch(); } }}
              />
              {input && <button aria-label="清除" onClick={() => setInput("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center" style={{ color: "var(--t2)" }}>✕</button>}
            </div>
            <button className="btn-primary shrink-0 h-12 px-5 text-sm" onClick={doSearch}>搜索</button>
          </div>
        </div>
      )}
    </header>
  );
}

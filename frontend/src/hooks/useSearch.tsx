// Persist search state across navigation
import { createContext, useContext, useState, useCallback, useRef } from "react";
import type { SearchItem } from "../lib/api";

export interface SourceError { site: string; error: string; }

interface SearchState {
  keyword: string;
  results: SearchItem[];
  loading: boolean;
  sourceErrors: SourceError[];
  exactMatch: SearchItem | null;
}

interface SearchContextType extends SearchState {
  setKeyword: (k: string) => void;
  addResults: (items: SearchItem[]) => void;
  setResults: (items: SearchItem[]) => void;
  setLoading: (l: boolean) => void;
  addSourceError: (e: SourceError) => void;
  clearSourceErrors: () => void;
  setExactMatch: (m: SearchItem | null) => void;
  clear: () => void;
}

const SearchContext = createContext<SearchContextType>({
  keyword: "", results: [], loading: false, sourceErrors: [], exactMatch: null,
  setKeyword: () => {}, addResults: () => {}, setResults: () => {}, setLoading: () => {},
  addSourceError: () => {}, clearSourceErrors: () => {}, setExactMatch: () => {}, clear: () => {},
});

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<SourceError[]>([]);
  const [exactMatch, setExactMatchState] = useState<SearchItem | null>(null);
  // Persistent dedup set — avoids O(n²) rebuild on every addResults
  const seenKeysRef = useRef<Set<string>>(new Set());

  const addResults = useCallback((items: SearchItem[]) => {
    const newItems: SearchItem[] = [];
    for (const item of items) {
      const k = item.key || `${item.site}|${item.comicId}`;
      if (!seenKeysRef.current.has(k)) {
        seenKeysRef.current.add(k);
        newItems.push(item);
      }
    }
    if (newItems.length) setResults(prev => [...prev, ...newItems]);
  }, []);

  const addSourceError = useCallback((e: SourceError) => {
    setSourceErrors(prev => prev.find(x => x.site === e.site) ? prev : [...prev, e]);
  }, []);
  const clearSourceErrors = useCallback(() => setSourceErrors([]), []);

  // First exact match wins; later identical matches don't overwrite.
  const setExactMatch = useCallback((m: SearchItem | null) => {
    setExactMatchState(prev => (m === null ? null : (prev ? prev : m)));
  }, []);

  const clear = useCallback(() => {
    setKeyword(""); setResults([]); setLoading(false);
    setSourceErrors([]); setExactMatchState(null);
    seenKeysRef.current = new Set();
  }, []);

  return (
    <SearchContext.Provider value={{ keyword, results, loading, sourceErrors, exactMatch, setKeyword, addResults, setResults, setLoading, addSourceError, clearSourceErrors, setExactMatch, clear }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() { return useContext(SearchContext); }

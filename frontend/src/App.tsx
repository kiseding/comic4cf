import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { SearchProvider } from "./hooks/useSearch";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import ComicDetailPage from "./pages/ComicDetailPage";
import LoginPage from "./pages/LoginPage";
import { applyTheme, getTheme } from "./lib/theme";

const ReaderPage = lazy(() => import("./pages/ReaderPage"));
const BookshelfPage = lazy(() => import("./pages/BookshelfPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));

function Spinner() {
  return <div className="flex items-center justify-center min-h-[100dvh]"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[--primary] border-t-transparent" /></div>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppInner() {
  const { loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;

  const path = location.pathname;

  if (path.startsWith("/read")) {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/read/:site/:comicId/:chapterId" element={<RequireAuth><ReaderPage /></RequireAuth>} />
        </Routes>
      </Suspense>
    );
  }

  const navHidden = path === "/login";

  return (
    <div className="h-dvh flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {!navHidden && <Navbar />}
      <main className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/comic/:site/:comicId" element={<RequireAuth><ComicDetailPage /></RequireAuth>} />
          <Route path="/bookshelf" element={<RequireAuth><BookshelfPage /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  applyTheme(getTheme());

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (getTheme() === "auto") applyTheme("auto"); };
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  return (
    <AuthProvider>
      <SearchProvider>
        <AppInner />
      </SearchProvider>
    </AuthProvider>
  );
}

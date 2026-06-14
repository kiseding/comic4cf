import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const [animating, setAnimating] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) { setVisible(true); requestAnimationFrame(() => setAnimating(true)); }
    else { setAnimating(false); const t = setTimeout(() => setVisible(false), 300); return () => clearTimeout(t); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className={`absolute inset-0 bg-black/50 dark:bg-black/70 transition-opacity duration-300 ${animating ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-2xl w-full max-w-md p-6 transition-all duration-300 ${animating ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
        {title && <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{title}</h2>}
        {children}
        <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 text-lg leading-none transition-colors">✕</button>
      </div>
    </div>,
    document.body
  );
}

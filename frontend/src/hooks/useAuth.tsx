import { useState, useEffect, createContext, useContext, useCallback } from "react";
import type { User } from "../lib/api";
import * as api from "../lib/api";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, login: async () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const token = localStorage.getItem("token");
      if (token) {
        // Timeout the getMe call after 5s to prevent hanging
        const timeout = new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 5000));
        Promise.race([api.getMe(), timeout])
          .then(res => setUser((res as any).user))
          .catch(() => localStorage.removeItem("token"))
          .finally(() => setLoading(false));
      } else { setLoading(false); }
    } catch {
      setLoading(false);
    }
  }, []);

  const loginFn = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    localStorage.setItem("token", res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => { localStorage.removeItem("token"); setUser(null); }, []);

  return <AuthContext.Provider value={{ user, loading, login: loginFn, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }

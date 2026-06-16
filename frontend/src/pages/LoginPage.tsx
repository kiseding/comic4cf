import { useState } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setError("请输入用户名和密码"); return; }
    setLoading(true); setError("");
    try {
      await login(username.trim(), password);
      const params = new URLSearchParams(location.search);
      const returnTo = params.get("return");
      navigate(returnTo || "/");
    }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-sm mx-auto px-4 pt-16">
      <h1 className="text-2xl font-bold text-center mb-8">Comic4CF</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-500 mb-1">用户名</label>
          <input className="input" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名" autoComplete="username" />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">密码</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码" autoComplete="current-password" />
        </div>
        {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-600 dark:text-red-400">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? "登录中..." : "登录"}</button>
      </form>
      <p className="text-center text-xs text-gray-400 mt-6">账号由管理员创建和分发</p>
    </div>
  );
}

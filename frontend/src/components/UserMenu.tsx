import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import * as api from "../lib/api";
import { applyTheme, getTheme } from "../lib/theme";
import Modal from "./Modal";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [visible, setVisible] = useState(false);
  const [modal, setModal] = useState<null | "pw" | "logout" | "admin">(null);

  useEffect(() => {
    if (open) { setVisible(true); requestAnimationFrame(() => requestAnimationFrame(() => setAnimating(true))); }
    else { setAnimating(false); const t = setTimeout(() => setVisible(false), 300); return () => clearTimeout(t); }
  }, [open]);

  // Close on page scroll while menu is open
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="btn-ghost text-base px-3 min-h-[44px]">{user.username}</button>
      {visible && (
        <>
          <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${animating ? "opacity-100" : "opacity-0"}`} onClick={() => setOpen(false)} />
          <div className={`absolute right-0 top-full mt-1 z-50 w-40 card py-1 shadow-xl transition-all duration-300 origin-top-right ${animating ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <button onClick={() => { setOpen(false); setModal("pw"); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">修改密码</button>
            {user.isAdmin && <button onClick={() => { setOpen(false); setModal("admin"); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">用户管理</button>}
            <button onClick={() => { setOpen(false); const cur = getTheme(); const next = cur === "auto" ? "dark" : cur === "dark" ? "light" : "auto"; applyTheme(next); }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">主题: {({"auto":"自动","dark":"暗色","light":"浅色"} as Record<string,string>)[getTheme()]}</button>
            <hr className="my-1 border-gray-100 dark:border-gray-700" />
            <button onClick={() => { setOpen(false); setModal("logout"); }} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">退出</button>
          </div>
        </>
      )}
      <ChangePasswordModal open={modal === "pw"} onClose={() => setModal(null)} />
      <LogoutModal open={modal === "logout"} onClose={() => setModal(null)} logout={logout} />
      <AdminModal open={modal === "admin"} onClose={() => setModal(null)} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOldPw] = useState(""); const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState(""); const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!oldPw || !newPw) { setMsg("请填写完整"); return; }
    if (newPw.length < 6) { setMsg("新密码至少6个字符"); return; }
    setLoading(true); setMsg("");
    try { await api.changePassword(oldPw, newPw); setMsg("✅ 密码修改成功"); setOldPw(""); setNewPw(""); setTimeout(onClose, 1500); }
    catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="修改密码">
      <div className="space-y-3">
        <input className="input" type="password" placeholder="旧密码" value={oldPw} onChange={e => setOldPw(e.target.value)} />
        <input className="input" type="password" placeholder="新密码（至少6位）" value={newPw} onChange={e => setNewPw(e.target.value)} />
        {msg && <p className={`text-sm ${msg.startsWith("✅") ? "text-green-500" : "text-red-500"}`}>{msg}</p>}
        <button className="btn-primary w-full" onClick={submit} disabled={loading}>{loading ? "修改中..." : "确认修改"}</button>
      </div>
    </Modal>
  );
}

function LogoutModal({ open, onClose, logout }: { open: boolean; onClose: () => void; logout: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="退出登录">
      <p className="text-sm text-gray-500 mb-4">确定要退出当前账号吗？</p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onClose}>取消</button>
        <button className="btn-primary flex-1 bg-red-500 hover:bg-red-600" onClick={() => { logout(); onClose(); }}>确认退出</button>
      </div>
    </Modal>
  );
}

function AdminModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<Array<{ id: number; username: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState(""); const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");

  if (!loaded && open) { api.listUsers().then(res => { setUsers(res.users); setLoaded(true); }).catch(e => setMsg(e.message)); }

  const create = async () => {
    try { await api.adminCreateUser(newName, newPw); setMsg("✅ 用户已创建"); setNewName(""); setNewPw(""); api.listUsers().then(res => setUsers(res.users)); }
    catch (e: any) { setMsg(e.message); }
  };

  const resetPw = async (id: number) => {
    const pw = prompt("新密码（至少6位）:"); if (!pw || pw.length < 6) { setMsg("密码至少6个字符"); return; }
    try { await api.adminResetPassword(id, pw); setMsg("✅ 密码已重置"); } catch (e: any) { setMsg(e.message); }
  };

  const del = async (id: number, name: string) => {
    if (!confirm(`确定删除用户「${name}」？`)) return;
    try { await api.adminDeleteUser(id); setUsers(prev => prev.filter(u => u.id !== id)); setMsg("✅ 已删除"); } catch (e: any) { setMsg(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} title="用户管理">
      <div className="space-y-3">
        <div className="flex gap-1">
          <input className="input flex-1 text-sm" placeholder="用户名" value={newName} onChange={e => setNewName(e.target.value)} />
          <input className="input w-24 text-sm" type="password" placeholder="密码" value={newPw} onChange={e => setNewPw(e.target.value)} />
          <button className="btn-primary text-sm px-3" onClick={create}>新建</button>
        </div>
        {msg && <p className={`text-sm ${msg.startsWith("✅") ? "text-green-500" : "text-red-500"}`}>{msg}</p>}
        <div className="max-h-48 overflow-auto space-y-1">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100 dark:border-gray-700">
              <span>{u.username}{u.id === 1 && <span className="text-xs ml-1" style={{ color: "#6366f1" }}>管理员</span>}</span>
              {u.id !== 1 && (
                <div className="flex gap-2">
                  <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => resetPw(u.id)}>重置密码</button>
                  <button className="text-xs text-gray-400 hover:text-red-500" onClick={() => del(u.id, u.username)}>删除</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

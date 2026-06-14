# Comic4CF

在线漫画阅读器，基于 Cloudflare Pages + Workers + D1 + KV。

## 架构

```
浏览器 → Cloudflare Pages (SPA)
  └─ /api/* → Worker (Hono)
       ├── /auth/*       JWT 认证
       ├── /comics/*     漫画详情 + 章节
       ├── /img-proxy    图片代理（CDN 竞速 + 去水印）
       ├── /bookshelf    书架 (D1)
       ├── /history      阅读历史 (D1)
       └── /admin/*      用户管理
```

## 漫画源

| 源 |
|---|
| baozimh |

图片通过 Worker 代理加载，竞速 s1/s2 CDN 获取无水印版本。

## 项目结构

```
├── frontend/          React SPA (Vite + TailwindCSS + React Router)
│   └── src/
│       ├── pages/     HomePage, ReaderPage, ComicDetailPage, ...
│       ├── components/ Navbar, Modal, ComicCard, UserMenu
│       ├── hooks/     useAuth, useSearch
│       └── lib/       API 客户端
├── workers/           Cloudflare Worker (Hono)
│   └── src/
│       ├── index.ts   入口 (CORS + DB 初始化)
│       ├── api/       API 路由
│       ├── sites/     漫画源适配器
│       ├── auth/      JWT + 密码哈希
│       ├── db/        D1 Schema
│       ├── middleware/ 速率限制
│       └── utils/     HTTP 工具
└── .github/workflows/ CI/CD 自动部署
```

## API

### 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sources` | 源列表 |
| GET | `/api/homepage` | 热门漫画 |
| POST | `/api/search` | 搜索 |
| POST | `/api/search/stream` | SSE 流式搜索 |
| GET | `/api/comics/:site/:comicId` | 漫画详情 |
| GET | `/api/comics/:site/:comicId/:chapterId` | 章节图片 |
| GET | `/api/img-proxy?url=` | 图片代理 |
| POST | `/api/auth/login` | 登录 |

### 需认证

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/me` | 验证 token |
| PUT | `/api/auth/change-password` | 修改密码 |
| GET/POST | `/api/bookshelf` | 书架 |
| DELETE | `/api/bookshelf/:site/:comicId` | 移出书架 |
| GET/POST | `/api/history` | 阅读历史 |
| DELETE | `/api/history` | 清空历史 |
| PUT | `/api/progress/:site/:comicId` | 阅读进度 |

## 功能

- 无水印图片（Worker 海外 IP + CDN 竞速）
- 垂直滚动阅读器（键盘方向键 + 手势翻页）
- 常驻标题栏 + 目录弹窗（自动定位当前章节）
- 章节多页并行加载 + 预加载下一话
- 章节 DOM 缓存（前进/后退秒开）
- 管道式图片加载（前 2 张高优先级）
- 个人书架 + 阅读历史（D1 持久化）
- 看过的漫画显示"继续阅读"
- 反追踪（UA 轮换、CORS 域名限制）
- 速率限制（搜索/首页 60次/分钟）
- 首页浏览器缓存（30 分钟）
- 深色/浅色主题 + PWA

## 数据库

D1 自动建表：

| 表 | 说明 |
|---|---|
| `users` | 用户（PBKDF2 密码哈希） |
| `bookshelf` | 书架 |
| `history` | 阅读历史 |

## 缓存

| 层级 | TTL |
|---|---|
| 浏览器 localStorage | 30 分钟（首页） |
| KV 搜索结果 | 5 分钟 |
| KV 漫画详情 | 10 分钟 |
| KV 章节图片 | 30 分钟 |
| 内存 chapterCache | 会话期间（前进/后退） |

## 本地开发

```bash
pnpm install
cd frontend && pnpm dev   # http://localhost:5173
cd workers && pnpm dev    # http://localhost:8787
```

本地开发需创建 `.dev.vars` 配置 JWT_SECRET。

## 部署

推送 `main` 自动部署。需配置 GitHub Secrets：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers + Pages + D1 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 账号 ID |
| `D1_DATABASE_ID` | `wrangler d1 create comic4cf-db` |
| `KV_NAMESPACE_ID` | `wrangler kv:namespace create COMIC_CACHE` |
| `JWT_SECRET` | `openssl rand -hex 32` |

Worker 环境变量（wrangler.toml `[vars]`）：

| 变量 | 说明 |
|---|---|
| `PROXY_ORIGIN` | 图片代理域名（前端同域） |

## License

AGPL-3.0

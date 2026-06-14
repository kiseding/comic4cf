# Comic4CF

在线漫画阅读器，基于 Cloudflare Pages + Workers + D1 + KV。

## 架构

```
浏览器 → Cloudflare Pages (SPA)
  └─ /api/* → Worker (Hono)
       ├── /auth/*            JWT 认证
       ├── /comics/*/*        漫画详情
       ├── /comics/*/*/*      章节图片（JSON 元信息）
       ├── /comics/*/*/*/stream 二进制流（长度前缀 block）
       ├── /bookshelf         书架 (D1)
       ├── /history           阅读历史 (D1)
       └── /admin/*           用户管理
```

## 漫画源

| 源 |
|---|
| baozimh |

图片通过 Worker 跨境拉取，并行竞速 s1/s2 bzcdn CDN，fallback 到源地址。

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
│       ├── auth/      JWT + PBKDF2 密码哈希
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
| GET | `/api/homepage` | 热门漫画（KV 缓存 30 分钟） |
| POST | `/api/search` | 搜索（KV 缓存 5 分钟） |
| POST | `/api/search/stream` | SSE 流式搜索 |
| GET | `/api/comics/:site/:comicId` | 漫画详情（KV 缓存 10 分钟） |
| GET | `/api/comics/:site/:comicId/:chapterId` | 章节图片 URL + streamUrl |
| GET | `/api/comics/:site/:comicId/:chapterId/stream?urls=JSON` | 二进制流（所有图片一次请求） |
| POST | `/api/auth/login` | 登录（限流 10 次/分） |

### 需认证

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/me` | 验证 token |
| PUT | `/api/auth/change-password` | 修改密码（限流 10 次/分） |
| GET/POST | `/api/bookshelf` | 书架 |
| DELETE | `/api/bookshelf/:site/:comicId` | 移出书架 |
| GET/POST | `/api/history` | 阅读历史 |
| DELETE | `/api/history` | 清空历史 |
| PUT | `/api/progress/:site/:comicId` | 阅读进度 |

## 二进制流协议

章节图片通过单次 Worker 请求以 `application/octet-stream` 返回，避免 N 次跨境请求：

```
[ct-len:2B LE][ct-utf8][data-len:4B LE][data]...[0xFF, 0xFF]
```

- 每张图片：2 字节 content-type 长度 + content-type 字符串 + 4 字节数据长度 + 二进制数据
- 终结符：`0xFFFF`
- 前端边读边渲染 Blob URL，无需 base64 转换

## 功能

- 无水印图片（Worker 海外拉取 + CDN 竞速）
- 二进制流管道：所有图片单次跨境请求，逐张渲染
- 垂直滚动阅读器（键盘方向键 + 手势翻页）
- 常驻标题栏 + 目录弹窗（自动定位当前章节）
- 预加载下一话（缓存到内存 Map，上限 10 话）
- 前进/后退秒开（内存缓存 + 空数据后逐出旧条目）
- 个人书架 + 阅读历史 + 继续阅读（D1 持久化）
- 管理员后台（用户管理、重置密码）
- 反追踪（UA 轮换、Referer 伪装）
- 速率限制（搜索/首页 60 次/分，登录 10 次/分）
- 首页浏览器缓存（30 分钟）
- 深色/浅色/自动主题 + PWA

## 数据库

D1 自动建表：

| 表 | 说明 |
|---|---|
| `users` | 用户（PBKDF2 100000 轮迭代） |
| `bookshelf` | 书架（含阅读进度） |
| `history` | 阅读历史（保留最近 30 条） |

## 缓存

| 层级 | TTL | 说明 |
|---|---|---|
| 浏览器 localStorage | 30 分钟 | 首页漫画列表 |
| KV 搜索结果 | 5 分钟 | 关键词搜索 |
| KV 漫画详情 | 10 分钟 | 漫画信息 + 目录 |
| 内存 chapterCache | 会话期间 | 最多 10 章节 Blob URL |

## 本地开发

```bash
pnpm install
cd frontend && pnpm dev   # http://localhost:5173（/api 代理到 :8787）
cd workers && pnpm dev    # http://localhost:8787
```

本地开发需在 `workers/` 下创建 `.dev.vars`：

```
JWT_SECRET=your-secret-here
```

## 部署

推送 `main` 自动部署。需配置 GitHub Secrets：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers + Pages + D1 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 账号 ID |
| `D1_DATABASE_ID` | `wrangler d1 create comic4cf-db` |
| `KV_NAMESPACE_ID` | `wrangler kv:namespace create COMIC_CACHE` |
| `JWT_SECRET` | `openssl rand -hex 32` |

## License

AGPL-3.0

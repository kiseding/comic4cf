# Task: Consume Bulk Image Stream (Frontend)

配合后端改动，修改 ReaderPage 消费新的流式图片接口。

## API 契约

```
GET /api/comics/:site/:comicId/:chapterId
→ JSON: { id, title, first: [data:base64, ...], total: N, stream: "/api/comics/.../stream?urls=..." }
→ SSE: data: {"image": "data:base64..."} per image. Final: data: {"done": true}
```

## 修改 `ReaderPage.tsx`

### 1. 添加流式消费
在 fetch chapter images 的 useEffect 中：

```ts
api.getChapterImages(...).then(r => {
  if (stale) return;
  
  // Show first 3 immediately
  const initialImages = r.first || [];
  setImages(initialImages);
  setTitle(r.title);
  setLoading(false);
  
  // Stream remaining images
  if (r.stream && r.total > initialImages.length) {
    fetchStream(r.stream, (image) => {
      setImages(prev => [...prev, image]);
    });
  }
});
```

### 2. 添加 `fetchStream` 辅助函数
```ts
async function fetchStream(url: string, onImage: (img: string) => void) {
  try {
    const resp = await fetch(url);
    const reader = resp.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.done) return;
          if (parsed.image) onImage(parsed.image);
        } catch {}
      }
    }
  } catch {}
}
```

### 3. 移除不再需要的代码
- 删除 img-proxy URL 构建逻辑（前端不再用 img-proxy）
- 移除 `failedImages`、`retryTimestamps` 等重试逻辑（图已内联）
- 简化 `<img>` 为直接 `src={url}`（url 是 data:base64）

### 4. 更新 `api.ts` 类型
```ts
export interface ChapterImages {
  id: string;
  title: string;
  first?: string[];   // first 3 as base64
  total?: number;
  stream?: string;     // SSE stream URL for remaining
  images?: string[];   // kept for backward compat (unused)
}
```

## 验证
`npx tsc --noEmit`。不要 commit。

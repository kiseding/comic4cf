# Task: Bulk Fetch + Stream Images (Backend)

修改 comic4cf Worker 的章节图片 API，一次性拉取所有图片数据，前端只需 1 次跨域请求。

## 当前
```
浏览器 → Worker → 返回 [url1, url2, ...]
浏览器 → Worker/img-proxy → CDN (N 次跨域)
```

## 目标
```
浏览器 → Worker → 拉取所有图片 → 返回 JSON {first:[base64...], stream:true}
                         → 然后 SSE 流式推送剩余的
```

## 实现

### 1. 修改 `api/index.ts` 章节图片端点

```ts
api.get("/comics/:site/:comicId/:chapterId", async (c) => {
  ...
  const rawImages = await getRegistry().getChapterImages(...);
  
  // Fetch all images in parallel with a concurrency limit
  const BATCH_SIZE = 10;
  const headers = { "User-Agent": "...", Referer: "https://www.baozimh.com/" };
  
  // First 3: fetch immediately
  const first3 = await Promise.all(rawImages.slice(0, 3).map(async url => {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("content-type") || "image/jpeg";
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `data:${ct};base64,${b64}`;
  }));
  
  // Return first 3 immediately with stream flag
  const streamUrl = `/api/comics/${site}/${comicId}/${chapterId}/stream?urls=${encodeURIComponent(rawImages.slice(3).join(","))}`;
  
  return c.json({
    id: chapterId,
    title: ...,
    first: first3,
    total: rawImages.length,
    stream: streamUrl,
  });
});
```

### 2. 新增流式端点 `GET /api/comics/:site/:comicId/:chapterId/stream`
```ts
// This endpoint receives remaining URLs and streams them back
api.get("/comics/:site/:comicId/:chapterId/stream", async (c) => {
  const urls = c.req.query("urls");
  if (!urls) return c.json({ error: "missing urls" }, 400);
  const list = urls.split(",");
  
  return streamSSE(c, async (stream) => {
    // Process in batches, send each as it completes
    for (let i = 0; i < list.length; i += 5) {
      const batch = list.slice(i, i + 5);
      const results = await Promise.all(batch.map(async url => {
        try {
          const resp = await fetch(url, { headers: { "User-Agent": "...", Referer: "..." }, signal: AbortSignal.timeout(10000) });
          const buf = await resp.arrayBuffer();
          const ct = resp.headers.get("content-type") || "image/jpeg";
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          return `data:${ct};base64,${b64}`;
        } catch { return null; }
      }));
      for (const img of results) {
        if (img) await stream.writeSSE({ data: JSON.stringify({ image: img }) });
      }
    }
    await stream.writeSSE({ data: JSON.stringify({ done: true }) });
  });
});
```

## 验证
`npx tsc --noEmit`。不要 commit。

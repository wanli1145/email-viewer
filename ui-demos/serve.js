// 独立静态服务器，仅用于预览三套 UI Demo。
// 与现有产品的 server.js 完全独立，不加载任何真实凭证、不连接 IMAP。
// 启动：node ui-demos/serve.js  (默认端口 4321，可用 UI_DEMO_PORT 覆盖)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.UI_DEMO_PORT || 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

    // 支持 /ui-demos/... 前缀（与真实路由一致）及裸路径
    pathname = pathname.replace(/^\/ui-demos/, "") || "/";
    if (pathname === "/") pathname = "/index.html";
    if (pathname.endsWith("/")) pathname += "index.html";

    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(ROOT, safe);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<h1>404</h1><p>Demo 页面未找到。请访问 <a href='/'>/</a> 查看三套 Demo。</p>");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`UI Demos 预览: http://127.0.0.1:${PORT}/`);
  console.log(`  Demo A 高效率工作台:   http://127.0.0.1:${PORT}/ui-demos/efficient/`);
  console.log(`  Demo B 清爽收件箱:     http://127.0.0.1:${PORT}/ui-demos/calm/`);
  console.log(`  Demo C AI 指挥中心:    http://127.0.0.1:${PORT}/ui-demos/ai-native/`);
});

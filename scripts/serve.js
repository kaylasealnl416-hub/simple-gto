import { networkInterfaces } from "node:os";

const root = new URL("../", import.meta.url);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function safePath(pathname) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const fileUrl = new URL(cleanPath, root);
  if (!fileUrl.href.startsWith(root.href)) {
    return new URL("index.html", root);
  }
  return fileUrl;
}

function extension(pathname) {
  const index = pathname.lastIndexOf(".");
  return index >= 0 ? pathname.slice(index) : "";
}

Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let fileUrl = safePath(url.pathname);
    let file = Bun.file(fileUrl);
    if (!(await file.exists())) {
      fileUrl = new URL("index.html", root);
      file = Bun.file(fileUrl);
    }
    return new Response(file, {
      headers: {
        "content-type": types[extension(fileUrl.pathname)] || "application/octet-stream",
        "cache-control": "no-store"
      }
    });
  }
});

console.log(`本机预览: http://localhost:${port}`);
for (const entries of Object.values(networkInterfaces())) {
  for (const entry of entries ?? []) {
    if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
      console.log(`手机同 Wi-Fi 可试: http://${entry.address}:${port}`);
    }
  }
}
console.log("停止服务: Ctrl+C");

import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildApp } from "../src/server/app.ts";
import { findChromiumExecutable, PlaywrightPdfRenderer } from "../src/server/pdf.ts";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

/**
 * 端到端冒烟：真实 Chromium 打开 /print 路由（Paged.js 分页）并导出 PDF。
 * 前端未构建（dist 缺失）或本机无浏览器时跳过，不阻塞纯单元测试环境。
 */
test("PDF end-to-end export renders the paged print route", { timeout: 120_000 }, async (context) => {
  try {
    await access(path.join(distDir, "index.html"));
    await findChromiumExecutable();
  } catch {
    context.skip("缺少 dist 构建产物或本机浏览器，跳过端到端 PDF 测试");
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "resume-studio-e2e-"));
  const app = await buildApp({ storageDir: directory, staticDir: distDir });
  await app.listen({ host: "127.0.0.1", port: 0 });
  context.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const id = (await app.inject({ method: "GET", url: "/api/resumes" })).json().items[0].id;
  const response = await app.inject({ method: "GET", url: `/api/resumes/${id}/export/pdf?template=classic&paper=a4` });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^application\/pdf/);
  const pdf = response.rawPayload;
  assert.ok(pdf.subarray(0, 5).toString("latin1").startsWith("%PDF-"), "应返回真实 PDF 文件头");
  assert.ok(pdf.length > 5_000, `PDF 应包含实际渲染内容，当前 ${pdf.length} 字节`);
});

test("PDF exports finish after explicit readiness while a background request stays open", { timeout: 30_000 }, async (context) => {
  try {
    await findChromiumExecutable();
  } catch {
    context.skip("本机无浏览器，跳过端到端 PDF 测试");
    return;
  }
  let pendingRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/pending") {
      pendingRequests += 1;
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("still loading");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<html><body><h1>Printable content</h1><script>
      fetch('/pending');
      setTimeout(() => { document.documentElement.dataset.renderReady = 'true'; }, 50);
    </script></body></html>`);
  });
  const renderer = new PlaywrightPdfRenderer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    await renderer.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  // 同时提交两份，既覆盖有界串行队列，也验证成功不依赖 networkidle。
  const files = await Promise.all([renderer.render(url), renderer.render(url)]);
  assert.equal(pendingRequests, 2);
  for (const pdf of files) assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

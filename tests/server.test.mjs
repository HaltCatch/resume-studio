import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/server/app.ts";

const createTestApp = async (context, options = {}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resume-studio-test-"));
  const app = await buildApp({ storageDir: directory, versionIntervalMs: 0, ...options });
  context.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { app, directory };
};

test("PDF renderer failures return a recoverable error without a download attachment", async (context) => {
  const { app } = await createTestApp(context, {
    pdfRenderer: { render: async () => { throw new Error("page.goto timeout with internal URL"); }, close: async () => {} },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const id = (await app.inject({ method: "GET", url: "/api/resumes" })).json().items[0].id;
  const response = await app.inject({ method: "GET", url: `/api/resumes/${id}/export/pdf` });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["content-disposition"], undefined);
  assert.equal(response.json().message, "PDF 生成暂时失败，请稍后重试。");
  assert.doesNotMatch(response.body, /page.goto|internal URL/);
});

test("server persists resumes as markdown and exposes common exports", async (context) => {
  const { app, directory } = await createTestApp(context);

  const list = await app.inject({ method: "GET", url: "/api/resumes" });
  assert.equal(list.statusCode, 200);
  const initial = list.json().items;
  assert.equal(initial.length, 1);
  assert.equal(initial[0].title, "示例简历");

  const recordResponse = await app.inject({ method: "GET", url: `/api/resumes/${initial[0].id}` });
  const record = recordResponse.json();
  record.data.contact.name = "张三";
  const update = await app.inject({
    method: "PUT",
    url: `/api/resumes/${record.id}`,
    payload: { title: "Java 高级工程师", data: record.data },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().data.contact.name, "张三");

  const stored = await readFile(path.join(directory, `${record.id}.md`), "utf8");
  assert.match(stored, /^<!-- resume-studio:/);
  assert.match(stored, /resume-studio-data:/);
  assert.match(stored, /# 张三/);

  for (const format of ["markdown", "html", "json", "text"]) {
    const response = await app.inject({ method: "GET", url: `/api/resumes/${record.id}/export/${format}` });
    assert.equal(response.statusCode, 200, format);
    assert.match(response.headers["content-disposition"], /attachment/);
    assert.match(response.headers["content-disposition"], /Java%20%E9%AB%98%E7%BA%A7%E5%B7%A5%E7%A8%8B%E5%B8%88/);
  }

  // Markdown 导出只含正文，不泄漏内部元数据注释。
  const markdownExport = await app.inject({ method: "GET", url: `/api/resumes/${record.id}/export/markdown` });
  assert.doesNotMatch(markdownExport.body, /resume-studio/);

  const letterHtml = await app.inject({ method: "GET", url: `/api/resumes/${record.id}/export/html?paper=letter` });
  assert.match(letterHtml.body, /width:215\.9mm/);
  assert.match(letterHtml.body, /@page\{size:Letter/);
});

test("storage round-trip is lossless even when markdown projection is ambiguous", async (context) => {
  const { app } = await createTestApp(context);
  const id = (await app.inject({ method: "GET", url: "/api/resumes" })).json().items[0].id;
  const record = (await app.inject({ method: "GET", url: `/api/resumes/${id}` })).json();

  // 该要点在旧的 Markdown 解析中会被误判成新的经历行，现在以内嵌 JSON 为准。
  const trickyHighlights = ["**2024.01 - 2024.06** **平台｜重构**", "普通要点"];
  record.data.experiences[0].highlights = trickyHighlights;
  const update = await app.inject({ method: "PUT", url: `/api/resumes/${id}`, payload: { title: record.title, data: record.data } });
  assert.equal(update.statusCode, 200);

  const reloaded = (await app.inject({ method: "GET", url: `/api/resumes/${id}` })).json();
  assert.deepEqual(reloaded.data.experiences[0].highlights, trickyHighlights);
  assert.equal(reloaded.data.experiences.length, record.data.experiences.length);
});

test("legacy files without embedded JSON still load by parsing markdown", async (context) => {
  const { app, directory } = await createTestApp(context);
  const legacy = `<!-- resume-studio:{"id":"legacy-resume","title":"旧格式","createdAt":"2025-01-01T00:00:00.000Z","updatedAt":"2025-01-01T00:00:00.000Z"} -->

# 王五

## 专业技能

- 熟悉 Java。
`;
  await writeFile(path.join(directory, "legacy-resume.md"), legacy, "utf8");
  const response = await app.inject({ method: "GET", url: "/api/resumes/legacy-resume" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.contact.name, "王五");
});

test("updates keep version history and support rollback", async (context) => {
  const { app } = await createTestApp(context);
  const id = (await app.inject({ method: "GET", url: "/api/resumes" })).json().items[0].id;
  const record = (await app.inject({ method: "GET", url: `/api/resumes/${id}` })).json();
  const originalName = record.data.contact.name;

  record.data.contact.name = "第一版";
  const firstUpdate = await app.inject({ method: "PUT", url: `/api/resumes/${id}`, payload: { title: "v1", data: record.data } });
  assert.equal(firstUpdate.json().version, 2);
  record.data.contact.name = "第二版";
  await app.inject({ method: "PUT", url: `/api/resumes/${id}`, payload: { title: "v2", data: record.data } });

  const versions = (await app.inject({ method: "GET", url: `/api/resumes/${id}/versions` })).json().items;
  assert.equal(versions.length, 2);
  assert.equal(versions[0].name, "第一版");
  assert.equal(versions[0].version, 2);
  assert.equal(versions[1].name, originalName);
  assert.equal(versions[1].version, 1);

  const versionDetail = await app.inject({ method: "GET", url: `/api/resumes/${id}/versions/${versions[1].versionId}` });
  assert.equal(versionDetail.statusCode, 200);
  assert.equal(versionDetail.json().data.contact.name, originalName);

  const restore = await app.inject({ method: "POST", url: `/api/resumes/${id}/versions/${versions[1].versionId}/restore` });
  assert.equal(restore.statusCode, 200);
  assert.equal(restore.json().data.contact.name, originalName);
  // Grafana 风格：回滚生成新编号并带“从 vN 恢复”备注。
  assert.equal(restore.json().version, 4);
  assert.equal(restore.json().note, "从 v1 恢复");

  // 回滚前的当前状态（第二版）被强制快照，可以再滚回去。
  const afterRestore = (await app.inject({ method: "GET", url: `/api/resumes/${id}/versions` })).json().items;
  assert.equal(afterRestore.length, 3);
  assert.equal(afterRestore[0].name, "第二版");
  assert.equal(afterRestore[0].version, 3);

  const missing = await app.inject({ method: "POST", url: `/api/resumes/${id}/versions/999-notexist/restore` });
  assert.equal(missing.statusCode, 404);
});

test("optimistic concurrency rejects stale saves with 409", async (context) => {
  const { app } = await createTestApp(context);
  const id = (await app.inject({ method: "GET", url: "/api/resumes" })).json().items[0].id;
  const record = (await app.inject({ method: "GET", url: `/api/resumes/${id}` })).json();

  const first = await app.inject({
    method: "PUT",
    url: `/api/resumes/${id}`,
    payload: { title: record.title, data: record.data, expectedUpdatedAt: record.updatedAt },
  });
  assert.equal(first.statusCode, 200);

  const stale = await app.inject({
    method: "PUT",
    url: `/api/resumes/${id}`,
    payload: { title: record.title, data: record.data, expectedUpdatedAt: record.updatedAt },
  });
  assert.equal(stale.statusCode, 409);
  assert.match(stale.json().message, /其他窗口/);

  // 不带 expectedUpdatedAt 的保存（如导入覆盖）仍被允许。
  const unconditional = await app.inject({
    method: "PUT",
    url: `/api/resumes/${id}`,
    payload: { title: record.title, data: record.data },
  });
  assert.equal(unconditional.statusCode, 200);
});

test("exports honor the saved appearance with explicit query overrides", async (context) => {
  const { app } = await createTestApp(context);
  const id = (await app.inject({ method: "GET", url: "/api/resumes" })).json().items[0].id;
  const record = (await app.inject({ method: "GET", url: `/api/resumes/${id}` })).json();
  record.data.appearance = { template: "gallery", accent: "#7d2333", density: "compact" };
  const update = await app.inject({ method: "PUT", url: `/api/resumes/${id}`, payload: { title: record.title, data: record.data } });
  assert.equal(update.statusCode, 200);
  assert.deepEqual(update.json().data.appearance, record.data.appearance);

  // 不带参数导出 → 使用文档保存的外观（雅白现代基底，酒红主题色，紧凑密度）。
  const html = await app.inject({ method: "GET", url: `/api/resumes/${id}/export/html` });
  assert.match(html.body, /template-gallery/);
  assert.match(html.body, /--accent-rule:#7d2333/);
  assert.match(html.body, /--density-font:0\.93/);

  // accent 参数存在但为空 = 显式使用模板默认色。
  const plain = await app.inject({ method: "GET", url: `/api/resumes/${id}/export/html?accent=` });
  assert.doesNotMatch(plain.body, /--accent-rule:#7d2333/);
});

test("PDF export delegates to the deterministic print route with selected layout", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resume-studio-pdf-test-"));
  const calls = [];
  let closed = false;
  const pdfRenderer = {
    async render(url) {
      calls.push(url);
      return Buffer.from("%PDF-1.7\nmock");
    },
    async close() { closed = true; },
  };
  const app = await buildApp({ storageDir: directory, pdfRenderer });
  await app.listen({ host: "127.0.0.1", port: 0 });
  context.after(async () => {
    await app.close();
    assert.equal(closed, true);
    await rm(directory, { recursive: true, force: true });
  });

  const list = await app.inject({ method: "GET", url: "/api/resumes" });
  const id = list.json().items[0].id;
  const response = await app.inject({
    method: "GET",
    url: `/api/resumes/${id}/export/pdf?template=engineering&paper=letter`,
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^application\/pdf/);
  assert.match(response.headers["content-disposition"], /filename\*=UTF-8''/);
  assert.equal(calls.length, 1);
  const printUrl = new URL(calls[0]);
  assert.equal(printUrl.hostname, "127.0.0.1");
  const printParams = new URLSearchParams(printUrl.hash.split("?")[1]);
  assert.ok(printUrl.hash.startsWith(`#/print/${id}?`));
  assert.equal(printParams.get("template"), "engineering");
  assert.equal(printParams.get("paper"), "letter");
  assert.equal(printParams.get("density"), "standard");
});

test("missing hashed assets return 404 instead of the SPA document", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resume-studio-assets-test-"));
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "resume-studio-static-test-"));
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>app</title>");
  const app = await buildApp({ storageDir: directory, staticDir });
  context.after(async () => {
    await app.close();
    await Promise.all([directory, staticDir].map((target) => rm(target, { recursive: true, force: true })));
  });
  const response = await app.inject({ method: "GET", url: "/assets/missing.js" });
  assert.equal(response.statusCode, 404);
  assert.match(response.headers["content-type"], /^application\/json/);
});

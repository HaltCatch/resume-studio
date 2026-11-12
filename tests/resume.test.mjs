import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDefaultResume, normalizeResume, SCHEMA_VERSION } from "../src/domain/resume.ts";
import { createSampleResume } from "../src/server/sample.ts";
import { escapeHtml, splitItems, splitLines } from "../src/domain/text.ts";
import { reviewResume } from "../src/domain/review.ts";
import { parseResumeMarkdown } from "../src/application/importers/markdown.ts";
import { updateResumeField } from "../src/application/editor.ts";
import { importResumeText } from "../src/application/importer.ts";
import { serializeResumeMarkdown } from "../src/application/exporters/markdown.ts";
import { exportFileName, sanitizeFileNameBase } from "../src/domain/filename.ts";

test("default resume is an empty generic skeleton", () => {
  const skeleton = createDefaultResume();
  assert.equal(skeleton.schemaVersion, SCHEMA_VERSION);
  assert.equal(skeleton.contact.name, "");
  assert.deepEqual(skeleton.skills, []);
  assert.deepEqual(skeleton.experiences, []);
  assert.deepEqual(skeleton.projects, []);
  assert.deepEqual(skeleton.education, []);
  assert.deepEqual(skeleton.sectionOrder, ["summary", "education", "experiences", "skills", "projects"]);
  assert.deepEqual(normalizeResume(skeleton), skeleton);
});

test("sample resume is normalized and free of personal placeholders", () => {
  const sample = normalizeResume(createSampleResume());
  assert.equal(sample.schemaVersion, SCHEMA_VERSION);
  assert.ok(sample.projects.length >= 1);
  assert.ok(sample.skills.length >= 1);
  assert.doesNotMatch(JSON.stringify(sample), /鼎捷|CoreCoder|HomeLab/);
});

test("normalizer rejects invalid and future payloads", () => {
  assert.throws(() => normalizeResume(null), /JSON 对象/);
  assert.throws(() => normalizeResume({ schemaVersion: SCHEMA_VERSION + 1 }), /高于当前支持版本/);
});

test("normalizer removes non-string array values and generates missing ids", () => {
  const normalized = normalizeResume({
    schemaVersion: 1,
    contact: { name: "Test" },
    projects: [{ name: "P", stack: ["TypeScript", 42], highlights: ["Good", null] }],
  });
  assert.deepEqual(normalized.projects[0]?.stack, ["TypeScript"]);
  assert.deepEqual(normalized.projects[0]?.highlights, ["Good"]);
  assert.match(normalized.projects[0]?.id ?? "", /^project-/);
});

test("section order keeps valid user choices and restores missing sections", () => {
  const normalized = normalizeResume({ contact: { name: "Test" }, sectionOrder: ["projects", "education", "projects", "unknown"] });
  assert.deepEqual(normalized.sectionOrder, ["projects", "education", "summary", "experiences", "skills"]);
  assert.deepEqual(normalizeResume({ contact: { name: "Test" } }).sectionOrder, ["summary", "education", "experiences", "skills", "projects"]);
});

test("dynamic text is escaped and editors split structured lists", () => {
  assert.equal(escapeHtml('<img src=x onerror="boom">'), "&lt;img src=x onerror=&quot;boom&quot;&gt;");
  assert.deepEqual(splitItems("Java，K3s, Argo CD\nGitea"), ["Java", "K3s", "Argo CD", "Gitea"]);
  assert.deepEqual(splitLines("first\n\n second "), ["first", "second"]);
});

test("resume review detects placeholders and rewards completed contact details", () => {
  const draft = createSampleResume();
  draft.contact.name = "XXX";
  draft.contact.phone = "";
  draft.contact.email = "";
  const incomplete = reviewResume(draft);
  assert.ok(incomplete.score < 85);
  assert.ok(incomplete.items.some((item) => item.message.includes("占位")));

  draft.contact.name = "张三";
  draft.contact.phone = "13800000000";
  draft.contact.email = "hello@example.cn";
  const completed = reviewResume(draft);
  assert.ok(completed.score > incomplete.score);
});

test("markdown importer maps contact, sections and numbered project highlights", () => {
  const markdown = `# 张三

电话：13800000000 | 邮箱：hello@example.com | 博客：https://example.com
求职意向：后端开发工程师

## 教育背景

**2018.09 - 2022.06**　**某理工大学｜软件工程专业**　**本科**

## 工作经历

**2024.01 - 至今**　**某软件公司｜平台研发｜高级工程师**

- 负责企业平台研发与持续交付。

## 专业技能

- 编程语言：熟练掌握 **Java、JUC、JVM** 与常用设计模式。
- 熟悉 **Docker、Kubernetes、Jenkins、Helm** 持续交付体系。

## 项目经历

### AI Coding Agent

**2025.01 - 至今**　**角色：开发者**

**项目简介：** 实践模型规划、工具执行与结果回灌闭环。

**技术栈：** Python + LiteLLM + Function Calling

**工作内容：**

1. 实现 Agent Loop 与工具调用协议。
2. 实现会话持久化与上下文压缩。`;

  const imported = parseResumeMarkdown(markdown);
  assert.equal(imported.contact.name, "张三");
  assert.equal(imported.contact.phone, "13800000000");
  assert.deepEqual(imported.sectionOrder, ["education", "experiences", "skills", "projects", "summary"]);
  assert.equal(imported.education[0]?.major, "软件工程");
  assert.equal(imported.experiences[0]?.organization, "某软件公司");
  // “分类：内容”保留分类；无分类前缀的条目统一归入“专业技能”，不再按个人化关键词猜测。
  assert.deepEqual(imported.skills.map((group) => group.name), ["编程语言", "专业技能"]);
  assert.deepEqual(imported.projects[0]?.stack, ["Python", "LiteLLM", "Function Calling"]);
  assert.equal(imported.projects[0]?.highlights.length, 2);
});

test("markdown importer rejects unrelated content", () => {
  assert.throws(() => parseResumeMarkdown("# 随手笔记\n\n今天学习了一些内容。"), /未识别到/);
});

test("markdown importer rejects a recognized but malformed section", () => {
  const markdown = `# 张三

## 工作经历

这里没有符合要求的时间和公司行。

## 专业技能

- 熟悉 Java 与 Spring Boot。`;
  assert.throws(() => parseResumeMarkdown(markdown), /工作经历/);
});

test("markdown importer keeps an age suffix only once", () => {
  const markdown = `# 张三

年龄：27岁 | 性别：男

## 专业技能

- 熟悉 Java。`;
  assert.equal(parseResumeMarkdown(markdown).contact.extra, "27岁 · 男");
});

test("file importer detects content and reports invalid JSON clearly", () => {
  const markdown = "# 张三\n\n## 专业技能\n\n- 熟悉 Java。";
  assert.equal(importResumeText("resume.txt", "text/plain", markdown).format, "markdown");
  assert.throws(() => importResumeText("resume.json", "application/json", "{"), /JSON 格式错误/);
});

test("editor only updates whitelisted resume paths", () => {
  const draft = createSampleResume();
  assert.equal(updateResumeField(draft, "contact.name", "李四"), true);
  assert.equal(draft.contact.name, "李四");
  assert.equal(updateResumeField(draft, "projects.0.stack", "Java, K3s"), true);
  assert.deepEqual(draft.projects[0]?.stack, ["Java", "K3s"]);
  assert.equal(updateResumeField(draft, "contact.__proto__", "unsafe"), false);
  assert.equal(updateResumeField(draft, "projects.99.name", "越界"), false);
});

test("canonical markdown export can be imported without losing structured content", () => {
  const source = createSampleResume();
  source.contact.extra = "27岁 · 男";
  const imported = parseResumeMarkdown(serializeResumeMarkdown(source));
  assert.equal(imported.contact.extra, source.contact.extra);
  assert.deepEqual(imported.skills.map((item) => item.name), source.skills.map((item) => item.name));
  assert.deepEqual(imported.projects[0]?.stack, source.projects[0]?.stack);
  assert.equal(imported.experiences[0]?.highlights.length, source.experiences[0]?.highlights.length);
});

test("markdown export and visual renderer honor saved section order", async () => {
  const source = createSampleResume();
  source.sectionOrder = ["education", "experiences", "summary", "skills", "projects"];
  const markdown = serializeResumeMarkdown(source);
  assert.ok(markdown.indexOf("## 教育背景") < markdown.indexOf("## 工作经历"));
  const { renderResume } = await import("../src/render/templates.ts");
  const html = renderResume(source, "classic");
  assert.ok(html.indexOf("教育背景") < html.indexOf("工作经历"));
});

test("export file names use the persisted resume title and stay filesystem-safe", () => {
  assert.equal(exportFileName("Java 高级工程师", "pdf"), "Java 高级工程师.pdf");
  assert.equal(exportFileName(" 后端/AI:*工程师. ", "markdown"), "后端 AI 工程师.md");
  assert.equal(sanitizeFileNameBase("CON"), "_CON");
  assert.equal(exportFileName("<>:*?", "json"), "我的简历.json");
});

test("print CSS keeps compact entries together and lets long projects paginate by item", async () => {
  const css = await readFile(new URL("../src/resume.css", import.meta.url), "utf8");
  assert.match(css, /\.resume-entry\s*\{[^}]*break-inside:\s*avoid;/s);
  assert.match(css, /\.resume-entry\s*\{[^}]*page-break-inside:\s*avoid;/s);
  assert.match(css, /\.project-entry\s*\{[^}]*break-inside:\s*auto;/s);
  assert.match(css, /\.project-entry\s*\{[^}]*page-break-inside:\s*auto;/s);
  assert.match(css, /\.project-entry \.entry-intro\s*\{[^}]*break-inside:\s*avoid;/s);
  assert.match(css, /\.project-entry li\s*\{[^}]*break-inside:\s*avoid;/s);
  assert.doesNotMatch(css, /\.resume-entry\s*\{[^}]*break-inside:\s*avoid-page;/s);
});

test("appearance settings are normalized with safe fallbacks", () => {
  const fallback = normalizeResume({ contact: { name: "A" } }).appearance;
  assert.deepEqual(fallback, { template: "classic", accent: "", density: "standard" });
  const custom = normalizeResume({ contact: { name: "A" }, appearance: { template: "navy", accent: "#1F3A5F", density: "compact" } }).appearance;
  assert.deepEqual(custom, { template: "navy", accent: "#1F3A5F", density: "compact" });
  const invalid = normalizeResume({ contact: { name: "A" }, appearance: { template: 42, accent: "red", density: "cozy" } }).appearance;
  assert.deepEqual(invalid, { template: "classic", accent: "", density: "standard" });
});

test("renderResume derives accent and density tokens from appearance options", async () => {
  const { renderResume } = await import("../src/render/templates.ts");
  const html = renderResume(createSampleResume(), { template: "classic", accent: "#7d2333", density: "compact" });
  assert.match(html, /--accent-rule:#7d2333/);
  assert.match(html, /--accent-soft:#/);
  assert.match(html, /--density-font:0\.93/);
  assert.match(html, /--density-space:0\.72/);
});

test("template registry stays layout-only and unknown ids fall back to classic", async () => {
  const { renderResume, templates } = await import("../src/render/templates.ts");
  const data = createSampleResume();
  // 已下线的配色变体 id（可能残留在旧简历的 appearance 里）回退 classic 基底。
  const legacy = renderResume(data, "navy");
  assert.match(legacy, /class="resume-document template-classic"/);
  const classic = renderResume(data, "classic");
  assert.doesNotMatch(classic, /style="--/);
  const gallery = renderResume(data, "gallery");
  assert.match(gallery, /class="resume-document template-gallery"/);
  for (const template of templates) {
    assert.ok(["classic", "engineering", "academic", "editorial", "gallery"].includes(template.base), template.id);
    // 配色差异交给主题色选择，模板清单不再收录纯 tokens 变体。
    assert.equal(template.tokens, undefined, `${template.id} 不应携带纯配色 tokens`);
  }
});

test("every template provides real page margins on continuation pages", async () => {
  const source = await readFile(new URL("../src/application/paginator.ts", import.meta.url), "utf8");
  // 展示版首页 banner 出血靠 @page :first；:first 是独立边距集，必须写完整 margin（含底边距）。
  assert.match(source, /editorial:.*@page :first \{ margin: 0 0 12mm; \}/s);
  assert.doesNotMatch(source, /:first \{ margin-top/);
  assert.doesNotMatch(source, /@page \{ margin: 0/);
});

test("sidebar template is fully removed", async () => {
  const [templates, styles, resumeCss] = await Promise.all([
    readFile(new URL("../src/render/templates.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/resume.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(templates, /sidebar/);
  assert.doesNotMatch(styles, /sidebar/);
  assert.doesNotMatch(resumeCss, /sidebar/);
});

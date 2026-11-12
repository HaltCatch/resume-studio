import { access } from "node:fs/promises";
import path from "node:path";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { serializeResumeHtml } from "../application/exporters/html.ts";
import { serializeResumeText } from "../application/exporters/markdown.ts";
import { createDefaultResume, normalizeResume, type ResumeData } from "../domain/resume.ts";
import { isPaperId } from "../domain/paper.ts";
import { exportFileName, type ExportFormat } from "../domain/filename.ts";
import { isTemplateId, type TemplateId } from "../render/templates.ts";
import { ACCENT_PATTERN, isDensityId } from "../render/theme.ts";
import { ConflictError, MarkdownResumeRepository } from "./storage.ts";
import { PlaywrightPdfRenderer, type PdfRenderer } from "./pdf.ts";

const saveSchema = z.object({
  title: z.string().min(1).max(80),
  data: z.unknown().optional(),
  expectedUpdatedAt: z.string().optional(),
});

export interface AppOptions {
  storageDir: string;
  staticDir?: string;
  logger?: boolean;
  pdfRenderer?: PdfRenderer;
  /** 自动版本快照的最小间隔毫秒数；0 = 每次保存都记录版本。 */
  versionIntervalMs?: number;
}

interface ExportQuery {
  template?: string;
  paper?: string;
  accent?: string;
  density?: string;
}

/** 导出视图参数：查询参数优先（所见即所得），缺省回退到简历保存的外观设置。 */
const exportView = (data: ResumeData, query: ExportQuery) => {
  const appearance = data.appearance;
  return {
    template: isTemplateId(query.template) ? query.template : isTemplateId(appearance.template) ? appearance.template : "classic" as TemplateId,
    paper: isPaperId(query.paper) ? query.paper : "a4" as const,
    // accent 参数存在即显式覆盖（空值 = 明确使用模板默认色），缺席才回退文档设置。
    accent: query.accent !== undefined ? (ACCENT_PATTERN.test(query.accent) ? query.accent : "") : appearance.accent,
    density: isDensityId(query.density) ? query.density : appearance.density,
  };
};

const attachment = (title: string, format: ExportFormat): string => {
  const fileName = exportFileName(title, format);
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="resume.${fileName.split(".").at(-1)}"; filename*=UTF-8''${encoded}`;
};

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const repository = new MarkdownResumeRepository(options.storageDir, { versionIntervalMs: options.versionIntervalMs });
  const pdfRenderer = options.pdfRenderer ?? new PlaywrightPdfRenderer();
  await repository.init();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (request.url === "/" || request.url === "/index.html") reply.header("Cache-Control", "no-cache");
    return payload;
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/resumes", async () => ({ items: await repository.list() }));
  app.get<{ Params: { id: string } }>("/api/resumes/:id", async (request, reply) => {
    const record = await repository.get(request.params.id);
    return record ?? reply.code(404).send({ message: "简历不存在" });
  });
  app.post("/api/resumes", async (request, reply) => {
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "简历数据无效" });
    const data = parsed.data.data === undefined ? createDefaultResume() : normalizeResume(parsed.data.data);
    return reply.code(201).send(await repository.create({ title: parsed.data.title, data }));
  });
  app.put<{ Params: { id: string } }>("/api/resumes/:id", async (request, reply) => {
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.data === undefined) return reply.code(400).send({ message: "简历数据无效" });
    try {
      const record = await repository.update(request.params.id, {
        title: parsed.data.title,
        data: normalizeResume(parsed.data.data),
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      });
      return record ?? reply.code(404).send({ message: "简历不存在" });
    } catch (error) {
      if (error instanceof ConflictError) return reply.code(409).send({ message: error.message });
      throw error;
    }
  });
  app.get<{ Params: { id: string } }>("/api/resumes/:id/versions", async (request) => {
    return { items: await repository.listVersions(request.params.id) };
  });
  app.get<{ Params: { id: string; versionId: string } }>("/api/resumes/:id/versions/:versionId", async (request, reply) => {
    const version = await repository.getVersion(request.params.id, request.params.versionId);
    return version ?? reply.code(404).send({ message: "版本不存在" });
  });
  app.post<{ Params: { id: string; versionId: string } }>("/api/resumes/:id/versions/:versionId/restore", async (request, reply) => {
    const record = await repository.restoreVersion(request.params.id, request.params.versionId);
    return record ?? reply.code(404).send({ message: "版本不存在" });
  });
  app.delete<{ Params: { id: string } }>("/api/resumes/:id", async (request, reply) => {
    return (await repository.delete(request.params.id)) ? reply.code(204).send() : reply.code(404).send({ message: "简历不存在" });
  });
  app.get<{ Params: { id: string; format: string }; Querystring: ExportQuery }>("/api/resumes/:id/export/:format", async (request, reply) => {
    const record = await repository.get(request.params.id);
    if (!record) return reply.code(404).send({ message: "简历不存在" });
    const format = request.params.format;
    if (format === "markdown" || format === "md") {
      reply.type("text/markdown; charset=utf-8").header("Content-Disposition", attachment(record.title, "markdown"));
      return await repository.getMarkdown(record.id);
    }
    if (format === "json") {
      reply.type("application/json; charset=utf-8").header("Content-Disposition", attachment(record.title, "json"));
      return JSON.stringify(record.data, null, 2);
    }
    if (format === "text" || format === "txt") {
      reply.type("text/plain; charset=utf-8").header("Content-Disposition", attachment(record.title, "text"));
      return serializeResumeText(record.data);
    }
    if (format === "html") {
      const view = exportView(record.data, request.query);
      reply.type("text/html; charset=utf-8").header("Content-Disposition", attachment(record.title, "html"));
      return serializeResumeHtml(record.data, view, view.paper);
    }
    if (format === "pdf") {
      const view = exportView(record.data, request.query);
      const address = app.server.address();
      if (!address || typeof address === "string") return reply.code(503).send({ message: "PDF 服务尚未就绪" });
      const printUrl = new URL(`http://127.0.0.1:${address.port}/`);
      const params = new URLSearchParams({ template: view.template, paper: view.paper, density: view.density });
      if (view.accent) params.set("accent", view.accent);
      printUrl.hash = `/print/${encodeURIComponent(record.id)}?${params}`;
      let pdf: Buffer;
      try {
        pdf = await pdfRenderer.render(printUrl.href);
      } catch (error) {
        request.log.error(error, "PDF export failed");
        return reply.code(503).send({ message: "PDF 生成暂时失败，请稍后重试。" });
      }
      reply.type("application/pdf").header("Content-Disposition", attachment(record.title, "pdf"));
      return reply.send(pdf);
    }
    return reply.code(400).send({ message: "不支持的导出格式" });
  });

  app.addHook("onClose", async () => { await pdfRenderer.close(); });

  const staticDir = options.staticDir ?? path.resolve(process.cwd(), "dist");
  try {
    await access(path.join(staticDir, "index.html"));
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: "/",
      maxAge: "1y",
      immutable: true,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ message: "接口不存在" });
      if (request.url.startsWith("/assets/")) return reply.code(404).send({ message: "页面资源不存在" });
      return reply.header("Cache-Control", "no-cache").sendFile("index.html", { maxAge: 0, immutable: false });
    });
  } catch {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ message: "页面资源尚未构建" }));
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({ message: error instanceof Error ? error.message : "服务端错误" });
  });
  return app;
}

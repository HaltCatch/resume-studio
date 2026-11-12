import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeResumeMarkdown } from "../application/exporters/markdown.ts";
import { parseResumeMarkdown } from "../application/importers/markdown.ts";
import { normalizeResume, type ResumeData } from "../domain/resume.ts";
import { createSampleResume } from "./sample.ts";
import type { ResumeRecord, ResumeSummary, ResumeVersionSummary, SaveResumeInput } from "../domain/record.ts";

interface StoredMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 单调递增的保存序号（v1、v2…），回滚也会 +1，删除旧快照不影响编号。 */
  version?: number;
  /** 本次保存的备注，如“从 v9 恢复”；普通保存时清空。 */
  note?: string;
}

/** 保存内容与客户端已知版本不一致（他处已修改）。 */
export class ConflictError extends Error {}

const META_PREFIX = "<!-- resume-studio:";
const DATA_PREFIX = "<!-- resume-studio-data:";
const validId = /^[a-zA-Z0-9_-]+$/;

/*
 * JSON 只在字符串里可能出现 `--`（数字与结构字符不会连续出现 `-`），
 * 把第二个 `-` 换成合法的 - 转义即可安全放进 HTML 注释，JSON.parse 原样还原。
 */
const jsonComment = (value: unknown): string => JSON.stringify(value).replace(/--/g, "-\\u002d");

/**
 * 文件格式（无损）：
 *   第 1 行：元数据注释（id / 标题 / 时间戳）
 *   第 2 行：规范化 ResumeData 的 JSON 注释 —— 读取时以此为准，杜绝 Markdown 往返损耗
 *   其余：由数据生成的 Markdown 正文，供人阅读与 git diff
 * 旧格式（无第 2 行）仍可读取：回退为解析 Markdown 正文。
 */
const encodeFile = (metadata: StoredMetadata, data: ResumeData): string =>
  `${META_PREFIX}${jsonComment(metadata)} -->\n${DATA_PREFIX}${jsonComment(data)} -->\n\n${serializeResumeMarkdown(data)}`;

const decodeFile = (content: string): { metadata: StoredMetadata; markdown: string; data: ResumeData } => {
  const lineEnd = content.indexOf("\n");
  const firstLine = (lineEnd >= 0 ? content.slice(0, lineEnd) : content).trim();
  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith("-->")) throw new Error("缺少简历元数据");
  const metadata = JSON.parse(firstLine.slice(META_PREFIX.length, -3).trim()) as StoredMetadata;
  if (!metadata.id || !validId.test(metadata.id) || !metadata.title || !metadata.createdAt || !metadata.updatedAt) {
    throw new Error("简历元数据无效");
  }
  const rest = lineEnd >= 0 ? content.slice(lineEnd + 1) : "";
  if (rest.startsWith(DATA_PREFIX)) {
    const dataLineEnd = rest.indexOf("\n");
    const dataLine = (dataLineEnd >= 0 ? rest.slice(0, dataLineEnd) : rest).trim();
    if (!dataLine.endsWith("-->")) throw new Error("简历数据注释无效");
    const data = normalizeResume(JSON.parse(dataLine.slice(DATA_PREFIX.length, -3).trim()));
    const markdown = (dataLineEnd >= 0 ? rest.slice(dataLineEnd + 1) : "").trimStart();
    return { metadata, markdown, data };
  }
  const markdown = rest.trimStart();
  return { metadata, markdown, data: normalizeResume(parseResumeMarkdown(markdown)) };
};

const summaryOf = (metadata: StoredMetadata, data: ResumeData): ResumeSummary => ({
  ...metadata,
  name: data.contact.name,
  headline: data.contact.headline,
  projectCount: data.projects.length,
  experienceCount: data.experiences.length,
});

const sameState = (a: string, b: string): boolean => {
  try {
    const left = decodeFile(a);
    const right = decodeFile(b);
    return left.metadata.title === right.metadata.title && JSON.stringify(left.data) === JSON.stringify(right.data);
  } catch {
    return false;
  }
};

export interface RepositoryOptions {
  /** 两次自动版本快照之间的最小间隔；0 表示每次保存都生成版本（测试用）。 */
  versionIntervalMs?: number;
  /** 每份简历保留的最大版本数，超出后删除最旧版本。 */
  maxVersions?: number;
}

export class MarkdownResumeRepository {
  private readonly directory: string;
  private readonly versionIntervalMs: number;
  private readonly maxVersions: number;

  constructor(directory: string, options: RepositoryOptions = {}) {
    this.directory = directory;
    this.versionIntervalMs = options.versionIntervalMs ?? 10 * 60_000;
    this.maxVersions = options.maxVersions ?? 50;
  }

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await mkdir(path.join(this.directory, ".trash"), { recursive: true });
    const files = await this.markdownFiles();
    if (!files.length) {
      const now = new Date().toISOString();
      await this.write("sample-resume", {
        id: "sample-resume",
        title: "示例简历",
        createdAt: now,
        updatedAt: now,
        version: 1,
      }, createSampleResume());
    }
  }

  async list(): Promise<ResumeSummary[]> {
    const records = await Promise.all((await this.markdownFiles()).map(async (file) => {
      try {
        const decoded = decodeFile(await readFile(path.join(this.directory, file), "utf8"));
        return summaryOf(decoded.metadata, decoded.data);
      } catch {
        return null;
      }
    }));
    return records.filter((item): item is ResumeSummary => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<ResumeRecord | null> {
    this.assertId(id);
    const raw = await this.readRaw(id);
    if (raw === null) return null;
    const decoded = decodeFile(raw);
    return { ...summaryOf(decoded.metadata, decoded.data), createdAt: decoded.metadata.createdAt, data: decoded.data };
  }

  async getMarkdown(id: string): Promise<string | null> {
    this.assertId(id);
    const raw = await this.readRaw(id);
    return raw === null ? null : decodeFile(raw).markdown;
  }

  async create(input: SaveResumeInput): Promise<ResumeRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const data = normalizeResume(input.data);
    const metadata = { id, title: this.cleanTitle(input.title), createdAt: now, updatedAt: now, version: 1 };
    await this.write(id, metadata, data);
    return { ...summaryOf(metadata, data), createdAt: now, data };
  }

  async update(id: string, input: SaveResumeInput): Promise<ResumeRecord | null> {
    this.assertId(id);
    const raw = await this.readRaw(id);
    if (raw === null) return null;
    const existing = decodeFile(raw);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.metadata.updatedAt) {
      throw new ConflictError("简历已在其他窗口被修改；请刷新页面后再继续编辑");
    }
    const data = normalizeResume(input.data);
    const metadata = {
      id,
      title: this.cleanTitle(input.title),
      createdAt: existing.metadata.createdAt,
      updatedAt: new Date().toISOString(),
      version: (existing.metadata.version ?? await this.legacyVersionBase(id)) + 1,
    };
    await this.snapshot(id, raw);
    await this.write(id, metadata, data);
    return { ...summaryOf(metadata, data), createdAt: metadata.createdAt, data };
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    try {
      const trashPath = path.join(this.directory, ".trash", `${id}.${Date.now()}.md`);
      await rename(this.filePath(id), trashPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async listVersions(id: string): Promise<ResumeVersionSummary[]> {
    this.assertId(id);
    const files = await this.versionFiles(id);
    const versions = await Promise.all(files.map(async (file, index) => {
      try {
        const decoded = decodeFile(await readFile(path.join(this.versionsDir(id), file), "utf8"));
        const summary: ResumeVersionSummary = {
          versionId: file.slice(0, -3),
          // 旧快照没有编号时按时间序兜底，避免界面出现空编号。
          version: decoded.metadata.version ?? index + 1,
          savedAt: decoded.metadata.updatedAt,
          title: decoded.metadata.title,
          name: decoded.data.contact.name,
        };
        if (decoded.metadata.note) summary.note = decoded.metadata.note;
        return summary;
      } catch {
        return null;
      }
    }));
    return versions.filter((item): item is ResumeVersionSummary => item !== null)
      .sort((a, b) => b.versionId.localeCompare(a.versionId));
  }

  async getVersion(id: string, versionId: string): Promise<{ version?: number; savedAt: string; title: string; note?: string; data: ResumeData } | null> {
    this.assertId(id);
    this.assertId(versionId);
    try {
      const decoded = decodeFile(await readFile(path.join(this.versionsDir(id), `${versionId}.md`), "utf8"));
      return {
        version: decoded.metadata.version,
        savedAt: decoded.metadata.updatedAt,
        title: decoded.metadata.title,
        note: decoded.metadata.note,
        data: decoded.data,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return null;
    }
  }

  /** 回滚：先强制快照当前状态（回滚本身可再回滚），再以版本内容覆盖当前简历。 */
  async restoreVersion(id: string, versionId: string): Promise<ResumeRecord | null> {
    this.assertId(id);
    const version = await this.getVersion(id, versionId);
    if (!version) return null;
    const raw = await this.readRaw(id);
    if (raw === null) return null;
    const existing = decodeFile(raw);
    await this.snapshot(id, raw, true);
    const metadata = {
      id,
      title: version.title,
      createdAt: existing.metadata.createdAt,
      updatedAt: new Date().toISOString(),
      version: (existing.metadata.version ?? await this.legacyVersionBase(id)) + 1,
      note: version.version ? `从 v${version.version} 恢复` : "从历史版本恢复",
    };
    await this.write(id, metadata, version.data);
    return { ...summaryOf(metadata, version.data), createdAt: metadata.createdAt, data: version.data };
  }

  private async readRaw(id: string): Promise<string | null> {
    try {
      return await readFile(this.filePath(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * 把覆盖前的文件内容存为一个版本。
   * 节流：距最近版本不足 versionIntervalMs、或与最近版本内容相同时跳过（force 时不跳过）。
   */
  private async snapshot(id: string, rawContent: string, force = false): Promise<void> {
    const dir = this.versionsDir(id);
    await mkdir(dir, { recursive: true });
    const files = await this.versionFiles(id);
    const newest = files.at(-1);
    if (newest) {
      const newestContent = await readFile(path.join(dir, newest), "utf8").catch(() => null);
      if (newestContent !== null && sameState(newestContent, rawContent)) return;
      if (!force) {
        const newestTime = Number(newest.split("-")[0]);
        if (Number.isFinite(newestTime) && Date.now() - newestTime < this.versionIntervalMs) return;
      }
    }
    const versionId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    await writeFile(path.join(dir, `${versionId}.md`), rawContent, "utf8");
    const all = await this.versionFiles(id);
    const excess = all.slice(0, Math.max(0, all.length - this.maxVersions));
    await Promise.all(excess.map((file) => rm(path.join(dir, file), { force: true })));
  }

  /**
   * 旧格式文件没有版本编号：把“当前状态”视作第 N+1 版（N 为已有快照数，
   * 快照列表也按时间序兜底编号为 v1..vN），保证迁移后编号连续且不重复。
   */
  private async legacyVersionBase(id: string): Promise<number> {
    return (await this.versionFiles(id)).length + 1;
  }

  private versionsDir(id: string): string {
    return path.join(this.directory, ".versions", id);
  }

  private async versionFiles(id: string): Promise<string[]> {
    try {
      // 版本文件名以 13 位毫秒时间戳开头，字典序即时间序。
      return (await readdir(this.versionsDir(id))).filter((file) => file.endsWith(".md")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async markdownFiles(): Promise<string[]> {
    return (await readdir(this.directory)).filter((file) => file.endsWith(".md") && !file.endsWith(".tmp.md"));
  }

  private filePath(id: string): string {
    return path.join(this.directory, `${id}.md`);
  }

  private async write(id: string, metadata: StoredMetadata, data: ResumeData): Promise<void> {
    this.assertId(id);
    const target = this.filePath(id);
    const temporary = path.join(this.directory, `${id}.${randomUUID()}.tmp.md`);
    await writeFile(temporary, encodeFile(metadata, data), "utf8");
    await rename(temporary, target);
  }

  private assertId(id: string): void {
    if (!validId.test(id)) throw new Error("简历 ID 无效");
  }

  private cleanTitle(title: string): string {
    const value = title.replace(/[\r\n]+/g, " ").trim().slice(0, 80);
    if (!value) throw new Error("简历标题不能为空");
    return value;
  }
}

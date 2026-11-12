import { parseResumeMarkdown } from "./importers/markdown.ts";
import { normalizeResume, type ResumeData } from "../domain/resume.ts";

export type ResumeImportFormat = "markdown" | "json";

export interface ResumeImportResult {
  data: ResumeData;
  format: ResumeImportFormat;
  message: string;
}

const detectFormat = (fileName: string, mimeType: string, content: string): ResumeImportFormat => {
  if (/\.(?:md|markdown)$/i.test(fileName) || mimeType === "text/markdown") return "markdown";
  if (/\.json$/i.test(fileName) || mimeType === "application/json") return "json";
  return content.trimStart().startsWith("{") ? "json" : "markdown";
};

export function importResumeText(fileName: string, mimeType: string, content: string): ResumeImportResult {
  const format = detectFormat(fileName, mimeType, content);
  if (format === "markdown") {
    return { data: normalizeResume(parseResumeMarkdown(content)), format, message: "Markdown 简历导入成功" };
  }
  try {
    return { data: normalizeResume(JSON.parse(content)), format, message: "JSON 简历导入成功" };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("JSON 格式错误，请检查文件内容");
    throw error;
  }
}

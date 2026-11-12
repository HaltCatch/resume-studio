import { createBrowserStore } from "./browser-store";
import { normalizeResume } from "../domain/resume";
import type { ResumeRecord, ResumeSummary, ResumeVersionSummary, SaveResumeInput } from "../domain/record";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: `请求失败（${response.status}）` })) as { message?: string };
    throw new ApiError(body.message ?? `请求失败（${response.status}）`, response.status);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

const normalizeRecord = (record: ResumeRecord): ResumeRecord => ({ ...record, data: normalizeResume(record.data) });

const serverApi = {
  async exportPdf(url: string): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new Error("PDF 生成超时，请稍后重试。");
      throw new Error("PDF 下载连接中断，请检查网络后重试。");
    }
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf")) {
      throw new ApiError("PDF 生成失败，请稍后重试。", response.status);
    }
    return response.blob();
  },
  async list(): Promise<ResumeSummary[]> {
    return (await request<{ items: ResumeSummary[] }>("/api/resumes")).items;
  },
  async get(id: string): Promise<ResumeRecord> {
    return normalizeRecord(await request<ResumeRecord>(`/api/resumes/${encodeURIComponent(id)}`));
  },
  async create(input: SaveResumeInput): Promise<ResumeRecord> {
    return normalizeRecord(await request<ResumeRecord>("/api/resumes", { method: "POST", body: JSON.stringify(input) }));
  },
  async update(id: string, input: SaveResumeInput): Promise<ResumeRecord> {
    return normalizeRecord(await request<ResumeRecord>(`/api/resumes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }));
  },
  async remove(id: string): Promise<void> {
    await request<void>(`/api/resumes/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async listVersions(id: string): Promise<ResumeVersionSummary[]> {
    return (await request<{ items: ResumeVersionSummary[] }>(`/api/resumes/${encodeURIComponent(id)}/versions`)).items;
  },
  async restoreVersion(id: string, versionId: string): Promise<ResumeRecord> {
    return normalizeRecord(await request<ResumeRecord>(
      `/api/resumes/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST" },
    ));
  },
};

export const browserOnly = import.meta.env.VITE_BROWSER_ONLY === "true";
export const resumeApi = browserOnly ? { ...createBrowserStore(localStorage), exportPdf: serverApi.exportPdf } : serverApi;

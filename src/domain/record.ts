import type { ResumeData } from "./resume";

export interface ResumeSummary {
  id: string;
  title: string;
  name: string;
  headline: string;
  updatedAt: string;
  projectCount: number;
  experienceCount: number;
  /** 单调递增的保存序号（v1、v2…）。 */
  version?: number;
  /** 本次保存的备注，如“从 v9 恢复”。 */
  note?: string;
}

export interface ResumeRecord extends ResumeSummary {
  createdAt: string;
  data: ResumeData;
}

export interface SaveResumeInput {
  title: string;
  data: ResumeData;
  /** 客户端已知的 updatedAt；与服务端不一致时保存被拒（409），防止多窗口互相覆盖。 */
  expectedUpdatedAt?: string;
}

export interface ResumeVersionSummary {
  versionId: string;
  version: number;
  savedAt: string;
  title: string;
  name: string;
  note?: string;
}

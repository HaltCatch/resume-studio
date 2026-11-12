import { z } from "zod";

export const SCHEMA_VERSION = 1;

export interface Contact {
  name: string;
  headline: string;
  phone: string;
  email: string;
  website: string;
  location: string;
  extra: string;
}

export interface SkillGroup {
  id: string;
  name: string;
  items: string[];
}

export interface Experience {
  id: string;
  organization: string;
  role: string;
  period: string;
  summary: string;
  highlights: string[];
}

export interface Project {
  id: string;
  name: string;
  role: string;
  period: string;
  summary: string;
  stack: string[];
  highlights: string[];
}

export interface Education {
  id: string;
  school: string;
  degree: string;
  major: string;
  period: string;
}

export type DensityId = "compact" | "standard" | "relaxed";

/** 文档级外观设置：随简历保存，导出/预览默认取此值。template 在渲染层解析，未知 id 回退默认模板。 */
export interface ResumeAppearance {
  template: string;
  /** 六位 hex 主题色；空串表示使用模板默认配色。 */
  accent: string;
  density: DensityId;
}

/** 可在编辑器和简历正文中排序的内容模块。联系信息始终固定在页首。 */
export const DEFAULT_SECTION_ORDER = ["summary", "education", "experiences", "skills", "projects"] as const;
export type ResumeSectionId = (typeof DEFAULT_SECTION_ORDER)[number];

export function normalizeSectionOrder(value: unknown): ResumeSectionId[] {
  const known = new Set<string>(DEFAULT_SECTION_ORDER);
  const selected = Array.isArray(value)
    ? value.filter((item): item is ResumeSectionId => typeof item === "string" && known.has(item))
    : [];
  return [...new Set(selected), ...DEFAULT_SECTION_ORDER.filter((section) => !selected.includes(section))];
}

export interface ResumeData {
  schemaVersion: number;
  contact: Contact;
  summary: string;
  /** 正文模块顺序，随简历保存并用于预览、导出与打印。 */
  sectionOrder: ResumeSectionId[];
  appearance: ResumeAppearance;
  skills: SkillGroup[];
  experiences: Experience[];
  projects: Project[];
  education: Education[];
}

export const createDefaultAppearance = (): ResumeAppearance => ({ template: "classic", accent: "", density: "standard" });

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

/** 空白骨架：不含任何个人内容，示例数据由服务端种子文件提供。 */
export const createDefaultResume = (): ResumeData => ({
  schemaVersion: SCHEMA_VERSION,
  contact: { name: "", headline: "", phone: "", email: "", website: "", location: "", extra: "" },
  summary: "",
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  appearance: createDefaultAppearance(),
  skills: [],
  experiences: [],
  projects: [],
  education: [],
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* 宽容解析：字符串字段缺失或类型不符时回退默认值，数组剔除非字符串项，id 缺失时补生成。 */
const text = (fallback = "") => z.string().catch(fallback);
const textList = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []),
  z.array(z.string()),
);
const idField = (prefix: string) => z.string().min(1).catch(() => uid(prefix));
const entries = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => (Array.isArray(value) ? value.filter(isObject) : []), z.array(schema));

const contactSchema = z
  .object({
    name: text(),
    headline: text(),
    phone: text(),
    email: text(),
    website: text(),
    location: text(),
    extra: text(),
  })
  .catch({ name: "", headline: "", phone: "", email: "", website: "", location: "", extra: "" });

const appearanceSchema = z
  .object({
    template: z.string().catch("classic"),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch(""),
    density: z.enum(["compact", "standard", "relaxed"]).catch("standard"),
  })
  .catch({ template: "classic", accent: "", density: "standard" });

const sectionOrderSchema = z.preprocess(
  (value) => normalizeSectionOrder(value),
  z.array(z.enum(DEFAULT_SECTION_ORDER)),
);

const resumeSchema = z.object({
  schemaVersion: z.preprocess(() => SCHEMA_VERSION, z.number()),
  contact: contactSchema,
  summary: text(),
  sectionOrder: sectionOrderSchema,
  appearance: appearanceSchema,
  skills: entries(z.object({ id: idField("skill"), name: text("技能分类"), items: textList })),
  experiences: entries(z.object({
    id: idField("experience"),
    organization: text(),
    role: text(),
    period: text(),
    summary: text(),
    highlights: textList,
  })),
  projects: entries(z.object({
    id: idField("project"),
    name: text(),
    role: text(),
    period: text(),
    summary: text(),
    stack: textList,
    highlights: textList,
  })),
  education: entries(z.object({
    id: idField("education"),
    school: text(),
    degree: text(),
    major: text(),
    period: text(),
  })),
});

export function normalizeResume(input: unknown): ResumeData {
  if (!isObject(input)) throw new Error("简历文件必须是 JSON 对象");
  if (typeof input.schemaVersion === "number" && input.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`该文件版本 ${input.schemaVersion} 高于当前支持版本 ${SCHEMA_VERSION}`);
  }
  return resumeSchema.parse(input);
}

export const cloneResume = (resume: ResumeData): ResumeData => structuredClone(resume);

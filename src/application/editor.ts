import { normalizeSectionOrder, type ResumeData, type ResumeSectionId } from "../domain/resume.ts";
import { splitItems, splitLines } from "../domain/text.ts";

export type ResumeCollection = "experiences" | "projects" | "skills" | "education";
const resumeCollections: ResumeCollection[] = ["experiences", "projects", "skills", "education"];

export const isResumeCollection = (value: string | undefined): value is ResumeCollection =>
  value !== undefined && resumeCollections.includes(value as ResumeCollection);

export const createResumeItemId = (collection: ResumeCollection): string => {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${collection}-${suffix}`;
};

const contactFields = new Set(["name", "headline", "phone", "email", "website", "location", "extra"]);
const collectionFields: Record<ResumeCollection, ReadonlySet<string>> = {
  experiences: new Set(["organization", "role", "period", "summary", "highlights"]),
  projects: new Set(["name", "role", "period", "summary", "stack", "highlights"]),
  skills: new Set(["name", "items"]),
  education: new Set(["school", "degree", "major", "period"]),
};

const parseFieldValue = (field: string, rawValue: string): string | string[] => {
  if (field === "highlights") return splitLines(rawValue);
  if (field === "items" || field === "stack") return splitItems(rawValue);
  return rawValue;
};

export function updateResumeField(data: ResumeData, path: string, rawValue: string): boolean {
  if (path === "summary") {
    data.summary = rawValue;
    return true;
  }

  const contactMatch = path.match(/^contact\.([a-z]+)$/);
  if (contactMatch) {
    const field = contactMatch[1];
    if (!field || !contactFields.has(field)) return false;
    (data.contact as unknown as Record<string, string>)[field] = rawValue;
    return true;
  }

  const collectionMatch = path.match(/^(experiences|projects|skills|education)\.(\d+)\.([a-z]+)$/);
  if (!collectionMatch) return false;
  const [, collection, indexText, field] = collectionMatch as [string, ResumeCollection, string, string];
  if (!collectionFields[collection].has(field)) return false;
  const item = (data[collection] as unknown as Array<Record<string, string | string[]>>)[Number(indexText)];
  if (!item) return false;
  item[field] = parseFieldValue(field, rawValue);
  return true;
}

export function addResumeItem(data: ResumeData, collection: ResumeCollection, id: string): void {
  if (collection === "experiences") data.experiences.push({ id, organization: "新公司", role: "职位", period: "", summary: "", highlights: [] });
  if (collection === "projects") data.projects.push({ id, name: "新项目", role: "", period: "", summary: "", stack: [], highlights: [] });
  if (collection === "skills") data.skills.push({ id, name: "新分类", items: [] });
  if (collection === "education") data.education.push({ id, school: "学校", degree: "", major: "", period: "" });
}

export function removeResumeItem(data: ResumeData, collection: ResumeCollection, index: number): boolean {
  const items = data[collection] as unknown[];
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return false;
  items.splice(index, 1);
  return true;
}

export function setResumeSectionOrder(data: ResumeData, order: readonly ResumeSectionId[]): void {
  data.sectionOrder = normalizeSectionOrder(order);
}

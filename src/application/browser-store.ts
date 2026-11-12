import { normalizeResume } from "../domain/resume.ts";
import type { ResumeRecord, SaveResumeInput } from "../domain/record.ts";

type Archive = Record<string, ResumeRecord[]>;
export function createBrowserStore(storage: Pick<Storage, "getItem" | "setItem">) {
  const key = "resume-studio:documents:v1";
  const read = (): Archive => JSON.parse(storage.getItem(key) ?? "{}");
  const write = (archive: Archive) => storage.setItem(key, JSON.stringify(archive));
  const get = (id: string) => {
    const record = read()[id]?.at(-1);
    if (!record) throw new Error("简历不存在或已被删除。");
    return structuredClone(record);
  };
  const save = (id: string, input: SaveResumeInput, note?: string) => {
    const archive = read(), versions = archive[id] ?? [], previous = versions.at(-1);
    if (previous && input.expectedUpdatedAt !== previous.updatedAt) throw new Error("这份简历已在另一窗口更新，请刷新后再保存。");
    const data = normalizeResume(input.data);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt ?? "") + 1 || 0)).toISOString();
    const record: ResumeRecord = {
      id, title: input.title, data, name: data.contact.name, headline: data.contact.headline,
      createdAt: previous?.createdAt ?? updatedAt, updatedAt, version: (previous?.version ?? 0) + 1,
      projectCount: data.projects.length, experienceCount: data.experiences.length, note,
    };
    archive[id] = [...versions, record].slice(-50);
    write(archive);
    return structuredClone(record);
  };
  return {
    async list() { return Object.values(read()).flatMap(v => v.at(-1) ?? []).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async get(id: string) { return get(id); },
    async create(input: SaveResumeInput) { return save(crypto.randomUUID(), input); },
    async update(id: string, input: SaveResumeInput) { get(id); return save(id, input); },
    async remove(id: string) { const archive = read(); delete archive[id]; write(archive); },
    async listVersions(id: string) { return (read()[id] ?? []).slice().reverse().map(r => ({versionId: String(r.version), version: r.version!, savedAt: r.updatedAt, title: r.title, name: r.name, note: r.note})); },
    async restoreVersion(id: string, versionId: string) {
      const record = read()[id]?.find(r => String(r.version) === versionId);
      if (!record) throw new Error("历史版本不存在。");
      return save(id, {...record, expectedUpdatedAt: get(id).updatedAt}, `从 v${versionId} 恢复`);
    },
  };
}

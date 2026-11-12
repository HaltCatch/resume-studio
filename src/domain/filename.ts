export type ExportFormat = "markdown" | "md" | "html" | "pdf" | "json" | "text" | "txt";

const extensionByFormat: Record<ExportFormat, string> = {
  markdown: "md",
  md: "md",
  html: "html",
  pdf: "pdf",
  json: "json",
  text: "txt",
  txt: "txt",
};

const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizeFileNameBase(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  if (!cleaned) return "我的简历";
  return windowsReservedName.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function exportFileName(title: string, format: ExportFormat): string {
  return `${sanitizeFileNameBase(title)}.${extensionByFormat[format]}`;
}

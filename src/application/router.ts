import { isPaperId, type PaperId } from "../domain/paper";
import type { DensityId } from "../domain/resume";
import { isTemplateId, type TemplateId } from "../render/templates";
import { ACCENT_PATTERN, isDensityId } from "../render/theme";

export type AppRoute = {
  mode: "library" | "preview" | "edit" | "print";
  id?: string;
  template?: TemplateId;
  paper?: PaperId;
  accent?: string;
  density?: DensityId;
};

export const currentRoute = (): AppRoute => {
  const printMatch = location.hash.match(/^#\/print\/([^?]+)(?:\?(.*))?$/);
  if (printMatch) {
    const params = new URLSearchParams(printMatch[2] ?? "");
    const template = params.get("template");
    const paper = params.get("paper");
    const accent = params.get("accent");
    const density = params.get("density");
    const route: AppRoute = {
      mode: "print",
      id: decodeURIComponent(printMatch[1] ?? ""),
      template: isTemplateId(template) ? template : "classic",
      paper: isPaperId(paper) ? paper : "a4",
    };
    if (accent !== null && ACCENT_PATTERN.test(accent)) route.accent = accent;
    if (isDensityId(density)) route.density = density;
    return route;
  }
  const match = location.hash.match(/^#\/resume\/([^/]+)(?:\/(edit))?$/);
  if (!match) return { mode: "library" };
  return { mode: match[2] ? "edit" : "preview", id: decodeURIComponent(match[1] ?? "") };
};

export const navigate = (path: string): void => {
  location.hash = path;
};

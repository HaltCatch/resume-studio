import type { DensityId } from "../domain/resume.ts";
import type { TemplateBase } from "./templates.ts";

/** 单个主题色派生整套 token；密度换算为字号/间距倍率。 */

export const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface DensityOption {
  id: DensityId;
  name: string;
  font: number;
  space: number;
}

export const densities: readonly DensityOption[] = [
  { id: "compact", name: "紧凑", font: 0.93, space: 0.72 },
  { id: "standard", name: "标准", font: 1, space: 1 },
  { id: "relaxed", name: "舒展", font: 1.06, space: 1.3 },
];

export const isDensityId = (value: string | null | undefined): value is DensityId =>
  densities.some((density) => density.id === value);

export const accentPresets: readonly { value: string; name: string }[] = [
  { value: "", name: "模板默认" },
  { value: "#1c5942", name: "墨绿" },
  { value: "#1f3a5f", name: "藏青" },
  { value: "#7d2333", name: "酒红" },
  { value: "#0f6b6b", name: "青碧" },
  { value: "#5b3a8a", name: "紫棠" },
  { value: "#222222", name: "玄墨" },
];

const channel = (hex: string, index: number): number => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);

const mix = (a: string, b: string, weight: number): string => {
  const blend = (index: number): string =>
    Math.round(channel(a, index) * (1 - weight) + channel(b, index) * weight)
      .toString(16)
      .padStart(2, "0");
  return `#${blend(0)}${blend(1)}${blend(2)}`;
};

const luminance = (hex: string): number =>
  (0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)) / 255;

/**
 * 由外观设置生成 CSS 变量覆盖。
 * 过浅的主题色会先压暗，保证标题文字与打印对比度可读。
 */
export function appearanceTokens(base: TemplateBase, accent: string, density: DensityId): Record<string, string> {
  const tokens: Record<string, string> = {};
  const option = densities.find((item) => item.id === density);
  if (option && option.id !== "standard") {
    tokens["--density-font"] = String(option.font);
    tokens["--density-space"] = String(option.space);
  }
  if (ACCENT_PATTERN.test(accent)) {
    const dark = luminance(accent) > 0.45 ? mix(accent, "#000000", 0.35) : accent;
    tokens["--accent-rule"] = dark;
    tokens["--accent-ink"] = mix(dark, "#000000", 0.15);
    tokens["--accent-soft"] = mix(accent, "#ffffff", 0.6);
    tokens["--headline-ink"] = mix(dark, "#555555", 0.3);
    if (base === "editorial") {
      tokens["--banner-bg"] = mix(dark, "#000000", 0.2);
      tokens["--banner-muted"] = mix(accent, "#ffffff", 0.72);
    }
    if (base === "academic") {
      tokens["--name-ink"] = mix(dark, "#000000", 0.25);
    }
  }
  return tokens;
}

export type PaperId = "a4" | "letter";

/** "fit" 为适合宽度；数值为缩放百分比。 */
export type PreviewZoom = "fit" | "80" | "100" | "120" | "150";

export const previewZooms: readonly { id: PreviewZoom; name: string }[] = [
  { id: "fit", name: "适合宽度" },
  { id: "80", name: "80%" },
  { id: "100", name: "100%" },
  { id: "120", name: "120%" },
  { id: "150", name: "150%" },
];

export interface PaperSpec {
  id: PaperId;
  name: string;
  widthMm: number;
  heightMm: number;
  printSize: string;
}

export const paperSizes: readonly PaperSpec[] = [
  { id: "a4", name: "A4", widthMm: 210, heightMm: 297, printSize: "A4" },
  { id: "letter", name: "US Letter", widthMm: 215.9, heightMm: 279.4, printSize: "Letter" },
];

export const isPaperId = (value: string | null | undefined): value is PaperId =>
  paperSizes.some((paper) => paper.id === value);

export const isPreviewZoom = (value: string | null | undefined): value is PreviewZoom =>
  previewZooms.some((zoom) => zoom.id === value);

export const zoomScale = (zoom: PreviewZoom, fitScale: number): number =>
  zoom === "fit" ? fitScale : Number(zoom) / 100;

export const paperById = (id: PaperId): PaperSpec => paperSizes.find((paper) => paper.id === id) ?? paperSizes[0]!;

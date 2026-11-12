declare module "pagedjs" {
  export interface PagedFlow {
    total: number;
    performance: number;
  }

  export class Previewer {
    preview(
      content?: HTMLElement | DocumentFragment | string,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: HTMLElement | string,
    ): Promise<PagedFlow>;
  }
}

declare module "*.css?raw" {
  const css: string;
  export default css;
}

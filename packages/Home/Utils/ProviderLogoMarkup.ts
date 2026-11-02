import ProviderLogo, {
  getProviderLogoName,
} from "Common/Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "Common/Types/ProviderLogo/AllProviderLogoMarks";
import {
  ProviderLogoMarkShape,
  ProviderLogoMarkShapes,
} from "Common/Types/ProviderLogo/ProviderLogoMark";
import {
  getProviderLogoMark,
  getProviderLogoMarkBox,
  PROVIDER_LOGO_WORDMARK_RATIO,
  ProviderLogoMarkBox,
} from "Common/Types/ProviderLogo/ProviderLogoMarks";
import { escapeHtml } from "./Books/Markup";

/*
 * Other companies' official marks on the website, from the marks the
 * product draws (Common/Types/ProviderLogo): written into the page as
 * inline SVG, every shape in the colour of the text around it
 * (currentColor), so a guide's mark sits with the site's own icons and
 * nothing is fetched to draw it. The template gives the SVG its size and
 * colour; this gives it its box and its shapes.
 */

export interface ProviderLogoMarkup {
  // The SVG's viewBox: the mark's box, fitted to its drawing.
  viewBox: string;
  // The SVG's inside: one path per shape, filled with currentColor.
  shapesHtml: string;
  // The product's name, as its maker writes it.
  name: string;
  /*
   * A wordmark or a wide symbol (Koa's, Fastify's): drawn across the tile
   * rather than shrunk into a square, as the product draws it.
   */
  isWide: boolean;
}

export function getProviderLogoShapesHtml(
  shapes: ProviderLogoMarkShapes,
): string {
  return shapes
    .map((shape: ProviderLogoMarkShape): string => {
      const opacity: string =
        shape.opacity !== undefined
          ? ` fill-opacity="${escapeHtml(String(shape.opacity))}"`
          : "";

      return `<path fill="currentColor" d="${escapeHtml(shape.d)}"${opacity}/>`;
    })
    .join("");
}

// Whether a mark's box is a wordmark's: more than 1.3 times as wide as it is tall.
export function isWideMarkBox(box: ProviderLogoMarkBox): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.width / box.height > PROVIDER_LOGO_WORDMARK_RATIO
  );
}

/*
 * A logo's mark, ready for a template; none for a product drawn without its
 * logo (the registry gives it one of the product's icons instead).
 */
export function getProviderLogoMarkup(
  logo: ProviderLogo,
): ProviderLogoMarkup | undefined {
  const mark: ProviderLogo | undefined = getProviderLogoMark(logo);
  const box: ProviderLogoMarkBox | undefined = getProviderLogoMarkBox(logo);
  const shapes: ProviderLogoMarkShapes | undefined = mark
    ? ALL_PROVIDER_LOGO_MARKS[mark]
    : undefined;

  if (!box || !shapes) {
    return undefined;
  }

  return {
    viewBox: box.viewBox,
    shapesHtml: getProviderLogoShapesHtml(shapes),
    name: getProviderLogoName(logo),
    isWide: isWideMarkBox(box),
  };
}

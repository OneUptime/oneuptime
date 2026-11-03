import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
} from "../../Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "../../Types/ProviderLogo/AllProviderLogoMarks";
import {
  ProviderLogoMarkShape,
  ProviderLogoMarkShapes,
} from "../../Types/ProviderLogo/ProviderLogoMark";
import { getProviderLogoMark } from "../../Types/ProviderLogo/ProviderLogoMarks";
import { loadProviderLogoMark } from "../../UI/Components/ProviderLogo/ProviderLogoMarkLoader";

/*
 * The marks of other companies' products, for tests that draw them.
 *
 * A page loads each mark on its own, the first time it draws it
 * (ProviderLogoMarkLoader): in a test the first render shows the mark's
 * empty room, and the mark a moment later. Loading every mark once, before
 * the tests render, makes every later render draw its marks at once - as a
 * page does once it has loaded them.
 */
export async function preloadProviderLogoMarks(): Promise<void> {
  const marks: Set<ProviderLogo> = new Set<ProviderLogo>();

  for (const logo of ALL_PROVIDER_LOGOS) {
    const mark: ProviderLogo | undefined = getProviderLogoMark(logo);

    if (mark) {
      marks.add(mark);
    }
  }

  await Promise.all(
    Array.from(marks).map((mark: ProviderLogo) => {
      return loadProviderLogoMark(mark);
    }),
  );
}

// The path data of the mark a logo is drawn by: its own, or its maker's.
export function getMarkPathData(logo: ProviderLogo): Array<string> {
  const mark: ProviderLogo | undefined = getProviderLogoMark(logo);
  const shapes: ProviderLogoMarkShapes | undefined = mark
    ? ALL_PROVIDER_LOGO_MARKS[mark]
    : undefined;

  return (shapes || []).map((shape: ProviderLogoMarkShape): string => {
    return shape.d;
  });
}

// The path data an SVG element draws, in order.
export function getDrawnPathData(svg: Element | null): Array<string> {
  if (!svg) {
    return [];
  }

  return Array.from(svg.querySelectorAll("path")).map(
    (path: SVGPathElement): string => {
      return path.getAttribute("d") || "";
    },
  );
}

/*
 * The inline mark a ProviderLogoImage draws inside an element: the SVG it
 * renders the registry's shapes into.
 */
export function getDrawnMark(element: Element | null): SVGElement | null {
  return element
    ? element.querySelector("svg[data-provider-logo-mark-svg]")
    : null;
}

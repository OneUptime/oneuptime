import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import crypto from "crypto";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The product icons (Views/Partials/icons/*.ejs) as one cached SVG sprite.
 *
 * Every page carries the nav, and the nav draws each product's icon twice -
 * in the mobile menu and in the products dialog - so each page used to carry
 * some 27 KB of the same paths, and the homepage another 23 KB in its product
 * sections. A partial included with `useIconSprite: true` now draws
 * `<use href="/img/product-icons.<hash>.svg#<icon>">` instead: the browser
 * fetches the drawings once and keeps them.
 *
 * Only where an icon is out of sight when the page first paints - the nav's
 * menus, which are hidden until opened, and sections below the fold - since
 * a `<use>` of another file draws nothing until that file arrives. Icons at
 * the top of a page stay inline.
 *
 * The sprite is made from the partials themselves, when the server starts,
 * so the two cannot drift apart: each icon is the partial's own drawing in a
 * <g id="<partial name>">, drawn in the coordinates of the <svg> around the
 * <use> - the partial's, viewBox and stroke included - exactly as inline.
 * After editing an icon, restart the server (nodemon restarts on .ts only).
 */

export const ProductIconsDirectory: string = path.join(
  __dirname,
  "..",
  "Views",
  "Partials",
  "icons",
);

const HASH_LENGTH: number = 12;

export const ProductIconSpriteRoutePattern: RegExp = new RegExp(
  `^/img/product-icons\\.[0-9a-f]{${HASH_LENGTH}}\\.svg$`,
);

const HTML_COMMENT: RegExp = /<!--[\s\S]*?-->/g;
const SPACE_BETWEEN_TAGS: RegExp = />\s+</g;

export interface ProductIconSprite {
  // product-icons.<hash>.svg
  fileName: string;
  // What a page uses: /img/product-icons.<hash>.svg
  href: string;
  svg: string;
}

// What a rendered icon partial draws inside its <svg>.
export const getIconDrawing: (rendered: string) => string = (
  rendered: string,
): string => {
  const open: number = rendered.indexOf("<svg");
  const openEnd: number = open === -1 ? -1 : rendered.indexOf(">", open);
  const close: number = rendered.lastIndexOf("</svg>");

  if (openEnd === -1 || close < openEnd) {
    throw new Error("An icon partial has to draw one <svg>");
  }

  return rendered
    .slice(openEnd + 1, close)
    .replace(HTML_COMMENT, "")
    .replace(SPACE_BETWEEN_TAGS, "><")
    .trim();
};

export const buildProductIconSprite: (
  directory?: string,
) => Promise<ProductIconSprite> = async (
  directory: string = ProductIconsDirectory,
): Promise<ProductIconSprite> => {
  const groups: Array<string> = [];
  const partials: Array<string> = fs
    .readdirSync(directory)
    .filter((name: string): boolean => {
      return name.endsWith(".ejs");
    })
    .sort();

  for (const partial of partials) {
    // Rendered without useIconSprite: the partial's inline drawing.
    const rendered: string = (await ejs.renderFile(
      path.join(directory, partial),
      {},
    )) as string;

    groups.push(
      `<g id="${partial.slice(0, -".ejs".length)}">${getIconDrawing(rendered)}</g>`,
    );
  }

  const svg: string = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${groups.join("")}</defs></svg>\n`;
  const hash: string = crypto
    .createHash("sha256")
    .update(svg)
    .digest("hex")
    .slice(0, HASH_LENGTH);
  const fileName: string = `product-icons.${hash}.svg`;

  return { fileName: fileName, href: `/img/${fileName}`, svg: svg };
};

/*
 * Serves the sprite at every /img/product-icons.<hash>.svg: cached for a year
 * at its own URL, and no-store at another build's - as for the stylesheet
 * (Utils/TailwindStylesheet.ts), during a rolling deploy a page can ask a
 * server from the other build.
 */
export const serveProductIconSprite: (
  sprite: ProductIconSprite | null,
) => RequestHandler = (sprite: ProductIconSprite | null): RequestHandler => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    if (!sprite || !ProductIconSpriteRoutePattern.test(req.path)) {
      next();
      return;
    }

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      req.path === sprite.href
        ? "public, max-age=31536000, immutable"
        : "no-store",
    );
    res.send(sprite.svg);
  };
};

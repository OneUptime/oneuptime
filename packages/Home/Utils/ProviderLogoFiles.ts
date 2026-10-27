import crypto from "crypto";
import fs from "fs";
import path from "path";
import ProviderLogo, {
  getProviderLogoName,
  isProviderLogo,
} from "Common/Types/ProviderLogo/ProviderLogo";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

/*
 * Other companies' official logos on the website, from the files the product
 * draws them from (Common/UI/Images/ProviderLogos, named by ProviderLogo).
 *
 * Served by this site at /img/provider-logos/<logo>.svg, with the file's own
 * hash in the address (?v=...), so a page can cache one for a year and a new
 * file is a new address. Only a name the registry has is served: the route
 * never reads a path a request makes up.
 */

export const PROVIDER_LOGO_ROUTE: string = "/img/provider-logos/:logo.svg";

// Common/UI/Images/ProviderLogos, beside this package as in the image (/usr/src/Common).
export const PROVIDER_LOGO_FOLDER: string = path.join(
  __dirname,
  "..",
  "..",
  "Common",
  "UI",
  "Images",
  "ProviderLogos",
);

const hashes: Map<ProviderLogo, string> = new Map<ProviderLogo, string>();

function fileOf(logo: ProviderLogo): string {
  return path.join(PROVIDER_LOGO_FOLDER, `${logo}.svg`);
}

function hashOf(logo: ProviderLogo): string {
  const cached: string | undefined = hashes.get(logo);

  if (cached) {
    return cached;
  }

  const hash: string = crypto
    .createHash("sha256")
    .update(fs.readFileSync(fileOf(logo)))
    .digest("hex")
    .slice(0, 10);

  hashes.set(logo, hash);

  return hash;
}

export interface ProviderLogoImage {
  src: string;
  // The product's name, as its maker writes it: the image's accessible name.
  alt: string;
  /*
   * A wordmark or a wide symbol (Koa's, Fastify's): drawn across the tile
   * rather than shrunk into a square, as the product draws it.
   */
  isWide: boolean;
}

// The SVG's viewBox: "0 0 512 275".
const VIEW_BOX: RegExp = /viewBox="([^"]+)"/;

/*
 * Whether a logo is wider than it is tall, read from its file's viewBox the
 * way Common's logo tests read it (wider than 1.3 to 1), so the website and
 * the product draw the same logos wide.
 */
export function isWideLogoFile(svg: string): boolean {
  const match: RegExpMatchArray | null = svg.match(VIEW_BOX);
  const parts: Array<number> = (match?.[1] || "")
    .trim()
    .split(" ")
    .map((part: string): number => {
      return Number(part);
    });
  const width: number = parts[2] || 0;
  const height: number = parts[3] || 0;

  return width > 0 && height > 0 && width / height > 1.3;
}

const wideness: Map<ProviderLogo, boolean> = new Map<ProviderLogo, boolean>();

function isWide(logo: ProviderLogo): boolean {
  const cached: boolean | undefined = wideness.get(logo);

  if (cached !== undefined) {
    return cached;
  }

  const wide: boolean = isWideLogoFile(fs.readFileSync(fileOf(logo), "utf8"));
  wideness.set(logo, wide);

  return wide;
}

export function getProviderLogoImage(logo: ProviderLogo): ProviderLogoImage {
  return {
    src: `/img/provider-logos/${logo}.svg?v=${hashOf(logo)}`,
    alt: getProviderLogoName(logo),
    isWide: isWide(logo),
  };
}

export function serveProviderLogo(
  req: ExpressRequest,
  res: ExpressResponse,
): void {
  const logo: string = String(req.params["logo"] || "");

  if (!isProviderLogo(logo) || !fs.existsSync(fileOf(logo))) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(fs.readFileSync(fileOf(logo)));
}

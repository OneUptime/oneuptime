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
}

export function getProviderLogoImage(logo: ProviderLogo): ProviderLogoImage {
  return {
    src: `/img/provider-logos/${logo}.svg?v=${hashOf(logo)}`,
    alt: getProviderLogoName(logo),
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

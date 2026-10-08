import ProductBrandingUtil, {
  ProductBranding,
} from "Common/Types/Branding/ProductBranding";
import { JSONObject } from "Common/Types/JSON";

/*
 * The Dashboard's web app manifest (Dashboard/public/manifest.json) for an
 * installation that names or shows itself its own way
 * (EnterpriseEdition.getProductBranding): what a browser shows when the
 * Dashboard is installed as an app.
 *
 *   name, short_name  the installation's product name
 *   description,      OneUptime's name replaced as a word
 *   shortcuts
 *   icons             its browser tab icon, when it has one (for every size:
 *                     an installed app has no other icon of its own)
 *   screenshots       left out: they are pictures of OneUptime
 *   iarc_rating_id,   left out when renamed: OneUptime's own app rating
 *   scope_extensions  and its own domain (*.oneuptime.com)
 *
 * The id stays, so an app installed before keeps being the same app. Null
 * when the installation shows OneUptime's own branding: the static file is
 * served as it is.
 *
 * Pure: Index.ts reads the file and serves the result.
 */

const isBranded: (branding: ProductBranding | null) => boolean = (
  branding: ProductBranding | null,
): boolean => {
  return (
    ProductBrandingUtil.isRenamed(branding) || Boolean(branding?.faviconUrl)
  );
};

export const getBrandedDashboardManifest: (
  manifest: JSONObject,
  branding: ProductBranding | null,
) => JSONObject | null = (
  manifest: JSONObject,
  branding: ProductBranding | null,
): JSONObject | null => {
  if (!branding || !isBranded(branding)) {
    return null;
  }

  const productName: string = ProductBrandingUtil.getProductName(branding);
  const isRenamed: boolean = ProductBrandingUtil.isRenamed(branding);

  const rename: (value: unknown) => unknown = (value: unknown): unknown => {
    return isRenamed && typeof value === "string"
      ? ProductBrandingUtil.replaceProductName(value, productName)
      : value;
  };

  const branded: JSONObject = { ...manifest };

  delete branded["screenshots"];

  if (isRenamed) {
    branded["name"] = productName;
    branded["short_name"] = productName;

    delete branded["iarc_rating_id"];
    delete branded["scope_extensions"];

    if (typeof manifest["description"] === "string") {
      branded["description"] = rename(manifest["description"]) as string;
    }
  }

  const faviconUrl: string | undefined = branding.faviconUrl;

  if (faviconUrl) {
    branded["icons"] = [
      {
        src: faviconUrl,
        sizes: "any",
        purpose: "any",
      },
    ];
  }

  if (Array.isArray(manifest["shortcuts"])) {
    branded["shortcuts"] = (manifest["shortcuts"] as Array<JSONObject>).map(
      (shortcut: JSONObject): JSONObject => {
        const brandedShortcut: JSONObject = { ...shortcut };

        for (const key of ["name", "short_name", "description"]) {
          if (typeof shortcut[key] === "string") {
            brandedShortcut[key] = rename(shortcut[key]) as string;
          }
        }

        if (faviconUrl) {
          brandedShortcut["icons"] = [{ src: faviconUrl, sizes: "any" }];
        }

        return brandedShortcut;
      },
    );
  }

  return branded;
};

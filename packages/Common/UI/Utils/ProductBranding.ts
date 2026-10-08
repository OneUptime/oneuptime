import { env } from "../Config";
import ProductBrandingUtil, {
  PRODUCT_BRANDING_ENVIRONMENT_KEY,
  ProductBranding,
} from "../../Types/Branding/ProductBranding";
import { Theme } from "./Theme";

/*
 * How the installation names and shows itself, as the frontends read it: from
 * env.js, which carries PRODUCT_BRANDING only when the installation's
 * branding may differ from OneUptime's (Server/Utils/FrontendEnvironment.ts).
 * Without it, everything here answers OneUptime's own.
 *
 * Read at call time, never at module load, so a test (or a page that set
 * window.process.env late) sees the current value. The parsed branding is
 * kept per raw value, so a render pays for one JSON.parse only when env.js
 * changed.
 */

let lastRawValue: string | null = null;
let lastBranding: ProductBranding | null = null;

export const getProductBranding: () => ProductBranding | null =
  (): ProductBranding | null => {
    const rawValue: string = env(PRODUCT_BRANDING_ENVIRONMENT_KEY);

    if (rawValue !== lastRawValue) {
      lastRawValue = rawValue;
      lastBranding = ProductBrandingUtil.fromEnvironmentValue(rawValue);
    }

    return lastBranding;
  };

// "OneUptime", or the name the installation goes by.
export const getProductName: () => string = (): string => {
  return ProductBrandingUtil.getProductName(getProductBranding());
};

/*
 * Whether the installation goes by another name. Then it no longer sends
 * people to OneUptime's own pages: the footer's support and legal links and
 * the edition pill are left out (OneUptime's terms and support desk are not
 * the installation's).
 */
export const isProductRenamed: () => boolean = (): boolean => {
  return ProductBrandingUtil.isRenamed(getProductBranding());
};

/*
 * The installation's own logo for a theme, or null to show OneUptime's. A
 * dark theme takes the logo for dark backgrounds, and the other one when
 * there is none.
 */
export const getProductLogoUrl: (theme: Theme) => string | null = (
  theme: Theme,
): string | null => {
  const branding: ProductBranding | null = getProductBranding();

  if (!branding) {
    return null;
  }

  if (theme === Theme.Dark) {
    return branding.darkLogoUrl || branding.logoUrl || null;
  }

  return branding.logoUrl || null;
};

// Where a "Powered by" line links to: the installation's website, or OneUptime's.
export const getPoweredByLink: () => {
  name: string;
  url: string | null;
} = (): { name: string; url: string | null } => {
  const branding: ProductBranding | null = getProductBranding();

  if (!ProductBrandingUtil.isRenamed(branding)) {
    return { name: ProductBrandingUtil.getProductName(branding), url: "https://oneuptime.com" };
  }

  return {
    name: ProductBrandingUtil.getProductName(branding),
    url: branding?.websiteUrl || null,
  };
};

// `text` with OneUptime's name replaced by the installation's, when it has one.
export const withProductName: (text: string) => string = (
  text: string,
): string => {
  const branding: ProductBranding | null = getProductBranding();

  if (!ProductBrandingUtil.isRenamed(branding)) {
    return text;
  }

  return ProductBrandingUtil.replaceProductName(
    text,
    ProductBrandingUtil.getProductName(branding),
  );
};

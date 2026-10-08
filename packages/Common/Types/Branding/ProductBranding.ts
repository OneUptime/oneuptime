/*
 * How this installation names and shows itself.
 *
 * By default that is OneUptime: its name, its logo, its browser tab icon. The
 * enterprise module (ee/) may hand core a different branding for the
 * installation (EnterpriseEdition.getProductBranding); core decides nothing
 * about when, it only shows what it is given. Every field is optional and a
 * field left out keeps OneUptime's own, so `{}` changes nothing that people
 * see.
 *
 * Pure, with no server or browser imports: the server builds and checks it,
 * env.js carries it to the frontends (PRODUCT_BRANDING_ENVIRONMENT_KEY), and
 * the frontends read it back with fromEnvironmentValue.
 */

export const ONEUPTIME_PRODUCT_NAME: string = "OneUptime";

/*
 * The env.js key that carries the branding to the frontends, as one JSON
 * string. Absent when the installation shows OneUptime's own branding and
 * cannot change it.
 */
export const PRODUCT_BRANDING_ENVIRONMENT_KEY: string = "PRODUCT_BRANDING";

// The longest product name: it sits in page titles, headers and email subjects.
export const PRODUCT_NAME_MAX_LENGTH: number = 50;

export interface ProductBranding {
  // The name the product goes by, in place of "OneUptime".
  productName?: string | undefined;
  // Where a "Powered by <name>" line links to. Without it, the line has no link.
  websiteUrl?: string | undefined;
  /*
   * The images, each a path on this installation's own host
   * ("/api/branding/logo?v=..."). The logo for light backgrounds, the logo
   * for dark backgrounds (falls back to the light one), and the icon in the
   * browser tab.
   */
  logoUrl?: string | undefined;
  darkLogoUrl?: string | undefined;
  faviconUrl?: string | undefined;
  /*
   * Whether the light-background logo can go in an email: a PNG, JPEG or GIF.
   * Many mail clients draw neither SVG nor WebP, so an email shows the
   * product name in their place.
   */
  isLogoEmailSafe?: boolean | undefined;
}

type ProductBrandingStringField =
  | "productName"
  | "websiteUrl"
  | "logoUrl"
  | "darkLogoUrl"
  | "faviconUrl";

const IMAGE_FIELDS: ReadonlyArray<ProductBrandingStringField> = [
  "logoUrl",
  "darkLogoUrl",
  "faviconUrl",
];

/*
 * The word replaced in the product's own sentences: "OneUptime" as a word of
 * its own - including the first half of a compound a language joins with a
 * hyphen ("OneUptime-Konto") and the Scandinavian genitive ("OneUptimes
 * logo"). Not when it is part of something longer - an identifier
 * (OneUptimeReplay), a header (X-OneUptime-Signature), a path
 * (github.com/OneUptime/oneuptime), a domain (OneUptime.com), a handle
 * (@OneUptime, a chat app's own name) - and never in another case, so
 * commands, URLs and environment variables (oneuptime, ONEUPTIME_URL) are
 * left exactly as they are.
 *
 * No lookbehind: the frontends run this in every browser OneUptime supports,
 * and an engine without lookbehind fails to parse the whole bundle. The
 * character before the word is captured instead and put back.
 */
const PRODUCT_NAME_WORD: RegExp =
  /(^|[^A-Za-z0-9_\-/.@])OneUptime(s?)(?![A-Za-z0-9_/@]|\.[A-Za-z0-9])/g;

// Characters a product name may not hold besides control characters: < > { }.
const FORBIDDEN_PRODUCT_NAME_CHARACTERS: ReadonlyArray<string> = [
  "<",
  ">",
  "{",
  "}",
];

const ABSOLUTE_HTTP_URL: RegExp = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

const WHITESPACE: RegExp = /\s/;

// Line breaks, tabs and every other C0 or C1 control character.
const hasControlCharacter: (value: string) => boolean = (
  value: string,
): boolean => {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }

  return false;
};

const isNonEmptyString: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

export default class ProductBrandingUtil {
  // The product's name: the branding's, or OneUptime.
  public static getProductName(
    branding: ProductBranding | null | undefined,
  ): string {
    const productName: string | undefined = branding?.productName;

    return isNonEmptyString(productName)
      ? productName.trim()
      : ONEUPTIME_PRODUCT_NAME;
  }

  /*
   * Whether the product goes by another name: then it no longer points
   * people at OneUptime's own pages (support, legal, the edition pill).
   */
  public static isRenamed(
    branding: ProductBranding | null | undefined,
  ): boolean {
    return (
      ProductBrandingUtil.getProductName(branding) !== ONEUPTIME_PRODUCT_NAME
    );
  }

  /*
   * `text` with "OneUptime" as a word replaced by `productName` (see
   * PRODUCT_NAME_WORD). The replacement is inserted as it is: a function
   * replacer, so "$&" or "$1" in a name is never read as a pattern.
   */
  public static replaceProductName(text: string, productName: string): string {
    if (typeof text !== "string" || !text.includes(ONEUPTIME_PRODUCT_NAME)) {
      return text;
    }

    if (!isNonEmptyString(productName)) {
      return text;
    }

    return text.replace(
      PRODUCT_NAME_WORD,
      (_match: string, before: string, genitive: string): string => {
        return `${before}${productName}${genitive}`;
      },
    );
  }

  // Why a product name cannot be used, or null when it can.
  public static getProductNameProblem(value: string): string | null {
    if (value.length > PRODUCT_NAME_MAX_LENGTH) {
      return `The product name can be at most ${PRODUCT_NAME_MAX_LENGTH} characters.`;
    }

    if (
      hasControlCharacter(value) ||
      FORBIDDEN_PRODUCT_NAME_CHARACTERS.some((character: string): boolean => {
        return value.includes(character);
      })
    ) {
      return "The product name can't contain line breaks or the characters < > { }.";
    }

    return null;
  }

  // A path on this host: "/x", never "//host" (another host) or a scheme.
  public static isSameHostPath(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      !WHITESPACE.test(value)
    );
  }

  public static isWebsiteUrl(value: unknown): value is string {
    return typeof value === "string" && ABSOLUTE_HTTP_URL.test(value.trim());
  }

  /*
   * Only the fields a branding may have, each only when it is usable:
   * a name that passes getProductNameProblem, an http(s) website, image paths
   * on this host. Anything else is dropped rather than shown.
   */
  public static sanitize(value: unknown): ProductBranding {
    const input: Record<string, unknown> =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const branding: ProductBranding = {};

    const productName: unknown = input["productName"];

    if (
      isNonEmptyString(productName) &&
      ProductBrandingUtil.getProductNameProblem(productName.trim()) === null
    ) {
      branding.productName = productName.trim();
    }

    const websiteUrl: unknown = input["websiteUrl"];

    if (ProductBrandingUtil.isWebsiteUrl(websiteUrl)) {
      branding.websiteUrl = websiteUrl.trim();
    }

    for (const field of IMAGE_FIELDS) {
      const imageUrl: unknown = input[field];

      if (ProductBrandingUtil.isSameHostPath(imageUrl)) {
        branding[field] = imageUrl;
      }
    }

    if (branding.logoUrl && input["isLogoEmailSafe"] === true) {
      branding.isLogoEmailSafe = true;
    }

    return branding;
  }

  // The branding as env.js carries it: one JSON string.
  public static toEnvironmentValue(branding: ProductBranding): string {
    return JSON.stringify(ProductBrandingUtil.sanitize(branding));
  }

  /*
   * The branding env.js carried, or null when it carried none (the
   * installation shows OneUptime's and cannot change it). A value that is
   * not a JSON object is treated as none.
   */
  public static fromEnvironmentValue(value: unknown): ProductBranding | null {
    if (!isNonEmptyString(value)) {
      return null;
    }

    let parsed: unknown = null;

    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return ProductBrandingUtil.sanitize(parsed);
  }
}

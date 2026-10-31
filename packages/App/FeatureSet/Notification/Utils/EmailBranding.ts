import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import {
  CarriedLogo,
  toCarriedLogo,
} from "Common/Server/Utils/Mail/EmailCarriedLogos";
import EmailLogo from "Common/Server/Utils/Mail/EmailLogo";
import URL from "Common/Types/API/URL";
import ProductBrandingUtil, {
  ProductBranding,
} from "Common/Types/Branding/ProductBranding";
import Dictionary from "Common/Types/Dictionary";

/*
 * What an email knows about how the installation names and shows itself
 * (EnterpriseEdition.getProductBranding). MailService.render adds these
 * variables to every email, and the templates read them through the
 * brandName / brandNameHtml helpers (Utils/Handlebars.ts) and the partials
 * (Logo, Footer, Thanks, Header, UnsubscribeOwnerEmail):
 *
 *   brandProductName  "OneUptime", or the name the installation goes by
 *   isBrandRenamed    "true" when it goes by another name, else absent
 *   brandWebsiteUrl   where "Powered by" links when renamed, when it has one
 *   brandLogoUrl      the installation's logo, absolute, when it has one an
 *                     email can show (a PNG, JPEG or GIF); just before the
 *                     email goes out, the logo itself goes in its place
 *                     (getCarriedProductLogo), so opening the email fetches
 *                     nothing
 *   oneUptimeLogoUrl  OneUptime's own logo, where the header shows it (not
 *                     renamed, no logo of its own): a data: URL, sent as an
 *                     image inside the email (EmailLogo), never an address
 *                     on another host
 *
 * An installation that shows OneUptime's branding gets brandProductName
 * and oneUptimeLogoUrl: OneUptime's markup, its logo carried in the email
 * itself, so no email asks any host for anything when it is opened. The
 * other variables are absent, and keep that markup as it is.
 */

// The variable that holds OneUptime's own logo (oneUptimeLogoUrl, above).
export const ONEUPTIME_LOGO_VARIABLE_NAME: string = "oneUptimeLogoUrl";

export const BRAND_VARIABLE_NAMES: ReadonlyArray<string> = [
  "brandProductName",
  "isBrandRenamed",
  "brandWebsiteUrl",
  "brandLogoUrl",
  "oneUptimeLogoUrl",
];

const TRAILING_SLASHES: RegExp = /\/+$/;

/*
 * A path on this host as an absolute address a mail client can fetch, or
 * null when the host is not known (HOST unset): an email then shows the
 * product name in place of the logo rather than an address no client can
 * reach.
 */
export const toAbsoluteUrl: (path: string) => string | null = (
  path: string,
): string | null => {
  if (!Host || !Host.trim()) {
    return null;
  }

  try {
    const origin: string = new URL(HttpProtocol, Host.trim())
      .toString()
      .replace(TRAILING_SLASHES, "");

    return `${origin}${path}`;
  } catch {
    return null;
  }
};

export const getEmailBrandingVariables: (
  branding: ProductBranding | null,
) => Dictionary<string> = (
  branding: ProductBranding | null,
): Dictionary<string> => {
  const variables: Dictionary<string> = {
    brandProductName: ProductBrandingUtil.getProductName(branding),
  };

  if (ProductBrandingUtil.isRenamed(branding)) {
    variables["isBrandRenamed"] = "true";

    if (branding?.websiteUrl) {
      variables["brandWebsiteUrl"] = branding.websiteUrl;
    }
  }

  if (branding?.logoUrl && branding.isLogoEmailSafe === true) {
    const logoUrl: string | null = toAbsoluteUrl(branding.logoUrl);

    if (logoUrl) {
      variables["brandLogoUrl"] = logoUrl;
    }
  }

  /*
   * Where the header shows OneUptime's own logo, the logo itself, carried
   * in the email: it needs no HOST, and no reader's mail client reaches
   * anywhere for it. Left out when its file cannot be read, and the header
   * shows OneUptime's name alone.
   */
  if (!variables["brandLogoUrl"] && variables["isBrandRenamed"] !== "true") {
    const oneUptimeLogoUrl: string | null = EmailLogo.getDataUrl();

    if (oneUptimeLogoUrl) {
      variables["oneUptimeLogoUrl"] = oneUptimeLogoUrl;
    }
  }

  return variables;
};

// The variables for this installation, as it is branded right now.
export const getCurrentEmailBrandingVariables: () => Dictionary<string> =
  (): Dictionary<string> => {
    return getEmailBrandingVariables(EnterpriseEdition.getProductBranding());
  };

// The name the installation's own logo goes by as an attachment.
export const PRODUCT_LOGO_ATTACHMENT_NAME: string = "logo";

/*
 * Each logo's bytes as an email carries them, written once for every email
 * that shows the logo until the enterprise module reads its settings
 * again, which hands over new bytes.
 */
const carriedProductLogos: WeakMap<Buffer, CarriedLogo | null> = new WeakMap<
  Buffer,
  CarriedLogo | null
>();

/*
 * The installation's own logo, carried inside an email that shows it by
 * `address` (Common/Server/Utils/Mail/EmailCarriedLogos.ts): when `address`
 * is the address brandLogoUrl gives the header (getEmailBrandingVariables)
 * and the enterprise module hands over the logo's bytes, a PNG, JPEG or
 * GIF small enough to go in every email. Null for any other address, and
 * for a logo that cannot go, which the header then shows from its address,
 * as before.
 */
export const getCarriedProductLogo: (address: string) => CarriedLogo | null = (
  address: string,
): CarriedLogo | null => {
  const branding: ProductBranding | null =
    EnterpriseEdition.getProductBranding();

  if (!branding?.logoUrl || branding.isLogoEmailSafe !== true) {
    return null;
  }

  if (toAbsoluteUrl(branding.logoUrl) !== address) {
    return null;
  }

  const bytes: Buffer | null = EnterpriseEdition.getProductBrandingLogo();

  if (!bytes) {
    return null;
  }

  if (!carriedProductLogos.has(bytes)) {
    carriedProductLogos.set(
      bytes,
      toCarriedLogo(bytes, PRODUCT_LOGO_ATTACHMENT_NAME),
    );
  }

  return carriedProductLogos.get(bytes) || null;
};

/*
 * A subject template with OneUptime's name replaced by a reference to the
 * installation's: the subject is plain text, so the name goes in raw
 * ({{{ }}}), and as a reference rather than as text, so nothing in a name is
 * ever read as template syntax. Only the subject's own words are touched:
 * the values a subject is filled with are not part of its template.
 */
export const withBrandedSubject: (
  subjectTemplate: string,
  variables: Dictionary<string>,
) => string = (
  subjectTemplate: string,
  variables: Dictionary<string>,
): string => {
  if (variables["isBrandRenamed"] !== "true") {
    return subjectTemplate;
  }

  return ProductBrandingUtil.replaceProductName(
    subjectTemplate,
    "{{{brandProductName}}}",
  );
};

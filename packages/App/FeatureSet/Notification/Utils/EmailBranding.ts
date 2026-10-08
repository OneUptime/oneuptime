import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
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
 *                     email can show (a PNG, JPEG or GIF)
 *
 * Absent variables keep OneUptime's own markup, byte for byte: an
 * installation that shows OneUptime's branding sends exactly the emails it
 * sent before.
 */

export const BRAND_VARIABLE_NAMES: ReadonlyArray<string> = [
  "brandProductName",
  "isBrandRenamed",
  "brandWebsiteUrl",
  "brandLogoUrl",
];

const TRAILING_SLASHES: RegExp = /\/+$/;

// A path on this host as an absolute address a mail client can fetch.
export const toAbsoluteUrl: (path: string) => string = (
  path: string,
): string => {
  const origin: string = new URL(HttpProtocol, Host)
    .toString()
    .replace(TRAILING_SLASHES, "");

  return `${origin}${path}`;
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
    variables["brandLogoUrl"] = toAbsoluteUrl(branding.logoUrl);
  }

  return variables;
};

// The variables for this installation, as it is branded right now.
export const getCurrentEmailBrandingVariables: () => Dictionary<string> =
  (): Dictionary<string> => {
    return getEmailBrandingVariables(EnterpriseEdition.getProductBranding());
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

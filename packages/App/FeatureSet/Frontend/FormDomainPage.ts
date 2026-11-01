import { JSONObject } from "Common/Types/JSON";
import { isRouteReservedAgainstSpaFallback } from "./RouteReservations";

/*
 * A FORM ON ITS OWNER'S OWN DOMAIN: what the App answers a visit to a form
 * domain (FormDomain, Common/Types/Form/FormCustomDomain) with.
 *
 * report.acme.com shows one form, at its root, and nothing else:
 *
 *   - "/" is the form's page: the sign-in app's form page (Accounts
 *     Pages/Form.tsx), rendered from the sign-in app's index.ejs with the
 *     mark that makes it the form and nothing else - no sign-in page, no
 *     other route - always light, without OneUptime's own measurement, and
 *     titled with the form's name;
 *   - any other page address is sent to "/" with its query kept, so a
 *     template link (?template=<id>) still opens its template there, and a
 *     sign-in address typed onto the customer's domain never shows a
 *     OneUptime sign-in page under their name;
 *   - an API address the App has no route for is not a page at all: it is
 *     left to the App's own "not found".
 *
 * The page's bundle and assets (/accounts/dist, /accounts/assets) and its
 * env.js are served on every host (Frontend/Index.ts, staticFilesOnEveryHost),
 * as a status page's are. The page then reads the form through the form API
 * on the same domain, which finds it by the domain the request came to.
 *
 * Kept pure - no services, no database - so its tests import it directly.
 */

export enum FormDomainPageAnswer {
  // The domain's root: the form's page.
  Page = "Page",
  // Any other page address: sent on to the root, with its query.
  RedirectToPage = "RedirectToPage",
  // An API address the App has no route for: no page at all.
  NotAPage = "NotAPage",
}

// Where a form domain shows its form.
export const FORM_DOMAIN_PAGE_PATH: string = "/";

// What is never a page on a form's domain, whatever the App has under it.
export const FORM_DOMAIN_NOT_A_PAGE_PREFIXES: Array<string> = ["/api"];

export const getFormDomainPageAnswer: (path: string) => FormDomainPageAnswer = (
  path: string,
): FormDomainPageAnswer => {
  if (path === FORM_DOMAIN_PAGE_PATH) {
    return FormDomainPageAnswer.Page;
  }

  if (
    isRouteReservedAgainstSpaFallback(FORM_DOMAIN_NOT_A_PAGE_PREFIXES, path)
  ) {
    return FormDomainPageAnswer.NotAPage;
  }

  return FormDomainPageAnswer.RedirectToPage;
};

/*
 * Where an address other than the root is sent: the root of the same
 * domain, with the address's query - never anywhere else. Relative, so it
 * stays on the domain and its scheme, and it starts with "/?" or is "/",
 * never "//", which a browser would read as another host.
 */
export const getFormDomainPageLocation: (originalUrl: string) => string = (
  originalUrl: string,
): string => {
  const queryStart: number = originalUrl.indexOf("?");

  if (queryStart === -1) {
    return FORM_DOMAIN_PAGE_PATH;
  }

  const query: string = originalUrl.slice(queryStart + 1);

  return query ? `${FORM_DOMAIN_PAGE_PATH}?${query}` : FORM_DOMAIN_PAGE_PATH;
};

/*
 * The headers the form's page goes out with, as its link's page does on
 * OneUptime's own domain (the ingress's /accounts location): never stored,
 * never framed by another site, its type never guessed.
 */
export const FORM_DOMAIN_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/*
 * What the sign-in app's index.ejs is rendered with on a form's domain:
 * the mark that makes it the form's page, and the page's title - the form's
 * name when the visitor would be shown the form, else the domain itself,
 * which names nothing of the form. Never OneUptime's: the page is the
 * customer's.
 */
export const getFormDomainPageVariables: (data: {
  hostname: string;
  formName: string | null;
}) => JSONObject = (data: {
  hostname: string;
  formName: string | null;
}): JSONObject => {
  const formName: string = (data.formName || "").trim();

  return {
    isFormDomainPage: true,
    formDomainPageTitle: formName || data.hostname,
  };
};

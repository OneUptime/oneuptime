/*
 * A form on its owner's own domain (FormDomain): report.acme.com answering
 * with the form, verified, over HTTPS, the way a status page answers on
 * status.acme.com.
 *
 * One form per domain, at the domain's root. The domain is the link: the
 * page on it never names a share key, and the server finds the form by the
 * domain the request came to (FormDomainService.getShareKeyOfFormOnDomain),
 * never by anything the request names. So a domain only ever shows its own
 * form - a link to another form, typed onto the customer's domain, cannot
 * put that form under their name - and resetting the form's link on
 * OneUptime's domain leaves the domain working.
 *
 * Kept free of anything server-only or browser-only: the API's routes, the
 * nginx locations that let a submission's files through, the page that
 * calls them and their tests all read these.
 */

/*
 * The routes the form's page calls on its own domain, under the form API's
 * path (/form): the form's questions, sending the answers, and the check the
 * CNAME sweeps make (the domain's verification token, answered on the
 * domain itself).
 */
export const FORM_CUSTOM_DOMAIN_ROUTE: string = "/custom-domain";
export const FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE: string = "/custom-domain/submit";
export const FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_ROUTE: string =
  "/custom-domain/cname-verification";

/*
 * The same routes as the browser and the ingress see them: under /api, on
 * the form's own domain. The ingress lets a submission's files through on
 * this path - about 27 MB of JSON for 10 files of 20 MB together - where
 * every other path of a custom domain keeps nginx's 1 MB
 * (packages/Nginx/default.conf.template).
 */
export const FORM_CUSTOM_DOMAIN_API_PATH: string = `/api/form${FORM_CUSTOM_DOMAIN_ROUTE}`;
export const FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH: string = `/api/form${FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE}`;
export const FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_API_PATH: string = `/api/form${FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_ROUTE}`;

/*
 * The mark the server puts on the page it serves on a form's domain: a
 * <meta> of this name with this content. The sign-in app reads it to be the
 * form and nothing else - no sign-in page, no other route - and to stay
 * light, as every public form is. Only the server writes it, and only for a
 * domain a form has.
 */
export const FORM_CUSTOM_DOMAIN_PAGE_META_NAME: string = "oneuptime-form-domain";
export const FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT: string = "true";

/*
 * Where the form's page on its own domain sends its requests: to that
 * domain, as it was opened (scheme, host and port). Built from the page's
 * own origin, never from the installation's HOST: the requests stay on the
 * customer's domain, so the browser sends them to the page's own origin,
 * which is what the routes hold them to.
 */
export const getFormCustomDomainApiUrl: (origin: string) => string = (
  origin: string,
): string => {
  return `${trimTrailingSlashes(origin)}${FORM_CUSTOM_DOMAIN_API_PATH}`;
};

export const getFormCustomDomainSubmitUrl: (origin: string) => string = (
  origin: string,
): string => {
  return `${trimTrailingSlashes(origin)}${FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH}`;
};

/*
 * The address the CNAME sweeps fetch to see that a domain reaches this
 * installation: the domain's verification token, answered on the domain.
 * Plain HTTP first - a domain has no certificate before it is verified -
 * then HTTPS, as for a status page's domain.
 */
export const getFormCustomDomainVerificationUrl: (data: {
  protocol: "http" | "https";
  fullDomain: string;
  token: string;
}) => string = (data: {
  protocol: "http" | "https";
  fullDomain: string;
  token: string;
}): string => {
  return `${data.protocol}://${data.fullDomain}${FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_API_PATH}/${encodeURIComponent(
    data.token,
  )}`;
};

// A form's address on its own domain: the domain's root, over HTTPS or not.
export const getFormCustomDomainUrl: (data: {
  protocol: "http" | "https";
  fullDomain: string;
}) => string = (data: {
  protocol: "http" | "https";
  fullDomain: string;
}): string => {
  return `${data.protocol}://${data.fullDomain}/`;
};

type TrimTrailingSlashesFunction = (value: string) => string;

// A loop, not a pattern: an origin is short, but the rule is the same everywhere.
const trimTrailingSlashes: TrimTrailingSlashesFunction = (
  value: string,
): string => {
  let end: number = value.length;

  while (end > 0 && value.charAt(end - 1) === "/") {
    end -= 1;
  }

  return value.slice(0, end);
};

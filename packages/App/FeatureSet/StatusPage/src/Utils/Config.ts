import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { IDENTITY_URL } from "Common/UI/Config";

const PROTOCOL: Protocol = window.location.protocol.includes("https")
  ? Protocol.HTTPS
  : Protocol.HTTP;

export const STATUS_PAGE_API_URL: URL = new URL(
  PROTOCOL,
  window.location.host,
  new Route("/status-page-api"),
);

/*
 * The Dashboard, on the host this page is served from. A status page's
 * preview (/status-page/<id>/) is served from the Dashboard's own host,
 * and links the page's owner back to it (#9180); a page on its own domain
 * never does.
 */
export const DASHBOARD_URL_OF_PREVIEW: URL = new URL(
  PROTOCOL,
  window.location.host,
  new Route("/dashboard"),
);

export const STATUS_PAGE_SSO_API_URL: URL = new URL(
  PROTOCOL,
  window.location.host,
  new Route("/status-page-sso-api"),
);

/*
 * Start OIDC on the callback's origin so its host-only state cookie is available
 * when signing in from a status page on a custom domain.
 */
export const STATUS_PAGE_OIDC_API_URL: URL =
  URL.fromURL(IDENTITY_URL).addRoute("/status-page-oidc");

export const STATUS_PAGE_IDENTITY_API_URL: URL = new URL(
  PROTOCOL,
  window.location.host,
  new Route("/status-page-identity-api"),
);

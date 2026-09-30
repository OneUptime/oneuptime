import GlobalOidcAPI from "./API/GlobalOIDC";
import GlobalSsoAPI from "./API/GlobalSSO";
import OidcAPI from "./API/OIDC";
import ProjectSsoSignInConfirmationAPI from "./API/ProjectSsoSignInConfirmation";
import SsoAPI from "./API/SSO";
import StatusPageOidcAPI from "./API/StatusPageOIDC";
import StatusPageSsoAPI from "./API/StatusPageSSO";
import type { ExpressRouter } from "Common/Server/Utils/Express";

/*
 * Single sign-on: SAML and OIDC for projects, the whole instance (Global SSO
 * and Global OIDC) and status pages. Core serves these routers in every
 * edition. ./Index.ts mounts them, in this order, at ["/api/identity", "/"]:
 * after the authentication and reseller routers, before the Enterprise
 * Edition's identity routers (SCIM) and the status page authentication router.
 *
 * The route paths are part of every customer's identity provider setup: the
 * SAML ACS URLs (/idp-login/..., /global-idp-login/...,
 * /status-page-idp-login/...) and the OIDC redirect URIs (/oidc-callback/...,
 * /global-oidc-callback/..., /status-page-oidc-callback/...) are pasted into
 * Okta, Entra ID and the like. They must never change;
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins every
 * (method, path) pair.
 */

export interface SsoRouterEntry {
  // The router's source file under ./API, for test and log messages.
  name: string;
  router: ExpressRouter;
}

// In mount order.
export const SSO_ROUTERS: ReadonlyArray<SsoRouterEntry> = [
  { name: "SSO", router: SsoAPI },
  { name: "OIDC", router: OidcAPI },
  { name: "GlobalSSO", router: GlobalSsoAPI },
  { name: "GlobalOIDC", router: GlobalOidcAPI },
  { name: "StatusPageSSO", router: StatusPageSsoAPI },
  { name: "StatusPageOIDC", router: StatusPageOidcAPI },
  /*
   * Not configured in any identity provider: the page a project-SSO
   * confirmation email links to (only the hosted service sends that email).
   * Emails already sent carry its URL, so SsoRoutePathsUnchanged.test.ts pins
   * it all the same.
   */
  {
    name: "ProjectSsoSignInConfirmation",
    router: ProjectSsoSignInConfirmationAPI,
  },
];

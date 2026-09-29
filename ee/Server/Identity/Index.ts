import GlobalOidcAPI from "./API/GlobalOIDC";
import GlobalSsoAPI from "./API/GlobalSSO";
import OidcAPI from "./API/OIDC";
import ProjectSsoSignInConfirmationAPI from "./API/ProjectSsoSignInConfirmation";
import SCIMAPI from "./API/SCIM";
import SsoAPI from "./API/SSO";
import StatusPageOidcAPI from "./API/StatusPageOIDC";
import StatusPageSCIMAPI from "./API/StatusPageSCIM";
import StatusPageSsoAPI from "./API/StatusPageSSO";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Enterprise identity: SAML and OIDC single sign-on for projects, the whole
 * instance and status pages, and SCIM provisioning (projects and status
 * pages).
 *
 * Core mounts these routers at ["/api/identity", "/"], after its own
 * authentication and reseller routers and before the status page
 * authentication router (packages/App/FeatureSet/Identity/Index.ts) - the
 * position the eight routers had when they lived in core.
 *
 * The route paths are part of every customer's identity provider setup: the
 * SAML ACS URLs (/idp-login/..., /global-idp-login/...,
 * /status-page-idp-login/...), the OIDC redirect URIs (/oidc-callback/...,
 * /global-oidc-callback/..., /status-page-oidc-callback/...) and the SCIM base
 * URLs (/scim/v2/..., /status-page-scim/v2/...) are pasted into Okta, Entra ID
 * and the like. They must never change; Tests/Server/Identity/
 * RoutePathsUnchanged.test.ts pins every (method, path) pair.
 *
 * The routers are mounted whenever the Enterprise Edition is loaded, but each
 * route answers only while its feature is active
 * (EnterpriseEdition.isFeatureActive): when the license lapses, SSO sign-in
 * and SCIM provisioning stop, exactly as on the Community Edition, and resume
 * without a restart when a license is activated. The license changes at
 * runtime and these routers are mounted once, so every route starts with a
 * per-request gate (Middleware/LicensedFeatureGate.ts); Tests/Server/Identity/
 * IdentityLicenseGates.test.ts checks every route has it.
 */

export interface IdentityRouterEntry {
  // The router's source file under ./API, for test and log messages.
  name: string;
  router: ExpressRouter;
}

// In mount order: the order core mounted them in before they moved to ee/.
export const IDENTITY_ROUTERS: ReadonlyArray<IdentityRouterEntry> = [
  { name: "SSO", router: SsoAPI },
  { name: "OIDC", router: OidcAPI },
  { name: "GlobalSSO", router: GlobalSsoAPI },
  { name: "GlobalOIDC", router: GlobalOidcAPI },
  { name: "SCIM", router: SCIMAPI },
  { name: "StatusPageSCIM", router: StatusPageSCIMAPI },
  { name: "StatusPageSSO", router: StatusPageSsoAPI },
  { name: "StatusPageOIDC", router: StatusPageOidcAPI },
  /*
   * Not configured in any identity provider: the page a project-SSO
   * confirmation email links to (hosted service only). Emails already sent
   * carry its URL, so RoutePathsUnchanged.test.ts pins it all the same.
   */
  {
    name: "ProjectSsoSignInConfirmation",
    router: ProjectSsoSignInConfirmationAPI,
  },
];

const IdentityArea: EnterpriseArea = {
  name: "Identity",
  getIdentityRouters: (): Array<ExpressRouter> => {
    return IDENTITY_ROUTERS.map((entry: IdentityRouterEntry) => {
      return entry.router;
    });
  },
};

export default IdentityArea;

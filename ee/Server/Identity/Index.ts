import SCIMAPI from "./API/SCIM";
import SCIMOAuthClientSecretAPI from "./API/SCIMOAuthClientSecret";
import SCIMOAuthTokenAPI from "./API/SCIMOAuthToken";
import StatusPageSCIMAPI from "./API/StatusPageSCIM";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Enterprise identity: SCIM provisioning, for projects and status pages.
 * (Single sign-on - SAML and OIDC for projects, the whole instance and status
 * pages - is core, served in every edition:
 * packages/App/FeatureSet/Identity/SsoRouters.ts.)
 *
 * Core mounts these routers at ["/api/identity", "/"], right after its own
 * identity routers (authentication, reseller and single sign-on) and before
 * the status page authentication router
 * (packages/App/FeatureSet/Identity/Index.ts).
 *
 * The route paths are part of every customer's identity provider setup: the
 * SCIM base URLs (/scim/v2/..., /status-page-scim/v2/...) are pasted into
 * Okta, Entra ID and the like. They must never change; Tests/Server/Identity/
 * RoutePathsUnchanged.test.ts pins every (method, path) pair.
 *
 * The routers are mounted whenever the Enterprise Edition is loaded, but each
 * route answers only while SCIM is active (EnterpriseEdition.isFeatureActive):
 * when the license lapses, SCIM provisioning stops, exactly as on the
 * Community Edition, and resumes without a restart when a license is
 * activated. The license changes at runtime and these routers are mounted
 * once, so every route starts with a per-request gate
 * (Middleware/LicensedFeatureGate.ts); Tests/Server/Identity/
 * IdentityLicenseGates.test.ts checks every route has it.
 */

export interface IdentityRouterEntry {
  // The router's source file under ./API, for test and log messages.
  name: string;
  router: ExpressRouter;
}

/*
 * In mount order: the order core mounted the two SCIM routers in before they
 * moved to ee/, then the token endpoint of SCIM's OAuth 2.0 client
 * credentials, whose path no SCIM route shares.
 */
export const IDENTITY_ROUTERS: ReadonlyArray<IdentityRouterEntry> = [
  { name: "SCIM", router: SCIMAPI },
  { name: "StatusPageSCIM", router: StatusPageSCIMAPI },
  { name: "SCIMOAuthToken", router: SCIMOAuthTokenAPI },
];

const IdentityArea: EnterpriseArea = {
  name: "Identity",
  getIdentityRouters: (): Array<ExpressRouter> => {
    return IDENTITY_ROUTERS.map((entry: IdentityRouterEntry) => {
      return entry.router;
    });
  },
  /*
   * The dashboard's routes that make and delete a SCIM connection's OAuth
   * 2.0 client secrets (API/SCIMOAuthClientSecret.ts), under /api next to
   * the connections' own CRUD routes. They write through the connections'
   * services with the caller's permissions, which hold them to the
   * Enterprise Edition and the plan as any save of a connection is.
   */
  getApiRouters: (): Array<ExpressRouter> => {
    return [SCIMOAuthClientSecretAPI];
  },
};

export default IdentityArea;

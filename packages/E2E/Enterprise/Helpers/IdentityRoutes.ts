import { PAGE_NOT_FOUND_MESSAGE_FRAGMENT } from "../../Tests/Helpers/SsoRoutes";

/*
 * The Enterprise Edition's identity surface - SCIM provisioning for projects
 * and status pages - as the three self-hosted stacks answer it, in one table
 * the Licensed, Lapsed and Community suites all read.
 *
 * Single sign-on is NOT in this table. It is core, every stack answers it the
 * same way, and its probes live in Tests/Helpers/SsoRoutes.ts. What is left
 * here is what the Enterprise module adds (ee/Server/Identity/Index.ts:
 * IDENTITY_ROUTERS = SCIM and StatusPageSCIM), which core mounts right after
 * its own identity routers at the same two prefixes (IDENTITY_PREFIXES there).
 *
 * What only a booted stack proves: ee/Tests/Server/Identity/
 * IdentityRoutesServed.test.ts already drives these routes over real HTTP,
 * but it mounts the Express app directly. Nothing in-process touches nginx,
 * where the customer-facing spelling lives: `location /identity` rewrites
 * ^/identity(.*)$ to /api/identity$1 (packages/Nginx/default.conf.template).
 * A SCIM base URL configured at a customer's identity provider uses that first
 * spelling, so a broken rewrite breaks every existing SCIM deployment while
 * every jest suite stays green. Both prefixes are therefore probed on the real
 * stack.
 *
 * Only routes that answer DETERMINISTICALLY with no fixtures and no session
 * are listed: the SCIM service-provider configuration, which demands a bearer
 * token before anything else.
 *
 * Statuses are asserted exactly, never as a 4xx range: on this surface 404
 * means "the Enterprise module is not loaded at all", 403 means "it is loaded
 * and the licence refused", and the licensed answer means it ran. Those are
 * three different bugs.
 */

/*
 * Copied from ee/Server/Identity/Middleware/LicensedFeatureGate.ts rather than
 * imported: core code (this package included) must not import from ee/ - the
 * Community image is built with ee/ absent, and eslint's no-restricted-imports
 * enforces it. A distinctive first clause is enough to pin the message without
 * re-stating the whole paragraph here.
 */
export const SCIM_UNAVAILABLE_MESSAGE_FRAGMENT: string =
  "SCIM provisioning is unavailable because this OneUptime installation's Enterprise license has lapsed or does not include it.";

/*
 * The SCIM refusal is an RFC 7644 error body, not the usual error envelope
 * (LicensedFeatureGate.sendRefusal bypasses it). Note the lower-case
 * "messages" - that is how ee/Server/Identity/Utils/SCIMUtils.ts spells it.
 */
export const SCIM_ERROR_SCHEMA_URN: string =
  "urn:ietf:params:scim:api:messages:2.0:Error";

/*
 * A SCIM configuration id that exists on no stack. The bearer-token check runs
 * before the id is ever parsed (ee/Server/Identity/Middleware/
 * SCIMAuthorization.ts), so an unauthenticated probe never depends on it.
 */
export const NONEXISTENT_SCIM_ID: string =
  "00000000-0000-4000-8000-000000000000";

export interface ScimProbeExpectation {
  // The exact HTTP status. Never a range.
  status: number;
  // A distinctive substring of the body, when the status alone is not enough.
  bodyContains?: string | undefined;
  /*
   * True when the answer must be an RFC 7644 SCIM error body rather than the
   * usual error envelope. It matters because an identity provider only shows
   * its administrator a reason it can parse, and
   * LicensedFeatureGate.sendRefusal bypasses Response.sendErrorResponse
   * precisely so the refusal keeps the SCIM shape: `schemas`, `status` as a
   * STRING, and `detail`.
   */
  isScimError?: boolean | undefined;
}

export interface ScimProbe {
  // Used as the test title; says what the route is, not what it returns.
  label: string;
  // The path after the identity prefix, exactly as the enterprise router declares it.
  path: string;
  // A self-hosted enterprise stack whose licence is usable.
  licensed: ScimProbeExpectation;
  // The same stack after its licence lapsed (LicensedFeatureGate.forScim refuses).
  lapsed: ScimProbeExpectation;
  // The Community image, which mounts no SCIM router at all.
  community: ScimProbeExpectation;
}

/*
 * What the Community Edition answers on every SCIM path: the App's catch-all
 * (Common/Server/Utils/StartServer.ts) with the request URL after it. 404
 * versus 403 is the whole discriminator between "no enterprise module" and
 * "an enterprise module whose licence is dead".
 */
const COMMUNITY_NOT_FOUND: ScimProbeExpectation = {
  status: 404,
  bodyContains: PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
};

const SCIM_REFUSAL: ScimProbeExpectation = {
  // Forbidden with a SCIM error body, from LicensedFeatureGate.forScim.
  status: 403,
  bodyContains: SCIM_UNAVAILABLE_MESSAGE_FRAGMENT,
  isScimError: true,
};

/*
 * NotAuthorizedException is 422 (Common/Types/Exception/ExceptionCode.ts),
 * and it comes from the SCIM authorization middleware - which only runs
 * because the licence gate in front of it let the request through.
 */
const BEARER_TOKEN_REQUIRED: ScimProbeExpectation = {
  status: 422,
  bodyContains: "Bearer token is required for SCIM authentication",
};

export const SCIM_PROBES: ReadonlyArray<ScimProbe> = [
  {
    label: "Project SCIM ServiceProviderConfig with no bearer token",
    path: `/scim/v2/${NONEXISTENT_SCIM_ID}/ServiceProviderConfig`,
    licensed: BEARER_TOKEN_REQUIRED,
    lapsed: SCIM_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
  {
    label: "Status page SCIM ServiceProviderConfig with no bearer token",
    path: `/status-page-scim/v2/${NONEXISTENT_SCIM_ID}/ServiceProviderConfig`,
    licensed: BEARER_TOKEN_REQUIRED,
    lapsed: SCIM_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
];

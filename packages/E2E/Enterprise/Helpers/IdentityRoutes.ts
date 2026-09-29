import { enterpriseUrl } from "./LicenseState";

/*
 * The enterprise identity surface, as the three stacks answer it, in one table
 * the Licensed, Lapsed and Community suites all read.
 *
 * What only a booted stack proves: ee/Tests/Server/Identity/
 * IdentityRoutesServed.test.ts already drives these routes over real HTTP, but
 * it mounts the Express app directly. Nothing in-process touches nginx, and
 * nginx is where the customer-facing spelling lives: `location /identity`
 * rewrites ^/identity(.*)$ to /api/identity$1 before proxying
 * (packages/Nginx/default.conf.template). An ACS or SCIM URL configured at a
 * customer's identity provider uses that first spelling, so a broken rewrite
 * breaks every existing SSO deployment while every jest suite stays green.
 * Both prefixes are therefore probed on the real stack.
 *
 * Only routes that answer DETERMINISTICALLY with no fixtures and no session
 * are listed: discovery endpoints and the SCIM service-provider configuration.
 * Deliberately no browser SSO start/callback route, whose answer depends on
 * stored provider configuration.
 *
 * Statuses are asserted exactly, never as a 4xx range: on this surface 404
 * means "the Enterprise module is not loaded at all", 402/403 mean "it is
 * loaded and the licence refused", and the licensed answers mean it ran. Those
 * are three different bugs.
 */

/*
 * The customer-facing prefix (rewritten by nginx) and the internal one. Both
 * reach the same routers: FeatureSet/Identity/Index.ts mounts each enterprise
 * router at BOTH `/api/identity` and `/`.
 */
export const IDENTITY_PREFIXES: ReadonlyArray<string> = [
  "/identity",
  "/api/identity",
];

/*
 * Copied from ee/Server/Identity/Middleware/LicensedFeatureGate.ts rather than
 * imported: core code (this package included) must not import from ee/ - the
 * Community image is built with ee/ absent, and eslint's no-restricted-imports
 * enforces it. A distinctive first clause is enough to pin the message without
 * re-stating the whole paragraph here.
 */
export const SSO_UNAVAILABLE_MESSAGE_FRAGMENT: string =
  "Single sign-on is unavailable because this OneUptime installation's Enterprise license has lapsed or does not include it.";

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
 * What the Community Edition answers on every one of these paths: the App's
 * catch-all (Common/Server/Utils/StartServer.ts) with the request URL after
 * it. 404 versus 402/403 is the whole discriminator between "no enterprise
 * module" and "an enterprise module whose licence is dead".
 */
export const PAGE_NOT_FOUND_MESSAGE_FRAGMENT: string = "Page not found - ";

/*
 * A SCIM configuration id that exists on no stack. The bearer-token check runs
 * before the id is ever parsed (ee/Server/Identity/Middleware/
 * SCIMAuthorization.ts), so an unauthenticated probe never depends on it.
 */
export const NONEXISTENT_SCIM_ID: string =
  "00000000-0000-4000-8000-000000000000";

export interface IdentityProbeExpectation {
  // The exact HTTP status. Never a range.
  status: number;
  // A distinctive substring of the body, when the status alone is not enough.
  bodyContains?: string | undefined;
  /*
   * True when the answer must be a JSON entity array ({ data: [...] }) - the
   * shape Response.sendEntityArrayResponse produces for a discovery route that
   * ran.
   */
  isEntityArray?: boolean | undefined;
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

export interface IdentityProbe {
  // Used as the test title; says what the route is, not what it returns.
  label: string;
  // The path after the prefix, exactly as the enterprise router declares it.
  path: string;
  // A self-hosted enterprise stack whose licence is usable.
  licensed: IdentityProbeExpectation;
  // The same stack after its licence lapsed (LicensedFeatureGate refuses).
  lapsed: IdentityProbeExpectation;
  // The Community image, which mounts none of these routers.
  community: IdentityProbeExpectation;
}

const COMMUNITY_NOT_FOUND: IdentityProbeExpectation = {
  status: 404,
  bodyContains: PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
};

const SSO_JSON_REFUSAL: IdentityProbeExpectation = {
  // PaymentRequired, from LicensedFeatureGate.forSsoJson.
  status: 402,
  bodyContains: SSO_UNAVAILABLE_MESSAGE_FRAGMENT,
};

const SCIM_REFUSAL: IdentityProbeExpectation = {
  // Forbidden with a SCIM error body, from LicensedFeatureGate.forScim.
  status: 403,
  bodyContains: SCIM_UNAVAILABLE_MESSAGE_FRAGMENT,
  isScimError: true,
};

export const IDENTITY_PROBES: ReadonlyArray<IdentityProbe> = [
  {
    label: "Global SSO discovery (the list the sign-in page offers)",
    path: "/global-sso/service-provider-login",
    licensed: { status: 200, isEntityArray: true },
    lapsed: SSO_JSON_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
  {
    label: "Global OIDC discovery (the list the sign-in page offers)",
    path: "/global-oidc/service-provider-login",
    licensed: { status: 200, isEntityArray: true },
    lapsed: SSO_JSON_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
  {
    label: "Project SSO discovery with no email",
    path: "/service-provider-login",
    /*
     * The route ran and rejected the request on its own terms
     * (ee/Server/Identity/API/SSO.ts). A 402 here would mean the gate refused
     * before the route was reached.
     */
    licensed: { status: 400, bodyContains: "Email is required" },
    lapsed: SSO_JSON_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
  {
    label: "Project OIDC discovery with no email",
    path: "/service-provider-login-oidc",
    licensed: { status: 400, bodyContains: "Email is required" },
    lapsed: SSO_JSON_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
  {
    label: "Project SCIM ServiceProviderConfig with no bearer token",
    path: `/scim/v2/${NONEXISTENT_SCIM_ID}/ServiceProviderConfig`,
    /*
     * NotAuthorizedException is 422 (Common/Types/Exception/ExceptionCode.ts),
     * and it comes from the SCIM authorization middleware - which only runs
     * because the licence gate in front of it let the request through.
     */
    licensed: {
      status: 422,
      bodyContains: "Bearer token is required for SCIM authentication",
    },
    lapsed: SCIM_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
  {
    label: "Status page SCIM ServiceProviderConfig with no bearer token",
    path: `/status-page-scim/v2/${NONEXISTENT_SCIM_ID}/ServiceProviderConfig`,
    licensed: {
      status: 422,
      bodyContains: "Bearer token is required for SCIM authentication",
    },
    lapsed: SCIM_REFUSAL,
    community: COMMUNITY_NOT_FOUND,
  },
];

type IdentityProbeUrlFunction = (data: {
  prefix: string;
  path: string;
}) => string;

export const identityProbeUrl: IdentityProbeUrlFunction = (data: {
  prefix: string;
  path: string;
}): string => {
  return enterpriseUrl(`${data.prefix}${data.path}`);
};

/*
 * The BROWSER half of the SSO surface, which refuses differently: a person is
 * looking at it, so LicensedFeatureGate.forSsoPage renders the Identity
 * message view with a 402 instead of answering JSON
 * (ee/Server/Identity/Middleware/LicensedFeatureGate.ts, whose MESSAGE_VIEW is
 * packages/App/FeatureSet/Identity/Views/Message.ejs). That is what somebody
 * clicking "Sign in with SSO" sees once the licence has lapsed, and the reason
 * a lapse does not look like an outage.
 *
 * Deliberately NOT part of IDENTITY_PROBES: this path is only deterministic
 * while the gate refuses in front of it. On a licensed stack the route itself
 * runs and its answer depends on the ProjectSSO row the ids name, so only the
 * Lapsed suite probes it.
 *
 * The ids below exist on no stack, which does not matter here for the same
 * reason: the gate is the route's first handler and answers before either id
 * is read.
 */
export const NONEXISTENT_PROJECT_ID: string =
  "00000000-0000-4000-8000-000000000001";

export const NONEXISTENT_PROJECT_SSO_ID: string =
  "00000000-0000-4000-8000-000000000002";

// ee/Server/Identity/API/SSO.ts: GET /sso/:projectId/:projectSsoId.
export const SSO_LOGIN_PAGE_PATH: string = `/sso/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROJECT_SSO_ID}`;

/*
 * The heading the message view renders, copied from LicensedFeatureGate's
 * SSO_UNAVAILABLE_TITLE (core must not import from ee/). The message itself is
 * SSO_UNAVAILABLE_MESSAGE_FRAGMENT above - the same text the JSON refusal
 * carries, so one constant covers both halves.
 */
export const SSO_UNAVAILABLE_TITLE: string = "Single sign-on is unavailable.";

/*
 * The second half of SSO_UNAVAILABLE_MESSAGE, which is what a RENDERED answer
 * is matched on. Two reasons:
 *
 *   - EJS's <%= %> escapes the apostrophe in "installation's" to &#39;, so the
 *     first sentence does not appear verbatim in the HTML the way it does in
 *     the JSON refusals. This sentence has no characters EJS rewrites.
 *   - It is the half that matters to the person reading the page: a lapsed
 *     licence stops single sign-on, it does not lock anyone out. The Lapsed
 *     suite proves that claim twice - here in the copy, and by signing in with
 *     a password.
 */
export const SSO_UNAVAILABLE_PAGE_ADVICE_FRAGMENT: string =
  "Sign in with your password, or ask your administrator to renew the license.";

import { BASE_URL } from "../../Config";
import { APIRequestContext, APIResponse, expect } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Single sign-on as every stack answers it: the Community stack, the SaaS
 * stack, and the self-hosted Enterprise stack both before and after its
 * licence lapses.
 *
 * SAML and OIDC sign-in - for projects, for the whole instance (Global SSO
 * and Global OIDC) and for status pages - is core code.
 * packages/App/FeatureSet/Identity/Index.ts mounts its seven routers
 * (packages/App/FeatureSet/Identity/SsoRouters.ts) in every edition, with
 * nothing in front of any route: no licence gate, and no plan gate on the
 * sign-in routes themselves. So unlike the SCIM routes
 * (Enterprise/Helpers/IdentityRoutes.ts), which answer differently on each
 * stack, every probe below has exactly ONE answer, and every stack must give
 * it.
 *
 * What only a booted stack proves: packages/App/Tests/FeatureSet/Identity/
 * SsoRoutesServedInEveryEdition.test.ts already sends requests like these in
 * every edition and licence state, and SsoRoutePathsUnchanged.test.ts pins
 * every (method, path) pair - both against Express mounted in-process. Neither
 * goes through nginx, and nginx is where the spelling customers configure
 * lives: `location /identity` rewrites ^/identity(.*)$ to /api/identity$1
 * (packages/Nginx/default.conf.template). The SAML ACS URLs and OIDC redirect
 * URIs pasted into identity providers use that first spelling, so a broken
 * rewrite breaks every SSO deployment while every jest suite stays green. Both
 * prefixes are probed, against a published image.
 *
 * Only requests with a DETERMINISTIC answer are listed: no fixtures, no
 * session, nothing stored. Each one ends on one of its route's own early
 * answers - a missing email, SAMLResponse or OIDC login session, a provider
 * that exists on no stack, an invalid confirmation link - read from the route
 * code in packages/App/FeatureSet/Identity/API/*.ts. Those answers go out
 * through Response.sendErrorResponse (packages/Common/Server/Utils/
 * Response.ts), which sends exactly { message } with the exception's code as
 * the status; BadRequestException is 400.
 *
 * The status is asserted exactly, never as a range, and separately from 404
 * and 402/403: a 404 means the router is not mounted (or, for /identity, that
 * nginx stopped rewriting), a 402 or 403 would mean something refused the
 * request in front of the route - and single sign-on has nothing there in any
 * edition - and the pinned answer means the route itself ran. Those are three
 * different bugs.
 */

/*
 * The customer-facing prefix (rewritten by nginx) and the internal one. Both
 * reach the same routers: FeatureSet/Identity/Index.ts mounts every identity
 * router - the core ones and the Enterprise Edition's - at BOTH
 * `/api/identity` and `/`.
 */
export const IDENTITY_PREFIXES: ReadonlyArray<string> = [
  "/identity",
  "/api/identity",
];

/*
 * The App's catch-all for a path no router serves
 * (Common/Server/Utils/StartServer.ts), followed by the request URL. No
 * single sign-on route may ever answer it.
 */
export const PAGE_NOT_FOUND_MESSAGE_FRAGMENT: string = "Page not found - ";

/*
 * Ids that exist on no stack, so every provider lookup finds nothing. They
 * are well-formed UUIDs on purpose: the routes parse them before looking them
 * up, and a malformed id would be a different early answer.
 */
export const NONEXISTENT_PROJECT_ID: string =
  "00000000-0000-4000-8000-000000000001";

export const NONEXISTENT_PROVIDER_ID: string =
  "00000000-0000-4000-8000-000000000002";

export const NONEXISTENT_STATUS_PAGE_ID: string =
  "00000000-0000-4000-8000-000000000003";

/*
 * Where a login the mobile app started must end, whatever its outcome
 * (packages/App/FeatureSet/Identity/Utils/MobileSso.ts). App store builds
 * cannot be patched, so the scheme and the parameter names are fixed.
 */
export const MOBILE_SSO_CALLBACK_URL: string = "oneuptime://sso-callback";

/*
 * A well-formed SAMLResponse (base64). It never reaches a signature check:
 * the provider it is posted to does not exist.
 */
const UNSIGNED_SAML_RESPONSE: string =
  Buffer.from("<samlp:Response/>").toString("base64");

// The two query parameters an identity provider returns to an OIDC callback.
const OIDC_CALLBACK_QUERY: Readonly<Record<string, string>> = {
  code: "e2e-code",
  state: "e2e-state",
};

// Every OIDC callback's answer when the browser has no login session cookie.
const OIDC_LOGIN_SESSION_EXPIRED: string =
  "OIDC login session expired. Please try signing in again.";

export interface SsoRouteAnswer {
  // The exact HTTP status. Never a range.
  status: number;
  // The exact JSON body is { message: <this> }.
  message?: string | undefined;
  /*
   * The body is a JSON entity array ({ data: [...] }), the shape
   * Response.sendEntityArrayResponse gives a provider listing. Only its shape
   * is pinned: what it lists depends on the stack.
   */
  isEntityArray?: boolean | undefined;
  // A server-rendered page (an Identity view) whose HTML contains this text.
  pageContains?: string | undefined;
  /*
   * A redirect to the mobile app's deep link (MOBILE_SSO_CALLBACK_URL),
   * carrying exactly these query parameters.
   */
  mobileDeepLink?: Readonly<Record<string, string>> | undefined;
}

export interface SsoRouteProbe {
  // Used in the test title; says what the route is, not what it answers.
  label: string;
  method: "GET" | "POST";
  // The path after the identity prefix, exactly as the core router declares it.
  path: string;
  query?: Readonly<Record<string, string>> | undefined;
  // Sent as application/x-www-form-urlencoded, as an identity provider posts.
  form?: Readonly<Record<string, string>> | undefined;
  answer: SsoRouteAnswer;
}

const badRequest: (message: string) => SsoRouteAnswer = (
  message: string,
): SsoRouteAnswer => {
  return { status: 400, message };
};

const PROVIDER_LISTING: SsoRouteAnswer = { status: 200, isEntityArray: true };

/*
 * At least one request for every one of the 20 (method, path) pairs the core
 * SSO routers declare (packages/App/Tests/FeatureSet/Identity/
 * SsoRoutePathsUnchanged.test.ts pins them): every path a customer pastes into
 * an identity provider (the three SAML ACS URLs and the three OIDC redirect
 * URIs), every discovery route a sign-in page asks, every start route a "Sign
 * in with SSO" button opens, and the confirmation page.
 */
export const SSO_ROUTE_PROBES: ReadonlyArray<SsoRouteProbe> = [
  // API/SSO.ts - project SAML.
  {
    label: "Project SAML discovery with no email",
    method: "GET",
    path: "/service-provider-login",
    answer: badRequest("Email is required"),
  },
  {
    label: "Project SAML sign-in start for a provider that does not exist",
    method: "GET",
    path: `/sso/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("SSO Config not found"),
  },
  {
    /*
     * The mobile app opens the same route with ?mobile=true. The route looks
     * the provider up before it reads that flag, so the answer is the same.
     */
    label:
      "Project SAML sign-in start from the mobile app for a provider that does not exist",
    method: "GET",
    path: `/sso/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    query: { mobile: "true" },
    answer: badRequest("SSO Config not found"),
  },
  {
    label: "Project SAML ACS URL with no SAMLResponse",
    method: "POST",
    path: `/idp-login/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("SAMLResponse not found"),
  },
  {
    // The ACS URL answers GET too, for identity providers that redirect.
    label: "Project SAML ACS URL (GET) with no SAMLResponse",
    method: "GET",
    path: `/idp-login/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("SAMLResponse not found"),
  },
  // API/OIDC.ts - project OIDC.
  {
    label: "Project OIDC discovery with no email",
    method: "GET",
    path: "/service-provider-login-oidc",
    answer: badRequest("Email is required"),
  },
  {
    label: "Project OIDC sign-in start for a provider that does not exist",
    method: "GET",
    path: `/oidc/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("OIDC Config not found"),
  },
  {
    label: "Project OIDC redirect URI with no login session",
    method: "GET",
    path: `/oidc-callback/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    query: OIDC_CALLBACK_QUERY,
    answer: badRequest(OIDC_LOGIN_SESSION_EXPIRED),
  },
  // API/GlobalSSO.ts - instance-wide SAML.
  {
    label: "Global SSO discovery (the list the sign-in page offers)",
    method: "GET",
    path: "/global-sso/service-provider-login",
    answer: PROVIDER_LISTING,
  },
  {
    label: "Global SSO sign-in start for a provider that does not exist",
    method: "GET",
    path: `/global-sso/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("Global SSO Config not found"),
  },
  {
    label: "Global SSO ACS URL with no SAMLResponse",
    method: "POST",
    path: `/global-idp-login/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("SAMLResponse not found"),
  },
  {
    /*
     * RelayState=mobile marks a login the mobile app started. A failure must
     * still end on the app's deep link - a JSON error is a dead end inside the
     * app's browser - so this one answers with a redirect, not a 400.
     */
    label: "Global SSO ACS URL of a mobile sign-in with no SAMLResponse",
    method: "GET",
    path: `/global-idp-login/${NONEXISTENT_PROVIDER_ID}`,
    query: { RelayState: "mobile" },
    answer: {
      status: 302,
      mobileDeepLink: {
        error: "sso_failed",
        errorDescription:
          "Your identity provider did not return a sign-in response. Please try again.",
      },
    },
  },
  // API/GlobalOIDC.ts - instance-wide OIDC.
  {
    label: "Global OIDC discovery (the list the sign-in page offers)",
    method: "GET",
    path: "/global-oidc/service-provider-login",
    answer: PROVIDER_LISTING,
  },
  {
    label: "Global OIDC sign-in start for a provider that does not exist",
    method: "GET",
    path: `/global-oidc/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("Global OIDC Config not found"),
  },
  {
    label: "Global OIDC redirect URI with no login session",
    method: "GET",
    path: `/global-oidc-callback/${NONEXISTENT_PROVIDER_ID}`,
    query: OIDC_CALLBACK_QUERY,
    answer: badRequest(OIDC_LOGIN_SESSION_EXPIRED),
  },
  // API/StatusPageSSO.ts - status page SAML.
  {
    label: "Status page SAML sign-in start for a provider that does not exist",
    method: "GET",
    path: `/status-page-sso/${NONEXISTENT_STATUS_PAGE_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("SSO Config not found"),
  },
  {
    label: "Status page SAML ACS URL for a provider that does not exist",
    method: "POST",
    path: `/status-page-idp-login/${NONEXISTENT_STATUS_PAGE_ID}/${NONEXISTENT_PROVIDER_ID}`,
    form: { SAMLResponse: UNSIGNED_SAML_RESPONSE },
    answer: badRequest("SSO Config not found"),
  },
  // API/StatusPageOIDC.ts - status page OIDC.
  {
    label: "Status page OIDC sign-in start for a provider that does not exist",
    method: "GET",
    path: `/status-page-oidc/${NONEXISTENT_STATUS_PAGE_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("OIDC Config not found"),
  },
  {
    label: "Status page OIDC redirect URI with no login session",
    method: "GET",
    path: `/status-page-oidc-callback/${NONEXISTENT_STATUS_PAGE_ID}/${NONEXISTENT_PROVIDER_ID}`,
    query: OIDC_CALLBACK_QUERY,
    answer: badRequest(OIDC_LOGIN_SESSION_EXPIRED),
  },
  /*
   * API/ProjectSsoSignInConfirmation.ts - the page a project-SSO confirmation
   * email links to. Only the hosted service sends that email, so a link
   * without a valid token and signature renders the invalid-link view
   * (FeatureSet/Identity/Views/SsoSignInConfirmation.ejs), with a 200.
   */
  {
    label: "Project SSO sign-in confirmation page for a link with no token",
    method: "GET",
    path: `/sso-sign-in-confirmation/saml/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: { status: 200, pageContains: "This link is not valid." },
  },
  {
    label: "Project SSO sign-in confirmation submitted with no token",
    method: "POST",
    path: `/sso-sign-in-confirmation/oidc/${NONEXISTENT_PROJECT_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: { status: 200, pageContains: "This link is not valid." },
  },
];

/*
 * The spelling a status page on a customer's own domain uses. It does not
 * talk to /identity: nginx raises /status-page-sso-api/ and
 * /status-page-oidc-api/ and rewrites them to /api/identity/status-page-sso/
 * and /api/identity/status-page-oidc/ (Tests/Api/NginxRaisedPrefixes.spec.ts
 * pins the rewrites themselves). The status page's "Sign in with SSO" button
 * opens /status-page-sso-api/<statusPageId>/<providerId>
 * (FeatureSet/StatusPage/src/Pages/Accounts/SSO.tsx). The path here is the
 * whole public path, so these probes are sent with no identity prefix.
 */
export const RAISED_PREFIX_SSO_PROBES: ReadonlyArray<SsoRouteProbe> = [
  {
    label:
      "Status page SAML sign-in start through the status page's own prefix",
    method: "GET",
    path: `/status-page-sso-api/${NONEXISTENT_STATUS_PAGE_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("SSO Config not found"),
  },
  {
    label:
      "Status page OIDC sign-in start through the status page's own prefix",
    method: "GET",
    path: `/status-page-oidc-api/${NONEXISTENT_STATUS_PAGE_ID}/${NONEXISTENT_PROVIDER_ID}`,
    answer: badRequest("OIDC Config not found"),
  },
];

type StackUrlFunction = (path: string) => string;

// Absolute URL for a path on the stack under test (HOST / HTTP_PROTOCOL).
export const stackUrl: StackUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

type IdentityRouteUrlFunction = (data: {
  prefix: string;
  path: string;
}) => string;

export const identityRouteUrl: IdentityRouteUrlFunction = (data: {
  prefix: string;
  path: string;
}): string => {
  return stackUrl(`${data.prefix}${data.path}`);
};

type DescribeSsoRouteProbeFunction = (data: {
  prefix: string;
  probe: SsoRouteProbe;
}) => string;

// The test title: the request as it is sent, then what the route is.
export const describeSsoRouteProbe: DescribeSsoRouteProbeFunction = (data: {
  prefix: string;
  probe: SsoRouteProbe;
}): string => {
  const query: string = data.probe.query
    ? `?${new URLSearchParams(data.probe.query).toString()}`
    : "";

  return `${data.probe.method} ${data.prefix}${data.probe.path}${query} - ${data.probe.label}`;
};

export interface SsoRouteResponse {
  // The request as sent, for failure messages.
  request: string;
  status: number;
  body: string;
  // The Location header, or "" when there is none.
  location: string;
}

type SendSsoRouteProbeFunction = (data: {
  request: APIRequestContext;
  prefix: string;
  probe: SsoRouteProbe;
}) => Promise<SsoRouteResponse>;

/*
 * Sends one probe and reads the answer. Never follows a redirect: a route
 * that answered by redirecting somewhere that happens to return 200 would
 * otherwise read as a pass, and the mobile deep link is not an address a
 * request can follow at all.
 */
export const sendSsoRouteProbe: SendSsoRouteProbeFunction = async (data: {
  request: APIRequestContext;
  prefix: string;
  probe: SsoRouteProbe;
}): Promise<SsoRouteResponse> => {
  const url: string = identityRouteUrl({
    prefix: data.prefix,
    path: data.probe.path,
  });

  const response: APIResponse = await data.request.fetch(url, {
    method: data.probe.method,
    maxRedirects: 0,
    ...(data.probe.query ? { params: { ...data.probe.query } } : {}),
    ...(data.probe.form ? { form: { ...data.probe.form } } : {}),
  });

  const query: string = data.probe.query
    ? `?${new URLSearchParams(data.probe.query).toString()}`
    : "";

  return {
    request: `${data.probe.method} ${url}${query}`,
    status: response.status(),
    body: await response.text(),
    location: response.headers()["location"] || "",
  };
};

type ParseJsonObjectFunction = (data: {
  body: string;
  failure: string;
}) => Record<string, unknown>;

// The body as a JSON object, or a failed assertion that says what came back.
const parseJsonObject: ParseJsonObjectFunction = (data: {
  body: string;
  failure: string;
}): Record<string, unknown> => {
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(data.body);
  } catch {
    parsed = null;
  }

  const isObject: boolean =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);

  expect(isObject, data.failure).toBe(true);

  return parsed as Record<string, unknown>;
};

type ExpectSsoRouteAnswerFunction = (data: {
  probe: SsoRouteProbe;
  response: SsoRouteResponse;
}) => void;

/*
 * The one answer a probe must get on every stack. Every spec that probes
 * single sign-on asserts through this, so the Community, SaaS, licensed and
 * lapsed suites cannot drift apart.
 */
export const expectSsoRouteAnswer: ExpectSsoRouteAnswerFunction = (data: {
  probe: SsoRouteProbe;
  response: SsoRouteResponse;
}): void => {
  const probe: SsoRouteProbe = data.probe;
  const response: SsoRouteResponse = data.response;
  const expected: SsoRouteAnswer = probe.answer;
  const found: string = `HTTP ${response.status} from ${response.request}: ${response.body.slice(
    0,
    300,
  )}`;

  expect(
    response.status,
    `${response.request} answered 404: the core single sign-on router that ` +
      `serves it is not mounted. Every edition serves single sign-on, so this ` +
      `is a broken image - or, for the /identity spelling, nginx stopped ` +
      `rewriting it to /api/identity. ${found}`,
  ).not.toBe(404);

  expect(
    [402, 403],
    `${response.request} was refused before its route ran. Single sign-on has ` +
      `no licence gate in any edition: neither the Community Edition nor a ` +
      `lapsed Enterprise licence may stop it. ${found}`,
  ).not.toContain(response.status);

  expect(
    response.body,
    `${response.request} answered the App's catch-all "page not found" body. ${found}`,
  ).not.toContain(PAGE_NOT_FOUND_MESSAGE_FRAGMENT);

  expect(
    response.status,
    `${response.request} answered the wrong status. ${found}`,
  ).toBe(expected.status);

  if (expected.message !== undefined) {
    /*
     * Exactly { message }, which is what Response.sendErrorResponse sends: the
     * route turned the request away on its own terms, and a rendered page or
     * any other envelope is some other code answering.
     */
    const parsed: Record<string, unknown> = parseJsonObject({
      body: response.body,
      failure: `${response.request} must answer with a JSON error. ${found}`,
    });

    expect(
      parsed,
      `${response.request} must answer with its route's own error message. ${found}`,
    ).toEqual({ message: expected.message });
  }

  if (expected.isEntityArray) {
    const parsed: Record<string, unknown> = parseJsonObject({
      body: response.body,
      failure: `${response.request} must answer a JSON entity array. ${found}`,
    });

    /*
     * The discovery route ran and listed providers. What it lists depends on
     * the stack; the point is that it is a listing, not a refusal.
     */
    expect(
      Array.isArray(parsed["data"]),
      `${response.request} must answer a JSON entity array ({ data: [...] }). ${found}`,
    ).toBe(true);
  }

  if (expected.pageContains !== undefined) {
    expect(
      response.body,
      `${response.request} must render an Identity page. ${found}`,
    ).toContain("<html");

    expect(
      response.body,
      `${response.request} rendered a different page. ${found}`,
    ).toContain(expected.pageContains);
  }

  if (expected.mobileDeepLink !== undefined) {
    const deepLinkPrefix: string = `${MOBILE_SSO_CALLBACK_URL}?`;

    expect(
      response.location.startsWith(deepLinkPrefix),
      `${response.request} must send the mobile app back to its deep link ` +
        `(${MOBILE_SSO_CALLBACK_URL}); found Location "${response.location}". ${found}`,
    ).toBe(true);

    const parameters: Record<string, string> = Object.fromEntries(
      new URLSearchParams(
        response.location.slice(deepLinkPrefix.length),
      ).entries(),
    );

    expect(
      parameters,
      `${response.request} sent the mobile app different deep-link parameters. ` +
        `Found Location "${response.location}".`,
    ).toEqual({ ...expected.mobileDeepLink });
  }
};

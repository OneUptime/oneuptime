import { expect } from "@jest/globals";
import IdentityFeatureSet from "../../../FeatureSet/Identity/Index";
import { SSO_SIGN_IN_CONFIRMATION_VIEW } from "../../../FeatureSet/Identity/API/ProjectSsoSignInConfirmation";
import { MOBILE_SSO_CALLBACK_URL } from "../../../FeatureSet/Identity/Utils/MobileSso";
import GlobalOIDCService from "Common/Server/Services/GlobalOidcService";
import GlobalSSOService from "Common/Server/Services/GlobalSsoService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import StatusPageOidcService from "Common/Server/Services/StatusPageOidcService";
import StatusPageSsoService from "Common/Server/Services/StatusPageSsoService";
import UserService from "Common/Server/Services/UserService";
import Express, {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import Response from "Common/Server/Utils/Response";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * Requests that every core single sign-on route answers WITHOUT a database,
 * with the answer each one gives, read from the route's own code
 * (packages/App/FeatureSet/Identity/API/*.ts). Every provider lookup is
 * stubbed to find nothing (stubSsoDatabaseReads), so each request ends on one
 * of the handler's own early answers: a missing email, SAMLResponse or OIDC
 * state cookie, an unknown provider, an invalid confirmation link - or, for a
 * login the mobile app started, the failure deep link the app understands.
 *
 * Shared by the core suites (which run with ee/ deleted) and by ee's
 * coexistence suites (which import it as "App/Tests/FeatureSet/Identity/
 * SsoRouteProbes"): the same requests must get the same answers whatever
 * edition, license or billing state the instance is in.
 */

export const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
export const PROVIDER_ID: string = "22222222-2222-4222-8222-222222222222";

// The two prefixes core mounts identity routers at; nginx forwards /identity/ to "".
export const IDENTITY_PREFIXES: ReadonlyArray<string> = ["", "/api/identity"];

// A well-formed SAMLResponse. It never reaches the signature check: the provider is unknown.
const SAML_RESPONSE: string =
  Buffer.from("<samlp:Response/>").toString("base64");

// What an unfinished project OIDC login leaves in the browser, from the mobile app.
const signedMobileOidcState: () => string = (): string => {
  return JSONWebToken.signJsonPayload(
    {
      state: "state",
      nonce: "nonce",
      codeVerifier: "verifier",
      isMobile: true,
    },
    600,
  );
};

export interface SsoProbe {
  label: string;
  // The SSO_ROUTERS entry and the (method, route) this request reaches.
  router: string;
  method: "GET" | "POST";
  route: string;
  // The request path without an identity prefix, query string included.
  path: string;
  form?: Record<string, string> | undefined;
  cookies?: () => Record<string, string>;
  expected: ExpectedSsoAnswer;
}

export interface ExpectedSsoAnswer {
  status: number;
  // The JSON body, exactly (a rendered view answers with its view and variables).
  body?: JSONObject | undefined;
  // For a redirect to the mobile app: every query parameter of the deep link.
  deepLink?: Record<string, string> | undefined;
}

const badRequest: (message: string) => ExpectedSsoAnswer = (
  message: string,
): ExpectedSsoAnswer => {
  return { status: 400, body: { message } };
};

const EMPTY_PROVIDER_LIST: ExpectedSsoAnswer = {
  status: 200,
  body: { data: [], count: 0, skip: 0, limit: 10 },
};

const INVALID_CONFIRMATION_LINK: ExpectedSsoAnswer = {
  status: 200,
  body: {
    view: SSO_SIGN_IN_CONFIRMATION_VIEW,
    enableGoogleTagManager: false,
    title: "This link is not valid.",
    message:
      "It may already have been used, or the email address on the account may have changed. Sign in with single sign-on again and we will email you a new link.",
  },
};

const mobileFailure: (
  error: string,
  errorDescription: string,
) => ExpectedSsoAnswer = (
  error: string,
  errorDescription: string,
): ExpectedSsoAnswer => {
  return { status: 302, deepLink: { error, errorDescription } };
};

export const SSO_ROUTE_PROBES: ReadonlyArray<SsoProbe> = [
  {
    label: "project SAML discovery without an email",
    router: "SSO",
    method: "GET",
    route: "/service-provider-login",
    path: "/service-provider-login",
    expected: badRequest("Email is required"),
  },
  {
    label: "project SAML discovery for an address with no account",
    router: "SSO",
    method: "GET",
    route: "/service-provider-login",
    path: "/service-provider-login?email=nobody%40example.com",
    expected: badRequest("No SSO config found for this user"),
  },
  {
    label: "project SAML start for an unknown provider",
    router: "SSO",
    method: "GET",
    route: "/sso/:projectId/:projectSsoId",
    path: `/sso/${PROJECT_ID}/${PROVIDER_ID}`,
    expected: badRequest("SSO Config not found"),
  },
  {
    label: "project SAML start from the mobile app for an unknown provider",
    router: "SSO",
    method: "GET",
    route: "/sso/:projectId/:projectSsoId",
    path: `/sso/${PROJECT_ID}/${PROVIDER_ID}?mobile=true`,
    expected: badRequest("SSO Config not found"),
  },
  {
    label: "project SAML ACS (GET) without a SAMLResponse",
    router: "SSO",
    method: "GET",
    route: "/idp-login/:projectId/:projectSsoId",
    path: `/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
    expected: badRequest("SAMLResponse not found"),
  },
  {
    label: "project SAML ACS without a SAMLResponse",
    router: "SSO",
    method: "POST",
    route: "/idp-login/:projectId/:projectSsoId",
    path: `/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
    expected: badRequest("SAMLResponse not found"),
  },
  {
    label: "project SAML ACS for an unknown provider (RelayState=mobile)",
    router: "SSO",
    method: "POST",
    route: "/idp-login/:projectId/:projectSsoId",
    path: `/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
    form: { SAMLResponse: SAML_RESPONSE, RelayState: "mobile" },
    expected: badRequest("SSO Config not found"),
  },
  {
    label: "project OIDC discovery without an email",
    router: "OIDC",
    method: "GET",
    route: "/service-provider-login-oidc",
    path: "/service-provider-login-oidc",
    expected: badRequest("Email is required"),
  },
  {
    label: "project OIDC discovery for an address with no account",
    router: "OIDC",
    method: "GET",
    route: "/service-provider-login-oidc",
    path: "/service-provider-login-oidc?email=nobody%40example.com",
    expected: badRequest("No OIDC config found for this user"),
  },
  {
    label: "project OIDC start from the mobile app for an unknown provider",
    router: "OIDC",
    method: "GET",
    route: "/oidc/:projectId/:projectOidcId",
    path: `/oidc/${PROJECT_ID}/${PROVIDER_ID}?mobile=true`,
    expected: badRequest("OIDC Config not found"),
  },
  {
    label: "project OIDC callback without its state cookie",
    router: "OIDC",
    method: "GET",
    route: "/oidc-callback/:projectId/:projectOidcId",
    path: `/oidc-callback/${PROJECT_ID}/${PROVIDER_ID}?code=code&state=state`,
    expected: badRequest(
      "OIDC login session expired. Please try signing in again.",
    ),
  },
  {
    label: "project OIDC callback with a state cookie that does not verify",
    router: "OIDC",
    method: "GET",
    route: "/oidc-callback/:projectId/:projectOidcId",
    path: `/oidc-callback/${PROJECT_ID}/${PROVIDER_ID}?code=code&state=state`,
    cookies: (): Record<string, string> => {
      return { [`oidc-state-${PROVIDER_ID}`]: "not-a-signed-token" };
    },
    expected: badRequest(
      "OIDC login session is invalid. Please try signing in again.",
    ),
  },
  {
    label:
      "project OIDC callback of a mobile login (signed state cookie) for an unknown provider",
    router: "OIDC",
    method: "GET",
    route: "/oidc-callback/:projectId/:projectOidcId",
    path: `/oidc-callback/${PROJECT_ID}/${PROVIDER_ID}?code=code&state=state`,
    cookies: (): Record<string, string> => {
      return { [`oidc-state-${PROVIDER_ID}`]: signedMobileOidcState() };
    },
    expected: badRequest("OIDC Config not found"),
  },
  {
    label: "Global SSO discovery",
    router: "GlobalSSO",
    method: "GET",
    route: "/global-sso/service-provider-login",
    path: "/global-sso/service-provider-login",
    expected: EMPTY_PROVIDER_LIST,
  },
  {
    label: "Global SSO start from the mobile app for an unknown provider",
    router: "GlobalSSO",
    method: "GET",
    route: "/global-sso/:globalSsoId",
    path: `/global-sso/${PROVIDER_ID}?mobile=true`,
    expected: badRequest("Global SSO Config not found"),
  },
  {
    label: "Global SSO ACS (GET) without a SAMLResponse",
    router: "GlobalSSO",
    method: "GET",
    route: "/global-idp-login/:globalSsoId",
    path: `/global-idp-login/${PROVIDER_ID}`,
    expected: badRequest("SAMLResponse not found"),
  },
  {
    label:
      "Global SSO ACS (GET) of a mobile login (RelayState in the query) without a SAMLResponse",
    router: "GlobalSSO",
    method: "GET",
    route: "/global-idp-login/:globalSsoId",
    path: `/global-idp-login/${PROVIDER_ID}?RelayState=mobile`,
    expected: mobileFailure(
      "sso_failed",
      "Your identity provider did not return a sign-in response. Please try again.",
    ),
  },
  {
    label:
      "Global SSO ACS of a mobile login (RelayState in the body) without a SAMLResponse",
    router: "GlobalSSO",
    method: "POST",
    route: "/global-idp-login/:globalSsoId",
    path: `/global-idp-login/${PROVIDER_ID}`,
    form: { RelayState: "mobile" },
    expected: mobileFailure(
      "sso_failed",
      "Your identity provider did not return a sign-in response. Please try again.",
    ),
  },
  {
    label: "Global SSO ACS for an unknown provider",
    router: "GlobalSSO",
    method: "POST",
    route: "/global-idp-login/:globalSsoId",
    path: `/global-idp-login/${PROVIDER_ID}`,
    form: { SAMLResponse: SAML_RESPONSE },
    expected: badRequest("Global SSO Config not found"),
  },
  {
    label:
      "Global SSO ACS of a mobile login (intent cookie) for an unknown provider",
    router: "GlobalSSO",
    method: "POST",
    route: "/global-idp-login/:globalSsoId",
    path: `/global-idp-login/${PROVIDER_ID}`,
    form: { SAMLResponse: SAML_RESPONSE },
    cookies: (): Record<string, string> => {
      return { [`sso-mobile-intent-${PROVIDER_ID}`]: "true" };
    },
    expected: mobileFailure(
      "provider_unavailable",
      "This SSO provider is no longer available. Please contact your administrator.",
    ),
  },
  {
    label: "Global OIDC discovery",
    router: "GlobalOIDC",
    method: "GET",
    route: "/global-oidc/service-provider-login",
    path: "/global-oidc/service-provider-login",
    expected: EMPTY_PROVIDER_LIST,
  },
  {
    label: "Global OIDC start from the mobile app for an unknown provider",
    router: "GlobalOIDC",
    method: "GET",
    route: "/global-oidc/:globalOidcId",
    path: `/global-oidc/${PROVIDER_ID}?mobile=true`,
    expected: badRequest("Global OIDC Config not found"),
  },
  {
    label: "Global OIDC callback without its state cookie",
    router: "GlobalOIDC",
    method: "GET",
    route: "/global-oidc-callback/:globalOidcId",
    path: `/global-oidc-callback/${PROVIDER_ID}?code=code&state=state`,
    expected: badRequest(
      "OIDC login session expired. Please try signing in again.",
    ),
  },
  {
    label:
      "Global OIDC callback of a mobile login (intent cookie) without its state cookie",
    router: "GlobalOIDC",
    method: "GET",
    route: "/global-oidc-callback/:globalOidcId",
    path: `/global-oidc-callback/${PROVIDER_ID}?code=code&state=state`,
    cookies: (): Record<string, string> => {
      return { [`sso-mobile-intent-${PROVIDER_ID}`]: "true" };
    },
    expected: mobileFailure(
      "login_session_expired",
      "Your sign-in session expired. Please try signing in again.",
    ),
  },
  {
    label: "status page SAML start for an unknown provider",
    router: "StatusPageSSO",
    method: "GET",
    route: "/status-page-sso/:statusPageId/:statusPageSsoId",
    path: `/status-page-sso/${PROJECT_ID}/${PROVIDER_ID}?mobile=true`,
    expected: badRequest("SSO Config not found"),
  },
  {
    label: "status page SAML ACS for an unknown provider",
    router: "StatusPageSSO",
    method: "POST",
    route: "/status-page-idp-login/:statusPageId/:statusPageSsoId",
    path: `/status-page-idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
    form: { SAMLResponse: SAML_RESPONSE, RelayState: "mobile" },
    expected: badRequest("SSO Config not found"),
  },
  {
    label: "status page OIDC start for an unknown provider",
    router: "StatusPageOIDC",
    method: "GET",
    route: "/status-page-oidc/:statusPageId/:statusPageOidcId",
    path: `/status-page-oidc/${PROJECT_ID}/${PROVIDER_ID}`,
    expected: badRequest("OIDC Config not found"),
  },
  {
    label: "status page OIDC callback without its state cookie",
    router: "StatusPageOIDC",
    method: "GET",
    route: "/status-page-oidc-callback/:statusPageId/:statusPageOidcId",
    path: `/status-page-oidc-callback/${PROJECT_ID}/${PROVIDER_ID}?code=code&state=state`,
    expected: badRequest(
      "OIDC login session expired. Please try signing in again.",
    ),
  },
  {
    label: "project SSO confirmation page for a forged link",
    router: "ProjectSsoSignInConfirmation",
    method: "GET",
    route: "/sso-sign-in-confirmation/:kind/:projectId/:providerId",
    path: `/sso-sign-in-confirmation/saml/${PROJECT_ID}/${PROVIDER_ID}?token=${PROVIDER_ID}&signature=forged`,
    expected: INVALID_CONFIRMATION_LINK,
  },
  {
    label: "project SSO confirmation submitted without a token",
    router: "ProjectSsoSignInConfirmation",
    method: "POST",
    route: "/sso-sign-in-confirmation/:kind/:projectId/:providerId",
    path: `/sso-sign-in-confirmation/oidc/${PROJECT_ID}/${PROVIDER_ID}`,
    expected: INVALID_CONFIRMATION_LINK,
  },
];

/*
 * Every provider and account lookup the probes can reach finds nothing, so no
 * probe needs a database. Returns the spies (restored by jest.restoreAllMocks).
 */
export const stubSsoDatabaseReads: () => Array<jest.SpyInstance> =
  (): Array<jest.SpyInstance> => {
    return [
      jest.spyOn(UserService, "findOneBy").mockResolvedValue(null),
      jest.spyOn(ProjectSSOService, "findOneBy").mockResolvedValue(null),
      jest.spyOn(ProjectOidcService, "findOneBy").mockResolvedValue(null),
      jest.spyOn(GlobalSSOService, "findBy").mockResolvedValue([]),
      jest.spyOn(GlobalSSOService, "findOneBy").mockResolvedValue(null),
      jest.spyOn(GlobalOIDCService, "findBy").mockResolvedValue([]),
      jest.spyOn(GlobalOIDCService, "findOneBy").mockResolvedValue(null),
      jest.spyOn(StatusPageSsoService, "findOneBy").mockResolvedValue(null),
      jest.spyOn(StatusPageOidcService, "findOneBy").mockResolvedValue(null),
    ] as Array<jest.SpyInstance>;
  };

/*
 * The Identity views are EJS files in the App image (/usr/src/app/...);
 * answer with the view and its variables instead, as JSON.
 */
export const stubRenderedViews: () => void = (): void => {
  jest
    .spyOn(Response, "render")
    .mockImplementation(
      (
        _req: ExpressRequest,
        res: ExpressResponse,
        view: string,
        vars: JSONObject,
      ): void => {
        res.send({ view, ...vars });
      },
    );
};

// What cookie-parser does in core's server: the Cookie header as req.cookies.
const parseCookies: (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
) => void = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  const cookies: Record<string, string> = {};

  for (const pair of (req.headers.cookie || "").split(";")) {
    const separator: number = pair.indexOf("=");

    if (separator > 0) {
      cookies[pair.slice(0, separator).trim()] = decodeURIComponent(
        pair.slice(separator + 1).trim(),
      );
    }
  }

  req.cookies = cookies;
  next();
};

export interface IdentityServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/*
 * The real core Identity feature set on a fresh Express app, on a free
 * loopback port, with what core's server (Common/Server/Utils/StartServer.ts)
 * puts around every router: cookie and body parsing in front, and the error
 * handler behind that turns a passed-on error into a JSON answer.
 */
export const startIdentityServer: () => Promise<IdentityServer> =
  async (): Promise<IdentityServer> => {
    Express.setupExpress();

    const app: ExpressApplication = Express.getExpressApp();

    app.use(parseCookies);
    app.use(ExpressJson({ limit: "50mb" }));
    app.use(ExpressUrlEncoded({ limit: "50mb", extended: true }));

    await IdentityFeatureSet.init();

    app.use(
      (
        err: Exception,
        req: ExpressRequest,
        res: ExpressResponse,
        _next: NextFunction,
      ): void => {
        Response.sendErrorResponse(req, res, err);
      },
    );

    const server: Server = createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    return {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          server.close(() => {
            resolve();
          });
        });
      },
    };
  };

export interface SsoAnswer {
  status: number;
  // Where a redirect points, or null.
  location: string | null;
  // The body, parsed when it is JSON.
  body: unknown;
}

// Sends one probe to `baseUrl` at `prefix` and reads the answer.
export const sendProbe: (
  baseUrl: string,
  prefix: string,
  probe: SsoProbe,
) => Promise<SsoAnswer> = async (
  baseUrl: string,
  prefix: string,
  probe: SsoProbe,
): Promise<SsoAnswer> => {
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = probe.cookies ? probe.cookies() : {};

  if (Object.keys(cookies).length > 0) {
    headers["cookie"] = Object.entries(cookies)
      .map(([name, value]: [string, string]) => {
        return `${name}=${encodeURIComponent(value)}`;
      })
      .join("; ");
  }

  let body: string | undefined = undefined;

  if (probe.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(probe.form).toString();
  }

  const response: globalThis.Response = await fetch(
    `${baseUrl}${prefix}${probe.path}`,
    {
      method: probe.method,
      headers,
      body: body ?? null,
      redirect: "manual",
    },
  );

  const text: string = await response.text();
  let parsed: unknown = text;

  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: keep the text.
  }

  return {
    status: response.status,
    location: response.headers.get("location"),
    body: parsed,
  };
};

// The query parameters of a mobile deep link, or null when `location` is not one.
export const readDeepLink: (
  location: string | null,
) => Record<string, string> | null = (
  location: string | null,
): Record<string, string> | null => {
  if (!location || !location.startsWith(`${MOBILE_SSO_CALLBACK_URL}?`)) {
    return null;
  }

  return Object.fromEntries(
    new URLSearchParams(location.slice(location.indexOf("?") + 1)).entries(),
  );
};

// The part of an answer a probe pins, in the shape ExpectedSsoAnswer uses.
export const describeAnswer: (answer: SsoAnswer) => ExpectedSsoAnswer = (
  answer: SsoAnswer,
): ExpectedSsoAnswer => {
  const deepLink: Record<string, string> | null = readDeepLink(answer.location);

  if (deepLink) {
    return { status: answer.status, deepLink };
  }

  return { status: answer.status, body: answer.body as JSONObject };
};

// Sends every probe at every prefix and requires each pinned answer.
export const expectEverySsoProbeAnswered: (
  baseUrl: string,
) => Promise<void> = async (baseUrl: string): Promise<void> => {
  for (const prefix of IDENTITY_PREFIXES) {
    for (const probe of SSO_ROUTE_PROBES) {
      const answer: SsoAnswer = await sendProbe(baseUrl, prefix, probe);

      expect({
        request: `${probe.method} ${prefix}${probe.path}`,
        answer: describeAnswer(answer),
      }).toEqual({
        request: `${probe.method} ${prefix}${probe.path}`,
        answer: probe.expected,
      });
    }
  }
};

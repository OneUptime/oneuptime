import {
  MOBILE_SSO_CALLBACK_URL,
  MOBILE_SSO_INTENT_TTL_SECONDS,
  buildMobileSsoErrorUrl,
  buildMobileSsoSuccessUrl,
  clearMobileSsoIntentCookie,
  getMobileSsoIntentCookieName,
  isMobileSsoRequest,
  respondToMobileSsoFailure,
  setMobileSsoIntentCookie,
} from "../../FeatureSet/Identity/Utils/MobileSso";
import ObjectID from "Common/Types/ObjectID";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * MobileSso.ts is the whole of what makes an SSO login started from the React
 * Native app different from one started in a browser, and every part of it is
 * a contract that no compiler checks.
 *
 * Two failure modes motivate this file:
 *
 *   1. A mobile login that does not END on `oneuptime://sso-callback` is a
 *      dead end. The app watches the in-app browser for that scheme; anything
 *      else - an EJS error page, a JSON body - is an unparseable web page, and
 *      the user eventually sees the login reported as "cancelled" with no
 *      reason. That is why respondToMobileSsoFailure exists and why the error
 *      deep link is tested as carefully as the success one.
 *
 *   2. The server has to still KNOW it is a mobile login many redirects later,
 *      when the identity provider hands control back. SAML carries that in
 *      RelayState, which the specification only says an IdP SHOULD echo - so
 *      the provider-scoped intent cookie is the fallback that keeps mobile
 *      users off the web dashboard. isMobileSsoRequest is tested one carrier
 *      at a time so a regression names the carrier that broke.
 *
 * These are Utils tests, like SSO.test.ts and OIDC.test.ts alongside them; the
 * route handlers in API/GlobalSSO.ts and API/GlobalOIDC.ts are thin callers.
 */

const PROVIDER_ID: ObjectID = new ObjectID("6570b1d3e2f4a5c6d7e8f901");
const OTHER_PROVIDER_ID: ObjectID = new ObjectID("6570b1d3e2f4a5c6d7e8f902");

/*
 * ---------------------------------------------------------------------------
 * Fake Express request / response.
 *
 * Deliberately NOT mocks of CookieUtil: the cookie name the callback reads has
 * to be the cookie name the login start wrote, and stubbing the layer that
 * carries it would assert the stub. These fakes record only what Express
 * itself would do, so the real CookieUtil runs in between.
 * ---------------------------------------------------------------------------
 */

interface RecordedCookieOptions {
  maxAge?: number | undefined;
  httpOnly?: boolean | undefined;
  path?: string | undefined;
  sameSite?: string | boolean | undefined;
  secure?: boolean | undefined;
}

interface RecordedCookie {
  name: string;
  value: string;
  options: RecordedCookieOptions;
}

interface FakeResponse {
  cookiesSet: Array<RecordedCookie>;
  cookiesCleared: Array<string>;
  redirectedTo: Array<string>;
  // Anything a mobile flow must never reach: a rendered page or a JSON body.
  otherCalls: Array<string>;
  express: ExpressResponse;
}

function createFakeResponse(): FakeResponse {
  const cookiesSet: Array<RecordedCookie> = [];
  const cookiesCleared: Array<string> = [];
  const redirectedTo: Array<string> = [];
  const otherCalls: Array<string> = [];

  const response: Record<string, unknown> = {};

  response["cookie"] = (
    name: string,
    value: string,
    options: RecordedCookieOptions,
  ): void => {
    cookiesSet.push({ name, value, options });
  };

  response["clearCookie"] = (name: string): void => {
    cookiesCleared.push(name);
  };

  response["redirect"] = (url: string): void => {
    redirectedTo.push(url);
  };

  response["render"] = (view: string): void => {
    otherCalls.push(`render:${view}`);
  };

  response["send"] = (): void => {
    otherCalls.push("send");
  };

  response["json"] = (): void => {
    otherCalls.push("json");
  };

  response["end"] = (): void => {
    otherCalls.push("end");
  };

  response["status"] = (code: number): unknown => {
    otherCalls.push(`status:${code}`);
    return response;
  };

  return {
    cookiesSet,
    cookiesCleared,
    redirectedTo,
    otherCalls,
    express: response as unknown as ExpressResponse,
  };
}

function expectResponseUntouched(response: FakeResponse): void {
  expect(response.redirectedTo).toEqual([]);
  expect(response.cookiesSet).toEqual([]);
  expect(response.cookiesCleared).toEqual([]);
  expect(response.otherCalls).toEqual([]);
}

interface FakeRequestData {
  query?: Record<string, string> | undefined;
  body?: Record<string, unknown> | undefined;
  cookies?: Record<string, string> | undefined;
}

/*
 * `query` is always present because Express always populates it. `body` and
 * `cookies` are omitted unless asked for: the ACS POST arrives before
 * cookie-parser on some routes, and a GET has no body at all.
 */
function createFakeRequest(data: FakeRequestData = {}): ExpressRequest {
  const request: Record<string, unknown> = {
    query: data.query ?? {},
  };

  if (data.body !== undefined) {
    request["body"] = data.body;
  }

  if (data.cookies !== undefined) {
    request["cookies"] = data.cookies;
  }

  return request as unknown as ExpressRequest;
}

// The query half of a deep link, decoded the way the app decodes it.
function paramsOf(deepLink: string): URLSearchParams {
  const queryStart: number = deepLink.indexOf("?");

  expect(queryStart).toBeGreaterThan(-1);

  return new URLSearchParams(deepLink.slice(queryStart + 1));
}

/*
 * ---------------------------------------------------------------------------
 * The intent cookie.
 * ---------------------------------------------------------------------------
 */

describe("getMobileSsoIntentCookieName", () => {
  test("derives the name from the provider id", () => {
    expect(getMobileSsoIntentCookieName(PROVIDER_ID)).toBe(
      "sso-mobile-intent-6570b1d3e2f4a5c6d7e8f901",
    );
  });

  /*
   * Two logins in flight against two providers must not read each other's
   * intent - otherwise a stale web login could be redirected into the app, or
   * a mobile login onto the web dashboard.
   */
  test("gives two different providers two different names", () => {
    expect(getMobileSsoIntentCookieName(PROVIDER_ID)).not.toBe(
      getMobileSsoIntentCookieName(OTHER_PROVIDER_ID),
    );
  });

  test("is stable across calls for the same provider", () => {
    expect(getMobileSsoIntentCookieName(PROVIDER_ID)).toBe(
      getMobileSsoIntentCookieName(new ObjectID("6570b1d3e2f4a5c6d7e8f901")),
    );
  });
});

describe("setMobileSsoIntentCookie", () => {
  test("sets exactly one cookie, under the provider-scoped name", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);

    expect(response.cookiesSet).toHaveLength(1);
    expect(response.cookiesSet[0]!.name).toBe(
      getMobileSsoIntentCookieName(PROVIDER_ID),
    );
    expect(response.cookiesSet[0]!.value).toBe("true");
  });

  /*
   * The intent is server-side bookkeeping. Nothing in the app or in page
   * JavaScript reads it, so it has no business being reachable from
   * document.cookie.
   */
  test("marks the cookie httpOnly", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);

    expect(response.cookiesSet[0]!.options.httpOnly).toBe(true);
  });

  test("sets a maxAge of MOBILE_SSO_INTENT_TTL_SECONDS in milliseconds", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);

    expect(response.cookiesSet[0]!.options.maxAge).toBe(
      MOBILE_SSO_INTENT_TTL_SECONDS * 1000,
    );
  });

  /*
   * Pinned rather than derived from the constant, because both ends of the
   * window matter: shorter than an MFA prompt plus a password manager plus a
   * push approval on another device and real logins break; much longer and a
   * stale intent can silently divert a later WEB login into the app.
   */
  test("the intent window is 15 minutes", () => {
    expect(MOBILE_SSO_INTENT_TTL_SECONDS).toBe(15 * 60);
    expect(MOBILE_SSO_INTENT_TTL_SECONDS * 1000).toBe(900000);
  });

  test("scopes the cookie to the whole site so the callback route can read it", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);

    expect(response.cookiesSet[0]!.options.path).toBe("/");
  });

  /*
   * SameSite decides whether the fallback works at all, and the two protocols
   * need different answers:
   *
   * A browser sends a SameSite=Lax cookie on a top-level cross-site GET (the
   * OIDC callback redirect) but NOT on a top-level cross-site POST - which is
   * exactly what the SAML ACS at POST /identity/global-idp-login/:id receives
   * from the identity provider. Lax would therefore lose the cookie in the one
   * flow it was added for. SameSite=None fixes that, but browsers reject
   * SameSite=None without Secure, and Secure cookies are not stored over plain
   * HTTP - so an HTTP instance has to keep the default.
   *
   * Both branches are pinned here because each one is silently wrong on the
   * other protocol, and neither failure is visible until a real IdP drops
   * RelayState.
   *
   * HttpProtocol is read from the environment once at module load, so each
   * branch re-imports the module inside jest.isolateModules with the env var
   * set.
   */
  interface MobileSsoModule {
    setMobileSsoIntentCookie: (
      res: ExpressResponse,
      providerId: ObjectID,
    ) => void;
  }

  function setIntentCookieUnderProtocol(protocol: string): RecordedCookie {
    const response: FakeResponse = createFakeResponse();
    const previousProtocol: string | undefined = process.env["HTTP_PROTOCOL"];

    process.env["HTTP_PROTOCOL"] = protocol;

    try {
      jest.isolateModules((): void => {
        /*
         * A fresh require is the point: HttpProtocol is captured from the
         * environment once, at module load, so a static import would only ever
         * exercise whichever protocol the test process started with. This is
         * the one place in the file where require() is the right tool.
         */
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const freshModule: MobileSsoModule = require("../../FeatureSet/Identity/Utils/MobileSso");
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        freshModule.setMobileSsoIntentCookie(response.express, PROVIDER_ID);
      });
    } finally {
      if (previousProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = previousProtocol;
      }
    }

    return response.cookiesSet[0]!;
  }

  test("on an https instance the cookie is SameSite=None and Secure, so the SAML cross-site POST carries it", () => {
    const cookie: RecordedCookie = setIntentCookieUnderProtocol("https");

    expect(cookie.options.sameSite).toBe("none");
    expect(cookie.options.secure).toBe(true);
  });

  test("on a plain http instance the cookie keeps the Lax default, because a Secure cookie would not be stored at all", () => {
    const cookie: RecordedCookie = setIntentCookieUnderProtocol("http");

    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.secure).toBeUndefined();
  });

  test("stays httpOnly on both protocols", () => {
    expect(setIntentCookieUnderProtocol("https").options.httpOnly).toBe(true);
    expect(setIntentCookieUnderProtocol("http").options.httpOnly).toBe(true);
  });

  test("writes different cookies for different providers", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);
    setMobileSsoIntentCookie(response.express, OTHER_PROVIDER_ID);

    expect(
      response.cookiesSet.map((cookie: RecordedCookie): string => {
        return cookie.name;
      }),
    ).toEqual([
      "sso-mobile-intent-6570b1d3e2f4a5c6d7e8f901",
      "sso-mobile-intent-6570b1d3e2f4a5c6d7e8f902",
    ]);
  });
});

describe("clearMobileSsoIntentCookie", () => {
  test("removes the same cookie name that setMobileSsoIntentCookie wrote", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);
    clearMobileSsoIntentCookie(response.express, PROVIDER_ID);

    expect(response.cookiesCleared).toEqual([response.cookiesSet[0]!.name]);
  });

  test("only clears the provider it was asked about", () => {
    const response: FakeResponse = createFakeResponse();

    clearMobileSsoIntentCookie(response.express, PROVIDER_ID);

    expect(response.cookiesCleared).toEqual([
      "sso-mobile-intent-6570b1d3e2f4a5c6d7e8f901",
    ]);
    expect(response.cookiesCleared).not.toContain(
      "sso-mobile-intent-6570b1d3e2f4a5c6d7e8f902",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * isMobileSsoRequest - one test per carrier.
 * ---------------------------------------------------------------------------
 */

describe("isMobileSsoRequest", () => {
  // The SP-initiated entry point: the app opens /login?mobile=true itself.
  test("recognises the mobile=true query parameter", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({ query: { mobile: "true" } }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(true);
  });

  test("does not recognise mobile=false", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({ query: { mobile: "false" } }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(false);
  });

  /*
   * The ACS POST: a SAML IdP echoes RelayState back in the form body, which is
   * how a browser-driven, cross-site POST carries our state.
   */
  test("recognises RelayState=mobile echoed back in the POST body", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({
          body: { SAMLResponse: "PHNhbWw+", RelayState: "mobile" },
        }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(true);
  });

  // Some providers (and the OIDC redirect leg) put it back on the query.
  test("recognises RelayState=mobile on the query string", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({ query: { RelayState: "mobile" } }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(true);
  });

  test("ignores a RelayState that is not ours", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({
          body: { RelayState: "https://oneuptime.com/dashboard" },
        }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(false);
  });

  /*
   * The reason this helper exists. RelayState is only a SHOULD in the SAML
   * specification: providers drop it, truncate it, or refuse to echo it on
   * IdP-initiated flows. When that happens the cookie is the only thing left
   * saying "this login belongs to the app", and without it the user's in-app
   * browser lands on the web dashboard where the app can never retrieve the
   * session.
   */
  test("falls back to the intent cookie when the IdP dropped RelayState", () => {
    const cookieName: string = getMobileSsoIntentCookieName(PROVIDER_ID);

    expect(
      isMobileSsoRequest({
        req: createFakeRequest({
          body: { SAMLResponse: "PHNhbWw+" },
          cookies: { [cookieName]: "true" },
        }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(true);
  });

  // The set/read pair has to agree end to end, not just by inspection.
  test("reads back the cookie setMobileSsoIntentCookie actually wrote", () => {
    const response: FakeResponse = createFakeResponse();

    setMobileSsoIntentCookie(response.express, PROVIDER_ID);

    const written: RecordedCookie = response.cookiesSet[0]!;

    expect(
      isMobileSsoRequest({
        req: createFakeRequest({
          cookies: { [written.name]: written.value },
        }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(true);
  });

  // Cross-talk guard: provider B's callback must not see provider A's intent.
  test("ignores an intent cookie belonging to a different provider", () => {
    const otherProviderCookie: string =
      getMobileSsoIntentCookieName(OTHER_PROVIDER_ID);

    expect(
      isMobileSsoRequest({
        req: createFakeRequest({
          cookies: { [otherProviderCookie]: "true" },
        }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(false);
  });

  test("returns false when no carrier is present at all", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({ query: {}, body: {}, cookies: {} }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(false);
  });

  /*
   * Callers that have not resolved the provider yet (the outermost catch in
   * GlobalSSO.ts, for instance) pass no providerId. The cookie cannot be
   * looked up without one, so the answer must be a plain false rather than a
   * throw or a name built from "undefined".
   */
  test("returns false for a cookie carrier when no providerId was passed", () => {
    const cookieName: string = getMobileSsoIntentCookieName(PROVIDER_ID);

    expect(
      isMobileSsoRequest({
        req: createFakeRequest({ cookies: { [cookieName]: "true" } }),
      }),
    ).toBe(false);
  });

  test("still honours RelayState when no providerId was passed", () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({ body: { RelayState: "mobile" } }),
      }),
    ).toBe(true);
  });

  /*
   * A GET callback has no body, and a route that runs before cookie-parser has
   * no req.cookies. Both are ordinary, and neither may throw - a throw here
   * would take down the error handler that is itself trying to report a
   * failure to the app.
   */
  test("does not throw on a request with no body and no cookies", () => {
    const req: ExpressRequest = createFakeRequest();

    expect((): boolean => {
      return isMobileSsoRequest({ req, providerId: PROVIDER_ID });
    }).not.toThrow();

    expect(isMobileSsoRequest({ req, providerId: PROVIDER_ID })).toBe(false);
  });

  test("does not throw on a request with no body and no cookies and no providerId", () => {
    expect((): boolean => {
      return isMobileSsoRequest({ req: createFakeRequest() });
    }).not.toThrow();
  });

  // A body that is not an object at all (a raw string body parser, say).
  test("does not throw when the body is not an object", () => {
    const req: ExpressRequest = createFakeRequest({
      body: "SAMLResponse=PHNhbWw%2B" as unknown as Record<string, unknown>,
    });

    expect((): boolean => {
      return isMobileSsoRequest({ req, providerId: PROVIDER_ID });
    }).not.toThrow();

    expect(isMobileSsoRequest({ req, providerId: PROVIDER_ID })).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The error deep link.
 * ---------------------------------------------------------------------------
 */

describe("buildMobileSsoErrorUrl", () => {
  test("always starts with the app's callback scheme", () => {
    expect(buildMobileSsoErrorUrl("sso_login_failed")).toContain(
      "oneuptime://sso-callback",
    );
    expect(
      buildMobileSsoErrorUrl("sso_login_failed").startsWith(
        "oneuptime://sso-callback?",
      ),
    ).toBe(true);
    expect(MOBILE_SSO_CALLBACK_URL).toBe("oneuptime://sso-callback");
  });

  test("carries the error code", () => {
    expect(
      paramsOf(buildMobileSsoErrorUrl("no_project_access")).get("error"),
    ).toBe("no_project_access");
  });

  test("carries the description when one is given", () => {
    const params: URLSearchParams = paramsOf(
      buildMobileSsoErrorUrl(
        "no_project_access",
        "You are not a member of any project.",
      ),
    );

    expect(params.get("error")).toBe("no_project_access");
    expect(params.get("errorDescription")).toBe(
      "You are not a member of any project.",
    );
  });

  test("omits the description entirely when none is given", () => {
    const url: string = buildMobileSsoErrorUrl("sso_login_failed");

    expect(url).toBe("oneuptime://sso-callback?error=sso_login_failed");
    expect(url).not.toContain("errorDescription");
    expect(paramsOf(url).has("errorDescription")).toBe(false);
  });

  test("omits an empty description rather than emitting a dangling parameter", () => {
    expect(buildMobileSsoErrorUrl("sso_login_failed", "")).toBe(
      "oneuptime://sso-callback?error=sso_login_failed",
    );
  });

  /*
   * An IdP's own error text is arbitrary prose and lands here verbatim. The
   * ampersand is the dangerous character: un-encoded it would start a new
   * parameter, so a provider could inject `&accessToken=...` into a URL the
   * app is about to trust. Spaces serialise to "+" (this is
   * application/x-www-form-urlencoded, not a path), which the app's
   * parseQueryString turns back into spaces.
   */
  test("encodes spaces, punctuation and an ampersand so they cannot break the query", () => {
    const description: string =
      "Token exchange failed: invalid_client & the state was lost (retry?)";

    const url: string = buildMobileSsoErrorUrl("oidc_error", description);

    expect(url).toBe(
      "oneuptime://sso-callback?error=oidc_error&errorDescription=" +
        "Token+exchange+failed%3A+invalid_client+%26+the+state+was+lost+%28retry%3F%29",
    );

    // No raw space, and exactly one "&" - the separator before errorDescription.
    expect(url).not.toContain(" ");
    expect(url.split("&")).toHaveLength(2);

    // And it round-trips back to the original sentence.
    expect(paramsOf(url).get("errorDescription")).toBe(description);
  });

  test("an injected parameter in the description stays inside the description", () => {
    const url: string = buildMobileSsoErrorUrl(
      "saml_error",
      "denied&accessToken=attacker-token",
    );

    const params: URLSearchParams = paramsOf(url);

    expect(params.has("accessToken")).toBe(false);
    expect(params.get("errorDescription")).toBe(
      "denied&accessToken=attacker-token",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * respondToMobileSsoFailure.
 * ---------------------------------------------------------------------------
 */

describe("respondToMobileSsoFailure", () => {
  /*
   * The web branch must be left completely alone: callers are written as
   * `if (respondToMobileSsoFailure(...)) { return; }` and then fall through to
   * rendering the ordinary error page. Sending anything here would be a
   * double response.
   */
  test("returns false and does not touch the response for a web login", () => {
    const response: FakeResponse = createFakeResponse();

    const handled: boolean = respondToMobileSsoFailure({
      res: response.express,
      isMobileRequest: false,
      error: "sso_login_failed",
      errorDescription: "Something went wrong.",
    });

    expect(handled).toBe(false);
    expectResponseUntouched(response);
  });

  test("returns true and redirects to the error deep link for a mobile login", () => {
    const response: FakeResponse = createFakeResponse();

    const handled: boolean = respondToMobileSsoFailure({
      res: response.express,
      isMobileRequest: true,
      error: "no_project_access",
      errorDescription: "You are not a member of any project.",
    });

    expect(handled).toBe(true);
    expect(response.redirectedTo).toEqual([
      buildMobileSsoErrorUrl(
        "no_project_access",
        "You are not a member of any project.",
      ),
    ]);
  });

  test("redirects rather than rendering a page or sending JSON", () => {
    const response: FakeResponse = createFakeResponse();

    respondToMobileSsoFailure({
      res: response.express,
      isMobileRequest: true,
      error: "sso_login_failed",
    });

    expect(response.redirectedTo).toHaveLength(1);
    expect(response.otherCalls).toEqual([]);
    expect(
      response.redirectedTo[0]!.startsWith("oneuptime://sso-callback?"),
    ).toBe(true);
  });

  test("passes an absent description through as an absent parameter", () => {
    const response: FakeResponse = createFakeResponse();

    respondToMobileSsoFailure({
      res: response.express,
      isMobileRequest: true,
      error: "sso_login_failed",
    });

    expect(response.redirectedTo[0]).toBe(
      "oneuptime://sso-callback?error=sso_login_failed",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The success deep link.
 * ---------------------------------------------------------------------------
 */

const EXPIRES_AT: Date = new Date("2026-09-19T12:34:56.789Z");

interface SuccessOverrides {
  globalSsoToken?: string | undefined;
  ssoToken?: string | undefined;
  projectId?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  isMasterAdmin?: boolean | undefined;
}

function buildSuccess(overrides: SuccessOverrides = {}): string {
  return buildMobileSsoSuccessUrl({
    accessToken: "access-token-value",
    refreshToken: "refresh-token-value",
    refreshTokenExpiresAt: EXPIRES_AT,
    userId: "65f1c2d3e4b5a67890abcdef",
    email: overrides.email ?? "jane.doe@example.com",
    name: overrides.name ?? "JaneDoe",
    isMasterAdmin: overrides.isMasterAdmin ?? false,
    globalSsoToken: overrides.globalSsoToken,
    ssoToken: overrides.ssoToken,
    projectId: overrides.projectId,
  });
}

describe("buildMobileSsoSuccessUrl", () => {
  test("starts with the app's callback scheme", () => {
    expect(buildSuccess().startsWith("oneuptime://sso-callback?")).toBe(true);
  });

  test("carries every param the app needs to establish a session", () => {
    const params: URLSearchParams = paramsOf(buildSuccess());

    expect(params.get("accessToken")).toBe("access-token-value");
    expect(params.get("refreshToken")).toBe("refresh-token-value");
    expect(params.get("userId")).toBe("65f1c2d3e4b5a67890abcdef");
    expect(params.get("email")).toBe("jane.doe@example.com");
    expect(params.get("name")).toBe("JaneDoe");
    expect(params.get("isMasterAdmin")).toBe("false");
  });

  /*
   * The app stores this and refreshes against it; it has to be a format
   * JavaScript can parse on the other side, not a locale-dependent Date
   * toString.
   */
  test("serialises refreshTokenExpiresAt as ISO-8601 UTC", () => {
    const value: string = paramsOf(buildSuccess()).get(
      "refreshTokenExpiresAt",
    ) as string;

    expect(value).toBe("2026-09-19T12:34:56.789Z");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(value).getTime()).toBe(EXPIRES_AT.getTime());
  });

  test('isMasterAdmin serialises as the string "true"', () => {
    expect(
      paramsOf(buildSuccess({ isMasterAdmin: true })).get("isMasterAdmin"),
    ).toBe("true");
  });

  test('isMasterAdmin serialises as the string "false"', () => {
    expect(
      paramsOf(buildSuccess({ isMasterAdmin: false })).get("isMasterAdmin"),
    ).toBe("false");
  });

  test("includes globalSsoToken when one is given", () => {
    expect(
      paramsOf(buildSuccess({ globalSsoToken: "global-token" })).get(
        "globalSsoToken",
      ),
    ).toBe("global-token");
  });

  test("omits globalSsoToken when none is given", () => {
    const url: string = buildSuccess();

    expect(url).not.toContain("globalSsoToken");
    expect(paramsOf(url).has("globalSsoToken")).toBe(false);
  });

  /*
   * A project SSO token is meaningless without the project it belongs to - the
   * app pairs them. Emitting half the pair would produce a token the app
   * cannot file anywhere.
   */
  test("includes ssoToken and projectId when both are given", () => {
    const params: URLSearchParams = paramsOf(
      buildSuccess({
        ssoToken: "project-sso-token",
        projectId: "65a0000000000000000000ff",
      }),
    );

    expect(params.get("ssoToken")).toBe("project-sso-token");
    expect(params.get("projectId")).toBe("65a0000000000000000000ff");
  });

  test("omits both when only ssoToken is given", () => {
    const params: URLSearchParams = paramsOf(
      buildSuccess({ ssoToken: "project-sso-token" }),
    );

    expect(params.has("ssoToken")).toBe(false);
    expect(params.has("projectId")).toBe(false);
  });

  test("omits both when only projectId is given", () => {
    const params: URLSearchParams = paramsOf(
      buildSuccess({ projectId: "65a0000000000000000000ff" }),
    );

    expect(params.has("ssoToken")).toBe(false);
    expect(params.has("projectId")).toBe(false);
  });

  test("omits both when neither is given", () => {
    const url: string = buildSuccess();

    expect(url).not.toContain("ssoToken");
    expect(url).not.toContain("projectId");
  });

  /*
   * A plus-addressed mailbox is the value where an encoding mistake is
   * invisible in testing and obvious in production: the app decodes "+" back
   * to a space, so the address only survives because it went out as "%2B".
   */
  test("encodes an email containing + and @", () => {
    const url: string = buildSuccess({ email: "jane.doe+oncall@example.com" });

    expect(url).toContain("email=jane.doe%2Boncall%40example.com");
    expect(paramsOf(url).get("email")).toBe("jane.doe+oncall@example.com");
  });

  test("encodes a name containing a space", () => {
    const url: string = buildSuccess({ name: "Jane Doe" });

    expect(url).toContain("name=Jane+Doe");
    expect(url).not.toContain("name=Jane Doe");
    expect(url).not.toContain(" ");
    expect(paramsOf(url).get("name")).toBe("Jane Doe");
  });

  test("encodes a name containing an ampersand instead of starting a new param", () => {
    const url: string = buildSuccess({ name: "Ben & Jerry" });

    const params: URLSearchParams = paramsOf(url);

    expect(params.get("name")).toBe("Ben & Jerry");
    expect(params.has("Jerry")).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The contract with the app.
 *
 * PARSER ON THE OTHER SIDE:  MobileApp/src/sso/callbackUrl.ts
 * ITS TESTS:                 MobileApp/src/sso/callbackUrl.test.ts
 *
 * Those two files consume exactly the strings asserted below - the fixtures
 * there and the literals here are the same bytes, on purpose. Nothing
 * type-checks across this boundary: the two sides only ever meet as a string
 * handed to the OS at the end of a redirect chain, on a handset, after a real
 * IdP login. A drift in a param name or in the encoding is neither a compile
 * error nor a runtime error - it is a login that ends on a blank screen.
 *
 * If a literal below has to change, the matching fixture in
 * MobileApp/src/sso/callbackUrl.test.ts has to change with it, or one side is
 * shipping a format the other cannot read.
 * ---------------------------------------------------------------------------
 */

/*
 * An OIDC `error` / `error_description` is written by the identity provider,
 * so it is neither trusted nor bounded. A pathologically long one would build
 * a deep link the OS may refuse to hand back to the app - turning a failure
 * the user could have READ into the silent dead end this module exists to
 * prevent.
 */
describe("identity-provider text in an error deep link is bounded", () => {
  test("a very long error code is truncated", () => {
    const url: string = buildMobileSsoErrorUrl("e".repeat(5000));

    const value: string = new URL(url).searchParams.get("error")!;

    expect(value).toHaveLength(512);
  });

  test("a very long description is truncated", () => {
    const url: string = buildMobileSsoErrorUrl(
      "access_denied",
      "d".repeat(5000),
    );

    const params: URLSearchParams = new URL(url).searchParams;

    expect(params.get("error")).toBe("access_denied");
    expect(params.get("errorDescription")).toHaveLength(512);
  });

  test("an ordinary identity-provider message is left exactly as it is", () => {
    const description: string =
      "The resource owner or authorized server denied the request.";

    const url: string = buildMobileSsoErrorUrl("access_denied", description);

    expect(new URL(url).searchParams.get("errorDescription")).toBe(description);
  });

  test("truncation still leaves a URL the app can parse", () => {
    const url: string = buildMobileSsoErrorUrl(
      "access_denied",
      "%".repeat(5000),
    );

    // Percent-encoding happens after the clamp, so the URL stays well-formed.
    expect(url.startsWith(`${MOBILE_SSO_CALLBACK_URL}?`)).toBe(true);
    expect(new URL(url).searchParams.get("errorDescription")).toBe(
      "%".repeat(512),
    );
  });
});

describe("the deep-link contract with MobileApp/src/sso/callbackUrl.ts", () => {
  const ACCESS_TOKEN: string =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NWYxYzJkM2U0YjVhNjc4OTBhYmNkZWYiLCJlbWFpbCI6ImphbmUuZG9lQGV4YW1wbGUuY29tIn0.s0m3-S1gn4tur3_V4lu3";
  const REFRESH_TOKEN: string =
    "eyJhbGciOiJIUzI1NiJ9.cmVmcmVzaA.r3fr3sh-S1gn4tur3_V4lu3";
  const GLOBAL_SSO_TOKEN: string =
    "eyJhbGciOiJIUzI1NiJ9.Z2xvYmFsLXNzby10b2tlbg.gl0b4l-S1gn4tur3_V4lu3";

  test("a Global SSO success URL has exactly the shape the app parses", () => {
    const url: string = buildMobileSsoSuccessUrl({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: new Date("2026-09-19T12:34:56.789Z"),
      userId: "65f1c2d3e4b5a67890abcdef",
      email: "jane.doe+oncall@example.com",
      name: "Jane Doe",
      isMasterAdmin: true,
      globalSsoToken: GLOBAL_SSO_TOKEN,
    });

    expect(url).toBe(
      "oneuptime://sso-callback?" +
        "accessToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NWYxYzJkM2U0YjVhNjc4OTBhYmNkZWYiLCJlbWFpbCI6ImphbmUuZG9lQGV4YW1wbGUuY29tIn0.s0m3-S1gn4tur3_V4lu3" +
        "&refreshToken=eyJhbGciOiJIUzI1NiJ9.cmVmcmVzaA.r3fr3sh-S1gn4tur3_V4lu3" +
        "&refreshTokenExpiresAt=2026-09-19T12%3A34%3A56.789Z" +
        "&userId=65f1c2d3e4b5a67890abcdef" +
        "&email=jane.doe%2Boncall%40example.com" +
        "&name=Jane+Doe" +
        "&isMasterAdmin=true" +
        "&globalSsoToken=eyJhbGciOiJIUzI1NiJ9.Z2xvYmFsLXNzby10b2tlbg.gl0b4l-S1gn4tur3_V4lu3",
    );
  });

  test("a project SSO success URL has exactly the shape the app parses", () => {
    const url: string = buildMobileSsoSuccessUrl({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: new Date("2026-09-19T12:34:56.789Z"),
      userId: "65f1c2d3e4b5a67890abcdef",
      email: "jane.doe+oncall@example.com",
      name: "Jane Doe",
      isMasterAdmin: true,
      ssoToken: "eyJhbGciOiJIUzI1NiJ9.cHJvamVjdC1zc28.pr0j3ct-S1gn4tur3_V4lu3",
      projectId: "65a0000000000000000000ff",
    });

    expect(url).toBe(
      "oneuptime://sso-callback?" +
        "accessToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NWYxYzJkM2U0YjVhNjc4OTBhYmNkZWYiLCJlbWFpbCI6ImphbmUuZG9lQGV4YW1wbGUuY29tIn0.s0m3-S1gn4tur3_V4lu3" +
        "&refreshToken=eyJhbGciOiJIUzI1NiJ9.cmVmcmVzaA.r3fr3sh-S1gn4tur3_V4lu3" +
        "&refreshTokenExpiresAt=2026-09-19T12%3A34%3A56.789Z" +
        "&userId=65f1c2d3e4b5a67890abcdef" +
        "&email=jane.doe%2Boncall%40example.com" +
        "&name=Jane+Doe" +
        "&isMasterAdmin=true" +
        "&ssoToken=eyJhbGciOiJIUzI1NiJ9.cHJvamVjdC1zc28.pr0j3ct-S1gn4tur3_V4lu3" +
        "&projectId=65a0000000000000000000ff",
    );
  });

  test("an error URL has exactly the shape the app parses", () => {
    expect(
      buildMobileSsoErrorUrl(
        "no_project_access",
        "You are not a member of any project. Please contact your administrator.",
      ),
    ).toBe(
      "oneuptime://sso-callback?error=no_project_access&errorDescription=" +
        "You+are+not+a+member+of+any+project.+Please+contact+your+administrator.",
    );
  });

  test("a bare error URL has exactly the shape the app parses", () => {
    expect(buildMobileSsoErrorUrl("sso_login_failed")).toBe(
      "oneuptime://sso-callback?error=sso_login_failed",
    );
  });
});

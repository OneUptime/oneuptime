import {
  SSO_CALLBACK_URL,
  SsoCallbackResult,
  isSsoCallbackUrl,
  parseQueryString,
  parseSsoCallbackUrl,
} from "./callbackUrl";
import { describe, expect, test } from "@jest/globals";

/*
 * This module is one half of a contract; the other half is
 * App/FeatureSet/Identity/Utils/MobileSso.ts (buildMobileSsoSuccessUrl /
 * buildMobileSsoErrorUrl). Nothing type-checks across that boundary - the two
 * sides only ever meet as a string handed to the OS at the end of a browser
 * redirect chain, on a real handset, after a real IdP login. A drift in a
 * param name or in the encoding is not a compile error and not a runtime
 * error: it is a login that ends on a blank screen.
 *
 * So the fixtures below are not invented. They are byte-for-byte what the
 * server emits, including the fact that it serialises through URLSearchParams
 * (space -> "+", ":" -> "%3A", "@" -> "%40"), and "the wire format is exactly
 * what the server builds" below re-derives one of them through the server's
 * own algorithm so a fixture cannot quietly stop being realistic.
 */

// The pieces, decoded, exactly as the app must end up seeing them.
const ACCESS_TOKEN: string =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NWYxYzJkM2U0YjVhNjc4OTBhYmNkZWYiLCJlbWFpbCI6ImphbmUuZG9lQGV4YW1wbGUuY29tIn0.s0m3-S1gn4tur3_V4lu3";
const REFRESH_TOKEN: string =
  "eyJhbGciOiJIUzI1NiJ9.cmVmcmVzaA.r3fr3sh-S1gn4tur3_V4lu3";
const EXPIRES_AT: string = "2026-09-19T12:34:56.789Z";
const GLOBAL_SSO_TOKEN: string =
  "eyJhbGciOiJIUzI1NiJ9.Z2xvYmFsLXNzby10b2tlbg.gl0b4l-S1gn4tur3_V4lu3";
const PROJECT_SSO_TOKEN: string =
  "eyJhbGciOiJIUzI1NiJ9.cHJvamVjdC1zc28.pr0j3ct-S1gn4tur3_V4lu3";
const USER_ID: string = "65f1c2d3e4b5a67890abcdef";
const PROJECT_ID: string = "65a0000000000000000000ff";
/*
 * A plus-addressed mailbox. It is the one value in the whole callback where a
 * decoding mistake is invisible in testing and obvious in production: the
 * parser turns a literal "+" into a space, so this only survives because the
 * server percent-encoded it to "%2B" first.
 */
const EMAIL: string = "jane.doe+oncall@example.com";
const NAME: string = "Jane Doe";

// The same pieces as they appear on the wire.
const ENCODED_EXPIRES_AT: string = "2026-09-19T12%3A34%3A56.789Z";
const ENCODED_EMAIL: string = "jane.doe%2Boncall%40example.com";
const ENCODED_NAME: string = "Jane+Doe";

const AUTH_PARAMS: string = `accessToken=${ACCESS_TOKEN}&refreshToken=${REFRESH_TOKEN}&refreshTokenExpiresAt=${ENCODED_EXPIRES_AT}`;
const USER_PARAMS: string = `userId=${USER_ID}&email=${ENCODED_EMAIL}&name=${ENCODED_NAME}&isMasterAdmin=true`;

// Global SSO / Global OIDC: instance-wide, no project attached.
const GLOBAL_SUCCESS_URL: string = `oneuptime://sso-callback?${AUTH_PARAMS}&${USER_PARAMS}&globalSsoToken=${GLOBAL_SSO_TOKEN}`;

// Project SSO: a token bound to exactly one project, no global token.
const PROJECT_SUCCESS_URL: string = `oneuptime://sso-callback?${AUTH_PARAMS}&${USER_PARAMS}&ssoToken=${PROJECT_SSO_TOKEN}&projectId=${PROJECT_ID}`;

type SsoSuccessResult = Extract<SsoCallbackResult, { status: "success" }>;
type SsoMessageResult = Extract<
  SsoCallbackResult,
  { status: "error" | "invalid" }
>;

function expectSuccess(url: string): SsoSuccessResult {
  const result: SsoCallbackResult = parseSsoCallbackUrl(url);

  expect(result.status).toBe("success");

  return result as SsoSuccessResult;
}

function expectStatus(
  url: string,
  status: "error" | "invalid",
): SsoMessageResult {
  const result: SsoCallbackResult = parseSsoCallbackUrl(url);

  expect(result.status).toBe(status);

  return result as SsoMessageResult;
}

describe("isSsoCallbackUrl filters the app-wide Linking stream", () => {
  /*
   * Every deep link the OS hands the app arrives on one stream - push
   * notification taps, universal links, the SSO callback. This predicate is
   * the only thing separating them, so it has to be exact in both directions:
   * too loose and an unrelated link is consumed as a failed login, too tight
   * and a real login is dropped on the floor.
   */

  test("accepts the exact callback the server redirects to", () => {
    expect(isSsoCallbackUrl(SSO_CALLBACK_URL)).toBe(true);
    expect(isSsoCallbackUrl("oneuptime://sso-callback")).toBe(true);
  });

  test("accepts the trailing-slash form the OS sometimes normalises to", () => {
    expect(isSsoCallbackUrl("oneuptime://sso-callback/")).toBe(true);
  });

  test("accepts the real thing, which always carries a query string", () => {
    expect(isSsoCallbackUrl(GLOBAL_SUCCESS_URL)).toBe(true);
    expect(
      isSsoCallbackUrl("oneuptime://sso-callback?error=sso_login_failed"),
    ).toBe(true);
  });

  test("accepts the trailing slash and a query together", () => {
    expect(
      isSsoCallbackUrl("oneuptime://sso-callback/?error=sso_login_failed"),
    ).toBe(true);
  });

  test("rejects another host under the app's own scheme", () => {
    /*
     * The app owns the whole `oneuptime://` scheme, so its own navigation
     * links come through here too. Treating one as a callback would abort a
     * perfectly healthy login screen.
     */
    expect(isSsoCallbackUrl("oneuptime://home")).toBe(false);
    expect(isSsoCallbackUrl("oneuptime://alert/65f1c2d3e4b5a67890abcdef")).toBe(
      false,
    );
  });

  test("rejects a host that merely starts with the same letters", () => {
    expect(isSsoCallbackUrl("oneuptime://sso-callback-other")).toBe(false);
    expect(
      isSsoCallbackUrl("oneuptime://sso-callback-other?accessToken=a"),
    ).toBe(false);
    expect(isSsoCallbackUrl("oneuptime://sso-callbackx")).toBe(false);
  });

  test("rejects the same path under a different scheme", () => {
    /*
     * A hostile app can register a lookalike scheme, and the web dashboard
     * serves a same-named path over https. Neither is this app's callback.
     */
    expect(isSsoCallbackUrl("https://oneuptime.com/sso-callback")).toBe(false);
    expect(isSsoCallbackUrl("oneuptimex://sso-callback")).toBe(false);
    expect(isSsoCallbackUrl("exp://127.0.0.1:8081/sso-callback")).toBe(false);
  });

  test("rejects nothing at all", () => {
    // Linking.getInitialURL() resolves to null on a cold start with no link.
    expect(isSsoCallbackUrl(null)).toBe(false);
    expect(isSsoCallbackUrl(undefined)).toBe(false);
    expect(isSsoCallbackUrl("")).toBe(false);
  });

  test("ignores a fragment the way it ignores a query", () => {
    expect(isSsoCallbackUrl("oneuptime://sso-callback#done")).toBe(true);
  });
});

describe("parseQueryString", () => {
  test("splits ordinary pairs", () => {
    expect(parseQueryString("error=denied&errorDescription=nope")).toEqual({
      error: "denied",
      errorDescription: "nope",
    });
  });

  test("tolerates the leading question mark", () => {
    expect(parseQueryString("?error=denied")).toEqual({ error: "denied" });
  });

  test("percent-decodes keys as well as values", () => {
    expect(parseQueryString("error%44escription=late")).toEqual({
      errorDescription: "late",
    });
  });

  test("decodes an ISO-8601 timestamp back to its colons", () => {
    /*
     * URLSearchParams escapes ":" to "%3A", so the expiry the server put on
     * the wire is not the string the app needs. Leaving it encoded produces a
     * Date of NaN, and a session whose expiry is NaN is never refreshed.
     */
    expect(
      parseQueryString(`refreshTokenExpiresAt=${ENCODED_EXPIRES_AT}`),
    ).toEqual({ refreshTokenExpiresAt: EXPIRES_AT });
  });

  test("decodes an email's @ and +", () => {
    expect(parseQueryString(`email=${ENCODED_EMAIL}`)).toEqual({
      email: EMAIL,
    });
  });

  test('decodes a literal "+" as a space', () => {
    // Form encoding, which is what URLSearchParams emits for a display name.
    expect(parseQueryString("name=Jane+Doe")).toEqual({ name: "Jane Doe" });
  });

  test("keeps a value containing an un-encoded = intact", () => {
    /*
     * Only the FIRST "=" separates the pair. A base64 token carries its own
     * padding "="; splitting on every "=" would truncate it to something the
     * server rejects on the next request.
     */
    expect(
      parseQueryString("ssoToken=YWJjZGVmZ2hpamtsbW5vcA==&projectId=p1"),
    ).toEqual({
      ssoToken: "YWJjZGVmZ2hpamtsbW5vcA==",
      projectId: "p1",
    });
  });

  test("gives a key with no = an empty-string value", () => {
    expect(parseQueryString("mobile&error=denied")).toEqual({
      mobile: "",
      error: "denied",
    });
  });

  test("keeps the FIRST value of a repeated key", () => {
    /*
     * Matches URLSearchParams.get(). It matters because a redirect chain can
     * append a param the IdP already set; taking the last value would let the
     * outer hop overwrite what the server signed.
     */
    expect(parseQueryString("projectId=first&projectId=second")).toEqual({
      projectId: "first",
    });
  });

  test("returns an empty map for an empty query", () => {
    expect(parseQueryString("")).toEqual({});
    expect(parseQueryString("?")).toEqual({});
  });

  test("skips empty pairs rather than inventing empty keys", () => {
    expect(parseQueryString("a=1&&b=2&")).toEqual({ a: "1", b: "2" });
    expect(parseQueryString("=orphan&a=1")).toEqual({ a: "1" });
  });

  test("does not throw on a malformed percent escape", () => {
    /*
     * decodeURIComponent throws on a lone "%", and an IdP error sentence can
     * easily contain one ("100% of assertions failed"). A throw here would
     * escape parseSsoCallbackUrl and crash the callback handler, turning a
     * message the user could act on into a frozen browser sheet - so the value
     * degrades to its raw text instead.
     */
    expect(() => {
      return parseQueryString("errorDescription=signature+%+mismatch");
    }).not.toThrow();

    expect(parseQueryString("errorDescription=signature+%+mismatch")).toEqual({
      errorDescription: "signature % mismatch",
    });
  });

  test("falls back on a malformed escape in the KEY too", () => {
    expect(parseQueryString("%zz=value")).toEqual({ "%zz": "value" });
  });

  test("decodes a properly escaped percent sign", () => {
    expect(parseQueryString("errorDescription=100%25+failed")).toEqual({
      errorDescription: "100% failed",
    });
  });
});

describe("parseSsoCallbackUrl: Global SSO success", () => {
  test("reports success", () => {
    expect(parseSsoCallbackUrl(GLOBAL_SUCCESS_URL).status).toBe("success");
  });

  test("returns the auth tokens exactly as the server signed them", () => {
    const result: SsoSuccessResult = expectSuccess(GLOBAL_SUCCESS_URL);

    expect(result.tokens.accessToken).toBe(ACCESS_TOKEN);
    expect(result.tokens.refreshToken).toBe(REFRESH_TOKEN);
    expect(result.tokens.refreshTokenExpiresAt).toBe(EXPIRES_AT);
  });

  test("carries the global token and no project token", () => {
    /*
     * The whole point of Global SSO: one instance-wide token satisfies SSO
     * enforcement for every project the user belongs to, so there is nothing
     * project-scoped to store.
     */
    const result: SsoSuccessResult = expectSuccess(GLOBAL_SUCCESS_URL);

    expect(result.globalSsoToken).toBe(GLOBAL_SSO_TOKEN);
    expect(result.projectSsoToken).toBeNull();
  });

  test("populates the signed-in user", () => {
    const result: SsoSuccessResult = expectSuccess(GLOBAL_SUCCESS_URL);

    expect(result.user).toEqual({
      userId: USER_ID,
      email: EMAIL,
      name: NAME,
      isMasterAdmin: true,
    });
  });

  test('parses isMasterAdmin="true" as the boolean true', () => {
    expect(expectSuccess(GLOBAL_SUCCESS_URL).user?.isMasterAdmin).toBe(true);
  });

  test('parses isMasterAdmin="false" as the boolean false, not a truthy string', () => {
    /*
     * The server sends String(boolean), so this arrives as the four characters
     * "false". Handing that straight through would be truthy and would show a
     * normal user the admin surface.
     */
    const result: SsoSuccessResult = expectSuccess(
      GLOBAL_SUCCESS_URL.replace("isMasterAdmin=true", "isMasterAdmin=false"),
    );

    expect(result.user?.isMasterAdmin).toBe(false);
  });

  test("defaults isMasterAdmin to false when the param is missing entirely", () => {
    const result: SsoSuccessResult = expectSuccess(
      GLOBAL_SUCCESS_URL.replace("&isMasterAdmin=true", ""),
    );

    expect(result.user?.isMasterAdmin).toBe(false);
  });

  test("only the exact string true grants admin", () => {
    // Fail closed: anything the server did not literally send is not admin.
    const result: SsoSuccessResult = expectSuccess(
      GLOBAL_SUCCESS_URL.replace("isMasterAdmin=true", "isMasterAdmin=TRUE"),
    );

    expect(result.user?.isMasterAdmin).toBe(false);
  });

  test("succeeds with no user block when userId is absent", () => {
    /*
     * The tokens are what actually authenticate the session; the profile is a
     * convenience the app can re-fetch. Refusing the login over a missing
     * userId would throw away a valid session.
     */
    const result: SsoSuccessResult = expectSuccess(
      `oneuptime://sso-callback?${AUTH_PARAMS}&globalSsoToken=${GLOBAL_SSO_TOKEN}`,
    );

    expect(result.user).toBeNull();
    expect(result.tokens.accessToken).toBe(ACCESS_TOKEN);
    expect(result.globalSsoToken).toBe(GLOBAL_SSO_TOKEN);
  });

  test("fills email and name with empty strings when only userId came back", () => {
    const result: SsoSuccessResult = expectSuccess(
      `oneuptime://sso-callback?${AUTH_PARAMS}&userId=${USER_ID}`,
    );

    expect(result.user).toEqual({
      userId: USER_ID,
      email: "",
      name: "",
      isMasterAdmin: false,
    });
  });

  test("treats an empty globalSsoToken as absent rather than storing an empty token", () => {
    /*
     * An empty string stored as a token is worse than no token: the app would
     * consider SSO satisfied and send `x-global-sso-token: ` on every request.
     */
    const result: SsoSuccessResult = expectSuccess(
      `oneuptime://sso-callback?${AUTH_PARAMS}&globalSsoToken=`,
    );

    expect(result.globalSsoToken).toBeNull();
  });
});

describe("parseSsoCallbackUrl: project SSO success", () => {
  test("returns the project token bound to its project", () => {
    const result: SsoSuccessResult = expectSuccess(PROJECT_SUCCESS_URL);

    expect(result.projectSsoToken).toEqual({
      projectId: PROJECT_ID,
      ssoToken: PROJECT_SSO_TOKEN,
    });
  });

  test("has no global token", () => {
    /*
     * A project login must not look like a global one, or the app would treat
     * one project's SSO as satisfying every other project's enforcement.
     */
    expect(expectSuccess(PROJECT_SUCCESS_URL).globalSsoToken).toBeNull();
  });

  test("still returns the auth tokens and the user", () => {
    const result: SsoSuccessResult = expectSuccess(PROJECT_SUCCESS_URL);

    expect(result.tokens.refreshTokenExpiresAt).toBe(EXPIRES_AT);
    expect(result.user?.userId).toBe(USER_ID);
  });

  test("drops a project token that arrived without its projectId", () => {
    /*
     * The pair is meaningless apart - there is nowhere to file the token. The
     * login itself is still valid, so it succeeds without a project token
     * rather than failing.
     */
    const result: SsoSuccessResult = expectSuccess(
      `oneuptime://sso-callback?${AUTH_PARAMS}&${USER_PARAMS}&ssoToken=${PROJECT_SSO_TOKEN}`,
    );

    expect(result.projectSsoToken).toBeNull();
    expect(result.tokens.accessToken).toBe(ACCESS_TOKEN);
  });

  test("drops a projectId that arrived without its token", () => {
    const result: SsoSuccessResult = expectSuccess(
      `oneuptime://sso-callback?${AUTH_PARAMS}&${USER_PARAMS}&projectId=${PROJECT_ID}`,
    );

    expect(result.projectSsoToken).toBeNull();
  });

  test("a callback with neither flavour of SSO token is still a valid login", () => {
    // An ordinary (non-SSO-enforced) login started from the app.
    const result: SsoSuccessResult = expectSuccess(
      `oneuptime://sso-callback?${AUTH_PARAMS}&${USER_PARAMS}`,
    );

    expect(result.globalSsoToken).toBeNull();
    expect(result.projectSsoToken).toBeNull();
  });
});

describe("parseSsoCallbackUrl: the server reported a failure", () => {
  /*
   * Without this branch every server-side failure - unknown user, disabled
   * provider, IdP refusal, expired login session - is indistinguishable from
   * the user tapping Cancel, and the screen tells them nothing.
   */

  const ERROR_WITH_DESCRIPTION_URL: string =
    "oneuptime://sso-callback?error=no_project_access&errorDescription=You+are+not+a+member+of+any+project.+Please+contact+your+administrator.";

  test("reports an error", () => {
    expect(parseSsoCallbackUrl(ERROR_WITH_DESCRIPTION_URL).status).toBe(
      "error",
    );
  });

  test("keeps both the code and the human sentence", () => {
    const result: SsoMessageResult = expectStatus(
      ERROR_WITH_DESCRIPTION_URL,
      "error",
    );

    expect(result.message).toContain("no_project_access");
    expect(result.message).toContain(
      "You are not a member of any project. Please contact your administrator.",
    );
    expect(result.message).toBe(
      "no_project_access: You are not a member of any project. Please contact your administrator.",
    );
  });

  test("uses just the code when the server had nothing to add", () => {
    const result: SsoMessageResult = expectStatus(
      "oneuptime://sso-callback?error=sso_login_failed",
      "error",
    );

    expect(result.message).toBe("sso_login_failed");
  });

  test("does not leave a dangling separator when the description is empty", () => {
    const result: SsoMessageResult = expectStatus(
      "oneuptime://sso-callback?error=sso_login_failed&errorDescription=",
      "error",
    );

    expect(result.message).toBe("sso_login_failed");
  });

  test("an error wins even when the URL also carries usable tokens", () => {
    /*
     * The dangerous ordering. If the token branch were checked first, a
     * callback the server marked as failed would sign the user in anyway, and
     * whatever the error was about (no project access, a revoked account)
     * would be silently ignored.
     */
    const result: SsoCallbackResult = parseSsoCallbackUrl(
      `oneuptime://sso-callback?error=sso_auth_failed&${AUTH_PARAMS}&${USER_PARAMS}&globalSsoToken=${GLOBAL_SSO_TOKEN}`,
    );

    expect(result.status).toBe("error");
    expect(result).not.toHaveProperty("tokens");
    expect(result).not.toHaveProperty("globalSsoToken");
  });

  test("decodes the description rather than showing the user %20 soup", () => {
    const result: SsoMessageResult = expectStatus(
      "oneuptime://sso-callback?error=oidc_error&errorDescription=Token%20exchange%20failed%3A%20invalid_client",
      "error",
    );

    expect(result.message).toBe(
      "oidc_error: Token exchange failed: invalid_client",
    );
  });

  test("survives a malformed escape in the description", () => {
    const result: SsoMessageResult = expectStatus(
      "oneuptime://sso-callback?error=saml_error&errorDescription=Signature+%+mismatch",
      "error",
    );

    expect(result.message).toBe("saml_error: Signature % mismatch");
  });
});

describe("parseSsoCallbackUrl: nothing usable", () => {
  /*
   * Every case here must be "invalid", never a half-populated success. A
   * success with an undefined refresh token is a session that cannot be
   * refreshed and logs the responder out mid-incident.
   */

  test("a link that is not the SSO callback at all", () => {
    expect(parseSsoCallbackUrl(`oneuptime://home?${AUTH_PARAMS}`).status).toBe(
      "invalid",
    );
    expect(
      parseSsoCallbackUrl(`https://oneuptime.com/sso-callback?${AUTH_PARAMS}`)
        .status,
    ).toBe("invalid");
  });

  test("no link at all", () => {
    expect(parseSsoCallbackUrl(null).status).toBe("invalid");
    expect(parseSsoCallbackUrl(undefined).status).toBe("invalid");
    expect(parseSsoCallbackUrl("").status).toBe("invalid");
  });

  test("the callback with no query at all", () => {
    expect(parseSsoCallbackUrl("oneuptime://sso-callback").status).toBe(
      "invalid",
    );
    expect(parseSsoCallbackUrl("oneuptime://sso-callback?").status).toBe(
      "invalid",
    );
    expect(parseSsoCallbackUrl("oneuptime://sso-callback/").status).toBe(
      "invalid",
    );
  });

  test("missing accessToken", () => {
    const result: SsoMessageResult = expectStatus(
      `oneuptime://sso-callback?refreshToken=${REFRESH_TOKEN}&refreshTokenExpiresAt=${ENCODED_EXPIRES_AT}&${USER_PARAMS}`,
      "invalid",
    );

    expect(result.message).toBe("Authentication failed. Missing token data.");
  });

  test("missing refreshToken", () => {
    expect(
      parseSsoCallbackUrl(
        `oneuptime://sso-callback?accessToken=${ACCESS_TOKEN}&refreshTokenExpiresAt=${ENCODED_EXPIRES_AT}&${USER_PARAMS}`,
      ).status,
    ).toBe("invalid");
  });

  test("missing refreshTokenExpiresAt", () => {
    /*
     * The least obviously fatal of the three, which is why it is here. Without
     * an expiry the app cannot know when to refresh, so it either refreshes
     * never or treats the session as already dead.
     */
    expect(
      parseSsoCallbackUrl(
        `oneuptime://sso-callback?accessToken=${ACCESS_TOKEN}&refreshToken=${REFRESH_TOKEN}&${USER_PARAMS}`,
      ).status,
    ).toBe("invalid");
  });

  test("a present-but-empty token is treated as missing", () => {
    /*
     * `?accessToken=` is a param that exists and is worthless. Accepting it
     * would store an empty bearer token and every subsequent API call would
     * 401 with no explanation.
     */
    expect(
      parseSsoCallbackUrl(
        `oneuptime://sso-callback?accessToken=&refreshToken=${REFRESH_TOKEN}&refreshTokenExpiresAt=${ENCODED_EXPIRES_AT}`,
      ).status,
    ).toBe("invalid");
  });

  test("an invalid result never carries partial tokens or a user", () => {
    const result: SsoCallbackResult = parseSsoCallbackUrl(
      `oneuptime://sso-callback?accessToken=${ACCESS_TOKEN}&${USER_PARAMS}&globalSsoToken=${GLOBAL_SSO_TOKEN}`,
    );

    expect(result.status).toBe("invalid");
    expect(result).not.toHaveProperty("tokens");
    expect(result).not.toHaveProperty("user");
    expect(result).not.toHaveProperty("globalSsoToken");
  });

  test("the SSO token params alone are not a login", () => {
    // A project token with no session behind it authenticates nothing.
    expect(
      parseSsoCallbackUrl(
        `oneuptime://sso-callback?ssoToken=${PROJECT_SSO_TOKEN}&projectId=${PROJECT_ID}`,
      ).status,
    ).toBe("invalid");
  });

  test("never throws, whatever arrives on the Linking stream", () => {
    const nonsense: Array<string> = [
      "oneuptime://sso-callback?%",
      "oneuptime://sso-callback?=&=&=",
      "oneuptime://sso-callback?accessToken=%E0%A4%A",
      "not a url",
      "oneuptime://",
    ];

    for (const url of nonsense) {
      expect(() => {
        return parseSsoCallbackUrl(url);
      }).not.toThrow();
    }
  });
});

/*
 * isSsoCallbackUrl strips a fragment before matching the path, so a
 * fragment-bearing callback is accepted as ours. parseSsoCallbackUrl has to
 * strip it too, or the fragment is glued onto whichever parameter happened to
 * come last - silently corrupting a token, or turning an ISO timestamp into
 * something Date() reads as Invalid Date.
 *
 * Our own server never emits a fragment (see
 * App/FeatureSet/Identity/Utils/MobileSso.ts), so this is about surviving a
 * redirect hop that adds one - fragments are conventional in OIDC responses.
 */
describe("parseSsoCallbackUrl: a fragment does not contaminate the last parameter", () => {
  test("a fragment after the query is discarded, not appended to the last value", () => {
    const result: SsoCallbackResult = parseSsoCallbackUrl(
      "oneuptime://sso-callback?accessToken=header.payload.signature" +
        "&refreshToken=refresh-token-value" +
        "&refreshTokenExpiresAt=2026-09-19T12%3A34%3A56.789Z" +
        "#state=abc123",
    );

    expect(result.status).toBe("success");

    if (result.status !== "success") {
      return;
    }

    expect(result.tokens.refreshTokenExpiresAt).toBe(
      "2026-09-19T12:34:56.789Z",
    );
    // The whole point: a Date built from it must be real.
    expect(
      Number.isNaN(new Date(result.tokens.refreshTokenExpiresAt).getTime()),
    ).toBe(false);
  });

  test("a fragment does not leak into a trailing globalSsoToken", () => {
    const result: SsoCallbackResult = parseSsoCallbackUrl(
      "oneuptime://sso-callback?accessToken=a.b.c" +
        "&refreshToken=r" +
        "&refreshTokenExpiresAt=2026-09-19T12%3A34%3A56.789Z" +
        "&globalSsoToken=global.token.value" +
        "#_=_",
    );

    expect(result.status).toBe("success");

    if (result.status !== "success") {
      return;
    }

    expect(result.globalSsoToken).toBe("global.token.value");
  });

  test("a fragment on an error callback does not corrupt the description", () => {
    const result: SsoCallbackResult = parseSsoCallbackUrl(
      "oneuptime://sso-callback?error=no_project_access" +
        "&errorDescription=Ask%20your%20administrator" +
        "#_=_",
    );

    expect(result.status).toBe("error");

    if (result.status !== "error") {
      return;
    }

    expect(result.message).toBe("no_project_access: Ask your administrator");
  });

  test("a fragment with no query at all is still not a usable login", () => {
    const result: SsoCallbackResult = parseSsoCallbackUrl(
      "oneuptime://sso-callback#state=abc",
    );

    expect(result.status).toBe("invalid");
  });
});

describe("the wire format is exactly what the server builds", () => {
  /*
   * Why this module hand-rolls its query parsing instead of using `new URL()`:
   * React Native ships its own cut-down URL/URLSearchParams
   * (react-native/Libraries/Blob/URL.js), while Jest runs on Node's WHATWG
   * implementation. A parser built on `new URL()` would therefore be tested
   * against one implementation and shipped against a different one, and a
   * green suite here would say nothing about a handset. parseSsoCallbackUrl
   * depends on neither, so the round trip below is the same code path in both
   * places - which is the only reason these assertions are worth anything.
   */

  function serverBuiltSuccessUrl(): string {
    /*
     * A faithful transcription of buildMobileSsoSuccessUrl in
     * App/FeatureSet/Identity/Utils/MobileSso.ts. Used ONLY to prove the
     * hard-coded fixtures above are byte-accurate - the module under test
     * never touches URLSearchParams.
     */
    const params: URLSearchParams = new URLSearchParams();

    params.set("accessToken", ACCESS_TOKEN);
    params.set("refreshToken", REFRESH_TOKEN);
    params.set("refreshTokenExpiresAt", new Date(EXPIRES_AT).toISOString());
    params.set("userId", USER_ID);
    params.set("email", EMAIL);
    params.set("name", NAME);
    params.set("isMasterAdmin", String(true));
    params.set("globalSsoToken", GLOBAL_SSO_TOKEN);

    return `oneuptime://sso-callback?${params.toString()}`;
  }

  test("the fixture is character-for-character the server's output", () => {
    expect(serverBuiltSuccessUrl()).toBe(GLOBAL_SUCCESS_URL);
  });

  test("the encoding the fixture depends on is really there", () => {
    // If these ever stop holding, the decode assertions below prove nothing.
    expect(GLOBAL_SUCCESS_URL).toContain("%3A");
    expect(GLOBAL_SUCCESS_URL).toContain("%40");
    expect(GLOBAL_SUCCESS_URL).toContain("%2B");
    expect(GLOBAL_SUCCESS_URL).toContain("Jane+Doe");
  });

  test("a realistic callback round-trips exactly", () => {
    const result: SsoSuccessResult = expectSuccess(serverBuiltSuccessUrl());

    expect(result.tokens.accessToken).toBe(ACCESS_TOKEN);
    expect(result.tokens.refreshToken).toBe(REFRESH_TOKEN);
    expect(result.tokens.refreshTokenExpiresAt).toBe(EXPIRES_AT);
    expect(result.globalSsoToken).toBe(GLOBAL_SSO_TOKEN);
    expect(result.user).toEqual({
      userId: USER_ID,
      email: EMAIL,
      name: NAME,
      isMasterAdmin: true,
    });
  });

  test("the JWTs come out with their three segments intact", () => {
    /*
     * A JWT's base64url alphabet includes "-" and "_", and its segments are
     * separated by ".". Any of those mangled in transit produces a token the
     * server rejects with a signature error that looks like a server bug.
     */
    const result: SsoSuccessResult = expectSuccess(serverBuiltSuccessUrl());

    expect(result.tokens.accessToken.split(".")).toHaveLength(3);
    expect(result.tokens.refreshToken.split(".")).toHaveLength(3);
    expect(result.globalSsoToken?.split(".")).toHaveLength(3);
    expect(result.tokens.accessToken).toContain("-");
    expect(result.tokens.accessToken).toContain("_");
  });

  test("the decoded expiry is a real Date, not NaN", () => {
    /*
     * The end of the chain that this whole module exists to protect: the
     * expiry is what schedules the refresh, and a NaN here logs the responder
     * out at an arbitrary moment.
     */
    const result: SsoSuccessResult = expectSuccess(serverBuiltSuccessUrl());
    const expiry: Date = new Date(result.tokens.refreshTokenExpiresAt);

    expect(Number.isNaN(expiry.getTime())).toBe(false);
    expect(expiry.toISOString()).toBe(EXPIRES_AT);
  });
});

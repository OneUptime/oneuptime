import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens, storeTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
  storeGlobalSsoToken,
  storeSsoToken,
} from "../storage/ssoTokens";
import { decodeJwtPayload, type JwtPayload } from "../utils/jwt";
import apiClient from "./client";
import type {
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosRequestConfig,
} from "axios";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The SSO headers the API client attaches are the mobile equivalent of the
 * browser's SSO cookies. Get them wrong and nothing throws, nothing logs, and
 * no test elsewhere notices: the app simply starts collecting 406s from every
 * SSO-enforced project, and the user is told nothing more useful than
 * "forbidden".
 *
 * So the assertions below are pinned to what the SERVER actually reads, in
 * Common/Server/Middleware/UserAuthorization.ts:
 *
 *   getSsoTokens()          - reads the `x-sso-tokens` header, JSON.parses it,
 *                             and keeps only the entries whose token decodes to
 *                             a projectId equal to the key it was filed under.
 *   getGlobalSsoTokenData() - reads the `x-global-sso-token` header as a BARE
 *                             token (no "Bearer ", no JSON), decodes it, and
 *                             accepts it only when its ssoProviderType is
 *                             GlobalSSO or GlobalOIDC.
 *
 * Both header names and both value shapes are re-stated in this file rather
 * than imported, because they are a wire contract with a server that ships
 * separately from the app.
 *
 * Nothing here is platform-specific - the interceptor runs identically on iOS
 * and Android - so every test is expected to hold under both Jest projects.
 */

const SSO_TOKENS_HEADER: string = "x-sso-tokens";
const GLOBAL_SSO_TOKEN_HEADER: string = "x-global-sso-token";

const USER_ID: string = "11111111-1111-1111-1111-111111111111";
const PROJECT_A: string = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B: string = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ONE_HOUR_IN_SECONDS: number = 60 * 60;

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/*
 * Tokens are minted relative to "now" rather than pasted in as fixtures, so
 * that the expiry cases keep meaning what they say. Payloads are pure ASCII
 * JSON, so one char is one byte and no UTF-8 handling is needed.
 */
function base64UrlEncode(value: string): string {
  let encoded: string = "";

  for (let index: number = 0; index < value.length; index += 3) {
    const byte1: number = value.charCodeAt(index);
    const byte2: number | undefined =
      index + 1 < value.length ? value.charCodeAt(index + 1) : undefined;
    const byte3: number | undefined =
      index + 2 < value.length ? value.charCodeAt(index + 2) : undefined;

    encoded += BASE64_ALPHABET.charAt(byte1 >> 2);
    encoded += BASE64_ALPHABET.charAt(
      ((byte1 & 0x03) << 4) | ((byte2 ?? 0) >> 4),
    );

    if (byte2 === undefined) {
      break;
    }

    encoded += BASE64_ALPHABET.charAt(
      ((byte2 & 0x0f) << 2) | ((byte3 ?? 0) >> 6),
    );

    if (byte3 === undefined) {
      break;
    }

    encoded += BASE64_ALPHABET.charAt(byte3 & 0x3f);
  }

  // JWT flavour: base64url, and the padding is omitted.
  return encoded.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Mints an unsigned-but-well-formed JWT. Pass null for expiresInSeconds to omit
 * the `exp` claim entirely, which both the app and the server read as
 * "never expires".
 */
function mintJwt(
  claims: Record<string, unknown>,
  expiresInSeconds: number | null,
): string {
  const header: string = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );

  const payload: Record<string, unknown> = { ...claims };

  if (expiresInSeconds !== null) {
    payload["exp"] = Math.floor(Date.now() / 1000) + expiresInSeconds;
  }

  /*
   * The app never verifies the signature - the server does - so any third
   * segment is as good as a real one here.
   */
  return `${header}.${base64UrlEncode(JSON.stringify(payload))}.not-a-signature`;
}

function globalToken(
  providerType: string = "GlobalSSO",
  expiresInSeconds: number | null = ONE_HOUR_IN_SECONDS,
): string {
  return mintJwt(
    { userId: USER_ID, ssoProviderType: providerType },
    expiresInSeconds,
  );
}

function projectToken(
  projectId: string,
  expiresInSeconds: number | null = ONE_HOUR_IN_SECONDS,
): string {
  return mintJwt(
    { userId: USER_ID, projectId, ssoProviderType: "ProjectSSO" },
    expiresInSeconds,
  );
}

/*
 * A stand-in for the network. Axios hands a custom `config.adapter` the fully
 * assembled request config - after every request interceptor has run - which is
 * exactly the object the wire would have been built from. Capturing it lets
 * these tests exercise the real interceptor in src/api/client.ts rather than a
 * re-implementation of it, without a socket ever being opened.
 */
let sentConfigs: Array<InternalAxiosRequestConfig> = [];

function captureAdapter(
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> {
  sentConfigs.push(config);

  return Promise.resolve({
    data: {},
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  } as AxiosResponse);
}

const adapterConfig: AxiosRequestConfig = { adapter: captureAdapter };

async function get(url: string = "/api/monitor"): Promise<void> {
  await apiClient.get(url, adapterConfig);
}

function lastRequest(): InternalAxiosRequestConfig {
  return sentConfigs[sentConfigs.length - 1]!;
}

/**
 * Reads a header off a captured request, matching the name case-insensitively
 * the way an HTTP server does. Returns undefined ONLY when the header is truly
 * absent - an empty string or the string "null" comes back as itself, so
 * `toBeUndefined()` is a real assertion about the header not being sent.
 */
function headerOf(config: InternalAxiosRequestConfig, name: string): unknown {
  const headers: Record<string, unknown> = config.headers as unknown as Record<
    string,
    unknown
  >;

  const key: string | undefined = Object.keys(headers).find(
    (candidate: string): boolean => {
      return candidate.toLowerCase() === name.toLowerCase();
    },
  );

  return key === undefined ? undefined : headers[key];
}

/*
 * A test-side model of UserAuthorization.getSsoTokens()'s header branch. It is
 * deliberately as unforgiving as the server is: an entry the server drops here
 * is an SSO token the app might as well not have sent, and the user still gets
 * a 406.
 */
function ssoTokensAsServerReadsThem(
  headerValue: unknown,
): Record<string, string> {
  const accepted: Record<string, string> = {};

  if (typeof headerValue !== "string") {
    return accepted;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(headerValue);
  } catch {
    return accepted;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return accepted;
  }

  const headerTokens: Record<string, unknown> = parsed as Record<
    string,
    unknown
  >;

  for (const projectId of Object.keys(headerTokens)) {
    const token: unknown = headerTokens[projectId];

    if (!token || typeof token !== "string") {
      continue;
    }

    const decoded: JwtPayload | null = decodeJwtPayload(token);

    if (decoded && String(decoded["projectId"]) === projectId) {
      accepted[projectId] = token;
    }
  }

  return accepted;
}

/*
 * A test-side model of UserAuthorization.getGlobalSsoTokenData()'s header
 * branch: the raw header value is decoded as-is, and only a Global provider
 * type is honoured. Returns null for anything the server would reject.
 */
function globalSsoTokenAsServerReadsIt(
  headerValue: unknown,
): JwtPayload | null {
  if (typeof headerValue !== "string" || !headerValue) {
    return null;
  }

  const decoded: JwtPayload | null = decodeJwtPayload(headerValue);

  if (!decoded) {
    return null;
  }

  if (
    decoded["ssoProviderType"] === "GlobalSSO" ||
    decoded["ssoProviderType"] === "GlobalOIDC"
  ) {
    return decoded;
  }

  return null;
}

/*
 * The AsyncStorage mock in src/__tests__/setup.ts is a module-level Map that
 * survives between tests, and both storage modules hold in-memory caches that
 * survive with it. All of it has to be reset, or a test silently inherits the
 * previous test's signed-in state - which for header tests would mean passing
 * for the wrong reason.
 */
beforeEach(async () => {
  sentConfigs = [];
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl("https://test.oneuptime.local");
});

describe("x-global-sso-token", () => {
  test("carries the token exactly as it was issued", async () => {
    const token: string = globalToken();

    await storeGlobalSsoToken(token);
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBe(token);
  });

  test("is a bare token, not a Bearer credential and not JSON", async () => {
    /*
     * getGlobalSsoTokenData() feeds the header straight into JSONWebToken
     * .decode(). A "Bearer " prefix or a JSON.stringify() round-trip makes the
     * decode throw, which the server logs and treats as "no global SSO token
     * at all" - i.e. the user is denied while holding a perfectly valid one.
     */
    const token: string = globalToken();

    await storeGlobalSsoToken(token);
    await get();

    const value: unknown = headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER);

    expect(typeof value).toBe("string");
    expect(value as string).not.toMatch(/^Bearer /);
    expect(value).not.toBe(JSON.stringify(token));
    expect((value as string).split(".")).toHaveLength(3);
  });

  test("is a token the server will actually accept", async () => {
    const token: string = globalToken("GlobalSSO");

    await storeGlobalSsoToken(token);
    await get();

    const accepted: JwtPayload | null = globalSsoTokenAsServerReadsIt(
      headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER),
    );

    expect(accepted).not.toBeNull();
    expect(accepted!["userId"]).toBe(USER_ID);
    expect(accepted!["ssoProviderType"]).toBe("GlobalSSO");
  });

  test("a Global OIDC token is sent the same way as a Global SAML one", async () => {
    /*
     * The admin dashboard can configure either flavour instance-wide, and the
     * server accepts both provider types on this header. The client must not
     * treat them differently.
     */
    const token: string = globalToken("GlobalOIDC");

    await storeGlobalSsoToken(token);
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBe(token);
    expect(
      globalSsoTokenAsServerReadsIt(
        headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER),
      ),
    ).not.toBeNull();
  });

  test("is not sent at all when there is no global token", async () => {
    await storeSsoToken(PROJECT_A, projectToken(PROJECT_A));
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBeUndefined();
  });
});

describe("x-sso-tokens", () => {
  test("is a JSON object keyed by project id", async () => {
    const token: string = projectToken(PROJECT_A);

    await storeSsoToken(PROJECT_A, token);
    await get();

    const value: unknown = headerOf(lastRequest(), SSO_TOKENS_HEADER);

    expect(JSON.parse(value as string)).toEqual({ [PROJECT_A]: token });
  });

  test("carries every project the user has signed into", async () => {
    const tokenA: string = projectToken(PROJECT_A);
    const tokenB: string = projectToken(PROJECT_B);

    await storeSsoToken(PROJECT_A, tokenA);
    await storeSsoToken(PROJECT_B, tokenB);
    await get();

    expect(
      JSON.parse(headerOf(lastRequest(), SSO_TOKENS_HEADER) as string),
    ).toEqual({
      [PROJECT_A]: tokenA,
      [PROJECT_B]: tokenB,
    });
  });

  test("is serialized to a string, not handed over as an object", async () => {
    /*
     * A header assigned a raw object reaches the server as the literal
     * "[object Object]", which JSON.parse rejects. The server catches that,
     * logs it, and carries on with zero SSO tokens - so the request is denied
     * with no clue as to why.
     */
    await storeSsoToken(PROJECT_A, projectToken(PROJECT_A));
    await get();

    const value: unknown = headerOf(lastRequest(), SSO_TOKENS_HEADER);

    expect(typeof value).toBe("string");
    expect(value).not.toBe("[object Object]");
  });

  test("every entry survives the server's project-id cross-check", async () => {
    /*
     * The server does not take the key on trust: it decodes each token and
     * drops any entry whose own projectId claim disagrees with the key it was
     * filed under. Sending a map the server then empties is the same as
     * sending nothing.
     */
    const tokenA: string = projectToken(PROJECT_A);
    const tokenB: string = projectToken(PROJECT_B);

    await storeSsoToken(PROJECT_A, tokenA);
    await storeSsoToken(PROJECT_B, tokenB);
    await get();

    expect(
      ssoTokensAsServerReadsThem(headerOf(lastRequest(), SSO_TOKENS_HEADER)),
    ).toEqual({
      [PROJECT_A]: tokenA,
      [PROJECT_B]: tokenB,
    });
  });

  test("is not sent at all when no project token is held", async () => {
    await storeGlobalSsoToken(globalToken());
    await get();

    expect(headerOf(lastRequest(), SSO_TOKENS_HEADER)).toBeUndefined();
  });
});

describe("the two headers are independent", () => {
  test("both are sent when the user holds both kinds of token", async () => {
    /*
     * A user can hold a global token from an instance-wide login AND a
     * per-project token from an older project-level login. Neither may crowd
     * the other out: the server consults them separately, project token first.
     */
    const global: string = globalToken();
    const project: string = projectToken(PROJECT_A);

    await storeGlobalSsoToken(global);
    await storeSsoToken(PROJECT_A, project);
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBe(global);
    expect(
      JSON.parse(headerOf(lastRequest(), SSO_TOKENS_HEADER) as string),
    ).toEqual({ [PROJECT_A]: project });
  });

  test("neither is sent when the user holds no SSO token", async () => {
    /*
     * Not "", not "null", not the key with an undefined value - absent. An
     * empty-string x-sso-tokens is falsy on the server and harmless, but an
     * x-global-sso-token of "null" is a truthy string that goes into
     * JSONWebToken.decode() and throws on every single request.
     */
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBeUndefined();
    expect(headerOf(lastRequest(), SSO_TOKENS_HEADER)).toBeUndefined();
  });

  test("an empty project-token map is not sent as {}", async () => {
    /*
     * getSsoTokens() returns {} rather than null once the store has been read
     * and found empty. Stringifying that unconditionally would put a useless
     * "{}" on every request the app ever makes.
     */
    await storeSsoToken(PROJECT_A, projectToken(PROJECT_A));
    await clearAllSsoTokens();
    await get();

    expect(headerOf(lastRequest(), SSO_TOKENS_HEADER)).toBeUndefined();
  });
});

describe("the SSO headers sit alongside the normal auth headers", () => {
  test("the Bearer token is still attached with both SSO headers present", async () => {
    /*
     * SSO enforcement is a second gate, not a replacement for the session.
     * A request carrying SSO proof but no Authorization header is anonymous,
     * and the server 401s it before it ever looks at SSO.
     */
    await storeTokens({
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await storeGlobalSsoToken(globalToken());
    await storeSsoToken(PROJECT_A, projectToken(PROJECT_A));
    await get();

    const request: InternalAxiosRequestConfig = lastRequest();

    expect(headerOf(request, "Authorization")).toBe(
      "Bearer access-token-value",
    );
    expect(headerOf(request, GLOBAL_SSO_TOKEN_HEADER)).toBeDefined();
    expect(headerOf(request, SSO_TOKENS_HEADER)).toBeDefined();
  });

  test("the SSO headers do not disturb the caller's own headers", async () => {
    await storeGlobalSsoToken(globalToken());

    await apiClient.get("/api/monitor", {
      ...adapterConfig,
      headers: { "x-custom-trace": "trace-1" },
    });

    expect(headerOf(lastRequest(), "x-custom-trace")).toBe("trace-1");
    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBeDefined();
    expect(headerOf(lastRequest(), "Content-Type")).toBe("application/json");
  });

  test("the base URL is still resolved from stored settings", async () => {
    await storeGlobalSsoToken(globalToken());
    await get();

    expect(lastRequest().baseURL).toBe("https://test.oneuptime.local");
  });
});

describe("expired tokens never reach the wire", () => {
  test("an expired global token is evicted on read and never sent", async () => {
    /*
     * Driven end to end, because the interceptor itself does no expiry check -
     * it trusts the cache. The cache is only corrected when the storage layer
     * reads through, which is what happens on app start. If eviction did not
     * also clear the in-memory cache, the app would keep presenting a dead
     * token on every request for the whole session.
     */
    const expired: string = globalToken("GlobalSSO", -ONE_HOUR_IN_SECONDS);

    await storeGlobalSsoToken(expired);

    expect(await getGlobalSsoToken()).toBeNull();

    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBeUndefined();
  });

  test("an expired project token is dropped while a live sibling still goes", async () => {
    const live: string = projectToken(PROJECT_A);
    const expired: string = projectToken(PROJECT_B, -ONE_HOUR_IN_SECONDS);

    await storeSsoToken(PROJECT_A, live);
    await storeSsoToken(PROJECT_B, expired);

    await getSsoTokens();
    await get();

    const sent: Record<string, unknown> = JSON.parse(
      headerOf(lastRequest(), SSO_TOKENS_HEADER) as string,
    );

    expect(sent).toEqual({ [PROJECT_A]: live });
    expect(sent[PROJECT_B]).toBeUndefined();
  });

  test("the header disappears entirely once the last project token lapses", async () => {
    await storeSsoToken(
      PROJECT_A,
      projectToken(PROJECT_A, -ONE_HOUR_IN_SECONDS),
    );

    await getSsoTokens();
    await get();

    expect(headerOf(lastRequest(), SSO_TOKENS_HEADER)).toBeUndefined();
  });

  test("a global token with no exp claim is still sent", async () => {
    /*
     * "No exp" means "does not expire" to both the decoder and the server.
     * Treating a missing claim as expired would lock out any deployment that
     * mints non-expiring SSO tokens.
     */
    const token: string = globalToken("GlobalSSO", null);

    await storeGlobalSsoToken(token);

    expect(await getGlobalSsoToken()).toBe(token);

    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBe(token);
  });
});

describe("every request carries them, not just the first", () => {
  test("a second request is headed the same as the first", async () => {
    /*
     * The cache is read per request, not consumed. A regression that moved the
     * read outside the interceptor would authenticate the first call of a
     * session and silently strip the rest.
     */
    const token: string = globalToken();

    await storeGlobalSsoToken(token);
    await get("/api/monitor");
    await get("/api/incident");

    expect(sentConfigs).toHaveLength(2);
    expect(headerOf(sentConfigs[0]!, GLOBAL_SSO_TOKEN_HEADER)).toBe(token);
    expect(headerOf(sentConfigs[1]!, GLOBAL_SSO_TOKEN_HEADER)).toBe(token);
  });

  test("a POST carries them as well as a GET", async () => {
    const global: string = globalToken();
    const project: string = projectToken(PROJECT_A);

    await storeGlobalSsoToken(global);
    await storeSsoToken(PROJECT_A, project);

    await apiClient.post("/api/incident", { name: "test" }, adapterConfig);

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBe(global);
    expect(
      JSON.parse(headerOf(lastRequest(), SSO_TOKENS_HEADER) as string),
    ).toEqual({ [PROJECT_A]: project });
  });

  test("signing out stops the tokens being presented from the next request on", async () => {
    /*
     * The other side of the cache being trusted: if clearing the store left the
     * in-memory copy behind, a signed-out handset would keep proving an SSO
     * identity to the server.
     */
    await storeGlobalSsoToken(globalToken());
    await storeSsoToken(PROJECT_A, projectToken(PROJECT_A));
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBeDefined();

    await clearAllSsoTokens();
    await get();

    expect(headerOf(lastRequest(), GLOBAL_SSO_TOKEN_HEADER)).toBeUndefined();
    expect(headerOf(lastRequest(), SSO_TOKENS_HEADER)).toBeUndefined();
  });
});

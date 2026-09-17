import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens, getTokens, type StoredTokens } from "../storage/keychain";
import {
  clearAllSsoTokens,
  getCachedGlobalSsoToken,
  getCachedSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import { decodeJwtPayload, isJwtExpired, type JwtPayload } from "../utils/jwt";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "./session";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * completeSsoLoginFromUrl is the single place a callback becomes a signed-in
 * session. Four flows reach it - the login screen, the Settings
 * re-authentication flow, the Android dismiss-race fallback, and a cold start
 * after the OS killed the app mid-login - and the failure it exists to prevent
 * is subtle: a flow that persists the auth tokens but NOT the global SSO token
 * leaves the user simultaneously signed in and 406'd on every SSO-enforced
 * project, with no error the app can explain.
 *
 * So these tests run against the real keychain and ssoTokens modules over the
 * AsyncStorage fake from setup.ts, and assert on what is READABLE BACK
 * afterwards. Asserting "storeGlobalSsoToken was called" would pass against a
 * store that dropped the write on the floor; reading it back would not.
 */

/*
 * Deliberately re-declared rather than imported: these literals ARE the
 * on-disk contract. If a storage module renames its key, the app stops seeing
 * tokens written by the previous build, and a test that imported the constant
 * would happily follow the rename and stay green.
 */
const KEYCHAIN_STORAGE_KEY: string = "com.oneuptime.oncall.tokens";
const SSO_TOKENS_STORAGE_KEY: string = "oneuptime_sso_tokens";
const GLOBAL_SSO_TOKEN_STORAGE_KEY: string = "oneuptime_global_sso_token";

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * ASCII -> base64url (JWT flavour: no padding, `-`/`_` for `+`/`/`).
 *
 * Hand-rolled for the same reason src/utils/jwt.ts hand-rolls the decode:
 * `btoa`/`Buffer` availability differs between the Jest environment and the
 * runtimes this app ships on, and a helper that only works here would be
 * minting tokens the app could never actually receive. Round-tripped through
 * the real decoder in the first test below, so a bug in it cannot quietly
 * invalidate the rest of the file.
 */
function toBase64Url(value: string): string {
  let output: string = "";
  let buffer: number = 0;
  let bitsInBuffer: number = 0;

  for (let index: number = 0; index < value.length; index++) {
    buffer = (buffer << 8) | (value.charCodeAt(index) & 0xff);
    bitsInBuffer += 8;

    while (bitsInBuffer >= 6) {
      bitsInBuffer -= 6;
      output += BASE64_ALPHABET[(buffer >> bitsInBuffer) & 0x3f];
    }
  }

  if (bitsInBuffer > 0) {
    output += BASE64_ALPHABET[(buffer << (6 - bitsInBuffer)) & 0x3f];
  }

  return output.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Mints a syntactically real, unsigned JWT. The app never verifies signatures
 * (the server does), but ssoTokens.ts now EVICTS anything `isJwtExpired`
 * rejects on read - which includes anything that is not a three-segment JWT.
 * So a token these tests store has to be a real JWT or it would vanish for
 * reasons that have nothing to do with the code under test.
 */
function mintJwt(expiresAtSeconds: number | null, subject: string): string {
  const header: string = toBase64Url(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const payload: string = toBase64Url(
    JSON.stringify(
      expiresAtSeconds === null
        ? { sub: subject }
        : { sub: subject, exp: expiresAtSeconds },
    ),
  );

  return `${header}.${payload}.not-verified-by-the-app`;
}

const THIRTY_DAYS_IN_SECONDS: number = 30 * 24 * 60 * 60;

/** A token the server would have just issued: valid for the usual 30 days. */
function freshJwt(subject: string): string {
  return mintJwt(
    Math.floor(Date.now() / 1000) + THIRTY_DAYS_IN_SECONDS,
    subject,
  );
}

/** A token that lapsed an hour ago - well clear of the 30s expiry leeway. */
function lapsedJwt(subject: string): string {
  return mintJwt(Math.floor(Date.now() / 1000) - 3600, subject);
}

function buildCallbackUrl(params: Record<string, string>): string {
  const query: string = Object.keys(params)
    .map((key: string) => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`;
    })
    .join("&");

  return `oneuptime://sso-callback?${query}`;
}

/** The three auth params every SSO callback carries, whatever its flavour. */
function authParams(): Record<string, string> {
  return {
    accessToken: "access-token-abc",
    refreshToken: "refresh-token-def",
    refreshTokenExpiresAt: "2026-12-31T23:59:59.000Z",
    userId: "user-1",
    email: "responder@example.com",
    name: "Test Responder",
  };
}

/**
 * Reads a key straight out of the AsyncStorage fake, bypassing the storage
 * modules. Needed for the "stored nothing" assertions: `getSsoTokens()`
 * returns `{}` both when nothing was ever written AND when a written token was
 * evicted, so only the raw key can tell "we did not write" from "we wrote and
 * then dropped it".
 */
async function rawStorageValue(key: string): Promise<string | null> {
  return (await AsyncStorage.getItem(key)) as string | null;
}

async function expectNothingStored(): Promise<void> {
  expect(await rawStorageValue(KEYCHAIN_STORAGE_KEY)).toBeNull();
  expect(await rawStorageValue(SSO_TOKENS_STORAGE_KEY)).toBeNull();
  expect(await rawStorageValue(GLOBAL_SSO_TOKEN_STORAGE_KEY)).toBeNull();
}

beforeEach(async () => {
  /*
   * The AsyncStorage fake is a module-level Map that survives between tests,
   * and both storage modules keep in-memory caches the axios interceptor reads
   * synchronously. Clearing the store alone would leave those caches stale, so
   * a test could "see" a token the previous test wrote.
   */
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
});

describe("The JWT helpers these tests rely on", () => {
  test("mint tokens the app's own decoder accepts", () => {
    /*
     * If this is wrong every "the token was stored" assertion below could pass
     * for the wrong reason - or fail for one.
     */
    const token: string = freshJwt("global-sso");
    const payload: JwtPayload | null = decodeJwtPayload(token);

    expect(payload).not.toBeNull();
    expect(payload!["sub"]).toBe("global-sso");
    expect(isJwtExpired(token)).toBe(false);
  });

  test("mint expired tokens the app's own decoder rejects", () => {
    expect(isJwtExpired(lapsedJwt("global-sso"))).toBe(true);
  });
});

describe("A Global SSO callback", () => {
  const globalToken: string = freshJwt("global-sso");

  const globalCallbackUrl: string = buildCallbackUrl({
    ...authParams(),
    globalSsoToken: globalToken,
  });

  test("persists the auth tokens where the API client reads them", async () => {
    await completeSsoLoginFromUrl(globalCallbackUrl);

    const stored: StoredTokens | null = await getTokens();

    expect(stored).not.toBeNull();
    expect(stored!.accessToken).toBe("access-token-abc");
    expect(stored!.refreshToken).toBe("refresh-token-def");
    expect(stored!.refreshTokenExpiresAt).toBe("2026-12-31T23:59:59.000Z");
  });

  test("persists the global SSO token", async () => {
    /*
     * THE regression this module exists to prevent. Without this write the
     * user is signed in and every SSO-enforced project answers 406.
     */
    await completeSsoLoginFromUrl(globalCallbackUrl);

    expect(await getGlobalSsoToken()).toBe(globalToken);
  });

  test("makes the global token visible to the synchronous cache too", async () => {
    /*
     * The axios interceptor reads the CACHE, not the store - it cannot await
     * on its way out. A write that reached disk but not the cache would still
     * send the very first request after login without the header.
     */
    await completeSsoLoginFromUrl(globalCallbackUrl);

    expect(getCachedGlobalSsoToken()).toBe(globalToken);
  });

  test("writes no per-project token", async () => {
    /*
     * One global token satisfies every project, including projects created
     * after login. Inventing a per-project entry here would pin the user to
     * whichever project happened to be selected.
     */
    await completeSsoLoginFromUrl(globalCallbackUrl);

    expect(await rawStorageValue(SSO_TOKENS_STORAGE_KEY)).toBeNull();
    expect(await getSsoTokens()).toEqual({});
  });

  test("reports the login as global, with no project", async () => {
    const outcome: CompleteSsoLoginOutcome =
      await completeSsoLoginFromUrl(globalCallbackUrl);

    expect(outcome).toEqual({
      status: "success",
      isGlobal: true,
      projectId: null,
    });
  });
});

describe("A project SSO callback", () => {
  const projectToken: string = freshJwt("project-sso");

  const projectCallbackUrl: string = buildCallbackUrl({
    ...authParams(),
    ssoToken: projectToken,
    projectId: "project-42",
  });

  test("stores the token under the project it was issued for", async () => {
    /*
     * Filed under the wrong id the token is never sent for the project that
     * needs it, and IS sent for one that did not authorise it.
     */
    await completeSsoLoginFromUrl(projectCallbackUrl);

    expect(await getSsoTokens()).toEqual({ "project-42": projectToken });
  });

  test("makes the project token visible to the synchronous cache too", async () => {
    await completeSsoLoginFromUrl(projectCallbackUrl);

    expect(getCachedSsoTokens()).toEqual({ "project-42": projectToken });
  });

  test("writes no global token", async () => {
    /*
     * A project login must not be promoted to instance-wide access: the
     * global header would be sent for projects this SSO session never covered.
     */
    await completeSsoLoginFromUrl(projectCallbackUrl);

    expect(await rawStorageValue(GLOBAL_SSO_TOKEN_STORAGE_KEY)).toBeNull();
    expect(await getGlobalSsoToken()).toBeNull();
  });

  test("still persists the auth tokens", async () => {
    await completeSsoLoginFromUrl(projectCallbackUrl);

    expect((await getTokens())!.accessToken).toBe("access-token-abc");
  });

  test("reports the login as non-global, naming the project", async () => {
    const outcome: CompleteSsoLoginOutcome =
      await completeSsoLoginFromUrl(projectCallbackUrl);

    expect(outcome).toEqual({
      status: "success",
      isGlobal: false,
      projectId: "project-42",
    });
  });

  test("leaves an earlier project's token alone", async () => {
    /*
     * A responder belongs to several SSO-enforced projects and authenticates
     * to them one at a time. If a second login replaced the map instead of
     * merging into it, signing into project B would silently sign the user out
     * of project A.
     */
    const firstToken: string = freshJwt("project-sso-a");

    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        ssoToken: firstToken,
        projectId: "project-a",
      }),
    );
    await completeSsoLoginFromUrl(projectCallbackUrl);

    expect(await getSsoTokens()).toEqual({
      "project-a": firstToken,
      "project-42": projectToken,
    });
  });

  test("a re-login for the same project replaces its token", async () => {
    const refreshedToken: string = freshJwt("project-sso-refreshed");

    await completeSsoLoginFromUrl(projectCallbackUrl);
    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        ssoToken: refreshedToken,
        projectId: "project-42",
      }),
    );

    expect(await getSsoTokens()).toEqual({ "project-42": refreshedToken });
  });
});

describe("A callback carrying both a global and a project token", () => {
  const globalToken: string = freshJwt("global-sso");
  const projectToken: string = freshJwt("project-sso");

  const bothCallbackUrl: string = buildCallbackUrl({
    ...authParams(),
    globalSsoToken: globalToken,
    ssoToken: projectToken,
    projectId: "project-42",
  });

  test("stores both, not whichever it checked first", async () => {
    /*
     * The shapes are not exclusive: a Global SSO login that started from a
     * project-scoped screen comes back with both. An if/else here would drop
     * one of them.
     */
    await completeSsoLoginFromUrl(bothCallbackUrl);

    expect(await getGlobalSsoToken()).toBe(globalToken);
    expect(await getSsoTokens()).toEqual({ "project-42": projectToken });
  });

  test("reports it as global AND names the project", async () => {
    const outcome: CompleteSsoLoginOutcome =
      await completeSsoLoginFromUrl(bothCallbackUrl);

    expect(outcome).toEqual({
      status: "success",
      isGlobal: true,
      projectId: "project-42",
    });
  });
});

describe("A callback the server marked as failed", () => {
  test("stores nothing at all", async () => {
    /*
     * An error callback has no tokens to store, but it is still an
     * `oneuptime://sso-callback` URL. Writing a partial session off one would
     * leave the app believing it is signed in after a login that was refused.
     */
    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        error: "sso_disabled",
        errorDescription: "SSO is not enabled for this project",
      }),
    );

    await expectNothingStored();
  });

  test("returns the server's reason, so the user is told why", async () => {
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        error: "sso_disabled",
        errorDescription: "SSO is not enabled for this project",
      }),
    );

    expect(outcome).toEqual({
      status: "error",
      message: "sso_disabled: SSO is not enabled for this project",
    });
  });

  test("returns the bare error when the server sent no description", async () => {
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({ error: "access_denied" }),
    );

    expect(outcome).toEqual({ status: "error", message: "access_denied" });
  });

  test("an error wins even when tokens are also present on the URL", async () => {
    /*
     * Defence against a server that appends `error` to an otherwise complete
     * redirect. Tokens that arrive alongside a refusal must not be trusted.
     */
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        globalSsoToken: freshJwt("global-sso"),
        error: "access_denied",
      }),
    );

    expect(outcome.status).toBe("error");
    await expectNothingStored();
  });
});

describe("A callback that is not usable at all", () => {
  test.each([
    ["a completely unrelated URL", "https://oneuptime.com/dashboard"],
    ["random garbage", "not-even-a-url"],
    ["an empty string", ""],
    [
      "a scheme that merely starts the same way",
      "oneuptime://sso-callback-other?accessToken=a&refreshToken=b&refreshTokenExpiresAt=c",
    ],
  ])(
    "%s stores nothing and reports an error",
    async (_label: string, url: string) => {
      const outcome: CompleteSsoLoginOutcome =
        await completeSsoLoginFromUrl(url);

      expect(outcome.status).toBe("error");
      await expectNothingStored();
    },
  );

  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "%s stores nothing and reports an error",
    async (_label: string, url: string | null | undefined) => {
      /*
       * Both are real inputs: the Android dismiss-race fallback and the cold
       * start path both hand over whatever `Linking` gave them, which is null
       * when there was nothing pending.
       */
      const outcome: CompleteSsoLoginOutcome =
        await completeSsoLoginFromUrl(url);

      expect(outcome.status).toBe("error");
      await expectNothingStored();
    },
  );

  test("a callback missing the refresh token stores no half-session", async () => {
    /*
     * Half a token set is worse than none: the access token expires in
     * minutes and without the refresh token there is no way back, so the app
     * would sign the user out at a random moment instead of at login.
     */
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        accessToken: "access-token-abc",
        globalSsoToken: freshJwt("global-sso"),
      }),
    );

    expect(outcome).toEqual({
      status: "error",
      message: "Authentication failed. Missing token data.",
    });
    await expectNothingStored();
  });

  test("a callback with no query string at all reports an error", async () => {
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      "oneuptime://sso-callback",
    );

    expect(outcome.status).toBe("error");
    await expectNothingStored();
  });
});

describe("A success callback whose global token has already expired", () => {
  /*
   * Reachable in practice: the app can be cold-started on a callback URL the
   * OS held while the process was dead, and the same URL is re-delivered by
   * `getInitialURL()` on later launches.
   *
   * Documented behaviour, not a bug: session.ts writes whatever the server
   * sent (it does not second-guess token lifetimes), and ssoTokens.ts evicts
   * it on the next READ. The user therefore ends up signed in with no global
   * token - which is the state that prompts a fresh SSO login, rather than a
   * stream of unexplained 406s.
   */
  const expiredGlobalToken: string = lapsedJwt("global-sso");

  const expiredCallbackUrl: string = buildCallbackUrl({
    ...authParams(),
    globalSsoToken: expiredGlobalToken,
  });

  test("still reports success, and still persists the auth tokens", async () => {
    const outcome: CompleteSsoLoginOutcome =
      await completeSsoLoginFromUrl(expiredCallbackUrl);

    expect(outcome).toEqual({
      status: "success",
      isGlobal: true,
      projectId: null,
    });
    expect((await getTokens())!.accessToken).toBe("access-token-abc");
  });

  test("writes the token, but the next read evicts it", async () => {
    await completeSsoLoginFromUrl(expiredCallbackUrl);

    // It really did land on disk...
    expect(await rawStorageValue(GLOBAL_SSO_TOKEN_STORAGE_KEY)).toBe(
      expiredGlobalToken,
    );

    // ...and the reader refuses to hand back something the server will reject.
    expect(await getGlobalSsoToken()).toBeNull();

    // The eviction is persistent, not just a filtered read.
    expect(await rawStorageValue(GLOBAL_SSO_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test("an expired PROJECT token is evicted the same way", async () => {
    const expiredProjectToken: string = lapsedJwt("project-sso");

    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        ssoToken: expiredProjectToken,
        projectId: "project-42",
      }),
    );

    expect(await rawStorageValue(SSO_TOKENS_STORAGE_KEY)).toBe(
      JSON.stringify({ "project-42": expiredProjectToken }),
    );
    expect(await getSsoTokens()).toEqual({});
  });
});

describe("The auth tokens are persisted first, and unconditionally", () => {
  test("a callback with neither kind of SSO token still signs the user in", async () => {
    /*
     * The ordinary case for an instance with no SSO enforcement: the callback
     * carries auth tokens and nothing else. Gating the keychain write behind
     * an SSO token would break plain SSO logins entirely.
     */
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl(authParams()),
    );

    expect(outcome).toEqual({
      status: "success",
      isGlobal: false,
      projectId: null,
    });
    expect((await getTokens())!.refreshToken).toBe("refresh-token-def");
    expect(await rawStorageValue(SSO_TOKENS_STORAGE_KEY)).toBeNull();
    expect(await rawStorageValue(GLOBAL_SSO_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test("the keychain write happens before the SSO token writes", async () => {
    /*
     * Ordering matters because these are separate awaits: if the process is
     * killed part-way through (or a write throws), the recoverable state is
     * "signed in, SSO token missing" - the app can re-run SSO. The reverse,
     * an SSO token with no session, is unusable and invisible.
     */
    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        globalSsoToken: freshJwt("global-sso"),
        ssoToken: freshJwt("project-sso"),
        projectId: "project-42",
      }),
    );

    const writtenKeys: Array<string> = (
      AsyncStorage.setItem as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      return call[0] as string;
    });

    expect(writtenKeys[0]).toBe(KEYCHAIN_STORAGE_KEY);
    expect(writtenKeys).toContain(GLOBAL_SSO_TOKEN_STORAGE_KEY);
    expect(writtenKeys).toContain(SSO_TOKENS_STORAGE_KEY);
  });

  test("a callback with a projectId but no ssoToken writes no project entry", async () => {
    /*
     * Half a project pair is not a project login. Storing `undefined` (or the
     * project id itself) under the project would put a garbage value into the
     * `x-sso-tokens` header on every subsequent request.
     */
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({ ...authParams(), projectId: "project-42" }),
    );

    expect(outcome).toEqual({
      status: "success",
      isGlobal: false,
      projectId: null,
    });
    expect(await rawStorageValue(SSO_TOKENS_STORAGE_KEY)).toBeNull();
  });

  test("a callback with an ssoToken but no projectId writes no project entry", async () => {
    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        ssoToken: freshJwt("project-sso"),
      }),
    );

    expect(outcome.status).toBe("success");
    expect(await rawStorageValue(SSO_TOKENS_STORAGE_KEY)).toBeNull();
  });
});

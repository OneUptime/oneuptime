import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearAllSsoTokens,
  getCachedGlobalSsoToken,
  getCachedSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
  removeGlobalSsoToken,
  removeSsoToken,
  storeGlobalSsoToken,
  storeSsoToken,
} from "./ssoTokens";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The SSO token store is the only thing standing between a signed-in responder
 * and a wall of 406s. The server answers 406 - with no explanation - for every
 * request against an SSO-enforced project whose token has lapsed, so a store
 * that keeps handing out a dead token produces an app that appears broken
 * rather than one that asks the user to sign in again. Nearly every test below
 * is about that eviction path, not about the round-trip.
 *
 * The two storage keys are the on-disk contract with every already-installed
 * copy of the app. They are deliberately re-stated here rather than imported:
 * the module does not export them, and a rename would silently strand the
 * token of every user who upgrades.
 */
const STORAGE_KEY: string = "oneuptime_sso_tokens";
const GLOBAL_STORAGE_KEY: string = "oneuptime_global_sso_token";

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/*
 * JWTs are minted here rather than pasted in as fixtures so that every expiry
 * case can be written relative to "now". A checked-in fixture with a real `exp`
 * would start passing for the wrong reason - or start failing - the day it went
 * past its own expiry.
 *
 * Payloads are pure ASCII JSON, so a byte is a char; no UTF-8 handling needed.
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

  // JWT flavour: base64url, and padding is omitted.
  return encoded.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Mints an unsigned-but-well-formed JWT. Pass null to omit the `exp` claim
 * entirely, which the decoder treats as "never expires".
 */
function mintJwt(expiresInSeconds: number | null, subject: string): string {
  const header: string = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );

  const claims: Record<string, unknown> = { sub: subject };

  if (expiresInSeconds !== null) {
    claims["exp"] = Math.floor(Date.now() / 1000) + expiresInSeconds;
  }

  const payload: string = base64UrlEncode(JSON.stringify(claims));

  /*
   * The app never verifies the signature - the server does - so any third
   * segment is as good as a real one for these tests.
   */
  return `${header}.${payload}.not-a-real-signature`;
}

function liveToken(subject: string): string {
  return mintJwt(60 * 60, subject);
}

function expiredToken(subject: string): string {
  return mintJwt(-60 * 60, subject);
}

function setItemMock(): jest.Mock {
  return AsyncStorage.setItem as unknown as jest.Mock;
}

async function persistedSsoTokens(): Promise<Record<string, unknown>> {
  const raw: string | null = await AsyncStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

/*
 * The AsyncStorage mock in src/__tests__/setup.ts is a module-level Map that
 * survives between tests, and ssoTokens.ts holds its own in-memory caches that
 * survive with it. Both have to be reset, or a test inherits the previous
 * test's signed-in state.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  setItemMock().mockClear();
  (AsyncStorage.removeItem as unknown as jest.Mock).mockClear();
});

describe("per-project tokens round-trip", () => {
  test("a stored token comes back", async () => {
    const token: string = liveToken("project-1");

    await storeSsoToken("project-1", token);

    expect(await getSsoTokens()).toEqual({ "project-1": token });
  });

  test("several projects are kept side by side", async () => {
    /*
     * A responder can belong to more than one SSO-enforced project, each with
     * its own token. Storing the second must not overwrite the first - that
     * would sign the user out of project A every time they opened project B.
     */
    const first: string = liveToken("project-1");
    const second: string = liveToken("project-2");
    const third: string = liveToken("project-3");

    await storeSsoToken("project-1", first);
    await storeSsoToken("project-2", second);
    await storeSsoToken("project-3", third);

    expect(await getSsoTokens()).toEqual({
      "project-1": first,
      "project-2": second,
      "project-3": third,
    });
  });

  test("re-storing a project replaces only that project's token", async () => {
    const original: string = liveToken("project-1");
    const renewed: string = mintJwt(60 * 60 * 24, "project-1-renewed");
    const untouched: string = liveToken("project-2");

    await storeSsoToken("project-1", original);
    await storeSsoToken("project-2", untouched);
    await storeSsoToken("project-1", renewed);

    expect(await getSsoTokens()).toEqual({
      "project-1": renewed,
      "project-2": untouched,
    });
  });

  test("a device that has never signed in with SSO has no tokens", async () => {
    expect(await getSsoTokens()).toEqual({});
  });

  test("tokens are persisted under the key the app has always used", async () => {
    const token: string = liveToken("project-1");

    await storeSsoToken("project-1", token);

    expect(await persistedSsoTokens()).toEqual({ "project-1": token });
  });
});

describe("the global token round-trips", () => {
  test("a stored global token comes back", async () => {
    const token: string = liveToken("global");

    await storeGlobalSsoToken(token);

    expect(await getGlobalSsoToken()).toBe(token);
  });

  test("a device with no global login has no global token", async () => {
    expect(await getGlobalSsoToken()).toBeNull();
  });

  test("the global token is stored raw, not wrapped in JSON", async () => {
    /*
     * It goes out on the x-global-sso-token header verbatim. A JSON-quoted
     * value would be rejected by the server as a malformed JWT.
     */
    const token: string = liveToken("global");

    await storeGlobalSsoToken(token);

    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEY)).toBe(token);
  });

  test("the global token lives in its own key, clear of the per-project map", async () => {
    const projectToken: string = liveToken("project-1");
    const globalTokenValue: string = liveToken("global");

    await storeSsoToken("project-1", projectToken);
    await storeGlobalSsoToken(globalTokenValue);

    expect(await persistedSsoTokens()).toEqual({ "project-1": projectToken });
    expect(await getGlobalSsoToken()).toBe(globalTokenValue);
  });
});

describe("the synchronous caches the API client reads from", () => {
  /*
   * The axios interceptor cannot await storage, so it reads these caches. If a
   * cache goes stale the header is wrong, and a wrong header is a 406 - so the
   * cache being refreshed on every read matters as much as the value itself.
   */
  test("storing a project token populates the cache immediately", async () => {
    const token: string = liveToken("project-1");

    await storeSsoToken("project-1", token);

    expect(getCachedSsoTokens()).toEqual({ "project-1": token });
  });

  test("storing the global token populates the cache immediately", async () => {
    const token: string = liveToken("global");

    await storeGlobalSsoToken(token);

    expect(getCachedGlobalSsoToken()).toBe(token);
  });

  test("getSsoTokens refreshes a cache that never saw the write", async () => {
    /*
     * What a cold start looks like: the token is on disk from a previous run,
     * so the cache is empty until something reads storage.
     */
    const token: string = liveToken("project-1");

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": token }),
    );

    expect(getCachedSsoTokens()).toEqual({});

    await getSsoTokens();

    expect(getCachedSsoTokens()).toEqual({ "project-1": token });
  });

  test("getGlobalSsoToken refreshes a cache that never saw the write", async () => {
    const token: string = liveToken("global");

    await AsyncStorage.setItem(GLOBAL_STORAGE_KEY, token);

    expect(getCachedGlobalSsoToken()).toBeNull();

    await getGlobalSsoToken();

    expect(getCachedGlobalSsoToken()).toBe(token);
  });

  test("getSsoTokens empties a cache whose backing store has gone", async () => {
    await storeSsoToken("project-1", liveToken("project-1"));
    await AsyncStorage.removeItem(STORAGE_KEY);

    await getSsoTokens();

    expect(getCachedSsoTokens()).toEqual({});
  });
});

describe("expired tokens are evicted on read", () => {
  test("an expired project token is not returned", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": expiredToken("project-1") }),
    );

    expect(await getSsoTokens()).toEqual({});
  });

  test("an expired project token is deleted from storage, not just hidden", async () => {
    /*
     * Hiding it would be enough for this run, but the value would come back on
     * the next cold start and the app would be stuck in the same 406 loop
     * forever. It has to actually leave the disk.
     */
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": expiredToken("project-1") }),
    );

    await getSsoTokens();

    expect(await persistedSsoTokens()).toEqual({});
  });

  test("a mix of expired and live tokens keeps exactly the live ones", async () => {
    const live1: string = liveToken("project-1");
    const live3: string = liveToken("project-3");

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "project-1": live1,
        "project-2": expiredToken("project-2"),
        "project-3": live3,
        "project-4": expiredToken("project-4"),
      }),
    );

    const tokens: Record<string, string> = await getSsoTokens();

    expect(tokens).toEqual({ "project-1": live1, "project-3": live3 });
    expect(await persistedSsoTokens()).toEqual({
      "project-1": live1,
      "project-3": live3,
    });
  });

  test("the cache is left holding only the live tokens too", async () => {
    const live1: string = liveToken("project-1");

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "project-1": live1,
        "project-2": expiredToken("project-2"),
      }),
    );

    await getSsoTokens();

    expect(getCachedSsoTokens()).toEqual({ "project-1": live1 });
  });

  test("a token that is not a JWT at all counts as expired", async () => {
    /*
     * An unreadable token is worse than a lapsed one - the app cannot even say
     * when it died - so it is treated identically rather than being sent and
     * rejected.
     */
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": "definitely-not-a-jwt" }),
    );

    expect(await getSsoTokens()).toEqual({});
    expect(await persistedSsoTokens()).toEqual({});
  });

  test("an empty-string token counts as expired", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": "" }),
    );

    expect(await getSsoTokens()).toEqual({});
    expect(await persistedSsoTokens()).toEqual({});
  });

  test("a non-string value in the map is evicted rather than sent", async () => {
    /*
     * Nothing in the app writes this shape, but a value from an older build or
     * a half-written file would otherwise reach axios as a header value and
     * throw inside the interceptor.
     */
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": 42, "project-2": null }),
    );

    expect(await getSsoTokens()).toEqual({});
    expect(await persistedSsoTokens()).toEqual({});
  });

  test("a token expiring inside the leeway window is already treated as dead", async () => {
    /*
     * jwt.ts retires a token 30s early so a request that is in flight when the
     * clock crosses `exp` does not come back rejected. Ten seconds of life left
     * is therefore no life at all.
     */
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": mintJwt(10, "project-1") }),
    );

    expect(await getSsoTokens()).toEqual({});
  });

  test("a well-formed token with no exp claim is kept", async () => {
    /*
     * The server reads a missing `exp` as "does not expire", so the client must
     * not invent an expiry and sign the user out of a session that is fine.
     */
    const neverExpires: string = mintJwt(null, "project-1");

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": neverExpires }),
    );

    expect(await getSsoTokens()).toEqual({ "project-1": neverExpires });
  });

  test("an all-live store is not written back", async () => {
    /*
     * getSsoTokens runs on every single request through the interceptor path.
     * Re-serialising and re-writing the whole map each time would put a disk
     * write on the hot path for no reason, so the write-back is conditional on
     * something actually having been evicted.
     */
    const live1: string = liveToken("project-1");
    const live2: string = liveToken("project-2");

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "project-1": live1, "project-2": live2 }),
    );
    setItemMock().mockClear();

    /*
     * Asserting the returned tokens as well, so that "nothing was written" can
     * never pass because nothing was read.
     */
    expect(await getSsoTokens()).toEqual({
      "project-1": live1,
      "project-2": live2,
    });
    expect(setItemMock()).not.toHaveBeenCalled();
  });

  test("an eviction does write back, exactly once", async () => {
    const live1: string = liveToken("project-1");

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "project-1": live1,
        "project-2": expiredToken("project-2"),
      }),
    );
    setItemMock().mockClear();

    await getSsoTokens();

    expect(setItemMock()).toHaveBeenCalledTimes(1);
    expect(setItemMock().mock.calls[0]![0]).toBe(STORAGE_KEY);
    expect(JSON.parse(setItemMock().mock.calls[0]![1] as string)).toEqual({
      "project-1": live1,
    });
  });

  test("an expired global token reads as absent", async () => {
    await AsyncStorage.setItem(GLOBAL_STORAGE_KEY, expiredToken("global"));

    expect(await getGlobalSsoToken()).toBeNull();
  });

  test("an expired global token is deleted from storage", async () => {
    await AsyncStorage.setItem(GLOBAL_STORAGE_KEY, expiredToken("global"));

    await getGlobalSsoToken();

    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEY)).toBeNull();
  });

  test("an expired global token also clears the cache the interceptor reads", async () => {
    const token: string = expiredToken("global");

    // storeGlobalSsoToken caches whatever it is handed, without judging it.
    await storeGlobalSsoToken(token);
    expect(getCachedGlobalSsoToken()).toBe(token);

    await getGlobalSsoToken();

    expect(getCachedGlobalSsoToken()).toBeNull();
  });

  test("a global value that is not a JWT is evicted too", async () => {
    await AsyncStorage.setItem(GLOBAL_STORAGE_KEY, "garbage");

    expect(await getGlobalSsoToken()).toBeNull();
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEY)).toBeNull();
  });

  test("a missing global key is not needlessly removed again", async () => {
    /*
     * The removal is guarded on there having been a value. Without the guard
     * every unauthenticated read would issue a pointless disk delete.
     */
    await getGlobalSsoToken();

    expect(
      AsyncStorage.removeItem as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  test("a live global token survives a read untouched", async () => {
    const token: string = liveToken("global");

    await storeGlobalSsoToken(token);
    setItemMock().mockClear();

    expect(await getGlobalSsoToken()).toBe(token);
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEY)).toBe(token);
    expect(
      AsyncStorage.removeItem as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });
});

describe("removing tokens", () => {
  test("removeSsoToken drops one project and leaves the rest signed in", async () => {
    const keep1: string = liveToken("project-1");
    const keep3: string = liveToken("project-3");

    await storeSsoToken("project-1", keep1);
    await storeSsoToken("project-2", liveToken("project-2"));
    await storeSsoToken("project-3", keep3);

    await removeSsoToken("project-2");

    expect(await getSsoTokens()).toEqual({
      "project-1": keep1,
      "project-3": keep3,
    });
    expect(await persistedSsoTokens()).toEqual({
      "project-1": keep1,
      "project-3": keep3,
    });
  });

  test("removeSsoToken for a project that was never stored changes nothing", async () => {
    const token: string = liveToken("project-1");

    await storeSsoToken("project-1", token);

    await removeSsoToken("project-unknown");

    expect(await getSsoTokens()).toEqual({ "project-1": token });
  });

  test("removeSsoToken leaves the global token alone", async () => {
    /*
     * Signing out of one project must not sign the user out of the instance -
     * the global token is not scoped to any project.
     */
    const globalTokenValue: string = liveToken("global");

    await storeSsoToken("project-1", liveToken("project-1"));
    await storeGlobalSsoToken(globalTokenValue);

    await removeSsoToken("project-1");

    expect(await getGlobalSsoToken()).toBe(globalTokenValue);
  });

  test("removeGlobalSsoToken clears the global token and its cache", async () => {
    await storeGlobalSsoToken(liveToken("global"));

    await removeGlobalSsoToken();

    expect(await getGlobalSsoToken()).toBeNull();
    expect(getCachedGlobalSsoToken()).toBeNull();
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEY)).toBeNull();
  });

  test("removeGlobalSsoToken leaves per-project tokens signed in", async () => {
    const projectToken: string = liveToken("project-1");

    await storeSsoToken("project-1", projectToken);
    await storeGlobalSsoToken(liveToken("global"));

    await removeGlobalSsoToken();

    expect(await getSsoTokens()).toEqual({ "project-1": projectToken });
    expect(getCachedSsoTokens()).toEqual({ "project-1": projectToken });
  });
});

describe("clearAllSsoTokens", () => {
  test("clears both stores and both caches", async () => {
    /*
     * This is the logout path. Anything left behind here is a token belonging
     * to the previous user, sitting on a shared device.
     */
    await storeSsoToken("project-1", liveToken("project-1"));
    await storeSsoToken("project-2", liveToken("project-2"));
    await storeGlobalSsoToken(liveToken("global"));

    await clearAllSsoTokens();

    expect(getCachedSsoTokens()).toEqual({});
    expect(getCachedGlobalSsoToken()).toBeNull();
    expect(await getSsoTokens()).toEqual({});
    expect(await getGlobalSsoToken()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEY)).toBeNull();
  });

  test("is safe to call when nothing was ever stored", async () => {
    await expect(clearAllSsoTokens()).resolves.toBeUndefined();
  });
});

describe("corrupt storage is survivable", () => {
  /*
   * Every one of these reaches the axios interceptor on app start. A throw
   * there is not a failed SSO login - it is an app that cannot make any request
   * at all, including the ones that would let the user sign in again and repair
   * the state. Returning {} is the only safe answer.
   */
  test.each([
    ["a truncated write", "{not json at all"],
    ["a JSON array", "[]"],
    ["a JSON array of tokens", '["token-a","token-b"]'],
    ["a bare JSON string", '"just-a-string"'],
    ["a JSON null", "null"],
    ["a JSON number", "42"],
    ["an empty string", ""],
  ])(
    "%s yields no tokens instead of throwing",
    async (_label: string, stored: string): Promise<void> => {
      await AsyncStorage.setItem(STORAGE_KEY, stored);

      await expect(getSsoTokens()).resolves.toEqual({});
    },
  );

  test("corrupt storage empties the cache rather than leaving it stale", async () => {
    await storeSsoToken("project-1", liveToken("project-1"));
    await AsyncStorage.setItem(STORAGE_KEY, "{not json at all");

    await getSsoTokens();

    expect(getCachedSsoTokens()).toEqual({});
  });

  test("a later store repairs a corrupt map", async () => {
    /*
     * The recovery path: the user signs in again, and the bad value is
     * overwritten with a well-formed map rather than the app being wedged.
     */
    const token: string = liveToken("project-1");

    await AsyncStorage.setItem(STORAGE_KEY, "{not json at all");

    await storeSsoToken("project-1", token);

    expect(await getSsoTokens()).toEqual({ "project-1": token });
    expect(await persistedSsoTokens()).toEqual({ "project-1": token });
  });
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearTokens,
  getCachedAccessToken,
  getTokens,
  storeTokens,
  type StoredTokens,
} from "./keychain";
import { getServerUrl, setServerUrl } from "./serverUrl";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * This module holds the session, and it holds it twice: once on disk, where it
 * survives the app being killed, and once in a module-level variable that the
 * axios request interceptor reads. The interceptor is synchronous - it cannot
 * await storage on its way to attaching the Authorization header - so that
 * cached copy IS what signs every request the app makes.
 *
 * That makes the cache, not the disk, the thing most of these tests are about.
 * A cache that misses a write leaves a signed-in responder sending unsigned
 * requests and being bounced to the login screen mid-incident; a cache left
 * holding a token whose backing store is gone or unreadable does the opposite
 * and keeps signing requests as a user who is no longer there. Every read path
 * in getTokens therefore has to leave the cache agreeing with storage, and
 * there is a test below for each of them.
 */

/*
 * Restated rather than imported, because the module does not export it. The key
 * is the on-disk contract with every already-installed copy of the app:
 * renaming it would not log anyone out so much as silently lose them, since the
 * old session would sit unreachable under the old name.
 */
const STORAGE_KEY: string = "com.oneuptime.oncall.tokens";
const SERVER_URL_STORAGE_KEY: string = "oneuptime_server_url";

const SELF_HOSTED_URL: string = "https://oneuptime.acme.internal";

/*
 * A factory rather than a shared constant so that a test which stores a session
 * and then asserts on it cannot be reading back a mutated fixture, and so that
 * the "a refresh replaces the session" cases can differ in exactly one field.
 */
function makeTokens(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/*
 * Reads the raw slot, so the tests that care about what is actually on disk do
 * not have to go back through getTokens - which would repopulate the cache and
 * hide the very thing they are asserting.
 */
async function persistedSession(): Promise<unknown> {
  const raw: string | null = await AsyncStorage.getItem(STORAGE_KEY);

  if (raw === null) {
    return null;
  }

  return JSON.parse(raw);
}

/*
 * The AsyncStorage mock in src/__tests__/setup.ts is one Map for the whole
 * file, and the token cache in keychain.ts is one variable for the whole file.
 * clearTokens empties both, which is exactly the reset these tests need; going
 * through it rather than reaching into the module also means the reset itself
 * would fail loudly if it ever stopped clearing both.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  await clearTokens();
});

describe("storeTokens and getTokens round-trip the session", () => {
  test("a stored session comes back field for field", async () => {
    /*
     * All three fields matter downstream: the access token signs requests, the
     * refresh token buys a new one, and the expiry is how the app decides
     * whether refreshing is even worth attempting. Dropping any one of them on
     * the way through storage would surface as a mystery sign-out later.
     */
    const tokens: StoredTokens = makeTokens();

    await storeTokens(tokens);

    expect(await getTokens()).toEqual(tokens);
  });

  test("a refresh replaces the previous session outright", async () => {
    /*
     * Refresh is the common case, not the exceptional one - it runs whenever a
     * short-lived access token lapses. A merge, or a write that lost to the
     * older value, would leave the app re-presenting a token the server has
     * already retired.
     */
    const first: StoredTokens = makeTokens();
    const second: StoredTokens = makeTokens({
      accessToken: "second-access-token",
      refreshToken: "second-refresh-token",
    });

    await storeTokens(first);
    await storeTokens(second);

    expect(await getTokens()).toEqual(second);
  });

  test("the session is stored as JSON under the keychain module's own key", async () => {
    const tokens: StoredTokens = makeTokens();

    await storeTokens(tokens);

    expect(await persistedSession()).toEqual(tokens);
  });
});

describe("the synchronous cache the request interceptor reads", () => {
  test("storeTokens fills the cache before anything reads storage back", async () => {
    /*
     * The first request after a login usually goes out in the same tick as the
     * login response is handled, long before anything calls getTokens. If the
     * cache were only filled on read, that request would go out unsigned and
     * the responder would appear to have failed to log in.
     */
    const tokens: StoredTokens = makeTokens();

    expect(getCachedAccessToken()).toBeNull();

    await storeTokens(tokens);

    expect(getCachedAccessToken()).toBe(tokens.accessToken);
  });

  test("a refresh replaces the cached token as well as the stored one", async () => {
    /*
     * A cache that kept the old value here would sign every subsequent request
     * with a token the server has just rotated away - a 401 loop that looks
     * like an expired session no matter how recently the user signed in.
     */
    await storeTokens(makeTokens());
    await storeTokens(makeTokens({ accessToken: "second-access-token" }));

    expect(getCachedAccessToken()).toBe("second-access-token");
  });

  test("getTokens fills a cache that never saw the write", async () => {
    /*
     * What a cold start looks like: the session is on disk from a previous run
     * of the app, so the module variable begins at null and stays there until
     * something reads storage. Written straight to the slot rather than through
     * storeTokens precisely because storeTokens would populate the cache and
     * there would be nothing left to prove.
     */
    const tokens: StoredTokens = makeTokens();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));

    expect(getCachedAccessToken()).toBeNull();

    expect(await getTokens()).toEqual(tokens);
    expect(getCachedAccessToken()).toBe(tokens.accessToken);
  });

  test("an unparseable blob yields no session and empties the cache", async () => {
    /*
     * Storage can come back truncated - a write interrupted by the OS killing
     * the app is the usual way. The dangerous outcome is not the null return,
     * it is the cache: leaving the previous token in place would keep signing
     * requests as whoever was last signed in on this device, while the app
     * itself believes nobody is.
     */
    await storeTokens(makeTokens());
    expect(getCachedAccessToken()).toBe("access-token");

    await AsyncStorage.setItem(STORAGE_KEY, '{"accessToken": "trunc');

    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
  });

  test("an absent session yields null and empties the cache", async () => {
    /*
     * The store can be emptied from outside this module - an OS-level clear of
     * app data, or another code path removing the key. The cache has to follow
     * storage rather than outlive it.
     */
    await storeTokens(makeTokens());
    await AsyncStorage.removeItem(STORAGE_KEY);

    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
  });

  test("an empty value counts as no session at all", async () => {
    /*
     * "" is a distinct failure from a missing key - a write that opened the
     * slot and stored nothing in it - and it is not valid JSON, so it has to be
     * turned away before parsing rather than through the parse failure path.
     */
    await storeTokens(makeTokens());
    await AsyncStorage.setItem(STORAGE_KEY, "");

    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
  });
});

describe("clearTokens", () => {
  test("removes the session from storage", async () => {
    await storeTokens(makeTokens());

    await clearTokens();

    expect(await persistedSession()).toBeNull();
  });

  test("empties the cache, so the next request goes out unsigned", async () => {
    /*
     * This is the half of signing out that has teeth. Storage being cleared
     * only matters at the next cold start; the cache being cleared is what
     * stops the very next request from carrying the departed user's token.
     */
    await storeTokens(makeTokens());
    expect(getCachedAccessToken()).toBe("access-token");

    await clearTokens();

    expect(getCachedAccessToken()).toBeNull();
  });

  test("leaves getTokens with nothing to find", async () => {
    await storeTokens(makeTokens());
    await clearTokens();

    expect(await getTokens()).toBeNull();
  });

  test("is harmless when there is no session to clear", async () => {
    /*
     * Sign-out runs on paths that cannot know whether a session exists - an
     * auth failure handler firing twice, for one - so a redundant clear has to
     * be a no-op rather than an error.
     */
    await clearTokens();

    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
  });
});

describe("the session and the server URL are kept apart", () => {
  /*
   * Where to call and who to call as are stored by different modules under
   * different keys, and the app relies on that: it signs users in and out far
   * more often than it changes instances. serverUrl.test.ts pins the same
   * separation from the other side.
   */
  test("storing a session does not disturb the configured server", async () => {
    await setServerUrl(SELF_HOSTED_URL);
    await storeTokens(makeTokens());

    expect(await AsyncStorage.getItem(SERVER_URL_STORAGE_KEY)).toBe(
      SELF_HOSTED_URL,
    );
    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });

  test("signing out leaves the configured server in place", async () => {
    /*
     * A self-hosted responder who signs out should land on the login screen for
     * their own instance. If clearing the session also cleared the URL they
     * would land on the setup screen instead, be asked to remember an internal
     * hostname, and - failing that - be quietly handed the hosted default.
     */
    await setServerUrl(SELF_HOSTED_URL);
    await storeTokens(makeTokens());

    await clearTokens();

    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });
});

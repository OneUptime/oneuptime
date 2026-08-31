import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearServerUrl,
  getServerUrl,
  hasServerUrl,
  setServerUrl,
} from "./serverUrl";
import {
  clearTokens,
  getTokens,
  storeTokens,
  type StoredTokens,
} from "./keychain";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * One string decides which OneUptime this install talks to. Every request the
 * app makes - the login, the token refresh, every page fetch - is resolved
 * against whatever getServerUrl() hands back, so for a self-hosted responder a
 * lost or mangled URL is not a degraded app: it is an app quietly pointed at
 * oneuptime.com, where their credentials mean nothing and their on-call
 * dashboard is empty. The tests below are about the two ways that happens -
 * the default firing when a server WAS configured, and a configured server
 * coming back in a shape axios cannot use.
 */

/*
 * The key and the default are restated here rather than imported, because the
 * module does not export them. Both are contracts with the outside world: the
 * key is what every already-installed copy of the app wrote its server URL
 * under, so renaming it strands every upgrading self-hosted user back on the
 * setup screen, and the default is the address the hosted product answers on.
 */
const STORAGE_KEY: string = "oneuptime_server_url";
const DEFAULT_SERVER_URL: string = "https://oneuptime.com";

const SELF_HOSTED_URL: string = "https://oneuptime.acme.internal";
const OTHER_SELF_HOSTED_URL: string = "https://oneuptime.beta.internal";

const SESSION: StoredTokens = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
};

/*
 * The AsyncStorage mock in src/__tests__/setup.ts is a single Map for the whole
 * file, and keychain.ts keeps a module-level token cache that outlives an
 * individual test the same way. Both are reset here so that no test inherits
 * the previous test's configured server or signed-in session.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  await clearTokens();
});

describe("getServerUrl", () => {
  test("falls back to the hosted product when nothing has been configured", async () => {
    /*
     * The fallback is what makes a fresh install of the App Store build usable
     * without a setup step, so it has to hold for the empty-storage case
     * exactly - this is the very first read the app ever performs.
     */
    expect(await getServerUrl()).toBe(DEFAULT_SERVER_URL);
  });

  test("returns the server that was configured", async () => {
    await setServerUrl(SELF_HOSTED_URL);

    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });

  test("returns the most recently configured server", async () => {
    /*
     * Moving an install from one instance to another is a re-run of the setup
     * screen, not a clear-then-set, so the second write has to win outright
     * rather than being merged with or ignored in favour of the first.
     */
    await setServerUrl(SELF_HOSTED_URL);
    await setServerUrl(OTHER_SELF_HOSTED_URL);

    expect(await getServerUrl()).toBe(OTHER_SELF_HOSTED_URL);
  });
});

describe("setServerUrl normalizes before it stores", () => {
  /*
   * axios joins baseURL and path by concatenation, so a stored
   * "https://host/" turns every call into "https://host//api/...". Some
   * servers and proxies tolerate the doubled slash and some answer 404, and
   * the responder who typed the trailing slash has no way to tell which
   * happened. Stripping it once on the way in is what keeps that failure from
   * existing at all.
   */
  test("strips a single trailing slash", async () => {
    await setServerUrl(`${SELF_HOSTED_URL}/`);

    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });

  test("strips a run of trailing slashes", async () => {
    /*
     * A URL that has been pasted, edited and re-pasted collects more than one.
     * Trimming only the last would leave exactly the doubled-slash request the
     * single-slash case exists to prevent.
     */
    await setServerUrl(`${SELF_HOSTED_URL}///`);

    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });

  test("leaves a URL that needs no normalizing untouched", async () => {
    await setServerUrl(SELF_HOSTED_URL);

    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });

  test("keeps a path prefix, which is how an instance behind a shared host is reached", async () => {
    /*
     * Self-hosted OneUptime is commonly published on a path of an existing
     * hostname rather than on its own. Normalizing away that path would point
     * the app at the wrong service entirely, so only the trailing slash may go.
     */
    await setServerUrl("https://acme.internal/oneuptime");

    expect(await getServerUrl()).toBe("https://acme.internal/oneuptime");
  });

  test("strips the trailing slash of a path prefix without touching the separators inside it", async () => {
    await setServerUrl("https://acme.internal/tools/oneuptime/");

    expect(await getServerUrl()).toBe("https://acme.internal/tools/oneuptime");
  });

  test("writes the normalized value under its own key", async () => {
    /*
     * Asserted through storage rather than through getServerUrl so that the
     * key itself is pinned: a rename would still round-trip within this
     * module while stranding every installed copy of the app.
     */
    await setServerUrl(`${SELF_HOSTED_URL}/`);

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(SELF_HOSTED_URL);
  });
});

describe("hasServerUrl", () => {
  /*
   * useAuth gates the entire launch on this answer: false sends the user to the
   * server URL screen, true lets the stored session restore. It asks whether
   * the key is PRESENT, which is not the same question as whether the value is
   * usable.
   */
  test("is false before a server has ever been configured", async () => {
    expect(await hasServerUrl()).toBe(false);
  });

  test("is true once a server has been configured", async () => {
    await setServerUrl(SELF_HOSTED_URL);

    expect(await hasServerUrl()).toBe(true);
  });

  test("is true for an empty string, because the key was still written", async () => {
    /*
     * "" is falsy, so the natural assumption is that it reads as "no server
     * configured". It does not - presence is the test, and an empty string was
     * still stored. Worth pinning precisely because the two readers in this
     * module part company here: getServerUrl treats "" as absent and returns
     * the default, while hasServerUrl treats it as configured. Today only the
     * ServerUrlScreen's own empty-input guard keeps that disagreement out of
     * reach, so anything that writes this key without that guard inherits it.
     */
    await setServerUrl("");

    expect(await hasServerUrl()).toBe(true);
  });

  test("is false again once the server is cleared", async () => {
    await setServerUrl(SELF_HOSTED_URL);
    await clearServerUrl();

    expect(await hasServerUrl()).toBe(false);
  });
});

describe("clearServerUrl", () => {
  test("removes the key rather than blanking it", async () => {
    /*
     * The distinction is the whole of hasServerUrl's behaviour: a blanked value
     * would still count as configured and would send the user past the setup
     * screen with nothing to connect to.
     */
    await setServerUrl(SELF_HOSTED_URL);
    await clearServerUrl();

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("sends getServerUrl back to the default", async () => {
    await setServerUrl(SELF_HOSTED_URL);
    await clearServerUrl();

    expect(await getServerUrl()).toBe(DEFAULT_SERVER_URL);
  });

  test("is harmless when no server was ever configured", async () => {
    await clearServerUrl();

    expect(await hasServerUrl()).toBe(false);
    expect(await getServerUrl()).toBe(DEFAULT_SERVER_URL);
  });
});

describe("the server URL and the session are kept apart", () => {
  /*
   * These two modules are the entirety of what identifies an install: where to
   * call, and who to call as. They are read and written on different schedules
   * - the URL once at setup, the session on every refresh - so if they ever
   * shared a slot, one would silently take the other with it. The tests below
   * pin the separation from the server URL side; keychain.test.ts pins the
   * other direction.
   */
  test("the two modules write to different keys", async () => {
    await setServerUrl(SELF_HOSTED_URL);
    await storeTokens(SESSION);

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(SELF_HOSTED_URL);
    expect(await getTokens()).toEqual(SESSION);
  });

  test("configuring a server does not disturb a stored session", async () => {
    await storeTokens(SESSION);
    await setServerUrl(SELF_HOSTED_URL);

    expect(await getTokens()).toEqual(SESSION);
  });

  test("clearing the server URL does not reach into the session store", async () => {
    /*
     * Signing out is keychain's job and nothing else's. If clearing the URL
     * also dropped the session, the two would be impossible to reason about
     * separately at the call sites that do one without the other.
     */
    await setServerUrl(SELF_HOSTED_URL);
    await storeTokens(SESSION);

    await clearServerUrl();

    expect(await getTokens()).toEqual(SESSION);
  });
});

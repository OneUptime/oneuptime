import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearTokens,
  getCachedAccessToken,
  getTokens,
  storeTokens,
  type StoredTokens,
} from "../storage/keychain";
import { getServerUrl, setServerUrl } from "../storage/serverUrl";
import apiClient from "./client";
import { logout, validateServerUrl } from "./auth";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The two ends of a session in src/api/auth.ts: the reachability probe that
 * runs BEFORE anybody has typed a password, and the sign-out that runs after
 * they have finished. src/api/authTwoFactor.test.ts covers everything in
 * between.
 *
 * Both are unusual for this app, and both in the same way: they are the two
 * calls that must still do the right thing when the request FAILS.
 *
 *   - validateServerUrl is the gate on the connect screen. It is the one call
 *     in the app that is expected to fail routinely - a typo, a VPN that is
 *     not up, a self-hosted host name that only resolves inside the office -
 *     and the screen turns its answer straight into "connect" or "could not
 *     connect". So it has to answer, never throw: an unhandled rejection here
 *     leaves the only screen the user can act on stuck behind a spinner, on an
 *     app that does not yet know which OneUptime instance it belongs to.
 *
 *   - logout is the opposite shape. It is the call most likely to be made on a
 *     handset that has just lost the network, or by somebody about to hand the
 *     phone to a colleague, and the LOCAL half must happen either way. If it
 *     rejected, the caller (AuthProvider.logout in src/hooks/useAuth.tsx)
 *     would never reach the lines after it that drop the SSO tokens and the
 *     authenticated flag, and the user would still be signed in on the screen
 *     that just told them they were not.
 *
 * The probe also has to go out on the BARE axios import rather than the shared
 * apiClient, and that is worth a test of its own. The shared client stamps the
 * stored session's bearer token onto every request and resolves relative URLs
 * against the stored server; pointing it at a host somebody has only just
 * typed would send one instance's token to another, and would fire the
 * 401-refresh machinery against a server there is no session on.
 *
 * The /identity/logout request itself has a describe block of its own at the
 * bottom, and it is worth saying why it did not always. logout() used to reach
 * getTokens through `await import("../storage/keychain")` - the only dynamic
 * import in the app, of a module the same file already imports statically - and
 * under both Jest projects that import throws
 * ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG before the request is ever built.
 * The function's own bare `catch` swallowed it, so under test logout() was
 * exactly clearTokens() and nothing else, and every assertion about the request
 * would have passed for the wrong reason - "it did not post" trivially, "it
 * cleared the tokens anyway" without ever meeting the failure it claims to
 * tolerate. The import is static now, so the wire contract is pinned instead of
 * described.
 *
 * axios and apiClient are faked so the assertions are about the request
 * auth.ts builds. The token store and the server-url store are REAL over the
 * AsyncStorage mock in src/__tests__/setup.ts, so "is the user signed out" is
 * answered by reading the store back rather than by watching a spy.
 *
 * None of this is platform-specific, so every test here is expected to hold
 * under both the ios and the android Jest project.
 */

jest.mock("axios", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
    },
  };
});

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

/* The instance the app is already connected to, when it is connected. */
const SERVER_URL: string = "https://oneuptime.example.com";

/* The one somebody is typing into the connect screen right now. */
const CANDIDATE_URL: string = "https://selfhosted.example.com";

const ACCESS_TOKEN: string = "access-token-value";
const REFRESH_TOKEN: string = "refresh-token-value";
const REFRESH_EXPIRES_AT: string = "2026-09-04T12:00:00.000Z";

/*
 * Restated rather than imported from src/storage/keychain.ts on purpose: the
 * corrupt-blob tests below write to and read from the slot directly, and
 * naming the key here means a rename cannot quietly turn them into tests that
 * look somewhere nothing was ever written.
 */
const TOKEN_STORAGE_KEY: string = "com.oneuptime.oncall.tokens";

/**
 * An axios rejection, in the shape the app actually receives one.
 *
 * axios rejects for two quite different reasons - the request never got an
 * answer (no `response`), or the server answered outside 2xx (`response.
 * status`) - and validateServerUrl has to treat both as "not a server I can
 * connect to" without inspecting either.
 */
interface AxiosLikeError extends Error {
  code?: string;
  response?: { status: number };
}

function networkError(): AxiosLikeError {
  return new Error("Network Error") as AxiosLikeError;
}

function timeoutError(): AxiosLikeError {
  const error: AxiosLikeError = new Error(
    "timeout of 10000ms exceeded",
  ) as AxiosLikeError;

  error.code = "ECONNABORTED";

  return error;
}

function httpError(status: number): AxiosLikeError {
  const error: AxiosLikeError = new Error(
    `Request failed with status code ${status}`,
  ) as AxiosLikeError;

  error.response = { status };

  return error;
}

function getSpy(): jest.SpyInstance {
  return axios.get as unknown as jest.SpyInstance;
}

function clientGetSpy(): jest.SpyInstance {
  return apiClient.get as unknown as jest.SpyInstance;
}

function clientPostSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

/* What the status endpoint answers when there really is a server there. */
function respondWithStatus(status: number): void {
  getSpy().mockResolvedValue({
    status,
    data: { status: "ok" },
  } as never);
}

function lastProbeCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = getSpy().mock.calls;

  return calls[calls.length - 1]!;
}

function lastProbeUrl(): string {
  return lastProbeCall()[0] as string;
}

function lastProbeConfig(): Record<string, unknown> {
  return lastProbeCall()[1] as Record<string, unknown>;
}

function lastRevokeCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = clientPostSpy().mock.calls;

  return calls[calls.length - 1]!;
}

function lastRevokeUrl(): string {
  return lastRevokeCall()[0] as string;
}

function lastRevokeBody(): Record<string, unknown> {
  return lastRevokeCall()[1] as Record<string, unknown>;
}

function lastRevokeConfig(): Record<string, unknown> {
  return lastRevokeCall()[2] as Record<string, unknown>;
}

/* The session a signed-in handset is holding. */
async function storeSession(): Promise<void> {
  await storeTokens({
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    refreshTokenExpiresAt: REFRESH_EXPIRES_AT,
  });
}

beforeEach(async () => {
  /*
   * The AsyncStorage mock is a module-level Map shared by the whole file, and
   * the keychain keeps an in-memory copy of the access token beside it. Both
   * have to go, or "the tokens were cleared" passes because the PREVIOUS test
   * cleared them.
   */
  await AsyncStorage.clear();
  await clearTokens();
  await setServerUrl(SERVER_URL);

  getSpy().mockReset();
  clientGetSpy().mockReset();
  clientPostSpy().mockReset();
});

describe("validateServerUrl", () => {
  test("asks for the status endpoint the server actually mounts", async () => {
    /*
     * Common/Server/API/StatusAPI.ts serves GET /status under the /api mount,
     * and answers it without a session. Any other path - /status at the root,
     * an app route that needs auth - answers 404 or 401 for a perfectly good
     * server, and then every instance in the world reads as unreachable.
     */
    respondWithStatus(200);

    await validateServerUrl(CANDIDATE_URL);

    expect(lastProbeUrl()).toBe(`${CANDIDATE_URL}/api/status`);
  });

  test("gives the server ten seconds and then stops waiting", async () => {
    /*
     * axios has NO default timeout. A host that completes the TCP handshake
     * and then never answers - a captive portal, a firewalled port, a load
     * balancer with nothing behind it - would leave this promise pending for
     * as long as the OS allows, and the connect screen offers no way out: the
     * spinner is the whole UI at that point.
     */
    respondWithStatus(200);

    await validateServerUrl(CANDIDATE_URL);

    expect(lastProbeConfig()["timeout"]).toBe(10000);
  });

  test("probes the URL it was handed, not the one already stored", async () => {
    /*
     * This runs BEFORE the URL is saved - ServerUrlScreen only calls
     * setServerUrl once the probe has come back true. A regression that read
     * the store instead would probe the server the app is already connected
     * to, answer true, and then save the typo, stranding the user on an
     * instance that does not exist.
     */
    respondWithStatus(200);

    await validateServerUrl(CANDIDATE_URL);

    expect(lastProbeUrl()).toBe(`${CANDIDATE_URL}/api/status`);
    expect(lastProbeUrl()).not.toContain(SERVER_URL);
  });

  test("goes out on the bare client, never the authenticated one", async () => {
    /*
     * The shared apiClient stamps the stored session's bearer token onto every
     * request and runs the 401-refresh dance on the way back. Both are wrong
     * here: the host being probed is one somebody has only just typed and may
     * well have mistyped, so sending it a token belonging to a different
     * instance hands a credential to an arbitrary server, and a 401 from it
     * would kick off a token refresh there is no session to refresh.
     */
    respondWithStatus(200);

    await validateServerUrl(CANDIDATE_URL);

    expect(getSpy()).toHaveBeenCalledTimes(1);
    expect(clientGetSpy()).not.toHaveBeenCalled();
    expect(clientPostSpy()).not.toHaveBeenCalled();
  });

  test("a 200 is a server the app can connect to", async () => {
    respondWithStatus(200);

    await expect(validateServerUrl(CANDIDATE_URL)).resolves.toBe(true);
  });

  test("a 2xx that is not 200 is not good enough", async () => {
    /*
     * axios resolves the whole 2xx range, so this arrives on the success path
     * rather than in the catch. A 204 is what a proxy or a redirector answers
     * when it has swallowed the body - evidence that SOMETHING is listening,
     * not that a OneUptime API is behind it. Accepting it would save the URL
     * and move the user on to a login screen that cannot work.
     */
    respondWithStatus(204);

    await expect(validateServerUrl(CANDIDATE_URL)).resolves.toBe(false);
  });
});

describe("validateServerUrl treats every failure as an unreachable server", () => {
  test("a host that answers 404 is not a OneUptime instance", async () => {
    /*
     * The everyday wrong answer: a real, reachable web server that simply is
     * not this product. axios rejects it, and the screen needs a false back
     * rather than an exception.
     */
    getSpy().mockRejectedValue(httpError(404) as never);

    await expect(validateServerUrl(CANDIDATE_URL)).resolves.toBe(false);
  });

  test("a server erroring on its own status check is refused too", async () => {
    /*
     * A 500 here means the instance cannot answer the cheapest question it
     * has. Connecting anyway would let the user past the gate and produce the
     * same failure one screen later, where the message is about their password
     * instead of about their server.
     */
    getSpy().mockRejectedValue(httpError(500) as never);

    await expect(validateServerUrl(CANDIDATE_URL)).resolves.toBe(false);
  });

  test("a host that never answers is a no, not a crash", async () => {
    /*
     * This rejection carries no `response` at all - nothing resolved, or
     * nothing accepted the connection. Reading a status off it would throw a
     * TypeError from inside the catch, which is why the catch reads nothing.
     */
    getSpy().mockRejectedValue(networkError() as never);

    await expect(validateServerUrl(CANDIDATE_URL)).resolves.toBe(false);
  });

  test("a request that times out is a no", async () => {
    /* The other half of the ten second budget: it has to mean something. */
    getSpy().mockRejectedValue(timeoutError() as never);

    await expect(validateServerUrl(CANDIDATE_URL)).resolves.toBe(false);
  });

  test("an axios that throws before it ever leaves is still just a no", async () => {
    /*
     * A URL malformed enough - a missing scheme, a stray space - makes axios
     * throw SYNCHRONOUSLY rather than reject. That throw happens inside the
     * try, so it is caught the same way; a version of this that validated the
     * string first, or awaited outside the try, would let it escape, and an
     * unhandled rejection on the connect screen is an app that looks frozen on
     * the field the user is typing into.
     */
    getSpy().mockImplementation(() => {
      throw new TypeError("Invalid URL");
    });

    await expect(validateServerUrl("not a url")).resolves.toBe(false);
  });

  test("answers false rather than propagating whatever it caught", async () => {
    /*
     * Stated separately from the cases above because the contract being pinned
     * is the RETURN TYPE, not the outcome: the caller branches on a boolean and
     * has no handler of its own for a rejection. Anything thrown out of here
     * lands in ServerUrlScreen's outer catch and is reported as "an unexpected
     * error occurred", which tells the user nothing about the URL they got
     * wrong.
     */
    getSpy().mockRejectedValue(networkError() as never);

    const result: boolean = await validateServerUrl(CANDIDATE_URL);

    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });
});

describe("logout", () => {
  beforeEach(() => {
    /*
     * The revoke request really is made now; it is asserted on in the block
     * below rather than here, because this block is about the half of logout()
     * that has to happen whatever the server says.
     */
    clientPostSpy().mockResolvedValue({ data: {} } as never);
  });

  test("clears the stored session", async () => {
    /*
     * The whole point of the function. Everything else it does is best effort;
     * this is the part a user pressing Sign Out is entitled to.
     */
    await storeSession();

    await logout();

    expect(await getTokens()).toBeNull();
  });

  test("clears the in-memory copy of the access token as well", async () => {
    /*
     * The request interceptor in src/api/client.ts reads that cache
     * SYNCHRONOUSLY to stamp the Authorization header, so it is a second,
     * independent place a session lives. Removing the persisted row and
     * leaving the cache would keep every request for the rest of this app run
     * signed as the user who just signed out - and the next person to hold the
     * handset would be reading their alerts.
     */
    await storeSession();

    expect(getCachedAccessToken()).toBe(ACCESS_TOKEN);

    await logout();

    expect(getCachedAccessToken()).toBeNull();
  });

  test("removes the row from storage, not just from the cache", async () => {
    /*
     * Read through AsyncStorage rather than through getTokens(), because the
     * keychain helper is the thing under suspicion: a clear that only nulled
     * the in-memory copy would satisfy getTokens() for the rest of this
     * process and then hand the session straight back on the next cold start,
     * which is the one place nothing would be watching for it.
     */
    await storeSession();

    await logout();

    expect(await AsyncStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  test("resolves instead of making its caller handle a failure", async () => {
    /*
     * AuthProvider.logout awaits this and THEN drops the SSO tokens, the SSO
     * denial set and the authenticated flag. A rejection here would skip all
     * of that: the screen would stay on the signed-in navigator holding
     * per-project SSO tokens for an account the user believes they have left.
     */
    await storeSession();

    await expect(logout()).resolves.toBeUndefined();
  });

  test("resolves even when the storage write that clears the session fails", async () => {
    /*
     * The one failure clearTokens itself can produce, and the one that used to
     * escape: it ran in a `finally`, which guarantees only that it RUNS - a
     * rejection out of it still rejects out of logout(). AsyncStorage is a
     * native module and its writes really do fail, and when this one rejected
     * AuthProvider.logout never reached the lines that drop the SSO tokens and
     * the authenticated flag: the user was left on the signed-in navigator with
     * no error and no sign-out, having pressed the only button there is.
     *
     * The in-memory access token is asserted separately because clearTokens
     * drops it BEFORE it touches storage - so even in this failure the
     * request interceptor has stopped signing requests as the departing user,
     * which is the part that matters most on a handed-over handset.
     */
    await storeSession();

    (
      AsyncStorage.removeItem as unknown as jest.SpyInstance
    ).mockRejectedValueOnce(new Error("storage unavailable") as never);

    await expect(logout()).resolves.toBeUndefined();

    expect(getCachedAccessToken()).toBeNull();
  });

  test("signs out a handset that never had a session", async () => {
    /*
     * Reached by the cold-start path, where the app calls logout() to settle
     * an ambiguous state rather than because anybody pressed anything. There
     * is nothing to revoke and nothing to remove, and it still has to resolve
     * quietly - a throw here happens before any screen exists to show it.
     */
    await expect(logout()).resolves.toBeUndefined();

    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
  });

  test("empties the slot even when the stored blob cannot be read back", async () => {
    /*
     * A truncated write, or a slot an older build used differently. getTokens
     * answers null for it rather than throwing, which means nothing else in
     * the app can distinguish it from being signed out - so this is the only
     * code path that can get rid of it. Leaving it behind would keep an
     * unreadable session on the device permanently.
     */
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, "{not-json");

    await expect(logout()).resolves.toBeUndefined();

    expect(await AsyncStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(await getTokens()).toBeNull();
  });

  test("does not forget which server this is", async () => {
    /*
     * Signing out is not disconnecting. Wiping the server URL would drop the
     * user onto the connect screen to retype a self-hosted host name they may
     * not have to hand, just to sign back into the account they meant to
     * leave. The two are stored under different keys precisely so that one can
     * outlive the other.
     */
    await storeSession();

    await logout();

    expect(await getServerUrl()).toBe(SERVER_URL);
  });

  test("a session stored afterwards is the only one that comes back", async () => {
    /*
     * The boundary between two users of the same handset. After a sign-out the
     * next sign-in's tokens must be the only ones the store answers with; a
     * clear that merged rather than removed - or a stale cached access token
     * surviving underneath the new row - would leave the previous responder's
     * credentials readable behind the current one.
     */
    await storeSession();
    await logout();

    await storeTokens({
      accessToken: "second-access-token",
      refreshToken: "second-refresh-token",
      refreshTokenExpiresAt: REFRESH_EXPIRES_AT,
    });

    const tokens: StoredTokens | null = await getTokens();

    expect(tokens).toEqual({
      accessToken: "second-access-token",
      refreshToken: "second-refresh-token",
      refreshTokenExpiresAt: REFRESH_EXPIRES_AT,
    });
    expect(getCachedAccessToken()).toBe("second-access-token");
  });
});

/*
 * The other half of a sign-out: telling the server the session is over.
 *
 * Clearing the handset only stops THIS device using the session. The refresh
 * token it was holding stays valid on the server for its whole lifetime unless
 * something revokes it - App/FeatureSet/Identity/API/Authentication.ts answers
 * POST /logout by calling UserSessionService.revokeSessionByRefreshToken - so a
 * request that is built wrongly is a session that quietly outlives the sign-out
 * on a handset the user may have just handed to somebody else. Nothing about
 * that failure is visible from the app, which is why the shape of the request
 * is pinned here rather than left to the server to complain about.
 */
describe("logout revokes the session at the server", () => {
  beforeEach(() => {
    clientPostSpy().mockResolvedValue({ data: {} } as never);
  });

  test("posts to the logout route on the instance the user is signed in to", async () => {
    /*
     * Built absolute from the stored server URL, with baseURL blanked so the
     * request interceptor leaves it alone - the same shape every other identity
     * call in auth.ts uses. The route is /identity/logout, not an /api one: a
     * path that misses answers 404, the app never looks at the response, and
     * the session is simply never revoked.
     */
    await storeSession();

    await logout();

    expect(clientPostSpy()).toHaveBeenCalledTimes(1);
    expect(lastRevokeUrl()).toBe(`${SERVER_URL}/identity/logout`);
    expect(lastRevokeConfig()["baseURL"]).toBe("");
  });

  test("sends the refresh token flat, not inside the `data` envelope", async () => {
    /*
     * Every other identity call in auth.ts goes through postIdentity, which
     * wraps its payload as `{ data }` because those routes read
     * req.body["data"]. This one does NOT: the route reads req.body.refreshToken
     * directly. Wrapping it would post a body with nothing where the route
     * looks, and the route treats a missing token as "no session named" - it
     * removes cookies and answers 200, so the app sees a perfectly successful
     * sign-out that revoked nothing.
     */
    await storeSession();

    await logout();

    expect(lastRevokeBody()).toEqual({ refreshToken: REFRESH_TOKEN });
    expect(lastRevokeBody()["data"]).toBeUndefined();
  });

  test("sends the refresh token, never the access token", async () => {
    /*
     * The access token is the short-lived half and there is nothing to revoke
     * about it - it expires on its own and the server does not keep a row for
     * it. The refresh token is the durable one, the credential that can keep
     * minting access tokens for days, and it is the only thing
     * revokeSessionByRefreshToken can look a session up by. Sending the wrong
     * one revokes nothing and reports nothing.
     */
    await storeSession();

    await logout();

    expect(lastRevokeBody()["refreshToken"]).toBe(REFRESH_TOKEN);
    expect(JSON.stringify(lastRevokeBody())).not.toContain(ACCESS_TOKEN);
  });

  test("posts nothing when there is no refresh token to revoke", async () => {
    /*
     * The cold-start path calls logout() to settle an ambiguous state, with no
     * session stored at all. There is nothing to name in the request, and
     * posting anyway would send a bare body to an unauthenticated route for no
     * reason - and, on a handset whose server URL is a typo, to whatever host
     * happens to be there.
     */
    await logout();

    expect(clientPostSpy()).not.toHaveBeenCalled();

    /*
     * Positive control: the same call with a session behind it does post, so
     * the guard is the missing token and not some unrelated reason the request
     * never went out.
     */
    await storeSession();
    await logout();

    expect(clientPostSpy()).toHaveBeenCalledTimes(1);
  });

  test("signs the handset out anyway when the revoke fails", async () => {
    /*
     * The case the local sign-out exists for, driven for real rather than
     * assumed: the request is made, the server (or the network) refuses it, and
     * the user is still signed out on the device. The call count is asserted
     * because without it this test passes just as well on a logout() that never
     * attempted the revoke at all - which is exactly how it used to pass, back
     * when a dynamic import threw before the request was built.
     */
    clientPostSpy().mockRejectedValue(new Error("Network Error") as never);

    await storeSession();

    await expect(logout()).resolves.toBeUndefined();

    expect(clientPostSpy()).toHaveBeenCalledTimes(1);
    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
    expect(await AsyncStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

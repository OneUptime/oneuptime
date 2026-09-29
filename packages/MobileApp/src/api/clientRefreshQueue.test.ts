import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens, storeTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import { clearAllSsoTokens } from "../storage/ssoTokens";
import { clearAllSsoDenials } from "../sso/ssoDenials";
import apiClient from "./client";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The queue behind the 401 refresh in src/api/client.ts.
 *
 * A phone that has been asleep wakes every screen at once, so an expired access
 * token is discovered by several requests in the same instant, not by one. The
 * first of them refreshes; the rest must not each refresh as well, or one wake
 * would spend N refresh tokens and the losers of that race would invalidate the
 * winner's session. So client.ts keeps a module-level queue: while a refresh is
 * in flight, every other 401 parks a waiter on it and returns a promise that
 * the refresh settles.
 *
 * The queue is the dangerous part, and for a reason that has nothing to do with
 * the happy path: it is the one piece of session state in the app that is
 * neither a React value nor a stored row. It survives the sign-out, it survives
 * the next sign-in, and nothing unmounts it. A waiter that is never settled is
 * therefore two bugs at once - a screen awaiting it spins forever with no error
 * to catch and no empty state to fall back to, and the callback stays on the
 * queue where the NEXT refresh, belonging to whoever signs in next, will replay
 * it.
 *
 * Refreshes fail all the time in this app's setting: the refresh token expired
 * while the phone was in a pocket, the handset is on a train, the instance is
 * mid-deploy. So "the refresh failed" is the ordinary case here, not the edge
 * one, and it is what most of this file is about.
 *
 * HOW THIS DRIVES THE REAL CODE. Requests go through the real apiClient with a
 * custom `config.adapter`, exactly as clientSsoDenial.test.ts does: the adapter
 * receives the fully assembled request after every request interceptor has run
 * and decides what the "server" answered, so the real interceptor in client.ts
 * is what is under test and no socket is opened. The refresh itself is the one
 * call that does NOT go through apiClient - client.ts posts it on the bare
 * `axios` import so it cannot recurse into its own 401 handling - so that one
 * call is spied on instead, which is also what makes the refresh's outcome, and
 * its TIMING, something a test can decide.
 *
 * Nothing here is platform-specific: the interceptor is plain JavaScript with no
 * Platform.OS branch, so every test is expected to hold identically under both
 * the ios and android Jest projects.
 */

const SERVER_URL: string = "https://test.oneuptime.local";

const OLD_ACCESS_TOKEN: string = "access-token-before-the-refresh";
const OLD_REFRESH_TOKEN: string = "refresh-token-before-the-refresh";
const NEW_ACCESS_TOKEN: string = "access-token-after-the-refresh";
const NEW_REFRESH_TOKEN: string = "refresh-token-after-the-refresh";
const REFRESH_EXPIRES_AT: string = "2026-09-04T12:00:00.000Z";

interface Deferred<T> {
  promise: Promise<T>;
  settle: (value: T) => void;
  fail: (reason: unknown) => void;
}

/**
 * A promise whose settlement this file decides, later and by hand.
 *
 * The whole point of these tests is the window in which a refresh is in flight
 * and other requests pile up behind it. A mock that resolved immediately would
 * close that window before anything could enter it, and there would be no queue
 * to test.
 */
function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = (): void => {
    return undefined;
  };
  let fail: (reason: unknown) => void = (): void => {
    return undefined;
  };

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
      settle = resolve;
      fail = reject;
    },
  );

  return { promise, settle, fail };
}

/*
 * client.ts refreshes with `axios.post` on the bare import, not through
 * apiClient. Spied rather than jest.mock'd because everything else in this file
 * needs the REAL axios: apiClient is an axios instance, and the interceptors
 * under test are its interceptors.
 */
const refreshPost: jest.SpyInstance = jest.spyOn(axios, "post");

/*
 * Counted here rather than read off the spy, because the count is load-bearing
 * in a way calls.length is not: "exactly one" is the assertion that proves a
 * request PARKED rather than quietly running a refresh of its own, which is the
 * precondition every test in this file depends on.
 */
let refreshRequests: number = 0;

interface ArmedRefresh {
  succeed: (accessToken: string) => void;
  fail: () => void;
}

/**
 * Takes hold of the next refresh: it will hang until this test says otherwise.
 */
function armRefresh(): ArmedRefresh {
  const answer: Deferred<AxiosResponse> = deferred<AxiosResponse>();

  refreshPost.mockImplementation((): Promise<AxiosResponse> => {
    refreshRequests++;
    return answer.promise;
  });

  return {
    succeed: (accessToken: string): void => {
      answer.settle({
        data: {
          accessToken,
          refreshToken: NEW_REFRESH_TOKEN,
          refreshTokenExpiresAt: REFRESH_EXPIRES_AT,
        },
      } as AxiosResponse);
    },

    /*
     * A plain rejection, deliberately not an AxiosError: client.ts must not
     * care WHY the refresh failed. An expired refresh token (401), a handset
     * with no network (no response at all) and an instance mid-deploy (500)
     * all reach the same catch, and all of them have to settle the queue.
     */
    fail: (): void => {
      answer.fail(new Error("the refresh token was rejected"));
    },
  };
}

type Outcome = "pending" | "resolved" | "rejected";

interface Attempted {
  /*
   * The Authorization header the fake server saw, one entry per time it was
   * asked. Snapshotted per attempt rather than kept as a config reference,
   * because a replay reuses the SAME config object - reading the header off it
   * at the end would report the last value for every attempt, and the point of
   * this array is that the two attempts differ.
   */
  attempts: Array<string>;
  outcome: () => Outcome;
  response: () => AxiosResponse;
  error: () => unknown;
}

/**
 * Fires one request through the real client and watches how it settles.
 *
 * The fake server answers with `statuses[n]` on the n-th attempt and repeats
 * the last entry after that, so `[401, 200]` is a request whose session had
 * lapsed and which works on the replay.
 *
 * The returned promise is observed here rather than returned, on purpose: a
 * test that awaited it could not assert "still pending", which is the state
 * this whole file is about.
 */
function issue(statuses: Array<number>): Attempted {
  const attempts: Array<string> = [];
  let outcome: Outcome = "pending";
  let response: AxiosResponse | null = null;
  let error: unknown = null;

  function adapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const status: number =
      statuses[Math.min(attempts.length, statuses.length - 1)]!;

    attempts.push(String(config.headers.get("authorization") ?? ""));

    const answer: AxiosResponse = {
      data: { attempt: attempts.length },
      status,
      statusText: String(status),
      headers: {},
      config,
    } as AxiosResponse;

    if (status >= 200 && status < 300) {
      return Promise.resolve(answer);
    }

    return Promise.reject(
      new AxiosError(
        `Request failed with status code ${status}`,
        String(status),
        config,
        undefined,
        answer,
      ),
    );
  }

  const config: AxiosRequestConfig = { adapter };

  apiClient.get("/api/monitor", config).then(
    (value: AxiosResponse): void => {
      outcome = "resolved";
      response = value;
    },
    (reason: unknown): void => {
      outcome = "rejected";
      error = reason;
    },
  );

  return {
    attempts,
    outcome: (): Outcome => {
      return outcome;
    },
    response: (): AxiosResponse => {
      return response!;
    },
    error: (): unknown => {
      return error;
    },
  };
}

/**
 * Lets everything already in flight run as far as it can, then stops.
 *
 * A macrotask turn drains the entire microtask queue behind it, and every step
 * between a request leaving and its 401 arriving at the interceptor - the
 * request interceptor's AsyncStorage reads, axios' own promise chain, the
 * interceptor's `await getTokens()` - is a microtask. Several turns are taken
 * because a replay starts a fresh chain of them; the loop is what makes
 * "pending" below mean "will not settle" rather than "has not settled yet".
 */
async function settleEventLoop(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

interface Standoff {
  leader: Attempted;
  parked: Array<Attempted>;
}

/**
 * Reproduces the wake-from-sleep race: one request is off refreshing, and the
 * rest have met their own 401s and are queued behind it.
 *
 * `parkedScripts` gives each parked request its own status script, so a test
 * can say what its replay meets.
 */
async function parkRequestsBehindRefresh(
  parkedScripts: Array<Array<number>>,
): Promise<Standoff> {
  const leader: Attempted = issue([401, 200]);

  /*
   * The leader has to reach axios.post before the others arrive. If it had not,
   * `isRefreshing` would still be false when they got their 401s, each would
   * start a refresh of its own, and nothing would queue - the tests below would
   * all pass while testing nothing.
   */
  await settleEventLoop();

  const parked: Array<Attempted> = parkedScripts.map(
    (statuses: Array<number>): Attempted => {
      return issue(statuses);
    },
  );

  await settleEventLoop();

  /*
   * Asserted here rather than in each test because it is the precondition they
   * share: one refresh for the lot of them, and every parked request still
   * waiting on it.
   */
  expect(refreshRequests).toBe(1);

  for (const request of parked) {
    expect(request.attempts).toHaveLength(1);
    expect(request.outcome()).toBe("pending");
  }

  return { leader, parked };
}

/*
 * All of the state that decides what these tests see is module-level and
 * outlives a single test: the AsyncStorage fake, the keychain's in-memory access
 * token, the SSO caches and the denial set. A session is stored fresh each time
 * because the refresh path only runs at all when getTokens() finds a refresh
 * token, and because a failed refresh CLEARS the store on its way out - so
 * without this the second test in the file would take a different path from the
 * first.
 */
beforeEach(async () => {
  refreshRequests = 0;
  clearAllSsoDenials();
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl(SERVER_URL);
  await storeTokens({
    accessToken: OLD_ACCESS_TOKEN,
    refreshToken: OLD_REFRESH_TOKEN,
    refreshTokenExpiresAt: REFRESH_EXPIRES_AT,
  });

  /*
   * Left refusing loudly rather than resolving: jest's `clearMocks` clears
   * calls but keeps implementations, so a test that forgot to arm the refresh
   * would otherwise inherit the previous test's ALREADY SETTLED promise and
   * quietly test a refresh that never hung.
   */
  refreshPost.mockImplementation((): Promise<AxiosResponse> => {
    return Promise.reject(
      new Error("armRefresh() was not called: this test armed no refresh"),
    );
  });
});

describe("a 401 that arrives while a refresh is already in flight", () => {
  test("waits for that refresh instead of starting a second one", async () => {
    /*
     * The reason the queue exists. Each refresh spends the stored refresh
     * token and the server issues a new one, so two refreshes racing means the
     * second invalidates the first - the app would sign itself out in the
     * middle of restoring itself.
     */
    const refresh: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([[401], [401]]);

    expect(refreshRequests).toBe(1);
    expect(standoff.parked[0]!.outcome()).toBe("pending");
    expect(standoff.parked[1]!.outcome()).toBe("pending");

    refresh.fail();
    await settleEventLoop();
  });
});

describe("when the refresh fails", () => {
  test("a parked request is rejected rather than left pending forever", async () => {
    /*
     * THE defect this file exists for. The queue used to hold only the resolve
     * half of each waiter, and only the success path called it, so a failed
     * refresh - an expired refresh token, a handset with no signal, an instance
     * returning 500 - left every parked promise pending with nothing left in
     * the app that could ever settle it. The screen awaiting one shows its
     * loading state until it is unmounted: no error, no empty state, no retry,
     * on an app whose entire job is to wake somebody up.
     */
    const refresh: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([[401]]);
    const parked: Attempted = standoff.parked[0]!;

    refresh.fail();
    await settleEventLoop();

    expect(parked.outcome()).toBe("rejected");

    /* The request that drove the refresh is rejected too, as it always was. */
    expect(standoff.leader.outcome()).toBe("rejected");
  });

  test("every parked request is settled, not only the first", async () => {
    /*
     * A wake produces a handful of these at once, not one. Settling the head of
     * the queue and leaving the tail would look completely healthy on the
     * screen that happened to ask first and hang on all the others.
     */
    const refresh: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([
      [401],
      [401],
      [401],
    ]);

    refresh.fail();
    await settleEventLoop();

    for (const request of standoff.parked) {
      expect(request.outcome()).toBe("rejected");
    }
  });

  test("a parked request is rejected with its own 401, not with the refresh's error", async () => {
    /*
     * Callers branch on what they catch - `error.response?.status` decides
     * between "your session ended", "this project needs SSO" and "something
     * went wrong". Handing them the refresh's failure instead would describe a
     * request they never made, against a URL they never asked for, and is not
     * the shape the unqueued path rejects with either: whether a request led
     * the refresh or queued behind it is an accident of timing that no caller
     * should be able to detect.
     */
    const refresh: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([[401]]);
    const parked: Attempted = standoff.parked[0]!;

    refresh.fail();
    await settleEventLoop();

    const error: AxiosError = parked.error() as AxiosError;

    expect(error).toBeInstanceOf(AxiosError);
    expect(error.response?.status).toBe(401);
    expect(error.config?.url).toBe("/api/monitor");
  });

  test("a parked request is not left on the queue for a later refresh to replay", async () => {
    /*
     * The queue is module state with no owner: it is not cleared by signing
     * out, and the next sign-in on the same handset finds whatever the last one
     * left. So a waiter that a failed refresh forgot to drop is not merely
     * garbage - the NEXT successful refresh replays it, with the new session's
     * token, sending the previous user's request under the current user's
     * credentials and settling a promise nobody is holding any more.
     */
    const first: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([[401]]);
    const parked: Attempted = standoff.parked[0]!;

    first.fail();
    await settleEventLoop();

    expect(parked.outcome()).toBe("rejected");
    expect(parked.attempts).toHaveLength(1);

    /*
     * A second session on the same handset. The failed refresh above cleared
     * the store, so this is the sign-in that follows it.
     */
    await storeTokens({
      accessToken: "the-next-users-access-token",
      refreshToken: "the-next-users-refresh-token",
      refreshTokenExpiresAt: REFRESH_EXPIRES_AT,
    });

    const second: ArmedRefresh = armRefresh();
    const later: Attempted = issue([401, 200]);

    await settleEventLoop();

    expect(refreshRequests).toBe(2);

    second.succeed(NEW_ACCESS_TOKEN);
    await settleEventLoop();

    /* The new request is served, so this refresh really did succeed. */
    expect(later.outcome()).toBe("resolved");

    /* And the abandoned one was not carried along with it. */
    expect(parked.attempts).toHaveLength(1);
    expect(parked.outcome()).toBe("rejected");
  });
});

describe("when the refresh succeeds", () => {
  test("a parked request is replayed with the new token", async () => {
    /*
     * The happy path, and the only reason to queue rather than fail fast: the
     * request the user is waiting on is finished with the refreshed session
     * instead of surfacing as an error they would have to retry by hand.
     */
    const refresh: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([[401, 200]]);
    const parked: Attempted = standoff.parked[0]!;

    refresh.succeed(NEW_ACCESS_TOKEN);
    await settleEventLoop();

    expect(parked.outcome()).toBe("resolved");
    expect(parked.response().status).toBe(200);

    /*
     * Replayed exactly once, with the token the refresh produced. The first
     * attempt is pinned as well, so this cannot pass on a client that simply
     * never sent the old one.
     */
    expect(parked.attempts).toEqual([
      `Bearer ${OLD_ACCESS_TOKEN}`,
      `Bearer ${NEW_ACCESS_TOKEN}`,
    ]);
  });

  test("a parked request whose replay fails rejects rather than hanging", async () => {
    /*
     * The replay is a real request and can fail on its own account - the
     * instance is still mid-deploy, the row was deleted while the phone slept.
     * The waiter used to be written `resolve(await apiClient(originalRequest))`
     * inside a promise executor, so that failure threw out of a callback
     * nothing was awaiting: the promise the caller held was never settled at
     * all, and the only trace of the 500 was an unhandled rejection warning.
     * Refreshing the session cannot turn a failing request into a silent one.
     */
    const refresh: ArmedRefresh = armRefresh();

    const standoff: Standoff = await parkRequestsBehindRefresh([[401, 500]]);
    const parked: Attempted = standoff.parked[0]!;

    refresh.succeed(NEW_ACCESS_TOKEN);
    await settleEventLoop();

    expect(parked.attempts).toHaveLength(2);
    expect(parked.outcome()).toBe("rejected");
    expect((parked.error() as AxiosError).response?.status).toBe(500);
  });
});

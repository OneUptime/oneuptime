import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  clearTokens,
  getCachedAccessToken,
  getTokens,
  storeTokens,
  type StoredTokens,
} from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import { clearAllSsoTokens } from "../storage/ssoTokens";
import { clearAllSsoDenials } from "../sso/ssoDenials";
import {
  flushUserActivityWrites,
  recordUserActivity,
  resetUserActivityForTests,
} from "../auth/userActivity";
import { sessionAccessToken } from "../__tests__/sessionTokens";
import apiClient, {
  MIN_TIME_BETWEEN_RENEWALS_MS,
  RENEW_AHEAD_WINDOW_MS,
  renewSessionAheadOfExpiry,
  resetSessionRenewalForTests,
  setOnAuthFailure,
  waitForSessionRenewal,
} from "./client";
import { logout } from "./auth";

/*
 * RENEWING THE SESSION A LITTLE BEFORE ITS ACCESS TOKEN RUNS OUT, WHILE THE
 * APP IS IN USE (src/api/client.ts renewSessionAheadOfExpiry, issue #8187).
 *
 * Each use of the app (a touch, typing, the app back on the screen:
 * auth/userActivity) renews a session whose token has less than
 * RENEW_AHEAD_WINDOW_MS left, so an app in use keeps the server's record
 * of its person's activity current, and never meets a refused request at
 * each token's end. An app nobody uses never renews ahead: its token runs
 * out, and the renewal its next request makes says how long it went
 * unused. A renewal ahead shares the one renewal in flight with the 401
 * path, and a sign-out waits for it.
 *
 * Requests go through the real apiClient with a fake adapter that answers
 * as the server would for the token they carry; the renewal, posted on the
 * bare axios import, is spied on. The clock is the test's.
 */

const SERVER_URL: string = "https://test.oneuptime.local";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;

const T0: number = Date.parse("2026-11-15T09:00:00.000Z");

const SESSION_ID: string = "6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a";

const TOKEN_LIFETIME_MS: number = 15 * MINUTE;

let nowMs: number = T0;

interface Deferred<T> {
  promise: Promise<T>;
  settle: (value: T) => void;
  fail: (reason: unknown) => void;
}

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
 * The server, as far as this session goes: the access token it last signed
 * and when that runs out, and how it answers a renewal.
 */
type RenewalAnswer = "renew" | "refuse" | "unreachable";

interface FakeServer {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  refreshToken: string;
  renewals: Array<Record<string, unknown>>;
  answer: RenewalAnswer;
  // How long the tokens it signs from now on live.
  lifetimeMs: number;
  // A renewal the test answers by hand, when set.
  held: Deferred<void> | null;
  revoked: Array<Record<string, unknown>>;
}

let server: FakeServer;

function signToken(atMs: number, lifetimeMs: number): string {
  return sessionAccessToken({
    sessionId: SESSION_ID,
    signedInAtMs: T0,
    lastActiveAtMs: atMs,
    issuedAtMs: atMs,
    expiresAtMs: atMs + lifetimeMs,
  });
}

const refreshPost: jest.SpyInstance = jest.spyOn(axios, "post");

function refusal(status: number | null): AxiosError {
  const config: InternalAxiosRequestConfig = {
    headers: {},
  } as InternalAxiosRequestConfig;

  if (status === null) {
    return new AxiosError("Network Error", "ERR_NETWORK", config);
  }

  return new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    config,
    undefined,
    {
      data: { message: "Session expired. Please login again." },
      status,
      statusText: String(status),
      headers: {},
      config,
    } as AxiosResponse,
  );
}

async function answerRenewal(
  _url: string,
  body: Record<string, unknown>,
): Promise<AxiosResponse> {
  server.renewals.push(body);

  if (server.held) {
    await server.held.promise;
  }

  if (server.answer === "refuse") {
    throw refusal(401);
  }

  if (server.answer === "unreachable") {
    throw refusal(null);
  }

  server.accessToken = signToken(nowMs, server.lifetimeMs);
  server.accessTokenExpiresAtMs = nowMs + server.lifetimeMs;
  server.refreshToken = `refresh-${server.renewals.length}`;

  return {
    data: {
      accessToken: server.accessToken,
      refreshToken: server.refreshToken,
      refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
    },
  } as AxiosResponse;
}

interface Sent {
  attempts: Array<string>;
  outcome: () => "pending" | "resolved" | "rejected";
  error: () => unknown;
}

// A request of the app's, answered as the server would for the token it carries now.
function request(): Sent {
  const attempts: Array<string> = [];
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  let error: unknown = null;

  function adapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const authorization: string = String(
      config.headers.get("authorization") ?? "",
    );
    attempts.push(authorization);

    const isLive: boolean =
      authorization === `Bearer ${server.accessToken}` &&
      nowMs < server.accessTokenExpiresAtMs;

    const answer: AxiosResponse = {
      data: {},
      status: isLive ? 200 : 401,
      statusText: isLive ? "OK" : "Unauthorized",
      headers: {},
      config,
    } as AxiosResponse;

    if (isLive) {
      return Promise.resolve(answer);
    }

    return Promise.reject(
      new AxiosError(
        "Request failed with status code 401",
        "401",
        config,
        undefined,
        answer,
      ),
    );
  }

  const config: AxiosRequestConfig = { adapter };

  apiClient.get("/api/incident/get-list", config).then(
    (): void => {
      outcome = "resolved";
    },
    (reason: unknown): void => {
      outcome = "rejected";
      error = reason;
    },
  );

  return {
    attempts,
    outcome: () => {
      return outcome;
    },
    error: () => {
      return error;
    },
  };
}

async function settleEventLoop(): Promise<void> {
  for (let turn: number = 0; turn < 8; turn++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

// The person touches the app at `atMs`.
async function touch(atMs: number): Promise<void> {
  nowMs = atMs;
  recordUserActivity(atMs);
  await settleEventLoop();
}

let authFailures: number = 0;

const defaultAdapter: AxiosRequestConfig["adapter"] =
  apiClient.defaults.adapter;

beforeEach(async () => {
  nowMs = T0;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowMs;
  });
  (AppState as unknown as { currentState: unknown }).currentState = "active";

  resetUserActivityForTests();
  resetSessionRenewalForTests();
  clearAllSsoDenials();
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl(SERVER_URL);

  server = {
    accessToken: signToken(T0, TOKEN_LIFETIME_MS),
    accessTokenExpiresAtMs: T0 + TOKEN_LIFETIME_MS,
    refreshToken: "refresh-at-sign-in",
    renewals: [],
    answer: "renew",
    lifetimeMs: TOKEN_LIFETIME_MS,
    held: null,
    revoked: [],
  };

  await storeTokens({
    accessToken: server.accessToken,
    refreshToken: server.refreshToken,
    refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
  });

  refreshPost.mockImplementation(answerRenewal as never);

  authFailures = 0;
  setOnAuthFailure((): void => {
    authFailures++;
  });

  // The sign-in itself is activity.
  await touch(T0);
});

afterEach(async () => {
  server.held?.settle();
  await settleEventLoop();
  await waitForSessionRenewal();
  await flushUserActivityWrites();
  apiClient.defaults.adapter = defaultAdapter;
});

describe("a touch renews the session ahead only when its token is about to run out", () => {
  test("more than two minutes left: nothing is renewed", async () => {
    await touch(T0 + TOKEN_LIFETIME_MS - RENEW_AHEAD_WINDOW_MS - SECOND);

    expect(server.renewals).toHaveLength(0);
  });

  test("two minutes left: renewed now, saying how long since the person used the app", async () => {
    const touchedAt: number = T0 + TOKEN_LIFETIME_MS - RENEW_AHEAD_WINDOW_MS;
    await touch(touchedAt);

    expect(server.renewals).toEqual([
      { refreshToken: "refresh-at-sign-in", inactiveForInSeconds: 0 },
    ]);

    // The new session is stored, and the next request carries it: no 401 at all.
    expect((await getTokens())?.refreshToken).toBe("refresh-1");
    expect(getCachedAccessToken()).toBe(server.accessToken);

    nowMs = T0 + TOKEN_LIFETIME_MS + MINUTE;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
    expect(sent.attempts).toEqual([`Bearer ${server.accessToken}`]);
    expect(server.renewals).toHaveLength(1);
  });

  test("a token that has run out already is renewed at the touch, before any request needs it", async () => {
    await touch(T0 + TOKEN_LIFETIME_MS + 5 * MINUTE);

    expect(server.renewals).toHaveLength(1);
    expect(server.renewals[0]!["inactiveForInSeconds"]).toBe(0);
    // Twenty minutes untouched: the time without use the touch ended is said too.
    expect(server.renewals[0]!["longestInactivity"]).toEqual({
      forSeconds: 20 * 60,
      endedSecondsAgo: 0,
    });
  });

  test("an app nobody touches is never renewed ahead: the request after its token ran out renews it, saying how long it went unused", async () => {
    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    const sent: Sent = request();
    await settleEventLoop();

    expect(server.renewals).toEqual([
      {
        refreshToken: "refresh-at-sign-in",
        inactiveForInSeconds: 15 * 60 + 30,
      },
    ]);
    expect(sent.outcome()).toBe("resolved");
  });

  test("a burst of touches renews it once", async () => {
    const at: number = T0 + TOKEN_LIFETIME_MS - MINUTE;

    nowMs = at;
    recordUserActivity(at);
    recordUserActivity(at + 100);
    recordUserActivity(at + 2 * SECOND);
    await settleEventLoop();
    await touch(at + 10 * SECOND);

    expect(server.renewals).toHaveLength(1);
  });

  test("a session handed tokens shorter than the window - near its end - is renewed ahead at most once a minute", async () => {
    server.lifetimeMs = 30 * SECOND;

    const firstAt: number = T0 + TOKEN_LIFETIME_MS - MINUTE;
    await touch(firstAt);

    expect(server.renewals).toHaveLength(1);

    for (
      let at: number = firstAt + 10 * SECOND;
      at < firstAt + MIN_TIME_BETWEEN_RENEWALS_MS;
      at += 10 * SECOND
    ) {
      await touch(at);
    }

    expect(server.renewals).toHaveLength(1);

    await touch(firstAt + MIN_TIME_BETWEEN_RENEWALS_MS);

    expect(server.renewals).toHaveLength(2);
  });

  test("a token that does not say when it runs out is never renewed ahead", async () => {
    await storeTokens({
      accessToken: "not-a-jwt",
      refreshToken: "refresh-at-sign-in",
      refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
    });

    await touch(T0 + 2 * TOKEN_LIFETIME_MS);

    expect(server.renewals).toHaveLength(0);
  });

  test("nobody signed in: a touch renews nothing", async () => {
    await clearTokens();

    await touch(T0 + 2 * TOKEN_LIFETIME_MS);

    expect(server.renewals).toHaveLength(0);
    expect(renewSessionAheadOfExpiry(nowMs)).toBeNull();
  });
});

describe("one renewal at a time", () => {
  test("a request that meets a 401 while the session is renewed ahead waits for it, and is replayed with the new token", async () => {
    server.held = deferred<void>();

    const touchedAt: number = T0 + TOKEN_LIFETIME_MS + MINUTE;
    await touch(touchedAt);

    expect(server.renewals).toHaveLength(1);

    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("pending");

    server.held.settle();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
    expect(sent.attempts).toHaveLength(2);
    expect(sent.attempts[1]).toBe(`Bearer ${server.accessToken}`);
    expect(server.renewals).toHaveLength(1);
  });

  test("while a 401 renews the session, a touch starts no second renewal", async () => {
    server.held = deferred<void>();

    nowMs = T0 + TOKEN_LIFETIME_MS + MINUTE;
    const sent: Sent = request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(1);

    await touch(nowMs + SECOND);

    expect(server.renewals).toHaveLength(1);

    server.held.settle();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
    expect(server.renewals).toHaveLength(1);
  });
});

describe("when the renewal ahead does not go through", () => {
  test("the server refusing it ends the session: tokens gone, back to the sign-in, waiting requests refused with their own 401", async () => {
    server.answer = "refuse";
    server.held = deferred<void>();

    await touch(T0 + TOKEN_LIFETIME_MS + MINUTE);

    // Renewed at the touch, before any request asked.
    expect(server.renewals).toHaveLength(1);

    const sent: Sent = request();
    await settleEventLoop();
    server.held.settle();
    await settleEventLoop();

    expect(authFailures).toBe(1);
    expect(await getTokens()).toBeNull();
    expect(sent.outcome()).toBe("rejected");
    expect((sent.error() as AxiosError).response?.status).toBe(401);
  });

  test("no answer: the session is left as it was, and the next request decides", async () => {
    server.answer = "unreachable";

    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    expect(server.renewals).toHaveLength(1);
    expect(authFailures).toBe(0);
    expect((await getTokens())?.refreshToken).toBe("refresh-at-sign-in");

    // The token it had is still good for a minute.
    nowMs = T0 + TOKEN_LIFETIME_MS - 30 * SECOND;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
  });

  test("no answer, and the time without use it was to report is reported by the next renewal", async () => {
    server.answer = "unreachable";

    await touch(T0 + TOKEN_LIFETIME_MS + 10 * MINUTE);

    expect(server.renewals[0]!["longestInactivity"]).toEqual({
      forSeconds: 25 * 60,
      endedSecondsAgo: 0,
    });

    server.answer = "renew";
    nowMs = T0 + TOKEN_LIFETIME_MS + 10 * MINUTE + 30 * SECOND;
    request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(2);
    expect(server.renewals[1]!["longestInactivity"]).toEqual({
      forSeconds: 25 * 60,
      endedSecondsAgo: 30,
    });
  });

  test("no answer while a request waits on it with a 401: it ends as that request's own renewal would have", async () => {
    server.answer = "unreachable";
    server.held = deferred<void>();

    await touch(T0 + TOKEN_LIFETIME_MS + MINUTE);

    expect(server.renewals).toHaveLength(1);

    const sent: Sent = request();
    await settleEventLoop();
    server.held.settle();
    await settleEventLoop();

    expect(sent.outcome()).toBe("rejected");
    expect((sent.error() as AxiosError).response?.status).toBe(401);
    expect(authFailures).toBe(1);
    expect(await getTokens()).toBeNull();
  });
});

describe("signing out while the session is renewed ahead", () => {
  test("the sign-out waits for the renewal, and revokes the session with the refresh token it was handed", async () => {
    const revokes: Array<{ url: string; data: unknown }> = [];

    apiClient.defaults.adapter = (
      config: InternalAxiosRequestConfig,
    ): Promise<AxiosResponse> => {
      revokes.push({
        url: String(config.url),
        data: JSON.parse(String(config.data)),
      });
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      } as AxiosResponse);
    };

    server.held = deferred<void>();

    // The tap on Sign out, a minute before the token runs out, renews it ahead...
    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    expect(server.renewals).toHaveLength(1);

    // ...and the sign-out starts while that renewal is on its way.
    const signingOut: Promise<void> = logout();
    await settleEventLoop();

    expect(revokes).toHaveLength(0);

    server.held.settle();
    await signingOut;

    expect(revokes).toEqual([
      {
        url: `${SERVER_URL}/identity/logout`,
        data: { refreshToken: "refresh-1" },
      },
    ]);
    expect(await getTokens()).toBeNull();
  });

  test("with no renewal in flight, it does not wait", async () => {
    let waited: boolean = false;

    void waitForSessionRenewal().then((): void => {
      waited = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(waited).toBe(true);
  });
});

describe("the time without use a renewal reported", () => {
  test("is not said again once the server has taken it", async () => {
    await touch(T0 + TOKEN_LIFETIME_MS + 5 * MINUTE);

    expect(server.renewals[0]!["longestInactivity"]).toBeDefined();

    // Untouched until the new token runs out: the request after it renews.
    nowMs = server.accessTokenExpiresAtMs + SECOND;
    request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(2);
    expect(server.renewals[1]).toEqual({
      refreshToken: "refresh-1",
      inactiveForInSeconds: 15 * 60 + 1,
    });
  });

  test("one that ended while the renewal was on its way is kept for the next", async () => {
    server.held = deferred<void>();

    // Renewed ahead at a touch, the app put away while the answer is on its way...
    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);
    (AppState as unknown as { currentState: unknown }).currentState =
      "background";

    // ...and brought back twenty minutes later, before the answer is read.
    await touch(T0 + TOKEN_LIFETIME_MS + 19 * MINUTE);
    server.held.settle();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(1);
    expect(server.renewals[0]!["longestInactivity"]).toBeUndefined();

    // The next renewal says it.
    server.held = null;
    nowMs = server.accessTokenExpiresAtMs + SECOND;
    request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(2);
    expect(server.renewals[1]!["longestInactivity"]).toEqual({
      forSeconds: 20 * 60,
      endedSecondsAgo: Math.floor(
        (nowMs - (T0 + TOKEN_LIFETIME_MS + 19 * MINUTE)) / 1000,
      ),
    });
  });
});

describe("what the renewal stores", () => {
  test("the tokens the server handed back", async () => {
    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    const stored: StoredTokens | null = await getTokens();

    expect(stored).toEqual({
      accessToken: server.accessToken,
      refreshToken: "refresh-1",
      refreshTokenExpiresAt: new Date(
        T0 + TOKEN_LIFETIME_MS - MINUTE + 30 * DAY,
      ).toISOString(),
    });
  });
});

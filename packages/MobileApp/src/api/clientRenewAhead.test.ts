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
  ACTIVITY_REPORT_INTERVAL_MS,
  flushUserActivityWrites,
  recordUserActivity,
  resetUserActivityForTests,
} from "../auth/userActivity";
import type { SessionEndReason } from "../auth/sessionEnded";
import { SESSION_ENDED_MESSAGES as SERVER_SESSION_ENDED_MESSAGES } from "../../../Common/Types/Exception/SessionEndedException";
import { SessionEndReason as ServerSessionEndReason } from "../../../Common/Types/UserSession/SessionLength";
import { sessionAccessToken } from "../__tests__/sessionTokens";
import apiClient, {
  areSessionRenewalsClosed,
  MIN_TIME_BETWEEN_RENEWALS_MS,
  RENEW_AHEAD_WINDOW_MS,
  renewSessionAheadOfExpiry,
  resetSessionRenewalForTests,
  setOnAuthFailure,
  waitForSessionRenewal,
} from "./client";
import { logout } from "./auth";

/*
 * RENEWING THE SESSION WHILE THE APP IS IN USE, AND SIGNING OUT
 * (src/api/client.ts renewSessionAheadOfExpiry, issues #8187, #8458, #8382
 * and #8381).
 *
 * Each use of the app (a touch, typing, the app back on the screen:
 * auth/userActivity) renews a session whose token has less than
 * RENEW_AHEAD_WINDOW_MS left, so an app in use never meets a refused
 * request at each token's end - and one whose server last heard of its
 * person ACTIVITY_REPORT_INTERVAL_MS ago, the promise every renewal makes
 * (reportsActivityWhileInUse), so the server's sweep can record an idle
 * timeout within minutes without ever signing out someone still working.
 * An app nobody uses never renews ahead: its token runs out, and the
 * renewal its next request makes says how long it went unused. A renewal
 * ahead shares the one renewal in flight with the 401 path.
 *
 * A sign-out wins in every order: it waits for a renewal already on its
 * way, starts none while it revokes, and nothing a renewal brings back is
 * stored after the tokens it started from were cleared or replaced. And a
 * session the server ended says why on the way to the sign-in screen.
 *
 * Requests go through the real apiClient with a fake adapter that answers
 * as the server would for the token they carry; the renewal and a revoke
 * of a renewed session, posted on the bare axios import, are spied on. The
 * clock is the test's.
 */

const SERVER_URL: string = "https://test.oneuptime.local";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const T0: number = Date.parse("2026-11-15T09:00:00.000Z");

const SESSION_ID: string = "6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a";

const OTHER_SESSION_ID: string = "7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b";

const TOKEN_LIFETIME_MS: number = 15 * MINUTE;

const PLAIN_REFUSAL: string = "Session expired. Please login again.";

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
 * and when that runs out, the newest activity it heard of, how it answers a
 * renewal, and the sessions it was asked to end.
 */
type RenewalAnswer = "renew" | "refuse" | "unreachable" | "fail";

interface FakeServer {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  refreshToken: string;
  renewals: Array<Record<string, unknown>>;
  // When each renewal reached it.
  renewedAtMs: Array<number>;
  answer: RenewalAnswer;
  // What a refusal says (the body's message), or null for a refusal with no body.
  refusalMessage: string | null;
  // How long the tokens it signs from now on live.
  lifetimeMs: number;
  // A renewal the test answers by hand, when set.
  held: Deferred<void> | null;
  // The newest activity it heard of, on its own clock: what lastActiveAt claims.
  heardOfActivityAtMs: number;
  // How far its clock runs ahead of the phone's.
  clockAheadMs: number;
  // The refresh tokens a renewal's leftover session was ended with (bare axios).
  revokedRenewedSessions: Array<unknown>;
  // A revoke of a renewed session fails, when set.
  revokeFails: boolean;
}

let server: FakeServer;

function signToken(
  atMs: number,
  lifetimeMs: number,
  lastActiveAtMs: number,
  sessionId: string = SESSION_ID,
): string {
  return sessionAccessToken({
    sessionId,
    signedInAtMs: T0,
    lastActiveAtMs,
    issuedAtMs: atMs,
    expiresAtMs: atMs + lifetimeMs,
  });
}

function refusal(status: number | null, message: string | null): AxiosError {
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
      data: message === null ? "" : { message },
      status,
      statusText: String(status),
      headers: {},
      config,
    } as AxiosResponse,
  );
}

// POST /identity/refresh-token, and POST /identity/logout for a renewed session.
async function answerBareAxiosPost(
  url: string,
  body: Record<string, unknown>,
): Promise<AxiosResponse> {
  if (url.endsWith("/identity/logout")) {
    if (server.revokeFails) {
      throw refusal(null, null);
    }

    server.revokedRenewedSessions.push(body["refreshToken"]);
    return { data: {} } as AxiosResponse;
  }

  server.renewals.push(body);
  server.renewedAtMs.push(nowMs);

  if (server.held) {
    await server.held.promise;
  }

  if (server.answer === "refuse") {
    throw refusal(401, server.refusalMessage);
  }

  if (server.answer === "unreachable") {
    throw refusal(null, null);
  }

  if (server.answer === "fail") {
    throw refusal(500, "Server Error");
  }

  // As the server decides it: the newest activity it has heard of.
  const inactiveForInSeconds: unknown = body["inactiveForInSeconds"];

  if (typeof inactiveForInSeconds === "number") {
    server.heardOfActivityAtMs = Math.max(
      server.heardOfActivityAtMs,
      nowMs + server.clockAheadMs - inactiveForInSeconds * SECOND,
    );
  }

  server.accessToken = signToken(
    nowMs,
    server.lifetimeMs,
    server.heardOfActivityAtMs,
  );
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

/*
 * The sign-out's own revoke (POST /identity/logout through apiClient): what
 * it carried, answered at once or when the test says.
 */
interface Revokes {
  sent: Array<{ url: string; data: unknown }>;
  held: Deferred<void> | null;
}

function captureRevokes(hold: boolean): Revokes {
  const revokes: Revokes = {
    sent: [],
    held: hold ? deferred<void>() : null,
  };

  apiClient.defaults.adapter = async (
    config: InternalAxiosRequestConfig,
  ): Promise<AxiosResponse> => {
    revokes.sent.push({
      url: String(config.url),
      data: JSON.parse(String(config.data)),
    });

    if (revokes.held) {
      await revokes.held.promise;
    }

    return {
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as AxiosResponse;
  };

  return revokes;
}

// A sign-in at `atMs`, as a password, a passkey or single sign-on stores it.
async function signIn(
  atMs: number,
  options: { sessionId?: string; lifetimeMs?: number } = {},
): Promise<void> {
  nowMs = atMs;
  server.accessToken = signToken(
    atMs,
    options.lifetimeMs ?? TOKEN_LIFETIME_MS,
    atMs,
    options.sessionId ?? SESSION_ID,
  );
  server.accessTokenExpiresAtMs =
    atMs + (options.lifetimeMs ?? TOKEN_LIFETIME_MS);
  server.refreshToken = `refresh-at-sign-in-${atMs}`;
  server.heardOfActivityAtMs = atMs;

  await storeTokens({
    accessToken: server.accessToken,
    refreshToken: server.refreshToken,
    refreshTokenExpiresAt: new Date(atMs + 30 * DAY).toISOString(),
  });
}

let authFailures: Array<SessionEndReason | null> = [];

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
    accessToken: signToken(T0, TOKEN_LIFETIME_MS, T0),
    accessTokenExpiresAtMs: T0 + TOKEN_LIFETIME_MS,
    refreshToken: "refresh-at-sign-in",
    renewals: [],
    renewedAtMs: [],
    answer: "renew",
    refusalMessage: PLAIN_REFUSAL,
    lifetimeMs: TOKEN_LIFETIME_MS,
    held: null,
    heardOfActivityAtMs: T0,
    clockAheadMs: 0,
    revokedRenewedSessions: [],
    revokeFails: false,
  };

  await storeTokens({
    accessToken: server.accessToken,
    refreshToken: server.refreshToken,
    refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
  });

  // Spied afresh each test: the restoreAllMocks below puts the real one back.
  jest.spyOn(axios, "post").mockImplementation(answerBareAxiosPost as never);

  authFailures = [];
  setOnAuthFailure((reason: SessionEndReason | null): void => {
    authFailures.push(reason);
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
  jest.restoreAllMocks();
});

/*
 * The expiry rule on its own: a token of four minutes, shorter than the
 * report interval, so no report is due before it runs out.
 */
describe("a touch renews the session ahead when its token is about to run out", () => {
  const SHORT_TOKEN_MS: number = 4 * MINUTE;

  beforeEach(async () => {
    await signIn(T0, { lifetimeMs: SHORT_TOKEN_MS });
  });

  test("more than two minutes left: nothing is renewed", async () => {
    await touch(T0 + SHORT_TOKEN_MS - RENEW_AHEAD_WINDOW_MS - SECOND);

    expect(server.renewals).toHaveLength(0);
  });

  test("two minutes left: renewed now, saying how long since the person used the app, and that it renews while in use", async () => {
    const touchedAt: number = T0 + SHORT_TOKEN_MS - RENEW_AHEAD_WINDOW_MS;
    await touch(touchedAt);

    expect(server.renewals).toEqual([
      {
        refreshToken: `refresh-at-sign-in-${T0}`,
        inactiveForInSeconds: 0,
        reportsActivityWhileInUse: true,
      },
    ]);

    // The new session is stored, and the next request carries it: no 401 at all.
    expect((await getTokens())?.refreshToken).toBe("refresh-1");
    expect(getCachedAccessToken()).toBe(server.accessToken);

    nowMs = T0 + SHORT_TOKEN_MS + MINUTE;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
    expect(sent.attempts).toEqual([`Bearer ${server.accessToken}`]);
    expect(server.renewals).toHaveLength(1);
  });

  test("a session handed tokens shorter than the window - near its end - is renewed ahead at most once a minute", async () => {
    server.lifetimeMs = 30 * SECOND;

    const firstAt: number = T0 + SHORT_TOKEN_MS - MINUTE;
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
});

describe("a touch on a session about to run out, or run out", () => {
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
        reportsActivityWhileInUse: true,
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

  test("a token that says nothing of itself - when it runs out, what the server heard of - is renewed for the report once, then every five minutes in use", async () => {
    await storeTokens({
      accessToken: "not-a-jwt",
      refreshToken: "refresh-at-sign-in",
      refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
    });

    await touch(T0 + MINUTE);

    expect(server.renewals).toHaveLength(1);

    for (
      let at: number = T0 + MINUTE + 30 * SECOND;
      at < T0 + MINUTE + ACTIVITY_REPORT_INTERVAL_MS;
      at += 30 * SECOND
    ) {
      await touch(at);
    }

    expect(server.renewals).toHaveLength(1);

    await touch(T0 + MINUTE + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(2);
  });

  test("nobody signed in: a touch renews nothing", async () => {
    await clearTokens();

    await touch(T0 + 2 * TOKEN_LIFETIME_MS);

    expect(server.renewals).toHaveLength(0);
    expect(renewSessionAheadOfExpiry(nowMs)).toBeNull();
  });
});

describe("while the app is in use, the server hears of its person at least every five minutes (#8458)", () => {
  test("the interval is the server's: five minutes", () => {
    expect(ACTIVITY_REPORT_INTERVAL_MS).toBe(5 * MINUTE);
    // A renewal that got no answer is tried again well inside it.
    expect(MIN_TIME_BETWEEN_RENEWALS_MS).toBeLessThan(
      ACTIVITY_REPORT_INTERVAL_MS,
    );
  });

  test("every renewal says the app renews while in use: one a touch started, and one a request's 401 started", async () => {
    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    nowMs = server.accessTokenExpiresAtMs + 10 * SECOND;
    request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(2);
    expect(
      server.renewals.map((body: Record<string, unknown>): unknown => {
        return body["reportsActivityWhileInUse"];
      }),
    ).toEqual([true, true]);
  });

  test("a second short of five minutes since the activity the server heard of: nothing; at five minutes: a renewal saying the person is here", async () => {
    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS - SECOND);

    expect(server.renewals).toHaveLength(0);

    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toEqual([
      {
        refreshToken: "refresh-at-sign-in",
        inactiveForInSeconds: 0,
        reportsActivityWhileInUse: true,
      },
    ]);
    expect(server.heardOfActivityAtMs).toBe(T0 + ACTIVITY_REPORT_INTERVAL_MS);
  });

  test("someone using the app for an hour, on a screen that asks the server nothing, is never unheard of for five minutes, and renews at most once a minute", async () => {
    let longestUnheardMs: number = 0;

    for (
      let at: number = T0 + 20 * SECOND;
      at <= T0 + HOUR;
      at += 20 * SECOND
    ) {
      await touch(at);

      longestUnheardMs = Math.max(
        longestUnheardMs,
        nowMs - server.heardOfActivityAtMs,
      );
    }

    expect(longestUnheardMs).toBeLessThan(ACTIVITY_REPORT_INTERVAL_MS);
    // About one renewal every five minutes: twelve in the hour, not one per touch.
    expect(server.renewals.length).toBeGreaterThanOrEqual(11);
    expect(server.renewals.length).toBeLessThanOrEqual(13);

    for (let index: number = 1; index < server.renewedAtMs.length; index++) {
      expect(
        server.renewedAtMs[index]! - server.renewedAtMs[index - 1]!,
      ).toBeGreaterThanOrEqual(MIN_TIME_BETWEEN_RENEWALS_MS);
    }

    // Every one of them said the person was here a moment ago.
    for (const body of server.renewals) {
      expect(body["inactiveForInSeconds"]).toBe(0);
    }
  });

  test("an app nobody touches renews nothing, however long it stays open", async () => {
    for (let at: number = T0 + MINUTE; at <= T0 + 3 * HOUR; at += MINUTE) {
      nowMs = at;
      await settleEventLoop();
    }

    expect(server.renewals).toHaveLength(0);
  });

  test("a renewal that got no answer is tried again a minute later, not at every touch", async () => {
    server.answer = "unreachable";

    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(1);

    for (
      let at: number = T0 + ACTIVITY_REPORT_INTERVAL_MS + 10 * SECOND;
      at < T0 + ACTIVITY_REPORT_INTERVAL_MS + MIN_TIME_BETWEEN_RENEWALS_MS;
      at += 10 * SECOND
    ) {
      await touch(at);
    }

    expect(server.renewals).toHaveLength(1);
    expect(authFailures).toEqual([]);

    // A minute later, still no signal: tried once more.
    await touch(
      T0 + ACTIVITY_REPORT_INTERVAL_MS + MIN_TIME_BETWEEN_RENEWALS_MS,
    );

    expect(server.renewals).toHaveLength(2);

    // The signal back: the next minute's touch is heard.
    server.answer = "renew";
    await touch(
      T0 + ACTIVITY_REPORT_INTERVAL_MS + 2 * MIN_TIME_BETWEEN_RENEWALS_MS,
    );

    expect(server.renewals).toHaveLength(3);
    expect(server.heardOfActivityAtMs).toBe(nowMs);

    // And nothing more until that is five minutes old.
    await touch(nowMs + ACTIVITY_REPORT_INTERVAL_MS - SECOND);

    expect(server.renewals).toHaveLength(3);
  });

  test("the activity heard of is kept on the phone's clock: a server whose clock runs four minutes ahead does not make every touch renew", async () => {
    server.clockAheadMs = 4 * MINUTE;

    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(1);

    // The token says the person was last heard of four minutes in the phone's future.
    for (
      let at: number = T0 + ACTIVITY_REPORT_INTERVAL_MS + 10 * SECOND;
      at < T0 + 2 * ACTIVITY_REPORT_INTERVAL_MS;
      at += 10 * SECOND
    ) {
      await touch(at);
    }

    expect(server.renewals).toHaveLength(1);

    await touch(T0 + 2 * ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(2);
  });

  test("a clock that moved back makes a report due at once, and one renewal sets it right", async () => {
    await touch(T0 + 10 * MINUTE);

    expect(server.renewals).toHaveLength(1);

    // The phone's clock is set back seven minutes.
    await touch(T0 + 3 * MINUTE);

    expect(server.renewals).toHaveLength(2);

    for (
      let at: number = T0 + 3 * MINUTE + 30 * SECOND;
      at < T0 + 3 * MINUTE + ACTIVITY_REPORT_INTERVAL_MS;
      at += 30 * SECOND
    ) {
      await touch(at);
    }

    expect(server.renewals).toHaveLength(2);
  });

  test("an app started again counts from what its access token says the server heard of, not from nothing", async () => {
    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(1);

    // The system ends the app: everything it held in memory is gone.
    await flushUserActivityWrites();
    resetUserActivityForTests();
    resetSessionRenewalForTests();

    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS + 2 * MINUTE);

    expect(server.renewals).toHaveLength(1);

    await touch(T0 + 2 * ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(2);
  });

  test("a new sign-in counts from its own sign-in, never from what the last session's renewals reported", async () => {
    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(1);

    captureRevokes(false);
    await logout();

    // Another session, signed in a minute later.
    const signedInAt: number = T0 + ACTIVITY_REPORT_INTERVAL_MS + MINUTE;
    await signIn(signedInAt, { sessionId: OTHER_SESSION_ID });
    await touch(signedInAt);

    // Five minutes after the last session's report, four after this sign-in.
    await touch(T0 + 2 * ACTIVITY_REPORT_INTERVAL_MS + 30 * SECOND);

    expect(server.renewals).toHaveLength(1);

    await touch(signedInAt + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(2);
    expect(server.renewals[1]!["refreshToken"]).toBe(
      `refresh-at-sign-in-${signedInAt}`,
    );
  });

  test("a phone put away while the server swept its session: the renewal its first touch makes is refused, and the session ends saying why", async () => {
    server.answer = "refuse";
    server.refusalMessage =
      SERVER_SESSION_ENDED_MESSAGES[ServerSessionEndReason.Inactive];

    await touch(T0 + 50 * MINUTE);

    expect(server.renewals).toHaveLength(1);
    expect(authFailures).toEqual(["inactive"]);
    expect(await getTokens()).toBeNull();
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

    // A plain refusal says no reason.
    expect(authFailures).toEqual([null]);
    expect(await getTokens()).toBeNull();
    expect(sent.outcome()).toBe("rejected");
    expect((sent.error() as AxiosError).response?.status).toBe(401);
  });

  test("no answer: the session is left as it was, and the next request decides", async () => {
    server.answer = "unreachable";

    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    expect(server.renewals).toHaveLength(1);
    expect(authFailures).toEqual([]);
    expect((await getTokens())?.refreshToken).toBe("refresh-at-sign-in");

    // The token it had is still good for a minute.
    nowMs = T0 + TOKEN_LIFETIME_MS - 30 * SECOND;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
  });

  test("a server error is no answer either: the session is left as it was", async () => {
    server.answer = "fail";

    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(1);
    expect(authFailures).toEqual([]);
    expect((await getTokens())?.refreshToken).toBe("refresh-at-sign-in");
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
    expect(authFailures).toEqual([null]);
    expect(await getTokens()).toBeNull();
  });
});

/*
 * Why the server ended the session (#8381): its refusal's message, the
 * server's own words (Common's SessionEndedException), reaches the
 * sign-in screen as a reason; any other refusal as none.
 */
describe("a session the server ended says why", () => {
  test.each<[string, string | null, SessionEndReason | null]>([
    [
      "the idle timeout",
      SERVER_SESSION_ENDED_MESSAGES[ServerSessionEndReason.Inactive],
      "inactive",
    ],
    [
      "the session length",
      SERVER_SESSION_ENDED_MESSAGES[ServerSessionEndReason.LengthReached],
      "length-reached",
    ],
    [
      "a refresh token that ran out, or a sign-out elsewhere",
      PLAIN_REFUSAL,
      null,
    ],
    ["a refusal with no body", null, null],
    [
      "a message that only looks like one",
      "You were signed out after a period without activity.",
      null,
    ],
  ])(
    "refused for %s, at a request's 401",
    async (
      _label: string,
      message: string | null,
      reason: SessionEndReason | null,
    ) => {
      server.answer = "refuse";
      server.refusalMessage = message;

      nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
      const sent: Sent = request();
      await settleEventLoop();

      expect(sent.outcome()).toBe("rejected");
      expect(authFailures).toEqual([reason]);
      expect(await getTokens()).toBeNull();
    },
  );

  test.each<[ServerSessionEndReason, SessionEndReason]>([
    [ServerSessionEndReason.Inactive, "inactive"],
    [ServerSessionEndReason.LengthReached, "length-reached"],
  ])(
    "refused for %s, at a renewal a touch started",
    async (serverReason: ServerSessionEndReason, reason: SessionEndReason) => {
      server.answer = "refuse";
      server.refusalMessage = SERVER_SESSION_ENDED_MESSAGES[serverReason];

      await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

      expect(authFailures).toEqual([reason]);
    },
  );

  test("a server error at a request's 401 ends the session as before, with no reason", async () => {
    server.answer = "fail";

    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    request();
    await settleEventLoop();

    expect(authFailures).toEqual([null]);
  });

  test("the requests still in flight come back refused one by one, with nothing left to renew, and say no reason", async () => {
    server.answer = "refuse";
    server.refusalMessage =
      SERVER_SESSION_ENDED_MESSAGES[ServerSessionEndReason.Inactive];

    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    request();
    await settleEventLoop();

    // A straggler of the ended session: no refresh token is left to renew with.
    request();
    await settleEventLoop();

    expect(authFailures).toEqual(["inactive", null]);
    expect(server.renewals).toHaveLength(1);
  });
});

/*
 * A SIGN-OUT WINS IN EVERY ORDER (#8382).
 *
 * The server rotates the refresh token at every renewal. A revoke that
 * names the token a renewal replaced finds no session, and leaves the
 * renewed one signed in on the server; a renewal's tokens written after the
 * sign-out cleared them sign the next launch in again.
 */
describe("signing out while the session is renewed", () => {
  test("a renewal a touch started before the sign-out: the sign-out waits for it, and revokes the session with the refresh token it was handed", async () => {
    const revokes: Revokes = captureRevokes(false);

    server.held = deferred<void>();

    // The tap on Sign out, a minute before the token runs out, renews it ahead...
    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    expect(server.renewals).toHaveLength(1);

    // ...and the sign-out starts while that renewal is on its way.
    const signingOut: Promise<void> = logout();
    await settleEventLoop();

    expect(revokes.sent).toHaveLength(0);

    server.held.settle();
    await signingOut;

    expect(revokes.sent).toEqual([
      {
        url: `${SERVER_URL}/identity/logout`,
        data: { refreshToken: "refresh-1" },
      },
    ]);
    expect(await getTokens()).toBeNull();
    expect(server.revokedRenewedSessions).toEqual([]);
  });

  test("a renewal a request's 401 started before the sign-out: the same", async () => {
    const revokes: Revokes = captureRevokes(false);

    server.held = deferred<void>();

    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    const sent: Sent = request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(1);

    const signingOut: Promise<void> = logout();
    await settleEventLoop();

    expect(revokes.sent).toHaveLength(0);

    server.held.settle();
    await signingOut;
    await settleEventLoop();

    expect(revokes.sent).toEqual([
      {
        url: `${SERVER_URL}/identity/logout`,
        data: { refreshToken: "refresh-1" },
      },
    ]);
    expect(await getTokens()).toBeNull();
    // The request it was renewed for was answered, before the revoke.
    expect(sent.outcome()).toBe("resolved");
  });

  test("a request that meets a 401 while the revoke is on its way starts no renewal: it is refused with its 401, and the revoke carries the token the app had", async () => {
    const revokes: Revokes = captureRevokes(true);

    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    const signingOut: Promise<void> = logout();
    await settleEventLoop();

    expect(revokes.sent).toHaveLength(1);

    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("rejected");
    expect((sent.error() as AxiosError).response?.status).toBe(401);
    expect(server.renewals).toHaveLength(0);

    revokes.held!.settle();
    await signingOut;

    expect(revokes.sent).toEqual([
      {
        url: `${SERVER_URL}/identity/logout`,
        data: { refreshToken: "refresh-at-sign-in" },
      },
    ]);
    expect(await getTokens()).toBeNull();
    // Not the server's word: the sign-out finishes its own way.
    expect(authFailures).toEqual([]);
  });

  test("a touch while the revoke is on its way renews nothing ahead, though its token is about to run out and a report is due", async () => {
    const revokes: Revokes = captureRevokes(true);

    const signingOut: Promise<void> = logout();
    await settleEventLoop();

    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    expect(server.renewals).toHaveLength(0);
    expect(areSessionRenewalsClosed()).toBe(true);
    expect(renewSessionAheadOfExpiry(nowMs)).toBeNull();

    revokes.held!.settle();
    await signingOut;

    expect(revokes.sent[0]!.data).toEqual({
      refreshToken: "refresh-at-sign-in",
    });
  });

  test("after the sign-out, nothing renews until a sign-in: not a touch, not a 401", async () => {
    captureRevokes(false);
    await logout();

    await touch(T0 + TOKEN_LIFETIME_MS + MINUTE);

    nowMs = T0 + TOKEN_LIFETIME_MS + 2 * MINUTE;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("rejected");
    expect(server.renewals).toHaveLength(0);
    expect(areSessionRenewalsClosed()).toBe(true);
  });

  test("a sign-out whose tokens could not be removed from storage leaves nothing to bring the session back: no request renews it", async () => {
    captureRevokes(false);

    const removeItem: jest.SpyInstance = jest
      .spyOn(AsyncStorage, "removeItem")
      .mockRejectedValueOnce(new Error("Storage refused"));

    await logout();

    expect(removeItem).toHaveBeenCalled();

    // The old tokens are still in storage, and a read puts them back in use...
    expect((await getTokens())?.refreshToken).toBe("refresh-at-sign-in");

    // ...but a request that meets a 401 renews nothing with them.
    nowMs = T0 + TOKEN_LIFETIME_MS + MINUTE;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("rejected");
    expect(server.renewals).toHaveLength(0);
  });

  test("a sign-in after the sign-out renews as before: ahead at a touch, and after a 401", async () => {
    captureRevokes(false);
    await logout();

    const signedInAt: number = T0 + 2 * MINUTE;
    await signIn(signedInAt);

    expect(areSessionRenewalsClosed()).toBe(false);

    await touch(signedInAt + ACTIVITY_REPORT_INTERVAL_MS);

    expect(server.renewals).toHaveLength(1);
    expect(server.renewals[0]!["refreshToken"]).toBe(
      `refresh-at-sign-in-${signedInAt}`,
    );

    nowMs = server.accessTokenExpiresAtMs + SECOND;
    const sent: Sent = request();
    await settleEventLoop();

    expect(sent.outcome()).toBe("resolved");
    expect(server.renewals).toHaveLength(2);
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

/*
 * What a renewal brings back belongs to the tokens it started from (#8382):
 * written over tokens that were cleared or replaced while it was on its
 * way, it would sign the next launch in again, or put an older session
 * back over a newer one. It is not stored, and the session it renewed -
 * which nobody else holds a refresh token of - is ended at the server.
 */
describe("a renewal that lands after the tokens changed", () => {
  test("tokens cleared while it was on its way stay cleared, and the session it renewed is ended at the server", async () => {
    server.held = deferred<void>();

    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);

    expect(server.renewals).toHaveLength(1);

    await clearTokens();
    server.held.settle();
    await settleEventLoop();
    await waitForSessionRenewal();

    expect(await getTokens()).toBeNull();
    expect(
      await AsyncStorage.getItem("com.oneuptime.oncall.tokens"),
    ).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
    expect(server.revokedRenewedSessions).toEqual(["refresh-1"]);
    // Not the server's word: no sign-in screen of its own, no reason.
    expect(authFailures).toEqual([]);
  });

  test("a sign-in that stored its tokens while it was on its way keeps them (single sign-on from Settings)", async () => {
    server.held = deferred<void>();

    // The token has run out: a touch renews it, and a request waits on that.
    await touch(T0 + TOKEN_LIFETIME_MS + MINUTE);

    const waiting: Sent = request();
    await settleEventLoop();

    expect(waiting.outcome()).toBe("pending");

    const newer: StoredTokens = {
      accessToken: signToken(nowMs, TOKEN_LIFETIME_MS, nowMs, OTHER_SESSION_ID),
      refreshToken: "refresh-of-the-newer-sign-in",
      refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
    };
    await storeTokens(newer);

    server.held.settle();
    await settleEventLoop();
    await waitForSessionRenewal();

    expect(await getTokens()).toEqual(newer);
    expect(getCachedAccessToken()).toBe(newer.accessToken);
    expect(server.revokedRenewedSessions).toEqual(["refresh-1"]);
    expect(authFailures).toEqual([]);
    // Never replayed as the older session: refused with its own 401.
    expect(waiting.outcome()).toBe("rejected");
    expect((waiting.error() as AxiosError).response?.status).toBe(401);
    expect(waiting.attempts).toHaveLength(1);
  });

  test("the same at a request's 401: the request is refused with it, and the session is not ended a second time", async () => {
    server.held = deferred<void>();

    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    const sent: Sent = request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(1);

    await clearTokens();
    server.held.settle();
    await settleEventLoop();

    expect(sent.outcome()).toBe("rejected");
    expect((sent.error() as AxiosError).response?.status).toBe(401);
    expect(await getTokens()).toBeNull();
    expect(server.revokedRenewedSessions).toEqual(["refresh-1"]);
    expect(authFailures).toEqual([]);
  });

  test("ending the renewed session at the server getting no answer leaves the app as it is", async () => {
    server.held = deferred<void>();
    server.revokeFails = true;

    await touch(T0 + TOKEN_LIFETIME_MS - MINUTE);
    await clearTokens();
    server.held.settle();
    await settleEventLoop();
    await waitForSessionRenewal();

    expect(await getTokens()).toBeNull();
    expect(authFailures).toEqual([]);
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
      reportsActivityWhileInUse: true,
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

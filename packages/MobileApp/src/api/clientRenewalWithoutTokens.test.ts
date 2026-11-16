import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
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
  startUserActivityTracking,
} from "../auth/userActivity";
import type { SessionEndReason } from "../auth/sessionEnded";
import { sessionAccessToken } from "../__tests__/sessionTokens";
import apiClient, {
  MIN_TIME_BETWEEN_RENEWALS_MS,
  readRenewedTokens,
  resetSessionRenewalForTests,
  setOnAuthFailure,
  waitForSessionRenewal,
} from "./client";
import { logout } from "./auth";

/*
 * A RENEWAL ANSWERED 200 WITHOUT USABLE TOKENS (issue #8838).
 *
 * The server answers every renewal it makes (POST /identity/refresh-token)
 * with the session's access token, refresh token and when that runs out.
 * The app renews at start-up and every five minutes in use to report its
 * person's activity (#8458), and a 200 without the tokens - a proxy, a
 * captive portal, an error page, the 14.3.0 web export's fixtures' { data:
 * [] } - was stored: empty tokens, no further request, and the app stopped
 * at "Loading project…" without a word.
 *
 * Such an answer is now a renewal that got no answer: nothing stored,
 * nothing noted as heard, the session going on with the tokens it had and
 * retried a minute later; a request already waiting with a 401 ends as it
 * would without an answer. A later answer with the tokens recovers.
 *
 * The real client; the renewal (bare axios) and the requests (a fake
 * adapter) are stand-ins; the clock is the test's.
 */

const SERVER_URL: string = "https://test.oneuptime.local";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;

const T0: number = Date.parse("2026-11-16T09:00:00.000Z");

const SESSION_ID: string = "6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a";

const TOKEN_LIFETIME_MS: number = 15 * MINUTE;

const OLD_REFRESH_TOKEN: string = "refresh-at-sign-in";

let nowMs: number = T0;

// What the renewal is answered with: the server's tokens, or one of the answers below.
type Answer = "tokens" | { data: unknown };

interface Server {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  answers: Array<Answer>;
  renewals: Array<Record<string, unknown>>;
  held: { promise: Promise<void>; settle: () => void } | null;
}

let server: Server;

function signToken(atMs: number, lastActiveAtMs: number): string {
  return sessionAccessToken({
    sessionId: SESSION_ID,
    signedInAtMs: T0 - 60 * MINUTE,
    lastActiveAtMs,
    issuedAtMs: atMs,
    expiresAtMs: atMs + TOKEN_LIFETIME_MS,
  });
}

// The answers no server makes, each a 200: the issue's and their kind.
const UNREADABLE_ANSWERS: Array<[string, unknown]> = [
  ["an empty body", ""],
  ["no body at all", undefined],
  ["null", null],
  ["an empty object", {}],
  ["the fixtures' { data: [] }", { data: [] }],
  ["an array", []],
  ["an HTML error page", "<html><body>Bad gateway</body></html>"],
  [
    "no access token",
    {
      refreshToken: "refresh-2",
      refreshTokenExpiresAt: "2026-12-16T09:00:00Z",
    },
  ],
  [
    "no refresh token",
    { accessToken: "access-2", refreshTokenExpiresAt: "2026-12-16T09:00:00Z" },
  ],
  ["no expiry", { accessToken: "access-2", refreshToken: "refresh-2" }],
  [
    "empty tokens",
    { accessToken: "", refreshToken: "", refreshTokenExpiresAt: "" },
  ],
  [
    "blank tokens",
    {
      accessToken: "  ",
      refreshToken: "refresh-2",
      refreshTokenExpiresAt: "2026-12-16T09:00:00Z",
    },
  ],
  [
    "tokens that are not text",
    { accessToken: 42, refreshToken: {}, refreshTokenExpiresAt: true },
  ],
  [
    "an expiry that is no date",
    {
      accessToken: "access-2",
      refreshToken: "refresh-2",
      refreshTokenExpiresAt: "next week",
    },
  ],
];

async function answerRenewal(
  url: string,
  body: Record<string, unknown>,
): Promise<AxiosResponse> {
  if (url.endsWith("/identity/logout")) {
    return { data: {} } as AxiosResponse;
  }

  server.renewals.push(body);

  if (server.held) {
    await server.held.promise;
  }

  const answer: Answer = server.answers.shift() ?? "tokens";

  if (answer !== "tokens") {
    return { status: 200, data: answer.data } as AxiosResponse;
  }

  const inactiveFor: number = Number(body["inactiveForInSeconds"] || 0);
  server.accessToken = signToken(nowMs, nowMs - inactiveFor * SECOND);
  server.accessTokenExpiresAtMs = nowMs + TOKEN_LIFETIME_MS;

  return {
    status: 200,
    data: {
      accessToken: server.accessToken,
      refreshToken: `refresh-${server.renewals.length}`,
      refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
    },
  } as AxiosResponse;
}

interface Sent {
  attempts: Array<string>;
  outcome: () => "pending" | "resolved" | "rejected";
  error: () => unknown;
}

// A request of the app's - its project, say - answered as the server would for its token.
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

    return isLive
      ? Promise.resolve(answer)
      : Promise.reject(
          new AxiosError("Request failed", "401", config, undefined, answer),
        );
  }

  const config: AxiosRequestConfig = { adapter };

  apiClient.get("/api/project/get-list", config).then(
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

async function touch(atMs: number): Promise<void> {
  nowMs = atMs;
  recordUserActivity(atMs);
  await settleEventLoop();
}

let authFailures: Array<SessionEndReason | null> = [];

let signedInTokens: StoredTokens;

// A session signed in an hour ago whose server last heard of its person `heardAgoMs` ago.
async function signedIn(heardAgoMs: number): Promise<void> {
  server.accessToken = signToken(nowMs, nowMs - heardAgoMs);
  server.accessTokenExpiresAtMs = nowMs + TOKEN_LIFETIME_MS;
  signedInTokens = {
    accessToken: server.accessToken,
    refreshToken: OLD_REFRESH_TOKEN,
    refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
  };
  await storeTokens(signedInTokens);
}

// The app starts on the screen: the start is activity, and a report is due.
async function launch(atMs: number): Promise<void> {
  nowMs = atMs;
  (AppState as unknown as { currentState: unknown }).currentState = "active";
  startUserActivityTracking();
  await settleEventLoop();
  await waitForSessionRenewal();
  await settleEventLoop();
}

beforeEach(async () => {
  nowMs = T0;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowMs;
  });
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(
      (_type: string, _handler: (state: AppStateStatus) => void) => {
        return { remove: jest.fn() } as never;
      },
    );
  (AppState as unknown as { currentState: unknown }).currentState = "active";

  resetUserActivityForTests();
  resetSessionRenewalForTests();
  clearAllSsoDenials();
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl(SERVER_URL);

  server = {
    accessToken: "",
    accessTokenExpiresAtMs: 0,
    answers: [],
    renewals: [],
    held: null,
  };

  jest.spyOn(axios, "post").mockImplementation(answerRenewal as never);

  authFailures = [];
  setOnAuthFailure((reason: SessionEndReason | null): void => {
    authFailures.push(reason);
  });
});

afterEach(async () => {
  server.held?.settle();
  await settleEventLoop();
  await waitForSessionRenewal();
  await flushUserActivityWrites();
  resetUserActivityForTests();
  apiClient.defaults.adapter = undefined;
  jest.restoreAllMocks();
});

describe("readRenewedTokens", () => {
  test("reads the three tokens of a server's answer", () => {
    expect(
      readRenewedTokens({
        accessToken: "access",
        refreshToken: "refresh",
        refreshTokenExpiresAt: "2026-12-16T09:00:00.000Z",
        anythingElse: true,
      }),
    ).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      refreshTokenExpiresAt: "2026-12-16T09:00:00.000Z",
    });
  });

  test.each(UNREADABLE_ANSWERS)(
    "reads nothing from %s",
    (_label: string, data: unknown) => {
      expect(readRenewedTokens(data)).toBeNull();
    },
  );
});

describe.each(UNREADABLE_ANSWERS)(
  "a renewal answered with %s",
  (_label: string, data: unknown) => {
    test("at start-up: nothing stored, the old tokens kept, still signed in, and the project loads", async () => {
      await signedIn(6 * MINUTE);
      server.answers = [{ data }];

      await launch(T0);

      // The start-up renewal was made, to report the person's activity.
      expect(server.renewals).toHaveLength(1);
      expect(await getTokens()).toEqual(signedInTokens);
      expect(getCachedAccessToken()).toBe(signedInTokens.accessToken);
      expect(authFailures).toEqual([]);

      const project: Sent = request();
      await settleEventLoop();

      expect(project.outcome()).toBe("resolved");
      expect(project.attempts).toEqual([
        `Bearer ${signedInTokens.accessToken}`,
      ]);
    });

    test("at the five-minute activity renewal: the same, and tried again a minute later, not at every touch", async () => {
      await signedIn(0);
      await touch(T0);

      server.answers = [{ data }];
      await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);

      expect(server.renewals).toHaveLength(1);
      expect(await getTokens()).toEqual(signedInTokens);
      expect(authFailures).toEqual([]);

      for (
        let at: number = T0 + ACTIVITY_REPORT_INTERVAL_MS + 10 * SECOND;
        at < T0 + ACTIVITY_REPORT_INTERVAL_MS + MIN_TIME_BETWEEN_RENEWALS_MS;
        at += 10 * SECOND
      ) {
        await touch(at);
      }

      expect(server.renewals).toHaveLength(1);

      // Still due - the server never heard of the person - so a minute later: again.
      await touch(
        T0 + ACTIVITY_REPORT_INTERVAL_MS + MIN_TIME_BETWEEN_RENEWALS_MS,
      );

      expect(server.renewals).toHaveLength(2);
    });

    test("a later answer with the tokens recovers: stored, and the next report five minutes after it", async () => {
      await signedIn(6 * MINUTE);
      server.answers = [{ data }];
      await launch(T0);

      // A minute on, the network answers as the server does.
      await touch(T0 + MIN_TIME_BETWEEN_RENEWALS_MS);

      expect(server.renewals).toHaveLength(2);
      expect((await getTokens())?.refreshToken).toBe("refresh-2");
      expect(getCachedAccessToken()).toBe(server.accessToken);

      // Heard of now: nothing more until five minutes on.
      await touch(
        T0 +
          MIN_TIME_BETWEEN_RENEWALS_MS +
          ACTIVITY_REPORT_INTERVAL_MS -
          SECOND,
      );

      expect(server.renewals).toHaveLength(2);

      const project: Sent = request();
      await settleEventLoop();

      expect(project.outcome()).toBe("resolved");
    });

    test("at a request's 401: the request is refused, the session ends as without an answer, and no empty token is ever stored", async () => {
      await signedIn(0);
      await touch(T0);
      server.answers = [{ data }];

      // The token has run out; the next request meets a 401 and renews.
      nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
      const project: Sent = request();
      await settleEventLoop();

      expect(server.renewals).toHaveLength(1);
      expect(project.outcome()).toBe("rejected");
      expect((project.error() as AxiosError).response?.status).toBe(401);
      expect(authFailures).toEqual([null]);
      expect(await getTokens()).toBeNull();
      expect(
        await AsyncStorage.getItem("com.oneuptime.oncall.tokens"),
      ).toBeNull();
    });
  },
);

describe("recovering through a request's 401", () => {
  test("after an unreadable answer kept the old tokens, the request after they ran out renews them and is replayed with the new token", async () => {
    await signedIn(6 * MINUTE);
    server.answers = [{ data: { data: [] } }];
    await launch(T0);

    expect(await getTokens()).toEqual(signedInTokens);

    // The old access token runs out untouched; a request meets a 401, and the network is back.
    nowMs = T0 + TOKEN_LIFETIME_MS + 30 * SECOND;
    const project: Sent = request();
    await settleEventLoop();

    expect(server.renewals).toHaveLength(2);
    expect(project.outcome()).toBe("resolved");
    expect(project.attempts).toEqual([
      `Bearer ${signedInTokens.accessToken}`,
      `Bearer ${server.accessToken}`,
    ]);
    expect((await getTokens())?.refreshToken).toBe("refresh-2");
    expect(authFailures).toEqual([]);
  });
});

describe("what an unreadable answer leaves as it was", () => {
  test("the time without use it was to report is reported by the next renewal that gets the tokens", async () => {
    await signedIn(0);
    await touch(T0);

    // Twenty minutes away, then back: the renewal it makes is answered with nothing.
    server.answers = [{ data: { data: [] } }];
    await touch(T0 + 20 * MINUTE);

    expect(server.renewals[0]!["longestInactivity"]).toEqual({
      forSeconds: 20 * 60,
      endedSecondsAgo: 0,
    });

    await touch(T0 + 21 * MINUTE);

    expect(server.renewals).toHaveLength(2);
    expect(server.renewals[1]!["longestInactivity"]).toEqual({
      forSeconds: 20 * 60,
      endedSecondsAgo: 60,
    });
  });

  test("a request waiting on it with a 401 ends as it would without an answer", async () => {
    await signedIn(0);
    await touch(T0);

    let settle: () => void = (): void => {
      return undefined;
    };
    server.held = {
      promise: new Promise<void>((resolve: () => void): void => {
        settle = resolve;
      }),
      settle: (): void => {
        settle();
      },
    };
    server.answers = [{ data: "" }];

    // The token has run out: a touch renews it, and a request waits on that.
    await touch(T0 + TOKEN_LIFETIME_MS + MINUTE);
    const project: Sent = request();
    await settleEventLoop();

    expect(project.outcome()).toBe("pending");

    server.held.settle();
    await settleEventLoop();

    expect(project.outcome()).toBe("rejected");
    expect(authFailures).toEqual([null]);
    expect(await getTokens()).toBeNull();
  });

  test("a sign-out while it is on its way still revokes with the refresh token the app had, and nothing is stored after", async () => {
    const revoked: Array<unknown> = [];

    apiClient.defaults.adapter = (
      config: InternalAxiosRequestConfig,
    ): Promise<AxiosResponse> => {
      revoked.push(JSON.parse(String(config.data)));
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      } as AxiosResponse);
    };

    await signedIn(0);
    await touch(T0);

    let settle: () => void = (): void => {
      return undefined;
    };
    server.held = {
      promise: new Promise<void>((resolve: () => void): void => {
        settle = resolve;
      }),
      settle: (): void => {
        settle();
      },
    };
    server.answers = [{ data: { data: [] } }];

    await touch(T0 + ACTIVITY_REPORT_INTERVAL_MS);
    const signingOut: Promise<void> = logout();
    await settleEventLoop();
    server.held.settle();
    await signingOut;

    expect(revoked).toEqual([{ refreshToken: OLD_REFRESH_TOKEN }]);
    expect(await getTokens()).toBeNull();
    expect(getCachedAccessToken()).toBeNull();
  });
});

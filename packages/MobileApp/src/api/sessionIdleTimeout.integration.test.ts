import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { clearTokens, getTokens, storeTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import { clearAllSsoTokens } from "../storage/ssoTokens";
import { clearAllSsoDenials } from "../sso/ssoDenials";
import {
  flushUserActivityWrites,
  recordUserActivity,
  resetUserActivityForTests,
  startUserActivityTracking,
} from "../auth/userActivity";
import { sessionAccessToken } from "../__tests__/sessionTokens";
import apiClient, {
  resetSessionRenewalForTests,
  setOnAuthFailure,
  waitForSessionRenewal,
} from "./client";
import type { SessionEndReason as AppSessionEndReason } from "../auth/sessionEnded";
import {
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
  decideSessionRenewal,
  getIdleTimeoutSweepCutoff,
  getSessionEnd,
  IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
  INACTIVE_FOR_IN_SECONDS_FIELD,
  LONGEST_INACTIVITY_FIELD,
  NO_RENEWAL_REPORT,
  readReportedInactivityInSeconds,
  readReportedLongestInactivity,
  readReportsActivityWhileInUse,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
  SessionEndReason,
  type RenewalReport,
  type SessionEnd,
  type SessionFacts,
  type SessionLengths,
  type SessionRenewalOutcome,
} from "../../../Common/Types/UserSession/SessionLength";
import { SESSION_ENDED_MESSAGES } from "../../../Common/Types/Exception/SessionEndedException";

/*
 * ISSUE #8187, FROM THE APP TO THE SERVER'S DECISION AND BACK.
 *
 * Under the 15-minute idle timeout the app was signed out at every renewal,
 * however much it was used: it renewed only once its access token had run
 * out, said nothing of its person's use, and the token runs out exactly at
 * the idle end of the renewal before - so the server, counting from that
 * renewal, found the idle timeout reached every time.
 *
 * Here the app's real client and its real activity tracker talk to a
 * stand-in for the identity server that decides each renewal with the
 * server's real decision (Common/Types/UserSession/SessionLength.ts
 * decideSessionRenewal), reading the body with the server's own readers,
 * and signs access tokens that live as the real ones do
 * (UserSessionService.getAccessTokenExpiresInSeconds: 15 minutes, or until
 * the session ends if that is sooner). Every request is refused once its
 * token has run out. Only the transport, the storage and the phone are
 * stand-ins.
 *
 * Checked from both sides of the idle timeout:
 *
 *   - an app in use - pulled to refresh every minute, or every five - is
 *     never signed out, under the shortest idle timeout, for hours;
 *   - an app put away for the idle timeout is signed out when it comes
 *     back, and one put away a second less is not; so is one the system
 *     ended and the person opened again, and one left on the screen
 *     untouched;
 *   - an app updated to this one, with nothing kept yet, still counts the
 *     time since the session's last renewal;
 *   - longer idle timeouts, and none, keep working as they did.
 *
 * And the server's five-minute sweep (issue #8458,
 * UserSessionService.endSessionsThatRanOut): every renewal of the app says
 * it renews while in use, so the stand-in ends, every five minutes, a
 * session whose last renewal said so and that it has heard nothing of for
 * its idle timeout and the margin (getIdleTimeoutSweepCutoff) - the real
 * rule. An app in use is never swept, a phone put away is swept within
 * the idle timeout and 35 minutes, and either way the app, opened again,
 * says why it was signed out (issue #8381): the stand-in refuses an ended
 * session with the server's own words (SessionEndedException).
 */

const SERVER_URL: string = "https://test.oneuptime.local";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// How long an access token lives at most (UserSessionService.ACCESS_TOKEN_LIFETIME_IN_SECONDS).
const ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 15 * 60;

const T0: number = Date.parse("2026-11-15T09:00:00.000Z");

const SESSION_ID: string = "6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a";

let nowMs: number = T0;

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

let authFailures: number = 0;

// Why each end of the session the app was told of happened, as it was told.
let authFailureReasons: Array<AppSessionEndReason | null> = [];

// How often the server's sweep runs (EndSessionsThatRanOut: every five minutes).
const SWEEP_EVERY_MS: number = 5 * MINUTE;

/*
 * The reasons the app was told, leaving out the ends that said none: the
 * requests still in flight when the session ended come back refused one by
 * one, with nothing left to renew, and say no reason (the AuthProvider
 * keeps the one that did).
 */
function reasonsSaid(): Array<AppSessionEndReason> {
  return authFailureReasons.filter(
    (reason: AppSessionEndReason | null): reason is AppSessionEndReason => {
      return reason !== null;
    },
  );
}

const lengthsOf: (rule: {
  length?: number;
  idle?: number;
}) => SessionLengths = (rule: {
  length?: number;
  idle?: number;
}): SessionLengths => {
  const standard: SessionLengths["standard"] = {
    lengthInMinutes: rule.length ?? null,
    idleTimeoutInMinutes: rule.idle ?? null,
  };

  return { standard, sso: { ...standard } };
};

/*
 * The identity server, as far as one session goes: its row (when it signed
 * in, when its person was last active), the access token it last signed,
 * and whether it has ended.
 */
class IdentityServer {
  public readonly signedInAtMs: number;

  public lastActiveAtMs: number;

  public accessToken: string = "";

  public accessTokenExpiresAtMs: number = 0;

  public refreshToken: string = "refresh-at-sign-in";

  public endedFor: string | null = null;

  // When the sweep ended it, when it did.
  public sweptAtMs: number | null = null;

  public renewals: Array<Record<string, unknown>> = [];

  // What the last renewal said of renewing while in use (UserSession.additionalInfo).
  public reportsActivityWhileInUse: boolean = false;

  // When the sweep last ran.
  private lastSweepAtMs: number;

  public constructor(public readonly lengths: SessionLengths | null) {
    this.signedInAtMs = nowMs;
    this.lastActiveAtMs = nowMs;
    this.lastSweepAtMs = nowMs;
    this.sign();
  }

  /*
   * The five-minute sweep, run for every five minutes up to `untilMs`
   * (UserSessionService.endSessionsPastIdleTimeout): a live session whose
   * last renewal said it renews while in use, last active at or before its
   * idle timeout and the margin ago, is ended as its idle timeout.
   */
  public sweepUntil(untilMs: number): void {
    const idleTimeoutInMinutes: number | null =
      this.lengths?.standard.idleTimeoutInMinutes ?? null;

    while (this.lastSweepAtMs + SWEEP_EVERY_MS <= untilMs) {
      this.lastSweepAtMs += SWEEP_EVERY_MS;

      if (
        this.endedFor !== null ||
        idleTimeoutInMinutes === null ||
        !this.reportsActivityWhileInUse
      ) {
        continue;
      }

      const cutoff: Date = getIdleTimeoutSweepCutoff({
        idleTimeoutInMinutes,
        now: new Date(this.lastSweepAtMs),
      });

      if (this.lastActiveAtMs <= cutoff.getTime()) {
        this.endedFor = SessionEndReason.Inactive;
        this.sweptAtMs = this.lastSweepAtMs;
      }
    }
  }

  public facts(): SessionFacts {
    return {
      signedInAt: new Date(this.signedInAtMs),
      lastActiveAt: new Date(this.lastActiveAtMs),
      isSsoSignIn: false,
    };
  }

  // A request: answered while its token lives and the session has not ended.
  public isServed(authorization: string): boolean {
    this.sweepUntil(nowMs);

    return (
      this.endedFor === null &&
      authorization === `Bearer ${this.accessToken}` &&
      nowMs < this.accessTokenExpiresAtMs
    );
  }

  // POST /identity/refresh-token, as Authentication.ts reads and decides it.
  public renew(body: Record<string, unknown>): AxiosResponse {
    this.sweepUntil(nowMs);
    this.renewals.push(body);

    // An ended session is refused with why it ended (Authentication.ts refuseEndedSession).
    if (this.endedFor !== null) {
      throw refusal(this.endedFor as SessionEndReason);
    }

    if (body["refreshToken"] !== this.refreshToken) {
      throw refusal(null);
    }

    const report: RenewalReport = {
      inactiveForInSeconds: readReportedInactivityInSeconds(
        body[INACTIVE_FOR_IN_SECONDS_FIELD],
      ),
      longestInactivity: readReportedLongestInactivity(
        body[LONGEST_INACTIVITY_FIELD],
      ),
    };

    const outcome: SessionRenewalOutcome = decideSessionRenewal({
      facts: this.facts(),
      lengths: this.lengths,
      report: report,
      now: new Date(nowMs),
    });

    if (outcome.hasEnded) {
      this.endedFor = outcome.reason;
      throw refusal(outcome.reason);
    }

    this.lastActiveAtMs = outcome.lastActiveAt.getTime();
    this.reportsActivityWhileInUse = readReportsActivityWhileInUse(
      body[REPORTS_ACTIVITY_WHILE_IN_USE_FIELD],
    );
    this.refreshToken = `refresh-${this.renewals.length}`;
    this.sign();

    return {
      data: {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
      },
    } as AxiosResponse;
  }

  // As UserSessionService.getAccessTokenExpiresInSeconds: 15 minutes, or until the session ends.
  private sign(): void {
    const end: SessionEnd = getSessionEnd(this.facts(), this.lengths);
    const untilEndInSeconds: number = Math.floor(
      (end.endsAt.getTime() - nowMs) / 1000,
    );
    const lifetimeInSeconds: number = Math.max(
      1,
      Math.min(ACCESS_TOKEN_LIFETIME_IN_SECONDS, untilEndInSeconds),
    );

    this.accessTokenExpiresAtMs = nowMs + lifetimeInSeconds * SECOND;
    this.accessToken = sessionAccessToken({
      sessionId: SESSION_ID,
      signedInAtMs: this.signedInAtMs,
      lastActiveAtMs: this.lastActiveAtMs,
      issuedAtMs: nowMs,
      expiresAtMs: this.accessTokenExpiresAtMs,
    });
  }
}

/*
 * The server's 401 for a refused renewal: the session lengths' own words
 * (SessionEndedException) when they ended it, or the plain refusal of a
 * refresh token that matches no session.
 */
function refusal(reason: SessionEndReason | null): AxiosError {
  const config: InternalAxiosRequestConfig = {
    headers: {},
  } as InternalAxiosRequestConfig;

  return new AxiosError(
    "Request failed with status code 401",
    "401",
    config,
    undefined,
    {
      data: {
        message: reason
          ? SESSION_ENDED_MESSAGES[reason]
          : "Session expired. Please sign in again.",
      },
      status: 401,
      statusText: "Unauthorized",
      headers: {},
      config,
    } as AxiosResponse,
  );
}

let identity: IdentityServer;

async function settleEventLoop(): Promise<void> {
  for (let turn: number = 0; turn < 10; turn++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

// A request of the app's, made at `nowMs`; resolves with whether it was served.
async function request(): Promise<boolean> {
  function adapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const authorization: string = String(
      config.headers.get("authorization") ?? "",
    );
    const served: boolean = identity.isServed(authorization);
    const answer: AxiosResponse = {
      data: {},
      status: served ? 200 : 401,
      statusText: served ? "OK" : "Unauthorized",
      headers: {},
      config,
    } as AxiosResponse;

    if (served) {
      return Promise.resolve(answer);
    }

    return Promise.reject(
      new AxiosError("Request failed", "401", config, undefined, answer),
    );
  }

  const config: AxiosRequestConfig = { adapter };

  try {
    await apiClient.get("/api/incident/get-list", config);
    return true;
  } catch {
    return false;
  } finally {
    await settleEventLoop();
  }
}

// Time passes to `atMs`, the server sweeping every five minutes on the way.
async function at(atMs: number): Promise<void> {
  nowMs = atMs;
  identity.sweepUntil(atMs);
  await settleEventLoop();
}

// The person touches the app.
async function touch(atMs: number): Promise<void> {
  nowMs = atMs;
  identity.sweepUntil(atMs);
  recordUserActivity(atMs);
  await settleEventLoop();
}

// The person pulls the list to refresh it: a touch, and the request it makes.
async function pullToRefresh(atMs: number): Promise<boolean> {
  await touch(atMs);
  return await request();
}

async function appState(state: AppStateStatus, atMs: number): Promise<void> {
  nowMs = atMs;
  identity.sweepUntil(atMs);
  (AppState as unknown as { currentState: unknown }).currentState = state;
  appStateHandler!(state);
  await settleEventLoop();
  await waitForSessionRenewal();
  await settleEventLoop();
}

// The app starts, on the screen.
async function launch(atMs: number): Promise<void> {
  nowMs = atMs;
  identity.sweepUntil(atMs);
  (AppState as unknown as { currentState: unknown }).currentState = "active";
  startUserActivityTracking();
  await settleEventLoop();
  await waitForSessionRenewal();
  await settleEventLoop();
}

// The system ends the app's process: everything it held in memory is gone.
async function kill(): Promise<void> {
  await flushUserActivityWrites();
  resetUserActivityForTests();
  resetSessionRenewalForTests();
}

// The person signs in on the app at `nowMs`, under the lengths.
async function signIn(lengths: SessionLengths | null): Promise<void> {
  identity = new IdentityServer(lengths);
  await storeTokens({
    accessToken: identity.accessToken,
    refreshToken: identity.refreshToken,
    refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
  });
  await launch(nowMs);
}

async function isSignedIn(): Promise<boolean> {
  return authFailures === 0 && (await getTokens()) !== null;
}

beforeEach(async () => {
  nowMs = T0;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowMs;
  });

  appStateHandler = null;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(
      (_type: string, handler: (state: AppStateStatus) => void) => {
        appStateHandler = handler;
        return { remove: jest.fn() } as never;
      },
    );

  resetUserActivityForTests();
  resetSessionRenewalForTests();
  clearAllSsoDenials();
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl(SERVER_URL);

  // Spied afresh each test: the restoreAllMocks below puts the real one back.
  jest
    .spyOn(axios, "post")
    .mockImplementation(
      async (_url: string, body: unknown): Promise<AxiosResponse> => {
        return identity.renew(body as Record<string, unknown>);
      },
    );

  authFailures = 0;
  authFailureReasons = [];
  setOnAuthFailure((reason: AppSessionEndReason | null): void => {
    authFailures++;
    authFailureReasons.push(reason);
  });
});

afterEach(async () => {
  await waitForSessionRenewal();
  await flushUserActivityWrites();
  resetUserActivityForTests();
  jest.restoreAllMocks();
});

describe("an app in use stays signed in under the shortest idle timeout (#8187)", () => {
  test("pulled to refresh every minute for three hours: every request served, never signed out", async () => {
    await signIn(lengthsOf({ idle: 15 }));

    for (let minute: number = 1; minute <= 180; minute++) {
      expect(await pullToRefresh(T0 + minute * MINUTE)).toBe(true);
    }

    expect(await isSignedIn()).toBe(true);
    expect(identity.endedFor).toBeNull();
    // Renewed all along, each one a little before the token ran out.
    expect(identity.renewals.length).toBeGreaterThanOrEqual(12);
  });

  test("pulled to refresh every five minutes - each renewal at the very end of its token: never signed out", async () => {
    await signIn(lengthsOf({ idle: 15 }));

    for (let minute: number = 5; minute <= 180; minute += 5) {
      expect(await pullToRefresh(T0 + minute * MINUTE)).toBe(true);
    }

    expect(await isSignedIn()).toBe(true);
  });

  test("touched without a request in between, then a request after the token ran out: served", async () => {
    await signIn(lengthsOf({ idle: 15 }));

    for (let minute: number = 1; minute <= 12; minute++) {
      await touch(T0 + minute * MINUTE);
    }

    // Renewed only to tell the server of the person, every five minutes (#8458).
    expect(identity.renewals).toHaveLength(2);

    await touch(T0 + 15 * MINUTE + 10 * SECOND);

    expect(await request()).toBe(true);
    expect(await isSignedIn()).toBe(true);
  });
});

/*
 * ISSUE #8458: THE SWEEP RECORDS AN IDLE TIMEOUT WITHIN MINUTES, AND NEVER
 * SIGNS OUT AN APP IN USE.
 *
 * The sweep ends a session whose last renewal said it renews while in use
 * once it has heard nothing of it for its idle timeout and the margin. The
 * app keeps the promise, so someone using it is never swept, however they
 * use it; one put away is swept within the idle timeout and 35 minutes,
 * rather than at the next renewal - 30 days later for a phone never opened
 * again.
 */
describe("the server's sweep, with an app that renews while in use (#8458)", () => {
  // The latest the sweep ends a session: the margin, and one sweep after it.
  const SWEPT_WITHIN_MS: number =
    (IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES + 5) * MINUTE;

  test("every renewal says the app renews while in use, and the server keeps it", async () => {
    await signIn(lengthsOf({ idle: 15 }));
    await touch(T0 + ACTIVITY_REPORTED_WITHIN_IN_MINUTES * MINUTE);

    expect(identity.renewals).toHaveLength(1);
    expect(identity.renewals[0]![REPORTS_ACTIVITY_WHILE_IN_USE_FIELD]).toBe(
      true,
    );
    expect(identity.reportsActivityWhileInUse).toBe(true);
  });

  test("touched every 30 seconds for three hours, asking the server nothing: never swept, never signed out", async () => {
    await signIn(lengthsOf({ idle: 15 }));

    for (
      let at: number = T0 + 30 * SECOND;
      at <= T0 + 3 * HOUR;
      at += 30 * SECOND
    ) {
      await touch(at);

      // Never longer than the interval without the server hearing of the person.
      expect(nowMs - identity.lastActiveAtMs).toBeLessThan(
        ACTIVITY_REPORTED_WITHIN_IN_MINUTES * MINUTE,
      );
    }

    expect(identity.endedFor).toBeNull();
    expect(await request()).toBe(true);
    expect(await isSignedIn()).toBe(true);
  });

  test("touched every four minutes, a list pulled now and then: never swept", async () => {
    await signIn(lengthsOf({ idle: 15 }));

    for (let minute: number = 4; minute <= 180; minute += 4) {
      if (minute % 20 === 0) {
        expect(await pullToRefresh(T0 + minute * MINUTE)).toBe(true);
      } else {
        await touch(T0 + minute * MINUTE);
      }
    }

    expect(identity.endedFor).toBeNull();
    expect(await isSignedIn()).toBe(true);
  });

  test.each([15, 30, 60])(
    "under a %i-minute idle timeout, a phone put away is swept within the idle timeout and 35 minutes of the last touch, and says why when it is opened",
    async (idle: number) => {
      await signIn(lengthsOf({ idle }));
      await pullToRefresh(T0 + 6 * MINUTE);

      const lastTouchAt: number = T0 + 6 * MINUTE;
      await appState("background", lastTouchAt + SECOND);

      // Nobody opens it again: only the sweep runs.
      await at(
        lastTouchAt +
          idle * MINUTE +
          IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES * MINUTE -
          MINUTE,
      );

      expect(identity.endedFor).toBeNull();

      await at(lastTouchAt + idle * MINUTE + SWEPT_WITHIN_MS);

      expect(identity.endedFor).toBe(SessionEndReason.Inactive);
      expect(identity.sweptAtMs! - lastTouchAt).toBeLessThanOrEqual(
        idle * MINUTE + SWEPT_WITHIN_MS,
      );

      // Opened hours later: refused, and the sign-in screen is told why.
      await appState("active", lastTouchAt + 5 * HOUR);

      expect(await request()).toBe(false);
      expect(await isSignedIn()).toBe(false);
      expect(reasonsSaid()).toEqual(["inactive"]);
    },
  );

  test("a phone put away and opened again inside the idle timeout and the margin is not swept, and the server hears of it at once", async () => {
    await signIn(lengthsOf({ idle: 60 }));
    await pullToRefresh(T0 + 6 * MINUTE);
    await appState("background", T0 + 6 * MINUTE);

    // Back 50 minutes later: inside the 60-minute idle timeout.
    await appState("active", T0 + 56 * MINUTE);

    expect(identity.endedFor).toBeNull();
    expect(await request()).toBe(true);
    expect(identity.lastActiveAtMs).toBe(T0 + 56 * MINUTE);
  });

  test("no idle timeout: never swept, however long the phone is put away", async () => {
    await signIn(lengthsOf({}));
    await pullToRefresh(T0 + 6 * MINUTE);
    await appState("background", T0 + 6 * MINUTE);
    await at(T0 + 10 * HOUR);

    expect(identity.endedFor).toBeNull();
  });

  test("a session length ended at a renewal says so on the way to the sign-in", async () => {
    await signIn(lengthsOf({ length: 60, idle: 15 }));

    for (let minute: number = 1; minute < 60; minute++) {
      expect(await pullToRefresh(T0 + minute * MINUTE)).toBe(true);
    }

    expect(await pullToRefresh(T0 + 60 * MINUTE)).toBe(false);
    expect(reasonsSaid()).toEqual(["length-reached"]);
  });

  test("an idle timeout ended at a renewal says so too", async () => {
    await signIn(lengthsOf({ idle: 15 }));
    await pullToRefresh(T0 + 2 * MINUTE);
    await appState("background", T0 + 2 * MINUTE + 5 * SECOND);
    await appState("active", T0 + 20 * MINUTE);

    expect(await request()).toBe(false);
    expect(reasonsSaid()).toEqual(["inactive"]);
  });
});

describe("an app not used for the idle timeout is signed out when it is used again", () => {
  test.each([
    ["a second short of the idle timeout: still signed in", -SECOND, true],
    ["the idle timeout exactly: signed out", 0, false],
    ["a second past it: signed out", SECOND, false],
  ])(
    "put in the background and brought back - %s",
    async (_label: string, beyondMs: number, staysSignedIn: boolean) => {
      await signIn(lengthsOf({ idle: 15 }));
      await pullToRefresh(T0 + 2 * MINUTE);
      await appState("background", T0 + 2 * MINUTE + 5 * SECOND);

      const backAt: number = T0 + 2 * MINUTE + 15 * MINUTE + beyondMs;
      await appState("active", backAt);

      expect(await request()).toBe(staysSignedIn);
      expect(await isSignedIn()).toBe(staysSignedIn);
      expect(identity.endedFor).toBe(staysSignedIn ? null : "inactive");
    },
  );

  test.each([
    ["a second short of the idle timeout: still signed in", -SECOND, true],
    ["the idle timeout exactly: signed out", 0, false],
    ["an hour later: signed out", HOUR, false],
  ])(
    "put away, ended by the system, opened again - %s",
    async (_label: string, beyondMs: number, staysSignedIn: boolean) => {
      await signIn(lengthsOf({ idle: 15 }));
      await pullToRefresh(T0 + 5 * MINUTE);
      await appState("background", T0 + 5 * MINUTE + SECOND);
      await kill();

      await launch(T0 + 5 * MINUTE + 15 * MINUTE + beyondMs);

      expect(await request()).toBe(staysSignedIn);
      expect(await isSignedIn()).toBe(staysSignedIn);
    },
  );

  test("opened again after a renewal in between: the time away still counts from the last use, not from that renewal", async () => {
    await signIn(lengthsOf({ idle: 15 }));
    // A renewal ahead at minute 14, then one more minute of use.
    await pullToRefresh(T0 + 14 * MINUTE);
    await pullToRefresh(T0 + 15 * MINUTE);

    expect(identity.renewals).toHaveLength(1);

    await appState("background", T0 + 15 * MINUTE);
    await appState("active", T0 + 30 * MINUTE);

    expect(await request()).toBe(false);
    expect(identity.endedFor).toBe("inactive");
  });

  test("left on the screen untouched, its lists still reloading: signed out at the first request past the idle timeout", async () => {
    await signIn(lengthsOf({ idle: 15 }));

    for (let minute: number = 1; minute < 15; minute++) {
      await at(T0 + minute * MINUTE);
      expect(await request()).toBe(true);
    }

    await at(T0 + 15 * MINUTE + 30 * SECOND);

    expect(await request()).toBe(false);
    expect(await isSignedIn()).toBe(false);
    expect(identity.endedFor).toBe("inactive");
  });

  test("an app updated to this one, with nothing kept yet, counts from the session's last renewal", async () => {
    await signIn(lengthsOf({ idle: 15 }));
    await kill();
    // What an earlier version of the app left: its tokens, and no record of activity.
    await AsyncStorage.removeItem("com.oneuptime.oncall.userActivity");

    await launch(T0 + 20 * MINUTE);

    expect(await request()).toBe(false);
    expect(identity.endedFor).toBe("inactive");
  });

  test("...and stays signed in when it is opened within the idle timeout", async () => {
    await signIn(lengthsOf({ idle: 15 }));
    await kill();
    await AsyncStorage.removeItem("com.oneuptime.oncall.userActivity");

    await launch(T0 + 10 * MINUTE);

    expect(await request()).toBe(true);

    for (let minute: number = 11; minute <= 60; minute++) {
      expect(await pullToRefresh(T0 + minute * MINUTE)).toBe(true);
    }

    expect(await isSignedIn()).toBe(true);
  });
});

describe("other lengths keep working as they did", () => {
  test("a 30-minute idle timeout: twenty minutes in the background is fine, thirty-one is not", async () => {
    await signIn(lengthsOf({ idle: 30 }));
    await pullToRefresh(T0 + MINUTE);
    await appState("background", T0 + MINUTE);
    await appState("active", T0 + 21 * MINUTE);

    expect(await request()).toBe(true);

    await appState("background", T0 + 21 * MINUTE);
    await appState("active", T0 + 52 * MINUTE);

    expect(await request()).toBe(false);
    expect(identity.endedFor).toBe("inactive");
  });

  test("no idle timeout: hours away, and still signed in", async () => {
    await signIn(lengthsOf({}));
    await appState("background", T0);
    await appState("active", T0 + 9 * HOUR);

    expect(await request()).toBe(true);
    expect(await isSignedIn()).toBe(true);
  });

  test("no lengths at all (the Community Edition): the same", async () => {
    await signIn(null);
    await appState("background", T0);
    await kill();
    await launch(T0 + 3 * DAY);

    expect(await request()).toBe(true);
  });

  test("a session length beside the idle timeout ends the session at its length, however much the app is used", async () => {
    await signIn(lengthsOf({ length: 60, idle: 15 }));

    for (let minute: number = 1; minute < 60; minute++) {
      expect(await pullToRefresh(T0 + minute * MINUTE)).toBe(true);
    }

    expect(await pullToRefresh(T0 + 60 * MINUTE)).toBe(false);
    expect(identity.endedFor).toBe("length-reached");
  });
});

describe("what the renewals said", () => {
  test("an app in use says it was used moments ago; one brought back says how long it was away", async () => {
    await signIn(lengthsOf({ idle: 30 }));
    await pullToRefresh(T0 + 14 * MINUTE);

    expect(identity.renewals[0]).toEqual({
      refreshToken: "refresh-at-sign-in",
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
      [REPORTS_ACTIVITY_WHILE_IN_USE_FIELD]: true,
    });

    await appState("background", T0 + 14 * MINUTE);
    await appState("active", T0 + 34 * MINUTE);

    expect(identity.renewals[1]).toEqual({
      refreshToken: "refresh-1",
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
      [LONGEST_INACTIVITY_FIELD]: { forSeconds: 20 * 60, endedSecondsAgo: 0 },
      [REPORTS_ACTIVITY_WHILE_IN_USE_FIELD]: true,
    });
  });

  test("the same renewal decided as an app that says nothing ends the session (why the app says it)", () => {
    const outcome: SessionRenewalOutcome = decideSessionRenewal({
      facts: {
        signedInAt: new Date(T0 - HOUR),
        lastActiveAt: new Date(T0),
        isSsoSignIn: false,
      },
      lengths: lengthsOf({ idle: 15 }),
      report: NO_RENEWAL_REPORT,
      // Ten seconds after the token signed at T0 ran out, the app in use all along.
      now: new Date(T0 + 15 * MINUTE + 10 * SECOND),
    });

    expect(outcome.hasEnded).toBe(true);

    const reported: SessionRenewalOutcome = decideSessionRenewal({
      facts: {
        signedInAt: new Date(T0 - HOUR),
        lastActiveAt: new Date(T0),
        isSsoSignIn: false,
      },
      lengths: lengthsOf({ idle: 15 }),
      report: { inactiveForInSeconds: 10, longestInactivity: null },
      now: new Date(T0 + 15 * MINUTE + 10 * SECOND),
    });

    expect(reported).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(T0 + 15 * MINUTE),
    });
  });
});

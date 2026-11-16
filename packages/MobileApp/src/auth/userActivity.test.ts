import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { clearTokens, storeTokens } from "../storage/keychain";
import { sessionAccessToken } from "../__tests__/sessionTokens";
import {
  ACTIVITY_REPORT_INTERVAL_MS,
  ACTIVITY_WRITE_INTERVAL_MS,
  countTypingAsActivity,
  flushUserActivityWrites,
  forgetInactivityReportedBy,
  getRenewalReport,
  getReportedActivityAtMs,
  INACTIVE_FOR_IN_SECONDS_FIELD,
  isActivityReportDue,
  LONGEST_INACTIVITY_FIELD,
  MAX_REPORTED_INACTIVITY_IN_SECONDS,
  MIN_KEPT_INACTIVITY_MS,
  noteActivityReported,
  onUserActivity,
  recordUserActivity,
  type RenewalReport,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
  resetUserActivityForTests,
  startUserActivityTracking,
  USER_ACTIVITY_STORAGE_KEY,
} from "./userActivity";
import {
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
  INACTIVE_FOR_IN_SECONDS_FIELD as SERVER_INACTIVE_FOR_IN_SECONDS_FIELD,
  LONGEST_INACTIVITY_FIELD as SERVER_LONGEST_INACTIVITY_FIELD,
  MAX_REPORTED_INACTIVITY_IN_SECONDS as SERVER_MAX_REPORTED_INACTIVITY_IN_SECONDS,
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD as SERVER_REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
} from "../../../Common/Types/UserSession/SessionLength";

/*
 * WHAT THE APP TELLS THE SERVER OF ITS PERSON'S USE OF IT (issue #8187).
 *
 * The server's idle timeout is decided at each renewal of the session from
 * what the renewal says: how long since the person last used the app
 * (inactiveForInSeconds), and the longest time they went without since the
 * last renewal (longestInactivity) - the app in the background, or closed.
 * A renewal that says nothing is decided from the last renewal alone, which
 * under the 15-minute idle timeout signed the app out at every renewal
 * however much it was used.
 *
 * This file drives the tracker the way a handset does: touches, the app
 * leaving the screen and coming back (AppState), the process ended and the
 * app opened again (the in-memory state dropped, storage kept), sign-outs
 * and sign-ins - and reads what a renewal would say at each point. The
 * clock is the test's: Date.now is pinned, and every time below is an
 * offset from T0.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const T0: number = Date.parse("2026-11-15T09:00:00.000Z");

const SESSION_A: string = "6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a";
const SESSION_B: string = "7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b";

let nowMs: number = T0;

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

let subscriptions: number = 0;

let removals: number = 0;

const mutableAppState: { currentState: unknown } = AppState as unknown as {
  currentState: unknown;
};

// The person signs in: a session whose access token says what the server knew.
async function signIn(
  sessionId: string,
  claims: { lastActiveAtMs?: number; signedInAtMs?: number } = {},
): Promise<void> {
  await storeTokens({
    accessToken: sessionAccessToken({
      sessionId,
      signedInAtMs: claims.signedInAtMs ?? nowMs,
      lastActiveAtMs: claims.lastActiveAtMs ?? nowMs,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 15 * MINUTE,
    }),
    refreshToken: `refresh-of-${sessionId}`,
    refreshTokenExpiresAt: new Date(nowMs + 30 * DAY).toISOString(),
  });
}

// Lets every promise already started settle: AsyncStorage's fake answers in microtasks.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

// The app starts at `atMs`, on the screen or (a push handled while it was closed) in the background.
async function launch(
  atMs: number,
  state: AppStateStatus = "active",
): Promise<void> {
  nowMs = atMs;
  mutableAppState.currentState = state;
  startUserActivityTracking();
  await settle();
}

// The app's process ends: what it held in memory is gone, storage stays.
async function kill(): Promise<void> {
  await flushUserActivityWrites();
  resetUserActivityForTests();
}

async function changeAppState(
  state: AppStateStatus,
  atMs: number,
): Promise<void> {
  nowMs = atMs;
  mutableAppState.currentState = state;
  expect(appStateHandler).not.toBeNull();
  appStateHandler!(state);
  await settle();
}

async function touch(atMs: number): Promise<void> {
  nowMs = atMs;
  recordUserActivity(atMs);
  await settle();
}

async function reportAt(atMs: number): Promise<RenewalReport> {
  nowMs = atMs;
  return await getRenewalReport(atMs);
}

/*
 * The setup file's AsyncStorage fake: its methods are jest.fn()s with an
 * implementation behind a Map, so a test that wants storage to fail swaps
 * one implementation for the length of the test and puts it back - a spy's
 * mockImplementation would outlive the test (restoreAllMocks does not
 * restore a jest.fn()).
 */
const storageFake: {
  getItem: jest.Mock;
  setItem: jest.Mock;
  __store: Map<string, string>;
} = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  __store: Map<string, string>;
};

async function withStorage(
  method: "getItem" | "setItem",
  implementation: (...args: Array<never>) => Promise<unknown>,
  run: () => Promise<void>,
): Promise<void> {
  const original: ((...args: Array<never>) => unknown) | undefined =
    storageFake[method].getMockImplementation();

  storageFake[method].mockImplementation(implementation);

  try {
    await run();
  } finally {
    storageFake[method].mockImplementation(original!);
  }
}

async function storedRecord(): Promise<Record<string, unknown> | null> {
  await flushUserActivityWrites();
  const value: string | null = await AsyncStorage.getItem(
    USER_ACTIVITY_STORAGE_KEY,
  );

  return value ? (JSON.parse(value) as Record<string, unknown>) : null;
}

beforeEach(async () => {
  resetUserActivityForTests();
  await AsyncStorage.clear();
  await clearTokens();

  nowMs = T0;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowMs;
  });

  appStateHandler = null;
  subscriptions = 0;
  removals = 0;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(
      (_type: string, handler: (state: AppStateStatus) => void) => {
        subscriptions++;
        appStateHandler = handler;
        return {
          remove: (): void => {
            removals++;
          },
        } as never;
      },
    );
  mutableAppState.currentState = "active";
});

afterEach(async () => {
  await flushUserActivityWrites();
  resetUserActivityForTests();
  jest.restoreAllMocks();
});

describe("how long since the person last used the app", () => {
  test("a touch a moment ago: the renewal says how long, in whole seconds, and nothing more", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + MINUTE);

    expect(await reportAt(T0 + MINUTE + 10.9 * SECOND)).toEqual({
      inactiveForInSeconds: 10,
    });
  });

  test("the app opened is activity: a renewal right after says no time at all", async () => {
    await signIn(SESSION_A);
    await launch(T0);

    expect(await reportAt(T0)).toEqual({ inactiveForInSeconds: 0 });
  });

  test("a clock that moved back is no time without use", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + MINUTE);

    expect(await reportAt(T0 + MINUTE - 5 * SECOND)).toEqual({
      inactiveForInSeconds: 0,
    });
  });

  test("never more than the server reads", async () => {
    await signIn(SESSION_A);
    await launch(T0);

    expect(await reportAt(T0 + 90 * DAY)).toEqual({
      inactiveForInSeconds: MAX_REPORTED_INACTIVITY_IN_SECONDS,
    });
  });

  test("an app that knows of no activity at all says all there is, so the server counts from what it knew", async () => {
    // A token from a server that says neither time, and a launch in the background.
    await storeTokens({
      accessToken: sessionAccessToken({
        sessionId: SESSION_A,
        issuedAtMs: T0,
        expiresAtMs: T0 + 15 * MINUTE,
      }),
      refreshToken: "refresh",
      refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
    });
    await launch(T0, "background");

    expect(await reportAt(T0 + MINUTE)).toEqual({
      inactiveForInSeconds: MAX_REPORTED_INACTIVITY_IN_SECONDS,
    });
  });
});

describe("a time without use the app ends", () => {
  test.each([
    ["a second short of the shortest idle timeout is not kept", -SECOND, null],
    [
      "the shortest idle timeout exactly is kept",
      0,
      { forSeconds: 15 * 60, endedSecondsAgo: 0 },
    ],
    [
      "a second past it is kept",
      SECOND,
      { forSeconds: 15 * 60 + 1, endedSecondsAgo: 0 },
    ],
  ])(
    "the app in the background, then back: %s",
    async (_label: string, beyondMs: number, longest: unknown) => {
      await signIn(SESSION_A);
      await launch(T0);
      await changeAppState("background", T0);

      const backAt: number = T0 + MIN_KEPT_INACTIVITY_MS + beyondMs;
      await changeAppState("active", backAt);

      const expected: RenewalReport = { inactiveForInSeconds: 0 };

      if (longest) {
        expected.longestInactivity = longest as {
          forSeconds: number;
          endedSecondsAgo: number;
        };
      }

      expect(await reportAt(backAt)).toEqual(expected);
    },
  );

  test("a touch after a long time untouched on the screen ends one too", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + 40 * MINUTE);

    expect(await reportAt(T0 + 40 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 40 * 60, endedSecondsAgo: 0 },
    });
  });

  test("it says how long ago the time ended, however much the app was used since", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + MINUTE);
    await changeAppState("background", T0 + MINUTE);
    await changeAppState("active", T0 + 21 * MINUTE);
    await touch(T0 + 22 * MINUTE);
    await touch(T0 + 23 * MINUTE);

    expect(await reportAt(T0 + 23 * MINUTE + 5 * SECOND)).toEqual({
      inactiveForInSeconds: 5,
      longestInactivity: { forSeconds: 20 * 60, endedSecondsAgo: 2 * 60 + 5 },
    });
  });

  test("the longest of several is kept, and a shorter one after it does not replace it", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + 30 * MINUTE);
    await touch(T0 + 31 * MINUTE);
    await changeAppState("background", T0 + 31 * MINUTE);
    await changeAppState("active", T0 + 51 * MINUTE);

    expect(await reportAt(T0 + 51 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 30 * 60, endedSecondsAgo: 21 * 60 },
    });

    // A longer one after it does.
    await touch(T0 + 52 * MINUTE);
    await changeAppState("background", T0 + 52 * MINUTE);
    await changeAppState("active", T0 + 92 * MINUTE);

    expect(await reportAt(T0 + 92 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 40 * 60, endedSecondsAgo: 0 },
    });
  });

  test("one that ended longer ago than the server reads is not reported: no session it could end is still there", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + HOUR);

    const tooLate: number =
      T0 + HOUR + (MAX_REPORTED_INACTIVITY_IN_SECONDS + 1) * SECOND;

    expect(await reportAt(tooLate)).toEqual({
      inactiveForInSeconds: MAX_REPORTED_INACTIVITY_IN_SECONDS,
    });
  });

  test("one longer than the server reads is said as the most it reads", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + 70 * DAY);

    expect(await reportAt(T0 + 70 * DAY)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: {
        forSeconds: MAX_REPORTED_INACTIVITY_IN_SECONDS,
        endedSecondsAgo: 0,
      },
    });
  });
});

describe("leaving the screen and coming back", () => {
  test("coming back to the screen is activity", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0 + MINUTE);
    await changeAppState("active", T0 + 5 * MINUTE);

    expect(await reportAt(T0 + 5 * MINUTE + 3 * SECOND)).toEqual({
      inactiveForInSeconds: 3,
    });
  });

  test("leaving it is not: the time without use counts from the last thing the person did", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + MINUTE);
    await changeAppState("background", T0 + 2 * MINUTE);

    expect(await reportAt(T0 + 10 * MINUTE)).toEqual({
      inactiveForInSeconds: 9 * 60,
    });
  });

  test("while in use, the newest activity is written down at most every 15 seconds", async () => {
    await signIn(SESSION_A);
    await launch(T0);

    expect((await storedRecord())?.["lastActivityAtMs"]).toBe(T0);

    await touch(T0 + 5 * SECOND);
    await touch(T0 + ACTIVITY_WRITE_INTERVAL_MS - SECOND);

    expect((await storedRecord())?.["lastActivityAtMs"]).toBe(T0);

    await touch(T0 + ACTIVITY_WRITE_INTERVAL_MS);

    expect((await storedRecord())?.["lastActivityAtMs"]).toBe(
      T0 + ACTIVITY_WRITE_INTERVAL_MS,
    );
  });

  test.each([["background"], ["inactive"]])(
    "going to %s writes the newest activity down at once, however recently it was written",
    async (state: string) => {
      await signIn(SESSION_A);
      await launch(T0);
      await touch(T0 + 5 * SECOND);

      expect((await storedRecord())?.["lastActivityAtMs"]).toBe(T0);

      await changeAppState(state as AppStateStatus, T0 + 6 * SECOND);

      expect((await storedRecord())?.["lastActivityAtMs"]).toBe(
        T0 + 5 * SECOND,
      );
    },
  );
});

describe("the app ended and opened again", () => {
  test.each([
    ["a second short of 15 minutes later is no time kept", -SECOND, null],
    [
      "15 minutes later exactly is",
      0,
      { forSeconds: 15 * 60, endedSecondsAgo: 0 },
    ],
    [
      "a second past is",
      SECOND,
      { forSeconds: 15 * 60 + 1, endedSecondsAgo: 0 },
    ],
  ])(
    "put away, ended by the system, and opened %s",
    async (_label: string, beyondMs: number, longest: unknown) => {
      await signIn(SESSION_A);
      await launch(T0);
      await touch(T0 + 4 * MINUTE + 50 * SECOND);
      await touch(T0 + 5 * MINUTE);
      await changeAppState("background", T0 + 5 * MINUTE + 2 * SECOND);
      await kill();

      const openedAt: number = T0 + 5 * MINUTE + 15 * MINUTE + beyondMs;
      await launch(openedAt);

      const expected: RenewalReport = { inactiveForInSeconds: 0 };

      if (longest) {
        expected.longestInactivity = longest as {
          forSeconds: number;
          endedSecondsAgo: number;
        };
      }

      expect(await reportAt(openedAt)).toEqual(expected);
    },
  );

  test("ended without leaving the screen (a crash): counted from the last write, at most 15 seconds before the last touch", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await touch(T0 + 5 * MINUTE);
    // Within the write interval of the last write: not written.
    await touch(T0 + 5 * MINUTE + 10 * SECOND);
    await kill();

    await launch(T0 + 5 * MINUTE + 10 * SECOND + 14 * MINUTE + 55 * SECOND);

    expect(
      await reportAt(T0 + 5 * MINUTE + 10 * SECOND + 14 * MINUTE + 55 * SECOND),
    ).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 15 * 60 + 5, endedSecondsAgo: 0 },
    });
  });

  test("opened in the background - a push handled while it was closed - is no activity: the time without use goes on", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await kill();

    await launch(T0 + 20 * MINUTE, "background");

    expect(await reportAt(T0 + 20 * MINUTE)).toEqual({
      inactiveForInSeconds: 20 * 60,
    });

    // The person opens it a minute later: that ends it.
    await changeAppState("active", T0 + 21 * MINUTE);

    expect(await reportAt(T0 + 21 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 21 * 60, endedSecondsAgo: 0 },
    });
  });

  test("a time kept and not yet reported is still reported after the app ends", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + HOUR);
    await changeAppState("background", T0 + HOUR + 10 * SECOND);
    await kill();

    await launch(T0 + HOUR + MINUTE);

    expect(await reportAt(T0 + HOUR + MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 60 * 60, endedSecondsAgo: 60 },
    });
  });

  test("one a renewal reported is not reported again after the app ends", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + HOUR);
    await reportAt(T0 + HOUR);
    forgetInactivityReportedBy(T0 + HOUR);
    await kill();

    await launch(T0 + HOUR + MINUTE);

    expect(await reportAt(T0 + HOUR + MINUTE)).toEqual({
      inactiveForInSeconds: 0,
    });
  });

  test("activity before the record is read is not lost: the first ends the time without use, the last is the newest", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await kill();

    // Touches that land before the launch has read what the last one kept.
    nowMs = T0 + 20 * MINUTE;
    recordUserActivity(T0 + 20 * MINUTE);
    recordUserActivity(T0 + 20 * MINUTE + 2 * SECOND);
    await settle();

    expect(await reportAt(T0 + 20 * MINUTE + 3 * SECOND)).toEqual({
      inactiveForInSeconds: 1,
      longestInactivity: { forSeconds: 20 * 60, endedSecondsAgo: 3 },
    });
  });
});

describe("the first launch with nothing kept (an app updated to one that keeps it)", () => {
  test.each([
    ["ten minutes after", 10 * MINUTE, null],
    [
      "twenty minutes after",
      20 * MINUTE,
      { forSeconds: 20 * 60, endedSecondsAgo: 0 },
    ],
  ])(
    "opened %s the session's last activity, as its access token says the server knew it",
    async (_label: string, afterMs: number, longest: unknown) => {
      await signIn(SESSION_A, { lastActiveAtMs: T0, signedInAtMs: T0 - DAY });
      await launch(T0 + afterMs);

      const expected: RenewalReport = { inactiveForInSeconds: 0 };

      if (longest) {
        expected.longestInactivity = longest as {
          forSeconds: number;
          endedSecondsAgo: number;
        };
      }

      expect(await reportAt(T0 + afterMs)).toEqual(expected);
    },
  );

  test("a token that does not say the last activity counts from the sign-in", async () => {
    await storeTokens({
      accessToken: sessionAccessToken({
        sessionId: SESSION_A,
        signedInAtMs: T0,
        issuedAtMs: T0,
        expiresAtMs: T0 + 15 * MINUTE,
      }),
      refreshToken: "refresh",
      refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
    });
    await launch(T0 + 45 * MINUTE);

    expect(await reportAt(T0 + 45 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 45 * 60, endedSecondsAgo: 0 },
    });
  });

  test("storage that cannot be read is nothing kept", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });

    await withStorage(
      "getItem",
      async (key: string): Promise<string | null> => {
        if (key === USER_ACTIVITY_STORAGE_KEY) {
          throw new Error("storage refused");
        }
        return storageFake.__store.get(key) ?? null;
      },
      async (): Promise<void> => {
        await launch(T0 + 30 * MINUTE);

        expect(await reportAt(T0 + 30 * MINUTE)).toEqual({
          inactiveForInSeconds: 0,
          longestInactivity: { forSeconds: 30 * 60, endedSecondsAgo: 0 },
        });
      },
    );
  });

  test.each([
    ["not JSON", "{not json"],
    ["not an object", JSON.stringify([1, 2, 3])],
    ["no last activity", JSON.stringify({ longestInactivity: null })],
    [
      "a last activity that is not a time",
      JSON.stringify({ lastActivityAtMs: "yesterday" }),
    ],
    ["a negative time", JSON.stringify({ lastActivityAtMs: -5 })],
  ])(
    "what storage holds that this module did not write (%s) is nothing kept",
    async (_label: string, value: string) => {
      await signIn(SESSION_A, { lastActiveAtMs: T0 });
      await AsyncStorage.setItem(USER_ACTIVITY_STORAGE_KEY, value);
      await launch(T0 + 30 * MINUTE);

      expect(await reportAt(T0 + 30 * MINUTE)).toEqual({
        inactiveForInSeconds: 0,
        longestInactivity: { forSeconds: 30 * 60, endedSecondsAgo: 0 },
      });
    },
  );

  test.each([
    ["an end before its start", { fromMs: T0, toMs: T0 - 1, sessionKey: "" }],
    ["no session", { fromMs: T0 - HOUR, toMs: T0 }],
    ["times that are not numbers", { fromMs: "a", toMs: "b", sessionKey: "" }],
  ])(
    "a kept time that could not have been written (%s) is none",
    async (_label: string, kept: unknown) => {
      await signIn(SESSION_A);
      await AsyncStorage.setItem(
        USER_ACTIVITY_STORAGE_KEY,
        JSON.stringify({ lastActivityAtMs: T0, longestInactivity: kept }),
      );
      await launch(T0 + MINUTE);

      expect(await reportAt(T0 + MINUTE)).toEqual({ inactiveForInSeconds: 0 });
    },
  );
});

describe("one session's time without use is never another's", () => {
  test("a time kept before a sign-out is not reported for the next sign-in", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + 2 * HOUR);

    // The renewal that would have said it never went through: signed out.
    await clearTokens();
    await touch(T0 + 2 * HOUR + MINUTE);
    nowMs = T0 + 2 * HOUR + 2 * MINUTE;
    await signIn(SESSION_B);

    expect(await reportAt(T0 + 2 * HOUR + 3 * MINUTE)).toEqual({
      inactiveForInSeconds: 2 * 60,
    });
  });

  test("nor does it hide the next session's own, though it was longer", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + 2 * HOUR);

    await clearTokens();
    nowMs = T0 + 2 * HOUR + MINUTE;
    await signIn(SESSION_B);
    await touch(T0 + 2 * HOUR + 2 * MINUTE);
    await changeAppState("background", T0 + 2 * HOUR + 2 * MINUTE);
    await changeAppState("active", T0 + 2 * HOUR + 22 * MINUTE);

    expect(await reportAt(T0 + 2 * HOUR + 22 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 20 * 60, endedSecondsAgo: 0 },
    });
  });

  test("with nobody signed in, nothing is kept: there is no session for it to end", async () => {
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + 3 * HOUR);

    nowMs = T0 + 3 * HOUR + MINUTE;
    await signIn(SESSION_A);

    expect(await reportAt(T0 + 3 * HOUR + MINUTE)).toEqual({
      inactiveForInSeconds: 60,
    });
  });
});

describe("after a renewal", () => {
  test("what it reported is forgotten, and the next renewal says only what came after", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);
    await changeAppState("active", T0 + HOUR);

    const reportedAt: number = T0 + HOUR + SECOND;
    expect((await reportAt(reportedAt)).longestInactivity).toBeDefined();

    forgetInactivityReportedBy(reportedAt);

    expect(await reportAt(T0 + HOUR + 2 * SECOND)).toEqual({
      inactiveForInSeconds: 2,
    });
    expect((await storedRecord())?.["longestInactivity"]).toBeNull();
  });

  test("one that ended after the report was read - while the renewal was on its way - is kept for the next", async () => {
    await signIn(SESSION_A);
    await launch(T0);
    await changeAppState("background", T0);

    const reportedAt: number = T0 + 10 * MINUTE;
    await reportAt(reportedAt);

    await changeAppState("active", T0 + 40 * MINUTE);
    forgetInactivityReportedBy(reportedAt);

    expect(await reportAt(T0 + 40 * MINUTE)).toEqual({
      inactiveForInSeconds: 0,
      longestInactivity: { forSeconds: 40 * 60, endedSecondsAgo: 0 },
    });
  });
});

describe("storage refusing to keep anything", () => {
  test("what the app saw itself still counts while it runs", async () => {
    await signIn(SESSION_A);

    await withStorage(
      "setItem",
      async (): Promise<void> => {
        throw new Error("disk full");
      },
      async (): Promise<void> => {
        await launch(T0);
        await changeAppState("background", T0);
        await changeAppState("active", T0 + HOUR);

        expect(await reportAt(T0 + HOUR)).toEqual({
          inactiveForInSeconds: 0,
          longestInactivity: { forSeconds: 60 * 60, endedSecondsAgo: 0 },
        });
      },
    );
  });
});

describe("listeners", () => {
  test("each activity is announced with its time, once what was kept is read", async () => {
    await signIn(SESSION_A);

    const heard: Array<number> = [];
    const stop: () => void = onUserActivity((atMs: number): void => {
      heard.push(atMs);
    });

    try {
      await launch(T0);
      await touch(T0 + SECOND);
      await changeAppState("background", T0 + 2 * SECOND);
      await changeAppState("active", T0 + 3 * SECOND);

      expect(heard).toEqual([T0, T0 + SECOND, T0 + 3 * SECOND]);

      stop();
      await touch(T0 + 4 * SECOND);

      expect(heard).toHaveLength(3);
    } finally {
      stop();
    }
  });

  test("a listener that throws stops neither the activity counting nor the next listener", async () => {
    await signIn(SESSION_A);

    const heard: Array<number> = [];
    const stopThrowing: () => void = onUserActivity((): void => {
      throw new Error("a listener's own failure");
    });
    const stopHearing: () => void = onUserActivity((atMs: number): void => {
      heard.push(atMs);
    });

    try {
      await launch(T0);
      await touch(T0 + 40 * MINUTE);

      expect(heard).toEqual([T0, T0 + 40 * MINUTE]);
      expect(await reportAt(T0 + 40 * MINUTE)).toEqual({
        inactiveForInSeconds: 0,
        longestInactivity: { forSeconds: 40 * 60, endedSecondsAgo: 0 },
      });
    } finally {
      stopThrowing();
      stopHearing();
    }
  });
});

describe("typing", () => {
  test("text typed counts as use, and reaches the field's own handler", async () => {
    await signIn(SESSION_A);
    await launch(T0);

    const typed: Array<string> = [];
    const onChangeText: (text: string) => void = countTypingAsActivity(
      (text: string): void => {
        typed.push(text);
      },
    );

    nowMs = T0 + 40 * MINUTE;
    onChangeText("Rolled back the deploy");
    await settle();

    expect(typed).toEqual(["Rolled back the deploy"]);
    expect(await reportAt(T0 + 40 * MINUTE + SECOND)).toEqual({
      inactiveForInSeconds: 1,
      longestInactivity: { forSeconds: 40 * 60, endedSecondsAgo: 1 },
    });
  });
});

describe("starting", () => {
  test("listens to the app's state once, however often it is started, and stops when told", async () => {
    const stop: () => void = startUserActivityTracking();
    startUserActivityTracking();

    expect(subscriptions).toBe(1);

    stop();

    expect(removals).toBe(1);

    startUserActivityTracking();

    expect(subscriptions).toBe(2);
  });

  test("started off the screen, the start is no activity", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });
    await launch(T0 + 5 * MINUTE, "background");

    expect(await reportAt(T0 + 5 * MINUTE)).toEqual({
      inactiveForInSeconds: 5 * 60,
    });
  });
});

/*
 * THE ACTIVITY THE SERVER HAS HEARD OF (issue #8458).
 *
 * Every renewal promises the server that, while the app is in use, a
 * renewal tells it of its person at least every ACTIVITY_REPORT_INTERVAL_MS,
 * which lets its sweep record an idle timeout within minutes. The client
 * renews when a report is due (isActivityReportDue), counting from the
 * activity the last renewal told the server of (noteActivityReported), or -
 * none yet this launch - from what the access token says the server knew.
 */
describe("when a report of the person's activity is due", () => {
  test("the server's own words: the field, the interval and the other fields and bounds", () => {
    expect(REPORTS_ACTIVITY_WHILE_IN_USE_FIELD).toBe(
      SERVER_REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
    );
    expect(ACTIVITY_REPORT_INTERVAL_MS).toBe(
      ACTIVITY_REPORTED_WITHIN_IN_MINUTES * MINUTE,
    );
    expect(INACTIVE_FOR_IN_SECONDS_FIELD).toBe(
      SERVER_INACTIVE_FOR_IN_SECONDS_FIELD,
    );
    expect(LONGEST_INACTIVITY_FIELD).toBe(SERVER_LONGEST_INACTIVITY_FIELD);
    expect(MIN_KEPT_INACTIVITY_MS).toBe(
      MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES * MINUTE,
    );
    expect(MAX_REPORTED_INACTIVITY_IN_SECONDS).toBe(
      SERVER_MAX_REPORTED_INACTIVITY_IN_SECONDS,
    );
  });

  test("nobody signed in: never due, and nothing heard of", async () => {
    expect(isActivityReportDue(T0 + HOUR)).toBe(false);
    expect(getReportedActivityAtMs()).toBeNull();

    noteActivityReported(T0);

    expect(getReportedActivityAtMs()).toBeNull();
  });

  test("just signed in: counted from the activity the access token says the server knew", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });

    expect(getReportedActivityAtMs()).toBe(T0);
    expect(isActivityReportDue(T0 + ACTIVITY_REPORT_INTERVAL_MS - 1)).toBe(
      false,
    );
    expect(isActivityReportDue(T0 + ACTIVITY_REPORT_INTERVAL_MS)).toBe(true);
  });

  test("a token without lastActiveAt counts from its sign-in", async () => {
    await storeTokens({
      accessToken: sessionAccessToken({
        sessionId: SESSION_A,
        signedInAtMs: T0 - MINUTE,
        issuedAtMs: T0,
        expiresAtMs: T0 + 15 * MINUTE,
      }),
      refreshToken: "refresh",
      refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
    });

    expect(getReportedActivityAtMs()).toBe(T0 - MINUTE);
  });

  test("a token that says nothing: due at once", async () => {
    await storeTokens({
      accessToken: "not-a-jwt",
      refreshToken: "refresh",
      refreshTokenExpiresAt: new Date(T0 + 30 * DAY).toISOString(),
    });

    expect(getReportedActivityAtMs()).toBeNull();
    expect(isActivityReportDue(T0)).toBe(true);
  });

  test("after a renewal, counted from the activity it told the server of", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });

    noteActivityReported(T0 + 3 * MINUTE);

    expect(getReportedActivityAtMs()).toBe(T0 + 3 * MINUTE);
    expect(
      isActivityReportDue(T0 + 3 * MINUTE + ACTIVITY_REPORT_INTERVAL_MS - 1),
    ).toBe(false);
    expect(
      isActivityReportDue(T0 + 3 * MINUTE + ACTIVITY_REPORT_INTERVAL_MS),
    ).toBe(true);
  });

  test("what the phone noted wins over the token's claim, which is on the server's clock", async () => {
    // The server's clock four minutes ahead: its claim is in the phone's future.
    await signIn(SESSION_A, { lastActiveAtMs: T0 + 4 * MINUTE });

    expect(isActivityReportDue(T0)).toBe(true);

    noteActivityReported(T0);

    expect(isActivityReportDue(T0 + MINUTE)).toBe(false);
  });

  test("a clock that moved back: due at once, and the next renewal's word replaces the one noted", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });
    noteActivityReported(T0 + 10 * MINUTE);

    expect(isActivityReportDue(T0 + 3 * MINUTE)).toBe(true);

    noteActivityReported(T0 + 3 * MINUTE);

    expect(getReportedActivityAtMs()).toBe(T0 + 3 * MINUTE);
    expect(isActivityReportDue(T0 + 4 * MINUTE)).toBe(false);
  });

  test("what one session's renewals told the server is never another's", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });
    noteActivityReported(T0 + 20 * MINUTE);

    await clearTokens();
    nowMs = T0 + 21 * MINUTE;
    await signIn(SESSION_B, { lastActiveAtMs: T0 + 21 * MINUTE - HOUR });

    // Session B's own claim, an hour old: due, whatever session A's renewals said.
    expect(getReportedActivityAtMs()).toBe(T0 + 21 * MINUTE - HOUR);
    expect(isActivityReportDue(T0 + 21 * MINUTE)).toBe(true);
  });

  test("forgotten when the process ends: the token's claim counts again", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });
    noteActivityReported(T0 + 4 * MINUTE);

    await kill();

    expect(getReportedActivityAtMs()).toBe(T0);
  });

  test("an activity that is no time is not noted", async () => {
    await signIn(SESSION_A, { lastActiveAtMs: T0 });

    for (const value of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      noteActivityReported(value);
    }

    expect(getReportedActivityAtMs()).toBe(T0);
  });
});

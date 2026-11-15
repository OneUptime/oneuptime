import UserActivity, {
  ACTIVITY_EVENTS,
  ACTIVITY_WRITE_INTERVAL_IN_MS,
  LAST_ACTIVITY_STORAGE_KEY,
  LONGEST_INACTIVITY_STORAGE_KEY,
  MIN_KEPT_INACTIVITY_IN_MS,
  PAGE_HIDE_EVENTS,
} from "../../../UI/Utils/UserActivity";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import {
  MAX_REPORTED_INACTIVITY_IN_SECONDS,
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
} from "../../../Types/UserSession/SessionLength";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHEN THE PERSON LAST USED ONEUPTIME IN THIS BROWSER (UI/Utils/UserActivity).
 *
 * A master admin's idle timeout is counted by the server from what each
 * renewal of the session says: how long since the person last clicked,
 * typed, scrolled, touched, moved the pointer or brought a tab back. Only a
 * page that notices activity says it, every tab of the browser shares it
 * (local storage), one tab never moves another's newer activity back, and
 * nothing it cannot read stops it from saying what this tab saw.
 */

const START_MS: number = 1_800_000_000_000;

let nowMs: number = START_MS;

const storedActivity: () => string | null = (): string | null => {
  return localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
};

const setVisibility: (state: "visible" | "hidden") => void = (
  state: "visible" | "hidden",
): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): string => {
      return state;
    },
  });
};

beforeEach(() => {
  localStorage.clear();
  UserActivity.resetForTests();
  nowMs = START_MS;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowMs;
  });
});

afterEach(() => {
  UserActivity.resetForTests();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("a page that does not notice activity", () => {
  test("says nothing: the server counts from the session's last renewal", () => {
    expect(UserActivity.isTracking()).toBe(false);
    expect(UserActivity.getInactiveForInSeconds()).toBeNull();
  });

  test("says nothing even when another tab wrote its activity", () => {
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(START_MS - 5000));

    expect(UserActivity.getInactiveForInSeconds()).toBeNull();
  });
});

describe("install: the Dashboard and the Admin Dashboard notice activity", () => {
  test("opening the page is activity, written down for every tab", () => {
    UserActivity.install();

    expect(UserActivity.isTracking()).toBe(true);
    expect(UserActivity.getInactiveForInSeconds()).toBe(0);
    expect(storedActivity()).toBe(String(START_MS));
  });

  test("the time since then, in whole seconds", () => {
    UserActivity.install();

    nowMs = START_MS + 10 * 60 * 1000 + 999;

    expect(UserActivity.getInactiveForInSeconds()).toBe(600);
  });

  test.each(
    ACTIVITY_EVENTS.map((eventName: string): [string] => {
      return [eventName];
    }),
  )("%s counts as using the page", (eventName: string) => {
    UserActivity.install();

    nowMs = START_MS + 5 * 60 * 1000;
    window.dispatchEvent(new Event(eventName));
    nowMs += 30 * 1000;

    expect(UserActivity.getInactiveForInSeconds()).toBe(30);
  });

  test("bringing a tab back into view counts; a tab going out of view does not", () => {
    UserActivity.install();

    nowMs = START_MS + 60 * 1000;
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(UserActivity.getInactiveForInSeconds()).toBe(60);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(UserActivity.getInactiveForInSeconds()).toBe(0);
  });

  test("installing again is harmless: one listener for each event, and one for the page closing", () => {
    const added: jest.SpiedFunction<typeof window.addEventListener> =
      jest.spyOn(window, "addEventListener");

    UserActivity.install();
    UserActivity.install();

    expect(added).toHaveBeenCalledTimes(
      ACTIVITY_EVENTS.length + PAGE_HIDE_EVENTS.length,
    );
    expect(
      added.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([...ACTIVITY_EVENTS, ...PAGE_HIDE_EVENTS]);
  });

  test("the listeners never get in the page's way: passive, and in the capture phase", () => {
    const added: jest.SpiedFunction<typeof window.addEventListener> =
      jest.spyOn(window, "addEventListener");

    UserActivity.install();

    for (const call of added.mock.calls) {
      expect(call[2]).toEqual({ capture: true, passive: true });
    }
  });

  test("after resetForTests nothing is noticed any more", () => {
    UserActivity.install();
    UserActivity.resetForTests();

    window.dispatchEvent(new Event("keydown"));

    expect(UserActivity.isTracking()).toBe(false);
    expect(UserActivity.getInactiveForInSeconds()).toBeNull();
  });
});

describe("every tab of the browser shares one time", () => {
  test("a renewal in a tab left open counts from the newest activity of any tab", () => {
    UserActivity.install();

    // Someone works in another tab, which writes its activity down.
    LocalStorage.setItem(
      LAST_ACTIVITY_STORAGE_KEY,
      String(START_MS + 20 * 60 * 1000),
    );

    nowMs = START_MS + 21 * 60 * 1000;

    expect(UserActivity.getInactiveForInSeconds()).toBe(60);
  });

  test("this tab's own newer activity counts when the others wrote older times", () => {
    LocalStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(START_MS - 60_000));

    UserActivity.install();
    nowMs = START_MS + 1000;

    expect(UserActivity.getInactiveForInSeconds()).toBe(1);
  });

  test("activity is written at most every interval, and again once it has passed", () => {
    UserActivity.install();

    nowMs = START_MS + ACTIVITY_WRITE_INTERVAL_IN_MS - 1;
    UserActivity.recordActivity();

    expect(storedActivity()).toBe(String(START_MS));

    nowMs = START_MS + ACTIVITY_WRITE_INTERVAL_IN_MS;
    UserActivity.recordActivity();

    expect(storedActivity()).toBe(String(nowMs));
  });

  test("a tab never moves another tab's newer activity back", () => {
    LocalStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(START_MS + 5000));

    UserActivity.install();

    expect(storedActivity()).toBe(String(START_MS + 5000));
  });

  test("storage that cannot be read or written leaves this tab's own activity", () => {
    jest.spyOn(LocalStorage, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError: storage is disabled");
    });
    jest.spyOn(LocalStorage, "setItem").mockImplementation((): never => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      UserActivity.install();
    }).not.toThrow();

    nowMs = START_MS + 90 * 1000;

    expect(UserActivity.getInactiveForInSeconds()).toBe(90);
  });

  test.each([["not a time"], ["-5"], ["0"], [""]])(
    "a stored value that is no time (%p) is none",
    (value: string) => {
      UserActivity.install();
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, value);
      nowMs = START_MS + 2000;

      expect(UserActivity.getInactiveForInSeconds()).toBe(2);
    },
  );
});

describe("what a renewal says is always something the server reads", () => {
  test("a clock that moved back is no inactivity", () => {
    UserActivity.install();

    nowMs = START_MS - 60 * 60 * 1000;

    expect(UserActivity.getInactiveForInSeconds()).toBe(0);
  });

  test("a tab left for months says the most the server reads, and no more", () => {
    UserActivity.install();

    nowMs = START_MS + 365 * 24 * 60 * 60 * 1000;

    expect(UserActivity.getInactiveForInSeconds()).toBe(
      MAX_REPORTED_INACTIVITY_IN_SECONDS,
    );
  });
});

/*
 * ISSUE #6789: THE LONGEST TIME WITHOUT USE SINCE THE LAST RENEWAL.
 *
 * Opening the page counts as activity, so a renewal right after a browser
 * stood closed - or a computer slept, or a tab nobody used was brought
 * back - says its person was here a moment ago. The activity that ends a
 * time without use in every tab measures it, and the longest since the
 * last renewal is kept for the next renewal to say.
 */
describe("the longest time without use since the last renewal", () => {
  const MINUTE: number = 60 * 1000;
  const HOUR: number = 60 * MINUTE;

  const storedInactivity: () => unknown = (): unknown => {
    const value: string | null = localStorage.getItem(
      LONGEST_INACTIVITY_STORAGE_KEY,
    );

    return value === null ? null : JSON.parse(value);
  };

  const lastUsedAt: (atMs: number) => void = (atMs: number): void => {
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(atMs));
  };

  test("the shortest kept is the shortest idle timeout: anything shorter ends no session", () => {
    expect(MIN_KEPT_INACTIVITY_IN_MS).toBe(
      MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES * MINUTE,
    );
  });

  test("the Dashboard opened again after the browser stood closed keeps how long it stood closed, for the next renewal", () => {
    lastUsedAt(START_MS - 2 * HOUR);

    UserActivity.install();

    // Opening the page is activity: the person is here now...
    expect(UserActivity.getInactiveForInSeconds()).toBe(0);
    // ...after two hours away, which the renewal says too.
    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: 0,
    });
    expect(storedInactivity()).toEqual({
      fromMs: START_MS - 2 * HOUR,
      toMs: START_MS,
    });

    nowMs = START_MS + 5000;

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: 5,
    });
  });

  test("the first page a browser opens keeps nothing: there was no time before it", () => {
    UserActivity.install();

    expect(UserActivity.getLongestInactivity()).toBeNull();
    expect(storedInactivity()).toBeNull();
  });

  test.each([
    [
      "a second shorter than the shortest idle timeout is not kept",
      -1000,
      null,
    ],
    [
      "the shortest idle timeout exactly is",
      0,
      {
        forSeconds: MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES * 60,
        endedSecondsAgo: 0,
      },
    ],
  ])(
    "a time without use %s",
    (_label: string, offsetMs: number, kept: unknown) => {
      lastUsedAt(START_MS - MIN_KEPT_INACTIVITY_IN_MS - offsetMs);

      UserActivity.install();

      expect(UserActivity.getLongestInactivity()).toEqual(kept);
    },
  );

  test("a tab left open: the first move after the computer slept ends the time without use", () => {
    UserActivity.install();

    nowMs = START_MS + 3 * HOUR;
    window.dispatchEvent(new Event("pointermove"));

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 3 * 60 * 60,
      endedSecondsAgo: 0,
    });
    expect(UserActivity.getInactiveForInSeconds()).toBe(0);
  });

  test("a tab brought back after every tab stood unused keeps it", () => {
    UserActivity.install();

    nowMs = START_MS + HOUR;
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 60 * 60,
      endedSecondsAgo: 0,
    });
  });

  test("a tab brought back while another tab was in use ends none: its person was never away", () => {
    UserActivity.install();

    // Someone works in another tab for two hours, which writes its activity down.
    lastUsedAt(START_MS + 2 * HOUR);

    nowMs = START_MS + 2 * HOUR + 10 * 1000;
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(UserActivity.getLongestInactivity()).toBeNull();
    expect(UserActivity.getInactiveForInSeconds()).toBe(0);
  });

  test("a tab in use never reads storage for it: only the first activity after a while asks", () => {
    UserActivity.install();

    const read: jest.SpiedFunction<typeof LocalStorage.getItem> = jest.spyOn(
      LocalStorage,
      "getItem",
    );

    // Five minutes of moving the pointer, every second.
    for (let second: number = 1; second <= 5 * 60; second++) {
      nowMs = START_MS + second * 1000;
      window.dispatchEvent(new Event("pointermove"));
    }

    expect(
      read.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[0] === LONGEST_INACTIVITY_STORAGE_KEY;
      }),
    ).toHaveLength(0);
    expect(UserActivity.getLongestInactivity()).toBeNull();
  });

  test("the longest is kept: a shorter one after it does not replace it, a longer one does", () => {
    UserActivity.install();

    nowMs = START_MS + 2 * HOUR;
    UserActivity.recordActivity();

    nowMs = START_MS + 2 * HOUR + 20 * MINUTE;
    UserActivity.recordActivity();

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: 20 * 60,
    });

    nowMs = START_MS + 5 * HOUR + 20 * MINUTE;
    UserActivity.recordActivity();

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 3 * 60 * 60,
      endedSecondsAgo: 0,
    });
  });

  test("every tab shares it: what one tab kept is what another tab's renewal says", () => {
    UserActivity.install();

    localStorage.setItem(
      LONGEST_INACTIVITY_STORAGE_KEY,
      JSON.stringify({ fromMs: START_MS - 3 * HOUR, toMs: START_MS - HOUR }),
    );

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: 60 * 60,
    });
  });

  test("a renewal that went through forgets it, and the next renewal says only what came after", () => {
    lastUsedAt(START_MS - 2 * HOUR);
    UserActivity.install();

    UserActivity.forgetInactivityReportedBy(START_MS);

    expect(UserActivity.getLongestInactivity()).toBeNull();
    expect(storedInactivity()).toBeNull();

    // Away 20 minutes after it: kept, though shorter than the one forgotten.
    nowMs = START_MS + 20 * MINUTE;
    UserActivity.recordActivity();

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 20 * 60,
      endedSecondsAgo: 0,
    });
  });

  test("one that ended after the renewal read it - in another tab, while it was on its way - is kept for the next", () => {
    lastUsedAt(START_MS - 2 * HOUR);
    UserActivity.install();

    localStorage.setItem(
      LONGEST_INACTIVITY_STORAGE_KEY,
      JSON.stringify({ fromMs: START_MS - 5 * HOUR, toMs: START_MS + 1000 }),
    );

    UserActivity.forgetInactivityReportedBy(START_MS);

    nowMs = START_MS + 1000;

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 5 * 60 * 60 + 1,
      endedSecondsAgo: 0,
    });
  });

  test("storage refused: this tab keeps it itself, and forgets it the same way", () => {
    UserActivity.install();

    jest.spyOn(LocalStorage, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError: storage is disabled");
    });
    jest.spyOn(LocalStorage, "setItem").mockImplementation((): never => {
      throw new Error("QuotaExceededError");
    });

    nowMs = START_MS + 2 * HOUR;

    expect(() => {
      UserActivity.recordActivity();
    }).not.toThrow();

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: 0,
    });

    UserActivity.forgetInactivityReportedBy(START_MS + 2 * HOUR);

    expect(UserActivity.getLongestInactivity()).toBeNull();
  });

  test("a tab going out of view writes its newest activity down, however recently it last wrote", () => {
    UserActivity.install();

    nowMs = START_MS + 5000;
    window.dispatchEvent(new Event("pointerdown"));

    // Too soon after the last write to write again.
    expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBe(
      String(START_MS),
    );

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBe(
      String(START_MS + 5000),
    );
  });

  test("a page closing writes its newest activity down: the time the browser stands closed counts from the last thing its person did", () => {
    UserActivity.install();

    nowMs = START_MS + 10 * 1000;
    window.dispatchEvent(new Event("keydown"));

    for (const eventName of PAGE_HIDE_EVENTS) {
      window.dispatchEvent(new Event(eventName));
    }

    expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBe(
      String(START_MS + 10 * 1000),
    );

    // The browser opens the Dashboard again, the idle timeout exactly later.
    UserActivity.resetForTests();
    nowMs = START_MS + 10 * 1000 + 15 * MINUTE;
    UserActivity.install();

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: 15 * 60,
      endedSecondsAgo: 0,
    });
  });

  test("writing it down never moves another tab's newer activity back", () => {
    UserActivity.install();

    lastUsedAt(START_MS + MINUTE);
    nowMs = START_MS + 30 * 1000;

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));

    expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBe(
      String(START_MS + MINUTE),
    );
  });

  test("resetForTests stops listening for the page closing", () => {
    const removed: jest.SpiedFunction<typeof window.removeEventListener> =
      jest.spyOn(window, "removeEventListener");

    UserActivity.install();
    UserActivity.resetForTests();

    expect(
      removed.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual(expect.arrayContaining([...PAGE_HIDE_EVENTS]));
  });

  test("a page that does not notice activity says nothing, even with one kept", () => {
    localStorage.setItem(
      LONGEST_INACTIVITY_STORAGE_KEY,
      JSON.stringify({ fromMs: START_MS - 3 * HOUR, toMs: START_MS - HOUR }),
    );

    expect(UserActivity.getLongestInactivity()).toBeNull();
  });

  test("a time longer than the server reads says the most it reads", () => {
    lastUsedAt(START_MS - (MAX_REPORTED_INACTIVITY_IN_SECONDS + 100) * 1000);

    UserActivity.install();

    expect(UserActivity.getLongestInactivity()).toEqual({
      forSeconds: MAX_REPORTED_INACTIVITY_IN_SECONDS,
      endedSecondsAgo: 0,
    });
  });

  test("one that ended longer ago than the server reads is no report: no session it could end is still there", () => {
    lastUsedAt(START_MS - 2 * HOUR);
    UserActivity.install();

    expect(
      UserActivity.getLongestInactivity(
        START_MS + MAX_REPORTED_INACTIVITY_IN_SECONDS * 1000,
      ),
    ).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: MAX_REPORTED_INACTIVITY_IN_SECONDS,
    });
    expect(
      UserActivity.getLongestInactivity(
        START_MS + (MAX_REPORTED_INACTIVITY_IN_SECONDS + 1) * 1000,
      ),
    ).toBeNull();
  });

  test("a clock that moved back since says it ended now", () => {
    lastUsedAt(START_MS - 2 * HOUR);
    UserActivity.install();

    expect(UserActivity.getLongestInactivity(START_MS - HOUR)).toEqual({
      forSeconds: 2 * 60 * 60,
      endedSecondsAgo: 0,
    });
  });

  test.each([
    ["not a time", "not json"],
    ["an empty object", "{}"],
    ["no end", '{"fromMs":5}'],
    ["an end before its start", '{"fromMs":10,"toMs":5}'],
    ["times as text", '{"fromMs":"1","toMs":"2"}'],
    ["a list", "[1,2]"],
    ["a start before 1970", '{"fromMs":-5,"toMs":5}'],
  ])(
    "a stored value that is %s is none, and the next one kept takes its place",
    (_label: string, value: string) => {
      localStorage.setItem(LONGEST_INACTIVITY_STORAGE_KEY, value);
      UserActivity.install();

      expect(UserActivity.getLongestInactivity()).toBeNull();

      nowMs = START_MS + HOUR;
      UserActivity.recordActivity();

      expect(UserActivity.getLongestInactivity()).toEqual({
        forSeconds: 60 * 60,
        endedSecondsAgo: 0,
      });
    },
  );
});

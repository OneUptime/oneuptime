import UserActivity, {
  ACTIVITY_EVENTS,
  ACTIVITY_WRITE_INTERVAL_IN_MS,
  LAST_ACTIVITY_STORAGE_KEY,
} from "../../../UI/Utils/UserActivity";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import { MAX_REPORTED_INACTIVITY_IN_SECONDS } from "../../../Types/UserSession/SessionLength";
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

  test("installing again is harmless: one listener for each event", () => {
    const added: jest.SpiedFunction<typeof window.addEventListener> =
      jest.spyOn(window, "addEventListener");

    UserActivity.install();
    UserActivity.install();

    expect(added).toHaveBeenCalledTimes(ACTIVITY_EVENTS.length);
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

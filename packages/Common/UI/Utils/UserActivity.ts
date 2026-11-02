import LocalStorage from "./LocalStorage";
import { JSONValue } from "../../Types/JSON";
import { MAX_REPORTED_INACTIVITY_IN_SECONDS } from "../../Types/UserSession/SessionLength";

/*
 * WHEN THE PERSON LAST USED ONEUPTIME IN THIS BROWSER.
 *
 * A master admin can sign people out after a while without use (the idle
 * timeout, Common/Types/UserSession/SessionLength.ts). The server decides
 * that, never the browser - but only the browser knows whether a person is
 * there: an open tab keeps renewing its session in the background (its
 * lists re-read, its live updates reconnect), and a renewal on its own says
 * nothing about whether anyone clicked. So the Dashboard and the Admin
 * Dashboard say, each time they renew the session, how long it has been
 * since their person last clicked, typed, scrolled, touched or moved the
 * pointer, or brought a tab back into view (getInactiveForInSeconds), and
 * the server counts the idle timeout from that.
 *
 * Every tab of a browser shares one session (its cookies), so they share
 * this too: each tab writes the time of its person's latest activity to
 * local storage, at most every ACTIVITY_WRITE_INTERVAL_IN_MS, and a renewal
 * in any tab reads the newest time any tab wrote. Someone working in one
 * tab is never signed out by a renewal in another tab they left open.
 *
 * Opening a page counts as activity (install). Anything this cannot read -
 * storage refused in a private window, say - falls back to what this tab
 * saw itself. Nothing here signs anyone out; the time it keeps is cleared
 * with the rest of local storage at sign-out (User.logout).
 */

// Where every tab keeps the newest activity, in milliseconds since 1970.
export const LAST_ACTIVITY_STORAGE_KEY: string = "oneuptime-last-activity-at";

/*
 * How often a tab writes its activity down while its person keeps using it:
 * rarely enough to cost nothing, often enough that an idle timeout of
 * fifteen minutes (the shortest) is counted to within a few seconds.
 */
export const ACTIVITY_WRITE_INTERVAL_IN_MS: number = 15 * 1000;

// What counts as someone using the page.
export const ACTIVITY_EVENTS: ReadonlyArray<string> = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
];

interface ActivityTarget {
  addEventListener: (
    type: string,
    listener: () => void,
    options?: AddEventListenerOptions | boolean,
  ) => void;
  removeEventListener: (
    type: string,
    listener: () => void,
    options?: EventListenerOptions | boolean,
  ) => void;
}

export default class UserActivity {
  // The newest activity this tab has seen itself.
  private static lastActivityAtMs: number | null = null;

  // When this tab last wrote its activity down.
  private static lastWrittenAtMs: number | null = null;

  private static target: ActivityTarget | null = null;

  private static visibilityTarget: ActivityTarget | null = null;

  private static readonly onActivity: () => void = (): void => {
    UserActivity.recordActivity();
  };

  private static readonly onVisibilityChange: () => void = (): void => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    ) {
      UserActivity.recordActivity();
    }
  };

  /*
   * Starts noticing activity on this page: called once, when the Dashboard
   * or the Admin Dashboard starts. Opening the page is activity too.
   * Harmless when called again.
   */
  public static install(): void {
    if (UserActivity.target || typeof window === "undefined") {
      return;
    }

    UserActivity.target = window;

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, UserActivity.onActivity, {
        capture: true,
        passive: true,
      });
    }

    if (typeof document !== "undefined") {
      UserActivity.visibilityTarget = document;
      document.addEventListener(
        "visibilitychange",
        UserActivity.onVisibilityChange,
      );
    }

    UserActivity.recordActivity();
  }

  // Whether this page notices activity: only then does a renewal say how long it has been.
  public static isTracking(): boolean {
    return UserActivity.target !== null;
  }

  // The person did something now.
  public static recordActivity(nowMs: number = Date.now()): void {
    if (
      UserActivity.lastActivityAtMs === null ||
      nowMs > UserActivity.lastActivityAtMs
    ) {
      UserActivity.lastActivityAtMs = nowMs;
    }

    if (
      UserActivity.lastWrittenAtMs !== null &&
      nowMs - UserActivity.lastWrittenAtMs < ACTIVITY_WRITE_INTERVAL_IN_MS &&
      nowMs >= UserActivity.lastWrittenAtMs
    ) {
      return;
    }

    UserActivity.lastWrittenAtMs = nowMs;

    try {
      const stored: number | null = UserActivity.readStoredActivityAtMs();

      // Never move another tab's newer activity back.
      if (stored !== null && stored >= nowMs) {
        return;
      }

      LocalStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(nowMs));
    } catch {
      // Storage refused: this tab's own activity still counts.
    }
  }

  /*
   * The newest activity of any tab of this browser, in milliseconds, or null
   * before any was seen.
   */
  public static getLastActivityAtMs(): number | null {
    const own: number | null = UserActivity.lastActivityAtMs;

    let stored: number | null = null;

    try {
      stored = UserActivity.readStoredActivityAtMs();
    } catch {
      stored = null;
    }

    if (own === null) {
      return stored;
    }

    if (stored === null) {
      return own;
    }

    return Math.max(own, stored);
  }

  /*
   * How long, in whole seconds, the person has not used OneUptime in this
   * browser - what a renewal tells the server - or null when this page
   * does not notice activity, or has seen none. Never negative, and never
   * more than the server reads (MAX_REPORTED_INACTIVITY_IN_SECONDS): a clock
   * that moved back is no inactivity.
   */
  public static getInactiveForInSeconds(
    nowMs: number = Date.now(),
  ): number | null {
    if (!UserActivity.isTracking()) {
      return null;
    }

    const lastActivityAtMs: number | null = UserActivity.getLastActivityAtMs();

    if (lastActivityAtMs === null) {
      return null;
    }

    const seconds: number = Math.floor((nowMs - lastActivityAtMs) / 1000);

    return Math.min(Math.max(0, seconds), MAX_REPORTED_INACTIVITY_IN_SECONDS);
  }

  // Stops noticing activity and forgets what was seen. For tests.
  public static resetForTests(): void {
    if (UserActivity.target) {
      for (const eventName of ACTIVITY_EVENTS) {
        UserActivity.target.removeEventListener(
          eventName,
          UserActivity.onActivity,
          { capture: true },
        );
      }
    }

    if (UserActivity.visibilityTarget) {
      UserActivity.visibilityTarget.removeEventListener(
        "visibilitychange",
        UserActivity.onVisibilityChange,
      );
    }

    UserActivity.target = null;
    UserActivity.visibilityTarget = null;
    UserActivity.lastActivityAtMs = null;
    UserActivity.lastWrittenAtMs = null;
  }

  // What local storage holds, if it is a time; throws when storage cannot be read.
  private static readStoredActivityAtMs(): number | null {
    const value: JSONValue = LocalStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    const asNumber: number =
      typeof value === "number" ? value : Number(value ?? NaN);

    if (!Number.isFinite(asNumber) || asNumber <= 0) {
      return null;
    }

    return asNumber;
  }
}

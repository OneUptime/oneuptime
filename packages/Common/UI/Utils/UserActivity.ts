import LocalStorage from "./LocalStorage";
import { JSONValue } from "../../Types/JSON";
import {
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
  MAX_REPORTED_INACTIVITY_IN_SECONDS,
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  ReportedInactivity,
} from "../../Types/UserSession/SessionLength";

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
 * local storage, at most every ACTIVITY_WRITE_INTERVAL_IN_MS - and once
 * more as it is hidden or closed, so the time a browser stood closed counts
 * from the last thing its person did - and a renewal in any tab reads the
 * newest time any tab wrote. Someone working in one tab is never signed
 * out by a renewal in another tab they left open.
 *
 * How long it has been now is not enough on its own (issue #6789). Someone
 * who closes the browser, or whose computer sleeps, and opens OneUptime
 * again hours later has clicked by the time the session is renewed -
 * opening the page counts as activity - so that renewal would say they
 * were here a moment ago, and the session would go on. So the activity
 * that ends a time without use in every tab - the page opened again, a tab
 * brought back, the first click after the computer woke - measures it,
 * from the newest activity any tab wrote down before, and the longest one
 * since the session was last renewed is kept beside it in local storage.
 * The next renewal says it too (getLongestInactivity), and the server ends
 * the session when it reached the idle timeout. A renewal that went through
 * forgets it (forgetInactivityReportedBy). One shorter than the shortest
 * idle timeout ends no session, and is not kept.
 *
 * And the server must hear of it while the person is here (issue #8188).
 * A tab renews only when it must - a request after its access token ran
 * out, its live updates' notice before then - so a page that asks the
 * server nothing, a long note being typed, an Admin Dashboard page without
 * live updates, could be in use for an hour while the server's record of
 * the person's last activity stood still. So a page that installs with
 * reportActivity (the Dashboard and the Admin Dashboard) asks for a
 * renewal as its person uses it, once the activity the server last heard
 * of is ACTIVITY_REPORT_INTERVAL_IN_MS old (isActivityReportDue), at most
 * once every MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS. The activity each
 * renewal reported is kept for every tab (noteActivityReported), so
 * someone working in one tab renews from it however many tabs they left
 * open, and a tab nobody uses asks for nothing. The server then knows a
 * session it has heard nothing of for a while is not in use, and records
 * its idle timeout within minutes (Common/Types/UserSession/SessionLength,
 * ACTIVITY_REPORTED_WITHIN_IN_MINUTES).
 *
 * Opening a page counts as activity (install). Anything this cannot read -
 * storage refused in a private window, say - falls back to what this tab
 * saw itself. Nothing here signs anyone out; what it keeps is cleared with
 * the rest of local storage at sign-out (User.logout).
 */

// Where every tab keeps the newest activity, in milliseconds since 1970.
export const LAST_ACTIVITY_STORAGE_KEY: string = "oneuptime-last-activity-at";

/*
 * Where every tab keeps the longest time without use since the session was
 * last renewed: when it started and when it ended, in milliseconds since
 * 1970 ({ "fromMs": ..., "toMs": ... }).
 */
export const LONGEST_INACTIVITY_STORAGE_KEY: string =
  "oneuptime-longest-inactivity";

/*
 * How often a tab writes its activity down while its person keeps using it:
 * rarely enough to cost nothing, often enough that an idle timeout of
 * fifteen minutes (the shortest) is counted to within a few seconds.
 */
export const ACTIVITY_WRITE_INTERVAL_IN_MS: number = 15 * 1000;

/*
 * The shortest time without use worth keeping: the shortest idle timeout.
 * A shorter one ends no session.
 */
export const MIN_KEPT_INACTIVITY_IN_MS: number =
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES * 60 * 1000;

/*
 * Where every tab keeps the newest activity a renewal told the server of,
 * in milliseconds since 1970.
 */
export const REPORTED_ACTIVITY_STORAGE_KEY: string =
  "oneuptime-reported-activity-at";

/*
 * How old the activity the server last heard of may grow while the person
 * uses OneUptime before a renewal tells it of newer activity: the interval
 * the server counts on (ACTIVITY_REPORTED_WITHIN_IN_MINUTES).
 */
export const ACTIVITY_REPORT_INTERVAL_IN_MS: number =
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES * 60 * 1000;

/*
 * The least time between two renewals asked for to report activity: one
 * that got no answer (the network down) is asked for again a minute later,
 * not at every key press.
 */
export const MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS: number = 60 * 1000;

// What the page installs to have activity reported: asks for a renewal.
export type ActivityReporter = () => void;

export interface UserActivityInstallOptions {
  /*
   * Asks for a renewal of the session, which says how long the person has
   * not used OneUptime (API.reportActivityWhileInUse). Without it, the page
   * renews only as it did, and says nothing of renewing while in use.
   */
  reportActivity?: ActivityReporter | undefined;
}

// What counts as someone using the page.
export const ACTIVITY_EVENTS: ReadonlyArray<string> = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
];

/*
 * The page going away for good (closed, reloaded, left): the tab writes its
 * newest activity down then, whenever it last wrote it.
 */
export const PAGE_HIDE_EVENTS: ReadonlyArray<string> = ["pagehide"];

// A time without use, in milliseconds since 1970.
interface InactiveTime {
  fromMs: number;
  toMs: number;
}

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

  /*
   * The longest time without use this tab kept itself, when local storage
   * refused to keep it for every tab.
   */
  private static ownLongestInactivity: InactiveTime | null = null;

  /*
   * The newest activity a renewal from this tab told the server of, when
   * local storage refused to keep it for every tab.
   */
  private static ownReportedActivityAtMs: number | null = null;

  // When this tab last asked for a renewal to report activity.
  private static lastReportAskedAtMs: number | null = null;

  // What asks for a renewal to report activity, when the page installed one.
  private static activityReporter: ActivityReporter | null = null;

  private static target: ActivityTarget | null = null;

  private static visibilityTarget: ActivityTarget | null = null;

  private static readonly onActivity: () => void = (): void => {
    UserActivity.recordActivity();
  };

  private static readonly onVisibilityChange: () => void = (): void => {
    if (typeof document === "undefined") {
      return;
    }

    if (document.visibilityState === "visible") {
      UserActivity.recordActivity();
      return;
    }

    if (document.visibilityState === "hidden") {
      UserActivity.writeDownActivity();
    }
  };

  private static readonly onPageHide: () => void = (): void => {
    UserActivity.writeDownActivity();
  };

  /*
   * Starts noticing activity on this page: called once, when the Dashboard
   * or the Admin Dashboard starts. Opening the page is activity too - and
   * ends the time without use since the last activity of any tab, a browser
   * closed or a computer asleep, which is kept for the next renewal to say.
   * With reportActivity, a renewal is asked for while its person uses the
   * page, once the server's record of their activity is getting old - and
   * at once when the server has heard of none from this browser, so a new
   * sign-in says from its first page that it renews while in use. Harmless
   * when called again.
   */
  public static install(options?: UserActivityInstallOptions): void {
    if (UserActivity.target || typeof window === "undefined") {
      return;
    }

    UserActivity.activityReporter = options?.reportActivity || null;
    UserActivity.target = window;

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, UserActivity.onActivity, {
        capture: true,
        passive: true,
      });
    }

    for (const eventName of PAGE_HIDE_EVENTS) {
      window.addEventListener(eventName, UserActivity.onPageHide, {
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

  /*
   * Whether this page renews the session while its person uses it, within
   * ACTIVITY_REPORT_INTERVAL_IN_MS of their activity: what its renewals
   * tell the server (REPORTS_ACTIVITY_WHILE_IN_USE_FIELD).
   */
  public static isReportingActivityWhileInUse(): boolean {
    return UserActivity.isTracking() && UserActivity.activityReporter !== null;
  }

  /*
   * A renewal went through that told the server of activity at
   * `activityAtMs` - kept for every tab, so none of them asks for another
   * until that activity is ACTIVITY_REPORT_INTERVAL_IN_MS old.
   */
  public static noteActivityReported(activityAtMs: number): void {
    if (!Number.isFinite(activityAtMs) || activityAtMs <= 0) {
      return;
    }

    UserActivity.ownReportedActivityAtMs = activityAtMs;

    try {
      LocalStorage.setItem(REPORTED_ACTIVITY_STORAGE_KEY, String(activityAtMs));
    } catch {
      // Storage refused: this tab keeps it itself.
    }
  }

  /*
   * The newest activity a renewal told the server of, from any tab, in
   * milliseconds, or null when none has yet.
   */
  public static getReportedActivityAtMs(): number | null {
    let stored: number | null = null;

    try {
      stored = UserActivity.readStoredTime(REPORTED_ACTIVITY_STORAGE_KEY);
    } catch {
      stored = null;
    }

    const own: number | null = UserActivity.ownReportedActivityAtMs;

    if (own === null) {
      return stored;
    }

    if (stored === null) {
      return own;
    }

    return Math.max(own, stored);
  }

  /*
   * Whether activity at `nowMs` should be told to the server: it has heard
   * of none from this browser, or the newest it heard of is
   * ACTIVITY_REPORT_INTERVAL_IN_MS old, or later than now (a clock that
   * moved back, which only a new report sets right).
   */
  public static isActivityReportDue(nowMs: number = Date.now()): boolean {
    const reportedAtMs: number | null = UserActivity.getReportedActivityAtMs();

    if (reportedAtMs === null || nowMs < reportedAtMs) {
      return true;
    }

    return nowMs - reportedAtMs >= ACTIVITY_REPORT_INTERVAL_IN_MS;
  }

  // The person did something now.
  public static recordActivity(nowMs: number = Date.now()): void {
    UserActivity.noteInactivityEndingAt(nowMs);

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
    UserActivity.writeActivity(nowMs);
    UserActivity.reportActivityIfDue(nowMs);
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

  /*
   * The longest time the person went without using OneUptime in any tab of
   * this browser that ended since the session was last renewed - what a
   * renewal tells the server beside how long it has been now - in whole
   * seconds: how long it lasted (never more than the server reads), and how
   * long before `nowMs` it ended. Null when this page does not notice
   * activity, when no such time was kept, or when it ended so long ago that
   * no session it could end is still there.
   */
  public static getLongestInactivity(
    nowMs: number = Date.now(),
  ): ReportedInactivity | null {
    if (!UserActivity.isTracking()) {
      return null;
    }

    const time: InactiveTime | null = UserActivity.getLongestInactiveTime();

    if (!time) {
      return null;
    }

    // A clock that moved back since: it ended now.
    const endedSecondsAgo: number = Math.max(
      0,
      Math.floor((nowMs - time.toMs) / 1000),
    );

    if (endedSecondsAgo > MAX_REPORTED_INACTIVITY_IN_SECONDS) {
      return null;
    }

    return {
      forSeconds: Math.min(
        Math.floor((time.toMs - time.fromMs) / 1000),
        MAX_REPORTED_INACTIVITY_IN_SECONDS,
      ),
      endedSecondsAgo: endedSecondsAgo,
    };
  }

  /*
   * A renewal that said what was kept at `reportedAtMs` went through: the
   * server knows of that time without use now, so it is forgotten, and the
   * next renewal says only what came after. One that ended after the
   * renewal read it - in another tab, while the renewal was on its way - is
   * kept for the next.
   */
  public static forgetInactivityReportedBy(reportedAtMs: number): void {
    const own: InactiveTime | null = UserActivity.ownLongestInactivity;

    if (own && own.toMs <= reportedAtMs) {
      UserActivity.ownLongestInactivity = null;
    }

    try {
      const stored: InactiveTime | null = UserActivity.readStoredInactivity();

      if (stored && stored.toMs <= reportedAtMs) {
        LocalStorage.removeItem(LONGEST_INACTIVITY_STORAGE_KEY);
      }
    } catch {
      // Storage refused: nothing of it was kept there.
    }
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

      for (const eventName of PAGE_HIDE_EVENTS) {
        UserActivity.target.removeEventListener(
          eventName,
          UserActivity.onPageHide,
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
    UserActivity.ownLongestInactivity = null;
    UserActivity.ownReportedActivityAtMs = null;
    UserActivity.lastReportAskedAtMs = null;
    UserActivity.activityReporter = null;
  }

  /*
   * Asks for a renewal to tell the server of activity at `nowMs`, when the
   * page installed a reporter, a report is due, and none was asked for in
   * the last MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS. Never fails the event
   * it came from.
   */
  private static reportActivityIfDue(nowMs: number): void {
    const reporter: ActivityReporter | null = UserActivity.activityReporter;

    if (!reporter || !UserActivity.isTracking()) {
      return;
    }

    const askedAtMs: number | null = UserActivity.lastReportAskedAtMs;

    if (
      askedAtMs !== null &&
      nowMs >= askedAtMs &&
      nowMs - askedAtMs < MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS
    ) {
      return;
    }

    if (!UserActivity.isActivityReportDue(nowMs)) {
      return;
    }

    UserActivity.lastReportAskedAtMs = nowMs;

    try {
      reporter();
    } catch {
      // Asked again at the next activity after the pause.
    }
  }

  /*
   * The time without use that activity at `nowMs` ends, kept when it is
   * long enough to end a session and longer than the one kept already.
   * Asked only when this tab has seen nothing for a while, or nothing at
   * all (a page just opened): a tab in use ends no long time without use,
   * and its every move costs no read of storage. Measured from the newest
   * activity of any tab, so a tab brought back while another was in use
   * ends none.
   */
  private static noteInactivityEndingAt(nowMs: number): void {
    const own: number | null = UserActivity.lastActivityAtMs;

    if (own !== null && nowMs - own < ACTIVITY_WRITE_INTERVAL_IN_MS) {
      return;
    }

    const newestBefore: number | null = UserActivity.getLastActivityAtMs();

    if (
      newestBefore === null ||
      nowMs - newestBefore < MIN_KEPT_INACTIVITY_IN_MS
    ) {
      return;
    }

    UserActivity.keepInactivity({ fromMs: newestBefore, toMs: nowMs });
  }

  // Keeps a time without use for every tab, unless a longer one is kept already.
  private static keepInactivity(time: InactiveTime): void {
    try {
      const stored: InactiveTime | null = UserActivity.readStoredInactivity();

      if (stored && !UserActivity.isLonger(time, stored)) {
        return;
      }

      LocalStorage.setItem(
        LONGEST_INACTIVITY_STORAGE_KEY,
        JSON.stringify({ fromMs: time.fromMs, toMs: time.toMs }),
      );
    } catch {
      // Storage refused: this tab keeps it itself.
      const own: InactiveTime | null = UserActivity.ownLongestInactivity;

      if (!own || UserActivity.isLonger(time, own)) {
        UserActivity.ownLongestInactivity = time;
      }
    }
  }

  // The longest time without use kept, by every tab or this one.
  private static getLongestInactiveTime(): InactiveTime | null {
    let stored: InactiveTime | null = null;

    try {
      stored = UserActivity.readStoredInactivity();
    } catch {
      stored = null;
    }

    const own: InactiveTime | null = UserActivity.ownLongestInactivity;

    if (!stored) {
      return own;
    }

    if (!own) {
      return stored;
    }

    return UserActivity.isLonger(own, stored) ? own : stored;
  }

  private static isLonger(time: InactiveTime, than: InactiveTime): boolean {
    return time.toMs - time.fromMs > than.toMs - than.fromMs;
  }

  // This tab's newest activity, written down for every tab: as it is hidden or closed.
  private static writeDownActivity(): void {
    if (UserActivity.lastActivityAtMs === null) {
      return;
    }

    UserActivity.writeActivity(UserActivity.lastActivityAtMs);
  }

  // Writes activity at `atMs` down for every tab, never moving another tab's newer activity back.
  private static writeActivity(atMs: number): void {
    try {
      const stored: number | null = UserActivity.readStoredActivityAtMs();

      if (stored !== null && stored >= atMs) {
        return;
      }

      LocalStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(atMs));
    } catch {
      // Storage refused: this tab's own activity still counts.
    }
  }

  // What local storage holds, if it is a time; throws when storage cannot be read.
  private static readStoredActivityAtMs(): number | null {
    return UserActivity.readStoredTime(LAST_ACTIVITY_STORAGE_KEY);
  }

  // The time local storage holds under `key`, if it is one; throws when storage cannot be read.
  private static readStoredTime(key: string): number | null {
    const value: JSONValue = LocalStorage.getItem(key);
    const asNumber: number =
      typeof value === "number" ? value : Number(value ?? NaN);

    if (!Number.isFinite(asNumber) || asNumber <= 0) {
      return null;
    }

    return asNumber;
  }

  /*
   * The time without use local storage holds, if it is one: a start and an
   * end, the end after the start. Throws when storage cannot be read.
   */
  private static readStoredInactivity(): InactiveTime | null {
    let value: unknown = LocalStorage.getItem(LONGEST_INACTIVITY_STORAGE_KEY);

    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const fromMs: unknown = (value as Record<string, unknown>)["fromMs"];
    const toMs: unknown = (value as Record<string, unknown>)["toMs"];

    if (
      typeof fromMs !== "number" ||
      typeof toMs !== "number" ||
      !Number.isFinite(fromMs) ||
      !Number.isFinite(toMs) ||
      fromMs <= 0 ||
      toMs <= fromMs
    ) {
      return null;
    }

    return { fromMs, toMs };
  }
}

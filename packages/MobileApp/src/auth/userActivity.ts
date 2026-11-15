import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { getCachedAccessToken, getTokens } from "../storage/keychain";
import { decodeJwtPayload, type JwtPayload } from "../utils/jwt";

/*
 * WHEN THE PERSON LAST USED THE APP (issue #8187).
 *
 * A master admin can sign people out after a while without use: the idle
 * timeout (Admin Dashboard > Settings > Session Length). The server decides
 * it at every renewal of the session (POST /identity/refresh-token,
 * Common/Types/UserSession/SessionLength.ts decideSessionRenewal), but only
 * the app knows whether anybody is using it. A renewal that says nothing is
 * decided from the last renewal the server saw - and under the 15-minute
 * idle timeout the access token runs out exactly at that idle end, so an app
 * that only renews once its token has run out was signed out at every
 * renewal, however much it was used.
 *
 * So the app says, with every renewal, what the Dashboard says
 * (Common/UI/Utils/UserActivity.ts), in the same two fields:
 *
 *   - inactiveForInSeconds: how long it has been since its person last
 *     touched it, typed in it or brought it to the screen;
 *   - longestInactivity: the longest time they went without since the last
 *     renewal - the app in the background, or closed - as how long it
 *     lasted and how long ago it ended, in whole seconds. Opening the app is
 *     activity, so without this a phone put away for hours would renew as
 *     if its person had been here all along (issue #6789, for the browser).
 *
 * The newest activity is written to storage at most every
 * ACTIVITY_WRITE_INTERVAL_MS while the app is in use, and at once when it
 * leaves the screen, so the time it then spends in the background or closed
 * is counted from the last thing its person did, even when the system ends
 * the app in between. A time without use is kept only when it is as long as
 * the shortest idle timeout - a shorter one ends no session - and only for
 * the session it happened in: a time kept for one sign-in never ends the
 * next one, nor hides one of the next one's own.
 *
 * Nothing here signs anyone out. The server decides; the report can only
 * end a session the idle timeout has ended, never keep one past it.
 */

// Where the app keeps what it knows of its person's activity between launches.
export const USER_ACTIVITY_STORAGE_KEY: string =
  "com.oneuptime.oncall.userActivity";

// The fields of a renewal the server reads (Common/Types/UserSession/SessionLength.ts).
export const INACTIVE_FOR_IN_SECONDS_FIELD: string = "inactiveForInSeconds";

export const LONGEST_INACTIVITY_FIELD: string = "longestInactivity";

/*
 * How often the newest activity is written down while the app is in use:
 * rarely enough to cost nothing, often enough that an app the system ended
 * without warning is counted to within a few seconds.
 */
export const ACTIVITY_WRITE_INTERVAL_MS: number = 15 * 1000;

/*
 * The shortest idle timeout a master admin can set, and so the shortest
 * time without use worth keeping (MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES).
 */
export const MIN_KEPT_INACTIVITY_MS: number = 15 * 60 * 1000;

/*
 * The most the server reads a reported duration as
 * (MAX_REPORTED_INACTIVITY_IN_SECONDS: twice the longest idle timeout, 30
 * days). Anything longer has passed every idle timeout anyway.
 */
export const MAX_REPORTED_INACTIVITY_IN_SECONDS: number = 30 * 24 * 60 * 60 * 2;

// A time without use a renewal reports, in whole seconds.
export interface ReportedInactivity {
  // How long it lasted.
  forSeconds: number;
  // How long before the renewal it ended: the activity that ended it.
  endedSecondsAgo: number;
}

// What a renewal says of its person's use of the app.
export interface RenewalReport {
  inactiveForInSeconds: number;
  longestInactivity?: ReportedInactivity;
}

// A time without use, in milliseconds since 1970, and the session it happened in.
interface KeptInactivity {
  fromMs: number;
  toMs: number;
  sessionKey: string;
}

// What is kept in storage.
interface ActivityRecord {
  lastActivityAtMs: number | null;
  longestInactivity: KeptInactivity | null;
}

type ActivityListener = (atMs: number) => void;

let record: ActivityRecord = {
  lastActivityAtMs: null,
  longestInactivity: null,
};

let loading: Promise<void> | null = null;

let isLoaded: boolean = false;

/*
 * Activity seen before the record was read, at the very start of a launch:
 * the first of it ends the time without use since the last launch, the last
 * of it is the newest.
 */
let firstActivityBeforeLoadMs: number | null = null;

let lastActivityBeforeLoadMs: number | null = null;

let lastWrittenAtMs: number | null = null;

let writes: Promise<void> = Promise.resolve();

let appStateSubscription: { remove: () => void } | null = null;

const listeners: Set<ActivityListener> = new Set<ActivityListener>();

/*
 * The session an access token belongs to (its sessionId claim), or null
 * when nobody is signed in. A token that names none - one an earlier
 * server signed - is a session all the same.
 */
function getSessionKey(token: string | null): string | null {
  if (!token) {
    return null;
  }

  const sessionId: unknown = decodeJwtPayload(token)?.["sessionId"];

  return typeof sessionId === "string" ? sessionId : "";
}

function getCurrentSessionKey(): string | null {
  return getSessionKey(getCachedAccessToken());
}

/*
 * When the session's person was last active as the server last said it -
 * the lastActiveAt claim of its access token, or failing that when it
 * signed in - in milliseconds, or null.
 */
function getServerKnownActivityAtMs(token: string | null): number | null {
  if (!token) {
    return null;
  }

  const payload: JwtPayload | null = decodeJwtPayload(token);

  for (const claim of ["lastActiveAt", "signedInAt"]) {
    const value: unknown = payload?.[claim];

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// What storage holds, if it is a record this module wrote; anything else is none.
function readRecord(value: string | null): ActivityRecord | null {
  if (!value) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const lastActivityAtMs: unknown = (parsed as Record<string, unknown>)[
    "lastActivityAtMs"
  ];

  if (!isTime(lastActivityAtMs)) {
    return null;
  }

  const kept: unknown = (parsed as Record<string, unknown>)[
    "longestInactivity"
  ];

  let longestInactivity: KeptInactivity | null = null;

  if (kept && typeof kept === "object" && !Array.isArray(kept)) {
    const fromMs: unknown = (kept as Record<string, unknown>)["fromMs"];
    const toMs: unknown = (kept as Record<string, unknown>)["toMs"];
    const sessionKey: unknown = (kept as Record<string, unknown>)["sessionKey"];

    if (
      isTime(fromMs) &&
      isTime(toMs) &&
      toMs > fromMs &&
      typeof sessionKey === "string"
    ) {
      longestInactivity = { fromMs, toMs, sessionKey };
    }
  }

  return { lastActivityAtMs, longestInactivity };
}

function writeRecord(): void {
  writes = writes
    .then(async (): Promise<void> => {
      await AsyncStorage.setItem(
        USER_ACTIVITY_STORAGE_KEY,
        JSON.stringify(record),
      );
    })
    .catch((): void => {
      /*
       * Storage refused: what the app saw itself still counts while it
       * runs. A launch that finds nothing counts from the session's own
       * last activity instead (ensureLoaded).
       */
    });
}

/*
 * Reads what the last launch kept, once. With nothing kept - the first
 * launch of an app that keeps it, or storage that kept nothing - the last
 * activity known is the session's own, as its access token says the server
 * knew it: the time since then that this launch ends counts as time without
 * use, as it would have had the app said nothing at all. The tokens are read
 * here too, so a time without use the launch ends is kept for the session
 * it belongs to.
 */
function ensureLoaded(): Promise<void> {
  if (!loading) {
    loading = (async (): Promise<void> => {
      let stored: ActivityRecord | null = null;

      try {
        stored = readRecord(
          await AsyncStorage.getItem(USER_ACTIVITY_STORAGE_KEY),
        );
      } catch {
        stored = null;
      }

      let accessToken: string | null = null;

      try {
        accessToken = (await getTokens())?.accessToken || null;
      } catch {
        accessToken = null;
      }

      record = stored || {
        lastActivityAtMs: getServerKnownActivityAtMs(accessToken),
        longestInactivity: null,
      };

      isLoaded = true;

      const first: number | null = firstActivityBeforeLoadMs;
      const last: number | null = lastActivityBeforeLoadMs;

      firstActivityBeforeLoadMs = null;
      lastActivityBeforeLoadMs = null;

      if (first !== null) {
        applyActivity(first);
      }

      if (last !== null && last !== first) {
        applyActivity(last);
      }
    })();
  }

  return loading;
}

function isLonger(time: KeptInactivity, than: KeptInactivity): boolean {
  return time.toMs - time.fromMs > than.toMs - than.fromMs;
}

/*
 * Keeps a time without use for the session signed in now, unless a longer
 * one of the same session is kept already. A time of another session - the
 * one before a sign-out - is replaced, whatever its length. With nobody
 * signed in there is no session for it to end. Whether anything was kept.
 */
function keepInactivity(fromMs: number, toMs: number): boolean {
  const sessionKey: string | null = getCurrentSessionKey();

  if (sessionKey === null) {
    return false;
  }

  const time: KeptInactivity = { fromMs, toMs, sessionKey };
  const kept: KeptInactivity | null = record.longestInactivity;

  if (kept && kept.sessionKey === sessionKey && !isLonger(time, kept)) {
    return false;
  }

  record.longestInactivity = time;

  return true;
}

function applyActivity(atMs: number): void {
  const before: number | null = record.lastActivityAtMs;

  const kept: boolean =
    before !== null &&
    atMs - before >= MIN_KEPT_INACTIVITY_MS &&
    keepInactivity(before, atMs);

  if (before === null || atMs > before) {
    record.lastActivityAtMs = atMs;
  }

  if (
    kept ||
    lastWrittenAtMs === null ||
    atMs - lastWrittenAtMs >= ACTIVITY_WRITE_INTERVAL_MS ||
    atMs < lastWrittenAtMs
  ) {
    lastWrittenAtMs = atMs;
    writeRecord();
  }

  for (const listener of Array.from(listeners)) {
    try {
      listener(atMs);
    } catch {
      // A listener's failure is its own: the activity still counts.
    }
  }
}

/*
 * The person did something now: touched the app, typed in it, or brought it
 * to the screen. Ends the time without use since their last activity -
 * kept when it is long enough to end a session - and tells every listener
 * (the API client renews a session about to run out: api/client.ts).
 */
export function recordUserActivity(atMs: number = Date.now()): void {
  if (!isLoaded) {
    if (firstActivityBeforeLoadMs === null) {
      firstActivityBeforeLoadMs = atMs;
    }

    lastActivityBeforeLoadMs = Math.max(lastActivityBeforeLoadMs ?? atMs, atMs);

    void ensureLoaded();
    return;
  }

  applyActivity(atMs);
}

/*
 * An onChangeText that counts typing as use of the app. A key pressed on the
 * phone's keyboard reaches none of the app's views as a touch, so without
 * this a note typed for longer than the idle timeout would end the session
 * when it is saved.
 */
export function countTypingAsActivity(
  onChangeText: (text: string) => void,
): (text: string) => void {
  return (text: string): void => {
    recordUserActivity();
    onChangeText(text);
  };
}

// Called with each activity, once the record is read. Returns the unsubscribe.
export function onUserActivity(listener: ActivityListener): () => void {
  listeners.add(listener);

  return (): void => {
    listeners.delete(listener);
  };
}

/*
 * The app leaves the screen - the background, the app switcher, a locked
 * phone - and may be ended there without warning: its newest activity is
 * written down now, whenever it was last written.
 */
function writeDownActivity(): void {
  if (!isLoaded || record.lastActivityAtMs === null) {
    return;
  }

  lastWrittenAtMs = record.lastActivityAtMs;
  writeRecord();
}

function onAppStateChange(state: AppStateStatus): void {
  if (state === "active") {
    recordUserActivity();
    return;
  }

  if (state === "background" || state === "inactive") {
    writeDownActivity();
  }
}

/*
 * Starts noticing activity: called once, when the app starts. The app on
 * the screen now is activity - it was opened - and so is every return to
 * the screen; leaving it writes the newest activity down. A launch in the
 * background (a push handled while the app was closed) is no activity.
 * Harmless when called again. Returns the stop.
 */
export function startUserActivityTracking(): () => void {
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener(
      "change",
      onAppStateChange,
    );
  }

  void ensureLoaded();

  if (AppState.currentState === "active") {
    recordUserActivity();
  }

  return stopUserActivityTracking;
}

export function stopUserActivityTracking(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
}

/*
 * What a renewal at `nowMs` says (RenewalReport): how long since the last
 * activity - all there is, when the app knows of none at all, so the server
 * counts from what it knew - and the longest time without use kept for the
 * session signed in now, unless it ended so long ago that no session it
 * could end is still there. Every duration in whole seconds, never
 * negative, never more than the server reads: a clock that moved back is no
 * time without use.
 */
export async function getRenewalReport(
  nowMs: number = Date.now(),
): Promise<RenewalReport> {
  await ensureLoaded();

  const lastActivityAtMs: number | null = record.lastActivityAtMs;

  const report: RenewalReport = {
    inactiveForInSeconds:
      lastActivityAtMs === null
        ? MAX_REPORTED_INACTIVITY_IN_SECONDS
        : Math.min(
            Math.max(0, Math.floor((nowMs - lastActivityAtMs) / 1000)),
            MAX_REPORTED_INACTIVITY_IN_SECONDS,
          ),
  };

  const kept: KeptInactivity | null = record.longestInactivity;
  const sessionKey: string | null = getCurrentSessionKey();

  if (kept && sessionKey !== null && kept.sessionKey === sessionKey) {
    const endedSecondsAgo: number = Math.max(
      0,
      Math.floor((nowMs - kept.toMs) / 1000),
    );

    if (endedSecondsAgo <= MAX_REPORTED_INACTIVITY_IN_SECONDS) {
      report.longestInactivity = {
        forSeconds: Math.min(
          Math.floor((kept.toMs - kept.fromMs) / 1000),
          MAX_REPORTED_INACTIVITY_IN_SECONDS,
        ),
        endedSecondsAgo,
      };
    }
  }

  return report;
}

/*
 * A renewal that said what getRenewalReport said at `reportedAtMs` went
 * through: the server knows of that time without use now, so it is
 * forgotten, and the next renewal says only what came after. One that
 * ended after the report was read - while the renewal was on its way - is
 * kept for the next.
 */
export function forgetInactivityReportedBy(reportedAtMs: number): void {
  const kept: KeptInactivity | null = record.longestInactivity;

  if (!kept || kept.toMs > reportedAtMs) {
    return;
  }

  record.longestInactivity = null;
  writeRecord();
}

// Every write asked for so far, done. For tests.
export function flushUserActivityWrites(): Promise<void> {
  return writes;
}

/*
 * Forgets everything held in memory, as the end of the app's process does,
 * and stops listening to the app's state. What storage holds stays, and so
 * do the listeners: the modules that added them stay loaded. For tests.
 */
export function resetUserActivityForTests(): void {
  stopUserActivityTracking();
  record = { lastActivityAtMs: null, longestInactivity: null };
  loading = null;
  isLoaded = false;
  firstActivityBeforeLoadMs = null;
  lastActivityBeforeLoadMs = null;
  lastWrittenAtMs = null;
  writes = Promise.resolve();
}

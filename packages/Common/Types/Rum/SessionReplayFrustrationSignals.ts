/*
 * What counts as frustration in one RUM application's recordings.
 *
 * Four signals are built in - rage clicks, dead clicks, error clicks and
 * refresh rage - and each has a rule whose numbers the application can
 * change, or a switch that turns it off. On top of them an application can
 * name its own signals: a click on an element, a visit to a page, an event
 * from its own code (track()) or an error whose text it knows. A signal of
 * its own either counts as frustration, exactly like the built-in four (the
 * Frustration filter, the frustration sort and totals, the amber markers,
 * and the "On error or frustration" upload trigger), or is a marker that is
 * shown and counted without being called frustration.
 *
 * Stored on RumApplication.sessionReplayFrustrationSignals, where null means
 * every default below, served to the browser and React Native recorders on
 * the replay config (SessionReplayConfigResponse.frustrationSignals), and
 * read back by the dashboard's Frustration Signals page. The recorders
 * detect everything themselves and send counts and markers, never what they
 * matched against: an error's text and a page's address never leave the
 * device because of a signal.
 *
 * The defaults are the numbers the recorder used before any of this could be
 * changed, so an application nobody touches records exactly what it did.
 *
 * Bundled into the browser recorder, so it stays small and dependency-free;
 * the strict checks and their messages live in
 * Utils/Rum/SessionReplayFrustrationSettingsValidation, which only the server
 * and the dashboard import. The mobile recorder cannot import Common: its
 * Contract.ts carries a copy of the wire types, held to this file by its
 * ContractParity test.
 */

/* What a signal of the application's own reacts to. */
export type SessionReplayCustomSignalTrigger =
  | "click"
  | "page"
  | "event"
  | "error";

export const SESSION_REPLAY_CUSTOM_SIGNAL_TRIGGERS: ReadonlyArray<SessionReplayCustomSignalTrigger> =
  ["click", "page", "event", "error"];

/*
 * Rage click: clickCount or more clicks, each within windowMs of the one
 * before, all within radiusPx of each other. Clicks on an element matching
 * one of ignoreSelectors (or inside one) never count - a quantity stepper
 * clicked five times is somebody ordering five.
 */
export interface SessionReplayRageClickRule {
  isEnabled: boolean;
  clickCount: number;
  windowMs: number;
  radiusPx: number;
  ignoreSelectors: Array<string>;
}

/*
 * Dead click: a click on something that looks clickable, after which the
 * page does nothing it can be seen doing - no change on screen, no
 * navigation, no request, no scroll - for timeoutMs.
 */
export interface SessionReplayDeadClickRule {
  isEnabled: boolean;
  timeoutMs: number;
  ignoreSelectors: Array<string>;
}

/* Error click: an error within windowMs of a click. */
export interface SessionReplayErrorClickRule {
  isEnabled: boolean;
  windowMs: number;
}

/* Refresh rage: the same page loaded reloadCount times within windowSeconds. */
export interface SessionReplayRefreshRageRule {
  isEnabled: boolean;
  reloadCount: number;
  windowSeconds: number;
}

/*
 * A signal of the application's own.
 *
 * match depends on the trigger:
 *  - click: a CSS selector; a click on a matching element, or inside one.
 *  - page:  a path pattern such as /checkout/error or /orders/x/failed,
 *           where x is a star; see matchesSessionReplayPagePattern.
 *  - event: the name the page passes to track(); case is ignored.
 *  - error: text an error's message contains; case is ignored.
 *
 * id only exists so the settings page can tell rows apart while one is
 * renamed; nothing else reads it and it never goes on the wire.
 */
export interface SessionReplayCustomSignal {
  id: string;
  name: string;
  trigger: SessionReplayCustomSignalTrigger;
  match: string;
  isFrustration: boolean;
  isEnabled: boolean;
}

/* The stored settings: RumApplication.sessionReplayFrustrationSignals. */
export interface SessionReplayFrustrationSettings {
  rageClick: SessionReplayRageClickRule;
  deadClick: SessionReplayDeadClickRule;
  errorClick: SessionReplayErrorClickRule;
  refreshRage: SessionReplayRefreshRageRule;
  customSignals: Array<SessionReplayCustomSignal>;
}

/* A custom signal as the recorders receive it: switched on, without an id. */
export interface SessionReplayCustomSignalConfig {
  name: string;
  trigger: SessionReplayCustomSignalTrigger;
  match: string;
  isFrustration: boolean;
}

/*
 * What the recorders receive (SessionReplayConfigResponse.frustrationSignals).
 * A recorder that finds it missing - an older server, a cached loader stub -
 * uses the defaults, which are the rules it always had.
 */
export interface SessionReplayFrustrationSignalsConfig {
  rageClick: SessionReplayRageClickRule;
  deadClick: SessionReplayDeadClickRule;
  errorClick: SessionReplayErrorClickRule;
  refreshRage: SessionReplayRefreshRageRule;
  customSignals: Array<SessionReplayCustomSignalConfig>;
}

/*
 * One signal of the application's own, counted on one chunk's envelope
 * (SessionReplaySignalCounts.customSignals). frustrationCount is how many of
 * the count were frustration when they happened: a signal changed from
 * marker to frustration halfway through a session counts both ways, as it
 * was recorded.
 */
export interface SessionReplayCustomSignalCount {
  name: string;
  count: number;
  frustrationCount: number;
}

export interface SessionReplayFrustrationNumberLimit {
  min: number;
  max: number;
  defaultValue: number;
}

export interface SessionReplayFrustrationNumberLimits {
  rageClickCount: SessionReplayFrustrationNumberLimit;
  rageClickWindowMs: SessionReplayFrustrationNumberLimit;
  rageClickRadiusPx: SessionReplayFrustrationNumberLimit;
  deadClickTimeoutMs: SessionReplayFrustrationNumberLimit;
  errorClickWindowMs: SessionReplayFrustrationNumberLimit;
  refreshRageReloadCount: SessionReplayFrustrationNumberLimit;
  refreshRageWindowSeconds: SessionReplayFrustrationNumberLimit;
}

/*
 * Every number a rule takes, with its range and default. The defaults are
 * the recorder's numbers from before they could be changed.
 *
 * The ranges keep a rule meaning what its name says: two clicks are a
 * double click, not rage; a reload log holds twelve loads, so ten reloads is
 * as many as it can see; and a dead-click wait past ten seconds is no longer
 * about the click.
 */
export const SESSION_REPLAY_FRUSTRATION_LIMITS: SessionReplayFrustrationNumberLimits =
  {
    rageClickCount: { min: 3, max: 10, defaultValue: 3 },
    rageClickWindowMs: { min: 300, max: 5000, defaultValue: 1000 },
    rageClickRadiusPx: { min: 5, max: 200, defaultValue: 30 },
    deadClickTimeoutMs: { min: 500, max: 10000, defaultValue: 3000 },
    errorClickWindowMs: { min: 100, max: 5000, defaultValue: 1000 },
    refreshRageReloadCount: { min: 2, max: 10, defaultValue: 3 },
    refreshRageWindowSeconds: { min: 10, max: 600, defaultValue: 60 },
  };

export const SESSION_REPLAY_MAX_CUSTOM_SIGNALS: number = 20;
export const SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH: number = 40;
export const SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH: number = 200;

/* track() names are capped at 64 (SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH). */
export const SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH: number = 64;

export const SESSION_REPLAY_MAX_IGNORED_SELECTORS: number = 20;
export const SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH: number = 200;

/*
 * The same signal is not counted twice within a second: a page that throws
 * the same error in a loop, or a button clicked in a burst, is one moment
 * on the timeline, not fifty.
 */
export const SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS: number = 1000;

/*
 * How many signals of its own one chunk counts (and the envelope carries),
 * and how many markers it holds. Twenty names is every signal an
 * application can have; the markers are capped like track() events.
 */
export const SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK: number = 50;

/*
 * How many names a session keeps. A session is one application, so twenty
 * would do - but an application can rename its signals while a session is
 * running, and old names stay on the sessions recorded under them.
 */
export const SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAMES_PER_SESSION: number = 50;

export function getDefaultSessionReplayFrustrationSettings(): SessionReplayFrustrationSettings {
  const limits: SessionReplayFrustrationNumberLimits =
    SESSION_REPLAY_FRUSTRATION_LIMITS;

  return {
    rageClick: {
      isEnabled: true,
      clickCount: limits.rageClickCount.defaultValue,
      windowMs: limits.rageClickWindowMs.defaultValue,
      radiusPx: limits.rageClickRadiusPx.defaultValue,
      ignoreSelectors: [],
    },
    deadClick: {
      isEnabled: true,
      timeoutMs: limits.deadClickTimeoutMs.defaultValue,
      ignoreSelectors: [],
    },
    errorClick: {
      isEnabled: true,
      windowMs: limits.errorClickWindowMs.defaultValue,
    },
    refreshRage: {
      isEnabled: true,
      reloadCount: limits.refreshRageReloadCount.defaultValue,
      windowSeconds: limits.refreshRageWindowSeconds.defaultValue,
    },
    customSignals: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/*
 * A number inside its range, whole. Anything that is not a finite number
 * reads as the default; a number outside the range is pulled into it, so a
 * hand-edited row can never switch a rule into something it cannot mean.
 */
function readLimitedNumber(
  value: unknown,
  limit: SessionReplayFrustrationNumberLimit,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return limit.defaultValue;
  }

  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

/* Trimmed, non-empty, short enough, each once, at most twenty. */
function readSelectorList(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const selectors: Array<string> = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const selector: string = entry.trim();

    if (
      selector.length === 0 ||
      selector.length > SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH ||
      selectors.indexOf(selector) !== -1
    ) {
      continue;
    }

    selectors.push(selector);

    if (selectors.length >= SESSION_REPLAY_MAX_IGNORED_SELECTORS) {
      break;
    }
  }

  return selectors;
}

export function isSessionReplayCustomSignalTrigger(
  value: unknown,
): value is SessionReplayCustomSignalTrigger {
  return (
    typeof value === "string" &&
    SESSION_REPLAY_CUSTOM_SIGNAL_TRIGGERS.indexOf(
      value as SessionReplayCustomSignalTrigger,
    ) !== -1
  );
}

export function getSessionReplayCustomSignalMatchMaxLength(
  trigger: SessionReplayCustomSignalTrigger,
): number {
  return trigger === "event"
    ? SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH
    : SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH;
}

/*
 * A page pattern names a path: it starts with a slash, or with a star that
 * stands for the start of any path. Without either it could never match,
 * because every path starts with one.
 */
export function isSessionReplayPagePatternAnchored(pattern: string): boolean {
  return pattern.charAt(0) === "/" || pattern.charAt(0) === "*";
}

function readCustomSignal(value: unknown): SessionReplayCustomSignal | null {
  const record: Record<string, unknown> = asRecord(value);

  const name: string =
    typeof record["name"] === "string" ? record["name"].trim() : "";
  const trigger: unknown = record["trigger"];
  const match: string =
    typeof record["match"] === "string" ? record["match"].trim() : "";

  if (
    name.length === 0 ||
    name.length > SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH ||
    !isSessionReplayCustomSignalTrigger(trigger) ||
    match.length === 0 ||
    match.length > getSessionReplayCustomSignalMatchMaxLength(trigger) ||
    (trigger === "page" && !isSessionReplayPagePatternAnchored(match))
  ) {
    return null;
  }

  return {
    id:
      typeof record["id"] === "string" && record["id"].length <= 64
        ? record["id"]
        : "",
    name: name,
    trigger: trigger,
    match: match,
    isFrustration: record["isFrustration"] !== false,
    isEnabled: record["isEnabled"] !== false,
  };
}

/*
 * Settings from anything: a stored row (null for the defaults), a config
 * response, a hand-written API body. Never throws. What is missing or
 * unusable reads as its default - a rule as the built-in rule, a custom
 * signal that could not be matched as no signal at all - so a damaged row
 * records what an untouched application records rather than nothing.
 *
 * Writes go through the strict check in
 * Utils/Rum/SessionReplayFrustrationSettingsValidation instead, which says
 * what is wrong rather than repairing it.
 */
export function normalizeSessionReplayFrustrationSettings(
  value: unknown,
): SessionReplayFrustrationSettings {
  const record: Record<string, unknown> = asRecord(value);
  const limits: SessionReplayFrustrationNumberLimits =
    SESSION_REPLAY_FRUSTRATION_LIMITS;

  const rage: Record<string, unknown> = asRecord(record["rageClick"]);
  const dead: Record<string, unknown> = asRecord(record["deadClick"]);
  const errorClick: Record<string, unknown> = asRecord(record["errorClick"]);
  const refresh: Record<string, unknown> = asRecord(record["refreshRage"]);

  const customSignals: Array<SessionReplayCustomSignal> = [];
  const seenNames: Array<string> = [];

  if (Array.isArray(record["customSignals"])) {
    for (const entry of record["customSignals"]) {
      const signal: SessionReplayCustomSignal | null = readCustomSignal(entry);

      if (!signal) {
        continue;
      }

      const key: string = signal.name.toLowerCase();

      if (seenNames.indexOf(key) !== -1) {
        continue;
      }

      seenNames.push(key);
      customSignals.push(signal);

      if (customSignals.length >= SESSION_REPLAY_MAX_CUSTOM_SIGNALS) {
        break;
      }
    }
  }

  return {
    rageClick: {
      isEnabled: rage["isEnabled"] !== false,
      clickCount: readLimitedNumber(rage["clickCount"], limits.rageClickCount),
      windowMs: readLimitedNumber(rage["windowMs"], limits.rageClickWindowMs),
      radiusPx: readLimitedNumber(rage["radiusPx"], limits.rageClickRadiusPx),
      ignoreSelectors: readSelectorList(rage["ignoreSelectors"]),
    },
    deadClick: {
      isEnabled: dead["isEnabled"] !== false,
      timeoutMs: readLimitedNumber(
        dead["timeoutMs"],
        limits.deadClickTimeoutMs,
      ),
      ignoreSelectors: readSelectorList(dead["ignoreSelectors"]),
    },
    errorClick: {
      isEnabled: errorClick["isEnabled"] !== false,
      windowMs: readLimitedNumber(
        errorClick["windowMs"],
        limits.errorClickWindowMs,
      ),
    },
    refreshRage: {
      isEnabled: refresh["isEnabled"] !== false,
      reloadCount: readLimitedNumber(
        refresh["reloadCount"],
        limits.refreshRageReloadCount,
      ),
      windowSeconds: readLimitedNumber(
        refresh["windowSeconds"],
        limits.refreshRageWindowSeconds,
      ),
    },
    customSignals: customSignals,
  };
}

/*
 * What the recorders are sent: the rules as they are, and the signals of the
 * application's own that are switched on, without the ids only the settings
 * page needs.
 */
export function toSessionReplayFrustrationSignalsConfig(
  settings: SessionReplayFrustrationSettings,
): SessionReplayFrustrationSignalsConfig {
  return {
    rageClick: settings.rageClick,
    deadClick: settings.deadClick,
    errorClick: settings.errorClick,
    refreshRage: settings.refreshRage,
    customSignals: settings.customSignals
      .filter((signal: SessionReplayCustomSignal): boolean => {
        return signal.isEnabled;
      })
      .map(
        (
          signal: SessionReplayCustomSignal,
        ): SessionReplayCustomSignalConfig => {
          return {
            name: signal.name,
            trigger: signal.trigger,
            match: signal.match,
            isFrustration: signal.isFrustration,
          };
        },
      ),
  };
}

/*
 * The recorder's read of the config response field, which may be absent
 * (an older server: the defaults) or anything at all.
 */
export function readSessionReplayFrustrationSignalsConfig(
  value: unknown,
): SessionReplayFrustrationSignalsConfig {
  return toSessionReplayFrustrationSignalsConfig(
    normalizeSessionReplayFrustrationSettings(value),
  );
}

/*
 * Lower case, and without the slashes at the end: /Checkout/ and /checkout
 * are the same page to the person who wrote the pattern. The root stays /.
 */
function canonicalPath(path: string): string {
  let end: number = path.length;

  while (end > 1 && path.charAt(end - 1) === "/") {
    end--;
  }

  return path.slice(0, end).toLowerCase();
}

/*
 * Does a page's path match a pattern? A star stands for any run of
 * characters, slashes included; everything else is compared as written,
 * ignoring case and the slashes at the end. /checkout/error matches only
 * that page; /checkout* matches /checkout and every page under it;
 * /orders/x/failed with a star for x matches the failed page of any order;
 * a pattern that starts with a star matches the end of any path.
 *
 * No regular expression is built from the pattern: it is split on its stars
 * and the pieces are found in order, left to right, each search starting
 * where the last one ended. For a pattern of stars only that is exact, it
 * never backtracks, and it reads the path a bounded number of times however
 * the pattern is written - the pattern is the customer's, the path is
 * whatever the visitor's browser is on.
 */
export function matchesSessionReplayPagePattern(
  pattern: string,
  path: string,
): boolean {
  const target: string = canonicalPath(path);
  const pieces: Array<string> = canonicalPath(pattern.trim()).split("*");

  if (pieces.length === 1) {
    return target === pieces[0];
  }

  const first: string = pieces[0] || "";
  const last: string = pieces[pieces.length - 1] || "";

  if (target.slice(0, first.length) !== first) {
    return false;
  }

  let position: number = first.length;

  for (let index: number = 1; index < pieces.length - 1; index++) {
    const piece: string = pieces[index] || "";

    if (piece.length === 0) {
      continue;
    }

    const found: number = target.indexOf(piece, position);

    if (found === -1) {
      return false;
    }

    position = found + piece.length;
  }

  return (
    target.length - position >= last.length &&
    target.slice(target.length - last.length) === last
  );
}

/* Does an error's text contain what a signal looks for? Case is ignored. */
export function matchesSessionReplayErrorText(
  match: string,
  text: string,
): boolean {
  return (
    match.length > 0 && text.toLowerCase().indexOf(match.toLowerCase()) !== -1
  );
}

/* Is this track() name the one a signal looks for? Case is ignored. */
export function matchesSessionReplayEventName(
  match: string,
  name: string,
): boolean {
  return match.trim().toLowerCase() === name.trim().toLowerCase();
}

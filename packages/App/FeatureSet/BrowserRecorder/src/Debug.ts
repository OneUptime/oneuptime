/*
 * Diagnostics for a recorder that is silent by design.
 *
 * Every gate in this package fails CLOSED and says nothing: no init options,
 * a privacy signal, a config fetch that 404s, `enabled: false`, an unsampled
 * session, a consent mode nobody granted, a 401 that trips the circuit
 * breaker. Each of those produces exactly the same thing on the customer's
 * page - no recording, no request, no console output - which is why "session
 * replay is not working" and "session replay is switched off" are
 * indistinguishable from a browser, and why the only diagnostic that existed
 * was a server-side panel that cannot see a recorder which never loaded.
 *
 * This module is that missing half. It is OFF by default (a RUM script must
 * not print into a customer's end users' consoles), and it is turned on
 * per-browser without a redeploy - which matters, because the page that is
 * failing is usually production and the person debugging it cannot ship a
 * new script tag to look at it.
 *
 * Two rules keep it honest:
 *
 * 1. RECORDS ARE ALWAYS KEPT, output is what the switch gates. The ring is
 *    bounded and every call site is a cold path (startup, a config fetch, a
 *    chunk boundary - never the rrweb event hot path), so a support engineer
 *    can ask for `OneUptimeReplay.getDiagnostics()` on a page where nobody
 *    thought to turn logging on first, and get the whole timeline back.
 *
 * 2. NO PAGE CONTENT, EVER. `DebugDetail` admits only primitives, values are
 *    truncated, and non-primitives handed in by untyped JavaScript are
 *    dropped rather than stringified. A diagnostic channel that could carry
 *    a DOM node or an unscrubbed URL would be a second, unmasked egress path
 *    for exactly the data the rest of this package exists to protect.
 *
 * The state lives on a global rather than in module scope because the loader
 * stub and the artifact are two separate bundles with two separate module
 * instances. Without sharing, the artifact's `getDiagnostics()` would be
 * missing precisely the records that matter most - everything the stub
 * decided before the artifact existed.
 */

/* Shared by both bundles. See the note above. */
const STATE_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_DEBUG__";

/* Read before anything else, so a reload keeps logging without a code change. */
export const DEBUG_STORAGE_KEY: string = "oneuptime.sessionReplay.debug";

/* `?oneuptime_debug=1`, also honoured in the fragment. */
export const DEBUG_QUERY_PARAM: string = "oneuptime_debug";

/* The init global, read here as well as in Config so it works pre-tag. */
const INIT_OPTIONS_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY__";

/*
 * Exported so ConsoleRecorder can recognise - and refuse to record - the
 * recorder's own diagnostics. Debug writes through console.warn/info, which
 * ConsoleRecorder patches, so with diagnostics on every line below used to
 * land in the customer's replay as a console entry, masked and truncated by
 * our own recorder, and eat the per-page console cap along the way.
 */
export const LOG_PREFIX: string = "[OneUptime Session Replay]";

/* What every `code` below means, and what to do about it. */
export const DEBUG_DOCS_URL: string =
  "https://oneuptime.com/docs/rum/session-replay-troubleshooting";

/*
 * Bounded because this survives for the life of the page. 250 entries is
 * several minutes of a badly behaved session and a few hundred bytes.
 */
export const MAX_DEBUG_RECORDS: number = 250;

/* Long enough for a URL or a reason code, short enough not to hold a body. */
export const MAX_DEBUG_VALUE_LENGTH: number = 256;

/*
 * Matches `oneuptime_debug`, `oneuptime_debug=1` and `oneuptime_debug=true`
 * in a query string or a fragment. An explicit `=0` / `=false` does NOT
 * match, so a link can turn it on and a later one can leave it off.
 */
const DEBUG_QUERY_PATTERN: RegExp =
  /(^|[?&#])oneuptime_debug(=(1|true|yes|on))?($|[&#])/i;

const TRUTHY: RegExp = /^(1|true|yes|on)$/i;

/* Only primitives. See rule 2 above - this type IS the privacy boundary. */
export type DebugDetailValue = string | number | boolean | null;
export type DebugDetail = Record<string, DebugDetailValue>;

export type DebugLevel = "info" | "warn";

export interface DebugRecord {
  atUnixMs: number;
  level: DebugLevel;

  /*
   * Stable kebab-case identifier. This is what a support ticket quotes and
   * what the docs index, so it is part of the contract in a way the prose
   * message is not.
   */
  code: string;

  message: string;
  detail?: DebugDetail;
}

interface DebugState {
  enabled: boolean;

  /* Whether the ambient switches have been consulted yet. */
  resolved: boolean;

  /* How it got switched on, for the "why am I seeing this" line. */
  source: string;

  records: Array<DebugRecord>;
}

function getState(): DebugState {
  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  const existing: unknown = globalRecord[STATE_GLOBAL];

  /*
   * Shape-checked rather than trusted: this is a well-known global name on a
   * page we do not control, and a host script that parked a string there must
   * not be able to break the recorder's startup.
   */
  if (
    existing &&
    typeof existing === "object" &&
    Array.isArray((existing as Record<string, unknown>)["records"])
  ) {
    return existing as unknown as DebugState;
  }

  const state: DebugState = {
    enabled: false,
    resolved: false,
    source: "",
    records: [],
  };

  /*
   * A page that froze globalThis makes this assignment throw in strict mode.
   * The state is then per-module rather than shared, which costs the
   * one-timeline property and nothing else - and is emphatically better than
   * throwing out of the loader's first statement.
   */
  try {
    globalRecord[STATE_GLOBAL] = state;
  } catch {
    /* Not shareable. Still perfectly usable. */
  }

  return state;
}

/*
 * Read a property off the global object without ever throwing.
 *
 * `window.localStorage` throws SecurityError ON THE ACCESSOR - not on
 * getItem - in a sandboxed iframe without allow-same-origin and wherever the
 * user has blocked site data for the origin. Guarding only the getItem call
 * is therefore not enough, and the distinction is not theoretical: the first
 * statement of the loader asks whether diagnostics are on, so a throw here
 * would take the whole recorder down on those pages - silently, which is the
 * exact failure this module exists to end.
 */
function readGlobalProperty(
  record: Record<string, unknown>,
  key: string,
): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

/*
 * And getItem throws separately, in Safari's private mode and wherever site
 * data is blocked. A diagnostics switch must never be the thing that breaks
 * the page it was turned on to debug.
 */
function readStorageFlag(storage: unknown): boolean {
  try {
    if (!storage || typeof storage !== "object") {
      return false;
    }

    const getItem: unknown = (storage as Record<string, unknown>)["getItem"];

    if (typeof getItem !== "function") {
      return false;
    }

    const value: unknown = (
      storage as unknown as { getItem: (key: string) => string | null }
    ).getItem(DEBUG_STORAGE_KEY);

    return typeof value === "string" && TRUTHY.test(value);
  } catch {
    return false;
  }
}

function readQueryFlag(locationRef: unknown): boolean {
  try {
    if (!locationRef || typeof locationRef !== "object") {
      return false;
    }

    const location: Record<string, unknown> = locationRef as Record<
      string,
      unknown
    >;

    const search: unknown = location["search"];
    const hash: unknown = location["hash"];

    return (
      (typeof search === "string" && DEBUG_QUERY_PATTERN.test(search)) ||
      (typeof hash === "string" && DEBUG_QUERY_PATTERN.test(hash))
    );
  } catch {
    return false;
  }
}

function readInitGlobalFlag(windowRecord: Record<string, unknown>): boolean {
  const raw: unknown = windowRecord[INIT_OPTIONS_GLOBAL];

  if (!raw || typeof raw !== "object") {
    return false;
  }

  const value: unknown = (raw as Record<string, unknown>)["debug"];

  /* Same spellings Config.readBooleanOption accepts on the script tag. */
  return value === true || (typeof value === "string" && TRUTHY.test(value));
}

/*
 * Consult the ambient switches once.
 *
 * Deliberately NOT including the script tag's data-oneuptime-debug attribute:
 * that one is read by Config alongside the rest of the init options and
 * applied through setEnabled(), because reading it here would mean a second
 * document-wide querySelector on every page load for a feature that is off
 * on virtually all of them.
 */
function resolve(state: DebugState): void {
  if (state.resolved) {
    return;
  }

  state.resolved = true;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  if (readInitGlobalFlag(globalRecord)) {
    setEnabled(true, "init-global");
    return;
  }

  if (readQueryFlag(readGlobalProperty(globalRecord, "location"))) {
    setEnabled(true, "query-param");
    return;
  }

  if (readStorageFlag(readGlobalProperty(globalRecord, "localStorage"))) {
    setEnabled(true, "local-storage");
    return;
  }

  if (readStorageFlag(readGlobalProperty(globalRecord, "sessionStorage"))) {
    setEnabled(true, "session-storage");
  }
}

export function isDebugEnabled(): boolean {
  const state: DebugState = getState();

  resolve(state);

  return state.enabled;
}

/*
 * Turn logging on (or off) explicitly.
 *
 * Enabling FLUSHES the backlog to the console, which is the whole reason the
 * ring is kept while disabled: the server-driven switch and the script tag
 * attribute both arrive after the loader has already made several decisions,
 * and those earlier decisions are usually the answer.
 */
export function setEnabled(enabled: boolean, source: string): void {
  const state: DebugState = getState();

  /* An explicit call is itself a resolution; do not let resolve() undo it. */
  state.resolved = true;

  if (!enabled) {
    state.enabled = false;
    state.source = "";
    return;
  }

  if (state.enabled) {
    return;
  }

  state.enabled = true;
  state.source = source;

  writeToConsole({
    atUnixMs: Date.now(),
    level: "info",

    /*
     * Printed once, not per line. Every message below is deliberately short
     * - this bundle is downloaded by every visitor to a customer's site, and
     * a paragraph of remediation prose per call site is measured in
     * kilobytes of gzip on somebody else's Core Web Vitals. The `code` on
     * each record is the stable identifier, and the page below explains
     * every one of them in full.
     */
    code: "debug-enabled",
    message: `Diagnostics on (${source}). Codes: ${DEBUG_DOCS_URL} — off: localStorage.removeItem("${DEBUG_STORAGE_KEY}")`,
  });

  for (const record of state.records) {
    writeToConsole(record);
  }
}

export function getDebugSource(): string {
  return getState().source;
}

/*
 * Everything recorded so far, oldest first. Handed straight to a support
 * ticket, so it is a copy: a caller must not be able to mutate the timeline.
 */
export function getDebugRecords(): Array<DebugRecord> {
  return getState().records.slice();
}

export function clearDebugRecords(): void {
  getState().records.length = 0;
}

/*
 * Drop everything that is not a primitive, and truncate what is left.
 *
 * Untyped JavaScript can call into this (the public API is on a global), and
 * `String(value)` on a DOM node or a fetch Response would put page content
 * into a channel that has no masking of its own. Dropping is the only safe
 * default.
 */
function redact(detail: DebugDetail): DebugDetail {
  const safe: DebugDetail = {};

  for (const key of Object.keys(detail)) {
    const value: unknown = detail[key];

    if (value === null) {
      safe[key] = null;
      continue;
    }

    if (typeof value === "boolean") {
      safe[key] = value;
      continue;
    }

    if (typeof value === "number") {
      safe[key] = Number.isFinite(value) ? value : String(value);
      continue;
    }

    if (typeof value === "string") {
      safe[key] =
        value.length > MAX_DEBUG_VALUE_LENGTH
          ? `${value.slice(0, MAX_DEBUG_VALUE_LENGTH)}…`
          : value;
      continue;
    }

    /*
     * undefined, objects, arrays, functions, symbols. Named rather than
     * omitted so a missing key reads as "not supplied" and this reads as
     * "supplied, and refused".
     */
    if (value !== undefined) {
      safe[key] = `<${typeof value} omitted>`;
    }
  }

  return safe;
}

function writeToConsole(record: DebugRecord): void {
  /*
   * console is not ours: a page may have replaced it, frozen it, or removed
   * a method. Diagnostics must never throw into the customer's page.
   */
  try {
    const consoleRef: unknown = (
      globalThis as unknown as Record<string, unknown>
    )["console"];

    if (!consoleRef || typeof consoleRef !== "object") {
      return;
    }

    const method: unknown = (consoleRef as Record<string, unknown>)[
      record.level === "warn" ? "warn" : "info"
    ];

    if (typeof method !== "function") {
      return;
    }

    const line: string = `${LOG_PREFIX} ${record.code}: ${record.message}`;

    if (record.detail) {
      // eslint-disable-next-line no-console
      (method as (...args: Array<unknown>) => void).call(
        consoleRef,
        line,
        record.detail,
      );
      return;
    }

    // eslint-disable-next-line no-console
    (method as (...args: Array<unknown>) => void).call(consoleRef, line);
  } catch {
    /* A console that throws is not a reason to stop recording. */
  }
}

function push(
  level: DebugLevel,
  code: string,
  message: string,
  detail?: DebugDetail,
): void {
  const state: DebugState = getState();

  resolve(state);

  const record: DebugRecord = {
    atUnixMs: Date.now(),
    level: level,
    code: code,
    message: message,
  };

  if (detail) {
    /*
     * redact reads every value on the object it is handed. Everything this
     * module is called with is a literal built a line above the call, so
     * there is nothing here that can throw today - but the whole package's
     * rule is that instrumentation never throws into the customer's page,
     * and a diagnostic that took a host page down while somebody was
     * debugging it would be the worst possible way to learn otherwise.
     */
    try {
      record.detail = redact(detail);
    } catch {
      record.detail = { detail: "<unreadable>" };
    }
  }

  state.records.push(record);

  /*
   * Drop the OLDEST. A long-lived tab's most recent decisions are the ones
   * that explain what it is doing now.
   */
  while (state.records.length > MAX_DEBUG_RECORDS) {
    state.records.shift();
  }

  if (state.enabled) {
    writeToConsole(record);
  }
}

/* A step that went as intended. */
export function debugLog(
  code: string,
  message: string,
  detail?: DebugDetail,
): void {
  push("info", code, message, detail);
}

/*
 * A step that stopped, degraded, or silently changed the policy the server
 * sent. Everything a customer chasing "replay is not working" is looking for
 * is a warn.
 */
export function debugWarn(
  code: string,
  message: string,
  detail?: DebugDetail,
): void {
  push("warn", code, message, detail);
}

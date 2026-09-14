import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  REPLAY_RAIL_TAB_IDS,
  ParsedReplaySignalId,
  ReplayRailTabId,
  parseReplaySignalId,
} from "./Rail/ReplaySignalTypes";

/*
 * The player's URL model, in one place.
 *
 *   ?t=<seconds>        the playhead as an offset from the recording's start.
 *                       Decimals are READ (an old link or a hand-edited URL
 *                       may carry "41.2") but only whole seconds are WRITTEN:
 *                       sub-second precision would imply an exactness the
 *                       seek anchors cannot deliver.
 *   ?at=<unixMs>        an absolute moment. Written by every inbound link
 *                       (a log line, a span, an exception occurrence) because
 *                       the caller knows the wall clock but not the session's
 *                       start; the player converts with header.startTimeUnixMs.
 *                       When both are present `at` wins - it is the more
 *                       specific statement of intent.
 *   &tab=<tabId>        which browser tab of a multi-tab recording to show.
 *   &rail=<railTab>     which rail tab is open.
 *   &signal=<kind:id>   the rail row to select and expand on load; without
 *                       t/at the player seeks to its offset minus a short
 *                       pre-roll.
 *   &q=<search>         the rail's search box.
 *
 * t / signal are what "Copy link at this moment" and every inbound builder
 * write; rail / q / tab are replaceState'd as the viewer changes them. The
 * parser is deliberately forgiving: a URL is untrusted input, and a bad
 * value drops to "absent" rather than throwing out of a page load.
 *
 * Everything but buildReplayMomentRoute is pure. The route builder pulls in
 * RouteMap so callers on other pages (a log row, a span panel) need no
 * route plumbing of their own to link into a moment.
 */

export const REPLAY_URL_PARAM_OFFSET: string = "t";
export const REPLAY_URL_PARAM_AT: string = "at";
export const REPLAY_URL_PARAM_TAB: string = "tab";
export const REPLAY_URL_PARAM_RAIL: string = "rail";
export const REPLAY_URL_PARAM_SIGNAL: string = "signal";
export const REPLAY_URL_PARAM_RAIL_SEARCH: string = "q";

export const REPLAY_URL_PARAM_NAMES: ReadonlyArray<string> = [
  REPLAY_URL_PARAM_OFFSET,
  REPLAY_URL_PARAM_AT,
  REPLAY_URL_PARAM_TAB,
  REPLAY_URL_PARAM_RAIL,
  REPLAY_URL_PARAM_SIGNAL,
  REPLAY_URL_PARAM_RAIL_SEARCH,
];

/*
 * How far before a moment an inbound link lands. A log line or a span is
 * best understood with a second of run-up; an exception wants the ten
 * seconds of interaction that led to it.
 */
export const REPLAY_MOMENT_PRE_ROLL_MS: number = 1000;
export const REPLAY_EXCEPTION_PRE_ROLL_MS: number = 10 * 1000;

/* A ?signal= without t/at seeks to the row's offset minus this. */
export const REPLAY_SIGNAL_PRE_ROLL_MS: number = 1000;

/*
 * Caps on free text lifted from the URL. A rail search longer than this is
 * not a search, and a tab id is a short recorder-minted token.
 */
export const REPLAY_URL_RAIL_SEARCH_MAX_LENGTH: number = 200;
export const REPLAY_URL_TAB_ID_MAX_LENGTH: number = 64;

/*
 * Short forms accepted on the way IN. The design's URL grammar spells two
 * tabs briefly (nav, perf); the rail's canonical ids are the long forms, so
 * both are read and only the canonical one is ever written.
 */
const RAIL_TAB_ALIASES: Record<string, ReplayRailTabId> = {
  nav: "navigation",
  perf: "performance",
  interact: "interactions",
  interaction: "interactions",
  error: "errors",
  log: "logs",
  trace: "traces",
  net: "network",
};

/* Whole or decimal seconds, no sign, no exponent. */
const OFFSET_PARAM_PATTERN: RegExp = /^\d+(\.\d+)?$/;

/* Unix milliseconds: digits only, and no more than a safe integer holds. */
const AT_PARAM_PATTERN: RegExp = /^\d{1,16}$/;

export interface ReplayPlayerUrlState {
  /* From ?t, in milliseconds. null when absent or unreadable. */
  offsetMs: number | null;
  /* From ?at. null when absent or unreadable. */
  atUnixMs: number | null;
  tabId: string | null;
  railTab: ReplayRailTabId | null;
  /* Validated against the four signal id shapes; null otherwise. */
  signalId: string | null;
  railSearch: string | null;
}

export function makeEmptyReplayPlayerUrlState(): ReplayPlayerUrlState {
  return {
    offsetMs: null,
    atUnixMs: null,
    tabId: null,
    railTab: null,
    signalId: null,
    railSearch: null,
  };
}

function toSearchParams(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams {
  if (search instanceof URLSearchParams) {
    return new URLSearchParams(search);
  }

  if (typeof search !== "string") {
    return new URLSearchParams();
  }

  /*
   * Accept a full href, a "?a=b" search string or a bare "a=b": links get
   * pasted around and the parser should not care which form it was handed.
   */
  const questionMark: number = search.indexOf("?");
  const raw: string =
    questionMark >= 0 ? search.slice(questionMark + 1) : search;
  const hash: number = raw.indexOf("#");

  return new URLSearchParams(hash >= 0 ? raw.slice(0, hash) : raw);
}

/*
 * ?t=41.2 -> 41200. Whole seconds and decimals both read; anything that is
 * not a finite non-negative number is treated as absent.
 */
export function parseReplayOffsetParam(value: string | null): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0 || !OFFSET_PARAM_PATTERN.test(trimmed)) {
    return null;
  }

  const seconds: number = Number(trimmed);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  return Math.round(seconds * 1000);
}

/*
 * ?at=1757000000000 -> 1757000000000. Only an integer unix-millisecond
 * value: an ISO string would need timezone handling this URL does not want
 * to own, and every builder in the codebase writes milliseconds.
 */
export function parseReplayAtParam(value: string | null): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (!AT_PARAM_PATTERN.test(trimmed)) {
    return null;
  }

  const unixMs: number = Number(trimmed);

  return Number.isSafeInteger(unixMs) && unixMs > 0 ? unixMs : null;
}

export function normalizeReplayRailTabId(
  value: string | null | undefined,
): ReplayRailTabId | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim().toLowerCase();

  if (trimmed.length === 0) {
    return null;
  }

  if ((REPLAY_RAIL_TAB_IDS as ReadonlyArray<string>).includes(trimmed)) {
    return trimmed as ReplayRailTabId;
  }

  return RAIL_TAB_ALIASES[trimmed] || null;
}

function normalizeSignalId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return parseReplaySignalId(trimmed) ? trimmed : null;
}

function normalizeTabId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0 || trimmed.length > REPLAY_URL_TAB_ID_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

function normalizeRailSearch(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, REPLAY_URL_RAIL_SEARCH_MAX_LENGTH);
}

export function parseReplayPlayerUrlState(
  search: string | URLSearchParams | null | undefined,
): ReplayPlayerUrlState {
  const params: URLSearchParams = toSearchParams(search);

  return {
    offsetMs: parseReplayOffsetParam(params.get(REPLAY_URL_PARAM_OFFSET)),
    atUnixMs: parseReplayAtParam(params.get(REPLAY_URL_PARAM_AT)),
    tabId: normalizeTabId(params.get(REPLAY_URL_PARAM_TAB)),
    railTab: normalizeReplayRailTabId(params.get(REPLAY_URL_PARAM_RAIL)),
    signalId: normalizeSignalId(params.get(REPLAY_URL_PARAM_SIGNAL)),
    railSearch: normalizeRailSearch(params.get(REPLAY_URL_PARAM_RAIL_SEARCH)),
  };
}

/*
 * The query string (no leading "?") for a state. Every one of the six
 * player keys is rewritten from `state` - present ones set, absent ones
 * removed - while any OTHER key already in `base` survives untouched, so a
 * replaceState from the player cannot strip a parameter another feature
 * put on the page.
 */
export function serializeReplayPlayerUrlState(
  state: Partial<ReplayPlayerUrlState>,
  base?: string | URLSearchParams | null,
): string {
  const params: URLSearchParams = toSearchParams(base);

  for (const name of REPLAY_URL_PARAM_NAMES) {
    params.delete(name);
  }

  if (
    typeof state.offsetMs === "number" &&
    Number.isFinite(state.offsetMs) &&
    state.offsetMs >= 0
  ) {
    params.set(
      REPLAY_URL_PARAM_OFFSET,
      String(Math.floor(state.offsetMs / 1000)),
    );
  }

  if (
    typeof state.atUnixMs === "number" &&
    Number.isFinite(state.atUnixMs) &&
    state.atUnixMs > 0
  ) {
    params.set(REPLAY_URL_PARAM_AT, String(Math.round(state.atUnixMs)));
  }

  const tabId: string | null = normalizeTabId(state.tabId);

  if (tabId) {
    params.set(REPLAY_URL_PARAM_TAB, tabId);
  }

  const railTab: ReplayRailTabId | null = normalizeReplayRailTabId(
    state.railTab,
  );

  if (railTab) {
    params.set(REPLAY_URL_PARAM_RAIL, railTab);
  }

  const signalId: string | null = normalizeSignalId(state.signalId);

  if (signalId) {
    params.set(REPLAY_URL_PARAM_SIGNAL, signalId);
  }

  const railSearch: string | null = normalizeRailSearch(state.railSearch);

  if (railSearch) {
    params.set(REPLAY_URL_PARAM_RAIL_SEARCH, railSearch);
  }

  return params.toString();
}

export type ReplayInitialMomentSource = "at" | "t" | "signal" | "none";

export interface ReplayInitialMoment {
  offsetMs: number;
  source: ReplayInitialMomentSource;
  /*
   * The requested moment fell outside the recording and was pulled to its
   * nearest edge. The player shows a transient notice for this so a link
   * that lands at 0:00 is not mistaken for a link that carried no moment.
   */
  wasClamped: boolean;
}

function clampOffset(
  offsetMs: number,
  durationMs: number | null | undefined,
): { offsetMs: number; wasClamped: boolean } {
  let clamped: number = Math.max(0, offsetMs);

  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    clamped > durationMs
  ) {
    clamped = durationMs;
  }

  return { offsetMs: clamped, wasClamped: clamped !== offsetMs };
}

/*
 * Where the player should open, from the URL state plus what the manifest
 * knows. Precedence: at (needs startTimeUnixMs to convert) > t > the
 * selected signal's own offset minus a pre-roll > the start.
 *
 * An `at` with no known start time cannot be converted and falls through
 * to `t` rather than being silently treated as an offset.
 */
export function resolveReplayInitialMoment(args: {
  state: ReplayPlayerUrlState;
  startTimeUnixMs: number | null | undefined;
  durationMs: number | null | undefined;
  /* The offset of the row ?signal= named, once the rail has resolved it. */
  signalOffsetMs?: number | null | undefined;
}): ReplayInitialMoment {
  const { state } = args;

  if (
    state.atUnixMs !== null &&
    typeof args.startTimeUnixMs === "number" &&
    Number.isFinite(args.startTimeUnixMs)
  ) {
    const clamped: { offsetMs: number; wasClamped: boolean } = clampOffset(
      state.atUnixMs - args.startTimeUnixMs,
      args.durationMs,
    );

    return { ...clamped, source: "at" };
  }

  if (state.offsetMs !== null) {
    const clamped: { offsetMs: number; wasClamped: boolean } = clampOffset(
      state.offsetMs,
      args.durationMs,
    );

    return { ...clamped, source: "t" };
  }

  if (
    state.signalId !== null &&
    typeof args.signalOffsetMs === "number" &&
    Number.isFinite(args.signalOffsetMs)
  ) {
    const clamped: { offsetMs: number; wasClamped: boolean } = clampOffset(
      args.signalOffsetMs - REPLAY_SIGNAL_PRE_ROLL_MS,
      args.durationMs,
    );

    /*
     * Landing a second early is the intent, not a clamp; only report a
     * clamp when the row itself sits outside the recording.
     */
    return {
      offsetMs: clamped.offsetMs,
      source: "signal",
      wasClamped:
        args.signalOffsetMs < 0 ||
        (typeof args.durationMs === "number" &&
          Number.isFinite(args.durationMs) &&
          args.signalOffsetMs > args.durationMs),
    };
  }

  return { offsetMs: 0, source: "none", wasClamped: false };
}

/*
 * What a ?signal= id points at, in words. Used both by the notice the
 * player shows on arrival and by the audit reason it sends with the
 * manifest request, so the two can never disagree about where a viewer
 * came from.
 */
export function describeReplaySignalSource(
  signal: string | null | undefined,
): string {
  const parsed: ParsedReplaySignalId | null = signal
    ? parseReplaySignalId(signal.trim())
    : null;

  if (!parsed) {
    return "moment";
  }

  switch (parsed.source) {
    case "log":
      return "log line";
    case "span":
      return "span";
    case "exc":
      return "exception";
    case "rec":
    default:
      return "recorded moment";
  }
}

/*
 * The transient notice for a link that carried a moment.
 *
 * ux-08: every ?at= link used to announce "the linked log line" whatever
 * it came from, which made a viewer arriving from a span or an exception
 * doubt they had landed in the right place - and the exception case is
 * doubly confusing, because the builder deliberately rewinds ten seconds
 * so the run-up is on screen. The noun now comes from the signal id, and
 * the exception case says why the picture is a few seconds early.
 */
export function describeReplayMomentNotice(args: {
  wasClamped: boolean;
  signal?: string | null | undefined;
}): string {
  if (args.wasClamped) {
    return "The linked moment is outside this recording; opened at the nearest edge";
  }

  const parsed: ParsedReplaySignalId | null = args.signal
    ? parseReplaySignalId(args.signal.trim())
    : null;

  if (!parsed) {
    return "Opened at the linked moment";
  }

  if (parsed.source === "exc") {
    return "Opened at the linked exception; exception links start 10s earlier so the run-up is on screen";
  }

  return `Opened at the moment of the linked ${describeReplaySignalSource(
    args.signal,
  )}`;
}

/* Audit reasons are stored verbatim; a URL is untrusted input. */
export const REPLAY_ACCESS_REASON_MAX_LENGTH: number = 200;

/*
 * Why this playback was opened, for the audit row the /manifest request
 * writes (ux-12 / integration-004). Derived from the inbound URL rather
 * than asked of the viewer: a cross-link already states its provenance,
 * and a reason nobody types is a reason nobody records.
 *
 * null for a plain open from the list - the audit page renders that as
 * "None given (opened from the list)" rather than inventing a reason.
 */
export function describeReplayAccessReason(
  state: ReplayPlayerUrlState,
): string | null {
  const parsed: ParsedReplaySignalId | null = state.signalId
    ? parseReplaySignalId(state.signalId)
    : null;

  let reason: string | null = null;

  if (parsed) {
    switch (parsed.source) {
      case "log":
        reason = `Opened from log ${parsed.id}`;
        break;
      case "span":
        reason = `Opened from span ${parsed.id}`;
        break;
      case "exc":
        reason = `Opened from exception occurrence ${parsed.id}`;
        break;
      case "rec":
      default:
        reason = "Opened from a link to a recorded moment";
        break;
    }
  } else if (state.atUnixMs !== null || state.offsetMs !== null) {
    reason = "Opened from a link to a moment in this session";
  }

  return reason === null
    ? null
    : reason.slice(0, REPLAY_ACCESS_REASON_MAX_LENGTH);
}

/* The default run-up for a link into a moment, by what the link points at. */
export function getReplayMomentPreRollMs(
  signal: string | null | undefined,
): number {
  const parsed: ParsedReplaySignalId | null = signal
    ? parseReplaySignalId(signal.trim())
    : null;

  return parsed && parsed.source === "exc"
    ? REPLAY_EXCEPTION_PRE_ROLL_MS
    : REPLAY_MOMENT_PRE_ROLL_MS;
}

export interface ReplayMomentRouteArgs {
  rumApplicationId: ObjectID | string | null | undefined;
  sessionId: string | null | undefined;
  /* An absolute moment: a Date or unix milliseconds. Wins over `t`. */
  at?: Date | number | null | undefined;
  /* An offset into the recording, in milliseconds. */
  t?: number | null | undefined;
  signal?: string | null | undefined;
  rail?: ReplayRailTabId | string | null | undefined;
  tab?: string | null | undefined;
  q?: string | null | undefined;
  /*
   * Override the pre-roll (0 to land exactly on the moment). Defaults to
   * ten seconds for an exception signal and one second otherwise.
   */
  preRollMs?: number | undefined;
}

function toUnixMs(value: Date | number | null | undefined): number | null {
  if (value instanceof Date) {
    const time: number = value.getTime();

    return Number.isFinite(time) && time > 0 ? time : null;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return null;
}

/*
 * The query parameters of a link into a moment, pre-roll and clamping
 * applied. Pure: the route itself is added by buildReplayMomentRoute. A
 * caller passing both `at` and `t` gets `at` only - writing both would just
 * be resolved back to `at` by the player and confuse anyone reading the
 * link.
 */
export function buildReplayMomentQueryParams(
  args: ReplayMomentRouteArgs,
): Dictionary<string> {
  const params: Dictionary<string> = {};
  const signalId: string | null = normalizeSignalId(args.signal);
  const preRollMs: number =
    typeof args.preRollMs === "number" &&
    Number.isFinite(args.preRollMs) &&
    args.preRollMs >= 0
      ? args.preRollMs
      : getReplayMomentPreRollMs(signalId);

  const atUnixMs: number | null = toUnixMs(args.at);

  if (atUnixMs !== null) {
    params[REPLAY_URL_PARAM_AT] = String(Math.max(0, atUnixMs - preRollMs));
  } else if (
    typeof args.t === "number" &&
    Number.isFinite(args.t) &&
    args.t >= 0
  ) {
    params[REPLAY_URL_PARAM_OFFSET] = String(
      Math.floor(Math.max(0, args.t - preRollMs) / 1000),
    );
  }

  if (signalId) {
    params[REPLAY_URL_PARAM_SIGNAL] = signalId;
  }

  const railTab: ReplayRailTabId | null = normalizeReplayRailTabId(args.rail);

  if (railTab) {
    params[REPLAY_URL_PARAM_RAIL] = railTab;
  }

  const tabId: string | null = normalizeTabId(args.tab);

  if (tabId) {
    params[REPLAY_URL_PARAM_TAB] = tabId;
  }

  const railSearch: string | null = normalizeRailSearch(args.q);

  if (railSearch) {
    params[REPLAY_URL_PARAM_RAIL_SEARCH] = railSearch;
  }

  return params;
}

/*
 * The player route for a moment in a session, or null when either id is
 * missing - every telemetry row that predates the recorder carries an
 * empty session id, and a dead link is worse than no link.
 */
export function buildReplayMomentRoute(
  args: ReplayMomentRouteArgs,
): Route | null {
  const sessionId: string = (args.sessionId || "").trim();
  const rumApplicationId: string = args.rumApplicationId
    ? args.rumApplicationId.toString().trim()
    : "";

  if (sessionId.length === 0 || rumApplicationId.length === 0) {
    return null;
  }

  let route: Route;

  try {
    route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
      { modelId: rumApplicationId, subModelId: sessionId },
    );
  } catch {
    /*
     * Route validation rejects a value it cannot encode. These builders run
     * inside row renderers, where "no link" is survivable and an exception
     * out of render is not.
     */
    return null;
  }

  const params: Dictionary<string> = buildReplayMomentQueryParams(args);
  const keys: Array<string> = Object.keys(params);

  if (keys.length === 0) {
    return route;
  }

  /*
   * Route.addQueryParams appends values verbatim, so they are encoded here;
   * URLSearchParams on the reading side decodes them back (":" in a signal
   * id, spaces in a rail search).
   */
  const encoded: Dictionary<string> = {};

  for (const key of keys) {
    encoded[key] = encodeURIComponent(params[key] as string);
  }

  try {
    return new Route(route.toString()).addQueryParams(encoded);
  } catch {
    return null;
  }
}

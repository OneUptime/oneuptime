import {
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
} from "./DropFilterSampling";
import {
  getEmptyTelemetryFieldReadersByKind,
  readTelemetryFieldReaders,
  SecurityEventsTelemetrySource,
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldReaderKind,
  TelemetryFieldReadersByKind,
  TelemetryFieldReadersOfKind,
  TelemetryFieldSignal,
} from "./TelemetryFieldReaders";

/*
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE, AS AN ANSWER SAYS IT (#10436).
 *
 * A drop filter keeps the records its query matches from being stored; a
 * sample filter keeps only a share of them. OneUptime suggests both to save
 * money, and makes some itself (the OpenStack defaults). So before one is
 * saved or turned on, the server says what it would take
 * (Server/Utils/Telemetry/DropFilterImpact):
 *
 *   - how many of the last day's records it matches, and of those how many
 *     Security Events read, where it reads that signal;
 *   - the monitors, dashboards, saved views, recording rules and SLOs whose
 *     queries can read the same records (the readers lookup of #10433,
 *     asked whether each query overlaps the filter's);
 *   - for a sample, Security Events' rules that fire at a count, and the
 *     count each then needs of what the sample keeps.
 *
 * The form, a filter's Enable and the API read this one shape; the
 * Dashboard reads it defensively (readDropFilterImpact).
 */

export const DROP_FILTER_IMPACT_API_PATH: string =
  "/telemetry/drop-filter-impact";

// How far back the records a filter matches are counted.
export const DROP_FILTER_IMPACT_LOOKBACK_IN_HOURS: number = 24;

export enum DropFilterImpactAction {
  Drop = "drop",
  Sample = "sample",
}

// A filter being written or turned on, as its form or a saved row holds it.
export interface DropFilterImpactRequest {
  signal: TelemetryFieldSignal;
  filterQuery: string;
  action: DropFilterImpactAction | string;
  samplePercentage?: number | null | undefined;
  // Its name: one of OneUptime's own defaults is known by its name and query.
  name?: string | undefined;
}

export enum DropFilterRecordCountState {
  Counted = "counted",
  // The count ran out of its time and was stopped.
  TimedOut = "timedOut",
  // The records could not be read just now.
  Failed = "failed",
  // The person may not read these records: they are not counted for them.
  NotPermitted = "notPermitted",
}

export interface DropFilterRecordCount {
  state: DropFilterRecordCountState;
  lookbackInHours: number;
  // The records of the window, of the services counted.
  total: number;
  // Of those, the ones the filter's query matches.
  matched: number;
  // Of the matched, the ones Security Events read; null when it reads none of this signal.
  securityEventsRead: number | null;
  // Counted over only the services whose records the person may read.
  isScoped: boolean;
  // How long the count may run, in seconds: what a timed-out count says.
  timeLimitInSeconds: number;
}

// A Security Events rule that fires once a group reaches a count in its window.
export interface DropFilterThresholdRule {
  id: string;
  name: string;
  threshold: number;
  windowInMinutes: number;
  // About how many it takes to fire when only the sample's share is kept.
  neededWhenSampled: number;
  // It counts different values (accounts, addresses) rather than events.
  countsDistinct: boolean;
}

export interface DropFilterThresholdRules {
  // Those the person may read, by name.
  rules: Array<DropFilterThresholdRule>;
  // How many more they may not read: counted, never named.
  hiddenCount: number;
  // False when the rules could not be read just now.
  isChecked: boolean;
}

export interface DropFilterSecurityEvents {
  // False when whether Security Events reads this signal could not be told.
  isChecked: boolean;
  // The scans that read the signal: none when Security Events reads none of it.
  sources: Array<SecurityEventsTelemetrySource>;
  // For a sample of records Security Events reads: its rules that fire at a count.
  thresholdRules: DropFilterThresholdRules;
  /*
   * One of OneUptime's own filters, as it made it: it keeps the lines
   * Security Events reads (OpenStackLogDefaults), so it takes none of them.
   */
  keepsWhatSecurityEventsReads: boolean;
}

export interface DropFilterImpact {
  signal: TelemetryFieldSignal;
  action: DropFilterImpactAction;
  // The share of matching records kept: 0 for Drop.
  keepPercentage: number;
  // False for a query that cannot be read, which drops nothing.
  isQueryReadable: boolean;
  count: DropFilterRecordCount;
  // What reads the same records, kind by kind.
  readers: TelemetryFieldReadersByKind;
  securityEvents: DropFilterSecurityEvents;
}

// The share a filter keeps of what it matches: 0 for Drop, its percentage for Sample.
export function getDropFilterKeepPercentage(data: {
  action: unknown;
  samplePercentage?: unknown;
}): number {
  if (data.action !== DropFilterImpactAction.Sample) {
    return 0;
  }

  const percentage: unknown = data.samplePercentage;

  if (
    typeof percentage !== "number" ||
    !Number.isFinite(percentage) ||
    percentage < MIN_SAMPLE_PERCENTAGE ||
    percentage > MAX_SAMPLE_PERCENTAGE
  ) {
    // A sample the engine cannot honour keeps everything (DropFilterSampling).
    return 100;
  }

  return percentage;
}

// About how many a rule needs to reach its count when only `keepPercentage` is kept.
export function getNeededWhenSampled(data: {
  threshold: number;
  keepPercentage: number;
}): number {
  if (data.keepPercentage <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.ceil((data.threshold * 100) / data.keepPercentage);
}

export function getEmptyDropFilterImpact(data: {
  signal: TelemetryFieldSignal;
  action: DropFilterImpactAction;
  keepPercentage: number;
  timeLimitInSeconds: number;
}): DropFilterImpact {
  return {
    signal: data.signal,
    action: data.action,
    keepPercentage: data.keepPercentage,
    isQueryReadable: true,
    count: {
      state: DropFilterRecordCountState.Failed,
      lookbackInHours: DROP_FILTER_IMPACT_LOOKBACK_IN_HOURS,
      total: 0,
      matched: 0,
      securityEventsRead: null,
      isScoped: false,
      timeLimitInSeconds: data.timeLimitInSeconds,
    },
    readers: getEmptyTelemetryFieldReadersByKind(false),
    securityEvents: {
      isChecked: false,
      sources: [],
      thresholdRules: { rules: [], hiddenCount: 0, isChecked: true },
      keepsWhatSecurityEventsReads: false,
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * What the answer says first
 * ---------------------------------------------------------------------------
 */

// The one effect the form says in its line, the most important first.
export enum DropFilterImpactHeadline {
  // Security Events read some of the records it takes.
  SecurityEvents = "securityEvents",
  // Monitors, SLOs, dashboards... read the records it takes.
  Readers = "readers",
  // It matches records, and nothing else reads them.
  Unread = "unread",
  // It matched no record of the window.
  NoMatch = "noMatch",
  // Its query cannot be read: it takes nothing.
  Unreadable = "unreadable",
  // How many it matches is not known, and nothing found reads them.
  Uncounted = "uncounted",
}

// The kinds a line names first, the most important first.
export const DROP_FILTER_HEADLINE_KINDS: ReadonlyArray<TelemetryFieldReaderKind> =
  [
    TelemetryFieldReaderKind.Monitor,
    TelemetryFieldReaderKind.ServiceLevelObjective,
    TelemetryFieldReaderKind.Dashboard,
    TelemetryFieldReaderKind.RecordingRule,
    TelemetryFieldReaderKind.SavedView,
  ];

// How many of a kind read it: named and counted.
export function countReadersOfKind(
  ofKind: TelemetryFieldReadersOfKind,
): number {
  return ofKind.readers.length + ofKind.hiddenCount;
}

// The first kind that reads it, the most important first; null when none does.
export function getDropFilterHeadlineKind(
  impact: DropFilterImpact,
): TelemetryFieldReaderKind | null {
  for (const kind of DROP_FILTER_HEADLINE_KINDS) {
    if (countReadersOfKind(impact.readers[kind]) > 0) {
      return kind;
    }
  }

  return null;
}

// How many Security Events read of what it takes; 0 when none, or none is known.
export function getSecurityEventsRecordsTaken(
  impact: DropFilterImpact,
): number {
  if (
    !impact.isQueryReadable ||
    impact.securityEvents.keepsWhatSecurityEventsReads ||
    impact.count.state !== DropFilterRecordCountState.Counted
  ) {
    return 0;
  }

  return impact.count.securityEventsRead || 0;
}

export function getDropFilterImpactHeadline(
  impact: DropFilterImpact,
): DropFilterImpactHeadline {
  if (!impact.isQueryReadable) {
    return DropFilterImpactHeadline.Unreadable;
  }

  if (getSecurityEventsRecordsTaken(impact) > 0) {
    return DropFilterImpactHeadline.SecurityEvents;
  }

  if (getDropFilterHeadlineKind(impact)) {
    return DropFilterImpactHeadline.Readers;
  }

  if (impact.count.state !== DropFilterRecordCountState.Counted) {
    return DropFilterImpactHeadline.Uncounted;
  }

  return impact.count.matched > 0
    ? DropFilterImpactHeadline.Unread
    : DropFilterImpactHeadline.NoMatch;
}

/*
 * Whether something reads what the filter takes - Security Events, or a
 * saved query - so saving it, or turning it on, asks first. Never for a
 * query that drops nothing.
 */
export function isDropFilterImpactRead(impact: DropFilterImpact): boolean {
  const headline: DropFilterImpactHeadline =
    getDropFilterImpactHeadline(impact);

  return (
    headline === DropFilterImpactHeadline.SecurityEvents ||
    headline === DropFilterImpactHeadline.Readers
  );
}

/*
 * ---------------------------------------------------------------------------
 * The answer as it arrived, read defensively for a page
 * ---------------------------------------------------------------------------
 */

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wholeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function isOneOf<T extends string>(
  values: ReadonlyArray<T>,
  value: unknown,
): value is T {
  return (
    typeof value === "string" &&
    (values as ReadonlyArray<string>).includes(value)
  );
}

function readThresholdRule(value: unknown): DropFilterThresholdRule | null {
  const rule: Record<string, unknown> = asObject(value);
  const id: unknown = rule["id"];
  const name: unknown = rule["name"];

  if (typeof id !== "string" || !id || typeof name !== "string") {
    return null;
  }

  return {
    id,
    name,
    threshold: wholeCount(rule["threshold"]),
    windowInMinutes: wholeCount(rule["windowInMinutes"]),
    neededWhenSampled: wholeCount(rule["neededWhenSampled"]),
    countsDistinct: rule["countsDistinct"] === true,
  };
}

/*
 * An answer as it arrived: a kind it does not say was checked is said to
 * be unchecked, never empty; a count it does not say was made is not known.
 */
export function readDropFilterImpact(value: unknown): DropFilterImpact {
  const answer: Record<string, unknown> = asObject(value);
  const count: Record<string, unknown> = asObject(answer["count"]);
  const securityEvents: Record<string, unknown> = asObject(
    answer["securityEvents"],
  );
  const thresholdRules: Record<string, unknown> = asObject(
    securityEvents["thresholdRules"],
  );
  const action: DropFilterImpactAction =
    answer["action"] === DropFilterImpactAction.Sample
      ? DropFilterImpactAction.Sample
      : DropFilterImpactAction.Drop;
  const keepPercentage: number = wholeCount(answer["keepPercentage"]);
  const securityEventsRead: unknown = count["securityEventsRead"];

  return {
    signal: answer["signal"] === "trace" ? "trace" : "log",
    action,
    keepPercentage:
      action === DropFilterImpactAction.Sample
        ? Math.min(keepPercentage, 100)
        : 0,
    isQueryReadable: answer["isQueryReadable"] !== false,
    count: {
      state: isOneOf(Object.values(DropFilterRecordCountState), count["state"])
        ? count["state"]
        : DropFilterRecordCountState.Failed,
      lookbackInHours:
        wholeCount(count["lookbackInHours"]) ||
        DROP_FILTER_IMPACT_LOOKBACK_IN_HOURS,
      total: wholeCount(count["total"]),
      matched: wholeCount(count["matched"]),
      securityEventsRead:
        typeof securityEventsRead === "number"
          ? wholeCount(securityEventsRead)
          : null,
      isScoped: count["isScoped"] === true,
      timeLimitInSeconds: wholeCount(count["timeLimitInSeconds"]),
    },
    readers: readTelemetryFieldReaders({ kinds: answer["readers"] }).kinds,
    securityEvents: {
      isChecked: securityEvents["isChecked"] === true,
      sources: (Array.isArray(securityEvents["sources"])
        ? (securityEvents["sources"] as Array<unknown>)
        : []
      ).filter((source: unknown): source is SecurityEventsTelemetrySource => {
        return isOneOf(Object.values(SecurityEventsTelemetrySource), source);
      }),
      thresholdRules: {
        rules: (Array.isArray(thresholdRules["rules"])
          ? (thresholdRules["rules"] as Array<unknown>)
          : []
        )
          .map(readThresholdRule)
          .filter(
            (
              rule: DropFilterThresholdRule | null,
            ): rule is DropFilterThresholdRule => {
              return rule !== null;
            },
          ),
        hiddenCount: wholeCount(thresholdRules["hiddenCount"]),
        isChecked: thresholdRules["isChecked"] !== false,
      },
      keepsWhatSecurityEventsReads:
        securityEvents["keepsWhatSecurityEventsReads"] === true,
    },
  };
}

// Every kind of reader the answer lists, in the order a page lists them.
export { TELEMETRY_FIELD_READER_KINDS };

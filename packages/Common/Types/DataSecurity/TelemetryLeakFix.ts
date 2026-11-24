import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { DataStoreKind } from "./DataStoreKind";
import { toStableJsonText } from "./DataSecurityAi";

/*
 * A SERVICE'S TELEMETRY LEAKS, FIXED IN ITS CODE IN ONE PULL REQUEST
 * (#10367).
 *
 * A scrub rule (#10366) hides a leak in OneUptime; the code still writes
 * it - to stdout, to a log shipper, to every other vendor the service
 * sends telemetry to. So Data Security finds the line of code that writes
 * each leak before OneUptime AI's code agent starts, from the records the
 * leak was seen in (Server/Utils/DataSecurity/Telemetry/
 * TelemetryLeakLocator, inside OneUptime), and keeps only where they came
 * from:
 *
 *   - a span's or an AI call's code location (code.filepath, code.function,
 *     code.lineno and their newer names), its name and its instrumentation
 *     scope;
 *   - an exception's own top frames: the service's code, never a
 *     dependency's;
 *   - a log line's code location and its logger's scope, and the line as a
 *     template - its pattern, with every value replaced by its type's name
 *     ("User <Email address> signed up"), never the value;
 *   - a metric's name, to find where its instrument is created;
 *   - and the attribute key itself, which the code usually writes as a
 *     literal.
 *
 * Then plain code decides how each leak is fixed (decideTelemetryLeakFix):
 * where it is written, at the call site, while the leaks are written in at
 * most MAX_CALL_SITE_PLACES places; beyond that, one redaction step where
 * the service sets up its telemetry (a span processor, a log processor or
 * a formatter), with a test - and always the redaction step for the keys
 * the project's scrub rules already mask, so the code does what ingest
 * does.
 *
 * Pure: the server, the Runner and the Dashboard read these shapes alike,
 * and they are a wire contract (AIRun.taskContext.telemetryLeakFix, the
 * fix plan the Dashboard shows): never rename a field or a value.
 */

// The signals a service's telemetry leaks are found in.
export enum TelemetryLeakSignal {
  Logs = "Logs",
  Spans = "Spans",
  Exceptions = "Exceptions",
  AiCalls = "AiCalls",
  Metrics = "Metrics",
}

export const TELEMETRY_LEAK_SIGNALS: ReadonlyArray<TelemetryLeakSignal> = [
  TelemetryLeakSignal.Logs,
  TelemetryLeakSignal.Spans,
  TelemetryLeakSignal.Exceptions,
  TelemetryLeakSignal.AiCalls,
  TelemetryLeakSignal.Metrics,
];

/*
 * The telemetry stores of a service whose leaks its code is fixed for. A
 * session replay store is a RUM application's, not a service's: its
 * records carry no code location, and it is left out.
 */
const SIGNAL_OF_STORE_KIND: Readonly<Record<string, TelemetryLeakSignal>> = {
  [DataStoreKind.TelemetryLogs]: TelemetryLeakSignal.Logs,
  [DataStoreKind.TelemetryTraces]: TelemetryLeakSignal.Spans,
  [DataStoreKind.TelemetryExceptions]: TelemetryLeakSignal.Exceptions,
  [DataStoreKind.TelemetryAiConversations]: TelemetryLeakSignal.AiCalls,
  [DataStoreKind.TelemetryMetrics]: TelemetryLeakSignal.Metrics,
};

export const SERVICE_TELEMETRY_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.TelemetryLogs,
  DataStoreKind.TelemetryTraces,
  DataStoreKind.TelemetryExceptions,
  DataStoreKind.TelemetryAiConversations,
  DataStoreKind.TelemetryMetrics,
];

// The signal a telemetry store's records are, or null for one this fix leaves out.
export function getTelemetryLeakSignal(
  kind: DataStoreKind | string | null | undefined,
): TelemetryLeakSignal | null {
  return (kind && SIGNAL_OF_STORE_KIND[kind]) || null;
}

export function isTelemetryLeakSignal(
  value: unknown,
): value is TelemetryLeakSignal {
  return (
    typeof value === "string" &&
    (TELEMETRY_LEAK_SIGNALS as ReadonlyArray<string>).includes(value)
  );
}

// How one leak is fixed.
export enum TelemetryLeakHandling {
  // Where the code writes it: the value left out, or masked or hashed first.
  CallSite = "CallSite",
  // In the one redaction step where the service sets up its telemetry.
  RedactionStep = "RedactionStep",
}

export function isTelemetryLeakHandling(
  value: unknown,
): value is TelemetryLeakHandling {
  return (
    value === TelemetryLeakHandling.CallSite ||
    value === TelemetryLeakHandling.RedactionStep
  );
}

// How the pull request fixes the service's leaks, as a whole.
export enum TelemetryLeakFixStrategy {
  // Each leak where it is written: a few places.
  CallSites = "CallSites",
  // One redaction step: many places, or keys a scrub rule masks.
  RedactionStep = "RedactionStep",
  // A few call sites, and the redaction step for the keys a scrub rule masks.
  CallSitesAndRedactionStep = "CallSitesAndRedactionStep",
}

export function isTelemetryLeakFixStrategy(
  value: unknown,
): value is TelemetryLeakFixStrategy {
  return (
    typeof value === "string" &&
    (Object.values(TelemetryLeakFixStrategy) as Array<string>).includes(value)
  );
}

/*
 * The most places a leak may be written in, across the service, before one
 * redaction step fixes them instead of an edit at each (the issue's
 * decision: call sites up to three places, one redaction step beyond).
 */
export const MAX_CALL_SITE_PLACES: number = 3;

// The most leaks one fix carries, places one leak keeps, and files it starts from.
export const MAX_TELEMETRY_LEAKS_PER_FIX: number = 50;
export const MAX_PLACES_PER_TELEMETRY_LEAK: number = 5;
export const MAX_TELEMETRY_LEAK_START_FILES: number = 10;
export const MAX_TELEMETRY_LEAK_ISSUES: number = 20;
export const MAX_TELEMETRY_LEAK_REDACTION_KEYS: number = 50;

// The longest each kept text is: a path, a name, a template.
export const MAX_TELEMETRY_LEAK_PATH_LENGTH: number = 300;
export const MAX_TELEMETRY_LEAK_NAME_LENGTH: number = 200;
export const MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH: number = 240;

// The most frames of an exception's own stack a place keeps.
export const MAX_TELEMETRY_LEAK_FRAMES: number = 3;

// One frame of an exception's own stack: the service's code, never a dependency's.
export interface TelemetryLeakFrame {
  filePath: string;
  functionName?: string | undefined;
  lineNumber?: number | undefined;
}

/*
 * One place a leak was written, as the records it was seen in name it:
 * never a value. Each part is optional - a log line with no code
 * attributes still names its logger and its template.
 */
export interface TelemetryLeakPlace {
  /*
   * An exception's own top frames, where it was thrown first: the place's
   * file, function and line are the first of them.
   */
  frames?: Array<TelemetryLeakFrame> | undefined;
  // A repository path, as the service ran it with its container's prefix taken off.
  filePath?: string | undefined;
  functionName?: string | undefined;
  lineNumber?: number | undefined;
  // A span's or an AI call's name.
  spanName?: string | undefined;
  // The instrumentation scope: the logger's or the tracer's name.
  scopeName?: string | undefined;
  // An exception's type.
  exceptionType?: string | undefined;
  // A metric's name, where the instrument is created - never one that holds the data.
  metricName?: string | undefined;
  // A log line, an exception's message or a metric's name, its values replaced by their types' names.
  template?: string | undefined;
  // How many of the records the leak was seen in named this place.
  recordCount: number;
}

// One leak: a data type at a location of one of the service's telemetry stores.
export interface TelemetryLeakFixLeak {
  issueId: string;
  dataStoreId: string;
  checkId: string;
  // The finding it is: who keeps it, and #10368's check, read it.
  findingId?: string | undefined;
  signal: TelemetryLeakSignal;
  dataTypeId: string;
  // As the project calls it (DataTypeNamer).
  dataTypeName: string;
  isSecret: boolean;
  // Where the scan found it: attributes.user.email, body, message, name.
  location: string;
  // The attribute the code writes, when it is one: user.email.
  key?: string | undefined;
  // A scrub rule of the project masks it at ingest already.
  isMaskedByScrubRule: boolean;
  handling: TelemetryLeakHandling;
  places: Array<TelemetryLeakPlace>;
}

// An issue the pull request fixes: what its description lists and links.
export interface TelemetryLeakFixIssue {
  issueId: string;
  title: string;
  checkId: string;
  signal: TelemetryLeakSignal;
  // Its page in OneUptime.
  issueUrl?: string | undefined;
}

/*
 * What makes two places one: the file and line (or function) the code
 * writes it at, else the template of its line, else its span or metric.
 * Null for a place that names none of them.
 */
export function getTelemetryLeakPlaceKey(
  place: TelemetryLeakPlace,
): string | null {
  if (place.filePath) {
    const at: string =
      place.lineNumber !== undefined
        ? String(place.lineNumber)
        : place.functionName || "";

    return `file:${place.filePath}:${at}`;
  }

  if (place.template) {
    return `template:${place.template}`;
  }

  if (place.spanName) {
    return `span:${place.scopeName || ""}:${place.spanName}`;
  }

  if (place.metricName) {
    return `metric:${place.metricName}`;
  }

  if (place.exceptionType) {
    return `exception:${place.exceptionType}`;
  }

  return null;
}

/*
 * The places a leak is written in, as the decision counts them: each place
 * its records name once - and a leak whose records name none is one place,
 * its key (the code writes it somewhere).
 */
export function getTelemetryLeakPlaceKeys(
  leak: Pick<TelemetryLeakFixLeak, "places" | "signal" | "location" | "key">,
): Array<string> {
  const keys: Array<string> = [];

  for (const place of leak.places) {
    const key: string | null = getTelemetryLeakPlaceKey(place);

    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys.length > 0 ? keys : [`unplaced:${leak.signal}:${leak.location}`];
}

export interface TelemetryLeakFixDecision {
  strategy: TelemetryLeakFixStrategy;
  // The distinct places the leaks not masked at ingest are written in.
  placeCount: number;
  // Each leak, with how it is fixed.
  leaks: Array<TelemetryLeakFixLeak>;
  // The attribute keys the redaction step covers.
  redactionKeys: Array<string>;
  // The data types the redaction step masks in text: a log line, a message.
  redactionDataTypes: Array<string>;
}

/*
 * How the service's leaks are fixed (the issue's decision):
 *
 *   1. a leak a scrub rule of the project masks at ingest goes to the
 *      redaction step, always: the code does what ingest does;
 *   2. the others are counted by the places they are written in, across
 *      the service: at most MAX_CALL_SITE_PLACES, each is fixed where it is
 *      written; more, they go to the redaction step too.
 *
 * Pure, and the same every time for the same leaks: the plan a person
 * approves is the one the agent is handed.
 */
export function decideTelemetryLeakFix(
  leaks: ReadonlyArray<Omit<TelemetryLeakFixLeak, "handling">>,
): TelemetryLeakFixDecision {
  const unmasked: Array<Omit<TelemetryLeakFixLeak, "handling">> = leaks.filter(
    (leak: Omit<TelemetryLeakFixLeak, "handling">): boolean => {
      return !leak.isMaskedByScrubRule;
    },
  );
  const places: Set<string> = new Set();

  for (const leak of unmasked) {
    for (const key of getTelemetryLeakPlaceKeys(leak)) {
      places.add(key);
    }
  }

  const callSites: boolean = places.size <= MAX_CALL_SITE_PLACES;
  const decided: Array<TelemetryLeakFixLeak> = leaks.map(
    (leak: Omit<TelemetryLeakFixLeak, "handling">): TelemetryLeakFixLeak => {
      return {
        ...leak,
        handling:
          !leak.isMaskedByScrubRule && callSites
            ? TelemetryLeakHandling.CallSite
            : TelemetryLeakHandling.RedactionStep,
      };
    },
  );
  const redacted: Array<TelemetryLeakFixLeak> = decided.filter(
    (leak: TelemetryLeakFixLeak): boolean => {
      return leak.handling === TelemetryLeakHandling.RedactionStep;
    },
  );
  const redactionKeys: Array<string> = [];
  const redactionDataTypes: Array<string> = [];

  for (const leak of redacted) {
    if (leak.key) {
      if (!redactionKeys.includes(leak.key)) {
        redactionKeys.push(leak.key);
      }
    } else if (!redactionDataTypes.includes(leak.dataTypeName)) {
      redactionDataTypes.push(leak.dataTypeName);
    }
  }

  const hasCallSites: boolean = decided.some(
    (leak: TelemetryLeakFixLeak): boolean => {
      return leak.handling === TelemetryLeakHandling.CallSite;
    },
  );

  return {
    strategy:
      redacted.length === 0
        ? TelemetryLeakFixStrategy.CallSites
        : hasCallSites
          ? TelemetryLeakFixStrategy.CallSitesAndRedactionStep
          : TelemetryLeakFixStrategy.RedactionStep,
    placeCount: places.size,
    leaks: decided,
    redactionKeys: redactionKeys.slice(0, MAX_TELEMETRY_LEAK_REDACTION_KEYS),
    redactionDataTypes,
  };
}

/*
 * The files the agent starts from: those the leaks' records name, the
 * most named first, then in the order the leaks are listed - at most
 * MAX_TELEMETRY_LEAK_START_FILES.
 */
export function getTelemetryLeakStartFiles(
  leaks: ReadonlyArray<Pick<TelemetryLeakFixLeak, "places">>,
): Array<string> {
  const counts: Map<string, { count: number; first: number }> = new Map();
  let order: number = 0;

  for (const leak of leaks) {
    for (const place of leak.places) {
      if (!place.filePath) {
        continue;
      }

      const seen: { count: number; first: number } | undefined = counts.get(
        place.filePath,
      );

      if (seen) {
        seen.count += Math.max(1, place.recordCount);
      } else {
        counts.set(place.filePath, {
          count: Math.max(1, place.recordCount),
          first: order++,
        });
      }
    }
  }

  return Array.from(counts.entries())
    .sort(
      (
        left: [string, { count: number; first: number }],
        right: [string, { count: number; first: number }],
      ): number => {
        return right[1].count - left[1].count || left[1].first - right[1].first;
      },
    )
    .map((entry: [string, { count: number; first: number }]): string => {
      return entry[0];
    })
    .slice(0, MAX_TELEMETRY_LEAK_START_FILES);
}

/*
 * What makes a service's fix in one repository the same proposal again:
 * its lane - the service and the repository, so a newer plan for them
 * replaces the one still waiting, and no other service's - then what it
 * fixes and where. At most 100 characters (DataSecurityAiProposal.planKey).
 */
export function getTelemetryLeakFixLane(data: {
  serviceId: string;
  repositoryId?: string | null | undefined;
}): string {
  return `tleak-${data.serviceId.toLowerCase()}-${(data.repositoryId || "none").toLowerCase()}`;
}

export function getTelemetryLeakFixPlanKey(data: {
  serviceId: string;
  repositoryId?: string | null | undefined;
  leaks: ReadonlyArray<
    Pick<
      TelemetryLeakFixLeak,
      "issueId" | "location" | "dataTypeId" | "handling" | "signal"
    >
  >;
}): string {
  const what: string = data.leaks
    .map(
      (
        leak: Pick<
          TelemetryLeakFixLeak,
          "issueId" | "location" | "dataTypeId" | "handling" | "signal"
        >,
      ): string => {
        return [
          leak.issueId.toLowerCase(),
          leak.signal,
          leak.location,
          leak.dataTypeId,
          leak.handling,
        ].join("|");
      },
    )
    .sort()
    .join("\n");

  return `${getTelemetryLeakFixLane(data)}:${sha256Hex(what).slice(0, 16)}`;
}

/*
 * What a fix's plan is, in sixteen hex digits: what a person was shown. Fix
 * with AI names it when it asks, and a plan that changed since does nothing
 * (the person looks again), as a group's fix does (#10370).
 */
export function getTelemetryLeakFixFingerprint(plan: {
  serviceId: string;
  repositoryId?: string | null | undefined;
  strategy: TelemetryLeakFixStrategy;
  leaks: ReadonlyArray<TelemetryLeakFixLeak>;
  startFiles: ReadonlyArray<string>;
}): string {
  return sha256Hex(
    toStableJsonText({
      serviceId: plan.serviceId.toLowerCase(),
      repositoryId: (plan.repositoryId || "").toLowerCase(),
      strategy: plan.strategy,
      leaks: plan.leaks.map((leak: TelemetryLeakFixLeak): unknown => {
        return {
          issueId: leak.issueId.toLowerCase(),
          signal: leak.signal,
          location: leak.location,
          dataTypeId: leak.dataTypeId,
          handling: leak.handling,
          places: leak.places,
        };
      }),
      startFiles: plan.startFiles,
    }),
  ).slice(0, 16);
}

/*
 * ---------------------------------------------------------------------------
 * Reading the shapes back: the task context a Runner is handed and the plan
 * the Dashboard is sent are JSON, read defensively - a field of the wrong
 * type is no field, a text is held to its length, and nothing past the
 * limits is kept.
 * ---------------------------------------------------------------------------
 */

function readText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function readLine(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < 10_000_000
    ? value
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readTelemetryLeakPlace(
  value: unknown,
): TelemetryLeakPlace | null {
  if (!isObject(value)) {
    return null;
  }

  const place: TelemetryLeakPlace = {
    recordCount:
      typeof value["recordCount"] === "number" &&
      Number.isSafeInteger(value["recordCount"]) &&
      value["recordCount"] >= 0
        ? value["recordCount"]
        : 0,
  };
  const texts: Array<[keyof TelemetryLeakPlace & string, number]> = [
    ["filePath", MAX_TELEMETRY_LEAK_PATH_LENGTH],
    ["functionName", MAX_TELEMETRY_LEAK_NAME_LENGTH],
    ["spanName", MAX_TELEMETRY_LEAK_NAME_LENGTH],
    ["scopeName", MAX_TELEMETRY_LEAK_NAME_LENGTH],
    ["exceptionType", MAX_TELEMETRY_LEAK_NAME_LENGTH],
    ["metricName", MAX_TELEMETRY_LEAK_NAME_LENGTH],
    ["template", MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH],
  ];

  for (const [key, max] of texts) {
    const text: string = readText(value[key], max).trim();

    if (text) {
      (place as unknown as Record<string, string>)[key] = text;
    }
  }

  const lineNumber: number | undefined = readLine(value["lineNumber"]);

  if (lineNumber !== undefined) {
    place.lineNumber = lineNumber;
  }

  const frames: Array<TelemetryLeakFrame> = readTelemetryLeakList(
    value["frames"],
    readTelemetryLeakFrame,
    MAX_TELEMETRY_LEAK_FRAMES,
  );

  if (frames.length > 0) {
    place.frames = frames;
  }

  return getTelemetryLeakPlaceKey(place) ? place : null;
}

export function readTelemetryLeakFrame(
  value: unknown,
): TelemetryLeakFrame | null {
  if (!isObject(value)) {
    return null;
  }

  const filePath: string = readText(
    value["filePath"],
    MAX_TELEMETRY_LEAK_PATH_LENGTH,
  ).trim();

  if (!filePath) {
    return null;
  }

  const functionName: string = readText(
    value["functionName"],
    MAX_TELEMETRY_LEAK_NAME_LENGTH,
  ).trim();
  const lineNumber: number | undefined = readLine(value["lineNumber"]);

  return {
    filePath,
    ...(functionName ? { functionName } : {}),
    ...(lineNumber !== undefined ? { lineNumber } : {}),
  };
}

export function readTelemetryLeakFixLeak(
  value: unknown,
): TelemetryLeakFixLeak | null {
  if (!isObject(value)) {
    return null;
  }

  const issueId: string = readText(value["issueId"], 100);
  const dataStoreId: string = readText(value["dataStoreId"], 100);
  const dataTypeId: string = readText(value["dataTypeId"], 200);
  const location: string = readText(
    value["location"],
    MAX_TELEMETRY_LEAK_PATH_LENGTH,
  );
  const signal: unknown = value["signal"];
  const handling: unknown = value["handling"];

  if (
    !issueId ||
    !dataTypeId ||
    !location ||
    !isTelemetryLeakSignal(signal) ||
    !isTelemetryLeakHandling(handling)
  ) {
    return null;
  }

  const places: Array<TelemetryLeakPlace> = (
    Array.isArray(value["places"]) ? (value["places"] as Array<unknown>) : []
  )
    .map(readTelemetryLeakPlace)
    .filter((place: TelemetryLeakPlace | null): place is TelemetryLeakPlace => {
      return place !== null;
    })
    .slice(0, MAX_PLACES_PER_TELEMETRY_LEAK);
  const key: string = readText(value["key"], MAX_TELEMETRY_LEAK_PATH_LENGTH);
  const findingId: string = readText(value["findingId"], 100);

  return {
    issueId,
    dataStoreId,
    checkId: readText(value["checkId"], 100),
    ...(findingId ? { findingId } : {}),
    signal,
    dataTypeId,
    dataTypeName:
      readText(value["dataTypeName"], MAX_TELEMETRY_LEAK_NAME_LENGTH) ||
      dataTypeId,
    isSecret: value["isSecret"] === true,
    location,
    ...(key ? { key } : {}),
    isMaskedByScrubRule: value["isMaskedByScrubRule"] === true,
    handling,
    places,
  };
}

export function readTelemetryLeakFixIssue(
  value: unknown,
): TelemetryLeakFixIssue | null {
  if (!isObject(value)) {
    return null;
  }

  const issueId: string = readText(value["issueId"], 100);
  const signal: unknown = value["signal"];

  if (!issueId || !isTelemetryLeakSignal(signal)) {
    return null;
  }

  const issueUrl: string = readText(value["issueUrl"], 2000);

  return {
    issueId,
    title:
      readText(value["title"], MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH) ||
      "Sensitive data in telemetry",
    checkId: readText(value["checkId"], 100),
    signal,
    ...(issueUrl.startsWith("https://") || issueUrl.startsWith("http://")
      ? { issueUrl }
      : {}),
  };
}

// A list read with its reader, the unreadable left out, at most `max`.
export function readTelemetryLeakList<T>(
  value: unknown,
  read: (item: unknown) => T | null,
  max: number,
): Array<T> {
  return (Array.isArray(value) ? (value as Array<unknown>) : [])
    .map(read)
    .filter((item: T | null): item is T => {
      return item !== null;
    })
    .slice(0, max);
}

// A list of texts, each held to `maxLength`, the empty and the repeated left out.
export function readTelemetryLeakTexts(
  value: unknown,
  max: number,
  maxLength: number,
): Array<string> {
  const texts: Array<string> = [];

  for (const item of Array.isArray(value) ? (value as Array<unknown>) : []) {
    const text: string = readText(item, maxLength).trim();

    if (text && !texts.includes(text)) {
      texts.push(text);
    }

    if (texts.length >= max) {
      break;
    }
  }

  return texts;
}

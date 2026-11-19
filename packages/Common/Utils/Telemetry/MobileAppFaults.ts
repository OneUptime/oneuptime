import { LogEventNameAttributeKey } from "../../Types/Log/LogEventName";

/*
 * THE CRASHES, ANRS AND HANGS A MOBILE APP'S OPENTELEMETRY SDK REPORTS.
 *
 * OpenTelemetry Android reports the two faults that end a person's use of an
 * app as log records that are events, in the record's OTLP event name
 * field, never as spans:
 *
 *   - a crash, an uncaught exception that killed the process: `app.crash`
 *     since 1.5.0, `device.crash` before it (0.11.0 to 1.4.x, and still with
 *     `useLatestExperimental = false`), with the exception's
 *     `exception.type`, `exception.message` and `exception.stacktrace`. Its
 *     optional native-crash module reports a signal (`SIGSEGV`) the same way,
 *     on the next launch;
 *   - an ANR (Application Not Responding): the main thread stopped
 *     answering for five seconds or more. `device.anr` since 0.14.0, with the
 *     main thread's stack in `exception.stacktrace` and no type or message.
 *
 * opentelemetry-swift's MetricKit instrumentation (since 2.3.0) reports
 * Apple's diagnostics the same way, one log record per diagnostic, under the
 * instrumentation scope "MetricKit" (Sources/Instrumentation/MetricKit):
 *
 *   - a crash: `metrickit.diagnostic.crash`, with `exception.type` and
 *     `exception.message` from the most specific of the Objective-C
 *     exception (iOS 17+), the Mach exception (`EXC_BAD_ACCESS`, "Could not
 *     access memory") and the POSIX signal (`SIGSEGV`), and the call stack
 *     tree as JSON in `exception.stacktrace` (MetricKitCallStack);
 *   - a hang, the main thread unresponsive: `metrickit.diagnostic.hang`,
 *     with the call stack tree in `exception.stacktrace`, its length in
 *     seconds in `metrickit.diagnostic.hang.hang_duration`, and no type or
 *     message. A hang is the iOS counterpart of an ANR.
 *
 * It names the diagnostic in a `name` attribute, and since 2.4.1 in the
 * event name field too: 2.3.0 sent the attribute alone, which is why it is
 * read below. Apple delivers diagnostics on the app's next launch (once a
 * day before iOS 15), so they arrive late, stamped with the end of the
 * payload's reporting period, and carry the session that reported them
 * rather than the one they ended. opentelemetry-swift's KSCrash-based crash
 * instrumentation reports a crash as `device.crash`, read as above.
 *
 * Log ingest stamps a record's event name onto its `event.name` attribute
 * (LogEventName, and stampMetricKitDiagnosticEventName below for 2.3.0), so
 * every fault is read from there, whichever field the SDK sent it in: 0.10.0
 * and older sent `device.crash` as that attribute.
 *
 * What OneUptime does with them (LogExceptionExtractor): each is an
 * exception, and each is unhandled - a crash escaped everything, and an ANR
 * or a hang is a freeze nobody caught - although none sets
 * `exception.escaped`. An ANR and a hang are filed under the types below
 * with the messages below, so each reads as what it is in Exceptions,
 * instead of a row with no type or message.
 */

export enum MobileAppFaultKind {
  Crash = "crash",
  Anr = "anr",
  Hang = "hang",
}

// opentelemetry-swift's MetricKit diagnostics, one per Apple diagnostic.
export const METRICKIT_DIAGNOSTIC_PREFIX: string = "metrickit.diagnostic.";

export const METRICKIT_CRASH_EVENT_NAME: string = `${METRICKIT_DIAGNOSTIC_PREFIX}crash`;

export const METRICKIT_HANG_EVENT_NAME: string = `${METRICKIT_DIAGNOSTIC_PREFIX}hang`;

/*
 * The attribute opentelemetry-swift names each MetricKit diagnostic in, the
 * only place 2.3.0 named it.
 */
export const METRICKIT_DIAGNOSTIC_NAME_ATTRIBUTE: string = "name";

// The attribute a MetricKit hang says how long it lasted in, in seconds.
export const METRICKIT_HANG_DURATION_ATTRIBUTE: string = `${METRICKIT_HANG_EVENT_NAME}.hang_duration`;

// The event names each fault is reported under, in every SDK OneUptime reads.
export const MOBILE_APP_FAULT_EVENT_NAMES: Readonly<
  Record<MobileAppFaultKind, ReadonlyArray<string>>
> = {
  [MobileAppFaultKind.Crash]: [
    "app.crash",
    "device.crash",
    METRICKIT_CRASH_EVENT_NAME,
  ],
  [MobileAppFaultKind.Anr]: ["device.anr"],
  [MobileAppFaultKind.Hang]: [METRICKIT_HANG_EVENT_NAME],
};

/*
 * What an ANR is filed under. "ANR" is the word Android itself uses, in the
 * Play Console's Android vitals and in the system's own dialog's logs, so a
 * person who sees it knows what happened.
 */
export const ANR_EXCEPTION_TYPE: string = "ANR";

export const ANR_EXCEPTION_MESSAGE: string =
  "Application Not Responding: the app's main thread was blocked, so it stopped responding to input.";

/*
 * What an iOS hang is filed under: Apple's own word, in Xcode's Organizer
 * and MetricKit (MXHangDiagnostic), so an iOS developer reads it as what it
 * is. It is counted with the ANRs wherever a freeze is counted
 * (APP_NOT_RESPONDING_EXCEPTION_TYPES).
 */
export const HANG_EXCEPTION_TYPE: string = "Hang";

export const HANG_EXCEPTION_MESSAGE: string =
  "Hang: the app's main thread was blocked, so it stopped responding to input.";

/*
 * The types a freeze is filed under, on every platform: Android's ANR and
 * iOS's hang. The mobile Overview's ANRs tile counts them, its Crashes tile
 * and every crash count leave them out, and so do the crash monitors the
 * Recommendations offer.
 */
export const APP_NOT_RESPONDING_EXCEPTION_TYPES: ReadonlyArray<string> = [
  ANR_EXCEPTION_TYPE,
  HANG_EXCEPTION_TYPE,
];

/*
 * The MetricKit diagnostic a record's `name` attribute names, or null: a
 * name in the `metrickit.diagnostic.` namespace, the only `name` values read
 * as an event's, since a `name` attribute can mean anything elsewhere.
 */
export function readMetricKitDiagnosticName(
  attributes: Record<string, unknown> | undefined | null,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const name: unknown = attributes[METRICKIT_DIAGNOSTIC_NAME_ATTRIBUTE];

  if (typeof name !== "string") {
    return null;
  }

  const trimmed: string = name.trim();

  return trimmed.startsWith(METRICKIT_DIAGNOSTIC_PREFIX) &&
    trimmed.length > METRICKIT_DIAGNOSTIC_PREFIX.length
    ? trimmed
    : null;
}

/*
 * Puts a MetricKit diagnostic's name on the record's `event.name` attribute
 * when the record sets none: opentelemetry-swift 2.3.0 named it only in its
 * `name` attribute, and 2.4.1 and later in the event name field too, so
 * every version's diagnostics are found by one key (the Logs page, filters,
 * the fault reads). Returns whether it did. Never throws.
 */
export function stampMetricKitDiagnosticEventName(
  attributes: Record<string, unknown> | undefined | null,
): boolean {
  if (!attributes || typeof attributes !== "object") {
    return false;
  }

  const existing: unknown = attributes[LogEventNameAttributeKey];

  if (
    existing !== undefined &&
    existing !== null &&
    !(typeof existing === "string" && existing.trim() === "")
  ) {
    return false;
  }

  const name: string | null = readMetricKitDiagnosticName(attributes);

  if (!name) {
    return false;
  }

  attributes[LogEventNameAttributeKey] = name;

  return true;
}

/*
 * The fault event name a log record reports - from its `event.name`, or
 * from a MetricKit diagnostic's `name` attribute - or null when it is not a
 * mobile app's crash, ANR or hang. Never throws.
 */
export function getMobileAppFaultEventName(
  attributes: Record<string, unknown> | undefined | null,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const candidates: Array<string> = [];
  const eventName: unknown = attributes[LogEventNameAttributeKey];

  if (typeof eventName === "string") {
    candidates.push(eventName.trim());
  }

  const metricKitName: string | null = readMetricKitDiagnosticName(attributes);

  if (metricKitName) {
    candidates.push(metricKitName);
  }

  for (const name of candidates) {
    for (const kind of Object.values(MobileAppFaultKind)) {
      if (MOBILE_APP_FAULT_EVENT_NAMES[kind].includes(name)) {
        return name;
      }
    }
  }

  return null;
}

/*
 * The fault a log record reports, from its attributes (event.name, or a
 * MetricKit diagnostic's name), or null when it is not a mobile app's
 * crash, ANR or hang. Never throws.
 */
export function getMobileAppFaultKind(
  attributes: Record<string, unknown> | undefined | null,
): MobileAppFaultKind | null {
  const name: string | null = getMobileAppFaultEventName(attributes);

  if (!name) {
    return null;
  }

  for (const kind of Object.values(MobileAppFaultKind)) {
    if (MOBILE_APP_FAULT_EVENT_NAMES[kind].includes(name)) {
      return kind;
    }
  }

  return null;
}

// Whether a fault event name is one of opentelemetry-swift's MetricKit ones.
export function isMetricKitFaultEventName(name: string | null): boolean {
  return Boolean(name && name.startsWith(METRICKIT_DIAGNOSTIC_PREFIX));
}

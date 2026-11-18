import { LogEventNameAttributeKey } from "../../Types/Log/LogEventName";

/*
 * THE CRASHES AND ANRS A MOBILE APP'S OPENTELEMETRY SDK REPORTS.
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
 * Log ingest stamps a record's event name onto its `event.name` attribute
 * (LogEventName), so both are read from there, whichever field the SDK sent
 * it in: 0.10.0 and older sent `device.crash` as that attribute.
 *
 * What OneUptime does with them (LogExceptionExtractor): both are
 * exceptions, and both are unhandled - a crash escaped everything, and an
 * ANR is a freeze nobody caught - although neither sets `exception.escaped`.
 * An ANR is filed under the type below with the message below, so it reads
 * as what it is in Exceptions, instead of a row with no type or message.
 */

export enum MobileAppFaultKind {
  Crash = "crash",
  Anr = "anr",
}

// The event names each fault is reported under, in every SDK OneUptime reads.
export const MOBILE_APP_FAULT_EVENT_NAMES: Readonly<
  Record<MobileAppFaultKind, ReadonlyArray<string>>
> = {
  [MobileAppFaultKind.Crash]: ["app.crash", "device.crash"],
  [MobileAppFaultKind.Anr]: ["device.anr"],
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
 * The fault a log record reports, from its attributes (event.name), or null
 * when it is not a mobile app's crash or ANR. Never throws.
 */
export function getMobileAppFaultKind(
  attributes: Record<string, unknown> | undefined | null,
): MobileAppFaultKind | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const eventName: unknown = attributes[LogEventNameAttributeKey];

  if (typeof eventName !== "string") {
    return null;
  }

  const name: string = eventName.trim();

  for (const kind of Object.values(MobileAppFaultKind)) {
    if (MOBILE_APP_FAULT_EVENT_NAMES[kind].includes(name)) {
      return kind;
    }
  }

  return null;
}

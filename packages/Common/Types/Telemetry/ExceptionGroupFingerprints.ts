import Includes from "../BaseDatabase/Includes";

/*
 * THE FINGERPRINTS AN EXCEPTION'S OCCURRENCES CARRY: ITS GROUP.
 *
 * An exception merged into another (TelemetryExceptionMerge) keeps its
 * fingerprint, and so do its occurrences in ClickHouse: nothing there is
 * rewritten. They count on the exception they were merged into, so a read of
 * an exception's occurrences reads them by its group - its own fingerprint,
 * then those of the exceptions merged into it, the most recently seen first
 * (TelemetryExceptionService.getGroupFingerprints). An exception nothing was
 * merged into is its own fingerprint alone, and is read exactly as before any
 * merge. Pure, and shared by the server and the Dashboard.
 */

/*
 * The most fingerprints merged into one exception that a read of its
 * occurrences takes in: those of the exceptions merged into it that were
 * seen last. As many as an exception's page lists and reads its occurrences
 * by (ExceptionExplorer, ExceptionSpanScope).
 */
export const MAX_MERGED_FINGERPRINTS_PER_EXCEPTION: number = 100;

/*
 * An exception's group fingerprints: its own, then those merged into it as
 * given, without blanks or repeats, at most
 * MAX_MERGED_FINGERPRINTS_PER_EXCEPTION of them.
 */
export function toExceptionGroupFingerprints(
  fingerprint: string,
  merged: ReadonlyArray<unknown>,
): Array<string> {
  const fingerprints: Array<string> =
    typeof fingerprint === "string" && fingerprint.length > 0
      ? [fingerprint]
      : [];
  let mergedCount: number = 0;

  for (const entry of merged) {
    if (mergedCount >= MAX_MERGED_FINGERPRINTS_PER_EXCEPTION) {
      break;
    }

    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      !fingerprints.includes(entry)
    ) {
      fingerprints.push(entry);
      mergedCount++;
    }
  }

  return fingerprints;
}

/*
 * What a read of occurrences (ExceptionInstance) asks their fingerprint to
 * be, for an exception's group fingerprints: its own alone - the query a read
 * asked before any merge - or any of them.
 */
export function getOccurrenceFingerprintQuery(
  fingerprints: ReadonlyArray<string>,
): string | Includes {
  return fingerprints.length === 1
    ? fingerprints[0]!
    : new Includes([...fingerprints]);
}

/*
 * THE GROUP FINGERPRINTS OF SOME EXCEPTIONS, FROM THE DASHBOARD.
 *
 * POST /telemetry-exception/group-fingerprints with { telemetryExceptionIds }
 * answers { exceptions: [{ telemetryExceptionId, fingerprints }] }: each
 * exception the reader may read, in the order asked, with its group's
 * fingerprints (TelemetryExceptionService.getGroupFingerprints). What an
 * exception's page reads its security events by, and what the Exceptions
 * monitor form's preview leaves out with a resolved or archived exception.
 * The server writes it; the Dashboard reads it back defensively.
 */

/*
 * The most exceptions one request asks about: as many as the Exceptions
 * monitor form's preview leaves out of each status.
 */
export const MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP: number = 1000;

// An exception asked about, and the fingerprints its occurrences carry.
export interface ExceptionGroupFingerprintsOfException {
  telemetryExceptionId: string;
  // Its own first, then those merged into it.
  fingerprints: Array<string>;
}

/*
 * The answer's entries, in its order, leaving out any that is not one: an
 * exception without an id, or without a fingerprint. Each one's
 * fingerprints are held to the group's bound.
 */
export function readExceptionGroupFingerprints(
  value: unknown,
): Array<ExceptionGroupFingerprintsOfException> {
  const exceptions: unknown =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)["exceptions"]
      : undefined;

  if (!Array.isArray(exceptions)) {
    return [];
  }

  const read: Array<ExceptionGroupFingerprintsOfException> = [];

  for (const entry of exceptions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const telemetryExceptionId: string =
      typeof record["telemetryExceptionId"] === "string"
        ? record["telemetryExceptionId"].trim()
        : "";
    const given: Array<unknown> = Array.isArray(record["fingerprints"])
      ? (record["fingerprints"] as Array<unknown>)
      : [];
    // Its own comes first: without it, the entry is not one.
    const own: string = typeof given[0] === "string" ? given[0] : "";

    if (!telemetryExceptionId || !own) {
      continue;
    }

    read.push({
      telemetryExceptionId,
      fingerprints: toExceptionGroupFingerprints(own, given.slice(1)),
    });
  }

  return read;
}

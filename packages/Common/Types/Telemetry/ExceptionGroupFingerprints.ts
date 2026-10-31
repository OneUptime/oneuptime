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

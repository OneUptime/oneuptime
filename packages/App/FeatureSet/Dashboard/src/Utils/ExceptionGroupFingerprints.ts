import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";

/*
 * THE FINGERPRINTS OF AN EXCEPTION'S WHOLE GROUP.
 *
 * An exception merged into another (TelemetryExceptionMerge) keeps its
 * fingerprint, and its occurrences keep theirs in ClickHouse: nothing there
 * is rewritten. So the page of the exception it was merged into reads its
 * occurrences by the fingerprints of the whole group - its own, then those
 * of the exceptions merged into it. Pure, for the tests.
 */

/*
 * The fingerprints of the exceptions merged into one, in the order they
 * were read, without repeats or its own.
 */
export function getMergedFingerprints(data: {
  fingerprint: string | undefined;
  members: ReadonlyArray<Pick<TelemetryException, "fingerprint">>;
}): Array<string> {
  const fingerprints: Array<string> = [];

  for (const member of data.members) {
    const fingerprint: string = member.fingerprint?.toString() || "";

    if (
      fingerprint &&
      fingerprint !== data.fingerprint &&
      !fingerprints.includes(fingerprint)
    ) {
      fingerprints.push(fingerprint);
    }
  }

  return fingerprints;
}

// The exception's own fingerprint, then those merged into it.
export function getGroupFingerprints(data: {
  fingerprint: string;
  mergedFingerprints?: ReadonlyArray<string> | undefined;
}): Array<string> {
  const fingerprints: Array<string> = [data.fingerprint];

  for (const fingerprint of data.mergedFingerprints || []) {
    if (fingerprint && !fingerprints.includes(fingerprint)) {
      fingerprints.push(fingerprint);
    }
  }

  return fingerprints;
}

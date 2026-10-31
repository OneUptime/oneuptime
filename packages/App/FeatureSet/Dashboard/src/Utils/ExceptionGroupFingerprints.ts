import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP } from "Common/Types/Telemetry/ExceptionGroupFingerprints";

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

/*
 * The server's answer for exceptions the page holds only by id
 * (TelemetryExceptionService.getGroupFingerprints): their group
 * fingerprints, read as the viewer.
 */
export const EXCEPTION_GROUP_FINGERPRINTS_ROUTE: string =
  "/telemetry-exception/group-fingerprints";

/*
 * The requests that ask for these exceptions' group fingerprints: each id
 * once, ids only, at most MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP to a
 * request. None for no id.
 */
export function buildExceptionGroupFingerprintsRequests(
  ids: ReadonlyArray<string>,
): Array<JSONObject> {
  const asked: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const id of ids) {
    const trimmed: string = typeof id === "string" ? id.trim() : "";

    if (
      ObjectID.isValidUUID(trimmed) &&
      !seen.has(trimmed.toLowerCase())
    ) {
      seen.add(trimmed.toLowerCase());
      asked.push(trimmed);
    }
  }

  const requests: Array<JSONObject> = [];

  for (
    let start: number = 0;
    start < asked.length;
    start += MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP
  ) {
    requests.push({
      telemetryExceptionIds: asked.slice(
        start,
        start + MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP,
      ),
    });
  }

  return requests;
}

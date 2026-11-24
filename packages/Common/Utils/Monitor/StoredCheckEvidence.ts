/*
 * WHAT AN INCIDENT, AN ALERT AND A STATE CHANGE KEEP OF A CHECK, AND HOW
 * BIG IT MAY GET (OneUptime issue #9189).
 *
 * The raw check an incident or an alert keeps (createdStateLog), and the
 * check kept on its state timeline (stateChangeLog) and on the monitor's
 * status timeline (statusChangeLog), are read as JSON text: View Logs.
 *
 *   - An incident or an alert opened for one series of a grouped monitor
 *     keeps that series only: its seriesBreakdown entry, and its points in
 *     metricResult. The other series of the evaluation are not evidence for
 *     it. The copy says which series it kept, and how many the evaluation
 *     looked at (EVIDENCE_SCOPE_FIELD).
 *   - Whatever is left is cut to STORED_CHECK_MAX_SIZE_IN_BYTES of JSON at
 *     most, and a copy that was cut says so (EVIDENCE_TRUNCATED_FIELD).
 *
 * Before, every alert of a grouped fleet monitor kept the whole evaluation -
 * every series of every query, 95 MB of JSON at 16,000 series - three times:
 * on the alert, its Identified row and its Resolved row.
 */

// The most a stored check's JSON may take, in bytes.
export const STORED_CHECK_MAX_SIZE_IN_BYTES: number = 256 * 1024;

// Set (true) on a stored check that was cut to fit.
export const EVIDENCE_TRUNCATED_FIELD: string = "isEvidenceTruncated";

/*
 * Set on a stored check kept for one series:
 * { seriesFingerprint, seriesInEvaluation }.
 */
export const EVIDENCE_SCOPE_FIELD: string = "evidenceScope";

export interface StoredCheckEvidenceScope {
  seriesFingerprint: string;
  // How many series the evaluation looked at.
  seriesInEvaluation: number;
}

/*
 * Set on the check a monitor's log keeps (MonitorLog.logBody) of a grouped
 * evaluation whose series were too many to keep in full (#10108): the log
 * keeps STORED_CHECK_MAX_SIZE_IN_BYTES of its series - those the evaluation
 * acted on first - and says here how many there were, so "16,250 series"
 * still reads 16,250.
 */
export const LOGGED_SERIES_FIELD: string = "loggedSeries";

export interface LoggedSeries {
  // How many series (or groups) the evaluation looked at.
  seriesInEvaluation: number;
  // How many of them had a data point.
  seriesWithDataInEvaluation: number;
  // How many the log kept.
  seriesKept: number;
}

export default class StoredCheckEvidence {
  // Was this stored check cut to fit? A log read back as JSON or as text.
  public static isTrimmed(log: unknown): boolean {
    if (log === null || log === undefined) {
      return false;
    }

    if (typeof log === "string") {
      try {
        return StoredCheckEvidence.isTrimmed(JSON.parse(log));
      } catch {
        return false;
      }
    }

    if (typeof log !== "object" || Array.isArray(log)) {
      return false;
    }

    return (log as Record<string, unknown>)[EVIDENCE_TRUNCATED_FIELD] === true;
  }
}

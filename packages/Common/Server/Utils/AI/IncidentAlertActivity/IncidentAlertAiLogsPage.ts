import {
  INCIDENT_ALERT_AI_LOG_KINDS,
  IncidentAlertAiLogEntry,
  IncidentAlertAiLogKind,
} from "../../../../Types/AI/IncidentAlertAiLogs";

/*
 * The pure half of the incident and alert AI Logs: how one page of the
 * chronological record is cut from what each kind's read found
 * (IncidentAlertAiLogsReader does the reading). No I/O and no clock.
 *
 * Each kind (investigations, fixes, fix tasks, commands) is read on its own,
 * newest first, a bounded number of rows at a time, and only some of those
 * rows become entries: a row about an incident or alert the caller may not
 * read is dropped. So a page cannot simply be "the newest N of everything":
 *
 *   - A kind whose read came back full may hold more rows older than the
 *     oldest one it returned. Below that moment the merge would be missing
 *     that kind's rows, so the page stops there - at the newest such moment
 *     across the full reads - and the next page starts from it.
 *   - Rows are created with microseconds; JavaScript dates hold
 *     milliseconds. A page that stops at a moment leaves out every entry of
 *     that millisecond, and the next page reads from the millisecond after
 *     it (strictly before), so nothing created in that same millisecond is
 *     skipped or shown twice.
 *   - A page cut because it is full keeps every entry of the millisecond it
 *     ends on, for the same reason.
 *
 * The one case that cannot move forward - one kind with more rows in a
 * single millisecond than its read takes - takes that millisecond whole and
 * moves past it; the rows of that millisecond beyond the read are skipped.
 */

// What one kind's read of a page found.
export interface IncidentAlertAiLogsKindScan {
  kind: IncidentAlertAiLogKind;
  // The rows the caller may see, as entries, in any order.
  entries: Array<IncidentAlertAiLogEntry>;
  // How many rows the read returned, seen or not.
  scanned: number;
  // How many rows the read asked for.
  limit: number;
  // When the oldest row the read returned was created, seen or not.
  oldestScannedAt?: Date | undefined;
}

export interface IncidentAlertAiLogsPageResult {
  // Newest first.
  entries: Array<IncidentAlertAiLogEntry>;
  // ISO: where the next page starts; null at the start of the record.
  nextBefore: string | null;
}

const MILLISECOND: number = 1;

function entryTime(entry: IncidentAlertAiLogEntry): number {
  const time: number = Date.parse(entry.at);
  return Number.isNaN(time) ? 0 : time;
}

export default class IncidentAlertAiLogsPage {
  /*
   * Newest first. Entries of the same millisecond keep one order every
   * time: by kind (an investigation before the fix it led to, before the
   * commands of both), then by id.
   */
  public static compareEntries(
    a: IncidentAlertAiLogEntry,
    b: IncidentAlertAiLogEntry,
  ): number {
    return (
      entryTime(b) - entryTime(a) ||
      INCIDENT_ALERT_AI_LOG_KINDS.indexOf(a.kind) -
        INCIDENT_ALERT_AI_LOG_KINDS.indexOf(b.kind) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }

  /*
   * The newest moment below which some full read may be missing rows: the
   * millisecond of the oldest row of each read that came back full, the
   * newest of those. Null when every read came back short, which means
   * each read reached the start of its record.
   */
  public static getBoundary(
    scans: ReadonlyArray<IncidentAlertAiLogsKindScan>,
  ): number | null {
    let boundary: number | null = null;

    for (const scan of scans) {
      if (scan.scanned < scan.limit || !scan.oldestScannedAt) {
        continue;
      }

      const oldest: number = scan.oldestScannedAt.getTime();

      if (Number.isNaN(oldest)) {
        continue;
      }

      boundary = boundary === null ? oldest : Math.max(boundary, oldest);
    }

    return boundary;
  }

  public static build(data: {
    scans: ReadonlyArray<IncidentAlertAiLogsKindScan>;
    pageSize: number;
    // The request's own `before`, as a time.
    before?: Date | undefined;
  }): IncidentAlertAiLogsPageResult {
    const pageSize: number = Math.max(1, Math.floor(data.pageSize));
    const boundary: number | null = this.getBoundary(data.scans);
    const before: number | null =
      data.before && !Number.isNaN(data.before.getTime())
        ? data.before.getTime()
        : null;

    /*
     * Stopping below the boundary's millisecond would start the next page
     * where this one started: take that millisecond whole instead.
     */
    const isStuck: boolean =
      boundary !== null && before !== null && boundary + MILLISECOND >= before;

    const all: Array<IncidentAlertAiLogEntry> = data.scans.flatMap(
      (scan: IncidentAlertAiLogsKindScan): Array<IncidentAlertAiLogEntry> => {
        return scan.entries;
      },
    );

    const candidates: Array<IncidentAlertAiLogEntry> = all
      .filter((entry: IncidentAlertAiLogEntry): boolean => {
        if (before !== null && entryTime(entry) >= before) {
          // A read that ignored `before` must not repeat the last page.
          return false;
        }

        if (boundary === null) {
          return true;
        }

        return isStuck
          ? entryTime(entry) >= boundary
          : entryTime(entry) >= boundary + MILLISECOND;
      })
      .sort((a: IncidentAlertAiLogEntry, b: IncidentAlertAiLogEntry) => {
        return this.compareEntries(a, b);
      });

    if (candidates.length > pageSize) {
      const lastTime: number = entryTime(candidates[pageSize - 1]!);
      let cut: number = pageSize;

      // Every entry of the millisecond the page ends on, or none of it.
      while (
        cut < candidates.length &&
        entryTime(candidates[cut]!) === lastTime
      ) {
        cut++;
      }

      return {
        entries: candidates.slice(0, cut),
        nextBefore: new Date(lastTime).toISOString(),
      };
    }

    if (boundary !== null) {
      return {
        entries: candidates,
        nextBefore: new Date(
          isStuck ? boundary : boundary + MILLISECOND,
        ).toISOString(),
      };
    }

    return { entries: candidates, nextBefore: null };
  }
}

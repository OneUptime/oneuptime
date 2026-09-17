import {
  MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
  clampRescanIntervalInMinutes,
  getNextScanAt,
} from "../../../Utils/NetworkDiscovery/RescanIntervalUtil";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: when a recurring discovery scan runs again.
 *
 * `nextScanAt` is the ONLY thing the requeue worker looks at — its query is
 * `isRecurring = true AND nextScanAt <= now AND status IN (Completed,
 * Failed)` — and `NULL <= now` is UNKNOWN in SQL, so a NULL there does not
 * mean "soon", it means "never". That is the shape of the bug this module was
 * written for: the column had exactly one writer, the endpoint that records a
 * finished run, and it only wrote when the scan was ALREADY recurring at that
 * moment. Turning recurrence on afterwards set the flag and scheduled
 * nothing, and the scans list rendered "Every 60 min" over a scan that would
 * never run again (OneUptime issue #3444).
 *
 * So the column stops being a fact somebody remembered to write and becomes
 * derived state: a function of the recurrence settings and the last
 * completion, recomputed by the service whenever those change. Two properties
 * carry the whole design and are pinned below:
 *
 *   - it is TOTAL. Every combination has an answer, and `null` is one of the
 *     answers rather than "no opinion" — a scan with recurrence off must have
 *     the column CLEARED, or turning recurrence back on months later would
 *     find a timestamp already in the past and fire an unasked-for sweep.
 *   - it is IDEMPOTENT. The same row always produces the same moment, so
 *     re-saving an unchanged schedule writes nothing. This is why it is not
 *     clamped forward to "now": a due-in-the-past answer is correct, and
 *     clamping would make every save move it.
 */

const COMPLETED_AT: Date = OneUptimeDate.fromString("2026-01-01T00:00:00.000Z");
const NOW: Date = OneUptimeDate.fromString("2026-01-01T00:30:00.000Z");

type MinutesAfterCompletionFunction = (result: Date | null) => number | null;

const minutesAfterCompletion: MinutesAfterCompletionFunction = (
  result: Date | null,
): number | null => {
  if (!result) {
    return null;
  }

  return (result.getTime() - COMPLETED_AT.getTime()) / 60000;
};

describe("clampRescanIntervalInMinutes", () => {
  it("leaves an interval at or above the floor alone", () => {
    expect(clampRescanIntervalInMinutes(15)).toBe(15);
    expect(clampRescanIntervalInMinutes(60)).toBe(60);
    expect(clampRescanIntervalInMinutes(1440)).toBe(1440);
  });

  /*
   * Clamped, not rejected — the stated policy of the ingest endpoint this
   * replaced. A row stored before the form enforced a floor, or by an API
   * client, still recurs; it just cannot outrun the probe.
   */
  it("raises a too-short interval to the floor rather than refusing it", () => {
    expect(clampRescanIntervalInMinutes(1)).toBe(
      MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
    );
    expect(clampRescanIntervalInMinutes(14)).toBe(
      MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
    );
  });

  /*
   * Null for everything that is not a cadence at all. Zero especially: the
   * column is nullable and a zero would otherwise divide the schedule into
   * "run again immediately, forever".
   */
  it("reports anything that is not a cadence as no cadence", () => {
    expect(clampRescanIntervalInMinutes(0)).toBeNull();
    expect(clampRescanIntervalInMinutes(-5)).toBeNull();
    expect(clampRescanIntervalInMinutes(null)).toBeNull();
    expect(clampRescanIntervalInMinutes(undefined)).toBeNull();
    expect(clampRescanIntervalInMinutes(NaN)).toBeNull();
    expect(clampRescanIntervalInMinutes(Infinity)).toBeNull();
  });

  it("keeps the floor the whole product is sized against", () => {
    expect(MINIMUM_RESCAN_INTERVAL_IN_MINUTES).toBe(15);
  });
});

describe("getNextScanAt", () => {
  it("schedules a finished recurring scan one interval after it finished", () => {
    const result: Date | null = getNextScanAt(
      {
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        status: "Completed",
        completedAt: COMPLETED_AT,
      },
      NOW,
    );

    expect(minutesAfterCompletion(result)).toBe(60);
  });

  /*
   * A failed sweep is still a completed run. Ending the recurrence because one
   * sweep failed would quietly turn a monitoring scan off at exactly the
   * moment something is wrong.
   */
  it("schedules a failed run the same way", () => {
    const result: Date | null = getNextScanAt(
      {
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        status: "Failed",
        completedAt: COMPLETED_AT,
      },
      NOW,
    );

    expect(minutesAfterCompletion(result)).toBe(60);
  });

  it("schedules nothing at all when recurrence is off", () => {
    expect(
      getNextScanAt(
        {
          isRecurring: false,
          rescanIntervalInMinutes: 60,
          status: "Completed",
          completedAt: COMPLETED_AT,
        },
        NOW,
      ),
    ).toBeNull();
  });

  /*
   * The gate the ingest endpoint has always had. A recurring scan with no
   * interval must not become due, or the worker re-queues it every minute
   * forever.
   */
  it("schedules nothing for a recurring scan with no usable interval", () => {
    for (const interval of [null, undefined, 0, -1]) {
      expect(
        getNextScanAt(
          {
            isRecurring: true,
            rescanIntervalInMinutes: interval,
            status: "Completed",
            completedAt: COMPLETED_AT,
          },
          NOW,
        ),
      ).toBeNull();
    }
  });

  /*
   * A run is already queued or under way; the endpoint that records its
   * result schedules the one after it. Answering here would race that.
   */
  it("schedules nothing while a run is queued or in flight", () => {
    for (const status of ["Pending", "In Progress"]) {
      expect(
        getNextScanAt(
          {
            isRecurring: true,
            rescanIntervalInMinutes: 60,
            status: status,
            completedAt: null,
          },
          NOW,
        ),
      ).toBeNull();
    }
  });

  it("applies the floor, so a one-minute cadence cannot be scheduled", () => {
    const result: Date | null = getNextScanAt(
      {
        isRecurring: true,
        rescanIntervalInMinutes: 1,
        status: "Completed",
        completedAt: COMPLETED_AT,
      },
      NOW,
    );

    expect(minutesAfterCompletion(result)).toBe(
      MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
    );
  });

  /*
   * Measured from the last run, never from the caller's clock — that is what
   * makes it safe to recompute on every save. The answer here is already in
   * the past, and deliberately so: the worker's predicate is `<= now`, so a
   * past moment reads as "due", and clamping it forward would make an
   * unchanged schedule rewrite the column every time it was saved.
   */
  it("answers with a moment already past for an overdue scan, rather than moving it", () => {
    const longAfter: Date = OneUptimeDate.fromString(
      "2026-06-01T00:00:00.000Z",
    );

    const result: Date | null = getNextScanAt(
      {
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        status: "Completed",
        completedAt: COMPLETED_AT,
      },
      longAfter,
    );

    expect(minutesAfterCompletion(result)).toBe(60);
    expect(result!.getTime()).toBeLessThan(longAfter.getTime());
  });

  it("gives the same answer every time it is asked", () => {
    const scan: {
      isRecurring: boolean;
      rescanIntervalInMinutes: number;
      status: string;
      completedAt: Date;
    } = {
      isRecurring: true,
      rescanIntervalInMinutes: 60,
      status: "Completed",
      completedAt: COMPLETED_AT,
    };

    expect(getNextScanAt(scan, NOW)!.getTime()).toBe(
      getNextScanAt(
        scan,
        OneUptimeDate.fromString("2026-03-03T03:03:00.000Z"),
      )!.getTime(),
    );
  });

  /*
   * A Completed row with no completedAt should not exist — every writer of one
   * writes the other — but a row written by an older build must still get a
   * next run rather than being stranded.
   */
  it("falls back to now for a finished scan that never recorded when", () => {
    const result: Date | null = getNextScanAt(
      {
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        status: "Completed",
        completedAt: null,
      },
      NOW,
    );

    expect(result!.getTime()).toBe(NOW.getTime() + 60 * 60000);
  });
});

import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import HeartbeatAvailabilityUtil, {
  HEARTBEAT_INGEST_LAG_MS,
  HeartbeatAvailabilityResult,
} from "../../../Utils/Telemetry/HeartbeatAvailability";
import { describe, expect, test } from "@jest/globals";

const MINUTE: number = 60_000;

/*
 * All scenarios use a fixed wall clock and a 30-minute window ending
 * at `now` — the Host overview page's default — unless stated
 * otherwise. The server grid for a <=3h window is 1-minute buckets
 * aligned to minute boundaries, so rows are minute-aligned here too.
 */
const NOW: Date = new Date("2026-06-13T10:30:30.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - 30 * MINUTE);

function row(timestamp: Date, count: number = 2): AggregatedModel {
  return { timestamp, value: count } as AggregatedModel;
}

function minuteRows(
  from: Date,
  minutes: Array<number>,
): Array<AggregatedModel> {
  const base: number = Math.floor(from.getTime() / MINUTE) * MINUTE;
  return minutes.map((m: number): AggregatedModel => {
    return row(new Date(base + m * MINUTE));
  });
}

function build(
  heartbeatData: Array<AggregatedModel>,
  windowStart: Date = WINDOW_START,
  windowEnd: Date = NOW,
  now: Date = NOW,
): HeartbeatAvailabilityResult {
  return HeartbeatAvailabilityUtil.buildAvailabilitySeries({
    heartbeatData,
    windowStart,
    windowEnd,
    now,
  });
}

function downPoints(result: HeartbeatAvailabilityResult): Array<number> {
  return result.points
    .filter((p: { x: Date; y: number }) => {
      return p.y === 0;
    })
    .map((p: { x: Date; y: number }) => {
      return p.x.getTime();
    });
}

describe("HeartbeatAvailabilityUtil.buildAvailabilitySeries", () => {
  test("healthy host with a heartbeat in every complete bucket is 100% with no down points", () => {
    /*
     * Window start 10:00:30 → first complete bucket is 10:01. Evaluable
     * end is 10:29:30 (now - lag) → last evaluable-complete bucket is
     * 10:28. Provide rows for every minute bucket in range.
     */
    const rows: Array<AggregatedModel> = minuteRows(
      WINDOW_START,
      Array.from({ length: 31 }, (_: unknown, i: number) => {
        return i;
      }),
    );
    const result: HeartbeatAvailabilityResult = build(rows);
    expect(result.uptimePercent).toBe(100);
    expect(downPoints(result)).toHaveLength(0);
    expect(result.points.length).toBeGreaterThan(25);
  });

  test("silent in-progress trailing bucket is excluded, not rendered as down", () => {
    /*
     * Rows for every bucket EXCEPT the in-progress one (10:30) and the
     * lag-shadowed one (10:29). The old implementation rendered those
     * as 0% and the uptime badge flapped to ~96% on every refresh.
     */
    const rows: Array<AggregatedModel> = minuteRows(
      WINDOW_START,
      Array.from({ length: 29 }, (_: unknown, i: number) => {
        return i;
      }),
    );
    const result: HeartbeatAvailabilityResult = build(rows);
    expect(result.uptimePercent).toBe(100);
    expect(downPoints(result)).toHaveLength(0);
  });

  test("present in-progress trailing bucket still proves UP", () => {
    const allMinutes: Array<number> = Array.from(
      { length: 31 },
      (_: unknown, i: number) => {
        return i;
      },
    );
    const rows: Array<AggregatedModel> = minuteRows(WINDOW_START, allMinutes);
    const withPartial: HeartbeatAvailabilityResult = build(rows);
    const withoutPartial: HeartbeatAvailabilityResult = build(
      rows.slice(0, -2),
    );
    // The two partial-bucket rows add points to the series.
    expect(withPartial.points.length).toBeGreaterThan(
      withoutPartial.points.length,
    );
    expect(withPartial.uptimePercent).toBe(100);
  });

  test("a single missing bucket (export jitter) is bridged to UP", () => {
    const minutes: Array<number> = Array.from(
      { length: 31 },
      (_: unknown, i: number) => {
        return i;
      },
    ).filter((m: number) => {
      return m !== 15;
    });
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(WINDOW_START, minutes),
    );
    expect(result.uptimePercent).toBe(100);
    expect(downPoints(result)).toHaveLength(0);
  });

  test("two consecutive missing buckets render as downtime", () => {
    const minutes: Array<number> = Array.from(
      { length: 31 },
      (_: unknown, i: number) => {
        return i;
      },
    ).filter((m: number) => {
      return m !== 15 && m !== 16;
    });
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(WINDOW_START, minutes),
    );
    expect(downPoints(result)).toHaveLength(2);
    expect(result.uptimePercent).not.toBeNull();
    expect(result.uptimePercent!).toBeLessThan(100);
  });

  test("a long outage in the middle of the window is fully reported", () => {
    // Up 10:01-10:10, silent 10:11-10:20, up again 10:21-10:28.
    const minutes: Array<number> = Array.from(
      { length: 31 },
      (_: unknown, i: number) => {
        return i;
      },
    ).filter((m: number) => {
      return m <= 10 || m >= 21;
    });
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(WINDOW_START, minutes),
    );
    expect(downPoints(result)).toHaveLength(10);
  });

  test("host completely silent for the whole window reports ~0%", () => {
    const result: HeartbeatAvailabilityResult = build([]);
    expect(result.uptimePercent).toBe(0);
    expect(result.points.length).toBeGreaterThan(25);
    expect(
      result.points.every((p: { x: Date; y: number }) => {
        return p.y === 0;
      }),
    ).toBe(true);
  });

  test("queue-lag scenario: bucket sizing comes from the window, not from data gaps", () => {
    /*
     * Heartbeats with a 2-minute hole (ingest backlog collapsed two
     * batches into one minute). The old smallest-gap inference could
     * derive a wrong bucket size from patterns like this and knock
     * genuine rows off the reconstructed grid; with the canonical
     * window-derived size the present rows all stay on-grid.
     */
    const minutes: Array<number> = [
      1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28,
    ];
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(WINDOW_START, minutes),
    );
    /*
     * Every provided row lands on the grid as UP (alternating gaps are
     * all single-bucket → bridged), and minute 5's neighbors 4 and 6
     * bridge it too.
     */
    expect(result.uptimePercent).toBe(100);
  });

  test("rows snapped within half a bucket of a slot still register", () => {
    /*
     * Simulate a serialization offset: every row shifted +20s off the
     * minute boundary. Exact-match would lose all of them.
     */
    const base: number =
      Math.floor(WINDOW_START.getTime() / MINUTE) * MINUTE + 20_000;
    const rows: Array<AggregatedModel> = Array.from(
      { length: 31 },
      (_: unknown, i: number): AggregatedModel => {
        return row(new Date(base + i * MINUTE));
      },
    );
    const result: HeartbeatAvailabilityResult = build(rows);
    expect(result.uptimePercent).toBe(100);
    expect(downPoints(result)).toHaveLength(0);
  });

  test("historical window (end far in the past) has no lag exclusion", () => {
    const windowEnd: Date = new Date(NOW.getTime() - 24 * 60 * MINUTE);
    const windowStart: Date = new Date(windowEnd.getTime() - 30 * MINUTE);
    const minutes: Array<number> = Array.from(
      { length: 31 },
      (_: unknown, i: number) => {
        return i;
      },
    ).filter((m: number) => {
      /*
       * Silent for the final three buckets of the window — a real
       * outage at the window's edge must not be masked by lag logic
       * because the window closed long ago.
       */
      return m < 28;
    });
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(windowStart, minutes),
      windowStart,
      windowEnd,
      NOW,
    );
    expect(downPoints(result).length).toBeGreaterThanOrEqual(2);
  });

  test("hour buckets are used for windows over 3 hours", () => {
    const windowEnd: Date = NOW;
    const windowStart: Date = new Date(NOW.getTime() - 24 * 60 * MINUTE);
    const hourMs: number = 60 * MINUTE;
    const base: number = Math.floor(windowStart.getTime() / hourMs) * hourMs;
    const rows: Array<AggregatedModel> = Array.from(
      { length: 25 },
      (_: unknown, i: number): AggregatedModel => {
        return row(new Date(base + i * hourMs));
      },
    );
    const result: HeartbeatAvailabilityResult = build(
      rows,
      windowStart,
      windowEnd,
      NOW,
    );
    expect(result.uptimePercent).toBe(100);
    // ~24 hour buckets, not ~1440 minute buckets.
    expect(result.points.length).toBeLessThanOrEqual(26);
  });

  test("returns null uptime when nothing is evaluable", () => {
    /*
     * Window entirely inside the lag shadow: started one lag-width
     * ago and ends now, with no heartbeat rows.
     */
    const windowStart: Date = new Date(NOW.getTime() - HEARTBEAT_INGEST_LAG_MS);
    const result: HeartbeatAvailabilityResult = build(
      [],
      windowStart,
      NOW,
      NOW,
    );
    expect(result.uptimePercent).toBeNull();
    expect(result.points).toHaveLength(0);
  });

  test("invalid window returns empty result", () => {
    const result: HeartbeatAvailabilityResult = build([], NOW, NOW, NOW);
    expect(result.uptimePercent).toBeNull();
    expect(result.points).toHaveLength(0);
  });

  test("rows with zero count are ignored", () => {
    const zeroRows: Array<AggregatedModel> = minuteRows(
      WINDOW_START,
      Array.from({ length: 31 }, (_: unknown, i: number) => {
        return i;
      }),
    ).map((r: AggregatedModel): AggregatedModel => {
      return { ...r, value: 0 } as AggregatedModel;
    });
    const result: HeartbeatAvailabilityResult = build(zeroRows);
    expect(result.uptimePercent).toBe(0);
  });

  test("reads MV-aliased `time` field when `timestamp` is absent", () => {
    const base: number = Math.floor(WINDOW_START.getTime() / MINUTE) * MINUTE;
    const rows: Array<AggregatedModel> = Array.from(
      { length: 31 },
      (_: unknown, i: number): AggregatedModel => {
        return {
          time: new Date(base + i * MINUTE).toISOString(),
          value: 1,
        } as unknown as AggregatedModel;
      },
    );
    const result: HeartbeatAvailabilityResult = build(rows);
    expect(result.uptimePercent).toBe(100);
  });

  test("no bridging at Day buckets: one fully missing day is real downtime", () => {
    /*
     * 10-day window → Day buckets. A whole day of silence is dozens
     * of missed heartbeats — bridging it away (as the Minute-grid
     * hysteresis would) must not happen at coarse widths.
     */
    const DAY: number = 24 * 60 * MINUTE;
    const windowStart: Date = new Date(NOW.getTime() - 10 * DAY);
    const base: number = Math.floor(windowStart.getTime() / DAY) * DAY;
    const rows: Array<AggregatedModel> = Array.from(
      { length: 11 },
      (_: unknown, i: number): AggregatedModel => {
        return row(new Date(base + i * DAY));
      },
    ).filter((_: AggregatedModel, i: number) => {
      // Day index 5 is mid-window with up neighbors on both sides.
      return i !== 5;
    });
    const result: HeartbeatAvailabilityResult = build(
      rows,
      windowStart,
      NOW,
      NOW,
    );
    expect(downPoints(result)).toHaveLength(1);
    expect(result.uptimePercent).not.toBeNull();
    expect(result.uptimePercent!).toBeLessThan(100);
  });

  test("jitter miss in the first complete bucket bridges off the excluded leading bucket", () => {
    /*
     * The leading partial bucket can never return a row (the query
     * filters time >= windowStart), so the first complete bucket has
     * no up neighbor on its left. A single jitter miss there must
     * still bridge — otherwise every missed beat produces a ~1-minute
     * false-down dip as it transits this position on the sliding
     * auto-refresh window.
     */
    const minutes: Array<number> = Array.from(
      { length: 29 },
      (_: unknown, i: number) => {
        return i + 2;
      },
    );
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(WINDOW_START, minutes),
    );
    expect(downPoints(result)).toHaveLength(0);
    expect(result.uptimePercent).toBe(100);
  });

  test("jitter miss adjacent to the trailing lag shadow bridges off its single up neighbor", () => {
    /*
     * Rows for minutes 1-27; miss at 28; 29/30 still in the ingest
     * queue (excluded). The miss has up on the left and unknown on the
     * right — bridge, don't flap.
     */
    const minutes: Array<number> = Array.from(
      { length: 27 },
      (_: unknown, i: number) => {
        return i + 1;
      },
    );
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(WINDOW_START, minutes),
    );
    expect(downPoints(result)).toHaveLength(0);
    expect(result.uptimePercent).toBe(100);
  });

  test("a silent bucket with no up witness on either side stays down", () => {
    /*
     * 2-minute window ending now with no rows: the single evaluable
     * bucket sits between the excluded leading and trailing buckets.
     * Excluded neighbors are wildcards, not witnesses — with no up
     * neighbor at all the bucket must render down.
     */
    const windowStart: Date = new Date(NOW.getTime() - 2 * MINUTE);
    const result: HeartbeatAvailabilityResult = build(
      [],
      windowStart,
      NOW,
      NOW,
    );
    expect(result.uptimePercent).toBe(0);
    expect(downPoints(result).length).toBeGreaterThanOrEqual(1);
  });

  test("bucket-aligned window start: first-bucket jitter miss still bridges", () => {
    /*
     * When windowStart lands exactly on a bucket boundary the grid has
     * no excluded leading slot — the first slot's left neighbor is
     * simply out of grid. Out-of-grid must count as a wildcard (like
     * excluded), so a single jitter miss in slot 0 with an up
     * right-neighbor bridges instead of rendering a false down.
     */
    const windowStart: Date = new Date(
      Math.floor((NOW.getTime() - 30 * MINUTE) / MINUTE) * MINUTE,
    );
    const minutes: Array<number> = Array.from(
      { length: 30 },
      (_: unknown, i: number) => {
        return i + 1;
      },
    );
    const result: HeartbeatAvailabilityResult = build(
      minuteRows(windowStart, minutes),
      windowStart,
      NOW,
      NOW,
    );
    expect(downPoints(result)).toHaveLength(0);
    expect(result.uptimePercent).toBe(100);
  });
});

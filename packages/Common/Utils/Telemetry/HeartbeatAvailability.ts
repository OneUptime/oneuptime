import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../Types/BaseDatabase/AggregationIntervalUtil";

/*
 * Shared availability-series builder for the synthetic
 * `oneuptime.host.heartbeat` metric, used by the Host, Docker host,
 * and Kubernetes cluster overview pages. Input is the result of a
 * Count aggregation over the heartbeat metric; output is a step
 * series (100 = up, 0 = down) plus an uptime percentage.
 *
 * ClickHouse only returns rows for buckets that contain data, so the
 * empty (down) buckets must be synthesized client-side. Doing that
 * naively — exact-match every grid timestamp against returned rows,
 * count every miss as down — made the chart flap for healthy hosts
 * (one ~30-60s heartbeat per bucket leaves zero margin), so this
 * builder applies three rules the naive version lacked:
 *
 * 1. The bucket width is derived from the query window with the same
 *    thresholds the server's statement generator uses
 *    (AggregationIntervalUtil), never inferred from gaps in the data
 *    — inferring from gaps let a missing bucket double the inferred
 *    width and knock real rows off the reconstructed grid.
 *
 * 2. A bucket that cannot be fully evaluated yet — the in-progress
 *    bucket at the window's trailing edge, plus an ingest-lag buffer
 *    behind it — can prove the host UP (a heartbeat already arrived)
 *    but never DOWN (silence may just mean the batch is still in the
 *    ingest queue). Silent unevaluable buckets are excluded from both
 *    the series and the uptime %, instead of rendering as a false
 *    0% spike that disappears on the next auto-refresh.
 *
 * 3. Hysteresis, on the Minute grid only: a single empty bucket whose
 *    grid neighbors show no downtime (at least one up, the other up or
 *    unevaluable) is bridged to UP. One missing beat is overwhelmingly
 *    export/transport jitter when the emission interval (~30-60s) is
 *    the same order as the bucket width; a real outage at that
 *    resolution always spans >= 2 consecutive buckets. At Hour and
 *    coarser widths an empty bucket means dozens of consecutive
 *    missed beats — genuine downtime — so no bridging applies there.
 */

export interface HeartbeatAvailabilityPoint {
  x: Date;
  y: number;
}

export interface HeartbeatAvailabilityResult {
  points: Array<HeartbeatAvailabilityPoint>;
  /** Percentage 0-100, or null when no bucket could be evaluated. */
  uptimePercent: number | null;
}

/*
 * How long after a bucket closes we keep treating silence in it as
 * "not evaluable yet" rather than "down". Covers collector export
 * jitter + transport + ingest-queue wait for a heartbeat stamped near
 * the end of the bucket.
 *
 * Worst-case downtime-onset-to-report on the Minute grid is the sum
 * of: up to one bucket of in-bucket residual (outage right after a
 * beat at a bucket start), one bucket to close, this lag buffer, and
 * one more bucket for the bridge's right-neighbor witness to turn
 * down — ~4 minutes total. The old behavior (report instantly, flap
 * constantly on every refresh) was not worth those minutes.
 */
export const HEARTBEAT_INGEST_LAG_MS: number = 60_000;

/*
 * Upper bound on how far the ingest pipeline may backdate a heartbeat
 * from the ingest wall clock when trusting the batch's own scrape
 * timestamps (see the heartbeat stamping in OtelMetricsIngestService,
 * which imports this). The invariant that keeps a floored heartbeat
 * rendering as UP here: this bound must stay <= one Minute bucket
 * (60s, where the floored stamp lands and proves the bucket up)
 * + HEARTBEAT_INGEST_LAG_MS (the unevaluable shadow) — with the
 * single transitional bucket in between rescued by the Minute-grid
 * bridge. Raise it past that and behind-skewed host clocks get a
 * permanent false "down" tail at the chart's right edge.
 */
export const HEARTBEAT_MAX_BACKDATE_MS: number = 2 * 60_000;

export class HeartbeatAvailabilityUtil {
  public static buildAvailabilitySeries(data: {
    heartbeatData: Array<AggregatedModel>;
    windowStart: Date;
    windowEnd: Date;
    now: Date;
  }): HeartbeatAvailabilityResult {
    const windowStartMs: number = data.windowStart.getTime();
    const windowEndMs: number = data.windowEnd.getTime();
    const nowMs: number = data.now.getTime();

    if (
      !Number.isFinite(windowStartMs) ||
      !Number.isFinite(windowEndMs) ||
      windowEndMs <= windowStartMs
    ) {
      return { points: [], uptimePercent: null };
    }

    const interval: AggregationInterval =
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: data.windowStart,
        endDate: data.windowEnd,
      });
    const bucketMs: number =
      AggregationIntervalUtil.getAggregationIntervalMs(interval);

    const rowTimestamps: Array<number> = [];
    for (const p of data.heartbeatData) {
      const t: number = this.getBucketTimestamp(p);
      const c: number = Number(p["value"]);
      if (Number.isFinite(t) && Number.isFinite(c) && c > 0) {
        rowTimestamps.push(t);
      }
    }
    rowTimestamps.sort((a: number, b: number): number => {
      return a - b;
    });

    /*
     * Anchor the grid to the first returned row rather than to the
     * window start: server buckets are `toStartOfInterval`-aligned and
     * the window start generally isn't, and anchoring to real data
     * also absorbs any constant offset introduced by timestamp
     * serialization. With no rows at all, anchor to the window start —
     * everything is down regardless of alignment.
     */
    const anchorMs: number =
      rowTimestamps.length > 0 ? rowTimestamps[0]! : windowStartMs;
    const stepsBack: number = Math.ceil((anchorMs - windowStartMs) / bucketMs);
    const gridStartMs: number = anchorMs - stepsBack * bucketMs;
    const lastIndex: number = Math.floor(
      (windowEndMs - gridStartMs) / bucketMs,
    );

    /*
     * Snap each row to its nearest grid slot instead of requiring
     * exact equality. Minute/hour buckets land exactly; day buckets
     * can drift by an hour against a fixed 24h step when timestamps
     * cross a DST boundary in the rendering timezone, and Month/Year
     * widths are calendar-approximate — nearest-slot matching with a
     * half-bucket tolerance absorbs all of those without ever mapping
     * one row to two slots.
     */
    const presentSlots: Set<number> = new Set<number>();
    for (const t of rowTimestamps) {
      const index: number = Math.round((t - gridStartMs) / bucketMs);
      if (index >= 0 && index <= lastIndex) {
        presentSlots.add(index);
      }
    }

    /*
     * A bucket is only evaluable as DOWN once it has fully closed and
     * the ingest-lag buffer has passed. Buckets are also partial when
     * they start before the window does (leading edge of the grid).
     */
    const evaluableEndMs: number = Math.min(
      windowEndMs,
      nowMs - HEARTBEAT_INGEST_LAG_MS,
    );

    /*
     * Classify every grid slot. "excluded" = unevaluable and silent
     * (partial leading bucket, or trailing buckets still inside the
     * in-progress/ingest-lag shadow) — neither up nor down, just
     * unknown; it contributes nothing to the series or the uptime %.
     */
    type SlotState = "up" | "down" | "excluded";
    const states: Array<SlotState> = [];
    for (let index: number = 0; index <= lastIndex; index++) {
      const startMs: number = gridStartMs + index * bucketMs;
      const up: boolean = presentSlots.has(index);
      const isPartial: boolean =
        startMs < windowStartMs || startMs + bucketMs > evaluableEndMs;
      if (up) {
        states.push("up");
      } else if (isPartial) {
        states.push("excluded");
      } else {
        states.push("down");
      }
    }

    /*
     * Bridge single-bucket gaps — but only on the Minute grid. The
     * hysteresis is justified by one missed 30-60s heartbeat emptying
     * a 60s bucket; at Hour+ widths an empty bucket is dozens of
     * consecutive missed beats — a real outage — and bridging it
     * would erase up to a full bucket of genuine downtime from both
     * the chart and the uptime %.
     *
     * Neighbor checks run in grid-index space against the ORIGINAL
     * states (no chaining): a down slot bridges when both grid
     * neighbors show no downtime AND at least one of them is a real
     * up — an excluded or out-of-grid neighbor is unknown, not
     * evidence of life, so it counts as a wildcard but never as the
     * sole witness. This covers the window edges regardless of
     * whether the window happens to align with a bucket boundary: a
     * jitter miss in the first or last evaluable bucket bridges off
     * its single up neighbor instead of rendering a one-refresh
     * false-down flap.
     */
    const allowBridge: boolean = bucketMs <= 2 * 60_000;
    const isBridged: (index: number) => boolean = (index: number): boolean => {
      if (!allowBridge) {
        return false;
      }
      const left: SlotState | undefined = states[index - 1];
      const right: SlotState | undefined = states[index + 1];
      const leftOk: boolean = left !== "down";
      const rightOk: boolean = right !== "down";
      return leftOk && rightOk && (left === "up" || right === "up");
    };

    const points: Array<HeartbeatAvailabilityPoint> = [];
    let upCount: number = 0;
    let evaluatedCount: number = 0;
    for (let index: number = 0; index <= lastIndex; index++) {
      const state: SlotState = states[index]!;
      if (state === "excluded") {
        continue;
      }
      const up: boolean = state === "up" || isBridged(index);
      points.push({
        x: new Date(gridStartMs + index * bucketMs),
        y: up ? 100 : 0,
      });
      evaluatedCount++;
      if (up) {
        upCount++;
      }
    }

    return {
      points,
      uptimePercent:
        evaluatedCount > 0 ? (upCount / evaluatedCount) * 100 : null,
    };
  }

  /*
   * AggregatedModel exposes the bucket timestamp on `timestamp`, but
   * the MV statement path aliases its time column to `time` — read
   * whichever is present so rows are never silently dropped.
   */
  private static getBucketTimestamp(p: AggregatedModel): number {
    const raw: unknown =
      p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
    if (raw instanceof Date) {
      return raw.getTime();
    }
    if (typeof raw === "string" || typeof raw === "number") {
      return new Date(raw).getTime();
    }
    return NaN;
  }
}

export default HeartbeatAvailabilityUtil;

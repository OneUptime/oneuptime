import MetricSeriesArrival from "../../Types/Monitor/MetricMonitor/MetricSeriesArrival";

const MINUTE_IN_MS: number = 60 * 1000;

/*
 * What a read of a series' rows says about when they arrived: the newest and
 * oldest createdAt among them, how many distinct minutes something arrived
 * in, and the createdAt and time of its newest data point. All in
 * milliseconds since the epoch.
 */
export interface MetricSeriesArrivalAggregates {
  newestArrivalMs: number;
  oldestArrivalMs: number;
  arrivalMinuteCount: number;
  newestPointArrivalMs: number;
  newestPointTimeMs: number;
}

/**
 * Builds and combines MetricSeriesArrival - when a metric series' data
 * arrived at OneUptime, as opposed to the time its data points measure.
 */
export default class MetricSeriesArrivalUtil {
  /*
   * A series' arrival from what its rows say (MetricService
   * .readSeriesArrivals), as of `asOfMs`: the end of the window the rows were
   * read over (where the ingest queue is while it is behind, so OneUptime's
   * own backlog never counts as a series' silence). Null when the read gave
   * no usable time.
   */
  public static fromAggregates(input: {
    asOfMs: number;
    aggregates: MetricSeriesArrivalAggregates;
  }): MetricSeriesArrival | null {
    const aggregates: MetricSeriesArrivalAggregates = input.aggregates;

    if (
      !MetricSeriesArrivalUtil.isTime(input.asOfMs) ||
      !MetricSeriesArrivalUtil.isTime(aggregates.newestArrivalMs)
    ) {
      return null;
    }

    const oldestArrivalMs: number = MetricSeriesArrivalUtil.isTime(
      aggregates.oldestArrivalMs,
    )
      ? Math.min(aggregates.oldestArrivalMs, aggregates.newestArrivalMs)
      : aggregates.newestArrivalMs;

    /*
     * Shared out over the minutes something arrived in, not the rows: a
     * source that writes five minutes of data points at once (CloudWatch's
     * receiver, every five minutes) arrives every five minutes, and a batch
     * written across the turn of a second is still one arrival.
     */
    const arrivalMinuteCount: number = Math.floor(
      Number(aggregates.arrivalMinuteCount),
    );
    const spanMs: number = aggregates.newestArrivalMs - oldestArrivalMs;
    const arrivalIntervalMs: number | null =
      Number.isFinite(arrivalMinuteCount) &&
      arrivalMinuteCount >= 2 &&
      spanMs >= MINUTE_IN_MS
        ? spanMs / (arrivalMinuteCount - 1)
        : null;

    const lagMs: number =
      MetricSeriesArrivalUtil.isTime(aggregates.newestPointArrivalMs) &&
      MetricSeriesArrivalUtil.isTime(aggregates.newestPointTimeMs)
        ? Math.max(
            0,
            aggregates.newestPointArrivalMs - aggregates.newestPointTimeMs,
          )
        : 0;

    return {
      sinceNewestArrivalMs: Math.max(
        0,
        input.asOfMs - aggregates.newestArrivalMs,
      ),
      lagMs: lagMs,
      arrivalIntervalMs: arrivalIntervalMs,
    };
  }

  /*
   * A formula's arrival, from the arrivals of the queries it reads: it is
   * only as fresh as the stalest of them, as late as the latest, and its
   * data arrives as seldom as the slowest's. The queries whose arrivals were
   * not read are left out (they were not behind); null when none was read.
   */
  public static combine(
    arrivals: Array<MetricSeriesArrival | null | undefined>,
  ): MetricSeriesArrival | null {
    let combined: MetricSeriesArrival | null = null;

    for (const arrival of arrivals) {
      if (!arrival) {
        continue;
      }

      if (!combined) {
        combined = { ...arrival };
        continue;
      }

      combined = {
        sinceNewestArrivalMs: Math.max(
          combined.sinceNewestArrivalMs,
          arrival.sinceNewestArrivalMs,
        ),
        lagMs: Math.max(combined.lagMs, arrival.lagMs),
        arrivalIntervalMs:
          combined.arrivalIntervalMs === null
            ? arrival.arrivalIntervalMs
            : arrival.arrivalIntervalMs === null
              ? combined.arrivalIntervalMs
              : Math.max(combined.arrivalIntervalMs, arrival.arrivalIntervalMs),
      };
    }

    return combined;
  }

  private static isTime(value: number): boolean {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}

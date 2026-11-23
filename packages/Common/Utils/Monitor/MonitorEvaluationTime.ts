import MonitorEvaluationSummary from "../../Types/Monitor/MonitorEvaluationSummary";
import { Translator } from "../../Types/Translator";
import { formatDurationInUnit, formatMilliseconds } from "../Milliseconds";

/*
 * HOW LONG A MONITOR'S EVALUATION TOOK, AND WHEN THAT IS TOO LONG (#10317).
 *
 * A grouped Metrics monitor over 16,000 series once took 20 to 30 seconds
 * to evaluate, every time, and nothing told its owner: they measured it
 * from ClickHouse's query log (#10108). Each evaluation now says on its
 * monitor log entry how long it took and how many series it judged
 * (MonitorEvaluationSummary.durationInMs and seriesJudged), and the
 * evaluation summary warns when it took too long.
 *
 * Too long is weighed against how often the monitor is evaluated: an
 * evaluation is slow once it takes more than a tenth of its monitor's
 * interval, but never under 5 seconds, and always past a minute.
 *
 *   - A tenth of the interval. A monitor's next evaluation is due one
 *     interval after this one began; one that runs past it holds the
 *     monitor's lock when the next begins, which waits, is retried and
 *     falls behind. A tenth leaves room for the monitor to grow tenfold -
 *     more series, more data - before it does: the warning comes long
 *     before the trouble, not with it.
 *   - Never under 5 seconds. Reading and judging a large check takes a few
 *     seconds and is fine: the #10108 fleet's 16,250 series take about 2.5
 *     seconds. A tenth of a 30-second or 1-minute interval (3 or 6 seconds)
 *     would otherwise call that slow.
 *   - Always past a minute. An evaluation holds a worker of its queue - a
 *     telemetry monitor's shares the telemetry queue's workers with
 *     telemetry ingest - and the databases it reads for as long as it runs,
 *     whatever its interval. An hourly monitor taking six minutes is not
 *     about to fall behind its interval, but it is heavy all the same.
 *
 * A monitor evaluated as its results arrive - an incoming request or email,
 * a server's agent - has no interval: its evaluations queue one behind
 * another, so one slower than 5 seconds holds up the next.
 */

// Under this, no evaluation is slow.
export const SLOW_EVALUATION_FLOOR_IN_MS: number = 5 * 1000;

// The share of its monitor's interval past which an evaluation is slow.
export const SLOW_EVALUATION_SHARE_OF_INTERVAL: number = 0.1;

// Past this, every evaluation is slow.
export const SLOW_EVALUATION_CEILING_IN_MS: number = 60 * 1000;

const SECOND_IN_MS: number = 1000;
const MINUTE_IN_MS: number = 60 * SECOND_IN_MS;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

export default class MonitorEvaluationTime {
  /*
   * How long an evaluation may take before it is called slow, for a monitor
   * evaluated every `intervalInMs` (or as its results arrive, when there is
   * none).
   */
  public static getSlowThresholdInMs(
    intervalInMs: number | null | undefined,
  ): number {
    if (
      typeof intervalInMs !== "number" ||
      !Number.isFinite(intervalInMs) ||
      intervalInMs <= 0
    ) {
      return SLOW_EVALUATION_FLOOR_IN_MS;
    }

    return Math.min(
      SLOW_EVALUATION_CEILING_IN_MS,
      Math.max(
        SLOW_EVALUATION_FLOOR_IN_MS,
        intervalInMs * SLOW_EVALUATION_SHARE_OF_INTERVAL,
      ),
    );
  }

  // Whether the evaluation a summary describes took too long.
  public static isSlow(
    summary:
      | Pick<MonitorEvaluationSummary, "durationInMs" | "intervalInMs">
      | null
      | undefined,
  ): boolean {
    const durationInMs: unknown = summary?.durationInMs;

    if (typeof durationInMs !== "number" || !Number.isFinite(durationInMs)) {
      return false;
    }

    return durationInMs > this.getSlowThresholdInMs(summary?.intervalInMs);
  }

  /*
   * A time an evaluation took, or an interval, in the unit that reads best
   * and the reader's language: "820 ms", "2.4 s", "1.5 min", "2 h", "1 d"
   * ("2,4 Sek.", "۲٫۴ ثانیه"), the figure held to its unit.
   */
  public static formatDuration(
    translator: Translator,
    durationInMs: number,
  ): string {
    if (!Number.isFinite(durationInMs) || durationInMs < 0) {
      return formatMilliseconds(translator, Number.NaN);
    }

    if (durationInMs < SECOND_IN_MS) {
      return formatMilliseconds(translator, durationInMs, {
        maximumFractionDigits: 0,
      });
    }

    if (durationInMs < MINUTE_IN_MS) {
      return this.formatIn(translator, durationInMs / SECOND_IN_MS, "second");
    }

    if (durationInMs < HOUR_IN_MS) {
      return this.formatIn(translator, durationInMs / MINUTE_IN_MS, "minute");
    }

    if (durationInMs < DAY_IN_MS) {
      return this.formatIn(translator, durationInMs / HOUR_IN_MS, "hour");
    }

    return this.formatIn(translator, durationInMs / DAY_IN_MS, "day");
  }

  // A figure to a tenth, a whole one without its ".0": "2.4 s", "5 min".
  private static formatIn(
    translator: Translator,
    value: number,
    unit: "second" | "minute" | "hour" | "day",
  ): string {
    return formatDurationInUnit(translator, value, unit, {
      decimals: 1,
      dropTrailingZeros: true,
    });
  }
}

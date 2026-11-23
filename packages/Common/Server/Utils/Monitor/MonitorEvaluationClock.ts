import { performance } from "perf_hooks";
import CronParser, { CronExpression } from "cron-parser";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import DataToProcess from "./DataToProcess";
import MonitorStoredCheck from "./MonitorStoredCheck";
import MonitoringIntervalValidator from "./MonitoringIntervalValidator";

/*
 * THE CLOCK OF ONE EVALUATION (issue #10317).
 *
 * Nothing told a monitor's owner how heavy its evaluations were: the
 * reporter of #10108 measured a grouped monitor's 20 to 30 seconds from
 * ClickHouse's query log. Each evaluation now writes on its monitor log
 * entry's evaluation summary how long it took (durationInMs), how many
 * series it judged (seriesJudged) and how often its monitor is evaluated
 * (intervalInMs), which the summary weighs its time against
 * (MonitorEvaluationTime.isSlow).
 *
 * The time is wall-clock, on the process's monotonic clock: from when the
 * evaluation began - a telemetry check's first read, which comes before
 * MonitorResourceUtil.monitorResource (its evaluationStartedAtMs), or the
 * moment monitorResource began for anything else - until its monitor log
 * entry is written (MonitorLogUtil.saveMonitorLog). Waiting for the
 * monitor's lock counts: an evaluation that waits is late all the same.
 *
 * Kept beside the summary, not in it, until the end: a summary captured
 * part way through - the one an incident or an alert keeps - holds none of
 * it, as it did not know it yet.
 */

interface EvaluationClock {
  // When the evaluation began, on the clock now() reads.
  startedAtMs: number;
  intervalInMs?: number | undefined;
}

const clocks: WeakMap<MonitorEvaluationSummary, EvaluationClock> = new WeakMap<
  MonitorEvaluationSummary,
  EvaluationClock
>();

// How often a telemetry monitor with no schedule it can read is evaluated.
const TELEMETRY_DEFAULT_INTERVAL_IN_MS: number = 60 * 1000;

export default class MonitorEvaluationClock {
  // The process's monotonic clock, in milliseconds: an evaluation's start is told in it.
  public static now(): number {
    return performance.now();
  }

  /*
   * An evaluation begins, with its summary: at `startedAtMs` when it began
   * before it (a telemetry check's reads), now otherwise.
   */
  public static begin(
    summary: MonitorEvaluationSummary,
    startedAtMs?: number | undefined,
  ): void {
    clocks.set(summary, {
      startedAtMs:
        typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
          ? startedAtMs
          : this.now(),
    });
  }

  // Once its monitor is read: what the evaluation's time is weighed against.
  public static schedule(
    summary: MonitorEvaluationSummary,
    monitor: Pick<Monitor, "monitorType" | "monitoringInterval">,
  ): void {
    const clock: EvaluationClock | undefined = clocks.get(summary);

    if (!clock) {
      return;
    }

    clock.intervalInMs = this.getIntervalInMs({
      monitorType: monitor.monitorType,
      monitoringInterval: monitor.monitoringInterval,
      from: summary.evaluatedAt || new Date(),
    });
  }

  /*
   * The evaluation ends as its monitor log entry is written: its summary
   * says how long it took, how many series it judged and how often its
   * monitor is evaluated. Ends a summary once; one that never began here
   * (a check stored some other way) is left as it is.
   */
  public static end(check: DataToProcess | null | undefined): void {
    const summary: MonitorEvaluationSummary | undefined = (
      check as { evaluationSummary?: MonitorEvaluationSummary } | undefined
    )?.evaluationSummary;

    if (!summary) {
      return;
    }

    const clock: EvaluationClock | undefined = clocks.get(summary);

    if (!clock) {
      return;
    }

    clocks.delete(summary);

    summary.durationInMs = Math.max(
      0,
      Math.round(this.now() - clock.startedAtMs),
    );

    const seriesJudged: number | undefined =
      MonitorStoredCheck.countSeries(check);

    if (seriesJudged !== undefined) {
      summary.seriesJudged = seriesJudged;
    }

    if (clock.intervalInMs !== undefined) {
      summary.intervalInMs = clock.intervalInMs;
    }
  }

  /*
   * How often a monitor is evaluated, in milliseconds: the time between the
   * next two runs of its schedule after `from` - a cron expression, or a
   * cadence ("5m") read as one, as its scheduler reads it. Undefined for a
   * monitor evaluated as its results arrive (an incoming request or email,
   * a server's agent) and for a schedule that cannot be read; a telemetry
   * monitor's is then every minute, as its scheduler falls back to
   * (getTelemetryMonitorNextMonitorAt).
   */
  public static getIntervalInMs(input: {
    monitorType: MonitorType | undefined;
    monitoringInterval: string | null | undefined;
    from: Date;
  }): number | undefined {
    if (!input.monitorType) {
      return undefined;
    }

    const isTelemetryMonitor: boolean = MonitorTypeHelper.isTelemetryMonitor(
      input.monitorType,
    );

    if (
      !isTelemetryMonitor &&
      !MonitorTypeHelper.doesMonitorTypeHaveInterval(input.monitorType)
    ) {
      return undefined;
    }

    const scheduled: number | undefined = this.readScheduleInMs(
      input.monitoringInterval,
      input.from,
    );

    if (scheduled !== undefined) {
      return scheduled;
    }

    return isTelemetryMonitor ? TELEMETRY_DEFAULT_INTERVAL_IN_MS : undefined;
  }

  private static readScheduleInMs(
    monitoringInterval: string | null | undefined,
    from: Date,
  ): number | undefined {
    if (typeof monitoringInterval !== "string" || !monitoringInterval.trim()) {
      return undefined;
    }

    for (const schedule of [
      monitoringInterval,
      MonitoringIntervalValidator.normalizeForRead(monitoringInterval),
    ]) {
      if (!schedule) {
        continue;
      }

      try {
        const expression: CronExpression = CronParser.parseExpression(
          schedule,
          { currentDate: from },
        );
        const next: number = expression.next().toDate().getTime();
        const after: number = expression.next().toDate().getTime();

        if (after > next) {
          return after - next;
        }
      } catch {
        // Not this reading of it: try the next.
      }
    }

    return undefined;
  }
}

import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import CountAnomaly, {
  CountAnomalyEvaluation,
  CountBaselineSummary,
} from "./CountAnomaly";
import {
  AnomalyDetectionMethod,
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
} from "../../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import LogMonitorGroupResult, {
  LogMonitorGroupResultUtil,
} from "../../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor from "../../../../Types/Monitor/MonitorStepLogMonitor";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import LogCountBaselineService from "../../../Services/LogCountBaselineService";
import { MetricBaselineService as MetricBaselineServiceClass } from "../../../Services/MetricBaselineService";
import logger from "../../Logger";

export default class LogMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor step carries the log query (services / severities /
     * evaluation window) the anomaly path scopes its baseline lookup
     * to. Optional for backward compatibility — static threshold
     * filters never need it.
     */
    monitorStep?: MonitorStep | undefined;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.LogCount) {
      const logResponse: LogMonitorResponse =
        input.dataToProcess as LogMonitorResponse;

      const isGrouped: boolean =
        Array.isArray(logResponse.groupBreakdown) ||
        Boolean(logResponse.evaluatedGroup);

      /*
       * Anomaly filters skip the static threshold entirely: the
       * observed log rate is compared to this monitor's scope in the
       * same-hour-of-week LogCountBaseline, mirroring the metric
       * monitor's baseline path.
       */
      if (
        CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
      ) {
        /*
         * The baseline is the volume of the monitor's whole scope; there
         * is none per group. Judging one tunnel's count against every
         * tunnel's combined baseline would call each of them anomalously
         * low, so a grouped monitor's anomaly filters do not match.
         */
        if (isGrouped) {
          return null;
        }

        return await LogMonitorCriteria.evaluateLogCountAnomaly({
          logResponse: logResponse,
          criteriaFilter: input.criteriaFilter,
          monitorStep: input.monitorStep,
        });
      }

      threshold = CompareCriteria.convertToNumber(threshold);

      /*
       * A grouped monitor's verdict for the monitor as a whole: the filter
       * holds when at least one group's count satisfies it, the way a
       * grouped metric filter holds when one series does. Comparing the
       * total instead would let "fewer than 5 terminations" fail on the
       * sum while one tunnel sits at 2. The per-group pass in
       * MonitorCriteriaEvaluator then decides which groups alert.
       */
      if (logResponse.groupBreakdown) {
        for (const group of logResponse.groupBreakdown) {
          const groupMessage: string | null =
            CompareCriteria.compareCriteriaNumbers({
              value: group.logCount || 0,
              threshold: threshold as number,
              criteriaFilter: input.criteriaFilter,
            });

          if (groupMessage) {
            return LogMonitorCriteria.forGroup(group, groupMessage);
          }
        }

        return null;
      }

      const currentLogCount: number = logResponse.logCount || 0;

      const message: string | null = CompareCriteria.compareCriteriaNumbers({
        value: currentLogCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });

      // One group, judged alone by the per-group pass: say which one.
      if (message && logResponse.evaluatedGroup) {
        return LogMonitorCriteria.forGroup(logResponse.evaluatedGroup, message);
      }

      return message;
    }

    return null;
  }

  // "For con_name = HQ-Branch1: Log Count is 3 which is greater than 0."
  private static forGroup(
    group: LogMonitorGroupResult,
    message: string,
  ): string {
    return `For ${LogMonitorGroupResultUtil.describeGroup(group.labels)}: ${message}`;
  }

  /*
   * Anomaly path for log counts: normalizes the observed count to a
   * per-minute rate (the baseline's sample unit) and compares it to the
   * rolling same-hour-of-week baseline of the monitor's scope (services
   * and severities; body/attribute filters are not baselined — the
   * baseline is that scope's full volume, a documented superset).
   *
   * Missing or unreliable baselines mean the rule is still learning —
   * never alert from a thin baseline. Zero-variance baselines are
   * skipped too: any deviation at all would fire.
   */
  private static async evaluateLogCountAnomaly(input: {
    logResponse: LogMonitorResponse;
    criteriaFilter: CriteriaFilter;
    monitorStep?: MonitorStep | undefined;
  }): Promise<string | null> {
    const logMonitorStep: MonitorStepLogMonitor | undefined =
      input.monitorStep?.data?.logMonitor;

    const windowSeconds: number =
      logMonitorStep?.lastXSecondsOfLogs &&
      logMonitorStep.lastXSecondsOfLogs > 0
        ? logMonitorStep.lastXSecondsOfLogs
        : 60;

    const logCount: number = input.logResponse.logCount || 0;
    const observedPerMinute: number = (logCount * 60) / windowSeconds;

    const sensitivity: AnomalyDetectionSensitivity =
      (input.criteriaFilter.metricMonitorOptions?.anomalyDetection
        ?.sensitivity as AnomalyDetectionSensitivity | undefined) ||
      AnomalyDetectionSensitivity.Medium;
    const sigmaCount: number =
      MetricBaselineServiceClass.sigmaForSensitivity(sensitivity);
    const method: AnomalyDetectionMethod =
      (input.criteriaFilter.metricMonitorOptions?.anomalyDetection?.method as
        | AnomalyDetectionMethod
        | undefined) || AnomalyDetectionMethod.MeanStddev;

    let baseline: CountBaselineSummary | null = null;
    try {
      baseline = await LogCountBaselineService.getBaseline({
        projectId: input.logResponse.projectId.toString(),
        telemetryServiceIds: logMonitorStep?.telemetryServiceIds?.map(
          (id: ObjectID) => {
            return id.toString();
          },
        ),
        severityTexts: logMonitorStep?.severityTexts,
        hourOfWeek: MetricBaselineServiceClass.computeHourOfWeek(
          OneUptimeDate.getCurrentDate(),
        ),
        windowDays:
          input.criteriaFilter.metricMonitorOptions?.anomalyDetection
            ?.windowDays,
        minSamples:
          input.criteriaFilter.metricMonitorOptions?.anomalyDetection
            ?.minSamples,
      });
    } catch (err) {
      logger.error("Error fetching log count baseline for anomaly criteria");
      logger.error(err);
      return null;
    }

    if (!baseline || !baseline.isReliable) {
      // Cold start: the baseline is still learning; nothing to compare to.
      return null;
    }

    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute,
      stats: baseline,
      sigmaCount,
      method,
      filterType: input.criteriaFilter.filterType,
    });

    if (!evaluation || !evaluation.breaches) {
      return null;
    }

    const direction: string = evaluation.observedSigma >= 0 ? "above" : "below";

    return (
      `Log count ${logCount} over the last ${windowSeconds} seconds ` +
      `(${observedPerMinute.toFixed(2)} logs/min) is ` +
      `${Math.abs(evaluation.observedSigma).toFixed(2)}σ ${direction} the same-hour baseline ` +
      `(${method === AnomalyDetectionMethod.MedianMad ? "median" : "mean"} ` +
      `${evaluation.center.toFixed(2)} logs/min, σ ${evaluation.spread.toFixed(2)}, ` +
      `${baseline.sampleCount} samples over ${baseline.windowDays} days, ` +
      `sensitivity ${sensitivity}).`
    );
  }
}

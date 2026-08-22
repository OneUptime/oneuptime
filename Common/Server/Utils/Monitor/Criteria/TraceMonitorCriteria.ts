import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
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
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepTraceMonitor from "../../../../Types/Monitor/MonitorStepTraceMonitor";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import SpanCountBaselineService from "../../../Services/SpanCountBaselineService";
import { MetricBaselineService as MetricBaselineServiceClass } from "../../../Services/MetricBaselineService";
import logger from "../../Logger";

export default class TraceMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor step carries the trace query (services / statuses /
     * evaluation window) the anomaly path scopes its baseline lookup
     * to. Optional for backward compatibility — static threshold
     * filters never need it.
     */
    monitorStep?: MonitorStep | undefined;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.SpanCount) {
      /*
       * Anomaly filters skip the static threshold entirely: the
       * observed span rate is compared to this monitor's scope in the
       * same-hour-of-week SpanCountBaseline, mirroring the metric
       * monitor's baseline path.
       */
      if (
        CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
      ) {
        return await TraceMonitorCriteria.evaluateSpanCountAnomaly({
          traceResponse: input.dataToProcess as TraceMonitorResponse,
          criteriaFilter: input.criteriaFilter,
          monitorStep: input.monitorStep,
        });
      }

      threshold = CompareCriteria.convertToNumber(threshold);

      const currentSpanCount: number =
        (input.dataToProcess as TraceMonitorResponse).spanCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentSpanCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }

  /*
   * Anomaly path for span counts: normalizes the observed count to a
   * per-minute rate (the baseline's sample unit) and compares it to the
   * rolling same-hour-of-week baseline of the monitor's scope (services
   * and span statuses; attribute/name filters are not baselined — the
   * baseline is that scope's full volume, a documented superset).
   *
   * Missing or unreliable baselines mean the rule is still learning —
   * never alert from a thin baseline. Zero-variance baselines are
   * skipped too: any deviation at all would fire.
   */
  private static async evaluateSpanCountAnomaly(input: {
    traceResponse: TraceMonitorResponse;
    criteriaFilter: CriteriaFilter;
    monitorStep?: MonitorStep | undefined;
  }): Promise<string | null> {
    const traceMonitorStep: MonitorStepTraceMonitor | undefined =
      input.monitorStep?.data?.traceMonitor;

    const windowSeconds: number =
      traceMonitorStep?.lastXSecondsOfSpans &&
      traceMonitorStep.lastXSecondsOfSpans > 0
        ? traceMonitorStep.lastXSecondsOfSpans
        : 60;

    const spanCount: number = input.traceResponse.spanCount || 0;
    const observedPerMinute: number = (spanCount * 60) / windowSeconds;

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
      baseline = await SpanCountBaselineService.getBaseline({
        projectId: input.traceResponse.projectId.toString(),
        telemetryServiceIds: traceMonitorStep?.telemetryServiceIds?.map(
          (id: ObjectID) => {
            return id.toString();
          },
        ),
        spanStatusCodes: traceMonitorStep?.spanStatuses,
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
      logger.error("Error fetching span count baseline for anomaly criteria");
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
      `Span count ${spanCount} over the last ${windowSeconds} seconds ` +
      `(${observedPerMinute.toFixed(2)} spans/min) is ` +
      `${Math.abs(evaluation.observedSigma).toFixed(2)}σ ${direction} the same-hour baseline ` +
      `(${method === AnomalyDetectionMethod.MedianMad ? "median" : "mean"} ` +
      `${evaluation.center.toFixed(2)} spans/min, σ ${evaluation.spread.toFixed(2)}, ` +
      `${baseline.sampleCount} samples over ${baseline.windowDays} days, ` +
      `sensitivity ${sensitivity}).`
    );
  }
}

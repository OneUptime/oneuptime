import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import CountAnomaly, {
  CountBaselineSummary,
  CountWindowBreach,
} from "./CountAnomaly";
import {
  AnomalyDetectionMethod,
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
} from "../../../../Types/Monitor/CriteriaFilter";
import { getExceptionAnomalySettings } from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
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
       * earlier weeks of SpanCountBaseline (CountWindowBaseline).
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
   * per-minute rate (the baseline's unit) and compares it to windows of
   * its length around the same time of the earlier weeks, in the monitor's
   * scope (services and span statuses; attribute/name filters are not baselined
   * — the baseline is that scope's full volume, a documented superset).
   *
   * Missing or unreliable baselines mean the rule is still learning —
   * never alert from a thin baseline.
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
        // The window judged, which a late ingest queue holds back from now.
        windowEnd: input.traceResponse.evaluatedUntil
          ? new Date(input.traceResponse.evaluatedUntil)
          : OneUptimeDate.getCurrentDate(),
        windowSeconds,
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

    const breach: CountWindowBreach | null = CountAnomaly.findBreach({
      observed: observedPerMinute,
      count: spanCount,
      baseline,
      sigmaCount,
      method,
      filterType: input.criteriaFilter.filterType,
      minimumCount: getExceptionAnomalySettings(
        input.criteriaFilter.metricMonitorOptions?.anomalyDetection,
      ).minimumCount,
    });

    if (!breach) {
      return null;
    }

    const direction: string = breach.observedSigma >= 0 ? "above" : "below";

    return (
      `Span count ${spanCount} over the last ${windowSeconds} seconds ` +
      `(${observedPerMinute.toFixed(2)} spans/min) is ` +
      `${Math.abs(breach.observedSigma).toFixed(2)}σ ${direction} the same-hour baseline ` +
      `(${method === AnomalyDetectionMethod.MedianMad ? "median" : "mean"} ` +
      `${breach.center.toFixed(2)} spans/min, σ ${breach.spread.toFixed(2)}, ` +
      `${breach.sampleCount} samples over ${baseline.windowDays} days, ` +
      `sensitivity ${sensitivity}).`
    );
  }
}

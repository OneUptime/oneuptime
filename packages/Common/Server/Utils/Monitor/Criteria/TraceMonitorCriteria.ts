import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import TraceMonitorGroupResult from "../../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import { LogMonitorGroupResultUtil } from "../../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
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
      const traceResponse: TraceMonitorResponse =
        input.dataToProcess as TraceMonitorResponse;

      const isGrouped: boolean =
        Array.isArray(traceResponse.groupBreakdown) ||
        Boolean(traceResponse.evaluatedGroup);

      /*
       * Anomaly filters skip the static threshold entirely: the
       * observed span rate is compared to this monitor's scope in the
       * earlier weeks of SpanCountBaseline (CountWindowBaseline).
       */
      if (
        CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
      ) {
        /*
         * The baseline is the volume of the monitor's whole scope; there
         * is none per group, as for a grouped Logs monitor.
         */
        if (isGrouped) {
          return null;
        }

        return await TraceMonitorCriteria.evaluateSpanCountAnomaly({
          traceResponse: traceResponse,
          criteriaFilter: input.criteriaFilter,
          monitorStep: input.monitorStep,
        });
      }

      threshold = CompareCriteria.convertToNumber(threshold);

      /*
       * A grouped monitor's verdict for the monitor as a whole (#9711): the
       * filter holds when at least one group's count satisfies it, as a
       * grouped Logs monitor's does. "Fewer than 1 span" holds while one
       * install of forty is quiet; the per-group pass in
       * MonitorCriteriaEvaluator then decides which groups alert.
       */
      if (traceResponse.groupBreakdown) {
        for (const group of traceResponse.groupBreakdown) {
          const groupMessage: string | null =
            CompareCriteria.compareCriteriaNumbers({
              value: group.spanCount || 0,
              threshold: threshold as number,
              criteriaFilter: input.criteriaFilter,
            });

          if (groupMessage) {
            return TraceMonitorCriteria.forGroup(group, groupMessage);
          }
        }

        return null;
      }

      const currentSpanCount: number = traceResponse.spanCount || 0;

      const message: string | null = CompareCriteria.compareCriteriaNumbers({
        value: currentSpanCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });

      // One group, judged alone by the per-group pass: say which one.
      if (message && traceResponse.evaluatedGroup) {
        return TraceMonitorCriteria.forGroup(
          traceResponse.evaluatedGroup,
          message,
        );
      }

      return message;
    }

    return null;
  }

  /*
   * "For resource.app.installation.id = 1b4e...: Span Count was 0, below
   * the 1 threshold." A quiet group says so.
   */
  private static forGroup(
    group: TraceMonitorGroupResult,
    message: string,
  ): string {
    return `For ${LogMonitorGroupResultUtil.describeGroup(group.labels)}${
      group.isQuiet ? ", which sent no span in the window" : ""
    }: ${message}`;
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

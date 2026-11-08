import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import {
  MonitorMetricStep,
  getMonitorMetricSteps,
  getMonitorResourceName,
} from "./MonitorMetricInvestigation";

/*
 * WHAT AN INCIDENT'S ROOT CAUSE PAGE CHARTS (issue #6249).
 *
 * The Root Cause page shows the metrics behind the incident right beside
 * the root cause, as the metric investigation the incident's Overview
 * shows (EventMetricInvestigationPanel), so whoever writes down why it
 * happened can read the evidence, over any time range around it, without
 * leaving the page:
 *
 * - An incident a metric monitor opened keeps a snapshot of what the
 *   check read: the card charts exactly what the Overview charts - that
 *   snapshot, narrowed to the incident's own series - with what the monitor
 *   evaluated shaded.
 * - An incident that kept none (declared by hand on a metric monitor, or
 *   opened before incidents kept one; the Overview then charts nothing)
 *   charts its monitor's metrics as the monitor reads them now: the step
 *   holding the incident's criteria, else the monitor's first step with a
 *   metric, narrowed to the incident's series. The card says so.
 * - Anything else (no metric monitor, nothing set up yet) shows no card.
 *
 * Pure: the card and its tests read it the same way.
 */

// What it reads of the incident's monitors.
export interface RootCauseMonitor {
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined | null;
}

export interface RootCauseMetrics {
  // What the card charts, a metric snapshot narrowed to the series.
  telemetryQuery: TelemetryQuery;
  // What the monitor evaluated when it opened the incident, if it kept one.
  evaluationWindow: InBetween<Date> | null;
  // "host.name = prod-01": what the charts were narrowed to; "" when nothing.
  seriesSummary: string;
  /*
   * Set when the incident kept no metric snapshot and the card charts its
   * monitor as the monitor reads now: the resource that monitor watches,
   * by name ("" when it names none), for the card to say so.
   */
  chartedFromMonitorNow: { resourceName: string } | undefined;
}

type HasQueriesFunction = (
  queryConfigs: Array<MetricQueryConfigData> | null | undefined,
) => boolean;

// A query with a metric picked: something the charts can draw.
const hasMetric: HasQueriesFunction = (
  queryConfigs: Array<MetricQueryConfigData> | null | undefined,
): boolean => {
  return (queryConfigs || []).some(
    (queryConfig: MetricQueryConfigData): boolean => {
      return Boolean(
        queryConfig &&
          typeof queryConfig === "object" &&
          queryConfig.metricQueryData?.filterData?.metricName?.toString(),
      );
    },
  );
};

interface ChosenStep {
  monitor: RootCauseMonitor;
  metricStep: MonitorMetricStep;
}

/*
 * The step to chart when the incident kept no snapshot: the one holding the
 * incident's criteria, in whichever of its monitors holds it, else the
 * first step with a metric of the first monitor that has one.
 */
const chooseStep: (input: {
  createdCriteriaId: string | null | undefined;
  monitors: Array<RootCauseMonitor>;
}) => ChosenStep | null = (input: {
  createdCriteriaId: string | null | undefined;
  monitors: Array<RootCauseMonitor>;
}): ChosenStep | null => {
  let first: ChosenStep | null = null;
  const criteriaId: string = (input.createdCriteriaId || "").trim();

  for (const monitor of input.monitors) {
    if (!monitor || typeof monitor !== "object") {
      continue;
    }

    const metricSteps: Array<MonitorMetricStep> = getMonitorMetricSteps({
      monitorType: monitor.monitorType,
      monitorSteps: monitor.monitorSteps,
    });

    if (metricSteps.length === 0) {
      continue;
    }

    if (criteriaId) {
      const criteriaStep: MonitorStep | null =
        MonitorStepMetricThresholds.findStepOfCriteria({
          monitorSteps: monitor.monitorSteps,
          criteriaId: criteriaId,
        });

      const holding: MonitorMetricStep | undefined = metricSteps.find(
        (metricStep: MonitorMetricStep): boolean => {
          return criteriaStep !== null && metricStep.step === criteriaStep;
        },
      );

      if (holding) {
        return { monitor: monitor, metricStep: holding };
      }
    }

    first = first || { monitor: monitor, metricStep: metricSteps[0]! };
  }

  return first;
};

export function getRootCauseMetrics(input: {
  // The incident's stored telemetry snapshot, its window's bounds hydrated.
  telemetryQuery: TelemetryQuery | null | undefined;
  // The series a grouped monitor opened the incident for.
  seriesLabels: JSONObject | null | undefined;
  // The criteria that opened it; none for one declared by hand.
  createdCriteriaId?: string | null | undefined;
  // The monitors it is on, as they are now.
  monitors: Array<RootCauseMonitor> | null | undefined;
}): RootCauseMetrics | null {
  const snapshot: TelemetryQuery | null | undefined = input.telemetryQuery;
  const snapshotView: MetricViewData | null | undefined =
    snapshot?.metricViewData;

  if (
    snapshot &&
    snapshot.telemetryType === TelemetryType.Metric &&
    snapshotView &&
    hasMetric(snapshotView.queryConfigs)
  ) {
    return {
      telemetryQuery: {
        ...snapshot,
        metricViewData:
          MetricSeriesScope.scopeMetricViewDataToSeries({
            metricViewData: snapshotView,
            seriesLabels: input.seriesLabels,
          }) || snapshotView,
      },
      evaluationWindow: TelemetryQueryTimeRange.getSnapshotWindow(snapshot),
      seriesSummary: MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: snapshotView.queryConfigs,
        seriesLabels: input.seriesLabels,
      }),
      chartedFromMonitorNow: undefined,
    };
  }

  const chosen: ChosenStep | null = chooseStep({
    createdCriteriaId: input.createdCriteriaId,
    monitors: input.monitors || [],
  });

  if (!chosen) {
    return null;
  }

  // As the monitor reads them: its filters and the services it is held to.
  const queryConfigs: Array<MetricQueryConfigData> =
    chosen.metricStep.reads.queryConfigs;

  return {
    telemetryQuery: {
      telemetryType: TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: {
        startAndEndDate: null,
        queryConfigs: MetricSeriesScope.scopeQueryConfigsToSeries({
          queryConfigs: queryConfigs,
          seriesLabels: input.seriesLabels,
        }),
        formulaConfigs: chosen.metricStep.reads.formulaConfigs,
      },
    },
    evaluationWindow: null,
    seriesSummary: MetricSeriesScope.getAppliedSeriesLabelSummary({
      queryConfigs: queryConfigs,
      seriesLabels: input.seriesLabels,
    }),
    chartedFromMonitorNow: {
      resourceName: getMonitorResourceName(
        MonitorStepMetricQueries.getSettings({
          monitorType: chosen.monitor.monitorType,
          monitorStep: chosen.metricStep.step,
        }),
      ),
    },
  };
}

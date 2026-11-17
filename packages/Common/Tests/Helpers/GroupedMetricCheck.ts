import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../Types/JSON";
import MetricMonitorResponse from "../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricsViewConfig from "../../Types/Metrics/MetricsViewConfig";
import ObjectID from "../../Types/ObjectID";
import MetricSeriesFingerprint from "../../Utils/Metrics/MetricSeriesFingerprint";

/*
 * A grouped Metrics monitor's check, as the worker builds it
 * (MonitorTelemetryMonitor): queries grouped by host and container, a
 * formula over them, metricResult holding every series' rows of each query,
 * and seriesBreakdown one entry per series, its aggregatedResults that
 * series' rows of each query and its formula result, in the same order.
 * The fleet of issue #9189, at any size.
 */

export const QUERY_COUNT: number = 4;
export const POINTS_PER_SERIES: number = 5;

export interface GroupedMetricCheck {
  check: MetricMonitorResponse;
  fingerprints: Array<string>;
  labels: Array<JSONObject>;
}

export function seriesLabels(index: number): JSONObject {
  return {
    "resource.host.name": `host-${Math.floor(index / 30)}`,
    "resource.container.name": `container-${index}`,
  };
}

export function fingerprintOf(index: number): string {
  return MetricSeriesFingerprint.computeFingerprint(seriesLabels(index));
}

function point(input: {
  minute: number;
  value: number;
  labels: JSONObject;
}): AggregatedModel {
  return {
    timestamp: new Date(Date.UTC(2026, 10, 17, 10, input.minute)),
    value: input.value,
    attributes: input.labels,
  } as unknown as AggregatedModel;
}

export function groupedMetricCheck(input: {
  seriesCount: number;
  withFormula?: boolean | undefined;
}): GroupedMetricCheck {
  const withFormula: boolean = input.withFormula !== false;
  const resultCount: number = QUERY_COUNT + (withFormula ? 1 : 0);
  const metricResult: Array<AggregatedResult> = [];

  for (let r: number = 0; r < resultCount; r++) {
    metricResult.push({ data: [] });
  }

  const seriesBreakdown: Array<MetricSeriesResult> = [];
  const fingerprints: Array<string> = [];
  const labels: Array<JSONObject> = [];

  for (let s: number = 0; s < input.seriesCount; s++) {
    const seriesLabelSet: JSONObject = seriesLabels(s);
    const fingerprint: string = fingerprintOf(s);
    const aggregatedResults: Array<AggregatedResult> = [];

    for (let r: number = 0; r < resultCount; r++) {
      const rows: Array<AggregatedModel> = [];

      for (let m: number = 0; m < POINTS_PER_SERIES; m++) {
        const row: AggregatedModel = point({
          minute: m,
          value: s * 1000 + r * 10 + m,
          labels: seriesLabelSet,
        });

        rows.push(row);
        // The same row: the breakdown buckets metricResult's rows.
        metricResult[r]!.data.push(row);
      }

      aggregatedResults.push({ data: rows });
    }

    seriesBreakdown.push({
      fingerprint: fingerprint,
      labels: seriesLabelSet,
      aggregatedResults: aggregatedResults,
      arrivals: aggregatedResults.map(() => {
        return null;
      }),
    });
    fingerprints.push(fingerprint);
    labels.push(seriesLabelSet);
  }

  const check: MetricMonitorResponse = {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    startAndEndDate: {
      startValue: new Date(Date.UTC(2026, 10, 17, 10, 0)),
      endValue: new Date(Date.UTC(2026, 10, 17, 10, 5)),
    } as MetricMonitorResponse["startAndEndDate"],
    metricResult: metricResult,
    metricResultArrivals: metricResult.map(() => {
      return null;
    }),
    metricViewConfig: {
      queryConfigs: [],
      formulaConfigs: [],
    } as unknown as MetricsViewConfig,
    seriesBreakdown: seriesBreakdown,
  };

  return { check: check, fingerprints: fingerprints, labels: labels };
}

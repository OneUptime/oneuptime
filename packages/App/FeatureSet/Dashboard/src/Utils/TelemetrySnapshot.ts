import InBetween from "Common/Types/BaseDatabase/InBetween";
import JSONFunctions from "Common/Types/JSONFunctions";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";

export interface DerivedTelemetrySnapshot {
  telemetryQuery: TelemetryQuery | null;
  snapshotWindow: InBetween<Date> | null;
  /** "host.name = prod-01" — the narrowing actually applied; "" if none. */
  seriesSummary: string;
}

export const EMPTY_TELEMETRY_SNAPSHOT: DerivedTelemetrySnapshot = {
  telemetryQuery: null,
  snapshotWindow: null,
  seriesSummary: "",
};

/**
 * Stored incident/alert `telemetryQuery` blob -> render-ready snapshot:
 * deserialize, rebuild the window's Date bounds (the JSON round trip
 * leaves InBetween holding ISO strings), and narrow grouped metric
 * queries to the event's own series via its `seriesLabels`.
 *
 * Pure — the same recipe Pages/Incidents/View and Pages/Alerts/View run
 * inline, packaged so the episode pages (which read the blob off their
 * first member event) can't drift from it.
 */
export function deriveTelemetrySnapshot(input: {
  storedTelemetryQuery: unknown;
  seriesLabels: JSONObject | undefined;
}): DerivedTelemetrySnapshot {
  if (!input.storedTelemetryQuery) {
    return EMPTY_TELEMETRY_SNAPSHOT;
  }

  let telemetryQuery: TelemetryQuery | null = JSONFunctions.deserialize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input.storedTelemetryQuery as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  if (!telemetryQuery) {
    return EMPTY_TELEMETRY_SNAPSHOT;
  }

  telemetryQuery = TelemetryQueryTimeRange.hydrate(telemetryQuery);

  const snapshotWindow: InBetween<Date> | null =
    TelemetryQueryTimeRange.getSnapshotWindow(telemetryQuery);

  let seriesSummary: string = "";

  /*
   * The stored telemetryQuery is the monitor's whole-evaluation view: a
   * grouped metric monitor that breached on five hosts stamps the SAME
   * query configs onto all five events. Narrow to this event's own
   * series so the chart shows the host it is about.
   */
  if (telemetryQuery?.metricViewData) {
    seriesSummary = MetricSeriesScope.getAppliedSeriesLabelSummary({
      queryConfigs: telemetryQuery.metricViewData.queryConfigs,
      seriesLabels: input.seriesLabels,
    });

    telemetryQuery = {
      ...telemetryQuery,
      metricViewData:
        MetricSeriesScope.scopeMetricViewDataToSeries({
          metricViewData: telemetryQuery.metricViewData,
          seriesLabels: input.seriesLabels,
        }) || null,
    };
  }

  return { telemetryQuery, snapshotWindow, seriesSummary };
}

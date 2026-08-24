import React, { Fragment, FunctionComponent, ReactElement } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../Logs/LogsViewer";
import ExceptionInstanceTable from "../Exceptions/ExceptionInstanceTable";
import MetricView from "../Metrics/MetricView";
import TraceTable from "../Traces/TraceTable";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import TelemetrySnapshotWindowAlert from "./TelemetrySnapshotWindowAlert";

export interface ComponentProps {
  telemetryQuery: TelemetryQuery;
  snapshotWindow: InBetween<Date> | null;
  /*
   * "host.name = prod-01" — what the metric charts were narrowed to, from
   * MetricSeriesScope.getAppliedSeriesLabelSummary. "" when nothing was
   * narrowed.
   */
  seriesSummary: string;
  eventNoun: "incident" | "alert";
}

/**
 * The telemetry snapshot block of an incident/alert/episode page: the
 * primary signal (logs / traces / metrics / exceptions, whichever the
 * monitor evaluated) pinned to the evaluation window, wrapped in the
 * companion-signal tabs that add the other pillars scoped the same way.
 *
 * Extracted from Pages/Incidents/View so the EPISODE pages can mount the
 * identical experience for their first member event without copying a
 * hundred lines of branching JSX.
 */
const TelemetrySnapshotPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { telemetryQuery, snapshotWindow, seriesSummary, eventNoun } = props;

  /*
   * Deliberately `undefined`, not an empty fragment — Card lays out
   * rightElement from presence.
   */
  const snapshotWindowAlert: ReactElement | undefined = snapshotWindow ? (
    <TelemetrySnapshotWindowAlert window={snapshotWindow} />
  ) : undefined;

  return (
    <TelemetryCompanionSignalTabs
      telemetryQuery={telemetryQuery}
      snapshotWindow={snapshotWindow}
      snapshotWindowAlert={snapshotWindowAlert}
      eventNoun={eventNoun}
      primarySignalElement={
        <Fragment>
          {telemetryQuery.telemetryType === TelemetryType.Log &&
            telemetryQuery.telemetryQuery && (
              <div>
                <Card
                  title={"Logs"}
                  description={`Logs for this ${eventNoun}.`}
                  rightElement={snapshotWindowAlert}
                >
                  <DashboardLogsViewer
                    id="logs-preview"
                    logQuery={telemetryQuery.telemetryQuery as Query<Log>}
                    limit={10}
                    noLogsMessage="No logs found"
                  />
                </Card>
              </div>
            )}

          {telemetryQuery.telemetryType === TelemetryType.Trace &&
            telemetryQuery.telemetryQuery && (
              <div>
                <TraceTable
                  spanQuery={telemetryQuery.telemetryQuery as Query<Span>}
                  rightElement={snapshotWindowAlert}
                  // Pinned to the snapshot; a URL-restored filter must not replace it.
                  disableUrlState={true}
                />
              </div>
            )}

          {telemetryQuery.telemetryType === TelemetryType.Metric &&
            telemetryQuery.metricViewData && (
              <Card
                title={"Metrics"}
                description={
                  seriesSummary
                    ? `Metrics related to this ${eventNoun}, scoped to the affected series (${seriesSummary}).`
                    : `Metrics related to this ${eventNoun}.`
                }
                rightElement={snapshotWindowAlert}
              >
                <MetricView
                  data={telemetryQuery.metricViewData}
                  hideQueryElements={true}
                  chartCssClass="rounded-lg border border-gray-200 shadow-sm"
                  hideStartAndEndDate={true}
                  // Read-only host: onChange is a no-op, so zoom can't apply.
                  disableChartZoom={true}
                  onChange={(_data: MetricViewData) => {
                    // do nothing!
                  }}
                />
              </Card>
            )}

          {telemetryQuery.telemetryType === TelemetryType.Exception &&
            telemetryQuery.telemetryQuery && (
              <ExceptionInstanceTable
                title="Exceptions"
                description={`Exceptions related to this ${eventNoun}.`}
                query={
                  telemetryQuery.telemetryQuery as Query<ExceptionInstance>
                }
                rightElement={snapshotWindowAlert}
                // Pinned to the snapshot; a URL-restored filter must not replace it.
                disableUrlState={true}
              />
            )}
        </Fragment>
      }
    />
  );
};

export default TelemetrySnapshotPanel;

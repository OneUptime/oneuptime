import React, { Fragment, FunctionComponent, ReactElement } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Card from "Common/UI/Components/Card/Card";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import DashboardLogsViewer from "../Logs/LogsViewer";
import ExceptionsViewer from "../Exceptions/ExceptionsViewer";
import TracesViewer from "../Traces/TracesViewer";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import EventMetricInvestigationPanel from "./EventMetricInvestigationPanel";
import {
  EventMetricSubject,
  EventMomentState,
  EventMomentTimelineEntry,
} from "../../Utils/EventMetricInvestigation";
import useTelemetrySnapshotZoom, {
  TelemetrySnapshotBadge,
  TelemetrySnapshotZoom,
} from "./TelemetrySnapshotZoom";

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
  /*
   * For a metrics monitor's snapshot, which is a metric investigation
   * anchored on the page's episode (EventMetricInvestigationPanel): which
   * episode it is, when it started and was resolved, and its state
   * timeline with the project's states, for the moments its charts mark.
   */
  metricSubject?: EventMetricSubject | undefined;
  startedAt?: Date | undefined;
  endedAt?: Date | undefined;
  stateTimeline?: Array<EventMomentTimelineEntry> | undefined;
  states?: Array<EventMomentState> | undefined;
  /*
   * The member event whose telemetry this is: a metric snapshot's charts
   * draw the rule its monitor opened it with (issue #6250).
   */
  metricRuleEventId?: string | undefined;
}

/**
 * The telemetry snapshot block of an incident/alert/episode page: the
 * primary signal (logs / traces / metrics / exceptions, whichever the
 * monitor evaluated) pinned to the evaluation window, wrapped in the
 * companion-signal tabs that add the other pillars scoped the same way.
 *
 * Extracted from Pages/Incidents/View so the EPISODE pages can mount the
 * identical experience for their first member event without copying a
 * hundred lines of branching JSX. A metrics monitor's snapshot is a metric
 * investigation instead, as on the incident and alert pages
 * (EventMetricInvestigationPanel).
 */
const TelemetrySnapshotPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { telemetryQuery, snapshotWindow, seriesSummary, eventNoun } = props;

  /*
   * A drag on the primary signal's chart (a logs, traces or exceptions
   * explorer's histogram) zooms the whole snapshot, every tab of it; see
   * TelemetrySnapshotZoom. Held here, above the tabs, so it outlives a
   * switch to another tab and back. The episode page unmounts this panel
   * while it loads another episode, so the zoom never follows the reader
   * there.
   */
  const snapshotZoom: TelemetrySnapshotZoom = useTelemetrySnapshotZoom({
    snapshotWindow: snapshotWindow,
    telemetryType: telemetryQuery.telemetryType,
    explorerQuery: telemetryQuery.telemetryQuery,
  });

  if (telemetryQuery.telemetryType === TelemetryType.Metric) {
    return (
      <EventMetricInvestigationPanel
        telemetryQuery={telemetryQuery}
        evaluationWindow={snapshotWindow}
        seriesSummary={seriesSummary}
        subject={
          props.metricSubject ||
          (eventNoun === "alert"
            ? EventMetricSubject.AlertEpisode
            : EventMetricSubject.IncidentEpisode)
        }
        startedAt={props.startedAt}
        endedAt={props.endedAt}
        stateTimeline={props.stateTimeline || []}
        states={props.states || []}
        ruleEventId={props.metricRuleEventId}
      />
    );
  }

  /*
   * Deliberately `undefined`, not an empty fragment — Card lays out
   * rightElement from presence.
   */
  const snapshotWindowAlert: ReactElement | undefined = snapshotWindow ? (
    <TelemetrySnapshotBadge window={snapshotWindow} zoom={snapshotZoom.zoom} />
  ) : undefined;

  return (
    <TelemetryCompanionSignalTabs
      telemetryQuery={telemetryQuery}
      // The companion tabs follow the zoom: they show the slice too.
      snapshotWindow={snapshotZoom.window}
      isSnapshotZoomed={snapshotZoom.isZoomed}
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
                  {/*
                   * On the window the snapshot shows and inside its zoom,
                   * which the explorer follows: a drag on the log volume
                   * chart zooms every tab, and a double-click or the
                   * badge's Reset zoom returns them all. See
                   * TelemetrySnapshotZoom.
                   */}
                  <TimeRangeZoomProvider zoom={snapshotZoom.zoom}>
                    <DashboardLogsViewer
                      id="logs-preview"
                      logQuery={snapshotZoom.explorerQuery as Query<Log>}
                      limit={10}
                      noLogsMessage="No logs found"
                    />
                  </TimeRangeZoomProvider>
                </Card>
              </div>
            )}

          {telemetryQuery.telemetryType === TelemetryType.Trace &&
            telemetryQuery.telemetryQuery && (
              <div>
                <Card
                  title={"Spans"}
                  description={`Spans for this ${eventNoun}.`}
                  rightElement={snapshotWindowAlert}
                >
                  {/*
                   * On the window the snapshot shows and inside its zoom,
                   * which the explorer follows; see the logs above.
                   */}
                  <TimeRangeZoomProvider zoom={snapshotZoom.zoom}>
                    <TracesViewer
                      spanQuery={snapshotZoom.explorerQuery as Query<Span>}
                      limit={10}
                      /*
                       * Pinned to the snapshot: the host page owns the URL, so the
                       * viewer neither reads a filter out of it nor writes back.
                       */
                      disableUrlSync={true}
                      emptyMessage="No spans found"
                    />
                  </TimeRangeZoomProvider>
                </Card>
              </div>
            )}

          {telemetryQuery.telemetryType === TelemetryType.Exception &&
            telemetryQuery.telemetryQuery && (
              <Card
                title={"Exceptions"}
                description={`Exceptions related to this ${eventNoun}.`}
                rightElement={snapshotWindowAlert}
              >
                {/*
                 * On the window the snapshot shows and inside its zoom,
                 * which the explorer follows; see the logs above.
                 */}
                <TimeRangeZoomProvider zoom={snapshotZoom.zoom}>
                  <ExceptionsViewer
                    exceptionInstanceQuery={
                      snapshotZoom.explorerQuery as Query<ExceptionInstance>
                    }
                    /*
                     * An event shows the exceptions it fired on, whoever has since
                     * resolved them and whatever the classifier made of them.
                     */
                    defaultStatus="all"
                    defaultClassScope="all"
                    limit={10}
                    // Pinned to the snapshot; the host page owns the URL.
                    disableUrlSync={true}
                    emptyMessage="No exceptions found"
                  />
                </TimeRangeZoomProvider>
              </Card>
            )}
        </Fragment>
      }
    />
  );
};

export default TelemetrySnapshotPanel;

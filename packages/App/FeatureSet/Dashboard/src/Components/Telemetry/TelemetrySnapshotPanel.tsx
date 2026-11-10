import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Card from "Common/UI/Components/Card/Card";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { ResolvedStateList } from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import DashboardLogsViewer from "../Logs/LogsViewer";
import ExceptionsViewer from "../Exceptions/ExceptionsViewer";
import TracesViewer from "../Traces/TracesViewer";
import MetricInvestigationTime, {
  MetricInvestigationTimePreset,
} from "../Metrics/Investigation/MetricInvestigationTime";
import useInvestigationTimeRange, {
  InvestigationTimeRangeState,
} from "../Metrics/Investigation/UseInvestigationTimeRange";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import EventMetricInvestigationPanel from "./EventMetricInvestigationPanel";
import EventTimeRangeControls from "./EventTimeRangeControls";
import {
  EventMetricSubject,
  EventMetricWords,
  EventMomentState,
  EventMomentTimelineEntry,
  getEventMetricWords,
} from "../../Utils/EventMetricInvestigation";
import {
  EVENT_EVALUATED_SELECTION,
  EVENT_RELATIVE_TIME_RANGES,
  getEventTimePresets,
} from "../../Utils/EventTimePresets";
import {
  getExplorerZoom,
  getSnapshotCompanionWindow,
  getSnapshotExplorerQuery,
} from "../../Utils/EventSnapshotTimeRange";

/*
 * Where an event page keeps the time range of its logs, traces or
 * exceptions card in its URL ("telemetryTime=hour-before"). A metrics
 * monitor's card keeps its own under "metrics"; a page shows one or the
 * other.
 */
export const EVENT_TELEMETRY_TIME_URL_PREFIX: string = "telemetry";

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
   * What the card is about, for the time ranges it offers around it ("Around
   * this incident") and a metric snapshot's moments: the incident or alert
   * on its own page, the episode on an episode's. Left out, an episode of
   * the event noun's kind.
   */
  subject?: EventMetricSubject | undefined;
  // When it started and, while it is resolved, when it was.
  startedAt?: Date | undefined;
  endedAt?: Date | undefined;
  /*
   * For a metrics monitor's snapshot, which is a metric investigation
   * (EventMetricInvestigationPanel): the state timeline with the project's
   * states, for the moments its charts mark, and which list those states
   * are. Left out, the list is the event noun's: the project's incident
   * states for an incident, its alert states for an alert.
   */
  stateTimeline?: Array<EventMomentTimelineEntry> | undefined;
  states?: Array<EventMomentState> | undefined;
  stateList?: ResolvedStateList | undefined;
  /*
   * The member event whose telemetry this is: a metric snapshot's charts
   * draw the rule its monitor opened it with (issue #6250).
   */
  metricRuleEventId?: string | undefined;
}

/**
 * The telemetry snapshot block of an incident, alert or episode page: the
 * primary signal (logs / traces / metrics / exceptions, whichever the
 * monitor evaluated), wrapped in the companion-signal tabs that add the
 * other pillars scoped the same way.
 *
 * One component for the incident, alert and both episode pages, so they
 * cannot drift. A metrics monitor's snapshot is a metric investigation
 * (EventMetricInvestigationPanel); a logs, traces or exceptions snapshot
 * lists what the monitor's query finds over a time range the reader picks
 * (issue #6251; see ExplorerSnapshotPanel below).
 */
const TelemetrySnapshotPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const subject: EventMetricSubject =
    props.subject ||
    (props.eventNoun === "alert"
      ? EventMetricSubject.AlertEpisode
      : EventMetricSubject.IncidentEpisode);

  if (props.telemetryQuery.telemetryType === TelemetryType.Metric) {
    return (
      <EventMetricInvestigationPanel
        telemetryQuery={props.telemetryQuery}
        evaluationWindow={props.snapshotWindow}
        seriesSummary={props.seriesSummary}
        subject={subject}
        startedAt={props.startedAt}
        endedAt={props.endedAt}
        stateTimeline={props.stateTimeline || []}
        states={props.states || []}
        stateList={
          props.stateList ||
          (props.eventNoun === "alert"
            ? StateListType.AlertState
            : StateListType.IncidentState)
        }
        ruleEventId={props.metricRuleEventId}
      />
    );
  }

  return (
    <ExplorerSnapshotPanel
      telemetryQuery={props.telemetryQuery}
      snapshotWindow={props.snapshotWindow}
      eventNoun={props.eventNoun}
      subject={subject}
      startedAt={props.startedAt}
      endedAt={props.endedAt}
    />
  );
};

interface ExplorerSnapshotPanelProps {
  telemetryQuery: TelemetryQuery;
  snapshotWindow: InBetween<Date> | null;
  eventNoun: "incident" | "alert";
  subject: EventMetricSubject;
  startedAt?: Date | undefined;
  endedAt?: Date | undefined;
}

/**
 * A logs, traces or exceptions snapshot (issue #6251): what the monitor's
 * query finds, over a time range the reader picks, on every tab of the card.
 *
 * - Untouched, it shows exactly what it always did: the window the monitor
 *   evaluated ("What the monitor saw"), the stored query handed to the
 *   explorer as it is.
 * - The picker on every tab's card offers the ranges around the event that
 *   an event's metrics offer (Around the start, the hour or the day before
 *   it started, start to now or to resolution), then ranges relative to
 *   now and a custom range. A pick moves the explorer and every other tab.
 * - A drag on the explorer's chart zooms the whole card, every tab of it;
 *   a double-click or Reset zoom beside the picker goes back to the range
 *   picked before.
 * - What the reader picked is kept in the page's URL under "telemetry", so
 *   a reload keeps it and Copy link shares it; Reset goes back to what the
 *   monitor saw.
 *
 * Held here, above the tabs (which mount only the one open), so it
 * outlives a switch to another tab and back, and the page's background
 * refresh. The pages show their skeleton while they load another event,
 * which unmounts this: the next event starts from what its monitor saw.
 *
 * A snapshot that kept no window (an older event, a log monitor read with
 * no time limit) has nothing to anchor on: it shows what it always showed,
 * with no picker.
 */
const ExplorerSnapshotPanel: FunctionComponent<ExplorerSnapshotPanelProps> = (
  props: ExplorerSnapshotPanelProps,
): ReactElement => {
  const { telemetryQuery, eventNoun } = props;
  const words: EventMetricWords = getEventMetricWords(props.subject);

  // A stored window can still hold ISO strings: real Dates from here on.
  const snapshotWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(
      TelemetryQueryTimeRange.toDateWindow(props.snapshotWindow),
    );

  const time: InvestigationTimeRangeState = useInvestigationTimeRange({
    getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
      return getEventTimePresets(
        {
          startedAt: props.startedAt,
          endedAt: props.endedAt,
          evaluationWindow: snapshotWindow,
        },
        now,
      );
    },
    defaultSelection: EVENT_EVALUATED_SELECTION,
    // With no window there is no range to keep: the URL is left alone.
    urlParamPrefix: snapshotWindow
      ? EVENT_TELEMETRY_TIME_URL_PREFIX
      : undefined,
  });

  const hasWindow: boolean = snapshotWindow !== null;
  const snapshotStartMs: number = snapshotWindow
    ? snapshotWindow.startValue.getTime()
    : Number.NaN;
  const snapshotEndMs: number = snapshotWindow
    ? snapshotWindow.endValue.getTime()
    : Number.NaN;

  /*
   * The explorer lists the stored query on the window the card shows: the
   * stored query itself while that is what the monitor saw.
   */
  const explorerQuery: TelemetryQuery["telemetryQuery"] =
    useMemo((): TelemetryQuery["telemetryQuery"] => {
      if (!hasWindow) {
        return telemetryQuery.telemetryQuery;
      }

      return getSnapshotExplorerQuery({
        telemetryType: telemetryQuery.telemetryType,
        storedQuery: telemetryQuery.telemetryQuery,
        snapshotWindow: new InBetween<Date>(
          new Date(snapshotStartMs),
          new Date(snapshotEndMs),
        ),
        window: time.window,
      });
    }, [
      hasWindow,
      telemetryQuery.telemetryQuery,
      telemetryQuery.telemetryType,
      snapshotStartMs,
      snapshotEndMs,
      time.window,
    ]);

  /*
   * The card's zoom, offered to the explorer over the window it lists, so a
   * drag on its chart zooms every tab and its way back is the card's. None
   * without a window: nothing to zoom, and no zoom further up reaches it.
   */
  const explorerZoom: TimeRangeZoom | null =
    useMemo((): TimeRangeZoom | null => {
      return hasWindow ? getExplorerZoom(time.zoom, time.window) : null;
    }, [hasWindow, time.zoom, time.window]);

  /*
   * On the right of every card of the snapshot, the other tabs' included,
   * so the range can be picked, shared or reset from any of them.
   * Deliberately `undefined` without a window, not an empty fragment: Card
   * lays out rightElement from its presence.
   */
  const timeRangeControls: ReactElement | undefined = hasWindow ? (
    <EventTimeRangeControls
      time={time}
      presetsHeading={words.presetsHeading}
      relativeRanges={EVENT_RELATIVE_TIME_RANGES}
    />
  ) : undefined;

  const isAlert: boolean = eventNoun === "alert";

  return (
    <TelemetryCompanionSignalTabs
      telemetryQuery={telemetryQuery}
      // The other tabs follow the time range, a zoom included.
      snapshotWindow={hasWindow ? time.window : props.snapshotWindow}
      companionWindow={hasWindow ? getSnapshotCompanionWindow(time) : undefined}
      snapshotWindowAlert={timeRangeControls}
      eventNoun={eventNoun}
      primarySignalElement={
        <Fragment>
          {telemetryQuery.telemetryType === TelemetryType.Log &&
            telemetryQuery.telemetryQuery && (
              <div>
                <Card
                  title={"Logs"}
                  description={
                    isAlert ? "Logs for this alert." : "Logs for this incident."
                  }
                  rightElement={timeRangeControls}
                >
                  {/*
                   * On the window the card shows and inside its zoom, which
                   * the explorer follows: a drag on the log volume chart
                   * zooms every tab, and a double-click or Reset zoom
                   * returns them all.
                   */}
                  <TimeRangeZoomProvider zoom={explorerZoom}>
                    <DashboardLogsViewer
                      id="logs-preview"
                      logQuery={explorerQuery as Query<Log>}
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
                  description={
                    isAlert
                      ? "Spans for this alert."
                      : "Spans for this incident."
                  }
                  rightElement={timeRangeControls}
                >
                  {/*
                   * On the window the card shows and inside its zoom, which
                   * the explorer follows; see the logs above.
                   */}
                  <TimeRangeZoomProvider zoom={explorerZoom}>
                    <TracesViewer
                      spanQuery={explorerQuery as Query<Span>}
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
                description={
                  isAlert
                    ? "Exceptions for this alert."
                    : "Exceptions related to this incident."
                }
                rightElement={timeRangeControls}
              >
                {/*
                 * On the window the card shows and inside its zoom, which
                 * the explorer follows; see the logs above.
                 */}
                <TimeRangeZoomProvider zoom={explorerZoom}>
                  <ExceptionsViewer
                    exceptionInstanceQuery={
                      explorerQuery as Query<ExceptionInstance>
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

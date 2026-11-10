import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import ResolvedStateUtil, {
  ResolvedStateList,
} from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import {
  EpisodeTiming,
  getEpisodeTiming,
} from "../Components/EpisodeView/EpisodeTiming";
import {
  EventStateTimelineDate,
  getEventEndDateForCurrentState,
} from "./EventDuration";
import { EventMomentState } from "./EventMetricInvestigation";
import { getEventResponseTimes } from "./EventOverview";
import {
  MonitorMetricStep,
  getMonitorMetricSteps,
  getMonitorResourceName,
} from "./MonitorMetricInvestigation";

/*
 * WHAT AN INCIDENT'S, AN ALERT'S OR AN EPISODE'S ROOT CAUSE PAGE CHARTS
 * (issues #6249, #6304 and #6320).
 *
 * The Root Cause page shows the metrics behind the event right beside the
 * root cause, as the metric investigation the event's Overview shows
 * (EventMetricInvestigationPanel), so whoever writes down why it happened
 * can read the evidence, over any time range around it, without leaving
 * the page:
 *
 * - An incident or an alert a metric monitor opened keeps a snapshot of
 *   what the check read: the card charts exactly what the Overview charts -
 *   that snapshot, narrowed to the event's own series - with what the
 *   monitor evaluated shaded.
 * - One that kept none (declared or created by hand on a metric monitor, or
 *   opened before events kept one; the Overview then charts nothing) charts
 *   its monitor's metrics as the monitor reads them now: the step holding
 *   the event's criteria, else the monitor's first step with a metric,
 *   narrowed to the event's series. The card says so.
 * - Anything else (no metric monitor, nothing set up yet) shows no card.
 *
 * An incident and an alert are read the same way, by one rule: an alert's
 * one monitor is a list of one (getAlertRootCauseEvent), an incident's list
 * is its monitors (getIncidentRootCauseEvent), and from there both are
 * charted and anchored alike. An episode charts its first member, read as
 * that incident or alert is read, anchored on the episode itself (see
 * below). Pure: the cards and their tests read it the same way.
 */

// What it reads of the event's monitors.
export interface RootCauseMonitor {
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined | null;
}

export interface RootCauseMetrics {
  // What the card charts, a metric snapshot narrowed to the series.
  telemetryQuery: TelemetryQuery;
  // What the monitor evaluated when it opened the event, if it kept one.
  evaluationWindow: InBetween<Date> | null;
  // "host.name = prod-01": what the charts were narrowed to; "" when nothing.
  seriesSummary: string;
  /*
   * Set when the event kept no metric snapshot and the card charts its
   * monitor as the monitor reads now: the resource that monitor watches,
   * by name ("" when it names none), for the card to say so.
   */
  chartedFromMonitorNow: { resourceName: string } | undefined;
}

// What decides what a Root Cause card charts.
export interface RootCauseMetricsInput {
  // The event's stored telemetry snapshot, its window's bounds hydrated.
  telemetryQuery: TelemetryQuery | null | undefined;
  // The series a grouped monitor opened the event for.
  seriesLabels: JSONObject | null | undefined;
  // The criteria that opened it; none for one declared or created by hand.
  createdCriteriaId?: string | null | undefined;
  // The monitors it is on, as they are now.
  monitors: Array<RootCauseMonitor> | null | undefined;
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
 * The step to chart when the event kept no snapshot: the one holding the
 * event's criteria, in whichever of its monitors holds it, else the first
 * step with a metric of the first monitor that has one.
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

export function getRootCauseMetrics(
  input: RootCauseMetricsInput,
): RootCauseMetrics | null {
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

/*
 * What a Root Cause card reads of its event, an incident or an alert alike:
 * what decides what it charts, and the moments it anchors the ranges on.
 */
export interface RootCauseEvent extends RootCauseMetricsInput {
  // When it was declared (an incident) or created (an alert).
  startedAt: Date | undefined;
  // When its impact started, when somebody recorded it.
  impactStartedAt: Date | undefined;
  createdCriteriaId: string | null;
  monitors: Array<RootCauseMonitor>;
  /*
   * The incident or alert whose monitor rule the charts draw, when the card
   * is not that incident's or alert's own: an episode's first member. Left
   * out for an incident or an alert, which draws its own.
   */
  ruleEventId?: string | undefined;
}

/*
 * The columns the card reads of an incident's row, as ModelAPI hands them
 * back: the snapshot as the JSON it is stored as.
 */
export interface IncidentRootCauseRow {
  declaredAt?: Date | null | undefined;
  impactStartedAt?: Date | null | undefined;
  telemetryQuery?: unknown;
  seriesLabels?: unknown;
  createdCriteriaId?: string | null | undefined;
  monitors?: Array<RootCauseMonitor | null | undefined> | null | undefined;
}

// The columns the card reads of an alert's row: one monitor, not a list.
export interface AlertRootCauseRow {
  createdAt?: Date | null | undefined;
  impactStartedAt?: Date | null | undefined;
  telemetryQuery?: unknown;
  seriesLabels?: unknown;
  createdCriteriaId?: string | null | undefined;
  monitor?: RootCauseMonitor | null | undefined;
}

type ToDateFunction = (value: unknown) => Date | undefined;

// A moment the row holds, or none: never an Invalid Date.
const toDate: ToDateFunction = (value: unknown): Date | undefined => {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : undefined;
};

type IsJSONObjectFunction = (value: unknown) => value is JSONObject;

const isJSONObject: IsJSONObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

type ReadSnapshotFunction = (value: unknown) => TelemetryQuery | null;

/*
 * The snapshot as the row stores it: JSON, whose window's bounds come back
 * as strings and are read as Dates again (TelemetryQueryTimeRange.hydrate),
 * as the event's Overview reads it.
 */
const readSnapshot: ReadSnapshotFunction = (
  value: unknown,
): TelemetryQuery | null => {
  if (!isJSONObject(value)) {
    return null;
  }

  return TelemetryQueryTimeRange.hydrate(
    JSONFunctions.deserialize(value) as unknown as TelemetryQuery,
  );
};

type ReadEventFunction = (row: {
  startedAt: unknown;
  impactStartedAt: unknown;
  telemetryQuery: unknown;
  seriesLabels: unknown;
  createdCriteriaId: unknown;
  monitors: Array<RootCauseMonitor | null | undefined>;
}) => RootCauseEvent;

const readEvent: ReadEventFunction = (row: {
  startedAt: unknown;
  impactStartedAt: unknown;
  telemetryQuery: unknown;
  seriesLabels: unknown;
  createdCriteriaId: unknown;
  monitors: Array<RootCauseMonitor | null | undefined>;
}): RootCauseEvent => {
  return {
    startedAt: toDate(row.startedAt),
    impactStartedAt: toDate(row.impactStartedAt),
    telemetryQuery: readSnapshot(row.telemetryQuery),
    seriesLabels: isJSONObject(row.seriesLabels) ? row.seriesLabels : null,
    createdCriteriaId:
      typeof row.createdCriteriaId === "string" ? row.createdCriteriaId : null,
    monitors: row.monitors.filter(
      (monitor: RootCauseMonitor | null | undefined): boolean => {
        return Boolean(monitor) && typeof monitor === "object";
      },
    ) as Array<RootCauseMonitor>,
  };
};

// An incident: declared, on every monitor it lists.
export function getIncidentRootCauseEvent(
  incident: IncidentRootCauseRow,
): RootCauseEvent {
  return readEvent({
    startedAt: incident.declaredAt,
    impactStartedAt: incident.impactStartedAt,
    telemetryQuery: incident.telemetryQuery,
    seriesLabels: incident.seriesLabels,
    createdCriteriaId: incident.createdCriteriaId,
    monitors: Array.isArray(incident.monitors) ? incident.monitors : [],
  });
}

/*
 * An alert: created, on its one monitor - a list of one, or of none when
 * it has no monitor (raised by hand, or its monitor deleted since).
 */
export function getAlertRootCauseEvent(
  alert: AlertRootCauseRow,
): RootCauseEvent {
  return readEvent({
    startedAt: alert.createdAt,
    impactStartedAt: alert.impactStartedAt,
    telemetryQuery: alert.telemetryQuery,
    seriesLabels: alert.seriesLabels,
    createdCriteriaId: alert.createdCriteriaId,
    monitors: alert.monitor ? [alert.monitor] : [],
  });
}

/*
 * AN EPISODE'S ROOT CAUSE PAGE CHARTS WHAT ITS OVERVIEW CHARTS (issue #6320).
 *
 * An episode groups many incidents or alerts from one root cause, and its
 * Overview charts the telemetry of the first of them - the one that kicked
 * it off (EpisodeFirstMember) - anchored on the episode: its own start,
 * state timeline and states, with that member's monitor rule drawn and every
 * member marked on the charts, as an incident or an alert. The Root Cause
 * page charts the same member the same way:
 *
 * - the member is read as its own Root Cause page reads it (the same
 *   columns, by the same rule): its snapshot, or, when it kept none, its
 *   monitor as the monitor reads now, which the card says;
 * - the moments are the episode's, never the member's: the member's start
 *   and impact are left out, and the ranges are anchored on when the
 *   episode started and was resolved, as its Overview works them out
 *   (getEpisodeTiming).
 */

// What the card reads of an episode's first member besides its event: its id.
export interface EpisodeMemberRootCauseRow {
  id?: ObjectID | string | null | undefined;
}

type ReadIdFunction = (value: unknown) => string | undefined;

const readId: ReadIdFunction = (value: unknown): string | undefined => {
  if (value instanceof ObjectID || typeof value === "string") {
    return value.toString().trim() || undefined;
  }

  return undefined;
};

type ReadEpisodeEventFunction = (
  member: EpisodeMemberRootCauseRow,
  memberEvent: RootCauseEvent,
) => RootCauseEvent;

const readEpisodeEvent: ReadEpisodeEventFunction = (
  member: EpisodeMemberRootCauseRow,
  memberEvent: RootCauseEvent,
): RootCauseEvent => {
  return {
    ...memberEvent,
    // The episode's own, read with its moments (getEpisodeRootCauseTimes).
    startedAt: undefined,
    impactStartedAt: undefined,
    ruleEventId: readId(member.id),
  };
};

// An incident episode's first member: an incident, read as its page reads it.
export function getIncidentEpisodeRootCauseEvent(
  member: IncidentRootCauseRow & EpisodeMemberRootCauseRow,
): RootCauseEvent {
  return readEpisodeEvent(member, getIncidentRootCauseEvent(member));
}

// An alert episode's first member: an alert, on its one monitor.
export function getAlertEpisodeRootCauseEvent(
  member: AlertRootCauseRow & EpisodeMemberRootCauseRow,
): RootCauseEvent {
  return readEpisodeEvent(member, getAlertRootCauseEvent(member));
}

/*
 * One of the project's states, as the card reads it: as the moments read it
 * (EventMomentState), whose place in the list decides the states that count
 * as resolved.
 */
export type RootCauseState = EventMomentState;

export interface RootCauseTimes {
  // Where the ranges around the event start from.
  startedAt: Date | undefined;
  // When it was resolved, while it still is: the end of "Start to resolution".
  endedAt: Date | undefined;
}

/*
 * The moments the card's ranges are anchored on, worked out as the event's
 * Overview works them out, so the two cards offer the same ranges:
 *
 * - it started when it was declared or created, or, when the row says
 *   neither, when its first state began (getEventResponseTimes);
 * - it ended when it moved into a state that counts as resolved - the
 *   project's resolved state or one placed after it - while it is still in
 *   one (getEventEndDateForCurrentState): a reopened event is open again.
 */
export function getRootCauseTimes(input: {
  startedAt: Date | undefined;
  stateTimeline: Array<EventStateTimelineDate>;
  states: Array<RootCauseState>;
  stateList: ResolvedStateList;
}): RootCauseTimes {
  const resolvedStateIds: Array<string> = ResolvedStateUtil.getResolvedStateIds(
    {
      list: input.stateList,
      states: input.states,
    },
  ).map((stateId: ObjectID): string => {
    return stateId.toString();
  });

  return {
    startedAt: getEventResponseTimes({
      timelines: input.stateTimeline,
      startedAt: input.startedAt,
      acknowledgedStateIds: [],
      resolvedStateIds: resolvedStateIds,
    }).startedAt,
    endedAt: getEventEndDateForCurrentState(
      input.stateTimeline,
      resolvedStateIds,
    ),
  };
}

/*
 * The columns the card reads of an incident episode's own row: when it was
 * declared (or, for one older than declaredAt, created) and resolved, the
 * columns its Overview reads them from.
 */
export interface IncidentEpisodeRootCauseRow {
  declaredAt?: Date | null | undefined;
  createdAt?: Date | null | undefined;
  resolvedAt?: Date | null | undefined;
}

// An alert episode's: it has no declaredAt, and started when it was created.
export interface AlertEpisodeRootCauseRow {
  createdAt?: Date | null | undefined;
  resolvedAt?: Date | null | undefined;
}

type AsDateFunction = (value: unknown) => Date | undefined;

// A moment the row holds, as its Overview takes it: a Date, or none.
const asDate: AsDateFunction = (value: unknown): Date | undefined => {
  return value instanceof Date ? value : undefined;
};

/*
 * When an episode's ranges start and end, worked out by its Overview's own
 * rule (getEpisodeTiming), from what its Overview hands that rule: the
 * episode's start, its last resolve (used only when it has no state
 * timeline), its state timeline and the project's states. It ends when it
 * was last resolved, only while it still is.
 */
export function getEpisodeRootCauseTimes(input: {
  startedAt: Date | undefined;
  resolvedAt: Date | undefined;
  stateTimeline: Array<EventStateTimelineDate>;
  states: Array<RootCauseState>;
  stateList: ResolvedStateList;
}): RootCauseTimes {
  const timing: EpisodeTiming = getEpisodeTiming({
    startedAt: input.startedAt,
    resolvedAt: input.resolvedAt,
    list: input.stateList,
    states: input.states.map((state: RootCauseState) => {
      return {
        id: state._id?.toString() || "",
        name: state.name,
        order: state.order,
        isAcknowledgedState: state.isAcknowledgedState,
        isResolvedState: state.isResolvedState,
      };
    }),
    timelines: input.stateTimeline,
  });

  return {
    startedAt: timing.durationStartsAt,
    endedAt: timing.durationEndsAt,
  };
}

/*
 * An incident episode: it started when it was declared or, older than
 * declaredAt, when it was created, as its Overview says.
 */
export function getIncidentEpisodeRootCauseTimes(input: {
  episode: IncidentEpisodeRootCauseRow | null | undefined;
  stateTimeline: Array<EventStateTimelineDate>;
  states: Array<RootCauseState>;
}): RootCauseTimes {
  return getEpisodeRootCauseTimes({
    startedAt:
      asDate(input.episode?.declaredAt) || asDate(input.episode?.createdAt),
    resolvedAt: asDate(input.episode?.resolvedAt),
    stateTimeline: input.stateTimeline,
    states: input.states,
    stateList: StateListType.IncidentState,
  });
}

// An alert episode: it started when it was created.
export function getAlertEpisodeRootCauseTimes(input: {
  episode: AlertEpisodeRootCauseRow | null | undefined;
  stateTimeline: Array<EventStateTimelineDate>;
  states: Array<RootCauseState>;
}): RootCauseTimes {
  return getEpisodeRootCauseTimes({
    startedAt: asDate(input.episode?.createdAt),
    resolvedAt: asDate(input.episode?.resolvedAt),
    stateTimeline: input.stateTimeline,
    states: input.states,
    stateList: StateListType.AlertState,
  });
}

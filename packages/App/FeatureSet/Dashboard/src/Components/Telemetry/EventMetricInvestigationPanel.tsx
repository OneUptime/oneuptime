import React, { FunctionComponent, ReactElement, useMemo } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MetricTelemetrySnapshot from "Common/Utils/Monitor/MetricTelemetrySnapshot";
import MetricInvestigation from "../Metrics/Investigation/MetricInvestigation";
import MetricInvestigationTime, {
  MetricInvestigationTimePreset,
} from "../Metrics/Investigation/MetricInvestigationTime";
import MetricInvestigationTimePicker from "../Metrics/Investigation/MetricInvestigationTimePicker";
import useMetricInvestigation, {
  MetricInvestigationState,
} from "../Metrics/Investigation/UseMetricInvestigation";
import {
  EVALUATED_REGION_COLOR,
  EventMetricSubject,
  EventMetricWords,
  EventMoment,
  EventMomentLabel,
  EventMomentState,
  EventMomentTimelineEntry,
  getEventMetricStateList,
  getEventMetricWords,
  getEventMomentColor,
  getEventMomentLabel,
  getEventMoments,
} from "../../Utils/EventMetricInvestigation";
import {
  EVALUATED_LABEL,
  EVENT_AROUND_START_SELECTION,
  EVENT_RELATIVE_TIME_RANGES,
  getEventTimePresets,
} from "../../Utils/EventTimePresets";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import useEventMetricRule, { EventMetricRule } from "./useEventMetricRule";

// Where an event page keeps its metric investigation in its URL.
export const EVENT_METRIC_INVESTIGATION_URL_PREFIX: string = "metrics";

export const EVENT_METRIC_SCOPE_NOTE_TEST_ID: string =
  "event-metric-scope-note";

export interface ComponentProps {
  /*
   * The event's stored telemetry query, a metric one, already narrowed to
   * the series it is about (MetricSeriesScope).
   */
  telemetryQuery: TelemetryQuery;
  // The window the monitor evaluated when it opened the event, if it kept one.
  evaluationWindow: InBetween<Date> | null;
  /*
   * "host.name = prod-01": what the charts were narrowed to, from
   * MetricSeriesScope.getAppliedSeriesLabelSummary. "" when nothing was.
   */
  seriesSummary: string;
  subject: EventMetricSubject;
  /*
   * The incident's or alert's own id: the charts mark its moments
   * themselves, so it is not marked again as one of the incidents or alerts
   * in the window. Left out on an episode's page, whose members are.
   */
  eventId?: string | undefined;
  /*
   * The incident or alert whose monitor rule the charts draw (issue
   * #6250): the event itself (eventId), or on an episode's page the member
   * whose telemetry it shows.
   */
  ruleEventId?: string | undefined;
  // When it was declared or created.
  startedAt?: Date | undefined;
  // When it was resolved, while it still is.
  endedAt?: Date | undefined;
  // When its impact started, when somebody recorded it.
  impactStartedAt?: Date | undefined;
  // Its state timeline, and the project's states, for the moments it marks.
  stateTimeline: Array<EventMomentTimelineEntry>;
  states: Array<EventMomentState>;
  /*
   * Where the page keeps what the reader changed in its URL: "metrics" on
   * an event's Overview. A page with a card of its own beside it names its
   * own, so the two never read each other's (an incident's or an alert's
   * Root Cause page: "rootCauseMetrics").
   */
  urlParamPrefix?: string | undefined;
  /*
   * False for the metrics alone, without the Logs, Traces and Exceptions
   * tabs: on a page that shows them beside something else (an incident's
   * or an alert's Root Cause page). The tabs are there unless said
   * otherwise.
   */
  showsCompanionTabs?: boolean | undefined;
  /*
   * The metrics are the monitor's as it reads them now, not a snapshot the
   * event kept (one declared by hand, or opened before events kept one):
   * the card says so, as it does for a snapshot narrowed now, naming the
   * resource the monitor watches when it names one ("" when it does not).
   */
  chartedFromMonitorNow?: { resourceName: string } | undefined;
}

/**
 * The telemetry card of an incident, alert or episode a metrics monitor
 * opened (issue #5954): the metrics the monitor watched, to investigate in
 * place - over any time range, the ones around the event first, with any
 * other metric added - and the Logs, Traces and Exceptions tabs, which show
 * the same time range.
 *
 * The time range is picked on the card's header on every tab, and a drag
 * across a metric chart zooms them all. What the reader changes is kept in
 * the page's URL (see MetricInvestigationUrl), so a reload keeps it and a
 * link to it opens the same charts; the next person to open the page starts
 * from the event's own metrics, around its start.
 */
const EventMetricInvestigationPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: EventMetricWords = getEventMetricWords(props.subject);

  const queryConfigs: Array<MetricQueryConfigData> =
    props.telemetryQuery.metricViewData?.queryConfigs || [];
  const formulaConfigs: Array<MetricFormulaConfigData> =
    props.telemetryQuery.metricViewData?.formulaConfigs || [];

  const evaluationWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(props.evaluationWindow);

  /*
   * The value the monitor compared the metric with when it opened the event
   * (issue #6250), and the metrics the card starts from (issue #6265): each
   * query with the cluster, host or fleet its monitor read it for, which
   * the snapshot keeps beside it - or, for one stored before, narrowed to
   * what the monitor watches now.
   */
  const rule: EventMetricRule = useEventMetricRule({
    eventNoun: words.telemetryNoun,
    eventId: props.ruleEventId || props.eventId,
    snapshotQueries: {
      queryConfigs: queryConfigs,
      formulaConfigs: formulaConfigs,
    },
    storedScopes: MetricTelemetrySnapshot.getStoredScopes(props.telemetryQuery),
    storedServiceIds: MetricTelemetrySnapshot.getStoredServiceIds(
      props.telemetryQuery,
    ),
  });

  const investigation: MetricInvestigationState = useMetricInvestigation({
    defaultQueries: rule.scope.queries,
    getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
      return getEventTimePresets(
        {
          startedAt: props.startedAt,
          endedAt: props.endedAt,
          evaluationWindow: evaluationWindow,
        },
        now,
      );
    },
    defaultSelection: EVENT_AROUND_START_SELECTION,
    urlParamPrefix:
      props.urlParamPrefix || EVENT_METRIC_INVESTIGATION_URL_PREFIX,
  });

  const moments: Array<EventMoment> = getEventMoments({
    startedAt: props.startedAt,
    impactStartedAt: props.impactStartedAt,
    timeline: props.stateTimeline,
    states: props.states,
    stateList: getEventMetricStateList(props.subject),
  });

  // Rebuilt only when a moment really moved, not on every render of the page.
  const momentsKey: string = JSON.stringify(moments);

  const momentLines: Array<ChartTimeReferenceLineProps> = useMemo(() => {
    return moments.map((moment: EventMoment): ChartTimeReferenceLineProps => {
      const label: EventMomentLabel = getEventMomentLabel(moment, words);

      return {
        date: moment.date,
        label: label.isStateName
          ? translator.translateTerm(label.text)
          : translator.translateText(label.text) || label.text,
        subtitle:
          translator.translateText(words.momentSubtitle) ||
          words.momentSubtitle,
        color: getEventMomentColor(moment.role, words),
        kind: words.markerKind,
      };
    });
  }, [momentsKey, props.subject, translator]);

  const evaluationStartMs: number = evaluationWindow
    ? evaluationWindow.startValue.getTime()
    : Number.NaN;
  const evaluationEndMs: number = evaluationWindow
    ? evaluationWindow.endValue.getTime()
    : Number.NaN;

  // What the monitor evaluated, shaded on every chart it falls on.
  const regions: Array<ChartReferenceRegionProps> = useMemo(() => {
    if (
      !Number.isFinite(evaluationStartMs) ||
      !Number.isFinite(evaluationEndMs)
    ) {
      return [];
    }

    return [
      {
        startDate: new Date(evaluationStartMs),
        endDate: new Date(evaluationEndMs),
        label: translator.translateText(EVALUATED_LABEL) || EVALUATED_LABEL,
        subtitle:
          translator.translateText(words.evaluatedSubtitle) ||
          words.evaluatedSubtitle,
        color: EVALUATED_REGION_COLOR,
      },
    ];
  }, [evaluationStartMs, evaluationEndMs, props.subject, translator]);

  /*
   * A snapshot that kept no query has nothing to investigate: the card is
   * left out, as it always was.
   */
  if (queryConfigs.length === 0) {
    return <></>;
  }

  /*
   * What it shows, in its subject's words: an incident's or an alert's
   * metrics, or an episode's first member's, narrowed to the series it is
   * about when the charts are.
   */
  const description: string = props.seriesSummary
    ? translator.translateTemplate(words.scopedDescription, {
        seriesSummary: props.seriesSummary,
      })
    : translator.translateText(words.description) || words.description;

  /*
   * Said while the charts show a snapshot narrowed now (see above), or the
   * monitor's metrics as it reads them now: the monitor may have watched
   * another resource when it opened the event. Gone once the reader picks
   * metrics of their own.
   */
  const scopedResourceName: string =
    rule.scope.resourceName || props.chartedFromMonitorNow?.resourceName || "";

  /*
   * A div, not a paragraph: the icon draws a div of its own, which a
   * paragraph may not hold.
   */
  const scopeNote: ReactElement | undefined =
    (rule.scope.isFromMonitorNow || props.chartedFromMonitorNow) &&
    !investigation.isQueriesChanged ? (
      <div
        className="flex items-center gap-1.5 text-xs text-gray-500"
        data-testid={EVENT_METRIC_SCOPE_NOTE_TEST_ID}
      >
        <Icon icon={IconProp.Info} className="h-3.5 w-3.5 text-gray-400" />
        {scopedResourceName
          ? translator.translateTemplate(
              "Charted for {{resource}}, which this monitor checks now.",
              { resource: scopedResourceName },
            )
          : translator.translateText(
              "Charted for what this monitor checks now.",
            )}
      </div>
    ) : undefined;

  const metrics: ReactElement = (
    <MetricInvestigation
      investigation={investigation}
      description={description}
      changedDescription={
        translator.translateText(
          "The metrics you picked. Reset brings back the metrics the monitor watched.",
        ) ||
        "The metrics you picked. Reset brings back the metrics the monitor watched."
      }
      presetsHeading={words.presetsHeading}
      relativeRanges={EVENT_RELATIVE_TIME_RANGES}
      moments={momentLines}
      regions={regions}
      thresholds={rule.thresholds}
      beforeToolbar={scopeNote}
      excludedIncidentIds={
        props.eventId && props.subject === EventMetricSubject.Incident
          ? [props.eventId]
          : undefined
      }
      excludedAlertIds={
        props.eventId && props.subject === EventMetricSubject.Alert
          ? [props.eventId]
          : undefined
      }
    />
  );

  // The metrics alone, where the page shows them beside something else.
  if (props.showsCompanionTabs === false) {
    return metrics;
  }

  /*
   * The same picker on every tab of the card, all picking the one time
   * range, so a reader on the Logs tab can move it there too.
   */
  const timePicker: ReactElement = (
    <MetricInvestigationTimePicker
      investigation={investigation}
      presetsHeading={words.presetsHeading}
      relativeRanges={EVENT_RELATIVE_TIME_RANGES}
    />
  );

  return (
    <TelemetryCompanionSignalTabs
      telemetryQuery={props.telemetryQuery}
      // The other tabs show the time range the metrics show, a zoom included.
      snapshotWindow={investigation.window}
      companionWindow="selected"
      snapshotWindowAlert={timePicker}
      eventNoun={words.telemetryNoun}
      primarySignalElement={metrics}
    />
  );
};

export default EventMetricInvestigationPanel;

import React, { FunctionComponent, ReactElement, useMemo } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MetricInvestigation from "../Metrics/Investigation/MetricInvestigation";
import MetricInvestigationTime, {
  MetricInvestigationTimePreset,
} from "../Metrics/Investigation/MetricInvestigationTime";
import MetricInvestigationTimePicker from "../Metrics/Investigation/MetricInvestigationTimePicker";
import useMetricInvestigation, {
  MetricInvestigationState,
} from "../Metrics/Investigation/UseMetricInvestigation";
import {
  EVALUATED_LABEL,
  EVALUATED_REGION_COLOR,
  EVENT_METRIC_DEFAULT_SELECTION,
  EVENT_METRIC_RELATIVE_RANGES,
  EventMetricSubject,
  EventMetricWords,
  EventMoment,
  EventMomentLabel,
  EventMomentState,
  EventMomentTimelineEntry,
  getEventMetricTimePresets,
  getEventMetricWords,
  getEventMomentColor,
  getEventMomentLabel,
  getEventMoments,
} from "../../Utils/EventMetricInvestigation";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import { MetricInvestigationThreshold } from "../Metrics/Investigation/MetricInvestigationThresholds";
import useEventMetricThresholds from "./useEventMetricThresholds";

// Where an event page keeps its metric investigation in its URL.
export const EVENT_METRIC_INVESTIGATION_URL_PREFIX: string = "metrics";

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

  const investigation: MetricInvestigationState = useMetricInvestigation({
    defaultQueries: {
      queryConfigs: queryConfigs,
      formulaConfigs: formulaConfigs,
    },
    getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
      return getEventMetricTimePresets(
        {
          startedAt: props.startedAt,
          endedAt: props.endedAt,
          evaluationWindow: evaluationWindow,
        },
        now,
      );
    },
    defaultSelection: EVENT_METRIC_DEFAULT_SELECTION,
    urlParamPrefix: EVENT_METRIC_INVESTIGATION_URL_PREFIX,
  });

  // The value the monitor compared the metric with when it opened the event.
  const thresholds: Array<MetricInvestigationThreshold> =
    useEventMetricThresholds({
      eventNoun: words.telemetryNoun,
      eventId: props.ruleEventId || props.eventId,
      snapshotQueries: {
        queryConfigs: queryConfigs,
        formulaConfigs: formulaConfigs,
      },
    });

  const moments: Array<EventMoment> = getEventMoments({
    startedAt: props.startedAt,
    impactStartedAt: props.impactStartedAt,
    timeline: props.stateTimeline,
    states: props.states,
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

  const isAlert: boolean = words.telemetryNoun === "alert";

  const description: string = props.seriesSummary
    ? isAlert
      ? translator.translateTemplate(
          "Metrics for this alert, scoped to the affected series ({{seriesSummary}}).",
          { seriesSummary: props.seriesSummary },
        )
      : translator.translateTemplate(
          "Metrics related to this incident, scoped to the affected series ({{seriesSummary}}).",
          { seriesSummary: props.seriesSummary },
        )
    : isAlert
      ? translator.translateText("Metrics for this alert.") ||
        "Metrics for this alert."
      : translator.translateText("Metrics related to this incident.") ||
        "Metrics related to this incident.";

  /*
   * The same picker on every tab of the card, all picking the one time
   * range, so a reader on the Logs tab can move it there too.
   */
  const timePicker: ReactElement = (
    <MetricInvestigationTimePicker
      investigation={investigation}
      presetsHeading={words.presetsHeading}
      relativeRanges={EVENT_METRIC_RELATIVE_RANGES}
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
      primarySignalElement={
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
          relativeRanges={EVENT_METRIC_RELATIVE_RANGES}
          moments={momentLines}
          regions={regions}
          thresholds={thresholds}
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
      }
    />
  );
};

export default EventMetricInvestigationPanel;

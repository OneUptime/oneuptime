import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import { ResolvedStateList } from "Common/Utils/ResolvedState";
import EventMetricInvestigationPanel from "./EventMetricInvestigationPanel";
import {
  EventMetricSubject,
  getEventMetricWords,
} from "../../Utils/EventMetricInvestigation";
import { EventStateTimelineDate } from "../../Utils/EventDuration";
import {
  RootCauseEvent,
  RootCauseMetrics,
  RootCauseState,
  RootCauseTimes,
  getRootCauseMetrics,
  getRootCauseTimes,
} from "../../Utils/EventRootCauseMetrics";

/*
 * Where a Root Cause page keeps what the reader changed in its URL
 * ("rootCauseMetricsTime=hour-before"): a name of its own, so it never
 * reads what the Overview's card keeps under "metrics". An incident's, an
 * alert's and an episode's Root Cause pages are routes of their own, so
 * they share it.
 */
export const ROOT_CAUSE_METRICS_URL_PREFIX: string = "rootCauseMetrics";

// The records a Root Cause page belongs to.
export type RootCauseSubject =
  | EventMetricSubject.Incident
  | EventMetricSubject.Alert
  | EventMetricSubject.IncidentEpisode
  | EventMetricSubject.AlertEpisode;

/*
 * Whether a Root Cause page is one incident's or one alert's own: the event
 * whose moments the charts mark - so it is not marked again among the
 * incidents or alerts in the window - and whose own rule they draw. An
 * episode's page is none of its members' own: every member is marked, as an
 * incident or an alert, and its first member's rule is drawn
 * (RootCauseEvent.ruleEventId), as on the episode's Overview.
 */
export const ROOT_CAUSE_SUBJECT_IS_ONE_EVENT: Record<
  RootCauseSubject,
  boolean
> = {
  [EventMetricSubject.Incident]: true,
  [EventMetricSubject.Alert]: true,
  [EventMetricSubject.IncidentEpisode]: false,
  [EventMetricSubject.AlertEpisode]: false,
};

/*
 * The record's state timeline and the project's states: its moments. An
 * episode's own start and end are read with them (its Overview's rule:
 * getEpisodeRootCauseTimes), as its first member's would not do; left out,
 * they are worked out from the event's start and its timeline.
 */
export interface RootCauseMoments {
  stateTimeline: Array<EventStateTimelineDate>;
  states: Array<RootCauseState>;
  times?: RootCauseTimes | undefined;
}

/*
 * How a Root Cause card reads its record: an incident's card reads an
 * incident (IncidentRootCauseMetricChart), an alert's an alert
 * (AlertRootCauseMetricChart), and an episode's card its first member and
 * then the episode (IncidentEpisodeRootCauseMetricChart,
 * AlertEpisodeRootCauseMetricChart). Kept as a constant of each, so the card
 * reads its record once per record.
 */
export interface RootCauseEventReader {
  subject: RootCauseSubject;
  // Whose states decide when it was resolved.
  stateList: ResolvedStateList;
  /*
   * What decides what it charts (and, for an incident or an alert, when it
   * started); null when there is nothing to chart it from.
   */
  readEvent: (eventId: ObjectID) => Promise<RootCauseEvent | null>;
  // Its moments. Read only for a card there is.
  readMoments: (eventId: ObjectID) => Promise<RootCauseMoments>;
}

export interface ComponentProps {
  eventId: ObjectID;
  reader: RootCauseEventReader;
}

interface LoadedCard {
  metrics: RootCauseMetrics;
  times: RootCauseTimes;
  impactStartedAt: Date | undefined;
  moments: RootCauseMoments;
  // The incident or alert whose rule the charts draw, when not the record.
  ruleEventId: string | undefined;
}

interface LoadedRootCause {
  eventId: string;
  // Null when there are no metrics behind the event: no card.
  card: LoadedCard | null;
}

/**
 * The metrics behind an incident, an alert or an episode, beside its root
 * cause (issues #6249, #6304 and #6320): the same investigation its
 * Overview shows (EventMetricInvestigationPanel), metrics only - over the
 * ranges around it (around its start, the hour or the day before it
 * started, its start to now or to its resolution, what the monitor saw),
 * relative ranges or a range of the reader's own, with its moments on the
 * charts, Edit metrics, Copy link, Reset and Open in Metric Explorer.
 *
 * It charts what the Overview charts when the event kept a metric snapshot,
 * and otherwise its monitor's metrics as the monitor reads them now (see
 * EventRootCauseMetrics); an episode, its first member's, anchored on the
 * episode. Nothing at all for a record with no metrics behind it, which
 * costs only the reads that decide so: its moments are read only for a card
 * there is. What the reader changes is kept in the page's URL under its own
 * names, so a reload keeps it and a link opens the same charts; an
 * untouched card writes nothing there.
 *
 * One card for all four Root Cause pages, so they cannot drift apart, as
 * their Overviews share the investigation itself.
 */
const EventRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const eventId: string = props.eventId.toString();
  const reader: RootCauseEventReader = props.reader;
  const [loaded, setLoaded] = useState<LoadedRootCause | null>(null);
  const [error, setError] = useState<{ eventId: string; text: string }>({
    eventId: "",
    text: "",
  });

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const event: RootCauseEvent | null = await reader.readEvent(
        new ObjectID(eventId),
      );

      const metrics: RootCauseMetrics | null = event
        ? getRootCauseMetrics(event)
        : null;

      if (!event || !metrics) {
        if (!isCancelled) {
          setLoaded({ eventId: eventId, card: null });
        }
        return;
      }

      /*
       * The event's moments, read the way its Overview reads them: its
       * state timeline and the project's states. Only for a card there is.
       */
      const moments: RootCauseMoments = await reader.readMoments(
        new ObjectID(eventId),
      );

      if (isCancelled) {
        return;
      }

      setLoaded({
        eventId: eventId,
        card: {
          metrics: metrics,
          /*
           * When it was declared or created, and resolved: as on its
           * Overview. An episode's moments say so themselves.
           */
          times:
            moments.times ||
            getRootCauseTimes({
              startedAt: event.startedAt,
              stateTimeline: moments.stateTimeline,
              states: moments.states,
              stateList: reader.stateList,
            }),
          impactStartedAt: event.impactStartedAt,
          moments: moments,
          ruleEventId: event.ruleEventId,
        },
      });
    };

    load().catch((err: Error) => {
      if (!isCancelled) {
        setError({ eventId: eventId, text: API.getFriendlyMessage(err) });
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [eventId, reader]);

  /*
   * What the card says it is while it reads, and when a read fails: the
   * investigation's own words for its subject, so the card keeps its title
   * and description when the charts come in.
   */
  const description: string = getEventMetricWords(reader.subject).description;
  const errorText: string = error.eventId === eventId ? error.text : "";

  if (errorText) {
    return (
      <Card title="Metrics" description={description}>
        <ErrorMessage message={errorText} />
      </Card>
    );
  }

  if (!loaded || loaded.eventId !== eventId) {
    return (
      <Card title="Metrics" description={description}>
        <ComponentLoader />
      </Card>
    );
  }

  if (!loaded.card) {
    // No metrics behind this event: nothing to show.
    return null;
  }

  const card: LoadedCard = loaded.card;

  return (
    /*
     * Mounted once the event is read, as the investigation asks: a link to
     * one of its ranges is read when it mounts. Another event mounts a card
     * of its own, on its own defaults.
     */
    <EventMetricInvestigationPanel
      key={eventId}
      telemetryQuery={card.metrics.telemetryQuery}
      evaluationWindow={card.metrics.evaluationWindow}
      seriesSummary={card.metrics.seriesSummary}
      subject={reader.subject}
      eventId={
        ROOT_CAUSE_SUBJECT_IS_ONE_EVENT[reader.subject] ? eventId : undefined
      }
      ruleEventId={card.ruleEventId}
      startedAt={card.times.startedAt}
      endedAt={card.times.endedAt}
      impactStartedAt={card.impactStartedAt}
      stateTimeline={card.moments.stateTimeline}
      states={card.moments.states}
      urlParamPrefix={ROOT_CAUSE_METRICS_URL_PREFIX}
      showsCompanionTabs={false}
      chartedFromMonitorNow={card.metrics.chartedFromMonitorNow}
    />
  );
};

export default EventRootCauseMetricChart;

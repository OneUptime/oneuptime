import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a metric investigation on an incident, alert or episode page is
 * anchored on: the moments of the event it marks on its charts, and the
 * words it speaks of the event with (issue #5954). The time ranges it
 * offers around the event are every event card's own (EventTimePresets).
 */

// What the investigation is about: the page it is on.
export enum EventMetricSubject {
  Incident = "incident",
  Alert = "alert",
  // An episode's page, which shows its first member's telemetry.
  IncidentEpisode = "incident-episode",
  AlertEpisode = "alert-episode",
}

// The words the investigation uses for its subject, in English.
export interface EventMetricWords {
  // Above the ranges anchored on it in the time picker.
  presetsHeading: string;
  // Under each of its own moments on the charts, telling them from others'.
  momentSubtitle: string;
  // What its start is called on the charts, as its page's first tile does.
  startedLabel: string;
  // Under the shaded window the monitor evaluated.
  evaluatedSubtitle: string;
  // The noun the telemetry card's other tabs speak of it with.
  telemetryNoun: "incident" | "alert";
  // How its moments rank among other marks where they cluster.
  markerKind: ChartEventKind;
  /*
   * What its metric card says it shows, under the card's title: on its
   * Overview, and on its Root Cause page while the card reads and when a
   * read fails. An episode's card shows its first member's metrics
   * (EpisodeFirstMember), and says so.
   */
  description: string;
  // The same, once the charts are narrowed to the series it is about.
  scopedDescription: string;
}

export function getEventMetricWords(
  subject: EventMetricSubject,
): EventMetricWords {
  switch (subject) {
    case EventMetricSubject.Alert:
      return {
        presetsHeading: translationKey("Around this alert"),
        momentSubtitle: translationKey("This alert"),
        startedLabel: translationKey("Created"),
        evaluatedSubtitle: translationKey(
          "What the monitor evaluated when it opened this alert.",
        ),
        telemetryNoun: "alert",
        markerKind: ChartEventKind.Alert,
        description: translationKey("Metrics for this alert."),
        scopedDescription: translationKey(
          "Metrics for this alert, scoped to the affected series ({{seriesSummary}}).",
        ),
      };
    case EventMetricSubject.IncidentEpisode:
      return {
        presetsHeading: translationKey("Around this episode"),
        momentSubtitle: translationKey("This episode"),
        startedLabel: translationKey("Declared"),
        evaluatedSubtitle: translationKey(
          "What the monitor evaluated when it opened this episode's first incident.",
        ),
        telemetryNoun: "incident",
        markerKind: ChartEventKind.Incident,
        description: translationKey(
          "Metrics related to this episode's first incident.",
        ),
        scopedDescription: translationKey(
          "Metrics related to this episode's first incident, scoped to the affected series ({{seriesSummary}}).",
        ),
      };
    case EventMetricSubject.AlertEpisode:
      return {
        presetsHeading: translationKey("Around this episode"),
        momentSubtitle: translationKey("This episode"),
        startedLabel: translationKey("Created"),
        evaluatedSubtitle: translationKey(
          "What the monitor evaluated when it opened this episode's first alert.",
        ),
        telemetryNoun: "alert",
        markerKind: ChartEventKind.Alert,
        description: translationKey("Metrics for this episode's first alert."),
        scopedDescription: translationKey(
          "Metrics for this episode's first alert, scoped to the affected series ({{seriesSummary}}).",
        ),
      };
    case EventMetricSubject.Incident:
    default:
      return {
        presetsHeading: translationKey("Around this incident"),
        momentSubtitle: translationKey("This incident"),
        startedLabel: translationKey("Declared"),
        evaluatedSubtitle: translationKey(
          "What the monitor evaluated when it opened this incident.",
        ),
        telemetryNoun: "incident",
        markerKind: ChartEventKind.Incident,
        description: translationKey("Metrics related to this incident."),
        scopedDescription: translationKey(
          "Metrics related to this incident, scoped to the affected series ({{seriesSummary}}).",
        ),
      };
  }
}

// The colour the shaded window the monitor evaluated is drawn in.
export const EVALUATED_REGION_COLOR: string = "#6366f1"; // indigo-500

type ToMsFunction = (value: Date | null | undefined) => number;

const toMs: ToMsFunction = (value: Date | null | undefined): number => {
  if (!(value instanceof Date)) {
    return Number.NaN;
  }

  return value.getTime();
};

// What a moment of the event marked on the charts is.
export enum EventMomentRole {
  Started = "started",
  ImpactStarted = "impact-started",
  Acknowledged = "acknowledged",
  Resolved = "resolved",
  StateChanged = "state-changed",
}

export interface EventMoment {
  date: Date;
  role: EventMomentRole;
  /*
   * The state it moved into, as the project named it, for a state change;
   * "" otherwise, or when the state is no longer known.
   */
  stateName: string;
}

// One entry of the event's state timeline: when it moved into which state.
export interface EventMomentTimelineEntry {
  stateId?: string | undefined;
  startsAt?: Date | undefined;
}

// What the moments read of the project's states.
export interface EventMomentState {
  _id?: string | undefined;
  name?: string | undefined;
  isAcknowledgedState?: boolean | undefined;
  isResolvedState?: boolean | undefined;
}

/*
 * The moments of an event the charts mark, in time order:
 *
 * - when it started (declared, or created);
 * - when its impact started, when somebody recorded that it started earlier;
 * - every change of its state after the one it was opened in, which the
 *   start already marks: acknowledged, resolved, reopened, or a state of the
 *   project's own such as Monitoring.
 */
export function getEventMoments(input: {
  startedAt?: Date | null | undefined;
  impactStartedAt?: Date | null | undefined;
  timeline: Array<EventMomentTimelineEntry>;
  states: Array<EventMomentState>;
}): Array<EventMoment> {
  const moments: Array<EventMoment> = [];
  const startedMs: number = toMs(input.startedAt);

  if (Number.isFinite(startedMs)) {
    moments.push({
      date: new Date(startedMs),
      role: EventMomentRole.Started,
      stateName: "",
    });
  }

  const impactStartedMs: number = toMs(input.impactStartedAt);

  if (
    Number.isFinite(impactStartedMs) &&
    (!Number.isFinite(startedMs) || impactStartedMs < startedMs)
  ) {
    moments.push({
      date: new Date(impactStartedMs),
      role: EventMomentRole.ImpactStarted,
      stateName: "",
    });
  }

  const changes: Array<EventMomentTimelineEntry> = input.timeline
    .filter((entry: EventMomentTimelineEntry): boolean => {
      return Number.isFinite(toMs(entry.startsAt));
    })
    .sort(
      (
        first: EventMomentTimelineEntry,
        second: EventMomentTimelineEntry,
      ): number => {
        return toMs(first.startsAt) - toMs(second.startsAt);
      },
    )
    // The state it was opened in: the start marks that moment already.
    .slice(1);

  for (const change of changes) {
    const state: EventMomentState | undefined = input.states.find(
      (candidate: EventMomentState): boolean => {
        return Boolean(change.stateId) && candidate._id === change.stateId;
      },
    );

    moments.push({
      date: new Date(toMs(change.startsAt)),
      role: state?.isResolvedState
        ? EventMomentRole.Resolved
        : state?.isAcknowledgedState
          ? EventMomentRole.Acknowledged
          : EventMomentRole.StateChanged,
      stateName: state?.name?.trim() || "",
    });
  }

  return moments.sort((first: EventMoment, second: EventMoment): number => {
    return first.date.getTime() - second.date.getTime();
  });
}

// What a moment is called when its state is no longer known, in English.
export const IMPACT_STARTED_LABEL: string = translationKey("Impact started");
export const ACKNOWLEDGED_LABEL: string = translationKey("Acknowledged");
export const RESOLVED_LABEL: string = translationKey("Resolved");
export const STATE_CHANGED_LABEL: string = translationKey("State changed");

export interface EventMomentLabel {
  text: string;
  /*
   * A state's name as the project wrote it: looked up as a term (the seeded
   * "Acknowledged" reads in the reader's language, a project's own name as
   * written). Otherwise English to look up as it is.
   */
  isStateName: boolean;
}

/*
 * What a moment is called on the charts: the start as the subject's page
 * calls it ("Declared", "Created"), a state change by its state's name, or,
 * when that state is no longer known, by what kind of change it was.
 */
export function getEventMomentLabel(
  moment: EventMoment,
  words: EventMetricWords,
): EventMomentLabel {
  if (moment.role === EventMomentRole.Started) {
    return { text: words.startedLabel, isStateName: false };
  }

  if (moment.role === EventMomentRole.ImpactStarted) {
    return { text: IMPACT_STARTED_LABEL, isStateName: false };
  }

  if (moment.stateName) {
    return { text: moment.stateName, isStateName: true };
  }

  if (moment.role === EventMomentRole.Acknowledged) {
    return { text: ACKNOWLEDGED_LABEL, isStateName: false };
  }

  if (moment.role === EventMomentRole.Resolved) {
    return { text: RESOLVED_LABEL, isStateName: false };
  }

  return { text: STATE_CHANGED_LABEL, isStateName: false };
}

// The colour each kind of moment is marked in, so the charts read at a glance.
export const EVENT_MOMENT_COLORS: Record<EventMomentRole, string> = {
  [EventMomentRole.Started]: "#ef4444", // red-500
  [EventMomentRole.ImpactStarted]: "#ec4899", // pink-500
  [EventMomentRole.Acknowledged]: "#f59e0b", // amber-500
  [EventMomentRole.Resolved]: "#10b981", // emerald-500
  [EventMomentRole.StateChanged]: "#64748b", // slate-500
};

// An alert's start, in the alerts' own orange rather than an incident's red.
export const ALERT_STARTED_COLOR: string = "#f97316"; // orange-500

export function getEventMomentColor(
  role: EventMomentRole,
  words: EventMetricWords,
): string {
  if (
    role === EventMomentRole.Started &&
    words.markerKind === ChartEventKind.Alert
  ) {
    return ALERT_STARTED_COLOR;
  }

  return EVENT_MOMENT_COLORS[role];
}

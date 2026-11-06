import InBetween from "Common/Types/BaseDatabase/InBetween";
import TimeRange from "Common/Types/Time/TimeRange";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import MetricInvestigationTime, {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
} from "../Components/Metrics/Investigation/MetricInvestigationTime";

/*
 * What a metric investigation on an incident, alert or episode page is
 * anchored on: the time ranges it offers around the event (issue #5954) and
 * the moments of the event it marks on its charts.
 *
 * The time ranges are worked out for a given "now", the moment the
 * investigation last resolved its window, so nothing moves between the
 * reader's picks and refreshes.
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
      };
  }
}

// What the telemetry card's other tabs call the time range they follow.
export const SELECTED_TIME_RANGE_NAME: string = "the selected time range";

// The colour the shaded window the monitor evaluated is drawn in.
export const EVALUATED_REGION_COLOR: string = "#6366f1"; // indigo-500

export enum EventMetricPresetId {
  AroundStart = "around-start",
  HourBefore = "hour-before",
  DayBefore = "day-before",
  StartToEnd = "start-to-end",
  Evaluated = "evaluated",
}

// The ranges' names, in English; looked up where they are shown.
export const AROUND_START_LABEL: string = translationKey("Around the start");
export const HOUR_BEFORE_LABEL: string = translationKey(
  "The hour before it started",
);
export const DAY_BEFORE_LABEL: string = translationKey(
  "The day before it started",
);
export const START_TO_NOW_LABEL: string = translationKey("Start to now");
export const START_TO_RESOLUTION_LABEL: string = translationKey(
  "Start to resolution",
);
export const EVALUATED_LABEL: string = translationKey("What the monitor saw");

// How far "Around the start" reaches on either side of the start.
export const AROUND_START_MINUTES: number = 30;

/*
 * How far "Start to now" and "Start to resolution" reach before the start
 * and past the resolution, so the start and the end are not on the charts'
 * very edges.
 */
export const START_TO_END_MARGIN_MINUTES: number = 15;

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * The ranges relative to now an event's investigation offers besides its
 * own: is it still happening, and what has the metric done lately.
 */
export const EVENT_METRIC_RELATIVE_RANGES: Array<TimeRange> = [
  TimeRange.PAST_FIFTEEN_MINS,
  TimeRange.PAST_ONE_HOUR,
  TimeRange.PAST_THREE_HOURS,
  TimeRange.PAST_ONE_DAY,
  TimeRange.PAST_ONE_WEEK,
];

// What an event's investigation shows before anybody picks anything.
export const EVENT_METRIC_DEFAULT_SELECTION: MetricInvestigationTimeSelection =
  {
    kind: MetricInvestigationTimeKind.Preset,
    presetId: EventMetricPresetId.AroundStart,
  };

export interface EventMetricTimeAnchors {
  // When it was declared (an incident) or created (an alert).
  startedAt?: Date | null | undefined;
  // When it was resolved, while it still is; absent while it is open.
  endedAt?: Date | null | undefined;
  // The window the monitor evaluated when it opened it, when it kept one.
  evaluationWindow?: InBetween<Date> | null | undefined;
}

type ToMsFunction = (value: Date | null | undefined) => number;

const toMs: ToMsFunction = (value: Date | null | undefined): number => {
  if (!(value instanceof Date)) {
    return Number.NaN;
  }

  return value.getTime();
};

type WindowFunction = (startMs: number, endMs: number) => InBetween<Date>;

const toWindow: WindowFunction = (
  startMs: number,
  endMs: number,
): InBetween<Date> => {
  return new InBetween<Date>(new Date(startMs), new Date(endMs));
};

/*
 * The time ranges an event's investigation offers, in the order the picker
 * lists them:
 *
 * - Around the start: 30 minutes on either side of the start, and from the
 *   start of what the monitor evaluated when that began earlier, so the
 *   default always shows everything the monitor looked at. Never past now.
 * - The hour before it started, and the day before it started: how it built
 *   up. Both end at the start.
 * - Start to now (open) or Start to resolution (resolved): the whole event,
 *   15 minutes either side.
 * - What the monitor saw: exactly the window the monitor evaluated, when
 *   the event kept one.
 *
 * Without a start the event has nothing to anchor on but what the monitor
 * evaluated: its end stands in for the start. Without either, there is
 * nothing to offer.
 */
export function getEventMetricTimePresets(
  anchors: EventMetricTimeAnchors,
  now: Date,
): Array<MetricInvestigationTimePreset> {
  const nowMs: number = toMs(now);
  const evaluationWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(anchors.evaluationWindow);

  let startMs: number = toMs(anchors.startedAt);

  if (!Number.isFinite(startMs) && evaluationWindow) {
    startMs = evaluationWindow.endValue.getTime();
  }

  const presets: Array<MetricInvestigationTimePreset> = [];

  if (Number.isFinite(startMs)) {
    /*
     * An end at now, except where the reader's clock is behind the event's
     * (a window that would end before it starts): then the window ends
     * where it would have.
     */
    const endAtNowOr: (windowStartMs: number, endMs: number) => number = (
      windowStartMs: number,
      endMs: number,
    ): number => {
      if (Number.isFinite(nowMs) && nowMs < endMs && nowMs > windowStartMs) {
        return nowMs;
      }

      return endMs;
    };

    let aroundStartMs: number = startMs - AROUND_START_MINUTES * MINUTE_MS;

    if (evaluationWindow) {
      aroundStartMs = Math.min(
        aroundStartMs,
        evaluationWindow.startValue.getTime(),
      );
    }

    presets.push({
      id: EventMetricPresetId.AroundStart,
      label: AROUND_START_LABEL,
      window: toWindow(
        aroundStartMs,
        endAtNowOr(aroundStartMs, startMs + AROUND_START_MINUTES * MINUTE_MS),
      ),
    });

    presets.push({
      id: EventMetricPresetId.HourBefore,
      label: HOUR_BEFORE_LABEL,
      window: toWindow(startMs - HOUR_MS, startMs),
    });

    presets.push({
      id: EventMetricPresetId.DayBefore,
      label: DAY_BEFORE_LABEL,
      window: toWindow(startMs - DAY_MS, startMs),
    });

    const endedMs: number = toMs(anchors.endedAt);
    const isResolved: boolean = Number.isFinite(endedMs) && endedMs >= startMs;
    const fromMs: number = startMs - START_TO_END_MARGIN_MINUTES * MINUTE_MS;

    if (isResolved) {
      presets.push({
        id: EventMetricPresetId.StartToEnd,
        label: START_TO_RESOLUTION_LABEL,
        window: toWindow(
          fromMs,
          endAtNowOr(fromMs, endedMs + START_TO_END_MARGIN_MINUTES * MINUTE_MS),
        ),
      });
    } else {
      presets.push({
        id: EventMetricPresetId.StartToEnd,
        label: START_TO_NOW_LABEL,
        window: toWindow(
          fromMs,
          Number.isFinite(nowMs) && nowMs > fromMs
            ? nowMs
            : startMs + START_TO_END_MARGIN_MINUTES * MINUTE_MS,
        ),
      });
    }
  }

  if (evaluationWindow) {
    presets.push({
      id: EventMetricPresetId.Evaluated,
      label: EVALUATED_LABEL,
      window: evaluationWindow,
    });
  }

  return presets.filter((preset: MetricInvestigationTimePreset): boolean => {
    return MetricInvestigationTime.isUsableWindow(preset.window);
  });
}

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

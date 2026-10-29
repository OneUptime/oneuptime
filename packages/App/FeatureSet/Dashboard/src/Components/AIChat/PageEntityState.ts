import type { SuggestedQuestion } from "./PageContext";
import AIChatPageContextType from "Common/Types/AI/AIChatPageContext";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * Where the record Ask AI was opened on stands, read with its title each
 * time Ask AI opens on it (the follow-up #5273 listed), so the questions it
 * suggests fit that record: a resolved incident is asked how the response
 * went and what would stop it coming back, not for a status update; a
 * monitor that is not operational is asked why; a maintenance event that
 * has not started is asked what to check before it does.
 *
 * Only what the read says decides it. A state that could not be read, or
 * has not been read yet, is no state: the page type's own questions stay.
 */
export enum PageEntityState {
  // An incident or an alert that is not resolved.
  Open = "Open",
  // An incident or an alert in a resolved state.
  Resolved = "Resolved",
  // A monitor whose current status is an operational one.
  Operational = "Operational",
  // A monitor whose current status is not an operational one.
  NotOperational = "NotOperational",
  // A scheduled maintenance event that has not started.
  Upcoming = "Upcoming",
  // A scheduled maintenance event under way.
  Ongoing = "Ongoing",
  // A scheduled maintenance event that has ended, or was completed.
  Ended = "Ended",
}

export const PAGE_ENTITY_STATES: ReadonlyArray<PageEntityState> =
  Object.values(PageEntityState);

export function isPageEntityState(value: unknown): value is PageEntityState {
  return PAGE_ENTITY_STATES.includes(value as PageEntityState);
}

/*
 * An incident or an alert, from its current state's isResolvedState: only
 * a flag that was read says which. A state read without it is no state.
 */
export function getResolvableEntityState(
  isResolvedState: unknown,
): PageEntityState | undefined {
  if (isResolvedState === true) {
    return PageEntityState.Resolved;
  }

  if (isResolvedState === false) {
    return PageEntityState.Open;
  }

  return undefined;
}

// A monitor, from its current status's isOperationalState.
export function getMonitorEntityState(
  isOperationalState: unknown,
): PageEntityState | undefined {
  if (isOperationalState === true) {
    return PageEntityState.Operational;
  }

  if (isOperationalState === false) {
    return PageEntityState.NotOperational;
  }

  return undefined;
}

export interface ScheduledMaintenanceStateFacts {
  isScheduledState?: unknown;
  isOngoingState?: unknown;
  isEndedState?: unknown;
  isResolvedState?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  now: Date;
}

function toTime(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const time: number =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string" || typeof value === "number"
        ? new Date(value).getTime()
        : Number.NaN;

  return Number.isFinite(time) ? time : null;
}

/*
 * A scheduled maintenance event, from its current state's flags - what the
 * product says the event is - and, for a state of the project's own that
 * carries none of them, from its window.
 */
export function getScheduledMaintenanceEntityState(
  facts: ScheduledMaintenanceStateFacts,
): PageEntityState | undefined {
  if (facts.isEndedState === true || facts.isResolvedState === true) {
    return PageEntityState.Ended;
  }

  if (facts.isOngoingState === true) {
    return PageEntityState.Ongoing;
  }

  if (facts.isScheduledState === true) {
    return PageEntityState.Upcoming;
  }

  const now: number = facts.now.getTime();
  const startsAt: number | null = toTime(facts.startsAt);
  const endsAt: number | null = toTime(facts.endsAt);

  if (startsAt === null || !Number.isFinite(now)) {
    return undefined;
  }

  if (now < startsAt) {
    return PageEntityState.Upcoming;
  }

  if (endsAt !== null && now >= endsAt) {
    return PageEntityState.Ended;
  }

  return PageEntityState.Ongoing;
}

/*
 * The questions for a record in a state the page type's own do not fit, or
 * null where they do. Each keeps the page type's first question in its
 * place, and changes a card where it stands, so the questions that come in
 * when the read returns do not move the others around.
 */
export function getEntityStateSuggestions(
  type: AIChatPageContextType,
  state: PageEntityState | undefined,
): Array<SuggestedQuestion> | null {
  if (!state) {
    return null;
  }

  if (
    type === AIChatPageContextType.Incident &&
    state === PageEntityState.Resolved
  ) {
    return [
      {
        icon: IconProp.Document,
        title: "Summarize",
        question:
          "Summarize this incident: what happened, how long it lasted, and how it was resolved.",
      },
      {
        icon: IconProp.Search,
        title: "Find root cause",
        question:
          "Investigate the likely root cause of this incident using logs, traces and metrics from around when it started.",
      },
      {
        icon: IconProp.Clock,
        title: "Response timeline",
        question:
          "How long did this incident take to acknowledge and to resolve, and where did the response slow down?",
      },
      {
        icon: IconProp.Wrench,
        title: "Prevent a repeat",
        question:
          "What would stop this incident from happening again? Base it on its root cause and on similar past incidents.",
      },
    ];
  }

  if (
    type === AIChatPageContextType.Alert &&
    state === PageEntityState.Resolved
  ) {
    return [
      {
        icon: IconProp.Document,
        title: "Summarize",
        question:
          "Summarize this alert: why it fired, how long it lasted, and how it was resolved.",
      },
      {
        icon: IconProp.Search,
        title: "Investigate",
        question:
          "Investigate what triggered this alert — check related logs, traces and metrics around when it fired.",
      },
      {
        icon: IconProp.Alert,
        title: "Was it real?",
        question:
          "Was this alert a real problem or noise? Check the logs, traces and metrics from around when it fired.",
      },
      {
        icon: IconProp.ChartBar,
        title: "Fired before?",
        question:
          "How often have alerts like this one fired over the last 7 days, and is it noisy?",
      },
    ];
  }

  if (
    type === AIChatPageContextType.Monitor &&
    state === PageEntityState.NotOperational
  ) {
    return [
      {
        icon: IconProp.Document,
        title: "Status summary",
        question:
          "Summarize this monitor's current status and its recent status timeline.",
      },
      {
        icon: IconProp.Search,
        title: "Why not operational?",
        question:
          "Why is this monitor not operational right now? Investigate the telemetry from around when its status changed.",
      },
      {
        icon: IconProp.Activity,
        title: "Is it flapping?",
        question:
          "Is this monitor flapping? Analyze its status changes over the last 7 days.",
      },
      {
        icon: IconProp.Alert,
        title: "Related incidents",
        question: "Which incidents and alerts are connected to this monitor?",
      },
    ];
  }

  if (
    type === AIChatPageContextType.ScheduledMaintenanceEvent &&
    state === PageEntityState.Upcoming
  ) {
    return [
      {
        icon: IconProp.Document,
        title: "Summarize",
        question: "Summarize this scheduled maintenance event.",
      },
      {
        icon: IconProp.CheckCircle,
        title: "Healthy before it starts?",
        question:
          "Are the monitors this maintenance covers operational right now, before it starts? Flag any that are not.",
      },
      {
        icon: IconProp.Announcement,
        title: "Draft a notice",
        question:
          "Draft a short notice about this maintenance for the people it affects: what will change, when, and what they may notice.",
      },
      {
        icon: IconProp.Calendar,
        title: "Overlapping maintenance?",
        question:
          "Does other scheduled maintenance overlap this one's window or cover the same monitors?",
      },
    ];
  }

  if (
    type === AIChatPageContextType.ScheduledMaintenanceEvent &&
    state === PageEntityState.Ended
  ) {
    return [
      {
        icon: IconProp.Document,
        title: "Summarize",
        question: "Summarize this scheduled maintenance event.",
      },
      {
        icon: IconProp.Activity,
        title: "Impact during window",
        question:
          "What changed in our telemetry during this maintenance window — errors, monitor status changes or anomalies?",
      },
      {
        icon: IconProp.AltGlobe,
        title: "Monitor status",
        question:
          "Did any monitors change status during this maintenance window?",
      },
      {
        icon: IconProp.CheckCircle,
        title: "Back to normal?",
        question:
          "Now that this maintenance has ended, are its monitors operational again, and are errors back to where they were before it started?",
      },
    ];
  }

  return null;
}

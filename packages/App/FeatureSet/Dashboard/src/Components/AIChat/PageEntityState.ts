import type { SuggestedQuestion } from "./PageContext";
import AIChatPageContextType from "Common/Types/AI/AIChatPageContext";
import IconProp from "Common/Types/Icon/IconProp";
import { ScheduledMaintenancePhaseOfState } from "Common/Utils/ScheduledMaintenanceStart";
import MonitoringOff from "Common/Utils/Monitor/MonitoringOff";

/*
 * Where the record Ask AI was opened on stands, read with its title each
 * time Ask AI opens on it (the follow-up #5273 listed), so the questions it
 * suggests fit that record: a resolved incident is asked how the response
 * went and what would stop it coming back, not for a status update; a
 * monitor that is not operational is asked why, and one whose monitoring is
 * turned off about the status it had before that, not as if it were live; a
 * maintenance event that has not started is asked what to check before it
 * does.
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
  /*
   * A monitor whose monitoring is turned off, whatever its status: nothing
   * checks it, so that status is only what its last check saw
   * (Common/Utils/Monitor/MonitoringOff).
   */
  MonitoringOff = "MonitoringOff",
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
 * An incident or an alert, from whether its state counts as resolved - the
 * one rule every part of OneUptime asks (Common/Utils/ResolvedState: its
 * place at or below the project's resolved state, so a state of the
 * project's own after Resolved, "Closed", is resolved too). Unknown - the
 * states could not be read - is no state.
 */
export function getResolvableEntityState(
  isResolved: boolean | null | undefined,
): PageEntityState | undefined {
  if (isResolved === true) {
    return PageEntityState.Resolved;
  }

  if (isResolved === false) {
    return PageEntityState.Open;
  }

  return undefined;
}

/*
 * A monitor, from its current status's isOperationalState - unless its
 * monitoring is turned off: then the status it holds is only what its last
 * check saw, so it is neither operational nor not operational now, and Ask
 * AI does not ask why it is down (issue #6477).
 */
export function getMonitorEntityState(
  isOperationalState: unknown,
  disableActiveMonitoring?: boolean | null | undefined,
): PageEntityState | undefined {
  if (MonitoringOff.isOff({ disableActiveMonitoring })) {
    return PageEntityState.MonitoringOff;
  }

  if (isOperationalState === true) {
    return PageEntityState.Operational;
  }

  if (isOperationalState === false) {
    return PageEntityState.NotOperational;
  }

  return undefined;
}

/*
 * A scheduled maintenance event, from where it is in its life by the state
 * it is in - the one rule the server, the status pages and the Dashboard's
 * header ask (Common/Utils/ScheduledMaintenanceStart.getPhase): not started,
 * in progress, or over. Unknown is no state.
 */
export function getScheduledMaintenanceEntityState(
  phase: ScheduledMaintenancePhaseOfState | null | undefined,
): PageEntityState | undefined {
  switch (phase) {
    case ScheduledMaintenancePhaseOfState.NotStarted:
      return PageEntityState.Upcoming;
    case ScheduledMaintenancePhaseOfState.InProgress:
      return PageEntityState.Ongoing;
    case ScheduledMaintenancePhaseOfState.Over:
      return PageEntityState.Ended;
    default:
      return undefined;
  }
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

  /*
   * Nothing checks a monitor whose monitoring is off, so it is asked about
   * the status it had and the changes it went through before that, not
   * whether it is flapping now: the timeline stopped when its checks did.
   */
  if (
    type === AIChatPageContextType.Monitor &&
    state === PageEntityState.MonitoringOff
  ) {
    return [
      {
        icon: IconProp.Document,
        title: "Status summary",
        question:
          "Summarize this monitor's last reported status and its status timeline before its monitoring was turned off.",
      },
      {
        icon: IconProp.Search,
        title: "Last status change",
        question:
          "Why did this monitor last change status? Investigate the telemetry around that time.",
      },
      {
        icon: IconProp.Activity,
        title: "Was it flapping?",
        question:
          "Was this monitor flapping before its monitoring was turned off? Analyze the status changes it had before then.",
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
        question: "Summarize this maintenance event.",
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
        question: "Summarize this maintenance event.",
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

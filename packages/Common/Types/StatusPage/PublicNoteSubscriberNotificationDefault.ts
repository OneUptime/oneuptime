import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";

/*
 * An event can start without notifying status page subscribers: an incident
 * declared with the "Notify Status Page Subscribers" box unticked (or as a
 * private incident), an incident episode created with its notify setting off,
 * or a scheduled maintenance event created with "Event Created: Notify Status
 * Page Subscribers" unticked. Its subscribers were not told it started, so a
 * public note posted on it afterwards should not be what tells them - unless
 * whoever posts the note asks for that.
 *
 * So a new public note on such an event starts with "notify subscribers" off.
 * This only moves the default: a caller that says yes or no explicitly is
 * always obeyed.
 *
 * Everything here is shared by the dashboard, which sets the checkbox's
 * starting value, and the server, which fills in the choice for notes posted
 * without one (Slack, Microsoft Teams, workflows, the API). That way the two
 * cannot drift apart.
 */

export interface IncidentSubscriberNotificationSetting {
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated?:
    | boolean
    | null
    | undefined;
}

export interface IncidentEpisodeSubscriberNotificationSetting {
  shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated?:
    | boolean
    | null
    | undefined;
}

export interface ScheduledMaintenanceSubscriberNotificationSetting {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated?:
    | boolean
    | null
    | undefined;
}

export interface ScheduledMaintenanceStateChangeSubscriberNotificationSetting
  extends ScheduledMaintenanceSubscriberNotificationSetting {
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing?:
    | boolean
    | null
    | undefined;
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded?:
    | boolean
    | null
    | undefined;
}

/*
 * The state a scheduled maintenance event is being moved to: its flags, and
 * - for a state of the project's own - its id and place.
 */
export interface ScheduledMaintenanceTargetState {
  _id?: unknown;
  order?: number | null | undefined;
  isOngoingState?: boolean | null | undefined;
  isEndedState?: boolean | null | undefined;
  isResolvedState?: boolean | null | undefined;
}

/*
 * Where a move of a scheduled maintenance event happens: the project's
 * states, in their order, and the state the event moves from. Only a state
 * of the project's own needs it - whether a move into "Verifying" starts the
 * event, or a move into "Reviewing" ends it, only its place can tell.
 */
export interface ScheduledMaintenanceStateMove {
  states: Array<unknown>;
  currentState?: unknown;
}

export default class PublicNoteSubscriberNotificationDefault {
  // Shown under the checkbox when it starts unticked for this reason.
  public static readonly quietIncidentDescription: string =
    "Unticked by default because status page subscribers were not notified when this incident was declared.";

  public static readonly quietIncidentEpisodeDescription: string =
    "Unticked by default because status page subscribers were not notified when this episode was created.";

  public static readonly quietScheduledMaintenanceDescription: string =
    "Unticked by default because status page subscribers were not notified when this scheduled maintenance event was created.";

  /*
   * Only an explicit "no" on the parent event turns the default off. An
   * unknown setting (the event not loaded, or a row from before the setting
   * existed) keeps the long-standing default of notifying.
   */
  public static shouldNotifyForSetting(
    notifiedWhenEventStarted: boolean | null | undefined,
  ): boolean {
    return notifiedWhenEventStarted !== false;
  }

  public static shouldNotifyForIncident(
    incident: IncidentSubscriberNotificationSetting | null | undefined,
  ): boolean {
    return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
      incident?.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    );
  }

  public static shouldNotifyForIncidentEpisode(
    episode: IncidentEpisodeSubscriberNotificationSetting | null | undefined,
  ): boolean {
    return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
      episode?.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated,
    );
  }

  public static shouldNotifyForScheduledMaintenance(
    scheduledMaintenance:
      | ScheduledMaintenanceSubscriberNotificationSetting
      | null
      | undefined,
  ): boolean {
    return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
      scheduledMaintenance?.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    );
  }

  /*
   * A state change on a scheduled maintenance event tells subscribers about
   * the change itself, and the event has its own settings for two of them:
   * "Event Ongoing" and "Event Ended". Moving the event by hand into the
   * state that starts it or ends it starts with notifying on whenever the
   * event is set to announce that change - the automatic change would have
   * announced it - even if the event was created quietly. The start is the
   * move into the ongoing state, or - from a state where the event was not
   * in progress - into a state of the project's own placed between Ongoing
   * and Ended ("Verifying"); the end is the move into the ended or
   * completed state, or - from a state where it was in progress - into a
   * state of the project's own placed after Ended ("Reviewing")
   * (Common/Utils/ScheduledMaintenanceStart; a state of the project's own
   * needs `move` to be placed). Any other change follows the created
   * setting, like a public note. An event that notified subscribers when it
   * was created keeps notifying by default, as before.
   */
  public static shouldNotifyForScheduledMaintenanceStateChange(
    scheduledMaintenance:
      | ScheduledMaintenanceStateChangeSubscriberNotificationSetting
      | null
      | undefined,
    targetState: ScheduledMaintenanceTargetState | null | undefined,
    move?: ScheduledMaintenanceStateMove | undefined,
  ): boolean {
    if (
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      )
    ) {
      return true;
    }

    if (
      PublicNoteSubscriberNotificationDefault.isScheduledMaintenanceStart(
        targetState,
        move,
      )
    ) {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
        scheduledMaintenance?.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
      );
    }

    if (
      PublicNoteSubscriberNotificationDefault.isScheduledMaintenanceEnd(
        targetState,
        move,
      )
    ) {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
        scheduledMaintenance?.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
      );
    }

    return false;
  }

  /*
   * Whether moving the event into `targetState` starts it, as "Event
   * Ongoing" announces: the ongoing state itself, or a state of the
   * project's own where it is in progress, moved into from one where it was
   * not.
   */
  private static isScheduledMaintenanceStart(
    targetState: ScheduledMaintenanceTargetState | null | undefined,
    move: ScheduledMaintenanceStateMove | undefined,
  ): boolean {
    const byFlags: boolean | null =
      ScheduledMaintenanceStartUtil.isInProgressByFlags(
        PublicNoteSubscriberNotificationDefault.getListedState(
          targetState,
          move,
        ),
      );

    if (byFlags !== null) {
      return byFlags;
    }

    if (!targetState || !move) {
      return false;
    }

    return (
      ScheduledMaintenanceStartUtil.isInProgress({
        states: move.states,
        state: targetState,
      }) &&
      !(
        move.currentState &&
        ScheduledMaintenanceStartUtil.isInProgress({
          states: move.states,
          state: move.currentState,
        })
      )
    );
  }

  /*
   * Whether moving the event into `targetState` ends it, as "Event Ended"
   * announces: the ended or completed state itself, or a state of the
   * project's own where it is over, moved into from one where it was in
   * progress.
   */
  private static isScheduledMaintenanceEnd(
    targetState: ScheduledMaintenanceTargetState | null | undefined,
    move: ScheduledMaintenanceStateMove | undefined,
  ): boolean {
    const byFlags: boolean | null =
      ScheduledMaintenanceStartUtil.hasEndedByFlags(
        PublicNoteSubscriberNotificationDefault.getListedState(
          targetState,
          move,
        ),
      );

    if (byFlags !== null) {
      return byFlags;
    }

    if (!targetState || !move || !move.currentState) {
      return false;
    }

    return (
      ScheduledMaintenanceStartUtil.hasEnded({
        states: move.states,
        state: targetState,
      }) &&
      ScheduledMaintenanceStartUtil.isInProgress({
        states: move.states,
        state: move.currentState,
      })
    );
  }

  /*
   * The project's copy of `state` when the move's list holds it - it
   * carries the state's flags even when the state was handed over by its id
   * alone - or `state` as it is.
   */
  private static getListedState(
    state: ScheduledMaintenanceTargetState | null | undefined,
    move: ScheduledMaintenanceStateMove | undefined,
  ): unknown {
    const idOf: (value: unknown) => string = (value: unknown): string => {
      if (!value || typeof value !== "object") {
        return "";
      }

      const record: Record<string, unknown> = value as Record<string, unknown>;
      const id: unknown = record["_id"] ?? record["id"];

      return id === undefined || id === null
        ? ""
        : String(id).trim().toLowerCase();
    };

    const stateId: string = idOf(state);

    if (!stateId || !move) {
      return state;
    }

    return (
      move.states.find((candidate: unknown): boolean => {
        return idOf(candidate) === stateId;
      }) || state
    );
  }
}

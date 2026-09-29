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

// The state a scheduled maintenance event is being moved to.
export interface ScheduledMaintenanceTargetState {
  isOngoingState?: boolean | null | undefined;
  isEndedState?: boolean | null | undefined;
  isResolvedState?: boolean | null | undefined;
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
   * "Event Ongoing" and "Event Ended". Moving the event into one of those
   * states by hand starts with notifying on whenever the event is set to
   * announce that change - the automatic change would have announced it -
   * even if the event was created quietly. Any other change follows the
   * created setting, like a public note. An event that notified subscribers
   * when it was created keeps notifying by default, as before.
   */
  public static shouldNotifyForScheduledMaintenanceStateChange(
    scheduledMaintenance:
      | ScheduledMaintenanceStateChangeSubscriberNotificationSetting
      | null
      | undefined,
    targetState: ScheduledMaintenanceTargetState | null | undefined,
  ): boolean {
    if (
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      )
    ) {
      return true;
    }

    if (targetState?.isOngoingState) {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
        scheduledMaintenance?.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
      );
    }

    if (targetState?.isEndedState || targetState?.isResolvedState) {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
        scheduledMaintenance?.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
      );
    }

    return false;
  }
}

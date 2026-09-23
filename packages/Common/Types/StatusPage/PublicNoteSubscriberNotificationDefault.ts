/*
 * An incident can be declared without notifying status page subscribers:
 * the "Notify Status Page Subscribers" box was unticked, or the incident is
 * private. Its subscribers never heard about it, so a public note posted on
 * it afterwards should not be what tells them - unless whoever posts the
 * note asks for that.
 *
 * So a new public note on such an incident starts with "notify subscribers"
 * off. This only moves the default: a caller that says yes or no explicitly
 * is always obeyed.
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

export default class PublicNoteSubscriberNotificationDefault {
  // Shown under the checkbox when it starts unticked for this reason.
  public static readonly quietIncidentDescription: string =
    "Unticked by default because status page subscribers were not notified when this incident was declared.";

  /*
   * Only an explicit "no" on the incident turns the default off. An unknown
   * incident (not loaded, or a row from before the setting existed) keeps
   * the long-standing default of notifying.
   */
  public static shouldNotifyForIncident(
    incident: IncidentSubscriberNotificationSetting | null | undefined,
  ): boolean {
    return (
      incident?.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated !== false
    );
  }
}

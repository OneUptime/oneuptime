/*
 * WHETHER "NOTIFY STATUS PAGE SUBSCRIBERS" STARTS TICKED WHEN SOMEONE
 * DECLARES AN INCIDENT (#7606).
 *
 * Declare New Incident asks whether status page subscribers are told about
 * the new incident (the incident's
 * shouldStatusPageSubscribersBeNotifiedOnIncidentCreated). The box started
 * ticked in every project, so a team that works on an incident before anyone
 * outside hears of it had to remember to untick it every time - and one
 * forgotten box emailed every subscriber.
 *
 * Each project now says how the box starts:
 * Project.notifyStatusPageSubscribersOfNewIncidentsByDefault, the switch
 * "Notify status page subscribers by default" on Incidents -> Settings ->
 * Subscriber Notifications. It is on for every project, existing and new, so
 * nothing changes until a project owner or admin turns it off. Off, the box
 * starts unticked, and subscribers hear about a new incident only when the
 * person declaring it ticks the box.
 *
 * Only where the box starts moves. What the person declaring leaves it at is
 * what the incident records, and everything after reads that: an incident
 * declared without notifying stays quiet
 * (PublicNoteSubscriberNotificationDefault).
 *
 * People also declare incidents where no box asks: Slack's and Microsoft
 * Teams' Declare Incident forms, and OneUptime AI when someone asks it to.
 * Those follow the switch too, as the box would have started
 * (Server/Utils/StatusPage/NewIncidentSubscriberNotificationDefaultReader):
 * off, they are declared without notifying. Incidents nobody declares by
 * hand - by monitors, the API, Terraform, workflows or a public form - keep
 * their own value, which notifies unless they say otherwise.
 *
 * Shared by the dashboard, which starts the box from it, the server, which
 * declares the chat and AI incidents by it, and their tests.
 */

// The Project column that says how the box starts.
export type NewIncidentNotifyDefaultColumn =
  "notifyStatusPageSubscribersOfNewIncidentsByDefault";

export const NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN: NewIncidentNotifyDefaultColumn =
  "notifyStatusPageSubscribersOfNewIncidentsByDefault";

export interface NewIncidentNotifyDefaultSetting {
  notifyStatusPageSubscribersOfNewIncidentsByDefault?:
    | boolean
    | null
    | undefined;
}

export default class NewIncidentSubscriberNotificationDefault {
  /*
   * Only an explicit "off" starts the box unticked. A project that could not
   * be read, or that holds no value, starts it ticked, as it always started:
   * when the form cannot tell, it keeps what every project has always had.
   */
  public static isTickedByDefault(
    project: NewIncidentNotifyDefaultSetting | null | undefined,
  ): boolean {
    return project?.[NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN] !== false;
  }
}

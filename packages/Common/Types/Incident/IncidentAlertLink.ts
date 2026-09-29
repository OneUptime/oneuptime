/*
 * Shared between the dashboard and the server for linking alerts to incidents
 * (the IncidentAlert model).
 */

/*
 * Declaring an incident from alerts sends the alert ids along with the
 * incident as `miscDataProps[INCIDENT_ALERT_IDS_TO_LINK_KEY]` (an array of id
 * strings). IncidentService validates them before the incident is created and
 * links them once it exists, so API clients get the same one-request flow as
 * the dashboard.
 */
export const INCIDENT_ALERT_IDS_TO_LINK_KEY: string = "alertIdsToLink";

/*
 * Declaring an incident from alerts does not, on its own, change the alerts:
 * they keep escalating until somebody acknowledges them. Sending
 * `miscDataProps[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY] = true` along with
 * INCIDENT_ALERT_IDS_TO_LINK_KEY also acknowledges them, as the declaring
 * user, once they are linked - which is what stops their on-call escalation.
 * Alerts already acknowledged (or past it) are left as they are, and the
 * caller must be allowed to change the state of every alert that is not.
 * Off unless asked for.
 *
 * One exception: when the incident is declared straight into an
 * acknowledged or resolved state and the project's linked-alert switches
 * already move linked alerts along with it, those alerts are left to the
 * switches (one writer per alert) - acknowledged or resolved as the switch
 * does it, not credited to the declaring user.
 */
export const INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY: string =
  "acknowledgeAlertsToLink";

/*
 * The create-incident page reads the alerts to declare an incident from out of
 * this query string parameter, as a comma separated list of alert ids.
 */
export const INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM: string = "alertIds";

/*
 * The most alerts one action can link to an incident: declaring an incident
 * from alerts, or linking a selection of alerts from the alerts table. Every
 * link writes a feed entry on the incident and the alert, and the incident's
 * entry is posted to its Slack / Microsoft Teams channels, so an unbounded
 * "select all" would flood both. It also keeps the alert ids within what a URL
 * can carry.
 */
export const MAX_ALERTS_PER_INCIDENT_LINK_ACTION: number = 50;

/*
 * What linking a pair that is already linked answers with - whether the
 * duplicate is caught by the model's unique-together check or, when two
 * requests race past it, by the unique index itself. The dashboard counts a
 * link that fails with this message as done.
 */
export const INCIDENT_ALERT_ALREADY_LINKED_MESSAGE: string =
  "This alert is already linked to this incident.";

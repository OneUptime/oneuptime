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

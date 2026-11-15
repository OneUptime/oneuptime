import { StateListType } from "../../Utils/StateOrder";
import { translationKey } from "../Translator";

/*
 * THE NAMES ONEUPTIME GIVES EVERY NEW PROJECT'S STATES, SEVERITIES AND
 * STATUSES (ProjectService), one list for each kind of record. They are
 * OneUptime's words, read in the reader's language; a name the project
 * changed is its own, and reads as written in every language. Which list a
 * record's name is read against goes by its table (Utils/DefaultRecordNames).
 */

// A new project's incident states (addDefaultIncidentState).
export const DEFAULT_INCIDENT_STATE_NAMES: ReadonlyArray<string> = [
  translationKey("Identified"),
  translationKey("Acknowledged"),
  translationKey("Resolved"),
];

// Its alert states (addDefaultAlertState), named as its incident states are.
export const DEFAULT_ALERT_STATE_NAMES: ReadonlyArray<string> =
  DEFAULT_INCIDENT_STATE_NAMES;

// Its incident severities (addDefaultIncidentSeverity).
export const DEFAULT_INCIDENT_SEVERITY_NAMES: ReadonlyArray<string> = [
  translationKey("Critical Incident"),
  translationKey("Major Incident"),
  translationKey("Minor Incident"),
];

/*
 * Its alert severities (addDefaultAlertSeverity). A status page never shows
 * an alert, so they are not among the status page's names below; a
 * person's on-call page shows them (OnCallDutyPolicy/OnCallPageWords).
 */
export const DEFAULT_ALERT_SEVERITY_NAMES: ReadonlyArray<string> = [
  translationKey("High"),
  translationKey("Low"),
];

// Its monitor statuses (addDefaultMonitorStatus).
export const DEFAULT_MONITOR_STATUS_NAMES: ReadonlyArray<string> = [
  translationKey("Operational"),
  translationKey("Degraded"),
  translationKey("Offline"),
];

// Its scheduled maintenance states (addDefaultScheduledMaintenanceState).
export const DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES: ReadonlyArray<string> =
  [
    translationKey("Scheduled"),
    translationKey("Ongoing"),
    translationKey("Ended"),
    translationKey("Completed"),
  ];

/*
 * The names of its postmortem statuses (DEFAULT_POSTMORTEM_STATUSES,
 * Utils/Incident/PostmortemStatus) and of its security case statuses and
 * priorities (DEFAULT_SECURITY_CASE_STATUSES and _PRIORITIES, in
 * Utils/SecurityCase), and nothing else of them: DefaultRecordNames reads a
 * record's name against them on every form, and loading those lists'
 * colours, descriptions and rules would load them on every page that has
 * one (packages/Common/Scripts/first-load-budgets.js). Tests/Utils/
 * DefaultRecordNames holds each to its list's names. Written as those lists
 * write them, not as lookups: no message the server sends names one.
 */
export const DEFAULT_POSTMORTEM_STATUS_NAMES: ReadonlyArray<string> = [
  "Not Started",
  "Draft",
  "Completed",
  "Not Needed",
];

export const DEFAULT_SECURITY_CASE_STATUS_NAMES: ReadonlyArray<string> = [
  "New",
  "Investigating",
  "Contained",
  "Closed",
];

export const DEFAULT_SECURITY_CASE_PRIORITY_NAMES: ReadonlyArray<string> = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
];

/*
 * The lists whose records a status page names - and its notifications to
 * its subscribers: incident states, incident severities, monitor statuses
 * and scheduled maintenance states. It shows no alert.
 */
export type StatusPageNameList =
  | StateListType.IncidentState
  | StateListType.IncidentSeverity
  | StateListType.MonitorStatus
  | StateListType.ScheduledMaintenanceState;

/*
 * The default names a status page shows, of all four lists. A status page
 * shows these in its reader's language
 * (StatusPage/src/Utils/StatusTranslation), and so do its notifications to
 * its subscribers (Server/Utils/StatusPage/SubscriberMessageText).
 *
 * Whether a record's name is one of them is never decided against this
 * union: an incident state a project named "Degraded" is the project's own,
 * though Degraded is a default monitor status. It goes by the record's own
 * list (Utils/DefaultRecordNames: isDefaultRecordName, translateRecordName),
 * on the Dashboard, a status page, an on-call page and in every message
 * (#8066).
 */
export const DEFAULT_STATUS_NAMES: ReadonlyArray<string> = [
  ...DEFAULT_INCIDENT_STATE_NAMES,
  ...DEFAULT_INCIDENT_SEVERITY_NAMES,
  ...DEFAULT_MONITOR_STATUS_NAMES,
  ...DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
];

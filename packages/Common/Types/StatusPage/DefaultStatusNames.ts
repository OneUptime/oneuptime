import { translationKey, Translator } from "../Translator";

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
 * The default names a status page shows: incident states, incident
 * severities, monitor statuses and scheduled maintenance states. A status
 * page shows these in its reader's language
 * (StatusPage/src/Utils/StatusTranslation), and so do its notifications to
 * its subscribers (Server/Utils/StatusPage/SubscriberMessageText).
 */
export const DEFAULT_STATUS_NAMES: ReadonlyArray<string> = [
  ...DEFAULT_INCIDENT_STATE_NAMES,
  ...DEFAULT_INCIDENT_SEVERITY_NAMES,
  ...DEFAULT_MONITOR_STATUS_NAMES,
  ...DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
];

// Whether `name` is one of OneUptime's default names, as it gave it.
export const isDefaultStatusName: (
  name: string | null | undefined,
) => boolean = (name: string | null | undefined): boolean => {
  return typeof name === "string" && DEFAULT_STATUS_NAMES.includes(name.trim());
};

/*
 * A state's, a severity's or a status's name as `translator`'s reader reads
 * it: OneUptime's own default names in their language, any other name as
 * written.
 */
export const translateStateName: (
  translator: Translator,
  name: string | null | undefined,
) => string = (
  translator: Translator,
  name: string | null | undefined,
): string => {
  if (!name) {
    return "";
  }

  if (!isDefaultStatusName(name)) {
    return name;
  }

  const trimmed: string = name.trim();

  return translator.translateText(trimmed) || name;
};

import i18n from "./i18n";

/*
 * Maps the default English names that OneUptime seeds for every new project
 * (incident states/severities, monitor statuses, scheduled maintenance states)
 * to the translation key used to look them up in the locale JSON files.
 *
 * Project owners can rename these in the dashboard. When a name is renamed,
 * it no longer matches any key here and is shown as-is, preserving the owner's
 * chosen wording. Only names that still match a default get translated.
 */
const DEFAULT_STATUS_NAME_KEYS: Readonly<Record<string, string>> = {
  Identified: "identified",
  Acknowledged: "acknowledged",
  Resolved: "resolved",
  "Critical Incident": "criticalIncident",
  "Major Incident": "majorIncident",
  "Minor Incident": "minorIncident",
  Operational: "operational",
  Degraded: "degraded",
  Offline: "offline",
  Scheduled: "scheduled",
  Ongoing: "ongoing",
  Ended: "ended",
  Completed: "completed",
};

export const translateStatusName: (
  name: string | undefined | null,
) => string = (name: string | undefined | null): string => {
  if (!name) {
    return "";
  }

  const key: string | undefined = DEFAULT_STATUS_NAME_KEYS[name];
  if (!key) {
    return name;
  }

  return i18n.t(`statusNames.${key}`, { defaultValue: name });
};

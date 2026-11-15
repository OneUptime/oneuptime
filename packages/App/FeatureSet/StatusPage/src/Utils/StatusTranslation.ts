import i18n from "./i18n";
import { StatusPageNameList } from "Common/Types/StatusPage/DefaultStatusNames";
import { isDefaultRecordName } from "Common/Utils/DefaultRecordNames";

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

/*
 * A state's, a severity's or a status's name as the page's reader reads it.
 * Whether it is one of OneUptime's default names is decided by its own
 * list, as the Dashboard decides it (Common/Utils/DefaultRecordNames): an
 * incident state a project named "Degraded" is the project's, and reads as
 * written, while the default monitor status Degraded reads in the reader's
 * language (#8066).
 */
export const translateStatusName: (
  list: StatusPageNameList,
  name: string | undefined | null,
) => string = (
  list: StatusPageNameList,
  name: string | undefined | null,
): string => {
  if (!name) {
    return "";
  }

  if (!isDefaultRecordName(list, name)) {
    return name;
  }

  const trimmed: string = name.trim();
  const key: string | undefined = DEFAULT_STATUS_NAME_KEYS[trimmed];

  if (!key) {
    return name;
  }

  return i18n.t(`statusNames.${key}`, { defaultValue: trimmed });
};

import {
  DEFAULT_ALERT_SEVERITY_NAMES,
  DEFAULT_ALERT_STATE_NAMES,
  DEFAULT_INCIDENT_SEVERITY_NAMES,
  DEFAULT_INCIDENT_STATE_NAMES,
  DEFAULT_MONITOR_STATUS_NAMES,
  DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
} from "../Types/StatusPage/DefaultStatusNames";
import { Translator } from "../Types/Translator";
import { DEFAULT_POSTMORTEM_STATUSES } from "./Incident/PostmortemStatus";
import { DEFAULT_SECURITY_CASE_PRIORITIES } from "./SecurityCase/SecurityCasePriorities";
import { DEFAULT_SECURITY_CASE_STATUSES } from "./SecurityCase/SecurityCaseStatuses";
import { StateListType } from "./StateOrder";

/*
 * A RECORD'S NAME, AS ITS READER READS IT - ONE RULE, WHEREVER IT IS DRAWN.
 *
 * A record's name is its owner's: a label, a monitor, a probe, a template,
 * a state or a severity a project made. It is drawn as written in every
 * language - a label named "Network" is "Network" on a Spanish page, never
 * "Red" - in a badge (Pill, StatusBubble), in a picker's options and in a
 * filter's menu and chip (DropdownOption.isUserContent).
 *
 * The records a new project starts with that OneUptime names itself
 * (ProjectService) are the exception: its states, severities, monitor
 * statuses, postmortem statuses and security case priorities and statuses,
 * the lists a project orders (StateListType, whose values are the tables'
 * names). Their default names are OneUptime's words, read in the reader's
 * language - "Resolved" is "Resuelto" - for as long as a record keeps one.
 * A name the project gave a record of its own, or gave a default one in its
 * place, is the project's and reads as written: a state named "Open" stays
 * "Open", never the verb "Abrir", and a severity renamed "Critical" stays
 * "Critical", never "Kritisch".
 *
 * A name is a default by its record's table and by the whole name, as
 * written: an alert severity named "High" is OneUptime's word, a monitor
 * status named "High" the project's, and "Critical incident" is a severity
 * the project renamed. Nothing a record carries says whether OneUptime or
 * the project made it (a severity has no built-in flag, both get the same
 * kind of slug, and a badge is handed a name and a colour), so a project's
 * own record named exactly as a default of its list reads as that default
 * does - the same word the status page and the notifications use for it
 * (StatusPage/DefaultStatusNames.translateStateName).
 */

interface NamedDefault {
  name: string;
}

const namesOf: (defaults: ReadonlyArray<NamedDefault>) => Array<string> = (
  defaults: ReadonlyArray<NamedDefault>,
): Array<string> => {
  return defaults.map((value: NamedDefault): string => {
    return value.name;
  });
};

// Every list a project orders has the names it starts with.
const DEFAULT_NAMES_BY_TABLE: Readonly<
  Record<StateListType, ReadonlyArray<string>>
> = {
  [StateListType.IncidentState]: DEFAULT_INCIDENT_STATE_NAMES,
  [StateListType.AlertState]: DEFAULT_ALERT_STATE_NAMES,
  [StateListType.ScheduledMaintenanceState]:
    DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
  [StateListType.MonitorStatus]: DEFAULT_MONITOR_STATUS_NAMES,
  [StateListType.IncidentSeverity]: DEFAULT_INCIDENT_SEVERITY_NAMES,
  [StateListType.AlertSeverity]: DEFAULT_ALERT_SEVERITY_NAMES,
  [StateListType.IncidentPostmortemStatus]: namesOf(
    DEFAULT_POSTMORTEM_STATUSES,
  ),
  [StateListType.SecurityCaseStatus]: namesOf(DEFAULT_SECURITY_CASE_STATUSES),
  [StateListType.SecurityCasePriority]: namesOf(
    DEFAULT_SECURITY_CASE_PRIORITIES,
  ),
};

/*
 * The names OneUptime gives the records of a table: a StateListType, or a
 * record's own tableName. None for any other table - a label's, a
 * monitor's, a team's - whose names are all their owners'.
 */
export const getDefaultRecordNames: (
  tableName: string | null | undefined,
) => ReadonlyArray<string> = (
  tableName: string | null | undefined,
): ReadonlyArray<string> => {
  if (
    !tableName ||
    !Object.prototype.hasOwnProperty.call(DEFAULT_NAMES_BY_TABLE, tableName)
  ) {
    return [];
  }

  return DEFAULT_NAMES_BY_TABLE[tableName as StateListType];
};

// Whether `name` is one of OneUptime's default names for its table's records.
export const isDefaultRecordName: (
  tableName: string | null | undefined,
  name: string | null | undefined,
) => boolean = (
  tableName: string | null | undefined,
  name: string | null | undefined,
): boolean => {
  return (
    typeof name === "string" &&
    getDefaultRecordNames(tableName).includes(name.trim())
  );
};

/*
 * Whether a record's name is drawn as written, never looked up: a Pill's
 * or a StatusBubble's isUserContent, a DropdownOption's. True for a name its
 * owner gave; false for one of OneUptime's default names, and for no name
 * at all - a badge's "Unknown" in its place is the product's word.
 */
export const isRecordNameAsWritten: (
  tableName: string | null | undefined,
  name: string | null | undefined,
) => boolean = (
  tableName: string | null | undefined,
  name: string | null | undefined,
): boolean => {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    !isDefaultRecordName(tableName, name)
  );
};

/*
 * A record's name in `translator`'s reader's words, for where it is drawn
 * as text: a default name in their language, any other name as written.
 */
export const translateRecordName: (
  translator: Translator,
  tableName: string | null | undefined,
  name: string | null | undefined,
) => string = (
  translator: Translator,
  tableName: string | null | undefined,
  name: string | null | undefined,
): string => {
  if (!name) {
    return "";
  }

  if (!isDefaultRecordName(tableName, name)) {
    return name;
  }

  return translator.translateText(name.trim()) || name;
};

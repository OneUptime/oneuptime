import {
  DEFAULT_ALERT_SEVERITY_NAMES,
  DEFAULT_ALERT_STATE_NAMES,
  DEFAULT_INCIDENT_SEVERITY_NAMES,
  DEFAULT_INCIDENT_STATE_NAMES,
  DEFAULT_MONITOR_STATUS_NAMES,
  DEFAULT_POSTMORTEM_STATUS_NAMES,
  DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
  DEFAULT_SECURITY_CASE_PRIORITY_NAMES,
  DEFAULT_SECURITY_CASE_STATUS_NAMES,
} from "../Types/StatusPage/DefaultStatusNames";
import {
  TemplateValue,
  TermOptions,
  Translator,
  translatableTerm,
} from "../Types/Translator";
import { StateListType } from "./StateListType";

/*
 * A RECORD'S NAME, AS ITS READER READS IT - ONE RULE, WHEREVER IT IS DRAWN.
 *
 * A record's name is its owner's: a label, a monitor, a probe, a template,
 * a state or a severity a project made. It is drawn as written in every
 * language - a label named "Network" is "Network" on a Spanish page, never
 * "Red" - in a badge (Pill, StatusBubble), in a picker's options and in a
 * filter's menu and chip (DropdownOption.isUserContent), as a line of text
 * (translateRecordName) and in a sentence (recordNameInSentence).
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
 * does - the same word the status page and the notifications use for it.
 * A status page (StatusPage/src/Utils/StatusTranslation), an on-call page
 * (OnCallDutyPolicy/OnCallPageWords) and a status page's notifications
 * (Server/Utils/StatusPage/SubscriberMessageText) decide by this rule too,
 * each handed its record's list (#8066).
 */

/*
 * Every list a project orders has the names it starts with. Only names:
 * every form loads this, so it loads none of the lists' own modules
 * (StateOrder, PostmortemStatus, SecurityCaseStatuses and _Priorities).
 */
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
  [StateListType.IncidentPostmortemStatus]: DEFAULT_POSTMORTEM_STATUS_NAMES,
  [StateListType.SecurityCaseStatus]: DEFAULT_SECURITY_CASE_STATUS_NAMES,
  [StateListType.SecurityCasePriority]: DEFAULT_SECURITY_CASE_PRIORITY_NAMES,
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

/*
 * A record's name as a value of a sentence - "{{stateName}} in", "Mark as
 * {{state}}", "Incident · {{severity}}" - by the same rule. One of
 * OneUptime's default names of its table goes in as a term, translated
 * with the sentence and only then (Types/Translator): a sentence the
 * reader's language words reads "Marcar como Resuelto", one it does not
 * yet reads "Mark as Resolved" whole, and `inSentence` cases the name for
 * the middle of one ("Not yet resolved"). Any other name goes in as
 * written, never looked up: a state a project named "Open" reads "Marcar
 * como Open", never the verb "Abrir", in any language and in any case.
 */
export const recordNameInSentence: (
  tableName: string | null | undefined,
  name: string | null | undefined,
  options?: TermOptions,
) => TemplateValue = (
  tableName: string | null | undefined,
  name: string | null | undefined,
  options?: TermOptions,
): TemplateValue => {
  if (!name) {
    return "";
  }

  if (!isDefaultRecordName(tableName, name)) {
    return name;
  }

  return translatableTerm(name.trim(), options);
};

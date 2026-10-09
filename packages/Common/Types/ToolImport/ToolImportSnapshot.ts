import CustomFieldType from "../CustomField/CustomFieldType";
import DayOfWeek from "../Day/DayOfWeek";
import EventInterval from "../Events/EventInterval";
import { ToolImportNote } from "./ToolImportNote";
import ToolImportSource from "./ToolImportSource";

/*
 * WHAT ONEUPTIME READ FROM ANOTHER TOOL, IN ONEUPTIME'S WORDS.
 *
 * Every tool's adapter turns that tool's API into this one shape, and
 * everything after the read - the preview, the import, the report - works on
 * it alone, so a new tool is only a new adapter. The snapshot is stored on
 * the import run between the read and the import, so the API key is not
 * needed again once the read is done.
 *
 * Every item keeps the id the source tool gives it (`sourceId`): items name
 * each other by it (a team's members, a rotation's people, a policy's
 * schedules), and the import remembers it, so running the import again finds
 * what it brought over the first time.
 *
 * `notes` say what the adapter could not carry over exactly (a rotation that
 * takes turns with a team, a step that pages the next person on call). The
 * preview shows them next to the item before anything is created.
 */

export interface ImportedPerson {
  sourceId: string;
  name: string;
  // Lowercase. Null when the tool has none for this person.
  email: string | null;
  // False for someone the tool has deactivated (blocked, offboarded).
  isActive: boolean;
  notes: Array<ToolImportNote>;
}

export interface ImportedTeam {
  sourceId: string;
  name: string;
  description?: string | undefined;
  // People (ImportedPerson.sourceId) in the team.
  memberSourceIds: Array<string>;
  notes: Array<ToolImportNote>;
}

/*
 * A wall-clock time of day, "HH:MM" on a 24-hour clock, in the schedule's
 * time zone.
 */
export type ImportedTimeOfDay = string;

export interface ImportedWeeklyWindow {
  startDay: DayOfWeek;
  startTime: ImportedTimeOfDay;
  endDay: DayOfWeek;
  endTime: ImportedTimeOfDay;
}

/*
 * When a rotation's turns are on call. Daily: the same hours every day (an
 * end before the start runs overnight). Weekly: one or more windows across
 * the week. No restriction (null on the rotation): around the clock.
 */
export type ImportedRestriction =
  | {
      type: "Daily";
      startTime: ImportedTimeOfDay;
      endTime: ImportedTimeOfDay;
    }
  | {
      type: "Weekly";
      windows: Array<ImportedWeeklyWindow>;
    };

/*
 * One line of people taking turns: an Opsgenie rotation, one layer of an
 * incident.io rotation, a PagerDuty schedule layer, a Splunk On-Call shift
 * or a Grafana OnCall rotation. A OneUptime schedule layer is made from
 * each.
 */
export interface ImportedRotation {
  // Unique within its schedule.
  key: string;
  name: string;
  // When the first person's first turn starts (ISO 8601).
  startsAt: string;
  // How long each turn lasts.
  intervalType: EventInterval;
  intervalCount: number;
  restriction: ImportedRestriction | null;
  // People (ImportedPerson.sourceId) in the order they take turns.
  participantSourceIds: Array<string>;
  /*
   * For a tool whose layers override one another - a PagerDuty schedule's
   * layers, Grafana OnCall's layer priorities - how this rotation ranks: where
   * a rotation of a higher precedence has someone on call, nobody of a lower
   * one is. Rotations of the same precedence are on call at the same time,
   * as every rotation of a schedule is in Opsgenie, incident.io and Splunk
   * On-Call, which leave it out (0).
   */
  precedence?: number | undefined;
  notes: Array<ToolImportNote>;
}

export interface ImportedSchedule {
  sourceId: string;
  name: string;
  description?: string | undefined;
  // The time zone the tool keeps the schedule in, as the tool names it.
  timezone: string;
  // False for a schedule the tool has turned off.
  isEnabled: boolean;
  ownerTeamSourceIds: Array<string>;
  rotations: Array<ImportedRotation>;
  notes: Array<ToolImportNote>;
}

/*
 * One level of an escalation policy: who is paged together, and how long
 * OneUptime waits for someone to acknowledge before paging the next level.
 */
export interface ImportedPolicyLevel {
  escalateAfterMinutes: number;
  personSourceIds: Array<string>;
  teamSourceIds: Array<string>;
  scheduleSourceIds: Array<string>;
}

export interface ImportedPolicy {
  sourceId: string;
  name: string;
  description?: string | undefined;
  ownerTeamSourceIds: Array<string>;
  levels: Array<ImportedPolicyLevel>;
  // How many more times the whole policy runs when nobody acknowledges.
  repeatTimes: number;
  /*
   * Set when the tool builds the policy from something its API does not
   * return (an incident.io escalation path made from a template): there is
   * nothing to bring over.
   */
  isUnreadable?: boolean | undefined;
  notes: Array<ToolImportNote>;
}

export interface ImportedService {
  sourceId: string;
  name: string;
  description?: string | undefined;
  ownerTeamSourceIds: Array<string>;
  // False for a service the tool has turned off: it starts unticked.
  isEnabled?: boolean | undefined;
  notes: Array<ToolImportNote>;
}

export interface ImportedIncidentSeverity {
  sourceId: string;
  name: string;
  description?: string | undefined;
  // 1 is the most severe.
  order: number;
  notes: Array<ToolImportNote>;
}

/*
 * What a status of the tool means for OneUptime's incident states, which
 * always start in a created state and end in a resolved one: a status that
 * is the start or the end is matched to OneUptime's own, one in between is
 * created between them, and one OneUptime has no use for is left out.
 */
export enum ImportedIncidentStateKind {
  Created = "Created",
  InProgress = "InProgress",
  Resolved = "Resolved",
  NotNeeded = "NotNeeded",
}

export interface ImportedIncidentState {
  sourceId: string;
  name: string;
  description?: string | undefined;
  kind: ImportedIncidentStateKind;
  // The tool's own word for the kind of status ("live", "closed").
  sourceCategory: string;
  // Order among the tool's statuses, first first.
  order: number;
  notes: Array<ToolImportNote>;
}

export enum ImportedIncidentRoleKind {
  // The role that leads an incident: OneUptime's primary role.
  Lead = "Lead",
  // Whoever declared the incident: OneUptime records that itself.
  Reporter = "Reporter",
  Custom = "Custom",
}

export interface ImportedIncidentRole {
  sourceId: string;
  name: string;
  description?: string | undefined;
  kind: ImportedIncidentRoleKind;
  notes: Array<ToolImportNote>;
}

export interface ImportedIncidentCustomField {
  sourceId: string;
  name: string;
  description?: string | undefined;
  // Null for a field OneUptime has no type for.
  fieldType: CustomFieldType | null;
  // The choices of a dropdown, in order.
  options: Array<string>;
  // A field whose choices are records of another kind in the tool.
  isFromCatalog: boolean;
  notes: Array<ToolImportNote>;
}

export interface ToolImportSnapshot {
  source: ToolImportSource;
  // When the read finished (ISO 8601).
  readAt: string;
  // The account the key belongs to, as the tool names it, when it says.
  accountName?: string | undefined;
  people: Array<ImportedPerson>;
  teams: Array<ImportedTeam>;
  schedules: Array<ImportedSchedule>;
  policies: Array<ImportedPolicy>;
  services: Array<ImportedService>;
  incidentSeverities: Array<ImportedIncidentSeverity>;
  incidentStates: Array<ImportedIncidentState>;
  incidentRoles: Array<ImportedIncidentRole>;
  incidentCustomFields: Array<ImportedIncidentCustomField>;
  // About the read as a whole: what could not be read, and why.
  notes: Array<ToolImportNote>;
}

export function getEmptyToolImportSnapshot(
  source: ToolImportSource,
): ToolImportSnapshot {
  return {
    source: source,
    readAt: new Date().toISOString(),
    people: [],
    teams: [],
    schedules: [],
    policies: [],
    services: [],
    incidentSeverities: [],
    incidentStates: [],
    incidentRoles: [],
    incidentCustomFields: [],
    notes: [],
  };
}

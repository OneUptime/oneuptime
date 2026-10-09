import HTTPMethod from "../API/HTTPMethod";
import CustomFieldType from "../CustomField/CustomFieldType";
import DayOfWeek from "../Day/DayOfWeek";
import Dictionary from "../Dictionary";
import EventInterval from "../Events/EventInterval";
import DnsRecordType from "../Monitor/DnsMonitor/DnsRecordType";
import MonitorType from "../Monitor/MonitorType";
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

/*
 * The status codes a check counts as up, both ends included: "2xx" is
 * { from: 200, to: 299 }.
 */
export interface ImportedStatusCodeRange {
  from: number;
  to: number;
}

// A word a page must (or must not) contain for the check to count as up.
export interface ImportedKeyword {
  value: string;
  // True: up while the answer contains it. False: up while it does not.
  isPresent: boolean;
  isCaseSensitive: boolean;
}

/*
 * One check of an uptime tool, and what OneUptime makes of it: the monitor
 * type that checks the same thing, with the same address, pace and rules
 * for "up". A check OneUptime has no monitor for has no monitorType, and a
 * note says what it was - the preview names it rather than drop it
 * silently.
 */
export interface ImportedMonitor {
  sourceId: string;
  name: string;
  description?: string | undefined;
  // The tool's own name for its kind of check ("keyword", "httpcustom").
  sourceType: string;
  monitorType: MonitorType | null;
  /*
   * What it checks: a URL (Website, API, SSL Certificate), a host name or
   * IP address (Ping, Port), or the name to look up (DNS). None for a
   * heartbeat or a manual monitor.
   */
  destination?: string | undefined;
  port?: number | undefined;
  httpMethod?: HTTPMethod | undefined;
  // Headers sent with each request; ones that may hold a secret are left out.
  requestHeaders?: Dictionary<string> | undefined;
  // A JSON object, the only body OneUptime's API monitors send.
  requestBody?: string | undefined;
  followRedirects?: boolean | undefined;
  // How long one check may take.
  timeoutSeconds?: number | undefined;
  // How often the tool checks it.
  intervalSeconds?: number | undefined;
  // What counts as up; none for the usual every 2xx and 3xx.
  acceptedStatusCodes?: Array<ImportedStatusCodeRange> | undefined;
  keyword?: ImportedKeyword | undefined;
  // SSL Certificate: how long before it expires the tool warns.
  certificateExpiryWarningDays?: number | undefined;
  // Heartbeats: down once no ping has arrived for this long.
  heartbeatTimeoutSeconds?: number | undefined;
  // DNS: the record to look up, and the server to ask (none: the default).
  dnsRecordType?: DnsRecordType | undefined;
  dnsServer?: string | undefined;
  // Paused in the tool: it starts unticked, and comes over paused.
  isPaused: boolean;
  /*
   * Why it cannot come over, when the adapter knows a more exact reason
   * than "OneUptime has no such monitor" (a check that is up when it
   * fails, say).
   */
  skipReason?: ToolImportNote | undefined;
  notes: Array<ToolImportNote>;
}

export interface ImportedStatusPageGroup {
  // Unique within its status page.
  key: string;
  name: string;
  description?: string | undefined;
}

// A monitor shown on a status page.
export interface ImportedStatusPageResource {
  // Unique within its status page.
  key: string;
  // The monitor it shows (ImportedMonitor.sourceId).
  monitorSourceId: string;
  // The group it is shown in (ImportedStatusPageGroup.key), or none.
  groupKey?: string | undefined;
  displayName: string;
  displayDescription?: string | undefined;
  showUptimePercent: boolean;
  showStatusHistoryChart: boolean;
}

export interface ImportedStatusPage {
  sourceId: string;
  name: string;
  // For the team: what the page is for.
  description?: string | undefined;
  // For visitors: the page's title and what it says under it.
  pageTitle?: string | undefined;
  pageDescription?: string | undefined;
  // False for a page only some people may see (a password, a team, an IP).
  isPublic: boolean;
  // How many days of history the page shows.
  historyDays?: number | undefined;
  allowsEmailSubscribers?: boolean | undefined;
  // Whether visitors choose the parts of the page they follow.
  allowsSubscribersToChooseResources?: boolean | undefined;
  isHiddenFromSearchEngines?: boolean | undefined;
  groups: Array<ImportedStatusPageGroup>;
  // In the order the page shows them.
  resources: Array<ImportedStatusPageResource>;
  notes: Array<ToolImportNote>;
}

// Someone who gets a status page's updates by email.
export interface ImportedStatusPageSubscriber {
  sourceId: string;
  // Lowercase.
  email: string;
  statusPageSourceId: string;
  /*
   * The parts of the page they follow (ImportedStatusPageResource.key).
   * Empty: all of it.
   */
  resourceKeys: Array<string>;
  // Why they cannot come over (they never confirmed), when the tool says.
  skipReason?: ToolImportNote | undefined;
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
  /*
   * What uptime and status page tools bring. Optional: a snapshot stored
   * before they existed has none, and reads as having none
   * (getToolImportSnapshotMonitors and the two after it).
   */
  monitors?: Array<ImportedMonitor> | undefined;
  statusPages?: Array<ImportedStatusPage> | undefined;
  statusPageSubscribers?: Array<ImportedStatusPageSubscriber> | undefined;
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
    monitors: [],
    statusPages: [],
    statusPageSubscribers: [],
    notes: [],
  };
}

export function getToolImportSnapshotMonitors(
  snapshot: ToolImportSnapshot,
): Array<ImportedMonitor> {
  return Array.isArray(snapshot.monitors) ? snapshot.monitors : [];
}

export function getToolImportSnapshotStatusPages(
  snapshot: ToolImportSnapshot,
): Array<ImportedStatusPage> {
  return Array.isArray(snapshot.statusPages) ? snapshot.statusPages : [];
}

export function getToolImportSnapshotSubscribers(
  snapshot: ToolImportSnapshot,
): Array<ImportedStatusPageSubscriber> {
  return Array.isArray(snapshot.statusPageSubscribers)
    ? snapshot.statusPageSubscribers
    : [];
}

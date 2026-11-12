/*
 * "USED BY": WHAT REFERS TO A RECORD (#6813).
 *
 * OneUptime's records point at each other - a status page lists monitors,
 * an escalation rule names a schedule, an SLO measures a monitor - and
 * each record shows what it points to. This is the other direction: given
 * a record, the records that point at it, so "which status pages show
 * this monitor?", "does any policy use this schedule?" and "can I delete
 * this?" are answered on the record's own page instead of by opening
 * every status page, policy and SLO in turn.
 *
 * One step only: a monitor shows the status pages that list it, not the
 * subscribers of those pages. Two exceptions, each because it is what a
 * person means by the question: a status page that shows the monitor
 * through one of its monitor groups shows the monitor, and a service's
 * SLOs are the SLOs that measure the monitors watching it (no SLO names a
 * service).
 *
 * The server (Server/Services/UsedByService) keeps, in one place, how each
 * relation is read, and reads every one through the models' own services
 * with the reader's permissions: a reader is shown only the records they
 * may read, and told how many more there are that they may not, without
 * their names. Counts come first, a few rows with them, and the rest of a
 * relation's rows on request, a page at a time - so a record used by
 * thousands of others still loads in a handful of bounded reads.
 *
 * Pure, with no server or browser APIs: the Dashboard and the server read
 * the same kinds, relations and shapes.
 */

// The records that answer "what uses this?" on their own page.
export enum UsedByRecordKind {
  Monitor = "monitor",
  OnCallSchedule = "on-call-schedule",
  Service = "service",
  StatusPage = "status-page",
  Team = "team",
  Label = "label",
}

// What one row of a relation is: what the Dashboard opens when it is clicked.
export enum UsedByRowKind {
  Monitor = "Monitor",
  MonitorGroup = "MonitorGroup",
  StatusPage = "StatusPage",
  ServiceLevelObjective = "ServiceLevelObjective",
  ScheduledMaintenance = "ScheduledMaintenance",
  Workflow = "Workflow",
  Dashboard = "Dashboard",
  OnCallDutyPolicy = "OnCallDutyPolicy",
  OnCallSchedule = "OnCallSchedule",
  Service = "Service",
  Incident = "Incident",
  Alert = "Alert",
}

// One way records refer to a record of a kind.
export enum UsedByRelation {
  // Status pages that list the monitor, directly or through a monitor group.
  MonitorStatusPages = "MonitorStatusPages",
  // Monitor groups the monitor is in.
  MonitorGroups = "MonitorGroups",
  // SLOs that measure the monitor (archived ones left out).
  MonitorSlos = "MonitorSlos",
  // Scheduled maintenance coming up or in progress that names the monitor.
  MonitorScheduledMaintenance = "MonitorScheduledMaintenance",
  // Monitors that depend on it: their alerts wait while it is down.
  MonitorDependents = "MonitorDependents",
  // Workflows whose steps name the monitor.
  MonitorWorkflows = "MonitorWorkflows",
  // Dashboards whose widgets name the monitor.
  MonitorDashboards = "MonitorDashboards",

  // On-call policies with an escalation rule that pages the schedule.
  ScheduleOnCallPolicies = "ScheduleOnCallPolicies",

  // Monitors that watch the service (its Linked Resources).
  ServiceMonitors = "ServiceMonitors",
  // SLOs that measure a monitor watching the service.
  ServiceSlos = "ServiceSlos",

  // Open incidents the status page shows right now.
  StatusPageOpenIncidents = "StatusPageOpenIncidents",
  // Scheduled maintenance in progress or coming up that the page shows.
  StatusPageMaintenance = "StatusPageMaintenance",

  // On-call policies with an escalation rule that pages the team.
  TeamOnCallPolicies = "TeamOnCallPolicies",
  // What the team owns.
  TeamOwnedMonitors = "TeamOwnedMonitors",
  TeamOwnedStatusPages = "TeamOwnedStatusPages",
  TeamOwnedServices = "TeamOwnedServices",
  TeamOwnedOnCallPolicies = "TeamOwnedOnCallPolicies",
  TeamOwnedSchedules = "TeamOwnedSchedules",

  // The records of each kind that carry the label.
  LabelMonitors = "LabelMonitors",
  LabelMonitorGroups = "LabelMonitorGroups",
  LabelStatusPages = "LabelStatusPages",
  LabelServices = "LabelServices",
  LabelIncidents = "LabelIncidents",
  LabelAlerts = "LabelAlerts",
  LabelScheduledMaintenance = "LabelScheduledMaintenance",
  LabelOnCallPolicies = "LabelOnCallPolicies",
  LabelOnCallSchedules = "LabelOnCallSchedules",
  LabelSlos = "LabelSlos",
  LabelWorkflows = "LabelWorkflows",
  LabelDashboards = "LabelDashboards",
}

export interface UsedByRelationDescription {
  relation: UsedByRelation;
  rowKind: UsedByRowKind;
}

/*
 * Each record's relations, in the order its card lists them: what most
 * people ask about first. Adding a relation is a line here, its reading in
 * UsedByService's definitions, and its words in the Dashboard's
 * UsedByWords - each of the three tested to hold every relation.
 */
export const USED_BY_RELATIONS: Readonly<
  Record<UsedByRecordKind, ReadonlyArray<UsedByRelationDescription>>
> = {
  [UsedByRecordKind.Monitor]: [
    {
      relation: UsedByRelation.MonitorStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.MonitorGroups,
      rowKind: UsedByRowKind.MonitorGroup,
    },
    {
      relation: UsedByRelation.MonitorSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
    {
      relation: UsedByRelation.MonitorScheduledMaintenance,
      rowKind: UsedByRowKind.ScheduledMaintenance,
    },
    {
      relation: UsedByRelation.MonitorDependents,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.MonitorWorkflows,
      rowKind: UsedByRowKind.Workflow,
    },
    {
      relation: UsedByRelation.MonitorDashboards,
      rowKind: UsedByRowKind.Dashboard,
    },
  ],
  [UsedByRecordKind.OnCallSchedule]: [
    {
      relation: UsedByRelation.ScheduleOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
  ],
  [UsedByRecordKind.Service]: [
    {
      relation: UsedByRelation.ServiceMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.ServiceSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
  ],
  [UsedByRecordKind.StatusPage]: [
    {
      relation: UsedByRelation.StatusPageOpenIncidents,
      rowKind: UsedByRowKind.Incident,
    },
    {
      relation: UsedByRelation.StatusPageMaintenance,
      rowKind: UsedByRowKind.ScheduledMaintenance,
    },
  ],
  [UsedByRecordKind.Team]: [
    {
      relation: UsedByRelation.TeamOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
    {
      relation: UsedByRelation.TeamOwnedMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.TeamOwnedStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.TeamOwnedServices,
      rowKind: UsedByRowKind.Service,
    },
    {
      relation: UsedByRelation.TeamOwnedOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
    {
      relation: UsedByRelation.TeamOwnedSchedules,
      rowKind: UsedByRowKind.OnCallSchedule,
    },
  ],
  [UsedByRecordKind.Label]: [
    {
      relation: UsedByRelation.LabelMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.LabelMonitorGroups,
      rowKind: UsedByRowKind.MonitorGroup,
    },
    {
      relation: UsedByRelation.LabelStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.LabelServices,
      rowKind: UsedByRowKind.Service,
    },
    {
      relation: UsedByRelation.LabelIncidents,
      rowKind: UsedByRowKind.Incident,
    },
    {
      relation: UsedByRelation.LabelAlerts,
      rowKind: UsedByRowKind.Alert,
    },
    {
      relation: UsedByRelation.LabelScheduledMaintenance,
      rowKind: UsedByRowKind.ScheduledMaintenance,
    },
    {
      relation: UsedByRelation.LabelOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
    {
      relation: UsedByRelation.LabelOnCallSchedules,
      rowKind: UsedByRowKind.OnCallSchedule,
    },
    {
      relation: UsedByRelation.LabelSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
    {
      relation: UsedByRelation.LabelWorkflows,
      rowKind: UsedByRowKind.Workflow,
    },
    {
      relation: UsedByRelation.LabelDashboards,
      rowKind: UsedByRowKind.Dashboard,
    },
  ],
};

// The rows a card shows of each relation, beside its count.
export const USED_BY_PREVIEW_ROW_COUNT: number = 3;

// The rows one page of "See all" reads.
export const USED_BY_PAGE_SIZE: number = 50;

// The most rows one page may ask for.
export const USED_BY_MAX_PAGE_SIZE: number = 100;

// One record that refers to the record asked about.
export interface UsedByRow {
  id: string;
  // Its name, as its own page shows it ("" when it has none).
  name: string;
  // Its number with its prefix, for a numbered record ("INC-18").
  number?: string | undefined;
  /*
   * More about how it refers, in the project's own words: the escalation
   * rules of a policy that page the schedule or team.
   */
  detail?: string | undefined;
}

// The records that refer to the record one way.
export interface UsedByGroup {
  relation: UsedByRelation;
  rowKind: UsedByRowKind;
  // How many of them the reader may read.
  count: number;
  /*
   * How many more there are that the reader may not read: counted, never
   * named. 0 when the reader may read them all.
   */
  hiddenCount: number;
  // The first of those the reader may read, in name order.
  rows: Array<UsedByRow>;
}

// What refers to one record, every relation of its kind.
export interface UsedBySummary {
  recordKind: UsedByRecordKind;
  recordId: string;
  groups: Array<UsedByGroup>;
}

/*
 * One page of one relation's rows. Where it starts and how long it is are
 * pageStart and pageSize, never skip and limit: HTTPResponse reads an
 * answer holding count, skip and limit as a list of models in `data`, and
 * a page that held all three failed to read in the browser ("array is not
 * iterable").
 */
export interface UsedByPage {
  recordKind: UsedByRecordKind;
  recordId: string;
  relation: UsedByRelation;
  rowKind: UsedByRowKind;
  count: number;
  hiddenCount: number;
  pageStart: number;
  pageSize: number;
  rows: Array<UsedByRow>;
}

export function isUsedByRecordKind(value: unknown): value is UsedByRecordKind {
  return Object.values(UsedByRecordKind).includes(value as UsedByRecordKind);
}

export function isUsedByRelation(value: unknown): value is UsedByRelation {
  return Object.values(UsedByRelation).includes(value as UsedByRelation);
}

// The relations of a kind, in its card's order.
export function getUsedByRelations(
  recordKind: UsedByRecordKind,
): ReadonlyArray<UsedByRelationDescription> {
  return USED_BY_RELATIONS[recordKind] || [];
}

// The kind a relation belongs to, or null for one no kind lists.
export function getUsedByRecordKindOfRelation(
  relation: UsedByRelation,
): UsedByRecordKind | null {
  for (const recordKind of Object.values(UsedByRecordKind)) {
    if (
      getUsedByRelations(recordKind).some(
        (description: UsedByRelationDescription): boolean => {
          return description.relation === relation;
        },
      )
    ) {
      return recordKind;
    }
  }

  return null;
}

// What a relation's rows are, or null for one no kind lists.
export function getUsedByRowKind(
  relation: UsedByRelation,
): UsedByRowKind | null {
  for (const recordKind of Object.values(UsedByRecordKind)) {
    for (const description of getUsedByRelations(recordKind)) {
      if (description.relation === relation) {
        return description.rowKind;
      }
    }
  }

  return null;
}

// Every record that refers to it, seen or not.
export function getUsedByGroupTotal(
  group: Pick<UsedByGroup, "count" | "hiddenCount">,
): number {
  return group.count + group.hiddenCount;
}

/*
 * The groups with anything in them - seen or hidden - in the kind's order:
 * what a card and a delete dialog list. `leaveOut` drops relations a page
 * says otherwise (a monitor's Delete page has the SLOs' own warning).
 */
export function getUsedByGroupsInUse(
  summary: Pick<UsedBySummary, "groups">,
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined,
): Array<UsedByGroup> {
  return summary.groups.filter((group: UsedByGroup): boolean => {
    return (
      getUsedByGroupTotal(group) > 0 &&
      !(leaveOut || []).includes(group.relation)
    );
  });
}

// Whether nothing refers to the record, among what the summary read.
export function isUsedByNothing(
  summary: Pick<UsedBySummary, "groups">,
): boolean {
  return getUsedByGroupsInUse(summary).length === 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isUsedByRow(value: unknown): value is UsedByRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const row: Partial<UsedByRow> = value as Partial<UsedByRow>;

  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    (row.number === undefined || typeof row.number === "string") &&
    (row.detail === undefined || typeof row.detail === "string")
  );
}

function isUsedByRows(value: unknown): value is Array<UsedByRow> {
  return Array.isArray(value) && value.every(isUsedByRow);
}

function isUsedByGroup(value: unknown): value is UsedByGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const group: Partial<UsedByGroup> = value as Partial<UsedByGroup>;

  return (
    isUsedByRelation(group.relation) &&
    Object.values(UsedByRowKind).includes(group.rowKind as UsedByRowKind) &&
    isNonNegativeInteger(group.count) &&
    isNonNegativeInteger(group.hiddenCount) &&
    isUsedByRows(group.rows)
  );
}

/*
 * Whether an answer has the shape the Dashboard reads: a server that
 * answers something else (an older one, a proxy's page) is an error to
 * show, never a list to draw.
 */
export function isUsedBySummary(value: unknown): value is UsedBySummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const summary: Partial<UsedBySummary> = value as Partial<UsedBySummary>;

  return (
    isUsedByRecordKind(summary.recordKind) &&
    typeof summary.recordId === "string" &&
    Array.isArray(summary.groups) &&
    summary.groups.every(isUsedByGroup)
  );
}

export function isUsedByPage(value: unknown): value is UsedByPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const page: Partial<UsedByPage> = value as Partial<UsedByPage>;

  return (
    isUsedByRecordKind(page.recordKind) &&
    typeof page.recordId === "string" &&
    isUsedByRelation(page.relation) &&
    Object.values(UsedByRowKind).includes(page.rowKind as UsedByRowKind) &&
    isNonNegativeInteger(page.count) &&
    isNonNegativeInteger(page.hiddenCount) &&
    isNonNegativeInteger(page.pageStart) &&
    isNonNegativeInteger(page.pageSize) &&
    isUsedByRows(page.rows)
  );
}

// A page size a request may ask for: the default, or at most the maximum.
export function normalizeUsedByPageSize(value: unknown): number {
  const parsed: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return USED_BY_PAGE_SIZE;
  }

  return Math.min(Math.floor(parsed), USED_BY_MAX_PAGE_SIZE);
}

// Where a page starts: 0, or a whole number of rows past it.
export function normalizeUsedBySkip(value: unknown): number {
  const parsed: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

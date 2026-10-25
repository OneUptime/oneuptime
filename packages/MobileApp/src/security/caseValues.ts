/*
 * WHAT A SECURITY CASE'S STATUS AND PRIORITY MEAN - the rules the server, the
 * dashboard and every message about a case read
 * (Common/Utils/SecurityCase/SecurityCaseStatuses and SecurityCasePriorities),
 * kept here because the app is built without Common's runtime code.
 *
 * A project's case statuses and priorities are its own: renamed, recoloured,
 * reordered, with statuses and priorities of the project's own among the
 * built-in ones. So nothing here reads a name. A status counts as New,
 * Acknowledged, Contained or Closed by where it sits in the project's list:
 * from the built-in acknowledged status down it is acknowledged, from the
 * built-in closed status down it is closed (Common/Types/SecurityCase/
 * SecurityCaseStage). A priority's rank is its place in the list, the most
 * urgent first.
 *
 * Common's test suite runs this file next to Common's rules over the cases
 * both suites share and over generated lists (SecurityCaseMobileParity), so
 * the two cannot drift: the order breaks ties the way the server does (the
 * older first, then by id), ids match whatever their case, and a place
 * written as text counts.
 */

export type SecurityCaseStage = "New" | "Acknowledged" | "Contained" | "Closed";

// In the order a case comes through them.
export const SECURITY_CASE_STAGES: ReadonlyArray<SecurityCaseStage> = [
  "New",
  "Acknowledged",
  "Contained",
  "Closed",
];

export interface CaseValueRuleRow {
  _id: string;
  order?: number | string | null | undefined;
  createdAt?: string | null | undefined;
  isArchived?: boolean | null | undefined;
}

export interface CaseStatusRuleRow extends CaseValueRuleRow {
  isNewStatus?: boolean | null | undefined;
  isAcknowledgedStatus?: boolean | null | undefined;
  isContainedStatus?: boolean | null | undefined;
  isClosedStatus?: boolean | null | undefined;
}

export interface CasePriorityRuleRow extends CaseValueRuleRow {
  isCriticalPriority?: boolean | null | undefined;
  isHighPriority?: boolean | null | undefined;
  isMediumPriority?: boolean | null | undefined;
  isLowPriority?: boolean | null | undefined;
  isInformationalPriority?: boolean | null | undefined;
}

export type CaseValueList<T> = ReadonlyArray<T> | null | undefined;

// The flag that marks the built-in status of each stage, in the list's order.
export const STATUS_STAGE_FLAGS: ReadonlyArray<{
  stage: SecurityCaseStage;
  flag: keyof CaseStatusRuleRow;
}> = [
  { stage: "New", flag: "isNewStatus" },
  { stage: "Acknowledged", flag: "isAcknowledgedStatus" },
  { stage: "Contained", flag: "isContainedStatus" },
  { stage: "Closed", flag: "isClosedStatus" },
];

// The built-in priorities' flags, most urgent first.
export const PRIORITY_LEVEL_FLAGS: ReadonlyArray<keyof CasePriorityRuleRow> = [
  "isCriticalPriority",
  "isHighPriority",
  "isMediumPriority",
  "isLowPriority",
  "isInformationalPriority",
];

/*
 * A row's place in the list: 1 is the top. Null when it has none. A number
 * written as text counts, as it does on the server.
 */
export function getCaseValueOrder(row: CaseValueRuleRow): number | null {
  if (typeof row.order === "number") {
    return Number.isFinite(row.order) ? row.order : null;
  }

  if (typeof row.order === "string" && row.order.trim().length > 0) {
    const parsed: number = Number(row.order);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// An id as the rules compare it: whatever its case.
export function toCaseValueIdKey(id: unknown): string {
  return typeof id === "string" ? id.toLowerCase() : "";
}

function toTime(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

/*
 * Which of two rows sits nearer the top, as the server sorts them: by place,
 * a row without one after every row with one, then the older first, then by
 * id so that two sorts can never disagree.
 */
function compareCaseValues(a: CaseValueRuleRow, b: CaseValueRuleRow): number {
  const aOrder: number | null = getCaseValueOrder(a);
  const bOrder: number | null = getCaseValueOrder(b);

  if (aOrder !== null && bOrder === null) {
    return -1;
  }

  if (aOrder === null && bOrder !== null) {
    return 1;
  }

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  const aTime: number | null = toTime(a.createdAt);
  const bTime: number | null = toTime(b.createdAt);

  if (aTime !== null && bTime === null) {
    return -1;
  }

  if (aTime === null && bTime !== null) {
    return 1;
  }

  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }

  if (a._id === b._id) {
    return 0;
  }

  return a._id < b._id ? -1 : 1;
}

// The rows top first: the order a case comes through the statuses, the most urgent priority first.
export function sortCaseValues<T extends CaseValueRuleRow>(
  values: CaseValueList<T>,
): Array<T> {
  return [...(values || [])].sort(compareCaseValues);
}

// The row an id names, matched whatever its case. Undefined for none of the project's.
export function findCaseValue<T extends CaseValueRuleRow>(
  values: CaseValueList<T>,
  id: string | null | undefined,
): T | undefined {
  const key: string = toCaseValueIdKey(id);

  if (!key) {
    return undefined;
  }

  return (values || []).find((candidate: T): boolean => {
    return toCaseValueIdKey(candidate._id) === key;
  });
}

// Whether nobody may pick the value again: cases that have it keep it.
export function isArchivedCaseValue(value: CaseValueRuleRow): boolean {
  return value.isArchived === true;
}

/*
 * The row that stands for each built-in, by flag: the first from the top that
 * carries it - "the" closed status of a project is the first one in its order.
 */
function getBuiltInRows<T extends CaseValueRuleRow>(
  values: CaseValueList<T>,
  flags: ReadonlyArray<string>,
): Map<string, T> {
  const builtIns: Map<string, T> = new Map();

  for (const value of sortCaseValues(values)) {
    for (const flag of flags) {
      if (
        (value as unknown as Record<string, unknown>)[flag] === true &&
        !builtIns.has(flag)
      ) {
        builtIns.set(flag, value);
      }
    }
  }

  return builtIns;
}

const STATUS_FLAGS: ReadonlyArray<string> = STATUS_STAGE_FLAGS.map(
  (entry: { flag: keyof CaseStatusRuleRow }): string => {
    return entry.flag;
  },
);

function getStageOfFlag(flag: string | undefined): SecurityCaseStage | null {
  const entry: { stage: SecurityCaseStage } | undefined =
    STATUS_STAGE_FLAGS.find((candidate: { flag: string }): boolean => {
      return candidate.flag === flag;
    });

  return entry ? entry.stage : null;
}

/*
 * The built-in status of a stage: where OneUptime moves a case by itself -
 * Close Case to the closed status, Reopen to the acknowledged one.
 * Undefined when the project has none.
 */
export function getCaseStatusOfStage<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
  stage: SecurityCaseStage,
): T | undefined {
  const flag: string | undefined = STATUS_STAGE_FLAGS.find(
    (entry: { stage: SecurityCaseStage }): boolean => {
      return entry.stage === stage;
    },
  )?.flag;

  return flag ? getBuiltInRows(statuses, STATUS_FLAGS).get(flag) : undefined;
}

/*
 * What a case in this status counts as, by where the status sits: the stage
 * of the last built-in status at or above it. A status with no place counts
 * as what its own flag says, else New. Null for a status that is none of the
 * project's.
 */
export function getCaseStatusStage<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
  statusId: string | null | undefined,
): SecurityCaseStage | null {
  const status: T | undefined = findCaseValue(statuses, statusId);

  if (!status) {
    return null;
  }

  const ownFlag: string | undefined = STATUS_FLAGS.find(
    (flag: string): boolean => {
      return (status as unknown as Record<string, unknown>)[flag] === true;
    },
  );
  const order: number | null = getCaseValueOrder(status);

  if (order === null) {
    return getStageOfFlag(ownFlag) || "New";
  }

  const builtIns: Map<string, T> = getBuiltInRows(statuses, STATUS_FLAGS);

  for (let index: number = STATUS_FLAGS.length - 1; index >= 0; index--) {
    const flag: string = STATUS_FLAGS[index]!;
    const builtIn: T | undefined = builtIns.get(flag);
    const builtInOrder: number | null = builtIn
      ? getCaseValueOrder(builtIn)
      : null;

    if (builtInOrder !== null && order >= builtInOrder) {
      return getStageOfFlag(flag) || "New";
    }
  }

  return getStageOfFlag(ownFlag) || "New";
}

// Whether a case in this status is closed. False for a status that is none of the project's.
export function isCaseStatusClosed<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
  statusId: string | null | undefined,
): boolean {
  return getCaseStatusStage(statuses, statusId) === "Closed";
}

// Whether a case in this status still needs somebody. False for a status that is none of the project's.
export function isCaseStatusOpen<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
  statusId: string | null | undefined,
): boolean {
  const stage: SecurityCaseStage | null = getCaseStatusStage(
    statuses,
    statusId,
  );

  return stage !== null && stage !== "Closed";
}

// Whether a case in this status has come at least as far as this stage.
export function hasCaseStatusReached<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
  statusId: string | null | undefined,
  stage: SecurityCaseStage,
): boolean {
  const reached: SecurityCaseStage | null = getCaseStatusStage(
    statuses,
    statusId,
  );

  return (
    reached !== null &&
    SECURITY_CASE_STAGES.indexOf(reached) >= SECURITY_CASE_STAGES.indexOf(stage)
  );
}

// The ids of the statuses a case is still open in, top first: what the open lists ask for.
export function getOpenCaseStatusIds<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
): Array<string> {
  return sortCaseValues(statuses)
    .filter((status: T): boolean => {
      return isCaseStatusOpen(statuses, status._id);
    })
    .map((status: T): string => {
      return status._id;
    });
}

// The ids of the statuses that close a case, top first.
export function getClosedCaseStatusIds<T extends CaseStatusRuleRow>(
  statuses: CaseValueList<T>,
): Array<string> {
  return sortCaseValues(statuses)
    .filter((status: T): boolean => {
      return isCaseStatusClosed(statuses, status._id);
    })
    .map((status: T): string => {
      return status._id;
    });
}

/*
 * Whether moving a case from one status to another closes it, and so asks
 * what the case turned out to be: an open case going to a status that closes
 * cases. A closed case moving between two closing statuses keeps its verdict.
 */
export function doesStatusCloseCase<T extends CaseStatusRuleRow>(data: {
  statuses: CaseValueList<T>;
  fromStatusId: string | null | undefined;
  toStatusId: string | null | undefined;
}): boolean {
  return (
    isCaseStatusClosed(data.statuses, data.toStatusId) &&
    !isCaseStatusClosed(data.statuses, data.fromStatusId)
  );
}

/*
 * A priority's rank: its place from the top, 0 the most urgent. Null for an
 * id that is none of the project's priorities.
 */
export function getCasePriorityRank<T extends CasePriorityRuleRow>(
  priorities: CaseValueList<T>,
  priorityId: string | null | undefined,
): number | null {
  const key: string = toCaseValueIdKey(priorityId);

  if (!key) {
    return null;
  }

  const index: number = sortCaseValues(priorities).findIndex(
    (priority: T): boolean => {
      return toCaseValueIdKey(priority._id) === key;
    },
  );

  return index >= 0 ? index : null;
}

/*
 * Urgent: at or above the project's high priority - the cases the Overview
 * turns red for, and the people hear about by default. False for a project
 * with no high priority, and for a priority that is none of the project's.
 */
export function isCasePriorityUrgent<T extends CasePriorityRuleRow>(
  priorities: CaseValueList<T>,
  priorityId: string | null | undefined,
): boolean {
  const high: T | undefined = getBuiltInRows(
    priorities,
    PRIORITY_LEVEL_FLAGS as ReadonlyArray<string>,
  ).get("isHighPriority");

  if (!high) {
    return false;
  }

  const rank: number | null = getCasePriorityRank(priorities, priorityId);
  const highRank: number | null = getCasePriorityRank(priorities, high._id);

  return rank !== null && highRank !== null && rank <= highRank;
}

/*
 * One status or priority as Change Status and Change Priority offer it: the
 * project's own, in its order, never an archived one - nobody picks one of
 * those again - but the one the case has now, marked Current, so the sheet
 * says where the case stands.
 */
export interface CaseValueChoice<T> {
  value: T;
  isCurrent: boolean;
  isArchived: boolean;
}

export function getCaseValueChoices<T extends CaseValueRuleRow>(
  values: CaseValueList<T>,
  currentId: string | null | undefined,
): Array<CaseValueChoice<T>> {
  const currentKey: string = toCaseValueIdKey(currentId);

  return sortCaseValues(values)
    .filter((value: T): boolean => {
      return (
        !isArchivedCaseValue(value) ||
        (Boolean(currentKey) && toCaseValueIdKey(value._id) === currentKey)
      );
    })
    .map((value: T): CaseValueChoice<T> => {
      return {
        value,
        isCurrent:
          Boolean(currentKey) && toCaseValueIdKey(value._id) === currentKey,
        isArchived: isArchivedCaseValue(value),
      };
    });
}

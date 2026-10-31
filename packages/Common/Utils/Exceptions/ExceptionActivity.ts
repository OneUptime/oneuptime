import { TelemetryExceptionActivityType } from "../../Models/DatabaseModels/TelemetryExceptionActivity";

/*
 * WHAT AN UPDATE OF AN EXCEPTION CHANGED, AS ACTIVITY ENTRIES.
 *
 * TelemetryExceptionService reads each row an update is about to write
 * before it is written (ExceptionActivityState), and once it is written
 * hands that and what the update wrote - after the service's own rules
 * (applyManualResolutionChange, applyAssignmentChange) - to
 * getExceptionActivityChanges, which says what changed, in the order a
 * person reads it: its resolution, then its archive switch, then who owns
 * it. A write that changes nothing - resolving what is resolved, assigning
 * the person it is assigned to - is no activity.
 *
 * Shared by the server and the tests, so what is recorded is decided in one
 * place.
 */

// The row as it was before the update: what decides what the update changed.
export interface ExceptionActivityState {
  isResolved: boolean;
  isArchived: boolean;
  resolvedInReleaseAfter: string | null;
  assignToUserId: string | null;
  assignToTeamId: string | null;
}

export interface ExceptionActivityChange {
  activityType: TelemetryExceptionActivityType;
  // Assigned: who it now belongs to. Unassigned: who it was taken from.
  assigneeUserId?: string | null | undefined;
  assigneeTeamId?: string | null | undefined;
  // ResolvedInNextRelease: the release it waits out.
  release?: string | null | undefined;
}

// The columns an update must touch for it to be activity.
export const EXCEPTION_ACTIVITY_COLUMNS: ReadonlyArray<string> = [
  "isResolved",
  "isArchived",
  "resolvedInReleaseAfter",
  "assignToUserId",
  "assignToTeamId",
  "assignToUser",
  "assignToTeam",
];

export function isExceptionActivityWrite(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) {
    return false;
  }

  return EXCEPTION_ACTIVITY_COLUMNS.some((column: string): boolean => {
    return data[column] !== undefined;
  });
}

// A switch as a write carries it: true, or "true" from a form.
export function readSwitch(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === true || value === "true";
}

/*
 * An id as a write or a row carries it - a string, an ObjectID, a relation
 * object with its id - in lower case; null for none. Undefined when the
 * write does not name it.
 */
export function readId(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const inner: unknown =
      record["_id"] !== undefined
        ? record["_id"]
        : record["id"] !== undefined
          ? record["id"]
          : undefined;

    if (inner !== undefined) {
      return readId(inner);
    }
  }

  const text: string = String(value).trim().toLowerCase();

  return text.length > 0 ? text : null;
}

function readRelease(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

// Who a write leaves it with: the person and the team it names, or as it was.
function getAssigneeAfter(
  before: ExceptionActivityState,
  write: Record<string, unknown>,
): { userId: string | null; teamId: string | null } {
  const user: string | null | undefined =
    readId(write["assignToUserId"]) !== undefined
      ? readId(write["assignToUserId"])
      : readId(write["assignToUser"]);
  const team: string | null | undefined =
    readId(write["assignToTeamId"]) !== undefined
      ? readId(write["assignToTeamId"])
      : readId(write["assignToTeam"]);

  return {
    userId: user === undefined ? before.assignToUserId : user,
    teamId: team === undefined ? before.assignToTeamId : team,
  };
}

export function getExceptionActivityChanges(data: {
  before: ExceptionActivityState;
  write: Record<string, unknown>;
}): Array<ExceptionActivityChange> {
  const before: ExceptionActivityState = data.before;
  const write: Record<string, unknown> = data.write || {};
  const changes: Array<ExceptionActivityChange> = [];

  // Its resolution.
  const resolved: boolean | undefined = readSwitch(write["isResolved"]);

  if (resolved === true) {
    const release: string | null =
      write["resolvedInReleaseAfter"] !== undefined
        ? readRelease(write["resolvedInReleaseAfter"])
        : before.resolvedInReleaseAfter;
    const releaseBefore: string | null = before.isResolved
      ? before.resolvedInReleaseAfter
      : null;

    if (!before.isResolved || release !== releaseBefore) {
      changes.push(
        release
          ? {
              activityType:
                TelemetryExceptionActivityType.ResolvedInNextRelease,
              release,
            }
          : { activityType: TelemetryExceptionActivityType.Resolved },
      );
    }
  } else if (resolved === false && before.isResolved) {
    /*
     * A reopen that names when it came back is OneUptime's: its check that a
     * fix did not hold in production (FixProductionVerifier). A person's
     * reopen never does (applyManualResolutionChange clears it).
     */
    changes.push({
      activityType:
        write["regressedAt"] !== undefined && write["regressedAt"] !== null
          ? TelemetryExceptionActivityType.Regressed
          : TelemetryExceptionActivityType.Reopened,
    });
  }

  // Its archive switch.
  const archived: boolean | undefined = readSwitch(write["isArchived"]);

  if (archived !== undefined && archived !== before.isArchived) {
    changes.push({
      activityType: archived
        ? TelemetryExceptionActivityType.Archived
        : TelemetryExceptionActivityType.Unarchived,
    });
  }

  // Who owns it.
  const assignee: { userId: string | null; teamId: string | null } =
    getAssigneeAfter(before, write);

  if (
    assignee.userId !== before.assignToUserId ||
    assignee.teamId !== before.assignToTeamId
  ) {
    if (assignee.userId || assignee.teamId) {
      changes.push({
        activityType: TelemetryExceptionActivityType.Assigned,
        assigneeUserId: assignee.userId,
        assigneeTeamId: assignee.teamId,
      });
    } else {
      changes.push({
        activityType: TelemetryExceptionActivityType.Unassigned,
        assigneeUserId: before.assignToUserId,
        assigneeTeamId: before.assignToTeamId,
      });
    }
  }

  return changes;
}

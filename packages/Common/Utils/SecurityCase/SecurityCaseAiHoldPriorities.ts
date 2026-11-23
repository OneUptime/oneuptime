import ObjectID from "../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../Types/SecurityCase/SecurityCasePriorityLevel";
import { StateListRow, toStateListRow } from "../StateOrder";
import SecurityCasePriorities from "./SecurityCasePriorities";

/*
 * WHICH CASES ONEUPTIME AI RESPONDS FIRST TO, BY PRIORITY (#10353): the
 * ones below the priority the project picked
 * (Project.securityCaseAiHoldBelowPriorityId) - High by default, so Medium,
 * Low and Informational wait while it works them and High and Critical
 * alert people at once. A priority picked and later archived or deleted
 * falls back to High: a doubt never holds a case it should not.
 *
 * The project's most urgent priority is never held, whatever is picked:
 * people take those at once.
 *
 * Priorities are read as the server and the Dashboard hold them - models or
 * their JSON - so both decide alike. Pure.
 */

function isArchived(priority: unknown): boolean {
  return (
    Boolean(priority) &&
    typeof priority === "object" &&
    (priority as { isArchived?: unknown }).isArchived === true
  );
}

function getId(priority: unknown): string {
  return priority
    ? toStateListRow(SecurityCasePriorities.definition, priority).id
    : "";
}

/*
 * The priority cases are held below: the one picked while it is one of the
 * project's priorities and not archived, else the built-in High one. Null
 * for a project with neither - nothing is held then.
 */
export function getSecurityCaseAiHoldThreshold<T>(data: {
  priorities: ReadonlyArray<T>;
  pickedPriorityId?: ObjectID | string | null | undefined;
}): T | null {
  const picked: T | null = SecurityCasePriorities.find(
    data.priorities,
    data.pickedPriorityId,
  );

  if (picked && !isArchived(picked)) {
    return picked;
  }

  return SecurityCasePriorities.getPriorityOfLevel(
    data.priorities,
    SecurityCasePriorityLevel.High,
  );
}

// The project's most urgent priority that is still offered.
export function getSecurityCaseHighestPriority<T>(
  priorities: ReadonlyArray<T>,
): T | null {
  return (
    SecurityCasePriorities.sort(priorities).find((priority: T): boolean => {
      return !isArchived(priority);
    }) || null
  );
}

export function isSecurityCaseAtHighestPriority(data: {
  priorities: ReadonlyArray<unknown>;
  priorityId: ObjectID | string | null | undefined;
}): boolean {
  const highest: unknown = getSecurityCaseHighestPriority(data.priorities);
  const highestId: string = getId(highest).toLowerCase();

  return (
    Boolean(highestId) &&
    String(data.priorityId || "").toLowerCase() === highestId
  );
}

/*
 * Whether a case at `priorityId` is held: below the threshold, and not at
 * the project's most urgent priority. A case at a priority that is none of
 * the project's, or a project with no threshold, is never held.
 */
export function isSecurityCaseBelowAiHoldThreshold(data: {
  priorities: ReadonlyArray<unknown>;
  priorityId: ObjectID | string | null | undefined;
  pickedPriorityId?: ObjectID | string | null | undefined;
}): boolean {
  const threshold: unknown = getSecurityCaseAiHoldThreshold({
    priorities: data.priorities,
    pickedPriorityId: data.pickedPriorityId,
  });

  if (!threshold) {
    return false;
  }

  if (
    SecurityCasePriorities.getRank(data.priorities, data.priorityId) === null
  ) {
    return false;
  }

  if (
    isSecurityCaseAtHighestPriority({
      priorities: data.priorities,
      priorityId: data.priorityId,
    })
  ) {
    return false;
  }

  return !SecurityCasePriorities.isAtLeast(
    data.priorities,
    data.priorityId,
    getId(threshold),
  );
}

/*
 * The priorities a threshold holds, most urgent first: every one of the
 * project's below it that is still offered. What the settings page lists
 * under each choice ("Holds Medium, Low and Informational").
 */
export function getSecurityCasePrioritiesHeldBelow<T>(data: {
  priorities: ReadonlyArray<T>;
  thresholdId: ObjectID | string | null | undefined;
}): Array<T> {
  return SecurityCasePriorities.sort(data.priorities).filter(
    (priority: T): boolean => {
      return (
        !isArchived(priority) &&
        isSecurityCaseBelowAiHoldThreshold({
          priorities: data.priorities,
          priorityId: getId(priority),
          pickedPriorityId: data.thresholdId,
        })
      );
    },
  );
}

/*
 * The priorities a project can hold cases below, most urgent first: every
 * one still offered but the least urgent, below which nothing would be
 * held.
 */
export function getSecurityCaseAiHoldThresholdChoices<T>(
  priorities: ReadonlyArray<T>,
): Array<T> {
  const offered: Array<T> = SecurityCasePriorities.sort(priorities).filter(
    (priority: T): boolean => {
      return !isArchived(priority);
    },
  );

  return offered.slice(0, Math.max(0, offered.length - 1));
}

// A priority's id as the lists hold it, for a caller with only the row.
export function getSecurityCasePriorityId(priority: unknown): string {
  const row: StateListRow | null = priority
    ? toStateListRow(SecurityCasePriorities.definition, priority)
    : null;

  return row?.id || "";
}

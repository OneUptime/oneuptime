import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { PeopleAvatarItem } from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHO OWNS AN EXCEPTION, AND THE ORDER THE LIST SHOWS THEM IN.
 *
 * An exception is assigned to one person or one team (assignToUserId /
 * assignToTeamId; the server clears the other on every write,
 * ExceptionIssueState.applyAssignmentChange). The exception's header picks
 * it, a row's menu assigns it to the reader, Bulk Actions assigns a
 * selection, and the list's Assigned to me shows the reader's own.
 *
 * Pure, so the list, the header and the tests read one definition.
 */

export interface ExceptionAssignmentWrite {
  assignToUserId: ObjectID | null;
  assignToTeamId: ObjectID | null;
}

// What the picker holds for an exception: its one person or team, or nobody.
export function getExceptionAssigneeValue(
  exception: Pick<TelemetryException, "assignToUserId" | "assignToTeamId">,
): PeoplePickerValue {
  if (exception.assignToUserId) {
    return { [PeoplePickerKind.User]: [exception.assignToUserId.toString()] };
  }

  if (exception.assignToTeamId) {
    return { [PeoplePickerKind.Team]: [exception.assignToTeamId.toString()] };
  }

  return {};
}

/*
 * What a pick writes: the person or the team picked, and the other cleared;
 * nobody picked unassigns. A person wins over a team when a value holds
 * both, as a single-pick picker never does.
 */
export function getExceptionAssignmentWrite(
  value: PeoplePickerValue,
): ExceptionAssignmentWrite {
  const userId: string | undefined = value[PeoplePickerKind.User]?.[0];
  const teamId: string | undefined = value[PeoplePickerKind.Team]?.[0];

  if (userId) {
    return { assignToUserId: new ObjectID(userId), assignToTeamId: null };
  }

  if (teamId) {
    return { assignToUserId: null, assignToTeamId: new ObjectID(teamId) };
  }

  return { assignToUserId: null, assignToTeamId: null };
}

// Whether a write would leave the exception as it is.
export function isSameAssignment(
  exception: Pick<TelemetryException, "assignToUserId" | "assignToTeamId">,
  write: ExceptionAssignmentWrite,
): boolean {
  return (
    (exception.assignToUserId?.toString() || null) ===
      (write.assignToUserId?.toString() || null) &&
    (exception.assignToTeamId?.toString() || null) ===
      (write.assignToTeamId?.toString() || null)
  );
}

/*
 * The assignee a row shows, as an avatar and a name, from what the list
 * read of the assigned person or team. Null when nobody is assigned, or the
 * reader may not see who.
 */
export function getExceptionAssigneeAvatar(
  exception: Pick<
    TelemetryException,
    "assignToUserId" | "assignToTeamId" | "assignToUser" | "assignToTeam"
  >,
): PeopleAvatarItem | null {
  if (exception.assignToUserId) {
    const name: string =
      exception.assignToUser?.name?.toString() ||
      exception.assignToUser?.email?.toString() ||
      "";

    return name
      ? {
          kind: PeoplePickerKind.User,
          name,
          userId: exception.assignToUserId,
        }
      : null;
  }

  if (exception.assignToTeamId) {
    const name: string = exception.assignToTeam?.name?.toString() || "";

    return name ? { kind: PeoplePickerKind.Team, name } : null;
  }

  return null;
}

// --- The list's order ---

export enum ExceptionListSort {
  LastSeen = "last-seen",
  FirstSeen = "first-seen",
  MostEvents = "most-events",
}

export const DEFAULT_EXCEPTION_LIST_SORT: ExceptionListSort =
  ExceptionListSort.LastSeen;

export const EXCEPTION_LIST_SORT_LABELS: Record<ExceptionListSort, string> = {
  [ExceptionListSort.LastSeen]: translationKey("Last seen"),
  [ExceptionListSort.FirstSeen]: translationKey("First seen"),
  [ExceptionListSort.MostEvents]: translationKey("Most events"),
};

export function readExceptionListSort(
  value: string | null | undefined,
): ExceptionListSort {
  return Object.values(ExceptionListSort).includes(value as ExceptionListSort)
    ? (value as ExceptionListSort)
    : DEFAULT_EXCEPTION_LIST_SORT;
}

/*
 * The list's sort: newest activity first, newest exceptions first, or the
 * most frequent first - each then by last seen, so rows that tie keep a
 * stable, useful order.
 */
export function getExceptionListSortOrder(
  sort: ExceptionListSort,
): Record<string, SortOrder> {
  switch (sort) {
    case ExceptionListSort.FirstSeen:
      return {
        firstSeenAt: SortOrder.Descending,
        lastSeenAt: SortOrder.Descending,
      };
    case ExceptionListSort.MostEvents:
      return {
        occuranceCount: SortOrder.Descending,
        lastSeenAt: SortOrder.Descending,
      };
    case ExceptionListSort.LastSeen:
    default:
      return { lastSeenAt: SortOrder.Descending };
  }
}

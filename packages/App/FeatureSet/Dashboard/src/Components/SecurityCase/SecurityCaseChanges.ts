import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseVerdict, {
  isSecurityCaseVerdict,
} from "Common/Types/SecurityCase/SecurityCaseVerdict";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT WORKING A CASE FROM A LIST DOES TO IT.
 *
 * A case is worked from the queue's lists - a row's ⋯ menu, and Bulk
 * Actions for the cases selected - and from its own page, with the same
 * four moves: Assign to Me, Assign to Someone Else, Change Status and Change
 * Priority. They follow the rules the case's page already applies, so a case
 * changes the same way wherever it is worked:
 *
 *   - nobody takes a closed case: Assign to Me and Assign to Someone Else
 *     are offered on open cases only (the case's header shows Assign to Me
 *     only then, and Closed Cases never offered it);
 *   - a status that closes the case asks what the case turned out to be, as
 *     Close Case does: a verdict, and an optional closing note. A case moving
 *     between two statuses that both close keeps its verdict;
 *   - the statuses and priorities offered are the project's own, in their
 *     order, the archived ones left out - nobody picks one of those again -
 *     but the one a case has, marked Current, so a row says where it stands;
 *   - a case is assigned to one person, or handed to a team: a team's case
 *     with nobody on it waits in that team's queue (the Unassigned list says
 *     which team), so handing one to a team takes the person off it.
 *
 * Every change is one update of the case through the API: the server checks
 * the reader may make it and writes the timeline entry, naming who made it
 * (SecurityCaseService), and tells whoever the case reached.
 *
 * React-free, so the rules are pinned in a plain test (App's
 * SecurityCaseChanges.test.ts) and read the same by the list's actions
 * (useSecurityCaseListActions), their dialogs (SecurityCaseChangeModals) and
 * the case's header.
 */

// The four moves, as the menus, the dialogs and Bulk Actions name them.
export const ASSIGN_TO_ME: string = translationKey("Assign to Me");
export const ASSIGN_TO_SOMEONE_ELSE: string = translationKey(
  "Assign to Someone Else",
);
export const CHANGE_STATUS: string = translationKey("Change Status");
export const CHANGE_PRIORITY: string = translationKey("Change Priority");

export const SECURITY_CASE_CHANGE_ICONS: {
  assignToMe: IconProp;
  assignToSomeoneElse: IconProp;
  changeStatus: IconProp;
  changePriority: IconProp;
} = {
  assignToMe: IconProp.User,
  assignToSomeoneElse: IconProp.UserPlus,
  changeStatus: IconProp.ArrowCircleRight,
  changePriority: IconProp.Signal,
};

/*
 * The dialogs' words. A row's dialog names its case by number ("CASE-142"),
 * as the case's own page and the trail do; Bulk Actions' count the cases.
 */
export const ASSIGN_ONE_DESCRIPTION: string = translationKey(
  "Pick a person to work {{case}}, or a team to pick it up.",
);
export const ASSIGN_SELECTED_DESCRIPTION: PluralTemplate = {
  one: "Pick a person to work the selected case, or a team to pick it up.",
  other:
    "Pick a person to work the {{count}} selected cases, or a team to pick them up.",
};
/*
 * The field is named and nothing more: the dialog's own sentence says what
 * a team pick means ("or a team to pick it up").
 */
export const ASSIGN_FIELD_TITLE: string = translationKey("Person or Team");
export const ASSIGN_PICKER_ADD_TEXT: string = translationKey(
  "Choose someone or a team",
);
// The search list's words, as the Owners picker has them.
export const ASSIGN_PICKER_SEARCH_PLACEHOLDER: string = translationKey(
  "Search people or teams...",
);
export const ASSIGN_PICKER_EMPTY_TEXT: string = translationKey(
  "No people or teams available.",
);
export const ASSIGN_SUBMIT: string = translationKey("Assign");

export const CHANGE_STATUS_ONE_DESCRIPTION: string = translationKey(
  "Pick the new status for {{case}}.",
);
/*
 * As Change Priority's: what to pick, nothing more. A status that closes
 * cases asks its verdict where it is picked, saying there what it does.
 */
export const CHANGE_STATUS_SELECTED_DESCRIPTION: PluralTemplate = {
  one: "Pick the new status for the selected case.",
  other: "Pick the new status for the {{count}} selected cases.",
};
// Over the verdict, for several cases: one pick goes on every case it closes.
export const CLOSING_SELECTED_VERDICT_DESCRIPTION: string = translationKey(
  "Each case this closes gets this verdict and closing note.",
);
// Under Closing Note, for several cases: the verdict's sentence says where it goes.
export const CLOSING_SELECTED_NOTE_DESCRIPTION: string = translationKey(
  "What was found and what was done.",
);
export const CHANGE_PRIORITY_ONE_DESCRIPTION: string = translationKey(
  "Pick the new priority for {{case}}.",
);
export const CHANGE_PRIORITY_SELECTED_DESCRIPTION: PluralTemplate = {
  one: "Pick the new priority for the selected case.",
  other: "Pick the new priority for the {{count}} selected cases.",
};

// Beside the value a case has now, in a row's dialog.
export const CURRENT_VALUE: string = translationKey("Current");

/*
 * Over the server's reason, when a row's Assign to Me - the one move that
 * saves without a dialog - is refused: "Could not assign CASE-138".
 */
export const ASSIGN_TO_ME_FAILED: string = translationKey(
  "Could not assign {{case}}",
);

// What Bulk Actions' result says happened to the cases.
export const ASSIGNED_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} assigned",
    other: "{{count}} {{itemsName}} assigned",
  },
  failed: {
    one: "{{count}} {{itemName}} not assigned",
    other: "{{count}} {{itemsName}} not assigned",
  },
};

export const ASSIGNED_TO_YOU_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} assigned to you",
    other: "{{count}} {{itemsName}} assigned to you",
  },
  failed: {
    one: "{{count}} {{itemName}} not assigned to you",
    other: "{{count}} {{itemsName}} not assigned to you",
  },
};

export const UPDATED_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} updated",
    other: "{{count}} {{itemsName}} updated",
  },
  failed: {
    one: "{{count}} {{itemName}} not updated",
    other: "{{count}} {{itemsName}} not updated",
  },
};

/*
 * Why Bulk Actions left a selected case as it was. Listed in the result
 * under "not changed", each with its case, so nobody wonders why a case
 * they picked did not move.
 */
export enum SecurityCaseSkipReason {
  // A closed case is not assigned: it would have to be reopened first.
  Closed = "closed",
  // Assign to Me on a case that is the reader's already.
  AssignedToYou = "assignedToYou",
  // Assign to Someone Else to the person the case is assigned to already.
  AssignedToThem = "assignedToThem",
  // Handed to the team whose queue it waits in already, nobody on it.
  InTeamQueue = "inTeamQueue",
  // Moved to the status, or set to the priority, it has already.
  SameValue = "sameValue",
}

export const SKIP_REASON_TEXT: Record<SecurityCaseSkipReason, string> = {
  [SecurityCaseSkipReason.Closed]: translationKey(
    "Closed. Reopen it to assign it.",
  ),
  [SecurityCaseSkipReason.AssignedToYou]: translationKey(
    "Assigned to you already.",
  ),
  [SecurityCaseSkipReason.AssignedToThem]: translationKey(
    "Assigned to them already.",
  ),
  [SecurityCaseSkipReason.InTeamQueue]: translationKey(
    "In this team's queue already.",
  ),
  // The value by its name: "Already Investigating."
  [SecurityCaseSkipReason.SameValue]: translationKey("Already {{value}}."),
};

// An id as text, from an ObjectID, a string, a related row or nothing.
export function readSecurityCaseId(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (typeof value === "object") {
    const record: JSONObject = value as JSONObject;
    const id: unknown = record["_id"] || record["id"];

    return id ? readSecurityCaseId(id) : "";
  }

  return "";
}

/*
 * The id a case's column holds, read off the column, or off its related
 * row where a list read the relation only: a row's status from
 * securityCaseStatusId or securityCaseStatus._id.
 */
function readColumnId(
  securityCase: SecurityCase,
  idColumn: string,
  relation: string,
): string {
  const record: JSONObject = securityCase as unknown as JSONObject;

  return (
    readSecurityCaseId(record[idColumn]) || readSecurityCaseId(record[relation])
  );
}

export function getSecurityCaseStatusId(securityCase: SecurityCase): string {
  return readColumnId(
    securityCase,
    "securityCaseStatusId",
    "securityCaseStatus",
  );
}

export function getSecurityCasePriorityId(securityCase: SecurityCase): string {
  return readColumnId(
    securityCase,
    "securityCasePriorityId",
    "securityCasePriority",
  );
}

export function getSecurityCaseAssigneeId(securityCase: SecurityCase): string {
  return readColumnId(securityCase, "assignedToUserId", "assignedToUser");
}

export function getSecurityCaseTeamId(securityCase: SecurityCase): string {
  return readColumnId(securityCase, "assignedToTeamId", "assignedToTeam");
}

// Whether a case is closed: its status is the project's closed one, or after it.
export function isSecurityCaseClosed(
  securityCase: SecurityCase,
  statuses: ReadonlyArray<unknown>,
): boolean {
  return SecurityCaseStatuses.isClosed(
    statuses,
    getSecurityCaseStatusId(securityCase),
  );
}

// Whether the person signed in is the one the case is assigned to.
export function isSecurityCaseMine(
  securityCase: SecurityCase,
  myUserId: ObjectID | string | null | undefined,
): boolean {
  const me: string = readSecurityCaseId(myUserId);

  return Boolean(me) && getSecurityCaseAssigneeId(securityCase) === me;
}

/*
 * Assign to Me: on an open case that is not the reader's already - the
 * rule the case's header follows for its own Assign to Me.
 */
export function isAssignToMeOffered(data: {
  securityCase: SecurityCase;
  statuses: ReadonlyArray<unknown>;
  myUserId: ObjectID | string | null | undefined;
}): boolean {
  return (
    !isSecurityCaseClosed(data.securityCase, data.statuses) &&
    !isSecurityCaseMine(data.securityCase, data.myUserId)
  );
}

// Assign to Someone Else: on an open case. A closed one is reopened first.
export function isAssignToSomeoneElseOffered(data: {
  securityCase: SecurityCase;
  statuses: ReadonlyArray<unknown>;
}): boolean {
  return !isSecurityCaseClosed(data.securityCase, data.statuses);
}

/*
 * Who a case is given to: one person, or one team - the people picker of
 * Assign to Someone Else takes one pick of either.
 */
export interface SecurityCaseAssigneePick {
  userId?: string | undefined;
  teamId?: string | undefined;
}

// Whether a pick names anybody at all.
export function hasSecurityCaseAssignee(
  pick: SecurityCaseAssigneePick,
): boolean {
  return Boolean(
    readSecurityCaseId(pick.userId) || readSecurityCaseId(pick.teamId),
  );
}

/*
 * What giving a case to a pick writes. A person is the one working it; the
 * team it is in is left as it is. A team takes the case into its queue for
 * someone on it to pick up, so the person on it comes off: that is what
 * handing a case to a team means, and where the Unassigned list finds it.
 */
export function getSecurityCaseAssignWrite(
  pick: SecurityCaseAssigneePick,
): JSONObject {
  const userId: string = readSecurityCaseId(pick.userId);

  if (userId) {
    return { assignedToUserId: userId };
  }

  const teamId: string = readSecurityCaseId(pick.teamId);

  if (teamId) {
    return { assignedToTeamId: teamId, assignedToUserId: null };
  }

  return {};
}

/*
 * Why giving a case to a pick would leave it as it is, or null when it
 * changes it. `myUserId` tells "Assigned to you already" from "Assigned to
 * them already".
 */
export function getSecurityCaseAssignSkipReason(data: {
  securityCase: SecurityCase;
  pick: SecurityCaseAssigneePick;
  statuses: ReadonlyArray<unknown>;
  myUserId?: ObjectID | string | null | undefined;
}): SecurityCaseSkipReason | null {
  if (isSecurityCaseClosed(data.securityCase, data.statuses)) {
    return SecurityCaseSkipReason.Closed;
  }

  const userId: string = readSecurityCaseId(data.pick.userId);
  const assigneeId: string = getSecurityCaseAssigneeId(data.securityCase);

  if (userId) {
    if (assigneeId !== userId) {
      return null;
    }

    return userId === readSecurityCaseId(data.myUserId)
      ? SecurityCaseSkipReason.AssignedToYou
      : SecurityCaseSkipReason.AssignedToThem;
  }

  const teamId: string = readSecurityCaseId(data.pick.teamId);

  if (
    teamId &&
    !assigneeId &&
    getSecurityCaseTeamId(data.securityCase) === teamId
  ) {
    return SecurityCaseSkipReason.InTeamQueue;
  }

  return null;
}

/*
 * What a status asks for before a case moves to it: a verdict and a
 * closing note when it closes the case - an open case going to the
 * project's closed status, or one after it. A closed case moving to
 * another closing status keeps the verdict it closed with.
 */
export function doesStatusCloseSecurityCase(data: {
  securityCase: SecurityCase;
  statusId: string;
  statuses: ReadonlyArray<unknown>;
}): boolean {
  return (
    SecurityCaseStatuses.isClosed(data.statuses, data.statusId) &&
    !isSecurityCaseClosed(data.securityCase, data.statuses)
  );
}

// Whether a status closes any of the cases: Change Status then asks for a verdict.
export function doesStatusCloseAnySecurityCase(data: {
  securityCases: ReadonlyArray<SecurityCase>;
  statusId: string;
  statuses: ReadonlyArray<unknown>;
}): boolean {
  return data.securityCases.some((securityCase: SecurityCase): boolean => {
    return doesStatusCloseSecurityCase({
      securityCase: securityCase,
      statusId: data.statusId,
      statuses: data.statuses,
    });
  });
}

// A status picked in Change Status, and what closing asks for.
export interface SecurityCaseStatusPick {
  statusId: string;
  verdict?: SecurityCaseVerdict | string | undefined;
  closingNote?: string | undefined;
}

/*
 * What moving one case to a status writes: the status, and - when it
 * closes the case - the verdict picked (Undetermined if none) and the
 * closing note, as Close Case writes them. The close time and who closed
 * it are the server's to stamp.
 */
export function getSecurityCaseStatusWrite(data: {
  securityCase: SecurityCase;
  pick: SecurityCaseStatusPick;
  statuses: ReadonlyArray<unknown>;
}): JSONObject {
  const write: JSONObject = { securityCaseStatusId: data.pick.statusId };

  if (
    !doesStatusCloseSecurityCase({
      securityCase: data.securityCase,
      statusId: data.pick.statusId,
      statuses: data.statuses,
    })
  ) {
    return write;
  }

  write["verdict"] = isSecurityCaseVerdict(data.pick.verdict)
    ? data.pick.verdict
    : SecurityCaseVerdict.Undetermined;

  const closingNote: string =
    typeof data.pick.closingNote === "string"
      ? data.pick.closingNote.trim()
      : "";

  if (closingNote) {
    write["closingNote"] = closingNote;
  }

  return write;
}

// Why moving a case to a status would leave it as it is: it is there already.
export function getSecurityCaseStatusSkipReason(data: {
  securityCase: SecurityCase;
  statusId: string;
}): SecurityCaseSkipReason | null {
  return getSecurityCaseStatusId(data.securityCase) === data.statusId
    ? SecurityCaseSkipReason.SameValue
    : null;
}

export function getSecurityCasePriorityWrite(priorityId: string): JSONObject {
  return { securityCasePriorityId: priorityId };
}

export function getSecurityCasePrioritySkipReason(data: {
  securityCase: SecurityCase;
  priorityId: string;
}): SecurityCaseSkipReason | null {
  return getSecurityCasePriorityId(data.securityCase) === data.priorityId
    ? SecurityCaseSkipReason.SameValue
    : null;
}

/*
 * One status or priority as Change Status and Change Priority offer it:
 * the project's name and colour, Archived for the retired one a case still
 * has, and Current for the one the case has now - shown, but not picked
 * again.
 */
export interface SecurityCaseValueChoice {
  id: string;
  name: string;
  color?: Color | undefined;
  isArchived: boolean;
  isCurrent: boolean;
}

function toChoices<T extends SecurityCaseStatus | SecurityCasePriority>(
  sorted: ReadonlyArray<T>,
  currentIds: ReadonlyArray<string>,
  markCurrent: boolean,
): Array<SecurityCaseValueChoice> {
  return sorted
    .filter((value: T): boolean => {
      // Never an archived one, unless a case has it now.
      return (
        !isArchivedValue(value) ||
        currentIds.includes(readSecurityCaseId(value.id))
      );
    })
    .map((value: T): SecurityCaseValueChoice => {
      const id: string = readSecurityCaseId(value.id);

      return {
        id: id,
        name: value.name || "",
        ...(value.color ? { color: value.color } : {}),
        isArchived: isArchivedValue(value),
        isCurrent: markCurrent && currentIds.includes(id),
      };
    });
}

/*
 * The statuses Change Status offers, in the project's order. For one case
 * its status is among them, marked Current; for several, every live status,
 * each of which some of them may be in.
 */
export function getSecurityCaseStatusChoices(data: {
  statuses: ReadonlyArray<SecurityCaseStatus>;
  securityCases: ReadonlyArray<SecurityCase>;
}): Array<SecurityCaseValueChoice> {
  const isOne: boolean = data.securityCases.length === 1;

  return toChoices(
    SecurityCaseStatuses.sort(data.statuses),
    isOne ? [getSecurityCaseStatusId(data.securityCases[0]!)] : [],
    isOne,
  );
}

// The priorities Change Priority offers: most urgent first, as the statuses are.
export function getSecurityCasePriorityChoices(data: {
  priorities: ReadonlyArray<SecurityCasePriority>;
  securityCases: ReadonlyArray<SecurityCase>;
}): Array<SecurityCaseValueChoice> {
  const isOne: boolean = data.securityCases.length === 1;

  return toChoices(
    SecurityCasePriorities.sort(data.priorities),
    isOne ? [getSecurityCasePriorityId(data.securityCases[0]!)] : [],
    isOne,
  );
}

// A value's name by its id, for "Already Investigating.": "" for none known.
export function getSecurityCaseValueName(
  values: ReadonlyArray<SecurityCaseStatus | SecurityCasePriority>,
  id: string,
): string {
  const value: SecurityCaseStatus | SecurityCasePriority | undefined =
    values.find((candidate: SecurityCaseStatus | SecurityCasePriority) => {
      return readSecurityCaseId(candidate.id) === id;
    });

  return value?.name || "";
}

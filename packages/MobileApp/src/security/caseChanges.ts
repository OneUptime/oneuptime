import {
  doesStatusCloseCase,
  isCaseStatusClosed,
  type CaseStatusRuleRow,
  type CaseValueList,
} from "./caseValues";
import { isSecurityCaseVerdict, type SecurityCaseVerdict } from "./caseTerms";

/*
 * WHAT WORKING A CASE FROM THE PHONE DOES TO IT.
 *
 * The same moves the dashboard makes on a case, by the same rules
 * (Dashboard Components/SecurityCase/SecurityCaseChanges), so a case changes
 * the same way wherever it is worked:
 *
 *   - nobody takes a closed case: Assign to Me and Assign to Someone Else are
 *     offered on open cases only;
 *   - a status that closes the case asks what the case turned out to be - a
 *     verdict, Undetermined when none is picked, and an optional closing
 *     note - and a case moving between two statuses that both close keeps
 *     the verdict it closed with;
 *   - Reopen moves a closed case to the project's acknowledged status, Close
 *     Case an open one to its closed status (caseValues).
 *
 * Every change is one update of the case through the API, the same PUT the
 * dashboard sends: the server checks the reader may make it, stamps when the
 * case was acknowledged, contained or closed and by whom, writes the
 * timeline entry, and tells whoever the change reached.
 */

// Whether the person signed in is the one the case is assigned to.
export function isCaseAssignedTo(
  assignedToUserId: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  return (
    Boolean(assignedToUserId) &&
    Boolean(userId) &&
    String(assignedToUserId).toLowerCase() === String(userId).toLowerCase()
  );
}

/*
 * Assign to Me: on an open case that is not the reader's already. It is how a
 * case is taken on - the server records it as acknowledged - so it is the
 * first thing offered on a case nobody has.
 */
export function isAssignToMeOffered<T extends CaseStatusRuleRow>(data: {
  statuses: CaseValueList<T>;
  statusId: string | null | undefined;
  assignedToUserId: string | null | undefined;
  userId: string | null | undefined;
}): boolean {
  return (
    Boolean(data.userId) &&
    !isCaseStatusClosed(data.statuses, data.statusId) &&
    !isCaseAssignedTo(data.assignedToUserId, data.userId)
  );
}

// Assign to Someone Else: on an open case. A closed one is reopened first.
export function isAssignToSomeoneElseOffered<
  T extends CaseStatusRuleRow,
>(data: {
  statuses: CaseValueList<T>;
  statusId: string | null | undefined;
}): boolean {
  return !isCaseStatusClosed(data.statuses, data.statusId);
}

export type CaseWrite = Record<string, string | null>;

/*
 * What giving a case to a person writes: the person working it. The team it
 * waits for is left as it is, as the dashboard leaves it.
 */
export function getAssignWrite(userId: string): CaseWrite {
  return { assignedToUserId: userId };
}

// A status picked in Change Status, and what closing asks for.
export interface CaseStatusPick {
  statusId: string;
  verdict?: SecurityCaseVerdict | string | null | undefined;
  closingNote?: string | null | undefined;
}

/*
 * What moving a case to a status writes: the status and - when it closes the
 * case - the verdict picked (Undetermined if none) and the closing note. When
 * the case closed and by whom are the server's to stamp.
 */
export function getStatusWrite<T extends CaseStatusRuleRow>(data: {
  statuses: CaseValueList<T>;
  fromStatusId: string | null | undefined;
  pick: CaseStatusPick;
}): CaseWrite {
  const write: CaseWrite = { securityCaseStatusId: data.pick.statusId };

  if (
    !doesStatusCloseCase({
      statuses: data.statuses,
      fromStatusId: data.fromStatusId,
      toStatusId: data.pick.statusId,
    })
  ) {
    return write;
  }

  write["verdict"] = isSecurityCaseVerdict(data.pick.verdict)
    ? data.pick.verdict
    : "Undetermined";

  const closingNote: string =
    typeof data.pick.closingNote === "string"
      ? data.pick.closingNote.trim()
      : "";

  if (closingNote) {
    write["closingNote"] = closingNote;
  }

  return write;
}

export function getPriorityWrite(priorityId: string): CaseWrite {
  return { securityCasePriorityId: priorityId };
}

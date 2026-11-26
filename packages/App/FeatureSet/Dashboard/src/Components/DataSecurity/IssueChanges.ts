import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  AcceptedUntilProblem,
  DEFAULT_ACCEPTANCE_IN_DAYS,
  getDefaultAcceptedUntil,
  getIssueAssignWrite,
  getIssueMoveWrite,
  IssueAcceptance,
  IssueAssigneePick,
  isIssueMoveOffered,
  ISSUE_MOVE_STATUS,
  ISSUE_MOVES,
  IssueMove,
  MAX_ACCEPTANCE_IN_DAYS,
  readAcceptedUntilProblem,
  readIssueStatus,
} from "Common/Utils/DataSecurity/DataSecurityIssueChanges";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A PERSON DOES TO A DATA SECURITY ISSUE.
 *
 * OneUptime opens, updates and resolves issues as its checks run; a person
 * decides what happens next (DataSecurityIssueService):
 *
 *   - Accept Risk: with a reason and an expiry date at most a year away,
 *     after which the issue opens again if its check still fails;
 *   - Mark Resolved: once it is fixed - the store is checked again at once,
 *     and the issue opens again if the check still fails;
 *   - Not an Issue: the finding was wrong, and why; it stays closed;
 *   - Reopen: back to Open;
 *   - Assign: a person or a team works on it.
 *
 * Each is one update of the issue through the API, so the server checks the
 * permission and writes the change to the issue's timeline. A move that
 * would leave an issue where it is skips it, saying why. What each writes
 * is built in Common (Utils/DataSecurity/DataSecurityIssueChanges), where
 * Ask AI's change_data_security_issue builds the same write (#10378); the
 * words a person reads stay here.
 */

export {
  IssueMove,
  ISSUE_MOVES,
  ISSUE_MOVE_STATUS,
  MAX_ACCEPTANCE_IN_DAYS,
  DEFAULT_ACCEPTANCE_IN_DAYS,
  readIssueStatus,
  isIssueMoveOffered,
  getIssueMoveWrite,
  getIssueAssignWrite,
  getDefaultAcceptedUntil,
};
export type { IssueAcceptance, IssueAssigneePick };

export const ISSUE_MOVE_TITLES: Record<IssueMove, string> = {
  [IssueMove.Accept]: translationKey("Accept Risk"),
  [IssueMove.Resolve]: translationKey("Mark Resolved"),
  [IssueMove.NotAnIssue]: translationKey("Not an Issue"),
  [IssueMove.Reopen]: translationKey("Reopen"),
};

export const ISSUE_MOVE_ICONS: Record<IssueMove, IconProp> = {
  [IssueMove.Accept]: IconProp.ShieldCheck,
  [IssueMove.Resolve]: IconProp.CheckCircle,
  [IssueMove.NotAnIssue]: IconProp.NoSymbol,
  [IssueMove.Reopen]: IconProp.Refresh,
};

export const ASSIGN_ISSUE: string = translationKey("Assign");
export const ASSIGN_ISSUE_ICON: IconProp = IconProp.User;

/*
 * Why a selected issue was left alone: it is there already. Accept Risk
 * leaves none alone - it writes a new reason and date over an accepted
 * issue's - and Reopen is not offered on a selection.
 */
export const ISSUE_ALREADY_THERE: Partial<Record<IssueMove, string>> = {
  [IssueMove.Resolve]: translationKey("Already resolved."),
  [IssueMove.NotAnIssue]: translationKey("Already marked not an issue."),
};

/*
 * What a move that closes an issue does, under its question: the two that
 * ask first. Accept Risk says it in its own dialog.
 */
export const ISSUE_MOVE_SENTENCES: Partial<Record<IssueMove, string>> = {
  [IssueMove.Resolve]: translationKey(
    "The store is checked again now. It opens again if the check still fails.",
  ),
  [IssueMove.NotAnIssue]: translationKey(
    "It stays closed. Use this when the finding was wrong.",
  ),
};

// A move's sentence in the reader's language, or "" for a move with none.
export function getIssueMoveSentence(
  move: IssueMove,
  translator: Translator,
): string {
  const sentence: string | undefined = ISSUE_MOVE_SENTENCES[move];

  return sentence ? translator.translateText(sentence) || sentence : "";
}

// The questions a selection is asked before a move, counted.
export const ISSUE_MOVE_BULK_QUESTIONS: Partial<
  Record<IssueMove, PluralTemplate>
> = {
  [IssueMove.Resolve]: {
    one: "Mark {{count}} issue resolved?",
    other: "Mark {{count}} issues resolved?",
  },
  [IssueMove.NotAnIssue]: {
    one: "Mark {{count}} issue as not an issue?",
    other: "Mark {{count}} issues as not an issue?",
  },
};

// The result's words for what happened to each selected issue.
export const ISSUE_MOVE_RESULT_LABELS: Partial<
  Record<IssueMove, { succeeded: PluralTemplate; failed: PluralTemplate }>
> = {
  [IssueMove.Accept]: {
    succeeded: {
      one: "{{count}} {{itemName}} accepted",
      other: "{{count}} {{itemsName}} accepted",
    },
    failed: {
      one: "{{count}} {{itemName}} not accepted",
      other: "{{count}} {{itemsName}} not accepted",
    },
  },
  [IssueMove.Resolve]: {
    succeeded: {
      one: "{{count}} {{itemName}} resolved",
      other: "{{count}} {{itemsName}} resolved",
    },
    failed: {
      one: "{{count}} {{itemName}} not resolved",
      other: "{{count}} {{itemsName}} not resolved",
    },
  },
  [IssueMove.NotAnIssue]: {
    succeeded: {
      one: "{{count}} {{itemName}} closed",
      other: "{{count}} {{itemsName}} closed",
    },
    failed: {
      one: "{{count}} {{itemName}} not closed",
      other: "{{count}} {{itemsName}} not closed",
    },
  },
};

/*
 * Why someone who may not change issues finds the moves locked: about the
 * issues, not "this Data Security Issue".
 */
export const ISSUE_MOVES_LOCKED: string = translationKey(
  "You do not have permission to change data security issues.",
);

/*
 * Said under every Delete question: an issue whose check still fails comes
 * back on the next check, so closing it is the way to be rid of it.
 */
export const ISSUE_DELETE_WARNING: string = translationKey(
  "If its check still fails, OneUptime opens it again on the next check. To close it, mark it resolved or not an issue.",
);

export const ACCEPTANCE_TOO_LONG: string = translationKey(
  "A risk can be accepted for at most a year.",
);

export const ACCEPTANCE_IN_THE_PAST: string = translationKey(
  "Pick a date in the future.",
);

/*
 * Why a move leaves an issue alone, or null: Accept Risk on an accepted
 * issue still writes, so its reason and date can be changed.
 */
export function getIssueMoveSkipReason(
  issue: DataSecurityIssue,
  move: IssueMove,
): string | null {
  const already: string | undefined = ISSUE_ALREADY_THERE[move];

  return already && readIssueStatus(issue) === ISSUE_MOVE_STATUS[move]
    ? already
    : null;
}

/*
 * Reads the date the form holds: a date, or its ISO or YYYY-MM-DD text (a
 * day with no time is that day where the reader is, not in UTC).
 */
export function readAcceptedUntil(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const date: Date = OneUptimeDate.fromString(value);

    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/*
 * Why a picked expiry will not do, or null: it is in the past, or more
 * than a year away. Checked at the end of the picked day, which is when
 * the acceptance runs out.
 */
export function getAcceptedUntilProblem(
  until: Date | null,
  now: Date = new Date(),
): string | null {
  switch (readAcceptedUntilProblem(until, now)) {
    case AcceptedUntilProblem.InThePast:
      return ACCEPTANCE_IN_THE_PAST;
    case AcceptedUntilProblem.TooLong:
      return ACCEPTANCE_TOO_LONG;
    default:
      return null;
  }
}

// An issue's id, whichever shape it arrived in.
export function readIssueId(issue: DataSecurityIssue): ObjectID | null {
  const id: string = (issue._id || issue.id)?.toString() || "";

  return id ? new ObjectID(id) : null;
}

/*
 * How a dialog or a result names an issue: its title - its check's, in the
 * reader's language when given their translator.
 */
export function getIssueName(
  issue: DataSecurityIssue,
  translator?: Translator | undefined,
): string {
  const title: string = (issue.title || "").trim();

  return (translator?.translateText(title) || title).trim();
}

import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import OneUptimeDate from "Common/Types/Date";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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
 *   - Not an Issue: the finding was wrong, and it stays closed;
 *   - Reopen: back to Open;
 *   - Assign: a person or a team works on it.
 *
 * Each is one update of the issue through the API, so the server checks the
 * permission and writes the change to the issue's timeline. A move that
 * would leave an issue where it is skips it, saying why.
 */

export enum IssueMove {
  Accept = "accept",
  Resolve = "resolve",
  NotAnIssue = "notAnIssue",
  Reopen = "reopen",
}

export const ISSUE_MOVES: ReadonlyArray<IssueMove> = [
  IssueMove.Resolve,
  IssueMove.Accept,
  IssueMove.NotAnIssue,
  IssueMove.Reopen,
];

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

// The status each move leaves an issue in.
export const ISSUE_MOVE_STATUS: Record<IssueMove, DataSecurityIssueStatus> = {
  [IssueMove.Accept]: DataSecurityIssueStatus.Accepted,
  [IssueMove.Resolve]: DataSecurityIssueStatus.Resolved,
  [IssueMove.NotAnIssue]: DataSecurityIssueStatus.NotAnIssue,
  [IssueMove.Reopen]: DataSecurityIssueStatus.Open,
};

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

// The longest a risk is accepted for: the server allows a year and a day.
export const MAX_ACCEPTANCE_IN_DAYS: number = 365;

// Where Accepted Until starts: a quarter from today.
export const DEFAULT_ACCEPTANCE_IN_DAYS: number = 90;

export const ACCEPTANCE_TOO_LONG: string = translationKey(
  "A risk can be accepted for at most a year.",
);

export const ACCEPTANCE_IN_THE_PAST: string = translationKey(
  "Pick a date in the future.",
);

export interface IssueAcceptance {
  reason: string;
  until: Date;
}

export function readIssueStatus(
  issue: DataSecurityIssue,
): DataSecurityIssueStatus {
  return (
    (issue.status as DataSecurityIssueStatus | undefined) ||
    DataSecurityIssueStatus.Open
  );
}

// Whether a move is offered for an issue where it stands.
export function isIssueMoveOffered(
  issue: DataSecurityIssue,
  move: IssueMove,
): boolean {
  const status: DataSecurityIssueStatus = readIssueStatus(issue);

  switch (move) {
    case IssueMove.Accept:
    case IssueMove.Resolve:
      return (
        status === DataSecurityIssueStatus.Open ||
        status === DataSecurityIssueStatus.Accepted
      );
    case IssueMove.NotAnIssue:
      return status !== DataSecurityIssueStatus.NotAnIssue;
    case IssueMove.Reopen:
      return status !== DataSecurityIssueStatus.Open;
  }
}

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

// What a move writes to the issue.
export function getIssueMoveWrite(
  move: IssueMove,
  acceptance?: IssueAcceptance | undefined,
): JSONObject {
  if (move === IssueMove.Accept) {
    return {
      status: DataSecurityIssueStatus.Accepted,
      acceptedReason: acceptance?.reason || "",
      acceptedUntil: acceptance
        ? OneUptimeDate.toString(acceptance.until)
        : null,
    };
  }

  return { status: ISSUE_MOVE_STATUS[move] };
}

export interface IssueAssigneePick {
  userId?: string | undefined;
  teamId?: string | undefined;
}

// A person or a team, never both: the one picked replaces the other.
export function getIssueAssignWrite(pick: IssueAssigneePick): JSONObject {
  return {
    assignedToUserId: pick.userId || null,
    assignedToTeamId: pick.userId ? null : pick.teamId || null,
  };
}

export function getDefaultAcceptedUntil(now: Date = new Date()): Date {
  return OneUptimeDate.getEndOfDay(
    OneUptimeDate.addRemoveDays(now, DEFAULT_ACCEPTANCE_IN_DAYS),
  );
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
  if (!until) {
    return ACCEPTANCE_IN_THE_PAST;
  }

  const endOfDay: Date = OneUptimeDate.getEndOfDay(until);

  if (endOfDay.getTime() <= now.getTime()) {
    return ACCEPTANCE_IN_THE_PAST;
  }

  if (
    endOfDay.getTime() >
    OneUptimeDate.getEndOfDay(
      OneUptimeDate.addRemoveDays(now, MAX_ACCEPTANCE_IN_DAYS),
    ).getTime()
  ) {
    return ACCEPTANCE_TOO_LONG;
  }

  return null;
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

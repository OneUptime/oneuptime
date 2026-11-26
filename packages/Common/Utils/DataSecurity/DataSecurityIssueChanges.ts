import DataSecurityIssue from "../../Models/DatabaseModels/DataSecurityIssue";
import OneUptimeDate from "../../Types/Date";
import DataSecurityIssueStatus from "../../Types/DataSecurity/DataSecurityIssueStatus";
import { JSONObject } from "../../Types/JSON";

/*
 * WHAT A PERSON WRITES TO A DATA SECURITY ISSUE, AS DATA (#10378).
 *
 * OneUptime opens, updates and resolves issues as its checks run; a person
 * decides what happens next: Accept Risk with a reason and a date, Mark
 * Resolved, Not an Issue with a reason, Reopen, Assign. Each is one update
 * of the issue through the API (DataSecurityIssueService), and these build
 * it. The Dashboard's buttons (Dashboard/Components/DataSecurity/
 * IssueChanges) and Ask AI's change_data_security_issue
 * (Server/Utils/AI/Toolbox/DataSecurityIssueActionTools) both write what
 * these build, so a button and the action that stands in for it cannot
 * write two different things. Pure: no words, no requests.
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

// The status each move leaves an issue in.
export const ISSUE_MOVE_STATUS: Record<IssueMove, DataSecurityIssueStatus> = {
  [IssueMove.Accept]: DataSecurityIssueStatus.Accepted,
  [IssueMove.Resolve]: DataSecurityIssueStatus.Resolved,
  [IssueMove.NotAnIssue]: DataSecurityIssueStatus.NotAnIssue,
  [IssueMove.Reopen]: DataSecurityIssueStatus.Open,
};

// The longest a risk is accepted for: the server allows a year and a day.
export const MAX_ACCEPTANCE_IN_DAYS: number = 365;

// Where Accepted Until starts: a quarter from today.
export const DEFAULT_ACCEPTANCE_IN_DAYS: number = 90;

export interface IssueAcceptance {
  reason: string;
  until: Date;
}

export interface IssueAssigneePick {
  userId?: string | undefined;
  teamId?: string | undefined;
}

export function readIssueStatus(
  issue: Pick<DataSecurityIssue, "status">,
): DataSecurityIssueStatus {
  return (
    (issue.status as DataSecurityIssueStatus | undefined) ||
    DataSecurityIssueStatus.Open
  );
}

// Whether a move is offered for an issue where it stands.
export function isIssueMoveOffered(
  issue: Pick<DataSecurityIssue, "status">,
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
 * What a move writes to the issue: Accept Risk its reason and date, Not an
 * Issue its reason (#10369) - which OneUptime AI learns from which findings
 * are noise (#10372).
 */
export function getIssueMoveWrite(
  move: IssueMove,
  acceptance?: IssueAcceptance | undefined,
  notAnIssueReason?: string | undefined,
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

  if (move === IssueMove.NotAnIssue) {
    const reason: string = (notAnIssueReason || "").trim();

    return reason
      ? { status: DataSecurityIssueStatus.NotAnIssue, notAnIssueReason: reason }
      : { status: DataSecurityIssueStatus.NotAnIssue };
  }

  return { status: ISSUE_MOVE_STATUS[move] };
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
 * Why a picked expiry will not do, or null: none was picked or it is in
 * the past, or it is more than a year away. Checked at the end of the
 * picked day, which is when the acceptance runs out - the Dashboard's
 * dialog sends that moment.
 */
export enum AcceptedUntilProblem {
  InThePast = "InThePast",
  TooLong = "TooLong",
}

export function readAcceptedUntilProblem(
  until: Date | null,
  now: Date = new Date(),
): AcceptedUntilProblem | null {
  if (!until) {
    return AcceptedUntilProblem.InThePast;
  }

  const endOfDay: Date = OneUptimeDate.getEndOfDay(until);

  if (endOfDay.getTime() <= now.getTime()) {
    return AcceptedUntilProblem.InThePast;
  }

  if (
    endOfDay.getTime() >
    OneUptimeDate.getEndOfDay(
      OneUptimeDate.addRemoveDays(now, MAX_ACCEPTANCE_IN_DAYS),
    ).getTime()
  ) {
    return AcceptedUntilProblem.TooLong;
  }

  return null;
}

import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
} from "../../Types/SecurityCase/SecurityCaseAi";
import {
  SecurityCaseAiHoldEnd,
  SecurityCaseAiHoldOutcome,
  getSecurityCaseAiHoldEnd,
} from "../../Types/SecurityCase/SecurityCaseAiHold";

/*
 * "WHAT ONEUPTIME AI DID ON SECURITY CASES THIS WEEK" (#10353): the numbers
 * of the weekly digest the project's security owners get each Monday
 * (Server/Utils/SecurityCase/SecurityCaseAiWeeklyDigest):
 *
 *   - the cases it responded first to, and how those ended: resolved with
 *     nobody alerted, handed to people, or stopped by a person;
 *   - how soon the cases it worked were contained;
 *   - the addresses it blocked, and the blocks lifted again - by a person,
 *     or by OneUptime AI dismissing a case;
 *   - what it asked people to approve, and how long they took to answer;
 *   - what a person undid of what it did.
 *
 * Over one week, by when each thing happened in it. Pure: the server reads
 * the rows.
 */

// A case of the week, as the digest reads it.
export interface SecurityCaseAiDigestCaseRow {
  createdAt: Date;
  containedAt?: Date | null | undefined;
  // OneUptime AI took the case: one it worked.
  aiTookCaseAt?: Date | null | undefined;
  aiHoldOutcome?: SecurityCaseAiHoldOutcome | string | null | undefined;
  aiHoldEndedAt?: Date | null | undefined;
}

// One of OneUptime AI's actions, as the digest reads it.
export interface SecurityCaseAiDigestActionRow {
  kind: SecurityCaseAiActionKind | string;
  status: SecurityCaseAiActionStatus | string;
  askedAt?: Date | null | undefined;
  decidedAt?: Date | null | undefined;
  doneAt?: Date | null | undefined;
  undoneAt?: Date | null | undefined;
}

export interface SecurityCaseAiWeeklyDigestNumbers {
  // The cases whose hold ended this week, by how it ended.
  casesHeld: number;
  casesResolvedWithoutPerson: number;
  casesHandedToPeople: number;
  casesStoppedByPerson: number;
  // The cases OneUptime AI worked that were contained this week, and how soon.
  casesContained: number;
  medianTimeToContainInMinutes: number | null;
  // Addresses it blocked this week, and blocks lifted again this week.
  blocksMade: number;
  blocksLifted: number;
  // What it asked people this week, how many they answered, and how fast.
  approvalsAsked: number;
  approvalsAnswered: number;
  medianApprovalWaitInMinutes: number | null;
  // What people undid of what it did, this week.
  undoneByPeople: number;
  // Anything to say: no digest is sent for a week OneUptime AI did nothing.
  hasActivity: boolean;
}

const MINUTE: number = 60 * 1000;

function isInWeek(
  at: Date | null | undefined,
  week: { start: Date; end: Date },
): boolean {
  if (!at) {
    return false;
  }

  const time: number = new Date(at).getTime();

  return time >= week.start.getTime() && time < week.end.getTime();
}

// The median of some spans, in whole minutes; null for none.
export function getMedianMinutes(spans: ReadonlyArray<number>): number | null {
  if (spans.length === 0) {
    return null;
  }

  const sorted: Array<number> = [...spans].sort((a: number, b: number) => {
    return a - b;
  });
  const middle: number = Math.floor(sorted.length / 2);
  const median: number =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;

  return Math.round(median / MINUTE);
}

function spanOf(
  from: Date | null | undefined,
  to: Date | null | undefined,
): number | null {
  if (!from || !to) {
    return null;
  }

  const span: number = new Date(to).getTime() - new Date(from).getTime();

  return span >= 0 ? span : null;
}

export function computeSecurityCaseAiWeeklyDigest(data: {
  cases: ReadonlyArray<SecurityCaseAiDigestCaseRow>;
  actions: ReadonlyArray<SecurityCaseAiDigestActionRow>;
  weekStart: Date;
  weekEnd: Date;
}): SecurityCaseAiWeeklyDigestNumbers {
  const week: { start: Date; end: Date } = {
    start: data.weekStart,
    end: data.weekEnd,
  };
  const digest: SecurityCaseAiWeeklyDigestNumbers = {
    casesHeld: 0,
    casesResolvedWithoutPerson: 0,
    casesHandedToPeople: 0,
    casesStoppedByPerson: 0,
    casesContained: 0,
    medianTimeToContainInMinutes: null,
    blocksMade: 0,
    blocksLifted: 0,
    approvalsAsked: 0,
    approvalsAnswered: 0,
    medianApprovalWaitInMinutes: null,
    undoneByPeople: 0,
    hasActivity: false,
  };

  const contains: Array<number> = [];

  for (const row of data.cases) {
    const end: SecurityCaseAiHoldEnd | null = getSecurityCaseAiHoldEnd(
      row.aiHoldOutcome,
    );

    if (end && isInWeek(row.aiHoldEndedAt, week)) {
      digest.casesHeld++;

      if (end === SecurityCaseAiHoldEnd.Resolved) {
        digest.casesResolvedWithoutPerson++;
      } else if (end === SecurityCaseAiHoldEnd.HandedToPeople) {
        digest.casesHandedToPeople++;
      } else {
        digest.casesStoppedByPerson++;
      }
    }

    if (row.aiTookCaseAt && isInWeek(row.containedAt, week)) {
      const span: number | null = spanOf(row.createdAt, row.containedAt);

      if (span !== null) {
        digest.casesContained++;
        contains.push(span);
      }
    }
  }

  const waits: Array<number> = [];

  for (const action of data.actions) {
    const isBlock: boolean =
      action.kind === SecurityCaseAiActionKind.BlockAddress;

    // A block made: done, and undone later if a person lifted it.
    if (
      isBlock &&
      (action.status === SecurityCaseAiActionStatus.Done ||
        action.status === SecurityCaseAiActionStatus.Undone) &&
      isInWeek(action.doneAt, week)
    ) {
      digest.blocksMade++;
    }

    if (
      (isBlock && isInWeek(action.undoneAt, week)) ||
      (action.kind === SecurityCaseAiActionKind.LiftBlock &&
        action.status === SecurityCaseAiActionStatus.Done &&
        isInWeek(action.doneAt, week))
    ) {
      digest.blocksLifted++;
    }

    if (isInWeek(action.askedAt, week)) {
      digest.approvalsAsked++;

      const wait: number | null = spanOf(action.askedAt, action.decidedAt);

      if (wait !== null) {
        digest.approvalsAnswered++;
        waits.push(wait);
      }
    }

    if (
      action.kind !== SecurityCaseAiActionKind.HandToPeople &&
      isInWeek(action.undoneAt, week)
    ) {
      digest.undoneByPeople++;
    }
  }

  digest.medianTimeToContainInMinutes = getMedianMinutes(contains);
  digest.medianApprovalWaitInMinutes = getMedianMinutes(waits);
  digest.hasActivity =
    digest.casesHeld > 0 ||
    digest.casesContained > 0 ||
    digest.blocksMade > 0 ||
    digest.blocksLifted > 0 ||
    digest.approvalsAsked > 0 ||
    digest.undoneByPeople > 0;

  return digest;
}

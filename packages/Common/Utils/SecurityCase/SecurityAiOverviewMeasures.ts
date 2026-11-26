import { SecurityCaseAiActionStatus } from "../../Types/SecurityCase/SecurityCaseAi";

/*
 * HOW ONEUPTIME AI WORKS THE PROJECT'S SECURITY CASES, MEASURED (#10352),
 * for Security Events -> Overview: what it resolved, how much sooner cases
 * are contained and closed with it than without, how often it asked people
 * and how long they took to answer, and how often people undid what it did
 * (the UX rulebook's principle 7: measure).
 *
 * Over the overview's case window - the cases opened in it, and OneUptime
 * AI's actions on any case in it - and only what the reader may read (the
 * route reads both with their own permissions). Pure.
 */

// A case of the window, as the measures read it.
export interface SecurityAiOverviewCaseRow {
  createdAt: Date;
  containedAt?: Date | undefined;
  closedAt?: Date | undefined;
  // OneUptime AI took the case: a case "with AI".
  aiTookCaseAt?: Date | undefined;
  // OneUptime AI closed it, on its own or approved: resolved by it.
  aiClosedAt?: Date | undefined;
}

// One of OneUptime AI's actions of the window.
export interface SecurityAiOverviewActionRow {
  status: SecurityCaseAiActionStatus | string;
  askedAt?: Date | undefined;
  decidedAt?: Date | undefined;
  undoneAt?: Date | undefined;
}

export interface SecurityAiOverviewMeasures {
  // Cases of the window OneUptime AI took on, and those it closed.
  casesWorkedByAi: number;
  casesResolvedByAi: number;
  // Mean minutes from opening, over the cases of the window that got there.
  meanTimeToContainWithAiInMinutes: number | null;
  meanTimeToContainWithoutAiInMinutes: number | null;
  meanTimeToCloseWithAiInMinutes: number | null;
  meanTimeToCloseWithoutAiInMinutes: number | null;
  // What it asked people, how many they answered, and how long that took.
  approvalsAsked: number;
  approvalsAnswered: number;
  medianTimeToAnswerInMinutes: number | null;
  // Its actions people undid.
  stepsUndone: number;
  // Anything to show: OneUptime AI worked a case, or asked, in the window.
  hasActivity: boolean;
}

const MINUTE: number = 60 * 1000;

function meanMinutes(spans: Array<number>): number | null {
  if (spans.length === 0) {
    return null;
  }

  const total: number = spans.reduce((sum: number, span: number): number => {
    return sum + span;
  }, 0);

  return Math.round(total / spans.length / MINUTE);
}

function medianMinutes(spans: Array<number>): number | null {
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

function spanOf(from: Date, to: Date | undefined): number | null {
  if (!to) {
    return null;
  }

  const span: number = new Date(to).getTime() - new Date(from).getTime();

  return span >= 0 ? span : null;
}

export function computeSecurityAiOverviewMeasures(data: {
  // The cases opened in the window.
  cases: ReadonlyArray<SecurityAiOverviewCaseRow>;
  // OneUptime AI's actions made in the window.
  actions: ReadonlyArray<SecurityAiOverviewActionRow>;
}): SecurityAiOverviewMeasures {
  const containWith: Array<number> = [];
  const containWithout: Array<number> = [];
  const closeWith: Array<number> = [];
  const closeWithout: Array<number> = [];
  let casesWorkedByAi: number = 0;
  let casesResolvedByAi: number = 0;

  for (const row of data.cases) {
    const isWithAi: boolean = Boolean(row.aiTookCaseAt);

    if (isWithAi) {
      casesWorkedByAi++;
    }

    if (row.aiClosedAt && row.closedAt) {
      casesResolvedByAi++;
    }

    const contain: number | null = spanOf(row.createdAt, row.containedAt);
    const close: number | null = spanOf(row.createdAt, row.closedAt);

    if (contain !== null) {
      (isWithAi ? containWith : containWithout).push(contain);
    }

    if (close !== null) {
      (isWithAi ? closeWith : closeWithout).push(close);
    }
  }

  const answers: Array<number> = [];
  let approvalsAsked: number = 0;
  let stepsUndone: number = 0;

  for (const action of data.actions) {
    if (action.askedAt) {
      approvalsAsked++;

      const answer: number | null = spanOf(action.askedAt, action.decidedAt);

      if (answer !== null) {
        answers.push(answer);
      }
    }

    if (
      action.status === SecurityCaseAiActionStatus.Undone ||
      action.undoneAt
    ) {
      stepsUndone++;
    }
  }

  return {
    casesWorkedByAi,
    casesResolvedByAi,
    meanTimeToContainWithAiInMinutes: meanMinutes(containWith),
    meanTimeToContainWithoutAiInMinutes: meanMinutes(containWithout),
    meanTimeToCloseWithAiInMinutes: meanMinutes(closeWith),
    meanTimeToCloseWithoutAiInMinutes: meanMinutes(closeWithout),
    approvalsAsked,
    approvalsAnswered: answers.length,
    medianTimeToAnswerInMinutes: medianMinutes(answers),
    stepsUndone,
    hasActivity: casesWorkedByAi > 0 || data.actions.length > 0,
  };
}

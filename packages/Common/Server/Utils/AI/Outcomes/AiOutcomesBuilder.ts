import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import {
  AI_OUTCOMES_WEEK_COUNT,
  AiOutcomes,
  AiOutcomesPages,
  AiOutcomesPullRequestFixes,
  AiOutcomesRemediationFixes,
  AiOutcomesRootCauses,
  AiOutcomesWeek,
} from "../../../../Types/AI/AiOutcomes";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";

/*
 * Turns the rows AiOutcomesReader read into the AI Results page's numbers
 * (Types/AI/AiOutcomes). Pure: the reader decides what the caller may see;
 * this only counts, so tests can hold every rule with plain rows.
 *
 * Every row counts in the week the work started - the page held, the fix
 * run or opened, the investigation run - so a week's numbers are what AI
 * did that week, however long its check took.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const WEEK_IN_MS: number = 7 * DAY_IN_MS;

export interface AiOutcomesPageRow {
  createdAt: Date;
  outcome: OnCallPolicyAiHoldOutcome | string | undefined;
}

export interface AiOutcomesRemediationRow {
  createdAt: Date;
  verificationStatus: AutoRemediationVerificationStatus | string | undefined;
}

export interface AiOutcomesPullRequestRow {
  createdAt: Date;
  productionStatus: FixProductionStatus | string | undefined;
}

export interface AiOutcomesInvestigationRow {
  createdAt: Date;
  autoGrade?: AIRunAutoGrade | string | undefined;
  humanVerdict?: AIRunHumanVerdict | string | undefined;
}

export interface AiOutcomesInput {
  now: Date;
  // Null: the caller may not read the kind; the page leaves it out.
  pageRows: Array<AiOutcomesPageRow> | null;
  remediationRows: Array<AiOutcomesRemediationRow> | null;
  pullRequestRows: Array<AiOutcomesPullRequestRow> | null;
  // Completed investigations of the window, judged or not.
  investigationRows: Array<AiOutcomesInvestigationRow> | null;
  isPartial: boolean;
}

// How one investigation was judged, a person's verdict before its grade.
export enum AiOutcomesJudgement {
  Confirmed = "Confirmed",
  Partial = "Partial",
  Wrong = "Wrong",
}

export default class AiOutcomesBuilder {
  /*
   * The window's first moment: AI_OUTCOMES_WEEK_COUNT whole weeks of UTC
   * days, the last of them ending with today.
   */
  public static getWindowStart(now: Date): Date {
    const startOfToday: number = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return new Date(
      startOfToday + DAY_IN_MS - AI_OUTCOMES_WEEK_COUNT * WEEK_IN_MS,
    );
  }

  // Which week of the window a moment falls in, or null outside it.
  public static getWeekIndex(windowStart: Date, time: Date): number | null {
    const offset: number = time.getTime() - windowStart.getTime();

    if (!Number.isFinite(offset) || offset < 0) {
      return null;
    }

    const index: number = Math.floor(offset / WEEK_IN_MS);

    return index < AI_OUTCOMES_WEEK_COUNT ? index : null;
  }

  public static judge(
    row: AiOutcomesInvestigationRow,
  ): AiOutcomesJudgement | null {
    if (row.humanVerdict === AIRunHumanVerdict.Confirmed) {
      return AiOutcomesJudgement.Confirmed;
    }

    if (row.humanVerdict === AIRunHumanVerdict.Rejected) {
      return AiOutcomesJudgement.Wrong;
    }

    if (row.autoGrade === AIRunAutoGrade.Match) {
      return AiOutcomesJudgement.Confirmed;
    }

    if (row.autoGrade === AIRunAutoGrade.Partial) {
      return AiOutcomesJudgement.Partial;
    }

    if (row.autoGrade === AIRunAutoGrade.Mismatch) {
      return AiOutcomesJudgement.Wrong;
    }

    return null;
  }

  public static build(input: AiOutcomesInput): AiOutcomes {
    const windowStart: Date = this.getWindowStart(input.now);
    const weeks: Array<AiOutcomesWeek> = [];

    for (let index: number = 0; index < AI_OUTCOMES_WEEK_COUNT; index++) {
      weeks.push({
        weekStart: new Date(windowStart.getTime() + index * WEEK_IN_MS)
          .toISOString()
          .substring(0, 10),
        pagesAvoided: 0,
        pagesHeld: 0,
        fixesVerified: 0,
        fixesChecked: 0,
        rootCausesConfirmed: 0,
        rootCausesJudged: 0,
      });
    }

    const weekOf: (createdAt: Date) => AiOutcomesWeek | null = (
      createdAt: Date,
    ): AiOutcomesWeek | null => {
      const index: number | null = this.getWeekIndex(
        windowStart,
        new Date(createdAt),
      );
      return index === null ? null : weeks[index]!;
    };

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: new Date(input.now).toISOString(),
      pages: input.pageRows ? this.countPages(input.pageRows, weekOf) : null,
      remediationFixes: input.remediationRows
        ? this.countRemediationFixes(input.remediationRows, weekOf)
        : null,
      pullRequestFixes: input.pullRequestRows
        ? this.countPullRequestFixes(input.pullRequestRows, weekOf)
        : null,
      rootCauses: input.investigationRows
        ? this.countRootCauses(input.investigationRows, weekOf)
        : null,
      weeks,
      isPartial: input.isPartial,
    };
  }

  private static countPages(
    rows: Array<AiOutcomesPageRow>,
    weekOf: (createdAt: Date) => AiOutcomesWeek | null,
  ): AiOutcomesPages {
    const pages: AiOutcomesPages = {
      resolvedByAi: 0,
      recoveredOnItsOwn: 0,
      handledByPerson: 0,
      handedOff: 0,
      holdTimeRanOut: 0,
      pageNowPressed: 0,
      holding: 0,
    };

    for (const row of rows) {
      const week: AiOutcomesWeek | null = weekOf(row.createdAt);

      if (!week) {
        continue;
      }

      switch (row.outcome) {
        case OnCallPolicyAiHoldOutcome.Holding:
          pages.holding++;
          continue;
        case OnCallPolicyAiHoldOutcome.ResolvedByAI:
          pages.resolvedByAi++;
          week.pagesAvoided++;
          break;
        case OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn:
          pages.recoveredOnItsOwn++;
          break;
        case OnCallPolicyAiHoldOutcome.HandledByPerson:
          pages.handledByPerson++;
          break;
        case OnCallPolicyAiHoldOutcome.HandedOff:
          pages.handedOff++;
          break;
        case OnCallPolicyAiHoldOutcome.HoldTimeRanOut:
          pages.holdTimeRanOut++;
          break;
        case OnCallPolicyAiHoldOutcome.PageNowPressed:
          pages.pageNowPressed++;
          break;
        default:
          // A value this server does not know: not counted at all.
          continue;
      }

      week.pagesHeld++;
    }

    return pages;
  }

  private static countRemediationFixes(
    rows: Array<AiOutcomesRemediationRow>,
    weekOf: (createdAt: Date) => AiOutcomesWeek | null,
  ): AiOutcomesRemediationFixes {
    const fixes: AiOutcomesRemediationFixes = {
      verified: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
    };

    for (const row of rows) {
      const week: AiOutcomesWeek | null = weekOf(row.createdAt);

      if (!week) {
        continue;
      }

      switch (row.verificationStatus) {
        case AutoRemediationVerificationStatus.Verified:
          fixes.verified++;
          week.fixesVerified++;
          week.fixesChecked++;
          break;
        case AutoRemediationVerificationStatus.Failed:
          fixes.failed++;
          week.fixesChecked++;
          break;
        case AutoRemediationVerificationStatus.Pending:
          fixes.pending++;
          break;
        case AutoRemediationVerificationStatus.Skipped:
          fixes.skipped++;
          break;
        default:
          break;
      }
    }

    return fixes;
  }

  private static countPullRequestFixes(
    rows: Array<AiOutcomesPullRequestRow>,
    weekOf: (createdAt: Date) => AiOutcomesWeek | null,
  ): AiOutcomesPullRequestFixes {
    const fixes: AiOutcomesPullRequestFixes = {
      verified: 0,
      regressed: 0,
      watching: 0,
      awaitingDeploy: 0,
      unverifiable: 0,
    };

    for (const row of rows) {
      const week: AiOutcomesWeek | null = weekOf(row.createdAt);

      if (!week) {
        continue;
      }

      switch (row.productionStatus) {
        case FixProductionStatus.Verified:
          fixes.verified++;
          week.fixesVerified++;
          week.fixesChecked++;
          break;
        case FixProductionStatus.Regressed:
          fixes.regressed++;
          week.fixesChecked++;
          break;
        case FixProductionStatus.Watching:
          fixes.watching++;
          break;
        case FixProductionStatus.AwaitingDeploy:
          fixes.awaitingDeploy++;
          break;
        case FixProductionStatus.Unverifiable:
          fixes.unverifiable++;
          break;
        default:
          break;
      }
    }

    return fixes;
  }

  private static countRootCauses(
    rows: Array<AiOutcomesInvestigationRow>,
    weekOf: (createdAt: Date) => AiOutcomesWeek | null,
  ): AiOutcomesRootCauses {
    const rootCauses: AiOutcomesRootCauses = {
      confirmed: 0,
      partial: 0,
      wrong: 0,
      judgedByPeople: 0,
      completed: 0,
    };

    for (const row of rows) {
      const week: AiOutcomesWeek | null = weekOf(row.createdAt);

      if (!week) {
        continue;
      }

      rootCauses.completed++;

      const judgement: AiOutcomesJudgement | null = this.judge(row);

      if (!judgement) {
        continue;
      }

      week.rootCausesJudged++;

      if (
        row.humanVerdict === AIRunHumanVerdict.Confirmed ||
        row.humanVerdict === AIRunHumanVerdict.Rejected
      ) {
        rootCauses.judgedByPeople++;
      }

      if (judgement === AiOutcomesJudgement.Confirmed) {
        rootCauses.confirmed++;
        week.rootCausesConfirmed++;
      } else if (judgement === AiOutcomesJudgement.Partial) {
        rootCauses.partial++;
      } else {
        rootCauses.wrong++;
      }
    }

    return rootCauses;
  }
}

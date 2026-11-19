import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import {
  AI_OUTCOMES_UNKNOWN_MODEL,
  AI_OUTCOMES_WEEK_COUNT,
  AiOutcomes,
  AiOutcomesModelChange,
  AiOutcomesModelResult,
  AiOutcomesModels,
  AiOutcomesPages,
  AiOutcomesPullRequestFixes,
  AiOutcomesRemediationFixes,
  AiOutcomesRootCauseOutcome,
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
 *
 * Each row counts under one outcome, the key its count has in its part's
 * counts (getPageOutcome and the others): the records a number opens are
 * the rows of its outcome (AiOutcomesReader.readRecords, #7768), so a
 * number and its list are one rule. And investigations and the fixes that
 * came from them are counted by the model that wrote the investigation's
 * answer (models, #7762).
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const WEEK_IN_MS: number = 7 * DAY_IN_MS;

export interface AiOutcomesPageRow {
  createdAt: Date;
  outcome: OnCallPolicyAiHoldOutcome | string | undefined;
}

/*
 * The incident or alert a row is about, as one key ("incident:<id>",
 * "alert:<id>"): how a fix finds the investigation it came from.
 */
export type AiOutcomesSubjectKey = string;

export interface AiOutcomesRemediationRow {
  createdAt: Date;
  verificationStatus: AutoRemediationVerificationStatus | string | undefined;
  subjectKey?: AiOutcomesSubjectKey | undefined;
}

export interface AiOutcomesPullRequestRow {
  createdAt: Date;
  productionStatus: FixProductionStatus | string | undefined;
  // The incident or alert its fix task was for, when it was for one.
  subjectKey?: AiOutcomesSubjectKey | undefined;
  /*
   * When its fix task started, which comes after the investigation it was
   * written from; the pull request's own date when unknown.
   */
  fixStartedAt?: Date | undefined;
}

export interface AiOutcomesInvestigationRow {
  createdAt: Date;
  autoGrade?: AIRunAutoGrade | string | undefined;
  humanVerdict?: AIRunHumanVerdict | string | undefined;
  // The model that wrote its answer; none before OneUptime recorded it.
  modelName?: string | undefined;
  subjectKey?: AiOutcomesSubjectKey | undefined;
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
  /*
   * Whether the caller may read the project's AI Logs, where each call's
   * model is listed: without it, models is null and the page names none.
   */
  canReadModels?: boolean | undefined;
}

export function getSubjectKey(
  incidentId: { toString(): string } | null | undefined,
  alertId: { toString(): string } | null | undefined,
): AiOutcomesSubjectKey | undefined {
  // A row about an incident is about the incident, alert or not.
  if (incidentId) {
    return `incident:${incidentId.toString()}`;
  }

  if (alertId) {
    return `alert:${alertId.toString()}`;
  }

  return undefined;
}

// How one investigation was judged, a person's verdict before its grade.
export enum AiOutcomesJudgement {
  Confirmed = "Confirmed",
  Partial = "Partial",
  Wrong = "Wrong",
}

// Finds the investigation a fix came from (getSourceInvestigationFinder).
type SourceInvestigationFinder = (
  subjectKey: AiOutcomesSubjectKey | undefined,
  fixStartedAt: Date,
) => AiOutcomesInvestigationRow | null;

function getModelName(row: AiOutcomesInvestigationRow): string {
  return (row.modelName || "").trim() || AI_OUTCOMES_UNKNOWN_MODEL;
}

// What went well and what was counted, model by model.
class ModelTally {
  private readonly results: Map<string, AiOutcomesModelResult> = new Map();

  public add(modelName: string, wentWell: boolean): void {
    const result: AiOutcomesModelResult = this.results.get(modelName) || {
      modelName,
      value: 0,
      total: 0,
    };

    result.total++;

    if (wentWell) {
      result.value++;
    }

    this.results.set(modelName, result);
  }

  // The most counted first, by name among equals; work with no model last.
  public getResults(): Array<AiOutcomesModelResult> {
    return Array.from(this.results.values()).sort(
      (a: AiOutcomesModelResult, b: AiOutcomesModelResult): number => {
        const aIsUnknown: boolean = a.modelName === AI_OUTCOMES_UNKNOWN_MODEL;
        const bIsUnknown: boolean = b.modelName === AI_OUTCOMES_UNKNOWN_MODEL;

        if (aIsUnknown !== bIsUnknown) {
          return aIsUnknown ? 1 : -1;
        }

        return b.total - a.total || a.modelName.localeCompare(b.modelName);
      },
    );
  }
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

  // Whether a moment falls in the window that ends at `now`.
  public static isInWindow(now: Date, time: Date): boolean {
    return this.getWeekIndex(this.getWindowStart(now), new Date(time)) !== null;
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

  /*
   * ------------------------------------------------------------------------
   * The outcome each row counts under: its key in its part's counts, or
   * null for a row its part does not count (a value this server does not
   * know, an investigation nobody judged). Counting and the records a
   * number opens both go by these.
   * ------------------------------------------------------------------------
   */

  public static getPageOutcome(
    row: Pick<AiOutcomesPageRow, "outcome">,
  ): keyof AiOutcomesPages | null {
    switch (row.outcome) {
      case OnCallPolicyAiHoldOutcome.Holding:
        return "holding";
      case OnCallPolicyAiHoldOutcome.ResolvedByAI:
        return "resolvedByAi";
      case OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn:
        return "recoveredOnItsOwn";
      case OnCallPolicyAiHoldOutcome.HandledByPerson:
        return "handledByPerson";
      case OnCallPolicyAiHoldOutcome.HandedOff:
        return "handedOff";
      case OnCallPolicyAiHoldOutcome.HoldTimeRanOut:
        return "holdTimeRanOut";
      case OnCallPolicyAiHoldOutcome.PageNowPressed:
        return "pageNowPressed";
      default:
        return null;
    }
  }

  public static getRemediationOutcome(
    row: Pick<AiOutcomesRemediationRow, "verificationStatus">,
  ): keyof AiOutcomesRemediationFixes | null {
    switch (row.verificationStatus) {
      case AutoRemediationVerificationStatus.Verified:
        return "verified";
      case AutoRemediationVerificationStatus.Failed:
        return "failed";
      case AutoRemediationVerificationStatus.Pending:
        return "pending";
      case AutoRemediationVerificationStatus.Skipped:
        return "skipped";
      default:
        return null;
    }
  }

  public static getPullRequestOutcome(
    row: Pick<AiOutcomesPullRequestRow, "productionStatus">,
  ): keyof AiOutcomesPullRequestFixes | null {
    switch (row.productionStatus) {
      case FixProductionStatus.Verified:
        return "verified";
      case FixProductionStatus.Regressed:
        return "regressed";
      case FixProductionStatus.Watching:
        return "watching";
      case FixProductionStatus.AwaitingDeploy:
        return "awaitingDeploy";
      case FixProductionStatus.Unverifiable:
        return "unverifiable";
      default:
        return null;
    }
  }

  public static getRootCauseOutcome(
    row: AiOutcomesInvestigationRow,
  ): AiOutcomesRootCauseOutcome | null {
    switch (this.judge(row)) {
      case AiOutcomesJudgement.Confirmed:
        return "confirmed";
      case AiOutcomesJudgement.Partial:
        return "partial";
      case AiOutcomesJudgement.Wrong:
        return "wrong";
      default:
        return null;
    }
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
      models: input.canReadModels
        ? this.countModels({
            investigationRows: input.investigationRows || [],
            remediationRows: input.remediationRows || [],
            pullRequestRows: input.pullRequestRows || [],
            weekOf,
          })
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
      // A value this server does not know: not counted at all.
      const outcome: keyof AiOutcomesPages | null = this.getPageOutcome(row);

      if (!week || !outcome) {
        continue;
      }

      pages[outcome]++;

      // Still held: counted as held, in no week yet.
      if (outcome === "holding") {
        continue;
      }

      week.pagesHeld++;

      if (outcome === "resolvedByAi") {
        week.pagesAvoided++;
      }
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
      const outcome: keyof AiOutcomesRemediationFixes | null =
        this.getRemediationOutcome(row);

      if (!week || !outcome) {
        continue;
      }

      fixes[outcome]++;

      if (outcome === "verified" || outcome === "failed") {
        week.fixesChecked++;
      }

      if (outcome === "verified") {
        week.fixesVerified++;
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
      const outcome: keyof AiOutcomesPullRequestFixes | null =
        this.getPullRequestOutcome(row);

      if (!week || !outcome) {
        continue;
      }

      fixes[outcome]++;

      if (outcome === "verified" || outcome === "regressed") {
        week.fixesChecked++;
      }

      if (outcome === "verified") {
        week.fixesVerified++;
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

  /*
   * ------------------------------------------------------------------------
   * By model (#7762).
   * ------------------------------------------------------------------------
   */

  private static countModels(data: {
    investigationRows: Array<AiOutcomesInvestigationRow>;
    remediationRows: Array<AiOutcomesRemediationRow>;
    pullRequestRows: Array<AiOutcomesPullRequestRow>;
    weekOf: (createdAt: Date) => AiOutcomesWeek | null;
  }): AiOutcomesModels {
    const investigations: Array<AiOutcomesInvestigationRow> =
      data.investigationRows.filter(
        (row: AiOutcomesInvestigationRow): boolean => {
          return Boolean(data.weekOf(row.createdAt));
        },
      );

    // Root Causes Confirmed: confirmed of judged, by each one's model.
    const rootCauses: ModelTally = new ModelTally();

    for (const row of investigations) {
      const outcome: AiOutcomesRootCauseOutcome | null =
        this.getRootCauseOutcome(row);

      if (outcome) {
        rootCauses.add(getModelName(row), outcome === "confirmed");
      }
    }

    /*
     * Fixes Verified: verified of checked, for the fixes that came from an
     * investigation, by its model.
     */
    const sourceOf: SourceInvestigationFinder =
      this.getSourceInvestigationFinder(investigations);
    const fixes: ModelTally = new ModelTally();

    for (const row of data.remediationRows) {
      const outcome: keyof AiOutcomesRemediationFixes | null =
        this.getRemediationOutcome(row);
      const source: AiOutcomesInvestigationRow | null = sourceOf(
        row.subjectKey,
        row.createdAt,
      );

      if (
        data.weekOf(row.createdAt) &&
        source &&
        (outcome === "verified" || outcome === "failed")
      ) {
        fixes.add(getModelName(source), outcome === "verified");
      }
    }

    for (const row of data.pullRequestRows) {
      const outcome: keyof AiOutcomesPullRequestFixes | null =
        this.getPullRequestOutcome(row);
      const source: AiOutcomesInvestigationRow | null = sourceOf(
        row.subjectKey,
        row.fixStartedAt || row.createdAt,
      );

      if (
        data.weekOf(row.createdAt) &&
        source &&
        (outcome === "verified" || outcome === "regressed")
      ) {
        fixes.add(getModelName(source), outcome === "verified");
      }
    }

    return {
      rootCauses: rootCauses.getResults(),
      fixes: fixes.getResults(),
      changes: this.getModelChanges(investigations, data.weekOf),
    };
  }

  /*
   * The investigation a fix came from: the latest one of its incident or
   * alert that started before the fix did. AI SRE hands an incident or
   * alert to its fixes once its investigation settles, and a fix task is
   * written from its latest investigation (FixFromIncidentTaskTrigger). A
   * fix with no such investigation on the page did not come from one.
   */
  private static getSourceInvestigationFinder(
    investigations: Array<AiOutcomesInvestigationRow>,
  ): SourceInvestigationFinder {
    const bySubject: Map<
      AiOutcomesSubjectKey,
      Array<AiOutcomesInvestigationRow>
    > = new Map();

    for (const row of investigations) {
      if (!row.subjectKey) {
        continue;
      }

      const rows: Array<AiOutcomesInvestigationRow> =
        bySubject.get(row.subjectKey) || [];
      rows.push(row);
      bySubject.set(row.subjectKey, rows);
    }

    return (
      subjectKey: AiOutcomesSubjectKey | undefined,
      fixStartedAt: Date,
    ): AiOutcomesInvestigationRow | null => {
      const startedAt: number = new Date(fixStartedAt).getTime();
      let source: AiOutcomesInvestigationRow | null = null;

      for (const row of (subjectKey && bySubject.get(subjectKey)) || []) {
        const createdAt: number = new Date(row.createdAt).getTime();

        if (
          createdAt <= startedAt &&
          (!source || createdAt > new Date(source.createdAt).getTime())
        ) {
          source = row;
        }
      }

      return source;
    };
  }

  /*
   * The weeks OneUptime AI's investigations changed model: a week whose
   * main model - the one that ran most of its investigations - is not the
   * main model of the last week before it that had one. A project's switch
   * of its provider or its model shows in the week it took effect, and a
   * switch back shows too; an AI rule that sends a few investigations
   * elsewhere does not. Investigations with no model recorded say nothing
   * either way, so the week OneUptime started recording is no change.
   */
  private static getModelChanges(
    investigations: Array<AiOutcomesInvestigationRow>,
    weekOf: (createdAt: Date) => AiOutcomesWeek | null,
  ): Array<AiOutcomesModelChange> {
    const countsByWeek: Map<AiOutcomesWeek, Map<string, number>> = new Map();

    for (const row of investigations) {
      const modelName: string = getModelName(row);
      const week: AiOutcomesWeek | null = weekOf(row.createdAt);

      if (!week || modelName === AI_OUTCOMES_UNKNOWN_MODEL) {
        continue;
      }

      const counts: Map<string, number> = countsByWeek.get(week) || new Map();
      counts.set(modelName, (counts.get(modelName) || 0) + 1);
      countsByWeek.set(week, counts);
    }

    const weeks: Array<AiOutcomesWeek> = Array.from(countsByWeek.keys()).sort(
      (a: AiOutcomesWeek, b: AiOutcomesWeek): number => {
        return a.weekStart.localeCompare(b.weekStart);
      },
    );

    const changes: Array<AiOutcomesModelChange> = [];
    let previous: string | null = null;

    for (const week of weeks) {
      const counts: Map<string, number> = countsByWeek.get(week)!;
      const most: number = Math.max(...Array.from(counts.values()));
      const leaders: Array<string> = Array.from(counts.keys())
        .filter((modelName: string): boolean => {
          return counts.get(modelName) === most;
        })
        .sort();
      // A tie keeps the model the weeks before ran on, when it is one of them.
      const main: string =
        previous !== null && leaders.includes(previous)
          ? previous
          : leaders[0]!;

      if (previous !== null && main !== previous) {
        changes.push({ weekStart: week.weekStart, modelName: main });
      }

      previous = main;
    }

    return changes;
  }
}

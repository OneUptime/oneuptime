import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  INCIDENT_ALERT_AI_INSIGHTS_HOTSPOT_MIN,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_ATTENTION_ITEMS,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_HOTSPOTS,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEMS,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEM_MONITORS,
  INCIDENT_ALERT_AI_INSIGHTS_RECENT_WINDOW_IN_DAYS,
  INCIDENT_ALERT_AI_INSIGHTS_RECURRING_ATTENTION_MIN,
  INCIDENT_ALERT_AI_INSIGHTS_RECURRING_MIN,
  IncidentAlertAiAttentionItem,
  IncidentAlertAiAttentionKind,
  IncidentAlertAiAttentionSeverity,
  IncidentAlertAiCoverage,
  IncidentAlertAiFinding,
  IncidentAlertAiFixOutcomes,
  IncidentAlertAiFixTaskOutcomes,
  IncidentAlertAiHotspot,
  IncidentAlertAiInsights,
  IncidentAlertAiInsightsSubject,
  IncidentAlertAiInsightsTotals,
  IncidentAlertAiNamedResource,
  IncidentAlertAiProblem,
  IncidentAlertAiTrendDay,
  IncidentAlertAiVerdictTotals,
} from "../../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../../Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../../Types/JSON";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

/*
 * The pure half of the AI Insights page of the Incidents and Alerts menus:
 * from the rows IncidentAlertAiInsightsReader gathered, what OneUptime AI
 * learned across the product's incidents (or alerts) and what deserves
 * attention (IncidentAlertAiInsights). No I/O, no clock of its own, no
 * model: the same input always gives the same insights, which is what the
 * suites pin.
 *
 * How it reads the rows:
 *
 *   - A problem is what raised the incidents AI investigated: their
 *     monitors (one problem however many hosts or pods a monitor fired for),
 *     else - for one no monitor raised - its title without the series
 *     identity alerts append. Investigated at least
 *     INCIDENT_ALERT_AI_INSIGHTS_RECURRING_MIN times in the window, a problem
 *     is recurring.
 *   - A finding is the newest completed investigation's TL;DR, else the
 *     next older one that has one.
 *   - The monitors and services that keep failing are the ones the
 *     investigated incidents were raised for or affected, counted once per
 *     incident; only those the caller may read are named.
 *   - Every row handed in is about an incident the caller may read: the
 *     reader leaves the others out.
 *
 * The grouping, findings, fix outcomes, trend and attention follow a
 * cluster's and a resource's AI Insights (their builder lives with them):
 * the same rules over the product's own rows.
 */

// The incident or alert a row is about, as the reader read it.
export interface IncidentAlertAiSubjectInput {
  id: string;
  // When it was created: coverage counts the window's own.
  createdAt?: Date | undefined;
  title?: string | undefined;
  number?: number | undefined;
  numberWithPrefix?: string | undefined;
  seriesLabels?: JSONObject | undefined;
  // What raised it: an alert's monitor, an incident's monitors.
  monitorIds: Array<string>;
  // The services it affected.
  serviceIds: Array<string>;
}

export interface IncidentAlertAiInvestigationInput {
  aiRunId: string;
  // AIRunStatus.
  status?: string | undefined;
  createdAt: Date;
  completedAt?: Date | undefined;
  tldr?: string | undefined;
  // AIRunHumanVerdict and AIRunAutoGrade.
  humanVerdict?: string | undefined;
  autoGrade?: string | undefined;
  subjectId: string;
}

export interface IncidentAlertAiFixInput {
  id: string;
  // AutoRemediationSuggestionStatus and AutoRemediationVerificationStatus.
  status?: string | undefined;
  verificationStatus?: string | undefined;
  createdAt: Date;
  subjectId: string;
}

export interface IncidentAlertAiFixTaskInput {
  id: string;
  // AIRunStatus.
  status?: string | undefined;
  createdAt: Date;
  subjectId: string;
}

export interface IncidentAlertAiCommandStats {
  total: number;
  failed: number;
  timedOut: number;
}

export interface IncidentAlertAiInsightsInput {
  subjectKind: IncidentAlertAiSubjectKind;
  now: Date;
  windowInDays: number;
  investigations: Array<IncidentAlertAiInvestigationInput>;
  // Null when the caller may not read fixes.
  fixes: Array<IncidentAlertAiFixInput> | null;
  fixTasks: Array<IncidentAlertAiFixTaskInput>;
  // The incidents (or alerts) the rows are about, by id.
  subjects: Map<string, IncidentAlertAiSubjectInput>;
  // The monitors and services the caller may read, by id.
  monitorNames: Map<string, string>;
  serviceNames: Map<string, string>;
  commands: IncidentAlertAiCommandStats;
  // The window's incidents (or alerts) the caller may read.
  subjectsInWindow: number;
  // Why each skipped one was not investigated, by its id.
  notInvestigatedReasons: Map<string, InvestigationNotStartedCode>;
  // The reader could not read everything the window held.
  isPartial: boolean;
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const FAILED_RUN_STATUSES: ReadonlyArray<string> = [
  AIRunStatus.Error,
  AIRunStatus.Stale,
];

const ACTIVE_RUN_STATUSES: ReadonlyArray<string> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
  AIRunStatus.WaitingForApproval,
];

const APPLIED_FIX_STATUSES: ReadonlyArray<string> = [
  AutoRemediationSuggestionStatus.Approved,
  AutoRemediationSuggestionStatus.AutoExecuted,
];

/*
 * Why an incident was not investigated, and how much it deserves a look: a
 * reason that blocks AI everywhere (no provider, no credits, a limit spent,
 * AI or automatic investigation turned off) is worth acting on; one that is
 * the settings doing their job (below the severity floor, inside the
 * cooldown) is not.
 */
const NOT_STARTED_SEVERITY: Partial<
  Record<InvestigationNotStartedCode, IncidentAlertAiAttentionSeverity>
> = {
  provider_missing: IncidentAlertAiAttentionSeverity.High,
  insufficient_ai_balance: IncidentAlertAiAttentionSeverity.High,
  daily_budget_exhausted: IncidentAlertAiAttentionSeverity.High,
  budget_check_failed: IncidentAlertAiAttentionSeverity.Medium,
  enqueue_failed: IncidentAlertAiAttentionSeverity.Medium,
  eligibility_check_failed: IncidentAlertAiAttentionSeverity.Medium,
  ai_disabled: IncidentAlertAiAttentionSeverity.Medium,
  automatic_investigation_disabled: IncidentAlertAiAttentionSeverity.Low,
};

const SEVERITY_RANK: Record<IncidentAlertAiAttentionSeverity, number> = {
  [IncidentAlertAiAttentionSeverity.High]: 0,
  [IncidentAlertAiAttentionSeverity.Medium]: 1,
  [IncidentAlertAiAttentionSeverity.Low]: 2,
};

const KIND_RANK: Record<IncidentAlertAiAttentionKind, number> = {
  [IncidentAlertAiAttentionKind.FixesFailed]: 0,
  [IncidentAlertAiAttentionKind.InvestigationsNotStarted]: 1,
  [IncidentAlertAiAttentionKind.RecurringProblem]: 2,
  [IncidentAlertAiAttentionKind.FixesAwaitingApproval]: 3,
  [IncidentAlertAiAttentionKind.InvestigationsFailed]: 4,
  [IncidentAlertAiAttentionKind.CommandsTimedOut]: 5,
  [IncidentAlertAiAttentionKind.FindingsRejected]: 6,
  [IncidentAlertAiAttentionKind.MonitorHotspot]: 7,
};

// The investigations of one problem, as the builder collects them.
interface ProblemGroup {
  key: string;
  // Newest first.
  runs: Array<IncidentAlertAiInvestigationInput>;
}

interface HotspotCount {
  id: string;
  subjectIds: Set<string>;
  investigationCount: number;
  problemKeys: Set<string>;
  lastSeen: Date;
}

function toIso(date: Date | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function newestFirst<T extends { createdAt: Date }>(rows: Array<T>): Array<T> {
  return [...rows].sort((a: T, b: T): number => {
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/*
 * A problem's key as it leaves the server: stable for the same grouping,
 * but opaque - the monitor ids it groups by are not the caller's to read.
 * (FNV-1a, 32 bits: plenty for the few hundred problems of one window.)
 */
export function toPublicProblemKey(groupKey: string): string {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < groupKey.length; index++) {
    hash ^= groupKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `problem-${hash.toString(16).padStart(8, "0")}`;
}

export default class IncidentAlertAiInsightsBuilder {
  /*
   * The first day of a window of `windowInDays` UTC days that ends today:
   * the reader reads rows from here on, and the trend starts here.
   */
  public static getWindowStart(now: Date, windowInDays: number): Date {
    const today: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    return new Date(
      today.getTime() - (Math.max(windowInDays, 1) - 1) * DAY_IN_MS,
    );
  }

  /*
   * A title without the series identity a monitor appended to it
   * (" - Pod: web-1 | Namespace: shop"), so the same problem reads the same
   * for every pod it fired for. Only a suffix made entirely of this
   * subject's own "Name: value" labels is taken off; anything else - a
   * user's own template, a title that merely contains " - " - is left as
   * written.
   */
  public static stripSeriesIdentity(
    title: string,
    seriesLabels: JSONObject | undefined,
  ): string {
    const text: string = (title || "").trim();
    const labels: Array<DisplaySeriesLabel> =
      SeriesLabelDisplay.getDisplayLabels(seriesLabels);

    if (!text || labels.length === 0) {
      return text;
    }

    const separatorAt: number = text.lastIndexOf(" - ");

    if (separatorAt <= 0) {
      return text;
    }

    const parts: Array<string> = text
      .slice(separatorAt + " - ".length)
      .split(" | ");

    const isIdentity: boolean = parts.every((part: string): boolean => {
      const colonAt: number = part.indexOf(": ");

      if (colonAt <= 0) {
        return false;
      }

      const name: string = part.slice(0, colonAt);
      const value: string = part.slice(colonAt + ": ".length);

      return labels.some((label: DisplaySeriesLabel): boolean => {
        if (label.name !== name) {
          return false;
        }

        // Long values are shown by their end: "...7d9f-2xk".
        return (
          label.value === value ||
          (value.startsWith("...") &&
            value.length > "...".length &&
            label.value.endsWith(value.slice("...".length)))
        );
      });
    });

    return isIdentity ? text.slice(0, separatorAt).trim() : text;
  }

  /*
   * What groups a subject with the others: the monitor that raised it, or
   * (several monitors) all of them, or - nothing raised it - its title.
   */
  public static getProblemKey(subject: IncidentAlertAiSubjectInput): string {
    const monitorIds: Array<string> = Array.from(
      new Set<string>(
        subject.monitorIds.filter((id: string): boolean => {
          return Boolean(id);
        }),
      ),
    ).sort();

    if (monitorIds.length > 0) {
      return `monitor:${monitorIds.join(",")}`;
    }

    const title: string = this.stripSeriesIdentity(
      subject.title || "",
      subject.seriesLabels,
    )
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    // Nothing to group an untitled subject with: it is a problem of its own.
    return title ? `title:${title}` : `subject:${subject.id}`;
  }

  public static toSubject(
    subjectKind: IncidentAlertAiSubjectKind,
    input: IncidentAlertAiSubjectInput,
  ): IncidentAlertAiInsightsSubject {
    return {
      kind: subjectKind,
      id: input.id,
      ...(input.title ? { title: input.title } : {}),
      ...(input.number !== undefined ? { number: input.number } : {}),
      ...(input.numberWithPrefix
        ? { numberWithPrefix: input.numberWithPrefix }
        : {}),
    };
  }

  public static build(
    input: IncidentAlertAiInsightsInput,
  ): IncidentAlertAiInsights {
    const windowStart: Date = this.getWindowStart(
      input.now,
      input.windowInDays,
    );
    const isInWindow: (row: {
      createdAt: Date;
      subjectId: string;
    }) => boolean = (row: { createdAt: Date; subjectId: string }): boolean => {
      return (
        row.createdAt.getTime() >= windowStart.getTime() &&
        input.subjects.has(row.subjectId)
      );
    };

    const runs: Array<IncidentAlertAiInvestigationInput> = newestFirst(
      input.investigations.filter(isInWindow),
    );
    const fixes: Array<IncidentAlertAiFixInput> | null = input.fixes
      ? newestFirst(input.fixes.filter(isInWindow))
      : null;
    const fixTasks: Array<IncidentAlertAiFixTaskInput> = newestFirst(
      input.fixTasks.filter(isInWindow),
    );

    const groups: Array<ProblemGroup> = this.groupProblems(input, runs);
    const problems: Array<IncidentAlertAiProblem> = groups.map(
      (group: ProblemGroup): IncidentAlertAiProblem => {
        return this.buildProblem(group, fixes || [], input);
      },
    );

    const monitors: Array<IncidentAlertAiHotspot> = this.buildHotspots({
      runs,
      groups,
      input,
      idsOf: (subject: IncidentAlertAiSubjectInput): Array<string> => {
        return subject.monitorIds;
      },
      names: input.monitorNames,
    });
    const services: Array<IncidentAlertAiHotspot> = this.buildHotspots({
      runs,
      groups,
      input,
      idsOf: (subject: IncidentAlertAiSubjectInput): Array<string> => {
        return subject.serviceIds;
      },
      names: input.serviceNames,
    });

    const investigatedSubjects: Set<string> = new Set<string>(
      runs.map((run: IncidentAlertAiInvestigationInput): string => {
        return run.subjectId;
      }),
    );

    const coverage: IncidentAlertAiCoverage = this.buildCoverage({
      input,
      windowStart,
      investigatedSubjects,
    });

    const totals: IncidentAlertAiInsightsTotals = {
      investigations: runs.length,
      completedInvestigations: runs.filter(
        (run: IncidentAlertAiInvestigationInput): boolean => {
          return run.status === AIRunStatus.Completed;
        },
      ).length,
      failedInvestigations: runs.filter(
        (run: IncidentAlertAiInvestigationInput): boolean => {
          return FAILED_RUN_STATUSES.includes(run.status || "");
        },
      ).length,
      activeInvestigations: runs.filter(
        (run: IncidentAlertAiInvestigationInput): boolean => {
          return ACTIVE_RUN_STATUSES.includes(run.status || "");
        },
      ).length,
      problems: problems.length,
      recurringProblems: problems.filter(
        (problem: IncidentAlertAiProblem): boolean => {
          return problem.isRecurring;
        },
      ).length,
      fixes: fixes ? fixes.length : null,
      fixTasks: fixTasks.length,
      commands: Math.max(input.commands.total, 0),
      failedCommands: Math.max(input.commands.failed, 0),
      timedOutCommands: Math.max(input.commands.timedOut, 0),
    };

    return {
      subjectKind: input.subjectKind,
      windowInDays: input.windowInDays,
      windowStart: windowStart.toISOString(),
      generatedAt: input.now.toISOString(),
      totals,
      coverage,
      attention: this.buildAttention({
        input,
        runs,
        fixes,
        groups,
        problems,
        monitors,
        totals,
        coverage,
      }),
      problems: problems.slice(0, INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEMS),
      monitors: monitors.slice(0, INCIDENT_ALERT_AI_INSIGHTS_MAX_HOTSPOTS),
      services: services.slice(0, INCIDENT_ALERT_AI_INSIGHTS_MAX_HOTSPOTS),
      fixOutcomes: fixes ? this.buildFixOutcomes(fixes) : null,
      fixTaskOutcomes: this.buildFixTaskOutcomes(fixTasks),
      verdicts: this.buildVerdicts(runs),
      trend: this.buildTrend({ windowStart, input, runs, fixes: fixes || [] }),
      isPartial: input.isPartial,
    };
  }

  // Every problem of the window, most investigated first, then newest.
  public static groupProblems(
    input: IncidentAlertAiInsightsInput,
    runs: Array<IncidentAlertAiInvestigationInput>,
  ): Array<ProblemGroup> {
    const groups: Map<string, ProblemGroup> = new Map<string, ProblemGroup>();

    for (const run of newestFirst(runs)) {
      const subject: IncidentAlertAiSubjectInput | undefined =
        input.subjects.get(run.subjectId);

      if (!subject) {
        continue;
      }

      const key: string = this.getProblemKey(subject);
      const group: ProblemGroup = groups.get(key) || { key, runs: [] };

      group.runs.push(run);
      groups.set(key, group);
    }

    return Array.from(groups.values()).sort(
      (a: ProblemGroup, b: ProblemGroup): number => {
        return (
          b.runs.length - a.runs.length ||
          b.runs[0]!.createdAt.getTime() - a.runs[0]!.createdAt.getTime() ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
      },
    );
  }

  private static buildProblem(
    group: ProblemGroup,
    fixes: Array<IncidentAlertAiFixInput>,
    input: IncidentAlertAiInsightsInput,
  ): IncidentAlertAiProblem {
    const latest: IncidentAlertAiInvestigationInput = group.runs[0]!;
    const oldest: IncidentAlertAiInvestigationInput =
      group.runs[group.runs.length - 1]!;
    const latestSubject: IncidentAlertAiSubjectInput = input.subjects.get(
      latest.subjectId,
    )!;
    const subjectIds: Set<string> = new Set<string>(
      group.runs.map((run: IncidentAlertAiInvestigationInput): string => {
        return run.subjectId;
      }),
    );

    const verdicts: IncidentAlertAiProblem["verdicts"] = {
      confirmed: 0,
      rejected: 0,
      matched: 0,
      partlyMatched: 0,
      mismatched: 0,
    };

    for (const run of group.runs) {
      this.countVerdict(verdicts, run);
    }

    const problemFixes: Array<IncidentAlertAiFixInput> = fixes.filter(
      (fix: IncidentAlertAiFixInput): boolean => {
        return subjectIds.has(fix.subjectId);
      },
    );

    // The monitors of the latest subject that raised it, by name.
    const monitors: Array<IncidentAlertAiNamedResource> = Array.from(
      new Set<string>(latestSubject.monitorIds),
    )
      .filter((id: string): boolean => {
        return input.monitorNames.has(id);
      })
      .map((id: string): IncidentAlertAiNamedResource => {
        return { id, name: input.monitorNames.get(id)! };
      })
      .sort(
        (a: IncidentAlertAiNamedResource, b: IncidentAlertAiNamedResource) => {
          return a.name.localeCompare(b.name);
        },
      )
      .slice(0, INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEM_MONITORS);

    const finding: IncidentAlertAiFinding | undefined = this.getFinding(group);

    return {
      key: toPublicProblemKey(group.key),
      title: this.stripSeriesIdentity(
        latestSubject.title || "",
        latestSubject.seriesLabels,
      ),
      investigationCount: group.runs.length,
      subjectCount: subjectIds.size,
      isRecurring:
        group.runs.length >= INCIDENT_ALERT_AI_INSIGHTS_RECURRING_MIN,
      firstSeenAt: toIso(oldest.createdAt),
      lastSeenAt: toIso(latest.createdAt),
      latestSubject: this.toSubject(input.subjectKind, latestSubject),
      monitors,
      ...(finding ? { latestFinding: finding } : {}),
      verdicts,
      fixes: {
        proposed: problemFixes.length,
        applied: problemFixes.filter((fix: IncidentAlertAiFixInput) => {
          return APPLIED_FIX_STATUSES.includes(fix.status || "");
        }).length,
        verified: problemFixes.filter((fix: IncidentAlertAiFixInput) => {
          return (
            fix.verificationStatus ===
            AutoRemediationVerificationStatus.Verified
          );
        }).length,
        failed: problemFixes.filter((fix: IncidentAlertAiFixInput) => {
          return (
            fix.verificationStatus === AutoRemediationVerificationStatus.Failed
          );
        }).length,
        awaitingApproval: problemFixes.filter(
          (fix: IncidentAlertAiFixInput) => {
            return fix.status === AutoRemediationSuggestionStatus.Suggested;
          },
        ).length,
      },
    };
  }

  private static countVerdict(
    verdicts: IncidentAlertAiVerdictTotals,
    run: IncidentAlertAiInvestigationInput,
  ): void {
    if (run.humanVerdict === AIRunHumanVerdict.Confirmed) {
      verdicts.confirmed++;
    } else if (run.humanVerdict === AIRunHumanVerdict.Rejected) {
      verdicts.rejected++;
    }

    if (run.autoGrade === AIRunAutoGrade.Match) {
      verdicts.matched++;
    } else if (run.autoGrade === AIRunAutoGrade.Partial) {
      verdicts.partlyMatched++;
    } else if (run.autoGrade === AIRunAutoGrade.Mismatch) {
      verdicts.mismatched++;
    }
  }

  // The newest completed investigation that says what it found.
  private static getFinding(
    group: ProblemGroup,
  ): IncidentAlertAiFinding | undefined {
    for (const run of group.runs) {
      const text: string = (run.tldr || "").trim();

      if (run.status === AIRunStatus.Completed && text) {
        return {
          aiRunId: run.aiRunId,
          text,
          at: toIso(run.completedAt || run.createdAt),
        };
      }
    }

    return undefined;
  }

  /*
   * The monitors (or services) that keep showing up, counted once per
   * investigated incident: in how many incidents, in how many
   * investigations, across how many problems. Only the ones the caller may
   * read are named, and once is not a pattern.
   */
  private static buildHotspots(data: {
    runs: Array<IncidentAlertAiInvestigationInput>;
    groups: Array<ProblemGroup>;
    input: IncidentAlertAiInsightsInput;
    idsOf: (subject: IncidentAlertAiSubjectInput) => Array<string>;
    names: Map<string, string>;
  }): Array<IncidentAlertAiHotspot> {
    const counts: Map<string, HotspotCount> = new Map<string, HotspotCount>();
    const problemKeyOfSubject: Map<string, string> = new Map<string, string>();

    for (const group of data.groups) {
      for (const run of group.runs) {
        problemKeyOfSubject.set(run.subjectId, group.key);
      }
    }

    for (const run of data.runs) {
      const subject: IncidentAlertAiSubjectInput | undefined =
        data.input.subjects.get(run.subjectId);

      if (!subject) {
        continue;
      }

      for (const id of new Set<string>(data.idsOf(subject))) {
        if (!id || !data.names.has(id)) {
          continue;
        }

        const count: HotspotCount = counts.get(id) || {
          id,
          subjectIds: new Set<string>(),
          investigationCount: 0,
          problemKeys: new Set<string>(),
          lastSeen: run.createdAt,
        };

        count.subjectIds.add(run.subjectId);
        count.investigationCount++;
        count.problemKeys.add(problemKeyOfSubject.get(run.subjectId) || "");

        if (run.createdAt.getTime() > count.lastSeen.getTime()) {
          count.lastSeen = run.createdAt;
        }

        counts.set(id, count);
      }
    }

    return Array.from(counts.values())
      .filter((count: HotspotCount): boolean => {
        return (
          count.investigationCount >= INCIDENT_ALERT_AI_INSIGHTS_HOTSPOT_MIN
        );
      })
      .sort((a: HotspotCount, b: HotspotCount): number => {
        return (
          b.subjectIds.size - a.subjectIds.size ||
          b.investigationCount - a.investigationCount ||
          b.lastSeen.getTime() - a.lastSeen.getTime() ||
          data.names.get(a.id)!.localeCompare(data.names.get(b.id)!)
        );
      })
      .map((count: HotspotCount): IncidentAlertAiHotspot => {
        return {
          id: count.id,
          name: data.names.get(count.id)!,
          subjectCount: count.subjectIds.size,
          investigationCount: count.investigationCount,
          problemCount: count.problemKeys.size,
          lastSeenAt: toIso(count.lastSeen),
        };
      });
  }

  /*
   * Of the window's incidents, how many AI investigated, and why the others
   * were not. An incident from before the window that AI investigated in it
   * counts in the totals, not here: "12 of 40" is about the window's 40.
   */
  private static buildCoverage(data: {
    input: IncidentAlertAiInsightsInput;
    windowStart: Date;
    investigatedSubjects: Set<string>;
  }): IncidentAlertAiCoverage {
    const investigatedInWindow: number = Array.from(
      data.investigatedSubjects,
    ).filter((subjectId: string): boolean => {
      const createdAt: Date | undefined =
        data.input.subjects.get(subjectId)?.createdAt;
      return !createdAt || createdAt.getTime() >= data.windowStart.getTime();
    }).length;

    const reasons: Map<InvestigationNotStartedCode, number> = new Map<
      InvestigationNotStartedCode,
      number
    >();

    for (const [subjectId, code] of data.input.notInvestigatedReasons) {
      // Investigated after all (someone asked): not a skip any more.
      if (data.investigatedSubjects.has(subjectId)) {
        continue;
      }

      reasons.set(code, (reasons.get(code) || 0) + 1);
    }

    return {
      subjects: Math.max(data.input.subjectsInWindow, investigatedInWindow),
      investigatedSubjects: investigatedInWindow,
      notInvestigated: Array.from(reasons.entries())
        .map(([code, count]: [InvestigationNotStartedCode, number]) => {
          return { code, count };
        })
        .sort(
          (
            a: { code: InvestigationNotStartedCode; count: number },
            b: { code: InvestigationNotStartedCode; count: number },
          ): number => {
            return b.count - a.count || a.code.localeCompare(b.code);
          },
        ),
    };
  }

  private static buildFixOutcomes(
    fixes: Array<IncidentAlertAiFixInput>,
  ): IncidentAlertAiFixOutcomes {
    const outcomes: IncidentAlertAiFixOutcomes = {
      total: fixes.length,
      planning: 0,
      awaitingApproval: 0,
      appliedAutomatically: 0,
      appliedAfterApproval: 0,
      dismissed: 0,
      noFixFound: 0,
      verified: 0,
      failed: 0,
      verifying: 0,
    };

    for (const fix of fixes) {
      switch (fix.status) {
        case AutoRemediationSuggestionStatus.Planning:
          outcomes.planning++;
          break;
        case AutoRemediationSuggestionStatus.Suggested:
          outcomes.awaitingApproval++;
          break;
        case AutoRemediationSuggestionStatus.AutoExecuted:
          outcomes.appliedAutomatically++;
          break;
        case AutoRemediationSuggestionStatus.Approved:
          outcomes.appliedAfterApproval++;
          break;
        case AutoRemediationSuggestionStatus.Dismissed:
          outcomes.dismissed++;
          break;
        case AutoRemediationSuggestionStatus.NoneApplicable:
          outcomes.noFixFound++;
          break;
        default:
          break;
      }

      switch (fix.verificationStatus) {
        case AutoRemediationVerificationStatus.Verified:
          outcomes.verified++;
          break;
        case AutoRemediationVerificationStatus.Failed:
          outcomes.failed++;
          break;
        case AutoRemediationVerificationStatus.Pending:
          outcomes.verifying++;
          break;
        default:
          break;
      }
    }

    return outcomes;
  }

  private static buildFixTaskOutcomes(
    fixTasks: Array<IncidentAlertAiFixTaskInput>,
  ): IncidentAlertAiFixTaskOutcomes {
    const outcomes: IncidentAlertAiFixTaskOutcomes = {
      total: fixTasks.length,
      pullRequestsOpened: 0,
      noFixFound: 0,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of fixTasks) {
      if (task.status === AIRunStatus.Completed) {
        outcomes.pullRequestsOpened++;
      } else if (task.status === AIRunStatus.NoFixFound) {
        outcomes.noFixFound++;
      } else if (ACTIVE_RUN_STATUSES.includes(task.status || "")) {
        outcomes.inProgress++;
      } else if (FAILED_RUN_STATUSES.includes(task.status || "")) {
        outcomes.failed++;
      } else if (task.status === AIRunStatus.Cancelled) {
        outcomes.cancelled++;
      }
    }

    return outcomes;
  }

  private static buildVerdicts(
    runs: Array<IncidentAlertAiInvestigationInput>,
  ): IncidentAlertAiVerdictTotals {
    const verdicts: IncidentAlertAiVerdictTotals = {
      confirmed: 0,
      rejected: 0,
      matched: 0,
      partlyMatched: 0,
      mismatched: 0,
    };

    for (const run of runs) {
      this.countVerdict(verdicts, run);
    }

    return verdicts;
  }

  private static buildTrend(data: {
    windowStart: Date;
    input: IncidentAlertAiInsightsInput;
    runs: Array<IncidentAlertAiInvestigationInput>;
    fixes: Array<IncidentAlertAiFixInput>;
  }): Array<IncidentAlertAiTrendDay> {
    const days: Map<string, IncidentAlertAiTrendDay> = new Map<
      string,
      IncidentAlertAiTrendDay
    >();

    for (
      let index: number = 0;
      index < Math.max(data.input.windowInDays, 1);
      index++
    ) {
      const date: string = toUtcDay(
        new Date(data.windowStart.getTime() + index * DAY_IN_MS),
      );
      days.set(date, {
        date,
        investigations: 0,
        failedInvestigations: 0,
        fixes: 0,
      });
    }

    for (const run of data.runs) {
      const day: IncidentAlertAiTrendDay | undefined = days.get(
        toUtcDay(run.createdAt),
      );

      if (day) {
        day.investigations++;

        if (FAILED_RUN_STATUSES.includes(run.status || "")) {
          day.failedInvestigations++;
        }
      }
    }

    for (const fix of data.fixes) {
      const day: IncidentAlertAiTrendDay | undefined = days.get(
        toUtcDay(fix.createdAt),
      );

      if (day) {
        day.fixes++;
      }
    }

    return Array.from(days.values());
  }

  private static buildAttention(data: {
    input: IncidentAlertAiInsightsInput;
    runs: Array<IncidentAlertAiInvestigationInput>;
    fixes: Array<IncidentAlertAiFixInput> | null;
    // Most investigated first, as groupProblems sorts them.
    groups: Array<ProblemGroup>;
    problems: Array<IncidentAlertAiProblem>;
    monitors: Array<IncidentAlertAiHotspot>;
    totals: IncidentAlertAiInsightsTotals;
    coverage: IncidentAlertAiCoverage;
  }): Array<IncidentAlertAiAttentionItem> {
    const { input } = data;
    const items: Array<IncidentAlertAiAttentionItem> = [];

    const subjectOf: (
      subjectId: string | undefined,
    ) => IncidentAlertAiInsightsSubject | undefined = (
      subjectId: string | undefined,
    ): IncidentAlertAiInsightsSubject | undefined => {
      const subject: IncidentAlertAiSubjectInput | undefined = subjectId
        ? input.subjects.get(subjectId)
        : undefined;
      return subject ? this.toSubject(input.subjectKind, subject) : undefined;
    };

    const fixes: Array<IncidentAlertAiFixInput> = data.fixes || [];

    // 1. Fixes that were applied and did not fix it.
    const failedFixes: Array<IncidentAlertAiFixInput> = fixes.filter(
      (fix: IncidentAlertAiFixInput): boolean => {
        return (
          fix.verificationStatus === AutoRemediationVerificationStatus.Failed
        );
      },
    );

    if (failedFixes.length > 0) {
      items.push({
        kind: IncidentAlertAiAttentionKind.FixesFailed,
        severity: IncidentAlertAiAttentionSeverity.High,
        count: failedFixes.length,
        total:
          fixes.filter((fix: IncidentAlertAiFixInput): boolean => {
            return APPLIED_FIX_STATUSES.includes(fix.status || "");
          }).length || undefined,
        subject: subjectOf(failedFixes[0]!.subjectId),
      });
    }

    // 2. Incidents AI could not investigate, for the most common reason.
    const notStarted: { code: InvestigationNotStartedCode; count: number } =
      data.coverage.notInvestigated.find(
        (reason: { code: InvestigationNotStartedCode; count: number }) => {
          return Boolean(NOT_STARTED_SEVERITY[reason.code]);
        },
      ) || { code: "no_run_recorded", count: 0 };

    if (notStarted.count > 0) {
      items.push({
        kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
        severity: NOT_STARTED_SEVERITY[notStarted.code]!,
        count: notStarted.count,
        total: data.coverage.subjects || undefined,
        reason: notStarted.code,
      });
    }

    // 3. The same problem, again and again: the two most investigated.
    const recentSince: number =
      input.now.getTime() -
      INCIDENT_ALERT_AI_INSIGHTS_RECENT_WINDOW_IN_DAYS * DAY_IN_MS;
    let recurringItems: number = 0;

    for (const group of data.groups) {
      if (
        recurringItems >= 2 ||
        group.runs.length < INCIDENT_ALERT_AI_INSIGHTS_RECURRING_ATTENTION_MIN
      ) {
        break;
      }

      const problem: IncidentAlertAiProblem | undefined = data.problems.find(
        (candidate: IncidentAlertAiProblem): boolean => {
          return candidate.key === toPublicProblemKey(group.key);
        },
      );

      if (!problem) {
        continue;
      }

      const recentCount: number = group.runs.filter(
        (run: IncidentAlertAiInvestigationInput): boolean => {
          return run.createdAt.getTime() >= recentSince;
        },
      ).length;

      items.push({
        kind: IncidentAlertAiAttentionKind.RecurringProblem,
        severity:
          group.runs.length >= 5 ||
          recentCount >= INCIDENT_ALERT_AI_INSIGHTS_RECURRING_ATTENTION_MIN
            ? IncidentAlertAiAttentionSeverity.High
            : IncidentAlertAiAttentionSeverity.Medium,
        count: group.runs.length,
        recentCount,
        problemKey: problem.key,
        title: problem.title,
        subject: problem.latestSubject,
      });
      recurringItems++;
    }

    // 4. Fixes nobody has looked at yet.
    const awaiting: Array<IncidentAlertAiFixInput> = fixes.filter(
      (fix: IncidentAlertAiFixInput): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.Suggested;
      },
    );

    if (awaiting.length > 0) {
      items.push({
        kind: IncidentAlertAiAttentionKind.FixesAwaitingApproval,
        severity: IncidentAlertAiAttentionSeverity.Medium,
        count: awaiting.length,
        subject: subjectOf(awaiting[0]!.subjectId),
      });
    }

    // 5. Investigations that never finished.
    const failedRuns: Array<IncidentAlertAiInvestigationInput> =
      data.runs.filter((run: IncidentAlertAiInvestigationInput): boolean => {
        return FAILED_RUN_STATUSES.includes(run.status || "");
      });

    if (failedRuns.length > 0) {
      items.push({
        kind: IncidentAlertAiAttentionKind.InvestigationsFailed,
        severity:
          failedRuns.length >= 3 &&
          failedRuns.length * 2 >= data.totals.investigations
            ? IncidentAlertAiAttentionSeverity.High
            : IncidentAlertAiAttentionSeverity.Medium,
        count: failedRuns.length,
        total: data.totals.investigations,
        subject: subjectOf(failedRuns[0]!.subjectId),
      });
    }

    // 6. Commands an agent never ran.
    if (data.totals.timedOutCommands > 0) {
      items.push({
        kind: IncidentAlertAiAttentionKind.CommandsTimedOut,
        severity: IncidentAlertAiAttentionSeverity.Medium,
        count: data.totals.timedOutCommands,
        total: data.totals.commands || undefined,
      });
    }

    // 7. Findings people rejected, or the grader found wrong.
    const rejectedRuns: Array<IncidentAlertAiInvestigationInput> =
      data.runs.filter((run: IncidentAlertAiInvestigationInput): boolean => {
        return (
          run.humanVerdict === AIRunHumanVerdict.Rejected ||
          run.autoGrade === AIRunAutoGrade.Mismatch
        );
      });

    if (rejectedRuns.length > 0) {
      items.push({
        kind: IncidentAlertAiAttentionKind.FindingsRejected,
        severity: IncidentAlertAiAttentionSeverity.Low,
        count: rejectedRuns.length,
        total: data.totals.completedInvestigations || undefined,
        subject: subjectOf(rejectedRuns[0]!.subjectId),
      });
    }

    // 8. One monitor in most of what AI investigated.
    const topMonitor: IncidentAlertAiHotspot | undefined = data.monitors[0];

    if (
      topMonitor &&
      topMonitor.investigationCount >= 3 &&
      topMonitor.investigationCount * 2 >= data.totals.investigations
    ) {
      items.push({
        kind: IncidentAlertAiAttentionKind.MonitorHotspot,
        severity: IncidentAlertAiAttentionSeverity.Low,
        count: topMonitor.investigationCount,
        total: data.totals.investigations,
        monitor: { id: topMonitor.id, name: topMonitor.name },
      });
    }

    return items
      .sort(
        (
          a: IncidentAlertAiAttentionItem,
          b: IncidentAlertAiAttentionItem,
        ): number => {
          return (
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
            b.count - a.count
          );
        },
      )
      .slice(0, INCIDENT_ALERT_AI_INSIGHTS_MAX_ATTENTION_ITEMS);
  }
}

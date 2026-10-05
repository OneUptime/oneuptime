import AiActivityInsightsBuilder, {
  AiActivityCommandStats,
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivitySubjectInput,
} from "../ActivityInsights/AiActivityInsightsBuilder";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityCoverage,
  AiActivityFixTaskOutcomes,
  AiActivityInsights,
  AiActivityNamedResource,
  AiActivityProblem,
  AiActivityResourceHotspot,
} from "../../../../Types/AI/AiActivityInsights";
import {
  INCIDENT_ALERT_AI_INSIGHTS_HOTSPOT_MIN,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEM_MONITORS,
  IncidentAlertAiInsights,
} from "../../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../../Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The pure half of the AI Insights page of the Incidents and Alerts menus:
 * from the rows IncidentAlertAiInsightsReader gathered, what OneUptime AI
 * learned across the product's incidents (or alerts) and what deserves
 * attention (IncidentAlertAiInsights). No I/O, no clock of its own, no
 * model: the same input always gives the same insights.
 *
 * Most of it is a cluster's and a resource's AI Insights
 * (AiActivityInsightsBuilder), over the product's own rows: the problems
 * (the incidents AI investigated, grouped by the monitors that raised them,
 * else by their title), their findings (TL;DR, else the report's Summary),
 * the verdicts, the fix outcomes, the trend and the attention items. Every
 * row handed in is about an incident the caller may read - the reader leaves
 * the others out - and so is everything it says.
 *
 * What only a whole product has is worked out here, on top of it:
 *
 *   - the monitors and services that keep failing: the ones the
 *     investigated incidents were raised for or affected, counted once per
 *     incident; only those the caller may read are named, and they stand in
 *     for a cluster's part hotspots, which a project does not have;
 *   - each problem's monitors, by name;
 *   - coverage: of the window's incidents, how many AI investigated, and why
 *     the others were not;
 *   - the fix pull requests AI was asked to open, by where they ended up;
 *   - two attention items only these rows can say - the incidents AI could
 *     not investigate, and one monitor behind most investigations - ranked
 *     with the shared ones;
 *   - no fix numbers at all for a caller who may not read fixes.
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
  // No TL;DR: the Summary its posted report opens with.
  reportSummary?: string | undefined;
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

export interface IncidentAlertAiInsightsInput {
  subjectKind: IncidentAlertAiSubjectKind;
  now: Date;
  windowInDays: number;
  investigations: Array<IncidentAlertAiInvestigationInput>;
  // Null when the caller may not read fixes.
  fixes: Array<IncidentAlertAiFixInput> | null;
  fixTasks: Array<IncidentAlertAiFixTaskInput>;
  // The incidents (or alerts) the rows are about that the caller may read, by id.
  subjects: Map<string, IncidentAlertAiSubjectInput>;
  // The monitors and services the caller may read, by id.
  monitorNames: Map<string, string>;
  serviceNames: Map<string, string>;
  commands: AiActivityCommandStats;
  // The window's incidents (or alerts) the caller may read.
  subjectsInWindow: number;
  // Why each skipped one was not investigated, by its id.
  notInvestigatedReasons: Map<string, InvestigationNotStartedCode>;
  // The reader could not read everything the window held.
  isPartial: boolean;
}

const ACTIVE_RUN_STATUSES: ReadonlyArray<string> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
  AIRunStatus.WaitingForApproval,
];

const FAILED_RUN_STATUSES: ReadonlyArray<string> = [
  AIRunStatus.Error,
  AIRunStatus.Stale,
];

/*
 * Why an incident was not investigated, and how much it deserves a look: a
 * reason that blocks AI everywhere (no provider, no credits, a limit spent,
 * AI or automatic investigation turned off) is worth acting on; one that is
 * the settings doing their job (below the severity floor, inside the
 * cooldown) is not.
 */
const NOT_STARTED_SEVERITY: Partial<
  Record<InvestigationNotStartedCode, AiActivityAttentionSeverity>
> = {
  provider_missing: AiActivityAttentionSeverity.High,
  insufficient_ai_balance: AiActivityAttentionSeverity.High,
  project_daily_limit_reached: AiActivityAttentionSeverity.High,
  daily_budget_exhausted: AiActivityAttentionSeverity.High,
  budget_check_failed: AiActivityAttentionSeverity.Medium,
  enqueue_failed: AiActivityAttentionSeverity.Medium,
  eligibility_check_failed: AiActivityAttentionSeverity.Medium,
  ai_disabled: AiActivityAttentionSeverity.Medium,
  automatic_investigation_disabled: AiActivityAttentionSeverity.Low,
};

// The investigations of one problem, as the shared builder groups them.
interface ProblemRuns {
  key: string;
  runs: Array<AiActivityInvestigationInput>;
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

export default class IncidentAlertAiInsightsBuilder {
  /*
   * The shared builder's input for these rows. Every row is about an
   * incident (or alert) the caller may read - a row about any other is left
   * out - and carries it as its subject; the fixes only when the caller may
   * read them. A project has no parts of its own, so no hotspots.
   */
  public static toActivityInput(
    input: IncidentAlertAiInsightsInput,
  ): AiActivityInsightsInput {
    const subjects: Map<string, AiActivitySubjectInput> = new Map<
      string,
      AiActivitySubjectInput
    >();

    for (const [id, subject] of input.subjects) {
      subjects.set(id, {
        kind: input.subjectKind,
        id: subject.id,
        title: subject.title,
        number: subject.number,
        numberWithPrefix: subject.numberWithPrefix,
        monitorIds: subject.monitorIds,
        seriesLabels: subject.seriesLabels,
      });
    }

    return {
      now: input.now,
      windowInDays: input.windowInDays,
      investigations: input.investigations
        .filter((run: IncidentAlertAiInvestigationInput): boolean => {
          return subjects.has(run.subjectId);
        })
        .map(
          (
            run: IncidentAlertAiInvestigationInput,
          ): AiActivityInvestigationInput => {
            return {
              aiRunId: run.aiRunId,
              status: run.status,
              createdAt: run.createdAt,
              completedAt: run.completedAt,
              tldr: run.tldr,
              reportSummary: run.reportSummary,
              humanVerdict: run.humanVerdict,
              autoGrade: run.autoGrade,
              subject: subjects.get(run.subjectId),
            };
          },
        ),
      fixes: (input.fixes || [])
        .filter((fix: IncidentAlertAiFixInput): boolean => {
          return subjects.has(fix.subjectId);
        })
        .map((fix: IncidentAlertAiFixInput): AiActivityFixInput => {
          return {
            id: fix.id,
            status: fix.status,
            verificationStatus: fix.verificationStatus,
            createdAt: fix.createdAt,
            ...(input.subjectKind === "incident"
              ? { incidentId: fix.subjectId }
              : { alertId: fix.subjectId }),
          };
        }),
      commands: input.commands,
      preventiveInsights: [],
      scopeLabelKeys: [],
      scopeNames: [],
      isPartial: input.isPartial,
      subjects,
      includeHotspots: false,
    };
  }

  public static build(
    input: IncidentAlertAiInsightsInput,
  ): IncidentAlertAiInsights {
    const activityInput: AiActivityInsightsInput = this.toActivityInput(input);
    const windowStart: Date = AiActivityInsightsBuilder.getWindowStart(
      input.now,
      input.windowInDays,
    );
    const isInWindow: (row: { createdAt: Date }) => boolean = (row: {
      createdAt: Date;
    }): boolean => {
      return row.createdAt.getTime() >= windowStart.getTime();
    };

    // The window's investigations, as the shared builder counts them.
    const runs: Array<AiActivityInvestigationInput> =
      activityInput.investigations.filter(isInWindow);
    const groups: Array<ProblemRuns> =
      AiActivityInsightsBuilder.groupProblems(activityInput);

    const monitors: Array<AiActivityResourceHotspot> =
      this.buildResourceHotspots({
        runs,
        groups,
        input,
        idsOf: (subject: IncidentAlertAiSubjectInput): Array<string> => {
          return subject.monitorIds;
        },
        names: input.monitorNames,
      });
    const services: Array<AiActivityResourceHotspot> =
      this.buildResourceHotspots({
        runs,
        groups,
        input,
        idsOf: (subject: IncidentAlertAiSubjectInput): Array<string> => {
          return subject.serviceIds;
        },
        names: input.serviceNames,
      });

    const investigatedSubjects: Set<string> = new Set<string>();

    for (const run of runs) {
      if (run.subject) {
        investigatedSubjects.add(run.subject.id);
      }
    }

    const coverage: AiActivityCoverage = this.buildCoverage({
      input,
      windowStart,
      investigatedSubjects,
    });

    const fixTasks: Array<IncidentAlertAiFixTaskInput> = input.fixTasks.filter(
      (task: IncidentAlertAiFixTaskInput): boolean => {
        return isInWindow(task) && input.subjects.has(task.subjectId);
      },
    );

    const insights: AiActivityInsights = AiActivityInsightsBuilder.build({
      ...activityInput,
      extraAttention: this.buildAttention({
        coverage,
        monitors,
        investigations: runs.length,
      }),
    });

    return {
      ...insights,
      subjectKind: input.subjectKind,
      totals: { ...insights.totals, fixTasks: fixTasks.length },
      problems: insights.problems.map(
        (problem: AiActivityProblem): AiActivityProblem => {
          return {
            ...problem,
            monitors: this.getProblemMonitors(problem, input),
          };
        },
      ),
      coverage,
      monitors: monitors.slice(0, AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS),
      services: services.slice(0, AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS),
      fixTaskOutcomes: this.buildFixTaskOutcomes(fixTasks),
      fixesHidden: input.fixes === null,
    };
  }

  /*
   * The monitors that raised a problem's latest incident, the ones the
   * caller may read, by name.
   */
  public static getProblemMonitors(
    problem: AiActivityProblem,
    input: IncidentAlertAiInsightsInput,
  ): Array<AiActivityNamedResource> {
    const subject: IncidentAlertAiSubjectInput | undefined = input.subjects.get(
      problem.latestSubject.id,
    );

    return Array.from(new Set<string>(subject?.monitorIds || []))
      .filter((id: string): boolean => {
        return input.monitorNames.has(id);
      })
      .map((id: string): AiActivityNamedResource => {
        return { id, name: input.monitorNames.get(id)! };
      })
      .sort(
        (a: AiActivityNamedResource, b: AiActivityNamedResource): number => {
          return a.name.localeCompare(b.name);
        },
      )
      .slice(0, INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEM_MONITORS);
  }

  /*
   * The monitors (or services) that keep showing up, counted once per
   * investigated incident: in how many incidents, in how many
   * investigations, across how many problems. Only the ones the caller may
   * read are named, and once is not a pattern.
   */
  private static buildResourceHotspots(data: {
    runs: Array<AiActivityInvestigationInput>;
    groups: Array<ProblemRuns>;
    input: IncidentAlertAiInsightsInput;
    idsOf: (subject: IncidentAlertAiSubjectInput) => Array<string>;
    names: Map<string, string>;
  }): Array<AiActivityResourceHotspot> {
    const counts: Map<string, HotspotCount> = new Map<string, HotspotCount>();
    const problemKeyOfSubject: Map<string, string> = new Map<string, string>();

    for (const group of data.groups) {
      for (const run of group.runs) {
        if (run.subject) {
          problemKeyOfSubject.set(run.subject.id, group.key);
        }
      }
    }

    for (const run of data.runs) {
      const subject: IncidentAlertAiSubjectInput | undefined = run.subject
        ? data.input.subjects.get(run.subject.id)
        : undefined;

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

        count.subjectIds.add(subject.id);
        count.investigationCount++;
        count.problemKeys.add(problemKeyOfSubject.get(subject.id) || "");

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
      .map((count: HotspotCount): AiActivityResourceHotspot => {
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
  }): AiActivityCoverage {
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
        .map(
          ([code, count]: [InvestigationNotStartedCode, number]): {
            code: InvestigationNotStartedCode;
            count: number;
          } => {
            return { code, count };
          },
        )
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

  private static buildFixTaskOutcomes(
    fixTasks: Array<IncidentAlertAiFixTaskInput>,
  ): AiActivityFixTaskOutcomes {
    const outcomes: AiActivityFixTaskOutcomes = {
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

  /*
   * The attention items only these rows can say, for the shared builder to
   * rank with its own: the incidents AI could not investigate, for the most
   * common reason worth acting on, and one monitor behind most of what AI
   * investigated.
   */
  private static buildAttention(data: {
    coverage: AiActivityCoverage;
    // Most incidents first.
    monitors: Array<AiActivityResourceHotspot>;
    // The window's investigations.
    investigations: number;
  }): Array<AiActivityAttentionItem> {
    const items: Array<AiActivityAttentionItem> = [];

    const notStarted:
      | { code: InvestigationNotStartedCode; count: number }
      | undefined = data.coverage.notInvestigated.find(
      (reason: { code: InvestigationNotStartedCode; count: number }) => {
        return Boolean(NOT_STARTED_SEVERITY[reason.code]);
      },
    );

    if (notStarted && notStarted.count > 0) {
      items.push({
        kind: AiActivityAttentionKind.InvestigationsNotStarted,
        severity: NOT_STARTED_SEVERITY[notStarted.code]!,
        count: notStarted.count,
        total: data.coverage.subjects || undefined,
        reason: notStarted.code,
      });
    }

    const topMonitor: AiActivityResourceHotspot | undefined = data.monitors[0];

    if (
      topMonitor &&
      topMonitor.investigationCount >= 3 &&
      topMonitor.investigationCount * 2 >= data.investigations
    ) {
      items.push({
        kind: AiActivityAttentionKind.MonitorHotspot,
        severity: AiActivityAttentionSeverity.Low,
        count: topMonitor.investigationCount,
        total: data.investigations,
        monitor: { id: topMonitor.id, name: topMonitor.name },
      });
    }

    return items;
  }
}

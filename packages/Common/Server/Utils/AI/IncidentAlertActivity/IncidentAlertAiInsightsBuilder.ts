import AiActivityInsightsBuilder, {
  AiActivityCommandStats,
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivityOccurrence,
  AiActivitySubjectInput,
} from "../ActivityInsights/AiActivityInsightsBuilder";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE,
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AiActivityCoverage,
  AiActivityFixTaskOutcomes,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityNamedResource,
  AiActivityProblem,
  AiActivityResourceHotspot,
  AiActivitySubject,
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
 * from the rows IncidentAlertAiInsightsReader gathered, what is worth
 * knowing about the product's incidents (or alerts) (IncidentAlertAiInsights).
 * No I/O, no clock of its own, no model: the same input always gives the
 * same insights.
 *
 * Most of it is a cluster's and a resource's AI Insights
 * (AiActivityInsightsBuilder), over the product's own rows: the problems
 * (the incidents AI investigated, grouped by the monitors that raised them,
 * else by their title, with every incident of the window the same thing
 * raised), their findings and suggested steps, the verdicts, the fix
 * outcomes, the trend and the insights. Every row handed in is about an
 * incident the caller may read - the reader leaves the others out - and so
 * is everything it says.
 *
 * What only a whole product has is worked out here, on top of it:
 *
 *   - the monitors and services that keep failing: the ones the window's
 *     incidents were raised for or affected, counted once per incident;
 *     only those the caller may read are named, and they stand in for a
 *     cluster's part hotspots, which a project does not have;
 *   - each problem's monitors, by name, on its row and its insight;
 *   - coverage: of the window's incidents, how many AI investigated, and why
 *     the others were not;
 *   - the fix pull requests AI was asked to open, by where they ended up;
 *   - two insights only these rows can say - the incidents AI could not
 *     look at and what would let it, and one service (or monitor) behind
 *     several problems - ranked with the shared ones;
 *   - no fix numbers at all for a caller who may not read fixes.
 */

// The incident or alert a row is about, as the reader read it.
export interface IncidentAlertAiSubjectInput {
  id: string;
  // When it was created: when it came up, and what coverage counts.
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
  // The first step its posted report suggests.
  nextStep?: string | undefined;
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
  // When a person approved it.
  approvedAt?: Date | undefined;
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
  /*
   * The ids of the incidents (or alerts) of the window the caller may read,
   * investigated or not, newest first (each in subjects): everything that
   * came up. The investigated ones alone when left out.
   */
  occurrenceIds?: Array<string> | undefined;
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
 * Why an incident was not investigated, and how much it matters: a reason
 * that blocks AI everywhere (no provider, no credits, a limit spent) is
 * wrong now; one a setting or a passing failure caused is worth acting on;
 * automatic investigation turned off is worth knowing - what AI would do if
 * it were allowed. One that is the settings doing their job (below the
 * severity floor, inside the cooldown, created already resolved) is no
 * insight at all.
 */
export const NOT_STARTED_TONES: Partial<
  Record<InvestigationNotStartedCode, AiActivityInsightTone>
> = {
  provider_missing: AiActivityInsightTone.Critical,
  insufficient_ai_balance: AiActivityInsightTone.Critical,
  project_daily_limit_reached: AiActivityInsightTone.Critical,
  daily_budget_exhausted: AiActivityInsightTone.Critical,
  budget_check_failed: AiActivityInsightTone.Warning,
  enqueue_failed: AiActivityInsightTone.Warning,
  eligibility_check_failed: AiActivityInsightTone.Warning,
  ai_disabled: AiActivityInsightTone.Warning,
  automatic_investigation_disabled: AiActivityInsightTone.Pattern,
};

interface HotspotCount {
  id: string;
  occurrenceIds: Set<string>;
  investigatedIds: Set<string>;
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
        serviceIds: subject.serviceIds,
        seriesLabels: subject.seriesLabels,
        createdAt: subject.createdAt,
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
              nextStep: run.nextStep,
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
            approvedAt: fix.approvedAt,
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
      occurrences: (input.occurrenceIds || [])
        .map((id: string): AiActivitySubjectInput | undefined => {
          return subjects.get(id);
        })
        .filter(
          (
            subject: AiActivitySubjectInput | undefined,
          ): subject is AiActivitySubjectInput => {
            return Boolean(subject);
          },
        ),
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
    const occurrences: Array<AiActivityOccurrence> =
      AiActivityInsightsBuilder.getOccurrences(activityInput);

    const monitors: Array<AiActivityResourceHotspot> =
      this.buildResourceHotspots({
        runs,
        occurrences,
        input,
        idsOf: (subject: IncidentAlertAiSubjectInput): Array<string> => {
          return subject.monitorIds;
        },
        names: input.monitorNames,
      });
    const services: Array<AiActivityResourceHotspot> =
      this.buildResourceHotspots({
        runs,
        occurrences,
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
      extraInsights: this.buildInsights({
        coverage,
        monitors,
        services,
        occurrences,
        input,
      }),
    });

    const problems: Array<AiActivityProblem> = insights.problems.map(
      (problem: AiActivityProblem): AiActivityProblem => {
        return {
          ...problem,
          monitors: this.getProblemMonitors(problem, input),
        };
      },
    );

    return {
      ...insights,
      subjectKind: input.subjectKind,
      totals: { ...insights.totals, fixTasks: fixTasks.length },
      // A problem that keeps coming back names the monitors that raise it.
      insights: insights.insights.map(
        (insight: AiActivityInsight): AiActivityInsight => {
          const problem: AiActivityProblem | undefined =
            insight.kind === AiActivityInsightKind.RecurringProblem
              ? problems.find((candidate: AiActivityProblem): boolean => {
                  return candidate.key === insight.problemKey;
                })
              : undefined;

          return problem && (problem.monitors || []).length > 0
            ? { ...insight, monitors: problem.monitors }
            : insight;
        },
      ),
      problems,
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
   * The monitors (or services) that keep coming up, counted once per
   * incident of the window: in how many incidents, how many of them AI
   * investigated and how often, across how many problems. Only the ones the
   * caller may read are named, and once is not a pattern.
   */
  private static buildResourceHotspots(data: {
    runs: Array<AiActivityInvestigationInput>;
    occurrences: Array<AiActivityOccurrence>;
    input: IncidentAlertAiInsightsInput;
    idsOf: (subject: IncidentAlertAiSubjectInput) => Array<string>;
    names: Map<string, string>;
  }): Array<AiActivityResourceHotspot> {
    const counts: Map<string, HotspotCount> = new Map<string, HotspotCount>();
    const runsBySubject: Map<string, number> = new Map<string, number>();

    for (const run of data.runs) {
      if (run.subject) {
        runsBySubject.set(
          run.subject.id,
          (runsBySubject.get(run.subject.id) || 0) + 1,
        );
      }
    }

    for (const occurrence of data.occurrences) {
      const subject: IncidentAlertAiSubjectInput | undefined =
        data.input.subjects.get(occurrence.subject.id);

      if (!subject) {
        continue;
      }

      const investigations: number = runsBySubject.get(subject.id) || 0;

      for (const id of new Set<string>(data.idsOf(subject))) {
        if (!id || !data.names.has(id)) {
          continue;
        }

        const count: HotspotCount = counts.get(id) || {
          id,
          occurrenceIds: new Set<string>(),
          investigatedIds: new Set<string>(),
          investigationCount: 0,
          problemKeys: new Set<string>(),
          lastSeen: occurrence.at,
        };

        count.occurrenceIds.add(subject.id);
        count.problemKeys.add(occurrence.problemKey);

        if (investigations > 0) {
          count.investigatedIds.add(subject.id);
          count.investigationCount += investigations;
        }

        if (occurrence.at.getTime() > count.lastSeen.getTime()) {
          count.lastSeen = occurrence.at;
        }

        counts.set(id, count);
      }
    }

    return Array.from(counts.values())
      .filter((count: HotspotCount): boolean => {
        return count.occurrenceIds.size >= INCIDENT_ALERT_AI_INSIGHTS_HOTSPOT_MIN;
      })
      .sort((a: HotspotCount, b: HotspotCount): number => {
        return (
          b.occurrenceIds.size - a.occurrenceIds.size ||
          b.investigationCount - a.investigationCount ||
          b.lastSeen.getTime() - a.lastSeen.getTime() ||
          data.names.get(a.id)!.localeCompare(data.names.get(b.id)!)
        );
      })
      .map((count: HotspotCount): AiActivityResourceHotspot => {
        return {
          id: count.id,
          name: data.names.get(count.id)!,
          occurrenceCount: count.occurrenceIds.size,
          subjectCount: count.investigatedIds.size,
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
   * The insights only these rows can say, for the shared builder to rank
   * with its own:
   *
   *   - the incidents AI could not look at, for the most common reason
   *     worth knowing, and what would let it;
   *   - one service - else one monitor - behind several problems and most
   *     of what came up (AiActivityInsightsBuilder.isBehindTheTrouble).
   */
  private static buildInsights(data: {
    coverage: AiActivityCoverage;
    // The most incidents first.
    monitors: Array<AiActivityResourceHotspot>;
    services: Array<AiActivityResourceHotspot>;
    occurrences: Array<AiActivityOccurrence>;
    input: IncidentAlertAiInsightsInput;
  }): Array<AiActivityInsight> {
    const insights: Array<AiActivityInsight> = [];

    const notStarted:
      | { code: InvestigationNotStartedCode; count: number }
      | undefined = data.coverage.notInvestigated.find(
      (reason: { code: InvestigationNotStartedCode; count: number }) => {
        return Boolean(NOT_STARTED_TONES[reason.code]);
      },
    );

    if (notStarted && notStarted.count > 0) {
      insights.push({
        kind: AiActivityInsightKind.NotInvestigated,
        tone: NOT_STARTED_TONES[notStarted.code]!,
        count: notStarted.count,
        ...(data.coverage.subjects > 0
          ? { total: data.coverage.subjects }
          : {}),
        reason: notStarted.code,
      });
    }

    const service: AiActivityResourceHotspot | undefined =
      AiActivityInsightsBuilder.pickBehindTheTrouble(
        data.services,
        data.occurrences.length,
      );
    const monitor: AiActivityResourceHotspot | undefined = service
      ? undefined
      : AiActivityInsightsBuilder.pickBehindTheTrouble(
          data.monitors,
          data.occurrences.length,
        );
    const hotspot: AiActivityResourceHotspot | undefined = service || monitor;

    if (hotspot) {
      const evidence: Array<AiActivitySubject> = [];

      for (const occurrence of data.occurrences) {
        if (evidence.length >= AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE) {
          break;
        }

        const subject: IncidentAlertAiSubjectInput | undefined =
          data.input.subjects.get(occurrence.subject.id);
        const ids: Array<string> = service
          ? subject?.serviceIds || []
          : subject?.monitorIds || [];

        if (subject && ids.includes(hotspot.id)) {
          evidence.push({
            kind: data.input.subjectKind,
            id: subject.id,
            ...(subject.title ? { title: subject.title } : {}),
            ...(subject.number !== undefined ? { number: subject.number } : {}),
            ...(subject.numberWithPrefix
              ? { numberWithPrefix: subject.numberWithPrefix }
              : {}),
          });
        }
      }

      insights.push({
        kind: AiActivityInsightKind.Hotspot,
        tone: AiActivityInsightTone.Pattern,
        count: hotspot.occurrenceCount,
        total: data.occurrences.length,
        problemCount: hotspot.problemCount,
        ...(service
          ? { service: { id: hotspot.id, name: hotspot.name } }
          : { monitor: { id: hotspot.id, name: hotspot.name } }),
        lastSeenAt: hotspot.lastSeenAt,
        ...(evidence.length > 0
          ? {
              subject: evidence[0],
              evidence,
              evidenceCount: hotspot.occurrenceCount,
            }
          : {}),
      });
    }

    return insights;
  }
}

import AIInsightSeverity from "../../../../Types/AI/AIInsightSeverity";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS,
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEM_OBJECTS,
  AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS,
  AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN,
  AI_ACTIVITY_INSIGHTS_RECURRING_MIN,
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityFinding,
  AiActivityFixOutcomes,
  AiActivityHotspot,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityObject,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivitySubject,
  AiActivityTrendDay,
} from "../../../../Types/AI/AiActivityInsights";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../../Types/JSON";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

/*
 * The pure half of an AI Insights page: from the rows a reader gathered
 * (AiActivityInsightsReader for a cluster or a resource; another reader for
 * another scope), what OneUptime AI learned there and what deserves
 * attention (AiActivityInsights). No I/O, no clock of its own, no model:
 * the same input always gives the same insights, which is what the suites
 * pin.
 *
 * How it reads the rows:
 *
 *   - A problem is what raised the incidents and alerts AI investigated:
 *     their monitor (one problem however many pods, hosts or VMs it fired
 *     for), else — for a subject no monitor raised — its title. Investigated
 *     at least AI_ACTIVITY_INSIGHTS_RECURRING_MIN times in the window, a
 *     problem is recurring.
 *   - The parts of the scope a subject was about are the series identity
 *     its monitor stamped on it (Alert/Incident.seriesLabels), named the
 *     way alerts name them (SeriesLabelDisplay) — without the labels that
 *     name the scope itself (every subject here carries those) and without
 *     the qualifiers that are not a part of anything (state, direction, …).
 *   - A finding is the newest completed investigation's TL;DR, else the
 *     Summary its report opens with (InvestigationReportSummary), else the
 *     next older one that has either.
 *   - Runs without an incident or alert (an insight's triage) count in the
 *     totals and the trend only: there is no problem to file them under.
 */

// The incident or alert an investigation was about, as the reader read it.
export interface AiActivitySubjectInput {
  kind: "incident" | "alert";
  id: string;
  title?: string | undefined;
  number?: number | undefined;
  // What raised it: an alert's monitor, an incident's monitors.
  monitorIds: Array<string>;
  seriesLabels?: JSONObject | undefined;
}

export interface AiActivityInvestigationInput {
  aiRunId: string;
  // AIRunStatus.
  status?: string | undefined;
  createdAt: Date;
  completedAt?: Date | undefined;
  // Only what the caller may see: the reader leaves them out otherwise.
  tldr?: string | undefined;
  reportSummary?: string | undefined;
  // AIRunHumanVerdict and AIRunAutoGrade.
  humanVerdict?: string | undefined;
  autoGrade?: string | undefined;
  // Undefined: the run had no incident or alert.
  subject?: AiActivitySubjectInput | undefined;
}

export interface AiActivityFixInput {
  id: string;
  // AutoRemediationSuggestionStatus and AutoRemediationVerificationStatus.
  status?: string | undefined;
  verificationStatus?: string | undefined;
  createdAt: Date;
  incidentId?: string | undefined;
  alertId?: string | undefined;
}

export interface AiActivityCommandStats {
  total: number;
  failed: number;
  timedOut: number;
}

export interface AiActivityInsightsInput {
  now: Date;
  windowInDays: number;
  investigations: Array<AiActivityInvestigationInput>;
  fixes: Array<AiActivityFixInput>;
  commands: AiActivityCommandStats;
  preventiveInsights: Array<AiActivityPreventiveInsight>;
  // Series label keys, and values, that name the scope itself.
  scopeLabelKeys: ReadonlyArray<string>;
  scopeNames: ReadonlyArray<string>;
  // The reader could not read everything the window held.
  isPartial: boolean;
}

/*
 * Labels that qualify a series without naming a part of anything — a
 * state, a direction, a CPU core — so they are never a hotspot.
 */
const QUALIFIER_LABEL_KEYS: ReadonlySet<string> = new Set<string>([
  "state",
  "status",
  "direction",
  "cpu",
  "type",
  "effective",
  "power_state",
  "disk_state",
  "disk_type",
  "cpu_state",
  "cpu_reservation_type",
  "pve.type",
  "pve.scope",
]);

/*
 * At or above this SeriesLabelDisplay priority a label is an id (a pod UID,
 * a container id) or the scope around everything: correct, never a part
 * worth naming.
 */
const ID_LABEL_PRIORITY: number = 90;

const SEVERITY_RANK: Record<AiActivityAttentionSeverity, number> = {
  [AiActivityAttentionSeverity.High]: 0,
  [AiActivityAttentionSeverity.Medium]: 1,
  [AiActivityAttentionSeverity.Low]: 2,
};

const KIND_RANK: Record<AiActivityAttentionKind, number> = {
  [AiActivityAttentionKind.FixesFailed]: 0,
  [AiActivityAttentionKind.RecurringProblem]: 1,
  [AiActivityAttentionKind.PreventiveInsight]: 2,
  [AiActivityAttentionKind.FixesAwaitingApproval]: 3,
  [AiActivityAttentionKind.InvestigationsFailed]: 4,
  [AiActivityAttentionKind.CommandsTimedOut]: 5,
  [AiActivityAttentionKind.FindingsRejected]: 6,
  [AiActivityAttentionKind.Hotspot]: 7,
};

const FAILED_RUN_STATUSES: ReadonlyArray<string> = [
  AIRunStatus.Error,
  AIRunStatus.Stale,
];

const ACTIVE_RUN_STATUSES: ReadonlyArray<string> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
  AIRunStatus.WaitingForApproval,
];

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// The investigations of one problem, as the builder collects them.
interface ProblemGroup {
  key: string;
  // Newest first.
  runs: Array<
    AiActivityInvestigationInput & { subject: AiActivitySubjectInput }
  >;
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

function toSubject(input: AiActivitySubjectInput): AiActivitySubject {
  return {
    kind: input.kind,
    id: input.id,
    ...(input.title ? { title: input.title } : {}),
    ...(input.number !== undefined ? { number: input.number } : {}),
  };
}

function objectKey(object: AiActivityObject): string {
  return `${object.name}\u0000${object.value}`;
}

/*
 * A problem's key as it leaves the server: stable for the same grouping,
 * but opaque — the monitor ids it groups by are not the caller's to read.
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

// High before Medium before Low; a severity a newer server added, last.
function getInsightSeverityRank(severity: string): number {
  switch (severity) {
    case AIInsightSeverity.High:
      return 0;
    case AIInsightSeverity.Medium:
      return 1;
    case AIInsightSeverity.Low:
      return 2;
    default:
      return 3;
  }
}

export default class AiActivityInsightsBuilder {
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
   * A title without the series identity SeriesContextEnricher appended to
   * it (" - Pod: web-1 | Namespace: shop"), so the same problem reads the
   * same for every pod it fired for. Only a suffix made entirely of this
   * subject's own "Name: value" labels is taken off; anything else — a
   * user's own template, a title that merely contains " - " — is left as
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
   * The parts of the scope a subject is about, most identifying first,
   * without the labels that name the scope itself, ids and qualifiers.
   */
  public static getScopeObjects(
    seriesLabels: JSONObject | undefined,
    scope: {
      scopeLabelKeys: ReadonlyArray<string>;
      scopeNames: ReadonlyArray<string>;
    },
  ): Array<AiActivityObject> {
    const scopeKeys: Set<string> = new Set<string>(
      scope.scopeLabelKeys.map((key: string): string => {
        return SeriesLabelDisplay.normalizeKey(key);
      }),
    );
    const scopeNames: Set<string> = new Set<string>(
      scope.scopeNames
        .map((name: string): string => {
          return name.trim().toLowerCase();
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        }),
    );

    return SeriesLabelDisplay.getDisplayLabels(seriesLabels)
      .filter((label: DisplaySeriesLabel): boolean => {
        const key: string = SeriesLabelDisplay.normalizeKey(label.key);

        return (
          !scopeKeys.has(key) &&
          !scopeNames.has(label.value.trim().toLowerCase()) &&
          !QUALIFIER_LABEL_KEYS.has(key) &&
          SeriesLabelDisplay.getLabelPriority(label.key) < ID_LABEL_PRIORITY
        );
      })
      .map((label: DisplaySeriesLabel): AiActivityObject => {
        return { name: label.name, value: label.value };
      });
  }

  /*
   * What groups a subject with the others: the monitor that raised it, or
   * (several monitors) all of them, or — nothing raised it — its title.
   */
  public static getProblemKey(subject: AiActivitySubjectInput): string {
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
    return title ? `title:${title}` : `${subject.kind}:${subject.id}`;
  }

  // Every problem of the input, most investigated first, then newest.
  public static groupProblems(
    input: AiActivityInsightsInput,
  ): Array<ProblemGroup> {
    const groups: Map<string, ProblemGroup> = new Map<string, ProblemGroup>();

    for (const run of newestFirst(this.getWindowRuns(input))) {
      if (!run.subject) {
        continue;
      }

      const key: string = this.getProblemKey(run.subject);
      const group: ProblemGroup = groups.get(key) || { key, runs: [] };

      group.runs.push(
        run as AiActivityInvestigationInput & {
          subject: AiActivitySubjectInput;
        },
      );
      groups.set(key, group);
    }

    return Array.from(groups.values()).sort(
      (a: ProblemGroup, b: ProblemGroup): number => {
        return (
          b.runs.length - a.runs.length ||
          b.runs[0]!.createdAt.getTime() - a.runs[0]!.createdAt.getTime()
        );
      },
    );
  }

  /*
   * The runs whose report the reader should summarise before building: per
   * problem shown, its newest completed investigation when that one has no
   * TL;DR. Anything older is only read when it already has a TL;DR.
   */
  public static getRunsNeedingReportSummary(
    input: AiActivityInsightsInput,
  ): Array<string> {
    const runIds: Array<string> = [];

    for (const group of this.groupProblems(input).slice(
      0,
      AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS,
    )) {
      const newestCompleted: AiActivityInvestigationInput | undefined =
        group.runs.find((run: AiActivityInvestigationInput): boolean => {
          return run.status === AIRunStatus.Completed;
        });

      if (
        newestCompleted &&
        !newestCompleted.tldr?.trim() &&
        !newestCompleted.reportSummary?.trim()
      ) {
        runIds.push(newestCompleted.aiRunId);
      }
    }

    return runIds;
  }

  public static build(input: AiActivityInsightsInput): AiActivityInsights {
    const windowStart: Date = this.getWindowStart(
      input.now,
      input.windowInDays,
    );
    const runs: Array<AiActivityInvestigationInput> = newestFirst(
      this.getWindowRuns(input),
    );
    const fixes: Array<AiActivityFixInput> = newestFirst(
      input.fixes.filter((fix: AiActivityFixInput): boolean => {
        return fix.createdAt.getTime() >= windowStart.getTime();
      }),
    );
    const groups: Array<ProblemGroup> = this.groupProblems(input);

    // The incidents and alerts the caller may read, by id.
    const subjects: Map<string, AiActivitySubjectInput> = new Map<
      string,
      AiActivitySubjectInput
    >();

    for (const run of runs) {
      if (run.subject && !subjects.has(run.subject.id)) {
        subjects.set(run.subject.id, run.subject);
      }
    }

    const allProblems: Array<AiActivityProblem> = groups.map(
      (group: ProblemGroup): AiActivityProblem => {
        return this.buildProblem(group, fixes, input);
      },
    );
    const hotspots: Array<AiActivityHotspot> = this.buildHotspots(
      groups,
      input,
    );
    const fixOutcomes: AiActivityFixOutcomes = this.buildFixOutcomes(fixes);

    const totals: AiActivityInsightsTotals = {
      investigations: runs.length,
      completedInvestigations: runs.filter(
        (run: AiActivityInvestigationInput): boolean => {
          return run.status === AIRunStatus.Completed;
        },
      ).length,
      failedInvestigations: runs.filter(
        (run: AiActivityInvestigationInput): boolean => {
          return FAILED_RUN_STATUSES.includes(run.status || "");
        },
      ).length,
      activeInvestigations: runs.filter(
        (run: AiActivityInvestigationInput): boolean => {
          return ACTIVE_RUN_STATUSES.includes(run.status || "");
        },
      ).length,
      problems: allProblems.length,
      recurringProblems: allProblems.filter(
        (problem: AiActivityProblem): boolean => {
          return problem.isRecurring;
        },
      ).length,
      fixes: fixes.length,
      commands: Math.max(input.commands.total, 0),
      failedCommands: Math.max(input.commands.failed, 0),
      timedOutCommands: Math.max(input.commands.timedOut, 0),
    };

    // The most severe first, then the most recently seen.
    const preventiveInsights: Array<AiActivityPreventiveInsight> = [
      ...input.preventiveInsights,
    ]
      .sort(
        (
          a: AiActivityPreventiveInsight,
          b: AiActivityPreventiveInsight,
        ): number => {
          return (
            getInsightSeverityRank(a.severity) -
              getInsightSeverityRank(b.severity) ||
            (b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0) -
              (a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0)
          );
        },
      )
      .slice(0, AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS);

    return {
      windowInDays: input.windowInDays,
      windowStart: windowStart.toISOString(),
      generatedAt: input.now.toISOString(),
      totals,
      attention: this.buildAttention({
        input,
        runs,
        fixes,
        subjects,
        groups,
        problems: allProblems,
        hotspots,
        totals,
        preventiveInsights,
      }),
      problems: allProblems.slice(0, AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS),
      hotspots: hotspots.slice(0, AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS),
      fixOutcomes,
      trend: this.buildTrend({ windowStart, input, runs, fixes }),
      preventiveInsights,
      isPartial: input.isPartial,
    };
  }

  // The runs of the window: a reader may hand over one from just before it.
  private static getWindowRuns(
    input: AiActivityInsightsInput,
  ): Array<AiActivityInvestigationInput> {
    const windowStart: Date = this.getWindowStart(
      input.now,
      input.windowInDays,
    );

    return input.investigations.filter(
      (run: AiActivityInvestigationInput): boolean => {
        return run.createdAt.getTime() >= windowStart.getTime();
      },
    );
  }

  private static buildProblem(
    group: ProblemGroup,
    fixes: Array<AiActivityFixInput>,
    input: AiActivityInsightsInput,
  ): AiActivityProblem {
    const latest: AiActivityInvestigationInput & {
      subject: AiActivitySubjectInput;
    } = group.runs[0]!;
    const oldest: AiActivityInvestigationInput =
      group.runs[group.runs.length - 1]!;

    // Each incident or alert once, with the part of the scope it was about.
    const subjectIds: Set<string> = new Set<string>();
    const objectCounts: Map<string, AiActivityObject & { count: number }> =
      new Map<string, AiActivityObject & { count: number }>();

    for (const run of group.runs) {
      if (subjectIds.has(run.subject.id)) {
        continue;
      }

      subjectIds.add(run.subject.id);

      const primary: AiActivityObject | undefined = this.getScopeObjects(
        run.subject.seriesLabels,
        input,
      )[0];

      if (primary) {
        const counted: AiActivityObject & { count: number } = objectCounts.get(
          objectKey(primary),
        ) || { ...primary, count: 0 };
        counted.count++;
        objectCounts.set(objectKey(primary), counted);
      }
    }

    const verdicts: AiActivityProblem["verdicts"] = {
      confirmed: 0,
      rejected: 0,
      matched: 0,
      partlyMatched: 0,
      mismatched: 0,
    };

    for (const run of group.runs) {
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

    const problemFixes: Array<AiActivityFixInput> = fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        const subjectId: string | undefined = fix.incidentId || fix.alertId;
        return Boolean(subjectId && subjectIds.has(subjectId));
      },
    );

    const finding: AiActivityFinding | undefined = this.getFinding(group);

    return {
      key: toPublicProblemKey(group.key),
      title: this.stripSeriesIdentity(
        latest.subject.title || "",
        latest.subject.seriesLabels,
      ),
      investigationCount: group.runs.length,
      subjectCount: subjectIds.size,
      isRecurring: group.runs.length >= AI_ACTIVITY_INSIGHTS_RECURRING_MIN,
      firstSeenAt: toIso(oldest.createdAt),
      lastSeenAt: toIso(latest.createdAt),
      latestSubject: toSubject(latest.subject),
      objects: Array.from(objectCounts.values())
        .sort(
          (
            a: AiActivityObject & { count: number },
            b: AiActivityObject & { count: number },
          ): number => {
            return b.count - a.count;
          },
        )
        .slice(0, AI_ACTIVITY_INSIGHTS_MAX_PROBLEM_OBJECTS),
      ...(finding ? { latestFinding: finding } : {}),
      verdicts,
      fixes: {
        proposed: problemFixes.length,
        applied: problemFixes.filter((fix: AiActivityFixInput): boolean => {
          return (
            fix.status === AutoRemediationSuggestionStatus.Approved ||
            fix.status === AutoRemediationSuggestionStatus.AutoExecuted
          );
        }).length,
        verified: problemFixes.filter((fix: AiActivityFixInput): boolean => {
          return (
            fix.verificationStatus ===
            AutoRemediationVerificationStatus.Verified
          );
        }).length,
        failed: problemFixes.filter((fix: AiActivityFixInput): boolean => {
          return (
            fix.verificationStatus === AutoRemediationVerificationStatus.Failed
          );
        }).length,
        awaitingApproval: problemFixes.filter(
          (fix: AiActivityFixInput): boolean => {
            return fix.status === AutoRemediationSuggestionStatus.Suggested;
          },
        ).length,
      },
    };
  }

  // The newest completed investigation that says what it found.
  private static getFinding(
    group: ProblemGroup,
  ): AiActivityFinding | undefined {
    for (const run of group.runs) {
      if (run.status !== AIRunStatus.Completed) {
        continue;
      }

      const tldr: string = (run.tldr || "").trim();
      const reportSummary: string = (run.reportSummary || "").trim();

      if (tldr || reportSummary) {
        return {
          aiRunId: run.aiRunId,
          text: tldr || reportSummary,
          source: tldr ? "tldr" : "report",
          at: toIso(run.completedAt || run.createdAt),
        };
      }
    }

    return undefined;
  }

  private static buildHotspots(
    groups: Array<ProblemGroup>,
    input: AiActivityInsightsInput,
  ): Array<AiActivityHotspot> {
    const hotspots: Map<
      string,
      AiActivityHotspot & { problemKeys: Set<string>; lastSeen: Date }
    > = new Map();

    for (const group of groups) {
      for (const run of group.runs) {
        for (const object of this.getScopeObjects(
          run.subject.seriesLabels,
          input,
        )) {
          const hotspot: AiActivityHotspot & {
            problemKeys: Set<string>;
            lastSeen: Date;
          } = hotspots.get(objectKey(object)) || {
            ...object,
            investigationCount: 0,
            problemCount: 0,
            problemKeys: new Set<string>(),
            lastSeen: run.createdAt,
          };

          hotspot.investigationCount++;
          hotspot.problemKeys.add(group.key);

          if (run.createdAt.getTime() > hotspot.lastSeen.getTime()) {
            hotspot.lastSeen = run.createdAt;
          }

          hotspots.set(objectKey(object), hotspot);
        }
      }
    }

    // Once is not a pattern: a hotspot showed up in two investigations at least.
    return Array.from(hotspots.values())
      .filter((hotspot: AiActivityHotspot): boolean => {
        return hotspot.investigationCount >= 2;
      })
      .sort(
        (
          a: AiActivityHotspot & { problemKeys: Set<string>; lastSeen: Date },
          b: AiActivityHotspot & { problemKeys: Set<string>; lastSeen: Date },
        ): number => {
          return (
            b.investigationCount - a.investigationCount ||
            b.problemKeys.size - a.problemKeys.size ||
            b.lastSeen.getTime() - a.lastSeen.getTime() ||
            a.value.localeCompare(b.value)
          );
        },
      )
      .map(
        (
          hotspot: AiActivityHotspot & {
            problemKeys: Set<string>;
            lastSeen: Date;
          },
        ): AiActivityHotspot => {
          return {
            name: hotspot.name,
            value: hotspot.value,
            investigationCount: hotspot.investigationCount,
            problemCount: hotspot.problemKeys.size,
            lastSeenAt: toIso(hotspot.lastSeen),
          };
        },
      );
  }

  private static buildFixOutcomes(
    fixes: Array<AiActivityFixInput>,
  ): AiActivityFixOutcomes {
    const outcomes: AiActivityFixOutcomes = {
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

  private static buildTrend(data: {
    windowStart: Date;
    input: AiActivityInsightsInput;
    runs: Array<AiActivityInvestigationInput>;
    fixes: Array<AiActivityFixInput>;
  }): Array<AiActivityTrendDay> {
    const days: Map<string, AiActivityTrendDay> = new Map<
      string,
      AiActivityTrendDay
    >();

    for (let index: number = 0; index < data.input.windowInDays; index++) {
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
      const day: AiActivityTrendDay | undefined = days.get(
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
      const day: AiActivityTrendDay | undefined = days.get(
        toUtcDay(fix.createdAt),
      );

      if (day) {
        day.fixes++;
      }
    }

    return Array.from(days.values());
  }

  private static buildAttention(data: {
    input: AiActivityInsightsInput;
    runs: Array<AiActivityInvestigationInput>;
    fixes: Array<AiActivityFixInput>;
    subjects: Map<string, AiActivitySubjectInput>;
    // Most investigated first, as groupProblems sorts them.
    groups: Array<ProblemGroup>;
    problems: Array<AiActivityProblem>;
    hotspots: Array<AiActivityHotspot>;
    totals: AiActivityInsightsTotals;
    preventiveInsights: Array<AiActivityPreventiveInsight>;
  }): Array<AiActivityAttentionItem> {
    const items: Array<AiActivityAttentionItem> = [];

    // Only an incident or alert the caller may read is ever linked.
    const readableSubject: (
      subjectId: string | undefined,
    ) => AiActivitySubject | undefined = (
      subjectId: string | undefined,
    ): AiActivitySubject | undefined => {
      const subject: AiActivitySubjectInput | undefined = subjectId
        ? data.subjects.get(subjectId)
        : undefined;
      return subject ? toSubject(subject) : undefined;
    };

    const fixSubject: (
      fix: AiActivityFixInput | undefined,
    ) => AiActivitySubject | undefined = (
      fix: AiActivityFixInput | undefined,
    ): AiActivitySubject | undefined => {
      return fix ? readableSubject(fix.incidentId || fix.alertId) : undefined;
    };

    // 1. Fixes that were applied and did not fix it.
    const failedFixes: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return (
          fix.verificationStatus === AutoRemediationVerificationStatus.Failed
        );
      },
    );

    if (failedFixes.length > 0) {
      items.push({
        kind: AiActivityAttentionKind.FixesFailed,
        severity: AiActivityAttentionSeverity.High,
        count: failedFixes.length,
        total:
          data.fixes.filter((fix: AiActivityFixInput): boolean => {
            return (
              fix.status === AutoRemediationSuggestionStatus.Approved ||
              fix.status === AutoRemediationSuggestionStatus.AutoExecuted
            );
          }).length || undefined,
        subject: fixSubject(failedFixes[0]),
      });
    }

    // 2. The same problem, again and again.
    const recentSince: number =
      data.input.now.getTime() -
      AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS * DAY_IN_MS;
    let recurringItems: number = 0;

    for (const group of data.groups) {
      if (
        recurringItems >= 2 ||
        group.runs.length < AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN
      ) {
        break;
      }

      const problem: AiActivityProblem | undefined = data.problems.find(
        (candidate: AiActivityProblem): boolean => {
          return candidate.key === toPublicProblemKey(group.key);
        },
      );

      if (!problem) {
        continue;
      }

      const recentCount: number = group.runs.filter(
        (run: AiActivityInvestigationInput): boolean => {
          return run.createdAt.getTime() >= recentSince;
        },
      ).length;

      items.push({
        kind: AiActivityAttentionKind.RecurringProblem,
        severity:
          group.runs.length >= 5 ||
          recentCount >= AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN
            ? AiActivityAttentionSeverity.High
            : AiActivityAttentionSeverity.Medium,
        count: group.runs.length,
        recentCount,
        problemKey: problem.key,
        title: problem.title,
        subject: problem.latestSubject,
      });
      recurringItems++;
    }

    // 3. Open preventive findings about the scope itself.
    let preventiveItems: number = 0;

    for (const insight of data.preventiveInsights) {
      if (preventiveItems >= 2) {
        break;
      }

      if (
        insight.severity !== AIInsightSeverity.High &&
        insight.severity !== AIInsightSeverity.Medium
      ) {
        continue;
      }

      items.push({
        kind: AiActivityAttentionKind.PreventiveInsight,
        severity:
          insight.severity === AIInsightSeverity.High
            ? AiActivityAttentionSeverity.High
            : AiActivityAttentionSeverity.Medium,
        count: insight.occurrenceCount || 1,
        title: insight.title,
        insightId: insight.id,
        insightSeverity: insight.severity,
      });
      preventiveItems++;
    }

    // 4. Fixes nobody has looked at yet.
    const awaiting: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.Suggested;
      },
    );

    if (awaiting.length > 0) {
      items.push({
        kind: AiActivityAttentionKind.FixesAwaitingApproval,
        severity: AiActivityAttentionSeverity.Medium,
        count: awaiting.length,
        subject: fixSubject(awaiting[0]),
      });
    }

    // 5. Investigations that never finished.
    const failedRuns: Array<AiActivityInvestigationInput> = data.runs.filter(
      (run: AiActivityInvestigationInput): boolean => {
        return FAILED_RUN_STATUSES.includes(run.status || "");
      },
    );

    if (failedRuns.length > 0) {
      items.push({
        kind: AiActivityAttentionKind.InvestigationsFailed,
        severity:
          failedRuns.length >= 3 &&
          failedRuns.length * 2 >= data.totals.investigations
            ? AiActivityAttentionSeverity.High
            : AiActivityAttentionSeverity.Medium,
        count: failedRuns.length,
        total: data.totals.investigations,
        subject: readableSubject(failedRuns[0]!.subject?.id),
      });
    }

    // 6. Commands the agent never ran.
    if (data.totals.timedOutCommands > 0) {
      items.push({
        kind: AiActivityAttentionKind.CommandsTimedOut,
        severity: AiActivityAttentionSeverity.Medium,
        count: data.totals.timedOutCommands,
        total: data.totals.commands,
      });
    }

    // 7. Findings people rejected, or the grader found wrong.
    const rejectedRuns: Array<AiActivityInvestigationInput> = data.runs.filter(
      (run: AiActivityInvestigationInput): boolean => {
        return (
          run.humanVerdict === AIRunHumanVerdict.Rejected ||
          run.autoGrade === AIRunAutoGrade.Mismatch
        );
      },
    );

    if (rejectedRuns.length > 0) {
      items.push({
        kind: AiActivityAttentionKind.FindingsRejected,
        severity: AiActivityAttentionSeverity.Low,
        count: rejectedRuns.length,
        total: data.totals.completedInvestigations || undefined,
        subject: readableSubject(rejectedRuns[0]!.subject?.id),
      });
    }

    // 8. One part of the scope in most of what AI investigated.
    const withSubject: number = data.runs.filter(
      (run: AiActivityInvestigationInput): boolean => {
        return Boolean(run.subject);
      },
    ).length;
    const topHotspot: AiActivityHotspot | undefined = data.hotspots[0];

    if (
      topHotspot &&
      topHotspot.investigationCount >= 3 &&
      topHotspot.investigationCount * 2 >= withSubject
    ) {
      items.push({
        kind: AiActivityAttentionKind.Hotspot,
        severity: AiActivityAttentionSeverity.Low,
        count: topHotspot.investigationCount,
        total: withSubject,
        object: { name: topHotspot.name, value: topHotspot.value },
      });
    }

    return items
      .sort(
        (a: AiActivityAttentionItem, b: AiActivityAttentionItem): number => {
          return (
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
            b.count - a.count
          );
        },
      )
      .slice(0, AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS);
  }
}

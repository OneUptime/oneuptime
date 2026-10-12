import AIInsightSeverity from "../../../../Types/AI/AIInsightSeverity";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE,
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEM_OBJECTS,
  AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_RISK_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_STOPPED_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_READY_FOR_AUTOMATIC_MIN_APPROVED,
  AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS,
  AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN,
  AI_ACTIVITY_INSIGHTS_RECURRING_MIN,
  AI_ACTIVITY_INSIGHTS_STOPPED_MIN_DAYS,
  AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_HOURS,
  AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAYS,
  AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAY_PERCENT,
  AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_OCCURRENCES,
  AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_OCCURRENCE_PERCENT,
  AiActivityFinding,
  AiActivityFixOutcomes,
  AiActivityHotspot,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityObject,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivitySubject,
  AiActivityTimeOfDay,
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
 * another scope), what is worth knowing about the scope (AiActivityInsights).
 * No I/O, no clock of its own, no model: the same input always gives the
 * same insights, which is what the suites pin.
 *
 * How it reads the rows:
 *
 *   - A problem is what raised the incidents and alerts AI investigated:
 *     their monitor (one problem however many pods, hosts or VMs it fired
 *     for), else — for a subject no monitor raised — its title. Every
 *     incident and alert of the window the same thing raised counts as the
 *     problem coming up, whether AI investigated it or not (a monitor's
 *     cooldown skips the repeats): that is how often it happened. Up at
 *     least AI_ACTIVITY_INSIGHTS_RECURRING_MIN times, a problem is recurring.
 *   - The parts of the scope a subject was about are the series identity
 *     its monitor stamped on it (Alert/Incident.seriesLabels), named the
 *     way alerts name them (SeriesLabelDisplay) — without the labels that
 *     name the scope itself (every subject here carries those) and without
 *     the qualifiers that are not a part of anything (state, direction, …).
 *   - A finding is the newest completed investigation's TL;DR, else the
 *     Summary its report opens with (InvestigationReportSummary), else the
 *     next older one that has either; the step it suggests is the first of
 *     that report's Suggested next steps. Both are the investigation's own
 *     words, shown as its.
 *   - Runs without an incident or alert (an insight's triage) count in the
 *     totals and the trend only: there is no problem to file them under.
 *
 * What the page leads with are the insights (buildInsights): the problems
 * that keep coming back with why and what to do, the part of the scope
 * behind several of them, a problem that stopped after a fix, what AI fixed
 * on its own, what it would fix if allowed, fixes that need someone, and
 * the risks spotted before anything paged — ranked most urgent first, with
 * one slot kept for good news (rankInsights).
 *
 * The incidents' and alerts' pages build theirs here too
 * (IncidentAlertAiInsightsBuilder): their scope has no parts of its own, so
 * they ask for no hotspots, and the insights only their rows can say
 * (incidents AI skipped, a service behind several problems) come in as
 * extraInsights, ranked with the rest.
 */

// The incident or alert a row is about, as the reader read it.
export interface AiActivitySubjectInput {
  kind: "incident" | "alert";
  id: string;
  title?: string | undefined;
  number?: number | undefined;
  // The number with the project's prefix ("INC-42"), when the reader read it.
  numberWithPrefix?: string | undefined;
  // What raised it: an alert's monitor, an incident's monitors.
  monitorIds: Array<string>;
  // The services it affected, when the reader read them.
  serviceIds?: Array<string> | undefined;
  seriesLabels?: JSONObject | undefined;
  // When it was created: when the problem came up.
  createdAt?: Date | undefined;
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
  // The first step its report suggested, when the reader read the report.
  nextStep?: string | undefined;
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
  // When a person approved it: an approved fix ran then.
  approvedAt?: Date | undefined;
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
  /*
   * Every incident and alert of the scope created in the window that the
   * caller may read, investigated or not: how often each problem came up,
   * and where. The investigations' own subjects when left out.
   */
  occurrences?: Array<AiActivitySubjectInput> | undefined;
  /*
   * Every incident or alert the rows are about that the caller may read, by
   * id, so an insight can link one AI did not investigate in the window (a
   * fix's). The investigations' and occurrences' own subjects when left out.
   */
  subjects?: Map<string, AiActivitySubjectInput> | undefined;
  /*
   * False for a scope with no parts of its own (a project's incidents or
   * alerts): no hotspots, and no part behind the trouble.
   */
  includeHotspots?: boolean | undefined;
  /*
   * Insights a reader worked out from rows only it reads (the incidents'
   * and alerts' coverage, monitors and services), ranked with the rest.
   */
  extraInsights?: Array<AiActivityInsight> | undefined;
}

// One incident or alert coming up: the problem it belongs to, and when.
export interface AiActivityOccurrence {
  subject: AiActivitySubjectInput;
  at: Date;
  // getProblemKey(subject).
  problemKey: string;
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

const TONE_RANK: Record<AiActivityInsightTone, number> = {
  [AiActivityInsightTone.Critical]: 0,
  [AiActivityInsightTone.Warning]: 1,
  [AiActivityInsightTone.Pattern]: 2,
  [AiActivityInsightTone.Positive]: 3,
};

/*
 * Of one tone, what to read first: the problem that keeps coming back leads
 * (it is the one with a why and a what-to-do), then what is broken now,
 * then what needs someone, then the patterns and the good news.
 */
const KIND_RANK: Record<AiActivityInsightKind, number> = {
  [AiActivityInsightKind.RecurringProblem]: 0,
  [AiActivityInsightKind.FixesDidNotHelp]: 1,
  [AiActivityInsightKind.NotInvestigated]: 2,
  [AiActivityInsightKind.RiskSpotted]: 3,
  [AiActivityInsightKind.FixesAwaitingApproval]: 4,
  [AiActivityInsightKind.Hotspot]: 5,
  [AiActivityInsightKind.ProblemStopped]: 6,
  [AiActivityInsightKind.FixedAutomatically]: 7,
  [AiActivityInsightKind.ReadyForAutomaticFixes]: 8,
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

const APPLIED_FIX_STATUSES: ReadonlyArray<string> = [
  AutoRemediationSuggestionStatus.Approved,
  AutoRemediationSuggestionStatus.AutoExecuted,
];

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const HOURS_IN_DAY: number = 24;

const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;

// The investigations of one problem, as the builder collects them.
interface ProblemGroup {
  key: string;
  // Newest first.
  runs: Array<
    AiActivityInvestigationInput & { subject: AiActivitySubjectInput }
  >;
}

// A problem with everything the insights need to know about it.
interface BuiltProblem {
  problem: AiActivityProblem;
  // Newest first.
  occurrences: Array<AiActivityOccurrence>;
  // The incident or alert whose investigation the finding is from.
  findingSubject?: AiActivitySubjectInput | undefined;
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
    ...(input.numberWithPrefix
      ? { numberWithPrefix: input.numberWithPrefix }
      : {}),
  };
}

function objectKey(object: AiActivityObject): string {
  return `${object.name}\u0000${object.value}`;
}

// The public part of an object: what it is called, and where it was read.
function toObject(object: AiActivityObject): AiActivityObject {
  return {
    name: object.name,
    value: object.value,
    ...(object.key ? { key: object.key } : {}),
  };
}

function isAppliedFix(fix: AiActivityFixInput): boolean {
  return APPLIED_FIX_STATUSES.includes(fix.status || "");
}

function getFixSubjectId(fix: AiActivityFixInput): string | undefined {
  return fix.incidentId || fix.alertId;
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
   * without the labels that name the scope itself, ids and qualifiers. Each
   * keeps the (normalised) label it was read from, so a page can link it.
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
        return {
          name: label.name,
          value: label.value,
          key: SeriesLabelDisplay.normalizeKey(label.key),
        };
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
      .replace(WHITESPACE_RUN_REGEX, " ")
      .trim();

    // Nothing to group an untitled subject with: it is a problem of its own.
    return title ? `title:${title}` : `${subject.kind}:${subject.id}`;
  }

  /*
   * Every incident and alert of the window, once each, with when it came up
   * and the problem it belongs to, newest first: the reader's occurrences,
   * and the subjects of the window's investigations. A subject created
   * before the window that AI investigated in it came up, for this page,
   * when it was first investigated.
   */
  public static getOccurrences(
    input: AiActivityInsightsInput,
  ): Array<AiActivityOccurrence> {
    const windowStart: Date = this.getWindowStart(
      input.now,
      input.windowInDays,
    );
    const occurrences: Map<string, AiActivityOccurrence> = new Map<
      string,
      AiActivityOccurrence
    >();

    for (const subject of input.occurrences || []) {
      if (
        !subject.id ||
        !subject.createdAt ||
        subject.createdAt.getTime() < windowStart.getTime() ||
        occurrences.has(subject.id)
      ) {
        continue;
      }

      occurrences.set(subject.id, {
        subject,
        at: subject.createdAt,
        problemKey: this.getProblemKey(subject),
      });
    }

    // Oldest first, so a subject's first investigation sets when it came up.
    const oldestFirst: Array<AiActivityInvestigationInput> = newestFirst(
      this.getWindowRuns(input),
    ).reverse();

    for (const run of oldestFirst) {
      const subject: AiActivitySubjectInput | undefined = run.subject;

      if (!subject || occurrences.has(subject.id)) {
        continue;
      }

      const createdInWindow: boolean = Boolean(
        subject.createdAt &&
          subject.createdAt.getTime() >= windowStart.getTime(),
      );

      occurrences.set(subject.id, {
        subject,
        at: createdInWindow ? subject.createdAt! : run.createdAt,
        problemKey: this.getProblemKey(subject),
      });
    }

    return Array.from(occurrences.values()).sort(
      (a: AiActivityOccurrence, b: AiActivityOccurrence): number => {
        return (
          b.at.getTime() - a.at.getTime() ||
          a.subject.id.localeCompare(b.subject.id)
        );
      },
    );
  }

  /*
   * Every problem of the input: the most often it came up first, then the
   * most investigated, then the newest.
   */
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

    const occurrenceCounts: Map<string, number> = new Map<string, number>();

    for (const occurrence of this.getOccurrences(input)) {
      occurrenceCounts.set(
        occurrence.problemKey,
        (occurrenceCounts.get(occurrence.problemKey) || 0) + 1,
      );
    }

    return Array.from(groups.values()).sort(
      (a: ProblemGroup, b: ProblemGroup): number => {
        return (
          (occurrenceCounts.get(b.key) || 0) -
            (occurrenceCounts.get(a.key) || 0) ||
          b.runs.length - a.runs.length ||
          b.runs[0]!.createdAt.getTime() - a.runs[0]!.createdAt.getTime() ||
          a.key.localeCompare(b.key)
        );
      },
    );
  }

  /*
   * The runs whose report the reader should read before building: per
   * problem shown, its newest completed investigation — for the step its
   * report suggests, and for its finding when it has no TL;DR. Anything
   * older is only read for its TL;DR.
   */
  public static getRunsNeedingReport(
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
        !(
          (newestCompleted.tldr?.trim() ||
            newestCompleted.reportSummary?.trim()) &&
          newestCompleted.nextStep?.trim()
        )
      ) {
        runIds.push(newestCompleted.aiRunId);
      }
    }

    return runIds;
  }

  /*
   * When the dates tend to fall: the busiest stretch of
   * AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_HOURS hours of the UTC day, or
   * undefined when they keep to no part of it. Said only for enough
   * occurrences on enough days, most of them, on most of those days, inside
   * the stretch — a problem that fires all day long has no time of day.
   */
  public static getTimeOfDay(
    dates: Array<Date>,
  ): AiActivityTimeOfDay | undefined {
    if (dates.length < AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_OCCURRENCES) {
      return undefined;
    }

    const hoursByDay: Map<string, Array<number>> = new Map<
      string,
      Array<number>
    >();

    for (const date of dates) {
      const day: string = toUtcDay(date);
      hoursByDay.set(day, [...(hoursByDay.get(day) || []), date.getUTCHours()]);
    }

    if (hoursByDay.size < AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAYS) {
      return undefined;
    }

    const hours: number = AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_HOURS;
    let best: AiActivityTimeOfDay | undefined = undefined;
    let bestStartsOccupied: boolean = false;

    for (let start: number = 0; start < HOURS_IN_DAY; start++) {
      const isInside: (hour: number) => boolean = (hour: number): boolean => {
        return (hour - start + HOURS_IN_DAY) % HOURS_IN_DAY < hours;
      };

      const count: number = dates.filter((date: Date): boolean => {
        return isInside(date.getUTCHours());
      }).length;
      const days: number = Array.from(hoursByDay.values()).filter(
        (dayHours: Array<number>): boolean => {
          return dayHours.some(isInside);
        },
      ).length;

      /*
       * The most days, then the most times; of stretches that hold the same,
       * the one that starts at an hour the problem started in (the earliest).
       */
      const startsOccupied: boolean = dates.some((date: Date): boolean => {
        return date.getUTCHours() === start;
      });

      if (
        !best ||
        days > best.days ||
        (days === best.days && count > best.count) ||
        (days === best.days &&
          count === best.count &&
          startsOccupied &&
          !bestStartsOccupied)
      ) {
        best = {
          startHourUtc: start,
          hours,
          count,
          total: dates.length,
          days,
          totalDays: hoursByDay.size,
        };
        bestStartsOccupied = startsOccupied;
      }
    }

    if (
      !best ||
      best.days < AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAYS ||
      best.days * 100 <
        best.totalDays * AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAY_PERCENT ||
      best.count * 100 <
        best.total * AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_OCCURRENCE_PERCENT
    ) {
      return undefined;
    }

    /*
     * Said as tightly as it happened: from the first hour of the stretch the
     * problem started in to the last ("between 13:00 and 15:00", not a wider
     * stretch that merely holds it).
     */
    const stretchStart: number = best.startHourUtc;
    const offsets: Array<number> = dates
      .map((date: Date): number => {
        return (
          (date.getUTCHours() - stretchStart + HOURS_IN_DAY) % HOURS_IN_DAY
        );
      })
      .filter((offset: number): boolean => {
        return offset < hours;
      });
    const firstOffset: number = Math.min(...offsets);
    const lastOffset: number = Math.max(...offsets);

    return {
      ...best,
      startHourUtc: (stretchStart + firstOffset) % HOURS_IN_DAY,
      hours: lastOffset - firstOffset + 1,
    };
  }

  /*
   * Of the candidates behind the trouble (isBehindTheTrouble), the one the
   * insight names: behind the most different problems, then in the most
   * incidents and alerts — keeping the list's own order between equals.
   */
  public static pickBehindTheTrouble<
    T extends { occurrenceCount: number; problemCount: number },
  >(candidates: Array<T>, occurrences: number): T | undefined {
    return candidates
      .filter((candidate: T): boolean => {
        return this.isBehindTheTrouble({
          occurrenceCount: candidate.occurrenceCount,
          problemCount: candidate.problemCount,
          occurrences,
        });
      })
      .map((candidate: T, index: number): { candidate: T; index: number } => {
        return { candidate, index };
      })
      .sort(
        (
          a: { candidate: T; index: number },
          b: { candidate: T; index: number },
        ): number => {
          return (
            b.candidate.problemCount - a.candidate.problemCount ||
            b.candidate.occurrenceCount - a.candidate.occurrenceCount ||
            a.index - b.index
          );
        },
      )[0]?.candidate;
  }

  /*
   * Whether one part of the scope (or one service or monitor) is behind the
   * trouble: part of at least two different problems and of at least
   * AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN of the incidents and alerts
   * that came up — half of them, or three different problems — but not of
   * every one of them, which would say nothing (the only node, the one
   * namespace, the service everything runs in).
   */
  public static isBehindTheTrouble(data: {
    occurrenceCount: number;
    problemCount: number;
    // Everything that came up in the window.
    occurrences: number;
  }): boolean {
    return (
      data.problemCount >= 2 &&
      data.occurrenceCount >= AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN &&
      data.occurrenceCount < data.occurrences &&
      (data.occurrenceCount * 2 >= data.occurrences || data.problemCount >= 3)
    );
  }

  /*
   * The insights the page leads with, most important first: by tone
   * (Critical, Warning, Pattern, Positive), then by kind, then the larger
   * count. At most AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS — and when a pattern
   * or good news would be cut, the best of each takes the place of the
   * least important item left: a page of warnings only would hide the node
   * behind them, and what AI got right is worth knowing too.
   */
  public static rankInsights(
    insights: Array<AiActivityInsight>,
  ): Array<AiActivityInsight> {
    const byRank: (a: AiActivityInsight, b: AiActivityInsight) => number = (
      a: AiActivityInsight,
      b: AiActivityInsight,
    ): number => {
      return (
        TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        b.count - a.count
      );
    };

    const ranked: Array<AiActivityInsight> = [...insights].sort(byRank);
    const top: Array<AiActivityInsight> = ranked.slice(
      0,
      AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
    );
    const keptTones: Array<AiActivityInsightTone> = [
      AiActivityInsightTone.Pattern,
      AiActivityInsightTone.Positive,
    ];

    for (const tone of keptTones) {
      if (
        ranked.length <= top.length ||
        top.some((insight: AiActivityInsight): boolean => {
          return insight.tone === tone;
        })
      ) {
        continue;
      }

      const best: AiActivityInsight | undefined = ranked.find(
        (insight: AiActivityInsight): boolean => {
          return insight.tone === tone;
        },
      );

      if (!best) {
        continue;
      }

      // The least important item that is not the one kept for its own tone.
      for (let index: number = top.length - 1; index >= 0; index--) {
        const candidate: AiActivityInsight = top[index]!;
        const isKept: boolean =
          keptTones.includes(candidate.tone) &&
          top.filter((insight: AiActivityInsight): boolean => {
            return insight.tone === candidate.tone;
          }).length === 1;

        if (!isKept) {
          top[index] = best;
          break;
        }
      }
    }

    return top.sort(byRank);
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
    const occurrences: Array<AiActivityOccurrence> = this.getOccurrences(input);
    const groups: Array<ProblemGroup> = this.groupProblems(input);

    // The incidents and alerts the caller may read, by id.
    const subjects: Map<string, AiActivitySubjectInput> = new Map<
      string,
      AiActivitySubjectInput
    >(input.subjects || []);

    for (const occurrence of occurrences) {
      if (!subjects.has(occurrence.subject.id)) {
        subjects.set(occurrence.subject.id, occurrence.subject);
      }
    }

    const occurrencesByProblem: Map<
      string,
      Array<AiActivityOccurrence>
    > = new Map<string, Array<AiActivityOccurrence>>();

    for (const occurrence of occurrences) {
      occurrencesByProblem.set(occurrence.problemKey, [
        ...(occurrencesByProblem.get(occurrence.problemKey) || []),
        occurrence,
      ]);
    }

    const builtProblems: Array<BuiltProblem> = groups.map(
      (group: ProblemGroup): BuiltProblem => {
        return this.buildProblem({
          group,
          occurrences: occurrencesByProblem.get(group.key) || [],
          fixes,
          input,
        });
      },
    );
    const allProblems: Array<AiActivityProblem> = builtProblems.map(
      (built: BuiltProblem): AiActivityProblem => {
        return built.problem;
      },
    );
    const hotspots: Array<AiActivityHotspot> =
      input.includeHotspots === false
        ? []
        : this.buildHotspots({ occurrences, runs, input });
    const fixOutcomes: AiActivityFixOutcomes = this.buildFixOutcomes(fixes);

    const totals: AiActivityInsightsTotals = {
      occurrences: occurrences.length,
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
      confirmedFindings: runs.filter(
        (run: AiActivityInvestigationInput): boolean => {
          return (
            run.humanVerdict === AIRunHumanVerdict.Confirmed ||
            run.autoGrade === AIRunAutoGrade.Match ||
            run.autoGrade === AIRunAutoGrade.Partial
          );
        },
      ).length,
      rejectedFindings: runs.filter(
        (run: AiActivityInvestigationInput): boolean => {
          return (
            run.humanVerdict === AIRunHumanVerdict.Rejected ||
            run.autoGrade === AIRunAutoGrade.Mismatch
          );
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
      insights: this.rankInsights([
        ...this.buildInsights({
          input,
          problems: builtProblems,
          hotspots,
          occurrences,
          fixes,
          subjects,
          totals,
          preventiveInsights,
        }),
        ...(input.extraInsights || []),
      ]),
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

  private static buildProblem(data: {
    group: ProblemGroup;
    // Newest first.
    occurrences: Array<AiActivityOccurrence>;
    fixes: Array<AiActivityFixInput>;
    input: AiActivityInsightsInput;
  }): BuiltProblem {
    const { group, input } = data;
    const latest: AiActivityInvestigationInput & {
      subject: AiActivitySubjectInput;
    } = group.runs[0]!;

    // The incidents and alerts AI investigated, once each.
    const investigatedIds: Set<string> = new Set<string>(
      group.runs.map(
        (
          run: AiActivityInvestigationInput & {
            subject: AiActivitySubjectInput;
          },
        ): string => {
          return run.subject.id;
        },
      ),
    );

    // Every incident and alert of the problem: what it fired for, and when.
    const objectCounts: Map<string, AiActivityObject & { count: number }> =
      new Map<string, AiActivityObject & { count: number }>();

    for (const occurrence of data.occurrences) {
      const primary: AiActivityObject | undefined = this.getScopeObjects(
        occurrence.subject.seriesLabels,
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

    const recentSince: number =
      input.now.getTime() -
      AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS * DAY_IN_MS;
    const previousSince: number =
      recentSince - AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS * DAY_IN_MS;

    const recentOccurrenceCount: number = data.occurrences.filter(
      (occurrence: AiActivityOccurrence): boolean => {
        return occurrence.at.getTime() >= recentSince;
      },
    ).length;
    const previousOccurrenceCount: number = data.occurrences.filter(
      (occurrence: AiActivityOccurrence): boolean => {
        return (
          occurrence.at.getTime() >= previousSince &&
          occurrence.at.getTime() < recentSince
        );
      },
    ).length;

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

    const occurrenceIds: Set<string> = new Set<string>([
      ...investigatedIds,
      ...data.occurrences.map((occurrence: AiActivityOccurrence): string => {
        return occurrence.subject.id;
      }),
    ]);

    const problemFixes: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        const subjectId: string | undefined = getFixSubjectId(fix);
        return Boolean(subjectId && occurrenceIds.has(subjectId));
      },
    );

    const conclusion:
      | {
          finding: AiActivityFinding;
          nextStep?: string | undefined;
          subject: AiActivitySubjectInput;
        }
      | undefined = this.getFinding(group);

    const times: Array<number> = data.occurrences.map(
      (occurrence: AiActivityOccurrence): number => {
        return occurrence.at.getTime();
      },
    );
    const firstSeen: Date =
      times.length > 0
        ? new Date(Math.min(...times))
        : group.runs[group.runs.length - 1]!.createdAt;
    const lastSeen: Date =
      times.length > 0 ? new Date(Math.max(...times)) : latest.createdAt;

    const occurrenceCount: number = Math.max(
      data.occurrences.length,
      investigatedIds.size,
    );

    const timeOfDay: AiActivityTimeOfDay | undefined = this.getTimeOfDay(
      data.occurrences.map((occurrence: AiActivityOccurrence): Date => {
        return occurrence.at;
      }),
    );

    return {
      occurrences: data.occurrences,
      findingSubject: conclusion?.subject,
      problem: {
        key: toPublicProblemKey(group.key),
        title: this.stripSeriesIdentity(
          latest.subject.title || "",
          latest.subject.seriesLabels,
        ),
        occurrenceCount,
        recentOccurrenceCount,
        previousOccurrenceCount,
        investigationCount: group.runs.length,
        subjectCount: investigatedIds.size,
        isRecurring: occurrenceCount >= AI_ACTIVITY_INSIGHTS_RECURRING_MIN,
        firstSeenAt: toIso(firstSeen),
        lastSeenAt: toIso(lastSeen),
        latestSubject: toSubject(latest.subject),
        objects: Array.from(objectCounts.values())
          .sort(
            (
              a: AiActivityObject & { count: number },
              b: AiActivityObject & { count: number },
            ): number => {
              return b.count - a.count || a.value.localeCompare(b.value);
            },
          )
          .slice(0, AI_ACTIVITY_INSIGHTS_MAX_PROBLEM_OBJECTS)
          .map(
            (
              object: AiActivityObject & { count: number },
            ): AiActivityObject & { count: number } => {
              return { ...toObject(object), count: object.count };
            },
          ),
        ...(conclusion ? { latestFinding: conclusion.finding } : {}),
        ...(conclusion?.nextStep
          ? { latestNextStep: conclusion.nextStep }
          : {}),
        ...(timeOfDay ? { timeOfDay } : {}),
        verdicts,
        fixes: {
          proposed: problemFixes.length,
          applied: problemFixes.filter(isAppliedFix).length,
          verified: problemFixes.filter((fix: AiActivityFixInput): boolean => {
            return (
              fix.verificationStatus ===
              AutoRemediationVerificationStatus.Verified
            );
          }).length,
          failed: problemFixes.filter((fix: AiActivityFixInput): boolean => {
            return (
              fix.verificationStatus ===
              AutoRemediationVerificationStatus.Failed
            );
          }).length,
          awaitingApproval: problemFixes.filter(
            (fix: AiActivityFixInput): boolean => {
              return fix.status === AutoRemediationSuggestionStatus.Suggested;
            },
          ).length,
        },
      },
    };
  }

  /*
   * The newest completed investigation that says what it found, the step
   * its report suggested (when the reader read the report), and the
   * incident or alert it was about.
   */
  private static getFinding(group: ProblemGroup):
    | {
        finding: AiActivityFinding;
        nextStep?: string | undefined;
        subject: AiActivitySubjectInput;
      }
    | undefined {
    for (const run of group.runs) {
      if (run.status !== AIRunStatus.Completed) {
        continue;
      }

      const tldr: string = (run.tldr || "").trim();
      const reportSummary: string = (run.reportSummary || "").trim();
      const nextStep: string = (run.nextStep || "").trim();

      if (tldr || reportSummary) {
        return {
          finding: {
            aiRunId: run.aiRunId,
            text: tldr || reportSummary,
            source: tldr ? "tldr" : "report",
            at: toIso(run.completedAt || run.createdAt),
          },
          ...(nextStep ? { nextStep } : {}),
          subject: run.subject,
        };
      }
    }

    return undefined;
  }

  /*
   * The parts of the scope behind what came up here: each counted once per
   * incident or alert it was part of, with the problems it showed up in and
   * how often AI investigated it. Once is not a pattern.
   */
  private static buildHotspots(data: {
    occurrences: Array<AiActivityOccurrence>;
    runs: Array<AiActivityInvestigationInput>;
    input: AiActivityInsightsInput;
  }): Array<AiActivityHotspot> {
    interface HotspotCount {
      object: AiActivityObject;
      subjectIds: Set<string>;
      problemKeys: Set<string>;
      investigationCount: number;
      lastSeen: Date;
    }

    const hotspots: Map<string, HotspotCount> = new Map<string, HotspotCount>();
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
      for (const object of this.getScopeObjects(
        occurrence.subject.seriesLabels,
        data.input,
      )) {
        const hotspot: HotspotCount = hotspots.get(objectKey(object)) || {
          object,
          subjectIds: new Set<string>(),
          problemKeys: new Set<string>(),
          investigationCount: 0,
          lastSeen: occurrence.at,
        };

        if (!hotspot.subjectIds.has(occurrence.subject.id)) {
          hotspot.subjectIds.add(occurrence.subject.id);
          hotspot.investigationCount +=
            runsBySubject.get(occurrence.subject.id) || 0;
        }

        hotspot.problemKeys.add(occurrence.problemKey);

        if (occurrence.at.getTime() > hotspot.lastSeen.getTime()) {
          hotspot.lastSeen = occurrence.at;
        }

        hotspots.set(objectKey(object), hotspot);
      }
    }

    return Array.from(hotspots.values())
      .filter((hotspot: HotspotCount): boolean => {
        return hotspot.subjectIds.size >= 2;
      })
      .sort((a: HotspotCount, b: HotspotCount): number => {
        return (
          b.subjectIds.size - a.subjectIds.size ||
          b.problemKeys.size - a.problemKeys.size ||
          b.lastSeen.getTime() - a.lastSeen.getTime() ||
          a.object.value.localeCompare(b.object.value)
        );
      })
      .map((hotspot: HotspotCount): AiActivityHotspot => {
        return {
          ...toObject(hotspot.object),
          occurrenceCount: hotspot.subjectIds.size,
          investigationCount: hotspot.investigationCount,
          problemCount: hotspot.problemKeys.size,
          lastSeenAt: toIso(hotspot.lastSeen),
        };
      });
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

  /*
   * The incidents and alerts behind a set of rows that the caller may read,
   * newest first, at most AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE of them, and how
   * many there are in all.
   */
  private static getEvidence(
    subjectIds: Array<string | undefined>,
    subjects: Map<string, AiActivitySubjectInput>,
  ): { evidence: Array<AiActivitySubject>; evidenceCount: number } {
    const seen: Set<string> = new Set<string>();
    const evidence: Array<AiActivitySubject> = [];

    for (const subjectId of subjectIds) {
      if (!subjectId || seen.has(subjectId)) {
        continue;
      }

      seen.add(subjectId);

      const subject: AiActivitySubjectInput | undefined =
        subjects.get(subjectId);

      if (subject && evidence.length < AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE) {
        evidence.push(toSubject(subject));
      }
    }

    return { evidence, evidenceCount: seen.size };
  }

  // Fixes as the evidence behind an insight: their incidents and alerts.
  private static getFixEvidence(
    fixes: Array<AiActivityFixInput>,
    subjects: Map<string, AiActivitySubjectInput>,
  ): {
    subject?: AiActivitySubject | undefined;
    evidence?: Array<AiActivitySubject> | undefined;
    evidenceCount?: number | undefined;
  } {
    const found: { evidence: Array<AiActivitySubject>; evidenceCount: number } =
      this.getEvidence(fixes.map(getFixSubjectId), subjects);

    return found.evidence.length > 0
      ? {
          subject: found.evidence[0],
          evidence: found.evidence,
          evidenceCount: found.evidenceCount,
        }
      : {};
  }

  /*
   * What is worth knowing about the scope, before ranking (rankInsights):
   *
   *   1. a problem that keeps coming back — up at least
   *      AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN times and still coming
   *      up in the last 7 days — with why and what to do (at most
   *      AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS); Critical while it is
   *      getting worse;
   *   2. one part of the scope behind several problems and most of what
   *      came up;
   *   3. a problem that kept coming back and stopped after a fix that held;
   *   4. fixes that did not help, and fixes waiting for approval;
   *   5. fixes AI applied on its own;
   *   6. your team approved every fix AI proposed (none applied on its own,
   *      none dismissed, none failed): it could apply them itself;
   *   7. open High and Medium preventive findings: risks before they paged.
   */
  private static buildInsights(data: {
    input: AiActivityInsightsInput;
    problems: Array<BuiltProblem>;
    hotspots: Array<AiActivityHotspot>;
    occurrences: Array<AiActivityOccurrence>;
    fixes: Array<AiActivityFixInput>;
    subjects: Map<string, AiActivitySubjectInput>;
    totals: AiActivityInsightsTotals;
    preventiveInsights: Array<AiActivityPreventiveInsight>;
  }): Array<AiActivityInsight> {
    const insights: Array<AiActivityInsight> = [];
    const now: number = data.input.now.getTime();
    const total: number | undefined = data.totals.occurrences || undefined;

    // 3 first: a problem that stopped is not one that keeps coming back.
    const stoppedKeys: Set<string> = new Set<string>();

    for (const built of data.problems) {
      const problem: AiActivityProblem = built.problem;

      if (
        stoppedKeys.size >= AI_ACTIVITY_INSIGHTS_MAX_STOPPED_INSIGHTS ||
        problem.occurrenceCount < AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN
      ) {
        continue;
      }

      const subjectIds: Set<string> = new Set<string>(
        built.occurrences.map((occurrence: AiActivityOccurrence): string => {
          return occurrence.subject.id;
        }),
      );

      const heldFixes: Array<AiActivityFixInput> = data.fixes.filter(
        (fix: AiActivityFixInput): boolean => {
          const subjectId: string | undefined = getFixSubjectId(fix);
          return Boolean(
            subjectId &&
              subjectIds.has(subjectId) &&
              isAppliedFix(fix) &&
              fix.verificationStatus ===
                AutoRemediationVerificationStatus.Verified,
          );
        },
      );

      if (heldFixes.length === 0) {
        continue;
      }

      const getFixedAt: (fix: AiActivityFixInput) => Date = (
        fix: AiActivityFixInput,
      ): Date => {
        return fix.approvedAt || fix.createdAt;
      };

      const lastFix: AiActivityFixInput = [...heldFixes].sort(
        (a: AiActivityFixInput, b: AiActivityFixInput): number => {
          return getFixedAt(b).getTime() - getFixedAt(a).getTime();
        },
      )[0]!;
      const fixedAt: Date = getFixedAt(lastFix);
      const lastSeen: number = problem.lastSeenAt
        ? Date.parse(problem.lastSeenAt)
        : 0;

      if (
        lastSeen > fixedAt.getTime() ||
        now - fixedAt.getTime() <
          AI_ACTIVITY_INSIGHTS_STOPPED_MIN_DAYS * DAY_IN_MS
      ) {
        continue;
      }

      stoppedKeys.add(problem.key);
      insights.push({
        kind: AiActivityInsightKind.ProblemStopped,
        tone: AiActivityInsightTone.Positive,
        count: problem.occurrenceCount,
        problemKey: problem.key,
        title: problem.title,
        fixedAt: fixedAt.toISOString(),
        lastSeenAt: problem.lastSeenAt,
        ...this.getFixEvidence([lastFix], data.subjects),
      });
    }

    // 1. The same problem, again and again — and still.
    let recurring: number = 0;

    for (const built of data.problems) {
      const problem: AiActivityProblem = built.problem;

      if (
        recurring >= AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS ||
        problem.occurrenceCount <
          AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN ||
        problem.recentOccurrenceCount === 0 ||
        stoppedKeys.has(problem.key)
      ) {
        continue;
      }

      const isGettingWorse: boolean =
        problem.recentOccurrenceCount >=
          AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN &&
        problem.recentOccurrenceCount > problem.previousOccurrenceCount;

      const found: {
        evidence: Array<AiActivitySubject>;
        evidenceCount: number;
      } = this.getEvidence(
        built.occurrences.map((occurrence: AiActivityOccurrence): string => {
          return occurrence.subject.id;
        }),
        data.subjects,
      );

      insights.push({
        kind: AiActivityInsightKind.RecurringProblem,
        tone: isGettingWorse
          ? AiActivityInsightTone.Critical
          : AiActivityInsightTone.Warning,
        count: problem.occurrenceCount,
        ...(total ? { total } : {}),
        recentCount: problem.recentOccurrenceCount,
        previousCount: problem.previousOccurrenceCount,
        problemKey: problem.key,
        title: problem.title,
        firstSeenAt: problem.firstSeenAt,
        lastSeenAt: problem.lastSeenAt,
        ...(problem.latestFinding ? { finding: problem.latestFinding } : {}),
        ...(problem.latestNextStep ? { nextStep: problem.latestNextStep } : {}),
        ...(problem.timeOfDay ? { timeOfDay: problem.timeOfDay } : {}),
        ...(problem.objects.length > 0
          ? {
              objects: problem.objects.map(
                (object: AiActivityObject & { count: number }) => {
                  return toObject(object);
                },
              ),
            }
          : {}),
        subject: built.findingSubject
          ? toSubject(built.findingSubject)
          : problem.latestSubject,
        evidence: found.evidence,
        evidenceCount: problem.occurrenceCount,
      });
      recurring++;
    }

    /*
     * 2. One part of the scope behind several problems and most of what
     * came up — but not behind everything: a part in every incident (the
     * only node, the one namespace) says nothing.
     */
    const hotspot: AiActivityHotspot | undefined = this.pickBehindTheTrouble(
      data.hotspots,
      data.totals.occurrences,
    );

    if (hotspot) {
      const found: {
        evidence: Array<AiActivitySubject>;
        evidenceCount: number;
      } = this.getEvidence(
        data.occurrences
          .filter((occurrence: AiActivityOccurrence): boolean => {
            return this.getScopeObjects(
              occurrence.subject.seriesLabels,
              data.input,
            ).some((object: AiActivityObject): boolean => {
              return objectKey(object) === objectKey(hotspot);
            });
          })
          .map((occurrence: AiActivityOccurrence): string => {
            return occurrence.subject.id;
          }),
        data.subjects,
      );

      insights.push({
        kind: AiActivityInsightKind.Hotspot,
        tone: AiActivityInsightTone.Pattern,
        count: hotspot.occurrenceCount,
        total: data.totals.occurrences,
        problemCount: hotspot.problemCount,
        object: toObject(hotspot),
        lastSeenAt: hotspot.lastSeenAt,
        ...(found.evidence.length > 0
          ? {
              subject: found.evidence[0],
              evidence: found.evidence,
              evidenceCount: hotspot.occurrenceCount,
            }
          : {}),
      });
    }

    // 4. Fixes that were applied and did not fix it.
    const appliedFixes: Array<AiActivityFixInput> =
      data.fixes.filter(isAppliedFix);
    const failedFixes: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return (
          fix.verificationStatus === AutoRemediationVerificationStatus.Failed
        );
      },
    );

    if (failedFixes.length > 0) {
      insights.push({
        kind: AiActivityInsightKind.FixesDidNotHelp,
        tone: AiActivityInsightTone.Critical,
        count: failedFixes.length,
        ...(appliedFixes.length > 0 ? { total: appliedFixes.length } : {}),
        ...this.getFixEvidence(failedFixes, data.subjects),
      });
    }

    // 4. Fixes nobody has looked at yet.
    const awaiting: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.Suggested;
      },
    );

    if (awaiting.length > 0) {
      insights.push({
        kind: AiActivityInsightKind.FixesAwaitingApproval,
        tone: AiActivityInsightTone.Warning,
        count: awaiting.length,
        ...this.getFixEvidence(awaiting, data.subjects),
      });
    }

    /*
     * 5. What AI fixed without waiting for anyone — the fixes it applied on
     * its own that verification did not find wanting (one that did not help
     * is said above, never as good news).
     */
    const automatic: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.AutoExecuted;
      },
    );
    const automaticThatHeld: Array<AiActivityFixInput> = automatic.filter(
      (fix: AiActivityFixInput): boolean => {
        return (
          fix.verificationStatus !== AutoRemediationVerificationStatus.Failed
        );
      },
    );

    if (automaticThatHeld.length > 0) {
      insights.push({
        kind: AiActivityInsightKind.FixedAutomatically,
        tone: AiActivityInsightTone.Positive,
        count: automaticThatHeld.length,
        verifiedCount: automaticThatHeld.filter(
          (fix: AiActivityFixInput): boolean => {
            return (
              fix.verificationStatus ===
              AutoRemediationVerificationStatus.Verified
            );
          },
        ).length,
        ...this.getFixEvidence(automaticThatHeld, data.subjects),
      });
    }

    // 6. What AI would fix on its own, if it were allowed to.
    const approved: Array<AiActivityFixInput> = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.Approved;
      },
    );
    const dismissed: number = data.fixes.filter(
      (fix: AiActivityFixInput): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.Dismissed;
      },
    ).length;

    if (
      approved.length >=
        AI_ACTIVITY_INSIGHTS_READY_FOR_AUTOMATIC_MIN_APPROVED &&
      dismissed === 0 &&
      automatic.length === 0 &&
      !approved.some((fix: AiActivityFixInput): boolean => {
        return (
          fix.verificationStatus === AutoRemediationVerificationStatus.Failed
        );
      })
    ) {
      insights.push({
        kind: AiActivityInsightKind.ReadyForAutomaticFixes,
        tone: AiActivityInsightTone.Positive,
        count: approved.length,
        verifiedCount: approved.filter((fix: AiActivityFixInput): boolean => {
          return (
            fix.verificationStatus ===
            AutoRemediationVerificationStatus.Verified
          );
        }).length,
        ...this.getFixEvidence(approved, data.subjects),
      });
    }

    // 7. Risks the detectors spotted before anything paged.
    let risks: number = 0;

    for (const insight of data.preventiveInsights) {
      if (risks >= AI_ACTIVITY_INSIGHTS_MAX_RISK_INSIGHTS) {
        break;
      }

      if (
        insight.severity !== AIInsightSeverity.High &&
        insight.severity !== AIInsightSeverity.Medium
      ) {
        continue;
      }

      insights.push({
        kind: AiActivityInsightKind.RiskSpotted,
        tone:
          insight.severity === AIInsightSeverity.High
            ? AiActivityInsightTone.Critical
            : AiActivityInsightTone.Warning,
        count: insight.occurrenceCount || 1,
        title: insight.title,
        insightId: insight.id,
        insightSeverity: insight.severity,
        insightType: insight.insightType,
        ...(insight.lastSeenAt ? { lastSeenAt: insight.lastSeenAt } : {}),
      });
      risks++;
    }

    return insights;
  }
}

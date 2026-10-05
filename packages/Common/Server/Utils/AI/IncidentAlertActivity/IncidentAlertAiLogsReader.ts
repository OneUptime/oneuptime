import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Services/IncidentService";
import RunnerJobService from "../../../Services/RunnerJobService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import InvestigationReportSummary, {
  InvestigationReportSummaryRun,
} from "../SRE/InvestigationReportSummary";
import IncidentAlertAiLogsPage, {
  IncidentAlertAiLogsKindScan,
  IncidentAlertAiLogsPageResult,
} from "./IncidentAlertAiLogsPage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH,
  INCIDENT_ALERT_AI_LOGS_PAGE_SIZE,
  INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
  INCIDENT_ALERT_AI_LOG_KINDS,
  IncidentAlertAiLogEntry,
  IncidentAlertAiLogKind,
  IncidentAlertAiLogSubject,
  IncidentAlertAiLogs,
  IncidentAlertAiSubjectKind,
} from "../../../../Types/AI/IncidentAlertAiLogs";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";

/*
 * Reads one page of the AI Logs of a project's incidents, or of its alerts
 * (IncidentAlertAiLogs), and cuts it with IncidentAlertAiLogsPage.
 *
 * Who sees what:
 *
 *   - The caller must be able to read incidents (or alerts) at all, or the
 *     whole read is refused - checked first, under the caller's own,
 *     tenant-pinned props.
 *   - Every entry is about one incident or alert, and those are read under
 *     the caller's props (tenant, labels, private incidents): an entry
 *     about one the caller cannot read is left out.
 *   - AI runs (investigations and fix tasks) are read as root, the way the
 *     incident's own AI panel reads its investigation: an investigation run
 *     is private to its author in the AI run table, which would empty the
 *     page for exactly the people it is for. Only statuses, dates and the
 *     one-line finding leave, and only next to an incident or alert the
 *     caller may read - the same finding its AI panel shows them. A
 *     completed run without a TL;DR has its report's own Summary instead
 *     (InvestigationReportSummary), as a resource's AI Logs show it.
 *   - Fixes and commands are read under the caller's props: the suggestion
 *     and Runner job tables have read access of their own, and a caller
 *     without it gets that kind in hiddenKinds instead of rows. Which
 *     incident or alert a command was for is looked up as root (its AI run
 *     or suggestion), and the command is still only shown next to one the
 *     caller may read.
 *
 * Bounded: each kind reads INCIDENT_ALERT_AI_LOGS_SCAN_LIMIT rows a round,
 * and a page takes at most INCIDENT_ALERT_AI_LOGS_MAX_ROUNDS rounds to fill
 * (a caller who may read few of the incidents sees short pages, never a
 * slow one).
 */

export const INCIDENT_ALERT_AI_LOGS_SCAN_LIMIT: number = 100;

export const INCIDENT_ALERT_AI_LOGS_MAX_ROUNDS: number = 3;

const COMMAND_ORIGINS: Array<RunnerJobOrigin> = [
  RunnerJobOrigin.AiInvestigation,
  RunnerJobOrigin.AiRemediation,
];

export interface IncidentAlertAiLogsReadOptions {
  subjectKind: IncidentAlertAiSubjectKind;
  projectId: ObjectID;
  // The caller's own, tenant-pinned props.
  props: DatabaseCommonInteractionProps;
  before?: Date | undefined;
  kinds?: Array<IncidentAlertAiLogKind> | undefined;
  pageSize?: number | undefined;
  scanLimit?: number | undefined;
}

// One kind's rows as read: the subject each is about, and its entry.
interface ScannedRow {
  subjectId: string | undefined;
  createdAt: Date;
  toEntry: (subject: IncidentAlertAiLogSubject) => IncidentAlertAiLogEntry;
}

interface KindRead {
  kind: IncidentAlertAiLogKind;
  rows: Array<ScannedRow>;
  scanned: number;
  limit: number;
  oldestScannedAt?: Date | undefined;
}

// A read under the caller's props, which the permission layer may refuse.
interface PermittedRead<T> {
  isPermitted: boolean;
  rows: Array<T>;
}

async function readIfPermitted<T>(
  read: () => Promise<Array<T>>,
): Promise<PermittedRead<T>> {
  try {
    return { isPermitted: true, rows: await read() };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return { isPermitted: false, rows: [] };
    }

    throw error;
  }
}

function toIso(date: Date | undefined | null): string | undefined {
  if (!date) {
    return undefined;
  }

  const value: Date = new Date(date);

  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

// Text that leaves as is, cut to a length; undefined when there is none.
export function clipText(
  text: string | undefined | null,
  maxLength: number,
): string | undefined {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…`
    : trimmed;
}

/*
 * What a Runner job ran, the way its runner shows it: kubectl and resource
 * commands carry a displayCommand, an SSH command its command, and a Bash
 * command its script.
 */
export function getJobCommand(job: {
  payload?: JSONObject | undefined | null;
  script?: string | undefined | null;
}): string | undefined {
  const payload: JSONObject = (job.payload || {}) as JSONObject;

  for (const candidate of [
    payload["displayCommand"],
    payload["command"],
    job.script,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return clipText(candidate, INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH);
    }
  }

  return undefined;
}

function oldestOf(
  rows: Array<{ createdAt?: Date | undefined }>,
): Date | undefined {
  let oldest: Date | undefined = undefined;

  for (const row of rows) {
    if (!row.createdAt) {
      continue;
    }

    const createdAt: Date = new Date(row.createdAt);

    if (!oldest || createdAt.getTime() < oldest.getTime()) {
      oldest = createdAt;
    }
  }

  return oldest;
}

export default class IncidentAlertAiLogsReader {
  public static async read(
    options: IncidentAlertAiLogsReadOptions,
  ): Promise<IncidentAlertAiLogs> {
    const pageSize: number =
      options.pageSize || INCIDENT_ALERT_AI_LOGS_PAGE_SIZE;
    const kinds: Array<IncidentAlertAiLogKind> = this.getKinds(options.kinds);

    await this.assertCanReadSubjects(options);

    const hiddenKinds: Set<IncidentAlertAiLogKind> =
      new Set<IncidentAlertAiLogKind>();
    const entries: Array<IncidentAlertAiLogEntry> = [];
    let before: Date | undefined = options.before;
    let nextBefore: string | null = null;

    for (
      let round: number = 0;
      round < INCIDENT_ALERT_AI_LOGS_MAX_ROUNDS;
      round++
    ) {
      const scans: Array<IncidentAlertAiLogsKindScan> = await this.scan({
        options,
        kinds,
        before,
        hiddenKinds,
      });

      const page: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
        {
          scans,
          pageSize: pageSize - entries.length,
          before,
        },
      );

      entries.push(...page.entries);
      nextBefore = page.nextBefore;

      if (!nextBefore || entries.length >= pageSize) {
        break;
      }

      before = new Date(nextBefore);
    }

    await this.readReportSummaries({ options, entries });

    return {
      subjectKind: options.subjectKind,
      entries,
      nextBefore,
      hiddenKinds: INCIDENT_ALERT_AI_LOG_KINDS.filter(
        (kind: IncidentAlertAiLogKind): boolean => {
          return hiddenKinds.has(kind);
        },
      ),
    };
  }

  /*
   * A completed investigation whose TL;DR call failed still published a
   * report on its incident (or alert), and that report's own Summary stands
   * in for the finding. Only the page's own entries are read, and every one
   * is about an incident (or alert) the caller may read.
   */
  public static async readReportSummaries(data: {
    options: Pick<IncidentAlertAiLogsReadOptions, "subjectKind" | "projectId">;
    entries: Array<IncidentAlertAiLogEntry>;
  }): Promise<void> {
    const missing: Array<IncidentAlertAiLogEntry> = data.entries.filter(
      (entry: IncidentAlertAiLogEntry): boolean => {
        return (
          entry.kind === IncidentAlertAiLogKind.Investigation &&
          entry.status === AIRunStatus.Completed &&
          !entry.summary
        );
      },
    );

    if (missing.length === 0) {
      return;
    }

    const summaries: Map<string, string> =
      await InvestigationReportSummary.getForRuns({
        projectId: data.options.projectId,
        runs: missing.map(
          (entry: IncidentAlertAiLogEntry): InvestigationReportSummaryRun => {
            return {
              aiRunId: new ObjectID(entry.id),
              ...(data.options.subjectKind === "incident"
                ? { incidentId: new ObjectID(entry.subject.id) }
                : { alertId: new ObjectID(entry.subject.id) }),
            };
          },
        ),
      });

    for (const entry of missing) {
      const summary: string | undefined = clipText(
        summaries.get(entry.id),
        INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
      );

      if (summary) {
        entry.reportSummary = summary;
      }
    }
  }

  // The kinds asked for, in the record's own order; every kind by default.
  public static getKinds(
    requested: Array<IncidentAlertAiLogKind> | undefined,
  ): Array<IncidentAlertAiLogKind> {
    if (!requested || requested.length === 0) {
      return [...INCIDENT_ALERT_AI_LOG_KINDS];
    }

    return INCIDENT_ALERT_AI_LOG_KINDS.filter(
      (kind: IncidentAlertAiLogKind): boolean => {
        return requested.includes(kind);
      },
    );
  }

  /*
   * Refuses a caller who may not read incidents (or alerts) at all, the
   * way a list of them would. A caller whose labels reach none of them may
   * read: their record is simply empty.
   */
  public static async assertCanReadSubjects(data: {
    subjectKind: IncidentAlertAiSubjectKind;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.subjectKind === "incident") {
      await IncidentService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true },
        limit: 1,
        skip: 0,
        props: data.props,
      });
      return;
    }

    await AlertService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true },
      limit: 1,
      skip: 0,
      props: data.props,
    });
  }

  private static async scan(data: {
    options: IncidentAlertAiLogsReadOptions;
    kinds: Array<IncidentAlertAiLogKind>;
    before: Date | undefined;
    hiddenKinds: Set<IncidentAlertAiLogKind>;
  }): Promise<Array<IncidentAlertAiLogsKindScan>> {
    const { options } = data;
    const limit: number =
      options.scanLimit || INCIDENT_ALERT_AI_LOGS_SCAN_LIMIT;

    const reads: Array<KindRead | null> = await Promise.all(
      data.kinds.map(
        async (kind: IncidentAlertAiLogKind): Promise<KindRead | null> => {
          const read: KindRead | null = await this.readKind({
            kind,
            options,
            before: data.before,
            limit,
          });

          if (!read) {
            data.hiddenKinds.add(kind);
          }

          return read;
        },
      ),
    );

    const kindReads: Array<KindRead> = reads.filter(
      (read: KindRead | null): read is KindRead => {
        return Boolean(read);
      },
    );

    const subjects: Map<string, IncidentAlertAiLogSubject> =
      await this.readSubjects({
        options,
        subjectIds: kindReads.flatMap((read: KindRead): Array<string> => {
          return read.rows
            .map((row: ScannedRow): string => {
              return row.subjectId || "";
            })
            .filter((id: string): boolean => {
              return Boolean(id);
            });
        }),
      });

    return kindReads.map((read: KindRead): IncidentAlertAiLogsKindScan => {
      return {
        kind: read.kind,
        scanned: read.scanned,
        limit: read.limit,
        oldestScannedAt: read.oldestScannedAt,
        entries: read.rows
          .filter((row: ScannedRow): boolean => {
            return Boolean(row.subjectId && subjects.has(row.subjectId));
          })
          .map((row: ScannedRow): IncidentAlertAiLogEntry => {
            return row.toEntry(subjects.get(row.subjectId!)!);
          }),
      };
    });
  }

  // One kind's rows, or null when the caller may not read that kind.
  private static async readKind(data: {
    kind: IncidentAlertAiLogKind;
    options: IncidentAlertAiLogsReadOptions;
    before: Date | undefined;
    limit: number;
  }): Promise<KindRead | null> {
    switch (data.kind) {
      case IncidentAlertAiLogKind.Investigation:
      case IncidentAlertAiLogKind.FixTask:
        return this.readRuns(data);
      case IncidentAlertAiLogKind.Fix:
        return this.readFixes(data);
      case IncidentAlertAiLogKind.Command:
        return this.readCommands(data);
      default:
        return null;
    }
  }

  // The AI run columns that name an incident or an alert as its subject.
  public static getRunSubjectQuery(
    subjectKind: IncidentAlertAiSubjectKind,
  ): Record<string, unknown> {
    // A run about both is the incident's: it never shows as an alert's.
    return subjectKind === "incident"
      ? { triggeredByIncidentId: QueryHelper.notNull() }
      : {
          triggeredByAlertId: QueryHelper.notNull(),
          triggeredByIncidentId: QueryHelper.isNull(),
        };
  }

  public static getRunSubjectId(
    subjectKind: IncidentAlertAiSubjectKind,
    run: Pick<AIRun, "triggeredByIncidentId" | "triggeredByAlertId">,
  ): string | undefined {
    if (subjectKind === "incident") {
      return run.triggeredByIncidentId?.toString() || undefined;
    }

    return run.triggeredByIncidentId
      ? undefined
      : run.triggeredByAlertId?.toString() || undefined;
  }

  private static getCreatedAtQuery(
    before: Date | undefined,
  ): Record<string, unknown> {
    return before ? { createdAt: QueryHelper.lessThan(before) } : {};
  }

  // Investigations and fix tasks, read as root (see the top of this file).
  private static async readRuns(data: {
    kind: IncidentAlertAiLogKind;
    options: IncidentAlertAiLogsReadOptions;
    before: Date | undefined;
    limit: number;
  }): Promise<KindRead> {
    const { options } = data;
    const isInvestigation: boolean =
      data.kind === IncidentAlertAiLogKind.Investigation;

    const runs: Array<AIRun> = await AIRunService.findBy({
      query: {
        ...this.getRunSubjectQuery(options.subjectKind),
        ...this.getCreatedAtQuery(data.before),
        projectId: options.projectId,
        runType: isInvestigation ? AIRunType.Investigation : AIRunType.CodeFix,
      } as never,
      select: {
        _id: true,
        createdAt: true,
        completedAt: true,
        status: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        ...(isInvestigation
          ? { analysisTldr: true, humanVerdict: true, autoGrade: true }
          : { taskNumber: true, codeFixTaskType: true }),
      },
      sort: { createdAt: SortOrder.Descending },
      limit: data.limit,
      skip: 0,
      props: { isRoot: true },
    });

    return {
      kind: data.kind,
      scanned: runs.length,
      limit: data.limit,
      oldestScannedAt: oldestOf(runs),
      rows: runs
        .filter((run: AIRun): boolean => {
          return Boolean(run.id && run.createdAt);
        })
        .map((run: AIRun): ScannedRow => {
          return {
            subjectId: this.getRunSubjectId(options.subjectKind, run),
            createdAt: new Date(run.createdAt!),
            toEntry: (
              subject: IncidentAlertAiLogSubject,
            ): IncidentAlertAiLogEntry => {
              return {
                kind: data.kind,
                id: run.id!.toString(),
                at: toIso(run.createdAt)!,
                subject,
                status: run.status || undefined,
                completedAt: toIso(run.completedAt),
                ...(isInvestigation
                  ? {
                      summary: clipText(
                        run.analysisTldr,
                        INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
                      ),
                      humanVerdict: run.humanVerdict || undefined,
                      autoGrade: run.autoGrade || undefined,
                    }
                  : {
                      taskNumber:
                        typeof run.taskNumber === "number"
                          ? run.taskNumber
                          : undefined,
                      codeFixTaskType: run.codeFixTaskType || undefined,
                    }),
              };
            },
          };
        }),
    };
  }

  private static getSuggestionSubjectQuery(
    subjectKind: IncidentAlertAiSubjectKind,
  ): Record<string, unknown> {
    return subjectKind === "incident"
      ? { incidentId: QueryHelper.notNull() }
      : { alertId: QueryHelper.notNull(), incidentId: QueryHelper.isNull() };
  }

  private static getSuggestionSubjectId(
    subjectKind: IncidentAlertAiSubjectKind,
    suggestion: Pick<AutoRemediationSuggestion, "incidentId" | "alertId">,
  ): string | undefined {
    if (subjectKind === "incident") {
      return suggestion.incidentId?.toString() || undefined;
    }

    return suggestion.incidentId
      ? undefined
      : suggestion.alertId?.toString() || undefined;
  }

  // The fixes AI proposed or applied, under the caller's props.
  private static async readFixes(data: {
    kind: IncidentAlertAiLogKind;
    options: IncidentAlertAiLogsReadOptions;
    before: Date | undefined;
    limit: number;
  }): Promise<KindRead | null> {
    const { options } = data;

    const read: PermittedRead<AutoRemediationSuggestion> =
      await readIfPermitted<AutoRemediationSuggestion>(() => {
        return AutoRemediationSuggestionService.findBy({
          query: {
            ...this.getSuggestionSubjectQuery(options.subjectKind),
            ...this.getCreatedAtQuery(data.before),
            projectId: options.projectId,
          } as never,
          select: {
            _id: true,
            createdAt: true,
            status: true,
            executionMode: true,
            suggestionType: true,
            rationaleMarkdown: true,
            verificationStatus: true,
            runbookNameSnapshot: true,
            ruleNameSnapshot: true,
            incidentId: true,
            alertId: true,
          },
          sort: { createdAt: SortOrder.Descending },
          limit: data.limit,
          skip: 0,
          props: options.props,
        });
      });

    if (!read.isPermitted) {
      return null;
    }

    return {
      kind: data.kind,
      scanned: read.rows.length,
      limit: data.limit,
      oldestScannedAt: oldestOf(read.rows),
      rows: read.rows
        .filter((suggestion: AutoRemediationSuggestion): boolean => {
          return Boolean(suggestion.id && suggestion.createdAt);
        })
        .map((suggestion: AutoRemediationSuggestion): ScannedRow => {
          return {
            subjectId: this.getSuggestionSubjectId(
              options.subjectKind,
              suggestion,
            ),
            createdAt: new Date(suggestion.createdAt!),
            toEntry: (
              subject: IncidentAlertAiLogSubject,
            ): IncidentAlertAiLogEntry => {
              return {
                kind: IncidentAlertAiLogKind.Fix,
                id: suggestion.id!.toString(),
                at: toIso(suggestion.createdAt)!,
                subject,
                status: suggestion.status || undefined,
                suggestionType: suggestion.suggestionType || undefined,
                executionMode: suggestion.executionMode || undefined,
                rationale: clipText(
                  suggestion.rationaleMarkdown,
                  INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
                ),
                verificationStatus: suggestion.verificationStatus || undefined,
                runbookName: clipText(
                  suggestion.runbookNameSnapshot,
                  INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
                ),
                ruleName: clipText(
                  suggestion.ruleNameSnapshot,
                  INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
                ),
              };
            },
          };
        }),
    };
  }

  /*
   * The commands AI ran while investigating or fixing, under the caller's
   * props, each with the incident or alert it was for: its suggestion's,
   * else its AI run's. A connection test (no run, no suggestion) and a
   * command for anything else (a chat, an insight's triage) have none and
   * are left out.
   */
  private static async readCommands(data: {
    kind: IncidentAlertAiLogKind;
    options: IncidentAlertAiLogsReadOptions;
    before: Date | undefined;
    limit: number;
  }): Promise<KindRead | null> {
    const { options } = data;

    const read: PermittedRead<RunnerJob> = await readIfPermitted<RunnerJob>(
      () => {
        return RunnerJobService.findBy({
          query: {
            ...this.getCreatedAtQuery(data.before),
            projectId: options.projectId,
            origin: QueryHelper.any(COMMAND_ORIGINS),
          } as never,
          select: {
            _id: true,
            createdAt: true,
            status: true,
            origin: true,
            aiRunId: true,
            autoRemediationSuggestionId: true,
            payload: true,
            script: true,
            exitCode: true,
            errorMessage: true,
          },
          sort: { createdAt: SortOrder.Descending },
          limit: data.limit,
          skip: 0,
          props: options.props,
        });
      },
    );

    if (!read.isPermitted) {
      return null;
    }

    const jobs: Array<RunnerJob> = read.rows.filter(
      (job: RunnerJob): boolean => {
        return Boolean(job.id && job.createdAt);
      },
    );

    const subjectOfJob: Map<string, string> = await this.getJobSubjects({
      subjectKind: options.subjectKind,
      projectId: options.projectId,
      jobs,
    });

    return {
      kind: data.kind,
      scanned: read.rows.length,
      limit: data.limit,
      oldestScannedAt: oldestOf(read.rows),
      rows: jobs.map((job: RunnerJob): ScannedRow => {
        return {
          subjectId: subjectOfJob.get(job.id!.toString()),
          createdAt: new Date(job.createdAt!),
          toEntry: (
            subject: IncidentAlertAiLogSubject,
          ): IncidentAlertAiLogEntry => {
            return {
              kind: IncidentAlertAiLogKind.Command,
              id: job.id!.toString(),
              at: toIso(job.createdAt)!,
              subject,
              status: job.status || undefined,
              command: getJobCommand(job),
              commandOrigin: job.origin || undefined,
              exitCode:
                typeof job.exitCode === "number" ? job.exitCode : undefined,
              errorMessage: clipText(
                job.errorMessage,
                INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
              ),
            };
          },
        };
      }),
    };
  }

  /*
   * Which incident or alert each job was for, by job id, read as root: only
   * the subject's id is taken from the suggestion or the run.
   */
  private static async getJobSubjects(data: {
    subjectKind: IncidentAlertAiSubjectKind;
    projectId: ObjectID;
    jobs: Array<RunnerJob>;
  }): Promise<Map<string, string>> {
    const runIds: Map<string, ObjectID> = new Map<string, ObjectID>();
    const suggestionIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const job of data.jobs) {
      if (job.autoRemediationSuggestionId) {
        suggestionIds.set(
          job.autoRemediationSuggestionId.toString(),
          job.autoRemediationSuggestionId,
        );
      }

      if (job.aiRunId) {
        runIds.set(job.aiRunId.toString(), job.aiRunId);
      }
    }

    const [runs, suggestions]: [
      Array<AIRun>,
      Array<AutoRemediationSuggestion>,
    ] = await Promise.all([
      runIds.size > 0
        ? AIRunService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(Array.from(runIds.values())),
            } as never,
            select: {
              _id: true,
              triggeredByIncidentId: true,
              triggeredByAlertId: true,
              triggeredByAutoRemediationSuggestionId: true,
            },
            limit: runIds.size,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      suggestionIds.size > 0
        ? AutoRemediationSuggestionService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(Array.from(suggestionIds.values())),
            } as never,
            select: { _id: true, incidentId: true, alertId: true },
            limit: suggestionIds.size,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const runsById: Map<string, AIRun> = new Map<string, AIRun>();

    for (const run of runs) {
      if (run.id) {
        runsById.set(run.id.toString(), run);
      }
    }

    // A remediation run's subject is its suggestion's.
    const missingSuggestions: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const run of runs) {
      const suggestionId: ObjectID | undefined =
        run.triggeredByAutoRemediationSuggestionId;

      if (suggestionId && !suggestionIds.has(suggestionId.toString())) {
        missingSuggestions.set(suggestionId.toString(), suggestionId);
      }
    }

    const moreSuggestions: Array<AutoRemediationSuggestion> =
      missingSuggestions.size > 0
        ? await AutoRemediationSuggestionService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(Array.from(missingSuggestions.values())),
            } as never,
            select: { _id: true, incidentId: true, alertId: true },
            limit: missingSuggestions.size,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    const suggestionSubjects: Map<string, string | undefined> = new Map<
      string,
      string | undefined
    >();

    for (const suggestion of [...suggestions, ...moreSuggestions]) {
      if (suggestion.id) {
        suggestionSubjects.set(
          suggestion.id.toString(),
          this.getSuggestionSubjectId(data.subjectKind, suggestion),
        );
      }
    }

    const subjects: Map<string, string> = new Map<string, string>();

    for (const job of data.jobs) {
      let subjectId: string | undefined = undefined;
      const run: AIRun | undefined = job.aiRunId
        ? runsById.get(job.aiRunId.toString())
        : undefined;
      const suggestionId: string | undefined =
        job.autoRemediationSuggestionId?.toString() ||
        run?.triggeredByAutoRemediationSuggestionId?.toString();

      if (suggestionId) {
        subjectId = suggestionSubjects.get(suggestionId);
      } else if (run) {
        subjectId = this.getRunSubjectId(data.subjectKind, run);
      }

      if (subjectId) {
        subjects.set(job.id!.toString(), subjectId);
      }
    }

    return subjects;
  }

  /*
   * The incidents (or alerts) the entries are about, read under the
   * caller's props: one the caller cannot read is simply not here.
   */
  private static async readSubjects(data: {
    options: IncidentAlertAiLogsReadOptions;
    subjectIds: Array<string>;
  }): Promise<Map<string, IncidentAlertAiLogSubject>> {
    const { options } = data;
    const subjects: Map<string, IncidentAlertAiLogSubject> = new Map<
      string,
      IncidentAlertAiLogSubject
    >();
    const ids: Array<ObjectID> = Array.from(new Set(data.subjectIds)).map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    if (ids.length === 0) {
      return subjects;
    }

    if (options.subjectKind === "incident") {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: { projectId: options.projectId, _id: QueryHelper.any(ids) },
        select: {
          _id: true,
          title: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        limit: ids.length,
        skip: 0,
        props: options.props,
      });

      for (const incident of incidents) {
        if (!incident.id) {
          continue;
        }

        subjects.set(incident.id.toString(), {
          kind: "incident",
          id: incident.id.toString(),
          title: incident.title || undefined,
          number:
            typeof incident.incidentNumber === "number"
              ? incident.incidentNumber
              : undefined,
          numberWithPrefix: incident.incidentNumberWithPrefix || undefined,
        });
      }

      return subjects;
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: { projectId: options.projectId, _id: QueryHelper.any(ids) },
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      limit: ids.length,
      skip: 0,
      props: options.props,
    });

    for (const alert of alerts) {
      if (!alert.id) {
        continue;
      }

      subjects.set(alert.id.toString(), {
        kind: "alert",
        id: alert.id.toString(),
        title: alert.title || undefined,
        number:
          typeof alert.alertNumber === "number" ? alert.alertNumber : undefined,
        numberWithPrefix: alert.alertNumberWithPrefix || undefined,
      });
    }

    return subjects;
  }
}

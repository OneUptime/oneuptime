import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Services/IncidentService";
import LlmLogService from "../../../Services/LlmLogService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import InvestigationReportSummary, {
  InvestigationReportSummaryRun,
} from "../SRE/InvestigationReportSummary";
import AiOutcomesBuilder, {
  AiOutcomesInvestigationRow,
  AiOutcomesPageRow,
  AiOutcomesPullRequestRow,
  AiOutcomesRemediationRow,
  AiOutcomesSubjectKey,
  getSubjectKey,
} from "./AiOutcomesBuilder";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  AI_OUTCOMES_PARTS,
  AI_OUTCOMES_RECORDS_PAGE_SIZE,
  AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomes,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecordSubject,
  AiOutcomesRecords,
  isAiOutcomesPartOutcome,
} from "../../../../Types/AI/AiOutcomes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Reads what the AI Results page counts (Types/AI/AiOutcomes) and hands it
 * to AiOutcomesBuilder, and the records each of its numbers opens
 * (readRecords, #7768). Who sees what:
 *
 *   - held pages (on-call policy runs with an AI hold) are read under the
 *     caller's props: a role, or a plan, without on-call runs gets no page
 *     numbers (null), not zeros;
 *   - fixes AI ran, and its fix pull requests, likewise under the caller's
 *     props;
 *   - investigations are read as root (an AI run is private to its author
 *     in the run table), and so is the fix task each fix pull request was
 *     opened by, for what it was about; only dates, grades, verdicts and
 *     models leave;
 *   - and each of them counts only when the caller may read the incident or
 *     alert it was about - labels and private incidents included - because
 *     a number opens what it counts: the held pages and investigations of a
 *     caller who may read neither incidents nor alerts are left out (null),
 *     and a fix pull request about neither (an exception's) still counts;
 *   - the models investigations ran on are named only to a caller who may
 *     read the project's AI Logs, where each call's model is listed (#7762).
 *
 * The counts carry no title, rationale or report. The records a number
 * opens are read by the same rows and filters, so they are exactly what it
 * counts, and carry what the reader may see of each: the incident or alert
 * with its title, the fix's runbook, the pull request's title, and an
 * investigation's one-line finding, as its AI panel shows it.
 *
 * Bounded: the window's newest AI_OUTCOMES_SCAN_LIMIT rows of each kind;
 * reaching it marks the outcomes partial, and the records of a number come
 * from the same newest rows.
 */

export interface AiOutcomesReadOptions {
  projectId: ObjectID;
  // The caller's own, tenant-pinned props.
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
}

export interface AiOutcomesRecordsReadOptions extends AiOutcomesReadOptions {
  part: AiOutcomesPart;
  // The key of the number's count in its part's counts ("holdTimeRanOut").
  outcome: string;
  /*
   * When the number was counted (its outcomes' windowEnd): the records come
   * from the same window, and work started since is not among them. Now
   * when left out; never later than now.
   */
  windowEnd?: Date | undefined;
  // The records the reader already has, newest first.
  skip?: number | undefined;
  pageSize?: number | undefined;
}

async function readIfPermitted<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof PaymentRequiredException
    ) {
      return null;
    }

    throw error;
  }
}

interface SubjectIds {
  incidentIds: Array<string>;
  alertIds: Array<string>;
}

interface ReadableSubjects {
  // Null: the caller may not read the kind at all.
  incidentIds: Set<string> | null;
  alertIds: Set<string> | null;
}

/*
 * The rows the page counts, as read and filtered for the caller: null for
 * a part the caller may not read.
 */
export interface AiOutcomesCountedRows {
  pageLogs: Array<OnCallDutyPolicyExecutionLog> | null;
  suggestions: Array<AutoRemediationSuggestion> | null;
  pullRequests: Array<AIAgentTaskPullRequest> | null;
  investigations: Array<AIRun> | null;
  /*
   * The fix task each counted pull request was opened by, by the task's
   * run id: when it started, and the incident or alert it was for.
   */
  fixTaskRuns: Map<string, AIRun>;
  // A kind of row reached AI_OUTCOMES_SCAN_LIMIT.
  isPartial: boolean;
}

// A row of the part a number counts, with what its record is made of.
interface CountedRecord {
  id: string;
  createdAt: Date;
  outcome: string | null;
  subjectKey?: AiOutcomesSubjectKey | undefined;
}

function toDate(value: Date | undefined): Date {
  return new Date(value as Date);
}

function clipText(
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

const WEB_ADDRESS: RegExp = /^https?:\/\//i;

// What getSubjectKey writes: "incident:<id>" or "alert:<id>".
const SUBJECT_KEY: RegExp = /^(incident|alert):(.+)$/;

// A link only when it is a web address: a pull request's URL as stored.
function toWebUrl(value: unknown): string | undefined {
  const text: string = value ? value.toString() : "";

  return WEB_ADDRESS.test(text) ? text : undefined;
}

function parseSubjectKey(
  key: AiOutcomesSubjectKey | undefined,
): { kind: "incident" | "alert"; id: string } | null {
  const match: RegExpExecArray | null = SUBJECT_KEY.exec(key || "");

  return match
    ? { kind: match[1] as "incident" | "alert", id: match[2]! }
    : null;
}

export default class AiOutcomesReader {
  public static async read(
    options: AiOutcomesReadOptions,
  ): Promise<AiOutcomes> {
    const now: Date = options.now || new Date();

    const [rows, canReadModels]: [AiOutcomesCountedRows, boolean] =
      await Promise.all([
        this.readCountedRows({
          projectId: options.projectId,
          props: options.props,
          now,
          parts: AI_OUTCOMES_PARTS,
        }),
        this.canReadModels(options),
      ]);

    return AiOutcomesBuilder.build({
      now,
      pageRows: rows.pageLogs
        ? rows.pageLogs.map(
            (log: OnCallDutyPolicyExecutionLog): AiOutcomesPageRow => {
              return {
                createdAt: toDate(log.createdAt),
                outcome: log.aiHoldOutcome,
              };
            },
          )
        : null,
      remediationRows: rows.suggestions
        ? rows.suggestions.map(
            (
              suggestion: AutoRemediationSuggestion,
            ): AiOutcomesRemediationRow => {
              return {
                createdAt: toDate(suggestion.createdAt),
                verificationStatus: suggestion.verificationStatus,
                subjectKey: getSubjectKey(
                  suggestion.incidentId,
                  suggestion.alertId,
                ),
              };
            },
          )
        : null,
      pullRequestRows: rows.pullRequests
        ? rows.pullRequests.map(
            (pullRequest: AIAgentTaskPullRequest): AiOutcomesPullRequestRow => {
              const fixTask: AIRun | undefined = this.getFixTask(
                rows,
                pullRequest,
              );

              return {
                createdAt: toDate(pullRequest.createdAt),
                productionStatus: pullRequest.productionStatus,
                subjectKey: this.getFixTaskSubjectKey(fixTask),
                ...(fixTask?.createdAt
                  ? { fixStartedAt: toDate(fixTask.createdAt) }
                  : {}),
              };
            },
          )
        : null,
      investigationRows: rows.investigations
        ? rows.investigations.map((run: AIRun): AiOutcomesInvestigationRow => {
            return {
              createdAt: toDate(run.createdAt),
              autoGrade: run.autoGrade,
              humanVerdict: run.humanVerdict,
              modelName: run.modelName || undefined,
              subjectKey: getSubjectKey(
                run.triggeredByIncidentId,
                run.triggeredByAlertId,
              ),
            };
          })
        : null,
      isPartial: rows.isPartial,
      canReadModels,
    });
  }

  /*
   * The records one number counts (#7768): the rows of its part that count
   * under its outcome, newest first, a page at a time, each with what the
   * caller may see of it. `total` is the number itself.
   */
  public static async readRecords(
    options: AiOutcomesRecordsReadOptions,
  ): Promise<AiOutcomesRecords> {
    const { part, outcome, projectId, props } = options;

    if (!AI_OUTCOMES_PARTS.includes(part)) {
      throw new BadDataException(
        `part must be one of: ${AI_OUTCOMES_PARTS.join(", ")}.`,
      );
    }

    if (!isAiOutcomesPartOutcome(part, outcome)) {
      throw new BadDataException(
        `${outcome} is not an outcome of ${part}. Ask for one the page counts.`,
      );
    }

    const now: Date = options.now || new Date();
    const windowEnd: Date =
      options.windowEnd && options.windowEnd.getTime() < now.getTime()
        ? options.windowEnd
        : now;
    const skip: number = Math.max(0, Math.floor(options.skip || 0));
    const pageSize: number = Math.max(
      1,
      Math.floor(options.pageSize || AI_OUTCOMES_RECORDS_PAGE_SIZE),
    );

    const rows: AiOutcomesCountedRows = await this.readCountedRows({
      projectId,
      props,
      now: windowEnd,
      windowEnd,
      parts: [part],
    });

    const counted: Array<CountedRecord> | null = this.getCountedRecords(
      part,
      rows,
    );

    if (!counted) {
      throw new NotAuthorizedException(
        "Your role cannot read what this number counts. A Project Admin can give you access.",
      );
    }

    const matching: Array<CountedRecord> = counted
      .filter((record: CountedRecord): boolean => {
        return (
          record.outcome === outcome &&
          AiOutcomesBuilder.isInWindow(windowEnd, record.createdAt)
        );
      })
      .sort((a: CountedRecord, b: CountedRecord): number => {
        return (
          b.createdAt.getTime() - a.createdAt.getTime() ||
          a.id.localeCompare(b.id)
        );
      });

    const page: Array<CountedRecord> = matching.slice(skip, skip + pageSize);

    const records: Array<AiOutcomesRecord> = await this.toRecords({
      projectId,
      props,
      part,
      page,
    });

    return {
      part,
      outcome,
      total: matching.length,
      records,
      nextSkip:
        skip + page.length < matching.length ? skip + page.length : null,
    };
  }

  /*
   * Whether the caller may read the project's AI Logs (LlmLog), where each
   * call's model is listed: the page names models only to them (#7762).
   */
  public static async canReadModels(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    const logs: Array<LlmLog> | null = await readIfPermitted<Array<LlmLog>>(
      () => {
        return LlmLogService.findBy({
          query: { projectId: data.projectId },
          select: { _id: true },
          limit: 1,
          skip: 0,
          props: data.props,
        });
      },
    );

    return logs !== null;
  }

  /*
   * The rows of the parts asked for, newest first, read and filtered for
   * the caller as the top of this file says. A number and the records it
   * opens both come from here.
   */
  public static async readCountedRows(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now: Date;
    // When set, rows created after it are not read: the window ends there.
    windowEnd?: Date | undefined;
    parts: ReadonlyArray<AiOutcomesPart>;
  }): Promise<AiOutcomesCountedRows> {
    const { projectId, props, parts } = data;
    const windowStart: Date = AiOutcomesBuilder.getWindowStart(data.now);

    const inWindow: Record<string, unknown> = {
      projectId,
      createdAt: data.windowEnd
        ? QueryHelper.inBetween(windowStart, data.windowEnd)
        : QueryHelper.greaterThanEqualTo(windowStart),
    };

    const wants: (part: AiOutcomesPart) => boolean = (
      part: AiOutcomesPart,
    ): boolean => {
      return parts.includes(part);
    };

    const [pageLogs, suggestions, pullRequests, investigations]: [
      Array<OnCallDutyPolicyExecutionLog> | null,
      Array<AutoRemediationSuggestion> | null,
      Array<AIAgentTaskPullRequest> | null,
      Array<AIRun> | null,
    ] = await Promise.all([
      wants(AiOutcomesPart.Pages)
        ? readIfPermitted<Array<OnCallDutyPolicyExecutionLog>>(() => {
            return OnCallDutyPolicyExecutionLogService.findBy({
              query: {
                ...inWindow,
                aiHoldOutcome: QueryHelper.notNull(),
              } as never,
              select: {
                _id: true,
                createdAt: true,
                aiHoldOutcome: true,
                triggeredByIncidentId: true,
                triggeredByAlertId: true,
              },
              sort: { createdAt: SortOrder.Descending },
              limit: AI_OUTCOMES_SCAN_LIMIT,
              skip: 0,
              props,
            });
          })
        : Promise.resolve(null),
      wants(AiOutcomesPart.RemediationFixes)
        ? readIfPermitted<Array<AutoRemediationSuggestion>>(() => {
            return AutoRemediationSuggestionService.findBy({
              query: {
                ...inWindow,
                verificationStatus: QueryHelper.notNull(),
              } as never,
              // Statuses and dates only: never a rationale or a command plan.
              select: {
                _id: true,
                createdAt: true,
                verificationStatus: true,
                incidentId: true,
                alertId: true,
              },
              sort: { createdAt: SortOrder.Descending },
              limit: AI_OUTCOMES_SCAN_LIMIT,
              skip: 0,
              props,
            });
          })
        : Promise.resolve(null),
      wants(AiOutcomesPart.PullRequestFixes)
        ? readIfPermitted<Array<AIAgentTaskPullRequest>>(() => {
            return AIAgentTaskPullRequestService.findBy({
              query: {
                ...inWindow,
                productionStatus: QueryHelper.notNull(),
              } as never,
              select: {
                _id: true,
                createdAt: true,
                productionStatus: true,
                aiRunId: true,
              },
              sort: { createdAt: SortOrder.Descending },
              limit: AI_OUTCOMES_SCAN_LIMIT,
              skip: 0,
              props,
            });
          })
        : Promise.resolve(null),
      // Also what the fixes on the page came from, for their models.
      wants(AiOutcomesPart.RootCauses)
        ? AIRunService.findBy({
            query: {
              ...inWindow,
              runType: AIRunType.Investigation,
              status: AIRunStatus.Completed,
            } as never,
            select: {
              _id: true,
              createdAt: true,
              autoGrade: true,
              humanVerdict: true,
              modelName: true,
              triggeredByIncidentId: true,
              triggeredByAlertId: true,
            },
            sort: { createdAt: SortOrder.Descending },
            limit: AI_OUTCOMES_SCAN_LIMIT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve(null),
    ]);

    const fixTaskRuns: Map<string, AIRun> = await this.readFixTaskRuns({
      projectId,
      pullRequests: pullRequests || [],
    });

    const readable: ReadableSubjects = await this.readReadableSubjects({
      projectId,
      props,
      subjectIds: this.getSubjectIds([
        ...(pageLogs || []).map((log: OnCallDutyPolicyExecutionLog) => {
          return getSubjectKey(
            log.triggeredByIncidentId,
            log.triggeredByAlertId,
          );
        }),
        ...(suggestions || []).map((suggestion: AutoRemediationSuggestion) => {
          return getSubjectKey(suggestion.incidentId, suggestion.alertId);
        }),
        ...(investigations || []).map((run: AIRun) => {
          return getSubjectKey(
            run.triggeredByIncidentId,
            run.triggeredByAlertId,
          );
        }),
        ...Array.from(fixTaskRuns.values()).map((run: AIRun) => {
          return this.getFixTaskSubjectKey(run);
        }),
      ]),
    });

    const isReadable: (key: AiOutcomesSubjectKey | undefined) => boolean = (
      key: AiOutcomesSubjectKey | undefined,
    ): boolean => {
      const subject: { kind: "incident" | "alert"; id: string } | null =
        parseSubjectKey(key);

      if (!subject) {
        return false;
      }

      return Boolean(
        subject.kind === "incident"
          ? readable.incidentIds?.has(subject.id)
          : readable.alertIds?.has(subject.id),
      );
    };

    const canReadSubjects: boolean = Boolean(
      readable.incidentIds || readable.alertIds,
    );

    const isPartial: boolean = [
      pageLogs,
      suggestions,
      pullRequests,
      investigations,
    ].some((rows: Array<unknown> | null): boolean => {
      return Boolean(rows && rows.length >= AI_OUTCOMES_SCAN_LIMIT);
    });

    return {
      pageLogs:
        pageLogs && canReadSubjects
          ? pageLogs.filter((log: OnCallDutyPolicyExecutionLog): boolean => {
              return isReadable(
                getSubjectKey(
                  log.triggeredByIncidentId,
                  log.triggeredByAlertId,
                ),
              );
            })
          : null,
      suggestions:
        suggestions && canReadSubjects
          ? suggestions.filter(
              (suggestion: AutoRemediationSuggestion): boolean => {
                return isReadable(
                  getSubjectKey(suggestion.incidentId, suggestion.alertId),
                );
              },
            )
          : null,
      /*
       * A fix pull request about an incident or alert counts only when the
       * caller may read it, as a fix OneUptime AI ran does; one about
       * neither (an exception's, an insight's) is read as it always was.
       */
      pullRequests: pullRequests
        ? pullRequests.filter(
            (pullRequest: AIAgentTaskPullRequest): boolean => {
              const subjectKey: AiOutcomesSubjectKey | undefined =
                this.getFixTaskSubjectKey(
                  this.getFixTask({ fixTaskRuns }, pullRequest),
                );

              return !subjectKey || isReadable(subjectKey);
            },
          )
        : null,
      investigations:
        investigations && canReadSubjects
          ? investigations.filter((run: AIRun): boolean => {
              return isReadable(
                getSubjectKey(
                  run.triggeredByIncidentId,
                  run.triggeredByAlertId,
                ),
              );
            })
          : null,
      fixTaskRuns,
      isPartial,
    };
  }

  // The fix task a pull request was opened by, when it was read.
  private static getFixTask(
    rows: Pick<AiOutcomesCountedRows, "fixTaskRuns">,
    pullRequest: AIAgentTaskPullRequest,
  ): AIRun | undefined {
    return pullRequest.aiRunId
      ? rows.fixTaskRuns.get(pullRequest.aiRunId.toString())
      : undefined;
  }

  // The incident or alert a fix task was for, when it was a fix of one.
  private static getFixTaskSubjectKey(
    run: AIRun | undefined,
  ): AiOutcomesSubjectKey | undefined {
    if (!run || run.runType !== AIRunType.CodeFix) {
      return undefined;
    }

    return getSubjectKey(run.triggeredByIncidentId, run.triggeredByAlertId);
  }

  /*
   * The fix tasks the pull requests were opened by, read as root (a run is
   * private to its author in the run table): only when each started and
   * what it was a fix of leave.
   */
  private static async readFixTaskRuns(data: {
    projectId: ObjectID;
    pullRequests: Array<AIAgentTaskPullRequest>;
  }): Promise<Map<string, AIRun>> {
    const runIds: Map<string, ObjectID> = new Map();

    for (const pullRequest of data.pullRequests) {
      if (pullRequest.aiRunId) {
        runIds.set(pullRequest.aiRunId.toString(), pullRequest.aiRunId);
      }
    }

    const runs: Map<string, AIRun> = new Map();

    if (runIds.size === 0) {
      return runs;
    }

    const found: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(Array.from(runIds.values())),
      } as never,
      select: {
        _id: true,
        createdAt: true,
        runType: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
      },
      limit: runIds.size,
      skip: 0,
      props: { isRoot: true },
    });

    for (const run of found) {
      if (run.id) {
        runs.set(run.id.toString(), run);
      }
    }

    return runs;
  }

  private static getSubjectIds(
    keys: Array<AiOutcomesSubjectKey | undefined>,
  ): SubjectIds {
    const incidentIds: Set<string> = new Set();
    const alertIds: Set<string> = new Set();

    for (const key of keys) {
      const subject: { kind: "incident" | "alert"; id: string } | null =
        parseSubjectKey(key);

      if (subject?.kind === "incident") {
        incidentIds.add(subject.id);
      } else if (subject?.kind === "alert") {
        alertIds.add(subject.id);
      }
    }

    return {
      incidentIds: Array.from(incidentIds),
      alertIds: Array.from(alertIds),
    };
  }

  /*
   * Of the incidents and alerts the counted work was about, the ones the
   * caller may read - labels and private incidents included - or null for
   * a kind the caller may not read at all.
   */
  private static async readReadableSubjects(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    subjectIds: SubjectIds;
  }): Promise<ReadableSubjects> {
    const toIdSet: (
      rows: Array<Incident | Alert> | null,
    ) => Set<string> | null = (
      rows: Array<Incident | Alert> | null,
    ): Set<string> | null => {
      if (!rows) {
        return null;
      }

      return new Set<string>(
        rows
          .map((row: Incident | Alert): string => {
            return row.id?.toString() || "";
          })
          .filter(Boolean),
      );
    };

    const toObjectIds: (ids: Array<string>) => Array<ObjectID> = (
      ids: Array<string>,
    ): Array<ObjectID> => {
      return ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    };

    /*
     * With nothing to look up, one row tells whether the caller may read
     * the kind at all.
     */
    const [incidents, alerts]: [Array<Incident> | null, Array<Alert> | null] =
      await Promise.all([
        readIfPermitted<Array<Incident>>(() => {
          const ids: Array<string> = data.subjectIds.incidentIds;
          return IncidentService.findBy({
            query: {
              projectId: data.projectId,
              ...(ids.length > 0
                ? { _id: QueryHelper.any(toObjectIds(ids)) }
                : {}),
            },
            select: { _id: true },
            limit: Math.max(1, ids.length),
            skip: 0,
            props: data.props,
          });
        }),
        readIfPermitted<Array<Alert>>(() => {
          const ids: Array<string> = data.subjectIds.alertIds;
          return AlertService.findBy({
            query: {
              projectId: data.projectId,
              ...(ids.length > 0
                ? { _id: QueryHelper.any(toObjectIds(ids)) }
                : {}),
            },
            select: { _id: true },
            limit: Math.max(1, ids.length),
            skip: 0,
            props: data.props,
          });
        }),
      ]);

    return {
      incidentIds: toIdSet(incidents),
      alertIds: toIdSet(alerts),
    };
  }

  /*
   * Each counted row of a part, with the outcome it counts under: null
   * for a part the caller may not read.
   */
  private static getCountedRecords(
    part: AiOutcomesPart,
    rows: AiOutcomesCountedRows,
  ): Array<CountedRecord> | null {
    const toRecord: (
      row: { id?: ObjectID | null; createdAt?: Date | undefined },
      outcome: string | null,
      subjectKey: AiOutcomesSubjectKey | undefined,
    ) => CountedRecord | null = (
      row: { id?: ObjectID | null; createdAt?: Date | undefined },
      outcome: string | null,
      subjectKey: AiOutcomesSubjectKey | undefined,
    ): CountedRecord | null => {
      if (!row.id || !row.createdAt) {
        return null;
      }

      return {
        id: row.id.toString(),
        createdAt: toDate(row.createdAt),
        outcome,
        subjectKey,
      };
    };

    const records: (
      list: Array<CountedRecord | null>,
    ) => Array<CountedRecord> = (
      list: Array<CountedRecord | null>,
    ): Array<CountedRecord> => {
      return list.filter((record: CountedRecord | null): boolean => {
        return Boolean(record);
      }) as Array<CountedRecord>;
    };

    switch (part) {
      case AiOutcomesPart.Pages:
        return rows.pageLogs
          ? records(
              rows.pageLogs.map((log: OnCallDutyPolicyExecutionLog) => {
                return toRecord(
                  log,
                  AiOutcomesBuilder.getPageOutcome({
                    outcome: log.aiHoldOutcome,
                  }),
                  getSubjectKey(
                    log.triggeredByIncidentId,
                    log.triggeredByAlertId,
                  ),
                );
              }),
            )
          : null;
      case AiOutcomesPart.RemediationFixes:
        return rows.suggestions
          ? records(
              rows.suggestions.map((suggestion: AutoRemediationSuggestion) => {
                return toRecord(
                  suggestion,
                  AiOutcomesBuilder.getRemediationOutcome({
                    verificationStatus: suggestion.verificationStatus,
                  }),
                  getSubjectKey(suggestion.incidentId, suggestion.alertId),
                );
              }),
            )
          : null;
      case AiOutcomesPart.PullRequestFixes:
        return rows.pullRequests
          ? records(
              rows.pullRequests.map((pullRequest: AIAgentTaskPullRequest) => {
                return toRecord(
                  pullRequest,
                  AiOutcomesBuilder.getPullRequestOutcome({
                    productionStatus: pullRequest.productionStatus,
                  }),
                  this.getFixTaskSubjectKey(this.getFixTask(rows, pullRequest)),
                );
              }),
            )
          : null;
      case AiOutcomesPart.RootCauses:
        return rows.investigations
          ? records(
              rows.investigations.map((run: AIRun) => {
                return toRecord(
                  run,
                  AiOutcomesBuilder.getRootCauseOutcome({
                    createdAt: toDate(run.createdAt),
                    autoGrade: run.autoGrade,
                    humanVerdict: run.humanVerdict,
                  }),
                  getSubjectKey(
                    run.triggeredByIncidentId,
                    run.triggeredByAlertId,
                  ),
                );
              }),
            )
          : null;
      default:
        return null;
    }
  }

  /*
   * One page of records, with what the caller may see of each: the
   * incident or alert under their props (a record whose incident or alert
   * they can no longer read is left out), and the part's own details.
   */
  private static async toRecords(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    part: AiOutcomesPart;
    page: Array<CountedRecord>;
  }): Promise<Array<AiOutcomesRecord>> {
    if (data.page.length === 0) {
      return [];
    }

    const ids: Array<ObjectID> = data.page.map(
      (record: CountedRecord): ObjectID => {
        return new ObjectID(record.id);
      },
    );

    const [subjects, details]: [
      Map<AiOutcomesSubjectKey, AiOutcomesRecordSubject>,
      Map<string, Partial<AiOutcomesRecord>>,
    ] = await Promise.all([
      this.readSubjectDetails({
        projectId: data.projectId,
        props: data.props,
        keys: data.page.map((record: CountedRecord) => {
          return record.subjectKey;
        }),
      }),
      this.readPartDetails({
        projectId: data.projectId,
        props: data.props,
        part: data.part,
        ids,
        page: data.page,
      }),
    ]);

    const records: Array<AiOutcomesRecord> = [];

    for (const record of data.page) {
      const subject: AiOutcomesRecordSubject | undefined = record.subjectKey
        ? subjects.get(record.subjectKey)
        : undefined;

      // Its incident or alert can no longer be read: it is not listed.
      if (record.subjectKey && !subject) {
        continue;
      }

      records.push({
        id: record.id,
        at: record.createdAt.toISOString(),
        ...(subject ? { subject } : {}),
        ...(details.get(record.id) || {}),
      });
    }

    return records;
  }

  // The incidents and alerts of a page of records, under the caller's props.
  private static async readSubjectDetails(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    keys: Array<AiOutcomesSubjectKey | undefined>;
  }): Promise<Map<AiOutcomesSubjectKey, AiOutcomesRecordSubject>> {
    const subjectIds: SubjectIds = this.getSubjectIds(data.keys);
    const subjects: Map<AiOutcomesSubjectKey, AiOutcomesRecordSubject> =
      new Map();

    const toObjectIds: (ids: Array<string>) => Array<ObjectID> = (
      ids: Array<string>,
    ): Array<ObjectID> => {
      return ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    };

    const [incidents, alerts]: [Array<Incident>, Array<Alert>] =
      await Promise.all([
        subjectIds.incidentIds.length > 0
          ? readIfPermitted<Array<Incident>>(() => {
              return IncidentService.findBy({
                query: {
                  projectId: data.projectId,
                  _id: QueryHelper.any(toObjectIds(subjectIds.incidentIds)),
                },
                select: {
                  _id: true,
                  title: true,
                  incidentNumber: true,
                  incidentNumberWithPrefix: true,
                },
                limit: subjectIds.incidentIds.length,
                skip: 0,
                props: data.props,
              });
            }).then((rows: Array<Incident> | null): Array<Incident> => {
              return rows || [];
            })
          : Promise.resolve([]),
        subjectIds.alertIds.length > 0
          ? readIfPermitted<Array<Alert>>(() => {
              return AlertService.findBy({
                query: {
                  projectId: data.projectId,
                  _id: QueryHelper.any(toObjectIds(subjectIds.alertIds)),
                },
                select: {
                  _id: true,
                  title: true,
                  alertNumber: true,
                  alertNumberWithPrefix: true,
                },
                limit: subjectIds.alertIds.length,
                skip: 0,
                props: data.props,
              });
            }).then((rows: Array<Alert> | null): Array<Alert> => {
              return rows || [];
            })
          : Promise.resolve([]),
      ]);

    for (const incident of incidents) {
      if (incident.id) {
        subjects.set(`incident:${incident.id.toString()}`, {
          kind: "incident",
          id: incident.id.toString(),
          ...(incident.title ? { title: incident.title } : {}),
          ...(typeof incident.incidentNumber === "number"
            ? { number: incident.incidentNumber }
            : {}),
          ...(incident.incidentNumberWithPrefix
            ? { numberWithPrefix: incident.incidentNumberWithPrefix }
            : {}),
        });
      }
    }

    for (const alert of alerts) {
      if (alert.id) {
        subjects.set(`alert:${alert.id.toString()}`, {
          kind: "alert",
          id: alert.id.toString(),
          ...(alert.title ? { title: alert.title } : {}),
          ...(typeof alert.alertNumber === "number"
            ? { number: alert.alertNumber }
            : {}),
          ...(alert.alertNumberWithPrefix
            ? { numberWithPrefix: alert.alertNumberWithPrefix }
            : {}),
        });
      }
    }

    return subjects;
  }

  /*
   * What a page of records says beyond its incident or alert: a fix's
   * runbook or kind, a pull request's number, title and link (under the
   * caller's props, as the rows were read), an investigation's one-line
   * finding and how it was judged (read as root, as its AI panel shows it
   * to everyone who may read its incident or alert).
   */
  private static async readPartDetails(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    part: AiOutcomesPart;
    ids: Array<ObjectID>;
    page: Array<CountedRecord>;
  }): Promise<Map<string, Partial<AiOutcomesRecord>>> {
    const details: Map<string, Partial<AiOutcomesRecord>> = new Map();
    const query: Record<string, unknown> = {
      projectId: data.projectId,
      _id: QueryHelper.any(data.ids),
    };

    if (data.part === AiOutcomesPart.RemediationFixes) {
      const suggestions: Array<AutoRemediationSuggestion> =
        (await readIfPermitted<Array<AutoRemediationSuggestion>>(() => {
          return AutoRemediationSuggestionService.findBy({
            query: query as never,
            select: {
              _id: true,
              runbookNameSnapshot: true,
              suggestionType: true,
            },
            limit: data.ids.length,
            skip: 0,
            props: data.props,
          });
        })) || [];

      for (const suggestion of suggestions) {
        if (suggestion.id) {
          details.set(suggestion.id.toString(), {
            ...(clipText(
              suggestion.runbookNameSnapshot,
              AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
            )
              ? {
                  runbookName: clipText(
                    suggestion.runbookNameSnapshot,
                    AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
                  ),
                }
              : {}),
            ...(suggestion.suggestionType
              ? { suggestionType: suggestion.suggestionType }
              : {}),
          });
        }
      }

      return details;
    }

    if (data.part === AiOutcomesPart.PullRequestFixes) {
      const pullRequests: Array<AIAgentTaskPullRequest> =
        (await readIfPermitted<Array<AIAgentTaskPullRequest>>(() => {
          return AIAgentTaskPullRequestService.findBy({
            query: query as never,
            select: {
              _id: true,
              title: true,
              pullRequestNumber: true,
              pullRequestUrl: true,
            },
            limit: data.ids.length,
            skip: 0,
            props: data.props,
          });
        })) || [];

      for (const pullRequest of pullRequests) {
        if (pullRequest.id) {
          const title: string | undefined = clipText(
            pullRequest.title,
            AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
          );
          const url: string | undefined = toWebUrl(pullRequest.pullRequestUrl);

          details.set(pullRequest.id.toString(), {
            ...(typeof pullRequest.pullRequestNumber === "number"
              ? { pullRequestNumber: pullRequest.pullRequestNumber }
              : {}),
            ...(title ? { pullRequestTitle: title } : {}),
            ...(url ? { pullRequestUrl: url } : {}),
          });
        }
      }

      return details;
    }

    if (data.part === AiOutcomesPart.RootCauses) {
      const runs: Array<AIRun> = await AIRunService.findBy({
        query: query as never,
        select: {
          _id: true,
          analysisTldr: true,
          humanVerdict: true,
          autoGrade: true,
        },
        limit: data.ids.length,
        skip: 0,
        props: { isRoot: true },
      });

      // A run with no TL;DR has its posted report's own Summary instead.
      const missing: Array<InvestigationReportSummaryRun> = [];

      for (const run of runs) {
        if (!run.id) {
          continue;
        }

        const summary: string | undefined = clipText(
          run.analysisTldr,
          AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
        );

        details.set(run.id.toString(), {
          ...(summary ? { summary } : {}),
          ...(run.humanVerdict ? { humanVerdict: run.humanVerdict } : {}),
          ...(run.autoGrade ? { autoGrade: run.autoGrade } : {}),
        });

        if (!summary) {
          const subject: { kind: "incident" | "alert"; id: string } | null =
            parseSubjectKey(
              data.page.find((record: CountedRecord): boolean => {
                return record.id === run.id!.toString();
              })?.subjectKey,
            );

          if (subject) {
            missing.push({
              aiRunId: run.id,
              ...(subject.kind === "incident"
                ? { incidentId: new ObjectID(subject.id) }
                : { alertId: new ObjectID(subject.id) }),
            });
          }
        }
      }

      if (missing.length > 0) {
        const summaries: Map<string, string> =
          await InvestigationReportSummary.getForRuns({
            projectId: data.projectId,
            runs: missing,
          });

        for (const [runId, text] of summaries) {
          const summary: string | undefined = clipText(
            text,
            AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
          );

          if (summary) {
            details.set(runId, { ...(details.get(runId) || {}), summary });
          }
        }
      }
    }

    return details;
  }
}

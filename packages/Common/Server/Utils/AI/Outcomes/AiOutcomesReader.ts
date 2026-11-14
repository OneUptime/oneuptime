import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AiOutcomesBuilder, {
  AiOutcomesInvestigationRow,
  AiOutcomesPageRow,
  AiOutcomesPullRequestRow,
  AiOutcomesRemediationRow,
} from "./AiOutcomesBuilder";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomes,
} from "../../../../Types/AI/AiOutcomes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Reads what the AI Results page counts (Types/AI/AiOutcomes) and hands it
 * to AiOutcomesBuilder. Who sees what:
 *
 *   - held pages (on-call policy runs with an AI hold) are read under the
 *     caller's props: a role, or a plan, without on-call runs gets no page
 *     numbers (null), not zeros;
 *   - fixes AI ran, and its fix pull requests, likewise under the caller's
 *     props; a fix counts only when the caller may read the incident or
 *     alert it was for;
 *   - investigations are read as root (an AI run is private to its author
 *     in the run table) and counted only next to an incident or alert the
 *     caller may read; only their dates, grades and verdicts leave.
 *
 * Only counts leave this file: never a title, a rationale or a report.
 * Bounded: the window's newest AI_OUTCOMES_SCAN_LIMIT rows of each kind;
 * reaching it marks the outcomes partial.
 */

export interface AiOutcomesReadOptions {
  projectId: ObjectID;
  // The caller's own, tenant-pinned props.
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
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

export default class AiOutcomesReader {
  public static async read(
    options: AiOutcomesReadOptions,
  ): Promise<AiOutcomes> {
    const now: Date = options.now || new Date();
    const windowStart: Date = AiOutcomesBuilder.getWindowStart(now);
    const { projectId, props } = options;

    const inWindow: Record<string, unknown> = {
      projectId,
      createdAt: QueryHelper.greaterThanEqualTo(windowStart),
    };

    const [pageLogs, suggestions, pullRequests, runs]: [
      Array<OnCallDutyPolicyExecutionLog> | null,
      Array<AutoRemediationSuggestion> | null,
      Array<AIAgentTaskPullRequest> | null,
      Array<AIRun>,
    ] = await Promise.all([
      readIfPermitted<Array<OnCallDutyPolicyExecutionLog>>(() => {
        return OnCallDutyPolicyExecutionLogService.findBy({
          query: {
            ...inWindow,
            aiHoldOutcome: QueryHelper.notNull(),
          } as never,
          select: { _id: true, createdAt: true, aiHoldOutcome: true },
          sort: { createdAt: SortOrder.Descending },
          limit: AI_OUTCOMES_SCAN_LIMIT,
          skip: 0,
          props,
        });
      }),
      readIfPermitted<Array<AutoRemediationSuggestion>>(() => {
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
      }),
      readIfPermitted<Array<AIAgentTaskPullRequest>>(() => {
        return AIAgentTaskPullRequestService.findBy({
          query: {
            ...inWindow,
            productionStatus: QueryHelper.notNull(),
          } as never,
          select: { _id: true, createdAt: true, productionStatus: true },
          sort: { createdAt: SortOrder.Descending },
          limit: AI_OUTCOMES_SCAN_LIMIT,
          skip: 0,
          props,
        });
      }),
      AIRunService.findBy({
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
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: AI_OUTCOMES_SCAN_LIMIT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const subjectIds: SubjectIds = this.getSubjectIds({
      runs,
      suggestions: suggestions || [],
    });

    const readable: ReadableSubjects = await this.readReadableSubjects({
      projectId,
      props,
      subjectIds,
    });

    const isReadableSubject: (
      incidentId: ObjectID | undefined,
      alertId: ObjectID | undefined,
    ) => boolean = (
      incidentId: ObjectID | undefined,
      alertId: ObjectID | undefined,
    ): boolean => {
      if (incidentId) {
        return Boolean(readable.incidentIds?.has(incidentId.toString()));
      }

      if (alertId) {
        return Boolean(readable.alertIds?.has(alertId.toString()));
      }

      return false;
    };

    const isPartial: boolean = [pageLogs, suggestions, pullRequests, runs].some(
      (rows: Array<unknown> | null): boolean => {
        return Boolean(rows && rows.length >= AI_OUTCOMES_SCAN_LIMIT);
      },
    );

    const canReadSubjects: boolean = Boolean(
      readable.incidentIds || readable.alertIds,
    );

    return AiOutcomesBuilder.build({
      now,
      pageRows: pageLogs
        ? pageLogs.map(
            (log: OnCallDutyPolicyExecutionLog): AiOutcomesPageRow => {
              return {
                createdAt: log.createdAt!,
                outcome: log.aiHoldOutcome,
              };
            },
          )
        : null,
      remediationRows:
        suggestions && canReadSubjects
          ? suggestions
              .filter((suggestion: AutoRemediationSuggestion): boolean => {
                // A fix for an incident is about the incident, alert or not.
                return isReadableSubject(
                  suggestion.incidentId,
                  suggestion.incidentId ? undefined : suggestion.alertId,
                );
              })
              .map(
                (
                  suggestion: AutoRemediationSuggestion,
                ): AiOutcomesRemediationRow => {
                  return {
                    createdAt: suggestion.createdAt!,
                    verificationStatus: suggestion.verificationStatus,
                  };
                },
              )
          : null,
      pullRequestRows: pullRequests
        ? pullRequests.map(
            (pullRequest: AIAgentTaskPullRequest): AiOutcomesPullRequestRow => {
              return {
                createdAt: pullRequest.createdAt!,
                productionStatus: pullRequest.productionStatus,
              };
            },
          )
        : null,
      investigationRows: canReadSubjects
        ? runs
            .filter((run: AIRun): boolean => {
              return isReadableSubject(
                run.triggeredByIncidentId,
                run.triggeredByIncidentId ? undefined : run.triggeredByAlertId,
              );
            })
            .map((run: AIRun): AiOutcomesInvestigationRow => {
              return {
                createdAt: run.createdAt!,
                autoGrade: run.autoGrade,
                humanVerdict: run.humanVerdict,
              };
            })
        : null,
      isPartial,
    });
  }

  private static getSubjectIds(data: {
    runs: Array<AIRun>;
    suggestions: Array<AutoRemediationSuggestion>;
  }): SubjectIds {
    const incidentIds: Set<string> = new Set();
    const alertIds: Set<string> = new Set();

    for (const run of data.runs) {
      if (run.triggeredByIncidentId) {
        incidentIds.add(run.triggeredByIncidentId.toString());
      } else if (run.triggeredByAlertId) {
        alertIds.add(run.triggeredByAlertId.toString());
      }
    }

    for (const suggestion of data.suggestions) {
      if (suggestion.incidentId) {
        incidentIds.add(suggestion.incidentId.toString());
      } else if (suggestion.alertId) {
        alertIds.add(suggestion.alertId.toString());
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
}

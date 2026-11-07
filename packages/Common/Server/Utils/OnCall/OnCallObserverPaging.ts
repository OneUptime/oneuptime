import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { OnCallRulePagingHold } from "./OnCallRulePagingHold";

/*
 * PAGES THE POLICIES A RECORD'S ON-CALL RULES PAGE AS OBSERVERS
 * (OnCallRulePageAs): each by a run of its own that pages its people as
 * observers (OnCallObserverPage), held as its rule says
 * (OnCallRulePagingHold). The record's service asks, once its rules have
 * run: when it is created, and when it changes so that a rule newly matches
 * it (IncidentRulesOnChange).
 *
 * A policy that has paged about the record before - as responders or as
 * observers - is not paged again as observers when `skipPoliciesPagedBefore`
 * says so: the people a run reached about the record know about it.
 *
 * Never throws: a policy that could not be paged is logged, and the others
 * are paged.
 */

// The record observers are paged about, by the run column that names it.
export interface OnCallObserverPagingRecord {
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByAlertEpisodeId?: ObjectID | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | undefined;
  userNotificationEventType: UserNotificationEventType;
}

type RunRecordColumn =
  | "triggeredByIncidentId"
  | "triggeredByAlertId"
  | "triggeredByAlertEpisodeId"
  | "triggeredByIncidentEpisodeId";

const RUN_RECORD_COLUMNS: Array<RunRecordColumn> = [
  "triggeredByIncidentId",
  "triggeredByAlertId",
  "triggeredByAlertEpisodeId",
  "triggeredByIncidentEpisodeId",
];

export default class OnCallObserverPaging {
  /*
   * Pages each policy as observers, and hands back the ids of those it
   * started a run for.
   */
  @CaptureSpan()
  public static async pagePolicies(data: {
    projectId: ObjectID;
    policyIds: Array<string>;
    holds: Map<string, OnCallRulePagingHold>;
    record: OnCallObserverPagingRecord;
    skipPoliciesPagedBefore?: boolean | undefined;
  }): Promise<Array<string>> {
    const recordColumn: RunRecordColumn | undefined = RUN_RECORD_COLUMNS.find(
      (column: RunRecordColumn): boolean => {
        return Boolean(data.record[column]);
      },
    );

    if (!recordColumn || data.policyIds.length === 0) {
      return [];
    }

    let policyIds: Array<string> = Array.from(
      new Set(
        data.policyIds.filter((policyId: string): boolean => {
          return Boolean(policyId);
        }),
      ),
    );

    if (data.skipPoliciesPagedBefore) {
      const pagedBefore: Set<string> = await this.getPoliciesPagedBefore({
        recordColumn: recordColumn,
        recordId: data.record[recordColumn]!,
        policyIds: policyIds,
      });

      policyIds = policyIds.filter((policyId: string): boolean => {
        return !pagedBefore.has(policyId.toLowerCase());
      });
    }

    const paged: Array<string> = [];

    await Promise.allSettled(
      policyIds.map(async (policyId: string): Promise<void> => {
        const hold: OnCallRulePagingHold | undefined = data.holds.get(policyId);

        try {
          await OnCallDutyPolicyService.executePolicy(new ObjectID(policyId), {
            [recordColumn]: data.record[recordColumn],
            userNotificationEventType: data.record.userNotificationEventType,
            isObserverPage: true,
            ...(hold
              ? {
                  pagingStartsAt: hold.pagingStartsAt,
                  waitingStatusMessage: hold.waitingStatusMessage,
                  isAiHold: hold.isAiHold,
                }
              : {}),
          });

          paged.push(policyId);
        } catch (err) {
          logger.error(
            `Could not page on-call policy ${policyId} as observers.`,
            {
              projectId: data.projectId.toString(),
            } as LogAttributes,
          );
          logger.error(err as Error);
        }
      }),
    );

    return paged;
  }

  /*
   * The policies of `policyIds` as a record lists its on-call policies, for
   * OnCallNotRunOnCreate, which reads only their ids: a record created
   * already acknowledged or resolved pages no one, and its feed names the
   * policies its rules would have paged as observers with the rest.
   */
  public static toPolicies(policyIds: Array<string>): Array<OnCallDutyPolicy> {
    return policyIds.map((policyId: string): OnCallDutyPolicy => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = policyId;
      return policy;
    });
  }

  // The policies of `policyIds` that have a run about the record already.
  private static async getPoliciesPagedBefore(data: {
    recordColumn: RunRecordColumn;
    recordId: ObjectID;
    policyIds: Array<string>;
  }): Promise<Set<string>> {
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          [data.recordColumn]: data.recordId,
          onCallDutyPolicyId: QueryHelper.any(
            data.policyIds.map((policyId: string): ObjectID => {
              return new ObjectID(policyId);
            }),
          ),
        },
        select: {
          _id: true,
          onCallDutyPolicyId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return new Set<string>(
      runs
        .map((run: OnCallDutyPolicyExecutionLog): string => {
          return run.onCallDutyPolicyId?.toString().toLowerCase() || "";
        })
        .filter((policyId: string): boolean => {
          return Boolean(policyId);
        }),
    );
  }
}

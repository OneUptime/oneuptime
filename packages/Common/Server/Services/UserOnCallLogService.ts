import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import OnCallNotificationAlertingService from "./OnCallNotificationAlertingService";
import ProjectService from "./ProjectService";
import UserService from "./UserService";
import UserNotificationRuleService, {
  FallbackNotificationOutcome,
  FallbackNotificationResult,
} from "./UserNotificationRuleService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import { getRepeatClaimKey } from "../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../Types/ObjectID";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import PositiveNumber from "../../Types/PositiveNumber";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import Incident from "../../Models/DatabaseModels/Incident";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import Model from "../../Models/DatabaseModels/UserOnCallLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeService from "./AlertEpisodeService";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeService from "./IncidentEpisodeService";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import logger from "../Utils/Logger";
import OnCallRuleClaimsInFlight, {
  OnCallRuleClaimInFlight,
  OnCallRuleClaimSettlement,
} from "../Utils/OnCall/OnCallRuleClaimsInFlight";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import { ON_CALL_PAGE_SENT_STATUS_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getOnCallFallbackFailedStatusMessage,
  getOnCallFallbackNotifiedStatusMessage,
  getOnCallNoVerifiedMethodStatusMessage,
  getOnCallOptedOutStatusMessage,
  NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
  NO_NOTIFICATION_RULES_STATUS_MESSAGE,
  NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
} from "../../Types/OnCallDutyPolicy/OnCallPageLine";
import {
  ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
  ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
  OnCallTestPageRecordKind,
  getOnCallTestPageRuleType,
  isOnCallTestPage,
  isOnCallTestPageRecordKind,
  sortRulesAsAPageReachesThem,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import Query from "../Types/Database/Query";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ColumnLength from "../../Types/Database/ColumnLength";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "./IncidentSeverityService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "./AlertSeverityService";

/*
 * The status message the zero-rule dead-end wrote before the fallback existed,
 * kept verbatim (Types/OnCallDutyPolicy/OnCallPageLine), and why a log sent
 * nothing to somebody who is not a member of the project. Kept where they
 * always were too, for whoever reads them from here.
 */
export {
  NO_NOTIFICATION_RULES_STATUS_MESSAGE,
  NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
};

/*
 * Why an on-call notification log stopped part way: the person left the
 * project. Kept with the other lines a person's page says
 * (Types/OnCallDutyPolicy/OnCallPageLine), where the on-call logs read it
 * back (#8551).
 */
export { NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE };

/*
 * FindWhereProperty is constrained to object types, so the parameter is `any`
 * here exactly as it is on every QueryHelper predicate - the value is a TypeORM
 * Raw operator, not a boolean, and the column it lands on is what gives it
 * meaning.
 */
export type NotOptOutRuleQueryFunction = () => FindWhereProperty<any>;

/*
 * "This row is not an opt-out row" - the predicate that EVERY query which
 * counts notification rules or picks one to execute has to carry.
 *
 * An opt-out row is a UserNotificationRule that exists in order to send
 * nothing. It carries exactly the columns those queries filter on - userId,
 * projectId, ruleType and the severity - and holds no notification method at
 * all. Without this predicate it is therefore indistinguishable from a real
 * rule, and the damage is not a missing filter, it is a silent lie:
 *
 *   - the count comes back 1, so the zero-rule branch is never entered. Both
 *     the opt-out handling and the whole fallback below become unreachable
 *     code - the opt-out feature would be dead the day it shipped;
 *   - the immediate-rule lookup then SELECTS the opt-out row and "executes"
 *     it. There is no method on it, so nothing is sent - and yet the
 *     escalation timeline is stamped Notification Sent / "Alert Sent",
 *     because that write happens unconditionally after the loop. The
 *     responder is never paged and the log tells the person reading it
 *     afterwards that they were.
 *
 * The predicate has to mean "not true", NULL included. `isOptOut` is NULLABLE
 * and was added long after these rows started existing, so it is NULL on every
 * rule written before the column and stays NULL on any row created through a
 * path that does not mention it. A plain `isOptOut: false` compares NULL =
 * false, which evaluates to NULL rather than true, so it would exclude every
 * pre-existing rule in every existing install - it would not merely fail to
 * fix this, it would stop all paging. QueryHelper.notInOrNull emits
 * `(col NOT IN ($1) OR col IS NULL)`, which is the NULL-safe not-equals; it is
 * the same helper Probe:UpdateConnectionStatus uses for exactly this reason
 * (its tests pin the choice of notInOrNull over notEquals on that grounds).
 * QueryHelper takes its values as strings and Postgres resolves the bound
 * literal against the column's own boolean type.
 */
export const notOptOutRuleQuery: NotOptOutRuleQueryFunction =
  (): FindWhereProperty<any> => {
    return QueryHelper.notInOrNull(["true"]);
  };

/*
 * Whether an `UPDATE ... RETURNING` sent through TypeORM's query() wrote a
 * row. TypeORM's postgres query() answers a top-level UPDATE with
 * [rows, rowCount] - an array of two whether or not anything matched - so
 * reading that array's length as the rows made every claim of a
 * notification (claimNotificationExecution) a win and every give-back of
 * one (releaseNotificationRuleClaim) a success: two overlapping runs of the
 * person's-log worker both sent the same notification, and a rule whose
 * claim was not given back was sent again. A plain array is read as the
 * rows (a driver that answers with them, or a statement that is a SELECT);
 * anything else wrote nothing. A row is an object, never an array, so the
 * two shapes cannot be mistaken for each other.
 */
export function updateReturnedARow(result: unknown): boolean {
  if (!Array.isArray(result)) {
    return false;
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[0].length > 0;
  }

  return result.length > 0;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 30);
    }
  }

  /**
   * Atomically claim the right to execute ONE notification rule for this
   * on-call log. Rules are claimed under their own id, and each repeat of a
   * rule that repeats until acknowledged (NotificationRepeat) under a key of
   * its own; see claimNotificationExecution below for what the claim actually
   * guarantees and why it is keyed by a string.
   *
   * Returns true when THIS call claimed the rule (caller should send), false when
   * it was already executed/claimed (caller should skip) or the log is missing.
   */
  @CaptureSpan()
  public async claimNotificationRuleExecution(data: {
    userOnCallLogId: ObjectID;
    userNotificationRuleId: ObjectID;
    // Absent (or 0) for the rule's first push.
    repeatNumber?: number | undefined;
    // The moment the claim holds, so it can be given back (issue #8407); now when absent.
    claimedAt?: Date | undefined;
  }): Promise<boolean> {
    return await this.claimNotificationExecution({
      userOnCallLogId: data.userOnCallLogId,
      claimKey: this.getNotificationRuleClaimKey(data),
      claimedAt: data.claimedAt,
    });
  }

  // A rule's claim key: the rule's id for its first push, a key of its own for each repeat.
  public getNotificationRuleClaimKey(data: {
    userNotificationRuleId: ObjectID;
    repeatNumber?: number | undefined;
  }): string {
    const ruleId: string = data.userNotificationRuleId.toString();

    return data.repeatNumber && data.repeatNumber > 0
      ? getRepeatClaimKey(ruleId, data.repeatNumber)
      : ruleId;
  }

  /*
   * Gives a rule's claim back, so the next tick sends it (issue #8407): its
   * send failed before anything of it reached a sender (OnCallSendAttempt),
   * so sending it again pages nobody twice. Only the claim taken at
   * `claimedAt` - the one the caller took - is given back: one UPDATE that
   * removes the key while it still holds that moment. Returns whether it
   * did (updateReturnedARow); throws as the database does.
   */
  @CaptureSpan()
  public async releaseNotificationRuleClaim(data: {
    userOnCallLogId: ObjectID;
    claimKey: string;
    claimedAt: Date;
  }): Promise<boolean> {
    const result: unknown = await this.getRepository().manager.query(
      `UPDATE "UserOnCallLog"
           SET "executedNotificationRules" = (
                 COALESCE("executedNotificationRules", '{}')::jsonb - $2::text
               )::json
         WHERE "_id" = $1::uuid
           AND (COALESCE("executedNotificationRules", '{}')::jsonb ->> $2::text) = $3::text
         RETURNING "_id"`,
      [
        data.userOnCallLogId.toString(),
        data.claimKey,
        data.claimedAt.toISOString(),
      ],
    );

    return updateReturnedARow(result);
  }

  /*
   * A rule's claim whose page never finished (OnCallRuleClaimsInFlight,
   * issue #8407), at the log's next try: the person's-log worker
   * (UserOnCallLog:ExecutePendingExecutions) settles it before it works on
   * the log.
   *
   * Left alone while its page may still be on its way - less than
   * SETTLE_AFTER_MS old, unless it was owed back. Forgotten when the log no
   * longer holds it: it was given back, or never taken. Kept when a
   * notification row of its rule was written since it was taken: that send
   * may have reached its sender, and sending it again could page twice.
   * Otherwise nothing of it was sent, and it is given back - and taken off
   * `log`, as the worker read it, so this try sends the rule. Says which
   * it was; throws as the database does, and the claim stays in flight for
   * the try after.
   */
  @CaptureSpan()
  public async settleRuleClaimInFlight(data: {
    // The log, as the worker read it: with its executedNotificationRules.
    log: Model;
    claim: OnCallRuleClaimInFlight;
    now: Date;
  }): Promise<OnCallRuleClaimSettlement> {
    const log: Model = data.log;
    const claim: OnCallRuleClaimInFlight = data.claim;

    if (
      !claim.owed &&
      data.now.getTime() - claim.claimedAt.getTime() <
        OnCallRuleClaimsInFlight.SETTLE_AFTER_MS
    ) {
      return OnCallRuleClaimSettlement.NotYet;
    }

    const executed: JSONObject = log.executedNotificationRules || {};

    if (
      !OnCallRuleClaimsInFlight.isClaimTakenAt(claim, executed[claim.claimKey])
    ) {
      await OnCallRuleClaimsInFlight.forget(log.id);
      return OnCallRuleClaimSettlement.Settled;
    }

    if (!claim.owed) {
      const rowsSinceTheClaim: PositiveNumber =
        await UserOnCallLogTimelineService.countBy({
          query: {
            userNotificationLogId: log.id!,
            // The fallback has no rule: any notification of the log since is its own.
            ...(claim.ruleId
              ? { userNotificationRuleId: new ObjectID(claim.ruleId) }
              : {}),
            // A little before: the row's moment is the database's, the claim's this process's.
            createdAt: QueryHelper.greaterThanEqualTo(
              OneUptimeDate.addRemoveSeconds(claim.claimedAt, -30),
            ),
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        });

      if (rowsSinceTheClaim.toNumber() > 0) {
        logger.warn(
          `On-call log ${log.id?.toString()}: the page of notification rule ${claim.ruleId} claimed at ${claim.claimedAt.toISOString()} never finished, and wrote a notification; it may have been sent, so it is not sent again.`,
        );

        await OnCallRuleClaimsInFlight.forget(log.id);
        return OnCallRuleClaimSettlement.Settled;
      }
    }

    const released: boolean = await this.releaseNotificationRuleClaim({
      userOnCallLogId: log.id!,
      claimKey: claim.claimKey,
      claimedAt: claim.claimedAt,
    });

    await OnCallRuleClaimsInFlight.forget(log.id);

    if (!released) {
      return OnCallRuleClaimSettlement.Settled;
    }

    logger.warn(
      `On-call log ${log.id?.toString()}: the page of notification rule ${claim.ruleId} claimed at ${claim.claimedAt.toISOString()} never reached a sender; its claim is given back, and it is sent now.`,
    );

    const remaining: JSONObject = { ...executed };
    delete remaining[claim.claimKey];
    log.executedNotificationRules = remaining;

    return OnCallRuleClaimSettlement.GivenBack;
  }

  /**
   * Atomically claim ONE delivery attempt against this on-call log, keyed by an
   * arbitrary string. Overlapping UserOnCallLog:ExecutePendingExecutions runs (a
   * tick that exceeds the 1-minute cadence, a stalled-job re-delivery, or a
   * burst release across worker replicas) could both read
   * executedNotificationRules without a given key, both write it, and both send
   * — double-paging the responder for a single escalation (audit F7). This
   * mirrors OnCallDutyPolicyExecutionLogService.claimEscalationAdvance: a single
   * conditional UPDATE that sets executedNotificationRules[key] only when the
   * key is absent and RETURNs the affected row, so exactly one concurrent run
   * wins and the loser skips. Its answer is read with updateReturnedARow:
   * TypeORM answers an UPDATE with [rows, rowCount], which read as the rows
   * made every claim a win.
   *
   * The key is a string rather than a rule id because not every delivery attempt
   * has a rule behind it. The verified-method fallback runs precisely BECAUSE no
   * rule matched, so it has nothing to claim under and instead claims a reserved
   * literal ("__fallback__"). executedNotificationRules is a jsonb map keyed by
   * arbitrary text, so a reserved literal sits happily beside real rule uuids and
   * can never collide with one. Keeping a single claim implementation means the
   * fallback inherits this atomicity, its fail-safe and its audited SQL exactly,
   * rather than growing a second, subtly different guard.
   *
   * Fail-safe: if the atomic statement errors for any reason, fall back to the
   * previous non-atomic read-modify-write so the attempt is still marked and
   * sent. For an on-call system a rare duplicate page (the pre-fix behavior) is
   * far better than a missed page, so this never makes paging less reliable.
   */
  @CaptureSpan()
  public async claimNotificationExecution(data: {
    userOnCallLogId: ObjectID;
    claimKey: string;
    // The moment the claim holds (releaseNotificationRuleClaim); now when absent.
    claimedAt?: Date | undefined;
  }): Promise<boolean> {
    const ruleKey: string = data.claimKey;
    const nowIso: string = (
      data.claimedAt || OneUptimeDate.getCurrentDate()
    ).toISOString();

    try {
      const result: unknown = await this.getRepository().manager.query(
        `UPDATE "UserOnCallLog"
             SET "executedNotificationRules" = jsonb_set(
                   COALESCE("executedNotificationRules", '{}')::jsonb,
                   ARRAY[$2::text],
                   to_jsonb($3::text),
                   true
                 )::json
           WHERE "_id" = $1::uuid
             AND NOT (COALESCE("executedNotificationRules", '{}')::jsonb ? $2::text)
           RETURNING "_id"`,
        [data.userOnCallLogId.toString(), ruleKey, nowIso],
      );

      return updateReturnedARow(result);
    } catch (err) {
      logger.error(
        "claimNotificationRuleExecution atomic claim failed; falling back to non-atomic marking.",
      );
      logger.error(err);

      // Fallback: previous non-atomic read-modify-write (reliable marking).
      const log: Model | null = await this.findOneById({
        id: data.userOnCallLogId,
        props: { isRoot: true },
        select: {
          _id: true,
          executedNotificationRules: true,
        },
      });

      if (!log) {
        return false;
      }

      const executed: JSONObject = log.executedNotificationRules || {};

      if (Object.keys(executed).includes(ruleKey)) {
        return false;
      }

      // The same moment the atomic claim holds, so it can be given back the same way.
      executed[ruleKey] = nowIso;

      await this.updateOneById({
        id: log.id!,
        data: {
          executedNotificationRules: { ...executed },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        props: { isRoot: true },
      });

      return true;
    }
  }

  /*
   * A PAGE MERGED INTO THE PERSON'S OPEN PAGE FROM ANOTHER POLICY'S RUN
   * TAKES THE PAGE OVER (Types/OnCallDutyPolicy/OnCallPageMerge): that page
   * ended without their answer, so from now on this one pages them itself.
   * It is paging again (Executing), its line says why, and what the other
   * page sent is written as its own sent deliveries, before any of its
   * rules is claimed, so none of them is sent twice. Throws as the database
   * does: the worker tries again.
   */
  @CaptureSpan()
  public async takeOverMergedPage(data: {
    userOnCallLogId: ObjectID;
    statusMessage: string;
    // Its own sent deliveries, with the other page's: claim keys and when.
    executedNotificationRules: JSONObject;
  }): Promise<void> {
    await this.updateOneById({
      id: data.userOnCallLogId,
      data: {
        status: UserNotificationExecutionStatus.Executing,
        statusMessage: data.statusMessage,
        executedNotificationRules: { ...data.executedNotificationRules },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * A PERSON'S LOG WITH NO RULE FOR ITS PAGE, THAT NEVER SENT ANYTHING, AT
   * THE PERSON'S-LOG WORKER (issues #8469, #8470).
   *
   * A log's start pages a person with no rule for the page through their
   * verified methods (handleNoMatchingNotificationRule, the fallback). A
   * start that never got as far - its process stopped, or the database
   * failed before it counted the person's rules - was handed to the worker
   * (TimeoutStuckExecutions), which found no rules and completed the log
   * having sent nothing; a fallback that failed for a moment ended the log
   * in Error. Either way the person was paged by nothing.
   *
   * The worker hands such a log here, once it has checked the record still
   * needs somebody: the start's no-rule handling runs for it - an opt-out,
   * the project's switch, the fallback - and ends it as the start would
   * have. A fallback that fails for a moment is thrown for the worker's
   * next try, and ended as failed, with its alert, at the worker's last.
   */
  @CaptureSpan()
  public async sendToLogWithNoRules(data: {
    log: Model;
    notificationRuleType: NotificationRuleType;
    incidentSeverityId?: ObjectID | undefined;
    alertSeverityId?: ObjectID | undefined;
    // The worker's last try of the log: a fallback that fails ends it.
    isLastTry: boolean;
  }): Promise<void> {
    await this.handleNoMatchingNotificationRule({
      createdItem: data.log,
      notificationRuleType: data.notificationRuleType,
      incidentSeverityId: data.incidentSeverityId,
      alertSeverityId: data.alertSeverityId,
      severityName: await this.readSeverityNameForMessage({
        incidentSeverityId: data.incidentSeverityId,
        alertSeverityId: data.alertSeverityId,
      }),
      onRetryableFailure: data.isLastTry ? "end" : "rethrow",
    });
  }

  // The severity's name, for prose: "this severity" when it cannot be read.
  private async readSeverityNameForMessage(data: {
    incidentSeverityId?: ObjectID | undefined;
    alertSeverityId?: ObjectID | undefined;
  }): Promise<string> {
    try {
      if (data.incidentSeverityId) {
        const severity: IncidentSeverity | null =
          await IncidentSeverityService.findOneById({
            id: data.incidentSeverityId,
            select: { name: true },
            props: { isRoot: true },
          });

        return severity?.name || "this severity";
      }

      if (data.alertSeverityId) {
        const severity: AlertSeverity | null =
          await AlertSeverityService.findOneById({
            id: data.alertSeverityId,
            select: { name: true },
            props: { isRoot: true },
          });

        return severity?.name || "this severity";
      }
    } catch (err) {
      logger.debug(
        `Could not read the name of a severity for an on-call message; it says "this severity": ${err}`,
      );
    }

    return "this severity";
  }

  /*
   * An immediate rule of a new log failed as the log started (issue #8407):
   * a database error as it was sent, say. The log is handed to the
   * person's-log worker (UserOnCallLog:ExecutePendingExecutions) now, which
   * sends within a minute what the start did not - a rule whose send
   * reached no sender gave its claim back - and tries a log that keeps
   * failing a few more times before it ends it (OnCallPolicyRunRetry). It
   * used to stay Started, and TimeoutStuckExecutions ended it in Error five
   * minutes later: the person's rules - all of them - were never sent.
   *
   * Nothing is thrown back to the page that created the log: the person is
   * paged from here, and the page goes on to the next person.
   */
  private async handStartedLogToTheWorker(
    createdItem: Model,
    error: unknown,
  ): Promise<void> {
    logger.error(
      `On-call log ${createdItem.id?.toString()}: a notification rule failed as the log started; the person's-log worker sends what is left of it.`,
    );
    logger.error(error);

    await this.updateOneById({
      id: createdItem.id!,
      data: {
        status: UserNotificationExecutionStatus.Executing,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Every page starts Scheduled, and its start runs its rules - except a
     * page merged into the person's open page from another policy's run
     * (UserNotificationRuleService.recordMergedPage), which starts Already
     * Paged and runs none (Types/OnCallDutyPolicy/OnCallPageMerge).
     */
    if (
      createBy.data.status !== UserNotificationExecutionStatus.AlreadyPaged ||
      !createBy.data.mergedIntoUserOnCallLogId
    ) {
      createBy.data.status = UserNotificationExecutionStatus.Scheduled;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.status) {
      //update the corresponding oncallTimeline.
      const items: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          onCallDutyPolicyExecutionLogTimelineId: true,
          onCallDutyPolicyExecutionLogTimeline: {
            status: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      let status: OnCallDutyExecutionLogTimelineStatus | undefined = undefined;

      switch (onUpdate.updateBy.data.status) {
        case UserNotificationExecutionStatus.Completed:
          status = OnCallDutyExecutionLogTimelineStatus.NotificationSent;
          break;
        case UserNotificationExecutionStatus.Error:
          status = OnCallDutyExecutionLogTimelineStatus.Error;
          break;
        case UserNotificationExecutionStatus.Executing:
          status = OnCallDutyExecutionLogTimelineStatus.Executing;
          break;
        case UserNotificationExecutionStatus.Scheduled:
          status = OnCallDutyExecutionLogTimelineStatus.Started;
          break;
        case UserNotificationExecutionStatus.Started:
          status = OnCallDutyExecutionLogTimelineStatus.Started;
          break;
        // The person passed the page on (OnCallPagePassOn).
        case UserNotificationExecutionStatus.PassedOn:
          status = OnCallDutyExecutionLogTimelineStatus.PassedOn;
          break;
        // Merged into their open page from another policy's run (OnCallPageMerge).
        case UserNotificationExecutionStatus.AlreadyPaged:
          status = OnCallDutyExecutionLogTimelineStatus.AlreadyPaged;
          break;
        default:
          throw new BadDataException("Invalid status");
      }

      for (const item of items) {
        const stepStatus: OnCallDutyExecutionLogTimelineStatus | undefined =
          item.onCallDutyPolicyExecutionLogTimeline?.status;

        /*
         * A step whose person passed the page on stays that way: the run
         * reads who passed its page on from these steps
         * (OnCallEscalationAdvance), so moving one back to "Executing" or
         * "Notification Sent" would let the run page that person again - and
         * the worker that sends a person's notifications may still be
         * finishing their log just as they pass it on. Only acknowledging
         * changes it (UserOnCallLogTimelineService).
         */
        if (stepStatus === OnCallDutyExecutionLogTimelineStatus.PassedOn) {
          continue;
        }

        /*
         * A log that completes says "Notification Sent" on its timeline step
         * - unless the step already says what became of the page: skipped
         * (an opt-out, somebody who left), failed, or acknowledged. Moving
         * those back to "Notification Sent" claimed a page went out that
         * never did. So does a page merged into the person's open page from
         * another policy's run that ends without taking the page over
         * (OnCallPageMerge): it sent nothing, the other page did.
         */
        if (
          status === OnCallDutyExecutionLogTimelineStatus.NotificationSent &&
          stepStatus &&
          [
            OnCallDutyExecutionLogTimelineStatus.Skipped,
            OnCallDutyExecutionLogTimelineStatus.Error,
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
            OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
          ].includes(stepStatus)
        ) {
          continue;
        }

        /*
         * A page is passed on only from a step that reached its person: one
         * that was acknowledged, skipped or failed keeps what it says.
         */
        if (
          status === OnCallDutyExecutionLogTimelineStatus.PassedOn &&
          stepStatus &&
          [
            OnCallDutyExecutionLogTimelineStatus.Skipped,
            OnCallDutyExecutionLogTimelineStatus.Error,
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          ].includes(stepStatus)
        ) {
          continue;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
          id: item.onCallDutyPolicyExecutionLogTimelineId!,
          data: {
            status: status!,
            statusMessage: onUpdate.updateBy.data.statusMessage!,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * A page merged into the person's open page from another policy's run
     * sends nothing as it starts: that page's notifications stand for it,
     * and its line says so already (OnCallPageMerge). The person's-log
     * worker reads it each minute, for whether that page is still open.
     */
    if (createdItem.status === UserNotificationExecutionStatus.AlreadyPaged) {
      return createdItem;
    }

    // update this item to be processed.
    await this.updateOneById({
      id: createdItem.id!,
      data: {
        status: UserNotificationExecutionStatus.Started,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * A test page (OnCallTestPage) has no record to read a severity from:
     * its run says which kind of page and severity it stands in for, and
     * every rule of the person's for that runs now (runTestPageRules).
     */
    if (isOnCallTestPage(createdItem)) {
      await this.runTestPageRules(createdItem);
      return createdItem;
    }

    const notificationRuleType: NotificationRuleType =
      this.getNotificationRuleType(createdItem.userNotificationEventType!);

    let ruleCount: PositiveNumber = new PositiveNumber(0);

    let incident: Incident | null = null;
    let alert: Alert | null = null;
    let alertEpisode: AlertEpisode | null = null;

    if (createdItem.triggeredByIncidentId) {
      incident = await IncidentService.findOneById({
        id: createdItem.triggeredByIncidentId,
        props: {
          isRoot: true,
        },
        select: {
          incidentSeverityId: true,
          /*
           * The severity NAME is only ever read on the no-rule path, where every
           * message the responder or the operator sees has to say which severity
           * had no rule ("no rule configured for Sev4"). It rides along on this
           * lookup rather than being fetched separately because the join is free
           * next to a second round trip, and because the no-rule path is already
           * the slow, unhappy one.
           */
          incidentSeverity: {
            name: true,
          },
        },
      });

      // Check if there are any rules .
      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: this.userIdWhileMember(createdItem),
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          incidentSeverityId: incident?.incidentSeverityId as ObjectID,
          /*
           * An opt-out row would otherwise be counted as a rule here, and a
           * count of 1 sends this log down the "you have rules, execute them"
           * path where the only thing it can find to execute is the opt-out
           * row itself: nothing is sent and the timeline says Alert Sent. See
           * notOptOutRuleQuery above for the full consequence.
           */
          isOptOut: notOptOutRuleQuery(),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    // get rule count for alerts.
    if (createdItem.triggeredByAlertId) {
      alert = await AlertService.findOneById({
        id: createdItem.triggeredByAlertId,
        props: {
          isRoot: true,
        },
        select: {
          alertSeverityId: true,
          alertSeverity: {
            name: true,
          },
        },
      });

      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: this.userIdWhileMember(createdItem),
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          alertSeverityId: alert?.alertSeverityId as ObjectID,
          // Opt-out rows are not rules. See notOptOutRuleQuery above.
          isOptOut: notOptOutRuleQuery(),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    // get rule count for alert episodes.
    if (createdItem.triggeredByAlertEpisodeId) {
      alertEpisode = await AlertEpisodeService.findOneById({
        id: createdItem.triggeredByAlertEpisodeId,
        props: {
          isRoot: true,
        },
        select: {
          alertSeverityId: true,
          alertSeverity: {
            name: true,
          },
        },
      });

      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: this.userIdWhileMember(createdItem),
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          alertSeverityId: alertEpisode?.alertSeverityId as ObjectID,
          // Opt-out rows are not rules. See notOptOutRuleQuery above.
          isOptOut: notOptOutRuleQuery(),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    // get rule count for incident episodes.
    let incidentEpisode: IncidentEpisode | null = null;
    if (createdItem.triggeredByIncidentEpisodeId) {
      incidentEpisode = await IncidentEpisodeService.findOneById({
        id: createdItem.triggeredByIncidentEpisodeId,
        props: {
          isRoot: true,
        },
        select: {
          incidentSeverityId: true,
          incidentSeverity: {
            name: true,
          },
        },
      });

      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: this.userIdWhileMember(createdItem),
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          incidentSeverityId: incidentEpisode?.incidentSeverityId as ObjectID,
          // Opt-out rows are not rules. See notOptOutRuleQuery above.
          isOptOut: notOptOutRuleQuery(),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    /*
     * Determine the alertSeverityId - can come from alert or alertEpisode
     * Determine the incidentSeverityId - can come from incident or incidentEpisode
     *
     * Resolved here, above the zero-rule branch, because BOTH paths need the
     * same answer: the immediate-rule lookup below queries on it, and the
     * no-rule handling has to look for an opt-out row against exactly the same
     * (ruleType x severity) cell the count just came up empty for. Resolving it
     * twice would be an invitation for the two to drift apart.
     */
    const alertSeverityIdForQuery: ObjectID | undefined =
      alert && alert.alertSeverityId
        ? (alert.alertSeverityId as ObjectID)
        : alertEpisode && alertEpisode.alertSeverityId
          ? (alertEpisode.alertSeverityId as ObjectID)
          : undefined;

    const incidentSeverityIdForQuery: ObjectID | undefined =
      incident && incident.incidentSeverityId
        ? (incident.incidentSeverityId as ObjectID)
        : incidentEpisode && incidentEpisode.incidentSeverityId
          ? (incidentEpisode.incidentSeverityId as ObjectID)
          : undefined;

    /*
     * Purely for prose. Every no-rule message names the severity, and an
     * operator reading "no rule configured for Sev4" learns something that "no
     * rule configured for 8f2c-..." does not. A parent entity whose severity row
     * was deleted, or a mocked read that never selected the relation, leaves
     * this blank, so there is a neutral phrase to fall back on.
     */
    const severityNameForMessage: string =
      incident?.incidentSeverity?.name ||
      incidentEpisode?.incidentSeverity?.name ||
      alert?.alertSeverity?.name ||
      alertEpisode?.alertSeverity?.name ||
      "this severity";

    if (ruleCount.toNumber() === 0) {
      /*
       * The counts above find no rules for somebody who is not a member of
       * the project. That is not "no rule configured": nothing is sent, and
       * no fallback reaches for their methods.
       */
      if (await this.isNotAProjectMember(createdItem)) {
        await this.writeNoRuleOutcome({
          createdItem: createdItem,
          status: UserNotificationExecutionStatus.Completed,
          timelineStatus: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
        });

        return createdItem;
      }

      await this.handleNoMatchingNotificationRule({
        createdItem: createdItem,
        notificationRuleType: notificationRuleType,
        incidentSeverityId: incidentSeverityIdForQuery,
        alertSeverityId: alertSeverityIdForQuery,
        severityName: severityNameForMessage,
      });

      return createdItem;
    }

    // find immediate notification rule and alert the user.
    const immediateNotificationRule: Array<UserNotificationRule> =
      await UserNotificationRuleService.findBy({
        query: {
          userId: this.userIdWhileMember(createdItem),
          projectId: createdItem.projectId!,
          notifyAfterMinutes: 0,
          ruleType: notificationRuleType,
          incidentSeverityId: incidentSeverityIdForQuery,
          alertSeverityId: alertSeverityIdForQuery,
          /*
           * The predicate matters most here. An opt-out row has
           * notifyAfterMinutes 0 like any immediate rule, so without it this
           * lookup returns the row that exists to send nothing, hands it to
           * executeNotificationRuleItem, and the unconditional "Alert Sent"
           * write below then reports a page that was never dispatched.
           */
          isOptOut: notOptOutRuleQuery(),
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    try {
      for (const immediateNotificationRuleItem of immediateNotificationRule) {
        await UserNotificationRuleService.executeNotificationRuleItem(
          immediateNotificationRuleItem.id!,
          {
            userNotificationLogId: createdItem.id!,
            projectId: createdItem.projectId!,
            triggeredByIncidentId: createdItem.triggeredByIncidentId,
            triggeredByAlertId: createdItem.triggeredByAlertId,
            triggeredByAlertEpisodeId: createdItem.triggeredByAlertEpisodeId,
            triggeredByIncidentEpisodeId:
              createdItem.triggeredByIncidentEpisodeId,
            userNotificationEventType: createdItem.userNotificationEventType!,
            onCallPolicyExecutionLogId:
              createdItem.onCallDutyPolicyExecutionLogId,
            onCallPolicyId: createdItem.onCallDutyPolicyId,
            onCallPolicyEscalationRuleId:
              createdItem.onCallDutyPolicyEscalationRuleId,
            userBelongsToTeamId: createdItem.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              createdItem.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: createdItem.onCallDutyScheduleId,
          },
        );
      }
    } catch (err) {
      await this.handStartedLogToTheWorker(createdItem, err);
      return createdItem;
    }

    // update this item to be processed.
    await this.updateOneById({
      id: createdItem.id!,
      data: {
        status: UserNotificationExecutionStatus.Executing, // now the worker will pick this up and complete this or mark this as failed.
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * Update oncall timeline item as well. The record's feed names the
     * notifications that just went out (OnCallPageChannel), not this.
     */
    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: createdItem.onCallDutyPolicyExecutionLogTimelineId!,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        statusMessage: ON_CALL_PAGE_SENT_STATUS_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  /*
   * THE RULES A PAGE RUNS FOR A PERSON: theirs, while they are a member of
   * the project, of the page's kind (ruleType) and severity, opt-out rows
   * left out (notOptOutRuleQuery) - the cell a real page counts and runs.
   * A test page (OnCallTestPage) reads its rules with it, so it runs exactly
   * the rules a real page of its kind and severity would.
   */
  public getPagingRulesQuery(data: {
    userId: ObjectID;
    projectId: ObjectID;
    ruleType: NotificationRuleType;
    incidentSeverityId?: ObjectID | undefined;
    alertSeverityId?: ObjectID | undefined;
  }): Query<UserNotificationRule> {
    return {
      userId: ProjectMembership.userIdWhileMember({
        userId: data.userId,
        projectId: data.projectId,
      }),
      projectId: data.projectId,
      ruleType: data.ruleType,
      incidentSeverityId: data.incidentSeverityId,
      alertSeverityId: data.alertSeverityId,
      isOptOut: notOptOutRuleQuery(),
    };
  }

  /*
   * A TEST PAGE'S RULES, FOR ONE PERSON (OnCallTestPage).
   *
   * The run says which kind of page the test stands in for - an incident or
   * an alert - and which severity. The person's rules for that cell are the
   * rules a real page of it runs (getPagingRulesQuery), and they all run
   * now, in the order a real page would reach them - the immediate ones
   * first, then "after 5 minutes", then "after 10" - without the waits; a
   * push does not repeat. A rule that fails says so on the person's
   * timeline, and the others still run.
   *
   * With no rule for the cell, it is the real page's no-rule path
   * (handleNoMatchingNotificationRule): an opt-out says so, a project that
   * turned the fallback off gets its error, and otherwise the person's
   * verified methods are paged - only, being a test, nobody else is told
   * the page could not be delivered: the test's result says it.
   */
  private async runTestPageRules(createdItem: Model): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog | null =
      createdItem.onCallDutyPolicyExecutionLogId
        ? await OnCallDutyPolicyExecutionLogService.findOneById({
            id: createdItem.onCallDutyPolicyExecutionLogId,
            select: {
              _id: true,
              testPageRecordKind: true,
              testPageSeverityId: true,
            },
            props: {
              isRoot: true,
            },
          })
        : null;

    if (
      !run ||
      !isOnCallTestPageRecordKind(run.testPageRecordKind) ||
      !run.testPageSeverityId
    ) {
      await this.writeNoRuleOutcome({
        createdItem: createdItem,
        status: UserNotificationExecutionStatus.Error,
        timelineStatus: OnCallDutyExecutionLogTimelineStatus.Error,
        statusMessage: ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
      });

      return;
    }

    const recordKind: OnCallTestPageRecordKind = run.testPageRecordKind;
    const severityId: ObjectID = run.testPageSeverityId;
    const notificationRuleType: NotificationRuleType =
      getOnCallTestPageRuleType(recordKind);

    const incidentSeverityId: ObjectID | undefined =
      recordKind === OnCallTestPageRecordKind.Incident ? severityId : undefined;
    const alertSeverityId: ObjectID | undefined =
      recordKind === OnCallTestPageRecordKind.Alert ? severityId : undefined;

    const rules: Array<UserNotificationRule> =
      await UserNotificationRuleService.findBy({
        query: this.getPagingRulesQuery({
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          incidentSeverityId: incidentSeverityId,
          alertSeverityId: alertSeverityId,
        }),
        select: {
          _id: true,
          notifyAfterMinutes: true,
        },
        sort: {
          notifyAfterMinutes: SortOrder.Ascending,
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    if (rules.length === 0) {
      if (await this.isNotAProjectMember(createdItem)) {
        await this.writeNoRuleOutcome({
          createdItem: createdItem,
          status: UserNotificationExecutionStatus.Completed,
          timelineStatus: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
        });

        return;
      }

      await this.handleNoMatchingNotificationRule({
        createdItem: createdItem,
        notificationRuleType: notificationRuleType,
        incidentSeverityId: incidentSeverityId,
        alertSeverityId: alertSeverityId,
        severityName: await this.getTestPageSeverityName({
          recordKind: recordKind,
          severityId: severityId,
        }),
      });

      return;
    }

    for (const rule of sortRulesAsAPageReachesThem(rules)) {
      try {
        await UserNotificationRuleService.executeNotificationRuleItem(
          rule.id!,
          {
            userNotificationLogId: createdItem.id!,
            projectId: createdItem.projectId!,
            userNotificationEventType: UserNotificationEventType.TestPage,
            onCallPolicyExecutionLogId:
              createdItem.onCallDutyPolicyExecutionLogId,
            onCallPolicyId: createdItem.onCallDutyPolicyId,
            onCallPolicyEscalationRuleId:
              createdItem.onCallDutyPolicyEscalationRuleId,
            userBelongsToTeamId: createdItem.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              createdItem.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: createdItem.onCallDutyScheduleId,
          },
        );
      } catch (err) {
        logger.error(
          `Test page: could not run notification rule ${rule.id?.toString()} for UserOnCallLog ${createdItem.id?.toString()}: ${err}`,
        );

        await this.recordTestPageRuleError({
          createdItem: createdItem,
          ruleId: rule.id!,
          error: err as Error,
        });
      }
    }

    /*
     * Every rule ran: the log is complete, and its step says the page went
     * out (onUpdateSuccess) - unless somebody acknowledged the test while
     * its rules ran, whose words stay as they are.
     */
    await this.updateOneBy({
      query: {
        _id: createdItem.id!.toString(),
        acknowledgedAt: QueryHelper.isNull(),
      },
      data: {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });
  }

  // A rule of a test page that could not run, on the person's timeline.
  private async recordTestPageRuleError(data: {
    createdItem: Model;
    ruleId: ObjectID;
    error: Error;
  }): Promise<void> {
    try {
      const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
      row.projectId = data.createdItem.projectId!;
      row.userNotificationLogId = data.createdItem.id!;
      row.userId = data.createdItem.userId!;
      row.userNotificationEventType = UserNotificationEventType.TestPage;
      row.userNotificationRuleId = data.ruleId;
      row.status = UserNotificationStatus.Error;
      row.statusMessage = (
        data.error?.message || "This notification rule could not run."
      ).substring(0, ColumnLength.LongText);

      if (data.createdItem.onCallDutyPolicyExecutionLogId) {
        row.onCallDutyPolicyExecutionLogId =
          data.createdItem.onCallDutyPolicyExecutionLogId;
      }

      if (data.createdItem.onCallDutyPolicyExecutionLogTimelineId) {
        row.onCallDutyPolicyExecutionLogTimelineId =
          data.createdItem.onCallDutyPolicyExecutionLogTimelineId;
      }

      if (data.createdItem.onCallDutyPolicyId) {
        row.onCallDutyPolicyId = data.createdItem.onCallDutyPolicyId;
      }

      await UserOnCallLogTimelineService.create({
        data: row,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(err);
    }
  }

  // The name of the severity a test page stands in for, for its messages.
  private async getTestPageSeverityName(data: {
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
  }): Promise<string> {
    try {
      const severity: IncidentSeverity | AlertSeverity | null =
        data.recordKind === OnCallTestPageRecordKind.Alert
          ? await AlertSeverityService.findOneById({
              id: data.severityId,
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            })
          : await IncidentSeverityService.findOneById({
              id: data.severityId,
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });

      return severity?.name?.toString() || "this severity";
    } catch (err) {
      logger.error(err);
      return "this severity";
    }
  }

  /**
   * Nothing matched (ruleType x severity) for this responder.
   *
   * That state used to be treated as a single thing - "misconfigured" - and
   * written off with an Error row nobody reads while the escalation timer ran
   * down as though the responder had simply declined to acknowledge. It is
   * actually three different situations wearing the same clothes, and telling
   * them apart is the whole of Phase 1:
   *
   *   1. The responder said, out loud, "do not page me for this". That is an
   *      opt-out row: same ruleType, same severity, isOptOut true, no method.
   *      It is checked FIRST, before the project setting and before any
   *      delivery, and it ends the execution successfully - deliberate silence
   *      is not a failure.
   *   2. The project asked for the old behaviour wholesale, via
   *      disableOnCallNotificationFallback. It gets the old behaviour exactly:
   *      the same status, the same terminal Error, the same sentence.
   *   3. Everything else - overwhelmingly a severity created after the
   *      responder joined, or an episode rule type they never opened the page
   *      for. Somebody is expecting this page to arrive, so it is delivered on
   *      whatever verified method the responder does have.
   *
   * Note what "notified" can and cannot mean here. Every send downstream is
   * fire-and-forget with a .catch that flips its own timeline row, so nothing
   * on this path can observe whether a phone actually rang. `notified` means "a
   * delivery was dispatched on at least one channel", and the per-channel
   * timeline rows remain the record of what happened after that.
   *
   * Case 3 then splits again on WHY a fallback did not deliver, because the
   * status this method writes is the difference between a log that is finished
   * and a log that is merely unlucky - see the branch below. And every case 3
   * ending, delivered or not, is reported to the humans who can fix the
   * configuration through OnCallNotificationAlertingService; cases 1 and 2
   * return before that, because neither is a surprise to anybody.
   */
  private async handleNoMatchingNotificationRule(data: {
    createdItem: Model;
    notificationRuleType: NotificationRuleType;
    incidentSeverityId: ObjectID | undefined;
    alertSeverityId: ObjectID | undefined;
    severityName: string;
    /*
     * A fallback that failed before anything of it reached a sender, and
     * can be tried again (issue #8469): handed to the person's-log worker
     * as the log starts, thrown for the worker's next try when it is the
     * worker's, ended as failed at the worker's last try.
     */
    onRetryableFailure?: "hand-to-worker" | "rethrow" | "end" | undefined;
  }): Promise<void> {
    const createdItem: Model = data.createdItem;

    const optOutRule: UserNotificationRule | null =
      await UserNotificationRuleService.findOneBy({
        query: {
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          ruleType: data.notificationRuleType,
          incidentSeverityId: data.incidentSeverityId,
          alertSeverityId: data.alertSeverityId,
          isOptOut: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (optOutRule) {
      const optOutMessage: string = getOnCallOptedOutStatusMessage({
        severityName: data.severityName,
        pagedFor: this.getRuleTypeLabelForMessage(data.notificationRuleType),
      });

      /*
       * Completed, not Error: the system did exactly what it was told to do.
       * The timeline says Skipped rather than Notification Sent because nothing
       * was in fact sent, and an operator scanning the escalation needs to see
       * the difference between "muted on purpose" and "delivered".
       */
      await this.writeNoRuleOutcome({
        createdItem: createdItem,
        status: UserNotificationExecutionStatus.Completed,
        timelineStatus: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: optOutMessage,
      });

      return;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: createdItem.projectId!,
      select: {
        disableOnCallNotificationFallback: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (project?.disableOnCallNotificationFallback) {
      await this.writeNoRuleOutcome({
        createdItem: createdItem,
        status: UserNotificationExecutionStatus.Error,
        timelineStatus: OnCallDutyExecutionLogTimelineStatus.Error,
        statusMessage: NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      });

      /*
       * Alert the humans BEFORE returning. A project that has turned the
       * fallback off is not a project with nothing to report - it is the one
       * population still losing pages exactly the way they were lost before any
       * of this existed, because it has explicitly opted back into the old
       * dead-end. Returning early here would have made the owner notification
       * reach every project except the one that needs it most.
       */
      this.alertOfUndeliverablePage({
        createdItem: createdItem,
        notificationRuleType: data.notificationRuleType,
        severityName: data.severityName,
        fallbackChannelsUsed: [],
      });

      return;
    }

    let fallbackResult: FallbackNotificationResult | null = null;
    let fallbackThrew: boolean = false;

    try {
      fallbackResult =
        await UserNotificationRuleService.executeFallbackNotification({
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          userOnCallLogId: createdItem.id!,
          ruleType: data.notificationRuleType,
          severityName: data.severityName,
          userNotificationLogId: createdItem.id!,
          triggeredByIncidentId: createdItem.triggeredByIncidentId,
          triggeredByAlertId: createdItem.triggeredByAlertId,
          triggeredByAlertEpisodeId: createdItem.triggeredByAlertEpisodeId,
          triggeredByIncidentEpisodeId:
            createdItem.triggeredByIncidentEpisodeId,
          userNotificationEventType: createdItem.userNotificationEventType!,
          onCallPolicyExecutionLogId:
            createdItem.onCallDutyPolicyExecutionLogId,
          onCallPolicyId: createdItem.onCallDutyPolicyId,
          onCallPolicyEscalationRuleId:
            createdItem.onCallDutyPolicyEscalationRuleId,
          userBelongsToTeamId: createdItem.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            createdItem.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: createdItem.onCallDutyScheduleId,
        });
    } catch (err) {
      /*
       * The caller is part-way through paging an entire escalation level. A
       * throw out of here would abort the responders queued behind this one, so
       * a fallback that fails is recorded against THIS log and no further.
       */
      fallbackThrew = true;
      logger.error(
        `On-call notification fallback failed for UserOnCallLog ${createdItem.id?.toString()}`,
      );
      logger.error(err);
    }

    /*
     * Another run holds the fallback's claim on this log: it fell back for
     * it at the same moment, and is sending. It owns what happens next - the
     * log's status, its line, any alert to the owners - so nothing is
     * written over its page here: an Error would say a page that is going
     * out reached nobody, and stop the try again that run may ask for.
     * (While a claim always read as won, two runs both sent the fallback.)
     */
    if (fallbackResult?.isHeldByAnotherRun) {
      logger.info(
        `On-call fallback for UserOnCallLog ${createdItem.id?.toString()} is being sent by another run; this one leaves the log to it.`,
      );

      return;
    }

    /*
     * The fallback found that the person is not a member of the project (they
     * left between the rule count and the fallback): nothing was sent, and
     * nothing about them needs fixing, so the log says so and no owner is
     * told a page went undelivered.
     */
    /*
     * The fallback failed before it sent anything, for a reason a retry can
     * outlast - the database lost as it read the person's methods - and its
     * claim was given back (issue #8469): it is tried again rather than the
     * log ended in Error, and the person paged by nothing. As the log starts,
     * the person's-log worker takes it from here (sendToLogWithNoRules), and
     * tries it a few more times before it ends it.
     */
    if (fallbackResult?.toTryAgainAfter && data.onRetryableFailure !== "end") {
      if (data.onRetryableFailure === "rethrow") {
        throw fallbackResult.toTryAgainAfter;
      }

      logger.error(
        `On-call fallback for UserOnCallLog ${createdItem.id?.toString()} failed before it sent anything; the person's-log worker tries it again.`,
      );
      logger.error(fallbackResult.toTryAgainAfter);

      await this.updateOneById({
        id: createdItem.id!,
        data: {
          status: UserNotificationExecutionStatus.Executing,
        },
        props: {
          isRoot: true,
        },
      });

      return;
    }

    if (
      fallbackResult &&
      fallbackResult.outcome === FallbackNotificationOutcome.NotAProjectMember
    ) {
      await this.writeNoRuleOutcome({
        createdItem: createdItem,
        status: UserNotificationExecutionStatus.Completed,
        timelineStatus: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
      });

      return;
    }

    if (fallbackResult && fallbackResult.notified) {
      const notifiedMessage: string = getOnCallFallbackNotifiedStatusMessage({
        severityName: data.severityName,
        channelsUsed: fallbackResult.channelsUsed,
      });

      /*
       * Executing, matching the normal path: there are no further rules to fire,
       * so UserOnCallLog:ExecutePendingExecutions will find an empty rule list on
       * its next tick and close the log out as Completed.
       */
      await this.writeNoRuleOutcome({
        createdItem: createdItem,
        status: UserNotificationExecutionStatus.Executing,
        timelineStatus: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        statusMessage: notifiedMessage,
      });
    } else {
      const responderLabel: string = await this.getResponderLabelForMessage(
        createdItem.userId,
      );

      /*
       * Nothing was delivered, and every reason for that ends the same way:
       * terminally, saying so.
       *
       * The tempting alternative is to treat a raised delivery attempt as
       * transient and leave the log Executing for a retry, mirroring
       * App/FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions,
       * which deliberately marks Error only for permanent bad-data failures.
       * That analogy does not hold here, and following it produces a worse bug
       * than the one it avoids.
       *
       * ExecutePendingExecutions re-enters ITSELF: it selects logs in Executing
       * every minute and re-fires their still-due rules, so a log left live
       * genuinely gets another attempt. This function does not. It is called
       * from onCreateSuccess, once, at the moment the log row is written, and
       * nothing re-enters it - so "leave it Executing for the next tick" buys
       * no retry at all. What it actually buys is this: on the next tick
       * ExecutePendingExecutions picks the log up, queries for due rules, finds
       * none (there were none to begin with - that is why we are here), takes
       * its all-executed path and marks the log Completed. onUpdateSuccess then
       * translates Completed into NotificationSent on the escalation timeline,
       * and within a minute the record reads "Alert Sent" for a page that was
       * never delivered.
       *
       * That is precisely the silent lie the opt-out exclusion was fixed to
       * remove, reintroduced through a different door. So both endings are
       * terminal, and only the message differs: a responder with no verified
       * method needs a different action than a delivery that blew up, and
       * whoever reads the log deserves to be told which happened.
       */
      const isPermanentlyUndeliverable: boolean =
        !fallbackThrew &&
        fallbackResult !== null &&
        fallbackResult.outcome ===
          FallbackNotificationOutcome.NoUsableNotificationMethod;

      await this.writeNoRuleOutcome({
        createdItem: createdItem,
        status: UserNotificationExecutionStatus.Error,
        timelineStatus: OnCallDutyExecutionLogTimelineStatus.Error,
        statusMessage: isPermanentlyUndeliverable
          ? getOnCallNoVerifiedMethodStatusMessage(responderLabel)
          : getOnCallFallbackFailedStatusMessage({
              responderLabel: responderLabel,
              severityName: data.severityName,
            }),
      });
    }

    /*
     * Section 5: tell the humans who can fix this. The policy's owners own the
     * configuration that is wrong; the responder owns the rules that are
     * missing. Neither of them is reading execution logs.
     *
     * One call site rather than one per branch, because every path that reaches
     * here is worth reporting and the difference between them is already
     * carried by fallbackChannelsUsed: a non-empty list means "your
     * configuration is wrong but nobody was dropped", an empty one means this
     * responder was not reached at all - which is equally true of the
     * no-verified-method ending and of the attempt that raised. The service
     * throttles per (project, user, ruleType) per 24h, so a page storm down this
     * branch cannot become a mail storm.
     *
     * Fire-and-forget with a .catch, exactly as
     * startUserNotificationRulesExecution treats its workspace rules:
     * notifyOfUndeliverablePage already swallows its own failures, and the
     * .catch is the guarantee that even a bug in the explanation can never
     * propagate into - or delay - the paging path that called it.
     */
    this.alertOfUndeliverablePage({
      createdItem: createdItem,
      notificationRuleType: data.notificationRuleType,
      severityName: data.severityName,
      fallbackChannelsUsed: fallbackResult ? fallbackResult.channelsUsed : [],
    });
  }

  /*
   * Fire-and-forget, exactly as startUserNotificationRulesExecution treats its
   * workspace rules: notifyOfUndeliverablePage already swallows its own
   * failures, and the .catch is the guarantee that even a bug in the
   * explanation can never propagate into - or delay - the paging path that
   * called it. Extracted to a helper because there are two callers now, and a
   * second inline copy is how one of them ends up silently drifting from the
   * other.
   */
  private alertOfUndeliverablePage(data: {
    createdItem: Model;
    notificationRuleType: NotificationRuleType;
    severityName: string;
    fallbackChannelsUsed: Array<string>;
  }): void {
    /*
     * A test page (OnCallTestPage) tells nobody else: its result says what
     * could not be delivered, and why, to whoever sent it - owners are not
     * emailed about a page that was only a test.
     */
    if (isOnCallTestPage(data.createdItem)) {
      return;
    }

    OnCallNotificationAlertingService.notifyOfUndeliverablePage({
      projectId: data.createdItem.projectId!,
      userId: data.createdItem.userId!,
      ruleType: data.notificationRuleType,
      severityName: data.severityName,
      onCallDutyPolicyId: data.createdItem.onCallDutyPolicyId,
      fallbackChannelsUsed: data.fallbackChannelsUsed,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  /*
   * The user column of a read that chooses what a page goes through: the
   * person the log pages, and only while they are a member of its project
   * (ProjectMembership). The escalation already checked membership, but it
   * pages as before when it cannot read it; this check rides on the read
   * that would deliver, costs no query of its own, and cannot fail open.
   */
  private userIdWhileMember(createdItem: Model): FindWhereProperty<any> {
    return ProjectMembership.userIdWhileMember({
      userId: createdItem.userId!,
      projectId: createdItem.projectId!,
    });
  }

  /*
   * Whether the person a log pages is known not to be a member of its
   * project. A failed read is "not known": the no-rule path runs, and its
   * fallback asks again before it reaches any method
   * (UserNotificationRuleService.chooseFallbackChannels).
   */
  private async isNotAProjectMember(createdItem: Model): Promise<boolean> {
    if (!createdItem.projectId || !createdItem.userId) {
      return false;
    }

    try {
      return !(await ProjectMembership.isMember({
        projectId: createdItem.projectId,
        userId: createdItem.userId,
      }));
    } catch (err) {
      logger.error(
        `Could not read project membership for UserOnCallLog ${createdItem.id?.toString()}; taking the no-rule path, whose fallback checks it again.`,
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * Both writes the no-rule path makes, in the order the pre-fallback code made
   * them: the log first, then the on-call timeline. The log update's own
   * onUpdateSuccess hook already maps the execution status onto the timeline, so
   * the explicit second write is what lets this path say something the mapping
   * cannot - Skipped for an opt-out, Notification Sent for a fallback that went
   * out under an Executing log.
   */
  private async writeNoRuleOutcome(data: {
    createdItem: Model;
    status: UserNotificationExecutionStatus;
    timelineStatus: OnCallDutyExecutionLogTimelineStatus;
    statusMessage: string;
  }): Promise<void> {
    /*
     * Without the log's own hook: it would carry the log's status over to
     * the on-call timeline (onUpdateSuccess) - Completed as "Notification
     * Sent" - and the timeline write below says what this outcome really is.
     * Through the hook, every responder skipped here showed first as
     * "Notification Sent" and then as "Skipped", in the record's feed and in
     * Slack and Microsoft Teams alike.
     */
    await this.updateOneById({
      id: data.createdItem.id!,
      data: {
        status: data.status,
        statusMessage: data.statusMessage,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: data.createdItem.onCallDutyPolicyExecutionLogTimelineId!,
      data: {
        status: data.timelineStatus,
        statusMessage: data.statusMessage,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * NotificationRuleType's values are whole sentences ("When incident on-call
   * policy is executed"), which read badly mid-sentence. These are the noun
   * forms for the messages this file writes. An unrecognised type falls back to
   * the raw value rather than throwing - a status message is never worth losing
   * a page over.
   */
  private getRuleTypeLabelForMessage(ruleType: NotificationRuleType): string {
    switch (ruleType) {
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT:
        return "incidents";
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
        return "alerts";
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
        return "incident episodes";
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
        return "alert episodes";
      default:
        return ruleType;
    }
  }

  /*
   * "Jane Doe has no verified notification method" is actionable; "This user
   * has no verified notification method" is a support ticket. The lookup is
   * best-effort in every sense - it only feeds a string, so a missing user or a
   * failed read degrades to a neutral phrase rather than propagating.
   */
  private async getResponderLabelForMessage(
    userId: ObjectID | undefined,
  ): Promise<string> {
    if (!userId) {
      return "This responder";
    }

    try {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      const label: string | undefined =
        user?.name?.toString() || user?.email?.toString();

      return label || "This responder";
    } catch (err) {
      logger.error(err);

      return "This responder";
    }
  }

  public getNotificationRuleType(
    userNotificationEventType: UserNotificationEventType,
  ): NotificationRuleType {
    if (
      userNotificationEventType === UserNotificationEventType.IncidentCreated
    ) {
      return NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
    }

    if (userNotificationEventType === UserNotificationEventType.AlertCreated) {
      return NotificationRuleType.ON_CALL_EXECUTED_ALERT;
    }

    if (
      userNotificationEventType ===
      UserNotificationEventType.AlertEpisodeCreated
    ) {
      return NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE;
    }

    if (
      userNotificationEventType ===
      UserNotificationEventType.IncidentEpisodeCreated
    ) {
      return NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE;
    }

    // Invalid user notification event type.
    throw new BadDataException("Invalid user notification event type.");
  }
}
export default new Service();

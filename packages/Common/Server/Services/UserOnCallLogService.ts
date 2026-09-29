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

/*
 * The status message the zero-rule dead-end wrote before the fallback existed,
 * kept verbatim. A project that sets `disableOnCallNotificationFallback` is
 * asking for precisely the old behaviour, so it must still receive precisely
 * the old words - operators grep their execution logs for this sentence, and a
 * characterisation test pins it character for character.
 */
export const NO_NOTIFICATION_RULES_STATUS_MESSAGE: string =
  "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.";

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

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 30);
    }
  }

  /**
   * Atomically claim the right to execute ONE notification rule for this
   * on-call log. Rules are claimed under their own id; see
   * claimNotificationExecution below for what the claim actually guarantees and
   * why it is keyed by a string.
   *
   * Returns true when THIS call claimed the rule (caller should send), false when
   * it was already executed/claimed (caller should skip) or the log is missing.
   */
  @CaptureSpan()
  public async claimNotificationRuleExecution(data: {
    userOnCallLogId: ObjectID;
    userNotificationRuleId: ObjectID;
  }): Promise<boolean> {
    return await this.claimNotificationExecution({
      userOnCallLogId: data.userOnCallLogId,
      claimKey: data.userNotificationRuleId.toString(),
    });
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
   * wins and the loser skips.
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
  }): Promise<boolean> {
    const ruleKey: string = data.claimKey;

    try {
      const nowIso: string = OneUptimeDate.getCurrentDate().toISOString();

      const rows: Array<{ _id: string }> =
        await this.getRepository().manager.query(
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

      return Array.isArray(rows) && rows.length > 0;
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

      executed[ruleKey] = OneUptimeDate.getCurrentDate();

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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.status = UserNotificationExecutionStatus.Scheduled;

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
        default:
          throw new BadDataException("Invalid status");
      }

      for (const item of items) {
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
          userId: createdItem.userId!,
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
          userId: createdItem.userId!,
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
          userId: createdItem.userId!,
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
          userId: createdItem.userId!,
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
          userId: createdItem.userId!,
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

    // update oncall timeline item as well.
    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: createdItem.onCallDutyPolicyExecutionLogTimelineId!,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        statusMessage: "Alert Sent",
      },
      props: {
        isRoot: true,
      },
    });

    return createdItem;
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
      const optOutMessage: string = `You have opted out of notifications for ${
        data.severityName
      } ${this.getRuleTypeLabelForMessage(data.notificationRuleType)}.`;

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

    if (fallbackResult && fallbackResult.notified) {
      const notifiedMessage: string = `No notification rule configured for ${
        data.severityName
      }; notified via fallback (${fallbackResult.channelsUsed.join(", ")}).`;

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
          ? `${responderLabel} has no verified notification method, so this page could not be delivered. Ask them to add one in User Settings > Notification Methods.`
          : `${responderLabel} has no notification rule for ${data.severityName} and the fallback delivery attempt failed, so this page was not delivered. Check the worker logs, then add a rule in User Settings > On-Call Rules.`,
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
    await this.updateOneById({
      id: data.createdItem.id!,
      data: {
        status: data.status,
        statusMessage: data.statusMessage,
      },
      props: {
        isRoot: true,
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

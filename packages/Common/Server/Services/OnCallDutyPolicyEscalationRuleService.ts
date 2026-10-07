import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import OnCallDutyPolicyChildService from "./OnCallDutyPolicyChildService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { getDefaultEscalationRuleName } from "../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import PositiveNumber from "../../Types/PositiveNumber";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLogTimeline from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../Models/DatabaseModels/User";
import logger, { LogAttributes } from "../Utils/Logger";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ContiguousOrder from "../Utils/Database/ContiguousOrder";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";

/*
 * The escalation timeline's line for a recipient the rule would have paged
 * who is not a member of the project (they left, or never accepted their
 * invitation): nothing is sent to them.
 */
export const NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE: string =
  "Skipped because this user is not a member of the project.";

/*
 * One person an escalation rule pages, or one schedule of the rule with
 * nobody on call right now - collected in paging order before anybody is
 * paged (see startRuleExecution).
 */
enum RuleTargetKind {
  Recipient = "Recipient",
  ScheduleGap = "ScheduleGap",
}

interface RecipientRuleTarget {
  kind: RuleTargetKind.Recipient;
  // Who the rule names (a team member, a user, the schedule's on-call user)...
  originalUserId: ObjectID;
  // ...and who is paged for them, once an override is applied.
  recipientUserId: ObjectID;
  teamId: ObjectID | null;
  scheduleId: ObjectID | null;
}

interface ScheduleGapRuleTarget {
  kind: RuleTargetKind.ScheduleGap;
  scheduleId: ObjectID;
}

type RuleTarget = RecipientRuleTarget | ScheduleGapRuleTarget;

/*
 * A rule moved to another place by a non-root update: where it was, where it
 * goes, and its policy. Read before the update (onBeforeUpdate) and acted on
 * after it (onUpdateSuccess), only if the update wrote that rule.
 */
interface RuleMove {
  ruleId: ObjectID;
  previousOrder: number;
  newOrder: number;
  onCallDutyPolicyId: ObjectID;
  projectId: ObjectID;
}

// The two names of the policy a rule belongs to, ID column first.
const ON_CALL_DUTY_POLICY_KEYS: Array<string> = [
  "onCallDutyPolicyId",
  "onCallDutyPolicy",
];

export class Service extends OnCallDutyPolicyChildService<Model> {
  @CaptureSpan()
  public async getRouteAlertToUserId(data: {
    userId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<ObjectID | null> {
    logger.debug(
      `Getting route alert to user id for userId: ${data.userId.toString()}`,
      {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      } as LogAttributes,
    );

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const alertRoutedTo: Array<OnCallDutyPolicyUserOverride> =
      await OnCallDutyPolicyUserOverrideService.findBy({
        query: {
          overrideUserId: data.userId,
          onCallDutyPolicyId: QueryHelper.equalToOrNull(
            data.onCallDutyPolicyId,
          ), // find global overrides as well. If this is null, then it will find global overrides.
          projectId: data.projectId,
          startsAt: QueryHelper.lessThanEqualTo(currentDate),
          endsAt: QueryHelper.greaterThanEqualTo(currentDate),
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          routeAlertsToUserId: true,
          onCallDutyPolicyId: true,
        },
      });

    logger.debug(`Found alert routed to: ${JSON.stringify(alertRoutedTo)}`, {
      projectId: data.projectId.toString(),
      userId: data.userId.toString(),
    } as LogAttributes);

    // local override takes precedence over global override.
    const localOverride: OnCallDutyPolicyUserOverride | undefined =
      alertRoutedTo.find((item: OnCallDutyPolicyUserOverride) => {
        return (
          item.onCallDutyPolicyId?.toString() ===
          data.onCallDutyPolicyId.toString()
        );
      });

    if (localOverride && localOverride.routeAlertsToUserId) {
      logger.debug(
        `Route alert to user id found: ${localOverride.routeAlertsToUserId.toString()}`,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return localOverride.routeAlertsToUserId;
    }

    const globalOverride: OnCallDutyPolicyUserOverride | undefined =
      alertRoutedTo.find((item: OnCallDutyPolicyUserOverride) => {
        return !item.onCallDutyPolicyId;
      });

    if (globalOverride && globalOverride.routeAlertsToUserId) {
      logger.debug(
        `Route alert to user id found: ${globalOverride.routeAlertsToUserId.toString()}`,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return globalOverride.routeAlertsToUserId;
    }

    return null;
  }

  @CaptureSpan()
  public async startRuleExecution(
    ruleId: ObjectID,
    options: {
      projectId: ObjectID;
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      triggeredByAlertEpisodeId?: ObjectID | undefined;
      triggeredByIncidentEpisodeId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
      onCallPolicyExecutionLogId: ObjectID;
      onCallPolicyId: ObjectID;
    },
  ): Promise<void> {
    logger.debug(`Starting rule execution for ruleId: ${ruleId.toString()}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);

    const rule: Model | null = await this.findOneById({
      id: ruleId,
      select: {
        _id: true,
        order: true,
        escalateAfterInMinutes: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!rule) {
      throw new BadDataException(
        `On-Call Duty Policy Escalation Rule with id ${ruleId.toString()} not found`,
      );
    }

    logger.debug(`Found rule: ${JSON.stringify(rule)}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: options.onCallPolicyExecutionLogId,
      data: {
        lastEscalationRuleExecutedAt: OneUptimeDate.getCurrentDate(),
        lastExecutedEscalationRuleId: ruleId,
        lastExecutedEscalationRuleOrder: rule.order!,
        executeNextEscalationRuleInMinutes: rule.escalateAfterInMinutes || 0,
      },
      props: {
        isRoot: true,
      },
    });

    logger.debug(`Updated execution log for ruleId: ${ruleId.toString()}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);

    type GetNewLogFunction = () => OnCallDutyPolicyExecutionLogTimeline;

    const getNewLog: GetNewLogFunction =
      (): OnCallDutyPolicyExecutionLogTimeline => {
        const log: OnCallDutyPolicyExecutionLogTimeline =
          new OnCallDutyPolicyExecutionLogTimeline();

        log.projectId = options.projectId;
        log.onCallDutyPolicyExecutionLogId = options.onCallPolicyExecutionLogId;
        log.onCallDutyPolicyId = options.onCallPolicyId;
        log.onCallDutyPolicyEscalationRuleId = ruleId;
        log.userNotificationEventType = options.userNotificationEventType;

        if (options.triggeredByIncidentId) {
          log.triggeredByIncidentId = options.triggeredByIncidentId;
        }

        if (options.triggeredByAlertId) {
          log.triggeredByAlertId = options.triggeredByAlertId;
        }

        if (options.triggeredByAlertEpisodeId) {
          log.triggeredByAlertEpisodeId = options.triggeredByAlertEpisodeId;
        }

        if (options.triggeredByIncidentEpisodeId) {
          log.triggeredByIncidentEpisodeId =
            options.triggeredByIncidentEpisodeId;
        }

        return log;
      };

    if (
      UserNotificationEventType.IncidentCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentId
    ) {
      throw new BadDataException(
        "triggeredByIncidentId is required when userNotificationEventType is IncidentCreated",
      );
    }

    if (
      UserNotificationEventType.AlertCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertId
    ) {
      throw new BadDataException(
        "triggeredByAlertId is required when userNotificationEventType is AlertCreated",
      );
    }

    if (
      UserNotificationEventType.AlertEpisodeCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertEpisodeId
    ) {
      throw new BadDataException(
        "triggeredByAlertEpisodeId is required when userNotificationEventType is AlertEpisodeCreated",
      );
    }

    if (
      UserNotificationEventType.IncidentEpisodeCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentEpisodeId
    ) {
      throw new BadDataException(
        "triggeredByIncidentEpisodeId is required when userNotificationEventType is IncidentEpisodeCreated",
      );
    }

    const usersInRule: Array<OnCallDutyPolicyEscalationRuleUser> =
      await OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: {
          onCallDutyPolicyEscalationRuleId: ruleId,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          userId: true,
        },
      });

    logger.debug(`Found users in rule: ${JSON.stringify(usersInRule)}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);

    const teamsInRule: Array<OnCallDutyPolicyEscalationRuleTeam> =
      await OnCallDutyPolicyEscalationRuleTeamService.findBy({
        query: {
          onCallDutyPolicyEscalationRuleId: ruleId,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          teamId: true,
        },
      });

    logger.debug(`Found teams in rule: ${JSON.stringify(teamsInRule)}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);

    const schedulesInRule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyEscalationRuleId: ruleId,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          onCallDutyPolicyScheduleId: true,
        },
      });

    logger.debug(
      `Found schedules in rule: ${JSON.stringify(schedulesInRule)}`,
      {
        projectId: options.projectId.toString(),
        onCallDutyPolicyEscalationRuleId: ruleId.toString(),
      } as LogAttributes,
    );

    type StartUserNotificationRuleExecutionFunction = (
      originalUserId: ObjectID,
      alertSentToUserId: ObjectID,
      teamId: ObjectID | null,
      scheduleId: ObjectID | null,
    ) => Promise<void>;

    /*
     * Resolve the FINAL alert recipient for a target, applying a user override
     * (getRouteAlertToUserId) exactly ONCE per paging decision.
     *
     * Schedule targets are already override-resolved: getCurrentUserIdInSchedule
     * applies overrides via UserOverrideUtil. Applying getRouteAlertToUserId to
     * them again re-substituted an already-substituted user (transitive), so the
     * schedule paging path could page a different person than the roster,
     * dashboard, handoff notification, and a rule that lists the same user
     * directly — all of which apply overrides only once (audit F5). So team and
     * direct-user targets (the RAW roster user) get the single override hop here;
     * schedule targets do not.
     */
    const resolveAlertRecipientUserId: (
      userId: ObjectID,
      isFromSchedule: boolean,
    ) => Promise<ObjectID> = async (
      userId: ObjectID,
      isFromSchedule: boolean,
    ): Promise<ObjectID> => {
      if (isFromSchedule) {
        return userId;
      }

      if (options.onCallPolicyId) {
        const routeAlertToUserId: ObjectID | null =
          await this.getRouteAlertToUserId({
            userId,
            onCallDutyPolicyId: options.onCallPolicyId,
            projectId: options.projectId,
          });

        if (routeAlertToUserId) {
          return routeAlertToUserId;
        }
      }

      return userId;
    };

    const startUserNotificationRuleExecution: StartUserNotificationRuleExecutionFunction =
      async (
        originalUserId: ObjectID,
        alertSentToUserId: ObjectID,
        teamId: ObjectID | null,
        scheduleId: ObjectID | null,
      ): Promise<void> => {
        /*
         * This is where user is notified. alertSentToUserId is already resolved
         * (override applied at most once by resolveAlertRecipientUserId).
         */

        const wasOverridden: boolean =
          alertSentToUserId.toString() !== originalUserId.toString();

        logger.debug(
          `Starting notification rule execution for userId: ${alertSentToUserId.toString()}`,
          {
            projectId: options.projectId.toString(),
            onCallDutyPolicyEscalationRuleId: ruleId.toString(),
            userId: alertSentToUserId.toString(),
          } as LogAttributes,
        );
        let log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = "Sending notification to user.";
        log.status = OnCallDutyExecutionLogTimelineStatus.Executing;
        log.alertSentToUserId = alertSentToUserId;

        if (wasOverridden) {
          log.overridedByUserId = originalUserId;
        }

        if (teamId) {
          log.userBelongsToTeamId = teamId;
        }

        if (scheduleId) {
          log.onCallDutyScheduleId = scheduleId;
        }

        log = await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        await UserNotificationRuleService.startUserNotificationRulesExecution(
          alertSentToUserId,
          {
            userNotificationEventType: options.userNotificationEventType!,
            triggeredByIncidentId: options.triggeredByIncidentId || undefined,
            triggeredByAlertId: options.triggeredByAlertId || undefined,
            triggeredByAlertEpisodeId:
              options.triggeredByAlertEpisodeId || undefined,
            triggeredByIncidentEpisodeId:
              options.triggeredByIncidentEpisodeId || undefined,
            onCallPolicyExecutionLogId: options.onCallPolicyExecutionLogId,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: ruleId,
            userBelongsToTeamId: teamId || undefined,
            onCallDutyPolicyExecutionLogTimelineId: log.id!,
            projectId: options.projectId,
            onCallScheduleId: scheduleId || undefined,
            overridedByUserId: wasOverridden ? originalUserId : undefined,
          },
        );
      };

    /*
     * Dedup on the RESOLVED recipient (post-override), not the pre-route id.
     * Keying on the pre-route id let two different targets that both reroute to
     * the same backup each fire a full notification chain for the same person in
     * one rule (audit F6).
     */
    const uniqueUserIds: Array<ObjectID> = [];
    const alreadyNotified: (recipientId: ObjectID) => boolean = (
      recipientId: ObjectID,
    ): boolean => {
      return Boolean(
        uniqueUserIds.find((userId: ObjectID) => {
          return recipientId.toString() === userId.toString();
        }),
      );
    };

    /*
     * M-5: tracks whether any schedule target for this rule momentarily had no
     * on-call user (a restriction gap / future start / empty layer). If a rule
     * reaches NO ONE solely because of such a gap, we re-sample the same rule on
     * the next cron ticks (bounded) instead of permanently skipping it, so a
     * user coming on-call moments later still gets paged.
     */
    let hadScheduleGap: boolean = false;

    /*
     * Who this rule pages, in paging order: the accepted members of each
     * team, then the users named directly, then whoever is on call in each
     * schedule. Resolved first and paged after, so whether each recipient is
     * still a member of the project is read ONCE for the whole rule rather
     * than once per person.
     */
    const targets: Array<RuleTarget> = [];

    for (const teamInRule of teamsInRule) {
      /*
       * Accepted rows only. A pending invitation grants none of the team's
       * permissions and puts nobody on its roster, so somebody who has not
       * joined is not paged through the team.
       */
      const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeams(
        [teamInRule.teamId!],
        { acceptedOnly: true },
      );

      for (const user of usersInTeam) {
        if (!user?.id) {
          continue;
        }

        targets.push({
          kind: RuleTargetKind.Recipient,
          originalUserId: user.id,
          recipientUserId: await resolveAlertRecipientUserId(user.id, false),
          teamId: teamInRule.teamId!,
          scheduleId: null,
        });
      }
    }

    for (const userRule of usersInRule) {
      if (!userRule.userId) {
        continue;
      }

      targets.push({
        kind: RuleTargetKind.Recipient,
        originalUserId: userRule.userId,
        recipientUserId: await resolveAlertRecipientUserId(
          userRule.userId,
          false,
        ),
        teamId: null,
        scheduleId: null,
      });
    }

    for (const scheduleRule of schedulesInRule) {
      const userIdInSchedule: ObjectID | null =
        await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
          scheduleRule.onCallDutyPolicyScheduleId!,
          { onCallDutyPolicyId: options.onCallPolicyId },
        );

      if (!userIdInSchedule) {
        targets.push({
          kind: RuleTargetKind.ScheduleGap,
          scheduleId: scheduleRule.onCallDutyPolicyScheduleId!,
        });

        continue;
      }

      targets.push({
        kind: RuleTargetKind.Recipient,
        originalUserId: userIdInSchedule,
        // Schedule users are already override-resolved; no second override hop (F5).
        recipientUserId: await resolveAlertRecipientUserId(
          userIdInSchedule,
          true,
        ),
        teamId: null,
        scheduleId: scheduleRule.onCallDutyPolicyScheduleId!,
      });
    }

    /*
     * Nobody is paged on the project's behalf unless they are a member of it
     * now. A user named on the rule, on call in a schedule or covering an
     * override who has since left would otherwise still be reached through
     * whatever notification methods they had - the leave cleanup removes
     * those references, and this keeps a reference it missed from paging
     * anyone. One read for every recipient of the rule (ProjectMembership).
     */
    const memberUserIds: Set<string> = await ProjectMembership.getMemberUserIds(
      {
        projectId: options.projectId,
        userIds: targets
          .filter((target: RuleTarget): target is RecipientRuleTarget => {
            return target.kind === RuleTargetKind.Recipient;
          })
          .map((target: RecipientRuleTarget): ObjectID => {
            return target.recipientUserId;
          }),
      },
    );

    for (const target of targets) {
      if (target.kind === RuleTargetKind.ScheduleGap) {
        hadScheduleGap = true;

        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage =
          "Skipped because no active users are found in this schedule.";
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.onCallDutyScheduleId = target.scheduleId;

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        continue;
      }

      if (!memberUserIds.has(target.recipientUserId.toString().toLowerCase())) {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE;
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.alertSentToUserId = target.recipientUserId;

        if (
          target.recipientUserId.toString() !== target.originalUserId.toString()
        ) {
          log.overridedByUserId = target.originalUserId;
        }

        if (target.teamId) {
          log.userBelongsToTeamId = target.teamId;
        }

        if (target.scheduleId) {
          log.onCallDutyScheduleId = target.scheduleId;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        continue;
      }

      if (!alreadyNotified(target.recipientUserId)) {
        uniqueUserIds.push(target.recipientUserId);
        await startUserNotificationRuleExecution(
          target.originalUserId,
          target.recipientUserId,
          target.teamId,
          target.scheduleId,
        );
      } else {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage =
          "Skipped because notification sent to this user already.";
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.alertSentToUserId = target.recipientUserId;

        if (target.teamId) {
          log.userBelongsToTeamId = target.teamId;
        }

        if (target.scheduleId) {
          log.onCallDutyScheduleId = target.scheduleId;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (uniqueUserIds.length === 0) {
      const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
      log.statusMessage = "Skipped because no users in this rule.";
      log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;

      await OnCallDutyPolicyExecutionLogTimelineService.create({
        data: log,
        props: {
          isRoot: true,
        },
      });
    }

    /*
     * M-5: if this rule reached NO ONE and the only reason was a schedule gap
     * (a schedule target with no on-call user right now), re-sample the SAME
     * rule on the next cron ticks — bounded — instead of permanently skipping.
     * ExecutePendingExecutions selects the rule with order =
     * lastExecutedEscalationRuleOrder + 1, so rewinding the order by one makes
     * it re-run this rule. No notifications were sent (uniqueUserIds is empty),
     * so a re-sample cannot double-page anyone.
     */
    const maxScheduleGapRetries: number = 5;
    const scheduleGapRetryIntervalMinutes: number = 1;
    const reachedNoOne: boolean = uniqueUserIds.length === 0;

    if (reachedNoOne && hadScheduleGap && rule.order) {
      const executionLog: OnCallDutyPolicyExecutionLog | null =
        await OnCallDutyPolicyExecutionLogService.findOneById({
          id: options.onCallPolicyExecutionLogId,
          select: {
            scheduleGapRetryCount: true,
          },
          props: {
            isRoot: true,
          },
        });

      const retryCount: number = executionLog?.scheduleGapRetryCount || 0;

      if (retryCount < maxScheduleGapRetries) {
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: options.onCallPolicyExecutionLogId,
          data: {
            lastExecutedEscalationRuleOrder: rule.order - 1,
            executeNextEscalationRuleInMinutes: scheduleGapRetryIntervalMinutes,
            scheduleGapRetryCount: retryCount + 1,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug(
          `Rule ${ruleId.toString()} reached no one due to a schedule gap; re-sampling ${retryCount + 1}/${maxScheduleGapRetries}.`,
          {
            onCallDutyPolicyEscalationRuleId: ruleId.toString(),
          } as LogAttributes,
        );
      } else {
        // Retries exhausted — advance normally next tick and reset the counter.
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: options.onCallPolicyExecutionLogId,
          data: {
            scheduleGapRetryCount: 0,
          },
          props: {
            isRoot: true,
          },
        });
      }
    } else {
      // Reached someone (or no schedule gap): clear retry state for the next rule.
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: options.onCallPolicyExecutionLogId,
        data: {
          scheduleGapRetryCount: 0,
        },
        props: {
          isRoot: true,
        },
      });
    }

    logger.debug(`Completed rule execution for ruleId: ${ruleId.toString()}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);
  }

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    /*
     * The rules at the new rule's place and after it move one place down -
     * now that it exists, so a create that is refused or fails leaves the
     * policy's order as it was.
     */
    if (createdItem.onCallDutyPolicyId && createdItem.order) {
      await ContiguousOrder.afterCreate({
        service: this,
        list: {
          onCallDutyPolicyId: createdItem.onCallDutyPolicyId,
          projectId: createdItem.projectId,
        },
        createdItemId: createdItem.id,
        order: createdItem.order,
      });
    }

    // add people in escalation rule.

    if (
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["teams"] ||
        onCreate.createBy.miscDataProps["users"] ||
        onCreate.createBy.miscDataProps["onCallSchedules"])
    ) {
      await this.addUsersTeamsAndSchedules(
        createdItem.projectId,
        createdItem.id,
        createdItem.onCallDutyPolicyId!,
        (onCreate.createBy.miscDataProps["users"] as Array<ObjectID>) || [],
        (onCreate.createBy.miscDataProps["teams"] as Array<ObjectID>) || [],
        (onCreate.createBy.miscDataProps[
          "onCallSchedules"
        ] as Array<ObjectID>) || [],
        onCreate.createBy.props,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  public async addUsersTeamsAndSchedules(
    projectId: ObjectID,
    escalationRuleId: ObjectID,
    onCallDutyPolicyId: ObjectID,
    usersIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    onCallScheduleIds: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (const userId of usersIds) {
      await this.addUser(
        projectId,
        escalationRuleId,
        onCallDutyPolicyId,
        userId,
        props,
      );
    }

    for (const teamId of teamIds) {
      await this.addTeam(
        projectId,
        escalationRuleId,
        onCallDutyPolicyId,
        teamId,
        props,
      );
    }

    for (const scheduleId of onCallScheduleIds) {
      await this.addOnCallSchedules(
        projectId,
        escalationRuleId,
        onCallDutyPolicyId,
        scheduleId,
        props,
      );
    }
  }

  @CaptureSpan()
  public async addTeam(
    projectId: ObjectID,
    escalationRuleId: ObjectID,
    onCallDutyPolicyId: ObjectID,
    teamId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    const teamInRule: OnCallDutyPolicyEscalationRuleTeam =
      new OnCallDutyPolicyEscalationRuleTeam();
    teamInRule.projectId = projectId;
    teamInRule.onCallDutyPolicyId = onCallDutyPolicyId;
    teamInRule.onCallDutyPolicyEscalationRuleId = escalationRuleId;
    teamInRule.teamId = teamId;
    if (props.userId) {
      teamInRule.createdByUserId = props.userId;
    }

    await OnCallDutyPolicyEscalationRuleTeamService.create({
      data: teamInRule,
      props,
    });
  }

  @CaptureSpan()
  public async addOnCallSchedules(
    projectId: ObjectID,
    escalationRuleId: ObjectID,
    onCallDutyPolicyId: ObjectID,
    onCallScheduleId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    const scheduleInRule: OnCallDutyPolicyEscalationRuleSchedule =
      new OnCallDutyPolicyEscalationRuleSchedule();
    scheduleInRule.projectId = projectId;
    scheduleInRule.onCallDutyPolicyId = onCallDutyPolicyId;
    scheduleInRule.onCallDutyPolicyEscalationRuleId = escalationRuleId;
    scheduleInRule.onCallDutyPolicyScheduleId = onCallScheduleId;

    if (props.userId) {
      scheduleInRule.createdByUserId = props.userId;
    }

    await OnCallDutyPolicyEscalationRuleScheduleService.create({
      data: scheduleInRule,
      props,
    });
  }

  @CaptureSpan()
  public async addUser(
    projectId: ObjectID,
    escalationRuleId: ObjectID,
    onCallDutyPolicyId: ObjectID,
    userId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    const userInRule: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    userInRule.projectId = projectId;
    userInRule.onCallDutyPolicyId = onCallDutyPolicyId;
    userInRule.onCallDutyPolicyEscalationRuleId = escalationRuleId;
    userInRule.userId = userId;

    if (props.userId) {
      userInRule.createdByUserId = props.userId;
    }

    await OnCallDutyPolicyEscalationRuleUserService.create({
      data: userInRule,
      props,
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * The policy the rule is added to, under either of its names (the two
     * must agree), read once: the free-plan count, the order and the default
     * name all go by it, and it is written back under the ID column alone so
     * the rule is stored on the policy they counted.
     */
    const onCallDutyPolicyId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ON_CALL_DUTY_POLICY_KEYS,
      "On-Call Policy",
    );

    if (!onCallDutyPolicyId) {
      throw new BadDataException(
        "Status Page Resource onCallDutyPolicyId is required",
      );
    }

    RelationIdUtil.stamp(
      createBy.data as unknown as Record<string, unknown>,
      ON_CALL_DUTY_POLICY_KEYS,
      onCallDutyPolicyId,
    );

    if (IsBillingEnabled && createBy.props.currentPlan === PlanType.Free) {
      // then check no of policies and if it is more than one, return error
      const count: PositiveNumber = await this.countBy({
        query: {
          projectId: createBy.data.projectId!,
          onCallDutyPolicyId: onCallDutyPolicyId,
        },
        props: {
          isRoot: true,
        },
      });

      if (count.toNumber() >= 1) {
        throw new BadDataException(
          "You can only create one escalation rule in free plan.",
        );
      }
    }

    if (!createBy.data.order) {
      const query: Query<Model> = {
        onCallDutyPolicyId: onCallDutyPolicyId,
      };

      const count: PositiveNumber = await this.countBy({
        query: query,
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    /*
     * A rule nobody named is called after its level: "Level 3" for the third
     * rule of the policy. Adding a rule in the dashboard asks only who to
     * notify and how long to wait, and the name it leaves out is this one -
     * the form shows it as its placeholder. Done before the required-field
     * check, which runs after this hook, so the column stays required for
     * everything else that writes it.
     */
    if (!createBy.data.name || !createBy.data.name.toString().trim()) {
      createBy.data.name = getDefaultEscalationRuleName(
        await this.getLevelOfNewRule({
          onCallDutyPolicyId: onCallDutyPolicyId,
          order: createBy.data.order,
        }),
      );
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * The level a new rule with this order takes: one past every rule of the
   * policy ordered before it. Rules at or after its order make room for it
   * once it is saved (onCreateSuccess), so they do not count. Counted rather
   * than read off the order, which an API caller may leave with gaps.
   */
  private async getLevelOfNewRule(data: {
    onCallDutyPolicyId: ObjectID;
    order: number;
  }): Promise<number> {
    const rulesBefore: PositiveNumber = await this.countBy({
      query: {
        onCallDutyPolicyId: data.onCallDutyPolicyId,
        order: QueryHelper.lessThan(data.order),
      },
      props: {
        isRoot: true,
      },
    });

    return rulesBefore.toNumber() + 1;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting status page resource. Please try the delete with objectId",
      );
    }

    let resource: Model | null = null;

    if (!deleteBy.props.isRoot) {
      resource = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          onCallDutyPolicyId: true,
          projectId: true,
        },
      });

      if (!resource) {
        throw new BadDataException(
          "OnCallDutyPolicyEscalationRule with this id not found",
        );
      }

      // delete users in escalation rule, teams in escalation rule and schedules in escalation rule.
      await OnCallDutyPolicyEscalationRuleScheduleService.deleteBy({
        query: {
          onCallDutyPolicyEscalationRuleId: resource.id!,
          projectId: resource.projectId!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          userId: deleteBy.props.userId,
          isRoot: true,
        },
      });

      // delete users in escalation rule.
      await OnCallDutyPolicyEscalationRuleUserService.deleteBy({
        query: {
          onCallDutyPolicyEscalationRuleId: resource.id!,
          projectId: resource.projectId!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          userId: deleteBy.props.userId,
          isRoot: true,
        },
      });

      // delete teams in escalation rule.
      await OnCallDutyPolicyEscalationRuleTeamService.deleteBy({
        query: {
          onCallDutyPolicyEscalationRuleId: resource.id!,
          projectId: resource.projectId!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          userId: deleteBy.props.userId,
          isRoot: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  /*
   * The rules after a deleted one close its gap - only when the rule was
   * actually deleted, within its own policy and project.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    if (
      !deleteBy.props.isRoot &&
      resource &&
      resource.id &&
      resource.order &&
      resource.onCallDutyPolicyId &&
      resource.projectId &&
      itemIdsBeforeDelete.some((id: ObjectID): boolean => {
        return id.toString() === resource.id!.toString();
      })
    ) {
      await ContiguousOrder.afterDelete({
        service: this,
        list: {
          onCallDutyPolicyId: resource.onCallDutyPolicyId,
          projectId: resource.projectId,
        },
        order: resource.order,
      });
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  /*
   * A rule moved to another place: where it is now is read here, and the
   * rules it passes step aside once the update has moved it
   * (onUpdateSuccess). Nothing is written before the update.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    let move: RuleMove | null = null;

    if (updateBy.data.order && !updateBy.props.isRoot && updateBy.query._id) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: updateBy.query._id!,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          onCallDutyPolicyId: true,
          projectId: true,
          _id: true,
        },
      });

      if (
        resource &&
        resource.id &&
        resource.order &&
        resource.onCallDutyPolicyId &&
        resource.projectId
      ) {
        move = {
          ruleId: resource.id,
          previousOrder: resource.order,
          newOrder: updateBy.data.order as number,
          onCallDutyPolicyId: resource.onCallDutyPolicyId,
          projectId: resource.projectId,
        };
      }
    }

    return { updateBy, carryForward: move };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const move: RuleMove | null = (onUpdate.carryForward as RuleMove) || null;

    if (
      move &&
      move.ruleId &&
      updatedItemIds.some((id: ObjectID): boolean => {
        return id.toString() === move.ruleId.toString();
      })
    ) {
      await ContiguousOrder.afterMove({
        service: this,
        list: {
          onCallDutyPolicyId: move.onCallDutyPolicyId,
          projectId: move.projectId,
        },
        movedItemId: move.ruleId,
        previousOrder: move.previousOrder,
        newOrder: move.newOrder,
      });
    }

    return onUpdate;
  }
}
export default new Service();

import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import CreateLimit from "../Types/Database/CreateLimit";
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
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
  NextInRotationInSchedule,
} from "./OnCallDutyPolicyScheduleService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ProjectCountLimit from "../Utils/Database/ProjectCountLimit";
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
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../Types/OnCallDutyPolicy/UserOverrideUtil";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { getAwayTimelineMessage } from "../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import {
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  OnCallDirectPageTargets,
} from "../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
  readNextInRotationScheduleIds,
} from "../../Types/OnCallDutyPolicy/NextInRotation";
import { ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  getOnCallEmptyLevelTimelineMessage,
  isOnCallPageLineReached,
} from "../../Types/OnCallDutyPolicy/OnCallEmptyLevel";

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
  // A team with no accepted member, which a direct page says a word about.
  EmptyTeam = "EmptyTeam",
  /*
   * A schedule whose next person in the rotation the rule pages, with
   * somebody on call in it but nobody next: the rotation has nobody else in
   * it, or everybody else in it is away.
   */
  NobodyNextInRotation = "NobodyNextInRotation",
}

interface RecipientRuleTarget {
  kind: RuleTargetKind.Recipient;
  // Who the rule names (a team member, a user, the schedule's on-call user)...
  originalUserId: ObjectID;
  // ...and who is paged for them, once an override is applied.
  recipientUserId: ObjectID;
  teamId: ObjectID | null;
  scheduleId: ObjectID | null;
  /*
   * Set when the person the rule names is away with nobody named to cover
   * (a skip): they are not paged, and the timeline says until when. A
   * schedule's on-call person is never skipped here - the schedule has
   * already handed a skipped person's turn to the next one in its rotation.
   */
  awayUntil: Date | null;
  /*
   * The person is paged as the next in the schedule's rotation - the backup
   * after whoever is on call in it - not as its on-call person. Nobody away
   * is ever next, so no override applies to them.
   */
  isNextInRotation: boolean;
}

/*
 * A user override in force for a person (getAwayOverride): who covers - or
 * nobody, for a skip - and until when.
 */
export interface AwayOverride {
  coverUserId: ObjectID | null;
  endsAt: Date;
}

interface ScheduleGapRuleTarget {
  kind: RuleTargetKind.ScheduleGap;
  scheduleId: ObjectID;
}

interface EmptyTeamRuleTarget {
  kind: RuleTargetKind.EmptyTeam;
  teamId: ObjectID;
}

interface NobodyNextInRotationRuleTarget {
  kind: RuleTargetKind.NobodyNextInRotation;
  scheduleId: ObjectID;
}

type RuleTarget =
  | RecipientRuleTarget
  | ScheduleGapRuleTarget
  | EmptyTeamRuleTarget
  | NobodyNextInRotationRuleTarget;

/*
 * The run a set of targets is paged for (pageTargets): an on-call policy's
 * run, on one of its escalation rules, or a direct page's - which names no
 * policy.
 */
interface PageContext {
  projectId: ObjectID;
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByAlertEpisodeId?: ObjectID | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | undefined;
  userNotificationEventType: UserNotificationEventType;
  onCallPolicyExecutionLogId: ObjectID;
  onCallPolicyId?: ObjectID | undefined;
}

// Why somebody, or some target, was not paged.
export enum OnCallNotPagedReason {
  // Away with nobody named to cover: a user override that skips them.
  Away = "Away",
  // Not a member of the project now: they left, or never accepted.
  NotAProjectMember = "NotAProjectMember",
  // A schedule with nobody on call right now.
  NobodyOnCall = "NobodyOnCall",
  // A team with no accepted member.
  EmptyTeam = "EmptyTeam",
  /*
   * A schedule whose next person in the rotation was to be paged, with
   * nobody next: the rotation has nobody else in it, or everybody else in
   * it is away.
   */
  NobodyNextInRotation = "NobodyNextInRotation",
  /*
   * They passed this run's page on (OnCallPagePassOn): the run's later
   * escalation rules and repeats do not page them again.
   */
  PassedOn = "PassedOn",
}

// One person a set of targets paged.
export interface OnCallPagedTarget {
  // Who was paged...
  userId: ObjectID;
  // ...and whom they cover, when a user override sent the page to them.
  coveringForUserId: ObjectID | null;
  // The team they were paged as a member of, when they were.
  teamId: ObjectID | null;
  // The schedule they are on call in, when that is why they were paged.
  scheduleId: ObjectID | null;
  /*
   * Present (true) when they were paged as the next person in that
   * schedule's rotation - the backup after whoever is on call - rather than
   * as its on-call person. Absent otherwise.
   */
  isNextInRotation?: true;
}

// One person, team or schedule a set of targets did not page, and why.
export interface OnCallNotPagedTarget {
  reason: OnCallNotPagedReason;
  userId: ObjectID | null;
  teamId: ObjectID | null;
  scheduleId: ObjectID | null;
  // Away: until when.
  awayUntil: Date | null;
}

/*
 * What paging a set of targets came to (pageTargets). An escalation rule
 * reads only whether it reached anybody; a direct page hands all of it to
 * whoever asked for the page.
 */
export interface OnCallPagingOutcome {
  // Everybody paged, once each, in the order they were paged.
  paged: Array<OnCallPagedTarget>;
  notPaged: Array<OnCallNotPagedTarget>;
  // A schedule among the targets had nobody on call.
  hadScheduleGap: boolean;
}

/*
 * What running one escalation rule came to (startRuleExecution): who it
 * paged and who it did not, and whether the run moves on from it at once
 * rather than waiting out its wait - the level reached nobody, so there is
 * nobody to wait for (Types/OnCallDutyPolicy/OnCallEmptyLevel).
 */
export interface OnCallRuleExecutionOutcome extends OnCallPagingOutcome {
  movesOnAtOnce: boolean;
}

/*
 * What paging a set of targets came to (pageTargets), with the run's
 * timeline lines of the people it paged: whether each page went out is read
 * back from them once the set is paged (countPagesThatWentOut).
 */
interface PagedTargets {
  outcome: OnCallPagingOutcome;
  pagedLineIds: Array<ObjectID>;
}

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

/*
 * THE FREE PLAN'S LIMIT ON ESCALATION RULES: one for each on-call policy.
 *
 * Asked twice: early, in onBeforeCreate, and again with the INSERT, in its
 * own transaction under the limit's lock in the project (getCreateLimit,
 * ProjectCountLimit), so rules added to a policy at the same moment cannot
 * all pass. How many the Free plan allows a policy, the lock's name, what it
 * counts - the rules of the policy, as the early check counts them - and
 * the refusal both checks give.
 */
export const ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN: number = 1;

export const FREE_PLAN_ESCALATION_RULE_LIMIT_NAME: string =
  "free-plan-escalation-rules";

export const ESCALATION_RULE_COUNT_STATEMENT: string =
  'SELECT COUNT(*)::int AS "count" FROM "OnCallDutyPolicyEscalationRule" WHERE "projectId" = $1 AND "onCallDutyPolicyId" = $2 AND "deletedAt" IS NULL';

export const FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE: string =
  "You can only create one escalation rule in free plan.";

export class Service extends OnCallDutyPolicyChildService<Model> {
  /*
   * Who gets the pages of a person named on a rule, while a user override
   * names who covers them: the cover, or null when no override with a cover
   * decides for them now - nobody is away, or they are skipped
   * (getAwayOverride says which).
   */
  @CaptureSpan()
  public async getRouteAlertToUserId(data: {
    userId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<ObjectID | null> {
    const away: AwayOverride | null = await this.getAwayOverride(data);

    return away?.coverUserId || null;
  }

  /*
   * The user override that decides, right now (or at `at`), what happens to
   * the pages of a person a rule names - the policy's own overrides and the
   * global ones, the winner chosen as the schedules choose it
   * (UserOverrideUtil.getPrecedence): a policy's own override beats a global
   * one, and within a scope one that names who covers beats a skip. Null
   * when the person is not away.
   *
   * With a cover, the cover is paged in their place. Without one - a skip -
   * nobody is: a person named directly, or as a member of a team, has no
   * rotation to take the next person from.
   *
   * Without a policy - a direct page, which no policy is behind - only the
   * global overrides decide: another policy's own override never applies
   * outside that policy.
   */
  @CaptureSpan()
  public async getAwayOverride(data: {
    userId: ObjectID;
    onCallDutyPolicyId?: ObjectID | undefined;
    projectId: ObjectID;
    at?: Date | undefined;
  }): Promise<AwayOverride | null> {
    logger.debug(
      `Getting the user override in force for userId: ${data.userId.toString()}`,
      {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      } as LogAttributes,
    );

    const currentDate: Date = data.at || OneUptimeDate.getCurrentDate();

    const overrides: Array<OnCallDutyPolicyUserOverride> =
      await OnCallDutyPolicyUserOverrideService.findBy({
        query: {
          overrideUserId: data.userId,
          // The policy's own overrides and the global ones; the global ones alone without a policy.
          onCallDutyPolicyId: data.onCallDutyPolicyId
            ? QueryHelper.equalToOrNull(data.onCallDutyPolicyId)
            : QueryHelper.isNull(),
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
          startsAt: true,
          endsAt: true,
        },
      });

    logger.debug(`Found overrides in force: ${JSON.stringify(overrides)}`, {
      projectId: data.projectId.toString(),
      userId: data.userId.toString(),
    } as LogAttributes);

    const policyId: string | undefined = data.onCallDutyPolicyId?.toString();

    const winner: OnCallDutyPolicyUserOverride | undefined = overrides
      .filter((override: OnCallDutyPolicyUserOverride) => {
        // Another policy's own override never applies here.
        const overridePolicyId: string | undefined =
          override.onCallDutyPolicyId?.toString();

        return !overridePolicyId || overridePolicyId === policyId;
      })
      .map((override: OnCallDutyPolicyUserOverride) => {
        const record: UserOverrideRecord = {
          overrideUserId: data.userId.toString(),
          routeAlertsToUserId: override.routeAlertsToUserId?.toString() || null,
          startsAt: override.startsAt!,
          endsAt: override.endsAt!,
          onCallDutyPolicyId: override.onCallDutyPolicyId?.toString() || null,
        };

        return {
          override,
          precedence: UserOverrideUtil.getPrecedence(record),
        };
      })
      .sort(
        (
          a: { override: OnCallDutyPolicyUserOverride; precedence: number },
          b: { override: OnCallDutyPolicyUserOverride; precedence: number },
        ) => {
          return (
            a.precedence - b.precedence ||
            (a.override.startsAt?.getTime() || 0) -
              (b.override.startsAt?.getTime() || 0)
          );
        },
      )[0]?.override;

    if (!winner || !winner.endsAt) {
      return null;
    }

    return {
      coverUserId: winner.routeAlertsToUserId || null,
      endsAt: OneUptimeDate.fromString(winner.endsAt),
    };
  }

  /*
   * Runs one escalation rule of a run: records the rule on the run, pages
   * everybody it names (pageTargets) and hands back who it paged and who it
   * did not, with why - and whether the run moves on from it at once: a
   * level that reached nobody has nobody to wait for
   * (Types/OnCallDutyPolicy/OnCallEmptyLevel), and says so in a line of its
   * own. Moving on is its callers' (OnCallEscalationAdvance).
   *
   * `passedOnUserIds` are the people who passed this run's page on
   * (OnCallPagePassOn): the rule passes them over. The run's first rule has
   * nobody to pass over; every later rule and repeat is started by
   * OnCallEscalationAdvance, which reads them.
   *
   * `alsoPageUserIds` are paged first, before everybody the rule names: the
   * person who acknowledged a record its policy pages again about
   * (OnCallAcknowledgementTimeout). They are paged as anybody the rule names
   * directly is - a user override covers for them, nobody who left the
   * project is paged, and nobody is paged twice.
   */
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
      passedOnUserIds?: Array<ObjectID> | undefined;
      alsoPageUserIds?: Array<ObjectID> | undefined;
    },
  ): Promise<OnCallRuleExecutionOutcome> {
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

    Service.assertTriggerMatchesEventType(options);

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
          // Whoever is on call in it, or the next person in its rotation.
          pageNextInRotation: true,
        },
      });

    logger.debug(
      `Found schedules in rule: ${JSON.stringify(schedulesInRule)}`,
      {
        projectId: options.projectId.toString(),
        onCallDutyPolicyEscalationRuleId: ruleId.toString(),
      } as LogAttributes,
    );

    // The schedule ids of the rule's rows that page one way or the other.
    const getScheduleIdsOfRule: (
      pagesNextInRotation: boolean,
    ) => Array<ObjectID> = (pagesNextInRotation: boolean): Array<ObjectID> => {
      return schedulesInRule
        .filter((scheduleRule: OnCallDutyPolicyEscalationRuleSchedule) => {
          return (
            Boolean(scheduleRule.pageNextInRotation) === pagesNextInRotation
          );
        })
        .map((scheduleRule: OnCallDutyPolicyEscalationRuleSchedule) => {
          return scheduleRule.onCallDutyPolicyScheduleId;
        })
        .filter((scheduleId: ObjectID | undefined): scheduleId is ObjectID => {
          return Boolean(scheduleId);
        });
    };

    const firstUserIds: Array<ObjectID> = options.alsoPageUserIds || [];

    const teamIds: Array<ObjectID> = teamsInRule
      .map((teamInRule: OnCallDutyPolicyEscalationRuleTeam) => {
        return teamInRule.teamId;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    const userIds: Array<ObjectID> = usersInRule
      .map((userRule: OnCallDutyPolicyEscalationRuleUser) => {
        return userRule.userId;
      })
      .filter((userId: ObjectID | undefined): userId is ObjectID => {
        return Boolean(userId);
      });

    const scheduleIds: Array<ObjectID> = getScheduleIdsOfRule(false);
    const nextInRotationScheduleIds: Array<ObjectID> =
      getScheduleIdsOfRule(true);

    /*
     * Who this rule pages, in paging order: anybody asked to be paged first
     * (alsoPageUserIds), the accepted members of each team, then the users
     * named directly, then whoever is on call in each schedule, then the
     * next person in the rotation of each schedule it pages that way
     * (pageTargets).
     */
    const paging: PagedTargets = await this.pageTargets({
      context: options,
      ruleId: ruleId,
      firstUserIds: firstUserIds,
      teamIds: teamIds,
      userIds: userIds,
      scheduleIds: scheduleIds,
      nextInRotationScheduleIds: nextInRotationScheduleIds,
      /*
       * A team with nobody in it says so, as a direct page's does: a level
       * whose only team is empty pages nobody, and "this escalation rule has
       * no responders" would not be true of it.
       */
      notesEmptyTeams: true,
      passedOnUserIds: options.passedOnUserIds || [],
    });

    const outcome: OnCallPagingOutcome = paging.outcome;

    /*
     * Whether the level reached anybody: somebody was paged, and their page
     * went out rather than being skipped or failing as it was sent - they
     * opted out, or have no way to be reached (OnCallEmptyLevel). A level
     * that reached nobody has nobody to wait for, so the run moves on from
     * it at once (OnCallEscalationAdvance), wherever it is in the policy.
     */
    const reachedNobody: boolean =
      (await Service.countPagesThatWentOut({
        lineIds: paging.pagedLineIds,
        projectId: options.projectId,
        ruleId: ruleId,
      })) === 0;

    /*
     * The level's own line: it paged nobody, and the run moves on at once.
     * Not when everybody it names escalated this run's page already: each
     * has a line of their own, and the feed said once that they escalated
     * it - the level has nothing to add.
     */
    if (reachedNobody && !Service.isEveryTargetPassedOn(outcome)) {
      const log: OnCallDutyPolicyExecutionLogTimeline =
        Service.getNewTimelineLog({
          context: options,
          ruleId: ruleId,
        });
      log.statusMessage = getOnCallEmptyLevelTimelineMessage({
        namesAnybody:
          firstUserIds.length +
            teamIds.length +
            userIds.length +
            scheduleIds.length +
            nextInRotationScheduleIds.length >
          0,
      });
      log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;

      await OnCallDutyPolicyExecutionLogTimelineService.create({
        data: log,
        props: {
          isRoot: true,
        },
      });

      logger.debug(
        `Escalation rule ${ruleId.toString()} reached nobody; the run moves on from it at once.`,
        {
          projectId: options.projectId.toString(),
          onCallDutyPolicyEscalationRuleId: ruleId.toString(),
        } as LogAttributes,
      );
    }

    logger.debug(`Completed rule execution for ruleId: ${ruleId.toString()}`, {
      projectId: options.projectId.toString(),
      onCallDutyPolicyEscalationRuleId: ruleId.toString(),
    } as LogAttributes);

    return {
      ...outcome,
      movesOnAtOnce: reachedNobody,
    };
  }

  /*
   * A rule that paged nobody because everybody it names passed the run's
   * page on: nobody is on it, and nobody may come on call in it, so there
   * is nothing to wait for - and nothing to say about the level itself.
   */
  public static isEveryTargetPassedOn(outcome: OnCallPagingOutcome): boolean {
    return (
      outcome.paged.length === 0 &&
      outcome.notPaged.length > 0 &&
      outcome.notPaged.every((target: OnCallNotPagedTarget): boolean => {
        return target.reason === OnCallNotPagedReason.PassedOn;
      })
    );
  }

  /*
   * How many of a level's pages went out: its people's lines on the run's
   * timeline, read back once the level has paged. Each person's
   * notification log has said by then whether their page was skipped or
   * failed as it was sent (UserOnCallLogService writes it onto their line
   * as the log is created) - so a level whose people cannot be reached at
   * all is known to have reached nobody.
   *
   * A line that cannot be read back counts as a page that went out, and so
   * do all of them when the read fails: the level then waits, as every
   * level did before, rather than moving on from people who may well have
   * been reached.
   */
  private static async countPagesThatWentOut(data: {
    lineIds: Array<ObjectID>;
    projectId: ObjectID;
    ruleId: ObjectID;
  }): Promise<number> {
    if (data.lineIds.length === 0) {
      return 0;
    }

    try {
      const lines: Array<OnCallDutyPolicyExecutionLogTimeline> =
        await OnCallDutyPolicyExecutionLogTimelineService.findBy({
          query: {
            _id: QueryHelper.any(data.lineIds),
          },
          select: {
            _id: true,
            status: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      const statusByLineId: Map<
        string,
        OnCallDutyExecutionLogTimelineStatus | undefined
      > = new Map<string, OnCallDutyExecutionLogTimelineStatus | undefined>();

      for (const line of lines || []) {
        if (line.id) {
          statusByLineId.set(line.id.toString().toLowerCase(), line.status);
        }
      }

      return data.lineIds.filter((lineId: ObjectID): boolean => {
        return isOnCallPageLineReached(
          statusByLineId.get(lineId.toString().toLowerCase()),
        );
      }).length;
    } catch (err) {
      logger.error(
        `Could not read whether the pages of escalation rule ${data.ruleId.toString()} went out; waiting out the rule as if they did.`,
        {
          projectId: data.projectId.toString(),
          onCallDutyPolicyEscalationRuleId: data.ruleId.toString(),
        } as LogAttributes,
      );
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          onCallDutyPolicyEscalationRuleId: data.ruleId.toString(),
        } as LogAttributes,
      );

      return data.lineIds.length;
    }
  }

  /*
   * PAGES A DIRECT PAGE'S TARGETS: the people it names, the accepted members
   * of the teams it names and whoever is on call right now in the schedules
   * it names - all at once, with no policy and no escalation rule behind
   * them (Types/OnCallDutyPolicy/OnCallDirectPage).
   *
   * It pages exactly as an escalation rule pages its own targets
   * (pageTargets): a user override sends a page to whoever covers, or skips
   * somebody away with nobody named to cover (the global overrides only -
   * another policy's own never apply here); nobody who is not a member of
   * the project is paged; nobody is paged twice; and every target gets a
   * line on the run's timeline, paged or not.
   *
   * The run - an execution log with no policy - is written by its caller
   * (OnCallDutyPolicyExecutionLogService.startDirectPage), which is told who
   * was paged and who was not, and why.
   */
  @CaptureSpan()
  public async startDirectPage(options: {
    projectId: ObjectID;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    triggeredByAlertEpisodeId?: ObjectID | undefined;
    triggeredByIncidentEpisodeId?: ObjectID | undefined;
    userNotificationEventType: UserNotificationEventType;
    onCallPolicyExecutionLogId: ObjectID;
    targets: OnCallDirectPageTargets;
  }): Promise<OnCallPagingOutcome> {
    logger.debug(
      `Starting a direct page for execution log: ${options.onCallPolicyExecutionLogId.toString()}`,
      {
        projectId: options.projectId.toString(),
      } as LogAttributes,
    );

    Service.assertTriggerMatchesEventType(options);

    /*
     * When the page went out, on the run: how long it has waited for
     * somebody to acknowledge is counted from here
     * (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions). Its Slack and
     * Microsoft Teams message is posted once this pass is over
     * (OnCallPolicyRunMessage), so its first post says who was paged.
     */
    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: options.onCallPolicyExecutionLogId,
      data: {
        lastEscalationRuleExecutedAt: OneUptimeDate.getCurrentDate(),
        executeNextEscalationRuleInMinutes: 0,
      },
      props: {
        isRoot: true,
      },
    });

    const outcome: OnCallPagingOutcome = (
      await this.pageTargets({
        context: options,
        ruleId: null,
        firstUserIds: [],
        teamIds: options.targets.teamIds,
        userIds: options.targets.userIds,
        scheduleIds: options.targets.onCallScheduleIds,
        // A direct page pages whoever is on call in a schedule it names.
        nextInRotationScheduleIds: [],
        // "Team Platform has no members" is why nobody was paged through it.
        notesEmptyTeams: true,
        // A direct page pages everybody once, as it starts: nobody has passed it on.
        passedOnUserIds: [],
      })
    ).outcome;

    /*
     * Nobody at all, and no line that says why - every target was a person
     * who could not be read, say: the timeline still says the page reached
     * nobody.
     */
    if (outcome.paged.length === 0 && outcome.notPaged.length === 0) {
      const log: OnCallDutyPolicyExecutionLogTimeline =
        Service.getNewTimelineLog({
          context: options,
          ruleId: null,
        });
      log.statusMessage = ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE;
      log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;

      await OnCallDutyPolicyExecutionLogTimelineService.create({
        data: log,
        props: {
          isRoot: true,
        },
      });
    }

    logger.debug(
      `Completed the direct page for execution log: ${options.onCallPolicyExecutionLogId.toString()}`,
      {
        projectId: options.projectId.toString(),
      } as LogAttributes,
    );

    return outcome;
  }

  /*
   * A page about an incident names the incident, one about an alert the
   * alert, and so on: what its people are paged about, and what
   * acknowledging the page acknowledges.
   */
  private static assertTriggerMatchesEventType(options: PageContext): void {
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
  }

  /*
   * A new line of a run's timeline: the run, what it pages about, and - for
   * an on-call policy's run - the policy and the escalation rule. A direct
   * page's lines name neither.
   */
  private static getNewTimelineLog(data: {
    context: PageContext;
    ruleId: ObjectID | null;
  }): OnCallDutyPolicyExecutionLogTimeline {
    const options: PageContext = data.context;

    const log: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();

    log.projectId = options.projectId;
    log.onCallDutyPolicyExecutionLogId = options.onCallPolicyExecutionLogId;

    if (options.onCallPolicyId) {
      log.onCallDutyPolicyId = options.onCallPolicyId;
    }

    if (data.ruleId) {
      log.onCallDutyPolicyEscalationRuleId = data.ruleId;
    }

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
      log.triggeredByIncidentEpisodeId = options.triggeredByIncidentEpisodeId;
    }

    return log;
  }

  /*
   * PAGES A SET OF TARGETS FOR ONE RUN: an escalation rule's (ruleId), or a
   * direct page's (no rule, no policy).
   *
   * In paging order: the accepted members of each team, then the users named
   * directly, then whoever is on call in each schedule. Resolved first and
   * paged after, so whether each recipient is still a member of the project
   * is read ONCE for the whole set rather than once per person. Every target
   * gets a line on the run's timeline, and whoever is paged a notification
   * log of their own (UserNotificationRuleService), which reaches them
   * through their On-Call Rules.
   *
   * Hands back who was paged and who was not, with why - and the timeline
   * lines of the people it paged, which say by now whether each page went
   * out (startRuleExecution reads them back).
   */
  private async pageTargets(data: {
    context: PageContext;
    ruleId: ObjectID | null;
    /*
     * People paged before every other target: the person who acknowledged
     * a record its policy pages again about (OnCallAcknowledgementTimeout).
     * None for every other page.
     */
    firstUserIds: Array<ObjectID>;
    teamIds: Array<ObjectID>;
    userIds: Array<ObjectID>;
    // Schedules whose on-call person is paged.
    scheduleIds: Array<ObjectID>;
    /*
     * Schedules whose next person in the rotation is paged: the backup after
     * whoever is on call in them. None for a direct page.
     */
    nextInRotationScheduleIds: Array<ObjectID>;
    // Whether a team with no accepted member gets a line of its own.
    notesEmptyTeams: boolean;
    /*
     * People who passed this run's page on (OnCallPagePassOn): not paged
     * again by it, whichever target names them.
     */
    passedOnUserIds: Array<ObjectID>;
  }): Promise<PagedTargets> {
    const options: PageContext = data.context;
    const ruleId: ObjectID | null = data.ruleId;

    // The timeline line of each person paged, in the order they were paged.
    const pagedLineIds: Array<ObjectID> = [];

    // What a log line of this run is told about where it happened.
    const logAttributes: LogAttributes = {
      projectId: options.projectId.toString(),
      ...(ruleId
        ? { onCallDutyPolicyEscalationRuleId: ruleId.toString() }
        : {}),
    } as LogAttributes;

    type GetNewLogFunction = () => OnCallDutyPolicyExecutionLogTimeline;

    const getNewLog: GetNewLogFunction =
      (): OnCallDutyPolicyExecutionLogTimeline => {
        return Service.getNewTimelineLog({
          context: options,
          ruleId: ruleId,
        });
      };

    const outcome: OnCallPagingOutcome = {
      paged: [],
      notPaged: [],
      hadScheduleGap: false,
    };

    type StartUserNotificationRuleExecutionFunction = (
      originalUserId: ObjectID,
      alertSentToUserId: ObjectID,
      teamId: ObjectID | null,
      scheduleId: ObjectID | null,
      isNextInRotation: boolean,
    ) => Promise<void>;

    /*
     * Resolve the FINAL alert recipient for a team or direct-user target (the
     * RAW roster user), applying a user override (getAwayOverride) exactly
     * ONCE per paging decision: the person who covers them, or - when they
     * are away with nobody named to cover - nobody (awayUntil).
     *
     * Schedule targets are already override-resolved:
     * getCurrentOnCallInSchedule applies overrides via ScheduleResolution.
     * Applying an override to them again re-substituted an
     * already-substituted user (transitive), so the schedule paging path could
     * page a different person than the roster, dashboard, handoff
     * notification, and a rule that lists the same user directly — all of
     * which apply overrides only once (audit F5). So schedule targets never
     * come through here.
     *
     * A direct page has no policy: the global overrides decide for its
     * people, as they decide for a schedule read without a policy.
     */
    const resolveAlertRecipient: (userId: ObjectID) => Promise<{
      recipientUserId: ObjectID;
      awayUntil: Date | null;
    }> = async (
      userId: ObjectID,
    ): Promise<{ recipientUserId: ObjectID; awayUntil: Date | null }> => {
      if (options.onCallPolicyId || !ruleId) {
        const away: AwayOverride | null = await this.getAwayOverride({
          userId,
          onCallDutyPolicyId: options.onCallPolicyId,
          projectId: options.projectId,
        });

        if (away?.coverUserId) {
          return { recipientUserId: away.coverUserId, awayUntil: null };
        }

        if (away) {
          return { recipientUserId: userId, awayUntil: away.endsAt };
        }
      }

      return { recipientUserId: userId, awayUntil: null };
    };

    const startUserNotificationRuleExecution: StartUserNotificationRuleExecutionFunction =
      async (
        originalUserId: ObjectID,
        alertSentToUserId: ObjectID,
        teamId: ObjectID | null,
        scheduleId: ObjectID | null,
        isNextInRotation: boolean,
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
            ...logAttributes,
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

        /*
         * Why the schedule is on the step: they are the next person in its
         * rotation, not its on-call person. The status message is rewritten
         * as the page goes out, so the reason is a column of its own.
         */
        if (isNextInRotation) {
          log.isNextInRotation = true;
        }

        log = await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        if (log?.id) {
          pagedLineIds.push(log.id);
        }

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
            onCallPolicyEscalationRuleId: ruleId || undefined,
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
     * Whether any schedule among the targets had nobody on call right now (a
     * restriction gap, a layer that has not started, an empty layer): told
     * to whoever asked for the page. A level it leaves with nobody paged is
     * passed at once, as any level that pages nobody is (OnCallEmptyLevel).
     */
    let hadScheduleGap: boolean = false;

    /*
     * Who is paged, in paging order: the accepted members of each team,
     * then the users named directly, then whoever is on call in each
     * schedule. Resolved first and paged after, so whether each recipient is
     * still a member of the project is read ONCE for the whole set rather
     * than once per person.
     */
    const targets: Array<RuleTarget> = [];

    /*
     * Anybody paged first: named directly, as a rule's own users are, so an
     * override covers for them and they are paged once whatever names them
     * again below.
     */
    for (const userId of data.firstUserIds) {
      const recipient: { recipientUserId: ObjectID; awayUntil: Date | null } =
        await resolveAlertRecipient(userId);

      targets.push({
        kind: RuleTargetKind.Recipient,
        originalUserId: userId,
        recipientUserId: recipient.recipientUserId,
        teamId: null,
        scheduleId: null,
        awayUntil: recipient.awayUntil,
        isNextInRotation: false,
      });
    }

    for (const teamId of data.teamIds) {
      /*
       * Accepted rows only. A pending invitation grants none of the team's
       * permissions and puts nobody on its roster, so somebody who has not
       * joined is not paged through the team.
       */
      const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeams(
        [teamId],
        { acceptedOnly: true },
      );

      let membersInTeam: number = 0;

      for (const user of usersInTeam) {
        if (!user?.id) {
          continue;
        }

        membersInTeam++;

        const recipient: { recipientUserId: ObjectID; awayUntil: Date | null } =
          await resolveAlertRecipient(user.id);

        targets.push({
          kind: RuleTargetKind.Recipient,
          originalUserId: user.id,
          recipientUserId: recipient.recipientUserId,
          teamId: teamId,
          scheduleId: null,
          awayUntil: recipient.awayUntil,
          isNextInRotation: false,
        });
      }

      if (membersInTeam === 0 && data.notesEmptyTeams) {
        targets.push({
          kind: RuleTargetKind.EmptyTeam,
          teamId: teamId,
        });
      }
    }

    for (const userId of data.userIds) {
      const recipient: { recipientUserId: ObjectID; awayUntil: Date | null } =
        await resolveAlertRecipient(userId);

      targets.push({
        kind: RuleTargetKind.Recipient,
        originalUserId: userId,
        recipientUserId: recipient.recipientUserId,
        teamId: null,
        scheduleId: null,
        awayUntil: recipient.awayUntil,
        isNextInRotation: false,
      });
    }

    for (const scheduleId of data.scheduleIds) {
      const onCall: CurrentOnCallInSchedule | null =
        await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
          scheduleId,
          { onCallDutyPolicyId: options.onCallPolicyId },
        );

      if (!onCall) {
        targets.push({
          kind: RuleTargetKind.ScheduleGap,
          scheduleId: scheduleId,
        });

        continue;
      }

      /*
       * The schedule has applied any override already - no second override
       * hop (F5). While one is in force, the target names the layer user it
       * covers as well as the substitute it pages: a substitute who is no
       * longer a member then falls back to the covered layer user, exactly as
       * an override of a user named on the rule does, and the timeline
       * records the page as routed by an override.
       */
      targets.push({
        kind: RuleTargetKind.Recipient,
        originalUserId: onCall.coveredUserId || onCall.userId,
        recipientUserId: onCall.userId,
        teamId: null,
        scheduleId: scheduleId,
        awayUntil: null,
        isNextInRotation: false,
      });
    }

    /*
     * THE NEXT PERSON IN EACH ROTATION: the backup after whoever is on call
     * in a schedule, from the same rotation, passing over anyone who is away
     * and whoever is on call already (getNextInRotationInSchedule). The
     * schedule has applied every override already, and nobody away is ever
     * next, so - as for its on-call person - no second override hop.
     *
     * Nobody on call at all is a gap, as for a page to the schedule.
     * Somebody on call with nobody next - the rotation has nobody else, or
     * everybody else is away - says so in a line of its own. Either way the
     * schedule pages nobody, and a level it leaves with nobody paged is
     * passed at once (OnCallEmptyLevel).
     */
    for (const scheduleId of data.nextInRotationScheduleIds) {
      const next: NextInRotationInSchedule | null =
        await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
          scheduleId,
          { onCallDutyPolicyId: options.onCallPolicyId },
        );

      if (!next) {
        logger.debug(
          `Nobody is on call in schedule ${scheduleId.toString()}, so nobody is next in its rotation.`,
          {
            ...logAttributes,
            onCallDutyPolicyScheduleId: scheduleId.toString(),
          } as LogAttributes,
        );

        targets.push({
          kind: RuleTargetKind.ScheduleGap,
          scheduleId: scheduleId,
        });

        continue;
      }

      if (!next.nextUserId) {
        logger.debug(
          `Nobody is next after ${next.onCallUserId.toString()} in the rotation of schedule ${scheduleId.toString()}: it has nobody else in it, or everybody else in it is away.`,
          {
            ...logAttributes,
            onCallDutyPolicyScheduleId: scheduleId.toString(),
            userId: next.onCallUserId.toString(),
          } as LogAttributes,
        );

        targets.push({
          kind: RuleTargetKind.NobodyNextInRotation,
          scheduleId: scheduleId,
        });

        continue;
      }

      logger.debug(
        `Paging ${next.nextUserId.toString()} as the next person in the rotation of schedule ${scheduleId.toString()}${next.layerName ? ` (layer ${next.layerName})` : ""}, after ${next.onCallUserId.toString()}, who is on call.`,
        {
          ...logAttributes,
          onCallDutyPolicyScheduleId: scheduleId.toString(),
          userId: next.nextUserId.toString(),
        } as LogAttributes,
      );

      targets.push({
        kind: RuleTargetKind.Recipient,
        originalUserId: next.nextUserId,
        recipientUserId: next.nextUserId,
        teamId: null,
        scheduleId: scheduleId,
        awayUntil: null,
        isNextInRotation: true,
      });
    }

    /*
     * Nobody is paged on the project's behalf unless they are a member of it
     * now. A user named on the rule, on call in a schedule or covering an
     * override who has since left would otherwise still be reached through
     * whatever notification methods they had - the leave cleanup removes
     * those references, and this keeps a reference it missed from paging
     * anyone. One read for every recipient of the rule, and for the people
     * their overrides cover (ProjectMembership).
     *
     * If membership cannot be read, the rule pages as it did before this
     * check rather than paging nobody: a page lost to a failed read is worse
     * than one more read retried. That still reaches nobody who is not a
     * member - an invitee named on the rule, or somebody whose leave cleanup
     * failed: the reads that choose what a page goes through carry the
     * membership condition themselves (UserOnCallLogService), and so does
     * the fallback to a person's verified methods.
     */
    let memberUserIds: Set<string> | null = null;

    try {
      memberUserIds = await ProjectMembership.getMemberUserIds({
        projectId: options.projectId,
        userIds: targets
          .filter((target: RuleTarget): target is RecipientRuleTarget => {
            return target.kind === RuleTargetKind.Recipient;
          })
          .flatMap((target: RecipientRuleTarget): Array<ObjectID> => {
            return [target.recipientUserId, target.originalUserId];
          }),
      });
    } catch (err) {
      logger.error(
        ruleId
          ? "Could not read project membership for an escalation rule; paging its recipients without the membership check."
          : "Could not read project membership for a direct page; paging its recipients without the membership check.",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    const isProjectMember: (userId: ObjectID) => boolean = (
      userId: ObjectID,
    ): boolean => {
      return (
        memberUserIds === null ||
        memberUserIds.has(userId.toString().toLowerCase())
      );
    };

    const passedOnUserIds: Set<string> = new Set<string>(
      data.passedOnUserIds.map((userId: ObjectID): string => {
        return userId.toString().toLowerCase();
      }),
    );

    const hasPassedItOn: (userId: ObjectID) => boolean = (
      userId: ObjectID,
    ): boolean => {
      return passedOnUserIds.has(userId.toString().toLowerCase());
    };

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

        outcome.notPaged.push({
          reason: OnCallNotPagedReason.NobodyOnCall,
          userId: null,
          teamId: null,
          scheduleId: target.scheduleId,
          awayUntil: null,
        });

        continue;
      }

      // A team nobody has joined: nobody to page through it.
      if (target.kind === RuleTargetKind.EmptyTeam) {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE;
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.userBelongsToTeamId = target.teamId;

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        outcome.notPaged.push({
          reason: OnCallNotPagedReason.EmptyTeam,
          userId: null,
          teamId: target.teamId,
          scheduleId: null,
          awayUntil: null,
        });

        continue;
      }

      /*
       * Somebody is on call in the schedule, but nobody is next in its
       * rotation: the step names the schedule and says so, flagged as the
       * next-in-rotation step it is - a page to the schedule's on-call
       * person with nobody on call reads "nobody was on call" instead.
       */
      if (target.kind === RuleTargetKind.NobodyNextInRotation) {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE;
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.onCallDutyScheduleId = target.scheduleId;
        log.isNextInRotation = true;

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        outcome.notPaged.push({
          reason: OnCallNotPagedReason.NobodyNextInRotation,
          userId: null,
          teamId: null,
          scheduleId: target.scheduleId,
          awayUntil: null,
        });

        continue;
      }

      /*
       * Away with nobody named to cover: not paged, and the timeline says
       * until when - the run's Slack and Teams message reads it back
       * ("away until ...").
       */
      if (target.awayUntil) {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = getAwayTimelineMessage(target.awayUntil);
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.alertSentToUserId = target.originalUserId;

        if (target.teamId) {
          log.userBelongsToTeamId = target.teamId;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        outcome.notPaged.push({
          reason: OnCallNotPagedReason.Away,
          userId: target.originalUserId,
          teamId: target.teamId,
          scheduleId: null,
          awayUntil: target.awayUntil,
        });

        continue;
      }

      // Who is paged for this target, and on whose behalf.
      let pagedUserId: ObjectID = target.recipientUserId;
      let onBehalfOfUserId: ObjectID = target.originalUserId;

      if (!isProjectMember(target.recipientUserId)) {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE;
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.alertSentToUserId = target.recipientUserId;

        const wasOverridden: boolean =
          target.recipientUserId.toString() !==
          target.originalUserId.toString();

        if (wasOverridden) {
          log.overridedByUserId = target.originalUserId;
        }

        if (target.teamId) {
          log.userBelongsToTeamId = target.teamId;
        }

        if (target.scheduleId) {
          log.onCallDutyScheduleId = target.scheduleId;
        }

        if (target.isNextInRotation) {
          log.isNextInRotation = true;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        outcome.notPaged.push({
          reason: OnCallNotPagedReason.NotAProjectMember,
          userId: target.recipientUserId,
          teamId: target.teamId,
          scheduleId: target.scheduleId,
          awayUntil: null,
        });

        /*
         * An override routed this page to somebody who has left, but the
         * person it covers is still a member: they are paged themselves,
         * rather than nobody.
         */
        if (!wasOverridden || !isProjectMember(target.originalUserId)) {
          continue;
        }

        pagedUserId = target.originalUserId;
        onBehalfOfUserId = target.originalUserId;
      }

      /*
       * They escalated this run's page: they said they cannot take it, and
       * are not paged about it again - not by this rule, a later one or a
       * repeat. The line stays on the run's own page; the feed and the
       * run's Slack and Microsoft Teams message said once that they
       * escalated it.
       */
      if (hasPassedItOn(pagedUserId)) {
        // Said once per rule, whichever of its targets names them again.
        if (alreadyNotified(pagedUserId)) {
          continue;
        }

        uniqueUserIds.push(pagedUserId);

        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE;
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.alertSentToUserId = pagedUserId;

        if (target.teamId) {
          log.userBelongsToTeamId = target.teamId;
        }

        if (target.scheduleId) {
          log.onCallDutyScheduleId = target.scheduleId;
        }

        if (target.isNextInRotation) {
          log.isNextInRotation = true;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });

        outcome.notPaged.push({
          reason: OnCallNotPagedReason.PassedOn,
          userId: pagedUserId,
          teamId: target.teamId,
          scheduleId: target.scheduleId,
          awayUntil: null,
        });

        continue;
      }

      if (!alreadyNotified(pagedUserId)) {
        uniqueUserIds.push(pagedUserId);
        await startUserNotificationRuleExecution(
          onBehalfOfUserId,
          pagedUserId,
          target.teamId,
          target.scheduleId,
          target.isNextInRotation,
        );

        outcome.paged.push({
          userId: pagedUserId,
          coveringForUserId:
            pagedUserId.toString() !== onBehalfOfUserId.toString()
              ? onBehalfOfUserId
              : null,
          teamId: target.teamId,
          scheduleId: target.scheduleId,
          ...(target.isNextInRotation
            ? { isNextInRotation: true as const }
            : {}),
        });
      } else {
        const log: OnCallDutyPolicyExecutionLogTimeline = getNewLog();
        log.statusMessage = ALREADY_PAGED_TIMELINE_MESSAGE;
        log.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        log.alertSentToUserId = pagedUserId;

        if (target.teamId) {
          log.userBelongsToTeamId = target.teamId;
        }

        if (target.scheduleId) {
          log.onCallDutyScheduleId = target.scheduleId;
        }

        if (target.isNextInRotation) {
          log.isNextInRotation = true;
        }

        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: log,
          props: {
            isRoot: true,
          },
        });
      }
    }

    outcome.hadScheduleGap = hadScheduleGap;

    return {
      outcome: outcome,
      pagedLineIds: pagedLineIds,
    };
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

    /*
     * The schedules whose next person in the rotation the rule pages - the
     * backup after whoever is on call - checked before the rule was created
     * (onBeforeCreate), so this read cannot refuse.
     */
    const nextInRotationScheduleIds: Array<ObjectID> =
      readNextInRotationScheduleIds(onCreate.createBy.miscDataProps).map(
        (id: string): ObjectID => {
          return new ObjectID(id);
        },
      );

    if (
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["teams"] ||
        onCreate.createBy.miscDataProps["users"] ||
        onCreate.createBy.miscDataProps["onCallSchedules"] ||
        nextInRotationScheduleIds.length > 0)
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
        nextInRotationScheduleIds,
      );
    }

    return createdItem;
  }

  /*
   * The rule's responders, as join rows: the people, the teams, the
   * schedules whose on-call person it pages, and the schedules whose next
   * person in the rotation it pages (the backup after whoever is on call).
   */
  @CaptureSpan()
  public async addUsersTeamsAndSchedules(
    projectId: ObjectID,
    escalationRuleId: ObjectID,
    onCallDutyPolicyId: ObjectID,
    usersIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    onCallScheduleIds: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
    nextInRotationScheduleIds: Array<ObjectID> = [],
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

    for (const scheduleId of nextInRotationScheduleIds) {
      await this.addOnCallSchedules(
        projectId,
        escalationRuleId,
        onCallDutyPolicyId,
        scheduleId,
        props,
        { pageNextInRotation: true },
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
    options?: {
      // Page the next person in the schedule's rotation, not its on-call person.
      pageNextInRotation?: boolean | undefined;
    },
  ): Promise<void> {
    const scheduleInRule: OnCallDutyPolicyEscalationRuleSchedule =
      new OnCallDutyPolicyEscalationRuleSchedule();
    scheduleInRule.projectId = projectId;
    scheduleInRule.onCallDutyPolicyId = onCallDutyPolicyId;
    scheduleInRule.onCallDutyPolicyEscalationRuleId = escalationRuleId;
    scheduleInRule.onCallDutyPolicyScheduleId = onCallScheduleId;

    if (options?.pageNextInRotation) {
      scheduleInRule.pageNextInRotation = true;
    }

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

    /*
     * The schedules whose next person in the rotation the rule is to page
     * must be a list of ids: checked now, so a create that asks for them
     * wrongly is refused before the rule exists (onCreateSuccess adds them).
     */
    readNextInRotationScheduleIds(createBy.miscDataProps);

    // On the Free plan, an on-call policy may only have one escalation rule.
    if (this.isHeldToFreePlanLimit(createBy.props)) {
      const count: PositiveNumber = await this.countBy({
        query: {
          projectId: createBy.data.projectId!,
          onCallDutyPolicyId: onCallDutyPolicyId,
        },
        props: {
          isRoot: true,
        },
      });

      if (
        count.toNumber() >= ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN
      ) {
        throw new BadDataException(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE);
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
   * Whether the Free plan's limit on escalation rules holds this create:
   * billing on, and a caller on the Free plan (the plan CommonAPI read for
   * the request). OneUptime itself and a server admin carry no plan.
   */
  private isHeldToFreePlanLimit(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return IsBillingEnabled && props.currentPlan === PlanType.Free;
  }

  /*
   * The Free plan's limit on escalation rules, decided again with the
   * INSERT: the policy's rules are counted in the INSERT's own transaction,
   * under the limit's lock in the project, so rules added to a policy at
   * the same moment - each of which passed the early count in
   * onBeforeCreate - cannot all be added. Every create is asked, one that
   * skips its hooks too. Null when the create is held to no such limit.
   */
  protected override async getCreateLimit(
    createBy: CreateBy<Model>,
  ): Promise<CreateLimit | null> {
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (!projectId || !this.isHeldToFreePlanLimit(createBy.props)) {
      return null;
    }

    const onCallDutyPolicyId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ON_CALL_DUTY_POLICY_KEYS,
      "On-Call Policy",
    );

    if (!onCallDutyPolicyId) {
      return null;
    }

    return ProjectCountLimit.getCreateLimit({
      limitName: FREE_PLAN_ESCALATION_RULE_LIMIT_NAME,
      projectId: projectId,
      allowed: ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN,
      statement: ESCALATION_RULE_COUNT_STATEMENT,
      parameters: [projectId.toString(), onCallDutyPolicyId.toString()],
      refusal: FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
    });
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
      /*
       * The one rule the delete removes, and the delete held to it:
       * its users, teams and schedules go first, and the rules after
       * it move up a place once it is gone.
       */
      const found: { row: Model | null; deletesMore: boolean } =
        await this.findOneRowAndHoldDeleteToIt(deleteBy, {
          order: true,
          onCallDutyPolicyId: true,
          projectId: true,
        });

      if (found.deletesMore) {
        throw new BadDataException("Delete one escalation rule at a time.");
      }

      resource = found.row;

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

    // The one row an update names by its id is the one it moves.
    const movedId: ObjectID | null = Service.getOneRowIdNamedBy(updateBy.query);

    if (updateBy.data.order && !updateBy.props.isRoot && movedId) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: movedId,
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

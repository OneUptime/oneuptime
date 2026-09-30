import TeamComplianceEvaluator, {
  ComplianceCoverageCellInput,
  ComplianceLoadPlan,
  ComplianceMemberInput,
  ComplianceMethodInput,
  ComplianceNotificationRuleInput,
  ComplianceRuleInput,
  ComplianceSeverityInput,
  ProjectChannelSwitch,
  ResolvedComplianceRule,
} from "./TeamComplianceEvaluator";
import OnCallReadinessService, {
  ReadinessSummary,
  UserReadiness,
} from "Common/Server/Services/OnCallReadinessService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import type DatabaseService from "Common/Server/Services/DatabaseService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamComplianceSettingService, {
  TeamComplianceSettingService as TeamComplianceSettingRules,
} from "Common/Server/Services/TeamComplianceSettingService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import UserCallService from "Common/Server/Services/UserCallService";
import UserEmailService from "Common/Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "Common/Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserPushService from "Common/Server/Services/UserPushService";
import UserService from "Common/Server/Services/UserService";
import UserSlackService from "Common/Server/Services/UserSlackService";
import UserSmsService from "Common/Server/Services/UserSmsService";
import UserTelegramService from "Common/Server/Services/UserTelegramService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import UserWhatsAppService from "Common/Server/Services/UserWhatsAppService";
import Query from "Common/Server/Types/Database/Query";
import Select from "Common/Server/Types/Database/Select";
import Sort from "Common/Server/Types/Database/Sort";
import logger from "Common/Server/Utils/Logger";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "Common/Types/Team/ComplianceRule";
import { TeamComplianceStatusJSON } from "Common/Types/Team/TeamComplianceStatus";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";

/*
 * The UserNotificationRule column that points at a method on each channel.
 * Typed as keys of the model, so a renamed column fails to compile here
 * rather than silently reading nothing.
 */
type NotificationRuleMethodColumn = keyof UserNotificationRule &
  (
    | "userCallId"
    | "userSmsId"
    | "userPushId"
    | "userEmailId"
    | "userWhatsAppId"
    | "userTelegramId"
    | "userSlackId"
    | "userMicrosoftTeamsId"
    | "userWebhookId"
  );

// The UserNotificationRule relation behind each of those columns.
type NotificationRuleMethodRelation = keyof UserNotificationRule &
  (
    | "userCall"
    | "userSms"
    | "userPush"
    | "userEmail"
    | "userWhatsApp"
    | "userTelegram"
    | "userSlack"
    | "userMicrosoftTeams"
    | "userWebhook"
  );

/*
 * Where each channel's methods live. The nine method tables are different
 * models with the same three columns this file cares about (_id, userId,
 * isVerified - and webhooks have no isVerified), so they are read through one
 * loosely-typed door rather than nine copies of the same query.
 */
interface MethodChannelSource {
  service: DatabaseService<any>;
  ruleColumn: NotificationRuleMethodColumn;
  ruleRelation: NotificationRuleMethodRelation;
  // False for webhooks, which have no verification step and no column for it.
  hasVerification: boolean;
}

const METHOD_CHANNEL_SOURCES: Readonly<
  Record<ComplianceNotificationChannel, MethodChannelSource>
> = {
  [ComplianceNotificationChannel.Call]: {
    service: UserCallService,
    ruleColumn: "userCallId",
    ruleRelation: "userCall",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.SMS]: {
    service: UserSmsService,
    ruleColumn: "userSmsId",
    ruleRelation: "userSms",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.Push]: {
    service: UserPushService,
    ruleColumn: "userPushId",
    ruleRelation: "userPush",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.Email]: {
    service: UserEmailService,
    ruleColumn: "userEmailId",
    ruleRelation: "userEmail",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.WhatsApp]: {
    service: UserWhatsAppService,
    ruleColumn: "userWhatsAppId",
    ruleRelation: "userWhatsApp",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.Telegram]: {
    service: UserTelegramService,
    ruleColumn: "userTelegramId",
    ruleRelation: "userTelegram",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.Slack]: {
    service: UserSlackService,
    ruleColumn: "userSlackId",
    ruleRelation: "userSlack",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.MicrosoftTeams]: {
    service: UserMicrosoftTeamsService,
    ruleColumn: "userMicrosoftTeamsId",
    ruleRelation: "userMicrosoftTeams",
    hasVerification: true,
  },
  [ComplianceNotificationChannel.Webhook]: {
    service: UserWebhookService,
    ruleColumn: "userWebhookId",
    ruleRelation: "userWebhook",
    hasVerification: false,
  },
};

/*
 * A ceiling on the pages one paged read may take (of LIMIT_PER_PROJECT rows
 * each), so a read whose table grows faster than it can be read cannot hold a
 * request open forever. Five million rows is far beyond any team; hitting it is
 * logged as an error, because a truncated read renders as fewer problems.
 */
const MAX_PAGES_PER_READ: number = 500;

/*
 * The most method ids one read asks for. The ids come from the members' own
 * notification rules, which nothing caps, and an IN list costs one bind
 * parameter per id - Postgres refuses a statement with more than 65,535 - so
 * one member with enough rules could otherwise break the page for everybody.
 */
export const METHOD_IDS_PER_READ: number = 1000;

// Whatever a row's id arrives as: a model's `id` getter or a plain `_id`.
interface RowWithId {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
}

// What the channel rules need, all read in a constant number of queries.
interface ChannelRuleData {
  projectSeveritiesByKind: Map<
    ComplianceSeverityKind,
    Array<ComplianceSeverityInput>
  >;
  notificationRules: Array<ComplianceNotificationRuleInput>;
  methodsByChannel: Map<
    ComplianceNotificationChannel,
    Map<string, ComplianceMethodInput>
  >;
}

/*
 * Teams > View > Compliance: who on this team is not set up the way the team's
 * compliance rules say they must be, and why.
 *
 * This file is the READING half. It loads everything the rules need - in a
 * number of queries that does not grow with the team or with the number of
 * severities - and hands it to TeamComplianceEvaluator, which makes every
 * judgement and builds the TeamComplianceStatusJSON the Dashboard renders.
 *
 * What is read, and only when an enabled rule needs it:
 *
 *  - on-call rules with no channel: the on-call readiness coverage, in AT MOST
 *    TWO readiness computations for the whole team (the project summary, then
 *    one batch for members the summary does not cover). Never one readiness
 *    computation per member: each of those resolves the project's entire
 *    responder set.
 *  - method rules: ONE read per channel of the members' verified methods.
 *  - on-call rules with channels: the project's severities of the kinds
 *    needed, ONE read of the members' notification rules of the types needed
 *    (with the owner of every method each rule names), and ONE read per
 *    channel - per thousand referenced methods - of the method rows those
 *    rules point at. A channel several rules insist on is read once.
 *  - the project's channel switches, when a rule relies on Call, SMS,
 *    WhatsApp or Telegram: with the channel switched off for the project, a
 *    member who meets a Call, SMS or Telegram rule is still never notified
 *    that way, and nobody can add the WhatsApp number a WhatsApp rule asks
 *    for - and the rule says so.
 *
 * TENANT SCOPING. Every read is made with `isRoot: true`, because this page
 * deliberately reports on people the reader may have no permission to read
 * individually. That makes the projectId in each QUERY the only tenant
 * boundary there is, so every read carries it - including the team row itself,
 * which is asked for by id AND project together, so a team from another
 * project simply does not exist as far as this service is concerned. Users are
 * the one exception: User rows have no project, and are only ever read by the
 * ids this project's own TeamMember rows name.
 */
export default class TeamComplianceService {
  public static async getTeamComplianceStatus(
    teamId: ObjectID,
    projectId: ObjectID,
  ): Promise<TeamComplianceStatusJSON> {
    /*
     * By id AND project, in one query: a comparison after the read is a line
     * somebody can delete without the query looking wrong. A team from another
     * project comes back null and gets the same "Team not found" a nonexistent
     * id gets, so this cannot be used to learn which team ids exist elsewhere.
     */
    const team: Team | null = await TeamService.findOneBy({
      query: {
        _id: teamId.toString(),
        projectId: projectId,
      },
      select: {
        name: true,
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!team) {
      throw new BadDataException("Team not found");
    }

    /*
     * LIMIT_PER_PROJECT, never 100, here and on the member and user reads: a
     * truncated compliance page does not render as an error, it renders as
     * fewer rows - and a missing row reads exactly like "no problem here".
     */
    const settings: Array<TeamComplianceSetting> =
      await TeamComplianceSettingService.findBy({
        query: {
          teamId: teamId,
          projectId: projectId,
        },
        select: {
          _id: true,
          ruleType: true,
          enabled: true,
          // Both channel columns: see getStoredChannels.
          notificationChannels: true,
          notificationChannel: true,
          // Carries the mark a severity delete leaves on a rule it emptied.
          options: true,
          createdAt: true,
          incidentSeverities: {
            _id: true,
            name: true,
            color: true,
            order: true,
            projectId: true,
          },
          alertSeverities: {
            _id: true,
            name: true,
            color: true,
            order: true,
            projectId: true,
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
          _id: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        teamId: teamId,
        projectId: projectId,
      },
      select: {
        userId: true,
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * LIMIT_PER_PROJECT is a ceiling, not a promise. Ten thousand members on
     * one team is not a shape any install has, which is why this is a log
     * rather than a paging loop - but the day it happens the operator gets a
     * sentence saying the page is incomplete instead of a table that quietly is.
     */
    if (teamMembers.length >= LIMIT_PER_PROJECT) {
      logger.error(
        `TeamComplianceService read ${LIMIT_PER_PROJECT} members of team ${teamId.toString()} in project ${projectId.toString()} and stopped. The compliance page for this team is INCOMPLETE: members past that ceiling are absent from it entirely, and absence reads as compliance.`,
      );
    }

    const memberUserIds: Array<string> = TeamComplianceService.uniqueStrings(
      teamMembers.map((member: TeamMember): string | undefined => {
        return member.userId?.toString();
      }),
    );

    const users: Array<User> =
      memberUserIds.length > 0
        ? await UserService.findBy({
            query: {
              _id: new Includes(memberUserIds),
            },
            select: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          })
        : [];

    const usersById: Map<string, User> = new Map<string, User>();

    for (const user of users) {
      const userId: string | undefined = TeamComplianceService.idOf(user);

      if (userId) {
        usersById.set(userId, user);
      }
    }

    // In team-member order; a member whose user no longer exists is skipped.
    const members: Array<ComplianceMemberInput> = [];

    for (const userId of memberUserIds) {
      const user: User | undefined = usersById.get(userId);

      if (!user) {
        continue;
      }

      members.push({
        userId: userId,
        name: user.name?.toString() || undefined,
        email: user.email?.toString() || undefined,
        profilePictureId: user.profilePictureId?.toString() || undefined,
      });
    }

    const rules: Array<ComplianceRuleInput> = settings.map(
      (setting: TeamComplianceSetting): ComplianceRuleInput => {
        return TeamComplianceService.toRuleInput(setting);
      },
    );

    const resolvedRules: Array<ResolvedComplianceRule> =
      TeamComplianceEvaluator.resolveRules(rules, projectId.toString());

    const plan: ComplianceLoadPlan =
      TeamComplianceEvaluator.planLoads(resolvedRules);

    const userIds: Array<ObjectID> = members.map(
      (member: ComplianceMemberInput): ObjectID => {
        return new ObjectID(member.userId);
      },
    );

    /*
     * The four groups are independent of each other, so they are read side by
     * side. Each is a fixed number of queries, so the burst is bounded by the
     * number of channels, not by the size of the team.
     */
    const [
      coverageByUserId,
      verifiedMethodOwnersByChannel,
      channelRuleData,
      projectSwitches,
    ]: [
      Map<string, Array<ComplianceCoverageCellInput>>,
      Map<ComplianceNotificationChannel, Set<string>>,
      ChannelRuleData,
      Partial<Record<ProjectChannelSwitch, boolean>> | null,
    ] = await Promise.all([
      TeamComplianceService.loadCoverage(userIds, projectId, plan),
      TeamComplianceService.loadVerifiedMethodOwners(userIds, projectId, plan),
      TeamComplianceService.loadChannelRuleData(userIds, projectId, plan),
      TeamComplianceService.loadProjectSwitches(projectId, plan),
    ]);

    return TeamComplianceEvaluator.evaluate({
      teamId: teamId.toString(),
      teamName: team.name?.toString(),
      projectId: projectId.toString(),
      evaluatedAt: new Date(),
      rules: rules,
      members: members,
      coverageByUserId: coverageByUserId,
      verifiedMethodOwnersByChannel: verifiedMethodOwnersByChannel,
      projectSeveritiesByKind: channelRuleData.projectSeveritiesByKind,
      notificationRules: channelRuleData.notificationRules,
      methodsByChannel: channelRuleData.methodsByChannel,
      projectSwitches: projectSwitches,
    });
  }

  /*
   * Readiness coverage for the whole team, in AT MOST TWO readiness
   * computations however many members the team has.
   *
   * The project summary is asked for first. It resolves every responder on
   * every policy in one batched pass - for a team that exists because its
   * members are on call, that is everybody - and it is very likely already warm
   * in the readiness service's cache. Members it does not cover (on no policy
   * at all) are still subject to the rules, so they are resolved in ONE
   * `getReadinessForUsers` call - never `getReadinessForUser` per member, which
   * resolves the project's entire responder set every time it is called.
   *
   * A member the batch cannot resolve (removed from the project a moment ago)
   * is simply absent from the map, and the evaluator reports them as "could
   * not check" rather than failing the page for everybody else.
   */
  private static async loadCoverage(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
    plan: ComplianceLoadPlan,
  ): Promise<Map<string, Array<ComplianceCoverageCellInput>>> {
    const coverageByUserId: Map<
      string,
      Array<ComplianceCoverageCellInput>
    > = new Map<string, Array<ComplianceCoverageCellInput>>();

    if (!plan.needsCoverage || userIds.length === 0) {
      return coverageByUserId;
    }

    const wanted: Set<string> = new Set<string>(
      userIds.map((userId: ObjectID): string => {
        return userId.toString();
      }),
    );

    const summary: ReadinessSummary =
      await OnCallReadinessService.getReadinessForProject(projectId);

    for (const readiness of summary.users) {
      const key: string = readiness.userId.toString();

      if (wanted.has(key)) {
        coverageByUserId.set(key, readiness.coverage);
      }
    }

    const missing: Array<ObjectID> = userIds.filter(
      (userId: ObjectID): boolean => {
        return !coverageByUserId.has(userId.toString());
      },
    );

    if (missing.length === 0) {
      return coverageByUserId;
    }

    /*
     * Keyed back by the id each answer carries, never zipped against `missing`
     * by position: a batch that dropped one user would otherwise shift
     * everybody after them onto the wrong verdict.
     */
    const filled: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(missing, projectId);

    for (const readiness of filled) {
      const key: string = readiness.userId.toString();

      if (wanted.has(key)) {
        coverageByUserId.set(key, readiness.coverage);
      }
    }

    return coverageByUserId;
  }

  /*
   * For each channel an enabled method rule checks, which members own a
   * verified method on it in this project - ONE read per channel for the whole
   * team. A webhook has no verification step, so owning one is enough.
   */
  private static async loadVerifiedMethodOwners(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
    plan: ComplianceLoadPlan,
  ): Promise<Map<ComplianceNotificationChannel, Set<string>>> {
    const ownersByChannel: Map<
      ComplianceNotificationChannel,
      Set<string>
    > = new Map<ComplianceNotificationChannel, Set<string>>();

    if (userIds.length === 0) {
      return ownersByChannel;
    }

    await Promise.all(
      plan.methodChannels.map(
        async (channel: ComplianceNotificationChannel): Promise<void> => {
          const source: MethodChannelSource = METHOD_CHANNEL_SOURCES[channel];

          const query: Record<string, unknown> = {
            projectId: projectId,
            userId: new Includes(userIds),
          };

          if (source.hasVerification) {
            query["isVerified"] = true;
          }

          const rows: Array<DatabaseBaseModel> =
            await TeamComplianceService.readAllPages({
              description: `${channel} notification methods`,
              projectId: projectId,
              service: source.service,
              query: query,
              select: {
                _id: true,
                userId: true,
              },
            });

          const owners: Set<string> = new Set<string>();

          for (const row of rows) {
            const userId: string | undefined =
              TeamComplianceService.userIdOf(row);

            if (userId) {
              owners.add(userId);
            }
          }

          ownersByChannel.set(channel, owners);
        },
      ),
    );

    return ownersByChannel;
  }

  /*
   * Everything the on-call rules WITH channels need. Readiness cannot answer
   * them - its coverage cells carry no channel - so the members' rules are read
   * directly, together with the method rows they point at.
   */
  private static async loadChannelRuleData(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
    plan: ComplianceLoadPlan,
  ): Promise<ChannelRuleData> {
    const data: ChannelRuleData = {
      projectSeveritiesByKind: new Map<
        ComplianceSeverityKind,
        Array<ComplianceSeverityInput>
      >(),
      notificationRules: [],
      methodsByChannel: new Map<
        ComplianceNotificationChannel,
        Map<string, ComplianceMethodInput>
      >(),
    };

    if (plan.onCallChannels.length === 0 || userIds.length === 0) {
      return data;
    }

    const [severityLists, notificationRules]: [
      Array<[ComplianceSeverityKind, Array<ComplianceSeverityInput>]>,
      Array<ComplianceNotificationRuleInput>,
    ] = await Promise.all([
      Promise.all(
        plan.onCallSeverityKinds.map(
          async (
            kind: ComplianceSeverityKind,
          ): Promise<
            [ComplianceSeverityKind, Array<ComplianceSeverityInput>]
          > => {
            return [
              kind,
              await TeamComplianceService.loadProjectSeverities(
                kind,
                projectId,
              ),
            ];
          },
        ),
      ),
      TeamComplianceService.loadNotificationRules(userIds, projectId, plan),
    ]);

    for (const [kind, severities] of severityLists) {
      data.projectSeveritiesByKind.set(kind, severities);
    }

    data.notificationRules = notificationRules;

    await Promise.all(
      plan.onCallChannels.map(
        async (channel: ComplianceNotificationChannel): Promise<void> => {
          data.methodsByChannel.set(
            channel,
            await TeamComplianceService.loadReferencedMethods(
              channel,
              notificationRules,
              projectId,
            ),
          );
        },
      ),
    );

    return data;
  }

  /*
   * The project's severities of one kind, most severe first: the scope of a
   * channel rule with no severities selected, and the names its reasons use.
   */
  private static async loadProjectSeverities(
    kind: ComplianceSeverityKind,
    projectId: ObjectID,
  ): Promise<Array<ComplianceSeverityInput>> {
    const select: Select<IncidentSeverity> & Select<AlertSeverity> = {
      _id: true,
      name: true,
      order: true,
    };

    const sort: Sort<IncidentSeverity> & Sort<AlertSeverity> = {
      order: SortOrder.Ascending,
    };

    const rows: Array<IncidentSeverity | AlertSeverity> =
      kind === ComplianceSeverityKind.Incident
        ? await IncidentSeverityService.findBy({
            query: {
              projectId: projectId,
            },
            select: select,
            sort: sort,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          })
        : await AlertSeverityService.findBy({
            query: {
              projectId: projectId,
            },
            select: select,
            sort: sort,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

    const severities: Array<ComplianceSeverityInput> = [];

    for (const row of rows) {
      const id: string | undefined = TeamComplianceService.idOf(row);

      if (!id) {
        continue;
      }

      severities.push({
        id: id,
        name: row.name?.toString() || undefined,
        order: typeof row.order === "number" ? row.order : undefined,
        projectId: projectId.toString(),
      });
    }

    return severities;
  }

  /*
   * ONE paged read of the members' notification rules of the types the
   * channel rules check, carrying just the columns needed to judge them: the
   * severity columns, the opt-out flag, the method column of each channel
   * being checked - and the OWNER of the method behind every one of the nine
   * method relations, joined on the same read. The runtime selects exactly
   * those owners too, and refuses the whole rule when any of them is not the
   * rule's user (UserNotificationRuleService.executeNotificationRuleItem), so
   * a Call rule that also names somebody else's email is never sent.
   */
  private static async loadNotificationRules(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
    plan: ComplianceLoadPlan,
  ): Promise<Array<ComplianceNotificationRuleInput>> {
    const select: Select<UserNotificationRule> = {
      _id: true,
      userId: true,
      ruleType: true,
      incidentSeverityId: true,
      alertSeverityId: true,
      isOptOut: true,
    };

    for (const channel of plan.onCallChannels) {
      select[METHOD_CHANNEL_SOURCES[channel].ruleColumn] = true;
    }

    for (const source of Object.values(METHOD_CHANNEL_SOURCES)) {
      (select as Record<string, unknown>)[source.ruleRelation] = {
        userId: true,
      };
    }

    const rows: Array<UserNotificationRule> =
      await TeamComplianceService.readAllPages({
        description: "notification rules",
        projectId: projectId,
        service: UserNotificationRuleService,
        query: {
          projectId: projectId,
          userId: new Includes(userIds),
          ruleType: new Includes(plan.onCallRuleTypes),
        },
        select: select,
      });

    const wantedRuleTypes: Set<string> = new Set<string>(plan.onCallRuleTypes);
    const rules: Array<ComplianceNotificationRuleInput> = [];

    for (const row of rows) {
      const userId: string | undefined = row.userId?.toString();

      if (!userId || !row.ruleType || !wantedRuleTypes.has(row.ruleType)) {
        continue;
      }

      const methodIds: Partial<Record<ComplianceNotificationChannel, string>> =
        {};

      for (const channel of plan.onCallChannels) {
        const methodId: string | undefined = TeamComplianceService.toIdString(
          row[METHOD_CHANNEL_SOURCES[channel].ruleColumn],
        );

        if (methodId) {
          methodIds[channel] = methodId;
        }
      }

      rules.push({
        userId: userId,
        ruleType: row.ruleType as NotificationRuleType,
        incidentSeverityId: row.incidentSeverityId?.toString() || undefined,
        alertSeverityId: row.alertSeverityId?.toString() || undefined,
        /*
         * `=== true`, never `!== false`: isOptOut is NULL on every rule written
         * before the column existed, and those rows are rules, not opt-outs.
         */
        isOptOut: row.isOptOut === true,
        methodIds: methodIds,
        hasForeignMethod: TeamComplianceService.hasForeignMethod(row, userId),
      });
    }

    return rules;
  }

  /*
   * Exactly UserNotificationRuleService.getNotificationMethodsNotOwnedByRuleOwner:
   * a relation counts only when its method row was loaded and names an owner,
   * and that owner is not the rule's user. A method that no longer exists is
   * not a mismatch, and - as at runtime - its project is not consulted.
   */
  private static hasForeignMethod(
    row: UserNotificationRule,
    ruleOwnerId: string,
  ): boolean {
    for (const source of Object.values(METHOD_CHANNEL_SOURCES)) {
      const method: { userId?: ObjectID | string | undefined } | undefined =
        row[source.ruleRelation] as
          | { userId?: ObjectID | string | undefined }
          | undefined;

      const ownerId: string | undefined = TeamComplianceService.toIdString(
        method?.userId,
      );

      if (ownerId && ownerId !== ruleOwnerId) {
        return true;
      }
    }

    return false;
  }

  /*
   * The method rows the rules point at on one channel, scoped to this
   * project, in ONE read per METHOD_IDS_PER_READ ids (one read for any
   * realistic team). A rule pointing at a row that is not returned - deleted,
   * or in another project - is a rule with no usable method.
   */
  private static async loadReferencedMethods(
    channel: ComplianceNotificationChannel,
    rules: Array<ComplianceNotificationRuleInput>,
    projectId: ObjectID,
  ): Promise<Map<string, ComplianceMethodInput>> {
    const methods: Map<string, ComplianceMethodInput> = new Map<
      string,
      ComplianceMethodInput
    >();

    const methodIds: Array<string> = TeamComplianceService.uniqueStrings(
      rules.map((rule: ComplianceNotificationRuleInput): string | undefined => {
        return rule.isOptOut ? undefined : rule.methodIds[channel];
      }),
    );

    if (methodIds.length === 0) {
      return methods;
    }

    const source: MethodChannelSource = METHOD_CHANNEL_SOURCES[channel];

    const select: Record<string, boolean> = {
      _id: true,
      userId: true,
    };

    if (source.hasVerification) {
      select["isVerified"] = true;
    }

    const rows: Array<DatabaseBaseModel> = [];

    for (
      let start: number = 0;
      start < methodIds.length;
      start += METHOD_IDS_PER_READ
    ) {
      rows.push(
        ...(await TeamComplianceService.readAllPages({
          description: `${channel} notification methods referenced by notification rules`,
          projectId: projectId,
          service: source.service,
          query: {
            projectId: projectId,
            _id: new Includes(
              methodIds.slice(start, start + METHOD_IDS_PER_READ),
            ),
          },
          select: select,
        })),
      );
    }

    for (const row of rows) {
      const methodId: string | undefined = TeamComplianceService.idOf(row);

      if (!methodId) {
        continue;
      }

      methods.set(methodId, {
        methodId: methodId,
        userId: TeamComplianceService.userIdOf(row),
        isVerified: source.hasVerification
          ? (row as unknown as { isVerified?: boolean | undefined })
              .isVerified === true
          : true,
      });
    }

    return methods;
  }

  /*
   * The project's switches for the paid channels the enabled rules rely on.
   * Read only when one is relied on, and only those columns. A project row
   * that cannot be read gives an empty record, which the evaluator reads as
   * "switched off" - the answer that gets somebody to look.
   */
  private static async loadProjectSwitches(
    projectId: ObjectID,
    plan: ComplianceLoadPlan,
  ): Promise<Partial<Record<ProjectChannelSwitch, boolean>> | null> {
    if (plan.projectSwitches.length === 0) {
      return null;
    }

    const select: Select<Project> = {
      _id: true,
    };

    for (const projectSwitch of plan.projectSwitches) {
      select[projectSwitch] = true;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: select,
      props: {
        isRoot: true,
      },
    });

    const switches: Partial<Record<ProjectChannelSwitch, boolean>> = {};

    for (const projectSwitch of plan.projectSwitches) {
      switches[projectSwitch] = project?.[projectSwitch] === true;
    }

    return switches;
  }

  /*
   * Every row matching the query, a page of LIMIT_PER_PROJECT at a time,
   * sorted by _id so offset paging neither repeats nor skips a row. Each page
   * gets a fresh copy of the query, because findBy hands it to the permission
   * layer, and a query that accumulated predicates across pages would quietly
   * narrow as it went.
   */
  private static async readAllPages<TModel extends DatabaseBaseModel>(data: {
    description: string;
    projectId: ObjectID;
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    select: Select<TModel>;
  }): Promise<Array<TModel>> {
    const rows: Array<TModel> = [];
    let skip: number = 0;

    for (let page: number = 0; page < MAX_PAGES_PER_READ; page++) {
      const pageRows: Array<TModel> = await data.service.findBy({
        query: { ...data.query },
        select: data.select,
        sort: {
          _id: SortOrder.Ascending,
        } as Sort<TModel>,
        limit: LIMIT_PER_PROJECT,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      rows.push(...pageRows);

      if (pageRows.length < LIMIT_PER_PROJECT) {
        return rows;
      }

      skip += pageRows.length;
    }

    logger.error(
      `TeamComplianceService stopped reading ${data.description} for project ${data.projectId.toString()} after ${MAX_PAGES_PER_READ} pages of ${LIMIT_PER_PROJECT} rows. The compliance page for this project is INCOMPLETE and may report members as missing what they have.`,
    );

    return rows;
  }

  private static toRuleInput(
    setting: TeamComplianceSetting,
  ): ComplianceRuleInput {
    return {
      settingId: TeamComplianceService.idOf(setting) || "",
      ruleType: setting.ruleType?.toString() || undefined,
      enabled: setting.enabled === true,
      notificationChannels:
        TeamComplianceSettingRules.getStoredChannels(setting),
      createdAt: setting.createdAt || undefined,
      incidentSeverities: TeamComplianceService.toSeverityInputs(
        setting.incidentSeverities,
      ),
      alertSeverities: TeamComplianceService.toSeverityInputs(
        setting.alertSeverities,
      ),
      severitiesDeleted: TeamComplianceSettingRules.hasSeveritiesDeletedMark(
        setting.options,
      ),
    };
  }

  private static toSeverityInputs(
    severities: Array<IncidentSeverity | AlertSeverity> | undefined,
  ): Array<ComplianceSeverityInput> {
    const inputs: Array<ComplianceSeverityInput> = [];

    for (const severity of severities || []) {
      const id: string | undefined = TeamComplianceService.idOf(severity);

      if (!id) {
        continue;
      }

      const color: string | undefined = severity.color
        ? severity.color.toString()
        : undefined;

      inputs.push({
        id: id,
        name: severity.name?.toString() || undefined,
        color: color || undefined,
        order: typeof severity.order === "number" ? severity.order : undefined,
        projectId: severity.projectId?.toString() || undefined,
      });
    }

    return inputs;
  }

  private static idOf(row: RowWithId | DatabaseBaseModel): string | undefined {
    const candidate: RowWithId = row as RowWithId;

    return (
      TeamComplianceService.toIdString(candidate._id) ||
      TeamComplianceService.toIdString(candidate.id)
    );
  }

  private static userIdOf(row: DatabaseBaseModel): string | undefined {
    return TeamComplianceService.toIdString(
      (row as unknown as { userId?: ObjectID | string | undefined }).userId,
    );
  }

  private static toIdString(value: unknown): string | undefined {
    if (typeof value === "string") {
      return value || undefined;
    }

    if (value instanceof ObjectID) {
      return value.toString() || undefined;
    }

    return undefined;
  }

  // Non-empty values, first occurrence kept, in input order.
  private static uniqueStrings(
    values: Array<string | undefined>,
  ): Array<string> {
    const seen: Set<string> = new Set<string>();
    const unique: Array<string> = [];

    for (const value of values) {
      if (value && !seen.has(value)) {
        seen.add(value);
        unique.push(value);
      }
    }

    return unique;
  }
}

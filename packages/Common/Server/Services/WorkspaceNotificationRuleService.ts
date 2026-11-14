import ObjectID from "../../Types/ObjectID";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import IncidentNotificationRule from "../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentService from "./IncidentService";
import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
  NotificationRuleConditionValues,
} from "../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import BadDataException from "../../Types/Exception/BadDataException";
import Label from "../../Models/DatabaseModels/Label";
import MonitorService from "./MonitorService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import { WorkspaceNotificationRuleUtil } from "../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import TeamMemberService from "./TeamMemberService";
import User from "../../Models/DatabaseModels/User";
import BaseNotificationRule from "../../Types/Workspace/NotificationRules/BaseNotificationRule";
import CreateChannelNotificationRule from "../../Types/Workspace/NotificationRules/CreateChannelNotificationRule";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceChannelToCreate,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../Utils/Workspace/WorkspaceBase";
import WorkspaceChannelNotFound from "../Utils/Workspace/WorkspaceChannelNotFound";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import Dictionary from "../../Types/Dictionary";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
  MiscData,
  SlackMiscData,
  MattermostMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import SlackOrganization, {
  SlackOrganizationConnection,
  SlackWorkspaceNotAddedException,
} from "../Utils/Workspace/Slack/SlackOrganization";
import MattermostTeams from "../Utils/Workspace/Mattermost/MattermostTeams";
import logger, { LogAttributes } from "../Utils/Logger";
import NotificationRuleWorkspaceChannel, {
  NotificationRuleWorkspaceChannelUtil,
} from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
  RuleOfChannel,
} from "../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import UserService from "./UserService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Text from "../../Types/Text";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import WorkspaceNotificationLog from "../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import IncidentEpisodeService from "./IncidentEpisodeService";
import AlertEpisodeService from "./AlertEpisodeService";
import ProjectService from "./ProjectService";
import Project from "../../Models/DatabaseModels/Project";
import SecurityCase from "../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../Models/DatabaseModels/SecurityPlaybook";
import SecurityCaseService from "./SecurityCaseService";
import SecurityHunt from "../../Models/DatabaseModels/SecurityHunt";
import SecurityHuntService from "./SecurityHuntService";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import SloErrorBudgetPolicyChange from "../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CallerPermission from "../Utils/Permission/CallerPermission";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";
import ProductBrandingText from "../Utils/ProductBrandingText";
import ChannelMembersNotAddedNotice, {
  ChannelMembersNotAdded,
} from "../Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import WorkspaceMessageTime from "../Utils/Workspace/WorkspaceMessageTime";
import WorkspaceNotificationText from "../Utils/Workspace/WorkspaceNotificationText";
import WorkspaceChannelName, {
  NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE,
  WorkspaceChannelNameParts,
  WorkspaceChannelNumberPrefixes,
} from "../../Utils/Workspace/WorkspaceChannelName";
import { NumberPrefixColumn } from "../../Utils/Project/NumberPrefix";
import NotificationRuleInvites, {
  NotificationRuleInvitee,
} from "../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import WorkspaceRecordPeople from "../Utils/Workspace/WorkspaceRecordPeople";
import WorkspaceRecordChannels, {
  WorkspaceRecordChannelState,
} from "../Utils/Workspace/WorkspaceRecordChannels";
import WorkspaceScheduleOnCall, {
  ScheduleOnCallPerson,
} from "../Utils/Workspace/WorkspaceScheduleOnCall";
import ColumnLength from "../../Types/Database/ColumnLength";
import SlackAccountByEmail, {
  SlackEmailAccount,
} from "../Utils/Workspace/Slack/SlackAccountByEmail";
import MattermostConnection from "../Utils/Workspace/Mattermost/MattermostConnection";
import MattermostUtil, {
  MattermostUser,
} from "../Utils/Workspace/Mattermost/Mattermost";
import QueryHelper from "../Types/Database/QueryHelper";
import WorkspaceRecordOwners, {
  OwnedRecordKey,
} from "../Utils/Workspace/WorkspaceRecordOwners";
import NotificationRuleConditionIds from "../Utils/Workspace/NotificationRuleConditionIds";

export interface MessageBlocksByWorkspaceType {
  workspaceType: WorkspaceType;
  messageBlocks: Array<WorkspaceMessageBlock>;
}

/*
 * Whom a rule's channels invite, as the workspace knows them
 * (findWorkspaceUserIdsToInvite): each person found there, and who was not.
 */
export interface WorkspaceInvitees {
  invitees: Array<{ userId: ObjectID; workspaceUserId: string }>;
  notFoundUserIds: Array<ObjectID>;
}

/*
 * What setting up a record's own channels came to: the channels OneUptime
 * created, and who it could not add to them. The record's service posts its
 * first message ("Incident INC-8 Created") and then has the channels told
 * who is missing (ChannelMembersNotAddedNotice.noteAll), so a new channel
 * opens on what happened.
 */
export interface WorkspaceChannelsCreated {
  channelsCreated: Array<NotificationRuleWorkspaceChannel>;
  membersNotAdded: Array<ChannelMembersNotAdded>;
}

/*
 * A channel the matching rules ask to be created for a record: the name it
 * asks for (the record's name with the first rule's prefix, if it has one,
 * in front - WorkspaceChannelName), every rule that asked for it (the first
 * one first, as notificationRuleId), the Microsoft Teams team to create it
 * in, and that prefix, for the names to try after it when that one is taken.
 */
export interface NotificationRuleChannelToCreate {
  channelName: string;
  notificationRuleId: string;
  notificationRuleIds: Array<string>;
  teamId?: string;
  prefix: string;
}

/*
 * A channel created for a record, with the channel it was asked as - its
 * name and team before the workspace named it (name-2 when the name was
 * taken) - which later requests are matched to.
 */
interface CreatedRuleChannel {
  askedFor: WorkspaceChannelToCreate;
  channel: NotificationRuleWorkspaceChannel;
}

// What a rule's channel is created with (WorkspaceBase.createChannel).
interface CreateRuleChannelData {
  authToken: string;
  channelName: string;
  projectId: ObjectID;
  teamId?: string;
  isPrivate?: boolean;
  /*
   * Slack: the project's connection to a whole Enterprise organization, as
   * read for every channel created at once - null for one to one workspace
   * (SlackUtil.createChannel).
   */
  organization?: SlackOrganizationConnection | null;
}

/*
 * A channel a message about a record is not posted in: the one a note was
 * saved from (WorkspaceReactionNote). The message is already there - the
 * note is it - so posting the note back would only repeat it.
 */
export interface WorkspaceChannelToSkip {
  workspaceType: WorkspaceType;
  channelId: string;
}

export interface NotificationFor {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
  /*
   * A security case (SecurityCaseNotifications): posted to the channels and
   * chats its Security Case rules name. It has no channel of its own.
   */
  securityCaseId?: ObjectID | undefined;
  /*
   * A hunt whose scheduled run found events (SecurityHuntNotifications):
   * posted to the channels and chats its Security Hunt rules name. It has
   * no channel of its own.
   */
  securityHuntId?: ObjectID | undefined;
  /*
   * An SLO whose error budget policy the evaluation just moved
   * (SloWorkspaceNotifications): posted to the channels and chats its
   * Service Level Objective rules name. It has no channel of its own.
   * serviceLevelObjectivePolicyChanges says what moved - the tier, the
   * deploy gate, or both - for the rules' Error Budget Policy Change
   * condition; the SLO's own name and labels are read as it is now.
   */
  serviceLevelObjectiveId?: ObjectID | undefined;
  serviceLevelObjectivePolicyChanges?:
    | Array<SloErrorBudgetPolicyChange>
    | undefined;
}

// The fields of NotificationFor that name a record, by its id.
export type NotificationForRecordKey = Exclude<
  keyof NotificationFor,
  "serviceLevelObjectivePolicyChanges"
>;

// Slack conversation ids are short upper-case alphanumerics (C0123ABCD, G..., D...).
const SLACK_CHANNEL_ID_REGEX: RegExp = /^[A-Za-z0-9]{1,64}$/;

/*
 * Upper bounds for Microsoft Teams ids accepted by the destination test.
 * Generous next to real ids (a GUID, "19:...@thread.tacv2"), small enough
 * that an oversized value is rejected before it reaches Microsoft Graph.
 */
const TEST_NOTIFICATION_MAX_GRAPH_ID_LENGTH: number = 512;
const TEST_NOTIFICATION_MAX_CHAT_ID_LENGTH: number = 1024;

/*
 * Characters that would change the meaning of a Microsoft Graph URL path when
 * interpolated unencoded into it: separators, query / fragment starters,
 * percent-escapes and whitespace.
 */
const GRAPH_PATH_SEGMENT_FORBIDDEN_CHARS_REGEX: RegExp = /[\s/\\?#%]/;

/*
 * A path segment made only of dots. URL normalisation treats "." and ".." as
 * relative-path segments, so /teams/T/channels/.. would resolve to /teams/T/.
 */
const GRAPH_PATH_DOT_SEGMENT_REGEX: RegExp = /^\.+$/;

const TEST_NOTIFICATION_SEND_FAILED_PREFIX: string =
  "Could not send the test notification.";

/*
 * What a record is called in the first message of a channel opened for it
 * later: "OneUptime created it when the incident matched the rule ...".
 */
const LATER_CHANNEL_RECORD_WORDS: Record<NotificationRuleEventType, string> = {
  [NotificationRuleEventType.Incident]: "incident",
  [NotificationRuleEventType.Alert]: "alert",
  [NotificationRuleEventType.IncidentEpisode]: "incident episode",
  [NotificationRuleEventType.AlertEpisode]: "alert episode",
  [NotificationRuleEventType.ScheduledMaintenance]: "maintenance event",
  [NotificationRuleEventType.Monitor]: "monitor",
  [NotificationRuleEventType.OnCallDutyPolicy]: "on-call policy",
  [NotificationRuleEventType.SecurityCase]: "security case",
  [NotificationRuleEventType.SecurityHunt]: "hunt",
  [NotificationRuleEventType.ServiceLevelObjective]: "SLO",
};

/*
 * Who may set up a Security Case rule: the roles that may create a security
 * playbook (SecurityPlaybook's create permissions). A Security Case rule
 * posts every case it matches - its title, entities and link - to the
 * channels it names, as a playbook's Post to Slack step does, and a case is
 * the investigation trail of a possible breach, which most of a project may
 * not read. Without this a Project Member, who may set up the other rules,
 * could post every security case to a channel of theirs.
 */
export const SECURITY_CASE_RULE_PERMISSION_MESSAGE: string =
  "A Security Case rule posts security cases to Slack and Microsoft Teams, so it takes a role that may set up security playbooks, such as Project Owner, Project Admin or Security Admin.";

/*
 * A Security Hunt rule posts what every hunt it matches finds - the hunt,
 * its search, how many events and when - to the channels it names: security
 * data, as a case is, so it is set up by the same roles.
 */
export const SECURITY_HUNT_RULE_PERMISSION_MESSAGE: string =
  "A Security Hunt rule posts what hunts find to Slack and Microsoft Teams, so it takes a role that may set up security playbooks, such as Project Owner, Project Admin or Security Admin.";

/*
 * The rules that post security data, each with why setting one up takes a
 * Security role: every other rule is set up by whoever may set up rules.
 */
const SECURITY_RULE_PERMISSION_MESSAGES: Readonly<
  Partial<Record<NotificationRuleEventType, string>>
> = {
  [NotificationRuleEventType.SecurityCase]:
    SECURITY_CASE_RULE_PERMISSION_MESSAGE,
  [NotificationRuleEventType.SecurityHunt]:
    SECURITY_HUNT_RULE_PERMISSION_MESSAGE,
};

/*
 * The kinds of record a rule only posts about, in channels and chats that
 * exist: a security case, a hunt and an SLO's error budget policy never get
 * a channel of their own.
 */
export function isPostOnlyNotificationRuleEventType(
  eventType: NotificationRuleEventType | undefined,
): boolean {
  return (
    eventType === NotificationRuleEventType.SecurityCase ||
    eventType === NotificationRuleEventType.SecurityHunt ||
    eventType === NotificationRuleEventType.ServiceLevelObjective
  );
}

export class Service extends DatabaseService<WorkspaceNotificationRule> {
  public constructor() {
    super(WorkspaceNotificationRule);
  }

  /*
   * A rule that posts security data (SECURITY_RULE_PERMISSION_MESSAGES) is
   * set up only by a role that may create a security playbook; `eventType`
   * is the kind of rule asked about, and says why when the caller may not.
   */
  private assertMaySetUpSecurityRules(
    props: DatabaseCommonInteractionProps,
    eventType: NotificationRuleEventType,
  ): void {
    const message: string | undefined =
      SECURITY_RULE_PERMISSION_MESSAGES[eventType];

    if (!message || props.isRoot || props.isMasterAdmin) {
      return;
    }

    if (
      !CallerPermission.holdsAnyOf(
        props,
        new SecurityPlaybook().getCreatePermissions(),
        { projectId: props.tenantId },
      )
    ) {
      throw new NotAuthorizedException(message);
    }
  }

  // Whether a kind of rule posts security data: a Security Case or Security Hunt rule.
  private static isSecurityRuleEventType(eventType: unknown): boolean {
    return Boolean(
      SECURITY_RULE_PERMISSION_MESSAGES[eventType as NotificationRuleEventType],
    );
  }

  /*
   * The first rule that posts security data among the rules a write
   * changes, if any: the ones the update writes or the delete removes, read
   * the way every hook that judges a write by its rows reads them
   * (findRowsAndHoldUpdateToThem, findRowsAndHoldDeleteToThem), with the
   * write held to them - so the rules judged are the rules written.
   */
  private static findSecurityRuleEventType(
    rules: Array<WorkspaceNotificationRule>,
  ): NotificationRuleEventType | undefined {
    return rules.find((rule: WorkspaceNotificationRule): boolean => {
      return Service.isSecurityRuleEventType(rule.eventType);
    })?.eventType;
  }

  /*
   * The updates a rule is saved to post (NotificationRuleUpdates): a list of
   * those its kind of rule can choose, or none at all, which is every
   * update. The Dashboard's Updates step only ever saves such a list; an API
   * call or a workflow that saves another is told what the rule takes, as a
   * list stored with a kind it cannot post would leave that update out of
   * the rule's channels for good.
   */
  private static assertUpdatesToPostAreValid(data: {
    notificationRule: unknown;
    eventType: NotificationRuleEventType | undefined;
  }): void {
    const error: string | null = NotificationRuleUpdates.getValidationError({
      eventType: data.eventType,
      updatesToPost: Service.getWrittenUpdatesToPost(data.notificationRule),
    });

    if (error) {
      throw new BadDataException(error);
    }
  }

  // The updatesToPost a write of the rule's notificationRule holds, if any.
  private static getWrittenUpdatesToPost(notificationRule: unknown): unknown {
    if (
      !notificationRule ||
      typeof notificationRule !== "object" ||
      Array.isArray(notificationRule)
    ) {
      return undefined;
    }

    return (notificationRule as Record<string, unknown>)["updatesToPost"];
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<WorkspaceNotificationRule>,
  ): Promise<OnCreate<WorkspaceNotificationRule>> {
    if (
      createBy.data.eventType &&
      Service.isSecurityRuleEventType(createBy.data.eventType)
    ) {
      this.assertMaySetUpSecurityRules(createBy.props, createBy.data.eventType);
    }

    Service.assertUpdatesToPostAreValid({
      notificationRule: createBy.data.notificationRule,
      eventType: createBy.data.eventType,
    });

    /*
     * The people, teams and policies its conditions name are the project's
     * own (NotificationRuleConditionIds).
     */
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!createBy.props.isRoot && projectId) {
      await NotificationRuleConditionIds.checkFilters({
        projectId: projectId,
        filters: NotificationRuleConditionIds.getRuleFilters(
          createBy.data.notificationRule,
        ),
      });
    }

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<WorkspaceNotificationRule>,
  ): Promise<OnUpdate<WorkspaceNotificationRule>> {
    if (!updateBy.props.isRoot) {
      const sentEventType: unknown = (
        updateBy.data as unknown as Record<string, unknown>
      )["eventType"];

      const eventType: NotificationRuleEventType | undefined =
        Service.isSecurityRuleEventType(sentEventType)
          ? (sentEventType as NotificationRuleEventType)
          : Service.findSecurityRuleEventType(
              await this.findRowsAndHoldUpdateToThem(updateBy, {
                eventType: true,
              }),
            );

      if (eventType) {
        this.assertMaySetUpSecurityRules(updateBy.props, eventType);
      }

      /*
       * Conditions written again: the people, teams and policies they name
       * now are the project's own, but for those each rule named already -
       * one since removed from the project is kept, and said so in the
       * rule's view (NotificationRuleConditionIds).
       */
      const sentFilters: unknown = NotificationRuleConditionIds.getRuleFilters(
        (updateBy.data as unknown as Record<string, unknown>)[
          "notificationRule"
        ],
      );

      if (NotificationRuleConditionIds.namesCheckedIds(sentFilters)) {
        const rules: Array<WorkspaceNotificationRule> =
          await this.findRowsAndHoldUpdateToThem(updateBy, {
            projectId: true,
            notificationRule: true,
          });

        for (const rule of rules) {
          if (!rule.projectId) {
            continue;
          }

          await NotificationRuleConditionIds.checkFilters({
            projectId: rule.projectId,
            filters: sentFilters,
            keptIds: NotificationRuleConditionIds.getIdsNamed(
              NotificationRuleConditionIds.getRuleFilters(
                rule.notificationRule,
              ),
            ),
          });
        }
      }
    }

    /*
     * The updates the rule is saved to post are checked against the kind of
     * rule it is: the kind the update sends, or else the kind of each rule
     * it writes - read only when it writes a list.
     */
    const writtenUpdatesToPost: unknown = Service.getWrittenUpdatesToPost(
      (updateBy.data as unknown as Record<string, unknown>)["notificationRule"],
    );

    if (writtenUpdatesToPost !== undefined && writtenUpdatesToPost !== null) {
      const sentEventType: unknown = (
        updateBy.data as unknown as Record<string, unknown>
      )["eventType"];

      const eventTypes: Array<NotificationRuleEventType | undefined> =
        sentEventType
          ? [sentEventType as NotificationRuleEventType]
          : (
              await this.findRowsAndHoldUpdateToThem(updateBy, {
                eventType: true,
              })
            ).map(
              (
                rule: WorkspaceNotificationRule,
              ): NotificationRuleEventType | undefined => {
                return rule.eventType;
              },
            );

      for (const eventType of eventTypes) {
        Service.assertUpdatesToPostAreValid({
          notificationRule: (
            updateBy.data as unknown as Record<string, unknown>
          )["notificationRule"],
          eventType: eventType,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<WorkspaceNotificationRule>,
  ): Promise<OnDelete<WorkspaceNotificationRule>> {
    if (!deleteBy.props.isRoot) {
      const eventType: NotificationRuleEventType | undefined =
        Service.findSecurityRuleEventType(
          await this.findRowsAndHoldDeleteToThem(deleteBy, {
            eventType: true,
          }),
        );

      if (eventType) {
        this.assertMaySetUpSecurityRules(deleteBy.props, eventType);
      }
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async testRule(data: {
    ruleId: ObjectID;
    projectId: ObjectID;
    testByUserId: ObjectID; // this can be useful to invite user to channels if the channels was created.
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const rule: WorkspaceNotificationRule | null = await this.findOneById({
      id: data.ruleId,
      select: {
        notificationRule: true,
        workspaceType: true,
        eventType: true,
        projectId: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!rule) {
      throw new BadDataException("Rule not found");
    }

    data.projectId = rule.projectId!;

    // check fi the testUser account is connected to workspace or not.
    const userWOrkspaceAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          userId: data.testByUserId,
          workspaceType: rule.workspaceType!,
        },
        select: {
          workspaceUserId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userWOrkspaceAuth || !userWOrkspaceAuth.workspaceUserId) {
      throw new BadDataException(
        "This account is not connected to " +
          rule.workspaceType +
          ". Please go to User Settings and connect the account.",
      );
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          workspaceType: rule.workspaceType!,
        },
        select: {
          workspaceType: true,
          authToken: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth) {
      throw new BadDataException(
        "This project is not connected to " +
          rule.workspaceType +
          ". Please go to Project Settings and connect the account.",
      );
    }

    const projectAuthToken: string = projectAuth.authToken!;

    const notificationRule: BaseNotificationRule =
      rule.notificationRule as BaseNotificationRule;

    // now send test message to these channels.
    const messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> =
      [];

    // use markdown to create blocks
    messageBlocksByWorkspaceTypes.push({
      workspaceType: rule.workspaceType!,
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          // The rule's name is plain text in the Markdown message.
          text: mdText`This is a test message for rule **${rule.name?.trim()}**`.toString(),
        } as WorkspacePayloadMarkdown,
      ],
    });

    let existingChannels: Array<WorkspaceChannel> = [];

    let createdChannels: NotificationRuleWorkspaceChannel[] = [];

    if (
      !isPostOnlyNotificationRuleEventType(rule.eventType) &&
      (notificationRule as IncidentNotificationRule).shouldCreateNewChannel
    ) {
      /*
       * A channel of its own, named as the rule names a record's, with a few
       * random letters for the record: prod-abcde, or test-abcde for a rule
       * without a prefix.
       */
      const channelNameParts: WorkspaceChannelNameParts =
        WorkspaceChannelName.forTest({
          randomText: Text.generateRandomText(5),
        });

      try {
        // create channel
        createdChannels = await this.createChannelsBasedOnRules({
          projectId: data.projectId,
          projectOrUserAuthTokenForWorkspace: projectAuthToken,
          workspaceType: rule.workspaceType!,
          notificationRules: [rule],
          channelNameParts: channelNameParts,
          notificationEventType: rule.eventType!,
          // A test says why the channel could not be created.
          throwOnCreateChannelError: true,
        });
      } catch (err) {
        /*
         * The Slack workspace the rule picks no longer has OneUptime: said
         * as it is (SlackOrganization.getNotAddedMessage), as the rule's
         * Notification Logs say it.
         */
        if (err instanceof SlackWorkspaceNotAddedException) {
          throw new BadDataException(err.message);
        }

        /*
         * What the workspace answered, readable whatever was thrown: Slack
         * and Microsoft Graph throw an HTTP error response itself.
         */
        throw new BadDataException(
          "Cannot create a new channel. " +
            WorkspaceBase.getSendErrorMessage(err),
        );
      }

      try {
        await this.inviteUsersBasedOnRulesAndWorkspaceChannels({
          workspaceChannels: createdChannels,
          projectId: data.projectId,
          notificationRules: [rule],
          userIds: [data.testByUserId],
          // A test says when the tester could not be invited.
          throwOnInviteError: true,
        });
      } catch (err) {
        /*
         * What the workspace answered, readable whatever was thrown: Slack's
         * invite throws its HTTP response itself on a transport error.
         */
        throw new BadDataException(
          "Cannot invite users to the channel. " +
            WorkspaceBase.getSendErrorMessage(err),
        );
      }
    }

    if (notificationRule.shouldPostToExistingChannel) {
      existingChannels = this.getExistingChannelNamesFromNotificationRules({
        notificationRules: [notificationRule],
        workspaceType: rule.workspaceType!,
      });

      for (const channel of existingChannels) {
        try {
          // check if these channels exist.
          const doesChannelExistData: {
            authToken: string;
            channelName: string;
            projectId: ObjectID;
            teamId?: string;
          } = {
            authToken: projectAuthToken,
            channelName: channel.name,
            projectId: data.projectId,
          };

          // Add teamId for Microsoft Teams
          if (rule.workspaceType === WorkspaceType.MicrosoftTeams) {
            const teamId: string | undefined = channel.teamId;
            if (!teamId) {
              throw new BadDataException(
                "Microsoft Teams integration requires a team to be selected for posting to existing channels. Please edit the notification rule and select a team.",
              );
            }
            doesChannelExistData.teamId = teamId;
          }

          /*
           * Slack, installed for a whole Enterprise organization, and
           * Mattermost: the workspace or the team the rule names, when it
           * names one (SlackOrganization, MattermostTeams). A Slack
           * workspace OneUptime is no longer added to is said so, rather
           * than the channel said not to exist
           * (SlackWorkspaceNotAddedException).
           */
          if (
            (rule.workspaceType === WorkspaceType.Slack ||
              rule.workspaceType === WorkspaceType.Mattermost) &&
            channel.teamId
          ) {
            doesChannelExistData.teamId = channel.teamId;
          }

          const channelExists: boolean =
            await WorkspaceUtil.getWorkspaceTypeUtil(
              rule.workspaceType!,
            ).doesChannelExist(doesChannelExistData);

          /*
           * In the words the rule's Notification Logs give a channel that
           * cannot be found when the rule posts for real
           * (WorkspaceChannelNotFound): Test Failed and the logs say one
           * thing.
           */
          if (!channelExists) {
            throw new BadDataException(
              WorkspaceChannelNotFound.getReason({
                workspaceType: rule.workspaceType!,
                channelName: channel.name,
              }),
            );
          }
        } catch (err) {
          throw new BadDataException((err as Error)?.message);
        }
      }
    }

    /*
     * Post to the channels this test just created.
     *
     * This loop used to sit inside the shouldPostToExistingChannel block, so a
     * rule that only creates a channel created it, invited nobody (a no-op on
     * Teams) and reported success without ever attempting a send. The one
     * action an admin runs to prove the bot can post proved nothing, and a
     * passing test was read as evidence that the workspace app was wired up
     * correctly when it had never been exercised.
     */
    for (const createdChannel of createdChannels) {
      await this.postTestMessageToChannels({
        projectId: data.projectId,
        messageBlocksByWorkspaceTypes: messageBlocksByWorkspaceTypes,
        testByUserId: data.testByUserId,
        channelNames: [],
        channelIds: [createdChannel.id],
        /*
         * The team the channel was actually created in. This used to pass
         * existingTeam, which is a different field on a different rule — for a
         * create-only rule it is undefined, and when both are set they can name
         * two different teams.
         */
        teamId: createdChannel.teamId,
      });
    }

    for (const channel of existingChannels) {
      await this.postTestMessageToChannels({
        projectId: data.projectId,
        messageBlocksByWorkspaceTypes: messageBlocksByWorkspaceTypes,
        testByUserId: data.testByUserId,
        channelNames: [channel.name],
        channelIds: [],
        teamId: channel.teamId,
      });
    }

    // Post test message to Microsoft Teams chats.
    if (
      rule.workspaceType === WorkspaceType.MicrosoftTeams &&
      notificationRule.shouldPostToExistingChat
    ) {
      const chatIds: Array<string> =
        this.getExistingChatIdsFromNotificationRules({
          notificationRules: [notificationRule],
        });

      if (chatIds.length === 0) {
        throw new BadDataException(
          "No Microsoft Teams chats are selected in this rule. Please edit the rule and select at least one chat.",
        );
      }

      const connectedChats: Record<string, MicrosoftTeamsChat> =
        await this.getConnectedMicrosoftTeamsChats({
          projectId: data.projectId,
        });

      for (const chatId of chatIds) {
        if (!connectedChats[chatId]) {
          throw new BadDataException(
            `The selected chat (id: ${chatId}) is no longer connected to OneUptime. Please add the OneUptime app to the chat in Microsoft Teams and update this rule.`,
          );
        }
      }

      try {
        const responses: Array<WorkspaceSendMessageResponse> =
          await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
            projectId: data.projectId,
            messagePayloadsByWorkspace: messageBlocksByWorkspaceTypes.map(
              (messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType) => {
                const payload: WorkspaceMessagePayload = {
                  _type: "WorkspaceMessagePayload",
                  workspaceType: messageBlocksByWorkspaceType.workspaceType,
                  messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
                  channelNames: [],
                  channelIds: [],
                  chatIds: chatIds,
                };

                return payload;
              },
            ),
          });

        for (const res of responses) {
          // Check for errors in the response
          if (res.errors && res.errors.length > 0) {
            const errorMessages: Array<string> = res.errors.map(
              (error: { channel: WorkspaceChannel; error: string }) => {
                return `Chat ${error.channel.name}: ${error.error}`;
              },
            );
            throw new BadDataException(
              `Failed to send test message to some chats: ${errorMessages.join(
                "; ",
              )}`,
            );
          }

          for (const thread of res.threads) {
            const log: WorkspaceNotificationLog =
              new WorkspaceNotificationLog();
            log.projectId = data.projectId;
            log.workspaceType = res.workspaceType;
            log.channelId = thread.channel.id;
            log.channelName = thread.channel.name;
            log.threadId = thread.threadId;
            log.message =
              mdText`This is a test message for rule **${rule.name?.trim()}**`.toString();
            log.status = WorkspaceNotificationStatus.Success;
            log.statusMessage = "Test message posted to workspace chat";
            log.userId = data.testByUserId;
            log.actionType = WorkspaceNotificationActionType.SendMessage;

            await WorkspaceNotificationLogService.create({
              data: log,
              props: { isRoot: true },
            });
          }
        }
      } catch (err) {
        throw new BadDataException(
          "Cannot post message to chat. " + (err as Error)?.message,
        );
      }
    }
  }

  /*
   * Send one test notification to one destination - a Slack channel, a
   * Microsoft Teams channel or a Microsoft Teams chat - for the "Send Test"
   * button beside each destination in Project Settings > Workspace.
   *
   * testRule proves a rule; this proves a destination. An admin who has just
   * connected a workspace, or just added the bot to a channel, wants to know
   * the bot can actually post there before building rules on top of it. The
   * send deliberately goes through postMessageToAllWorkspaceChannelsAsBot,
   * the same bot delivery path real notifications take, so a success here
   * means a real notification to this destination would land too, and a
   * failure carries exactly what Slack or Microsoft said.
   *
   * The result of the send - success, a failure Slack or Microsoft reported,
   * or a send that silently went nowhere - is recorded in Notification Logs,
   * as testRule does, so support can see what happened.
   */
  @CaptureSpan()
  public async sendTestNotificationToDestination(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    testByUserId: ObjectID;
    channelId?: string | undefined; // Slack channel id, or Microsoft Teams channel id
    teamId?: string | undefined; // Microsoft Teams channels only: the team the channel is in
    chatId?: string | undefined; // Microsoft Teams chats only
  }): Promise<WorkspaceThread> {
    const channelId: string = this.normalizeTestDestinationId(data.channelId);
    const teamId: string = this.normalizeTestDestinationId(data.teamId);
    const chatId: string = this.normalizeTestDestinationId(data.chatId);

    /*
     * Validate before touching anything: a rejected request must not load
     * credentials, send, or write a Notification Log entry.
     */
    this.validateTestNotificationDestination({
      workspaceType: data.workspaceType,
      channelId: channelId,
      teamId: teamId,
      chatId: chatId,
    });

    const displayName: string = getWorkspaceTypeDisplayName(data.workspaceType);
    const isChat: boolean = Boolean(chatId);
    const destinationId: string = isChat ? chatId : channelId;

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    if (!projectAuth || !projectAuth.authToken) {
      throw new BadDataException(
        `This project is not connected to ${displayName}. Please go to Project Settings and connect ${displayName} first.`,
      );
    }

    /*
     * The destination's display name when we know it before sending: a chat's
     * comes from the chats captured when the bot was added, a Microsoft Teams
     * channel's from the team's channel listing checked below. Only a Slack
     * channel's name is left to come back from the send itself.
     */
    let destinationName: string = "";

    if (isChat) {
      /*
       * The SaaS bot is shared across tenants, so a project may only post to
       * the chats it captured itself. sendAdaptiveCardToChat enforces this
       * too; checking here gives a friendly error and avoids a pointless
       * send. hasOwnProperty rather than a plain index so an id such as
       * "__proto__" cannot resolve to something that is not a captured chat.
       */
      const connectedChats: Record<string, MicrosoftTeamsChat> =
        await this.getConnectedMicrosoftTeamsChats({
          projectId: data.projectId,
        });

      const chat: MicrosoftTeamsChat | undefined =
        Object.prototype.hasOwnProperty.call(connectedChats, chatId)
          ? connectedChats[chatId]
          : undefined;

      if (!chat) {
        throw new BadDataException(
          "This chat is no longer connected to OneUptime. Add the OneUptime app to the chat in Microsoft Teams, click Refresh Chats, and try again.",
        );
      }

      destinationName = chat.name || "";
    } else if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      /*
       * Tenant boundary for a Microsoft Teams channel. The SaaS bot identity is
       * shared across every customer tenant, so the caller's teamId and
       * channelId must be proven to belong to THIS project's tenant before
       * anything is posted. Neither the id format checks above nor the send
       * path prove that: getWorkspaceChannelFromChannelId falls back to
       * { id, name: id } whenever Graph refuses the lookup, and
       * sendAdaptiveCardToChannel only refuses a verified "not installed" -
       * this project's own installed teamId paired with a channelId pasted
       * from another tenant's Teams link skips Graph entirely. Without this
       * check a member of one project could have OneUptime post a card,
       * carrying their project name, into another customer's channel.
       *
       * So list the team's channels with this project's own app token - the
       * same Graph listing the Channels card shows - and require the channelId
       * to be an exact key of it. Graph refuses to list a team outside the
       * token's tenant, and the listing already skips shared channels, which
       * bots cannot post in. hasOwnProperty rather than a plain index so an id
       * such as "__proto__" cannot resolve to something that is not a listed
       * channel.
       */
      let teamChannels: Dictionary<WorkspaceChannel>;

      try {
        teamChannels = await MicrosoftTeamsUtil.getAllWorkspaceChannels({
          authToken: projectAuth.authToken,
          projectId: data.projectId,
          teamId: teamId,
        });
      } catch (err) {
        throw new BadDataException(
          `Could not load the channels of the selected team from Microsoft Teams. ${WorkspaceBase.getSendErrorMessage(err)}`.trim(),
        );
      }

      const teamChannel: WorkspaceChannel | undefined =
        Object.prototype.hasOwnProperty.call(teamChannels, channelId)
          ? teamChannels[channelId]
          : undefined;

      if (!teamChannel) {
        throw new BadDataException(
          "This channel was not found in the selected team. It may have been renamed or deleted, or it may be a shared channel, which Microsoft Teams does not let bots post in. Click Refresh Channels and try again.",
        );
      }

      destinationName = teamChannel.name || "";
    }

    const messageText: string = (
      await this.getTestNotificationMarkdown({
        projectId: data.projectId,
        testByUserId: data.testByUserId,
        destinationKind: isChat ? "chat" : "channel",
      })
    ).toString();

    const payload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      workspaceType: data.workspaceType,
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: messageText,
        } as WorkspacePayloadMarkdown,
      ],
      channelNames: [],
      channelIds: isChat ? [] : [channelId],
    };

    if (isChat) {
      payload.chatIds = [chatId];
    } else if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      // teamId is a Microsoft Teams channel concept; Slack and chats have none.
      payload.teamId = teamId;
    }

    let responses: Array<WorkspaceSendMessageResponse> = [];

    try {
      responses = await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: data.projectId,
        messagePayloadsByWorkspace: [payload],
      });
    } catch (err) {
      const reason: string = WorkspaceBase.getSendErrorMessage(err);

      /*
       * Downstream BadDataExceptions (for example "Team ID is required ...")
       * are already written for the user, so they are kept - but prefixed
       * once, so the admin knows it was the send that failed. A message that
       * already carries the prefix is passed through untouched.
       */
      if (reason.startsWith(TEST_NOTIFICATION_SEND_FAILED_PREFIX)) {
        throw err instanceof BadDataException
          ? err
          : new BadDataException(reason);
      }

      throw new BadDataException(
        `${TEST_NOTIFICATION_SEND_FAILED_PREFIX} ${reason}`.trim(),
      );
    }

    const response: WorkspaceSendMessageResponse | undefined = responses.find(
      (res: WorkspaceSendMessageResponse) => {
        return res.workspaceType === data.workspaceType;
      },
    );

    const errors: Array<{ channel: WorkspaceChannel; error: string }> =
      response?.errors || [];
    const threads: Array<WorkspaceThread> = response?.threads || [];

    if (errors.length > 0) {
      await this.logTestSendFailures({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        errors: errors,
        message: messageText,
        userId: data.testByUserId,
      });

      const destinationLabel: string = this.getTestDestinationLabel({
        workspaceType: data.workspaceType,
        isChat: isChat,
        name: destinationName || errors[0]?.channel?.name || "",
        id: destinationId,
      });

      const reasons: string = errors
        .map((error: { channel: WorkspaceChannel; error: string }) => {
          return error.error;
        })
        .join("; ");

      throw new BadDataException(
        `Could not send the test notification to ${destinationLabel}. ${reasons}`.trim(),
      );
    }

    const thread: WorkspaceThread | undefined = threads[0];

    if (!thread) {
      /*
       * Nothing sent and nothing reported. postMessageToAllWorkspaceChannelsAsBot
       * silently skips a workspace it cannot send as (a Slack connection with
       * no botUserId, for one). Reporting that as success is exactly the
       * failure mode testRule's comments warn about: a green result that
       * proves nothing. Treat it as a failure and record it.
       */
      const destinationLabel: string = this.getTestDestinationLabel({
        workspaceType: data.workspaceType,
        isChat: isChat,
        name: destinationName,
        id: destinationId,
      });

      const reason: string = `OneUptime could not send the test notification to ${destinationLabel}. Please reconnect ${displayName} from Project Settings and try again.`;

      const destination: WorkspaceChannel = {
        id: destinationId,
        name: destinationName || destinationId,
        workspaceType: data.workspaceType,
      };

      if (!isChat && data.workspaceType === WorkspaceType.MicrosoftTeams) {
        destination.teamId = teamId;
      }

      await this.logTestSendFailures({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        errors: [{ channel: destination, error: reason }],
        message: messageText,
        userId: data.testByUserId,
      });

      throw new BadDataException(reason);
    }

    /*
     * The notification has been delivered; failing to record that must not
     * turn a successful send into an error the admin would then chase.
     */
    try {
      const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
      log.projectId = data.projectId;
      log.workspaceType = data.workspaceType;
      // Column limits, as on the real-send path: an over-long value fails the whole insert.
      log.channelId = (thread.channel.id || "").substring(0, 100);
      log.channelName = (thread.channel.name || "").substring(0, 100);
      log.threadId = thread.threadId;
      log.message = messageText;
      log.status = WorkspaceNotificationStatus.Success;
      log.statusMessage = "Test notification sent from Project Settings";
      log.userId = data.testByUserId;
      log.actionType = WorkspaceNotificationActionType.SendMessage;

      await WorkspaceNotificationLogService.create({
        data: log,
        props: { isRoot: true },
      });
    } catch (err) {
      logger.error(
        "Could not write test notification success to notification log:",
      );
      logger.error(err);
    }

    return thread;
  }

  // Trimmed id, or "" when missing or not a string.
  private normalizeTestDestinationId(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  /*
   * Reject a test-notification request that could never be delivered, or that
   * would put an unsafe id into a downstream URL. Throws BadDataException with
   * a message meant for the user.
   */
  private validateTestNotificationDestination(data: {
    workspaceType: WorkspaceType;
    channelId: string;
    teamId: string;
    chatId: string;
  }): void {
    if (
      data.workspaceType !== WorkspaceType.Slack &&
      data.workspaceType !== WorkspaceType.MicrosoftTeams &&
      data.workspaceType !== WorkspaceType.Mattermost
    ) {
      throw new BadDataException(
        "Test notifications can only be sent to Slack, Microsoft Teams or Mattermost.",
      );
    }

    if (!data.channelId && !data.chatId) {
      throw new BadDataException(
        "Please choose a channel or a chat to send the test notification to.",
      );
    }

    if (data.channelId && data.chatId) {
      throw new BadDataException(
        "Please choose either a channel or a chat, not both.",
      );
    }

    if (data.chatId) {
      if (data.workspaceType !== WorkspaceType.MicrosoftTeams) {
        throw new BadDataException(
          `Chats are only supported for Microsoft Teams. Please choose a ${getWorkspaceTypeDisplayName(data.workspaceType)} channel.`,
        );
      }

      if (data.chatId.length > TEST_NOTIFICATION_MAX_CHAT_ID_LENGTH) {
        throw new BadDataException("The Microsoft Teams chat id is not valid.");
      }

      return;
    }

    if (data.workspaceType === WorkspaceType.Slack) {
      if (!SLACK_CHANNEL_ID_REGEX.test(data.channelId)) {
        throw new BadDataException("The Slack channel id is not valid.");
      }

      return;
    }

    /*
     * A Mattermost channel id is placed in the path of the calls that post
     * to it, with the bot's token: only an id Mattermost could have made.
     */
    if (data.workspaceType === WorkspaceType.Mattermost) {
      if (!MattermostConnection.isMattermostId(data.channelId)) {
        throw new BadDataException("The Mattermost channel id is not valid.");
      }

      return;
    }

    if (!data.teamId) {
      throw new BadDataException(
        "Please select the team this channel belongs to.",
      );
    }

    /*
     * Both ids are interpolated unencoded into Microsoft Graph URL paths:
     * the teamId into the channel listing (/teams/{teamId}/channels) that
     * proves the channel is in this project's tenant, and both into
     * MicrosoftTeams.getWorkspaceChannelFromChannelId
     * (/teams/{teamId}/channels/{channelId}). A "/", "?", "#", "%" or "\" -
     * or whitespace / control characters, or a value made only of dots,
     * which URL normalisation resolves as "." / ".." path traversal
     * (/teams/T/channels/.. becomes /teams/T/) - would let the caller steer
     * that request at a different Graph resource using the project's app
     * token. Real Teams ids (GUIDs, "19:...@thread.tacv2") never look like
     * that.
     */
    if (!this.isSafeMicrosoftGraphPathSegment(data.teamId)) {
      throw new BadDataException("The Microsoft Teams team id is not valid.");
    }

    if (!this.isSafeMicrosoftGraphPathSegment(data.channelId)) {
      throw new BadDataException(
        "The Microsoft Teams channel id is not valid.",
      );
    }
  }

  private isSafeMicrosoftGraphPathSegment(value: string): boolean {
    if (value.length > TEST_NOTIFICATION_MAX_GRAPH_ID_LENGTH) {
      return false;
    }

    if (GRAPH_PATH_SEGMENT_FORBIDDEN_CHARS_REGEX.test(value)) {
      return false;
    }

    // "." and ".." (or any run of dots) are dot segments, not ids.
    if (GRAPH_PATH_DOT_SEGMENT_REGEX.test(value)) {
      return false;
    }

    /*
     * \s does not cover every control character, and a regex literal with raw
     * control-character escapes trips no-control-regex, so check char codes:
     * C0 controls, DEL and C1 controls.
     */
    for (let i: number = 0; i < value.length; i++) {
      const charCode: number = value.charCodeAt(i);

      if (charCode < 0x20 || (charCode >= 0x7f && charCode <= 0x9f)) {
        return false;
      }
    }

    return true;
  }

  /*
   * The markdown body of a destination test notification. Naming the project
   * and the person who pressed the button tells whoever sees it in a shared
   * channel where it came from. Both lookups are best-effort: a lookup
   * failure only drops that fragment, it never blocks the send.
   */
  @CaptureSpan()
  private async getTestNotificationMarkdown(data: {
    projectId: ObjectID;
    testByUserId: ObjectID;
    destinationKind: "channel" | "chat";
  }): Promise<MarkdownText> {
    let projectName: string = "";

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      projectName = project?.name?.trim() || "";
    } catch (err) {
      logger.error("Could not load project name for test notification:");
      logger.error(err);
    }

    let userMarkdown: MarkdownText = FeedMarkdown.empty();

    try {
      userMarkdown = await UserService.getUserMarkdownString({
        userId: data.testByUserId,
        projectId: data.projectId,
      });
    } catch (err) {
      logger.error("Could not load user for test notification:");
      logger.error(err);
    }

    // The project's name is plain text in a Markdown message.
    const fromProject: MarkdownText = projectName
      ? mdText` from the OneUptime project **${projectName}**`
      : FeedMarkdown.empty();

    const byUser: MarkdownText = userMarkdown.isEmpty()
      ? FeedMarkdown.empty()
      : mdText` by ${userMarkdown}`;

    return mdText`**Test notification from OneUptime**\n\nThis is a test notification sent${fromProject}${byUser}. If you can see this message, OneUptime can post notifications to this ${data.destinationKind}. No action is needed.`;
  }

  /*
   * How a destination is named in a user-facing error: #name for a Slack
   * channel, the name in double quotes for a Microsoft Teams channel or chat.
   * Falls back to the id when no name is known.
   */
  private getTestDestinationLabel(data: {
    workspaceType: WorkspaceType;
    isChat: boolean;
    name: string;
    id: string;
  }): string {
    const label: string = data.name.trim() || data.id;

    if (data.workspaceType === WorkspaceType.Slack && !data.isChat) {
      return `#${label}`;
    }

    if (data.workspaceType === WorkspaceType.Mattermost) {
      return `~${label}`;
    }

    return `"${label}"`;
  }

  /*
   * The markdown of a test message, for the Notification Log entry.
   */
  private getTestMessageSummary(data: {
    messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType>;
    workspaceType: WorkspaceType;
  }): string {
    const blocks: Array<WorkspaceMessageBlock> | undefined =
      data.messageBlocksByWorkspaceTypes.find(
        (b: MessageBlocksByWorkspaceType) => {
          return b.workspaceType === data.workspaceType;
        },
      )?.messageBlocks;

    if (!blocks) {
      return "";
    }

    const texts: Array<string> = [];

    for (const block of blocks) {
      if (
        (block as WorkspacePayloadMarkdown)._type === "WorkspacePayloadMarkdown"
      ) {
        texts.push((block as WorkspacePayloadMarkdown).text);
      }
    }

    return texts.join(" \n").trim();
  }

  /*
   * Post one test message to one set of destinations, then record the outcome in
   * Notification Logs.
   *
   * Created channels and existing channels ran two byte-identical copies of
   * this, which is how the created-channel copy ended up nested in the wrong
   * conditional without anyone noticing. One path now serves both.
   */
  @CaptureSpan()
  private async postTestMessageToChannels(data: {
    projectId: ObjectID;
    messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType>;
    testByUserId: ObjectID;
    channelNames: Array<string>;
    channelIds: Array<string>;
    teamId?: string | undefined;
  }): Promise<void> {
    try {
      const responses: Array<WorkspaceSendMessageResponse> =
        await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
          projectId: data.projectId,
          messagePayloadsByWorkspace: data.messageBlocksByWorkspaceTypes.map(
            (messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType) => {
              const payload: WorkspaceMessagePayload = {
                _type: "WorkspaceMessagePayload",
                workspaceType: messageBlocksByWorkspaceType.workspaceType,
                messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
                channelNames: data.channelNames,
                channelIds: data.channelIds,
              };

              /*
               * The team of a Microsoft Teams channel - and, for Slack
               * installed for a whole Enterprise organization and for
               * Mattermost, the workspace or the team a channel named by a
               * rule is in (SlackOrganization, MattermostTeams).
               */
              if (
                messageBlocksByWorkspaceType.workspaceType ===
                  WorkspaceType.MicrosoftTeams ||
                ((messageBlocksByWorkspaceType.workspaceType ===
                  WorkspaceType.Slack ||
                  messageBlocksByWorkspaceType.workspaceType ===
                    WorkspaceType.Mattermost) &&
                  data.teamId &&
                  data.channelNames.length > 0)
              ) {
                payload.teamId = data.teamId;
              }

              return payload;
            },
          ),
        });

      for (const res of responses) {
        const messageSummary: string = this.getTestMessageSummary({
          messageBlocksByWorkspaceTypes: data.messageBlocksByWorkspaceTypes,
          workspaceType: res.workspaceType,
        });

        // Check for errors in the response
        if (res.errors && res.errors.length > 0) {
          /*
           * Record the failure before throwing. Test sends used to throw
           * straight out of here, so a failed test left no trace in
           * Notification Logs and support had no way to see what Microsoft
           * or Slack actually said.
           */
          await this.logTestSendFailures({
            projectId: data.projectId,
            workspaceType: res.workspaceType,
            errors: res.errors,
            message: messageSummary,
            userId: data.testByUserId,
          });

          const errorMessages: Array<string> = res.errors.map(
            (error: { channel: WorkspaceChannel; error: string }) => {
              return `Channel ${error.channel.name}: ${error.error}`;
            },
          );

          throw new BadDataException(
            `Failed to send test message to some channels: ${errorMessages.join(
              "; ",
            )}`,
          );
        }

        for (const thread of res.threads) {
          const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
          log.projectId = data.projectId;
          log.workspaceType = res.workspaceType;
          log.channelId = thread.channel.id;
          log.channelName = thread.channel.name;
          log.threadId = thread.threadId;
          log.message = messageSummary;
          log.status = WorkspaceNotificationStatus.Success;
          log.statusMessage = "Test message posted to workspace channel";
          log.userId = data.testByUserId;
          log.actionType = WorkspaceNotificationActionType.SendMessage;

          await WorkspaceNotificationLogService.create({
            data: log,
            props: { isRoot: true },
          });
        }
      }
    } catch (err) {
      throw new BadDataException(
        "Cannot post message to channel. " + (err as Error)?.message,
      );
    }
  }

  /*
   * Persist per-destination failures from a test send so they show up in
   * Settings > Notification Logs alongside real notification failures. Real
   * sends already log; test sends threw before reaching any logging, which
   * meant the one action an admin takes to diagnose a broken integration was
   * also the only one that recorded nothing.
   *
   * Best-effort: a logging failure must never mask the underlying send error.
   */
  @CaptureSpan()
  private async logTestSendFailures(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    errors: Array<{ channel: WorkspaceChannel; error: string }>;
    message: string;
    userId: ObjectID;
  }): Promise<void> {
    for (const error of data.errors) {
      try {
        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.projectId = data.projectId;
        log.workspaceType = data.workspaceType;
        /*
         * Truncated to the column limits, as the real-send path does. The
         * insert rejects any over-long field, and the catch below would then
         * drop the row silently - Microsoft's "app is not installed in this
         * team" explanation alone runs past the 500-character statusMessage.
         * The user-facing error keeps the full text.
         */
        log.channelId = (error.channel.id || "").substring(0, 100);
        log.channelName = (error.channel.name || "").substring(0, 100);
        log.message = data.message;
        log.status = WorkspaceNotificationStatus.Error;
        log.statusMessage = (error.error || "Failed to send message").substring(
          0,
          500,
        );
        log.userId = data.userId;
        log.actionType = WorkspaceNotificationActionType.SendMessage;

        await WorkspaceNotificationLogService.create({
          data: log,
          props: { isRoot: true },
        });
      } catch (err) {
        logger.error("Could not write test-send failure to notification log:");
        logger.error(err);
      }
    }
  }

  /*
   * Archives the record's own channels whose rule says "Archive the channel
   * when the incident is resolved" (and the like for other records), once
   * the record is over. A channel is its rule's from the moment it is
   * created, so it is archived as its own rule says, whatever the record's
   * conditions say by then: a rule for Critical incidents archives its
   * channel even after the severity was lowered, and a rule for
   * acknowledged incidents once the incident is resolved. This used to ask
   * the rules matching the record at the end, so such a channel stayed
   * open, and one matching rule that archives took every channel of the
   * record with it, those of rules that keep theirs too.
   */
  @CaptureSpan()
  public async archiveWorkspaceChannels(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
  }): Promise<void> {
    const workspaceTypes: Array<WorkspaceType> = Service.getAllWorkspaceTypes();

    for (const workspaceType of workspaceTypes) {
      const recordChannels: Array<WorkspaceChannel> =
        await this.getWorkspaceChannelsByNotificationFor({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: workspaceType,
        });

      if (recordChannels.length === 0) {
        continue; // check next workspace type.
      }

      const notificationRules: Array<WorkspaceNotificationRule> =
        await this.getNotificationRules({
          projectId: data.projectId,
          workspaceType: workspaceType,
          notificationRuleEventType: this.getNotificationRuleEventType(
            data.notificationFor,
          ),
        });

      const channels: Array<WorkspaceChannel> = recordChannels.filter(
        (channel: WorkspaceChannel): boolean => {
          return notificationRules.some(
            (notificationRule: WorkspaceNotificationRule): boolean => {
              const rule: CreateChannelNotificationRule | undefined =
                notificationRule.notificationRule as
                  | CreateChannelNotificationRule
                  | undefined;

              return (
                Boolean(rule?.archiveChannelAutomatically) &&
                NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
                  channel: channel as Partial<NotificationRuleWorkspaceChannel>,
                  notificationRuleId: notificationRule.id?.toString(),
                })
              );
            },
          );
        },
      );

      if (channels.length === 0) {
        continue; // check next workspace type.
      }

      const channelIds: Array<string> = channels.map(
        (channel: WorkspaceChannel) => {
          return channel.id;
        },
      );

      // get project auth token.
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.findOneBy({
          query: {
            projectId: data.projectId,
            workspaceType: workspaceType,
          },
          select: {
            authToken: true,
            miscData: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!projectAuth || !projectAuth.authToken) {
        logger.debug("No project auth found for workspace type", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        continue;
      }

      await WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).archiveChannels({
        authToken: projectAuth.authToken!,
        channelIds: channelIds,
        userId: this.getBotUserIdFromprojectAuthToken({
          projectAuthToken: projectAuth,
          workspaceType: workspaceType,
        }),
        sendMessageBeforeArchiving: data.sendMessageBeforeArchiving,
        projectId: data.projectId,
      });
    }
  }

  /*
   * Whether the project has a Slack or Microsoft Teams workspace connected
   * that OneUptime can post as: one whose connection holds a token. Without
   * one, every post, channel and send log of the project is skipped, so the
   * work of finding what to post can be too.
   */
  @CaptureSpan()
  public async hasConnectedWorkspace(projectId: ObjectID): Promise<boolean> {
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      (await WorkspaceProjectAuthTokenService.getProjectAuths({
        projectId: projectId,
      })) || [];

    return projectAuths.some(
      (projectAuth: WorkspaceProjectAuthToken): boolean => {
        return Boolean(projectAuth.authToken && projectAuth.workspaceType);
      },
    );
  }

  @CaptureSpan()
  public async sendWorkspaceMarkdownNotification(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    feedInfoInMarkdown: string;
    /*
     * What the message's notification shows, as plain text
     * (WorkspaceMessagePayload.text). Without it, a Slack notification has
     * nothing to show and Microsoft Teams says only that a card was sent.
     */
    notificationText?: string | undefined;
    workspaceNotification: {
      /*
       * Who did what the message says, as a OneUptime user id: their name
       * leads the message (WorkspaceUtil.getMessageBlocksByMarkdown), and
       * its Notification Logs rows name them as who sent it. The author of
       * the feed item the message posts - never the person it is about.
       */
      authorUserId?: ObjectID | undefined;
      // The project API key that did it, when no person did: its name leads.
      authorApiKeyName?: string | undefined;
      sendWorkspaceNotification: boolean;
      appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
      // Not posted in this channel (WorkspaceChannelToSkip).
      exceptChannel?: WorkspaceChannelToSkip | undefined;
      /*
       * Which updates the message is (NotificationRuleUpdates): it is
       * posted only in the channels and chats whose rules want one of them.
       * Left out, wherever the record's messages go.
       */
      updateKinds?: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
    };
  }): Promise<void> {
    /*
     * A project with no Slack or Microsoft Teams connected has nowhere to
     * post: nothing below could open a channel, send a message or log a
     * send. Asked once, up front - every feed entry of every record comes
     * here (a bulk Resolve of thousands of alerts, one each), and the rules,
     * destinations and author names below took about fifteen reads every
     * time to find there was nothing to do.
     */
    let isWorkspaceConnected: boolean = true;

    try {
      isWorkspaceConnected = await this.hasConnectedWorkspace(data.projectId);
    } catch (err) {
      // Not known: carry on as if one were, and let the steps below decide.
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
    }

    if (!isWorkspaceConnected) {
      return;
    }

    let messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> = [];
    const exceptChannel: WorkspaceChannelToSkip | undefined =
      data.workspaceNotification.exceptChannel;

    /*
     * Something about the record is being posted, so it may have changed:
     * a rule that matches it now for the first time opens its channel
     * first, and the message is posted there too.
     */
    await this.createChannelsForRulesThatNowMatch({
      projectId: data.projectId,
      notificationFor: data.notificationFor,
    });

    // use markdown to create blocks
    messageBlocksByWorkspaceTypes =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        userId: data.workspaceNotification.authorUserId,
        apiKeyName: data.workspaceNotification.authorApiKeyName,
        markdown: data.feedInfoInMarkdown,
        projectId: data.projectId,
      });

    if (data.workspaceNotification.appendMessageBlocks) {
      for (const messageBlocksByWorkspaceType of data.workspaceNotification
        .appendMessageBlocks) {
        const workspaceType: WorkspaceType =
          messageBlocksByWorkspaceType.workspaceType;

        messageBlocksByWorkspaceTypes
          .find(
            (messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType) => {
              return (
                messageBlocksByWorkspaceType.workspaceType === workspaceType
              );
            },
          )
          ?.messageBlocks.push(...messageBlocksByWorkspaceType.messageBlocks);
      }
    }

    const workspaceNotificationPaylaods: Array<WorkspaceMessagePayload> = [];

    for (const messageBlocksByWorkspaceType of messageBlocksByWorkspaceTypes) {
      const destinations: Array<WorkspaceMessagePayload> =
        await this.getMessageDestinations({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: messageBlocksByWorkspaceType.workspaceType,
          updateKinds: data.workspaceNotification.updateKinds,
        });

      for (const destination of destinations) {
        const isSkippingHere: boolean = Boolean(
          exceptChannel &&
            exceptChannel.channelId &&
            exceptChannel.workspaceType ===
              messageBlocksByWorkspaceType.workspaceType,
        );

        // A record's own channel, named by id, is simply not posted to.
        if (
          isSkippingHere &&
          destination.channelIds.length > 0 &&
          destination.channelIds.every((channelId: string): boolean => {
            return channelId === exceptChannel!.channelId;
          }) &&
          destination.channelNames.length === 0 &&
          (destination.chatIds || []).length === 0
        ) {
          continue;
        }

        /*
         * What a phone shows for the post: the caller's own line, or the
         * start of what the post says (WorkspaceNotificationText) - a
         * record's created message, a state change and a note used to
         * buzz with nothing to read.
         */
        const notificationText: string | undefined =
          data.notificationText ||
          WorkspaceNotificationText.fromBlocks(
            messageBlocksByWorkspaceType.messageBlocks,
          );

        workspaceNotificationPaylaods.push({
          ...destination,
          messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
          ...(notificationText ? { text: notificationText } : {}),
          /*
           * A channel named by its name is found only when the message is
           * sent: the sender leaves it out then (exceptChannelIds).
           */
          ...(isSkippingHere
            ? { exceptChannelIds: [exceptChannel!.channelId] }
            : {}),
        });
      }
    }

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: data.projectId,
        messagePayloadsByWorkspace: workspaceNotificationPaylaods,
      });

    await this.logSendResponses({
      projectId: data.projectId,
      notificationFor: data.notificationFor,
      responses: responses,
      messageBlocksByWorkspaceTypes: messageBlocksByWorkspaceTypes,
      authorUserId: data.workspaceNotification.authorUserId,
    });
  }

  /*
   * Every place a message about a record goes in one workspace, one payload
   * per destination: the channels OneUptime created for the record (by id:
   * a channel's name can change), the existing channels its matching rules
   * name (by name), and - Microsoft Teams only - the chats those rules name.
   * The payloads carry no blocks; the caller adds what to say.
   *
   * A message that says which updates it is (updateKinds) goes only where
   * a rule wants one of them (NotificationRuleUpdates): a record's channel
   * when a rule it was created for does, an existing channel or chat when a
   * matching rule that names it does.
   */
  @CaptureSpan()
  public async getMessageDestinations(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
    updateKinds?: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): Promise<Array<WorkspaceMessagePayload>> {
    const destinations: Array<WorkspaceMessagePayload> = [];

    const existingChannels: Array<WorkspaceChannel> =
      await this.getExistingChannelNamesBasedOnEventType({
        projectId: data.projectId,
        notificationRuleEventType: this.getNotificationRuleEventType(
          data.notificationFor,
        ),
        workspaceType: data.workspaceType,
        notificationFor: data.notificationFor,
        updateKinds: data.updateKinds,
      });

    const recordChannels: Array<WorkspaceChannel> =
      await this.getRecordChannelsWantingUpdate({
        projectId: data.projectId,
        notificationFor: data.notificationFor,
        workspaceType: data.workspaceType,
        updateKinds: data.updateKinds,
      });

    for (const recordChannel of recordChannels) {
      destinations.push({
        _type: "WorkspaceMessagePayload",
        workspaceType: data.workspaceType,
        messageBlocks: [],
        channelNames: [],
        channelIds: [recordChannel.id], // we use channel ids here as channel names can change,
        teamId: recordChannel.teamId,
      });
    }

    for (const existingChannel of existingChannels) {
      destinations.push({
        _type: "WorkspaceMessagePayload",
        workspaceType: data.workspaceType,
        messageBlocks: [],
        channelNames: [existingChannel.name],
        channelIds: [], // we use channel names here as we don't have channel ids.
        teamId: existingChannel.teamId,
      });
    }

    // Microsoft Teams chats (group / personal chats the OneUptime app was added to).
    const existingChatIds: Array<string> =
      await this.getExistingChatIdsBasedOnEventType({
        projectId: data.projectId,
        notificationRuleEventType: this.getNotificationRuleEventType(
          data.notificationFor,
        ),
        workspaceType: data.workspaceType,
        notificationFor: data.notificationFor,
        updateKinds: data.updateKinds,
      });

    for (const chatId of existingChatIds) {
      destinations.push({
        _type: "WorkspaceMessagePayload",
        workspaceType: data.workspaceType,
        messageBlocks: [],
        channelNames: [],
        channelIds: [],
        chatIds: [chatId],
      });
    }

    return destinations;
  }

  /*
   * A Notification Logs row for every channel a message about a record
   * reached, and for every one it failed to reach - otherwise a chat or
   * channel send that errors (e.g. the OneUptime app was removed from a chat
   * a rule still references) is invisible in the notification logs. Every
   * row names the record the message is about: a record's Notification Logs
   * page lists its workspace logs by the record's id.
   */
  @CaptureSpan()
  public async logSendResponses(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    responses: Array<WorkspaceSendMessageResponse>;
    messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType>;
    // Who did what the message says: each row's User, who sent it.
    authorUserId?: ObjectID | undefined;
  }): Promise<void> {
    const getMessageSummary: (wt: WorkspaceType) => string = (
      wt: WorkspaceType,
    ): string => {
      const blocks: Array<WorkspaceMessageBlock> | undefined =
        data.messageBlocksByWorkspaceTypes.find(
          (b: MessageBlocksByWorkspaceType) => {
            return b.workspaceType === wt;
          },
        )?.messageBlocks;
      if (!blocks) {
        return "";
      }
      const texts: Array<string> = [];
      for (const block of blocks) {
        if (
          (block as WorkspacePayloadMarkdown)._type ===
          "WorkspacePayloadMarkdown"
        ) {
          texts.push((block as WorkspacePayloadMarkdown).text);
        }
      }
      /*
       * A moment a message names in each reader's own time reads as its
       * time in UTC here: the log shows no workspace's own formatting.
       */
      const joined: string = WorkspaceMessageTime.toPlainText(
        texts.join(" \n").trim(),
      );
      return joined;
    };

    for (const res of data.responses) {
      const messageSummary: string = getMessageSummary(res.workspaceType);

      for (const thread of res.threads) {
        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.projectId = data.projectId;
        log.workspaceType = res.workspaceType;
        log.channelId = (thread.channel.id || "").substring(0, 100);
        log.channelName = (thread.channel.name || "").substring(0, 100);
        log.threadId = thread.threadId;
        log.message = messageSummary;
        log.status = WorkspaceNotificationStatus.Success;
        log.actionType = WorkspaceNotificationActionType.SendMessage;
        log.statusMessage = "Message posted to workspace channel";

        if (data.notificationFor.incidentId) {
          log.incidentId = data.notificationFor.incidentId;
        }
        if (data.notificationFor.alertId) {
          log.alertId = data.notificationFor.alertId;
        }
        if (data.notificationFor.scheduledMaintenanceId) {
          log.scheduledMaintenanceId =
            data.notificationFor.scheduledMaintenanceId;
        }
        if (data.notificationFor.incidentEpisodeId) {
          log.incidentEpisodeId = data.notificationFor.incidentEpisodeId;
        }
        if (data.notificationFor.alertEpisodeId) {
          log.alertEpisodeId = data.notificationFor.alertEpisodeId;
        }
        if (data.notificationFor.monitorId) {
          log.monitorId = data.notificationFor.monitorId;
        }
        if (data.notificationFor.onCallDutyPolicyId) {
          log.onCallDutyPolicyId = data.notificationFor.onCallDutyPolicyId;
        }

        if (data.authorUserId) {
          log.userId = data.authorUserId;
        }

        await WorkspaceNotificationLogService.create({
          data: log,
          props: { isRoot: true },
        });
      }

      /*
       * Also log per-destination failures — otherwise a chat or channel
       * send that errors (e.g. the OneUptime app was removed from a chat a
       * rule still references) is invisible in the notification logs.
       */
      for (const sendError of res.errors || []) {
        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.projectId = data.projectId;
        log.workspaceType = res.workspaceType;
        log.channelId = (sendError.channel.id || "").substring(0, 100);
        log.channelName = (sendError.channel.name || "").substring(0, 100);
        log.message = messageSummary;
        log.status = WorkspaceNotificationStatus.Error;
        log.actionType = WorkspaceNotificationActionType.SendMessage;
        log.statusMessage = (sendError.error || "Failed to send message")
          .toString()
          .substring(0, 500);

        if (data.notificationFor.incidentId) {
          log.incidentId = data.notificationFor.incidentId;
        }
        if (data.notificationFor.alertId) {
          log.alertId = data.notificationFor.alertId;
        }
        if (data.notificationFor.scheduledMaintenanceId) {
          log.scheduledMaintenanceId =
            data.notificationFor.scheduledMaintenanceId;
        }
        if (data.notificationFor.incidentEpisodeId) {
          log.incidentEpisodeId = data.notificationFor.incidentEpisodeId;
        }
        if (data.notificationFor.alertEpisodeId) {
          log.alertEpisodeId = data.notificationFor.alertEpisodeId;
        }
        if (data.notificationFor.monitorId) {
          log.monitorId = data.notificationFor.monitorId;
        }
        if (data.notificationFor.onCallDutyPolicyId) {
          log.onCallDutyPolicyId = data.notificationFor.onCallDutyPolicyId;
        }

        if (data.authorUserId) {
          log.userId = data.authorUserId;
        }

        await WorkspaceNotificationLogService.create({
          data: log,
          props: { isRoot: true },
        });
      }
    }
  }

  private async getWorkspaceChannelsByNotificationFor(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("getWorkspaceChannelsByNotificationFor called with data:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(JSON.stringify(data, null, 2), {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    let monitorChannels: Array<WorkspaceChannel> = [];

    if (data.notificationFor.monitorId) {
      monitorChannels = await MonitorService.getWorkspaceChannelForMonitor({
        monitorId: data.notificationFor.monitorId,
        workspaceType: data.workspaceType,
      });
    }

    if (data.notificationFor.onCallDutyPolicyId) {
      monitorChannels =
        await OnCallDutyPolicyService.getWorkspaceChannelForOnCallDutyPolicy({
          onCallDutyPolicyId: data.notificationFor.onCallDutyPolicyId,
          workspaceType: data.workspaceType,
        });
    }

    // incidents
    if (data.notificationFor.incidentId) {
      monitorChannels = await IncidentService.getWorkspaceChannelForIncident({
        incidentId: data.notificationFor.incidentId,
        workspaceType: data.workspaceType,
      });
    }

    // alerts
    if (data.notificationFor.alertId) {
      monitorChannels = await AlertService.getWorkspaceChannelForAlert({
        alertId: data.notificationFor.alertId,
        workspaceType: data.workspaceType,
      });
    }

    // scheduled maintenance
    if (data.notificationFor.scheduledMaintenanceId) {
      monitorChannels =
        await ScheduledMaintenanceService.getWorkspaceChannelForScheduledMaintenance(
          {
            scheduledMaintenanceId: data.notificationFor.scheduledMaintenanceId,
            workspaceType: data.workspaceType,
          },
        );
    }

    // incident episodes
    if (data.notificationFor.incidentEpisodeId) {
      monitorChannels =
        await IncidentEpisodeService.getWorkspaceChannelForEpisode({
          episodeId: data.notificationFor.incidentEpisodeId,
          workspaceType: data.workspaceType,
        });
    }

    // alert episodes
    if (data.notificationFor.alertEpisodeId) {
      monitorChannels = await AlertEpisodeService.getWorkspaceChannelForEpisode(
        {
          episodeId: data.notificationFor.alertEpisodeId,
          workspaceType: data.workspaceType,
        },
      );
    }

    logger.debug("Workspace channels found:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(monitorChannels, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return monitorChannels;
  }

  /*
   * The channels OneUptime created for the record in one workspace that a
   * message of these updates is posted in: each one a rule it was created
   * for wants it in (NotificationRuleUpdates.isWantedInChannel). A channel
   * stored before its rules were recorded, or whose rules were all deleted
   * since, gets every message. The project's rules are read only when the
   * message is not one every rule posts and a channel names its rules.
   */
  private async getRecordChannelsWantingUpdate(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
    updateKinds?: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): Promise<Array<WorkspaceChannel>> {
    const recordChannels: Array<
      WorkspaceChannel &
        Partial<
          Pick<
            NotificationRuleWorkspaceChannel,
            "notificationRuleId" | "notificationRuleIds"
          >
        >
    > = await this.getWorkspaceChannelsByNotificationFor({
      projectId: data.projectId,
      notificationFor: data.notificationFor,
      workspaceType: data.workspaceType,
    });

    if (
      recordChannels.length === 0 ||
      NotificationRuleUpdates.isPostedEverywhere(data.updateKinds)
    ) {
      return recordChannels;
    }

    const namesItsRules: boolean = recordChannels.some(
      (
        channel: Partial<
          Pick<
            NotificationRuleWorkspaceChannel,
            "notificationRuleId" | "notificationRuleIds"
          >
        >,
      ): boolean => {
        return (
          Boolean(channel.notificationRuleId) ||
          (Array.isArray(channel.notificationRuleIds) &&
            channel.notificationRuleIds.length > 0)
        );
      },
    );

    if (!namesItsRules) {
      return recordChannels;
    }

    const rules: Array<RuleOfChannel> = (
      await this.getNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: this.getNotificationRuleEventType(
          data.notificationFor,
        ),
      })
    )
      .filter((rule: WorkspaceNotificationRule): boolean => {
        return Boolean(rule.id);
      })
      .map((rule: WorkspaceNotificationRule): RuleOfChannel => {
        return {
          id: rule.id!.toString(),
          rule: rule.notificationRule as BaseNotificationRule | undefined,
        };
      });

    return recordChannels.filter(
      (
        channel: WorkspaceChannel &
          Partial<
            Pick<
              NotificationRuleWorkspaceChannel,
              "notificationRuleId" | "notificationRuleIds"
            >
          >,
      ): boolean => {
        return NotificationRuleUpdates.isWantedInChannel({
          channel: channel,
          rules: rules,
          updateKinds: data.updateKinds,
        });
      },
    );
  }

  private getNotificationRuleEventType(
    notificationFor: NotificationFor,
  ): NotificationRuleEventType {
    if (notificationFor.alertId) {
      return NotificationRuleEventType.Alert;
    }

    if (notificationFor.incidentId) {
      return NotificationRuleEventType.Incident;
    }

    if (notificationFor.alertEpisodeId) {
      return NotificationRuleEventType.AlertEpisode;
    }

    if (notificationFor.incidentEpisodeId) {
      return NotificationRuleEventType.IncidentEpisode;
    }

    if (notificationFor.monitorId) {
      return NotificationRuleEventType.Monitor;
    }

    if (notificationFor.onCallDutyPolicyId) {
      return NotificationRuleEventType.OnCallDutyPolicy;
    }

    if (notificationFor.scheduledMaintenanceId) {
      return NotificationRuleEventType.ScheduledMaintenance;
    }

    if (notificationFor.securityCaseId) {
      return NotificationRuleEventType.SecurityCase;
    }

    if (notificationFor.securityHuntId) {
      return NotificationRuleEventType.SecurityHunt;
    }

    if (notificationFor.serviceLevelObjectiveId) {
      return NotificationRuleEventType.ServiceLevelObjective;
    }

    throw new BadDataException("Notification for not found");
  }

  @CaptureSpan()
  public static getAllWorkspaceTypes(): Array<WorkspaceType> {
    return [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ];
  }

  public getBotUserIdFromprojectAuthToken(data: {
    projectAuthToken: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
  }): string {
    const miscData: MiscData | undefined = data.projectAuthToken.miscData;

    if (!miscData) {
      throw new BadDataException("Misc data not found in project auth token");
    }

    if (
      data.workspaceType === WorkspaceType.Slack ||
      data.workspaceType === WorkspaceType.Mattermost
    ) {
      const userId: string = (miscData as SlackMiscData | MattermostMiscData)
        .botUserId;

      if (!userId) {
        throw new BadDataException(
          "Bot user ID not found in project auth token",
        );
      }

      return userId;
    }

    throw new BadDataException("Workspace type not supported");
  }

  /*
   * The existing channels the record's matching rules name. With
   * updateKinds, only those of the rules that want one of those updates
   * (NotificationRuleUpdates.wantsUpdate): a channel two rules name gets the
   * message when either wants it.
   */
  @CaptureSpan()
  public async getExistingChannelNamesBasedOnEventType(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    updateKinds?: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("getExistingChannelNamesBasedOnEventType called with data:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const notificationRules: Array<WorkspaceNotificationRule> = (
      await this.getMatchingNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: data.notificationRuleEventType,
        notificationFor: data.notificationFor,
      })
    ).filter((rule: WorkspaceNotificationRule): boolean => {
      return NotificationRuleUpdates.wantsUpdate({
        rule: rule.notificationRule as BaseNotificationRule | undefined,
        updateKinds: data.updateKinds,
      });
    });

    logger.debug("Notification rules retrieved:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(notificationRules, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const rules: Array<BaseNotificationRule> = notificationRules.map(
      (rule: WorkspaceNotificationRule) => {
        return rule.notificationRule as BaseNotificationRule;
      },
    );

    /*
     * Slack and Mattermost: the project's connection, when a rule names the
     * workspace or the team its channels are in - two rules may name one
     * channel name in two workspaces of an Enterprise organization, or two
     * teams of a Mattermost server (SlackOrganization, MattermostTeams).
     * Read only then; unread, a name is one channel, as before.
     */
    let projectAuth: WorkspaceProjectAuthToken | null = null;

    if (
      (data.workspaceType === WorkspaceType.Slack ||
        data.workspaceType === WorkspaceType.Mattermost) &&
      rules.some((rule: BaseNotificationRule): boolean => {
        return Boolean(rule.shouldPostToExistingChannel && rule.existingTeam);
      })
    ) {
      try {
        projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
        });
      } catch (err) {
        logger.error(
          `Could not read the project's ${data.workspaceType} connection.`,
          {
            projectId: data.projectId?.toString(),
          } as LogAttributes,
        );
        logger.error(err, {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
      }
    }

    const existingChannels: Array<WorkspaceChannel> =
      this.getExistingChannelNamesFromNotificationRules({
        notificationRules: rules,
        workspaceType: data.workspaceType,
        projectAuth: projectAuth,
      }) || [];

    logger.debug("Existing channels:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(existingChannels, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return existingChannels;
  }

  /*
   * Creates a record's own channels in every connected workspace, as its
   * matching rules ask, stores them on the record, and adds the rules'
   * people to them: the users and teams each rule names, and the people the
   * record has already that the rule adds - its owners, the people given an
   * incident role, the people an on-call policy has paged
   * (NotificationRuleInvites). channelNameParts is the record's name for its
   * channels (WorkspaceChannelName.forNumberedRecord / forNamedRecord); each
   * rule puts its prefix, if it has one, in front.
   *
   * The channels are stored before anybody is invited. An owner, a role or a
   * page added to the record while this runs is invited by its own service,
   * which reads the record's channels after storing its person: whichever
   * of the two reads second sees the other, so nobody added around the
   * channel's creation is missed. (The record's services stored the
   * channels themselves once this returned, so an owner added in between -
   * as a monitor's incident adds its owners straight after creating it -
   * was invited to nothing.)
   *
   * A record set up in a project with a workspace connected always ends up
   * holding a list of channels, an empty one when no rule asked for a
   * channel: that is how a later change of the record knows its setup ran
   * and that a rule which starts to match it may open its channel then
   * (createChannelsForRulesThatNowMatch).
   */
  @CaptureSpan()
  public async createChannelsAndInviteUsersToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    channelNameParts: WorkspaceChannelNameParts;
    isPrivate?: boolean;
  }): Promise<WorkspaceChannelsCreated | null> {
    try {
      logger.debug(
        "WorkspaceNotificationRuleService.createInviteAndPostToChannelsBasedOnRules",
        { projectId: data.projectId?.toString() } as LogAttributes,
      );
      logger.debug(data, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      const channelsCreated: Array<NotificationRuleWorkspaceChannel> = [];
      const membersNotAdded: Array<ChannelMembersNotAdded> = [];

      // Whether this record's list of channels was written (stored at all).
      let isRecordChannelListStored: boolean = false;

      const projectAuths: Array<WorkspaceProjectAuthToken> =
        await WorkspaceProjectAuthTokenService.getProjectAuths({
          projectId: data.projectId,
        });

      logger.debug("projectAuths", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(projectAuths, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      if (!projectAuths || projectAuths.length === 0) {
        // do nothing.
        return null;
      }

      for (const projectAuth of projectAuths) {
        try {
          if (!projectAuth.authToken) {
            continue;
          }

          if (!projectAuth.workspaceType) {
            continue;
          }

          const authToken: string = projectAuth.authToken;
          const workspaceType: WorkspaceType = projectAuth.workspaceType;

          const notificationRules: Array<WorkspaceNotificationRule> =
            await this.getMatchingNotificationRules({
              projectId: data.projectId,
              workspaceType: workspaceType,
              notificationRuleEventType: data.notificationRuleEventType,
              notificationFor: data.notificationFor,
            });

          logger.debug("notificationRules", {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          logger.debug(notificationRules, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);

          /*
           * No rule for this workspace says nothing about the next one. This
           * used to `return null`, so a project connected to both Slack and
           * Microsoft Teams never got its Teams incident / alert channel when
           * the workspace that happened to come first had no matching rule.
           */
          if (!notificationRules || notificationRules.length === 0) {
            continue;
          }

          logger.debug("Creating channels based on rules", {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          const createdWorkspaceChannels: Array<NotificationRuleWorkspaceChannel> =
            await this.createChannelsBasedOnRules({
              projectId: data.projectId,
              projectOrUserAuthTokenForWorkspace: authToken,
              workspaceType: workspaceType,
              notificationRules: notificationRules,
              channelNameParts: data.channelNameParts,
              notificationEventType: data.notificationRuleEventType,
              notificationFor: data.notificationFor,
              ...(data.isPrivate ? { isPrivate: true } : {}),
            });

          logger.debug("createdWorkspaceChannels", {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          logger.debug(createdWorkspaceChannels, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);

          channelsCreated.push(...createdWorkspaceChannels);

          /*
           * On the record first, with the channels of the workspaces before
           * this one: then whoever is added to the record from now on is
           * invited by their own service.
           */
          if (createdWorkspaceChannels.length > 0) {
            try {
              await WorkspaceRecordChannels.store({
                record: data.notificationFor,
                channels: [...channelsCreated],
              });
              isRecordChannelListStored = true;
            } catch (err) {
              // Its people are still invited to the channels just created.
              logger.error("Error storing the record's new channels", {
                projectId: data.projectId?.toString(),
              } as LogAttributes);
              logger.error(err, {
                projectId: data.projectId?.toString(),
              } as LogAttributes);
            }
          }

          logger.debug("Inviting users and teams to channels based on rules", {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          membersNotAdded.push(
            ...(await this.inviteUsersAndTeamsToChannelsBasedOnRules({
              projectId: data.projectId,
              projectAuth: projectAuth,
              workspaceType: workspaceType,
              notificationRules: notificationRules,
              notificationChannels: createdWorkspaceChannels,
              notificationFor: data.notificationFor,
            })),
          );
        } catch (err) {
          logger.error(
            "Error in creating channels and inviting users to channels for workspace type " +
              projectAuth.workspaceType,
            { projectId: data.projectId?.toString() } as LogAttributes,
          );
          logger.error(err, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
        }
      }

      /*
       * No rule asked for a channel, or none was created: an empty list
       * says the record's setup ran, so a rule that starts to match it
       * later opens its channel then. (Never over channels created here
       * that could not be stored: a later change would open them again.)
       */
      if (!isRecordChannelListStored && channelsCreated.length === 0) {
        try {
          await WorkspaceRecordChannels.store({
            record: data.notificationFor,
            channels: [],
          });
        } catch (err) {
          logger.error("Error storing the record's empty list of channels", {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
        }
      }

      logger.debug("Returning created channels", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return {
        channelsCreated: channelsCreated,
        membersNotAdded: membersNotAdded,
      };
    } catch (err) {
      logger.error(
        "Error in createChannelsAndInviteUsersToChannelsBasedOnRules:",
        { projectId: data.projectId?.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return null;
    }
  }

  /*
   * OPENS THE CHANNEL OF A RULE THAT HAS STARTED TO MATCH A RECORD.
   *
   * A rule's conditions are checked when the record is created and again
   * each time something about the record is posted - its state or severity
   * changes, a note is added, an owner joins. The first time the record
   * matches a rule that creates a channel, its channel is created: when the
   * record is created (createChannelsAndInviteUsersToChannelsBasedOnRules),
   * or later, here. An incident whose rule asks for the Acknowledged state
   * gets its channel when it is acknowledged, with its commander - who
   * acknowledging made them - and everybody else the rule adds; one whose
   * rule asks for Critical, when its severity is raised to it. Channels were
   * created only when the record was, so a rule asking for a state the
   * record reaches later never created one at all.
   *
   * A channel opened here starts as one opened with the record would: a
   * line that says what it is for and why it was opened, with the record's
   * buttons; then the rule's people are added, and the message about the
   * change that matched the rule follows (sendWorkspaceMarkdownNotification
   * posts it once this returns, the new channel included).
   *
   * Never for a record:
   * - whose own setup is still running: one created moments ago that holds
   *   no list of channels yet opens its channels itself
   *   (WorkspaceRecordChannelState.isSetUp). One created before channels
   *   were opened this way, or while no workspace was connected, or whose
   *   setup failed, is set up once that window is over;
   * - that is over - resolved, or a completed maintenance event;
   * - that has the rule's channel already, or one by the name the rule asks
   *   for (a channel shared with another rule before rules shared channels);
   * - for a channel its workspace refused for the record before, so a
   *   refusal is not asked again with every post.
   *
   * Runs under the record's lock, so two changes at once open one channel.
   * Never throws: a channel that cannot be opened must not stop the message
   * that is being posted.
   */
  @CaptureSpan()
  public async createChannelsForRulesThatNowMatch(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const created: Array<NotificationRuleWorkspaceChannel> = [];

    try {
      const eventType: NotificationRuleEventType | null =
        WorkspaceRecordChannels.getEventType(data.notificationFor);

      if (!eventType) {
        return created;
      }

      const projectAuths: Array<WorkspaceProjectAuthToken> =
        (await WorkspaceProjectAuthTokenService.getProjectAuths({
          projectId: data.projectId,
        })) || [];

      // The rules that create a channel and match the record now.
      const rulesByWorkspace: Array<{
        projectAuth: WorkspaceProjectAuthToken;
        workspaceType: WorkspaceType;
        rules: Array<WorkspaceNotificationRule>;
      }> = [];

      for (const projectAuth of projectAuths) {
        if (!projectAuth.authToken || !projectAuth.workspaceType) {
          continue;
        }

        const rules: Array<WorkspaceNotificationRule> = (
          await this.getMatchingNotificationRules({
            projectId: data.projectId,
            workspaceType: projectAuth.workspaceType,
            notificationRuleEventType: eventType,
            notificationFor: data.notificationFor,
          })
        ).filter((rule: WorkspaceNotificationRule): boolean => {
          return Boolean(
            (rule.notificationRule as CreateChannelNotificationRule | undefined)
              ?.shouldCreateNewChannel,
          );
        });

        if (rules.length > 0) {
          rulesByWorkspace.push({
            projectAuth: projectAuth,
            workspaceType: projectAuth.workspaceType,
            rules: rules,
          });
        }
      }

      if (rulesByWorkspace.length === 0) {
        return created;
      }

      // Cheaply first: whether any of them is without its channel at all.
      const record: WorkspaceRecordChannelState | null =
        await WorkspaceRecordChannels.read(data.notificationFor);

      if (
        !record ||
        !this.mayOpenChannelsLaterFor(record) ||
        !rulesByWorkspace.some(
          (entry: {
            projectAuth: WorkspaceProjectAuthToken;
            workspaceType: WorkspaceType;
            rules: Array<WorkspaceNotificationRule>;
          }): boolean => {
            return (
              this.getRulesWithoutTheirChannel({
                rules: entry.rules,
                record: record,
                projectAuth: entry.projectAuth,
                workspaceType: entry.workspaceType,
              }).length > 0
            );
          },
        )
      ) {
        return created;
      }

      await WorkspaceRecordChannels.runExclusive(
        data.notificationFor,
        async (): Promise<void> => {
          for (const entry of rulesByWorkspace) {
            created.push(
              ...(await this.openLaterChannelsInWorkspace({
                projectId: data.projectId,
                notificationFor: data.notificationFor,
                projectAuth: entry.projectAuth,
                workspaceType: entry.workspaceType,
                rules: entry.rules,
              })),
            );
          }
        },
      );
    } catch (err) {
      logger.error("Error opening the channels of rules that now match", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
    }

    return created;
  }

  /*
   * Under the record's lock: reads the record again - another change may
   * have opened the channels meanwhile - and opens, in one workspace, the
   * channels its matching rules still lack, then stores them, introduces
   * them and adds their people.
   */
  private async openLaterChannelsInWorkspace(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    projectAuth: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
    rules: Array<WorkspaceNotificationRule>;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const record: WorkspaceRecordChannelState | null =
      await WorkspaceRecordChannels.read(data.notificationFor);

    if (!record || !this.mayOpenChannelsLaterFor(record)) {
      return [];
    }

    const rulesToOpen: Array<WorkspaceNotificationRule> =
      await this.withoutChannelsRefusedBefore({
        projectId: data.projectId,
        notificationFor: data.notificationFor,
        workspaceType: data.workspaceType,
        record: record,
        rules: this.getRulesWithoutTheirChannel({
          rules: data.rules,
          record: record,
          projectAuth: data.projectAuth,
          workspaceType: data.workspaceType,
        }),
      });

    if (rulesToOpen.length === 0) {
      return [];
    }

    // Refusals are logged against the record and the rest still opened.
    const channels: Array<NotificationRuleWorkspaceChannel> =
      await this.createChannelsBasedOnRules({
        projectId: data.projectId,
        projectOrUserAuthTokenForWorkspace: data.projectAuth.authToken!,
        workspaceType: data.workspaceType,
        notificationRules: rulesToOpen,
        channelNameParts: record.channelNameParts,
        notificationEventType: record.eventType,
        notificationFor: data.notificationFor,
        ...(record.isPrivate ? { isPrivate: true } : {}),
      });

    if (channels.length === 0) {
      return [];
    }

    // On the record before anybody is invited, as when the record is created.
    await WorkspaceRecordChannels.store({
      record: data.notificationFor,
      channels: [...(record.channels || []), ...channels],
    });

    await this.postLaterChannelIntro({
      projectId: data.projectId,
      notificationFor: data.notificationFor,
      workspaceType: data.workspaceType,
      record: record,
      channels: channels,
      rules: rulesToOpen,
    });

    const membersNotAdded: Array<ChannelMembersNotAdded> =
      await this.inviteUsersAndTeamsToChannelsBasedOnRules({
        projectId: data.projectId,
        projectAuth: data.projectAuth,
        workspaceType: data.workspaceType,
        notificationRules: rulesToOpen,
        notificationChannels: channels,
        notificationFor: data.notificationFor,
      });

    // Who could not be added, under the channel's first message.
    await ChannelMembersNotAddedNotice.noteAll({
      projectId: data.projectId,
      membersNotAdded: membersNotAdded,
    });

    return channels;
  }

  /*
   * Whether a record may have a channel opened for it now: its own setup ran
   * (WorkspaceRecordChannelState.isSetUp) and it is not over.
   */
  private mayOpenChannelsLaterFor(
    record: WorkspaceRecordChannelState,
  ): boolean {
    return record.isSetUp && record.isOngoing;
  }

  /*
   * The rules among these whose channel the record does not have in this
   * workspace: no channel of the record was created for the rule, and none
   * has the name the rule asks for - a channel two rules shared before each
   * channel listed every rule that asked for it carries only the first.
   */
  private getRulesWithoutTheirChannel(data: {
    rules: Array<WorkspaceNotificationRule>;
    record: WorkspaceRecordChannelState;
    projectAuth: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
  }): Array<WorkspaceNotificationRule> {
    const workspaceUtil: typeof WorkspaceBase =
      WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType);

    const channels: Array<NotificationRuleWorkspaceChannel> = (
      data.record.channels || []
    ).filter((channel: NotificationRuleWorkspaceChannel): boolean => {
      return channel.workspaceType === data.workspaceType;
    });

    return data.rules.filter((rule: WorkspaceNotificationRule): boolean => {
      const isRulesChannel: boolean = channels.some(
        (channel: NotificationRuleWorkspaceChannel): boolean => {
          return NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
            channel: channel,
            notificationRuleId: rule.id?.toString(),
          });
        },
      );

      if (isRulesChannel) {
        return false;
      }

      const workspaceRule: CreateChannelNotificationRule =
        rule.notificationRule as CreateChannelNotificationRule;

      const askedFor: WorkspaceChannelToCreate = {
        channelName: WorkspaceChannelName.getChannelName({
          workspaceType: data.workspaceType,
          prefix: WorkspaceChannelName.getPrefix(workspaceRule),
          parts: data.record.channelNameParts,
        }),
        teamId:
          data.workspaceType === WorkspaceType.Slack
            ? SlackOrganization.getWorkspaceIdOfChannel({
                projectAuth: data.projectAuth,
                teamId: workspaceRule.teamToCreateChannelIn,
              })
            : data.workspaceType === WorkspaceType.Mattermost
              ? MattermostTeams.getTeamIdOfRuleChannel({
                  projectAuth: data.projectAuth,
                  teamId: workspaceRule.teamToCreateChannelIn,
                })
              : workspaceRule.teamToCreateChannelIn ||
                (data.workspaceType === WorkspaceType.MicrosoftTeams
                  ? (data.projectAuth.miscData?.["teamId"] as
                      | string
                      | undefined)
                  : undefined),
      };

      return !channels.some(
        (channel: NotificationRuleWorkspaceChannel): boolean => {
          return workspaceUtil.isSameChannelToCreate(
            {
              channelName: channel.name,
              /*
               * A Slack channel created before the project moved to its
               * organization's installation names no workspace: it is in
               * the one the project was connected to, now the default. A
               * Mattermost channel created before teams were told apart
               * names no team: it is in the team the project was
               * connected to (MattermostTeams).
               */
              teamId:
                data.workspaceType === WorkspaceType.Slack
                  ? SlackOrganization.getWorkspaceIdOfChannel({
                      projectAuth: data.projectAuth,
                      teamId: channel.teamId,
                    })
                  : data.workspaceType === WorkspaceType.Mattermost
                    ? MattermostTeams.getTeamIdOfStoredChannel({
                        projectAuth: data.projectAuth,
                        teamId: channel.teamId,
                      })
                    : channel.teamId,
            },
            askedFor,
          );
        },
      );
    });
  }

  /*
   * The rules among these whose channel the workspace has not refused for
   * the record before: a refusal (Notification Logs: Create Channel, error)
   * stands, so the channel is not asked for again with every message about
   * the record.
   */
  private async withoutChannelsRefusedBefore(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
    record: WorkspaceRecordChannelState;
    rules: Array<WorkspaceNotificationRule>;
  }): Promise<Array<WorkspaceNotificationRule>> {
    const result: Array<WorkspaceNotificationRule> = [];

    for (const rule of data.rules) {
      const channelName: string = WorkspaceChannelName.getChannelName({
        workspaceType: data.workspaceType,
        prefix: WorkspaceChannelName.getPrefix(
          rule.notificationRule as CreateChannelNotificationRule,
        ),
        parts: data.record.channelNameParts,
      });

      const refusal: WorkspaceNotificationLog | null =
        await WorkspaceNotificationLogService.findOneBy({
          query: {
            ...this.getRecordLogQuery(data.notificationFor),
            projectId: data.projectId,
            workspaceType: data.workspaceType,
            actionType: WorkspaceNotificationActionType.CreateChannel,
            status: WorkspaceNotificationStatus.Error,
            channelName: channelName.substring(0, ColumnLength.ShortText),
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!refusal) {
        result.push(rule);
      }
    }

    return result;
  }

  // The record's own id, as its Notification Logs rows carry it.
  private getRecordLogQuery(
    notificationFor: NotificationFor,
  ): Record<string, ObjectID> {
    const query: Record<string, ObjectID> = {};

    for (const key of [
      "incidentId",
      "alertId",
      "incidentEpisodeId",
      "alertEpisodeId",
      "scheduledMaintenanceId",
      "monitorId",
      "onCallDutyPolicyId",
    ] as Array<NotificationForRecordKey>) {
      const id: ObjectID | undefined = notificationFor[key];

      if (id) {
        query[key] = id;
      }
    }

    return query;
  }

  /*
   * The first message of a channel opened for a record later: what it is
   * for and why it was opened - "📌 This channel is for Incident INC-42:
   * Checkout is down. OneUptime created it when the incident matched the
   * rule Acknowledged incidents, and posts the incident's updates here." -
   * with the record's buttons, as its first message would carry them.
   */
  private async postLaterChannelIntro(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
    record: WorkspaceRecordChannelState;
    channels: Array<NotificationRuleWorkspaceChannel>;
    rules: Array<WorkspaceNotificationRule>;
  }): Promise<void> {
    try {
      const recordWord: string =
        LATER_CHANNEL_RECORD_WORDS[data.record.eventType] || "record";

      const ruleName: string = (data.rules[0]?.name || "").trim();

      // The installation's own name, when it goes by one.
      const productName: string = ProductBrandingText.getProductName();

      const heading: MarkdownText = data.record.title
        ? mdText`📌 This channel is for **[${data.record.displayName}](${data.record.link.toString()})**: ${data.record.title}`
        : mdText`📌 This channel is for **[${data.record.displayName}](${data.record.link.toString()})**.`;

      const why: MarkdownText = ruleName
        ? mdText`${productName} created it when the ${recordWord} matched the rule **${ruleName}**, and posts the ${recordWord}'s updates here.`
        : mdText`${productName} created it when the ${recordWord} matched a notification rule, and posts the ${recordWord}'s updates here.`;

      const markdown: string = FeedMarkdown.join(
        [heading, why],
        "\n\n",
      ).toString();

      const actionBlocks: Array<WorkspaceMessageBlock> =
        (
          await WorkspaceRecordChannels.getActionBlocks({
            record: data.notificationFor,
            projectId: data.projectId,
          })
        ).find((blocks: MessageBlocksByWorkspaceType): boolean => {
          return blocks.workspaceType === data.workspaceType;
        })?.messageBlocks || [];

      const messageBlocks: Array<WorkspaceMessageBlock> = [
        {
          _type: "WorkspacePayloadMarkdown",
          text: markdown,
        } as WorkspacePayloadMarkdown,
        ...actionBlocks,
      ];

      const notificationText: string | undefined =
        WorkspaceNotificationText.fromBlocks(messageBlocks);

      // One message per channel: a Microsoft Teams channel is posted to in its own team.
      const responses: Array<WorkspaceSendMessageResponse> =
        await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
          projectId: data.projectId,
          messagePayloadsByWorkspace: data.channels.map(
            (
              channel: NotificationRuleWorkspaceChannel,
            ): WorkspaceMessagePayload => {
              return {
                _type: "WorkspaceMessagePayload",
                workspaceType: data.workspaceType,
                messageBlocks: messageBlocks,
                channelNames: [],
                channelIds: [channel.id],
                ...(notificationText ? { text: notificationText } : {}),
                ...(channel.teamId ? { teamId: channel.teamId } : {}),
              };
            },
          ),
        });

      await this.logSendResponses({
        projectId: data.projectId,
        notificationFor: data.notificationFor,
        responses: responses,
        messageBlocksByWorkspaceTypes: [
          {
            workspaceType: data.workspaceType,
            messageBlocks: messageBlocks,
          },
        ],
      });
    } catch (err) {
      logger.error("Error introducing a channel opened for a record later", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * The rules whose channels the person an on-call policy pages for the
   * record joins: the rules that created one of the record's channels and
   * add on-call responders ("On-call responders, as they are paged").
   */
  @CaptureSpan()
  public async getNotificationRulesWhereOnCallIsTrue(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    return await this.getRulesOfRecordChannelsInviting({
      ...data,
      invitee: NotificationRuleInvitee.OnCallResponders,
    });
  }

  /*
   * The rules whose channels an owner added to the record joins: the rules
   * that created one of the record's channels and add its owners.
   */
  @CaptureSpan()
  public async getNotificationRulesWhereInviteOwnersIsTrue(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    return await this.getRulesOfRecordChannelsInviting({
      ...data,
      invitee: NotificationRuleInvitee.Owners,
    });
  }

  /*
   * The rules whose channels somebody given an incident role joins - the
   * Incident Commander when they are assigned, often as they acknowledge:
   * the rules that created one of the incident's (or incident episode's)
   * channels and add the people given a role. Roles used to be read off the
   * owners' switch, so a rule that added on-call responders but not owners
   * never added the commander.
   */
  @CaptureSpan()
  public async getNotificationRulesWhereInviteRolesIsTrue(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    return await this.getRulesOfRecordChannelsInviting({
      ...data,
      invitee: NotificationRuleInvitee.IncidentRoles,
    });
  }

  /*
   * The rules that created one of the record's channels and add this kind
   * of person to it (NotificationRuleInvites).
   *
   * A channel is its rule's from the moment it is created: whoever joins
   * the record afterwards joins its channel too, whatever the record's
   * conditions say by then. These used to be the rules matching the record
   * now, so an owner added to an incident whose severity had dropped below
   * the rule's Critical, or the commander of an incident whose rule asks
   * for the Acknowledged state once it was resolved, was invited to
   * nothing.
   */
  private async getRulesOfRecordChannelsInviting(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    notificationRuleEventType: NotificationRuleEventType;
    invitee: NotificationRuleInvitee;
  }): Promise<Array<WorkspaceNotificationRule>> {
    const result: Array<WorkspaceNotificationRule> = [];

    for (const workspaceType of Service.getAllWorkspaceTypes()) {
      const recordChannels: Array<WorkspaceChannel> =
        await this.getWorkspaceChannelsByNotificationFor({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: workspaceType,
        });

      if (recordChannels.length === 0) {
        continue;
      }

      const notificationRules: Array<WorkspaceNotificationRule> =
        await this.getNotificationRules({
          projectId: data.projectId,
          workspaceType: workspaceType,
          notificationRuleEventType: data.notificationRuleEventType,
        });

      for (const rule of notificationRules) {
        const ownsAChannel: boolean = recordChannels.some(
          (channel: WorkspaceChannel): boolean => {
            return NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
              channel: channel as Partial<NotificationRuleWorkspaceChannel>,
              notificationRuleId: rule.id?.toString(),
            });
          },
        );

        if (
          ownsAChannel &&
          NotificationRuleInvites.isInviting({
            rule: rule.notificationRule as CreateChannelNotificationRule,
            eventType: rule.eventType || data.notificationRuleEventType,
            invitee: data.invitee,
          })
        ) {
          result.push(rule);
        }
      }
    }

    return result;
  }

  /*
   * Adds the rules' people to the channels just created for a record, logs
   * who was added against the record (notificationFor), and hands back who
   * could not be added (no account connected to this workspace), per rule's
   * channels. It does not tell the channels: the record's service does,
   * after the record's own first message (ChannelMembersNotAddedNotice.noteAll).
   *
   * Whoever is on call in the schedules a rule names joins its channels too,
   * without being paged (WorkspaceScheduleOnCall): Slack adds them with the
   * rule's other people; Microsoft Teams adds nobody to a channel, so they
   * are handed back to be @mentioned in it, at the same moment as the note.
   */
  @CaptureSpan()
  public async inviteUsersAndTeamsToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
    notificationRules: Array<WorkspaceNotificationRule>;
    notificationChannels: Array<NotificationRuleWorkspaceChannel>;
    /*
     * The record the channels were created for. Its invites are logged
     * against it, so they are listed on the record's Notification Logs page
     * beside the channel's creation.
     */
    notificationFor?: NotificationFor | undefined;
  }): Promise<Array<ChannelMembersNotAdded>> {
    logger.debug(
      "inviteUsersAndTeamsToChannelsBasedOnRules called with data:",
      { projectId: data.projectId?.toString() } as LogAttributes,
    );
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    // Who is on call in each rule's schedules: none, if they cannot be read.
    const peopleOnCallByRule: Map<
      string,
      Array<ScheduleOnCallPerson>
    > = await WorkspaceScheduleOnCall.getPeopleOnCallByRule({
      projectId: data.projectId,
      notificationRules: data.notificationRules,
    }).catch((err: unknown): Map<string, Array<ScheduleOnCallPerson>> => {
      logger.error(
        "Could not read who is on call in the rules' schedules to add to their new channels",
        { projectId: data.projectId?.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return new Map<string, Array<ScheduleOnCallPerson>>();
    });

    const inviteUserPayloads: Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }> = await this.getUsersIdsToInviteToChannel({
      projectId: data.projectId,
      notificationRules: data.notificationRules,
      notificationFor: data.notificationFor,
      ...(data.workspaceType === WorkspaceType.Slack ||
      data.workspaceType === WorkspaceType.Mattermost
        ? { peopleOnCallByRule: peopleOnCallByRule }
        : {}),
    });

    logger.debug("User IDs to invite by Workspace Notification Rule ID:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(inviteUserPayloads, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const membersNotAdded: Array<ChannelMembersNotAdded> = [];

    for (const inviteUserPayload of inviteUserPayloads) {
      const userIds: Array<ObjectID> = inviteUserPayload.userIds;

      // A channel several rules asked for is each of those rules' channel.
      const channelsOfRule: Array<NotificationRuleWorkspaceChannel> =
        data.notificationChannels.filter(
          (channel: NotificationRuleWorkspaceChannel) => {
            return NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
              channel: channel,
              notificationRuleId: inviteUserPayload.notificationRuleId,
            });
          },
        );

      // A rule whose channel the workspace did not create has none to invite to.
      if (channelsOfRule.length === 0) {
        continue;
      }

      const found: WorkspaceInvitees = await this.findWorkspaceUserIdsToInvite({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        authToken: data.projectAuth.authToken || "",
        userIds: userIds,
      });

      const workspaceUserIds: Array<string> = found.invitees.map(
        (invitee: { workspaceUserId: string }): string => {
          return invitee.workspaceUserId;
        },
      );
      const invitedUserIds: Array<ObjectID> = found.invitees.map(
        (invitee: { userId: ObjectID }): ObjectID => {
          return invitee.userId;
        },
      );
      const userIdsNotConnected: Array<ObjectID> = found.notFoundUserIds;

      logger.debug("Workspace User IDs to invite:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(workspaceUserIds, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      /*
       * Everybody connected is invited in one go. This used to run once per
       * person, inside the loop above, inviting the list built so far each
       * time: the first person was invited as many times as there were people.
       *
       * An invite Slack refuses is logged and does not stop the rest: it used
       * to end the whole channel setup, so the channel OneUptime had just
       * created was never recorded on the record, and none of the record's
       * later messages reached it.
       */
      if (workspaceUserIds.length > 0) {
        let invited: boolean = true;

        try {
          await WorkspaceUtil.getWorkspaceTypeUtil(
            data.workspaceType,
          ).inviteUsersToChannels({
            authToken: data.projectAuth.authToken!,
            workspaceChannelInvitationPayload: {
              channelNames: channelsOfRule.map(
                (channel: NotificationRuleWorkspaceChannel) => {
                  return channel.name;
                },
              ),
              workspaceUserIds: workspaceUserIds,
            },
            projectId: data.projectId,
          });
        } catch (err) {
          invited = false;
          logger.error("Error inviting users to the new channels", {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
        }

        // Log user invitations: only the people who were invited.
        await this.logUsersInvitedToChannels({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          channels: channelsOfRule,
          userIds: invited ? invitedUserIds : [],
          notificationFor: data.notificationFor,
        });
      }

      /*
       * Who could not be added is said once per channel, in one note that
       * names them all (ChannelMembersNotAddedNotice) - not in a message per
       * person, and not before the record's own first message.
       */
      if (userIdsNotConnected.length > 0 && channelsOfRule.length > 0) {
        membersNotAdded.push({
          workspaceType: data.workspaceType,
          channels: channelsOfRule.map(
            (channel: NotificationRuleWorkspaceChannel) => {
              return { id: channel.id, name: channel.name };
            },
          ),
          userIds: userIdsNotConnected,
        });
      }
    }

    /*
     * Microsoft Teams adds nobody to a channel: whoever is on call in the
     * rules' schedules is @mentioned in it instead, once the record's own
     * first message is posted (ChannelMembersNotAddedNotice.noteAll).
     */
    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      try {
        membersNotAdded.push(
          ...(await this.getOnCallToMentionInChannels({
            projectId: data.projectId,
            notificationRules: data.notificationRules,
            notificationChannels: data.notificationChannels,
            peopleOnCallByRule: peopleOnCallByRule,
            notificationFor: data.notificationFor,
          })),
        );
      } catch (err) {
        logger.error(
          "Could not work out who is on call to mention in the new Microsoft Teams channels",
          { projectId: data.projectId?.toString() } as LogAttributes,
        );
        logger.error(err, {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
      }
    }

    logger.debug("Users invited to channels successfully", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return membersNotAdded;
  }

  /*
   * Who to @mention in each new Microsoft Teams channel: whoever is on call
   * in the schedules of the rules that asked for it, each person once with
   * every schedule they are on call in - one message per channel, however
   * many of its rules name schedules. Only members of the project, as for
   * an invite.
   */
  private async getOnCallToMentionInChannels(data: {
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
    notificationChannels: Array<NotificationRuleWorkspaceChannel>;
    peopleOnCallByRule: Map<string, Array<ScheduleOnCallPerson>>;
    notificationFor?: NotificationFor | undefined;
  }): Promise<Array<ChannelMembersNotAdded>> {
    const userIds: Array<ObjectID> = [];

    for (const people of data.peopleOnCallByRule.values()) {
      for (const person of people) {
        userIds.push(person.userId);
      }
    }

    if (userIds.length === 0) {
      return [];
    }

    const memberUserIds: Set<string> = new Set<string>(
      (
        await TeamMemberService.getProjectMemberUserIds({
          projectId: data.projectId,
          userIds: userIds,
        })
      ).map((userId: ObjectID): string => {
        return userId.toString().toLowerCase();
      }),
    );

    const onCallToMention: Array<ChannelMembersNotAdded> = [];

    for (const channel of data.notificationChannels) {
      const people: Array<ScheduleOnCallPerson> = [];

      for (const rule of data.notificationRules) {
        const ruleId: string | undefined = rule.id?.toString();

        if (
          !ruleId ||
          !NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
            channel: channel,
            notificationRuleId: ruleId,
          })
        ) {
          continue;
        }

        for (const person of data.peopleOnCallByRule.get(ruleId) || []) {
          const key: string = person.userId.toString().toLowerCase();

          if (!memberUserIds.has(key)) {
            continue;
          }

          const known: ScheduleOnCallPerson | undefined = people.find(
            (candidate: ScheduleOnCallPerson): boolean => {
              return candidate.userId.toString().toLowerCase() === key;
            },
          );

          if (!known) {
            people.push({
              userId: person.userId,
              scheduleNames: [...person.scheduleNames],
            });
            continue;
          }

          for (const scheduleName of person.scheduleNames) {
            if (!known.scheduleNames.includes(scheduleName)) {
              known.scheduleNames.push(scheduleName);
            }
          }
        }
      }

      if (people.length === 0) {
        continue;
      }

      onCallToMention.push({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channels: [
          {
            id: channel.id,
            name: channel.name,
            ...(channel.teamId ? { teamId: channel.teamId } : {}),
          },
        ],
        userIds: [],
        onCallToMention: people,
        ...(data.notificationFor
          ? { notificationFor: data.notificationFor }
          : {}),
      });
    }

    return onCallToMention;
  }

  @CaptureSpan()
  public async inviteUsersBasedOnRulesAndWorkspaceChannels(data: {
    workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
    userIds: Array<ObjectID>;
    /*
     * The record the channels belong to. Its invites are logged against it,
     * so they are listed with the record's other workspace logs (its
     * Notification Logs page reads them by the record's id).
     */
    notificationFor?: NotificationFor | undefined;
    /*
     * Throw what the workspace answered when it refuses an invite, rather
     * than log it and go on: a rule's test reports it to the person testing.
     */
    throwOnInviteError?: boolean | undefined;
  }): Promise<void> {
    // if no rules then return.
    if (data.notificationRules.length === 0) {
      logger.debug("No notification rules found. Returning.", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return;
    }

    logger.debug(
      "inviteUsersBasedOnRulesAndWorkspaceChannels called with data:",
      { projectId: data.projectId?.toString() } as LogAttributes,
    );
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    /*
     * A channel of the project is joined only by members of the project.
     * The ids come from owner rows, team rosters (pending invitations
     * included) and on-call pages, any of which can name somebody who has
     * left, so they are narrowed to members in one read (ProjectMembership).
     */
    const memberUserIds: Set<string> = await ProjectMembership.getMemberUserIds(
      {
        projectId: data.projectId,
        userIds: data.userIds,
      },
    );

    const userIds: Array<ObjectID> = data.userIds.filter(
      (userId: ObjectID): boolean => {
        return memberUserIds.has(userId.toString().toLowerCase());
      },
    );

    if (userIds.length === 0) {
      logger.debug("No project members to invite. Returning.", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return;
    }

    logger.debug("Users:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(userIds, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    // get all Workspaces.
    const workspaceTypes: Array<WorkspaceType> = Service.getAllWorkspaceTypes();

    for (const workspaceType of workspaceTypes) {
      // filter rules by workspaceType.

      const notificationRules: Array<WorkspaceNotificationRule> =
        data.notificationRules.filter((rule: WorkspaceNotificationRule) => {
          return rule.workspaceType === workspaceType;
        });

      logger.debug("Notification rules for workspace type:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(notificationRules, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      // A channel several rules asked for is each of those rules' channel.
      const channelsToInviteToBasedOnRule: Array<NotificationRuleWorkspaceChannel> =
        data.workspaceChannels.filter(
          (channel: NotificationRuleWorkspaceChannel) => {
            return notificationRules.some((rule: WorkspaceNotificationRule) => {
              return NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
                channel: channel,
                notificationRuleId: rule.id?.toString(),
              });
            });
          },
        );

      logger.debug("Channels to invite to based on rule:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(channelsToInviteToBasedOnRule, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      if (channelsToInviteToBasedOnRule.length === 0) {
        logger.debug("No channels to invite to based on rule.", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        continue;
      }

      // get auth token for workspace.

      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.findOneBy({
          query: {
            projectId: data.projectId,
            workspaceType: workspaceType,
          },
          select: {
            authToken: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!projectAuth) {
        logger.debug("No project auth found for workspace type", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        continue;
      }

      // inivte users to channels.

      const found: WorkspaceInvitees = await this.findWorkspaceUserIdsToInvite({
        projectId: data.projectId,
        workspaceType: workspaceType,
        authToken: projectAuth.authToken || "",
        userIds: userIds,
      });

      const workspaceUserIds: Array<string> = found.invitees.map(
        (invitee: { workspaceUserId: string }): string => {
          return invitee.workspaceUserId;
        },
      );
      const invitedUserIds: Array<ObjectID> = found.invitees.map(
        (invitee: { userId: ObjectID }): ObjectID => {
          return invitee.userId;
        },
      );
      const userIdsNotConnected: Array<ObjectID> = found.notFoundUserIds;

      logger.debug("Workspace User IDs to invite:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(workspaceUserIds, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      const channelNames: Array<string> = channelsToInviteToBasedOnRule.map(
        (channel: NotificationRuleWorkspaceChannel) => {
          return channel.name;
        },
      );

      logger.debug("Channel names to invite to:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(channelNames, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      /*
       * An invite Slack refuses is logged, and still lets the channel be
       * told who could not be added below.
       */
      let invited: boolean = true;

      try {
        await WorkspaceUtil.getWorkspaceTypeUtil(
          workspaceType,
        ).inviteUsersToChannels({
          authToken: projectAuth.authToken!,
          workspaceChannelInvitationPayload: {
            channelNames: channelNames,
            workspaceUserIds: workspaceUserIds,
          },
          projectId: data.projectId,
        });
      } catch (err) {
        invited = false;
        logger.error("Error inviting users to the record's channels", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: data.projectId?.toString(),
        } as LogAttributes);

        if (data.throwOnInviteError) {
          throw err;
        }
      }

      /*
       * Who could not be added - found in this workspace neither by a
       * connected account nor by their email address - is said once per
       * channel, in one note naming them all, however often they are owners
       * again or paged again (ChannelMembersNotAddedNotice). It used to be a
       * message per person every time: each page of the same person
       * repeated it.
       */
      await ChannelMembersNotAddedNotice.noteMembersNotAdded({
        projectId: data.projectId,
        workspaceType: workspaceType,
        channels: channelsToInviteToBasedOnRule.map(
          (channel: NotificationRuleWorkspaceChannel) => {
            return { id: channel.id, name: channel.name };
          },
        ),
        userIds: userIdsNotConnected,
      });

      // Log user invitations: only the people who were invited.
      await this.logUsersInvitedToChannels({
        projectId: data.projectId,
        workspaceType: workspaceType,
        channels: channelsToInviteToBasedOnRule,
        userIds: invited ? invitedUserIds : [],
        notificationFor: data.notificationFor,
      });
    }
  }

  @CaptureSpan()
  public async inviteTeamsBasedOnRulesAndWorkspaceChannels(data: {
    workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
    teamIds: Array<ObjectID>;
    /*
     * The record the channels belong to: the team's invites are logged
     * against it (inviteUsersBasedOnRulesAndWorkspaceChannels).
     */
    notificationFor?: NotificationFor | undefined;
  }): Promise<void> {
    // if no rules then return.
    if (data.notificationRules.length === 0) {
      logger.debug("No notification rules found. Returning.", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return;
    }

    const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeams(
      data.teamIds,
    );

    logger.debug("Users in teams:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(usersInTeam, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return this.inviteUsersBasedOnRulesAndWorkspaceChannels({
      workspaceChannels: data.workspaceChannels,
      projectId: data.projectId,
      notificationRules: data.notificationRules,
      userIds: usersInTeam.map((user: User) => {
        return user.id!;
      }),
      notificationFor: data.notificationFor,
    });
  }

  /*
   * A Notification Logs row for each person invited, in each channel they
   * were invited to. The record the channels belong to, when the caller
   * names it, is on every row: a record's Notification Logs page lists its
   * workspace logs by the record's id, so the invites are listed there
   * beside the channel's creation and messages.
   */
  private async logUsersInvitedToChannels(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    channels: Array<NotificationRuleWorkspaceChannel>;
    userIds: Array<ObjectID>;
    notificationFor?: NotificationFor | undefined;
  }): Promise<void> {
    try {
      for (const userId of data.userIds) {
        for (const channel of data.channels) {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId: string;
            channelName: string;
            userId: ObjectID;
            incidentId?: ObjectID;
            alertId?: ObjectID;
            monitorId?: ObjectID;
            alertEpisodeId?: ObjectID;
            incidentEpisodeId?: ObjectID;
            scheduledMaintenanceId?: ObjectID;
            onCallDutyPolicyId?: ObjectID;
          } = {
            projectId: data.projectId,
            workspaceType: data.workspaceType,
            channelId: channel.id,
            channelName: channel.name,
            userId: userId,
          };

          // Add resource associations only if they exist
          if (data.notificationFor?.incidentId) {
            logData.incidentId = data.notificationFor.incidentId;
          }
          if (data.notificationFor?.alertId) {
            logData.alertId = data.notificationFor.alertId;
          }
          if (data.notificationFor?.monitorId) {
            logData.monitorId = data.notificationFor.monitorId;
          }
          if (data.notificationFor?.alertEpisodeId) {
            logData.alertEpisodeId = data.notificationFor.alertEpisodeId;
          }
          if (data.notificationFor?.incidentEpisodeId) {
            logData.incidentEpisodeId = data.notificationFor.incidentEpisodeId;
          }
          if (data.notificationFor?.scheduledMaintenanceId) {
            logData.scheduledMaintenanceId =
              data.notificationFor.scheduledMaintenanceId;
          }
          if (data.notificationFor?.onCallDutyPolicyId) {
            logData.onCallDutyPolicyId =
              data.notificationFor.onCallDutyPolicyId;
          }

          await WorkspaceNotificationLogService.logInviteUser(logData, {
            isRoot: true,
          });
        }
      }
    } catch (err) {
      logger.error("Error logging user invitations:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      // Don't throw the error, just log it so the main flow continues
    }
  }

  /*
   * Whom a rule's channels invite, in the workspace: each person's connected
   * account, or else - in Slack - the account with their OneUptime email
   * address, as Add people on the record's page finds them
   * (SlackAccountByEmail). Nobody has to connect their account before a
   * rule's channel can have them. A guest's account found by email is left
   * out: Slack keeps guests out of the channels the app invites to, and its
   * refusal would stop everybody else's invitation with it. Whoever is found
   * neither way is handed back, for the channel's note
   * (ChannelMembersNotAddedNotice); so is whoever Slack could not be asked
   * about. Microsoft Teams adds nobody to a channel, so it finds nobody by
   * email here.
   */
  @CaptureSpan()
  public async findWorkspaceUserIdsToInvite(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    userIds: Array<ObjectID>;
  }): Promise<WorkspaceInvitees> {
    const found: WorkspaceInvitees = { invitees: [], notFoundUserIds: [] };
    const notConnected: Array<ObjectID> = [];

    for (const userId of data.userIds) {
      const workspaceUserId: string | null =
        await this.getWorkspaceUserIdFromOneUptimeUserId({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          oneuptimeUserId: userId,
        });

      if (workspaceUserId) {
        found.invitees.push({
          userId: userId,
          workspaceUserId: workspaceUserId,
        });
      } else {
        notConnected.push(userId);
      }
    }

    if (
      (data.workspaceType !== WorkspaceType.Slack &&
        data.workspaceType !== WorkspaceType.Mattermost) ||
      !data.authToken ||
      notConnected.length === 0
    ) {
      found.notFoundUserIds = notConnected;
      return found;
    }

    const emails: Map<string, string> =
      await this.getEmailsOfUsers(notConnected);

    if (data.workspaceType === WorkspaceType.Mattermost) {
      return await this.findMattermostAccountsByEmail({
        found: found,
        authToken: data.authToken,
        userIds: notConnected,
        emails: emails,
      });
    }

    for (const userId of notConnected) {
      let account: SlackEmailAccount | null = null;

      try {
        account = await SlackAccountByEmail.find({
          projectId: data.projectId,
          authToken: data.authToken,
          userId: userId,
          email: emails.get(userId.toString().toLowerCase()) || "",
          useCache: true,
        });
      } catch (err) {
        logger.debug(
          "Could not look somebody up in Slack by their email address to invite them to a channel.",
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        logger.debug(err, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
      }

      const alreadyInvited: boolean = found.invitees.some(
        (invitee: { workspaceUserId: string }): boolean => {
          return invitee.workspaceUserId === account?.slackUserId;
        },
      );

      if (account && !account.isGuest && !alreadyInvited) {
        found.invitees.push({
          userId: userId,
          workspaceUserId: account.slackUserId,
        });
      } else {
        found.notFoundUserIds.push(userId);
      }
    }

    return found;
  }

  /*
   * Whom a rule's Mattermost channels invite among the people who have not
   * connected their account: the account with their OneUptime email
   * address, when the Mattermost server shows the bot people's email
   * addresses (its Show Email Address setting). A guest's account is left
   * out, as in Slack: Mattermost keeps guests out of the channels they were
   * not let into. Whoever is not found is handed back for the channel's
   * note (ChannelMembersNotAddedNotice).
   */
  private async findMattermostAccountsByEmail(data: {
    found: WorkspaceInvitees;
    authToken: string;
    userIds: Array<ObjectID>;
    emails: Map<string, string>;
  }): Promise<WorkspaceInvitees> {
    for (const userId of data.userIds) {
      let account: MattermostUser | null = null;
      const email: string =
        data.emails.get(userId.toString().toLowerCase()) || "";

      if (email) {
        try {
          account = await MattermostUtil.findUserByEmail({
            authToken: data.authToken,
            email: email,
          });
        } catch (err) {
          logger.debug(
            "Could not look somebody up in Mattermost by their email address to invite them to a channel.",
          );
          logger.debug(err);
        }
      }

      const alreadyInvited: boolean = data.found.invitees.some(
        (invitee: { workspaceUserId: string }): boolean => {
          return invitee.workspaceUserId === account?.id;
        },
      );

      if (account && !account.isBot && !account.isGuest && !alreadyInvited) {
        data.found.invitees.push({
          userId: userId,
          workspaceUserId: account.id,
        });
      } else {
        data.found.notFoundUserIds.push(userId);
      }
    }

    return data.found;
  }

  /*
   * The email addresses of these people, by lower-cased id. None when they
   * cannot be read: then nobody is found by email.
   */
  private async getEmailsOfUsers(
    userIds: Array<ObjectID>,
  ): Promise<Map<string, string>> {
    const emails: Map<string, string> = new Map<string, string>();

    try {
      const users: Array<User> = await UserService.findBy({
        query: {
          _id: QueryHelper.any(
            userIds.map((userId: ObjectID): string => {
              return userId.toString();
            }),
          ),
        },
        select: {
          _id: true,
          email: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      for (const user of users) {
        const email: string = user.email?.toString() || "";

        if (user.id && email) {
          emails.set(user.id.toString().toLowerCase(), email);
        }
      }
    } catch (err) {
      logger.error(
        "Could not read people's email addresses to find them in Slack.",
      );
      logger.error(err);
    }

    return emails;
  }

  @CaptureSpan()
  public async getWorkspaceUserIdFromOneUptimeUserId(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    oneuptimeUserId: ObjectID;
  }): Promise<string | null> {
    logger.debug("getWorkspaceUserIdFromOneUptimeUserId called with data:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          userId: data.oneuptimeUserId,
        },
        select: {
          workspaceUserId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth) {
      logger.debug("No userAuth found for given data", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return null;
    }

    logger.debug("Found userAuth:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(userAuth, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return userAuth.workspaceUserId?.toString() || null;
  }

  @CaptureSpan()
  public async createChannelsBasedOnRules(data: {
    projectId: ObjectID;
    projectOrUserAuthTokenForWorkspace: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<WorkspaceNotificationRule>;
    channelNameParts: WorkspaceChannelNameParts;
    notificationEventType: NotificationRuleEventType;
    notificationFor?: NotificationFor;
    isPrivate?: boolean;
    /*
     * Throw what the workspace answered when it does not create a channel,
     * rather than log it and go on with the next: a rule's test reports it
     * to the person testing.
     */
    throwOnCreateChannelError?: boolean | undefined;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    logger.debug("createChannelsBasedOnRules called with data:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const createdWorkspaceChannels: Array<NotificationRuleWorkspaceChannel> =
      [];

    // The channels created so far, with the channel each was asked as.
    const channelsAskedFor: Array<CreatedRuleChannel> = [];

    const notificationChannels: Array<NotificationRuleChannelToCreate> =
      this.getnotificationChannelssFromNotificationRules({
        notificationRules: data.notificationRules,
        channelNameParts: data.channelNameParts,
        notificationEventType: data.notificationEventType,
        workspaceType: data.workspaceType,
      });

    logger.debug("New channel names to be created:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(notificationChannels, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    // Get project auth to access teamId for Microsoft Teams
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    if (!projectAuth) {
      throw new BadDataException(
        "Project auth not found for workspace type " + data.workspaceType,
      );
    }

    if (!notificationChannels || notificationChannels.length === 0) {
      logger.debug("No new channel names found. Returning empty array.", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return [];
    }

    const workspaceUtil: typeof WorkspaceBase =
      WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType);

    /*
     * Slack installed for a whole Enterprise organization: its workspaces,
     * read once for every channel created here - listed again from Slack
     * when those listed last are old - and handed to each one created, which
     * would read the project's connection again otherwise. Null for a
     * project connected to one workspace.
     */
    const slackOrganization: SlackOrganizationConnection | null =
      data.workspaceType === WorkspaceType.Slack
        ? await SlackOrganization.getOfConnection({
            projectId: data.projectId,
            projectAuth: projectAuth,
          })
        : null;

    for (const notificationChannel of notificationChannels) {
      // The team a Microsoft Teams channel is created in: the rule's, or the project's.
      let teamId: string | undefined = notificationChannel.teamId;

      if (
        !teamId &&
        data.workspaceType === WorkspaceType.MicrosoftTeams &&
        projectAuth.miscData?.["teamId"]
      ) {
        teamId = projectAuth.miscData["teamId"];
      }

      /*
       * The Slack workspace it is created in: for a project connected to a
       * whole Enterprise organization, the rule's, or the default one - so
       * rules asking for one name in two of its workspaces get a channel in
       * each, and rules asking for it in one workspace share it. None for a
       * project connected to one workspace (SlackOrganization).
       */
      if (data.workspaceType === WorkspaceType.Slack) {
        teamId = slackOrganization
          ? SlackOrganization.getWorkspaceIdToCreateIn({
              organization: slackOrganization,
              teamId: teamId,
            })
          : undefined;
      }

      /*
       * The Mattermost team it is created in: the rule's, or the default
       * one - so rules asking for one name in two teams get a channel in
       * each, and a rule that names the default team and one that names
       * none share it (MattermostTeams).
       */
      if (data.workspaceType === WorkspaceType.Mattermost) {
        teamId = MattermostTeams.getTeamIdOfRuleChannel({
          projectAuth: projectAuth,
          teamId: teamId,
        });
      }

      const askedFor: WorkspaceChannelToCreate = {
        channelName: notificationChannel.channelName,
        teamId: teamId,
      };

      /*
       * A channel created already is the one asked for, as the workspace
       * creates names (isSameChannelToCreate): Slack lower-cases names and
       * drops the characters it does not take, and a Microsoft Teams team
       * tells names apart without their case, so asking for it again would
       * be refused as taken. That channel is these rules' channel too. It is
       * matched by the name it was asked for, not the one it got: a taken
       * name is created as name-2.
       */
      const createdChannel: NotificationRuleWorkspaceChannel | undefined =
        channelsAskedFor.find((created: CreatedRuleChannel): boolean => {
          return workspaceUtil.isSameChannelToCreate(
            created.askedFor,
            askedFor,
          );
        })?.channel;

      if (createdChannel) {
        const notificationRuleIds: Array<string> =
          createdChannel.notificationRuleIds || [
            createdChannel.notificationRuleId,
          ];

        for (const notificationRuleId of notificationChannel.notificationRuleIds) {
          if (!notificationRuleIds.includes(notificationRuleId)) {
            notificationRuleIds.push(notificationRuleId);
          }
        }

        createdChannel.notificationRuleIds = notificationRuleIds;

        logger.debug(
          `Channel name ${notificationChannel.channelName} already created. Adding its rules to it.`,
          { projectId: data.projectId?.toString() } as LogAttributes,
        );
        continue;
      }

      logger.debug(
        `Creating new channel with name: ${notificationChannel.channelName}`,
        { projectId: data.projectId?.toString() } as LogAttributes,
      );
      const createChannelData: CreateRuleChannelData = {
        authToken: data.projectOrUserAuthTokenForWorkspace,
        channelName: notificationChannel.channelName,
        projectId: data.projectId,
      };

      if (data.isPrivate) {
        createChannelData.isPrivate = true;
      }

      if (teamId) {
        createChannelData.teamId = teamId;
      }

      if (data.workspaceType === WorkspaceType.Slack) {
        createChannelData.organization = slackOrganization;
      }

      let channel: WorkspaceChannel;

      /*
       * A channel the workspace does not create - Slack refuses a name over
       * 80 characters (invalid_name_maxlength), Microsoft one over 50 or one
       * that starts with "_", or neither can be reached - is logged, and the
       * channels after it are still created. Its error used to end the setup
       * of the workspace's channels, so the record never kept the channels
       * created already: nobody was invited to them, and none of the
       * record's updates were posted there.
       */
      try {
        // Ensure teamId is set for Microsoft Teams
        if (
          data.workspaceType === WorkspaceType.MicrosoftTeams &&
          !createChannelData.teamId
        ) {
          throw new BadDataException(
            "teamId is required for Microsoft Teams channels",
          );
        }

        // A name somebody has already is tried again as name-2 and so on first.
        channel = await this.createChannelUnderFreeName({
          workspaceType: data.workspaceType,
          createChannelData: createChannelData,
          prefix: notificationChannel.prefix,
          channelNameParts: data.channelNameParts,
        });
      } catch (err) {
        await this.logChannelNotCreated({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          channelName: notificationChannel.channelName,
          error: err,
          notificationFor: data.notificationFor,
        });

        if (data.throwOnCreateChannelError) {
          throw err;
        }

        continue;
      }

      const notificationWorkspaceChannel: NotificationRuleWorkspaceChannel = {
        ...channel,
        notificationRuleId: notificationChannel.notificationRuleId,
        notificationRuleIds: [...notificationChannel.notificationRuleIds],
      };

      channelsAskedFor.push({
        askedFor: askedFor,
        channel: notificationWorkspaceChannel,
      });

      logger.debug("Channel created:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.debug(channel, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);

      /*
       * Log the channel creation against the record the channel was created
       * for: a record's Notification Logs page lists its workspace logs by
       * the record's id.
       */
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          channelId: string;
          channelName: string;
          incidentId?: ObjectID;
          alertId?: ObjectID;
          monitorId?: ObjectID;
          alertEpisodeId?: ObjectID;
          incidentEpisodeId?: ObjectID;
          scheduledMaintenanceId?: ObjectID;
          onCallDutyPolicyId?: ObjectID;
        } = {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          channelId: channel.id,
          channelName: channel.name,
        };

        // Add resource associations only if they exist
        if (data.notificationFor?.incidentId) {
          logData.incidentId = data.notificationFor.incidentId;
        }
        if (data.notificationFor?.alertId) {
          logData.alertId = data.notificationFor.alertId;
        }
        if (data.notificationFor?.monitorId) {
          logData.monitorId = data.notificationFor.monitorId;
        }
        if (data.notificationFor?.alertEpisodeId) {
          logData.alertEpisodeId = data.notificationFor.alertEpisodeId;
        }
        if (data.notificationFor?.incidentEpisodeId) {
          logData.incidentEpisodeId = data.notificationFor.incidentEpisodeId;
        }
        if (data.notificationFor?.scheduledMaintenanceId) {
          logData.scheduledMaintenanceId =
            data.notificationFor.scheduledMaintenanceId;
        }
        if (data.notificationFor?.onCallDutyPolicyId) {
          logData.onCallDutyPolicyId = data.notificationFor.onCallDutyPolicyId;
        }

        await WorkspaceNotificationLogService.logCreateChannel(logData, {
          isRoot: true,
        });
      } catch (err) {
        logger.error("Error logging channel creation:", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        // Don't throw the error, just log it so the main flow continues
      }

      createdWorkspaceChannels.push(notificationWorkspaceChannel);
    }

    logger.debug("Returning created workspace channels:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(createdWorkspaceChannels, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return createdWorkspaceChannels;
  }

  /*
   * Creates a rule's channel under the first of its names nobody has taken:
   * the name, then the name with -2, -3 and so on after it, up to
   * WorkspaceChannelName.MAX_NAME_ATTEMPTS names. Without a prefix, inc-42
   * is the kind of name somebody may already have: another project in the
   * same workspace numbering its incidents INC-, an archived channel (Slack
   * keeps an archived channel's name, Microsoft Teams a deleted one's for
   * 30 days), a channel made by hand or by another tool. Any other refusal
   * is thrown as it is.
   */
  private async createChannelUnderFreeName(data: {
    workspaceType: WorkspaceType;
    createChannelData: CreateRuleChannelData;
    prefix: string;
    channelNameParts: WorkspaceChannelNameParts;
  }): Promise<WorkspaceChannel> {
    const workspace: typeof WorkspaceBase = WorkspaceUtil.getWorkspaceTypeUtil(
      data.workspaceType,
    );

    for (let attempt: number = 1; ; attempt++) {
      const channelName: string =
        attempt === 1
          ? data.createChannelData.channelName
          : WorkspaceChannelName.getChannelName({
              workspaceType: data.workspaceType,
              prefix: data.prefix,
              parts: data.channelNameParts,
              attempt: attempt,
            });

      try {
        return await workspace.createChannel({
          ...data.createChannelData,
          channelName: channelName,
        });
      } catch (err) {
        if (
          attempt >= WorkspaceChannelName.MAX_NAME_ATTEMPTS ||
          !workspace.isChannelNameTakenError(err)
        ) {
          throw err;
        }

        logger.debug(
          `The channel name ${channelName} is taken in ${data.workspaceType}. Trying the next one.`,
          {
            projectId: data.createChannelData.projectId?.toString(),
          } as LogAttributes,
        );
      }
    }
  }

  /*
   * The project's number prefixes by the kind of record a rule is for
   * (Incident: "INC-", or null for none), for the rule form's preview of
   * the name of the channel a rule creates. Read as OneUptime: the route
   * that hands them out has already asked whether its caller may read the
   * project's notification rules.
   */
  @CaptureSpan()
  public async getRecordNumberPrefixes(
    projectId: ObjectID,
  ): Promise<WorkspaceChannelNumberPrefixes> {
    const columns: Array<[NotificationRuleEventType, NumberPrefixColumn]> =
      Object.entries(NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE) as Array<
        [NotificationRuleEventType, NumberPrefixColumn]
      >;

    const select: Record<string, boolean> = {};

    for (const [, column] of columns) {
      select[column] = true;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: select,
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    const numberPrefixes: WorkspaceChannelNumberPrefixes = {};

    for (const [eventType, column] of columns) {
      const prefix: unknown = (project as unknown as Record<string, unknown>)[
        column
      ];

      numberPrefixes[eventType] =
        typeof prefix === "string" && prefix ? prefix : null;
    }

    return numberPrefixes;
  }

  /*
   * A channel the workspace did not create, with what it answered: in the
   * server log, and in a Notification Logs row against the record the
   * channel was asked for (when the caller names it), so the record's
   * Notification Logs page lists it beside the channels that were created.
   */
  private async logChannelNotCreated(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    channelName: string;
    error: unknown;
    notificationFor?: NotificationFor | undefined;
  }): Promise<void> {
    logger.error(`Error creating channel ${data.channelName}:`, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.error(data.error, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    try {
      await WorkspaceNotificationLogService.logCreateChannelError(
        {
          ...data.notificationFor,
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          channelName: data.channelName,
          /*
           * Readable whatever was thrown: Slack and Microsoft Graph throw an
           * HTTP error response itself.
           */
          error: WorkspaceBase.getSendErrorMessage(data.error),
        },
        { isRoot: true },
      );
    } catch (err) {
      logger.error("Error logging channel creation failure:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      // Don't throw the error, just log it so the main flow continues
    }
  }

  /*
   * Who each rule adds to the channel it just created for a record: the
   * users and teams it names, whoever is on call in the schedules it names,
   * and the people the record has already that the rule adds
   * (NotificationRuleInvites) - its owners, the people given an incident
   * role, the people an on-call policy has paged so far. Those who join the
   * record later are added by their own services. Each kind of person is
   * read once for all the rules; a kind that cannot be read is left out,
   * and the rest are still invited.
   */
  @CaptureSpan()
  public async getUsersIdsToInviteToChannel(data: {
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
    // The record the channels were created for, whose people join them.
    notificationFor?: NotificationFor | undefined;
    /*
     * Whoever is on call in each rule's schedules, by the rule's id
     * (WorkspaceScheduleOnCall), for a workspace that adds them to the
     * channel - Slack. Left out, nobody joins for the rules' schedules.
     */
    peopleOnCallByRule?: Map<string, Array<ScheduleOnCallPerson>> | undefined;
  }): Promise<
    Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }>
  > {
    logger.debug("getUsersIdsToInviteToChannel called with data:");
    logger.debug(data);

    const result: Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }> = [];

    // The record's people of each kind, read once for every rule.
    const recordPeople: Map<
      NotificationRuleInvitee,
      Promise<Array<ObjectID>>
    > = new Map<NotificationRuleInvitee, Promise<Array<ObjectID>>>();

    const getRecordPeople: (
      invitee: NotificationRuleInvitee,
    ) => Promise<Array<ObjectID>> = (
      invitee: NotificationRuleInvitee,
    ): Promise<Array<ObjectID>> => {
      const notificationFor: NotificationFor | undefined = data.notificationFor;

      if (!notificationFor) {
        return Promise.resolve([]);
      }

      let people: Promise<Array<ObjectID>> | undefined =
        recordPeople.get(invitee);

      if (!people) {
        people = WorkspaceRecordPeople.getUserIds({
          record: notificationFor,
          invitee: invitee,
        }).catch((err: unknown): Array<ObjectID> => {
          logger.error(
            `Could not read the record's people (${invitee}) to invite to its new channels`,
            { projectId: data.projectId?.toString() } as LogAttributes,
          );
          logger.error(err, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
          return [];
        });

        recordPeople.set(invitee, people);
      }

      return people;
    };

    for (const workspaceNotificationRule of data.notificationRules) {
      const inviteUserIds: Array<ObjectID> = [];
      const workspaceRules: CreateChannelNotificationRule =
        workspaceNotificationRule.notificationRule as CreateChannelNotificationRule;

      // Each person once, however many ways the rule adds them.
      const addUserId: (userId: ObjectID | string) => void = (
        userId: ObjectID | string,
      ): void => {
        if (
          !inviteUserIds.find((id: ObjectID) => {
            return id.toString() === userId.toString();
          })
        ) {
          inviteUserIds.push(new ObjectID(userId.toString()));
        }
      };

      if (workspaceRules?.shouldCreateNewChannel) {
        if (
          workspaceRules.inviteUsersToNewChannel &&
          workspaceRules.inviteUsersToNewChannel.length > 0
        ) {
          const userIds: Array<ObjectID> =
            workspaceRules.inviteUsersToNewChannel || [];

          logger.debug("User IDs to invite from rule:", {} as LogAttributes);
          logger.debug(userIds, {} as LogAttributes);

          for (const userId of userIds) {
            addUserId(userId);
          }
        }

        if (
          workspaceRules.inviteTeamsToNewChannel &&
          workspaceRules.inviteTeamsToNewChannel.length > 0
        ) {
          let teamIds: Array<ObjectID> =
            workspaceRules.inviteTeamsToNewChannel || [];

          teamIds = teamIds.map((teamId: ObjectID) => {
            return new ObjectID(teamId.toString());
          });

          logger.debug("Team IDs to invite from rule:", {} as LogAttributes);
          logger.debug(teamIds, {} as LogAttributes);

          const usersInTeam: Array<User> =
            await TeamMemberService.getUsersInTeams(teamIds);

          logger.debug("Users in teams:", {} as LogAttributes);
          logger.debug(usersInTeam, {} as LogAttributes);

          for (const user of usersInTeam) {
            const userId: string | undefined = user._id?.toString();

            if (userId) {
              addUserId(userId);
            }
          }
        }

        // Whoever is on call in the rule's schedules, as the channel is created.
        for (const person of data.peopleOnCallByRule?.get(
          workspaceNotificationRule.id?.toString() || "",
        ) || []) {
          addUserId(person.userId);
        }

        /*
         * The record's own people the rule adds, as the record has them
         * now: owners added with it, the commander of an incident whose
         * channel opens only once it is acknowledged, the people paged
         * before the channel existed.
         */
        for (const invitee of NotificationRuleInvites.getInvited({
          rule: workspaceRules,
          eventType: workspaceNotificationRule.eventType,
        })) {
          for (const userId of await getRecordPeople(invitee)) {
            addUserId(userId);
          }
        }
      }

      /*
       * The rule is saved configuration and can name a user who has since
       * left the project (and a team can hold pending invitees): only
       * members are invited.
       */
      const memberUserIds: Array<ObjectID> =
        await TeamMemberService.getProjectMemberUserIds({
          projectId: data.projectId,
          userIds: inviteUserIds,
        });

      if (memberUserIds.length > 0) {
        result.push({
          notificationRuleId: workspaceNotificationRule.id!.toString(),
          userIds: memberUserIds,
        });
      }
    }

    logger.debug("Final list of user IDs to invite:", {} as LogAttributes);
    logger.debug(result, {} as LogAttributes);

    return result;
  }

  /*
   * The existing channels rules post to, each once: a name once per team or
   * workspace it is in - a Microsoft Teams team's General is not another
   * team's, a channel in one workspace of a Slack Enterprise organization
   * is not another workspace's (SlackOrganization), and a Mattermost team's
   * town-square is not another team's (MattermostTeams). The first rule's
   * entry is kept.
   */
  public getExistingChannelNamesFromNotificationRules(data: {
    notificationRules: Array<BaseNotificationRule>;
    workspaceType: WorkspaceType;
    /*
     * Slack and Mattermost: the project's connection, which says whether
     * its Slack channels can be in several workspaces, and which team a
     * Mattermost rule that names none posts in. Without it, a Slack name is
     * one channel, and a Mattermost name one channel per team named.
     */
    projectAuth?:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined;
  }): Array<WorkspaceChannel> {
    logger.debug(
      "getExistingChannelNamesFromNotificationRules called with data:",
      {} as LogAttributes,
    );
    logger.debug(
      {
        notificationRules: data.notificationRules,
        workspaceType: data.workspaceType,
      },
      {} as LogAttributes,
    );

    const channels: Array<WorkspaceChannel> = [];

    // The team or workspace a channel is in, as two of one name are told apart.
    const workspaceOf: (teamId: string | undefined) => string = (
      teamId: string | undefined,
    ): string => {
      if (data.workspaceType === WorkspaceType.Slack) {
        return (
          SlackOrganization.getWorkspaceIdOfChannel({
            projectAuth: data.projectAuth,
            teamId: teamId,
          }) || ""
        );
      }

      if (data.workspaceType === WorkspaceType.Mattermost) {
        return (
          MattermostTeams.getTeamIdOfRuleChannel({
            projectAuth: data.projectAuth,
            teamId: teamId,
          }) || ""
        );
      }

      return teamId || "";
    };

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: BaseNotificationRule = notificationRule;

      if (workspaceRules.shouldPostToExistingChannel) {
        const existingChannelNames: Array<string> =
          workspaceRules.existingChannelNames.split(",");

        logger.debug("Existing channel names from rule:", {} as LogAttributes);
        logger.debug(existingChannelNames, {} as LogAttributes);

        for (const channelName of existingChannelNames) {
          if (!channelName) {
            logger.debug(
              "Empty channel name found. Skipping.",
              {} as LogAttributes,
            );
            continue;
          }

          const channel: WorkspaceChannel = {
            id: channelName,
            name: channelName,
            workspaceType: data.workspaceType,
            ...(workspaceRules.existingTeam && {
              teamId: workspaceRules.existingTeam,
            }),
          };

          if (
            !channels.some((c: WorkspaceChannel) => {
              return (
                c.name === channelName &&
                workspaceOf(c.teamId) === workspaceOf(channel.teamId)
              );
            })
          ) {
            channels.push(channel);
          }
        }
      }
    }

    logger.debug("Final list of existing channels:", {} as LogAttributes);
    logger.debug(channels, {} as LogAttributes);

    return channels;
  }

  /*
   * Collects the Microsoft Teams chat ids (group / personal chats) that
   * matching rules want to post to. Chats are Teams-only destinations.
   */
  public getExistingChatIdsFromNotificationRules(data: {
    notificationRules: Array<BaseNotificationRule>;
  }): Array<string> {
    const chatIds: Array<string> = [];

    for (const notificationRule of data.notificationRules) {
      if (!notificationRule.shouldPostToExistingChat) {
        continue;
      }

      for (const chatId of notificationRule.existingChatIds || []) {
        if (!chatId) {
          continue;
        }

        if (!chatIds.includes(chatId)) {
          chatIds.push(chatId);
        }
      }
    }

    return chatIds;
  }

  /*
   * The Microsoft Teams chats the record's matching rules name - with
   * updateKinds, only those of the rules that want one of those updates
   * (NotificationRuleUpdates.wantsUpdate).
   */
  @CaptureSpan()
  public async getExistingChatIdsBasedOnEventType(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    updateKinds?: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): Promise<Array<string>> {
    if (data.workspaceType !== WorkspaceType.MicrosoftTeams) {
      return []; // chats are only supported for Microsoft Teams.
    }

    const notificationRules: Array<WorkspaceNotificationRule> = (
      await this.getMatchingNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: data.notificationRuleEventType,
        notificationFor: data.notificationFor,
      })
    ).filter((rule: WorkspaceNotificationRule): boolean => {
      return NotificationRuleUpdates.wantsUpdate({
        rule: rule.notificationRule as BaseNotificationRule | undefined,
        updateKinds: data.updateKinds,
      });
    });

    return this.getExistingChatIdsFromNotificationRules({
      notificationRules: notificationRules.map(
        (rule: WorkspaceNotificationRule) => {
          return rule.notificationRule as BaseNotificationRule;
        },
      ),
    });
  }

  @CaptureSpan()
  public async getConnectedMicrosoftTeamsChats(data: {
    projectId: ObjectID;
  }): Promise<Record<string, MicrosoftTeamsChat>> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.miscData) {
      return {};
    }

    return (
      (projectAuth.miscData as MicrosoftTeamsMiscData).availableChats || {}
    );
  }

  /*
   * The channels a record's rules create in one workspace: one for each
   * rule that creates a channel, named after the record with the rule's
   * prefix, if it has one, in front (WorkspaceChannelName) - inc-42, or
   * prod-inc-42. Rules that ask for the same name share the channel; in
   * Microsoft Teams, only rules that create it in the same team.
   */
  public getnotificationChannelssFromNotificationRules(data: {
    notificationEventType: NotificationRuleEventType;
    notificationRules: Array<WorkspaceNotificationRule>;
    channelNameParts: WorkspaceChannelNameParts;
    workspaceType: WorkspaceType;
  }): Array<NotificationRuleChannelToCreate> {
    const workspaceUtil: typeof WorkspaceBase =
      WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType);

    const channels: Array<NotificationRuleChannelToCreate> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: CreateChannelNotificationRule | undefined =
        notificationRule.notificationRule as
          | CreateChannelNotificationRule
          | undefined;

      if (!workspaceRules?.shouldCreateNewChannel) {
        continue;
      }

      const prefix: string = WorkspaceChannelName.getPrefix(workspaceRules);

      const channelName: string = WorkspaceChannelName.getChannelName({
        workspaceType: data.workspaceType,
        prefix: prefix,
        parts: data.channelNameParts,
      });

      const notificationRuleId: string = notificationRule.id?.toString() || "";

      /*
       * Names the workspace creates as one channel are one channel
       * (isSameChannelToCreate): in Slack by the name Slack creates, within
       * the workspace a rule names, in Mattermost by its handle, within the
       * team a rule names, and in Microsoft Teams within the team, whatever
       * the case. A rule that leaves the team or the workspace to the
       * project, and one that names the project's, are told apart here and
       * share the channel when it is created, where the project's is read
       * (SlackOrganization.getWorkspaceIdOfChannel for Slack,
       * MattermostTeams.getTeamIdOfRuleChannel for Mattermost).
       */
      const sameChannel: NotificationRuleChannelToCreate | undefined =
        channels.find((channel: NotificationRuleChannelToCreate): boolean => {
          return workspaceUtil.isSameChannelToCreate(channel, {
            channelName: channelName,
            teamId: workspaceRules.teamToCreateChannelIn || undefined,
          });
        });

      if (sameChannel) {
        /*
         * One channel for the name, which this rule asked for too: the
         * people it invites (its users and teams, owners, whoever on-call
         * pages) are invited to it. Only the first rule's id used to be
         * kept, so the other rules' people never joined the channel.
         */
        if (!sameChannel.notificationRuleIds.includes(notificationRuleId)) {
          sameChannel.notificationRuleIds.push(notificationRuleId);
        }

        logger.debug(
          `Channel name ${channelName} is the channel ${sameChannel.channelName} already in the list. Adding the rule to it.`,
          {} as LogAttributes,
        );
        continue;
      }

      const channel: NotificationRuleChannelToCreate = {
        channelName: channelName,
        notificationRuleId: notificationRuleId,
        notificationRuleIds: [notificationRuleId],
        prefix: prefix,
      };

      if (workspaceRules.teamToCreateChannelIn) {
        channel.teamId = workspaceRules.teamToCreateChannelIn;
      }

      channels.push(channel);
    }

    logger.debug("Final list of new channel names:", {} as LogAttributes);
    logger.debug(channels, {} as LogAttributes);

    return channels;
  }

  private async getNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    logger.debug("getNotificationRules called with data:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const notificationRules: Array<WorkspaceNotificationRule> =
      await this.findBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          eventType: data.notificationRuleEventType,
        },
        select: {
          notificationRule: true,
          workspaceType: true,
          eventType: true,
          // A channel opened later says which rule opened it.
          name: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

    logger.debug("Notification rules retrieved:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(notificationRules, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    return notificationRules;
  }

  /*
   * What the record a notification is for holds, by the field each
   * condition checks (NotificationRuleConditionValues): its own fields,
   * then the ones read from elsewhere -
   *
   * - an on-call policy itself, by its id: an on-call rule's On-Call Policy
   *   condition names the policy, not its name, so a renamed policy is
   *   still the one it names (#7554);
   * - who owns the record (WorkspaceRecordOwners): its owner users' and
   *   owner teams' ids, read only when a rule being matched checks them
   *   (`checkOnsUsed`), as most rules do not.
   */
  private async getValuesBasedOnNotificationFor(data: {
    notificationFor: NotificationFor;
    // The kind of record the rules being matched are for.
    eventType: NotificationRuleEventType;
    checkOnsUsed?: Set<NotificationRuleConditionCheckOn> | undefined;
  }): Promise<NotificationRuleConditionValues> {
    const values: NotificationRuleConditionValues =
      NotificationRuleConditionUtil.getValues(
        await this.getRecordValues({ notificationFor: data.notificationFor }),
      );

    if (
      data.eventType === NotificationRuleEventType.OnCallDutyPolicy &&
      data.notificationFor.onCallDutyPolicyId
    ) {
      values[NotificationRuleConditionCheckOn.OnCallDutyPolicies] = [
        data.notificationFor.onCallDutyPolicyId.toString(),
      ];
    }

    const ownedRecord: {
      recordKey: OwnedRecordKey;
      recordId: ObjectID;
      checkOn: NotificationRuleConditionCheckOn;
    } | null = WorkspaceRecordOwners.getOwnedRecord({
      eventType: data.eventType,
      notificationFor: data.notificationFor,
    });

    if (
      ownedRecord &&
      (!data.checkOnsUsed || data.checkOnsUsed.has(ownedRecord.checkOn))
    ) {
      values[ownedRecord.checkOn] = await WorkspaceRecordOwners.getOwnerIds({
        recordKey: ownedRecord.recordKey,
        recordId: ownedRecord.recordId,
      });
    }

    return values;
  }

  // The record's own fields: every other field is left out (undefined).
  private async getRecordValues(data: {
    notificationFor: NotificationFor;
  }): Promise<Partial<NotificationRuleConditionValues>> {
    logger.debug(
      "getValuesBasedOnNotificationFor called with data:",
      {} as LogAttributes,
    );
    logger.debug(data, {} as LogAttributes);

    if (data.notificationFor.incidentId) {
      logger.debug(
        "Fetching incident details for incident ID:",
        {} as LogAttributes,
      );
      logger.debug(data.notificationFor.incidentId, {} as LogAttributes);

      const incident: Incident | null = await IncidentService.findOneById({
        id: data.notificationFor.incidentId,
        select: {
          title: true,
          description: true,
          incidentSeverity: true,
          currentIncidentState: true,
          labels: true,
          monitors: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        logger.debug("Incident not found for ID:", {} as LogAttributes);
        logger.debug(data.notificationFor.incidentId, {} as LogAttributes);
        throw new BadDataException("Incident ID not found");
      }

      logger.debug("Incident details retrieved:", {} as LogAttributes);
      logger.debug(incident, {} as LogAttributes);

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds:
            incident.monitors?.map((monitor: Incident) => {
              return monitor.id!;
            }) || [],
        });

      logger.debug("Monitor labels retrieved:", {} as LogAttributes);
      logger.debug(monitorLabels, {} as LogAttributes);

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: incident.title || "",
        [NotificationRuleConditionCheckOn.IncidentDescription]:
          incident.description || "",
        [NotificationRuleConditionCheckOn.IncidentSeverity]:
          incident.incidentSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.IncidentState]:
          incident.currentIncidentState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]:
          incident.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]:
          incident.monitors?.map((monitor: Incident) => {
            return monitor._id?.toString() || "";
          }) || [],

        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    if (data.notificationFor.alertId) {
      logger.debug("Fetching alert details for alert ID:", {} as LogAttributes);
      logger.debug(data.notificationFor.alertId, {} as LogAttributes);

      const alert: Alert | null = await AlertService.findOneById({
        id: data.notificationFor.alertId,
        select: {
          title: true,
          description: true,
          alertSeverity: true,
          currentAlertState: true,
          labels: true,
          monitor: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        logger.debug("Alert not found for ID:", {} as LogAttributes);
        logger.debug(data.notificationFor.alertId, {} as LogAttributes);
        throw new BadDataException("Alert ID not found");
      }

      logger.debug("Alert details retrieved:", {} as LogAttributes);
      logger.debug(alert, {} as LogAttributes);

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds: alert?.monitor?.id ? [alert?.monitor?.id] : [],
        });

      logger.debug("Monitor labels retrieved:", {} as LogAttributes);
      logger.debug(monitorLabels, {} as LogAttributes);

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: alert.title || "",
        [NotificationRuleConditionCheckOn.AlertDescription]:
          alert.description || "",
        [NotificationRuleConditionCheckOn.AlertSeverity]:
          alert.alertSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertState]:
          alert.currentAlertState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]:
          alert.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: [
          alert.monitor?.id ? alert.monitor.id.toString() : "",
        ],

        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    if (data.notificationFor.scheduledMaintenanceId) {
      logger.debug(
        "Fetching scheduled maintenance details for ID:",
        {} as LogAttributes,
      );
      logger.debug(
        data.notificationFor.scheduledMaintenanceId,
        {} as LogAttributes,
      );

      const scheduledMaintenance: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: data.notificationFor.scheduledMaintenanceId,
          select: {
            title: true,
            description: true,
            currentScheduledMaintenanceState: true,
            labels: true,
            monitors: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenance) {
        logger.debug(
          "Scheduled maintenance not found for ID:",
          {} as LogAttributes,
        );
        logger.debug(
          data.notificationFor.scheduledMaintenanceId,
          {} as LogAttributes,
        );
        throw new BadDataException("Scheduled Maintenance ID not found");
      }

      logger.debug(
        "Scheduled maintenance details retrieved:",
        {} as LogAttributes,
      );
      logger.debug(scheduledMaintenance, {} as LogAttributes);

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds:
            scheduledMaintenance.monitors?.map(
              (monitor: ScheduledMaintenance) => {
                return monitor.id!;
              },
            ) || [],
        });

      logger.debug("Monitor labels retrieved:", {} as LogAttributes);
      logger.debug(monitorLabels, {} as LogAttributes);

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]:
          scheduledMaintenance.title || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          scheduledMaintenance.description || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]:
          scheduledMaintenance.currentScheduledMaintenanceState?._id?.toString() ||
          "",
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          scheduledMaintenance.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.Monitors]:
          scheduledMaintenance.monitors?.map(
            (monitor: ScheduledMaintenance) => {
              return monitor._id?.toString() || "";
            },
          ) || [],
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    if (data.notificationFor.monitorId) {
      logger.debug(
        "Fetching monitor status timeline details for ID:",
        {} as LogAttributes,
      );
      logger.debug(data.notificationFor.monitorId, {} as LogAttributes);

      const monitor: Monitor | null = await MonitorService.findOneById({
        id: data.notificationFor.monitorId,
        select: {
          name: true,
          labels: true,
          monitorType: true,
          currentMonitorStatusId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        logger.debug("Monitor not found for ID:", {} as LogAttributes);
        logger.debug(data.notificationFor.monitorId, {} as LogAttributes);
        throw new BadDataException(ExceptionMessages.MonitorNotFound);
      }

      const monitorLabels: Array<Label> = monitor?.labels || [];

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: monitor?.name || "",
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]:
          monitor?.monitorType || undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]:
          monitor?.currentMonitorStatusId?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: [
          monitor?._id?.toString() || "",
        ],
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    if (data.notificationFor.onCallDutyPolicyId) {
      logger.debug(
        "Fetching on call policy details for ID:",
        {} as LogAttributes,
      );
      logger.debug(
        data.notificationFor.onCallDutyPolicyId,
        {} as LogAttributes,
      );

      const onCallDutyPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: data.notificationFor.onCallDutyPolicyId,
          select: {
            name: true,
            labels: true,
            description: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!onCallDutyPolicy) {
        logger.debug("On-call policy not found for ID:", {} as LogAttributes);
        logger.debug(
          data.notificationFor.onCallDutyPolicyId,
          {} as LogAttributes,
        );
        throw new BadDataException(
          "The on-call policy this notification is for was not found. It may have been deleted.",
        );
      }

      const onCallDutyPolicyLabels: Array<Label> =
        onCallDutyPolicy?.labels || [];

      return {
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]:
          onCallDutyPolicy?.name || "",
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          onCallDutyPolicy?.description || "",
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]:
          onCallDutyPolicyLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],

        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: "",
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    // Handle Incident Episode
    if (data.notificationFor.incidentEpisodeId) {
      logger.debug(
        "Fetching incident episode details for ID:",
        {} as LogAttributes,
      );
      logger.debug(data.notificationFor.incidentEpisodeId, {} as LogAttributes);

      const incidentEpisode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: data.notificationFor.incidentEpisodeId,
          select: {
            title: true,
            description: true,
            incidentSeverity: true,
            currentIncidentState: true,
            labels: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!incidentEpisode) {
        logger.debug("Incident Episode not found for ID:", {} as LogAttributes);
        logger.debug(
          data.notificationFor.incidentEpisodeId,
          {} as LogAttributes,
        );
        throw new BadDataException("Incident Episode ID not found");
      }

      logger.debug("Incident Episode details retrieved:", {} as LogAttributes);
      logger.debug(incidentEpisode, {} as LogAttributes);

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]:
          incidentEpisode.title || "",
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          incidentEpisode.description || "",
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]:
          incidentEpisode.incidentSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]:
          incidentEpisode.currentIncidentState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]:
          incidentEpisode.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
      };
    }

    /*
     * Alert episodes. This branch was missing, so matching rules for an alert
     * episode threw "NotificationFor is not supported": no alert episode
     * channel was ever created, and nothing about an alert episode - created,
     * state changes, notes - reached Slack or Microsoft Teams, even in
     * channels its rules named.
     */
    if (data.notificationFor.alertEpisodeId) {
      const alertEpisode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: data.notificationFor.alertEpisodeId,
          select: {
            title: true,
            description: true,
            alertSeverity: true,
            currentAlertState: true,
            labels: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!alertEpisode) {
        throw new BadDataException("Alert Episode ID not found");
      }

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCasePriority]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseSource]: undefined,
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]: undefined,
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]:
          alertEpisode.title || "",
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]:
          alertEpisode.description || "",
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]:
          alertEpisode.alertSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertEpisodeState]:
          alertEpisode.currentAlertState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]:
          alertEpisode.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    /*
     * Security cases. Priority and status are the project's own, matched by
     * id like every other state and severity; source is a fixed scale,
     * matched as written; labels by id, as everywhere else.
     */
    if (data.notificationFor.securityCaseId) {
      const securityCase: SecurityCase | null =
        await SecurityCaseService.findOneById({
          id: data.notificationFor.securityCaseId,
          select: {
            title: true,
            description: true,
            securityCasePriorityId: true,
            securityCaseStatusId: true,
            source: true,
            labels: {
              _id: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!securityCase) {
        throw new BadDataException("Security Case ID not found");
      }

      return {
        [NotificationRuleConditionCheckOn.SecurityCaseTitle]:
          securityCase.title || "",
        [NotificationRuleConditionCheckOn.SecurityCaseDescription]:
          securityCase.description || "",
        [NotificationRuleConditionCheckOn.SecurityCasePriority]:
          securityCase.securityCasePriorityId?.toString() || "",
        [NotificationRuleConditionCheckOn.SecurityCaseStatus]:
          securityCase.securityCaseStatusId?.toString() || "",
        [NotificationRuleConditionCheckOn.SecurityCaseSource]:
          securityCase.source || "",
        [NotificationRuleConditionCheckOn.SecurityCaseLabels]:
          securityCase.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.SecurityHuntName]: undefined,
        [NotificationRuleConditionCheckOn.SloName]: undefined,
        [NotificationRuleConditionCheckOn.Slos]: undefined,
        [NotificationRuleConditionCheckOn.SloLabels]: undefined,
        [NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange]:
          undefined,
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      };
    }

    /*
     * A hunt whose scheduled run found events: matched by its name, the one
     * thing its rules ask of it. Read as it is now, so a renamed hunt is
     * matched by its new name.
     */
    if (data.notificationFor.securityHuntId) {
      const hunt: SecurityHunt | null = await SecurityHuntService.findOneById({
        id: data.notificationFor.securityHuntId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!hunt) {
        throw new BadDataException("Security Hunt ID not found");
      }

      const values: {
        [key in NotificationRuleConditionCheckOn]:
          | string
          | Array<string>
          | undefined;
      } = {} as {
        [key in NotificationRuleConditionCheckOn]:
          | string
          | Array<string>
          | undefined;
      };

      for (const checkOn of Object.values(NotificationRuleConditionCheckOn)) {
        values[checkOn] = undefined;
      }

      values[NotificationRuleConditionCheckOn.SecurityHuntName] =
        hunt.name || "";

      return values;
    }

    /*
     * An SLO whose error budget policy moved: matched by its name, by the
     * SLO itself (its id) and by its labels' ids, read as it is now - a
     * renamed SLO is matched by its new name - and by what moved, which the
     * evaluation that committed it says (serviceLevelObjectivePolicyChanges).
     */
    if (data.notificationFor.serviceLevelObjectiveId) {
      const slo: ServiceLevelObjective | null =
        await ServiceLevelObjectiveService.findOneById({
          id: data.notificationFor.serviceLevelObjectiveId,
          select: {
            name: true,
            labels: {
              _id: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!slo) {
        throw new BadDataException("Service Level Objective ID not found");
      }

      const values: {
        [key in NotificationRuleConditionCheckOn]:
          | string
          | Array<string>
          | undefined;
      } = {} as {
        [key in NotificationRuleConditionCheckOn]:
          | string
          | Array<string>
          | undefined;
      };

      for (const checkOn of Object.values(NotificationRuleConditionCheckOn)) {
        values[checkOn] = undefined;
      }

      values[NotificationRuleConditionCheckOn.SloName] = slo.name || "";
      values[NotificationRuleConditionCheckOn.Slos] = [
        data.notificationFor.serviceLevelObjectiveId.toString(),
      ];
      values[NotificationRuleConditionCheckOn.SloLabels] =
        slo.labels?.map((label: Label): string => {
          return label._id?.toString() || "";
        }) || [];
      values[NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange] = [
        ...(data.notificationFor.serviceLevelObjectivePolicyChanges || []),
      ];

      return values;
    }

    throw new BadDataException("NotificationFor is not supported");
  }

  @CaptureSpan()
  public async getMatchingNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
  }): Promise<Array<WorkspaceNotificationRule>> {
    const notificationRules: Array<WorkspaceNotificationRule> =
      await this.getNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: data.notificationRuleEventType,
      });

    logger.debug("Notification rules retrieved:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(notificationRules, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const values: NotificationRuleConditionValues =
      await this.getValuesBasedOnNotificationFor({
        notificationFor: data.notificationFor,
        eventType: data.notificationRuleEventType,
        // Only what the rules check is read: owners for an owners condition.
        checkOnsUsed: NotificationRuleConditionUtil.getCheckOnsUsed(
          notificationRules.flatMap(
            (
              notificationRule: WorkspaceNotificationRule,
            ): Array<NotificationRuleCondition> => {
              return (
                (
                  notificationRule.notificationRule as
                    | IncidentNotificationRule
                    | undefined
                )?.filters || []
              );
            },
          ),
        ),
      });

    logger.debug("Values based on notification for:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(values, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const matchingNotificationRules: Array<WorkspaceNotificationRule> = [];

    for (const notificationRule of notificationRules) {
      logger.debug("Checking if rule matches:", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      if (
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule:
            notificationRule.notificationRule as IncidentNotificationRule,
          values: values,
        })
      ) {
        logger.debug("Rule matches. Adding to the list.", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
        matchingNotificationRules.push(notificationRule);
      } else {
        logger.debug("Rule does not match. Skipping.", {
          projectId: data.projectId?.toString(),
        } as LogAttributes);
      }
    }

    return matchingNotificationRules;
  }
}
export default new Service();

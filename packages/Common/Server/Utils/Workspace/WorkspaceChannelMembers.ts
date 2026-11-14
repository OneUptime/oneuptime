import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceChannelLinkUtil, {
  WorkspaceChannelRecordType,
} from "../../../Types/Workspace/WorkspaceChannelLink";
import {
  WORKSPACE_CHANNEL_ADD_MAX_PEOPLE,
  WorkspaceChannelAddAnswer,
  WorkspaceChannelAddOutcome,
  WorkspaceChannelAddResult,
  WorkspaceChannelPerson,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannel,
  WorkspaceRecordChannels,
} from "../../../Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import GlobalCache from "../../Infrastructure/GlobalCache";
import AlertEpisodeFeedService from "../../Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeFeedService from "../../Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import ScheduledMaintenanceFeedService from "../../Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../Services/WorkspaceUserAuthTokenService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ProjectMembership from "../TeamMember/ProjectMembership";
import MattermostUtil, {
  MattermostChannel,
  MattermostRequestError,
  MattermostUser,
} from "./Mattermost/Mattermost";
import MattermostConnection, {
  MattermostConnectionData,
} from "./Mattermost/MattermostConnection";
import MattermostTeams from "./Mattermost/MattermostTeams";
import MicrosoftTeamsUtil from "./MicrosoftTeams/MicrosoftTeams";
import SlackAccountByEmail, {
  SlackEmailAccount,
} from "./Slack/SlackAccountByEmail";
import SlackChannelMembers, {
  SlackChannelFacts,
  SlackChannelMembersError,
  SlackPersonFacts,
  SLACKBOT_USER_ID,
} from "./Slack/SlackChannelMembers";
import { WorkspaceChannel } from "./WorkspaceBase";
import WorkspaceChannelLinks from "./WorkspaceChannelLinks";

/*
 * WHO IS IN A RECORD'S OWN CHANNEL, AND ADDING PEOPLE TO IT.
 *
 * A workspace notification rule can create a Slack, Microsoft Teams or
 * Mattermost channel for an incident, an alert, an episode or a scheduled
 * maintenance event, and invites the record's people as they join the record
 * (NotificationRuleInvites). People still leave channels, a rule can miss
 * somebody, and a private channel that everybody has left is entered again
 * only through an invitation from someone in it: the OneUptime app or bot,
 * which created it and stays in it. So the record's page shows its channels
 * with the people in them, and a member who may edit the record adds people
 * through the app - themselves (Join channel) or anybody in the project.
 * Every addition is written to the record's feed and to its Notification
 * Logs, as the rules' invitations are.
 *
 * WHO MAY ASK. Reading: whoever can read the record, as for its Open in
 * Slack button - it is read with the caller's own props first, so a private
 * incident's channel is no easier to find than the incident. Adding:
 * whoever may edit the record (DatabaseService.findOneUpdatableById: the
 * table's update permission, their labels and owners), and only into the
 * record's own channels - a channel the record does not hold is refused, so
 * this never invites anybody anywhere else. Only members of the project are
 * added, as by the rules.
 *
 * WHO SOMEBODY IS IN SLACK. The account they connected to OneUptime, or else
 * the Slack account with their OneUptime email address (SlackAccountByEmail)
 * - as a page from chat and a rule's channel invitations find them - so
 * nobody has to connect their account before they can be added.
 *
 * MICROSOFT TEAMS. A standard channel is open to everyone in its team, and
 * a private channel's members are managed by its owners in Microsoft Teams.
 * OneUptime neither reads nor changes them - that would take Microsoft
 * Graph's ChannelMember permissions in every tenant - and says who can open
 * the channel instead.
 *
 * MATTERMOST. As for Slack: the bot adds people, and somebody is the account
 * they connected, or else the account with their email address, when the
 * server shows the bot people's email addresses. Mattermost's own rules differ
 * from Slack's (its server's api4/channel.go and app/channel.go):
 *
 * - It lists a channel's people only for somebody in it, a public channel's
 *   too. Looking at a page joins nothing and writes nothing in a channel, so a
 *   public channel the bot left is out of sight until the bot is back: it
 *   joins by itself when it next posts there, or when somebody is added.
 * - It takes people into an archived channel without a word, so OneUptime
 *   reads first whether it is archived, and adds nobody.
 * - It answers somebody in the channel already as somebody it added, so
 *   OneUptime reads first who is in it.
 * - It lets the bot add a guest: being added is how a guest gets in. Guest or
 *   not, somebody outside the channel's team is refused, with a 404 only the
 *   error's id tells from a channel that is gone.
 */

// A record whose channels are shown, as its page asks for it.
interface ChannelRecordKind {
  // What the record is called in a sentence: "incident".
  noun: string;
  // The record, read with the caller's own props: null when they may not read it.
  findReadable: (data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<{ projectId?: ObjectID | undefined } | null>;
  // The record when the caller may edit it, else null.
  findUpdatable: (data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<{ _id?: string | undefined } | null>;
  // Its own channels, which no API reads: read as OneUptime.
  findChannels: (id: ObjectID) => Promise<unknown>;
  notificationFor: (id: ObjectID) => NotificationFor;
  // One feed entry on the record, by the person who added people.
  writeFeed: (data: {
    id: ObjectID;
    projectId: ObjectID;
    feedInfoInMarkdown: string;
    userId: ObjectID;
  }) => Promise<void>;
}

const RECORD_KINDS: Record<WorkspaceChannelRecordType, ChannelRecordKind> = {
  [WorkspaceChannelRecordType.Incident]: {
    noun: "incident",
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      return await IncidentService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      return await IncidentService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findChannels: async (id: ObjectID): Promise<unknown> => {
      const incident: Incident | null = await IncidentService.findOneById({
        id: id,
        select: { postUpdatesToWorkspaceChannels: true },
        props: { isRoot: true },
      });

      return incident?.postUpdatesToWorkspaceChannels;
    },
    notificationFor: (id: ObjectID): NotificationFor => {
      return { incidentId: id };
    },
    writeFeed: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      feedInfoInMarkdown: string;
      userId: ObjectID;
    }): Promise<void> => {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.id,
        projectId: data.projectId,
        incidentFeedEventType: IncidentFeedEventType.ChannelMemberAdded,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    },
  },
  [WorkspaceChannelRecordType.Alert]: {
    noun: "alert",
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Alert | null> => {
      return await AlertService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Alert | null> => {
      return await AlertService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findChannels: async (id: ObjectID): Promise<unknown> => {
      const alert: Alert | null = await AlertService.findOneById({
        id: id,
        select: { postUpdatesToWorkspaceChannels: true },
        props: { isRoot: true },
      });

      return alert?.postUpdatesToWorkspaceChannels;
    },
    notificationFor: (id: ObjectID): NotificationFor => {
      return { alertId: id };
    },
    writeFeed: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      feedInfoInMarkdown: string;
      userId: ObjectID;
    }): Promise<void> => {
      await AlertFeedService.createAlertFeedItem({
        alertId: data.id,
        projectId: data.projectId,
        alertFeedEventType: AlertFeedEventType.ChannelMemberAdded,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    },
  },
  [WorkspaceChannelRecordType.IncidentEpisode]: {
    noun: "episode",
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<IncidentEpisode | null> => {
      return await IncidentEpisodeService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<IncidentEpisode | null> => {
      return await IncidentEpisodeService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findChannels: async (id: ObjectID): Promise<unknown> => {
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: id,
          select: { postUpdatesToWorkspaceChannels: true },
          props: { isRoot: true },
        });

      return episode?.postUpdatesToWorkspaceChannels;
    },
    notificationFor: (id: ObjectID): NotificationFor => {
      return { incidentEpisodeId: id };
    },
    writeFeed: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      feedInfoInMarkdown: string;
      userId: ObjectID;
    }): Promise<void> => {
      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: data.id,
        projectId: data.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.ChannelMemberAdded,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    },
  },
  [WorkspaceChannelRecordType.AlertEpisode]: {
    noun: "episode",
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<AlertEpisode | null> => {
      return await AlertEpisodeService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<AlertEpisode | null> => {
      return await AlertEpisodeService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findChannels: async (id: ObjectID): Promise<unknown> => {
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: id,
          select: { postUpdatesToWorkspaceChannels: true },
          props: { isRoot: true },
        });

      return episode?.postUpdatesToWorkspaceChannels;
    },
    notificationFor: (id: ObjectID): NotificationFor => {
      return { alertEpisodeId: id };
    },
    writeFeed: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      feedInfoInMarkdown: string;
      userId: ObjectID;
    }): Promise<void> => {
      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: data.id,
        projectId: data.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.ChannelMemberAdded,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    },
  },
  [WorkspaceChannelRecordType.ScheduledMaintenance]: {
    noun: "maintenance event",
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<ScheduledMaintenance | null> => {
      return await ScheduledMaintenanceService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<ScheduledMaintenance | null> => {
      return await ScheduledMaintenanceService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findChannels: async (id: ObjectID): Promise<unknown> => {
      const event: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: id,
          select: { postUpdatesToWorkspaceChannels: true },
          props: { isRoot: true },
        });

      return event?.postUpdatesToWorkspaceChannels;
    },
    notificationFor: (id: ObjectID): NotificationFor => {
      return { scheduledMaintenanceId: id };
    },
    writeFeed: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      feedInfoInMarkdown: string;
      userId: ObjectID;
    }): Promise<void> => {
      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: data.id,
        projectId: data.projectId,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.ChannelMemberAdded,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    },
  },
};

// How many member ids are read from one channel.
export const WORKSPACE_CHANNEL_MEMBERS_READ_LIMIT: number = 1000;

// How many people of one channel are listed, by name.
export const WORKSPACE_CHANNEL_PEOPLE_LISTED_LIMIT: number = 100;

/*
 * How many people OneUptime asks Slack about by name in one read (users.info,
 * Tier 4); the rest come from the cache, or are counted without a name.
 */
export const WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT: number = 40;

// What OneUptime remembers about a Slack account, per project.
const PERSON_CACHE_NAMESPACE: string = "workspace-channel-person";
const PERSON_CACHE_SECONDS: number = 60 * 60;

/*
 * How inviting one person went: for them - and whether the app joined the
 * channel first - or, when the channel itself refused, for everybody.
 */
type InviteResult =
  | {
      outcome: WorkspaceChannelAddOutcome;
      joined: boolean;
      channelState?: undefined;
    }
  | {
      channelState: WorkspaceChannelState;
      outcome?: undefined;
      joined?: undefined;
    };

// How trying to add one person went: for them, or for the whole channel.
type AddAttempt =
  | { outcome: WorkspaceChannelAddOutcome; channelState?: undefined }
  | { channelState: WorkspaceChannelState; outcome?: undefined };

// What adding people to a channel came to, and the channel's link for the feed.
interface ChannelAddition extends WorkspaceChannelAddAnswer {
  channelUrl: string | null;
}

// An account in a channel, as the page's list names it.
interface KnownPerson {
  name: string;
  isBot: boolean;
  isDeactivated: boolean;
  // The project member it belongs to, when OneUptime can tell.
  userId?: string | undefined;
}

// A project's Slack connection, as this needs it.
interface SlackConnection {
  authToken: string;
  teamId: string;
  botUserId: string;
}

// A project's Mattermost connection, as this needs it.
interface ProjectMattermostConnection {
  authToken: string;
  botUserId: string;
  serverUrl: string;
  // Its teams, which a channel's address names (MattermostTeams).
  projectAuth: Pick<
    WorkspaceProjectAuthToken,
    "miscData" | "workspaceProjectId"
  >;
}

export default class WorkspaceChannelMembers {
  public static getRecordNoun(recordType: WorkspaceChannelRecordType): string {
    return RECORD_KINDS[recordType].noun;
  }

  /*
   * The record's channels and the people in each, for the person asking:
   * whether they are in it, and whether they may add people.
   */
  @CaptureSpan()
  public static async read(data: {
    recordType: WorkspaceChannelRecordType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceRecordChannels> {
    const kind: ChannelRecordKind = RECORD_KINDS[data.recordType];

    const record: { projectId?: ObjectID | undefined } | null =
      await kind.findReadable({ id: data.recordId, props: data.props });

    if (!record || !record.projectId) {
      throw new NotFoundException("This record was not found.");
    }

    const projectId: ObjectID = record.projectId;
    const channels: Array<NotificationRuleWorkspaceChannel> =
      WorkspaceChannelMembers.readChannels(
        await kind.findChannels(data.recordId),
      );

    if (channels.length === 0) {
      return { channels: [], canAddPeople: false };
    }

    const canAddPeople: boolean = await WorkspaceChannelMembers.canAddPeople({
      kind: kind,
      recordId: data.recordId,
      props: data.props,
    });

    const answer: Array<WorkspaceRecordChannel> = [];

    const slackChannels: Array<NotificationRuleWorkspaceChannel> =
      channels.filter((channel: NotificationRuleWorkspaceChannel) => {
        return channel.workspaceType === WorkspaceType.Slack;
      });
    const teamsChannels: Array<NotificationRuleWorkspaceChannel> =
      channels.filter((channel: NotificationRuleWorkspaceChannel) => {
        return channel.workspaceType === WorkspaceType.MicrosoftTeams;
      });
    const mattermostChannels: Array<NotificationRuleWorkspaceChannel> =
      channels.filter((channel: NotificationRuleWorkspaceChannel) => {
        return channel.workspaceType === WorkspaceType.Mattermost;
      });

    if (slackChannels.length > 0) {
      answer.push(
        ...(await WorkspaceChannelMembers.readSlackChannels({
          projectId: projectId,
          channels: slackChannels,
          viewerUserId: data.props.userId,
        })),
      );
    }

    if (teamsChannels.length > 0) {
      answer.push(
        ...(await WorkspaceChannelMembers.readTeamsChannels({
          projectId: projectId,
          channels: teamsChannels,
        })),
      );
    }

    if (mattermostChannels.length > 0) {
      answer.push(
        ...(await WorkspaceChannelMembers.readMattermostChannels({
          projectId: projectId,
          channels: mattermostChannels,
          viewerUserId: data.props.userId,
        })),
      );
    }

    return { channels: answer, canAddPeople: canAddPeople };
  }

  /*
   * Adds people to one of the record's own Slack or Mattermost channels: each
   * user named, and everybody in each team named, once - members of the
   * project only. Each is answered on their own (added, in it already, not
   * found in the workspace...). The channel's state is answered instead when
   * it can take nobody. Whoever was added is written to the record's feed, in
   * one entry by the person who added them, and to its Notification Logs.
   */
  @CaptureSpan()
  public static async add(data: {
    recordType: WorkspaceChannelRecordType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
    channelId: string;
    userIds: Array<ObjectID>;
    teamIds: Array<ObjectID>;
  }): Promise<WorkspaceChannelAddAnswer> {
    const kind: ChannelRecordKind = RECORD_KINDS[data.recordType];
    const actorUserId: ObjectID | undefined = data.props.userId;

    const record: { projectId?: ObjectID | undefined } | null =
      await kind.findReadable({ id: data.recordId, props: data.props });

    if (!record || !record.projectId) {
      throw new NotFoundException("This record was not found.");
    }

    const projectId: ObjectID = record.projectId;
    const cannotAdd: string = `You do not have permission to add people to this ${kind.noun}'s channel: it needs permission to edit the ${kind.noun}.`;

    if (!actorUserId) {
      throw new NotAuthorizedException(cannotAdd);
    }

    let updatable: { _id?: string | undefined } | null = null;

    try {
      updatable = await kind.findUpdatable({
        id: data.recordId,
        props: data.props,
      });
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof PaymentRequiredException
      ) {
        throw new NotAuthorizedException(cannotAdd);
      }

      throw err;
    }

    if (!updatable) {
      throw new NotAuthorizedException(cannotAdd);
    }

    const channel: NotificationRuleWorkspaceChannel | undefined =
      WorkspaceChannelMembers.readChannels(
        await kind.findChannels(data.recordId),
      ).find((candidate: NotificationRuleWorkspaceChannel) => {
        return candidate.id === data.channelId;
      });

    if (!channel) {
      throw new NotFoundException(
        `This channel is not one of this ${kind.noun}'s channels.`,
      );
    }

    if (channel.workspaceType === WorkspaceType.MicrosoftTeams) {
      throw new BadDataException(
        "People are added to a Microsoft Teams channel in Microsoft Teams: its team, or for a private channel its owners, decide who can open it.",
      );
    }

    const people: Array<ObjectID> = await WorkspaceChannelMembers.getPeople({
      projectId: projectId,
      userIds: data.userIds,
      teamIds: data.teamIds,
    });

    if (people.length === 0) {
      /*
       * A team picked in Add people with nobody in it - none of its members
       * has joined the project yet - is said so, not taken for an empty
       * request.
       */
      throw new BadDataException(
        data.userIds.length === 0 && data.teamIds.length === 1
          ? "The team you picked has nobody in it yet."
          : data.userIds.length === 0 && data.teamIds.length > 1
            ? "The teams you picked have nobody in them yet."
            : "Choose at least one person or team to add.",
      );
    }

    if (people.length > WORKSPACE_CHANNEL_ADD_MAX_PEOPLE) {
      throw new BadDataException(
        `Add at most ${WORKSPACE_CHANNEL_ADD_MAX_PEOPLE} people at a time.`,
      );
    }

    const addition: ChannelAddition =
      channel.workspaceType === WorkspaceType.Mattermost
        ? await WorkspaceChannelMembers.addToMattermostChannel({
            projectId: projectId,
            channel: channel,
            people: people,
          })
        : await WorkspaceChannelMembers.addToSlackChannel({
            projectId: projectId,
            channel: channel,
            people: people,
          });

    const added: Array<ObjectID> = addition.results
      .filter((result: WorkspaceChannelAddResult) => {
        return result.outcome === WorkspaceChannelAddOutcome.Added;
      })
      .map((result: WorkspaceChannelAddResult) => {
        return new ObjectID(result.userId);
      });

    if (added.length > 0) {
      await WorkspaceChannelMembers.recordAdditions({
        kind: kind,
        recordId: data.recordId,
        projectId: projectId,
        channel: channel,
        channelUrl: addition.channelUrl,
        actorUserId: actorUserId,
        addedUserIds: added,
      });
    }

    const answer: WorkspaceChannelAddAnswer = { results: addition.results };

    if (addition.channelState) {
      answer.channelState = addition.channelState;
    }

    return answer;
  }

  // Adds people to a Slack channel the record holds, through the app.
  private static async addToSlackChannel(data: {
    projectId: ObjectID;
    channel: NotificationRuleWorkspaceChannel;
    people: Array<ObjectID>;
  }): Promise<ChannelAddition> {
    const connection: SlackConnection | null =
      await WorkspaceChannelMembers.getSlackConnection(data.projectId);

    if (!connection) {
      return {
        channelState: WorkspaceChannelState.NotConnected,
        results: [],
        channelUrl: null,
      };
    }

    let facts: SlackChannelFacts;
    let memberIds: Array<string>;

    try {
      facts = await SlackChannelMembers.getChannel({
        authToken: connection.authToken,
        channelId: data.channel.id,
      });

      if (facts.isArchived) {
        return {
          channelState: WorkspaceChannelState.Archived,
          results: [],
          channelUrl: null,
        };
      }

      memberIds = (
        await SlackChannelMembers.getMemberIds({
          authToken: connection.authToken,
          channelId: data.channel.id,
          max: WORKSPACE_CHANNEL_MEMBERS_READ_LIMIT,
        })
      ).memberIds;
    } catch (err) {
      return {
        channelState: WorkspaceChannelMembers.getChannelStateOfError(err),
        results: [],
        channelUrl: null,
      };
    }

    let hasJoined: boolean = false;

    const answer: WorkspaceChannelAddAnswer =
      await WorkspaceChannelMembers.addEachPerson({
        projectId: data.projectId,
        people: data.people,
        addPerson: async (person: {
          userId: ObjectID;
          email: string;
        }): Promise<AddAttempt> => {
          let slackUserId: string | null = null;

          try {
            slackUserId = await WorkspaceChannelMembers.findSlackAccount({
              projectId: data.projectId,
              authToken: connection.authToken,
              userId: person.userId,
              email: person.email,
              useCache: false,
            });
          } catch (err) {
            return SlackChannelMembersError.isNotConnected(err)
              ? {
                  channelState:
                    WorkspaceChannelMembers.getChannelStateOfError(err),
                }
              : { outcome: WorkspaceChannelAddOutcome.TryAgain };
          }

          if (!slackUserId) {
            return { outcome: WorkspaceChannelAddOutcome.NotFound };
          }

          if (memberIds.includes(slackUserId)) {
            return { outcome: WorkspaceChannelAddOutcome.AlreadyIn };
          }

          const invited: InviteResult = await WorkspaceChannelMembers.invite({
            authToken: connection.authToken,
            channel: facts,
            slackUserId: slackUserId,
            mayJoin: !hasJoined,
          });

          // The channel itself refused: nobody else would be added either.
          if (invited.channelState) {
            return { channelState: invited.channelState };
          }

          hasJoined = hasJoined || invited.joined;

          if (invited.outcome === WorkspaceChannelAddOutcome.Added) {
            memberIds.push(slackUserId);
          }

          return { outcome: invited.outcome };
        },
      });

    return {
      ...answer,
      channelUrl: WorkspaceChannelLinkUtil.getSlackChannelUrl({
        teamId: connection.teamId,
        channelId: data.channel.id,
      }),
    };
  }

  /*
   * Adds people to a Mattermost channel the record holds, through the bot. It
   * reads the channel first, for what Mattermost would not refuse: an archived
   * channel, and somebody in it already.
   */
  private static async addToMattermostChannel(data: {
    projectId: ObjectID;
    channel: NotificationRuleWorkspaceChannel;
    people: Array<ObjectID>;
  }): Promise<ChannelAddition> {
    const connection: ProjectMattermostConnection | null =
      await WorkspaceChannelMembers.getMattermostConnection(data.projectId);

    if (!connection) {
      return {
        channelState: WorkspaceChannelState.NotConnected,
        results: [],
        channelUrl: null,
      };
    }

    if (!MattermostConnection.isMattermostId(data.channel.id)) {
      return {
        channelState: WorkspaceChannelState.Unreachable,
        results: [],
        channelUrl: null,
      };
    }

    let facts: MattermostChannel;
    let memberIds: Set<string>;

    try {
      facts = await MattermostUtil.getChannel({
        authToken: connection.authToken,
        channelId: data.channel.id,
      });

      if (facts.isArchived) {
        return {
          channelState: WorkspaceChannelState.Archived,
          results: [],
          channelUrl: null,
        };
      }

      memberIds = new Set<string>(
        (
          await WorkspaceChannelMembers.readMattermostMembersToAddTo({
            authToken: connection.authToken,
            channel: facts,
          })
        ).map((member: MattermostUser): string => {
          return member.id;
        }),
      );
    } catch (err) {
      return {
        channelState:
          WorkspaceChannelMembers.getMattermostChannelStateOfError(err),
        results: [],
        channelUrl: null,
      };
    }

    const answer: WorkspaceChannelAddAnswer =
      await WorkspaceChannelMembers.addEachPerson({
        projectId: data.projectId,
        people: data.people,
        addPerson: async (person: {
          userId: ObjectID;
          email: string;
        }): Promise<AddAttempt> => {
          let accountId: string | null = null;

          try {
            accountId = await WorkspaceChannelMembers.findMattermostAccount({
              projectId: data.projectId,
              authToken: connection.authToken,
              userId: person.userId,
              email: person.email,
            });
          } catch (err) {
            return MattermostUtil.isUnauthorizedError(err)
              ? { channelState: WorkspaceChannelState.NotConnected }
              : { outcome: WorkspaceChannelAddOutcome.TryAgain };
          }

          if (!accountId) {
            return { outcome: WorkspaceChannelAddOutcome.NotFound };
          }

          if (memberIds.has(accountId)) {
            return { outcome: WorkspaceChannelAddOutcome.AlreadyIn };
          }

          const attempt: AddAttempt =
            await WorkspaceChannelMembers.inviteToMattermostChannel({
              authToken: connection.authToken,
              channelId: data.channel.id,
              accountId: accountId,
            });

          if (attempt.outcome === WorkspaceChannelAddOutcome.Added) {
            memberIds.add(accountId);
          }

          return attempt;
        },
      });

    return {
      ...answer,
      channelUrl: WorkspaceChannelMembers.getMattermostChannelUrl({
        connection: connection,
        channelName: facts.name,
        teamId: facts.teamId || data.channel.teamId,
      }),
    };
  }

  /*
   * Each person in turn, members of the project only, answered on their own -
   * until the channel itself refuses, when nobody else would be added either.
   */
  private static async addEachPerson(data: {
    projectId: ObjectID;
    people: Array<ObjectID>;
    addPerson: (person: {
      userId: ObjectID;
      email: string;
    }) => Promise<AddAttempt>;
  }): Promise<WorkspaceChannelAddAnswer> {
    const users: Map<string, User> = await WorkspaceChannelMembers.getUsers(
      data.people,
    );
    const projectMemberIds: Set<string> =
      await ProjectMembership.getMemberUserIds({
        projectId: data.projectId,
        userIds: data.people,
      });

    const answer: WorkspaceChannelAddAnswer = { results: [] };

    for (const userId of data.people) {
      const key: string = userId.toString().toLowerCase();
      const user: User | undefined = users.get(key);

      const attempt: AddAttempt = projectMemberIds.has(key)
        ? await data.addPerson({
            userId: userId,
            email: user?.email?.toString() || "",
          })
        : { outcome: WorkspaceChannelAddOutcome.NotProjectMember };

      if (attempt.channelState) {
        answer.channelState = attempt.channelState;
        break;
      }

      answer.results.push({
        userId: userId.toString(),
        name: user?.name?.toString() || user?.email?.toString() || "Someone",
        outcome: attempt.outcome,
      });
    }

    return answer;
  }

  /*
   * The feed entry for people added to a channel, as the record's feed
   * shows it after the name of the person who added them: "Joined the Slack
   * channel #inc-42.", "Added Bob Jones and Carol Lee to the Mattermost channel
   * inc-42.", or both: "Joined the Slack channel #inc-42 and added Bob Jones
   * to it."
   */
  public static getFeedMarkdown(data: {
    workspaceType: WorkspaceType;
    channelName: string;
    channelUrl: string | null;
    actorJoined: boolean;
    // The others added, each as Markdown (UserService.getUserMarkdownString).
    others: Array<MarkdownText>;
  }): MarkdownText {
    const workspaceName: string = getWorkspaceTypeDisplayName(
      data.workspaceType,
    );
    const channelLabel: string =
      data.workspaceType === WorkspaceType.Slack
        ? WorkspaceChannelMembers.getSlackChannelLabel(data.channelName)
        : (data.channelName || "").trim() || "channel";
    // Placed after words on its line: its "#" starts no heading.
    const channelMarkdown: MarkdownText = data.channelUrl
      ? FeedMarkdown.link(channelLabel, data.channelUrl)
      : FeedMarkdown.textInLine(channelLabel);
    const othersMarkdown: MarkdownText = WorkspaceChannelMembers.joinNames(
      data.others.map((other: MarkdownText): MarkdownText => {
        return mdText`**${other}**`;
      }),
    );

    if (data.actorJoined && data.others.length === 0) {
      return mdText`👥 Joined the ${workspaceName} channel ${channelMarkdown}.`;
    }

    if (data.actorJoined) {
      return mdText`👥 Joined the ${workspaceName} channel ${channelMarkdown} and added ${othersMarkdown} to it.`;
    }

    return mdText`👥 Added ${othersMarkdown} to the ${workspaceName} channel ${channelMarkdown}.`;
  }

  // "#inc-42": a Slack channel as Slack writes it.
  public static getSlackChannelLabel(channelName: string): string {
    const name: string = (channelName || "").trim().replace(/^#+/, "");
    return `#${name || "channel"}`;
  }

  // "A", "A and B", "A, B and C".
  public static joinNames(names: Array<MarkdownText>): MarkdownText {
    if (names.length <= 1) {
      return names[0] || FeedMarkdown.empty();
    }

    const allButLast: MarkdownText = FeedMarkdown.join(
      names.slice(0, names.length - 1),
      ", ",
    );

    return mdText`${allButLast} and ${names[names.length - 1]!}`;
  }

  /*
   * A record's stored channels, as stored JSON is: entries that are not a
   * channel with an id are left out, and a channel stored twice is one.
   */
  public static readChannels(
    value: unknown,
  ): Array<NotificationRuleWorkspaceChannel> {
    if (!Array.isArray(value)) {
      return [];
    }

    const channels: Array<NotificationRuleWorkspaceChannel> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const channel: NotificationRuleWorkspaceChannel =
        item as NotificationRuleWorkspaceChannel;

      if (
        typeof channel.id !== "string" ||
        !channel.id ||
        (channel.workspaceType !== WorkspaceType.Slack &&
          channel.workspaceType !== WorkspaceType.MicrosoftTeams &&
          channel.workspaceType !== WorkspaceType.Mattermost)
      ) {
        continue;
      }

      const key: string = `${channel.workspaceType}:${channel.id}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      channels.push(channel);
    }

    return channels;
  }

  /*
   * Whether the caller may add people to the record's channels: a signed-in
   * person who may edit the record. Asked as an update of it would be; a
   * refusal is a no, not an error.
   */
  private static async canAddPeople(data: {
    kind: ChannelRecordKind;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (!data.props.userId) {
      return false;
    }

    try {
      return Boolean(
        await data.kind.findUpdatable({
          id: data.recordId,
          props: data.props,
        }),
      );
    } catch (err) {
      if (
        !(err instanceof NotAuthorizedException) &&
        !(err instanceof PaymentRequiredException)
      ) {
        logger.error(err);
      }

      return false;
    }
  }

  // The users and the members of the teams named, once each, in order.
  private static async getPeople(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
    teamIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const people: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    const addPerson: (userId: ObjectID) => void = (userId: ObjectID): void => {
      const key: string = userId.toString().toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        people.push(userId);
      }
    };

    data.userIds.forEach(addPerson);

    if (data.teamIds.length > 0) {
      // Only the project's own teams: another project's team adds nobody.
      const teams: Array<Team> = await TeamService.findBy({
        query: {
          _id: QueryHelper.any(
            data.teamIds.map((teamId: ObjectID) => {
              return teamId.toString();
            }),
          ),
          projectId: data.projectId,
        },
        select: { _id: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      const projectTeamIds: Array<ObjectID> = teams
        .map((team: Team): ObjectID | undefined => {
          return team.id || undefined;
        })
        .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
          return Boolean(teamId);
        });

      if (projectTeamIds.length > 0) {
        const teamUsers: Array<User> = await TeamMemberService.getUsersInTeams(
          projectTeamIds,
          { acceptedOnly: true },
        );

        for (const user of teamUsers) {
          if (user.id) {
            addPerson(user.id);
          }
        }
      }
    }

    return people;
  }

  // Names and email addresses, by lower-cased id.
  private static async getUsers(
    userIds: Array<ObjectID>,
  ): Promise<Map<string, User>> {
    const users: Map<string, User> = new Map<string, User>();

    if (userIds.length === 0) {
      return users;
    }

    const found: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(
          userIds.map((userId: ObjectID) => {
            return userId.toString();
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
        email: true,
        profilePictureId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    for (const user of found) {
      if (user.id) {
        users.set(user.id.toString().toLowerCase(), user);
      }
    }

    return users;
  }

  private static async getSlackConnection(
    projectId: ObjectID,
  ): Promise<SlackConnection | null> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth || !projectAuth.authToken) {
      return null;
    }

    const miscData: SlackMiscData | undefined = projectAuth.miscData as
      | SlackMiscData
      | undefined;

    return {
      authToken: projectAuth.authToken,
      teamId: miscData?.teamId || projectAuth.workspaceProjectId || "",
      botUserId: miscData?.botUserId || "",
    };
  }

  /*
   * Who a project member is in Slack: the account they connected, or else
   * the account with their email address (SlackAccountByEmail) - a guest's
   * too, whom Slack answers for when they are invited. Null when neither is
   * there: a deactivated account or a bot is nobody to add.
   */
  private static async findSlackAccount(data: {
    projectId: ObjectID;
    authToken: string;
    userId: ObjectID;
    email: string;
    // Whether an earlier lookup by email may answer (the page's read).
    useCache: boolean;
  }): Promise<string | null> {
    const connected: string | null =
      await WorkspaceNotificationRuleService.getWorkspaceUserIdFromOneUptimeUserId(
        {
          projectId: data.projectId,
          workspaceType: WorkspaceType.Slack,
          oneuptimeUserId: data.userId,
        },
      );

    if (connected) {
      return connected;
    }

    const account: SlackEmailAccount | null = await SlackAccountByEmail.find({
      projectId: data.projectId,
      authToken: data.authToken,
      userId: data.userId,
      email: data.email,
      useCache: data.useCache,
    });

    return account?.slackUserId || null;
  }

  /*
   * Invites one person, and answers how it went for them - or, when the
   * channel itself refused (archived, gone, the connection broken), the
   * channel's state: then nobody else could be added either. A public
   * channel the app is not in is joined first, once, as the app joins one
   * before it posts there; `joined` says it did.
   */
  private static async invite(data: {
    authToken: string;
    channel: SlackChannelFacts;
    slackUserId: string;
    mayJoin: boolean;
  }): Promise<InviteResult> {
    try {
      await SlackChannelMembers.invite({
        authToken: data.authToken,
        channelId: data.channel.id,
        slackUserId: data.slackUserId,
      });

      return { outcome: WorkspaceChannelAddOutcome.Added, joined: false };
    } catch (err) {
      const code: string | null = SlackChannelMembersError.getCode(err);

      if (code === "already_in_channel") {
        return { outcome: WorkspaceChannelAddOutcome.AlreadyIn, joined: false };
      }

      if (
        code === "not_in_channel" &&
        !data.channel.isPrivate &&
        data.mayJoin
      ) {
        try {
          await SlackChannelMembers.join({
            authToken: data.authToken,
            channelId: data.channel.id,
          });
        } catch (joinError) {
          return {
            channelState:
              WorkspaceChannelMembers.getChannelStateOfError(joinError),
          };
        }

        const afterJoining: InviteResult = await WorkspaceChannelMembers.invite(
          { ...data, mayJoin: false },
        );

        return afterJoining.channelState
          ? afterJoining
          : { outcome: afterJoining.outcome, joined: true };
      }

      // A private channel the app is not in, or one it joined in vain.
      if (code === "not_in_channel") {
        return { channelState: WorkspaceChannelState.Unreachable };
      }

      if (code === "is_archived") {
        return { channelState: WorkspaceChannelState.Archived };
      }

      if (
        SlackChannelMembersError.isChannelGone(err) ||
        SlackChannelMembersError.isNotConnected(err)
      ) {
        return {
          channelState: WorkspaceChannelMembers.getChannelStateOfError(err),
        };
      }

      if (code === "user_is_restricted" || code === "ura_max_channels") {
        return { outcome: WorkspaceChannelAddOutcome.Guest, joined: false };
      }

      if (SlackChannelMembersError.isUnavailable(err)) {
        return { outcome: WorkspaceChannelAddOutcome.TryAgain, joined: false };
      }

      logger.debug(`Slack refused to add somebody to a channel: ${code}`);
      return { outcome: WorkspaceChannelAddOutcome.Refused, joined: false };
    }
  }

  // What a failed read or write of a channel says about the channel.
  private static getChannelStateOfError(err: unknown): WorkspaceChannelState {
    if (SlackChannelMembersError.isChannelGone(err)) {
      return WorkspaceChannelState.Unreachable;
    }

    /*
     * The channel's workspace no longer has OneUptime - an Enterprise
     * organization's installation removed from it - not the project's whole
     * connection gone: its other workspaces still work.
     */
    if (SlackChannelMembersError.isWorkspaceNotAdded(err)) {
      return WorkspaceChannelState.WorkspaceNotAdded;
    }

    if (SlackChannelMembersError.isNotConnected(err)) {
      return WorkspaceChannelState.NotConnected;
    }

    if (!SlackChannelMembersError.getCode(err)) {
      logger.error(err);
    }

    return WorkspaceChannelState.Unavailable;
  }

  /*
   * The record's feed entry and its Notification Logs rows for the people
   * added. Neither may undo the additions: a failure is logged.
   */
  private static async recordAdditions(data: {
    kind: ChannelRecordKind;
    recordId: ObjectID;
    projectId: ObjectID;
    channel: NotificationRuleWorkspaceChannel;
    channelUrl: string | null;
    actorUserId: ObjectID;
    addedUserIds: Array<ObjectID>;
  }): Promise<void> {
    const notificationFor: NotificationFor = data.kind.notificationFor(
      data.recordId,
    );

    for (const userId of data.addedUserIds) {
      try {
        await WorkspaceNotificationLogService.logInviteUser(
          {
            projectId: data.projectId,
            workspaceType: data.channel.workspaceType,
            channelId: data.channel.id,
            channelName: data.channel.name,
            userId: userId,
            ...WorkspaceChannelMembers.getLogRecordIds(notificationFor),
          },
          { isRoot: true },
        );
      } catch (err) {
        logger.error("Could not log a person added to a channel.");
        logger.error(err);
      }
    }

    try {
      const actorKey: string = data.actorUserId.toString().toLowerCase();
      const others: Array<MarkdownText> = [];

      for (const userId of data.addedUserIds) {
        if (userId.toString().toLowerCase() === actorKey) {
          continue;
        }

        others.push(
          await UserService.getUserMarkdownString({
            userId: userId,
            projectId: data.projectId,
          }),
        );
      }

      const markdown: MarkdownText = WorkspaceChannelMembers.getFeedMarkdown({
        workspaceType: data.channel.workspaceType,
        channelName: data.channel.name,
        channelUrl: data.channelUrl,
        actorJoined: data.addedUserIds.some((userId: ObjectID) => {
          return userId.toString().toLowerCase() === actorKey;
        }),
        others: others,
      });

      await data.kind.writeFeed({
        id: data.recordId,
        projectId: data.projectId,
        feedInfoInMarkdown: markdown.toString(),
        userId: data.actorUserId,
      });
    } catch (err) {
      logger.error("Could not write people added to a channel to the feed.");
      logger.error(err);
    }
  }

  // The record's id, under the name a Notification Logs row gives it.
  private static getLogRecordIds(notificationFor: NotificationFor): {
    incidentId?: ObjectID;
    alertId?: ObjectID;
    incidentEpisodeId?: ObjectID;
    alertEpisodeId?: ObjectID;
    scheduledMaintenanceId?: ObjectID;
  } {
    const ids: {
      incidentId?: ObjectID;
      alertId?: ObjectID;
      incidentEpisodeId?: ObjectID;
      alertEpisodeId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
    } = {};

    if (notificationFor.incidentId) {
      ids.incidentId = notificationFor.incidentId;
    }

    if (notificationFor.alertId) {
      ids.alertId = notificationFor.alertId;
    }

    if (notificationFor.incidentEpisodeId) {
      ids.incidentEpisodeId = notificationFor.incidentEpisodeId;
    }

    if (notificationFor.alertEpisodeId) {
      ids.alertEpisodeId = notificationFor.alertEpisodeId;
    }

    if (notificationFor.scheduledMaintenanceId) {
      ids.scheduledMaintenanceId = notificationFor.scheduledMaintenanceId;
    }

    return ids;
  }

  // The record's Slack channels, each with the people in it.
  private static async readSlackChannels(data: {
    projectId: ObjectID;
    channels: Array<NotificationRuleWorkspaceChannel>;
    viewerUserId: ObjectID | undefined;
  }): Promise<Array<WorkspaceRecordChannel>> {
    const connection: SlackConnection | null =
      await WorkspaceChannelMembers.getSlackConnection(data.projectId);

    if (!connection) {
      return data.channels.map(
        (channel: NotificationRuleWorkspaceChannel): WorkspaceRecordChannel => {
          return WorkspaceChannelMembers.emptyChannel({
            channel: channel,
            state: WorkspaceChannelState.NotConnected,
            url: null,
          });
        },
      );
    }

    const viewerSlackUserId: string | null =
      await WorkspaceChannelMembers.findViewer({
        viewerUserId: data.viewerUserId,
        findAccount: (viewer: {
          userId: ObjectID;
          email: string;
        }): Promise<string | null> => {
          return WorkspaceChannelMembers.findSlackAccount({
            projectId: data.projectId,
            authToken: connection.authToken,
            userId: viewer.userId,
            email: viewer.email,
            useCache: true,
          });
        },
      });

    const answer: Array<WorkspaceRecordChannel> = [];

    for (const channel of data.channels) {
      answer.push(
        await WorkspaceChannelMembers.readSlackChannel({
          projectId: data.projectId,
          connection: connection,
          channel: channel,
          viewerUserId: data.viewerUserId,
          viewerSlackUserId: viewerSlackUserId,
        }),
      );
    }

    return answer;
  }

  // Who the person looking is in the workspace, when OneUptime can tell.
  private static async findViewer(data: {
    viewerUserId: ObjectID | undefined;
    findAccount: (viewer: {
      userId: ObjectID;
      email: string;
    }) => Promise<string | null>;
  }): Promise<string | null> {
    if (!data.viewerUserId) {
      return null;
    }

    try {
      const viewer: User | null = await UserService.findOneById({
        id: data.viewerUserId,
        select: { email: true },
        props: { isRoot: true },
      });

      return await data.findAccount({
        userId: data.viewerUserId,
        email: viewer?.email?.toString() || "",
      });
    } catch (err) {
      logger.debug("Could not tell who the viewer is in the workspace.");
      logger.debug(err);
      return null;
    }
  }

  private static async readSlackChannel(data: {
    projectId: ObjectID;
    connection: SlackConnection;
    channel: NotificationRuleWorkspaceChannel;
    viewerUserId: ObjectID | undefined;
    viewerSlackUserId: string | null;
  }): Promise<WorkspaceRecordChannel> {
    const url: string | null = WorkspaceChannelLinkUtil.getSlackChannelUrl({
      teamId: data.connection.teamId,
      channelId: data.channel.id,
    });

    let facts: SlackChannelFacts;

    try {
      facts = await SlackChannelMembers.getChannel({
        authToken: data.connection.authToken,
        channelId: data.channel.id,
      });
    } catch (err) {
      return WorkspaceChannelMembers.emptyChannel({
        channel: data.channel,
        state: WorkspaceChannelMembers.getChannelStateOfError(err),
        url: url,
      });
    }

    let memberIds: Array<string> = [];

    try {
      memberIds = (
        await SlackChannelMembers.getMemberIds({
          authToken: data.connection.authToken,
          channelId: data.channel.id,
          max: WORKSPACE_CHANNEL_MEMBERS_READ_LIMIT,
        })
      ).memberIds;
    } catch (err) {
      // An archived channel is still named as such, with nobody listed.
      return {
        ...WorkspaceChannelMembers.emptyChannel({
          channel: data.channel,
          state: facts.isArchived
            ? WorkspaceChannelState.Archived
            : WorkspaceChannelMembers.getChannelStateOfError(err),
          url: url,
        }),
        isPrivate: facts.isPrivate,
      };
    }

    const people: {
      listed: Array<WorkspaceChannelPerson>;
      count: number;
    } = await WorkspaceChannelMembers.describePeople({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Slack,
      memberIds: memberIds.filter((memberId: string) => {
        return (
          memberId !== data.connection.botUserId &&
          memberId !== SLACKBOT_USER_ID
        );
      }),
      getKnownPeople: (slackUserIds: Array<string>) => {
        return WorkspaceChannelMembers.getKnownSlackPeople({
          projectId: data.projectId,
          connection: data.connection,
          slackUserIds: slackUserIds,
        });
      },
      viewerUserId: data.viewerUserId,
      viewerAccountId: data.viewerSlackUserId,
    });

    return {
      channelId: data.channel.id,
      workspaceType: WorkspaceType.Slack,
      name: (data.channel.name || facts.name || "").trim(),
      ...(url ? { url: url } : {}),
      isPrivate: facts.isPrivate,
      state: facts.isArchived
        ? WorkspaceChannelState.Archived
        : WorkspaceChannelState.Members,
      people: people.listed,
      peopleCount: people.count,
      viewer: data.viewerSlackUserId
        ? memberIds.includes(data.viewerSlackUserId)
          ? WorkspaceChannelViewerStatus.In
          : WorkspaceChannelViewerStatus.NotIn
        : WorkspaceChannelViewerStatus.NotFound,
    };
  }

  /*
   * The people of a channel, by name: OneUptime's name and picture for an
   * account connected to it, or matched to a project member by email; the
   * workspace's name for anybody else. Apps and bots - OneUptime's own among
   * them - are left out, and so are deactivated accounts. The person looking
   * comes first, then everybody by name.
   */
  private static async describePeople(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    // The channel's accounts, without the bots that are known to be bots.
    memberIds: Array<string>;
    // What is known of the accounts not connected to OneUptime.
    getKnownPeople: (
      accountIds: Array<string>,
    ) => Promise<Map<string, KnownPerson>>;
    viewerUserId: ObjectID | undefined;
    viewerAccountId: string | null;
  }): Promise<{ listed: Array<WorkspaceChannelPerson>; count: number }> {
    // Accounts connected to OneUptime, in this project.
    const connectedRows: Array<WorkspaceUserAuthToken> =
      data.memberIds.length > 0
        ? await WorkspaceUserAuthTokenService.findBy({
            query: {
              projectId: data.projectId,
              workspaceType: data.workspaceType,
              workspaceUserId: QueryHelper.any(data.memberIds),
            },
            select: { userId: true, workspaceUserId: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          })
        : [];

    const userIdByAccountId: Map<string, string> = new Map<string, string>();

    for (const row of connectedRows) {
      if (row.workspaceUserId && row.userId) {
        userIdByAccountId.set(
          row.workspaceUserId.toString(),
          row.userId.toString(),
        );
      }
    }

    const known: Map<string, KnownPerson> = await data.getKnownPeople(
      data.memberIds.filter((memberId: string) => {
        return !userIdByAccountId.has(memberId);
      }),
    );

    for (const [accountId, person] of known) {
      if (person.userId && !userIdByAccountId.has(accountId)) {
        userIdByAccountId.set(accountId, person.userId);
      }
    }

    const users: Map<string, User> = await WorkspaceChannelMembers.getUsers(
      Array.from(new Set<string>(userIdByAccountId.values())).map(
        (userId: string) => {
          return new ObjectID(userId);
        },
      ),
    );

    const viewerKey: string = data.viewerUserId
      ? data.viewerUserId.toString().toLowerCase()
      : "";
    const listed: Array<WorkspaceChannelPerson> = [];
    let count: number = 0;

    for (const accountId of data.memberIds) {
      const userId: string | undefined = userIdByAccountId.get(accountId);
      const user: User | undefined = userId
        ? users.get(userId.toLowerCase())
        : undefined;
      const person: KnownPerson | undefined = known.get(accountId);

      if (person && (person.isBot || person.isDeactivated)) {
        continue;
      }

      count++;

      const name: string =
        user?.name?.toString() || person?.name || user?.email?.toString() || "";

      if (!name) {
        // Past the budget of names: counted, not listed.
        continue;
      }

      const isViewer: boolean =
        accountId === data.viewerAccountId ||
        Boolean(user && userId && viewerKey === userId.toLowerCase());

      listed.push({
        key: accountId,
        name: name,
        ...(user && userId ? { userId: userId } : {}),
        ...(user?.profilePictureId ? { hasProfilePicture: true } : {}),
        ...(isViewer ? { isViewer: true } : {}),
      });
    }

    listed.sort((a: WorkspaceChannelPerson, b: WorkspaceChannelPerson) => {
      if (Boolean(a.isViewer) !== Boolean(b.isViewer)) {
        return a.isViewer ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

    return {
      listed: listed.slice(0, WORKSPACE_CHANNEL_PEOPLE_LISTED_LIMIT),
      count: count,
    };
  }

  /*
   * What OneUptime knows of Slack accounts it has no connection for: from
   * the cache, or from users.info - at most
   * WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT of them a read - with the project
   * member each one's email address belongs to. An account Slack says it
   * does not know is left out.
   */
  private static async getKnownSlackPeople(data: {
    projectId: ObjectID;
    connection: SlackConnection;
    slackUserIds: Array<string>;
  }): Promise<Map<string, KnownPerson>> {
    const known: Map<string, KnownPerson> = new Map<string, KnownPerson>();

    if (data.slackUserIds.length === 0) {
      return known;
    }

    const cacheKeys: Array<string> = data.slackUserIds.map(
      (slackUserId: string) => {
        return `${data.projectId.toString()}:${slackUserId}`;
      },
    );
    const cached: Array<string | null> =
      await WorkspaceChannelMembers.readCacheMany(
        PERSON_CACHE_NAMESPACE,
        cacheKeys,
      );

    const toAsk: Array<string> = [];

    data.slackUserIds.forEach((slackUserId: string, index: number) => {
      const person: KnownPerson | null =
        WorkspaceChannelMembers.parseKnownPerson(cached[index] || null);

      if (person) {
        known.set(slackUserId, person);
      } else if (toAsk.length < WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT) {
        toAsk.push(slackUserId);
      }
    });

    const asked: Map<string, SlackPersonFacts> = new Map<
      string,
      SlackPersonFacts
    >();

    for (const slackUserId of toAsk) {
      try {
        const person: SlackPersonFacts | null =
          await SlackChannelMembers.getPerson({
            authToken: data.connection.authToken,
            slackUserId: slackUserId,
          });

        if (person) {
          asked.set(slackUserId, person);
        }
      } catch (err) {
        // Slack's rate limit, say: the rest are counted without a name.
        logger.debug("Slack did not say who a channel member is.");
        logger.debug(err);
        break;
      }
    }

    // The project members whose email addresses those accounts have.
    const emails: Array<string> = Array.from(
      new Set<string>(
        Array.from(asked.values())
          .map((person: SlackPersonFacts): string => {
            return person.email.trim().toLowerCase();
          })
          .filter((email: string): boolean => {
            return Boolean(email);
          }),
      ),
    );

    const memberIdByEmail: Map<string, string> =
      await WorkspaceChannelMembers.getProjectMembersByEmail({
        projectId: data.projectId,
        emails: emails,
      });

    for (const [slackUserId, person] of asked) {
      const userId: string | undefined = memberIdByEmail.get(
        person.email.trim().toLowerCase(),
      );
      const entry: KnownPerson = {
        name: person.name,
        isBot: person.isBot,
        isDeactivated: person.isDeactivated,
        ...(userId && !person.isBot ? { userId: userId } : {}),
      };

      known.set(slackUserId, entry);

      await WorkspaceChannelMembers.writeCache({
        namespace: PERSON_CACHE_NAMESPACE,
        key: `${data.projectId.toString()}:${slackUserId}`,
        value: JSON.stringify(entry),
        expiresInSeconds: PERSON_CACHE_SECONDS,
      });
    }

    return known;
  }

  // The project members with these email addresses, by lower-cased email.
  private static async getProjectMembersByEmail(data: {
    projectId: ObjectID;
    emails: Array<string>;
  }): Promise<Map<string, string>> {
    const byEmail: Map<string, string> = new Map<string, string>();

    if (data.emails.length === 0) {
      return byEmail;
    }

    const users: Array<User> = await UserService.findBy({
      query: { email: QueryHelper.any(data.emails) },
      select: { _id: true, email: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const memberIds: Set<string> = await ProjectMembership.getMemberUserIds({
      projectId: data.projectId,
      userIds: users
        .map((user: User): string => {
          return user.id?.toString() || "";
        })
        .filter((userId: string): boolean => {
          return Boolean(userId);
        }),
    });

    for (const user of users) {
      const userId: string = user.id?.toString() || "";
      const email: string = user.email?.toString().trim().toLowerCase() || "";

      if (userId && email && memberIds.has(userId.toLowerCase())) {
        byEmail.set(email, userId);
      }
    }

    return byEmail;
  }

  /*
   * What OneUptime needs of a project's Mattermost connection; null when it
   * has none, or one it cannot read.
   */
  private static async getMattermostConnection(
    projectId: ObjectID,
  ): Promise<ProjectMattermostConnection | null> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Mattermost,
      });

    if (!projectAuth || !projectAuth.authToken) {
      return null;
    }

    try {
      const connection: MattermostConnectionData =
        MattermostConnection.fromAuthToken(projectAuth.authToken);

      return {
        authToken: projectAuth.authToken,
        botUserId: connection.botUserId,
        serverUrl: connection.serverUrl,
        projectAuth: projectAuth,
      };
    } catch (err) {
      logger.error(err);
      return null;
    }
  }

  // A channel's address: on the server, in the team the channel is in.
  private static getMattermostChannelUrl(data: {
    connection: ProjectMattermostConnection;
    channelName: string;
    teamId: string | undefined;
  }): string | null {
    return WorkspaceChannelLinkUtil.getMattermostChannelUrl({
      serverUrl: data.connection.serverUrl,
      teamName: MattermostTeams.getTeamNameOfChannel({
        projectAuth: data.connection.projectAuth,
        teamId: data.teamId,
      }),
      channelName: data.channelName,
    });
  }

  /*
   * What a failed read of a Mattermost channel says about the channel: 401 is a
   * token it no longer takes; 403 and 404 are a channel out of the bot's sight
   * (the bot is not in it, or it was deleted). Anything else, it did not answer.
   */
  private static getMattermostChannelStateOfError(
    err: unknown,
  ): WorkspaceChannelState {
    if (MattermostUtil.isUnauthorizedError(err)) {
      return WorkspaceChannelState.NotConnected;
    }

    if (
      MattermostUtil.isForbiddenError(err) ||
      MattermostUtil.isNotFoundError(err)
    ) {
      return WorkspaceChannelState.Unreachable;
    }

    if (!(err instanceof MattermostRequestError)) {
      logger.error(err);
    }

    return WorkspaceChannelState.Unavailable;
  }

  /*
   * Who a project member is in Mattermost: the account they connected, or else
   * the account with their email address - a guest's too, whom Mattermost lets
   * in when they are added. Null when neither is there: a deactivated account
   * or a bot is nobody to add.
   */
  private static async findMattermostAccount(data: {
    projectId: ObjectID;
    authToken: string;
    userId: ObjectID;
    email: string;
  }): Promise<string | null> {
    const connected: string | null =
      await WorkspaceNotificationRuleService.getWorkspaceUserIdFromOneUptimeUserId(
        {
          projectId: data.projectId,
          workspaceType: WorkspaceType.Mattermost,
          oneuptimeUserId: data.userId,
        },
      );

    if (MattermostConnection.isMattermostId(connected)) {
      return connected;
    }

    const account: MattermostUser | null = await MattermostUtil.findUserByEmail(
      {
        authToken: data.authToken,
        email: data.email,
      },
    );

    return account && !account.isBot && !account.isDeactivated
      ? account.id
      : null;
  }

  /*
   * Who is in a channel people are about to be added to. Mattermost lists a
   * channel's people, and lets others be added, only for somebody in it. So the
   * bot joins a public channel it is not in first, as it does before it posts.
   * A private one stays refused: only somebody in it can add the bot.
   */
  private static async readMattermostMembersToAddTo(data: {
    authToken: string;
    channel: MattermostChannel;
  }): Promise<Array<MattermostUser>> {
    const read: () => Promise<Array<MattermostUser>> = (): Promise<
      Array<MattermostUser>
    > => {
      return MattermostUtil.getChannelMembers({
        authToken: data.authToken,
        channelId: data.channel.id,
        max: WORKSPACE_CHANNEL_MEMBERS_READ_LIMIT,
      });
    };

    try {
      return await read();
    } catch (err) {
      if (!MattermostUtil.isForbiddenError(err) || data.channel.type !== "O") {
        throw err;
      }
    }

    await MattermostUtil.joinChannel({
      authToken: data.authToken,
      channelId: data.channel.id,
    });

    return await read();
  }

  /*
   * Adds one account to a Mattermost channel, and answers how it went. Only the
   * error's id tells somebody outside the team, or an account that is gone,
   * from a channel that is gone or a bot that may not add anybody.
   */
  private static async inviteToMattermostChannel(data: {
    authToken: string;
    channelId: string;
    accountId: string;
  }): Promise<AddAttempt> {
    try {
      await MattermostUtil.inviteUserToChannelByChannelId({
        authToken: data.authToken,
        channelId: data.channelId,
        workspaceUserId: data.accountId,
      });

      return { outcome: WorkspaceChannelAddOutcome.Added };
    } catch (err) {
      if (MattermostUtil.isUnauthorizedError(err)) {
        return { channelState: WorkspaceChannelState.NotConnected };
      }

      if (MattermostUtil.isNotInTeamError(err)) {
        return { outcome: WorkspaceChannelAddOutcome.NotInTeam };
      }

      if (MattermostUtil.isAccountGoneError(err)) {
        return { outcome: WorkspaceChannelAddOutcome.NotFound };
      }

      // Whatever else is not found is the channel, deleted since it was read.
      if (MattermostUtil.isNotFoundError(err)) {
        return { channelState: WorkspaceChannelState.Unreachable };
      }

      if (MattermostUtil.isUnavailableError(err)) {
        return { outcome: WorkspaceChannelAddOutcome.TryAgain };
      }

      logger.debug(
        `Mattermost refused to add somebody to a channel: ${(err as MattermostRequestError).errorId}`,
      );
      return { outcome: WorkspaceChannelAddOutcome.Refused };
    }
  }

  // The record's Mattermost channels, each with the people in it.
  private static async readMattermostChannels(data: {
    projectId: ObjectID;
    channels: Array<NotificationRuleWorkspaceChannel>;
    viewerUserId: ObjectID | undefined;
  }): Promise<Array<WorkspaceRecordChannel>> {
    const connection: ProjectMattermostConnection | null =
      await WorkspaceChannelMembers.getMattermostConnection(data.projectId);

    if (!connection) {
      return data.channels.map(
        (channel: NotificationRuleWorkspaceChannel): WorkspaceRecordChannel => {
          return WorkspaceChannelMembers.emptyChannel({
            channel: channel,
            state: WorkspaceChannelState.NotConnected,
            url: null,
          });
        },
      );
    }

    const viewerAccountId: string | null =
      await WorkspaceChannelMembers.findViewer({
        viewerUserId: data.viewerUserId,
        findAccount: (viewer: {
          userId: ObjectID;
          email: string;
        }): Promise<string | null> => {
          return WorkspaceChannelMembers.findMattermostAccount({
            projectId: data.projectId,
            authToken: connection.authToken,
            userId: viewer.userId,
            email: viewer.email,
          });
        },
      });

    const answer: Array<WorkspaceRecordChannel> = [];

    for (const channel of data.channels) {
      answer.push(
        await WorkspaceChannelMembers.readMattermostChannel({
          projectId: data.projectId,
          connection: connection,
          channel: channel,
          viewerUserId: data.viewerUserId,
          viewerAccountId: viewerAccountId,
        }),
      );
    }

    return answer;
  }

  private static async readMattermostChannel(data: {
    projectId: ObjectID;
    connection: ProjectMattermostConnection;
    channel: NotificationRuleWorkspaceChannel;
    viewerUserId: ObjectID | undefined;
    viewerAccountId: string | null;
  }): Promise<WorkspaceRecordChannel> {
    const storedUrl: string | null =
      WorkspaceChannelMembers.getMattermostChannelUrl({
        connection: data.connection,
        channelName: data.channel.name,
        teamId: data.channel.teamId,
      });

    if (!MattermostConnection.isMattermostId(data.channel.id)) {
      return WorkspaceChannelMembers.emptyChannel({
        channel: data.channel,
        state: WorkspaceChannelState.Unreachable,
        url: storedUrl,
      });
    }

    let facts: MattermostChannel;

    try {
      facts = await MattermostUtil.getChannel({
        authToken: data.connection.authToken,
        channelId: data.channel.id,
      });
    } catch (err) {
      return WorkspaceChannelMembers.emptyChannel({
        channel: data.channel,
        state: WorkspaceChannelMembers.getMattermostChannelStateOfError(err),
        url: storedUrl,
      });
    }

    /*
     * Its address goes by its name now - somebody may have renamed it since
     * - else by the name stored, and always in the team Mattermost says it
     * is in: never another team's address for it.
     */
    const teamId: string | undefined = facts.teamId || data.channel.teamId;
    const url: string | null =
      WorkspaceChannelMembers.getMattermostChannelUrl({
        connection: data.connection,
        channelName: facts.name,
        teamId: teamId,
      }) ||
      WorkspaceChannelMembers.getMattermostChannelUrl({
        connection: data.connection,
        channelName: data.channel.name,
        teamId: teamId,
      });
    const isPrivate: boolean | null =
      facts.type === "P" ? true : facts.type === "O" ? false : null;

    let members: Array<MattermostUser> = [];

    try {
      members = await MattermostUtil.getChannelMembers({
        authToken: data.connection.authToken,
        channelId: data.channel.id,
        max: WORKSPACE_CHANNEL_MEMBERS_READ_LIMIT,
      });
    } catch (err) {
      // An archived channel is still named as such, with nobody listed.
      return {
        ...WorkspaceChannelMembers.emptyChannel({
          channel: data.channel,
          state: facts.isArchived
            ? WorkspaceChannelState.Archived
            : WorkspaceChannelMembers.getMattermostChannelStateOfError(err),
          url: url,
        }),
        isPrivate: isPrivate,
      };
    }

    const accounts: Array<MattermostUser> = members.filter(
      (member: MattermostUser): boolean => {
        return (
          !member.isBot &&
          !member.isDeactivated &&
          member.id !== data.connection.botUserId
        );
      },
    );
    const accountIds: Array<string> = accounts.map(
      (account: MattermostUser): string => {
        return account.id;
      },
    );

    const people: {
      listed: Array<WorkspaceChannelPerson>;
      count: number;
    } = await WorkspaceChannelMembers.describePeople({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Mattermost,
      memberIds: accountIds,
      getKnownPeople: (notConnectedIds: Array<string>) => {
        const notConnected: Set<string> = new Set<string>(notConnectedIds);

        return WorkspaceChannelMembers.getKnownMattermostPeople({
          projectId: data.projectId,
          accounts: accounts.filter((account: MattermostUser): boolean => {
            return notConnected.has(account.id);
          }),
        });
      },
      viewerUserId: data.viewerUserId,
      viewerAccountId: data.viewerAccountId,
    });

    return {
      channelId: data.channel.id,
      workspaceType: WorkspaceType.Mattermost,
      name: (data.channel.name || facts.name || "").trim(),
      ...(url ? { url: url } : {}),
      isPrivate: isPrivate,
      state: facts.isArchived
        ? WorkspaceChannelState.Archived
        : WorkspaceChannelState.Members,
      people: people.listed,
      peopleCount: people.count,
      viewer: data.viewerAccountId
        ? accountIds.includes(data.viewerAccountId)
          ? WorkspaceChannelViewerStatus.In
          : WorkspaceChannelViewerStatus.NotIn
        : WorkspaceChannelViewerStatus.NotFound,
    };
  }

  /*
   * What the channel's own list says of Mattermost accounts OneUptime has no
   * connection for: a name - their full name or nickname, else their username,
   * when the server hides those - and the project member their email address
   * belongs to, when the server shows it to the bot.
   */
  private static async getKnownMattermostPeople(data: {
    projectId: ObjectID;
    accounts: Array<MattermostUser>;
  }): Promise<Map<string, KnownPerson>> {
    const emailOf: (account: MattermostUser) => string = (
      account: MattermostUser,
    ): string => {
      return (account.email || "").toLowerCase();
    };

    const memberIdByEmail: Map<string, string> =
      await WorkspaceChannelMembers.getProjectMembersByEmail({
        projectId: data.projectId,
        emails: Array.from(new Set<string>(data.accounts.map(emailOf))).filter(
          (email: string): boolean => {
            return Boolean(email);
          },
        ),
      });

    const known: Map<string, KnownPerson> = new Map<string, KnownPerson>();

    for (const account of data.accounts) {
      const userId: string | undefined = memberIdByEmail.get(emailOf(account));

      known.set(account.id, {
        name: account.displayName || account.username,
        isBot: false,
        isDeactivated: false,
        ...(userId ? { userId: userId } : {}),
      });
    }

    return known;
  }

  /*
   * The record's Microsoft Teams channels: who can open each - its team, or
   * a private channel's own members - as Microsoft Graph tells whether it
   * is private. Nobody is listed.
   */
  private static async readTeamsChannels(data: {
    projectId: ObjectID;
    channels: Array<NotificationRuleWorkspaceChannel>;
  }): Promise<Array<WorkspaceRecordChannel>> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    const miscData: MicrosoftTeamsMiscData | undefined =
      projectAuth?.miscData as MicrosoftTeamsMiscData | undefined;
    const tenantId: string | null =
      await WorkspaceChannelLinks.getMicrosoftTeamsTenantId(data.projectId);

    const answer: Array<WorkspaceRecordChannel> = [];

    for (const channel of data.channels) {
      const url: string | null =
        WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
          tenantId: tenantId || undefined,
          teamId: channel.teamId,
          channelId: channel.id,
          channelName: channel.name,
        });

      if (!projectAuth || !projectAuth.authToken) {
        answer.push(
          WorkspaceChannelMembers.emptyChannel({
            channel: channel,
            state: WorkspaceChannelState.NotConnected,
            url: url,
          }),
        );
        continue;
      }

      const teamName: string = WorkspaceChannelMembers.getTeamName({
        miscData: miscData,
        teamId: channel.teamId,
      });

      answer.push({
        ...WorkspaceChannelMembers.emptyChannel({
          channel: channel,
          state: WorkspaceChannelState.ManagedInTeams,
          url: url,
        }),
        isPrivate: await WorkspaceChannelMembers.isTeamsChannelPrivate({
          projectId: data.projectId,
          authToken: projectAuth.authToken,
          channel: channel,
        }),
        ...(teamName ? { teamName: teamName } : {}),
      });
    }

    return answer;
  }

  // The name of the team a Teams channel is in, as the connection knows it.
  private static getTeamName(data: {
    miscData: MicrosoftTeamsMiscData | undefined;
    teamId: string | undefined;
  }): string {
    if (!data.teamId || !data.miscData) {
      return "";
    }

    const fromList: unknown = data.miscData.availableTeams?.[data.teamId]?.name;

    if (typeof fromList === "string" && fromList.trim()) {
      return fromList.trim();
    }

    if (data.miscData.teamId === data.teamId && data.miscData.teamName) {
      return data.miscData.teamName.trim();
    }

    return "";
  }

  // Whether a Teams channel is private; null when Microsoft Graph does not say.
  private static async isTeamsChannelPrivate(data: {
    projectId: ObjectID;
    authToken: string;
    channel: NotificationRuleWorkspaceChannel;
  }): Promise<boolean | null> {
    if (!data.channel.teamId) {
      return null;
    }

    try {
      const channel: WorkspaceChannel =
        await MicrosoftTeamsUtil.getWorkspaceChannelFromChannelId({
          authToken: data.authToken,
          channelId: data.channel.id,
          teamId: data.channel.teamId,
          projectId: data.projectId,
        });

      if (channel.membershipType === "private") {
        return true;
      }

      if (channel.membershipType === "standard") {
        return false;
      }

      return null;
    } catch (err) {
      logger.debug("Microsoft Graph did not say whether a channel is private.");
      logger.debug(err);
      return null;
    }
  }

  private static emptyChannel(data: {
    channel: NotificationRuleWorkspaceChannel;
    state: WorkspaceChannelState;
    url: string | null;
  }): WorkspaceRecordChannel {
    return {
      channelId: data.channel.id,
      workspaceType: data.channel.workspaceType,
      name: (data.channel.name || "").trim(),
      ...(data.url ? { url: data.url } : {}),
      isPrivate: null,
      state: data.state,
      people: [],
      peopleCount: 0,
      viewer: WorkspaceChannelViewerStatus.NotFound,
    };
  }

  private static parseKnownPerson(value: string | null): KnownPerson | null {
    if (!value) {
      return null;
    }

    try {
      const json: JSONObject = JSON.parse(value) as JSONObject;

      if (typeof json["name"] !== "string") {
        return null;
      }

      return {
        name: json["name"] as string,
        isBot: json["isBot"] === true,
        isDeactivated: json["isDeactivated"] === true,
        ...(typeof json["userId"] === "string" &&
        ObjectID.isValidUUID(json["userId"] as string)
          ? { userId: json["userId"] as string }
          : {}),
      };
    } catch {
      return null;
    }
  }

  // The cache helps; without it (no Valkey), everything is asked of Slack.
  private static async readCacheMany(
    namespace: string,
    keys: Array<string>,
  ): Promise<Array<string | null>> {
    try {
      return await GlobalCache.getStrings(namespace, keys);
    } catch {
      return keys.map(() => {
        return null;
      });
    }
  }

  private static async writeCache(data: {
    namespace: string;
    key: string;
    value: string;
    expiresInSeconds: number;
  }): Promise<void> {
    try {
      await GlobalCache.setString(data.namespace, data.key, data.value, {
        expiresInSeconds: data.expiresInSeconds,
      });
    } catch {
      // Without the cache, the next read asks Slack again.
    }
  }
}

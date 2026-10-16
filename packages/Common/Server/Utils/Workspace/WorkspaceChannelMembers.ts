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
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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
import MicrosoftTeamsUtil from "./MicrosoftTeams/MicrosoftTeams";
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
 * A workspace notification rule can create a Slack or Microsoft Teams
 * channel for an incident, an alert, an episode or a scheduled maintenance
 * event, and invites the record's people as they join the record
 * (NotificationRuleInvites). People still leave channels, a rule can miss
 * somebody, and a private Slack channel that everybody has left is entered
 * again only through an invitation from someone in it: the OneUptime app,
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
 * the Slack account with their OneUptime email address - as a page from chat
 * finds them (WorkspacePage) - so nobody has to connect their account before
 * they can be added.
 *
 * MICROSOFT TEAMS. A standard channel is open to everyone in its team, and
 * a private channel's members are managed by its owners in Microsoft Teams.
 * OneUptime neither reads nor changes them - that would take Microsoft
 * Graph's ChannelMember permissions in every tenant - and says who can open
 * the channel instead.
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
    noun: "scheduled maintenance event",
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

// Who a OneUptime member is in Slack, found by their email, per project.
const ACCOUNT_CACHE_NAMESPACE: string = "workspace-channel-account";
const ACCOUNT_CACHE_SECONDS: number = 60 * 60;
const NO_ACCOUNT_CACHE_SECONDS: number = 10 * 60;

/*
 * What the cache holds for a member nobody in Slack has the email address
 * of. Never a Slack id, which is upper-case letters and digits.
 */
const NO_ACCOUNT: string = "-";

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

// A Slack account, as the page's list names it.
interface KnownSlackPerson {
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

    return { channels: answer, canAddPeople: canAddPeople };
  }

  /*
   * Adds people to one of the record's own Slack channels: each user named,
   * and everybody in each team named, once - members of the project only.
   * Each is answered on their own (added, in it already, not found in
   * Slack...). The channel's state is answered instead when it can take
   * nobody. Whoever was added is written to the record's feed, in one entry
   * by the person who added them, and to its Notification Logs.
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

    if (channel.workspaceType !== WorkspaceType.Slack) {
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
      throw new BadDataException("Choose at least one person or team to add.");
    }

    if (people.length > WORKSPACE_CHANNEL_ADD_MAX_PEOPLE) {
      throw new BadDataException(
        `Add at most ${WORKSPACE_CHANNEL_ADD_MAX_PEOPLE} people at a time.`,
      );
    }

    const connection: SlackConnection | null =
      await WorkspaceChannelMembers.getSlackConnection(projectId);

    if (!connection) {
      return {
        channelState: WorkspaceChannelState.NotConnected,
        results: [],
      };
    }

    let facts: SlackChannelFacts;
    let memberIds: Array<string>;

    try {
      facts = await SlackChannelMembers.getChannel({
        authToken: connection.authToken,
        channelId: channel.id,
      });

      if (facts.isArchived) {
        return { channelState: WorkspaceChannelState.Archived, results: [] };
      }

      memberIds = (
        await SlackChannelMembers.getMemberIds({
          authToken: connection.authToken,
          channelId: channel.id,
          max: WORKSPACE_CHANNEL_MEMBERS_READ_LIMIT,
        })
      ).memberIds;
    } catch (err) {
      return {
        channelState: WorkspaceChannelMembers.getChannelStateOfError(err),
        results: [],
      };
    }

    const users: Map<string, User> = await WorkspaceChannelMembers.getUsers(
      people,
    );
    const projectMemberIds: Set<string> =
      await ProjectMembership.getMemberUserIds({
        projectId: projectId,
        userIds: people,
      });

    const results: Array<WorkspaceChannelAddResult> = [];
    let hasJoined: boolean = false;
    let channelState: WorkspaceChannelState | undefined = undefined;

    for (const userId of people) {
      const key: string = userId.toString().toLowerCase();
      const user: User | undefined = users.get(key);
      const name: string =
        user?.name?.toString() || user?.email?.toString() || "Someone";
      const answer: (outcome: WorkspaceChannelAddOutcome) => void = (
        outcome: WorkspaceChannelAddOutcome,
      ): void => {
        results.push({
          userId: userId.toString(),
          name: name,
          outcome: outcome,
        });
      };

      if (!projectMemberIds.has(key)) {
        answer(WorkspaceChannelAddOutcome.NotProjectMember);
        continue;
      }

      let slackUserId: string | null = null;

      try {
        slackUserId = await WorkspaceChannelMembers.findSlackAccount({
          projectId: projectId,
          authToken: connection.authToken,
          userId: userId,
          email: user?.email?.toString() || "",
          useCache: false,
        });
      } catch (err) {
        if (SlackChannelMembersError.isNotConnected(err)) {
          channelState = WorkspaceChannelState.NotConnected;
          break;
        }

        answer(WorkspaceChannelAddOutcome.TryAgain);
        continue;
      }

      if (!slackUserId) {
        answer(WorkspaceChannelAddOutcome.NotFound);
        continue;
      }

      if (memberIds.includes(slackUserId)) {
        answer(WorkspaceChannelAddOutcome.AlreadyIn);
        continue;
      }

      const invited: InviteResult = await WorkspaceChannelMembers.invite({
        authToken: connection.authToken,
        channel: facts,
        slackUserId: slackUserId,
        mayJoin: !hasJoined,
      });

      if (invited.channelState) {
        // The channel itself refused: nobody else would be added either.
        channelState = invited.channelState;
        break;
      }

      hasJoined = hasJoined || invited.joined;

      if (invited.outcome === WorkspaceChannelAddOutcome.Added) {
        memberIds.push(slackUserId);
      }

      answer(invited.outcome);
    }

    const added: Array<ObjectID> = results
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
        teamId: connection.teamId,
        actorUserId: actorUserId,
        addedUserIds: added,
      });
    }

    const answer: WorkspaceChannelAddAnswer = { results: results };

    if (channelState) {
      answer.channelState = channelState;
    }

    return answer;
  }

  /*
   * The feed entry for people added to a channel, as the record's feed
   * shows it after the name of the person who added them: "Joined the Slack
   * channel #inc-42.", "Added Bob Jones and Carol Lee to the Slack channel
   * #inc-42.", or both: "Joined the Slack channel #inc-42 and added Bob
   * Jones to it."
   */
  public static getFeedMarkdown(data: {
    channelName: string;
    channelUrl: string | null;
    actorJoined: boolean;
    // The others added, each as Markdown (UserService.getUserMarkdownString).
    others: Array<MarkdownText>;
  }): MarkdownText {
    const channelLabel: string = WorkspaceChannelMembers.getSlackChannelLabel(
      data.channelName,
    );
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
      return mdText`👥 Joined the Slack channel ${channelMarkdown}.`;
    }

    if (data.actorJoined) {
      return mdText`👥 Joined the Slack channel ${channelMarkdown} and added ${othersMarkdown} to it.`;
    }

    return mdText`👥 Added ${othersMarkdown} to the Slack channel ${channelMarkdown}.`;
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
          channel.workspaceType !== WorkspaceType.MicrosoftTeams)
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
   * the account with their email address. Null when neither is there: a
   * deactivated account or a bot is nobody to add.
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

    const email: string = data.email.trim().toLowerCase();

    if (!email) {
      return null;
    }

    const cacheKey: string = `${data.projectId.toString()}:${data.userId
      .toString()
      .toLowerCase()}`;

    if (data.useCache) {
      const cached: string | null = await WorkspaceChannelMembers.readCache(
        ACCOUNT_CACHE_NAMESPACE,
        cacheKey,
      );

      if (cached === NO_ACCOUNT) {
        return null;
      }

      if (cached) {
        return cached;
      }
    }

    const person: SlackPersonFacts | null =
      await SlackChannelMembers.findPersonByEmail({
        authToken: data.authToken,
        email: email,
      });

    const slackUserId: string | null =
      person && !person.isDeactivated && !person.isBot ? person.id : null;

    await WorkspaceChannelMembers.writeCache({
      namespace: ACCOUNT_CACHE_NAMESPACE,
      key: cacheKey,
      value: slackUserId || NO_ACCOUNT,
      expiresInSeconds: slackUserId
        ? ACCOUNT_CACHE_SECONDS
        : NO_ACCOUNT_CACHE_SECONDS,
    });

    return slackUserId;
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

      if (code === "not_in_channel" && !data.channel.isPrivate && data.mayJoin) {
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
    teamId: string;
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
            workspaceType: WorkspaceType.Slack,
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
        channelName: data.channel.name,
        channelUrl: WorkspaceChannelLinkUtil.getSlackChannelUrl({
          teamId: data.teamId,
          channelId: data.channel.id,
        }),
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
        projectId: data.projectId,
        connection: connection,
        viewerUserId: data.viewerUserId,
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

  // Who the person looking is in Slack, when OneUptime can tell.
  private static async findViewer(data: {
    projectId: ObjectID;
    connection: SlackConnection;
    viewerUserId: ObjectID | undefined;
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

      return await WorkspaceChannelMembers.findSlackAccount({
        projectId: data.projectId,
        authToken: data.connection.authToken,
        userId: data.viewerUserId,
        email: viewer?.email?.toString() || "",
        useCache: true,
      });
    } catch (err) {
      logger.debug("Could not tell who the viewer is in Slack.");
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
      connection: data.connection,
      memberIds: memberIds,
      viewerUserId: data.viewerUserId,
      viewerSlackUserId: data.viewerSlackUserId,
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
   * account connected to it, or matched to a project member by email;
   * Slack's name for anybody else. Apps and bots - OneUptime's own app among
   * them - are left out, and so are deactivated accounts. The person looking
   * comes first, then everybody by name.
   */
  private static async describePeople(data: {
    projectId: ObjectID;
    connection: SlackConnection;
    memberIds: Array<string>;
    viewerUserId: ObjectID | undefined;
    viewerSlackUserId: string | null;
  }): Promise<{ listed: Array<WorkspaceChannelPerson>; count: number }> {
    const memberIds: Array<string> = data.memberIds.filter(
      (memberId: string) => {
        return (
          memberId !== data.connection.botUserId && memberId !== SLACKBOT_USER_ID
        );
      },
    );

    // Accounts connected to OneUptime, in this project.
    const connectedRows: Array<WorkspaceUserAuthToken> =
      memberIds.length > 0
        ? await WorkspaceUserAuthTokenService.findBy({
            query: {
              projectId: data.projectId,
              workspaceType: WorkspaceType.Slack,
              workspaceUserId: QueryHelper.any(memberIds),
            },
            select: { userId: true, workspaceUserId: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          })
        : [];

    const userIdBySlackId: Map<string, string> = new Map<string, string>();

    for (const row of connectedRows) {
      if (row.workspaceUserId && row.userId) {
        userIdBySlackId.set(
          row.workspaceUserId.toString(),
          row.userId.toString(),
        );
      }
    }

    // Everybody else: from the cache, or asked of Slack, within a budget.
    const known: Map<string, KnownSlackPerson> =
      await WorkspaceChannelMembers.getKnownPeople({
        projectId: data.projectId,
        connection: data.connection,
        slackUserIds: memberIds.filter((memberId: string) => {
          return !userIdBySlackId.has(memberId);
        }),
      });

    for (const [slackUserId, person] of known) {
      if (person.userId && !userIdBySlackId.has(slackUserId)) {
        userIdBySlackId.set(slackUserId, person.userId);
      }
    }

    const users: Map<string, User> = await WorkspaceChannelMembers.getUsers(
      Array.from(new Set<string>(userIdBySlackId.values())).map(
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

    for (const slackUserId of memberIds) {
      const userId: string | undefined = userIdBySlackId.get(slackUserId);
      const user: User | undefined = userId
        ? users.get(userId.toLowerCase())
        : undefined;
      const person: KnownSlackPerson | undefined = known.get(slackUserId);

      if (person && (person.isBot || person.isDeactivated)) {
        continue;
      }

      count++;

      const name: string =
        user?.name?.toString() ||
        person?.name ||
        user?.email?.toString() ||
        "";

      if (!name) {
        // Past the budget of names: counted, not listed.
        continue;
      }

      const isViewer: boolean =
        slackUserId === data.viewerSlackUserId ||
        Boolean(user && userId && viewerKey === userId.toLowerCase());

      listed.push({
        key: slackUserId,
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
  private static async getKnownPeople(data: {
    projectId: ObjectID;
    connection: SlackConnection;
    slackUserIds: Array<string>;
  }): Promise<Map<string, KnownSlackPerson>> {
    const known: Map<string, KnownSlackPerson> = new Map<
      string,
      KnownSlackPerson
    >();

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
      const person: KnownSlackPerson | null =
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
      const entry: KnownSlackPerson = {
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

  private static parseKnownPerson(
    value: string | null,
  ): KnownSlackPerson | null {
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
  private static async readCache(
    namespace: string,
    key: string,
  ): Promise<string | null> {
    try {
      return await GlobalCache.getString(namespace, key);
    } catch {
      return null;
    }
  }

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

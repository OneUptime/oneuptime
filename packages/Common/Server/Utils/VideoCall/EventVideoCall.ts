import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green500, Red500 } from "../../../Types/BrandColors";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import VideoCallMeeting from "../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider, {
  detectVideoCallProviderFromUrl,
  isVideoCallProvider,
} from "../../../Types/VideoCall/VideoCallProvider";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertService from "../../Services/AlertService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import VideoCallConnectionService from "../../Services/VideoCallConnectionService";
import WorkspaceNotificationRuleService from "../../Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import { WorkspaceChannel } from "../Workspace/WorkspaceBase";
import logger, { LogAttributes } from "../Logger";
import SlackHuddleLink from "./Providers/SlackHuddleLink";
import VideoCallConnectionSettingsUtil from "./VideoCallConnectionSettings";
import VideoCallMessages, { VideoCallAnnouncement } from "./VideoCallMessages";

/*
 * What incident and alert video calls share: how a call is filled in before
 * it is saved, and how it is announced once it is.
 *
 * A call comes from one of three places:
 *   - a video call connection: a new meeting from Zoom, Google Meet or
 *     Microsoft Teams, or a standing meeting link;
 *   - the event's Slack channel: the channel's huddle;
 *   - a link a person gave.
 * Whatever a request says about the provider, the join link and the
 * provider's meeting id is OneUptime's to decide for the first two, so a
 * request cannot dress any link up as the incident's Zoom meeting or its
 * Slack huddle.
 */

export enum VideoCallEventType {
  Incident = "Incident",
  Alert = "Alert",
}

export interface VideoCallEvent {
  type: VideoCallEventType;
  id: ObjectID;
  projectId: ObjectID;
  // "INC-42", "#42"
  numberDisplay: string;
  title: string | undefined;
  isPrivate: boolean;
  link: string;
  // The Slack and Microsoft Teams channels the workspace rules created for it.
  workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
}

// The fields of IncidentVideoCall and AlertVideoCall a create decides.
export interface VideoCallFields {
  provider?: VideoCallProvider | undefined;
  videoCallConnectionId?: ObjectID | undefined;
  title?: string | undefined;
  joinUrl?: string | undefined;
  externalMeetingId?: string | undefined;
  workspaceNotificationRuleId?: ObjectID | undefined;
}

/*
 * The same fields on the model being created, where an unset field is
 * absent rather than undefined.
 */
export interface VideoCallFieldTarget {
  provider?: VideoCallProvider;
  videoCallConnectionId?: ObjectID;
  title?: string;
  joinUrl?: string;
  externalMeetingId?: string;
  workspaceNotificationRuleId?: ObjectID;
}

// Carried from a create's before-hook to its success hook.
export interface VideoCallCarryForward {
  connectionName?: string | undefined;
}

// The column's width; a longer title is cut, not refused.
const MAX_TITLE_LENGTH: number = 500;

export default class EventVideoCall {
  public static getEventNoun(type: VideoCallEventType): string {
    return type === VideoCallEventType.Incident ? "Incident" : "Alert";
  }

  /*
   * The event as the call needs it, read as root. Throws when it does not
   * exist - a call is never started for nothing.
   */
  public static async getEvent(data: {
    type: VideoCallEventType;
    id: ObjectID;
  }): Promise<VideoCallEvent> {
    if (data.type === VideoCallEventType.Incident) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.id,
        select: {
          _id: true,
          projectId: true,
          title: true,
          isPrivate: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          postUpdatesToWorkspaceChannels: true,
        },
        props: { isRoot: true },
      });

      if (!incident || !incident.projectId) {
        throw new BadDataException("Incident not found.");
      }

      return {
        type: data.type,
        id: data.id,
        projectId: incident.projectId,
        numberDisplay:
          incident.incidentNumberWithPrefix ||
          `#${incident.incidentNumber?.toString() || ""}`,
        title: incident.title,
        isPrivate: incident.isPrivate === true,
        link: (
          await IncidentService.getIncidentLinkInDashboard(
            incident.projectId,
            data.id,
          )
        ).toString(),
        workspaceChannels: incident.postUpdatesToWorkspaceChannels || [],
      };
    }

    const alert: Alert | null = await AlertService.findOneById({
      id: data.id,
      select: {
        _id: true,
        projectId: true,
        title: true,
        isPrivate: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        postUpdatesToWorkspaceChannels: true,
      },
      props: { isRoot: true },
    });

    if (!alert || !alert.projectId) {
      throw new BadDataException("Alert not found.");
    }

    return {
      type: data.type,
      id: data.id,
      projectId: alert.projectId,
      numberDisplay:
        alert.alertNumberWithPrefix ||
        `#${alert.alertNumber?.toString() || ""}`,
      title: alert.title,
      isPrivate: alert.isPrivate === true,
      link: (
        await AlertService.getAlertLinkInDashboard(alert.projectId, data.id)
      ).toString(),
      workspaceChannels: alert.postUpdatesToWorkspaceChannels || [],
    };
  }

  /*
   * A person, an API key or a workflow may only start a call for an event
   * they can see. The reference check reads the event as root, so a private
   * incident or alert would pass it for anyone in the project; reading it
   * here with the caller's own permissions applies the event's privacy.
   */
  public static async assertCallerCanSeeEvent(data: {
    type: VideoCallEventType;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const found: Incident | Alert | null =
      data.type === VideoCallEventType.Incident
        ? await IncidentService.findOneById({
            id: data.id,
            select: { _id: true },
            props: data.props,
          })
        : await AlertService.findOneById({
            id: data.id,
            select: { _id: true },
            props: data.props,
          });

    if (!found) {
      throw new BadDataException(
        `${EventVideoCall.getEventNoun(data.type)} not found.`,
      );
    }
  }

  // Writes prepared fields onto the record being created.
  public static applyFields(
    target: VideoCallFieldTarget,
    fields: VideoCallFields,
  ): void {
    if (fields.provider) {
      target.provider = fields.provider;
    } else {
      delete target.provider;
    }

    if (fields.videoCallConnectionId) {
      target.videoCallConnectionId = fields.videoCallConnectionId;
    } else {
      delete target.videoCallConnectionId;
    }

    if (fields.title) {
      target.title = fields.title;
    } else {
      delete target.title;
    }

    if (fields.joinUrl) {
      target.joinUrl = fields.joinUrl;
    } else {
      delete target.joinUrl;
    }

    if (fields.externalMeetingId) {
      target.externalMeetingId = fields.externalMeetingId;
    } else {
      delete target.externalMeetingId;
    }

    if (fields.workspaceNotificationRuleId) {
      target.workspaceNotificationRuleId = fields.workspaceNotificationRuleId;
    } else {
      delete target.workspaceNotificationRuleId;
    }
  }

  public static truncateTitle(title: string | undefined): string | undefined {
    const trimmed: string = (title || "").replace(/\s+/g, " ").trim();

    if (!trimmed) {
      return undefined;
    }

    return trimmed.length > MAX_TITLE_LENGTH
      ? `${trimmed.substring(0, MAX_TITLE_LENGTH - 1)}…`
      : trimmed;
  }

  /*
   * Fills in a call before it is saved, starting the meeting at the
   * provider where there is one to start. `isServerWrite` is OneUptime's own
   * write - the rule executor, which has already built a Slack huddle's link
   * from the channel it posted to - and is trusted with the fields it sets.
   */
  public static async prepare(data: {
    event: VideoCallEvent;
    fields: VideoCallFields;
    isServerWrite: boolean;
  }): Promise<{
    fields: VideoCallFields;
    carryForward: VideoCallCarryForward;
  }> {
    const fields: VideoCallFields = { ...data.fields };

    if (!data.isServerWrite) {
      // OneUptime says which meeting and which rule; a request does not.
      fields.externalMeetingId = undefined;
      fields.workspaceNotificationRuleId = undefined;
    }

    if (
      fields.provider !== undefined &&
      !isVideoCallProvider(fields.provider)
    ) {
      throw new BadDataException(
        "Provider must be one of Zoom, GoogleMeet, MicrosoftTeams, SlackHuddle or CustomLink.",
      );
    }

    // A call from a connection: a new meeting, or the standing link.
    if (fields.videoCallConnectionId) {
      const requestText: { title: string; description: string } =
        VideoCallMessages.getMeetingRequestText({
          eventNoun: EventVideoCall.getEventNoun(data.event.type),
          eventNumberDisplay: data.event.numberDisplay,
          // A private event's title stays out of a meeting anyone invited sees.
          eventTitle: data.event.isPrivate ? undefined : data.event.title,
          eventLink: data.event.link,
        });

      const started: {
        meeting: VideoCallMeeting;
        connection: { name?: string | undefined };
      } = await VideoCallConnectionService.startMeeting({
        connectionId: fields.videoCallConnectionId,
        projectId: data.event.projectId,
        request: {
          title: requestText.title,
          description: requestText.description,
        },
      });

      return {
        fields: {
          ...fields,
          provider: started.meeting.provider,
          joinUrl: started.meeting.joinUrl,
          externalMeetingId: started.meeting.externalMeetingId,
          title:
            EventVideoCall.truncateTitle(data.fields.title) ||
            EventVideoCall.truncateTitle(
              started.meeting.provider === VideoCallProvider.CustomLink
                ? started.connection.name
                : requestText.title,
            ),
        },
        carryForward: { connectionName: started.connection.name },
      };
    }

    // The huddle of the event's Slack channel.
    if (fields.provider === VideoCallProvider.SlackHuddle) {
      if (data.isServerWrite && fields.joinUrl) {
        if (
          detectVideoCallProviderFromUrl(fields.joinUrl) !==
          VideoCallProvider.SlackHuddle
        ) {
          throw new BadDataException(
            "A Slack huddle's join link must be a Slack huddle link.",
          );
        }

        return {
          fields: {
            ...fields,
            title: EventVideoCall.truncateTitle(fields.title) || "Slack huddle",
          },
          carryForward: {},
        };
      }

      const huddle: VideoCallMeeting = await EventVideoCall.getSlackHuddle({
        projectId: data.event.projectId,
        channels: data.event.workspaceChannels,
        eventNoun: EventVideoCall.getEventNoun(data.event.type),
      });

      return {
        fields: {
          ...fields,
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: huddle.joinUrl,
          externalMeetingId: huddle.externalMeetingId,
          title: EventVideoCall.truncateTitle(fields.title) || "Slack huddle",
        },
        carryForward: {},
      };
    }

    // A link of one's own.
    if (
      !data.isServerWrite &&
      fields.provider !== undefined &&
      fields.provider !== VideoCallProvider.CustomLink
    ) {
      throw new BadDataException(
        "To start a Zoom, Google Meet or Microsoft Teams call, pick one of the project's video call connections. To add a link of your own, leave the provider out.",
      );
    }

    VideoCallConnectionSettingsUtil.validateMeetingLink(
      fields.joinUrl || "",
      "Join link",
    );

    return {
      fields: {
        ...fields,
        provider:
          data.isServerWrite && fields.provider
            ? fields.provider
            : VideoCallProvider.CustomLink,
        joinUrl: (fields.joinUrl || "").trim(),
        title: EventVideoCall.truncateTitle(fields.title),
      },
      carryForward: {},
    };
  }

  /*
   * The workspace id a Slack huddle link names: the team the bot was
   * installed into.
   */
  public static async getSlackTeamId(
    projectId: ObjectID,
  ): Promise<string | null> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth) {
      return null;
    }

    const teamId: string | undefined =
      (projectAuth.miscData as SlackMiscData | undefined)?.teamId ||
      projectAuth.workspaceProjectId;

    return teamId || null;
  }

  /*
   * The huddle of the event's Slack channel: the first Slack channel a
   * workspace rule created for it, so the call is held where the incident
   * is being worked and where the rule invited its responders.
   */
  public static async getSlackHuddle(data: {
    projectId: ObjectID;
    channels: Array<WorkspaceChannel>;
    eventNoun: string;
  }): Promise<VideoCallMeeting> {
    const slackChannel: WorkspaceChannel | undefined = data.channels.find(
      (channel: WorkspaceChannel): boolean => {
        return (
          channel.workspaceType === WorkspaceType.Slack && Boolean(channel.id)
        );
      },
    );

    if (!slackChannel) {
      throw new BadDataException(
        `This ${data.eventNoun.toLowerCase()} has no Slack channel. A Slack huddle is held in the ${data.eventNoun.toLowerCase()}'s own channel, which a Slack notification rule with Create Slack Channel creates.`,
      );
    }

    const teamId: string | null = await EventVideoCall.getSlackTeamId(
      data.projectId,
    );

    if (!teamId) {
      throw new BadDataException(
        "Slack is not connected to this project. Connect it in Project Settings > Slack.",
      );
    }

    return SlackHuddleLink.getHuddle({
      teamId: teamId,
      channelId: slackChannel.id,
    });
  }

  /*
   * Posts the call where the event's updates go - its feed, and from there
   * its Slack and Microsoft Teams channels and chats - with a Join call
   * button. Never throws: the call exists whether or not it could be
   * announced, and the feed services log their own failures.
   */
  public static async announce(data: {
    eventType: VideoCallEventType;
    eventId: ObjectID;
    provider: VideoCallProvider;
    joinUrl: string;
    title?: string | undefined;
    connectionName?: string | undefined;
    workspaceNotificationRuleId?: ObjectID | undefined;
    // The person who started the call, when a person did.
    userId?: ObjectID | undefined;
  }): Promise<void> {
    try {
      const event: VideoCallEvent = await EventVideoCall.getEvent({
        type: data.eventType,
        id: data.eventId,
      });

      let ruleName: string | undefined = undefined;

      if (data.workspaceNotificationRuleId) {
        const rule: WorkspaceNotificationRule | null =
          await WorkspaceNotificationRuleService.findOneById({
            id: data.workspaceNotificationRuleId,
            select: { name: true },
            props: { isRoot: true },
          });

        ruleName = rule?.name;
      }

      const announcement: VideoCallAnnouncement = {
        eventNoun: EventVideoCall.getEventNoun(data.eventType),
        eventNumberDisplay: event.numberDisplay,
        eventLink: event.link,
        provider: data.provider,
        joinUrl: data.joinUrl,
        // A provider meeting is named for the event; only a person's own title is news.
        title:
          data.provider === VideoCallProvider.CustomLink
            ? data.title
            : undefined,
        connectionName: data.connectionName,
        ruleName: ruleName,
        startedByPerson: Boolean(data.userId),
      };

      const feedInfoInMarkdown: string =
        VideoCallMessages.getStartedFeedMarkdown(announcement).toString();
      const moreInformationInMarkdown: string | undefined =
        VideoCallMessages.getStartedFeedMoreInformationMarkdown(
          announcement,
        )?.toString();

      const workspaceNotification: {
        sendWorkspaceNotification: boolean;
        notifyUserId?: ObjectID | undefined;
        appendMessageBlocks: ReturnType<
          typeof VideoCallMessages.getJoinButtonBlocks
        >;
      } = {
        sendWorkspaceNotification: true,
        notifyUserId: data.userId,
        appendMessageBlocks: VideoCallMessages.getJoinButtonBlocks({
          provider: data.provider,
          joinUrl: data.joinUrl,
        }),
      };

      if (data.eventType === VideoCallEventType.Incident) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.eventId,
          projectId: event.projectId,
          incidentFeedEventType: IncidentFeedEventType.VideoCallStarted,
          displayColor: Green500,
          feedInfoInMarkdown: feedInfoInMarkdown,
          moreInformationInMarkdown: moreInformationInMarkdown,
          userId: data.userId,
          workspaceNotification: workspaceNotification,
        });
        return;
      }

      await AlertFeedService.createAlertFeedItem({
        alertId: data.eventId,
        projectId: event.projectId,
        alertFeedEventType: AlertFeedEventType.VideoCallStarted,
        displayColor: Green500,
        feedInfoInMarkdown: feedInfoInMarkdown,
        moreInformationInMarkdown: moreInformationInMarkdown,
        userId: data.userId,
        workspaceNotification: workspaceNotification,
      });
    } catch (error) {
      logger.error(`Could not announce a video call: ${error}`, {
        [data.eventType === VideoCallEventType.Incident
          ? "incidentId"
          : "alertId"]: data.eventId.toString(),
      } as LogAttributes);
    }
  }

  /*
   * A rule's call that could not be started, in the event's feed so the
   * responders on its page know to start one themselves. Kept to the
   * dashboard: the reason is about the project's setup, not the incident.
   * Never throws.
   */
  public static async announceFailure(data: {
    eventType: VideoCallEventType;
    eventId: ObjectID;
    projectId: ObjectID;
    ruleName: string;
    error: string;
  }): Promise<void> {
    try {
      const feedInfoInMarkdown: string =
        VideoCallMessages.getFailedFeedMarkdown({
          eventNoun: EventVideoCall.getEventNoun(data.eventType),
          ruleName: data.ruleName,
          error: data.error,
        }).toString();

      if (data.eventType === VideoCallEventType.Incident) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.eventId,
          projectId: data.projectId,
          incidentFeedEventType: IncidentFeedEventType.VideoCallFailed,
          displayColor: Red500,
          feedInfoInMarkdown: feedInfoInMarkdown,
        });
        return;
      }

      await AlertFeedService.createAlertFeedItem({
        alertId: data.eventId,
        projectId: data.projectId,
        alertFeedEventType: AlertFeedEventType.VideoCallFailed,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(`Could not record a failed video call: ${error}`, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    }
  }
}

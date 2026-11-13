import BaseService from "./BaseService";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MattermostUtil from "../Utils/Workspace/Mattermost/Mattermost";
import WorkspaceNotificationText from "../Utils/Workspace/WorkspaceNotificationText";
import { WorkspaceDirectMessageLocation } from "../Utils/Workspace/WorkspaceBase";
import logger from "../Utils/Logger";
import BlockedProjectNotifications from "../Utils/Notification/BlockedProjectNotifications";
import { recordSendResult } from "../Utils/OnCall/OnCallNotificationStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDestination,
  NotificationDispatch,
  NotificationProviderConfig,
} from "../Utils/Telemetry/NotificationDeliveryMetrics";
import {
  getDeliveryChannelOfWorkspace,
  getDeliveryProviderOfWorkspace,
} from "../Utils/Workspace/WorkspaceDeliveryMetrics";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import { WorkspaceMessageBlock } from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";

/*
 * Delivers a OneUptime notification to ONE person as a workspace direct
 * message — the send half of the Slack / Microsoft Teams / Mattermost
 * notification methods (UserSlack / UserMicrosoftTeams / UserMattermost rows
 * created under User Settings → Notification Methods).
 *
 * This is deliberately NOT part of the channel-oriented workspace machinery
 * (WorkspaceNotificationRuleService and friends): those post into project
 * channels selected by project-level rules, while this addresses a single
 * user id captured from that user's own workspace link, using the project's
 * bot credentials. SMS / Call / Telegram route through the Notification
 * FeatureSet over HTTP because provider credentials and spend accounting live
 * there; workspace bot tokens live in this database, so this service sends
 * in-process instead.
 */

/*
 * A direct message that was sent: the chat, the workspace it was sent
 * through - the Slack workspace, Microsoft 365 tenant or Mattermost team, as
 * the project's connection names it (WorkspaceProjectAuthToken
 * .workspaceProjectId) - and where it landed.
 */
export interface WorkspaceSentDirectMessage
  extends WorkspaceDirectMessageLocation {
  workspaceType: WorkspaceType;
  workspaceProjectId: string;
}

export interface SendWorkspaceDirectMessageOptions {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  /*
   * Slack: the member id (U…). Microsoft Teams: the Microsoft Entra object
   * id. Mattermost: the account id. Each is what the corresponding
   * notification-method row stores.
   */
  workspaceUserId: string;
  messageBlocks: Array<WorkspaceMessageBlock>;
  /*
   * What the phone's notification of the message says (Slack's top-level
   * text, the Teams card's summary). When left out it is the start of the
   * message (WorkspaceNotificationText): a page used to arrive with nothing
   * readable in its notification. A Mattermost notification shows the post's
   * own Markdown, so nothing is handed to it.
   */
  notificationText?: string | undefined;
  /* Short plain-text form of the message, stored on the workspace log row. */
  messageSummary?: string | undefined;
  userId?: ObjectID | undefined;
  /*
   * When set, the on-call timeline row is flipped to Sent / Error after the
   * send attempt - while it still says Sending (OnCallNotificationStatus) -
   * mirroring what the Notification FeatureSet does for the other channels.
   */
  userOnCallLogTimelineId?: ObjectID | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  onCallPolicyId?: ObjectID | undefined;
  onCallPolicyEscalationRuleId?: ObjectID | undefined;
  onCallScheduleId?: ObjectID | undefined;
  teamId?: ObjectID | undefined;
  /*
   * Told where the message landed once it is sent - to keep it, so it can
   * be edited later (a public note's approval message is replaced once the
   * note is decided). Not called when the send failed or the chat did not
   * say; a failure of its own is logged and never fails the send.
   */
  onSent?: ((sent: WorkspaceSentDirectMessage) => Promise<void>) | undefined;
}

export class WorkspaceUserNotificationService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async sendDirectMessageToUser(
    options: SendWorkspaceDirectMessageOptions,
  ): Promise<void> {
    const workspaceDisplayName: string = getWorkspaceTypeDisplayName(
      options.workspaceType,
    );

    let sendError: Error | null = null;
    let sent: WorkspaceSentDirectMessage | null = null;

    // How it went, for the platform's operator (NotificationDeliveryMetrics).
    const deliveryChannel: NotificationDeliveryChannel | null =
      getDeliveryChannelOfWorkspace(options.workspaceType);

    const dispatch: NotificationDispatch | null = deliveryChannel
      ? NotificationDeliveryMetrics.startDispatch({
          channel: deliveryChannel,
          provider: getDeliveryProviderOfWorkspace(options.workspaceType),
          // Sent as the project's own bot, through its workspace connection.
          providerConfig: NotificationProviderConfig.Project,
          isOnCallPage: Boolean(options.userOnCallLogTimelineId),
          destination: NotificationDestination.DirectMessage,
        })
      : null;

    try {
      /*
       * A project a master admin blocked, and a sample project (issue
       * #6808), send nobody a direct message (BlockedProjectNotifications):
       * the send fails with the reason, which the on-call timeline shows.
       */
      const silencedReason: string | null =
        await BlockedProjectNotifications.getSilencedReason({
          channel: `${workspaceDisplayName} message`,
          projectId: options.projectId,
        });

      if (silencedReason) {
        throw new BadDataException(silencedReason);
      }

      if (!options.workspaceUserId) {
        throw new BadDataException(
          `This account is not connected to ${workspaceDisplayName}. Please go to User Settings and connect the account.`,
        );
      }

      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: options.projectId,
          workspaceType: options.workspaceType,
        });

      if (!projectAuth || !projectAuth.authToken) {
        throw new BadDataException(
          `This project is not connected to ${workspaceDisplayName}. Please go to Project Settings and connect the account.`,
        );
      }

      const notificationText: string | undefined =
        options.notificationText ||
        WorkspaceNotificationText.fromBlocks(options.messageBlocks);

      let location: WorkspaceDirectMessageLocation | null = null;

      if (options.workspaceType === WorkspaceType.Slack) {
        location = await SlackUtil.sendDirectMessageToUser({
          authToken: projectAuth.authToken,
          workspaceUserId: options.workspaceUserId,
          messageBlocks: options.messageBlocks,
          // Escaped as Slack reads text where it is sent.
          ...(notificationText ? { text: notificationText } : {}),
        });
      } else if (options.workspaceType === WorkspaceType.MicrosoftTeams) {
        location = await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
          projectId: options.projectId,
          workspaceUserId: options.workspaceUserId,
          messageBlocks: options.messageBlocks,
          ...(notificationText ? { text: notificationText } : {}),
        });
      } else if (options.workspaceType === WorkspaceType.Mattermost) {
        location = await MattermostUtil.sendDirectMessageToUser({
          authToken: projectAuth.authToken,
          workspaceUserId: options.workspaceUserId,
          messageBlocks: options.messageBlocks,
        });
      } else {
        throw new BadDataException(
          `Direct messages are not supported for workspace type ${options.workspaceType}.`,
        );
      }

      if (location && projectAuth.workspaceProjectId) {
        sent = {
          ...location,
          workspaceType: options.workspaceType,
          workspaceProjectId: projectAuth.workspaceProjectId,
        };
      }
    } catch (error: unknown) {
      const errorMessage: string =
        error instanceof Error && error.message
          ? error.message
          : `${error as string}`;

      sendError = error instanceof Error ? error : new Error(errorMessage);

      logger.error(
        `Failed to send ${workspaceDisplayName} direct message notification.`,
      );
      logger.error(error);
    }

    dispatch?.end(
      sendError
        ? NotificationDeliveryOutcome.Failure
        : NotificationDeliveryOutcome.Success,
    );

    // Where it landed, for whoever keeps it. Best effort: it never fails the send.
    if (!sendError && sent && options.onSent) {
      try {
        await options.onSent(sent);
      } catch (keepError) {
        logger.error(
          `A ${workspaceDisplayName} direct message was sent, but OneUptime could not keep where it landed.`,
          { projectId: options.projectId.toString() },
        );
        logger.error(keepError, { projectId: options.projectId.toString() });
      }
    }

    /*
     * Log the attempt for admin visibility. Best-effort: a failed log write
     * must never turn a delivered page into a reported failure (or mask a
     * real send error with a logging one).
     */
    try {
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: options.projectId,
          workspaceType: options.workspaceType,
          actionType: WorkspaceNotificationActionType.SendMessage,
          status: sendError
            ? WorkspaceNotificationStatus.Error
            : WorkspaceNotificationStatus.Success,
          message: options.messageSummary,
          statusMessage: sendError
            ? sendError.message
            : `Direct message sent on ${workspaceDisplayName}.`,
          userId: options.userId,
          incidentId: options.incidentId,
          alertId: options.alertId,
          alertEpisodeId: options.alertEpisodeId,
          incidentEpisodeId: options.incidentEpisodeId,
          onCallDutyPolicyId: options.onCallPolicyId,
          onCallDutyPolicyEscalationRuleId:
            options.onCallPolicyEscalationRuleId,
          onCallDutyPolicyScheduleId: options.onCallScheduleId,
          teamId: options.teamId,
        },
        {
          isRoot: true,
        },
      );
    } catch (logError) {
      logger.error("Failed to write workspace notification log.");
      logger.error(logError);
    }

    /*
     * Written only while the page's timeline entry still says Sending
     * (OnCallNotificationStatus): the person may have acknowledged the page,
     * or escalated it, meanwhile - from another of its messages.
     */
    if (options.userOnCallLogTimelineId) {
      await recordSendResult({
        userOnCallLogTimelineId: options.userOnCallLogTimelineId,
        isSent: !sendError,
        statusMessage: sendError
          ? sendError.message ||
            `Failed to send ${workspaceDisplayName} direct message.`
          : `Message sent on ${workspaceDisplayName}.`,
      });
    }

    if (sendError) {
      throw sendError;
    }
  }
}

/*
 * A workspace's messages as the platform's delivery metrics name them,
 * kept with the channel posts' (WorkspaceDeliveryMetrics), which each
 * workspace's own code records.
 */
export { getDeliveryChannelOfWorkspace, getDeliveryProviderOfWorkspace };

export default new WorkspaceUserNotificationService();

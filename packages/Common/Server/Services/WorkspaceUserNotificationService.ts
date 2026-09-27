import BaseService from "./BaseService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import DiscordUtil from "../Utils/Workspace/Discord/Discord";
import { DiscordAPIError } from "../Utils/Workspace/Discord/DiscordClient";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import { WorkspaceMessageBlock } from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";

/*
 * Delivers a OneUptime notification to ONE person as a workspace direct
 * message — the send half of the Slack / Microsoft Teams / Discord
 * notification methods (UserSlack / UserMicrosoftTeams / UserDiscord rows
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

export interface SendWorkspaceDirectMessageOptions {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  /*
   * Slack: the member id (U…). Microsoft Teams: the Microsoft Entra object
   * id. Discord: the user snowflake. Each is what the corresponding
   * notification-method row stores.
   */
  workspaceUserId: string;
  messageBlocks: Array<WorkspaceMessageBlock>;
  /* Short plain-text form of the message, stored on the workspace log row. */
  messageSummary?: string | undefined;
  /* Required for Discord, whose sends re-check this user's live link. */
  userId?: ObjectID | undefined;
  /*
   * When set, the on-call timeline row is flipped to Sent / Error after the
   * send attempt, mirroring what the Notification FeatureSet does for the
   * other channels.
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

    try {
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

      if (options.workspaceType === WorkspaceType.Slack) {
        await SlackUtil.sendDirectMessageToUser({
          authToken: projectAuth.authToken,
          workspaceUserId: options.workspaceUserId,
          messageBlocks: options.messageBlocks,
        });
      } else if (options.workspaceType === WorkspaceType.MicrosoftTeams) {
        await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
          projectId: options.projectId,
          workspaceUserId: options.workspaceUserId,
          messageBlocks: options.messageBlocks,
        });
      } else if (options.workspaceType === WorkspaceType.Discord) {
        await this.assertDiscordLinkStillMatches(options);

        try {
          await DiscordUtil.sendDirectMessageToUser({
            authToken: projectAuth.authToken,
            workspaceUserId: options.workspaceUserId,
            messageBlocks: options.messageBlocks,
          });
        } catch (error) {
          /*
           * Discord answers 403 (code 50007) when the person blocks direct
           * messages from server members or no longer shares a server with
           * the bot. DiscordAPIError keeps only the status, so name the
           * likely causes instead of surfacing a bare HTTP code.
           */
          if (error instanceof DiscordAPIError && error.statusCode === 403) {
            throw new BadDataException(
              "Discord refused the direct message (HTTP 403). The account may block direct messages from server members, or may no longer be in the connected Discord server.",
            );
          }

          throw error;
        }
      } else {
        throw new BadDataException(
          `Direct messages are not supported for workspace type ${options.workspaceType}.`,
        );
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

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        id: options.userOnCallLogTimelineId,
        data: {
          status: sendError
            ? UserNotificationStatus.Error
            : UserNotificationStatus.Sent,
          statusMessage: sendError
            ? sendError.message
            : `Message sent on ${workspaceDisplayName}.`,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (sendError) {
      throw sendError;
    }
  }

  /*
   * A UserDiscord row stores the Discord user id captured when it was added.
   * Discord account links are tombstoned or relinked in place by raw writes
   * that fire no hook, so a stale method must page nobody rather than the
   * previous account: the live link has to name the same Discord user.
   */
  private async assertDiscordLinkStillMatches(
    options: SendWorkspaceDirectMessageOptions,
  ): Promise<void> {
    const staleMessage: string =
      "This Discord method no longer matches your linked Discord account. Remove it and add it again from User Settings > Notification Methods.";

    if (!options.userId) {
      throw new BadDataException(staleMessage);
    }

    const link: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.getUserAuth({
        projectId: options.projectId,
        userId: options.userId,
        workspaceType: WorkspaceType.Discord,
      });

    if (
      !link ||
      link.deletedAt ||
      !link.authToken ||
      link.workspaceUserId !== options.workspaceUserId
    ) {
      throw new BadDataException(staleMessage);
    }
  }
}

export default new WorkspaceUserNotificationService();

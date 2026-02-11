import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackAlertEpisodeMessages from "../Slack/Messages/AlertEpisode";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class AlertEpisodeWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    episodeNumber: number;
    episodeNumberWithPrefix?: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the alert episode creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            alertEpisodeId: data.alertEpisodeId,
          },
          notificationRuleEventType: NotificationRuleEventType.AlertEpisode,
          channelNameSiffix:
            data.episodeNumberWithPrefix || data.episodeNumber.toString(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(
        "Error in AlertEpisode createChannelsAndInviteUsersToChannels",
      );
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getAlertEpisodeCreateMessageBlocks(data: {
    alertEpisodeId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { alertEpisodeId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId: alertEpisodeId,
        projectId: projectId!,
      });

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId: alertEpisodeId,
        projectId: projectId!,
      });

    return [
      {
        workspaceType: WorkspaceType.Slack,
        messageBlocks: slackBlocks,
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        messageBlocks: microsoftTeamsBlocks,
      },
    ];
  }
}

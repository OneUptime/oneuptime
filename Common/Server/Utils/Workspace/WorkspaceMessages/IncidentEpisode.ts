import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackIncidentEpisodeMessages from "../Slack/Messages/IncidentEpisode";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class IncidentEpisodeWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    episodeNumber: number;
    episodeNumberWithPrefix?: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the incident episode creation with the bot token which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            incidentEpisodeId: data.incidentEpisodeId,
          },
          notificationRuleEventType: NotificationRuleEventType.IncidentEpisode,
          channelNameSiffix:
            data.episodeNumberWithPrefix || data.episodeNumber.toString(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(
        "Error in IncidentEpisode createChannelsAndInviteUsersToChannels",
      );
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getIncidentEpisodeCreateMessageBlocks(data: {
    incidentEpisodeId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { incidentEpisodeId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId: incidentEpisodeId,
        projectId: projectId!,
      });

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackIncidentEpisodeMessages.getIncidentEpisodeCreateMessageBlocks({
        incidentEpisodeId: incidentEpisodeId,
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

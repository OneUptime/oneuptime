import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackAlertMessages from "../Slack/Messages/Alert";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class AlertWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    alertNumber: number;
    alertNumberWithPrefix?: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the alert creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            alertId: data.alertId,
          },
          notificationRuleEventType: NotificationRuleEventType.Alert,
          channelNameSiffix:
            data.alertNumberWithPrefix || data.alertNumber.toString(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error("Error in createChannelsAndInviteUsersToChannels");
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getAlertCreateMessageBlocks(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { alertId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackAlertMessages.getAlertCreateMessageBlocks({
        alertId: alertId,
        projectId: projectId!,
      });

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackAlertMessages.getAlertCreateMessageBlocks({
        alertId: alertId,
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

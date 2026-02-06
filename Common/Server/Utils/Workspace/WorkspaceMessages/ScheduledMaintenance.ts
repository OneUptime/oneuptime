import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackScheduledMaintenanceMessages from "../Slack/Messages/ScheduledMaintenance";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class ScheduledMaintenanceWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    scheduledMaintenanceNumber: number;
    scheduledMaintenanceNumberWithPrefix?: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the scheduledMaintenance creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            scheduledMaintenanceId: data.scheduledMaintenanceId,
          },
          notificationRuleEventType:
            NotificationRuleEventType.ScheduledMaintenance,
          channelNameSiffix: data.scheduledMaintenanceNumber.toString(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getScheduledMaintenanceCreateMessageBlocks(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { scheduledMaintenanceId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId!,
        },
      );

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackScheduledMaintenanceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId!,
        },
      );

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

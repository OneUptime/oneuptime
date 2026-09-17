import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackMonitorMessages from "../Slack/Messages/Monitor";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class MonitorWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorName: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the monitor creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            monitorId: data.monitorId,
          },
          notificationRuleEventType: NotificationRuleEventType.Monitor,
          channelNameSiffix: data.monitorName.toString().toLowerCase(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getMonitorCreateMessageBlocks(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { monitorId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackMonitorMessages.getMonitorCreateMessageBlocks({
        monitorId: monitorId,
        projectId: projectId!,
      });

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackMonitorMessages.getMonitorCreateMessageBlocks({
        monitorId: monitorId,
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

import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackIncidentMessages from "../Slack/Messages/Incident";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class IncidentWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentNumber: number;
    incidentNumberWithPrefix?: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the incident creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            incidentId: data.incidentId,
          },
          notificationRuleEventType: NotificationRuleEventType.Incident,
          channelNameSiffix:
            data.incidentNumberWithPrefix || data.incidentNumber.toString(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getIncidentCreateMessageBlocks(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { incidentId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: incidentId,
        projectId: projectId!,
      });

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: incidentId,
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

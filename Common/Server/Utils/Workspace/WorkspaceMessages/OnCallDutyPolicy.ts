import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackOnCallDutyPolicyMessages from "../Slack/Messages/OnCallDutyPolicy";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class OnCallDutyPolicyWorkspaceMessages {
  @CaptureSpan()
  public static async createChannelsAndInviteUsersToChannels(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    onCallDutyPolicyName: string;
  }): Promise<{
    channelsCreated: NotificationRuleWorkspaceChannel[];
  } | null> {
    try {
      // we will notify the workspace about the onCallDutyPolicy creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            onCallDutyPolicyId: data.onCallDutyPolicyId,
          },
          notificationRuleEventType: NotificationRuleEventType.OnCallDutyPolicy,
          channelNameSiffix: data.onCallDutyPolicyName.toString().toLowerCase(),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getOnCallDutyPolicyCreateMessageBlocks(data: {
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { onCallDutyPolicyId, projectId } = data;

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackOnCallDutyPolicyMessages.getOnCallDutyPolicyCreateMessageBlocks(
        {
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId!,
        },
      );

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackOnCallDutyPolicyMessages.getOnCallDutyPolicyCreateMessageBlocks(
        {
          onCallDutyPolicyId: onCallDutyPolicyId,
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

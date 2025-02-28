import Incident from "../../../../Models/DatabaseModels/Incident";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import IncidentService from "../../../Services/IncidentService";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger from "../../Logger";
import SlackIncidentMessages from "../Slack/Messages/Incident";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../WorkspaceBase";

export default class IncidentWorkspaceMessages {
  public static async notifyWorkspaceOnIncidentCreate(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentNumber: number;
  }): Promise<{
    channelsCreated: WorkspaceChannel[];
    workspaceSendMessageResponse: WorkspaceSendMessageResponse;
  } | null> {
    try {
      // we will notify the workspace about the incident creation with the bot tokken which is in WorkspaceProjectAuth Table.
      return await WorkspaceNotificationRuleService.createInviteAndPostToChannelsBasedOnRules(
        {
          projectId: data.projectId,
          notificationFor: {
            incidentId: data.incidentId,
          },
          notificationRuleEventType: NotificationRuleEventType.Incident,
          channelNameSiffix: data.incidentNumber.toString(),
          messageBlocksByWorkspaceType:
            await this.getIncidentCreateMessageBlocks({
              incidentId: data.incidentId,
            }),
        },
      );
    } catch (err) {
      // log the error and continue.
      logger.error(err);
      return null;
    }
  }

  public static async getIncidentCreateMessageBlocks(data: {
    incidentId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const { incidentId } = data;
    // slack and teams workspasce types.

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        projectId: true,
        incidentNumber: true,
        title: true,
        description: true,
        incidentSeverity: {
          name: true,
        },
        rootCause: true,
        remediationNotes: true,
        currentIncidentState: {
          name: true,
        },
        monitors: {
          name: true,
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    const slackBlocks: WorkspaceMessageBlock[] =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incident: incident,
      });

    const microsoftTeamsBlocks: WorkspaceMessageBlock[] =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incident: incident,
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

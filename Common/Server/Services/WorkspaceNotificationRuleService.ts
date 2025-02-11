import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../Types/ObjectID";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceMessagePayload, { WorkspacePayloadBlock } from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";
import SlackUtil from "../Utils/Slack/Slack";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import SlackNotificationRule from "../../Types/Workspace/NotificationRules/SlackNotificationRule";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async executeNotificationRules(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    workspacePayloadBlocks: Array<WorkspacePayloadBlock>;
    alreadyCreatedChannelIds: Array<string>;
    notificationFor: {
      incidentId?: ObjectID | undefined;
    }
  }): Promise<void> {
    logger.debug("Notify Workspaces");
    logger.debug(data);

    const projectAuths: Array<WorkspaceProjectAuthToken> = await WorkspaceProjectAuthTokenService.getProjectAuths({
      projectId: data.projectId,
    });

    for (const projectAuth of projectAuths) {

      if (!projectAuth.workspaceType) {
        // No workspace type. Skipping... 
        continue;
      }

      await this.executeNotificationRuleForWorkspace({
        projectId: data.projectId,
        projectAuth: projectAuth,
        workspaceType: projectAuth.workspaceType!,
        notificationRuleEventType: data.notificationRuleEventType,
        alreadyCreatedChannelIds: data.alreadyCreatedChannelIds,
        workspacePayloadBlocks: data.workspacePayloadBlocks
      });
    }
  }


  public getWorkspaceMessagePayload(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    workspacePayloadBlocks: Array<WorkspacePayloadBlock>;
    alreadyCreatedChannelIds: Array<string>;
    notificationRules: Array<SlackNotificationRule>
  }): WorkspaceMessagePayload {

    const workspaceMessagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: data.alreadyCreatedChannelIds || [],
      blocks: data.workspacePayloadBlocks,
      createChannelsIfItDoesNotExist: false,
    };


    const channelNames: Array<string> = [];
    const createChannelIfItDoesNotExist: boolean = false;
    const postToExistingChannelNames: Array<string> = [];


    for (const notificationRule of data.notificationRules) {

    }


    return workspaceMessagePayload;
  }

  private async executeNotificationRuleForWorkspace(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    workspacePayloadBlocks: Array<WorkspacePayloadBlock>;
    projectAuth: WorkspaceProjectAuthToken;
    alreadyCreatedChannelIds: Array<string>;
  }): Promise<void> {
    logger.debug("Notify Workspace");
    logger.debug(data);


    if (!data.projectAuth.authToken) {
      logger.debug("No auth token. Skipping...");
      return;
    }

    const workspaceMessagePayload: WorkspaceMessagePayload = this.getWorkspaceMessagePayload({
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      notificationRuleEventType: data.notificationRuleEventType,
      workspacePayloadBlocks: data.workspacePayloadBlocks,
      alreadyCreatedChannelIds: data.alreadyCreatedChannelIds,
    });

    if (data.workspaceType === WorkspaceType.Slack) {
      await SlackUtil.sendMessage({
        workspaceMessagePayload: workspaceMessagePayload,
        authToken: data.projectAuth.authToken, // send from bot token.
      });
    }
  }
}
export default new Service();

import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../Types/ObjectID";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationPayload, { WorkspacePayloadBlock } from "../../Types/Workspace/WorkspaceNotificationPayload";
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


  public getWorkspaceNotificationPayload(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    workspacePayloadBlocks: Array<WorkspacePayloadBlock>;
    alreadyCreatedChannelIds: Array<string>;
    notificationRules: Array<SlackNotificationRule>
  }): WorkspaceNotificationPayload {

    const workspaceNotificationPayload: WorkspaceNotificationPayload = {
      _type: "WorkspaceNotificationPayload",
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


    return workspaceNotificationPayload;
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

    const workspaceNotificationPayload: WorkspaceNotificationPayload = this.getWorkspaceNotificationPayload({
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      notificationRuleEventType: data.notificationRuleEventType,
      workspacePayloadBlocks: data.workspacePayloadBlocks,
      alreadyCreatedChannelIds: data.alreadyCreatedChannelIds,
    });

    if (data.workspaceType === WorkspaceType.Slack) {
      await SlackUtil.sendMessage({
        workspaceNotificationPayload: workspaceNotificationPayload,
        authToken: data.projectAuth.authToken, // send from bot token.
      });
    }
  }
}
export default new Service();

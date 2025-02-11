import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationPayload from "../../Types/Workspace/WorkspaceNotificationPayload";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";
import SlackUtil from "../Utils/Slack/Slack";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/WorkspaceNotificationRule";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async sendMessage(data: {
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    workspaceNotificationPayload: WorkspaceNotificationPayload;
    authToken: string; // which auth token should we use to send.
  }): Promise<void> {
    logger.debug("Notify Workspace");
    logger.debug(data);

    if (data.workspaceType === WorkspaceType.Slack) {
      await SlackUtil.sendMessage({
        workspaceNotificationPayload: data.workspaceNotificationPayload,
        authToken: data.authToken,
      });
    }
  }
}
export default new Service();

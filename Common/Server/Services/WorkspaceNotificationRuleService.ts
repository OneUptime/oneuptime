import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import { WorkspaceNotificationPayload } from "../../Types/Workspace/WorkspaceNotificationPayload";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/WorkspaceNotificationRule";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async notifyWorkspace(data: {
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    workspaceNotificationPayload: WorkspaceNotificationPayload;
  }): Promise<void> {
    logger.debug("Notify Workspace");
    logger.debug(data);
  }
}
export default new Service();

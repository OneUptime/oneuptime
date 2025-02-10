import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/WorkspaceNotificationRule";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }


  public async notifyWorkspace(
    workspaceType: WorkspaceType; 
    notificationRuleEventType: NotificationRuleEventType;


  ): Promise<void> {

  }
}
export default new Service();

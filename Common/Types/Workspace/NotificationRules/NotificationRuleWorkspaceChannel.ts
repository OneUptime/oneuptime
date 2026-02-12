import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";

export default interface NotificationRuleWorkspaceChannel
  extends WorkspaceChannel {
  notificationRuleId: string;
  workspaceProjectAuthTokenId?: string;
}

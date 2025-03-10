import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";

export interface NotificationRuleWorkspaceChannel extends WorkspaceChannel { 
    notificationRuleId: string;
}
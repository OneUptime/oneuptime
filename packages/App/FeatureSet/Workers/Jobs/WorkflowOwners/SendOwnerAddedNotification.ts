import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowOwnerTeamService from "Common/Server/Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "Common/Server/Services/WorkflowOwnerUserService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a workflow owner rule, or a person on its Owners page,
 * made owners of a workflow (#9700), as every other record's new owners are
 * told (ResourceOwnersAdded). It waits while Workflows is switched off on
 * the server.
 */
runResourceOwnerAddedJob<Workflow>({
  jobName: "WorkflowOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.WorkflowOwnerAdded,
  eventType: NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "WorkflowOwnerUser",
  recordIdColumn: "workflowId",
  teamService: WorkflowOwnerTeamService,
  userService: WorkflowOwnerUserService,
  recordService: WorkflowService,
  noun: "workflow",
  title: "Workflow",
  getLink: (projectId: ObjectID, workflow: Workflow): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `workflows/${workflow.id!.toString()}`,
    );
  },
});

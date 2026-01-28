import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export interface WorkspaceLogData {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  channelId?: string | undefined;
  channelName?: string | undefined;
  threadId?: string | undefined;
  message?: string | undefined;
  actionType: WorkspaceNotificationActionType;
  status: WorkspaceNotificationStatus;
  statusMessage?: string | undefined;

  // Relations to resources (optional)
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  teamId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
  onCallDutyPolicyEscalationRuleId?: ObjectID | undefined;
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
  statusPageId?: ObjectID | undefined;
  statusPageAnnouncementId?: ObjectID | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  public async createWorkspaceLog(
    data: WorkspaceLogData,
    props: DatabaseCommonInteractionProps,
  ): Promise<Model> {
    const log: Model = new Model();

    // Required fields
    log.projectId = data.projectId;
    log.workspaceType = data.workspaceType;
    log.actionType = data.actionType;
    log.status = data.status;

    // Optional fields
    if (data.channelId) {
      log.channelId = data.channelId;
    }
    if (data.channelName) {
      log.channelName = data.channelName;
    }
    if (data.threadId) {
      log.threadId = data.threadId;
    }
    if (data.message) {
      log.message = data.message;
    }
    if (data.statusMessage) {
      log.statusMessage = data.statusMessage;
    }

    // Resource relations
    if (data.incidentId) {
      log.incidentId = data.incidentId;
    }
    if (data.alertId) {
      log.alertId = data.alertId;
    }
    if (data.alertEpisodeId) {
      log.alertEpisodeId = data.alertEpisodeId;
    }
    if (data.incidentEpisodeId) {
      log.incidentEpisodeId = data.incidentEpisodeId;
    }
    if (data.scheduledMaintenanceId) {
      log.scheduledMaintenanceId = data.scheduledMaintenanceId;
    }
    if (data.userId) {
      log.userId = data.userId;
    }
    if (data.teamId) {
      log.teamId = data.teamId;
    }
    if (data.onCallDutyPolicyId) {
      log.onCallDutyPolicyId = data.onCallDutyPolicyId;
    }
    if (data.onCallDutyPolicyEscalationRuleId) {
      log.onCallDutyPolicyEscalationRuleId =
        data.onCallDutyPolicyEscalationRuleId;
    }
    if (data.onCallDutyPolicyScheduleId) {
      log.onCallDutyPolicyScheduleId = data.onCallDutyPolicyScheduleId;
    }
    if (data.statusPageId) {
      log.statusPageId = data.statusPageId;
    }
    if (data.statusPageAnnouncementId) {
      log.statusPageAnnouncementId = data.statusPageAnnouncementId;
    }

    return await this.create({
      data: log,
      props,
    });
  }

  public async logCreateChannel(
    data: {
      projectId: ObjectID;
      workspaceType: WorkspaceType;
      channelId: string;
      channelName: string;
      // Optional resource associations
      incidentId?: ObjectID;
      alertId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
      onCallDutyPolicyId?: ObjectID;
      statusPageId?: ObjectID;
      statusPageAnnouncementId?: ObjectID;
    },
    props: DatabaseCommonInteractionProps,
  ): Promise<Model> {
    const logData: WorkspaceLogData = {
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      channelId: data.channelId,
      channelName: data.channelName,
      actionType: WorkspaceNotificationActionType.CreateChannel,
      status: WorkspaceNotificationStatus.Success,
      statusMessage: "Channel created successfully",
      message: `Channel "${data.channelName}" was created`,
    };

    // Add resource associations only if they exist
    if (data.incidentId) {
      logData.incidentId = data.incidentId;
    }
    if (data.alertId) {
      logData.alertId = data.alertId;
    }
    if (data.scheduledMaintenanceId) {
      logData.scheduledMaintenanceId = data.scheduledMaintenanceId;
    }
    if (data.onCallDutyPolicyId) {
      logData.onCallDutyPolicyId = data.onCallDutyPolicyId;
    }
    if (data.statusPageId) {
      logData.statusPageId = data.statusPageId;
    }
    if (data.statusPageAnnouncementId) {
      logData.statusPageAnnouncementId = data.statusPageAnnouncementId;
    }

    return await this.createWorkspaceLog(logData, props);
  }

  public async logInviteUser(
    data: {
      projectId: ObjectID;
      workspaceType: WorkspaceType;
      channelId: string;
      channelName: string;
      userId: ObjectID;
      // Optional resource associations
      incidentId?: ObjectID;
      alertId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
      onCallDutyPolicyId?: ObjectID;
      statusPageId?: ObjectID;
      statusPageAnnouncementId?: ObjectID;
    },
    props: DatabaseCommonInteractionProps,
  ): Promise<Model> {
    const logData: WorkspaceLogData = {
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      channelId: data.channelId,
      channelName: data.channelName,
      userId: data.userId,
      actionType: WorkspaceNotificationActionType.InviteUser,
      status: WorkspaceNotificationStatus.Success,
      statusMessage: "User invited to channel successfully",
      message: `User was invited to channel "${data.channelName}"`,
    };

    // Add resource associations only if they exist
    if (data.incidentId) {
      logData.incidentId = data.incidentId;
    }
    if (data.alertId) {
      logData.alertId = data.alertId;
    }
    if (data.scheduledMaintenanceId) {
      logData.scheduledMaintenanceId = data.scheduledMaintenanceId;
    }
    if (data.onCallDutyPolicyId) {
      logData.onCallDutyPolicyId = data.onCallDutyPolicyId;
    }
    if (data.statusPageId) {
      logData.statusPageId = data.statusPageId;
    }
    if (data.statusPageAnnouncementId) {
      logData.statusPageAnnouncementId = data.statusPageAnnouncementId;
    }

    return await this.createWorkspaceLog(logData, props);
  }

  public async logButtonPressed(
    data: {
      projectId: ObjectID;
      workspaceType: WorkspaceType;
      channelId?: string;
      channelName?: string;
      threadId?: string;
      userId: ObjectID;
      buttonAction: string;
      // Optional resource associations
      incidentId?: ObjectID;
      alertId?: ObjectID;
      alertEpisodeId?: ObjectID;
      incidentEpisodeId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
      onCallDutyPolicyId?: ObjectID;
      statusPageId?: ObjectID;
      statusPageAnnouncementId?: ObjectID;
    },
    props: DatabaseCommonInteractionProps,
  ): Promise<Model> {
    const logData: WorkspaceLogData = {
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      userId: data.userId,
      actionType: WorkspaceNotificationActionType.ButtonPressed,
      status: WorkspaceNotificationStatus.Success,
      statusMessage: "Button interaction completed",
      message: `User pressed button: ${data.buttonAction}`,
    };

    // Add optional properties only if they exist
    if (data.channelId) {
      logData.channelId = data.channelId;
    }
    if (data.channelName) {
      logData.channelName = data.channelName;
    }
    if (data.threadId) {
      logData.threadId = data.threadId;
    }

    // Add resource associations only if they exist
    if (data.incidentId) {
      logData.incidentId = data.incidentId;
    }
    if (data.alertId) {
      logData.alertId = data.alertId;
    }
    if (data.alertEpisodeId) {
      logData.alertEpisodeId = data.alertEpisodeId;
    }
    if (data.incidentEpisodeId) {
      logData.incidentEpisodeId = data.incidentEpisodeId;
    }
    if (data.scheduledMaintenanceId) {
      logData.scheduledMaintenanceId = data.scheduledMaintenanceId;
    }
    if (data.onCallDutyPolicyId) {
      logData.onCallDutyPolicyId = data.onCallDutyPolicyId;
    }
    if (data.statusPageId) {
      logData.statusPageId = data.statusPageId;
    }
    if (data.statusPageAnnouncementId) {
      logData.statusPageAnnouncementId = data.statusPageAnnouncementId;
    }

    return await this.createWorkspaceLog(logData, props);
  }
}

export default new Service();

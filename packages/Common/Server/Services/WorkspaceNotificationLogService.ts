import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../Types/Database/ColumnLength";
import FindBy from "../Types/Database/FindBy";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnFind } from "../Types/Database/Hooks";
import WorkspaceStoredValue from "../Utils/Workspace/WorkspaceStoredValue";
import PositiveNumber from "../../Types/PositiveNumber";
import PrivateRecordReadFilter from "../Utils/Permission/PrivateRecordReadFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
  monitorId?: ObjectID | undefined;
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

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  /*
   * A Slack or Microsoft Teams message log about a private incident, alert or episode is read only by
   * those who see that record (PrivateRecordReadFilter, #8913): the message is about the record, and its relation reads the record itself.
   * One about no private record is read as before.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = PrivateRecordReadFilter.apply(
      findBy.query,
      findBy.props,
      Model,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = PrivateRecordReadFilter.apply(
      countBy.query,
      countBy.props,
      Model,
    );

    return await super.countBy(countBy);
  }

  // The read hook narrows by the records it names. See onBeforeFind.
  public override getColumnsReadHooksNarrowBy(): Array<string> {
    return PrivateRecordReadFilter.getNamedRecordColumnNames(Model);
  }

  /*
   * Delivery logs are written by OneUptime as it sends each message, naming the
   * records it sends about, and some are written before the message goes out -
   * refusing one would stop the message. A log row written by a workflow is
   * checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * Every log is written with where its message went as the column can keep
   * it (fitChannelColumns), whoever writes it: they hand over the ids and
   * the name as the workspace gave them.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    Service.fitChannelColumns(createBy.data);

    return { createBy: createBy, carryForward: undefined };
  }

  /*
   * A log keeps the ids of where its message went whole, or leaves them out:
   * never a part of one. They are read back to find what a message in a
   * channel is about (WorkspaceReactionNote) and which project posted in a
   * channel (WorkspaceProjectResolution), and a cut id is another channel's,
   * or no channel's - a Microsoft Teams personal chat's id, 130 characters
   * and more, cut to 100 matched nothing (issue #9284). The channel's name
   * is only shown, and is cut to fit, so it never fails the log.
   */
  public static fitChannelColumns(log: Model): Model {
    for (const column of ["channelId", "threadId"] as const) {
      const id: string | undefined = log[column];

      if (typeof id === "string" && WorkspaceStoredValue.id(id) === undefined) {
        log.removeValue(column);
      }
    }

    if (typeof log.channelName === "string") {
      log.channelName = WorkspaceStoredValue.channelName(log.channelName);
    }

    return log;
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
    if (data.monitorId) {
      log.monitorId = data.monitorId;
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
      monitorId?: ObjectID;
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
    if (data.monitorId) {
      logData.monitorId = data.monitorId;
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

  /*
   * A channel the workspace did not create: the name it was asked for and
   * what it answered. Both are cut to their columns - a name too long for
   * the workspace is one reason it refuses a channel - since an over-long
   * value fails the whole insert (the name in fitChannelColumns, as every
   * log's); the message keeps the name whole.
   */
  public async logCreateChannelError(
    data: {
      projectId: ObjectID;
      workspaceType: WorkspaceType;
      channelName: string;
      error: string;
      // Optional resource associations
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
      alertEpisodeId?: ObjectID | undefined;
      incidentEpisodeId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      onCallDutyPolicyId?: ObjectID | undefined;
    },
    props: DatabaseCommonInteractionProps,
  ): Promise<Model> {
    // Each resource association is set only when it exists (createWorkspaceLog).
    return await this.createWorkspaceLog(
      {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        channelName: data.channelName,
        actionType: WorkspaceNotificationActionType.CreateChannel,
        status: WorkspaceNotificationStatus.Error,
        statusMessage: data.error.substring(0, ColumnLength.LongText),
        message: `Channel "${data.channelName}" was not created`,
        incidentId: data.incidentId,
        alertId: data.alertId,
        monitorId: data.monitorId,
        alertEpisodeId: data.alertEpisodeId,
        incidentEpisodeId: data.incidentEpisodeId,
        scheduledMaintenanceId: data.scheduledMaintenanceId,
        onCallDutyPolicyId: data.onCallDutyPolicyId,
      },
      props,
    );
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
      monitorId?: ObjectID;
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
    if (data.monitorId) {
      logData.monitorId = data.monitorId;
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

import ObjectID from "../../Types/ObjectID";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import IncidentNotificationRule from "../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentService from "./IncidentService";
import { NotificationRuleConditionCheckOn } from "../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import BadDataException from "../../Types/Exception/BadDataException";
import Label from "../../Models/DatabaseModels/Label";
import MonitorService from "./MonitorService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import { WorkspaceNotificationRuleUtil } from "../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import TeamMemberService from "./TeamMemberService";
import User from "../../Models/DatabaseModels/User";
import BaseNotificationRule from "../../Types/Workspace/NotificationRules/BaseNotificationRule";
import CreateChannelNotificationRule from "../../Types/Workspace/NotificationRules/CreateChannelNotificationRule";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";

export interface NotificationFor {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  monitorStatusTimelineId?: ObjectID | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async createInviteAndPostToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    channelNameSiffix: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<{
    channelsCreated: Array<WorkspaceChannel>;
  } | null> {

    const channelsCreated: Array<WorkspaceChannel> = [];

    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.getProjectAuths({
        projectId: data.projectId,
      });

    if (!projectAuths || projectAuths.length === 0) {
      // do nothing.
      return null;
    }

    for (const projectAuth of projectAuths) {
      if (!projectAuth.authToken) {
        continue;
      }

      if (!projectAuth.workspaceType) {
        continue;
      }

      const authToken: string = projectAuth.authToken;
      const workspaceType: WorkspaceType = projectAuth.workspaceType;

      const notificationRules: Array<Model> =
        await this.getMatchingNotificationRules({
          projectId: data.projectId,
          workspaceType: workspaceType,
          notificationRuleEventType: data.notificationRuleEventType,
          notificationFor: data.notificationFor,
        });

      if (!notificationRules || notificationRules.length === 0) {
        return null;
      }

      const createdWorkspaceChannels: Array<WorkspaceChannel> =
        await this.createChannelsBasedOnRules({
          projectOrUserAuthTokenForWorkspasce: authToken,
          workspaceType: workspaceType,
          notificationRules: notificationRules.map((rule: Model) => {
            return rule.notificationRule as CreateChannelNotificationRule;
          }),
          channelNameSiffix: data.channelNameSiffix,
          notificationEventType: data.notificationRuleEventType,
        });

      await this.inviteUsersAndTeamsToChannelsBasedOnRules({
        projectId: data.projectId,
        projectOrUserAuthTokenForWorkspasce: authToken,
        workspaceType: workspaceType,
        notificationRules: notificationRules.map((rule: Model) => {
          return rule.notificationRule as CreateChannelNotificationRule;
        }),
        channelNames: createdWorkspaceChannels.map(
          (channel: WorkspaceChannel) => {
            return channel.name;
          },
        ),
      });

      const existingChannelNames: Array<string> =
        this.getExistingChannelNamesFromNotificationRules({
          notificationRules: notificationRules.map((rule: Model) => {
            return rule.notificationRule as BaseNotificationRule;
          }),
        }) || [];

      // add created channel names to existing channel names.
      for (const channel of createdWorkspaceChannels) {
        if (!existingChannelNames.includes(channel.name)) {
          existingChannelNames.push(channel.name);
        }
      }

      await this.postToWorkspaceChannels({
        projectOrUserAuthTokenForWorkspasce: authToken,
        workspaceType: workspaceType,
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          channelNames: existingChannelNames,
          messageBlocks: data.messageBlocks,
        },
      });

      channelsCreated.push(...createdWorkspaceChannels);
    }

    return {
      channelsCreated: channelsCreated,
    };
  }

  public async postToWorkspaceChannels(data: {
    projectOrUserAuthTokenForWorkspasce: string;
    workspaceType: WorkspaceType;
    workspaceMessagePayload: WorkspaceMessagePayload;
  }): Promise<void> {
    await WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType).sendMessage({
      workspaceMessagePayload: data.workspaceMessagePayload,
      authToken: data.projectOrUserAuthTokenForWorkspasce,
    });
  }

  public async inviteUsersAndTeamsToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    projectOrUserAuthTokenForWorkspasce: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<CreateChannelNotificationRule>;
    channelNames: Array<string>;
  }): Promise<void> {
    const inviteUserIds: Array<ObjectID> =
      await this.getUsersIdsToInviteToChannel({
        notificationRules: data.notificationRules,
      });

    const workspaceUserIds: Array<string> = [];

    for (const userId of inviteUserIds) {
      const workspaceUserId: string | null =
        await this.getWorkspaceUserIdFromOneUptimeUserId({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          oneupitmeUserId: userId,
        });

      if (workspaceUserId) {
        workspaceUserIds.push(workspaceUserId);
      }
    }

    await WorkspaceUtil.getWorkspaceTypeUtil(
      data.workspaceType,
    ).inviteUsersToChannels({
      authToken: data.projectOrUserAuthTokenForWorkspasce,
      workspaceChannelInvitationPayload: {
        channelNames: data.channelNames,
        workspaceUserIds: workspaceUserIds,
      },
    });
  }

  public async getWorkspaceUserIdFromOneUptimeUserId(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    oneupitmeUserId: ObjectID;
  }): Promise<string | null> {
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          userId: data.oneupitmeUserId,
        },
        select: {
          workspaceUserId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth) {
      return null;
    }

    return userAuth.workspaceUserId?.toString() || null;
  }

  public async createChannelsBasedOnRules(data: {
    projectOrUserAuthTokenForWorkspasce: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<CreateChannelNotificationRule>;
    channelNameSiffix: string;
    notificationEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceChannel>> {
    const createdWorkspaceChannels: Array<WorkspaceChannel> = [];
    const createdChannelNames: Array<string> = [];

    const newChannelNames: Array<string> =
      this.getNewChannelNamesFromNotificationRules({
        notificationRules: data.notificationRules,
        channelNameSiffix: data.channelNameSiffix,
        notificationEventType: data.notificationEventType,
      });

    if (!newChannelNames || newChannelNames.length === 0) {
      return [];
    }

    for (const newChannelName of newChannelNames) {
      // if already created then skip it.
      if (createdChannelNames.includes(newChannelName)) {
        continue;
      }

      // create channel.
      const channel: WorkspaceChannel =
        await WorkspaceUtil.getWorkspaceTypeUtil(
          data.workspaceType,
        ).createChannel({
          authToken: data.projectOrUserAuthTokenForWorkspasce,
          channelName: newChannelName,
        });

      createdChannelNames.push(channel.name);

      createdWorkspaceChannels.push(channel);
    }

    return createdWorkspaceChannels;
  }

  public async getUsersIdsToInviteToChannel(data: {
    notificationRules: Array<CreateChannelNotificationRule>;
  }): Promise<Array<ObjectID>> {
    const inviteUserIds: Array<ObjectID> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: CreateChannelNotificationRule = notificationRule;

      if (workspaceRules.shouldCreateNewChannel) {
        if (
          workspaceRules.inviteUsersToNewChannel &&
          workspaceRules.inviteUsersToNewChannel.length > 0
        ) {
          const userIds: Array<ObjectID> =
            workspaceRules.inviteUsersToNewChannel || [];

          for (const userId of userIds) {
            if (
              !inviteUserIds.find((id: ObjectID) => {
                return id.toString() === userId.toString();
              })
            ) {
              inviteUserIds.push(new ObjectID(userId.toString()));
            }
          }
        }

        if (
          workspaceRules.inviteTeamsToNewChannel &&
          workspaceRules.inviteTeamsToNewChannel.length > 0
        ) {
          let teamIds: Array<ObjectID> =
            workspaceRules.inviteTeamsToNewChannel || [];

          teamIds = teamIds.map((teamId: ObjectID) => {
            return new ObjectID(teamId.toString());
          });

          const usersInTeam: Array<User> =
            await TeamMemberService.getUsersInTeams(teamIds);

          for (const user of usersInTeam) {
            if (
              !inviteUserIds.find((id: ObjectID) => {
                return id.toString() === user._id?.toString();
              })
            ) {
              const userId: string | undefined = user._id?.toString();
              if (userId) {
                inviteUserIds.push(new ObjectID(userId));
              }
            }
          }
        }
      }
    }

    return inviteUserIds;
  }

  public getExistingChannelNamesFromNotificationRules(data: {
    notificationRules: Array<BaseNotificationRule>;
  }): Array<string> {
    const channelNames: Array<string> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: BaseNotificationRule = notificationRule;

      if (workspaceRules.shouldPostToExistingChannel) {
        const existingChannelNames: Array<string> =
          workspaceRules.existingChannelNames.split(",");

        for (const channelName of existingChannelNames) {
          if (!channelName) {
            // if channel name is empty then skip it.
            continue;
          }

          if (!channelNames.includes(channelName)) {
            // if channel name is not already added then add it.
            channelNames.push(channelName);
          }
        }
      }
    }

    return channelNames;
  }

  public getNewChannelNamesFromNotificationRules(data: {
    notificationEventType: NotificationRuleEventType;
    notificationRules: Array<CreateChannelNotificationRule>;
    channelNameSiffix: string;
  }): Array<string> {
    const channelNames: Array<string> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: CreateChannelNotificationRule = notificationRule;

      if (
        workspaceRules.shouldCreateNewChannel &&
        workspaceRules.newChannelTemplateName
      ) {
        const newChannelName: string = workspaceRules.newChannelTemplateName || `oneuptime-${data.notificationEventType.toLowerCase()}-`;

        // add suffix and then check if it is already added or not.
        const channelName: string = newChannelName + data.channelNameSiffix;

        if (!channelNames.includes(channelName)) {
          // if channel name is not already added then add it.
          channelNames.push(channelName);
        }
      }
    }

    return channelNames;
  }

  private async getNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        eventType: data.notificationRuleEventType,
      },
      select: {
        notificationRule: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });
  }

  private async getValuesBasedOnNotificationFor(data: {
    notificationFor: NotificationFor;
  }): Promise<{
    [key in NotificationRuleConditionCheckOn]:
      | string
      | Array<string>
      | undefined;
  }> {
    if (data.notificationFor.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.notificationFor.incidentId,
        select: {
          title: true,
          description: true,
          incidentSeverity: true,
          currentIncidentState: true,
          labels: true,
          monitors: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        throw new BadDataException("Incident ID not found");
      }

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds:
            incident.monitors?.map((monitor: Incident) => {
              return monitor.id!;
            }) || [],
        });

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: incident.title || "",
        [NotificationRuleConditionCheckOn.IncidentDescription]:
          incident.description || "",
        [NotificationRuleConditionCheckOn.IncidentSeverity]:
          incident.incidentSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.IncidentState]:
          incident.currentIncidentState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]:
          incident.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]:
          incident.monitors?.map((monitor: Incident) => {
            return monitor._id?.toString() || "";
          }) || [],
      };
    }

    if (data.notificationFor.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: data.notificationFor.alertId,
        select: {
          title: true,
          description: true,
          alertSeverity: true,
          currentAlertState: true,
          labels: true,
          monitor: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        throw new BadDataException("Alert ID not found");
      }

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds: alert?.monitor?.id ? [alert?.monitor?.id] : [],
        });

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: alert.title || "",
        [NotificationRuleConditionCheckOn.AlertDescription]:
          alert.description || "",
        [NotificationRuleConditionCheckOn.AlertSeverity]:
          alert.alertSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertState]:
          alert.currentAlertState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]:
          alert.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: [
          alert.monitor?.id!.toString() || "",
        ],
      };
    }

    if (data.notificationFor.scheduledMaintenanceId) {
      const scheduledMaintenance: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: data.notificationFor.scheduledMaintenanceId,
          select: {
            title: true,
            description: true,
            currentScheduledMaintenanceState: true,
            labels: true,
            monitors: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenance) {
        throw new BadDataException("Scheduled Maintenance ID not found");
      }

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds:
            scheduledMaintenance.monitors?.map(
              (monitor: ScheduledMaintenance) => {
                return monitor.id!;
              },
            ) || [],
        });

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]:
          scheduledMaintenance.title || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          scheduledMaintenance.description || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]:
          scheduledMaintenance.currentScheduledMaintenanceState?._id?.toString() ||
          "",
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          scheduledMaintenance.labels?.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.Monitors]:
          scheduledMaintenance.monitors?.map(
            (monitor: ScheduledMaintenance) => {
              return monitor._id?.toString() || "";
            },
          ) || [],
      };
    }

    if (data.notificationFor.monitorStatusTimelineId) {
      const monitorStatusTimeline: MonitorStatusTimeline | null =
        await MonitorStatusTimelineService.findOneById({
          id: data.notificationFor.monitorStatusTimelineId,
          select: {
            monitor: {
              name: true,
              labels: true,
              monitorType: true,
            },
            monitorStatus: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!monitorStatusTimeline) {
        throw new BadDataException("Monitor Status Timeline ID not found");
      }

      const monitorLabels: Array<Label> =
        monitorStatusTimeline.monitor?.labels || [];

      return {
        [NotificationRuleConditionCheckOn.MonitorName]:
          monitorStatusTimeline.monitor?.name || "",
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]:
          monitorStatusTimeline.monitor?.monitorType || undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]:
          monitorStatusTimeline.monitorStatus?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]:
          monitorLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: [
          monitorStatusTimeline.monitor?._id?.toString() || "",
        ],
      };
    }

    throw new BadDataException("NotificationFor is not supported");
  }

  public async getMatchingNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
  }): Promise<Array<Model>> {
    const notificationRules: Array<Model> = await this.getNotificationRules({
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      notificationRuleEventType: data.notificationRuleEventType,
    });

    const values: {
      [key in NotificationRuleConditionCheckOn]:
        | string
        | Array<string>
        | undefined;
    } = await this.getValuesBasedOnNotificationFor({
      notificationFor: data.notificationFor,
    });

    const matchingNotificationRules: Array<Model> = [];

    for (const notificationRule of notificationRules) {
      if (
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule:
            notificationRule.notificationRule as IncidentNotificationRule,
          values: values,
        })
      ) {
        matchingNotificationRules.push(notificationRule);
      }
    }

    return matchingNotificationRules;
  }
}
export default new Service();

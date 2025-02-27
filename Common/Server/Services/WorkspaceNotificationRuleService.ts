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
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../Utils/Workspace/WorkspaceBase";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthToken, {
  MiscData,
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import logger from "../Utils/Logger";

export interface MessageBlocksByWorkspaceType {
  workspaceType: WorkspaceType;
  messageBlocks: Array<WorkspaceMessageBlock>;
}

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

  public static getAllWorkspaceTypes(): Array<WorkspaceType> {
    return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams];
  }

  public getBotUserIdFromprojectAuthToken(data: {
    projectAuthToken: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
  }): string {
    const miscData: MiscData | undefined = data.projectAuthToken.miscData;

    if (!miscData) {
      throw new BadDataException("Misc data not found in project auth token");
    }

    if (data.workspaceType === WorkspaceType.Slack) {
      const userId: string = (miscData as SlackMiscData).botUserId;

      if (!userId) {
        throw new BadDataException(
          "Bot user ID not found in project auth token",
        );
      }

      return userId;
    }

    throw new BadDataException("Workspace type not supported");
  }

  public async createInviteAndPostToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    channelNameSiffix: string;
    messageBlocksByWorkspaceType: Array<MessageBlocksByWorkspaceType>;
  }): Promise<{
    channelsCreated: Array<WorkspaceChannel>;
    workspaceSendMessageResponse: WorkspaceSendMessageResponse;
  } | null> {
    let workspaceSendMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
    };

    logger.debug(
      "WorkspaceNotificationRuleService.createInviteAndPostToChannelsBasedOnRules",
    );
    logger.debug(data);

    const channelsCreated: Array<WorkspaceChannel> = [];

    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.getProjectAuths({
        projectId: data.projectId,
      });

    logger.debug("projectAuths");
    logger.debug(projectAuths);

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

      logger.debug("notificationRules");
      logger.debug(notificationRules);

      if (!notificationRules || notificationRules.length === 0) {
        return null;
      }

      logger.debug("Creating channels based on rules");
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

      logger.debug("createdWorkspaceChannels");
      logger.debug(createdWorkspaceChannels);

      logger.debug("Inviting users and teams to channels based on rules");
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

      logger.debug("Getting existing channel names from notification rules");
      const existingChannelNames: Array<string> =
        this.getExistingChannelNamesFromNotificationRules({
          notificationRules: notificationRules.map((rule: Model) => {
            return rule.notificationRule as BaseNotificationRule;
          }),
        }) || [];

      logger.debug("Existing channel names:");
      logger.debug(existingChannelNames);

      logger.debug("Adding created channel names to existing channel names");
      for (const channel of createdWorkspaceChannels) {
        if (!existingChannelNames.includes(channel.name)) {
          existingChannelNames.push(channel.name);
        }
      }

      logger.debug("Final list of channel names to post messages to:");
      logger.debug(existingChannelNames);

      logger.debug("Posting messages to workspace channels");

      const messageBlocks: Array<WorkspaceMessageBlock> =
        data.messageBlocksByWorkspaceType.find(
          (messageBlock: MessageBlocksByWorkspaceType) => {
            return messageBlock.workspaceType === workspaceType;
          },
        )?.messageBlocks || [];

      if (messageBlocks.length > 0) {
        workspaceSendMessageResponse = await this.postToWorkspaceChannels({
          workspaceUserId: this.getBotUserIdFromprojectAuthToken({
            projectAuthToken: projectAuth,
            workspaceType: workspaceType,
          }),
          projectOrUserAuthTokenForWorkspasce: authToken,
          workspaceType: workspaceType,
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            channelNames: existingChannelNames,
            channelIds: [],
            messageBlocks: messageBlocks,
          },
        });
      }

      logger.debug("Channels created:");
      logger.debug(createdWorkspaceChannels);

      channelsCreated.push(...createdWorkspaceChannels);
    }

    logger.debug("Returning created channels");
    return {
      channelsCreated: channelsCreated,
      workspaceSendMessageResponse: workspaceSendMessageResponse,
    };
  }

  public async postToWorkspaceChannels(data: {
    workspaceUserId: string;
    projectOrUserAuthTokenForWorkspasce: string;
    workspaceType: WorkspaceType;
    workspaceMessagePayload: WorkspaceMessagePayload;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("postToWorkspaceChannels called with data:");
    logger.debug(data);

    const result: WorkspaceSendMessageResponse =
      await WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType).sendMessage({
        userId: data.workspaceUserId,
        workspaceMessagePayload: data.workspaceMessagePayload,
        authToken: data.projectOrUserAuthTokenForWorkspasce,
      });

    logger.debug("Message posted to workspace channels successfully");
    logger.debug("Returning thread IDs");
    logger.debug(result);

    return result;
  }

  public async inviteUsersAndTeamsToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    projectOrUserAuthTokenForWorkspasce: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<CreateChannelNotificationRule>;
    channelNames: Array<string>;
  }): Promise<void> {
    logger.debug("inviteUsersAndTeamsToChannelsBasedOnRules called with data:");
    logger.debug(data);

    const inviteUserIds: Array<ObjectID> =
      await this.getUsersIdsToInviteToChannel({
        notificationRules: data.notificationRules,
      });

    logger.debug("User IDs to invite:");
    logger.debug(inviteUserIds);

    const workspaceUserIds: Array<string> = [];

    for (const userId of inviteUserIds) {
      const workspaceUserId: string | null =
        await this.getWorkspaceUserIdFromOneUptimeUserId({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          oneuptimeUserId: userId,
        });

      if (workspaceUserId) {
        workspaceUserIds.push(workspaceUserId);
      }
    }

    logger.debug("Workspace User IDs to invite:");
    logger.debug(workspaceUserIds);

    await WorkspaceUtil.getWorkspaceTypeUtil(
      data.workspaceType,
    ).inviteUsersToChannels({
      authToken: data.projectOrUserAuthTokenForWorkspasce,
      workspaceChannelInvitationPayload: {
        channelNames: data.channelNames,
        workspaceUserIds: workspaceUserIds,
      },
    });

    logger.debug("Users invited to channels successfully");
  }

  public async getWorkspaceUserIdFromOneUptimeUserId(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    oneuptimeUserId: ObjectID;
  }): Promise<string | null> {
    logger.debug("getWorkspaceUserIdFromOneUptimeUserId called with data:");
    logger.debug(data);

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          userId: data.oneuptimeUserId,
        },
        select: {
          workspaceUserId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth) {
      logger.debug("No userAuth found for given data");
      return null;
    }

    logger.debug("Found userAuth:");
    logger.debug(userAuth);

    return userAuth.workspaceUserId?.toString() || null;
  }

  public async createChannelsBasedOnRules(data: {
    projectOrUserAuthTokenForWorkspasce: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<CreateChannelNotificationRule>;
    channelNameSiffix: string;
    notificationEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("createChannelsBasedOnRules called with data:");
    logger.debug(data);

    const createdWorkspaceChannels: Array<WorkspaceChannel> = [];
    const createdChannelNames: Array<string> = [];

    const newChannelNames: Array<string> =
      this.getNewChannelNamesFromNotificationRules({
        notificationRules: data.notificationRules,
        channelNameSiffix: data.channelNameSiffix,
        notificationEventType: data.notificationEventType,
      });

    logger.debug("New channel names to be created:");
    logger.debug(newChannelNames);

    if (!newChannelNames || newChannelNames.length === 0) {
      logger.debug("No new channel names found. Returning empty array.");
      return [];
    }

    for (const newChannelName of newChannelNames) {
      if (createdChannelNames.includes(newChannelName)) {
        logger.debug(
          `Channel name ${newChannelName} already created. Skipping.`,
        );
        continue;
      }

      logger.debug(`Creating new channel with name: ${newChannelName}`);
      const channel: WorkspaceChannel =
        await WorkspaceUtil.getWorkspaceTypeUtil(
          data.workspaceType,
        ).createChannel({
          authToken: data.projectOrUserAuthTokenForWorkspasce,
          channelName: newChannelName,
        });

      logger.debug("Channel created:");
      logger.debug(channel);

      createdChannelNames.push(channel.name);
      createdWorkspaceChannels.push(channel);
    }

    logger.debug("Returning created workspace channels:");
    logger.debug(createdWorkspaceChannels);

    return createdWorkspaceChannels;
  }

  public async getUsersIdsToInviteToChannel(data: {
    notificationRules: Array<CreateChannelNotificationRule>;
  }): Promise<Array<ObjectID>> {
    logger.debug("getUsersIdsToInviteToChannel called with data:");
    logger.debug(data);

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

          logger.debug("User IDs to invite from rule:");
          logger.debug(userIds);

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

          logger.debug("Team IDs to invite from rule:");
          logger.debug(teamIds);

          const usersInTeam: Array<User> =
            await TeamMemberService.getUsersInTeams(teamIds);

          logger.debug("Users in teams:");
          logger.debug(usersInTeam);

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

    logger.debug("Final list of user IDs to invite:");
    logger.debug(inviteUserIds);

    return inviteUserIds;
  }

  public getExistingChannelNamesFromNotificationRules(data: {
    notificationRules: Array<BaseNotificationRule>;
  }): Array<string> {
    logger.debug(
      "getExistingChannelNamesFromNotificationRules called with data:",
    );
    logger.debug(data);

    const channelNames: Array<string> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: BaseNotificationRule = notificationRule;

      if (workspaceRules.shouldPostToExistingChannel) {
        const existingChannelNames: Array<string> =
          workspaceRules.existingChannelNames.split(",");

        logger.debug("Existing channel names from rule:");
        logger.debug(existingChannelNames);

        for (const channelName of existingChannelNames) {
          if (!channelName) {
            logger.debug("Empty channel name found. Skipping.");
            continue;
          }

          if (!channelNames.includes(channelName)) {
            channelNames.push(channelName);
          }
        }
      }
    }

    logger.debug("Final list of existing channel names:");
    logger.debug(channelNames);

    return channelNames;
  }

  public getNewChannelNamesFromNotificationRules(data: {
    notificationEventType: NotificationRuleEventType;
    notificationRules: Array<CreateChannelNotificationRule>;
    channelNameSiffix: string;
  }): Array<string> {
    logger.debug("getNewChannelNamesFromNotificationRules called with data:");
    logger.debug(data);

    const channelNames: Array<string> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: CreateChannelNotificationRule = notificationRule;

      logger.debug("Processing notification rule:");
      logger.debug(workspaceRules);

      if (
        workspaceRules.shouldCreateNewChannel &&
        workspaceRules.newChannelTemplateName
      ) {
        const newChannelName: string =
          workspaceRules.newChannelTemplateName ||
          `oneuptime-${data.notificationEventType.toLowerCase()}-`;

        logger.debug("New channel template name:");
        logger.debug(newChannelName);

        // add suffix and then check if it is already added or not.
        const channelName: string = newChannelName + data.channelNameSiffix;

        logger.debug("Final channel name with suffix:");
        logger.debug(channelName);

        if (!channelNames.includes(channelName)) {
          // if channel name is not already added then add it.
          channelNames.push(channelName);
          logger.debug(`Channel name ${channelName} added to the list.`);
        } else {
          logger.debug(
            `Channel name ${channelName} already exists in the list. Skipping.`,
          );
        }
      }
    }

    logger.debug("Final list of new channel names:");
    logger.debug(channelNames);

    return channelNames;
  }

  private async getNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<Model>> {
    logger.debug("getNotificationRules called with data:");
    logger.debug(data);

    const notificationRules: Array<Model> = await this.findBy({
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

    logger.debug("Notification rules retrieved:");
    logger.debug(notificationRules);

    return notificationRules;
  }

  private async getValuesBasedOnNotificationFor(data: {
    notificationFor: NotificationFor;
  }): Promise<{
    [key in NotificationRuleConditionCheckOn]:
      | string
      | Array<string>
      | undefined;
  }> {
    logger.debug("getValuesBasedOnNotificationFor called with data:");
    logger.debug(data);

    if (data.notificationFor.incidentId) {
      logger.debug("Fetching incident details for incident ID:");
      logger.debug(data.notificationFor.incidentId);

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
        logger.debug("Incident not found for ID:");
        logger.debug(data.notificationFor.incidentId);
        throw new BadDataException("Incident ID not found");
      }

      logger.debug("Incident details retrieved:");
      logger.debug(incident);

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds:
            incident.monitors?.map((monitor: Incident) => {
              return monitor.id!;
            }) || [],
        });

      logger.debug("Monitor labels retrieved:");
      logger.debug(monitorLabels);

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
      logger.debug("Fetching alert details for alert ID:");
      logger.debug(data.notificationFor.alertId);

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
        logger.debug("Alert not found for ID:");
        logger.debug(data.notificationFor.alertId);
        throw new BadDataException("Alert ID not found");
      }

      logger.debug("Alert details retrieved:");
      logger.debug(alert);

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds: alert?.monitor?.id ? [alert?.monitor?.id] : [],
        });

      logger.debug("Monitor labels retrieved:");
      logger.debug(monitorLabels);

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
      logger.debug("Fetching scheduled maintenance details for ID:");
      logger.debug(data.notificationFor.scheduledMaintenanceId);

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
        logger.debug("Scheduled maintenance not found for ID:");
        logger.debug(data.notificationFor.scheduledMaintenanceId);
        throw new BadDataException("Scheduled Maintenance ID not found");
      }

      logger.debug("Scheduled maintenance details retrieved:");
      logger.debug(scheduledMaintenance);

      const monitorLabels: Array<Label> =
        await MonitorService.getLabelsForMonitors({
          monitorIds:
            scheduledMaintenance.monitors?.map(
              (monitor: ScheduledMaintenance) => {
                return monitor.id!;
              },
            ) || [],
        });

      logger.debug("Monitor labels retrieved:");
      logger.debug(monitorLabels);

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
      logger.debug("Fetching monitor status timeline details for ID:");
      logger.debug(data.notificationFor.monitorStatusTimelineId);

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
        logger.debug("Monitor status timeline not found for ID:");
        logger.debug(data.notificationFor.monitorStatusTimelineId);
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

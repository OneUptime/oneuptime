import ObjectID from "../../Types/ObjectID";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
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
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthToken, {
  MiscData,
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import logger from "../Utils/Logger";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import UserService from "./UserService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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

export class Service extends DatabaseService<WorkspaceNotificationRule> {
  public constructor() {
    super(WorkspaceNotificationRule);
  }

  @CaptureSpan()
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

  @CaptureSpan()
  public async getExistingChannelNamesBasedOnEventType(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<string>> {
    logger.debug("getExistingChannelNamesBasedOnEventType called with data:");
    logger.debug(data);

    const notificationRules: Array<WorkspaceNotificationRule> =
      await this.getNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: data.notificationRuleEventType,
      });

    logger.debug("Notification rules retrieved:");
    logger.debug(notificationRules);

    const existingChannelNames: Array<string> =
      this.getExistingChannelNamesFromNotificationRules({
        notificationRules: notificationRules.map(
          (rule: WorkspaceNotificationRule) => {
            return rule.notificationRule as BaseNotificationRule;
          },
        ),
      }) || [];

    logger.debug("Existing channel names:");
    logger.debug(existingChannelNames);

    return existingChannelNames;
  }

  @CaptureSpan()
  public async createChannelsAndInviteUsersToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    channelNameSiffix: string;
  }): Promise<{
    channelsCreated: Array<NotificationRuleWorkspaceChannel>;
  } | null> {
    logger.debug(
      "WorkspaceNotificationRuleService.createInviteAndPostToChannelsBasedOnRules",
    );
    logger.debug(data);

    const channelsCreated: Array<NotificationRuleWorkspaceChannel> = [];

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

      const notificationRules: Array<WorkspaceNotificationRule> =
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
      const createdWorkspaceChannels: Array<NotificationRuleWorkspaceChannel> =
        await this.createChannelsBasedOnRules({
          projectOrUserAuthTokenForWorkspace: authToken,
          workspaceType: workspaceType,
          notificationRules: notificationRules,
          channelNameSiffix: data.channelNameSiffix,
          notificationEventType: data.notificationRuleEventType,
        });

      logger.debug("createdWorkspaceChannels");
      logger.debug(createdWorkspaceChannels);

      logger.debug("Inviting users and teams to channels based on rules");
      await this.inviteUsersAndTeamsToChannelsBasedOnRules({
        projectId: data.projectId,
        projectAuth: projectAuth,
        workspaceType: workspaceType,
        notificationRules: notificationRules,
        notificationChannels: createdWorkspaceChannels,
      });

      logger.debug("Getting existing channel names from notification rules");
      const existingChannelNames: Array<string> =
        this.getExistingChannelNamesFromNotificationRules({
          notificationRules: notificationRules.map(
            (rule: WorkspaceNotificationRule) => {
              return rule.notificationRule as BaseNotificationRule;
            },
          ),
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

      logger.debug("Channels created:");
      logger.debug(createdWorkspaceChannels);

      channelsCreated.push(...createdWorkspaceChannels);
    }

    logger.debug("Returning created channels");
    return {
      channelsCreated: channelsCreated,
    };
  }

  @CaptureSpan()
  public async getNotificationRulesWhereOnCallIsTrue(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    const workspaceTypes: Array<WorkspaceType> = Service.getAllWorkspaceTypes();

    const result: Array<WorkspaceNotificationRule> = [];

    for (const workspaceType of workspaceTypes) {
      // get matching notification rules
      const notificationRules: Array<WorkspaceNotificationRule> =
        await this.getMatchingNotificationRules({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: workspaceType,
          notificationRuleEventType: data.notificationRuleEventType,
        });

      const filteredNotificationRules: Array<WorkspaceNotificationRule> =
        notificationRules.filter((rule: WorkspaceNotificationRule) => {
          return (rule.notificationRule as IncidentNotificationRule)
            .shouldAutomaticallyInviteOnCallUsersToNewChannel;
        });

      result.push(...filteredNotificationRules);
    }

    return result;
  }

  @CaptureSpan()
  public async getNotificationRulesWhereInviteOwnersIsTrue(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    const workspaceTypes: Array<WorkspaceType> = Service.getAllWorkspaceTypes();

    const result: Array<WorkspaceNotificationRule> = [];

    for (const workspaceType of workspaceTypes) {
      // get matching notification rules
      const notificationRules: Array<WorkspaceNotificationRule> =
        await this.getMatchingNotificationRules({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: workspaceType,
          notificationRuleEventType: data.notificationRuleEventType,
        });

      const filteredNotificationRules: Array<WorkspaceNotificationRule> =
        notificationRules.filter((rule: WorkspaceNotificationRule) => {
          return (rule.notificationRule as CreateChannelNotificationRule)
            .shouldInviteOwnersToNewChannel;
        });

      result.push(...filteredNotificationRules);
    }

    return result;
  }

  @CaptureSpan()
  public async inviteUsersAndTeamsToChannelsBasedOnRules(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
    notificationRules: Array<WorkspaceNotificationRule>;
    notificationChannels: Array<NotificationRuleWorkspaceChannel>;
  }): Promise<void> {
    logger.debug("inviteUsersAndTeamsToChannelsBasedOnRules called with data:");
    logger.debug(data);

    const inviteUserPayloads: Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }> = await this.getUsersIdsToInviteToChannel({
      notificationRules: data.notificationRules,
    });

    logger.debug("User IDs to invite by Workspace Notification Rule ID:");
    logger.debug(inviteUserPayloads);

    for (const inviteUserPayload of inviteUserPayloads) {
      const userIds: Array<ObjectID> = inviteUserPayload.userIds;
      const workspaceUserIds: Array<string> = [];

      for (const userId of userIds) {
        const workspaceUserId: string | null =
          await this.getWorkspaceUserIdFromOneUptimeUserId({
            projectId: data.projectId,
            workspaceType: data.workspaceType,
            oneuptimeUserId: userId,
          });

        if (workspaceUserId) {
          workspaceUserIds.push(workspaceUserId);
        } else {
          try {
            // send a message to channel that user cannot be invited because the account is not connected to workspace.

            const channelIds: Array<string> =
              data.notificationChannels
                ?.filter((channel: NotificationRuleWorkspaceChannel) => {
                  return (
                    channel.notificationRuleId ===
                    inviteUserPayload.notificationRuleId
                  );
                })
                ?.map((channel: NotificationRuleWorkspaceChannel) => {
                  return channel.id as string;
                }) || [];

            logger.debug("Channel IDs to send message to:");
            logger.debug(channelIds);

            await WorkspaceUtil.getWorkspaceTypeUtil(
              data.workspaceType,
            ).sendMessage({
              userId: data.projectAuth.workspaceProjectId!,
              authToken: data.projectAuth.authToken!,
              workspaceMessagePayload: {
                _type: "WorkspaceMessagePayload",
                channelNames: [],

                channelIds: channelIds,
                workspaceType: data.workspaceType,
                messageBlocks: [
                  {
                    _type: "WorkspacePayloadMarkdown",
                    text: `${await UserService.getUserMarkdownString({
                      userId: userId,
                      projectId: data.projectId,
                    })} cannot be invited to the channel because the account is not connected to ${data.workspaceType}. Please go to User Settings > ${data.workspaceType} on OneUptime Dashboard and connect the account.`,
                  } as WorkspacePayloadMarkdown,
                ],
              },
            });
          } catch (e) {
            logger.error("Error in sending message to channel");
            logger.error(e);
          }
        }

        logger.debug("Workspace User IDs to invite:");
        logger.debug(workspaceUserIds);

        await WorkspaceUtil.getWorkspaceTypeUtil(
          data.workspaceType,
        ).inviteUsersToChannels({
          authToken: data.projectAuth.authToken!,
          workspaceChannelInvitationPayload: {
            channelNames: data.notificationChannels
              .filter((channel: NotificationRuleWorkspaceChannel) => {
                return (
                  channel.notificationRuleId ===
                  inviteUserPayload.notificationRuleId
                );
              })
              .map((channel: NotificationRuleWorkspaceChannel) => {
                return channel.name;
              }),
            workspaceUserIds: workspaceUserIds,
          },
        });
      }
    }

    logger.debug("Users invited to channels successfully");
  }

  @CaptureSpan()
  public async inviteUsersBasedOnRulesAndWorkspaceChannels(data: {
    workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
    userIds: Array<ObjectID>;
  }): Promise<void> {
    // if no rules then return.
    if (data.notificationRules.length === 0) {
      logger.debug("No notification rules found. Returning.");
      return;
    }

    logger.debug(
      "inviteUsersBasedOnRulesAndWorkspaceChannels called with data:",
    );
    logger.debug(data);
    const userIds: Array<ObjectID> = data.userIds;

    logger.debug("Users:");
    logger.debug(userIds);

    // get all Workspaces.
    const workspaceTypes: Array<WorkspaceType> = Service.getAllWorkspaceTypes();

    for (const workspaceType of workspaceTypes) {
      // filter rules by workspaceType.

      const notificationRules: Array<WorkspaceNotificationRule> =
        data.notificationRules.filter((rule: WorkspaceNotificationRule) => {
          return rule.workspaceType === workspaceType;
        });

      logger.debug("Notification rules for workspace type:");
      logger.debug(notificationRules);

      const channelsToInviteToBasedOnRule: Array<NotificationRuleWorkspaceChannel> =
        data.workspaceChannels.filter(
          (channel: NotificationRuleWorkspaceChannel) => {
            return notificationRules.find((rule: WorkspaceNotificationRule) => {
              return rule.id?.toString() === channel.notificationRuleId;
            });
          },
        );

      logger.debug("Channels to invite to based on rule:");
      logger.debug(channelsToInviteToBasedOnRule);

      if (channelsToInviteToBasedOnRule.length === 0) {
        logger.debug("No channels to invite to based on rule.");
        continue;
      }

      // get auth token for workspace.

      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.findOneBy({
          query: {
            projectId: data.projectId,
            workspaceType: workspaceType,
          },
          select: {
            authToken: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!projectAuth) {
        logger.debug("No project auth found for workspace type");
        continue;
      }

      // inivte users to channels.

      const workspaceUserIds: Array<string> = [];

      for (const userId of userIds) {
        const workspaceUserId: string | null =
          await this.getWorkspaceUserIdFromOneUptimeUserId({
            projectId: data.projectId,
            workspaceType: workspaceType,
            oneuptimeUserId: userId,
          });

        if (workspaceUserId) {
          workspaceUserIds.push(workspaceUserId);
        } else {
          try {
            // send a message to channel that user cannot be invited because the account is not connected to workspace.

            const channelIds: Array<string> = channelsToInviteToBasedOnRule.map(
              (channel: NotificationRuleWorkspaceChannel) => {
                return channel.id as string;
              },
            );

            logger.debug("Channel IDs to send message to:");
            logger.debug(channelIds);

            await WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).sendMessage(
              {
                userId: projectAuth.workspaceProjectId!,
                authToken: projectAuth.authToken!,
                workspaceMessagePayload: {
                  _type: "WorkspaceMessagePayload",
                  channelNames: [],

                  channelIds: channelIds,
                  workspaceType: workspaceType,
                  messageBlocks: [
                    {
                      _type: "WorkspacePayloadMarkdown",
                      text: `${await UserService.getUserMarkdownString({
                        userId: userId,
                        projectId: data.projectId,
                      })} cannot be invited to the channel because the account is not connected to ${workspaceType}. Please go to User Settings > ${workspaceType} on OneUptime Dashboard and connect the account.`,
                    } as WorkspacePayloadMarkdown,
                  ],
                },
              },
            );
          } catch (e) {
            logger.error("Error in sending message to channel");
            logger.error(e);
          }
        }
      }

      logger.debug("Workspace User IDs to invite:");
      logger.debug(workspaceUserIds);

      const channelNames: Array<string> = channelsToInviteToBasedOnRule.map(
        (channel: NotificationRuleWorkspaceChannel) => {
          return channel.name;
        },
      );

      logger.debug("Channel names to invite to:");
      logger.debug(channelNames);

      await WorkspaceUtil.getWorkspaceTypeUtil(
        workspaceType,
      ).inviteUsersToChannels({
        authToken: projectAuth.authToken!,
        workspaceChannelInvitationPayload: {
          channelNames: channelNames,
          workspaceUserIds: workspaceUserIds,
        },
      });
    }
  }

  @CaptureSpan()
  public async inviteTeamsBasedOnRulesAndWorkspaceChannels(data: {
    workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
    teamIds: Array<ObjectID>;
  }): Promise<void> {
    // if no rules then return.
    if (data.notificationRules.length === 0) {
      logger.debug("No notification rules found. Returning.");
      return;
    }

    const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeams(
      data.teamIds,
    );

    logger.debug("Users in teams:");
    logger.debug(usersInTeam);

    return this.inviteUsersBasedOnRulesAndWorkspaceChannels({
      workspaceChannels: data.workspaceChannels,
      projectId: data.projectId,
      notificationRules: data.notificationRules,
      userIds: usersInTeam.map((user: User) => {
        return user.id!;
      }),
    });
  }

  @CaptureSpan()
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

  @CaptureSpan()
  public async createChannelsBasedOnRules(data: {
    projectOrUserAuthTokenForWorkspace: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<WorkspaceNotificationRule>;
    channelNameSiffix: string;
    notificationEventType: NotificationRuleEventType;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    logger.debug("createChannelsBasedOnRules called with data:");
    logger.debug(data);

    const createdWorkspaceChannels: Array<NotificationRuleWorkspaceChannel> =
      [];
    const createdChannelNames: Array<string> = [];

    const notificationChannels: Array<{
      channelName: string;
      notificationRuleId: string;
    }> = this.getnotificationChannelssFromNotificationRules({
      notificationRules: data.notificationRules,
      channelNameSiffix: data.channelNameSiffix,
      notificationEventType: data.notificationEventType,
    });

    logger.debug("New channel names to be created:");
    logger.debug(notificationChannels);

    if (!notificationChannels || notificationChannels.length === 0) {
      logger.debug("No new channel names found. Returning empty array.");
      return [];
    }

    for (const notificationChannel of notificationChannels) {
      if (
        createdChannelNames.filter((name: string) => {
          return name === notificationChannel.channelName;
        }).length > 0
      ) {
        logger.debug(
          `Channel name ${notificationChannel.channelName} already created. Skipping.`,
        );
        continue;
      }

      logger.debug(
        `Creating new channel with name: ${notificationChannel.channelName}`,
      );
      const channel: WorkspaceChannel =
        await WorkspaceUtil.getWorkspaceTypeUtil(
          data.workspaceType,
        ).createChannel({
          authToken: data.projectOrUserAuthTokenForWorkspace,
          channelName: notificationChannel.channelName,
        });

      const notificationWorkspaceChannel: NotificationRuleWorkspaceChannel = {
        ...channel,
        notificationRuleId: notificationChannel.notificationRuleId,
      };

      logger.debug("Channel created:");
      logger.debug(channel);

      createdChannelNames.push(channel.name);
      createdWorkspaceChannels.push(notificationWorkspaceChannel);
    }

    logger.debug("Returning created workspace channels:");
    logger.debug(createdWorkspaceChannels);

    return createdWorkspaceChannels;
  }

  @CaptureSpan()
  public async getUsersIdsToInviteToChannel(data: {
    notificationRules: Array<WorkspaceNotificationRule>;
  }): Promise<
    Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }>
  > {
    logger.debug("getUsersIdsToInviteToChannel called with data:");
    logger.debug(data);

    const result: Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }> = [];

    for (const workspaceNotificationRule of data.notificationRules) {
      const inviteUserIds: Array<ObjectID> = [];
      const workspaceRules: CreateChannelNotificationRule =
        workspaceNotificationRule.notificationRule as CreateChannelNotificationRule;

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

      if (inviteUserIds.length > 0) {
        result.push({
          notificationRuleId: workspaceNotificationRule.id!.toString(),
          userIds: inviteUserIds,
        });
      }
    }

    logger.debug("Final list of user IDs to invite:");
    logger.debug(result);

    return result;
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

  public getnotificationChannelssFromNotificationRules(data: {
    notificationEventType: NotificationRuleEventType;
    notificationRules: Array<WorkspaceNotificationRule>;
    channelNameSiffix: string;
  }): Array<{
    channelName: string;
    notificationRuleId: string;
  }> {
    logger.debug(
      "getnotificationChannelssFromNotificationRules called with data:",
    );
    logger.debug(data);

    const channels: Array<{
      channelName: string;
      notificationRuleId: string;
    }> = [];

    for (const notificationRule of data.notificationRules) {
      const workspaceRules: CreateChannelNotificationRule =
        notificationRule.notificationRule as CreateChannelNotificationRule;

      logger.debug("Processing notification rule:");
      logger.debug(workspaceRules);

      if (workspaceRules.shouldCreateNewChannel) {
        const notificationChannels: string =
          workspaceRules.newChannelTemplateName ||
          `oneuptime-${data.notificationEventType.toLowerCase()}-`;

        logger.debug("New channel template name:");
        logger.debug(notificationChannels);

        // add suffix and then check if it is already added or not.
        const channelName: string =
          notificationChannels + data.channelNameSiffix;

        logger.debug("Final channel name with suffix:");
        logger.debug(channelName);

        if (
          channels.filter(
            (name: { channelName: string; notificationRuleId: string }) => {
              return name.channelName === channelName;
            },
          ).length === 0
        ) {
          // if channel name is not already added then add it.
          channels.push({
            channelName: channelName,
            notificationRuleId: notificationRule.id!.toString() || "",
          });
          logger.debug(`Channel name ${channelName} added to the list.`);
        } else {
          logger.debug(
            `Channel name ${channelName} already exists in the list. Skipping.`,
          );
        }
      }
    }

    logger.debug("Final list of new channel names:");
    logger.debug(channels);

    return channels;
  }

  private async getNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<WorkspaceNotificationRule>> {
    logger.debug("getNotificationRules called with data:");
    logger.debug(data);

    const notificationRules: Array<WorkspaceNotificationRule> =
      await this.findBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          eventType: data.notificationRuleEventType,
        },
        select: {
          notificationRule: true,
          workspaceType: true,
          eventType: true,
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

  @CaptureSpan()
  public async getMatchingNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
  }): Promise<Array<WorkspaceNotificationRule>> {
    const notificationRules: Array<WorkspaceNotificationRule> =
      await this.getNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: data.notificationRuleEventType,
      });

    logger.debug("Notification rules retrieved:");
    logger.debug(notificationRules);

    const values: {
      [key in NotificationRuleConditionCheckOn]:
        | string
        | Array<string>
        | undefined;
    } = await this.getValuesBasedOnNotificationFor({
      notificationFor: data.notificationFor,
    });

    logger.debug("Values based on notification for:");
    logger.debug(values);

    const matchingNotificationRules: Array<WorkspaceNotificationRule> = [];

    for (const notificationRule of notificationRules) {
      logger.debug("Checking if rule matches:");
      if (
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule:
            notificationRule.notificationRule as IncidentNotificationRule,
          values: values,
        })
      ) {
        logger.debug("Rule matches. Adding to the list.");
        matchingNotificationRules.push(notificationRule);
      } else {
        logger.debug("Rule does not match. Skipping.");
      }
    }

    return matchingNotificationRules;
  }
}
export default new Service();

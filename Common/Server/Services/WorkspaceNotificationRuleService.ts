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
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthToken, {
  MiscData,
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import logger from "../Utils/Logger";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import UserService from "./UserService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Text from "../../Types/Text";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import WorkspaceNotificationLog from "../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";

export interface MessageBlocksByWorkspaceType {
  workspaceType: WorkspaceType;
  messageBlocks: Array<WorkspaceMessageBlock>;
}

export interface NotificationFor {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
}

export class Service extends DatabaseService<WorkspaceNotificationRule> {
  public constructor() {
    super(WorkspaceNotificationRule);
  }

  @CaptureSpan()
  public async testRule(data: {
    ruleId: ObjectID;
    projectId: ObjectID;
    testByUserId: ObjectID; // this can be useful to invite user to channels if the channels was created.
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const rule: WorkspaceNotificationRule | null = await this.findOneById({
      id: data.ruleId,
      select: {
        notificationRule: true,
        workspaceType: true,
        eventType: true,
        projectId: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!rule) {
      throw new BadDataException("Rule not found");
    }

    data.projectId = rule.projectId!;

    // check fi the testUser account is connected to workspace or not.
    const userWOrkspaceAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          userId: data.testByUserId,
          workspaceType: rule.workspaceType!,
        },
        select: {
          workspaceUserId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userWOrkspaceAuth || !userWOrkspaceAuth.workspaceUserId) {
      throw new BadDataException(
        "This account is not connected to " +
          rule.workspaceType +
          ". Please go to User Settings and connect the account.",
      );
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          projectId: data.projectId,
          workspaceType: rule.workspaceType!,
        },
        select: {
          workspaceType: true,
          authToken: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth) {
      throw new BadDataException(
        "This project is not connected to " +
          rule.workspaceType +
          ". Please go to Project Settings and connect the account.",
      );
    }

    const projectAuthToken: string = projectAuth.authToken!;

    const notificationRule: BaseNotificationRule =
      rule.notificationRule as BaseNotificationRule;

    // now send test message to these channels.
    const messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> =
      [];

    // use markdown to create blocks
    messageBlocksByWorkspaceTypes.push({
      workspaceType: rule.workspaceType!,
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: `This is a test message for rule **${rule.name?.trim()}**`,
        } as WorkspacePayloadMarkdown,
      ],
    });

    let existingChannels: Array<WorkspaceChannel> = [];

    let createdChannels: NotificationRuleWorkspaceChannel[] = [];

    if ((notificationRule as IncidentNotificationRule).shouldCreateNewChannel) {
      const generateRandomString: string = Text.generateRandomText(5);

      try {
        // create channel
        createdChannels = await this.createChannelsBasedOnRules({
          projectId: data.projectId,
          projectOrUserAuthTokenForWorkspace: projectAuthToken,
          workspaceType: rule.workspaceType!,
          notificationRules: [rule],
          channelNameSiffix: generateRandomString,
          notificationEventType: rule.eventType!,
        });
      } catch (err) {
        throw new BadDataException(
          "Cannot create a new channel. " + (err as Error)?.message,
        );
      }

      try {
        await this.inviteUsersBasedOnRulesAndWorkspaceChannels({
          workspaceChannels: createdChannels,
          projectId: data.projectId,
          notificationRules: [rule],
          userIds: [data.testByUserId],
        });
      } catch (err) {
        throw new BadDataException(
          "Cannot invite users to the channel. " + (err as Error)?.message,
        );
      }
    }

    if (notificationRule.shouldPostToExistingChannel) {
      existingChannels = this.getExistingChannelNamesFromNotificationRules({
        notificationRules: [notificationRule],
        workspaceType: rule.workspaceType!,
      });

      for (const channel of existingChannels) {
        try {
          // check if these channels exist.
          const doesChannelExistData: {
            authToken: string;
            channelName: string;
            projectId: ObjectID;
            teamId?: string;
          } = {
            authToken: projectAuthToken,
            channelName: channel.name,
            projectId: data.projectId,
          };

          // Add teamId for Microsoft Teams
          if (rule.workspaceType === WorkspaceType.MicrosoftTeams) {
            const teamId: string | undefined = channel.teamId;
            if (!teamId) {
              throw new BadDataException(
                "Microsoft Teams integration requires a team to be selected for posting to existing channels. Please edit the notification rule and select a team.",
              );
            }
            doesChannelExistData.teamId = teamId;
          }

          const channelExists: boolean =
            await WorkspaceUtil.getWorkspaceTypeUtil(
              rule.workspaceType!,
            ).doesChannelExist(doesChannelExistData);

          if (!channelExists) {
            throw new BadDataException(
              `Channel ${channel.name} does not exist. If this channel is private, you need to invite OneUptime bot to the channel and try again.`,
            );
          }
        } catch (err) {
          throw new BadDataException((err as Error)?.message);
        }
      }

      // post message

      for (const createdChannel of createdChannels) {
        try {
          const responses: Array<WorkspaceSendMessageResponse> =
            await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
              projectId: data.projectId,
              messagePayloadsByWorkspace: messageBlocksByWorkspaceTypes.map(
                (
                  messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType,
                ) => {
                  const payload: WorkspaceMessagePayload = {
                    _type: "WorkspaceMessagePayload",
                    workspaceType: messageBlocksByWorkspaceType.workspaceType,
                    messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
                    channelNames: [],
                    channelIds: [createdChannel.id],
                    teamId: notificationRule.existingTeam,
                  };

                  return payload;
                },
              ),
            });

          // Log results for test sends (created channels)
          const getMessageSummary: (wt: WorkspaceType) => string = (
            wt: WorkspaceType,
          ): string => {
            const blocks: Array<WorkspaceMessageBlock> | undefined =
              messageBlocksByWorkspaceTypes.find(
                (b: MessageBlocksByWorkspaceType) => {
                  return b.workspaceType === wt;
                },
              )?.messageBlocks;
            if (!blocks) {
              return "";
            }
            const texts: Array<string> = [];
            for (const block of blocks) {
              if (
                (block as WorkspacePayloadMarkdown)._type ===
                "WorkspacePayloadMarkdown"
              ) {
                texts.push((block as WorkspacePayloadMarkdown).text);
              }
            }
            const joined: string = texts.join(" \n").trim();
            return joined;
          };

          for (const res of responses) {
            const messageSummary: string = getMessageSummary(res.workspaceType);

            // Check for errors in the response
            if (res.errors && res.errors.length > 0) {
              const errorMessages: Array<string> = res.errors.map(
                (error: { channel: WorkspaceChannel; error: string }) => {
                  return `Channel ${error.channel.name}: ${error.error}`;
                },
              );
              throw new BadDataException(
                `Failed to send test message to some channels: ${errorMessages.join(
                  "; ",
                )}`,
              );
            }

            for (const thread of res.threads) {
              const log: WorkspaceNotificationLog =
                new WorkspaceNotificationLog();
              log.projectId = data.projectId;
              log.workspaceType = res.workspaceType;
              log.channelId = thread.channel.id;
              log.channelName = thread.channel.name;
              log.threadId = thread.threadId;
              log.message = messageSummary;
              log.status = WorkspaceNotificationStatus.Success;
              log.statusMessage = "Test message posted to workspace channel";
              log.userId = data.testByUserId;
              log.actionType = WorkspaceNotificationActionType.SendMessage;

              await WorkspaceNotificationLogService.create({
                data: log,
                props: { isRoot: true },
              });
            }
          }
        } catch (err) {
          throw new BadDataException(
            "Cannot post message to channel. " + (err as Error)?.message,
          );
        }
      }

      for (const channel of existingChannels) {
        try {
          const responses: Array<WorkspaceSendMessageResponse> =
            await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
              projectId: data.projectId,
              messagePayloadsByWorkspace: messageBlocksByWorkspaceTypes.map(
                (
                  messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType,
                ) => {
                  const payload: WorkspaceMessagePayload = {
                    _type: "WorkspaceMessagePayload",
                    workspaceType: messageBlocksByWorkspaceType.workspaceType,
                    messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
                    channelNames: [channel.name],
                    channelIds: [],
                  };

                  if (
                    messageBlocksByWorkspaceType.workspaceType ===
                    WorkspaceType.MicrosoftTeams
                  ) {
                    payload.teamId = channel.teamId;
                  }

                  return payload;
                },
              ),
            });

          // Log results for test sends (existing channels)
          const getMessageSummary: (wt: WorkspaceType) => string = (
            wt: WorkspaceType,
          ): string => {
            const blocks: Array<WorkspaceMessageBlock> | undefined =
              messageBlocksByWorkspaceTypes.find(
                (b: MessageBlocksByWorkspaceType) => {
                  return b.workspaceType === wt;
                },
              )?.messageBlocks;
            if (!blocks) {
              return "";
            }
            const texts: Array<string> = [];
            for (const block of blocks) {
              if (
                (block as WorkspacePayloadMarkdown)._type ===
                "WorkspacePayloadMarkdown"
              ) {
                texts.push((block as WorkspacePayloadMarkdown).text);
              }
            }
            const joined: string = texts.join(" \n").trim();
            return joined;
          };

          for (const res of responses) {
            const messageSummary: string = getMessageSummary(res.workspaceType);

            // Check for errors in the response
            if (res.errors && res.errors.length > 0) {
              const errorMessages: Array<string> = res.errors.map(
                (error: { channel: WorkspaceChannel; error: string }) => {
                  return `Channel ${error.channel.name}: ${error.error}`;
                },
              );
              throw new BadDataException(
                `Failed to send test message to some channels: ${errorMessages.join(
                  "; ",
                )}`,
              );
            }

            for (const thread of res.threads) {
              const log: WorkspaceNotificationLog =
                new WorkspaceNotificationLog();
              log.projectId = data.projectId;
              log.workspaceType = res.workspaceType;
              log.channelId = thread.channel.id;
              log.channelName = thread.channel.name;
              log.threadId = thread.threadId;
              log.message = messageSummary;
              log.status = WorkspaceNotificationStatus.Success;
              log.statusMessage = "Test message posted to workspace channel";
              log.userId = data.testByUserId;
              log.actionType = WorkspaceNotificationActionType.SendMessage;

              await WorkspaceNotificationLogService.create({
                data: log,
                props: { isRoot: true },
              });
            }
          }
        } catch (err) {
          throw new BadDataException(
            "Cannot post message to channel. " + (err as Error)?.message,
          );
        }
      }
    }
  }

  @CaptureSpan()
  public async archiveWorkspaceChannels(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
  }): Promise<void> {
    const workspaceTypes: Array<WorkspaceType> = Service.getAllWorkspaceTypes();

    for (const workspaceType of workspaceTypes) {
      const notificationRules: Array<WorkspaceNotificationRule> =
        await this.getMatchingNotificationRules({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: workspaceType,
          notificationRuleEventType: this.getNotificationRuleEventType(
            data.notificationFor,
          ),
        });

      // check if any of these rules have archive channel to true.
      let shouldArchiveChannel: boolean = false;

      for (const notificationRule of notificationRules) {
        const rule: CreateChannelNotificationRule =
          notificationRule.notificationRule as CreateChannelNotificationRule;
        if (rule && rule.archiveChannelAutomatically) {
          shouldArchiveChannel = true;
          break;
        }
      }

      if (!shouldArchiveChannel) {
        continue; // check next workspace type.
      }

      const channels: Array<WorkspaceChannel> =
        await this.getWorkspaceChannelsByNotificationFor({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: workspaceType,
        });

      const channelIds: Array<string> = channels.map(
        (channel: WorkspaceChannel) => {
          return channel.id;
        },
      );

      // get project auth token.
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.findOneBy({
          query: {
            projectId: data.projectId,
            workspaceType: workspaceType,
          },
          select: {
            authToken: true,
            miscData: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!projectAuth || !projectAuth.authToken) {
        logger.debug("No project auth found for workspace type");
        continue;
      }

      await WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).archiveChannels({
        authToken: projectAuth.authToken!,
        channelIds: channelIds,
        userId: this.getBotUserIdFromprojectAuthToken({
          projectAuthToken: projectAuth,
          workspaceType: workspaceType,
        }),
        sendMessageBeforeArchiving: data.sendMessageBeforeArchiving,
        projectId: data.projectId,
      });
    }
  }

  @CaptureSpan()
  public async sendWorkspaceMarkdownNotification(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    feedInfoInMarkdown: string;
    workspaceNotification: {
      notifyUserId?: ObjectID | undefined; // this is oneuptime user id.
      sendWorkspaceNotification: boolean;
      appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
    };
  }): Promise<void> {
    let messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> = [];

    // use markdown to create blocks
    messageBlocksByWorkspaceTypes =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        userId: data.workspaceNotification.notifyUserId,
        markdown: data.feedInfoInMarkdown,
        projectId: data.projectId,
      });

    if (data.workspaceNotification.appendMessageBlocks) {
      for (const messageBlocksByWorkspaceType of data.workspaceNotification
        .appendMessageBlocks) {
        const workspaceType: WorkspaceType =
          messageBlocksByWorkspaceType.workspaceType;

        messageBlocksByWorkspaceTypes
          .find(
            (messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType) => {
              return (
                messageBlocksByWorkspaceType.workspaceType === workspaceType
              );
            },
          )
          ?.messageBlocks.push(...messageBlocksByWorkspaceType.messageBlocks);
      }
    }

    const workspaceNotificationPaylaods: Array<WorkspaceMessagePayload> = [];

    for (const messageBlocksByWorkspaceType of messageBlocksByWorkspaceTypes) {
      const existingChannels: Array<WorkspaceChannel> =
        await this.getExistingChannelNamesBasedOnEventType({
          projectId: data.projectId,
          notificationRuleEventType: this.getNotificationRuleEventType(
            data.notificationFor,
          ),
          workspaceType: messageBlocksByWorkspaceType.workspaceType,
          notificationFor: data.notificationFor,
        });

      const monitorChannels: Array<WorkspaceChannel> =
        await this.getWorkspaceChannelsByNotificationFor({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          workspaceType: messageBlocksByWorkspaceType.workspaceType,
        });

      for (const monitorChannel of monitorChannels) {
        const workspaceMessagePayload: WorkspaceMessagePayload = {
          _type: "WorkspaceMessagePayload",
          workspaceType: messageBlocksByWorkspaceType.workspaceType,
          messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
          channelNames: [],
          channelIds: [monitorChannel.id], // we use channel ids here as channel names can change,
          teamId: monitorChannel.teamId,
        };

        workspaceNotificationPaylaods.push(workspaceMessagePayload);
      }

      for (const existingChannel of existingChannels) {
        const workspaceMessagePayload: WorkspaceMessagePayload = {
          _type: "WorkspaceMessagePayload",
          workspaceType: messageBlocksByWorkspaceType.workspaceType,
          messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
          channelNames: [existingChannel.name],
          channelIds: [], // we use channel names here as we don't have channel ids.
          teamId: existingChannel.teamId,
        };
        workspaceNotificationPaylaods.push(workspaceMessagePayload);
      }
    }

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: data.projectId,
        messagePayloadsByWorkspace: workspaceNotificationPaylaods,
      });

    // Create logs for each response/thread
    const getMessageSummary: (wt: WorkspaceType) => string = (
      wt: WorkspaceType,
    ): string => {
      const blocks: Array<WorkspaceMessageBlock> | undefined =
        messageBlocksByWorkspaceTypes.find(
          (b: MessageBlocksByWorkspaceType) => {
            return b.workspaceType === wt;
          },
        )?.messageBlocks;
      if (!blocks) {
        return "";
      }
      const texts: Array<string> = [];
      for (const block of blocks) {
        if (
          (block as WorkspacePayloadMarkdown)._type ===
          "WorkspacePayloadMarkdown"
        ) {
          texts.push((block as WorkspacePayloadMarkdown).text);
        }
      }
      const joined: string = texts.join(" \n").trim();
      return joined;
    };

    for (const res of responses) {
      const messageSummary: string = getMessageSummary(res.workspaceType);

      for (const thread of res.threads) {
        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.projectId = data.projectId;
        log.workspaceType = res.workspaceType;
        log.channelId = thread.channel.id;
        log.channelName = thread.channel.name;
        log.threadId = thread.threadId;
        log.message = messageSummary;
        log.status = WorkspaceNotificationStatus.Success;
        log.actionType = WorkspaceNotificationActionType.SendMessage;
        log.statusMessage = "Message posted to workspace channel";

        if (data.notificationFor.incidentId) {
          log.incidentId = data.notificationFor.incidentId;
        }
        if (data.notificationFor.alertId) {
          log.alertId = data.notificationFor.alertId;
        }
        if (data.notificationFor.scheduledMaintenanceId) {
          log.scheduledMaintenanceId =
            data.notificationFor.scheduledMaintenanceId;
        }

        if (data.workspaceNotification.notifyUserId) {
          log.userId = data.workspaceNotification.notifyUserId;
        }

        await WorkspaceNotificationLogService.create({
          data: log,
          props: { isRoot: true },
        });
      }
    }
  }

  private async getWorkspaceChannelsByNotificationFor(data: {
    projectId: ObjectID;
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("getWorkspaceChannelsByNotificationFor called with data:");
    logger.debug(JSON.stringify(data, null, 2));

    let monitorChannels: Array<WorkspaceChannel> = [];

    if (data.notificationFor.monitorId) {
      monitorChannels = await MonitorService.getWorkspaceChannelForMonitor({
        monitorId: data.notificationFor.monitorId,
        workspaceType: data.workspaceType,
      });
    }

    if (data.notificationFor.onCallDutyPolicyId) {
      monitorChannels =
        await OnCallDutyPolicyService.getWorkspaceChannelForOnCallDutyPolicy({
          onCallDutyPolicyId: data.notificationFor.onCallDutyPolicyId,
          workspaceType: data.workspaceType,
        });
    }

    // incidents
    if (data.notificationFor.incidentId) {
      monitorChannels = await IncidentService.getWorkspaceChannelForIncident({
        incidentId: data.notificationFor.incidentId,
        workspaceType: data.workspaceType,
      });
    }

    // alerts
    if (data.notificationFor.alertId) {
      monitorChannels = await AlertService.getWorkspaceChannelForAlert({
        alertId: data.notificationFor.alertId,
        workspaceType: data.workspaceType,
      });
    }

    // scheduled maintenance
    if (data.notificationFor.scheduledMaintenanceId) {
      monitorChannels =
        await ScheduledMaintenanceService.getWorkspaceChannelForScheduledMaintenance(
          {
            scheduledMaintenanceId: data.notificationFor.scheduledMaintenanceId,
            workspaceType: data.workspaceType,
          },
        );
    }

    logger.debug("Workspace channels found:");
    logger.debug(monitorChannels);

    return monitorChannels;
  }

  private getNotificationRuleEventType(
    notificationFor: NotificationFor,
  ): NotificationRuleEventType {
    if (notificationFor.alertId) {
      return NotificationRuleEventType.Alert;
    }

    if (notificationFor.incidentId) {
      return NotificationRuleEventType.Incident;
    }

    if (notificationFor.monitorId) {
      return NotificationRuleEventType.Monitor;
    }

    if (notificationFor.onCallDutyPolicyId) {
      return NotificationRuleEventType.OnCallDutyPolicy;
    }

    if (notificationFor.scheduledMaintenanceId) {
      return NotificationRuleEventType.ScheduledMaintenance;
    }

    throw new BadDataException("Notification for not found");
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
    notificationFor: NotificationFor;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("getExistingChannelNamesBasedOnEventType called with data:");
    logger.debug(data);

    const notificationRules: Array<WorkspaceNotificationRule> =
      await this.getMatchingNotificationRules({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        notificationRuleEventType: data.notificationRuleEventType,
        notificationFor: data.notificationFor,
      });

    logger.debug("Notification rules retrieved:");
    logger.debug(notificationRules);

    const existingChannels: Array<WorkspaceChannel> =
      this.getExistingChannelNamesFromNotificationRules({
        notificationRules: notificationRules.map(
          (rule: WorkspaceNotificationRule) => {
            return rule.notificationRule as BaseNotificationRule;
          },
        ),
        workspaceType: data.workspaceType,
      }) || [];

    logger.debug("Existing channels:");
    logger.debug(existingChannels);

    return existingChannels;
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
    try {
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
        try {
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
              projectId: data.projectId,
              projectOrUserAuthTokenForWorkspace: authToken,
              workspaceType: workspaceType,
              notificationRules: notificationRules,
              channelNameSiffix: data.channelNameSiffix,
              notificationEventType: data.notificationRuleEventType,
              notificationFor: data.notificationFor,
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

          logger.debug(
            "Getting existing channel names from notification rules",
          );
          const existingChannels: Array<WorkspaceChannel> =
            this.getExistingChannelNamesFromNotificationRules({
              notificationRules: notificationRules.map(
                (rule: WorkspaceNotificationRule) => {
                  return rule.notificationRule as BaseNotificationRule;
                },
              ),
              workspaceType: workspaceType,
            }) || [];

          logger.debug("Existing channels:");
          logger.debug(existingChannels);

          logger.debug(
            "Adding created channel names to existing channel names",
          );
          const allChannelNames: Array<string> = existingChannels.map(
            (c: WorkspaceChannel) => {
              return c.name;
            },
          );
          for (const channel of createdWorkspaceChannels) {
            if (!allChannelNames.includes(channel.name)) {
              allChannelNames.push(channel.name);
            }
          }

          logger.debug("Final list of channel names to post messages to:");
          logger.debug(allChannelNames);

          logger.debug("Posting messages to workspace channels");

          logger.debug("Channels created:");
          logger.debug(createdWorkspaceChannels);

          channelsCreated.push(...createdWorkspaceChannels);
        } catch (err) {
          logger.error(
            "Error in creating channels and inviting users to channels for workspace type " +
              projectAuth.workspaceType,
          );
          logger.error(err);
        }
      }

      logger.debug("Returning created channels");
      return {
        channelsCreated: channelsCreated,
      };
    } catch (err) {
      logger.error(
        "Error in createChannelsAndInviteUsersToChannelsBasedOnRules:",
      );
      logger.error(err);
      return null;
    }
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

            const sendMessageData: {
              userId: string;
              authToken: string;
              workspaceMessagePayload: WorkspaceMessagePayload;
              projectId: ObjectID;
              teamId?: string;
            } = {
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
              } as WorkspaceMessagePayload,
              projectId: data.projectId,
            };

            // Add teamId for Microsoft Teams
            if (
              data.workspaceType === WorkspaceType.MicrosoftTeams &&
              data.projectAuth.miscData?.["teamId"]
            ) {
              sendMessageData.teamId = data.projectAuth.miscData["teamId"];
            }

            await WorkspaceUtil.getWorkspaceTypeUtil(
              data.workspaceType,
            ).sendMessage(sendMessageData);
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
          projectId: data.projectId,
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

            const sendMessageData: {
              userId: string;
              authToken: string;
              workspaceMessagePayload: WorkspaceMessagePayload;
              projectId: ObjectID;
              teamId?: string;
            } = {
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
              } as WorkspaceMessagePayload,
              projectId: data.projectId,
            };

            // Add teamId for Microsoft Teams
            if (
              workspaceType === WorkspaceType.MicrosoftTeams &&
              projectAuth.miscData?.["teamId"]
            ) {
              sendMessageData.teamId = projectAuth.miscData["teamId"];
            }

            await WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).sendMessage(
              sendMessageData,
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
        projectId: data.projectId,
      });

      // Log user invitations
      try {
        for (const userId of userIds) {
          for (const channel of channelsToInviteToBasedOnRule) {
            const logData: {
              projectId: ObjectID;
              workspaceType: WorkspaceType;
              channelId: string;
              channelName: string;
              userId: ObjectID;
              incidentId?: ObjectID;
              alertId?: ObjectID;
              scheduledMaintenanceId?: ObjectID;
              onCallDutyPolicyId?: ObjectID;
            } = {
              projectId: data.projectId,
              workspaceType: workspaceType,
              channelId: channel.id,
              channelName: channel.name,
              userId: userId,
            };

            await WorkspaceNotificationLogService.logInviteUser(logData, {
              isRoot: true,
            });
          }
        }
      } catch (err) {
        logger.error("Error logging user invitations:");
        logger.error(err);
        // Don't throw the error, just log it so the main flow continues
      }
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
    projectId: ObjectID;
    projectOrUserAuthTokenForWorkspace: string;
    workspaceType: WorkspaceType;
    notificationRules: Array<WorkspaceNotificationRule>;
    channelNameSiffix: string;
    notificationEventType: NotificationRuleEventType;
    notificationFor?: NotificationFor;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    logger.debug("createChannelsBasedOnRules called with data:");
    logger.debug(data);

    const createdWorkspaceChannels: Array<NotificationRuleWorkspaceChannel> =
      [];
    const createdChannelNames: Array<string> = [];

    const notificationChannels: Array<{
      channelName: string;
      notificationRuleId: string;
      teamId?: string;
    }> = this.getnotificationChannelssFromNotificationRules({
      notificationRules: data.notificationRules,
      channelNameSiffix: data.channelNameSiffix,
      notificationEventType: data.notificationEventType,
    });

    logger.debug("New channel names to be created:");
    logger.debug(notificationChannels);

    // Get project auth to access teamId for Microsoft Teams
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    if (!projectAuth) {
      throw new BadDataException(
        "Project auth not found for workspace type " + data.workspaceType,
      );
    }

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
      const createChannelData: {
        authToken: string;
        channelName: string;
        projectId: ObjectID;
        teamId?: string;
      } = {
        authToken: data.projectOrUserAuthTokenForWorkspace,
        channelName: notificationChannel.channelName,
        projectId: data.projectId,
      };

      if (notificationChannel.teamId) {
        createChannelData.teamId = notificationChannel.teamId;
      } else if (
        data.workspaceType === WorkspaceType.MicrosoftTeams &&
        projectAuth.miscData?.["teamId"]
      ) {
        createChannelData.teamId = projectAuth.miscData["teamId"];
      }

      // Ensure teamId is set for Microsoft Teams
      if (
        data.workspaceType === WorkspaceType.MicrosoftTeams &&
        !createChannelData.teamId
      ) {
        throw new BadDataException(
          "teamId is required for Microsoft Teams channels",
        );
      }

      const channel: WorkspaceChannel =
        await WorkspaceUtil.getWorkspaceTypeUtil(
          data.workspaceType,
        ).createChannel(createChannelData);

      const notificationWorkspaceChannel: NotificationRuleWorkspaceChannel = {
        ...channel,
        notificationRuleId: notificationChannel.notificationRuleId,
      };

      logger.debug("Channel created:");
      logger.debug(channel);

      // Log the channel creation
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          channelId: string;
          channelName: string;
          incidentId?: ObjectID;
          alertId?: ObjectID;
          scheduledMaintenanceId?: ObjectID;
          onCallDutyPolicyId?: ObjectID;
        } = {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          channelId: channel.id,
          channelName: channel.name,
        };

        // Add resource associations only if they exist
        if (data.notificationFor?.incidentId) {
          logData.incidentId = data.notificationFor.incidentId;
        }
        if (data.notificationFor?.alertId) {
          logData.alertId = data.notificationFor.alertId;
        }
        if (data.notificationFor?.scheduledMaintenanceId) {
          logData.scheduledMaintenanceId =
            data.notificationFor.scheduledMaintenanceId;
        }
        if (data.notificationFor?.onCallDutyPolicyId) {
          logData.onCallDutyPolicyId = data.notificationFor.onCallDutyPolicyId;
        }

        await WorkspaceNotificationLogService.logCreateChannel(logData, {
          isRoot: true,
        });
      } catch (err) {
        logger.error("Error logging channel creation:");
        logger.error(err);
        // Don't throw the error, just log it so the main flow continues
      }

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
    workspaceType: WorkspaceType;
  }): Array<WorkspaceChannel> {
    logger.debug(
      "getExistingChannelNamesFromNotificationRules called with data:",
    );
    logger.debug(data);

    const channels: Array<WorkspaceChannel> = [];

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

          const channel: WorkspaceChannel = {
            id: channelName,
            name: channelName,
            workspaceType: data.workspaceType,
            ...(workspaceRules.existingTeam && {
              teamId: workspaceRules.existingTeam,
            }),
          };

          if (
            !channels.some((c: WorkspaceChannel) => {
              return c.name === channelName;
            })
          ) {
            channels.push(channel);
          }
        }
      }
    }

    logger.debug("Final list of existing channels:");
    logger.debug(channels);

    return channels;
  }

  public getnotificationChannelssFromNotificationRules(data: {
    notificationEventType: NotificationRuleEventType;
    notificationRules: Array<WorkspaceNotificationRule>;
    channelNameSiffix: string;
  }): Array<{
    channelName: string;
    notificationRuleId: string;
    teamId?: string;
  }> {
    logger.debug(
      "getnotificationChannelssFromNotificationRules called with data:",
    );
    logger.debug(data);

    const channels: Array<{
      channelName: string;
      notificationRuleId: string;
      teamId?: string;
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
            (name: {
              channelName: string;
              notificationRuleId: string;
              teamId?: string;
            }) => {
              return name.channelName === channelName;
            },
          ).length === 0
        ) {
          // if channel name is not already added then add it.
          const channelData: {
            channelName: string;
            notificationRuleId: string;
            teamId?: string;
          } = {
            channelName: channelName,
            notificationRuleId: notificationRule.id!.toString() || "",
          };

          if (workspaceRules.teamToCreateChannelIn) {
            channelData.teamId = workspaceRules.teamToCreateChannelIn;
          }

          channels.push(channelData);
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

        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
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
          alert.monitor!.id!.toString() || "",
        ],

        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
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
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
      };
    }

    if (data.notificationFor.monitorId) {
      logger.debug("Fetching monitor status timeline details for ID:");
      logger.debug(data.notificationFor.monitorId);

      const monitor: Monitor | null = await MonitorService.findOneById({
        id: data.notificationFor.monitorId,
        select: {
          name: true,
          labels: true,
          monitorType: true,
          currentMonitorStatusId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        logger.debug("Monitor not found for ID:");
        logger.debug(data.notificationFor.monitorId);
        throw new BadDataException(ExceptionMessages.MonitorNotFound);
      }

      const monitorLabels: Array<Label> = monitor?.labels || [];

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: monitor?.name || "",
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]:
          monitor?.monitorType || undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]:
          monitor?.currentMonitorStatusId?.toString() || "",
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
          monitor?._id?.toString() || "",
        ],
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          undefined,
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
      };
    }

    if (data.notificationFor.onCallDutyPolicyId) {
      logger.debug("Fetching on call policy details for ID:");
      logger.debug(data.notificationFor.onCallDutyPolicyId);

      const onCallDutyPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: data.notificationFor.onCallDutyPolicyId,
          select: {
            name: true,
            labels: true,
            description: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!onCallDutyPolicy) {
        logger.debug("On Call Duty Policy not found for ID:");
        logger.debug(data.notificationFor.onCallDutyPolicyId);
        throw new BadDataException("On Call Duty Policy ID not found");
      }

      const onCallDutyPolicyLabels: Array<Label> =
        onCallDutyPolicy?.labels || [];

      return {
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]:
          onCallDutyPolicy?.name || "",
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
          onCallDutyPolicy?.description || "",
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]:
          onCallDutyPolicyLabels.map((label: Label) => {
            return label._id?.toString() || "";
          }) || [],

        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: "",
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
        [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]:
          undefined,
        [NotificationRuleConditionCheckOn.Monitors]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
        [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
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

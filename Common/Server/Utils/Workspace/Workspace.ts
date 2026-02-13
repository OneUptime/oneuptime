import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceBase, { WorkspaceSendMessageResponse } from "./WorkspaceBase";
import SlackWorkspace from "./Slack/Slack";
import MicrosoftTeamsUtil from "./MicrosoftTeams/MicrosoftTeams";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../Logger";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { MessageBlocksByWorkspaceType } from "../../Services/WorkspaceNotificationRuleService";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserAuthTokenService from "../../Services/WorkspaceUserAuthTokenService";
import UserService from "../../Services/UserService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";

export interface WorkspaceChannelMessage {
  messageId: string;
  text: string;
  userId?: string;
  username?: string;
  timestamp: Date;
  isBot: boolean;
}

export default class WorkspaceUtil {
  @CaptureSpan()
  public static async getMessageBlocksByMarkdown(data: {
    projectId: ObjectID;
    // this is oneuptime user id.
    userId: ObjectID | undefined;
    markdown: string;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const workspaceTypes: Array<WorkspaceType> = this.getAllWorkspaceTypes();

    const messageBlocksByWorkspaceType: Array<MessageBlocksByWorkspaceType> =
      [];

    for (const workspaceType of workspaceTypes) {
      let userStringToAppend: string = "";

      if (data.userId) {
        const workspaceUserToken: WorkspaceUserAuthToken | null =
          await WorkspaceUserAuthTokenService.getUserAuth({
            userId: data.userId,
            workspaceType: workspaceType,
            projectId: data.projectId,
          });

        if (workspaceUserToken && workspaceUserToken.workspaceUserId) {
          const projectAuthToken: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: data.projectId,
              workspaceType: workspaceType,
            });

          if (!projectAuthToken || !projectAuthToken.authToken) {
            userStringToAppend = "";
          } else {
            const workspaceUsername: string | null =
              await this.getUserNameFromWorkspace({
                userId: workspaceUserToken.workspaceUserId,
                workspaceType: workspaceType,
                authToken: projectAuthToken.authToken,
                projectId: data.projectId,
              });

            if (!workspaceUsername) {
              const userstring: string =
                await UserService.getUserMarkdownString({
                  userId: data.userId,
                  projectId: data.projectId,
                });

              userStringToAppend = `${userstring} `;
            }

            userStringToAppend = `@${workspaceUsername} `;
          }
        } else {
          const userstring: string = await UserService.getUserMarkdownString({
            userId: data.userId,
            projectId: data.projectId,
          });

          userStringToAppend = `${userstring} `;
        }
      }

      messageBlocksByWorkspaceType.push({
        workspaceType: workspaceType,
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: userStringToAppend + data.markdown,
          } as WorkspacePayloadMarkdown,
        ],
      });
    }

    return messageBlocksByWorkspaceType;
  }

  @CaptureSpan()
  public static getAllWorkspaceTypes(): Array<WorkspaceType> {
    const workspaceTypes: Array<WorkspaceType> = [];

    for (const workspaceType in WorkspaceType) {
      workspaceTypes.push(workspaceType as WorkspaceType);
    }

    return workspaceTypes;
  }

  @CaptureSpan()
  public static getWorkspaceTypeUtil(
    workspaceType: WorkspaceType,
  ): typeof WorkspaceBase {
    if (workspaceType === WorkspaceType.Slack) {
      return SlackWorkspace;
    }

    if (workspaceType === WorkspaceType.MicrosoftTeams) {
      return MicrosoftTeamsUtil;
    }

    throw new BadDataException(
      `Workspace type ${workspaceType} is not supported`,
    );
  }

  @CaptureSpan()
  public static async getUserNameFromWorkspace(data: {
    userId: string;
    workspaceType: WorkspaceType;
    authToken: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    const userName: string | null = await WorkspaceUtil.getWorkspaceTypeUtil(
      data.workspaceType,
    ).getUsernameFromUserId({
      userId: data.userId,
      authToken: data.authToken,
      projectId: data.projectId,
    });

    return userName;
  }

  @CaptureSpan()
  public static async postMessageToAllWorkspaceChannelsAsBot(data: {
    projectId: ObjectID;
    messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
  }): Promise<Array<WorkspaceSendMessageResponse>> {
    logger.debug("postToWorkspaceChannels called with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const responses: Array<WorkspaceSendMessageResponse> = [];

    for (const messagePayloadByWorkspace of data.messagePayloadsByWorkspace) {
      const workspaceProjectAuthTokenId: ObjectID | undefined =
        messagePayloadByWorkspace.workspaceProjectAuthTokenId
          ? new ObjectID(messagePayloadByWorkspace.workspaceProjectAuthTokenId)
          : undefined;

      const projectAuthQuery: {
        projectId: ObjectID;
        workspaceType: WorkspaceType;
        workspaceProjectAuthTokenId?: ObjectID;
      } = {
        projectId: data.projectId,
        workspaceType: messagePayloadByWorkspace.workspaceType,
      };

      if (workspaceProjectAuthTokenId) {
        projectAuthQuery.workspaceProjectAuthTokenId =
          workspaceProjectAuthTokenId;
      }

      const projectAuthToken: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth(projectAuthQuery);

      if (!projectAuthToken) {
        responses.push({
          workspaceType: messagePayloadByWorkspace.workspaceType,
          threads: [],
        });

        continue;
      }

      const workspaceType: WorkspaceType =
        messagePayloadByWorkspace.workspaceType;

      let botUserId: string | undefined = undefined;

      if (workspaceType === WorkspaceType.Slack) {
        botUserId = (projectAuthToken.miscData as SlackMiscData).botUserId;

        if (!botUserId) {
          responses.push({
            workspaceType: workspaceType,
            threads: [],
          });
          continue;
        }
      }

      if (!projectAuthToken.authToken) {
        responses.push({
          workspaceType: workspaceType,
          threads: [],
        });
        continue;
      }

      const result: WorkspaceSendMessageResponse =
        await WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).sendMessage({
          userId: botUserId || "",
          authToken: projectAuthToken.authToken,
          projectId: data.projectId,
          workspaceMessagePayload: messagePayloadByWorkspace,
        });

      responses.push(result);
    }

    logger.debug("Message posted to workspace channels successfully");
    logger.debug("Returning thread IDs");
    logger.debug(JSON.stringify(responses, null, 2));

    return responses;
  }

  @CaptureSpan()
  public static async postToWorkspaceChannels(data: {
    workspaceUserId: string;
    projectOrUserAuthTokenForWorkspace: string;
    workspaceType: WorkspaceType;
    workspaceMessagePayload: WorkspaceMessagePayload;
    projectId: ObjectID;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("postToWorkspaceChannels called with data:");
    logger.debug(data);

    const result: WorkspaceSendMessageResponse =
      await WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType).sendMessage({
        userId: data.workspaceUserId,
        workspaceMessagePayload: data.workspaceMessagePayload,
        authToken: data.projectOrUserAuthTokenForWorkspace,
        projectId: data.projectId,
      });

    logger.debug("Message posted to workspace channels successfully");
    logger.debug("Returning thread IDs");
    logger.debug(result);

    return result;
  }

  @CaptureSpan()
  public static async getChannelMessages(params: {
    channelId: string;
    authToken: string;
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    teamId?: string;
    limit?: number;
    oldestTimestamp?: Date;
  }): Promise<Array<WorkspaceChannelMessage>> {
    switch (params.workspaceType) {
      case WorkspaceType.Slack: {
        const slackParams: {
          channelId: string;
          authToken: string;
          limit?: number;
          oldestTimestamp?: Date;
        } = {
          channelId: params.channelId,
          authToken: params.authToken,
        };

        if (params.limit !== undefined) {
          slackParams.limit = params.limit;
        }

        if (params.oldestTimestamp) {
          slackParams.oldestTimestamp = params.oldestTimestamp;
        }

        return await SlackWorkspace.getChannelMessages(slackParams);
      }
      case WorkspaceType.MicrosoftTeams: {
        if (!params.teamId) {
          logger.error(
            "Team ID is required for Microsoft Teams channel messages",
          );
          return [];
        }

        const teamsParams: {
          channelId: string;
          teamId: string;
          projectId: ObjectID;
          limit?: number;
          oldestTimestamp?: Date;
        } = {
          channelId: params.channelId,
          teamId: params.teamId,
          projectId: params.projectId,
        };

        if (params.limit !== undefined) {
          teamsParams.limit = params.limit;
        }

        if (params.oldestTimestamp) {
          teamsParams.oldestTimestamp = params.oldestTimestamp;
        }

        return await MicrosoftTeamsUtil.getChannelMessages(teamsParams);
      }
      default:
        logger.debug(
          `Unsupported workspace type for channel messages: ${params.workspaceType}`,
        );
        return [];
    }
  }

  @CaptureSpan()
  public static formatMessagesAsContext(
    messages: Array<WorkspaceChannelMessage>,
    options?: {
      includeTimestamp?: boolean;
      includeUsername?: boolean;
      maxLength?: number;
    },
  ): string {
    const includeTimestamp: boolean = options?.includeTimestamp ?? true;
    const includeUsername: boolean = options?.includeUsername ?? true;
    const maxLength: number = options?.maxLength || 50000;

    let context: string = "";

    for (const msg of messages) {
      let line: string = "";

      if (includeTimestamp) {
        const dateStr: string = OneUptimeDate.getDateAsFormattedString(
          msg.timestamp,
        );
        line += `[${dateStr}] `;
      }

      if (includeUsername && msg.username) {
        line += `${msg.username}: `;
      } else if (includeUsername && msg.userId) {
        line += `User ${msg.userId}: `;
      }

      line += msg.text;
      line += "\n";

      // Check if adding this line would exceed max length
      if (context.length + line.length > maxLength) {
        context += "\n... (messages truncated due to length)";
        break;
      }

      context += line;
    }

    return context.trim();
  }
}

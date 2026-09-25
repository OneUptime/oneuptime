import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "./WorkspaceBase";
import SlackWorkspace from "./Slack/Slack";
import MicrosoftTeamsUtil from "./MicrosoftTeams/MicrosoftTeams";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import logger, { LogAttributes } from "../Logger";
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
        userStringToAppend = await this.getUserStringForWorkspace({
          userId: data.userId,
          projectId: data.projectId,
          workspaceType: workspaceType,
        });
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

  /*
   * The "who did this" prefix of a workspace message: `@name ` when the user
   * linked their account in that workspace, their OneUptime name otherwise.
   *
   * This must never throw. It runs before a message is posted anywhere, and a
   * failed lookup used to abort the whole post — for every workspace, not just
   * the one whose lookup failed. Microsoft Teams made that the common case:
   * Graph's GET /users/{id} needs the User.Read.All application permission,
   * which OneUptime does not ask for, so every note (a note always carries its
   * author) from a user who had linked Teams was dropped from the incident and
   * alert channels of Slack and Teams alike.
   */
  @CaptureSpan()
  public static async getUserStringForWorkspace(data: {
    // this is oneuptime user id.
    userId: ObjectID;
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<string> {
    let workspaceUsername: string | null = null;

    try {
      const workspaceUserToken: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.getUserAuth({
          userId: data.userId,
          workspaceType: data.workspaceType,
          projectId: data.projectId,
        });

      if (workspaceUserToken && workspaceUserToken.workspaceUserId) {
        workspaceUsername = await this.getWorkspaceUsernameForUserToken({
          workspaceUserToken: workspaceUserToken,
          workspaceType: data.workspaceType,
          projectId: data.projectId,
        });
      }
    } catch (err) {
      logger.warn(
        `Could not resolve the ${data.workspaceType} username of the user. Falling back to their OneUptime name.`,
        { projectId: data.projectId?.toString() },
      );
      logger.warn(err, { projectId: data.projectId?.toString() });
    }

    if (workspaceUsername) {
      return `@${workspaceUsername} `;
    }

    try {
      const userString: string = await UserService.getUserMarkdownString({
        userId: data.userId,
        projectId: data.projectId,
      });

      return userString ? `${userString} ` : "";
    } catch (err) {
      logger.warn("Could not resolve the OneUptime name of the user.", {
        projectId: data.projectId?.toString(),
      });
      logger.warn(err, { projectId: data.projectId?.toString() });
      return "";
    }
  }

  private static async getWorkspaceUsernameForUserToken(data: {
    workspaceUserToken: WorkspaceUserAuthToken;
    workspaceType: WorkspaceType;
    projectId: ObjectID;
  }): Promise<string | null> {
    /*
     * Teams: use the display name captured when the user linked their account
     * (it came from Graph's /me with their own delegated token). Reading it
     * back later through /users/{id} needs User.Read.All, which the app token
     * does not have.
     */
    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      const displayName: unknown =
        data.workspaceUserToken.miscData?.["displayName"];

      if (typeof displayName === "string" && displayName.trim()) {
        return displayName.trim();
      }
    }

    const projectAuthToken: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    if (!projectAuthToken || !projectAuthToken.authToken) {
      return null;
    }

    return await this.getUserNameFromWorkspace({
      userId: data.workspaceUserToken.workspaceUserId!,
      workspaceType: data.workspaceType,
      authToken: projectAuthToken.authToken,
      projectId: data.projectId,
    });
  }

  @CaptureSpan()
  public static getAllWorkspaceTypes(): Array<WorkspaceType> {
    // Enumerate only providers supported by getWorkspaceTypeUtil below.
    return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams];
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
    const workspaceLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "postToWorkspaceChannels called with data:",
      workspaceLogAttributes,
    );
    logger.debug(JSON.stringify(data, null, 2), workspaceLogAttributes);

    const responses: Array<WorkspaceSendMessageResponse> = [];

    for (const messagePayloadByWorkspace of data.messagePayloadsByWorkspace) {
      const projectAuthToken: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: messagePayloadByWorkspace.workspaceType,
        });

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

      /*
       * One destination failing outright (a Teams rule with no team picked,
       * a revoked token) must not stop the payloads after it: each payload is
       * a different channel, often in a different workspace.
       */
      try {
        const result: WorkspaceSendMessageResponse =
          await WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).sendMessage({
            userId: botUserId || "",
            authToken: projectAuthToken.authToken,
            projectId: data.projectId,
            workspaceMessagePayload: messagePayloadByWorkspace,
          });

        responses.push(result);
      } catch (err) {
        logger.error(
          `Error posting message to ${workspaceType} as bot`,
          workspaceLogAttributes,
        );
        logger.error(err, workspaceLogAttributes);

        responses.push({
          workspaceType: workspaceType,
          threads: [],
          errors: [
            {
              channel: WorkspaceUtil.describePayloadDestination(
                messagePayloadByWorkspace,
              ),
              error:
                err instanceof Error
                  ? err.message
                  : String(err || "Failed to send message"),
            },
          ],
        });
      }
    }

    logger.debug(
      "Message posted to workspace channels successfully",
      workspaceLogAttributes,
    );
    logger.debug("Returning thread IDs", workspaceLogAttributes);
    logger.debug(JSON.stringify(responses, null, 2), workspaceLogAttributes);

    return responses;
  }

  // The destination a payload was addressed to, for error logs.
  public static describePayloadDestination(
    payload: WorkspaceMessagePayload,
  ): WorkspaceChannel {
    const destination: string =
      payload.channelIds?.[0] ||
      payload.channelNames?.[0] ||
      payload.chatIds?.[0] ||
      "";

    const channel: WorkspaceChannel = {
      id: payload.channelIds?.[0] || payload.chatIds?.[0] || "",
      name: destination,
      workspaceType: payload.workspaceType,
    };

    if (payload.teamId) {
      channel.teamId = payload.teamId;
    }

    return channel;
  }

  @CaptureSpan()
  public static async postToWorkspaceChannels(data: {
    workspaceUserId: string;
    projectOrUserAuthTokenForWorkspace: string;
    workspaceType: WorkspaceType;
    workspaceMessagePayload: WorkspaceMessagePayload;
    projectId: ObjectID;
  }): Promise<WorkspaceSendMessageResponse> {
    const postLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "postToWorkspaceChannels called with data:",
      postLogAttributes,
    );
    logger.debug(data, postLogAttributes);

    const result: WorkspaceSendMessageResponse =
      await WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType).sendMessage({
        userId: data.workspaceUserId,
        workspaceMessagePayload: data.workspaceMessagePayload,
        authToken: data.projectOrUserAuthTokenForWorkspace,
        projectId: data.projectId,
      });

    logger.debug(
      "Message posted to workspace channels successfully",
      postLogAttributes,
    );
    logger.debug("Returning thread IDs", postLogAttributes);
    logger.debug(result, postLogAttributes);

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
            { projectId: params.projectId?.toString() },
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
          { projectId: params.projectId?.toString() },
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

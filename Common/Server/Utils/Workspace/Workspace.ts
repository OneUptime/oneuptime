import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceBase, { WorkspaceSendMessageResponse } from "./WorkspaceBase";
import SlackWorkspace from "./Slack/Slack";
import MicrosoftTeamsWorkspace from "./MicrosoftTeams/MicrosoftTeams";
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
      return MicrosoftTeamsWorkspace;
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
  }): Promise<string | null> {
    const userName: string | null = await WorkspaceUtil.getWorkspaceTypeUtil(
      data.workspaceType,
    ).getUsernameFromUserId({
      userId: data.userId,
      authToken: data.authToken,
    });

    return userName;
  }

  @CaptureSpan()
  public static async postMessageToAllWorkspaceChannelsAsBot(data: {
    projectId: ObjectID;
    messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
  }): Promise<Array<WorkspaceSendMessageResponse>> {
    logger.debug("postToWorkspaceChannels called with data:");
    logger.debug(data);

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
      }

      if (!botUserId) {
        responses.push({
          workspaceType: workspaceType,
          threads: [],
        });
        continue;
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
          userId: botUserId,
          authToken: projectAuthToken.authToken,
          workspaceMessagePayload: messagePayloadByWorkspace,
        });

      responses.push(result);
    }

    logger.debug("Message posted to workspace channels successfully");
    logger.debug("Returning thread IDs");
    logger.debug(responses);

    return responses;
  }

  @CaptureSpan()
  public static async postToWorkspaceChannels(data: {
    workspaceUserId: string;
    projectOrUserAuthTokenForWorkspace: string;
    workspaceType: WorkspaceType;
    workspaceMessagePayload: WorkspaceMessagePayload;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("postToWorkspaceChannels called with data:");
    logger.debug(data);

    const result: WorkspaceSendMessageResponse =
      await WorkspaceUtil.getWorkspaceTypeUtil(data.workspaceType).sendMessage({
        userId: data.workspaceUserId,
        workspaceMessagePayload: data.workspaceMessagePayload,
        authToken: data.projectOrUserAuthTokenForWorkspace,
      });

    logger.debug("Message posted to workspace channels successfully");
    logger.debug("Returning thread IDs");
    logger.debug(result);

    return result;
  }
}

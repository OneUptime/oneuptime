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

export default class WorkspaceUtil {
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
          userStringToAppend = `@${workspaceUserToken.workspaceUserId} `;
        } else {
          const userstring: string = await UserService.getUserMarkdownString({
            userId: data.userId,
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

  public static getAllWorkspaceTypes(): Array<WorkspaceType> {
    const workspaceTypes: Array<WorkspaceType> = [];

    for (const workspaceType in WorkspaceType) {
      workspaceTypes.push(workspaceType as WorkspaceType);
    }

    return workspaceTypes;
  }

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

  public static async postToWorkspaceChannels(data: {
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
}

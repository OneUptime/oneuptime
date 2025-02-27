import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import { ExpressRequest } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType from "./ActionTypes";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Logger";
import { JSONObject } from "../../../../../Types/JSON";

export interface SlackRequest {
  isAuthorized: boolean;
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  projectAuthToken?: string | undefined;
  userAuthToken?: string | undefined;
  botUserId?: string | undefined;
  slackChannelId?: string | undefined;
  slackMessageId?: string | undefined;
  slackUserName?: string | undefined;
  actionValue?: string | undefined;
  actionType?: SlackActionType | undefined;
}

export default class SlackAuthAction {
  public static async isAuthorized(data: {
    req: ExpressRequest;
  }): Promise<SlackRequest> {
    const { req } = data;

    logger.debug("Starting Slack request authorization");
    logger.debug(`Request body: `);
    logger.debug(req.body);

    let payload: JSONObject = req.body;

    if(payload['payload'] && typeof payload['payload'] === 'string') {
      payload = JSON.parse(payload['payload']);
    }

    const slackUserId: string | undefined = req.body["user"]["id"];
    const slackTeamId: string | undefined = req.body["team"]["id"];

    // if there are no actions then return.
    if (!req.body["actions"] || req.body["actions"].length === 0) {
      return {
        isAuthorized: false,
      };
    }

    // interaction value.
    const actionValue: string | undefined = req.body["actions"][0]["value"];
    const actionType: SlackActionType | undefined = req.body["actions"][0][
      "action_id"
    ] as SlackActionType;
    const slackChannelId: string | undefined = req.body["channel"]["id"];

    if (!actionValue) {
      return {
        isAuthorized: false,
      };
    }

    const slackMessageId: string | undefined = req.body["message"]["ts"];
    const slackUserName: string | undefined = req.body["user"]["name"];

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          workspaceProjectId: slackTeamId,
        },
        select: {
          projectId: true,
          authToken: true,
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth) {
      return {
        isAuthorized: false,
      };
    }

    const projectId: ObjectID | undefined = projectAuth.projectId;

    if (!projectId) {
      return {
        isAuthorized: false,
      };
    }

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: slackUserId,
          projectId: projectId,
        },
        select: {
          userId: true,
          authToken: true,
        },
        props: {
          isRoot: true,
        },
      });

    const botUserId: string | undefined = (
      projectAuth.miscData as SlackMiscData
    )?.botUserId;

    const userId: ObjectID | undefined = userAuth?.userId;

    if (!userAuth || !userId) {
      const markdwonPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `${slackUserName}, Unfortunately your slack account is not connected to OneUptime. Please log into your OneUptime account, click on User Settings and connect then your slack account.`,
      };

      await SlackUtil.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          messageBlocks: [markdwonPayload],
          channelNames: [],
          channelIds: slackChannelId ? [slackChannelId] : [],
        },
        authToken: projectAuth.authToken!,
        userId: botUserId,
      });

      // clear response.
      return {
        isAuthorized: false,
      };
    }

    return {
      isAuthorized: true,
      userId: userId,
      projectId: projectId,
      projectAuthToken: projectAuth.authToken!,
      userAuthToken: userAuth.authToken!,
      botUserId: botUserId,
      slackChannelId: slackChannelId,
      slackMessageId: slackMessageId,
      slackUserName: slackUserName,
      actionValue: actionValue,
      actionType: actionType,
    };
  }
}

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
import { JSONArray, JSONObject } from "../../../../../Types/JSON";

export interface SlackAction {
  actionValue?: string | undefined;
  actionType?: SlackActionType | undefined;
}

export interface SlackRequest {
  isAuthorized: boolean;
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  projectAuthToken?: string | undefined;
  userAuthToken?: string | undefined;
  botUserId?: string | undefined;
  slackChannelId?: string | undefined;
  slackMessageId?: string | undefined;
  slackUserFullName?: string | undefined;
  slackUserId?: string | undefined;
  slackUsername?: string | undefined;
  actions?: SlackAction[] | undefined;
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

    if (payload["payload"] && typeof payload["payload"] === "string") {
      payload = JSON.parse(payload["payload"]);
    }

    logger.debug(`Payload: `);
    logger.debug(payload);

    const slackUserId: string | undefined = (
      (payload as JSONObject)["user"] as JSONObject
    )["id"] as string;
    const slackTeamId: string | undefined = (
      (payload as JSONObject)["team"] as JSONObject
    )["id"] as string;

    // if there are no actions then return.
    if (!payload["actions"] || (payload["actions"] as JSONArray).length === 0) {
      return {
        isAuthorized: false,
      };
    }

    const actions: SlackAction[] = (payload["actions"] as JSONArray).map(
      (action: JSONObject) => {
        return {
          actionValue: action["value"] as string,
          actionType: action["action_id"] as SlackActionType,
        };
      },
    );

    const slackChannelId: string | undefined = (
      (payload as JSONObject)["channel"] as JSONObject
    )["id"] as string;

    const slackMessageId: string | undefined = (
      (payload as JSONObject)["message"] as JSONObject
    )["ts"] as string;
    const slackUserFullName: string | undefined = (
      (payload as JSONObject)["user"] as JSONObject
    )["name"] as string;

    const slackUsername: string | undefined = (
      (payload as JSONObject)["user"] as JSONObject
    )["username"] as string;


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
        text: `${slackUserFullName}, Unfortunately your slack account is not connected to OneUptime. Please log into your OneUptime account, click on User Settings and connect then your slack account.`,
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
      slackUserId: slackUserId,
      userId: userId,
      projectId: projectId,
      projectAuthToken: projectAuth.authToken!,
      userAuthToken: userAuth.authToken!,
      botUserId: botUserId,
      slackChannelId: slackChannelId,
      slackUsername: slackUsername,
      slackMessageId: slackMessageId,
      slackUserFullName: slackUserFullName,
      actions: actions,
    };
  }
}

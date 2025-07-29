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
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import Dictionary from "../../../../../Types/Dictionary";

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
  triggerId?: string | undefined;
  payloadType?: string | undefined;
  view?: JSONObject | undefined; // view object from slack.
  viewValues?:
    | Dictionary<string | number | Array<string | number> | Date>
    | undefined;
}

const slackActionTypesThatDoNotRequireUserSlackAccountToBeConnectedToOneUptime: Array<SlackActionType> =
  [
    // anyone in the company can create incident.
    // regardless of whether they are connected to OneUptime or not.
    SlackActionType.NewIncident,
    SlackActionType.SubmitNewIncident,
    SlackActionType.ViewIncident,

    // Alerts
    SlackActionType.ViewAlert,

    // scheduled maintenance
    SlackActionType.ViewScheduledMaintenance,
  ];

export default class SlackAuthAction {
  @CaptureSpan()
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

    let slackUserId: string | undefined = (
      (payload as JSONObject)["user"] as JSONObject
    )?.["id"] as string;
    let slackTeamId: string | undefined = (
      (payload as JSONObject)["team"] as JSONObject
    )?.["id"] as string;

    // if there are no actions then return.
    if (
      (!payload["actions"] || (payload["actions"] as JSONArray).length === 0) &&
      payload["type"] !== "view_submission" &&
      payload["type"] !== "shortcut" &&
      payload["type"] !== "app_uninstalled" &&
      !payload["command"]
    ) {
      logger.debug("No actions found in payload. Returning unauthorized.");
      return {
        isAuthorized: false,
      };
    }

    const actions: SlackAction[] = (
      (payload["actions"] || []) as JSONArray
    ).map((action: JSONObject) => {
      return {
        actionValue: action["value"] as string,
        actionType: action["action_id"] as SlackActionType,
      };
    });

    let slackChannelId: string | undefined = (
      (payload as JSONObject)?.["channel"] as JSONObject
    )?.["id"] as string;

    if (!slackChannelId) {
      slackChannelId = (payload as JSONObject)?.["channel_id"] as string;
    }

    const slackMessageId: string | undefined = (
      (payload as JSONObject)?.["message"] as JSONObject
    )?.["ts"] as string;

    const slackUserFullName: string | undefined = (
      (payload as JSONObject)?.["user"] as JSONObject
    )?.["name"] as string;

    let slackUsername: string | undefined = (
      (payload as JSONObject)?.["user"] as JSONObject
    )?.["username"] as string;

    if (payload["user_id"]) {
      slackUserId = payload["user_id"] as string;
    }

    if (payload["user_name"]) {
      slackUsername = payload["user_name"] as string;
    }

    if (payload["team_id"]) {
      slackTeamId = payload["team_id"] as string;
    }

    const triggerId: string | undefined = payload?.["trigger_id"] as string;

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
      logger.debug(
        "Project ID not found in project auth. Returning unauthorized.",
      );
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

    const view: JSONObject | undefined =
      (payload["view"] as JSONObject) || undefined;

    let viewValues: Dictionary<
      string | number | Array<string | number> | Date
    > = {};

    if (view) {
      viewValues = SlackUtil.getValuesFromView({
        view: view,
      });

      // add actionId and actionValue

      const action: SlackAction = {
        // view callbackId
        actionType: view["callback_id"] as SlackActionType,
        // private metadata
        actionValue: view["private_metadata"]?.toString(),
      };

      actions.push(action);
      logger.debug("View values: ");
      logger.debug(viewValues);

      logger.debug("Actions: ");
      logger.debug(actions);
    }

    if (payload["callback_id"]) {
      const action: SlackAction = {
        actionType: payload["callback_id"] as SlackActionType,
      };

      actions.push(action);
    }

    const command: string | undefined = payload["command"] as string;
    const commandText: string | undefined = payload["text"] as string;

    // add command to actions.
    if (command) {
      const action: SlackAction = {
        actionType: command as SlackActionType,
        actionValue: commandText,
      };

      actions.push(action);
    }

    // check if all the actions are authed.
    if (!userId) {
      for (const action of actions) {
        if (
          action.actionType &&
          !slackActionTypesThatDoNotRequireUserSlackAccountToBeConnectedToOneUptime.includes(
            action.actionType,
          )
        ) {
          const markdwonPayload: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: `@${slackUsername}, Unfortunately your slack account is not connected to OneUptime. Please log into your OneUptime account, click on User Settings and then connect your Slack account. `,
          };

          await SlackUtil.sendDirectMessageToUser({
            authToken: projectAuth.authToken!,
            workspaceUserId: slackUserId,
            messageBlocks: [markdwonPayload],
          });

          // clear response.
          logger.debug("User auth not found. Returning unauthorized.");

          return {
            isAuthorized: false,
          };
        }
      }
    }

    const slackRequest: SlackRequest = {
      isAuthorized: true,
      slackUserId: slackUserId,
      payloadType: payload["type"] as string,
      userId: userId,
      projectId: projectId,
      projectAuthToken: projectAuth.authToken!,
      userAuthToken: userAuth?.authToken,
      botUserId: botUserId,
      slackChannelId: slackChannelId,
      slackUsername: slackUsername,
      slackMessageId: slackMessageId,
      slackUserFullName: slackUserFullName,
      actions: actions,
      triggerId: triggerId,
      view: view,
      viewValues: viewValues,
    };

    logger.debug("Slack request authorized successfully");
    logger.debug("Slack request: ");
    logger.debug(slackRequest);

    return slackRequest;
  }
}

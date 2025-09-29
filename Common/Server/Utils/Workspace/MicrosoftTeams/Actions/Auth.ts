import { ExpressRequest } from "../../../Express";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../../../../Types/Exception/BadDataException";

export interface MicrosoftTeamsAction {
  actionType: string;
  actionValue?: string;
}

export interface MicrosoftTeamsRequest {
  isAuthorized: boolean;
  projectId: ObjectID;
  authToken: string;
  payloadType: string;
  actions?: Array<MicrosoftTeamsAction>;
  userId?: string;
  teamId?: string;
  channelId?: string;
  messageId?: string;
  payload?: JSONObject;
}

export default class MicrosoftTeamsAuthAction {
  @CaptureSpan()
  public static async isAuthorized(data: {
    req: ExpressRequest;
  }): Promise<MicrosoftTeamsRequest> {
    const req: ExpressRequest = data.req;
    let payload: JSONObject = {};

    try {
      payload = req.body as JSONObject;
      logger.debug("Microsoft Teams payload received:");
      logger.debug(payload);
    } catch (error) {
      logger.debug("Failed to parse Microsoft Teams payload:");
      logger.debug(error);
      return {
        isAuthorized: false,
        projectId: new ObjectID(""),
        authToken: "",
        payloadType: "unknown",
      };
    }

    // Microsoft Teams sends different types of activities
    const activityType: string = payload["type"] as string;
    const from: JSONObject = payload["from"] as JSONObject;
    const conversation: JSONObject = payload["conversation"] as JSONObject;
    const channelData: JSONObject = payload["channelData"] as JSONObject;

    let teamId: string = "";
    let channelId: string = "";
    let userId: string = "";

    // Extract team and channel information
    if (channelData && channelData["team"]) {
      teamId = (channelData["team"] as JSONObject)["id"] as string;
    }

    if (conversation && conversation["id"]) {
      // For channel messages, conversation ID contains channel info
      channelId = conversation["id"] as string;
    }

    if (from && from["id"]) {
      userId = from["id"] as string;
    }

    // Handle different activity types
    if (activityType === "installationUpdate") {
      // Bot was installed or uninstalled
      const action: string = payload["action"] as string;
      if (action === "remove") {
        return {
          isAuthorized: true,
          projectId: new ObjectID(""), // We'll need to find the project
          authToken: "",
          payloadType: "app_uninstall",
          teamId: teamId,
        };
      }
    }

    // Find the project associated with this team
    if (!teamId) {
      logger.debug("No team ID found in payload");
      return {
        isAuthorized: false,
        projectId: new ObjectID(""),
        authToken: "",
        payloadType: activityType,
      };
    }

    let projectAuthToken: WorkspaceProjectAuthToken | null = null;

    try {
      // Find project auth token by checking if miscData contains the teamId
      const allProjectAuths = await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        select: {
          _id: true,
          projectId: true,
          authToken: true,
          miscData: true,
        },
        limit: 100, // Reasonable limit for finding matching auth tokens
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      // Find the auth token where miscData.teamId matches the teamId from payload
      projectAuthToken = allProjectAuths.find((auth) => {
        const miscData = auth.miscData as any;
        return miscData && miscData.teamId === teamId;
      }) || null;
    } catch (error) {
      logger.debug("Error finding project auth token:");
      logger.debug(error);
      return {
        isAuthorized: false,
        projectId: new ObjectID(""),
        authToken: "",
        payloadType: activityType,
      };
    }

    if (!projectAuthToken) {
      logger.debug(`No project auth token found for team: ${teamId}`);
      return {
        isAuthorized: false,
        projectId: new ObjectID(""),
        authToken: "",
        payloadType: activityType,
      };
    }

    // Parse actions from the payload
    const actions: Array<MicrosoftTeamsAction> = [];

    if (activityType === "invoke") {
      // Handle adaptive card button clicks
      const value: JSONObject = payload["value"] as JSONObject;
      if (value && value["action"]) {
        actions.push({
          actionType: value["action"] as string,
          actionValue: value["actionValue"] as string,
        });
      }
    } else if (activityType === "message") {
      // Handle text messages to the bot
      const text: string = (payload["text"] as string) || "";
      if (text.toLowerCase().includes("help")) {
        actions.push({
          actionType: "help",
        });
      }
    }

    return {
      isAuthorized: true,
      projectId: projectAuthToken.projectId!,
      authToken: projectAuthToken.authToken!,
      payloadType: activityType,
      actions: actions,
      userId: userId,
      teamId: teamId,
      channelId: channelId,
      messageId: payload["id"] as string,
      payload: payload,
    };
  }

  @CaptureSpan()
  public static async getOneUptimeUserIdFromTeamsUserId(data: {
    teamsUserId: string;
    projectId: ObjectID;
  }): Promise<ObjectID> {
    // Find a OneUptime user associated with this Teams user ID using WorkspaceUserAuthToken table
    // This table is populated when users authenticate with Microsoft Teams through the OAuth flow

    try {
      // Look up the user in the WorkspaceUserAuthToken table
      const workspaceUserAuthToken: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.findOneBy({
          query: {
            workspaceUserId: data.teamsUserId,
            projectId: data.projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            userId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (workspaceUserAuthToken && workspaceUserAuthToken.userId) {
        logger.debug(
          "Found OneUptime user for Teams user: " + data.teamsUserId,
        );
        return workspaceUserAuthToken.userId;
      }

      throw new BadDataException(
        "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
      );
    } catch (error) {
      logger.error(
        "Error finding OneUptime user for Teams user: " + data.teamsUserId,
      );
      logger.error(error);
      throw error;
    }
  }
}

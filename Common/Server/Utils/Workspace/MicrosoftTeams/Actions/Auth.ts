import { ExpressRequest } from "../../../Utils/Express";
import logger from "../../../Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import MicrosoftTeamsActionType from "./ActionTypes";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

export interface MicrosoftTeamsAction {
  actionType: MicrosoftTeamsActionType;
  [key: string]: any;
}

export interface MicrosoftTeamsRequest {
  projectId: ObjectID;
  payloadType: string;
  isAuthorized: boolean;
  actions: Array<MicrosoftTeamsAction>;
  channelId?: string;
  userId?: string;
  teamId?: string;
  serviceUrl?: string;
  tenantId?: string;
  conversationId?: string;
  messageId?: string;
}

export default class MicrosoftTeamsAuthAction {
  public static async isAuthorized(data: {
    req: ExpressRequest;
  }): Promise<MicrosoftTeamsRequest> {
    const body: JSONObject = data.req.body as JSONObject;

    logger.debug("Microsoft Teams Auth Request Body:");
    logger.debug(body);

    const result: MicrosoftTeamsRequest = {
      projectId: new ObjectID(""),
      payloadType: "",
      isAuthorized: false,
      actions: [],
    };

    // Extract Teams-specific information from the request
    const channelData: JSONObject | undefined = body["channelData"] as JSONObject;
    const from: JSONObject | undefined = body["from"] as JSONObject;
    const conversation: JSONObject | undefined = body["conversation"] as JSONObject;
    
    if (channelData) {
      result.teamId = channelData["team"]?.["id"]?.toString();
      result.tenantId = channelData["tenant"]?.["id"]?.toString();
    }

    if (from) {
      result.userId = from["id"]?.toString();
    }

    if (conversation) {
      result.conversationId = conversation["id"]?.toString();
      result.channelId = conversation["id"]?.toString();
    }

    result.serviceUrl = body["serviceUrl"]?.toString();

    // Handle different types of Teams activities
    const activityType: string = body["type"]?.toString() || "";

    if (activityType === "installationUpdate") {
      const action: string = body["action"]?.toString() || "";
      if (action === "remove") {
        result.payloadType = "app_uninstall";
        result.isAuthorized = true;
        
        // Find the project associated with this team
        if (result.teamId) {
          const projectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.findOneBy({
              query: {
                workspaceProjectId: result.teamId,
                workspaceType: WorkspaceType.MicrosoftTeams,
              },
              select: {
                projectId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (projectAuth) {
            result.projectId = projectAuth.projectId!;
          }
        }
        
        return result;
      }
    }

    // Handle message activities (commands and button clicks)
    if (activityType === "message") {
      const text: string = body["text"]?.toString() || "";
      const value: JSONObject | undefined = body["value"] as JSONObject;

      // Check if this is a button click (adaptive card action)
      if (value && value["action"]) {
        const actionType: string = value["action"]?.toString() || "";
        result.actions.push({
          actionType: actionType as MicrosoftTeamsActionType,
          ...value,
        });
      } else if (text) {
        // Handle text commands
        const command: string = text.toLowerCase().trim();
        
        if (command.startsWith("incidents")) {
          // Handle incident-related commands
          result.actions.push({
            actionType: MicrosoftTeamsActionType.VIEW_ON_CALL_DUTY_POLICY,
          });
        } else if (command.startsWith("alerts")) {
          // Handle alert-related commands
          result.actions.push({
            actionType: MicrosoftTeamsActionType.VIEW_ON_CALL_DUTY_POLICY,
          });
        }
      }
    }

    // Find the project associated with this team
    if (result.teamId) {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.findOneBy({
          query: {
            workspaceProjectId: result.teamId,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (projectAuth) {
        result.projectId = projectAuth.projectId!;
        result.isAuthorized = true;
      }
    }

    logger.debug("Microsoft Teams Auth Result:");
    logger.debug(result);

    return result;
  }
}
import MicrosoftTeamsActionType from "./ActionTypes";
import {
  ExpressRequest,
} from "../../../../Utils/Express";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import logger from "../../../../Utils/Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export interface MicrosoftTeamsAction {
  actionType?: MicrosoftTeamsActionType | undefined;
  incidentId?: string;
  alertId?: string;
  scheduledMaintenanceId?: string;
  monitorId?: string;
  onCallDutyPolicyId?: string;
  userId?: string;
  projectId?: string;
}

export interface MicrosoftTeamsRequest {
  projectId: ObjectID;
  userId: string;
  actions?: MicrosoftTeamsAction[] | undefined;
  payloadType?: string;
  isAuthorized: boolean;
  authToken: string;
  botUserId?: string;
}

const microsoftTeamsActionTypesThatDoNotRequireUserMicrosoftTeamsAccountToBeConnectedToOneUptime: Array<MicrosoftTeamsActionType> =
  [
    MicrosoftTeamsActionType.NewIncident,
    MicrosoftTeamsActionType.SubmitNewIncident,
    MicrosoftTeamsActionType.ViewIncident,
    MicrosoftTeamsActionType.ViewAlert,
    MicrosoftTeamsActionType.ViewScheduledMaintenance,
    MicrosoftTeamsActionType.SubmitNewScheduledMaintenance,
    MicrosoftTeamsActionType.NewScheduledMaintenance,
    MicrosoftTeamsActionType.ViewMonitor,
    MicrosoftTeamsActionType.ViewOnCallPolicy,
  ];

export default class MicrosoftTeamsAuthAction {
  @CaptureSpan()
  public static async isAuthorized(data: {
    req: ExpressRequest;
  }): Promise<MicrosoftTeamsRequest> {
    const { req } = data;

    // For Microsoft Teams webhooks, the payload structure is different from Slack
    // Microsoft Teams sends Adaptive Card action payloads
    const payload: JSONObject = req.body;

    logger.debug("Microsoft Teams Webhook Payload:");
    logger.debug(payload);

    // Microsoft Teams webhook payload structure for Adaptive Card actions
    // The payload contains information about the action performed
    // We need to extract the action data and validate the request

    // For now, we'll implement a basic structure
    // In a real implementation, you'd validate the webhook signature
    // and extract the necessary information from the payload

    let projectId: ObjectID | null = null;
    let userId: string = "";
    let actions: MicrosoftTeamsAction[] = [];
    let payloadType: string = "action";
    let authToken: string = "";
    let botUserId: string = "";

    // Extract project ID from webhook URL or payload
    // This would typically be encoded in the webhook URL or payload
    const projectIdFromUrl: string | undefined = req.params["projectId"];

    if (projectIdFromUrl) {
      projectId = new ObjectID(projectIdFromUrl);
    }

    // Extract action data from Microsoft Teams payload
    if (payload && typeof payload === "object") {
      // Microsoft Teams Adaptive Card action payload structure
      // This is a simplified example - actual structure may vary
      const actionData: any = payload["action"] || payload;

      if (actionData && typeof actionData === "object") {
        const action: MicrosoftTeamsAction = {
          actionType: actionData["actionType"] as MicrosoftTeamsActionType,
          incidentId: actionData["incidentId"],
          alertId: actionData["alertId"],
          scheduledMaintenanceId: actionData["scheduledMaintenanceId"],
          monitorId: actionData["monitorId"],
          onCallDutyPolicyId: actionData["onCallDutyPolicyId"],
          userId: actionData["userId"],
          projectId: actionData["projectId"],
        };

        actions.push(action);
      }

      // Check if this is an app uninstall event
      if (payload["eventType"] === "app_uninstall") {
        payloadType = "app_uninstall";
      }
    }

    // Get auth token for the project
    if (projectId) {
      const projectAuth = await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        select: {
          authToken: true,
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (projectAuth) {
        authToken = projectAuth.authToken || "";
        const miscData: any = projectAuth.miscData || {};
        botUserId = miscData["botUserId"] || "";
      }
    }

    // For actions that don't require user auth, we can proceed
    let isAuthorized: boolean = false;

    if (actions.length > 0) {
      const actionType: MicrosoftTeamsActionType | undefined =
        actions[0]?.actionType;

      if (
        actionType &&
        microsoftTeamsActionTypesThatDoNotRequireUserMicrosoftTeamsAccountToBeConnectedToOneUptime.includes(
          actionType,
        )
      ) {
        isAuthorized = true;
        // For these actions, we might not have a specific user
        userId = actions[0]?.userId || "system";
      } else if (userId && projectId) {
        // Check if user has Microsoft Teams auth
        const userAuth = await WorkspaceUserAuthTokenService.findOneBy({
          query: {
            projectId: projectId,
            userId: new ObjectID(userId),
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (userAuth) {
          isAuthorized = true;
        }
      }
    }

    // Handle app uninstall
    if (payloadType === "app_uninstall" && projectId) {
      // Delete all user auth tokens for this project
      await WorkspaceUserAuthTokenService.deleteBy({
        query: {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      // Delete project auth token
      await WorkspaceProjectAuthTokenService.deleteBy({
        query: {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      logger.debug("Microsoft Teams App Uninstall: Deleted all auth tokens.");
    }

    return {
      projectId: projectId!,
      userId: userId,
      actions: actions,
      payloadType: payloadType,
      isAuthorized: isAuthorized,
      authToken: authToken,
      botUserId: botUserId,
    };
  }
}

import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
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
  tenantId?: string;
  channelId?: string;
  messageId?: string;
  payload?: JSONObject;
}

export default class MicrosoftTeamsAuthAction {
  @CaptureSpan()
  public static async getOneUptimeUserIdFromTeamsUserId(data: {
    teamsUserId: string;
    projectId: ObjectID;
  }): Promise<ObjectID> {
    /*
     * Find a OneUptime user associated with this Teams user ID using WorkspaceUserAuthToken table
     * This table is populated when users authenticate with Microsoft Teams through the OAuth flow
     */

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
          {
            projectId: data.projectId.toString(),
            workspaceUserId: data.teamsUserId,
          },
        );
        return workspaceUserAuthToken.userId;
      }

      throw new BadDataException(
        "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
      );
    } catch (error) {
      logger.error(
        "Error finding OneUptime user for Teams user: " + data.teamsUserId,
        {
          projectId: data.projectId.toString(),
          workspaceUserId: data.teamsUserId,
        },
      );
      logger.error(error);
      throw error;
    }
  }
}

import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import { ExpressRequest } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Logger";
import { JSONObject } from "../../../../../Types/JSON";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import Dictionary from "../../../../../Types/Dictionary";

export interface MicrosoftTeamsAction {
  actionValue?: string | undefined;
  actionType?: MicrosoftTeamsActionType | undefined;
}

export interface MicrosoftTeamsRequest {
  isAuthorized: boolean;
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  projectAuthToken?: string | undefined;
  userAuthToken?: string | undefined;
  teamsChannelId?: string | undefined;
  teamsMessageId?: string | undefined;
  teamsUserFullName?: string | undefined;
  teamsUserId?: string | undefined;
  teamsUsername?: string | undefined;
  actions?: MicrosoftTeamsAction[] | undefined;
  triggerId?: string | undefined;
  payloadType?: string | undefined;
  view?: JSONObject | undefined;
  viewValues?:
    | Dictionary<string | number | Array<string | number> | Date>
    | undefined;
}

const teamsActionTypesThatDoNotRequireUserTeamsAccountToBeConnectedToOneUptime: Array<MicrosoftTeamsActionType> =
  [
    // anyone in the company can create incident.
    // regardless of whether they are connected to OneUptime or not.
    MicrosoftTeamsActionType.NewIncident,
    MicrosoftTeamsActionType.SubmitNewIncident,
    MicrosoftTeamsActionType.ViewIncident,
  ];

export default class MicrosoftTeamsAuthAction {
  @CaptureSpan()
  public static async getTeamsRequestFromExpressRequest(
    req: ExpressRequest,
    options: {
      actionType?: MicrosoftTeamsActionType | undefined;
      actionValue?: string | undefined;
    },
  ): Promise<MicrosoftTeamsRequest> {
    const teamsRequest: MicrosoftTeamsRequest = {
      isAuthorized: false,
    };

    // Extract Teams-specific headers and payload
    // This would need to be adapted based on the actual Teams webhook format
    const teamsPayload: JSONObject = req.body as JSONObject;

    logger.debug("Microsoft Teams request payload:");
    logger.debug(teamsPayload);

    try {
      // Parse Teams user information
      if (teamsPayload["from"]) {
        const fromUser: JSONObject = teamsPayload["from"] as JSONObject;
        teamsRequest.teamsUserId = fromUser["id"] as string;
        teamsRequest.teamsUserFullName = fromUser["name"] as string;
        teamsRequest.teamsUsername = fromUser["name"] as string;
      }

      // Parse channel information
      if (teamsPayload["channelData"]) {
        const channelData: JSONObject = teamsPayload["channelData"] as JSONObject;
        teamsRequest.teamsChannelId = channelData["teamsChannelId"] as string;
      }

      if (options.actionType) {
        teamsRequest.actions = [
          {
            actionType: options.actionType,
            actionValue: options.actionValue,
          },
        ];
      }

      // Authorize the request
      await this.authorizeTeamsRequest(teamsRequest);

      return teamsRequest;
    } catch (error) {
      logger.error(`Error parsing Microsoft Teams request: ${(error as Error).message}`);
      return teamsRequest;
    }
  }

  @CaptureSpan()
  public static async authorizeTeamsRequest(
    teamsRequest: MicrosoftTeamsRequest,
  ): Promise<void> {
    if (!teamsRequest.teamsUserId) {
      logger.error("No Teams user ID found in request");
      return;
    }

    logger.debug(`Authorizing Teams request for user ${teamsRequest.teamsUserId}`);

    try {
      // Find user auth token by Teams user ID
      const userAuthTokens: Array<WorkspaceUserAuthToken> =
        await WorkspaceUserAuthTokenService.findBy({
          query: {
            workspaceUserId: teamsRequest.teamsUserId,
          },
          select: {
            _id: true,
            userId: true,
            projectId: true,
            authToken: true,
          },
          limit: 1,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      if (userAuthTokens.length === 0) {
        // Check if this action type doesn't require user account connection
        if (
          teamsRequest.actions &&
          teamsRequest.actions.length > 0 &&
          teamsActionTypesThatDoNotRequireUserTeamsAccountToBeConnectedToOneUptime.includes(
            teamsRequest.actions[0]!.actionType!,
          )
        ) {
          // Try to get project auth token instead
          const projectAuthTokens: Array<WorkspaceProjectAuthToken> =
            await WorkspaceProjectAuthTokenService.findBy({
              query: {},
              select: {
                _id: true,
                projectId: true,
                authToken: true,
                miscData: true,
              },
              limit: 1,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          if (projectAuthTokens.length > 0) {
            const projectAuthToken: WorkspaceProjectAuthToken = projectAuthTokens[0]!;
            teamsRequest.projectId = projectAuthToken.projectId;
            teamsRequest.projectAuthToken = projectAuthToken.authToken;
            teamsRequest.isAuthorized = true;
            
            logger.debug(
              `Authorized Teams request using project auth token for project ${teamsRequest.projectId}`,
            );
          }
        }

        if (!teamsRequest.isAuthorized) {
          logger.debug(
            `Teams user ${teamsRequest.teamsUserId} is not connected to OneUptime`,
          );
        }
        return;
      }

      const userAuthToken: WorkspaceUserAuthToken = userAuthTokens[0]!;

      // Get project auth token
      const projectAuthTokens: Array<WorkspaceProjectAuthToken> =
        await WorkspaceProjectAuthTokenService.findBy({
          query: {
            projectId: userAuthToken.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            authToken: true,
            miscData: true,
          },
          limit: 1,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      if (projectAuthTokens.length === 0) {
        logger.debug(
          `No project auth token found for project ${userAuthToken.projectId}`,
        );
        return;
      }

      const projectAuthToken: WorkspaceProjectAuthToken = projectAuthTokens[0]!;

      teamsRequest.userId = userAuthToken.userId;
      teamsRequest.projectId = userAuthToken.projectId;
      teamsRequest.userAuthToken = userAuthToken.authToken;
      teamsRequest.projectAuthToken = projectAuthToken.authToken;
      teamsRequest.isAuthorized = true;

      logger.debug(
        `Authorized Teams request for user ${teamsRequest.userId} in project ${teamsRequest.projectId}`,
      );
    } catch (error) {
      logger.error(`Error authorizing Teams request: ${(error as Error).message}`);
    }
  }
}

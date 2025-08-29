import WorkspaceProjectAuthToken, {
  MiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import URL from "../../../../Types/API/URL";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../Types/JSON";
import logger from "../../Logger";
import {
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
} from "../../../EnvironmentConfig";
import ObjectID from "../../../../Types/ObjectID";

// Re-declare with optional fields aligned to runtime data; all values stored as strings in MiscData
export interface MicrosoftTeamsMiscData extends MiscData {
  refreshToken?: string; // inherited index signature requires string values
  tokenExpiresAt?: string; // ISO string
  tenantId?: string;
  teamId?: string;
  teamName?: string;
  userId?: string; // installing user id
}

export default class MicrosoftTeamsTokenRefresher {
  public static async refreshProjectAuthTokenIfExpired(data: {
    projectAuthToken: WorkspaceProjectAuthToken;
  }): Promise<WorkspaceProjectAuthToken> {
    const projectAuthToken: WorkspaceProjectAuthToken = data.projectAuthToken;

    try {
      logger.debug(
        `Starting token refresh check for project auth token: ${projectAuthToken.id}`,
      );

      if (projectAuthToken.workspaceType !== WorkspaceType.MicrosoftTeams) {
        logger.debug(
          "Project auth token is not for Microsoft Teams, skipping refresh",
        );
        return projectAuthToken;
      }

      const miscData: MicrosoftTeamsMiscData | undefined =
        projectAuthToken.miscData as MicrosoftTeamsMiscData | undefined;
      if (!miscData) {
        logger.debug(
          "No misc data found in project auth token, cannot refresh",
        );
        return projectAuthToken;
      }

      logger.debug("Misc data analysis:");
      logger.debug({
        hasTokenExpiresAt: Boolean(miscData.tokenExpiresAt),
        hasRefreshToken: Boolean(miscData.refreshToken),
        tokenExpiresAt: miscData.tokenExpiresAt,
        refreshTokenLength: miscData.refreshToken?.length || 0,
        tenantId: miscData.tenantId,
        teamId: miscData.teamId,
      });

      const expiresAt: string | undefined = miscData.tokenExpiresAt;
      const refreshToken: string | undefined = miscData.refreshToken;

      if (!expiresAt || !refreshToken) {
        logger.debug(
          "Missing tokenExpiresAt or refreshToken, cannot refresh token",
        );
        logger.debug({
          hasExpiresAt: Boolean(expiresAt),
          hasRefreshToken: Boolean(refreshToken),
        });
        return projectAuthToken;
      }

      const bufferMs: number = 2 * 60 * 1000; // 2 minutes buffer
      const expiresDate: Date = new Date(expiresAt);
      const now: Date = new Date();

      logger.debug("Token expiry check:");
      logger.debug({
        expiresAt: expiresAt,
        expiresDateMs: expiresDate.getTime(),
        nowMs: now.getTime(),
        bufferMs: bufferMs,
        timeUntilExpiry: expiresDate.getTime() - now.getTime(),
        needsRefresh: expiresDate.getTime() - bufferMs <= now.getTime(),
      });

      if (expiresDate.getTime() - bufferMs > now.getTime()) {
        logger.debug("Token is still valid, no refresh needed");
        return projectAuthToken; // Still valid
      }

      if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
        logger.error(
          "Microsoft Teams client credentials not set. Cannot refresh token.",
        );
        return projectAuthToken;
      }

      logger.debug(
        "Refreshing Microsoft Teams access token for project auth token " +
          projectAuthToken.id,
      );
      logger.debug("Refresh request details:");
      logger.debug({
        refreshTokenLength: refreshToken.length,
        clientIdProvided: Boolean(MicrosoftTeamsAppClientId),
        clientSecretProvided: Boolean(MicrosoftTeamsAppClientSecret),
      });

      const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
        URL.fromString(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        ),
        {
          client_id: MicrosoftTeamsAppClientId,
          client_secret: MicrosoftTeamsAppClientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
        {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      );

      if (resp instanceof HTTPErrorResponse) {
        logger.error("Microsoft Teams token refresh failed: " + resp.message);
        logger.error("Refresh error details:");
        logger.error({
          statusCode: resp.statusCode,
          message: resp.message,
          data: resp.data,
          jsonData: resp.jsonData,
        });

        // Handle specific client secret error during refresh
        if (
          resp.jsonData &&
          typeof resp.jsonData === "object" &&
          "error" in resp.jsonData
        ) {
          const errorData: JSONObject = resp.jsonData as JSONObject;
          const errorType: string = errorData["error"] as string;
          const errorDescription: string = errorData[
            "error_description"
          ] as string;

          if (
            errorType === "invalid_client" &&
            errorDescription?.includes("Invalid client secret provided")
          ) {
            logger.error(
              "ERROR: Invalid Microsoft Teams client secret detected during token refresh!",
            );
            logger.error(
              "Please ensure you are using the SECRET VALUE (not Secret ID) from your Azure App Registration.",
            );
            logger.error(
              "Go to Azure Portal > App Registrations > Your App > Certificates & secrets > Client secrets",
            );
            logger.error(
              "Copy the full SECRET VALUE and update MICROSOFT_TEAMS_APP_CLIENT_SECRET",
            );
          }
        }

        return projectAuthToken;
      }

      const json: JSONObject = resp.jsonData as JSONObject;
      const newAccessToken: string | undefined = json["access_token"] as string;
      const newRefreshToken: string | undefined =
        (json["refresh_token"] as string) || refreshToken;
      const expiresIn: number | undefined = json["expires_in"] as number;

      logger.debug("Token refresh response:");
      logger.debug({
        hasNewAccessToken: Boolean(newAccessToken),
        hasNewRefreshToken: Boolean(newRefreshToken),
        newAccessTokenLength: newAccessToken?.length || 0,
        newRefreshTokenLength: newRefreshToken?.length || 0,
        expiresIn: expiresIn,
      });

      if (!newAccessToken) {
        logger.error(
          "Microsoft Teams token refresh response missing access_token",
        );
        return projectAuthToken;
      }

      const newExpiryIso: string | undefined = expiresIn
        ? new Date(Date.now() + (expiresIn - 60) * 1000).toISOString()
        : miscData.tokenExpiresAt;

      const updatedMisc: MicrosoftTeamsMiscData = {
        ...miscData,
        refreshToken: newRefreshToken || miscData.refreshToken || "",
        tokenExpiresAt: newExpiryIso || miscData.tokenExpiresAt || "",
      };

      logger.debug("Updating project auth token with new credentials");

      await WorkspaceProjectAuthTokenService.refreshAuthToken({
        projectId: projectAuthToken.projectId as ObjectID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        authToken: newAccessToken,
        workspaceProjectId: projectAuthToken.workspaceProjectId || "",
        miscData: updatedMisc,
      });

      projectAuthToken.authToken = newAccessToken;
      projectAuthToken.miscData = updatedMisc;

      logger.debug(
        "Microsoft Teams access token refreshed successfully for project auth token " +
          projectAuthToken.id,
      );

      return projectAuthToken;
    } catch (err) {
      logger.error(
        "Error refreshing Microsoft Teams token: " + (err as Error).message,
      );
      logger.error(err);
      return data.projectAuthToken;
    }
  }
}

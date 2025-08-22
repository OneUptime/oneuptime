import WorkspaceProjectAuthToken, { MiscData } from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import URL from "../../../../Types/API/URL";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../Types/JSON";
import logger from "../../Logger";
import { MicrosoftTeamsAppClientId, MicrosoftTeamsAppClientSecret } from "../../../EnvironmentConfig";
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
            if (projectAuthToken.workspaceType !== WorkspaceType.MicrosoftTeams) {
                return projectAuthToken;
            }

            const miscData: MicrosoftTeamsMiscData | undefined = projectAuthToken.miscData as MicrosoftTeamsMiscData | undefined;
            if (!miscData) {
                return projectAuthToken;
            }

            const expiresAt: string | undefined = miscData.tokenExpiresAt;
            const refreshToken: string | undefined = miscData.refreshToken;

            if (!expiresAt || !refreshToken) {
                return projectAuthToken;
            }

            const bufferMs: number = 2 * 60 * 1000; // 2 minutes buffer
            const expiresDate: Date = new Date(expiresAt);
            const now: Date = new Date();
            if (expiresDate.getTime() - bufferMs > now.getTime()) {
                return projectAuthToken; // Still valid
            }

            if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
                logger.error("Microsoft Teams client credentials not set. Cannot refresh token.");
                return projectAuthToken;
            }

            logger.debug("Refreshing Microsoft Teams access token for project auth token " + projectAuthToken.id);

            const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
                URL.fromString("https://login.microsoftonline.com/common/oauth2/v2.0/token"),
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
                logger.error(resp.jsonData);
                return projectAuthToken;
            }

            const json: JSONObject = resp.jsonData as JSONObject;
            const newAccessToken: string | undefined = json["access_token"] as string;
            const newRefreshToken: string | undefined = (json["refresh_token"] as string) || refreshToken;
            const expiresIn: number | undefined = json["expires_in"] as number;

            if (!newAccessToken) {
                logger.error("Microsoft Teams token refresh response missing access_token");
                return projectAuthToken;
            }

            const newExpiryIso: string | undefined = expiresIn
                ? new Date(Date.now() + (expiresIn - 60) * 1000).toISOString()
                : miscData.tokenExpiresAt;

            const updatedMisc: MicrosoftTeamsMiscData = {
                ...miscData,
                refreshToken: (newRefreshToken || miscData.refreshToken || ""),
                tokenExpiresAt: (newExpiryIso || miscData.tokenExpiresAt || ""),
            };

            await WorkspaceProjectAuthTokenService.refreshAuthToken({
                projectId: projectAuthToken.projectId as ObjectID,
                workspaceType: WorkspaceType.MicrosoftTeams,
                authToken: newAccessToken,
                workspaceProjectId: projectAuthToken.workspaceProjectId || "",
                miscData: updatedMisc,
            });

            projectAuthToken.authToken = newAccessToken;
            projectAuthToken.miscData = updatedMisc;

            logger.debug("Microsoft Teams access token refreshed successfully for project auth token " + projectAuthToken.id);

            return projectAuthToken;
        } catch (err) {
            logger.error("Error refreshing Microsoft Teams token: " + (err as Error).message);
            return data.projectAuthToken;
        }
    }
}

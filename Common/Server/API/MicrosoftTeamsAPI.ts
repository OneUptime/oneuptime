import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import {
  AppApiClientUrl,
  DashboardClientUrl,
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
  MicrosoftTenantId,
} from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";

export default class MicrosoftTeamsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    // App manifest endpoint similar to Slack
    router.get(
      "/teams/app-manifest",
      (req: ExpressRequest, res: ExpressResponse) => {
        // return basic manifest information for Teams app setup
        const manifest: JSONObject = {
          name: "OneUptime Teams Integration",
          description: "OneUptime integration for Microsoft Teams (Multi-tenant)",
          permissions: [
            "Team.ReadBasic.All",
            "Channel.ReadBasic.All", 
            "ChannelMessage.Send",
            "User.Read",
            "TeamMember.ReadWrite.All"
          ],
          redirectUris: [
            `${AppApiClientUrl.toString()}/api/teams/auth`
          ],
          environment_variables: {
            MICROSOFT_TEAMS_APP_CLIENT_ID: "Required - Your Azure AD App Client ID",
            MICROSOFT_TEAMS_APP_CLIENT_SECRET: "Required - Your Azure AD App Client Secret",
            MICROSOFT_TENANT_ID: "Optional - Set to 'common' for multi-tenant (default) or specific tenant ID"
          },
          setup_instructions: {
            azure_ad_app_registration: [
              "1. Go to Azure Portal > App Registrations > New Registration",
              "2. Set 'Supported account types' to 'Accounts in any organizational directory (Any Azure AD directory - Multitenant)'",
              "3. Add redirect URI: " + AppApiClientUrl.toString() + "/api/teams/auth",
              "4. In 'API permissions', add Microsoft Graph permissions listed above",
              "5. Generate a client secret and copy the client ID and secret",
              "6. Set MICROSOFT_TENANT_ID to 'common' for multi-tenant support"
            ]
          }
        };

        return Response.sendJsonObjectResponse(req, res, manifest);
      },
    );

    // OAuth redirect for project install (admin installs app in a team)
    router.get(
      "/teams/auth",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              "Microsoft Teams App Client credentials are not set",
            ),
          );
        }

        // Extract project_id and user_id from state parameter
        const stateParam: string | undefined = req.query["state"]?.toString();
        if (!stateParam) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Missing state parameter"),
          );
        }

        let projectIdStr: string;
        let userIdStr: string;
        let authType: string;
        
        try {
          const stateData = JSON.parse(Buffer.from(stateParam, 'base64').toString());
          projectIdStr = stateData.projectId;
          userIdStr = stateData.userId;
          authType = stateData.authType;
          
          if (!projectIdStr || !userIdStr || !authType) {
            throw new Error("Invalid state data");
          }
        } catch (error) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid state parameter"),
          );
        }

        const error: string | undefined = req.query["error"]?.toString();
        const code: string | undefined = req.query["code"]?.toString();

        const settingsUrl: URL = URL.fromString(
          `${DashboardClientUrl.toString()}/${projectIdStr.toString()}/settings/microsoft-teams-integration`,
        );

        if (error) {
          return Response.redirect(
            req,
            res,
            settingsUrl.addQueryParam("error", error),
          );
        }

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Missing code"),
          );
        }

        const redirectUri: URL = URL.fromString(
          `${AppApiClientUrl.toString()}/teams/auth`,
        );

        // Exchange code for tokens - use 'common' endpoint for multi-tenant support
        const tokenResp:
          | HTTPErrorResponse
          | HTTPResponse<JSONObject> = await API.post(
          URL.fromString(
            `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
          ),
          {
            client_id: MicrosoftTeamsAppClientId,
            client_secret: MicrosoftTeamsAppClientSecret,
            grant_type: "authorization_code",
            code: code,
            redirect_uri: redirectUri.toString(),
          },
          {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        );

        if (tokenResp instanceof HTTPErrorResponse) {
          
          logger.error(
            tokenResp.jsonData
          );

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Error from Microsoft: " + tokenResp.message),
          );
        }

        // Example response fields: access_token, id_token, refresh_token
        const accessToken: string | undefined = (tokenResp.jsonData as JSONObject)[
          "access_token"
        ] as string;
        
        const idToken: string | undefined = (tokenResp.jsonData as JSONObject)[
          "id_token"
        ] as string;

        if (!accessToken) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("No access token from Microsoft"),
          );
        }

        // Extract tenant information from the ID token
        let tenantId: string = MicrosoftTenantId || "common";
        let tenantName: string = "Microsoft Teams";
        let teamId: string = tenantId;

        if (idToken) {
          try {
            // Decode JWT payload (second part after splitting by '.')
            const tokenParts = idToken.split('.');
            if (tokenParts.length >= 2 && tokenParts[1]) {
              const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
              
              // Extract tenant information from token claims
              if (payload.tid) {
                tenantId = payload.tid;
                teamId = payload.tid;
              }
              
              // Try to get tenant name from various claims
              if (payload.tenant_name) {
                tenantName = payload.tenant_name;
              } else if (payload.tenant_display_name) {
                tenantName = payload.tenant_display_name;
              } else if (payload.iss && payload.iss.includes('/')) {
                // Extract tenant ID from issuer if available
                const issuerParts = payload.iss.split('/');
                const issuerTenantId = issuerParts[issuerParts.length - 2];
                if (issuerTenantId && issuerTenantId !== 'common') {
                  tenantId = issuerTenantId;
                  teamId = issuerTenantId;
                }
              }
            }
          } catch (error) {
            logger.error("Error decoding ID token: " + (error as Error).message);
            // Continue with default values
          }
        }

        // Handle different auth types based on state parameter
        if (authType === 'project') {
          // Project-level installation - save both project and user auth tokens
          await WorkspaceProjectAuthTokenService.refreshAuthToken({
            projectId: new ObjectID(projectIdStr),
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceProjectId: tenantId,
            miscData: {
              teamId: teamId,
              teamName: tenantName,
              tenantId: tenantId,
            },
          });

          // Also save user auth for the installing user
          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: new ObjectID(projectIdStr),
            userId: new ObjectID(userIdStr),
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceUserId: userIdStr,
            miscData: {
              userId: userIdStr,
              tenantId: tenantId,
            },
          });
        } else if (authType === 'user') {
          // User-level authentication only
          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: new ObjectID(projectIdStr),
            userId: new ObjectID(userIdStr),
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceUserId: userIdStr,
            miscData: {
              userId: userIdStr,
              tenantId: tenantId,
            },
          });
        }

        return Response.redirect(req, res, settingsUrl);
      },
    );

    return router;
  }
}

  
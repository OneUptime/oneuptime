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
          // Delegated permissions (user-consent scopes) used during interactive auth
          delegatedPermissions: [
            "Team.ReadBasic.All",
            "Channel.ReadBasic.All",
            "ChannelMessage.Send",
            "User.Read",
            "TeamMember.ReadWrite.All"
          ],
          // Application (client credentials) permissions required to post as the app/bot
          applicationPermissions: [
            "ChannelMessage.Send",
            "Channel.Create",
            "Channel.Delete.All",
            "Channel.ReadBasic.All",
            "ChannelMessage.Read.All",
            "Team.ReadBasic.All",
            "ChannelMember.Read.All",
            "ChannelMember.ReadWrite.All"
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
              "4. In 'API permissions' add Delegated: Team.ReadBasic.All, Channel.ReadBasic.All, ChannelMessage.Send, User.Read, TeamMember.ReadWrite.All",
              "5. In 'API permissions' add Application: ChannelMessage.Send, Channel.Create, Channel.Delete.All, Channel.ReadBasic.All, ChannelMessage.Read.All, Team.ReadBasic.All, ChannelMember.Read.All, ChannelMember.ReadWrite.All (then 'Grant admin consent')",
              "6. Generate a client secret and copy the client ID and secret",
              "7. Set MICROSOFT_TENANT_ID to your tenant ID or leave unset for multi-tenant ('common')",
              "8. (Optional) If app-only post fails with 403, ensure admin consent was granted and Teams resource-specific consent not required."
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

        const refreshToken: string | undefined = (tokenResp.jsonData as JSONObject)[
          "refresh_token"
        ] as string;

        const expiresIn: number | undefined = (tokenResp.jsonData as JSONObject)[
          "expires_in"
        ] as number; // seconds

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
        const tokenExpiryDate: string | undefined = expiresIn
          ? new Date(Date.now() + (expiresIn - 60) * 1000).toISOString() // subtract 60s buffer
          : undefined;

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
              refreshToken: refreshToken || "",
              tokenExpiresAt: tokenExpiryDate || "",
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
        refreshToken: refreshToken || "",
        tokenExpiresAt: tokenExpiryDate || "",
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
        refreshToken: refreshToken || "",
        tokenExpiresAt: tokenExpiryDate || "",
            },
          });
        }

        return Response.redirect(req, res, settingsUrl);
      },
    );

    // Endpoint to get available teams for a user
    router.post(
      "/teams/get-teams",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const userAuthTokenId: string = req.body["userAuthTokenId"] as string;
          
          if (!userAuthTokenId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("User auth token ID is required"),
            );
          }

          // Get the user auth token
          const userAuthToken = await WorkspaceUserAuthTokenService.findOneById({
            id: new ObjectID(userAuthTokenId),
            select: {
              authToken: true,
              userId: true,
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!userAuthToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("User auth token not found"),
            );
          }

          // Make API call to Microsoft Graph to get user's joined teams
          const response = await API.get(
            URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
            undefined,
            {
              Authorization: `Bearer ${userAuthToken.authToken}`,
              "Content-Type": "application/json",
            }
          );

          if (response instanceof HTTPErrorResponse) {
            logger.error("Error getting teams from Microsoft Graph:");
            logger.error(response);
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Failed to fetch teams from Microsoft Graph"),
            );
          }

          const teamsData = response.data as JSONObject;
          const teams = (teamsData["value"] as Array<JSONObject>) || [];

          // Transform the teams data to match our interface
          const transformedTeams = teams.map((team) => ({
            id: team["id"] as string,
            displayName: team["displayName"] as string,
            description: team["description"] as string || undefined,
          }));

          return Response.sendJsonObjectResponse(req, res, {
            teams: transformedTeams,
          });
        } catch (error) {
          logger.error("Error in /teams/get-teams endpoint:");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Failed to fetch teams"),
          );
        }
      },
    );

    // Diagnostics / readiness endpoint
    router.get(
      "/teams/readiness/:projectId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const projectIdParam: string | undefined = req.params["projectId"]?.toString();
          if (!projectIdParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("projectId param required"),
            );
          }

          const projectId: ObjectID = new ObjectID(projectIdParam);
          const projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
            projectId: projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
          });

          if (!projectAuth) {
            return Response.sendJsonObjectResponse(req, res, {
              projectId: projectId.toString(),
              hasProjectAuth: false,
              message: "No Microsoft Teams project auth found",
            });
          }

            const miscData = (projectAuth.miscData || {}) as JSONObject;
          const tenantId: string | undefined = miscData["tenantId"] as string | undefined;
          const teamId: string | undefined = miscData["teamId"] as string | undefined;
          const teamName: string | undefined = miscData["teamName"] as string | undefined;
          const appAccessTokenExpiresAt: string | undefined = miscData["appAccessTokenExpiresAt"] as string | undefined;
          const lastAppTokenIssuedAt: string | undefined = miscData["lastAppTokenIssuedAt"] as string | undefined;
          const delegatedTokenExpiresAt: string | undefined = miscData["tokenExpiresAt"] as string | undefined;

          // Determine which authority would be chosen for app token requests
          const preferredAuthority = (tenantId && tenantId !== 'common')
            ? tenantId
            : ((MicrosoftTenantId && MicrosoftTenantId !== 'common') ? MicrosoftTenantId : 'organizations');

          const now = Date.now();
          const issuedAgeSeconds = lastAppTokenIssuedAt ? Math.floor((now - Date.parse(lastAppTokenIssuedAt)) / 1000) : undefined;
          const appExpiryInSeconds = appAccessTokenExpiresAt ? Math.floor((Date.parse(appAccessTokenExpiresAt) - now) / 1000) : undefined;
          const delegatedExpiryInSeconds = delegatedTokenExpiresAt ? Math.floor((Date.parse(delegatedTokenExpiresAt) - now) / 1000) : undefined;

          return Response.sendJsonObjectResponse(req, res, {
            projectId: projectId.toString(),
            hasProjectAuth: true,
            tenantId: tenantId || null,
            teamId: teamId || null,
            teamName: teamName || null,
            preferredAuthority,
            appToken: {
              present: Boolean(miscData["appAccessToken"]),
              expiresAt: appAccessTokenExpiresAt || null,
              secondsUntilExpiry: appExpiryInSeconds,
              lastIssuedAt: lastAppTokenIssuedAt || null,
              ageSeconds: issuedAgeSeconds,
            },
            delegatedToken: {
              expiresAt: delegatedTokenExpiresAt || null,
              secondsUntilExpiry: delegatedExpiryInSeconds,
            },
          });
        } catch (error) {
          logger.error("Error in /teams/readiness endpoint:");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Failed to fetch readiness diagnostics"),
          );
        }
      },
    );

    return router;
  }
}

  
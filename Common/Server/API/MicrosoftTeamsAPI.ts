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
} from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";

export default class MicrosoftTeamsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    // Admin consent endpoint for application permissions
    router.get(
      "/teams/admin-consent",
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
        
        try {
          const stateData = JSON.parse(Buffer.from(stateParam, 'base64').toString());
          projectIdStr = stateData.projectId;
          userIdStr = stateData.userId;
          
          if (!projectIdStr || !userIdStr) {
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
        const adminConsent: string | undefined = req.query["admin_consent"]?.toString();
        const tenantId: string | undefined = req.query["tenant"]?.toString();

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

        if (adminConsent === "True" && tenantId) {
          // Admin consent was granted successfully
          logger.debug(`Admin consent granted for tenant ${tenantId} by user ${userIdStr}`);
          
          // Update or create the project auth token with admin consent status
          try {
            const existingAuth = await WorkspaceProjectAuthTokenService.findOneBy({
              query: {
                projectId: new ObjectID(projectIdStr),
                workspaceType: WorkspaceType.MicrosoftTeams,
              },
              select: {
                _id: true,
                miscData: true,
              },
              props: {
                isRoot: true,
              },
            });

            const currentMiscData = (existingAuth?.miscData as any) || {};
            const updatedMiscData = {
              ...currentMiscData,
              tenantId: tenantId,
              adminConsentGranted: true,
              adminConsentGrantedAt: new Date().toISOString(),
              adminConsentGrantedBy: userIdStr,
              teamName: currentMiscData.teamName || 'Microsoft Teams',
              teamId: currentMiscData.teamId || tenantId,
            };

            if (existingAuth) {
              // Update existing auth token
              await WorkspaceProjectAuthTokenService.updateOneById({
                id: existingAuth.id!,
                data: {
                  miscData: updatedMiscData,
                },
                props: {
                  isRoot: true,
                },
              });
            } else {
              // Create new project auth token with admin consent
              const newAuthToken = new WorkspaceProjectAuthToken();
              newAuthToken.projectId = new ObjectID(projectIdStr);
              newAuthToken.workspaceType = WorkspaceType.MicrosoftTeams;
              newAuthToken.authToken = `admin-consent-${tenantId}-${Date.now()}`; // Placeholder token
              newAuthToken.workspaceProjectId = tenantId;
              newAuthToken.miscData = updatedMiscData;

              await WorkspaceProjectAuthTokenService.create({
                data: newAuthToken,
                props: {
                  isRoot: true,
                },
              });
            }

            return Response.redirect(
              req,
              res,
              settingsUrl.addQueryParam("admin_consent", "granted"),
            );
          } catch (updateError) {
            logger.error("Error updating admin consent status:");
            logger.error(updateError);
            return Response.redirect(
              req,
              res,
              settingsUrl.addQueryParam("error", "consent_update_failed"),
            );
          }
        } else {
          // Admin consent was denied or failed
          return Response.redirect(
            req,
            res,
            settingsUrl.addQueryParam("error", "admin_consent_denied"),
          );
        }
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

          let errorMessage = "Error from Microsoft: " + tokenResp.message;

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(errorMessage),
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
        let tenantId: string = "common";
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

        // Attempt to fetch user's joined teams to auto-select the first team (improves UX so we don't
        // display 'Microsoft Teams on Microsoft Teams'). We only do this if we have not already
        // identified a specific team (currently teamId defaults to tenantId) and we have a valid access token
        // with the Team.ReadBasic.All scope.
        try {
          const teamsResponse = await API.get(
            URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
            undefined,
            {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            }
          );

          if (!(teamsResponse instanceof HTTPErrorResponse)) {
            const teamsJson = teamsResponse.data as JSONObject;
            const teamsArr: Array<JSONObject> = (teamsJson["value"] as Array<JSONObject>) || [];
            if (teamsArr.length > 0) {
              const firstTeam: JSONObject = teamsArr[0] as JSONObject;
              const firstTeamId: string | undefined = firstTeam["id"] as string | undefined;
              const firstTeamName: string | undefined = firstTeam["displayName"] as string | undefined;
              // Only override if we have meaningful data.
              if (firstTeamId) {
                teamId = firstTeamId;
              }
              if (firstTeamName) {
                tenantName = firstTeamName;
              }
            }
          } else {
            logger.debug("Could not auto-fetch Teams list to select default team. Proceeding with tenant defaults.");
          }
        } catch (autoSelectErr) {
          logger.error("Error auto-selecting first Microsoft Team: " + (autoSelectErr as Error).message);
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

    return router;
  }
}

  
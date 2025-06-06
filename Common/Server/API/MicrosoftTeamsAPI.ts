import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import logger from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  Host,
  HttpProtocol,
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
  MicrosoftTeamsAppTenantId,
} from "../EnvironmentConfig";
import MicrosoftTeamsAppManifest from "../Utils/Workspace/MicrosoftTeams/app-manifest.json";
import URL from "../../Types/API/URL";
import HTTPResponse from "../../Types/API/HTTPResponse";
import API from "../../Utils/API";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import {
  MicrosoftTeamsMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import Route from "../../Types/API/Route";

export default class MicrosoftTeamsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.get(
      "/microsoft-teams/app-manifest",
      (req: ExpressRequest, res: ExpressResponse) => {
        // return app manifest for Microsoft Teams app

        let ServerURL: string = new URL(HttpProtocol, Host).toString();

        //remove trailing slash if present.
        if (ServerURL.endsWith("/")) {
          ServerURL = ServerURL.slice(0, -1);
        }

        const ServerDomain: string = new URL(HttpProtocol, Host).hostname.toString();

        // replace placeholders in the manifest with actual values.
        // If client ID is not set, use placeholder text to guide users
        let manifestInString: string = JSON.stringify(
          MicrosoftTeamsAppManifest,
        )
          .replace(/{{SERVER_URL}}/g, ServerURL.toString())
          .replace(/{{SERVER_DOMAIN}}/g, ServerDomain)
          .replace(/{{MICROSOFT_TEAMS_APP_CLIENT_ID}}/g, MicrosoftTeamsAppClientId || "YOUR_MICROSOFT_TEAMS_APP_CLIENT_ID");

        // convert it back to json.
        const manifest: JSONObject = JSON.parse(manifestInString);

        return Response.sendJsonObjectResponse(req, res, manifest);
      },
    );

    // OAuth callback endpoint for Microsoft Teams
    router.get(
      "/microsoft-teams/auth/:projectId/:userId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!MicrosoftTeamsAppClientId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Microsoft Teams App Client ID is not set"),
          );
        }

        if (!MicrosoftTeamsAppClientSecret) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Microsoft Teams App Client Secret is not set"),
          );
        }

        if (!MicrosoftTeamsAppTenantId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Microsoft Teams App Tenant ID is not set"),
          );
        }

        const projectId: string | undefined =
          req.params["projectId"]?.toString();
        const userId: string | undefined = req.params["userId"]?.toString();

        if (!projectId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid ProjectID in request"),
          );
        }

        if (!userId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid UserID in request"),
          );
        }

        const code: string | undefined = req.query["code"]?.toString();
        const state: string | undefined = req.query["state"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Authorization code is missing"),
          );
        }

        try {
          // Exchange authorization code for access token
          const tokenResponse: HTTPResponse<JSONObject> = await API.post(
            URL.fromString(
              `https://login.microsoftonline.com/${MicrosoftTeamsAppTenantId}/oauth2/v2.0/token`,
            ),
            {
              grant_type: "authorization_code",
              client_id: MicrosoftTeamsAppClientId,
              client_secret: MicrosoftTeamsAppClientSecret,
              code: code,
              redirect_uri: `${new URL(HttpProtocol, Host).toString()}/api/microsoft-teams/auth/${projectId}/${userId}`,
            },
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          );

          if (tokenResponse.isFailure()) {
            logger.error("Failed to exchange code for token");
            logger.error(tokenResponse.jsonData);
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Failed to authenticate with Microsoft Teams"),
            );
          }

          const accessToken: string = tokenResponse.data["access_token"] as string;

          // Get user info from Microsoft Graph
          const userResponse: HTTPResponse<JSONObject> = await API.get(
            URL.fromString("https://graph.microsoft.com/v1.0/me"),
            {},
            {
              Authorization: `Bearer ${accessToken}`,
            },
          );

          if (userResponse.isFailure()) {
            logger.error("Failed to get user info from Microsoft Graph");
            logger.error(userResponse.jsonData);
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Failed to get user information"),
            );
          }

          // Get team info if state contains team context
          let teamInfo: JSONObject | null = null;
          if (state) {
            try {
              const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
              if (stateData.teamId) {
                const teamResponse: HTTPResponse<JSONObject> = await API.get(
                  URL.fromString(`https://graph.microsoft.com/v1.0/teams/${stateData.teamId}`),
                  {},
                  {
                    Authorization: `Bearer ${accessToken}`,
                  },
                );

                if (teamResponse.isSuccess()) {
                  teamInfo = teamResponse.data;
                }
              }
            } catch (error) {
              logger.error("Failed to parse state or get team info");
              logger.error(error);
            }
          }

          // Save user auth token
          const userAuth = new WorkspaceUserAuthToken();
          userAuth.userId = new ObjectID(userId);
          userAuth.projectId = new ObjectID(projectId);
          userAuth.workspaceType = WorkspaceType.MicrosoftTeams;
          userAuth.authToken = accessToken;
          userAuth.workspaceUserId = userResponse.data["id"] as string;
          userAuth.miscData = { userId: userResponse.data["id"] as string };

          await WorkspaceUserAuthTokenService.create({
            data: userAuth,
            props: {
              isRoot: true,
            },
          });

          // Save project auth token if team info is available
          if (teamInfo) {
            const miscData: MicrosoftTeamsMiscData = {
              teamId: teamInfo["id"] as string,
              teamName: teamInfo["displayName"] as string,
              tenantId: MicrosoftTeamsAppTenantId,
            };

            const projectAuth = new WorkspaceProjectAuthToken();
            projectAuth.projectId = new ObjectID(projectId);
            projectAuth.workspaceType = WorkspaceType.MicrosoftTeams;
            projectAuth.authToken = accessToken;
            projectAuth.workspaceProjectId = teamInfo["id"] as string;
            projectAuth.miscData = miscData;

            await WorkspaceProjectAuthTokenService.create({
              data: projectAuth,
              props: {
                isRoot: true,
              },
            });
          }

          // Redirect back to dashboard
          return Response.redirect(
            req,
            res,
            new URL(HttpProtocol, Host, new Route("/dashboard/settings/microsoft-teams")),
          );
        } catch (error) {
          logger.error("Error in Microsoft Teams OAuth callback");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Authentication failed"),
          );
        }
      },
    );

    return router;
  }
}

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
          description: "OneUptime integration for Microsoft Teams",
          permissions: [
            "Team.ReadBasic.All",
            "Channel.ReadBasic.All", 
            "ChannelMessage.Send",
            "User.Read",
            "TeamMember.ReadWrite.All"
          ],
          redirectUris: [
            `${AppApiClientUrl.toString()}/teams/auth/{projectId}/{userId}`
          ],
          environment_variables: {
            MICROSOFT_TEAMS_APP_CLIENT_ID: "Required - Your Azure AD App Client ID",
            MICROSOFT_TEAMS_APP_CLIENT_SECRET: "Required - Your Azure AD App Client Secret",
            MICROSOFT_TENANT_ID: "Required - Your Azure AD Tenant ID or 'common'"
          }
        };

        return Response.sendJsonObjectResponse(req, res, manifest);
      },
    );

    // OAuth redirect for project install (admin installs app in a team)
    router.get(
      "/teams/auth/:projectId/:userId",
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

        const projectIdStr: string | undefined = req.params["projectId"];
        const userIdStr: string | undefined = req.params["userId"];
        if (!projectIdStr || !userIdStr) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid request"),
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
          `${AppApiClientUrl.toString()}/teams/auth/${projectIdStr}/${userIdStr}`,
        );

        // Exchange code for tokens
        const tokenResp:
          | HTTPErrorResponse
          | HTTPResponse<JSONObject> = await API.post(
          URL.fromString(
            `https://login.microsoftonline.com/${MicrosoftTenantId}/oauth2/v2.0/token`,
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

        if (!accessToken) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("No access token from Microsoft"),
          );
        }

        // We use access token to fetch the primary team id and bot identity for storage
        await WorkspaceProjectAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectIdStr),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceProjectId: MicrosoftTenantId,
          miscData: {
            teamId: MicrosoftTenantId,
            teamName: "Microsoft Teams",
            tenantId: MicrosoftTenantId,
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
          },
        });

        return Response.redirect(req, res, settingsUrl);
      },
    );

    // User-specific auth endpoint similar to Slack
    router.get(
      "/teams/auth/:projectId/:userId/user",
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

        const projectIdStr: string | undefined = req.params["projectId"];
        const userIdStr: string | undefined = req.params["userId"];
        if (!projectIdStr || !userIdStr) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid request"),
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
          `${AppApiClientUrl.toString()}/teams/auth/${projectIdStr}/${userIdStr}/user`,
        );

        // Exchange code for tokens
        const tokenResp:
          | HTTPErrorResponse
          | HTTPResponse<JSONObject> = await API.post(
          URL.fromString(
            `https://login.microsoftonline.com/${MicrosoftTenantId}/oauth2/v2.0/token`,
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
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Error from Microsoft: " + tokenResp.message),
          );
        }

        const accessToken: string | undefined = (tokenResp.jsonData as JSONObject)[
          "access_token"
        ] as string;

        if (!accessToken) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("No access token from Microsoft"),
          );
        }

        // Save user auth token
        await WorkspaceUserAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectIdStr),
          userId: new ObjectID(userIdStr),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceUserId: userIdStr, // This should be the actual Teams user ID
          miscData: {
            userId: userIdStr,
          },
        });

        return Response.redirect(req, res, settingsUrl);
      },
    );

    return router;
  }
}

  
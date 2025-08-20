import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadRequestException from "../../Types/Exception/BadRequestException";
import logger from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  AppApiClientUrl,
  DashboardClientUrl,
  Host,
  HttpProtocol,
  MicrosoftTeamsAppId,
  MicrosoftTeamsAppPassword,
  MicrosoftTeamsTenantId,
} from "../EnvironmentConfig";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import API from "../../Utils/API";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "../Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsAlertActions from "../Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsScheduledMaintenanceActions from "../Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import MicrosoftTeamsMonitorActions from "../Utils/Workspace/MicrosoftTeams/Actions/Monitor";
import MicrosoftTeamsOnCallDutyActions from "../Utils/Workspace/MicrosoftTeams/Actions/OnCallDutyPolicy";
import WorkspaceProjectAuthToken, {
  MiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import MicrosoftTeamsAuthorization from "../Middleware/MicrosoftTeamsAuthorization";

export interface MicrosoftTeamsMiscData extends MiscData {
  teamId: string;
  teamName: string;
  tenantId: string;
  serviceUrl: string;
}

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

        // Microsoft Teams app manifest
        const manifest: JSONObject = {
          "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.14/MicrosoftTeams.schema.json",
          "manifestVersion": "1.14",
          "version": "1.0.0",
          "id": MicrosoftTeamsAppId || "",
          "packageName": "com.oneuptime.teams",
          "developer": {
            "name": "OneUptime",
            "websiteUrl": ServerURL,
            "privacyUrl": `${ServerURL}/privacy`,
            "termsOfUseUrl": `${ServerURL}/terms`,
          },
          "icons": {
            "color": "icon-color.png",
            "outline": "icon-outline.png",
          },
          "name": {
            "short": "OneUptime",
            "full": "OneUptime - Monitoring and Incident Management",
          },
          "description": {
            "short": "Monitor your services and manage incidents",
            "full": "OneUptime helps you monitor your services, manage incidents, alerts, and scheduled maintenance events directly from Microsoft Teams.",
          },
          "accentColor": "#FFFFFF",
          "bots": [
            {
              "botId": MicrosoftTeamsAppId || "",
              "scopes": ["personal", "team", "groupchat"],
              "supportsFiles": false,
              "isNotificationOnly": false,
              "commandLists": [
                {
                  "scopes": ["personal", "team", "groupchat"],
                  "commands": [
                    {
                      "title": "help",
                      "description": "Show help information",
                    },
                    {
                      "title": "incidents",
                      "description": "List recent incidents",
                    },
                    {
                      "title": "alerts",
                      "description": "List recent alerts",
                    },
                  ],
                },
              ],
            },
          ],
          "permissions": ["identity", "messageTeamMembers"],
          "validDomains": [Host.toString()],
          "webApplicationInfo": {
            "id": MicrosoftTeamsAppId || "",
            "resource": `api://${Host.toString()}/${MicrosoftTeamsAppId}`,
          },
        };

        return Response.sendJsonObjectResponse(req, res, manifest);
      },
    );

    // OAuth2 authorization endpoint for Microsoft Teams
    router.get(
      "/microsoft-teams/auth/:projectId/:userId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!MicrosoftTeamsAppId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Microsoft Teams App ID is not set"),
          );
        }

        if (!MicrosoftTeamsAppPassword) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Microsoft Teams App Password is not set"),
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

        // if there's an error query param.
        const error: string | undefined = req.query["error"]?.toString();

        const teamsIntegrationPageUrl: URL = URL.fromString(
          DashboardClientUrl.toString() +
            `/${projectId.toString()}/settings/microsoft-teams-integration`,
        );

        if (error) {
          return Response.redirect(
            req,
            res,
            teamsIntegrationPageUrl.addQueryParam("error", error),
          );
        }

        // Microsoft Teams returns the code on successful auth.
        const code: string | undefined = req.query["code"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request - no code provided"),
          );
        }

        // Exchange code for access token
        const redirectUri: URL = URL.fromString(
          `${AppApiClientUrl.toString()}/microsoft-teams/auth/${projectId}/${userId}`,
        );

        const tokenEndpoint: string = MicrosoftTeamsTenantId
          ? `https://login.microsoftonline.com/${MicrosoftTeamsTenantId}/oauth2/v2.0/token`
          : `https://login.microsoftonline.com/common/oauth2/v2.0/token`;

        const requestBody: JSONObject = {
          client_id: MicrosoftTeamsAppId,
          client_secret: MicrosoftTeamsAppPassword,
          code: code,
          redirect_uri: redirectUri.toString(),
          grant_type: "authorization_code",
          scope: "https://graph.microsoft.com/.default",
        };

        logger.debug("Microsoft Teams Auth Request Body: ");
        logger.debug(requestBody);

        // send the request to Microsoft to get the access token
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post(
            URL.fromString(tokenEndpoint),
            requestBody,
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          );

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const responseBody: JSONObject = response.data;

        logger.debug("Microsoft Teams Auth Response Body: ");
        logger.debug(responseBody);

        const accessToken: string | undefined =
          responseBody["access_token"]?.toString();

        if (!accessToken) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Failed to get access token"),
          );
        }

        // Get team information using the access token
        const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get(
            URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
            {},
            {
              Authorization: `Bearer ${accessToken}`,
            },
          );

        if (teamsResponse instanceof HTTPErrorResponse) {
          throw teamsResponse;
        }

        const teams: Array<JSONObject> = (teamsResponse.data as JSONObject)[
          "value"
        ] as Array<JSONObject>;

        if (!teams || teams.length === 0) {
          return Response.redirect(
            req,
            res,
            teamsIntegrationPageUrl.addQueryParam(
              "error",
              "No teams found for this user",
            ),
          );
        }

        // For now, we'll use the first team
        // In a production app, you might want to let the user select which team to connect
        const team: JSONObject = teams[0]!;
        const teamId: string = team["id"]?.toString() || "";
        const teamName: string = team["displayName"]?.toString() || "";

        // Store the auth token and team information
        await WorkspaceProjectAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceProjectId: teamId,
          miscData: {
            teamId: teamId,
            teamName: teamName,
            tenantId: MicrosoftTeamsTenantId || "",
            serviceUrl: "https://smba.trafficmanager.net/amer/",
          } as MicrosoftTeamsMiscData,
        });

        // Store user auth token
        await WorkspaceUserAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          userId: new ObjectID(userId),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceUserId: userId, // Using userId as Teams doesn't have a separate user ID in this context
          miscData: {
            userId: userId,
          },
        });

        // return back to dashboard after successful auth.
        Response.redirect(req, res, teamsIntegrationPageUrl);
      },
    );

    // Webhook endpoint for Microsoft Teams bot messages and events
    router.post(
      "/microsoft-teams/webhook",
      MicrosoftTeamsAuthorization.isAuthorizedMicrosoftTeamsRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug("Microsoft Teams Webhook Request: ");
        logger.debug(req.body);

        const authResult: MicrosoftTeamsRequest =
          await MicrosoftTeamsAuthAction.isAuthorized({
            req: req,
          });

        logger.debug("Microsoft Teams Auth Result: ");
        logger.debug(authResult);

        // Handle app uninstall
        if (authResult.payloadType === "app_uninstall") {
          logger.debug("Microsoft Teams App Uninstall Request: ");

          // delete all user auth tokens for this project.
          await WorkspaceUserAuthTokenService.deleteBy({
            query: {
              projectId: authResult.projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          await WorkspaceProjectAuthTokenService.deleteBy({
            query: {
              projectId: authResult.projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            limit: 1,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          logger.debug(
            "Microsoft Teams App Uninstall Request: Deleted all auth tokens.",
          );
          // return empty response.
          return Response.sendJsonObjectResponse(req, res, {});
        }

        if (authResult.isAuthorized === false) {
          // return empty response if not authorized. Do nothing in this case.
          return Response.sendJsonObjectResponse(req, res, {});
        }

        // Handle different action types
        for (const action of authResult.actions || []) {
          if (!action.actionType) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid request - no action type"),
            );
          }

          if (
            MicrosoftTeamsIncidentActions.isIncidentAction({
              actionType: action.actionType,
            })
          ) {
            return MicrosoftTeamsIncidentActions.handleIncidentAction({
              teamsRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            MicrosoftTeamsOnCallDutyActions.isOnCallDutyAction({
              actionType: action.actionType,
            })
          ) {
            return MicrosoftTeamsOnCallDutyActions.handleOnCallDutyAction({
              teamsRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            MicrosoftTeamsAlertActions.isAlertAction({
              actionType: action.actionType,
            })
          ) {
            return MicrosoftTeamsAlertActions.handleAlertAction({
              teamsRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            MicrosoftTeamsMonitorActions.isMonitorAction({
              actionType: action.actionType,
            })
          ) {
            return MicrosoftTeamsMonitorActions.handleMonitorAction({
              teamsRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            MicrosoftTeamsScheduledMaintenanceActions.isScheduledMaintenanceAction(
              {
                actionType: action.actionType,
              },
            )
          ) {
            return MicrosoftTeamsScheduledMaintenanceActions.handleScheduledMaintenanceAction(
              {
                teamsRequest: authResult,
                action: action,
                req: req,
                res: res,
              },
            );
          }
        }

        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Invalid request - unhandled action type"),
        );
      },
    );

    return router;
  }
}
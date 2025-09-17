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
  AppVersion,
  DashboardClientUrl,
  HomeClientUrl,
  Host,
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
} from "../EnvironmentConfig";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import API from "../../Utils/API";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "../Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsAlertActions from "../Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsScheduledMaintenanceActions from "../Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsMonitorActions from "../Utils/Workspace/MicrosoftTeams/Actions/Monitor";
import MicrosoftTeamsOnCallDutyActions from "../Utils/Workspace/MicrosoftTeams/Actions/OnCallDutyPolicy";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import archiver from "archiver";
import fs from "fs";
import path from "path";

interface MicrosoftTeamsTeam {
  id: string;
  displayName: string;
}

export default class MicrosoftTeamsAPI {
  private static getTeamsAppManifest(
  ): JSONObject {

    if(!MicrosoftTeamsAppClientId){
      throw new BadDataException("Microsoft Teams App Client ID is not set");
    }

    const manifest: JSONObject = {
      $schema:
        "https://developer.microsoft.com/json-schemas/teams/v1.13/MicrosoftTeams.schema.json",
      manifestVersion: "1.13",
      version: AppVersion || "1.0.0",
      id: MicrosoftTeamsAppClientId || "{{MICROSOFT_TEAMS_APP_CLIENT_ID}}",
      packageName: "com.oneuptime.teams",
      developer: {
        name: "OneUptime",
        websiteUrl: "https://oneuptime.com",
        privacyUrl: "https://oneuptime.com/legal/privacy",
        termsOfUseUrl: "https://oneuptime.com/legal/terms",
      },
      name: {
        short: "OneUptime",
        full: "OneUptime - Complete Observability Platform",
      },
      description: {
        short: "Monitor your apps, websites, APIs, and more with OneUptime",
        full: "OneUptime is a complete open-source observability platform that helps you monitor your applications, websites, APIs, and infrastructure. Get alerted when things go wrong and maintain your SLAs.",
      },
      icons: 
       {
            outline: "outline.png",
            color: "color.png",
          }
       ,
      accentColor: "#000000",
      bots: [
        {
          botId:
            MicrosoftTeamsAppClientId,
          needsChannelSelector: false,
          isNotificationOnly: false,
          scopes: ["team", "personal"],
          supportsFiles: false,
          supportsCalling: false,
          supportsVideo: false,
        },
      ],
      connectors: [
        {
          connectorId:
            MicrosoftTeamsAppClientId,
          configurationUrl: `${HomeClientUrl.toString()}microsoft-teams/connector-config`,
        },
      ],
      permissions: ["identity", "messageTeamMembers"],
      validDomains: [Host, "*.teams.microsoft.com"],
      webApplicationInfo: {
        id:
          MicrosoftTeamsAppClientId || "{{MICROSOFT_TEAMS_APP_CLIENT_ID}}",
        resource: "https://graph.microsoft.com",
      },
    };

    return manifest;
  }

  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    // Teams app manifest ZIP endpoint
    router.get(
      "/microsoft-teams/app-manifest-zip",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
         

          const manifest: JSONObject = MicrosoftTeamsAPI.getTeamsAppManifest(
          );

          // Set response headers for zip download
          res.setHeader("Content-Type", "application/zip");
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="oneuptime-teams-app.zip"',
          );

          // Create archive
          const archive: any = archiver("zip", {
            zlib: { level: 9 }, // Sets the compression level
          });

          // Handle archive errors
          archive.on("error", (err: Error) => {
            logger.error("Archive error: " + err);
            throw err;
          });

          // Pipe archive data to the response
          archive.pipe(res);

          // Add manifest.json to zip
          archive.append(JSON.stringify(manifest, null, 2), {
            name: "manifest.json",
          });

          // Read pre-resized icons
          const iconsDir = path.join(__dirname, '..', '..', '..', 'Common', 'Server', 'Images', 'MicrosoftTeams');
          const colorIcon = fs.readFileSync(path.join(iconsDir, 'color.png'));
          const outlineIcon = fs.readFileSync(path.join(iconsDir, 'outline.png'));
          
          archive.append(colorIcon, { name: "color.png" });
          archive.append(outlineIcon, { name: "outline.png" });

          // Finalize the archive
          await archive.finalize();
        } catch (error) {
          logger.error("Error creating Teams app manifest zip: " + error);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Failed to create Teams app manifest zip"),
          );
        }
      },
    );

    // Microsoft Teams OAuth callback endpoint for project integration
    // New (preferred) static redirect URI that uses state param to carry projectId and userId
    // State format: <projectId>:<userId>
    router.get(
      "/microsoft-teams/auth",
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
            new BadDataException(
              "Microsoft Teams App Client Secret is not set",
            ),
          );
        }

        const error: string | undefined = req.query["error"]?.toString();
        const stateParam: string | undefined = req.query["state"]?.toString();

        if (!stateParam) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException(
              "Invalid request - state param not present",
            ),
          );
        }

        // Expect state in format projectId:userId
        const stateParts: Array<string> = stateParam.split(":");
        if (stateParts.length !== 2 || !stateParts[0] || !stateParts[1]) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid state param"),
          );
        }

        const projectId: string = stateParts[0]!;
        const userId: string = stateParts[1]!;

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

        const code: string | undefined = req.query["code"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request - no authorization code"),
          );
        }

        try {
          // Exchange code for access token
          const redirectUri: URL = URL.fromString(
            `${AppApiClientUrl.toString()}/microsoft-teams/auth`,
          );

          const tokenRequestBody: JSONObject = {
            grant_type: "authorization_code",
            code: code,
            client_id: MicrosoftTeamsAppClientId,
            client_secret: MicrosoftTeamsAppClientSecret,
            redirect_uri: redirectUri.toString(),
            scope:
              "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/ChannelMessage.Send",
          };

          logger.debug(
            "Microsoft Teams Token Request Body (static redirect): ",
          );
          logger.debug(tokenRequestBody);

          const tokenResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.post(
              URL.fromString(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
              ),
              tokenRequestBody,
              {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            );

          if (tokenResponse instanceof HTTPErrorResponse) {
            logger.error("Error getting Teams token:");
            logger.error(tokenResponse);
            throw tokenResponse;
          }

          const tokenData: JSONObject = tokenResponse.data;
          logger.debug("Microsoft Teams Token Response (static redirect): ");
          logger.debug(tokenData);

          if (!tokenData["access_token"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException(
                "Failed to get access token from Microsoft Teams",
              ),
            );
          }

          const accessToken: string = tokenData["access_token"] as string;

          // Get user profile and team information
          const userProfileResponse:
            | HTTPErrorResponse
            | HTTPResponse<JSONObject> = await API.get(
            URL.fromString("https://graph.microsoft.com/v1.0/me"),
            undefined,
            {
              Authorization: `Bearer ${accessToken}`,
            },
          );

          if (userProfileResponse instanceof HTTPErrorResponse) {
            logger.error("Error getting user profile:");
            logger.error(userProfileResponse);
            throw userProfileResponse;
          }

          const userProfile: JSONObject = userProfileResponse.data;
          logger.debug("User Profile: ");
          logger.debug(userProfile);

          // Get user's teams
          const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get(
              URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
              undefined,
              {
                Authorization: `Bearer ${accessToken}`,
              },
            );

          if (teamsResponse instanceof HTTPErrorResponse) {
            logger.error("Error getting teams:");
            logger.error(teamsResponse);
            throw teamsResponse;
          }

          const teamsData: JSONObject = teamsResponse.data;
          const teams: Array<JSONObject> =
            (teamsData["value"] as Array<JSONObject>) || [];

          if (teams.length === 0) {
            return Response.redirect(
              req,
              res,
              teamsIntegrationPageUrl.addQueryParam(
                "error",
                "You are not a member of any Microsoft Teams. Please join a team first.",
              ),
            );
          }
          // Unified handling for single vs multiple teams (no if/else block)
          const availableTeams: Array<MicrosoftTeamsTeam> = teams.map(
            (t: JSONObject): MicrosoftTeamsTeam => {
              return {
                id: t["id"] as string,
                displayName: (t["displayName"] as string) || "Unnamed Team",
              };
            },
          );
          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: new ObjectID(projectId),
            userId: new ObjectID(userId),
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceUserId: userProfile["id"] as string,
            miscData: {
              userId: userProfile["id"] as string,
              displayName: userProfile["displayName"] as string,
              email:
                (userProfile["mail"] as string) ||
                (userProfile["userPrincipalName"] as string),
              availableTeams: availableTeams,
            },
          });

          return Response.redirect(
            req,
            res,
            teamsIntegrationPageUrl.addQueryParam("selectTeam", "true"),
          );
        } catch (err) {
          logger.error("Error in static Microsoft Teams auth callback: ");
          logger.error(err);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Failed to authenticate with Microsoft Teams"),
          );
        }
      },
    );

    // Deprecated (legacy) route that had projectId and userId in path params. Kept for backward compatibility.
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
            new BadDataException(
              "Microsoft Teams App Client Secret is not set",
            ),
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

        const code: string | undefined = req.query["code"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request - no authorization code"),
          );
        }

        // Exchange code for access token
        const redirectUri: URL = URL.fromString(
          `${AppApiClientUrl.toString()}/microsoft-teams/auth/${projectId}/${userId}`,
        );

        const tokenRequestBody: JSONObject = {
          grant_type: "authorization_code",
          code: code,
          client_id: MicrosoftTeamsAppClientId,
          client_secret: MicrosoftTeamsAppClientSecret,
          redirect_uri: redirectUri.toString(),
          scope:
            "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/ChannelMessage.Send",
        };

        logger.debug("Microsoft Teams Token Request Body: ");
        logger.debug(tokenRequestBody);

        const tokenResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post(
            URL.fromString(
              "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            ),
            tokenRequestBody,
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          );

        if (tokenResponse instanceof HTTPErrorResponse) {
          logger.error("Error getting Teams token:");
          logger.error(tokenResponse);
          throw tokenResponse;
        }

        const tokenData: JSONObject = tokenResponse.data;
        logger.debug("Microsoft Teams Token Response: ");
        logger.debug(tokenData);

        if (!tokenData["access_token"]) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException(
              "Failed to get access token from Microsoft Teams",
            ),
          );
        }

        const accessToken: string = tokenData["access_token"] as string;

        // Get user profile and team information
        const userProfileResponse:
          | HTTPErrorResponse
          | HTTPResponse<JSONObject> = await API.get(
          URL.fromString("https://graph.microsoft.com/v1.0/me"),
          undefined,
          {
            Authorization: `Bearer ${accessToken}`,
          },
        );

        if (userProfileResponse instanceof HTTPErrorResponse) {
          logger.error("Error getting user profile:");
          logger.error(userProfileResponse);
          throw userProfileResponse;
        }

        const userProfile: JSONObject = userProfileResponse.data;
        logger.debug("User Profile: ");
        logger.debug(userProfile);

        // Get user's teams
        const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get(
            URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
            undefined,
            {
              Authorization: `Bearer ${accessToken}`,
            },
          );

        if (teamsResponse instanceof HTTPErrorResponse) {
          logger.error("Error getting teams:");
          logger.error(teamsResponse);
          throw teamsResponse;
        }

        const teamsData: JSONObject = teamsResponse.data;
        const teams: Array<JSONObject> =
          (teamsData["value"] as Array<JSONObject>) || [];

        if (teams.length === 0) {
          return Response.redirect(
            req,
            res,
            teamsIntegrationPageUrl.addQueryParam(
              "error",
              "You are not a member of any Microsoft Teams. Please join a team first.",
            ),
          );
        }

        const availableTeams: Array<MicrosoftTeamsTeam> = teams.map(
          (t: JSONObject): MicrosoftTeamsTeam => {
            return {
              id: t["id"] as string,
              displayName: (t["displayName"] as string) || "Unnamed Team",
            };
          },
        );

        await WorkspaceUserAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          userId: new ObjectID(userId),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceUserId: userProfile["id"] as string,
          miscData: {
            userId: userProfile["id"] as string,
            displayName: userProfile["displayName"] as string,
            email:
              (userProfile["mail"] as string) ||
              (userProfile["userPrincipalName"] as string),
            availableTeams: availableTeams,
          },
        });

        Response.redirect(
          req,
          res,
          teamsIntegrationPageUrl.addQueryParam("selectTeam", "true"),
        );
      },
    );

    // Endpoint to finalize team selection when multiple teams are available.
    router.post(
      "/microsoft-teams/select-team",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const projectIdString: string | undefined = req.body["projectId"];
          const userIdString: string | undefined = req.body["userId"];
          const teamId: string | undefined = req.body["teamId"];

          if (!projectIdString || !userIdString || !teamId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException(
                "projectId, userId and teamId are required",
              ),
            );
          }

          const projectId: ObjectID = new ObjectID(projectIdString);
          const userId: ObjectID = new ObjectID(userIdString);

          // Fetch user auth to get access token and available teams.
          const userAuth: WorkspaceUserAuthToken | null =
            await WorkspaceUserAuthTokenService.getUserAuth({
              projectId: projectId,
              userId: userId,
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          if (!userAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException(
                "User Microsoft Teams auth not found. Please re-authenticate.",
              ),
            );
          }

          const accessToken: string = userAuth.authToken || "";
          const miscData: any = userAuth.miscData || {};
          const availableTeams: Array<MicrosoftTeamsTeam> =
            (miscData.availableTeams as Array<MicrosoftTeamsTeam>) || [];
          const matchedTeam: MicrosoftTeamsTeam | undefined =
            availableTeams.find((t: MicrosoftTeamsTeam) => {
              return t.id === teamId;
            });

          if (!matchedTeam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException(
                "Selected teamId is not in availableTeams list",
              ),
            );
          }

          // Decode JWT to get tenant ID
          const tokenParts: Array<string> = accessToken.split('.');
          if (tokenParts.length !== 3) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid JWT token"),
            );
          }
          const payload: JSONObject = JSON.parse(
            Buffer.from(tokenParts[1]!, 'base64').toString('utf-8'),
          );
          const tenantId: string = payload['tid'] as string;

          if (!tenantId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Tenant ID not found in token"),
            );
          }

          // Persist project auth now that team is selected.
          await WorkspaceProjectAuthTokenService.refreshAuthToken({
            projectId: projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceProjectId: teamId,
            miscData: {
              tenantId: tenantId,
              teamId: teamId,
              teamName: matchedTeam.displayName,
              botId: MicrosoftTeamsAppClientId || "",
            } as any,
          });

          // Update user token to remove availableTeams (cleanup) and store selected team info
          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: projectId,
            userId: userId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceUserId: miscData.userId || "",
            miscData: {
              userId: miscData.userId,
              displayName: miscData.displayName,
              email: miscData.email,
              teamId: teamId,
              teamName: matchedTeam.displayName,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
          });
        } catch (err) {
          logger.error("Error selecting Microsoft Teams team: ");
          logger.error(err);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Failed to select Microsoft Teams team"),
          );
        }
      },
    );

    // Microsoft Teams webhook endpoint for interactive messages
    router.post(
      "/microsoft-teams/webhook",
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug("Microsoft Teams Webhook Request: ");
        logger.debug(req.body);

        try {
          const authResult: MicrosoftTeamsRequest =
            await MicrosoftTeamsAuthAction.isAuthorized({
              req: req,
            });

          logger.debug("Microsoft Teams Auth Result: ");
          logger.debug(authResult);

          if (authResult.isAuthorized === false) {
            return Response.sendTextResponse(req, res, "");
          }

          // Handle different types of Teams activities
          const activity: JSONObject = req.body as JSONObject;
          const activityType: string = activity["type"] as string;

          if (activityType === "message") {
            // Handle bot mentions or direct messages
            return MicrosoftTeamsAPI.handleMessageActivity(
              req,
              res,
              authResult,
              activity,
            );
          } else if (activityType === "invoke") {
            // Handle adaptive card actions
            return MicrosoftTeamsAPI.handleInvokeActivity(
              req,
              res,
              authResult,
              activity,
            );
          }

          return Response.sendTextResponse(req, res, "");
        } catch (error) {
          logger.error("Error processing Teams webhook:");
          logger.error(error);
          return Response.sendTextResponse(req, res, "");
        }
      },
    );

    // Connector configuration endpoint
    router.get(
      "/microsoft-teams/connector-config",
      (_req: ExpressRequest, res: ExpressResponse) => {
        // This endpoint provides configuration UI for Teams connectors
        const html: string = `
<!DOCTYPE html>
<html>
<head>
    <title>OneUptime Teams Connector</title>
    <script src="https://statics.teams.cdn.office.net/sdk/v1.11.0/js/MicrosoftTeams.min.js"></script>
</head>
<body>
    <h1>OneUptime Teams Connector Setup</h1>
    <p>Configure OneUptime notifications for your team.</p>
    <button onclick="saveConfiguration()">Save Configuration</button>

    <script>
        microsoftTeams.initialize();

        function saveConfiguration() {
            microsoftTeams.settings.setSettings({
                entityId: "oneuptime-connector",
                contentUrl: "https://oneuptime.com",
                suggestedDisplayName: "OneUptime Notifications"
            });
            microsoftTeams.settings.setValidityState(true);
        }

        microsoftTeams.settings.registerOnSaveHandler((saveEvent) => {
            // Handle save configuration
            saveEvent.notifySuccess();
        });
    </script>
</body>
</html>`;

        res.setHeader("Content-Type", "text/html");
        return res.send(html);
      },
    );

    return router;
  }

  private static async handleMessageActivity(
    _req: ExpressRequest,
    res: ExpressResponse,
    authResult: MicrosoftTeamsRequest,
    activity: JSONObject,
  ): Promise<void> {
    // Handle direct messages to bot or @mentions
    const messageText: string = (activity["text"] as string) || "";
    const from: JSONObject = activity["from"] as JSONObject;

    if (messageText.toLowerCase().includes("help")) {
      // Send help message
      const helpMessage: any = {
        _type: "WorkspacePayloadText",
        text: "Hello! I'm the OneUptime bot. I can help you:\n\n• Get notifications about incidents\n• Acknowledge alerts\n• View system status\n\nType 'status' to see current system status.",
      };

      await MicrosoftTeamsUtil.sendDirectMessageToUser({
        authToken: authResult.authToken,
        workspaceUserId: from["id"] as string,
        messageBlocks: [helpMessage],
      });
    }

    Response.sendTextResponse(_req, res, "");
  }

  private static async handleInvokeActivity(
    req: ExpressRequest,
    res: ExpressResponse,
    authResult: MicrosoftTeamsRequest,
    _activity: JSONObject,
  ): Promise<void> {
    // Handle adaptive card button clicks
    // const value: JSONObject = activity["value"] as JSONObject;
    // const actionType: string = value["action"] as string;

    for (const action of authResult.actions || []) {
      if (!action.actionType) {
        continue;
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
        MicrosoftTeamsScheduledMaintenanceActions.isScheduledMaintenanceAction({
          actionType: action.actionType,
        })
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
    }

    Response.sendTextResponse(req, res, "");
  }
}

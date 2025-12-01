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
import Exception from "../../Types/Exception/Exception";
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
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  MicrosoftTeamsTeam,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
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
import archiver, { Archiver } from "archiver";
import LocalFile from "../Utils/LocalFile";
import path from "path";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default class MicrosoftTeamsAPI {
  private static getTeamsAppManifest(): JSONObject {
    if (!MicrosoftTeamsAppClientId) {
      throw new BadDataException("Microsoft Teams App Client ID is not set");
    }

    const manifest: JSONObject = {
      $schema:
        "https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json",
      manifestVersion: "1.23",
      version: AppVersion.toLowerCase().includes("unknown")
        ? "1.5.0"
        : AppVersion,
      id: MicrosoftTeamsAppClientId,
      developer: {
        name: "HackerBay Inc",
        websiteUrl: "https://oneuptime.com",
        privacyUrl: "https://oneuptime.com/legal/privacy",
        termsOfUseUrl: "https://oneuptime.com/legal/terms",
      },
      publisherDocsUrl:
        "https://oneuptime.com/docs/workspace-connections/microsoft-teams",
      name: {
        short: "OneUptime",
        full: "OneUptime - Complete Observability Platform",
      },
      description: {
        short: "Complete open-source monitoring and observability platform. ",
        full: `<p>OneUptime is a comprehensive solution for monitoring and managing your online services. Whether you need to check the availability of your website, dashboard, API, or any other online resource, OneUptime can alert your team when downtime happens and keep your customers informed with a status page. OneUptime also helps you handle incidents, set up on-call rotations, run tests, secure your services, analyze logs, track performance, and debug errors.</p>

<p>In order to use the app, you need to have an active account with <a href="https://oneuptime.com" target="_blank">OneUptime</a>. Please send an email to <a href="mailto:support@oneuptime.com">support@oneuptime.com</a> if you need more details.</p>

<p><strong>Create a new OneUptime Account:</strong> If you wish to sign up for a new account, you can do so by visiting <a href="https://oneuptime.com" target="_blank">OneUptime Sign Up</a>.</p>

<p><strong>Help and Support:</strong> You can reach out to help and support via <a href="https://oneuptime.com/support" target="_blank">Support Page</a> or contact <a href="mailto:support@oneuptime.com">support@oneuptime.com</a>.</p>
`,
      },
      // Default to size-specific names; route will adjust if fallbacks are used
      icons: {
        outline: "outline.png",
        color: "color.png",
      },
      accentColor: "#000000",
      bots: [
        {
          botId: MicrosoftTeamsAppClientId,
          needsChannelSelector: false,
          isNotificationOnly: false,
          // Include groupChat to align with latest schema capabilities
          scopes: ["team", "personal", "groupChat"],
          supportsFiles: false,
          supportsCalling: false,
          supportsVideo: false,
          // Provide basic command lists to improve client compatibility (esp. mobile)
          commandLists: [
            {
              scopes: ["team", "groupChat", "personal"],
              commands: [
                {
                  title: "help",
                  description: "Show instructions for interacting with the OneUptime bot.",
                },
                {
                  title: "create incident",
                  description: "Launch the adaptive card to declare a new incident in OneUptime.",
                },
                {
                  title: "create maintenance",
                  description:
                    "Open the workflow to schedule maintenance directly from Teams.",
                },
                {
                  title: "show active incidents",
                  description:
                    "List all ongoing incidents with severity and state context.",
                },
                {
                  title: "show scheduled maintenance",
                  description:
                    "Display upcoming scheduled maintenance events for the workspace.",
                },
                {
                  title: "show ongoing maintenance",
                  description:
                    "Surface maintenance windows that are currently in progress.",
                },
                {
                  title: "show active alerts",
                  description:
                    "Provide a summary of alerts that still require attention.",
                },
              ],
            },
          ],
        },
      ],
      permissions: ["identity", "messageTeamMembers"],
      authorization: {
        permissions: {
          resourceSpecific: [
            {
              type: "Application",
              name: "ChannelMessage.Send.Group",
            },
            {
              type: "Application",
              name: "ChannelMessage.Read.Group",
            },
            {
              type: "Application",
              name: "Channel.Create.Group",
            },
          ],
        },
      },
      validDomains: [Host],
      webApplicationInfo: {
        id: MicrosoftTeamsAppClientId,
        resource: HomeClientUrl.toString(),
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
          // Validate GUID format – Teams requires GUID for id / botId
          const guidRegex: RegExp =
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
          if (!guidRegex.test(MicrosoftTeamsAppClientId || "")) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Microsoft Teams App Client ID must be a valid GUID. Update the environment variable.",
              ),
            );
          }

          // Decide icon files and names included in the package
          let iconColorName: string = "icon-color.png";
          let iconOutlineName: string = "icon-outline.png";

          // Set response headers for zip download
          res.setHeader("Content-Type", "application/zip");
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="oneuptime-teams-app.zip"',
          );

          // Create archive
          const archive: Archiver = archiver("zip", {
            zlib: { level: 9 }, // Sets the compression level
          });

          // Handle archive errors
          archive.on("error", (err: Error) => {
            logger.error("Archive error: " + err);
            throw err;
          });

          // Pipe archive data to the response
          archive.pipe(res);

          const colorPath: string = path.join(
            __dirname,
            "../Images/MicrosoftTeams/color.png",
          );
          const outlinePath: string = path.join(
            __dirname,
            "../Images/MicrosoftTeams/outline.png",
          );

          let colorIconBuffer: Buffer | null = null;
          let outlineIconBuffer: Buffer | null = null;

          if (
            (await LocalFile.doesFileExist(colorPath)) &&
            (await LocalFile.doesFileExist(outlinePath))
          ) {
            colorIconBuffer = await LocalFile.readAsBuffer(colorPath);
            outlineIconBuffer = await LocalFile.readAsBuffer(outlinePath);
            iconColorName = "color.png";
            iconOutlineName = "outline.png";
          } else {
            throw new BadDataException(
              "Microsoft Teams icons not found. Expected either pre-sized icon-color-192x192.png and icon-outline-32x32.png in Common/Server/Images/MicrosoftTeams, or fallback color.png and outline.png.",
            );
          }

          // Build manifest now that icon names are known
          const manifest: JSONObject = MicrosoftTeamsAPI.getTeamsAppManifest();
          (manifest["icons"] as JSONObject)["color"] = iconColorName;
          (manifest["icons"] as JSONObject)["outline"] = iconOutlineName;

          // Add manifest.json to zip
          archive.append(JSON.stringify(manifest, null, 2), {
            name: "manifest.json",
          });

          // Add icons to zip under the selected names
          archive.append(colorIconBuffer, { name: iconColorName });
          archive.append(outlineIconBuffer, { name: iconOutlineName });

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

    /*
     * Microsoft Teams OAuth callback endpoint for project integration
     * New (preferred) static redirect URI that uses state param to carry projectId and userId
     * State format: <projectId>:<userId>
     */
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
            await API.post<JSONObject>({
              url: URL.fromString(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
              ),
              data: tokenRequestBody,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            });

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
            | HTTPResponse<JSONObject> = await API.get<JSONObject>({
            url: URL.fromString("https://graph.microsoft.com/v1.0/me"),
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (userProfileResponse instanceof HTTPErrorResponse) {
            logger.error("Error getting user profile:");
            logger.error(userProfileResponse);
            throw userProfileResponse;
          }

          const userProfile: JSONObject = userProfileResponse.data;
          logger.debug("User Profile: ");
          logger.debug(userProfile);

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
            },
          });

          // Check if admin consent is already granted
          const existingProjectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: new ObjectID(projectId),
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          if (
            existingProjectAuth &&
            (existingProjectAuth.miscData as any)?.adminConsentGranted
          ) {
            // Admin consent already granted, refresh teams
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: new ObjectID(projectId),
            });

            return Response.redirect(req, res, teamsIntegrationPageUrl);
          }
          // Need admin consent
          return Response.redirect(
            req,
            res,
            teamsIntegrationPageUrl.addQueryParam("needAdminConsent", "true"),
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
          const availableTeams: Record<string, MicrosoftTeamsTeam> =
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: projectId,
            });
          const matchedTeam: MicrosoftTeamsTeam | undefined = Object.values(
            availableTeams,
          ).find((t: MicrosoftTeamsTeam) => {
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
          const tokenParts: Array<string> = accessToken.split(".");
          if (tokenParts.length !== 3) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid JWT token"),
            );
          }
          const payload: JSONObject = JSON.parse(
            Buffer.from(tokenParts[1]!, "base64").toString("utf-8"),
          );
          const tenantId: string = payload["tid"] as string;

          if (!tenantId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Tenant ID not found in token"),
            );
          }

          /*
           * Persist project auth now that team is selected.
           * IMPORTANT: Do NOT overwrite project-level auth token (admin-consent app token)
           * with the user delegated token. Preserve existing project auth token if present.
           */
          const existingProjectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          const projectAuthTokenToPersist: string =
            existingProjectAuth?.authToken || "";

          // Merge miscData while updating team selection details
          const mergedProjectMiscData: MicrosoftTeamsMiscData = {
            ...(existingProjectAuth?.miscData as any),
            tenantId: tenantId,
            teamId: teamId,
            teamName: matchedTeam.name,
            botId: MicrosoftTeamsAppClientId || "",
          };

          await WorkspaceProjectAuthTokenService.refreshAuthToken({
            projectId: projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: projectAuthTokenToPersist,
            workspaceProjectId: tenantId, // Use tenant ID as the workspace project identifier
            miscData: mergedProjectMiscData,
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
              teamName: matchedTeam.name,
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

    /*
     * Admin consent - start flow (tenant-wide admin consent)
     * Uses state in the same format as OAuth: <projectId>:<userId>
     */
    router.get(
      "/microsoft-teams/admin-consent",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          if (!MicrosoftTeamsAppClientId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Microsoft Teams App Client ID is not set"),
            );
          }

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

          const stateParts: Array<string> = stateParam.split(":");
          if (stateParts.length !== 2 || !stateParts[0] || !stateParts[1]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid state param"),
            );
          }

          const projectId: string = stateParts[0]!;
          // Try to use tenant from existing project auth, otherwise default to "organizations"
          let tenantForConsent: string = "organizations";
          try {
            const existingAuth: WorkspaceProjectAuthToken | null =
              await WorkspaceProjectAuthTokenService.getProjectAuth({
                projectId: new ObjectID(projectId),
                workspaceType: WorkspaceType.MicrosoftTeams,
              });
            const existingTenant: string | undefined =
              existingAuth?.workspaceProjectId;
            if (existingTenant) {
              tenantForConsent = existingTenant;
            }
          } catch {
            // ignore and fall back to default
          }

          const redirectUri: URL = URL.fromString(
            `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`,
          );

          const adminConsentUrl: string = `https://login.microsoftonline.com/${encodeURIComponent(
            tenantForConsent,
          )}/v2.0/adminconsent?client_id=${encodeURIComponent(
            MicrosoftTeamsAppClientId,
          )}&scope=${encodeURIComponent(
            "https://graph.microsoft.com/.default",
          )}&redirect_uri=${encodeURIComponent(redirectUri.toString())}&state=${encodeURIComponent(
            stateParam,
          )}`;

          return Response.redirect(req, res, URL.fromString(adminConsentUrl));
        } catch (error) {
          logger.error("Error starting Teams admin consent: ");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              "Failed to start Microsoft Teams admin consent",
            ),
          );
        }
      },
    );

    /*
     * Admin consent - callback handler
     * Receives: state=<projectId>:<userId>, tenant=<tenantId>, admin_consent=True | error params
     */
    router.get(
      "/microsoft-teams/admin-consent/callback",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const error: string | undefined = req.query["error"]?.toString();
          const errorDescription: string | undefined =
            req.query["error_description"]?.toString();
          const stateParam: string | undefined = req.query["state"]?.toString();
          const tenantId: string | undefined = req.query["tenant"]?.toString();

          if (!stateParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException(
                "Invalid request - state param not present",
              ),
            );
          }

          const stateParts: Array<string> = stateParam.split(":");
          if (stateParts.length !== 2 || !stateParts[0] || !stateParts[1]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid state param"),
            );
          }

          const projectId: string = stateParts[0]!;

          const teamsIntegrationPageUrl: URL = URL.fromString(
            DashboardClientUrl.toString() +
              `/${projectId.toString()}/settings/microsoft-teams-integration`,
          );

          if (error) {
            return Response.redirect(
              req,
              res,
              teamsIntegrationPageUrl.addQueryParam(
                "error",
                `${error}${errorDescription ? ": " + errorDescription : ""}`,
              ),
            );
          }

          if (!tenantId) {
            return Response.redirect(
              req,
              res,
              teamsIntegrationPageUrl.addQueryParam(
                "error",
                "Missing tenant information from admin consent callback",
              ),
            );
          }

          if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
            return Response.redirect(
              req,
              res,
              teamsIntegrationPageUrl.addQueryParam(
                "error",
                "Microsoft Teams App credentials are not configured",
              ),
            );
          }

          // Fetch any existing project auth to merge
          const existingAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: new ObjectID(projectId),
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          // Acquire an application token for the specific tenant using client credentials
          const tokenResp: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.post<JSONObject>({
              url: URL.fromString(
                `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
              ),
              data: {
                client_id: MicrosoftTeamsAppClientId,
                client_secret: MicrosoftTeamsAppClientSecret,
                grant_type: "client_credentials",
                scope: "https://graph.microsoft.com/.default",
              },
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });

          if (tokenResp instanceof HTTPErrorResponse) {
            logger.error("Error getting app token after admin consent:");
            logger.error(tokenResp);
            return Response.redirect(
              req,
              res,
              teamsIntegrationPageUrl.addQueryParam(
                "error",
                "Failed to get Graph app token after admin consent",
              ),
            );
          }

          const tokenData: JSONObject = tokenResp.data;
          const appAccessToken: string =
            (tokenData["access_token"] as string) || "";
          const expiresInSec: number = Number(tokenData["expires_in"] || 0);
          const expiresAtIso: string = new Date(
            Date.now() + Math.max(0, (expiresInSec - 60) * 1000),
          ).toISOString();

          logger.debug("App Access Token acquired via admin consent: ");
          logger.debug(tokenData);

          // Get available teams from user auth token
          const userId: string = stateParts[1]!;
          const userAuth: WorkspaceUserAuthToken | null =
            await WorkspaceUserAuthTokenService.getUserAuth({
              projectId: new ObjectID(projectId),
              userId: new ObjectID(userId),
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          let availableTeams: Record<string, MicrosoftTeamsTeam> = {};
          if (userAuth?.miscData) {
            availableTeams = (userAuth.miscData as any).availableTeams || {};
          }

          // If no teams from user auth, try to get them using app token
          if (Object.keys(availableTeams).length === 0) {
            try {
              const teamsResponse:
                | HTTPErrorResponse
                | HTTPResponse<JSONObject> = await API.get<JSONObject>({
                url: URL.fromString(
                  "https://graph.microsoft.com/v1.0/teams?$select=id,displayName",
                ),
                headers: {
                  Authorization: `Bearer ${appAccessToken}`,
                },
              });

              if (teamsResponse instanceof HTTPErrorResponse) {
                logger.error("Failed to get teams:");
                logger.error(teamsResponse);
                return Response.redirect(
                  req,
                  res,
                  teamsIntegrationPageUrl.addQueryParam(
                    "error",
                    "Failed to retrieve teams from Microsoft Graph API after admin consent",
                  ),
                );
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
                    "No teams available in your Microsoft 365 tenant. Please create a team first.",
                  ),
                );
              }

              availableTeams = teams.reduce(
                (acc: Record<string, MicrosoftTeamsTeam>, t: JSONObject) => {
                  const team: MicrosoftTeamsTeam = {
                    id: t["id"] as string,
                    name: (t["displayName"] as string) || "Unnamed Team",
                  };
                  acc[team.name] = team;
                  return acc;
                },
                {} as Record<string, MicrosoftTeamsTeam>,
              );
            } catch (error) {
              logger.error("Error getting teams:");
              logger.error(error);
              return Response.redirect(
                req,
                res,
                teamsIntegrationPageUrl.addQueryParam(
                  "error",
                  "Failed to retrieve teams from Microsoft Graph API",
                ),
              );
            }
          }

          // Merge and persist project auth with tenantId, app token, and available teams
          const mergedMiscData: MicrosoftTeamsMiscData = {
            ...(existingAuth?.miscData as any),
            tenantId: tenantId,
            appAccessToken: appAccessToken,
            appAccessTokenExpiresAt: expiresAtIso,
            adminConsentGranted: true,
            adminConsentGrantedAt: new Date().toISOString(),
            availableTeams: availableTeams,
            botId: MicrosoftTeamsAppClientId || "",
          };

          await WorkspaceProjectAuthTokenService.refreshAuthToken({
            projectId: new ObjectID(projectId),
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: appAccessToken,
            workspaceProjectId: tenantId, // Use tenant ID as the workspace project identifier
            miscData: mergedMiscData,
          });

          return Response.redirect(
            req,
            res,
            teamsIntegrationPageUrl
              .addQueryParam("adminConsent", "success")
              .addQueryParam("tenantId", tenantId),
          );
        } catch (err) {
          logger.error("Error in Microsoft Teams admin consent callback: ");
          logger.error(err);
          // Best-effort redirect to integration page with error
          try {
            const stateParam: string | undefined =
              req.query["state"]?.toString();
            const projectId: string | undefined = stateParam?.split(":")[0];
            if (projectId) {
              const teamsIntegrationPageUrl: URL = URL.fromString(
                DashboardClientUrl.toString() +
                  `/${projectId.toString()}/settings/microsoft-teams-integration`,
              );
              return Response.redirect(
                req,
                res,
                teamsIntegrationPageUrl.addQueryParam(
                  "error",
                  "Failed to finalize Microsoft Teams admin consent",
                ),
              );
            }
          } catch {
            // ignore
          }
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              "Failed to finalize Microsoft Teams admin consent",
            ),
          );
        }
      },
    );

    /*
     * Microsoft Bot Framework endpoint - this is what Teams calls for bot messages
     * Now uses the Bot Framework SDK's adapter.processActivity for proper protocol handling
     */
    router.post(
      "/microsoft-bot/messages",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          // Delegate to MicrosoftTeamsUtil which uses the Bot Framework SDK
          await MicrosoftTeamsUtil.processBotActivity(req, res);
        } catch (error) {
          logger.error("Error in Bot Framework endpoint: " + error);
          if (!res.headersSent) {
            Response.sendJsonObjectResponse(req, res, {
              error: "Internal server error",
            });
          }
        }
      },
    );

    // Microsoft Teams webhook endpoint for interactive messages (legacy)
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

    // Test endpoint to verify Bot Framework setup
    router.get(
      "/microsoft-bot/test",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!MicrosoftTeamsAppClientId) {
          return Response.sendJsonObjectResponse(req, res, {
            error: "Microsoft Teams App Client ID not configured",
          });
        }

        if (!MicrosoftTeamsAppClientSecret) {
          return Response.sendJsonObjectResponse(req, res, {
            error: "Microsoft Teams App Client Secret not configured",
          });
        }

        return Response.sendJsonObjectResponse(req, res, {
          status: "Bot Framework endpoint is configured",
          clientId: MicrosoftTeamsAppClientId,
          messagingEndpoint: `${AppApiClientUrl.toString()}/microsoft-bot/messages`,
        });
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

    // Get available teams for a project
    router.get(
      "/microsoft-teams/teams",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = databaseProps.tenantId!;

          // Use the refreshTeams method to get fresh teams data
          const availableTeams: Record<string, MicrosoftTeamsTeam> =
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: projectId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            teams: Object.values(availableTeams).map(
              (team: MicrosoftTeamsTeam) => {
                return {
                  id: team.id,
                  name: team.name,
                };
              },
            ),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Endpoint to refresh teams list
    router.post(
      "/microsoft-teams/refresh-teams",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = databaseProps.tenantId!;

          // Call MicrosoftTeamsUtil to refresh teams
          const availableTeams: Record<string, MicrosoftTeamsTeam> =
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: projectId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            teams: Object.values(availableTeams).map(
              (team: MicrosoftTeamsTeam) => {
                return {
                  id: team.id,
                  name: team.name,
                };
              },
            ),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
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
    /*
     * Handle adaptive card button clicks
     * const value: JSONObject = activity["value"] as JSONObject;
     * const actionType: string = value["action"] as string;
     */

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

import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadRequestException from "../../Types/Exception/BadRequestException";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
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
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
  MicrosoftTeamsTeam,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import archiver, { Archiver } from "archiver";
import LocalFile from "../Utils/LocalFile";
import path from "path";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../Types/Dictionary";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";

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
                  description:
                    "Show instructions for interacting with the OneUptime bot.",
                },
                {
                  title: "ask",
                  description:
                    "Ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
                },
                {
                  title: "create incident",
                  description:
                    "Launch the adaptive card to declare a new incident in OneUptime.",
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
            {
              type: "Application",
              name: "ChatMessage.Read.Chat",
            },
            {
              type: "Application",
              name: "ChatMember.Read.Chat",
            },
            /*
             * Lets OneUptime confirm, per team, that the installed OneUptime app
             * is the package built from THIS deployment before telling an admin
             * their app is missing. Without it the installed-apps read falls back
             * to "unknown" and the send is handed to Microsoft to reject.
             */
            {
              type: "Application",
              name: "TeamsAppInstallation.Read.Group",
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
            logger.error(
              "Archive error: " + err,
              getLogAttributesFromRequest(req as any),
            );
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
          logger.error(
            "Error creating Teams app manifest zip: " + error,
            getLogAttributesFromRequest(req as any),
          );
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

          /*
           * The token request body holds the app client secret and the
           * authorization code, and the response holds the user access and
           * refresh tokens -- neither is logged.
           */
          logger.debug(
            "Exchanging Microsoft Teams authorization code for an access token.",
            getLogAttributesFromRequest(req as any),
          );

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
            logger.error(
              "Error getting Teams token:",
              getLogAttributesFromRequest(req as any),
            );
            logger.error(
              tokenResponse,
              getLogAttributesFromRequest(req as any),
            );
            throw tokenResponse;
          }

          const tokenData: JSONObject = tokenResponse.data;
          logger.debug(
            "Microsoft Teams token exchange completed.",
            getLogAttributesFromRequest(req as any),
          );

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
            logger.error(
              "Error getting user profile:",
              getLogAttributesFromRequest(req as any),
            );
            logger.error(
              userProfileResponse,
              getLogAttributesFromRequest(req as any),
            );
            throw userProfileResponse;
          }

          const userProfile: JSONObject = userProfileResponse.data;
          logger.debug(
            "User Profile: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.debug(userProfile, getLogAttributesFromRequest(req as any));

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
          logger.error(
            "Error in static Microsoft Teams auth callback: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.error(err, getLogAttributesFromRequest(req as any));
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Failed to authenticate with Microsoft Teams"),
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
          logger.error(
            "Error starting Teams admin consent: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.error(error, getLogAttributesFromRequest(req as any));
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
            logger.error(
              "Error getting app token after admin consent:",
              getLogAttributesFromRequest(req as any),
            );
            logger.error(tokenResp, getLogAttributesFromRequest(req as any));
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

          // tokenData carries the app access token; only its expiry is logged.
          logger.debug(
            "Microsoft Graph app token acquired via admin consent. expiresAt: " +
              expiresAtIso,
            getLogAttributesFromRequest(req as any),
          );

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
                logger.error(
                  "Failed to get teams:",
                  getLogAttributesFromRequest(req as any),
                );
                logger.error(
                  teamsResponse,
                  getLogAttributesFromRequest(req as any),
                );
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
                  /*
                   * Keyed by id, not display name — Teams allows duplicate
                   * team names, and keying by name silently collapsed them so
                   * only the last one of each name was selectable.
                   */
                  acc[team.id] = team;
                  return acc;
                },
                {} as Record<string, MicrosoftTeamsTeam>,
              );
            } catch (error) {
              logger.error(
                "Error getting teams:",
                getLogAttributesFromRequest(req as any),
              );
              logger.error(error, getLogAttributesFromRequest(req as any));
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
          logger.error(
            "Error in Microsoft Teams admin consent callback: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.error(err, getLogAttributesFromRequest(req as any));
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
          logger.error(
            "Error in Bot Framework endpoint: " + error,
            getLogAttributesFromRequest(req as any),
          );
          if (!res.headersSent) {
            Response.sendJsonObjectResponse(req, res, {
              error: "Internal server error",
            });
          }
        }
      },
    );

    /*
     * Echoes this deployment's bot configuration.
     *
     * It reads local environment variables and nothing else — it does not call
     * Azure, so it cannot tell you the Azure Bot resource exists, that its
     * messaging endpoint points back here, that the Teams channel is enabled, or
     * that the installed Teams app package belongs to this deployment. It used
     * to answer "Bot Framework endpoint is configured", which admins reasonably
     * read as "the bot works" — and then spent days debugging a setup this
     * endpoint had already blessed. It now says what it checked and, more
     * importantly, what it did not.
     *
     * The one genuinely useful thing here is botId: it is the value that must
     * appear in the installed Teams app package, and comparing the two is what
     * settles the most common self-hosted failure.
     */
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
          status:
            "Local configuration is present. This does NOT confirm the integration works.",
          clientId: MicrosoftTeamsAppClientId,
          botId: MicrosoftTeamsAppClientId,
          messagingEndpoint: `${AppApiClientUrl.toString()}/microsoft-bot/messages`,
          verified: [
            "MICROSOFT_TEAMS_APP_CLIENT_ID is set",
            "MICROSOFT_TEAMS_APP_CLIENT_SECRET is set",
          ],
          notVerified: [
            "That an Azure Bot resource exists for this client id",
            "That the Azure Bot's messaging endpoint points at this deployment",
            "That the Azure Bot has the Microsoft Teams channel enabled",
            "That the client secret is valid and has not expired",
            "That the Teams app package installed in your teams was built from this deployment",
          ],
          nextStep: `Open the installed OneUptime app in Microsoft Teams and confirm its bot id is ${MicrosoftTeamsAppClientId}. If it is not, that package cannot receive messages from this deployment — download the manifest from Project Settings > Workspace > Microsoft Teams and upload that instead.`,
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

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          // Use the refreshTeams method to get fresh teams data
          const availableTeams: Record<string, MicrosoftTeamsTeam> =
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: projectId,
              ...(databaseProps.userId && { userId: databaseProps.userId }),
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

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          // Call MicrosoftTeamsUtil to refresh teams
          const availableTeams: Record<string, MicrosoftTeamsTeam> =
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: projectId,
              ...(databaseProps.userId && { userId: databaseProps.userId }),
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

    // List channels of a team (app-only Graph; Channel.ReadBasic.All).
    router.get(
      "/microsoft-teams/channels",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const teamId: string = (req.query["teamId"] as string) || "";

          if (!teamId) {
            throw new BadDataException("teamId is required");
          }

          const channels: Dictionary<WorkspaceChannel> =
            await MicrosoftTeamsUtil.getAllWorkspaceChannels({
              authToken: "", // Graph calls use the app token from miscData.
              projectId: projectId,
              teamId: teamId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            channels: Object.values(channels)
              .sort((a: WorkspaceChannel, b: WorkspaceChannel) => {
                return (a.name || "").localeCompare(b.name || "");
              })
              .map((channel: WorkspaceChannel) => {
                return {
                  id: channel.id,
                  name: channel.name,
                };
              }),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * Get chats (group / personal chats) the OneUptime app has been added to.
     * Chats cannot be listed via app-only Graph permissions, so this returns
     * the chats captured from bot installation events.
     */
    router.get(
      "/microsoft-teams/chats",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const availableChats: Record<string, MicrosoftTeamsChat> =
            await MicrosoftTeamsUtil.getChatsForProject({
              projectId: projectId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            chats: Object.values(availableChats)
              .sort((a: MicrosoftTeamsChat, b: MicrosoftTeamsChat) => {
                return a.name.localeCompare(b.name);
              })
              .map((chat: MicrosoftTeamsChat) => {
                return {
                  id: chat.id,
                  name: chat.name,
                  chatType: chat.chatType,
                  addedAt: chat.addedAt || null,
                };
              }),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    return router;
  }
}

import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import BadRequestException from "../../Types/Exception/BadRequestException";
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
  HomeHostname,
} from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import crypto from "crypto";
import ProjectService from "../Services/ProjectService";
import Project from "../../Models/DatabaseModels/Project";

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
          const stateData: JSONObject = JSON.parse(
            Buffer.from(stateParam, "base64").toString(),
          );
          projectIdStr = stateData["projectId"] as string;
          userIdStr = stateData["userId"] as string;

          if (!stateData?.["projectId"]) {
            throw new BadDataException("Invalid state data");
          }
        } catch {
          // Error is intentionally ignored
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Please try again."),
          );
        }

        const error: string | undefined = req.query["error"]?.toString();
        const adminConsent: string | undefined =
          req.query["admin_consent"]?.toString();
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
          logger.debug(
            `Admin consent granted for tenant ${tenantId} by user ${userIdStr}`,
          );

          // Update or create the project auth token with admin consent status
          try {
            const existingAuth: WorkspaceProjectAuthToken | null =
              await WorkspaceProjectAuthTokenService.findOneBy({
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

            const currentMiscData: JSONObject =
              (existingAuth?.miscData as JSONObject) || {};
            const updatedMiscData: JSONObject = {
              ...currentMiscData,
              tenantId: tenantId,
              adminConsentGranted: true,
              adminConsentGrantedAt: new Date().toISOString(),
              adminConsentGrantedBy: userIdStr,
              teamName: currentMiscData["teamName"] || "Microsoft Teams",
              teamId: currentMiscData["teamId"] || tenantId,
            };

            if (existingAuth) {
              // Update existing auth token
              await WorkspaceProjectAuthTokenService.updateOneById({
                id: existingAuth.id!,
                data: {
                  miscData: updatedMiscData as any,
                },
                props: {
                  isRoot: true,
                },
              });
            } else {
              // Create new project auth token with admin consent
              const newAuthToken: WorkspaceProjectAuthToken =
                new WorkspaceProjectAuthToken();
              newAuthToken.projectId = new ObjectID(projectIdStr);
              newAuthToken.workspaceType = WorkspaceType.MicrosoftTeams;
              newAuthToken.authToken = `admin-consent-${tenantId}-${Date.now()}`; // Placeholder token
              newAuthToken.workspaceProjectId = tenantId;
              newAuthToken.miscData = updatedMiscData as any;

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
          const stateData: JSONObject = JSON.parse(
            Buffer.from(stateParam, "base64").toString(),
          );
          projectIdStr = stateData["projectId"] as string;
          userIdStr = stateData["userId"] as string;
          authType = stateData["authType"] as string;

          if (!projectIdStr || !userIdStr || !authType) {
            throw new Error("Invalid state data");
          }
        } catch {
          // Error is intentionally ignored
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
        const tokenResp: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post(
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
          logger.error(tokenResp.jsonData);

          const errorMessage: string =
            "Error from Microsoft: " + tokenResp.message;

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(errorMessage),
          );
        }

        // Example response fields: access_token, id_token, refresh_token
        const accessToken: string | undefined = (
          tokenResp.jsonData as JSONObject
        )["access_token"] as string;

        const refreshToken: string | undefined = (
          tokenResp.jsonData as JSONObject
        )["refresh_token"] as string;

        const expiresIn: number | undefined = (
          tokenResp.jsonData as JSONObject
        )["expires_in"] as number; // seconds

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
            const tokenParts: string[] = idToken.split(".");
            if (tokenParts.length >= 2 && tokenParts[1]) {
              const payload: JSONObject = JSON.parse(
                Buffer.from(tokenParts[1], "base64").toString(),
              );

              // Extract tenant information from token claims
              if (payload["tid"]) {
                tenantId = payload["tid"] as string;
                teamId = payload["tid"] as string;
              }

              // Try to get tenant name from various claims
              if (payload["tenant_name"]) {
                tenantName = payload["tenant_name"] as string;
              } else if (payload["tenant_display_name"]) {
                tenantName = payload["tenant_display_name"] as string;
              } else if (
                payload["iss"] &&
                typeof payload["iss"] === "string" &&
                payload["iss"].includes("/")
              ) {
                // Extract tenant ID from issuer if available
                const issuerParts: string[] = (payload["iss"] as string).split(
                  "/",
                );
                const issuerTenantId: string = issuerParts[
                  issuerParts.length - 2
                ] as string;
                if (issuerTenantId && issuerTenantId !== "common") {
                  tenantId = issuerTenantId;
                  teamId = issuerTenantId;
                }
              }
            }
          } catch (error) {
            logger.error(
              "Error decoding ID token: " + (error as Error).message,
            );
            // Continue with default values
          }
        }

        // Attempt to fetch user's joined teams to auto-select the first team (improves UX so we don't
        // display 'Microsoft Teams on Microsoft Teams'). We only do this if we have not already
        // identified a specific team (currently teamId defaults to tenantId) and we have a valid access token
        // with the Team.ReadBasic.All scope.
        try {
          const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get(
              URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
              undefined,
              {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            );

          if (!(teamsResponse instanceof HTTPErrorResponse)) {
            const teamsJson: JSONObject = teamsResponse.data as JSONObject;
            const teamsArr: Array<JSONObject> =
              (teamsJson["value"] as Array<JSONObject>) || [];
            if (teamsArr.length > 0) {
              const firstTeam: JSONObject = teamsArr[0] as JSONObject;
              const firstTeamId: string | undefined = firstTeam["id"] as
                | string
                | undefined;
              const firstTeamName: string | undefined = firstTeam[
                "displayName"
              ] as string | undefined;
              // Only override if we have meaningful data.
              if (firstTeamId) {
                teamId = firstTeamId;
              }
              if (firstTeamName) {
                tenantName = firstTeamName;
              }
            }
          } else {
            logger.debug(
              "Could not auto-fetch Teams list to select default team. Proceeding with tenant defaults.",
            );
          }
        } catch (autoSelectErr) {
          logger.error(
            "Error auto-selecting first Microsoft Team: " +
              (autoSelectErr as Error).message,
          );
        }

        // Get the actual Microsoft Teams user ID from Microsoft Graph API
        let microsoftTeamsUserId: string = userIdStr; // fallback to OneUptime user ID
        try {
          const userInfoResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get(
              URL.fromString("https://graph.microsoft.com/v1.0/me"),
              undefined,
              {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            );

          if (!(userInfoResponse instanceof HTTPErrorResponse)) {
            const userInfo: JSONObject = userInfoResponse.data as JSONObject;
            const actualUserId: string = userInfo["id"] as string;
            if (actualUserId) {
              microsoftTeamsUserId = actualUserId;
              logger.debug(
                `Retrieved Microsoft Teams user ID: ${microsoftTeamsUserId} for OneUptime user: ${userIdStr}`,
              );
            }
          } else {
            logger.warn(
              `Could not retrieve Microsoft Teams user info for user ${userIdStr}. Using OneUptime user ID as fallback.`,
            );
            logger.warn(userInfoResponse.message);
          }
        } catch (userInfoError) {
          logger.error("Error fetching Microsoft Teams user info:");
          logger.error(userInfoError);
          logger.warn(
            `Using OneUptime user ID ${userIdStr} as fallback for Microsoft Teams user ID`,
          );
        }

        // Handle different auth types based on state parameter
        const tokenExpiryDate: string | undefined = expiresIn
          ? new Date(Date.now() + (expiresIn - 60) * 1000).toISOString() // subtract 60s buffer
          : undefined;

        if (authType === "project") {
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
            workspaceUserId: microsoftTeamsUserId,
            miscData: {
              userId: microsoftTeamsUserId,
              oneUptimeUserId: userIdStr,
              tenantId: tenantId,
              refreshToken: refreshToken || "",
              tokenExpiresAt: tokenExpiryDate || "",
            },
          });
        } else if (authType === "user") {
          // User-level authentication only
          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: new ObjectID(projectIdStr),
            userId: new ObjectID(userIdStr),
            workspaceType: WorkspaceType.MicrosoftTeams,
            authToken: accessToken,
            workspaceUserId: microsoftTeamsUserId,
            miscData: {
              userId: microsoftTeamsUserId,
              oneUptimeUserId: userIdStr,
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
          const userAuthToken: any =
            await WorkspaceUserAuthTokenService.findOneById({
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
          const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get(
              URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
              undefined,
              {
                Authorization: `Bearer ${userAuthToken.authToken}`,
                "Content-Type": "application/json",
              },
            );

          if (response instanceof HTTPErrorResponse) {
            logger.error("Error getting teams from Microsoft Graph:");
            logger.error(response);
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Failed to fetch teams from Microsoft Graph",
              ),
            );
          }

          const teamsData: JSONObject = response.data as JSONObject;
          const teams: Array<JSONObject> =
            (teamsData["value"] as Array<JSONObject>) || [];

          // Transform the teams data to match our interface
          const transformedTeams: Array<{
            id: string;
            displayName: string;
            description?: string | undefined;
          }> = teams.map((team: JSONObject) => {
            const description: string | undefined = team["description"] as
              | string
              | undefined;
            return {
              id: team["id"] as string,
              displayName: team["displayName"] as string,
              ...(description && { description }),
            };
          });
          // Auto-select the first team if the project auth token has no team set yet.
          try {
            if (transformedTeams.length > 0) {
              // Find corresponding project-level auth token to update miscData
              const projectAuth: WorkspaceProjectAuthToken | null =
                await WorkspaceProjectAuthTokenService.findOneBy({
                  query: {
                    projectId: userAuthToken.projectId!,
                    workspaceType: WorkspaceType.MicrosoftTeams,
                  },
                  select: {
                    _id: true,
                    miscData: true,
                  },
                  props: { isRoot: true },
                });

              if (projectAuth) {
                const miscData: JSONObject = (projectAuth.miscData ||
                  {}) as JSONObject;
                const existingTeamId: string | undefined = miscData[
                  "teamId"
                ] as string | undefined;
                if (!existingTeamId) {
                  const first: {
                    id: string;
                    displayName: string;
                    description?: string | undefined;
                  } = transformedTeams[0]!;
                  const updatedMisc: any = {
                    ...miscData,
                    teamId: first.id as string,
                    teamName: first.displayName as string,
                  };
                  await WorkspaceProjectAuthTokenService.updateOneById({
                    id: projectAuth.id!,
                    data: { miscData: updatedMisc },
                    props: { isRoot: true },
                  });
                }
              }
            }
          } catch (autoSelectErr) {
            logger.error("Failed to auto-select first Microsoft Teams team:");
            logger.error(autoSelectErr);
          }

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

    // Conversation reference status (channels & users) for diagnostics
    router.get(
      "/teams/conversation-status",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const authTokenId: string | undefined =
            req.query["authTokenId"]?.toString();
          const projectIdStr: string | undefined =
            req.query["projectId"]?.toString();
          if (!projectIdStr) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("projectId is required"),
            );
          }

          // Validate project auth context (lightweight security gate)
          const projectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.findOneBy({
              query: {
                projectId: new ObjectID(projectIdStr),
                workspaceType: WorkspaceType.MicrosoftTeams,
              },
              select: { _id: true, authToken: true, miscData: true },
              props: { isRoot: true },
            });

          if (!projectAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Microsoft Teams integration not installed for this project",
              ),
            );
          }

          // Optionally ensure provided authTokenId matches existing (defense-in-depth)
          if (authTokenId && authTokenId !== projectAuth.id?.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException(
                "authTokenId does not match project integration",
              ),
            );
          }

          // Reuse utility method
          // Dynamically import to avoid circular dependencies if any
          const { default: MicrosoftTeams } = await import(
            "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams"
          );
          const status: JSONObject =
            await MicrosoftTeams.getConversationReferenceStatus({
              authToken: projectAuth.authToken!,
            });
          return Response.sendJsonObjectResponse(req, res, status as any);
        } catch (err) {
          logger.error("Error in /teams/conversation-status endpoint:");
          logger.error(err);
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              "Failed to fetch conversation reference status",
            ),
          );
        }
      },
    );

    // Endpoint to generate and download Microsoft Teams app manifest package
    router.get(
      "/teams/manifest-package/:projectId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const projectIdStr: string = req.params["projectId"] as string;

          if (!projectIdStr) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          // Validate project exists
          const project: Project | null = await ProjectService.findOneById({
            id: new ObjectID(projectIdStr),
            select: {
              _id: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!project || !project.name) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project not found"),
            );
          }

          // Generate unique App ID for this project if not exists
          let appId: string = MicrosoftTeamsAppClientId || "";
          
          // Check if project already has Teams integration to get existing App ID
          const existingAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.findOneBy({
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

          // Use existing app ID if available, otherwise generate a new GUID
          if (existingAuth?.miscData && (existingAuth.miscData as any)?.appId) {
            appId = (existingAuth.miscData as any).appId as string;
          } else {
            // Generate a new GUID for the app
            appId = crypto.randomUUID();
            
            // Store the app ID in miscData for future use
            if (existingAuth) {
              const currentMiscData: JSONObject = (existingAuth.miscData as JSONObject) || {};
              await WorkspaceProjectAuthTokenService.updateOneById({
                id: existingAuth.id!,
                data: {
                  miscData: {
                    ...currentMiscData,
                    appId: appId,
                  } as any,
                },
                props: {
                  isRoot: true,
                },
              });
            }
          }

          // Create app manifest JSON
          const manifest: JSONObject = {
            $schema: "https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json",
            manifestVersion: "1.23",
            version: "1.0.0",
            id: appId,
            developer: {
              name: "OneUptime",
              websiteUrl: `https://${HomeHostname || "oneuptime.com"}`,
              privacyUrl: `https://${HomeHostname || "oneuptime.com"}/legal/privacy-policy`,
              termsOfUseUrl: `https://${HomeHostname || "oneuptime.com"}/legal/terms-and-conditions`,
            },
            name: {
              short: project.name.slice(0, 30),
              full: `${project.name} - OneUptime Integration`.slice(0, 100),
            },
            description: {
              short: `Monitor and manage ${project.name} infrastructure with OneUptime`.slice(0, 80),
              full: `Get real-time monitoring, incident management, and status page updates for ${project.name}. Receive notifications about outages, performance issues, and system health directly in Microsoft Teams.`.slice(0, 4000),
            },
            icons: {
              color: "icon-color.png",
              outline: "icon-outline.png",
            },
            accentColor: "#3B82F6",
            bots: [
              {
                botId: appId,
                scopes: ["personal", "team", "groupChat"],
                commandLists: [
                  {
                    scopes: ["personal"],
                    commands: [
                      {
                        title: "Get Status",
                        description: "Get current system status and health metrics",
                      },
                      {
                        title: "List Incidents",
                        description: "Show active and recent incidents",
                      },
                      {
                        title: "Subscribe",
                        description: "Subscribe to incident notifications",
                      },
                    ],
                  },
                  {
                    scopes: ["team", "groupChat"],
                    commands: [
                      {
                        title: "Status Report",
                        description: "Get system status report for the team",
                      },
                      {
                        title: "Recent Incidents",
                        description: "Show recent incidents and their status",
                      },
                    ],
                  },
                ],
              },
            ],
            permissions: ["identity"],
            validDomains: [
              HomeHostname || "oneuptime.com",
              AppApiClientUrl.hostname,
              DashboardClientUrl.hostname,
            ].filter(Boolean),
            webApplicationInfo: {
              id: appId,
              resource: `https://${AppApiClientUrl.hostname}`,
            },
          };

          // Set response headers for zip download
          const fileName: string = `oneuptime-teams-app-${project.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.zip`;
          res.setHeader("Content-Type", "application/zip");
          res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

          // Create zip archive
          const archive: archiver.Archiver = archiver("zip", {
            zlib: { level: 9 }, // Sets the compression level
          });

          // Handle archive errors
          archive.on("error", (err: Error) => {
            logger.error(err);
            if (!res.headersSent) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException("Failed to create manifest package"),
              );
            }
          });

          // Pipe archive data to response
          archive.pipe(res);

          // Add manifest.json to zip
          archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

          // Add pre-resized color icon (192x192)
          const colorIconPath: string = path.join(
            __dirname,
            "../Images/Teams/icon-color-192x192.png"
          );
          
          if (fs.existsSync(colorIconPath)) {
            archive.file(colorIconPath, { name: "icon-color.png" });
          } else {
            throw new BadDataException(`Pre-resized color icon not found at ${colorIconPath}`);
          }

          // Add pre-resized outline icon (32x32)
          const outlineIconPath: string = path.join(
            __dirname,
            "../Images/Teams/icon-outline-32x32.png"
          );
          
          if (fs.existsSync(outlineIconPath)) {
            archive.file(outlineIconPath, { name: "icon-outline.png" });
          } else {
            throw new BadDataException(`Pre-resized outline icon not found at ${outlineIconPath}`);
          }

          // Finalize the archive
          await archive.finalize();

        } catch (error) {
          logger.error(error);
          
          if (!res.headersSent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Failed to generate manifest package"),
            );
          }
        }
      },
    );

    return router;
  }
}

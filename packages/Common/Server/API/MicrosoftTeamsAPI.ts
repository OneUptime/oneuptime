import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import {
  AppApiClientUrl,
  AppVersion,
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
import MicrosoftTeamsUtil, {
  MicrosoftTeamsChatNameRefreshResult,
} from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import archiver, { Archiver } from "archiver";
import LocalFile from "../Utils/LocalFile";
import path from "path";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../Types/Dictionary";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import WorkspaceNotificationRuleService from "../Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import WorkspaceOAuthCallbackAccess from "./WorkspaceOAuthCallbackAccess";
import ConnectCallback, {
  ConnectCallbackFinish,
  ConnectCallbackRefusal,
} from "./ConnectCallback";
import ConnectCallbackUtil, {
  CONNECT_START_PAGE_QUERY_PARAM,
  ConnectCallbackError,
  ConnectProvider,
} from "../../Types/Workspace/ConnectCallback";

// Delegated scopes for "sign in with Microsoft Teams" — authorize and token requests must agree.
const MICROSOFT_TEAMS_USER_SIGN_IN_SCOPES: string =
  "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/ChannelMessage.Send";

// The admin-consent sign-in only needs an ID token, to learn the tenant.
const ADMIN_CONSENT_SIGN_IN_SCOPES: string = "openid profile";

// Microsoft Entra tenant ids are GUIDs.
const ENTRA_TENANT_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default class MicrosoftTeamsAPI {
  /*
   * What someone who may not connect the project to Microsoft Teams is told,
   * when admin consent starts and again when Microsoft sends the browser back.
   */
  public static readonly CONNECT_PERMISSION_MESSAGE: string =
    "You do not have permission to connect this project to Microsoft Teams.";

  private static getTeamsAppManifest(): JSONObject {
    if (!MicrosoftTeamsAppClientId) {
      throw new BadDataException("Microsoft Teams App Client ID is not set");
    }

    const manifest: JSONObject = {
      $schema:
        "https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json",
      manifestVersion: "1.23",
      /*
       * Teams only takes an uploaded package as an update when its version is
       * higher than the installed one. Release images carry APP_VERSION; a
       * build without it uses this fallback, so bump it whenever the manifest
       * changes (1.6.0: ChatSettings.Read.Chat added).
       */
      version: AppVersion.toLowerCase().includes("unknown")
        ? "1.6.0"
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
             * Lets OneUptime read a group chat's name. Teams does not put it on
             * bot activities, so without this group chats are listed by their
             * members' names.
             */
            {
              type: "Application",
              name: "ChatSettings.Read.Chat",
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

  // The chat list shape the Chats card reads, sorted by name.
  private static serializeChats(
    chats: Record<string, MicrosoftTeamsChat>,
  ): Array<JSONObject> {
    return Object.values(chats)
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
      });
  }

  private static getUserSignInRedirectUri(): string {
    return `${AppApiClientUrl.toString()}/microsoft-teams/auth`;
  }

  private static getAdminConsentRedirectUri(): string {
    return `${AppApiClientUrl.toString()}/microsoft-teams/admin-consent/callback`;
  }

  /*
   * The Microsoft Teams app this server connects with. A connection cannot be
   * finished without its client secret, so a server missing either is refused
   * as one that is not set up.
   */
  private static getAppCredentials(): {
    clientId: string;
    clientSecret: string;
  } {
    if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.NotConfigured,
        "MICROSOFT_TEAMS_APP_CLIENT_ID or MICROSOFT_TEAMS_APP_CLIENT_SECRET is not set.",
      );
    }

    return {
      clientId: MicrosoftTeamsAppClientId,
      clientSecret: MicrosoftTeamsAppClientSecret,
    };
  }

  /*
   * A request to Microsoft that did not answer with what was asked for: told
   * to the page as "could not finish", with what Microsoft said in the log
   * only.
   */
  private static notAnswered(
    what: string,
    response: HTTPErrorResponse,
  ): ConnectCallbackRefusal {
    return new ConnectCallbackRefusal(
      ConnectCallbackError.CouldNotFinish,
      `Microsoft answered ${what} with HTTP ${response.statusCode}: ${response.message}`,
    );
  }

  /*
   * Reads the tenant out of the ID token returned by the admin-consent
   * sign-in, and refuses it unless every claim that ties it to this flow
   * checks out.
   *
   * The token is not signature-checked, and does not need to be: it came
   * straight back from Microsoft's token endpoint over TLS, in exchange for a
   * code and this app's client secret, which OpenID Connect Core 3.1.3.7 lets
   * stand in for the signature. The claims are still checked — audience,
   * issuer, nonce and expiry — so a token minted for another app, another
   * tenant or another sign-in is never accepted.
   *
   * A sign-in to another tenant is refused as such, which the person can act
   * on; every other refusal is "could not finish", its reason logged.
   */
  public static getVerifiedTenantIdFromIdToken(data: {
    idToken: unknown;
    expectedTenantId: string;
    expectedNonce: string;
  }): string {
    if (typeof data.idToken !== "string") {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "Microsoft did not return an ID token for the admin consent sign-in.",
      );
    }

    const parts: Array<string> = data.idToken.split(".");

    if (parts.length !== 3 || !parts[1]) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "Microsoft returned a malformed ID token for the admin consent sign-in.",
      );
    }

    let claims: JSONObject;

    try {
      claims = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      ) as JSONObject;
    } catch {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "Microsoft returned a malformed ID token for the admin consent sign-in.",
      );
    }

    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "Microsoft returned a malformed ID token for the admin consent sign-in.",
      );
    }

    const tenantClaim: unknown = claims["tid"];

    if (
      typeof tenantClaim !== "string" ||
      !ENTRA_TENANT_ID_PATTERN.test(tenantClaim)
    ) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "The admin consent sign-in did not identify a Microsoft 365 tenant.",
      );
    }

    const tenantId: string = tenantClaim.toLowerCase();

    if (
      typeof claims["aud"] !== "string" ||
      claims["aud"].toLowerCase() !==
        (MicrosoftTeamsAppClientId || "").toLowerCase()
    ) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "The admin consent sign-in was issued for a different application.",
      );
    }

    if (
      typeof claims["iss"] !== "string" ||
      claims["iss"].toLowerCase() !==
        `https://login.microsoftonline.com/${tenantId}/v2.0`
    ) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "The admin consent sign-in was issued by an unexpected authority.",
      );
    }

    if (claims["nonce"] !== data.expectedNonce) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "The admin consent sign-in does not belong to this connection attempt.",
      );
    }

    const expiresAtSeconds: unknown = claims["exp"];

    if (
      typeof expiresAtSeconds !== "number" ||
      expiresAtSeconds * 1000 <= Date.now()
    ) {
      throw MicrosoftTeamsAPI.idTokenRefused(
        "The admin consent sign-in has expired.",
      );
    }

    if (tenantId !== data.expectedTenantId.toLowerCase()) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.TeamsOtherTenant,
        "The admin consent sign-in was made in a different Microsoft 365 tenant from the one that granted admin consent.",
      );
    }

    return tenantId;
  }

  private static idTokenRefused(reason: string): ConnectCallbackRefusal {
    return new ConnectCallbackRefusal(
      ConnectCallbackError.CouldNotFinish,
      reason,
    );
  }

  /*
   * Admin consent, leg 1: the consent screen has redirected back with the
   * tenant it says consented. That claim is only a query parameter, so it is
   * used for nothing but choosing where to send the admin to sign in. A new
   * single-use state pins the flow to that tenant, and the sign-in's ID token
   * must then prove it. The new state goes back to the page the first was
   * started from.
   */
  private static async continueAdminConsentWithSignIn(
    data: ConnectCallbackFinish,
  ): Promise<void> {
    const { req, res, record } = data;

    const tenantId: string = (req.query["tenant"]?.toString() || "")
      .trim()
      .toLowerCase();

    if (!ENTRA_TENANT_ID_PATTERN.test(tenantId)) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.CouldNotFinish,
        "The admin consent callback named no Microsoft 365 tenant.",
      );
    }

    if (req.query["admin_consent"]?.toString().toLowerCase() !== "true") {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.Cancelled,
        "Microsoft did not report admin consent as granted.",
      );
    }

    if (record.tenantId && record.tenantId.toLowerCase() !== tenantId) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.TeamsOtherTenant,
        `Admin consent came back for tenant ${tenantId}, but project ${record.projectId.toString()} is connected to tenant ${record.tenantId}.`,
      );
    }

    const { state, oidcNonce } = await WorkspaceOAuthState.create({
      req,
      res,
      flow: WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
      projectId: record.projectId,
      userId: record.userId,
      startPage: record.startPage,
      tenantId: tenantId,
      includeOidcNonce: true,
    });

    const signInUrl: string = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${encodeURIComponent(
      MicrosoftTeamsAppClientId || "",
    )}&response_type=code&redirect_uri=${encodeURIComponent(
      MicrosoftTeamsAPI.getAdminConsentRedirectUri(),
    )}&response_mode=query&scope=${encodeURIComponent(
      ADMIN_CONSENT_SIGN_IN_SCOPES,
    )}&state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(
      oidcNonce || "",
    )}`;

    return Response.redirect(req, res, URL.fromString(signInUrl));
  }

  /*
   * Admin consent, leg 2: trade the sign-in code for an ID token, take the
   * tenant from it, and only then fetch that tenant's Graph app token and
   * bind it to the project recorded in the state.
   */
  private static async completeAdminConsent(
    data: ConnectCallbackFinish,
  ): Promise<void> {
    const { req, record } = data;
    const credentials: { clientId: string; clientSecret: string } =
      MicrosoftTeamsAPI.getAppCredentials();

    const projectId: ObjectID = record.projectId;
    const userId: ObjectID = record.userId;

    const code: string | undefined = req.query["code"]?.toString();

    if (!code || !record.tenantId || !record.oidcNonce) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.CouldNotFinish,
        "Microsoft returned no sign-in for the admin consent.",
      );
    }

    // The request holds the client secret and the code; neither is logged.
    const signInTokenResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(
          `https://login.microsoftonline.com/${record.tenantId}/oauth2/v2.0/token`,
        ),
        data: {
          grant_type: "authorization_code",
          code: code,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          redirect_uri: MicrosoftTeamsAPI.getAdminConsentRedirectUri(),
          scope: ADMIN_CONSENT_SIGN_IN_SCOPES,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

    if (signInTokenResponse instanceof HTTPErrorResponse) {
      throw MicrosoftTeamsAPI.notAnswered(
        "the admin consent sign-in code exchange",
        signInTokenResponse,
      );
    }

    const tenantId: string = MicrosoftTeamsAPI.getVerifiedTenantIdFromIdToken(
      {
        idToken: signInTokenResponse.data["id_token"],
        expectedTenantId: record.tenantId,
        expectedNonce: record.oidcNonce,
      },
    );

    // Fetch any existing project auth to merge
    const existingAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    // Acquire an application token for the verified tenant using client credentials
    const tokenResp: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        ),
        data: {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

    if (tokenResp instanceof HTTPErrorResponse) {
      throw MicrosoftTeamsAPI.notAnswered(
        "the Graph app token request after admin consent",
        tokenResp,
      );
    }

    const tokenData: JSONObject = tokenResp.data;
    const appAccessToken: string = (tokenData["access_token"] as string) || "";
    const expiresInSec: number = Number(tokenData["expires_in"] || 0);
    const expiresAt: Date = new Date(
      Date.now() + Math.max(0, (expiresInSec - 60) * 1000),
    );

    // tokenData carries the app access token; only its expiry is logged.
    logger.debug(
      "Microsoft Graph app token acquired via admin consent. expiresAt: " +
        expiresAt.toISOString(),
      getLogAttributesFromRequest(req as any),
    );

    // Get available teams from user auth token
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.getUserAuth({
        projectId: projectId,
        userId: userId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    let availableTeams: Record<string, MicrosoftTeamsTeam> = {};
    if (userAuth?.miscData) {
      availableTeams = (userAuth.miscData as any).availableTeams || {};
    }

    // If no teams from user auth, try to get them using app token
    if (Object.keys(availableTeams).length === 0) {
      const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(
            "https://graph.microsoft.com/v1.0/teams?$select=id,displayName",
          ),
          headers: {
            Authorization: `Bearer ${appAccessToken}`,
          },
        });

      if (teamsResponse instanceof HTTPErrorResponse) {
        throw MicrosoftTeamsAPI.notAnswered(
          "the teams read after admin consent",
          teamsResponse,
        );
      }

      const teams: Array<JSONObject> =
        (teamsResponse.data["value"] as Array<JSONObject>) || [];

      if (teams.length === 0) {
        throw new ConnectCallbackRefusal(
          ConnectCallbackError.TeamsNoTeams,
          `Microsoft 365 tenant ${tenantId} has no teams.`,
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
    }

    /*
     * Merge and persist project auth with tenantId and available teams. The
     * app token goes in authToken / authTokenExpiresAt only: miscData is
     * readable by every project Viewer.
     */
    const mergedMiscData: MicrosoftTeamsMiscData = {
      ...(existingAuth?.miscData as any),
      tenantId: tenantId,
      adminConsentGranted: true,
      adminConsentGrantedAt: new Date().toISOString(),
      adminConsentGrantedBy: userId.toString(),
      availableTeams: availableTeams,
      botId: credentials.clientId,
    };

    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      authToken: appAccessToken,
      authTokenExpiresAt: expiresAt,
      workspaceProjectId: tenantId, // Use tenant ID as the workspace project identifier
      miscData: mergedMiscData,
    });

    data.backToPage({ adminConsent: "success", tenantId: tenantId });
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
     * Start "sign in with Microsoft Teams" for the calling user.
     *
     * Returns the Microsoft authorize URL for the dashboard to navigate to. The
     * `state` in it is an opaque single-use nonce (see WorkspaceOAuthState):
     * the callback below learns the project and user from the server-side
     * record behind it, never from the redirect.
     */
    router.get(
      "/microsoft-teams/sign-in-url",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          if (!MicrosoftTeamsAppClientId) {
            throw new BadDataException(
              "Microsoft Teams App Client ID is not set",
            );
          }

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn,
            projectId: projectId,
            userId: databaseProps.userId!,
            startPage: ConnectCallbackUtil.readStartPage(
              req.query[CONNECT_START_PAGE_QUERY_PARAM],
            ),
          });

          const authorizationUrl: string = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(
            MicrosoftTeamsAppClientId,
          )}&response_type=code&redirect_uri=${encodeURIComponent(
            MicrosoftTeamsAPI.getUserSignInRedirectUri(),
          )}&response_mode=query&scope=${encodeURIComponent(
            MICROSOFT_TEAMS_USER_SIGN_IN_SCOPES,
          )}&state=${encodeURIComponent(state)}`;

          return Response.sendJsonObjectResponse(req, res, {
            authorizationUrl: authorizationUrl,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * Microsoft Teams OAuth callback for "sign in with Microsoft Teams".
     * ConnectCallback.route spends the state, asks again, and answers every
     * way this can end on the Microsoft Teams page the sign-in started from -
     * with a code, never with what Microsoft or a failed read said.
     */
    router.get(
      "/microsoft-teams/auth",
      ConnectCallback.route({
        provider: ConnectProvider.MicrosoftTeams,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req,
            state: req.query["state"]?.toString(),
            flows: [WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn],
          });
        },
        // Whoever started the sign-in is still a member of the project.
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return WorkspaceOAuthCallbackAccess.assertStartedByIsMember({
            record: record,
          });
        },
        refusedAs: ConnectCallbackError.NotAMember,
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          const { req, record } = data;
          const credentials: { clientId: string; clientSecret: string } =
            MicrosoftTeamsAPI.getAppCredentials();

          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(req);

          if (providerError) {
            throw providerError;
          }

          const code: string | undefined = req.query["code"]?.toString();

          if (!code) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.CouldNotFinish,
              "Microsoft sent no authorization code back.",
            );
          }

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
              data: {
                grant_type: "authorization_code",
                code: code,
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                redirect_uri: MicrosoftTeamsAPI.getUserSignInRedirectUri(),
                scope: MICROSOFT_TEAMS_USER_SIGN_IN_SCOPES,
              },
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            });

          if (tokenResponse instanceof HTTPErrorResponse) {
            throw MicrosoftTeamsAPI.notAnswered(
              "the sign-in code exchange",
              tokenResponse,
            );
          }

          const accessToken: string | undefined =
            tokenResponse.data["access_token"]?.toString();

          if (!accessToken) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.CouldNotFinish,
              "Microsoft returned no access token for the sign-in.",
            );
          }

          // The person's Microsoft profile; identity material, so not logged.
          const userProfileResponse:
            | HTTPErrorResponse
            | HTTPResponse<JSONObject> = await API.get<JSONObject>({
            url: URL.fromString("https://graph.microsoft.com/v1.0/me"),
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (userProfileResponse instanceof HTTPErrorResponse) {
            throw MicrosoftTeamsAPI.notAnswered(
              "the profile read after sign-in",
              userProfileResponse,
            );
          }

          const userProfile: JSONObject = userProfileResponse.data;

          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: record.projectId,
            userId: record.userId,
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
              projectId: record.projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          if (
            existingProjectAuth &&
            (existingProjectAuth.miscData as any)?.adminConsentGranted
          ) {
            // Admin consent already granted, refresh teams
            await MicrosoftTeamsUtil.refreshTeams({
              projectId: record.projectId,
            });

            return data.backToPage();
          }

          // Need admin consent
          return data.backToPage({ needAdminConsent: "true" });
        },
      }),
    );

    /*
     * Admin consent - start flow (tenant-wide admin consent).
     *
     * Only a signed-in member who may manage the project's workspace
     * connections can start it, and it returns the Microsoft admin-consent URL
     * for the dashboard to navigate to. Its `state` is a single-use nonce
     * recorded against this user and project — see WorkspaceOAuthState.
     */
    router.get(
      "/microsoft-teams/admin-consent",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          CommonAPI.assertPermittedInProject({
            databaseProps: databaseProps,
            allowedPermissions:
              WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
            errorMessage: MicrosoftTeamsAPI.CONNECT_PERMISSION_MESSAGE,
          });

          if (!MicrosoftTeamsAppClientId) {
            throw new BadDataException(
              "Microsoft Teams App Client ID is not set",
            );
          }

          /*
           * A project already bound to a tenant re-consents for THAT tenant
           * only: the consent URL targets it, and the callback refuses any
           * other. Moving a project to a different tenant means disconnecting
           * it first.
           */
          const existingAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
            });

          const existingTenantId: string | undefined =
            existingAuth?.workspaceProjectId || undefined;

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
            projectId: projectId,
            userId: databaseProps.userId!,
            startPage: ConnectCallbackUtil.readStartPage(
              req.query[CONNECT_START_PAGE_QUERY_PARAM],
            ),
            tenantId: existingTenantId,
          });

          const authorizationUrl: string = `https://login.microsoftonline.com/${encodeURIComponent(
            existingTenantId || "organizations",
          )}/v2.0/adminconsent?client_id=${encodeURIComponent(
            MicrosoftTeamsAppClientId,
          )}&scope=${encodeURIComponent(
            "https://graph.microsoft.com/.default",
          )}&redirect_uri=${encodeURIComponent(
            MicrosoftTeamsAPI.getAdminConsentRedirectUri(),
          )}&state=${encodeURIComponent(state)}`;

          return Response.sendJsonObjectResponse(req, res, {
            authorizationUrl: authorizationUrl,
          });
        } catch (error) {
          logger.error(
            "Error starting Teams admin consent: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.error(error, getLogAttributesFromRequest(req as any));
          return Response.sendErrorResponse(req, res, error as Exception);
        }
      },
    );

    /*
     * Admin consent - callback handler. Microsoft redirects here twice:
     *
     *  1. After the admin-consent screen, with tenant=<tenantId> and
     *     admin_consent=True. Both are plain query parameters anyone can type,
     *     so nothing is stored on them. The flow continues to a sign-in against
     *     that tenant instead.
     *  2. After that sign-in, with an authorization code. Its ID token says
     *     which tenant the person completing the flow actually signed in to,
     *     and only a tenant proven that way is bound to the project.
     *
     * Which leg a request is comes from the server-side state record, not from
     * the shape of the query string. ConnectCallback.route answers every way
     * either leg can end on the Microsoft Teams page consent started from.
     */
    router.get(
      "/microsoft-teams/admin-consent/callback",
      ConnectCallback.route({
        provider: ConnectProvider.MicrosoftTeams,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req,
            state: req.query["state"]?.toString(),
            flows: [
              WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
              WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
            ],
          });
        },
        // Whoever started admin consent may still connect the project.
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(
            {
              record: record,
              errorMessage: MicrosoftTeamsAPI.CONNECT_PERMISSION_MESSAGE,
            },
          );
        },
        refusedAs: ConnectCallbackError.NoPermission,
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          MicrosoftTeamsAPI.getAppCredentials();

          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(data.req);

          if (providerError) {
            throw providerError;
          }

          if (
            data.record.flow === WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent
          ) {
            return await MicrosoftTeamsAPI.continueAdminConsentWithSignIn(
              data,
            );
          }

          return await MicrosoftTeamsAPI.completeAdminConsent(data);
        },
      }),
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
     * The same path, answering the browser.
     *
     * Azure Bot Service only ever POSTs here, so for a long time GET fell
     * through to the catch-all 404 in StartServer and answered
     * "Page not found - /api/microsoft-bot/messages". That is the single
     * cheapest thing an admin can do to check their messaging endpoint, and
     * OneUptime replied with the words for "this route does not exist" — so
     * admins concluded the route had been dropped from the build and went
     * looking for a regression, while the actual fault (Azure cannot reach
     * this deployment) sat untouched. The 404 was true of the method and false
     * of the endpoint, and nothing in the response said which.
     *
     * 405 is the honest answer, and it is honest in a way a human reads at a
     * glance: the route is here, the deployment is reachable from wherever the
     * request came from, and POST is what it wants. Everything else in the
     * body exists to redirect the next hour of debugging away from OneUptime's
     * routing table and towards the network path Azure has to traverse.
     */
    router.get(
      "/microsoft-bot/messages",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Allow", "POST");

        /*
         * Written straight onto the response rather than through
         * Response.sendJsonObjectResponse, whose ?output-type=csv branch
         * answers 200 regardless of the status code it was handed. The status
         * code is the entire point of this route — it is what distinguishes
         * "wrong method" from "no such route" — so no query parameter gets to
         * rewrite it.
         */
        res.status(405).json({
          status:
            "This is the OneUptime Microsoft Teams bot messaging endpoint. It exists, and it accepts POST only.",
          allow: ["POST"],
          messagingEndpoint: `${AppApiClientUrl.toString()}/microsoft-bot/messages`,
          /*
           * Stated as a fact about this response rather than as advice,
           * because it is the one thing the admin has actually proven by
           * getting here and it is easy to under-read.
           */
          whatThisProves:
            "You reached OneUptime. This endpoint is registered and this deployment served your request, so the messaging endpoint is not missing.",
          whatThisDoesNotProve:
            "That Azure Bot Service can reach this URL. Azure calls it from the public internet, and your browser or terminal may not be on the same path.",
          /*
           * A 404 on this path does NOT mean the request failed to arrive, and
           * saying so would repeat the mistake this endpoint exists to end.
           * OneUptime's own catch-all (StartServer's app.get("*")) answers an
           * unmatched GET with a 404 whose body is
           * {"message":"Page not found - <path>"} — 58 bytes for this path,
           * which is exactly the `404 58` an admin sees in their access log.
           * That 404 is proof the request arrived, not proof it did not. Only
           * the body separates it from a proxy's own 404, so point at the body.
           */
          ifYouGetA404InsteadOfThis:
            'Read the body, not just the status code. A body of {"message":"Page not found - /api/microsoft-bot/messages"} comes from OneUptime itself, which means the request DID arrive: either this deployment predates this 405 response (the path was POST-only, so a GET fell through to the generic not-found handler), or something in front of OneUptime rewrote the path and stripped the /api prefix before the app saw it. An HTML error page from nginx, your ingress or a load balancer means the opposite — the request never reached OneUptime.',
          /*
           * Ordered by what actually goes wrong on self-hosted deployments.
           * Outbound-works-inbound-fails leads because it is the state that
           * makes people doubt the route: alerts arrive in Teams, so the
           * integration looks live, and only the interactive half is dead.
           */
          ifTeamsSaysUnableToReachApp: [
            "Working outbound alerts prove nothing here. OneUptime posts cards by calling Microsoft, which needs no inbound access. Card buttons, bot commands and chat registration all travel the other way — Azure Bot Service POSTs to this URL — and that is the direction that is failing.",
            "Confirm this exact URL is set as the messaging endpoint on the Azure Bot resource, then check that it resolves publicly. A private DNS name or an internal-only ingress is the most common cause.",
            "Azure requires HTTPS with a publicly trusted certificate served with its full chain. A self-signed certificate, an internal CA, or a missing intermediate fails the TLS handshake before OneUptime ever sees the request, so nothing appears in your access log.",
            "Then look for the POST, not the 404, in your access log: `grep 'POST /api/microsoft-bot/messages' <access log>`. No POST lines at all means Azure never got through, and the fault is the network path rather than OneUptime.",
          ],
          nextStep: `GET ${AppApiClientUrl.toString()}/microsoft-bot/test to see this deployment's bot id, and compare it with the bot id of the OneUptime app package installed in Microsoft Teams.`,
        });
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
            /*
             * Reachability is listed separately from the endpoint being
             * configured, because they fail separately and look identical from
             * in here. A correctly configured endpoint on a deployment Azure
             * cannot dial produces working outbound alerts and a completely
             * dead bot, which reads as a half-broken integration rather than a
             * network problem.
             */
            "That Azure Bot Service can actually reach this deployment over the public internet — outbound notifications work without it, so a working alert does not test this",
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

    // Send a test notification to one channel ("Send Test" in Project Settings).
    router.post(
      "/microsoft-teams/channels/test",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          /*
           * Posting into a channel is what a notification rule does, so the
           * test asks what adding a rule asks (TestSendAccess): a signed-in
           * member, on a credential that may make changes, on the plan rules
           * are sold on, who could create a rule - team blocks counted.
           * Anyone who could can already make OneUptime post here; a Viewer,
           * or a member whose team is blocked from creating rules, cannot.
           */
          const caller: TestSendCaller = await TestSendAccess.assertMaySendTest(
            {
              req: req,
              modelType: WorkspaceNotificationRule,
            },
          );

          const teamId: string =
            typeof req.body?.["teamId"] === "string"
              ? (req.body["teamId"] as string)
              : "";

          const channelId: string =
            typeof req.body?.["channelId"] === "string"
              ? (req.body["channelId"] as string)
              : "";

          // chatId is deliberately not forwarded: this route tests channels only.
          await WorkspaceNotificationRuleService.sendTestNotificationToDestination(
            {
              projectId: caller.projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
              testByUserId: caller.userId,
              teamId: teamId,
              channelId: channelId,
            },
          );

          return Response.sendEmptySuccessResponse(req, res);
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
            chats: MicrosoftTeamsAPI.serializeChats(availableChats),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * "Refresh Chats". Chats still cannot be listed, but the name of each
     * stored group chat can be re-read from Graph — which is what fixes a
     * group chat listed under its member names, and picks up renames.
     * Returns the same list as GET, plus which chats' names could not be read
     * (Microsoft refused, or failed) so the page can mark them and say why.
     *
     * Member access, like the list: it changes nothing but the stored display
     * names, and concurrent refreshes of a project share one run.
     */
    router.post(
      "/microsoft-teams/chats/refresh",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const refreshResult: MicrosoftTeamsChatNameRefreshResult =
            await MicrosoftTeamsUtil.refreshChatNamesForProject({
              projectId: projectId,
            });

          // Only chats that are still listed (one may be removed mid-refresh).
          const listed: (chatIds: Array<string>) => Array<string> = (
            chatIds: Array<string>,
          ): Array<string> => {
            return chatIds.filter((chatId: string) => {
              return Boolean(refreshResult.chats[chatId]);
            });
          };

          const permissionDeniedChatIds: Array<string> = listed(
            refreshResult.permissionDeniedChatIds,
          );
          const failedChatIds: Array<string> = listed(
            refreshResult.failedChatIds,
          );

          return Response.sendJsonObjectResponse(req, res, {
            chats: MicrosoftTeamsAPI.serializeChats(refreshResult.chats),
            chatNamePermissionDeniedChatIds: permissionDeniedChatIds,
            chatNamePermissionDeniedCount: permissionDeniedChatIds.length,
            chatNameFailedChatIds: failedChatIds,
            chatNameFailedCount: failedChatIds.length,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Send a test notification to one chat ("Send Test" in Project Settings).
    router.post(
      "/microsoft-teams/chats/test",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          /*
           * Posting into a chat is what a notification rule does, so the
           * test asks what adding a rule asks (TestSendAccess): a signed-in
           * member, on a credential that may make changes, on the plan rules
           * are sold on, who could create a rule - team blocks counted.
           * Anyone who could can already make OneUptime post here; a Viewer,
           * or a member whose team is blocked from creating rules, cannot.
           */
          const caller: TestSendCaller = await TestSendAccess.assertMaySendTest(
            {
              req: req,
              modelType: WorkspaceNotificationRule,
            },
          );

          const chatId: string =
            typeof req.body?.["chatId"] === "string"
              ? (req.body["chatId"] as string)
              : "";

          /*
           * Only the chat id is forwarded. The service checks it against the
           * chats this project captured, so a chat id from another tenant is
           * rejected before anything is sent.
           */
          await WorkspaceNotificationRuleService.sendTestNotificationToDestination(
            {
              projectId: caller.projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
              testByUserId: caller.userId,
              chatId: chatId,
            },
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    return router;
  }
}

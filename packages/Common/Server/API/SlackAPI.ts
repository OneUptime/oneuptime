import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SlackAuthorization from "../Middleware/SlackAuthorization";
import BadRequestException from "../../Types/Exception/BadRequestException";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  AppApiClientUrl,
  DashboardClientUrl,
  Host,
  HttpProtocol,
  SlackAppClientId,
  SlackAppClientSecret,
} from "../EnvironmentConfig";
import SlackAppManifest from "../Utils/Workspace/Slack/app-manifest.json";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import API from "../../Utils/API";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import SlackAuthAction, {
  SlackRequest,
} from "../Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../Utils/Workspace/Slack/Actions/Incident";
import SlackAlertActions from "../Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackIncidentEpisodeActions from "../Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackScheduledMaintenanceActions from "../Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import SlackMonitorActions from "../Utils/Workspace/Slack/Actions/Monitor";
import SlackOnCallDutyActions from "../Utils/Workspace/Slack/Actions/OnCallDutyPolicy";
import WorkspaceProjectAuthToken, {
  SlackChannelCache,
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import AIService, { AI_DISABLED_MESSAGE } from "../Services/AIService";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../Types/Dictionary";
import Exception from "../../Types/Exception/Exception";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import WorkspaceNoteReactionUtil from "../../Types/Workspace/WorkspaceNoteReaction";
import SlackReactionNoteActions, {
  SlackReactionData,
} from "../Utils/Workspace/Slack/Actions/ReactionNote";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceActionAuthorization from "../Utils/Workspace/WorkspaceActionAuthorization";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObservabilityAssistant from "../Utils/AI/Chat/ObservabilityAssistant";
import { AIChatCitation } from "../../Types/AI/AIChatTypes";
import WorkspaceNotificationRuleService from "../Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import OneUptimeDate from "../../Types/Date";

export default class SlackAPI {
  // Generous: the server-side channel fetch caches up to ~100k channels.
  public static readonly MAX_CHANNEL_CACHE_ENTRIES: number = 100000;

  // Slack caps channel names at 80 characters.
  private static readonly MAX_CHANNEL_NAME_LENGTH: number = 255;

  // Slack channel ids are short upper-case alphanumerics, e.g. C0123456789.
  private static readonly CHANNEL_ID_PATTERN: RegExp = /^[A-Za-z0-9]{1,64}$/;

  private static readonly RESERVED_CHANNEL_KEYS: Array<string> = [
    "__proto__",
    "constructor",
    "prototype",
  ];

  /*
   * Turns the channel-cache editor's `{ [channelName]: channelId }` map into
   * the stored cache shape, keyed by lower-cased name. Blank rows are dropped,
   * as the editor always did; anything that is not a name and a Slack channel
   * id is refused.
   */
  public static parseChannelCacheInput(input: unknown): SlackChannelCache {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BadDataException(
        "channels must be an object mapping Slack channel names to channel IDs.",
      );
    }

    const entries: Array<[string, unknown]> = Object.entries(input);

    if (entries.length > SlackAPI.MAX_CHANNEL_CACHE_ENTRIES) {
      throw new BadDataException(
        `A Slack channel list can hold at most ${SlackAPI.MAX_CHANNEL_CACHE_ENTRIES} channels.`,
      );
    }

    const lastUpdated: string = OneUptimeDate.toString(
      OneUptimeDate.getCurrentDate(),
    );

    const channelCache: SlackChannelCache = {};

    for (const [rawName, rawId] of entries) {
      if (typeof rawId !== "string") {
        throw new BadDataException(
          `The channel ID for "${rawName}" must be a string.`,
        );
      }

      const name: string = rawName.trim();
      const id: string = rawId.trim();

      if (!name || !id) {
        continue;
      }

      const key: string = name.toLowerCase();

      if (
        name.length > SlackAPI.MAX_CHANNEL_NAME_LENGTH ||
        SlackAPI.RESERVED_CHANNEL_KEYS.includes(key)
      ) {
        throw new BadDataException(`"${name}" is not a valid channel name.`);
      }

      if (!SlackAPI.CHANNEL_ID_PATTERN.test(id)) {
        throw new BadDataException(
          `"${id}" is not a valid Slack channel ID (for example C0123456789).`,
        );
      }

      channelCache[key] = {
        id: id,
        name: name,
        lastUpdated: lastUpdated,
      };
    }

    return channelCache;
  }

  private static getInstallRedirectUri(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): string {
    return `${AppApiClientUrl.toString()}/slack/auth/${data.projectId.toString()}/${data.userId.toString()}`;
  }

  private static getUserSignInRedirectUri(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): string {
    return `${SlackAPI.getInstallRedirectUri(data)}/user`;
  }

  /*
   * Spends the `state` Slack hands back and returns the project and user it
   * was issued for, or null when the callback must be refused.
   *
   * The ids in the redirect path are only there because Slack matches
   * redirect URIs by prefix; they are never used. They must still agree with
   * the state, so a hand-edited path is refused rather than quietly ignored.
   */
  private static async consumeStateForCallback(data: {
    req: ExpressRequest;
    flow: WorkspaceOAuthFlow;
  }): Promise<WorkspaceOAuthStateRecord | null> {
    let stateRecord: WorkspaceOAuthStateRecord | null = null;

    try {
      stateRecord = await WorkspaceOAuthState.consume({
        req: data.req,
        state: data.req.query["state"]?.toString(),
        flows: [data.flow],
      });
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(data.req as any));
      return null;
    }

    if (!stateRecord) {
      return null;
    }

    if (
      data.req.params["projectId"]?.toString() !==
        stateRecord.projectId.toString() ||
      data.req.params["userId"]?.toString() !== stateRecord.userId.toString()
    ) {
      logger.warn(
        "Slack OAuth callback refused: the redirect path does not match the project and user the state was issued for.",
        getLogAttributesFromRequest(data.req as any),
      );
      return null;
    }

    return stateRecord;
  }

  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.get(
      "/slack/app-manifest",
      (req: ExpressRequest, res: ExpressResponse) => {
        // return app manifest for slack app

        let ServerURL: string = new URL(HttpProtocol, Host).toString();

        //remove trailing slash if present.
        if (ServerURL.endsWith("/")) {
          ServerURL = ServerURL.slice(0, -1);
        }

        // replace SERVER_URL in the manifest with the actual server url.
        const manifestInString: string = JSON.stringify(
          SlackAppManifest,
        ).replace(/{{SERVER_URL}}/g, ServerURL.toString());

        // convert it back to json.
        const manifest: JSONObject = JSON.parse(manifestInString);

        return Response.sendJsonObjectResponse(req, res, manifest);
      },
    );

    /*
     * Start installing OneUptime into a Slack workspace for this project.
     *
     * Returns the Slack authorize URL for the dashboard to navigate to. The
     * redirect path still names the project and user (existing Slack app
     * configurations register /api/slack/auth as a prefix), but the callback
     * does not trust it: it trusts the single-use `state` recorded here, for
     * a signed-in member allowed to manage the project's workspace
     * connections. See WorkspaceOAuthState.
     */
    router.get(
      "/slack/install-url",
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
            errorMessage:
              "You do not have permission to connect this project to Slack.",
          });

          if (!SlackAppClientId) {
            throw new BadDataException("Slack App Client ID is not set");
          }

          const userId: ObjectID = databaseProps.userId!;

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.SlackInstall,
            projectId: projectId,
            userId: userId,
          });

          const scopes: JSONObject = (
            (SlackAppManifest as unknown as JSONObject)[
              "oauth_config"
            ] as JSONObject
          )["scopes"] as JSONObject;

          const authorizationUrl: string = `https://slack.com/oauth/v2/authorize?scope=${encodeURIComponent(
            ((scopes["bot"] as Array<string>) || []).join(","),
          )}&user_scope=${encodeURIComponent(
            ((scopes["user"] as Array<string>) || []).join(","),
          )}&client_id=${encodeURIComponent(
            SlackAppClientId,
          )}&redirect_uri=${encodeURIComponent(
            SlackAPI.getInstallRedirectUri({ projectId, userId }),
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
     * Start "sign in with Slack" for the calling user, in a project already
     * connected to a Slack workspace. Same single-use state as above.
     */
    router.get(
      "/slack/sign-in-url",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          if (!SlackAppClientId) {
            throw new BadDataException("Slack App Client ID is not set");
          }

          const userId: ObjectID = databaseProps.userId!;

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.SlackUserSignIn,
            projectId: projectId,
            userId: userId,
          });

          const authorizationUrl: string = `https://slack.com/openid/connect/authorize?response_type=code&scope=${encodeURIComponent(
            "openid profile email",
          )}&client_id=${encodeURIComponent(
            SlackAppClientId,
          )}&redirect_uri=${encodeURIComponent(
            SlackAPI.getUserSignInRedirectUri({ projectId, userId }),
          )}&state=${encodeURIComponent(state)}`;

          return Response.sendJsonObjectResponse(req, res, {
            authorizationUrl: authorizationUrl,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // this is project specific auth endpoint.
    router.get(
      "/slack/auth/:projectId/:userId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!SlackAppClientId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Slack App Client ID is not set"),
          );
        }

        if (!SlackAppClientSecret) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Slack App Client Secret is not set"),
          );
        }

        const stateRecord: WorkspaceOAuthStateRecord | null =
          await SlackAPI.consumeStateForCallback({
            req,
            flow: WorkspaceOAuthFlow.SlackInstall,
          });

        if (!stateRecord) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException(WorkspaceOAuthState.INVALID_STATE_MESSAGE),
          );
        }

        const projectId: string = stateRecord.projectId.toString();
        const userId: string = stateRecord.userId.toString();

        // if there's an error query param.
        const error: string | undefined = req.query["error"]?.toString();

        const slackIntegrationPageUrl: URL = URL.fromString(
          DashboardClientUrl.toString() +
            `/${projectId.toString()}/settings/slack-integration`,
        );

        if (error) {
          return Response.redirect(
            req,
            res,
            slackIntegrationPageUrl.addQueryParam("error", error),
          );
        }

        // slack returns the code on successful auth.
        const code: string | undefined = req.query["code"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request"),
          );
        }

        // get access token from slack api.

        const requestBody: JSONObject = {
          code: code,
          client_id: SlackAppClientId,
          client_secret: SlackAppClientSecret,
          redirect_uri: SlackAPI.getInstallRedirectUri({
            projectId: stateRecord.projectId,
            userId: stateRecord.userId,
          }),
        };

        /*
         * Neither the token request nor the token response is logged: the
         * request carries the app client secret and the authorization code,
         * and the response carries the bot and user access tokens.
         */
        logger.debug(
          "Exchanging Slack authorization code for an access token.",
          getLogAttributesFromRequest(req as any),
        );

        // send the request to slack api to get the access token https://slack.com/api/oauth.v2.access

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post({
            url: URL.fromString("https://slack.com/api/oauth.v2.access"),
            data: requestBody,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const responseBody: JSONObject = response.data;

        logger.debug(
          "Slack token exchange completed. ok: " + String(responseBody["ok"]),
          getLogAttributesFromRequest(req as any),
        );

        let slackTeamId: string | undefined = undefined;
        let slackBotAccessToken: string | undefined = undefined;
        let slackUserId: string | undefined = undefined;
        let slackTeamName: string | undefined = undefined;
        let botUserId: string | undefined = undefined;
        let slackUserAccessToken: string | undefined = undefined;

        /*
         * ReponseBody is in this format.
         *   {
         *     "ok": true,
         *     "access_token": "sample-token",
         *     "token_type": "bot",
         *     "scope": "commands,incoming-webhook",
         *     "bot_user_id": "U0KRQLJ9H",
         *     "app_id": "A0KRD7HC3",
         *     "team": {
         *         "name": "Slack Pickleball Team",
         *         "id": "T9TK3CUKW"
         *     },
         *     "enterprise": {
         *         "name": "slack-pickleball",
         *         "id": "E12345678"
         *     },
         *     "authed_user": {
         *         "id": "U1234",
         *         "scope": "chat:write",
         *         "access_token": "sample-token",
         *         "token_type": "user"
         *     }
         * }
         */

        if (responseBody["ok"] !== true) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request"),
          );
        }

        if (
          responseBody["team"] &&
          (responseBody["team"] as JSONObject)["id"]
        ) {
          slackTeamId = (responseBody["team"] as JSONObject)["id"]?.toString();
        }

        if (responseBody["access_token"]) {
          slackBotAccessToken = responseBody["access_token"]?.toString();
        }

        if (
          responseBody["authed_user"] &&
          (responseBody["authed_user"] as JSONObject)["id"]
        ) {
          slackUserId = (responseBody["authed_user"] as JSONObject)[
            "id"
          ]?.toString();
        }

        if (
          responseBody["authed_user"] &&
          (responseBody["authed_user"] as JSONObject)["access_token"]
        ) {
          slackUserAccessToken = (responseBody["authed_user"] as JSONObject)[
            "access_token"
          ]?.toString();
        }

        if (
          responseBody["team"] &&
          (responseBody["team"] as JSONObject)["name"]
        ) {
          slackTeamName = (responseBody["team"] as JSONObject)[
            "name"
          ]?.toString();
        }

        if (responseBody["bot_user_id"]) {
          botUserId = responseBody["bot_user_id"]?.toString();
        }

        await WorkspaceProjectAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          workspaceType: WorkspaceType.Slack,
          authToken: slackBotAccessToken || "",
          workspaceProjectId: slackTeamId || "",
          miscData: {
            teamId: slackTeamId || "",
            teamName: slackTeamName || "",
            botUserId: botUserId || "",
          },
        });

        await WorkspaceUserAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          userId: new ObjectID(userId),
          workspaceType: WorkspaceType.Slack,
          authToken: slackUserAccessToken || "",
          workspaceUserId: slackUserId || "",
          miscData: {
            userId: slackUserId || "",
          },
        });

        // return back to dashboard after successful auth.
        Response.redirect(req, res, slackIntegrationPageUrl);
      },
    );

    // this is user specific auth endpoint to sign in to slack.
    router.get(
      "/slack/auth/:projectId/:userId/user",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!SlackAppClientId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Slack App Client ID is not set"),
          );
        }

        if (!SlackAppClientSecret) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Slack App Client Secret is not set"),
          );
        }

        const stateRecord: WorkspaceOAuthStateRecord | null =
          await SlackAPI.consumeStateForCallback({
            req,
            flow: WorkspaceOAuthFlow.SlackUserSignIn,
          });

        if (!stateRecord) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException(WorkspaceOAuthState.INVALID_STATE_MESSAGE),
          );
        }

        const projectId: string = stateRecord.projectId.toString();
        const userId: string = stateRecord.userId.toString();

        // if there's an error query param.
        const error: string | undefined = req.query["error"]?.toString();

        const slackIntegrationPageUrl: URL = URL.fromString(
          DashboardClientUrl.toString() +
            `/${projectId.toString()}/settings/slack-integration`,
        );

        if (error) {
          return Response.redirect(
            req,
            res,
            slackIntegrationPageUrl.addQueryParam("error", error),
          );
        }

        // slack returns the code on successful auth.
        const code: string | undefined = req.query["code"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request"),
          );
        }

        // get access token from slack api.

        const requestBody: JSONObject = {
          code: code,
          client_id: SlackAppClientId,
          client_secret: SlackAppClientSecret,
          redirect_uri: SlackAPI.getUserSignInRedirectUri({
            projectId: stateRecord.projectId,
            userId: stateRecord.userId,
          }),
        };

        // Same as above: the body holds the client secret and the auth code.
        logger.debug(
          "Exchanging Slack authorization code for a user token.",
          getLogAttributesFromRequest(req as any),
        );

        // send the request to slack api to get the access token https://slack.com/api/oauth.v2.access

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post({
            url: URL.fromString("https://slack.com/api/openid.connect.token"),
            data: requestBody,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const responseBody: JSONObject = response.data;

        logger.debug(
          "Slack user token exchange completed. ok: " +
            String(responseBody["ok"]),
          getLogAttributesFromRequest(req as any),
        );

        if (
          responseBody["id_token"] &&
          typeof responseBody["id_token"] === "string" &&
          responseBody["id_token"].split(".").length > 0
        ) {
          const idToken: string = responseBody["id_token"];
          const decodedIdToken: JSONObject = JSON.parse(
            Buffer.from(
              (idToken.split(".")?.[1] as string) || "",
              "base64",
            ).toString("utf8"),
          );
          // The decoded ID token is identity material; only the fact is logged.
          logger.debug(
            "Decoded Slack ID token.",
            getLogAttributesFromRequest(req as any),
          );
          responseBody["id_token"] = decodedIdToken;
        }

        const idToken: JSONObject | undefined = responseBody[
          "id_token"
        ] as JSONObject;

        /*
         * Example of Response Body
         * {
         *   "iss": "https://slack.com",
         *   "sub": "U123ABC456",
         *   "aud": "25259531569.1115258246291",
         *   "exp": 1626874955,
         *   "iat": 1626874655,
         *   "auth_time": 1626874655,
         *   "nonce": "abcd",
         *   "at_hash": "abc...123",
         *   "https://slack.com/team_id": "T0123ABC456",
         *   "https://slack.com/user_id": "U123ABC456",
         *   "email": "alice@example.com",
         *   "email_verified": true,
         *   "date_email_verified": 1622128723,
         *   "locale": "en-US",
         *   "name": "Alice",
         *   "given_name": "",
         *   "family_name": "",
         *   "https://slack.com/team_image_230": "https://secure.gravatar.com/avatar/bc.png",
         *   "https://slack.com/team_image_default": true
         * }
         */

        /*
         * check if the team id matches the project id.
         * get project auth.
         */

        const projectAuth: WorkspaceProjectAuthToken | null =
          await WorkspaceProjectAuthTokenService.findOneBy({
            query: {
              projectId: new ObjectID(projectId),
              workspaceType: WorkspaceType.Slack,
            },
            select: {
              workspaceProjectId: true,
              miscData: true,
            },
            props: {
              isRoot: true,
            },
          });

        // cehck if the workspace project id is same as the team id.
        if (projectAuth) {
          logger.debug(
            "Project Auth: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.debug(
            projectAuth.workspaceProjectId,
            getLogAttributesFromRequest(req as any),
          );
          logger.debug(
            "Response Team ID: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.debug(
            idToken["https://slack.com/team_id"],
            getLogAttributesFromRequest(req as any),
          );
          logger.debug(
            "Response User ID: ",
            getLogAttributesFromRequest(req as any),
          );
          logger.debug(
            idToken["https://slack.com/user_id"],
            getLogAttributesFromRequest(req as any),
          );

          if (
            projectAuth.workspaceProjectId?.toString() !==
            idToken["https://slack.com/team_id"]?.toString()
          ) {
            const teamName: string | undefined = (
              projectAuth.miscData as SlackMiscData
            )?.teamName;

            // send error response.
            return Response.redirect(
              req,
              res,
              slackIntegrationPageUrl.addQueryParam(
                "error",
                "Looks like you are trying to sign in to a different slack workspace. Please try again and sign in to the workspace " +
                  teamName,
              ),
            );
          }
        } else {
          // send error response.
          return Response.redirect(
            req,
            res,
            slackIntegrationPageUrl.addQueryParam(
              "error",
              "Looks like this OneUptime project is not connected to any slack workspace. Please try again and sign in to the workspace",
            ),
          );
        }

        const authToken: string | undefined =
          responseBody["access_token"]?.toString();
        const slackUserId: string | undefined =
          idToken["https://slack.com/user_id"]?.toString();

        if (!slackUserId) {
          return Response.redirect(
            req,
            res,
            slackIntegrationPageUrl.addQueryParam(
              "error",
              "Unfortunately, we were unable to get your slack user id. Please try again.",
            ),
          );
        }

        await WorkspaceUserAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          userId: new ObjectID(userId),
          workspaceType: WorkspaceType.Slack,
          authToken: authToken || "",
          workspaceUserId: slackUserId || "",
          miscData: {
            userId: slackUserId || "",
          },
        });

        // return back to dashboard after successful auth.
        Response.redirect(req, res, slackIntegrationPageUrl);
      },
    );

    router.post(
      "/slack/interactive",
      SlackAuthorization.isAuthorizedSlackRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug(
          "Slack Interactive Request: ",
          getLogAttributesFromRequest(req as any),
        );

        const authResult: SlackRequest = await SlackAuthAction.isAuthorized({
          req: req,
        });

        logger.debug(
          "Slack Interactive Auth Result: ",
          getLogAttributesFromRequest(req as any),
        );

        // if slack uninstall app then,
        if (authResult.payloadType === "app_uninstall") {
          logger.debug(
            "Slack App Uninstall Request: ",
            getLogAttributesFromRequest(req as any),
          );

          // remove the project auth and user auth.

          // delete all user auth tokens for this project.
          await WorkspaceUserAuthTokenService.deleteBy({
            query: {
              projectId: authResult.projectId,
              workspaceType: WorkspaceType.Slack,
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
              workspaceType: WorkspaceType.Slack,
            },
            limit: 1,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          logger.debug(
            "Slack App Uninstall Request: Deleted all auth tokens.",
            getLogAttributesFromRequest(req as any),
          );
          // return empty response.

          return Response.sendTextResponse(req, res, "");
        }

        if (authResult.isAuthorized === false) {
          // return empty response if not authorized. Do nothing in this case.
          return Response.sendTextResponse(req, res, "");
        }

        for (const action of authResult.actions || []) {
          if (!action.actionType) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid request"),
            );
          }

          if (
            SlackIncidentActions.isIncidentAction({
              actionType: action.actionType,
            })
          ) {
            return SlackIncidentActions.handleIncidentAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            SlackOnCallDutyActions.isOnCallDutyAction({
              actionType: action.actionType,
            })
          ) {
            return SlackOnCallDutyActions.handleOnCallDutyAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            SlackAlertActions.isAlertAction({
              actionType: action.actionType,
            })
          ) {
            return SlackAlertActions.handleAlertAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            SlackAlertEpisodeActions.isAlertEpisodeAction({
              actionType: action.actionType,
            })
          ) {
            return SlackAlertEpisodeActions.handleAlertEpisodeAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            SlackIncidentEpisodeActions.isIncidentEpisodeAction({
              actionType: action.actionType,
            })
          ) {
            return SlackIncidentEpisodeActions.handleIncidentEpisodeAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            SlackMonitorActions.isMonitorAction({
              actionType: action.actionType,
            })
          ) {
            return SlackMonitorActions.handleMonitorAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          if (
            SlackScheduledMaintenanceActions.isScheduledMaintenanceAction({
              actionType: action.actionType,
            })
          ) {
            return SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
              {
                slackRequest: authResult,
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
          new BadRequestException("Invalid request"),
        );
      },
    );

    // List all Slack channels for the current project (live fetch, refreshes the cache).
    router.get(
      "/slack/channels",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          const projectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: projectId,
              workspaceType: WorkspaceType.Slack,
            });

          if (!projectAuth || !projectAuth.authToken) {
            throw new BadRequestException(
              "Slack is not connected for this project. Please connect Slack first.",
            );
          }

          const channels: Dictionary<WorkspaceChannel> =
            await SlackUtil.getAllWorkspaceChannels({
              authToken: projectAuth.authToken,
              projectId: projectId,
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
      "/slack/channels/test",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          /*
           * Posting into a channel is a side effect, so membership alone is
           * not enough. Anyone who could create a workspace notification rule
           * - including its team block list, which the CRUD create enforces
           * too - can already make OneUptime post to this channel; a Viewer,
           * or a member whose team is blocked from creating rules, cannot.
           * getUserMiddleware admits unauthenticated requests as "public", so
           * the membership check is mandatory as well.
           */
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          CommonAPI.assertCanCreateTable({
            modelType: WorkspaceNotificationRule,
            props: databaseProps,
            errorMessage:
              "You do not have permission to send test notifications in this project.",
          });

          const channelId: string =
            typeof req.body?.["channelId"] === "string"
              ? (req.body["channelId"] as string)
              : "";

          // Slack has no chats or teams: only the channel id is forwarded.
          await WorkspaceNotificationRuleService.sendTestNotificationToDestination(
            {
              projectId: projectId,
              workspaceType: WorkspaceType.Slack,
              testByUserId: databaseProps.userId!,
              channelId: channelId,
            },
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Fetch and cache all Slack channels for current tenant's project
    router.get(
      "/slack/get-all-channels",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const props: DatabaseCommonInteractionProps =
          await CommonAPI.getDatabaseCommonInteractionProps(req);

        /*
         * getUserMiddleware lets unauthenticated requests through as
         * "public" — require an authenticated project member before
         * disclosing channel names.
         */
        try {
          CommonAPI.assertAuthenticatedProjectMember(props);
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }

        if (!props.tenantId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("ProjectId (tenant) not found in request"),
          );
        }

        // Get Slack project auth
        const projectAuth: WorkspaceProjectAuthToken | null =
          await WorkspaceProjectAuthTokenService.getProjectAuth({
            projectId: props.tenantId,
            workspaceType: WorkspaceType.Slack,
          });

        if (!projectAuth || !projectAuth.authToken) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException(
              "Slack is not connected for this project. Please connect Slack first.",
            ),
          );
        }

        // Fetch all channels (also updates cache under miscData.channelCache)

        let updatedProjectAuth: WorkspaceProjectAuthToken | null = projectAuth;

        if (!(projectAuth.miscData as SlackMiscData)?.channelCache) {
          await SlackUtil.getAllWorkspaceChannels({
            authToken: projectAuth.authToken,
            projectId: props.tenantId,
          });

          // Re-fetch to return the latest cached object
          updatedProjectAuth =
            await WorkspaceProjectAuthTokenService.getProjectAuth({
              projectId: props.tenantId,
              workspaceType: WorkspaceType.Slack,
            });
        }

        const channelCache: {
          [channelName: string]: {
            id: string;
            name: string;
            lastUpdated: string;
          };
        } =
          ((updatedProjectAuth?.miscData as SlackMiscData | undefined) || {})
            ?.channelCache || {};

        return Response.sendJsonObjectResponse(req, res, channelCache as any);
      },
    );

    /*
     * Save the dashboard's edited Slack channel list for the current project.
     *
     * The channel cache lives in WorkspaceProjectAuthToken.miscData, which is
     * not writable through the CRUD API because other connections keep
     * server-trusted values there. This route writes the channel cache and
     * nothing else, for a member allowed to manage the project's workspace
     * connections. The body is `{ channels: { [channelName]: channelId } }`.
     */
    router.put(
      "/slack/channel-cache",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions:
              WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
            errorMessage:
              "You do not have permission to edit this project's Slack channels.",
          });

          const channelCache: SlackChannelCache =
            SlackAPI.parseChannelCacheInput(
              (req.body as JSONObject | undefined)?.["channels"],
            );

          await WorkspaceProjectAuthTokenService.replaceSlackChannelCache({
            projectId: projectId,
            channelCache: channelCache,
          });

          return Response.sendJsonObjectResponse(req, res, {
            channelCache: channelCache as unknown as JSONObject,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Slack Events API endpoint for handling events like emoji reactions
    router.post(
      "/slack/events",
      SlackAuthorization.isAuthorizedSlackRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug(
          "Slack Events API Request received",
          getLogAttributesFromRequest(req as any),
        );

        const payload: JSONObject = req.body;

        // Handle URL verification challenge from Slack
        if (payload["type"] === "url_verification") {
          logger.debug(
            "Slack URL verification challenge received",
            getLogAttributesFromRequest(req as any),
          );
          return Response.sendJsonObjectResponse(req, res, {
            challenge: payload["challenge"],
          });
        }

        // Handle event callbacks
        if (payload["type"] === "event_callback") {
          const event: JSONObject = payload["event"] as JSONObject;

          if (!event) {
            logger.debug(
              "No event found in payload",
              getLogAttributesFromRequest(req as any),
            );
            return Response.sendTextResponse(req, res, "ok");
          }

          /*
           * "Pin to channel" is Slack's own pin, not an emoji, and it means the
           * same thing as a 📌 reaction: save the message as a private note.
           * Both share one note per message, so doing both saves it once.
           */
          if (event["type"] === "pin_added") {
            Response.sendTextResponse(req, res, "ok");

            const pinData: SlackReactionData | null =
              SlackReactionNoteActions.getReactionDataFromPinEvent({
                payload: payload,
                event: event,
              });

            if (!pinData) {
              logger.debug(
                "Pinned item is not a message. Skipping.",
                getLogAttributesFromRequest(req as any),
              );
              return;
            }

            try {
              await SlackReactionNoteActions.handleEmojiReaction(pinData);
            } catch (err) {
              logger.error(
                "Error handling pinned message:",
                getLogAttributesFromRequest(req as any),
              );
              logger.error(err, getLogAttributesFromRequest(req as any));
            }

            return;
          }

          // Handle reaction_added events
          if (event["type"] === "reaction_added") {
            logger.debug(
              "Reaction added event received",
              getLogAttributesFromRequest(req as any),
            );

            /*
             * Respond immediately to Slack to prevent retry
             * Process the event asynchronously
             */
            Response.sendTextResponse(req, res, "ok");

            const reactionData: {
              teamId: string;
              reaction: string;
              userId: string;
              channelId: string;
              messageTs: string;
            } = {
              teamId: payload["team_id"] as string,
              reaction: event["reaction"] as string,
              userId: event["user"] as string,
              channelId: (event["item"] as JSONObject)?.["channel"] as string,
              messageTs: (event["item"] as JSONObject)?.["ts"] as string,
            };

            // OPTIMIZATION: Quick check if this is a supported emoji before any DB queries
            if (
              !WorkspaceNoteReactionUtil.isNoteReaction(reactionData.reaction)
            ) {
              logger.debug(
                `Emoji "${reactionData.reaction}" is not supported. Skipping.`,
                getLogAttributesFromRequest(req as any),
              );
              return;
            }

            /*
             * Works out which incident, alert, scheduled maintenance or episode
             * the channel belongs to, then saves the message as a note there.
             */
            try {
              await SlackReactionNoteActions.handleEmojiReaction(reactionData);
            } catch (err) {
              logger.error(
                "Error handling emoji reaction:",
                getLogAttributesFromRequest(req as any),
              );
              logger.error(err, getLogAttributesFromRequest(req as any));
            }

            return;
          }

          /*
           * Handle "AI Ops" conversational events. There are three classes:
           *  - app_mention: the bot was @mentioned in a channel/group.
           *  - message with channel_type "im": a direct message to the bot.
           *  - message with channel_type "channel" | "group" | "mpim": a plain
           *    thread reply. We only treat these as follow-ups when they land
           *    in a thread the bot already participates in (see below), so we
           *    never answer arbitrary channel chatter.
           */
          const eventChannelType: string | undefined = event["channel_type"] as
            | string
            | undefined;
          const isAppMention: boolean = event["type"] === "app_mention";
          const isDirectMessage: boolean =
            event["type"] === "message" && eventChannelType === "im";
          const isChannelThreadMessage: boolean =
            event["type"] === "message" &&
            (eventChannelType === "channel" ||
              eventChannelType === "group" ||
              eventChannelType === "mpim");

          if (isAppMention || isDirectMessage || isChannelThreadMessage) {
            /*
             * Slack retries an event if it does not receive a 200 within 3
             * seconds. Acknowledge immediately and do the (slow) assistant
             * work detached. Also skip entirely on Slack retries so we never
             * answer the same question twice.
             */
            const isSlackRetry: boolean = Boolean(
              req.headers["x-slack-retry-num"],
            );

            Response.sendTextResponse(req, res, "ok");

            if (isSlackRetry) {
              logger.debug(
                "Skipping Slack AI Ops event because it is a Slack retry.",
                getLogAttributesFromRequest(req as any),
              );
              return;
            }

            /*
             * CRITICAL loop-guard: never react to messages produced by a bot
             * (including ourselves) or to message subtypes such as
             * message_changed / bot_message. Without this the bot would answer
             * its own replies forever.
             */
            const eventSubtype: string | undefined = event["subtype"] as
              | string
              | undefined;
            const eventBotId: string | undefined = event["bot_id"] as
              | string
              | undefined;
            const eventUserId: string | undefined = event["user"] as
              | string
              | undefined;

            if (eventBotId || eventSubtype) {
              logger.debug(
                "Skipping Slack AI Ops event from a bot or with a subtype.",
                getLogAttributesFromRequest(req as any),
              );
              return;
            }

            const eventText: string = (event["text"] as string) || "";

            /*
             * A mention fires BOTH app_mention and message.* events. Let the
             * app_mention path own mentions and skip mention-bearing plain
             * message.* events to avoid answering twice.
             */
            const botMentionRegex: RegExp = /<@[A-Z0-9]+>/;
            if (isChannelThreadMessage && botMentionRegex.test(eventText)) {
              logger.debug(
                "Skipping channel message that mentions the bot (handled by app_mention).",
                getLogAttributesFromRequest(req as any),
              );
              return;
            }

            const slackTeamId: string = payload["team_id"] as string;
            const slackChannelId: string = event["channel"] as string;
            const eventTs: string | undefined = event["ts"] as
              | string
              | undefined;
            const eventThreadTs: string | undefined = event["thread_ts"] as
              | string
              | undefined;
            /*
             * Reply in the same thread. For app_mention the mention may be in a
             * thread (thread_ts) or a top-level message (ts). For DMs we thread
             * off the message ts (or its thread if present).
             */
            const threadTs: string = eventThreadTs || eventTs || "";

            /*
             * Detach the assistant work (fire-and-forget). Everything below is
             * best-effort; the Slack ack has already been sent.
             */
            (async (): Promise<void> => {
              const context:
                | {
                    projectId: ObjectID;
                    projectAuthToken: string;
                    botUserId: string | undefined;
                    userId: ObjectID | undefined;
                  }
                | undefined = await SlackAPI.resolveSlackAiOpsContext({
                slackTeamId: slackTeamId,
                slackUserId: eventUserId || "",
              });

              // Workspace not connected to any project — nothing we can do.
              if (!context) {
                logger.debug(
                  "Slack AI Ops event: workspace not connected to any project.",
                  getLogAttributesFromRequest(req as any),
                );
                return;
              }

              /*
               * Loop-guard: ignore messages authored by our own bot user id.
               */
              if (
                context.botUserId &&
                eventUserId &&
                context.botUserId === eventUserId
              ) {
                logger.debug(
                  "Skipping Slack AI Ops event authored by our bot user.",
                  getLogAttributesFromRequest(req as any),
                );
                return;
              }

              /*
               * Extract the question text. Strip mention tokens (for
               * app_mention the leading <@BOTID>) and trim.
               */
              const questionText: string =
                SlackAPI.cleanSlackMessageText(eventText);

              if (!questionText) {
                logger.debug(
                  "Slack AI Ops event has no question text. Skipping.",
                  getLogAttributesFromRequest(req as any),
                );
                return;
              }

              /*
               * Build conversation history so follow-ups are context-aware.
               *  - app_mention: history only when inside a thread.
               *  - channel/group/mpim: MUST be inside a thread AND the bot must
               *    already participate in that thread (it started/answered it).
               *    Otherwise we ignore the message entirely.
               *  - im: history from recent DM messages.
               */
              let history:
                | Array<{ role: "user" | "assistant"; content: string }>
                | undefined = undefined;

              if (isChannelThreadMessage) {
                if (!eventThreadTs) {
                  logger.debug(
                    "Skipping channel message not in a thread.",
                    getLogAttributesFromRequest(req as any),
                  );
                  return;
                }

                const threadReplies: Array<{
                  user?: string | undefined;
                  bot_id?: string | undefined;
                  text?: string | undefined;
                  ts?: string | undefined;
                  subtype?: string | undefined;
                }> = await SlackUtil.getThreadReplies({
                  authToken: context.projectAuthToken,
                  channelId: slackChannelId,
                  threadTs: eventThreadTs,
                });

                const botParticipatesInThread: boolean = threadReplies.some(
                  (reply: {
                    user?: string | undefined;
                    bot_id?: string | undefined;
                  }) => {
                    return Boolean(
                      reply.bot_id ||
                        (context.botUserId && reply.user === context.botUserId),
                    );
                  },
                );

                if (!botParticipatesInThread) {
                  logger.debug(
                    "Skipping channel thread the bot does not participate in.",
                    getLogAttributesFromRequest(req as any),
                  );
                  return;
                }

                history = SlackAPI.buildHistoryFromSlackMessages({
                  messages: threadReplies,
                  botUserId: context.botUserId,
                  currentMessageTs: eventTs,
                });
              } else if (isAppMention && eventThreadTs) {
                const threadReplies: Array<{
                  user?: string | undefined;
                  bot_id?: string | undefined;
                  text?: string | undefined;
                  ts?: string | undefined;
                  subtype?: string | undefined;
                }> = await SlackUtil.getThreadReplies({
                  authToken: context.projectAuthToken,
                  channelId: slackChannelId,
                  threadTs: eventThreadTs,
                });

                history = SlackAPI.buildHistoryFromSlackMessages({
                  messages: threadReplies,
                  botUserId: context.botUserId,
                  currentMessageTs: eventTs,
                });
              } else if (isDirectMessage) {
                const dmMessages: Array<{
                  messageId: string;
                  text: string;
                  userId?: string;
                  username?: string;
                  timestamp: Date;
                  isBot: boolean;
                }> = await SlackUtil.getChannelMessages({
                  channelId: slackChannelId,
                  authToken: context.projectAuthToken,
                  limit: 30,
                });

                history = SlackAPI.buildHistoryFromSlackMessages({
                  messages: dmMessages.map(
                    (message: {
                      messageId: string;
                      text: string;
                      userId?: string;
                      isBot: boolean;
                    }) => {
                      return {
                        user: message.userId,
                        bot_id: message.isBot ? "bot" : undefined,
                        text: message.text,
                        ts: message.messageId,
                      };
                    },
                  ),
                  botUserId: context.botUserId,
                  currentMessageTs: eventTs,
                });
              }

              // If the user's Slack account is not connected to OneUptime.
              if (!context.userId) {
                await SlackUtil.sendMessageToThread({
                  authToken: context.projectAuthToken,
                  channelId: slackChannelId,
                  threadTs: threadTs,
                  text: SlackAPI.getSlackAccountNotConnectedMessage(),
                });
                return;
              }

              /*
               * The project's AI kill switch, read before we acknowledge —
               * so a project with AI off gets one clear refusal instead of
               * an "on it" that is never followed by anything.
               */
              if (!(await AIService.isProjectAIEnabled(context.projectId))) {
                await SlackUtil.sendMessageToThread({
                  authToken: context.projectAuthToken,
                  channelId: slackChannelId,
                  threadTs: threadTs,
                  text: SlackAPI.getAiDisabledMessage(),
                });
                return;
              }

              // Immediate acknowledgement so the user sees we are working.
              try {
                await SlackUtil.sendMessageToThread({
                  authToken: context.projectAuthToken,
                  channelId: slackChannelId,
                  threadTs: threadTs,
                  text: "Looking into it… :hourglass_flowing_sand:",
                });
              } catch (err) {
                logger.error(
                  "Error sending Slack AI Ops acknowledgement:",
                  getLogAttributesFromRequest(req as any),
                );
                logger.error(err, getLogAttributesFromRequest(req as any));
              }

              const answerMarkdown: string =
                await SlackAPI.getAiOpsAnswerMarkdown({
                  projectId: context.projectId,
                  userId: context.userId,
                  question: questionText,
                  history: history,
                });

              await SlackUtil.sendMessageToThread({
                authToken: context.projectAuthToken,
                channelId: slackChannelId,
                threadTs: threadTs,
                text: SlackUtil.convertMarkdownToSlackRichText(answerMarkdown),
              });
            })().catch((err: Error) => {
              logger.error(
                "Error handling Slack AI Ops event:",
                getLogAttributesFromRequest(req as any),
              );
              logger.error(err, getLogAttributesFromRequest(req as any));
            });

            return;
          }
        }

        // For any other event types, just acknowledge
        return Response.sendTextResponse(req, res, "ok");
      },
    );

    /*
     * Slash command endpoint: `/oneuptime ask <question>` (or bare
     * `/oneuptime <question>`). Slack posts an application/x-www-form-urlencoded
     * body and expects a 200 within 3 seconds. We acknowledge instantly with an
     * ephemeral message, then run the assistant detached and POST the final
     * answer back to the command's response_url.
     */
    router.post(
      "/slack/command",
      SlackAuthorization.isAuthorizedSlackRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug(
          "Slack slash command received",
          getLogAttributesFromRequest(req as any),
        );

        const body: JSONObject = req.body;

        const slackTeamId: string = (body["team_id"] as string) || "";
        const slackUserId: string = (body["user_id"] as string) || "";
        const responseUrl: string = (body["response_url"] as string) || "";

        /*
         * Slack sends everything after the command word in `text`. We also
         * accept a leading "ask" keyword (e.g. `/oneuptime ask <question>`).
         */
        const askPrefixRegex: RegExp = /^ask\s+/i;
        let questionText: string = ((body["text"] as string) || "").trim();
        if (askPrefixRegex.test(questionText)) {
          questionText = questionText.replace(askPrefixRegex, "").trim();
        }

        // Empty command -> ephemeral usage help.
        if (!questionText) {
          return Response.sendJsonObjectResponse(req, res, {
            response_type: "ephemeral",
            text: "Usage: `/oneuptime ask which monitors are down?` — ask OneUptime AI about your logs, traces, metrics, incidents and monitors.",
          });
        }

        /*
         * Acknowledge instantly so Slack does not time out. The real answer is
         * delivered to response_url below.
         */
        Response.sendJsonObjectResponse(req, res, {
          response_type: "ephemeral",
          text: "On it… :hourglass_flowing_sand:",
        });

        // Detached work (fire-and-forget). Ack has already been sent.
        (async (): Promise<void> => {
          const context:
            | {
                projectId: ObjectID;
                projectAuthToken: string;
                botUserId: string | undefined;
                userId: ObjectID | undefined;
              }
            | undefined = await SlackAPI.resolveSlackAiOpsContext({
            slackTeamId: slackTeamId,
            slackUserId: slackUserId,
          });

          if (!context) {
            // Workspace not connected — tell the user ephemerally.
            await API.post({
              url: URL.fromString(responseUrl),
              data: {
                response_type: "ephemeral",
                text: "This Slack workspace is not connected to any OneUptime project.",
              },
              headers: {
                ["Content-Type"]: "application/json",
              },
            });
            return;
          }

          if (!context.userId) {
            // User's Slack account is not connected to OneUptime.
            await API.post({
              url: URL.fromString(responseUrl),
              data: {
                response_type: "ephemeral",
                text: SlackAPI.getSlackAccountNotConnectedMessage(),
              },
              headers: {
                ["Content-Type"]: "application/json",
              },
            });
            return;
          }

          /*
           * The project's AI kill switch. Ephemeral, like every other refusal
           * on this slash-command path — the person who typed the command is
           * the only one who needs to know the switch is off.
           */
          if (!(await AIService.isProjectAIEnabled(context.projectId))) {
            await API.post({
              url: URL.fromString(responseUrl),
              data: {
                response_type: "ephemeral",
                text: SlackAPI.getAiDisabledMessage(),
              },
              headers: {
                ["Content-Type"]: "application/json",
              },
            });
            return;
          }

          const answerMarkdown: string = await SlackAPI.getAiOpsAnswerMarkdown({
            projectId: context.projectId,
            userId: context.userId,
            question: questionText,
          });

          await API.post({
            url: URL.fromString(responseUrl),
            data: {
              response_type: "in_channel",
              text: SlackUtil.convertMarkdownToSlackRichText(answerMarkdown),
            },
            headers: {
              ["Content-Type"]: "application/json",
            },
          });
        })().catch((err: Error) => {
          logger.error(
            "Error handling Slack slash command:",
            getLogAttributesFromRequest(req as any),
          );
          logger.error(err, getLogAttributesFromRequest(req as any));
        });

        return;
      },
    );

    // options load endpoint.

    router.post(
      "/slack/options-load",
      SlackAuthorization.isAuthorizedSlackRequest,
      (req: ExpressRequest, res: ExpressResponse) => {
        return Response.sendJsonObjectResponse(req, res, {
          response_action: "clear",
        });
      },
    );

    return router;
  }

  /*
   * Shared "AI Ops" resolution used by both @mentions / DMs (Events API) and
   * the /oneuptime slash command. Resolves the Slack team_id -> OneUptime
   * project and the Slack user id -> OneUptime user using the same
   * WorkspaceProjectAuthToken / WorkspaceUserAuthToken pattern as
   * SlackAuthAction.isAuthorized. Returns undefined when the workspace is not
   * connected to any OneUptime project at all.
   */
  private static async resolveSlackAiOpsContext(data: {
    slackTeamId: string;
    slackUserId: string;
  }): Promise<
    | {
        projectId: ObjectID;
        projectAuthToken: string;
        botUserId: string | undefined;
        userId: ObjectID | undefined;
      }
    | undefined
  > {
    const { slackTeamId, slackUserId } = data;

    if (!slackTeamId) {
      return undefined;
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          workspaceProjectId: slackTeamId,
        },
        select: {
          projectId: true,
          authToken: true,
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth || !projectAuth.projectId || !projectAuth.authToken) {
      return undefined;
    }

    const projectId: ObjectID = projectAuth.projectId;

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: slackUserId,
          projectId: projectId,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    return {
      projectId: projectId,
      projectAuthToken: projectAuth.authToken,
      botUserId: (projectAuth.miscData as SlackMiscData)?.botUserId,
      userId: userAuth?.userId,
    };
  }

  /*
   * Runs the observability assistant for a resolved user + project and returns
   * the finished markdown answer with a compact "Sources" footer appended.
   * `history` (oldest-first prior turns, excluding the current question) makes
   * threaded / DM follow-ups context-aware.
   */
  private static async getAiOpsAnswerMarkdown(data: {
    projectId: ObjectID;
    userId: ObjectID;
    question: string;
    history?:
      | Array<{ role: "user" | "assistant"; content: string }>
      | undefined;
  }): Promise<string> {
    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: data.userId,
        projectId: data.projectId,
      });
    } catch (err) {
      // A linked Slack account whose user has since left the project.
      if (err instanceof NotAuthorizedException) {
        return err.message;
      }

      throw err;
    }

    const result: {
      contentInMarkdown: string;
      citations: Array<AIChatCitation>;
      totalTokens: number;
      llmCallCount: number;
      toolCallCount: number;
      providerName?: string | undefined;
      modelName?: string | undefined;
    } = await ObservabilityAssistant.answerQuestion({
      projectId: data.projectId,
      userId: data.userId,
      props: props,
      question: data.question,
      history: data.history,
      feature: "Slack ChatOps",
    });

    let answerMarkdown: string = result.contentInMarkdown || "";

    // Append a compact "Sources" footer from the server-minted citations.
    if (result.citations && result.citations.length > 0) {
      const sourceLines: Array<string> = result.citations.map(
        (citation: AIChatCitation) => {
          return `• ${citation.label} (${citation.rowCount} rows)`;
        },
      );

      answerMarkdown =
        answerMarkdown + "\n\n*Sources*\n" + sourceLines.join("\n");
    }

    return answerMarkdown;
  }

  /*
   * Removes Slack `<@USER>` / `<@USER|name>` mention tokens and trims the text.
   * Used both to extract the question and to clean history turns.
   */
  private static cleanSlackMessageText(text: string | undefined): string {
    return (text || "")
      .replace(/<@[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /*
   * The bot posts transient acknowledgements ("Looking into it…", "On it…")
   * before the real answer. These must never enter the assistant's history or
   * they pollute context.
   */
  private static isTransientAckMessage(text: string): boolean {
    const normalized: string = text.trim().toLowerCase();
    return (
      normalized.startsWith("looking into it") || normalized.startsWith("on it")
    );
  }

  /*
   * Builds oldest-first conversation history for the observability assistant
   * from a list of Slack messages (thread replies or recent DM messages).
   *
   * - Each message becomes a turn: authored by the bot -> "assistant",
   *   otherwise -> "user".
   * - Text is stripped of mention tokens; empty messages are skipped.
   * - The bot's transient acknowledgements are filtered out.
   * - The current triggering message (matched by its ts) is excluded because it
   *   is passed separately as the `question`.
   * - Capped to the most recent ~12 turns.
   */
  private static buildHistoryFromSlackMessages(data: {
    messages: Array<{
      user?: string | undefined;
      bot_id?: string | undefined;
      text?: string | undefined;
      ts?: string | undefined;
      subtype?: string | undefined;
    }>;
    botUserId: string | undefined;
    currentMessageTs: string | undefined;
  }): Array<{ role: "user" | "assistant"; content: string }> {
    const MAX_HISTORY_TURNS: number = 12;

    const history: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const message of data.messages) {
      // Exclude the message that triggered this run.
      if (
        data.currentMessageTs &&
        message.ts &&
        message.ts === data.currentMessageTs
      ) {
        continue;
      }

      const content: string = SlackAPI.cleanSlackMessageText(message.text);

      if (!content) {
        continue;
      }

      const isAssistant: boolean = Boolean(
        message.bot_id || (data.botUserId && message.user === data.botUserId),
      );

      // Drop the bot's own transient acknowledgements.
      if (isAssistant && SlackAPI.isTransientAckMessage(content)) {
        continue;
      }

      history.push({
        role: isAssistant ? "assistant" : "user",
        content: content,
      });
    }

    // Keep only the most recent turns.
    if (history.length > MAX_HISTORY_TURNS) {
      return history.slice(history.length - MAX_HISTORY_TURNS);
    }

    return history;
  }

  /*
   * Message shown to a Slack user whose Slack account is not connected to
   * OneUptime. Mirrors the copy used in SlackAuthAction.isAuthorized.
   */
  private static getSlackAccountNotConnectedMessage(): string {
    return "Unfortunately your Slack account is not connected to OneUptime. Please log into your OneUptime account, click on User Settings and then connect your Slack account.";
  }

  /*
   * Both AI Ops entry points above run their real work in a DETACHED
   * fire-and-forget IIFE whose .catch only logs. An exception thrown out of
   * the assistant — including the kill-switch refusal executeWithLogging
   * raises — therefore reaches nobody: the user is left staring at "Looking
   * into it…" forever. So the switch is read HERE, before the assistant is
   * started, and the refusal is posted back over the same channel the answer
   * would have used.
   */
  private static getAiDisabledMessage(): string {
    return AI_DISABLED_MESSAGE;
  }
}

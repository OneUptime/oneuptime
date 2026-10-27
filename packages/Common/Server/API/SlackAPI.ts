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
  SlackAction,
  SlackRequest,
} from "../Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../Utils/Workspace/Slack/Actions/Incident";
import SlackActionType from "../Utils/Workspace/Slack/Actions/ActionTypes";
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
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import AIService, {
  AI_DISABLED_MESSAGE,
  getProjectDailyLimitMessage,
  ProjectAiDailyLimitStatus,
} from "../Services/AIService";
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
import WorkspaceOAuthCallbackAccess from "./WorkspaceOAuthCallbackAccess";
import ConnectCallback, {
  ConnectCallbackFinish,
  ConnectCallbackRefusal,
} from "./ConnectCallback";
import ConnectCallbackUtil, {
  CONNECT_REQUEST_OUTCOME_QUERY_PARAM,
  CONNECT_REQUEST_QUERY_PARAM,
  CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM,
  CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM,
  CONNECT_START_PAGE_QUERY_PARAM,
  ConnectCallbackError,
  ConnectProvider,
  ConnectRequestOutcome,
} from "../../Types/Workspace/ConnectCallback";
import OneUptimeDate from "../../Types/Date";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestRecord,
} from "../Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceConnectCompletion, {
  WorkspaceConnectCompletionResult,
} from "../Utils/Workspace/WorkspaceConnectCompletion";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "../Utils/Workspace/Slack/Actions/Answer";
import SlackConnectPrompt from "../Utils/Workspace/Slack/Actions/ConnectPrompt";
import WorkspaceProjectResolver, {
  WorkspaceAmbiguousRetryKind,
  WorkspaceProjectChoice,
  WorkspaceProjectResolution,
} from "../Utils/Workspace/WorkspaceProjectResolution";
import SlackProjectChoice, {
  SlackConversationOfPerson,
  SlackProjectChoiceKind,
  SlackProjectChoicePress,
  SlackProjectChoiceRecord,
  SlackQuestionCommand,
} from "../Utils/Workspace/Slack/SlackProjectChoice";
import { WorkspaceAnswer } from "../Utils/Workspace/WorkspaceActionAnswers";
import SlackCommandActions from "../Utils/Workspace/Slack/Actions/Command";
import SlackPageActions from "../Utils/Workspace/Slack/Actions/Page";
import SlackAiConversations, {
  SlackMessage,
  SlackMessageKind,
  SlackThreadMessage,
  SlackThreadPerson,
} from "../Utils/Workspace/Slack/SlackAiConversations";
import WorkspaceAiAnswerSources from "../Utils/Workspace/WorkspaceAiAnswerSources";
import WorkspaceAiRefusal from "../Utils/Workspace/WorkspaceAiRefusal";
import SlackHome from "../Utils/Workspace/Slack/SlackHome";
import SlackDirectMessageHelp from "../Utils/Workspace/Slack/SlackDirectMessageHelp";
import SlackMessagesWelcome from "../Utils/Workspace/Slack/SlackMessagesWelcome";
import SlackWelcome from "../Utils/Workspace/Slack/SlackWelcome";
import WorkspaceCommands from "../Utils/Workspace/WorkspaceCommands";

import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
/*
 * A Slack mention of a person in a message's text: <@U0123> or
 * <@U0123|name>. Its class leaves out "<" as well as ">": with "[^>]+" the
 * pattern was tried again from every "<@" of "<@<@<@..." to the end of the
 * message, so its time grew with the square of the message (code scanning
 * alert #1643). Slack writes a "<" somebody typed as "&lt;", so no mention
 * holds one.
 */
const SLACK_USER_MENTION: RegExp = /<@[^<>]+>/g;

const WHITESPACE_RUN: RegExp = /\s+/g;

// The Slack app this server connects with.
interface SlackAppCredentials {
  clientId: string;
  clientSecret: string;
}

/*
 * Who a question for OneUptime AI is from, and in which project it is
 * asked (resolveSlackAiOpsContext).
 */
interface SlackAiOpsContext {
  projectId: ObjectID;
  projectAuthToken: string;
  botUserId: string | undefined;
  userId: ObjectID | undefined;
  /*
   * The workspace is connected to more than one project, and neither the
   * channel nor the asker tells which: what the asker is told instead of an
   * answer (WorkspaceProjectResolution.getAmbiguousAnswer), when they cannot
   * be asked which with a button for each (SlackProjectChoice), and the
   * resolution that asks it.
   */
  ambiguousAnswer?: WorkspaceAnswer | undefined;
  ambiguousResolution?: WorkspaceProjectResolution | undefined;
}

export default class SlackAPI {
  /*
   * What someone who may not connect the project to Slack is told, when the
   * connection starts and again when Slack sends the browser back.
   */
  public static readonly CONNECT_PERMISSION_MESSAGE: string =
    "You do not have permission to connect this project to Slack.";

  /*
   * What the sign-in a Connect button in Slack starts is refused with when
   * the press behind it is gone - spent by an earlier sign-in, or past its
   * thirty minutes - or is not this project's.
   */
  public static readonly CONNECT_REQUEST_GONE_MESSAGE: string =
    "This Connect button has expired or was already used. Press the button in Slack again.";

  // Generous: the server-side channel fetch caches up to ~100k channels.
  public static readonly MAX_CHANNEL_CACHE_ENTRIES: number = 100000;

  /*
   * The press a sign-in's `?connect=` stands for, as the state's payload -
   * nothing when there is no `?connect=`. Refused when the press is gone
   * or is another project's: the page then says the button expired.
   */
  private static async getConnectRequestPayload(data: {
    value: unknown;
    projectId: ObjectID;
  }): Promise<JSONObject | undefined> {
    if (data.value === undefined) {
      return undefined;
    }

    const request: WorkspaceConnectRequestRecord | null =
      await SlackAPI.peekConnectRequest({
        token: data.value,
        projectId: data.projectId,
      });

    if (!request) {
      throw new BadDataException(SlackAPI.CONNECT_REQUEST_GONE_MESSAGE);
    }

    return { connectToken: data.value as string };
  }

  // A Slack press behind `token` in `projectId`, left in place; null for anything else.
  private static async peekConnectRequest(data: {
    token: unknown;
    projectId: ObjectID;
  }): Promise<WorkspaceConnectRequestRecord | null> {
    const request: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(data.token);

    if (
      !request ||
      request.workspaceType !== WorkspaceType.Slack ||
      request.projectId.toString() !== data.projectId.toString()
    ) {
      return null;
    }

    return request;
  }

  /*
   * Once the account a Connect button was for is connected: spends the
   * press, finishes it as the member (WorkspaceConnectCompletion), answers
   * where it was made (SlackActionAnswer), and says what the settings page
   * should tell the person - what became of the press, and where in Slack
   * to go back to.
   */
  private static async finishConnectRequest(data: {
    token: unknown;
    connectRequest: WorkspaceConnectRequestRecord | null;
    userId: ObjectID;
    projectAuthToken: string | undefined;
  }): Promise<Dictionary<string>> {
    // Spent once, however many times its sign-in comes back.
    const request: WorkspaceConnectRequestRecord | null = data.connectRequest
      ? await WorkspaceConnectRequest.take(data.token)
      : null;

    if (!request) {
      return {
        [CONNECT_REQUEST_OUTCOME_QUERY_PARAM]: ConnectRequestOutcome.Expired,
      };
    }

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request,
        userId: data.userId,
      });

    let delivery: SlackAnswerDelivery = SlackAnswerDelivery.None;

    if (data.projectAuthToken) {
      const place: SlackAnswerPlace = {
        projectAuthToken: data.projectAuthToken,
        slackUserId: request.workspaceUserId,
      };

      if (request.slack?.channelId) {
        place.slackChannelId = request.slack.channelId;
      }

      if (request.slack?.threadTs) {
        place.slackThreadTs = request.slack.threadTs;
      }

      if (SlackUtil.isSlackResponseUrl(request.slack?.responseUrl)) {
        place.responseUrl = request.slack!.responseUrl;
      }

      delivery = await SlackActionAnswer.answer({
        place: place,
        answer: result.answer,
      });
    }

    const params: Dictionary<string> = {
      /*
       * The page never says the answer is in Slack when Slack took none: it
       * says to look at the record instead.
       */
      [CONNECT_REQUEST_OUTCOME_QUERY_PARAM]:
        ConnectCallbackUtil.pointsToChatAnswer(result.outcome) &&
        delivery === SlackAnswerDelivery.None
          ? ConnectRequestOutcome.NotAnswered
          : result.outcome,
    };

    /*
     * Where the page's "Back to Slack" goes: the channel the press was in,
     * or the person's direct messages with the app when they wrote there.
     */
    const backTo: string | undefined =
      request.slack?.channelId || request.slack?.directMessageChannelId;

    if (
      backTo &&
      ConnectCallbackUtil.getSlackChannelLink({
        channel: backTo,
        team: request.slack?.teamId,
      })
    ) {
      params[CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM] = backTo;
      params[CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM] = request.slack!.teamId!;
    }

    return params;
  }

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
   * was issued for, or null when the callback must be refused. A state that
   * cannot be read at all throws, and is answered as such
   * (ConnectCallback.route).
   *
   * The ids in the redirect path are only there because Slack matches
   * redirect URIs by prefix; they are never used. They must still agree with
   * the state, so a hand-edited path is refused rather than quietly ignored.
   */
  private static async consumeStateForCallback(data: {
    req: ExpressRequest;
    flow: WorkspaceOAuthFlow;
  }): Promise<WorkspaceOAuthStateRecord | null> {
    const stateRecord: WorkspaceOAuthStateRecord | null =
      await WorkspaceOAuthState.consume({
        req: data.req,
        state: data.req.query["state"]?.toString(),
        flows: [data.flow],
      });

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

  /*
   * The Slack app this server connects with. A connection cannot be finished
   * without its client secret, so a server missing either is refused as one
   * that is not set up.
   */
  private static getAppCredentials(): SlackAppCredentials {
    if (!SlackAppClientId || !SlackAppClientSecret) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.NotConfigured,
        "SLACK_APP_CLIENT_ID or SLACK_APP_CLIENT_SECRET is not set.",
      );
    }

    return {
      clientId: SlackAppClientId,
      clientSecret: SlackAppClientSecret,
    };
  }

  /*
   * The body of what Slack's token endpoint answered, or a refusal when it
   * did not answer with a token: an HTTP error, or a body whose `ok` is not
   * true. What Slack said goes to the log, never to the browser.
   */
  private static getTokenResponseBody(
    response: HTTPErrorResponse | HTTPResponse<JSONObject>,
  ): JSONObject {
    if (response instanceof HTTPErrorResponse) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.CouldNotFinish,
        `Slack answered the token request with HTTP ${response.statusCode}.`,
      );
    }

    const body: JSONObject = response.data || {};

    if (body["ok"] !== true) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.CouldNotFinish,
        `Slack refused the token request: ${String(body["error"] || "no reason given")}.`,
      );
    }

    return body;
  }

  /*
   * The claims of the ID token Slack's token endpoint answered with. Its
   * signature is not checked, and need not be: it came straight from Slack
   * over TLS, in exchange for a code and this app's client secret (OpenID
   * Connect Core 3.1.3.7). A token that is missing or cannot be read is
   * refused.
   */
  private static getIdTokenClaims(idToken: unknown): JSONObject {
    const payload: string | undefined =
      typeof idToken === "string" ? idToken.split(".")[1] : undefined;

    let claims: unknown = null;

    if (payload) {
      try {
        claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
      } catch {
        claims = null;
      }
    }

    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.CouldNotFinish,
        "Slack returned no ID token that can be read.",
      );
    }

    return claims as JSONObject;
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
            errorMessage: SlackAPI.CONNECT_PERMISSION_MESSAGE,
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
            startPage: ConnectCallbackUtil.readStartPage(
              req.query[CONNECT_START_PAGE_QUERY_PARAM],
            ),
          });

          const scopes: JSONObject = (
            (SlackAppManifest as unknown as JSONObject)[
              "oauth_config"
            ] as JSONObject
          )["scopes"] as JSONObject;

          /*
           * The app asks for no user scopes: OneUptime acts with the bot's
           * token, and Slack names who installed it all the same
           * (authed_user.id). A user_scope goes only with a manifest that
           * asks for one.
           */
          const userScopes: Array<string> =
            (scopes["user"] as Array<string>) || [];

          const authorizationUrl: string = `https://slack.com/oauth/v2/authorize?scope=${encodeURIComponent(
            ((scopes["bot"] as Array<string>) || []).join(","),
          )}${
            userScopes.length > 0
              ? `&user_scope=${encodeURIComponent(userScopes.join(","))}`
              : ""
          }&client_id=${encodeURIComponent(
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

          /*
           * Started from a Connect button in Slack (`?connect=`): the press
           * it stands for goes with the sign-in, so the callback can finish
           * it - when it is still there, and is this project's.
           */
          const payload: JSONObject | undefined =
            await SlackAPI.getConnectRequestPayload({
              value: req.query[CONNECT_REQUEST_QUERY_PARAM],
              projectId: projectId,
            });

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.SlackUserSignIn,
            projectId: projectId,
            userId: userId,
            startPage: ConnectCallbackUtil.readStartPage(
              req.query[CONNECT_START_PAGE_QUERY_PARAM],
            ),
            payload: payload,
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

    /*
     * Where Slack sends the browser back once OneUptime is installed into a
     * workspace. ConnectCallback.route spends the state, asks again, and
     * answers every way this can end on the Slack page the install started
     * from - with a code, never with what Slack or a failed read said.
     */
    router.get(
      "/slack/auth/:projectId/:userId",
      ConnectCallback.route({
        provider: ConnectProvider.Slack,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return SlackAPI.consumeStateForCallback({
            req,
            flow: WorkspaceOAuthFlow.SlackInstall,
          });
        },
        // Whoever started the install may still connect the project.
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(
            {
              record: record,
              errorMessage: SlackAPI.CONNECT_PERMISSION_MESSAGE,
            },
          );
        },
        refusedAs: ConnectCallbackError.NoPermission,
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          const { req, record } = data;
          const credentials: SlackAppCredentials = SlackAPI.getAppCredentials();

          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(req);

          if (providerError) {
            throw providerError;
          }

          // Slack returns the code on a successful install.
          const code: string | undefined = req.query["code"]?.toString();

          if (!code) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.CouldNotFinish,
              "Slack sent no authorization code back.",
            );
          }

          /*
           * Neither the token request nor the token response is logged: the
           * request carries the app client secret and the authorization
           * code, and the response carries the bot's access token (and a
           * user's, for an app whose manifest asks for user scopes).
           */
          logger.debug(
            "Exchanging Slack authorization code for an access token.",
            getLogAttributesFromRequest(req as any),
          );

          const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.post({
              url: URL.fromString("https://slack.com/api/oauth.v2.access"),
              data: {
                code: code,
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                redirect_uri: SlackAPI.getInstallRedirectUri({
                  projectId: record.projectId,
                  userId: record.userId,
                }),
              },
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            });

          const responseBody: JSONObject =
            SlackAPI.getTokenResponseBody(response);

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
           *         "id": "U1234"
           *     }
           * }
           *
           * authed_user is who installed the app. It carries a token of
           * theirs (access_token, scope, token_type) only for an app that
           * asks for user scopes, and this one asks for none: OneUptime acts
           * with the bot's token and their Slack user id, so their account
           * is linked with an empty token (WorkspaceUserAuthTokenService).
           * An app created from an older manifest still gets one; it is kept
           * as before, and used for nothing.
           */

          const team: JSONObject | undefined = responseBody["team"] as
            | JSONObject
            | undefined;
          const authedUser: JSONObject | undefined = responseBody[
            "authed_user"
          ] as JSONObject | undefined;

          const slackTeamId: string | undefined = team?.["id"]?.toString();
          const slackTeamName: string | undefined = team?.["name"]?.toString();
          const slackBotAccessToken: string | undefined =
            responseBody["access_token"]?.toString();
          const botUserId: string | undefined =
            responseBody["bot_user_id"]?.toString();
          const slackUserId: string | undefined =
            authedUser?.["id"]?.toString();
          const slackUserAccessToken: string | undefined =
            authedUser?.["access_token"]?.toString();

          await WorkspaceProjectAuthTokenService.refreshAuthToken({
            projectId: record.projectId,
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
            projectId: record.projectId,
            userId: record.userId,
            workspaceType: WorkspaceType.Slack,
            authToken: slackUserAccessToken || "",
            workspaceUserId: slackUserId || "",
            miscData: {
              userId: slackUserId || "",
            },
          });

          // The app's Home tab, drawn for whoever installed it (SlackHome).
          if (slackUserId) {
            SlackAPI.refreshHomeAfterConnect({
              projectId: record.projectId,
              slackUserId: slackUserId,
            });
          }

          data.backToPage();
        },
      }),
    );

    /*
     * Where Slack sends the browser back once someone has signed in with
     * Slack, to link their Slack account in a project already connected to a
     * Slack workspace. Answered like the install above.
     */
    router.get(
      "/slack/auth/:projectId/:userId/user",
      ConnectCallback.route({
        provider: ConnectProvider.Slack,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return SlackAPI.consumeStateForCallback({
            req,
            flow: WorkspaceOAuthFlow.SlackUserSignIn,
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
          const credentials: SlackAppCredentials = SlackAPI.getAppCredentials();

          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(req);

          if (providerError) {
            throw providerError;
          }

          // Slack returns the code on a successful sign-in.
          const code: string | undefined = req.query["code"]?.toString();

          if (!code) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.CouldNotFinish,
              "Slack sent no authorization code back.",
            );
          }

          // Same as above: the body holds the client secret and the auth code.
          logger.debug(
            "Exchanging Slack authorization code for a user token.",
            getLogAttributesFromRequest(req as any),
          );

          const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.post({
              url: URL.fromString("https://slack.com/api/openid.connect.token"),
              data: {
                code: code,
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                redirect_uri: SlackAPI.getUserSignInRedirectUri({
                  projectId: record.projectId,
                  userId: record.userId,
                }),
              },
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            });

          const responseBody: JSONObject =
            SlackAPI.getTokenResponseBody(response);

          /*
           * The ID token's claims, e.g.
           * {
           *   "iss": "https://slack.com",
           *   "sub": "U123ABC456",
           *   "https://slack.com/team_id": "T0123ABC456",
           *   "https://slack.com/user_id": "U123ABC456",
           *   "email": "alice@example.com",
           *   ...
           * }
           */
          const idToken: JSONObject = SlackAPI.getIdTokenClaims(
            responseBody["id_token"],
          );

          // The project's Slack workspace, which the account must belong to.
          const projectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.findOneBy({
              query: {
                projectId: record.projectId,
                workspaceType: WorkspaceType.Slack,
              },
              select: {
                workspaceProjectId: true,
                miscData: true,
                authToken: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!projectAuth) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.SlackNotInstalled,
              "The project is not connected to a Slack workspace.",
            );
          }

          if (
            projectAuth.workspaceProjectId?.toString() !==
            idToken["https://slack.com/team_id"]?.toString()
          ) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.SlackOtherWorkspace,
              "The Slack account belongs to a different workspace from the project's.",
            );
          }

          const authToken: string | undefined =
            responseBody["access_token"]?.toString();
          const slackUserId: string | undefined =
            idToken["https://slack.com/user_id"]?.toString();

          if (!slackUserId) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.CouldNotFinish,
              "Slack's ID token named no Slack user.",
            );
          }

          /*
           * Started from a Connect button in Slack: the account that signed
           * in must be the one that pressed it. Another one - a browser
           * signed in to a colleague's Slack - is refused and nothing is
           * connected: connecting it would let that account act as you.
           */
          const connectToken: unknown = record.payload?.["connectToken"];

          const connectRequest: WorkspaceConnectRequestRecord | null =
            connectToken
              ? await SlackAPI.peekConnectRequest({
                  token: connectToken,
                  projectId: record.projectId,
                })
              : null;

          if (
            connectRequest &&
            connectRequest.workspaceUserId !== slackUserId
          ) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.SlackOtherAccount,
              "The Slack account signed in is not the one that pressed the Connect button.",
            );
          }

          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: record.projectId,
            userId: record.userId,
            workspaceType: WorkspaceType.Slack,
            authToken: authToken || "",
            workspaceUserId: slackUserId,
            miscData: {
              userId: slackUserId,
            },
          });

          /*
           * The app's Home tab, which asked them to connect, fills in
           * (SlackHome) - while the browser is already on its way back.
           */
          SlackAPI.refreshHomeAfterConnect({
            projectId: record.projectId,
            slackUserId: slackUserId,
          });

          if (!connectToken) {
            return data.backToPage();
          }

          return data.backToPage(
            await SlackAPI.finishConnectRequest({
              token: connectToken,
              connectRequest: connectRequest,
              userId: record.userId,
              projectAuthToken: projectAuth.authToken,
            }),
          );
        },
      }),
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
          /*
           * Slack is answered at once - within its three seconds, so the
           * button never shows a timeout - and then the person, where they
           * pressed: connect your account, or why they may not
           * (SlackAuthAction.answerRefusal). They used to get a direct
           * message instead, which nobody watching the channel saw.
           */
          Response.sendTextResponse(req, res, "");

          if (authResult.refusal) {
            await SlackAuthAction.answerRefusal(authResult);
          }

          return;
        }

        for (const action of authResult.actions || []) {
          if (!action.actionType) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid request"),
            );
          }

          /*
           * A project chosen for a request that could be about more than
           * one: the request made again there (SlackProjectChoice).
           */
          if (action.actionType === SlackActionType.ChooseProject) {
            return await SlackAPI.handleProjectChoice({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
          }

          /*
           * The Home's Switch project menu: Slack is answered at once, and
           * the Home drawn again for the project chosen - when the person
           * may see it, read again (SlackHome).
           */
          if (action.actionType === SlackActionType.SwitchHomeProject) {
            Response.sendTextResponse(req, res, "");

            await SlackHome.switchProject({
              teamId: authResult.slackTeamId,
              slackUserId: authResult.slackUserId,
              projectId: SlackHome.readProjectSwitch(authResult.payload),
            });

            return;
          }

          /*
           * Join call and Connect are link buttons: Slack opens the link,
           * and the click it reports needs nothing but an acknowledgement.
           */
          if (
            action.actionType === SlackActionType.JoinVideoCall ||
            action.actionType === SlackActionType.ConnectSlackAccount ||
            action.actionType === SlackActionType.OpenInOneUptime
          ) {
            return Response.sendTextResponse(req, res, "");
          }

          // Who's on call, from the app's Home tab: answered in a modal.
          if (action.actionType === SlackActionType.ShowOnCall) {
            return await SlackCommandActions.showOnCall({
              slackRequest: authResult,
              req: req,
              res: res,
            });
          }

          // The Page someone form of `/oneuptime page`, submitted.
          if (
            SlackPageActions.isPageAction({
              actionType: action.actionType,
            })
          ) {
            return SlackPageActions.handlePageAction({
              slackRequest: authResult,
              action: action,
              req: req,
              res: res,
            });
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

          const channelId: string =
            typeof req.body?.["channelId"] === "string"
              ? (req.body["channelId"] as string)
              : "";

          // Slack has no chats or teams: only the channel id is forwarded.
          await WorkspaceNotificationRuleService.sendTestNotificationToDestination(
            {
              projectId: caller.projectId,
              workspaceType: WorkspaceType.Slack,
              testByUserId: caller.userId,
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
           * The OneUptime app's Home tab was opened: it is drawn for whoever
           * opened it (SlackHome) - their on-call shifts, the open incidents
           * and alerts, and what they can do. Its Messages tab: whoever
           * opened it is welcomed there, the first time
           * (SlackMessagesWelcome). Slack has its 200 first.
           */
          if (event["type"] === "app_home_opened") {
            Response.sendTextResponse(req, res, "ok");

            if (event["tab"] === "messages") {
              await SlackMessagesWelcome.handleMessagesTabOpened({
                teamId: (payload["team_id"] as string) || "",
                slackUserId: (event["user"] as string) || "",
              });

              return;
            }

            await SlackHome.handleHomeOpened({
              teamId: (payload["team_id"] as string) || "",
              slackUserId: (event["user"] as string) || "",
              tab: event["tab"] as string | undefined,
            });

            return;
          }

          /*
           * Somebody added the OneUptime app to a channel: it says hello
           * there, once (SlackWelcome). Channels it creates or joins by
           * itself get none.
           */
          if (event["type"] === "member_joined_channel") {
            Response.sendTextResponse(req, res, "ok");

            if (req.headers["x-slack-retry-num"]) {
              return;
            }

            await SlackWelcome.handleMemberJoinedChannel({
              teamId:
                (event["team"] as string) ||
                (payload["team_id"] as string) ||
                "",
              joinedUserId: (event["user"] as string) || "",
              channelId: (event["channel"] as string) || "",
              inviterUserId: (event["inviter"] as string) || undefined,
            });

            return;
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
           * Messages and @mentions: answered only when addressed to
           * OneUptime (SlackAiConversations.read) - an @mention, a direct
           * message, or a reply in a conversation with OneUptime AI by
           * somebody in it. People talking to each other in a channel, or
           * in the thread of one of OneUptime's notifications, are never
           * answered (#4768), and what is not addressed to OneUptime is
           * dropped before anything is read.
           */
          const message: SlackMessage | null =
            SlackAiConversations.read(payload);

          if (message) {
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

            if (message.kind === SlackMessageKind.NotAddressed) {
              logger.debug(
                `Slack message not answered: ${message.reason || "not addressed to OneUptime"}.`,
                getLogAttributesFromRequest(req as any),
              );
              return;
            }

            /*
             * Detach the assistant work (fire-and-forget). Everything below is
             * best-effort; the Slack ack has already been sent.
             */
            (async (): Promise<void> => {
              /*
               * A plain reply in a thread is for OneUptime only in a
               * conversation with OneUptime AI that its author is in.
               */
              if (
                message.kind === SlackMessageKind.ThreadReply &&
                !(await SlackAiConversations.isIn({
                  teamId: message.teamId,
                  channelId: message.channelId,
                  threadTs: SlackAiConversations.getThreadTs(message),
                  userId: message.userId,
                }))
              ) {
                logger.debug(
                  "Slack message not answered: a reply in a thread that is not a conversation of its author's with OneUptime AI.",
                  getLogAttributesFromRequest(req as any),
                );
                return;
              }

              await SlackAPI.answerMessage({
                req: req,
                message: message,
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
     * The /oneuptime command and every word after it - incident,
     * maintenance, oncall, page, ask, help (SlackCommandActions). Slack posts an
     * application/x-www-form-urlencoded body and expects a 200 within three
     * seconds. A question for OneUptime AI is acknowledged at once and
     * answered at the command's response_url (answerQuestionCommand).
     */
    router.post(
      "/slack/command",
      SlackAuthorization.isAuthorizedSlackRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug(
          "Slack slash command received",
          getLogAttributesFromRequest(req as any),
        );

        return await SlackCommandActions.handleCommand({
          req: req,
          res: res,
          askQuestion: async (question: string): Promise<void> => {
            return await SlackAPI.answerQuestionCommand({
              req: req,
              res: res,
              question: question,
            });
          },
        });
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
   * A press of one of the buttons that ask which project a request is for
   * (SlackProjectChoice): the request recorded behind it spent - only by
   * the person who made it, for a project it offered - and made again in
   * the project chosen. A command, a shortcut or a Home button is read
   * again as a press is (SlackCommandActions.runInChosenProject), with this
   * press's trigger_id to open a form, in place of the modal it was chosen
   * in when it was; a question is answered there, and a conversation with
   * OneUptime AI keeps the project for its follow-ups. The question becomes
   * what was chosen. A press whose request is gone - expired, chosen
   * already, not the presser's - is told so in its place, and makes
   * nothing again.
   */
  private static async handleProjectChoice(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;

    // Asked in a modal - a shortcut's, a Home button's: what follows takes its place.
    const viewId: string | undefined =
      slackRequest.slackViewType === "modal" &&
      typeof slackRequest.view?.["id"] === "string"
        ? (slackRequest.view["id"] as string)
        : undefined;

    const press: SlackProjectChoicePress | null = SlackProjectChoice.readChoice(
      data.action.actionValue,
    );

    const record: SlackProjectChoiceRecord | null = press
      ? await SlackProjectChoice.take({
          press: press,
          teamId: slackRequest.slackTeamId,
          slackUserId: slackRequest.slackUserId,
        })
      : null;

    const choice: WorkspaceProjectChoice | undefined =
      press && record
        ? SlackProjectChoice.getChoice(record, press.projectId)
        : undefined;

    if (!press || !record || !choice) {
      Response.sendTextResponse(req, res, "");

      await SlackProjectChoice.answerGone({
        responseUrl: slackRequest.responseUrl,
        projectAuthToken: slackRequest.projectAuthToken,
        triggerId: slackRequest.triggerId,
        viewId: viewId,
      });
      return;
    }

    /*
     * The question becomes what was chosen, while the request is made
     * again: Slack is answered within its three seconds, and a form opens
     * on this press's trigger_id within them.
     */
    const chosen: Promise<void> = viewId
      ? Promise.resolve()
      : SlackProjectChoice.answerChosen({
          responseUrl: slackRequest.responseUrl,
          projectName: choice.name,
        });

    try {
      switch (record.request.kind) {
        case SlackProjectChoiceKind.Press: {
          const payload: JSONObject = { ...record.request.payload };

          if (slackRequest.triggerId) {
            payload["trigger_id"] = slackRequest.triggerId;
          }

          await SlackCommandActions.runInChosenProject({
            req: req,
            res: res,
            payload: payload,
            chosenProjectId: press.projectId,
            replaceViewId: viewId,
          });
          break;
        }
        case SlackProjectChoiceKind.Question:
          Response.sendTextResponse(req, res, "");

          await SlackAPI.answerQuestion({
            req: req,
            question: record.request.question!,
            chosenProjectId: press.projectId,
          });
          break;
        case SlackProjectChoiceKind.Message:
          Response.sendTextResponse(req, res, "");

          // Its follow-ups in the thread are answered there too.
          await SlackProjectChoice.rememberConversationProject({
            conversation: SlackProjectChoice.getConversationOf(
              record.request.message!,
            ),
            projectId: press.projectId,
          });

          await SlackAPI.answerMessage({
            req: req,
            message: record.request.message!,
            chosenProjectId: press.projectId,
          });
          break;
      }
    } catch (err) {
      logger.error(
        "Could not make a Slack request again in the project chosen for it.",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(err, getLogAttributesFromRequest(req as any));

      // Slack is answered whatever happened, so the button shows no error.
      if (!res.headersSent) {
        Response.sendTextResponse(req, res, "");
      }
    } finally {
      await chosen;
    }
  }

  /*
   * `/oneuptime ask <question>`, or `/oneuptime <question>`: acknowledged at
   * once with a message only the asker sees, then answered by the
   * assistant, detached, at the command's response_url - in the channel
   * (answerQuestion).
   */
  private static async answerQuestionCommand(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    question: string;
  }): Promise<void> {
    const { req, res } = data;
    const body: JSONObject = req.body;

    /*
     * Acknowledge instantly so Slack does not time out. The real answer is
     * delivered to response_url below.
     */
    Response.sendJsonObjectResponse(req, res, {
      response_type: "ephemeral",
      text: "On it… :hourglass_flowing_sand:",
    });

    // Detached work (fire-and-forget). Ack has already been sent.
    SlackAPI.answerQuestion({
      req: req,
      question: {
        question: data.question,
        teamId: (body["team_id"] as string) || "",
        slackUserId: (body["user_id"] as string) || "",
        channelId: (body["channel_id"] as string) || undefined,
        responseUrl: (body["response_url"] as string) || "",
        command: (body["command"] as string) || undefined,
      },
    }).catch((err: Error) => {
      logger.error(
        "Error handling Slack slash command:",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(err, getLogAttributesFromRequest(req as any));
    });
  }

  /*
   * A question of `/oneuptime ask`, answered by OneUptime AI at the
   * command's response_url, in the channel - or refused there, only to its
   * asker. In a workspace connected to more than one project, a question
   * nothing ties to one of them asks its asker which, with a button for
   * each project they are in (SlackProjectChoice), and is answered here
   * again, in `chosenProjectId`, once they choose.
   */
  private static async answerQuestion(data: {
    req: ExpressRequest;
    question: SlackQuestionCommand;
    chosenProjectId?: ObjectID | undefined;
  }): Promise<void> {
    const slackTeamId: string = data.question.teamId;
    const slackUserId: string = data.question.slackUserId;
    const slackChannelId: string | undefined = data.question.channelId;
    const responseUrl: string = data.question.responseUrl;
    const questionText: string = data.question.question;

    // The command as this workspace runs it, for "run /oneuptime help".
    const helpCommand: string = `${WorkspaceCommands.getSlackCommand(
      data.question.command,
    )} help`;

    const context: SlackAiOpsContext | undefined =
      await SlackAPI.resolveSlackAiOpsContext({
        slackTeamId: slackTeamId,
        slackUserId: slackUserId,
        slackChannelId: slackChannelId,
        chosenProjectId: data.chosenProjectId,
      });

    if (!context) {
      // Workspace not connected — tell the user ephemerally.
      await API.post({
        url: URL.fromString(responseUrl),
        data: {
          response_type: "ephemeral",
          text: SlackUtil.getNotificationText(
            SlackCommandActions.getNotConnectedAnswer().text,
          ),
        },
        headers: {
          ["Content-Type"]: "application/json",
        },
      });
      return;
    }

    /*
     * The workspace is connected to more than one project, and neither
     * the channel nor the asker tells which: asked which, only to them,
     * with a button for each project they are in, and answered in the
     * one they choose (SlackProjectChoice) - or, when that cannot be
     * asked, told how to say which.
     */
    if (context.ambiguousAnswer) {
      if (
        context.ambiguousResolution &&
        (await SlackProjectChoice.offer({
          place: {
            projectAuthToken: context.projectAuthToken,
            slackUserId: slackUserId,
            slackChannelId: slackChannelId,
            responseUrl: responseUrl,
          },
          teamId: slackTeamId,
          slackUserId: slackUserId,
          resolution: context.ambiguousResolution,
          request: {
            kind: SlackProjectChoiceKind.Question,
            question: data.question,
          },
        })) !== null
      ) {
        return;
      }

      await API.post({
        url: URL.fromString(responseUrl),
        data: {
          response_type: "ephemeral",
          text: SlackUtil.convertMarkdownToSlackRichText(
            context.ambiguousAnswer.markdown,
          ),
        },
        headers: {
          ["Content-Type"]: "application/json",
        },
      });
      return;
    }

    if (!context.userId) {
      /*
       * A Slack account not connected to OneUptime: asked to connect
       * it where the command was run, with the Connect button, and to
       * ask again once it is.
       */
      await SlackConnectPrompt.prompt({
        projectId: context.projectId,
        slackTeamId: slackTeamId,
        place: {
          projectAuthToken: context.projectAuthToken,
          slackUserId: slackUserId,
          slackChannelId: slackChannelId,
          responseUrl: responseUrl,
        },
        description: SlackConnectPrompt.describeQuestion(),
      });
      return;
    }

    /*
     * The project's AI kill switch. Ephemeral, like every other refusal
     * on this slash-command path — the person who typed the command is
     * the only one who needs to know the switch is off. /oneuptime does
     * more than ask AI, so the refusal says where the rest is.
     */
    if (!(await AIService.isProjectAIEnabled(context.projectId))) {
      await API.post({
        url: URL.fromString(responseUrl),
        data: {
          response_type: "ephemeral",
          text: SlackAPI.withHelpPointer(
            SlackAPI.getAiDisabledMessage(),
            helpCommand,
          ),
        },
        headers: {
          ["Content-Type"]: "application/json",
        },
      });
      return;
    }

    // The project's own daily AI limits: refused the same way.
    const dailyLimitRefusal: string | null =
      await SlackAPI.getDailyLimitRefusal(context.projectId);

    if (dailyLimitRefusal) {
      await API.post({
        url: URL.fromString(responseUrl),
        data: {
          response_type: "ephemeral",
          text: SlackAPI.withHelpPointer(dailyLimitRefusal, helpCommand),
        },
        headers: {
          ["Content-Type"]: "application/json",
        },
      });
      return;
    }

    /*
     * The project's AI credits: refused the same way, saying who can add
     * them and where (WorkspaceAiRefusal) - a project whose credits are
     * used up, every new one, got no answer at all here.
     */
    const creditsRefusal: string | null =
      await WorkspaceAiRefusal.getCreditsRefusal(context.projectId);

    if (creditsRefusal) {
      await API.post({
        url: URL.fromString(responseUrl),
        data: {
          response_type: "ephemeral",
          text: SlackAPI.withHelpPointer(creditsRefusal, helpCommand),
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
  }

  /*
   * Draws the Home tab of somebody who has just connected their Slack
   * account, detached: the sign-in's page does not wait for Slack.
   */
  public static refreshHomeAfterConnect(data: {
    projectId: ObjectID;
    slackUserId: string;
  }): void {
    SlackHome.refreshAfterConnect(data).catch((err: Error) => {
      logger.debug("Could not draw the Slack Home after a connection.");
      logger.debug(err);
    });
  }

  /*
   * A refusal of a question, and where the commands that need no AI are -
   * "... Run `/oneuptime help` to see the other commands." - as Slack text.
   */
  public static withHelpPointer(refusal: string, helpCommand: string): string {
    return SlackUtil.convertMarkdownToSlackRichText(
      mdText`${refusal} Run ${FeedMarkdown.code(
        helpCommand,
      )} to see the other commands.`.toString(),
    );
  }

  /*
   * A message addressed to OneUptime (SlackAiConversations.read): an
   * @mention, a direct message, or a reply in a conversation with OneUptime
   * AI by somebody in it. Answered by OneUptime AI in the thread - the one
   * it is in, or the one it starts - except a direct message that is only
   * "help", answered with the commands (SlackDirectMessageHelp). Detached
   * from the request: Slack has its 200 already.
   */
  private static async answerMessage(data: {
    req: ExpressRequest;
    message: SlackMessage;
    /*
     * The project its author chose for it, asked which once nothing else
     * told (SlackProjectChoice).
     */
    chosenProjectId?: ObjectID | undefined;
  }): Promise<void> {
    const { req, message } = data;

    const context: SlackAiOpsContext | undefined =
      await SlackAPI.resolveSlackAiOpsContext({
        slackTeamId: message.teamId,
        slackUserId: message.userId,
        slackChannelId: message.channelId,
        chosenProjectId: data.chosenProjectId,
        conversation: SlackProjectChoice.getConversationOf(message),
      });

    // Workspace not connected to any project — nothing we can do.
    if (!context) {
      logger.debug(
        "Slack AI Ops event: workspace not connected to any project.",
        getLogAttributesFromRequest(req as any),
      );
      return;
    }

    // Loop-guard: ignore messages authored by our own bot user id.
    if (context.botUserId && context.botUserId === message.userId) {
      logger.debug(
        "Skipping Slack AI Ops event authored by our bot user.",
        getLogAttributesFromRequest(req as any),
      );
      return;
    }

    /*
     * Extract the question text. Strip mention tokens (for app_mention the
     * leading <@BOTID>) and trim.
     */
    const questionText: string = SlackAPI.cleanSlackMessageText(message.text);

    if (!questionText) {
      logger.debug(
        "Slack AI Ops event has no question text. Skipping.",
        getLogAttributesFromRequest(req as any),
      );
      return;
    }

    /*
     * "help" in the app's direct messages: the commands, for anybody -
     * connected or not, with AI on or off (SlackDirectMessageHelp).
     */
    if (
      message.kind === SlackMessageKind.DirectMessage &&
      SlackDirectMessageHelp.isHelp(questionText)
    ) {
      await SlackDirectMessageHelp.answer({
        projectAuthToken: context.projectAuthToken,
        message: message,
      });
      return;
    }

    /*
     * The workspace is connected to more than one project, and neither the
     * channel nor the asker - nor a choice made earlier in this
     * conversation - tells which: asked which where they see it, only to
     * them, as the Connect prompt is, with a button for each project they
     * are in, and answered in the one they choose (SlackProjectChoice);
     * when that cannot be asked, told how to say which - instead of an
     * answer about a project they may not have meant.
     */
    if (context.ambiguousAnswer) {
      const place: SlackAnswerPlace =
        SlackAiConversations.getConnectPromptPlace({
          message: message,
          projectAuthToken: context.projectAuthToken,
        });

      if (
        context.ambiguousResolution &&
        (await SlackProjectChoice.offer({
          place: place,
          teamId: message.teamId,
          slackUserId: message.userId,
          resolution: context.ambiguousResolution,
          request: {
            kind: SlackProjectChoiceKind.Message,
            message: message,
          },
        })) !== null
      ) {
        return;
      }

      await SlackActionAnswer.answer({
        place: place,
        answer: context.ambiguousAnswer,
      });
      return;
    }

    const slackChannelId: string = message.channelId;
    // The thread the answer goes in: the one it is in, or the one it starts.
    const threadTs: string = SlackAiConversations.getThreadTs(message);

    /*
     * A question asked in a channel, not in a thread, starts a conversation
     * with OneUptime AI in the thread under it, which its asker may reply in
     * without mentioning OneUptime again. An @mention in that thread puts
     * its author in it too, and each follow-up keeps it open. The thread of
     * a notification is never one: there, OneUptime is mentioned each time.
     */
    const asker: SlackThreadPerson = {
      teamId: message.teamId,
      channelId: slackChannelId,
      threadTs: threadTs,
      userId: message.userId,
    };

    if (
      message.kind === SlackMessageKind.ThreadReply ||
      (message.kind === SlackMessageKind.Mention &&
        (!message.threadTs ||
          (await SlackAiConversations.isConversation(asker))))
    ) {
      await SlackAiConversations.remember(asker);
    }

    /*
     * A Slack account not connected to OneUptime: asked to connect it, with
     * the Connect button, and to ask again once they have - where they see
     * it (SlackAiConversations.getConnectPromptPlace), and once in the
     * conversation, not on each message they write there while that button
     * works (SlackConnectPrompt.promptOnce).
     */
    if (!context.userId) {
      const delivery: SlackAnswerDelivery | null =
        await SlackConnectPrompt.promptOnce({
          projectId: context.projectId,
          slackTeamId: message.teamId,
          place: SlackAiConversations.getConnectPromptPlace({
            message: message,
            projectAuthToken: context.projectAuthToken,
          }),
          description: SlackConnectPrompt.describeQuestion(),
          conversation: SlackAiConversations.getConversation(message),
        });

      if (delivery === null) {
        logger.debug(
          "Slack message not answered: its author was asked to connect their Slack account in this conversation already.",
          getLogAttributesFromRequest(req as any),
        );
      }

      return;
    }

    /*
     * The project's AI kill switch, read before we acknowledge — so a
     * project with AI off gets one clear refusal instead of an "on it" that
     * is never followed by anything.
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

    /*
     * The project's own daily AI limits, read before we acknowledge for the
     * same reason: a question refused by a limit would leave "Looking into
     * it…" unanswered.
     */
    const dailyLimitRefusal: string | null =
      await SlackAPI.getDailyLimitRefusal(context.projectId);

    if (dailyLimitRefusal) {
      await SlackUtil.sendMessageToThread({
        authToken: context.projectAuthToken,
        channelId: slackChannelId,
        threadTs: threadTs,
        text: dailyLimitRefusal,
      });
      return;
    }

    /*
     * The project's AI credits, read before we acknowledge for the same
     * reason: a project whose credits are used up - every new one - was
     * told "Please try again in a minute" on every question. This says who
     * can add them, and where (WorkspaceAiRefusal).
     */
    const creditsRefusal: string | null =
      await WorkspaceAiRefusal.getCreditsRefusal(context.projectId);

    if (creditsRefusal) {
      await SlackUtil.sendMessageToThread({
        authToken: context.projectAuthToken,
        channelId: slackChannelId,
        threadTs: threadTs,
        text: creditsRefusal,
      });
      return;
    }

    // What was said before in the thread or the direct message.
    const history:
      | Array<{ role: "user" | "assistant"; content: string }>
      | undefined = await SlackAPI.getConversationHistory({
      req: req,
      message: message,
      projectAuthToken: context.projectAuthToken,
      botUserId: context.botUserId,
    });

    /*
     * Immediate acknowledgement so the user sees we are working. It stands
     * in for the answer only: once the answer is posted it is removed, so a
     * conversation does not keep a "Looking into it…" above every answer.
     */
    let placeholderTs: string | undefined = undefined;

    try {
      placeholderTs = await SlackUtil.sendMessageToThread({
        authToken: context.projectAuthToken,
        channelId: slackChannelId,
        threadTs: threadTs,
        text: SlackAPI.AI_PLACEHOLDER_TEXT,
      });
    } catch (err) {
      logger.error(
        "Error sending Slack AI Ops acknowledgement:",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(err, getLogAttributesFromRequest(req as any));
    }

    try {
      const answerMarkdown: string = await SlackAPI.getAiOpsAnswerMarkdown({
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
    } catch (err) {
      /*
       * The question is answered either way: a "Looking into it…" left
       * on its own reads as an answer still coming.
       */
      logger.error(
        "Could not answer a question to OneUptime AI in Slack:",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(err, getLogAttributesFromRequest(req as any));

      /*
       * A refusal while the answer was written - the last AI credits used
       * up, the day's limit crossed - is said as it is (WorkspaceAiRefusal).
       */
      await SlackUtil.sendMessageToThread({
        authToken: context.projectAuthToken,
        channelId: slackChannelId,
        threadTs: threadTs,
        text:
          WorkspaceAiRefusal.getRefusalMessage(err) || SlackAPI.AI_FAILED_TEXT,
      }).catch((sendError: Error) => {
        logger.error(sendError, getLogAttributesFromRequest(req as any));
      });
    } finally {
      if (placeholderTs) {
        await SlackUtil.deleteMessageBestEffort({
          authToken: context.projectAuthToken,
          channelId: slackChannelId,
          ts: placeholderTs,
        });
      }
    }
  }

  // What stands in for an answer from OneUptime AI while it is written.
  public static readonly AI_PLACEHOLDER_TEXT: string =
    "Looking into it… :hourglass_flowing_sand:";

  // What a question whose answer could not be written is told.
  public static readonly AI_FAILED_TEXT: string =
    "Sorry, I ran into a problem answering that. Please try again in a minute.";

  /*
   * What was said before a question, so a follow-up is answered in context:
   * the thread it is in, or the direct message's recent messages; nothing
   * for a question at the top of a channel. An @mention in a conversation
   * with OneUptime AI started before OneUptime remembered them - its first
   * message a person's question to OneUptime - remembers it, and puts its
   * author in it (SlackAiConversations.remember). Slack not answering is no
   * reason to leave the question unanswered: it is answered without them.
   */
  private static async getConversationHistory(data: {
    req: ExpressRequest;
    message: SlackMessage;
    projectAuthToken: string;
    botUserId: string | undefined;
  }): Promise<
    Array<{ role: "user" | "assistant"; content: string }> | undefined
  > {
    const { message } = data;

    try {
      if (message.kind === SlackMessageKind.DirectMessage) {
        const dmMessages: Array<{
          messageId: string;
          text: string;
          userId?: string;
          username?: string;
          timestamp: Date;
          isBot: boolean;
        }> = await SlackUtil.getChannelMessages({
          channelId: message.channelId,
          authToken: data.projectAuthToken,
          limit: 30,
        });

        return SlackAPI.buildHistoryFromSlackMessages({
          messages: dmMessages.map(
            (dmMessage: {
              messageId: string;
              text: string;
              userId?: string;
              isBot: boolean;
            }) => {
              return {
                user: dmMessage.userId,
                bot_id: dmMessage.isBot ? "bot" : undefined,
                text: dmMessage.text,
                ts: dmMessage.messageId,
              };
            },
          ),
          botUserId: data.botUserId,
          currentMessageTs: message.ts,
        });
      }

      if (!message.threadTs) {
        return undefined;
      }

      const threadMessages: Array<SlackThreadMessage> =
        await SlackUtil.getThreadReplies({
          authToken: data.projectAuthToken,
          channelId: message.channelId,
          threadTs: message.threadTs,
        });

      if (
        message.kind === SlackMessageKind.Mention &&
        SlackAiConversations.isStartedByAQuestion({
          threadTs: message.threadTs,
          messages: threadMessages,
          botUserId: data.botUserId,
        })
      ) {
        await SlackAiConversations.remember({
          teamId: message.teamId,
          channelId: message.channelId,
          threadTs: message.threadTs,
          userId: message.userId,
        });
      }

      return SlackAPI.buildHistoryFromSlackMessages({
        messages: threadMessages,
        botUserId: data.botUserId,
        currentMessageTs: message.ts,
      });
    } catch (err) {
      logger.debug(
        "Could not read what was said before a Slack question; answering it without that.",
        getLogAttributesFromRequest(data.req as any),
      );
      logger.debug(err, getLogAttributesFromRequest(data.req as any));
      return undefined;
    }
  }

  /*
   * Shared "AI Ops" resolution used by both @mentions / DMs (Events API) and
   * the /oneuptime slash command. Resolves the Slack team_id -> OneUptime
   * project, as a press is (WorkspaceProjectResolution: the channel asked
   * in, then the asker's own connections - a workspace can be connected to
   * more than one project), and the Slack user id -> OneUptime user in it.
   * Returns undefined when the workspace is not connected to any OneUptime
   * project at all; ambiguousAnswer when it is connected to several and
   * nothing tells which.
   *
   * `chosenProjectId` is the project the asker chose for the question
   * (SlackProjectChoice); `conversation`, the conversation it is part of,
   * which keeps a project chosen in it for its follow-ups when nothing
   * else tells which.
   */
  private static async resolveSlackAiOpsContext(data: {
    slackTeamId: string;
    slackUserId: string;
    slackChannelId?: string | undefined;
    chosenProjectId?: ObjectID | undefined;
    conversation?: SlackConversationOfPerson | undefined;
  }): Promise<SlackAiOpsContext | undefined> {
    const { slackTeamId, slackUserId } = data;

    if (!slackTeamId) {
      return undefined;
    }

    let resolution: WorkspaceProjectResolution =
      await WorkspaceProjectResolver.resolve({
        workspaceType: WorkspaceType.Slack,
        workspaceId: slackTeamId,
        clues: {
          channelId: data.slackChannelId,
          workspaceUserId: slackUserId,
          drawnForProjectId: data.chosenProjectId,
        },
      });

    /*
     * Nothing tells which, but the asker chose a project earlier in this
     * conversation: a follow-up is answered there too, among the
     * connections already read.
     */
    if (resolution.isAmbiguous && data.conversation) {
      const rememberedProjectId: ObjectID | null =
        await SlackProjectChoice.getConversationProject(data.conversation);

      if (rememberedProjectId) {
        const inRemembered: WorkspaceProjectResolution =
          await WorkspaceProjectResolver.resolveAmong({
            workspaceType: WorkspaceType.Slack,
            connections: resolution.connections,
            clues: {
              drawnForProjectId: rememberedProjectId,
            },
          });

        if (!inRemembered.isAmbiguous && inRemembered.projectAuth) {
          resolution = inRemembered;
        }
      }
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      resolution.projectAuth || resolution.connections[0] || null;

    if (!projectAuth || !projectAuth.projectId || !projectAuth.authToken) {
      return undefined;
    }

    if (resolution.isAmbiguous) {
      return {
        projectId: projectAuth.projectId,
        projectAuthToken: projectAuth.authToken,
        botUserId: (projectAuth.miscData as SlackMiscData)?.botUserId,
        userId: undefined,
        // A question for OneUptime AI: asked again where it can be told apart.
        ambiguousAnswer: await WorkspaceProjectResolver.getAmbiguousAnswer({
          workspaceType: WorkspaceType.Slack,
          resolution: resolution,
          retry: { kind: WorkspaceAmbiguousRetryKind.Question },
        }),
        ambiguousResolution: resolution,
      };
    }

    const projectId: ObjectID = projectAuth.projectId;

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: slackUserId,
          workspaceType: WorkspaceType.Slack,
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

    /*
     * The answer is written from telemetry, which can carry text meant to
     * steer the model, and it is posted to a channel: it stays the Markdown
     * the model wrote, with no mention that notifies anybody, no image, no
     * link whose words hide where it goes and no HTML tag in it
     * (FeedMarkdown.aiWritten). A citation's label is text.
     */
    let answerMarkdown: MarkdownText = FeedMarkdown.aiWritten(
      result.contentInMarkdown || "",
    );

    // Append a compact "Sources" footer from the server-minted citations.
    if (result.citations && result.citations.length > 0) {
      const sourceLines: Array<MarkdownText> =
        WorkspaceAiAnswerSources.getLines(result.citations);

      answerMarkdown = mdText`${answerMarkdown}\n\n*Sources*\n${FeedMarkdown.join(sourceLines, "\n")}`;
    }

    return answerMarkdown.toString();
  }

  /*
   * Removes Slack `<@USER>` / `<@USER|name>` mention tokens and trims the text.
   * Used both to extract the question and to clean history turns.
   */
  public static cleanSlackMessageText(text: string | undefined): string {
    return (text || "")
      .replace(SLACK_USER_MENTION, " ")
      .replace(WHITESPACE_RUN, " ")
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

  /*
   * The same for the project's own daily AI limits (Project Settings → AI
   * Features → More settings): the sentence that says which limit was
   * reached and when AI starts again, or null while there is room. Read
   * before the acknowledgement, like the AI switch.
   */
  private static async getDailyLimitRefusal(
    projectId: ObjectID,
  ): Promise<string | null> {
    const reached: ProjectAiDailyLimitStatus | null =
      await AIService.getReachedProjectDailyLimit({ projectId });

    return reached ? getProjectDailyLimitMessage(reached) : null;
  }
}

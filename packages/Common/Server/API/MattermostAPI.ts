import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import { AppApiClientUrl } from "../EnvironmentConfig";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthToken, {
  MattermostMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../Types/Exception/Exception";
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
import MattermostUtil, {
  MattermostChannel,
  MattermostRequestError,
  MattermostTeam,
  MattermostUser,
} from "../Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../Utils/Workspace/Mattermost/MattermostConnection";
import MattermostActions, {
  MattermostDialogAnswer,
  MattermostPressAnswer,
} from "../Utils/Workspace/Mattermost/MattermostActions";
import UserService from "../Services/UserService";
import ProjectService from "../Services/ProjectService";
import User from "../../Models/DatabaseModels/User";
import Project from "../../Models/DatabaseModels/Project";
import GlobalCache from "../Infrastructure/GlobalCache";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import ProductBrandingText from "../Utils/ProductBrandingText";
import { WorkspacePayloadMarkdown } from "../../Types/Workspace/WorkspaceMessagePayload";

// What a member allowed to connect the project is refused with.
const CONNECT_PERMISSION_MESSAGE: string =
  "You do not have permission to connect this project to Mattermost. Ask a project admin to connect it.";

// What every route that needs the project's connection says without one.
const NOT_CONNECTED_MESSAGE: string =
  "Mattermost is not connected to this project. A project admin connects it under Project Settings → Workspace → Mattermost.";

// How many sign-in links one person may have sent in a while: each is a direct message to somebody.
const SIGN_IN_LINKS_PER_WINDOW: number = 5;
const SIGN_IN_LINK_WINDOW_IN_SECONDS: number = 15 * 60;
const SIGN_IN_LINK_LIMIT_NAMESPACE: string = "mattermost-sign-in-link";

/*
 * MATTERMOST.
 *
 * A project connects to the Mattermost server of its own with a bot account
 * a Mattermost admin made for OneUptime: its access token, and the team of
 * the server OneUptime posts in (POST /mattermost/connect). OneUptime checks
 * the token with the server - whose bot it is, and which teams it is in -
 * before it keeps anything, so a connection names a team only the holder of
 * a working token for it can name.
 *
 * Each member connects their own Mattermost account (POST
 * /mattermost/sign-in-link): Mattermost has no sign-in OneUptime can send
 * people to, so the bot sends the account a direct message with a one-use
 * link, bound to the browser that asked (WorkspaceOAuthState). Opening it
 * there, as the member who asked, proves they hold both accounts; the link's
 * callback (GET /mattermost/auth/user) connects them.
 *
 * Mattermost POSTs presses of the buttons on OneUptime's messages, and the
 * forms they open, to /mattermost/interactive and /mattermost/dialog
 * (MattermostActions), which check what they carry before acting on it.
 */
export default class MattermostAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * What a server address and an access token are: whose bot account, and
     * the teams it is in - for the connect form to offer one. Nothing is
     * kept.
     */
    router.post(
      "/mattermost/teams",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          CommonAPI.assertPermittedInProject({
            databaseProps: databaseProps,
            allowedPermissions:
              WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
            errorMessage: CONNECT_PERMISSION_MESSAGE,
          });

          const typed: { serverUrl: string; accessToken: string } =
            MattermostAPI.readServerAndToken(req.body);

          const bot: MattermostUser = await MattermostAPI.getBot(typed);

          const teams: Array<MattermostTeam> =
            await MattermostUtil.getTeamsOfBot(typed);

          return Response.sendJsonObjectResponse(req, res, {
            bot: {
              username: bot.username,
              displayName: bot.displayName,
              isBot: bot.isBot,
            },
            teams: teams.map((team: MattermostTeam): JSONObject => {
              return {
                id: team.id,
                name: team.name,
                displayName: team.displayName,
              };
            }),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * Connects the project to a team of a Mattermost server, as a bot
     * account: checked with the server first (whose token, which teams), and
     * kept in the server-only authToken (MattermostConnection). A project
     * connected to a team keeps it: connecting another team is refused
     * until the first is disconnected (refreshAuthToken).
     */
    router.post(
      "/mattermost/connect",
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
            errorMessage: CONNECT_PERMISSION_MESSAGE,
          });

          const typed: { serverUrl: string; accessToken: string } =
            MattermostAPI.readServerAndToken(req.body);

          const bot: MattermostUser = await MattermostAPI.getBot(typed);

          const teams: Array<MattermostTeam> =
            await MattermostUtil.getTeamsOfBot(typed);

          const team: MattermostTeam = MattermostAPI.chooseTeam({
            teams: teams,
            teamId: (req.body as JSONObject | undefined)?.["teamId"],
            botUsername: bot.username,
          });

          const miscData: MattermostMiscData = {
            serverUrl: typed.serverUrl,
            teamId: team.id,
            teamName: team.name,
            teamDisplayName: team.displayName || team.name,
            botUserId: bot.id,
            botUsername: bot.username,
          };

          await WorkspaceProjectAuthTokenService.refreshAuthToken({
            projectId: projectId,
            workspaceType: WorkspaceType.Mattermost,
            authToken: MattermostConnection.toAuthToken({
              serverUrl: typed.serverUrl,
              accessToken: typed.accessToken,
              teamId: team.id,
              botUserId: bot.id,
            }),
            workspaceProjectId: team.id,
            miscData: miscData,
          });

          return Response.sendJsonObjectResponse(req, res, {
            teamDisplayName: miscData.teamDisplayName,
            botUsername: miscData.botUsername,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // The channels of the project's team the bot can post in, by name.
    router.get(
      "/mattermost/channels",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          const projectAuth: WorkspaceProjectAuthToken =
            await MattermostAPI.getProjectConnection(projectId);

          const channels: Array<MattermostChannel> =
            await MattermostUtil.listChannels(
              MattermostConnection.fromAuthToken(projectAuth.authToken!),
            );

          return Response.sendJsonObjectResponse(req, res, {
            channels: channels
              .sort((a: MattermostChannel, b: MattermostChannel) => {
                return (a.displayName || a.name).localeCompare(
                  b.displayName || b.name,
                );
              })
              .map((channel: MattermostChannel): JSONObject => {
                return {
                  id: channel.id,
                  name: channel.name,
                  displayName: channel.displayName,
                  isPrivate: channel.type === "P",
                };
              }),
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * Sends a test notification to one channel. Posting into a channel is
     * what a notification rule does, so the test asks what adding a rule
     * asks (TestSendAccess).
     */
    router.post(
      "/mattermost/channels/test",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
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

          await WorkspaceNotificationRuleService.sendTestNotificationToDestination(
            {
              projectId: caller.projectId,
              workspaceType: WorkspaceType.Mattermost,
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

    /*
     * The Mattermost account the calling member most likely has: the one
     * with their email address, when the server lets the bot see email
     * addresses. What the Connect card offers to send the link to. Null when
     * there is none to offer: the member types their username instead.
     */
    router.get(
      "/mattermost/account-suggestion",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          const projectAuth: WorkspaceProjectAuthToken =
            await MattermostAPI.getProjectConnection(projectId);

          const account: MattermostUser | null =
            await MattermostAPI.findAccountByEmail({
              authToken: projectAuth.authToken!,
              userId: props.userId!,
            });

          return Response.sendJsonObjectResponse(req, res, {
            username: account?.username || null,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * Starts connecting the calling member's Mattermost account: the account
     * of the username they typed, or the one with their email address. The
     * bot sends it a direct message with a one-use link to the callback
     * below, recorded for this member and project and bound to this browser
     * (WorkspaceOAuthState). Only the holder of the Mattermost account reads
     * the link, and only this browser can spend it.
     */
    router.post(
      "/mattermost/sign-in-link",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const userId: ObjectID = databaseProps.userId!;

          const projectAuth: WorkspaceProjectAuthToken =
            await MattermostAPI.getProjectConnection(projectId);

          const typedUsername: unknown = (req.body as JSONObject | undefined)?.[
            "username"
          ];

          const account: MattermostUser | null =
            typeof typedUsername === "string" && typedUsername.trim()
              ? await MattermostUtil.findUserByUsername({
                  authToken: projectAuth.authToken!,
                  username: typedUsername,
                })
              : await MattermostAPI.findAccountByEmail({
                  authToken: projectAuth.authToken!,
                  userId: userId,
                });

          if (!account) {
            throw new BadDataException(
              typeof typedUsername === "string" && typedUsername.trim()
                ? "There is no Mattermost account with that username on the project's Mattermost server."
                : "OneUptime could not find a Mattermost account with your email address. Enter your Mattermost username instead.",
            );
          }

          if (account.isBot) {
            throw new BadDataException(
              "That is a bot account. Enter the username of your own Mattermost account.",
            );
          }

          await MattermostAPI.assertMaySendSignInLink(userId);

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.MattermostUserSignIn,
            projectId: projectId,
            userId: userId,
            startPage: ConnectCallbackUtil.readStartPage(
              req.query[CONNECT_START_PAGE_QUERY_PARAM],
            ),
            payload: {
              mattermostUserId: account.id,
              mattermostUsername: account.username,
              teamId: projectAuth.workspaceProjectId || "",
            },
          });

          await MattermostUtil.sendDirectMessageToUser({
            authToken: projectAuth.authToken!,
            workspaceUserId: account.id,
            messageBlocks: [
              await MattermostAPI.getSignInLinkMessage({
                projectId: projectId,
                userId: userId,
                link: `${AppApiClientUrl.toString()}/mattermost/auth/user?state=${encodeURIComponent(state)}`,
              }),
            ],
          });

          return Response.sendJsonObjectResponse(req, res, {
            username: account.username,
          });
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    /*
     * Where the link in the direct message leads: connects the Mattermost
     * account the link was sent to, to the member who asked for it, once
     * the state is spent - in the browser that asked - and the member is
     * asked again whether they are still in the project. The project must
     * still be connected to the team the link was sent from.
     */
    router.get(
      "/mattermost/auth/user",
      ConnectCallback.route({
        provider: ConnectProvider.Mattermost,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req: req,
            state: req.query["state"]?.toString(),
            flows: [WorkspaceOAuthFlow.MattermostUserSignIn],
          });
        },
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return WorkspaceOAuthCallbackAccess.assertStartedByIsMember({
            record: record,
          });
        },
        refusedAs: ConnectCallbackError.NotAMember,
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          const { req, record } = data;

          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(req);

          if (providerError) {
            throw providerError;
          }

          const mattermostUserId: unknown =
            record.payload?.["mattermostUserId"];
          const mattermostUsername: unknown =
            record.payload?.["mattermostUsername"];
          const teamId: unknown = record.payload?.["teamId"];

          if (!MattermostConnection.isMattermostId(mattermostUserId)) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.CouldNotFinish,
              "The Mattermost sign-in link named no Mattermost account.",
            );
          }

          const projectAuth: WorkspaceProjectAuthToken | null =
            await WorkspaceProjectAuthTokenService.findOneBy({
              query: {
                projectId: record.projectId,
                workspaceType: WorkspaceType.Mattermost,
              },
              select: {
                _id: true,
                workspaceProjectId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!projectAuth || projectAuth.workspaceProjectId !== teamId) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.MattermostNotConnected,
              "The project is no longer connected to the Mattermost team the link was sent from.",
            );
          }

          await WorkspaceUserAuthTokenService.refreshAuthToken({
            projectId: record.projectId,
            userId: record.userId,
            workspaceType: WorkspaceType.Mattermost,
            authToken: "",
            workspaceUserId: mattermostUserId,
            miscData: {
              userId: mattermostUserId,
              username:
                typeof mattermostUsername === "string"
                  ? mattermostUsername
                  : "",
            },
          });

          logger.debug(
            "Connected a Mattermost account.",
            getLogAttributesFromRequest(req as any),
          );

          data.backToPage();
        },
      }),
    );

    /*
     * A press of a button or a menu on OneUptime's messages, POSTed by the
     * Mattermost server. Its context is signed by OneUptime and checked
     * before anything is done (MattermostActions). Always answered with what
     * the presser sees, which Mattermost shows to them alone.
     */
    router.post(
      "/mattermost/interactive",
      async (req: ExpressRequest, res: ExpressResponse) => {
        let answer: MattermostPressAnswer;

        try {
          answer = await MattermostActions.handlePress(
            MattermostAPI.readBody(req.body),
          );
        } catch (err) {
          answer = {
            ephemeral_text: MattermostActions.getRefusalMarkdown(err),
          };
        }

        return Response.sendJsonObjectResponse(req, res, answer as JSONObject);
      },
    );

    // The submission of a form a press opened, POSTed by the Mattermost server.
    router.post(
      "/mattermost/dialog",
      async (req: ExpressRequest, res: ExpressResponse) => {
        let answer: MattermostDialogAnswer;

        try {
          answer = await MattermostActions.handleDialogSubmission(
            MattermostAPI.readBody(req.body),
          );
        } catch (err) {
          answer = { error: MattermostActions.getRefusalText(err) };
        }

        return Response.sendJsonObjectResponse(req, res, answer as JSONObject);
      },
    );

    return router;
  }

  private static readBody(body: unknown): JSONObject {
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};
  }

  // The server address and the access token a connect form sent, as OneUptime keeps them.
  public static readServerAndToken(body: unknown): {
    serverUrl: string;
    accessToken: string;
  } {
    const json: JSONObject = MattermostAPI.readBody(body);

    return {
      serverUrl: MattermostConnection.normalizeServerUrl(json["serverUrl"]),
      accessToken: MattermostConnection.normalizeAccessToken(
        json["accessToken"],
      ),
    };
  }

  /*
   * The account a token belongs to - what the server says, or why it would
   * not say: a token it does not take, or a server OneUptime cannot reach.
   */
  private static async getBot(data: {
    serverUrl: string;
    accessToken: string;
  }): Promise<MattermostUser> {
    try {
      return await MattermostUtil.getBotAccount(data);
    } catch (err) {
      if (err instanceof MattermostRequestError && err.statusCode === 401) {
        throw new BadDataException(
          "Mattermost did not accept the access token. Check that you copied the bot account's token, and that it has not been revoked.",
        );
      }

      throw new BadDataException(
        `OneUptime could not reach the Mattermost server: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /*
   * The team a connection posts in: the one picked, which must be one of
   * the bot's - or the bot's only team when none was picked.
   */
  public static chooseTeam(data: {
    teams: Array<MattermostTeam>;
    teamId: unknown;
    botUsername: string;
  }): MattermostTeam {
    if (data.teams.length === 0) {
      throw new BadDataException(
        `The bot account @${data.botUsername} is not a member of any team. Add it to the team OneUptime should post in, in Mattermost, then connect again.`,
      );
    }

    if (
      data.teamId === undefined ||
      data.teamId === null ||
      data.teamId === ""
    ) {
      if (data.teams.length === 1) {
        return data.teams[0]!;
      }

      throw new BadDataException(
        "The bot account is a member of more than one team. Choose the team OneUptime should post in.",
      );
    }

    const team: MattermostTeam | undefined = data.teams.find(
      (candidate: MattermostTeam): boolean => {
        return candidate.id === data.teamId;
      },
    );

    if (!team) {
      throw new BadDataException(
        `The bot account @${data.botUsername} is not a member of that team. Add it to the team in Mattermost, then connect again.`,
      );
    }

    return team;
  }

  // The project's connection to Mattermost, or a refusal saying how to make one.
  public static async getProjectConnection(
    projectId: ObjectID,
  ): Promise<WorkspaceProjectAuthToken> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Mattermost,
      });

    if (!projectAuth || !projectAuth.authToken) {
      throw new BadDataException(NOT_CONNECTED_MESSAGE);
    }

    return projectAuth;
  }

  // The Mattermost account with a member's OneUptime email address, or null.
  private static async findAccountByEmail(data: {
    authToken: string;
    userId: ObjectID;
  }): Promise<MattermostUser | null> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: { email: true },
      props: { isRoot: true },
    });

    const email: string = user?.email?.toString() || "";

    if (!email) {
      return null;
    }

    const account: MattermostUser | null = await MattermostUtil.findUserByEmail(
      {
        authToken: data.authToken,
        email: email,
      },
    );

    return account && !account.isBot ? account : null;
  }

  /*
   * Each link is a direct message to somebody's Mattermost account, so one
   * member may have only a few sent in a while. Without a cache to count
   * them in, a link is sent.
   */
  private static async assertMaySendSignInLink(
    userId: ObjectID,
  ): Promise<void> {
    let count: number | null = 0;

    try {
      count = await GlobalCache.incrementIfBelow(
        SIGN_IN_LINK_LIMIT_NAMESPACE,
        userId.toString(),
        {
          limit: SIGN_IN_LINKS_PER_WINDOW,
          expiresInSeconds: SIGN_IN_LINK_WINDOW_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug("Could not count Mattermost sign-in links.");
      logger.debug(err);
      return;
    }

    if (count === null) {
      throw new BadDataException(
        "You have asked for several Mattermost links in the last few minutes. Use the latest one, or try again in 15 minutes.",
      );
    }
  }

  /*
   * The direct message with the link: who asked for it, in which project,
   * and what to do if it was not them.
   */
  public static async getSignInLinkMessage(data: {
    projectId: ObjectID;
    userId: ObjectID;
    link: string;
  }): Promise<WorkspacePayloadMarkdown> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: { name: true, email: true },
      props: { isRoot: true },
    });

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { name: true },
      props: { isRoot: true },
    });

    const productName: string = ProductBrandingText.getProductName();
    const who: string =
      user?.name?.toString() || user?.email?.toString() || "Somebody";
    const email: string = user?.email?.toString() || "";
    const projectName: string = project?.name || "";

    return {
      _type: "WorkspacePayloadMarkdown",
      text: mdText`🔗 **Connect your Mattermost account to ${productName}**

${who}${email && email !== who ? mdText` (${email})` : ""} asked to connect this Mattermost account to their ${productName} account${projectName ? mdText` in the project ${projectName}` : ""}. Buttons on ${productName}'s messages will then act as them.

[Connect my account](${data.link})

Open the link in the browser where you are signed in to ${productName}. It works once, for 15 minutes. If you did not ask for this, ignore this message: nothing is connected.`.toString(),
    };
  }
}

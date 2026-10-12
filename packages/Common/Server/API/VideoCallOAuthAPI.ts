import {
  ZoomAppClientId,
  ZoomAppWebhookSecretToken,
} from "../EnvironmentConfig";
import VideoCallConnectionService from "../Services/VideoCallConnectionService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import {
  VideoCallOAuthApp,
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
} from "../Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../Utils/VideoCall/OAuth/VideoCallOAuthApps";
import ZoomOAuthEvents, {
  ZOOM_DEAUTHORIZED_EVENT,
  ZOOM_SIGNATURE_HEADER,
  ZOOM_TIMESTAMP_HEADER,
  ZOOM_URL_VALIDATION_EVENT,
  ZoomDeauthorization,
} from "../Utils/VideoCall/OAuth/ZoomOAuthEvents";
import UserMiddleware from "../Middleware/UserAuthorization";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import ConnectCallback, {
  ConnectCallbackFinish,
  ConnectCallbackRefusal,
} from "./ConnectCallback";
import VideoCallConnectAccess, {
  VideoCallConnectStart,
} from "./VideoCallConnectAccess";
import VideoCallConnection from "../../Models/DatabaseModels/VideoCallConnection";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import VideoCallProvider from "../../Types/VideoCall/VideoCallProvider";
import {
  CONNECT_CONNECTED_QUERY_PARAM,
  ConnectCallbackError,
  ConnectProvider,
} from "../../Types/Workspace/ConnectCallback";

/*
 * THE ONE-CLICK CONNECT OF A VIDEO CALL PROVIDER.
 *
 * Project Settings > Video Calls asks a start route for the provider's
 * sign-in URL, sends the browser there, and the provider sends it back to
 * the callback once someone has signed in and allowed OneUptime to create
 * meetings. The callback saves the sign-in as a connection
 * (VideoCallConnectionService.connectWithSignIn) and sends the browser back
 * to the Video Calls page, which offers a test meeting.
 *
 * Each provider has its own start, callback and flow, so a state issued for
 * Zoom is never spent on the Google callback. The rest is the connect
 * framework every Slack, Microsoft Teams and GitHub connection runs on: the
 * project and the person come only from a one-use state the start recorded
 * (WorkspaceOAuthState), the callback asks the start's question again before
 * it writes (VideoCallConnectAccess), and every way it can end is answered
 * on the page with a code (ConnectCallback.route). The redirect URI each
 * provider's app registers is VideoCallOAuthApps.getRedirectUri:
 * https://<host>/api/video-call-oauth/<zoom|google-meet|microsoft-teams>/callback.
 *
 * Zoom also sends events here: someone removing the app from their Zoom
 * account (ZoomOAuthEvents), after which the account's sign-in is deleted
 * from every connection that held it.
 */
export default class VideoCallOAuthAPI {
  // What a connection signed out by the account at Zoom says until it is reconnected.
  public static readonly ZOOM_REMOVED_MESSAGE: string =
    "OneUptime was removed from the Zoom account this connection signed in with, so its sign-in was deleted. Reconnect Zoom in Project Settings > Video Calls to start calls again.";

  /*
   * The last step of a callback, once the provider's own error has been
   * answered: exchanges the code the provider sent back for a sign-in,
   * saves it, and sends the browser back to the Video Calls page naming the
   * connection. Throws a refusal for the page to answer.
   */
  public static async finishConnect(data: {
    finish: ConnectCallbackFinish;
    provider: VideoCallProvider;
  }): Promise<void> {
    const { req, record } = data.finish;

    const app: VideoCallOAuthApp | null = VideoCallOAuthApps.get(data.provider);

    if (!app) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.NotConfigured,
        VideoCallOAuthApps.getNotConfiguredMessage(data.provider),
      );
    }

    const code: string | undefined = req.query["code"]?.toString();

    if (!code) {
      throw new ConnectCallbackRefusal(
        ConnectCallbackError.CouldNotFinish,
        "The provider sent no authorization code back.",
      );
    }

    /*
     * Neither the exchange nor what it answered is logged: the request
     * carries the app's client secret and the code, the answer the tokens.
     */
    let grant: VideoCallOAuthGrant;

    try {
      grant = await app.exchangeCode({
        code,
        redirectUri: VideoCallOAuthApps.getRedirectUri(data.provider),
      });
    } catch (error) {
      if (error instanceof VideoCallOAuthGrantRefusal) {
        throw new ConnectCallbackRefusal(
          error.problem === VideoCallOAuthGrantProblem.WorkAccountRequired
            ? ConnectCallbackError.VideoCallWorkAccountRequired
            : ConnectCallbackError.VideoCallPermissionNotGranted,
          error.message,
        );
      }

      throw error;
    }

    const reconnectId: ObjectID | null =
      VideoCallConnectAccess.getReconnectId(record);

    const connection: VideoCallConnection =
      await VideoCallConnectionService.connectWithSignIn({
        projectId: record.projectId,
        userId: record.userId,
        provider: data.provider,
        grant,
        connectionId: reconnectId || undefined,
      });

    data.finish.backToPage({
      [CONNECT_CONNECTED_QUERY_PARAM]: connection.id?.toString() || "",
    });
  }

  // What a start route answers: the provider's sign-in URL, for a state the start recorded.
  public static getAuthorizationUrl(data: {
    start: VideoCallConnectStart;
    provider: VideoCallProvider;
    state: string;
  }): JSONObject {
    return {
      authorizationUrl: data.start.app.getAuthorizationUrl({
        state: data.state,
        redirectUri: VideoCallOAuthApps.getRedirectUri(data.provider),
      }),
    };
  }

  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * Start connecting Zoom: for a signed-in member who may connect video
     * call providers (or, with ?connectionId=, sign that connection in
     * again), records a one-use state and answers with Zoom's sign-in URL.
     */
    router.get(
      "/video-call-oauth/zoom/authorize-url",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const start: VideoCallConnectStart =
            await VideoCallConnectAccess.assertMayStart({
              req,
              provider: VideoCallProvider.Zoom,
            });

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.VideoCallZoomConnect,
            projectId: start.projectId,
            userId: start.userId,
            payload: start.payload,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            VideoCallOAuthAPI.getAuthorizationUrl({
              start,
              provider: VideoCallProvider.Zoom,
              state,
            }),
          );
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Where Zoom sends the browser back after the sign-in.
    router.get(
      "/video-call-oauth/zoom/callback",
      ConnectCallback.route({
        provider: ConnectProvider.Zoom,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req,
            state: req.query["state"]?.toString(),
            flows: [WorkspaceOAuthFlow.VideoCallZoomConnect],
          });
        },
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return VideoCallConnectAccess.assertMayFinish(record);
        },
        refusedAs: ConnectCallbackError.NoPermission,
        finish: async (finish: ConnectCallbackFinish): Promise<void> => {
          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(finish.req);

          if (providerError) {
            throw providerError;
          }

          await VideoCallOAuthAPI.finishConnect({
            finish,
            provider: VideoCallProvider.Zoom,
          });
        },
      }),
    );

    // Start connecting Google Meet. As for Zoom.
    router.get(
      "/video-call-oauth/google-meet/authorize-url",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const start: VideoCallConnectStart =
            await VideoCallConnectAccess.assertMayStart({
              req,
              provider: VideoCallProvider.GoogleMeet,
            });

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.VideoCallGoogleMeetConnect,
            projectId: start.projectId,
            userId: start.userId,
            payload: start.payload,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            VideoCallOAuthAPI.getAuthorizationUrl({
              start,
              provider: VideoCallProvider.GoogleMeet,
              state,
            }),
          );
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Where Google sends the browser back after the sign-in.
    router.get(
      "/video-call-oauth/google-meet/callback",
      ConnectCallback.route({
        provider: ConnectProvider.GoogleMeet,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req,
            state: req.query["state"]?.toString(),
            flows: [WorkspaceOAuthFlow.VideoCallGoogleMeetConnect],
          });
        },
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return VideoCallConnectAccess.assertMayFinish(record);
        },
        refusedAs: ConnectCallbackError.NoPermission,
        finish: async (finish: ConnectCallbackFinish): Promise<void> => {
          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(finish.req);

          if (providerError) {
            throw providerError;
          }

          await VideoCallOAuthAPI.finishConnect({
            finish,
            provider: VideoCallProvider.GoogleMeet,
          });
        },
      }),
    );

    // Start connecting Microsoft Teams. As for Zoom.
    router.get(
      "/video-call-oauth/microsoft-teams/authorize-url",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const start: VideoCallConnectStart =
            await VideoCallConnectAccess.assertMayStart({
              req,
              provider: VideoCallProvider.MicrosoftTeams,
            });

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.VideoCallMicrosoftTeamsConnect,
            projectId: start.projectId,
            userId: start.userId,
            payload: start.payload,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            VideoCallOAuthAPI.getAuthorizationUrl({
              start,
              provider: VideoCallProvider.MicrosoftTeams,
              state,
            }),
          );
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    // Where Microsoft sends the browser back after the sign-in.
    router.get(
      "/video-call-oauth/microsoft-teams/callback",
      ConnectCallback.route({
        provider: ConnectProvider.MicrosoftTeamsMeetings,
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req,
            state: req.query["state"]?.toString(),
            flows: [WorkspaceOAuthFlow.VideoCallMicrosoftTeamsConnect],
          });
        },
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return VideoCallConnectAccess.assertMayFinish(record);
        },
        refusedAs: ConnectCallbackError.NoPermission,
        finish: async (finish: ConnectCallbackFinish): Promise<void> => {
          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(finish.req);

          if (providerError) {
            throw providerError;
          }

          await VideoCallOAuthAPI.finishConnect({
            finish,
            provider: VideoCallProvider.MicrosoftTeams,
          });
        },
      }),
    );

    /*
     * Zoom's events for this server's Zoom app: the endpoint check when the
     * URL is saved on the app, and app_deauthorized when someone removes the
     * app from their Zoom account - after which Zoom requires their data to
     * be deleted, so every connection signed in as them loses its sign-in.
     * Signed by Zoom with the app's secret token, or refused.
     */
    router.post(
      "/video-call-oauth/zoom/events",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          if (!ZoomAppWebhookSecretToken || !ZoomAppClientId) {
            throw new BadDataException(
              "Zoom events are not set up on this server: ZOOM_APP_CLIENT_ID or ZOOM_APP_WEBHOOK_SECRET_TOKEN is not set.",
            );
          }

          const signedByZoom: boolean = ZoomOAuthEvents.isSignedByZoom({
            secretToken: ZoomAppWebhookSecretToken,
            timestamp: req.headers[ZOOM_TIMESTAMP_HEADER]?.toString(),
            signature: req.headers[ZOOM_SIGNATURE_HEADER]?.toString(),
            rawBody: (req as OneUptimeRequest).rawBody || "",
          });

          if (!signedByZoom) {
            throw new NotAuthorizedException(
              "This event is not signed by Zoom.",
            );
          }

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};
          const event: JSONValue | undefined = body["event"];

          if (event === ZOOM_URL_VALIDATION_EVENT) {
            const payload: JSONValue | undefined = body["payload"];
            const answer: JSONObject | null =
              ZoomOAuthEvents.getUrlValidationAnswer({
                secretToken: ZoomAppWebhookSecretToken,
                plainToken:
                  payload && typeof payload === "object"
                    ? (payload as JSONObject)["plainToken"]
                    : undefined,
              });

            if (!answer) {
              throw new BadDataException(
                "The validation request has no token.",
              );
            }

            return Response.sendJsonObjectResponse(req, res, answer);
          }

          if (event === ZOOM_DEAUTHORIZED_EVENT) {
            const deauthorization: ZoomDeauthorization | null =
              ZoomOAuthEvents.readDeauthorization({
                body,
                clientId: ZoomAppClientId,
              });

            if (deauthorization) {
              const removed: number =
                await VideoCallConnectionService.removeSignIn({
                  provider: VideoCallProvider.Zoom,
                  accountId: deauthorization.userId,
                  reason: VideoCallOAuthAPI.ZOOM_REMOVED_MESSAGE,
                });

              logger.info(
                `Zoom reported OneUptime removed from a Zoom account; signed out ${removed} video call connection(s).`,
                getLogAttributesFromRequest(req as OneUptimeRequest),
              );
            }
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return Response.sendErrorResponse(req, res, err as Exception);
        }
      },
    );

    return router;
  }
}

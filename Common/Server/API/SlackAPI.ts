import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SlackAuthorization from "../Middleware/SlackAuthorization";
import BadRequestException from "../../Types/Exception/BadRequestException";
import logger from "../Utils/Logger";
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
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  PrivateNoteEmojis,
  PublicNoteEmojis,
} from "../Utils/Workspace/Slack/Actions/ActionTypes";

export default class SlackAPI {
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

        const redirectUri: URL = URL.fromString(
          `${AppApiClientUrl.toString()}/slack/auth/${projectId}/${userId}`,
        );

        const requestBody: JSONObject = {
          code: code,
          client_id: SlackAppClientId,
          client_secret: SlackAppClientSecret,
          redirect_uri: redirectUri.toString(),
        };

        logger.debug("Slack Auth Request Body: ");
        logger.debug(requestBody);

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

        logger.debug("Slack Auth Request Body: ");
        logger.debug(responseBody);

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

        const redirectUri: URL = URL.fromString(
          `${AppApiClientUrl.toString()}/slack/auth/${projectId}/${userId}/user`,
        );

        const requestBody: JSONObject = {
          code: code,
          client_id: SlackAppClientId,
          client_secret: SlackAppClientSecret,
          redirect_uri: redirectUri.toString(),
        };

        logger.debug("Slack Auth Request Body: ");
        logger.debug(requestBody);

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

        logger.debug("Slack User Auth Request Body: ");
        logger.debug(responseBody);

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
          logger.debug("Decoded ID Token: ");
          logger.debug(decodedIdToken);
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
          logger.debug("Project Auth: ");
          logger.debug(projectAuth.workspaceProjectId);
          logger.debug("Response Team ID: ");
          logger.debug(idToken["https://slack.com/team_id"]);
          logger.debug("Response User ID: ");
          logger.debug(idToken["https://slack.com/user_id"]);

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
        logger.debug("Slack Interactive Request: ");

        const authResult: SlackRequest = await SlackAuthAction.isAuthorized({
          req: req,
        });

        logger.debug("Slack Interactive Auth Result: ");
        logger.debug(authResult);

        // if slack uninstall app then,
        if (authResult.payloadType === "app_uninstall") {
          logger.debug("Slack App Uninstall Request: ");

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

          logger.debug("Slack App Uninstall Request: Deleted all auth tokens.");
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

    // Fetch and cache all Slack channels for current tenant's project
    router.get(
      "/slack/get-all-channels",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const props: DatabaseCommonInteractionProps =
          await CommonAPI.getDatabaseCommonInteractionProps(req);

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

    // Slack Events API endpoint for handling events like emoji reactions
    router.post(
      "/slack/events",
      SlackAuthorization.isAuthorizedSlackRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug("Slack Events API Request received");
        logger.debug(req.body);

        const payload: JSONObject = req.body;

        // Handle URL verification challenge from Slack
        if (payload["type"] === "url_verification") {
          logger.debug("Slack URL verification challenge received");
          return Response.sendJsonObjectResponse(req, res, {
            challenge: payload["challenge"],
          });
        }

        // Handle event callbacks
        if (payload["type"] === "event_callback") {
          const event: JSONObject = payload["event"] as JSONObject;

          if (!event) {
            logger.debug("No event found in payload");
            return Response.sendTextResponse(req, res, "ok");
          }

          // Handle reaction_added events
          if (event["type"] === "reaction_added") {
            logger.debug("Reaction added event received");

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
            const isSupportedEmoji: boolean =
              PrivateNoteEmojis.includes(reactionData.reaction) ||
              PublicNoteEmojis.includes(reactionData.reaction);

            if (!isSupportedEmoji) {
              logger.debug(
                `Emoji "${reactionData.reaction}" is not supported. Skipping.`,
              );
              return;
            }

            /*
             * Process emoji reactions for Incidents, Alerts, and Scheduled Maintenance
             * Each handler will silently ignore if the channel is not linked to their resource type
             */
            try {
              await SlackIncidentActions.handleEmojiReaction(reactionData);
            } catch (err) {
              logger.error("Error handling incident emoji reaction:");
              logger.error(err);
            }

            try {
              await SlackAlertActions.handleEmojiReaction(reactionData);
            } catch (err) {
              logger.error("Error handling alert emoji reaction:");
              logger.error(err);
            }

            try {
              await SlackAlertEpisodeActions.handleEmojiReaction(reactionData);
            } catch (err) {
              logger.error("Error handling alert episode emoji reaction:");
              logger.error(err);
            }

            try {
              await SlackIncidentEpisodeActions.handleEmojiReaction(reactionData);
            } catch (err) {
              logger.error("Error handling incident episode emoji reaction:");
              logger.error(err);
            }

            try {
              await SlackScheduledMaintenanceActions.handleEmojiReaction(
                reactionData,
              );
            } catch (err) {
              logger.error(
                "Error handling scheduled maintenance emoji reaction:",
              );
              logger.error(err);
            }

            return;
          }
        }

        // For any other event types, just acknowledge
        return Response.sendTextResponse(req, res, "ok");
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
}

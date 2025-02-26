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
import SlackActionType from "../Utils/Workspace/Slack/ActionTypes";
import WorkspaceProjectAuthToken, { SlackMiscData } from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import { WorkspacePayloadMarkdown } from "../../Types/Workspace/WorkspaceMessagePayload";

export default class SlackAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.get(
      "/slack/app-manifest",
      (req: ExpressRequest, res: ExpressResponse) => {
        // return app manifest for slack app
        return Response.sendJsonObjectResponse(req, res, SlackAppManifest);
      },
    );

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
          await API.post(
            URL.fromString("https://slack.com/api/oauth.v2.access"),
            requestBody,
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          );

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

        // ReponseBody is in this format.
        //   {
        //     "ok": true,
        //     "access_token": "sample-token",
        //     "token_type": "bot",
        //     "scope": "commands,incoming-webhook",
        //     "bot_user_id": "U0KRQLJ9H",
        //     "app_id": "A0KRD7HC3",
        //     "team": {
        //         "name": "Slack Pickleball Team",
        //         "id": "T9TK3CUKW"
        //     },
        //     "enterprise": {
        //         "name": "slack-pickleball",
        //         "id": "E12345678"
        //     },
        //     "authed_user": {
        //         "id": "U1234",
        //         "scope": "chat:write",
        //         "access_token": "sample-token",
        //         "token_type": "user"
        //     }
        // }

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

    router.post(
      "/slack/interactive",
      SlackAuthorization.isAuthorizedSlackRequest,
      async (req: ExpressRequest, res: ExpressResponse) => {

        const slackUserId: string | undefined = req.body["user"]["id"];
        const slackTeamId: string | undefined = req.body["team"]["id"];


        // if there are no actions then return.
        if (!req.body["actions"] || req.body["actions"].length === 0) {
          return Response.sendJsonObjectResponse(req, res, {
            response_action: "clear",
          });
        }

        // interaction value. 
        const actionValue: string | undefined = req.body["actions"][0]["value"];
        const actionType: SlackActionType | undefined = req.body["actions"][0]["action_id"] as SlackActionType;
        const slackChannelId: string | undefined = req.body["channel"]["id"];



        const slackMessageId: string | undefined = req.body["message"]["ts"];
        const slackUserName: string | undefined = req.body["user"]["name"];

        const projectAuth: WorkspaceProjectAuthToken | null = await WorkspaceProjectAuthTokenService.findOneBy({
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

        if (!projectAuth) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request"),
          );
        }

        const projectId: ObjectID | undefined = projectAuth.projectId; 

        if(!projectId) {

         return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid request"),
          );

        }

        const userAuth: WorkspaceUserAuthToken | null = await WorkspaceUserAuthTokenService.findOneBy({
          query: {
            workspaceUserId: slackUserId,
            projectId: projectId,
          },
          select: {
            userId: true,
            authToken: true,
          },
          props: {
            isRoot: true,
          },
        });

        const botUserId: string | undefined = (projectAuth.miscData as SlackMiscData)?.botUserId; 


        const userId: ObjectID | undefined = userAuth?.userId;

        if(!userId) {

          const markdwonPayload: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: `${slackUserName}, Unfortunately your slack account is not connected to OneUptime. Please log into your OneUptime account, click on User Settings and connect then your slack account.`,
          }

          await SlackUtil.sendMessage({
            workspaceMessagePayload: {
              _type: "WorkspaceMessagePayload",
              messageBlocks: [
                markdwonPayload
              ],
              channelNames: [],
              channelIds: slackChannelId ? [slackChannelId]: [],  
            },
            authToken: projectAuth.authToken!,
            userId: botUserId,
          })

          // clear response. 
          return Response.sendJsonObjectResponse(req, res, {
            response_action: "clear",
          });
        }

        // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.

        

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

    router.post(
      "/slack/command",
      SlackAuthorization.isAuthorizedSlackRequest,
      (req: ExpressRequest, res: ExpressResponse) => {
        return Response.sendJsonObjectResponse(req, res, {
          response_action: "clear",
        });
      },
    );

    router.post(
      "/slack/events",
      SlackAuthorization.isAuthorizedSlackRequest,
      (req: ExpressRequest, res: ExpressResponse) => {
        // respond to slack challenge

        const body: any = req.body;

        if (body.challenge) {
          return Response.sendJsonObjectResponse(req, res, {
            challenge: body.challenge,
          });
        }

        // if event is "create-incident" then show the incident create modal with title and description and add a button to submit the form.

        if (body.event && body.event.type === "create-incident") {
          return Response.sendJsonObjectResponse(req, res, {
            type: "modal",
            title: {
              type: "plain_text",
              text: "Create Incident",
            },
            blocks: [
              {
                type: "input",
                block_id: "title",
                element: {
                  type: "plain_text_input",
                  action_id: "title",
                  placeholder: {
                    type: "plain_text",
                    text: "Incident Title",
                  },
                },
                label: {
                  type: "plain_text",
                  text: "Title",
                },
              },
              {
                type: "input",
                block_id: "description",
                element: {
                  type: "plain_text_input",
                  action_id: "description",
                  placeholder: {
                    type: "plain_text",
                    text: "Incident Description",
                  },
                },
                label: {
                  type: "plain_text",
                  text: "Description",
                },
              },
              // button
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: "Submit",
                    },
                    style: "primary",
                    value: "submit",
                  },
                ],
              },
            ],
          });
        }

        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Invalid request"),
        );
      },
    );

    return router;
  }
}

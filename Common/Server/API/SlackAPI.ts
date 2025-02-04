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
import { DashboardClientUrl } from "../EnvironmentConfig";
import SlackAppManifest from "../Utils/Slack/app-manifest.json";
import URL from "../../Types/API/URL";


export default class SlackAPI {
  public getRouter(): ExpressRouter {

    const router: ExpressRouter = Express.getRouter();


    router.get("/slack/app-manifest", (req: ExpressRequest, res: ExpressResponse) => {
      // return app manifest for slack app
      return Response.sendJsonObjectResponse(req, res, SlackAppManifest);
    });

    router.get("/slack/auth", (req: ExpressRequest, res: ExpressResponse) => {


      // if there's an error query param. 
      const error: string | undefined = req.query["error"]?.toString();

      const slackIntegrationPageUrl: URL = URL.fromString(DashboardClientUrl.toString() + "/user-settings/slack-integration");

      if(error){
        return Response.redirect(req, res, slackIntegrationPageUrl.addQueryParam("error", error));
      }

      const projectId: string | undefined = req.query["projectId"]?.toString();
      const userId: string | undefined = req.query["userId"]?.toString();

      if(!projectId){
        return Response.sendErrorResponse(req, res, new BadDataException("Invalid ProjectID in request"));
      }

      if(!userId){
        return Response.sendErrorResponse(req, res, new BadDataException("Invalid UserID in request"));
      }

      const requestBody: JSONObject =  req.body;
      logger.debug("Slack Auth Request Body: ");
      logger.debug(requestBody);

      // return back to dashboard after successful auth. 
      Response.redirect(req, res, slackIntegrationPageUrl);
    });

    router.post("/slack/interactive", SlackAuthorization.isAuthorizedSlackRequest,  (req: ExpressRequest, res: ExpressResponse) => {
      return Response.sendJsonObjectResponse(req, res, {
        "response_action": "clear"
      });
    });

    // options load endpoint. 

    router.post("/slack/options-load", SlackAuthorization.isAuthorizedSlackRequest,  (req: ExpressRequest, res: ExpressResponse) => {
      return Response.sendJsonObjectResponse(req, res, {
        "response_action": "clear"
      });
    });

    router.post("/slack/command", SlackAuthorization.isAuthorizedSlackRequest,  (req: ExpressRequest, res: ExpressResponse) => {
      return Response.sendJsonObjectResponse(req, res, {
        "response_action": "clear"
      });
    });


    router.post("/slack/events", SlackAuthorization.isAuthorizedSlackRequest,  (req: ExpressRequest, res: ExpressResponse) => {
     // respond to slack challenge

     const body: any = req.body;

      if (body.challenge) {
        return Response.sendJsonObjectResponse(req, res, {
          challenge: body.challenge,
        })
      }


      // if event is "create-incident" then show the incident create modal with title and description and add a button to submit the form.

      if (body.event && body.event.type === "create-incident") {
        return Response.sendJsonObjectResponse(req, res, {
          "type": "modal",
          "title": {
            "type": "plain_text",
            "text": "Create Incident"
          },
          "blocks": [
            {
              "type": "input",
              "block_id": "title",
              "element": {
                "type": "plain_text_input",
                "action_id": "title",
                "placeholder": {
                  "type": "plain_text",
                  "text": "Incident Title"
                }
              },
              "label": {
                "type": "plain_text",
                "text": "Title"
              }
            },
            {
              "type": "input",
              "block_id": "description",
              "element": {
                "type": "plain_text_input",
                "action_id": "description",
                "placeholder": {
                  "type": "plain_text",
                  "text": "Incident Description"
                }
              },
              "label": {
                "type": "plain_text",
                "text": "Description"
              }
            },
            // button
            {
              "type": "actions",
              "elements": [
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Submit"
                  },
                  "style": "primary",
                  "value": "submit"
                }
              ]
            }
          ]
        });
      }

      return Response.sendErrorResponse(req, res, new BadRequestException("Invalid request"));
    });

    return router;
  }
}

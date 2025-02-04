import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SlackAuthorization from "../Middleware/SlackAuthorization";
import BadRequestException from "../../Types/Exception/BadRequestException";


export default class SlackAPI {
  public getRouter(): ExpressRouter {
    

    const router: ExpressRouter = Express.getRouter();

    router.get("/slack/auth", (_req: ExpressRequest, res: ExpressResponse) => {
      return Response.sendEmptySuccessResponse(_req, res);
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

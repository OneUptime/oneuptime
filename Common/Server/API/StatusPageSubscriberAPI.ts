import StatusPageSubscriberService, {
  Service as StatusPageSubscriberServiceType,
} from "../Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";

export default class StatusPageSubscriberAPI extends BaseAPI<
  StatusPageSubscriber,
  StatusPageSubscriberServiceType
> {
  public constructor() {
    super(StatusPageSubscriber, StatusPageSubscriberService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/unsubscribe/:id`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.service.updateOneBy({
            query: {
              _id: req.params["id"] as string,
            },
            data: {
              isUnsubscribed: true,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          return Response.sendHtmlResponse(
            req,
            res,
            "<html><body><p> You have been unsubscribed.</p><body><html>",
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test-slack-webhook`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          // Validate request body
          if (!req.body.webhookUrl || !req.body.statusPageId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Webhook URL and Status Page ID are required"),
            );
          }

          await this.service.testSlackWebhook({
            webhookUrl: req.body.webhookUrl,
            statusPageId: new ObjectID(req.body.statusPageId),
          });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Test message sent successfully",
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}

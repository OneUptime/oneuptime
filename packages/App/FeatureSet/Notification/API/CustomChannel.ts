import CustomChannelService from "../Services/CustomChannelService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import { CustomChannelDeliveryResult } from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

/*
 * POST /custom-channel/send - a request for a custom channel, from inside the
 * cluster only (CustomNotificationChannelDeliveryService). It names the
 * channel by id; the URL and secret are read here. Answers how it went,
 * whether or not it was delivered, so a test can say so.
 */
router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const channelId: string = String(
        body["customNotificationChannelId"] || "",
      );

      if (!channelId || !ObjectID.isValidUUID(channelId)) {
        throw new BadDataException("`customNotificationChannelId` is required");
      }

      if (!body["eventType"]) {
        throw new BadDataException("`eventType` is required");
      }

      const userOnCallLogTimelineId: string = String(
        body["userOnCallLogTimelineId"] || "",
      );

      const result: CustomChannelDeliveryResult =
        await CustomChannelService.send({
          customNotificationChannelId: new ObjectID(channelId),
          eventType: String(body["eventType"]),
          payload: (body["payload"] as JSONObject) || {},
          isTest: body["isTest"] === true,
          userOnCallLogTimelineId:
            userOnCallLogTimelineId &&
            ObjectID.isValidUUID(userOnCallLogTimelineId)
              ? new ObjectID(userOnCallLogTimelineId)
              : undefined,
        });

      return Response.sendJsonObjectResponse(req, res, {
        ok: result.ok,
        statusCode: result.statusCode || null,
        message: result.message,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;

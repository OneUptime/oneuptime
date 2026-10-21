import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import NetworkTrafficSummaryUtil, {
  ParsedNetworkTrafficRequest,
} from "Common/Server/Utils/NetworkFlow/NetworkTrafficSummary";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { NetworkTrafficSummary } from "Common/Types/NetFlow/NetworkTraffic";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * The Traffic pages' one read: POST /network-traffic/summary - a device's,
 * a site's or the whole network's traffic over a window, narrowed by the
 * page's filters (NetworkTrafficSummaryUtil decides whose flows, and the
 * aggregation service reads them). It replaces the device-only
 * /network-device/flow/top-talkers.
 */
export default class NetworkTrafficAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-traffic/summary",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const now: Date = OneUptimeDate.getCurrentDate();

          const request: ParsedNetworkTrafficRequest =
            NetworkTrafficSummaryUtil.parseRequest(req.body, now);

          const summary: NetworkTrafficSummary =
            await NetworkTrafficSummaryUtil.build({
              props: props,
              request: request,
              now: now,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            summary as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}

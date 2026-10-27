import CallAndSmsGatewayService, {
  CallAndSmsGatewayResult,
} from "../Services/CallAndSmsGatewayService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

/*
 * POST /call-and-sms-gateway/test - a test of the server's SMS and call
 * gateway as saved, from inside the cluster only (CallAndSmsGatewayTest,
 * for a master admin's Send test). The gateway's URL and secret are read
 * here. Answers how it went, whether or not it was delivered, so the test
 * can say so.
 */
router.post(
  "/test",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const result: CallAndSmsGatewayResult =
        await CallAndSmsGatewayService.sendTest();

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

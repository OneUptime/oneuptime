import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";

export default class BearerTokenAuthorization {
  @CaptureSpan()
  public static async isAuthorizedBearerToken(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      req = req as OneUptimeRequest;

      if (req.headers?.["authorization"] || req.headers?.["Authorization"]) {
        let token: string | undefined | Array<string> =
          req.headers["authorization"] || req.headers["Authorization"];
        token = token?.toString().replace("Bearer ", "");
        if (token) {
          const tokenData: JSONObject = JSONWebToken.decodeJsonPayload(token);

          (req as OneUptimeRequest).bearerTokenData = tokenData;

          return next();
        }
      }

      throw new NotAuthorizedException(
        "Invalid bearer token, or bearer token not provided.",
      );
    } catch (err) {
      /*
       * Record on THIS middleware's own @CaptureSpan span before handing the
       * error to Express. The decorator sees a normal return (we call
       * next(err) rather than rethrowing — Express 4 does not catch a
       * rejection from an async middleware), so its recorder never runs and
       * without this the error is invisible on the span it actually belongs
       * to. Goes through SpanUtil so the event is typed by class name rather
       * than by HTTP status, and so a rejected credential produces a `fault`
       * event instead of an Issue.
       */
      SpanUtil.recordExceptionOnCurrentSpan(err);
      next(err);
    }
  }
}

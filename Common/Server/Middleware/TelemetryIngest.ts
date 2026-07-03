import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import ObjectID from "../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../Server/Utils/Express";
import TelemetryIngestionKeyService from "../../Server/Services/TelemetryIngestionKeyService";
import Response from "../Utils/Response";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";

export interface TelemetryRequest extends ExpressRequest {
  projectId: ObjectID; // Project ID
  productType: ProductType; // what is the product type of the request - logs, metrics or traces.
}

export default class TelemetryIngest {
  @CaptureSpan()
  public static async isAuthorizedServiceMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      // check header.

      let oneuptimeToken: string | undefined = req.headers[
        "x-oneuptime-token"
      ] as string | undefined;

      // if x-oneuptime-service-token header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-service-token"] as
          | string
          | undefined;
      }

      // if x-oneuptime-ingestion-key header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-ingestion-key"] as
          | string
          | undefined;
      }

      if (!oneuptimeToken) {
        logger.error(
          "Missing header: x-oneuptime-token",
          getLogAttributesFromRequest(req as any),
        );

        /*
         * 401 is deliberate: the OTLP spec classifies it as
         * non-retryable, so compliant SDKs / collectors surface the
         * error in their own logs instead of retry-storming. A silent
         * 200 here would make the client believe the data landed and
         * leave the user staring at empty dashboards with no clue why.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
          ),
        );
      }

      const projectId: ObjectID | null =
        await TelemetryIngestionKeyService.getProjectIdFromSecretKey(
          oneuptimeToken.toString(),
        );

      if (!projectId) {
        /*
         * Never log the token value — ingestion keys are credentials,
         * and a "wrong environment" mistake would otherwise land a
         * VALID production key verbatim in this log line.
         */
        logger.error(
          "Invalid service token (value redacted).",
          getLogAttributesFromRequest(req as any),
        );

        /*
         * 401 is deliberate (see the missing-token branch above): a
         * silent 200 drops the payload while the client believes the
         * export succeeded. The token value is never logged or echoed.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.",
          ),
        );
      }

      (req as TelemetryRequest).projectId = projectId;

      // Tag span with project context for telemetry ingestion observability
      SpanUtil.addAttributesToCurrentSpan({
        projectId: projectId.toString(),
      });

      next();
    } catch (err) {
      return next(err);
    }
  }
}

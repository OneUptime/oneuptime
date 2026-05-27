import BadRequestException from "../../Types/Exception/BadRequestException";
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

      const isOpenTelemetryAPI: boolean = req.path.includes("/otlp/v1");

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

        if (isOpenTelemetryAPI) {
          /*
           * then accept the response and return success.
           * do not return error because it causes Otel to retry the request.
           */
          return Response.sendEmptySuccessResponse(req, res);
        }

        throw new BadRequestException("Missing header: x-oneuptime-token");
      }

      const projectId: ObjectID | null =
        await TelemetryIngestionKeyService.getProjectIdFromSecretKey(
          oneuptimeToken.toString(),
        );

      if (!projectId) {
        logger.error(
          "Invalid service token: " + oneuptimeToken,
          getLogAttributesFromRequest(req as any),
        );

        if (isOpenTelemetryAPI) {
          /*
           * then accept the response and return success.
           * do not return error because it causes Otel to retry the request.
           */
          return Response.sendEmptySuccessResponse(req, res);
        }

        throw new BadRequestException(
          "Invalid service token: " + oneuptimeToken,
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

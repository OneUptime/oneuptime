import { DisableTelemetryIngestion } from "../EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";

/*
 * Short-circuit middleware for telemetry ingestion routes.
 *
 * When DISABLE_TELEMETRY_INGESTION=true, return a 200 success immediately
 * so OTel / Fluent / Syslog / Pyroscope clients accept the response and do
 * not retry. No body parsing, queueing, or persistence happens — the data
 * is dropped on the floor.
 */
export default class TelemetryIngestionDisabled {
  public static middleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (DisableTelemetryIngestion) {
      return Response.sendEmptySuccessResponse(req, res);
    }
    return next();
  }

  public static isDisabled(): boolean {
    return DisableTelemetryIngestion;
  }
}

import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import HostLogSessionService from "Common/Server/Services/HostLogSessionService";
import AndroidAgentLogSessions, {
  DeviceLogSessionRequest,
} from "Common/Utils/Host/AndroidAgentLogSessions";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * Log sessions (#9806), the Android agent's side: every minute the OneUptime
 * Android agent posts its host name and what became of the sessions it has
 * (asked about, allowed or declined at the device, collecting, ended), with
 * its Server ingestion key in the x-oneuptime-token header, and gets back
 * the sessions open for its device (Common/Utils/Host/AndroidAgentLogSessions,
 * HostLogSessionService.exchangeWithDevice).
 *
 * The key is checked as for every ingest route (TelemetryIngest): a missing,
 * wrong or expired key is 401, a disabled one 422, and a browser key is
 * refused - no page asks for a device's logs.
 */

const router: ExpressRouter = Express.getRouter();

function sendMessage(
  res: ExpressResponse,
  status: number,
  message: string,
): void {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({ message });
}

/*
 * ANDROID_AGENT_LOG_SESSIONS_ROUTE, written out: TelemetryIngestSurfaceWiring
 * reads each ingest route's path beside the surface it names. Mounted under
 * /telemetry and /, it answers where the agent asks, beside OTLP:
 * /telemetry/android-agent/v1/log-sessions.
 */
router.post(
  "/android-agent/v1/log-sessions",
  TelemetryIngest.forSurface(TelemetryIngestSurface.AndroidAgentLogSessions),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const telemetryRequest: TelemetryRequest = req as TelemetryRequest;

      const request: DeviceLogSessionRequest | null =
        AndroidAgentLogSessions.parseRequest(req.body);

      if (!request) {
        return sendMessage(
          res,
          400,
          "Send the device's host name (hostName) and the sessions it has, as JSON.",
        );
      }

      const answer: JSONObject = await HostLogSessionService.exchangeWithDevice(
        {
          projectId: telemetryRequest.projectId,
          request: request,
        },
      );

      res.status(200).json(answer);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

export default router;

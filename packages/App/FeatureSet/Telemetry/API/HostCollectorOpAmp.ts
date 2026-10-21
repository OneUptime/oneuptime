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
import HostCollectorAgent, {
  HostCollectorMessageResult,
} from "Common/Server/Utils/HostCollector/HostCollectorAgent";
import { HOST_COLLECTOR_OPAMP_PATH } from "Common/Types/HostCollector/HostCollector";
import logger from "Common/Server/Utils/Logger";

/*
 * OpAMP over HTTP for the hosts OneUptime manages: the supervisor the host
 * installer puts on a host posts an AgentToServer here every 30 seconds
 * (and whenever something changes), with the project's telemetry ingestion
 * key in the x-oneuptime-token header, and gets a ServerToAgent back - with
 * the host's config when the host needs it (HostCollectorAgent).
 *
 * The key is checked as for every ingest route (TelemetryIngest): a
 * missing, wrong or expired key is 401, a disabled one 422, a browser key
 * is refused. A key pinned to one service is refused here too: a host's
 * collector sends the host's telemetry, not one service's, and pinning was
 * its owner's way to keep the key to that service.
 */

const router: ExpressRouter = Express.getRouter();

/*
 * The most an AgentToServer may be. OneUptime's installers do not ask for
 * the collector's effective config or its component list, so a message is
 * a few kilobytes; this leaves room for a long error message.
 */
export const MAX_OPAMP_MESSAGE_BYTES: number = 1024 * 1024;

const PROTOBUF_CONTENT_TYPE: string = "application/x-protobuf";

function sendText(res: ExpressResponse, status: number, message: string): void {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({ message });
}

router.post(
  HOST_COLLECTOR_OPAMP_PATH,
  TelemetryIngest.forSurface(TelemetryIngestSurface.HostCollectorManagement),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const telemetryRequest: TelemetryRequest = req as TelemetryRequest;

      if (telemetryRequest.ingestionKeyPolicy?.pinnedServiceName) {
        return sendText(
          res,
          422,
          "This telemetry ingestion key is pinned to a single service, so it cannot manage a host's collector: a host sends the host's telemetry, not one service's. Use an unpinned server ingestion key.",
        );
      }

      const body: unknown = req.body;

      if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
        return sendText(
          res,
          415,
          `Send an OpAMP AgentToServer message as ${PROTOBUF_CONTENT_TYPE}.`,
        );
      }

      if (body.length > MAX_OPAMP_MESSAGE_BYTES) {
        return sendText(
          res,
          413,
          `An OpAMP message may not exceed ${MAX_OPAMP_MESSAGE_BYTES} bytes.`,
        );
      }

      const result: HostCollectorMessageResult =
        await HostCollectorAgent.handleMessage({
          projectId: telemetryRequest.projectId,
          body: body,
        });

      res
        .status(result.isBadRequest ? 400 : 200)
        .setHeader("Content-Type", PROTOBUF_CONTENT_TYPE);
      res.end(Buffer.from(result.body));
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

export default router;

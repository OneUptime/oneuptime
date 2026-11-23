import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import HostCollectorAgent, {
  HostCollectorMessageResult,
} from "Common/Server/Utils/HostCollector/HostCollectorAgent";
import logger from "Common/Server/Utils/Logger";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import {
  OPAMP_MESSAGE_MAX_BYTES,
  OPAMP_REQUEST_BODY_LIMIT,
} from "Common/Server/Utils/RequestBodyLimit";
import { createTooLargeError } from "Common/Server/Utils/RequestBodyRefusal";

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
 * The most an AgentToServer may be, 1 MiB (RequestBodyLimit's
 * OPAMP_MESSAGE_MAX_BYTES, which says why): the route's reader holds the
 * body to it (#10770).
 */
export const MAX_OPAMP_MESSAGE_BYTES: number = OPAMP_MESSAGE_MAX_BYTES;

const PROTOBUF_CONTENT_TYPE: string = "application/x-protobuf";

function sendText(res: ExpressResponse, status: number, message: string): void {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({ message });
}

/*
 * HOST_COLLECTOR_OPAMP_ROUTE, written out: TelemetryIngestSurfaceWiring reads
 * each ingest route's path beside the surface it names. Mounted under
 * /telemetry and /, it answers at the address the installers write
 * (HOST_COLLECTOR_OPAMP_PATH, /telemetry/opamp/v1) and at /opamp/v1, where
 * hosts installed before still ask.
 *
 * The message is read once the key is right (#10702): StartServer leaves
 * the body unread (RequestBodyLimit), and nothing of it is read or
 * inflated for a request without the right key, which the supervisor sends
 * in x-oneuptime-token. Protobuf, kept as its bytes, gzip-compressed or not,
 * held to an OpAMP message's own 1 MiB (#10770): a body over it is refused
 * 413 with no more of it read - unread when its size is declared, at 1 MiB
 * when chunked, as it inflates past 1 MiB when gzip-compressed - in the
 * words every route's reader refuses a body over its limit with. It was held
 * to a large route's 50 MB, all of it read or inflated before the 413.
 */
const readAgentToServer: RequestHandler =
  RequestBodyAfterAuthentication.readBody(OPAMP_REQUEST_BODY_LIMIT);

router.post(
  "/opamp/v1",
  TelemetryIngest.forSurface(
    TelemetryIngestSurface.HostCollectorManagement,
    readAgentToServer,
  ),
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

      /*
       * The reader held the body to the limit. One read before it - by
       * something mounted ahead of this route - is held here, refused in the
       * reader's words.
       */
      if (body.length > MAX_OPAMP_MESSAGE_BYTES) {
        return next(createTooLargeError(MAX_OPAMP_MESSAGE_BYTES, body.length));
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

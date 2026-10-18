import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import OneUptimeDate from "Common/Types/Date";

const router: ExpressRouter = Express.getRouter();

const processIncomingRequest: RequestHandler = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    // The moment OneUptime received this heartbeat, before any queueing.
    const receivedAt: Date = OneUptimeDate.getCurrentDate();

    /*
     * Every header the sender sent but the two OneUptime's own services
     * prove themselves with: the monitor's request is the project's to read.
     */
    const requestHeaders: Dictionary<string> =
      ClusterKeyAuthorization.withoutClusterKeyHeaders(
        req.headers,
      ) as Dictionary<string>;
    const requestBody: string | JSONObject = req.body as string | JSONObject;

    const monitorSecretKeyAsString: string | undefined =
      req.params["secretkey"];

    if (!monitorSecretKeyAsString) {
      throw new BadDataException("Invalid Secret Key");
    }

    const probeIdHeader: string | undefined = (
      requestHeaders["oneuptime-probe-id"] ||
      requestHeaders["OneUptime-Probe-Id"]
    )?.toString();

    // Return response immediately
    Response.sendEmptySuccessResponse(req, res);

    /*
     * Record the arrival now, not when a worker gets to the job: the
     * heartbeat cron judges liveness from this, so a Telemetry backlog (or a
     * coalesced request that is never processed on its own) cannot make a
     * live sender look silent. Best effort - never throws.
     */
    await IncomingRequestReceivedAtStore.advanceIfTracked({
      secretKey: monitorSecretKeyAsString,
      receivedAt: receivedAt,
    });

    // Add to queue for asynchronous processing
    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey: monitorSecretKeyAsString,
      requestHeaders: requestHeaders,
      requestBody: requestBody,
      requestMethod: req.method,
      receivedViaProbeId: probeIdHeader,
      receivedAt: receivedAt,
    });

    return;
  } catch (err) {
    return next(err);
  }
};

router.post(
  "/incoming-request/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    processIncomingRequest(req, res, next);
  },
);

router.get(
  "/incoming-request/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    processIncomingRequest(req, res, next);
  },
);

export default router;

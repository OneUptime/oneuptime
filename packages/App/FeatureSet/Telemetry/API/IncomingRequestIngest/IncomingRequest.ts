import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
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
import IncomingRequestSecretGate, {
  IncomingRequestSecretEdgeDecision,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretGate";
import IncomingRequestSecretRequest, {
  PresentedIncomingRequestSecrets,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretRequest";
import PlainTextJsonBody from "Common/Server/Middleware/PlainTextJsonBody";
import OneUptimeDate from "Common/Types/Date";

const router: ExpressRouter = Express.getRouter();

/*
 * The largest text/plain body read: the JSON parser's own limit
 * (StartServer's jsonBodyParserOptions), and nginx's for /heartbeat.
 */
export const TEXT_BODY_LIMIT: string = "50mb";

/*
 * JSON sent as text/plain - how Amazon SNS posts its subscription
 * confirmations and notifications - is read as the JSON it is; any other
 * text stays empty (PlainTextJsonBody). The JSON and form parsers
 * StartServer runs for every route have read every other body by now.
 */
const readTextBody: RequestHandler =
  PlainTextJsonBody.getReader(TEXT_BODY_LIMIT);

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
     * And without X-OneUptime-Secret, the project's incoming request secret,
     * which is checked here and never travels further: what is queued is the
     * SHA-256 of each secret the request presented.
     */
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets(
        ClusterKeyAuthorization.withoutClusterKeyHeaders(
          req.headers,
        ) as Dictionary<string>,
      );

    const requestHeaders: Dictionary<string> = presented.requestHeaders;
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

    /*
     * A project that requires an incoming request secret refuses a request
     * without one here, with 401 and what to send, before anything about it
     * is recorded (IncomingRequestSecretGate). A request the endpoint cannot
     * place in a project goes on, and the worker decides.
     */
    const secretDecision: IncomingRequestSecretEdgeDecision =
      await IncomingRequestSecretGate.decideAtEdge({
        secretKey: monitorSecretKeyAsString,
        presentedSecretHashes: presented.secretHashes,
      });

    if (secretDecision.refusalMessage) {
      throw new NotAuthenticatedException(secretDecision.refusalMessage);
    }

    // Return response immediately
    Response.sendEmptySuccessResponse(req, res);

    /*
     * Record the arrival now, not when a worker gets to the job: the
     * heartbeat cron judges liveness from this, so a Telemetry backlog (or a
     * coalesced request that is never processed on its own) cannot make a
     * live sender look silent. Best effort - never throws. Only once the
     * request is known to count: one the endpoint could not check against
     * its project's secret requirement is recorded by the worker, if the
     * worker accepts it.
     */
    if (secretDecision.mayRecordArrival) {
      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: monitorSecretKeyAsString,
        receivedAt: receivedAt,
      });
    }

    // Add to queue for asynchronous processing
    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey: monitorSecretKeyAsString,
      requestHeaders: requestHeaders,
      requestBody: requestBody,
      requestMethod: req.method,
      receivedViaProbeId: probeIdHeader,
      receivedAt: receivedAt,
      presentedSecretHashes: presented.secretHashes,
    });

    return;
  } catch (err) {
    return next(err);
  }
};

router.post(
  "/incoming-request/:secretkey",
  readTextBody,
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
  readTextBody,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    processIncomingRequest(req, res, next);
  },
);

export default router;

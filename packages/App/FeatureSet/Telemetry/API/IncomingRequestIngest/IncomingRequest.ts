import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import { JSONObject } from "Common/Types/JSON";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestSecretGate, {
  IncomingRequestSecretEdgeDecision,
  IncomingRequestSecretRefusalKind,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretGate";
import IncomingRequestSecretRequest, {
  PresentedIncomingRequestSecrets,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretRequest";
import IncomingRequestSignature from "Common/Server/Utils/Monitor/IncomingRequestSignature";
import WebhookRequestBody from "Common/Server/Middleware/WebhookRequestBody";
import WebhookVerification, {
  WebhookVerificationAnswer,
} from "Common/Server/Utils/WebhookVerification";
import OneUptimeDate from "Common/Types/Date";

const router: ExpressRouter = Express.getRouter();

/*
 * The largest text/plain or +json body read: the JSON parser's own limit
 * (StartServer's jsonBodyParserOptions), and nginx's for /heartbeat.
 */
export const TEXT_BODY_LIMIT: string = "50mb";

// What a request that could not be queued for its monitor is answered, 503.
export const INCOMING_REQUEST_NOT_QUEUED_MESSAGE: string =
  "This request could not be queued for its monitor. Send it again.";

/*
 * A text/plain body is read as the JSON object or array it holds - how
 * Amazon SNS posts its subscription confirmations and notifications - else
 * as the text it is; a +json body, such as Azure Event Grid's CloudEvents,
 * as its JSON (WebhookRequestBody). The JSON and form parsers StartServer
 * runs for every route have read every other body by now.
 */
const readTextBody: RequestHandler =
  WebhookRequestBody.getReader(TEXT_BODY_LIMIT);

/*
 * A signed request's body of any other type - which the monitor gets empty,
 * as before - is read only to check its signature over (issue #8500).
 */
const readSignedBody: RequestHandler = WebhookRequestBody.getSignedBodyReader(
  TEXT_BODY_LIMIT,
  (req: ExpressRequest): boolean => {
    return (
      IncomingRequestSignature.readPresentedSignatures(
        req.headers as Dictionary<string | Array<string> | undefined>,
      ).length > 0
    );
  },
);

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
     * SHA-256 of each secret the request presented. A signature of the body
     * (issue #8500) is checked here too, and is masked in what is queued, so
     * nobody who reads the request can send it again.
     */
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets(
        ClusterKeyAuthorization.withoutClusterKeyHeaders(
          req.headers,
        ) as Dictionary<string>,
      );

    const requestHeaders: Dictionary<string> =
      IncomingRequestSignature.withoutSignatures(presented.requestHeaders);
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
     * A service checking this URL before it delivers to it - Azure Event
     * Grid, Slack, Microsoft Graph, Okta, a CloudEvents sender - expects its
     * own answer, not the empty one (WebhookVerification, issue #8429).
     */
    const verification: WebhookVerificationAnswer | null =
      WebhookVerification.recognize(WebhookVerification.readRequest(req));

    /*
     * A project that requires an incoming request secret refuses a request
     * without one here, with 401 and what to send, before anything about it
     * is recorded (IncomingRequestSecretGate). A request the endpoint cannot
     * place in a project goes on, and the worker decides - but for a
     * handshake, whose key the endpoint looks up whatever it is: it answers
     * one only for a monitor's key, and only once the requirement lets it
     * through.
     */
    const secretDecision: IncomingRequestSecretEdgeDecision =
      await IncomingRequestSecretGate.decideAtEdge({
        secretKey: monitorSecretKeyAsString,
        presentedSecretHashes: presented.secretHashes,
        placeUntrackedKey: Boolean(verification),
        req: req,
        requestHeaders: presented.requestHeaders,
        signedBody: IncomingRequestSignature.getSignedBodyOf(
          req as OneUptimeRequest,
        ),
      });

    /*
     * A client that sent this monitor too many different wrong secrets is
     * refused with 429, and when it may try again (issue #8499).
     */
    if (
      secretDecision.refusalMessage &&
      secretDecision.refusalKind ===
        IncomingRequestSecretRefusalKind.TooManyWrongSecrets
    ) {
      if (typeof res.setHeader === "function") {
        res.setHeader(
          "Retry-After",
          String(secretDecision.retryAfterSeconds || 1),
        );
      }

      throw new TooManyRequestsException(secretDecision.refusalMessage);
    }

    if (secretDecision.refusalMessage) {
      throw new NotAuthenticatedException(secretDecision.refusalMessage);
    }

    /*
     * A handshake is answered with what its service expects, any other
     * request with the empty body it always got.
     */
    const answeredVerification: WebhookVerificationAnswer | null =
      verification && secretDecision.mayRecordArrival ? verification : null;

    /*
     * A CloudEvents validation (OPTIONS) is the subscription asking, not a
     * request for the monitor: it is answered, and neither counts as a
     * heartbeat nor reaches the criteria. Every other request does, a
     * handshake included, as it always has.
     */
    const isForTheMonitor: boolean = req.method !== "OPTIONS";

    /*
     * Queued before it is answered, for the worker to evaluate. Then a
     * request the sender sends once this one was answered - a reset after
     * its trigger - is queued after it, and its monitor evaluates the two in
     * that order (IncomingRequestPendingStore). And one that cannot be queued
     * is answered 503, for the sender to send again, rather than 200 and
     * lost.
     */
    if (isForTheMonitor) {
      try {
        await TelemetryQueueService.addIncomingRequestIngestJob({
          secretKey: monitorSecretKeyAsString,
          requestHeaders: requestHeaders,
          requestBody: requestBody,
          requestMethod: req.method,
          receivedViaProbeId: probeIdHeader,
          receivedAt: receivedAt,
          /*
           * A signature checked here presents the secret it was made with:
           * the worker decides on it with the rest.
           */
          presentedSecretHashes: secretDecision.signedWithSecretHash
            ? Array.from(
                new Set<string>([
                  ...presented.secretHashes,
                  secretDecision.signedWithSecretHash,
                ]),
              )
            : presented.secretHashes,
          signatureProblem: secretDecision.signatureProblem,
          /*
           * The monitor learns its service was answered, and offers no link
           * to confirm by hand. Not for a request a probe relayed: the probe
           * has answered its sender itself, with the empty body.
           */
          answeredVerification:
            answeredVerification && !probeIdHeader
              ? answeredVerification.provider
              : undefined,
        });
      } catch {
        // What failed is logged where it failed (TelemetryQueueService).
        throw new ServiceUnavailableException(
          INCOMING_REQUEST_NOT_QUEUED_MESSAGE,
        );
      }
    }

    if (answeredVerification) {
      WebhookVerification.send(res, answeredVerification);
    } else {
      Response.sendEmptySuccessResponse(req, res);
    }

    if (!isForTheMonitor) {
      return;
    }

    /*
     * Record the arrival now, not when a worker gets to the job: the
     * heartbeat cron judges liveness from this, so a Telemetry backlog (or a
     * request the monitor does not evaluate on its own) cannot make a live
     * sender look silent. Best effort - never throws. Only once the request
     * is known to count: one the endpoint could not check against its
     * project's secret requirement is recorded by the worker, if the worker
     * accepts it.
     */
    if (secretDecision.mayRecordArrival) {
      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: monitorSecretKeyAsString,
        receivedAt: receivedAt,
      });
    }

    return;
  } catch (err) {
    return next(err);
  }
};

router.post(
  "/incoming-request/:secretkey",
  readTextBody,
  readSignedBody,
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
  readSignedBody,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    processIncomingRequest(req, res, next);
  },
);

/*
 * Only a CloudEvents validation reaches this: StartServer's CORS middleware
 * answers every other OPTIONS request itself.
 */
router.options(
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

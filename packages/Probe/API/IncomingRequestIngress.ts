import {
  ONEUPTIME_BASE_URL,
  PROBE_INGRESS_FORWARD_RETRY_LIMIT,
  PROBE_INGRESS_FORWARD_TIMEOUT_MS,
} from "../Config";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import ProbeUtil from "../Utils/Probe";
import Express, {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  ExpressUrlEncoded,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  createExpressApp,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import RequestBodyJson from "Common/Server/Utils/RequestBodyJson";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";
import WebhookRequestBody from "Common/Server/Middleware/WebhookRequestBody";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Headers from "Common/Types/API/Headers";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { carriesIncomingRequestSignature } from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import API, { APIRequestBody } from "Common/Utils/API";
import BadDataException from "Common/Types/Exception/BadDataException";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

const HOP_BY_HOP_HEADERS: Set<string> = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

/*
 * Content-Encoding describes the body as it arrived. The listener inflates a
 * gzip or deflate body while it parses it, and the forward sends the parsed
 * body, uncompressed - so a copied "Content-Encoding: gzip" would make
 * OneUptime try to gunzip plain JSON, refuse the request, and the heartbeat
 * would be retried and then dropped.
 */
const BODY_ENCODING_HEADERS: Set<string> = new Set(["content-encoding"]);

// The largest body the listener reads: OneUptime's own limit.
export const INGRESS_BODY_LIMIT: string = "50mb";

function buildForwardHeaders(
  incoming: Dictionary<string | string[] | undefined>,
): Headers {
  const headers: Headers = {};
  for (const key of Object.keys(incoming)) {
    if (
      HOP_BY_HOP_HEADERS.has(key.toLowerCase()) ||
      BODY_ENCODING_HEADERS.has(key.toLowerCase())
    ) {
      continue;
    }
    const value: string | string[] | undefined = incoming[key];
    if (value === undefined) {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

/*
 * Where a forwarded request goes: the App's incoming-request route under its
 * "/incoming-request-ingest" prefix. The bare "/incoming-request/<key>" is
 * served by the App too, but nginx has no location for it: on an
 * installation with billing on, such as OneUptime Cloud, its catch-all
 * sends that path to the marketing site, which answers 404, so every
 * forward failed. "/incoming-request-ingest" is routed to the App by nginx
 * on every installation, and the App mounts the router under it as well, so
 * the same path also works for a probe whose ONEUPTIME_URL names the App
 * directly (the Helm chart's own probes). The public "/heartbeat" path would
 * not: nginx rewrites it, and the App itself does not serve it.
 */
export function getForwardUrl(secretKey: string): URL {
  return URL.fromString(ONEUPTIME_BASE_URL.toString())
    .addRoute("/incoming-request-ingest")
    .addRoute("/incoming-request")
    .addRoute(`/${secretKey}`);
}

/*
 * The body the probe forwards: the JSON or form it parsed, or - for a
 * text/plain or +json body - the bytes that came, which OneUptime reads with
 * the request's own Content-Type, exactly as it would have read them
 * directly (a text as its text, JSON sent as text as its JSON).
 *
 * A signed request's body (carriesIncomingRequestSignature) is always the
 * bytes that came, whatever its type, or none when it came without one: its
 * signature was made over those bytes (issue #8500), and a body parsed and
 * sent on re-encoded - JSON with other spacing, a form in another order - or
 * an empty one sent on as "{}" would no longer match it, so OneUptime would
 * refuse the request.
 */
export function getRequestBody(req: ExpressRequest): APIRequestBody {
  if (
    carriesIncomingRequestSignature(
      req.headers as Dictionary<string | Array<string> | undefined>,
    )
  ) {
    return getSignedRequestBody(req);
  }

  const body: unknown = req.body;
  if (body === undefined || body === null) {
    return {};
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    return Buffer.from(body, "utf8");
  }
  if (Array.isArray(body)) {
    return body as JSONArray;
  }
  if (typeof body === "object") {
    return body as JSONObject;
  }
  return Buffer.from(String(body), "utf8");
}

/*
 * A signed request's bytes: kept while its JSON or form was parsed
 * (keepSignedBodyBytes), read as they are for any other type
 * (WebhookRequestBody.getSignedBodyReader), or the text body as it came.
 */
function getSignedRequestBody(req: ExpressRequest): Buffer {
  const bytes: Buffer | undefined = (req as OneUptimeRequest).rawBodyBytes;

  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  return Buffer.alloc(0);
}

// While a JSON or form body is parsed: a signed one's bytes, for the forward.
const keepSignedBodyBytes: (
  req: ExpressRequest,
  res: ExpressResponse,
  buf: Buffer,
) => void = (req: ExpressRequest, _res: ExpressResponse, buf: Buffer): void => {
  if (
    carriesIncomingRequestSignature(
      req.headers as Dictionary<string | Array<string> | undefined>,
    )
  ) {
    (req as OneUptimeRequest).rawBodyBytes = buf;
  }
};

/*
 * A JSON body, before it is parsed: counted against what OneUptime reads on
 * an incoming request monitor's route (LARGE_REQUEST_BODY_LIMIT), as
 * OneUptime counts it (#10183). The listener is reached before anything is
 * checked, and JSON.parse made 17 million empty arrays of 50 MB of "[],";
 * a body OneUptime would refuse is refused here, with 413, before it is.
 */
const countJsonAndKeepSignedBodyBytes: (
  req: ExpressRequest,
  res: ExpressResponse,
  buf: Buffer,
  encoding?: string,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  buf: Buffer,
  encoding?: string,
): void => {
  if (!RequestBodyJson.isUtf8(encoding)) {
    throw RequestBodyJson.createCharsetUnsupportedError(encoding || "");
  }

  RequestBodyJson.assertWithinLimit(buf, LARGE_REQUEST_BODY_LIMIT);
  keepSignedBodyBytes(req, res, buf);
};

const isSignedRequest: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  return carriesIncomingRequestSignature(
    req.headers as Dictionary<string | Array<string> | undefined>,
  );
};

/*
 * Whether OneUptime's answer to a forward is a refusal it would give again:
 * a 4xx says the request itself is wrong - a project's incoming request
 * secret missing or not one of its own (401), a body too large (413) - and
 * sending the same request again cannot change that, it only keeps the probe
 * busy through every backoff. A timeout (408) and rate limiting (429) are
 * about the moment, not the request, so they are retried, with every 5xx.
 */
export function isRefusalNotWorthRetrying(statusCode: number): boolean {
  return (
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 429
  );
}

async function forwardWithRetry(
  forwardUrl: URL,
  method: HTTPMethod,
  data: APIRequestBody,
  headers: Headers,
): Promise<void> {
  let attempt: number = 0;
  while (attempt <= PROBE_INGRESS_FORWARD_RETRY_LIMIT) {
    try {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method,
          url: forwardUrl,
          data,
          headers,
          options: ProbeAPIRequest.getDefaultRequestOptions(forwardUrl, {
            timeout: PROBE_INGRESS_FORWARD_TIMEOUT_MS,
          }),
        });

      if (result instanceof HTTPErrorResponse) {
        if (isRefusalNotWorthRetrying(result.statusCode)) {
          logger.warn(
            `Probe ingress: OneUptime refused the request forwarded to ${forwardUrl.toString()} with ${result.statusCode}, and would refuse it again, so it is not retried. ${result.message}`,
          );
          return;
        }

        throw result;
      }

      return;
    } catch (err) {
      attempt++;
      if (attempt > PROBE_INGRESS_FORWARD_RETRY_LIMIT) {
        logger.error(
          `Probe ingress: failed to forward to ${forwardUrl.toString()} after ${attempt} attempts`,
        );
        logger.error(err);
        return;
      }
      const backoffMs: number = Math.min(2000 * 2 ** (attempt - 1), 15000);
      logger.warn(
        `Probe ingress: forward to ${forwardUrl.toString()} failed (attempt ${attempt}), retrying in ${backoffMs}ms`,
      );
      await Sleep.sleep(backoffMs);
    }
  }
}

const forwardToOneUptime: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  try {
    const secretKey: string | undefined = req.params["secretkey"];
    if (!secretKey) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Secret Key"),
      );
      return;
    }

    const forwardUrl: URL = getForwardUrl(secretKey);

    const headers: Headers = buildForwardHeaders(
      req.headers as Dictionary<string | string[] | undefined>,
    );

    let probeIdHeaderValue: string | undefined = undefined;
    try {
      probeIdHeaderValue = ProbeUtil.getProbeId().toString();
      headers["OneUptime-Probe-Id"] = probeIdHeaderValue;
    } catch {
      logger.warn(
        "Probe ingress: probe ID not available, forwarding without it",
      );
    }

    const method: HTTPMethod =
      req.method === "POST" ? HTTPMethod.POST : HTTPMethod.GET;
    const data: APIRequestBody = getRequestBody(req);

    Response.sendEmptySuccessResponse(req, res);

    forwardWithRetry(forwardUrl, method, data, headers).catch(
      (err: unknown) => {
        logger.error("Probe ingress: unexpected forward error");
        logger.error(err);
      },
    );
  } catch (err) {
    return next(err);
  }
};

router.post("/incoming-request/:secretkey", forwardToOneUptime);
router.get("/incoming-request/:secretkey", forwardToOneUptime);
router.post("/heartbeat/:secretkey", forwardToOneUptime);
router.get("/heartbeat/:secretkey", forwardToOneUptime);

/*
 * The listener's own app, on its own port. It reads the bodies OneUptime
 * reads - JSON and forms, parsed, and text/plain and +json bodies, kept as
 * the bytes that came, which OneUptime reads as it reads them (a text as its
 * text, JSON sent as text/plain, as Amazon SNS sends it, as its JSON) - up
 * to the same 50 MB, and nothing else, so a request through the probe
 * reaches the monitor as it would have directly: any other body arrives
 * empty, whatever its size. (It used to read application/octet-stream bodies
 * too, under express.raw's 100 KB default, which answered a larger one with
 * 413 instead of the promised 200; and OneUptime drops such a body anyway.)
 *
 * A signed request's body is also kept as the bytes that came, whatever its
 * type, up to the same 50 MB, and forwarded as those bytes (getRequestBody),
 * so its signature still holds when OneUptime checks it.
 */
export function createIngressApp(): ExpressApplication {
  const app: ExpressApplication = createExpressApp();
  app.use(
    ExpressJson({
      limit: INGRESS_BODY_LIMIT,
      verify: countJsonAndKeepSignedBodyBytes,
    }),
  );
  app.use(
    ExpressUrlEncoded({
      extended: true,
      limit: INGRESS_BODY_LIMIT,
      verify: keepSignedBodyBytes,
    }),
  );
  app.use(WebhookRequestBody.getRawReader(INGRESS_BODY_LIMIT));
  app.use(
    WebhookRequestBody.getSignedBodyReader(INGRESS_BODY_LIMIT, isSignedRequest),
  );
  app.use(router);
  return app;
}

export default router;

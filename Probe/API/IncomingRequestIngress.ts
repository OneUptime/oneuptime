import {
  ONEUPTIME_BASE_URL,
  PROBE_INGRESS_FORWARD_RETRY_LIMIT,
  PROBE_INGRESS_FORWARD_TIMEOUT_MS,
} from "../Config";
import ProbeUtil from "../Utils/Probe";
import ProxyConfig from "../Utils/ProxyConfig";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Headers from "Common/Types/API/Headers";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
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

function buildForwardHeaders(
  incoming: Dictionary<string | string[] | undefined>,
): Headers {
  const headers: Headers = {};
  for (const key of Object.keys(incoming)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
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

function getRequestBody(req: ExpressRequest): JSONObject | JSONArray {
  const body: unknown = req.body;
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body === "string") {
    return { _raw: body };
  }
  if (Array.isArray(body)) {
    return body as JSONArray;
  }
  if (typeof body === "object") {
    return body as JSONObject;
  }
  return { _raw: String(body) };
}

async function forwardWithRetry(
  forwardUrl: URL,
  method: HTTPMethod,
  data: JSONObject | JSONArray,
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
          options: {
            timeout: PROBE_INGRESS_FORWARD_TIMEOUT_MS,
            ...ProxyConfig.getRequestProxyAgents(forwardUrl),
          },
        });

      if (result instanceof HTTPErrorResponse) {
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

    const forwardUrl: URL = URL.fromString(ONEUPTIME_BASE_URL.toString())
      .addRoute("/incoming-request")
      .addRoute(`/${secretKey}`);

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
    const data: JSONObject | JSONArray = getRequestBody(req);

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

export default router;

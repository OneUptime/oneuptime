import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import AppMetrics from "../Utils/Telemetry/AppMetrics";

// The route of a request that matched none, as the metrics name it.
export const UNMATCHED_HTTP_ROUTE: string = "unmatched";

/*
 * The Express route template a request matched (e.g. /api/users/:id), under
 * the path its router is mounted at, or UNMATCHED_HTTP_ROUTE when it matched
 * none - a 404, or a middleware that answered before any route - rather
 * than the raw URL, so a count by route stays a few names. The metrics'
 * http.route, and the route a client's refusal is counted under
 * (ClientRefusalLog).
 */
export const getHttpRouteTemplate: (req: ExpressRequest) => string = (
  req: ExpressRequest,
): string => {
  const routeWithMethod: { path?: unknown } | undefined = (
    req as ExpressRequest & { route?: { path?: unknown } }
  ).route;

  const baseUrl: string = (req as ExpressRequest & { baseUrl?: string }).baseUrl
    ? (req as ExpressRequest & { baseUrl: string }).baseUrl
    : "";

  return routeWithMethod && typeof routeWithMethod.path === "string"
    ? `${baseUrl}${routeWithMethod.path}`
    : UNMATCHED_HTTP_ROUTE;
};

/**
 * Express middleware that records HTTP server metrics (request count,
 * duration, and in-flight gauge) for every request.
 *
 * Attributes are kept low-cardinality on purpose:
 *   - http.request.method: GET / POST / ...
 *   - http.route:          Express route template (e.g. /api/users/:id)
 *                          or "unmatched" when nothing matched the request.
 *   - http.response.status_code: full status code (bounded set).
 *   - status_class: 2xx / 3xx / 4xx / 5xx — handy for fast queries.
 *
 * High-cardinality identifiers (raw URL, query string, userId, projectId,
 * requestId) intentionally stay on traces and logs.
 */
const HttpMetricsMiddleware: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  const startNs: bigint = process.hrtime.bigint();
  const method: string = (req.method || "UNKNOWN").toUpperCase();

  const inFlight: ReturnType<typeof AppMetrics.getHttpRequestsInFlight> =
    AppMetrics.getHttpRequestsInFlight();

  inFlight.add(1, { "http.request.method": method });

  let recorded: boolean = false;

  const recordOnce: () => void = (): void => {
    if (recorded) {
      return;
    }
    recorded = true;

    const elapsedNs: bigint = process.hrtime.bigint() - startNs;
    const durationMs: number = Number(elapsedNs) / 1e6;
    const statusCode: number = res.statusCode || 0;
    const statusClass: string =
      statusCode >= 100 && statusCode < 600
        ? `${Math.floor(statusCode / 100)}xx`
        : "unknown";

    /*
     * Express populates req.route once the request has matched a route
     * handler. For 404s (no match), record the request under a stable
     * "unmatched" label rather than the raw URL to avoid cardinality blowup.
     */
    const routeTemplate: string = getHttpRouteTemplate(req);

    const attributes: Record<string, string | number> = {
      "http.request.method": method,
      "http.route": routeTemplate,
      "http.response.status_code": statusCode,
      status_class: statusClass,
    };

    AppMetrics.getHttpRequestCounter().add(1, attributes);
    AppMetrics.getHttpRequestDuration().record(durationMs, attributes);
    inFlight.add(-1, { "http.request.method": method });
  };

  res.on("finish", recordOnce);
  res.on("close", recordOnce);

  next();
};

export default HttpMetricsMiddleware;

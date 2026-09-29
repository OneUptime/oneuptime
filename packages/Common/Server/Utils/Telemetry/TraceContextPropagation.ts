import OpenTelemetryAPI, {
  Context,
  Span,
  SpanKind,
  SpanStatusCode,
  Tracer,
} from "@opentelemetry/api";
import API, {
  OutgoingRequest,
  OutgoingRequestTracer,
} from "../../../Utils/API";
import Dictionary from "../../../Types/Dictionary";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { ExpressRequest, ExpressResponse, NextFunction } from "../Express";
import {
  isLoopbackHost,
  normalizeHost,
} from "../../../Utils/Telemetry/NetworkHost";
import Telemetry from "../Telemetry";

/*
 * W3C trace-context propagation across OneUptime's own processes.
 *
 * OneUptime instruments itself with hand-placed spans (@CaptureSpan) rather
 * than auto-instrumentation, which left both ends of every hop between its
 * processes dark: an incoming request never joined the caller's trace, and an
 * outgoing request never offered its trace to the callee. Every process
 * therefore started its own traces, and a self-hosted estate showed its
 * browser apps, API, workers, probes and runner as disconnected islands on
 * the service map — there was no parent/child pair across services for the
 * dependency job to find.
 *
 * Two halves, both installed by StartServer for every OneUptime process and
 * both inert unless Telemetry.init installed a span exporter:
 *
 *   Incoming — a SERVER span per request that continues the caller's trace
 *   from its `traceparent` header. Everything the request does, including
 *   every @CaptureSpan below it, nests under that span.
 *
 *   Outgoing — a CLIENT span per request made through the shared API client,
 *   with `traceparent` injected. Deliberately limited to OneUptime's own
 *   hosts: the same client sends monitor checks, webhooks and workflow calls
 *   to customer endpoints, and those requests must go out byte-for-byte as
 *   configured.
 *
 * Span attributes stay low-cardinality and secret-free: method, route
 * template, status, and host/port — never a path, query string or header
 * value (webhook URLs carry credentials in their paths).
 */

const TRACER_NAME: string = "oneuptime-http";

/*
 * Requests that say nothing about a dependency and would drown the rest:
 * orchestrator health checks (every few seconds per pod), metrics scrapes,
 * CORS preflights and static assets.
 */
const IGNORED_PATH_PREFIXES: Array<string> = ["/status", "/metrics"];
const IGNORED_PATH_SEGMENTS: Array<string> = ["/status/live", "/status/ready"];
const STATIC_ASSET_REGEX: RegExp =
  /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|txt|json)$/i;

/** Environment variables whose URLs point at OneUptime's own processes. */
export const INTERNAL_URL_ENV_VARIABLES: Array<string> = [
  "ONEUPTIME_URL",
  "PROBE_INGEST_URL",
  "TELEMETRY_WRITER_URL",
];

/** Environment variables that hold bare OneUptime hostnames. */
export const INTERNAL_HOSTNAME_ENV_VARIABLES: Array<string> = [
  "HOST",
  "SERVER_APP_HOSTNAME",
  "SERVER_HOME_HOSTNAME",
];

/** Operator-supplied extra hosts, comma separated. */
export const EXTRA_PROPAGATION_HOSTS_ENV_VARIABLE: string =
  "OPENTELEMETRY_TRACE_PROPAGATION_HOSTS";

function hostOf(value: string | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  try {
    return normalizeHost(new globalThis.URL(value.trim()).hostname);
  } catch {
    return normalizeHost(value);
  }
}

/** The hosts outgoing requests may carry trace context to. */
export function resolvePropagationHosts(
  env: Dictionary<string | undefined>,
): Set<string> {
  const hosts: Set<string> = new Set<string>();
  const add: (host: string | null) => void = (host: string | null): void => {
    if (host) {
      hosts.add(host);
    }
  };
  for (const name of INTERNAL_URL_ENV_VARIABLES) {
    add(hostOf(env[name]));
  }
  for (const name of INTERNAL_HOSTNAME_ENV_VARIABLES) {
    add(normalizeHost(env[name]));
  }
  for (const entry of (env[EXTRA_PROPAGATION_HOSTS_ENV_VARIABLE] || "").split(
    ",",
  )) {
    add(normalizeHost(entry));
  }
  /*
   * "localhost" is where every unset hostname variable defaults, which would
   * otherwise make any local call eligible — including a probe checking a
   * customer service on the same machine.
   */
  for (const host of Array.from(hosts)) {
    if (isLoopbackHost(host)) {
      hosts.delete(host);
    }
  }
  return hosts;
}

/** Should an incoming request get a SERVER span at all? */
export function shouldTraceIncomingRequest(req: {
  method?: string | undefined;
  path?: string | undefined;
}): boolean {
  const method: string = (req.method || "").toUpperCase();
  if (method === "OPTIONS" || method === "HEAD") {
    return false;
  }
  const path: string = req.path || "/";
  if (
    IGNORED_PATH_PREFIXES.some((prefix: string): boolean => {
      return path === prefix || path.startsWith(`${prefix}/`);
    }) ||
    IGNORED_PATH_SEGMENTS.some((segment: string): boolean => {
      return path.endsWith(segment);
    })
  ) {
    return false;
  }
  return !STATIC_ASSET_REGEX.test(path);
}

/** `GET /api/monitor/:id` when Express matched a route, `GET` otherwise. */
export function serverSpanName(req: {
  method?: string | undefined;
  baseUrl?: string | undefined;
  route?: { path?: unknown } | undefined;
}): { name: string; route: string | null } {
  const method: string = (req.method || "HTTP").toUpperCase();
  const routePath: unknown = req.route?.path;
  if (typeof routePath === "string") {
    const route: string = `${req.baseUrl || ""}${routePath}` || "/";
    return { name: `${method} ${route}`, route };
  }
  return { name: method, route: null };
}

export default class TraceContextPropagation {
  private static propagationHosts: Set<string> | null = null;
  private static activeOverride: boolean | null = null;

  /** Propagation follows span export: no exporter, no spans, no headers. */
  public static isActive(): boolean {
    if (this.activeOverride !== null) {
      return this.activeOverride;
    }
    return Telemetry.isSpanExportEnabled();
  }

  /** Test seam: force the active state (null restores the default). */
  public static setActiveOverride(active: boolean | null): void {
    this.activeOverride = active;
  }

  public static getPropagationHosts(): Set<string> {
    if (!this.propagationHosts) {
      this.propagationHosts = resolvePropagationHosts(process.env);
    }
    return this.propagationHosts;
  }

  /** Test seam: re-read the allowlist (from `env`, or process.env lazily). */
  public static resetPropagationHosts(
    env?: Dictionary<string | undefined>,
  ): void {
    this.propagationHosts = env ? resolvePropagationHosts(env) : null;
  }

  /** Route every request of the shared API client through the tracer. */
  public static installOutgoingRequestTracer(): void {
    API.setOutgoingRequestTracer(this.outgoingRequestTracer);
  }

  private static getTracer(): Tracer {
    return OpenTelemetryAPI.trace.getTracer(TRACER_NAME);
  }

  /**
   * Express middleware: continue the caller's trace in a SERVER span that
   * stays active for the whole request.
   */
  public static incomingRequestMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (
      !TraceContextPropagation.isActive() ||
      !shouldTraceIncomingRequest(req)
    ) {
      next();
      return;
    }

    const parentContext: Context = OpenTelemetryAPI.propagation.extract(
      OpenTelemetryAPI.context.active(),
      req.headers,
    );
    const host: string | null = normalizeHost(req.hostname);
    const span: Span = TraceContextPropagation.getTracer().startSpan(
      (req.method || "HTTP").toUpperCase(),
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": (req.method || "").toUpperCase(),
          "url.scheme": req.protocol || "http",
          ...(host ? { "server.address": host } : {}),
        },
      },
      parentContext,
    );

    let ended: boolean = false;
    const endSpan: () => void = (): void => {
      if (ended) {
        return;
      }
      ended = true;
      const { name, route } = serverSpanName(
        req as ExpressRequest & {
          baseUrl?: string;
          route?: { path?: unknown };
        },
      );
      span.updateName(name);
      if (route) {
        span.setAttribute("http.route", route);
      }
      const statusCode: number = res.statusCode || 0;
      span.setAttribute("http.response.status_code", statusCode);
      /*
       * Per semconv a SERVER span is an error only for 5xx: a 4xx is the
       * caller's mistake, correctly answered.
       */
      if (statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    };
    res.on("finish", endSpan);
    res.on("close", endSpan);

    OpenTelemetryAPI.context.with(
      OpenTelemetryAPI.trace.setSpan(parentContext, span),
      next,
    );
  }

  public static shouldPropagateTo(url: string): boolean {
    if (!this.isActive()) {
      return false;
    }
    const host: string | null = hostOf(url);
    return Boolean(host && this.getPropagationHosts().has(host));
  }

  private static readonly outgoingRequestTracer: OutgoingRequestTracer = {
    trace: async <T>(
      request: OutgoingRequest,
      send: () => Promise<T>,
    ): Promise<T> => {
      if (!TraceContextPropagation.shouldPropagateTo(request.url)) {
        return send();
      }

      let port: number | undefined = undefined;
      let scheme: string | undefined = undefined;
      try {
        const parsed: globalThis.URL = new globalThis.URL(request.url);
        scheme = parsed.protocol.replace(/:$/, "");
        port = parsed.port
          ? Number(parsed.port)
          : scheme === "https"
            ? 443
            : 80;
      } catch {
        // Host was resolvable above; scheme and port are best-effort extras.
      }
      const host: string | null = hostOf(request.url);
      const method: string = (request.method || "GET").toUpperCase();

      return TraceContextPropagation.getTracer().startActiveSpan(
        method,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "http.request.method": method,
            ...(host ? { "server.address": host } : {}),
            ...(port ? { "server.port": port } : {}),
            ...(scheme ? { "url.scheme": scheme } : {}),
          },
        },
        async (span: Span): Promise<T> => {
          OpenTelemetryAPI.propagation.inject(
            OpenTelemetryAPI.context.active(),
            request.headers,
          );
          try {
            const result: T = await send();
            const statusCode: number | undefined =
              result instanceof HTTPResponse
                ? (result as HTTPResponse<JSONObject>).statusCode
                : undefined;
            if (statusCode !== undefined && statusCode > 0) {
              span.setAttribute("http.response.status_code", statusCode);
              if (statusCode >= 400) {
                span.setStatus({ code: SpanStatusCode.ERROR });
              }
            }
            return result;
          } catch (err) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
          } finally {
            span.end();
          }
        },
      );
    },
  };
}

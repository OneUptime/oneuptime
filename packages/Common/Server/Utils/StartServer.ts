// Connect common api's.
import CommonAPI from "../API/Index";
import { StatusAPIOptions } from "../API/StatusAPI";
import {
  AppVersion,
  EncryptionSecretWarning,
  GoogleTagManagerEnabled,
  TrustedProxyHops,
} from "../EnvironmentConfig";
import LocalCache from "../Infrastructure/LocalCache";
import HttpMetricsMiddleware from "../Middleware/HttpMetricsMiddleware";
import TraceContextPropagation from "./Telemetry/TraceContextPropagation";
import AppBodyParsers, {
  BodyParserOptions,
  BodyParserVerify,
  createJsonBodyParserOptions,
  createUrlEncodedBodyParserOptions,
  isProtobufContentType,
  jsonBodyParserOptions,
  keepRawBody,
  PROTOBUF_CONTENT_TYPES,
  RawBodyField,
  urlEncodedBodyParserOptions,
} from "../Middleware/AppBodyParsers";
import UnreadRequestBody from "../Middleware/UnreadRequestBody";
import {
  CORS_EXPOSED_HEADERS,
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
} from "./CorsOptions";
import CorsMiddleware from "./CorsMiddleware";
import "./Environment";
import { sendFrontendEnvironmentResponse } from "./FrontendEnvironment";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "./Express";
import logger, {
  getLogAttributesFromRequest,
  type LogAttributes,
} from "./Logger";
import "./Process";
import ClientRefusalLog, { isClientRefusal } from "./ClientRefusalLog";
import Response from "./Response";
import SpanUtil from "./Telemetry/SpanUtil";
import TelemetryContext from "./Telemetry/TelemetryContext";
import {
  COMPONENT_ATTRIBUTE_KEY,
  TelemetryComponent,
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../Types/Telemetry/UnitOfWork";
import mountVendorAssets from "./VendorAssets";
import RequestTransport from "./RequestTransport";
import StartupGate from "./StartupGate";
import { api } from "@opentelemetry/sdk-node";
import StatusCode from "../../Types/API/StatusCode";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import {
  CLOUD_STREAM_PATHS,
  CLOUD_STREAM_URL_PREFIX,
} from "../../Types/CloudConnection/CloudStream";
import { isCompatibleIngestPath } from "../../Types/Telemetry/CompatibleIngest";
import { getErrorDetails } from "../../Types/Exception/BadDataExceptionWithDetails";
import { isEmptyErrorPhrase } from "../../Types/Exception/ErrorMessageRule";
import Exception from "../../Types/Exception/Exception";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { sendUnexplainedError } from "./UnexplainedServerError";
import {
  RequestBodyRefusal,
  readRequestBodyRefusal,
} from "./RequestBodyRefusal";
import {
  getRequestBodyLimit,
  readsBodyAfterAuthentication,
} from "./RequestBodyLimit";
import { PromiseVoidFunction } from "../../Types/FunctionTypes";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Port from "../../Types/Port";
import Typeof from "../../Types/Typeof";
import CookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import "ejs";
// Make sure we have stack trace for debugging.
Error.stackTraceLimit = Infinity;

const app: ExpressApplication = Express.getExpressApp();

app.disable("x-powered-by");
app.set("port", process.env["PORT"]);
app.set("view engine", "ejs");
/*
 * Trust exactly the proxies we run, and no more, so req.protocol and req.ip
 * are correct behind our Nginx gateway.
 *
 * This was `true`, meaning "trust every hop". Under that setting Express
 * resolves req.ip to the LEFTMOST X-Forwarded-For entry -- the end of the
 * header the caller writes -- so req.ip was whatever the caller said it was.
 * A number instead means "the nth hop in from the right is the client", which
 * is the entry one of our own proxies wrote. Express's numeric semantics and
 * resolveClientIp's hop counting are the same count, so req.ip and
 * getClientIp() agree.
 */
app.set("trust proxy", TrustedProxyHops);
/*
 * First middleware, so the SERVER span that continues the caller's trace is
 * active for everything the request does — see TraceContextPropagation. The
 * outgoing half is installed here too, because every OneUptime process that
 * talks to another one starts through this module. Both are no-ops unless
 * span export is configured.
 */
app.use(TraceContextPropagation.incomingRequestMiddleware);
TraceContextPropagation.installOutgoingRequestTracer();
app.use(CookieParser());
/*
 * Before anything can answer: a response sent while its request's body is
 * left unread - a type no parser reads, a key refused before the body is
 * read - closes the connection once it is sent, rather than have Node read
 * the rest of the body off it (UnreadRequestBody, #10598).
 */
app.use(UnreadRequestBody.closeConnectionInstead);

/*
 * The App's body parsers (AppBodyParsers): exported here as they always
 * were, for the modules and tests that build a parser as the App's.
 */
export {
  createJsonBodyParserOptions,
  createUrlEncodedBodyParserOptions,
  isProtobufContentType,
  jsonBodyParserOptions,
  keepRawBody,
  PROTOBUF_CONTENT_TYPES,
  urlEncodedBodyParserOptions,
};
export type { BodyParserOptions, BodyParserVerify, RawBodyField };

export const setDefaultHeaders: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (typeof req.body === Typeof.String) {
    req.body = JSONFunctions.parse(req.body);
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  /*
   * x-oneuptime-token and x-oneuptime-app-identifier are listed explicitly
   * because the session-replay recorder runs on a customer's own origin and
   * so its POSTs are genuinely cross-origin and preflighted. Browser ingest
   * has worked so far only because `app.use(cors())` runs before this
   * handler; relying on that ordering for a required custom header would be
   * a silent, hard-to-diagnose failure the first time it changed.
   */
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization, DNT, X-CustomHeader, Keep-Alive, User-Agent, If-Modified-Since, Cache-Control, Content-Type, x-oneuptime-token, x-oneuptime-app-identifier",
  );

  /*
   * Repeated on the simple (non-preflight) response as well. The value that
   * actually governs preflight caching is the one configured on the cors
   * middleware below - this handler never runs for an OPTIONS request,
   * because cors answers preflights itself and calls res.end().
   */
  res.header("Access-Control-Max-Age", String(CORS_PREFLIGHT_MAX_AGE_SECONDS));

  res.header("Access-Control-Expose-Headers", CORS_EXPOSED_HEADERS.join(", "));

  /*
   * Content sniffing turns "the server declared a boring type" into "the
   * browser guessed an interesting one", which is how an upload becomes a
   * document. nginx sets this on the static app locations but not on /api or
   * /file, so set it here for everything the app itself serves.
   */
  res.header("X-Content-Type-Options", "nosniff");

  /*
   * An installation served over HTTPS tells browsers to reach its own
   * address over HTTPS only (RequestTransport says when, and for how long),
   * so a browser that has been here never sends a request - or the cookies
   * that go with it - over plain HTTP again.
   */
  const strictTransportSecurity: string | null =
    RequestTransport.getStrictTransportSecurity(req);

  if (strictTransportSecurity) {
    res.header("Strict-Transport-Security", strictTransportSecurity);
  }

  next();
};

app.use(CorsMiddleware);
app.use(HttpMetricsMiddleware);
app.use(setDefaultHeaders);

// Set the view engine to ejs
app.set("view engine", "ejs");

/*
 * Add limit of 10 MB to avoid "Request Entity too large error"
 * https://stackoverflow.com/questions/19917401/error-request-entity-too-large
 */

// Handle SCIM content type before JSON middleware
app.use((req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  const contentType: string | undefined = req.headers["content-type"];
  if (contentType && contentType.includes("application/scim+json")) {
    // Set content type to application/json so express.json() can parse it
    req.headers["content-type"] = "application/json";
  }
  next();
});

/*
 * The Vercel log drain (/vercel/v1/logs, also under /telemetry) reads its
 * body raw: the signature it checks is over the bytes Vercel sent, which a
 * body parser would not give back. Matched on the path's end, so the
 * Vercel Marketplace provider API under /api/marketplace/vercel/v1/ is
 * parsed as JSON as usual.
 */
export const isVercelLogDrainPath: (path: string) => boolean = (
  path: string,
): boolean => {
  return (
    path === "/vercel/v1/logs" || path.endsWith("/telemetry/vercel/v1/logs")
  );
};

/*
 * The endpoints a cloud connection streams to - Amazon Data Firehose's
 * (/aws-firehose/v1/metrics and /logs) and Pub/Sub's (/gcp-pubsub/v1/logs),
 * also under /telemetry - read their bodies raw: each answers in its
 * sender's own contract, a body too large too, which a body parser's own
 * refusal would not keep. Matched as the router matches them - in any
 * case, with or without a trailing slash - since a path the router sends
 * there that a body parser read first would reach the endpoint with its
 * body gone.
 */
export const isCloudStreamPath: (path: string) => boolean = (
  path: string,
): boolean => {
  let normalized: string = path.toLowerCase();

  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return CLOUD_STREAM_PATHS.some((streamPath: string): boolean => {
    return (
      normalized === streamPath ||
      normalized === `${CLOUD_STREAM_URL_PREFIX}${streamPath}`
    );
  });
};

app.use((req: OneUptimeRequest, res: ExpressResponse, next: NextFunction) => {
  /*
   * `includes`, not `startsWith`. Both of these routers are mounted on
   * several prefixes, so /telemetry/otlp/v1/... and
   * /telemetry/session-replay/v1/... are equally live. A prefix-anchored
   * test would let the prefixed path fall into the gzip fast-path below,
   * which sets req.body to the DECOMPRESSED buffer — that in turn trips
   * the ingest middleware's "already parsed" early-out, so its own,
   * tighter, byte cap would never run at all. (The fast path has its own
   * limits since GHSA-cp58-wc9q-qv53, but they are the generic 50 MiB
   * body-parser numbers, not the 4 MiB these routes are sized for.)
   *
   * The compatible endpoints (Prometheus remote write, Loki, Splunk HEC,
   * Datadog, Sentry - Types/Telemetry/CompatibleIngest) read their own
   * bodies too: snappy protobuf, concatenated JSON objects and newline-
   * delimited envelopes are nothing a body parser here can read.
   *
   * So do the routes that check their caller's key before they read the
   * body (RequestBodyLimit, readsBodyAfterAuthentication), which a parser
   * here, running before routing, could not wait for: a probe's collection
   * and a forwarding pod's ClickHouse rows (#10222), the uploads (#10673),
   * and the telemetry that collectors, agents and CI send - Fluent Bit and
   * Fluentd, syslog, Pyroscope's push and the rest (#10702). Each reads it
   * after the key with these same parsers (AppBodyParsers).
   */
  if (
    req.path.includes("/otlp/v1/") ||
    req.path.includes("/session-replay/v1/") ||
    isVercelLogDrainPath(req.path) ||
    isCloudStreamPath(req.path) ||
    isCompatibleIngestPath(req.path) ||
    readsBodyAfterAuthentication(req.path)
  ) {
    return next();
  }

  /*
   * What this route takes (RequestBodyLimit): 1 MB and 100,000 JSON values
   * on almost every route, 50 MiB on the routes that are listed as taking
   * more. Kept on the request (AppBodyParsers.read): the parsers' verify,
   * the form parser below and a route that parses an inflated body itself
   * count against it.
   */
  AppBodyParsers.read(req, res, next, getRequestBodyLimit(req.path));
});

app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  /*
   * The urlencoded twin of the bypass above. It must carry the same
   * session-replay exemption: a chunk POST carries an
   * application/octet-stream content type (older recorders: a
   * vnd.oneuptime.session-replay one) but the recorder's identity fallback
   * path sends no Content-Encoding, so without this predicate the
   * urlencoded parser would consume the stream before the replay body
   * reader ever saw it.
   */
  if (
    req.path.includes("/otlp/v1/") ||
    req.path.includes("/session-replay/v1/") ||
    isVercelLogDrainPath(req.path) ||
    isCloudStreamPath(req.path) ||
    isCompatibleIngestPath(req.path) ||
    readsBodyAfterAuthentication(req.path)
  ) {
    next();
  } else {
    // A gzip body was read above, as its bytes.
    AppBodyParsers.readForm(
      req,
      res,
      next,
      (req as OneUptimeRequest).requestBodyLimit ||
        getRequestBodyLimit(req.path),
    );
  }
});

app.use((_req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  // set span status code to OK by default. If the error occurs, it will be updated in the error handler.
  const span: api.Span | undefined = api.trace.getSpan(api.context.active());
  if (span) {
    span.setStatus({ code: api.SpanStatusCode.OK });
  }

  next();
});

app.use((req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  const requestId: string = crypto.randomUUID();
  (req as OneUptimeRequest).requestId = requestId;

  /*
   * Open a telemetry-context scope for the entire request. requestId is seeded
   * here; projectId/userId are added later by the auth middleware. Because
   * ContextSpanProcessor and Logger read this ambient context, every span and
   * log produced downstream inherits it automatically.
   */
  TelemetryContext.runWithContext(
    {
      requestId: requestId,
      /*
       * Seed the unit of work EXPLICITLY. ErrorClassResolver honours a
       * user-error / expected-denial classification only inside an HTTP
       * request — everywhere else there is no client to blame, so those
       * classes are promoted back to code-fault. runWithContext inherits the
       * enclosing scope, so leaving this unset would let a request's marker
       * leak into background work started from inside the request.
       */
      [UNIT_OF_WORK_ATTRIBUTE_KEY]: UnitOfWork.HttpRequest,
      /*
       * Which deployment role served this. service.name cannot answer it: the
       * Helm chart runs the worker from the same image and entrypoint as the
       * API, so worker pods also report service.name="api".
       */
      [COMPONENT_ATTRIBUTE_KEY]:
        LocalCache.getString("app", "name") || TelemetryComponent.Api,
    },
    () => {
      SpanUtil.addAttributesToCurrentSpan({
        requestId: requestId,
      });

      next();
    },
  );
});

export interface InitFuctionOptions {
  appName: string;
  port?: Port | undefined;
  isFrontendApp?: boolean;
  statusOptions: StatusAPIOptions;
  /*
   * Answer 503 with Retry-After for every route mounted after this call
   * until StartupGate.open() is called - for a service that keeps mounting
   * routes for a while after it starts listening (the App). The status
   * routes are mounted first and keep answering. See StartupGate.
   */
  useStartupGate?: boolean | undefined;
  /*
   * Whether this process reads or writes data protected by ENCRYPTION_SECRET.
   * The Runner does not: it reaches the server over its API and is never
   * handed the secret, so it passes false and does not repeat a warning about
   * a value it never holds (one setting the secret would not silence there).
   */
  usesEncryptionSecret?: boolean | undefined;
  getVariablesToRenderIndexPage?: (
    req: ExpressRequest,
    res: ExpressResponse,
  ) => Promise<JSONObject>;
}

type InitFunction = (
  options: InitFuctionOptions,
) => Promise<ExpressApplication>;

const init: InitFunction = async (
  data: InitFuctionOptions,
): Promise<ExpressApplication> => {
  const { appName, port, isFrontendApp = false } = data;

  logger.info(`App Version: ${AppVersion.toString()}`);

  /*
   * Said once per process at boot, where an operator reading the startup log
   * will see it. EnvironmentConfig computes the message but cannot log it
   * (Logger depends on EnvironmentConfig), so the entrypoint does.
   */
  if (data.usesEncryptionSecret !== false) {
    if (EncryptionSecretWarning) {
      logger.warn(EncryptionSecretWarning);
    }
  }

  await Express.launchApplication(appName, port);
  LocalCache.setString("app", "name", appName);

  CommonAPI({
    appName,
    statusOptions: data.statusOptions,
  });

  /*
   * Ahead of the frontend static mounts and every catch-all below them, so a
   * service that answers "/*" with its index page cannot swallow a request for
   * a stylesheet.
   */
  mountVendorAssets(app);

  /*
   * After the status routes and the vendor assets, before everything the
   * service mounts later: those answer "starting" until the service opens
   * the gate.
   */
  if (data.useStartupGate) {
    app.use(StartupGate.middleware);
  }

  if (isFrontendApp) {
    app.use(ExpressStatic("/usr/src/app/public"));

    app.get(
      [`/${appName}/env.js`, "/env.js"],
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          sendFrontendEnvironmentResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );

    app.use(
      `/${appName}`,
      ExpressStatic(path.resolve(process.cwd(), "public")),
    );

    app.get(
      `/${appName}/dist/Index.js`,
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.sendFile(path.resolve(process.cwd(), "public/dist/Index.js"));
      },
    );

    /*
     * Return 404 for missing static assets instead of falling through to SPA catch-all.
     * Without this, missing JS/CSS chunks get served as HTML (index.ejs),
     * which causes "Failed to fetch dynamically imported module" errors.
     */
    app.get(
      [`/${appName}/dist/*`, `/${appName}/assets/*`],
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(404).send("Not found");
      },
    );

    app.get(
      ["/*", `/${appName}/*`],
      async (
        _req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => {
        try {
          const renderLogAttributes: LogAttributes =
            getLogAttributesFromRequest(_req as OneUptimeRequest);

          logger.debug("Rendering index page", renderLogAttributes);

          let variables: JSONObject = {};

          if (data.getVariablesToRenderIndexPage) {
            logger.debug(
              "Getting variables to render index page",
              renderLogAttributes,
            );
            try {
              const variablesToRenderIndexPage: JSONObject =
                await data.getVariablesToRenderIndexPage(_req, res);
              variables = {
                ...variables,
                ...variablesToRenderIndexPage,
              };
            } catch (error) {
              logger.error(error, renderLogAttributes);
            }
          }

          logger.debug(
            "Rendering index page with variables: ",
            renderLogAttributes,
          );
          logger.debug(variables, renderLogAttributes);

          if (res.headersSent) {
            logger.debug(
              "Response already sent while preparing index page. Skipping render.",
              renderLogAttributes,
            );
            return;
          }

          return res.render(path.resolve(process.cwd(), "views/index.ejs"), {
            enableGoogleTagManager: GoogleTagManagerEnabled,
            ...variables,
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }

  return app;
};

const addDefaultRoutes: PromiseVoidFunction = async (): Promise<void> => {
  app.post("*", (req: ExpressRequest, res: ExpressResponse) => {
    return Response.sendErrorResponse(
      req,
      res,
      new NotFoundException(`Page not found - ${req.url}`),
    );
  });

  app.put("*", (req: ExpressRequest, res: ExpressResponse) => {
    return Response.sendErrorResponse(
      req,
      res,
      new NotFoundException(`Page not found - ${req.url}`),
    );
  });

  app.delete("*", (req: ExpressRequest, res: ExpressResponse) => {
    return Response.sendErrorResponse(
      req,
      res,
      new NotFoundException(`Page not found - ${req.url}`),
    );
  });

  app.get("*", (req: ExpressRequest, res: ExpressResponse) => {
    return Response.sendErrorResponse(
      req,
      res,
      new NotFoundException(`Page not found - ${req.url}`),
    );
  });

  // Attach Error Handler.
  app.use(expressErrorHandler);
};

// The status an Exception is answered with: its code, or 500 for one that is no status.
const statusOf: (exception: Exception) => number = (
  exception: Exception,
): number => {
  return StatusCode.isValidStatusCode(exception.code) ? exception.code : 500;
};

/**
 * The last-resort error handler: whatever it writes is what the browser reads,
 * so its job is to preserve the diagnosis rather than flatten it.
 *
 * Exported so the status-code handling can be asserted directly — see
 * Common/Tests/Server/Utils/StartServerErrorStatus.test.ts.
 */
export const expressErrorHandler: (
  err: Error | Exception | HTTPErrorResponse,
  _req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  err: Error | Exception | HTTPErrorResponse,
  _req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  /*
   * A body a body parser refused - over its route's limit (RequestBodyLimit),
   * JSON with more values than the route reads, JSON that does not parse -
   * is the client's: answered with its own 4xx and a sentence that says what
   * to do, never as a fault the server could not explain (#8419, #10183,
   * RequestBodyRefusal). Logged at debug, as GzipRequestBody logs its own
   * 413s: it is reached before anyone signs in, so a level the log sink
   * keeps by default would hand anyone a way to fill it, and it is nothing
   * for the on-call person to fix.
   */
  const bodyRefusal: RequestBodyRefusal | null = readRequestBodyRefusal(err);

  if (bodyRefusal) {
    logger.debug(
      `Refused a request body (${bodyRefusal.type}): answered ${bodyRefusal.status}.`,
      getLogAttributesFromRequest(_req as OneUptimeRequest),
    );

    if (res.headersSent) {
      next(err);
      return;
    }

    res.status(bodyRefusal.status);
    res.send({ error: bodyRefusal.message });
    return;
  }

  /*
   * A refusal of what the client sent - a route's next(err) with a
   * BadDataException, a NotAuthenticatedException and the rest of the 4xx
   * that say the fault is the client's - is logged at debug and counted by
   * its route, as Response.sendErrorResponse logs one (#10768): it comes
   * from anyone. Everything else, every 5xx, is logged at error.
   */
  if (err instanceof Exception && isClientRefusal(err, statusOf(err))) {
    ClientRefusalLog.log(_req, err, statusOf(err));
  } else {
    logger.error(err, getLogAttributesFromRequest(_req as OneUptimeRequest));
  }

  /*
   * Deliberately does NOT record the exception on a span.
   *
   * There is no HTTP instrumentation (Telemetry.init passes an empty
   * `instrumentations` array) and nothing creates a request-scoped span, so at
   * this point the ambient span is either absent or an already-ENDED
   * @CaptureSpan span — and addEvent no-ops on an ended span. On the whole
   * BaseAPI CRUD surface this emitted exactly zero events while looking like
   * it emitted one.
   *
   * Where it DID fire was the handful of @CaptureSpan-decorated middleware
   * that swallow an error and call next(err) from inside their own still-open
   * span. There it wrote to a span the request does not own, and — because the
   * raw error was passed to span.recordException, and the SDK reads
   * `exception.code` before `exception.name` — it typed the event with the
   * HTTP status ("400", "422") instead of the class name. Those middleware now
   * rethrow instead of swallowing, so CaptureSpan's normalized recorder does
   * the right thing on the right span.
   */

  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof Promise) {
    err.catch((exception: Exception) => {
      const isStatus: boolean = StatusCode.isValidStatusCode(
        (exception as Exception)?.code,
      );

      if (isStatus && !isEmptyErrorPhrase((exception as Exception)?.message)) {
        res.status((exception as Exception).code);
        res.send({
          ...getErrorDetails(exception),
          error: (exception as Exception).message,
        });
      } else {
        sendUnexplainedError(_req, res, {
          status: isStatus ? (exception as Exception).code : 500,
          errorField: "error",
        });
      }
    });
  } else if (err instanceof HTTPErrorResponse) {
    const errorStatusCode: number = StatusCode.isValidStatusCode(err.statusCode)
      ? err.statusCode
      : 500;

    /*
     * Another service's answer is passed on as it came - with its own
     * reference, when it could not explain itself either - unless it says
     * nothing at all.
     */
    if (isEmptyErrorPhrase(err.message)) {
      sendUnexplainedError(_req, res, {
        status: errorStatusCode,
        errorField: "error",
      });
      return;
    }

    const payload: unknown = err.jsonData ?? {
      error: err.message,
    };

    res.status(errorStatusCode);
    res.send(payload);
  } else if (err instanceof Exception) {
    /*
     * ExceptionCode is not a status-code enum: NotImplementedException is 0,
     * GeneralException 1, APIException 2, BadOperationException 5,
     * WebRequestException 6. Handing one of those to res.status() makes Node's
     * writeHead throw ERR_HTTP_INVALID_STATUS_CODE, and Express's finalhandler
     * then answers with a bare HTML 500 — discarding the message this branch
     * exists to deliver. That is not hypothetical: an LLM provider that times
     * out or refuses the connection surfaces as an APIException (code 2), so
     * the operator's real diagnosis was being replaced by "Server Error".
     * Both sibling branches already guard; this one was the outlier.
     */
    const exception: Exception = err as Exception;

    const status: number = statusOf(exception);

    /*
     * An Exception thrown with no message, or with only "Server Error"
     * (ServerException's default), explains as little as a TypeError.
     */
    if (isEmptyErrorPhrase(exception.message)) {
      sendUnexplainedError(_req, res, { status: status, errorField: "error" });
      return;
    }

    /*
     * Anything the exception adds goes beside its message, never over it,
     * as Response.sendErrorResponse sends it: a refusal's code, which a
     * program reads where the sentence may be reworded (NameTakenException,
     * #9855), reaches a client through a route's next(err) too.
     */
    res.status(status);
    res.send({ ...getErrorDetails(exception), error: exception.message });
  } else {
    /*
     * Not one of OneUptime's exceptions: a TypeError, a lost database
     * connection. Its message is a developer's, so it stays in the log.
     */
    sendUnexplainedError(_req, res, { status: 500, errorField: "error" });
  }
};

export default { init, addDefaultRoutes };

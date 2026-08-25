// Connect common api's.
import CommonAPI from "../API/Index";
import { StatusAPIOptions } from "../API/StatusAPI";
import {
  AppVersion,
  GoogleTagManagerEnabled,
  TrustedProxyHops,
  getFrontendEnvVars,
} from "../EnvironmentConfig";
import LocalCache from "../Infrastructure/LocalCache";
import HttpMetricsMiddleware from "../Middleware/HttpMetricsMiddleware";
import GzipRequestBodyMiddleware from "../Middleware/GzipRequestBody";
import CorsOptions, {
  CORS_EXPOSED_HEADERS,
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
} from "./CorsOptions";
import "./Environment";
import Express, {
  ExpressApplication,
  ExpressJson,
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  ExpressUrlEncoded,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  headerValueToString,
} from "./Express";
import logger, {
  getLogAttributesFromRequest,
  type LogAttributes,
} from "./Logger";
import "./Process";
import Response from "./Response";
import SpanUtil from "./Telemetry/SpanUtil";
import TelemetryContext from "./Telemetry/TelemetryContext";
import mountVendorAssets from "./VendorAssets";
import { api } from "@opentelemetry/sdk-node";
import StatusCode from "../../Types/API/StatusCode";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import Exception from "../../Types/Exception/Exception";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { PromiseVoidFunction } from "../../Types/FunctionTypes";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Port from "../../Types/Port";
import Typeof from "../../Types/Typeof";
import CookieParser from "cookie-parser";
import cors from "cors";
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
app.use(CookieParser());

export type BodyParserVerify = (
  req: ExpressRequest,
  res: ExpressResponse,
  buf: Buffer,
) => void;

export interface BodyParserOptions {
  limit: string;
  extended: boolean;
  verify: BodyParserVerify;
}

export const jsonBodyParserOptions: BodyParserOptions = {
  limit: "50mb",
  extended: true,
  verify: (req: ExpressRequest, _res: ExpressResponse, buf: Buffer): void => {
    (req as OneUptimeRequest).rawBody = buf.toString();
    logger.debug(
      `Raw JSON Body for signature verification captured`,
      getLogAttributesFromRequest(req as OneUptimeRequest),
    );
  },
};

const jsonBodyParserMiddleware: RequestHandler = ExpressJson(
  jsonBodyParserOptions,
); // 50 MB limit.

export const urlEncodedBodyParserOptions: BodyParserOptions = {
  limit: "50mb",
  extended: true,
  verify: (req: ExpressRequest, _res: ExpressResponse, buf: Buffer): void => {
    const raw: string = buf.toString();
    (req as OneUptimeRequest).rawFormUrlEncodedBody = raw;
    (req as OneUptimeRequest).rawBody = raw; // Also set rawBody for consistency
    logger.debug(
      `Raw Form Url Encoded Body for signature verification captured`,
      getLogAttributesFromRequest(req as OneUptimeRequest),
    );
  },
};

const urlEncodedMiddleware: RequestHandler = ExpressUrlEncoded(
  urlEncodedBodyParserOptions,
); // 50 MB limit.

const setDefaultHeaders: RequestHandler = (
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

  next();
};

app.use(cors(CorsOptions));
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
 * Parse protobuf (binary) bodies for non-OTLP routes.
 * OTLP HTTP ingestion bypasses the global body parsers and handles raw/gzip
 * payloads in the telemetry router to avoid conflicts with the merged app stack.
 */
const protobufBodyParserMiddleware: RequestHandler = ExpressRaw({
  type: ["application/x-protobuf", "application/protobuf"],
  limit: "50mb",
});

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
   */
  if (
    req.path.includes("/otlp/v1/") ||
    req.path.includes("/session-replay/v1/")
  ) {
    return next();
  }

  const contentType: string | undefined = headerValueToString(
    req.headers["content-type"],
  );
  const contentEncoding: string | undefined = headerValueToString(
    req.headers["content-encoding"],
  );

  if (contentEncoding?.includes("gzip")) {
    /*
     * Bounded on both sides - see GzipRequestBody. This used to buffer the
     * whole compressed body and hand it to an unbounded zlib.gunzip, which
     * turned 130 KB of anonymous request into 128 MiB of resident Buffer.
     */
    GzipRequestBodyMiddleware.parseBody(req, res, next);
  } else if (
    contentType &&
    (contentType.includes("application/x-protobuf") ||
      contentType.includes("application/protobuf"))
  ) {
    protobufBodyParserMiddleware(req, res, next);
  } else {
    jsonBodyParserMiddleware(req, res, next);
  }
});

app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  /*
   * The urlencoded twin of the bypass above. It must carry the same
   * session-replay exemption: a chunk POST carries a
   * vnd.oneuptime.session-replay content type but the recorder's identity
   * fallback path sends no Content-Encoding, so without this predicate the
   * urlencoded parser would consume the stream before the replay body
   * reader ever saw it.
   */
  if (
    req.path.includes("/otlp/v1/") ||
    req.path.includes("/session-replay/v1/") ||
    headerValueToString(req.headers["content-encoding"])?.includes("gzip")
  ) {
    next();
  } else {
    urlEncodedMiddleware(req, res, next);
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
  TelemetryContext.runWithContext({ requestId: requestId }, () => {
    SpanUtil.addAttributesToCurrentSpan({
      requestId: requestId,
    });

    next();
  });
});

export interface InitFuctionOptions {
  appName: string;
  port?: Port | undefined;
  isFrontendApp?: boolean;
  statusOptions: StatusAPIOptions;
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

  if (isFrontendApp) {
    app.use(ExpressStatic("/usr/src/app/public"));

    app.get(
      [`/${appName}/env.js`, "/env.js"],
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          // ping api server for database config.

          const env: JSONObject = getFrontendEnvVars();

          const script: string = `
    if(!window.process){
      window.process = {}
    }

    if(!window.process.env){
      window.process.env = {}
    }
    window.process.env = ${JSON.stringify(env)};
  `;

          Response.sendJavaScriptResponse(req, res, script);
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
  app.use(
    (
      err: Error | Exception | HTTPErrorResponse,
      _req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => {
      logger.error(err, getLogAttributesFromRequest(_req as OneUptimeRequest));

      // Mark span as error.
      if (err) {
        const span: api.Span | undefined = api.trace.getSpan(
          api.context.active(),
        );
        if (span) {
          // record exception
          span.recordException(err);

          // set span status code to ERROR
          span.setStatus({
            code: api.SpanStatusCode.ERROR,
            message: err.message,
          });
        }
      }

      if (res.headersSent) {
        return next(err);
      }

      if (err instanceof Promise) {
        err.catch((exception: Exception) => {
          if (StatusCode.isValidStatusCode((exception as Exception).code)) {
            res.status((exception as Exception).code);
            res.send({ error: (exception as Exception).message });
          } else {
            res.status(500);
            res.send({ error: "Server Error" });
          }
        });
      } else if (err instanceof HTTPErrorResponse) {
        const errorStatusCode: number = StatusCode.isValidStatusCode(
          err.statusCode,
        )
          ? err.statusCode
          : 500;

        const payload: unknown = err.jsonData ?? {
          error: err.message || "Server Error",
        };

        res.status(errorStatusCode);
        res.send(payload);
      } else if (err instanceof Exception) {
        res.status((err as Exception).code);
        res.send({ error: (err as Exception).message });
      } else {
        res.status(500);
        res.send({ error: "Server Error" });
      }
    },
  );
};

export default { init, addDefaultRoutes };

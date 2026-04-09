// Connect common api's.
import CommonAPI from "../API/Index";
import { StatusAPIOptions } from "../API/StatusAPI";
import {
  AppVersion,
  IsBillingEnabled,
  getFrontendEnvVars,
} from "../EnvironmentConfig";
import LocalCache from "../Infrastructure/LocalCache";
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
import logger, { getLogAttributesFromRequest } from "./Logger";
import "./Process";
import Response from "./Response";
import SpanUtil from "./Telemetry/SpanUtil";
import { api } from "@opentelemetry/sdk-node";
import StatusCode from "../../Types/API/StatusCode";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import Exception from "../../Types/Exception/Exception";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
import { PromiseVoidFunction } from "../../Types/FunctionTypes";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Port from "../../Types/Port";
import Typeof from "../../Types/Typeof";
import CookieParser from "cookie-parser";
import cors from "cors";
import zlib from "zlib";
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
 * Enable trust proxy to correctly interpret X-Forwarded-* headers from reverse proxies
 * This is needed for req.protocol, req.ip to be correct when behind nginx/load balancers
 */
app.set("trust proxy", true);
app.use(CookieParser());

const jsonBodyParserMiddleware: RequestHandler = ExpressJson({
  limit: "50mb",
  extended: true,
  verify: (req: ExpressRequest, _res: ExpressResponse, buf: Buffer) => {
    (req as OneUptimeRequest).rawBody = buf.toString();
    logger.debug(`Raw JSON Body for signature verification captured`, getLogAttributesFromRequest(req as OneUptimeRequest));
  },
}); // 50 MB limit.

const urlEncodedMiddleware: RequestHandler = ExpressUrlEncoded({
  limit: "50mb",
  extended: true,
  verify: (req: ExpressRequest, _res: ExpressResponse, buf: Buffer) => {
    (req as OneUptimeRequest).rawFormUrlEncodedBody = buf.toString();
    (req as OneUptimeRequest).rawBody = buf.toString(); // Also set rawBody for consistency
    logger.debug(
      `Raw Form Url Encoded Body: ${(req as OneUptimeRequest).rawFormUrlEncodedBody}`,
      getLogAttributesFromRequest(req as OneUptimeRequest),
    );
  },
}); // 50 MB limit.

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
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization, DNT, X-CustomHeader, Keep-Alive, User-Agent, If-Modified-Since, Cache-Control, Content-Type",
  );

  next();
};

app.use(cors());
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
  if (req.path.includes("/otlp/v1/")) {
    return next();
  }

  const contentType: string | undefined = headerValueToString(
    req.headers["content-type"],
  );
  const contentEncoding: string | undefined = headerValueToString(
    req.headers["content-encoding"],
  );

  if (contentEncoding?.includes("gzip")) {
    const buffers: any = [];

    req.on("data", (chunk: any) => {
      buffers.push(chunk);
    });

    req.on("end", () => {
      const buffer: Buffer = Buffer.concat(buffers);
      zlib.gunzip(buffer as Uint8Array, (err: unknown, decoded: Buffer) => {
        if (err) {
          logger.error(err, getLogAttributesFromRequest(req as OneUptimeRequest));
          return Response.sendErrorResponse(
            req,
            res,
            new ServerException("Error decompressing data"),
          );
        }

        req.body = decoded;

        next();
      });
    });
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
  if (
    req.path.includes("/otlp/v1/") ||
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

  // Tag the current span with requestId so all downstream spans inherit context
  SpanUtil.addAttributesToCurrentSpan({
    requestId: requestId,
  });

  next();
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
          const renderLogAttributes = getLogAttributesFromRequest(_req as OneUptimeRequest);

          logger.debug("Rendering index page", renderLogAttributes);

          let variables: JSONObject = {};

          if (data.getVariablesToRenderIndexPage) {
            logger.debug("Getting variables to render index page", renderLogAttributes);
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

          logger.debug("Rendering index page with variables: ", renderLogAttributes);
          logger.debug(variables, renderLogAttributes);

          if (res.headersSent) {
            logger.debug(
              "Response already sent while preparing index page. Skipping render.",
              renderLogAttributes,
            );
            return;
          }

          return res.render(path.resolve(process.cwd(), "views/index.ejs"), {
            enableGoogleTagManager: IsBillingEnabled || false,
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

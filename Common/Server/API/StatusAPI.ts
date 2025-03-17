import BadRequestException from "../../Types/Exception/BadRequestException";
import LocalCache from "../Infrastructure/LocalCache";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import Telemetry, { TelemetryCounter } from "../Utils/Telemetry";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface StatusAPIOptions {
  readyCheck: () => Promise<void>;
  liveCheck: () => Promise<void>;
  globalCacheCheck?: (() => Promise<void>) | undefined;
  analyticsDatabaseCheck?: (() => Promise<void>) | undefined;
  databaseCheck?: (() => Promise<void>) | undefined;
}

export default class StatusAPI {
  @CaptureSpan()
  public static init(options: StatusAPIOptions): ExpressRouter {
    const statusCheckSuccessCounter: TelemetryCounter = Telemetry.getCounter({
      name: "status.check.success",
      description: "Status check counter",
    });

    // ready counter
    const stausReadySuccess: TelemetryCounter = Telemetry.getCounter({
      name: "status.ready.success",
      description: "Ready check counter",
    });
    // live counter

    const stausLiveSuccess: TelemetryCounter = Telemetry.getCounter({
      name: "status.live.success",
      description: "Live check counter",
    });

    // ready failed counter
    const stausReadyFailed: TelemetryCounter = Telemetry.getCounter({
      name: "status.ready.failed",
      description: "Ready check counter",
    });

    // live failed counter
    const stausLiveFailed: TelemetryCounter = Telemetry.getCounter({
      name: "status.live.failed",
      description: "Live check counter",
    });

    const router: ExpressRouter = Express.getRouter();

    router.get("/app-name", (_req: ExpressRequest, res: ExpressResponse) => {
      res.send({ app: LocalCache.getString("app", "name") });
    });

    // General status
    router.get("/status", (req: ExpressRequest, res: ExpressResponse) => {
      statusCheckSuccessCounter.add(1);

      logger.info("Status check: ok");

      Response.sendJsonObjectResponse(req, res, {
        status: "ok",
      });
    });

    //Healthy probe
    router.get(
      "/status/ready",
      (req: ExpressRequest, res: ExpressResponse) => this.handleReadyCheck(options, stausReadySuccess, stausReadyFailed, req, res),
    );

    //Liveness probe
    router.get(
      "/status/live",
      (req: ExpressRequest, res: ExpressResponse) => this.handleLiveCheck(options, stausLiveSuccess, stausLiveFailed, req, res),
    );

    // Global cache check
    router.get(
      "/status/global-cache",
      (req: ExpressRequest, res: ExpressResponse) => this.handleGlobalCacheCheck(options, req, res),
    );

    // Analytics database check
    router.get(
      "/status/analytics-database",
      (req: ExpressRequest, res: ExpressResponse) => this.handleAnalyticsDatabaseCheck(options, req, res),
    );

    // Database check
    router.get(
      "/status/database",
      (req: ExpressRequest, res: ExpressResponse) => this.handleDatabaseCheck(options, req, res),
    );

    return router;
  }

    @CaptureSpan()
    private static async handleReadyCheck(
    options: StatusAPIOptions,
    stausReadySuccess: TelemetryCounter,
    stausReadyFailed: TelemetryCounter,
    req: ExpressRequest,
    res: ExpressResponse
    ) {
    try {
      logger.debug("Ready check");
      await options.readyCheck();
      logger.info("Ready check: ok");
      stausReadySuccess.add(1);

      Response.sendJsonObjectResponse(req, res, {
      status: "ok",
      });
    } catch (e) {
      stausReadyFailed.add(1);
      Response.sendErrorResponse(
      req,
      res,
      e instanceof Exception
        ? e
        : new ServerException("Server is not ready"),
      );
    }
    }

    @CaptureSpan()
    private static async handleLiveCheck(
    options: StatusAPIOptions,
    stausLiveSuccess: TelemetryCounter,
    stausLiveFailed: TelemetryCounter,
    req: ExpressRequest,
    res: ExpressResponse
    ) {
    try {
      logger.debug("Live check");
      await options.liveCheck();
      logger.info("Live check: ok");
      stausLiveSuccess.add(1);

      Response.sendJsonObjectResponse(req, res, {
      status: "ok",
      });
    } catch (e) {
      stausLiveFailed.add(1);
      Response.sendErrorResponse(
      req,
      res,
      e instanceof Exception
        ? e
        : new ServerException("Server is not ready"),
      );
    }
    }

    @CaptureSpan()
    private static async handleGlobalCacheCheck(
    options: StatusAPIOptions,
    req: ExpressRequest,
    res: ExpressResponse
    ) {
    try {
      logger.debug("Global cache check");
      if (options.globalCacheCheck) {
      await options.globalCacheCheck();
      } else {
      throw new BadRequestException("Global cache check not implemented");
      }
      logger.info("Global cache check: ok");

      Response.sendJsonObjectResponse(req, res, {
      status: "ok",
      });
    } catch (e) {
      Response.sendErrorResponse(
      req,
      res,
      e instanceof Exception
        ? e
        : new ServerException("Global cache is not ready"),
      );
    }
    }

    @CaptureSpan()
    private static async handleAnalyticsDatabaseCheck(
    options: StatusAPIOptions,
    req: ExpressRequest,
    res: ExpressResponse
    ) {
    try {
      logger.debug("Analytics database check");
      if (options.analyticsDatabaseCheck) {
      await options.analyticsDatabaseCheck();
      } else {
      throw new BadRequestException(
        "Analytics database check not implemented",
      );
      }
      logger.info("Analytics database check: ok");

      Response.sendJsonObjectResponse(req, res, {
      status: "ok",
      });
    } catch (e) {
      Response.sendErrorResponse(
      req,
      res,
      e instanceof Exception
        ? e
        : new ServerException("Analytics database is not ready"),
      );
    }
    }

    @CaptureSpan()
    private static async handleDatabaseCheck(
    options: StatusAPIOptions,
    req: ExpressRequest,
    res: ExpressResponse
    ) {
    try {
      logger.debug("Database check");

      if (options.databaseCheck) {
      await options.databaseCheck();
      } else {
      throw new BadRequestException("Database check not implemented");
      }

      logger.info("Database check: ok");

      Response.sendJsonObjectResponse(req, res, {
      status: "ok",
      });
    } catch (e) {
      Response.sendErrorResponse(
      req,
      res,
      e instanceof Exception
        ? e
        : new ServerException("Database is not ready"),
      );
    }
    }

    return router;
  }
}

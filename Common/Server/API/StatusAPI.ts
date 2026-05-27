import BadRequestException from "../../Types/Exception/BadRequestException";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import LocalCache from "../Infrastructure/LocalCache";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import Telemetry, { TelemetryCounter } from "../Utils/Telemetry";
import Exception from "../../Types/Exception/Exception";
import ServerException from "../../Types/Exception/ServerException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface StatusAPIOptions {
  readyCheck: () => Promise<void>;
  liveCheck: () => Promise<void>;
  globalCacheCheck?: (() => Promise<void>) | undefined;
  analyticsDatabaseCheck?: (() => Promise<void>) | undefined;
  databaseCheck?: (() => Promise<void>) | undefined;
}

/**
 * Result of a recently executed health check, cached for HEALTH_CHECK_CACHE_TTL_MS.
 * We cache both success AND failure: caching failure protects an already
 * unhealthy backend from being hammered by retry traffic during an outage. The
 * 5s TTL is short enough that k8s probe semantics (default 10s interval,
 * failureThreshold 3 → ~30s to unready) are essentially unchanged.
 */
type CachedHealthCheckResult = { ok: true } | { ok: false; error: Error };

export default class StatusAPI {
  /**
   * Cache of recent health check results, keyed by check name. Each entry
   * lives for HEALTH_CHECK_CACHE_TTL_MS. Bounded to a small max size — there
   * are only ~5 distinct check names in this API.
   */
  private static checkResultCache: InMemoryTTLCache<CachedHealthCheckResult> =
    new InMemoryTTLCache<CachedHealthCheckResult>(64);

  /**
   * In-flight check promises keyed by check name. When a cache miss occurs
   * and multiple concurrent requests arrive, they all attach to the same
   * promise instead of each triggering their own DB query. The entry is
   * cleared as soon as the check settles.
   */
  private static inflightChecks: Map<string, Promise<void>> = new Map();

  /**
   * Cache TTL for health-check results. Chosen so that:
   *   - Two-thirds of typical k8s probes (default periodSeconds=10) hit
   *     the cache, removing constant DB load from liveness/readiness traffic.
   *   - Time-to-detect for a failing dependency only grows by ≤5s, which is
   *     well within the failureThreshold window k8s probes already tolerate.
   */
  private static readonly HEALTH_CHECK_CACHE_TTL_MS: number = 5000;

  /**
   * Runs `checkFn` with two layers of protection:
   *   1. TTL cache — if the same check ran in the last HEALTH_CHECK_CACHE_TTL_MS
   *      ms, reuse its result (success or failure) without re-running.
   *   2. Single-flight — if a check is already in flight, concurrent callers
   *      await the same promise instead of starting their own.
   *
   * On cache hit this is effectively free; on cache miss we run the check
   * exactly once regardless of how many requests arrived concurrently.
   */
  private static async runCachedCheck(
    checkName: string,
    checkFn: () => Promise<void>,
  ): Promise<void> {
    const cached: CachedHealthCheckResult | undefined =
      this.checkResultCache.get(checkName);
    if (cached) {
      if (cached.ok) {
        return;
      }
      throw cached.error;
    }

    let inflight: Promise<void> | undefined =
      this.inflightChecks.get(checkName);
    if (!inflight) {
      inflight = (async (): Promise<void> => {
        try {
          await checkFn();
          this.checkResultCache.set(
            checkName,
            { ok: true },
            this.HEALTH_CHECK_CACHE_TTL_MS,
          );
        } catch (e) {
          const error: Error = e instanceof Error ? e : new Error(String(e));
          this.checkResultCache.set(
            checkName,
            { ok: false, error },
            this.HEALTH_CHECK_CACHE_TTL_MS,
          );
          throw error;
        } finally {
          this.inflightChecks.delete(checkName);
        }
      })();
      this.inflightChecks.set(checkName, inflight);
    }

    await inflight;
  }

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

      logger.info("Status check: ok", getLogAttributesFromRequest(req as any));

      Response.sendJsonObjectResponse(req, res, {
        status: "ok",
      });
    });

    //Healthy probe
    router.get("/status/ready", (req: ExpressRequest, res: ExpressResponse) => {
      return this.handleReadyCheck(
        options,
        stausReadySuccess,
        stausReadyFailed,
        req,
        res,
      );
    });

    //Liveness probe
    router.get("/status/live", (req: ExpressRequest, res: ExpressResponse) => {
      return this.handleLiveCheck(
        options,
        stausLiveSuccess,
        stausLiveFailed,
        req,
        res,
      );
    });

    // Global cache check
    router.get(
      "/status/global-cache",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.handleGlobalCacheCheck(options, req, res);
      },
    );

    // Analytics database check
    router.get(
      "/status/analytics-database",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.handleAnalyticsDatabaseCheck(options, req, res);
      },
    );

    // Database check
    router.get(
      "/status/database",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.handleDatabaseCheck(options, req, res);
      },
    );

    return router;
  }

  @CaptureSpan()
  private static async handleReadyCheck(
    options: StatusAPIOptions,
    stausReadySuccess: TelemetryCounter,
    stausReadyFailed: TelemetryCounter,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    try {
      /*
       * Cached for HEALTH_CHECK_CACHE_TTL_MS so k8s probe traffic does not
       * hammer the underlying check on every request.
       */
      await this.runCachedCheck("ready", options.readyCheck);
      logger.info("Ready check: ok", getLogAttributesFromRequest(req as any));
      stausReadySuccess.add(1);

      Response.sendJsonObjectResponse(req, res, {
        status: "ok",
      });
    } catch (e) {
      logger.error(
        "Ready check: failed",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(e, getLogAttributesFromRequest(req as any));

      stausReadyFailed.add(1);
      Response.sendErrorResponse(
        req,
        res,
        e instanceof Exception ? e : new ServerException("Server is not ready"),
      );
    }
  }

  @CaptureSpan()
  private static async handleLiveCheck(
    options: StatusAPIOptions,
    stausLiveSuccess: TelemetryCounter,
    stausLiveFailed: TelemetryCounter,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    try {
      // Cached for HEALTH_CHECK_CACHE_TTL_MS — see runCachedCheck for rationale.
      await this.runCachedCheck("live", options.liveCheck);
      logger.info("Live check: ok", getLogAttributesFromRequest(req as any));
      stausLiveSuccess.add(1);

      Response.sendJsonObjectResponse(req, res, {
        status: "ok",
      });
    } catch (e) {
      logger.error(
        "Live check: failed",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(e, getLogAttributesFromRequest(req as any));
      stausLiveFailed.add(1);
      Response.sendErrorResponse(
        req,
        res,
        e instanceof Exception ? e : new ServerException("Server is not ready"),
      );
    }
  }

  @CaptureSpan()
  private static async handleGlobalCacheCheck(
    options: StatusAPIOptions,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    try {
      logger.debug(
        "Global cache check",
        getLogAttributesFromRequest(req as any),
      );
      if (options.globalCacheCheck) {
        // Cached — see runCachedCheck for rationale.
        await this.runCachedCheck("global-cache", options.globalCacheCheck);
      } else {
        throw new BadRequestException("Global cache check not implemented");
      }
      logger.info(
        "Global cache check: ok",
        getLogAttributesFromRequest(req as any),
      );

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
    res: ExpressResponse,
  ): Promise<void> {
    try {
      logger.debug(
        "Analytics database check",
        getLogAttributesFromRequest(req as any),
      );
      if (options.analyticsDatabaseCheck) {
        // Cached — see runCachedCheck for rationale.
        await this.runCachedCheck(
          "analytics-database",
          options.analyticsDatabaseCheck,
        );
      } else {
        throw new BadRequestException(
          "Analytics database check not implemented",
        );
      }
      logger.info(
        "Analytics database check: ok",
        getLogAttributesFromRequest(req as any),
      );

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
    res: ExpressResponse,
  ): Promise<void> {
    try {
      logger.debug("Database check", getLogAttributesFromRequest(req as any));

      if (options.databaseCheck) {
        // Cached — see runCachedCheck for rationale.
        await this.runCachedCheck("database", options.databaseCheck);
      } else {
        throw new BadRequestException("Database check not implemented");
      }

      logger.info(
        "Database check: ok",
        getLogAttributesFromRequest(req as any),
      );

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
}

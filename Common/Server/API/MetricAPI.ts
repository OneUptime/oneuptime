import AggregateBy from "../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadRequestException from "../../Types/Exception/BadRequestException";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Metric from "../../Models/AnalyticsModels/Metric";
import { MetricService } from "../Services/MetricService";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ExpressRequest, ExpressResponse } from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import BaseAnalyticsAPI from "./BaseAnalyticsAPI";

/*
 * Aggregate cache TTL. Dashboards typically auto-refresh every 30s+, so
 * an 8s window collapses bursts of identical requests (e.g. 12 widgets
 * loading on the same page) onto a single ClickHouse query while still
 * looking real-time to humans.
 */
const AGGREGATE_CACHE_NAMESPACE: string = "metric-aggregate";
const AGGREGATE_CACHE_TTL_SECONDS: number = 8;

export default class MetricAPI extends BaseAnalyticsAPI<Metric, MetricService> {
  public constructor(service: MetricService) {
    super(Metric, service);
  }

  /*
   * Cached override of BaseAnalyticsAPI.getAggregate.
   *
   * Why a cache: each chart/value/gauge/table widget on a dashboard
   * issues its own /aggregate call. With 10+ widgets and a small group
   * of users hitting the same dashboard the underlying ClickHouse
   * cluster sees the same heavy aggregation many times in close
   * succession. Aggregations are read-only and pure (same input ->
   * same output for the bucket interval), so a brief result cache is
   * safe.
   *
   * Cache key: tenant project + the deserialized aggregateBy payload.
   * We must include the project so cross-tenant collisions cannot
   * leak data; we deliberately do NOT key on user id, because the
   * service layer applies project-scoped read permissions and metric
   * data is project-wide.
   *
   * Cache miss / Redis down: we fall through to the live query, so
   * cache outages degrade to today's behavior, never error.
   */
  @CaptureSpan()
  public override async getAggregate(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeList(req, res);

    let aggregateBy: AggregateBy<Metric> | null = null;

    if (req.body && req.body["aggregateBy"]) {
      aggregateBy = JSONFunctions.deserialize(
        req.body["aggregateBy"] as JSONObject,
      ) as any;
    }

    if (!aggregateBy) {
      throw new BadRequestException("AggregateBy is required");
    }

    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: string | undefined = databaseProps.tenantId?.toString();
    const cacheKey: string | null = projectId
      ? `${projectId}:${this.buildCacheKey(aggregateBy)}`
      : null;

    if (cacheKey) {
      try {
        const cached: JSONObject | null = await GlobalCache.getJSONObject(
          AGGREGATE_CACHE_NAMESPACE,
          cacheKey,
        );
        if (cached) {
          return Response.sendJsonObjectResponse(req, res, cached);
        }
      } catch (err) {
        // Cache fetch failed — fall through to a live query.
        logger.debug("MetricAPI aggregate cache read failed");
        logger.debug(err);
      }
    }

    const aggregateResult: AggregatedResult = await this.service.aggregateBy({
      ...aggregateBy,
      props: databaseProps,
    });

    const responseBody: JSONObject = { ...(aggregateResult as any) };

    if (cacheKey) {
      try {
        await GlobalCache.setJSON(
          AGGREGATE_CACHE_NAMESPACE,
          cacheKey,
          responseBody,
          { expiresInSeconds: AGGREGATE_CACHE_TTL_SECONDS },
        );
      } catch (err) {
        logger.debug("MetricAPI aggregate cache write failed");
        logger.debug(err);
      }
    }

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }

  private buildCacheKey(aggregateBy: AggregateBy<Metric>): string {
    /*
     * Stable serialization. Date instances are normalized to ISO so two
     * logically-equal time windows hit the same cache slot, and we sort
     * keys via JSON.stringify replacer to keep ordering deterministic
     * across clients and across versions of V8.
     */
    return JSON.stringify(
      aggregateBy,
      (_key: string, value: unknown): unknown => {
        if (value instanceof Date) {
          return value.toISOString();
        }
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).constructor === Object
        ) {
          const sorted: Record<string, unknown> = {};
          for (const k of Object.keys(
            value as Record<string, unknown>,
          ).sort()) {
            sorted[k] = (value as Record<string, unknown>)[k];
          }
          return sorted;
        }
        return value;
      },
    );
  }
}

import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { appendAttributeOperatorFilter } from "../Utils/AnalyticsDatabase/AttributeFilterStatement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import MetricService from "./MetricService";
import { MutableMetricService as MutableMetricServiceClass } from "./MutableMetricService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject, ObjectType } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import ServiceType from "../../Types/Telemetry/ServiceType";

export interface FacetValue {
  value: string;
  count: number;
  displayName?: string | undefined;
}

/*
 * A serialized QueryOperator (`{_type: "Wildcard", value: ["api-*"]}` and
 * friends) — how an attribute filter row that uses any operator other than
 * the implicit `=` arrives over the wire, since every QueryOperator's
 * toJSON() emits this shape. See appendAttributeOperatorFilter.
 */
export interface SerializedAttributeOperator {
  _type: string;
  value?: unknown;
}

/*
 * An attribute predicate. A single string is `= value`; an array is
 * `IN (...)`; an object is any other operator (contains, matches, is empty,
 * ...). Mirrors LogAttributeFilterValue / TraceAttributeFilterValue so every
 * explorer filters identically.
 */
export type MetricAttributeFilterValue =
  | string
  | Array<string>
  | SerializedAttributeOperator;
export type MetricAttributeFilters = Record<string, MetricAttributeFilterValue>;

export interface MetricFilters {
  serviceIds?: Array<ObjectID> | undefined;
  metricNames?: Array<string> | undefined;
  /*
   * Attribute predicates over the `attributes` map, same shapes as the log
   * and trace explorers. Metrics had no attribute channel at all, so no
   * selection could narrow the facet counts — every facet counted the whole
   * window no matter what else was selected beside it.
   */
  attributes?: MetricAttributeFilters | undefined;
}

export interface FacetRequest extends MetricFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
}

export interface MetricsForTraceRequest {
  projectId: ObjectID;
  /** Exemplar traceId stamped on Metric rows (bloom-indexed). */
  traceId: string;
  /** Optional span-level narrowing within the trace (bloom-indexed). */
  spanIds?: Array<string> | undefined;
  limit?: number | undefined;
}

export interface MetricForTraceItem {
  name: string;
  time: string;
  value: number;
  spanId: string;
  /** primaryEntityId of the row, stringified for the wire. */
  serviceId: string;
  attributes: JSONObject;
}

/*
 * Facet aggregation for the Metrics page sidebar. Same shape as
 * TraceAggregationService / LogAggregationService — per-facet GROUP BY on
 * the analytics table, with a `primaryEntityType` discriminator that lets
 * the `primaryEntityId` column carry Host / DockerHost / KubernetesCluster
 * ids for the corresponding virtual facets.
 */
export class MetricAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 500;
  private static readonly TABLE_NAME: string = AnalyticsTableName.Metric;
  private static readonly MUTABLE_TABLE_NAME: string =
    AnalyticsTableName.MutableMetric;
  private static readonly TOP_LEVEL_COLUMNS: Set<string> = new Set([
    "primaryEntityId",
    "name",
  ]);
  private static readonly RESOURCE_FACET_KEYS: Map<string, ServiceType> =
    new Map([
      ["hostId", ServiceType.Host],
      ["dockerHostId", ServiceType.DockerHost],
      ["podmanHostId", ServiceType.PodmanHost],
      ["kubernetesClusterId", ServiceType.KubernetesCluster],
      ["proxmoxClusterId", ServiceType.ProxmoxCluster],
      ["cephClusterId", ServiceType.CephCluster],
      ["serverlessFunctionId", ServiceType.ServerlessFunction],
      ["cloudResourceId", ServiceType.CloudResource],
      ["rumApplicationId", ServiceType.RealUserMonitor],
    ]);
  private static readonly ATTRIBUTE_KEY_PATTERN: RegExp = /^[a-zA-Z0-9._:/-]+$/;
  private static readonly MAX_FACET_KEY_LENGTH: number = 256;
  /**
   * Cap on rows returned by the reverse exemplar lookup. A single trace
   * rarely stamps more than a handful of exemplars, so hitting this cap
   * means a pathological instrumentation loop — truncating is safe.
   */
  private static readonly MAX_METRICS_FOR_TRACE_LIMIT: number = 500;

  /**
   * Reverse exemplar lookup: every Metric row whose exemplar traceId
   * matches the given trace (optionally narrowed to specific spans).
   * Drives the "Metrics" tab on the trace detail view. traceId and
   * spanId both carry bloom-filter skip indexes, so the read touches
   * only the granules the index cannot rule out.
   */
  @CaptureSpan()
  public static async getMetricsForTrace(
    request: MetricsForTraceRequest,
  ): Promise<Array<MetricForTraceItem>> {
    const statement: Statement =
      MetricAggregationService.buildMetricsForTraceStatement(request);

    const dbResult: Results = await MetricService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows.map((row: JSONObject): MetricForTraceItem => {
      return {
        name: String(row["name"] || ""),
        time: String(row["time"] || ""),
        value: Number(row["value"] || 0),
        spanId: String(row["spanId"] || ""),
        serviceId: String(row["serviceId"] || ""),
        attributes: (row["attributes"] as JSONObject) || {},
      };
    });
  }

  private static buildMetricsForTraceStatement(
    request: MetricsForTraceRequest,
  ): Statement {
    const limit: number = Math.min(
      request.limit || MetricAggregationService.MAX_METRICS_FOR_TRACE_LIMIT,
      MetricAggregationService.MAX_METRICS_FOR_TRACE_LIMIT,
    );

    const statement: Statement = SQL`
      SELECT
        name,
        time,
        toFloat64(value) AS value,
        spanId,
        toString(primaryEntityId) AS serviceId,
        attributes
      FROM ${MetricAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND traceId = ${{
          type: TableColumnType.Text,
          value: request.traceId,
        }}
    `;

    if (request.spanIds && request.spanIds.length > 0) {
      statement.append(
        SQL` AND spanId IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.spanIds),
        }})`,
      );
    }

    /*
     * Read-side retention filter: rows past their per-service retention
     * stay in their part until the whole part drops (ttl_only_drop_parts).
     */
    statement.append(" AND retentionDate >= now()");

    statement.append(
      SQL` ORDER BY time ASC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' yields
     * partial rows rather than holding a pool connection.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
  }

  @CaptureSpan()
  public static async getFacetValues(
    request: FacetRequest,
  ): Promise<Array<FacetValue>> {
    const statement: Statement =
      MetricAggregationService.buildFacetStatement(request);

    const dbResult: Results = await MetricService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows
      .map((row: JSONObject): FacetValue => {
        return {
          value: String(row["val"] || ""),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((facet: FacetValue): boolean => {
        return facet.value.length > 0;
      });
  }

  private static buildFacetStatement(request: FacetRequest): Statement {
    // Pre-rename alias from stale clients; the V3 column is primaryEntityId.
    if (request.facetKey === "serviceId") {
      request.facetKey = "primaryEntityId";
    }

    const limit: number =
      request.limit ?? MetricAggregationService.DEFAULT_FACET_LIMIT;

    MetricAggregationService.validateFacetKey(request.facetKey);

    const resourceServiceType: ServiceType | undefined =
      MetricAggregationService.RESOURCE_FACET_KEYS.get(request.facetKey);
    const isResourceFacet: boolean = resourceServiceType !== undefined;
    const isTopLevelColumn: boolean =
      isResourceFacet ||
      MetricAggregationService.isTopLevelColumn(request.facetKey);
    const useMutableMetricTable: boolean =
      MetricAggregationService.shouldUseMutableMetricTable(request);

    const statement: Statement = new Statement();

    if (isResourceFacet) {
      statement.append(
        SQL`SELECT toString(primaryEntityId) AS val, count() AS cnt`,
      );
    } else if (isTopLevelColumn) {
      statement.append(
        SQL`SELECT toString(${request.facetKey}) AS val, count() AS cnt`,
      );
    } else {
      statement.append(
        SQL`SELECT attributes[${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}] AS val, count() AS cnt`,
      );
    }

    MetricAggregationService.appendFacetSourceTable(
      statement,
      request,
      useMutableMetricTable,
    );

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND time >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND time <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

    if (useMutableMetricTable) {
      statement.append(SQL` AND isDeleted = false`);
    }

    if (isResourceFacet) {
      statement.append(
        SQL` AND primaryEntityType = ${{
          type: TableColumnType.Text,
          value: resourceServiceType as string,
        }}`,
      );
    } else if (request.facetKey === "primaryEntityId") {
      statement.append(
        SQL` AND (primaryEntityType = '' OR primaryEntityType = ${{
          type: TableColumnType.Text,
          value: ServiceType.OpenTelemetry as string,
        }})`,
      );
    } else if (!isTopLevelColumn) {
      statement.append(
        SQL` AND mapContains(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }})`,
      );
    }

    /*
     * Read-side retention filter: rows past their per-service retention
     * stay in their part until the whole part drops (ttl_only_drop_parts).
     */
    statement.append(" AND retentionDate >= now()");

    MetricAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Defense in depth: cap runtime below nginx's 60s proxy_read_timeout
     * so a slow facet never starves the endpoint.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
  }

  private static shouldUseMutableMetricTable(request: FacetRequest): boolean {
    if (!request.metricNames || request.metricNames.length === 0) {
      return false;
    }

    return request.metricNames.every((metricName: string): boolean => {
      return MutableMetricServiceClass.isMutableMetricName(metricName);
    });
  }

  private static appendFacetSourceTable(
    statement: Statement,
    request: FacetRequest,
    useMutableMetricTable: boolean,
  ): void {
    if (!useMutableMetricTable) {
      statement.append(SQL` FROM ${MetricAggregationService.TABLE_NAME}`);
      return;
    }

    statement.append(
      SQL` FROM (
        SELECT
          projectId,
          name,
          primaryEntityId,
          primaryEntityType,
          metricPointId,
          argMax(time, version) AS time,
          argMax(attributes, version) AS attributes,
          argMax(retentionDate, version) AS retentionDate,
          argMax(isDeleted, version) AS isDeleted
        FROM ${MetricAggregationService.MUTABLE_TABLE_NAME}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}`,
    );

    if (request.metricNames && request.metricNames.length > 0) {
      statement.append(
        SQL` AND name IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.metricNames),
        }})`,
      );
    }

    statement.append(
      SQL`
        GROUP BY projectId, name, primaryEntityId, primaryEntityType, metricPointId
      )`,
    );
  }

  private static appendCommonFilters(
    statement: Statement,
    request: MetricFilters,
  ): void {
    if (request.serviceIds && request.serviceIds.length > 0) {
      statement.append(
        SQL` AND primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            request.serviceIds.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
        }})`,
      );
    }

    if (request.metricNames && request.metricNames.length > 0) {
      statement.append(
        SQL` AND name IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.metricNames),
        }})`,
      );
    }

    if (request.attributes && Object.keys(request.attributes).length > 0) {
      for (const [attrKey, attrValue] of Object.entries(request.attributes)) {
        MetricAggregationService.validateFacetKey(attrKey);

        /*
         * Match attribute keys case-insensitively — see the matching note in
         * LogAggregationService.appendCommonFilters. Casings vary across
         * OTEL conventions and app-emitted attributes.
         */
        if (Array.isArray(attrValue)) {
          /*
           * An empty selection means "no selection", which must widen to
           * everything rather than compile to `IN ()` and match nothing.
           */
          if (attrValue.length === 0) {
            continue;
          }
          statement.append(
            SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
              type: TableColumnType.Text,
              value: attrKey,
            }}) AND v IN (${{
              type: TableColumnType.Text,
              value: new Includes(attrValue),
            }}), mapKeys(attributes), mapValues(attributes))`,
          );
          continue;
        }

        if (typeof attrValue === "object" && attrValue !== null) {
          appendAttributeOperatorFilter({
            statement,
            attributeKey: attrKey,
            operator: attrValue as unknown as Record<string, unknown>,
          });
          continue;
        }

        if (attrValue === "") {
          /*
           * A blank equality value is "missing or empty", not "present and
           * empty": a ClickHouse Map subscript returns the type default for a
           * key the row does not carry, so rows without the attribute match
           * too. Routed through the operator builder so a bare "" and an
           * explicit EqualTo("") cannot disagree.
           */
          appendAttributeOperatorFilter({
            statement,
            attributeKey: attrKey,
            operator: { _type: ObjectType.IsNull },
          });
          continue;
        }

        statement.append(
          SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
            type: TableColumnType.Text,
            value: attrKey,
          }}) AND v = ${{
            type: TableColumnType.Text,
            value: attrValue,
          }}, mapKeys(attributes), mapValues(attributes))`,
        );
      }
    }
  }

  private static isTopLevelColumn(key: string): boolean {
    return MetricAggregationService.TOP_LEVEL_COLUMNS.has(key);
  }

  private static validateFacetKey(
    facetKey: unknown,
  ): asserts facetKey is string {
    if (typeof facetKey !== "string") {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      facetKey.length === 0 ||
      facetKey.length > MetricAggregationService.MAX_FACET_KEY_LENGTH
    ) {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      MetricAggregationService.isTopLevelColumn(facetKey) ||
      MetricAggregationService.RESOURCE_FACET_KEYS.has(facetKey)
    ) {
      return;
    }

    if (!MetricAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }
}

export default MetricAggregationService;

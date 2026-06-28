import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import MetricService from "./MetricService";
import { MutableMetricService as MutableMetricServiceClass } from "./MutableMetricService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
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

export interface MetricFilters {
  serviceIds?: Array<ObjectID> | undefined;
  metricNames?: Array<string> | undefined;
}

export interface FacetRequest extends MetricFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
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

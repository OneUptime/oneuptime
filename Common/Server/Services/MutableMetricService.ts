import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import AlertMetricType from "../../Types/Alerts/AlertMetricType";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import IncidentMetricType from "../../Types/Incident/IncidentMetricType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ServiceType from "../../Types/Telemetry/ServiceType";
import MutableMetric from "../../Models/AnalyticsModels/MutableMetric";
import { MetricPointType } from "../../Models/AnalyticsModels/Metric";
import OneUptimeDate from "../../Types/Date";
import Includes from "../../Types/BaseDatabase/Includes";

type MutableMetricPointIdentity = {
  name: string;
  metricPointId: string;
};

export class MutableMetricService extends AnalyticsDatabaseService<MutableMetric> {
  private static readonly mutableMetricNames: Set<string> = new Set<string>([
    ...Object.values(AlertMetricType),
    ...Object.values(IncidentMetricType),
  ]);

  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: MutableMetric, database: clickhouseDatabase });
  }

  public static isMutableMetricName(metricName: string | undefined): boolean {
    if (!metricName) {
      return false;
    }

    return MutableMetricService.mutableMetricNames.has(metricName);
  }

  public static getMutableMetricNames(): Array<string> {
    return Array.from(MutableMetricService.mutableMetricNames);
  }

  public async createMutableMetrics(data: {
    metrics: Array<MutableMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    const version: number = this.getNextVersion();

    for (const metric of data.metrics) {
      metric.version = metric.version || version;
      metric.isDeleted = metric.isDeleted || false;
    }

    await this.createMany({
      items: data.metrics,
      props: {
        isRoot: true,
      },
    });
  }

  public async replaceEntityMetrics(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
    metricNames: Array<string>;
    metrics: Array<MutableMetric>;
    retentionDate: Date;
  }): Promise<void> {
    const version: number = this.getNextVersion();
    const desiredMetricKeys: Set<string> = new Set<string>();

    for (const metric of data.metrics) {
      const metricName: string | undefined = metric.name;
      const metricPointId: string | undefined = metric.metricPointId;

      if (!metricName || !metricPointId) {
        continue;
      }

      desiredMetricKeys.add(
        this.getMetricPointKey({
          name: metricName,
          metricPointId: metricPointId,
        }),
      );
      metric.version = version;
      metric.isDeleted = false;
    }

    const existingMetricPointIdentities: Array<MutableMetricPointIdentity> =
      await this.getActiveMetricPointIdentities({
        projectId: data.projectId,
        primaryEntityId: data.primaryEntityId,
        primaryEntityType: data.primaryEntityType,
        metricNames: data.metricNames,
      });

    const tombstoneMetrics: Array<MutableMetric> = [];

    for (const existingMetricPointIdentity of existingMetricPointIdentities) {
      const metricPointKey: string = this.getMetricPointKey(
        existingMetricPointIdentity,
      );

      if (desiredMetricKeys.has(metricPointKey)) {
        continue;
      }

      tombstoneMetrics.push(
        this.createTombstoneMetric({
          projectId: data.projectId,
          primaryEntityId: data.primaryEntityId,
          primaryEntityType: data.primaryEntityType,
          name: existingMetricPointIdentity.name,
          metricPointId: existingMetricPointIdentity.metricPointId,
          version: version,
          retentionDate: data.retentionDate,
        }),
      );
    }

    await this.createMutableMetrics({
      metrics: [...data.metrics, ...tombstoneMetrics],
    });
  }

  public async tombstoneEntityMetrics(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
    metricNames: Array<string>;
    retentionDate: Date;
  }): Promise<void> {
    const existingMetricPointIdentities: Array<MutableMetricPointIdentity> =
      await this.getActiveMetricPointIdentities({
        projectId: data.projectId,
        primaryEntityId: data.primaryEntityId,
        primaryEntityType: data.primaryEntityType,
        metricNames: data.metricNames,
      });

    const version: number = this.getNextVersion();
    const tombstoneMetrics: Array<MutableMetric> =
      existingMetricPointIdentities.map(
        (
          existingMetricPointIdentity: MutableMetricPointIdentity,
        ): MutableMetric => {
          return this.createTombstoneMetric({
            projectId: data.projectId,
            primaryEntityId: data.primaryEntityId,
            primaryEntityType: data.primaryEntityType,
            name: existingMetricPointIdentity.name,
            metricPointId: existingMetricPointIdentity.metricPointId,
            version: version,
            retentionDate: data.retentionDate,
          });
        },
      );

    await this.createMutableMetrics({
      metrics: tombstoneMetrics,
    });
  }

  private async getActiveMetricPointIdentities(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
    metricNames: Array<string>;
  }): Promise<Array<MutableMetricPointIdentity>> {
    if (data.metricNames.length === 0) {
      return [];
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const tableName: string = AnalyticsTableName.MutableMetric;

    const statement: Statement = SQL`
      SELECT name, metricPointId
      FROM (
        SELECT
          name,
          metricPointId,
          argMax(isDeleted, version) AS isDeleted
        FROM ${databaseName}.${tableName}
        WHERE projectId = ${{
          value: data.projectId,
          type: TableColumnType.ObjectID,
        }}
        AND primaryEntityId = ${{
          value: data.primaryEntityId,
          type: TableColumnType.ObjectID,
        }}
        AND primaryEntityType = ${{
          value: data.primaryEntityType,
          type: TableColumnType.Text,
        }}
        AND name IN ${{
          value: new Includes(data.metricNames),
          type: TableColumnType.Text,
        }}
        GROUP BY name, metricPointId
      )
      WHERE isDeleted = false
    `;

    const dbResult: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map(
      (row: JSONObject): MutableMetricPointIdentity => {
        return {
          name: row["name"] as string,
          metricPointId: row["metricPointId"] as string,
        };
      },
    );
  }

  private createTombstoneMetric(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
    name: string;
    metricPointId: string;
    version: number;
    retentionDate: Date;
  }): MutableMetric {
    const now: Date = OneUptimeDate.getCurrentDate();
    const metric: MutableMetric = new MutableMetric();

    metric.projectId = data.projectId;
    metric.primaryEntityId = data.primaryEntityId;
    metric.primaryEntityType = data.primaryEntityType;
    metric.name = data.name;
    metric.metricPointId = data.metricPointId;
    metric.value = 0;
    metric.time = now;
    metric.timeUnixNano = OneUptimeDate.toUnixNano(now);
    metric.metricPointType = MetricPointType.Sum;
    metric.attributes = {};
    metric.attributeKeys = [];
    metric.version = data.version;
    metric.isDeleted = true;
    metric.retentionDate = data.retentionDate;

    return metric;
  }

  private getMetricPointKey(data: {
    name: string;
    metricPointId: string;
  }): string {
    return `${data.name}|${data.metricPointId}`;
  }

  private getNextVersion(): number {
    return Date.now() * 1000 + Number(process.hrtime.bigint() % BigInt(1000));
  }
}

export default new MutableMetricService();

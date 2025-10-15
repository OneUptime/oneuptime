import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import LogDatabaseService from "./LogService";
import MetricDatabaseService from "./MetricService";
import SpanDatabaseService from "./SpanService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";

type TelemetrySource = {
  service: AnalyticsDatabaseService<any>;
  tableName: string;
  attributesColumn: string;
};

export class TelemetryAttributeService {
  private static readonly ATTRIBUTES_LIMIT: number = 5000;

  private getTelemetrySource(
    telemetryType: TelemetryType,
  ): TelemetrySource | null {
    switch (telemetryType) {
      case TelemetryType.Log:
        return {
          service: LogDatabaseService,
          tableName: LogDatabaseService.model.tableName,
          attributesColumn: "attributes",
        };
      case TelemetryType.Metric:
        return {
          service: MetricDatabaseService,
          tableName: MetricDatabaseService.model.tableName,
          attributesColumn: "attributes",
        };
      case TelemetryType.Trace:
        return {
          service: SpanDatabaseService,
          tableName: SpanDatabaseService.model.tableName,
          attributesColumn: "attributes",
        };
      default:
        return null;
    }
  }

  @CaptureSpan()
  public async fetchAttributes(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
  }): Promise<string[]> {
    const source: TelemetrySource | null = this.getTelemetrySource(
      data.telemetryType,
    );

    if (!source) {
      return [];
    }

    const { service, tableName, attributesColumn } = source;

    const statement: Statement = SQL`
      SELECT DISTINCT arrayJoin(JSONExtractKeys(${attributesColumn})) AS attribute
      FROM ${tableName}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND ${attributesColumn} IS NOT NULL
        AND ${attributesColumn} != ''
      ORDER BY attribute ASC
      LIMIT ${{
        type: TableColumnType.Number,
        value: TelemetryAttributeService.ATTRIBUTES_LIMIT,
      }}
    `;

    const dbResult: Results = await service.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    const attributeKeys: Array<string> = rows
      .map((row: JSONObject) => {
        const attribute: unknown = row["attribute"];
        return typeof attribute === "string" ? attribute : null;
      })
      .filter((attribute: string | null): attribute is string => {
        return Boolean(attribute);
      });

    return Array.from(new Set(attributeKeys));
  }
}

export default new TelemetryAttributeService();

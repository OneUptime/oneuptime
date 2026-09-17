import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import DataSourceTableResult from "Common/Types/DataSource/DataSourceTableResult";
import DataSourceQueryConfig, {
  DataSourceResultKind,
} from "Common/Types/DataSource/DataSourceQueryConfig";

/*
 * Client for the authenticated /data-source/query endpoint. Used by the
 * four Data Source widgets (chart, value, gauge, table) — the widget types
 * that exist to read external systems. NEVER called on public dashboards:
 * the public API has no data-source surface, the widgets are stripped from
 * the config served there, and the renderers draw a placeholder anyway.
 */
export default class DataSourceQueryUtil {
  private static async execute(data: {
    queryConfig: DataSourceQueryConfig;
    startDate: Date;
    endDate: Date;
    resultKind: DataSourceResultKind;
    stepInSeconds?: number | undefined;
  }): Promise<JSONObject> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/data-source/query",
        ),
        data: {
          dataSourceId: data.queryConfig.dataSourceId,
          query: data.queryConfig.query,
          resultKind: data.resultKind,
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
          ...(data.stepInSeconds ? { stepInSeconds: data.stepInSeconds } : {}),
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return (response.data["result"] as JSONObject) || {};
  }

  public static async fetchTimeSeries(data: {
    queryConfig: DataSourceQueryConfig;
    startDate: Date;
    endDate: Date;
    stepInSeconds?: number | undefined;
  }): Promise<AggregatedResult> {
    const result: JSONObject = await this.execute({
      ...data,
      resultKind: DataSourceResultKind.TimeSeries,
    });

    const rawData: Array<JSONObject> =
      (result["data"] as Array<JSONObject>) || [];

    /*
     * Timestamps arrive as ISO strings over JSON — normalize to Date so
     * every widget consumer sees the same shape OneUptime metrics
     * produce.
     */
    const points: Array<AggregatedModel> = rawData
      .map((row: JSONObject) => {
        const timestamp: Date = new Date(row["timestamp"] as string);
        return {
          ...row,
          timestamp: timestamp,
          value: row["value"] as number,
        } as AggregatedModel;
      })
      .filter((row: AggregatedModel) => {
        return (
          !isNaN(row.timestamp.getTime()) &&
          typeof row.value === "number" &&
          Number.isFinite(row.value)
        );
      });

    return {
      data: points,
      truncated: Boolean(result["truncated"]),
    };
  }

  public static async fetchTable(data: {
    queryConfig: DataSourceQueryConfig;
    startDate: Date;
    endDate: Date;
  }): Promise<DataSourceTableResult> {
    const result: JSONObject = await this.execute({
      ...data,
      resultKind: DataSourceResultKind.Table,
    });

    return {
      columns:
        (result["columns"] as unknown as DataSourceTableResult["columns"]) ||
        [],
      rows: (result["rows"] as unknown as DataSourceTableResult["rows"]) || [],
      truncated: Boolean(result["truncated"]),
    };
  }

  /*
   * Union of attribute keys across a result's points — becomes the
   * synthetic groupByAttributeKeys the chart layer uses to split and name
   * series ("key=value, ...").
   */
  public static getAttributeKeys(result: AggregatedResult): Array<string> {
    const keys: Array<string> = [];
    for (const point of result.data) {
      const attributes: Record<string, unknown> | undefined = (
        point as Record<string, unknown>
      )["attributes"] as Record<string, unknown> | undefined;
      if (!attributes) {
        continue;
      }
      for (const key of Object.keys(attributes)) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    }
    return keys;
  }
}

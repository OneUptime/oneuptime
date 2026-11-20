import API from "Common/UI/Utils/API/API";
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
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { PUBLIC_DASHBOARD_PROMQL_QUERY_PATH } from "Common/Types/Dashboard/PublicDashboardPromQL";
import {
  DASHBOARD_WIDGET_SORT_REQUEST_FIELD,
  DashboardWidgetSortChoice,
  formatDashboardWidgetSortChoice,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import {
  PublicDashboardContext,
  getPublicDashboardContext,
} from "../Components/Dashboard/Utils/PublicDashboardContext";
import DashboardResourceList from "../Components/Dashboard/Utils/DashboardResourceList";

/*
 * Which of a public dashboard's stored PromQL queries to run (issue
 * #10226): the widget the page draws, and the query's place among its
 * queries - never the query's text, which the page is not served.
 */
export interface PublicDataSourceQueryTarget {
  componentId: string;
  queryIndex: number;
  // The toolbar's variables: only their picks are sent.
  variables: Array<DashboardVariable> | undefined;
}

/*
 * Client for the Data Source widgets' queries (chart, value, gauge, table).
 *
 * Signed in, the authenticated /data-source/query endpoint, sent the query
 * text with the variables already filled in. On a public dashboard
 * (issue #10226), a widget is drawn only when it reads this project's
 * metrics, and its data comes from the dashboard's own public route, by
 * the widget and the query's place: the page holds no query text to send,
 * and the server runs only the queries the dashboard stores. A widget that
 * reads an outside system is never on a public dashboard.
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

  /*
   * One stored query of a public dashboard's widget, through its public
   * route: the widget, the query's place, the window, the variables' picks
   * and a table's sort - nothing the server runs as a query.
   */
  private static async executePublic(data: {
    target: PublicDataSourceQueryTarget;
    startDate: Date;
    endDate: Date;
    sort?: DashboardWidgetSortChoice | null | undefined;
  }): Promise<JSONObject> {
    const context: PublicDashboardContext | null = getPublicDashboardContext();

    if (!context) {
      throw new Error(
        "This widget's data can be read only on its public dashboard.",
      );
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await context.postJSON(
        `${PUBLIC_DASHBOARD_PROMQL_QUERY_PATH}/${context.dashboardId.toString()}`,
        {
          componentId: data.target.componentId,
          queryIndex: data.target.queryIndex,
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
          variables: DashboardResourceList.getVariableSelections(
            data.target.variables,
          ),
          ...(data.sort
            ? {
                [DASHBOARD_WIDGET_SORT_REQUEST_FIELD]:
                  formatDashboardWidgetSortChoice(data.sort),
              }
            : {}),
        },
      );

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
    return this.readTimeSeries(
      await this.execute({
        ...data,
        resultKind: DataSourceResultKind.TimeSeries,
      }),
    );
  }

  // A public dashboard's stored query, as a time series (issue #10226).
  public static async fetchPublicTimeSeries(data: {
    target: PublicDataSourceQueryTarget;
    startDate: Date;
    endDate: Date;
  }): Promise<AggregatedResult> {
    return this.readTimeSeries(await this.executePublic(data));
  }

  // A public dashboard's stored query, as a table, in the order it draws it.
  public static async fetchPublicTable(data: {
    target: PublicDataSourceQueryTarget;
    startDate: Date;
    endDate: Date;
    sort: DashboardWidgetSortChoice | null | undefined;
  }): Promise<DataSourceTableResult> {
    return this.readTable(await this.executePublic(data));
  }

  private static readTimeSeries(result: JSONObject): AggregatedResult {
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
    return this.readTable(
      await this.execute({
        ...data,
        resultKind: DataSourceResultKind.Table,
      }),
    );
  }

  private static readTable(result: JSONObject): DataSourceTableResult {
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

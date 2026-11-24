import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  PrometheusResult,
  PrometheusSeries,
  parsePrometheusResult,
} from "Common/Utils/PromQL/PrometheusResponse";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "Common/Types/DataSource/ProjectMetricsDataSource";
import { DataSourceResultKind } from "Common/Types/DataSource/DataSourceQueryConfig";

/*
 * The Metrics page's PromQL tab asks the project's Prometheus-compatible
 * API (Common/Server/API/PrometheusAPI, issue #6796): the same endpoints
 * Grafana reads, signed in as the person on the page.
 */

// About this many points across a chart, as Prometheus' own UI draws.
const POINTS_PER_CHART: number = 250;

export default class PromQLQueryUtil {
  // The Prometheus server URL to give Grafana or any Prometheus client.
  public static getPrometheusServerUrl(): string {
    return URL.fromString(APP_API_URL.toString())
      .addRoute("/prometheus")
      .toString();
  }

  private static apiUrl(path: string): URL {
    return URL.fromString(APP_API_URL.toString()).addRoute(
      `/prometheus/api/v1${path}`,
    );
  }

  // A step that draws about POINTS_PER_CHART points, in whole seconds.
  public static getStepInSeconds(startDate: Date, endDate: Date): number {
    const rangeSeconds: number =
      (endDate.getTime() - startDate.getTime()) / 1000;
    return Math.max(1, Math.round(rangeSeconds / POINTS_PER_CHART));
  }

  private static async post(
    path: string,
    data: JSONObject,
  ): Promise<PrometheusResult> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: this.apiUrl(path),
        data,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const result: PrometheusResult | undefined = parsePrometheusResult(
      response.data["data"],
    );

    if (!result) {
      throw new Error(
        "The metrics server answered in a shape this page cannot read. Try again.",
      );
    }

    return result;
  }

  // The query evaluated at every step of the window, for a chart.
  public static async queryRange(data: {
    query: string;
    startDate: Date;
    endDate: Date;
  }): Promise<PrometheusResult> {
    return this.post("/query_range", {
      query: data.query,
      start: data.startDate.getTime() / 1000,
      end: data.endDate.getTime() / 1000,
      step: this.getStepInSeconds(data.startDate, data.endDate),
    });
  }

  /*
   * A Metrics monitor's PromQL expression over a window, for its Overview
   * and for the incidents and alerts it opens (issue #10227): through the
   * Data Source widgets' built-in source - the same engine and limits as
   * the Prometheus API, as the person viewing, for the services they may
   * read - narrowed to the services the monitor reads, and on an incident
   * or alert to the one series that opened it. Each series is named by its
   * labels without __name__, as the monitor names the series it judges.
   */
  public static async queryMonitorRange(data: {
    query: string;
    startDate: Date;
    endDate: Date;
    serviceIds?: Array<string> | undefined;
    seriesLabels?: JSONObject | undefined;
  }): Promise<{ series: Array<PrometheusSeries>; isCut: boolean }> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/data-source/query",
        ),
        data: {
          dataSourceId: PROJECT_METRICS_DATA_SOURCE_ID,
          query: data.query,
          resultKind: DataSourceResultKind.TimeSeries,
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
          ...(data.serviceIds && data.serviceIds.length > 0
            ? { serviceIds: data.serviceIds }
            : {}),
          ...(data.seriesLabels ? { seriesLabels: data.seriesLabels } : {}),
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const result: JSONObject = (response.data["result"] as JSONObject) || {};

    return {
      series: this.toSeries((result["data"] as Array<JSONObject>) || []),
      isCut: Boolean(result["truncated"]),
    };
  }

  /*
   * Points of the built-in source's answer, each with its series' labels,
   * as series: one per label set, in the order they first come.
   */
  public static toSeries(points: Array<JSONObject>): Array<PrometheusSeries> {
    const byLabels: Map<string, PrometheusSeries> = new Map<
      string,
      PrometheusSeries
    >();

    for (const point of points) {
      const timestampMs: number = new Date(
        point["timestamp"] as string,
      ).getTime();
      const value: unknown = point["value"];

      if (!Number.isFinite(timestampMs) || typeof value !== "number") {
        continue;
      }

      const attributes: unknown = point["attributes"];
      const labels: Record<string, string> = {};

      if (attributes && typeof attributes === "object") {
        for (const [name, labelValue] of Object.entries(
          attributes as Record<string, unknown>,
        )) {
          labels[name] = String(labelValue);
        }
      }

      const key: string = JSON.stringify(
        Object.keys(labels)
          .sort()
          .map((name: string): [string, string] => {
            return [name, labels[name]!];
          }),
      );

      let series: PrometheusSeries | undefined = byLabels.get(key);

      if (!series) {
        series = { labels, points: [] };
        byLabels.set(key, series);
      }

      series.points.push({ timestampMs, value });
    }

    return Array.from(byLabels.values());
  }

  // The query evaluated once, at the end of the window, for a table.
  public static async queryInstant(data: {
    query: string;
    time: Date;
  }): Promise<PrometheusResult> {
    return this.post("/query", {
      query: data.query,
      time: data.time.getTime() / 1000,
    });
  }

  // The project's metric names as PromQL writes them, for the editor.
  public static async getMetricNames(): Promise<Array<string>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: this.apiUrl("/label/__name__/values"),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const names: unknown = response.data["data"];

    return Array.isArray(names)
      ? names.filter((name: unknown): name is string => {
          return typeof name === "string";
        })
      : [];
  }
}

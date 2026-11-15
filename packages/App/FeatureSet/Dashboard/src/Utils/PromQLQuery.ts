import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  PrometheusResult,
  parsePrometheusResult,
} from "Common/Utils/PromQL/PrometheusResponse";

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

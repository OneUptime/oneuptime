import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import EntraTokenClient, {
  MicrosoftCloud,
} from "../../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import AzureMonitorClient from "../../LlmObservability/Connectors/AzureOpenAI/AzureMonitorClient";
import {
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";

/*
 * Azure Resource Manager and Azure Monitor, the calls an Azure cloud
 * connection makes, signed in as an app registration (the client
 * credentials grant, EntraTokenClient) with the Monitoring Reader role:
 *
 *   GET {arm}/subscriptions?api-version=2022-12-01
 *       -> the subscriptions the app may read (value[], nextLink)
 *   GET {arm}/subscriptions/{id}/resources?api-version=2021-04-01&$top=1000
 *       -> every resource of a subscription (value[], nextLink)
 *   GET {arm}{resource id}/providers/Microsoft.Insights/metricDefinitions
 *       ?api-version=2018-01-01
 *       -> the metrics a resource publishes: name, unit, primary
 *          aggregation, time grains
 *   GET {arm}{resource id}/providers/Microsoft.Insights/metrics
 *       ?api-version=2023-10-01&metricnames=a,b&timespan=start/end
 *       &interval=PT1M&aggregation=Average,Total
 *       -> per metric, its series' points
 *
 *   POST {arm}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01
 *       { subscriptions, query, options: { $top, $skipToken } }
 *       -> the rows of a Resource Graph query over the subscriptions
 *          (data[], $skipToken): the inventory's one listing of every
 *          resource with its tags and properties
 *   GET/POST anything else the inventory, the changes and the billing read,
 *       through get() and post() - always on the management host.
 *
 * Listing and metric definitions are free; Azure Monitor gives each
 * subscription its first million metric reads a month free.
 */

export const AZURE_SUBSCRIPTIONS_API_VERSION: string = "2022-12-01";
export const AZURE_RESOURCES_API_VERSION: string = "2021-04-01";
export const AZURE_METRIC_DEFINITIONS_API_VERSION: string = "2018-01-01";
export const AZURE_METRICS_API_VERSION: string = "2023-10-01";
export const AZURE_RESOURCE_GRAPH_API_VERSION: string = "2022-10-01";
// Rows of a Resource Graph page, and pages of one query at most.
const RESOURCE_GRAPH_PAGE_SIZE: number = 1000;
const RESOURCE_GRAPH_MAX_PAGES: number = 20;

const PROVIDER_TITLE: string = "Azure";
const MAX_LIST_PAGES: number = 50;

export interface AzureSubscription {
  subscriptionId: string;
  displayName: string;
  state: string;
}

export interface AzureResource {
  id: string;
  name: string;
  type: string;
  location: string;
  kind: string;
}

export interface AzureMetricDefinition {
  name: string;
  unit: string;
  primaryAggregationType: string;
  // ISO 8601 durations the metric is available at: PT1M, PT5M, PT1H...
  timeGrains: Array<string>;
}

export interface AzureMetricSeriesPoint {
  timeMs: number;
  value: number;
}

export interface AzureMetricSeries {
  metricName: string;
  unit: string;
  points: Array<AzureMetricSeriesPoint>;
}

export interface AzureArmOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftCloud;
  transport: CloudConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  budget?: CloudReadBudget | undefined;
}

export default class AzureArm {
  private options: AzureArmOptions;
  private tokens: EntraTokenClient;

  public constructor(options: AzureArmOptions) {
    this.options = options;
    this.tokens = new EntraTokenClient({
      tenantId: options.tenantId,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      cloud: options.cloud,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  public getManagementBaseUrl(): string {
    return EntraTokenClient.getEndpoints(this.options.cloud).managementBaseUrl;
  }

  // A GET on the management host, signed in as the app.
  public async getJson(url: string, step: string): Promise<JSONObject> {
    return await this.get(url, step);
  }

  // A POST of a JSON body on the management host, signed in as the app.
  public async post(
    url: string,
    body: JSONObject,
    step: string,
  ): Promise<JSONObject> {
    if (this.options.budget && !this.options.budget.take()) {
      throw new CloudReadBudgetSpent();
    }

    const token: string = await this.tokens.getAccessToken(
      this.getManagementBaseUrl(),
    );

    return await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "POST",
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      timeoutInMs: this.options.requestTimeoutInMs,
      step,
      providerTitle: PROVIDER_TITLE,
      secretValues: [this.options.clientSecret, token],
    });
  }

  /*
   * Every row of a Resource Graph query over the subscriptions, page by
   * page. `complete` is false when it stopped at RESOURCE_GRAPH_MAX_PAGES.
   */
  public async queryResourceGraph(data: {
    subscriptionIds: Array<string>;
    query: string;
  }): Promise<{ rows: Array<JSONObject>; complete: boolean }> {
    const url: string = `${this.getManagementBaseUrl()}/providers/Microsoft.ResourceGraph/resources?${buildQueryString(
      [["api-version", AZURE_RESOURCE_GRAPH_API_VERSION]],
    )}`;
    const rows: Array<JSONObject> = [];
    let skipToken: string = "";

    for (let page: number = 0; page < RESOURCE_GRAPH_MAX_PAGES; page++) {
      const options: JSONObject = {
        $top: RESOURCE_GRAPH_PAGE_SIZE,
        resultFormat: "objectArray",
      };

      if (skipToken) {
        options["$skipToken"] = skipToken;
      }

      const response: JSONObject = await this.post(
        url,
        {
          subscriptions: data.subscriptionIds,
          query: data.query,
          options,
        },
        "resource graph query",
      );

      for (const row of readArray(response["data"])) {
        rows.push(readObject(row));
      }

      const next: string = readText(response["$skipToken"]);

      if (!next || next === skipToken) {
        return { rows, complete: true };
      }

      skipToken = next;
    }

    return { rows, complete: false };
  }

  private async get(url: string, step: string): Promise<JSONObject> {
    if (this.options.budget && !this.options.budget.take()) {
      throw new CloudReadBudgetSpent();
    }

    const token: string = await this.tokens.getAccessToken(
      this.getManagementBaseUrl(),
    );

    return await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "GET",
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeoutInMs: this.options.requestTimeoutInMs,
      step,
      providerTitle: PROVIDER_TITLE,
      secretValues: [this.options.clientSecret, token],
    });
  }

  /*
   * Follow nextLink, but only on the management host: a link elsewhere is
   * not followed with the token.
   */
  private async listPaged(
    firstUrl: string,
    step: string,
  ): Promise<Array<JSONObject>> {
    const items: Array<JSONObject> = [];
    let url: string = firstUrl;
    const managementHost: string = new URL(this.getManagementBaseUrl()).host;

    for (let page: number = 0; page < MAX_LIST_PAGES && url; page++) {
      const response: JSONObject = await this.get(url, step);

      for (const item of readArray(response["value"])) {
        items.push(readObject(item));
      }

      const next: string = readText(response["nextLink"]);

      if (!next || next === url) {
        break;
      }

      let nextHost: string = "";

      try {
        nextHost = new URL(next).host;
      } catch {
        break;
      }

      if (nextHost !== managementHost) {
        break;
      }

      url = next;
    }

    return items;
  }

  public async listSubscriptions(): Promise<Array<AzureSubscription>> {
    const url: string = `${this.getManagementBaseUrl()}/subscriptions?${buildQueryString(
      [["api-version", AZURE_SUBSCRIPTIONS_API_VERSION]],
    )}`;

    return (await this.listPaged(url, "subscriptions request"))
      .map((subscription: JSONObject): AzureSubscription => {
        return {
          subscriptionId: readText(subscription["subscriptionId"]),
          displayName: readText(subscription["displayName"]),
          state: readText(subscription["state"]),
        };
      })
      .filter((subscription: AzureSubscription): boolean => {
        return Boolean(subscription.subscriptionId);
      });
  }

  public async listResources(
    subscriptionId: string,
    options: { firstPageOnly?: boolean | undefined } = {},
  ): Promise<Array<AzureResource>> {
    EntraTokenClient.validateGuid(subscriptionId, "Subscription ID");

    const url: string = `${this.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
      subscriptionId.trim(),
    )}/resources?${buildQueryString([
      ["api-version", AZURE_RESOURCES_API_VERSION],
      ["$top", 1000],
    ])}`;

    const items: Array<JSONObject> = options.firstPageOnly
      ? readArray((await this.get(url, "resources request"))["value"]).map(
          (item: unknown): JSONObject => {
            return readObject(item);
          },
        )
      : await this.listPaged(url, "resources request");

    return items
      .map((resource: JSONObject): AzureResource => {
        return {
          id: readText(resource["id"]),
          name: readText(resource["name"]),
          type: readText(resource["type"]),
          location: readText(resource["location"]),
          kind: readText(resource["kind"]),
        };
      })
      .filter((resource: AzureResource): boolean => {
        return Boolean(resource.id) && Boolean(resource.type);
      });
  }

  public async getMetricDefinitions(
    resourceId: string,
  ): Promise<Array<AzureMetricDefinition>> {
    AzureMonitorClient.assertResourceId(resourceId);

    const url: string = `${this.getManagementBaseUrl()}${resourceId}/providers/Microsoft.Insights/metricDefinitions?${buildQueryString(
      [["api-version", AZURE_METRIC_DEFINITIONS_API_VERSION]],
    )}`;

    const response: JSONObject = await this.get(
      url,
      "metric definitions request",
    );

    return readArray(response["value"])
      .map((raw: unknown): AzureMetricDefinition => {
        const definition: JSONObject = readObject(raw);

        return {
          name: readText(readObject(definition["name"])["value"]),
          unit: readText(definition["unit"]),
          primaryAggregationType: readText(
            definition["primaryAggregationType"],
          ),
          timeGrains: readArray(definition["metricAvailabilities"])
            .map((availability: unknown): string => {
              return readText(readObject(availability)["timeGrain"]);
            })
            .filter((grain: string): boolean => {
              return Boolean(grain);
            }),
        };
      })
      .filter((definition: AzureMetricDefinition): boolean => {
        return Boolean(definition.name);
      });
  }

  /*
   * The points of some metrics of one resource over [start, end), each read
   * with its own aggregation: one call whatever their number (Azure takes
   * up to 20 metrics a call).
   */
  public async getMetrics(data: {
    resourceId: string;
    metrics: Array<{ name: string; aggregation: string }>;
    interval: string;
    start: Date;
    end: Date;
  }): Promise<Array<AzureMetricSeries>> {
    AzureMonitorClient.assertResourceId(data.resourceId);

    const aggregations: Array<string> = Array.from(
      new Set(
        data.metrics.map((metric: { aggregation: string }): string => {
          return metric.aggregation;
        }),
      ),
    );

    const url: string = `${this.getManagementBaseUrl()}${data.resourceId}/providers/Microsoft.Insights/metrics?${buildQueryString(
      [
        ["api-version", AZURE_METRICS_API_VERSION],
        [
          "metricnames",
          data.metrics
            .map((metric: { name: string }): string => {
              return metric.name;
            })
            .join(","),
        ],
        ["timespan", `${data.start.toISOString()}/${data.end.toISOString()}`],
        ["interval", data.interval],
        ["aggregation", aggregations.join(",")],
      ],
    )}`;

    const response: JSONObject = await this.get(url, "metrics request");
    const aggregationOf: Dictionary<string> = {};

    for (const metric of data.metrics) {
      aggregationOf[metric.name.toLowerCase()] = metric.aggregation;
    }

    return AzureArm.readMetricSeries(response, aggregationOf);
  }

  /*
   * Each metric's points, the value of its own aggregation. A point Azure
   * has no value for (no data that minute) is left out.
   */
  public static readMetricSeries(
    response: JSONObject,
    aggregationOf: Dictionary<string>,
  ): Array<AzureMetricSeries> {
    const series: Array<AzureMetricSeries> = [];

    for (const rawMetric of readArray(response["value"])) {
      const metric: JSONObject = readObject(rawMetric);
      const name: string = readText(readObject(metric["name"])["value"]);
      const aggregation: string = aggregationOf[name.toLowerCase()] || "";
      // average, total, maximum, minimum, count - lowercased in the answer.
      const field: string =
        aggregation.charAt(0).toLowerCase() + aggregation.slice(1);
      const points: Array<AzureMetricSeriesPoint> = [];

      for (const rawSeries of readArray(metric["timeseries"])) {
        for (const rawPoint of readArray(readObject(rawSeries)["data"])) {
          const point: JSONObject = readObject(rawPoint);
          const value: unknown = point[field];
          const time: number = Date.parse(readText(point["timeStamp"]));

          if (
            typeof value === "number" &&
            Number.isFinite(value) &&
            Number.isFinite(time)
          ) {
            points.push({ timeMs: time, value });
          }
        }
      }

      if (name && points.length > 0) {
        series.push({
          metricName: name,
          unit: readText(metric["unit"]),
          points,
        });
      }
    }

    return series;
  }
}

import { AZURE_MAX_SPLIT_SERIES_PER_METRIC } from "../../../../Types/Cloud/CloudKeyMetrics";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
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
import { withCloudRetries } from "../CloudRetry";

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
 *       [&$filter=EntityName eq '*'&top=1000&ValidateDimensions=false]
 *       -> per metric, its series' points - with the filter, one series
 *          per value of the dimension (metadatavalues), up to `top` of
 *          them; a metric Azure could not read says so in its errorCode
 *          while the others are answered. There is no next page.
 *
 *   POST {arm}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01
 *       { subscriptions, query, options: { $top, $skipToken } }
 *       -> the rows of a Resource Graph query over the subscriptions
 *          (data[], $skipToken): the inventory's one listing of every
 *          resource with its tags and properties
 *   GET/POST anything else the inventory, the changes and the billing read,
 *       through get() and post() - always on the management host.
 *
 *   GET https://{account}.blob.core.windows.net/... (getStorageText,
 *       getStorageBytes)
 *       -> Azure Storage's data plane, for Data Security's content scans:
 *          signed in with a token for Azure Storage instead, which a data
 *          role (Storage Blob Data Reader) authorizes; listings answered
 *          in XML, a blob's first bytes as its bytes.
 *   PATCH {arm}{resource id}?api-version=... (patch)
 *       -> one setting of one resource changed, for Data Security's
 *          response actions: only with the connection's opt-in write role.
 *
 * Listing and metric definitions are free; Azure Monitor gives each
 * subscription its first million metric reads a month free.
 */

export const AZURE_SUBSCRIPTIONS_API_VERSION: string = "2022-12-01";
export const AZURE_RESOURCES_API_VERSION: string = "2021-04-01";
export const AZURE_METRIC_DEFINITIONS_API_VERSION: string = "2018-01-01";
export const AZURE_METRICS_API_VERSION: string = "2023-10-01";
export const AZURE_RESOURCE_GRAPH_API_VERSION: string = "2022-10-01";
export const AZURE_ACTIVITY_LOG_API_VERSION: string = "2015-04-01";
// The fields of an Activity Log event read: never its claims or request.
/*
 * Of each Activity Log event: what a change and a health event are made of,
 * and what Security Events' Cloud audit logs name besides - the caller's
 * address (httpRequest), the operation's correlation and its subscription.
 */
const ACTIVITY_LOG_FIELDS: string =
  "eventDataId,eventTimestamp,operationName,status,caller,resourceId,category,level,properties,resourceType,httpRequest,correlationId,subscriptionId";
// Rows of a Resource Graph page, and pages of one query at most.
const RESOURCE_GRAPH_PAGE_SIZE: number = 1000;
const RESOURCE_GRAPH_MAX_PAGES: number = 20;

const PROVIDER_TITLE: string = "Azure";
const MAX_LIST_PAGES: number = 50;

/*
 * Azure Storage's sign-in resource is the same in every cloud; only the
 * hosts its accounts answer on differ (core.windows.net, Azure
 * Government's core.usgovcloudapi.net).
 */
export const AZURE_STORAGE_RESOURCE: string = "https://storage.azure.com";
// The Blob service REST version the data-plane calls are made in.
export const AZURE_STORAGE_SERVICE_VERSION: string = "2023-11-03";
const AZURE_STORAGE_SUFFIXES: Record<MicrosoftCloud, string> = {
  public: "core.windows.net",
  usgov: "core.usgovcloudapi.net",
};

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

export interface AzureMetricDimensionValue {
  // As Azure Monitor answers it: lowercased ("entityname").
  name: string;
  value: string;
}

export interface AzureMetricSeries {
  metricName: string;
  unit: string;
  points: Array<AzureMetricSeriesPoint>;
  /*
   * The value of each dimension the read was split by ("entityname" =
   * "orders"); none for a read split by nothing.
   */
  dimensions: Array<AzureMetricDimensionValue>;
}

// A metric of a call that Azure Monitor could not read, while it read the others.
export interface AzureMetricFailure {
  metricName: string;
  code: string;
  message: string;
}

// What one metrics call answered.
export interface AzureMetricsAnswer {
  series: Array<AzureMetricSeries>;
  failures: Array<AzureMetricFailure>;
  /*
   * The metrics of a split read that came back with as many series as it
   * asked for at most (`top`): the resource has more values of the
   * dimension than were read.
   */
  capped: Array<string>;
}

// A dimension name a split read may name in its filter: letters and digits.
const DIMENSION_NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export interface AzureArmOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftCloud;
  transport: CloudConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  budget?: CloudReadBudget | undefined;
  // Waits before asking a throttled request again (CloudRetry); setTimeout when absent.
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
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

  /*
   * A token for one of the cloud's data planes - an Event Hubs namespace's
   * own address, https://<namespace>.servicebus.windows.net - signed in as
   * the app. The role the app holds there decides what it may do: Azure
   * Event Hubs Data Receiver, read only.
   */
  public async getDataPlaneToken(resource: string): Promise<string> {
    return await this.tokens.getAccessToken(resource);
  }

  // The suffix of the cloud's storage hosts: blob.<suffix>, queue.<suffix>.
  public getStorageSuffix(): string {
    return AZURE_STORAGE_SUFFIXES[this.options.cloud];
  }

  /*
   * A GET on Azure Storage's Blob service - a container's blobs, the
   * account's containers - signed in as the app with a token for Azure
   * Storage. The Blob service lists in XML, so this returns the answer's
   * text.
   */
  public async getStorageText(data: {
    url: string;
    step: string;
    headers?: Dictionary<string> | undefined;
  }): Promise<string> {
    const response: DataSourceHttpResponse = await this.getStorage({
      ...data,
      keepBodyBytes: false,
    });

    return response.bodyText || "";
  }

  /*
   * The same GET for a blob's own bytes - a gzip, a spreadsheet - exactly
   * as they came. A transport that keeps no bytes gives its text's UTF-8.
   */
  public async getStorageBytes(data: {
    url: string;
    step: string;
    headers?: Dictionary<string> | undefined;
  }): Promise<Buffer> {
    const response: DataSourceHttpResponse = await this.getStorage({
      ...data,
      keepBodyBytes: true,
    });

    return response.bodyBytes || Buffer.from(response.bodyText || "", "utf8");
  }

  /*
   * One data-plane GET. The token goes only to the cloud's own blob hosts:
   * any other URL is refused before anything is sent.
   */
  private async getStorage(data: {
    url: string;
    step: string;
    headers?: Dictionary<string> | undefined;
    keepBodyBytes: boolean;
  }): Promise<DataSourceHttpResponse> {
    let host: string = "";

    try {
      host = new URL(data.url).host.toLowerCase();
    } catch {
      host = "";
    }

    if (!host.endsWith(`.blob.${this.getStorageSuffix()}`)) {
      throw new BadDataException(
        `Azure Storage ${data.step} must go to a blob host of the connection's cloud.`,
      );
    }

    // Storage answers a burst with 503 Server Busy: each try is a request of the budget.
    return await withCloudRetries({
      sleep: this.options.sleep,
      call: async (): Promise<DataSourceHttpResponse> => {
        if (this.options.budget && !this.options.budget.take()) {
          throw new CloudReadBudgetSpent();
        }

        const token: string = await this.tokens.getAccessToken(
          AZURE_STORAGE_RESOURCE,
        );

        return await LlmProviderHttp.send({
          transport: this.options.transport,
          method: "GET",
          url: data.url,
          headers: {
            ...(data.headers || {}),
            Authorization: `Bearer ${token}`,
            "x-ms-version": AZURE_STORAGE_SERVICE_VERSION,
          },
          timeoutInMs: this.options.requestTimeoutInMs,
          keepBodyBytes: data.keepBodyBytes,
          step: data.step,
          providerTitle: PROVIDER_TITLE,
          secretValues: [this.options.clientSecret, token],
        });
      },
    });
  }

  /*
   * Every item (value[]) of a listing on the management host, page by
   * page. `complete` is false when it stopped at MAX_LIST_PAGES.
   */
  public async listAll(
    url: string,
    step: string,
  ): Promise<{ items: Array<JSONObject>; complete: boolean }> {
    return await this.listPagedWithEnd(url, step);
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
    // Resource Graph answers a burst with 429: each try is a request of the budget.
    return await withCloudRetries({
      sleep: this.options.sleep,
      call: async (): Promise<JSONObject> => {
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
      },
    });
  }

  /*
   * A PATCH of a JSON body on the management host, signed in as the app: a
   * change to one setting of one resource, for Data Security's response
   * actions - which Azure lets the app make only once the connection's
   * "Data security response" setting has given it a role that may write.
   * The token goes only to the management host; any other URL is refused
   * before anything is sent. The answer's JSON, or {} when it has none
   * (202 Accepted).
   */
  public async patch(
    url: string,
    body: JSONObject,
    step: string,
  ): Promise<JSONObject> {
    return await this.write("PATCH", url, body, step);
  }

  /*
   * A PUT of a JSON body on the management host, for a resource Azure
   * changes only whole - a storage account's blob service - so the caller
   * sends back what it read, with its one change. Held to the management
   * host as a PATCH is.
   */
  public async put(
    url: string,
    body: JSONObject,
    step: string,
  ): Promise<JSONObject> {
    return await this.write("PUT", url, body, step);
  }

  private async write(
    method: "PATCH" | "PUT",
    url: string,
    body: JSONObject,
    step: string,
  ): Promise<JSONObject> {
    let host: string = "";

    try {
      host = new URL(url).host;
    } catch {
      host = "";
    }

    if (host !== new URL(this.getManagementBaseUrl()).host) {
      throw new BadDataException(
        `Azure ${step} must go to the connection's Resource Manager host.`,
      );
    }

    // A setting set twice is set once: a throttled try is asked again.
    return await withCloudRetries({
      sleep: this.options.sleep,
      call: async (): Promise<JSONObject> => {
        if (this.options.budget && !this.options.budget.take()) {
          throw new CloudReadBudgetSpent();
        }

        const token: string = await this.tokens.getAccessToken(
          this.getManagementBaseUrl(),
        );

        const response: DataSourceHttpResponse = await LlmProviderHttp.send({
          transport: this.options.transport,
          method,
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

        return readObject(response.bodyJson);
      },
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

  /*
   * A subscription's Activity Log events in [start, end): its
   * administrative operations and its service and resource health events,
   * page by page (nextLink), newest first as Azure lists them. `complete`
   * is false when it stopped at MAX_LIST_PAGES.
   */
  public async listActivityLog(data: {
    subscriptionId: string;
    start: Date;
    end: Date;
  }): Promise<{ events: Array<JSONObject>; complete: boolean }> {
    EntraTokenClient.validateGuid(data.subscriptionId, "Subscription ID");

    const filter: string = `eventTimestamp ge '${data.start.toISOString()}' and eventTimestamp le '${data.end.toISOString()}'`;
    const url: string = `${this.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
      data.subscriptionId.trim(),
    )}/providers/Microsoft.Insights/eventtypes/management/values?${buildQueryString(
      [
        ["api-version", AZURE_ACTIVITY_LOG_API_VERSION],
        ["$filter", filter],
        ["$select", ACTIVITY_LOG_FIELDS],
      ],
    )}`;

    const listed: { items: Array<JSONObject>; complete: boolean } =
      await this.listPagedWithEnd(url, "activity log request");

    return { events: listed.items, complete: listed.complete };
  }

  private async get(url: string, step: string): Promise<JSONObject> {
    return await withCloudRetries({
      sleep: this.options.sleep,
      call: async (): Promise<JSONObject> => {
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
      },
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
    return (await this.listPagedWithEnd(firstUrl, step)).items;
  }

  // The pages and whether they ended: false when MAX_LIST_PAGES stopped them.
  private async listPagedWithEnd(
    firstUrl: string,
    step: string,
  ): Promise<{ items: Array<JSONObject>; complete: boolean }> {
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
        return { items, complete: true };
      }

      let nextHost: string = "";

      try {
        nextHost = new URL(next).host;
      } catch {
        return { items, complete: true };
      }

      if (nextHost !== managementHost) {
        return { items, complete: true };
      }

      url = next;
    }

    return { items, complete: false };
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
   * up to 20 metrics a call). Split by a dimension (`splitBy`: a Service
   * Bus namespace's EntityName), the same one call answers a series per
   * value of it - each queue and topic - up to `top` per metric, in place
   * of the resource's one total. ValidateDimensions=false: a metric
   * without the dimension is answered whole rather than failing the call.
   */
  public async getMetrics(data: {
    resourceId: string;
    metrics: Array<{ name: string; aggregation: string }>;
    interval: string;
    start: Date;
    end: Date;
    splitBy?: string | undefined;
    top?: number | undefined;
  }): Promise<AzureMetricsAnswer> {
    AzureMonitorClient.assertResourceId(data.resourceId);

    const splitBy: string = (data.splitBy || "").trim();

    if (splitBy && !DIMENSION_NAME_PATTERN.test(splitBy)) {
      throw new BadDataException(`Cannot split metrics by "${splitBy}".`);
    }

    const top: number =
      data.top && Number.isInteger(data.top) && data.top > 0
        ? data.top
        : AZURE_MAX_SPLIT_SERIES_PER_METRIC;

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
        ...(splitBy
          ? ([
              ["$filter", `${splitBy} eq '*'`],
              ["top", top],
              ["ValidateDimensions", "false"],
            ] as Array<[string, string | number]>)
          : []),
      ],
    )}`;

    const response: JSONObject = await this.get(url, "metrics request");
    const aggregationOf: Dictionary<string> = {};

    for (const metric of data.metrics) {
      aggregationOf[metric.name.toLowerCase()] = metric.aggregation;
    }

    return {
      series: AzureArm.readMetricSeries(response, aggregationOf),
      failures: AzureArm.readMetricFailures(response),
      capped: splitBy ? AzureArm.readCappedMetrics(response, top) : [],
    };
  }

  /*
   * Each series' points, the value of its metric's own aggregation, with
   * the dimension values that tell it apart: one series per element of a
   * metric's timeseries (one, unsplit; one per queue or topic, split). A
   * point Azure has no value for (no data that minute) is left out, and so
   * is a series left without any.
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

      if (!name) {
        continue;
      }

      for (const rawSeries of readArray(metric["timeseries"])) {
        const timeseries: JSONObject = readObject(rawSeries);
        const points: Array<AzureMetricSeriesPoint> = [];

        for (const rawPoint of readArray(timeseries["data"])) {
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

        if (points.length === 0) {
          continue;
        }

        series.push({
          metricName: name,
          unit: readText(metric["unit"]),
          points,
          dimensions: AzureArm.readDimensionValues(timeseries),
        });
      }
    }

    return series;
  }

  // A series' dimension values, each name lowercased as Azure answers it.
  private static readDimensionValues(
    timeseries: JSONObject,
  ): Array<AzureMetricDimensionValue> {
    const dimensions: Array<AzureMetricDimensionValue> = [];

    for (const raw of readArray(timeseries["metadatavalues"])) {
      const metadata: JSONObject = readObject(raw);
      const name: string = readText(readObject(metadata["name"])["value"])
        .trim()
        .toLowerCase();

      if (name) {
        dimensions.push({ name, value: readText(metadata["value"]) });
      }
    }

    return dimensions;
  }

  /*
   * The metrics Azure Monitor answered with an error of their own (an
   * errorCode other than Success): the call's other metrics are answered.
   */
  public static readMetricFailures(
    response: JSONObject,
  ): Array<AzureMetricFailure> {
    const failures: Array<AzureMetricFailure> = [];

    for (const rawMetric of readArray(response["value"])) {
      const metric: JSONObject = readObject(rawMetric);
      const code: string = readText(metric["errorCode"]).trim();

      if (!code || code.toLowerCase() === "success") {
        continue;
      }

      failures.push({
        metricName: readText(readObject(metric["name"])["value"]),
        code,
        message: readText(metric["errorMessage"]),
      });
    }

    return failures;
  }

  // The metrics answered with `top` series or more: there were more to read.
  public static readCappedMetrics(
    response: JSONObject,
    top: number,
  ): Array<string> {
    const capped: Array<string> = [];

    for (const rawMetric of readArray(response["value"])) {
      const metric: JSONObject = readObject(rawMetric);
      const name: string = readText(readObject(metric["name"])["value"]);

      if (name && readArray(metric["timeseries"]).length >= top) {
        capped.push(name);
      }
    }

    return capped;
  }
}

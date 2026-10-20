import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmProviderHttp";
import EntraTokenClient, {
  MicrosoftCloud,
} from "../Microsoft/EntraTokenClient";

/*
 * Azure Resource Manager and Azure Monitor, the parts the Azure OpenAI /
 * Microsoft Foundry connection reads, signed in as an app registration with
 * the Monitoring Reader role on the subscription:
 *
 *   GET {arm}/subscriptions/{id}/providers/Microsoft.CognitiveServices/accounts
 *       ?api-version=2024-10-01                  the resources (value[], nextLink)
 *   GET {arm}{account id}/deployments?api-version=2024-10-01
 *       deployment name -> the model it serves (properties.model.name)
 *   GET {arm}{account id}/providers/Microsoft.Insights/metrics
 *       ?api-version=2023-10-01&metricnames=...&timespan=start/end
 *       &interval=P1D&aggregation=Total&$filter=<dim> eq '*'&top=...
 *
 * Metrics, from "Supported metrics - Microsoft.CognitiveServices/accounts":
 * InputTokens, OutputTokens and ModelRequests (Models - Usage / HTTP
 * Requests, dimensions ModelDeploymentName and ModelName), and the older
 * ProcessedPromptTokens, GeneratedTokens and AzureOpenAIRequests (Azure
 * OpenAI - Usage / HTTP Requests), which name only the deployment. The
 * response is { value: [{ name: { value }, timeseries: [{ metadatavalues:
 * [{ name: { value }, value }], data: [{ timeStamp, total }] }] }] }, with
 * dimension names in lower case.
 */

export const AZURE_RESOURCE_API_VERSION: string = "2024-10-01";
export const AZURE_METRICS_API_VERSION: string = "2023-10-01";

// The resource kinds that serve models: Azure OpenAI and Foundry (AI Services).
export const AZURE_MODEL_ACCOUNT_KINDS: Array<string> = ["openai", "aiservices"];

// Series per metric a request returns (Azure's default is 10).
const METRICS_TOP: number = 500;
const MAX_LIST_PAGES: number = 20;

export interface AzureModelAccount {
  id: string;
  name: string;
  kind: string;
  location: string;
}

export interface AzureMetricPoint {
  metric: string;
  day: Date;
  total: number;
  // Lower-cased dimension name -> value.
  dimensions: Dictionary<string>;
}

export interface AzureMonitorClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  cloud: MicrosoftCloud;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
}

const PROVIDER_TITLE: string = "Azure";

export default class AzureMonitorClient {
  private options: AzureMonitorClientOptions;
  private tokens: EntraTokenClient;
  private requestCount: number = 0;

  public constructor(options: AzureMonitorClientOptions) {
    EntraTokenClient.validateGuid(options.subscriptionId, "Subscription ID");

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

  public getRequestCount(): number {
    return this.requestCount + this.tokens.getRequestCount();
  }

  private getManagementBaseUrl(): string {
    return EntraTokenClient.getEndpoints(this.options.cloud).managementBaseUrl;
  }

  private async get(url: string, step: string): Promise<JSONObject> {
    const token: string = await this.tokens.getAccessToken(
      this.getManagementBaseUrl(),
    );

    this.requestCount++;

    return await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "GET",
      url: url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeoutInMs: this.options.requestTimeoutInMs,
      step: step,
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

    for (let index: number = 0; index < MAX_LIST_PAGES && url; index++) {
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

  // The subscription's Azure OpenAI and Foundry resources.
  public async listModelAccounts(): Promise<Array<AzureModelAccount>> {
    const url: string = `${this.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
      this.options.subscriptionId.trim(),
    )}/providers/Microsoft.CognitiveServices/accounts?${buildQueryString([
      ["api-version", AZURE_RESOURCE_API_VERSION],
    ])}`;

    return (await this.listPaged(url, "resources request"))
      .map((account: JSONObject): AzureModelAccount => {
        return {
          id: readText(account["id"]),
          name: readText(account["name"]),
          kind: readText(account["kind"]),
          location: readText(account["location"]),
        };
      })
      .filter((account: AzureModelAccount): boolean => {
        return (
          Boolean(account.id) &&
          AZURE_MODEL_ACCOUNT_KINDS.includes(account.kind.toLowerCase())
        );
      });
  }

  // Deployment name -> the model it serves.
  public async listDeploymentModels(
    accountId: string,
  ): Promise<Map<string, string>> {
    AzureMonitorClient.assertResourceId(accountId);

    const url: string = `${this.getManagementBaseUrl()}${accountId}/deployments?${buildQueryString(
      [["api-version", AZURE_RESOURCE_API_VERSION]],
    )}`;
    const models: Map<string, string> = new Map();

    for (const deployment of await this.listPaged(url, "deployments request")) {
      const name: string = readText(deployment["name"]);
      const model: JSONObject = readObject(
        readObject(deployment["properties"])["model"],
      );

      if (name) {
        models.set(name, readText(model["name"]) || name);
      }
    }

    return models;
  }

  /*
   * Daily totals of some metrics of one resource, split by one or more
   * dimensions (each filtered with '*').
   */
  public async getDailyMetrics(data: {
    accountId: string;
    metricNames: Array<string>;
    dimensions: Array<string>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<AzureMetricPoint>> {
    AzureMonitorClient.assertResourceId(data.accountId);

    const filter: string = data.dimensions
      .map((dimension: string): string => {
        return `${dimension} eq '*'`;
      })
      .join(" and ");

    const url: string = `${this.getManagementBaseUrl()}${data.accountId}/providers/Microsoft.Insights/metrics?${buildQueryString(
      [
        ["api-version", AZURE_METRICS_API_VERSION],
        ["metricnames", data.metricNames.join(",")],
        [
          "timespan",
          `${data.startTime.toISOString()}/${data.endTime.toISOString()}`,
        ],
        ["interval", "P1D"],
        ["aggregation", "Total"],
        ["$filter", filter],
        ["top", METRICS_TOP],
      ],
    )}`;

    const response: JSONObject = await this.get(url, "metrics request");

    return AzureMonitorClient.readMetricPoints(response);
  }

  public static readMetricPoints(response: JSONObject): Array<AzureMetricPoint> {
    const points: Array<AzureMetricPoint> = [];

    for (const rawMetric of readArray(response["value"])) {
      const metric: JSONObject = readObject(rawMetric);
      const metricName: string = readText(readObject(metric["name"])["value"]);

      for (const rawSeries of readArray(metric["timeseries"])) {
        const series: JSONObject = readObject(rawSeries);
        const dimensions: Dictionary<string> = {};

        for (const rawValue of readArray(series["metadatavalues"])) {
          const value: JSONObject = readObject(rawValue);
          const name: string = readText(
            readObject(value["name"])["value"],
          ).toLowerCase();

          if (name) {
            dimensions[name] = readText(value["value"]);
          }
        }

        for (const rawPoint of readArray(series["data"])) {
          const point: JSONObject = readObject(rawPoint);
          const total: number = Number(point["total"]);
          const time: number = Date.parse(readText(point["timeStamp"]));

          if (!Number.isFinite(total) || total === 0 || !Number.isFinite(time)) {
            continue;
          }

          const date: Date = new Date(time);

          points.push({
            metric: metricName,
            day: new Date(
              Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDate(),
              ),
            ),
            total: total,
            dimensions: dimensions,
          });
        }
      }
    }

    return points;
  }

  /*
   * A resource id is put into a URL path: only the shape Resource Manager
   * gives (/subscriptions/.../providers/...), nothing that could leave the
   * path.
   */
  public static assertResourceId(id: string): void {
    if (
      !id.startsWith("/subscriptions/") ||
      id.includes("?") ||
      id.includes("#") ||
      id.includes("..") ||
      id.includes("//") ||
      id.length > 1000
    ) {
      throw new BadDataException(`Not an Azure resource id: ${id.substring(0, 100)}`);
    }
  }
}

import { LlmConnectionKind } from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import {
  LlmConnectionSettings,
  LlmConnectorCallOptions,
  LlmProviderAccountConnector,
  LlmUsageFetchResult,
  LlmUsageWindow,
  getSecretValues,
  readSetting,
} from "../../LlmConnectorTypes";
import LlmConnectorTestResults, {
  LLM_CONNECTION_TEST_DAYS,
} from "../../LlmConnectorTestResults";
import LlmUsageDays from "../../LlmUsageDays";
import EntraTokenClient from "../Microsoft/EntraTokenClient";
import AzureMonitorClient, {
  AzureMetricPoint,
  AzureModelAccount,
} from "./AzureMonitorClient";

/*
 * Every Azure OpenAI and Microsoft Foundry resource of a subscription, read
 * from Azure Monitor's platform metrics: tokens and requests per day, per
 * resource and model. Azure Monitor counts tokens, not money, and names no
 * person or key, so the cost is OneUptime's list-price estimate
 * (LlmUsageCost) and the person and key stay empty.
 *
 * The newer per-model metrics (InputTokens, OutputTokens, ModelRequests,
 * split by ModelName) are read first. A resource that has none of them -
 * an older Azure OpenAI resource - is read from ProcessedPromptTokens,
 * GeneratedTokens and AzureOpenAIRequests, split by deployment, and each
 * deployment is named by the model it serves.
 */

const MODEL_METRICS: Array<string> = [
  "InputTokens",
  "OutputTokens",
  "ModelRequests",
  "cacheReadInputTokens",
  "ephemeral5mInputTokens",
  "ephemeral1hInputTokens",
];

const LEGACY_METRICS: Array<string> = [
  "ProcessedPromptTokens",
  "GeneratedTokens",
  "AzureOpenAIRequests",
];

// Resources read in one pull, so a sprawling subscription stays bounded.
const MAX_ACCOUNTS: number = 50;

export default class AzureOpenAIConnector
  implements LlmProviderAccountConnector
{
  public provider: LlmConnectionProvider = LlmConnectionProvider.AzureOpenAI;
  public kind: LlmConnectionKind.ProviderAccount =
    LlmConnectionKind.ProviderAccount;

  public validateSettings(settings: LlmConnectionSettings): void {
    EntraTokenClient.validateTenantId(readSetting(settings.config, "tenantId"));
    EntraTokenClient.validateGuid(
      readSetting(settings.config, "clientId"),
      "Application (client) ID",
    );
    EntraTokenClient.validateGuid(
      readSetting(settings.config, "subscriptionId"),
      "Subscription ID",
    );
    EntraTokenClient.resolveCloud(readSetting(settings.config, "cloud"));
  }

  private createClient(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): AzureMonitorClient {
    return new AzureMonitorClient({
      tenantId: readSetting(settings.config, "tenantId"),
      clientId: readSetting(settings.config, "clientId"),
      subscriptionId: readSetting(settings.config, "subscriptionId"),
      cloud: EntraTokenClient.resolveCloud(readSetting(settings.config, "cloud")),
      clientSecret: readSetting(settings.secrets, "clientSecret"),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  /*
   * One record per day and model of a resource, from the per-model metrics
   * (dimension modelname) or, with `deploymentModels`, the per-deployment
   * ones (dimension modeldeploymentname).
   */
  public static toRecords(data: {
    account: AzureModelAccount;
    points: Array<AzureMetricPoint>;
    deploymentModels?: Map<string, string> | undefined;
  }): Array<LlmUsageRecord> {
    const records: Map<string, LlmUsageRecord> = new Map();

    for (const point of data.points) {
      const deployment: string = point.dimensions["modeldeploymentname"] || "";
      const model: string = data.deploymentModels
        ? data.deploymentModels.get(deployment) || deployment
        : point.dimensions["modelname"] || deployment;

      const key: string = `${point.day.getTime()}|${model}`;
      let record: LlmUsageRecord | undefined = records.get(key);

      if (!record) {
        record = {
          day: point.day,
          model: model,
          person: "",
          project: data.account.name,
          apiKey: "",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requests: 0,
          costUsd: null,
        };
        records.set(key, record);
      }

      switch (point.metric) {
        case "InputTokens":
        case "ProcessedPromptTokens":
          record.inputTokens += point.total;
          break;
        case "OutputTokens":
        case "GeneratedTokens":
          record.outputTokens += point.total;
          break;
        case "ModelRequests":
        case "AzureOpenAIRequests":
          record.requests = (record.requests || 0) + point.total;
          break;
        case "cacheReadInputTokens":
          record.cacheReadTokens += point.total;
          break;
        case "ephemeral5mInputTokens":
        case "ephemeral1hInputTokens":
          record.cacheWriteTokens += point.total;
          break;
        default:
          break;
      }
    }

    return Array.from(records.values());
  }

  private async readAccount(data: {
    client: AzureMonitorClient;
    account: AzureModelAccount;
    window: LlmUsageWindow;
  }): Promise<Array<LlmUsageRecord>> {
    const points: Array<AzureMetricPoint> = await data.client.getDailyMetrics({
      accountId: data.account.id,
      metricNames: MODEL_METRICS,
      dimensions: ["ModelDeploymentName", "ModelName"],
      startTime: data.window.startDay,
      endTime: data.window.endDay,
    });

    if (points.length > 0) {
      return AzureOpenAIConnector.toRecords({
        account: data.account,
        points,
      });
    }

    const legacyPoints: Array<AzureMetricPoint> =
      await data.client.getDailyMetrics({
        accountId: data.account.id,
        metricNames: LEGACY_METRICS,
        dimensions: ["ModelDeploymentName"],
        startTime: data.window.startDay,
        endTime: data.window.endDay,
      });

    if (legacyPoints.length === 0) {
      return [];
    }

    return AzureOpenAIConnector.toRecords({
      account: data.account,
      points: legacyPoints,
      deploymentModels: await data.client.listDeploymentModels(data.account.id),
    });
  }

  public async fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult> {
    const client: AzureMonitorClient = this.createClient(settings, options);
    const warnings: Array<string> = [];

    const accounts: Array<AzureModelAccount> = await client.listModelAccounts();

    if (accounts.length > MAX_ACCOUNTS) {
      warnings.push(
        `The subscription has ${accounts.length} Azure OpenAI and Foundry resources; the first ${MAX_ACCOUNTS} are read.`,
      );
    }

    const records: Array<LlmUsageRecord> = [];

    for (const account of accounts.slice(0, MAX_ACCOUNTS)) {
      records.push(
        ...(await this.readAccount({ client, account, window })),
      );
    }

    return {
      records,
      requestCount: client.getRequestCount(),
      warnings,
    };
  }

  public async testConnection(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): Promise<LlmConnectionTestResult> {
    const startedAt: number = Date.now();
    const now: Date = options.now ? options.now() : new Date();
    const endDay: Date = LlmUsageDays.addDays(LlmUsageDays.startOfUtcDay(now), 1);
    const startDay: Date = LlmUsageDays.addDays(endDay, -LLM_CONNECTION_TEST_DAYS);

    try {
      this.validateSettings(settings);

      const result: LlmUsageFetchResult = await this.fetchUsage(
        settings,
        { startDay, endDay },
        options,
      );

      const test: LlmConnectionTestResult = LlmConnectorTestResults.fromUsage({
        provider: this.provider,
        records: result.records,
        days: LLM_CONNECTION_TEST_DAYS,
        durationMs: Date.now() - startedAt,
      });

      test.counts = {
        ...test.counts,
        resources: new Set(
          result.records.map((record: LlmUsageRecord): string => {
            return record.project;
          }),
        ).size,
      };

      return test;
    } catch (error) {
      return LlmConnectorTestResults.fromError({
        provider: this.provider,
        error,
        secretValues: getSecretValues(settings),
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

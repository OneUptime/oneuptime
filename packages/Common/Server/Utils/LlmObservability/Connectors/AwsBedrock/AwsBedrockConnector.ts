import BadDataException from "../../../../../Types/Exception/BadDataException";
import { LlmConnectionKind } from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import AwsSecurityHubClient from "../../../SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
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
import CloudWatchClient, {
  CloudWatchMetricQuery,
  CloudWatchMetricResult,
} from "./CloudWatchClient";

/*
 * Amazon Bedrock in one or more AWS Regions, read from the AWS/Bedrock
 * CloudWatch metrics Bedrock publishes for every model invocation:
 * InputTokenCount, OutputTokenCount, CacheReadInputTokenCount,
 * CacheWriteInputTokenCount and Invocations, per ModelId, summed by UTC day.
 * CloudWatch counts tokens, not money, and names no person or key: the cost
 * is OneUptime's list-price estimate, and the Region is the project.
 *
 * The ModelId-only series is read; Bedrock also publishes a ModelId +
 * ContextWindow series, which is a subset of it (AWS's Bedrock monitoring
 * guide), so adding it would count long-context calls twice.
 */

export const BEDROCK_NAMESPACE: string = "AWS/Bedrock";

const METRICS: Array<string> = [
  "InputTokenCount",
  "OutputTokenCount",
  "CacheReadInputTokenCount",
  "CacheWriteInputTokenCount",
  "Invocations",
];

// Regions one connection reads, so a typo cannot fan out into dozens.
const MAX_REGIONS: number = 10;
// Models read per Region.
const MAX_MODELS_PER_REGION: number = 100;

export default class AwsBedrockConnector
  implements LlmProviderAccountConnector
{
  public provider: LlmConnectionProvider = LlmConnectionProvider.AwsBedrock;
  public kind: LlmConnectionKind.ProviderAccount =
    LlmConnectionKind.ProviderAccount;

  // The Regions of the setting, trimmed and without repeats.
  public static readRegions(value: string): Array<string> {
    return Array.from(
      new Set<string>(
        (value || "")
          .split(",")
          .map((region: string): string => {
            return region.trim().toLowerCase();
          })
          .filter((region: string): boolean => {
            return region.length > 0;
          }),
      ),
    );
  }

  public validateSettings(settings: LlmConnectionSettings): void {
    AwsSecurityHubClient.validateAccessKeyId(
      readSetting(settings.config, "accessKeyId"),
    );

    const regions: Array<string> = AwsBedrockConnector.readRegions(
      readSetting(settings.config, "regions"),
    );

    if (regions.length === 0) {
      throw new BadDataException(
        "Name at least one AWS Region, such as us-east-1.",
      );
    }

    if (regions.length > MAX_REGIONS) {
      throw new BadDataException(
        `Name at most ${MAX_REGIONS} AWS Regions in one connection.`,
      );
    }

    for (const region of regions) {
      AwsSecurityHubClient.validateRegion(region);
    }

    if (!readSetting(settings.secrets, "secretAccessKey")) {
      throw new BadDataException("Secret access key is required.");
    }
  }

  private createClient(data: {
    settings: LlmConnectionSettings;
    region: string;
    options: LlmConnectorCallOptions;
  }): CloudWatchClient {
    return new CloudWatchClient({
      region: data.region,
      accessKeyId: readSetting(data.settings.config, "accessKeyId"),
      secretAccessKey: readSetting(data.settings.secrets, "secretAccessKey"),
      transport: data.options.transport,
      requestTimeoutInMs: data.options.requestTimeoutInMs,
      now: data.options.now,
    });
  }

  // The GetMetricData queries for these models, ids q<model>_<metric>.
  public static buildQueries(
    modelIds: Array<string>,
  ): Array<CloudWatchMetricQuery> {
    const queries: Array<CloudWatchMetricQuery> = [];

    modelIds.forEach((modelId: string, modelIndex: number) => {
      METRICS.forEach((metricName: string, metricIndex: number) => {
        queries.push({
          id: `q${modelIndex}_${metricIndex}`,
          metricName: metricName,
          dimensions: [{ name: "ModelId", value: modelId }],
        });
      });
    });

    return queries;
  }

  // One record per day and model of a Region, from GetMetricData's results.
  public static toRecords(data: {
    region: string;
    modelIds: Array<string>;
    results: Array<CloudWatchMetricResult>;
  }): Array<LlmUsageRecord> {
    const records: Map<string, LlmUsageRecord> = new Map();

    for (const result of data.results) {
      const parts: Array<string> = result.id.substring(1).split("_");
      const modelId: string | undefined = data.modelIds[Number(parts[0])];
      const metricName: string | undefined = METRICS[Number(parts[1])];

      if (!modelId || !metricName) {
        continue;
      }

      result.timestamps.forEach((timestamp: number, index: number) => {
        const value: number = result.values[index] || 0;

        if (
          !Number.isFinite(timestamp) ||
          !Number.isFinite(value) ||
          value <= 0
        ) {
          return;
        }

        const day: Date = LlmUsageDays.startOfUtcDay(new Date(timestamp));
        const key: string = `${day.getTime()}|${modelId}`;
        let record: LlmUsageRecord | undefined = records.get(key);

        if (!record) {
          record = {
            day,
            model: modelId,
            person: "",
            project: data.region,
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

        switch (metricName) {
          case "InputTokenCount":
            record.inputTokens += value;
            break;
          case "OutputTokenCount":
            record.outputTokens += value;
            break;
          case "CacheReadInputTokenCount":
            record.cacheReadTokens += value;
            break;
          case "CacheWriteInputTokenCount":
            record.cacheWriteTokens += value;
            break;
          case "Invocations":
            record.requests = (record.requests || 0) + value;
            break;
          default:
            break;
        }
      });
    }

    /*
     * Bedrock's InputTokenCount leaves the cached tokens out (they are
     * charged apart, and do not count toward the quota). The records count
     * every input token, as the GenAI conventions do, so they are added in.
     */
    for (const record of records.values()) {
      record.inputTokens += record.cacheReadTokens + record.cacheWriteTokens;
    }

    return Array.from(records.values());
  }

  private async readRegion(data: {
    settings: LlmConnectionSettings;
    region: string;
    window: LlmUsageWindow;
    options: LlmConnectorCallOptions;
  }): Promise<{
    records: Array<LlmUsageRecord>;
    requests: number;
    warning: string;
  }> {
    const client: CloudWatchClient = this.createClient({
      settings: data.settings,
      region: data.region,
      options: data.options,
    });

    const allModels: Array<string> = await client.listMetricDimensionValues({
      namespace: BEDROCK_NAMESPACE,
      metricName: "InputTokenCount",
      dimensionName: "ModelId",
    });
    const modelIds: Array<string> = allModels.slice(0, MAX_MODELS_PER_REGION);

    if (modelIds.length === 0) {
      return { records: [], requests: client.getRequestCount(), warning: "" };
    }

    const results: Array<CloudWatchMetricResult> = await client.getDailySums({
      namespace: BEDROCK_NAMESPACE,
      queries: AwsBedrockConnector.buildQueries(modelIds),
      startTime: data.window.startDay,
      endTime: data.window.endDay,
    });

    return {
      records: AwsBedrockConnector.toRecords({
        region: data.region,
        modelIds,
        results,
      }),
      requests: client.getRequestCount(),
      warning:
        allModels.length > modelIds.length
          ? `${data.region} has ${allModels.length} Bedrock models; the first ${MAX_MODELS_PER_REGION} are read.`
          : "",
    };
  }

  public async fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult> {
    const records: Array<LlmUsageRecord> = [];
    const warnings: Array<string> = [];
    let requestCount: number = 0;

    for (const region of AwsBedrockConnector.readRegions(
      readSetting(settings.config, "regions"),
    )) {
      const result: {
        records: Array<LlmUsageRecord>;
        requests: number;
        warning: string;
      } = await this.readRegion({ settings, region, window, options });

      records.push(...result.records);
      requestCount += result.requests;

      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    return { records, requestCount, warnings };
  }

  public async testConnection(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): Promise<LlmConnectionTestResult> {
    const startedAt: number = Date.now();
    const now: Date = options.now ? options.now() : new Date();
    const endDay: Date = LlmUsageDays.addDays(
      LlmUsageDays.startOfUtcDay(now),
      1,
    );
    const startDay: Date = LlmUsageDays.addDays(
      endDay,
      -LLM_CONNECTION_TEST_DAYS,
    );

    try {
      this.validateSettings(settings);

      const result: LlmUsageFetchResult = await this.fetchUsage(
        settings,
        { startDay, endDay },
        options,
      );

      return LlmConnectorTestResults.fromUsage({
        provider: this.provider,
        records: result.records,
        days: LLM_CONNECTION_TEST_DAYS,
        durationMs: Date.now() - startedAt,
      });
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

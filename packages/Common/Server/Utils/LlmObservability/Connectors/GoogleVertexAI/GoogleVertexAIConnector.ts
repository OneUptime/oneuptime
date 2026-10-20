import { LlmConnectionKind } from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import BadDataException from "../../../../../Types/Exception/BadDataException";
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
import GoogleMonitoringClient, {
  GoogleMonitoringPoint,
} from "./GoogleMonitoringClient";
import GoogleSecOpsClient from "../../../SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";

/*
 * Vertex AI's models in one Google Cloud project - Gemini, and the partner
 * models of Model Garden such as Claude - read from the Cloud Monitoring
 * metrics Vertex AI publishes for the aiplatform.googleapis.com/
 * PublisherModel resource:
 *
 *   publisher/online_serving/token_count             tokens, label type =
 *                                                    input | output
 *   publisher/online_serving/model_invocation_count  requests
 *
 * grouped by the resource's model_user_id (the model) and location (the
 * Region, kept as the project). Cloud Monitoring counts tokens, not money,
 * and names no person or key: the cost is OneUptime's list-price estimate.
 */

export const VERTEX_TOKEN_COUNT_METRIC: string =
  "aiplatform.googleapis.com/publisher/online_serving/token_count";
export const VERTEX_INVOCATION_COUNT_METRIC: string =
  "aiplatform.googleapis.com/publisher/online_serving/model_invocation_count";

const MODEL_LABEL: string = "resource.label.model_user_id";
const LOCATION_LABEL: string = "resource.label.location";
const TOKEN_TYPE_LABEL: string = "metric.label.type";

export default class GoogleVertexAIConnector
  implements LlmProviderAccountConnector
{
  public provider: LlmConnectionProvider = LlmConnectionProvider.GoogleVertexAI;
  public kind: LlmConnectionKind.ProviderAccount =
    LlmConnectionKind.ProviderAccount;

  public validateSettings(settings: LlmConnectionSettings): void {
    GoogleMonitoringClient.validateProjectId(
      readSetting(settings.config, "projectId"),
    );

    const key: string = readSetting(settings.secrets, "serviceAccountJson");

    if (!key) {
      throw new BadDataException("Service account key (JSON) is required.");
    }

    GoogleSecOpsClient.parseServiceAccountJson(key);
  }

  private createClient(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): GoogleMonitoringClient {
    return new GoogleMonitoringClient({
      projectId: readSetting(settings.config, "projectId"),
      serviceAccountJson: readSetting(settings.secrets, "serviceAccountJson"),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  /*
   * Hourly points of both metrics, added up into one record per UTC day,
   * model and Region.
   */
  public static toRecords(data: {
    tokens: Array<GoogleMonitoringPoint>;
    invocations: Array<GoogleMonitoringPoint>;
  }): Array<LlmUsageRecord> {
    const records: Map<string, LlmUsageRecord> = new Map();

    const recordOf: (point: GoogleMonitoringPoint) => LlmUsageRecord = (
      point: GoogleMonitoringPoint,
    ): LlmUsageRecord => {
      const day: Date = LlmUsageDays.startOfUtcDay(point.hour);
      const model: string = point.resourceLabels["model_user_id"] || "";
      const location: string = point.resourceLabels["location"] || "";
      const key: string = `${day.getTime()}|${model}|${location}`;
      let record: LlmUsageRecord | undefined = records.get(key);

      if (!record) {
        record = {
          day,
          model,
          person: "",
          project: location,
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

      return record;
    };

    for (const point of data.tokens) {
      const type: string = (point.metricLabels["type"] || "").toLowerCase();
      const record: LlmUsageRecord = recordOf(point);

      if (type === "input") {
        record.inputTokens += point.value;
      } else if (type === "output") {
        record.outputTokens += point.value;
      }
    }

    for (const point of data.invocations) {
      const record: LlmUsageRecord = recordOf(point);
      record.requests = (record.requests || 0) + point.value;
    }

    return Array.from(records.values());
  }

  public async fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult> {
    const client: GoogleMonitoringClient = this.createClient(settings, options);
    const now: Date = options.now ? options.now() : new Date();

    // Hourly points that end on the hour, and never in the future.
    const lastHour: Date = new Date(
      Math.floor(now.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000,
    );
    const endTime: Date =
      window.endDay.getTime() < lastHour.getTime() ? window.endDay : lastHour;

    if (endTime.getTime() <= window.startDay.getTime()) {
      return { records: [], requestCount: 0, warnings: [] };
    }

    const tokens: Array<GoogleMonitoringPoint> = await client.listHourlySums({
      metricType: VERTEX_TOKEN_COUNT_METRIC,
      groupByFields: [MODEL_LABEL, LOCATION_LABEL, TOKEN_TYPE_LABEL],
      startTime: window.startDay,
      endTime,
    });
    const invocations: Array<GoogleMonitoringPoint> =
      await client.listHourlySums({
        metricType: VERTEX_INVOCATION_COUNT_METRIC,
        groupByFields: [MODEL_LABEL, LOCATION_LABEL],
        startTime: window.startDay,
        endTime,
      });

    return {
      records: GoogleVertexAIConnector.toRecords({ tokens, invocations }),
      requestCount: client.getRequestCount(),
      warnings: [],
    };
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

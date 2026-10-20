import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionKind } from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import LlmCostAllocation, {
  LlmCostLine,
  tokenTypeOfCostLine,
} from "../../LlmCostAllocation";
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
import {
  readArray,
  readCount,
  readObject,
  readText,
} from "../../LlmProviderHttp";
import LlmUsageDays from "../../LlmUsageDays";
import OpenAIAdminClient, { OpenAIApiKeyInfo } from "./OpenAIAdminClient";

/*
 * An OpenAI organization, read with an admin key: tokens and requests of
 * the completions and embeddings usage reports by day, model, project, key
 * and person, and the day's cost by project and line item, shared among the
 * keys and people that used each model (LlmCostAllocation). Names replace
 * OpenAI's ids where the Admin API gives them: project names, key names,
 * people's emails.
 */

// How many projects' keys are looked up by name in one read.
const MAX_PROJECTS_WITH_KEY_NAMES: number = 50;

interface OpenAIUsageRow {
  day: Date;
  model: string;
  projectId: string;
  apiKeyId: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
}

export default class OpenAIConnector implements LlmProviderAccountConnector {
  public provider: LlmConnectionProvider = LlmConnectionProvider.OpenAI;
  public kind: LlmConnectionKind.ProviderAccount =
    LlmConnectionKind.ProviderAccount;

  public validateSettings(settings: LlmConnectionSettings): void {
    OpenAIAdminClient.validateAdminKey(
      readSetting(settings.secrets, "adminKey"),
    );
  }

  private createClient(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): OpenAIAdminClient {
    return new OpenAIAdminClient({
      adminKey: readSetting(settings.secrets, "adminKey"),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  // The usage report's rows, one per day bucket and group.
  public static readUsageRows(
    buckets: Array<JSONObject>,
  ): Array<OpenAIUsageRow> {
    const rows: Array<OpenAIUsageRow> = [];

    for (const bucket of buckets) {
      const day: Date | null = LlmUsageDays.fromUnixSeconds(
        bucket["start_time"],
      );

      if (!day) {
        continue;
      }

      for (const raw of readArray(bucket["results"])) {
        const result: JSONObject = readObject(raw);
        const cacheWrite: number =
          readCount(result["input_cache_write_tokens"]) ||
          readCount(result["input_cache_write_30m_tokens"]) +
            readCount(result["input_cache_write_12h_tokens"]);

        rows.push({
          day: day,
          model: readText(result["model"]),
          projectId: readText(result["project_id"]),
          apiKeyId: readText(result["api_key_id"]),
          userId: readText(result["user_id"]),
          // OpenAI's input_tokens already counts cached and cache-write tokens.
          inputTokens: readCount(result["input_tokens"]),
          outputTokens: readCount(result["output_tokens"]),
          cacheReadTokens: readCount(result["input_cached_tokens"]),
          cacheWriteTokens: cacheWrite,
          requests: readCount(result["num_model_requests"]),
        });
      }
    }

    return rows;
  }

  /*
   * The cost report's lines. A line item reads "<model>, <what>" ("gpt-4o-
   * 2024-08-06, input"); one without a comma is not a model's tokens (a tool
   * call, storage), and is kept whole under its own name.
   */
  public static readCostLines(buckets: Array<JSONObject>): Array<LlmCostLine> {
    const lines: Array<LlmCostLine> = [];

    for (const bucket of buckets) {
      const day: Date | null = LlmUsageDays.fromUnixSeconds(
        bucket["start_time"],
      );

      if (!day) {
        continue;
      }

      for (const raw of readArray(bucket["results"])) {
        const result: JSONObject = readObject(raw);
        const amount: JSONObject = readObject(result["amount"]);
        const currency: string = readText(amount["currency"]).toLowerCase();
        const value: number = Number(amount["value"]);

        if (!Number.isFinite(value) || value === 0) {
          continue;
        }

        // Every OpenAI cost is in US dollars; anything else is not added in.
        if (currency && currency !== "usd") {
          continue;
        }

        const lineItem: string = readText(result["line_item"]);
        const commaIndex: number = lineItem.indexOf(",");
        const model: string =
          commaIndex > 0 ? lineItem.substring(0, commaIndex).trim() : "";
        const what: string =
          commaIndex > 0 ? lineItem.substring(commaIndex + 1).trim() : "";

        lines.push({
          day: day,
          project: readText(result["project_id"]),
          model: model,
          tokenType: model ? tokenTypeOfCostLine(what) : null,
          costUsd: value,
          description: lineItem || "OpenAI",
        });
      }
    }

    return lines;
  }

  /*
   * Usage rows with OpenAI's ids turned into names, and the cost shared
   * among them. Ids that have no name stay as they are, so nothing is lost.
   */
  public static toRecords(data: {
    usage: Array<OpenAIUsageRow>;
    costLines: Array<LlmCostLine>;
    projectNames: Map<string, string>;
    userEmails: Map<string, string>;
    apiKeys: Map<string, OpenAIApiKeyInfo>;
  }): Array<LlmUsageRecord> {
    const projectName: (id: string) => string = (id: string): string => {
      return id ? data.projectNames.get(id) || id : "";
    };

    const usage: Array<LlmUsageRecord> = data.usage.map(
      (row: OpenAIUsageRow): LlmUsageRecord => {
        const key: OpenAIApiKeyInfo | undefined = data.apiKeys.get(
          row.apiKeyId,
        );

        return {
          day: row.day,
          model: row.model,
          person:
            (row.userId ? data.userEmails.get(row.userId) || row.userId : "") ||
            key?.ownerEmail ||
            "",
          project: projectName(row.projectId),
          apiKey: row.apiKeyId ? key?.name || row.apiKeyId : "",
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          requests: row.requests,
          costUsd: null,
        };
      },
    );

    return LlmCostAllocation.allocate({
      usage: usage,
      costLines: data.costLines.map((line: LlmCostLine): LlmCostLine => {
        return { ...line, project: projectName(line.project) };
      }),
    });
  }

  public async fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult> {
    const client: OpenAIAdminClient = this.createClient(settings, options);
    const warnings: Array<string> = [];

    const [completions, embeddings, costs]: [
      Array<JSONObject>,
      Array<JSONObject>,
      Array<JSONObject>,
    ] = await Promise.all([
      client.listUsageBuckets({
        kind: "completions",
        startTime: window.startDay,
        endTime: window.endDay,
      }),
      client.listUsageBuckets({
        kind: "embeddings",
        startTime: window.startDay,
        endTime: window.endDay,
      }),
      client.listCostBuckets({
        startTime: window.startDay,
        endTime: window.endDay,
      }),
    ]);

    const usage: Array<OpenAIUsageRow> = [
      ...OpenAIConnector.readUsageRows(completions),
      ...OpenAIConnector.readUsageRows(embeddings),
    ];

    /*
     * Names are a nicety: a failure to read them leaves OpenAI's ids in
     * place rather than failing the read.
     */
    let projectNames: Map<string, string> = new Map();
    let userEmails: Map<string, string> = new Map();
    const apiKeys: Map<string, OpenAIApiKeyInfo> = new Map();

    try {
      [projectNames, userEmails] = await Promise.all([
        client.listProjectNames(),
        client.listUserEmails(),
      ]);

      const projectIds: Array<string> = Array.from(
        new Set<string>(
          usage
            .filter((row: OpenAIUsageRow): boolean => {
              return Boolean(row.projectId && row.apiKeyId);
            })
            .map((row: OpenAIUsageRow): string => {
              return row.projectId;
            }),
        ),
      ).slice(0, MAX_PROJECTS_WITH_KEY_NAMES);

      for (const projectId of projectIds) {
        const keys: Map<string, OpenAIApiKeyInfo> =
          await client.listProjectApiKeys(projectId);

        for (const [id, info] of keys) {
          apiKeys.set(id, info);
        }
      }
    } catch {
      warnings.push(
        "Some project, key or people names could not be read, so OpenAI's ids are shown instead.",
      );
    }

    return {
      records: OpenAIConnector.toRecords({
        usage,
        costLines: OpenAIConnector.readCostLines(costs),
        projectNames,
        userEmails,
        apiKeys,
      }),
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
      const client: OpenAIAdminClient = this.createClient(settings, options);

      const [completions, costs]: [Array<JSONObject>, Array<JSONObject>] =
        await Promise.all([
          client.listUsageBuckets({
            kind: "completions",
            startTime: startDay,
            endTime: endDay,
          }),
          client.listCostBuckets({ startTime: startDay, endTime: endDay }),
        ]);

      return LlmConnectorTestResults.fromUsage({
        provider: this.provider,
        records: OpenAIConnector.toRecords({
          usage: OpenAIConnector.readUsageRows(completions),
          costLines: OpenAIConnector.readCostLines(costs),
          projectNames: new Map(),
          userEmails: new Map(),
          apiKeys: new Map(),
        }),
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

import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionKind } from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import { LlmProviderTokenType } from "../../../../../Types/LlmObservability/LlmProviderUsageMetrics";
import LlmCostAllocation, { LlmCostLine } from "../../LlmCostAllocation";
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
import AnthropicAdminClient, {
  AnthropicApiKeyInfo,
} from "./AnthropicAdminClient";

/*
 * An Anthropic (Claude API) organization, read with an admin key: the
 * messages usage report by day, model, workspace, key and account, and the
 * cost report by workspace and line, shared among the keys and people that
 * used each model (LlmCostAllocation). The usage report counts no requests,
 * so Anthropic connections have tokens and cost but no request count.
 *
 * Claude Code used with the organization's keys or Console logins is part
 * of these reports already, under the person or key that used it.
 */

// The default workspace has no id in the reports.
export const ANTHROPIC_DEFAULT_WORKSPACE_NAME: string = "Default workspace";

interface AnthropicUsageRow {
  day: Date;
  model: string;
  workspaceId: string;
  apiKeyId: string;
  accountId: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

// The cost report's token types, as OneUptime's token types.
const COST_TOKEN_TYPES: Record<string, LlmProviderTokenType> = {
  uncached_input_tokens: LlmProviderTokenType.Input,
  output_tokens: LlmProviderTokenType.Output,
  cache_read_input_tokens: LlmProviderTokenType.CacheRead,
  "cache_creation.ephemeral_5m_input_tokens": LlmProviderTokenType.CacheWrite,
  "cache_creation.ephemeral_1h_input_tokens": LlmProviderTokenType.CacheWrite,
};

export default class AnthropicConnector implements LlmProviderAccountConnector {
  public provider: LlmConnectionProvider = LlmConnectionProvider.Anthropic;
  public kind: LlmConnectionKind.ProviderAccount =
    LlmConnectionKind.ProviderAccount;

  public validateSettings(settings: LlmConnectionSettings): void {
    AnthropicAdminClient.validateAdminKey(
      readSetting(settings.secrets, "adminKey"),
    );
  }

  private createClient(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): AnthropicAdminClient {
    return new AnthropicAdminClient({
      adminKey: readSetting(settings.secrets, "adminKey"),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  public static readUsageRows(
    buckets: Array<JSONObject>,
  ): Array<AnthropicUsageRow> {
    const rows: Array<AnthropicUsageRow> = [];

    for (const bucket of buckets) {
      const day: Date | null = LlmUsageDays.fromIsoTime(bucket["starting_at"]);

      if (!day) {
        continue;
      }

      for (const raw of readArray(bucket["results"])) {
        const result: JSONObject = readObject(raw);
        const cacheCreation: JSONObject = readObject(result["cache_creation"]);

        rows.push({
          day: day,
          model: readText(result["model"]),
          workspaceId: readText(result["workspace_id"]),
          apiKeyId: readText(result["api_key_id"]),
          accountId: readText(result["account_id"]),
          uncachedInputTokens: readCount(result["uncached_input_tokens"]),
          cacheReadTokens: readCount(result["cache_read_input_tokens"]),
          cacheWriteTokens:
            readCount(cacheCreation["ephemeral_5m_input_tokens"]) +
            readCount(cacheCreation["ephemeral_1h_input_tokens"]),
          outputTokens: readCount(result["output_tokens"]),
        });
      }
    }

    return rows;
  }

  /*
   * The cost report's lines. `amount` is in CENTS: "123.45" is $1.23. A
   * line that is not a model's tokens (web search, code execution) is kept
   * whole under its description.
   */
  public static readCostLines(buckets: Array<JSONObject>): Array<LlmCostLine> {
    const lines: Array<LlmCostLine> = [];

    for (const bucket of buckets) {
      const day: Date | null = LlmUsageDays.fromIsoTime(bucket["starting_at"]);

      if (!day) {
        continue;
      }

      for (const raw of readArray(bucket["results"])) {
        const result: JSONObject = readObject(raw);
        const currency: string = readText(result["currency"]).toUpperCase();
        const cents: number = Number(readText(result["amount"]));

        if (!Number.isFinite(cents) || cents === 0) {
          continue;
        }

        if (currency && currency !== "USD") {
          continue;
        }

        const tokenType: LlmProviderTokenType | null =
          readText(result["cost_type"]) === "tokens"
            ? COST_TOKEN_TYPES[readText(result["token_type"])] || null
            : null;

        lines.push({
          day: day,
          project: readText(result["workspace_id"]),
          model: tokenType ? readText(result["model"]) : "",
          tokenType: tokenType,
          costUsd: cents / 100,
          description:
            readText(result["description"]) ||
            readText(result["cost_type"]) ||
            "Anthropic",
        });
      }
    }

    return lines;
  }

  public static toRecords(data: {
    usage: Array<AnthropicUsageRow>;
    costLines: Array<LlmCostLine>;
    userEmails: Map<string, string>;
    apiKeys: Map<string, AnthropicApiKeyInfo>;
    workspaceNames: Map<string, string>;
  }): Array<LlmUsageRecord> {
    const workspaceName: (id: string) => string = (id: string): string => {
      return id
        ? data.workspaceNames.get(id) || id
        : ANTHROPIC_DEFAULT_WORKSPACE_NAME;
    };

    const usage: Array<LlmUsageRecord> = data.usage.map(
      (row: AnthropicUsageRow): LlmUsageRecord => {
        const key: AnthropicApiKeyInfo | undefined = data.apiKeys.get(
          row.apiKeyId,
        );
        const personId: string = row.accountId || key?.principalUserId || "";

        return {
          day: row.day,
          model: row.model,
          person: personId ? data.userEmails.get(personId) || personId : "",
          project: workspaceName(row.workspaceId),
          apiKey: row.apiKeyId ? key?.name || row.apiKeyId : "",
          // Every input token: uncached, read from and written to the cache.
          inputTokens:
            row.uncachedInputTokens +
            row.cacheReadTokens +
            row.cacheWriteTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          // The usage report counts tokens, not requests.
          requests: null,
          costUsd: null,
        };
      },
    );

    return LlmCostAllocation.allocate({
      usage: usage,
      costLines: data.costLines.map((line: LlmCostLine): LlmCostLine => {
        return { ...line, project: workspaceName(line.project) };
      }),
    });
  }

  public async fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult> {
    const client: AnthropicAdminClient = this.createClient(settings, options);
    const warnings: Array<string> = [];

    // One after the other: Anthropic asks for about a request a second.
    const usageBuckets: Array<JSONObject> = await client.listUsageBuckets({
      startTime: window.startDay,
      endTime: window.endDay,
    });
    const costBuckets: Array<JSONObject> = await client.listCostBuckets({
      startTime: window.startDay,
      endTime: window.endDay,
    });

    let userEmails: Map<string, string> = new Map();
    let apiKeys: Map<string, AnthropicApiKeyInfo> = new Map();
    let workspaceNames: Map<string, string> = new Map();

    try {
      userEmails = await client.listUserEmails();
      apiKeys = await client.listApiKeys();
      workspaceNames = await client.listWorkspaceNames();
    } catch {
      warnings.push(
        "Some workspace, key or people names could not be read, so Anthropic's ids are shown instead.",
      );
    }

    return {
      records: AnthropicConnector.toRecords({
        usage: AnthropicConnector.readUsageRows(usageBuckets),
        costLines: AnthropicConnector.readCostLines(costBuckets),
        userEmails,
        apiKeys,
        workspaceNames,
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
      const client: AnthropicAdminClient = this.createClient(settings, options);

      const usageBuckets: Array<JSONObject> = await client.listUsageBuckets({
        startTime: startDay,
        endTime: endDay,
      });
      const costBuckets: Array<JSONObject> = await client.listCostBuckets({
        startTime: startDay,
        endTime: endDay,
      });

      return LlmConnectorTestResults.fromUsage({
        provider: this.provider,
        records: AnthropicConnector.toRecords({
          usage: AnthropicConnector.readUsageRows(usageBuckets),
          costLines: AnthropicConnector.readCostLines(costBuckets),
          userEmails: new Map(),
          apiKeys: new Map(),
          workspaceNames: new Map(),
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

import { describe, expect, test } from "@jest/globals";
import AnthropicAdminClient from "../../../../Server/Utils/LlmObservability/Connectors/Anthropic/AnthropicAdminClient";
import AnthropicConnector, {
  ANTHROPIC_DEFAULT_WORKSPACE_NAME,
} from "../../../../Server/Utils/LlmObservability/Connectors/Anthropic/AnthropicConnector";
import {
  LlmConnectionSettings,
  LlmUsageFetchResult,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeProviderApi,
  FakeRoute,
  createFakeProviderApi,
  json,
  queryValues,
  sequence,
} from "./FakeProviderApi";

/*
 * The Anthropic connection against a fake Admin API: the admin key in
 * x-api-key with anthropic-version, RFC 3339 times, group_by[] lists, the
 * report paging (next_page) and the list paging (after_id), the cost
 * report's amounts in CENTS, the default workspace's null id, the cost
 * shared by the kind of tokens it charges for, and failures without the key.
 */

const ADMIN_KEY: string = "sk-ant-admin01-AbCdEf0123456789-TEST";
const DAY_1: string = "2026-10-18T00:00:00Z";
const DAY_2: string = "2026-10-19T00:00:00Z";

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.Anthropic,
  config: {},
  secrets: { adminKey: ADMIN_KEY },
};

const WINDOW: { startDay: Date; endDay: Date } = {
  startDay: new Date(DAY_1),
  endDay: new Date("2026-10-20T00:00:00Z"),
};

function bucket(start: string, results: Array<JSONObject>): JSONObject {
  return {
    starting_at: start,
    ending_at: new Date(Date.parse(start) + 86400000).toISOString(),
    results,
  };
}

function report(
  data: Array<JSONObject>,
  nextPage: string | null = null,
): JSONObject {
  return { data, has_more: Boolean(nextPage), next_page: nextPage };
}

function list(
  data: Array<JSONObject>,
  lastId: string | null = null,
): JSONObject {
  return {
    data,
    has_more: Boolean(lastId),
    first_id: data[0]?.["id"] || null,
    last_id: lastId,
  };
}

function routes(
  overrides: Partial<Record<string, FakeRoute["respond"]>> = {},
): Array<FakeRoute> {
  return [
    {
      path: "/v1/organizations/usage_report/messages",
      respond:
        overrides["usage"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            report([
              bucket(DAY_1, [
                {
                  model: "claude-opus-5-5",
                  workspace_id: "wrkspc_1",
                  api_key_id: "apikey_1",
                  account_id: null,
                  uncached_input_tokens: 1000,
                  cache_read_input_tokens: 4000,
                  cache_creation: {
                    ephemeral_5m_input_tokens: 500,
                    ephemeral_1h_input_tokens: 100,
                  },
                  output_tokens: 300,
                  server_tool_use: { web_search_requests: 2 },
                },
                {
                  model: "claude-opus-5-5",
                  workspace_id: null,
                  api_key_id: null,
                  account_id: "user_carol",
                  uncached_input_tokens: 3000,
                  cache_read_input_tokens: 0,
                  cache_creation: {
                    ephemeral_5m_input_tokens: 0,
                    ephemeral_1h_input_tokens: 0,
                  },
                  output_tokens: 700,
                },
              ]),
              bucket(DAY_2, []),
            ]),
          );
        }),
    },
    {
      path: "/v1/organizations/cost_report",
      respond:
        overrides["cost"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            report([
              bucket(DAY_1, [
                {
                  // $4.00 in cents, as a decimal string.
                  amount: "400.00",
                  currency: "USD",
                  cost_type: "tokens",
                  description: "Claude Opus 5.5 Usage - Input Tokens",
                  model: "claude-opus-5-5",
                  token_type: "uncached_input_tokens",
                  workspace_id: null,
                },
                {
                  amount: "100",
                  currency: "USD",
                  cost_type: "tokens",
                  description: "Claude Opus 5.5 Usage - Output Tokens",
                  model: "claude-opus-5-5",
                  token_type: "output_tokens",
                  workspace_id: "wrkspc_1",
                },
                {
                  amount: "12.5",
                  currency: "USD",
                  cost_type: "web_search",
                  description: "Web Search Usage",
                  model: null,
                  token_type: null,
                  workspace_id: "wrkspc_1",
                },
              ]),
            ]),
          );
        }),
    },
    {
      path: "/v1/organizations/users",
      respond:
        overrides["users"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            list([
              { id: "user_carol", email: "carol@example.com", name: "Carol" },
              { id: "user_dan", email: "dan@example.com", name: "Dan" },
            ]),
          );
        }),
    },
    {
      path: "/v1/organizations/api_keys",
      respond:
        overrides["keys"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            list([
              {
                id: "apikey_1",
                name: "Support bot",
                principal: { type: "user_actor", user_id: "user_dan" },
              },
            ]),
          );
        }),
    },
    {
      path: "/v1/organizations/workspaces",
      respond:
        overrides["workspaces"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(list([{ id: "wrkspc_1", name: "Support" }]));
        }),
    },
  ];
}

describe("AnthropicAdminClient", () => {
  test.each([
    ["sk-ant-api03-abc", "Claude API key"],
    ["sk-ant-api01-abc", "Claude API key"],
    ["sk-abc", "sk-ant-admin01-"],
    ["", "required"],
  ])("%s is refused (%s)", (key: string, words: string) => {
    expect(() => {
      return AnthropicAdminClient.validateAdminKey(key);
    }).toThrow(BadDataException);
    expect(() => {
      return AnthropicAdminClient.validateAdminKey(key);
    }).toThrow(words);
  });

  test("requests carry the key in x-api-key and the API version", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());
    const client: AnthropicAdminClient = new AnthropicAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await client.listUsageBuckets({
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    const request: DataSourceHttpRequest = api.requests[0]!;
    expect(request.headers?.["x-api-key"]).toBe(ADMIN_KEY);
    expect(request.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(request.url).not.toContain(ADMIN_KEY);
    expect(new URL(request.url).host).toBe("api.anthropic.com");
    expect(queryValues(request, "starting_at")).toEqual([
      "2026-10-18T00:00:00.000Z",
    ]);
    expect(queryValues(request, "ending_at")).toEqual([
      "2026-10-20T00:00:00.000Z",
    ]);
    expect(queryValues(request, "bucket_width")).toEqual(["1d"]);
    expect(queryValues(request, "group_by[]")).toEqual([
      "model",
      "workspace_id",
      "api_key_id",
      "account_id",
    ]);
    expect(queryValues(request, "limit")).toEqual(["31"]);
  });

  test("the cost report is grouped by workspace and description", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());
    const client: AnthropicAdminClient = new AnthropicAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await client.listCostBuckets({
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    expect(queryValues(api.requests[0]!, "group_by[]")).toEqual([
      "workspace_id",
      "description",
    ]);
  });

  test("reports follow next_page and lists follow after_id", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        usage: sequence([
          json(report([bucket(DAY_1, [])], "page_two")),
          json(report([bucket(DAY_2, [])])),
        ]),
        workspaces: sequence([
          json(list([{ id: "w1", name: "One" }], "w1")),
          json(list([{ id: "w2", name: "Two" }])),
        ]),
      }),
    );
    const client: AnthropicAdminClient = new AnthropicAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    expect(
      await client.listUsageBuckets({
        startTime: WINDOW.startDay,
        endTime: WINDOW.endDay,
      }),
    ).toHaveLength(2);
    expect(queryValues(api.requests[1]!, "page")).toEqual(["page_two"]);

    const names: Map<string, string> = await client.listWorkspaceNames();
    expect(Array.from(names.values())).toEqual(["One", "Two"]);
    expect(queryValues(api.requests[3]!, "after_id")).toEqual(["w1"]);
    expect(queryValues(api.requests[2]!, "include_archived")).toEqual(["true"]);
    expect(queryValues(api.requests[2]!, "limit")).toEqual(["1000"]);
  });

  test("a refused key is an authentication failure without the key", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        usage: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            {
              type: "error",
              error: {
                type: "authentication_error",
                message: `invalid x-api-key ${ADMIN_KEY}`,
              },
            },
            401,
          );
        },
      }),
    );
    const client: AnthropicAdminClient = new AnthropicAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    const error: unknown = await client
      .listUsageBuckets({ startTime: WINDOW.startDay, endTime: WINDOW.endDay })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Authentication,
    );
    expect((error as LlmProviderError).message).not.toContain(ADMIN_KEY);
    expect((error as LlmProviderError).message).toContain("[REDACTED]");
  });

  test("a rate limit is reported as one", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        cost: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            { type: "error", error: { type: "rate_limit_error" } },
            429,
          );
        },
      }),
    );

    const error: unknown = await new AnthropicConnector()
      .fetchUsage(SETTINGS, WINDOW, { transport: api.transport })
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.RateLimited,
    );
  });
});

describe("AnthropicConnector mapping", () => {
  test("every input token is counted, the cache counts kept apart", () => {
    const rows: ReturnType<typeof AnthropicConnector.readUsageRows> =
      AnthropicConnector.readUsageRows([
        bucket(DAY_1, [
          {
            model: "claude-haiku-4-5",
            uncached_input_tokens: 10,
            cache_read_input_tokens: 20,
            cache_creation: {
              ephemeral_5m_input_tokens: 3,
              ephemeral_1h_input_tokens: 4,
            },
            output_tokens: 5,
          },
        ]),
      ]);

    const records: Array<LlmUsageRecord> = AnthropicConnector.toRecords({
      usage: rows,
      costLines: [],
      userEmails: new Map(),
      apiKeys: new Map(),
      workspaceNames: new Map(),
    });

    expect(records[0]).toMatchObject({
      inputTokens: 37,
      cacheReadTokens: 20,
      cacheWriteTokens: 7,
      outputTokens: 5,
      requests: null,
      project: ANTHROPIC_DEFAULT_WORKSPACE_NAME,
    });
  });

  test("cost amounts are cents: 400.00 is four dollars", () => {
    const lines: ReturnType<typeof AnthropicConnector.readCostLines> =
      AnthropicConnector.readCostLines([
        bucket(DAY_1, [
          {
            amount: "400.00",
            currency: "USD",
            cost_type: "tokens",
            model: "claude-opus-5-5",
            token_type: "cache_creation.ephemeral_1h_input_tokens",
          },
          {
            amount: "7",
            currency: "USD",
            cost_type: "code_execution",
            description: "Code Execution Usage",
          },
          { amount: "not money", currency: "USD", cost_type: "tokens" },
          { amount: "50", currency: "EUR", cost_type: "tokens" },
        ]),
      ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      costUsd: 4,
      model: "claude-opus-5-5",
      tokenType: "cache_write",
    });
    expect(lines[1]).toMatchObject({
      costUsd: 0.07,
      model: "",
      tokenType: null,
      description: "Code Execution Usage",
    });
  });

  test("a read names workspaces, keys and people, and shares the cost", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmUsageFetchResult =
      await new AnthropicConnector().fetchUsage(SETTINGS, WINDOW, {
        transport: api.transport,
      });

    const bot: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.apiKey === "Support bot";
      },
    );
    const carol: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.person === "carol@example.com";
      },
    );

    // A key bound to a user is that user's.
    expect(bot).toMatchObject({
      person: "dan@example.com",
      project: "Support",
      inputTokens: 5600,
    });
    expect(carol).toMatchObject({
      apiKey: "",
      project: ANTHROPIC_DEFAULT_WORKSPACE_NAME,
    });

    /*
     * The $4 input line is the default workspace's: carol's alone. The $1
     * output line is workspace 1's: the bot's alone. Web search ($0.125)
     * is kept whole.
     */
    expect(carol!.costUsd).toBeCloseTo(4, 10);
    expect(bot!.costUsd).toBeCloseTo(1, 10);
    const total: number = result.records.reduce(
      (sum: number, record: LlmUsageRecord) => {
        return sum + (record.costUsd || 0);
      },
      0,
    );
    expect(total).toBeCloseTo(5.125, 10);
  });

  test("the test reads usage and costs only, and passes with usage", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new AnthropicConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return new Date("2026-10-19T12:00:00Z");
        },
      });

    expect(result.status).toBe("pass");
    expect(result.counts?.models).toBe(1);
    expect(
      api.requests.map((request: DataSourceHttpRequest) => {
        return new URL(request.url).pathname;
      }),
    ).toEqual([
      "/v1/organizations/usage_report/messages",
      "/v1/organizations/cost_report",
    ]);
  });

  test("a compliance key is refused before anything is sent", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new AnthropicConnector().testConnection(
        { ...SETTINGS, secrets: { adminKey: "sk-ant-api01-compliance" } },
        { transport: api.transport },
      );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Settings);
    expect(api.requests).toHaveLength(0);
  });
});

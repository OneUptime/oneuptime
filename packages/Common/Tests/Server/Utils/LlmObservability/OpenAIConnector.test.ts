import { describe, expect, test } from "@jest/globals";
import OpenAIAdminClient from "../../../../Server/Utils/LlmObservability/Connectors/OpenAI/OpenAIAdminClient";
import OpenAIConnector from "../../../../Server/Utils/LlmObservability/Connectors/OpenAI/OpenAIConnector";
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
  everythingSent,
  json,
  queryValues,
  sequence,
} from "./FakeProviderApi";

/*
 * The OpenAI connection against a fake OpenAI Admin API: the admin key and
 * where it goes, the usage and costs queries (1d buckets, group_by[] as
 * brackets, Unix seconds), paging both ways, names for ids, the cost shared
 * by tokens, every failure kind - and that the key never leaves in an error.
 */

const ADMIN_KEY: string = "sk-admin-0123456789abcdefTESTKEY";
const DAY_1: number = Date.UTC(2026, 9, 18) / 1000;
const DAY_2: number = Date.UTC(2026, 9, 19) / 1000;

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.OpenAI,
  config: {},
  secrets: { adminKey: ADMIN_KEY },
};

const WINDOW: { startDay: Date; endDay: Date } = {
  startDay: new Date(DAY_1 * 1000),
  endDay: new Date((DAY_2 + 86400) * 1000),
};

function usageBucket(start: number, results: Array<JSONObject>): JSONObject {
  return {
    object: "bucket",
    start_time: start,
    end_time: start + 86400,
    results: results.map((result: JSONObject): JSONObject => {
      return { object: "organization.usage.completions.result", ...result };
    }),
  };
}

function costBucket(start: number, results: Array<JSONObject>): JSONObject {
  return {
    object: "bucket",
    start_time: start,
    end_time: start + 86400,
    results: results.map((result: JSONObject): JSONObject => {
      return { object: "organization.costs.result", ...result };
    }),
  };
}

function page(
  data: Array<JSONObject>,
  nextPage: string | null = null,
): JSONObject {
  return {
    object: "page",
    data,
    has_more: Boolean(nextPage),
    next_page: nextPage,
  };
}

function list(
  data: Array<JSONObject>,
  lastId: string | null = null,
): JSONObject {
  return {
    object: "list",
    data,
    has_more: Boolean(lastId),
    last_id: lastId,
  };
}

function standardRoutes(
  overrides: Partial<Record<string, FakeRoute["respond"]>> = {},
): Array<FakeRoute> {
  return [
    {
      path: "/v1/organization/usage/completions",
      respond:
        overrides["completions"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            page([
              usageBucket(DAY_1, [
                {
                  model: "gpt-4o-2024-08-06",
                  project_id: "proj_a",
                  api_key_id: "key_1",
                  user_id: "user-alice",
                  input_tokens: 1000,
                  output_tokens: 400,
                  input_cached_tokens: 200,
                  num_model_requests: 10,
                },
                {
                  model: "gpt-4o-2024-08-06",
                  project_id: "proj_a",
                  api_key_id: "key_2",
                  user_id: null,
                  input_tokens: 3000,
                  output_tokens: 600,
                  input_cached_tokens: 0,
                  num_model_requests: 5,
                },
              ]),
              usageBucket(DAY_2, []),
            ]),
          );
        }),
    },
    {
      path: "/v1/organization/usage/embeddings",
      respond:
        overrides["embeddings"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            page([
              usageBucket(DAY_2, [
                {
                  model: "text-embedding-3-small",
                  project_id: "proj_b",
                  api_key_id: null,
                  user_id: null,
                  input_tokens: 50000,
                  num_model_requests: 20,
                },
              ]),
            ]),
          );
        }),
    },
    {
      path: "/v1/organization/costs",
      respond:
        overrides["costs"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            page([
              costBucket(DAY_1, [
                {
                  amount: { value: 3.0, currency: "usd" },
                  line_item: "gpt-4o-2024-08-06, input",
                  project_id: "proj_a",
                },
                {
                  amount: { value: 1.0, currency: "usd" },
                  line_item: "gpt-4o-2024-08-06, output",
                  project_id: "proj_a",
                },
                {
                  amount: { value: 0.25, currency: "usd" },
                  line_item: "web search tool calls",
                  project_id: "proj_a",
                },
              ]),
            ]),
          );
        }),
    },
    {
      path: "/v1/organization/projects",
      respond:
        overrides["projects"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            list([
              { id: "proj_a", name: "Checkout assistant" },
              { id: "proj_b", name: "Search" },
            ]),
          );
        }),
    },
    {
      path: "/v1/organization/users",
      respond:
        overrides["users"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            list([
              { id: "user-alice", email: "alice@example.com", name: "Alice" },
            ]),
          );
        }),
    },
    {
      path: "/v1/organization/projects/proj_a/api_keys",
      respond:
        overrides["keys"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json(
            list([
              {
                id: "key_1",
                name: "alice laptop",
                owner: {
                  type: "user",
                  user: { id: "user-alice", email: "alice@example.com" },
                },
              },
              {
                id: "key_2",
                name: "checkout-prod",
                owner: {
                  type: "user",
                  user: { id: "user-bob", email: "bob@example.com" },
                },
              },
            ]),
          );
        }),
    },
  ];
}

function sumCost(records: Array<LlmUsageRecord>): number {
  return records.reduce((sum: number, record: LlmUsageRecord): number => {
    return sum + (record.costUsd || 0);
  }, 0);
}

describe("OpenAIAdminClient.validateAdminKey", () => {
  test("an admin key is accepted", () => {
    expect(() => {
      return OpenAIAdminClient.validateAdminKey(ADMIN_KEY);
    }).not.toThrow();
  });

  test.each([
    ["sk-proj-abc123", "project API key"],
    ["sk-svcacct-abc123", "project API key"],
    ["sk-abc123", "starts with sk-admin-"],
    ["", "required"],
  ])("%s is refused, saying why (%s)", (key: string, words: string) => {
    expect(() => {
      return OpenAIAdminClient.validateAdminKey(key);
    }).toThrow(BadDataException);
    expect(() => {
      return OpenAIAdminClient.validateAdminKey(key);
    }).toThrow(words);
  });
});

describe("OpenAIAdminClient requests", () => {
  test("the key travels only in the Authorization header", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await client.listUsageBuckets({
      kind: "completions",
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    const request: DataSourceHttpRequest = api.requests[0]!;
    expect(request.method).toBe("GET");
    expect(request.headers?.["Authorization"]).toBe(`Bearer ${ADMIN_KEY}`);
    expect(request.url).not.toContain(ADMIN_KEY);
    expect(new URL(request.url).host).toBe("api.openai.com");
  });

  test("usage is asked for by day, grouped by model, project, key and user", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await client.listUsageBuckets({
      kind: "completions",
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    const request: DataSourceHttpRequest = api.requests[0]!;
    expect(queryValues(request, "start_time")).toEqual([String(DAY_1)]);
    expect(queryValues(request, "end_time")).toEqual([String(DAY_2 + 86400)]);
    expect(queryValues(request, "bucket_width")).toEqual(["1d"]);
    expect(queryValues(request, "group_by[]")).toEqual([
      "model",
      "project_id",
      "api_key_id",
      "user_id",
    ]);
    expect(queryValues(request, "limit")).toEqual(["31"]);
    expect(queryValues(request, "page")).toEqual([]);
  });

  test("costs are asked for by day, by project and line item", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await client.listCostBuckets({
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    const request: DataSourceHttpRequest = api.requests[0]!;
    expect(new URL(request.url).pathname).toBe("/v1/organization/costs");
    expect(queryValues(request, "group_by[]")).toEqual([
      "project_id",
      "line_item",
    ]);
    expect(queryValues(request, "bucket_width")).toEqual(["1d"]);
  });

  test("next_page is followed until has_more is false", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        completions: sequence([
          json(page([usageBucket(DAY_1, [])], "page_2")),
          json(page([usageBucket(DAY_2, [])], "page_3")),
          json(page([usageBucket(DAY_2 + 86400, [])])),
        ]),
      }),
    );
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    const buckets: Array<JSONObject> = await client.listUsageBuckets({
      kind: "completions",
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    expect(buckets).toHaveLength(3);
    expect(
      api.requests.map((request: DataSourceHttpRequest) => {
        return queryValues(request, "page");
      }),
    ).toEqual([[], ["page_2"], ["page_3"]]);
  });

  test("a cursor that does not move stops the paging", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        completions: (): ReturnType<FakeRoute["respond"]> => {
          return json(page([usageBucket(DAY_1, [])], "same"));
        },
      }),
    );
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await client.listUsageBuckets({
      kind: "completions",
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    expect(api.requests).toHaveLength(2);
  });

  test("lists follow last_id with after", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        users: sequence([
          json(list([{ id: "u1", email: "one@example.com" }], "u1")),
          json(list([{ id: "u2", email: "two@example.com" }])),
        ]),
      }),
    );
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    const emails: Map<string, string> = await client.listUserEmails();

    expect(Array.from(emails.entries())).toEqual([
      ["u1", "one@example.com"],
      ["u2", "two@example.com"],
    ]);
    expect(queryValues(api.requests[1]!, "after")).toEqual(["u1"]);
    expect(queryValues(api.requests[0]!, "limit")).toEqual(["100"]);
  });

  test.each([
    [401, LlmConnectionFailureKind.Authentication],
    [403, LlmConnectionFailureKind.Permission],
    [404, LlmConnectionFailureKind.Settings],
    [429, LlmConnectionFailureKind.RateLimited],
    [500, LlmConnectionFailureKind.Unavailable],
    [503, LlmConnectionFailureKind.Unavailable],
  ])(
    "HTTP %i is a %s failure, and the key is never in it",
    async (status: number, kind: LlmConnectionFailureKind) => {
      const api: FakeProviderApi = createFakeProviderApi(
        standardRoutes({
          costs: (): ReturnType<FakeRoute["respond"]> => {
            // A provider echoing the key back must still not leak it.
            return json(
              {
                error: { message: `Incorrect API key provided: ${ADMIN_KEY}` },
              },
              status,
            );
          },
        }),
      );
      const client: OpenAIAdminClient = new OpenAIAdminClient({
        adminKey: ADMIN_KEY,
        transport: api.transport,
      });

      let caught: unknown = null;

      try {
        await client.listCostBuckets({
          startTime: WINDOW.startDay,
          endTime: WINDOW.endDay,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(LlmProviderError);
      expect((caught as LlmProviderError).kind).toBe(kind);
      expect((caught as LlmProviderError).statusCode).toBe(status);
      expect((caught as LlmProviderError).message).toContain("OpenAI");
      expect((caught as LlmProviderError).message).not.toContain(ADMIN_KEY);
      expect((caught as LlmProviderError).message).not.toContain(
        "0123456789abcdef",
      );
    },
  );

  test("a response that is not JSON is a failure that says so", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        costs: (): ReturnType<FakeRoute["respond"]> => {
          return { status: 200, body: "<html>proxy</html>" };
        },
      }),
    );
    const client: OpenAIAdminClient = new OpenAIAdminClient({
      adminKey: ADMIN_KEY,
      transport: api.transport,
    });

    await expect(
      client.listCostBuckets({
        startTime: WINDOW.startDay,
        endTime: WINDOW.endDay,
      }),
    ).rejects.toThrow("not a JSON object");
  });
});

describe("OpenAIConnector mapping", () => {
  test("usage rows count every input token and read cache writes in either shape", () => {
    const rows: ReturnType<typeof OpenAIConnector.readUsageRows> =
      OpenAIConnector.readUsageRows([
        usageBucket(DAY_1, [
          {
            model: "gpt-5",
            input_tokens: 500,
            output_tokens: 50,
            input_cached_tokens: 100,
            input_cache_write_tokens: 30,
            num_model_requests: 2,
          },
          {
            model: "gpt-5",
            input_tokens: 10,
            input_cache_write_30m_tokens: 3,
            input_cache_write_12h_tokens: 4,
          },
        ]),
        {
          start_time: "not a time",
          results: [{ model: "x", input_tokens: 9 }],
        },
      ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      day: new Date(DAY_1 * 1000),
      model: "gpt-5",
      inputTokens: 500,
      outputTokens: 50,
      cacheReadTokens: 100,
      cacheWriteTokens: 30,
      requests: 2,
    });
    expect(rows[1]!.cacheWriteTokens).toBe(7);
  });

  test("cost lines read the model and the kind of tokens from the line item", () => {
    const lines: ReturnType<typeof OpenAIConnector.readCostLines> =
      OpenAIConnector.readCostLines([
        costBucket(DAY_1, [
          {
            amount: { value: 2, currency: "usd" },
            line_item: "gpt-4o, input",
            project_id: "p",
          },
          {
            amount: { value: 1, currency: "usd" },
            line_item: "gpt-4o, cached input",
            project_id: "p",
          },
          {
            amount: { value: 4, currency: "usd" },
            line_item: "gpt-4o, output",
            project_id: "p",
          },
          {
            amount: { value: 5, currency: "usd" },
            line_item: "file search",
            project_id: "p",
          },
          {
            amount: { value: 7, currency: "eur" },
            line_item: "gpt-4o, input",
            project_id: "p",
          },
          {
            amount: { value: 0, currency: "usd" },
            line_item: "gpt-4o, input",
            project_id: "p",
          },
        ]),
      ]);

    expect(
      lines.map(
        (line: { model: string; tokenType: unknown; costUsd: number }) => {
          return [line.model, line.tokenType, line.costUsd];
        },
      ),
    ).toEqual([
      ["gpt-4o", "input", 2],
      ["gpt-4o", "cache_read", 1],
      ["gpt-4o", "output", 4],
      ["", null, 5],
    ]);
  });

  test("ids become names, the person comes from the user or the key's owner, and the cost is shared by tokens", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());

    const result: LlmUsageFetchResult = await new OpenAIConnector().fetchUsage(
      SETTINGS,
      WINDOW,
      { transport: api.transport },
    );

    expect(result.warnings).toEqual([]);

    const alice: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.apiKey === "alice laptop";
      },
    );
    const checkout: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.apiKey === "checkout-prod";
      },
    );

    expect(alice).toMatchObject({
      person: "alice@example.com",
      project: "Checkout assistant",
      model: "gpt-4o-2024-08-06",
      requests: 10,
    });
    // No user on the row: the key's owner is the person.
    expect(checkout!.person).toBe("bob@example.com");

    /*
     * Input $3 is shared by uncached input (800 vs 3000), output $1 by
     * output (400 vs 600).
     */
    expect(alice!.costUsd).toBeCloseTo((3 * 800) / 3800 + (1 * 400) / 1000, 10);
    expect(checkout!.costUsd).toBeCloseTo(
      (3 * 3000) / 3800 + (1 * 600) / 1000,
      10,
    );

    // The web search line matched no usage: it is kept whole.
    const webSearch: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.model === "web search tool calls";
      },
    );
    expect(webSearch!.costUsd).toBe(0.25);
    expect(webSearch!.project).toBe("Checkout assistant");

    // The bill to the cent.
    expect(sumCost(result.records)).toBeCloseTo(4.25, 10);

    // Embeddings: tokens and requests, no cost line for them.
    const embeddings: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.model === "text-embedding-3-small";
      },
    );
    expect(embeddings).toMatchObject({
      project: "Search",
      inputTokens: 50000,
      requests: 20,
      costUsd: null,
    });

    // Only the project with keys in use had its keys looked up.
    expect(
      api.requestsTo("/v1/organization/projects/proj_b/api_keys"),
    ).toHaveLength(0);
    for (const request of api.requests) {
      expect(new URL(request.url).host).toBe("api.openai.com");
    }
  });

  test("when names cannot be read, ids stay and the read still succeeds", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        users: (): ReturnType<FakeRoute["respond"]> => {
          return json({ error: "forbidden" }, 403);
        },
      }),
    );

    const result: LlmUsageFetchResult = await new OpenAIConnector().fetchUsage(
      SETTINGS,
      WINDOW,
      { transport: api.transport },
    );

    expect(result.warnings).toHaveLength(1);
    expect(
      result.records.some((record: LlmUsageRecord) => {
        return record.person === "user-alice";
      }),
    ).toBe(true);
    expect(sumCost(result.records)).toBeCloseTo(4.25, 10);
  });

  test("a failed usage report fails the read", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        completions: (): ReturnType<FakeRoute["respond"]> => {
          return json({ error: "boom" }, 500);
        },
      }),
    );

    await expect(
      new OpenAIConnector().fetchUsage(SETTINGS, WINDOW, {
        transport: api.transport,
      }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});

describe("OpenAIConnector.testConnection", () => {
  const now: () => Date = (): Date => {
    return new Date((DAY_2 + 3600) * 1000);
  };

  test("a working key with usage passes, with what it found", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());

    const result: LlmConnectionTestResult =
      await new OpenAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now,
      });

    expect(result.status).toBe("pass");
    expect(result.counts).toMatchObject({
      days: 7,
      // gpt-4o; the web search line kept whole is not a model.
      models: 1,
      requests: 15,
      inputTokens: 4000,
      outputTokens: 1000,
    });
    expect(result.counts?.costUsd).toBeCloseTo(4.25, 2);
    // A test reads usage and costs only: no names, no keys.
    expect(
      api.requests
        .map((request: DataSourceHttpRequest) => {
          return new URL(request.url).pathname;
        })
        .sort(),
    ).toEqual(["/v1/organization/costs", "/v1/organization/usage/completions"]);
  });

  test("a working key with no usage is a warning", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        completions: (): ReturnType<FakeRoute["respond"]> => {
          return json(page([]));
        },
        costs: (): ReturnType<FakeRoute["respond"]> => {
          return json(page([]));
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new OpenAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now,
      });

    expect(result.status).toBe("warn");
  });

  test("a refused key fails as authentication, without the key", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      standardRoutes({
        completions: (): ReturnType<FakeRoute["respond"]> => {
          return json({ error: { message: `bad key ${ADMIN_KEY}` } }, 401);
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new OpenAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now,
      });

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Authentication);
    expect(JSON.stringify(result)).not.toContain(ADMIN_KEY);
  });

  test("a project key fails as settings before anything is sent", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());

    const result: LlmConnectionTestResult =
      await new OpenAIConnector().testConnection(
        { ...SETTINGS, secrets: { adminKey: "sk-proj-123" } },
        { transport: api.transport, now },
      );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Settings);
    expect(api.requests).toHaveLength(0);
  });

  test("nothing it sends carries the key anywhere but the header", async () => {
    const api: FakeProviderApi = createFakeProviderApi(standardRoutes());

    await new OpenAIConnector().fetchUsage(SETTINGS, WINDOW, {
      transport: api.transport,
    });

    for (const request of api.requests) {
      const { headers, ...rest } = request;
      expect(JSON.stringify(rest)).not.toContain(ADMIN_KEY);
      expect(headers?.["Authorization"]).toBe(`Bearer ${ADMIN_KEY}`);
      expect(everythingSent(request)).toContain("Bearer");
    }
  });
});

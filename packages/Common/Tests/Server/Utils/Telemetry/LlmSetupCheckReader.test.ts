import { afterEach, describe, expect, jest, test } from "@jest/globals";
import LlmSetupCheckReader, {
  GENAI_LOG_EVENT_ATTRIBUTE_KEYS,
  LLM_SETUP_CHECK_PROVIDER_USAGE_DAYS,
  LlmAppCallRow,
  LlmSetupCheckQuery,
} from "../../../../Server/Utils/Telemetry/LlmSetupCheckReader";
import SpanService from "../../../../Server/Services/SpanService";
import MetricService from "../../../../Server/Services/MetricService";
import LogService from "../../../../Server/Services/LogService";
import LlmObservabilityConnectionService from "../../../../Server/Services/LlmObservabilityConnectionService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import LlmObservabilityConnection from "../../../../Models/DatabaseModels/LlmObservabilityConnection";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import {
  LLM_METRIC_SOURCE_PREFIXES,
  LLM_SETUP_CHECK_MAX_LIST,
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
  LlmSetupCheckResponse,
} from "../../../../Types/Telemetry/LlmSetupCheckApi";
import { LLM_PROVIDER_EXACT_HOSTS } from "../../../../Types/Telemetry/LlmProviders";
import LlmMetricUsageUtil from "../../../../Utils/Telemetry/LlmMetricUsage";

/*
 * THE AI / LLM SETUP CHECK'S READS, WITHOUT A SERVER.
 *
 * The check answers, for one project and one caller, what each way AI
 * comes in is bringing: the apps' AI calls (and whether what was said was
 * recorded), the outgoing calls to an AI provider that nothing records,
 * the coding tools' metrics and each connection. Every read is capped, and
 * a part that fails says "unknown", never "none". These pin the SQL each
 * part sends, how its rows fold, and how the parts come together.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const SERVICE_A: ObjectID = new ObjectID("9900000000000000000000b1");
const SERVICE_B: ObjectID = new ObjectID("9900000000000000000000b2");
const TOOL_SERVICE: ObjectID = new ObjectID("9900000000000000000000c1");
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

function query(
  overrides: Partial<LlmSetupCheckQuery> = {},
): LlmSetupCheckQuery {
  return {
    projectId: PROJECT,
    now: NOW,
    metricFilter: {},
    logFilter: {},
    props: { tenantId: PROJECT, isRoot: true },
    ...overrides,
  };
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function appRow(overrides: Partial<LlmAppCallRow> = {}): LlmAppCallRow {
  return {
    serviceId: SERVICE_A.toString(),
    provider: "openai",
    callsRecently: 10,
    callsInWindow: 0,
    answersRecently: 8,
    answersWithContent: 8,
    newestAtMs: NOW.getTime() - 60_000,
    ...overrides,
  };
}

describe("the AI calls read", () => {
  const statement: Statement = LlmSetupCheckReader.buildAppCallsStatement(
    query({
      serviceIds: [SERVICE_A],
      excludedServiceIds: [SERVICE_B],
      windowStart: new Date(NOW.getTime() - 30 * DAY),
      windowEnd: NOW,
    }),
  );
  const sql: string = statement.query;

  test("reads the project's AI / LLM spans, still retained", () => {
    expect(sql).toContain("FROM SpanItemV3");
    expect(sql).toContain("WHERE projectId = ");
    expect(sql).toContain("AND isLlmSpan = 1");
    expect(sql).toContain("AND retentionDate >= now()");
    expect(paramValues(statement)).toContain(PROJECT.toString());
  });

  test("columns only: no attribute map is read", () => {
    expect(sql).not.toContain("attributes[");
    expect(sql).not.toContain("attributes AS");
  });

  test("counts the past week, the window, answers and answers with a recorded question", () => {
    expect(sql).toContain(") AS callsRecently, ");
    expect(sql).toContain(") AS callsInWindow, ");
    expect(sql).toContain(") AS answersRecently, ");
    expect(sql).toContain(
      "AND llmUserMessagePreview != '') AS answersWithContent",
    );
    expect(sql).toContain(
      "toUnixTimestamp(max(startTime)) * 1000 AS newestAtMs",
    );
    expect(sql).toContain("GROUP BY serviceId, provider");
  });

  test("covers the window when it reaches further back than the past week", () => {
    const range: { from: Date; to: Date } = LlmSetupCheckReader.getAppRange(
      query({
        windowStart: new Date(NOW.getTime() - 30 * DAY),
        windowEnd: NOW,
      }),
    );

    expect(range.from.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(range.to.getTime()).toBe(NOW.getTime());
  });

  test("covers the past week when the window is shorter", () => {
    const range: { from: Date; to: Date } = LlmSetupCheckReader.getAppRange(
      query({
        windowStart: new Date(NOW.getTime() - DAY),
        windowEnd: NOW,
      }),
    );

    expect(range.from.getTime()).toBe(NOW.getTime() - 7 * DAY);
  });

  test("without a window, its count is a constant 0", () => {
    const noWindow: string =
      LlmSetupCheckReader.buildAppCallsStatement(query()).query;

    expect(noWindow).toContain("0 AS callsInWindow");
  });

  test("the caller's scope is a WHERE", () => {
    const where: string = sql.slice(0, sql.indexOf(" GROUP BY "));

    expect(where).toContain("AND primaryEntityId IN (");
    expect(where).toContain("AND primaryEntityId NOT IN (");
    expect(paramValues(statement)).toContainEqual([SERVICE_A.toString()]);
    expect(paramValues(statement)).toContainEqual([SERVICE_B.toString()]);
  });

  test("a read cut short throws, never answers an empty body", () => {
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });
});

describe("the newest AI call before the range", () => {
  const statement: Statement = LlmSetupCheckReader.buildNewestCallStatement(
    query(),
    {
      before: new Date(NOW.getTime() - 7 * DAY),
      toolServiceIds: [TOOL_SERVICE.toString()],
    },
  );

  test("reads newest first and stops at the first", () => {
    expect(statement.query).toContain("ORDER BY startTime DESC LIMIT 1");
    expect(statement.query).toContain("AND isLlmSpan = 1 AND startTime < ");
  });

  test("leaves out the company AI tools' imported chats", () => {
    expect(statement.query).toContain("AND primaryEntityId NOT IN (");
    expect(paramValues(statement)).toContainEqual([TOOL_SERVICE.toString()]);
  });

  test("with no tool, nothing is left out", () => {
    expect(
      LlmSetupCheckReader.buildNewestCallStatement(query(), {
        before: NOW,
        toolServiceIds: [],
      }).query,
    ).not.toContain("NOT IN");
  });
});

describe("the uninstrumented calls read", () => {
  const statement: Statement =
    LlmSetupCheckReader.buildUninstrumentedStatement(query());
  const sql: string = statement.query;

  test("reads the past day's HTTP client spans that are not AI calls", () => {
    expect(sql).toContain("kind = 'SPAN_KIND_CLIENT' AND isLlmSpan = 0");
    expect(sql).toContain("AND startTime >= ");
  });

  test("the host is the first address key a span carries, without a port", () => {
    expect(sql).toContain("nullIf(attributes['server.address'], '')");
    expect(sql).toContain("nullIf(attributes['net.peer.name'], '')");
    expect(sql).toContain(
      "nullIf(domain(concat('http://', attributes['http.host'])), '')",
    );
    expect(sql).toContain("nullIf(domain(attributes['url.full']), '')");
    expect(sql).toContain("nullIf(domain(attributes['http.url']), '')");
  });

  test("matches every AI provider's host", () => {
    expect(paramValues(statement)).toContainEqual(
      Object.keys(LLM_PROVIDER_EXACT_HOSTS),
    );
    expect(paramValues(statement)).toContain(".openai.azure.com");
    expect(paramValues(statement)).toContain(".services.ai.azure.com");
    expect(paramValues(statement)).toContain("-aiplatform.googleapis.com");
    expect(paramValues(statement)).toContain("bedrock-runtime");
  });

  test("bounded: one day, 15 seconds, ten rows", () => {
    expect(sql).toContain("max_execution_time = 15");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(paramValues(statement)).toContain(LLM_SETUP_CHECK_MAX_LIST);
  });
});

describe("the GenAI log events read", () => {
  const statement: Statement = LlmSetupCheckReader.buildContentInLogsStatement(
    query(),
    { serviceIds: [SERVICE_A] },
  );

  test("finds the first log record that is a GenAI event, by its keys' index", () => {
    expect(statement.query).toContain("FROM LogItemV3");
    expect(statement.query).toContain("has(attributeKeys, ");
    expect(statement.query).toContain(" LIMIT 1");

    for (const key of GENAI_LOG_EVENT_ATTRIBUTE_KEYS) {
      expect(paramValues(statement)).toContain(key);
    }
  });

  test("in the log scope", () => {
    expect(statement.query).toContain("AND primaryEntityId IN (");
  });
});

describe("the coding tools' metrics read", () => {
  const statement: Statement = LlmSetupCheckReader.buildMetricSourcesStatement(
    query(),
    { excludedServiceIds: [SERVICE_B] },
  );

  test("names and times only: no attribute map is read", () => {
    expect(statement.query).not.toContain("attributes[");
    expect(statement.query).toContain("GROUP BY name");
  });

  test("the usage metrics and every coding assistant's namespace", () => {
    expect(paramValues(statement)).toContainEqual(
      LlmMetricUsageUtil.getMetricNames(),
    );

    for (const entry of LLM_METRIC_SOURCE_PREFIXES) {
      expect(paramValues(statement)).toContain(entry.prefix);
    }
  });

  test("in the metric scope", () => {
    expect(statement.query).toContain("AND primaryEntityId NOT IN (");
  });
});

describe("the provider accounts' newest usage read", () => {
  const statement: Statement = LlmSetupCheckReader.buildProviderUsageStatement(
    query(),
    {},
  );

  test("each connection's newest point with usage", () => {
    expect(statement.query).toContain(" AS connectionId");
    expect(statement.query).toContain("AND value > 0");
    expect(statement.query).toContain("GROUP BY connectionId");
    expect(paramValues(statement)).toContain("oneuptime.llm.connection.id");
  });

  test("looks back a bounded number of days", () => {
    expect(LLM_SETUP_CHECK_PROVIDER_USAGE_DAYS).toBe(90);
  });
});

describe("folding the AI calls", () => {
  test("adds up the apps, newest first per app, providers by their name", () => {
    const apps: LlmSetupCheckApps = LlmSetupCheckReader.toApps({
      rows: [
        appRow({ provider: "az.ai.openai", callsRecently: 5 }),
        appRow({ provider: "azure.ai.openai", callsRecently: 7 }),
        appRow({
          serviceId: SERVICE_B.toString(),
          provider: "openai",
          callsRecently: 30,
        }),
      ],
      toolServiceIds: new Set<string>(),
      newestBeforeMs: 0,
      hasWindow: true,
      uninstrumented: null,
      contentInLogs: null,
    });

    expect(apps.callsRecently).toBe(42);
    expect(
      apps.services.map((service: { serviceId: string }) => {
        return service.serviceId;
      }),
    ).toEqual([SERVICE_B.toString(), SERVICE_A.toString()]);
    // az.ai.openai and azure.ai.openai are one provider.
    expect(apps.providers).toEqual([
      { name: "openai", calls: 30 },
      { name: "azure.ai.openai", calls: 12 },
    ]);
  });

  test("the company AI tools' chats are not app calls", () => {
    const apps: LlmSetupCheckApps = LlmSetupCheckReader.toApps({
      rows: [
        appRow({
          serviceId: TOOL_SERVICE.toString().toUpperCase(),
          callsRecently: 99,
        }),
      ],
      toolServiceIds: new Set<string>([TOOL_SERVICE.toString().toLowerCase()]),
      newestBeforeMs: 0,
      hasWindow: true,
      uninstrumented: null,
      contentInLogs: null,
    });

    expect(apps.callsRecently).toBe(0);
    expect(apps.services).toEqual([]);
    expect(apps.newestCallAt).toBeNull();
  });

  test("the newest call is the range's, else the one before it", () => {
    const before: number = NOW.getTime() - 40 * DAY;

    expect(
      LlmSetupCheckReader.toApps({
        rows: [],
        toolServiceIds: new Set<string>(),
        newestBeforeMs: before,
        hasWindow: true,
        uninstrumented: null,
        contentInLogs: null,
      }).newestCallAt,
    ).toBe(new Date(before).toISOString());
  });

  test("no window asked: its count is unknown, not 0", () => {
    expect(
      LlmSetupCheckReader.toApps({
        rows: [appRow()],
        toolServiceIds: new Set<string>(),
        newestBeforeMs: 0,
        hasWindow: false,
        uninstrumented: null,
        contentInLogs: null,
      }).callsInWindow,
    ).toBeNull();
  });

  test("answers and recorded answers add up", () => {
    const apps: LlmSetupCheckApps = LlmSetupCheckReader.toApps({
      rows: [
        appRow({ answersRecently: 10, answersWithContent: 0 }),
        appRow({ answersRecently: 5, answersWithContent: 2 }),
      ],
      toolServiceIds: new Set<string>(),
      newestBeforeMs: 0,
      hasWindow: true,
      uninstrumented: null,
      contentInLogs: true,
    });

    expect(apps.answersRecently).toBe(15);
    expect(apps.answersWithContent).toBe(2);
    expect(apps.contentInLogs).toBe(true);
  });

  test("lists are cut to the most calls", () => {
    const rows: Array<LlmAppCallRow> = [];

    for (let index: number = 0; index < 15; index++) {
      rows.push(
        appRow({
          serviceId: `9900000000000000000000${String(index).padStart(2, "0")}`,
          callsRecently: index + 1,
        }),
      );
    }

    const apps: LlmSetupCheckApps = LlmSetupCheckReader.toApps({
      rows,
      toolServiceIds: new Set<string>(),
      newestBeforeMs: 0,
      hasWindow: true,
      uninstrumented: null,
      contentInLogs: null,
    });

    expect(apps.services).toHaveLength(LLM_SETUP_CHECK_MAX_LIST);
    expect(apps.services[0]!.calls).toBe(15);
  });
});

describe("folding the other parts", () => {
  test("uninstrumented rows name their provider; a host of none is dropped", () => {
    expect(
      LlmSetupCheckReader.toUninstrumented([
        {
          serviceId: SERVICE_A.toString(),
          host: "api.openai.com",
          calls: "12",
        },
        {
          serviceId: SERVICE_A.toString(),
          host: "contoso.openai.azure.com",
          calls: 3,
        },
        { serviceId: SERVICE_A.toString(), host: "api.stripe.com", calls: 9 },
        { serviceId: SERVICE_A.toString(), host: "api.openai.com", calls: 0 },
      ] as Array<JSONObject>),
    ).toEqual([
      {
        serviceId: SERVICE_A.toString(),
        host: "api.openai.com",
        provider: "openai",
        calls: 12,
      },
      {
        serviceId: SERVICE_A.toString(),
        host: "contoso.openai.azure.com",
        provider: "azure.ai.openai",
        calls: 3,
      },
    ]);
  });

  test("metrics fold by tool, newest arrival first, most points first", () => {
    const sources: ReturnType<typeof LlmSetupCheckReader.toMetricSources> =
      LlmSetupCheckReader.toMetricSources([
        { name: "claude_code.cost.usage", points: "120", newestAtMs: 1000 },
        { name: "claude_code.token.usage", points: 480, newestAtMs: 3000 },
        { name: "gen_ai.client.token.usage", points: 10, newestAtMs: 2000 },
        { name: "cursor.cost.usage", points: 5, newestAtMs: 500 },
      ] as Array<JSONObject>);

    expect(sources).toEqual([
      {
        source: LlmMetricSource.ClaudeCode,
        points: 600,
        newestAt: new Date(3000).toISOString(),
      },
      {
        source: LlmMetricSource.GenAi,
        points: 10,
        newestAt: new Date(2000).toISOString(),
      },
      {
        source: LlmMetricSource.Cursor,
        points: 5,
        newestAt: new Date(500).toISOString(),
      },
    ]);
  });
});

describe("a connection as the check reports it", () => {
  function model(
    overrides: Partial<Record<string, unknown>> = {},
  ): LlmObservabilityConnection {
    const connection: LlmObservabilityConnection =
      new LlmObservabilityConnection();
    connection._id = "9900000000000000000000d1";
    connection.name = "Production Azure";
    connection.provider = LlmConnectionProvider.AzureOpenAI;
    connection.isEnabled = true;
    connection.lastPulledAt = new Date(NOW.getTime() - 60_000);
    connection.lastSuccessfulPullAt = new Date(NOW.getTime() - 60_000);
    Object.assign(connection, overrides);
    return connection;
  }

  test("a provider account: its state, resources, first day read and newest usage", () => {
    const reported: LlmSetupCheckConnection = LlmSetupCheckReader.toConnection({
      connection: model({
        lastPullResult: {
          kind: "usage",
          resources: 3,
          readSince: "2026-10-05T00:00:00.000Z",
          newestUsageDay: "2026-10-20T00:00:00.000Z",
        },
      }),
      newestUsageAtMs: Date.parse("2026-11-02T00:00:00.000Z"),
      toolCallsRecently: null,
    });

    expect(reported).toEqual({
      connectionId: "9900000000000000000000d1",
      name: "Production Azure",
      provider: LlmConnectionProvider.AzureOpenAI,
      kind: "provider-account",
      isEnabled: true,
      lastReadAt: new Date(NOW.getTime() - 60_000).toISOString(),
      lastSuccessfulReadAt: new Date(NOW.getTime() - 60_000).toISOString(),
      lastError: "",
      // The stored metrics' newest day wins over the last read's older one.
      newestUsageAt: "2026-11-02T00:00:00.000Z",
      resources: 3,
      readSince: "2026-10-05T00:00:00.000Z",
      callsRecently: null,
    });
  });

  test("the last read's newest usage day counts when nothing newer is stored", () => {
    expect(
      LlmSetupCheckReader.toConnection({
        connection: model({
          lastPullResult: { newestUsageDay: "2026-10-20T00:00:00.000Z" },
        }),
        newestUsageAtMs: 0,
        toolCallsRecently: null,
      }).newestUsageAt,
    ).toBe("2026-10-20T00:00:00.000Z");
  });

  test("a company AI tool: its chats of the past week, no usage fields", () => {
    const reported: LlmSetupCheckConnection = LlmSetupCheckReader.toConnection({
      connection: model({
        provider: LlmConnectionProvider.ClaudeEnterprise,
        lastPullResult: { resources: 3, readSince: "2026-10-05T00:00:00.000Z" },
      }),
      newestUsageAtMs: 1,
      toolCallsRecently: 12,
    });

    expect(reported.kind).toBe("company-tool");
    expect(reported.callsRecently).toBe(12);
    expect(reported.newestUsageAt).toBeNull();
    expect(reported.resources).toBeNull();
    expect(reported.readSince).toBeNull();
  });

  test("a turned-off connection says so, and its error is its own words", () => {
    const reported: LlmSetupCheckConnection = LlmSetupCheckReader.toConnection({
      connection: model({ isEnabled: false, lastError: "Unauthorized." }),
      newestUsageAtMs: 0,
      toolCallsRecently: null,
    });

    expect(reported.isEnabled).toBe(false);
    expect(reported.lastError).toBe("Unauthorized.");
  });

  /*
   * The last read failed and said why (the pull runner keeps the kind on
   * the result): the check passes the kind on, so the card says it in the
   * product's words rather than the provider's JSON.
   */
  test("a failed read passes on what kind of failure it was", () => {
    const reported: LlmSetupCheckConnection = LlmSetupCheckReader.toConnection({
      connection: model({
        lastError: "Azure OpenAI request failed with HTTP 403.",
        lastPullResult: { status: "failed", failureKind: "permission" },
      }),
      newestUsageAtMs: 0,
      toolCallsRecently: null,
    });

    expect(reported.failureKind).toBe("permission");
    expect(reported.lastError).toBe(
      "Azure OpenAI request failed with HTTP 403.",
    );
  });

  test("no failure kind from a read that did not fail, or one with no error kept", () => {
    for (const overrides of [
      // A good read after the failure: its result has no kind.
      {
        lastError: "HTTP 403",
        lastPullResult: { status: "success", failureKind: "permission" },
      },
      // A failed result whose error was cleared.
      {
        lastError: "",
        lastPullResult: { status: "failed", failureKind: "permission" },
      },
      // A failed result that kept no kind.
      { lastError: "HTTP 500", lastPullResult: { status: "failed" } },
      // A kind that is not text.
      {
        lastError: "HTTP 500",
        lastPullResult: { status: "failed", failureKind: 3 },
      },
    ]) {
      expect(
        LlmSetupCheckReader.toConnection({
          connection: model(overrides),
          newestUsageAtMs: 0,
          toolCallsRecently: null,
        }),
      ).not.toHaveProperty("failureKind");
    }
  });
});

describe("read", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function answer(rows: Array<JSONObject>): unknown {
    return {
      json: async (): Promise<{ data: Array<JSONObject> }> => {
        return { data: rows };
      },
    };
  }

  function statementOf(call: Array<unknown>): string {
    return (call[0] as Statement).query;
  }

  interface Served {
    spans?: (sql: string) => Array<JSONObject> | Error;
    metrics?: (sql: string) => Array<JSONObject> | Error;
    logs?: Array<JSONObject> | Error;
    connections?: Array<LlmObservabilityConnection> | Error;
  }

  function serve(served: Served): {
    span: ReturnType<typeof jest.spyOn>;
    metric: ReturnType<typeof jest.spyOn>;
    log: ReturnType<typeof jest.spyOn>;
  } {
    const reply: (value: Array<JSONObject> | Error) => Promise<unknown> = (
      value: Array<JSONObject> | Error,
    ): Promise<unknown> => {
      return value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve(answer(value));
    };

    jest
      .spyOn(LlmObservabilityConnectionService, "findBy")
      .mockImplementation((async () => {
        if (served.connections instanceof Error) {
          throw served.connections;
        }

        return served.connections || [];
      }) as never);

    return {
      span: jest.spyOn(SpanService, "executeQuery").mockImplementation(((
        statement: Statement,
      ) => {
        return reply(
          served.spans
            ? served.spans(statement.query)
            : ([] as Array<JSONObject>),
        );
      }) as never),
      metric: jest.spyOn(MetricService, "executeQuery").mockImplementation(((
        statement: Statement,
      ) => {
        return reply(
          served.metrics
            ? served.metrics(statement.query)
            : ([] as Array<JSONObject>),
        );
      }) as never),
      log: jest.spyOn(LogService, "executeQuery").mockImplementation((() => {
        return reply(served.logs || []);
      }) as never),
    };
  }

  test("a project that sends AI calls with recorded prompts: no further checks are read", async () => {
    const spies: {
      span: ReturnType<typeof jest.spyOn>;
      log: ReturnType<typeof jest.spyOn>;
    } = serve({
      spans: (): Array<JSONObject> => {
        return [
          {
            serviceId: SERVICE_A.toString(),
            provider: "openai",
            callsRecently: 12,
            callsInWindow: 0,
            answersRecently: 10,
            answersWithContent: 10,
            newestAtMs: NOW.getTime() - 60_000,
          },
        ];
      },
    });

    const check: LlmSetupCheckResponse =
      await LlmSetupCheckReader.read(query());

    expect(check.apps!.callsRecently).toBe(12);
    // Only the calls read: the newest-before, uninstrumented and log reads are not needed.
    expect(spies.span).toHaveBeenCalledTimes(1);
    expect(spies.log).not.toHaveBeenCalled();
    expect(check.checkedAt).toBe(NOW.toISOString());
  });

  test("no AI calls: the newest before the range and the uninstrumented calls are read", async () => {
    const spies: { span: ReturnType<typeof jest.spyOn> } = serve({
      spans: (sql: string): Array<JSONObject> => {
        if (sql.includes("ORDER BY startTime DESC LIMIT 1")) {
          return [{ atMs: NOW.getTime() - 40 * DAY }];
        }

        if (sql.includes("SPAN_KIND_CLIENT")) {
          return [
            {
              serviceId: SERVICE_A.toString(),
              host: "contoso.openai.azure.com",
              calls: 77,
            },
          ];
        }

        return [];
      },
    });

    const check: LlmSetupCheckResponse =
      await LlmSetupCheckReader.read(query());

    expect(spies.span).toHaveBeenCalledTimes(3);
    expect(check.apps!.newestCallAt).toBe(
      new Date(NOW.getTime() - 40 * DAY).toISOString(),
    );
    expect(check.apps!.uninstrumented).toEqual([
      {
        serviceId: SERVICE_A.toString(),
        host: "contoso.openai.azure.com",
        provider: "azure.ai.openai",
        calls: 77,
      },
    ]);
  });

  test("answers with no recorded prompt: the logs are read for GenAI events", async () => {
    const spies: { log: ReturnType<typeof jest.spyOn> } = serve({
      spans: (): Array<JSONObject> => {
        return [
          {
            serviceId: SERVICE_A.toString(),
            provider: "openai",
            callsRecently: 12,
            callsInWindow: 0,
            answersRecently: 10,
            answersWithContent: 0,
            newestAtMs: NOW.getTime(),
          },
        ];
      },
      logs: [{ found: 1 }],
    });

    const check: LlmSetupCheckResponse =
      await LlmSetupCheckReader.read(query());

    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(check.apps!.contentInLogs).toBe(true);
  });

  test("a caller who may not read logs gets no log read", async () => {
    const spies: { log: ReturnType<typeof jest.spyOn> } = serve({
      spans: (): Array<JSONObject> => {
        return [
          {
            serviceId: SERVICE_A.toString(),
            provider: "openai",
            callsRecently: 12,
            callsInWindow: 0,
            answersRecently: 10,
            answersWithContent: 0,
            newestAtMs: NOW.getTime(),
          },
        ];
      },
    });

    const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
      query({ logFilter: null }),
    );

    expect(spies.log).not.toHaveBeenCalled();
    expect(check.apps!.contentInLogs).toBeNull();
  });

  test("a caller who may not read metrics gets no metrics part, never an unscoped read", async () => {
    const spies: { metric: ReturnType<typeof jest.spyOn> } = serve({});

    const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
      query({ metricFilter: null }),
    );

    expect(spies.metric).not.toHaveBeenCalled();
    expect(check.metrics).toBeNull();
  });

  test("each part that fails is unknown, and the rest still answers", async () => {
    serve({
      spans: (): Error => {
        return new Error("Timeout exceeded");
      },
      metrics: (sql: string): Array<JSONObject> | Error => {
        return sql.includes("GROUP BY name")
          ? [{ name: "claude_code.cost.usage", points: 5, newestAtMs: 1 }]
          : new Error("boom");
      },
      connections: new Error("You do not have permission"),
    });

    const check: LlmSetupCheckResponse =
      await LlmSetupCheckReader.read(query());

    expect(check.apps).toBeNull();
    expect(check.connections).toBeNull();
    expect(check.metrics).toEqual([
      {
        source: LlmMetricSource.ClaudeCode,
        points: 5,
        newestAt: new Date(1).toISOString(),
      },
    ]);
  });

  test("connections: the company AI tools' chats, the provider accounts' newest usage", async () => {
    const tool: LlmObservabilityConnection = new LlmObservabilityConnection();
    tool._id = "9900000000000000000000d2";
    tool.name = "Claude";
    tool.provider = LlmConnectionProvider.ClaudeEnterprise;
    tool.isEnabled = true;
    tool.serviceId = TOOL_SERVICE;

    const account: LlmObservabilityConnection =
      new LlmObservabilityConnection();
    account._id = "9900000000000000000000d3";
    account.name = "OpenAI";
    account.provider = LlmConnectionProvider.OpenAI;
    account.isEnabled = true;

    serve({
      connections: [tool, account],
      spans: (sql: string): Array<JSONObject> => {
        if (sql.includes("GROUP BY serviceId, provider")) {
          return [
            {
              serviceId: TOOL_SERVICE.toString(),
              provider: "anthropic",
              callsRecently: 9,
              callsInWindow: 0,
              answersRecently: 9,
              answersWithContent: 9,
              newestAtMs: NOW.getTime(),
            },
          ];
        }

        return [];
      },
      metrics: (sql: string): Array<JSONObject> => {
        return sql.includes("GROUP BY connectionId")
          ? [
              {
                connectionId: "9900000000000000000000D3",
                newestAtMs: Date.parse("2026-11-01T00:00:00.000Z"),
              },
            ]
          : [];
      },
    });

    const check: LlmSetupCheckResponse =
      await LlmSetupCheckReader.read(query());

    const byName: Map<string, LlmSetupCheckConnection> = new Map(
      check.connections!.map(
        (
          connection: LlmSetupCheckConnection,
        ): [string, LlmSetupCheckConnection] => {
          return [connection.name, connection];
        },
      ),
    );

    expect(byName.get("Claude")!.callsRecently).toBe(9);
    expect(byName.get("OpenAI")!.newestUsageAt).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    // The tool's imported chats are not counted as an app's AI calls.
    expect(check.apps!.callsRecently).toBe(0);
  });

  test("the connections are read with the caller's own props", async () => {
    serve({});
    const props: LlmSetupCheckQuery["props"] = {
      tenantId: PROJECT,
      userId: ObjectID.generate(),
    };

    await LlmSetupCheckReader.read(query({ props }));

    const findBy: ReturnType<typeof jest.spyOn> = jest.mocked(
      LlmObservabilityConnectionService.findBy,
    ) as unknown as ReturnType<typeof jest.spyOn>;

    expect(
      ((findBy.mock.calls[0] as Array<unknown>)[0] as { props: unknown }).props,
    ).toBe(props);
  });

  test("every read the check sends is capped in time", async () => {
    const spies: {
      span: ReturnType<typeof jest.spyOn>;
      metric: ReturnType<typeof jest.spyOn>;
    } = serve({});

    await LlmSetupCheckReader.read(query());

    for (const call of [
      ...(spies.span.mock.calls as Array<Array<unknown>>),
      ...(spies.metric.mock.calls as Array<Array<unknown>>),
    ]) {
      expect(statementOf(call)).toContain("max_execution_time = ");
      expect(statementOf(call)).toContain("timeout_overflow_mode = 'throw'");
    }
  });
});

import { describe, expect, test } from "@jest/globals";
import {
  LLM_METRIC_SOURCE_PREFIXES,
  LLM_METRIC_SOURCE_TITLES,
  LLM_SETUP_CHECK_MAX_LIST,
  LLM_SETUP_CHECK_ROUTE,
  LlmEmptyViewFinding,
  LlmEmptyViewFindingKey,
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
  LlmSetupCheckResponse,
  diagnoseEmptyLlmView,
  getLlmMetricSource,
  readLlmSetupCheckResponse,
} from "../../../Types/Telemetry/LlmSetupCheckApi";

/*
 * THE AI / LLM SETUP CHECK'S CONTRACT (#5776).
 *
 * A project with connected, working provider accounts had empty
 * Conversations and Calls views and nothing that said why: provider
 * accounts bring usage and cost, never a conversation, and only an app's AI
 * calls fill those views. The setup check says what each way of sending AI
 * is doing; diagnoseEmptyLlmView picks the one thing an empty view leads
 * with. These pin the metric sources, the reader of the server's answer
 * (which must never throw on what it is handed), and the order of the
 * findings.
 */

function apps(overrides: Partial<LlmSetupCheckApps> = {}): LlmSetupCheckApps {
  return {
    callsInWindow: 0,
    callsRecently: 0,
    newestCallAt: null,
    services: [],
    providers: [],
    answersRecently: 0,
    answersWithContent: 0,
    contentInLogs: null,
    uninstrumented: null,
    ...overrides,
  };
}

function connection(
  overrides: Partial<LlmSetupCheckConnection> = {},
): LlmSetupCheckConnection {
  return {
    connectionId: "c1",
    name: "Production",
    provider: "OpenAI",
    kind: "provider-account",
    isEnabled: true,
    lastReadAt: "2026-11-04T09:00:00.000Z",
    lastSuccessfulReadAt: "2026-11-04T09:00:00.000Z",
    lastError: "",
    newestUsageAt: null,
    resources: null,
    readSince: null,
    callsRecently: null,
    ...overrides,
  };
}

function check(
  overrides: Partial<LlmSetupCheckResponse> = {},
): LlmSetupCheckResponse {
  return {
    checkedAt: "2026-11-04T09:00:00.000Z",
    apps: apps(),
    metrics: [],
    connections: [],
    ...overrides,
  };
}

describe("the route", () => {
  test("is the telemetry router's", () => {
    expect(LLM_SETUP_CHECK_ROUTE).toBe("/telemetry/llm/setup-check");
  });
});

describe("who sends GenAI metrics, by name", () => {
  test.each([
    ["claude_code.token.usage", LlmMetricSource.ClaudeCode],
    ["claude_code.cost.usage", LlmMetricSource.ClaudeCode],
    ["codex.turn.token_usage", LlmMetricSource.Codex],
    ["gemini_cli.token.usage", LlmMetricSource.GeminiCli],
    ["cursor.usage.cost", LlmMetricSource.Cursor],
    ["copilot_chat.tool.call.count", LlmMetricSource.Copilot],
    ["gen_ai.client.token.usage", LlmMetricSource.GenAi],
    ["gen_ai.client.operation.duration", LlmMetricSource.GenAi],
  ])("%s is %s", (name: string, source: LlmMetricSource) => {
    expect(getLlmMetricSource(name)).toBe(source);
  });

  test("names are read whatever their case and spacing", () => {
    expect(getLlmMetricSource("  Claude_Code.Token.Usage ")).toBe(
      LlmMetricSource.ClaudeCode,
    );
  });

  test.each([[""], ["claude_code"], ["claude-code.token.usage"]])(
    "%j is no tool's: the conventions' metrics",
    (name: string) => {
      expect(getLlmMetricSource(name)).toBe(LlmMetricSource.GenAi);
    },
  );

  test("nothing that is not a name throws", () => {
    expect(getLlmMetricSource(undefined as unknown as string)).toBe(
      LlmMetricSource.GenAi,
    );
  });

  test("every source has a title, and every tool a prefix", () => {
    for (const source of Object.values(LlmMetricSource)) {
      expect(LLM_METRIC_SOURCE_TITLES[source]).toBeTruthy();
    }

    const prefixed: Set<LlmMetricSource> = new Set(
      LLM_METRIC_SOURCE_PREFIXES.map((entry: { source: LlmMetricSource }) => {
        return entry.source;
      }),
    );

    for (const source of Object.values(LlmMetricSource)) {
      expect(prefixed.has(source)).toBe(source !== LlmMetricSource.GenAi);
    }
  });

  test("every prefix ends with its dot, so one tool's name never starts another's", () => {
    for (const entry of LLM_METRIC_SOURCE_PREFIXES) {
      expect(entry.prefix.endsWith(".")).toBe(true);
    }
  });
});

describe("readLlmSetupCheckResponse", () => {
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "check"],
    ["a list", [1, 2]],
    ["a number", 7],
  ])(
    "%s reads as a check with no part read",
    (_name: string, value: unknown) => {
      expect(readLlmSetupCheckResponse(value)).toEqual({
        checkedAt: new Date(0).toISOString(),
        apps: null,
        metrics: null,
        connections: null,
      });
    },
  );

  test("a full answer reads back as it was sent", () => {
    const sent: LlmSetupCheckResponse = {
      checkedAt: "2026-11-04T09:00:00.000Z",
      apps: apps({
        callsInWindow: 3,
        callsRecently: 40,
        newestCallAt: "2026-11-04T08:59:00.000Z",
        services: [
          {
            serviceId: "svc-1",
            calls: 40,
            newestAt: "2026-11-04T08:59:00.000Z",
          },
        ],
        providers: [{ name: "azure.ai.openai", calls: 40 }],
        answersRecently: 38,
        answersWithContent: 0,
        contentInLogs: true,
        uninstrumented: [
          {
            serviceId: "svc-2",
            host: "contoso.openai.azure.com",
            provider: "azure.ai.openai",
            calls: 12,
          },
        ],
      }),
      metrics: [
        {
          source: LlmMetricSource.ClaudeCode,
          points: 120,
          newestAt: "2026-11-04T08:00:00.000Z",
        },
      ],
      connections: [
        connection({
          kind: "company-tool",
          provider: "ClaudeEnterprise",
          callsRecently: 5,
          resources: 0,
          newestUsageAt: "2026-11-01T00:00:00.000Z",
          readSince: "2026-10-01T00:00:00.000Z",
          lastError: "HTTP 403",
          isEnabled: false,
        }),
      ],
    };

    expect(readLlmSetupCheckResponse(JSON.parse(JSON.stringify(sent)))).toEqual(
      sent,
    );
  });

  test("a part the server could not read for the caller stays unread, not empty", () => {
    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      checkedAt: "2026-11-04T09:00:00.000Z",
      apps: null,
      metrics: null,
      connections: [],
    });

    expect(read.apps).toBeNull();
    expect(read.metrics).toBeNull();
    // An empty list is an answer: no connections.
    expect(read.connections).toEqual([]);
  });

  test("counts are whole, never negative, and 0 when they are not numbers", () => {
    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      apps: {
        callsInWindow: "12",
        callsRecently: -4,
        answersRecently: 2.6,
        answersWithContent: "many",
      },
    });

    expect(read.apps).toMatchObject({
      callsInWindow: 12,
      callsRecently: 0,
      answersRecently: 3,
      answersWithContent: 0,
    });
  });

  test("a window's count that was not asked stays not asked", () => {
    expect(readLlmSetupCheckResponse({ apps: {} }).apps?.callsInWindow).toBe(
      null,
    );
    expect(
      readLlmSetupCheckResponse({ apps: { callsInWindow: null } }).apps
        ?.callsInWindow,
    ).toBe(null);
    expect(
      readLlmSetupCheckResponse({ apps: { callsInWindow: 0 } }).apps
        ?.callsInWindow,
    ).toBe(0);
  });

  test("times that are not times read as none", () => {
    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      checkedAt: "soon",
      apps: { newestCallAt: "yesterday" },
      connections: [{ lastReadAt: 5, newestUsageAt: "" }],
    });

    expect(read.checkedAt).toBe(new Date(0).toISOString());
    expect(read.apps?.newestCallAt).toBeNull();
    expect(read.connections?.[0]?.lastReadAt).toBeNull();
    expect(read.connections?.[0]?.newestUsageAt).toBeNull();
  });

  test("lists are cut to their limit, and entries that are not objects dropped", () => {
    const many: Array<unknown> = [
      "not an entry",
      null,
      ...Array.from({ length: 25 }, (_value: unknown, index: number) => {
        return { serviceId: `svc-${index}`, calls: 25 - index };
      }),
    ];

    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      apps: { services: many, providers: many, uninstrumented: many },
      metrics: many,
    });

    expect(read.apps?.services).toHaveLength(LLM_SETUP_CHECK_MAX_LIST);
    expect(read.apps?.services[0]?.serviceId).toBe("svc-0");
    expect(read.apps?.providers).toHaveLength(LLM_SETUP_CHECK_MAX_LIST);
    expect(read.apps?.uninstrumented).toHaveLength(LLM_SETUP_CHECK_MAX_LIST);
    expect(read.metrics).toHaveLength(LLM_SETUP_CHECK_MAX_LIST);
  });

  test("a project's connections are not cut to the list limit", () => {
    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      connections: Array.from(
        { length: 30 },
        (_value: unknown, index: number) => {
          return { connectionId: `c-${index}` };
        },
      ),
    });

    expect(read.connections).toHaveLength(30);
  });

  test("uninstrumented calls not checked stay not checked", () => {
    expect(
      readLlmSetupCheckResponse({ apps: {} }).apps?.uninstrumented,
    ).toBeNull();
    expect(
      readLlmSetupCheckResponse({ apps: { uninstrumented: [] } }).apps
        ?.uninstrumented,
    ).toEqual([]);
  });

  test("content in logs is a yes, a no, or not checked", () => {
    expect(
      readLlmSetupCheckResponse({ apps: { contentInLogs: true } }).apps
        ?.contentInLogs,
    ).toBe(true);
    expect(
      readLlmSetupCheckResponse({ apps: { contentInLogs: false } }).apps
        ?.contentInLogs,
    ).toBe(false);
    expect(
      readLlmSetupCheckResponse({ apps: { contentInLogs: "true" } }).apps
        ?.contentInLogs,
    ).toBeNull();
  });

  test("a connection's kind is a company tool only when it says so; it is on unless it says off", () => {
    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      connections: [
        { kind: "company-tool" },
        { kind: "something else", isEnabled: "no" },
        { isEnabled: false },
      ],
    });

    expect(
      read.connections?.map((item: LlmSetupCheckConnection) => {
        return [item.kind, item.isEnabled];
      }),
    ).toEqual([
      ["company-tool", true],
      ["provider-account", true],
      ["provider-account", false],
    ]);
  });

  test("a metric source it does not know is the conventions' metrics", () => {
    expect(
      readLlmSetupCheckResponse({
        metrics: [{ source: "windsurf", points: 3 }],
      }).metrics?.[0]?.source,
    ).toBe(LlmMetricSource.GenAi);
  });

  test("a connection's resources and chats are counted only when the server counted them", () => {
    const read: LlmSetupCheckResponse = readLlmSetupCheckResponse({
      connections: [{}, { resources: 0, callsRecently: 0 }],
    });

    expect(read.connections?.[0]?.resources).toBeNull();
    expect(read.connections?.[0]?.callsRecently).toBeNull();
    expect(read.connections?.[1]?.resources).toBe(0);
    expect(read.connections?.[1]?.callsRecently).toBe(0);
  });
});

describe("what an empty Conversations or Calls view leads with", () => {
  test("no check: how AI comes in", () => {
    expect(diagnoseEmptyLlmView(null).key).toBe(LlmEmptyViewFindingKey.Nothing);
    expect(diagnoseEmptyLlmView(undefined).key).toBe(
      LlmEmptyViewFindingKey.Nothing,
    );
  });

  test("nothing arrived at all: how AI comes in", () => {
    expect(diagnoseEmptyLlmView(check()).key).toBe(
      LlmEmptyViewFindingKey.Nothing,
    );
  });

  test("calls outside the range come first, whatever else is set up", () => {
    const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
      check({
        apps: apps({
          callsInWindow: 0,
          newestCallAt: "2026-10-01T10:00:00.000Z",
          uninstrumented: [
            {
              serviceId: "svc-2",
              host: "api.openai.com",
              provider: "openai",
              calls: 3,
            },
          ],
        }),
        connections: [
          connection({ kind: "company-tool" }),
          connection({ connectionId: "c2" }),
        ],
        metrics: [
          {
            source: LlmMetricSource.ClaudeCode,
            points: 4,
            newestAt: null,
          },
        ],
      }),
    );

    expect(finding).toEqual({
      key: LlmEmptyViewFindingKey.CallsOutsideWindow,
      newestCallAt: "2026-10-01T10:00:00.000Z",
    });
  });

  test("a view without a range of its own is never told its range is why", () => {
    const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
      check({
        apps: apps({ newestCallAt: "2026-10-01T10:00:00.000Z" }),
        connections: [connection()],
      }),
      { hasWindow: false },
    );

    expect(finding.key).toBe(LlmEmptyViewFindingKey.ProviderAccountsOnly);
  });

  test("calls in the range are not calls outside it", () => {
    expect(
      diagnoseEmptyLlmView(
        check({
          apps: apps({
            callsInWindow: 2,
            newestCallAt: "2026-11-04T08:00:00.000Z",
          }),
        }),
      ).key,
    ).toBe(LlmEmptyViewFindingKey.Nothing);
  });

  test("an app calling an AI API that nothing records comes before connections", () => {
    const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
      check({
        apps: apps({
          uninstrumented: [
            {
              serviceId: "svc-2",
              host: "contoso.openai.azure.com",
              provider: "azure.ai.openai",
              calls: 12,
            },
            {
              serviceId: "svc-3",
              host: "api.openai.com",
              provider: "openai",
              calls: 2,
            },
          ],
        }),
        connections: [connection(), connection({ kind: "company-tool" })],
      }),
    );

    expect(finding.key).toBe(LlmEmptyViewFindingKey.Uninstrumented);
    // The app with the most such calls: the server sends them most first.
    expect(finding.uninstrumented?.serviceId).toBe("svc-2");
  });

  test("an empty uninstrumented list is not a finding", () => {
    expect(
      diagnoseEmptyLlmView(check({ apps: apps({ uninstrumented: [] }) })).key,
    ).toBe(LlmEmptyViewFindingKey.Nothing);
  });

  test("a company AI tool comes before provider accounts: its chats are conversations", () => {
    const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
      check({
        connections: [
          connection({ connectionId: "account" }),
          connection({ connectionId: "tool", kind: "company-tool" }),
        ],
      }),
    );

    expect(finding.key).toBe(LlmEmptyViewFindingKey.CompanyToolsQuiet);
    expect(
      finding.connections?.map((item: LlmSetupCheckConnection) => {
        return item.connectionId;
      }),
    ).toEqual(["tool"]);
  });

  test("connected provider accounts and no app calls: accounts bring usage, not conversations", () => {
    const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
      check({
        connections: [
          connection({ connectionId: "openai" }),
          connection({ connectionId: "azure", provider: "AzureOpenAI" }),
        ],
        metrics: [
          {
            source: LlmMetricSource.Codex,
            points: 9,
            newestAt: null,
          },
        ],
      }),
    );

    expect(finding.key).toBe(LlmEmptyViewFindingKey.ProviderAccountsOnly);
    expect(finding.connections).toHaveLength(2);
  });

  test("connections that are turned off are not counted", () => {
    expect(
      diagnoseEmptyLlmView(
        check({
          connections: [
            connection({ isEnabled: false }),
            connection({ kind: "company-tool", isEnabled: false }),
          ],
        }),
      ).key,
    ).toBe(LlmEmptyViewFindingKey.Nothing);
  });

  test("coding assistants only: the tools that send, once each", () => {
    const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
      check({
        metrics: [
          { source: LlmMetricSource.ClaudeCode, points: 5, newestAt: null },
          { source: LlmMetricSource.Cursor, points: 2, newestAt: null },
          { source: LlmMetricSource.ClaudeCode, points: 1, newestAt: null },
        ],
      }),
    );

    expect(finding).toEqual({
      key: LlmEmptyViewFindingKey.CodingToolsOnly,
      metricSources: [LlmMetricSource.ClaudeCode, LlmMetricSource.Cursor],
    });
  });

  test("the conventions' own metrics, and tools with no points, are no coding assistant", () => {
    expect(
      diagnoseEmptyLlmView(
        check({
          metrics: [
            { source: LlmMetricSource.GenAi, points: 50, newestAt: null },
            { source: LlmMetricSource.Codex, points: 0, newestAt: null },
          ],
        }),
      ).key,
    ).toBe(LlmEmptyViewFindingKey.Nothing);
  });

  test("parts the caller could not read are skipped, never thrown on", () => {
    expect(
      diagnoseEmptyLlmView(
        check({ apps: null, metrics: null, connections: null }),
      ).key,
    ).toBe(LlmEmptyViewFindingKey.Nothing);

    // A company AI tool's chats are its own: said whatever the apps did.
    expect(
      diagnoseEmptyLlmView(
        check({
          apps: null,
          connections: [connection({ kind: "company-tool" })],
        }),
      ).key,
    ).toBe(LlmEmptyViewFindingKey.CompanyToolsQuiet);
  });

  /*
   * "Provider accounts only" and "coding assistants only" say no app sent
   * an AI call in the past 7 days. Said only when the apps were read and
   * that is so.
   */
  test.each([
    ["apps that could not be read", null],
    [
      "apps that sent calls this week",
      {
        callsInWindow: null,
        callsRecently: 4,
        newestCallAt: null,
        services: [],
        providers: [],
        answersRecently: 0,
        answersWithContent: 0,
        contentInLogs: null,
        uninstrumented: null,
      },
    ],
    [
      "apps with calls in the view's window",
      {
        callsInWindow: 2,
        callsRecently: 0,
        newestCallAt: "2026-11-04T08:00:00.000Z",
        services: [],
        providers: [],
        answersRecently: 0,
        answersWithContent: 0,
        contentInLogs: null,
        uninstrumented: null,
      },
    ],
  ])(
    "with %s, never that no app sent a call",
    (_name: string, value: LlmSetupCheckApps | null) => {
      for (const options of [{ hasWindow: true }, { hasWindow: false }]) {
        expect(
          diagnoseEmptyLlmView(
            check({
              apps: value,
              connections: [connection()],
              metrics: [
                {
                  source: LlmMetricSource.ClaudeCode,
                  points: 4,
                  newestAt: null,
                },
              ],
            }),
            options,
          ).key,
        ).toBe(LlmEmptyViewFindingKey.Nothing);
      }
    },
  );

  test("every finding is reachable", () => {
    const reached: Set<LlmEmptyViewFindingKey> = new Set([
      diagnoseEmptyLlmView(
        check({ apps: apps({ newestCallAt: "2026-10-01T00:00:00.000Z" }) }),
      ).key,
      diagnoseEmptyLlmView(
        check({
          apps: apps({
            uninstrumented: [
              {
                serviceId: "s",
                host: "api.openai.com",
                provider: "openai",
                calls: 1,
              },
            ],
          }),
        }),
      ).key,
      diagnoseEmptyLlmView(
        check({ connections: [connection({ kind: "company-tool" })] }),
      ).key,
      diagnoseEmptyLlmView(check({ connections: [connection()] })).key,
      diagnoseEmptyLlmView(
        check({
          metrics: [
            { source: LlmMetricSource.Copilot, points: 1, newestAt: null },
          ],
        }),
      ).key,
      diagnoseEmptyLlmView(check()).key,
    ]);

    expect(Array.from(reached).sort()).toEqual(
      Object.values(LlmEmptyViewFindingKey).sort(),
    );
  });
});

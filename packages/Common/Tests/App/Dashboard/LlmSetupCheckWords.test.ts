import { describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmEmptyViewFinding,
  LlmEmptyViewFindingKey,
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
} from "../../../Types/Telemetry/LlmSetupCheckApi";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { formatLlmUsageDay } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionHealth";
import {
  LlmEmptyView,
  LlmEmptyViewWords,
  LlmSetupCheckLine,
  PROVIDER_READS,
  getAppNames,
  getAppsLines,
  getConnectionLine,
  getLlmEmptyViewWords,
  getLlmMetricSourceTitle,
  getRangeHolding,
  getWidenTitle,
  isConnectionFailing,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/SetupCheck/LlmSetupCheckWords";

/*
 * WHAT THE AI / LLM SETUP CHECK SAYS (#5776), without a browser: the one
 * finding an empty Conversations or Calls view leads with, the range a
 * "show more" button widens to, and each line of the Connect page's Setup
 * check card - apps, provider accounts, company AI tools - with how it
 * stands. Names are neutral examples.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const ENGLISH: Translator = createTranslator(undefined, "en");
const DAY: number = 24 * 60 * 60 * 1000;

const NAMES: Record<string, string> = {
  "svc-checkout": "checkout",
  "svc-search": "search",
  "svc-support": "support-bot",
  "svc-billing": "billing",
};

function serviceName(serviceId: string): string {
  return NAMES[serviceId] || "";
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function words(
  finding: LlmEmptyViewFinding,
  view: LlmEmptyView = "conversations",
): LlmEmptyViewWords {
  return getLlmEmptyViewWords({
    finding,
    view,
    translator: ENGLISH,
    serviceName,
    now: NOW,
  });
}

function apps(overrides: Partial<LlmSetupCheckApps> = {}): LlmSetupCheckApps {
  return {
    callsInWindow: null,
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
    provider: LlmConnectionProvider.OpenAI,
    kind: "provider-account",
    isEnabled: true,
    lastReadAt: daysAgo(0.01).toISOString(),
    lastSuccessfulReadAt: daysAgo(0.01).toISOString(),
    lastError: "",
    newestUsageAt: null,
    resources: null,
    readSince: null,
    callsRecently: null,
    ...overrides,
  };
}

function appsLines(value: LlmSetupCheckApps): Array<LlmSetupCheckLine> {
  return getAppsLines({
    apps: value,
    translator: ENGLISH,
    serviceName,
    now: NOW,
  });
}

function line(value: LlmSetupCheckConnection): LlmSetupCheckLine {
  return getConnectionLine({
    connection: value,
    translator: ENGLISH,
    now: NOW,
  });
}

describe("the range that holds the newest call", () => {
  test.each([
    [0.5, TimeRange.PAST_ONE_WEEK],
    [6.9, TimeRange.PAST_ONE_WEEK],
    [7, TimeRange.PAST_ONE_MONTH],
    [29.9, TimeRange.PAST_ONE_MONTH],
    [30, TimeRange.PAST_THREE_MONTHS],
    [89.9, TimeRange.PAST_THREE_MONTHS],
  ])("a call %d days old is in %s", (days: number, range: TimeRange) => {
    expect(getRangeHolding(daysAgo(days), NOW)).toEqual({ range });
  });

  test("an older call widens to a range from the day before it", () => {
    const newest: Date = daysAgo(120);

    expect(getRangeHolding(newest, NOW)).toEqual({
      range: TimeRange.CUSTOM,
      startTime: new Date(newest.getTime() - DAY),
    });
  });

  test("the button says the range", () => {
    expect(getWidenTitle({ range: TimeRange.PAST_ONE_WEEK }, ENGLISH)).toBe(
      "Show the past week",
    );
    expect(getWidenTitle({ range: TimeRange.PAST_ONE_MONTH }, ENGLISH)).toBe(
      "Show the past month",
    );
    expect(
      getWidenTitle({ range: TimeRange.PAST_THREE_MONTHS }, ENGLISH),
    ).toBe("Show the past 3 months");

    const startTime: Date = new Date("2026-06-01T10:00:00.000Z");

    expect(
      getWidenTitle({ range: TimeRange.CUSTOM, startTime }, ENGLISH),
    ).toBe(
      `Show from ${OneUptimeDate.getDateAsCompactLocalString(startTime, {
        onlyShowDate: true,
      })}`,
    );
  });
});

describe("what an empty view says", () => {
  test.each([
    ["conversations", "No conversations in this time range"],
    ["calls", "No AI calls in this time range"],
  ])(
    "calls just outside the range: the %s view says when the newest was, and widens to it",
    (view: string, title: string) => {
      const newest: Date = daysAgo(10);
      const result: LlmEmptyViewWords = words(
        {
          key: LlmEmptyViewFindingKey.CallsOutsideWindow,
          newestCallAt: newest.toISOString(),
        },
        view as LlmEmptyView,
      );

      expect(result.title).toBe(title);
      expect(result.description).toBe(
        `Your apps' newest AI call was ${OneUptimeDate.fromNow(newest, NOW)}.`,
      );
      expect(result.primary).toBe("widen-range");
      expect(result.widenTo).toEqual({ range: TimeRange.PAST_ONE_MONTH });
      expect(result.secondary).toBeUndefined();
    },
  );

  test("an app calling OpenAI that nothing records: which app, which host, how often", () => {
    const result: LlmEmptyViewWords = words({
      key: LlmEmptyViewFindingKey.Uninstrumented,
      uninstrumented: {
        serviceId: "svc-checkout",
        host: "contoso.openai.azure.com",
        provider: "azure.ai.openai",
        calls: 42,
      },
    });

    expect(result.title).toBe("Your app's AI calls aren't recorded");
    expect(result.description).toBe(
      "checkout called contoso.openai.azure.com 42 times in the past day, and no GenAI instrumentation recorded those calls. Add one, and every AI call arrives with its model, tokens and cost.",
    );
    expect(result.primary).toBe("send-calls");
  });

  test("once is once; an app it cannot name is one of your apps", () => {
    expect(
      words({
        key: LlmEmptyViewFindingKey.Uninstrumented,
        uninstrumented: {
          serviceId: "svc-unknown",
          host: "api.openai.com",
          provider: "openai",
          calls: 1,
        },
      }).description,
    ).toBe(
      "One of your apps called api.openai.com once in the past day, and no GenAI instrumentation recorded the call. Add one, and every AI call arrives with its model, tokens and cost.",
    );
  });

  test("a company AI tool whose last read failed: it is not working, and Connect says why", () => {
    const result: LlmEmptyViewWords = words({
      key: LlmEmptyViewFindingKey.CompanyToolsQuiet,
      connections: [
        connection({
          kind: "company-tool",
          provider: LlmConnectionProvider.ClaudeEnterprise,
          lastError: "HTTP 401",
          lastReadAt: daysAgo(0.01).toISOString(),
          lastSuccessfulReadAt: daysAgo(2).toISOString(),
        }),
      ],
    });

    expect(result.title).toBe("Claude Enterprise isn't working");
    expect(result.description).toBe(
      "Its last read failed, so no chats were read. Connect says why.",
    );
    expect(result.primary).toBe("open-connect");
  });

  test("a quiet company AI tool: read every 15 minutes, chats arrive as people use it", () => {
    const result: LlmEmptyViewWords = words({
      key: LlmEmptyViewFindingKey.CompanyToolsQuiet,
      connections: [
        connection({
          kind: "company-tool",
          provider: LlmConnectionProvider.ClaudeEnterprise,
        }),
      ],
    });

    expect(result.title).toBe("No chats in this time range");
    expect(result.description).toBe(
      "Claude Enterprise is connected and read every 15 minutes: its chats show here as people use it.",
    );
    expect(result.primary).toBe("widen-range");
    expect(result.widenTo).toEqual({ range: TimeRange.PAST_ONE_MONTH });
    expect(result.secondary).toBe("send-calls");
  });

  test("two quiet tools read in the plural; two connections of one tool are one name", () => {
    expect(
      words({
        key: LlmEmptyViewFindingKey.CompanyToolsQuiet,
        connections: [
          connection({
            connectionId: "a",
            kind: "company-tool",
            provider: LlmConnectionProvider.ClaudeEnterprise,
          }),
          connection({
            connectionId: "b",
            kind: "company-tool",
            provider: LlmConnectionProvider.Microsoft365Copilot,
          }),
          connection({
            connectionId: "c",
            kind: "company-tool",
            provider: LlmConnectionProvider.ClaudeEnterprise,
          }),
        ],
      }).description,
    ).toBe(
      "Claude Enterprise and Microsoft 365 Copilot are connected and read every 15 minutes: their chats show here as people use them.",
    );
  });

  test.each([
    ["conversations", "Conversations come from your apps"],
    ["calls", "AI calls come from your apps"],
  ])(
    "provider accounts only: the %s view says accounts bring usage, never a call",
    (view: string, title: string) => {
      const result: LlmEmptyViewWords = words(
        {
          key: LlmEmptyViewFindingKey.ProviderAccountsOnly,
          connections: [
            connection({ connectionId: "openai" }),
            connection({
              connectionId: "azure",
              provider: LlmConnectionProvider.AzureOpenAI,
            }),
          ],
        },
        view as LlmEmptyView,
      );

      expect(result.title).toBe(title);
      expect(result.description).toBe(
        "Your 2 connected provider accounts report usage and cost by day, never a call or a conversation. Those come from your apps, and none has sent an AI call in the past 7 days.",
      );
      expect(result.primary).toBe("send-calls");
      expect(result.secondary).toBe("see-provider-usage");
    },
  );

  test("one provider account reads in the singular", () => {
    expect(
      words({
        key: LlmEmptyViewFindingKey.ProviderAccountsOnly,
        connections: [connection()],
      }).description,
    ).toBe(
      "Your connected provider account reports usage and cost by day, never a call or a conversation. Those come from your apps, and none has sent an AI call in the past 7 days.",
    );
  });

  test("coding assistants only: they send usage, which is on Usage", () => {
    const result: LlmEmptyViewWords = words({
      key: LlmEmptyViewFindingKey.CodingToolsOnly,
      metricSources: [LlmMetricSource.ClaudeCode, LlmMetricSource.Cursor],
    });

    expect(result.title).toBe("Conversations come from your apps");
    expect(result.description).toBe(
      "Claude Code and Cursor send usage metrics, which show on Usage. Calls and conversations come from your apps, and none has sent an AI call in the past 7 days.",
    );
    expect(result.primary).toBe("see-usage");
    expect(result.secondary).toBe("send-calls");
  });

  test("one coding assistant reads in the singular", () => {
    expect(
      words({
        key: LlmEmptyViewFindingKey.CodingToolsOnly,
        metricSources: [LlmMetricSource.Codex],
      }).description,
    ).toContain("Codex sends usage metrics");
  });

  test.each([
    [
      "conversations",
      "No AI conversations here yet",
      "Conversations appear as AI calls arrive: from your own apps, or from your company's AI tools, such as Claude Enterprise and Microsoft 365 Copilot.",
    ],
    [
      "calls",
      "No AI calls here yet",
      "Every AI call your apps send shows here: its model, tokens, cost, time and errors, with the app and the person that made it.",
    ],
  ])(
    "nothing arrived: the %s view says what it shows and how to send it",
    (view: string, title: string, description: string) => {
      const result: LlmEmptyViewWords = words(
        { key: LlmEmptyViewFindingKey.Nothing },
        view as LlmEmptyView,
      );

      expect(result.title).toBe(title);
      expect(result.description).toBe(description);
      expect(result.primary).toBe("send-calls");
    },
  );

  test("every coding assistant has its product's name", () => {
    expect(getLlmMetricSourceTitle(LlmMetricSource.ClaudeCode)).toBe(
      "Claude Code",
    );
    expect(getLlmMetricSourceTitle(LlmMetricSource.Copilot)).toBe(
      "GitHub Copilot",
    );
    expect(getLlmMetricSourceTitle(LlmMetricSource.GeminiCli)).toBe(
      "Gemini CLI",
    );
  });
});

describe("a connection that is not working", () => {
  test.each([
    ["an error and no good read ever", { lastSuccessfulReadAt: null }, true],
    [
      "an error after the last good read",
      {
        lastReadAt: daysAgo(0.01).toISOString(),
        lastSuccessfulReadAt: daysAgo(1).toISOString(),
      },
      true,
    ],
    [
      "an error from before the last good read",
      {
        lastReadAt: daysAgo(1).toISOString(),
        lastSuccessfulReadAt: daysAgo(0.01).toISOString(),
      },
      false,
    ],
  ])(
    "%s",
    (
      _name: string,
      overrides: Partial<LlmSetupCheckConnection>,
      failing: boolean,
    ) => {
      expect(
        isConnectionFailing(connection({ lastError: "HTTP 403", ...overrides })),
      ).toBe(failing);
    },
  );

  test("no error is never failing; a connection turned off is never failing", () => {
    expect(isConnectionFailing(connection({ lastSuccessfulReadAt: null }))).toBe(
      false,
    );
    expect(
      isConnectionFailing(
        connection({
          isEnabled: false,
          lastError: "HTTP 403",
          lastSuccessfulReadAt: null,
        }),
      ),
    ).toBe(false);
  });
});

describe("the apps a sentence names", () => {
  test.each([
    [["svc-checkout"], ["checkout"]],
    [
      ["svc-checkout", "svc-search"],
      ["checkout", "search"],
    ],
    [
      ["svc-checkout", "svc-search", "svc-support"],
      ["checkout", "search", "support-bot"],
    ],
    [
      ["svc-checkout", "svc-search", "svc-support", "svc-billing"],
      ["checkout", "search", "other apps"],
    ],
    [
      ["svc-checkout", "svc-unknown"],
      ["checkout", "other apps"],
    ],
    [["svc-unknown", "svc-other"], ["your apps"]],
    [[], ["your apps"]],
  ])("%j: %j", (serviceIds: Array<string>, expected: Array<string>) => {
    expect(
      getAppNames({ serviceIds, serviceName, translator: ENGLISH }),
    ).toEqual(expected);
  });

  test("one app under two ids is one name", () => {
    expect(
      getAppNames({
        serviceIds: ["a", "b"],
        serviceName: (): string => {
          return "checkout";
        },
        translator: ENGLISH,
      }),
    ).toEqual(["checkout"]);
  });
});

describe("the Setup check card: your apps", () => {
  test("apps sending AI calls: how many, from which apps, through which providers, the newest", () => {
    const newest: Date = daysAgo(0.1);
    const lines: Array<LlmSetupCheckLine> = appsLines(
      apps({
        callsRecently: 1240,
        newestCallAt: newest.toISOString(),
        services: [
          { serviceId: "svc-checkout", calls: 1000, newestAt: null },
          { serviceId: "svc-search", calls: 240, newestAt: null },
        ],
        providers: [
          { name: "azure.ai.openai", calls: 1000 },
          { name: "openai", calls: 200 },
          { name: "", calls: 40 },
        ],
      }),
    );

    expect(lines).toEqual([
      {
        key: "apps-receiving",
        tone: "ok",
        text: `${(1240).toLocaleString("en")} AI calls in the past 7 days, from checkout and search.`,
        detail: `Through Azure OpenAI and OpenAI. The newest arrived ${OneUptimeDate.fromNow(newest, NOW)}.`,
      },
    ]);
  });

  test("one call reads in the singular; no provider named, no providers line", () => {
    const lines: Array<LlmSetupCheckLine> = appsLines(
      apps({
        callsRecently: 1,
        newestCallAt: daysAgo(1).toISOString(),
        services: [{ serviceId: "svc-checkout", calls: 1, newestAt: null }],
        providers: [{ name: "", calls: 1 }],
      }),
    );

    expect(lines[0]!.text).toBe(
      "1 AI call in the past 7 days, from checkout.",
    );
    expect(lines[0]!.detail).toBeUndefined();
  });

  test("answers without prompts and answers: a warning, and how to record them", () => {
    const lines: Array<LlmSetupCheckLine> = appsLines(
      apps({
        callsRecently: 50,
        services: [{ serviceId: "svc-checkout", calls: 50, newestAt: null }],
        answersRecently: 40,
        answersWithContent: 0,
        contentInLogs: false,
      }),
    );

    expect(lines[1]).toEqual({
      key: "apps-content",
      tone: "warning",
      text: "Prompts and answers aren't recorded, so conversations show each call's time, tokens and cost but not what was said.",
      detail:
        "Turn on your instrumentation's content capture. Prompts can hold personal data: scrub rules mask it before it is stored.",
    });
  });

  test("prompts and answers sent as log records: record them on the spans instead", () => {
    const lines: Array<LlmSetupCheckLine> = appsLines(
      apps({
        callsRecently: 50,
        services: [{ serviceId: "svc-checkout", calls: 50, newestAt: null }],
        answersRecently: 40,
        answersWithContent: 0,
        contentInLogs: true,
      }),
    );

    expect(lines[1]!.detail).toBe(
      "Your app sends them as log records, which conversations don't read: record them on the spans instead.",
    );
  });

  test("some answers recorded: the share", () => {
    const lines: Array<LlmSetupCheckLine> = appsLines(
      apps({
        callsRecently: 50,
        services: [{ serviceId: "svc-checkout", calls: 50, newestAt: null }],
        answersRecently: 3,
        answersWithContent: 2,
      }),
    );

    expect(lines[1]).toEqual({
      key: "apps-content",
      tone: "ok",
      text: "Prompts and answers recorded on 67% of answers.",
    });
  });

  test("calls but no answers: nothing about content", () => {
    expect(
      appsLines(
        apps({
          callsRecently: 5,
          services: [{ serviceId: "svc-checkout", calls: 5, newestAt: null }],
        }),
      ),
    ).toHaveLength(1);
  });

  test("no AI call, an app calling an AI API: which app, which host", () => {
    expect(
      appsLines(
        apps({
          uninstrumented: [
            {
              serviceId: "svc-search",
              host: "api.openai.com",
              provider: "openai",
              calls: 3,
            },
          ],
        }),
      ),
    ).toEqual([
      {
        key: "apps-uninstrumented",
        tone: "warning",
        text: "search called api.openai.com 3 times in the past day, and no GenAI instrumentation recorded those calls. Add one, and every AI call arrives with its model, tokens and cost.",
      },
    ]);
  });

  test("calls before the past week: when the newest arrived", () => {
    const newest: Date = daysAgo(12);

    expect(
      appsLines(apps({ newestCallAt: newest.toISOString() })),
    ).toEqual([
      {
        key: "apps-quiet",
        tone: "warning",
        text: `No AI calls in the past 7 days. The newest arrived ${OneUptimeDate.fromNow(newest, NOW)}.`,
      },
    ]);
  });

  test("no call ever: not set up, and where calls come from", () => {
    expect(appsLines(apps())).toEqual([
      {
        key: "apps-none",
        tone: "off",
        text: "No app has sent an AI call yet. Calls and conversations come from your apps.",
      },
    ]);
  });
});

describe("the Setup check card: a connection", () => {
  test("turned off", () => {
    expect(line(connection({ isEnabled: false }))).toEqual({
      key: "connection-c1",
      tone: "off",
      text: "Turned off",
    });
  });

  test("not working: the server's own words", () => {
    expect(
      line(
        connection({
          lastError: "HTTP 401: the key was refused",
          lastSuccessfulReadAt: null,
        }),
      ),
    ).toEqual({
      key: "connection-c1",
      tone: "error",
      text: "Its last read failed: HTTP 401: the key was refused",
    });
  });

  test("never read yet", () => {
    expect(line(connection({ lastSuccessfulReadAt: null }))).toEqual({
      key: "connection-c1",
      tone: "off",
      text: "Waiting for the first read",
    });
  });

  test("a company AI tool: its chats of the past week", () => {
    const readAt: Date = daysAgo(0.01);

    expect(
      line(
        connection({
          kind: "company-tool",
          provider: LlmConnectionProvider.ClaudeEnterprise,
          lastSuccessfulReadAt: readAt.toISOString(),
          callsRecently: 1,
        }),
      ),
    ).toEqual({
      key: "connection-c1",
      tone: "ok",
      text: `Read ${OneUptimeDate.fromNow(readAt, NOW)}. 1 chat in the past 7 days.`,
    });

    expect(
      line(
        connection({
          kind: "company-tool",
          provider: LlmConnectionProvider.ClaudeEnterprise,
          lastSuccessfulReadAt: readAt.toISOString(),
          callsRecently: 12,
        }),
      ).text,
    ).toContain("12 chats in the past 7 days");
  });

  test("a provider account with usage: when it was read, the last day used, what its reads cover", () => {
    const readAt: Date = daysAgo(0.01);
    const result: LlmSetupCheckLine = line(
      connection({
        lastSuccessfulReadAt: readAt.toISOString(),
        newestUsageAt: "2026-11-03T00:00:00.000Z",
      }),
    );

    expect(result).toEqual({
      key: "connection-c1",
      tone: "ok",
      text: `Read ${OneUptimeDate.fromNow(readAt, NOW)}. Last used ${formatLlmUsageDay("2026-11-03T00:00:00.000Z")}.`,
      detail: PROVIDER_READS[LlmConnectionProvider.OpenAI],
    });
    // OpenAI's reports leave Azure OpenAI out: said where it matters.
    expect(result.detail).toContain("Azure OpenAI");
  });

  test("an account read without usage since its first read: since when", () => {
    const result: LlmSetupCheckLine = line(
      connection({
        provider: LlmConnectionProvider.AzureOpenAI,
        resources: 2,
        readSince: "2026-10-01T00:00:00.000Z",
      }),
    );

    expect(result.tone).toBe("warning");
    expect(result.text).toContain(
      `No usage since ${formatLlmUsageDay("2026-10-01T00:00:00.000Z")}.`,
    );
    expect(result.detail).toBe(
      PROVIDER_READS[LlmConnectionProvider.AzureOpenAI],
    );
  });

  test("an account with no coverage known: no usage yet", () => {
    expect(line(connection()).text).toMatch(/\. No usage yet\.$/);
  });

  test("an Azure connection that found no resource: the role to give", () => {
    const result: LlmSetupCheckLine = line(
      connection({
        provider: LlmConnectionProvider.AzureOpenAI,
        resources: 0,
        readSince: "2026-10-01T00:00:00.000Z",
      }),
    );

    expect(result.tone).toBe("warning");
    expect(result.text).toContain(
      "No Azure OpenAI or Foundry resource found: give the app registration the Monitoring Reader role where they are.",
    );
  });

  /*
   * An earlier read found usage, then the role was taken away: the reads
   * now find no resource, and the line must not stay green on the old day.
   */
  test("no resource found now outweighs a day an earlier read found usage on", () => {
    const result: LlmSetupCheckLine = line(
      connection({
        provider: LlmConnectionProvider.AzureOpenAI,
        resources: 0,
        newestUsageAt: "2026-10-20T00:00:00.000Z",
      }),
    );

    expect(result.tone).toBe("warning");
    expect(result.text).toContain("Monitoring Reader");
  });

  test("a provider with nothing to add about its reads has no detail", () => {
    expect(
      line(
        connection({
          provider: "SomeProvider",
          newestUsageAt: "2026-11-03T00:00:00.000Z",
        }),
      ).detail,
    ).toBeUndefined();
  });

  test("every account's reads are described for the providers that bill", () => {
    for (const provider of [
      LlmConnectionProvider.OpenAI,
      LlmConnectionProvider.AzureOpenAI,
      LlmConnectionProvider.Anthropic,
      LlmConnectionProvider.AwsBedrock,
      LlmConnectionProvider.GoogleVertexAI,
    ]) {
      expect(PROVIDER_READS[provider]).toBeTruthy();
    }
  });
});

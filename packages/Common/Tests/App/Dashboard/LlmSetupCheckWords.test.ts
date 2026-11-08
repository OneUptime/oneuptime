import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OneUptimeDate from "../../../Types/Date";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmEmptyViewFinding,
  LlmEmptyViewFindingKey,
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
  LlmSetupCheckResponse,
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
  NOTHING_COMING_IN,
  PROVIDER_READS,
  getAppNames,
  getAppsLines,
  getConnectionLine,
  getLlmEmptyViewWords,
  getLlmMetricSourceTitle,
  getRangeHolding,
  getWidenTitle,
  isConnectionFailing,
  isLlmSetupCheckQuiet,
  withOneStop,
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
// A short date that ends with a full stop of its own, as German writes it.
const DATE_WITH_STOP: RegExp = /\.$/;

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
    expect(getWidenTitle({ range: TimeRange.PAST_THREE_MONTHS }, ENGLISH)).toBe(
      "Show the past 3 months",
    );

    const startTime: Date = new Date("2026-06-01T10:00:00.000Z");

    expect(getWidenTitle({ range: TimeRange.CUSTOM, startTime }, ENGLISH)).toBe(
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
        "Your 2 connected provider accounts report usage and cost by day, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
      );
      // The heading says where calls come from; the sentence does not repeat it.
      expect(result.description).not.toContain("come from your apps");
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
      "Your connected provider account reports usage and cost by day, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
    );
  });

  test("coding assistants only: they send usage, and See usage leads", () => {
    const result: LlmEmptyViewWords = words({
      key: LlmEmptyViewFindingKey.CodingToolsOnly,
      metricSources: [LlmMetricSource.ClaudeCode, LlmMetricSource.Cursor],
    });

    expect(result.title).toBe("Conversations come from your apps");
    expect(result.description).toBe(
      "Claude Code and Cursor send usage metrics, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
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
        isConnectionFailing(
          connection({ lastError: "HTTP 403", ...overrides }),
        ),
      ).toBe(failing);
    },
  );

  test("no error is never failing; a connection turned off is never failing", () => {
    expect(
      isConnectionFailing(connection({ lastSuccessfulReadAt: null })),
    ).toBe(false);
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

    expect(lines[0]!.text).toBe("1 AI call in the past 7 days, from checkout.");
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

    expect(appsLines(apps({ newestCallAt: newest.toISOString() }))).toEqual([
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

  /*
   * A failed read says what failed in the product's words - the ones the
   * connection's View error and its test use - and what to do, never the
   * provider's JSON in the middle of a sentence.
   */
  test("not working, a key refused: the product's words and what to do, no raw error", () => {
    expect(
      line(
        connection({
          lastError:
            'OpenAI usage report failed with HTTP 401: {"error":{"message":"Incorrect API key provided."}}',
          failureKind: "authentication",
          lastSuccessfulReadAt: null,
        }),
      ),
    ).toEqual({
      key: "connection-c1",
      tone: "error",
      text: "The key or secret was not accepted.",
      detail:
        "Check that you copied all of it, that it has not been revoked, and that it is the kind this connection asks for.",
    });
  });

  test("not working, a missing permission: the role to give", () => {
    const result: LlmSetupCheckLine = line(
      connection({
        lastError: "HTTP 403: Forbidden",
        failureKind: "permission",
        lastSuccessfulReadAt: null,
      }),
    );

    expect(result.tone).toBe("error");
    expect(result.text).toBe(
      "The credential works, but it may not read what this connection needs.",
    );
    expect(result.detail).toBe(
      "Give it the role or scope the setup guide names, then test again.",
    );
    expect(result.error).toBeUndefined();
  });

  test("not working for a reason the product has no words for: the server's own, set apart", () => {
    for (const failureKind of [undefined, "other", "something-new"]) {
      expect(
        line(
          connection({
            lastError: "HTTP 401: the key was refused",
            ...(failureKind ? { failureKind } : {}),
            lastSuccessfulReadAt: null,
          }),
        ),
      ).toEqual({
        key: "connection-c1",
        tone: "error",
        text: "Its last read failed",
        // Apart from the sentence, never inside it.
        error: "HTTP 401: the key was refused",
      });
    }
  });

  test("a failure kind on a connection that reads again is no failure", () => {
    const result: LlmSetupCheckLine = line(
      connection({
        lastError: "HTTP 401",
        failureKind: "authentication",
        newestUsageAt: "2026-11-03T00:00:00.000Z",
      }),
    );

    // The last read was the good one: it works.
    expect(result.tone).toBe("ok");
    expect(result.text).toContain("Last used");
  });

  test("never read yet: waiting, not off", () => {
    expect(line(connection({ lastSuccessfulReadAt: null }))).toEqual({
      key: "connection-c1",
      tone: "waiting",
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

  /*
   * A working account with usage is one line: what its reads cover would
   * only repeat itself under every account that works.
   */
  test("a provider account with usage: when it was read and the last day used, in one line", () => {
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
    });
  });

  // Where the reads explain an empty account, they are said.
  test("an OpenAI account with no usage: what OpenAI's reports leave out", () => {
    const result: LlmSetupCheckLine = line(
      connection({ readSince: "2026-10-01T00:00:00.000Z" }),
    );

    expect(result.tone).toBe("warning");
    expect(result.detail).toBe(PROVIDER_READS[LlmConnectionProvider.OpenAI]);
    expect(result.detail).toContain(
      "Azure OpenAI and ChatGPT use are not in it.",
    );
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

/*
 * German, Danish, Dutch and Swedish write a short date with a full stop of
 * its own ("9. Okt."): a sentence that ends on it ends with that one stop -
 * the review found "Keine Nutzung seit 9. Okt.." on the card.
 */
describe("a sentence that ends on a date with its own stop", () => {
  afterEach(() => {
    setDateDisplayLanguage(null);
  });

  test("ends with one stop", () => {
    expect(withOneStop("Keine Nutzung seit 9. Okt..", "9. Okt.")).toBe(
      "Keine Nutzung seit 9. Okt.",
    );
    expect(withOneStop("Senast använd 9 okt..", "9 okt.")).toBe(
      "Senast använd 9 okt.",
    );
    // A date without a stop, or none at all, leaves the sentence as it is.
    expect(withOneStop("Last used Oct 9.", "Oct 9")).toBe("Last used Oct 9.");
    expect(withOneStop("No usage yet.", "")).toBe("No usage yet.");
    // Only the stop after the date: one inside the sentence stays.
    expect(withOneStop("Gelesen vor 1 Minute. Seit 9. Okt..", "9. Okt.")).toBe(
      "Gelesen vor 1 Minute. Seit 9. Okt.",
    );
  });

  test("in German, an account's line never ends in two stops", () => {
    const table: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const german: Translator = createTranslator((key: string): string => {
      return table[key] || key;
    }, "de");

    setDateDisplayLanguage("de");

    // The date is German, with its own stop.
    expect(formatLlmUsageDay("2026-10-09T00:00:00.000Z")).toMatch(
      DATE_WITH_STOP,
    );

    for (const value of [
      connection({ newestUsageAt: "2026-10-09T00:00:00.000Z" }),
      connection({ readSince: "2026-10-09T00:00:00.000Z" }),
    ]) {
      const text: string = getConnectionLine({
        connection: value,
        translator: german,
        now: NOW,
      }).text;

      expect(text).toContain(formatLlmUsageDay("2026-10-09T00:00:00.000Z"));
      expect(text.endsWith("..")).toBe(false);
      expect(text.endsWith(".")).toBe(true);
    }
  });
});

/*
 * A project with nothing set up and nothing arriving: the card says so in
 * one line rather than three groups of "none" that repeat the three ways
 * right under it. Anything set up, arriving, or not known shows the groups.
 */
describe("when the whole check is quiet", () => {
  function response(
    overrides: Partial<LlmSetupCheckResponse> = {},
  ): LlmSetupCheckResponse {
    return {
      checkedAt: NOW.toISOString(),
      apps: apps({ callsInWindow: 0 }),
      metrics: [],
      connections: [],
      ...overrides,
    };
  }

  test("nothing set up, nothing arriving: quiet", () => {
    expect(isLlmSetupCheckQuiet(response())).toBe(true);
    // A metric source with no points in the week is not arriving.
    expect(
      isLlmSetupCheckQuiet(
        response({
          metrics: [
            { source: LlmMetricSource.Codex, points: 0, newestAt: null },
          ],
        }),
      ),
    ).toBe(true);
  });

  test.each([
    [
      "an app sent calls",
      {
        apps: apps({
          callsRecently: 3,
          newestCallAt: daysAgo(1).toISOString(),
        }),
      },
    ],
    [
      "calls before the past week",
      { apps: apps({ newestCallAt: daysAgo(20).toISOString() }) },
    ],
    ["calls in the view's window", { apps: apps({ callsInWindow: 2 }) }],
    [
      "an app calls an AI API unrecorded",
      {
        apps: apps({
          uninstrumented: [
            {
              serviceId: "svc-checkout",
              host: "api.openai.com",
              provider: "openai",
              calls: 4,
            },
          ],
        }),
      },
    ],
    [
      "a coding assistant sends metrics",
      {
        metrics: [
          {
            source: LlmMetricSource.ClaudeCode,
            points: 12,
            newestAt: daysAgo(1).toISOString(),
          },
        ],
      },
    ],
    ["a connection", { connections: [connection()] }],
    [
      "a connection turned off",
      { connections: [connection({ isEnabled: false })] },
    ],
    ["apps not known", { apps: null }],
    ["metrics not known", { metrics: null }],
    ["connections not known", { connections: null }],
  ] as Array<[string, Partial<LlmSetupCheckResponse>]>)(
    "%s: not quiet",
    (_name: string, overrides: Partial<LlmSetupCheckResponse>) => {
      expect(isLlmSetupCheckQuiet(response(overrides))).toBe(false);
    },
  );
});

/*
 * In every language the Dashboard speaks: each sentence of the setup check
 * is looked up whole in that language's locale file, so it reads in that
 * language - never English, never a {{placeholder}} left unfilled - with
 * the values (an app, a host, a count, the tools) inside it.
 */
describe("the setup check in every language", () => {
  const LOCALES: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];

  function translatorFor(language: string): Translator {
    const table: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    return createTranslator((key: string): string => {
      return table[key] || key;
    }, language);
  }

  const FINDINGS: Array<LlmEmptyViewFinding> = [
    {
      key: LlmEmptyViewFindingKey.CallsOutsideWindow,
      newestCallAt: daysAgo(10).toISOString(),
    },
    {
      key: LlmEmptyViewFindingKey.Uninstrumented,
      uninstrumented: {
        serviceId: "svc-checkout",
        host: "contoso.openai.azure.com",
        provider: "azure.ai.openai",
        calls: 42,
      },
    },
    {
      key: LlmEmptyViewFindingKey.Uninstrumented,
      uninstrumented: {
        serviceId: "svc-unknown",
        host: "api.openai.com",
        provider: "openai",
        calls: 1,
      },
    },
    {
      key: LlmEmptyViewFindingKey.CompanyToolsQuiet,
      connections: [
        connection({
          kind: "company-tool",
          provider: LlmConnectionProvider.ClaudeEnterprise,
        }),
      ],
    },
    {
      key: LlmEmptyViewFindingKey.CompanyToolsQuiet,
      connections: [
        connection({
          kind: "company-tool",
          provider: LlmConnectionProvider.ClaudeEnterprise,
          lastError: "HTTP 401",
          lastSuccessfulReadAt: null,
        }),
      ],
    },
    {
      key: LlmEmptyViewFindingKey.ProviderAccountsOnly,
      connections: [connection()],
    },
    {
      key: LlmEmptyViewFindingKey.ProviderAccountsOnly,
      connections: [connection(), connection({ connectionId: "c2" })],
    },
    {
      key: LlmEmptyViewFindingKey.CodingToolsOnly,
      metricSources: [LlmMetricSource.ClaudeCode],
    },
    {
      key: LlmEmptyViewFindingKey.CodingToolsOnly,
      metricSources: [LlmMetricSource.ClaudeCode, LlmMetricSource.Cursor],
    },
    { key: LlmEmptyViewFindingKey.Nothing },
  ];

  function sentencesIn(translator: Translator): Array<string> {
    const sentences: Array<string> = [];

    for (const finding of FINDINGS) {
      for (const view of ["conversations", "calls"] as Array<LlmEmptyView>) {
        const result: LlmEmptyViewWords = getLlmEmptyViewWords({
          finding,
          view,
          translator,
          serviceName,
          now: NOW,
        });

        sentences.push(translator.translateText(result.title) || result.title);
        sentences.push(result.description);
      }
    }

    const appsCases: Array<LlmSetupCheckApps> = [
      apps({
        callsRecently: 1240,
        newestCallAt: daysAgo(0.1).toISOString(),
        services: [
          { serviceId: "svc-checkout", calls: 1000, newestAt: null },
          { serviceId: "svc-unknown", calls: 240, newestAt: null },
        ],
        providers: [{ name: "azure.ai.openai", calls: 1240 }],
        answersRecently: 40,
        answersWithContent: 0,
        contentInLogs: true,
      }),
      apps({
        callsRecently: 1,
        services: [{ serviceId: "svc-unknown", calls: 1, newestAt: null }],
        answersRecently: 3,
        answersWithContent: 2,
      }),
      apps({
        callsRecently: 5,
        services: [{ serviceId: "svc-checkout", calls: 5, newestAt: null }],
        answersRecently: 5,
        answersWithContent: 0,
        contentInLogs: false,
      }),
      apps({ newestCallAt: daysAgo(12).toISOString() }),
      apps(),
    ];

    for (const value of appsCases) {
      for (const line of getAppsLines({
        apps: value,
        translator,
        serviceName,
        now: NOW,
      })) {
        sentences.push(line.text);

        if (line.detail) {
          sentences.push(line.detail);
        }
      }
    }

    const connectionCases: Array<LlmSetupCheckConnection> = [
      connection({ isEnabled: false }),
      connection({ lastError: "HTTP 401", lastSuccessfulReadAt: null }),
      connection({
        lastError: "HTTP 401",
        failureKind: "authentication",
        lastSuccessfulReadAt: null,
      }),
      connection({
        lastError: "HTTP 429",
        failureKind: "rate-limited",
        lastSuccessfulReadAt: null,
      }),
      connection({ lastSuccessfulReadAt: null }),
      connection({
        kind: "company-tool",
        provider: LlmConnectionProvider.ClaudeEnterprise,
        callsRecently: 1,
      }),
      connection({
        kind: "company-tool",
        provider: LlmConnectionProvider.ClaudeEnterprise,
        callsRecently: 31,
      }),
      connection({ newestUsageAt: "2026-11-03T00:00:00.000Z" }),
      connection({
        provider: LlmConnectionProvider.AzureOpenAI,
        resources: 0,
      }),
      connection({
        provider: LlmConnectionProvider.Anthropic,
        readSince: "2026-10-01T00:00:00.000Z",
      }),
      connection({ provider: LlmConnectionProvider.AwsBedrock }),
    ];

    for (const value of connectionCases) {
      const line: LlmSetupCheckLine = getConnectionLine({
        connection: value,
        translator,
        now: NOW,
      });

      sentences.push(line.text);

      if (line.detail) {
        sentences.push(line.detail);
      }
    }

    for (const range of [
      { range: TimeRange.PAST_ONE_MONTH },
      { range: TimeRange.PAST_THREE_MONTHS },
      { range: TimeRange.CUSTOM, startTime: daysAgo(120) },
    ]) {
      sentences.push(getWidenTitle(range, translator));
    }

    // The card of a project with nothing set up and nothing arriving.
    sentences.push(
      translator.translateText(NOTHING_COMING_IN) || NOTHING_COMING_IN,
    );

    return sentences;
  }

  const english: Array<string> = sentencesIn(ENGLISH);

  test("English is the reference: every sentence is there", () => {
    expect(english.length).toBeGreaterThan(50);
    expect(english.join(" ")).not.toContain("{{");
  });

  test.each(LANGUAGES)(
    "%s reads every sentence in its own words",
    (language: string) => {
      const sentences: Array<string> = sentencesIn(translatorFor(language));

      expect(sentences).toHaveLength(english.length);

      sentences.forEach((sentence: string, index: number) => {
        // The values are in: no placeholder is left.
        expect(sentence).not.toContain("{{");
        // Looked up, so never the English sentence.
        expect({ index, sentence }).not.toEqual({
          index,
          sentence: english[index],
        });
      });
    },
  );

  test.each(LANGUAGES)(
    "%s keeps the values a sentence carries",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const uninstrumented: LlmEmptyViewWords = getLlmEmptyViewWords({
        finding: FINDINGS[1]!,
        view: "conversations",
        translator,
        serviceName,
        now: NOW,
      });

      expect(uninstrumented.description).toContain("checkout");
      expect(uninstrumented.description).toContain("contoso.openai.azure.com");

      const failing: LlmSetupCheckLine = getConnectionLine({
        connection: connection({
          lastError: "HTTP 401",
          lastSuccessfulReadAt: null,
        }),
        translator,
        now: NOW,
      });

      // The server's own words are not translated, and kept apart.
      expect(failing.error).toBe("HTTP 401");
      expect(failing.text).not.toContain("HTTP 401");
    },
  );
});

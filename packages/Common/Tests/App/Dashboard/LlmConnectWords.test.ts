import { describe, expect, test } from "@jest/globals";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import {
  LlmConnectionCatalog,
  LlmConnectionDefinition,
  getLlmConnectionDefinition,
} from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../Types/LlmObservability/LlmConnectionTest";
import LlmConversationReaders from "../../../Types/LlmObservability/LlmConversationReaders";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { DOCS_URL } from "../../../UI/Config";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  getLlmConnectionHealth,
  getLlmConnectionLastReadSummary,
  getLlmConnectionPeopleSummary,
  getLlmConnectionReadingNote,
  LLM_CONNECTION_ACTIVE_MEMBERS,
  LLM_CONNECTION_MEMBERS,
  LLM_CONNECTION_STILL_READING,
  LlmConnectionSummary,
  formatLlmUsageDay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionHealth";
import {
  getLlmConnectionReadFailureWords,
  getLlmConnectionTestFigures,
  getLlmConnectionTestWords,
  getLlmProviderGroupingLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTestWords";
import {
  llmConnectionDocsUrl,
  readLlmConnectionTestResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectApi";
import {
  LLM_APPS_SNIPPETS,
  LlmAppsSnippet,
  LlmAppsSnippetBlock,
  OTLP_URL_PLACEHOLDER,
  TOKEN_PLACEHOLDER,
  fillLlmAppsSnippet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmAppsSnippets";
import {
  configFieldName,
  llmConnectionTestBody,
  llmConnectionTestDisabledReason,
  readLlmConnectionForm,
  secretFieldName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionFormModal";

/*
 * The words and rules behind AI / LLM > Connect, without a browser:
 *
 *   - how a connection is doing (off, waiting, working, not working) and
 *     what its last read brought in;
 *   - what a test says, and the figures it shows - only those the provider
 *     reports;
 *   - the server's answer read as a test result, whatever comes back;
 *   - each connection's guide address keeps its section;
 *   - the snippets carry the project's endpoint and key, and nothing else;
 *   - the form sends only the secrets that were typed, keeps the readers of
 *     a company tool's chats to owners and admins unless told otherwise,
 *     and says which setting is still missing before a test can run.
 */

const NOW: Date = new Date("2026-10-20T12:00:00.000Z");

const CONNECTED_WORD: RegExp = /connected/i;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function connectionWith(
  values: Partial<{
    isEnabled: boolean;
    lastPulledAt: Date;
    lastSuccessfulPullAt: Date;
    lastError: string;
    lastPullResult: JSONObject;
  }>,
): LlmObservabilityConnection {
  const connection: LlmObservabilityConnection =
    new LlmObservabilityConnection();
  connection.isEnabled = values.isEnabled ?? true;

  if (values.lastPulledAt) {
    connection.lastPulledAt = values.lastPulledAt;
  }

  if (values.lastSuccessfulPullAt) {
    connection.lastSuccessfulPullAt = values.lastSuccessfulPullAt;
  }

  if (values.lastError) {
    connection.lastError = values.lastError;
  }

  if (values.lastPullResult) {
    connection.lastPullResult = values.lastPullResult;
  }

  return connection;
}

function definitionOf(
  provider: LlmConnectionProvider,
): LlmConnectionDefinition {
  return getLlmConnectionDefinition(provider)!;
}

function result(
  values: Partial<LlmConnectionTestResult>,
): LlmConnectionTestResult {
  return {
    provider: LlmConnectionProvider.OpenAI,
    status: "pass",
    message: "",
    durationMs: 120,
    ...values,
  };
}

describe("how a connection is doing", () => {
  test("turned off, it is off - whatever its last read said", () => {
    const health: ReturnType<typeof getLlmConnectionHealth> =
      getLlmConnectionHealth(
        connectionWith({
          isEnabled: false,
          lastPulledAt: minutesAgo(5),
          lastError: "The key was not accepted.",
        }),
      );

    expect(health.key).toBe("off");
    expect(health.label).toBe("Off");
    expect(health.tooltipIsError).toBe(false);
  });

  test("never read yet, it is waiting for its first read", () => {
    const health: ReturnType<typeof getLlmConnectionHealth> =
      getLlmConnectionHealth(connectionWith({}));

    expect(health.key).toBe("waiting");
    expect(health.label).toBe("Waiting for the first read");
  });

  test("a last read that worked is working", () => {
    expect(
      getLlmConnectionHealth(
        connectionWith({
          lastPulledAt: minutesAgo(5),
          lastSuccessfulPullAt: minutesAgo(5),
        }),
      ).key,
    ).toBe("working");
  });

  test("an error that never worked is not working, and its tooltip is the stored error", () => {
    const health: ReturnType<typeof getLlmConnectionHealth> =
      getLlmConnectionHealth(
        connectionWith({
          lastPulledAt: minutesAgo(5),
          lastError: "The provider said: invalid key (redacted)",
        }),
      );

    expect(health.key).toBe("failing");
    expect(health.label).toBe("Not working");
    expect(health.tooltip).toBe("The provider said: invalid key (redacted)");
    expect(health.tooltipIsError).toBe(true);
  });

  test("an error newer than the last good read is not working", () => {
    expect(
      getLlmConnectionHealth(
        connectionWith({
          lastPulledAt: minutesAgo(5),
          lastSuccessfulPullAt: minutesAgo(60),
          lastError: "Rate limited.",
        }),
      ).key,
    ).toBe("failing");
  });

  test("an old error a later read got past is working again", () => {
    expect(
      getLlmConnectionHealth(
        connectionWith({
          lastPulledAt: minutesAgo(5),
          lastSuccessfulPullAt: minutesAgo(5),
          lastError: "Rate limited.",
        }),
      ).key,
    ).toBe("working");
  });
});

describe("what the last read brought in", () => {
  test("nothing before the first read, and nothing for a failed one", () => {
    expect(getLlmConnectionLastReadSummary(connectionWith({}))).toBe(undefined);
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: { kind: "usage", status: "failed", costUsd: 4 },
        }),
      ),
    ).toBe(undefined);
  });

  test("a company tool's answers and conversations", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "conversations",
            turnsImported: 42,
            conversationsImported: 7,
          },
        }),
      ),
    ).toEqual({
      template: "{{turns}} answers in {{conversations}} conversations",
      values: { turns: "42", conversations: "7" },
    });
  });

  test("a company tool with nothing new says so", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: { kind: "conversations", turnsImported: 0 },
        }),
      ),
    ).toEqual({ template: "No new chats", values: {} });
  });

  test("a provider account's cost, to the cent, its thousands set apart", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: { kind: "usage", days: 30, costUsd: 1234.5 },
        }),
      ),
    ).toEqual({
      template: "${{cost}} over the last {{days}} days",
      values: { cost: "1,234.50", days: "30" },
    });
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: { kind: "usage", days: 3, costUsd: 182.4 },
        }),
      )?.values["cost"],
    ).toBe("182.40");
  });

  test("tokens when the provider reports no money (Bedrock, Vertex AI)", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            days: 7,
            inputTokens: 1_200_000,
            outputTokens: 34_567,
          },
        }),
      ),
    ).toEqual({
      template: "{{tokens}} tokens over the last {{days}} days",
      values: { tokens: "1,234,567", days: "7" },
    });
  });

  test("an account that used nothing, read before reads kept what they covered", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({ lastPullResult: { kind: "usage", days: 7 } }),
      ),
    ).toEqual({ template: "No usage yet", values: {} });
  });

  /*
   * A read after the first covers the last three days, so "No usage yet"
   * said nothing about the thirty the first read covered (#5776). A quiet
   * read now says what the reads found overall.
   */
  test("a quiet read after usage was found says when the account was last used", () => {
    const summary: LlmConnectionSummary | undefined =
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            days: 3,
            newestUsageDay: "2026-10-28T00:00:00.000Z",
            readSince: "2026-10-05T00:00:00.000Z",
          },
        }),
      );

    expect(summary?.template).toBe("Last used {{date}}");
    expect(summary?.values["date"]).toBe(
      formatLlmUsageDay("2026-10-28T00:00:00.000Z"),
    );
  });

  test("an account never used says since when it was read", () => {
    const summary: LlmConnectionSummary | undefined =
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            days: 3,
            readSince: "2026-10-05T00:00:00.000Z",
          },
        }),
      );

    expect(summary?.template).toBe("No usage since {{date}}");
    expect(summary?.values["date"]).toBe(
      formatLlmUsageDay("2026-10-05T00:00:00.000Z"),
    );
    expect(summary?.plural).toBeUndefined();
  });

  test("Azure says how many resources it read, in the reader's plural", () => {
    const summary: LlmConnectionSummary | undefined =
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            days: 3,
            resources: 3,
            readSince: "2026-10-05T00:00:00.000Z",
          },
        }),
      );

    expect(summary?.plural).toEqual({
      one: "{{count}} resource read, no usage since {{date}}",
      other: "{{count}} resources read, no usage since {{date}}",
    });
    expect(summary?.count).toBe(3);
  });

  test("Azure that found no resource says so: a role in the wrong place, not a quiet account", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            days: 30,
            resources: 0,
            readSince: "2026-10-05T00:00:00.000Z",
          },
        }),
      ),
    ).toEqual({
      template: "No Azure OpenAI or Foundry resource found",
      values: {},
    });
  });

  test("usage in the last read still says what it cost", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            days: 3,
            costUsd: 12,
            newestUsageDay: "2026-10-28T00:00:00.000Z",
          },
        }),
      )?.template,
    ).toBe("${{cost}} over the last {{days}} days");
  });

  test("a UTC day is written as the same date in every timezone", () => {
    // Noon UTC: never the day before in the Americas, nor after in Asia.
    expect(formatLlmUsageDay("2026-10-28T00:00:00.000Z")).toBe(
      OneUptimeDate.getDateAsCompactLocalString(
        new Date("2026-10-28T12:00:00.000Z"),
        { onlyShowDate: true },
      ),
    );
    expect(formatLlmUsageDay("not a date")).toBe("");
  });

  test("a result it does not know is left out", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({ lastPullResult: { kind: "something-new" } }),
      ),
    ).toBe(undefined);
  });
});

/*
 * #5547: a Cursor team counts its members, and its first read of a busy
 * team takes more than one run - the row says both under what it read.
 */
describe("a team's people, and a read still catching up", () => {
  test("how many of the team's members were active in the past 7 days", () => {
    const summary: LlmConnectionSummary | undefined =
      getLlmConnectionPeopleSummary(
        connectionWith({
          lastPullResult: {
            kind: "usage",
            status: "success",
            members: 40,
            activeMembers: 12,
          },
        }),
      );

    expect(summary).toEqual({
      template: LLM_CONNECTION_ACTIVE_MEMBERS.other,
      values: { active: "12" },
      plural: LLM_CONNECTION_ACTIVE_MEMBERS,
      count: 40,
    });
    expect(
      getGlobalTranslator().translatePlural(
        summary!.plural!,
        summary!.count!,
        summary!.values,
      ),
    ).toBe("12 of 40 members active in the last 7 days");
  });

  test("one member reads in the singular; no more active than there are", () => {
    const summary: LlmConnectionSummary | undefined =
      getLlmConnectionPeopleSummary(
        connectionWith({
          lastPullResult: { kind: "usage", members: 1, activeMembers: 3 },
        }),
      );

    expect(
      getGlobalTranslator().translatePlural(
        summary!.plural!,
        summary!.count!,
        summary!.values,
      ),
    ).toBe("1 of 1 member active in the last 7 days");
  });

  test("the members alone when who was active could not be read", () => {
    expect(
      getLlmConnectionPeopleSummary(
        connectionWith({ lastPullResult: { kind: "usage", members: 25 } }),
      ),
    ).toEqual({
      template: LLM_CONNECTION_MEMBERS.other,
      values: {},
      plural: LLM_CONNECTION_MEMBERS,
      count: 25,
    });
  });

  test.each([
    [undefined],
    // A provider that does not count people.
    [{ kind: "usage", status: "success", costUsd: 4 }],
    [{ kind: "conversations", members: 40 }],
    [{ kind: "usage", members: "40" }],
  ] as Array<[JSONObject | undefined]>)(
    "nothing to say of people for %p",
    (lastPullResult: JSONObject | undefined) => {
      expect(
        getLlmConnectionPeopleSummary(
          connectionWith(lastPullResult ? { lastPullResult } : {}),
        ),
      ).toBe(undefined);
    },
  );

  test("a read that is still catching up says so, until it has", () => {
    expect(
      getLlmConnectionReadingNote(
        connectionWith({
          lastPullResult: { kind: "usage", status: "partial", days: 7 },
        }),
      ),
    ).toBe(LLM_CONNECTION_STILL_READING);
    expect(LLM_CONNECTION_STILL_READING).toBe("Still reading earlier usage");

    for (const lastPullResult of [
      { kind: "usage", status: "success", days: 7 },
      { kind: "usage", status: "failed" },
      { kind: "conversations", status: "partial" },
    ] as Array<JSONObject>) {
      expect(
        getLlmConnectionReadingNote(connectionWith({ lastPullResult })),
      ).toBe(undefined);
    }

    // A connection turned off is not reading anything.
    expect(
      getLlmConnectionReadingNote(
        connectionWith({
          isEnabled: false,
          lastPullResult: { kind: "usage", status: "partial" },
        }),
      ),
    ).toBe(undefined);
  });

  test("a read still catching up is working, with what it has read so far", () => {
    const connection: LlmObservabilityConnection = connectionWith({
      lastPulledAt: minutesAgo(5),
      lastSuccessfulPullAt: minutesAgo(5),
      lastPullResult: {
        kind: "usage",
        status: "partial",
        days: 7,
        costUsd: 96.25,
      },
    });

    expect(getLlmConnectionHealth(connection).key).toBe("working");
    expect(getLlmConnectionLastReadSummary(connection)).toEqual({
      template: "${{cost}} over the last {{days}} days",
      values: { cost: "96.25", days: "7" },
    });
  });
});

describe("what a test says", () => {
  test("a provider account that works shows the last 7 days", () => {
    expect(
      getLlmConnectionTestWords({
        result: result({ status: "pass" }),
        definition: definitionOf(LlmConnectionProvider.OpenAI),
      }),
    ).toEqual({
      // "It works": a test in the form runs before anything is connected.
      headline: "It works. Here is what the account used in the last 7 days.",
    });
  });

  test("a company tool that works shows what the first read brings", () => {
    expect(
      getLlmConnectionTestWords({
        result: result({ status: "pass" }),
        definition: definitionOf(LlmConnectionProvider.ClaudeEnterprise),
      }).headline,
    ).toBe("It works. Here is what the first read will bring in.");
  });

  test("connected but quiet is a warning with a next step, for each kind", () => {
    const account: ReturnType<typeof getLlmConnectionTestWords> =
      getLlmConnectionTestWords({
        result: result({ status: "warn" }),
        definition: definitionOf(LlmConnectionProvider.Anthropic),
      });
    const tool: ReturnType<typeof getLlmConnectionTestWords> =
      getLlmConnectionTestWords({
        result: result({ status: "warn" }),
        definition: definitionOf(LlmConnectionProvider.Microsoft365Copilot),
      });

    expect(account.headline).toBe(
      "It works, but the account has no usage in the last 7 days.",
    );
    expect(account.advice).toContain("right organization");
    expect(tool.headline).toBe(
      "It works, but nobody has used it in the last 7 days.",
    );
    expect(tool.advice).toContain("organization or tenant");
  });

  /*
   * Azure lists a subscription's resources without complaint when the app
   * registration has no role where they are: a test that read none found
   * nothing to read, which is not a quiet account (#5776).
   */
  test("an Azure test that found no resource says where the role belongs", () => {
    const words: ReturnType<typeof getLlmConnectionTestWords> =
      getLlmConnectionTestWords({
        result: result({
          provider: LlmConnectionProvider.AzureOpenAI,
          status: "warn",
          counts: { days: 7, resources: 0 },
        }),
        definition: definitionOf(LlmConnectionProvider.AzureOpenAI),
      });

    expect(words.headline).toBe(
      "It signs in, but it found no Azure OpenAI or Foundry resource in the subscription.",
    );
    expect(words.advice).toContain("Monitoring Reader role");
  });

  test("an Azure test that read resources with no usage is a quiet account", () => {
    expect(
      getLlmConnectionTestWords({
        result: result({
          provider: LlmConnectionProvider.AzureOpenAI,
          status: "warn",
          counts: { days: 7, resources: 2 },
        }),
        definition: definitionOf(LlmConnectionProvider.AzureOpenAI),
      }).headline,
    ).toBe("It works, but the account has no usage in the last 7 days.");
  });

  test.each([
    [
      LlmConnectionFailureKind.Authentication,
      "The key or secret was not accepted.",
      "revoked",
    ],
    [
      LlmConnectionFailureKind.Permission,
      "The credential works, but it may not read what this connection needs.",
      "role or scope",
    ],
    [
      LlmConnectionFailureKind.RateLimited,
      "The provider asked OneUptime to slow down.",
      "in a minute",
    ],
    [
      LlmConnectionFailureKind.Unavailable,
      "The provider could not be reached.",
      "can reach the provider",
    ],
    [
      LlmConnectionFailureKind.Settings,
      "A setting is not right.",
      "Fix the setting",
    ],
    [
      LlmConnectionFailureKind.Other,
      "The provider refused the test.",
      "Its answer is below",
    ],
  ])(
    "a %s failure says what went wrong and what to do",
    (kind: LlmConnectionFailureKind, headline: string, advice: string) => {
      const words: ReturnType<typeof getLlmConnectionTestWords> =
        getLlmConnectionTestWords({
          result: result({
            status: "fail",
            failureKind: kind,
            message: "HTTP 401: invalid x-api-key",
          }),
          definition: definitionOf(LlmConnectionProvider.Anthropic),
        });

      expect(words.headline).toBe(headline);
      expect(words.advice).toContain(advice);
      // The provider's own words stay apart, as the details.
      expect(words.details).toBe("HTTP 401: invalid x-api-key");
    },
  );

  test("a failure of no known kind reads as a refusal, with no empty details", () => {
    const words: ReturnType<typeof getLlmConnectionTestWords> =
      getLlmConnectionTestWords({
        result: result({ status: "fail", message: "" }),
        definition: definitionOf(LlmConnectionProvider.OpenAI),
      });

    expect(words.headline).toBe("The provider refused the test.");
    expect(words.details).toBe(undefined);
  });
});

describe("why a saved connection's last read failed", () => {
  test("a known failure says what went wrong and what to do, as a test would", () => {
    expect(
      getLlmConnectionReadFailureWords({
        definition: definitionOf(LlmConnectionProvider.AzureOpenAI),
        lastPullResult: { status: "failed", failureKind: "permission" },
      }),
    ).toEqual({
      headline:
        "The credential works, but it may not read what this connection needs.",
      advice:
        "Give it the role or scope the setup guide names, then test again.",
    });
    expect(
      getLlmConnectionReadFailureWords({
        definition: definitionOf(LlmConnectionProvider.OpenAI),
        lastPullResult: { status: "failed", failureKind: "authentication" },
      })?.headline,
    ).toBe("The key or secret was not accepted.");
  });

  test("the provider's own answer is not repeated in the words", () => {
    expect(
      getLlmConnectionReadFailureWords({
        definition: definitionOf(LlmConnectionProvider.OpenAI),
        lastPullResult: { status: "failed", failureKind: "rate-limited" },
      }),
    ).not.toHaveProperty("details");
  });

  test.each([
    // "The provider refused the test" is a test's words, not a read's.
    [{ status: "failed", failureKind: "other" }],
    [{ status: "failed", failureKind: "something-new" }],
    [{ status: "failed" }],
    [undefined],
  ] as Array<[JSONObject | undefined]>)(
    "anything else (%p) leaves the provider's answer to speak alone",
    (lastPullResult: JSONObject | undefined) => {
      expect(
        getLlmConnectionReadFailureWords({
          definition: definitionOf(LlmConnectionProvider.OpenAI),
          lastPullResult,
        }),
      ).toBe(undefined);
    },
  );

  test("a provider the catalog does not know has no words", () => {
    expect(
      getLlmConnectionReadFailureWords({
        definition: undefined,
        lastPullResult: { status: "failed", failureKind: "permission" },
      }),
    ).toBe(undefined);
  });

  /*
   * Cursor has no role or scope to give: what it refuses is a personal key,
   * or a team whose plan has no Admin API.
   */
  test("a Cursor key that may not read the team: Cursor's own words", () => {
    expect(
      getLlmConnectionReadFailureWords({
        definition: definitionOf(LlmConnectionProvider.Cursor),
        lastPullResult: { status: "failed", failureKind: "permission" },
      }),
    ).toEqual({
      headline:
        "Cursor accepted the key, but it may not read the team's usage.",
      advice:
        "Use an Admin API key of a Teams or Enterprise team: a team admin creates it in the Cursor dashboard, under Settings, Cursor Admin API Keys. Then test again.",
    });

    // Its other failures keep the words every provider has.
    expect(
      getLlmConnectionReadFailureWords({
        definition: definitionOf(LlmConnectionProvider.Cursor),
        lastPullResult: { status: "failed", failureKind: "authentication" },
      })?.headline,
    ).toBe("The key or secret was not accepted.");
    expect(
      getLlmConnectionReadFailureWords({
        definition: definitionOf(LlmConnectionProvider.Cursor),
        lastPullResult: { status: "failed", failureKind: "rate-limited" },
      })?.headline,
    ).toBe("The provider asked OneUptime to slow down.");
  });
});

describe("the figures a test shows", () => {
  test("none for a failure", () => {
    expect(
      getLlmConnectionTestFigures(
        result({ status: "fail", counts: { costUsd: 12, requests: 3 } }),
      ),
    ).toEqual([]);
  });

  test("a provider account's cost, tokens, requests, models, people, keys and projects", () => {
    expect(
      getLlmConnectionTestFigures(
        result({
          counts: {
            costUsd: 12.345,
            inputTokens: 1_500_000,
            outputTokens: 250_000,
            requests: 15_400,
            models: 3,
            people: 4,
            apiKeys: 2,
            projects: 5,
          },
        }),
        LlmConnectionProvider.OpenAI,
      ),
    ).toEqual([
      { key: "cost", label: "Cost", value: "$12.35" },
      { key: "tokens", label: "Tokens", value: "1.8M" },
      { key: "requests", label: "Requests", value: "15.4K" },
      { key: "models", label: "Models", value: "3" },
      { key: "people", label: "People", value: "4" },
      { key: "apiKeys", label: "API keys", value: "2" },
      { key: "projects", label: "Projects", value: "5" },
    ]);
  });

  test("only what the provider reports: Bedrock has no cost, and nothing is shown as zero", () => {
    expect(
      getLlmConnectionTestFigures(
        result({
          provider: LlmConnectionProvider.AwsBedrock,
          counts: {
            costUsd: 0,
            inputTokens: 9_000,
            outputTokens: 0,
            requests: 0,
            projects: 2,
          },
        }),
      ),
    ).toEqual([
      { key: "tokens", label: "Tokens", value: "9,000" },
      { key: "projects", label: "Regions", value: "2" },
    ]);
  });

  test("a company tool's conversations show even when there are none", () => {
    expect(
      getLlmConnectionTestFigures(
        result({
          provider: LlmConnectionProvider.ClaudeEnterprise,
          status: "warn",
          counts: { conversations: 0, people: 0 },
        }),
      ),
    ).toEqual([{ key: "conversations", label: "Conversations", value: "0" }]);
  });

  test("a Cursor team's members, beside the people who used it", () => {
    expect(
      getLlmConnectionTestFigures(
        result({
          provider: LlmConnectionProvider.Cursor,
          counts: {
            costUsd: 96.25,
            inputTokens: 5_400_000,
            outputTokens: 610_000,
            requests: 2310,
            models: 4,
            people: 12,
            members: 40,
          },
        }),
        LlmConnectionProvider.Cursor,
      ),
    ).toEqual([
      { key: "cost", label: "Cost", value: "$96.25" },
      { key: "tokens", label: "Tokens", value: "6.0M" },
      { key: "requests", label: "Requests", value: "2,310" },
      { key: "models", label: "Models", value: "4" },
      { key: "people", label: "People", value: "12" },
      { key: "members", label: "Members", value: "40" },
    ]);

    // A team of none: no figure.
    expect(
      getLlmConnectionTestFigures(
        result({
          provider: LlmConnectionProvider.Cursor,
          status: "warn",
          counts: { members: 0 },
        }),
        LlmConnectionProvider.Cursor,
      ),
    ).toEqual([]);
  });

  test("money reads as money: thousands set apart, cents kept", () => {
    expect(
      getLlmConnectionTestFigures(result({ counts: { costUsd: 12_345.6 } })),
    ).toEqual([{ key: "cost", label: "Cost", value: "$12,345.60" }]);
  });

  test("never 'Connected' before the connection is: no headline says it", () => {
    for (const provider of [
      LlmConnectionProvider.OpenAI,
      LlmConnectionProvider.ClaudeEnterprise,
    ]) {
      for (const status of ["pass", "warn"] as Array<"pass" | "warn">) {
        expect(
          getLlmConnectionTestWords({
            result: result({ status }),
            definition: definitionOf(provider),
          }).headline,
        ).not.toMatch(CONNECTED_WORD);
      }
    }
  });

  test("billions read as billions", () => {
    expect(
      getLlmConnectionTestFigures(
        result({ counts: { inputTokens: 2_500_000_000 } }),
      ),
    ).toEqual([{ key: "tokens", label: "Tokens", value: "2.5B" }]);
  });

  test.each([
    [LlmConnectionProvider.OpenAI, "Projects"],
    [LlmConnectionProvider.Anthropic, "Workspaces"],
    [LlmConnectionProvider.AzureOpenAI, "Resources"],
    [LlmConnectionProvider.AwsBedrock, "Regions"],
    [LlmConnectionProvider.GoogleVertexAI, "Regions"],
    [undefined, "Projects"],
  ])(
    "%s groups its usage by %s",
    (provider: LlmConnectionProvider | undefined, label: string) => {
      expect(getLlmProviderGroupingLabel(provider)).toBe(label);
    },
  );
});

describe("the server's answer to a test", () => {
  test("is read as the result it is", () => {
    expect(
      readLlmConnectionTestResult({
        provider: "anthropic",
        status: "warn",
        message: "No usage in the last 7 days.",
        failureKind: "settings",
        counts: { days: 7, costUsd: 0, models: "three", requests: null },
        durationMs: 845,
      }),
    ).toEqual({
      provider: "anthropic",
      status: "warn",
      message: "No usage in the last 7 days.",
      failureKind: "settings",
      // Only numbers are figures.
      counts: { days: 7, costUsd: 0 },
      durationMs: 845,
    });
  });

  test("anything else is a failure that says so, never a pass", () => {
    for (const answer of [
      undefined,
      {},
      { status: "ok" },
      { status: "PASS", provider: "openai" },
    ]) {
      const read: LlmConnectionTestResult = readLlmConnectionTestResult(
        answer as JSONObject | undefined,
      );

      expect(read.status).toBe("fail");
      expect(read.failureKind).toBe(LlmConnectionFailureKind.Other);
      expect(read.message).toBe(
        "The server did not return a test result. Check the API logs and try again.",
      );
    }
  });
});

describe("each connection's guide", () => {
  test.each(
    LlmConnectionCatalog.map(
      (definition: LlmConnectionDefinition): [string, string] => {
        return [definition.provider, definition.docsPath];
      },
    ),
  )(
    "%s opens its own section of the docs",
    (_provider: string, docsPath: string) => {
      const url: string = llmConnectionDocsUrl(docsPath).toString();
      const [, section] = docsPath.split("#");

      expect(docsPath.startsWith("/docs/telemetry/")).toBe(true);
      expect(section).toBeTruthy();
      expect(url.startsWith(DOCS_URL.toString())).toBe(true);
      expect(url.endsWith(`#${section}`)).toBe(true);
      // The docs address is not repeated.
      expect(url).not.toContain("/docs/docs/");
    },
  );
});

describe("the snippets for your apps", () => {
  test("Python, Node.js, .NET, Java, any language and a gateway, in that order", () => {
    expect(
      LLM_APPS_SNIPPETS.map((snippet: LlmAppsSnippet): string => {
        return snippet.key;
      }),
    ).toEqual(["python", "node", "dotnet", "java", "otel", "gateway"]);
  });

  function codeOf(key: string): string {
    return LLM_APPS_SNIPPETS.find((snippet: LlmAppsSnippet): boolean => {
      return snippet.key === key;
    })!
      .blocks.map((block: LlmAppsSnippetBlock): string => {
        return block.code;
      })
      .join("\n");
  }

  function noteOf(key: string): string {
    return LLM_APPS_SNIPPETS.find((snippet: LlmAppsSnippet): boolean => {
      return snippet.key === key;
    })!.note;
  }

  /*
   * The same SDKs call OpenAI and Azure OpenAI or Microsoft Foundry (#5776):
   * each language's snippet shows both clients, traced the same way.
   */
  test("Python and Node.js show the OpenAI and the Azure OpenAI client", () => {
    expect(codeOf("python")).toContain("client = OpenAI()");
    expect(codeOf("python")).toContain(
      "# client = AzureOpenAI(azure_endpoint=",
    );
    expect(codeOf("node")).toContain("const client = new OpenAI();");
    expect(codeOf("node")).toContain("// const client = new AzureOpenAI({");

    for (const key of ["python", "node"]) {
      expect(noteOf(key)).toContain("Azure OpenAI and Microsoft Foundry");
    }
  });

  test("Node.js hands OpenLLMetry the openai module, as its docs say to", () => {
    expect(codeOf("node")).toContain("instrumentModules: { openAI: OpenAI }");
  });

  test(".NET turns the OpenAI library's OpenTelemetry on and exports its source and meter", () => {
    const dotnet: string = codeOf("dotnet");

    expect(dotnet).toContain(
      "dotnet add package OpenTelemetry.Extensions.Hosting",
    );
    expect(dotnet).toContain(
      "dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol",
    );
    expect(dotnet).toContain(
      'AppContext.SetSwitch("OpenAI.Experimental.EnableOpenTelemetry", true);',
    );
    expect(dotnet).toContain('AddSource("OpenAI.*")');
    expect(dotnet).toContain('AddMeter("OpenAI.*")');
    expect(dotnet).toContain('OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"');
    // It records no content: the note says so, and which library does.
    expect(noteOf("dotnet")).toContain("They record no prompts or answers");
    expect(noteOf("dotnet")).toContain("EnableSensitiveData");
  });

  test("Java runs the OpenTelemetry Java agent, and says where its content goes", () => {
    const java: string = codeOf("java");

    expect(java).toContain(
      "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar",
    );
    expect(java).toContain("java -javaagent:opentelemetry-javaagent.jar");
    expect(noteOf("java")).toContain(
      "as log events, which conversations do not show",
    );
    // The agent records no content until it is told to: never said as if it did.
    expect(noteOf("java")).toContain(
      "With content capture on, it sends prompts and answers",
    );
  });

  test("the any-language snippet says Python's instrumentations take span_only", () => {
    expect(codeOf("otel")).toContain("span_only instead of true");
  });

  test.each(
    LLM_APPS_SNIPPETS.map(
      (snippet: LlmAppsSnippet): [string, LlmAppsSnippet] => {
        return [snippet.key, snippet];
      },
    ),
  )(
    "%s carries the project's endpoint and key, and nothing of the placeholders once filled",
    (_key: string, snippet: LlmAppsSnippet) => {
      const code: string = snippet.blocks
        .map((block: LlmAppsSnippetBlock): string => {
          return block.code;
        })
        .join("\n");

      expect(code).toContain(OTLP_URL_PLACEHOLDER);
      expect(code).toContain(TOKEN_PLACEHOLDER);
      // The key is sent the way OneUptime reads it.
      expect(code).toContain("x-oneuptime-token");

      const filled: string = fillLlmAppsSnippet(code, {
        otlpUrl: "https://oneuptime.example.com/otlp",
        token: "key-123",
      });

      expect(filled).not.toContain(OTLP_URL_PLACEHOLDER);
      expect(filled).not.toContain(TOKEN_PLACEHOLDER);
      expect(filled).toContain("https://oneuptime.example.com/otlp");
      expect(filled).toContain("key-123");
    },
  );

  test("the Python snippet groups calls into conversations and says who asked", () => {
    const python: string = LLM_APPS_SNIPPETS.find(
      (snippet: LlmAppsSnippet): boolean => {
        return snippet.key === "python";
      },
    )!
      .blocks.map((block: LlmAppsSnippetBlock): string => {
        return block.code;
      })
      .join("\n");

    expect(python).toContain('"session_id"');
    expect(python).toContain('"user_email"');
  });

  test("the any-language snippet records prompts and answers", () => {
    const otel: string = LLM_APPS_SNIPPETS.find(
      (snippet: LlmAppsSnippet): boolean => {
        return snippet.key === "otel";
      },
    )!.blocks[0]!.code;

    expect(otel).toContain(
      "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true",
    );
  });

  test("the gateway sends LiteLLM's traces to the traces endpoint", () => {
    const gateway: string = LLM_APPS_SNIPPETS.find(
      (snippet: LlmAppsSnippet): boolean => {
        return snippet.key === "gateway";
      },
    )!
      .blocks.map((block: LlmAppsSnippetBlock): string => {
        return block.code;
      })
      .join("\n");

    expect(gateway).toContain('callbacks: ["otel"]');
    expect(gateway).toContain(`${OTLP_URL_PLACEHOLDER}/v1/traces`);
  });

  test("every placeholder is filled, however often it appears", () => {
    expect(
      fillLlmAppsSnippet(
        `${OTLP_URL_PLACEHOLDER} ${OTLP_URL_PLACEHOLDER} ${TOKEN_PLACEHOLDER}`,
        { otlpUrl: "u", token: "t" },
      ),
    ).toBe("u u t");
  });
});

describe("what the connection form sends", () => {
  const openAi: LlmConnectionDefinition = definitionOf(
    LlmConnectionProvider.OpenAI,
  );
  const vertex: LlmConnectionDefinition = definitionOf(
    LlmConnectionProvider.GoogleVertexAI,
  );
  const copilot: LlmConnectionDefinition = definitionOf(
    LlmConnectionProvider.Microsoft365Copilot,
  );
  const bedrock: LlmConnectionDefinition = definitionOf(
    LlmConnectionProvider.AwsBedrock,
  );

  test("a secret left blank is not sent, so an edit keeps the stored one", () => {
    expect(
      readLlmConnectionForm(openAi, {
        [secretFieldName("adminKey")]: "   ",
      }).secrets,
    ).toEqual({});
    expect(readLlmConnectionForm(openAi, {}).secrets).toEqual({});
  });

  test("a typed key is sent trimmed, as the password field hands it over", () => {
    expect(
      readLlmConnectionForm(openAi, {
        [secretFieldName("adminKey")]: new HashedString(
          "  sk-admin-abc  ",
        ) as unknown as JSONObject,
      }).secrets,
    ).toEqual({ adminKey: "sk-admin-abc" });
  });

  test("a pasted key file keeps its lines", () => {
    const keyFile: string = '{\n  "type": "service_account"\n}\n';

    expect(
      readLlmConnectionForm(vertex, {
        [configFieldName("projectId")]: " my-project ",
        [secretFieldName("serviceAccountJson")]: keyFile,
      }),
    ).toMatchObject({
      config: { projectId: "my-project" },
      secrets: { serviceAccountJson: keyFile },
    });
  });

  test("a dropdown's picked option is read as its value", () => {
    expect(
      readLlmConnectionForm(copilot, {
        [configFieldName("cloud")]: {
          label: "Azure Government (US)",
          value: "usgov",
        },
      }).config,
    ).toEqual({ cloud: "usgov" });
  });

  test("with no name, the connection is named after its provider", () => {
    expect(readLlmConnectionForm(openAi, { name: "  " }).name).toBe(
      openAi.title,
    );
    expect(readLlmConnectionForm(openAi, { name: " Prod org " }).name).toBe(
      "Prod org",
    );
  });

  test("a company tool's chats are for owners and admins unless everyone is picked", () => {
    expect(readLlmConnectionForm(copilot, {}).conversationReaders).toBe(
      LlmConversationReaders.Admins,
    );
    expect(
      readLlmConnectionForm(copilot, { conversationReaders: "something" })
        .conversationReaders,
    ).toBe(LlmConversationReaders.Admins);
    expect(
      readLlmConnectionForm(copilot, {
        conversationReaders: LlmConversationReaders.Everyone,
      }).conversationReaders,
    ).toBe(LlmConversationReaders.Everyone);
  });

  test("what people wrote is kept unless the switch is turned off", () => {
    expect(readLlmConnectionForm(copilot, {}).storeConversationText).toBe(true);
    expect(
      readLlmConnectionForm(copilot, { storeConversationText: false })
        .storeConversationText,
    ).toBe(false);
  });

  test("a new connection's test sends the provider and the unsaved settings", () => {
    expect(
      llmConnectionTestBody({
        definition: bedrock,
        values: {
          [configFieldName("accessKeyId")]: "AKIAEXAMPLE",
          [configFieldName("regions")]: "us-east-1,eu-west-1",
          [secretFieldName("secretAccessKey")]: "secret",
        },
      }),
    ).toEqual({
      provider: LlmConnectionProvider.AwsBedrock,
      config: { accessKeyId: "AKIAEXAMPLE", regions: "us-east-1,eu-west-1" },
      secrets: { secretAccessKey: "secret" },
    });
  });

  test("a saved connection's test names the connection, never the provider, and sends only the edits", () => {
    const connection: LlmObservabilityConnection =
      new LlmObservabilityConnection();
    connection.id = new ObjectID("f6d1c1f2-0e0b-4b9c-9d55-2a1c4c2f9e01");

    expect(
      llmConnectionTestBody({
        definition: bedrock,
        values: { [configFieldName("regions")]: "us-west-2" },
        connection,
      }),
    ).toEqual({
      connectionId: "f6d1c1f2-0e0b-4b9c-9d55-2a1c4c2f9e01",
      config: { regions: "us-west-2" },
      secrets: {},
    });
  });

  test("a new connection's test waits for every required setting, by name", () => {
    expect(
      llmConnectionTestDisabledReason({
        definition: openAi,
        values: {},
        isEditing: false,
        translator: getGlobalTranslator(),
      }),
    ).toBe("Fill in Admin key to test.");

    expect(
      llmConnectionTestDisabledReason({
        definition: openAi,
        values: { [secretFieldName("adminKey")]: "sk-admin-abc" },
        isEditing: false,
        translator: getGlobalTranslator(),
      }),
    ).toBe(undefined);
  });

  test("an edit's test can lean on the stored secrets", () => {
    expect(
      llmConnectionTestDisabledReason({
        definition: openAi,
        values: {},
        isEditing: true,
        translator: getGlobalTranslator(),
      }),
    ).toBe(undefined);
  });

  test("a setting with a default, or an optional one, never holds a test back", () => {
    // Bedrock's regions default to us-east-1; Copilot's group is optional.
    expect(
      llmConnectionTestDisabledReason({
        definition: bedrock,
        values: {
          [configFieldName("accessKeyId")]: "AKIAEXAMPLE",
          [secretFieldName("secretAccessKey")]: "secret",
        },
        isEditing: false,
        translator: getGlobalTranslator(),
      }),
    ).toBe(undefined);

    expect(
      llmConnectionTestDisabledReason({
        definition: copilot,
        values: {},
        isEditing: false,
        translator: getGlobalTranslator(),
      }),
    ).toBe(
      "Fill in Directory (tenant) ID, Application (client) ID, Client secret to test.",
    );
  });
});

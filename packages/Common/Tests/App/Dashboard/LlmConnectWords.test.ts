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
import { DOCS_URL } from "../../../UI/Config";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  getLlmConnectionHealth,
  getLlmConnectionLastReadSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionHealth";
import {
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

  test("an account that used nothing", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({ lastPullResult: { kind: "usage", days: 7 } }),
      ),
    ).toEqual({ template: "No usage yet", values: {} });
  });

  test("a result it does not know is left out", () => {
    expect(
      getLlmConnectionLastReadSummary(
        connectionWith({ lastPullResult: { kind: "something-new" } }),
      ),
    ).toBe(undefined);
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
  test("python, Node.js, any language and a gateway, in that order", () => {
    expect(
      LLM_APPS_SNIPPETS.map((snippet: LlmAppsSnippet): string => {
        return snippet.key;
      }),
    ).toEqual(["python", "node", "otel", "gateway"]);
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

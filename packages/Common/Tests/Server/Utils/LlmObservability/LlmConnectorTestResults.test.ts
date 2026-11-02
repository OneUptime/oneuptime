import { describe, expect, test } from "@jest/globals";
import LlmConnectorTestResults from "../../../../Server/Utils/LlmObservability/LlmConnectorTestResults";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { LlmUsageRecord } from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";

/*
 * Every LLM connector words its test's answer through these, so the
 * dashboard reads one shape: a status, the counts it found and, for a
 * failure, its kind and the provider's message with no secret in it.
 */

const SECRET: string = "sk-test-0123456789abcdefghij";

function makeRecord(data: Partial<LlmUsageRecord>): LlmUsageRecord {
  return {
    day: new Date("2026-10-01T00:00:00.000Z"),
    model: "",
    person: "",
    project: "",
    apiKey: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: null,
    costUsd: null,
    ...data,
  };
}

describe("LlmConnectorTestResults.countUsage", () => {
  test("is all zeros for no records", () => {
    expect(LlmConnectorTestResults.countUsage([], 7)).toEqual({
      days: 7,
      models: 0,
      people: 0,
      apiKeys: 0,
      projects: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      costUsd: 0,
    });
  });

  test("sums tokens, requests and cost, and counts each distinct name once", () => {
    const records: Array<LlmUsageRecord> = [
      makeRecord({
        model: "model-a",
        person: "alex@example.com",
        project: "web",
        apiKey: "prod",
        inputTokens: 100,
        outputTokens: 20,
        requests: 3,
        costUsd: 0.5,
      }),
      makeRecord({
        model: "model-a",
        person: "sam@example.com",
        project: "web",
        apiKey: "prod",
        inputTokens: 50,
        outputTokens: 10,
        requests: 1,
        costUsd: 0.25,
      }),
      makeRecord({
        model: "model-b",
        person: "alex@example.com",
        project: "mobile",
        apiKey: "staging",
        inputTokens: 10,
        outputTokens: 5,
        requests: 2,
        costUsd: 0.1,
      }),
    ];

    expect(LlmConnectorTestResults.countUsage(records, 30)).toEqual({
      days: 30,
      models: 2,
      people: 2,
      apiKeys: 2,
      projects: 2,
      inputTokens: 160,
      outputTokens: 35,
      requests: 6,
      costUsd: 0.85,
    });
  });

  test("does not count a model with no tokens and no requests", () => {
    // A cost line kept whole (web search, code execution) names what was bought.
    expect(
      LlmConnectorTestResults.countUsage(
        [makeRecord({ model: "web_search", costUsd: 1.5 })],
        7,
      ),
    ).toMatchObject({ models: 0, costUsd: 1.5 });
  });

  test("counts a model used by tokens alone or by requests alone", () => {
    expect(
      LlmConnectorTestResults.countUsage(
        [
          makeRecord({ model: "model-a", inputTokens: 1 }),
          makeRecord({ model: "model-b", outputTokens: 1 }),
          makeRecord({ model: "model-c", requests: 1 }),
        ],
        7,
      ).models,
    ).toBe(3);
  });

  test("leaves out empty names", () => {
    expect(
      LlmConnectorTestResults.countUsage(
        [makeRecord({ inputTokens: 10, requests: 1 })],
        7,
      ),
    ).toMatchObject({ models: 0, people: 0, apiKeys: 0, projects: 0 });
  });

  test("reads a missing request count or cost as zero", () => {
    expect(
      LlmConnectorTestResults.countUsage(
        [makeRecord({ inputTokens: 5, requests: null, costUsd: null })],
        7,
      ),
    ).toMatchObject({ inputTokens: 5, requests: 0, costUsd: 0 });
  });

  test("rounds the cost to cents", () => {
    expect(
      LlmConnectorTestResults.countUsage(
        [
          makeRecord({ costUsd: 0.1 }),
          makeRecord({ costUsd: 0.2 }),
          makeRecord({ costUsd: 0.004 }),
        ],
        7,
      ).costUsd,
    ).toBe(0.3);
  });
});

describe("LlmConnectorTestResults.fromUsage", () => {
  test("passes when there is usage", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromUsage({
      provider: "OpenAI",
      records: [makeRecord({ model: "model-a", inputTokens: 10 })],
      days: 7,
      durationMs: 120,
    });

    expect(result).toEqual({
      provider: "OpenAI",
      status: "pass",
      message: "Connected. Found usage in the last 7 days.",
      counts: {
        days: 7,
        models: 1,
        people: 0,
        apiKeys: 0,
        projects: 0,
        inputTokens: 10,
        outputTokens: 0,
        requests: 0,
        costUsd: 0,
      },
      durationMs: 120,
    });
  });

  test("passes on requests alone or on cost alone", () => {
    for (const record of [
      makeRecord({ requests: 1 }),
      makeRecord({ costUsd: 0.5 }),
      makeRecord({ outputTokens: 1 }),
    ]) {
      expect(
        LlmConnectorTestResults.fromUsage({
          provider: "OpenAI",
          records: [record],
          days: 7,
          durationMs: 1,
        }).status,
      ).toBe("pass");
    }
  });

  test("warns, not fails, when the key works but there is no usage", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromUsage({
      provider: "Anthropic",
      records: [makeRecord({ model: "model-a" })],
      days: 30,
      durationMs: 80,
    });

    expect(result.status).toBe("warn");
    expect(result.message).toBe(
      "Connected, but there is no usage in the last 30 days. Usage will show up as soon as there is some.",
    );
    expect(result.failureKind).toBeUndefined();
    expect(result.counts?.models).toBe(0);
  });

  test("warns with no records at all", () => {
    expect(
      LlmConnectorTestResults.fromUsage({
        provider: "Anthropic",
        records: [],
        days: 7,
        durationMs: 1,
      }).status,
    ).toBe("warn");
  });
});

describe("LlmConnectorTestResults.fromChats", () => {
  test("passes when there are conversations", () => {
    expect(
      LlmConnectorTestResults.fromChats({
        provider: "ChatGPT Enterprise",
        conversations: 12,
        people: 4,
        days: 7,
        durationMs: 300,
      }),
    ).toEqual({
      provider: "ChatGPT Enterprise",
      status: "pass",
      message: "Connected. Found conversations in the last 7 days.",
      counts: { days: 7, conversations: 12, people: 4 },
      durationMs: 300,
    });
  });

  test("warns when there are none", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromChats({
      provider: "ChatGPT Enterprise",
      conversations: 0,
      people: 0,
      days: 14,
      durationMs: 300,
    });

    expect(result.status).toBe("warn");
    expect(result.message).toBe(
      "Connected, but there are no conversations in the last 14 days.",
    );
    expect(result.counts).toEqual({ days: 14, conversations: 0, people: 0 });
  });
});

describe("LlmConnectorTestResults.fromError", () => {
  test("a setting refused before any call is a settings failure, as worded", () => {
    expect(
      LlmConnectorTestResults.fromError({
        provider: "Azure OpenAI",
        error: new BadDataException("Enter the resource name."),
        secretValues: [SECRET],
        durationMs: 2,
      }),
    ).toEqual({
      provider: "Azure OpenAI",
      status: "fail",
      message: "Enter the resource name.",
      failureKind: LlmConnectionFailureKind.Settings,
      durationMs: 2,
    });
  });

  test("never repeats a secret a refused setting names", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromError({
      provider: "Azure OpenAI",
      error: new BadDataException(`The key ${SECRET} is not valid here.`),
      secretValues: [SECRET],
      durationMs: 2,
    });

    expect(result.message).not.toContain(SECRET);
    expect(result.message).toContain("[REDACTED]");
  });

  test("an HTTP failure is classified by its status, with the secret removed", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromError({
      provider: "OpenAI",
      error: new Error(
        `Data source responded with HTTP 401: {"error":"invalid key ${SECRET}"}`,
      ),
      secretValues: [SECRET],
      durationMs: 45,
    });

    expect(result).toEqual({
      provider: "OpenAI",
      status: "fail",
      message:
        'OpenAI test failed with HTTP 401: {"error":"invalid key [REDACTED]"}',
      failureKind: LlmConnectionFailureKind.Authentication,
      durationMs: 45,
    });
  });

  test("each HTTP status maps to its kind", () => {
    const kinds: Array<[number, LlmConnectionFailureKind]> = [
      [403, LlmConnectionFailureKind.Permission],
      [404, LlmConnectionFailureKind.Settings],
      [429, LlmConnectionFailureKind.RateLimited],
      [503, LlmConnectionFailureKind.Unavailable],
      [400, LlmConnectionFailureKind.Other],
    ];

    for (const [status, kind] of kinds) {
      expect(
        LlmConnectorTestResults.fromError({
          provider: "OpenAI",
          error: new Error(`Data source responded with HTTP ${status}: nope`),
          secretValues: [],
          durationMs: 1,
        }).failureKind,
      ).toBe(kind);
    }
  });

  test("keeps the kind of a provider error a connector already classified", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromError({
      provider: "Anthropic",
      error: new LlmProviderError({
        message: `Rate limited for key ${SECRET}.`,
        kind: LlmConnectionFailureKind.RateLimited,
      }),
      secretValues: [SECRET],
      durationMs: 9,
    });

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(result.message).not.toContain(SECRET);
  });

  test("a provider that could not be reached is unavailable", () => {
    const result: LlmConnectionTestResult = LlmConnectorTestResults.fromError({
      provider: "OpenAI",
      error: new Error("getaddrinfo ENOTFOUND api.example.com"),
      secretValues: [],
      durationMs: 5000,
    });

    expect(result).toEqual({
      provider: "OpenAI",
      status: "fail",
      message:
        "OpenAI test did not complete: getaddrinfo ENOTFOUND api.example.com",
      failureKind: LlmConnectionFailureKind.Unavailable,
      durationMs: 5000,
    });
  });

  test("reads an error that is not an Error", () => {
    expect(
      LlmConnectorTestResults.fromError({
        provider: "OpenAI",
        error: undefined,
        secretValues: [],
        durationMs: 1,
      }).message,
    ).toBe("OpenAI test did not complete: Unknown error.");
  });
});

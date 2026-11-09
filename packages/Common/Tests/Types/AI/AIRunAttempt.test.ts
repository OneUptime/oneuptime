import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
  classifyAIRunFailureMessage,
  parseAIRunAttemptEnd,
} from "../../../Types/AI/AIRunAttempt";
import AIRunStatus, { AIRunStatusHelper } from "../../../Types/AI/AIRunStatus";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../Utils/Project/ProjectBalance";
import { describe, expect, test } from "@jest/globals";

/*
 * How an attempt of a durable AI run ended (issues #6437, #6438): the words
 * a failure says matched to what a person can act on, and an event's
 * attemptEnd as the dashboard may trust it.
 */

describe("classifyAIRunFailureMessage", () => {
  test("the customer's triage failure is a provider timeout, with its 120 seconds", () => {
    expect(
      classifyAIRunFailureMessage(
        "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.",
      ),
    ).toEqual({
      failureKind: AIRunFailureKind.ProviderTimeout,
      timeoutInSeconds: 120,
    });
  });

  test.each([
    [
      "the LLM provider did not respond in time",
      AIRunFailureKind.ProviderTimeout,
    ],
    [
      "the connection to the LLM provider timed out",
      AIRunFailureKind.ProviderTimeout,
    ],
    ["timeout of 120000ms exceeded", AIRunFailureKind.ProviderTimeout],
    ["504 Gateway Timeout", AIRunFailureKind.ProviderTimeout],
    ["connect ETIMEDOUT 10.0.0.1:443", AIRunFailureKind.ProviderTimeout],
    [
      'OpenAI API error: {"error":{"type":"rate_limit_exceeded"}}',
      AIRunFailureKind.ProviderUnavailable,
    ],
    ["429 Too Many Requests", AIRunFailureKind.ProviderUnavailable],
    [
      'Anthropic API error: {"type":"overloaded_error"}',
      AIRunFailureKind.ProviderUnavailable,
    ],
    ["503 Service Unavailable", AIRunFailureKind.ProviderUnavailable],
    [
      "the LLM provider could not be reached",
      AIRunFailureKind.ProviderUnavailable,
    ],
    ["socket hang up", AIRunFailureKind.ProviderUnavailable],
    ["read ECONNRESET", AIRunFailureKind.ProviderUnavailable],
    [
      'OpenAI API error: {"error":{"code":"invalid_api_key"}}',
      AIRunFailureKind.ProviderRejected,
    ],
    ["401 Unauthorized", AIRunFailureKind.ProviderRejected],
    [
      "The model `gpt-9` does not exist or you do not have access to it.",
      AIRunFailureKind.ProviderRejected,
    ],
    [
      "Ollama API error: the request is larger than the model's context window",
      AIRunFailureKind.ContextWindow,
    ],
    [
      "This model's maximum context length is 128000 tokens",
      AIRunFailureKind.ContextWindow,
    ],
    [
      "No LLM provider configured for this project.",
      AIRunFailureKind.NotConfigured,
    ],
    [
      "Daily autonomous AI token budget exhausted for this project.",
      AIRunFailureKind.LimitReached,
    ],
    [
      "This project has reached its daily AI token limit.",
      AIRunFailureKind.LimitReached,
    ],
    ["The project is out of AI credits.", AIRunFailureKind.CreditsUsedUp],
    // An older run's words, from before the shared wording.
    [
      "Insufficient AI balance. Please recharge.",
      AIRunFailureKind.CreditsUsedUp,
    ],
    // The provider's own account, not OneUptime's AI credits: no retry fixes it.
    [
      "429 You exceeded your current quota, please check your plan and billing details.",
      AIRunFailureKind.ProviderRejected,
    ],
    [
      '{"error":{"code":"insufficient_quota","message":"quota"}}',
      AIRunFailureKind.ProviderRejected,
    ],
    ["402 Insufficient Balance", AIRunFailureKind.ProviderRejected],
    [
      "Attempt 1 stopped reporting progress (the server processing it may have restarted) and the run was requeued.",
      AIRunFailureKind.ServerStopped,
    ],
    [
      "Attempt 2 was handed back to the queue because the server running it shut down.",
      AIRunFailureKind.ServerStopped,
    ],
    ["The tool loop crashed", AIRunFailureKind.Other],
    ["", AIRunFailureKind.Other],
  ])("%j is %s", (message: string, expected: AIRunFailureKind) => {
    expect(classifyAIRunFailureMessage(message).failureKind).toBe(expected);
  });

  /*
   * The words the server fails a run with when the project's AI credits
   * are used up are the shared ones: a run that failed so reads as used-up
   * credits, not as something that went wrong, and is not tried again.
   */
  test("the server's own words for used-up AI credits are used-up credits", () => {
    expect(
      classifyAIRunFailureMessage(PROJECT_AI_CREDITS_USED_UP_MESSAGE)
        .failureKind,
    ).toBe(AIRunFailureKind.CreditsUsedUp);
  });

  test("a setting a person must change wins over the words of a timeout", () => {
    // A provider that is not set up says nothing a retry can get past.
    expect(
      classifyAIRunFailureMessage(
        "No LLM provider configured for this project; the request timed out.",
      ).failureKind,
    ).toBe(AIRunFailureKind.NotConfigured);
    expect(
      classifyAIRunFailureMessage(
        "the request is larger than the model's context window, and it timed out",
      ).failureKind,
    ).toBe(AIRunFailureKind.ContextWindow);
  });

  test("only the start of a long error is read, and it is read quickly", () => {
    const long: string = `${"x".repeat(5000)} timed out`;

    const started: number = Date.now();
    expect(classifyAIRunFailureMessage(long).failureKind).toBe(
      AIRunFailureKind.Other,
    );
    // Linear patterns: even 200 KB of a provider's words take no time.
    classifyAIRunFailureMessage("did not respond within ".repeat(10000));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("a missing message is Other, never a crash", () => {
    expect(
      classifyAIRunFailureMessage(undefined as unknown as string).failureKind,
    ).toBe(AIRunFailureKind.Other);
  });
});

describe("parseAIRunAttemptEnd", () => {
  test("a full attempt end is read as written", () => {
    const attemptEnd: AIRunAttemptEnd = {
      outcome: AIRunAttemptOutcome.WillRetry,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: "2026-11-09T14:05:00.000Z",
      timeoutInSeconds: 120,
    };

    expect(
      parseAIRunAttemptEnd(JSON.parse(JSON.stringify(attemptEnd))),
    ).toEqual(attemptEnd);
  });

  test.each([
    [null],
    [undefined],
    ["WillRetry"],
    [42],
    [[{ outcome: AIRunAttemptOutcome.GaveUp }]],
    [{}],
    [{ outcome: "Exploded" }],
    [{ outcome: 7 }],
  ])("%j is no attempt end", (value: unknown) => {
    expect(parseAIRunAttemptEnd(value)).toBeNull();
  });

  test("what it does not know is left out, and the rest is kept", () => {
    expect(
      parseAIRunAttemptEnd({
        outcome: AIRunAttemptOutcome.GaveUp,
        failureKind: "SomethingNew",
        attempt: 2.5,
        maxAttempts: -3,
        timeoutInSeconds: "120",
        nextAttemptAt: "not a time",
        extra: "<script>",
      }),
    ).toEqual({ outcome: AIRunAttemptOutcome.GaveUp });
  });

  test("numbers past any real run's are not trusted", () => {
    expect(
      parseAIRunAttemptEnd({
        outcome: AIRunAttemptOutcome.GaveUp,
        attempt: 1000000,
        maxAttempts: 3,
      }),
    ).toEqual({ outcome: AIRunAttemptOutcome.GaveUp, maxAttempts: 3 });
  });

  test("a time too long to be one is not read", () => {
    expect(
      parseAIRunAttemptEnd({
        outcome: AIRunAttemptOutcome.WillRetry,
        nextAttemptAt: `2026-11-09T14:05:00.000Z${" ".repeat(40)}`,
      }),
    ).toEqual({ outcome: AIRunAttemptOutcome.WillRetry });
  });
});

describe("AIRunStatusHelper.didNotFinish", () => {
  test.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "a run that is %s did not finish: Try again is offered",
    (status: AIRunStatus) => {
      expect(AIRunStatusHelper.didNotFinish(status)).toBe(true);
    },
  );

  test.each([
    AIRunStatus.Completed,
    AIRunStatus.NoFixFound,
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
  ])("a run that is %s did not fail", (status: AIRunStatus) => {
    expect(AIRunStatusHelper.didNotFinish(status)).toBe(false);
  });

  test("no status is not a failure", () => {
    expect(AIRunStatusHelper.didNotFinish(undefined)).toBe(false);
    expect(AIRunStatusHelper.didNotFinish(null)).toBe(false);
  });

  test("every status that did not finish is terminal: nothing still runs", () => {
    for (const status of AIRunStatusHelper.didNotFinishStatuses()) {
      expect(AIRunStatusHelper.isTerminalStatus(status)).toBe(true);
    }
  });
});

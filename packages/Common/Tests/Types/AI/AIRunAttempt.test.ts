import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
  classifyAIRunFailureMessage,
  getRecordTokenLimitFailureKind,
  isRecordTokenLimitFailureKind,
  parseAIRunAttemptEnd,
  RECORD_TOKEN_LIMIT_FAILURE_KINDS,
} from "../../../Types/AI/AIRunAttempt";
import AIRunStatus, { AIRunStatusHelper } from "../../../Types/AI/AIRunStatus";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../Utils/Project/ProjectBalance";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
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
    // Each provider's words for a request too long for the model (#6441).
    [
      'Anthropic API error: {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 215000 tokens > 200000 maximum"}}',
      AIRunFailureKind.ContextWindow,
    ],
    [
      "input length and `max_tokens` exceed context limit: 187254 + 20000 > 200000, decrease input length or `max_tokens` and try again",
      AIRunFailureKind.ContextWindow,
    ],
    [
      'OpenAI API error: {"error":{"code":"context_length_exceeded"}}',
      AIRunFailureKind.ContextWindow,
    ],
    [
      "ValidationException: Input is too long for requested model.",
      AIRunFailureKind.ContextWindow,
    ],
    [
      "The input token count (1234567) exceeds the maximum number of tokens allowed (1048576).",
      AIRunFailureKind.ContextWindow,
    ],
    // A cap on the answer's own tokens is not the context window.
    [
      "max_tokens: 100000 > 64000, which is the maximum allowed number of output tokens",
      AIRunFailureKind.Other,
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
    /*
     * The incident's or alert's own daily AI token limit (#7157): not the
     * project's limits, and a limit of 0 pauses the work rather than
     * running out until midnight.
     */
    [
      "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
      AIRunFailureKind.IncidentTokenLimitPaused,
    ],
    [
      "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
      AIRunFailureKind.AlertTokenLimitPaused,
    ],
    [
      "Automatic AI work for incidents used 1,200 of its Daily Incident AI Token Limit of 1,000 tokens today. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
      AIRunFailureKind.IncidentTokenLimitUsedUp,
    ],
    [
      "Automatic AI work for alerts used up today's Daily Alert AI Token Limit. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
      AIRunFailureKind.AlertTokenLimitUsedUp,
    ],
    // The words such a run failed with before, which stored runs keep.
    [
      "Daily autonomous AI token budget exhausted (0 of 0 tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under Incidents > AI > Settings.",
      AIRunFailureKind.IncidentTokenLimitPaused,
    ],
    [
      "Daily autonomous AI token budget exhausted (0 of 0 tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under Alerts > AI > Settings.",
      AIRunFailureKind.AlertTokenLimitPaused,
    ],
    [
      "Daily autonomous AI token budget exhausted (1,000,000 of 200,000 tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under Incidents > AI > Settings.",
      AIRunFailureKind.IncidentTokenLimitUsedUp,
    ],
    [
      "Daily autonomous AI token budget exhausted (500 of 500 tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under Alerts > AI > Settings.",
      AIRunFailureKind.AlertTokenLimitUsedUp,
    ],
    // The oldest named no record: still a limit, which one unknown.
    [
      "Daily autonomous AI token budget exhausted (0 of 0 tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit in the AI settings pages.",
      AIRunFailureKind.LimitReached,
    ],
    // No provider stays no provider, whatever else the error says.
    [
      "No AI provider configured. The Daily Incident AI Token Limit is set to 0",
      AIRunFailureKind.NotConfigured,
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

    expect(classifyAIRunFailureMessage(long).failureKind).toBe(
      AIRunFailureKind.Other,
    );

    // Linear patterns: even 200 KB of a provider's words take no time.
    const providerWords: string = "did not respond within ".repeat(10000);
    const timed: FastestRun<AIRunFailureKind> = fastestRun({
      run: (): AIRunFailureKind => {
        return classifyAIRunFailureMessage(providerWords).failureKind;
      },
      limitInMs: 1000,
    });

    expect(timed.inMs).toBeLessThan(1000);
  });

  test("a missing message is Other, never a crash", () => {
    expect(
      classifyAIRunFailureMessage(undefined as unknown as string).failureKind,
    ).toBe(AIRunFailureKind.Other);
  });
});

describe("the record's daily AI token limit as a failure kind (#7157)", () => {
  test("four kinds: incident or alert, paused or used up", () => {
    expect(RECORD_TOKEN_LIMIT_FAILURE_KINDS).toEqual([
      AIRunFailureKind.IncidentTokenLimitPaused,
      AIRunFailureKind.IncidentTokenLimitUsedUp,
      AIRunFailureKind.AlertTokenLimitPaused,
      AIRunFailureKind.AlertTokenLimitUsedUp,
    ]);

    for (const kind of Object.values(AIRunFailureKind)) {
      expect({ kind, isRecord: isRecordTokenLimitFailureKind(kind) }).toEqual({
        kind,
        isRecord: RECORD_TOKEN_LIMIT_FAILURE_KINDS.includes(kind),
      });
    }

    expect(isRecordTokenLimitFailureKind(null)).toBe(false);
    expect(isRecordTokenLimitFailureKind(undefined)).toBe(false);
    // The project's own daily AI limits are another setting.
    expect(isRecordTokenLimitFailureKind(AIRunFailureKind.LimitReached)).toBe(
      false,
    );
  });

  test("a stop reads as its kind", () => {
    expect(
      getRecordTokenLimitFailureKind({ kind: "incident", isPaused: true }),
    ).toBe(AIRunFailureKind.IncidentTokenLimitPaused);
    expect(
      getRecordTokenLimitFailureKind({ kind: "incident", isPaused: false }),
    ).toBe(AIRunFailureKind.IncidentTokenLimitUsedUp);
    expect(
      getRecordTokenLimitFailureKind({ kind: "alert", isPaused: true }),
    ).toBe(AIRunFailureKind.AlertTokenLimitPaused);
    expect(
      getRecordTokenLimitFailureKind({ kind: "alert", isPaused: false }),
    ).toBe(AIRunFailureKind.AlertTokenLimitUsedUp);
  });

  test("an attempt end that names one is read as written", () => {
    for (const failureKind of RECORD_TOKEN_LIMIT_FAILURE_KINDS) {
      expect(
        parseAIRunAttemptEnd({
          outcome: AIRunAttemptOutcome.GaveUp,
          failureKind,
          attempt: 1,
          maxAttempts: 3,
        })?.failureKind,
      ).toBe(failureKind);
    }
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

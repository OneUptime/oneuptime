import AIRunRetryPolicy, {
  AIRunRetryDecision,
} from "../../../../Server/Utils/AI/AIRunRetryPolicy";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../../Types/AI/AIRunAttempt";
import { AI_AUTO_RECHARGE_FAILED_MESSAGE } from "../../../../Server/Services/AIService";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../../Utils/Project/ProjectBalance";
import { describe, expect, test } from "@jest/globals";

/*
 * AIRunRetryPolicy decides when a durable AI run is tried again by itself
 * (issues #6437, #6438). The customer's triage failed with the message
 * below three times over and could not be tried again; these pin what the
 * policy says about that failure and every other kind.
 */

const CUSTOMER_TIMEOUT: string =
  "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.";

// A stand-in for LLMProviderHTTPException: what the policy reads is statusCode.
class ProviderAnswer extends Error {
  public statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

describe("AIRunRetryPolicy.classifyFailure", () => {
  test("the customer's timeout is a provider timeout, with the timeout it missed", () => {
    expect(
      AIRunRetryPolicy.classifyFailure({ message: CUSTOMER_TIMEOUT }),
    ).toEqual({
      failureKind: AIRunFailureKind.ProviderTimeout,
      timeoutInSeconds: 120,
    });
  });

  test("an Error's own message is read when no message is given", () => {
    expect(
      AIRunRetryPolicy.classifyFailure({
        error: new Error(CUSTOMER_TIMEOUT),
      }).failureKind,
    ).toBe(AIRunFailureKind.ProviderTimeout);
  });

  test.each([
    [429, AIRunFailureKind.ProviderUnavailable],
    [500, AIRunFailureKind.ProviderUnavailable],
    [502, AIRunFailureKind.ProviderUnavailable],
    [503, AIRunFailureKind.ProviderUnavailable],
    [408, AIRunFailureKind.ProviderTimeout],
    [400, AIRunFailureKind.ProviderRejected],
    [401, AIRunFailureKind.ProviderRejected],
    [403, AIRunFailureKind.ProviderRejected],
    [404, AIRunFailureKind.ProviderRejected],
  ])(
    "a provider answer with status %s is %s",
    (statusCode: number, expected: AIRunFailureKind) => {
      expect(
        AIRunRetryPolicy.classifyFailure({
          error: new ProviderAnswer(
            'OpenAI API error: {"error":{"message":"nope"}}',
            statusCode,
          ),
        }).failureKind,
      ).toBe(expected);
    },
  );

  test("the words win over the status code when they say more", () => {
    // A context window too small is a 400 too, and no retry gets past it.
    expect(
      AIRunRetryPolicy.classifyFailure({
        error: new ProviderAnswer(
          "Ollama API error: the request is larger than the model's context window",
          400,
        ),
      }).failureKind,
    ).toBe(AIRunFailureKind.ContextWindow);
  });

  test("a status code outside HTTP's is not read", () => {
    expect(
      AIRunRetryPolicy.classifyFailure({
        error: new ProviderAnswer("something odd", 42),
      }).failureKind,
    ).toBe(AIRunFailureKind.Other);
  });

  test("nothing at all is Other", () => {
    expect(AIRunRetryPolicy.classifyFailure({}).failureKind).toBe(
      AIRunFailureKind.Other,
    );
  });
});

describe("AIRunRetryPolicy attempts and waits", () => {
  test("a provider failure gets three attempts, any other two, a permanent one", () => {
    expect(
      AIRunRetryPolicy.getMaxAttempts(AIRunFailureKind.ProviderTimeout),
    ).toBe(3);
    expect(
      AIRunRetryPolicy.getMaxAttempts(AIRunFailureKind.ProviderUnavailable),
    ).toBe(3);
    expect(AIRunRetryPolicy.getMaxAttempts(AIRunFailureKind.Other)).toBe(2);
    expect(
      AIRunRetryPolicy.getMaxAttempts(AIRunFailureKind.ServerStopped),
    ).toBe(2);

    for (const kind of [
      AIRunFailureKind.ProviderRejected,
      AIRunFailureKind.ContextWindow,
      AIRunFailureKind.NotConfigured,
      AIRunFailureKind.LimitReached,
      AIRunFailureKind.CreditsUsedUp,
      // The record's own daily AI token limit (#7157): no repeat gets past it.
      AIRunFailureKind.IncidentTokenLimitPaused,
      AIRunFailureKind.IncidentTokenLimitUsedUp,
      AIRunFailureKind.AlertTokenLimitPaused,
      AIRunFailureKind.AlertTokenLimitUsedUp,
    ]) {
      expect(AIRunRetryPolicy.isPermanent(kind)).toBe(true);
      expect(AIRunRetryPolicy.getMaxAttempts(kind)).toBe(1);
    }
  });

  test("the wait is a minute after the first attempt and five after the second, and stays at five", () => {
    const middle: () => number = (): number => {
      return 0.5;
    };

    expect(AIRunRetryPolicy.getRetryDelayInMs(1, middle)).toBe(60 * 1000);
    expect(AIRunRetryPolicy.getRetryDelayInMs(2, middle)).toBe(5 * 60 * 1000);
    expect(AIRunRetryPolicy.getRetryDelayInMs(7, middle)).toBe(5 * 60 * 1000);
    // An attempt below one is read as the first.
    expect(AIRunRetryPolicy.getRetryDelayInMs(0, middle)).toBe(60 * 1000);
  });

  test("each wait moves by at most a fifth either way", () => {
    expect(
      AIRunRetryPolicy.getRetryDelayInMs(1, () => {
        return 0;
      }),
    ).toBe(48 * 1000);
    expect(
      AIRunRetryPolicy.getRetryDelayInMs(1, () => {
        return 0.999999;
      }),
    ).toBeLessThanOrEqual(72 * 1000);
    expect(
      AIRunRetryPolicy.getRetryDelayInMs(2, () => {
        return 0;
      }),
    ).toBe(240 * 1000);

    for (let i: number = 0; i < 50; i++) {
      const delay: number = AIRunRetryPolicy.getRetryDelayInMs(2);
      expect(delay).toBeGreaterThanOrEqual(240 * 1000);
      expect(delay).toBeLessThanOrEqual(360 * 1000);
    }
  });
});

describe("AIRunRetryPolicy.decide", () => {
  const middle: () => number = (): number => {
    return 0.5;
  };

  test("the customer's timeout is tried again after a minute, then after five, then given up", () => {
    const first: AIRunRetryDecision = AIRunRetryPolicy.decide({
      message: CUSTOMER_TIMEOUT,
      attempt: 1,
      random: middle,
    });

    expect(first).toEqual({
      shouldRetry: true,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 1,
      maxAttempts: 3,
      delayInMs: 60 * 1000,
      timeoutInSeconds: 120,
    });

    const second: AIRunRetryDecision = AIRunRetryPolicy.decide({
      message: CUSTOMER_TIMEOUT,
      attempt: 2,
      random: middle,
    });

    expect(second.shouldRetry).toBe(true);
    expect(second.delayInMs).toBe(5 * 60 * 1000);

    const third: AIRunRetryDecision = AIRunRetryPolicy.decide({
      message: CUSTOMER_TIMEOUT,
      attempt: 3,
      random: middle,
    });

    expect(third).toEqual({
      shouldRetry: false,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 3,
      maxAttempts: 3,
      delayInMs: 0,
      timeoutInSeconds: 120,
    });
  });

  test("any other failure is tried once more, as it always was", () => {
    expect(
      AIRunRetryPolicy.decide({ message: "boom", attempt: 1, random: middle }),
    ).toMatchObject({ shouldRetry: true, maxAttempts: 2, delayInMs: 60000 });
    expect(
      AIRunRetryPolicy.decide({ message: "boom", attempt: 2, random: middle }),
    ).toMatchObject({ shouldRetry: false, maxAttempts: 2, delayInMs: 0 });
  });

  test("a refused key is not tried again, and says it was tried once", () => {
    expect(
      AIRunRetryPolicy.decide({
        error: new ProviderAnswer("OpenAI API error: invalid_api_key", 401),
        attempt: 1,
      }),
    ).toEqual({
      shouldRetry: false,
      failureKind: AIRunFailureKind.ProviderRejected,
      attempt: 1,
      maxAttempts: 1,
      delayInMs: 0,
    });
  });

  test("the caller's word that no repeat can help is final", () => {
    expect(
      AIRunRetryPolicy.decide({
        message: CUSTOMER_TIMEOUT,
        attempt: 1,
        isPermanent: true,
      }).shouldRetry,
    ).toBe(false);
  });

  test("an attempt that may have changed something is never started over", () => {
    const decision: AIRunRetryDecision = AIRunRetryPolicy.decide({
      message: CUSTOMER_TIMEOUT,
      attempt: 1,
      mayHaveChangedSomething: true,
    });

    expect(decision.shouldRetry).toBe(false);
    expect(decision.maxAttempts).toBe(1);
  });

  test("an attempt below one is read as the first", () => {
    expect(
      AIRunRetryPolicy.decide({ message: "boom", attempt: 0, random: middle })
        .attempt,
    ).toBe(1);
  });
});

describe("AIRunRetryPolicy.toAttemptEnd", () => {
  test("a retry says when the next attempt is due", () => {
    const nextAttemptAt: Date = new Date("2026-11-09T14:05:00.000Z");
    const attemptEnd: AIRunAttemptEnd = AIRunRetryPolicy.toAttemptEnd(
      AIRunRetryPolicy.decide({
        message: CUSTOMER_TIMEOUT,
        attempt: 1,
        random: () => {
          return 0.5;
        },
      }),
      nextAttemptAt,
    );

    expect(attemptEnd).toEqual({
      outcome: AIRunAttemptOutcome.WillRetry,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: "2026-11-09T14:05:00.000Z",
      timeoutInSeconds: 120,
    });
  });

  test("giving up says how many attempts were made, and no next one", () => {
    const attemptEnd: AIRunAttemptEnd = AIRunRetryPolicy.toAttemptEnd(
      AIRunRetryPolicy.decide({ message: "boom", attempt: 2 }),
      new Date(),
    );

    expect(attemptEnd).toEqual({
      outcome: AIRunAttemptOutcome.GaveUp,
      failureKind: AIRunFailureKind.Other,
      attempt: 2,
      maxAttempts: 2,
    });
  });
});

/*
 * The project's AI credits used up, in the words the server fails a run
 * with: no attempt gets past them until someone adds credits, so the run
 * is not tried again (and its notice names who can add them).
 */
describe("AIRunRetryPolicy and used-up AI credits", () => {
  test.each([
    ["the shared refusal", PROJECT_AI_CREDITS_USED_UP_MESSAGE],
    ["auto-recharge that could not add more", AI_AUTO_RECHARGE_FAILED_MESSAGE],
  ])("%s is used-up credits, tried once", (_name: string, message: string) => {
    const failure: { failureKind: AIRunFailureKind } =
      AIRunRetryPolicy.classifyFailure({ error: new Error(message) });

    expect(failure.failureKind).toBe(AIRunFailureKind.CreditsUsedUp);
    expect(AIRunRetryPolicy.isPermanent(failure.failureKind)).toBe(true);
    expect(AIRunRetryPolicy.getMaxAttempts(failure.failureKind)).toBe(1);
  });

  test("the provider's own quota, even as a 429, is a refusal no retry gets past", () => {
    const quota: Error & { statusCode?: number } = new Error(
      "429 You exceeded your current quota, please check your plan and billing details.",
    );
    quota.statusCode = 429;

    expect(AIRunRetryPolicy.classifyFailure({ error: quota }).failureKind).toBe(
      AIRunFailureKind.ProviderRejected,
    );
  });
});

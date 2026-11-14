import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
  classifyAIRunFailureMessage,
} from "../../../Types/AI/AIRunAttempt";

/*
 * When a durable AI run is tried again by itself, and when it is not
 * (issues #6437, #6438). The one place that decides it: the investigation
 * queue (InvestigationQueue.failOrRequeue) asks it for every failed attempt
 * of an incident's or alert's investigation, an AI insight's triage, a
 * security case's triage and a remediation's plan or round, and any other
 * queue of AI runs should ask it too.
 *
 * Two layers of retry, each for what it is good at:
 *
 *  - One model call: LLMService retries a failed call up to ten times,
 *    backed off up to eight seconds, within a deadline of five minutes (or
 *    three response timeouts). That rides out a blip - a 429, a dropped
 *    connection, a cold model - without the run noticing.
 *  - One run: when a call still fails after that, the provider is down,
 *    overloaded or too slow for now. Running the attempt again at once
 *    would only fail the same way, so the run waits - a minute, then five -
 *    and starts again from the top. A provider failure gets three attempts
 *    in all; any other failure a repeat could fix gets two, as it always
 *    had.
 *
 * Never tried again by itself:
 *
 *  - a failure no repeat can get past: the provider refused the request
 *    (its key, its model, its access), the request no longer fits in the
 *    model's context window, there is no provider, or a limit was reached -
 *    the project's daily AI limits, or the incident's or alert's own daily
 *    AI token limit, which a limit of 0 pauses. The run fails at once and
 *    says why, and Try again is there once the cause is fixed;
 *  - an attempt its caller says may have changed something outside
 *    OneUptime (mayHaveChangedSomething): starting it again from the top
 *    could do it a second time, so it fails instead, for a person to look
 *    at. A remediation round is not one: it records every command before
 *    the command runs, and an attempt that finds commands recorded settles
 *    what they did instead of running the round again
 *    (RemediationExecutionRunner's interrupted-execution check).
 */

export interface AIRunRetryDecision {
  shouldRetry: boolean;
  failureKind: AIRunFailureKind;
  // The attempt that failed, counted from 1 (hand-backs do not count).
  attempt: number;
  // How many attempts this kind of failure gets in all.
  maxAttempts: number;
  // How long to wait before the next attempt, when there is one.
  delayInMs: number;
  // ProviderTimeout: the response timeout the provider missed, in seconds.
  timeoutInSeconds?: number | undefined;
}

export default class AIRunRetryPolicy {
  /*
   * A provider that is down, overloaded or too slow: three attempts, the
   * last more than six minutes after the first failed, which outlasts most
   * provider incidents without keeping a run in the queue past its use.
   */
  public static readonly PROVIDER_FAILURE_MAX_ATTEMPTS: number = 3;

  // Any other failure a repeat could fix: two attempts, as there always were.
  public static readonly OTHER_FAILURE_MAX_ATTEMPTS: number = 2;

  // The wait before the second attempt, and before the third.
  public static readonly RETRY_DELAYS_IN_MS: ReadonlyArray<number> = [
    60 * 1000,
    5 * 60 * 1000,
  ];

  /*
   * Each wait is moved by up to a fifth either way, so the runs a provider
   * outage failed together do not all hit it again in the same second.
   */
  public static readonly RETRY_JITTER_RATIO: number = 0.2;

  // The kinds of failure no repeat can get past.
  private static readonly PERMANENT_FAILURE_KINDS: ReadonlyArray<AIRunFailureKind> =
    [
      AIRunFailureKind.ProviderRejected,
      AIRunFailureKind.ContextWindow,
      AIRunFailureKind.NotConfigured,
      AIRunFailureKind.LimitReached,
      AIRunFailureKind.CreditsUsedUp,
      /*
       * An incident's or alert's own daily AI token limit: paused until
       * someone raises it, or used up until midnight UTC.
       */
      AIRunFailureKind.IncidentTokenLimitPaused,
      AIRunFailureKind.IncidentTokenLimitUsedUp,
      AIRunFailureKind.AlertTokenLimitPaused,
      AIRunFailureKind.AlertTokenLimitUsedUp,
    ];

  // The kinds of failure that are the provider's: down, overloaded, slow.
  private static readonly PROVIDER_FAILURE_KINDS: ReadonlyArray<AIRunFailureKind> =
    [AIRunFailureKind.ProviderTimeout, AIRunFailureKind.ProviderUnavailable];

  /*
   * What kind of failure an error is. A provider's HTTP answer carries its
   * status code (LLMProviderHTTPException): a 429 or a 5xx is the provider
   * being unavailable, any other 4xx a refusal of the request - unless the
   * words say more (a context window too small is a 400 too). Everything
   * else is told by its words (classifyAIRunFailureMessage).
   */
  public static classifyFailure(data: {
    error?: unknown;
    message?: string | undefined;
  }): { failureKind: AIRunFailureKind; timeoutInSeconds?: number | undefined } {
    const message: string =
      data.message ??
      (data.error instanceof Error
        ? data.error.message
        : data.error === undefined
          ? ""
          : String(data.error));

    const byWords: {
      failureKind: AIRunFailureKind;
      timeoutInSeconds?: number | undefined;
    } = classifyAIRunFailureMessage(message);

    const statusCode: number | undefined = this.readStatusCode(data.error);

    if (
      statusCode === undefined ||
      byWords.failureKind !== AIRunFailureKind.Other
    ) {
      return byWords;
    }

    if (statusCode === 429 || statusCode >= 500) {
      return { failureKind: AIRunFailureKind.ProviderUnavailable };
    }

    if (statusCode === 408) {
      return { failureKind: AIRunFailureKind.ProviderTimeout };
    }

    if (statusCode >= 400) {
      return { failureKind: AIRunFailureKind.ProviderRejected };
    }

    return byWords;
  }

  // Whether no repeat can get past a failure of this kind.
  public static isPermanent(failureKind: AIRunFailureKind): boolean {
    return this.PERMANENT_FAILURE_KINDS.includes(failureKind);
  }

  // How many attempts a run gets in all for a failure of this kind.
  public static getMaxAttempts(failureKind: AIRunFailureKind): number {
    if (this.isPermanent(failureKind)) {
      return 1;
    }

    return this.PROVIDER_FAILURE_KINDS.includes(failureKind)
      ? this.PROVIDER_FAILURE_MAX_ATTEMPTS
      : this.OTHER_FAILURE_MAX_ATTEMPTS;
  }

  /*
   * How long to wait after the given attempt failed before the next one:
   * the attempt's step of RETRY_DELAYS_IN_MS (the last step for any later
   * attempt), moved by up to RETRY_JITTER_RATIO either way.
   */
  public static getRetryDelayInMs(
    attempt: number,
    random: () => number = Math.random,
  ): number {
    const delays: ReadonlyArray<number> = this.RETRY_DELAYS_IN_MS;
    const index: number = Math.min(
      Math.max(Math.floor(attempt), 1) - 1,
      delays.length - 1,
    );
    const baseDelayInMs: number = delays[index]!;
    const jitterInMs: number =
      baseDelayInMs * this.RETRY_JITTER_RATIO * (random() * 2 - 1);

    return Math.max(0, Math.round(baseDelayInMs + jitterInMs));
  }

  /*
   * Whether a failed attempt is tried again by itself, and when. `attempt`
   * is the attempt that failed, counted without the claims a server
   * shutting down handed back. `isPermanent` is the caller's own word that
   * no repeat can help (the investigation engine's, for instance), and
   * `mayHaveChangedSomething` that the attempt may have changed something
   * outside OneUptime, so starting it over could do it twice.
   */
  public static decide(data: {
    error?: unknown;
    message?: string | undefined;
    attempt: number;
    isPermanent?: boolean | undefined;
    mayHaveChangedSomething?: boolean | undefined;
    random?: (() => number) | undefined;
  }): AIRunRetryDecision {
    const classified: {
      failureKind: AIRunFailureKind;
      timeoutInSeconds?: number | undefined;
    } = this.classifyFailure({ error: data.error, message: data.message });

    const attempt: number = Math.max(Math.floor(data.attempt), 1);
    const isPermanent: boolean =
      data.isPermanent === true || this.isPermanent(classified.failureKind);

    const shouldRetry: boolean =
      !isPermanent &&
      data.mayHaveChangedSomething !== true &&
      attempt < this.getMaxAttempts(classified.failureKind);

    return {
      shouldRetry,
      failureKind: classified.failureKind,
      attempt,
      // A run that is not tried again got as many attempts as it made.
      maxAttempts: shouldRetry
        ? this.getMaxAttempts(classified.failureKind)
        : attempt,
      delayInMs: shouldRetry ? this.getRetryDelayInMs(attempt, data.random) : 0,
      ...(classified.timeoutInSeconds !== undefined
        ? { timeoutInSeconds: classified.timeoutInSeconds }
        : {}),
    };
  }

  // How the attempt ended, for its AttemptEnded or RunFailed event.
  public static toAttemptEnd(
    decision: AIRunRetryDecision,
    nextAttemptAt?: Date | undefined,
  ): AIRunAttemptEnd {
    return {
      outcome: decision.shouldRetry
        ? AIRunAttemptOutcome.WillRetry
        : AIRunAttemptOutcome.GaveUp,
      failureKind: decision.failureKind,
      attempt: decision.attempt,
      maxAttempts: decision.maxAttempts,
      ...(decision.shouldRetry && nextAttemptAt
        ? { nextAttemptAt: nextAttemptAt.toISOString() }
        : {}),
      ...(decision.timeoutInSeconds !== undefined
        ? { timeoutInSeconds: decision.timeoutInSeconds }
        : {}),
    };
  }

  private static readStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const statusCode: unknown = (error as { statusCode?: unknown }).statusCode;

    return typeof statusCode === "number" &&
      Number.isInteger(statusCode) &&
      statusCode >= 100 &&
      statusCode < 600
      ? statusCode
      : undefined;
  }
}

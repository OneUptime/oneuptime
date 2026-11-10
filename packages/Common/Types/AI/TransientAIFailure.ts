/*
 * WHETHER AN AI FAILURE IS WORTH TRYING AGAIN BY ITSELF - the one place
 * that decides it, for every AI feature that retries on its own: a code
 * task's turn (CodeFixAutoRetry) today, and any other AI run that wants the
 * same answer.
 *
 * A failure is transient when trying the same thing again a little later
 * can work: the AI model provider was busy or briefly down (429, 5xx,
 * "overloaded"), a call timed out, the network dropped, or the Runner doing
 * the work went away. Anything that will fail the same way again - a key
 * the provider refuses, no credits or quota, a request too long for the
 * model, a budget or limit reached, a content refusal - is not, and fails
 * at once with its own next step.
 *
 * Only the start of the text is read (MAX_FAILURE_TEXT_READ), lowercased,
 * with indexOf - never a regular expression - so a long message from a
 * provider or a Runner cannot make it slow.
 */

export enum TransientAIFailureKind {
  // 429, "rate limit", "too many requests".
  RateLimited = "RateLimited",
  // 5xx, "overloaded", "service unavailable", or the call failed outright.
  ProviderUnavailable = "ProviderUnavailable",
  // A call took too long.
  TimedOut = "TimedOut",
  // The connection dropped or was refused.
  NetworkError = "NetworkError",
  // The Runner working on it stopped reporting (it restarted or crashed).
  RunnerWentAway = "RunnerWentAway",
}

// How much of a failure's text is read.
export const MAX_FAILURE_TEXT_READ: number = 2000;

/*
 * Words that say the same request will fail again: they win over any sign
 * of a transient failure in the same text ("429 insufficient_quota" is
 * billing, not a busy provider).
 */
const LASTING_SIGNS: ReadonlyArray<string> = [
  "insufficient_quota",
  "insufficient quota",
  "quota exceeded",
  "exceeded your current quota",
  "billing",
  "credit",
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "api key not valid",
  "authentication",
  "unauthorized",
  "permission denied",
  "forbidden",
  "context length",
  "context_length",
  "maximum context",
  "too many tokens",
  "prompt is too long",
  "content policy",
  "content_filter",
  "budget",
  "daily limit",
  /*
   * A run that reached one of its own limits (Types/AI/AIAgentRunLimits,
   * getRefusal): its number is the project's ("500 model calls"), not a
   * status code, and a run tried again starts at the same limit.
   */
  "time limit",
  "per run",
  "may make no more",
  "model not found",
  "does not exist",
  "not supported",
  "was stopped",
];

// HTTP statuses that say the same request will fail again.
const LASTING_STATUS_CODES: ReadonlyArray<string> = [
  "400",
  "401",
  "402",
  "403",
  "404",
  "413",
  "422",
];

const TRANSIENT_SIGNS: ReadonlyArray<{
  kind: TransientAIFailureKind;
  words: ReadonlyArray<string>;
  statusCodes: ReadonlyArray<string>;
}> = [
  {
    kind: TransientAIFailureKind.RateLimited,
    words: ["rate limit", "rate_limit", "ratelimit", "too many requests"],
    statusCodes: ["429"],
  },
  {
    kind: TransientAIFailureKind.TimedOut,
    words: [
      "timed out",
      "timeout",
      "etimedout",
      "esockettimedout",
      "deadline exceeded",
    ],
    statusCodes: ["408"],
  },
  {
    kind: TransientAIFailureKind.NetworkError,
    words: [
      "econnreset",
      "econnrefused",
      "eai_again",
      "socket hang up",
      "network error",
      "fetch failed",
      "connection reset",
      "connection closed",
      "connection refused",
      /*
       * What a Runner's code agent says when a model call got no answer
       * from the OneUptime server at all (Runner/Utils/LlmCompletionError).
       */
      "could not be reached",
    ],
    statusCodes: [],
  },
  {
    kind: TransientAIFailureKind.RunnerWentAway,
    words: ["stopped reporting progress"],
    statusCodes: [],
  },
  {
    kind: TransientAIFailureKind.ProviderUnavailable,
    words: [
      "overloaded",
      "service unavailable",
      "bad gateway",
      "gateway timeout",
      "internal server error",
      "server_error",
      "server error",
      "server had an error",
      "upstream connect error",
      "temporarily unavailable",
      "try again later",
      // What a Runner says when the server could not reach the provider.
      "llm completion request failed",
    ],
    statusCodes: ["500", "502", "503", "504", "529"],
  },
];

export default class TransientAIFailure {
  /*
   * The kind of transient failure the text describes, or null when it is
   * not one (or says nothing): then it fails at once.
   */
  public static classify(
    message: string | null | undefined,
  ): TransientAIFailureKind | null {
    const text: string = TransientAIFailure.readText(message);

    if (!text) {
      return null;
    }

    for (const sign of LASTING_SIGNS) {
      if (text.indexOf(sign) >= 0) {
        return null;
      }
    }

    for (const code of LASTING_STATUS_CODES) {
      if (TransientAIFailure.hasStatusCode(text, code)) {
        return null;
      }
    }

    for (const sign of TRANSIENT_SIGNS) {
      for (const word of sign.words) {
        if (text.indexOf(word) >= 0) {
          return sign.kind;
        }
      }

      for (const code of sign.statusCodes) {
        if (TransientAIFailure.hasStatusCode(text, code)) {
          return sign.kind;
        }
      }
    }

    return null;
  }

  public static isTransient(message: string | null | undefined): boolean {
    return TransientAIFailure.classify(message) !== null;
  }

  public static isKind(value: unknown): value is TransientAIFailureKind {
    return (
      typeof value === "string" &&
      (Object.values(TransientAIFailureKind) as Array<string>).includes(value)
    );
  }

  private static readText(message: string | null | undefined): string {
    if (typeof message !== "string") {
      return "";
    }

    return message.substring(0, MAX_FAILURE_TEXT_READ).toLowerCase();
  }

  /*
   * Whether the three digits stand on their own in the text: "503" in
   * "status 503" or "(503)", never in "15030 tokens" or "v5.0.3".
   */
  private static hasStatusCode(text: string, code: string): boolean {
    let from: number = 0;

    while (from <= text.length - code.length) {
      const index: number = text.indexOf(code, from);

      if (index < 0) {
        return false;
      }

      const before: string = index > 0 ? text.charAt(index - 1) : "";
      const after: string = text.charAt(index + code.length);
      const afterNext: string = text.charAt(index + code.length + 1);
      // A sentence may end on it ("status 503."); a version may not ("5.03.1").
      const isPartOfNumber: boolean =
        TransientAIFailure.isDigit(before) ||
        before === "." ||
        TransientAIFailure.isDigit(after) ||
        (after === "." && TransientAIFailure.isDigit(afterNext));

      if (!isPartOfNumber) {
        return true;
      }

      from = index + 1;
    }

    return false;
  }

  private static isDigit(character: string): boolean {
    return character.length === 1 && character >= "0" && character <= "9";
  }
}

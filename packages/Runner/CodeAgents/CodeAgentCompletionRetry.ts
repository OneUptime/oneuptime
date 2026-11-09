import AIRunRetryPolicy, {
  AIRunRetryDecision,
} from "Common/Server/Utils/AI/AIRunRetryPolicy";
import { AIRunFailureKind } from "Common/Types/AI/AIRunAttempt";

/*
 * Whether a failed model call of the code agent is made again, and when
 * (issue #6441). A task used to fail on the first call that failed - a
 * provider overloaded for a minute, the OneUptime server restarting under
 * it - throwing away everything it had done. Now each call is judged by the
 * rule every durable AI run follows (AIRunRetryPolicy):
 *
 *   - a provider that is down, overloaded or too slow, or a server that
 *     could not be reached: the call is made again after a minute, then
 *     after five (three attempts in all), the run kept alive meanwhile;
 *   - any other failure a repeat could fix: once more, after a minute;
 *   - a failure no repeat gets past - the provider refused the request, a
 *     limit of the run or the project was reached, the run is no longer
 *     running: the task fails at once and says why.
 *
 * Only the model call is made again: it changes nothing, and no tool runs
 * twice. A conversation too long for the model's context window is not
 * waited out either: the agent cuts it (CodeAgentContext) and asks again
 * at once.
 */
export default class CodeAgentCompletionRetry {
  public static decide(data: {
    error: unknown;
    attempt: number;
  }): AIRunRetryDecision {
    return AIRunRetryPolicy.decide({
      error: data.error,
      attempt: data.attempt,
      // A model call changes nothing outside OneUptime: it is safe to repeat.
      mayHaveChangedSomething: false,
    });
  }

  // The model server said the conversation does not fit in the model's window.
  public static isContextWindowError(error: unknown): boolean {
    return (
      AIRunRetryPolicy.classifyFailure({ error }).failureKind ===
      AIRunFailureKind.ContextWindow
    );
  }

  // A failure's words for the run's log, kept short.
  public static describeError(error: unknown): string {
    const message: string =
      error instanceof Error ? error.message : String(error);

    return message.length > 300 ? `${message.substring(0, 300)}...` : message;
  }

  /*
   * Wait `ms`, or less when the signal aborts (the task was aborted).
   * Replaceable in tests, which do not wait out real minutes.
   */
  public static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve: () => void): void => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      const onAbort: () => void = (): void => {
        clearTimeout(timer);
        resolve();
      };

      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

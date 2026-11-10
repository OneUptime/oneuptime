import { TransientAIFailureKind } from "./TransientAIFailure";

/*
 * TRYING A CODE TASK'S TURN AGAIN BY ITSELF.
 *
 * A turn that fails for a reason trying again can fix (TransientAIFailure:
 * the AI model provider busy or down, a timeout, the network, the Runner
 * going away) is queued again in place - the same turn, the same branch -
 * after a short wait, up to CODE_TASK_MAX_ATTEMPTS attempts in all. Only
 * when the last attempt fails too does the turn fail, and only then does
 * anything that waits for its end hear of it (a GitHub reply, the insight
 * it fixes). A turn that may already have pushed or opened something is
 * never tried again by itself (CodeFixAutoRetry).
 */

// Attempts in all: the first, and two more by itself.
export const CODE_TASK_MAX_ATTEMPTS: number = 3;

// How long to wait before each attempt after the first, in minutes.
export const CODE_TASK_RETRY_DELAYS_IN_MINUTES: ReadonlyArray<number> = [1, 4];

/*
 * How a turn stands with its attempts, for a turn that was tried again by
 * itself or waits to be: what "Retrying (attempt 2 of 3) in 4 min" says.
 */
export interface CodeTaskRetryJSON {
  // The attempt running or waiting to run: 2 is the first retry.
  attempt: number;
  maxAttempts: number;
  // When the next attempt starts, while it waits for it.
  nextAttemptAt?: string | undefined;
  // Why the attempt before failed, when it was read.
  kind?: TransientAIFailureKind | undefined;
  // What the attempt before failed with, as it was reported.
  reason?: string | undefined;
}

export default class CodeTaskRetry {
  /*
   * How long to wait before the next attempt, given how many times the
   * turn was tried again already (0 before the first retry).
   */
  public static getDelayInMinutes(retriesDone: number): number {
    const index: number = Math.max(
      0,
      Math.min(
        Math.floor(retriesDone),
        CODE_TASK_RETRY_DELAYS_IN_MINUTES.length - 1,
      ),
    );

    return CODE_TASK_RETRY_DELAYS_IN_MINUTES[index] || 1;
  }

  // Whether a turn tried again this many times may be tried once more.
  public static mayTryAgain(retriesDone: number): boolean {
    return Math.max(0, Math.floor(retriesDone)) + 1 < CODE_TASK_MAX_ATTEMPTS;
  }

  /*
   * How a turn stands with its attempts, or undefined for a turn that was
   * never tried again and does not wait to be.
   */
  public static describe(data: {
    retriesDone?: number | undefined;
    nextAttemptAt?: Date | string | undefined | null;
    isQueued: boolean;
    reason?: string | undefined | null;
    kind?: TransientAIFailureKind | null | undefined;
  }): CodeTaskRetryJSON | undefined {
    const retriesDone: number = Math.max(
      0,
      Math.floor(Number(data.retriesDone) || 0),
    );

    if (retriesDone === 0) {
      return undefined;
    }

    const json: CodeTaskRetryJSON = {
      attempt: Math.min(retriesDone + 1, CODE_TASK_MAX_ATTEMPTS),
      maxAttempts: CODE_TASK_MAX_ATTEMPTS,
    };

    if (data.isQueued && data.nextAttemptAt) {
      const nextAttemptAt: Date = new Date(data.nextAttemptAt);

      if (!Number.isNaN(nextAttemptAt.getTime())) {
        json.nextAttemptAt = nextAttemptAt.toISOString();
      }
    }

    if (data.kind) {
      json.kind = data.kind;
    }

    if (data.reason) {
      json.reason = data.reason;
    }

    return json;
  }
}

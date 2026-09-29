/*
 * How much of an AI run's remaining wall clock ONE kubectl command may
 * spend, end to end.
 *
 * A kubectl job is waited for in two windows: the claim window (a Runner
 * has to pick the job up) and the execution timeout (the command itself),
 * plus the poll loop's own slack. The agent loop that runs the model checks
 * its wall-clock budget only BETWEEN tool calls — it cannot interrupt a
 * tool — so without this planner a single run_kubectl issued near the end
 * of the budget could hold the run for claim + execution + slack past it.
 *
 * Pure and dependency-free like KubectlPolicy: the investigation toolkit
 * plans BEFORE it counts a command against its budget or enqueues anything,
 * and every number here is what the job runner then hands to the queue.
 *
 * Allocation, in priority order:
 *  1. Nothing runs unless the floors fit: a claim window of at least two
 *     Runner polls, one second of execution, and the poll loop's slack.
 *  2. Execution gets the time the caller asked for, capped by what is left
 *     after the claim floor — the command is what the model needs.
 *  3. The claim window gets what remains, up to its normal length. A
 *     healthy in-cluster Runner claims within one or two polls, so the full
 *     minute is only ever needed to tell "offline" from "busy".
 *
 * The invariant every plan satisfies: claim + execution + slack never
 * exceeds the time left until the deadline.
 */

// The toolkit's floor for a command's own execution timeout.
export const MIN_KUBECTL_TIMEOUT_MS: number = 1_000;

/*
 * Runners poll for work every ~5 s (ONEUPTIME_RUNNER_POLL_INTERVAL_MS), so
 * two polls is the shortest window that can tell a healthy Runner from an
 * offline one.
 */
export const MIN_KUBECTL_CLAIM_TIMEOUT_MS: number = 10_000;

/*
 * What waiting costs beyond the two windows: RunnerJobService.
 * pollUntilTerminal adds 5 s of its own slack to its overall deadline and
 * rounds the windows up to whole seconds; its poll interval adds up to
 * another half second before a terminal job is noticed.
 */
export const KUBECTL_WAIT_OVERHEAD_MS: number = 6_000;

export interface KubectlWaitPlan {
  // The execution timeout to enqueue and wait with.
  timeoutInMs: number;
  // The claim window to enqueue and wait with.
  claimTimeoutInMs: number;
  // True when the deadline shortened either window.
  isClamped: boolean;
  // Undefined when no deadline was given.
  remainingBudgetMs?: number | undefined;
}

export interface KubectlWaitRefusal {
  // What is left until the deadline; negative once it has passed.
  remainingBudgetMs: number;
  // The least a command can ever be given: both floors plus the overhead.
  minimumBudgetMs: number;
}

export type KubectlWaitBudgetResult =
  | { ok: true; plan: KubectlWaitPlan }
  | { ok: false; refusal: KubectlWaitRefusal };

export default class KubectlWaitBudget {
  public static getMinimumBudgetMs(): number {
    return (
      MIN_KUBECTL_CLAIM_TIMEOUT_MS +
      MIN_KUBECTL_TIMEOUT_MS +
      KUBECTL_WAIT_OVERHEAD_MS
    );
  }

  // The longest a wait planned with these windows can take.
  public static getWorstCaseWaitMs(plan: {
    timeoutInMs: number;
    claimTimeoutInMs: number;
  }): number {
    return plan.claimTimeoutInMs + plan.timeoutInMs + KUBECTL_WAIT_OVERHEAD_MS;
  }

  /*
   * Plan the windows for one command. `requestedTimeoutInMs` is what the
   * caller wants for execution (already clamped to its own bounds);
   * `maxClaimTimeoutInMs` is the normal claim window. Without a finite
   * deadline both are used as they are.
   */
  public static plan(data: {
    requestedTimeoutInMs: number;
    maxClaimTimeoutInMs: number;
    deadlineAtMs?: number | undefined;
    nowMs?: number | undefined;
  }): KubectlWaitBudgetResult {
    const requestedTimeoutInMs: number = Math.max(
      MIN_KUBECTL_TIMEOUT_MS,
      Math.floor(data.requestedTimeoutInMs),
    );
    const maxClaimTimeoutInMs: number = Math.max(
      MIN_KUBECTL_CLAIM_TIMEOUT_MS,
      Math.floor(data.maxClaimTimeoutInMs),
    );

    if (
      data.deadlineAtMs === undefined ||
      !Number.isFinite(data.deadlineAtMs)
    ) {
      return {
        ok: true,
        plan: {
          timeoutInMs: requestedTimeoutInMs,
          claimTimeoutInMs: maxClaimTimeoutInMs,
          isClamped: false,
        },
      };
    }

    const nowMs: number = data.nowMs ?? Date.now();
    const remainingBudgetMs: number = Math.floor(data.deadlineAtMs - nowMs);
    const minimumBudgetMs: number = KubectlWaitBudget.getMinimumBudgetMs();

    if (remainingBudgetMs < minimumBudgetMs) {
      return {
        ok: false,
        refusal: { remainingBudgetMs, minimumBudgetMs },
      };
    }

    // What the two windows may share once the poll loop's overhead is paid.
    const availableMs: number = remainingBudgetMs - KUBECTL_WAIT_OVERHEAD_MS;

    const timeoutInMs: number = Math.min(
      requestedTimeoutInMs,
      availableMs - MIN_KUBECTL_CLAIM_TIMEOUT_MS,
    );
    const claimTimeoutInMs: number = Math.min(
      maxClaimTimeoutInMs,
      availableMs - timeoutInMs,
    );

    return {
      ok: true,
      plan: {
        timeoutInMs,
        claimTimeoutInMs,
        isClamped:
          timeoutInMs < requestedTimeoutInMs ||
          claimTimeoutInMs < maxClaimTimeoutInMs,
        remainingBudgetMs,
      },
    };
  }
}

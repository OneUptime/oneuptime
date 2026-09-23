import KubectlWaitBudget, {
  KUBECTL_WAIT_OVERHEAD_MS,
  KubectlWaitBudgetResult,
  KubectlWaitPlan,
  MIN_KUBECTL_CLAIM_TIMEOUT_MS,
  MIN_KUBECTL_TIMEOUT_MS,
} from "../../../Utils/AiRemediation/KubectlWaitBudget";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the planner that keeps one kubectl command's wait
 * (claim window + execution timeout + poll slack) inside the AI run's
 * remaining wall clock:
 *  1. without a deadline the requested windows are used unchanged;
 *  2. with room to spare they are used unchanged too;
 *  3. as the deadline nears, execution keeps its request until the claim
 *     floor is threatened, and the claim window gives way first;
 *  4. below the floors the command is refused with the numbers a caller
 *     needs to explain why;
 *  5. whatever the inputs, claim + execution + overhead never exceeds the
 *     time left.
 */

const CLAIM_MS: number = 60_000;
const NOW_MS: number = 1_700_000_000_000;

function planWithRemaining(
  remainingMs: number,
  requestedTimeoutInMs: number,
): KubectlWaitBudgetResult {
  return KubectlWaitBudget.plan({
    requestedTimeoutInMs,
    maxClaimTimeoutInMs: CLAIM_MS,
    deadlineAtMs: NOW_MS + remainingMs,
    nowMs: NOW_MS,
  });
}

function expectPlan(result: KubectlWaitBudgetResult): KubectlWaitPlan {
  if (!result.ok) {
    throw new Error(
      `Expected a plan, got a refusal: ${JSON.stringify(result.refusal)}`,
    );
  }
  return result.plan;
}

describe("KubectlWaitBudget.plan", () => {
  it("uses the requested windows unchanged when there is no deadline", () => {
    const plan: KubectlWaitPlan = expectPlan(
      KubectlWaitBudget.plan({
        requestedTimeoutInMs: 30_000,
        maxClaimTimeoutInMs: CLAIM_MS,
      }),
    );

    expect(plan).toEqual({
      timeoutInMs: 30_000,
      claimTimeoutInMs: CLAIM_MS,
      isClamped: false,
    });
  });

  it.each([NaN, Infinity, -Infinity])(
    "treats a non-finite deadline (%s) as no deadline",
    (deadlineAtMs: number) => {
      const plan: KubectlWaitPlan = expectPlan(
        KubectlWaitBudget.plan({
          requestedTimeoutInMs: 30_000,
          maxClaimTimeoutInMs: CLAIM_MS,
          deadlineAtMs,
          nowMs: NOW_MS,
        }),
      );

      expect(plan.isClamped).toBe(false);
      expect(plan.timeoutInMs).toBe(30_000);
      expect(plan.claimTimeoutInMs).toBe(CLAIM_MS);
    },
  );

  it("leaves both windows alone while the budget has room for them", () => {
    const plan: KubectlWaitPlan = expectPlan(
      planWithRemaining(150_000, 30_000),
    );

    expect(plan.timeoutInMs).toBe(30_000);
    expect(plan.claimTimeoutInMs).toBe(CLAIM_MS);
    expect(plan.isClamped).toBe(false);
    expect(plan.remainingBudgetMs).toBe(150_000);
  });

  it("is exact at the boundary where the full windows just fit", () => {
    const exactFit: number = CLAIM_MS + 30_000 + KUBECTL_WAIT_OVERHEAD_MS;

    const fits: KubectlWaitPlan = expectPlan(
      planWithRemaining(exactFit, 30_000),
    );
    expect(fits.isClamped).toBe(false);
    expect(fits.claimTimeoutInMs).toBe(CLAIM_MS);

    const clipped: KubectlWaitPlan = expectPlan(
      planWithRemaining(exactFit - 1, 30_000),
    );
    expect(clipped.isClamped).toBe(true);
    expect(clipped.timeoutInMs).toBe(30_000);
    expect(clipped.claimTimeoutInMs).toBe(CLAIM_MS - 1);
  });

  it("shortens the claim window first and keeps the requested execution time", () => {
    // 80 s left: execution keeps its 30 s, the claim window shrinks to fit.
    const plan: KubectlWaitPlan = expectPlan(planWithRemaining(80_000, 30_000));

    expect(plan.timeoutInMs).toBe(30_000);
    expect(plan.claimTimeoutInMs).toBe(
      80_000 - KUBECTL_WAIT_OVERHEAD_MS - 30_000,
    );
    expect(plan.isClamped).toBe(true);
  });

  it("clamps a maximal execution request once the claim floor is threatened", () => {
    // The finding's scenario: 120 s asked for with well under that left.
    const remaining: number = 40_000;
    const plan: KubectlWaitPlan = expectPlan(
      planWithRemaining(remaining, 120_000),
    );

    expect(plan.claimTimeoutInMs).toBe(MIN_KUBECTL_CLAIM_TIMEOUT_MS);
    expect(plan.timeoutInMs).toBe(
      remaining - KUBECTL_WAIT_OVERHEAD_MS - MIN_KUBECTL_CLAIM_TIMEOUT_MS,
    );
    expect(plan.isClamped).toBe(true);
    expect(KubectlWaitBudget.getWorstCaseWaitMs(plan)).toBeLessThanOrEqual(
      remaining,
    );
  });

  it("gives the floors exactly when only the minimum budget is left", () => {
    const plan: KubectlWaitPlan = expectPlan(
      planWithRemaining(KubectlWaitBudget.getMinimumBudgetMs(), 120_000),
    );

    expect(plan.timeoutInMs).toBe(MIN_KUBECTL_TIMEOUT_MS);
    expect(plan.claimTimeoutInMs).toBe(MIN_KUBECTL_CLAIM_TIMEOUT_MS);
    expect(KubectlWaitBudget.getWorstCaseWaitMs(plan)).toBe(
      KubectlWaitBudget.getMinimumBudgetMs(),
    );
  });

  it.each([
    ["one millisecond under the minimum", -1],
    ["ten seconds", -KubectlWaitBudget.getMinimumBudgetMs() + 10_000],
    ["nothing", -KubectlWaitBudget.getMinimumBudgetMs()],
    [
      "a deadline already passed",
      -KubectlWaitBudget.getMinimumBudgetMs() - 5_000,
    ],
  ])(
    "refuses when %s is left, reporting what is left and what is needed",
    (_label: string, offsetFromMinimum: number) => {
      const remaining: number =
        KubectlWaitBudget.getMinimumBudgetMs() + offsetFromMinimum;
      const result: KubectlWaitBudgetResult = planWithRemaining(
        remaining,
        1_000,
      );

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.refusal).toEqual({
        remainingBudgetMs: remaining,
        minimumBudgetMs: KubectlWaitBudget.getMinimumBudgetMs(),
      });
    },
  );

  it("never lets the requested timeout fall below the execution floor", () => {
    const plan: KubectlWaitPlan = expectPlan(
      KubectlWaitBudget.plan({
        requestedTimeoutInMs: 0,
        maxClaimTimeoutInMs: CLAIM_MS,
      }),
    );

    expect(plan.timeoutInMs).toBe(MIN_KUBECTL_TIMEOUT_MS);
  });

  it("never lets the claim window fall below the claim floor", () => {
    const plan: KubectlWaitPlan = expectPlan(
      KubectlWaitBudget.plan({
        requestedTimeoutInMs: 30_000,
        maxClaimTimeoutInMs: 1_000,
        deadlineAtMs: NOW_MS + 150_000,
        nowMs: NOW_MS,
      }),
    );

    expect(plan.claimTimeoutInMs).toBe(MIN_KUBECTL_CLAIM_TIMEOUT_MS);
  });

  it("defaults the clock to now", () => {
    const before: number = Date.now();
    const result: KubectlWaitBudgetResult = KubectlWaitBudget.plan({
      requestedTimeoutInMs: 30_000,
      maxClaimTimeoutInMs: CLAIM_MS,
      deadlineAtMs: before + 150_000,
    });

    const plan: KubectlWaitPlan = expectPlan(result);
    expect(plan.remainingBudgetMs).toBeLessThanOrEqual(150_000);
    expect(plan.remainingBudgetMs).toBeGreaterThan(140_000);
  });

  /*
   * The invariant behind the finding: whatever is asked for and whatever is
   * left, a planned wait ends before the deadline — or is refused.
   */
  it("keeps claim + execution + overhead within the remaining budget for every input", () => {
    const remainings: Array<number> = [
      -10_000, 0, 5_000, 16_999, 17_000, 17_001, 20_000, 30_000, 45_000, 60_000,
      75_000, 96_000, 100_000, 125_000, 150_000, 186_000, 200_000, 600_000,
    ];
    const requests: Array<number> = [
      1_000, 5_000, 29_999, 30_000, 60_000, 90_000, 119_999, 120_000,
    ];

    let plans: number = 0;
    let refusals: number = 0;

    for (const remaining of remainings) {
      for (const requested of requests) {
        const result: KubectlWaitBudgetResult = planWithRemaining(
          remaining,
          requested,
        );

        if (!result.ok) {
          refusals++;
          expect(remaining).toBeLessThan(
            KubectlWaitBudget.getMinimumBudgetMs(),
          );
          continue;
        }

        plans++;
        const plan: KubectlWaitPlan = result.plan;
        expect(KubectlWaitBudget.getWorstCaseWaitMs(plan)).toBeLessThanOrEqual(
          remaining,
        );
        expect(plan.timeoutInMs).toBeGreaterThanOrEqual(MIN_KUBECTL_TIMEOUT_MS);
        expect(plan.timeoutInMs).toBeLessThanOrEqual(requested);
        expect(plan.claimTimeoutInMs).toBeGreaterThanOrEqual(
          MIN_KUBECTL_CLAIM_TIMEOUT_MS,
        );
        expect(plan.claimTimeoutInMs).toBeLessThanOrEqual(CLAIM_MS);
        expect(plan.isClamped).toBe(
          plan.timeoutInMs < requested || plan.claimTimeoutInMs < CLAIM_MS,
        );
      }
    }

    expect(plans).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
  });
});

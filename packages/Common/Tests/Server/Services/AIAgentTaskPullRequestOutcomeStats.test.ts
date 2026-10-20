import AIAgentTaskPullRequestService, {
  AIFixOutcomeStats,
} from "../../../Server/Services/AIAgentTaskPullRequestService";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import FixPullRequestCiStatus from "../../../Types/AI/FixPullRequestCiStatus";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import PositiveNumber from "../../../Types/PositiveNumber";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Query from "../../../Server/Types/Database/Query";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The AI-fix acceptance rate (merged / terminal) is the G11 precision
 * baseline. These tests lock the rate definition: open PRs are excluded
 * from the denominator, and the rate is NULL (not 0 or 100) until at least
 * one PR reached a terminal state. The B4 Tier 1 verified-green rate gets
 * the same honesty rules: null only when NOTHING merged, and merged PRs
 * whose CI never went green (or that have no CI at all) count AGAINST the
 * rate — absence of CI is never presented as verified (G9).
 */

const projectId: ObjectID = ObjectID.generate();

function mockCounts(counts: {
  open: number;
  merged: number;
  closed: number;
  mergedCiGreen?: number;
  mergedCiExpectedFailure?: number;
  verifiedInProduction?: number;
  regressedInProduction?: number;
}): void {
  jest
    .spyOn(AIAgentTaskPullRequestService, "countBy")
    .mockImplementation((args: { query: Query<AIAgentTaskPullRequest> }) => {
      const state: PullRequestState = args.query[
        "pullRequestState"
      ] as PullRequestState;
      const ciStatus: FixPullRequestCiStatus | undefined = args.query[
        "ciStatus"
      ] as FixPullRequestCiStatus | undefined;

      const productionStatus: FixProductionStatus | undefined = args.query[
        "productionStatus"
      ] as FixProductionStatus | undefined;

      // So are the production verdicts: merging is not fixing.
      if (productionStatus === FixProductionStatus.Verified) {
        expect(state).toBe(PullRequestState.Merged);
        return Promise.resolve(
          new PositiveNumber(counts.verifiedInProduction || 0),
        );
      }

      if (productionStatus === FixProductionStatus.Regressed) {
        expect(state).toBe(PullRequestState.Merged);
        return Promise.resolve(
          new PositiveNumber(counts.regressedInProduction || 0),
        );
      }

      expect(productionStatus).toBeUndefined();

      // The CI-filtered counts are always merged-scoped in the service.
      if (ciStatus === FixPullRequestCiStatus.Green) {
        expect(state).toBe(PullRequestState.Merged);
        return Promise.resolve(new PositiveNumber(counts.mergedCiGreen || 0));
      }

      if (ciStatus === FixPullRequestCiStatus.ExpectedFailureObserved) {
        expect(state).toBe(PullRequestState.Merged);
        return Promise.resolve(
          new PositiveNumber(counts.mergedCiExpectedFailure || 0),
        );
      }

      const value: number =
        state === PullRequestState.Open
          ? counts.open
          : state === PullRequestState.Merged
            ? counts.merged
            : counts.closed;

      return Promise.resolve(new PositiveNumber(value));
    });
}

describe("AIAgentTaskPullRequestService.getOutcomeStats", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("computes totals and acceptance rate from terminal outcomes only", async () => {
    mockCounts({ open: 5, merged: 3, closed: 1 });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.total).toBe(9);
    expect(stats.open).toBe(5);
    expect(stats.merged).toBe(3);
    expect(stats.closedUnmerged).toBe(1);
    expect(stats.acceptanceRatePercent).toBe(75); // 3 / (3 + 1)
  });

  test("rate is null when no PR has reached a terminal state", async () => {
    mockCounts({ open: 4, merged: 0, closed: 0 });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.total).toBe(4);
    expect(stats.acceptanceRatePercent).toBeNull();
  });

  test("verified-green counts Green and ExpectedFailureObserved merges, over merged only", async () => {
    mockCounts({
      open: 1,
      merged: 4,
      closed: 2,
      mergedCiGreen: 2,
      mergedCiExpectedFailure: 1,
    });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.verifiedGreen).toBe(3);
    expect(stats.verifiedGreenRatePercent).toBe(75); // 3 / 4 merged
    // Denominators are independent: acceptance is over terminal PRs.
    expect(stats.acceptanceRatePercent).toBe(67); // 4 / 6 terminal
  });

  test("merged PRs without a green CI conclusion drag the rate to 0 — not null (G9: no CI is never verified)", async () => {
    mockCounts({ open: 0, merged: 3, closed: 0 });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.verifiedGreen).toBe(0);
    expect(stats.verifiedGreenRatePercent).toBe(0);
  });

  test("verified-green rate is null only when nothing merged, even with closed PRs", async () => {
    mockCounts({ open: 2, merged: 0, closed: 3 });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.verifiedGreen).toBe(0);
    expect(stats.verifiedGreenRatePercent).toBeNull();
    // The acceptance denominator (terminal) is populated — independent.
    expect(stats.acceptanceRatePercent).toBe(0);
  });

  /*
   * Merged-and-CI-green is good; merged-and-fixed-in-production is the
   * point. Only Verified counts as fixed - a fix still waiting for its
   * deploy, watched, or impossible to tell is not.
   */
  test("counts the merged fixes production showed working, and those it showed not", async () => {
    mockCounts({
      open: 1,
      merged: 10,
      closed: 2,
      verifiedInProduction: 6,
      regressedInProduction: 1,
    });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.verifiedInProduction).toBe(6);
    expect(stats.regressedInProduction).toBe(1);
    expect(stats.merged).toBe(10);
  });

  test("with no verdict yet, both are zero", async () => {
    mockCounts({ open: 0, merged: 3, closed: 0 });

    const stats: AIFixOutcomeStats =
      await AIAgentTaskPullRequestService.getOutcomeStats({
        isRoot: true,
        tenantId: projectId,
      });

    expect(stats.verifiedInProduction).toBe(0);
    expect(stats.regressedInProduction).toBe(0);
  });

  test("throws without a tenant", async () => {
    await expect(
      AIAgentTaskPullRequestService.getOutcomeStats({ isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });
});

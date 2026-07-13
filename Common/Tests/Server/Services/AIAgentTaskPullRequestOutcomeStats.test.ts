import AIAgentTaskPullRequestService, {
  AIFixOutcomeStats,
} from "../../../Server/Services/AIAgentTaskPullRequestService";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
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
 * one PR reached a terminal state.
 */

const projectId: ObjectID = ObjectID.generate();

function mockCounts(counts: {
  open: number;
  merged: number;
  closed: number;
}): void {
  jest
    .spyOn(AIAgentTaskPullRequestService, "countBy")
    .mockImplementation((args: { query: Query<AIAgentTaskPullRequest> }) => {
      const state: PullRequestState = args.query[
        "pullRequestState"
      ] as PullRequestState;

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

  test("throws without a tenant", async () => {
    await expect(
      AIAgentTaskPullRequestService.getOutcomeStats({ isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });
});

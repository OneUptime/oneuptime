import GitHubUtil, {
  GitHubCheckRunsSummary,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import FixPullRequestCiStatus from "../../../Types/AI/FixPullRequestCiStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * Check-run counting for the Tier 1 CI verification sweep. The G9-critical
 * edges: an empty check-run list is NoCiConfigured (a repo without CI
 * verifies NOTHING), and any conclusion we do not positively recognize as
 * passing counts as failed — unknown must fail toward unverified, never
 * toward verified.
 */

describe("GitHubUtil.summarizeCheckRuns", () => {
  test("no check runs at all means NoCiConfigured", () => {
    const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([]);

    expect(summary).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      conclusion: FixPullRequestCiStatus.NoCiConfigured,
    });
  });

  test("queued and in_progress runs count as pending and roll up to Pending", () => {
    const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([
      { status: "queued", conclusion: null },
      { status: "in_progress", conclusion: null },
      { status: "completed", conclusion: "success" },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.pending).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.conclusion).toBe(FixPullRequestCiStatus.Pending);
  });

  test("a failure while other checks still run stays Pending — conclusions are final only", () => {
    const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([
      { status: "completed", conclusion: "failure" },
      { status: "in_progress", conclusion: null },
    ]);

    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.conclusion).toBe(FixPullRequestCiStatus.Pending);
  });

  test("one failed run among completed runs rolls up to Red", () => {
    const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "failure" },
      { status: "completed", conclusion: "success" },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.conclusion).toBe(FixPullRequestCiStatus.Red);
  });

  test("success, neutral and skipped all count as passing — rolls up to Green", () => {
    const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "neutral" },
      { status: "completed", conclusion: "skipped" },
    ]);

    expect(summary.failed).toBe(0);
    expect(summary.conclusion).toBe(FixPullRequestCiStatus.Green);
  });

  test("timed_out, cancelled, action_required and stale count as failed", () => {
    for (const conclusion of [
      "timed_out",
      "cancelled",
      "action_required",
      "stale",
    ]) {
      const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([
        { status: "completed", conclusion },
      ]);

      expect(summary.failed).toBe(1);
      expect(summary.conclusion).toBe(FixPullRequestCiStatus.Red);
    }
  });

  test("an unknown future conclusion fails toward unverified, never verified (G9)", () => {
    const summary: GitHubCheckRunsSummary = GitHubUtil.summarizeCheckRuns([
      { status: "completed", conclusion: "some_future_conclusion" },
    ]);

    expect(summary.failed).toBe(1);
    expect(summary.conclusion).toBe(FixPullRequestCiStatus.Red);
  });
});

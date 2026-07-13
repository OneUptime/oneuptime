import CodeFixTaskType from "./CodeFixTaskType";

/*
 * The rolled-up CI conclusion recorded on an AI fix pull request
 * (AIAgentTaskPullRequest.ciStatus) — B4 Tier 1: verification via the
 * customer's OWN CI on the draft PRs. We read check-run conclusions through
 * the GitHub App; we never re-run or gate the customer's CI.
 *
 * G9 honesty rule: only Green and ExpectedFailureObserved ever count as
 * "CI-verified". NoCiConfigured (and a null column — not yet polled) read as
 * unverified, never verified — a repo without CI verifies nothing.
 */
enum FixPullRequestCiStatus {
  // Check runs exist and at least one has not completed yet.
  Pending = "Pending",
  // Every check run completed and none failed.
  Green = "Green",
  // Every check run completed and at least one failed.
  Red = "Red",
  /*
   * A WriteRegressionTest PR whose checks concluded RED: the PR's whole
   * point is a test that SHOULD FAIL until the bug is fixed, so a failing
   * check is the desired signal, not a defect. Honest caveat: at check-run
   * granularity we cannot tell WHICH job failed — a repo whose lint breaks
   * on the PR also reads as expected-failure. Job-level discrimination
   * (inspecting check names) is a tracked Tier 1 residual in the roadmap.
   */
  ExpectedFailureObserved = "ExpectedFailureObserved",
  /*
   * The PR's head branch has zero check runs — the repository runs no CI on
   * this PR. Per G9 this is "unverified", never "verified".
   */
  NoCiConfigured = "NoCiConfigured",
}

export default FixPullRequestCiStatus;

// Counts of one PR's check runs, as read from GitHub.
export interface FixPullRequestCiCheckRunCounts {
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

export class FixPullRequestCiStatusHelper {
  /*
   * Roll one PR's check-run counts into a single conclusion. The order is
   * deliberate:
   *   1. no check runs at all      -> NoCiConfigured (nothing ran; G9: unverified)
   *   2. any run still pending     -> Pending (we report only FINAL
   *      conclusions — a failure observed while other checks still run is
   *      not yet the branch's conclusion)
   *   3. any completed run failed  -> Red
   *   4. otherwise                 -> Green
   */
  public static rollUpConclusion(
    counts: FixPullRequestCiCheckRunCounts,
  ): FixPullRequestCiStatus {
    if (counts.total === 0) {
      return FixPullRequestCiStatus.NoCiConfigured;
    }

    if (counts.pending > 0) {
      return FixPullRequestCiStatus.Pending;
    }

    if (counts.failed > 0) {
      return FixPullRequestCiStatus.Red;
    }

    return FixPullRequestCiStatus.Green;
  }

  /*
   * The SHOULD-FAIL rule: a WriteRegressionTest PR exists to prove a bug
   * with a test that fails until the bug is fixed, so a RED conclusion on
   * such a PR is the expected outcome and is recorded as
   * ExpectedFailureObserved. Every other conclusion, and every other task
   * type, passes through unchanged. (Caveat documented on the enum member:
   * we cannot tell which job failed — a broken lint also reads as
   * expected-failure until job-level discrimination ships.)
   */
  public static applyTaskType(data: {
    conclusion: FixPullRequestCiStatus;
    taskType: CodeFixTaskType;
  }): FixPullRequestCiStatus {
    if (
      data.conclusion === FixPullRequestCiStatus.Red &&
      data.taskType === CodeFixTaskType.WriteRegressionTest
    ) {
      return FixPullRequestCiStatus.ExpectedFailureObserved;
    }

    return data.conclusion;
  }

  /*
   * The G9 verification predicate, defined ONCE: a PR counts as CI-verified
   * only on Green or ExpectedFailureObserved. NoCiConfigured, Pending, Red
   * and null all read as unverified.
   */
  public static isVerified(
    status: FixPullRequestCiStatus | undefined | null,
  ): boolean {
    return (
      status === FixPullRequestCiStatus.Green ||
      status === FixPullRequestCiStatus.ExpectedFailureObserved
    );
  }

  // Human-readable line for the run's glass-box ProgressLog trail.
  public static describeForProgressLog(data: {
    ciStatus: FixPullRequestCiStatus;
    counts: FixPullRequestCiCheckRunCounts;
  }): string {
    switch (data.ciStatus) {
      case FixPullRequestCiStatus.Green:
        return `CI on the fix PR: Green (${data.counts.completed}/${data.counts.total} checks passed)`;
      case FixPullRequestCiStatus.Red:
        return `CI on the fix PR: Red (${data.counts.failed}/${data.counts.total} checks failed)`;
      case FixPullRequestCiStatus.ExpectedFailureObserved:
        return `Regression-test PR: expected failure observed (${data.counts.failed}/${data.counts.total} checks failed — a failing check is the desired signal for a should-fail test)`;
      case FixPullRequestCiStatus.Pending:
        return `CI on the fix PR: Pending (${data.counts.completed}/${data.counts.total} checks completed)`;
      case FixPullRequestCiStatus.NoCiConfigured:
        return "CI on the fix PR: no check runs found — the repository runs no CI on this branch, so the fix is unverified";
      default:
        return `CI on the fix PR: ${data.ciStatus}`;
    }
  }
}

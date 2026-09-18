/*
 * Outcome of the Runner-side build/test verification loop that runs against
 * an AI-authored fix BEFORE its pull request opens (distinct from
 * FixPullRequestCiStatus, which mirrors the repository's own CI checks
 * AFTER the PR exists):
 *
 *   - Passed: every configured command (setup, build, test) exited 0 —
 *     possibly after bounded agent repair attempts.
 *   - Failed: a configured command still failed after the repair attempts
 *     were exhausted. The PR still opens, with the failure clearly labeled
 *     in its body, so the work is not lost — the human reviewer decides.
 *   - Skipped: the repository has no verification commands configured, so
 *     nothing could be verified.
 */
enum FixVerificationStatus {
  Passed = "Passed",
  Failed = "Failed",
  Skipped = "Skipped",
}

export default FixVerificationStatus;

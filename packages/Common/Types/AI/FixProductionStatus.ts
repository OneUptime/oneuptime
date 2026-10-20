/*
 * Whether a merged AI fix pull request fixed the exception it was opened for
 * in production (FixProductionVerifier). Merging is not fixing: the fix
 * counts once a recorded deploy that contains its commit has run long enough
 * to show the exception gone.
 *
 *   - AwaitingDeploy: merged; no recorded deploy of the exception's service
 *     contains the fix's commit yet.
 *   - Watching: a deploy that contains the fix is running; OneUptime is
 *     waiting long enough to tell, given how often the exception happened
 *     before the fix.
 *   - Verified: the exception has not happened since the deploy, for long
 *     enough that it would have been seen several times without the fix.
 *   - Regressed: the exception happened again in the deployed fix.
 *   - Unverifiable: it cannot be told - no deploy that contains the fix was
 *     recorded in time, or the exception was too rare before the fix for
 *     its absence to mean anything.
 *
 * Stored on AIAgentTaskPullRequest.productionStatus; a wire contract - do
 * not rename.
 */
enum FixProductionStatus {
  AwaitingDeploy = "AwaitingDeploy",
  Watching = "Watching",
  Verified = "Verified",
  Regressed = "Regressed",
  Unverifiable = "Unverifiable",
}

export class FixProductionStatusHelper {
  // A status no later check changes.
  public static isFinal(status: FixProductionStatus | undefined): boolean {
    return (
      status === FixProductionStatus.Verified ||
      status === FixProductionStatus.Regressed ||
      status === FixProductionStatus.Unverifiable
    );
  }

  // A stored value as a status; anything this server does not know is none.
  public static fromDatabaseValue(
    value: unknown,
  ): FixProductionStatus | undefined {
    return Object.values(FixProductionStatus).includes(
      value as FixProductionStatus,
    )
      ? (value as FixProductionStatus)
      : undefined;
  }
}

export default FixProductionStatus;

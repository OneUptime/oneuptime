/*
 * Whether a merged AI fix pull request did, in production, what it was
 * opened for (FixProductionVerifier, with the check FixProductionCheck
 * names). Merging is not fixing: the fix counts once a recorded deploy that
 * contains its commit has run long enough to show it - an exception gone,
 * an operation faster, a monitor quiet, the telemetry it adds arriving.
 *
 *   - AwaitingDeploy: merged; no recorded deploy of the fix's service
 *     contains the fix's commit yet.
 *   - Watching: a deploy that contains the fix is running; OneUptime is
 *     waiting long enough to tell.
 *   - Verified: production shows the fix worked - for an exception, it has
 *     not happened since the deploy, for long enough that it would have
 *     been seen several times without the fix.
 *   - Regressed: production shows it did not - the exception happened again,
 *     the operation is no faster, the monitor raised it again, the service's
 *     telemetry stopped.
 *   - Unverifiable: it cannot be told - no deploy that contains the fix was
 *     recorded in time, or what it was for was too rare, too quiet or too
 *     little changed for production to show it.
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

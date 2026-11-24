import CodeFixTaskType from "./CodeFixTaskType";

/*
 * What production is watched for once an AI fix pull request merges
 * (FixProductionVerifier), by the recipe that opened it:
 *
 *   - Exception: a fix of an exception (FixException). The exception stops
 *     happening in the deployed fix.
 *   - Performance: a fix of a slow trace or of a trace-latency insight
 *     (FixPerformance). The operation it names gets faster: its p99 in the
 *     deployed fix against the week before the merge.
 *   - Recurrence: a fix of the root cause an investigation of an incident
 *     or an alert found (FixFromIncident). The monitor that raised it stops
 *     raising them.
 *   - Telemetry: a telemetry improvement (ImproveInstrumentation,
 *     ImproveLogging, ImproveTracing). The spans, attributes and log fields
 *     it adds arrive from the deployed fix.
 *   - TelemetryLeak: a code fix of a Data Security telemetry issue (#10368)
 *     - a task in Code asked from the issue (Fix with AI, #10362), or a
 *     service's leaks fixed in one pull request (#10367). The service's
 *     new version writes no more of the data, over enough of its traffic:
 *     the scrub rules that contain it change no value in that version, or,
 *     with no rule, its records hold none of it.
 *   - StoreConfiguration: a fix of a cloud store's Data Security issue in
 *     the infrastructure code that declares it - a group's one pull request
 *     (FixInfrastructureCode, #10370), or a task asked from the issue. The
 *     store's configuration, read again, passes the issue's check; a day of
 *     failing is "merged, not applied".
 *
 * Which Data Security check a merged pull request is watched with is read
 * from its task, not its recipe alone: a request in Code is watched only
 * when it names a Data Security issue (Server/Utils/AI/CodeFix/
 * FixProductionCheckPicker). Every other recipe changes nothing production
 * can show - a regression test, better exception handling, a review, a
 * request in Code - and is not watched.
 *
 * Stored on AIAgentTaskPullRequest.productionCheck; a wire contract - do not
 * rename. A watched row without one is an exception fix: the only kind
 * watched before the column existed.
 */
enum FixProductionCheck {
  Exception = "Exception",
  Performance = "Performance",
  Recurrence = "Recurrence",
  Telemetry = "Telemetry",
  TelemetryLeak = "TelemetryLeak",
  StoreConfiguration = "StoreConfiguration",
}

export class FixProductionCheckHelper {
  /*
   * The check a merged fix of this recipe is watched with, or null for
   * none. A Data Security fix is told apart by what its task names
   * (FixProductionCheckPicker): its recipe alone picks the infrastructure
   * fix of a group (#10370), whose task is always a store's.
   */
  public static forTaskType(
    taskType: CodeFixTaskType,
  ): FixProductionCheck | null {
    switch (taskType) {
      case CodeFixTaskType.FixException:
        return FixProductionCheck.Exception;
      case CodeFixTaskType.FixPerformance:
        return FixProductionCheck.Performance;
      case CodeFixTaskType.FixFromIncident:
        return FixProductionCheck.Recurrence;
      case CodeFixTaskType.ImproveInstrumentation:
      case CodeFixTaskType.ImproveLogging:
      case CodeFixTaskType.ImproveTracing:
        return FixProductionCheck.Telemetry;
      case CodeFixTaskType.FixInfrastructureCode:
        return FixProductionCheck.StoreConfiguration;
      default:
        return null;
    }
  }

  /*
   * A stored value as a check: none is Exception (rows watched before the
   * column existed), and one this server does not know is undefined.
   */
  public static fromDatabaseValue(
    value: unknown,
  ): FixProductionCheck | undefined {
    if (value === null || value === undefined || value === "") {
      return FixProductionCheck.Exception;
    }

    return Object.values(FixProductionCheck).includes(
      value as FixProductionCheck,
    )
      ? (value as FixProductionCheck)
      : undefined;
  }

  // A check of a Data Security fix (#10368): its issue is resolved by it.
  public static isDataSecurityCheck(
    check: FixProductionCheck | undefined,
  ): boolean {
    return (
      check === FixProductionCheck.TelemetryLeak ||
      check === FixProductionCheck.StoreConfiguration
    );
  }
}

export default FixProductionCheck;

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
 *
 * Every other recipe changes nothing production can show - a regression
 * test, better exception handling, a review, a request in Code - and is not
 * watched.
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
}

export class FixProductionCheckHelper {
  // The check a merged fix of this recipe is watched with, or null for none.
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
}

export default FixProductionCheck;

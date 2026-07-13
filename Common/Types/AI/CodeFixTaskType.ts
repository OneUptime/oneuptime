/*
 * Which task recipe a CodeFix AIRun executes. The agent worker dispatches on
 * this value (returned as `taskType` by /ai-agent-task/get-pending-task), so
 * these strings are a wire contract — do not rename them.
 *
 * A null AIRun.codeFixTaskType column means FixException: every CodeFix run
 * created before the column existed was an exception fix. Server responses
 * normalize null to FixException so clients never see the legacy null.
 */
enum CodeFixTaskType {
  // Analyze an exception's stack trace and open a PR that fixes the bug.
  FixException = "FixException",
  // Write a failing-then-passing regression test that reproduces the exception.
  WriteRegressionTest = "WriteRegressionTest",
  /*
   * Add the observability an INCONCLUSIVE Sentinel investigation was missing
   * (structured logs, spans, metric counters on the implicated code paths).
   * NOT user-triggerable from the exception page — it has its own automatic
   * trigger: an inconclusive investigation on a project that opted in via
   * Project.enableInstrumentationFixTasks (see Common/Server/Utils/AI/
   * Sentinel/InstrumentationTaskTrigger.ts). Its subject is the triggering
   * incident/alert, NOT a telemetry exception.
   */
  ImproveInstrumentation = "ImproveInstrumentation",
  /*
   * Declared for an upcoming recipe — not triggerable yet. The user-facing
   * create endpoints reject it until its recipe ships.
   */
  FixPerformance = "FixPerformance",
  /*
   * Fix the root cause a completed Sentinel investigation identified. Human-
   * triggered from the investigation panel (POST /ai-investigation/
   * create-fix-task), NOT from the exception page: its subject is the
   * investigated incident/alert, and its context is the posted analysis (see
   * Common/Server/Utils/AI/Sentinel/FixFromIncidentTaskTrigger.ts).
   */
  FixFromIncident = "FixFromIncident",
}

export default CodeFixTaskType;

export class CodeFixTaskTypeHelper {
  /*
   * The recipes a user may start today FROM THE EXCEPTION PAGE. Recipes
   * outside this list exist as enum values so the worker/UI can already
   * dispatch on them, but creation via the exception-page endpoint is
   * server-rejected. ImproveInstrumentation and FixFromIncident stay off
   * this list by design — they are not exception-triggered at all:
   * ImproveInstrumentation's trigger is an inconclusive Sentinel
   * investigation on an opted-in project, and FixFromIncident is user-
   * triggered from the investigation panel via its own endpoint
   * (POST /ai-investigation/create-fix-task).
   */
  public static getUserTriggerableTaskTypes(): Array<CodeFixTaskType> {
    return [CodeFixTaskType.FixException, CodeFixTaskType.WriteRegressionTest];
  }

  public static isUserTriggerable(taskType: CodeFixTaskType): boolean {
    return this.getUserTriggerableTaskTypes().includes(taskType);
  }

  /*
   * Whether the recipe executes against a telemetry exception
   * (AIRun.triggeredByTelemetryExceptionId). The claim guard uses this to
   * decide which trigger record a queued run must carry: exception-based
   * recipes are unexecutable without their exception, while
   * ImproveInstrumentation / FixFromIncident run against the incident or
   * alert that triggered them (triggeredByIncidentId / triggeredByAlertId)
   * and must not be rejected for lacking an exception.
   */
  public static requiresTelemetryException(taskType: CodeFixTaskType): boolean {
    return (
      taskType !== CodeFixTaskType.ImproveInstrumentation &&
      taskType !== CodeFixTaskType.FixFromIncident
    );
  }

  public static isValidTaskType(value: string): value is CodeFixTaskType {
    return Object.values(CodeFixTaskType).includes(value as CodeFixTaskType);
  }

  // Null means FixException: rows created before the column existed.
  public static fromDatabaseValue(
    value: CodeFixTaskType | string | null | undefined,
  ): CodeFixTaskType {
    if (value && this.isValidTaskType(value.toString())) {
      return value as CodeFixTaskType;
    }

    return CodeFixTaskType.FixException;
  }
}

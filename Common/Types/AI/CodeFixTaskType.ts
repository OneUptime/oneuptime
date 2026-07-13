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
   * Fix a deterministically-detected performance pattern in a trace (N+1
   * queries, one dominant slow span, sequential-that-could-be-parallel
   * siblings). Human-triggered from the trace view (POST /ai-investigation/
   * create-performance-fix-task), NOT from the exception page: it has no
   * subject row at all — its entire context (the SpanTreeAnalyzer findings)
   * is captured at trigger time into AIRun.taskContext (see
   * Common/Server/Utils/AI/Sentinel/FixPerformanceTaskTrigger.ts).
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

/*
 * What a queued run of a recipe must CARRY to be executable — the claim
 * guard and the task-details endpoint both group recipes by this, so a new
 * recipe declares its context kind exactly once.
 */
export enum CodeFixContextKind {
  // Executes against AIRun.triggeredByTelemetryExceptionId.
  TelemetryException = "TelemetryException",
  // Executes against AIRun.triggeredByIncidentId / triggeredByAlertId.
  IncidentOrAlertSubject = "IncidentOrAlertSubject",
  /*
   * Executes against evidence captured at trigger time into
   * AIRun.taskContext (FixPerformance: traceId + span-tree findings) — no
   * subject row exists at all.
   */
  TaskContext = "TaskContext",
}

export class CodeFixTaskTypeHelper {
  /*
   * The recipes a user may start today FROM THE EXCEPTION PAGE. Recipes
   * outside this list exist as enum values so the worker/UI can already
   * dispatch on them, but creation via the exception-page endpoint is
   * server-rejected. ImproveInstrumentation, FixFromIncident and
   * FixPerformance stay off this list by design — they are not
   * exception-triggered at all: ImproveInstrumentation's trigger is an
   * inconclusive Sentinel investigation on an opted-in project,
   * FixFromIncident is user-triggered from the investigation panel
   * (POST /ai-investigation/create-fix-task), and FixPerformance is
   * user-triggered from the trace view
   * (POST /ai-investigation/create-performance-fix-task).
   */
  public static getUserTriggerableTaskTypes(): Array<CodeFixTaskType> {
    return [CodeFixTaskType.FixException, CodeFixTaskType.WriteRegressionTest];
  }

  public static isUserTriggerable(taskType: CodeFixTaskType): boolean {
    return this.getUserTriggerableTaskTypes().includes(taskType);
  }

  /*
   * Which context record a queued run of this recipe must carry to be
   * executable. The claim guard rejects runs missing their kind's record,
   * and the task-details endpoint dispatches its response shape on it.
   * Unlisted (and legacy-null-normalized) recipes are exception-based —
   * the safe default, since an exception-less claim of one is unexecutable.
   */
  public static getContextKind(taskType: CodeFixTaskType): CodeFixContextKind {
    switch (taskType) {
      case CodeFixTaskType.ImproveInstrumentation:
      case CodeFixTaskType.FixFromIncident:
        return CodeFixContextKind.IncidentOrAlertSubject;
      case CodeFixTaskType.FixPerformance:
        return CodeFixContextKind.TaskContext;
      default:
        return CodeFixContextKind.TelemetryException;
    }
  }

  /*
   * Whether the recipe executes against a telemetry exception
   * (AIRun.triggeredByTelemetryExceptionId). Kept as sugar over
   * getContextKind — the claim guard and the task-details endpoint now
   * dispatch on the full context kind.
   */
  public static requiresTelemetryException(taskType: CodeFixTaskType): boolean {
    return (
      this.getContextKind(taskType) === CodeFixContextKind.TelemetryException
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

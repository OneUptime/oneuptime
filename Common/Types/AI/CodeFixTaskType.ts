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
   * Declared for upcoming recipes — not user-triggerable yet. The user-facing
   * create endpoint rejects them until their recipes ship.
   */
  ImproveInstrumentation = "ImproveInstrumentation",
  FixPerformance = "FixPerformance",
  FixFromIncident = "FixFromIncident",
}

export default CodeFixTaskType;

export class CodeFixTaskTypeHelper {
  /*
   * The recipes a user may start today (from the exception page). Recipes
   * outside this list exist as enum values so the worker/UI can already
   * dispatch on them, but creation is server-rejected.
   */
  public static getUserTriggerableTaskTypes(): Array<CodeFixTaskType> {
    return [CodeFixTaskType.FixException, CodeFixTaskType.WriteRegressionTest];
  }

  public static isUserTriggerable(taskType: CodeFixTaskType): boolean {
    return this.getUserTriggerableTaskTypes().includes(taskType);
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

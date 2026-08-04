enum RunbookStepType {
  Manual = "Manual",
  JavaScript = "JavaScript",
  HttpRequest = "HttpRequest",
  Bash = "Bash",
  AI = "AI",
  SSH = "SSH",
  Kubernetes = "Kubernetes",
}

export default RunbookStepType;

/*
 * Step types that execute on a Runner rather than on the OneUptime Worker,
 * because they act on the customer's own infrastructure. Everything listed
 * here carries an agentId on its config and goes through the RunnerJob
 * claim path.
 *
 * This list is the ENFORCEMENT point — RunnerJobService refuses to
 * enqueue a job for any type not in it, so a Runner can never be handed work
 * it has no executor for. The Worker's own dispatch is a per-type switch
 * rather than a list check (each type needs different arguments), so adding a
 * type here without adding it there means the step fails with "unknown step
 * type" rather than being silently mis-run.
 */
export const RUNNER_EXECUTED_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.JavaScript,
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
];

export function isRunnerExecutedStepType(type: RunbookStepType): boolean {
  return RUNNER_EXECUTED_STEP_TYPES.includes(type);
}

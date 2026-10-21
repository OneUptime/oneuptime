enum RunbookStepType {
  Manual = "Manual",
  JavaScript = "JavaScript",
  HttpRequest = "HttpRequest",
  Bash = "Bash",
  AI = "AI",
  SSH = "SSH",
  Kubernetes = "Kubernetes",
  /*
   * A single kubectl command, dispatched as an argv (never a shell line) to
   * a Runner that can reach the cluster — the in-cluster Runner installed by
   * the kubernetes-agent chart, or any Runner holding a Kubernetes
   * credential. Composed only by OneUptime AI (investigations run read-only
   * commands, remediations run policy-tiered writes); not authored in runbooks.
   */
  Kubectl = "Kubectl",
  /*
   * A single command for an infrastructure resource's AI agent (Docker,
   * Podman, Docker Swarm, Proxmox, VMware, Ceph, a database server or a
   * host), dispatched as an argv (never a shell line) to that resource's
   * online ResourceAiAgent — never claimed by a Runner, never run by the
   * Worker. Composed only by OneUptime AI and tiered by the resource command
   * policy (Utils/AiRemediation/Resource); not authored in runbooks.
   */
  ResourceCommand = "ResourceCommand",
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
  RunbookStepType.Kubectl,
];

export function isRunnerExecutedStepType(type: RunbookStepType): boolean {
  return RUNNER_EXECUTED_STEP_TYPES.includes(type);
}

/*
 * Runner-executed step types that act on a system OTHER than the Runner's own
 * host. They are dispatched as structured instructions (RunnerJob.payload)
 * plus a credential the server resolves at claim time — never as a script, so
 * their job rows carry an empty script by design.
 *
 * That is why RunnerJob.script is not a required column: an empty string is
 * falsy, so a required-column check would reject exactly these jobs. The real
 * rule — script types need a script, these need a payload — is per-type and
 * therefore lives in RunnerJobService.enqueue rather than in column metadata.
 *
 * Every runner-executed type not listed here carries a script instead; the
 * two sets are complementary and a test asserts they stay that way.
 */
export const PAYLOAD_CARRYING_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
  RunbookStepType.Kubectl,
];

export function isPayloadCarryingStepType(type: RunbookStepType): boolean {
  return PAYLOAD_CARRYING_STEP_TYPES.includes(type);
}

/*
 * Step types executed by an infrastructure resource's AI agent (a
 * ResourceAiAgent row), a third lane beside the Runner and the Worker. Such
 * a job is written with targetResourceAiAgentId and no targetAgentId, so no
 * Runner can claim it: RunnerJobService.enqueue refuses these types (they
 * are not in RUNNER_EXECUTED_STEP_TYPES), a Runner may not ask for them on a
 * claim, and the Worker's step switch has no case for them.
 *
 * Deliberately NOT in PAYLOAD_CARRYING_STEP_TYPES, which is the payload half
 * of the Runner lane (a test asserts the two Runner halves are
 * complementary); these jobs still carry their argv in RunnerJob.payload.
 */
export const AI_AGENT_EXECUTED_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.ResourceCommand,
];

export function isAiAgentExecutedStepType(type: RunbookStepType): boolean {
  return AI_AGENT_EXECUTED_STEP_TYPES.includes(type);
}

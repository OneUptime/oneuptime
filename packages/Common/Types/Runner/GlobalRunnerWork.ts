import RunbookStepType from "../Runbook/RunbookStepType";
import {
  STEP_EXECUTION_TIMEOUT_BOUNDS,
  TimeoutBounds,
} from "../Runbook/RunbookStepTimeout";

/*
 * WHAT A GLOBAL RUNNER RUNS
 *
 * A global Runner is one the OneUptime server runs for every project (on
 * OneUptime Cloud, OneUptime runs them; on a self-hosted install, the ones a
 * master admin adds under Admin Dashboard -> Settings -> Global Runners). It
 * takes steps from every project that uses global Runners, so it runs only
 * what can be kept apart project by project on a shared host:
 *
 *   - JavaScript steps. Each runs in an isolated-vm sandbox of its own,
 *     created for that one step and thrown away after it: no filesystem, no
 *     processes, no environment (so never the Runner's own key), nothing kept
 *     from one step to the next. Its HTTP goes through the sandbox's SSRF
 *     guard on the strict policy: public internet addresses only, never a
 *     private, loopback or link-local address or a cloud metadata endpoint -
 *     so never a project's network, nor the network the Runner sits in.
 *   - OneUptime AI's code fixes, in every code repository on the Global
 *     Runner (Types/Runner/CodeRepositoryRunner), one at a time, each in a
 *     workspace of its own that is deleted when the fix ends. The code agent
 *     writes the fix with its file tools alone: none of the repository's own
 *     commands (setup, build, test) and no command a model composes ever
 *     runs there. The server never hands a global Runner either - a
 *     repository's commands, or the command tool to the model
 *     (CodeFixAgentAuth) - and the Runner refuses both
 *     (Config.runsProjectAuthoredCommands). A global Runner acts only for
 *     the run it claimed and is handed a repository's token only for that
 *     run (CodeFixAgentAuth.deniesAccessToRun); a GitHub repository's token
 *     covers that one repository and is revoked when the fix ends.
 *
 * Bash, SSH and Kubernetes steps never run on a global Runner. A shell
 * cannot be kept apart from the other projects' steps on the same host
 * (their files, their processes, the Runner's own key), and SSH and
 * Kubernetes steps exist to reach a project's own systems with its own
 * credentials. They run on a Runner the project installs in its own
 * infrastructure (a custom Runner), which is also the choice for anyone who
 * wants every step kept on their own hosts.
 *
 * Nor does a global Runner run a command OneUptime AI composes: that is a
 * shell too. An AI rule that picks no Runner of its own shows the Global
 * Runner as its choice - the project's default where it has no Runner of
 * its own - and OneUptime AI runs no Bash commands for it there; it runs
 * them only on a Runner the rule picks (AutoRemediation/AutoRemediationFix).
 * The claim serves a global Runner runbook jobs only, and the Runner refuses
 * anything else (packages/Runner GlobalRunnerMode).
 *
 * This is the one list. The server routes a step by it (GlobalRunnerChoice),
 * enqueues and serves global jobs by it (RunnerJobService), the Runner
 * re-checks it before it runs anything (packages/Runner), and the step
 * editor offers the global choice by it.
 */
export const GLOBAL_RUNNER_STEP_TYPES: ReadonlyArray<RunbookStepType> = [
  RunbookStepType.JavaScript,
];

/*
 * The code agent's tool that runs a shell command in the repository
 * (packages/Runner InHouseCodeAgent). Never offered on a global Runner: the
 * Runner leaves it out and refuses the call, and the server takes it out of
 * the tools the model is offered for a global Runner's run
 * (CodeFixAgentAuth.getOfferedTools).
 */
export const CODE_AGENT_COMMAND_TOOL_NAME: string = "run_command";

// Whether a global Runner may run a step of this type.
export function canGlobalRunnersRunStepType(stepType: unknown): boolean {
  return (
    typeof stepType === "string" &&
    GLOBAL_RUNNER_STEP_TYPES.includes(stepType as RunbookStepType)
  );
}

/*
 * The longest one step may run on a global Runner. A step whose own
 * execution timeout is longer is held to this there: global Runners share
 * their time between every project, and a JavaScript step that waits on an
 * API for minutes belongs on a Runner of the project's own.
 */
export const GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

/*
 * The execution timeout a step editor offers for a step on a global
 * Runner: the usual default, held to the 5 minutes above, so the field
 * says the range the step really gets ("Allowed range: 1-300 seconds")
 * and that a longer one is cut short when the step runs.
 */
export const GLOBAL_RUNNER_STEP_EXECUTION_TIMEOUT_BOUNDS: TimeoutBounds = {
  ...STEP_EXECUTION_TIMEOUT_BOUNDS,
  maxInMs: GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
};

export function clampGlobalRunnerExecutionTimeoutInMs(
  timeoutInMs: number,
): number {
  if (!isFinite(timeoutInMs) || timeoutInMs <= 0) {
    return GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS;
  }

  return Math.min(
    Math.round(timeoutInMs),
    GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
  );
}

/*
 * How many of one project's steps the global Runners run at the same time.
 * A project's further steps wait their turn (within their claim timeout)
 * while other projects' steps are taken, so no project can keep the global
 * Runners to itself.
 */
export const MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT: number = 3;

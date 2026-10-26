import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  GLOBAL_RUNNER_STEP_TYPES,
  canGlobalRunnersRunStepType,
} from "Common/Types/Runner/GlobalRunnerWork";

/*
 * What a global Runner is, and therefore what it refuses.
 *
 * A global Runner is started like any other Runner (its id and key, from
 * Admin Dashboard -> Settings -> Global Runners), and the server tells it
 * what it is when it registers and on every heartbeat (isGlobalRunner). It
 * then takes work from every project that uses global Runners, so it runs
 * only what can be kept apart project by project on one host:
 *
 *   - a runbook's own JavaScript step, each in a sandbox of its own that
 *     reaches the internet only (GlobalRunnerWork). It asks the server for
 *     no other step at claim time and refuses anything else at execution
 *     time - another step type, an AI-composed command, a job carrying a
 *     credential - whatever the server sent: the server already serves it
 *     nothing else, and this is the second check, on the host that would
 *     run it;
 *   - the AI code fixes of every repository on the Global Runner, each in
 *     a workspace of its own, written with the code agent's file tools
 *     alone: none of the repository's commands and no command a model
 *     composes ever runs here (Config.runsProjectAuthoredCommands), and its
 *     Git servers are reached on the internet only unless the server says
 *     otherwise (GitHostGuard).
 *
 * Never on by an environment variable of the Runner's own: only the server
 * says a Runner is global, so an operator cannot make a project's Runner
 * take every project's steps, and a global Runner never forgets what it is
 * on a server that stops saying (a missing answer keeps the last one).
 */
export default class GlobalRunnerMode {
  private static isGlobal: boolean = false;

  // What the server last said (RegisterRunner, Heartbeat).
  public static setFromServer(isGlobalRunner: boolean | undefined): void {
    if (isGlobalRunner === undefined) {
      return;
    }

    GlobalRunnerMode.isGlobal = isGlobalRunner === true;
  }

  public static isActive(): boolean {
    return GlobalRunnerMode.isGlobal;
  }

  // The step types a global Runner asks for on a claim.
  public static getAllowedStepTypes(): Array<RunbookStepType> {
    return [...GLOBAL_RUNNER_STEP_TYPES];
  }

  /*
   * Why this Runner will not run a job, as a global Runner - or null when it
   * will. Null on any other Runner.
   */
  public static getJobRefusal(job: {
    stepType?: string | undefined;
    origin?: string | undefined;
    credential?: unknown;
  }): string | null {
    if (!GlobalRunnerMode.isActive()) {
      return null;
    }

    if (!canGlobalRunnersRunStepType(job.stepType)) {
      return `This is a global Runner: it runs JavaScript steps for every project, in a sandbox, and never ${
        job.stepType || "unknown"
      } steps. Pick one of your own Runners for this step (Runbooks > Runners).`;
    }

    if ((job.origin || RunnerJobOrigin.Runbook) !== RunnerJobOrigin.Runbook) {
      return "This is a global Runner: it runs a runbook's own steps only, never commands composed by OneUptime AI.";
    }

    if (job.credential) {
      return "This is a global Runner: it is never handed a credential. Pick one of your own Runners for a step that needs one (Runbooks > Runners).";
    }

    return null;
  }

  // For tests: forget what the server said.
  public static reset(): void {
    GlobalRunnerMode.isGlobal = false;
  }
}

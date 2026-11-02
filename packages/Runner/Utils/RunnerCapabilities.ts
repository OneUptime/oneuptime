import {
  ENABLE_AI_COMMANDS_OVERRIDE,
  ENABLE_CODE_FIXES_OVERRIDE,
  ENABLE_RUNBOOKS_OVERRIDE,
  IS_KUBERNETES_AGENT_MODE,
} from "../Config";
import GlobalRunnerMode from "./GlobalRunnerMode";

export interface RunnerCapabilitySet {
  canRunRunbooks: boolean;
  canRunCodeFixTasks: boolean;
  canRunAiCommands: boolean;
}

/*
 * What a Runner the server granted code fixes logs on start while
 * ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false on its host refuses them: the
 * server knows (this Runner says so on every heartbeat), so the repositories
 * it was to work in say that nothing takes their fixes - and how to change
 * that, from this side.
 */
export const GLOBAL_RUNNER_CODE_FIXES_TURNED_OFF_WARNING: string =
  "This is a global Runner, so it is to take the AI code fixes of every repository on the Global Runner, but ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false on this host refuses them. It tells OneUptime so: while no other global Runner takes them, those repositories say no global Runner online takes AI code fixes. Remove the override to take them.";

export const PROJECT_RUNNER_CODE_FIXES_TURNED_OFF_WARNING: string =
  "A code repository of this project works on this Runner, so it is to take AI code fixes, but ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false on this host refuses them. It tells OneUptime so, and the repository says this Runner takes no AI code fixes. Remove the override, or pick another Runner in the repository's settings in Code.";

/*
 * What this Runner is allowed to do: what the server granted at
 * registration and on every heartbeat, which the local env vars can only
 * narrow — so an operator can revoke a capability centrally, and a host owner
 * can refuse one locally, and neither can grant themselves what the other
 * withheld.
 */
export default class RunnerCapabilities {
  private static granted: RunnerCapabilitySet | null = null;

  public static setGrantedByServer(capabilities: RunnerCapabilitySet): void {
    RunnerCapabilities.granted = capabilities;
  }

  /*
   * Whether the project granted the code-fix capability, before any local
   * override: a host that refuses it locally while it is granted is worth a
   * warning on start (getCodeFixesTurnedOffWarning).
   */
  public static wasGrantedCodeFixesByServer(): boolean {
    return RunnerCapabilities.granted?.canRunCodeFixTasks === true;
  }

  // That warning, for a global Runner or for a project's.
  public static getCodeFixesTurnedOffWarning(isGlobalRunner: boolean): string {
    return isGlobalRunner
      ? GLOBAL_RUNNER_CODE_FIXES_TURNED_OFF_WARNING
      : PROJECT_RUNNER_CODE_FIXES_TURNED_OFF_WARNING;
  }

  /*
   * Whether this Runner takes AI code fixes when the server grants them,
   * whatever it grants now: what the Runner says on registration and on
   * every heartbeat (takesCodeFixes), so the server counts it only for work
   * it will take (Common/Types/Runner/RunnerCodeFixes) and tells a
   * repository on it why nothing takes its fixes instead of letting them
   * sit queued. No while ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false refuses
   * them on this host, and never for the in-cluster Runner the Kubernetes
   * agent chart installs, which does not run the code-fix loop at all
   * (Index.ts).
   */
  public static takesCodeFixes(): boolean {
    return !IS_KUBERNETES_AGENT_MODE && ENABLE_CODE_FIXES_OVERRIDE !== false;
  }

  public static resolve(): RunnerCapabilitySet {
    /*
     * An older server does not report capabilities. Fall back to the
     * historical env-var defaults so upgrading the Runner first never
     * silently stops it working. AI commands stay default-deny: an old
     * server cannot have granted them.
     */
    const granted: RunnerCapabilitySet = RunnerCapabilities.granted ?? {
      canRunRunbooks: true,
      canRunCodeFixTasks: ENABLE_CODE_FIXES_OVERRIDE === true,
      canRunAiCommands: false,
    };

    /*
     * A global Runner runs every project's JavaScript steps and the AI code
     * fixes of every repository on the Global Runner, and nothing else: AI
     * commands act in one project's own systems, so they stay off here
     * whatever was granted (GlobalRunnerMode). Its code fixes never run a
     * repository's own commands (Config.runsProjectAuthoredCommands).
     */
    if (GlobalRunnerMode.isActive()) {
      return {
        canRunRunbooks:
          granted.canRunRunbooks && ENABLE_RUNBOOKS_OVERRIDE !== false,
        canRunCodeFixTasks:
          granted.canRunCodeFixTasks && ENABLE_CODE_FIXES_OVERRIDE !== false,
        canRunAiCommands: false,
      };
    }

    return {
      canRunRunbooks:
        granted.canRunRunbooks && ENABLE_RUNBOOKS_OVERRIDE !== false,
      canRunCodeFixTasks:
        granted.canRunCodeFixTasks && ENABLE_CODE_FIXES_OVERRIDE !== false,
      canRunAiCommands:
        granted.canRunAiCommands && ENABLE_AI_COMMANDS_OVERRIDE !== false,
    };
  }
}

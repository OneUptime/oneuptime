import {
  ENABLE_AI_COMMANDS_OVERRIDE,
  ENABLE_CODE_FIXES_OVERRIDE,
  ENABLE_RUNBOOKS_OVERRIDE,
} from "../Config";
import GlobalRunnerMode from "./GlobalRunnerMode";

export interface RunnerCapabilitySet {
  canRunRunbooks: boolean;
  canRunCodeFixTasks: boolean;
  canRunAiCommands: boolean;
}

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
   * override. The server counts a granted Runner as able to take that work,
   * so a host that refuses it locally leaves those runs queued.
   */
  public static wasGrantedCodeFixesByServer(): boolean {
    return RunnerCapabilities.granted?.canRunCodeFixTasks === true;
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

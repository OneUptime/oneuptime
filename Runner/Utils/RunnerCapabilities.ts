import {
  CLUSTER_ENABLE_CODE_FIXES,
  ENABLE_CODE_FIXES_OVERRIDE,
  ENABLE_RUNBOOKS_OVERRIDE,
  IS_CLUSTER_SCOPED,
} from "../Config";

export interface RunnerCapabilitySet {
  canRunRunbooks: boolean;
  canRunCodeFixTasks: boolean;
}

/*
 * What this Runner is allowed to do, resolved once at registration.
 *
 * Project-scoped: the dashboard's toggles decide, and the local env vars can
 * only narrow them — so an operator can revoke a capability centrally, and a
 * host owner can refuse one locally, and neither can grant themselves what
 * the other withheld.
 *
 * Cluster-scoped: there is no dashboard row to consult, so the env vars are
 * the whole answer. Runbook steps target a Runner a human picked in a
 * project, so a cluster Runner can never be a target.
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
    if (IS_CLUSTER_SCOPED) {
      return {
        canRunRunbooks: false,
        canRunCodeFixTasks: CLUSTER_ENABLE_CODE_FIXES,
      };
    }

    /*
     * An older server does not report capabilities. Fall back to the
     * historical env-var defaults so upgrading the Runner first never
     * silently stops it working.
     */
    const granted: RunnerCapabilitySet = RunnerCapabilities.granted ?? {
      canRunRunbooks: true,
      canRunCodeFixTasks: ENABLE_CODE_FIXES_OVERRIDE === true,
    };

    return {
      canRunRunbooks:
        granted.canRunRunbooks && ENABLE_RUNBOOKS_OVERRIDE !== false,
      canRunCodeFixTasks:
        granted.canRunCodeFixTasks && ENABLE_CODE_FIXES_OVERRIDE !== false,
    };
  }
}

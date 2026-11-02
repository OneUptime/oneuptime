import Version from "../Version";
import VersionUtil from "../../Utils/VersionUtil";

/*
 * WHETHER A RUNNER TAKES ONEUPTIME AI'S CODE FIXES.
 *
 * The server grants a Runner the code-fix capability on every heartbeat - a
 * global Runner always, a project's Runner while a code repository works on
 * it (packages/App RunnerIngress) - but a Runner can refuse it on its own
 * side, and the server used to count it as there to take the work all the
 * same, so a repository on it looked ready while its fixes sat queued:
 *
 *   - its host turned code fixes off: ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false,
 *     a local switch that can only narrow what the server grants. (The
 *     in-cluster Runner the Kubernetes agent chart installed never runs the
 *     code-fix loop either.)
 *   - it is a global Runner of a release from before global Runners took code
 *     fixes (GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION), which turns them off
 *     itself.
 *
 * So a Runner says on every heartbeat whether it takes them (its
 * `takesCodeFixes`, stored as Runner.takesCodeFixes), and this is how
 * OneUptime reads that - the server when it says whether anything online can
 * take a repository's work (CodeRepositoryRunnerChoice: Code's gate, the
 * exception page's checklist, the queue sweeper), and the dashboard when it
 * draws a repository's Runner:
 *
 *   - a Runner that said: what it said;
 *   - one that said nothing, a release from before the report:
 *       - a project's Runner takes them, as every release did while a
 *         repository worked on it (its host's switch is the one thing it
 *         cannot say);
 *       - a global Runner goes by the release it reported: from
 *         GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION it takes them (again, unless
 *         its host turned them off, which it cannot say), and an older one
 *         never does;
 *       - a Runner that never heartbeated is not known to refuse them. It is
 *         not online either way, and its first heartbeat says. Its row holds
 *         the 1.0.0 every new Runner row is stamped with, not a release.
 *
 * Pure, so the server and the dashboard answer the same way.
 */

/*
 * The first release in which a global Runner takes code fixes (#5302): an
 * older global Runner turns them off itself, whatever the server grants.
 */
export const GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION: string = "14.0.94";

// What the rule reads off a Runner row.
export interface RunnerCodeFixFacts {
  isGlobalRunner?: boolean | null | undefined;
  // What the Runner said on its last heartbeat; empty when it said nothing.
  takesCodeFixes?: boolean | null | undefined;
  // The release it reported (Runner.agentVersion).
  agentVersion?: Version | string | null | undefined;
  // Its last heartbeat: none means the version above is the row's placeholder.
  lastAlive?: Date | string | null | undefined;
}

// Why a Runner takes no code fixes.
export enum RunnerCodeFixRefusal {
  /*
   * It said so: its host turned code fixes off
   * (ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false).
   */
  TurnedOffOnHost = "turned-off-on-host",
  /*
   * A global Runner of a release from before global Runners took code fixes:
   * updating it to the server's version makes it take them.
   */
  OlderRelease = "older-release",
}

/*
 * Whether a release is at least another one. A release that cannot be read
 * is not.
 */
function isReleaseAtLeast(
  release: Version | string | null | undefined,
  since: string,
): boolean {
  const comparison: number | null = VersionUtil.compare(
    release ? release.toString() : "",
    since,
  );

  return comparison !== null && comparison >= 0;
}

// Why the Runner takes no code fixes, or null when it takes them.
export function getRunnerCodeFixRefusal(
  runner: RunnerCodeFixFacts,
): RunnerCodeFixRefusal | null {
  if (runner.takesCodeFixes === true) {
    return null;
  }

  if (runner.takesCodeFixes === false) {
    return RunnerCodeFixRefusal.TurnedOffOnHost;
  }

  // It said nothing: a release from before the report.
  if (runner.isGlobalRunner !== true || !runner.lastAlive) {
    return null;
  }

  return isReleaseAtLeast(
    runner.agentVersion,
    GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION,
  )
    ? null
    : RunnerCodeFixRefusal.OlderRelease;
}

export function doesRunnerTakeCodeFixes(runner: RunnerCodeFixFacts): boolean {
  return getRunnerCodeFixRefusal(runner) === null;
}

/*
 * Whether a global Runner is online to take a repository's AI work - what a
 * repository on the Global Runner waits for.
 */
export enum GlobalRunnerCodeFixAvailability {
  // A global Runner that takes AI code fixes is online.
  Online = "online",
  // Global Runners are online, and none of them takes AI code fixes.
  OnlineButNoneTakesCodeFixes = "online-but-none-takes-code-fixes",
  // No global Runner is online.
  Offline = "offline",
}

// The answer, from the global Runners that are online now.
export function getGlobalRunnerCodeFixAvailability(
  onlineGlobalRunners: ReadonlyArray<RunnerCodeFixFacts>,
): GlobalRunnerCodeFixAvailability {
  if (onlineGlobalRunners.length === 0) {
    return GlobalRunnerCodeFixAvailability.Offline;
  }

  return onlineGlobalRunners.some((runner: RunnerCodeFixFacts): boolean => {
    return doesRunnerTakeCodeFixes({ ...runner, isGlobalRunner: true });
  })
    ? GlobalRunnerCodeFixAvailability.Online
    : GlobalRunnerCodeFixAvailability.OnlineButNoneTakesCodeFixes;
}

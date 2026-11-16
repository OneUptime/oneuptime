/*
 * HOW A GLOBAL RUNNER KEEPS ONE PROJECT'S JAVASCRIPT STEP FROM ANOTHER, AS IT
 * SAYS ON ITS HEARTBEAT.
 *
 * A global Runner runs every project's JavaScript steps, each in a process of
 * its own (packages/Runner/Utils/JavaScriptSandbox). Two things keep code
 * that got out of a step's isolate from the Runner and from every other
 * project, and each depends on the container the Runner runs in:
 *
 *   - a user of its own for the step's process: the image's launcher switches
 *     to one, where the container lets it (not with no-new-privileges,
 *     Kubernetes' allowPrivilegeEscalation: false, or SETUID and SETGID
 *     dropped). Without it, the step runs as the Runner's own user.
 *   - no network for the step's process: the image's no-network filter (a
 *     seccomp filter) lets it open no socket, where the kernel lets a
 *     process filter its system calls. Without it, the step's process
 *     shares the Runner's network. Its HTTP goes through the Runner either
 *     way, to public addresses only.
 *
 * The Runner decides both once, and says what it decided on every heartbeat,
 * in its hostInfo under GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY, so the Admin
 * Dashboard's Global Runners page can say, under the Runner's status, when a
 * step gets less than both, and what to change. A Runner of a release from
 * before this says nothing, and nothing is said about it.
 *
 * Pure, so the Runner and the Admin Dashboard read it the same way.
 */

export const GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY: string = "javaScriptSandbox";

// Who a step's process runs as.
export enum GlobalRunnerStepUser {
  // A user of its own, which no other running step holds.
  OwnUser = "own-user",
  // The Runner's own user, in a process of its own.
  RunnerUser = "runner-user",
}

// Why a step's process runs as the Runner's own user.
export enum GlobalRunnerStepUserReason {
  // The container forbids switching users.
  NoPrivilege = "no-privilege",
  // The Runner runs as a user outside its image's node group.
  NotInNodeGroup = "not-in-node-group",
  // No launcher: a Runner run from its sources, not its image.
  NotInstalled = "not-installed",
  // The launcher's check failed some other way; the Runner's log says how.
  CheckFailed = "check-failed",
}

// What a step's process may reach by itself.
export enum GlobalRunnerStepNetwork {
  // Nothing: it may open no socket of any kind.
  None = "none",
  // What the Runner's container reaches.
  Shared = "shared",
}

// Why a step's process shares the Runner's network.
export enum GlobalRunnerStepNetworkReason {
  /*
   * The kernel, or the container's seccomp profile, lets no process filter
   * its own system calls.
   */
  NoSeccomp = "no-seccomp",
  // No filter: a Runner run from its sources, not its image.
  NotInstalled = "not-installed",
  // The filter's check failed some other way; the Runner's log says how.
  CheckFailed = "check-failed",
}

export interface GlobalRunnerSandboxReport {
  user: GlobalRunnerStepUser;
  userReason?: GlobalRunnerStepUserReason | undefined;
  network: GlobalRunnerStepNetwork;
  networkReason?: GlobalRunnerStepNetworkReason | undefined;
}

function isOneOf<T extends string>(
  values: Record<string, T>,
  value: unknown,
): value is T {
  return (
    typeof value === "string" && Object.values(values).includes(value as T)
  );
}

/*
 * The report a Runner's hostInfo holds, or null when it holds none, or one
 * this release does not read. A reason the report does not name is read as
 * a failed check: the page still says the step gets less than it should.
 */
export function parseGlobalRunnerSandboxReport(
  hostInfo: unknown,
): GlobalRunnerSandboxReport | null {
  if (!hostInfo || typeof hostInfo !== "object" || Array.isArray(hostInfo)) {
    return null;
  }

  const reported: unknown = (hostInfo as Record<string, unknown>)[
    GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY
  ];

  if (!reported || typeof reported !== "object" || Array.isArray(reported)) {
    return null;
  }

  const values: Record<string, unknown> = reported as Record<string, unknown>;
  const user: unknown = values["user"];
  const network: unknown = values["network"];
  const userReason: unknown = values["userReason"];
  const networkReason: unknown = values["networkReason"];

  if (
    !isOneOf(GlobalRunnerStepUser, user) ||
    !isOneOf(GlobalRunnerStepNetwork, network)
  ) {
    return null;
  }

  const report: GlobalRunnerSandboxReport = { user, network };

  if (user === GlobalRunnerStepUser.RunnerUser) {
    report.userReason = isOneOf(GlobalRunnerStepUserReason, userReason)
      ? userReason
      : GlobalRunnerStepUserReason.CheckFailed;
  }

  if (network === GlobalRunnerStepNetwork.Shared) {
    report.networkReason = isOneOf(GlobalRunnerStepNetworkReason, networkReason)
      ? networkReason
      : GlobalRunnerStepNetworkReason.CheckFailed;
  }

  return report;
}

/*
 * What the Admin Dashboard says under a global Runner's status when its
 * steps get less than a user of their own and no network: one sentence for
 * each, saying what the step gets and what to change. English keys, which
 * every Admin Dashboard locale words.
 */
export const GLOBAL_RUNNER_SANDBOX_COPY: {
  ownUserNoPrivilege: string;
  ownUserNotInNodeGroup: string;
  ownUserNotInstalled: string;
  ownUserCheckFailed: string;
  sharedNetworkNoSeccomp: string;
  sharedNetworkNotInstalled: string;
  sharedNetworkCheckFailed: string;
  notInstalled: string;
} = {
  ownUserNoPrivilege:
    "Runs JavaScript steps as its own user: let its container switch users (allowPrivilegeEscalation, SETUID and SETGID).",
  ownUserNotInNodeGroup:
    "Runs JavaScript steps as its own user: run its container as the image's own user, node.",
  ownUserNotInstalled:
    "Runs JavaScript steps as its own user: run the Runner image, not its sources.",
  ownUserCheckFailed:
    "Runs JavaScript steps as its own user: its sandbox check failed, and its log says why.",
  sharedNetworkNoSeccomp:
    "JavaScript steps share its network: let its container use seccomp, as Docker's and Kubernetes' default profiles do.",
  sharedNetworkNotInstalled:
    "JavaScript steps share its network: run the Runner image, not its sources.",
  sharedNetworkCheckFailed:
    "JavaScript steps share its network: its network filter's check failed, and its log says why.",
  // Both, for the one reason: a Runner run from its sources.
  notInstalled:
    "Runs JavaScript steps as its own user and on its network: run the Runner image, not its sources.",
};

/*
 * The sentences for a report, in the order the page draws them: the user
 * first, then the network. None for a Runner whose steps get both, or one
 * that says nothing.
 */
export function getGlobalRunnerSandboxShortfalls(
  report: GlobalRunnerSandboxReport | null,
): Array<string> {
  if (!report) {
    return [];
  }

  const isOwnUserMissing: boolean =
    report.user === GlobalRunnerStepUser.RunnerUser;
  const isNetworkShared: boolean =
    report.network === GlobalRunnerStepNetwork.Shared;

  if (
    isOwnUserMissing &&
    isNetworkShared &&
    report.userReason === GlobalRunnerStepUserReason.NotInstalled &&
    report.networkReason === GlobalRunnerStepNetworkReason.NotInstalled
  ) {
    return [GLOBAL_RUNNER_SANDBOX_COPY.notInstalled];
  }

  const sentences: Array<string> = [];

  if (isOwnUserMissing) {
    switch (report.userReason) {
      case GlobalRunnerStepUserReason.NoPrivilege:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.ownUserNoPrivilege);
        break;
      case GlobalRunnerStepUserReason.NotInNodeGroup:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.ownUserNotInNodeGroup);
        break;
      case GlobalRunnerStepUserReason.NotInstalled:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.ownUserNotInstalled);
        break;
      default:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.ownUserCheckFailed);
    }
  }

  if (isNetworkShared) {
    switch (report.networkReason) {
      case GlobalRunnerStepNetworkReason.NoSeccomp:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.sharedNetworkNoSeccomp);
        break;
      case GlobalRunnerStepNetworkReason.NotInstalled:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.sharedNetworkNotInstalled);
        break;
      default:
        sentences.push(GLOBAL_RUNNER_SANDBOX_COPY.sharedNetworkCheckFailed);
    }
  }

  return sentences;
}

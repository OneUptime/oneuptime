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
 * What the Admin Dashboard draws under a global Runner's status when its
 * steps get less than a user of their own and no network: one line for each,
 * saying what the step gets and what to change. The decision is here, so it
 * is shared and testable; the words are the Admin Dashboard's own, so its
 * locales hold them (the page's GLOBAL_RUNNER_SANDBOX_COPY).
 */
export enum GlobalRunnerSandboxShortfall {
  OwnUserNoPrivilege = "own-user-no-privilege",
  OwnUserNotInNodeGroup = "own-user-not-in-node-group",
  OwnUserNotInstalled = "own-user-not-installed",
  OwnUserCheckFailed = "own-user-check-failed",
  SharedNetworkNoSeccomp = "shared-network-no-seccomp",
  SharedNetworkNotInstalled = "shared-network-not-installed",
  SharedNetworkCheckFailed = "shared-network-check-failed",
  // Both, for the one reason: a Runner run from its sources, not its image.
  NotInstalled = "not-installed",
}

/*
 * The shortfalls for a report, in the order the page draws them: the user
 * first, then the network. None for a Runner whose steps get both, or one
 * that says nothing.
 */
export function getGlobalRunnerSandboxShortfalls(
  report: GlobalRunnerSandboxReport | null,
): Array<GlobalRunnerSandboxShortfall> {
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
    return [GlobalRunnerSandboxShortfall.NotInstalled];
  }

  const shortfalls: Array<GlobalRunnerSandboxShortfall> = [];

  if (isOwnUserMissing) {
    switch (report.userReason) {
      case GlobalRunnerStepUserReason.NoPrivilege:
        shortfalls.push(GlobalRunnerSandboxShortfall.OwnUserNoPrivilege);
        break;
      case GlobalRunnerStepUserReason.NotInNodeGroup:
        shortfalls.push(GlobalRunnerSandboxShortfall.OwnUserNotInNodeGroup);
        break;
      case GlobalRunnerStepUserReason.NotInstalled:
        shortfalls.push(GlobalRunnerSandboxShortfall.OwnUserNotInstalled);
        break;
      default:
        shortfalls.push(GlobalRunnerSandboxShortfall.OwnUserCheckFailed);
    }
  }

  if (isNetworkShared) {
    switch (report.networkReason) {
      case GlobalRunnerStepNetworkReason.NoSeccomp:
        shortfalls.push(GlobalRunnerSandboxShortfall.SharedNetworkNoSeccomp);
        break;
      case GlobalRunnerStepNetworkReason.NotInstalled:
        shortfalls.push(GlobalRunnerSandboxShortfall.SharedNetworkNotInstalled);
        break;
      default:
        shortfalls.push(GlobalRunnerSandboxShortfall.SharedNetworkCheckFailed);
    }
  }

  return shortfalls;
}

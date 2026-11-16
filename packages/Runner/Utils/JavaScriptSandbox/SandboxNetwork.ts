import { GlobalRunnerStepNetworkReason } from "Common/Types/Runner/GlobalRunnerSandbox";
import { LauncherCallResult, LauncherCaller } from "./SandboxIdentity";

/*
 * WHAT A GLOBAL RUNNER'S JAVASCRIPT STEP MAY REACH BY ITSELF.
 *
 * The step's isolate reaches public addresses only, through VMRunner's SSRF
 * guard - and that guard runs in the Runner (SandboxHttp), because the
 * step's process, where the container lets it, has no network at all: the
 * image's javascript-sandbox-no-network (Native/javascript-sandbox-no-
 * network.c) sets a seccomp filter on it that refuses every socket. So code
 * that got out of the isolate reaches nothing by itself: not the app, a
 * database or a cache on the cluster's or Compose's network, not the
 * Kubernetes API, not a cloud metadata endpoint, not the internet.
 *
 * It needs no privilege and no capability: only no_new_privs, which it sets
 * itself, and a kernel and seccomp profile that let a process filter its
 * own system calls, as Docker's default profile does (Tests/Ops/
 * RunnerImageRuntime.test.js runs it there), and as Kubernetes'
 * RuntimeDefault and Unconfined, and the RuntimeDefault OpenShift's
 * restricted SCC requires, do. So it holds where the step runs as the
 * Runner's user too (SandboxIdentity), and on a cluster that enforces no
 * NetworkPolicy.
 *
 * Where the filter is not there (a Runner run from its sources) or cannot
 * be set (a container whose seccomp profile forbids it), the step's process
 * shares the Runner's network. Its isolate's HTTP still goes through the
 * Runner, and Node's permission model still refuses it a socket, but code
 * that got out of the isolate and of Node could reach what the Runner's
 * container reaches. The Runner says so once, with what to change, and on
 * every heartbeat (Common/Types/Runner/GlobalRunnerSandbox).
 */

// The same path as the Dockerfile's.
export const SANDBOX_NO_NETWORK_PATH: string =
  "/usr/lib/oneuptime-runner/javascript-sandbox-no-network";

// Its exit code when the filter cannot be set (Native/javascript-sandbox-no-network.c).
export const NO_NETWORK_EXIT_NO_FILTER: number = 72;

export enum SandboxNetwork {
  // The step's process may open no socket.
  None = "none",
  // The step's process shares the Runner's network.
  Shared = "shared",
}

export interface SandboxNetworkDecision {
  network: SandboxNetwork;
  // Why the step's process shares the Runner's network; null when it does not.
  reason: string | null;
  // The same, as the heartbeat says it; null when it does not.
  reasonCode: GlobalRunnerStepNetworkReason | null;
}

export const NO_NETWORK: SandboxNetworkDecision = {
  network: SandboxNetwork.None,
  reason: null,
  reasonCode: null,
};

export const NO_SECCOMP_REASON: string =
  "the kernel or the container's seccomp profile does not let a process filter its own system calls (seccomp)";

export const NO_NETWORK_FILTER_MISSING_REASON: string =
  "the JavaScript sandbox's network filter is not installed (a Runner run from its sources rather than its image)";

/*
 * What a Runner whose steps share its network is told to change, after the
 * reason.
 */
export const NO_NETWORK_REMEDY: string =
  "Each step's HTTP still goes through this Runner, to public addresses only, and Node's permission model still refuses the step a socket, but code that got out of a step's sandbox could reach what this container reaches. To keep each step off the network, run the Runner's image with a seccomp profile that lets a process filter its own system calls, as Docker's default profile and Kubernetes' RuntimeDefault do.";

function sharedBecause(
  reason: string,
  reasonCode: GlobalRunnerStepNetworkReason,
): SandboxNetworkDecision {
  return { network: SandboxNetwork.Shared, reason, reasonCode };
}

/*
 * Whether a step's process can be kept off the network here: what the
 * filter's own check says, or why it is not asked.
 */
export async function decideSandboxNetwork(data: {
  noNetworkPath: string;
  call: LauncherCaller;
  platform: NodeJS.Platform;
  exists: (filePath: string) => boolean;
}): Promise<SandboxNetworkDecision> {
  if (data.platform !== "linux" || !data.exists(data.noNetworkPath)) {
    return sharedBecause(
      NO_NETWORK_FILTER_MISSING_REASON,
      GlobalRunnerStepNetworkReason.NotInstalled,
    );
  }

  const result: LauncherCallResult = await data.call(data.noNetworkPath, [
    "check",
  ]);

  if (result.exitCode === 0) {
    return NO_NETWORK;
  }

  if (result.errorCode === "ENOENT") {
    return sharedBecause(
      NO_NETWORK_FILTER_MISSING_REASON,
      GlobalRunnerStepNetworkReason.NotInstalled,
    );
  }

  if (result.exitCode === NO_NETWORK_EXIT_NO_FILTER) {
    return sharedBecause(
      NO_SECCOMP_REASON,
      GlobalRunnerStepNetworkReason.NoSeccomp,
    );
  }

  return sharedBecause(
    `the JavaScript sandbox's network filter's check failed (${
      result.exitCode === null
        ? result.errorCode || "it did not finish"
        : `exit code ${result.exitCode}`
    })`,
    GlobalRunnerStepNetworkReason.CheckFailed,
  );
}

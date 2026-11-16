import { GlobalRunnerStepNetworkReason } from "Common/Types/Runner/GlobalRunnerSandbox";
import {
  LauncherCallResult,
  LauncherCaller,
} from "../../../Utils/JavaScriptSandbox/SandboxIdentity";
import {
  NO_NETWORK_FILTER_MISSING_REASON,
  NO_SECCOMP_REASON,
  SANDBOX_NO_NETWORK_PATH,
  SandboxNetwork,
  SandboxNetworkDecision,
  decideSandboxNetwork,
} from "../../../Utils/JavaScriptSandbox/SandboxNetwork";

/*
 * Whether a global Runner's JavaScript step gets no network of its own, read
 * from the no-network filter's own check: it opens no socket where the kernel
 * and the container let a process filter its system calls (what every Linux
 * Docker or Kubernetes runs, and OpenShift's restricted SCC with
 * RuntimeDefault); it shares the Runner's network where they do not, or where
 * the filter is not installed, and says why.
 */

function caller(result: LauncherCallResult): LauncherCaller {
  return async (
    filterPath: string,
    args: Array<string>,
  ): Promise<LauncherCallResult> => {
    expect(filterPath).toBe(SANDBOX_NO_NETWORK_PATH);
    expect(args).toEqual(["check"]);
    return result;
  };
}

const EXISTS: (filePath: string) => boolean = (): boolean => {
  return true;
};

describe("whether a step's process gets no network", () => {
  test("the filter's check passes: no network, no reason", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: 0, errorCode: null }),
      platform: "linux",
      exists: EXISTS,
    });

    expect(decision).toEqual({
      network: SandboxNetwork.None,
      reason: null,
      reasonCode: null,
    });
  });

  test("the filter cannot be set (exit 72): the step shares the network, for want of seccomp", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: 72, errorCode: null }),
      platform: "linux",
      exists: EXISTS,
    });

    expect(decision).toEqual({
      network: SandboxNetwork.Shared,
      reason: NO_SECCOMP_REASON,
      reasonCode: GlobalRunnerStepNetworkReason.NoSeccomp,
    });
  });

  test("not on Linux: the step shares the network, for want of the filter", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: 0, errorCode: null }),
      platform: "darwin",
      exists: EXISTS,
    });

    expect(decision.network).toBe(SandboxNetwork.Shared);
    expect(decision.reason).toBe(NO_NETWORK_FILTER_MISSING_REASON);
    expect(decision.reasonCode).toBe(
      GlobalRunnerStepNetworkReason.NotInstalled,
    );
  });

  test("no filter on disk: the step shares the network, for want of the filter", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: 0, errorCode: null }),
      platform: "linux",
      exists: (): boolean => {
        return false;
      },
    });

    expect(decision.network).toBe(SandboxNetwork.Shared);
    expect(decision.reasonCode).toBe(
      GlobalRunnerStepNetworkReason.NotInstalled,
    );
  });

  test("it could not be run (ENOENT): for want of the filter", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: null, errorCode: "ENOENT" }),
      platform: "linux",
      exists: EXISTS,
    });

    expect(decision.reasonCode).toBe(
      GlobalRunnerStepNetworkReason.NotInstalled,
    );
  });

  test("any other failure is a failed check, with the exit code said", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: 70, errorCode: null }),
      platform: "linux",
      exists: EXISTS,
    });

    expect(decision.network).toBe(SandboxNetwork.Shared);
    expect(decision.reasonCode).toBe(GlobalRunnerStepNetworkReason.CheckFailed);
    expect(decision.reason).toContain("exit code 70");
  });

  test("a check that did not finish says so", async () => {
    const decision: SandboxNetworkDecision = await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: caller({ exitCode: null, errorCode: null }),
      platform: "linux",
      exists: EXISTS,
    });

    expect(decision.reasonCode).toBe(GlobalRunnerStepNetworkReason.CheckFailed);
    expect(decision.reason).toContain("did not finish");
  });
});

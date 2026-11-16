import {
  GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY,
  GlobalRunnerSandboxReport,
  GlobalRunnerSandboxShortfall,
  GlobalRunnerStepNetwork,
  GlobalRunnerStepNetworkReason,
  GlobalRunnerStepUser,
  GlobalRunnerStepUserReason,
  getGlobalRunnerSandboxShortfalls,
  parseGlobalRunnerSandboxReport,
} from "../../../Types/Runner/GlobalRunnerSandbox";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A GLOBAL RUNNER KEEPS EACH PROJECT'S JAVASCRIPT STEP APART, AS IT SAYS
 * ON ITS HEARTBEAT (#8911, #8910).
 *
 * A global Runner says, under its hostInfo, who a step's process runs as and
 * whether it has a network, and why not. The Admin Dashboard reads it to say,
 * under the Runner's status, when a step gets less than a user of its own and
 * no network. Pure, so the Runner and the dashboard read it the same way.
 */

function hostInfoOf(report: Partial<GlobalRunnerSandboxReport>): unknown {
  return { [GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY]: report };
}

describe("parseGlobalRunnerSandboxReport", () => {
  test("reads a whole report", () => {
    expect(
      parseGlobalRunnerSandboxReport(
        hostInfoOf({
          user: GlobalRunnerStepUser.RunnerUser,
          userReason: GlobalRunnerStepUserReason.NoPrivilege,
          network: GlobalRunnerStepNetwork.Shared,
          networkReason: GlobalRunnerStepNetworkReason.NoSeccomp,
        }),
      ),
    ).toEqual({
      user: GlobalRunnerStepUser.RunnerUser,
      userReason: GlobalRunnerStepUserReason.NoPrivilege,
      network: GlobalRunnerStepNetwork.Shared,
      networkReason: GlobalRunnerStepNetworkReason.NoSeccomp,
    });
  });

  test("a step with a user of its own and no network carries no reasons", () => {
    expect(
      parseGlobalRunnerSandboxReport(
        hostInfoOf({
          user: GlobalRunnerStepUser.OwnUser,
          network: GlobalRunnerStepNetwork.None,
        }),
      ),
    ).toEqual({
      user: GlobalRunnerStepUser.OwnUser,
      network: GlobalRunnerStepNetwork.None,
    });
  });

  test("a reason the report does not name reads as a failed check", () => {
    const report: GlobalRunnerSandboxReport | null =
      parseGlobalRunnerSandboxReport(
        hostInfoOf({
          user: GlobalRunnerStepUser.RunnerUser,
          network: GlobalRunnerStepNetwork.Shared,
        }),
      );

    expect(report!.userReason).toBe(GlobalRunnerStepUserReason.CheckFailed);
    expect(report!.networkReason).toBe(
      GlobalRunnerStepNetworkReason.CheckFailed,
    );
  });

  test.each([
    ["nothing", undefined],
    ["not an object", 7],
    ["an array", []],
    ["no sandbox key", { kubernetes: {} }],
    ["a user it does not know", hostInfoOf({ user: "root" } as never)],
    [
      "a network it does not know",
      hostInfoOf({
        user: GlobalRunnerStepUser.OwnUser,
        network: "some",
      } as never),
    ],
  ])(
    "reads null from %s (a Runner of a release that does not say)",
    (_label: string, hostInfo: unknown) => {
      expect(parseGlobalRunnerSandboxReport(hostInfo)).toBeNull();
    },
  );
});

describe("getGlobalRunnerSandboxShortfalls", () => {
  test("none for a Runner whose steps get a user of their own and no network", () => {
    expect(
      getGlobalRunnerSandboxShortfalls({
        user: GlobalRunnerStepUser.OwnUser,
        network: GlobalRunnerStepNetwork.None,
      }),
    ).toEqual([]);
  });

  test("none for a report that is not there", () => {
    expect(getGlobalRunnerSandboxShortfalls(null)).toEqual([]);
  });

  test.each([
    [
      GlobalRunnerStepUserReason.NoPrivilege,
      GlobalRunnerSandboxShortfall.OwnUserNoPrivilege,
    ],
    [
      GlobalRunnerStepUserReason.NotInNodeGroup,
      GlobalRunnerSandboxShortfall.OwnUserNotInNodeGroup,
    ],
    [
      GlobalRunnerStepUserReason.NotInstalled,
      GlobalRunnerSandboxShortfall.OwnUserNotInstalled,
    ],
    [
      GlobalRunnerStepUserReason.CheckFailed,
      GlobalRunnerSandboxShortfall.OwnUserCheckFailed,
    ],
  ])(
    "the user alone (%s) is one shortfall",
    (
      reason: GlobalRunnerStepUserReason,
      shortfall: GlobalRunnerSandboxShortfall,
    ) => {
      expect(
        getGlobalRunnerSandboxShortfalls({
          user: GlobalRunnerStepUser.RunnerUser,
          userReason: reason,
          network: GlobalRunnerStepNetwork.None,
        }),
      ).toEqual([shortfall]);
    },
  );

  test.each([
    [
      GlobalRunnerStepNetworkReason.NoSeccomp,
      GlobalRunnerSandboxShortfall.SharedNetworkNoSeccomp,
    ],
    [
      GlobalRunnerStepNetworkReason.NotInstalled,
      GlobalRunnerSandboxShortfall.SharedNetworkNotInstalled,
    ],
    [
      GlobalRunnerStepNetworkReason.CheckFailed,
      GlobalRunnerSandboxShortfall.SharedNetworkCheckFailed,
    ],
  ])(
    "the network alone (%s) is one shortfall",
    (
      reason: GlobalRunnerStepNetworkReason,
      shortfall: GlobalRunnerSandboxShortfall,
    ) => {
      expect(
        getGlobalRunnerSandboxShortfalls({
          user: GlobalRunnerStepUser.OwnUser,
          network: GlobalRunnerStepNetwork.Shared,
          networkReason: reason,
        }),
      ).toEqual([shortfall]);
    },
  );

  test("a Runner run from its sources (both not installed) is the one combined shortfall", () => {
    expect(
      getGlobalRunnerSandboxShortfalls({
        user: GlobalRunnerStepUser.RunnerUser,
        userReason: GlobalRunnerStepUserReason.NotInstalled,
        network: GlobalRunnerStepNetwork.Shared,
        networkReason: GlobalRunnerStepNetworkReason.NotInstalled,
      }),
    ).toEqual([GlobalRunnerSandboxShortfall.NotInstalled]);
  });

  test("the user and the network, for different reasons: a shortfall each, user first", () => {
    expect(
      getGlobalRunnerSandboxShortfalls({
        user: GlobalRunnerStepUser.RunnerUser,
        userReason: GlobalRunnerStepUserReason.NoPrivilege,
        network: GlobalRunnerStepNetwork.Shared,
        networkReason: GlobalRunnerStepNetworkReason.NoSeccomp,
      }),
    ).toEqual([
      GlobalRunnerSandboxShortfall.OwnUserNoPrivilege,
      GlobalRunnerSandboxShortfall.SharedNetworkNoSeccomp,
    ]);
  });
});

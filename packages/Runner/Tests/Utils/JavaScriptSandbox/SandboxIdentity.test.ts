jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import {
  LAUNCHER_EXIT_NO_PRIVILEGE,
  LAUNCHER_MISSING_REASON,
  LAUNCHER_NOT_RUNNABLE_REASON,
  LauncherCallResult,
  LauncherCaller,
  NO_PRIVILEGE_REASON,
  SANDBOX_IDENTITY_MAX,
  SANDBOX_IDENTITY_MIN,
  SANDBOX_LAUNCHER_PATH,
  SandboxIdentityPool,
  SandboxIsolation,
  SandboxIsolationDecision,
  decideSandboxIsolation,
  isLiveProcessOfUser,
} from "../../../Utils/JavaScriptSandbox/SandboxIdentity";
import { GlobalRunnerStepUserReason } from "Common/Types/Runner/GlobalRunnerSandbox";
import logger from "Common/Server/Utils/Logger";
import fs from "fs";
import path from "path";

/*
 * Who a global Runner's JavaScript step runs as: a user of its own when the
 * launcher's check says the container allows it, the Runner's own user
 * otherwise (said, with why); one user per running step, never shared, and
 * reaped before another step gets it - and never given out again while a
 * process of it is alive.
 */

const warn: jest.Mock = logger.warn as jest.Mock;

function caller(
  answers: Record<string, LauncherCallResult>,
  calls: Array<Array<string>> = [],
): LauncherCaller {
  return (
    _launcherPath: string,
    args: Array<string>,
  ): Promise<LauncherCallResult> => {
    calls.push(args);
    return Promise.resolve(
      answers[args[0]!] || { exitCode: 0, errorCode: null },
    );
  };
}

function decide(
  answer: LauncherCallResult,
  overrides: { platform?: NodeJS.Platform; exists?: boolean } = {},
): Promise<SandboxIsolationDecision> {
  return decideSandboxIsolation({
    launcherPath: SANDBOX_LAUNCHER_PATH,
    call: caller({ check: answer }),
    platform: overrides.platform || "linux",
    launcherExists: (): boolean => {
      return overrides.exists !== false;
    },
  });
}

beforeEach(() => {
  warn.mockClear();
});

describe("decideSandboxIsolation", () => {
  test("a launcher whose check passes gives each step a user of its own", async () => {
    expect(await decide({ exitCode: 0, errorCode: null })).toEqual({
      isolation: SandboxIsolation.OwnUser,
      reason: null,
      reasonCode: null,
    });
  });

  test("a container that forbids switching users keeps steps in their own process, and says why", async () => {
    expect(
      await decide({ exitCode: LAUNCHER_EXIT_NO_PRIVILEGE, errorCode: null }),
    ).toEqual({
      isolation: SandboxIsolation.OwnProcess,
      reason: NO_PRIVILEGE_REASON,
      reasonCode: GlobalRunnerStepUserReason.NoPrivilege,
    });
  });

  test("a Runner whose user may not run the launcher says so", async () => {
    expect(await decide({ exitCode: null, errorCode: "EACCES" })).toEqual({
      isolation: SandboxIsolation.OwnProcess,
      reason: LAUNCHER_NOT_RUNNABLE_REASON,
      reasonCode: GlobalRunnerStepUserReason.NotInNodeGroup,
    });
  });

  test("no launcher (a Runner run from its sources), or not Linux: never asked", async () => {
    const calls: Array<Array<string>> = [];

    for (const decision of [
      await decide({ exitCode: 0, errorCode: null }, { exists: false }),
      await decide({ exitCode: 0, errorCode: null }, { platform: "darwin" }),
      await decide({ exitCode: null, errorCode: "ENOENT" }),
    ]) {
      expect(decision).toEqual({
        isolation: SandboxIsolation.OwnProcess,
        reason: LAUNCHER_MISSING_REASON,
        reasonCode: GlobalRunnerStepUserReason.NotInstalled,
      });
    }

    await decideSandboxIsolation({
      launcherPath: SANDBOX_LAUNCHER_PATH,
      call: caller({}, calls),
      platform: "linux",
      launcherExists: (): boolean => {
        return false;
      },
    });
    expect(calls).toEqual([]);
  });

  test("any other answer keeps steps in their own process, with the answer", async () => {
    expect(await decide({ exitCode: 70, errorCode: null })).toEqual({
      isolation: SandboxIsolation.OwnProcess,
      reason: "the JavaScript sandbox launcher's check failed (exit code 70)",
      reasonCode: GlobalRunnerStepUserReason.CheckFailed,
    });
    expect((await decide({ exitCode: null, errorCode: null })).reason).toBe(
      "the JavaScript sandbox launcher's check failed (it did not finish)",
    );
  });

  test("only the launcher's check is asked", async () => {
    const calls: Array<Array<string>> = [];

    await decideSandboxIsolation({
      launcherPath: SANDBOX_LAUNCHER_PATH,
      call: caller({}, calls),
      platform: "linux",
      launcherExists: (): boolean => {
        return true;
      },
    });

    expect(calls).toEqual([["check"]]);
  });
});

describe("SandboxIdentityPool", () => {
  function poolOf(
    overrides: {
      calls?: Array<Array<string>>;
      live?: Set<number>;
      reapAnswer?: LauncherCallResult;
      min?: number;
      max?: number;
    } = {},
  ): SandboxIdentityPool {
    return new SandboxIdentityPool({
      launcherPath: SANDBOX_LAUNCHER_PATH,
      call: caller(
        overrides.reapAnswer ? { reap: overrides.reapAnswer } : {},
        overrides.calls || [],
      ),
      hasLiveProcess: (uid: number): boolean => {
        return Boolean(overrides.live?.has(uid));
      },
      min: overrides.min,
      max: overrides.max,
    });
  }

  test("the same range as the launcher's", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../Utils/JavaScriptSandbox/Native/javascript-sandbox.c",
      ),
      "utf8",
    );

    expect(source).toContain(
      `#define SANDBOX_IDENTITY_MIN ${SANDBOX_IDENTITY_MIN}UL`,
    );
    expect(source).toContain(
      `#define SANDBOX_IDENTITY_MAX ${SANDBOX_IDENTITY_MAX}UL`,
    );
    expect(SANDBOX_IDENTITY_MIN).toBeGreaterThan(60000);
    expect(SANDBOX_IDENTITY_MAX).toBeLessThan(65534);
  });

  test("steps that run at once each get a user no other holds", () => {
    const pool: SandboxIdentityPool = poolOf();
    const held: Array<number> = [
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ];

    expect(new Set(held).size).toBe(3);
    for (const uid of held) {
      expect(uid).toBeGreaterThanOrEqual(SANDBOX_IDENTITY_MIN);
      expect(uid).toBeLessThanOrEqual(SANDBOX_IDENTITY_MAX);
    }
    expect(pool.activeCount).toBe(3);
  });

  test("a step's user is reaped when it ends, then given back", async () => {
    const calls: Array<Array<string>> = [];
    const pool: SandboxIdentityPool = poolOf({ calls, min: 61000, max: 61001 });

    const first: number = pool.acquire();
    await pool.release(first);

    expect(calls).toEqual([["reap", String(first)]]);
    expect(pool.activeCount).toBe(0);

    // The range turns over and the same number comes back.
    expect(pool.acquire()).toBe(61001);
    expect(pool.acquire()).toBe(first);
  });

  test("users are taken in turn, so an ended step's user rests before it is taken again", () => {
    const pool: SandboxIdentityPool = poolOf({ min: 61000, max: 61002 });
    const first: number = pool.acquire();

    void pool.release(first);

    expect(pool.acquire()).toBe(61001);
    expect(pool.acquire()).toBe(61002);
  });

  test("a user with a process still alive after the reap is never given out again", async () => {
    const live: Set<number> = new Set<number>([61000]);
    const pool: SandboxIdentityPool = poolOf({ live, min: 61000, max: 61001 });

    const leftBehind: number = pool.acquire();
    await pool.release(leftBehind);

    expect(pool.isQuarantined(leftBehind)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("still has a process after the step ended"),
    );
    expect(pool.acquire()).toBe(61001);
    expect(() => {
      return pool.acquire();
    }).toThrow("Every JavaScript sandbox user is in use");
  });

  test("a reap that fails is said, and the user is given back only if nothing of it is alive", async () => {
    const pool: SandboxIdentityPool = poolOf({
      reapAnswer: { exitCode: 70, errorCode: null },
      min: 61000,
      max: 61000,
    });

    const uid: number = pool.acquire();
    await pool.release(uid);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not clear user 61000"),
    );
    expect(pool.isQuarantined(uid)).toBe(false);
    expect(pool.acquire()).toBe(uid);
  });

  test("with every user taken, no step is given one", () => {
    const pool: SandboxIdentityPool = poolOf({ min: 61000, max: 61000 });

    pool.acquire();

    expect(() => {
      return pool.acquire();
    }).toThrow("Every JavaScript sandbox user is in use");
  });
});

describe("isLiveProcessOfUser", () => {
  function statusOf(uidLine: string, state: string): string {
    return [
      "Name:\tnode",
      `State:\t${state}`,
      "Tgid:\t42",
      `Uid:\t${uidLine}`,
      "Gid:\t61000\t61000\t61000\t61000",
    ].join("\n");
  }

  test("a running process of the user is alive", () => {
    expect(
      isLiveProcessOfUser(
        statusOf("61000\t61000\t61000\t61000", "S (sleeping)"),
        61000,
      ),
    ).toBe(true);
  });

  test("so is a process that holds the user only as its effective or saved user (its launcher)", () => {
    expect(
      isLiveProcessOfUser(
        statusOf("1000\t61000\t61000\t61000", "S (sleeping)"),
        61000,
      ),
    ).toBe(true);
  });

  test("a zombie or a dead process is not", () => {
    for (const state of ["Z (zombie)", "X (dead)"]) {
      expect(
        isLiveProcessOfUser(
          statusOf("61000\t61000\t61000\t61000", state),
          61000,
        ),
      ).toBe(false);
    }
  });

  test("another user's process is not", () => {
    expect(
      isLiveProcessOfUser(
        statusOf("61001\t61001\t61001\t61001", "R (running)"),
        61000,
      ),
    ).toBe(false);
  });
});

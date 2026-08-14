import * as childProcess from "child_process";
import { ChildProcess, ForkOptions } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import ProcessRunner, {
  ProcessRunResult,
  ProcessRunnerOptions,
  SyntheticProcessRunnerError,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import {
  SyntheticWorkerStartEnvelope,
  createWorkerNonce,
  createWorkerSuccessEnvelope,
} from "../../../../Utils/Monitors/SyntheticRuntime/WorkerProtocol";

jest.mock("child_process", () => {
  const actual: typeof import("child_process") =
    jest.requireActual("child_process");
  return {
    ...actual,
    execFileSync: jest.fn(),
    fork: jest.fn(),
  };
});

interface TestConfig {
  readonly monitorId: string;
}

interface TestResult {
  readonly value: string;
}

type SendCallback = (error: Error | null) => void;

const SYSTEM_TEMP_DIRECTORY: string = os.tmpdir();
let testTemporaryRoot: string | null = null;

interface ManualTimer {
  readonly callback: () => void;
  readonly delayInMs: number;
  cleared: boolean;
}

interface ManualTimerController {
  readonly fireByDelay: (delayInMs: number) => void;
  readonly activeTimerCount: (delayInMs?: number) => number;
}

interface ProcessGroupSignalMock {
  readonly signals: NodeJS.Signals[];
  readonly spy: jest.SpyInstance;
}

function installManualTimers(): ManualTimerController {
  const timers: ManualTimer[] = [];
  jest.spyOn(global, "setTimeout").mockImplementation(((
    callback: () => void,
    delayInMs?: number,
  ): NodeJS.Timeout => {
    const timer: ManualTimer = {
      callback,
      delayInMs: delayInMs || 0,
      cleared: false,
    };
    timers.push(timer);
    return timer as unknown as NodeJS.Timeout;
  }) as typeof global.setTimeout);
  jest.spyOn(global, "clearTimeout").mockImplementation(((
    handle: NodeJS.Timeout | undefined,
  ): void => {
    if (handle) {
      (handle as unknown as ManualTimer).cleared = true;
    }
  }) as typeof global.clearTimeout);

  return {
    fireByDelay: (delayInMs: number): void => {
      const timer: ManualTimer | undefined = timers.find(
        (candidate: ManualTimer) => {
          return !candidate.cleared && candidate.delayInMs === delayInMs;
        },
      );
      if (!timer) {
        throw new Error(`No active ${delayInMs}ms timer was scheduled.`);
      }
      timer.cleared = true;
      timer.callback();
    },
    activeTimerCount: (delayInMs?: number): number => {
      return timers.filter((timer: ManualTimer) => {
        return (
          !timer.cleared &&
          (delayInMs === undefined || timer.delayInMs === delayInMs)
        );
      }).length;
    },
  };
}

class FakeChildProcess extends EventEmitter {
  public readonly pid: number;
  public readonly stdout: PassThrough = new PassThrough();
  public readonly stderr: PassThrough = new PassThrough();
  public readonly kill: jest.Mock<boolean, [NodeJS.Signals?]> = jest.fn(() => {
    return true;
  });
  public readonly sentMessages: unknown[] = [];
  public onSend: ((message: unknown) => void) | undefined;
  public sendError: Error | undefined;

  public readonly send: jest.Mock<
    boolean,
    [message: unknown, callback?: SendCallback | undefined]
  > = jest.fn((message: unknown, callback?: SendCallback): boolean => {
    if (this.sendError) {
      throw this.sendError;
    }

    this.sentMessages.push(message);
    callback?.(null);
    this.onSend?.(message);
    return true;
  });

  public constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function asChildProcess(child: FakeChildProcess): ChildProcess {
  return child as unknown as ChildProcess;
}

function getForkMock(): jest.Mock {
  return childProcess.fork as unknown as jest.Mock;
}

function getExecFileSyncMock(): jest.Mock {
  return childProcess.execFileSync as unknown as jest.Mock;
}

function isTestResult(value: unknown): value is TestResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>)["value"] === "string",
  );
}

function startEnvelopeFrom(
  child: FakeChildProcess,
): SyntheticWorkerStartEnvelope<TestConfig> {
  const message: unknown = child.sentMessages[0];

  if (!message || typeof message !== "object") {
    throw new Error("Worker start envelope was not sent.");
  }

  return message as SyntheticWorkerStartEnvelope<TestConfig>;
}

function emitSuccess(child: FakeChildProcess, result: TestResult): void {
  const startEnvelope: SyntheticWorkerStartEnvelope<TestConfig> =
    startEnvelopeFrom(child);
  child.emit(
    "message",
    createWorkerSuccessEnvelope({
      nonce: startEnvelope.nonce,
      result,
    }),
  );
}

function emitExit(
  child: FakeChildProcess,
  signal: NodeJS.Signals | null,
): void {
  child.emit("exit", signal ? null : 0, signal);
  child.stdout.end();
  child.stderr.end();
}

function mockProcessGroupSignals(data: {
  child: FakeChildProcess;
  exitOn: NodeJS.Signals;
}): ProcessGroupSignalMock {
  const callerProcessGroupId: number = 900_000;
  getExecFileSyncMock().mockReturnValue(
    `${process.pid} 1 ${callerProcessGroupId}\n${data.child.pid} ${process.pid} ${data.child.pid}\n` as never,
  );
  const signals: NodeJS.Signals[] = [];
  let groupIsAlive: boolean = true;
  const spy: jest.SpyInstance = jest
    .spyOn(process, "kill")
    .mockImplementation((pid: number, signal?: string | number): true => {
      if (pid === -data.child.pid && signal === 0) {
        if (groupIsAlive) {
          return true;
        }

        throw Object.assign(new Error("Process group does not exist."), {
          code: "ESRCH",
        });
      }

      if (pid === -data.child.pid && typeof signal === "string") {
        signals.push(signal as NodeJS.Signals);

        if (signal === data.exitOn) {
          global.setImmediate(() => {
            groupIsAlive = false;
            emitExit(data.child, data.exitOn);
          });
        }
      }

      return true;
    });

  return { signals, spy };
}

function forkOptionsAt(forkSpy: jest.SpyInstance, index: number): ForkOptions {
  const call: unknown[] | undefined = forkSpy.mock.calls[index];
  const options: unknown = call?.[2];

  if (!options || typeof options !== "object") {
    throw new Error("Expected child process fork options.");
  }

  return options as ForkOptions;
}

async function waitForForkCount(
  forkSpy: jest.SpyInstance,
  count: number,
): Promise<void> {
  const startedAt: [number, number] = process.hrtime();
  while (true) {
    if (forkSpy.mock.calls.length >= count) {
      return;
    }

    const elapsed: [number, number] = process.hrtime(startedAt);
    if (elapsed[0] * 1000 + elapsed[1] / 1_000_000 >= 5000) {
      break;
    }

    await new Promise<void>((resolve: () => void) => {
      global.setImmediate(resolve);
    });
  }

  throw new Error(`Expected ${count} child processes to be forked.`);
}

async function flushMicrotasks(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await Promise.resolve();
  }
}

async function waitForActiveTimer(
  timers: { readonly activeTimerCount: (delayInMs?: number) => number },
  delayInMs: number,
): Promise<void> {
  const startedAt: [number, number] = process.hrtime();
  while (true) {
    if (timers.activeTimerCount(delayInMs) > 0) {
      return;
    }

    const elapsed: [number, number] = process.hrtime(startedAt);
    if (elapsed[0] * 1000 + elapsed[1] / 1_000_000 >= 5000) {
      break;
    }

    await new Promise<void>((resolve: () => void) => {
      global.setImmediate(resolve);
    });
  }

  throw new Error(`Expected an active ${delayInMs}ms timer.`);
}

describe("SyntheticRuntime ProcessRunner", () => {
  beforeEach(() => {
    testTemporaryRoot = fs.mkdtempSync(
      path.join(SYSTEM_TEMP_DIRECTORY, "oneuptime-process-runner-test-"),
    );
    jest.spyOn(os, "tmpdir").mockReturnValue(testTemporaryRoot);
    jest
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: string | number): true => {
        if (signal === 0) {
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }
        return true;
      });
  });

  afterEach(() => {
    const temporaryRootToRemove: string | null = testTemporaryRoot;
    testTemporaryRoot = null;
    jest.restoreAllMocks();
    getForkMock().mockReset();
    getExecFileSyncMock().mockReset();
    if (temporaryRootToRemove) {
      fs.rmSync(temporaryRootToRemove, { recursive: true, force: true });
    }
  });

  test("scavenges stale run directories while preserving active and ambiguous paths", async () => {
    const temporaryRoot: string = testTemporaryRoot as string;
    let nowInMs: number = 2_000_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });

    const livePid: number = 880_001;
    const deadPid: number = 880_002;
    jest
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number): true => {
        if (signal === 0 && pid === livePid) {
          return true;
        }
        if (signal === 0) {
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }
        return true;
      });

    const staleDeadDirectory: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-${deadPid}-${"a".repeat(32)}-DEAD01`,
    );
    const otherLiveDirectory: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-${livePid}-${"b".repeat(32)}-LIVE01`,
    );
    const foreignPidOneDirectory: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-1-${"f".repeat(32)}-PID001`,
    );
    const oldLegacyDirectory: string = path.join(
      temporaryRoot,
      "oneuptime-synthetic-runtime-legacy-old",
    );
    const freshLegacyDirectory: string = path.join(
      temporaryRoot,
      "oneuptime-synthetic-runtime-legacy-fresh",
    );
    const symlinkTarget: string = path.join(temporaryRoot, "symlink-target");
    const matchingSymlink: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-${deadPid}-${"c".repeat(32)}-LINK01`,
    );
    const matchingFile: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-${deadPid}-${"d".repeat(32)}-FILE01`,
    );

    fs.mkdirSync(staleDeadDirectory);
    fs.mkdirSync(otherLiveDirectory);
    fs.mkdirSync(foreignPidOneDirectory);
    fs.mkdirSync(oldLegacyDirectory);
    fs.mkdirSync(freshLegacyDirectory);
    fs.mkdirSync(symlinkTarget);
    fs.symlinkSync(symlinkTarget, matchingSymlink, "dir");
    fs.writeFileSync(matchingFile, "must remain");
    fs.utimesSync(
      oldLegacyDirectory,
      new Date(nowInMs - 25 * 60 * 60 * 1000),
      new Date(nowInMs - 25 * 60 * 60 * 1000),
    );
    fs.utimesSync(freshLegacyDirectory, new Date(nowInMs), new Date(nowInMs));

    const firstChild: FakeChildProcess = new FakeChildProcess(40_101);
    const secondChild: FakeChildProcess = new FakeChildProcess(40_102);
    firstChild.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(firstChild, { value: "first" });
        emitExit(firstChild, null);
      });
    };
    secondChild.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(secondChild, { value: "second" });
        emitExit(secondChild, null);
      });
    };
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(firstChild);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(secondChild);
      });
    const firstRunner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    await expect(
      firstRunner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "first" } });

    const activeHome: string = forkOptionsAt(forkMock, 0).env?.[
      "HOME"
    ] as string;
    const activeNameMatch: RegExpMatchArray | null = path
      .basename(activeHome)
      .match(
        /^oneuptime-synthetic-runtime-v2-(\d+)-([a-f0-9]{32})-[A-Za-z0-9]{6}$/,
      );
    expect(activeNameMatch?.[1]).toBe(String(process.pid));
    expect(fs.existsSync(activeHome)).toBe(false);
    expect(fs.existsSync(staleDeadDirectory)).toBe(false);
    expect(fs.existsSync(otherLiveDirectory)).toBe(true);
    expect(fs.existsSync(foreignPidOneDirectory)).toBe(true);
    expect(fs.existsSync(oldLegacyDirectory)).toBe(false);
    expect(fs.existsSync(freshLegacyDirectory)).toBe(true);
    expect(fs.lstatSync(matchingSymlink).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(symlinkTarget)).toBe(true);
    expect(fs.readFileSync(matchingFile, "utf8")).toBe("must remain");

    const currentToken: string = activeNameMatch?.[2] as string;
    fs.mkdirSync(activeHome);
    const mismatchedToken: string =
      currentToken === "e".repeat(32) ? "f".repeat(32) : "e".repeat(32);
    const reusedPidDirectory: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-${process.pid}-${mismatchedToken}-REUSE1`,
    );
    fs.mkdirSync(reusedPidDirectory);

    nowInMs += 5 * 60 * 1000 + 1;
    const secondRunner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });
    await expect(
      secondRunner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-2" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "second" } });

    expect(fs.existsSync(activeHome)).toBe(true);
    expect(fs.existsSync(reusedPidDirectory)).toBe(false);
    expect(fs.existsSync(otherLiveDirectory)).toBe(true);
    expect(fs.existsSync(foreignPidOneDirectory)).toBe(true);

    fs.rmSync(activeHome, { recursive: true, force: true });
  });

  test("removes a token-mismatched crash directory when the supervisor is PID 1", async () => {
    const temporaryRoot: string = testTemporaryRoot as string;
    let nowInMs: number = 3000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });

    const children: FakeChildProcess[] = [
      new FakeChildProcess(40_151),
      new FakeChildProcess(40_152),
    ];
    for (const child of children) {
      child.onSend = (): void => {
        global.setImmediate(() => {
          emitSuccess(child, { value: "complete" });
          emitExit(child, null);
        });
      };
    }
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(children[0] as FakeChildProcess);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(children[1] as FakeChildProcess);
      });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    await runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const firstRunDirectoryName: string = path.basename(
      forkOptionsAt(forkMock, 0).env?.["HOME"] as string,
    );
    const currentToken: string = firstRunDirectoryName.match(
      /^oneuptime-synthetic-runtime-v2-\d+-([a-f0-9]{32})-[A-Za-z0-9]{6}$/,
    )?.[1] as string;
    const mismatchedToken: string =
      currentToken === "a".repeat(32) ? "b".repeat(32) : "a".repeat(32);
    const reusedPidOneDirectory: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-1-${mismatchedToken}-PID101`,
    );
    fs.mkdirSync(reusedPidOneDirectory);

    nowInMs += 5 * 60 * 1000 + 1;
    const originalPidDescriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(process, "pid");
    Object.defineProperty(process, "pid", {
      configurable: true,
      enumerable: true,
      value: 1,
      writable: false,
    });
    try {
      await expect(
        runner.run<TestConfig, TestResult>({
          payload: { monitorId: "monitor-2" },
          timeoutInMs: 1000,
          validateResult: isTestResult,
        }),
      ).resolves.toMatchObject({ result: { value: "complete" } });
    } finally {
      if (originalPidDescriptor) {
        Object.defineProperty(process, "pid", originalPidDescriptor);
      }
    }

    expect(fs.existsSync(reusedPidOneDirectory)).toBe(false);
    expect(runner.activeCount).toBe(0);
  });

  test("fails safe on a scan error and retries on the next admitted run", async () => {
    const temporaryRoot: string = testTemporaryRoot as string;
    const staleDirectory: string = path.join(
      temporaryRoot,
      `oneuptime-synthetic-runtime-v2-880003-${"a".repeat(32)}-STALE1`,
    );
    fs.mkdirSync(staleDirectory);
    jest.spyOn(fs.promises, "opendir").mockRejectedValueOnce(
      Object.assign(new Error("Temporary directory is unreadable."), {
        code: "EACCES",
      }),
    );

    const children: FakeChildProcess[] = [
      new FakeChildProcess(40_201),
      new FakeChildProcess(40_202),
    ];
    for (const child of children) {
      child.onSend = (): void => {
        global.setImmediate(() => {
          emitSuccess(child, { value: "complete" });
          emitExit(child, null);
        });
      };
    }
    getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(children[0] as FakeChildProcess);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(children[1] as FakeChildProcess);
      });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "complete" } });
    expect(fs.existsSync(staleDirectory)).toBe(true);
    expect(runner.activeCount).toBe(0);

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-2" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "complete" } });
    expect(fs.existsSync(staleDirectory)).toBe(false);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  });

  test("deduplicates concurrent scavenges across runner instances", async () => {
    const temporaryRoot: string = testTemporaryRoot as string;
    const actualOpendir: typeof fs.promises.opendir = fs.promises.opendir.bind(
      fs.promises,
    );
    let rootScanCount: number = 0;
    jest.spyOn(fs.promises, "opendir").mockImplementation(((
      directoryPath: fs.PathLike,
    ): ReturnType<typeof fs.promises.opendir> => {
      if (String(directoryPath) === temporaryRoot) {
        rootScanCount++;
      }
      return actualOpendir(directoryPath);
    }) as typeof fs.promises.opendir);

    const children: FakeChildProcess[] = [
      new FakeChildProcess(40_301),
      new FakeChildProcess(40_302),
    ];
    for (const child of children) {
      child.onSend = (): void => {
        global.setImmediate(() => {
          emitSuccess(child, { value: "complete" });
          emitExit(child, null);
        });
      };
    }
    getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(children[0] as FakeChildProcess);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(children[1] as FakeChildProcess);
      });
    const runners: ProcessRunner[] = [
      new ProcessRunner({
        workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
        concurrencyLimit: 1,
      }),
      new ProcessRunner({
        workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
        concurrencyLimit: 1,
      }),
    ];

    await expect(
      Promise.all([
        runners[0]?.run<TestConfig, TestResult>({
          payload: { monitorId: "monitor-1" },
          timeoutInMs: 1000,
          validateResult: isTestResult,
        }),
        runners[1]?.run<TestConfig, TestResult>({
          payload: { monitorId: "monitor-2" },
          timeoutInMs: 1000,
          validateResult: isTestResult,
        }),
      ]),
    ).resolves.toHaveLength(2);

    expect(rootScanCount).toBe(1);
    expect(runners[0]?.activeCount).toBe(0);
    expect(runners[1]?.activeCount).toBe(0);
  });

  test("accounts scavenge time against the deadline and recovers its slot", async () => {
    let nowInMs: number = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });
    const actualOpendir: typeof fs.promises.opendir = fs.promises.opendir.bind(
      fs.promises,
    );
    jest.spyOn(fs.promises, "opendir").mockImplementationOnce((async (
      directoryPath: fs.PathLike,
    ): Promise<fs.Dir> => {
      const directory: fs.Dir = await actualOpendir(directoryPath);
      nowInMs = 1100;
      return directory;
    }) as typeof fs.promises.opendir);

    const child: FakeChildProcess = new FakeChildProcess(40_401);
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(child, { value: "recovered" });
        emitExit(child, null);
      });
    };
    const forkMock: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 100,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("timed out after 100ms");
    expect(forkMock).not.toHaveBeenCalled();
    expect(runner.activeCount).toBe(0);

    nowInMs = 1200;
    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-2" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "recovered" } });
    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  });

  test("sanitizes the child environment and bounds captured output", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(41_001);
    const forkSpy: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });

    child.onSend = (): void => {
      global.setImmediate(() => {
        child.stdout.write("0123456789");
        child.stderr.write("abcdefghij");
        emitSuccess(child, { value: "complete" });
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      environment: {
        PATH: "/safe/path",
        NODE_ENV: "test",
        PLAYWRIGHT_BROWSERS_PATH: "/playwright",
        PROBE_KEY: "must-not-leak",
        NODE_OPTIONS: "--inspect=0.0.0.0:9229",
      },
      maxOutputBytes: 8,
      maxOldSpaceSizeInMb: 128,
    });

    const runResult: ProcessRunResult<TestResult> = await runner.run<
      TestConfig,
      TestResult
    >({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });

    expect(runResult).toEqual({
      result: { value: "complete" },
      stdout: "[output truncated]\n23456789",
      stderr: "[output truncated]\ncdefghij",
      stdoutTruncated: true,
      stderrTruncated: true,
    });

    const options: ForkOptions = forkOptionsAt(forkSpy, 0);
    expect(options.detached).toBe(true);
    expect(options.serialization).toBe("advanced");
    expect(options.uid).toBeUndefined();
    expect(options.gid).toBeUndefined();
    expect(options.env?.["PATH"]).toBe("/safe/path");
    expect(options.env?.["NODE_ENV"]).toBe("test");
    expect(options.env?.["PLAYWRIGHT_BROWSERS_PATH"]).toBe("/playwright");
    expect(options.env?.["PROBE_KEY"]).toBeUndefined();
    expect(options.env?.["NODE_OPTIONS"]).toBeUndefined();
    expect(options.env?.["TS_NODE_TRANSPILE_ONLY"]).toBeUndefined();
    expect(options.env?.["HOME"]).toBe(options.env?.["TMPDIR"]);
    expect(options.env?.["XDG_RUNTIME_DIR"]).toBe(options.env?.["HOME"]);
    expect(options.env?.["CHROME_CONFIG_HOME"]).toBe(options.env?.["HOME"]);
    expect(options.env?.["CHROME_USER_DATA_DIR"]).toBe(options.env?.["HOME"]);
    expect(options.env?.["USERPROFILE"]).toBe(options.env?.["HOME"]);
    expect(options.env?.["LOCALAPPDATA"]).toBe(options.env?.["HOME"]);
    expect(options.env?.["APPDATA"]).toBe(options.env?.["HOME"]);
    expect(options.execArgv).toEqual([
      "--require",
      "ts-node/register/transpile-only",
      "--no-node-snapshot",
      "--max-old-space-size=128",
    ]);

    const temporaryHome: string | undefined = options.env?.["HOME"];
    expect(temporaryHome).toBeDefined();
    expect(fs.existsSync(temporaryHome as string)).toBe(false);
    expect(runner.activeCount).toBe(0);
  });

  test("maps credential-bearing proxy URLs without leaking unrelated environment credentials", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(41_101);
    const forkSpy: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(child, { value: "complete" });
        emitExit(child, null);
      });
    };

    const httpProxyUrl: string =
      "http://http-user:p%40ssword@http-proxy.internal:3128";
    const httpsProxyUrl: string =
      "http://https-user:s%3Acret@https-proxy.internal:3129";
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      environment: {
        HTTP_PROXY_URL: httpProxyUrl,
        HTTPS_PROXY_URL: httpsProxyUrl,
        NO_PROXY: "localhost,127.0.0.1",
        no_proxy: ".svc.internal",
        HTTP_PROXY_USERNAME: "must-not-leak",
        HTTPS_PROXY_PASSWORD: "must-not-leak",
        AWS_SECRET_ACCESS_KEY: "must-not-leak",
      },
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "complete" } });

    const environment: NodeJS.ProcessEnv | undefined = forkOptionsAt(
      forkSpy,
      0,
    ).env;
    expect(environment?.["HTTP_PROXY_URL"]).toBe(httpProxyUrl);
    expect(environment?.["HTTP_PROXY"]).toBe(httpProxyUrl);
    expect(environment?.["http_proxy"]).toBe(httpProxyUrl);
    expect(environment?.["HTTPS_PROXY_URL"]).toBe(httpsProxyUrl);
    expect(environment?.["HTTPS_PROXY"]).toBe(httpsProxyUrl);
    expect(environment?.["https_proxy"]).toBe(httpsProxyUrl);
    expect(environment?.["NO_PROXY"]).toBe("localhost,127.0.0.1");
    expect(environment?.["no_proxy"]).toBe(".svc.internal");
    expect(environment?.["HTTP_PROXY_USERNAME"]).toBeUndefined();
    expect(environment?.["HTTPS_PROXY_PASSWORD"]).toBeUndefined();
    expect(environment?.["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
  });

  test("preserves conventional proxy variables instead of overriding them with URL aliases", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(41_102);
    const forkSpy: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(child, { value: "complete" });
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      environment: {
        HTTP_PROXY_URL: "http://url-http-proxy.internal:3128",
        HTTPS_PROXY_URL: "http://url-https-proxy.internal:3129",
        HTTP_PROXY: "http://upper-http-proxy.internal:8080",
        https_proxy: "http://lower-https-proxy.internal:8443",
        NO_PROXY: "localhost",
      },
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "complete" } });

    const environment: NodeJS.ProcessEnv | undefined = forkOptionsAt(
      forkSpy,
      0,
    ).env;
    expect(environment?.["HTTP_PROXY"]).toBe(
      "http://upper-http-proxy.internal:8080",
    );
    expect(environment?.["http_proxy"]).toBeUndefined();
    expect(environment?.["HTTPS_PROXY"]).toBeUndefined();
    expect(environment?.["https_proxy"]).toBe(
      "http://lower-https-proxy.internal:8443",
    );
    expect(environment?.["NO_PROXY"]).toBe("localhost");
  });

  test("allocates distinct rotating identities for concurrent root children", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(0);
    const chownSpy: jest.SpyInstance = jest
      .spyOn(fs.promises, "chown")
      .mockResolvedValue(undefined);
    const children: FakeChildProcess[] = [
      new FakeChildProcess(42_001),
      new FakeChildProcess(42_002),
    ];
    const forkSpy: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(children[0] as FakeChildProcess);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(children[1] as FakeChildProcess);
      });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 2,
      childUid: 30_000,
      childGid: 40_000,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const secondRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });

    await waitForForkCount(forkSpy, 2);

    const firstOptions: ForkOptions = forkOptionsAt(forkSpy, 0);
    const secondOptions: ForkOptions = forkOptionsAt(forkSpy, 1);
    expect(firstOptions.uid).toBe(30_000);
    expect(firstOptions.gid).toBe(40_000);
    expect(secondOptions.uid).toBe(30_001);
    expect(secondOptions.gid).toBe(40_001);
    expect(firstOptions.uid).not.toBe(secondOptions.uid);
    expect(firstOptions.gid).not.toBe(secondOptions.gid);
    expect(chownSpy).toHaveBeenCalledWith(
      firstOptions.env?.["HOME"],
      firstOptions.uid,
      firstOptions.gid,
    );
    expect(chownSpy).toHaveBeenCalledWith(
      secondOptions.env?.["HOME"],
      secondOptions.uid,
      secondOptions.gid,
    );

    emitSuccess(children[0] as FakeChildProcess, { value: "first" });
    emitExit(children[0] as FakeChildProcess, null);
    emitSuccess(children[1] as FakeChildProcess, { value: "second" });
    emitExit(children[1] as FakeChildProcess, null);

    await expect(Promise.all([firstRun, secondRun])).resolves.toHaveLength(2);
    expect(fs.existsSync(firstOptions.env?.["HOME"] as string)).toBe(false);
    expect(fs.existsSync(secondOptions.env?.["HOME"] as string)).toBe(false);
    expect(runner.activeCount).toBe(0);
  });

  test("rejects a wrong nonce and terminates the detached process group", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(43_001);
    const forkSpy: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    const signalMock: ProcessGroupSignalMock = mockProcessGroupSignals({
      child,
      exitOn: "SIGTERM",
    });

    child.onSend = (): void => {
      global.setImmediate(() => {
        child.stderr.write("worker diagnostic");
        child.emit(
          "message",
          createWorkerSuccessEnvelope({
            nonce: createWorkerNonce(),
            result: { value: "untrusted" },
          }),
        );
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 20,
      killWaitInMs: 20,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).rejects.toMatchObject({
      name: "SyntheticProcessRunnerError",
      message: "Synthetic worker sent an invalid result envelope.",
      stderr: "worker diagnostic",
    });

    expect(signalMock.signals).toContain("SIGTERM");
    expect(signalMock.spy).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    const options: ForkOptions = forkOptionsAt(forkSpy, 0);
    expect(fs.existsSync(options.env?.["HOME"] as string)).toBe(false);
    expect(runner.activeCount).toBe(0);
  });

  test("escalates a timed out process group from TERM to KILL", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(44_001);
    const forkMock: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    const signalMock: ProcessGroupSignalMock = mockProcessGroupSignals({
      child,
      exitOn: "SIGKILL",
    });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 1,
      killWaitInMs: 20,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 250,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("timed out after 250ms");

    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(signalMock.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signalMock.spy).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    expect(signalMock.spy).toHaveBeenCalledWith(-child.pid, "SIGKILL");
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  });

  test("discovers, rescans, and kills descendant process groups", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(44_101);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });

    const callerProcessGroupId: number = 900_100;
    const browserPid: number = 54_101;
    const rendererPid: number = 54_102;
    const lateBrowserPid: number = 54_103;
    const firstProcessTable: string = [
      `${process.pid} 1 ${callerProcessGroupId}`,
      `${child.pid} ${process.pid} ${child.pid}`,
      `${browserPid} ${child.pid} ${browserPid}`,
      `${rendererPid} ${browserPid} ${browserPid}`,
    ].join("\n");
    const rescannedProcessTable: string = `${firstProcessTable}\n${lateBrowserPid} ${browserPid} ${lateBrowserPid}\n`;
    let snapshotCount: number = 0;
    getExecFileSyncMock().mockImplementation(() => {
      snapshotCount++;
      return (
        snapshotCount === 1 ? firstProcessTable : rescannedProcessTable
      ) as never;
    });

    const alivePids: Set<number> = new Set<number>([
      browserPid,
      rendererPid,
      lateBrowserPid,
    ]);
    const aliveProcessGroups: Set<number> = new Set<number>([
      child.pid,
      browserPid,
      lateBrowserPid,
    ]);
    const signals: Array<{ pid: number; signal: string }> = [];
    jest
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number): true => {
        if (signal === 0) {
          const isAlive: boolean =
            pid < 0
              ? aliveProcessGroups.has(Math.abs(pid))
              : alivePids.has(pid);
          if (isAlive) {
            return true;
          }
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }

        if (typeof signal === "string") {
          signals.push({ pid, signal });
        }

        if (signal === "SIGKILL") {
          if (pid < 0) {
            const processGroupId: number = Math.abs(pid);
            aliveProcessGroups.delete(processGroupId);
            if (processGroupId === browserPid) {
              alivePids.delete(browserPid);
              alivePids.delete(rendererPid);
            } else if (processGroupId === lateBrowserPid) {
              alivePids.delete(lateBrowserPid);
            } else if (processGroupId === child.pid) {
              global.setImmediate(() => {
                emitExit(child, "SIGKILL");
              });
            }
          } else {
            alivePids.delete(pid);
          }
        }

        return true;
      });

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 60,
      killWaitInMs: 60,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 100,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("timed out after 100ms");

    expect(signals).toEqual(
      expect.arrayContaining([
        { pid: -child.pid, signal: "SIGTERM" },
        { pid: -browserPid, signal: "SIGTERM" },
        { pid: browserPid, signal: "SIGTERM" },
        { pid: rendererPid, signal: "SIGTERM" },
        { pid: -lateBrowserPid, signal: "SIGTERM" },
        { pid: lateBrowserPid, signal: "SIGTERM" },
        { pid: -child.pid, signal: "SIGKILL" },
        { pid: -browserPid, signal: "SIGKILL" },
        { pid: -lateBrowserPid, signal: "SIGKILL" },
      ]),
    );
    expect(snapshotCount).toBeGreaterThan(1);
    expect(runner.activeCount).toBe(0);
  });

  test("never group-signals when the child group matches the caller", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(44_201);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    const callerProcessGroupId: number = 900_200;
    getExecFileSyncMock().mockReturnValue(
      `${process.pid} 1 ${callerProcessGroupId}\n${child.pid} ${process.pid} ${callerProcessGroupId}\n` as never,
    );
    const processKillSpy: jest.SpyInstance = jest
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: string | number) => {
        if (signal === 0) {
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }
        return true;
      });
    child.kill.mockImplementation((signal?: NodeJS.Signals): boolean => {
      global.setImmediate(() => {
        emitExit(child, signal || "SIGTERM");
      });
      return true;
    });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 20,
      killWaitInMs: 20,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 100,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("timed out after 100ms");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(
      processKillSpy.mock.calls.some((call: unknown[]) => {
        return call[0] === -callerProcessGroupId;
      }),
    ).toBe(false);
  });

  test("terminates and releases its slot when the initial IPC send throws", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(45_001);
    child.sendError = new Error("IPC channel closed");
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    const signalMock: ProcessGroupSignalMock = mockProcessGroupSignals({
      child,
      exitOn: "SIGTERM",
    });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 20,
      killWaitInMs: 20,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).rejects.toBeInstanceOf(SyntheticProcessRunnerError);

    expect(signalMock.signals).toContain("SIGTERM");
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  });

  test("rejects a worker that sends more than one result", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(46_001);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    mockProcessGroupSignals({ child, exitOn: "SIGTERM" });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(child, { value: "first" });
        emitSuccess(child, { value: "second" });
      });
    };
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 20,
      killWaitInMs: 20,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("more than one result message");
    expect(runner.activeCount).toBe(0);
  });

  test("uses a bounded queue and rejects excess executions", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const firstChild: FakeChildProcess = new FakeChildProcess(47_001);
    const secondChild: FakeChildProcess = new FakeChildProcess(47_002);
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(firstChild);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(secondChild);
      });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxPendingCount: 1,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    await waitForForkCount(forkMock, 1);

    const secondRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    await flushMicrotasks();
    expect(runner.pendingLimit).toBe(1);
    expect(runner.pendingCount).toBe(1);
    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("execution queue is full");
    expect(forkMock).toHaveBeenCalledTimes(1);

    emitSuccess(firstChild, { value: "first" });
    emitExit(firstChild, null);
    await waitForForkCount(forkMock, 2);
    emitSuccess(secondChild, { value: "second" });
    emitExit(secondChild, null);

    await expect(Promise.all([firstRun, secondRun])).resolves.toHaveLength(2);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  });

  test("derives a finite default pending limit from concurrency", () => {
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 3,
    });

    expect(runner.pendingLimit).toBe(12);
  });

  test("expires in the queue without forking another worker", async () => {
    const timers: ManualTimerController = installManualTimers();
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(48_001);
    const forkMock: jest.Mock = getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxPendingCount: 1,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    await waitForForkCount(forkMock, 1);

    const queuedRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      queueTimeoutInMs: 25,
      validateResult: isTestResult,
    });
    const queuedExpectation: Promise<void> = expect(queuedRun).rejects.toThrow(
      "timed out waiting for an execution slot",
    );
    await flushMicrotasks();
    timers.fireByDelay(25);
    await queuedExpectation;
    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(runner.pendingCount).toBe(0);

    emitSuccess(child, { value: "first" });
    emitExit(child, null);
    await firstRun;
  });

  test("does not fork when setup consumes the execution deadline", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    let nowInMs: number = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });
    jest
      .spyOn(fs.promises, "mkdtemp")
      .mockResolvedValue("/tmp/oneuptime-setup-deadline");
    jest.spyOn(fs.promises, "chmod").mockImplementation(async () => {
      nowInMs = 1100;
    });
    const rmSpy: jest.SpyInstance = jest
      .spyOn(fs.promises, "rm")
      .mockResolvedValue(undefined);
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 100,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("timed out after 100ms");

    expect(getForkMock()).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledWith("/tmp/oneuptime-setup-deadline", {
      recursive: true,
      force: true,
    });
    expect(runner.activeCount).toBe(0);
  });

  test("subtracts elapsed queue time from the child timeout", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    let nowInMs: number = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });
    const timeoutSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");
    const firstChild: FakeChildProcess = new FakeChildProcess(49_001);
    const secondChild: FakeChildProcess = new FakeChildProcess(49_002);
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(firstChild);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(secondChild);
      });
    secondChild.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(secondChild, { value: "second" });
        emitExit(secondChild, null);
      });
    };
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxPendingCount: 1,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    await waitForForkCount(forkMock, 1);
    const secondRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    await flushMicrotasks();

    nowInMs = 1060;
    emitSuccess(firstChild, { value: "first" });
    emitExit(firstChild, null);
    await firstRun;
    await waitForForkCount(forkMock, 2);
    await secondRun;

    expect(
      timeoutSpy.mock.calls.some((call: unknown[]) => {
        return call[1] === 940;
      }),
    ).toBe(true);
    expect(forkMock).toHaveBeenCalledTimes(2);
  });

  test("grants an explicitly queued run its full post-admission timeout", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    let nowInMs: number = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });
    const timeoutSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");
    const firstChild: FakeChildProcess = new FakeChildProcess(49_051);
    const secondChild: FakeChildProcess = new FakeChildProcess(49_052);
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(firstChild);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(secondChild);
      });
    secondChild.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(secondChild, { value: "second" });
        emitExit(secondChild, null);
      });
    };
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxPendingCount: 1,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    await waitForForkCount(forkMock, 1);
    const secondRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-2" },
      timeoutInMs: 1000,
      queueTimeoutInMs: 200,
      validateResult: isTestResult,
    });
    await flushMicrotasks();
    expect(
      timeoutSpy.mock.calls.some((call: unknown[]) => {
        return call[1] === 200;
      }),
    ).toBe(true);

    timeoutSpy.mockClear();
    nowInMs = 1060;
    emitSuccess(firstChild, { value: "first" });
    emitExit(firstChild, null);
    await firstRun;
    await waitForForkCount(forkMock, 2);
    await secondRun;

    expect(
      timeoutSpy.mock.calls.some((call: unknown[]) => {
        return call[1] === 1000;
      }),
    ).toBe(true);
    expect(
      timeoutSpy.mock.calls.some((call: unknown[]) => {
        return call[1] === 940;
      }),
    ).toBe(false);
    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  });

  test("does not send work when fork setup crosses the deadline", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    let nowInMs: number = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowInMs;
    });
    const child: FakeChildProcess = new FakeChildProcess(49_101);
    child.kill.mockImplementation((signal?: NodeJS.Signals): boolean => {
      emitExit(child, signal || "SIGTERM");
      return true;
    });
    getForkMock().mockImplementation(() => {
      nowInMs = 1100;
      return asChildProcess(child);
    });
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      terminationGraceInMs: 0,
      killWaitInMs: 0,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 100,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow("timed out after 100ms");

    expect(child.send).not.toHaveBeenCalled();
    expect(runner.activeCount).toBe(0);
  });

  test("terminates a descendant process tree when aggregate RSS exceeds the limit", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const child: FakeChildProcess = new FakeChildProcess(49_201);
    const browserPid: number = 59_201;
    const rendererPid: number = 59_202;
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });

    const callerProcessGroupId: number = 900_201;
    getExecFileSyncMock().mockReturnValue(
      [
        `${process.pid} 1 ${callerProcessGroupId} 32`,
        `${child.pid} ${process.pid} ${child.pid} 400`,
        `${browserPid} ${child.pid} ${browserPid} 600`,
        `${rendererPid} ${browserPid} ${browserPid} 100`,
      ].join("\n") as never,
    );

    let treeIsAlive: boolean = true;
    const signals: Array<{ pid: number; signal: string }> = [];
    jest
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number): true => {
        if (signal === 0) {
          if (treeIsAlive) {
            return true;
          }
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }

        if (typeof signal === "string") {
          signals.push({ pid, signal });
          if (signal === "SIGTERM" && treeIsAlive) {
            treeIsAlive = false;
            global.setImmediate(() => {
              emitExit(child, "SIGTERM");
            });
          }
        }

        return true;
      });

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxProcessTreeRssBytes: 1024 * 1024,
      rssPollIntervalInMs: 10_000,
      terminationGraceInMs: 20,
      killWaitInMs: 20,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).rejects.toThrow(
      "exceeded RSS limit of 1048576 bytes (observed 1126400 bytes)",
    );

    expect(child.send).not.toHaveBeenCalled();
    expect(signals).toEqual(
      expect.arrayContaining([
        { pid: -child.pid, signal: "SIGTERM" },
        { pid: -browserPid, signal: "SIGTERM" },
        { pid: browserPid, signal: "SIGTERM" },
        { pid: rendererPid, signal: "SIGTERM" },
      ]),
    );
    expect(runner.activeCount).toBe(0);
  });

  test("polls aggregate descendant RSS and stops the watchdog after a breach", async () => {
    const timers: ManualTimerController = installManualTimers();
    jest.spyOn(process, "getuid").mockReturnValue(501);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const child: FakeChildProcess = new FakeChildProcess(49_301);
    const browserPid: number = 59_301;
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });

    const callerProcessGroupId: number = 900_301;
    let snapshotCount: number = 0;
    getExecFileSyncMock().mockImplementation(() => {
      snapshotCount++;
      const childRssInKilobytes: number = snapshotCount === 1 ? 100 : 700;
      const browserRssInKilobytes: number = snapshotCount === 1 ? 100 : 500;
      return [
        `${process.pid} 1 ${callerProcessGroupId} 32`,
        `${child.pid} ${process.pid} ${child.pid} ${childRssInKilobytes}`,
        `${browserPid} ${child.pid} ${browserPid} ${browserRssInKilobytes}`,
      ].join("\n") as never;
    });

    let treeIsAlive: boolean = true;
    jest
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number): true => {
        if (signal === 0) {
          if (treeIsAlive) {
            return true;
          }
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }

        if (pid === -child.pid && signal === "SIGTERM" && treeIsAlive) {
          treeIsAlive = false;
          emitExit(child, "SIGTERM");
        }
        return true;
      });

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxProcessTreeRssBytes: 1024 * 1024,
      rssPollIntervalInMs: 250,
      diskPollIntervalInMs: 500,
      terminationGraceInMs: 20,
      killWaitInMs: 20,
    });

    const run: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const runExpectation: Promise<void> = expect(run).rejects.toThrow(
      "exceeded RSS limit of 1048576 bytes (observed 1228800 bytes)",
    );

    await waitForForkCount(getForkMock(), 1);
    await flushMicrotasks();
    expect(child.send).toHaveBeenCalledTimes(1);
    expect(timers.activeTimerCount(250)).toBe(1);

    timers.fireByDelay(250);
    await runExpectation;

    expect(snapshotCount).toBeGreaterThanOrEqual(2);
    expect(timers.activeTimerCount()).toBe(0);
    expect(runner.activeCount).toBe(0);
  });

  test("cleans a disk-limit breach and admits a healthy next run", async () => {
    const timers: ManualTimerController = installManualTimers();
    jest.spyOn(process, "getuid").mockReturnValue(501);
    jest
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: string | number): true => {
        if (signal === 0) {
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }
        return true;
      });

    const firstChild: FakeChildProcess = new FakeChildProcess(49_401);
    const secondChild: FakeChildProcess = new FakeChildProcess(49_402);
    firstChild.kill.mockImplementation((signal?: NodeJS.Signals): boolean => {
      emitExit(firstChild, signal || "SIGTERM");
      return true;
    });
    secondChild.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(secondChild, { value: "healthy-next-run" });
        emitExit(secondChild, null);
      });
    };
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(firstChild);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(secondChild);
      });

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxDiskBytes: 1024 * 1024,
      diskPollIntervalInMs: 250,
      rssPollIntervalInMs: 10_000,
      terminationGraceInMs: 0,
      killWaitInMs: 0,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const firstExpectation: Promise<void> = expect(firstRun).rejects.toThrow(
      "exceeded disk limit of 1048576 bytes",
    );

    await waitForForkCount(forkMock, 1);
    await waitForActiveTimer(timers, 250);
    const firstHome: string = forkOptionsAt(forkMock, 0).env?.[
      "HOME"
    ] as string;
    fs.writeFileSync(
      path.join(firstHome, "oversized-opfs-storage.bin"),
      Buffer.alloc(2 * 1024 * 1024),
    );

    timers.fireByDelay(250);
    await firstExpectation;

    expect(firstChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fs.existsSync(firstHome)).toBe(false);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
    expect(timers.activeTimerCount()).toBe(0);

    const secondResult: ProcessRunResult<TestResult> = await runner.run<
      TestConfig,
      TestResult
    >({
      payload: { monitorId: "monitor-2" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const secondHome: string = forkOptionsAt(forkMock, 1).env?.[
      "HOME"
    ] as string;

    expect(secondResult.result).toEqual({ value: "healthy-next-run" });
    expect(secondHome).not.toBe(firstHome);
    expect(fs.existsSync(secondHome)).toBe(false);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
    expect(timers.activeTimerCount()).toBe(0);
  });

  test("cleans a disk-entry-limit breach and admits a healthy next run", async () => {
    const timers: ManualTimerController = installManualTimers();
    jest.spyOn(process, "getuid").mockReturnValue(501);
    jest
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: string | number): true => {
        if (signal === 0) {
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }
        return true;
      });

    const firstChild: FakeChildProcess = new FakeChildProcess(49_451);
    const secondChild: FakeChildProcess = new FakeChildProcess(49_452);
    firstChild.kill.mockImplementation((signal?: NodeJS.Signals): boolean => {
      emitExit(firstChild, signal || "SIGTERM");
      return true;
    });
    secondChild.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(secondChild, { value: "healthy-next-run" });
        emitExit(secondChild, null);
      });
    };
    const forkMock: jest.Mock = getForkMock()
      .mockImplementationOnce(() => {
        return asChildProcess(firstChild);
      })
      .mockImplementationOnce(() => {
        return asChildProcess(secondChild);
      });

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      maxDiskBytes: 1024 * 1024,
      maxDiskEntries: 2,
      diskPollIntervalInMs: 250,
      rssPollIntervalInMs: 10_000,
      terminationGraceInMs: 0,
      killWaitInMs: 0,
    });

    const firstRun: Promise<unknown> = runner.run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const firstExpectation: Promise<void> = expect(firstRun).rejects.toThrow(
      "exceeded entry limit of 2 entries (observed 3 entries)",
    );

    await waitForForkCount(forkMock, 1);
    await waitForActiveTimer(timers, 250);
    const firstHome: string = forkOptionsAt(forkMock, 0).env?.[
      "HOME"
    ] as string;
    fs.writeFileSync(path.join(firstHome, "zero-byte-entry-1"), "");
    fs.writeFileSync(path.join(firstHome, "zero-byte-entry-2"), "");
    fs.writeFileSync(path.join(firstHome, "zero-byte-entry-3"), "");

    timers.fireByDelay(250);
    await firstExpectation;

    expect(firstChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fs.existsSync(firstHome)).toBe(false);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
    expect(timers.activeTimerCount()).toBe(0);

    const secondResult: ProcessRunResult<TestResult> = await runner.run<
      TestConfig,
      TestResult
    >({
      payload: { monitorId: "monitor-2" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    });
    const secondHome: string = forkOptionsAt(forkMock, 1).env?.[
      "HOME"
    ] as string;

    expect(secondResult.result).toEqual({ value: "healthy-next-run" });
    expect(secondHome).not.toBe(firstHome);
    expect(fs.existsSync(secondHome)).toBe(false);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
    expect(timers.activeTimerCount()).toBe(0);
  });

  test("kills an orphaned detached group after the Node leader exits", async () => {
    if (process.platform === "win32") {
      return;
    }

    jest.spyOn(process, "getuid").mockReturnValue(501);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const child: FakeChildProcess = new FakeChildProcess(49_501);
    const browserPid: number = 59_501;
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });

    const callerProcessGroupId: number = 900_501;
    const initialProcessTable: string = [
      `${process.pid} 1 ${callerProcessGroupId} 32`,
      `${child.pid} ${process.pid} ${child.pid} 100`,
      `${browserPid} ${child.pid} ${child.pid} 100`,
    ].join("\n");
    const orphanProcessTable: string = [
      `${process.pid} 1 ${callerProcessGroupId} 32`,
      `${browserPid} 1 ${child.pid} 100`,
    ].join("\n");
    let snapshotCount: number = 0;
    getExecFileSyncMock().mockImplementation(() => {
      snapshotCount++;
      return (
        snapshotCount === 1 ? initialProcessTable : orphanProcessTable
      ) as never;
    });

    let orphanGroupIsAlive: boolean = true;
    const signals: Array<{ pid: number; signal: string }> = [];
    jest
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number): true => {
        if (signal === 0) {
          if (
            orphanGroupIsAlive &&
            (pid === -child.pid || pid === browserPid)
          ) {
            return true;
          }
          throw Object.assign(new Error("Process does not exist."), {
            code: "ESRCH",
          });
        }

        if (typeof signal === "string") {
          signals.push({ pid, signal });
          if (pid === -child.pid && signal === "SIGKILL") {
            orphanGroupIsAlive = false;
          }
        }
        return true;
      });

    child.onSend = (): void => {
      global.setImmediate(() => {
        emitSuccess(child, { value: "leader-exited" });
        emitExit(child, null);
      });
    };
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
      rssPollIntervalInMs: 10_000,
      diskPollIntervalInMs: 10_000,
      terminationGraceInMs: 0,
      killWaitInMs: 0,
    });

    await expect(
      runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      }),
    ).resolves.toMatchObject({ result: { value: "leader-exited" } });

    expect(signals).toEqual(
      expect.arrayContaining([
        { pid: -child.pid, signal: "SIGTERM" },
        { pid: browserPid, signal: "SIGTERM" },
        { pid: -child.pid, signal: "SIGKILL" },
        { pid: browserPid, signal: "SIGKILL" },
      ]),
    );
    expect(snapshotCount).toBeGreaterThan(1);
    expect(runner.activeCount).toBe(0);
  });

  test.each([
    { maxOutputBytes: 0 },
    { maxOldSpaceSizeInMb: 0 },
    { maxPendingCount: -1 },
    { maxPendingCount: 1.5 },
    { maxProcessTreeRssBytes: 0 },
    { rssPollIntervalInMs: 0 },
    { rssPollIntervalInMs: 2_147_483_648 },
    { maxDiskBytes: 0 },
    { maxDiskEntries: 0 },
    { maxDiskEntries: 1.5 },
    { diskPollIntervalInMs: 0 },
    { diskPollIntervalInMs: 2_147_483_648 },
    { childUid: 19_999 },
    { childGid: 60_001 },
  ])(
    "rejects invalid containment options %#",
    (invalidOptions: Partial<ProcessRunnerOptions>): void => {
      expect(() => {
        return new ProcessRunner({
          workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
          concurrencyLimit: 1,
          ...invalidOptions,
        });
      }).toThrow("Synthetic runtime");
    },
  );

  test.each([0, -1, 1.5, 2_147_483_648])(
    "rejects invalid queue timeout %s",
    async (queueTimeoutInMs: number): Promise<void> => {
      const runner: ProcessRunner = new ProcessRunner({
        workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
        concurrencyLimit: 1,
      });

      await expect(
        runner.run<TestConfig, TestResult>({
          payload: { monitorId: "monitor-1" },
          timeoutInMs: 1000,
          queueTimeoutInMs,
          validateResult: isTestResult,
        }),
      ).rejects.toThrow("Synthetic runtime queue timeout");
      expect(getForkMock()).not.toHaveBeenCalled();
      expect(runner.activeCount).toBe(0);
    },
  );

  test("completes a real detached fork without signalling the caller group", async () => {
    if (process.platform === "win32") {
      return;
    }

    (process.kill as unknown as jest.Mock).mockRestore();
    const actualChildProcess: typeof import("child_process") =
      jest.requireActual("child_process");
    getForkMock().mockImplementation(actualChildProcess.fork);
    getExecFileSyncMock().mockImplementation(actualChildProcess.execFileSync);

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: path.join(
        __dirname,
        "Fixtures",
        "ProcessRunnerWorker.cjs",
      ),
      concurrencyLimit: 1,
      terminationGraceInMs: 200,
      killWaitInMs: 200,
    });

    const result: ProcessRunResult<TestResult> = await runner.run<
      TestConfig,
      TestResult
    >({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 5000,
      validateResult: isTestResult,
    });

    expect(result.result).toEqual({ value: "real-fork-complete" });
    expect(result.stdout).toContain("real-worker-started");
    expect(runner.activeCount).toBe(0);
  }, 15_000);
});

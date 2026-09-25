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
  MAX_ERROR_INTERNAL_DETAIL_LENGTH,
  SyntheticWorkerStartEnvelope,
  createWorkerFailureEnvelope,
  createWorkerNonce,
  createWorkerSuccessEnvelope,
} from "../../../../Utils/Monitors/SyntheticRuntime/WorkerProtocol";
import SyntheticRuntimeFault, {
  SYNTHETIC_RUNTIME_FAULT_KIND,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
import { PROCESS_MEMORY_HELPER_PATH } from "../../../../Utils/Monitors/SyntheticRuntime/ProcessTreeMemory";
import logger from "Common/Server/Utils/Logger";

jest.mock("child_process", () => {
  const actual: typeof import("child_process") =
    jest.requireActual("child_process");
  return {
    ...actual,
    execFile: jest.fn(),
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

function emitFailure(child: FakeChildProcess, error: unknown): void {
  const startEnvelope: SyntheticWorkerStartEnvelope<TestConfig> =
    startEnvelopeFrom(child);
  child.emit(
    "message",
    createWorkerFailureEnvelope({
      nonce: startEnvelope.nonce,
      error,
    }),
  );
}

/*
 * Sends a failure envelope with the right nonce but a hand-written error
 * object, so the only thing under test is that error's shape -- including
 * shapes createWorkerFailureEnvelope never produces.
 */
function emitFailureWithError(
  child: FakeChildProcess,
  error: Record<string, unknown>,
): void {
  const startEnvelope: SyntheticWorkerStartEnvelope<TestConfig> =
    startEnvelopeFrom(child);
  child.emit("message", {
    ...createWorkerFailureEnvelope({
      nonce: startEnvelope.nonce,
      error: new Error("replaced by the hand-written error"),
    }),
    error,
  });
}

async function captureRunFailure(
  runner: ProcessRunner,
): Promise<SyntheticProcessRunnerError> {
  return runner
    .run<TestConfig, TestResult>({
      payload: { monitorId: "monitor-1" },
      timeoutInMs: 1000,
      validateResult: isTestResult,
    })
    .then(
      (): never => {
        throw new Error("Expected the run to fail.");
      },
      (caught: SyntheticProcessRunnerError): SyntheticProcessRunnerError => {
        return caught;
      },
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

/*
 * A fake /proc for the Linux process-tree path, which is what production
 * runs: ProcessRunner walks /proc/<pid>/task/<tid>/children from the worker,
 * reads /proc/<pid>/stat and /proc/<pid>/status for every process it finds,
 * and -- for a tree over the limit by summed VmRSS -- asks for PSS.
 */
interface FakeProcThread {
  readonly tid: number;
  readonly residentKb: number | null;
}

interface FakeProcProcess {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId: number;
  // VmRSS; null gives a status with no memory lines, as after a main-thread exit.
  residentKb: number | null;
  // PSS as the helper or smaps_rollup reports it; null when unreadable.
  proportionalKb: number | null;
  readonly otherThreads?: ReadonlyArray<FakeProcThread> | undefined;
}

interface FakeProc {
  readonly processes: Map<number, FakeProcProcess>;
  readonly helperCalls: Array<{
    readonly file: string;
    readonly args: ReadonlyArray<string>;
    readonly options: { signal?: AbortSignal; timeout?: number };
  }>;
  readonly smapsRollupReads: string[];
  // Answer the helper later instead of at once; see answerPendingHelper.
  holdHelperAnswers: boolean;
  // Errors the next helper calls fail with, one per call, before it answers again.
  readonly helperFailures: Error[];
  // Runs as each helper call is made, before it answers: the tree may change.
  onHelperCall: ((callIndex: number) => void) | null;
  answerPendingHelper: () => void;
  readonly killedSignals: Array<{ pid: number; signal: string }>;
  // The worker exits on its own, leaving its browser processes behind.
  readonly exitWorker: () => void;
}

const REAL_PLATFORM_DESCRIPTOR: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(process, "platform");

function fakeLinuxPlatform(): void {
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
  });
}

function restorePlatform(): void {
  if (REAL_PLATFORM_DESCRIPTOR) {
    Object.defineProperty(process, "platform", REAL_PLATFORM_DESCRIPTOR);
  }
}

function enoent(filePath: string): Error {
  return Object.assign(new Error(`ENOENT: no such file, '${filePath}'`), {
    code: "ENOENT",
  });
}

function procStatus(residentKb: number | null): string {
  const lines: string[] = ["Name:\tchrome", "State:\tS (sleeping)"];
  if (residentKb !== null) {
    lines.push(
      `VmRSS:\t ${residentKb} kB`,
      `RssAnon:\t ${Math.floor(residentKb / 3)} kB`,
      `RssFile:\t ${residentKb - Math.floor(residentKb / 3)} kB`,
      "RssShmem:\t 0 kB",
    );
  }
  lines.push("Threads:\t8", "");
  return lines.join("\n");
}

function installFakeProc(data: {
  readonly child: FakeChildProcess;
  readonly callerProcessGroupId: number;
  readonly processes: ReadonlyArray<FakeProcProcess>;
  readonly helperPresent: boolean;
}): FakeProc {
  fakeLinuxPlatform();

  const processes: Map<number, FakeProcProcess> = new Map<
    number,
    FakeProcProcess
  >();
  for (const fakeProcess of data.processes) {
    processes.set(fakeProcess.pid, { ...fakeProcess });
  }
  const caller: FakeProcProcess = {
    pid: process.pid,
    parentPid: 1,
    processGroupId: data.callerProcessGroupId,
    residentKb: 400_000,
    proportionalKb: 400_000,
  };

  const lookup: (pid: number) => FakeProcProcess | undefined = (
    pid: number,
  ): FakeProcProcess | undefined => {
    return pid === process.pid ? caller : processes.get(pid);
  };

  const fakeProcFile: (filePath: string) => string | null = (
    filePath: string,
  ): string | null => {
    let match: RegExpMatchArray | null = filePath.match(
      /^\/proc\/(\d+)\/(stat|status)$/,
    );
    if (match) {
      const fakeProcess: FakeProcProcess | undefined = lookup(Number(match[1]));
      if (!fakeProcess) {
        return null;
      }
      return match[2] === "stat"
        ? `${fakeProcess.pid} (chrome) S ${fakeProcess.parentPid} ${fakeProcess.processGroupId} 0 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 8 0`
        : procStatus(fakeProcess.residentKb);
    }

    match = filePath.match(/^\/proc\/(\d+)\/task\/(\d+)\/(children|status)$/);
    if (match) {
      const fakeProcess: FakeProcProcess | undefined = lookup(Number(match[1]));
      const tid: number = Number(match[2]);
      if (!fakeProcess) {
        return null;
      }
      if (match[3] === "children") {
        if (tid !== fakeProcess.pid || fakeProcess === caller) {
          return "";
        }
        return [...processes.values()]
          .filter((candidate: FakeProcProcess) => {
            return candidate.parentPid === fakeProcess.pid;
          })
          .map((candidate: FakeProcProcess) => {
            return `${candidate.pid} `;
          })
          .join("");
      }
      if (tid === fakeProcess.pid) {
        return procStatus(fakeProcess.residentKb);
      }
      const thread: FakeProcThread | undefined = fakeProcess.otherThreads?.find(
        (candidate: FakeProcThread) => {
          return candidate.tid === tid;
        },
      );
      return thread ? procStatus(thread.residentKb) : null;
    }

    return null;
  };

  const realExistsSync: typeof fs.existsSync = fs.existsSync;
  jest.spyOn(fs, "existsSync").mockImplementation((candidate: fs.PathLike) => {
    if (candidate === "/proc/self/stat") {
      return true;
    }
    if (candidate === PROCESS_MEMORY_HELPER_PATH) {
      return data.helperPresent;
    }
    return realExistsSync(candidate);
  });

  const realReadFileSync: typeof fs.readFileSync = fs.readFileSync;
  jest.spyOn(fs, "readFileSync").mockImplementation(((
    filePath: fs.PathOrFileDescriptor,
    options?: unknown,
  ): string | Buffer => {
    const pathText: string = String(filePath);
    if (!pathText.startsWith("/proc/")) {
      return realReadFileSync(
        filePath,
        options as Parameters<typeof fs.readFileSync>[1],
      );
    }
    const contents: string | null = fakeProcFile(pathText);
    if (contents === null) {
      throw enoent(pathText);
    }
    return contents;
  }) as typeof fs.readFileSync);

  const realReaddirSync: typeof fs.readdirSync = fs.readdirSync;
  jest.spyOn(fs, "readdirSync").mockImplementation(((
    directory: fs.PathLike,
    options?: unknown,
  ): unknown => {
    const pathText: string = String(directory);
    const match: RegExpMatchArray | null = pathText.match(
      /^\/proc\/(\d+)\/task$/,
    );
    if (!match) {
      if (pathText.startsWith("/proc/")) {
        throw enoent(pathText);
      }
      return realReaddirSync(
        directory,
        options as Parameters<typeof fs.readdirSync>[1],
      );
    }
    const fakeProcess: FakeProcProcess | undefined = lookup(Number(match[1]));
    if (!fakeProcess) {
      throw enoent(pathText);
    }
    return [
      String(fakeProcess.pid),
      ...(fakeProcess.otherThreads || []).map((thread: FakeProcThread) => {
        return String(thread.tid);
      }),
    ];
  }) as typeof fs.readdirSync);

  const fakeProc: FakeProc = {
    processes,
    helperCalls: [],
    smapsRollupReads: [],
    holdHelperAnswers: false,
    helperFailures: [],
    onHelperCall: null,
    answerPendingHelper: (): void => {
      throw new Error("No helper call is waiting for an answer.");
    },
    killedSignals: [],
    exitWorker: (): void => {
      processes.delete(data.child.pid);
      emitExit(data.child, null);
    },
  };

  const answerFor: (args: ReadonlyArray<string>) => string = (
    args: ReadonlyArray<string>,
  ): string => {
    return args
      .slice(2)
      .map((pidText: string) => {
        const fakeProcess: FakeProcProcess | undefined = processes.get(
          Number(pidText),
        );
        return fakeProcess && fakeProcess.proportionalKb !== null
          ? `${pidText} ${fakeProcess.proportionalKb}`
          : `${pidText} -`;
      })
      .map((line: string) => {
        return `${line}\n`;
      })
      .join("");
  };

  (childProcess.execFile as unknown as jest.Mock).mockImplementation(
    (
      file: string,
      args: ReadonlyArray<string>,
      options: { signal?: AbortSignal; timeout?: number },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ): void => {
      fakeProc.helperCalls.push({ file, args, options });
      fakeProc.onHelperCall?.(fakeProc.helperCalls.length - 1);
      let answered: boolean = false;
      const answer: (error: Error | null) => void = (
        error: Error | null,
      ): void => {
        if (answered) {
          return;
        }
        answered = true;
        callback(error, error ? "" : answerFor(args), "");
      };
      options.signal?.addEventListener("abort", () => {
        answer(
          Object.assign(new Error("The operation was aborted"), {
            name: "AbortError",
            code: "ABORT_ERR",
          }),
        );
      });
      const failure: Error | undefined = fakeProc.helperFailures.shift();
      if (fakeProc.holdHelperAnswers) {
        fakeProc.answerPendingHelper = (): void => {
          answer(failure ?? null);
        };
        return;
      }
      global.setImmediate(() => {
        answer(failure ?? null);
      });
    },
  );

  jest.spyOn(fs.promises, "readFile").mockImplementation((async (
    filePath: fs.PathLike,
  ): Promise<string> => {
    const pathText: string = String(filePath);
    fakeProc.smapsRollupReads.push(pathText);
    const match: RegExpMatchArray | null = pathText.match(
      /^\/proc\/(\d+)\/smaps_rollup$/,
    );
    const fakeProcess: FakeProcProcess | undefined = match
      ? processes.get(Number(match[1]))
      : undefined;
    if (!fakeProcess || fakeProcess.proportionalKb === null) {
      throw Object.assign(new Error(`EACCES: '${pathText}'`), {
        code: "EACCES",
      });
    }
    return `00400000-7fff00000000 ---p 00000000 00:00 0 [rollup]\nRss: ${fakeProcess.residentKb} kB\nPss: ${fakeProcess.proportionalKb} kB\nPss_Anon: 0 kB\n`;
  }) as unknown as typeof fs.promises.readFile);

  /*
   * Any TERM or KILL to the tree ends all of it at once, the worker included,
   * the way a process-group signal to a real worker would.
   */
  jest
    .spyOn(process, "kill")
    .mockImplementation((pid: number, signal?: string | number): true => {
      const isTreeTarget: boolean =
        processes.has(Math.abs(pid)) ||
        [...processes.values()].some((candidate: FakeProcProcess) => {
          return pid < 0 && candidate.processGroupId === -pid;
        });

      if (signal === 0) {
        if (isTreeTarget) {
          return true;
        }
        throw Object.assign(new Error("Process does not exist."), {
          code: "ESRCH",
        });
      }

      if (typeof signal === "string") {
        fakeProc.killedSignals.push({ pid, signal });
        if (isTreeTarget && processes.size > 0) {
          const childWasAlive: boolean = processes.has(data.child.pid);
          processes.clear();
          if (childWasAlive) {
            emitExit(data.child, signal as NodeJS.Signals);
          }
        }
      }
      return true;
    });

  return fakeProc;
}

/*
 * A Desktop Chromium check shaped like the customer's: the worker and eleven
 * Chromium processes whose VmRSS sums to the 1,612,525,568 bytes the probe
 * reported, while their PSS sums to 822,083,584.
 */
function chromiumCheckTree(workerPid: number): FakeProcProcess[] {
  const browserPid: number = workerPid + 10_000;
  const zygotePid: number = browserPid + 1;
  const rendererZygotePid: number = browserPid + 2;

  const process_: (
    pid: number,
    parentPid: number,
    residentKb: number,
    proportionalKb: number,
  ) => FakeProcProcess = (
    pid: number,
    parentPid: number,
    residentKb: number,
    proportionalKb: number,
  ): FakeProcProcess => {
    return {
      pid,
      parentPid,
      processGroupId: pid === workerPid ? workerPid : browserPid,
      residentKb,
      proportionalKb,
    };
  };

  return [
    process_(workerPid, process.pid, 155_212, 147_456),
    process_(browserPid, workerPid, 200_704, 115_712),
    process_(zygotePid, browserPid, 62_976, 12_288),
    process_(rendererZygotePid, zygotePid, 62_976, 9_216),
    process_(browserPid + 3, browserPid, 173_056, 88_064),
    process_(browserPid + 4, browserPid, 104_960, 28_672),
    process_(browserPid + 5, browserPid, 49_856, 8_192),
    process_(browserPid + 6, rendererZygotePid, 391_168, 291_840),
    process_(browserPid + 7, rendererZygotePid, 142_336, 46_080),
    process_(browserPid + 8, rendererZygotePid, 68_608, 14_336),
    process_(browserPid + 9, rendererZygotePid, 81_408, 20_480),
    process_(browserPid + 10, rendererZygotePid, 81_472, 20_480),
  ];
}

function sumKilobytes(
  processes: ReadonlyArray<FakeProcProcess>,
  key: "residentKb" | "proportionalKb",
): number {
  return processes.reduce((total: number, fakeProcess: FakeProcProcess) => {
    return total + (fakeProcess[key] ?? 0);
  }, 0);
}

async function waitFor(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const startedAt: [number, number] = process.hrtime();
  while (!condition()) {
    const elapsed: [number, number] = process.hrtime(startedAt);
    if (elapsed[0] * 1000 + elapsed[1] / 1_000_000 >= 5000) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise<void>((resolve: () => void) => {
      global.setImmediate(resolve);
    });
  }
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
    (childProcess.execFile as unknown as jest.Mock).mockReset();
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
        /^oneuptime-synthetic-runtime-v3-(\d+)-([a-f0-9]{8})-[A-Za-z0-9]{6}$/,
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
      /^oneuptime-synthetic-runtime-v3-\d+-([a-f0-9]{8})-[A-Za-z0-9]{6}$/,
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
    /*
     * The sandbox's own controller host is prepended to whatever the operator
     * configured: the internal bootstrap navigation must never be routed at a
     * proxy, whichever spelling of the variable the browser happens to read.
     */
    expect(environment?.["NO_PROXY"]).toBe(
      "synthetic-runtime.oneuptime.invalid,localhost,127.0.0.1",
    );
    expect(environment?.["no_proxy"]).toBe(
      "synthetic-runtime.oneuptime.invalid,.svc.internal",
    );
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
    expect(environment?.["NO_PROXY"]).toBe(
      "synthetic-runtime.oneuptime.invalid,localhost",
    );
  });

  test("carries a worker runtime fault up as a fault, with its stack kept off the message", async () => {
    /*
     * The worker already wrote a message for whoever reads the monitor.
     * Appending its Playwright stack -- as every other worker failure gets --
     * would bury that message under exactly the internals it replaces, which
     * is what the customer saw: the same timeout paragraph twice, then a path
     * inside /usr/src/app.
     */
    const child: FakeChildProcess = new FakeChildProcess(41_201);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitFailure(
          child,
          new SyntheticRuntimeFault({
            message: "Synthetic monitor could not start on this probe.",
            internalDetail: "page.goto: Timeout 30000ms exceeded.",
          }),
        );
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    const error: SyntheticProcessRunnerError = await runner
      .run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      })
      .then(
        (): never => {
          throw new Error("Expected the run to fail.");
        },
        (caught: SyntheticProcessRunnerError): SyntheticProcessRunnerError => {
          return caught;
        },
      );

    expect(error).toBeInstanceOf(SyntheticProcessRunnerError);
    expect(error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(error.message).toBe(
      "Synthetic monitor could not start on this probe.",
    );
    expect(error.message).not.toContain("SyntheticRuntimeFault");
    expect(error.remoteStack).toContain("SyntheticRuntimeFault");
  });

  test("still folds the stack into the message for an ordinary worker failure", async () => {
    const child: FakeChildProcess = new FakeChildProcess(41_202);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitFailure(
          child,
          new Error("TypeError: page.clickk is not a function"),
        );
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    const error: SyntheticProcessRunnerError = await runner
      .run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 1000,
        validateResult: isTestResult,
      })
      .then(
        (): never => {
          throw new Error("Expected the run to fail.");
        },
        (caught: SyntheticProcessRunnerError): SyntheticProcessRunnerError => {
          return caught;
        },
      );

    expect(error.kind).toBeUndefined();
    expect(error.remoteStack).toBeUndefined();
    expect(error.message).toContain("TypeError: page.clickk is not a function");
    expect(error.message).toContain("ProcessRunner.test.ts");
  });

  /*
   * The worker's diagnosis of a runtime fault -- which bootstrap step each
   * attempt reached, and what Playwright said -- is the probe operator's only
   * account of WHY a check could not start. It crosses the fork beside the
   * fault's message, so it has to come out of the runner as its own field:
   * never folded into the message the tenant reads, and never dropped.
   */
  const BOOTSTRAP_DIAGNOSIS: string = [
    "Bootstrap attempt 1/3 failed after 20004 ms of its 20000 ms budget. Reached: page opened, route installed, binding installed, navigation started. Error: page.goto: Timeout 20000ms exceeded.",
    "Last error: page.goto: Timeout 20000ms exceeded.\n    at https://synthetic-runtime.oneuptime.invalid/3f0c9d",
  ].join("\n");

  test("carries a runtime fault's internal detail up beside its message and stack", async () => {
    const child: FakeChildProcess = new FakeChildProcess(41_203);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitFailure(
          child,
          new SyntheticRuntimeFault({
            message: "Synthetic monitor could not start on this probe.",
            internalDetail: BOOTSTRAP_DIAGNOSIS,
          }),
        );
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    const error: SyntheticProcessRunnerError = await captureRunFailure(runner);

    expect(error).toBeInstanceOf(SyntheticProcessRunnerError);
    expect(error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(error.internalDetail).toBe(BOOTSTRAP_DIAGNOSIS);
    // The message and remote stack are exactly what they were without it.
    expect(error.message).toBe(
      "Synthetic monitor could not start on this probe.",
    );
    expect(error.remoteStack).toContain("SyntheticRuntimeFault");
    expect(error.remoteStack).not.toContain("Bootstrap attempt");
    expect(error.message).not.toContain("Bootstrap attempt");
    expect(error.message).not.toContain("synthetic-runtime.oneuptime.invalid");
  });

  test("carries the internal detail of a runtime fault that arrived without a stack", async () => {
    const child: FakeChildProcess = new FakeChildProcess(41_204);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitFailureWithError(child, {
          message: "Synthetic monitor could not start on this probe.",
          kind: SYNTHETIC_RUNTIME_FAULT_KIND,
          internalDetail: BOOTSTRAP_DIAGNOSIS,
        });
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    const error: SyntheticProcessRunnerError = await captureRunFailure(runner);

    expect(error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(error.internalDetail).toBe(BOOTSTRAP_DIAGNOSIS);
    expect(error.remoteStack).toBeUndefined();
    expect(error.message).toBe(
      "Synthetic monitor could not start on this probe.",
    );
  });

  test("leaves internal detail undefined for an ordinary worker failure, even one carrying the property", async () => {
    /*
     * An ordinary worker failure reports through its message, stack and all.
     * A property that merely happens to be called internalDetail is not a
     * diagnosis the worker vouched for, and must not surface as one.
     */
    const child: FakeChildProcess = new FakeChildProcess(41_205);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitFailure(
          child,
          Object.assign(new Error("TypeError: page.clickk is not a function"), {
            internalDetail: "not a diagnosis the worker vouched for",
          }),
        );
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    const error: SyntheticProcessRunnerError = await captureRunFailure(runner);

    expect(error.kind).toBeUndefined();
    expect(error.internalDetail).toBeUndefined();
    expect(error.remoteStack).toBeUndefined();
    expect(error.message).toContain("TypeError: page.clickk is not a function");
    expect(error.message).toContain("ProcessRunner.test.ts");
    expect(error.message).not.toContain(
      "not a diagnosis the worker vouched for",
    );
  });

  test("leaves internal detail undefined for a runtime fault that has none", async () => {
    const child: FakeChildProcess = new FakeChildProcess(41_206);
    getForkMock().mockImplementation(() => {
      return asChildProcess(child);
    });
    child.onSend = (): void => {
      global.setImmediate(() => {
        emitFailure(
          child,
          new SyntheticRuntimeFault({
            message: "Synthetic monitor could not start on this probe.",
          }),
        );
        emitExit(child, null);
      });
    };

    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
      concurrencyLimit: 1,
    });

    const error: SyntheticProcessRunnerError = await captureRunFailure(runner);

    expect(error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(error.internalDetail).toBeUndefined();
    expect(error.remoteStack).toContain("SyntheticRuntimeFault");
    expect(error.message).toBe(
      "Synthetic monitor could not start on this probe.",
    );
  });

  interface MalformedDetailCase {
    readonly name: string;
    readonly pid: number;
    readonly error: Record<string, unknown>;
  }

  const malformedDetailCases: Array<MalformedDetailCase> = [
    {
      name: "internal detail without a kind",
      pid: 43_101,
      error: {
        message: "Synthetic monitor could not start on this probe.",
        stack: "Error: Synthetic monitor could not start on this probe.",
        internalDetail: BOOTSTRAP_DIAGNOSIS,
      },
    },
    {
      name: "a non-string internal detail",
      pid: 43_102,
      error: {
        message: "Synthetic monitor could not start on this probe.",
        kind: SYNTHETIC_RUNTIME_FAULT_KIND,
        internalDetail: { callLog: BOOTSTRAP_DIAGNOSIS },
      },
    },
    {
      name: "an internal detail over the maximum length",
      pid: 43_103,
      error: {
        message: "Synthetic monitor could not start on this probe.",
        kind: SYNTHETIC_RUNTIME_FAULT_KIND,
        internalDetail: `${BOOTSTRAP_DIAGNOSIS}${"x".repeat(
          MAX_ERROR_INTERNAL_DETAIL_LENGTH,
        )}`,
      },
    },
    {
      name: "an unknown key beside the internal detail",
      pid: 43_104,
      error: {
        message: "Synthetic monitor could not start on this probe.",
        kind: SYNTHETIC_RUNTIME_FAULT_KIND,
        internalDetail: BOOTSTRAP_DIAGNOSIS,
        callLog: BOOTSTRAP_DIAGNOSIS,
      },
    },
  ];

  test.each(malformedDetailCases)(
    "treats a failure envelope carrying $name as a protocol violation",
    async ({ pid, error: forgedError }: MalformedDetailCase) => {
      /*
       * The detail is trusted only because the envelope around it passed the
       * exact-shape check. A malformed one is handled like any other invalid
       * envelope: the worker's process group is terminated, and nothing it
       * sent -- fault marker, message or detail -- reaches the caller.
       */
      jest.spyOn(process, "getuid").mockReturnValue(501);
      const child: FakeChildProcess = new FakeChildProcess(pid);
      const forkSpy: jest.Mock = getForkMock().mockImplementation(() => {
        return asChildProcess(child);
      });
      const signalMock: ProcessGroupSignalMock = mockProcessGroupSignals({
        child,
        exitOn: "SIGTERM",
      });
      child.onSend = (): void => {
        global.setImmediate(() => {
          emitFailureWithError(child, forgedError);
        });
      };

      const runner: ProcessRunner = new ProcessRunner({
        workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
        concurrencyLimit: 1,
        terminationGraceInMs: 20,
        killWaitInMs: 20,
      });

      const error: SyntheticProcessRunnerError =
        await captureRunFailure(runner);

      expect(error).toBeInstanceOf(SyntheticProcessRunnerError);
      expect(error.message).toBe(
        "Synthetic worker sent an invalid result envelope.",
      );
      expect(error.kind).toBeUndefined();
      expect(error.internalDetail).toBeUndefined();
      expect(error.remoteStack).toBeUndefined();
      expect(signalMock.signals).toContain("SIGTERM");
      const options: ForkOptions = forkOptionsAt(forkSpy, 0);
      expect(fs.existsSync(options.env?.["HOME"] as string)).toBe(false);
      expect(runner.activeCount).toBe(0);
    },
  );

  test("keeps the synthetic runtime's own host out of every proxy, configured or not", async () => {
    /*
     * The controller document is fulfilled from memory, so it should never
     * reach a proxy in the first place -- but that is an ordering guarantee
     * inside Chromium's network stack, and a corporate proxy asked for a host
     * that cannot resolve hangs rather than failing fast. The bootstrap is the
     * least affordable place to find that out.
     */
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(41_103);
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
      // No proxy configured at all, and no NO_PROXY of any kind.
      environment: {},
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
    expect(environment?.["NO_PROXY"]).toBe(
      "synthetic-runtime.oneuptime.invalid",
    );
    expect(environment?.["no_proxy"]).toBe(
      "synthetic-runtime.oneuptime.invalid",
    );
  });

  test("does not list the synthetic runtime host twice when it is already bypassed", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(501);
    const child: FakeChildProcess = new FakeChildProcess(41_104);
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
        NO_PROXY: "synthetic-runtime.oneuptime.invalid, localhost",
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
    expect(environment?.["NO_PROXY"]).toBe(
      "synthetic-runtime.oneuptime.invalid, localhost",
    );
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
      "exceeded memory limit of 1048576 bytes (observed 1126400 bytes)",
    );

    expect(child.send).not.toHaveBeenCalled();
    // `ps` names no pids whose PSS could be read, so the sum is final.
    expect(childProcess.execFile).not.toHaveBeenCalled();
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
      "exceeded memory limit of 1048576 bytes (observed 1228800 bytes)",
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

  describe("process-tree memory limit on Linux", () => {
    const LIMIT_BYTES: number = 1_610_612_736;
    const WORKER_PID: number = 49_401;
    const CALLER_PROCESS_GROUP_ID: number = 900_401;

    afterEach(() => {
      restorePlatform();
      (childProcess.execFile as unknown as jest.Mock).mockReset();
    });

    function runAsRootSupervisor(): void {
      jest.spyOn(process, "getuid").mockReturnValue(0);
      jest.spyOn(fs.promises, "chown").mockResolvedValue(undefined);
    }

    function createRunner(
      options: Partial<ProcessRunnerOptions> = {},
    ): ProcessRunner {
      return new ProcessRunner({
        workerEntryPath: "Workers/SyntheticMonitorWorker.ts",
        concurrencyLimit: 1,
        childUid: 30_000,
        childGid: 40_000,
        maxProcessTreeRssBytes: LIMIT_BYTES,
        rssPollIntervalInMs: 60_000,
        terminationGraceInMs: 20,
        killWaitInMs: 20,
        ...options,
      });
    }

    function startRun(
      runner: ProcessRunner,
    ): Promise<ProcessRunResult<TestResult>> {
      return runner.run<TestConfig, TestResult>({
        payload: { monitorId: "monitor-1" },
        timeoutInMs: 5000,
        validateResult: isTestResult,
      });
    }

    function startWorker(
      options: {
        readonly processes?: FakeProcProcess[];
        readonly helperPresent?: boolean;
      } = {},
    ): { child: FakeChildProcess; fakeProc: FakeProc } {
      const child: FakeChildProcess = new FakeChildProcess(WORKER_PID);
      getForkMock().mockImplementation(() => {
        return asChildProcess(child);
      });
      const fakeProc: FakeProc = installFakeProc({
        child,
        callerProcessGroupId: CALLER_PROCESS_GROUP_ID,
        processes: options.processes ?? chromiumCheckTree(WORKER_PID),
        helperPresent: options.helperPresent ?? true,
      });
      return { child, fakeProc };
    }

    async function settleHelperAnswers(): Promise<void> {
      await new Promise<void>((resolve: () => void) => {
        global.setImmediate(resolve);
      });
      await flushMicrotasks();
    }

    test("the Chromium-shaped tree reproduces the reported error by summed VmRSS", () => {
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);

      expect(sumKilobytes(tree, "residentKb") * 1024).toBe(1_612_525_568);
      expect(sumKilobytes(tree, "residentKb") * 1024).toBeGreaterThan(
        LIMIT_BYTES,
      );
      expect(sumKilobytes(tree, "proportionalKb") * 1024).toBe(822_083_584);
    });

    test("lets a check finish whose summed VmRSS is over the limit but whose PSS is not", async () => {
      runAsRootSupervisor();
      const { child, fakeProc } = startWorker();
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);
      const runner: ProcessRunner = createRunner();

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitFor(() => {
        return (
          child.send.mock.calls.length > 0 && fakeProc.helperCalls.length > 0
        );
      }, "the start envelope and the PSS measurement");
      await settleHelperAnswers();

      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();

      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
      expect(fakeProc.helperCalls).toHaveLength(1);
      const helperCall: FakeProc["helperCalls"][number] = fakeProc
        .helperCalls[0] as FakeProc["helperCalls"][number];
      expect(helperCall.file).toBe(PROCESS_MEMORY_HELPER_PATH);
      // The identity the worker was forked with, then every pid in its tree.
      expect(helperCall.args.slice(0, 2)).toEqual(["30000", "40000"]);
      expect(
        helperCall.args
          .slice(2)
          .map(Number)
          .sort((left: number, right: number) => {
            return left - right;
          }),
      ).toEqual(
        tree
          .map((fakeProcess: FakeProcProcess) => {
            return fakeProcess.pid;
          })
          .sort((left: number, right: number) => {
            return left - right;
          }),
      );
      expect(runner.activeCount).toBe(0);
    });

    test("stops a check whose PSS is over the limit and reports its PSS", async () => {
      runAsRootSupervisor();
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);
      const renderer: FakeProcProcess = tree[7] as FakeProcProcess;
      renderer.residentKb = 1_150_000;
      renderer.proportionalKb = 1_100_000;
      const { child, fakeProc } = startWorker({ processes: tree });
      const runner: ProcessRunner = createRunner();

      const failure: Error = await startRun(runner).then(
        (): never => {
          throw new Error("Expected the check to be stopped.");
        },
        (error: Error) => {
          return error;
        },
      );

      const expectedBytes: number = sumKilobytes(tree, "proportionalKb") * 1024;
      expect(expectedBytes).toBe(1_649_639_424);
      expect(failure).toBeInstanceOf(SyntheticProcessRunnerError);
      expect(failure.message).toBe(
        `Synthetic worker process tree exceeded memory limit of ${LIMIT_BYTES} bytes (observed ${expectedBytes} bytes).`,
      );
      expect(fakeProc.helperCalls).toHaveLength(1);
      expect(fakeProc.killedSignals).toEqual(
        expect.arrayContaining([{ pid: -child.pid, signal: "SIGTERM" }]),
      );
      expect(runner.activeCount).toBe(0);
    });

    test("counts every process whose PSS cannot be read at its VmRSS", async () => {
      runAsRootSupervisor();
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);
      // The browser, GPU and network processes and two renderers hide.
      for (const index of [1, 4, 5, 7, 8]) {
        (tree[index] as FakeProcProcess).proportionalKb = null;
      }
      const { fakeProc } = startWorker({ processes: tree });
      const limitKb: number = 1_200_000;
      const runner: ProcessRunner = createRunner({
        maxProcessTreeRssBytes: limitKb * 1024,
      });

      /*
       * Read in full, the tree is at 802,816 kB of PSS, well under the limit.
       * Counting the five hidden processes at their VmRSS puts it over.
       */
      const expectedKb: number = tree.reduce(
        (total: number, fakeProcess: FakeProcProcess) => {
          return (
            total +
            (fakeProcess.proportionalKb ?? (fakeProcess.residentKb as number))
          );
        },
        0,
      );
      expect(expectedKb).toBe(1_244_672);
      expect(expectedKb).toBeGreaterThan(limitKb);

      await expect(startRun(runner)).rejects.toThrow(
        `exceeded memory limit of ${limitKb * 1024} bytes (observed ${expectedKb * 1024} bytes, counting 5 of 12 processes at their resident size because their proportional size could not be read).`,
      );
      expect(fakeProc.helperCalls).toHaveLength(1);
    });

    test("falls back to summed VmRSS, as before, when the image has no helper", async () => {
      runAsRootSupervisor();
      const { fakeProc } = startWorker({ helperPresent: false });
      const runner: ProcessRunner = createRunner();

      // The number the customer's monitors reported, now saying how it was read.
      await expect(startRun(runner)).rejects.toThrow(
        `Synthetic worker process tree exceeded memory limit of 1610612736 bytes (observed 1612525568 bytes, counting 12 of 12 processes at their resident size because their proportional size could not be read).`,
      );
      expect(fakeProc.helperCalls).toHaveLength(0);
      expect(fakeProc.smapsRollupReads).toHaveLength(0);
    });

    test("never measures PSS while summed VmRSS is within the limit", async () => {
      runAsRootSupervisor();
      const { child, fakeProc } = startWorker();
      const runner: ProcessRunner = createRunner({
        maxProcessTreeRssBytes: 2048 * 1024 * 1024,
      });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitFor(() => {
        return child.send.mock.calls.length > 0;
      }, "the start envelope");
      await settleHelperAnswers();
      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();

      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
      expect(fakeProc.helperCalls).toHaveLength(0);
      expect(fakeProc.smapsRollupReads).toHaveLength(0);
    });

    test("reads PSS itself when the check runs under the supervisor's own uid", async () => {
      jest.spyOn(process, "getuid").mockReturnValue(501);
      const { child, fakeProc } = startWorker();
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);
      const runner: ProcessRunner = createRunner();

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitFor(() => {
        return (
          child.send.mock.calls.length > 0 &&
          fakeProc.smapsRollupReads.length >= tree.length
        );
      }, "the start envelope and the smaps_rollup reads");
      await settleHelperAnswers();
      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();

      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
      expect(forkOptionsAt(getForkMock(), 0).uid).toBeUndefined();
      expect(fakeProc.helperCalls).toHaveLength(0);
      expect([...fakeProc.smapsRollupReads].sort()).toEqual(
        tree
          .map((fakeProcess: FakeProcProcess) => {
            return `/proc/${fakeProcess.pid}/smaps_rollup`;
          })
          .sort(),
      );
    });

    test("reads the tree again at once when it grows by more than it had to spare, and stops it past the limit", async () => {
      const timers: ManualTimerController = installManualTimers();
      runAsRootSupervisor();
      const { child, fakeProc } = startWorker();
      const runner: ProcessRunner = createRunner({
        rssPollIntervalInMs: 250,
        diskPollIntervalInMs: 500,
      });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      const runExpectation: Promise<void> = expect(run).rejects.toThrow(
        `exceeded memory limit of ${LIMIT_BYTES} bytes (observed 1700839424 bytes).`,
      );

      // The first poll finds the tree under the limit by PSS and schedules the next.
      await waitForActiveTimer(timers, 250);
      expect(fakeProc.helperCalls).toHaveLength(1);
      expect(child.send).toHaveBeenCalledTimes(1);

      /*
       * The page then grows a renderer past the limit, well within the second
       * the first reading is reused for, but by more VmRSS (808,832 kB) than
       * the tree had to spare (770,048 kB).
       */
      const renderer: FakeProcProcess = fakeProc.processes.get(
        WORKER_PID + 10_000 + 6,
      ) as FakeProcProcess;
      renderer.residentKb = 1_200_000;
      renderer.proportionalKb = 1_150_000;
      timers.fireByDelay(250);

      await runExpectation;
      expect(fakeProc.helperCalls).toHaveLength(2);
      expect(timers.activeTimerCount(250)).toBe(0);
      expect(runner.activeCount).toBe(0);
    });

    test("abandons a PSS measurement still running when the check ends", async () => {
      runAsRootSupervisor();
      const { child, fakeProc } = startWorker();
      fakeProc.holdHelperAnswers = true;
      const runner: ProcessRunner = createRunner();

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitFor(() => {
        return (
          child.send.mock.calls.length > 0 && fakeProc.helperCalls.length > 0
        );
      }, "the start envelope and the PSS measurement");

      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();

      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
      const helperCall: FakeProc["helperCalls"][number] = fakeProc
        .helperCalls[0] as FakeProc["helperCalls"][number];
      expect(helperCall.options.signal?.aborted).toBe(true);

      // A late answer changes nothing.
      fakeProc.answerPendingHelper();
      await settleHelperAnswers();
      expect(fakeProc.helperCalls).toHaveLength(1);
      expect(runner.activeCount).toBe(0);
    });

    test("counts a process whose main thread has exited through its remaining threads", async () => {
      runAsRootSupervisor();
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);
      const renderer: FakeProcProcess = tree[7] as FakeProcProcess;
      const rendererResidentKb: number = renderer.residentKb as number;
      tree[7] = {
        ...renderer,
        residentKb: null,
        proportionalKb: null,
        otherThreads: [{ tid: 70_001, residentKb: rendererResidentKb }],
      };
      startWorker({ processes: tree, helperPresent: false });
      const runner: ProcessRunner = createRunner();

      /*
       * Its own status has no memory lines. Without its thread's, the tree
       * would sum to 1,183,564 kB and never reach the limit.
       */
      expect(sumKilobytes(tree, "residentKb") * 1024 < LIMIT_BYTES).toBe(true);
      await expect(startRun(runner)).rejects.toThrow(
        `exceeded memory limit of ${LIMIT_BYTES} bytes (observed 1612525568 bytes, counting 12 of 12 processes`,
      );
    });

    test("counts nothing for renderers that exit while the tree is being read", async () => {
      /*
       * A script that navigates across sites or closes pages retires
       * renderers all the time. One read at its VmRSS in the snapshot but
       * gone by the time its PSS is read holds nothing; counting it at its old
       * VmRSS brought back the very over-count this reading exists to avoid.
       */
      runAsRootSupervisor();
      const { child, fakeProc } = startWorker();
      fakeProc.holdHelperAnswers = true;
      const limitKb: number = 1_000_000;
      const runner: ProcessRunner = createRunner({
        maxProcessTreeRssBytes: limitKb * 1024,
      });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitFor(() => {
        return (
          child.send.mock.calls.length > 0 && fakeProc.helperCalls.length > 0
        );
      }, "the start envelope and the PSS reading");

      // Three renderers exit after the snapshot and before the helper reads them.
      const exited: FakeProcProcess[] = [6, 7, 8].map((offset: number) => {
        return fakeProc.processes.get(
          WORKER_PID + 10_000 + offset,
        ) as FakeProcProcess;
      });
      for (const renderer of exited) {
        fakeProc.processes.delete(renderer.pid);
      }
      // Counted at their snapshot VmRSS they would put the tree over.
      expect(
        802_816 -
          sumKilobytes(exited, "proportionalKb") +
          sumKilobytes(exited, "residentKb"),
      ).toBeGreaterThan(limitKb);
      fakeProc.answerPendingHelper();
      await settleHelperAnswers();

      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();

      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
    });

    test("reads again instead of stopping the check when a reading fails", async () => {
      runAsRootSupervisor();
      const warnSpy: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const { child, fakeProc } = startWorker();
      fakeProc.helperFailures.push(
        Object.assign(new Error("timed out"), {
          killed: true,
          signal: "SIGKILL",
        }),
      );
      const runner: ProcessRunner = createRunner({ rssPollIntervalInMs: 20 });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitFor(() => {
        return fakeProc.helperCalls.length >= 2;
      }, "a second PSS reading");
      await settleHelperAnswers();
      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();

      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
        "did not finish within 5000 ms",
      );
    });

    test("judges the tree by what could be read once its readings have kept failing for ten seconds", async () => {
      const timers: ManualTimerController = installManualTimers();
      let nowInMs: number = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowInMs;
      });
      runAsRootSupervisor();
      const warnSpy: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const { fakeProc } = startWorker();
      for (let index: number = 0; index < 10; index++) {
        fakeProc.helperFailures.push(
          Object.assign(new Error("exit 3"), { code: 3 }),
        );
      }
      const runner: ProcessRunner = createRunner({
        rssPollIntervalInMs: 250,
        diskPollIntervalInMs: 500,
      });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      const runExpectation: Promise<void> = expect(run).rejects.toThrow(
        `Synthetic worker process tree exceeded memory limit of ${LIMIT_BYTES} bytes (observed 1612525568 bytes, counting 12 of 12 processes at their resident size because their proportional size could not be read).`,
      );

      // Each failed reading is retried after a pause, not on the next poll.
      for (const elapsedInMs of [0, 5_000]) {
        await waitForActiveTimer(timers, 1000);
        expect(fakeProc.helperCalls).toHaveLength(elapsedInMs / 5_000 + 1);
        expect(timers.activeTimerCount(250)).toBe(0);
        nowInMs += 5_000;
        timers.fireByDelay(1000);
      }

      // Ten seconds after the first failure, the third is not retried.
      await runExpectation;
      expect(fakeProc.helperCalls).toHaveLength(3);
      // Once a minute at most, however many readings fail.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
        "exited with code 3",
      );
    });

    test("reads processes that start while the tree is being read in a further round", async () => {
      /*
       * A tree cannot hide memory in processes that live shorter than a
       * reading takes: those it was asked about may be gone by the time they
       * are read, but their replacements are read before it is judged.
       */
      runAsRootSupervisor();
      const { fakeProc } = startWorker();
      const limitKb: number = 1_000_000;
      const runner: ProcessRunner = createRunner({
        maxProcessTreeRssBytes: limitKb * 1024,
      });
      const rendererZygotePid: number = WORKER_PID + 10_000 + 2;
      fakeProc.onHelperCall = (callIndex: number): void => {
        if (callIndex !== 0) {
          return;
        }
        // While the first round runs, three renderers are replaced.
        for (const offset of [6, 7, 8]) {
          fakeProc.processes.delete(WORKER_PID + 10_000 + offset);
        }
        for (const pid of [69_001, 69_002, 69_003]) {
          fakeProc.processes.set(pid, {
            pid,
            parentPid: rendererZygotePid,
            processGroupId: WORKER_PID + 10_000,
            residentKb: 400_000,
            proportionalKb: 350_000,
          });
        }
      };

      /*
       * The nine survivors at their PSS (450,560 kB), the three that exited
       * at nothing, and the three newcomers at the PSS the second round read.
       */
      const expectedKb: number = 450_560 + 3 * 350_000;
      await expect(startRun(runner)).rejects.toThrow(
        `exceeded memory limit of ${limitKb * 1024} bytes (observed ${expectedKb * 1024} bytes).`,
      );
      expect(fakeProc.helperCalls).toHaveLength(2);
      expect(
        (fakeProc.helperCalls[1] as FakeProc["helperCalls"][number]).args.slice(
          2,
        ),
      ).toEqual(["69001", "69002", "69003"]);
    });

    test("reads a tree that changes faster than it can be read again, and judges it only after ten seconds", async () => {
      const timers: ManualTimerController = installManualTimers();
      let nowInMs: number = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowInMs;
      });
      runAsRootSupervisor();
      const warnSpy: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const { fakeProc } = startWorker();
      const limitKb: number = 1_000_000;
      const runner: ProcessRunner = createRunner({
        maxProcessTreeRssBytes: limitKb * 1024,
        rssPollIntervalInMs: 250,
        diskPollIntervalInMs: 500,
      });
      const rendererZygotePid: number = WORKER_PID + 10_000 + 2;
      const renderers: number[] = [
        WORKER_PID + 10_000 + 6,
        WORKER_PID + 10_000 + 7,
        WORKER_PID + 10_000 + 8,
      ];
      let nextPid: number = 70_000;
      // Every round, the renderers it asks about are replaced by new ones.
      fakeProc.onHelperCall = (): void => {
        for (const pid of renderers.splice(0)) {
          fakeProc.processes.delete(pid);
        }
        for (let index: number = 0; index < 3; index++) {
          const pid: number = nextPid++;
          renderers.push(pid);
          fakeProc.processes.set(pid, {
            pid,
            parentPid: rendererZygotePid,
            processGroupId: WORKER_PID + 10_000,
            residentKb: 400_000,
            proportionalKb: 350_000,
          });
        }
      };

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      /*
       * Each reading runs three rounds, each outrun by the tree; the three
       * renderers that appeared during the last one count at their VmRSS.
       */
      const expectedKb: number = 450_560 + 3 * 400_000;
      const runExpectation: Promise<void> = expect(run).rejects.toThrow(
        `exceeded memory limit of ${limitKb * 1024} bytes (observed ${expectedKb * 1024} bytes, counting 3 of 12 processes at their resident size because their proportional size could not be read).`,
      );

      for (const readings of [1, 2]) {
        await waitForActiveTimer(timers, 1000);
        expect(fakeProc.helperCalls).toHaveLength(readings * 3);
        nowInMs += 5_000;
        timers.fireByDelay(1000);
      }

      await runExpectation;
      expect(fakeProc.helperCalls).toHaveLength(9);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
        "changed faster than it could be read: 3 processes appeared after 3 rounds",
      );
    });

    test("lets a check finish when a burst of new processes settles before the retry", async () => {
      const timers: ManualTimerController = installManualTimers();
      let nowInMs: number = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowInMs;
      });
      runAsRootSupervisor();
      jest.spyOn(logger, "warn").mockImplementation(() => {});
      const { child, fakeProc } = startWorker();
      const runner: ProcessRunner = createRunner({
        rssPollIntervalInMs: 250,
        diskPollIntervalInMs: 500,
      });
      const rendererZygotePid: number = WORKER_PID + 10_000 + 2;
      let nextPid: number = 71_000;
      // A navigation: new renderers appear during each of the first three rounds only.
      fakeProc.onHelperCall = (callIndex: number): void => {
        if (callIndex > 2) {
          return;
        }
        const pid: number = nextPid++;
        fakeProc.processes.set(pid, {
          pid,
          parentPid: rendererZygotePid,
          processGroupId: WORKER_PID + 10_000,
          residentKb: 140_000,
          proportionalKb: 40_000,
        });
      };

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitForActiveTimer(timers, 1000);
      expect(fakeProc.helperCalls).toHaveLength(3);
      nowInMs += 1_000;
      timers.fireByDelay(1000);

      // The retry reads the settled tree -- PSS well under the limit.
      await waitForActiveTimer(timers, 250);
      expect(fakeProc.helperCalls).toHaveLength(4);
      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();
      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
    });

    test("does not reuse a reading that counted a process at its VmRSS", async () => {
      const timers: ManualTimerController = installManualTimers();
      let nowInMs: number = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowInMs;
      });
      runAsRootSupervisor();
      const tree: FakeProcProcess[] = chromiumCheckTree(WORKER_PID);
      // One small process hides its PSS; the tree stays under the limit.
      (tree[6] as FakeProcProcess).proportionalKb = null;
      const { child, fakeProc } = startWorker({ processes: tree });
      const runner: ProcessRunner = createRunner({
        rssPollIntervalInMs: 250,
        diskPollIntervalInMs: 500,
      });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitForActiveTimer(timers, 250);
      expect(fakeProc.helperCalls).toHaveLength(1);

      nowInMs += 250;
      timers.fireByDelay(250);
      await waitFor(() => {
        return fakeProc.helperCalls.length === 2;
      }, "the second PSS reading");
      await waitForActiveTimer(timers, 250);

      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();
      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
    });

    test("reuses a reading for a second while the tree grows less than it had to spare", async () => {
      const timers: ManualTimerController = installManualTimers();
      let nowInMs: number = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowInMs;
      });
      runAsRootSupervisor();
      const { child, fakeProc } = startWorker();
      const runner: ProcessRunner = createRunner({
        rssPollIntervalInMs: 250,
        diskPollIntervalInMs: 500,
      });

      const run: Promise<ProcessRunResult<TestResult>> = startRun(runner);
      await waitForActiveTimer(timers, 250);
      expect(fakeProc.helperCalls).toHaveLength(1);

      // Grown by 100,000 kB, less than the 770,048 kB it had to spare.
      const renderer: FakeProcProcess = fakeProc.processes.get(
        WORKER_PID + 10_000 + 6,
      ) as FakeProcProcess;
      renderer.residentKb = (renderer.residentKb as number) + 100_000;
      renderer.proportionalKb = (renderer.proportionalKb as number) + 100_000;

      nowInMs += 500;
      timers.fireByDelay(250);
      await waitForActiveTimer(timers, 250);
      expect(fakeProc.helperCalls).toHaveLength(1);

      // A second after the reading, it is read again.
      nowInMs += 500;
      timers.fireByDelay(250);
      await waitFor(() => {
        return fakeProc.helperCalls.length === 2;
      }, "the second PSS reading");
      await waitForActiveTimer(timers, 250);

      emitSuccess(child, { value: "logged in" });
      fakeProc.exitWorker();
      await expect(run).resolves.toEqual(
        expect.objectContaining({ result: { value: "logged in" } }),
      );
    });
  });
});

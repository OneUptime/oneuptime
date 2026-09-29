import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { BrowserContext, Page, chromium } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ProcessRunner, {
  ProcessRunResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import SyntheticBrowser, {
  SyntheticBrowserSession,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import SyntheticRuntimeFault, {
  SYNTHETIC_RUNTIME_FAULT_KIND,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";

/*
 * The regression test for "Synthetic monitor could not start on this probe:
 * the browser runtime did not finish starting up after 3 attempt(s) of up to
 * 20000 ms", against a real Chromium on storage that is slow to acknowledge
 * writes.
 *
 * From 12.0.11 every check ran in launchPersistentContext() on a brand-new
 * on-disk profile. Chromium does not hand the runtime's controller navigation
 * to page.route until that profile's cookie database has been created and
 * synced, so on a throttled volume every bootstrap attempt stalled for as long
 * as the disk did -- all three of them, because they share the browser, and
 * again in the retry worker, which built another fresh profile. The fix is
 * SyntheticBrowser: launch() plus an ephemeral browser.newContext(), whose
 * cookie store lives in memory.
 *
 * The slow storage is made, not found: Chromium runs under strace, which
 * delays every fsync and fdatasync in every Chromium process. That is exactly
 * a device slow to acknowledge syncs, and it reproduces what a cgroup io.max
 * write-IOPS cap did to the production probe image.
 *
 * - CONTROL shows the harness really does slow storage enough to break the
 *   pre-fix shape (a fresh persistent profile). A harness that cannot fail
 *   proves nothing, so this one is required to fail, and to fail at the step
 *   the root cause names: the navigation starts but is never intercepted.
 * - FIX runs the same bootstrap on the same storage through SyntheticBrowser.
 * - END-TO-END runs a whole check through the real ProcessRunner and the real
 *   SyntheticMonitorWorker with production bootstrap budgets.
 */

const PROBE_DIRECTORY: string = path.resolve(__dirname, "../../../..");

/*
 * How long each fsync/fdatasync waits, chosen from measurements on a loaded
 * 8-core machine. A fresh persistent profile held the controller navigation
 * for 17 s at 1 s per sync, 40 s at 2 s, 45 s at 3 s -- 12 to 20 syncs -- and
 * for longer than a whole 60 s budget at 8 s.
 *
 * The delay has to outlast the pre-fix worker's entire bootstrap budget (3 x
 * 20 s), not just CONTROL's 10 s. At 2 s the pre-fix worker's third attempt
 * got through after about a minute: the check succeeded late instead of
 * failing the way it failed for customers, and END-TO-END could not tell the
 * two apart. At 8 s it fails all three.
 *
 * Nothing in the fixed path waits on a sync. At 8 s, SyntheticBrowser started
 * in 0.2-0.9 s, the bootstrap ran in 0.1-0.5 s, and a whole check through
 * ProcessRunner took 1.9-5.7 s.
 */
const SYNC_DELAY_IN_MICROSECONDS: number = 8_000_000;
const CONTROL_BOOTSTRAP_TIMEOUT_IN_MS: number = 10_000;
/*
 * The pre-fix worker could only report this failure after spending all three
 * 20-second bootstrap attempts, so a check that finishes sooner than that did
 * not go down the failure path at all.
 */
const PRE_FIX_FAILURE_PATH_MINIMUM_IN_MS: number = 3 * 20_000;
const END_TO_END_RUN_TIMEOUT_IN_MS: number = 150_000;
const TEARDOWN_WAIT_IN_MS: number = 10_000;

interface SlowStorageHarness {
  readonly directory: string;
  // The browser executable Playwright launches: Chromium under strace.
  readonly executablePath: string;
  // Every wrapper appends its PID, which is also its process group ID.
  readonly processGroupFile: string;
}

function findExecutableOnPath(name: string): string | null {
  const directories: string[] = [
    ...(process.env["PATH"] || "").split(path.delimiter),
    "/usr/bin",
    "/bin",
  ];

  for (const directory of directories) {
    if (!directory) {
      continue;
    }
    const candidate: string = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }

  return null;
}

function getStraceArguments(delayInMicroseconds: number): string[] {
  return [
    "-f",
    "-qq",
    "--seccomp-bpf",
    "-o",
    "/dev/null",
    "-e",
    "trace=fsync,fdatasync",
    "-e",
    `inject=fsync,fdatasync:delay_enter=${delayInMicroseconds}`,
  ];
}

function getStraceUnavailableReason(stracePath: string | null): string | null {
  if (process.platform !== "linux") {
    return `strace is Linux-only and this is ${process.platform}`;
  }
  if (!stracePath) {
    return "strace is not installed";
  }

  // The same flags the browser will run under, so a partial strace fails here.
  const probe: SpawnSyncReturns<string> = spawnSync(
    stracePath,
    [...getStraceArguments(1), "/bin/sh", "-c", "exit 0"],
    { encoding: "utf8", timeout: 15_000 },
  );
  if (probe.error) {
    return `strace could not run: ${probe.error.message}`;
  }
  if (probe.status !== 0) {
    return `strace cannot trace a child process here (exit ${probe.status}, signal ${probe.signal}): ${probe.stderr.trim()}`;
  }

  return null;
}

function isCi(): boolean {
  const value: string = (process.env["CI"] || "").trim().toLowerCase();
  return value !== "" && value !== "false" && value !== "0";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const STRACE_PATH: string | null = findExecutableOnPath("strace");
const STRACE_UNAVAILABLE_REASON: string | null =
  getStraceUnavailableReason(STRACE_PATH);

function createSlowStorageHarness(): SlowStorageHarness {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-slow-storage-"),
  );
  const executablePath: string = path.join(
    directory,
    "chromium-on-slow-storage.sh",
  );
  const processGroupFile: string = path.join(directory, "process-groups");

  /*
   * Playwright spawns the executable detached, so the wrapper's PID -- which
   * exec hands on to strace -- leads a process group holding every Chromium
   * process. Recording it lets teardown kill the lot at once instead of
   * waiting for a browser on slow storage to flush its profile, which takes
   * half a minute.
   */
  fs.writeFileSync(
    executablePath,
    [
      "#!/bin/sh",
      `echo "$$" >> ${shellQuote(processGroupFile)}`,
      `exec ${shellQuote(STRACE_PATH as string)} ${getStraceArguments(
        SYNC_DELAY_IN_MICROSECONDS,
      ).join(" ")} ${shellQuote(chromium.executablePath())} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  return { directory, executablePath, processGroupFile };
}

function readRecordedProcessGroups(harness: SlowStorageHarness): number[] {
  if (!fs.existsSync(harness.processGroupFile)) {
    return [];
  }

  return fs
    .readFileSync(harness.processGroupFile, "utf8")
    .split("\n")
    .map((line: string): number => {
      return Number(line.trim());
    })
    .filter((pid: number): boolean => {
      return Number.isSafeInteger(pid) && pid > 1;
    });
}

function isProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

function isStraceProcess(pid: number): boolean {
  try {
    return fs
      .readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")[0]!
      .endsWith("strace");
  } catch {
    return false;
  }
}

async function destroySlowStorageHarness(
  harness: SlowStorageHarness,
): Promise<void> {
  const processGroups: number[] = readRecordedProcessGroups(harness);

  for (const processGroupId of processGroups) {
    // A PID that is no longer our strace may already belong to someone else.
    if (isStraceProcess(processGroupId)) {
      try {
        process.kill(-processGroupId, "SIGKILL");
      } catch {
        // It exited on its own in the meantime.
      }
    }
  }

  const deadlineAtInMs: number = Date.now() + TEARDOWN_WAIT_IN_MS;
  while (
    processGroups.some((processGroupId: number): boolean => {
      return (
        isStraceProcess(processGroupId) && isProcessGroupAlive(processGroupId)
      );
    }) &&
    Date.now() < deadlineAtInMs
  ) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });
  }

  await fs.promises.rm(harness.directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
  });
}

function createConfig(executablePath: string): SyntheticMonitorWorkerConfig {
  return {
    code: "return { data: true };",
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath,
    viewport: { width: 800, height: 600 },
    timeoutInMs: 30_000,
    chromiumSandboxEnabled: false,
    args: {},
  };
}

function bootstrapOnce(
  browserContext: BrowserContext,
  page: Page,
): Promise<SandboxExecutionResult> {
  return WorkerController.execute({
    browserContext,
    page,
    code: "return { data: true };",
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    args: {},
    timeoutInMs: 30_000,
    bootstrapAttempts: 1,
    bootstrapTimeoutInMs: CONTROL_BOOTSTRAP_TIMEOUT_IN_MS,
  });
}

describe("SyntheticBrowser slow-storage harness", () => {
  test("has strace, or says why the slow-storage regression tests are skipped", () => {
    if (STRACE_UNAVAILABLE_REASON === null) {
      return;
    }

    /*
     * Locally a missing strace skips the suite below, with the reason in its
     * title. On CI it must not: a regression guard that quietly skips is no
     * guard, so the workflow installs strace and this fails if it did not.
     */
    if (isCi()) {
      throw new Error(
        `The slow-storage regression tests need strace and must not be skipped on CI: ${STRACE_UNAVAILABLE_REASON}. Install strace on the runner (see .github/workflows/test.probe.yaml).`,
      );
    }
  });
});

const describeOnSlowStorage: jest.Describe =
  STRACE_UNAVAILABLE_REASON === null ? describe : describe.skip;

describeOnSlowStorage(
  STRACE_UNAVAILABLE_REASON === null
    ? "SyntheticBrowser on slow storage"
    : `SyntheticBrowser on slow storage (skipped: ${STRACE_UNAVAILABLE_REASON})`,
  () => {
    let harness: SlowStorageHarness;

    beforeEach(() => {
      harness = createSlowStorageHarness();
    });

    afterEach(async () => {
      await destroySlowStorageHarness(harness);
    }, TEARDOWN_WAIT_IN_MS + 20_000);

    test("CONTROL: a fresh on-disk profile never gets the bootstrap navigation intercepted", async () => {
      const browserContext: BrowserContext =
        await chromium.launchPersistentContext(
          path.join(harness.directory, "browser-profile"),
          {
            executablePath: harness.executablePath,
            chromiumSandbox: false,
            acceptDownloads: false,
            viewport: { width: 800, height: 600 },
          },
        );
      const page: Page =
        browserContext.pages()[0] || (await browserContext.newPage());

      const fault: SyntheticRuntimeFault = await bootstrapOnce(
        browserContext,
        page,
      ).then(
        (): SyntheticRuntimeFault => {
          throw new Error(
            "The slow-storage harness did not stall a persistent profile, so it cannot show that the fix works.",
          );
        },
        (error: SyntheticRuntimeFault): SyntheticRuntimeFault => {
          return error;
        },
      );

      expect(readRecordedProcessGroups(harness)).toHaveLength(1);
      expect(fault.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(fault.message).toContain(
        `did not finish starting up after 1 attempt(s) of up to ${CONTROL_BOOTSTRAP_TIMEOUT_IN_MS} ms`,
      );
      expect(fault.internalDetail).toMatch(
        new RegExp(
          `Bootstrap attempt 1/1 failed after \\d+ ms of its ${CONTROL_BOOTSTRAP_TIMEOUT_IN_MS} ms budget`,
        ),
      );
      // The page opened and the navigation started...
      expect(fault.internalDetail).toContain("navigation started");
      // ...but Chromium never handed the request to page.route.
      expect(fault.internalDetail).not.toContain(
        "sentinel request intercepted",
      );
    }, 90_000);

    /*
     * Cannot run against the pre-fix code, which has no SyntheticBrowser; the
     * END-TO-END test below is the one that fails there.
     */
    test("FIX: SyntheticBrowser's ephemeral context bootstraps on the same storage", async () => {
      const session: SyntheticBrowserSession = await SyntheticBrowser.start({
        config: createConfig(harness.executablePath),
      });
      const startedAtInMs: number = Date.now();

      const result: SandboxExecutionResult = await bootstrapOnce(
        session.browserContext,
        session.page,
      );

      expect(readRecordedProcessGroups(harness)).toHaveLength(1);
      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({ data: true });
      expect(Date.now() - startedAtInMs).toBeLessThan(
        CONTROL_BOOTSTRAP_TIMEOUT_IN_MS,
      );
    }, 90_000);

    test(
      "END-TO-END: a check succeeds through the real worker with production bootstrap budgets",
      async () => {
        const runner: ProcessRunner = new ProcessRunner({
          workerEntryPath: path.join(
            PROBE_DIRECTORY,
            "Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorker.ts",
          ),
          concurrencyLimit: 1,
          maxPendingCount: 0,
          workingDirectory: PROBE_DIRECTORY,
        });
        const startedAtInMs: number = Date.now();

        const output: ProcessRunResult<SyntheticMonitorWorkerResult> =
          await runner.run<
            SyntheticMonitorWorkerConfig,
            SyntheticMonitorWorkerResult
          >({
            payload: createConfig(harness.executablePath),
            timeoutInMs: END_TO_END_RUN_TIMEOUT_IN_MS,
            validateResult: isSyntheticMonitorWorkerResult,
          });
        const elapsedInMs: number = Date.now() - startedAtInMs;

        // The check really ran on the slow-storage browser.
        expect(readRecordedProcessGroups(harness)).toHaveLength(1);
        expect(output.result.scriptError).toBeUndefined();
        expect(output.result.returnValue).toEqual({ data: true });
        expect(elapsedInMs).toBeLessThan(PRE_FIX_FAILURE_PATH_MINIMUM_IN_MS);
      },
      END_TO_END_RUN_TIMEOUT_IN_MS + 20_000,
    );
  },
);

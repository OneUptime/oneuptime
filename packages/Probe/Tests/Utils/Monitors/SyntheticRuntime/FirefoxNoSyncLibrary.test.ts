import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Browser, Route, firefox } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticBrowser, {
  FIREFOX_NO_SYNC_LIBRARY_PATH,
  SyntheticBrowserSession,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";
import { SyntheticMonitorWorkerConfig } from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";

/*
 * The regression test for the no-sync library against a real Firefox.
 *
 * Firefox on slow storage waits on fsync()/fdatasync() of its throwaway
 * profile, so SyntheticBrowser preloads Native/synthetic-no-sync.c, which
 * turns both into no-ops. That only works while every sync Firefox issues goes
 * through those two libc functions. SyntheticBrowser.test.ts pins the launch
 * options against fakes and Tests/Build/ProbeFirefoxNoSyncLibrary.test.ts pins
 * the image step; neither can see a Firefox that syncs some other way -- a raw
 * syscall, sync_file_range(), a helper process that does not inherit the
 * preload. Then every Firefox check silently goes back to waiting on the disk.
 * This test fails instead.
 *
 * Firefox runs under strace, which records every sync system call in the
 * whole process tree:
 *
 * - CONTROL launches it through SyntheticBrowser without the library and
 *   requires syncs to show up. A trace that cannot see syncs proves nothing.
 * - WITH THE LIBRARY launches it the same way with the library and requires
 *   that not one sync reaches the kernel, across launch, an ephemeral context,
 *   an https navigation (which opens the certificate and key databases and
 *   records the visit in Places) and close.
 *
 * Both go through the real SyntheticBrowser.start(). The library it preloads
 * lives at a fixed, root-owned path that exists only in the probe image, so
 * the test cannot put it there. Instead it makes SyntheticBrowser see that
 * path as present, and the browser wrapper -- the one piece standing in for
 * the image -- hands Firefox the library this test compiled wherever
 * SyntheticBrowser asked for the image's. Everything else is the production
 * path: the environment SyntheticBrowser builds, Playwright passing it to the
 * browser, and Firefox passing it on to its own processes.
 */

const SHIM_SOURCE_PATH: string = path.resolve(
  __dirname,
  "../../../../Utils/Monitors/SyntheticRuntime/Native/synthetic-no-sync.c",
);

// The flags of the Dockerfile.tpl step, which ProbeFirefoxNoSyncLibrary.test.ts pins.
const GCC_ARGUMENTS: string[] = [
  "-shared",
  "-fPIC",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
];

/*
 * Every system call that makes a process wait for the disk to write what it
 * was given. The library covers only fsync and fdatasync, which is all Firefox
 * uses today; a Firefox that reaches for any of the others is waiting on the
 * disk again, so it has to fail here too.
 */
const SYNC_SYSCALLS: string[] = [
  "fsync",
  "fdatasync",
  "sync_file_range",
  "syncfs",
  "sync",
];

/*
 * The first line strace writes for a call, "<pid> fsync(12</path>) = 0" or
 * "<pid> fsync(12</path> <unfinished ...>". A "<... fsync resumed>" line
 * continues a call already counted.
 */
const SYNC_CALL_LINE: RegExp = new RegExp(
  `^\\d+\\s+(?:${SYNC_SYSCALLS.join("|")})\\(`,
);

// Taken before any test spies on it.
const REAL_EXISTS_SYNC: typeof fs.existsSync = fs.existsSync;

// An https URL, so the navigation opens Firefox's certificate and key databases.
const PAGE_URL: string = "https://no-sync-check.oneuptime.invalid/";
const PAGE_TITLE: string = "No-sync check";

const COMPILE_TIMEOUT_IN_MS: number = 60_000;
const STRACE_EXIT_WAIT_IN_MS: number = 15_000;
const TEARDOWN_WAIT_IN_MS: number = 10_000;

interface TracedFirefoxRun {
  // The page title, which only a browser that really loaded the page reports.
  readonly title: string;
  // LD_PRELOAD as SyntheticBrowser's launch handed it to the browser.
  readonly preloadRequestedByLaunch: string;
  // Every sync system call strace saw, one line each.
  readonly syncCalls: string[];
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

/*
 * -y names the file behind each descriptor, so a failure says which database
 * synced. The trace goes to a file, never to the browser's stderr.
 */
function getStraceArguments(traceFile: string): string[] {
  return [
    "-f",
    "-qq",
    "--seccomp-bpf",
    "-y",
    "-o",
    traceFile,
    "-e",
    `trace=${SYNC_SYSCALLS.join(",")}`,
  ];
}

function isCi(): boolean {
  const value: string = (process.env["CI"] || "").trim().toLowerCase();
  return value !== "" && value !== "false" && value !== "0";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const GCC_PATH: string | null = findExecutableOnPath("gcc");
const STRACE_PATH: string | null = findExecutableOnPath("strace");

function getUnavailableReason(): string | null {
  if (process.platform !== "linux") {
    return `LD_PRELOAD and strace are Linux-only and this is ${process.platform}`;
  }
  if (!GCC_PATH) {
    return "gcc is not installed";
  }
  if (!STRACE_PATH) {
    return "strace is not installed";
  }

  // The same flags Firefox will run under, so a partial strace fails here.
  const probe: SpawnSyncReturns<string> = spawnSync(
    STRACE_PATH,
    [
      ...getStraceArguments("/dev/null"),
      "-E",
      "ONEUPTIME_STRACE_PROBE=1",
      "/bin/sh",
      "-c",
      "exit 0",
    ],
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

const UNAVAILABLE_REASON: string | null = getUnavailableReason();

function compileLibrary(directory: string): string {
  const libraryPath: string = path.join(directory, "libsynthetic-no-sync.so");
  const result: SpawnSyncReturns<string> = spawnSync(
    GCC_PATH as string,
    [...GCC_ARGUMENTS, "-o", libraryPath, SHIM_SOURCE_PATH],
    { encoding: "utf8", timeout: COMPILE_TIMEOUT_IN_MS },
  );

  // A library that does not compile here does not compile in the image either.
  if (result.error || result.status !== 0) {
    throw new Error(
      `gcc could not build ${SHIM_SOURCE_PATH} (exit ${result.status}, signal ${result.signal}): ${result.error?.message || result.stderr.trim()}`,
    );
  }

  return libraryPath;
}

function readProcessGroup(processGroupFile: string): number | null {
  if (!fs.existsSync(processGroupFile)) {
    return null;
  }

  const pid: number = Number(fs.readFileSync(processGroupFile, "utf8").trim());
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
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

async function waitForStraceExit(
  pid: number,
  timeoutInMs: number,
): Promise<boolean> {
  const deadlineAtInMs: number = Date.now() + timeoutInMs;
  while (isStraceProcess(pid) && Date.now() < deadlineAtInMs) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });
  }

  return !isStraceProcess(pid);
}

function createConfig(executablePath: string): SyntheticMonitorWorkerConfig {
  return {
    code: "return { data: true };",
    browserType: BrowserType.Firefox,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath,
    viewport: { width: 800, height: 600 },
    timeoutInMs: 30_000,
    chromiumSandboxEnabled: false,
    args: {},
  };
}

describe("Firefox no-sync library tooling", () => {
  test("has gcc and strace, or says why the real-browser no-sync test is skipped", () => {
    if (UNAVAILABLE_REASON === null) {
      return;
    }

    /*
     * Locally a missing tool skips the suite below, with the reason in its
     * title. On CI it must not: a regression guard that quietly skips is no
     * guard.
     */
    if (isCi()) {
      throw new Error(
        `The real-browser no-sync test needs gcc and strace and must not be skipped on CI: ${UNAVAILABLE_REASON}. Install them on the runner (see .github/workflows/test.probe.yaml).`,
      );
    }
  });
});

const describeWithTools: jest.Describe =
  UNAVAILABLE_REASON === null ? describe : describe.skip;

describeWithTools(
  UNAVAILABLE_REASON === null
    ? "Firefox with the no-sync library"
    : `Firefox with the no-sync library (skipped: ${UNAVAILABLE_REASON})`,
  () => {
    let directory: string;
    let libraryPath: string;
    // Everything a run started, so teardown can stop it if the run failed.
    const launchedBrowsers: Browser[] = [];
    const processGroupFiles: string[] = [];

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "ou-nosync-"));
      libraryPath = compileLibrary(directory);
    }, COMPILE_TIMEOUT_IN_MS + 5_000);

    afterEach(
      async () => {
        jest.restoreAllMocks();

        for (const browser of launchedBrowsers.splice(0)) {
          await SyntheticBrowser.close({ browser, timeoutInMs: 5_000 });
        }

        for (const processGroupFile of processGroupFiles.splice(0)) {
          const processGroupId: number | null =
            readProcessGroup(processGroupFile);
          // A PID that is no longer our strace may already belong to someone else.
          if (processGroupId === null || !isStraceProcess(processGroupId)) {
            continue;
          }
          try {
            process.kill(-processGroupId, "SIGKILL");
          } catch {
            // It exited on its own in the meantime.
          }
          await waitForStraceExit(processGroupId, TEARDOWN_WAIT_IN_MS);
        }
      },
      2 * TEARDOWN_WAIT_IN_MS + 10_000,
    );

    afterAll(async () => {
      if (directory) {
        await fs.promises.rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 5,
        });
      }
    });

    async function runTracedFirefox(data: {
      label: string;
      imageProvidesLibrary: boolean;
    }): Promise<TracedFirefoxRun> {
      const runDirectory: string = path.join(directory, data.label);
      fs.mkdirSync(runDirectory);
      const executablePath: string = path.join(runDirectory, "firefox.sh");
      const traceFile: string = path.join(runDirectory, "strace.log");
      const preloadFile: string = path.join(runDirectory, "ld-preload");
      const processGroupFile: string = path.join(runDirectory, "process-group");
      processGroupFiles.push(processGroupFile);

      const traceFirefox: string = `${shellQuote(STRACE_PATH as string)} ${getStraceArguments(
        traceFile,
      )
        .map(shellQuote)
        .join(" ")}`;

      /*
       * Playwright spawns the executable detached, so the wrapper's PID --
       * which exec hands on to strace -- leads a process group holding every
       * Firefox process. Only the traced Firefox gets a preload, through
       * strace -E: the compiled library in place of the image's path, or
       * none at all.
       */
      fs.writeFileSync(
        executablePath,
        [
          "#!/bin/sh",
          `echo "$$" > ${shellQuote(processGroupFile)}`,
          `printf '%s' "\${LD_PRELOAD-}" > ${shellQuote(preloadFile)}`,
          `if [ "\${LD_PRELOAD-}" = ${shellQuote(FIREFOX_NO_SYNC_LIBRARY_PATH)} ]; then`,
          "  unset LD_PRELOAD",
          `  exec ${traceFirefox} -E ${shellQuote(`LD_PRELOAD=${libraryPath}`)} ${shellQuote(firefox.executablePath())} "$@"`,
          "fi",
          "unset LD_PRELOAD",
          `exec ${traceFirefox} ${shellQuote(firefox.executablePath())} "$@"`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );

      /*
       * Only the library's path is answered for; Playwright checks other
       * paths through the same fs module while it launches.
       */
      const existsSync: jest.SpyInstance = jest
        .spyOn(fs, "existsSync")
        .mockImplementation((file: fs.PathLike): boolean => {
          return file === FIREFOX_NO_SYNC_LIBRARY_PATH
            ? data.imageProvidesLibrary
            : REAL_EXISTS_SYNC(file);
        });

      let session: SyntheticBrowserSession;
      try {
        session = await SyntheticBrowser.start({
          config: createConfig(executablePath),
          onLaunched: (browser: Browser): void => {
            launchedBrowsers.push(browser);
          },
        });
      } finally {
        existsSync.mockRestore();
      }

      await session.page.route(
        PAGE_URL,
        async (route: Route): Promise<void> => {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><title>${PAGE_TITLE}</title><p>ok</p>`,
          });
        },
      );
      await session.page.goto(PAGE_URL, { waitUntil: "load" });
      const title: string = await session.page.title();

      /*
       * A full close, not SyntheticBrowser.close()'s bounded one: Firefox
       * syncs on close too, and strace writes the last of its trace only when
       * the whole tree has exited. A trace read any earlier could miss syncs
       * and pass.
       */
      await session.browser.close();
      const processGroupId: number | null = readProcessGroup(processGroupFile);
      if (processGroupId === null) {
        throw new Error(
          "The browser wrapper never ran, so nothing was traced.",
        );
      }
      if (!(await waitForStraceExit(processGroupId, STRACE_EXIT_WAIT_IN_MS))) {
        throw new Error(
          `strace was still running ${STRACE_EXIT_WAIT_IN_MS} ms after Firefox closed, so its trace may be incomplete.`,
        );
      }

      return {
        title,
        preloadRequestedByLaunch: fs.readFileSync(preloadFile, "utf8"),
        // Only a call's first line; "<... fsync resumed>" continues one.
        syncCalls: fs
          .readFileSync(traceFile, "utf8")
          .split("\n")
          .filter((line: string): boolean => {
            return SYNC_CALL_LINE.test(line);
          }),
      };
    }

    test("no sync system call from Firefox reaches the kernel", async () => {
      const control: TracedFirefoxRun = await runTracedFirefox({
        label: "control",
        imageProvidesLibrary: false,
      });

      expect(control.title).toBe(PAGE_TITLE);
      expect(control.preloadRequestedByLaunch).not.toBe(
        FIREFOX_NO_SYNC_LIBRARY_PATH,
      );
      // About 200 on Firefox 1522, from launch through close.
      expect(control.syncCalls.length).toBeGreaterThan(0);

      const withLibrary: TracedFirefoxRun = await runTracedFirefox({
        label: "with-library",
        imageProvidesLibrary: true,
      });

      expect(withLibrary.title).toBe(PAGE_TITLE);
      expect(withLibrary.preloadRequestedByLaunch).toBe(
        FIREFOX_NO_SYNC_LIBRARY_PATH,
      );
      expect({
        syncCallCount: withLibrary.syncCalls.length,
        firstSyncCalls: withLibrary.syncCalls.slice(0, 10),
      }).toStrictEqual({ syncCallCount: 0, firstSyncCalls: [] });
    }, 90_000);
  },
);

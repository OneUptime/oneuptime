import fs from "fs";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import path from "path";
import { chromium, firefox } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ProcessRunner, {
  ProcessRunResult,
  ProcessRunnerOptions,
  SyntheticProcessRunnerError,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";
import ProcessTreeMemory, {
  ResidentProcessMemory,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessTreeMemory";

jest.setTimeout(1_500_000);

const MEGABYTE: number = 1024 * 1024;
/*
 * The production default. The watchdog holds a check to it by proportional
 * set size (see ProcessTreeMemory), which an idle Chromium check keeps at a
 * few hundred MB across its ~10 processes, while a tenant filling
 * memory-backed storage crosses it after roughly twenty 64 MB chunks.
 */
const MAX_PROCESS_TREE_RSS_BYTES: number = 1536 * MEGABYTE;
const MAX_DISK_BYTES: number = 64 * MEGABYTE;
const OPFS_CHUNK_BYTES: number = 64 * MEGABYTE;

interface StorageContainmentCase {
  label: string;
  browserType: BrowserType;
  executablePath: string;
  boundary: string;
  chunkCount: number;
  expectedFailure: string;
}

describe("SyntheticMonitorWorker full process boundary", () => {
  let targetServer: Server;
  let targetUrl: string;

  beforeAll(async () => {
    targetServer = http.createServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        response.end("<!doctype html><title>Synthetic target</title>");
      },
    );
    await listen(targetServer);
    const address: ReturnType<Server["address"]> = targetServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test server address.");
    }
    targetUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await closeServer(targetServer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("forks the production worker and keeps the GHSA chains outside Node", async () => {
    const probeDirectory: string = path.resolve(__dirname, "../../../..");
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: path.join(
        probeDirectory,
        "Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorker.ts",
      ),
      concurrencyLimit: 1,
      maxPendingCount: 0,
      workingDirectory: probeDirectory,
    });
    const config: SyntheticMonitorWorkerConfig = {
      code: `
        const attempt = (operation) => {
          try { return operation(); }
          catch (error) { return "blocked:" + error.message; }
        };
        const descriptor = Object.getOwnPropertyDescriptor(
          http,
          "globalAgent"
        );
        console.log("worker boundary active");
        return { data: {
          processType: typeof process,
          requireType: typeof require,
          argsEscape: attempt(() =>
            args.constructor.constructor("return typeof process")()
          ),
          accessorEscape: attempt(() =>
            (descriptor.get || descriptor.value).constructor(
              "return typeof process"
            )()
          ),
          functionRealm: Function("return typeof process")(),
        } };
      `,
      browserType: BrowserType.Chromium,
      screenSizeType: ScreenSizeType.Desktop,
      executablePath: chromium.executablePath(),
      viewport: { width: 1_920, height: 1_080 },
      timeoutInMs: 30_000,
      chromiumSandboxEnabled: false,
      args: {},
    };

    const output: ProcessRunResult<SyntheticMonitorWorkerResult> =
      await runner.run<
        SyntheticMonitorWorkerConfig,
        SyntheticMonitorWorkerResult
      >({
        payload: config,
        timeoutInMs: 180_000,
        validateResult: isSyntheticMonitorWorkerResult,
      });

    expect(output.stderr).toBe("");
    expect(output.result.scriptError).toBeUndefined();
    expect(output.result.logMessages).toEqual(["worker boundary active"]);
    expect(output.result.returnValue).toEqual({
      data: {
        processType: "undefined",
        requireType: "undefined",
        argsEscape: expect.stringContaining("blocked:"),
        accessorEscape: expect.stringContaining("blocked:"),
        functionRealm: "undefined",
      },
    });
  });

  test("fails event listeners loudly and supports the compatibility surface", async () => {
    const probeDirectory: string = path.resolve(__dirname, "../../../..");
    const runner: ProcessRunner = new ProcessRunner({
      workerEntryPath: path.join(
        probeDirectory,
        "Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorker.ts",
      ),
      concurrencyLimit: 1,
      maxPendingCount: 0,
      workingDirectory: probeDirectory,
    });
    const config: SyntheticMonitorWorkerConfig = {
      code: `
        const attempt = async (operation) => {
          try { return "ok:" + String(await operation()); }
          catch (error) { return "error:" + error.message; }
        };
        const results = {};
        results.pageOn = await attempt(() => page.on("dialog", () => {}));
        results.contextOn = await attempt(() =>
          page.context().on("page", () => {})
        );
        results.frames = await attempt(() => page.frames());
        results.mainFrame = await attempt(() => page.mainFrame());
        results.request = await attempt(() =>
          page.request.get("https://example.com")
        );
        results.contextRequest = await attempt(() =>
          page.context().request.get("https://example.com")
        );
        results.requestCoercion = await attempt(() => String(page.request));
        results.setDefaultTimeout = await attempt(() =>
          page.setDefaultTimeout(45000)
        );
        results.waitForNavigation = await attempt(() =>
          page.waitForNavigation({ timeout: 250 })
        );
        await page.setContent('<input id="field" />');
        await page.locator("#field").type("hello");
        results.typedValue = await page.locator("#field").inputValue();
        return { data: results };
      `,
      browserType: BrowserType.Chromium,
      screenSizeType: ScreenSizeType.Desktop,
      executablePath: chromium.executablePath(),
      viewport: { width: 1_920, height: 1_080 },
      timeoutInMs: 60_000,
      chromiumSandboxEnabled: false,
      args: {},
    };

    const output: ProcessRunResult<SyntheticMonitorWorkerResult> =
      await runner.run<
        SyntheticMonitorWorkerConfig,
        SyntheticMonitorWorkerResult
      >({
        payload: config,
        timeoutInMs: 180_000,
        validateResult: isSyntheticMonitorWorkerResult,
      });

    expect(output.result.scriptError).toBeUndefined();
    const data: Record<string, string> = (
      output.result.returnValue as { data: Record<string, string> }
    ).data;
    expect(data["pageOn"]).toContain(
      "error:Playwright API 'page.on()' is not available",
    );
    expect(data["contextOn"]).toContain(
      "error:Playwright API 'browser-context.on()' is not available",
    );
    expect(data["frames"]).toContain(
      "error:Playwright API 'page.frames()' is not available",
    );
    expect(data["mainFrame"]).toContain(
      "error:Playwright API 'page.mainFrame()' is not available",
    );
    expect(data["request"]).toContain(
      "error:Playwright API 'page.request.get()' is not available",
    );
    expect(data["contextRequest"]).toContain(
      "error:Playwright API 'browser-context.request.get()' is not available",
    );
    expect(data["requestCoercion"]).toBe(
      "ok:[page.request is unavailable in synthetic monitors]",
    );
    expect(data["setDefaultTimeout"]).toBe("ok:undefined");
    expect(data["waitForNavigation"]).toContain("error:");
    expect(data["waitForNavigation"]).toMatch(/timeout/i);
    expect(data["waitForNavigation"]).not.toContain("not available");
    expect(data["typedValue"]).toBe("hello");
  });

  test("runs a Firefox check end to end through the forked worker", async () => {
    /*
     * Firefox starts, bootstraps its controller page and tears down along
     * paths of its own, and the rest of this suite only ever drives it into
     * a storage limit. A plain passing check is what proves the worker can
     * start Firefox, run a script against a real page, hand back the result
     * and exit.
     */
    const runner: ProcessRunner = createWorkerRunner();

    const output: ProcessRunResult<SyntheticMonitorWorkerResult> =
      await runner.run<
        SyntheticMonitorWorkerConfig,
        SyntheticMonitorWorkerResult
      >({
        payload: createWorkerConfig({
          browserType: BrowserType.Firefox,
          executablePath: firefox.executablePath(),
          code: `
              await page.goto(${JSON.stringify(targetUrl)});
              const title = await page.evaluate(() => document.title);
              console.log("firefox check ran");
              return { data: { browserType, title } };
            `,
          timeoutInMs: 60_000,
        }),
        timeoutInMs: 180_000,
        validateResult: isSyntheticMonitorWorkerResult,
      });

    expect(output.result.scriptError).toBeUndefined();
    expect(output.result.logMessages).toEqual(["firefox check ran"]);
    expect(output.result.returnValue).toEqual({
      data: { browserType: BrowserType.Firefox, title: "Synthetic target" },
    });
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  }, 300_000);

  test("reports a browser that cannot launch as a probe fault and keeps the Playwright error internal", async () => {
    /*
     * Nothing tenant-authored has run when the browser fails to launch, so
     * the failure is the probe's own: it must reach the supervisor marked
     * "probe-runtime" -- logged as ours and retried in a fresh worker --
     * with a message fit to show the tenant. Playwright's error names this
     * probe's paths and internals, so it travels only in internalDetail,
     * for the probe's logs.
     */
    const runner: ProcessRunner = createWorkerRunner();

    const outcome: unknown = await runner
      .run<SyntheticMonitorWorkerConfig, SyntheticMonitorWorkerResult>({
        payload: createWorkerConfig({
          browserType: BrowserType.Chromium,
          executablePath: path.join(
            path.sep,
            "nonexistent",
            "synthetic-browser",
            "chrome",
          ),
          code: "return { data: true };",
          timeoutInMs: 30_000,
        }),
        timeoutInMs: 180_000,
        validateResult: isSyntheticMonitorWorkerResult,
      })
      .then(
        (output: ProcessRunResult<SyntheticMonitorWorkerResult>): unknown => {
          return output;
        },
        (error: unknown): unknown => {
          return error;
        },
      );

    expect(outcome).toBeInstanceOf(SyntheticProcessRunnerError);
    const message: string = outcome instanceof Error ? outcome.message : "";
    expect(message).toContain("could not start on this probe");
    expect(message).toContain("did not start");
    expect(message).not.toContain("browserType.launch");
    expect(outcome).toMatchObject({
      kind: "probe-runtime",
      internalDetail: expect.stringContaining("browserType.launch"),
    });
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  }, 300_000);

  test("keeps Chromium's temporary profile inside the watched run directory, with no browser-profile directory", async () => {
    /*
     * Every check used to launch Chromium with launchPersistentContext on a
     * brand-new <run directory>/browser-profile. Chromium does not hand the
     * runtime's intercepted controller navigation to Playwright until that
     * profile's cookie database has been created and synced, so wherever
     * storage was slow every bootstrap attempt stalled and checks failed
     * with "the browser runtime did not finish starting up". The worker now
     * launches the browser and opens an ephemeral context. Playwright still
     * gives the browser a temporary profile under os.tmpdir(), which must be
     * the run directory, or the disk watchdog and the cleanup would miss
     * what the browser writes there.
     *
     * The run directory is listed over and over while the check runs,
     * because the browser deletes its temporary profile when it closes.
     */
    const mkdtempSpy: jest.SpyInstance = jest.spyOn(fs.promises, "mkdtemp");
    const runner: ProcessRunner = createWorkerRunner();
    let isSettled: boolean = false;

    const check: Promise<ProcessRunResult<SyntheticMonitorWorkerResult>> =
      runner.run<SyntheticMonitorWorkerConfig, SyntheticMonitorWorkerResult>({
        payload: createWorkerConfig({
          browserType: BrowserType.Chromium,
          executablePath: chromium.executablePath(),
          code: `
                await new Promise((resolve) => setTimeout(resolve, 2000));
                return { data: true };
              `,
          timeoutInMs: 60_000,
        }),
        timeoutInMs: 180_000,
        validateResult: isSyntheticMonitorWorkerResult,
      });
    const settled: Promise<void> = check.then(
      (): void => {
        isSettled = true;
      },
      (): void => {
        isSettled = true;
      },
    );

    while (mkdtempSpy.mock.results.length === 0 && !isSettled) {
      await delay(10);
    }
    expect(mkdtempSpy).toHaveBeenCalledTimes(1);
    const runDirectory: string = await (mkdtempSpy.mock.results[0]
      ?.value as Promise<string>);

    const observedEntries: Set<string> = new Set<string>();
    while (!isSettled) {
      for (const entry of await listDirectory(runDirectory)) {
        observedEntries.add(entry);
      }
      await delay(50);
    }
    await settled;
    const output: ProcessRunResult<SyntheticMonitorWorkerResult> = await check;

    expect(output.result.scriptError).toBeUndefined();
    expect(output.result.returnValue).toEqual({ data: true });
    const entries: string[] = [...observedEntries].sort();
    expect(entries).not.toContain("browser-profile");
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^playwright_chromiumdev_profile-/),
      ]),
    );
    expect(fs.existsSync(runDirectory)).toBe(false);
    expect(runner.activeCount).toBe(0);
    expect(runner.pendingCount).toBe(0);
  }, 300_000);

  /*
   * A tenant can fill origin-private storage (OPFS) from the ambient worker
   * realm and from a page it opened, and on either engine those bytes must
   * land where a watchdog is counting. Where they land is the engine's call:
   * the worker gives every check an ephemeral browser context, in which
   * Chromium keeps web storage in memory while Firefox writes it to the
   * browser's temporary profile inside the run directory. So Chromium's
   * writes are held to the process-tree memory limit and Firefox's to the run
   * directory's disk limit.
   *
   * Both limits are armed for both engines, so the watchdog that fires is the
   * evidence of where the storage went. Chromium writes 2 GB -- more than its
   * whole memory limit before the browser itself is counted -- past a 64 MB disk
   * limit that stays quiet: the bytes are resident in the worker's process
   * tree, not files in the run directory. Each attack holds its storage for a
   * while after writing and then returns, so an unenforced limit fails the
   * test within seconds instead of hanging it, and a working watchdog never
   * races the script's return.
   */
  test.each<StorageContainmentCase>([
    {
      label: "Chromium",
      browserType: BrowserType.Chromium,
      executablePath: chromium.executablePath(),
      boundary: "process-tree memory limit",
      chunkCount: 32,
      expectedFailure: `Synthetic worker process tree exceeded memory limit of ${MAX_PROCESS_TREE_RSS_BYTES} bytes`,
    },
    {
      label: "Firefox",
      browserType: BrowserType.Firefox,
      executablePath: firefox.executablePath(),
      boundary: "run directory disk limit",
      chunkCount: 2,
      expectedFailure: `Synthetic worker run directory exceeded disk limit of ${MAX_DISK_BYTES} bytes`,
    },
  ])(
    "$label holds tenant OPFS writes to the $boundary and recovers cleanly",
    async ({
      browserType,
      executablePath,
      chunkCount,
      expectedFailure,
    }: StorageContainmentCase) => {
      const runDirectories: string[] = [];
      const mkdtempSpy: jest.SpyInstance = jest.spyOn(fs.promises, "mkdtemp");
      const rmSpy: jest.SpyInstance = jest.spyOn(fs.promises, "rm");
      const runner: ProcessRunner = createWorkerRunner({
        maxProcessTreeRssBytes: MAX_PROCESS_TREE_RSS_BYTES,
        rssPollIntervalInMs: 100,
        maxDiskBytes: MAX_DISK_BYTES,
        diskPollIntervalInMs: 50,
      });
      const baseConfig: SyntheticMonitorWorkerConfig = createWorkerConfig({
        browserType,
        executablePath,
        code: "return { data: true };",
        timeoutInMs: 120_000,
      });
      const writtenBytes: number = chunkCount * OPFS_CHUNK_BYTES;
      const holdThenReturn: string = `
        await new Promise((resolve) => setTimeout(resolve, 30000));
        return { data: "wrote ${writtenBytes} bytes of OPFS within the limits" };
      `;

      const attacks: Array<{ label: string; code: string }> = [
        {
          label: "ambient Worker OPFS",
          code: `
            const root = await navigator.storage.getDirectory();
            const chunk = new Uint8Array(${OPFS_CHUNK_BYTES}).fill(0x5a);
            for (let index = 0; index < ${chunkCount}; index++) {
              const file = await root.getFileHandle(
                "quota-fill-" + index + ".bin",
                { create: true }
              );
              const access = await file.createSyncAccessHandle();
              access.write(chunk, { at: 0 });
              access.flush();
              access.close();
            }
            ${holdThenReturn}
          `,
        },
        {
          label: "page.evaluate OPFS",
          code: `
            await page.goto(${JSON.stringify(targetUrl)});
            await page.evaluate(async () => {
              const root = await navigator.storage.getDirectory();
              const chunk = new Uint8Array(${OPFS_CHUNK_BYTES}).fill(0x5a);
              for (let index = 0; index < ${chunkCount}; index++) {
                const file = await root.getFileHandle(
                  "quota-fill-" + index + ".bin",
                  { create: true }
                );
                const writable = await file.createWritable();
                await writable.write(chunk);
                await writable.close();
              }
            });
            ${holdThenReturn}
          `,
        },
      ];

      for (const attack of attacks) {
        const runIndex: number = runDirectories.length;
        await expect(
          runner.run<
            SyntheticMonitorWorkerConfig,
            SyntheticMonitorWorkerResult
          >({
            payload: { ...baseConfig, code: attack.code },
            timeoutInMs: 300_000,
            validateResult: isSyntheticMonitorWorkerResult,
          }),
        ).rejects.toThrow(expectedFailure);

        expect(mkdtempSpy).toHaveBeenCalledTimes(runIndex + 1);
        runDirectories.push(
          await (mkdtempSpy.mock.results[runIndex]?.value as Promise<string>),
        );
        expect(rmSpy).toHaveBeenCalledWith(runDirectories[runIndex], {
          recursive: true,
          force: true,
        });
        expect(fs.existsSync(runDirectories[runIndex] as string)).toBe(false);
        expect(runner.activeCount).toBe(0);
        expect(runner.pendingCount).toBe(0);
      }

      const healthy: ProcessRunResult<SyntheticMonitorWorkerResult> =
        await runner.run<
          SyntheticMonitorWorkerConfig,
          SyntheticMonitorWorkerResult
        >({
          payload: {
            ...baseConfig,
            code: `
            await page.goto(${JSON.stringify(targetUrl)});
            const pageOpfsAvailable = await page.evaluate(() =>
              typeof navigator.storage?.getDirectory === "function"
            );
            return { data: {
              browserType,
              ambientOpfsAvailable:
                typeof navigator.storage?.getDirectory === "function",
              pageOpfsAvailable,
            } };
          `,
            timeoutInMs: 60_000,
          },
          timeoutInMs: 300_000,
          validateResult: isSyntheticMonitorWorkerResult,
        });

      expect(healthy.result.scriptError).toBeUndefined();
      expect(healthy.result.returnValue).toEqual({
        data: {
          browserType,
          ambientOpfsAvailable: true,
          pageOpfsAvailable: true,
        },
      });
      expect(mkdtempSpy).toHaveBeenCalledTimes(3);
      runDirectories.push(
        await (mkdtempSpy.mock.results[2]?.value as Promise<string>),
      );
      expect(new Set(runDirectories).size).toBe(3);
      expect(rmSpy).toHaveBeenCalledWith(runDirectories[2], {
        recursive: true,
        force: true,
      });
      expect(fs.existsSync(runDirectories[2] as string)).toBe(false);
      expect(runner.activeCount).toBe(0);
      expect(runner.pendingCount).toBe(0);
    },
    1_200_000,
  );

  /*
   * The regression test for synthetic checks failing the memory limit on
   * memory they never held ("Synthetic worker process tree exceeded RSS limit
   * of 1610612736 bytes (observed 1612525568 bytes)"), against a real Desktop
   * Chromium check.
   *
   * Every Chromium process maps the same browser binary, so summing their
   * VmRSS counts it once per process. The check below opens two pages at
   * 1920x1080 with a cross-site iframe each and screenshots them, which gives
   * it about a dozen processes, like the customer checks that failed.
   *
   * The limit a check just fits under depends on the machine, so the test
   * measures first: it runs the check with no effective limit and samples its
   * process tree, and requires the summed VmRSS to far exceed the tree's PSS
   * -- the over-count itself. Then the same check runs with the limit between
   * the two, where the old watchdog stopped it, and must pass, with the
   * watchdog having measured it by PSS. Last, it runs with the limit below its
   * PSS and must be stopped, so the PSS measurement still holds the line.
   *
   * The test reads the tree's smaps_rollup itself, which it may only do when
   * the check runs as the test's own user: run as root, the runner puts the
   * check under a sandbox uid whose PSS only the probe image's helper reads.
   */
  (process.platform === "linux" &&
    !(typeof process.getuid === "function" && process.getuid() === 0)
    ? test
    : test.skip)(
    "holds a Desktop Chromium check to its PSS, not to its processes' summed RSS",
    async () => {
      const address: ReturnType<Server["address"]> = targetServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a TCP test server address.");
      }
      const crossSiteUrl: string = `http://localhost:${address.port}/`;
      const code: string = `
        const addCrossSiteFrame = async (target) => {
          await target.evaluate((frameUrl) => {
            const frame = document.createElement("iframe");
            frame.src = frameUrl;
            frame.width = "1200";
            frame.height = "800";
            document.body.appendChild(frame);
            // Bounded, so a slow runner shortens the check rather than hangs it.
            return new Promise((resolve) => {
              frame.onload = resolve;
              setTimeout(resolve, 15000);
            });
          }, ${JSON.stringify(crossSiteUrl)});
        };
        await page.goto(${JSON.stringify(targetUrl)});
        await addCrossSiteFrame(page);
        const screenshots = { first: await page.screenshot() };
        const second = await page.context().newPage();
        await second.goto(${JSON.stringify(crossSiteUrl)});
        await addCrossSiteFrame(second);
        screenshots.second = await second.screenshot();
        screenshots.again = await page.screenshot();
        await new Promise((resolve) => setTimeout(resolve, 6000));
        return { data: "checked", screenshots };
      `;
      const config: SyntheticMonitorWorkerConfig = {
        ...createWorkerConfig({
          browserType: BrowserType.Chromium,
          executablePath: chromium.executablePath(),
          code,
          timeoutInMs: 120_000,
        }),
        viewport: { width: 1_920, height: 1_080 },
      };
      const run: (
        limits: Parameters<typeof createWorkerRunner>[0],
      ) => Promise<ProcessRunResult<SyntheticMonitorWorkerResult>> = (
        limits: Parameters<typeof createWorkerRunner>[0],
      ): Promise<ProcessRunResult<SyntheticMonitorWorkerResult>> => {
        return createWorkerRunner(limits).run<
          SyntheticMonitorWorkerConfig,
          SyntheticMonitorWorkerResult
        >({
          payload: config,
          timeoutInMs: 180_000,
          validateResult: isSyntheticMonitorWorkerResult,
        });
      };

      // 1. Measure the check with no effective limit.
      const peaks: { residentBytes: number; proportionalBytes: number } = {
        residentBytes: 0,
        proportionalBytes: 0,
      };
      let sampling: boolean = true;
      const sampler: Promise<void> = (async (): Promise<void> => {
        while (sampling) {
          const tree: ResidentProcessMemory[] = readWorkerProcessTree();
          if (tree.length > 0) {
            peaks.residentBytes = Math.max(
              peaks.residentBytes,
              tree.reduce((total: number, entry: ResidentProcessMemory) => {
                return total + (entry.residentBytes ?? 0);
              }, 0),
            );
            peaks.proportionalBytes = Math.max(
              peaks.proportionalBytes,
              await ProcessTreeMemory.measureProportionalBytes({
                processes: tree,
                identity: null,
              }),
            );
          }
          await delay(100);
        }
      })();
      const measured: ProcessRunResult<SyntheticMonitorWorkerResult> =
        await run({
          maxProcessTreeRssBytes: 64 * 1024 * MEGABYTE,
        }).finally(() => {
          sampling = false;
        });
      await sampler;

      expect(measured.result.scriptError).toBeUndefined();
      expect(peaks.proportionalBytes).toBeGreaterThan(0);
      // The over-count this fixes: shared pages summed once per process.
      expect(peaks.residentBytes).toBeGreaterThan(
        peaks.proportionalBytes * 1.6,
      );

      // 2. A limit it is over by summed RSS and well under by PSS.
      const fittingLimitBytes: number = Math.ceil(
        peaks.proportionalBytes * 1.3,
      );
      expect(fittingLimitBytes).toBeLessThan(peaks.residentBytes);
      const measureProportionalBytes: typeof ProcessTreeMemory.measureProportionalBytes =
        ProcessTreeMemory.measureProportionalBytes.bind(ProcessTreeMemory);
      const watchdogReadings: number[] = [];
      jest
        .spyOn(ProcessTreeMemory, "measureProportionalBytes")
        .mockImplementation(
          async (
            data: Parameters<
              typeof ProcessTreeMemory.measureProportionalBytes
            >[0],
          ): Promise<number> => {
            const reading: number = await measureProportionalBytes(data);
            watchdogReadings.push(reading);
            return reading;
          },
        );

      const fitted: ProcessRunResult<SyntheticMonitorWorkerResult> = await run({
        maxProcessTreeRssBytes: fittingLimitBytes,
        rssPollIntervalInMs: 100,
      });

      expect(fitted.result.scriptError).toBeUndefined();
      expect(fitted.result.returnValue).toEqual(
        expect.objectContaining({ data: "checked" }),
      );
      expect(watchdogReadings.length).toBeGreaterThan(0);
      expect(Math.max(...watchdogReadings)).toBeLessThanOrEqual(
        fittingLimitBytes,
      );

      // 3. A limit below what the check holds still stops it.
      const tightLimitBytes: number = Math.floor(peaks.proportionalBytes * 0.6);
      await expect(
        run({
          maxProcessTreeRssBytes: tightLimitBytes,
          rssPollIntervalInMs: 100,
        }),
      ).rejects.toThrow(
        `Synthetic worker process tree exceeded memory limit of ${tightLimitBytes} bytes`,
      );
    },
    600_000,
  );
});

/*
 * The runner's worker -- the one child of this process running
 * SyntheticMonitorWorker -- and every process under it, each with its VmRSS.
 */
function readWorkerProcessTree(): ResidentProcessMemory[] {
  const childrenOf: (pid: number) => number[] = (pid: number): number[] => {
    const children: number[] = [];
    try {
      for (const taskId of fs.readdirSync(`/proc/${pid}/task`)) {
        const contents: string = fs.readFileSync(
          `/proc/${pid}/task/${taskId}/children`,
          "utf8",
        );
        for (const value of contents.trim().split(/\s+/)) {
          if (value) {
            children.push(Number(value));
          }
        }
      }
    } catch {
      // Exited while being read.
    }
    return children;
  };
  const isWorker: (pid: number) => boolean = (pid: number): boolean => {
    try {
      return fs
        .readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .includes("SyntheticMonitorWorker");
    } catch {
      return false;
    }
  };

  const tree: ResidentProcessMemory[] = [];
  const pending: number[] = childrenOf(process.pid).filter(isWorker);
  while (pending.length > 0) {
    const pid: number = pending.shift() as number;
    try {
      tree.push({
        pid,
        residentBytes: ProcessTreeMemory.parseStatusResidentBytes(
          fs.readFileSync(`/proc/${pid}/status`, "utf8"),
        ),
      });
    } catch {
      continue;
    }
    pending.push(...childrenOf(pid));
  }
  return tree;
}

function createWorkerRunner(
  limits: Pick<
    ProcessRunnerOptions,
    | "maxProcessTreeRssBytes"
    | "rssPollIntervalInMs"
    | "maxDiskBytes"
    | "diskPollIntervalInMs"
  > = {},
): ProcessRunner {
  const probeDirectory: string = path.resolve(__dirname, "../../../..");
  return new ProcessRunner({
    workerEntryPath: path.join(
      probeDirectory,
      "Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorker.ts",
    ),
    concurrencyLimit: 1,
    maxPendingCount: 0,
    workingDirectory: probeDirectory,
    ...limits,
  });
}

function createWorkerConfig(data: {
  browserType: BrowserType;
  executablePath: string;
  code: string;
  timeoutInMs: number;
}): SyntheticMonitorWorkerConfig {
  return {
    code: data.code,
    browserType: data.browserType,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath: data.executablePath,
    viewport: { width: 800, height: 600 },
    timeoutInMs: data.timeoutInMs,
    chromiumSandboxEnabled: false,
    args: {},
  };
}

async function listDirectory(directory: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(directory);
  } catch {
    // The runner removes the directory as soon as the check settles.
    return [];
  }
}

async function delay(timeInMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, timeInMs);
  });
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    },
  );
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.close((): void => {
      resolve();
    });
  });
}

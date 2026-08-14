import fs from "fs";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import path from "path";
import { chromium, firefox } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ProcessRunner, {
  ProcessRunResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";

jest.setTimeout(1_500_000);

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
        response.end("<!doctype html><title>OPFS target</title>");
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

  test.each([
    {
      label: "Chromium",
      browserType: BrowserType.Chromium,
      executablePath: chromium.executablePath(),
    },
    {
      label: "Firefox",
      browserType: BrowserType.Firefox,
      executablePath: firefox.executablePath(),
    },
  ])(
    "$label stores OPFS inside the watched run directory and recovers cleanly",
    async ({
      browserType,
      executablePath,
    }: {
      label: string;
      browserType: BrowserType;
      executablePath: string;
    }) => {
      const probeDirectory: string = path.resolve(__dirname, "../../../..");
      const runDirectories: string[] = [];
      const mkdtempSpy: jest.SpyInstance = jest.spyOn(fs.promises, "mkdtemp");
      const rmSpy: jest.SpyInstance = jest.spyOn(fs.promises, "rm");
      const runner: ProcessRunner = new ProcessRunner({
        workerEntryPath: path.join(
          probeDirectory,
          "Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorker.ts",
        ),
        concurrencyLimit: 1,
        maxPendingCount: 0,
        workingDirectory: probeDirectory,
        maxDiskBytes: 64 * 1024 * 1024,
        diskPollIntervalInMs: 50,
      });
      const baseConfig: SyntheticMonitorWorkerConfig = {
        code: "return { data: true };",
        browserType,
        screenSizeType: ScreenSizeType.Desktop,
        executablePath,
        viewport: { width: 800, height: 600 },
        timeoutInMs: 480_000,
        chromiumSandboxEnabled: false,
        args: {},
      };

      const attacks: Array<{ label: string; code: string }> = [
        {
          label: "ambient Worker OPFS",
          code: `
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle("quota-fill.bin", {
              create: true,
            });
            const access = await file.createSyncAccessHandle();
            const chunk = new Uint8Array(80 * 1024 * 1024);
            access.write(chunk, { at: 0 });
            access.flush();
            await new Promise(() => {});
          `,
        },
        {
          label: "page.evaluate OPFS",
          code: `
            await page.goto(${JSON.stringify(targetUrl)});
            await page.evaluate(async () => {
              const root = await navigator.storage.getDirectory();
              const file = await root.getFileHandle("quota-fill.bin", {
                create: true,
              });
              const chunk = new Uint8Array(80 * 1024 * 1024);
              const writable = await file.createWritable({
                keepExistingData: true,
              });
              await writable.write(chunk);
              await writable.close();
              await new Promise(() => {});
            });
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
            timeoutInMs: 600_000,
            validateResult: isSyntheticMonitorWorkerResult,
          }),
        ).rejects.toThrow("exceeded disk limit");

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
  );
});

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

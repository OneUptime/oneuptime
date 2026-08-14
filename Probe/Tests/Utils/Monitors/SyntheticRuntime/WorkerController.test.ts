import http, { IncomingMessage, Server, ServerResponse } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import {
  Browser,
  BrowserContext,
  Page,
  Route,
  chromium,
  firefox,
} from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

jest.setTimeout(120_000);

interface RunOptions {
  code: string;
  html?: string | undefined;
  args?: Record<string, unknown> | undefined;
  timeoutInMs?: number | undefined;
}

const TARGET_URL: string = "https://synthetic-target.invalid/";

describe("SyntheticRuntime WorkerController", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function run(options: RunOptions): Promise<SandboxExecutionResult> {
    const browserContext: BrowserContext = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    await browserContext.route(`${TARGET_URL}**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body:
          options.html ||
          "<!doctype html><title>Synthetic target</title><main>ready</main>",
      });
    });
    const page: Page = await browserContext.newPage();

    try {
      return await WorkerController.execute({
        browserContext,
        page,
        code: options.code,
        browserType: "Chromium",
        screenSizeType: "Desktop",
        args: options.args || {},
        timeoutInMs: options.timeoutInMs || 10_000,
      });
    } finally {
      await browserContext.close();
    }
  }

  test("runs the documented page, locator, screenshot, log, metric, and return flow", async () => {
    const result: SandboxExecutionResult = await run({
      html: `<!doctype html>
        <input id="name">
        <button id="submit">Submit</button>
        <output id="result"></output>
        <script>
          document.querySelector("#submit").addEventListener("click", () => {
            document.querySelector("#result").textContent =
              document.querySelector("#name").value;
          });
        </script>`,
      code: `
        await page.goto("${TARGET_URL}");
        await page.locator("#name").fill("Ada");
        await page.locator("#submit").click();
        await page.waitForSelector("#result");
        screenshots["side-channel"] = await page.screenshot();
        const text = await page.locator("#result").textContent();
        console.log("result", { text });
        oneuptime.captureMetric("checkout_latency", 12.5, {
          route: "checkout",
          cached: false,
        });
        return {
          data: { text, browserType, screenSizeType },
          screenshots: { returned: await page.screenshot() },
        };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toMatchObject({
      data: {
        text: "Ada",
        browserType: "Chromium",
        screenSizeType: "Desktop",
      },
    });
    expect(result.logMessages).toEqual(['result {"text":"Ada"}']);
    expect(result.capturedMetrics).toEqual([
      {
        name: "checkout_latency",
        value: 12.5,
        attributes: { route: "checkout", cached: "false" },
      },
    ]);
    expect(Object.keys(result.screenshots).sort()).toEqual([
      "returned",
      "side-channel",
    ]);
    expect(result.screenshots["returned"]?.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  test("supports legacy scripts that declare and return their own screenshots object", async () => {
    const result: SandboxExecutionResult = await run({
      code: `
        await page.goto("${TARGET_URL}");
        const screenshots = {};
        screenshots["legacy-returned"] = await page.screenshot();
        return {
          data: { compatible: true },
          screenshots,
        };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toMatchObject({
      data: { compatible: true },
      screenshots: {
        "legacy-returned": {
          __oneuptimeScreenshot: true,
        },
      },
    });
    expect(result.screenshots["legacy-returned"]?.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  test("keeps the reported constructor and accessor chains in the browser realm", async () => {
    process.env["ONEUPTIME_SYNTHETIC_HOST_CANARY"] = cryptoRandomCanary();

    try {
      const result: SandboxExecutionResult = await run({
        args: { nested: { value: 1 } },
        code: `
          const attempt = (operation) => {
            try { return operation(); }
            catch (error) { return "blocked:" + error.message; }
          };
          const descriptor = Object.getOwnPropertyDescriptor(http, "globalAgent");
          const pageDescriptor = Object.getOwnPropertyDescriptor(page, "url");
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
            pageEscape: attempt(() =>
              pageDescriptor.value.constructor("return typeof process")()
            ),
            functionRealm: Function("return typeof process")(),
            evalRealm: eval("typeof process"),
            hostCanary: Function(
              "return globalThis.ONEUPTIME_SYNTHETIC_HOST_CANARY"
            )(),
            pagePrototype: Object.getPrototypeOf(page),
            pageConstructor: page.constructor,
          }};
        `,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          processType: "undefined",
          requireType: "undefined",
          argsEscape: expect.stringContaining("blocked:"),
          accessorEscape: expect.stringContaining("blocked:"),
          pageEscape: "undefined",
          functionRealm: "undefined",
          evalRealm: "undefined",
          hostCanary: undefined,
          pagePrototype: null,
          pageConstructor: undefined,
        },
      });
    } finally {
      delete process.env["ONEUPTIME_SYNTHETIC_HOST_CANARY"];
    }
  });

  test("removes ambient worker networking and private bridge globals", async () => {
    const result: SandboxExecutionResult = await run({
      code: `
        return { data: {
          fetch: typeof fetch,
          xhr: typeof XMLHttpRequest,
          websocket: typeof WebSocket,
          eventSource: typeof EventSource,
          worker: typeof Worker,
          sharedWorker: typeof SharedWorker,
          importScripts: typeof importScripts,
          privateGlobals: [
            "_pageRef", "_axiosRef", "_cryptoRef", "_sleepRef",
            "_log", "_captureMetric"
          ].filter((name) => name in globalThis),
          synchronousBridgeMethods: Object.getOwnPropertyNames(globalThis)
            .filter((name) => /deref|applySync|getSync/.test(name)),
        }};
      `,
    });

    expect(result.returnValue).toEqual({
      data: {
        fetch: "undefined",
        xhr: "undefined",
        websocket: "undefined",
        eventSource: "undefined",
        worker: "undefined",
        sharedWorker: "undefined",
        importScripts: "undefined",
        privateGlobals: [],
        synchronousBridgeMethods: [],
      },
    });
  });

  test("blocks browser launch, CDP, private fields, routes, and filesystem paths", async () => {
    const canaryPath: string = path.join(
      os.tmpdir(),
      `oneuptime-synthetic-canary-${cryptoRandomCanary()}`,
    );

    const result: SandboxExecutionResult = await run({
      code: `
        const attempt = async (operation) => {
          try { await operation(); return "unexpected-success"; }
          catch (error) { return error.message; }
        };
        return { data: {
          browser: page.context().browser,
          browserType: page.browserType,
          channel: page._channel,
          connection: page._connection,
          launch: page.launch,
          connectOverCDP: page.connectOverCDP,
          route: page.route,
          screenshotPath: await attempt(() =>
            page.screenshot({ path: ${JSON.stringify(canaryPath)} })
          ),
          fileInputPath: await attempt(() =>
            page.setInputFiles("input", ${JSON.stringify(canaryPath)})
          ),
          fileNavigation: await attempt(() => page.goto("file:///etc/passwd")),
        }};
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toMatchObject({
      data: {
        browser: undefined,
        browserType: undefined,
        channel: undefined,
        connection: undefined,
        launch: undefined,
        connectOverCDP: undefined,
        route: undefined,
        screenshotPath: expect.stringContaining("cannot use host paths"),
        fileInputPath: expect.stringContaining("cannot read host file paths"),
        fileNavigation: expect.stringContaining("requires an HTTP(S) URL"),
      },
    });
    expect(fs.existsSync(canaryPath)).toBe(false);
  });

  test("rejects surplus-argument attempts to bypass host path validation", async () => {
    const canary: string = `host-file-${cryptoRandomCanary()}`;
    const canaryPath: string = path.join(
      os.tmpdir(),
      `oneuptime-synthetic-readable-${cryptoRandomCanary()}.css`,
    );
    fs.writeFileSync(canaryPath, `body::before { content: "${canary}"; }`);

    try {
      const result: SandboxExecutionResult = await run({
        code: `
          const attempt = async (path, useSurplusArgument) => {
            try {
              const style = useSurplusArgument
                ? await page.addStyleTag({ path }, {})
                : await page.addStyleTag({ path });
              return await style.textContent();
            } catch (error) {
              return error.message;
            }
          };
          return { data: {
            surplus: await attempt(${JSON.stringify(canaryPath)}, true),
            existingBuffer: await attempt(
              Buffer.from(${JSON.stringify(canaryPath)}),
              false
            ),
            missingBuffer: await attempt(
              Buffer.from(${JSON.stringify(`${canaryPath}-missing`)}),
              false
            ),
          } };
        `,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatchObject({
        data: {
          surplus: expect.stringMatching(/too many arguments|host paths/),
          existingBuffer: expect.stringContaining("cannot use host paths"),
          missingBuffer: expect.stringContaining("cannot use host paths"),
        },
      });
      const returnedData: Record<string, unknown> = (
        result.returnValue as { data: Record<string, unknown> }
      ).data;
      expect(returnedData["existingBuffer"]).toBe(
        returnedData["missingBuffer"],
      );
      expect(JSON.stringify(result.returnValue)).not.toContain(canary);
    } finally {
      fs.unlinkSync(canaryPath);
    }
  });

  test("reconstructs target-page evaluation functions without compiling them in Node", async () => {
    const result: SandboxExecutionResult = await run({
      code: `
        await page.goto("${TARGET_URL}");
        const pageResult = await page.evaluate(
          (input) => ({
            doubled: input * 2,
            processType: typeof process,
            requireType: typeof require,
          }),
          21
        );
        await page.setContent("<ul><li>A</li><li>B</li></ul>");
        const regularExpressionCount = await page.getByText(/^[AB]$/).count();
        const texts = await page.locator("li").evaluateAll(
          (elements, suffix) => elements.map(
            (element) => element.textContent + suffix
          ),
          "!"
        );
        const handle = await page.evaluateHandle(() => ({ alpha: 42 }));
        const properties = await handle.getProperties();
        const alpha = await properties.get("alpha").jsonValue();
        const evaluatedBigInt = await page.evaluate(
          (value) => value + 1n,
          41n
        );
        return { data: {
          pageResult,
          regularExpressionCount,
          texts,
          mapType: Object.prototype.toString.call(properties),
          alpha,
          bigintType: typeof evaluatedBigInt,
          bigintValue: evaluatedBigInt.toString(),
        } };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      data: {
        pageResult: {
          doubled: 42,
          processType: "undefined",
          requireType: "undefined",
        },
        regularExpressionCount: 2,
        texts: ["A!", "B!"],
        mapType: "[object Map]",
        alpha: 42,
        bigintType: "bigint",
        bigintValue: "42",
      },
    });
  });

  test("supports context pages, popup capabilities, keyboard, mouse, and response snapshots", async () => {
    const result: SandboxExecutionResult = await run({
      html: "<!doctype html><button id=popup-button>Open</button><script>document.querySelector('#popup-button').onclick=()=>window.open('https://synthetic-target.invalid/popup')</script>",
      code: `
        const response = await page.goto("${TARGET_URL}");
        const popupPromise = page.waitForEvent("popup");
        await page.locator("#popup-button").click();
        const popup = await popupPromise;
        await popup.waitForLoadState();
        await page.keyboard.press("Tab");
        await page.mouse.move(10, 20);
        const secondPage = await page.context().newPage();
        const contextPages = page.context().pages();
        const controllerBindings = await page.evaluate(() =>
          Object.getOwnPropertyNames(globalThis).filter((name) =>
            name.startsWith("__oneuptimeRpc_") ||
            name.startsWith("__oneuptimeWorker_")
          )
        );
        return { data: {
          status: response.status(),
          ok: response.ok(),
          requestMethod: response.request().method(),
          popupUrl: popup.url(),
          contextPageCount: contextPages.length,
          controllerPageVisible: contextPages.some((candidate) =>
            candidate.url().includes("synthetic-runtime.oneuptime.invalid")
          ),
          controllerBindings,
          secondPageUrl: secondPage.url(),
          browser: page.context().browser,
        }};
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toMatchObject({
      data: {
        status: 200,
        ok: true,
        requestMethod: "GET",
        popupUrl: `${TARGET_URL}popup`,
        contextPageCount: 3,
        controllerPageVisible: false,
        controllerBindings: [],
        secondPageUrl: "about:blank",
        browser: undefined,
      },
    });
  });

  test.each(["Chromium", "Firefox"] as const)(
    "refreshes mutable page state and exposes only live target pages in %s",
    async (browserType: "Chromium" | "Firefox") => {
      const ownsBrowser: boolean = browserType === "Firefox";
      const stateBrowser: Browser = ownsBrowser
        ? await firefox.launch({ headless: true })
        : browser;
      const browserContext: BrowserContext = await stateBrowser.newContext({
        viewport: { width: 800, height: 600 },
      });
      await browserContext.route(`${TARGET_URL}**`, async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><title>Mutable page state</title>",
        });
      });
      const page: Page = await browserContext.newPage();

      try {
        const result: SandboxExecutionResult = await WorkerController.execute({
          browserContext,
          page,
          code: `
            const context = page.context();
            const initialPages = context.pages();
            const initialPageIdentity = initialPages[0] === page;

            await page.goto("${TARGET_URL}state/root");
            const rootUrlAfterNavigation = page.url();
            await page.setViewportSize({ width: 1024, height: 700 });
            const rootViewportAfterChange = page.viewportSize();

            const secondPage = await context.newPage();
            await secondPage.goto("${TARGET_URL}state/second");
            const secondUrlAfterNavigation = secondPage.url();
            const pagesBeforeClose = context.pages();

            await secondPage.close();
            const secondClosedAfterClose = secondPage.isClosed();
            const pagesAfterSecondClose = context.pages();

            await page.close();
            const rootClosedAfterClose = page.isClosed();
            const pagesAfterRootClose = context.pages();

            const controllerPageVisible = [
              ...initialPages,
              ...pagesBeforeClose,
              ...pagesAfterSecondClose,
              ...pagesAfterRootClose,
            ].some((candidate) =>
              candidate.url().includes("synthetic-runtime.oneuptime.invalid")
            );

            return { data: {
              initialPageCount: initialPages.length,
              initialPageIdentity,
              rootUrlAfterNavigation,
              rootViewportAfterChange,
              secondUrlAfterNavigation,
              pageCountBeforeClose: pagesBeforeClose.length,
              secondClosedAfterClose,
              pageCountAfterSecondClose: pagesAfterSecondClose.length,
              rootClosedAfterClose,
              pageCountAfterRootClose: pagesAfterRootClose.length,
              controllerPageVisible,
            } };
          `,
          browserType,
          screenSizeType: "Desktop",
          args: {},
          timeoutInMs: 10_000,
        });

        expect(result.scriptError).toBeUndefined();
        expect(result.returnValue).toEqual({
          data: {
            initialPageCount: 1,
            initialPageIdentity: true,
            rootUrlAfterNavigation: `${TARGET_URL}state/root`,
            rootViewportAfterChange: { width: 1024, height: 700 },
            secondUrlAfterNavigation: `${TARGET_URL}state/second`,
            pageCountBeforeClose: 2,
            secondClosedAfterClose: true,
            pageCountAfterSecondClose: 1,
            rootClosedAfterClose: true,
            pageCountAfterRootClose: 0,
            controllerPageVisible: false,
          },
        });
      } finally {
        await browserContext.close();
        if (ownsBrowser) {
          await stateBrowser.close();
        }
      }
    },
  );

  test("keeps target Service Workers compatible without exposing the controller page", async () => {
    const server: Server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        if (request.url === "/sw.js") {
          response.writeHead(200, {
            "Content-Type": "text/javascript; charset=utf-8",
            "Service-Worker-Allowed": "/",
          });
          response.end(`
            self.addEventListener("install", () => self.skipWaiting());
            self.addEventListener("activate", (event) => {
              event.waitUntil(self.clients.claim());
            });
          `);
          return;
        }

        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
        });
        response.end("<!doctype html><title>Service Worker target</title>");
      },
    );
    await listen(server);
    const address: ReturnType<Server["address"]> = server.address();
    if (!address || typeof address === "string") {
      await closeServer(server);
      throw new Error("Expected a TCP test server address.");
    }
    const targetUrl: string = `http://127.0.0.1:${address.port}/`;

    try {
      const result: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(targetUrl)});
          const serviceWorkerState = await page.evaluate(async () => {
            await navigator.serviceWorker.register("/sw.js");
            const registration = await navigator.serviceWorker.ready;
            const active = registration.active;
            if (active && active.state !== "activated") {
              await new Promise((resolve) => {
                const onStateChange = () => {
                  if (active.state === "activated") {
                    active.removeEventListener("statechange", onStateChange);
                    resolve();
                  }
                };
                active.addEventListener("statechange", onStateChange);
              });
            }
            return active?.state;
          });
          const contextPages = page.context().pages();
          const privateTargetGlobals = await page.evaluate(() =>
            Object.getOwnPropertyNames(globalThis).filter((name) =>
              name.startsWith("__oneuptimeRpc_") ||
              name.startsWith("__oneuptimeWorker_")
            )
          );
          return { data: {
            serviceWorkerState,
            contextPageCount: contextPages.length,
            controllerPageVisible: contextPages.some((candidate) =>
              candidate.url().includes("synthetic-runtime.oneuptime.invalid")
            ),
            privateTargetGlobals,
          } };
        `,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          serviceWorkerState: "activated",
          contextPageCount: 1,
          controllerPageVisible: false,
          privateTargetGlobals: [],
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  test("returns byte values as sandbox buffers but only registers screenshot calls", async () => {
    const server: Server = http.createServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        response.end(Buffer.from([1, 2, 3, 4]));
      },
    );
    await listen(server);
    const address: ReturnType<Server["address"]> = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test server address.");
    }

    try {
      const result: SandboxExecutionResult = await run({
        code: `
          const response = await axios.get(
            "http://127.0.0.1:${address.port}/bytes",
            { responseType: "arraybuffer" }
          );
          const digest = crypto.createHash("sha256")
            .update("abc").digest("hex");
          const hmac = crypto.createHmac("sha256", "key")
            .update("data").digest("hex");
          return { data: {
            bytes: Array.from(response.data),
            isBuffer: Buffer.isBuffer(response.data),
            digest,
            hmac,
            uuidLength: crypto.randomUUID().length,
          }};
        `,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          bytes: [1, 2, 3, 4],
          isBuffer: true,
          digest:
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          hmac: "5031fe3d989c6d1537a013fa6e739da23463fdaec3b70137d828e36ace221bd0",
          uuidLength: 36,
        },
      });
      expect(result.screenshots).toEqual({});
    } finally {
      await closeServer(server);
    }
  });

  test("retains side-channel evidence when user code throws", async () => {
    const result: SandboxExecutionResult = await run({
      code: `
        await page.goto("${TARGET_URL}");
        console.log("before failure");
        oneuptime.captureMetric("before_failure", 1);
        screenshots["failure"] = await page.screenshot();
        throw new Error("intentional script failure");
      `,
    });

    expect(result.scriptError).toBe("intentional script failure");
    expect(result.logMessages).toEqual(["before failure"]);
    expect(result.capturedMetrics).toEqual([
      { name: "before_failure", value: 1 },
    ]);
    expect(result.screenshots["failure"]?.byteLength).toBeGreaterThan(100);
  });

  test("rejects cyclic and oversized return structures deterministically", async () => {
    const cyclic: SandboxExecutionResult = await run({
      code: `
        const value = { name: "cycle" };
        value.self = value;
        return { data: value };
      `,
    });
    expect(cyclic.scriptError).toContain("Cyclic return values");

    const oversized: SandboxExecutionResult = await run({
      code: `return { data: "x".repeat(6_000_000) };`,
    });
    expect(oversized.scriptError).toContain("exceeded the size limit");
    expect(oversized.returnValue).toBeUndefined();

    const tooComplex: SandboxExecutionResult = await run({
      code: `return { data: Array.from({ length: 20_001 }, (_, index) => index) };`,
    });
    expect(tooComplex.scriptError).toContain("Return value is too complex");
    expect(tooComplex.returnValue).toBeUndefined();
  });

  test("bounds scalar RPC arguments and log formatting before transport", async () => {
    const result: SandboxExecutionResult = await run({
      code: `
        let argumentError;
        try {
          await page.evaluate(
            (value) => value.length,
            "x".repeat(1_000_001)
          );
        } catch (error) {
          argumentError = error.message;
        }
        console.log("l".repeat(2_000_000));
        return { data: { argumentError } };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      data: {
        argumentError: expect.stringContaining("size limit"),
      },
    });
    expect(result.logMessages).toHaveLength(1);
    expect(
      Buffer.byteLength(result.logMessages[0] || "", "utf8"),
    ).toBeLessThanOrEqual(128_000);
  });

  test("terminates CPU loops, retains evidence, and keeps the browser usable", async () => {
    const startedAt: number = Date.now();
    const timedOut: SandboxExecutionResult = await run({
      code: `
        screenshots["before-timeout"] = await page.screenshot();
        console.log("before timeout");
        oneuptime.captureMetric("before_timeout", 1);
        while (true) {}
      `,
      timeoutInMs: 500,
    });
    expect(timedOut.scriptError).toContain("timed out");
    expect(timedOut.logMessages).toEqual(["before timeout"]);
    expect(timedOut.capturedMetrics).toEqual([
      { name: "before_timeout", value: 1 },
    ]);
    expect(timedOut.screenshots["before-timeout"]?.byteLength).toBeGreaterThan(
      100,
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(browser.isConnected()).toBe(true);

    const followUp: SandboxExecutionResult = await run({
      code: "return { data: 'still-alive' };",
    });
    expect(followUp.returnValue).toEqual({ data: "still-alive" });
  });

  test("aborts a pending host HTTP call at the execution deadline", async () => {
    const hangingServer: Server = http.createServer(
      (_request: IncomingMessage, _response: ServerResponse): void => {
        // Deliberately leave the response pending until the runtime aborts it.
      },
    );
    await listen(hangingServer);
    const address: ReturnType<Server["address"]> = hangingServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the test server to use a TCP address.");
    }

    const startedAt: number = Date.now();
    try {
      const result: SandboxExecutionResult = await run({
        code: `
          console.log("before pending request");
          await axios.get("http://127.0.0.1:${address.port}/never", {
            timeout: 30_000,
          });
        `,
        timeoutInMs: 500,
      });

      expect(result.scriptError).toContain("timed out");
      expect(result.logMessages).toEqual(["before pending request"]);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await closeServer(hangingServer);
    }
  });

  test("does not share worker globals between sequential or concurrent runs", async () => {
    const first: SandboxExecutionResult = await run({
      code: `globalThis.monitorSecret = "first"; return { data: monitorSecret };`,
    });
    const second: SandboxExecutionResult = await run({
      code: `return { data: typeof monitorSecret };`,
    });
    expect(first.returnValue).toEqual({ data: "first" });
    expect(second.returnValue).toEqual({ data: "undefined" });

    const concurrentResults: SandboxExecutionResult[] = await Promise.all([
      run({
        code: `globalThis.concurrentSecret = "left"; await new Promise((resolve) => setTimeout(resolve, 50)); return { data: concurrentSecret };`,
      }),
      run({
        code: `return { data: typeof concurrentSecret };`,
      }),
    ]);
    expect(concurrentResults[0]?.returnValue).toEqual({ data: "left" });
    expect(concurrentResults[1]?.returnValue).toEqual({ data: "undefined" });
  });

  test("supports and cleans up timeout and interval callbacks", async () => {
    const result: SandboxExecutionResult = await run({
      code: `
        const values = [];
        await new Promise((resolve) => {
          const interval = setInterval(() => {
            values.push(values.length + 1);
            if (values.length === 3) {
              clearInterval(interval);
              resolve();
            }
          }, 5);
        });
        const cancelled = setTimeout(() => values.push(99), 1);
        clearTimeout(cancelled);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: values };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({ data: [1, 2, 3] });
  });

  test("uses the same copy-only runtime in Firefox", async () => {
    const firefoxBrowser: Browser = await firefox.launch({ headless: true });
    const firefoxContext: BrowserContext = await firefoxBrowser.newContext();
    const page: Page = await firefoxContext.newPage();

    try {
      const result: SandboxExecutionResult = await WorkerController.execute({
        browserContext: firefoxContext,
        page,
        code: `return { data: {
          browserType,
          processType: typeof process,
          pagePrototype: Object.getPrototypeOf(page),
          handleValue: await (await (await page.evaluateHandle(
            () => ({ alpha: 42 })
          )).getProperties()).get("alpha").jsonValue(),
        }};`,
        browserType: "Firefox",
        screenSizeType: "Desktop",
        args: {},
        timeoutInMs: 10_000,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          browserType: "Firefox",
          processType: "undefined",
          pagePrototype: null,
          handleValue: 42,
        },
      });
    } finally {
      await firefoxContext.close();
      await firefoxBrowser.close();
    }
  });
});

function cryptoRandomCanary(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

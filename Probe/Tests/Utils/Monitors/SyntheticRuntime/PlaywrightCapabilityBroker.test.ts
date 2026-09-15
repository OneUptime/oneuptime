import fs from "fs";
import os from "os";
import path from "path";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import PlaywrightCapabilityBroker from "../../../../Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker";
import {
  CapabilityDescriptor,
  PlaywrightRpcRequest,
  PlaywrightRpcResponse,
  RuntimeStateSnapshot,
  SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
  ScreenshotDescriptor,
} from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

jest.setTimeout(120_000);

describe("SyntheticRuntime PlaywrightCapabilityBroker", () => {
  let browser: Browser;
  let targetContext: BrowserContext;
  let targetPage: Page;
  let controllerPage: Page;
  let abortController: AbortController;
  let broker: PlaywrightCapabilityBroker;
  let executionId: string;
  let pageCapability: CapabilityDescriptor;
  let requestSequence: number;
  let runtimeReadySpy: jest.Mock;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    targetContext = await browser.newContext();
    targetPage = await targetContext.newPage();
    controllerPage = await targetContext.newPage();
    abortController = new AbortController();
    executionId = `execution-${Date.now()}-${Math.random()}`;
    requestSequence = 0;
    runtimeReadySpy = jest.fn();
    broker = new PlaywrightCapabilityBroker({
      executionId,
      page: targetPage,
      browserContext: targetContext,
      controllerPage,
      signal: abortController.signal,
      onRuntimeReady: runtimeReadySpy,
    });
    pageCapability = broker.getBootstrapCapabilities().page;
  });

  afterEach(async () => {
    abortController.abort();
    await targetContext.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  function request(
    method: string,
    args: unknown[] = [],
    capability: CapabilityDescriptor = pageCapability,
  ): PlaywrightRpcRequest {
    requestSequence += 1;
    return {
      version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
      executionId,
      requestId: String(requestSequence),
      capabilityId: capability.id,
      method,
      args,
    };
  }

  test.each([
    "_browserType",
    "_channel",
    "_connection",
    "browser",
    "browserType",
    "connect",
    "connectOverCDP",
    "constructor",
    "exposeBinding",
    "exposeFunction",
    "launch",
    "launchPersistentContext",
    "launchServer",
    "newCDPSession",
    "route",
    "routeFromHAR",
  ])(
    "rejects denied or private method %s host-side",
    async (method: string) => {
      const response: PlaywrightRpcResponse = await broker.dispatch(
        request(method),
      );
      expect(response.ok).toBe(false);
      expect(response.error).toMatch(/not available|invalid/);
    },
  );

  test("allows page.setDefaultTimeout and setDefaultNavigationTimeout", async () => {
    const timeoutResponse: PlaywrightRpcResponse = await broker.dispatch(
      request("setDefaultTimeout", [45_000]),
    );
    expect(timeoutResponse.ok).toBe(true);

    const navigationTimeoutResponse: PlaywrightRpcResponse =
      await broker.dispatch(request("setDefaultNavigationTimeout", [45_000]));
    expect(navigationTimeoutResponse.ok).toBe(true);
  });

  test("allows page.waitForNavigation through to Playwright", async () => {
    /*
     * No navigation happens, so reaching Playwright means a timeout error —
     * not the broker's "not available" rejection.
     */
    const response: PlaywrightRpcResponse = await broker.dispatch(
      request("waitForNavigation", [{ timeout: 250 }]),
    );
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/Timeout/i);
    expect(response.error).not.toMatch(/not available/);
  });

  test("allows locator.type through a locator chain", async () => {
    await targetPage.setContent('<input id="field" />');

    const typeRequest: PlaywrightRpcRequest = {
      ...request("type", ["hello"]),
      locatorChain: [{ method: "locator", args: ["#field"] }],
    };
    const response: PlaywrightRpcResponse = await broker.dispatch(typeRequest);
    expect(response.ok).toBe(true);
    expect(await targetPage.inputValue("#field")).toBe("hello");
  });

  test("rejects wrong versions, executions, forged capabilities, and malformed methods", async () => {
    const valid: PlaywrightRpcRequest = request("title");
    const cases: unknown[] = [
      { ...valid, version: 999 },
      { ...valid, requestId: "wrong-execution", executionId: "another-run" },
      { ...valid, requestId: "forged", capabilityId: "forged-capability" },
      { ...valid, requestId: "private", method: "__proto__" },
      { ...valid, requestId: "punctuation", method: "title.call" },
      { ...valid, requestId: "args", args: {} },
      null,
    ];

    for (const candidate of cases) {
      const response: PlaywrightRpcResponse = await broker.dispatch(candidate);
      expect(response.ok).toBe(false);
      expect(response.error).toBeTruthy();
    }
  });

  test("rejects host path reads and writes before invoking Playwright", async () => {
    const canaryPath: string = path.join(
      os.tmpdir(),
      `oneuptime-broker-canary-${Date.now()}`,
    );
    const attempts: PlaywrightRpcRequest[] = [
      request("screenshot", [{ path: canaryPath }]),
      request("pdf", [{ path: canaryPath }]),
      request("addScriptTag", [{ path: canaryPath }]),
      request("addStyleTag", [{ path: canaryPath }]),
      request("addScriptTag", [{ url: "file:///etc/passwd" }]),
      request("addStyleTag", [{ url: "file:///etc/passwd" }]),
      request("addInitScript", [{ path: canaryPath }]),
      request("setInputFiles", ["input", canaryPath]),
      request("goto", ["file:///etc/passwd"]),
      request("addScriptTag", [{ path: canaryPath }, {}]),
      request("addStyleTag", [{ path: canaryPath }, {}]),
      request("screenshot", [{ path: canaryPath }, {}]),
      request("pdf", [{ path: canaryPath }, {}]),
      request(
        "storageState",
        [{ path: canaryPath }, {}],
        broker.getBootstrapCapabilities().browserContext,
      ),
    ];

    for (const attempt of attempts) {
      const response: PlaywrightRpcResponse = await broker.dispatch(attempt);
      expect(response.ok).toBe(false);
    }
    expect(fs.existsSync(canaryPath)).toBe(false);
  });

  test("does not accept a screenshot descriptor forged by the sandbox", async () => {
    broker.collectScreenshotAssignments({
      forged: {
        __oneuptimeScreenshot: true,
        id: "not-issued-by-the-broker",
        byteLength: 10,
      },
    });
    broker.collectScreenshotsFromReturnValue({
      screenshots: {
        alsoForged: {
          __oneuptimeScreenshot: true,
          id: "not-issued-by-the-broker",
          byteLength: 10,
        },
      },
    });
    expect(broker.getScreenshots()).toEqual({});
  });

  test("caps screenshot aliases before copying image buffers", async () => {
    const screenshotResponse: PlaywrightRpcResponse = await broker.dispatch(
      request("screenshot"),
    );
    expect(screenshotResponse.ok).toBe(true);

    const aliases: Record<string, unknown> = {};
    for (let index: number = 0; index < 1_000; index++) {
      aliases[`alias-${index}`] = screenshotResponse.value;
    }
    broker.collectScreenshotsFromReturnValue({ screenshots: aliases });

    expect(Object.keys(broker.getScreenshots())).toHaveLength(20);
  });

  test("caps the copied byte total across aliases of one screenshot", () => {
    const registerScreenshot: (buffer: Buffer) => ScreenshotDescriptor = (
      broker as unknown as {
        registerScreenshot: (buffer: Buffer) => ScreenshotDescriptor;
      }
    ).registerScreenshot.bind(broker);
    const descriptor: ScreenshotDescriptor = registerScreenshot(
      Buffer.alloc(3_000_000, 1),
    );
    const aliases: Record<string, ScreenshotDescriptor> = {};
    for (let index: number = 0; index < 20; index++) {
      aliases[`large-alias-${index}`] = descriptor;
    }
    broker.collectScreenshotsFromReturnValue({ screenshots: aliases });

    const screenshots: Record<string, Buffer> = broker.getScreenshots();
    const bytes: number = Object.values(screenshots).reduce(
      (total: number, screenshot: Buffer) => {
        return total + screenshot.byteLength;
      },
      0,
    );
    expect(Object.keys(screenshots)).toHaveLength(16);
    expect(bytes).toBeLessThanOrEqual(50_000_000);
  });

  test("enforces the cancellation boundary", async () => {
    abortController.abort();
    const response: PlaywrightRpcResponse = await broker.dispatch(
      request("title"),
    );
    expect(response.ok).toBe(false);
    expect(response.error).toContain("cancelled");
  });

  test("reports the private runtime-ready handshake only once", async () => {
    const runtimeCapability: CapabilityDescriptor =
      broker.getBootstrapCapabilities().runtime;
    expect(
      (await broker.dispatch(request("ready", [], runtimeCapability))).ok,
    ).toBe(true);
    expect(
      (await broker.dispatch(request("ready", [], runtimeCapability))).ok,
    ).toBe(true);
    expect(runtimeReadySpy).toHaveBeenCalledTimes(1);
  });

  test("denies host-device and clipboard browser permissions", async () => {
    const contextCapability: CapabilityDescriptor =
      broker.getBootstrapCapabilities().browserContext;
    for (const permission of [
      "camera",
      "clipboard-read",
      "clipboard-write",
      "local-fonts",
      "local-network-access",
      "microphone",
      "midi-sysex",
    ]) {
      const response: PlaywrightRpcResponse = await broker.dispatch(
        request("grantPermissions", [[permission]], contextCapability),
      );
      expect(response.ok).toBe(false);
      expect(response.error).toContain("geolocation and notification");
    }

    const geolocation: PlaywrightRpcResponse = await broker.dispatch(
      request(
        "grantPermissions",
        [["geolocation"], { origin: "https://example.com" }],
        contextCapability,
      ),
    );
    expect(geolocation.ok).toBe(true);
  });

  test("limits concurrently executing host calls", async () => {
    const responses: PlaywrightRpcResponse[] = await Promise.all(
      Array.from({ length: 40 }, () => {
        return broker.dispatch(request("waitForTimeout", [100]));
      }),
    );
    expect(
      responses.filter((response: PlaywrightRpcResponse) => {
        return !response.ok;
      }).length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      responses.some((response: PlaywrightRpcResponse) => {
        return response.error?.includes("concurrent RPC limit");
      }),
    ).toBe(true);

    const recovery: PlaywrightRpcResponse = await broker.dispatch(
      request("title"),
    );
    expect(recovery.ok).toBe(true);
  });

  test("caps pages, viewport area, and screenshot dimensions", async () => {
    const contextCapability: CapabilityDescriptor =
      broker.getBootstrapCapabilities().browserContext;

    for (let index: number = 1; index < 8; index++) {
      const response: PlaywrightRpcResponse = await broker.dispatch(
        request("newPage", [], contextCapability),
      );
      expect(response.ok).toBe(true);
    }
    const excessPage: PlaywrightRpcResponse = await broker.dispatch(
      request("newPage", [], contextCapability),
    );
    expect(excessPage.ok).toBe(false);
    expect(excessPage.error).toContain("page limit");

    const oversizedViewport: PlaywrightRpcResponse = await broker.dispatch(
      request("setViewportSize", [{ width: 10_000, height: 10_000 }]),
    );
    expect(oversizedViewport.ok).toBe(false);
    expect(oversizedViewport.error).toContain("viewport is too large");

    const fullPageScreenshot: PlaywrightRpcResponse = await broker.dispatch(
      request("screenshot", [{ fullPage: true }]),
    );
    expect(fullPageScreenshot.ok).toBe(false);
    expect(fullPageScreenshot.error).toContain(
      "Full-page screenshots are not available",
    );
  });

  test("closes excess pages created inside the monitored page", async () => {
    await targetPage.evaluate((): void => {
      for (let index: number = 0; index < 20; index++) {
        window.open("about:blank", "_blank");
      }
    });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 250);
    });

    expect(
      targetContext.pages().filter((page: Page) => {
        return page !== controllerPage;
      }).length,
    ).toBeLessThanOrEqual(8);
  });

  test("refreshes a closed invoked page without returning historical capabilities", async () => {
    const contextCapability: CapabilityDescriptor =
      broker.getBootstrapCapabilities().browserContext;
    const closedPageIds: string[] = [];

    for (let index: number = 0; index < 12; index++) {
      const opened: PlaywrightRpcResponse = await broker.dispatch(
        request("newPage", [], contextCapability),
      );
      expect(opened.ok).toBe(true);
      const openedPage: CapabilityDescriptor =
        opened.value as CapabilityDescriptor;

      const closed: PlaywrightRpcResponse = await broker.dispatch(
        request("close", [], openedPage),
      );
      expect(closed.ok).toBe(true);
      expect(closed.state?.pages).toHaveLength(1);
      expect(closed.state?.pages[0]?.id).toBe(pageCapability.id);
      expect(closed.state?.invokedCapability).toMatchObject({
        id: openedPage.id,
        type: "page",
        snapshot: { isClosed: true },
      });

      const returnedState: string = JSON.stringify(closed.state);
      for (const historicalId of closedPageIds) {
        expect(returnedState).not.toContain(historicalId);
      }
      closedPageIds.push(openedPage.id);
    }
  });

  test("returns errors as copied single-line messages without host Error objects", async () => {
    const response: PlaywrightRpcResponse = await broker.dispatch(
      request("click", ["#missing", { timeout: 10 }]),
    );
    expect(response.ok).toBe(false);
    expect(typeof response.error).toBe("string");
    expect(response.error).not.toMatch(/[\r\n\t]/);
    expect(Object.getPrototypeOf(response)).toBe(Object.prototype);
  });

  /*
   * Internal pages are the pages the runtime opened for itself besides the
   * controller page: bootstrap attempts WorkerController gave up on, whose
   * bounded close may not have finished. They live in the tenant's context but
   * are not the tenant's. Each of these tests uses a context of its own,
   * because the broker built in beforeEach watches targetContext and would
   * close the extra pages as excess.
   */
  function createBroker(
    options: ConstructorParameters<typeof PlaywrightCapabilityBroker>[0],
  ): PlaywrightCapabilityBroker {
    return new PlaywrightCapabilityBroker(options);
  }

  async function openPages(
    context: BrowserContext,
    count: number,
  ): Promise<Page[]> {
    const pages: Page[] = [];
    for (let index: number = 0; index < count; index++) {
      pages.push(await context.newPage());
    }
    return pages;
  }

  function descriptorIds(descriptors: unknown): string[] {
    return ((descriptors as CapabilityDescriptor[] | undefined) || []).map(
      (descriptor: CapabilityDescriptor): string => {
        return descriptor.id;
      },
    );
  }

  test("hides internal pages from the pages reported to the sandbox", async () => {
    const context: BrowserContext = await browser.newContext();

    try {
      const tenantPage: Page = await context.newPage();
      const runtimePage: Page = await context.newPage();
      const internalPages: Page[] = await openPages(context, 2);
      const internalBroker: PlaywrightCapabilityBroker = createBroker({
        executionId,
        page: tenantPage,
        browserContext: context,
        controllerPage: runtimePage,
        internalPages: new Set<Page>(internalPages),
        signal: abortController.signal,
        onRuntimeReady: jest.fn(),
      });
      const capabilities: ReturnType<
        PlaywrightCapabilityBroker["getBootstrapCapabilities"]
      > = internalBroker.getBootstrapCapabilities();

      // The internal pages really are open in the context the tenant shares.
      expect(context.pages()).toHaveLength(4);

      // The context snapshot the sandbox bootstraps its page list from.
      expect(
        descriptorIds(capabilities.browserContext.snapshot?.["pages"]),
      ).toEqual([capabilities.page.id]);

      // The live page list every RPC response refreshes.
      const title: PlaywrightRpcResponse = await internalBroker.dispatch(
        request("title", [], capabilities.page),
      );
      expect(title.ok).toBe(true);
      expect(descriptorIds(title.state?.pages)).toEqual([capabilities.page.id]);

      // A page the tenant opens is listed next to its own, and only those.
      const opened: PlaywrightRpcResponse = await internalBroker.dispatch(
        request("newPage", [], capabilities.browserContext),
      );
      expect(opened.ok).toBe(true);
      expect(descriptorIds(opened.state?.pages)).toEqual([
        capabilities.page.id,
        (opened.value as CapabilityDescriptor).id,
      ]);
      expect(
        internalPages.filter((internalPage: Page): boolean => {
          return internalPage.isClosed();
        }),
      ).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test("does not count internal pages toward the browser page limit", async () => {
    const context: BrowserContext = await browser.newContext();

    try {
      const tenantPage: Page = await context.newPage();
      const runtimePage: Page = await context.newPage();
      // As many internal pages as the tenant's whole allowance of eight.
      const internalPages: Page[] = await openPages(context, 8);
      const internalBroker: PlaywrightCapabilityBroker = createBroker({
        executionId,
        page: tenantPage,
        browserContext: context,
        controllerPage: runtimePage,
        internalPages: new Set<Page>(internalPages),
        signal: abortController.signal,
        onRuntimeReady: jest.fn(),
      });
      const contextCapability: CapabilityDescriptor =
        internalBroker.getBootstrapCapabilities().browserContext;

      // The tenant's own page plus seven more is exactly its limit.
      let lastState: RuntimeStateSnapshot | undefined;
      for (let index: number = 1; index < 8; index++) {
        const response: PlaywrightRpcResponse = await internalBroker.dispatch(
          request("newPage", [], contextCapability),
        );
        expect(response.error).toBeUndefined();
        expect(response.ok).toBe(true);
        lastState = response.state;
      }
      expect(lastState?.pages).toHaveLength(8);

      const excessPage: PlaywrightRpcResponse = await internalBroker.dispatch(
        request("newPage", [], contextCapability),
      );
      expect(excessPage.ok).toBe(false);
      expect(excessPage.error).toContain("page limit");

      /*
       * The broker also closes pages that push the tenant past its limit as
       * they appear. That guard counts the same way, so it closed nothing:
       * not the tenant's eight pages, and not the internal ones. The close it
       * would issue is not awaited, hence the pause before looking.
       */
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 250);
      });
      expect(context.pages()).toHaveLength(1 + 1 + 8 + 7);
      expect(
        internalPages.filter((internalPage: Page): boolean => {
          return internalPage.isClosed();
        }),
      ).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test("without internal pages, every page but the controller page is the tenant's", async () => {
    const context: BrowserContext = await browser.newContext();

    try {
      const tenantPage: Page = await context.newPage();
      const runtimePage: Page = await context.newPage();
      await openPages(context, 7);
      const plainBroker: PlaywrightCapabilityBroker = createBroker({
        executionId,
        page: tenantPage,
        browserContext: context,
        controllerPage: runtimePage,
        signal: abortController.signal,
        onRuntimeReady: jest.fn(),
      });
      const capabilities: ReturnType<
        PlaywrightCapabilityBroker["getBootstrapCapabilities"]
      > = plainBroker.getBootstrapCapabilities();

      // The tenant's page and the seven others; the controller page is not.
      expect(
        descriptorIds(capabilities.browserContext.snapshot?.["pages"]),
      ).toHaveLength(8);
      const title: PlaywrightRpcResponse = await plainBroker.dispatch(
        request("title", [], capabilities.page),
      );
      expect(title.ok).toBe(true);
      expect(descriptorIds(title.state?.pages)).toHaveLength(8);
      expect(descriptorIds(title.state?.pages)[0]).toBe(capabilities.page.id);

      // Those seven count toward the limit, so the tenant can open no more.
      const excessPage: PlaywrightRpcResponse = await plainBroker.dispatch(
        request("newPage", [], capabilities.browserContext),
      );
      expect(excessPage.ok).toBe(false);
      expect(excessPage.error).toContain("page limit");
    } finally {
      await context.close();
    }
  });
});

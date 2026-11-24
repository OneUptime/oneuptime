import dns from "dns";
import fs from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import PlaywrightCapabilityBroker from "../../../../Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker";
import SyntheticEgressProxy from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticEgressProxy";
import { MonitorEgressPolicy } from "../../../../Utils/Monitors/MonitorEgressGuardOptions";
import PrivateNetworkMonitorPolicy, {
  ResolvedPrivateNetworkMonitorPolicy,
} from "../../../../Utils/PrivateNetworkMonitorPolicy";
import {
  LocalHttpServer,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import FakeInternet, { FakeInternetRequest } from "./Fixtures/FakeInternet";
import {
  CapabilityDescriptor,
  PlaywrightRpcRequest,
  PlaywrightRpcResponse,
  RuntimeStateSnapshot,
  SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
  ScreenshotDescriptor,
} from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

jest.setTimeout(120_000);

type BrokerOptions = ConstructorParameters<
  typeof PlaywrightCapabilityBroker
>[0];

// What a probe of this kind hands its synthetic checks (SyntheticMonitor).
function probePolicy(data: {
  configuredValue: string | undefined;
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): MonitorEgressPolicy {
  const resolved: ResolvedPrivateNetworkMonitorPolicy =
    PrivateNetworkMonitorPolicy.resolve(data);

  return {
    allowPrivateNetworkAddresses: resolved.allowed,
    privateNetworkHint: resolved.refusalHint,
  };
}

const HOSTED_GLOBAL_PROBE: MonitorEgressPolicy = probePolicy({
  configuredValue: "true",
  isAutoRegisteredGlobalProbe: true,
  isBillingEnabled: true,
});

const CUSTOM_PROBE_WITH_PRIVATE_ACCESS: MonitorEgressPolicy = probePolicy({
  configuredValue: "true",
  isAutoRegisteredGlobalProbe: false,
  isBillingEnabled: false,
});

describe("SyntheticRuntime PlaywrightCapabilityBroker", () => {
  let browser: Browser;
  let targetContext: BrowserContext;
  let targetPage: Page;
  let controllerPage: Page;
  let abortController: AbortController;
  let broker: PlaywrightCapabilityBroker;
  let egress: SyntheticEgressProxy;
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
    egress = new SyntheticEgressProxy({ policy: HOSTED_GLOBAL_PROBE });
    await egress.start();
    broker = new PlaywrightCapabilityBroker({
      executionId,
      page: targetPage,
      browserContext: targetContext,
      controllerPage,
      signal: abortController.signal,
      onRuntimeReady: runtimeReadySpy,
      egress,
    });
    pageCapability = broker.getBootstrapCapabilities().page;
  });

  afterEach(async () => {
    abortController.abort();
    await egress.close();
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
    options: Omit<BrokerOptions, "egress">,
  ): PlaywrightCapabilityBroker {
    return new PlaywrightCapabilityBroker({ ...options, egress });
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

  test("withholds an internal page that a popup's opener() leads back to", async () => {
    /*
     * pages() is not the only road to a page. A popup opened by an internal
     * page is an ordinary page the tenant may use, and its opener() leads
     * straight back to the internal page -- the path a review found still
     * handed the tenant a live capability for an abandoned bootstrap page.
     * The tenant's own popups must keep reporting their opener.
     */
    const context: BrowserContext = await browser.newContext();

    try {
      const tenantPage: Page = await context.newPage();
      const runtimePage: Page = await context.newPage();
      const internalPage: Page = await context.newPage();
      const internalBroker: PlaywrightCapabilityBroker = createBroker({
        executionId,
        page: tenantPage,
        browserContext: context,
        controllerPage: runtimePage,
        internalPages: new Set<Page>([internalPage]),
        signal: abortController.signal,
        onRuntimeReady: jest.fn(),
      });
      const capabilities: ReturnType<
        PlaywrightCapabilityBroker["getBootstrapCapabilities"]
      > = internalBroker.getBootstrapCapabilities();

      const listedPageIds: () => Promise<string[]> = async (): Promise<
        string[]
      > => {
        const response: PlaywrightRpcResponse = await internalBroker.dispatch(
          request("title", [], capabilities.page),
        );
        expect(response.ok).toBe(true);
        return descriptorIds(response.state?.pages);
      };

      const openPopupFrom: (
        opener: Page,
      ) => Promise<CapabilityDescriptor> = async (
        opener: Page,
      ): Promise<CapabilityDescriptor> => {
        const before: string[] = await listedPageIds();
        await Promise.all([
          opener.waitForEvent("popup"),
          opener.evaluate("void window.open('about:blank')"),
        ]);
        const response: PlaywrightRpcResponse = await internalBroker.dispatch(
          request("title", [], capabilities.page),
        );
        const added: CapabilityDescriptor[] = (
          (response.state?.pages as CapabilityDescriptor[] | undefined) || []
        ).filter((descriptor: CapabilityDescriptor): boolean => {
          return !before.includes(descriptor.id);
        });
        expect(added).toHaveLength(1);
        return added[0] as CapabilityDescriptor;
      };

      // Control: the tenant's own popup still leads back to the tenant's page.
      const tenantPopup: CapabilityDescriptor = await openPopupFrom(tenantPage);
      const tenantOpener: PlaywrightRpcResponse = await internalBroker.dispatch(
        request("opener", [], tenantPopup),
      );
      expect(tenantOpener.ok).toBe(true);
      expect((tenantOpener.value as CapabilityDescriptor | null)?.id).toBe(
        capabilities.page.id,
      );

      // The internal page's popup is usable, but its opener is withheld.
      const runtimePopup: CapabilityDescriptor =
        await openPopupFrom(internalPage);
      const runtimeOpener: PlaywrightRpcResponse =
        await internalBroker.dispatch(request("opener", [], runtimePopup));
      expect(runtimeOpener.ok).toBe(true);
      expect(runtimeOpener.value).toBeNull();

      // Nothing about the exchange put the internal page on the tenant's list.
      expect(await listedPageIds()).toEqual([
        capabilities.page.id,
        tenantPopup.id,
        runtimePopup.id,
      ]);
      expect(internalPage.isClosed()).toBe(false);
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

  /*
   * GHSA-9rx7-vwfj-whp7: the script's axios bridge sent requests from the
   * probe wherever the script said - the cloud metadata endpoint, loopback,
   * the network the probe runs in - and handed back the response. It now
   * sends them through the check's egress proxy, which holds them to the
   * probe's egress policy hop by hop, as the browser's requests are held.
   */
  describe("the axios bridge's egress", () => {
    let loopbackServer: http.Server;
    let loopbackPort: number;
    let loopbackHits: Array<string>;
    let siteServer: http.Server;
    let sitePort: number;
    let fakeInternet: FakeInternet;
    const ownEgresses: Array<SyntheticEgressProxy> = [];

    async function listen(
      handler: (request: IncomingMessage, response: ServerResponse) => void,
    ): Promise<{ server: http.Server; port: number }> {
      const server: http.Server = http.createServer(handler);
      await new Promise<void>((resolve: () => void): void => {
        server.listen(0, "127.0.0.1", resolve);
      });
      return { server, port: (server.address() as AddressInfo).port };
    }

    async function close(server: http.Server): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve: () => void): void => {
        server.close((): void => {
          resolve();
        });
      });
    }

    beforeEach(async () => {
      loopbackHits = [];
      const loopback: { server: http.Server; port: number } = await listen(
        (request: IncomingMessage, response: ServerResponse): void => {
          loopbackHits.push(request.url || "");
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ secret: "loopback-sentinel" }));
        },
      );
      loopbackServer = loopback.server;
      loopbackPort = loopback.port;

      const site: { server: http.Server; port: number } = await listen(
        (request: IncomingMessage, response: ServerResponse): void => {
          if (request.url === "/redirect-to-loopback") {
            response.writeHead(302, {
              Location: `http://127.0.0.1:${loopbackPort}/secret`,
            });
            response.end();
            return;
          }
          if (request.url === "/missing") {
            response.writeHead(404, {
              "Content-Type": "application/json",
              "X-Site": "public",
            });
            response.end(JSON.stringify({ error: "not here" }));
            return;
          }
          response.writeHead(200, {
            "Content-Type": "application/json",
            "X-Site": "public",
          });
          response.end(
            JSON.stringify({
              path: request.url,
              host: request.headers.host,
              header: request.headers["x-script"],
            }),
          );
        },
      );
      siteServer = site.server;
      sitePort = site.port;

      fakeInternet = new FakeInternet();
      await fakeInternet.start();
      fakeInternet.route("93.184.215.14", 80, sitePort);
      fakeInternet.route("10.23.45.67", 80, sitePort);
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      while (ownEgresses.length > 0) {
        await ownEgresses.pop()!.close();
      }
      await fakeInternet.stop();
      await close(siteServer);
      await close(loopbackServer);
    });

    // A broker whose check's egress goes out through the fake internet.
    async function brokerBehindFakeInternet(
      policy: MonitorEgressPolicy,
    ): Promise<PlaywrightCapabilityBroker> {
      const checkEgress: SyntheticEgressProxy = new SyntheticEgressProxy({
        policy,
        upstreamProxy: { server: fakeInternet.url() },
      });
      await checkEgress.start();
      ownEgresses.push(checkEgress);

      return new PlaywrightCapabilityBroker({
        executionId,
        page: targetPage,
        browserContext: targetContext,
        controllerPage,
        signal: abortController.signal,
        onRuntimeReady: jest.fn(),
        egress: checkEgress,
      });
    }

    async function axiosRequest(
      target: PlaywrightCapabilityBroker,
      call: Record<string, unknown>,
    ): Promise<PlaywrightRpcResponse> {
      return await target.dispatch(
        request(
          "axiosRequest",
          [call],
          target.getBootstrapCapabilities().runtime,
        ),
      );
    }

    test.each([
      {
        label: "a loopback address",
        url: (): string => {
          return `http://127.0.0.1:${loopbackPort}/secret`;
        },
        error:
          "Monitor target host 127.0.0.1 is not allowed: loopback address.",
      },
      {
        label: "localhost",
        url: (): string => {
          return `http://localhost:${loopbackPort}/secret`;
        },
        error: "Monitor target host localhost could not be reached.",
      },
      {
        label: "the cloud metadata endpoint",
        url: (): string => {
          return "http://169.254.169.254/latest/meta-data/iam/security-credentials/";
        },
        error:
          "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
      },
      {
        label: "the cloud metadata endpoint over https",
        url: (): string => {
          return "https://169.254.169.254/latest/api/token";
        },
        error:
          "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
      },
      {
        label: "an IPv4-mapped loopback address",
        url: (): string => {
          return `http://[::ffff:127.0.0.1]:${loopbackPort}/secret`;
        },
        error:
          "Monitor target host ::ffff:7f00:1 is not allowed: loopback address.",
      },
    ])(
      "refuses $label as an error of the script's, never reaching it",
      async ({ url, error }: { url: () => string; error: string }) => {
        const response: PlaywrightRpcResponse = await axiosRequest(broker, {
          method: "put",
          url: url(),
          data: { token: "x" },
          config: { headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" } },
        });

        expect(response.ok).toBe(false);
        expect(response.error).toBe(error);
        expect(JSON.stringify(response)).not.toContain("loopback-sentinel");
        expect(loopbackHits).toEqual([]);
      },
    );

    test("refuses a redirect from a public site to loopback, with the refusal as the error", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "http://93.184.215.14/redirect-to-loopback",
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe(
        "Monitor target host 127.0.0.1 is not allowed: loopback address.",
      );
      expect(loopbackHits).toEqual([]);
    });

    test("refuses a private address on a global probe of a hosted instance, and points at a private probe", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "http://10.23.45.67/health",
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe(
        "Monitor target host 10.23.45.67 is not allowed: private network address. Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.",
      );
      expect(fakeInternet.isUntouched).toBe(true);
    });

    test("refuses an internal name on a global probe without saying what it resolves to", async () => {
      jest
        .spyOn(dns.promises, "lookup")
        .mockResolvedValue([{ address: "10.96.0.1", family: 4 }] as never);
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "https://kubernetes.default.svc/api",
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe(
        "Monitor target host kubernetes.default.svc could not be reached.",
      );
      expect(response.error).not.toContain("10.96");
      expect(fakeInternet.isUntouched).toBe(true);
    });

    test("reaches a private address on a custom probe whose operator allowed it, as before", async () => {
      const privateBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(CUSTOM_PROBE_WITH_PRIVATE_ACCESS);

      const response: PlaywrightRpcResponse = await axiosRequest(
        privateBroker,
        { method: "get", url: "http://10.23.45.67/health" },
      );

      expect(response.ok).toBe(true);
      expect(response.value).toMatchObject({
        status: 200,
        data: { path: "/health", host: "10.23.45.67" },
      });
      expect(
        fakeInternet.requests.map((seen: FakeInternetRequest) => {
          return seen.url;
        }),
      ).toEqual(["http://10.23.45.67:80/health"]);
    });

    test("still refuses loopback and the metadata endpoint on a probe that allows private addresses", async () => {
      const privateBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(CUSTOM_PROBE_WITH_PRIVATE_ACCESS);

      const loopback: PlaywrightRpcResponse = await axiosRequest(
        privateBroker,
        { method: "get", url: `http://127.0.0.1:${loopbackPort}/secret` },
      );
      const metadata: PlaywrightRpcResponse = await axiosRequest(
        privateBroker,
        { method: "get", url: "http://169.254.169.254/" },
      );

      expect(loopback.ok).toBe(false);
      expect(metadata.ok).toBe(false);
      expect(loopbackHits).toEqual([]);
      expect(fakeInternet.isUntouched).toBe(true);
    });

    test("returns a public site's status, headers and body to the script, as before", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "http://93.184.215.14/status",
        config: { headers: { "X-Script": "sent" } },
      });

      expect(response.ok).toBe(true);
      expect(response.value).toMatchObject({
        status: 200,
        headers: { "x-site": "public" },
        data: { path: "/status", host: "93.184.215.14", header: "sent" },
      });
    });

    test("keeps the script's own Proxy- headers from the egress proxy, the outbound proxy and the site", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "http://93.184.215.14/status",
        config: {
          headers: {
            "X-Script": "sent",
            "Proxy-Authorization": "Basic c2NyaXB0OnNlY3JldA==",
            "proxy-connection": "keep-alive",
          },
        },
      });

      expect(response.ok).toBe(true);
      expect(response.value).toMatchObject({
        status: 200,
        data: { header: "sent" },
      });
      expect(fakeInternet.requests).toEqual([
        expect.objectContaining({
          url: "http://93.184.215.14:80/status",
          credentials: "",
        }),
      ]);
    });

    test("returns a public site's error status as the axios error the script expects, as before", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "http://93.184.215.14/missing",
      });

      expect(response.ok).toBe(true);
      expect(response.value).toMatchObject({
        __oneuptimeAxiosError: true,
        status: 404,
        headers: { "x-site": "public" },
        data: { error: "not here" },
      });
    });

    test("reports a public host the outbound proxy cannot reach as unreachable", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      // The fake internet refuses the tunnel: it has no such host.
      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "https://93.184.215.99/",
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe(
        "Monitor target host 93.184.215.99 could not be reached.",
      );
      expect(fakeInternet.connects).toEqual(["93.184.215.99:443"]);
    });

    test("hands back the outbound proxy's own answer for a plain-http host it cannot reach, as before", async () => {
      const publicBroker: PlaywrightCapabilityBroker =
        await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);

      const response: PlaywrightRpcResponse = await axiosRequest(publicBroker, {
        method: "get",
        url: "http://93.184.215.99/",
        config: { responseType: "text" },
      });

      expect(response.ok).toBe(true);
      expect(response.value).toMatchObject({
        __oneuptimeAxiosError: true,
        status: 502,
        data: "no such host on the fake internet",
      });
    });

    test("never takes a proxy from the environment around the egress proxy", async () => {
      const decoy: { server: http.Server; port: number } = await listen(
        (_request: IncomingMessage, response: ServerResponse): void => {
          response.end("decoy proxy");
        },
      );
      const saved: Record<string, string | undefined> = {
        HTTP_PROXY: process.env["HTTP_PROXY"],
        http_proxy: process.env["http_proxy"],
      };
      process.env["HTTP_PROXY"] = `http://127.0.0.1:${decoy.port}`;
      process.env["http_proxy"] = `http://127.0.0.1:${decoy.port}`;
      let decoyHits: number = 0;
      decoy.server.on("request", (): void => {
        decoyHits++;
      });

      try {
        const publicBroker: PlaywrightCapabilityBroker =
          await brokerBehindFakeInternet(HOSTED_GLOBAL_PROBE);
        const response: PlaywrightRpcResponse = await axiosRequest(
          publicBroker,
          { method: "get", url: `http://127.0.0.1:${loopbackPort}/secret` },
        );

        expect(response.ok).toBe(false);
        expect(decoyHits).toBe(0);
        expect(loopbackHits).toEqual([]);
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        }
        await close(decoy.server);
      }
    });
  });

  /*
   * Behind the operator's outbound proxy, the axios bridge is signed in with
   * the proxy's real user name and password: axios, left to read the proxy
   * itself, sent them percent-encoded, so a proxy whose password holds an @,
   * a : or a % refused every request with 407 (#10442). The proxy is the
   * check's (config.proxy, as the browser's always was), and it is asked for
   * the address the egress guard approved, never the name.
   */
  describe("the axios bridge, behind an outbound proxy", () => {
    clearOutboundProxyEnvironmentForEachTest();

    const serve: (options?: {
      host?: string | undefined;
      port?: number | undefined;
      name?: string | undefined;
    }) => Promise<LocalHttpServer> = useLocalHttpServers();
    const ownEgresses: Array<SyntheticEgressProxy> = [];

    afterEach(async () => {
      jest.restoreAllMocks();
      while (ownEgresses.length > 0) {
        await ownEgresses.pop()!.close();
      }
    });

    async function brokerBehind(
      proxy: LocalHttpServer,
    ): Promise<PlaywrightCapabilityBroker> {
      jest.spyOn(dns.promises, "lookup").mockImplementation((async (
        hostname: string,
      ) => {
        if (hostname === "service.example.test") {
          return [{ address: "93.184.215.14", family: 4 }];
        }
        // The proxy's own name is the operator's, looked up as usual.
        return [{ address: "127.0.0.1", family: 4 }];
      }) as never);
      const server: string = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );
      const parsed: URL = new URL(server);
      const checkEgress: SyntheticEgressProxy = new SyntheticEgressProxy({
        policy: HOSTED_GLOBAL_PROBE,
        upstreamProxy: {
          server,
          username: parsed.username,
          password: parsed.password,
        },
      });
      await checkEgress.start();
      ownEgresses.push(checkEgress);

      return new PlaywrightCapabilityBroker({
        executionId,
        page: targetPage,
        browserContext: targetContext,
        controllerPage,
        signal: abortController.signal,
        onRuntimeReady: jest.fn(),
        egress: checkEgress,
      });
    }

    test("over http, the proxy is sent the request for the approved address, signed in with its real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const proxied: PlaywrightCapabilityBroker = await brokerBehind(proxy);

      const response: PlaywrightRpcResponse = await proxied.dispatch(
        request(
          "axiosRequest",
          [{ method: "get", url: "http://service.example.test/health" }],
          proxied.getBootstrapCapabilities().runtime,
        ),
      );

      expect(response.ok).toBe(true);
      expect(
        proxy.requests.map((seen: { url: string; host: string }) => {
          return { url: seen.url, host: seen.host };
        }),
      ).toEqual([
        {
          url: "http://93.184.215.14:80/health",
          host: "service.example.test",
        },
      ]);
      expect(proxy.requestCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
    });

    test("over https, the CONNECT names the approved address and is signed in with its real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const proxied: PlaywrightCapabilityBroker = await brokerBehind(proxy);

      // The proxy refuses every tunnel here: who signed in is the point.
      await proxied.dispatch(
        request(
          "axiosRequest",
          [{ method: "get", url: "https://service.example.test/health" }],
          proxied.getBootstrapCapabilities().runtime,
        ),
      );

      expect(proxy.connects).toEqual(["93.184.215.14:443"]);
      expect(proxy.connectCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
    });

    test("never asks the proxy for a refused target", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const proxied: PlaywrightCapabilityBroker = await brokerBehind(proxy);

      const response: PlaywrightRpcResponse = await proxied.dispatch(
        request(
          "axiosRequest",
          [{ method: "get", url: "http://169.254.169.254/latest/meta-data/" }],
          proxied.getBootstrapCapabilities().runtime,
        ),
      );

      expect(response.ok).toBe(false);
      expect(proxy.isUntouched).toBe(true);
    });
  });
});

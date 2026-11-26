import fs from "fs";
import net from "net";
import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  LaunchOptions,
  Page,
  chromium,
  firefox,
} from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticBrowser, {
  CHROMIUM_EGRESS_ARGUMENTS,
  CHROMIUM_PROXY_BYPASS,
  FIREFOX_EGRESS_PREFERENCES,
  FIREFOX_NO_SYNC_LIBRARY_PATH,
  SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS,
  SyntheticBrowserSession,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";
import SyntheticEgressProxy from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticEgressProxy";
import SyntheticRuntimeFault, {
  SYNTHETIC_RUNTIME_FAULT_KIND,
  isSyntheticRuntimeFault,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
import { SyntheticMonitorWorkerConfig } from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";

/*
 * SyntheticBrowser is how a check gets its browser, and the way it does that
 * is the fix for "the browser runtime did not finish starting up after 3
 * attempt(s)". From 12.0.11 every check ran in launchPersistentContext() on a
 * brand-new profile directory, and Chromium would not hand the runtime's
 * controller navigation to page.route until that profile's cookie database had
 * been created and synced to disk. On a probe whose disk was slow to
 * acknowledge writes, every bootstrap attempt stalled for as long as the disk
 * did. launch() plus browser.newContext() keeps that store in memory.
 *
 * These tests pin that contract against fakes -- which launcher call is made
 * and with exactly which options, the order the caller is told about the
 * browser, and how failures are reported -- because a real browser cannot be
 * made to fail on demand. SyntheticBrowserSlowStorage.test.ts proves the same
 * fix against a real Chromium on deliberately slow storage.
 */

jest.mock("playwright", () => {
  return {
    chromium: { launch: jest.fn(), launchPersistentContext: jest.fn() },
    firefox: { launch: jest.fn(), launchPersistentContext: jest.fn() },
  };
});

interface MockLauncher {
  readonly launch: jest.Mock<Promise<Browser>, [LaunchOptions]>;
  readonly launchPersistentContext: jest.Mock<
    Promise<BrowserContext>,
    [string, unknown]
  >;
}

interface FakeBrowser {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly newContext: jest.Mock<
    Promise<BrowserContext>,
    [BrowserContextOptions]
  >;
  readonly newPage: jest.Mock<Promise<Page>, []>;
  readonly close: jest.Mock<Promise<void>, []>;
}

interface CapturedTimer {
  readonly callback: () => void;
  readonly delayInMs: number | undefined;
  readonly handle: NodeJS.Timeout;
}

const mockChromium: MockLauncher = chromium as unknown as MockLauncher;
const mockFirefox: MockLauncher = firefox as unknown as MockLauncher;

const CHROMIUM_EXECUTABLE_PATH: string =
  "/opt/ms-playwright/chromium-1223/chrome-linux64/chrome";
const FIREFOX_EXECUTABLE_PATH: string =
  "/opt/ms-playwright/firefox-1522/firefox/firefox";

function createConfig(
  overrides: Partial<SyntheticMonitorWorkerConfig> = {},
): SyntheticMonitorWorkerConfig {
  return {
    code: "return { data: true };",
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath: CHROMIUM_EXECUTABLE_PATH,
    viewport: { width: 1_366, height: 768 },
    timeoutInMs: 30_000,
    chromiumSandboxEnabled: true,
    args: {},
    ...overrides,
  };
}

function createFakeBrowser(
  failures: {
    newContext?: Error | undefined;
    newPage?: Error | undefined;
  } = {},
): FakeBrowser {
  const page: Page = { name: "tenant-page" } as unknown as Page;
  const newPage: jest.Mock<Promise<Page>, []> = jest.fn(
    async (): Promise<Page> => {
      if (failures.newPage) {
        throw failures.newPage;
      }
      return page;
    },
  );
  const context: BrowserContext = {
    name: "ephemeral-context",
    newPage,
  } as unknown as BrowserContext;
  const newContext: jest.Mock<
    Promise<BrowserContext>,
    [BrowserContextOptions]
  > = jest.fn(
    async (_options: BrowserContextOptions): Promise<BrowserContext> => {
      if (failures.newContext) {
        throw failures.newContext;
      }
      return context;
    },
  );
  const close: jest.Mock<Promise<void>, []> = jest.fn(
    async (): Promise<void> => {
      // Closes immediately unless a test says otherwise.
    },
  );
  const browser: Browser = {
    name: "launched-browser",
    newContext,
    close,
  } as unknown as Browser;

  return { browser, context, page, newContext, newPage, close };
}

/*
 * Playwright's real shape: an API-prefixed message, and a stack that repeats
 * it with internal file paths. Neither half may reach the tenant.
 */
function playwrightError(message: string): Error {
  const error: Error = new Error(message);
  error.stack = `${message}\n    at SyntheticBrowser.start (/usr/src/app/Utils/Monitors/SyntheticRuntime/SyntheticBrowser.ts:74:52)`;
  return error;
}

function launchOptionsOf(launcher: MockLauncher): LaunchOptions {
  expect(launcher.launch).toHaveBeenCalledTimes(1);
  return launcher.launch.mock.calls[0]![0];
}

async function startExpectingFailure(
  config: SyntheticMonitorWorkerConfig,
  onLaunched?: (browser: Browser) => void,
): Promise<SyntheticRuntimeFault> {
  return await SyntheticBrowser.start({ config, onLaunched }).then(
    (): SyntheticRuntimeFault => {
      throw new Error("Expected SyntheticBrowser.start to fail.");
    },
    (error: SyntheticRuntimeFault): SyntheticRuntimeFault => {
      return error;
    },
  );
}

function captureTimers(): CapturedTimer[] {
  const timers: CapturedTimer[] = [];
  jest.spyOn(global, "setTimeout").mockImplementation(((
    callback: () => void,
    delayInMs?: number,
  ): NodeJS.Timeout => {
    const handle: NodeJS.Timeout = {
      unref: (): NodeJS.Timeout => {
        return handle;
      },
    } as unknown as NodeJS.Timeout;
    timers.push({ callback, delayInMs, handle });
    return handle;
  }) as typeof global.setTimeout);
  jest.spyOn(global, "clearTimeout").mockImplementation(((): void => {
    // Captured timers never run on their own.
  }) as typeof global.clearTimeout);
  return timers;
}

// The egress proxy every SyntheticBrowser.start starts: the browser's only way out.
const EGRESS_PROXY_SERVER: RegExp = /^http:\/\/127\.0\.0\.1:\d+$/;

describe("SyntheticBrowser.start", () => {
  const startedEgresses: Array<SyntheticEgressProxy> = [];

  beforeEach(() => {
    for (const launcher of [mockChromium, mockFirefox]) {
      launcher.launch.mockReset();
      launcher.launchPersistentContext.mockReset();
    }

    const realStart: SyntheticEgressProxy["start"] =
      SyntheticEgressProxy.prototype.start;
    jest
      .spyOn(SyntheticEgressProxy.prototype, "start")
      .mockImplementation(async function (
        this: SyntheticEgressProxy,
      ): Promise<void> {
        startedEgresses.push(this);
        await realStart.call(this);
      });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    while (startedEgresses.length > 0) {
      await startedEgresses.pop()!.close();
    }
  });

  beforeEach(() => {
    /*
     * The no-sync library exists only inside the probe image. Every test
     * starts without it, so no launch option depends on the machine running
     * the suite; the tests about the preload opt in.
     */
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
  });

  test.each([true, false])(
    "launches Chromium with launch() and chromiumSandbox %s, never on a persistent profile",
    async (chromiumSandboxEnabled: boolean) => {
      const fake: FakeBrowser = createFakeBrowser();
      mockChromium.launch.mockResolvedValue(fake.browser);

      await SyntheticBrowser.start({
        config: createConfig({ chromiumSandboxEnabled }),
      });

      expect(launchOptionsOf(mockChromium)).toStrictEqual({
        executablePath: CHROMIUM_EXECUTABLE_PATH,
        proxy: {
          server: expect.stringMatching(EGRESS_PROXY_SERVER),
          bypass: CHROMIUM_PROXY_BYPASS,
        },
        chromiumSandbox: chromiumSandboxEnabled,
        args: [...CHROMIUM_EGRESS_ARGUMENTS],
      });
      // The on-disk profile is what stalled the bootstrap on slow storage.
      expect(mockChromium.launchPersistentContext).not.toHaveBeenCalled();
      expect(mockFirefox.launch).not.toHaveBeenCalled();
      expect(mockFirefox.launchPersistentContext).not.toHaveBeenCalled();
    },
  );

  test("launches Firefox with launch() and no Chromium-only sandbox option", async () => {
    const fake: FakeBrowser = createFakeBrowser();
    mockFirefox.launch.mockResolvedValue(fake.browser);

    await SyntheticBrowser.start({
      config: createConfig({
        browserType: BrowserType.Firefox,
        executablePath: FIREFOX_EXECUTABLE_PATH,
        chromiumSandboxEnabled: true,
      }),
    });

    expect(launchOptionsOf(mockFirefox)).toStrictEqual({
      executablePath: FIREFOX_EXECUTABLE_PATH,
      // No bypass list: Firefox reads its entries as bare host suffixes.
      proxy: { server: expect.stringMatching(EGRESS_PROXY_SERVER) },
      firefoxUserPrefs: { ...FIREFOX_EGRESS_PREFERENCES },
    });
    expect(mockFirefox.launchPersistentContext).not.toHaveBeenCalled();
    expect(mockChromium.launch).not.toHaveBeenCalled();
    expect(mockChromium.launchPersistentContext).not.toHaveBeenCalled();
  });

  describe("no-sync library", () => {
    const firefoxConfig: () => SyntheticMonitorWorkerConfig =
      (): SyntheticMonitorWorkerConfig => {
        return createConfig({
          browserType: BrowserType.Firefox,
          executablePath: FIREFOX_EXECUTABLE_PATH,
        });
      };

    function provideLibrary(): jest.SpyInstance {
      return jest
        .spyOn(fs, "existsSync")
        .mockImplementation((file: fs.PathLike): boolean => {
          return file === FIREFOX_NO_SYNC_LIBRARY_PATH;
        });
    }

    test("preloads it into Firefox when the image provides it", async () => {
      provideLibrary();
      mockFirefox.launch.mockResolvedValue(createFakeBrowser().browser);

      await SyntheticBrowser.start({ config: firefoxConfig() });

      const options: LaunchOptions = launchOptionsOf(mockFirefox);
      expect(Object.keys(options).sort()).toEqual([
        "env",
        "executablePath",
        "firefoxUserPrefs",
        "proxy",
      ]);
      expect(options.env?.["LD_PRELOAD"]).toBe(FIREFOX_NO_SYNC_LIBRARY_PATH);
    });

    test("hands Firefox the worker's own environment alongside the preload", async () => {
      /*
       * Playwright gives the browser this environment instead of the
       * worker's, so anything ProcessRunner allowed through -- PATH, proxy
       * settings, CA bundles -- must still reach it.
       */
      provideLibrary();
      mockFirefox.launch.mockResolvedValue(createFakeBrowser().browser);
      const previous: string | undefined = process.env["NODE_EXTRA_CA_CERTS"];
      process.env["NODE_EXTRA_CA_CERTS"] = "/etc/ssl/probe/extra.pem";

      try {
        await SyntheticBrowser.start({ config: firefoxConfig() });
      } finally {
        if (previous === undefined) {
          delete process.env["NODE_EXTRA_CA_CERTS"];
        } else {
          process.env["NODE_EXTRA_CA_CERTS"] = previous;
        }
      }

      const env: LaunchOptions["env"] = launchOptionsOf(mockFirefox).env;
      expect(env?.["NODE_EXTRA_CA_CERTS"]).toBe("/etc/ssl/probe/extra.pem");
      expect(env?.["PATH"]).toBe(process.env["PATH"]);
    });

    test("replaces any preload already in the worker's environment", async () => {
      provideLibrary();
      mockFirefox.launch.mockResolvedValue(createFakeBrowser().browser);
      process.env["LD_PRELOAD"] = "/tmp/not-ours.so";

      try {
        await SyntheticBrowser.start({ config: firefoxConfig() });
      } finally {
        delete process.env["LD_PRELOAD"];
      }

      expect(launchOptionsOf(mockFirefox).env?.["LD_PRELOAD"]).toBe(
        FIREFOX_NO_SYNC_LIBRARY_PATH,
      );
    });

    test("launches Firefox exactly as before when the library is absent", async () => {
      mockFirefox.launch.mockResolvedValue(createFakeBrowser().browser);

      await SyntheticBrowser.start({ config: firefoxConfig() });

      expect(launchOptionsOf(mockFirefox)).not.toHaveProperty("env");
      expect(fs.existsSync).toHaveBeenCalledWith(FIREFOX_NO_SYNC_LIBRARY_PATH);
    });

    test.each([true, false])(
      "is never preloaded into Chromium (chromiumSandbox %s)",
      async (chromiumSandboxEnabled: boolean) => {
        const existsSync: jest.SpyInstance = provideLibrary();
        mockChromium.launch.mockResolvedValue(createFakeBrowser().browser);

        await SyntheticBrowser.start({
          config: createConfig({ chromiumSandboxEnabled }),
        });

        expect(launchOptionsOf(mockChromium)).not.toHaveProperty("env");
        expect(existsSync).not.toHaveBeenCalled();
      },
    );
  });

  /*
   * GHSA-9rx7-vwfj-whp7: the browser's only proxy is the check's egress
   * proxy, which holds every request to the probe's egress policy and goes
   * through the operator's outbound proxy itself. The operator's proxy, its
   * credentials and its NO_PROXY list are never handed to the browser: a
   * NO_PROXY entry would let the browser connect around the guard.
   */
  describe("egress", () => {
    const operatorProxy: SyntheticMonitorWorkerConfig["proxy"] = {
      server: "http://proxy.internal:3128",
      username: "probe",
      password: "s3cret",
      bypass: "synthetic-runtime.oneuptime.invalid,localhost,.internal",
    };

    test.each([
      { label: "Chromium", browserType: BrowserType.Chromium },
      { label: "Firefox", browserType: BrowserType.Firefox },
    ])(
      "sends $label through the check's egress proxy and nowhere else, whatever proxy the operator set",
      async ({ browserType }: { label: string; browserType: BrowserType }) => {
        const launcher: MockLauncher =
          browserType === BrowserType.Chromium ? mockChromium : mockFirefox;
        launcher.launch.mockResolvedValue(createFakeBrowser().browser);

        const session: SyntheticBrowserSession = await SyntheticBrowser.start({
          config: createConfig({
            browserType,
            executablePath:
              browserType === BrowserType.Chromium
                ? CHROMIUM_EXECUTABLE_PATH
                : FIREFOX_EXECUTABLE_PATH,
            proxy: operatorProxy,
          }),
        });

        const proxy: LaunchOptions["proxy"] = launchOptionsOf(launcher).proxy;
        expect(proxy).toStrictEqual(
          browserType === BrowserType.Chromium
            ? {
                server: session.egress.getProxyServer(),
                bypass: CHROMIUM_PROXY_BYPASS,
              }
            : { server: session.egress.getProxyServer() },
        );
        expect(JSON.stringify(launchOptionsOf(launcher))).not.toContain(
          "proxy.internal",
        );
        expect(JSON.stringify(launchOptionsOf(launcher))).not.toContain(
          "s3cret",
        );
        // NO_PROXY's hosts are the egress proxy's to reach directly, never the browser's.
        expect(JSON.stringify(launchOptionsOf(launcher))).not.toContain(
          ".internal",
        );
      },
    );

    /*
     * Chromium reads each entry as an exact host, never a suffix, and an
     * empty one would match nothing; the controller host is the one name it
     * may reach without the egress proxy, and Chromium resolves no name
     * itself. What the browsers actually send past the proxy - WebRTC UDP,
     * look-alike hosts - is tested in real browsers (SyntheticEgressBrowser).
     */
    test("lets Chromium past the egress proxy for the runtime's own host alone, and proxies its loopback", () => {
      expect(CHROMIUM_PROXY_BYPASS.split(",")).toEqual([
        "synthetic-runtime.oneuptime.invalid",
        "<-loopback>",
      ]);
    });

    test.each([
      { label: "left out", config: createConfig() },
      { label: "undefined", config: createConfig({ proxy: undefined }) },
    ])(
      "sends the browser through the egress proxy when the operator's proxy is $label",
      async ({
        config,
      }: {
        label: string;
        config: SyntheticMonitorWorkerConfig;
      }) => {
        mockChromium.launch.mockResolvedValue(createFakeBrowser().browser);

        const session: SyntheticBrowserSession = await SyntheticBrowser.start({
          config,
        });

        expect(launchOptionsOf(mockChromium).proxy).toStrictEqual({
          server: session.egress.getProxyServer(),
          bypass: CHROMIUM_PROXY_BYPASS,
        });
      },
    );

    test("starts the egress proxy, on loopback, before the browser", async () => {
      let proxyWhenLaunched: string | undefined;
      mockChromium.launch.mockImplementation(
        async (options: LaunchOptions): Promise<Browser> => {
          proxyWhenLaunched = options.proxy?.server;
          return createFakeBrowser().browser;
        },
      );

      const session: SyntheticBrowserSession = await SyntheticBrowser.start({
        config: createConfig(),
      });

      expect(proxyWhenLaunched).toMatch(EGRESS_PROXY_SERVER);
      expect(proxyWhenLaunched).toBe(session.egress.getProxyServer());
      // It is listening: the browser can reach it.
      const reply: string = await new Promise<string>(
        (resolve: (value: string) => void): void => {
          const socket: net.Socket = net.connect({
            host: "127.0.0.1",
            port: session.egress.getPort(),
          });
          let text: string = "";
          socket.on("data", (chunk: Buffer): void => {
            text += chunk.toString("latin1");
          });
          socket.on("close", (): void => {
            resolve(text);
          });
          socket.write(
            "CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254:80\r\n\r\n",
          );
        },
      );
      expect(reply).toContain("403 Forbidden");
    });

    test.each([
      {
        label: "the probe's policy, private addresses allowed",
        egressPolicy: {
          allowPrivateNetworkAddresses: true,
          privateNetworkHint: "",
        },
        expected: {
          allowPrivateNetworkAddresses: true,
          privateNetworkHint: "",
        },
      },
      {
        label: "the probe's policy, private addresses refused",
        egressPolicy: {
          allowPrivateNetworkAddresses: false,
          privateNetworkHint: " Ask the operator.",
        },
        expected: {
          allowPrivateNetworkAddresses: false,
          privateNetworkHint: " Ask the operator.",
        },
      },
      {
        label: "public addresses only when the check says nothing",
        egressPolicy: undefined,
        expected: {
          allowPrivateNetworkAddresses: false,
          privateNetworkHint: "",
        },
      },
    ])(
      "holds the egress proxy to $label",
      async ({
        egressPolicy,
        expected,
      }: {
        label: string;
        egressPolicy: SyntheticMonitorWorkerConfig["egressPolicy"];
        expected: SyntheticMonitorWorkerConfig["egressPolicy"];
      }) => {
        mockChromium.launch.mockResolvedValue(createFakeBrowser().browser);

        const session: SyntheticBrowserSession = await SyntheticBrowser.start({
          config: createConfig({ egressPolicy }),
        });

        expect(session.egress.getPolicy()).toEqual(expected);
      },
    );

    test("closes the egress proxy when the browser cannot start", async () => {
      const close: ReturnType<typeof jest.spyOn> = jest.spyOn(
        SyntheticEgressProxy.prototype,
        "close",
      );
      mockChromium.launch.mockRejectedValue(playwrightError("launch failed"));

      await startExpectingFailure(createConfig());

      expect(close).toHaveBeenCalledTimes(1);
    });

    /*
     * The worker's config check reads only the scheme; a URL past it that
     * still cannot be parsed used to leave the egress proxy with no outbound
     * proxy, and the check went direct, around the operator's proxy.
     */
    test.each([
      "http://[not-an-address/",
      "http://proxy.internal:99999",
      "http://probe:s3cret@proxy internal:3128",
    ])(
      "is the probe's fault, and starts no browser, when the outbound proxy %s cannot be read",
      async (server: string) => {
        const start: ReturnType<typeof jest.spyOn> = jest.spyOn(
          SyntheticEgressProxy.prototype,
          "start",
        );

        const fault: SyntheticRuntimeFault = await startExpectingFailure(
          createConfig({ proxy: { server } }),
        );

        expect(isSyntheticRuntimeFault(fault)).toBe(true);
        expect(fault.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
        expect(fault.message).toBe(
          "Synthetic monitor could not start on this probe: the probe's outbound proxy setting could not be read. The monitored page was never opened, so this does not reflect the health of the monitored site.",
        );
        // The setting itself, which may hold the proxy's password, is not repeated.
        expect(
          `${fault.message} ${String(fault.internalDetail)}`,
        ).not.toContain("s3cret");
        expect(start).not.toHaveBeenCalled();
        expect(mockChromium.launch).not.toHaveBeenCalled();
      },
    );
  });

  test("opens the tenant page in an ephemeral context that refuses downloads", async () => {
    const fake: FakeBrowser = createFakeBrowser();
    mockChromium.launch.mockResolvedValue(fake.browser);

    const session: SyntheticBrowserSession = await SyntheticBrowser.start({
      config: createConfig({ viewport: { width: 414, height: 896 } }),
    });

    expect(fake.newContext).toHaveBeenCalledTimes(1);
    expect(fake.newContext.mock.calls[0]![0]).toStrictEqual({
      acceptDownloads: false,
      viewport: { width: 414, height: 896 },
    });
    expect(fake.newPage).toHaveBeenCalledTimes(1);
    expect(session.browser).toBe(fake.browser);
    expect(session.browserContext).toBe(fake.context);
    expect(session.page).toBe(fake.page);
  });

  describe("onLaunched", () => {
    test("receives the browser before the context is created", async () => {
      /*
       * The worker closes whatever browser it was told about when a signal
       * arrives. Hearing about the browser only once the page is open would
       * leave one that is still creating its context with nobody to close it.
       */
      const fake: FakeBrowser = createFakeBrowser();
      mockChromium.launch.mockResolvedValue(fake.browser);
      const onLaunched: jest.Mock<void, [Browser]> = jest.fn(
        (_browser: Browser): void => {
          expect(fake.newContext).not.toHaveBeenCalled();
        },
      );

      await SyntheticBrowser.start({ config: createConfig(), onLaunched });

      expect(onLaunched).toHaveBeenCalledTimes(1);
      expect(onLaunched.mock.calls[0]![0]).toBe(fake.browser);
      expect(fake.newContext).toHaveBeenCalledTimes(1);
    });

    test.each([
      { label: "context", failures: { newContext: new Error("no context") } },
      { label: "page", failures: { newPage: new Error("no page") } },
    ])(
      "still receives the browser when the $label cannot be created, so the caller can close it",
      async ({
        failures,
      }: {
        label: string;
        failures: { newContext?: Error; newPage?: Error };
      }) => {
        const fake: FakeBrowser = createFakeBrowser(failures);
        mockChromium.launch.mockResolvedValue(fake.browser);
        const launchedBrowsers: Browser[] = [];

        await startExpectingFailure(
          createConfig(),
          (browser: Browser): void => {
            launchedBrowsers.push(browser);
          },
        );

        expect(launchedBrowsers).toEqual([fake.browser]);
      },
    );

    test("is not called when no browser was launched", async () => {
      mockChromium.launch.mockRejectedValue(playwrightError("launch failed"));
      const onLaunched: jest.Mock<void, [Browser]> = jest.fn();

      await startExpectingFailure(createConfig(), onLaunched);

      expect(onLaunched).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    const cases: Array<{
      label: string;
      browserType: BrowserType;
      executablePath: string;
      playwrightMessage: string;
      arrange: (launcher: MockLauncher, error: Error) => void;
    }> = [];

    for (const browserType of [BrowserType.Chromium, BrowserType.Firefox]) {
      const executablePath: string =
        browserType === BrowserType.Chromium
          ? CHROMIUM_EXECUTABLE_PATH
          : FIREFOX_EXECUTABLE_PATH;

      cases.push(
        {
          label: `${browserType} launch rejects`,
          browserType,
          executablePath,
          playwrightMessage: `browserType.launch: Failed to launch ${browserType.toLowerCase()} because executable doesn't exist at ${executablePath}`,
          arrange: (launcher: MockLauncher, error: Error): void => {
            launcher.launch.mockRejectedValue(error);
          },
        },
        {
          label: `${browserType} newContext rejects`,
          browserType,
          executablePath,
          playwrightMessage:
            "browser.newContext: Target page, context or browser has been closed",
          arrange: (launcher: MockLauncher, error: Error): void => {
            launcher.launch.mockResolvedValue(
              createFakeBrowser({ newContext: error }).browser,
            );
          },
        },
        {
          label: `${browserType} newPage rejects`,
          browserType,
          executablePath,
          playwrightMessage:
            "browserContext.newPage: Protocol error (Target.createTarget): Target closed",
          arrange: (launcher: MockLauncher, error: Error): void => {
            launcher.launch.mockResolvedValue(
              createFakeBrowser({ newPage: error }).browser,
            );
          },
        },
      );
    }

    test.each(cases)(
      "reports a probe-side runtime fault when $label",
      async ({
        browserType,
        executablePath,
        playwrightMessage,
        arrange,
      }: {
        label: string;
        browserType: BrowserType;
        executablePath: string;
        playwrightMessage: string;
        arrange: (launcher: MockLauncher, error: Error) => void;
      }) => {
        arrange(
          browserType === BrowserType.Chromium ? mockChromium : mockFirefox,
          playwrightError(playwrightMessage),
        );

        const fault: SyntheticRuntimeFault = await startExpectingFailure(
          createConfig({ browserType, executablePath }),
        );

        /*
         * Nothing tenant-authored ran and the site was never contacted, so
         * this must be marked as the probe's fault: it is retried in a fresh
         * worker and never pages anyone as the tenant's script error.
         */
        expect(fault).toBeInstanceOf(SyntheticRuntimeFault);
        expect(isSyntheticRuntimeFault(fault)).toBe(true);
        expect(fault.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
        expect(fault.name).toBe("SyntheticRuntimeFault");

        // What the tenant reads on their monitor...
        expect(fault.message).toContain(
          `the ${browserType} browser did not start`,
        );
        expect(fault.message).toContain("could not start on this probe");
        expect(fault.message).toContain(
          "does not reflect the health of the monitored site",
        );
        expect(fault.message).not.toContain(playwrightMessage);
        expect(fault.message).not.toContain(executablePath);
        expect(fault.message).not.toContain("SyntheticBrowser.ts");

        // ...and what the probe's own logs keep.
        expect(fault.internalDetail).toContain(playwrightMessage);
        expect(fault.internalDetail).toContain(
          "/usr/src/app/Utils/Monitors/SyntheticRuntime/SyntheticBrowser.ts:74:52",
        );
      },
    );
  });
});

describe("SyntheticBrowser.close", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("waits for the browser to finish closing", async () => {
    const fake: FakeBrowser = createFakeBrowser();
    let hasClosed: boolean = false;
    fake.close.mockImplementation(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void): void => {
        setImmediate(resolve);
      });
      hasClosed = true;
    });

    await SyntheticBrowser.close({
      browser: fake.browser,
      timeoutInMs: 60_000,
    });

    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(hasClosed).toBe(true);
  });

  test("returns once timeoutInMs has passed when the browser never finishes closing", async () => {
    /*
     * A browser on slow storage takes half a minute to flush its profile on
     * close. The worker has already replied by then; closing must never be
     * what it waits on.
     */
    const fake: FakeBrowser = createFakeBrowser();
    fake.close.mockImplementation((): Promise<void> => {
      return new Promise<void>((): void => {
        // Never settles.
      });
    });
    const startedAtInMs: number = Date.now();

    await SyntheticBrowser.close({ browser: fake.browser, timeoutInMs: 50 });

    const elapsedInMs: number = Date.now() - startedAtInMs;
    expect(elapsedInMs).toBeGreaterThanOrEqual(45);
    expect(elapsedInMs).toBeLessThan(SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS);
  }, 10_000);

  test("swallows a close that rejects", async () => {
    const fake: FakeBrowser = createFakeBrowser();
    fake.close.mockRejectedValue(
      playwrightError(
        "browser.close: Target page, context or browser has been closed",
      ),
    );

    await expect(
      SyntheticBrowser.close({ browser: fake.browser, timeoutInMs: 60_000 }),
    ).resolves.toBeUndefined();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  test("waits SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS by default", async () => {
    expect(Number.isSafeInteger(SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS)).toBe(
      true,
    );
    expect(SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS).toBeGreaterThan(0);

    const fake: FakeBrowser = createFakeBrowser();
    fake.close.mockImplementation((): Promise<void> => {
      return new Promise<void>((): void => {
        // Never settles.
      });
    });
    const timers: CapturedTimer[] = captureTimers();
    let hasReturned: boolean = false;

    const closing: Promise<void> = SyntheticBrowser.close({
      browser: fake.browser,
    }).then((): void => {
      hasReturned = true;
    });

    expect(
      timers.map((timer: CapturedTimer): number | undefined => {
        return timer.delayInMs;
      }),
    ).toEqual([SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS]);
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });
    expect(hasReturned).toBe(false);

    timers[0]!.callback();
    await closing;

    expect(hasReturned).toBe(true);
    expect(global.clearTimeout).toHaveBeenCalledWith(timers[0]!.handle);
  });

  test("clears its timer when the browser closes in time", async () => {
    const fake: FakeBrowser = createFakeBrowser();
    const timers: CapturedTimer[] = captureTimers();

    await SyntheticBrowser.close({ browser: fake.browser });

    expect(timers).toHaveLength(1);
    expect(global.clearTimeout).toHaveBeenCalledWith(timers[0]!.handle);
  });

  test("closes the egress proxy after the browser, even when the browser never finishes closing", async () => {
    const order: Array<string> = [];
    const fake: FakeBrowser = createFakeBrowser();
    fake.close.mockImplementation((): Promise<void> => {
      order.push("browser");
      return new Promise<void>((): void => {
        // Never settles.
      });
    });
    const egress: SyntheticEgressProxy = new SyntheticEgressProxy();
    await egress.start();
    const close: ReturnType<typeof jest.spyOn> = jest
      .spyOn(egress, "close")
      .mockImplementation(async (): Promise<void> => {
        order.push("egress");
      });

    await SyntheticBrowser.close({
      browser: fake.browser,
      egress,
      timeoutInMs: 20,
    });

    expect(order).toEqual(["browser", "egress"]);
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
    await egress.close();
  });
});

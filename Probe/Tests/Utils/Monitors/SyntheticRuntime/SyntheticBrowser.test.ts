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
  SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS,
  SyntheticBrowserSession,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";
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

describe("SyntheticBrowser.start", () => {
  beforeEach(() => {
    for (const launcher of [mockChromium, mockFirefox]) {
      launcher.launch.mockReset();
      launcher.launchPersistentContext.mockReset();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
        chromiumSandbox: chromiumSandboxEnabled,
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
    });
    expect(mockFirefox.launchPersistentContext).not.toHaveBeenCalled();
    expect(mockChromium.launch).not.toHaveBeenCalled();
    expect(mockChromium.launchPersistentContext).not.toHaveBeenCalled();
  });

  describe("proxy", () => {
    test("passes only the server when no credentials or bypass list are set", async () => {
      mockChromium.launch.mockResolvedValue(createFakeBrowser().browser);

      await SyntheticBrowser.start({
        config: createConfig({
          proxy: { server: "http://proxy.internal:3128" },
        }),
      });

      expect(launchOptionsOf(mockChromium)).toStrictEqual({
        executablePath: CHROMIUM_EXECUTABLE_PATH,
        chromiumSandbox: true,
        proxy: { server: "http://proxy.internal:3128" },
      });
    });

    test("passes the username, password and bypass list when they are set", async () => {
      mockFirefox.launch.mockResolvedValue(createFakeBrowser().browser);

      await SyntheticBrowser.start({
        config: createConfig({
          browserType: BrowserType.Firefox,
          executablePath: FIREFOX_EXECUTABLE_PATH,
          proxy: {
            server: "http://proxy.internal:3128",
            username: "probe",
            password: "s3cret",
            bypass: "localhost,.internal",
          },
        }),
      });

      expect(launchOptionsOf(mockFirefox)).toStrictEqual({
        executablePath: FIREFOX_EXECUTABLE_PATH,
        proxy: {
          server: "http://proxy.internal:3128",
          username: "probe",
          password: "s3cret",
          bypass: "localhost,.internal",
        },
      });
    });

    test("omits proxy fields that are present but undefined", async () => {
      /*
       * Playwright's option types are written for exactOptionalPropertyTypes:
       * a key set to undefined is not the same as a key left out, so an
       * undefined credential must not be forwarded as one.
       */
      mockChromium.launch.mockResolvedValue(createFakeBrowser().browser);

      await SyntheticBrowser.start({
        config: createConfig({
          proxy: {
            server: "http://proxy.internal:3128",
            username: "probe",
            password: undefined,
            bypass: undefined,
          },
        }),
      });

      const proxy: LaunchOptions["proxy"] = launchOptionsOf(mockChromium).proxy;
      expect(proxy).toStrictEqual({
        server: "http://proxy.internal:3128",
        username: "probe",
      });
      expect(Object.keys(proxy as Record<string, unknown>)).toEqual([
        "server",
        "username",
      ]);
    });

    test.each([
      { label: "left out", config: createConfig() },
      { label: "undefined", config: createConfig({ proxy: undefined }) },
    ])(
      "sets no proxy option at all when the proxy is $label",
      async ({
        config,
      }: {
        label: string;
        config: SyntheticMonitorWorkerConfig;
      }) => {
        mockChromium.launch.mockResolvedValue(createFakeBrowser().browser);

        await SyntheticBrowser.start({ config });

        expect(launchOptionsOf(mockChromium)).not.toHaveProperty("proxy");
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
});

import { PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import VMRunner from "Common/Server/Utils/VM/VMRunner";
import { Browser, BrowserContext, Page, chromium, firefox } from "playwright";
import LocalFile from "Common/Server/Utils/LocalFile";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
}

interface BrowserLaunchOptions {
  executablePath?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
    bypass?: string;
  };
  args?: string[];
  headless?: boolean;
  devtools?: boolean;
  timeout?: number;
}

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export default class SyntheticMonitor {
  public static async execute(
    options: SyntheticMonitorOptions,
  ): Promise<Array<SyntheticMonitorResponse> | null> {
    const results: Array<SyntheticMonitorResponse> = [];

    for (const browserType of options.browserTypes || []) {
      for (const screenSizeType of options.screenSizeTypes || []) {
        logger.debug(
          `Running Synthetic Monitor: ${options?.monitorId?.toString()}, Screen Size: ${screenSizeType}, Browser: ${browserType}`,
        );

        const result: SyntheticMonitorResponse | null =
          await this.executeByBrowserAndScreenSize({
            script: options.script,
            browserType: browserType,
            screenSizeType: screenSizeType,
          });

        if (result) {
          result.browserType = browserType;
          result.screenSizeType = screenSizeType;
          results.push(result);
        }
      }
    }

    return results;
  }

  private static async executeByBrowserAndScreenSize(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<SyntheticMonitorResponse | null> {
    if (!options) {
      // this should never happen
      options = {
        script: "",
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      };
    }

    const scriptResult: SyntheticMonitorResponse = {
      logMessages: [],
      scriptError: undefined,
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
    };

    let browserSession: BrowserSession | null = null;

    try {
      let result: ReturnResult | null = null;

      const startTime: [number, number] = process.hrtime();

      browserSession = await SyntheticMonitor.getPageByBrowserType({
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

      if (!browserSession) {
        throw new BadDataException(
          "Could not create Playwright browser session",
        );
      }

      result = await VMRunner.runCodeInSandbox({
        code: options.script,
        options: {
          timeout: PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
          args: {},
          context: {
            browser: browserSession.browser,
            page: browserSession.page,
            screenSizeType: options.screenSizeType,
            browserType: options.browserType,
          },
        },
      });

      const endTime: [number, number] = process.hrtime(startTime);

      const executionTimeInMS: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      scriptResult.executionTimeInMS = executionTimeInMS;

      scriptResult.logMessages = result.logMessages;

      if (result.returnValue?.screenshots) {
        if (!scriptResult.screenshots) {
          scriptResult.screenshots = {};
        }

        for (const screenshotName in result.returnValue.screenshots) {
          if (!result.returnValue.screenshots[screenshotName]) {
            continue;
          }

          // check if this is of type Buffer. If it is not, continue.

          if (
            !(result.returnValue.screenshots[screenshotName] instanceof Buffer)
          ) {
            continue;
          }

          const screenshotBuffer: Buffer = result.returnValue.screenshots[
            screenshotName
          ] as Buffer;
          scriptResult.screenshots[screenshotName] =
            screenshotBuffer.toString("base64"); // convert screenshots to base 64
        }
      }

      scriptResult.result = result?.returnValue?.data;
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
    } finally {
      // Always dispose browser session to prevent zombie processes
      await SyntheticMonitor.disposeBrowserSession(browserSession);
    }

    return scriptResult;
  }

  private static getViewportHeightAndWidth(options: {
    screenSizeType: ScreenSizeType;
  }): {
    height: number;
    width: number;
  } {
    let viewPortHeight: number = 0;
    let viewPortWidth: number = 0;

    switch (options.screenSizeType) {
      case ScreenSizeType.Desktop:
        viewPortHeight = 1080;
        viewPortWidth = 1920;
        break;
      case ScreenSizeType.Mobile:
        viewPortHeight = 640;
        viewPortWidth = 360;
        break;
      case ScreenSizeType.Tablet:
        viewPortHeight = 768;
        viewPortWidth = 1024;
        break;
      default:
        viewPortHeight = 1080;
        viewPortWidth = 1920;
        break;
    }

    return { height: viewPortHeight, width: viewPortWidth };
  }

  public static async getChromeExecutablePath(): Promise<string> {
    const doesDirectoryExist: boolean = await LocalFile.doesDirectoryExist(
      "/root/.cache/ms-playwright",
    );
    if (!doesDirectoryExist) {
      throw new BadDataException("Chrome executable path not found.");
    }

    // get list of files in the directory
    const directories: string[] = await LocalFile.getListOfDirectories(
      "/root/.cache/ms-playwright",
    );

    if (directories.length === 0) {
      throw new BadDataException("Chrome executable path not found.");
    }

    const chromeInstallationName: string | undefined = directories.find(
      (directory: string) => {
        return directory.includes("chromium");
      },
    );

    if (!chromeInstallationName) {
      throw new BadDataException("Chrome executable path not found.");
    }

    const chromeExecutableCandidates: Array<string> = [
      `/root/.cache/ms-playwright/${chromeInstallationName}/chrome-linux/chrome`,
      `/root/.cache/ms-playwright/${chromeInstallationName}/chrome-linux64/chrome`,
      `/root/.cache/ms-playwright/${chromeInstallationName}/chrome64/chrome`,
      `/root/.cache/ms-playwright/${chromeInstallationName}/chrome/chrome`,
    ];

    for (const executablePath of chromeExecutableCandidates) {
      if (await LocalFile.doesFileExist(executablePath)) {
        return executablePath;
      }
    }

    throw new BadDataException("Chrome executable path not found.");
  }

  public static async getFirefoxExecutablePath(): Promise<string> {
    const doesDirectoryExist: boolean = await LocalFile.doesDirectoryExist(
      "/root/.cache/ms-playwright",
    );
    if (!doesDirectoryExist) {
      throw new BadDataException("Firefox executable path not found.");
    }

    // get list of files in the directory
    const directories: string[] = await LocalFile.getListOfDirectories(
      "/root/.cache/ms-playwright",
    );

    if (directories.length === 0) {
      throw new BadDataException("Firefox executable path not found.");
    }

    const firefoxInstallationName: string | undefined = directories.find(
      (directory: string) => {
        return directory.includes("firefox");
      },
    );

    if (!firefoxInstallationName) {
      throw new BadDataException("Firefox executable path not found.");
    }

    const firefoxExecutableCandidates: Array<string> = [
      `/root/.cache/ms-playwright/${firefoxInstallationName}/firefox/firefox`,
      `/root/.cache/ms-playwright/${firefoxInstallationName}/firefox-linux64/firefox`,
      `/root/.cache/ms-playwright/${firefoxInstallationName}/firefox64/firefox`,
      `/root/.cache/ms-playwright/${firefoxInstallationName}/firefox-64/firefox`,
    ];

    for (const executablePath of firefoxExecutableCandidates) {
      if (await LocalFile.doesFileExist(executablePath)) {
        return executablePath;
      }
    }

    throw new BadDataException("Firefox executable path not found.");
  }

  private static async getPageByBrowserType(data: {
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<BrowserSession> {
    const viewport: {
      height: number;
      width: number;
    } = SyntheticMonitor.getViewportHeightAndWidth({
      screenSizeType: data.screenSizeType,
    });

    // Prepare browser launch options with proxy support
    const baseOptions: BrowserLaunchOptions = {};

    // Configure proxy if available
    if (ProxyConfig.isProxyConfigured()) {
      const httpsProxyUrl: string | null = ProxyConfig.getHttpsProxyUrl();
      const httpProxyUrl: string | null = ProxyConfig.getHttpProxyUrl();

      // Prefer HTTPS proxy, fall back to HTTP proxy
      const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;

      if (proxyUrl) {
        baseOptions.proxy = {
          server: proxyUrl,
        };

        // Extract username and password if present in proxy URL
        try {
          const parsedUrl: globalThis.URL = new URL(proxyUrl);
          if (parsedUrl.username && parsedUrl.password) {
            baseOptions.proxy.username = parsedUrl.username;
            baseOptions.proxy.password = parsedUrl.password;
          }
        } catch (error) {
          logger.warn(`Failed to parse proxy URL for authentication: ${error}`);
        }

        logger.debug(
          `Synthetic Monitor using proxy: ${proxyUrl} (HTTPS: ${Boolean(httpsProxyUrl)}, HTTP: ${Boolean(httpProxyUrl)})`,
        );
      }
    }

    if (data.browserType === BrowserType.Chromium) {
      const browser: Browser = await chromium.launch({
        executablePath: await this.getChromeExecutablePath(),
        ...baseOptions,
      });

      const context: BrowserContext = await browser.newContext({
        viewport: {
          width: viewport.width,
          height: viewport.height,
        },
      });

      const page: Page = await context.newPage();

      return {
        browser,
        context,
        page,
      };
    }

    if (data.browserType === BrowserType.Firefox) {
      const browser: Browser = await firefox.launch({
        executablePath: await this.getFirefoxExecutablePath(),
        ...baseOptions,
      });

      let context: BrowserContext | null = null;

      try {
        context = await browser.newContext({
          viewport: {
            width: viewport.width,
            height: viewport.height,
          },
        });

        const page: Page = await context.newPage();

        return {
          browser,
          context,
          page,
        };
      } catch (error) {
        await SyntheticMonitor.safeCloseBrowserContext(context);
        await SyntheticMonitor.safeCloseBrowser(browser);
        throw error;
      }
    }

    throw new BadDataException("Invalid Browser Type.");
  }

  private static async disposeBrowserSession(
    session: BrowserSession | null,
  ): Promise<void> {
    if (!session) {
      return;
    }

    await SyntheticMonitor.safeClosePage(session.page);
    await SyntheticMonitor.safeCloseBrowserContexts({
      browser: session.browser,
    });
    await SyntheticMonitor.safeCloseBrowser(session.browser);
  }

  private static async safeClosePage(page?: Page | null): Promise<void> {
    if (!page) {
      return;
    }

    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      logger.warn(
        `Failed to close Playwright page: ${(error as Error)?.message || error}`,
      );
    }
  }

  private static async safeCloseBrowserContext(
    context?: BrowserContext | null,
  ): Promise<void> {
    if (!context) {
      return;
    }

    try {
      await context.close();
    } catch (error) {
      logger.warn(
        `Failed to close Playwright browser context: ${(error as Error)?.message || error}`,
      );
    }
  }

  private static async safeCloseBrowser(
    browser?: Browser | null,
  ): Promise<void> {
    if (!browser) {
      return;
    }

    try {
      if (browser.isConnected()) {
        await browser.close();
      }
    } catch (error) {
      logger.warn(
        `Failed to close Playwright browser: ${(error as Error)?.message || error}`,
      );
    }
  }

  private static async safeCloseBrowserContexts(data: {
    browser: Browser;
  }): Promise<void> {
    if (!data.browser || !data.browser.contexts) {
      return;
    }

    const contexts: Array<BrowserContext> = data.browser.contexts();

    for (const context of contexts) {
      await SyntheticMonitor.safeCloseBrowserContext(context);
    }
  }
}

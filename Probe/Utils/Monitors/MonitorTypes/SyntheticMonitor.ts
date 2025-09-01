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
import { Browser, Page, chromium, firefox } from "playwright";
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

    try {
      let result: ReturnResult | null = null;

      let pageAndBrowser: {
        page: Page;
        browser: Browser;
      } | null = null;

      try {
        const startTime: [number, number] = process.hrtime();

        pageAndBrowser = await SyntheticMonitor.getPageByBrowserType({
          browserType: options.browserType,
          screenSizeType: options.screenSizeType,
        });

        result = await VMRunner.runCodeInSandbox({
          code: options.script,
          options: {
            timeout: PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
            args: {},
            context: {
              browser: pageAndBrowser.browser,
              page: pageAndBrowser.page,
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
              !(
                result.returnValue.screenshots[screenshotName] instanceof Buffer
              )
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
      } catch (err) {
        logger.error(err);
        scriptResult.scriptError =
          (err as Error)?.message || (err as Error).toString();
      }

      if (pageAndBrowser?.browser) {
        try {
          await pageAndBrowser.browser.close();
        } catch (err) {
          // if the browser is already closed, ignore the error
          logger.error(err);
        }
      }

      return scriptResult;
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
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

    return `/root/.cache/ms-playwright/${chromeInstallationName}/chrome-linux/chrome`;
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

    return `/root/.cache/ms-playwright/${firefoxInstallationName}/firefox/firefox`;
  }

  private static async getPageByBrowserType(data: {
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<{
    page: Page;
    browser: Browser;
  }> {
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

    let page: Page | null = null;
    let browser: Browser | null = null;

    if (data.browserType === BrowserType.Chromium) {
      browser = await chromium.launch({
        executablePath: await this.getChromeExecutablePath(),
        ...baseOptions,
      });
      page = await browser.newPage();
    }

    if (data.browserType === BrowserType.Firefox) {
      browser = await firefox.launch({
        executablePath: await this.getFirefoxExecutablePath(),
        ...baseOptions,
      });
      page = await browser.newPage();
    }

    // if (data.browserType === BrowserType.Webkit) {
    //     browser = await webkit.launch();
    //     page = await browser.newPage();
    // }

    await page?.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    if (!browser) {
      throw new BadDataException("Invalid Browser Type.");
    }

    if (!page) {
      // close the browser if page is not created
      await browser.close();
      throw new BadDataException("Invalid Browser Type.");
    }

    return {
      page: page,
      browser: browser,
    };
  }
}

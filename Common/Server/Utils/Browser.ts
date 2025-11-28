import {
  Page as PlaywrightPage,
  Browser as PlaywrightBrowser,
  chromium,
  firefox,
} from "playwright";
import LocalFile from "./LocalFile";
import BadDataException from "../../Types/Exception/BadDataException";
import ScreenSizeType from "../../Types/ScreenSizeType";
import BrowserType from "../../Types/BrowserType";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

export type Page = PlaywrightPage;
export type Browser = PlaywrightBrowser;

export default class BrowserUtil {
  @CaptureSpan()
  public static async convertHtmlToBase64Screenshot(data: {
    html: string;
  }): Promise<string | null> {
    try {
      const html: string = data.html;

      const pageAndBrowser: {
        page: Page;
        browser: Browser;
      } = await BrowserUtil.getPageByBrowserType({
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      });

      const page: Page = pageAndBrowser.page;
      const browser: Browser = pageAndBrowser.browser;
      await page.setContent(html, {
        waitUntil: "domcontentloaded",
      });
      const screenshot: Buffer = await page.screenshot({ type: "png" });

      await browser.close();

      return screenshot.toString("base64");
    } catch (e) {
      logger.debug(e);
      return null;
    }
  }

  @CaptureSpan()
  public static async getPageByBrowserType(data: {
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<{
    page: Page;
    browser: Browser;
  }> {
    const viewport: {
      height: number;
      width: number;
    } = BrowserUtil.getViewportHeightAndWidth({
      screenSizeType: data.screenSizeType,
    });

    let page: Page | null = null;
    let browser: Browser | null = null;

    if (data.browserType === BrowserType.Chromium) {
      browser = await chromium.launch({
        executablePath: await BrowserUtil.getChromeExecutablePath(),
      });
      page = await browser.newPage();
    }

    if (data.browserType === BrowserType.Firefox) {
      browser = await firefox.launch({
        executablePath: await BrowserUtil.getFirefoxExecutablePath(),
      });
      page = await browser.newPage();
    }

    /*
     * if (data.browserType === BrowserType.Webkit) {
     *     browser = await webkit.launch();
     *     page = await browser.newPage();
     * }
     */

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

  @CaptureSpan()
  public static getViewportHeightAndWidth(options: {
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

  @CaptureSpan()
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

  @CaptureSpan()
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
}

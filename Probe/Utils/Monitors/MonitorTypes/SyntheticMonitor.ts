import { PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../Config";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import VMRunner from "Common/Server/Utils/VM/VMRunner";
import BrowserUtil, { Browser, Page } from "Common/Server/Utils/Browser";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
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

        pageAndBrowser = await BrowserUtil.getPageByBrowserType({
          browserType: options.browserType,
          screenSizeType: options.screenSizeType,
        });

        result = await VMRunner.runCodeInSandbox({
          code: options.script,
          options: {
            timeout: PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
            args: {},
            context: {
              page: pageAndBrowser.page,
              screenSizeType: options.screenSizeType,
              browserType: options.browserType,
            },
          },
        });

        const endTime: [number, number] = process.hrtime(startTime);

        const executionTimeInMS: number =
          (endTime[0] * 1000000000 + endTime[1]) / 1000000;

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

            scriptResult.screenshots[screenshotName] = (
              result.returnValue.screenshots[screenshotName] as any
            ).toString("base64"); // convert screennshots to base 64
          }
        }

        scriptResult.result = result?.returnValue?.data;
      } catch (err) {
        logger.error(err);
        scriptResult.scriptError =
          (err as Error)?.message || (err as Error).toString();
      }

      if (pageAndBrowser?.browser) {
        await pageAndBrowser.browser.close();
      }

      return scriptResult;
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
    }

    return scriptResult;
  }
}

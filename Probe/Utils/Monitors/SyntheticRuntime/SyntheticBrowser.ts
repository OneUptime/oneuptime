import {
  Browser,
  BrowserContext,
  BrowserType as PlaywrightBrowserType,
  LaunchOptions,
  Page,
  chromium,
  firefox,
} from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import SyntheticRuntimeFault from "./SyntheticRuntimeFault";
import { SyntheticMonitorWorkerConfig } from "./SyntheticMonitorWorkerTypes";

/*
 * How long a worker gives the browser to close once it has replied. The reply
 * is what the supervisor waits for, and it kills the whole process tree as
 * soon as the reply lands, so closing is only tidiness. It must never be what
 * a check waits on: a browser on slow storage takes half a minute to flush its
 * profile on close.
 */
export const SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS: number = 5_000;

export interface SyntheticBrowserSession {
  browser: Browser;
  browserContext: BrowserContext;
  page: Page;
}

export default class SyntheticBrowser {
  /**
   * Starts the browser for one check: launch(), then an ephemeral
   * browser.newContext() for the tenant's page.
   *
   * Not launchPersistentContext() on a profile directory, which is what the
   * worker used to do. A persistent context puts a brand-new on-disk profile
   * in front of the very first navigation: Chromium does not hand an
   * intercepted request to page.route until that profile's cookie database
   * has been created and synced to disk, and opening a page in the context
   * waits on the same storage. Wherever the probe's disk is slow to
   * acknowledge writes -- a throttled volume, an image being pulled onto the
   * same disk, a burst of checks each creating a profile of its own -- the
   * runtime's controller navigation stalls for as long as the disk does. It
   * stalls on every bootstrap attempt, because they share the browser, and
   * again in the retry worker, which creates yet another fresh profile. That
   * is how a probe reports "the browser runtime did not finish starting up
   * after 3 attempt(s)". The profile bought nothing in exchange: it was new for
   * every check and deleted after it.
   *
   * An ephemeral context keeps its cookie store in memory, so the bootstrap no
   * longer waits on the disk. Two consequences are deliberate:
   *
   * - Chromium keeps the tenant's web storage (IndexedDB, OPFS, Cache Storage)
   *   in memory too, so it is bounded by the worker's process-tree RSS limit
   *   rather than the run directory's disk limit. Firefox still writes it to
   *   the browser's temporary profile, under the disk limit.
   * - The browser's own temporary profile is created by Playwright under
   *   os.tmpdir(), which the worker checks is its run directory, so the disk
   *   watchdog and the run-directory cleanup still cover everything written.
   */
  public static async start(data: {
    config: SyntheticMonitorWorkerConfig;
    /*
     * Called as soon as a browser process exists, before anything else can
     * fail, so the caller can close it on every path -- including a signal
     * that arrives while the context is still being created.
     */
    onLaunched?: ((browser: Browser) => void) | undefined;
  }): Promise<SyntheticBrowserSession> {
    const config: SyntheticMonitorWorkerConfig = data.config;
    const browserLauncher: PlaywrightBrowserType =
      config.browserType === BrowserType.Chromium ? chromium : firefox;

    try {
      const browser: Browser = await browserLauncher.launch(
        this.getLaunchOptions(config),
      );
      data.onLaunched?.(browser);

      const browserContext: BrowserContext = await browser.newContext({
        acceptDownloads: false,
        viewport: config.viewport,
      });
      const page: Page = await browserContext.newPage();

      return { browser, browserContext, page };
    } catch (error: unknown) {
      /*
       * Nothing tenant-authored has run and the monitored site has not been
       * contacted, so this is the probe's failure: marked as such, it is
       * logged as ours and retried in a fresh worker instead of being handed
       * to the tenant as a Playwright launch error.
       */
      throw new SyntheticRuntimeFault({
        message: `Synthetic monitor could not start on this probe: the ${config.browserType} browser did not start. The monitored page was never opened, so this does not reflect the health of the monitored site.`,
        internalDetail: error,
      });
    }
  }

  /**
   * Closes the browser, but waits at most `timeoutInMs` for it. Whatever is
   * still running after that is the supervisor's to kill.
   */
  public static async close(data: {
    browser: Browser;
    timeoutInMs?: number | undefined;
  }): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        data.browser.close().catch((): void => {
          // The supervisor kills the full process group regardless.
        }),
        new Promise<void>((resolve: () => void): void => {
          timer = setTimeout(
            resolve,
            data.timeoutInMs ?? SYNTHETIC_BROWSER_CLOSE_TIMEOUT_IN_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private static getLaunchOptions(
    config: SyntheticMonitorWorkerConfig,
  ): LaunchOptions {
    return {
      executablePath: config.executablePath,
      ...(config.proxy
        ? {
            proxy: {
              server: config.proxy.server,
              ...(config.proxy.username !== undefined
                ? { username: config.proxy.username }
                : {}),
              ...(config.proxy.password !== undefined
                ? { password: config.proxy.password }
                : {}),
              ...(config.proxy.bypass !== undefined
                ? { bypass: config.proxy.bypass }
                : {}),
            },
          }
        : {}),
      ...(config.browserType === BrowserType.Chromium
        ? { chromiumSandbox: config.chromiumSandboxEnabled }
        : {}),
    };
  }
}

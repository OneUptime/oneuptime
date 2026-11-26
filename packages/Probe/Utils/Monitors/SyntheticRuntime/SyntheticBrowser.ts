import fs from "fs";
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
import { SYNTHETIC_RUNTIME_CONTROLLER_HOST } from "./ControllerOrigin";
import SyntheticEgressProxy from "./SyntheticEgressProxy";
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

/*
 * Preloaded into Firefox so that fsync() and fdatasync() return without
 * flushing. The probe image builds it from Native/synthetic-no-sync.c.
 *
 * An ephemeral context does not keep Firefox off the disk. It still creates a
 * whole profile -- the permission, cookie, certificate and key databases,
 * Places, QuotaManager and IndexedDB metadata -- and syncs every transaction,
 * the certificate databases and Places on the browser's main thread. Each
 * sync makes the browser wait until the device has written what it was
 * given, so on a probe whose disk is slow to acknowledge writes the
 * controller bootstrap waits on the disk after all: at 20 write IOPS with four
 * concurrent Firefox checks, every first bootstrap attempt timed out and a
 * check took 63-70 s; at 5 write IOPS a single check took 57 s, or failed all
 * three bootstrap attempts and needed a second worker. Without the syncs the
 * writes stay in the page cache -- most never reach the disk, because the run
 * directory is deleted first -- and the same checks bootstrapped on the first
 * attempt in 8-10 s.
 *
 * The syncs buy nothing: the profile is new for every check and deleted after
 * it, and nothing a page can observe depends on them. The files are still
 * written, so the disk watchdog still counts them. Firefox only; Chromium's
 * ephemeral context does not wait on its profile.
 *
 * Where the library is absent -- a development machine -- Firefox launches
 * exactly as it did without it.
 */
export const FIREFOX_NO_SYNC_LIBRARY_PATH: string =
  "/usr/lib/oneuptime-probe/libsynthetic-no-sync.so";

/*
 * What Chromium sends past the check's egress proxy (SyntheticEgressProxy):
 * the runtime's own controller document alone, whose navigation page.route
 * fulfils from memory. Without the entry, Chromium opens a speculative
 * tunnel for that navigation, which the egress proxy would refuse and
 * report. Chromium matches a host entry exactly, never as a suffix, and
 * resolves no name itself (CHROMIUM_EGRESS_ARGUMENTS), so the entry reaches
 * nothing even where a resolver would answer for the reserved name.
 *
 * Chromium also connects to localhost, 127.0.0.0/8 and [::1] directly by
 * default, past any proxy: "<-loopback>" takes that exception away.
 * Playwright adds it on its own today; naming it here keeps that so whatever
 * Playwright does.
 *
 * Firefox gets no bypass list at all. Its entries are host suffixes with no
 * dot boundary (Juggler's host.endsWith(entry)), and Firefox resolves the
 * names it bypasses itself, so any name ending in the controller host that a
 * probe's resolver answers for - a search-domain wildcard, /etc/hosts - would
 * go direct, wherever it points. page.route fulfils the controller document
 * before Firefox would ask the proxy for it.
 */
export const CHROMIUM_PROXY_BYPASS: string = `${SYNTHETIC_RUNTIME_CONTROLLER_HOST},<-loopback>`;

/*
 * The connections an HTTP proxy is never asked to make, closed in Chromium:
 *
 *   - no host name is looked up by the browser itself, so a connection that
 *     somehow does not go through the proxy cannot reach a named host either
 *     (the proxy is at 127.0.0.1, which stays reachable);
 *   - WebRTC's UDP, which no HTTP proxy carries, stays off: WebRTC may only
 *     use TCP through the proxy (a TURN server it approves). The switch has
 *     two names: --webrtc-ip-handling-policy in the full Chrome for Testing
 *     build the probe launches, --force-webrtc-ip-handling-policy in
 *     chrome-headless-shell. Each build ignores the other's, and with the
 *     wrong one alone a page's STUN and TURN servers and remote candidates
 *     were sent UDP directly, loopback included;
 *   - QUIC (HTTP/3), also UDP, stays off: every request is HTTP/1.1 or
 *     HTTP/2 through the proxy.
 */
export const CHROMIUM_EGRESS_ARGUMENTS: ReadonlyArray<string> = [
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disable-quic",
];

/*
 * Connections Firefox opens to one proxy at once. Every request of a check
 * goes to the egress proxy, so Firefox's default for a proxy (32) is in
 * effect a cap on the whole page: 60 slow requests to 60 hosts took twice as
 * long as in Chromium. The egress proxy holds up to 1,024 sockets, both
 * sides counted.
 */
const FIREFOX_CONNECTIONS_PER_PROXY: number = 256;

/*
 * The same, for Firefox:
 *
 *   - loopback goes through the proxy too (Playwright's Firefox build sets
 *     this; naming it here does not depend on that);
 *   - a request the proxy does not answer is never retried directly;
 *   - WebRTC's ICE only through the proxy, never directly to a peer;
 *   - no HTTP/3 or WebTransport, which are QUIC (UDP) and never proxied;
 *   - no DNS prefetching of a page's links by the browser itself;
 *   - as many connections to the egress proxy as a page has to its hosts.
 */
export const FIREFOX_EGRESS_PREFERENCES: Readonly<
  Record<string, boolean | number>
> = Object.freeze({
  "network.proxy.allow_hijacking_localhost": true,
  "network.proxy.failover_direct": false,
  "media.peerconnection.ice.proxy_only": true,
  "network.http.http3.enable": false,
  "network.webtransport.enabled": false,
  "network.dns.disablePrefetch": true,
  "network.http.max-persistent-connections-per-proxy":
    FIREFOX_CONNECTIONS_PER_PROXY,
});

export interface SyntheticBrowserSession {
  browser: Browser;
  browserContext: BrowserContext;
  page: Page;
  /*
   * The check's egress proxy: the browser's only way out, and the axios
   * bridge's (WorkerController). Close it once the browser is closed.
   */
  egress: SyntheticEgressProxy;
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
   *   in memory too, so it is bounded by the worker's process-tree memory
   *   limit rather than the run directory's disk limit. Firefox still writes
   *   it to the browser's temporary profile, under the disk limit.
   * - The browser's own temporary profile is created by Playwright under
   *   os.tmpdir(), which the worker checks is its run directory, so the disk
   *   watchdog and the run-directory cleanup still cover everything written.
   *
   * The browser's only proxy is the check's egress proxy, started here
   * first (GHSA-9rx7-vwfj-whp7): every request the tenant's script can make
   * the browser send is held to the probe's egress policy there, the one
   * API and Website monitors are held to (SyntheticEgressProxy). It goes
   * through the operator's outbound proxy, config.proxy, itself.
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
    let egress: SyntheticEgressProxy;

    try {
      egress = new SyntheticEgressProxy({
        policy: config.egressPolicy,
        upstreamProxy: config.proxy,
      });
    } catch (error: unknown) {
      /*
       * An outbound proxy the egress proxy cannot read is the operator's
       * setting, not the tenant's script, and never a reason to go direct.
       */
      throw new SyntheticRuntimeFault({
        message:
          "Synthetic monitor could not start on this probe: the probe's outbound proxy setting could not be read. The monitored page was never opened, so this does not reflect the health of the monitored site.",
        internalDetail: error,
      });
    }

    try {
      await egress.start();

      const browser: Browser = await browserLauncher.launch(
        this.getLaunchOptions(config, egress.getProxyServer()),
      );
      data.onLaunched?.(browser);

      const browserContext: BrowserContext = await browser.newContext({
        acceptDownloads: false,
        viewport: config.viewport,
      });
      const page: Page = await browserContext.newPage();

      return { browser, browserContext, page, egress };
    } catch (error: unknown) {
      await egress.close();
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
   * still running after that is the supervisor's to kill. The egress proxy,
   * when given, is closed after it.
   */
  public static async close(data: {
    browser: Browser;
    egress?: SyntheticEgressProxy | undefined;
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
      await data.egress?.close();
    }
  }

  private static getLaunchOptions(
    config: SyntheticMonitorWorkerConfig,
    egressProxyServer: string,
  ): LaunchOptions {
    if (config.browserType === BrowserType.Chromium) {
      return {
        executablePath: config.executablePath,
        proxy: { server: egressProxyServer, bypass: CHROMIUM_PROXY_BYPASS },
        chromiumSandbox: config.chromiumSandboxEnabled,
        args: [...CHROMIUM_EGRESS_ARGUMENTS],
      };
    }

    return {
      executablePath: config.executablePath,
      // No bypass: see CHROMIUM_PROXY_BYPASS.
      proxy: { server: egressProxyServer },
      firefoxUserPrefs: { ...FIREFOX_EGRESS_PREFERENCES },
      ...this.getFirefoxEnvironmentOptions(),
    };
  }

  /*
   * Playwright gives the browser this environment instead of the worker's, so
   * it is the worker's own -- already reduced to an allowlist by ProcessRunner
   * -- plus the preload.
   */
  private static getFirefoxEnvironmentOptions(): Pick<LaunchOptions, "env"> {
    if (!fs.existsSync(FIREFOX_NO_SYNC_LIBRARY_PATH)) {
      return {};
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
    env["LD_PRELOAD"] = FIREFOX_NO_SYNC_LIBRARY_PATH;

    return { env };
  }
}

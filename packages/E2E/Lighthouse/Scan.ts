import { FormFactor } from "./Pages";
import { ScannedCategories } from "./Results";
import { Browser, chromium } from "@playwright/test";
import lighthouse, {
  Config,
  Flags,
  RunnerResult,
  desktopConfig,
} from "lighthouse";
import net from "net";

/*
 * Runs Lighthouse on one page in the Chromium Playwright installs: the build
 * the Playwright image carries, so a scan in CI and one on a laptop judge
 * with the same browser. Lighthouse drives it over the DevTools port, in a
 * tab of its own, with its own mobile or desktop emulation.
 *
 * Requests to other sites are blocked: the pages are served over http from
 * 127.0.0.1, so every https request is a third party's (Google Fonts, GitHub
 * avatars, the demo page's cal.com booking widget). What they do - the
 * cookies they set, the issues Chrome logs about them - changes without a
 * pull request changing anything, and the scan judges what this repository
 * serves. Lighthouse leaves the blocked requests out of the console errors
 * it reports.
 */
const ThirdPartyRequests: Array<string> = ["https://*"];

// A port nothing is listening on, for the browser's DevTools.
async function freePort(): Promise<number> {
  return new Promise<number>(
    (resolve: (port: number) => void, reject: (error: Error) => void) => {
      const server: net.Server = net.createServer();

      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address: net.AddressInfo = server.address() as net.AddressInfo;

        server.close(() => {
          resolve(address.port);
        });
      });
    },
  );
}

export async function scanPage(
  url: string,
  formFactor: FormFactor,
): Promise<RunnerResult> {
  const port: number = await freePort();

  // The full Chromium in its new headless mode, as Lighthouse expects.
  const browser: Browser = await chromium.launch({
    channel: "chromium",
    args: [`--remote-debugging-port=${port}`],
  });

  try {
    const flags: Flags = {
      port: port,
      output: "html",
      logLevel: "error",
      onlyCategories: [...ScannedCategories],
      blockedUrlPatterns: ThirdPartyRequests,
    };
    // Lighthouse's defaults are a phone's; its desktop config is a laptop's.
    const config: Config | undefined =
      formFactor === "desktop" ? desktopConfig : undefined;
    const result: RunnerResult | undefined = await lighthouse(
      url,
      flags,
      config,
    );

    if (!result) {
      throw new Error(`Lighthouse returned nothing for ${url}.`);
    }

    return result;
  } finally {
    await browser.close();
  }
}

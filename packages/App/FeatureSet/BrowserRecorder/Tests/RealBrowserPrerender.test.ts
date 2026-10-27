/**
 * @jest-environment node
 */

import {
  Browser,
  Site,
  SiteRequest,
  Tab,
  findChromium,
  packagePath,
  sleep,
} from "./RealBrowser";

/*
 * A page Chromium PRERENDERS, in a real Chromium: the recorder is on the
 * page, the browser loads and runs it before anybody opens it, and the
 * site sees every request. Nothing may be uploaded while nobody has opened
 * the page - a prerender the visitor never opens used to upload a session
 * nobody visited - and once the visitor opens it, the recording starts.
 * PrerenderedPage covers the same in jsdom, call by call; this is the
 * proof that Chromium does what that simulation says. Like
 * RealBrowserVitals it needs a Chromium, and is skipped where there is
 * none, except on CI, where a missing browser fails it.
 */

declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };
declare function require(id: string): unknown;

interface EsbuildModule {
  build: (options: Record<string, unknown>) => Promise<{
    outputFiles: Array<{ text: string }>;
  }>;
}

interface BuildConfigModule {
  createCommonRumInlinePlugin: () => unknown;
}

interface OpenedPage {
  activationStart: number;
  prerenderedAtStart: boolean;
  bootstrapDecision: string;
  codes: Array<string>;
}

const PACKAGE_ROOT: string = packagePath(__dirname, "..");
const BROWSER: string | null = findChromium();

const CHUNK_PATH: string = "/telemetry/session-replay/v1/chunk";

/* Everyone recorded, uploaded at once: the first chunk leaves at start. */
const CONFIG: Record<string, unknown> = {
  enabled: true,
  recorderVersion: "latest",
  maskingMode: "MaskAllText",
  captureTrigger: "Always",
  consentMode: "NotRequired",
  samplePercentage: 100,
  maskSelectors: [],
  blockSelectors: [],
  urlAllowlist: [],
  ignoreErrorPatterns: [],
  recordCanvas: false,
  captureUserIdentity: false,
  respectDoNotTrack: false,
  configEpoch: 1,
  directive: "continue",
};

/* The page with the recorder on it, bootstrapped as the loader does. */
const RECORDED_PAGE: string = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Recorded page</title>
    <script src="/recorder.js"></script>
  </head>
  <body>
    <h1>Recorded page</h1>
    <p>A paragraph for the snapshot to hold.</p>
    <script>
      window.__prerenderedAtStart = document.prerendering === true;
      OneUptimeReplay.bootstrap(
        {
          host: location.origin,
          token: "tok",
          appIdentifier: "app-1",
          respectDoNotTrack: false,
        },
        ${JSON.stringify(CONFIG)},
        [],
      );
    </script>
  </body>
</html>`;

/* Where the visitor starts: Chromium is told to prerender one visit. */
function startPage(visit: string): string {
  const target: string = `/recorded.html?visit=${visit}`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Start</title>
    <script type="speculationrules">
      {"prerender": [{"source": "list", "urls": ["${target}"], "eagerness": "immediate"}]}
    </script>
  </head>
  <body>
    <h1>Start</h1>
    <a id="go" href="${target}">Open the recorded page</a>
  </body>
</html>`;
}

/* The recorder artifact, bundled from source as the artifact is. */
async function bundleArtifact(): Promise<string> {
  const esbuild: EsbuildModule = require("esbuild") as EsbuildModule;
  const config: BuildConfigModule = require(
    packagePath(PACKAGE_ROOT, "esbuild.config.js"),
  ) as BuildConfigModule;
  const built: { outputFiles: Array<{ text: string }> } = await esbuild.build({
    entryPoints: [packagePath(PACKAGE_ROOT, "src", "Index.ts")],
    bundle: true,
    format: "iife",
    globalName: "OneUptimeReplay",
    platform: "browser",
    target: "es2019",
    write: false,
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.LANG": '""',
    },
    plugins: [config.createCommonRumInlinePlugin()],
  });

  return (built.outputFiles[0] as { text: string }).text;
}

/* Attempts at a prerender: Chromium may still be starting up the first time. */
const PRERENDER_ATTEMPTS: number = 3;
const PRERENDER_WAIT_MS: number = 4000;

/*
 * How long the unseen page is given after its recorder arrived: an upload
 * at start, as this policy makes, leaves within a few milliseconds.
 */
const UNSEEN_MS: number = 2500;

const describeInBrowser: jest.Describe =
  BROWSER || process.env["CI"] ? describe : describe.skip;

describeInBrowser("a prerendered page in a real Chromium", (): void => {
  let browser: Browser | null = null;
  let site: Site | null = null;
  const tabs: Array<Tab> = [];

  beforeAll(async (): Promise<void> => {
    if (!BROWSER) {
      throw new Error(
        "No Chromium to run in: install Playwright's (npx playwright install chromium) or set CHROME_PATH.",
      );
    }

    site = await Site.serve({
      "/recorded.html": RECORDED_PAGE,
      "/start-unopened.html": startPage("unopened"),
      "/start-opened.html": startPage("opened"),
      "/recorder.js": await bundleArtifact(),
    });
    browser = await Browser.launch(BROWSER);
  }, 120000);

  afterEach(async (): Promise<void> => {
    for (const tab of tabs.splice(0)) {
      await tab.close();
    }
  });

  afterAll((): void => {
    browser?.close();
    site?.close();
  });

  function requestsFor(visit: string): Array<SiteRequest> {
    return (site as Site).requests.filter((request: SiteRequest): boolean => {
      return (
        request.url === `/recorded.html?visit=${visit}` ||
        (request.path !== "/recorded.html" &&
          request.path !== "/start-unopened.html" &&
          request.path !== "/start-opened.html")
      );
    });
  }

  /* The uploads made since a point in the site's log. */
  function uploadsSince(index: number): Array<SiteRequest> {
    return (site as Site).requests
      .slice(index)
      .filter((request: SiteRequest): boolean => {
        return request.method === "POST" && request.path === CHUNK_PATH;
      });
  }

  /*
   * Opens the start page, unattached - a DevTools session would stop the
   * prerender - and waits until Chromium has prerendered the visit's page
   * and fetched its recorder.
   */
  async function openStartPage(visit: string): Promise<Tab> {
    for (let attempt: number = 1; attempt <= PRERENDER_ATTEMPTS; attempt++) {
      const since: number = (site as Site).requests.length;
      const tab: Tab = await Tab.open(
        (browser as Browser).cdp,
        `${(site as Site).origin}/start-${visit}.html`,
      );

      tabs.push(tab);

      const deadline: number = Date.now() + PRERENDER_WAIT_MS * attempt;

      while (Date.now() < deadline) {
        const seen: Array<SiteRequest> = (site as Site).requests.slice(since);
        const prerendered: boolean = seen.some(
          (request: SiteRequest): boolean => {
            return (
              request.url === `/recorded.html?visit=${visit}` &&
              request.purpose.indexOf("prerender") !== -1
            );
          },
        );
        const recorderFetched: boolean = seen.some(
          (request: SiteRequest): boolean => {
            return request.path === "/recorder.js";
          },
        );

        if (prerendered && recorderFetched) {
          return tab;
        }

        await sleep(100);
      }

      await tab.close();
    }

    throw new Error(
      `Chromium never prerendered the page: ${JSON.stringify(requestsFor(visit))}`,
    );
  }

  it("a page nobody opens uploads nothing", async (): Promise<void> => {
    const since: number = (site as Site).requests.length;
    const tab: Tab = await openStartPage("unopened");

    await sleep(UNSEEN_MS);

    expect(uploadsSince(since)).toEqual([]);

    /* The visitor goes nowhere: the tab closes and the prerender with it. */
    await tab.close();
    await sleep(500);

    expect(uploadsSince(since)).toEqual([]);
  }, 60000);

  it("once the visitor opens it, the recording starts", async (): Promise<void> => {
    const since: number = (site as Site).requests.length;
    const tab: Tab = await openStartPage("opened");

    await sleep(UNSEEN_MS);

    expect(uploadsSince(since)).toEqual([]);

    const openedAt: number = Date.now();

    await tab.evaluate<void>('document.getElementById("go").click()');
    await tab.waitFor<boolean>(
      'location.pathname === "/recorded.html" && document.prerendering === false',
      "the visitor to open the recorded page",
    );

    const deadline: number = Date.now() + 15000;

    while (Date.now() < deadline && uploadsSince(since).length === 0) {
      await sleep(100);
    }

    const uploads: Array<SiteRequest> = uploadsSince(since);

    expect(uploads.length).toBeGreaterThan(0);
    expect((uploads[0] as SiteRequest).atMs).toBeGreaterThanOrEqual(openedAt);

    const page: OpenedPage = await tab.evaluate<OpenedPage>(
      '({ activationStart: performance.getEntriesByType("navigation")[0].activationStart, prerenderedAtStart: window.__prerenderedAtStart, bootstrapDecision: OneUptimeReplay.getDiagnostics().bootstrapDecision, codes: OneUptimeReplay.getDiagnostics().records.map(function (record) { return record.code; }) })',
    );

    /* It was the prerendered page that was opened, not a fresh load. */
    expect(page.prerenderedAtStart).toBe(true);
    expect(page.activationStart).toBeGreaterThan(0);
    expect(page.bootstrapDecision).toBe("started");
    expect(page.codes).toContain("prerender-wait");
  }, 60000);
});

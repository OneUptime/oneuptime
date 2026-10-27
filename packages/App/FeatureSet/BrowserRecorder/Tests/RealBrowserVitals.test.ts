/**
 * @jest-environment node
 */

import {
  Browser,
  Cdp,
  Site,
  Tab,
  findChromium,
  packagePath,
  readText,
  sleep,
} from "./RealBrowser";

/*
 * Issue #5181, in a real Chromium.
 *
 * The recorder's PerformanceRecorder and Google's web-vitals library run
 * side by side in the same page - the recorder bundled from source exactly
 * as the artifact bundles it, the library as the IIFE its package ships -
 * and the browser does what the customer's did: it prerenders the page
 * before anybody opens it, loads it in a background tab, or restores it
 * from the back/forward cache. Every vital the library reports, the
 * recorder must report the same, and the raw performance timeline shows
 * what the recorder used to report instead.
 *
 * jsdom has no prerendering, no tabs and no back/forward cache, which is
 * why WebVitalsParity simulates them; this suite is the proof that the
 * simulation is what Chromium does. It needs a Chromium (CI installs
 * Playwright's; see findChromium) and is skipped where there is none,
 * except on CI, where a missing browser fails it.
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

interface Answer {
  metric: string;
  value: number;
  rating: string;
  navigationType: string;
}

interface PageAnswers {
  library: Array<Answer>;
  recorder: Array<Answer>;
}

const PACKAGE_ROOT: string = packagePath(__dirname, "..");
const BROWSER: string | null = findChromium();

/* The library's word for each kind of page view, in the recorder's. */
const LIBRARY_NAVIGATION_TYPES: Record<string, string> = {
  navigate: "hard",
  reload: "hard",
  "back-forward": "hard",
  restore: "hard",
  prerender: "prerender",
  "back-forward-cache": "back-forward-cache",
};

/*
 * Both measurers on one page: the library's callbacks and the recorder's
 * emitted vitals each land in an array the test reads, and a restore from
 * the back/forward cache reaches the recorder as the Recorder's own
 * pageshow handler hands it on.
 */
const MEASURED_PAGE: string = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Measured page</title>
    <script src="/web-vitals.js"></script>
    <script src="/recorder.js"></script>
    <script>
      window.__library = [];
      window.__recorder = [];

      function keep(metric) {
        window.__library.push({
          metric: metric.name,
          value: metric.value,
          rating: metric.rating,
          navigationType: metric.navigationType,
        });
      }

      webVitals.onTTFB(keep);
      webVitals.onFCP(keep);
      webVitals.onLCP(keep);
      webVitals.onCLS(keep);
      webVitals.onINP(keep);

      var recorder = new window.__PerformanceRecorder({
        emitCustomEvent: function (tag, payload) {
          if (payload && payload.kind === "web-vital") {
            window.__recorder.push(payload);
          }
        },
        onIssue: function () {},
        lcpBudgetMs: 0,
        longTaskBudgetMs: 0,
        slowRequestBudgetMs: 0,
      });

      recorder.start(window);

      addEventListener("pageshow", function (event) {
        if (event.persisted) {
          recorder.noteBfcacheRestore(event.timeStamp);
        }
      });
    </script>
  </head>
  <body>
    <h1>Measured page</h1>
    <p>A paragraph of text for the first contentful paint to draw.</p>
    <p><a id="away" href="/other.html">Somewhere else</a></p>
  </body>
</html>`;

/* Where the visitor starts: Chrome is told to prerender the measured page. */
const START_PAGE: string = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Start</title>
    <script type="speculationrules">
      {"prerender": [{"source": "list", "urls": ["/measured.html"], "eagerness": "immediate"}]}
    </script>
  </head>
  <body>
    <h1>Start</h1>
    <a id="go" href="/measured.html">Open the measured page</a>
  </body>
</html>`;

const OTHER_PAGE: string = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Other page</title></head>
  <body><h1>Another page</h1></body>
</html>`;

/* The recorder's PerformanceRecorder, bundled as the artifact bundles it. */
async function bundleRecorder(): Promise<string> {
  const esbuild: EsbuildModule = require("esbuild") as EsbuildModule;
  const config: BuildConfigModule = require(
    packagePath(PACKAGE_ROOT, "esbuild.config.js"),
  ) as BuildConfigModule;
  const built: { outputFiles: Array<{ text: string }> } = await esbuild.build({
    stdin: {
      contents:
        'import PerformanceRecorder from "./src/PerformanceRecorder";\n' +
        '(window as unknown as Record<string, unknown>)["__PerformanceRecorder"] = PerformanceRecorder;\n',
      resolveDir: PACKAGE_ROOT,
      loader: "ts",
      sourcefile: "real-browser-vitals.ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2019",
    write: false,
    plugins: [config.createCommonRumInlinePlugin()],
  });

  return (built.outputFiles[0] as { text: string }).text;
}

/* Each side's latest answer per metric and kind of page view, sorted. */
async function readAnswers(tab: Tab): Promise<PageAnswers> {
  const raw: { library: Array<Answer>; recorder: Array<Answer> } =
    await tab.evaluate<{ library: Array<Answer>; recorder: Array<Answer> }>(
      "({ library: window.__library, recorder: window.__recorder })",
    );

  return {
    library: latest(
      raw.library.map((answer: Answer): Answer => {
        return {
          metric: answer.metric,
          value:
            answer.metric === "CLS"
              ? Math.round(answer.value * 10000) / 10000
              : Math.round(answer.value),
          rating: answer.rating,
          navigationType:
            LIBRARY_NAVIGATION_TYPES[answer.navigationType] ||
            answer.navigationType,
        };
      }),
    ),
    recorder: latest(
      raw.recorder.map((answer: Answer): Answer => {
        return {
          metric: answer.metric,
          value: answer.value,
          rating: answer.rating,
          navigationType: answer.navigationType,
        };
      }),
    ),
  };
}

function latest(answers: Array<Answer>): Array<Answer> {
  const byKey: Map<string, Answer> = new Map<string, Answer>();

  for (const answer of answers) {
    byKey.set(`${answer.metric}/${answer.navigationType}`, answer);
  }

  return Array.from(byKey.values()).sort((a: Answer, b: Answer): number => {
    return `${a.metric}/${a.navigationType}`.localeCompare(
      `${b.metric}/${b.navigationType}`,
    );
  });
}

function kinds(answers: Array<Answer>): Array<string> {
  return answers.map((answer: Answer): string => {
    return `${answer.metric}/${answer.navigationType}`;
  });
}

function find(
  answers: Array<Answer>,
  metric: string,
  navigationType: string,
): Answer | undefined {
  return answers.find((answer: Answer): boolean => {
    return answer.metric === metric && answer.navigationType === navigationType;
  });
}

/*
 * Another tab comes to the front, as when the visitor switches to it: the
 * tab behind it hides, and reports its CLS and INP, and settles LCP, as it
 * does. When the tab that goes behind is given, this waits for it to hide,
 * so a test that then waits for what the hide reports fails on the hide
 * itself if it never came.
 */
async function bringAnotherTabToFront(
  cdp: Cdp,
  site: Site,
  behind?: Tab,
): Promise<Tab> {
  const front: Tab = await Tab.open(cdp, `${site.origin}/other.html`);

  await front.bringToFront();
  await front.waitFor<boolean>(
    'document.visibilityState === "visible"',
    "the other tab to come to the front",
  );

  if (behind) {
    await behind.waitFor<boolean>(
      'document.visibilityState === "hidden"',
      "the tab behind it to hide",
    );
  }

  return front;
}

/* Attempts at a prerender: Chromium may still be starting up the first time. */
const PRERENDER_ATTEMPTS: number = 3;
const PRERENDER_WAIT_MS: number = 2500;

const describeInBrowser: jest.Describe =
  BROWSER || process.env["CI"] ? describe : describe.skip;

describeInBrowser("web vitals in a real Chromium (issue #5181)", (): void => {
  let browser: Browser | null = null;
  let site: Site | null = null;
  const tabs: Array<Tab> = [];

  beforeAll(async (): Promise<void> => {
    if (!BROWSER) {
      throw new Error(
        "No Chromium to run in: install Playwright's (npx playwright install chromium) or set CHROME_PATH.",
      );
    }

    const webVitals: string = readText(
      packagePath(
        PACKAGE_ROOT,
        "node_modules/web-vitals/dist/web-vitals.iife.js",
      ),
    );

    site = await Site.serve({
      "/measured.html": MEASURED_PAGE,
      "/start.html": START_PAGE,
      "/other.html": OTHER_PAGE,
      "/recorder.js": await bundleRecorder(),
      "/web-vitals.js": webVitals,
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

  async function open(path: string, background: boolean = false): Promise<Tab> {
    const tab: Tab = await Tab.open(
      (browser as Browser).cdp,
      `${(site as Site).origin}${path}`,
      background,
    );

    tabs.push(tab);

    return tab;
  }

  it("an ordinary page load: the recorder reports what the library reports", async (): Promise<void> => {
    const tab: Tab = await open("/measured.html");

    await tab.waitFor<boolean>(
      'document.readyState === "complete" && window.__recorder.some(function (v) { return v.metric === "FCP"; })',
      "the page to load and paint",
    );
    await tab.pressKey();
    await sleep(1500);
    tabs.push(
      await bringAnotherTabToFront((browser as Browser).cdp, site as Site, tab),
    );
    await tab.waitFor<boolean>(
      'window.__library.some(function (v) { return v.metric === "CLS"; })',
      "the library's CLS at the hide",
    );

    const answers: PageAnswers = await readAnswers(tab);

    expect(answers.recorder).toEqual(answers.library);
    expect(kinds(answers.recorder)).toEqual(
      expect.arrayContaining(["FCP/hard", "LCP/hard", "TTFB/hard", "CLS/hard"]),
    );
  }, 60000);

  /*
   * Chrome prerenders the measured page while the visitor is still on the
   * start page, and the visitor opens it two seconds later. The paint
   * entry still counts from the prerender's start; the recorder counts
   * from the activation, as the library does.
   */
  it("a prerendered page: FCP, LCP and TTFB from when the visitor opened it", async (): Promise<void> => {
    let tab: Tab | null = null;
    let timeline: { activationStart: number; fcpStartTime: number } = {
      activationStart: 0,
      fcpStartTime: 0,
    };

    for (
      let attempt: number = 1;
      attempt <= PRERENDER_ATTEMPTS && timeline.activationStart === 0;
      attempt++
    ) {
      tab = await open("/start.html");

      /* Unattached while Chrome prerenders: a DevTools session would stop it. */
      await sleep(PRERENDER_WAIT_MS * attempt);
      await tab.evaluate<void>('document.getElementById("go").click()');
      await tab.waitFor<boolean>(
        'location.pathname === "/measured.html" && window.__recorder && window.__recorder.some(function (v) { return v.metric === "FCP"; })',
        "the visitor to open the measured page",
      );

      timeline = await tab.evaluate<{
        activationStart: number;
        fcpStartTime: number;
      }>(
        '({ activationStart: performance.getEntriesByType("navigation")[0].activationStart, fcpStartTime: performance.getEntriesByType("paint").filter(function (e) { return e.name === "first-contentful-paint"; })[0].startTime })',
      );
    }

    /* Chromium prerendered it, and the visitor came seconds later. */
    expect(timeline.activationStart).toBeGreaterThan(PRERENDER_WAIT_MS - 500);

    const opened: Tab = tab as Tab;

    await opened.pressKey();
    await sleep(1500);
    tabs.push(
      await bringAnotherTabToFront(
        (browser as Browser).cdp,
        site as Site,
        opened,
      ),
    );
    await opened.waitFor<boolean>(
      'window.__library.some(function (v) { return v.metric === "CLS"; })',
      "the library's CLS at the hide",
    );

    const answers: PageAnswers = await readAnswers(opened);
    const fcp: Answer | undefined = find(answers.recorder, "FCP", "prerender");

    expect(answers.recorder).toEqual(answers.library);
    expect(fcp?.value).toBe(
      Math.round(timeline.fcpStartTime - timeline.activationStart),
    );
    expect(find(answers.recorder, "TTFB", "prerender")?.value).toBe(0);
    expect(find(answers.recorder, "LCP", "prerender")).toBeDefined();

    /* What the replay used to say: the paint from the prerender's start. */
    expect(timeline.fcpStartTime).toBeGreaterThan(
      (fcp?.value as number) + PRERENDER_WAIT_MS - 500,
    );
  }, 60000);

  /*
   * Opened in a background tab, the page is painted only when the
   * visitor switches to it; neither side reports a paint vital for it.
   */
  it("a page opened in a background tab: no FCP, LCP or CLS on either side", async (): Promise<void> => {
    /* The tab the visitor is on while the new one loads behind it. */
    tabs.push(
      await bringAnotherTabToFront((browser as Browser).cdp, site as Site),
    );

    const tab: Tab = await open("/measured.html", true);

    await sleep(1500);
    await tab.waitFor<boolean>(
      'document.readyState === "complete" && document.visibilityState === "hidden"',
      "the background tab to load hidden",
    );
    await tab.bringToFront();
    await tab.waitFor<boolean>(
      'document.visibilityState === "visible" && performance.getEntriesByType("paint").length > 0',
      "the tab to be shown and painted",
    );
    await tab.pressKey();
    await sleep(1500);
    tabs.push(
      await bringAnotherTabToFront((browser as Browser).cdp, site as Site),
    );
    await tab.waitFor<boolean>(
      'document.visibilityState === "hidden"',
      "the tab to hide again",
    );
    await sleep(500);

    const answers: PageAnswers = await readAnswers(tab);

    expect(answers.recorder).toEqual(answers.library);
    expect(kinds(answers.recorder)).toContain("TTFB/hard");

    for (const metric of ["FCP", "LCP", "CLS"]) {
      expect(find(answers.recorder, metric, "hard")).toBeUndefined();
    }
  }, 60000);

  /*
   * The visitor switches to another tab and back, and only then does the
   * page jump. CLS covers the page's whole life: the library reports it
   * at the first hide (nothing had moved yet: 0) and again at the next,
   * because it grew; the recorder reports the same two numbers.
   */
  it("a page the visitor comes back to: CLS reported again once it grew", async (): Promise<void> => {
    const tab: Tab = await open("/measured.html");

    await tab.waitFor<boolean>(
      'document.readyState === "complete" && window.__recorder.some(function (v) { return v.metric === "FCP"; })',
      "the page to load and paint",
    );
    await sleep(300);

    const away: Tab = await bringAnotherTabToFront(
      (browser as Browser).cdp,
      site as Site,
      tab,
    );

    tabs.push(away);
    await tab.waitFor<boolean>(
      'window.__library.some(function (v) { return v.metric === "CLS"; }) && window.__recorder.some(function (v) { return v.metric === "CLS"; })',
      "CLS on both sides at the first hide",
    );

    await tab.bringToFront();
    await tab.waitFor<boolean>(
      'document.visibilityState === "visible"',
      "the visitor to come back to the tab",
    );
    await sleep(500);

    /*
     * A banner pushes everything down, well after any input. Layout shifts
     * are not on the performance timeline, so the test watches for its own
     * entry with an observer of its own.
     */
    await tab.evaluate<void>(
      '(function () { new PerformanceObserver(function (list) { if (list.getEntries().length > 0) { window.__shifted = true; } }).observe({ type: "layout-shift" }); var banner = document.createElement("div"); banner.style.height = "240px"; banner.textContent = "Late banner"; document.body.insertBefore(banner, document.body.firstChild); })()',
    );
    await tab.waitFor<boolean>(
      "window.__shifted === true",
      "the browser to record the layout shift",
    );
    await sleep(500);

    tabs.push(
      await bringAnotherTabToFront((browser as Browser).cdp, site as Site, tab),
    );
    await tab.waitFor<boolean>(
      'window.__library.filter(function (v) { return v.metric === "CLS"; }).length >= 2',
      "the library's second CLS at the second hide",
    );
    await sleep(300);

    const reports: { library: Array<number>; recorder: Array<number> } =
      await tab.evaluate<{ library: Array<number>; recorder: Array<number> }>(
        '({ library: window.__library.filter(function (v) { return v.metric === "CLS"; }).map(function (v) { return Math.round(v.value * 10000) / 10000; }), recorder: window.__recorder.filter(function (v) { return v.metric === "CLS"; }).map(function (v) { return v.value; }) })',
      );

    expect(reports.recorder).toEqual(reports.library);
    expect(reports.recorder).toHaveLength(2);
    expect(reports.recorder[0]).toBe(0);
    expect(reports.recorder[1] as number).toBeGreaterThan(0);

    const answers: PageAnswers = await readAnswers(tab);

    expect(answers.recorder).toEqual(answers.library);
  }, 60000);

  /*
   * Away and back: the restored page reports a set of its own, TTFB 0 and
   * FCP and LCP to its first frame back, on both sides.
   */
  it("a page restored from the back/forward cache: its own set of vitals", async (): Promise<void> => {
    const tab: Tab = await open("/measured.html");

    await tab.waitFor<boolean>(
      'document.readyState === "complete" && window.__recorder.some(function (v) { return v.metric === "FCP"; })',
      "the page to load and paint",
    );
    await sleep(300);
    await tab.evaluate<void>('document.getElementById("away").click()');
    await tab.waitFor<boolean>(
      'location.pathname === "/other.html"',
      "the visitor to go to another page",
    );
    await sleep(500);
    await tab.evaluate<void>("history.back()");
    await tab.waitFor<boolean>(
      'location.pathname === "/measured.html" && window.__library && window.__library.some(function (v) { return v.navigationType === "back-forward-cache" && v.metric === "LCP"; }) && window.__recorder.some(function (v) { return v.navigationType === "back-forward-cache" && v.metric === "LCP"; })',
      "the restored page's vitals on both sides",
    );

    const answers: PageAnswers = await readAnswers(tab);
    const restored: (answers: Array<Answer>) => Array<Answer> = (
      list: Array<Answer>,
    ): Array<Answer> => {
      return list.filter((answer: Answer): boolean => {
        return answer.navigationType === "back-forward-cache";
      });
    };

    /* The visit before the cache, exactly. */
    expect(
      answers.recorder.filter((answer: Answer): boolean => {
        return answer.navigationType === "hard";
      }),
    ).toEqual(
      answers.library.filter((answer: Answer): boolean => {
        return answer.navigationType === "hard";
      }),
    );

    expect(kinds(restored(answers.recorder))).toEqual(
      kinds(restored(answers.library)),
    );
    expect(find(answers.recorder, "TTFB", "back-forward-cache")?.value).toBe(0);

    /*
     * FCP and LCP each read performance.now() in the same frame as the
     * library does, a few microseconds apart: the same millisecond, or the
     * next one.
     */
    for (const metric of ["FCP", "LCP"]) {
      const ours: Answer | undefined = find(
        answers.recorder,
        metric,
        "back-forward-cache",
      );
      const theirs: Answer | undefined = find(
        answers.library,
        metric,
        "back-forward-cache",
      );

      expect(ours).toBeDefined();
      expect(
        Math.abs((ours as Answer).value - (theirs as Answer).value),
      ).toBeLessThanOrEqual(1);
      expect((ours as Answer).rating).toBe((theirs as Answer).rating);
    }
  }, 60000);
});

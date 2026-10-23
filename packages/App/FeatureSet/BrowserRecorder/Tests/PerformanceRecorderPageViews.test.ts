import {
  SessionReplayNavigationType,
  SessionReplayWebVitalMetric,
  isSessionReplayWebVitalPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import PerformanceRecorder, {
  WebVitalEvent,
  rateWebVital,
} from "../src/PerformanceRecorder";
import {
  definePrerendering,
  defineVisibilityState,
  dispatchTrusted,
} from "./TrustedEvents";
import WebVitalsPage from "./WebVitalsPage";

/*
 * How the recorder times a page view that is not an ordinary, visible
 * page load (issue #5181): a page the browser prerendered before the
 * visitor opened it, a page hidden before it painted, and a page restored
 * from the back/forward cache. WebVitalsParity holds each of these to the
 * web-vitals library's answers; this suite pins the recorder's own side
 * of them - the exact payloads, the wall-clock stamps, the budget
 * triggers, the observers it arms and when, and the edges the library
 * never meets.
 */

/* The wall clock the recorder stamps a performance time with. */
function at(performanceTimeMs: number): number {
  return Math.round(window.performance.timeOrigin + performanceTimeMs);
}

function vitals(page: WebVitalsPage): Array<WebVitalEvent> {
  return page.recorderEvents.filter(
    (payload: unknown): payload is WebVitalEvent => {
      return isSessionReplayWebVitalPayload(payload);
    },
  );
}

function vitalsOf(
  page: WebVitalsPage,
  metric: SessionReplayWebVitalMetric,
): Array<WebVitalEvent> {
  return vitals(page).filter((event: WebVitalEvent): boolean => {
    return event.metric === metric;
  });
}

function only(
  page: WebVitalsPage,
  metric: SessionReplayWebVitalMetric,
): WebVitalEvent | null {
  const reported: Array<WebVitalEvent> = vitalsOf(page, metric);

  expect(reported.length).toBeLessThanOrEqual(1);

  return reported[0] || null;
}

function summary(page: WebVitalsPage): Array<string> {
  return vitals(page).map((event: WebVitalEvent): string => {
    return `${event.metric}:${event.value}:${event.navigationType}`;
  });
}

/*
 * The page from the issue: Chrome prerendered /login - first byte at
 * 146 ms - and the visitor opened it at 2000 ms.
 */
function prerenderedPage(): WebVitalsPage {
  const page: WebVitalsPage = new WebVitalsPage({ responseStart: 146 });

  definePrerendering(true);
  defineVisibilityState("hidden");
  page.visibilityEntries.push({
    entryType: "visibility-state",
    name: "hidden",
    startTime: 0,
  });
  page.now = 300;

  return page;
}

describe("PerformanceRecorder - prerendered, hidden and restored page views", (): void => {
  let page: WebVitalsPage | null = null;

  afterEach((): void => {
    page?.dispose();
    page = null;
  });

  describe("a page the browser prerendered (issue #5181)", (): void => {
    it("measures nothing while the page is only being prerendered", async (): Promise<void> => {
      page = prerenderedPage();
      page.startRecorder({ lcpBudgetMs: 1000, longTaskBudgetMs: 100 });

      page.now = 1200;
      page.contentfulPaint(1100);
      page.longTask(900, 400);
      await page.settle();

      /* No observer, no TTFB: nobody has opened the page. */
      expect(page.observedEntryTypes()).toEqual([]);
      expect(page.recorderEvents).toEqual([]);
      expect(page.recorderIssues).toEqual([]);
    });

    it("times FCP, LCP and TTFB from when the visitor opened it", async (): Promise<void> => {
      page = prerenderedPage();
      page.startRecorder();

      page.now = 2000;
      page.activate();

      /* TTFB at once: the response was there before the visitor came. */
      expect(only(page, "TTFB")).toEqual({
        kind: "web-vital",
        metric: "TTFB",
        value: 0,
        rating: "good",
        occurredAtUnixMs: at(2000),
        navigationType: "prerender",
      });

      page.now = 2068.4;
      page.contentfulPaint(2068.4);
      page.largestPaint(2068.4, 30000);
      await page.settle();

      page.now = 2500;
      page.input("pointerdown");

      expect(only(page, "FCP")).toEqual({
        kind: "web-vital",
        metric: "FCP",
        value: 68,
        rating: "good",
        occurredAtUnixMs: at(2068.4),
        navigationType: "prerender",
      });
      expect(only(page, "LCP")).toEqual({
        kind: "web-vital",
        metric: "LCP",
        value: 68,
        rating: "good",
        occurredAtUnixMs: at(2068.4),
        navigationType: "prerender",
      });

      /*
       * What the replay used to say: the paint timed from the prerender's
       * start, 2068 ms - the 2.1 s "needs improvement" in the issue.
       */
      expect(rateWebVital("FCP", 2068)).toBe("needs-improvement");
    });

    it("reads the activation from the navigation entry when it starts after the visitor opened the page", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 146, activationStart: 2000 });
      page.visibilityEntries.push(
        { entryType: "visibility-state", name: "hidden", startTime: 0 },
        { entryType: "visibility-state", name: "visible", startTime: 2001 },
      );
      page.contentfulPaint(2068);
      page.now = 2400;

      page.startRecorder();
      await page.settle();

      expect(summary(page)).toEqual(["TTFB:0:prerender", "FCP:68:prerender"]);
    });

    /*
     * The first byte arrived after the activation (a slow server, a quick
     * visitor): the wait past the activation is the visitor's TTFB.
     */
    it("counts a first byte that arrived after the activation from the activation", (): void => {
      page = new WebVitalsPage({ responseStart: 2600, activationStart: 2000 });
      page.now = 2700;

      page.startRecorder();

      expect(only(page, "TTFB")).toEqual({
        kind: "web-vital",
        metric: "TTFB",
        value: 600,
        rating: "good",
        occurredAtUnixMs: at(2600),
        navigationType: "prerender",
      });
    });

    it("rates the LCP budget on the visitor's LCP", async (): Promise<void> => {
      page = prerenderedPage();
      page.startRecorder({ lcpBudgetMs: 2000 });

      page.now = 2000;
      page.activate();
      page.now = 2100;
      page.largestPaint(2068, 9000);
      await page.settle();

      /* 2068 ms from the prerender's start; 68 ms for the visitor. */
      expect(page.recorderIssues).toEqual([]);

      page.now = 6700;
      page.largestPaint(6600, 120000);
      await page.settle();

      expect(page.recorderIssues).toEqual([
        {
          kind: "lcp",
          durationMs: 4600,
          budgetMs: 2000,
          occurredAtUnixMs: at(6600),
        },
      ]);
    });

    it("lets a long task over before the visitor opened the page keep nobody waiting", async (): Promise<void> => {
      page = prerenderedPage();
      page.startRecorder({ longTaskBudgetMs: 100 });

      page.now = 1980;
      page.longTask(500, 300);
      page.longTask(1950, 120);

      page.now = 2000;
      page.activate();
      page.now = 2800;
      page.longTask(2500, 200);
      await page.settle();

      /* The one that ran into the activation counts; the earlier one does not. */
      expect(
        page.recorderIssues.map((issue: { durationMs: number }): number => {
          return issue.durationMs;
        }),
      ).toEqual([120, 200]);
    });

    it("never measures a prerender nobody opens, and leaves nothing listening", async (): Promise<void> => {
      page = prerenderedPage();

      const recorder: PerformanceRecorder = page.startRecorder({
        lcpBudgetMs: 1000,
      });

      recorder.stop();

      page.now = 2000;
      page.activate();
      page.contentfulPaint(2050);
      await page.settle();

      expect(page.observedEntryTypes()).toEqual([]);
      expect(page.recorderEvents).toEqual([]);
    });

    it("reports only the TTFB of a page opened straight into a background tab", async (): Promise<void> => {
      page = prerenderedPage();
      page.startRecorder({ lcpBudgetMs: 1000 });

      page.now = 2000;
      page.activate(false);
      page.now = 9000;
      page.show();
      page.contentfulPaint(9010);
      page.largestPaint(9010, 64000);
      await page.settle();

      page.now = 9500;
      page.hide();

      expect(summary(page)).toEqual(["TTFB:0:prerender"]);
      expect(page.recorderIssues).toEqual([]);
    });

    it("names the prerendered page load as the view its INP began in", async (): Promise<void> => {
      page = prerenderedPage();
      page.startRecorder();

      page.now = 2000;
      page.activate();
      page.now = 2600;
      page.interaction(2500, 152, true);
      await page.settle();

      page.now = 3000;
      page.hide();

      expect(only(page, "INP")?.navigationType).toBe("prerender");
      expect(only(page, "INP")?.value).toBe(152);
    });

    it("arms nothing early when the session rotates before the activation", async (): Promise<void> => {
      page = prerenderedPage();

      const recorder: PerformanceRecorder = page.startRecorder({
        longTaskBudgetMs: 100,
      });

      recorder.resetForNewSession();

      expect(page.observedEntryTypes()).toEqual([]);

      page.now = 2000;
      page.activate();

      expect(page.observedEntryTypes()).toContain("longtask");
    });
  });

  describe("a page hidden before it painted", (): void => {
    /*
     * Opened with a middle click: the browser paints the page only once
     * the visitor switches to its tab, 30 s on. That FCP would time the
     * tab sitting unseen, not the page.
     */
    it("reports no FCP, LCP or CLS for a page opened in a background tab", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 210 });
      defineVisibilityState("hidden");
      page.now = 400;

      page.startRecorder({ lcpBudgetMs: 2500 });

      page.now = 30000;
      page.show();
      page.contentfulPaint(30016);
      page.largestPaint(30016, 30000);
      page.layoutShift(0.3, 30200);
      await page.settle();

      page.now = 31000;
      page.input("keydown");
      page.hide();

      expect(summary(page)).toEqual(["TTFB:210:hard"]);

      /* Nor is its 30 s "LCP" a reason to upload the session as slow. */
      expect(page.recorderIssues).toEqual([]);
    });

    it("keeps the paints made before the first hide, and only those", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 90 });
      page.now = 500;
      page.contentfulPaint(400);
      page.largestPaint(400, 2000);

      page.startRecorder();
      await page.settle();

      page.now = 900;
      page.hide();

      page.now = 5000;
      page.show();
      page.largestPaint(5016, 64000);
      await page.settle();

      page.now = 6000;
      page.hide();

      expect(summary(page)).toEqual([
        "TTFB:90:hard",
        "FCP:400:hard",
        "LCP:400:hard",
        "CLS:0:hard",
      ]);
    });

    /*
     * The paint happened before the hide; the observer simply had not
     * delivered it yet. The hide drains the queue first.
     */
    it("reports an FCP still queued when the page hides, if it painted first", (): void => {
      page = new WebVitalsPage({ responseStart: 90 });
      page.now = 600;

      page.startRecorder();
      page.contentfulPaint(650);

      page.now = 900;
      page.hide();

      expect(only(page, "FCP")?.value).toBe(650);
      expect(only(page, "CLS")?.value).toBe(0);
    });

    it("counts a hide Chromium recorded before the recorder started", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 75 });
      page.visibilityEntries.push(
        { entryType: "visibility-state", name: "visible", startTime: 0 },
        { entryType: "visibility-state", name: "hidden", startTime: 300 },
        { entryType: "visibility-state", name: "visible", startTime: 1200 },
      );
      page.contentfulPaint(1216);
      page.largestPaint(1216, 4000);
      page.now = 1400;

      page.startRecorder();
      await page.settle();

      page.now = 2000;
      page.hide();

      expect(summary(page)).toEqual(["TTFB:75:hard"]);
    });

    /*
     * An engine that stamps events with the wall clock: the hide is read
     * at now, the moment the listener runs, rather than as a time so far
     * in the future that every paint would count, or as 0.
     */
    it("reads a hide stamped on the wall clock as happening now", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 75 });
      page.now = 600;

      page.startRecorder();
      page.contentfulPaint(850);

      page.now = 900;
      defineVisibilityState("hidden");
      dispatchTrusted(document, new Event("visibilitychange"), Date.now());

      page.now = 4000;
      page.show();
      page.largestPaint(4020, 64000);
      await page.settle();

      page.now = 5000;
      page.input("click");
      page.hide();

      expect(summary(page)).toEqual([
        "TTFB:75:hard",
        "FCP:850:hard",
        "CLS:0:hard",
      ]);
    });
  });

  describe("a page restored from the back/forward cache", (): void => {
    async function loadedPage(): Promise<{
      page: WebVitalsPage;
      recorder: PerformanceRecorder;
    }> {
      const loaded: WebVitalsPage = new WebVitalsPage({ responseStart: 130 });

      loaded.now = 200;
      loaded.contentfulPaint(180);
      loaded.largestPaint(180, 2000);

      const recorder: PerformanceRecorder = loaded.startRecorder();

      await loaded.settle();

      loaded.now = 700;
      loaded.layoutShift(0.12, 650);
      loaded.interaction(660, 264, true);
      await loaded.settle();

      loaded.now = 5000;
      loaded.enterBackForwardCache();

      return { page: loaded, recorder: recorder };
    }

    it("reports TTFB 0 at once, then FCP and LCP two frames on", async (): Promise<void> => {
      const loaded: { page: WebVitalsPage; recorder: PerformanceRecorder } =
        await loadedPage();

      page = loaded.page;

      const beforeTheCache: number = vitals(page).length;

      page.now = 60000;
      page.restoreFromBackForwardCache();

      expect(vitals(page).slice(beforeTheCache)).toEqual([
        {
          kind: "web-vital",
          metric: "TTFB",
          value: 0,
          rating: "good",
          occurredAtUnixMs: at(60000),
          navigationType: "back-forward-cache",
        },
      ]);

      /* The first frame is the one the restored page is painted in. */
      page.frame(60011);
      expect(vitals(page).slice(beforeTheCache)).toHaveLength(1);

      page.frame(60024.6);

      expect(vitals(page).slice(beforeTheCache + 1)).toEqual([
        {
          kind: "web-vital",
          metric: "FCP",
          value: 25,
          rating: "good",
          occurredAtUnixMs: at(60024.6),
          navigationType: "back-forward-cache",
        },
        {
          kind: "web-vital",
          metric: "LCP",
          value: 25,
          rating: "good",
          occurredAtUnixMs: at(60024.6),
          navigationType: "back-forward-cache",
        },
      ]);
    });

    it("measures CLS and INP for the restored visit alone", async (): Promise<void> => {
      const loaded: { page: WebVitalsPage; recorder: PerformanceRecorder } =
        await loadedPage();

      page = loaded.page;

      expect(summary(page)).toEqual([
        "TTFB:130:hard",
        "FCP:180:hard",
        "LCP:180:hard",
        "CLS:0.12:hard",
        "INP:264:hard",
      ]);

      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.frame(60010);
      page.frame(60020);

      page.now = 61000;
      page.layoutShift(0.03, 60900);
      page.interaction(60950, 96);
      await page.settle();

      page.now = 64000;
      page.hide();

      expect(summary(page).slice(5)).toEqual([
        "TTFB:0:back-forward-cache",
        "FCP:20:back-forward-cache",
        "LCP:20:back-forward-cache",
        "CLS:0.03:back-forward-cache",
        "INP:96:back-forward-cache",
      ]);
    });

    it("ignores the load's late LCP entries after the restore", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 130 });
      page.now = 200;

      page.startRecorder();

      /* No input and no hide yet, so the load's LCP is still open. */
      page.now = 5000;
      dispatchTrusted(
        window,
        new PageTransitionEvent("pagehide", { persisted: true }),
        5000,
      );
      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.largestPaint(60005, 99999);
      await page.settle();

      page.frame(60010);
      page.frame(60020);

      expect(vitalsOf(page, "LCP")).toEqual([
        expect.objectContaining({
          value: 20,
          navigationType: "back-forward-cache",
        }),
      ]);
    });

    /*
     * The tab hides again before the restore's second frame, with an LCP
     * entry of the load arriving late: that entry is the visit before the
     * cache, so the hide settles nothing on it, and the restore's own LCP
     * still comes from its frames.
     */
    it("settles no LCP from a late load entry when the tab hides before the restore's frames", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 130 });
      page.now = 200;

      page.startRecorder();

      page.now = 5000;
      page.enterBackForwardCache();
      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.largestPaint(4000, 99999);
      await page.settle();

      page.now = 60005;
      page.hide();
      expect(vitalsOf(page, "LCP")).toEqual([]);

      page.show();
      page.frame(60010);
      page.frame(60020);

      expect(
        vitalsOf(page, "LCP").map((event: WebVitalEvent): string => {
          return `${event.value}:${event.navigationType}`;
        }),
      ).toEqual(["20:back-forward-cache"]);
    });

    /*
     * Some engines deliver a batch they had queued even after the
     * observer disconnected. A paint of the load that arrives so, after
     * the restore, is not the restored page's FCP.
     */
    it("takes no FCP from a paint entry delivered after the restore", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 130 });
      page.now = 200;

      page.startRecorder();

      page.now = 5000;
      page.enterBackForwardCache();
      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.deliverDespiteDisconnect({
        entryType: "paint",
        name: "first-contentful-paint",
        startTime: 300,
        duration: 0,
      });

      expect(vitalsOf(page, "FCP")).toEqual([]);

      page.frame(60010);
      page.frame(60020);

      expect(
        vitalsOf(page, "FCP").map((event: WebVitalEvent): string => {
          return `${event.value}:${event.navigationType}`;
        }),
      ).toEqual(["20:back-forward-cache"]);
    });

    /*
     * An interaction from before the page went into the cache, delivered
     * only once it is back, belongs to the visit before; the restored
     * page's INP is its own interactions'.
     */
    it("charges a late entry from before the restore to no view of the restored page", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 130 });
      page.now = 200;

      page.startRecorder();

      page.now = 5000;
      page.enterBackForwardCache();
      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.frame(60010);
      page.frame(60020);

      page.now = 61000;
      page.interaction(4900, 640);
      page.interaction(60900, 96);
      await page.settle();

      page.now = 62000;
      page.hide();

      expect(
        vitalsOf(page, "INP").map((event: WebVitalEvent): string => {
          return `${event.value}:${event.navigationType}`;
        }),
      ).toEqual(["96:back-forward-cache"]);
    });

    it("drops the frames of a restore that a second restore overtook", async (): Promise<void> => {
      const loaded: { page: WebVitalsPage; recorder: PerformanceRecorder } =
        await loadedPage();

      page = loaded.page;

      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.frame(60010);

      page.now = 60012;
      page.enterBackForwardCache();
      page.now = 90000;
      page.restoreFromBackForwardCache();

      page.frame(90016);
      page.frame(90031);

      expect(
        vitalsOf(page, "FCP").map((event: WebVitalEvent): string => {
          return `${event.value}:${event.navigationType}`;
        }),
      ).toEqual(["180:hard", "31:back-forward-cache"]);
    });

    it("reports only the TTFB of a restore where no frames are drawn", async (): Promise<void> => {
      const loaded: { page: WebVitalsPage; recorder: PerformanceRecorder } =
        await loadedPage();

      page = loaded.page;
      page.withoutAnimationFrames();

      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.hide();

      expect(summary(page).slice(5)).toEqual([
        "TTFB:0:back-forward-cache",
        "CLS:0:back-forward-cache",
      ]);
    });

    it("reports no TTFB for a restore when the load had no navigation timing", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 0 });
      page.now = 200;
      page.contentfulPaint(150);

      page.startRecorder();
      await page.settle();

      page.now = 5000;
      page.enterBackForwardCache();
      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.frame(60010);
      page.frame(60020);

      expect(summary(page)).toEqual([
        "FCP:150:hard",
        "CLS:0:hard",
        "FCP:20:back-forward-cache",
        "LCP:20:back-forward-cache",
      ]);
    });

    /*
     * The web-vitals library starts measuring CLS at the first FCP it
     * reports. A page that loaded hidden reports none for its load, so no
     * CLS either - but a restore paints it in front of the visitor, and
     * from that FCP on its CLS counts: the restored visit's alone.
     */
    it("measures CLS for a page that loaded hidden only from a restore's FCP on", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 100 });
      defineVisibilityState("hidden");
      page.now = 200;

      page.startRecorder();

      page.now = 3000;
      page.show();
      page.contentfulPaint(3016);
      page.layoutShift(0.4, 3100);
      await page.settle();

      page.now = 5000;
      page.enterBackForwardCache();

      /* The load had no FCP, so its 0.4 is no CLS of anybody's. */
      expect(vitalsOf(page, "CLS")).toEqual([]);

      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.layoutShift(0.05, 60005);
      await page.settle();

      /* Hidden again before the restore's first frame: no FCP, no CLS. */
      page.now = 60008;
      page.hide();
      expect(vitalsOf(page, "CLS")).toEqual([]);

      page.now = 60009;
      page.show();
      page.frame(60010);
      page.frame(60020);
      page.layoutShift(0.2, 60100);
      await page.settle();

      page.now = 61000;
      page.hide();

      expect(only(page, "FCP")?.navigationType).toBe("back-forward-cache");
      expect(vitalsOf(page, "CLS")).toEqual([
        {
          kind: "web-vital",
          metric: "CLS",
          value: 0.25,
          rating: "needs-improvement",
          occurredAtUnixMs: at(60100),
          navigationType: "back-forward-cache",
        },
      ]);
    });

    it("reports no CLS for a restore of a page that loaded hidden when no frame paints it", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 100 });
      defineVisibilityState("hidden");
      page.now = 200;
      page.withoutAnimationFrames();

      page.startRecorder();

      page.now = 3000;
      page.show();
      page.contentfulPaint(3016);
      await page.settle();

      page.now = 5000;
      page.enterBackForwardCache();
      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.layoutShift(0.2, 60100);
      await page.settle();

      page.now = 61000;
      page.hide();

      expect(summary(page)).toEqual([
        "TTFB:100:hard",
        "TTFB:0:back-forward-cache",
      ]);
    });

    it("counts a restore stamped from the future, or on the wall clock, from now", async (): Promise<void> => {
      const loaded: { page: WebVitalsPage; recorder: PerformanceRecorder } =
        await loadedPage();

      page = loaded.page;

      page.now = 60000;
      loaded.recorder.noteBfcacheRestore(Date.now());
      page.frame(60010);
      page.frame(60020);

      expect(
        vitals(page)
          .slice(5)
          .map((event: WebVitalEvent): string => {
            return `${event.metric}:${event.value}:${event.occurredAtUnixMs - at(0)}`;
          }),
      ).toEqual(["TTFB:0:60000", "FCP:20:60020", "LCP:20:60020"]);
    });

    it("does nothing with vitals off, after stop, or for a page still prerendering", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 100 });
      page.now = 200;

      const off: PerformanceRecorder = page.startRecorder({
        captureWebVitals: false,
      });

      off.noteBfcacheRestore(150);
      page.frame(210);
      page.frame(220);
      off.stop();

      const stopped: PerformanceRecorder = page.startRecorder();

      stopped.stop();
      stopped.noteBfcacheRestore(250);
      page.frame(260);
      page.frame(270);

      const neverStarted: PerformanceRecorder = new PerformanceRecorder({
        emitCustomEvent: (_tag: string, payload: unknown): void => {
          page?.recorderEvents.push(payload);
        },
        onIssue: (): void => {},
        lcpBudgetMs: 0,
        longTaskBudgetMs: 0,
        slowRequestBudgetMs: 0,
      });

      neverStarted.noteBfcacheRestore(280);

      const eventsSoFar: number = vitals(page).length;

      definePrerendering(true);

      const prerendering: PerformanceRecorder = page.startRecorder();

      prerendering.noteBfcacheRestore(300);
      page.frame(310);
      page.frame(320);

      /* Only the stopped recorder's own load TTFB, reported at its start. */
      expect(eventsSoFar).toBe(1);
      expect(vitals(page)).toHaveLength(1);
      expect(only(page, "TTFB")?.navigationType).toBe("hard");
    });
  });

  /*
   * CLS is the largest burst of shifts over the page view's whole life,
   * and the visitor can come back to a tab. The library reports it at
   * every hide where it grew; so does the recorder.
   */
  describe("CLS over the page view's whole life", (): void => {
    function paintedPage(): WebVitalsPage {
      const painted: WebVitalsPage = new WebVitalsPage({ responseStart: 120 });

      painted.now = 300;
      painted.contentfulPaint(250);

      return painted;
    }

    function clsReports(target: WebVitalsPage): Array<string> {
      return vitalsOf(target, "CLS").map((event: WebVitalEvent): string => {
        return `${event.value}:${event.rating}:${event.occurredAtUnixMs - at(0)}:${event.navigationType}`;
      });
    }

    it("reports CLS again at a later hide where it grew, and only there", async (): Promise<void> => {
      page = paintedPage();
      page.startRecorder();
      await page.settle();

      page.now = 1000;
      page.layoutShift(0.02, 900);
      await page.settle();

      page.now = 5000;
      page.hide();

      expect(clsReports(page)).toEqual(["0.02:good:900:hard"]);

      /* Back, and the page jumps: the burst at 20.1 s is the new CLS. */
      page.now = 20000;
      page.show();
      page.layoutShift(0.2, 20100);
      page.layoutShift(0.15, 20400);
      await page.settle();

      page.now = 30000;
      page.hide();

      expect(clsReports(page)).toEqual([
        "0.02:good:900:hard",
        "0.35:poor:20400:hard",
      ]);

      /* Back again; a small shift that makes no new largest burst. */
      page.now = 40000;
      page.show();
      page.layoutShift(0.01, 40100);
      await page.settle();

      page.now = 45000;
      page.hide();
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: false }),
      );

      expect(clsReports(page)).toHaveLength(2);
    });

    it("counts a shift still queued for the observer when the tab hides", async (): Promise<void> => {
      page = paintedPage();
      page.startRecorder();
      await page.settle();

      page.now = 2000;
      page.layoutShift(0.3, 1990);
      page.hide();

      expect(clsReports(page)).toEqual(["0.3:poor:1990:hard"]);

      /* Taken, so not delivered a second time. */
      await page.settle();
      page.show();
      page.now = 3000;
      page.hide();

      expect(clsReports(page)).toEqual(["0.3:poor:1990:hard"]);
    });

    it("keeps CLS open through the idle pause and reports it again on stop if it grew", async (): Promise<void> => {
      page = paintedPage();

      const recorder: PerformanceRecorder = page.startRecorder();

      page.now = 1000;
      page.layoutShift(0.05, 900);
      await page.settle();

      recorder.finaliseVitalsNow();
      recorder.finaliseVitalsNow();

      page.now = 400000;
      page.layoutShift(0.12, 399000);
      await page.settle();

      recorder.stop();

      expect(clsReports(page)).toEqual([
        "0.05:good:900:hard",
        "0.12:needs-improvement:399000:hard",
      ]);
    });

    /*
     * A restore is a new page view: its CLS is reported at its first hide
     * even when it is the very number the visit before ended on.
     */
    it("reports a restored visit's CLS even when it equals the visit before's", async (): Promise<void> => {
      page = paintedPage();
      page.startRecorder();
      await page.settle();

      page.now = 5000;
      page.enterBackForwardCache();

      page.now = 60000;
      page.restoreFromBackForwardCache();
      page.frame(60010);
      page.frame(60020);

      page.now = 61000;
      page.hide();

      expect(vitalsOf(page, "CLS")).toEqual([
        {
          kind: "web-vital",
          metric: "CLS",
          value: 0,
          rating: "good",
          occurredAtUnixMs: vitalsOf(page, "CLS")[0]?.occurredAtUnixMs,
          navigationType: "hard",
        },
        {
          kind: "web-vital",
          metric: "CLS",
          value: 0,
          rating: "good",
          occurredAtUnixMs: vitalsOf(page, "CLS")[1]?.occurredAtUnixMs,
          navigationType: "back-forward-cache",
        },
      ]);
    });
  });

  describe("the visitor's input, not a script's, settles LCP", (): void => {
    it.each(["keydown", "pointerdown", "click"])(
      "ignores a synthetic %s, and settles on the visitor's",
      async (type: string): Promise<void> => {
        page = new WebVitalsPage({ responseStart: 100 });
        page.now = 400;
        page.largestPaint(390, 1000);

        page.startRecorder();
        await page.settle();

        document.dispatchEvent(new Event(type, { bubbles: true }));

        expect(only(page, "LCP")).toBeNull();

        page.now = 2400;
        page.largestPaint(2350, 64000);
        await page.settle();
        page.input(type);

        expect(only(page, "LCP")?.value).toBe(2350);
      },
    );
  });

  describe("navigation timing the browser left unusable", (): void => {
    it("reports no TTFB for a responseStart later than now", (): void => {
      page = new WebVitalsPage({ responseStart: 5000 });
      page.now = 1000;

      page.startRecorder();

      expect(only(page, "TTFB")).toBeNull();
    });

    it("reads no activation from an entry it cannot trust", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 0, activationStart: 2000 });
      page.now = 2500;
      page.contentfulPaint(2068);

      page.startRecorder();
      await page.settle();

      /* As web-vitals reads it: activationStart 0, an ordinary load. */
      expect(summary(page)).toEqual(["FCP:2068:hard"]);
    });
  });

  describe("INP for a page whose interactions were all quick", (): void => {
    it("reports the first input, which the browser delivers whatever its duration", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 60 });
      page.now = 2000;

      page.startRecorder();
      page.interaction(1900, 24, true);
      page.interaction(1950, 16);
      await page.settle();

      page.now = 4000;
      page.hide();

      expect(only(page, "INP")).toEqual(
        expect.objectContaining({
          value: 24,
          rating: "good",
          navigationType: "hard",
          interactionType: "pointer",
        }),
      );
    });

    it("merges the first input into the interaction its event entries describe", async (): Promise<void> => {
      page = new WebVitalsPage({ responseStart: 60 });
      page.now = 2000;

      page.startRecorder();
      page.interaction(1900, 120, true);
      await page.settle();

      page.now = 4000;
      page.hide();

      expect(vitalsOf(page, "INP")).toHaveLength(1);
      expect(only(page, "INP")?.value).toBe(120);
    });

    it("counts a first input still queued when the page hides", (): void => {
      page = new WebVitalsPage({ responseStart: 60 });
      page.now = 2000;

      page.startRecorder();
      page.interaction(1900, 32, true);

      page.now = 2100;
      page.hide();

      expect(only(page, "INP")?.value).toBe(32);
    });

    it("stops observing first input on stop", (): void => {
      page = new WebVitalsPage({ responseStart: 60 });
      page.now = 200;

      const recorder: PerformanceRecorder = page.startRecorder();

      expect(page.observedEntryTypes()).toContain("first-input");

      recorder.stop();

      expect(page.observedEntryTypes()).toEqual([]);
    });
  });

  it("names the kind of page view on every vital", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 100 });
    page.now = 400;
    page.contentfulPaint(350);
    page.largestPaint(350, 1000);

    page.startRecorder();
    await page.settle();

    page.now = 900;
    page.interaction(800, 64, true);
    await page.settle();
    page.hide();

    const types: Array<SessionReplayNavigationType | undefined> = vitals(
      page,
    ).map((event: WebVitalEvent): SessionReplayNavigationType | undefined => {
      return event.navigationType;
    });

    expect(types).toHaveLength(5);
    expect(new Set(types)).toEqual(new Set(["hard"]));
  });
});

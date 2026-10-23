import { SessionReplayWebVitalMetric } from "Common/Types/Rum/SessionReplayCustomEvents";
import { WEB_VITAL_THRESHOLDS } from "../src/PerformanceRecorder";
import { definePrerendering, defineVisibilityState } from "./TrustedEvents";
import WebVitalsPage, { Answer, WebVitalsLibrary } from "./WebVitalsPage";

/*
 * The recorder's web vitals against the web-vitals library's own answers,
 * page by page (issue #5181).
 *
 * The customer held a session replay against their application's
 * web-vitals telemetry for the same visit to /login: FCP about 2.1 s
 * ("needs improvement") in the replay, 68 ms in the telemetry, on a page
 * Chrome had prerendered before they opened it. The recorder timed the
 * paint from the prerender's start; the library times it from the
 * activation.
 *
 * Every scenario below is one page - its navigation entry, visibility
 * history, paints, shifts and interactions, and what the visitor does -
 * measured at once by the recorder's PerformanceRecorder and by Google's
 * web-vitals library (the exact version package.json pins) on the same
 * window and the same entries. Whatever the library reports, the recorder
 * must report: the same value (rounded as the recorder rounds), the same
 * rating and the same kind of page view. Whatever the library declines to
 * report, the recorder must decline too.
 */

/* What the customer's telemetry and the recorder say about the same visit. */
function expectSameAnswers(page: WebVitalsPage): Array<Answer> {
  const library: Array<Answer> = page.libraryAnswers();

  expect(page.recorderAnswers()).toEqual(library);

  return library;
}

function answer(
  answers: Array<Answer>,
  metric: SessionReplayWebVitalMetric,
): Answer | undefined {
  return answers.find((candidate: Answer): boolean => {
    return candidate.metric === metric;
  });
}

describe("web vitals: the recorder against the web-vitals library", (): void => {
  let page: WebVitalsPage | null = null;

  afterEach((): void => {
    page?.dispose();
    page = null;
  });

  it("rates against the library's own thresholds", (): void => {
    page = new WebVitalsPage({ responseStart: 100 });

    const library: WebVitalsLibrary = page.loadLibrary();

    expect(WEB_VITAL_THRESHOLDS).toEqual({
      LCP: { good: library.LCPThresholds[0], poor: library.LCPThresholds[1] },
      FCP: { good: library.FCPThresholds[0], poor: library.FCPThresholds[1] },
      CLS: { good: library.CLSThresholds[0], poor: library.CLSThresholds[1] },
      INP: { good: library.INPThresholds[0], poor: library.INPThresholds[1] },
      TTFB: {
        good: library.TTFBThresholds[0],
        poor: library.TTFBThresholds[1],
      },
    });
  });

  it("an ordinary page load: every vital the same", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 146.3 });
    page.now = 380;
    page.contentfulPaint(360.4);
    page.largestPaint(360.4, 1200);

    page.loadLibrary();
    page.startRecorder();

    page.now = 1290;
    page.largestPaint(1288.7, 48000);
    page.layoutShift(0.04, 1300);
    page.layoutShift(0.03, 1700);
    page.layoutShift(0.5, 2100, true);
    await page.settle();

    page.now = 2600;
    page.interaction(2500, 48, true);
    page.input("click");
    await page.settle();

    page.now = 4000;
    page.interaction(3800, 216);
    page.interaction(3900, 88);
    await page.settle();

    page.now = 9000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answers).toEqual([
      { metric: "CLS", value: 0.07, rating: "good", navigationType: "hard" },
      { metric: "FCP", value: 360, rating: "good", navigationType: "hard" },
      {
        metric: "INP",
        value: 216,
        rating: "needs-improvement",
        navigationType: "hard",
      },
      { metric: "LCP", value: 1289, rating: "good", navigationType: "hard" },
      { metric: "TTFB", value: 146, rating: "good", navigationType: "hard" },
    ]);
  });

  /*
   * The visit in the issue, with its numbers: Chrome prerendered /login
   * (first byte at 146 ms, loaded by 456 ms) and the visitor opened it two
   * seconds later; it painted 68 ms after that.
   */
  it("the page from issue #5181: prerendered, then opened - FCP 68 ms, not 2.1 s", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 146 });
    definePrerendering(true);
    defineVisibilityState("hidden");
    page.visibilityEntries.push({
      entryType: "visibility-state",
      name: "hidden",
      startTime: 0,
      duration: 0,
    });
    page.now = 300;

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    /* Neither side says anything about a page nobody has opened. */
    expect(page.libraryReports).toEqual([]);
    expect(page.recorderEvents).toEqual([]);

    page.now = 2000.4;
    page.activate();
    page.now = 2068.4;
    page.contentfulPaint(2068.4);
    page.largestPaint(2068.4, 30000);
    await page.settle();

    page.now = 2900;
    page.interaction(2800, 48, true);
    page.input("click");
    await page.settle();

    page.now = 6000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "FCP")).toEqual({
      metric: "FCP",
      value: 68,
      rating: "good",
      navigationType: "prerender",
    });
    expect(answer(answers, "LCP")).toEqual({
      metric: "LCP",
      value: 68,
      rating: "good",
      navigationType: "prerender",
    });
    expect(answer(answers, "TTFB")).toEqual({
      metric: "TTFB",
      value: 0,
      rating: "good",
      navigationType: "prerender",
    });
    expect(answer(answers, "INP")?.navigationType).toBe("prerender");
    expect(answer(answers, "CLS")?.navigationType).toBe("prerender");
  });

  /*
   * The recorder's config usually arrives after the activation; it reads
   * activationStart from the navigation entry and the same answers follow.
   */
  it("a prerendered page whose recorder starts after it was opened", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 146, activationStart: 2000.4 });
    page.visibilityEntries.push(
      { entryType: "visibility-state", name: "hidden", startTime: 0 },
      { entryType: "visibility-state", name: "visible", startTime: 2001 },
    );
    page.contentfulPaint(2068.4);
    page.largestPaint(2068.4, 30000);
    page.now = 2500;

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 3000;
    page.input("keydown");
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "FCP")?.value).toBe(68);
    expect(answer(answers, "LCP")?.value).toBe(68);
    expect(answer(answers, "TTFB")?.value).toBe(0);
  });

  /*
   * An image without Timing-Allow-Origin has no render time, so its LCP
   * entry carries the load time - which can be before the activation. Both
   * clamp it at 0 rather than report a negative LCP.
   */
  it("a prerendered page whose LCP image loaded before it was opened", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 90 });
    definePrerendering(true);
    defineVisibilityState("hidden");
    page.now = 200;

    page.loadLibrary();
    page.startRecorder();

    page.now = 1500;
    page.largestPaint(1200, 64000, 0);
    page.activate();
    page.contentfulPaint(1530);
    await page.settle();

    page.now = 2000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "LCP")?.value).toBe(0);
    expect(answer(answers, "FCP")?.value).toBe(30);
  });

  it("a prerendered page opened straight into a background tab", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 120 });
    definePrerendering(true);
    defineVisibilityState("hidden");
    page.now = 200;

    page.loadLibrary();
    page.startRecorder();

    page.now = 1800;
    page.activate(false);
    await page.settle();

    page.now = 9000;
    page.show();
    page.contentfulPaint(9016);
    page.largestPaint(9016, 30000);
    await page.settle();

    page.now = 12000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answers).toEqual([
      { metric: "TTFB", value: 0, rating: "good", navigationType: "prerender" },
    ]);
  });

  /*
   * Opened with a middle click: the browser loads the page but paints it
   * only when the visitor switches to the tab, here half a minute later.
   * Timed from the navigation, FCP would read 30 s - a measure of how long
   * the tab waited, not of the page - so neither side reports FCP, LCP or
   * (with no FCP) CLS. TTFB and INP are still the visitor's.
   */
  it("a page opened in a background tab", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 210 });
    defineVisibilityState("hidden");
    page.visibilityEntries.push({
      entryType: "visibility-state",
      name: "hidden",
      startTime: 0,
    });
    page.now = 600;

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 30000;
    page.show();
    page.contentfulPaint(30016);
    page.largestPaint(30016, 30000);
    page.layoutShift(0.3, 30200);
    await page.settle();

    page.now = 31000;
    page.interaction(30900, 312, true);
    page.input("click");
    await page.settle();

    page.now = 40000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answers).toEqual([
      {
        metric: "INP",
        value: 312,
        rating: "needs-improvement",
        navigationType: "hard",
      },
      { metric: "TTFB", value: 210, rating: "good", navigationType: "hard" },
    ]);
  });

  it("a page hidden while it loaded, before its first paint", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 80 });
    page.now = 150;

    page.loadLibrary();
    page.startRecorder();

    page.now = 300;
    page.hide();
    await page.settle();

    page.now = 5000;
    page.show();
    page.contentfulPaint(5016);
    page.largestPaint(5016, 9000);
    await page.settle();

    page.now = 7000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "FCP")).toBeUndefined();
    expect(answer(answers, "LCP")).toBeUndefined();
    expect(answer(answers, "CLS")).toBeUndefined();
    expect(answer(answers, "TTFB")?.value).toBe(80);
  });

  /*
   * Chromium keeps a visibility history from the navigation on, so a hide
   * that happened before either script ran still counts.
   */
  it("a page whose visibility history shows a hide before either script ran", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 75 });
    page.visibilityEntries.push(
      { entryType: "visibility-state", name: "visible", startTime: 0 },
      { entryType: "visibility-state", name: "hidden", startTime: 300 },
      { entryType: "visibility-state", name: "visible", startTime: 1200 },
    );
    page.contentfulPaint(1216);
    page.largestPaint(1216, 4000);
    page.now = 1400;

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 3000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "FCP")).toBeUndefined();
    expect(answer(answers, "LCP")).toBeUndefined();
    expect(answer(answers, "TTFB")?.value).toBe(75);
  });

  /*
   * Back to a page in the back/forward cache: a new page view with vitals
   * of its own - TTFB 0, FCP and LCP to the frame after the restore, CLS
   * and INP from the restore on - and the visit before it reported apart.
   */
  it("a page restored from the back/forward cache", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 130 });
    page.now = 200;
    page.contentfulPaint(180);
    page.largestPaint(180, 2000);

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 700;
    page.largestPaint(640, 26000);
    page.layoutShift(0.12, 650);
    await page.settle();

    page.now = 1200;
    page.interaction(1100, 264, true);
    page.input("click");
    await page.settle();

    page.now = 5000;
    page.enterBackForwardCache();
    await page.settle();

    const beforeTheCache: Array<Answer> = expectSameAnswers(page);

    expect(
      beforeTheCache.map((vital: Answer): string => {
        return `${vital.metric}:${vital.value}:${vital.navigationType}`;
      }),
    ).toEqual([
      "CLS:0.12:hard",
      "FCP:180:hard",
      "INP:264:hard",
      "LCP:640:hard",
      "TTFB:130:hard",
    ]);

    page.now = 60000;
    page.restoreFromBackForwardCache();
    page.frame(60011);
    page.frame(60024.6);
    await page.settle();

    page.now = 61000;
    page.layoutShift(0.03, 60900);
    page.interaction(60950, 96);
    await page.settle();

    page.now = 64000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(
      answers
        .filter((vital: Answer): boolean => {
          return vital.navigationType === "back-forward-cache";
        })
        .map((vital: Answer): string => {
          return `${vital.metric}:${vital.value}:${vital.rating}`;
        }),
    ).toEqual([
      "CLS:0.03:good",
      "FCP:25:good",
      "INP:96:good",
      "LCP:25:good",
      "TTFB:0:good",
    ]);
  });

  /*
   * A page whose every interaction was quicker than the 40 ms event-timing
   * threshold: the browser still hands over the first one (first-input),
   * and that is the page's INP.
   */
  it("a quick page: every interaction under the event-timing threshold", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 60 });
    page.now = 120;
    page.contentfulPaint(110);

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 2000;
    page.interaction(1900, 24, true);
    page.input("click");
    page.interaction(1950, 16);
    await page.settle();

    page.now = 4000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "INP")).toEqual({
      metric: "INP",
      value: 24,
      rating: "good",
      navigationType: "hard",
    });
  });

  /*
   * A script that clicks for the page (a carousel advancing, a tab opened
   * on load) is not the visitor: the browser keeps issuing LCP candidates,
   * and neither side takes the LCP as final.
   */
  it("a script's synthetic click does not settle LCP early", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 100 });
    page.now = 400;
    page.contentfulPaint(390);
    page.largestPaint(390, 1000);

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    document.body.dispatchEvent(new Event("click", { bubbles: true }));
    document.dispatchEvent(new Event("keydown", { bubbles: true }));
    await page.settle();

    page.now = 2400;
    page.largestPaint(2350, 64000);
    await page.settle();

    page.now = 3000;
    page.input("keydown");
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "LCP")).toEqual({
      metric: "LCP",
      value: 2350,
      rating: "good",
      navigationType: "hard",
    });
  });

  /*
   * CLS covers the page's whole life, not the stretch before its first
   * hide: the visitor switches away, comes back, and the page jumps. The
   * library reports CLS again at the next hide because it grew (and not at
   * a hide where it did not); so must the recorder, or the replay would
   * keep calling a page "good" that it shows shifting.
   */
  it("a page the visitor leaves and comes back to: CLS that grows is reported again", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 120 });
    page.now = 300;
    page.contentfulPaint(250);
    page.largestPaint(250, 5000);

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 1000;
    page.layoutShift(0.02, 900);
    await page.settle();

    page.now = 5000;
    page.hide();
    await page.settle();

    expect(answer(expectSameAnswers(page), "CLS")?.value).toBe(0.02);

    page.now = 20000;
    page.show();
    page.layoutShift(0.2, 20100);
    page.layoutShift(0.15, 20400);
    await page.settle();

    page.now = 30000;
    page.hide();
    await page.settle();

    expect(answer(expectSameAnswers(page), "CLS")).toEqual({
      metric: "CLS",
      value: 0.35,
      rating: "poor",
      navigationType: "hard",
    });

    /* Back once more, nothing moves: neither side says it again. */
    page.now = 40000;
    page.show();
    page.now = 45000;
    page.hide();
    await page.settle();

    const reported: (metric: string) => Array<number> = (
      metric: string,
    ): Array<number> => {
      return page!.libraryReports
        .filter((report: { name: string }): boolean => {
          return report.name === metric;
        })
        .map((report: { value: number }): number => {
          return WebVitalsPage.roundAsRecorderDoes("CLS", report.value);
        });
    };

    expect(reported("CLS")).toEqual([0.02, 0.35]);
    expect(
      page.recorderEvents
        .filter((event: unknown): boolean => {
          return (event as Answer).metric === "CLS";
        })
        .map((event: unknown): number => {
          return (event as Answer).value;
        }),
    ).toEqual(reported("CLS"));
  });

  /*
   * The browser hands a PerformanceObserver its entries in a task of their
   * own, so a shift in the same moment as the hide can still be queued
   * when the page hides. The library takes the queued records before it
   * reports; so does the recorder.
   */
  it("a layout shift still queued when the page hides", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 100 });
    page.now = 300;
    page.contentfulPaint(250);

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 2000;
    page.layoutShift(0.3, 1990);
    page.hide();
    await page.settle();

    expect(answer(expectSameAnswers(page), "CLS")).toEqual({
      metric: "CLS",
      value: 0.3,
      rating: "poor",
      navigationType: "hard",
    });
  });

  /*
   * A page that loaded in a background tab has no FCP, so no CLS - until
   * the visitor leaves it and comes back through the back/forward cache:
   * the restored visit is painted in front of them and has an FCP, and
   * from there both sides measure its CLS. (The library's observer also
   * replays the shifts of the visit before the cache, so a bigger one there
   * would count in its number; the recorder counts the restored visit
   * alone, as it does for every restore.)
   */
  it("a page that loaded in a background tab, then came back from the back/forward cache", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 100 });
    defineVisibilityState("hidden");
    page.visibilityEntries.push({
      entryType: "visibility-state",
      name: "hidden",
      startTime: 0,
    });
    page.now = 200;

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 3000;
    page.show();
    page.contentfulPaint(3016);
    page.largestPaint(3016, 9000);
    page.layoutShift(0.01, 3100);
    await page.settle();

    page.now = 5000;
    page.enterBackForwardCache();
    await page.settle();

    expect(answer(expectSameAnswers(page), "CLS")).toBeUndefined();

    page.now = 60000;
    page.restoreFromBackForwardCache();
    page.frame(60010);
    page.frame(60020);
    page.layoutShift(0.2, 60100);
    await page.settle();

    page.now = 61000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(
      answers.map((vital: Answer): string => {
        return `${vital.metric}:${vital.value}:${vital.navigationType}`;
      }),
    ).toEqual([
      "CLS:0.2:back-forward-cache",
      "FCP:20:back-forward-cache",
      "LCP:20:back-forward-cache",
      "TTFB:0:back-forward-cache",
      "TTFB:100:hard",
    ]);
  });

  /*
   * A navigation entry with no usable responseStart: the browser withheld
   * it, or reported one from the future. Neither side reports a TTFB.
   */
  it("a navigation entry the browser left unusable", async (): Promise<void> => {
    page = new WebVitalsPage({ responseStart: 0 });
    page.now = 300;
    page.contentfulPaint(280);

    page.loadLibrary();
    page.startRecorder();
    await page.settle();

    page.now = 1000;
    page.hide();
    await page.settle();

    const answers: Array<Answer> = expectSameAnswers(page);

    expect(answer(answers, "TTFB")).toBeUndefined();
    expect(answer(answers, "FCP")?.value).toBe(280);
  });
});

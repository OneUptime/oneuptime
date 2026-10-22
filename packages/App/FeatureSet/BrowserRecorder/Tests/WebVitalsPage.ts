import {
  SessionReplayNavigationType,
  SessionReplayWebVitalMetric,
  SessionReplayWebVitalRating,
  isSessionReplayWebVitalPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import PerformanceRecorder, {
  PerformanceIssue,
  PerformanceRecorderOptions,
} from "../src/PerformanceRecorder";
import {
  definePrerendering,
  defineVisibilityState,
  dispatchTrusted,
  resetDocumentState,
} from "./TrustedEvents";

/*
 * One simulated page that the recorder and Google's web-vitals library
 * both measure (issue #5181).
 *
 * The page is jsdom's own window and document, with the parts of the
 * platform the two read replaced by a timeline the test writes: the
 * navigation entry (responseStart, activationStart), Chromium's
 * visibility-state history, a PerformanceObserver that delivers paint,
 * largest-contentful-paint, layout-shift, event and first-input entries
 * the way the browser does (asynchronously, buffered entries included,
 * the event threshold applied), the performance clock, the interaction
 * count and animation frames. What the visitor does - input, hiding the
 * tab, opening a prerendered page, leaving and coming back through the
 * back/forward cache - is dispatched as the browser dispatches it:
 * trusted, and stamped on the performance clock.
 *
 * Each side's answers are then put in the same shape (value rounded as
 * the recorder rounds, rating, navigationType in the recorder's words) so
 * a scenario can hold one to the other.
 */

declare function require(id: string): unknown;

type Entry = Record<string, unknown>;

export interface LibraryMetric {
  name: SessionReplayWebVitalMetric;
  value: number;
  rating: SessionReplayWebVitalRating;
  navigationType: string;
}

type OnMetric = (
  report: (metric: LibraryMetric) => void,
  options?: Record<string, unknown>,
) => void;

export interface WebVitalsLibrary {
  onCLS: OnMetric;
  onFCP: OnMetric;
  onINP: OnMetric;
  onLCP: OnMetric;
  onTTFB: OnMetric;
  CLSThresholds: Array<number>;
  FCPThresholds: Array<number>;
  INPThresholds: Array<number>;
  LCPThresholds: Array<number>;
  TTFBThresholds: Array<number>;
}

/* One reported vital, as both sides can state it. */
export interface Answer {
  metric: SessionReplayWebVitalMetric;
  value: number;
  rating: SessionReplayWebVitalRating;
  navigationType: SessionReplayNavigationType;
}

/*
 * The library's navigationType in the recorder's words: a load is a load,
 * whether it was a click, a reload or the back button.
 */
const LIBRARY_NAVIGATION_TYPES: Record<string, SessionReplayNavigationType> = {
  navigate: "hard",
  reload: "hard",
  "back-forward": "hard",
  restore: "hard",
  prerender: "prerender",
  "back-forward-cache": "back-forward-cache",
};

export const SUPPORTED_ENTRY_TYPES: Array<string> = [
  "paint",
  "largest-contentful-paint",
  "layout-shift",
  "event",
  "first-input",
  "longtask",
  "navigation",
  "visibility-state",
];

/* The browser's default for an event observer without one, and its floor. */
const DEFAULT_EVENT_DURATION_THRESHOLD_MS: number = 104;
const MIN_EVENT_DURATION_THRESHOLD_MS: number = 16;

/* Rounds of the task queue that let every observer, idle and load task run. */
const SETTLE_ROUNDS: number = 12;

type ListCallback = (list: { getEntries: () => Array<Entry> }) => void;

export default class WebVitalsPage {
  /* performance.now(), as the test moves it. */
  public now: number = 0;

  /* performance.interactionCount. */
  public interactionCount: number = 0;

  public readonly navigation: Entry;
  public visibilityEntries: Array<Entry> = [];

  public readonly libraryReports: Array<LibraryMetric> = [];
  public readonly recorderEvents: Array<unknown> = [];
  public readonly recorderIssues: Array<PerformanceIssue> = [];

  private readonly entries: Array<Entry> = [];
  private readonly observers: Array<TimelineObserver> = [];
  private readonly frames: Array<(time: number) => void> = [];
  private readonly installed: Array<{
    target: Entry;
    key: string;
    previous: PropertyDescriptor | undefined;
  }> = [];
  private recorder: PerformanceRecorder | null = null;
  private readonly pageShowListener: (event: Event) => void;
  private nextInteractionId: number = 7;

  public constructor(navigation: {
    responseStart: number;
    activationStart?: number;
    type?: string;
  }) {
    this.navigation = {
      entryType: "navigation",
      name: window.location.href,
      startTime: 0,
      duration: 0,
      type: navigation.type || "navigate",
      responseStart: navigation.responseStart,
      activationStart: navigation.activationStart || 0,
      domInteractive: navigation.responseStart + 1,
      domContentLoadedEventStart: navigation.responseStart + 2,
      domComplete: navigation.responseStart + 3,
    };

    /* What the Recorder's own pageshow listener does on a restore. */
    this.pageShowListener = (event: Event): void => {
      if ((event as PageTransitionEvent).persisted === true && this.recorder) {
        this.recorder.noteBfcacheRestore(event.timeStamp);
      }
    };

    this.installPlatform();
  }

  /* ---- The two measurers ---- */

  /*
   * A fresh copy of the library, as a page that loads it gets one: its
   * visibility watcher and restore time are module state.
   */
  public loadLibrary(): WebVitalsLibrary {
    const holder: { library: WebVitalsLibrary | null } = { library: null };

    jest.isolateModules((): void => {
      holder.library = require("web-vitals") as WebVitalsLibrary;
    });

    const library: WebVitalsLibrary = holder.library as unknown as WebVitalsLibrary;

    for (const subscribe of [
      library.onTTFB,
      library.onFCP,
      library.onLCP,
      library.onCLS,
      library.onINP,
    ]) {
      subscribe((metric: LibraryMetric): void => {
        /* The library mutates its metric objects; keep what was said. */
        this.libraryReports.push({
          name: metric.name,
          value: metric.value,
          rating: metric.rating,
          navigationType: metric.navigationType,
        });
      });
    }

    return library;
  }

  public startRecorder(
    extra: Partial<PerformanceRecorderOptions> = {},
  ): PerformanceRecorder {
    const options: PerformanceRecorderOptions = {
      emitCustomEvent: (_tag: string, payload: unknown): void => {
        this.recorderEvents.push(payload);
      },
      onIssue: (_atUnixMs: number, issue: PerformanceIssue): void => {
        this.recorderIssues.push(issue);
      },
      lcpBudgetMs: 0,
      longTaskBudgetMs: 0,
      slowRequestBudgetMs: 0,
      ...extra,
    };

    this.recorder = new PerformanceRecorder(options);
    this.recorder.start(window);
    window.addEventListener("pageshow", this.pageShowListener);

    return this.recorder;
  }

  /* ---- What the browser records ---- */

  public paint(name: string, startTime: number): void {
    this.add({ entryType: "paint", name: name, startTime: startTime, duration: 0 });
  }

  public contentfulPaint(startTime: number): void {
    this.paint("first-paint", startTime);
    this.paint("first-contentful-paint", startTime);
  }

  /* An LCP candidate rendered at renderTime (0: an image without TAO). */
  public largestPaint(startTime: number, size: number, renderTime?: number): void {
    this.add({
      entryType: "largest-contentful-paint",
      name: "",
      startTime: startTime,
      duration: 0,
      renderTime: renderTime === undefined ? startTime : renderTime,
      loadTime: startTime,
      size: size,
    });
  }

  public layoutShift(value: number, startTime: number, hadRecentInput: boolean = false): void {
    this.add({
      entryType: "layout-shift",
      name: "",
      startTime: startTime,
      duration: 0,
      value: value,
      hadRecentInput: hadRecentInput,
    });
  }

  /*
   * One interaction: its pointerdown, pointerup and click entries, each
   * with the interaction's duration, and the first-input entry when it is
   * the page's first. Event timing reports durations in 8 ms steps.
   */
  public interaction(startTime: number, duration: number, isFirst: boolean = false): void {
    const interactionId: number = this.nextInteractionId;

    this.nextInteractionId += 7;
    this.interactionCount++;

    const timing: Entry = {
      startTime: startTime,
      duration: duration,
      interactionId: interactionId,
      processingStart: startTime + 4,
      processingEnd: startTime + Math.max(8, duration - 16),
      target: null,
    };

    for (const name of ["pointerdown", "pointerup", "click"]) {
      this.add({ ...timing, entryType: "event", name: name });
    }

    if (isFirst) {
      this.add({ ...timing, entryType: "first-input", name: "pointerdown" });
    }
  }

  public longTask(startTime: number, duration: number): void {
    this.add({
      entryType: "longtask",
      name: "self",
      startTime: startTime,
      duration: duration,
    });
  }

  /* The entry types somebody is observing on this page right now. */
  public observedEntryTypes(): Array<string> {
    const types: Set<string> = new Set<string>();

    for (const observer of this.observers) {
      for (const type of observer.observedTypes()) {
        types.add(type);
      }
    }

    return Array.from(types).sort();
  }

  /* An engine that draws no frames (a document with no rendering). */
  public withoutAnimationFrames(): void {
    this.install(window, "requestAnimationFrame", {
      value: undefined,
      writable: true,
    });
  }

  /* Frames waiting for the next paint. */
  public pendingFrames(): number {
    return this.frames.length;
  }

  /* ---- What the visitor does ---- */

  public input(type: string): void {
    dispatchTrusted(document, new Event(type, { bubbles: true }), this.now);
  }

  public hide(): void {
    defineVisibilityState("hidden");
    dispatchTrusted(document, new Event("visibilitychange"), this.now);
  }

  public show(): void {
    defineVisibilityState("visible");
    dispatchTrusted(document, new Event("visibilitychange"), this.now);
  }

  /*
   * The visitor opens the prerendered page: activationStart is set, the
   * page becomes visible (or stays hidden, opened in a background tab),
   * prerendering ends and prerenderingchange fires.
   */
  public activate(visible: boolean = true): void {
    this.navigation["activationStart"] = this.now;
    definePrerendering(false);

    if (visible) {
      defineVisibilityState("visible");
      this.visibilityEntries.push({
        entryType: "visibility-state",
        name: "visible",
        startTime: this.now,
        duration: 0,
      });
      dispatchTrusted(document, new Event("visibilitychange"), this.now);
    }

    dispatchTrusted(document, new Event("prerenderingchange"), this.now);
  }

  /* Into the back/forward cache: pagehide (persisted), then hidden. */
  public enterBackForwardCache(): void {
    dispatchTrusted(
      window,
      new PageTransitionEvent("pagehide", { persisted: true }),
      this.now,
    );
    this.hide();
  }

  /* Back out of it: visible, then pageshow (persisted). */
  public restoreFromBackForwardCache(): void {
    this.show();
    dispatchTrusted(
      window,
      new PageTransitionEvent("pageshow", { persisted: true }),
      this.now,
    );
  }

  /* The next animation frame, painted at `at`. */
  public frame(at: number): void {
    this.now = at;

    const due: Array<(time: number) => void> = this.frames.splice(0);

    for (const callback of due) {
      callback(at);
    }
  }

  /* Every queued observer delivery, idle callback and load task runs. */
  public async settle(): Promise<void> {
    for (let round: number = 0; round < SETTLE_ROUNDS; round++) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
  }

  /* ---- The answers ---- */

  /*
   * The latest answer each side gave for each (metric, kind of page view),
   * in the recorder's words, sorted so two lists compare as sets.
   */
  public libraryAnswers(): Array<Answer> {
    return WebVitalsPage.latest(
      this.libraryReports.map((metric: LibraryMetric): Answer => {
        return {
          metric: metric.name,
          value: WebVitalsPage.roundAsRecorderDoes(metric.name, metric.value),
          rating: metric.rating,
          navigationType:
            LIBRARY_NAVIGATION_TYPES[metric.navigationType] ||
            (metric.navigationType as SessionReplayNavigationType),
        };
      }),
    );
  }

  public recorderAnswers(): Array<Answer> {
    return WebVitalsPage.latest(
      this.recorderEvents
        .filter(isSessionReplayWebVitalPayload)
        .map((event: unknown): Answer => {
          const vital: Answer = event as Answer;

          return {
            metric: vital.metric,
            value: vital.value,
            rating: vital.rating,
            navigationType: vital.navigationType,
          };
        }),
    );
  }

  /* Puts the platform back as jsdom had it. */
  public dispose(): void {
    if (this.recorder) {
      this.recorder.stop();
    }

    window.removeEventListener("pageshow", this.pageShowListener);

    for (const observer of this.observers) {
      observer.disconnect();
    }

    /* Newest first, so a key installed twice ends as jsdom had it. */
    for (const { target, key, previous } of this.installed.reverse()) {
      if (previous) {
        Object.defineProperty(target, key, previous);
      } else {
        delete target[key];
      }
    }

    resetDocumentState();
  }

  public static roundAsRecorderDoes(
    metric: SessionReplayWebVitalMetric,
    value: number,
  ): number {
    return metric === "CLS"
      ? Math.round(value * 10000) / 10000
      : Math.round(value);
  }

  private static latest(answers: Array<Answer>): Array<Answer> {
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

  private add(entry: Entry): void {
    this.entries.push(entry);

    for (const observer of this.observers) {
      observer.offer(entry);
    }
  }

  private install(
    target: unknown,
    key: string,
    descriptor: PropertyDescriptor,
  ): void {
    this.installed.push({
      target: target as Entry,
      key: key,
      previous: Object.getOwnPropertyDescriptor(target, key),
    });
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
  }

  private installPlatform(): void {
    const timeline: Array<Entry> = this.entries;
    const observers: Array<TimelineObserver> = this.observers;
    const frames: Array<(time: number) => void> = this.frames;

    class TimelinePerformanceObserver extends TimelineObserver {
      public static supportedEntryTypes: Array<string> = SUPPORTED_ENTRY_TYPES;

      public constructor(callback: ListCallback) {
        super(callback, timeline);
        observers.push(this);
      }
    }

    /* Only the interactionId on its prototype tells the library INP works. */
    class EventTiming {}

    Object.defineProperty(EventTiming.prototype, "interactionId", {
      value: 0,
    });

    this.install(window, "PerformanceObserver", {
      value: TimelinePerformanceObserver,
      writable: true,
    });
    this.install(window, "PerformanceEventTiming", {
      value: EventTiming,
      writable: true,
    });
    this.install(window, "requestAnimationFrame", {
      value: (callback: (time: number) => void): number => {
        frames.push(callback);
        return frames.length;
      },
      writable: true,
    });
    this.install(window.performance, "now", {
      value: (): number => {
        return this.now;
      },
    });
    this.install(window.performance, "getEntriesByType", {
      value: (type: string): Array<Entry> => {
        if (type === "navigation") {
          return [this.navigation];
        }

        return type === "visibility-state" ? this.visibilityEntries : [];
      },
    });
    this.install(window.performance, "interactionCount", {
      get: (): number => {
        return this.interactionCount;
      },
    });
    this.install(document, "readyState", { value: "complete" });
  }
}

/*
 * A PerformanceObserver over the page's timeline: buffered entries on
 * observe(), new ones as they are added, each batch delivered in a task of
 * its own, takeRecords() handing over what is queued.
 */
class TimelineObserver {
  private readonly callback: ListCallback;
  private readonly timeline: Array<Entry>;
  private readonly thresholds: Map<string, number> = new Map<string, number>();
  private pending: Array<Entry> = [];
  private isScheduled: boolean = false;
  private isDisconnected: boolean = false;

  public constructor(callback: ListCallback, timeline: Array<Entry>) {
    this.callback = callback;
    this.timeline = timeline;
  }

  public observe(options: {
    type: string;
    buffered?: boolean;
    durationThreshold?: number;
  }): void {
    this.isDisconnected = false;
    this.thresholds.set(
      options.type,
      Math.max(
        MIN_EVENT_DURATION_THRESHOLD_MS,
        options.durationThreshold === undefined
          ? DEFAULT_EVENT_DURATION_THRESHOLD_MS
          : options.durationThreshold,
      ),
    );

    if (options.buffered) {
      for (const entry of this.timeline) {
        if (entry["entryType"] === options.type) {
          this.offer(entry);
        }
      }
    }
  }

  public offer(entry: Entry): void {
    const threshold: number | undefined = this.thresholds.get(
      String(entry["entryType"]),
    );

    if (this.isDisconnected || threshold === undefined) {
      return;
    }

    /* The threshold applies to event entries; first-input always arrives. */
    if (entry["entryType"] === "event" && (entry["duration"] as number) < threshold) {
      return;
    }

    this.pending.push(entry);

    if (!this.isScheduled) {
      this.isScheduled = true;
      setTimeout((): void => {
        this.deliver();
      }, 0);
    }
  }

  public observedTypes(): Array<string> {
    return this.isDisconnected ? [] : Array.from(this.thresholds.keys());
  }

  public takeRecords(): Array<Entry> {
    const taken: Array<Entry> = this.pending;

    this.pending = [];

    return taken;
  }

  public disconnect(): void {
    this.isDisconnected = true;
    this.pending = [];
  }

  private deliver(): void {
    this.isScheduled = false;

    const batch: Array<Entry> = this.takeRecords();

    if (this.isDisconnected || batch.length === 0) {
      return;
    }

    this.callback({
      getEntries: (): Array<Entry> => {
        return batch;
      },
    });
  }
}

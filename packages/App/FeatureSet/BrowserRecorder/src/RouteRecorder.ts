import UrlScrubber from "Common/Utils/Rum/UrlScrubber";

/*
 * SPA route changes.
 *
 * rrweb records a Meta event with the page href only when it takes a full
 * snapshot, so in a single-page app that navigates entirely through
 * history.pushState the recording shows the DOM changing while the URL
 * appears frozen at whatever it was when the recorder started. That makes
 * the timeline unreadable and breaks the exitUrl and pageCount columns.
 *
 * All URLs are scrubbed before they leave: a route change is exactly where a
 * password-reset token or a magic link shows up.
 *
 * Hash routers (Angular's HashLocationStrategy, React's HashRouter, Vue's
 * hash mode, every `#/`-routed admin tool) keep the whole route in the
 * fragment. UrlScrubber drops the fragment, so comparing scrubbed URLs saw
 * `#/orders` -> `#/orders/42` as no change at all: those apps reported one
 * page per session and never got a forced snapshot. The fragment's PATH
 * (a hash beginning `#/` or `#!/`) now takes part in both the comparison and
 * the stored URL, scrubbed the same way a real path is, while a plain
 * in-page anchor (`#pricing`) stays ignored and any query inside the hash is
 * dropped.
 */

export const ROUTE_CUSTOM_EVENT_TAG: string = "oneuptime.route";

/*
 * A route change is a good moment for a fresh full snapshot: the DOM has
 * usually been replaced wholesale, so the incremental mutations are large and
 * a snapshot both compresses better and gives the player a seek anchor where
 * a viewer will actually want one. Rate-limited, because an app that
 * replaces its query string on every keystroke would otherwise trigger a
 * snapshot storm - each one a full serialisation of the document.
 *
 * DEFERRED, not immediate. Routers call history.pushState and commit the new
 * tree in a later task; at the instant of the call the DOM is still the page
 * the user just left, so a synchronous snapshot serialised the OLD route at
 * full cost and the new one still arrived as a large mutation batch. The
 * snapshot waits for the next frame to paint and one more macrotask, which
 * is after the common routers have committed.
 */
const MIN_MS_BETWEEN_FORCED_SNAPSHOTS: number = 5000;

/*
 * Per-SESSION cap on recorded route events. Reset by resetForNewSession()
 * when the recorder rolls the session over.
 */
export const MAX_ROUTES_RECORDED: number = 500;

/* A fragment that is a route rather than an in-page anchor. */
const HASH_ROUTE_PATTERN: RegExp = /^#!?\//;

export interface RecordedRoute {
  from: string;
  to: string;
  kind: "pushState" | "replaceState" | "popstate" | "hashchange";

  /* Set on the single entry emitted when the per-session cap is hit. */
  isCapMarker?: boolean;
}

export interface RouteRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  scrubUrl: (url: string) => string;

  onRouteChange: (atUnixMs: number, route: RecordedRoute) => void;

  /*
   * Ask rrweb for a full snapshot. Passed in rather than imported so this
   * module stays testable without rrweb and without a real DOM.
   */
  requestFullSnapshot: () => void;

  /*
   * Called ONCE per session when the cap first drops a route change, so the
   * recorder can attach a fidelity notice to the chunk. Optional so the
   * wiring can land independently of this module.
   */
  onCapReached?: (cap: number) => void;
}

type HistoryMethod = (
  data: unknown,
  unused: string,
  url?: string | URL | null,
) => void;

export default class RouteRecorder {
  private readonly options: RouteRecorderOptions;

  private started: boolean = false;
  private recordedCount: number = 0;
  private capReported: boolean = false;
  private lastForcedSnapshotAtMs: number = 0;
  private currentUrl: string = "";

  private originalPushState: HistoryMethod | null = null;
  private originalReplaceState: HistoryMethod | null = null;

  /* The deferred snapshot in flight, so a burst of navigations takes one. */
  private snapshotFrame: number | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly popstateListener: () => void;
  private readonly hashchangeListener: () => void;

  public constructor(options: RouteRecorderOptions) {
    this.options = options;

    this.popstateListener = (): void => {
      this.handle("popstate");
    };

    this.hashchangeListener = (): void => {
      this.handle("hashchange");
    };
  }

  public start(windowRef: Window = window): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.currentUrl = windowRef.location.href;

    const historyRecord: Record<string, unknown> =
      windowRef.history as unknown as Record<string, unknown>;

    const pushState: unknown = historyRecord["pushState"];
    const replaceState: unknown = historyRecord["replaceState"];

    /*
     * The patched history methods need their own `this` (it is the History
     * object), so they stay `function` expressions and reach the recorder
     * through this lexically bound helper rather than an alias.
     */
    const handleNavigation: (kind: RecordedRoute["kind"]) => void = (
      kind: RecordedRoute["kind"],
    ): void => {
      this.handle(kind, windowRef);
    };

    if (typeof pushState === "function") {
      this.originalPushState = pushState as HistoryMethod;

      historyRecord["pushState"] = function patchedPushState(
        this: History,
        ...args: Array<unknown>
      ): void {
        (pushState as (...a: Array<unknown>) => void).apply(this, args);
        handleNavigation("pushState");
      };
    }

    if (typeof replaceState === "function") {
      this.originalReplaceState = replaceState as HistoryMethod;

      historyRecord["replaceState"] = function patchedReplaceState(
        this: History,
        ...args: Array<unknown>
      ): void {
        (replaceState as (...a: Array<unknown>) => void).apply(this, args);
        handleNavigation("replaceState");
      };
    }

    windowRef.addEventListener("popstate", this.popstateListener);
    windowRef.addEventListener("hashchange", this.hashchangeListener);
  }

  public stop(windowRef: Window = window): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    const historyRecord: Record<string, unknown> =
      windowRef.history as unknown as Record<string, unknown>;

    if (this.originalPushState) {
      historyRecord["pushState"] = this.originalPushState;
      this.originalPushState = null;
    }

    if (this.originalReplaceState) {
      historyRecord["replaceState"] = this.originalReplaceState;
      this.originalReplaceState = null;
    }

    windowRef.removeEventListener("popstate", this.popstateListener);
    windowRef.removeEventListener("hashchange", this.hashchangeListener);

    this.cancelDeferredSnapshot(windowRef);
  }

  /*
   * A rotated session starts with a fresh cap. The current URL is kept: the
   * next change is still relative to where the user is.
   */
  public resetForNewSession(): void {
    this.recordedCount = 0;
    this.capReported = false;
  }

  /*
   * Not private: the recorder also calls this on a bfcache restore, where the
   * URL may have changed while the page was frozen and no history event
   * fired at all.
   */
  public handle(kind: RecordedRoute["kind"], windowRef: Window = window): void {
    const rawUrl: string = windowRef.location.href;

    const from: string = this.describe(this.currentUrl);
    const to: string = this.describe(rawUrl);

    this.currentUrl = rawUrl;

    /*
     * Compared AFTER scrubbing, so a navigation that only changes a dropped
     * query parameter is not reported as a route change. The player would
     * otherwise show a route lane full of identical entries. The scrubbed
     * form keeps a hash ROUTE, so `#/a` -> `#/b` does compare as a change.
     */
    if (from === to) {
      return;
    }

    if (this.recordedCount >= MAX_ROUTES_RECORDED) {
      this.reportCapOnce(kind, to);
      return;
    }

    this.recordedCount++;

    const route: RecordedRoute = { from: from, to: to, kind: kind };
    const atUnixMs: number = Date.now();

    this.options.emitCustomEvent(ROUTE_CUSTOM_EVENT_TAG, route);
    this.options.onRouteChange(atUnixMs, route);

    if (
      atUnixMs - this.lastForcedSnapshotAtMs >=
      MIN_MS_BETWEEN_FORCED_SNAPSHOTS
    ) {
      this.lastForcedSnapshotAtMs = atUnixMs;
      this.deferSnapshot(windowRef);
    }
  }

  /*
   * The first route change past the cap becomes ONE marker in the stream,
   * so the route lane shows where recording stopped and why instead of
   * simply ending. Emitted once per session.
   */
  private reportCapOnce(kind: RecordedRoute["kind"], to: string): void {
    if (this.capReported) {
      return;
    }

    this.capReported = true;

    const marker: RecordedRoute = {
      from: to,
      to: to,
      kind: kind,
      isCapMarker: true,
    };

    this.options.emitCustomEvent(ROUTE_CUSTOM_EVENT_TAG, marker);

    if (this.options.onCapReached) {
      this.options.onCapReached(MAX_ROUTES_RECORDED);
    }
  }

  /*
   * The scrubbed URL plus, for a hash router, the scrubbed route inside the
   * fragment. This is what is compared and what is stored.
   */
  private describe(rawUrl: string): string {
    const scrubbed: string = this.options.scrubUrl(rawUrl);
    const hashRoute: string = RouteRecorder.scrubHashRoute(rawUrl);

    return hashRoute ? `${scrubbed}${hashRoute}` : scrubbed;
  }

  /*
   * `#/orders/42?token=x` -> `#/orders/42`, with identifier-shaped segments
   * redacted exactly as a real path's would be. Empty for a URL whose
   * fragment is an in-page anchor or absent.
   */
  public static scrubHashRoute(rawUrl: string): string {
    const hashIndex: number = rawUrl.indexOf("#");

    if (hashIndex === -1) {
      return "";
    }

    const hash: string = rawUrl.slice(hashIndex);

    if (!HASH_ROUTE_PATTERN.test(hash)) {
      return "";
    }

    const prefix: string = hash.startsWith("#!") ? "#!" : "#";
    let route: string = hash.slice(prefix.length);

    const queryIndex: number = route.indexOf("?");

    if (queryIndex !== -1) {
      route = route.slice(0, queryIndex);
    }

    return `${prefix}${UrlScrubber.scrubPath(route)}`;
  }

  /*
   * Take the snapshot after the router has had a chance to commit: the next
   * frame, then one macrotask after it. One in flight at a time; a burst of
   * navigations inside the window produces one snapshot of wherever the
   * burst ended.
   */
  private deferSnapshot(windowRef: Window): void {
    if (this.snapshotFrame !== null || this.snapshotTimer !== null) {
      return;
    }

    const afterFrame: () => void = (): void => {
      this.snapshotFrame = null;

      this.snapshotTimer = setTimeout((): void => {
        this.snapshotTimer = null;

        if (this.started) {
          this.options.requestFullSnapshot();
        }
      }, 0);
    };

    const raf: unknown = (windowRef as unknown as Record<string, unknown>)[
      "requestAnimationFrame"
    ];

    if (typeof raf === "function") {
      try {
        this.snapshotFrame = (raf as (callback: () => void) => number).call(
          windowRef,
          afterFrame,
        );
        return;
      } catch {
        /* Fall through to the timer-only path. */
      }
    }

    this.snapshotTimer = setTimeout((): void => {
      this.snapshotTimer = null;
      afterFrame();
    }, 0);
  }

  private cancelDeferredSnapshot(windowRef: Window): void {
    if (this.snapshotFrame !== null) {
      try {
        windowRef.cancelAnimationFrame(this.snapshotFrame);
      } catch {
        /* A window without cancelAnimationFrame: the guard in the callback covers it. */
      }

      this.snapshotFrame = null;
    }

    if (this.snapshotTimer !== null) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  public getCurrentUrl(): string {
    return this.describe(this.currentUrl);
  }

  public getRecordedCount(): number {
    return this.recordedCount;
  }

  public hasReachedCap(): boolean {
    return this.capReported;
  }
}

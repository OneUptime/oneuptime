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
 */

export const ROUTE_CUSTOM_EVENT_TAG: string = "oneuptime.route";

/*
 * A route change is a good moment for a fresh full snapshot: the DOM has
 * usually been replaced wholesale, so the incremental mutations are large and
 * a snapshot both compresses better and gives the player a seek anchor where
 * a viewer will actually want one. Rate-limited, because an app that
 * replaces its query string on every keystroke would otherwise trigger a
 * snapshot storm - each one a full serialisation of the document.
 */
const MIN_MS_BETWEEN_FORCED_SNAPSHOTS: number = 5000;

/* Per-page cap on recorded route events. */
const MAX_ROUTES_RECORDED: number = 500;

export interface RecordedRoute {
  from: string;
  to: string;
  kind: "pushState" | "replaceState" | "popstate" | "hashchange";
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
  private lastForcedSnapshotAtMs: number = 0;
  private currentUrl: string = "";

  private originalPushState: HistoryMethod | null = null;
  private originalReplaceState: HistoryMethod | null = null;

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
      this.handle(kind);
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
  }

  /*
   * Not private: the recorder also calls this on a bfcache restore, where the
   * URL may have changed while the page was frozen and no history event
   * fired at all.
   */
  public handle(kind: RecordedRoute["kind"], windowRef: Window = window): void {
    const rawUrl: string = windowRef.location.href;

    const from: string = this.options.scrubUrl(this.currentUrl);
    const to: string = this.options.scrubUrl(rawUrl);

    this.currentUrl = rawUrl;

    /*
     * Compared AFTER scrubbing, so a navigation that only changes a dropped
     * query parameter is not reported as a route change. The player would
     * otherwise show a route lane full of identical entries.
     */
    if (from === to) {
      return;
    }

    if (this.recordedCount >= MAX_ROUTES_RECORDED) {
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
      this.options.requestFullSnapshot();
    }
  }

  public getCurrentUrl(): string {
    return this.options.scrubUrl(this.currentUrl);
  }

  public getRecordedCount(): number {
    return this.recordedCount;
  }
}

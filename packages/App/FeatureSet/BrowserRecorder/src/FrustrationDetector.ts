/*
 * Frustration signals: rage click, dead click, error click, refresh rage.
 *
 * rrweb emits none of these - it records that a click happened, not that it
 * was the third angry one in a second. They are computed here, in the
 * browser, emitted as rrweb type-5 custom events so they ride inside the
 * opaque chunk with no schema change, AND counted on the envelope so the
 * ingest worker can populate the header columns without decompressing the
 * payload. That last part is what preserves the central bet: the hot path
 * never touches the payload.
 *
 * There is deliberately no composite "frustration score". An unexplained
 * 0-100 number inside an artifact presented as evidence is a liability
 * nobody can defend in an incident review. Ship the raw counters.
 */

export const FRUSTRATION_CUSTOM_EVENT_TAG: string = "oneuptime.frustration";

/* Rage click: 3+ clicks inside 1s within a 30px radius. */
const RAGE_CLICK_WINDOW_MS: number = 1000;
const RAGE_CLICK_RADIUS_PX: number = 30;
const RAGE_CLICK_THRESHOLD: number = 3;

/*
 * Dead click: a click on something that LOOKS clickable, is not a native
 * control, and produces no DOM mutation, navigation, scroll or network
 * request. 3s is long enough to cover a slow handler and short enough that
 * the verdict is still about that click.
 */
const DEAD_CLICK_TIMEOUT_MS: number = 3000;

/* Error click: an error within 1s of a click is attributed to that click. */
const ERROR_CLICK_WINDOW_MS: number = 1000;

/*
 * Native controls whose click is expected to do something the recorder may
 * not be able to see: an <a> unloads the page, an <input> takes focus, a
 * <select> opens a native popup, a <label> toggles its control. A click on
 * any of these is never a dead click, however quiet the DOM stays: a
 * checkbox that toggles nothing visible is a UI problem, not a broken
 * button. Focusable and editable elements are here for the same reason -
 * focus is not a mutation.
 */
const NATIVE_INTERACTIVE_SELECTOR: string =
  "a, button, input, select, textarea, label, summary, details, option, video, audio, iframe, [contenteditable], [tabindex]:not([tabindex='-1'])";

/*
 * Things that LOOK clickable without being native controls: the custom
 * components of every modern app. These are the dead-click CANDIDATES. A
 * click on plain markup - a paragraph, a heading, a card with no affordance
 * - is not: users click on text all the time (to select it, to focus the
 * page, by accident), and reporting each one trained customers to ignore the
 * frustration lane on any component-based app.
 */
const WIDGET_ROLE_SELECTOR: string =
  '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], [role="combobox"], [role="listbox"], [role="slider"], [role="spinbutton"], [role="searchbox"], [role="textbox"], [onclick], [draggable="true"]';

/* How far up the tree either classification looks. */
const MAX_ANCESTOR_DEPTH: number = 10;

export type FrustrationSignalKind =
  | "rage-click"
  | "dead-click"
  | "error-click"
  | "refresh-rage";

export interface FrustrationSignal {
  kind: FrustrationSignalKind;
  atUnixMs: number;

  /* Present for click-derived signals. Viewport coordinates, never content. */
  x?: number;
  y?: number;

  /* Number of clicks in the cluster, for rage clicks. */
  clickCount?: number;

  /* Number of reloads in the window, for refresh rage. */
  reloadCount?: number;
}

export interface FrustrationDetectorOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;
  onSignal: (signal: FrustrationSignal) => void;
}

interface ClickRecord {
  x: number;
  y: number;
  atMs: number;
}

interface PendingDeadClick {
  atMs: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

/*
 * An open rage cluster. Opened on the click that crosses the threshold and
 * kept open while clicks keep landing inside the window and the radius; it
 * closes - and is reported, with its REAL size - once the clicks stop. The
 * first version reported on the third click and threw the rest away, so a
 * ten-click burst was always "3 clicks" and a sustained five-second rage was
 * five separate signals of 3 rather than one of thirty.
 */
interface RageCluster {
  x: number;
  y: number;
  startedAtMs: number;
  lastClickAtMs: number;
  clickCount: number;
  timer: ReturnType<typeof setTimeout>;
}

export default class FrustrationDetector {
  private readonly options: FrustrationDetectorOptions;

  private started: boolean = false;

  private recentClicks: Array<ClickRecord> = [];
  private pendingDeadClicks: Array<PendingDeadClick> = [];
  private rageCluster: RageCluster | null = null;

  private lastClickAtMs: number = 0;
  private lastClickX: number = 0;
  private lastClickY: number = 0;
  private lastActivityAtMs: number = 0;

  private readonly clickListener: (event: MouseEvent) => void;
  private readonly activityListener: () => void;

  public constructor(options: FrustrationDetectorOptions) {
    this.options = options;

    this.clickListener = (event: MouseEvent): void => {
      this.handleClick(event);
    };

    this.activityListener = (): void => {
      this.notifyActivity(Date.now());
    };
  }

  public start(documentRef: Document = document): void {
    if (this.started) {
      return;
    }

    this.started = true;

    /*
     * Capture phase and passive: the detector must observe clicks a component
     * stops propagating (an "unresponsive" component is precisely the
     * interesting case) and must never delay the host page's own handling.
     */
    documentRef.addEventListener("click", this.clickListener as EventListener, {
      capture: true,
      passive: true,
    });

    /*
     * Two things a click can do that leave no DOM mutation behind: scroll
     * the page (an in-app "back to top", a carousel) and open a new window
     * or tab (the window loses focus). Both are activity.
     */
    documentRef.addEventListener("scroll", this.activityListener, {
      capture: true,
      passive: true,
    });

    const windowRef: Window | null = documentRef.defaultView;

    if (windowRef) {
      windowRef.addEventListener("blur", this.activityListener);
    }
  }

  public stop(documentRef: Document = document): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    documentRef.removeEventListener(
      "click",
      this.clickListener as EventListener,
      true,
    );
    documentRef.removeEventListener("scroll", this.activityListener, true);

    const windowRef: Window | null = documentRef.defaultView;

    if (windowRef) {
      windowRef.removeEventListener("blur", this.activityListener);
    }

    for (const pending of this.pendingDeadClicks) {
      clearTimeout(pending.timer);
    }

    this.pendingDeadClicks = [];
    this.recentClicks = [];

    /*
     * A cluster still open when recording stops is reported with what it
     * has: the clicks happened, and the recorder is about to flush.
     */
    if (this.rageCluster) {
      clearTimeout(this.rageCluster.timer);
      this.closeRageCluster();
    }
  }

  private handleClick(event: MouseEvent): void {
    const atMs: number = Date.now();

    const x: number = typeof event.clientX === "number" ? event.clientX : 0;
    const y: number = typeof event.clientY === "number" ? event.clientY : 0;

    this.lastClickAtMs = atMs;
    this.lastClickX = x;
    this.lastClickY = y;

    this.detectRageClick(x, y, atMs);
    this.armDeadClick(event, x, y, atMs);
  }

  private detectRageClick(x: number, y: number, atMs: number): void {
    const cluster: RageCluster | null = this.rageCluster;

    if (cluster) {
      if (
        atMs - cluster.lastClickAtMs <= RAGE_CLICK_WINDOW_MS &&
        FrustrationDetector.isWithinRadius(cluster.x, cluster.y, x, y)
      ) {
        cluster.clickCount++;
        cluster.lastClickAtMs = atMs;

        clearTimeout(cluster.timer);
        cluster.timer = this.armRageClusterTimer();
        return;
      }

      /* The user moved on, or paused: close what we have and start over. */
      clearTimeout(cluster.timer);
      this.closeRageCluster();
    }

    this.recentClicks = this.recentClicks.filter(
      (click: ClickRecord): boolean => {
        return atMs - click.atMs <= RAGE_CLICK_WINDOW_MS;
      },
    );

    this.recentClicks.push({ x: x, y: y, atMs: atMs });

    const nearby: Array<ClickRecord> = this.recentClicks.filter(
      (click: ClickRecord): boolean => {
        return FrustrationDetector.isWithinRadius(click.x, click.y, x, y);
      },
    );

    if (nearby.length < RAGE_CLICK_THRESHOLD) {
      return;
    }

    const first: ClickRecord = nearby[0] || { x: x, y: y, atMs: atMs };

    this.recentClicks = [];
    this.rageCluster = {
      x: first.x,
      y: first.y,
      startedAtMs: first.atMs,
      lastClickAtMs: atMs,
      clickCount: nearby.length,
      timer: this.armRageClusterTimer(),
    };
  }

  private armRageClusterTimer(): ReturnType<typeof setTimeout> {
    return setTimeout((): void => {
      this.closeRageCluster();
    }, RAGE_CLICK_WINDOW_MS);
  }

  private closeRageCluster(): void {
    const cluster: RageCluster | null = this.rageCluster;

    if (!cluster) {
      return;
    }

    this.rageCluster = null;

    this.report({
      kind: "rage-click",
      atUnixMs: cluster.startedAtMs,
      x: cluster.x,
      y: cluster.y,
      clickCount: cluster.clickCount,
    });
  }

  private static isWithinRadius(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): boolean {
    const dx: number = x1 - x2;
    const dy: number = y1 - y2;

    return dx * dx + dy * dy <= RAGE_CLICK_RADIUS_PX * RAGE_CLICK_RADIUS_PX;
  }

  private armDeadClick(
    event: MouseEvent,
    x: number,
    y: number,
    atMs: number,
  ): void {
    if (FrustrationDetector.isInteractive(event.target)) {
      return;
    }

    if (!FrustrationDetector.looksClickable(event.target)) {
      return;
    }

    const pending: PendingDeadClick = {
      atMs: atMs,
      x: x,
      y: y,
      timer: setTimeout((): void => {
        this.resolveDeadClick(pending);
      }, DEAD_CLICK_TIMEOUT_MS),
    };

    this.pendingDeadClicks.push(pending);
  }

  private resolveDeadClick(pending: PendingDeadClick): void {
    this.pendingDeadClicks = this.pendingDeadClicks.filter(
      (candidate: PendingDeadClick): boolean => {
        return candidate !== pending;
      },
    );

    /*
     * Anything the page did AT OR AFTER the click - a mutation, a
     * navigation, a request - clears it. The click was heard even if the
     * user could not see the result.
     *
     * "At or after", not "after": rrweb stamps a mutation batch with
     * Date.now() and delivers it as a microtask right behind the click
     * handler, so a synchronous DOM update routinely carries the SAME
     * millisecond as the click. A strict comparison reported every one of
     * those as dead.
     */
    if (this.lastActivityAtMs >= pending.atMs) {
      return;
    }

    this.report({
      kind: "dead-click",
      atUnixMs: pending.atMs,
      x: pending.x,
      y: pending.y,
    });
  }

  /*
   * Any page activity: a DOM mutation observed by rrweb, a completed network
   * request, or a navigation. Fed in from outside rather than observed here,
   * so the detector does not install a second MutationObserver over the whole
   * document alongside rrweb's.
   */
  public notifyActivity(atUnixMs: number): void {
    if (atUnixMs > this.lastActivityAtMs) {
      this.lastActivityAtMs = atUnixMs;
    }
  }

  /*
   * An error arrived. If a click happened in the last second, that click is
   * reported as an error click - the single most actionable frustration
   * signal, because it names the element that broke. It carries the click's
   * coordinates, so the player can draw it where it happened.
   */
  public notifyError(atUnixMs: number): void {
    if (this.lastClickAtMs === 0) {
      return;
    }

    if (atUnixMs - this.lastClickAtMs > ERROR_CLICK_WINDOW_MS) {
      return;
    }

    const clickAtMs: number = this.lastClickAtMs;

    /*
     * Consumed, so a burst of three rejections from one click reports one
     * error click rather than three.
     */
    this.lastClickAtMs = 0;

    this.report({
      kind: "error-click",
      atUnixMs: clickAtMs,
      x: this.lastClickX,
      y: this.lastClickY,
    });
  }

  /*
   * Refresh rage is detected from the reload log in SessionId, because it is
   * the one signal that has to survive a page load. The count is passed in
   * here so it is reported and counted through the same path as the others.
   */
  public reportRefreshRage(reloadCount: number, atUnixMs: number): void {
    this.report({
      kind: "refresh-rage",
      atUnixMs: atUnixMs,
      reloadCount: reloadCount,
    });
  }

  private report(signal: FrustrationSignal): void {
    this.options.emitCustomEvent(FRUSTRATION_CUSTOM_EVENT_TAG, signal);
    this.options.onSignal(signal);
  }

  /*
   * Is this click target a native control, whose click is expected to do
   * something we may not be able to observe?
   *
   * Walks ancestors because the click target is often a <span> inside a
   * <button>. Depth-limited so a pathological tree cannot turn every click
   * into a long walk on the customer's main thread.
   */
  public static isInteractive(target: EventTarget | null): boolean {
    return FrustrationDetector.matchesUpTree(
      target,
      NATIVE_INTERACTIVE_SELECTOR,
      /* onUnclassifiable */ true,
    );
  }

  /*
   * Does this click target LOOK clickable - a widget role, an onclick
   * attribute, or a pointer cursor - without being a native control? These
   * are the dead-click candidates. Plain markup is not one.
   */
  public static looksClickable(target: EventTarget | null): boolean {
    if (
      FrustrationDetector.matchesUpTree(
        target,
        WIDGET_ROLE_SELECTOR,
        /* onUnclassifiable */ false,
      )
    ) {
      return true;
    }

    return FrustrationDetector.hasPointerCursor(target);
  }

  private static matchesUpTree(
    target: EventTarget | null,
    selector: string,
    onUnclassifiable: boolean,
  ): boolean {
    if (
      !target ||
      typeof Element === "undefined" ||
      !(target instanceof Element)
    ) {
      return false;
    }

    let element: Element | null = target;
    let depth: number = 0;

    while (element && depth < MAX_ANCESTOR_DEPTH) {
      try {
        if (element.matches(selector)) {
          return true;
        }
      } catch {
        /*
         * matches() throws on a detached node in some engines. A click on a
         * node we cannot classify is treated as interactive, because
         * reporting a false dead click is worse than missing a real one:
         * this number ends up in front of the customer's designers.
         */
        return onUnclassifiable;
      }

      element = element.parentElement;
      depth++;
    }

    return false;
  }

  /*
   * cursor: pointer is the one affordance every framework agrees on. Read
   * from computed style on the target and a few ancestors (the cursor is
   * inherited, so the target itself usually carries it). getComputedStyle
   * forces a style resolution, which is fine per click and would not be
   * fine per mutation - this is only ever called from the click listener.
   */
  private static hasPointerCursor(target: EventTarget | null): boolean {
    if (
      !target ||
      typeof Element === "undefined" ||
      !(target instanceof Element)
    ) {
      return false;
    }

    const view: Window | null = target.ownerDocument
      ? target.ownerDocument.defaultView
      : null;

    if (!view || typeof view.getComputedStyle !== "function") {
      return false;
    }

    try {
      return view.getComputedStyle(target).cursor === "pointer";
    } catch {
      return false;
    }
  }
}

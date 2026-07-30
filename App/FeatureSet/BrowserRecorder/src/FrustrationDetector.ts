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
 * Dead click: a click on a non-interactive element that produces no DOM
 * mutation, navigation or network request. 3s is long enough to cover a slow
 * handler and short enough that the verdict is still about that click.
 */
const DEAD_CLICK_TIMEOUT_MS: number = 3000;

/* Error click: an error within 1s of a click is attributed to that click. */
const ERROR_CLICK_WINDOW_MS: number = 1000;

/*
 * Elements whose click is expected to do something. A click on anything in
 * here is never a dead click, however quiet the page stays: a checkbox that
 * toggles nothing visible is a UI problem, not a broken button.
 */
const INTERACTIVE_SELECTOR: string =
  'a, button, input, select, textarea, label, summary, details, option, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [contenteditable], [tabindex]:not([tabindex="-1"])';

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

export default class FrustrationDetector {
  private readonly options: FrustrationDetectorOptions;

  private started: boolean = false;

  private recentClicks: Array<ClickRecord> = [];
  private pendingDeadClicks: Array<PendingDeadClick> = [];

  private lastClickAtMs: number = 0;
  private lastActivityAtMs: number = 0;

  /*
   * Clicks already counted as part of a rage cluster. Without this a burst of
   * six clicks reports four overlapping rage clicks instead of one.
   */
  private rageClusterEndsAtMs: number = 0;

  private readonly clickListener: (event: MouseEvent) => void;

  public constructor(options: FrustrationDetectorOptions) {
    this.options = options;

    this.clickListener = (event: MouseEvent): void => {
      this.handleClick(event);
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

    for (const pending of this.pendingDeadClicks) {
      clearTimeout(pending.timer);
    }

    this.pendingDeadClicks = [];
    this.recentClicks = [];
  }

  private handleClick(event: MouseEvent): void {
    const atMs: number = Date.now();

    this.lastClickAtMs = atMs;

    const x: number = typeof event.clientX === "number" ? event.clientX : 0;
    const y: number = typeof event.clientY === "number" ? event.clientY : 0;

    this.detectRageClick(x, y, atMs);
    this.armDeadClick(event, x, y, atMs);
  }

  private detectRageClick(x: number, y: number, atMs: number): void {
    this.recentClicks = this.recentClicks.filter(
      (click: ClickRecord): boolean => {
        return atMs - click.atMs <= RAGE_CLICK_WINDOW_MS;
      },
    );

    this.recentClicks.push({ x: x, y: y, atMs: atMs });

    const nearby: Array<ClickRecord> = this.recentClicks.filter(
      (click: ClickRecord): boolean => {
        const dx: number = click.x - x;
        const dy: number = click.y - y;

        return dx * dx + dy * dy <= RAGE_CLICK_RADIUS_PX * RAGE_CLICK_RADIUS_PX;
      },
    );

    if (nearby.length < RAGE_CLICK_THRESHOLD) {
      return;
    }

    if (atMs <= this.rageClusterEndsAtMs) {
      return;
    }

    this.rageClusterEndsAtMs = atMs + RAGE_CLICK_WINDOW_MS;
    this.recentClicks = [];

    this.report({
      kind: "rage-click",
      atUnixMs: atMs,
      x: x,
      y: y,
      clickCount: nearby.length,
    });
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
     * Anything the page did after the click - a mutation, a navigation, a
     * request - clears it. The click was heard even if the user could not see
     * the result.
     */
    if (this.lastActivityAtMs > pending.atMs) {
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
   * signal, because it names the element that broke.
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

    this.report({ kind: "error-click", atUnixMs: clickAtMs });
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
   * Is this click target expected to do something?
   *
   * Walks ancestors because the click target is often a <span> inside a
   * <button>. Depth-limited so a pathological tree cannot turn every click
   * into a long walk on the customer's main thread.
   */
  public static isInteractive(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) {
      return false;
    }

    let element: Element | null = target;
    let depth: number = 0;

    while (element && depth < 10) {
      try {
        if (element.matches(INTERACTIVE_SELECTOR)) {
          return true;
        }
      } catch {
        /*
         * matches() throws on a detached node in some engines. A click on a
         * node we cannot classify is treated as interactive, because
         * reporting a false dead click is worse than missing a real one:
         * this number ends up in front of the customer's designers.
         */
        return true;
      }

      element = element.parentElement;
      depth++;
    }

    return false;
  }
}

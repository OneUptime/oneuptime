import Route from "../../Types/API/Route";

/*
 * A place on a page, named after the "#" of the page's address - the way a
 * link lands on one setting of a settings page rather than on its top:
 * ".../code/repositories/<id>/settings#runner".
 *
 * A page names its places with short, plain names (a letter, then letters,
 * digits, "-" and "_"), and each place is the element with that id - a card
 * (Card's `id`). A link to one of them opens the page there:
 *
 *   - a page's More settings opens by itself when the page is opened at a
 *     card inside it (AdvancedPageSection), so nobody lands on a folded
 *     section and has to find the setting they were sent to;
 *   - the place is brought into view under the page's sticky header, and
 *     kept there while the page around it settles - the cards above it load
 *     and grow, a fold opens - until the person scrolls, clicks, touches or
 *     types, when where the page is becomes theirs to say.
 *
 * React-free, so App's tests and any page read the same rules.
 */

// A place's name: plain, so it reads the same in any address.
const PAGE_ANCHOR_NAME: RegExp = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Whether a name can name a place on a page (see PAGE_ANCHOR_NAME).
export function isPageAnchorName(name: string): boolean {
  return PAGE_ANCHOR_NAME.test(name);
}

/*
 * The place the current address names after its "#": "runner" for
 * ".../settings#runner". Empty when it names none - or names something no
 * page names a place by (anything but a plain name).
 */
export function getPageAnchor(): string {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }

  const hash: string = window.location.hash || "";

  if (!hash.startsWith("#")) {
    return "";
  }

  let name: string = "";

  try {
    name = decodeURIComponent(hash.substring(1));
  } catch {
    // A "#" no browser would write (a stray "%"): it names no place.
    return "";
  }

  return isPageAnchorName(name) ? name : "";
}

/*
 * A link to a place on a page: the page's route with "#<place>" after it -
 * after its query string, where it has one, and instead of any "#" it
 * already had. A name that cannot name a place leaves the route as it is.
 */
export function getRouteToPageAnchor(route: Route, anchor: string): Route {
  const page: string = route.toString().split("#")[0] || "";

  if (!isPageAnchorName(anchor)) {
    return new Route(page);
  }

  return new Route(`${page}#${anchor}`);
}

/*
 * How far below the top of the window a place lands: under the page's
 * sticky header, whose height MasterPage publishes as --app-header-height,
 * with a little room above it - the gap the side menu keeps under the
 * header too. Set on the place itself (Card does, for a card with an id) as
 * its scroll-margin-top, so the browser's own scrolling keeps it clear of
 * the header in any scrolling box.
 */
export const PAGE_ANCHOR_SCROLL_MARGIN_TOP: string =
  "calc(var(--app-header-height, 0px) + 1.5rem)";

/*
 * How long a place is kept in view while the page around it settles: long
 * enough for the cards above it to read their records, short enough that a
 * page never fights the person reading it.
 */
export const PAGE_ANCHOR_SETTLE_IN_MS: number = 3000;

/*
 * What a person does that ends the wait at once: from then on the page is
 * where they put it. Scrolling by the page's own hand (a place brought into
 * view) fires none of these, so it never ends the wait itself.
 */
export const PAGE_ANCHOR_RELEASING_EVENTS: ReadonlyArray<string> = [
  "wheel",
  "touchstart",
  "mousedown",
  "keydown",
];

export interface PageAnchorViewOptions {
  // How long to keep it in view; PAGE_ANCHOR_SETTLE_IN_MS when left out.
  settleInMs?: number | undefined;
}

/*
 * Brings a place on the page into view - its top under the sticky header -
 * once the browser has drawn it, and again each time the page changes size
 * while it settles (cards above it loading, a fold opening), until the
 * settle time is up or the person scrolls, clicks, touches or types.
 * Returns what stops it early: a page that goes away, or a place that is
 * not wanted any more.
 *
 * It scrolls instantly, never smoothly: it may scroll several times while
 * the page settles, and each time it must end where the place is.
 */
export function bringPageAnchorIntoView(
  element: HTMLElement,
  options?: PageAnchorViewOptions | undefined,
): () => void {
  let isStopped: boolean = false;
  let frame: number | null = null;
  let frameIsTimeout: boolean = false;

  const scroll: () => void = (): void => {
    frame = null;

    if (isStopped || !element.isConnected) {
      return;
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "start" });
    }
  };

  // One scroll per frame, however many changes it follows.
  const scheduleScroll: () => void = (): void => {
    if (isStopped || frame !== null) {
      return;
    }

    if (typeof window.requestAnimationFrame === "function") {
      frameIsTimeout = false;
      frame = window.requestAnimationFrame(scroll);
      return;
    }

    frameIsTimeout = true;
    frame = window.setTimeout(scroll, 0);
  };

  /*
   * The page changes size as what is above the place loads: the place
   * moves, so it is brought back. ResizeObserver is missing in older
   * browsers and in jsdom; there the place is brought into view once.
   */
  const observer: ResizeObserver | null =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((): void => {
          scheduleScroll();
        });

  observer?.observe(document.body);

  let settleTimer: number | null = null;

  const stop: () => void = (): void => {
    if (isStopped) {
      return;
    }

    isStopped = true;

    if (frame !== null) {
      if (frameIsTimeout) {
        window.clearTimeout(frame);
      } else if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      }

      frame = null;
    }

    observer?.disconnect();

    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }

    for (const eventName of PAGE_ANCHOR_RELEASING_EVENTS) {
      window.removeEventListener(eventName, stop, true);
    }
  };

  for (const eventName of PAGE_ANCHOR_RELEASING_EVENTS) {
    window.addEventListener(eventName, stop, { capture: true, passive: true });
  }

  settleTimer = window.setTimeout(
    stop,
    options?.settleInMs ?? PAGE_ANCHOR_SETTLE_IN_MS,
  );

  scheduleScroll();

  return stop;
}

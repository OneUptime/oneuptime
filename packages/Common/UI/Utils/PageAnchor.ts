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
 *     types, when where the page is becomes theirs to say;
 *   - the place a link landed on is tinted for a moment, the tint fading,
 *     and holds the keyboard's focus (markPageAnchorLanded): the eye finds
 *     the setting the link was for among the ones around it, and Tab goes
 *     on from it, not from the top of the page.
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
 * The place a card is named by after its title, where its page names it by
 * nothing else: "Default Bar Color" is "default-bar-color". The letters and
 * digits of the title as the page wrote it (its English words, which the
 * card looks up in the reader's language), lower-cased, with each run of
 * anything else between them one "-". Empty - no place - for a title that
 * is not text, or holds no letter to start a name with (a title in another
 * script). Read one character at a time: a title of any length takes time
 * in line with it.
 */
export function getPageAnchorNameForTitle(title: unknown): string {
  if (typeof title !== "string") {
    return "";
  }

  let name: string = "";
  let isAfterSeparator: boolean = false;

  for (const character of title) {
    const lower: string = character.toLowerCase();
    const isLetterOrDigit: boolean =
      (lower >= "a" && lower <= "z") || (lower >= "0" && lower <= "9");

    if (!isLetterOrDigit) {
      isAfterSeparator = true;
      continue;
    }

    if (isAfterSeparator && name) {
      name += "-";
    }

    isAfterSeparator = false;
    name += lower;
  }

  return isPageAnchorName(name) ? name : "";
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
 * Where a place drawn as a section of a card lands - a card in More
 * settings, whose sections a divider parts: with its divider right under
 * the sticky header, its own padding the room above its title. With the
 * page's gap above it as well, a strip of the setting above it showed
 * between the header and the divider, cut off mid-line.
 */
export const PAGE_ANCHOR_SECTION_SCROLL_MARGIN_TOP: string =
  "var(--app-header-height, 0px)";

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

/*
 * What the place a link landed on carries while it is marked:
 * Styles/Theme.css tints it and fades the tint out - or, for a reader who
 * asks for less motion, holds it still until the mark goes.
 */
export const PAGE_ANCHOR_LANDED_ATTRIBUTE: string = "data-page-anchor-landed";

/*
 * What a place carries while it holds the focus a landing gave it: after a
 * link followed with the keyboard, Theme.css rings it inside its edge, as
 * a row's focus ring is drawn, so the card it is a section of does not
 * clip the ring. It goes, with the tabindex that let the place take the
 * focus, when the focus moves on.
 */
export const PAGE_ANCHOR_FOCUSED_ATTRIBUTE: string = "data-page-anchor-focused";

// How long a place a link landed on stays marked: the tint's fade (Theme.css).
export const PAGE_ANCHOR_LANDED_IN_MS: number = 2400;

export interface PageAnchorLandedOptions {
  // How long it stays marked; PAGE_ANCHOR_LANDED_IN_MS when left out.
  landedInMs?: number | undefined;
  /*
   * The control on the same page that took the person there - a "Go to
   * Affected Resources" button. Clicking or pressing it gave it the focus,
   * and it hands that focus on to the place, as following a link does:
   * otherwise Tab would go on from a button scrolled out of sight, and a
   * screen reader would never hear where the page went.
   */
  takesFocusFrom?: Element | null | undefined;
}

/*
 * Marks the place a link landed on - "Pick a Runner" landing on a
 * repository's Runner - for a moment (PAGE_ANCHOR_LANDED_ATTRIBUTE), so the
 * eye finds it among the settings around it: on a tall screen the page
 * cannot scroll a setting near its end to the top, and the one the link was
 * for is not the first one in sight.
 *
 * And, when nothing else holds the keyboard's focus - a page just opened,
 * or the control that took the person there (takesFocusFrom) - gives it to
 * the place, so Tab goes on from the setting the link was for (its Edit,
 * its switch) rather than from the top of the page, and a screen reader
 * reads where it landed. A place that cannot take focus takes it for as
 * long as it holds it (tabindex -1). Focus anywhere else - a field the
 * person is typing in - is never taken.
 *
 * Returns what unmarks it at once: a page that goes away, or a link that
 * lands somewhere else.
 */
export function markPageAnchorLanded(
  element: HTMLElement,
  options?: PageAnchorLandedOptions | undefined,
): () => void {
  let timer: number | null = null;

  const unmark: () => void = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }

    element.removeAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE);
  };

  element.setAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");

  const focused: Element | null = document.activeElement;
  const takesFocusFrom: Element | null = options?.takesFocusFrom || null;
  const isFocusFree: boolean =
    !focused ||
    focused === document.body ||
    focused === document.documentElement ||
    (takesFocusFrom !== null && focused === takesFocusFrom);

  if (isFocusFree && typeof element.focus === "function") {
    const hadTabIndex: boolean = element.hasAttribute("tabindex");

    const release: () => void = (): void => {
      element.removeAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE);

      if (!hadTabIndex) {
        element.removeAttribute("tabindex");
      }
    };

    if (!hadTabIndex) {
      element.setAttribute("tabindex", "-1");
    }

    element.setAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE, "true");
    // It is brought into view, under the header, by bringPageAnchorIntoView.
    element.focus({ preventScroll: true });

    if (document.activeElement === element) {
      element.addEventListener("blur", release, { once: true });
    } else {
      // It could not take the focus (out of sight): it keeps none of this.
      release();
    }
  }

  timer = window.setTimeout(
    unmark,
    options?.landedInMs ?? PAGE_ANCHOR_LANDED_IN_MS,
  );

  return unmark;
}

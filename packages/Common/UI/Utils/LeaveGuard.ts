/*
 * Asking before a page that holds unsaved work is left.
 *
 * A page whose work is not saved yet - a dashboard being edited - holds the
 * guard while that is so (useLeaveGuard). Until it lets go:
 *
 *   - opening another page inside the app asks the page first, and goes on
 *     only once the page says so: a side menu entry, a crumb, the header, the
 *     command palette and every other link (Navigation.navigate, AppLink);
 *   - the browser's Back and Forward buttons ask the same. The router never
 *     hears the step: it is taken back at once, so the page and its address
 *     stay as they were, and taken again only once the page says so;
 *   - closing or reloading the tab, or a link that loads a page in full,
 *     asks through the browser's own dialog (beforeunload), the one place a
 *     page cannot draw its own.
 *
 * A step that stays on the page - a query or a hash on the same path - asks
 * nothing: nothing on the page is lost. While no page holds the guard,
 * nothing asks anything and every navigation goes on at once, exactly as it
 * always did.
 *
 * The page asks in its own words (askToLeave): it is handed the step to take
 * if the reader lets the work go, and takes it, or drops it to stay. Taking
 * it lets the guard go first, so nothing asks twice - the browser's dialog
 * included, for a step that loads a page in full.
 *
 * Back and Forward keep the page where it is scrolled to (issue #7404). A
 * browser puts back the scroll position of the history entry a step
 * reaches - the page before, usually at its top - right after popstate and
 * before it next draws: Chromium, Firefox and WebKit alike. Taken back at
 * once, the step left that position on the screen for a frame or more in
 * Firefox and WebKit (the page shown at its top behind the question, then
 * jumping back down), and in Chromium it left the page before with the
 * guarded page's position: Discard Changes opened it scrolled down. So the
 * step is taken back in the next animation frame instead, after the
 * browser has put that entry's position back and before anything is drawn:
 * the guard reads that position - the entry's own - and scrolls the page
 * back to where the reader had it, so no frame shows the other one. The
 * browser then keeps the page's position for the entry the step reached,
 * as it leaves it; the guard remembers that entry's own, and puts it back
 * when the tab arrives there again (Discard Changes, or Back later on).
 */

import OldestKeyMap from "../../Utils/OldestKeyMap";

// Takes the step the reader was asked about.
export type LeavePageFunction = () => void;

/*
 * Asks the reader whether to leave: called with the step to take if they
 * let the unsaved work go. Dropping it keeps them on the page.
 */
export type AskToLeaveFunction = (leave: LeavePageFunction) => void;

interface LeaveGuardHold {
  token: symbol;
  askToLeave: AskToLeaveFunction;
}

/*
 * The history entry the page the guard holds is shown at: where a step the
 * router never heard is taken back to.
 */
interface GuardedEntry {
  pathname: string;
  href: string;
  state: unknown;
  // The router's place for it in the tab's history (react-router's idx).
  index: number | null;
}

/*
 * The router's index of a history entry. react-router numbers every entry
 * it makes (and the one the app opened on) in its state's idx; an entry
 * made some other way (a bare hash link) has none.
 */
const readHistoryIndex: (state: unknown) => number | null = (
  state: unknown,
): number | null => {
  if (!state || typeof state !== "object") {
    return null;
  }

  const index: unknown = (state as { idx?: unknown }).idx;

  return typeof index === "number" && Number.isFinite(index) ? index : null;
};

const readShownEntry: () => GuardedEntry = (): GuardedEntry => {
  return {
    pathname: window.location.pathname,
    href: window.location.href,
    state: window.history.state,
    index: readHistoryIndex(window.history.state),
  };
};

/*
 * A history entry, told apart from every other: react-router's key for it
 * (the same address opened twice is two entries), or its address for an
 * entry the router did not make.
 */
const readEntryKey: (state: unknown, href: string) => string = (
  state: unknown,
  href: string,
): string => {
  if (state && typeof state === "object") {
    const key: unknown = (state as { key?: unknown }).key;

    if (typeof key === "string" && key) {
      return `key:${key}`;
    }
  }

  return `href:${href}`;
};

const readShownEntryKey: () => string = (): string => {
  return readEntryKey(window.history.state, window.location.href);
};

// Where the page is scrolled to.
export interface ScrollPlace {
  x: number;
  y: number;
}

const readScrollPlace: () => ScrollPlace = (): ScrollPlace => {
  return { x: window.scrollX || 0, y: window.scrollY || 0 };
};

const isSamePlace: (first: ScrollPlace, second: ScrollPlace) => boolean = (
  first: ScrollPlace,
  second: ScrollPlace,
): boolean => {
  return first.x === second.x && first.y === second.y;
};

const scrollPageTo: (place: ScrollPlace) => void = (
  place: ScrollPlace,
): void => {
  if (!isSamePlace(place, readScrollPlace())) {
    window.scrollTo(place.x, place.y);
  }
};

/*
 * How long a Back or Forward step waits for the next frame before it is
 * taken back without one: a tab that is not shown draws no frames.
 */
export const SCROLL_RESTORE_WAIT_MS: number = 100;

/*
 * Runs `step` once the browser has put back the scroll position of the
 * history entry it just reached. Browsers do that after popstate, before
 * they next draw: so in the next animation frame, which runs before that
 * frame is drawn - or, in a tab that draws none, after a short wait.
 */
const afterScrollRestore: (step: () => void) => void = (
  step: () => void,
): void => {
  let isTaken: boolean = false;

  const takeOnce: () => void = (): void => {
    if (isTaken) {
      return;
    }

    isTaken = true;
    step();
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(takeOnce);
  }

  window.setTimeout(takeOnce, SCROLL_RESTORE_WAIT_MS);
};

// More entries than a reader walks Back and Forward through while editing.
export const OWN_PLACES_MAX_ENTRIES: number = 25;

/*
 * React Router reads `/a/b` and `/a/b/` as one place, so a step between them
 * stays on the page. Case is kept: a record's id in another case names
 * another record.
 */
const withoutTrailingSlashes: (pathname: string) => string = (
  pathname: string,
): string => {
  let trimmed: string = pathname;

  while (trimmed.length > 1 && trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
};

const isSamePath: (first: string, second: string) => boolean = (
  first: string,
  second: string,
): boolean => {
  return withoutTrailingSlashes(first) === withoutTrailingSlashes(second);
};

/*
 * Whether there is a window to listen on: a browser's, or the DOM a test
 * builds. Code that loads this module without one - a server render, or a
 * test that stands a bare `{ location, history }` in for the window before
 * it loads what Navigation pulls in - has nothing to hear Back or Forward
 * on, and must still be able to load it.
 */
const canListenOnWindow: () => boolean = (): boolean => {
  return (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  );
};

export default class LeaveGuard {
  // The pages holding the guard, the latest last: it is the one that asks.
  private static holds: Array<LeaveGuardHold> = [];

  private static guardedEntry: GuardedEntry | null = null;

  /*
   * A Back or Forward step to another page is being taken back, and the
   * browser has not landed on the guarded page again yet.
   */
  private static isTakingStepBack: boolean = false;

  /*
   * A step back waits for the next frame (afterScrollRestore) while
   * isStepBackWaiting; reset() drops it by moving the turn on.
   */
  private static stepBackTurn: number = 0;

  private static isStepBackWaiting: boolean = false;

  // Where the page the guard holds is scrolled to, while it holds.
  private static shownPlace: ScrollPlace | null = null;

  /*
   * Entries whose scroll position the browser no longer has, by entry: the
   * guard scrolled the page back while the tab was on one, and the browser
   * kept that position for it as it left. Its own, to put back when the tab
   * arrives there again.
   */
  private static ownPlaces: OldestKeyMap<string, ScrollPlace> =
    new OldestKeyMap<string, ScrollPlace>();

  private static isListeningForSteps: boolean = false;

  /*
   * Listens for the browser's Back and Forward, once, for as long as the
   * tab shows the app: called as this module loads, before the router
   * mounts. The router listens on the window too, and Chromium runs a
   * window's popstate listeners in the order they were added, capturing
   * or not (the DOM standard, and jsdom, run capturing ones first): only a
   * listener added before the router's is sure to hear a step first, and
   * keep it from the router. While no page holds the guard, it does
   * nothing.
   */
  public static listenForBackAndForward(): void {
    if (LeaveGuard.isListeningForSteps || !canListenOnWindow()) {
      return;
    }

    LeaveGuard.isListeningForSteps = true;
    window.addEventListener("popstate", LeaveGuard.onPopState, true);
  }

  /*
   * Holds the guard until the returned function is called. `askToLeave` is
   * how the page asks; with several holders, the latest asks.
   */
  public static hold(askToLeave: AskToLeaveFunction): () => void {
    const hold: LeaveGuardHold = {
      token: Symbol("leave-guard"),
      askToLeave: askToLeave,
    };

    LeaveGuard.holds.push(hold);

    if (LeaveGuard.holds.length === 1) {
      LeaveGuard.start();
    }

    return (): void => {
      LeaveGuard.release(hold.token);
    };
  }

  public static isHeld(): boolean {
    return LeaveGuard.holds.length > 0;
  }

  /*
   * Whether going to this address asks first: a page holds the guard, and
   * the address is another page than the one it holds.
   */
  public static asksBeforeGoingTo(address: string): boolean {
    return LeaveGuard.isHeld() && LeaveGuard.isAnotherPage(address);
  }

  /*
   * Takes a step to this address inside the app - at once, or once the page
   * that holds the guard lets its work go. A page that keeps the reader
   * drops the step.
   */
  public static whenLeaving(address: string, leave: LeavePageFunction): void {
    const hold: LeaveGuardHold | undefined = LeaveGuard.getAskingHold();

    if (!hold || !LeaveGuard.isAnotherPage(address)) {
      leave();
      return;
    }

    hold.askToLeave(
      LeaveGuard.letGoAndThen(() => {
        leave();
      }),
    );
  }

  /*
   * The page the guard holds is shown again (it drew): the entry it is shown
   * at now, should a step inside the page have moved it. Not while a step
   * the router never heard is being taken back: the browser is still on the
   * page that step went to.
   */
  public static noteShownEntry(): void {
    if (!LeaveGuard.guardedEntry || LeaveGuard.isTakingStepBack) {
      return;
    }

    if (
      !isSamePath(window.location.pathname, LeaveGuard.guardedEntry.pathname)
    ) {
      return;
    }

    LeaveGuard.guardedEntry = readShownEntry();
  }

  // For tests: lets every hold go, as if no page had held the guard.
  public static reset(): void {
    LeaveGuard.holds = [];
    LeaveGuard.stop();
    LeaveGuard.ownPlaces.clear();
    // A step back still waiting for its frame is dropped.
    LeaveGuard.isStepBackWaiting = false;
    LeaveGuard.stepBackTurn += 1;
  }

  private static getAskingHold(): LeaveGuardHold | undefined {
    return LeaveGuard.holds[LeaveGuard.holds.length - 1];
  }

  private static isAnotherPage(address: string): boolean {
    const guardedPathname: string = LeaveGuard.guardedEntry
      ? LeaveGuard.guardedEntry.pathname
      : window.location.pathname;

    try {
      return !isSamePath(
        new window.URL(address, window.location.href).pathname,
        guardedPathname,
      );
    } catch {
      // An address that cannot be read: asking loses nothing.
      return true;
    }
  }

  /*
   * The step the reader was asked about, taken once: the guard is let go
   * first, so neither it nor the browser's dialog asks about it again.
   */
  private static letGoAndThen(step: () => void): LeavePageFunction {
    let isTaken: boolean = false;

    return (): void => {
      if (isTaken) {
        return;
      }

      isTaken = true;
      LeaveGuard.holds = [];
      LeaveGuard.stop();
      step();
    };
  }

  private static start(): void {
    if (typeof window === "undefined") {
      return;
    }

    LeaveGuard.guardedEntry = readShownEntry();
    LeaveGuard.isTakingStepBack = false;
    LeaveGuard.shownPlace = readScrollPlace();

    // Back and Forward: heard all along (listenForBackAndForward).
    window.addEventListener("beforeunload", LeaveGuard.onBeforeUnload);
    window.addEventListener("scroll", LeaveGuard.onScroll, { passive: true });
  }

  private static stop(): void {
    LeaveGuard.guardedEntry = null;
    LeaveGuard.isTakingStepBack = false;
    LeaveGuard.shownPlace = null;

    if (typeof window === "undefined") {
      return;
    }

    window.removeEventListener("beforeunload", LeaveGuard.onBeforeUnload);
    window.removeEventListener("scroll", LeaveGuard.onScroll);
  }

  /*
   * The page the guard holds, scrolled: where to keep it should a step be
   * taken back. Not while the tab is on another entry - the browser putting
   * back that entry's position, or the guard scrolling the page back.
   */
  private static onScroll(): void {
    const guardedEntry: GuardedEntry | null = LeaveGuard.guardedEntry;

    if (
      !guardedEntry ||
      LeaveGuard.isTakingStepBack ||
      !isSamePath(window.location.pathname, guardedEntry.pathname)
    ) {
      return;
    }

    LeaveGuard.shownPlace = readScrollPlace();
  }

  // An entry's own place, the first time the browser loses it to the guard.
  private static rememberOwnPlace(entryKey: string, place: ScrollPlace): void {
    if (LeaveGuard.ownPlaces.has(entryKey)) {
      return;
    }

    LeaveGuard.ownPlaces.set(entryKey, place);

    while (LeaveGuard.ownPlaces.size > OWN_PLACES_MAX_ENTRIES) {
      const oldest: string | undefined = LeaveGuard.ownPlaces.oldestKey();

      if (oldest === undefined) {
        break;
      }

      LeaveGuard.ownPlaces.delete(oldest);
    }
  }

  /*
   * The tab arrived at an entry whose own place the browser lost to the
   * guard: once the browser has put back the place it kept instead, the
   * entry's own goes back. Once only: from then on, the browser keeps it.
   */
  private static putBackOwnPlace(): void {
    if (LeaveGuard.ownPlaces.size === 0) {
      return;
    }

    const entryKey: string = readShownEntryKey();
    const place: ScrollPlace | undefined = LeaveGuard.ownPlaces.get(entryKey);

    if (!place) {
      return;
    }

    LeaveGuard.ownPlaces.delete(entryKey);

    afterScrollRestore(() => {
      // Not if the tab moved on meanwhile.
      if (readShownEntryKey() === entryKey) {
        scrollPageTo(place);
      }
    });
  }

  private static release(token: symbol): void {
    const wasHeld: boolean = LeaveGuard.isHeld();

    LeaveGuard.holds = LeaveGuard.holds.filter((hold: LeaveGuardHold) => {
      return hold.token !== token;
    });

    if (wasHeld && !LeaveGuard.isHeld()) {
      LeaveGuard.stop();
    }
  }

  // Closing or reloading the tab, or a page loaded in full: the browser asks.
  private static onBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    // Older browsers ask only when returnValue is set.
    event.returnValue = "";
  }

  private static onPopState(event: PopStateEvent): void {
    const guardedEntry: GuardedEntry | null = LeaveGuard.guardedEntry;
    const hold: LeaveGuardHold | undefined = LeaveGuard.getAskingHold();

    if (!guardedEntry || !hold) {
      /*
       * Nothing to keep: the step goes to the router, as always. The entry
       * it reached gets its own place back if the guard made the browser
       * lose it (Discard Changes after Back, or Back once the work was
       * saved).
       */
      LeaveGuard.putBackOwnPlace();
      return;
    }

    if (isSamePath(window.location.pathname, guardedEntry.pathname)) {
      /*
       * On the guarded page: the step this took back has landed (the router
       * never heard the step, so it hears nothing of its return either), or
       * a step inside the page - a hash, a query - which the router reads
       * as usual.
       */
      if (LeaveGuard.isTakingStepBack) {
        LeaveGuard.isTakingStepBack = false;
        event.stopImmediatePropagation();
      }

      LeaveGuard.guardedEntry = readShownEntry();
      return;
    }

    /*
     * A step to another page. The router must not hear it: it would show
     * that page, and the unsaved work would go with this one. It is taken
     * back once the browser has put back the position of the entry it
     * reached (see the top of this file); a second step meanwhile (Back
     * pressed twice) is taken back with it, from wherever the tab is then.
     */
    event.stopImmediatePropagation();
    LeaveGuard.isTakingStepBack = true;

    if (LeaveGuard.isStepBackWaiting) {
      return;
    }

    LeaveGuard.isStepBackWaiting = true;

    const turn: number = LeaveGuard.stepBackTurn;

    afterScrollRestore(() => {
      if (turn === LeaveGuard.stepBackTurn) {
        LeaveGuard.takeStepBack();
      }
    });
  }

  /*
   * Takes the tab back to the page the guard holds from the entry a Back or
   * Forward step reached, with the page where the reader had it, and asks.
   */
  private static takeStepBack(): void {
    LeaveGuard.isStepBackWaiting = false;

    const guardedEntry: GuardedEntry | null = LeaveGuard.guardedEntry;
    const hold: LeaveGuardHold | undefined = LeaveGuard.getAskingHold();

    if (!guardedEntry || !hold) {
      // Let go meanwhile: the step was kept from the router; it hears it now.
      LeaveGuard.isTakingStepBack = false;
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
      return;
    }

    if (isSamePath(window.location.pathname, guardedEntry.pathname)) {
      // Back on the page already (Forward pressed meanwhile): nothing to ask.
      LeaveGuard.isTakingStepBack = false;
      return;
    }

    const reachedKey: string = readShownEntryKey();
    /*
     * The position the browser just put back: the reached entry's own -
     * unless the guard made the browser lose that before, and remembers it.
     */
    const reachedPlace: ScrollPlace =
      LeaveGuard.ownPlaces.get(reachedKey) || readScrollPlace();
    const pagePlace: ScrollPlace | null = LeaveGuard.shownPlace;
    const stepIndex: number | null = readHistoryIndex(window.history.state);
    const stepSize: number | null =
      stepIndex !== null && guardedEntry.index !== null
        ? stepIndex - guardedEntry.index
        : null;

    if (stepSize !== null && stepSize !== 0) {
      /*
       * The page where the reader had it, before anything is drawn. The
       * browser keeps that position for the reached entry as the tab leaves
       * it: its own is remembered, for when the tab comes back to it.
       */
      if (pagePlace && !isSamePlace(pagePlace, reachedPlace)) {
        LeaveGuard.rememberOwnPlace(reachedKey, reachedPlace);
      }

      if (pagePlace) {
        scrollPageTo(pagePlace);
      }

      // Back where the page is shown, as many entries as the step went.
      window.history.go(-stepSize);

      hold.askToLeave(
        LeaveGuard.letGoAndThen(() => {
          window.history.go(stepSize);
        }),
      );
      return;
    }

    /*
     * How far the step went is not known (an entry the router did not
     * make): the guarded page's entry goes back on top, right after the one
     * the step reached, and leaving goes back one entry, to that one. That
     * entry keeps its own position as the new one goes on top; the page
     * then goes back to where the reader had it.
     */
    window.history.pushState(guardedEntry.state, "", guardedEntry.href);
    LeaveGuard.isTakingStepBack = false;

    if (pagePlace) {
      scrollPageTo(pagePlace);
    }

    hold.askToLeave(
      LeaveGuard.letGoAndThen(() => {
        window.history.back();
      }),
    );
  }
}

/*
 * As this module loads: Navigation and the app import it before the router
 * mounts (see listenForBackAndForward).
 */
LeaveGuard.listenForBackAndForward();

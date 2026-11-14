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
 */

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
   * A Back or Forward step to another page was just taken back, and the
   * browser has not landed on the guarded page again yet.
   */
  private static isTakingStepBack: boolean = false;

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

    // Back and Forward: heard all along (listenForBackAndForward).
    window.addEventListener("beforeunload", LeaveGuard.onBeforeUnload);
  }

  private static stop(): void {
    LeaveGuard.guardedEntry = null;
    LeaveGuard.isTakingStepBack = false;

    if (typeof window === "undefined") {
      return;
    }

    window.removeEventListener("beforeunload", LeaveGuard.onBeforeUnload);
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
     * that page, and the unsaved work would go with this one.
     */
    event.stopImmediatePropagation();

    const stepIndex: number | null = readHistoryIndex(event.state);
    const stepSize: number | null =
      stepIndex !== null && guardedEntry.index !== null
        ? stepIndex - guardedEntry.index
        : null;

    if (stepSize !== null && stepSize !== 0) {
      // Back where the page is shown, as many entries as the step went.
      LeaveGuard.isTakingStepBack = true;
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
     * the step reached, and leaving goes back one entry, to that one.
     */
    window.history.pushState(guardedEntry.state, "", guardedEntry.href);

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

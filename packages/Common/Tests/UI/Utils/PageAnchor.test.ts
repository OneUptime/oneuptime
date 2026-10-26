import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";
import {
  PAGE_ANCHOR_FOCUSED_ATTRIBUTE,
  PAGE_ANCHOR_LANDED_ATTRIBUTE,
  PAGE_ANCHOR_LANDED_IN_MS,
  PAGE_ANCHOR_RELEASING_EVENTS,
  PAGE_ANCHOR_SCROLL_MARGIN_TOP,
  PAGE_ANCHOR_SECTION_SCROLL_MARGIN_TOP,
  PAGE_ANCHOR_SETTLE_IN_MS,
  bringPageAnchorIntoView,
  getPageAnchor,
  getRouteToPageAnchor,
  isPageAnchorName,
  markPageAnchorLanded,
} from "../../../UI/Utils/PageAnchor";

/*
 * A place on a page, named after the "#" of its address
 * (UI/Utils/PageAnchor): how a link lands on one setting of a settings
 * page - "Pick a Runner" opening a repository's ".../settings#runner" -
 * rather than on its top, with the More settings it is in open
 * (AdvancedPageSection, AdvancedPageSection.test.tsx).
 *
 * Pinned here:
 *   - a place's name is plain (a letter, then letters, digits, "-", "_"),
 *     and an address naming anything else names no place;
 *   - a link to a place is the page's route with "#<place>" after its query
 *     string, never two "#";
 *   - the place is brought into view - its top, instantly - once the
 *     browser has drawn it, and again as the page around it changes size
 *     while it settles (at most once a frame), until the settle time is up,
 *     the person scrolls, touches, clicks or types, or whoever asked stops
 *     it; a place gone from the page is never scrolled to;
 *   - it lands under the page's sticky header, whose height MasterPage
 *     publishes - a card with the page's gap above it, a section of a card
 *     with its divider right under the header;
 *   - the place a link landed on is marked for a moment (Theme.css tints
 *     it, the tint fading) and takes the keyboard's focus when nothing else
 *     holds it, giving it back - and the tabindex it took - when the focus
 *     moves on.
 */

// ---- frames, drawn when a test says so -----------------------------------

let frames: Map<number, FrameRequestCallback> = new Map();
let nextFrame: number = 1;

function drawFrames(): void {
  const drawn: Array<FrameRequestCallback> = Array.from(frames.values());
  frames = new Map();

  for (const callback of drawn) {
    callback(0);
  }
}

// ---- a page that changes size when a test says so ------------------------

class FakeResizeObserver {
  public static instances: Array<FakeResizeObserver> = [];

  public observed: Array<Element> = [];
  public isDisconnected: boolean = false;
  private callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.observed.push(target);
  }

  public unobserve(): void {
    // Nothing is observed one by one here.
  }

  public disconnect(): void {
    this.isDisconnected = true;
  }

  // The page changed size.
  public resize(): void {
    this.callback();
  }
}

type GlobalSlots = Record<string, unknown>;

const globalSlots: GlobalSlots = globalThis as unknown as GlobalSlots;
const windowSlots: GlobalSlots = window as unknown as GlobalSlots;

let originals: Record<string, unknown> = {};

// What scrollIntoView was asked, of which place.
let scrolls: Array<{ element: Element; options: unknown }> = [];

function place(id: string = "runner"): HTMLElement {
  const element: HTMLElement = document.createElement("div");
  element.id = id;
  (element as unknown as GlobalSlots)["scrollIntoView"] = (
    options: unknown,
  ): void => {
    scrolls.push({ element, options });
  };
  document.body.appendChild(element);

  return element;
}

beforeEach(() => {
  // Saved before the fake timers stand in for the browser's own.
  originals = {
    requestAnimationFrame: windowSlots["requestAnimationFrame"],
    cancelAnimationFrame: windowSlots["cancelAnimationFrame"],
    ResizeObserver: globalSlots["ResizeObserver"],
    addEventListener: windowSlots["addEventListener"],
    removeEventListener: windowSlots["removeEventListener"],
  };

  jest.useFakeTimers();

  frames = new Map();
  nextFrame = 1;
  scrolls = [];
  FakeResizeObserver.instances = [];

  windowSlots["requestAnimationFrame"] = (
    callback: FrameRequestCallback,
  ): number => {
    const id: number = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  windowSlots["cancelAnimationFrame"] = (id: number): void => {
    frames.delete(id);
  };
  globalSlots["ResizeObserver"] = FakeResizeObserver;
});

afterEach(() => {
  jest.useRealTimers();

  windowSlots["requestAnimationFrame"] = originals["requestAnimationFrame"];
  windowSlots["cancelAnimationFrame"] = originals["cancelAnimationFrame"];
  windowSlots["addEventListener"] = originals["addEventListener"];
  windowSlots["removeEventListener"] = originals["removeEventListener"];

  if (originals["ResizeObserver"] === undefined) {
    delete globalSlots["ResizeObserver"];
  } else {
    globalSlots["ResizeObserver"] = originals["ResizeObserver"];
  }

  document.body.innerHTML = "";
  window.history.replaceState(null, "", window.location.pathname);
});

describe("a place's name", () => {
  test("is plain: a letter, then letters, digits, '-' and '_'", () => {
    for (const name of [
      "runner",
      "github-commands",
      "production-review-comment",
      "trigger_label",
      "a1",
      "Runner",
    ]) {
      expect({ name, isPlace: isPageAnchorName(name) }).toEqual({
        name,
        isPlace: true,
      });
    }

    for (const name of [
      "",
      "1runner",
      "-runner",
      "run ner",
      "runner#again",
      'run"ner',
      "run]ner",
      "run/ner",
      "run.ner",
      "rünner",
      "runner\n",
    ]) {
      expect({ name, isPlace: isPageAnchorName(name) }).toEqual({
        name,
        isPlace: false,
      });
    }
  });
});

describe("the place the address names", () => {
  test("none: no '#', or nothing after it", () => {
    expect(getPageAnchor()).toBe("");

    window.history.replaceState(null, "", "#");
    expect(getPageAnchor()).toBe("");
  });

  test("the plain name after the '#'", () => {
    window.history.replaceState(null, "", "#runner");
    expect(getPageAnchor()).toBe("runner");

    window.history.replaceState(null, "", "?from=email#production-review");
    expect(getPageAnchor()).toBe("production-review");
  });

  test("a name written with %-escapes is read as the name it spells", () => {
    window.history.replaceState(null, "", "#%72unner");
    expect(getPageAnchor()).toBe("runner");
  });

  test("anything that is not a plain name names no place - never a selector, never a crash", () => {
    for (const hash of [
      "#run%20ner",
      "#a%22%5D",
      "#%E0%A4%A",
      "#runner%23again",
      "#1runner",
    ]) {
      window.history.replaceState(null, "", hash);
      expect({ hash, anchor: getPageAnchor() }).toEqual({ hash, anchor: "" });
    }
  });
});

describe("a link to a place", () => {
  const SETTINGS: string =
    "/dashboard/dddddddd-0000-4000-8000-000000000001/code/repositories/eeeeeeee-0000-4000-8000-000000000001/settings";

  test("is the page's route with '#<place>' after it", () => {
    expect(getRouteToPageAnchor(new Route(SETTINGS), "runner").toString()).toBe(
      `${SETTINGS}#runner`,
    );
  });

  test("after the query string, where the route has one", () => {
    expect(
      getRouteToPageAnchor(
        new Route(`${SETTINGS}?from=email`),
        "runner",
      ).toString(),
    ).toBe(`${SETTINGS}?from=email#runner`);
  });

  test("in place of a '#' the route already had: never two", () => {
    expect(
      getRouteToPageAnchor(
        new Route(`${SETTINGS}#pull-requests`),
        "production-review",
      ).toString(),
    ).toBe(`${SETTINGS}#production-review`);
  });

  test("a name that cannot name a place leaves the route as it is, without a '#'", () => {
    for (const name of ["", "run ner", "1runner"]) {
      expect(getRouteToPageAnchor(new Route(SETTINGS), name).toString()).toBe(
        SETTINGS,
      );
    }

    expect(
      getRouteToPageAnchor(new Route(`${SETTINGS}#runner`), "").toString(),
    ).toBe(SETTINGS);
  });
});

describe("bringing a place into view", () => {
  test("once the browser has drawn it: on the next frame, its top, instantly", () => {
    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner);

    // Not before the frame: the fold it is in may have only just opened.
    expect(scrolls).toEqual([]);

    drawFrames();

    expect(scrolls).toEqual([{ element: runner, options: { block: "start" } }]);
  });

  test("again each time the page changes size while it settles - once a frame, however many changes", () => {
    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner);
    drawFrames();

    const observer: FakeResizeObserver = FakeResizeObserver.instances[0]!;
    // The whole page: what is above the place grows as its cards load.
    expect(observer.observed).toEqual([document.body]);

    observer.resize();
    observer.resize();
    observer.resize();
    drawFrames();

    expect(scrolls).toHaveLength(2);

    observer.resize();
    drawFrames();

    expect(scrolls).toHaveLength(3);
  });

  test("not once the settle time is up: the page is the person's again", () => {
    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner, { settleInMs: 1000 });
    drawFrames();

    const observer: FakeResizeObserver = FakeResizeObserver.instances[0]!;

    jest.advanceTimersByTime(999);
    observer.resize();
    drawFrames();
    expect(scrolls).toHaveLength(2);

    jest.advanceTimersByTime(1);
    expect(observer.isDisconnected).toBe(true);

    observer.resize();
    drawFrames();
    expect(scrolls).toHaveLength(2);
  });

  test("it settles for three seconds unless told otherwise", () => {
    expect(PAGE_ANCHOR_SETTLE_IN_MS).toBe(3000);

    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner);
    drawFrames();

    jest.advanceTimersByTime(PAGE_ANCHOR_SETTLE_IN_MS - 1);
    expect(FakeResizeObserver.instances[0]!.isDisconnected).toBe(false);

    jest.advanceTimersByTime(1);
    expect(FakeResizeObserver.instances[0]!.isDisconnected).toBe(true);
  });

  test.each(
    PAGE_ANCHOR_RELEASING_EVENTS.map((name: string) => {
      return [name];
    }),
  )(
    "%s - the person scrolling, touching, clicking or typing - ends it at once",
    (eventName: string) => {
      const runner: HTMLElement = place();

      bringPageAnchorIntoView(runner);
      drawFrames();

      window.dispatchEvent(new Event(eventName));

      const observer: FakeResizeObserver = FakeResizeObserver.instances[0]!;
      expect(observer.isDisconnected).toBe(true);

      observer.resize();
      drawFrames();
      expect(scrolls).toHaveLength(1);
    },
  );

  test("the events that end it are the person's: scrolling, touching, clicking and typing", () => {
    expect([...PAGE_ANCHOR_RELEASING_EVENTS].sort()).toEqual(
      ["keydown", "mousedown", "touchstart", "wheel"].sort(),
    );
  });

  test("an event before the first frame ends it before anything is scrolled", () => {
    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner);
    window.dispatchEvent(new Event("keydown"));
    drawFrames();

    expect(scrolls).toEqual([]);
  });

  test("whoever asked can stop it: no scroll after, no listener, observer or timer left", () => {
    const added: Array<string> = [];
    const removed: Array<string> = [];
    const add: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => void = window.addEventListener.bind(window);
    const remove: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => void = window.removeEventListener.bind(window);

    // Every listener added and removed, by its event, then passed on.
    windowSlots["addEventListener"] = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      added.push(type);
      add(type, listener, options);
    };
    windowSlots["removeEventListener"] = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void => {
      removed.push(type);
      remove(type, listener, options);
    };

    const runner: HTMLElement = place();
    const stop: () => void = bringPageAnchorIntoView(runner);

    stop();
    drawFrames();

    expect(scrolls).toEqual([]);
    expect(FakeResizeObserver.instances[0]!.isDisconnected).toBe(true);
    expect([...added].sort()).toEqual([...PAGE_ANCHOR_RELEASING_EVENTS].sort());
    expect([...removed].sort()).toEqual(
      [...PAGE_ANCHOR_RELEASING_EVENTS].sort(),
    );
    expect(jest.getTimerCount()).toBe(0);

    // Stopping twice is stopping once.
    stop();
    expect(removed).toHaveLength(PAGE_ANCHOR_RELEASING_EVENTS.length);
  });

  test("a place gone from the page is not scrolled to", () => {
    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner);
    runner.remove();
    drawFrames();

    expect(scrolls).toEqual([]);
  });

  test("without frames, a timeout draws it; without ResizeObserver, it is brought into view once", () => {
    delete windowSlots["requestAnimationFrame"];
    delete globalSlots["ResizeObserver"];

    const runner: HTMLElement = place();

    bringPageAnchorIntoView(runner);
    expect(scrolls).toEqual([]);

    jest.advanceTimersByTime(0);
    expect(scrolls).toEqual([{ element: runner, options: { block: "start" } }]);
    expect(FakeResizeObserver.instances).toEqual([]);
  });

  test("an element without scrollIntoView is left where it is", () => {
    const bare: HTMLElement = document.createElement("div");
    document.body.appendChild(bare);
    (bare as unknown as GlobalSlots)["scrollIntoView"] = undefined;

    expect(() => {
      bringPageAnchorIntoView(bare);
      drawFrames();
    }).not.toThrow();
  });

  test("it lands under the page's sticky header, with a little room above it", () => {
    expect(PAGE_ANCHOR_SCROLL_MARGIN_TOP).toBe(
      "calc(var(--app-header-height, 0px) + 1.5rem)",
    );
  });

  test("a section of a card lands with its divider right under the sticky header, nothing of the section above it in sight", () => {
    expect(PAGE_ANCHOR_SECTION_SCROLL_MARGIN_TOP).toBe(
      "var(--app-header-height, 0px)",
    );
  });
});

/*
 * "Pick a Runner" lands on a repository's Runner among six settings: on a
 * tall screen the page cannot scroll it to the top, and the one the link
 * was for must still be the one the eye finds - and the one Tab goes on
 * from, not the top of the page.
 */
describe("marking the place a link landed on", () => {
  test("marked at once, for the tint's time, then not", () => {
    const runner: HTMLElement = place();

    markPageAnchorLanded(runner);
    expect(runner.getAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe("true");

    jest.advanceTimersByTime(PAGE_ANCHOR_LANDED_IN_MS - 1);
    expect(runner.hasAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(1);
    expect(runner.hasAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe(false);
  });

  test("the tint's time is 2.4 s unless told otherwise - the fade Theme.css draws", () => {
    expect(PAGE_ANCHOR_LANDED_IN_MS).toBe(2400);

    const runner: HTMLElement = place();
    markPageAnchorLanded(runner, { landedInMs: 100 });

    jest.advanceTimersByTime(100);
    expect(runner.hasAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe(false);
  });

  test("unmarked at once by whoever asked: a page that goes away, a link that lands elsewhere - no timer left", () => {
    const runner: HTMLElement = place();

    const unmark: () => void = markPageAnchorLanded(runner);
    expect(jest.getTimerCount()).toBe(1);

    unmark();
    expect(runner.hasAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);

    // Twice is once.
    expect(() => {
      unmark();
    }).not.toThrow();
  });

  test("with nothing focused - a page just opened - it takes the keyboard's focus, without scrolling, and gives it back when the focus moves on", () => {
    const runner: HTMLElement = place();
    const edit: HTMLButtonElement = document.createElement("button");
    runner.appendChild(edit);

    const focusCalls: Array<unknown> = [];
    const focus: (options?: FocusOptions) => void = runner.focus.bind(runner);
    runner.focus = (options?: FocusOptions): void => {
      focusCalls.push(options);
      focus(options);
    };

    expect(document.activeElement).toBe(document.body);

    markPageAnchorLanded(runner);

    expect(document.activeElement).toBe(runner);
    // bringPageAnchorIntoView brings it into view, under the header.
    expect(focusCalls).toEqual([{ preventScroll: true }]);
    // No control: in the focus order only while it holds the focus.
    expect(runner.getAttribute("tabindex")).toBe("-1");
    expect(runner.getAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe("true");

    // Tab goes on to its own controls; it leaves the order again.
    edit.focus();
    expect(runner.hasAttribute("tabindex")).toBe(false);
    expect(runner.hasAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe(false);
    // The tint is the mark's: it stays its time.
    expect(runner.hasAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe(true);
  });

  test("a place that can take the focus of its own keeps its tabindex", () => {
    const runner: HTMLElement = place();
    runner.setAttribute("tabindex", "0");

    markPageAnchorLanded(runner);
    expect(document.activeElement).toBe(runner);

    runner.blur();
    expect(runner.getAttribute("tabindex")).toBe("0");
    expect(runner.hasAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe(false);
  });

  test("focus somewhere already - a field the person is typing in - is never taken", () => {
    const runner: HTMLElement = place();
    const field: HTMLInputElement = document.createElement("input");
    document.body.appendChild(field);
    field.focus();

    markPageAnchorLanded(runner);

    expect(document.activeElement).toBe(field);
    expect(runner.hasAttribute("tabindex")).toBe(false);
    expect(runner.hasAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe(false);
    // It is still the place the link was for.
    expect(runner.getAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe("true");
  });

  /*
   * Issue #5293: a Remediation card's "Go to Affected Resources" is a
   * button on the same page. Clicking or pressing it focuses it, and the
   * landing must take that focus on to the card - or Tab goes on from a
   * button scrolled out of sight, and a screen reader hears nothing.
   */
  test("the control that took the person there hands its focus on to the place", () => {
    const runner: HTMLElement = place();
    const go: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(go);
    go.focus();
    expect(document.activeElement).toBe(go);

    markPageAnchorLanded(runner, { takesFocusFrom: go });

    expect(document.activeElement).toBe(runner);
    expect(runner.getAttribute("tabindex")).toBe("-1");
    expect(runner.getAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe("true");
    expect(runner.getAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE)).toBe("true");
  });

  test("naming the control that took the person there never takes focus held anywhere else", () => {
    const runner: HTMLElement = place();
    const go: HTMLButtonElement = document.createElement("button");
    const field: HTMLInputElement = document.createElement("input");
    document.body.appendChild(go);
    document.body.appendChild(field);
    field.focus();

    markPageAnchorLanded(runner, { takesFocusFrom: go });

    expect(document.activeElement).toBe(field);
    expect(runner.hasAttribute("tabindex")).toBe(false);
    expect(runner.hasAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe(false);

    // With no control named, a focused button keeps its focus too.
    go.focus();
    markPageAnchorLanded(runner, { takesFocusFrom: null });
    expect(document.activeElement).toBe(go);
  });

  test("a place that cannot take the focus - out of sight - keeps none of what it was given to take it", () => {
    const runner: HTMLElement = place();
    runner.focus = (): void => {
      // A hidden element: the browser does not move the focus.
    };

    markPageAnchorLanded(runner);

    expect(document.activeElement).toBe(document.body);
    expect(runner.hasAttribute("tabindex")).toBe(false);
    expect(runner.hasAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE)).toBe(false);
  });
});

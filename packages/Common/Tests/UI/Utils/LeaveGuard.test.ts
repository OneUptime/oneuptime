// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import LeaveGuard, {
  AskToLeaveFunction,
  LeavePageFunction,
  OWN_PLACES_MAX_ENTRIES,
  SCROLL_RESTORE_WAIT_MS,
} from "../../../UI/Utils/LeaveGuard";
import { afterHistorySteps } from "../../Helpers/HistorySteps";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * LeaveGuard asks before a page holding unsaved work is left (issue #7173):
 * a step inside the app waits for the page's answer, the browser's Back and
 * Forward are taken back before the router hears them, and the browser asks
 * before the tab closes or reloads. While no page holds it, nothing asks and
 * nothing is kept from the router - every other page goes on exactly as it
 * always did.
 *
 * The history here is jsdom's real one: entries carry react-router's
 * `{ usr, key, idx }` state, and "the router" is a popstate listener on the
 * window added after the guard's, as react-router adds its own when the app
 * mounts. It listens capturing here: Chromium runs a window's popstate
 * listeners in the order they were added, capturing or not, while jsdom
 * runs capturing ones first - so a capturing router added later is heard
 * in the order Chromium hears react-router's, and these see what the
 * router would hear there.
 */

interface Asked {
  leave: LeavePageFunction;
}

type AskRecorder = {
  askToLeave: AskToLeaveFunction;
  asked: Array<Asked>;
};

const recordAsks: () => AskRecorder = (): AskRecorder => {
  const asked: Array<Asked> = [];

  return {
    asked: asked,
    askToLeave: (leave: LeavePageFunction): void => {
      asked.push({ leave: leave });
    },
  };
};

const routerState: (idx: number) => {
  usr: null;
  key: string;
  idx: number;
} = (idx: number): { usr: null; key: string; idx: number } => {
  return { usr: null, key: `key-${idx}`, idx: idx };
};

/*
 * jsdom takes a history step two tasks later, as browsers take it after the
 * current task, and the guard takes a step it keeps from the router back
 * in the next animation frame: a step, the guard's step back and the step
 * taken again after the answer have all landed once a handful of tasks and
 * a frame or two have gone by (Tests/Helpers/HistorySteps).
 */
const nextHistoryTask: () => Promise<void> = afterHistorySteps;

const dispatchBeforeUnload: () => Event = (): Event => {
  const event: Event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

let routerHeard: Array<string> = [];

const router: () => void = (): void => {
  routerHeard.push(window.location.pathname + window.location.search);
};

/*
 * The tab's history: the list of dashboards (idx 0), then the dashboard
 * being edited (idx 1), shown now.
 */
const openDashboardAfterList: () => void = (): void => {
  window.history.replaceState(routerState(0), "", "/dashboard/p1/dashboards");
  window.history.pushState(routerState(1), "", "/dashboard/p1/dashboards/d1");
};

beforeEach(() => {
  LeaveGuard.reset();
  routerHeard = [];
  window.addEventListener("popstate", router, true);
  openDashboardAfterList();
});

afterEach(async () => {
  LeaveGuard.reset();
  window.removeEventListener("popstate", router, true);
  // Let a step still in flight land before the next test sets its history.
  await nextHistoryTask();
});

describe("LeaveGuard hears Back and Forward before the router", () => {
  test("it listens on the window as its module loads, before any page holds it or any router mounts", () => {
    const added: Array<string> = [];
    const addEventListener: SpyInstance<Window["addEventListener"]> = jest
      .spyOn(window, "addEventListener")
      .mockImplementation(
        (
          type: string,
          _listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          const capture: boolean =
            options === true ||
            (typeof options === "object" && Boolean(options.capture));
          added.push(`${type}${capture ? " (capturing)" : ""}`);
        },
      );

    try {
      jest.isolateModules(() => {
        // A fresh copy of the module, loaded the way the app loads it.
        const FreshLeaveGuard: typeof LeaveGuard = (
          jest.requireActual("../../../UI/Utils/LeaveGuard") as {
            default: typeof LeaveGuard;
          }
        ).default;

        expect(added).toEqual(["popstate (capturing)"]);
        expect(FreshLeaveGuard.isHeld()).toBe(false);

        // Once only: a second call adds nothing.
        FreshLeaveGuard.listenForBackAndForward();
        expect(added).toEqual(["popstate (capturing)"]);
      });
    } finally {
      addEventListener.mockRestore();
    }
  });

  test("a window it cannot listen on still lets it load, and nothing asks", () => {
    /*
     * Node suites stand a bare `{ location, history }` in for the window
     * before they load what Navigation pulls in (App's SessionReplayRoutes,
     * among dozens): there is nothing to hear Back or Forward on, and
     * loading the guard must not throw.
     */
    const ownAddEventListener: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(window, "addEventListener");

    Object.defineProperty(window, "addEventListener", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      jest.isolateModules(() => {
        // A fresh copy of the module, loaded the way the app loads it.
        const loadFresh: () => typeof LeaveGuard = (): typeof LeaveGuard => {
          return (
            jest.requireActual("../../../UI/Utils/LeaveGuard") as {
              default: typeof LeaveGuard;
            }
          ).default;
        };

        expect(loadFresh).not.toThrow();

        // The copy that just loaded: the registry keeps it.
        const FreshLeaveGuard: typeof LeaveGuard = loadFresh();
        const taken: Array<string> = [];

        expect(() => {
          FreshLeaveGuard.listenForBackAndForward();
        }).not.toThrow();
        expect(FreshLeaveGuard.isHeld()).toBe(false);

        FreshLeaveGuard.whenLeaving("/dashboard/p1/home", () => {
          taken.push("/dashboard/p1/home");
        });
        expect(taken).toEqual(["/dashboard/p1/home"]);
      });
    } finally {
      if (ownAddEventListener) {
        Object.defineProperty(window, "addEventListener", ownAddEventListener);
      } else {
        Reflect.deleteProperty(window, "addEventListener");
      }
    }

    expect(typeof window.addEventListener).toBe("function");
  });

  test("a hold adds no popstate listener of its own, so none can run after the router's", () => {
    const added: Array<string> = [];
    const addEventListener: SpyInstance<Window["addEventListener"]> =
      jest.spyOn(window, "addEventListener");

    try {
      LeaveGuard.hold(recordAsks().askToLeave);

      for (const call of addEventListener.mock.calls) {
        added.push(call[0]);
      }
    } finally {
      addEventListener.mockRestore();
    }

    // The browser's question, and where the page is scrolled to (#7404).
    expect(added).toEqual(["beforeunload", "scroll"]);
  });
});

describe("LeaveGuard while no page holds it", () => {
  test("a step to another page goes ahead at once", () => {
    const leave: Mock<() => void> = jest.fn<() => void>();

    LeaveGuard.whenLeaving("/dashboard/p1/monitors", leave);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(LeaveGuard.isHeld()).toBe(false);
    expect(LeaveGuard.asksBeforeGoingTo("/dashboard/p1/monitors")).toBe(false);
  });

  test("closing the tab asks nothing", () => {
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  test("Back goes back, and the router hears it", async () => {
    window.history.back();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/dashboards");
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards"]);
  });
});

describe("LeaveGuard steps inside the app", () => {
  test("a step to another page waits for the page's answer", () => {
    const asks: AskRecorder = recordAsks();
    const leave: Mock<() => void> = jest.fn<() => void>();

    LeaveGuard.hold(asks.askToLeave);

    expect(LeaveGuard.asksBeforeGoingTo("/dashboard/p1/monitors")).toBe(true);

    LeaveGuard.whenLeaving("/dashboard/p1/monitors", leave);

    expect(asks.asked).toHaveLength(1);
    expect(leave).not.toHaveBeenCalled();
  });

  test("dropping the answer (Keep Editing) never takes the step, and the guard still holds", () => {
    const asks: AskRecorder = recordAsks();
    const leave: Mock<() => void> = jest.fn<() => void>();

    LeaveGuard.hold(asks.askToLeave);
    LeaveGuard.whenLeaving("/dashboard/p1/monitors", leave);

    expect(leave).not.toHaveBeenCalled();
    expect(LeaveGuard.isHeld()).toBe(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    // Asked again, it asks again.
    LeaveGuard.whenLeaving("/dashboard/p1/monitors", leave);
    expect(asks.asked).toHaveLength(2);
  });

  test("leaving (Discard Changes) takes the step once, and lets the guard go first", () => {
    const asks: AskRecorder = recordAsks();
    const heldWhenTaken: Array<boolean> = [];
    const askedBrowserWhenTaken: Array<boolean> = [];

    LeaveGuard.hold(asks.askToLeave);
    LeaveGuard.whenLeaving("/dashboard/p1/monitors", () => {
      heldWhenTaken.push(LeaveGuard.isHeld());
      /*
       * A step that loads the page in full (a new version of OneUptime is
       * out) must not meet the browser's own dialog after the page's.
       */
      askedBrowserWhenTaken.push(dispatchBeforeUnload().defaultPrevented);
    });

    asks.asked[0]!.leave();
    asks.asked[0]!.leave();

    expect(heldWhenTaken).toEqual([false]);
    expect(askedBrowserWhenTaken).toEqual([false]);
    expect(LeaveGuard.asksBeforeGoingTo("/dashboard/p1/monitors")).toBe(false);
  });

  test.each<[string, string]>([
    ["a query on the same page", "/dashboard/p1/dashboards/d1?startTime=1"],
    ["a hash on the same page", "/dashboard/p1/dashboards/d1#widget-2"],
    ["the same page with a trailing slash", "/dashboard/p1/dashboards/d1/"],
    [
      "the same page as a full address",
      "http://localhost/dashboard/p1/dashboards/d1?a=b",
    ],
  ])("%s asks nothing", (_label: string, address: string) => {
    const asks: AskRecorder = recordAsks();
    const leave: Mock<() => void> = jest.fn<() => void>();

    LeaveGuard.hold(asks.askToLeave);
    LeaveGuard.whenLeaving(address, leave);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(asks.asked).toHaveLength(0);
    expect(LeaveGuard.asksBeforeGoingTo(address)).toBe(false);
    // Nothing was left: the guard still holds.
    expect(LeaveGuard.isHeld()).toBe(true);
  });

  test.each<[string, string]>([
    [
      "another page of the same dashboard",
      "/dashboard/p1/dashboards/d1/settings",
    ],
    ["another dashboard", "/dashboard/p1/dashboards/d2"],
    ["the same path in another case", "/dashboard/p1/dashboards/D1"],
    ["another project", "/dashboard/p2"],
  ])("%s asks", (_label: string, address: string) => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);

    expect(LeaveGuard.asksBeforeGoingTo(address)).toBe(true);
    LeaveGuard.whenLeaving(address, () => {});
    expect(asks.asked).toHaveLength(1);
  });

  test("the latest page holding the guard is the one that asks", () => {
    const first: AskRecorder = recordAsks();
    const second: AskRecorder = recordAsks();

    LeaveGuard.hold(first.askToLeave);
    const releaseSecond: () => void = LeaveGuard.hold(second.askToLeave);

    LeaveGuard.whenLeaving("/dashboard/p1/monitors", () => {});
    expect(second.asked).toHaveLength(1);
    expect(first.asked).toHaveLength(0);

    releaseSecond();

    LeaveGuard.whenLeaving("/dashboard/p1/monitors", () => {});
    expect(first.asked).toHaveLength(1);
    expect(LeaveGuard.isHeld()).toBe(true);
  });

  test("once every page lets go, nothing asks, the browser included", () => {
    const asks: AskRecorder = recordAsks();
    const leave: Mock<() => void> = jest.fn<() => void>();
    const releaseFirst: () => void = LeaveGuard.hold(asks.askToLeave);
    const releaseSecond: () => void = LeaveGuard.hold(asks.askToLeave);

    releaseFirst();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    releaseSecond();
    // Letting go twice is harmless.
    releaseSecond();

    LeaveGuard.whenLeaving("/dashboard/p1/monitors", leave);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(asks.asked).toHaveLength(0);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});

describe("LeaveGuard and the browser's own dialog", () => {
  test("closing or reloading the tab asks only while a page holds the guard", () => {
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    const release: () => void = LeaveGuard.hold(() => {});
    const event: Event = dispatchBeforeUnload();

    expect(event.defaultPrevented).toBe(true);

    release();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});

describe("LeaveGuard and the browser's Back and Forward buttons", () => {
  test("Back to another page is taken back before the router hears it, and asks", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);

    window.history.back();
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(1);
    // Back on the dashboard, as if nothing happened.
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    expect(window.history.state).toEqual(routerState(1));
    // The router heard neither the step nor its return.
    expect(routerHeard).toEqual([]);
  });

  test("Keep Editing after Back stays, and a second Back asks again", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);

    window.history.back();
    await nextHistoryTask();
    // Kept: the answer is dropped.

    window.history.back();
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(2);
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    expect(routerHeard).toEqual([]);
  });

  test("Discard Changes after Back goes back, and the router hears it once", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);

    window.history.back();
    await nextHistoryTask();

    asks.asked[0]!.leave();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/dashboards");
    expect(window.history.state).toEqual(routerState(0));
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards"]);
    expect(LeaveGuard.isHeld()).toBe(false);
  });

  test("Forward to another page asks the same, and Discard Changes goes forward", async () => {
    // The list, then the dashboard (shown), then a monitor opened from it.
    window.history.pushState(routerState(2), "", "/dashboard/p1/monitors/m1");
    window.history.back();
    await nextHistoryTask();
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    routerHeard = [];

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);

    window.history.forward();
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(1);
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    expect(routerHeard).toEqual([]);

    asks.asked[0]!.leave();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/monitors/m1");
    expect(routerHeard).toEqual(["/dashboard/p1/monitors/m1"]);
  });

  test("a jump of several entries is taken back whole, and taken again whole", async () => {
    window.history.replaceState(routerState(0), "", "/dashboard/p1/home");
    window.history.pushState(routerState(1), "", "/dashboard/p1/dashboards");
    window.history.pushState(routerState(2), "", "/dashboard/p1/dashboards/d1");

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);

    window.history.go(-2);
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(1);
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    expect(routerHeard).toEqual([]);

    asks.asked[0]!.leave();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/home");
    expect(routerHeard).toEqual(["/dashboard/p1/home"]);
  });

  test("a step back to the same page (a query or a hash) asks nothing, and the router hears it", async () => {
    window.history.pushState(
      routerState(2),
      "",
      "/dashboard/p1/dashboards/d1?startTime=1",
    );

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);

    window.history.back();
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(0);
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards/d1"]);

    // The guard follows the page to that entry: Back from it still asks.
    window.history.back();
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(1);
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    expect(window.history.state).toEqual(routerState(1));
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards/d1"]);
  });

  test("a step inside the page moves the entry the guard takes Back to", async () => {
    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);

    /*
     * The page opens a query of its own as a new entry (idx 2), and draws:
     * useLeaveGuard notes the entry it is shown at.
     */
    window.history.pushState(
      routerState(2),
      "",
      "/dashboard/p1/dashboards/d1?startTime=1",
    );
    LeaveGuard.noteShownEntry();

    // Two entries back at once, to the list.
    window.history.go(-2);
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(1);
    // Taken back to the entry the page is shown at, query and all.
    expect(window.location.pathname + window.location.search).toBe(
      "/dashboard/p1/dashboards/d1?startTime=1",
    );
    expect(window.history.state).toEqual(routerState(2));
    expect(routerHeard).toEqual([]);

    asks.asked[0]!.leave();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/dashboards");
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards"]);
  });

  test("an entry the router did not number (a hash link) still asks, and leaving goes where the step went", async () => {
    // A bare hash link leaves an entry without the router's state.
    window.history.pushState(null, "", "/dashboard/p1/dashboards/d1#notes");

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);

    // Two entries back at once, to the list: how far is not known.
    window.history.go(-2);
    await nextHistoryTask();

    expect(asks.asked).toHaveLength(1);
    // The page's entry is put back on top, hash and all.
    expect(window.location.pathname).toBe("/dashboard/p1/dashboards/d1");
    expect(window.location.hash).toBe("#notes");
    expect(routerHeard).toEqual([]);

    asks.asked[0]!.leave();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/dashboards");
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards"]);
  });

  test("once the page lets go, Back is the router's alone again", async () => {
    const release: () => void = LeaveGuard.hold(() => {});

    release();

    window.history.back();
    await nextHistoryTask();

    expect(window.location.pathname).toBe("/dashboard/p1/dashboards");
    expect(routerHeard).toEqual(["/dashboard/p1/dashboards"]);
  });
});

/*
 * WHERE THE PAGE IS SCROLLED TO, ACROSS BACK AND FORWARD (issue #7404).
 *
 * A browser puts back the scroll position of the history entry a step
 * reaches right after popstate, before it next draws (Chromium, Firefox
 * and WebKit alike). Taken back at once, a step the guard keeps showed the
 * page at the other entry's position for a frame or more (Firefox, WebKit),
 * and left that entry with the page's position, so Discard Changes opened
 * it scrolled down (Chromium). The guard now takes the step back in the
 * next frame: it scrolls the page back to where the reader had it first,
 * and puts the other entry's own position back when the tab arrives there.
 *
 * jsdom neither scrolls nor restores, so these play the browser: the page's
 * position is set by hand (the reader scrolling, with its scroll event; the
 * browser restoring an entry's position after popstate, before the frame),
 * frames are drawn when a test says so, and every scrollTo, history.go and
 * pushState the guard makes is recorded in order.
 */
describe("LeaveGuard keeps the page where the reader had it, across Back and Forward (#7404)", () => {
  let calls: Array<string> = [];
  let frames: Array<FrameRequestCallback> = [];
  // spyOn types an overloaded method by its last signature: scrollTo(x, y).
  let scrollToSpy: SpyInstance<(x: number, y: number) => void>;
  let goSpy: SpyInstance<History["go"]>;
  let pushStateSpy: SpyInstance<History["pushState"]>;
  let frameSpy: SpyInstance<Window["requestAnimationFrame"]>;

  const BOARD: string = "/dashboard/p1/dashboards/d1";
  const LIST: string = "/dashboard/p1/dashboards";

  const placePage: (y: number) => void = (y: number): void => {
    (window as unknown as { scrollX: number }).scrollX = 0;
    (window as unknown as { scrollY: number }).scrollY = y;
  };

  // The reader scrolls the page, and the browser says so.
  const readerScrollsTo: (y: number) => void = (y: number): void => {
    placePage(y);
    window.dispatchEvent(new Event("scroll"));
  };

  /*
   * The browser puts back the position it keeps for the entry the tab is
   * on now: after popstate, before it draws. Its scroll event comes with
   * the next frame, when `withScrollEvent` says so.
   */
  const browserRestores: (y: number, withScrollEvent?: boolean) => void = (
    y: number,
    withScrollEvent?: boolean,
  ): void => {
    placePage(y);

    if (withScrollEvent) {
      window.dispatchEvent(new Event("scroll"));
    }
  };

  // The browser draws its next frame: what waits for it runs first.
  const drawNextFrame: () => void = (): void => {
    const due: Array<FrameRequestCallback> = frames;
    frames = [];

    for (const callback of due) {
      callback(0);
    }
  };

  // jsdom's history steps land a couple of tasks later.
  const tasks: () => Promise<void> = async (): Promise<void> => {
    for (let task: number = 0; task < 8; task++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  };

  /*
   * A step, as the browser takes it: popstate, then the position it keeps
   * for the entry reached, then a frame, then the guard's step back
   * landing.
   */
  const stepAndDraw: (
    step: () => void,
    restoredY: number,
  ) => Promise<void> = async (
    step: () => void,
    restoredY: number,
  ): Promise<void> => {
    step();
    await tasks();
    browserRestores(restoredY);
    drawNextFrame();
    await tasks();
  };

  beforeEach(() => {
    calls = [];
    frames = [];
    placePage(0);

    scrollToSpy = jest.spyOn(window, "scrollTo").mockImplementation(((
      x: number,
      y: number,
    ): void => {
      calls.push(`scrollTo ${x},${y}`);
      placePage(y);
    }) as never);

    const realGo: (delta?: number) => void = window.history.go.bind(
      window.history,
    );
    goSpy = jest
      .spyOn(window.history, "go")
      .mockImplementation((delta?: number): void => {
        calls.push(`go ${delta}`);
        realGo(delta);
      });

    const realPushState: History["pushState"] = window.history.pushState.bind(
      window.history,
    );
    pushStateSpy = jest
      .spyOn(window.history, "pushState")
      .mockImplementation(
        (data: unknown, unused: string, url?: string | URL | null): void => {
          calls.push(`pushState ${String(url)}`);
          realPushState(data, unused, url);
        },
      );

    frameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback): number => {
        frames.push(callback);
        return frames.length;
      });
  });

  afterEach(() => {
    // Nothing waits on a frame into the next test.
    LeaveGuard.reset();
    frames = [];
    scrollToSpy.mockRestore();
    goSpy.mockRestore();
    pushStateSpy.mockRestore();
    frameSpy.mockRestore();
    placePage(0);
  });

  test("Back: the page is scrolled back to where the reader had it before the browser draws, then taken back", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    window.history.back();
    await tasks();

    // Kept from the router, and nothing taken back before the frame.
    expect(routerHeard).toEqual([]);
    expect(calls).toEqual([]);
    expect(asks.asked).toHaveLength(0);
    expect(frames).toHaveLength(1);

    // The browser puts back the list's own position: its top.
    browserRestores(0);
    drawNextFrame();

    // Back where the reader had the board, before the step is taken back.
    expect(calls).toEqual(["scrollTo 0,1000", "go 1"]);
    expect(window.scrollY).toBe(1000);
    expect(asks.asked).toHaveLength(1);

    await tasks();

    expect(window.location.pathname).toBe(BOARD);
    expect(window.history.state).toEqual(routerState(1));
    expect(routerHeard).toEqual([]);
  });

  test("the browser's own scroll event for the other entry does not move where the page is kept", async () => {
    LeaveGuard.hold(recordAsks().askToLeave);
    readerScrollsTo(1000);

    window.history.back();
    await tasks();
    // Restored, and said so, while the tab shows the list's entry.
    browserRestores(0, true);
    drawNextFrame();

    expect(calls).toEqual(["scrollTo 0,1000", "go 1"]);
  });

  test("the page where the step reached put it: nothing scrolls, and nothing is remembered", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(400);

    await stepAndDraw(() => {
      window.history.back();
    }, 400);

    expect(calls).toEqual(["go 1"]);

    asks.asked[0]!.leave();
    await tasks();
    browserRestores(400);

    // Nothing to put back on arrival: no frame is even asked for.
    expect(frames).toHaveLength(0);
    expect(calls).toEqual(["go 1", "go -1"]);
    expect(window.location.pathname).toBe(LIST);
  });

  test("Discard Changes after Back opens the page before at its own position, not the board's", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    // The list was left at 300: the browser puts that back.
    await stepAndDraw(() => {
      window.history.back();
    }, 300);

    expect(calls).toEqual(["scrollTo 0,1000", "go 1"]);

    asks.asked[0]!.leave();
    await tasks();

    /*
     * The browser kept the board's position for the list as the guard took
     * the step back, and puts that back now; the list's own goes back on.
     */
    expect(window.location.pathname).toBe(LIST);
    browserRestores(1000);
    drawNextFrame();

    expect(calls).toEqual([
      "scrollTo 0,1000",
      "go 1",
      "go -1",
      "scrollTo 0,300",
    ]);
    expect(window.scrollY).toBe(300);
    expect(routerHeard).toEqual([LIST]);
  });

  test("Forward, then Discard Changes: the page ahead opens at its own position", async () => {
    // The list, the board (shown), then a monitor opened from it.
    window.history.pushState(routerState(2), "", "/dashboard/p1/monitors/m1");
    window.history.back();
    await tasks();
    routerHeard = [];
    calls = [];

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(800);

    await stepAndDraw(() => {
      window.history.forward();
    }, 120);

    expect(calls).toEqual(["scrollTo 0,800", "go -1"]);
    expect(window.location.pathname).toBe(BOARD);

    asks.asked[0]!.leave();
    await tasks();
    browserRestores(800);
    drawNextFrame();

    expect(window.location.pathname).toBe("/dashboard/p1/monitors/m1");
    expect(calls).toEqual([
      "scrollTo 0,800",
      "go -1",
      "go 1",
      "scrollTo 0,120",
    ]);
  });

  test("Keep Editing, then Back again: the board stays where the reader has it now, and the page before keeps its own position", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    await stepAndDraw(() => {
      window.history.back();
    }, 300);

    // Keep Editing: the answer is dropped. The reader scrolls on.
    readerScrollsTo(1100);

    // The browser now keeps the board's old position for the list.
    await stepAndDraw(() => {
      window.history.back();
    }, 1000);

    expect(calls).toEqual([
      "scrollTo 0,1000",
      "go 1",
      "scrollTo 0,1100",
      "go 1",
    ]);
    expect(asks.asked).toHaveLength(2);

    asks.asked[1]!.leave();
    await tasks();
    browserRestores(1100);
    drawNextFrame();

    // The list's own position, as the reader left it before the board.
    expect(calls[calls.length - 1]).toBe("scrollTo 0,300");
    expect(window.location.pathname).toBe(LIST);
  });

  test("put back once: from then on the page before keeps the position the browser has for it", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    await stepAndDraw(() => {
      window.history.back();
    }, 300);

    asks.asked[0]!.leave();
    await tasks();
    browserRestores(1000);
    drawNextFrame();

    expect(calls[calls.length - 1]).toBe("scrollTo 0,300");

    // Forward to the board as saved, and Back to the list: the browser's.
    window.history.forward();
    await tasks();
    browserRestores(1000);
    window.history.back();
    await tasks();
    browserRestores(300);

    expect(frames).toHaveLength(0);
    expect(calls).toEqual([
      "scrollTo 0,1000",
      "go 1",
      "go -1",
      "scrollTo 0,300",
    ]);
  });

  test("Keep Editing, then Save: Back later still finds the page before at its own position", async () => {
    const asks: AskRecorder = recordAsks();
    const release: () => void = LeaveGuard.hold(asks.askToLeave);

    readerScrollsTo(1000);

    await stepAndDraw(() => {
      window.history.back();
    }, 300);

    // Keep Editing, then Save Changes: the page lets go.
    release();

    window.history.back();
    await tasks();

    // The router hears this one, as always.
    expect(routerHeard).toEqual([LIST]);
    browserRestores(1000);
    drawNextFrame();

    expect(calls).toEqual(["scrollTo 0,1000", "go 1", "scrollTo 0,300"]);
  });

  test("while no page holds the guard, Back scrolls nothing and asks for no frame", async () => {
    readerScrollsTo(1000);

    window.history.back();
    await tasks();
    browserRestores(300);

    expect(frames).toHaveLength(0);
    drawNextFrame();

    expect(calls).toEqual([]);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(routerHeard).toEqual([LIST]);
    expect(window.scrollY).toBe(300);
  });

  test("Back pressed twice before the frame is taken back once, the whole way, with one question", async () => {
    window.history.replaceState(routerState(0), "", "/dashboard/p1/home");
    window.history.pushState(routerState(1), "", LIST);
    window.history.pushState(routerState(2), "", BOARD);
    calls = [];

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(900);

    window.history.back();
    await tasks();
    browserRestores(200);
    window.history.back();
    await tasks();
    browserRestores(0);

    // One wait for one frame.
    expect(frames).toHaveLength(1);
    drawNextFrame();
    await tasks();

    expect(calls).toEqual(["scrollTo 0,900", "go 2"]);
    expect(asks.asked).toHaveLength(1);
    expect(window.location.pathname).toBe(BOARD);
    expect(routerHeard).toEqual([]);
  });

  test("Forward back to the page before the frame: nothing is taken back, and nothing asks", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    window.history.back();
    await tasks();
    browserRestores(300);
    window.history.forward();
    await tasks();
    browserRestores(1000);
    drawNextFrame();
    await tasks();

    expect(calls).toEqual([]);
    expect(asks.asked).toHaveLength(0);
    expect(window.location.pathname).toBe(BOARD);
    // The router heard neither step.
    expect(routerHeard).toEqual([]);
  });

  test("a page that lets go while the step waits for its frame: the router hears the step, and nothing asks", async () => {
    const asks: AskRecorder = recordAsks();
    const release: () => void = LeaveGuard.hold(asks.askToLeave);

    readerScrollsTo(1000);
    window.history.back();
    await tasks();

    expect(routerHeard).toEqual([]);

    release();
    browserRestores(300);
    drawNextFrame();
    await tasks();

    expect(asks.asked).toHaveLength(0);
    expect(calls).toEqual([]);
    expect(routerHeard).toEqual([LIST]);
    expect(window.location.pathname).toBe(LIST);
  });

  test("a tab that draws no frames still takes the step back, after a short wait", async () => {
    const asks: AskRecorder = recordAsks();

    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    window.history.back();
    await tasks();
    browserRestores(0);

    // No frame is drawn.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, SCROLL_RESTORE_WAIT_MS + 50);
    });

    expect(calls).toEqual(["scrollTo 0,1000", "go 1"]);
    expect(asks.asked).toHaveLength(1);

    // The frame that comes later does nothing a second time.
    drawNextFrame();
    expect(calls).toEqual(["scrollTo 0,1000", "go 1"]);
  });

  test("an entry the router did not number: the page's entry goes back on top, then the page is scrolled back", async () => {
    // A bare hash link leaves an entry without the router's state.
    window.history.pushState(null, "", `${BOARD}#notes`);
    calls = [];

    const asks: AskRecorder = recordAsks();
    LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(1000);

    // Two entries back at once, to the list: how far is not known.
    await stepAndDraw(() => {
      window.history.go(-2);
    }, 300);

    /*
     * The list's entry keeps its own position as the board's goes on top:
     * only then is the page scrolled back.
     */
    expect(calls).toEqual([
      "go -2",
      `pushState http://localhost${BOARD}#notes`,
      "scrollTo 0,1000",
    ]);

    asks.asked[0]!.leave();
    await tasks();
    browserRestores(300);

    // Nothing was lost, so nothing is put back.
    expect(frames).toHaveLength(0);
    expect(window.location.pathname).toBe(LIST);
  });

  test("the scroll listener is passive, added only while the guard is held, and let go with it", () => {
    const addEventListener: SpyInstance<Window["addEventListener"]> =
      jest.spyOn(window, "addEventListener");
    const removeEventListener: SpyInstance<Window["removeEventListener"]> =
      jest.spyOn(window, "removeEventListener");

    try {
      const release: () => void = LeaveGuard.hold(recordAsks().askToLeave);

      const scrollCalls: Array<Array<unknown>> = addEventListener.mock.calls
        .map((call: Array<unknown>): Array<unknown> => {
          return call;
        })
        .filter((call: Array<unknown>): boolean => {
          return call[0] === "scroll";
        });

      expect(scrollCalls).toHaveLength(1);
      expect(scrollCalls[0]![2]).toEqual({ passive: true });

      release();

      expect(
        removeEventListener.mock.calls.some((call: Array<unknown>) => {
          return call[0] === "scroll" && call[1] === scrollCalls[0]![1];
        }),
      ).toBe(true);
    } finally {
      addEventListener.mockRestore();
      removeEventListener.mockRestore();
    }
  });

  test("it remembers the own positions of the most recent entries only", async () => {
    // Pages 0 to N, then the board: a jump back reaches each once.
    const count: number = OWN_PLACES_MAX_ENTRIES + 1;

    window.history.replaceState(routerState(0), "", "/dashboard/p1/page-0");

    for (let index: number = 1; index <= count; index++) {
      window.history.pushState(
        routerState(index),
        "",
        index === count ? BOARD : `/dashboard/p1/page-${index}`,
      );
    }

    calls = [];

    const asks: AskRecorder = recordAsks();
    const release: () => void = LeaveGuard.hold(asks.askToLeave);
    readerScrollsTo(5000);

    // A jump back to each page, nearest first, kept each time.
    for (let distance: number = 1; distance <= count; distance++) {
      await stepAndDraw(() => {
        window.history.go(-distance);
      }, distance * 10);
    }

    expect(asks.asked).toHaveLength(count);
    release();
    calls = [];

    // The nearest page was remembered first, and let go for the newest.
    window.history.go(-1);
    await tasks();
    browserRestores(5000);
    expect(frames).toHaveLength(0);

    // The farthest was remembered last, and is put back.
    window.history.go(-(count - 1));
    await tasks();
    expect(window.location.pathname).toBe("/dashboard/p1/page-0");
    browserRestores(5000);
    drawNextFrame();

    expect(calls[calls.length - 1]).toBe(`scrollTo 0,${count * 10}`);
  });
});

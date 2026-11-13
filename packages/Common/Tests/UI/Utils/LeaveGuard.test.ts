// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import LeaveGuard, {
  AskToLeaveFunction,
  LeavePageFunction,
} from "../../../UI/Utils/LeaveGuard";
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
 * current task: a step, the guard's step back and the step taken again
 * after the answer have all landed once a handful of tasks have run.
 */
const nextHistoryTask: () => Promise<void> = async (): Promise<void> => {
  for (let task: number = 0; task < 8; task++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
};

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

    expect(added).toEqual(["beforeunload"]);
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

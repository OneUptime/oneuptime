import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import MonitorsScreen from "./MonitorsScreen";
import {
  makeMonitor,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type { MonitorItem, ProjectMonitorItem } from "../api/types";

/*
 * The Monitors tab is a fleet-wide status board, and almost everything that
 * can go wrong with it goes wrong quietly - the screen still renders, it just
 * renders a reassuring lie.
 *
 * Three of those lies are worth naming, because each one is a sentence a
 * responder acts on:
 *
 *   - "No monitors." A fan-out that has not started yet, or one that failed,
 *     produces the same empty array as a project that genuinely has nothing
 *     in it. Told the fleet is empty, a responder stops looking. The hook now
 *     holds isLoading open until the project list itself has arrived (see
 *     useAllProjectMonitors), and this screen has to keep honouring it rather
 *     than racing ahead to its own empty state.
 *
 *   - A count. The three digits at the top of the screen are read at a glance
 *     and are never re-checked. Painting the disabled count into the
 *     inoperational pill, or counting a monitor whose checks are switched off
 *     as healthy, changes what someone believes about their production estate
 *     without changing anything that looks broken.
 *
 *   - The order. Monitors in trouble are grouped above the ones that are fine
 *     precisely so the first thing on screen is the thing that needs someone.
 *     A regression that flattened the sections would still show every monitor
 *     and would still look completely normal.
 *
 * The data hook is faked rather than the network: what is under test here is
 * which of those statements the screen is willing to make from a given hook
 * state, and useAllProjectMonitors.test.tsx already owns how the hook arrives
 * at one. The `mock` prefix on the holders is what lets jest.mock's hoisted
 * factories reach them.
 */

type MonitorsState = ReturnType<
  typeof import("../hooks/useAllProjectMonitors").useAllProjectMonitors
>;

const mockMonitors: { current: MonitorsState } = {
  current: {} as MonitorsState,
};

const mockNavigate: jest.Mock = jest.fn();

const mockLightImpact: jest.Mock = jest.fn();

jest.mock("../hooks/useAllProjectMonitors", () => {
  return {
    useAllProjectMonitors: () => {
      return mockMonitors.current;
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: mockLightImpact,
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});

/*
 * The rendered tree this version of the testing library hands back contains
 * host elements only, so a parent is always something React actually drew.
 */
type RenderedElement = ReturnType<typeof screen.getByText>;

function stateWith(overrides: Partial<MonitorsState> = {}): MonitorsState {
  return {
    items: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

/**
 * Tag a monitor with the project whose query returned it.
 *
 * The project is carried alongside the row rather than read off it, because
 * the list is assembled by asking each project separately and the row's own
 * projectId is whatever the server chose to serialise - the two are not
 * interchangeable, and the detail screen needs the tenant that can actually
 * answer for this monitor.
 */
function wrap(
  item: MonitorItem,
  projectId: string = "project-1",
  projectName: string = "Acme Production",
): ProjectMonitorItem {
  return { item, projectId, projectName };
}

function healthyMonitor(id: string, name: string): MonitorItem {
  return makeMonitor({
    _id: id,
    name,
    currentMonitorStatus: makeNamedEntityWithColor({
      _id: "monitor-status-operational",
      name: "Operational",
    }),
  });
}

function offlineMonitor(id: string, name: string): MonitorItem {
  return makeMonitor({
    _id: id,
    name,
    currentMonitorStatus: makeNamedEntityWithColor({
      _id: "monitor-status-offline",
      name: "Offline",
    }),
  });
}

function offlineFleet(count: number): ProjectMonitorItem[] {
  return Array.from(
    { length: count },
    (_: unknown, index: number): ProjectMonitorItem => {
      return wrap(
        offlineMonitor(`monitor-${index}`, `host-${index}.example.com`),
      );
    },
  );
}

/**
 * The numbers rendered beside `label`, in the order they appear on screen.
 *
 * Every figure this screen shows sits next to a word and nothing carries a
 * testID: the summary puts "3" above "Inoperational", a section header puts
 * "4" beside "Issues". A bare getByText("3") would therefore be satisfied by
 * whichever 3 rendered first, which means it passes just as happily when the
 * disabled tally has been painted into the inoperational pill - the exact
 * regression worth catching. Scoping the search to the label's own container
 * is what makes the assertion say what it means.
 *
 * Containers holding no number at all are skipped rather than reported,
 * because several of these words also appear as a badge on a monitor card
 * ("Disabled", or a status called "Operational"), and those badges are not
 * counting anything.
 */
function countsBesideLabel(label: string): string[] {
  const counts: string[] = [];

  for (const labelNode of screen.getAllByText(label)) {
    const container: RenderedElement | null = labelNode.parent;

    if (container === null) {
      continue;
    }

    const digits: RenderedElement[] = within(container).queryAllByText(/^\d+$/);

    if (digits.length === 1) {
      counts.push(String(digits[0]!.props["children"]));
    }
  }

  return counts;
}

/**
 * What a screen reader would announce for each monitor, top to bottom.
 *
 * Order is the assertion that grouping actually happened: the sections carry
 * no other machine-readable mark, and "the troubled ones come first" is the
 * whole point of having them.
 */
function listedMonitors(): string[] {
  return screen
    .getAllByRole("button")
    .map((element: RenderedElement): string => {
      return String(element.props["accessibilityLabel"]);
    });
}

/**
 * The native view a pull-to-refresh gesture lands on.
 *
 * There is no query for this: the control is handed to the list as a prop
 * rather than rendered as a child, so it carries no role, no label and no
 * text. Firing on the native view is still the honest way in, because the
 * handler itself sits on the RefreshControl component above it and fireEvent
 * walks up to find it - which means this exercises the same wiring the
 * gesture does, rather than reaching into the screen for its callback.
 *
 * Both jest projects render this under the same host name, so the lookup does
 * not have to know which platform it is on.
 */
function refreshControl(): RenderedElement {
  const root: RenderedElement | null = screen.root;

  if (root === null) {
    throw new Error("Nothing was rendered, so there is nothing to refresh.");
  }

  const controls: RenderedElement[] = root.queryAll(
    (instance: RenderedElement): boolean => {
      return instance.type === "RCTRefreshControl";
    },
    { includeSelf: true },
  );

  if (controls.length !== 1) {
    throw new Error(
      `Expected exactly one refreshable element, found ${controls.length}.`,
    );
  }

  return controls[0]!;
}

beforeEach(() => {
  mockMonitors.current = stateWith();
});

describe("While the fleet is still being fetched", () => {
  beforeEach(() => {
    mockMonitors.current = stateWith({ isLoading: true });
  });

  test("placeholders stand in for the monitors that have not arrived", async () => {
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.getAllByLabelText("Loading content").length).toBe(3);
    });
  });

  test("it does not claim the fleet is empty before the projects have even been listed", async () => {
    /*
     * The failure this pins down: the fan-out has no queries at all until the
     * project list lands, so nothing is loading and nothing has failed, and
     * both the hook and this screen used to read that as a settled answer of
     * "none". A responder who reads "No monitors" believes they have nothing
     * to watch.
     */
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.queryByText("No monitors")).toBeNull();
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });

  test("monitors from a project that already answered stay on screen while the rest load", async () => {
    /*
     * One project answering while another is still in flight is the normal
     * case for a responder in more than one project. Replacing what has
     * already been shown with placeholders would make the list flicker back
     * to nothing on every refresh.
     */
    mockMonitors.current = stateWith({
      isLoading: true,
      items: [wrap(offlineMonitor("monitor-1", "db.example.com"))],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Monitor db.example.com. Status: Offline.",
        }),
      ).toBeTruthy();
      expect(screen.queryAllByLabelText("Loading content").length).toBe(0);
    });
  });
});

describe("When the fleet has loaded", () => {
  beforeEach(() => {
    mockMonitors.current = stateWith({
      items: [
        wrap(healthyMonitor("monitor-1", "api.example.com")),
        wrap(offlineMonitor("monitor-2", "db.example.com")),
      ],
    });
  });

  test("every monitor is announced with its name and its status", async () => {
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Monitor api.example.com. Status: Operational.",
        }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: "Monitor db.example.com. Status: Offline.",
        }),
      ).toBeTruthy();
    });
  });

  test("each monitor names the project it came from", async () => {
    /*
     * The same hostname is monitored in staging and in production more often
     * than not, so the row is ambiguous without the project on it.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(offlineMonitor("monitor-1", "api.example.com")),
        wrap(
          offlineMonitor("monitor-2", "api.example.com"),
          "project-2",
          "Acme Staging",
        ),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Acme Production")).toBeTruthy();
      expect(screen.getByText("Acme Staging")).toBeTruthy();
    });
  });

  test("a monitor the server sent no status for is still listed", async () => {
    /*
     * currentMonitorStatus is a relation, and a monitor that has never been
     * checked has none. Dropping such a row - or letting it throw on the way
     * to reading its name - would hide the monitors most likely to be
     * misconfigured.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(
          makeMonitor({
            _id: "monitor-3",
            name: "new.example.com",
            currentMonitorStatus: undefined,
          }),
        ),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Monitor new.example.com. Status: unknown.",
        }),
      ).toBeTruthy();
    });
  });
});

describe("Grouping the fleet", () => {
  test("monitors in trouble are listed above the monitors that are fine", async () => {
    /*
     * Input order deliberately puts the healthy monitor first, so passing
     * this requires the screen to have re-grouped rather than simply rendered
     * what it was handed.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(healthyMonitor("monitor-1", "api.example.com")),
        wrap(offlineMonitor("monitor-2", "db.example.com")),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(listedMonitors()).toEqual([
        "Monitor db.example.com. Status: Offline.",
        "Monitor api.example.com. Status: Operational.",
      ]);
    });
  });

  test("a monitor whose checks are switched off is grouped with the issues, whatever its last status said", async () => {
    /*
     * A disabled monitor still holds the status it had when it was last
     * checked, and that status is usually "Operational". Reading the status
     * first would file it under the healthy monitors, where it is invisible -
     * and a monitor that is not being checked is precisely the one nobody
     * will be paged about.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(healthyMonitor("monitor-1", "api.example.com")),
        wrap(
          makeMonitor({
            _id: "monitor-2",
            name: "cache.example.com",
            disableActiveMonitoring: true,
            currentMonitorStatus: makeNamedEntityWithColor({
              _id: "monitor-status-operational",
              name: "Operational",
            }),
          }),
        ),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Issues")).toBeTruthy();
      expect(listedMonitors()).toEqual([
        "Monitor cache.example.com. Status: Disabled.",
        "Monitor api.example.com. Status: Operational.",
      ]);
    });
  });

  test("a fleet with nothing wrong has no issues section at all", async () => {
    mockMonitors.current = stateWith({
      items: [wrap(healthyMonitor("monitor-1", "api.example.com"))],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.queryByText("Issues")).toBeNull();
    });
  });
});

describe("The summary at the top", () => {
  test("counts what is wrong, what is switched off and what is fine", async () => {
    /*
     * No healthy monitor in this fleet, which keeps the word "Operational"
     * from appearing twice - once as a summary label and once as the title of
     * the section it heads - so each number can be tied to exactly one label.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(offlineMonitor("monitor-1", "db.example.com")),
        wrap(offlineMonitor("monitor-2", "queue.example.com")),
        wrap(offlineMonitor("monitor-3", "cdn.example.com")),
        wrap(
          makeMonitor({
            _id: "monitor-4",
            name: "cache.example.com",
            disableActiveMonitoring: true,
          }),
        ),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(countsBesideLabel("Inoperational")).toEqual(["3"]);
      expect(countsBesideLabel("Disabled")).toEqual(["1"]);
      expect(countsBesideLabel("Operational")).toEqual(["0"]);
    });
  });

  test("a monitor that is switched off is counted once, as disabled, not also as broken", async () => {
    /*
     * The last thing an offline monitor did before someone disabled it was to
     * be offline, so it satisfies both descriptions. Counting it twice
     * inflates the number of things actually down right now.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(
          makeMonitor({
            _id: "monitor-1",
            name: "cache.example.com",
            disableActiveMonitoring: true,
            currentMonitorStatus: makeNamedEntityWithColor({
              _id: "monitor-status-offline",
              name: "Offline",
            }),
          }),
        ),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(countsBesideLabel("Inoperational")).toEqual(["0"]);
      expect(countsBesideLabel("Disabled")).toEqual(["1"]);
    });
  });

  test("the summary and the section heading agree on how many monitors are fine", async () => {
    /*
     * Both numbers describe the same set, so a fleet with healthy monitors
     * shows the word twice and the two figures have to match. They are
     * derived from different arrays in the screen, which is exactly how they
     * come to disagree.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(healthyMonitor("monitor-1", "api.example.com")),
        wrap(healthyMonitor("monitor-2", "www.example.com")),
        wrap(healthyMonitor("monitor-3", "cdn.example.com")),
      ],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(countsBesideLabel("Operational")).toEqual(["3", "3"]);
    });
  });

  test("there is no summary to read when there are no monitors", async () => {
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.queryByText("Inoperational")).toBeNull();
    });
  });
});

describe("When the fleet is genuinely empty", () => {
  test("the screen says so, and offers a reason to expect otherwise", async () => {
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.getByText("No monitors")).toBeTruthy();
      expect(
        screen.getByText("Monitors from your projects will appear here."),
      ).toBeTruthy();
    });
  });

  test("nothing is dressed up as a placeholder or a failure", async () => {
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.queryAllByLabelText("Loading content").length).toBe(0);
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });
});

describe("When the monitors could not be loaded", () => {
  beforeEach(() => {
    mockMonitors.current = stateWith({ isError: true });
  });

  test("the failure is admitted rather than shown as an empty fleet", async () => {
    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeTruthy();
      expect(
        screen.getByText(
          "Failed to load monitors. Pull to refresh or try again.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("No monitors")).toBeNull();
    });
  });

  test("there is a way to ask again", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    mockMonitors.current = stateWith({
      isError: true,
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<MonitorsScreen />);

    const retry: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", { name: "Retry" });
    });

    await fireEvent.press(retry);

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  test("a project that failed does not turn the monitors that did load into an empty fleet", async () => {
    /*
     * The fan-out reports isError when any one project fails, so this state
     * arrives with rows in hand. Whatever the screen chooses to show, the one
     * thing it must not say is that there are no monitors.
     */
    mockMonitors.current = stateWith({
      isError: true,
      items: [wrap(offlineMonitor("monitor-1", "db.example.com"))],
    });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.queryByText("No monitors")).toBeNull();
    });
  });

  test("a failure that arrives while the first load is still running keeps the placeholders", async () => {
    /*
     * One project failing early says nothing about the ones still being
     * asked. Swapping straight to the error page here would throw away a
     * fleet that is about to arrive.
     */
    mockMonitors.current = stateWith({ isError: true, isLoading: true });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(screen.getAllByLabelText("Loading content").length).toBe(3);
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });
});

describe("Pulling the list down to refresh", () => {
  test("asks for the fleet again and answers the gesture in the hand", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    mockMonitors.current = stateWith({
      items: [wrap(offlineMonitor("monitor-1", "db.example.com"))],
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<MonitorsScreen />);

    await fireEvent(refreshControl(), "refresh");

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(mockLightImpact).toHaveBeenCalledTimes(1);
    });
  });

  test("a second pull asks a second time", async () => {
    /*
     * Nothing debounces this, and nothing should: a responder pulling twice
     * is a responder who does not believe what is on screen.
     */
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    mockMonitors.current = stateWith({
      items: [wrap(offlineMonitor("monitor-1", "db.example.com"))],
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<MonitorsScreen />);

    await fireEvent(refreshControl(), "refresh");
    await fireEvent(refreshControl(), "refresh");

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(2);
    });
  });

  test("the empty fleet can be refreshed too", async () => {
    /*
     * The empty state is rendered as the list's own empty component rather
     * than in place of the list, which is what keeps the gesture available to
     * a responder who is looking at "No monitors" and does not believe it.
     */
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    mockMonitors.current = stateWith({
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<MonitorsScreen />);

    await fireEvent(refreshControl(), "refresh");

    await waitFor(() => {
      expect(screen.getByText("No monitors")).toBeTruthy();
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Paging through a large fleet", () => {
  test("only the first page of monitors is put on the list", async () => {
    /*
     * The section header counts the rows the section was given, not the rows
     * the fleet holds, so it is where the page size is visible. Handing a
     * virtualised list several hundred rows at once is what this slice
     * exists to avoid.
     */
    mockMonitors.current = stateWith({ items: offlineFleet(25) });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(countsBesideLabel("Issues")).toEqual(["20"]);
      expect(countsBesideLabel("Inoperational")).toEqual(["25"]);
    });
  });

  test("a fleet that fits on one page is not truncated", async () => {
    mockMonitors.current = stateWith({ items: offlineFleet(4) });

    await render(<MonitorsScreen />);

    await waitFor(() => {
      expect(countsBesideLabel("Issues")).toEqual(["4"]);
    });
  });
});

describe("Opening a monitor", () => {
  test("the detail screen is asked for that monitor in the project it came from", async () => {
    /*
     * projectId here is the project whose query returned the row, and it is
     * deliberately not the projectId serialised onto the monitor itself: the
     * detail screen sends it as the tenant header, so taking the wrong one
     * produces an empty detail page for a monitor the responder is looking
     * straight at.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(
          makeMonitor({
            _id: "monitor-7",
            name: "db.example.com",
            projectId: "project-serialised-onto-the-row",
            currentMonitorStatus: makeNamedEntityWithColor({
              _id: "monitor-status-offline",
              name: "Offline",
            }),
          }),
          "project-2",
          "Acme Staging",
        ),
      ],
    });

    await render(<MonitorsScreen />);

    const card: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", {
        name: "Monitor db.example.com. Status: Offline.",
      });
    });

    await fireEvent.press(card);

    expect(mockNavigate).toHaveBeenCalledWith("MonitorDetail", {
      monitorId: "monitor-7",
      projectId: "project-2",
    });
  });

  test("two monitors with the same name open the one that was tapped", async () => {
    /*
     * The same host watched from two projects is the case where a key or a
     * closure captured once for the whole list gives itself away.
     */
    mockMonitors.current = stateWith({
      items: [
        wrap(offlineMonitor("monitor-1", "db.example.com")),
        wrap(
          healthyMonitor("monitor-2", "db.example.com"),
          "project-2",
          "Acme Staging",
        ),
      ],
    });

    await render(<MonitorsScreen />);

    const healthy: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", {
        name: "Monitor db.example.com. Status: Operational.",
      });
    });

    await fireEvent.press(healthy);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("MonitorDetail", {
      monitorId: "monitor-2",
      projectId: "project-2",
    });
  });
});

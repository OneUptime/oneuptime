import React from "react";
import { Alert, StyleSheet } from "react-native";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import AlertsScreen from "./AlertsScreen";
import { useAllProjectAlerts } from "../hooks/useAllProjectAlerts";
import { useAllProjectAlertEpisodes } from "../hooks/useAllProjectAlertEpisodes";
import { useAllProjectAlertStates } from "../hooks/useAllProjectAlertStates";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlert,
  makeAlertEpisode,
  makeAlertState,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius, spacing } from "../theme/tokens";
import type {
  AlertItem,
  AlertState,
  ProjectAlertEpisodeItem,
  ProjectAlertItem,
} from "../api/types";

/*
 * The alerts list is where a woken responder lands, and it makes three claims
 * that a regression could quietly invert:
 *
 *   - which alerts are still live. "Active" and "Resolved" are decided by the
 *     per-project state ids the account defines, never by the words in a state
 *     name, because an account is free to call its resolved state anything at
 *     all and free to call a live state "Resolved". Filing by name would hide
 *     a firing alert under a heading nobody reads.
 *   - whether an alert opened is the alert tapped. The detail screen is
 *     addressed by id AND project id, and a row from one project carrying
 *     another's tenant reaches a 404 rather than the page.
 *   - whether a swipe-to-acknowledge actually landed. That is the one this
 *     file cares about most: the swipe leaves no trace once the row springs
 *     back, so a failure that is only ever reported as a haptic is
 *     indistinguishable, on a phone in a pocket, from success - while the
 *     escalation policy keeps paging a responder who thinks they have it.
 *
 * The three hooks behind the screen have suites of their own; here they are
 * stand-ins whose state each test sets directly, because what is under test is
 * which screen a given hook state produces. The `mock` prefix is what lets
 * jest.mock's hoisted factories reach these holders.
 */

type AlertsState = ReturnType<typeof useAllProjectAlerts>;
type EpisodesState = ReturnType<typeof useAllProjectAlertEpisodes>;
type StatesState = ReturnType<typeof useAllProjectAlertStates>;

const mockAlerts: { current: AlertsState } = { current: {} as AlertsState };
const mockEpisodes: { current: EpisodesState } = {
  current: {} as EpisodesState,
};
const mockStates: { current: StatesState } = { current: {} as StatesState };

const mockRefetchAlerts: jest.Mock = jest.fn(async () => {
  return undefined;
});
const mockRefetchEpisodes: jest.Mock = jest.fn(async () => {
  return undefined;
});
const mockChangeAlertState: jest.Mock = jest.fn();
const mockNavigate: jest.Mock = jest.fn();
const mockRoute: {
  params:
    | {
        initialSegment?: "alerts" | "episodes";
        initialFilter?: "all" | "active" | "resolved";
      }
    | undefined;
} = { params: undefined };
const mockSuccessFeedback: jest.Mock = jest.fn();
const mockErrorFeedback: jest.Mock = jest.fn();

jest.mock("../hooks/useAllProjectAlerts", () => {
  return {
    useAllProjectAlerts: () => {
      return mockAlerts.current;
    },
  };
});

jest.mock("../hooks/useAllProjectAlertEpisodes", () => {
  return {
    useAllProjectAlertEpisodes: () => {
      return mockEpisodes.current;
    },
  };
});

jest.mock("../hooks/useAllProjectAlertStates", () => {
  return {
    useAllProjectAlertStates: () => {
      return mockStates.current;
    },
  };
});

/*
 * Reached through a wrapper rather than handed over directly, because
 * jest.mock's factory is hoisted above the const declarations above it and
 * would otherwise read them in their temporal dead zone.
 */
jest.mock("../api/alerts", () => {
  return {
    changeAlertState: (
      projectId: string,
      alertId: string,
      alertStateId: string,
    ): Promise<void> => {
      return mockChangeAlertState(projectId, alertId, alertStateId);
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: mockSuccessFeedback,
        errorFeedback: mockErrorFeedback,
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 248;
    },
  };
});

let mockColorScheme: "light" | "dark" = "light";

/*
 * react-native exposes useColorScheme through a getter that cannot be spied
 * on, so the module behind it is replaced. Light unless a test says otherwise.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useRoute: () => {
      return mockRoute;
    },
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});

/*
 * Alert.alert is a native call. Spied once at module scope rather than
 * re-spied per test so that each test is asserting against the same fake;
 * jest.config's `clearMocks` empties its call log between tests on its own.
 */
const mockAlertDialog: jest.SpyInstance = jest
  .spyOn(Alert, "alert")
  .mockImplementation((): void => {
    return undefined;
  });

/*
 * State ids and state names are deliberately pulled apart in these fixtures.
 * Nothing here is called "Active" or "Resolved", so any such word the tests
 * find on screen can only be a section heading the screen itself decided on -
 * and the two tests that DO name a state after a section prove the naming is
 * ignored.
 */
const PROJECT_ID: string = "project-1";
const CREATED_STATE_ID: string = "alert-state-created";
const ACKNOWLEDGED_STATE_ID: string = "alert-state-acknowledged";
const RESOLVED_STATE_ID: string = "alert-state-resolved";

const ACTIVE_ALERT_LABEL: string =
  "Alert #12, Disk almost full. State: Created. Severity: Critical.";

function projectStates(): AlertState[] {
  return [
    makeAlertState({
      _id: CREATED_STATE_ID,
      name: "Created",
      isCreatedState: true,
      order: 1,
    }),
    makeAlertState({
      _id: ACKNOWLEDGED_STATE_ID,
      name: "Taken",
      isCreatedState: false,
      isAcknowledgedState: true,
      order: 2,
    }),
    makeAlertState({
      _id: RESOLVED_STATE_ID,
      name: "Closed out",
      isCreatedState: false,
      isResolvedState: true,
      order: 3,
    }),
  ];
}

function wrapAlert(item: AlertItem): ProjectAlertItem {
  return { item, projectId: PROJECT_ID, projectName: "Acme Production" };
}

function activeAlert(): ProjectAlertItem {
  return wrapAlert(
    makeAlert({
      _id: "alert-1",
      title: "Disk almost full",
      alertNumber: 12,
      alertNumberWithPrefix: "#12",
      currentAlertState: makeNamedEntityWithColor({
        _id: CREATED_STATE_ID,
        name: "Created",
      }),
    }),
  );
}

function resolvedAlert(): ProjectAlertItem {
  return wrapAlert(
    makeAlert({
      _id: "alert-2",
      title: "Certificate expiring",
      alertNumber: 13,
      alertNumberWithPrefix: "#13",
      currentAlertState: makeNamedEntityWithColor({
        _id: RESOLVED_STATE_ID,
        name: "Closed out",
      }),
    }),
  );
}

function activeEpisode(): ProjectAlertEpisodeItem {
  return {
    item: makeAlertEpisode({
      currentAlertState: makeNamedEntityWithColor({
        _id: CREATED_STATE_ID,
        name: "Created",
      }),
    }),
    projectId: PROJECT_ID,
    projectName: "Acme Production",
  };
}

test("the search limit follows the loaded segment, even when a search has no matches", async () => {
  mockAlerts.current = alertsWith({
    items: Array.from(
      { length: 100 },
      (_: unknown, index: number): ProjectAlertItem => {
        return wrapAlert(makeAlert({ _id: `recent-alert-${index}` }));
      },
    ),
  });
  const view: Awaited<ReturnType<typeof render>> = await render(
    <AlertsScreen />,
    { wrapper: createQueryWrapper(createTestQueryClient()) },
  );
  expect(
    screen.getByText("Search covers the 100 most recent alerts."),
  ).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText("Search alerts and episodes"),
    "no matching record",
  );
  expect(
    screen.getByText("Search covers the 100 most recent alerts."),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Episodes" }));
  expect(screen.queryByText(/Search covers the 100 most recent/)).toBeNull();
  mockEpisodes.current = episodesWith({
    items: Array.from(
      { length: 100 },
      (_: unknown, index: number): ProjectAlertEpisodeItem => {
        return {
          ...activeEpisode(),
          item: makeAlertEpisode({ _id: `recent-episode-${index}` }),
        };
      },
    ),
  });
  await view.rerender(<AlertsScreen />);
  expect(
    screen.getByText("Search covers the 100 most recent episodes."),
  ).toBeTruthy();
  expect(
    screen.queryByText("Search covers the 100 most recent alerts."),
  ).toBeNull();
});

function alertsWith(overrides: Partial<AlertsState> = {}): AlertsState {
  return {
    items: [],
    isLoading: false,
    isError: false,
    refetch: mockRefetchAlerts as unknown as () => Promise<void>,
    ...overrides,
  };
}

function episodesWith(overrides: Partial<EpisodesState> = {}): EpisodesState {
  return {
    items: [],
    isLoading: false,
    isError: false,
    refetch: mockRefetchEpisodes as unknown as () => Promise<void>,
    ...overrides,
  };
}

function statesWith(states: AlertState[] = projectStates()): StatesState {
  return {
    statesMap: new Map<string, AlertState[]>([[PROJECT_ID, states]]),
    isLoading: false,
    isError: false,
  };
}

async function renderAlertsScreen(): Promise<void> {
  await render(<AlertsScreen />, {
    wrapper: createQueryWrapper(createTestQueryClient()),
  });
}

/*
 * A swipe cannot be delivered with `fireEvent`: the library refuses to
 * dispatch to a touch responder whose `onMoveShouldSetResponder` answers
 * false, and SwipeableCard's answers false until the drag is already past
 * 10pt - a condition only a delivered move can create. So the responder's own
 * handlers are invoked on the rendered host view, carrying the touch history
 * the real responder system would have attached.
 *
 * The history is load-bearing rather than decoration: PanResponder does not
 * read dx off the event, it accumulates it from the centroid of the touches
 * that moved, so a hand-built event with no touch bank produces a gesture of
 * zero distance and a test that passes whatever the screen does.
 */
interface PanHandlerProps {
  onMoveShouldSetResponder?: (event: unknown) => boolean;
  onResponderGrant?: (event: unknown) => void;
  onResponderMove?: (event: unknown) => void;
  onResponderRelease?: (event: unknown) => void;
}

interface TouchTrack {
  touchActive: boolean;
  startPageX: number;
  startPageY: number;
  startTimeStamp: number;
  currentPageX: number;
  currentPageY: number;
  currentTimeStamp: number;
  previousPageX: number;
  previousPageY: number;
  previousTimeStamp: number;
}

interface TouchEvent {
  touchHistory: {
    touchBank: TouchTrack[];
    numberActiveTouches: number;
    indexOfSingleActiveTouch: number;
    mostRecentTimeStamp: number;
  };
  nativeEvent: { touches: TouchTrack[] };
}

type RenderedElement = ReturnType<typeof screen.getByLabelText>;

const TOUCH_START_X: number = 200;
const TOUCH_Y: number = 300;

function touchAt(
  currentX: number,
  previousX: number,
  currentTimeStamp: number,
  previousTimeStamp: number,
): TouchEvent {
  const track: TouchTrack = {
    touchActive: true,
    startPageX: TOUCH_START_X,
    startPageY: TOUCH_Y,
    startTimeStamp: 100,
    currentPageX: currentX,
    currentPageY: TOUCH_Y,
    currentTimeStamp: currentTimeStamp,
    previousPageX: previousX,
    previousPageY: TOUCH_Y,
    previousTimeStamp: previousTimeStamp,
  };

  return {
    touchHistory: {
      touchBank: [track],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: currentTimeStamp,
    },
    nativeEvent: { touches: [track] },
  };
}

/**
 * The nearest ancestor of a row (or the row itself) that SwipeableCard spread
 * its pan handlers onto - the foreground view that moves under the finger.
 *
 * `onMoveShouldSetResponder` is what tells the two responders on this row
 * apart. The card's own Pressable installs onResponderGrant/Move/Release too,
 * via Pressability, and it is the INNER of the two - so a search for those
 * finds the tap handler and drives a gesture that can never acknowledge
 * anything. Only PanResponder publishes a move-should-set handler.
 */
function findPannable(from: RenderedElement): RenderedElement {
  let current: RenderedElement | null = from;

  while (current) {
    const props: PanHandlerProps = current.props as PanHandlerProps;
    if (typeof props.onMoveShouldSetResponder === "function") {
      return current;
    }
    current = current.parent;
  }

  throw new Error("Nothing above this row carries the pan handlers.");
}

/**
 * One finger down on the row with `label`, dragged 120pt to the left - past
 * the 80pt threshold, which is the gesture that fires `rightAction` - and
 * lifted.
 */
async function swipeToAcknowledge(label: string): Promise<void> {
  const handlers: PanHandlerProps = findPannable(screen.getByLabelText(label))
    .props as PanHandlerProps;
  const dx: number = -120;

  await act(async (): Promise<void> => {
    handlers.onResponderGrant?.(
      touchAt(TOUCH_START_X, TOUCH_START_X, 100, 100),
    );
    handlers.onResponderMove?.(
      touchAt(TOUCH_START_X + dx, TOUCH_START_X, 200, 100),
    );
    handlers.onResponderRelease?.(
      touchAt(TOUCH_START_X + dx, TOUCH_START_X + dx, 300, 200),
    );
  });

  /*
   * Letting go starts the spring back to centre, which React Native's own jest
   * mock of the native driver reports finished on a 16ms timer, and the
   * acknowledge itself is several awaits deep. Waiting both out here keeps one
   * test's animation from completing inside the next one and leaves no timer
   * pending at teardown.
   */
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });
  });
}

beforeEach(() => {
  mockColorScheme = "light";
  mockRoute.params = undefined;
  mockAlerts.current = alertsWith();
  mockEpisodes.current = episodesWith();
  mockStates.current = statesWith();
  mockChangeAlertState.mockResolvedValue(undefined);
  mockSuccessFeedback.mockResolvedValue(undefined);
  mockErrorFeedback.mockResolvedValue(undefined);
});

describe("What the screen shows before the alerts arrive", () => {
  test("a request still in flight gets skeletons, not an empty list", async () => {
    /*
     * "No alerts" and "we have not asked yet" are the same empty array, and
     * only one of them means the responder can put the phone down.
     */
    mockAlerts.current = alertsWith({ isLoading: true });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getAllByLabelText("Loading content")).toHaveLength(3);
    });

    expect(screen.queryByText("No alerts")).toBeNull();
  });

  test("alerts already in hand are shown rather than replaced by skeletons", async () => {
    /*
     * A background refetch reports isLoading on a list the screen is already
     * holding. Blanking a live alert out to a skeleton every time the list
     * refreshes would be worse than showing a slightly stale row.
     */
    mockAlerts.current = alertsWith({
      items: [activeAlert()],
      isLoading: true,
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    expect(screen.queryByLabelText("Loading content")).toBeNull();
  });

  test("the segmented control is reachable while the alerts load", async () => {
    /*
     * Episodes may well have answered when alerts have not, so the loading
     * screen keeps the switch rather than trapping the responder behind it.
     */
    mockAlerts.current = alertsWith({ isLoading: true });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByText("Episodes")).toBeTruthy();
    });
  });
});

describe("What the screen shows when nothing came back", () => {
  test("a genuinely empty account is told it has no alerts", async () => {
    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByText("No alerts")).toBeTruthy();
    });

    expect(
      screen.getByText("Alerts in this project will appear here."),
    ).toBeTruthy();
  });

  test("a failed request is not dressed up as an empty account", async () => {
    mockAlerts.current = alertsWith({ isError: true });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeTruthy();
    });

    expect(
      screen.getByText("Failed to load alerts. Pull to refresh or try again."),
    ).toBeTruthy();
    expect(screen.queryByText("No alerts")).toBeNull();
  });

  test("the failure offers a way to ask again", async () => {
    mockAlerts.current = alertsWith({ isError: true });

    await renderAlertsScreen();

    const retry: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", { name: "Retry" });
    });

    fireEvent.press(retry);

    await waitFor(() => {
      expect(mockRefetchAlerts).toHaveBeenCalled();
    });
  });

  test("retrying on the episodes tab asks for episodes, not alerts", async () => {
    /*
     * One Retry button serves both tabs, and it used to be easy for it to
     * retry whichever list happened to be wired first. A responder who
     * retried episodes and got another alerts request would sit in front of
     * the same error forever.
     */
    mockEpisodes.current = episodesWith({ isError: true });

    await renderAlertsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    const retry: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", { name: "Retry" });
    });

    fireEvent.press(retry);

    await waitFor(() => {
      expect(mockRefetchEpisodes).toHaveBeenCalled();
    });

    expect(mockRefetchAlerts).not.toHaveBeenCalled();
  });
});

describe("What the screen shows when alerts did arrive", () => {
  test("every alert in the list is on screen, described for a screen reader", async () => {
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    expect(
      screen.getByLabelText(
        "Alert #13, Certificate expiring. State: Closed out. Severity: Critical.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No alerts")).toBeNull();
  });

  test("an alert missing the relations it is drawn from still renders", async () => {
    /*
     * Severity and state are optional on the wire - an alert created by an API
     * caller can arrive with neither - and a row that threw on the missing
     * field would take the whole SectionList down with it, hiding every other
     * alert rather than one.
     */
    mockAlerts.current = alertsWith({
      items: [
        wrapAlert(
          makeAlert({
            _id: "alert-9",
            title: "Raised by the API",
            alertNumber: 9,
            alertNumberWithPrefix: "#9",
            currentAlertState: undefined,
            alertSeverity: undefined,
          }),
        ),
      ],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Alert #9, Raised by the API. State: unknown. Severity: unknown.",
        ),
      ).toBeTruthy();
    });
  });

  test("tapping an alert opens that alert in its own project", async () => {
    /*
     * Both halves matter. The detail request is tenanted, so a row that
     * carried the wrong projectId would open a 404 rather than the page - and
     * this list is a fan-out across every project the responder belongs to.
     */
    mockAlerts.current = alertsWith({ items: [activeAlert()] });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText(ACTIVE_ALERT_LABEL));

    expect(mockNavigate).toHaveBeenCalledWith("AlertDetail", {
      alertId: "alert-1",
      projectId: PROJECT_ID,
    });
  });
});

describe("Active and Resolved are decided by state id, never by state name", () => {
  test("an alert in a state the project flags as resolved is filed under Resolved", async () => {
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByRole("header", { name: "Active" })).toBeTruthy();
    });

    /*
     * Neither fixture state is called "Resolved" - the resolved one is called
     * "Closed out" - so this heading is the screen's own verdict and not a
     * state name echoed back off a card.
     */
    expect(screen.getByRole("header", { name: "Resolved" })).toBeTruthy();
  });

  test("a live alert whose state is merely NAMED Resolved stays actionable", async () => {
    /*
     * An account may call a live state anything it likes, "Resolved"
     * included. Sectioning on the word would file a firing alert under a
     * heading nobody reads and, worse, withdraw its Acknowledge action - the
     * swipe is only offered on rows the screen considers active, so the
     * responder would lose the fastest way to take the page.
     */
    mockAlerts.current = alertsWith({
      items: [
        wrapAlert(
          makeAlert({
            _id: "alert-3",
            title: "Misleadingly named state",
            alertNumber: 14,
            alertNumberWithPrefix: "#14",
            currentAlertState: makeNamedEntityWithColor({
              _id: "alert-state-live-but-oddly-named",
              name: "Resolved",
            }),
          }),
        ),
      ],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByRole("header", { name: "Active" })).toBeTruthy();
    });

    expect(screen.getByText("Acknowledge")).toBeTruthy();
  });

  test("a resolved alert whose state is named something else is still filed as resolved", async () => {
    /*
     * The converse, and the one that costs a responder time: an alert nobody
     * needs to look at, sitting at the top of the active list because its
     * state is called "Investigating".
     */
    mockAlerts.current = alertsWith({
      items: [
        wrapAlert(
          makeAlert({
            _id: "alert-4",
            title: "Done, oddly named",
            alertNumber: 15,
            alertNumberWithPrefix: "#15",
            currentAlertState: makeNamedEntityWithColor({
              _id: RESOLVED_STATE_ID,
              name: "Investigating",
            }),
          }),
        ),
      ],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByRole("header", { name: "Resolved" })).toBeTruthy();
    });

    expect(screen.queryByRole("header", { name: "Active" })).toBeNull();
    /* A resolved row has nothing left to acknowledge. */
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  test("a heading is only drawn for a section that has alerts in it", async () => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByRole("header", { name: "Active" })).toBeTruthy();
    });

    expect(screen.queryByRole("header", { name: "Resolved" })).toBeNull();
  });

  test("alerts wait for state metadata before claiming active or resolved", async () => {
    mockStates.current = {
      ...statesWith(),
      statesMap: new Map(),
      isLoading: true,
    };
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });
    await renderAlertsScreen();
    expect(screen.queryByRole("header", { name: "Active" })).toBeNull();
    expect(screen.queryByRole("header", { name: "Resolved" })).toBeNull();
    expect(screen.queryByText(/results?$/)).toBeNull();
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });
});

describe("The episode link switches between alerts and episodes", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });
    mockEpisodes.current = episodesWith({ items: [activeEpisode()] });
  });

  test("alerts are what the screen opens on", async () => {
    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    expect(screen.queryByText("Repeated disk pressure")).toBeNull();
  });

  test("choosing Episodes swaps the list for the episode list", async () => {
    await renderAlertsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Alert episode #3, Repeated disk pressure. State: Created. Severity: Critical.",
        ),
      ).toBeTruthy();
    });

    expect(screen.queryByLabelText(ACTIVE_ALERT_LABEL)).toBeNull();
  });

  test("choosing Alerts again brings the alerts back", async () => {
    await renderAlertsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    await waitFor(() => {
      expect(screen.getByText("Repeated disk pressure")).toBeTruthy();
    });

    fireEvent.press(screen.getByRole("button", { name: "Alerts" }));

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });
  });

  test("an empty episode list says so in its own words", async () => {
    mockEpisodes.current = episodesWith();

    await renderAlertsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    await waitFor(() => {
      expect(screen.getByText("No alert episodes")).toBeTruthy();
    });

    /* Not the alerts tab's empty state, which is about a different list. */
    expect(screen.queryByText("No alerts")).toBeNull();
  });

  test("tapping an episode opens that episode in its own project", async () => {
    await renderAlertsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    const episode: RenderedElement = await waitFor(() => {
      return screen.getByLabelText(
        "Alert episode #3, Repeated disk pressure. State: Created. Severity: Critical.",
      );
    });

    fireEvent.press(episode);

    expect(mockNavigate).toHaveBeenCalledWith("AlertEpisodeDetail", {
      episodeId: "alert-episode-1",
      projectId: PROJECT_ID,
    });
  });
});

describe("Swiping a row to acknowledge it", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });
  });

  test("the acknowledge reaches the server for that alert, in that project", async () => {
    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);

    expect(mockChangeAlertState).toHaveBeenCalledWith(
      PROJECT_ID,
      "alert-1",
      ACKNOWLEDGED_STATE_ID,
    );
  });

  test("a successful acknowledge confirms itself and re-asks the server", async () => {
    /*
     * The refetch is what makes the row show its new state; without it the
     * responder is looking at a list that still says the alert is untouched.
     */
    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);

    expect(mockSuccessFeedback).toHaveBeenCalled();
    expect(mockRefetchAlerts).toHaveBeenCalled();
    expect(mockAlertDialog).not.toHaveBeenCalled();
  });

  test("an acknowledge that never reached the server says so out loud", async () => {
    /*
     * This is the defect this suite exists for. The failure used to be
     * reported as an error haptic and nothing else, and the row springs back
     * to exactly where it was either way - so a responder holding the phone in
     * a pocket, or anyone who cannot feel or did not notice the buzz, was left
     * believing they had taken the page while the escalation policy went on
     * looking for somebody who would. A visible dialog is what the detail
     * screens already do for this same failure.
     */
    mockChangeAlertState.mockRejectedValue(new Error("Network request failed"));

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);

    await waitFor(() => {
      expect(mockAlertDialog).toHaveBeenCalledWith(
        "Error",
        "Failed to acknowledge this alert. It is still unacknowledged.",
      );
    });
  });

  test("the failure keeps its haptic as well as its dialog", async () => {
    /*
     * The buzz is the faster of the two signals for a responder who can feel
     * it, so surfacing the failure visibly must not have cost them that.
     */
    mockChangeAlertState.mockRejectedValue(new Error("Network request failed"));

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);

    await waitFor(() => {
      expect(mockErrorFeedback).toHaveBeenCalled();
    });

    expect(mockSuccessFeedback).not.toHaveBeenCalled();
  });

  test("a second attempt after a failure is reported just as loudly", async () => {
    /*
     * Nothing about the first failure is allowed to leave the screen quieter
     * the second time; a responder retrying a flaky connection needs the same
     * answer on every attempt.
     */
    mockChangeAlertState.mockRejectedValue(new Error("Network request failed"));

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);
    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);

    await waitFor(() => {
      expect(mockAlertDialog).toHaveBeenCalledTimes(2);
    });

    expect(mockChangeAlertState).toHaveBeenCalledTimes(2);
  });

  test("an alert that is already acknowledged offers no acknowledge swipe", async () => {
    mockAlerts.current = alertsWith({
      items: [
        wrapAlert(
          makeAlert({
            _id: "alert-5",
            title: "Already taken",
            alertNumber: 16,
            alertNumberWithPrefix: "#16",
            currentAlertState: makeNamedEntityWithColor({
              _id: ACKNOWLEDGED_STATE_ID,
              name: "Taken",
            }),
          }),
        ),
      ],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByText("Already taken")).toBeTruthy();
    });

    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  test("a project with no acknowledge state at all sends nothing", async () => {
    /*
     * The account is free to define states without an acknowledged one. There
     * is no id to move the alert to, so the row must offer nothing rather than
     * offer a swipe that quietly does nothing when it is used.
     */
    mockStates.current = statesWith([
      makeAlertState({
        _id: CREATED_STATE_ID,
        name: "Created",
        isCreatedState: true,
        order: 1,
      }),
    ]);

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    });

    expect(screen.queryByText("Acknowledge")).toBeNull();

    await swipeToAcknowledge(ACTIVE_ALERT_LABEL);

    expect(mockChangeAlertState).not.toHaveBeenCalled();
    expect(mockAlertDialog).not.toHaveBeenCalled();
  });
});

describe("Searching and filtering the response inbox", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });
    mockEpisodes.current = episodesWith({ items: [activeEpisode()] });
  });

  test("search combines title and project words regardless of case", async () => {
    await renderAlertsScreen();
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "DISK acme",
    );
    expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    expect(screen.queryByText("Certificate expiring")).toBeNull();
  });

  test("a reference search works with the resolved filter and can be cleared", async () => {
    await renderAlertsScreen();
    await fireEvent.press(
      screen.getByRole("button", { name: "Resolved only" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "#13",
    );
    expect(screen.getByText("Certificate expiring")).toBeTruthy();
    expect(screen.queryByLabelText(ACTIVE_ALERT_LABEL)).toBeNull();
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "no matching title",
    );
    expect(screen.getByText("No matching alerts")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Clear filters" }),
    );
    expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    expect(screen.getByText("Certificate expiring")).toBeTruthy();
    expect(
      screen.getByLabelText("Search alerts and episodes").props.value,
    ).toBe("");
  });

  test("a Home shortcut opens episodes directly and supports project search", async () => {
    mockRoute.params = { initialSegment: "episodes", initialFilter: "active" };
    await renderAlertsScreen();
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "acme",
    );
    expect(screen.getByText("Repeated disk pressure")).toBeTruthy();
    expect(screen.queryByLabelText(ACTIVE_ALERT_LABEL)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Active only" }).props
        .accessibilityState.selected,
    ).toBe(true);
  });

  test.each(["alerts", "episodes"] as const)(
    "an explicit %s shortcut clears an old search before showing its response queue",
    async (segment: "alerts" | "episodes") => {
      const view: Awaited<ReturnType<typeof render>> = await render(
        <AlertsScreen />,
        { wrapper: createQueryWrapper(createTestQueryClient()) },
      );
      await fireEvent.changeText(
        screen.getByLabelText("Search alerts and episodes"),
        "no matching title",
      );
      expect(screen.getByText("No matching alerts")).toBeTruthy();
      mockRoute.params = { initialSegment: segment, initialFilter: "active" };
      await view.rerender(<AlertsScreen />);
      expect(
        screen.getByLabelText("Search alerts and episodes").props.value,
      ).toBe("");
      expect(
        screen.getByRole("button", { name: "Active only" }).props
          .accessibilityState.selected,
      ).toBe(true);
      if (segment === "alerts") {
        expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
      } else {
        expect(screen.getByText("Repeated disk pressure")).toBeTruthy();
      }
    },
  );

  test("a normal rerender with unchanged route params preserves the reader's search", async () => {
    mockRoute.params = { initialSegment: "alerts", initialFilter: "active" };
    const view: Awaited<ReturnType<typeof render>> = await render(
      <AlertsScreen />,
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "no matching title",
    );
    await view.rerender(<AlertsScreen />);
    expect(
      screen.getByLabelText("Search alerts and episodes").props.value,
    ).toBe("no matching title");
    expect(screen.getByText("No matching alerts")).toBeTruthy();
  });

  test("inbox, episode and empty results keep enough bottom space for the navigation", async () => {
    await renderAlertsScreen();
    expect(
      screen.getByTestId("response-list").props.contentContainerStyle
        .paddingBottom,
    ).toBe(248);
    await fireEvent.press(screen.getByText("Episodes"));
    expect(
      screen.getByTestId("response-list").props.contentContainerStyle
        .paddingBottom,
    ).toBe(248);
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "not here",
    );
    expect(screen.getByText("No matching episodes")).toBeTruthy();
    expect(
      screen.getByTestId("response-list").props.contentContainerStyle
        .paddingBottom,
    ).toBe(248);
  });
});

describe("Filter totals and metadata recovery", () => {
  test("reports all matching records before pagination and resets a combined search/filter", async () => {
    mockAlerts.current = alertsWith({
      items: [
        ...Array.from({ length: 25 }, (_: unknown, index: number) => {
          return {
            ...activeAlert(),
            item: {
              ...activeAlert().item,
              _id: `active-${index}`,
              title: `Checkout ${index}`,
            },
          };
        }),
        resolvedAlert(),
      ],
    });
    await renderAlertsScreen();
    expect(screen.getByText("26 results")).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Active only" }));
    expect(screen.getByText("25 results")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "Checkout 24",
    );
    expect(screen.getByText("1 result")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Reset filters" }),
    );
    expect(screen.getByLabelText("Search alerts and episodes")).toHaveProp(
      "value",
      "",
    );
    expect(screen.getByText("26 results")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
  });

  test("episode totals follow their own state filter and reset", async () => {
    mockEpisodes.current = episodesWith({ items: [activeEpisode()] });
    await renderAlertsScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Episodes" }));
    expect(screen.getByText("1 result")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Resolved only" }),
    );
    expect(screen.getByText("0 results")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Reset filters" }),
    );
    expect(screen.getByText("1 result")).toBeTruthy();
  });

  test("failed state metadata has an explicit retry that refreshes states too", async () => {
    mockStates.current = {
      ...statesWith(),
      statesMap: new Map(),
      isError: true,
    };
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });
    const client: ReturnType<typeof createTestQueryClient> =
      createTestQueryClient();
    const retry: jest.SpyInstance = jest.spyOn(client, "refetchQueries");
    await render(<AlertsScreen />, { wrapper: createQueryWrapper(client) });
    expect(
      screen.getByText(
        "Could not load alert states. Retry to see which alerts are active or resolved.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Active" })).toBeNull();
    expect(screen.queryByText("2 results")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith({
      queryKey: ["alert-states"],
      type: "active",
    });
    expect(mockRefetchAlerts).toHaveBeenCalledTimes(1);
  });
});

test("a state refresh failure keeps cached alerts readable with a retry notice", async () => {
  mockStates.current = { ...statesWith(), isError: true };
  mockAlerts.current = alertsWith({ items: [activeAlert(), resolvedAlert()] });
  await renderAlertsScreen();
  expect(
    screen.getByText(
      "Could not refresh alert states. Showing last loaded states.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("header", { name: "Active" })).toBeTruthy();
  expect(screen.getByRole("header", { name: "Resolved" })).toBeTruthy();
  expect(screen.getByText("2 results")).toBeTruthy();
});

type Style = Record<string, unknown>;

function styleOf(element: RenderedElement): Style {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Style;
}

function isSelected(element: RenderedElement): boolean | undefined {
  return (
    element.props.accessibilityState as { selected?: boolean } | undefined
  )?.selected;
}

async function renderAlertsScreenDark(): Promise<void> {
  mockColorScheme = "dark";
  const QueryWrapper: ReturnType<typeof createQueryWrapper> =
    createQueryWrapper(createTestQueryClient());
  await render(<AlertsScreen />, {
    wrapper: ({ children }: { children: React.ReactNode }) => {
      return (
        <ThemeProvider>
          <QueryWrapper>{children}</QueryWrapper>
        </ThemeProvider>
      );
    },
  });
}

describe("The alerts/episodes switch", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });
    mockEpisodes.current = episodesWith({ items: [activeEpisode()] });
  });

  test("both views are always offered as buttons, with the current one selected", async () => {
    await renderAlertsScreen();

    const itemsButton: RenderedElement = screen.getByRole("button", {
      name: "Alerts",
    });
    const episodesButton: RenderedElement = screen.getByRole("button", {
      name: "Episodes",
    });
    expect(isSelected(itemsButton)).toBe(true);
    expect(isSelected(episodesButton)).toBe(false);

    await fireEvent.press(episodesButton);

    expect(isSelected(screen.getByRole("button", { name: "Alerts" }))).toBe(
      false,
    );
    expect(isSelected(screen.getByRole("button", { name: "Episodes" }))).toBe(
      true,
    );
  });

  test("each half explains what it shows to a screen reader", async () => {
    await renderAlertsScreen();

    expect(
      screen.getByRole("button", { name: "Alerts" }).props.accessibilityHint,
    ).toBe("Show individual alerts");
    expect(
      screen.getByRole("button", { name: "Episodes" }).props.accessibilityHint,
    ).toBe("Show related alerts grouped into episodes");
  });

  test("the line under the switch describes the list that is showing", async () => {
    await renderAlertsScreen();

    expect(screen.getByText("Each alert, listed on its own.")).toBeTruthy();
    expect(
      screen.queryByText("Related alerts, grouped into episodes."),
    ).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Episodes" }));

    expect(
      screen.getByText("Related alerts, grouped into episodes."),
    ).toBeTruthy();
    expect(screen.queryByText("Each alert, listed on its own.")).toBeNull();
  });

  test("choosing the view that is already showing changes nothing", async () => {
    await renderAlertsScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Alerts" }));

    expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toBeTruthy();
    expect(isSelected(screen.getByRole("button", { name: "Alerts" }))).toBe(
      true,
    );
  });

  test("a Home shortcut into episodes selects the Episodes half", async () => {
    mockRoute.params = { initialSegment: "episodes" };

    await renderAlertsScreen();

    expect(isSelected(screen.getByRole("button", { name: "Episodes" }))).toBe(
      true,
    );
    expect(screen.queryByLabelText(ACTIVE_ALERT_LABEL)).toBeNull();
  });

  test("the switch is a filled track whose selected half is a raised card", async () => {
    await renderAlertsScreen();

    expect(screen.getByTestId("response-view-switch")).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
      borderRadius: radius.md,
    });
    const selected: RenderedElement = screen.getByTestId(
      "response-view-alerts",
    );
    const unselected: RenderedElement = screen.getByTestId(
      "response-view-episodes",
    );
    expect(selected).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      minHeight: 44,
    });
    expect(styleOf(selected).boxShadow).toEqual(expect.any(String));
    expect(unselected).toHaveStyle({ backgroundColor: "transparent" });
    expect(styleOf(unselected).boxShadow).toBeUndefined();
  });

  test("switching views keeps the search and the state filter", async () => {
    await renderAlertsScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Active only" }));
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "acme",
    );

    await fireEvent.press(screen.getByRole("button", { name: "Episodes" }));

    expect(
      screen.getByLabelText("Search alerts and episodes").props.value,
    ).toBe("acme");
    expect(
      isSelected(screen.getByRole("button", { name: "Active only" })),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
  });
});

describe("Section headings and their counts", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });
  });

  test("each heading carries its own count beside it", async () => {
    await renderAlertsScreen();

    const active: RenderedElement = screen.getByRole("header", {
      name: "Active",
    });
    const resolved: RenderedElement = screen.getByRole("header", {
      name: "Resolved",
    });
    /* Heading and count share one row, which the web build reads together. */
    expect(active.parent).toBe(
      screen.getByTestId("response-section-active-count").parent,
    );
    expect(resolved.parent).toBe(
      screen.getByTestId("response-section-resolved-count").parent,
    );
    expect(
      screen.getByTestId("response-section-active-count"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("response-section-resolved-count"),
    ).toHaveTextContent("1");
  });

  test("headings use the design system's title style", async () => {
    await renderAlertsScreen();

    expect(screen.getByRole("header", { name: "Active" })).toHaveStyle({
      fontSize: 18,
      fontWeight: "600",
      color: lightColors.textPrimary,
    });
  });

  test("the active count is tinted as needing attention, the resolved one is neutral", async () => {
    await renderAlertsScreen();

    expect(screen.getByTestId("response-section-active-count")).toHaveStyle({
      backgroundColor: lightColors.statusErrorBg,
      borderRadius: radius.pill,
    });
    expect(screen.getByTestId("response-section-resolved-count")).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
      borderRadius: radius.pill,
    });
  });

  test("the count is the full section total, not the rendered page", async () => {
    mockAlerts.current = alertsWith({
      items: Array.from({ length: 30 }, (_: unknown, index: number) => {
        return {
          ...activeAlert(),
          item: { ...activeAlert().item, _id: `active-${index}` },
        };
      }),
    });

    await renderAlertsScreen();

    expect(
      screen.getByTestId("response-section-active-count"),
    ).toHaveTextContent("30");
    /* The list renders at most one page of rows at a time. */
    expect(
      screen.getAllByRole("button", { name: ACTIVE_ALERT_LABEL }).length,
    ).toBeLessThanOrEqual(20);
  });
});

describe("Filter chips and reset", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });
  });

  test("there is nothing to reset until a filter is applied", async () => {
    await renderAlertsScreen();

    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
    expect(isSelected(screen.getByRole("button", { name: "All states" }))).toBe(
      true,
    );
  });

  test("Active only hides the resolved section, Resolved only hides the active one", async () => {
    await renderAlertsScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Active only" }));
    expect(screen.getByRole("header", { name: "Active" })).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Resolved" })).toBeNull();
    expect(screen.getByText("1 result")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolved only" }),
    );
    expect(screen.queryByRole("header", { name: "Active" })).toBeNull();
    expect(screen.getByRole("header", { name: "Resolved" })).toBeTruthy();
    expect(screen.getByText("Certificate expiring")).toBeTruthy();
  });

  test("reset restores every section, the All chip and an empty search", async () => {
    await renderAlertsScreen();
    await fireEvent.press(
      screen.getByRole("button", { name: "Resolved only" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search alerts and episodes"),
      "nothing like this",
    );
    expect(screen.getByText("No matching alerts")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Reset filters" }),
    );

    expect(screen.getByRole("header", { name: "Active" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Resolved" })).toBeTruthy();
    expect(isSelected(screen.getByRole("button", { name: "All states" }))).toBe(
      true,
    );
    expect(
      screen.getByLabelText("Search alerts and episodes").props.value,
    ).toBe("");
    expect(screen.getByText("2 results")).toBeTruthy();
  });
});

describe("Empty and error states stay distinct", () => {
  test("an empty account says so, with nothing to retry or clear", async () => {
    await renderAlertsScreen();

    expect(screen.getByText("No alerts")).toBeTruthy();
    expect(
      screen.getByText("Alerts in this project will appear here."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.getByText("0 results")).toBeTruthy();
  });

  test("a filtered list with no matches offers to clear the filters instead", async () => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });
    await renderAlertsScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolved only" }),
    );

    expect(screen.getByText("No matching alerts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("a failure shows a retry, no result count and no empty-list copy", async () => {
    mockAlerts.current = alertsWith({ isError: true });
    await renderAlertsScreen();

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No alerts")).toBeNull();
    expect(screen.queryByText(/results?$/)).toBeNull();
    expect(screen.queryByTestId("response-list")).toBeNull();
  });

  test("loading and error pages keep the gutter and the tab bar clearance", async () => {
    mockAlerts.current = alertsWith({ isLoading: true });
    const view: Awaited<ReturnType<typeof render>> = await render(
      <AlertsScreen />,
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(screen.getByTestId("response-list-loading")).toBeTruthy();
    expect(
      screen.getByTestId("response-list-status").props.contentContainerStyle,
    ).toEqual(
      expect.objectContaining({ padding: spacing.xl, paddingBottom: 248 }),
    );
    expect(screen.getAllByLabelText("Loading content")).toHaveLength(3);
    for (const skeleton of screen.getAllByLabelText("Loading content")) {
      expect(skeleton).toHaveStyle({
        backgroundColor: lightColors.backgroundElevated,
        borderRadius: radius.lg,
      });
    }

    mockAlerts.current = alertsWith({ isError: true });
    await view.rerender(<AlertsScreen />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(
      screen.getByTestId("response-list-status").props.contentContainerStyle,
    ).toEqual(
      expect.objectContaining({ padding: spacing.xl, paddingBottom: 248 }),
    );
  });

  test("the list itself uses the screen gutter", async () => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });
    await renderAlertsScreen();

    expect(
      screen.getByTestId("response-list").props.contentContainerStyle,
    ).toEqual(
      expect.objectContaining({ padding: spacing.xl, paddingBottom: 248 }),
    );
  });
});

describe("The acknowledge swipe as drawn", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });
  });

  test("the fill uses the success token and its label the inverse text token", async () => {
    await renderAlertsScreen();

    expect(screen.getByTestId("swipe-action-right")).toHaveStyle({
      backgroundColor: lightColors.statusSuccess,
      borderRadius: radius.lg,
      bottom: spacing.md,
    });
    expect(screen.getByText("Acknowledge")).toHaveStyle({
      color: lightColors.textInverse,
    });
  });

  test("a resolved row has no swipe panel behind it at all", async () => {
    mockAlerts.current = alertsWith({ items: [resolvedAlert()] });
    await renderAlertsScreen();

    expect(screen.queryByTestId("swipe-action-right")).toBeNull();
    expect(screen.queryByTestId("swipe-action-left")).toBeNull();
  });
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });
  });

  test("the canvas, headings, counts and cards read from the dark palette", async () => {
    await renderAlertsScreenDark();

    expect(screen.getByRole("header", { name: "Active" })).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByTestId("response-section-active-count")).toHaveStyle({
      backgroundColor: darkColors.statusErrorBg,
    });
    expect(screen.getByTestId("response-section-resolved-count")).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
    expect(screen.getByLabelText(ACTIVE_ALERT_LABEL)).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
    expect(screen.getByTestId("response-screen")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
  });

  test("the view switch uses the dark track and raised segment", async () => {
    await renderAlertsScreenDark();

    expect(screen.getByTestId("response-view-switch")).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
    expect(screen.getByTestId("response-view-alerts")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
  });

  test("the acknowledge swipe keeps a readable label on the dark fill", async () => {
    await renderAlertsScreenDark();

    expect(screen.getByTestId("swipe-action-right")).toHaveStyle({
      backgroundColor: darkColors.statusSuccess,
    });
    expect(screen.getByText("Acknowledge")).toHaveStyle({
      color: darkColors.textInverse,
    });
  });

  test("nothing on the dark list is painted in light-palette white", async () => {
    await renderAlertsScreenDark();

    const white: RenderedElement[] = screen.container.queryAll(
      (node: RenderedElement) => {
        if (!node.props.style) {
          return false;
        }
        const style: Style = styleOf(node);
        return [style.backgroundColor, style.color, style.borderColor].some(
          (value: unknown) => {
            return (
              typeof value === "string" &&
              ["#ffffff", "#fff", "white"].includes(value.toLowerCase())
            );
          },
        );
      },
    );
    expect(white).toHaveLength(0);
  });

  test("the empty state is drawn in dark tokens too", async () => {
    mockAlerts.current = alertsWith();
    await renderAlertsScreenDark();

    expect(screen.getByText("No alerts")).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });

  test("the error state is drawn in dark tokens too", async () => {
    mockAlerts.current = alertsWith({ isError: true });
    await renderAlertsScreenDark();

    expect(screen.getByText("Something went wrong")).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });
});

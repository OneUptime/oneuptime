import React from "react";
import { Alert } from "react-native";
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

jest.mock("@react-navigation/native", () => {
  return {
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
      screen.getByText("Alerts assigned to you will appear here."),
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
      expect(screen.getByText("Active")).toBeTruthy();
    });

    /*
     * Neither fixture state is called "Resolved" - the resolved one is called
     * "Closed out" - so this heading is the screen's own verdict and not a
     * state name echoed back off a card.
     */
    expect(screen.getByText("Resolved")).toBeTruthy();
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
      expect(screen.getByText("Active")).toBeTruthy();
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
      expect(screen.getByText("Resolved")).toBeTruthy();
    });

    expect(screen.queryByText("Active")).toBeNull();
    /* A resolved row has nothing left to acknowledge. */
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  test("a heading is only drawn for a section that has alerts in it", async () => {
    mockAlerts.current = alertsWith({ items: [activeAlert()] });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
    });

    expect(screen.queryByText("Resolved")).toBeNull();
  });

  test("alerts whose project states have not arrived are left active", async () => {
    /*
     * On the very first render the per-project state queries have not
     * answered, so nothing is known to be resolved. Guessing in the other
     * direction would file a live alert under Resolved for as long as those
     * queries take.
     */
    mockStates.current = {
      statesMap: new Map<string, AlertState[]>(),
      isLoading: true,
      isError: false,
    };
    mockAlerts.current = alertsWith({
      items: [activeAlert(), resolvedAlert()],
    });

    await renderAlertsScreen();

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
    });

    expect(screen.queryByText("Resolved")).toBeNull();
    /* With no states known there is no acknowledge state to swipe towards. */
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });
});

describe("The segmented control switches between alerts and episodes", () => {
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

    fireEvent.press(screen.getByText("Alerts"));

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

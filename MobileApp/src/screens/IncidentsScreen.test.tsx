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
import IncidentsScreen from "./IncidentsScreen";
import { useAllProjectIncidents } from "../hooks/useAllProjectIncidents";
import { useAllProjectIncidentEpisodes } from "../hooks/useAllProjectIncidentEpisodes";
import { useAllProjectIncidentStates } from "../hooks/useAllProjectIncidentStates";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeIncident,
  makeIncidentEpisode,
  makeIncidentState,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type {
  IncidentItem,
  IncidentState,
  ProjectIncidentEpisodeItem,
  ProjectIncidentItem,
} from "../api/types";

/*
 * The incidents list is the other half of the page a responder is woken by,
 * and it makes the same three claims the alerts list does - each of which a
 * regression could quietly invert:
 *
 *   - which incidents are still live. "Active" and "Resolved" are decided by
 *     the per-project state ids the account defines, never by the words in a
 *     state name: an account is free to call its resolved state anything, and
 *     equally free to call a live state "Resolved". Filing by name would hide
 *     a running outage under a heading nobody reads.
 *   - whether the incident opened is the incident tapped. The detail request
 *     is tenanted, so a row carrying another project's id reaches a 404 rather
 *     than the page - and this list is a fan-out across every project the
 *     responder belongs to.
 *   - whether a swipe-to-acknowledge actually landed. That is the one this
 *     file cares about most: the row springs back to where it was whether the
 *     request succeeded or failed, so a failure reported only as a haptic is
 *     indistinguishable, on a phone in a pocket, from success - while the
 *     escalation policy keeps paging a responder who believes they have it.
 *
 * The three hooks behind the screen have suites of their own; here they are
 * stand-ins whose state each test sets directly, because what is under test is
 * which screen a given hook state produces. The `mock` prefix is what lets
 * jest.mock's hoisted factories reach these holders.
 */

type IncidentsState = ReturnType<typeof useAllProjectIncidents>;
type EpisodesState = ReturnType<typeof useAllProjectIncidentEpisodes>;
type StatesState = ReturnType<typeof useAllProjectIncidentStates>;

const mockIncidents: { current: IncidentsState } = {
  current: {} as IncidentsState,
};
const mockEpisodes: { current: EpisodesState } = {
  current: {} as EpisodesState,
};
const mockStates: { current: StatesState } = { current: {} as StatesState };

const mockRefetchIncidents: jest.Mock = jest.fn(async () => {
  return undefined;
});
const mockRefetchEpisodes: jest.Mock = jest.fn(async () => {
  return undefined;
});
const mockChangeIncidentState: jest.Mock = jest.fn();
const mockNavigate: jest.Mock = jest.fn();
const mockSuccessFeedback: jest.Mock = jest.fn();
const mockErrorFeedback: jest.Mock = jest.fn();

jest.mock("../hooks/useAllProjectIncidents", () => {
  return {
    useAllProjectIncidents: () => {
      return mockIncidents.current;
    },
  };
});

jest.mock("../hooks/useAllProjectIncidentEpisodes", () => {
  return {
    useAllProjectIncidentEpisodes: () => {
      return mockEpisodes.current;
    },
  };
});

jest.mock("../hooks/useAllProjectIncidentStates", () => {
  return {
    useAllProjectIncidentStates: () => {
      return mockStates.current;
    },
  };
});

/*
 * Reached through a wrapper rather than handed over directly, because
 * jest.mock's factory is hoisted above the const declarations above it and
 * would otherwise read them in their temporal dead zone.
 */
jest.mock("../api/incidents", () => {
  return {
    changeIncidentState: (
      projectId: string,
      incidentId: string,
      incidentStateId: string,
    ): Promise<void> => {
      return mockChangeIncidentState(projectId, incidentId, incidentStateId);
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
const CREATED_STATE_ID: string = "incident-state-created";
const ACKNOWLEDGED_STATE_ID: string = "incident-state-acknowledged";
const RESOLVED_STATE_ID: string = "incident-state-resolved";

const ACTIVE_INCIDENT_LABEL: string =
  "Incident #7, Checkout is down. State: Created. Severity: Critical.";

function projectStates(): IncidentState[] {
  return [
    makeIncidentState({
      _id: CREATED_STATE_ID,
      name: "Created",
      isCreatedState: true,
      order: 1,
    }),
    makeIncidentState({
      _id: ACKNOWLEDGED_STATE_ID,
      name: "Taken",
      isCreatedState: false,
      isAcknowledgedState: true,
      order: 2,
    }),
    makeIncidentState({
      _id: RESOLVED_STATE_ID,
      name: "Closed out",
      isCreatedState: false,
      isResolvedState: true,
      order: 3,
    }),
  ];
}

function wrapIncident(item: IncidentItem): ProjectIncidentItem {
  return { item, projectId: PROJECT_ID, projectName: "Acme Production" };
}

function activeIncident(): ProjectIncidentItem {
  return wrapIncident(
    makeIncident({
      _id: "incident-1",
      title: "Checkout is down",
      incidentNumber: 7,
      incidentNumberWithPrefix: "#7",
      currentIncidentState: makeNamedEntityWithColor({
        _id: CREATED_STATE_ID,
        name: "Created",
      }),
    }),
  );
}

function resolvedIncident(): ProjectIncidentItem {
  return wrapIncident(
    makeIncident({
      _id: "incident-2",
      title: "Search latency spike",
      incidentNumber: 8,
      incidentNumberWithPrefix: "#8",
      currentIncidentState: makeNamedEntityWithColor({
        _id: RESOLVED_STATE_ID,
        name: "Closed out",
      }),
    }),
  );
}

function activeEpisode(): ProjectIncidentEpisodeItem {
  return {
    item: makeIncidentEpisode({
      currentIncidentState: makeNamedEntityWithColor({
        _id: CREATED_STATE_ID,
        name: "Created",
      }),
    }),
    projectId: PROJECT_ID,
    projectName: "Acme Production",
  };
}

function incidentsWith(
  overrides: Partial<IncidentsState> = {},
): IncidentsState {
  return {
    items: [],
    isLoading: false,
    isError: false,
    refetch: mockRefetchIncidents as unknown as () => Promise<void>,
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

function statesWith(states: IncidentState[] = projectStates()): StatesState {
  return {
    statesMap: new Map<string, IncidentState[]>([[PROJECT_ID, states]]),
    isLoading: false,
    isError: false,
  };
}

async function renderIncidentsScreen(): Promise<void> {
  await render(<IncidentsScreen />, {
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
  mockIncidents.current = incidentsWith();
  mockEpisodes.current = episodesWith();
  mockStates.current = statesWith();
  mockChangeIncidentState.mockResolvedValue(undefined);
  mockSuccessFeedback.mockResolvedValue(undefined);
  mockErrorFeedback.mockResolvedValue(undefined);
});

describe("What the screen shows before the incidents arrive", () => {
  test("a request still in flight gets skeletons, not an empty list", async () => {
    /*
     * "No incidents" and "we have not asked yet" are the same empty array, and
     * only one of them means the responder can put the phone down.
     */
    mockIncidents.current = incidentsWith({ isLoading: true });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getAllByLabelText("Loading content")).toHaveLength(3);
    });

    expect(screen.queryByText("No incidents")).toBeNull();
  });

  test("incidents already in hand are shown rather than replaced by skeletons", async () => {
    /*
     * A background refetch reports isLoading on a list the screen is already
     * holding. Blanking a live incident out to a skeleton every time the list
     * refreshes would be worse than showing a slightly stale row.
     */
    mockIncidents.current = incidentsWith({
      items: [activeIncident()],
      isLoading: true,
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    expect(screen.queryByLabelText("Loading content")).toBeNull();
  });

  test("the segmented control is reachable while the incidents load", async () => {
    /*
     * Episodes may well have answered when incidents have not, so the loading
     * screen keeps the switch rather than trapping the responder behind it.
     */
    mockIncidents.current = incidentsWith({ isLoading: true });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Episodes")).toBeTruthy();
    });
  });
});

describe("What the screen shows when nothing came back", () => {
  test("a genuinely empty account is told it has no incidents", async () => {
    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("No incidents")).toBeTruthy();
    });

    expect(
      screen.getByText("Incidents assigned to you will appear here."),
    ).toBeTruthy();
  });

  test("a failed request is not dressed up as an empty account", async () => {
    mockIncidents.current = incidentsWith({ isError: true });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeTruthy();
    });

    expect(
      screen.getByText(
        "Failed to load incidents. Pull to refresh or try again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No incidents")).toBeNull();
  });

  test("the failure offers a way to ask again", async () => {
    mockIncidents.current = incidentsWith({ isError: true });

    await renderIncidentsScreen();

    const retry: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", { name: "Retry" });
    });

    fireEvent.press(retry);

    await waitFor(() => {
      expect(mockRefetchIncidents).toHaveBeenCalled();
    });
  });

  test("retrying on the episodes tab asks for episodes, not incidents", async () => {
    /*
     * One Retry button serves both tabs, and it used to be easy for it to
     * retry whichever list happened to be wired first. A responder who
     * retried episodes and got another incidents request would sit in front of
     * the same error forever.
     */
    mockEpisodes.current = episodesWith({ isError: true });

    await renderIncidentsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    const retry: RenderedElement = await waitFor(() => {
      return screen.getByRole("button", { name: "Retry" });
    });

    fireEvent.press(retry);

    await waitFor(() => {
      expect(mockRefetchEpisodes).toHaveBeenCalled();
    });

    expect(mockRefetchIncidents).not.toHaveBeenCalled();
  });
});

describe("What the screen shows when incidents did arrive", () => {
  test("every incident in the list is on screen, described for a screen reader", async () => {
    mockIncidents.current = incidentsWith({
      items: [activeIncident(), resolvedIncident()],
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    expect(
      screen.getByLabelText(
        "Incident #8, Search latency spike. State: Closed out. Severity: Critical.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No incidents")).toBeNull();
  });

  test("an incident declared by hand, with no monitor attached, still renders", async () => {
    /*
     * `monitors` is typed as always present but is not: an incident declared
     * by a human carries none, and detaching the last one leaves the field off
     * the payload. A row that threw on it would take the whole SectionList
     * down and hide every other incident with it.
     */
    mockIncidents.current = incidentsWith({
      items: [
        wrapIncident(
          makeIncident({
            _id: "incident-9",
            title: "Declared by hand",
            incidentNumber: 9,
            incidentNumberWithPrefix: "#9",
            monitors: undefined,
            currentIncidentState: undefined,
            incidentSeverity: undefined,
          }),
        ),
      ],
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Incident #9, Declared by hand. State: unknown. Severity: unknown.",
        ),
      ).toBeTruthy();
    });
  });

  test("tapping an incident opens that incident in its own project", async () => {
    /*
     * Both halves matter. The detail request is tenanted, so a row that
     * carried the wrong projectId would open a 404 rather than the page - and
     * this list is a fan-out across every project the responder belongs to.
     */
    mockIncidents.current = incidentsWith({ items: [activeIncident()] });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText(ACTIVE_INCIDENT_LABEL));

    expect(mockNavigate).toHaveBeenCalledWith("IncidentDetail", {
      incidentId: "incident-1",
      projectId: PROJECT_ID,
    });
  });
});

describe("Active and Resolved are decided by state id, never by state name", () => {
  test("an incident in a state the project flags as resolved is filed under Resolved", async () => {
    mockIncidents.current = incidentsWith({
      items: [activeIncident(), resolvedIncident()],
    });

    await renderIncidentsScreen();

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

  test("a live incident whose state is merely NAMED Resolved stays actionable", async () => {
    /*
     * An account may call a live state anything it likes, "Resolved"
     * included. Sectioning on the word would file a running outage under a
     * heading nobody reads and, worse, withdraw its Acknowledge action - the
     * swipe is only offered on rows the screen considers active, so the
     * responder would lose the fastest way to take the page.
     */
    mockIncidents.current = incidentsWith({
      items: [
        wrapIncident(
          makeIncident({
            _id: "incident-3",
            title: "Misleadingly named state",
            incidentNumber: 10,
            incidentNumberWithPrefix: "#10",
            currentIncidentState: makeNamedEntityWithColor({
              _id: "incident-state-live-but-oddly-named",
              name: "Resolved",
            }),
          }),
        ),
      ],
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
    });

    expect(screen.getByText("Acknowledge")).toBeTruthy();
  });

  test("a resolved incident whose state is named something else is still filed as resolved", async () => {
    /*
     * The converse, and the one that costs a responder time: an incident
     * nobody needs to look at, sitting at the top of the active list because
     * its state is called "Investigating".
     */
    mockIncidents.current = incidentsWith({
      items: [
        wrapIncident(
          makeIncident({
            _id: "incident-4",
            title: "Done, oddly named",
            incidentNumber: 11,
            incidentNumberWithPrefix: "#11",
            currentIncidentState: makeNamedEntityWithColor({
              _id: RESOLVED_STATE_ID,
              name: "Investigating",
            }),
          }),
        ),
      ],
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Resolved")).toBeTruthy();
    });

    expect(screen.queryByText("Active")).toBeNull();
    /* A resolved row has nothing left to acknowledge. */
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  test("a heading is only drawn for a section that has incidents in it", async () => {
    mockIncidents.current = incidentsWith({ items: [activeIncident()] });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
    });

    expect(screen.queryByText("Resolved")).toBeNull();
  });

  test("incidents whose project states have not arrived are left active", async () => {
    /*
     * On the very first render the per-project state queries have not
     * answered, so nothing is known to be resolved. Guessing in the other
     * direction would file a live incident under Resolved for as long as those
     * queries take.
     */
    mockStates.current = {
      statesMap: new Map<string, IncidentState[]>(),
      isLoading: true,
      isError: false,
    };
    mockIncidents.current = incidentsWith({
      items: [activeIncident(), resolvedIncident()],
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
    });

    expect(screen.queryByText("Resolved")).toBeNull();
    /* With no states known there is no acknowledge state to swipe towards. */
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });
});

describe("The segmented control switches between incidents and episodes", () => {
  beforeEach(() => {
    mockIncidents.current = incidentsWith({ items: [activeIncident()] });
    mockEpisodes.current = episodesWith({ items: [activeEpisode()] });
  });

  test("incidents are what the screen opens on", async () => {
    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    expect(screen.queryByText("Rolling checkout outage")).toBeNull();
  });

  test("choosing Episodes swaps the list for the episode list", async () => {
    await renderIncidentsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Incident episode #2, Rolling checkout outage. State: Created. Severity: Critical.",
        ),
      ).toBeTruthy();
    });

    expect(screen.queryByLabelText(ACTIVE_INCIDENT_LABEL)).toBeNull();
  });

  test("choosing Incidents again brings the incidents back", async () => {
    await renderIncidentsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    await waitFor(() => {
      expect(screen.getByText("Rolling checkout outage")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Incidents"));

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });
  });

  test("an empty episode list says so in its own words", async () => {
    mockEpisodes.current = episodesWith();

    await renderIncidentsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    await waitFor(() => {
      expect(screen.getByText("No incident episodes")).toBeTruthy();
    });

    /* Not the incidents tab's empty state, which is about a different list. */
    expect(screen.queryByText("No incidents")).toBeNull();
  });

  test("tapping an episode opens that episode in its own project", async () => {
    await renderIncidentsScreen();

    fireEvent.press(screen.getByText("Episodes"));

    const episode: RenderedElement = await waitFor(() => {
      return screen.getByLabelText(
        "Incident episode #2, Rolling checkout outage. State: Created. Severity: Critical.",
      );
    });

    fireEvent.press(episode);

    expect(mockNavigate).toHaveBeenCalledWith("IncidentEpisodeDetail", {
      episodeId: "incident-episode-1",
      projectId: PROJECT_ID,
    });
  });
});

describe("Swiping a row to acknowledge it", () => {
  beforeEach(() => {
    mockIncidents.current = incidentsWith({ items: [activeIncident()] });
  });

  test("the acknowledge reaches the server for that incident, in that project", async () => {
    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);

    expect(mockChangeIncidentState).toHaveBeenCalledWith(
      PROJECT_ID,
      "incident-1",
      ACKNOWLEDGED_STATE_ID,
    );
  });

  test("a successful acknowledge confirms itself and re-asks the server", async () => {
    /*
     * The refetch is what makes the row show its new state; without it the
     * responder is looking at a list that still says the incident is
     * untouched.
     */
    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);

    expect(mockSuccessFeedback).toHaveBeenCalled();
    expect(mockRefetchIncidents).toHaveBeenCalled();
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
    mockChangeIncidentState.mockRejectedValue(
      new Error("Network request failed"),
    );

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);

    await waitFor(() => {
      expect(mockAlertDialog).toHaveBeenCalledWith(
        "Error",
        "Failed to acknowledge this incident. It is still unacknowledged.",
      );
    });
  });

  test("the failure keeps its haptic as well as its dialog", async () => {
    /*
     * The buzz is the faster of the two signals for a responder who can feel
     * it, so surfacing the failure visibly must not have cost them that.
     */
    mockChangeIncidentState.mockRejectedValue(
      new Error("Network request failed"),
    );

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);

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
    mockChangeIncidentState.mockRejectedValue(
      new Error("Network request failed"),
    );

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);
    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);

    await waitFor(() => {
      expect(mockAlertDialog).toHaveBeenCalledTimes(2);
    });

    expect(mockChangeIncidentState).toHaveBeenCalledTimes(2);
  });

  test("an incident that is already acknowledged offers no acknowledge swipe", async () => {
    mockIncidents.current = incidentsWith({
      items: [
        wrapIncident(
          makeIncident({
            _id: "incident-5",
            title: "Already taken",
            incidentNumber: 12,
            incidentNumberWithPrefix: "#12",
            currentIncidentState: makeNamedEntityWithColor({
              _id: ACKNOWLEDGED_STATE_ID,
              name: "Taken",
            }),
          }),
        ),
      ],
    });

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByText("Already taken")).toBeTruthy();
    });

    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  test("a project with no acknowledge state at all sends nothing", async () => {
    /*
     * The account is free to define states without an acknowledged one. There
     * is no id to move the incident to, so the row must offer nothing rather
     * than offer a swipe that quietly does nothing when it is used.
     */
    mockStates.current = statesWith([
      makeIncidentState({
        _id: CREATED_STATE_ID,
        name: "Created",
        isCreatedState: true,
        order: 1,
      }),
    ]);

    await renderIncidentsScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(ACTIVE_INCIDENT_LABEL)).toBeTruthy();
    });

    expect(screen.queryByText("Acknowledge")).toBeNull();

    await swipeToAcknowledge(ACTIVE_INCIDENT_LABEL);

    expect(mockChangeIncidentState).not.toHaveBeenCalled();
    expect(mockAlertDialog).not.toHaveBeenCalled();
  });
});

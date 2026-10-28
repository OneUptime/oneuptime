import React from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
  type NavigationState,
  type ParamListBase,
} from "@react-navigation/native";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import InboxStackNavigator from "./InboxStackNavigator";
import { WindowLayoutProvider } from "../layout/WindowLayout";
import type { FoldReport, PostureSource } from "../layout/windowPosture";
import { useAllProjectIncidents } from "../hooks/useAllProjectIncidents";
import { useAllProjectIncidentEpisodes } from "../hooks/useAllProjectIncidentEpisodes";
import { useAllProjectIncidentStates } from "../hooks/useAllProjectIncidentStates";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeIncident,
  makeIncidentState,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";
import type {
  FeedItem,
  IncidentItem,
  IncidentState,
  NoteItem,
  ProjectIncidentItem,
  StateTimelineItem,
} from "../api/types";

/*
 * The whole promise, with the real screens: the Inbox stack, the incident
 * list, the incident detail and its Add Note sheet - only the network is
 * faked. A responder unfolds a Galaxy Z Fold halfway through writing a note
 * on an incident, then folds it again. The incident stays open, the sheet
 * stays up and the note is exactly as far along as it was; the list beside
 * it comes back with the search still typed into it.
 */

const PROJECT_ID: string = "project-1";
const CREATED_STATE: IncidentState = makeIncidentState({
  _id: "state-created",
  name: "Created",
  isCreatedState: true,
  order: 1,
});
const ACKNOWLEDGED_STATE: IncidentState = makeIncidentState({
  _id: "state-acknowledged",
  name: "Acknowledged",
  isCreatedState: false,
  isAcknowledgedState: true,
  order: 2,
});
const RESOLVED_STATE: IncidentState = makeIncidentState({
  _id: "state-resolved",
  name: "Resolved",
  isCreatedState: false,
  isResolvedState: true,
  order: 3,
});
const STATES: Array<IncidentState> = [
  CREATED_STATE,
  ACKNOWLEDGED_STATE,
  RESOLVED_STATE,
];

function incident(id: string, title: string, number: number): IncidentItem {
  return makeIncident({
    _id: id,
    title,
    incidentNumber: number,
    incidentNumberWithPrefix: `INC-${number}`,
    currentIncidentState: makeNamedEntityWithColor({
      _id: CREATED_STATE._id,
      name: CREATED_STATE.name,
    }),
  });
}

const CHECKOUT: IncidentItem = incident("incident-1", "Checkout is down", 7);
const SEARCH: IncidentItem = incident("incident-2", "Search is slow", 8);

const mockIncidentsById: Record<string, IncidentItem> = {
  [CHECKOUT._id]: CHECKOUT,
  [SEARCH._id]: SEARCH,
};

jest.mock("../components/ProjectSwitcher", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

/*
 * Security cases are not what this suite is about: the person holding the
 * foldable cannot see any, so the Inbox keeps its two categories.
 */
jest.mock("../hooks/useSecurityCases", () => {
  return {
    useSecurityCasesAvailability: () => {
      return {
        isAvailable: false,
        isChecking: false,
        isDenied: false,
        projectId: "project-1",
      };
    },
  };
});

jest.mock("../hooks/useAllProjectIncidents", () => {
  return {
    useAllProjectIncidents: (): ReturnType<typeof useAllProjectIncidents> => {
      return {
        items: Object.values(mockIncidentsById).map(
          (item: IncidentItem): ProjectIncidentItem => {
            return { item, projectId: "project-1", projectName: "Acme" };
          },
        ),
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      } as unknown as ReturnType<typeof useAllProjectIncidents>;
    },
  };
});

jest.mock("../hooks/useAllProjectIncidentEpisodes", () => {
  return {
    useAllProjectIncidentEpisodes: (): ReturnType<
      typeof useAllProjectIncidentEpisodes
    > => {
      return {
        items: [],
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      } as unknown as ReturnType<typeof useAllProjectIncidentEpisodes>;
    },
  };
});

jest.mock("../hooks/useAllProjectIncidentStates", () => {
  return {
    useAllProjectIncidentStates: (): ReturnType<
      typeof useAllProjectIncidentStates
    > => {
      return {
        statesMap: new Map([["project-1", mockStates()]]),
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useAllProjectIncidentStates>;
    },
  };
});

function mockStates(): Array<IncidentState> {
  return STATES;
}

function mockQuery<TData>(data: TData): UseQueryResult<TData, Error> {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: async (): Promise<undefined> => {
      return undefined;
    },
  } as unknown as UseQueryResult<TData, Error>;
}

jest.mock("../hooks/useIncidentDetail", () => {
  return {
    useIncidentDetail: (
      _projectId: string,
      incidentId: string,
    ): UseQueryResult<IncidentItem | null, Error> => {
      return mockQuery<IncidentItem | null>(
        mockIncidentsById[incidentId] ?? null,
      );
    },
    useIncidentStates: (): UseQueryResult<Array<IncidentState>, Error> => {
      return mockQuery<Array<IncidentState>>(mockStates());
    },
    useIncidentStateTimeline: (): UseQueryResult<
      Array<StateTimelineItem>,
      Error
    > => {
      return mockQuery<Array<StateTimelineItem>>([]);
    },
    useIncidentFeed: (): UseQueryResult<Array<FeedItem>, Error> => {
      return mockQuery<Array<FeedItem>>([]);
    },
  };
});

jest.mock("../hooks/useIncidentNotes", () => {
  return {
    useIncidentNotes: (): UseQueryResult<Array<NoteItem>, Error> => {
      return mockQuery<Array<NoteItem>>([]);
    },
  };
});

jest.mock("../api/onCallPassOn", () => {
  return {
    fetchOnCallPassOnPages: jest.fn(() => {
      return new Promise<never>(() => {
        // Never answers: nobody is being paged about these incidents.
      });
    }),
    passOnOnCallPages: jest.fn(async () => {
      return [];
    }),
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

const CHECKOUT_LABEL: string =
  "Incident INC-7, Checkout is down. State: Created. Severity: Critical.";

async function renderInbox(
  postureSource?: PostureSource,
): Promise<NavigationContainerRefWithCurrent<ParamListBase>> {
  const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
    createNavigationContainerRef<ParamListBase>();
  const Wrapper: React.ComponentType<{ children: React.ReactNode }> =
    createQueryWrapper(createTestQueryClient());
  const app: React.JSX.Element = (
    <Wrapper>
      <NavigationContainer ref={navigationRef}>
        <InboxStackNavigator />
      </NavigationContainer>
    </Wrapper>
  );
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 24, right: 0, bottom: 16, left: 0 }}
    >
      {postureSource ? (
        <WindowLayoutProvider postureSource={postureSource}>
          {app}
        </WindowLayoutProvider>
      ) : (
        app
      )}
    </SafeAreaInsetsContext.Provider>,
  );
  return navigationRef;
}

function inboxRoutes(
  navigationRef: NavigationContainerRefWithCurrent<ParamListBase>,
): Array<string> {
  const state: NavigationState | undefined = navigationRef.getRootState();
  return (state?.routes ?? []).map(
    (route: NavigationState["routes"][number]): string => {
      return route.name;
    },
  );
}

beforeEach(() => {
  setWindowSize(TEST_WINDOWS.innerScreen);
});

afterEach(() => {
  resetWindowSize();
});

describe("An unfolded foldable shows the inbox and an incident side by side", () => {
  test("the list stays on the left and the incident opens on the right, marked in the list", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderInbox();

    const list: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("list-pane");
    expect(within(list).getByLabelText(CHECKOUT_LABEL)).toBeTruthy();
    expect(screen.getByText("No incident selected")).toBeTruthy();

    await fireEvent.press(within(list).getByLabelText(CHECKOUT_LABEL));

    const detail: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("detail-pane");
    expect(
      within(detail).getByRole("header", { name: "Checkout is down" }),
    ).toBeTruthy();
    expect(within(list).getByLabelText(CHECKOUT_LABEL)).toBeSelected();
    // Rows open beside the list, so they lose their "go forward" chevron.
    expect(within(list).queryAllByTestId("response-row-chevron")).toHaveLength(
      0,
    );
    expect(inboxRoutes(navigationRef)).toEqual(["InboxList", "IncidentDetail"]);
  });
});

describe("Nothing is lost when the phone folds and unfolds", () => {
  test("a half-written note in an open Add Note sheet survives a fold and an unfold", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderInbox();

    await fireEvent.changeText(
      screen.getByLabelText("Search incidents and episodes"),
      "checkout",
    );
    await fireEvent.press(screen.getByLabelText(CHECKOUT_LABEL));
    await fireEvent.press(screen.getByTestId("add-note-button"));
    await fireEvent.changeText(
      screen.getByTestId("add-note-input"),
      "Rolled back to v1.42; error rate falling",
    );

    // Fold: the cover screen is a phone, one pane, a bar at the bottom.
    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(screen.queryByTestId("list-pane")).toBeNull();
    expect(navigationRef.getCurrentRoute()?.name).toBe("IncidentDetail");
    expect(screen.getByTestId("add-note-sheet")).toBeTruthy();
    expect(screen.getByTestId("add-note-input")).toHaveProp(
      "value",
      "Rolled back to v1.42; error rate falling",
    );

    // Unfold again: back beside the list, the note still exactly as it was.
    await resizeWindow(TEST_WINDOWS.innerScreen);

    expect(screen.getByTestId("add-note-sheet")).toBeTruthy();
    expect(screen.getByTestId("add-note-input")).toHaveProp(
      "value",
      "Rolled back to v1.42; error rate falling",
    );
    expect(inboxRoutes(navigationRef)).toEqual(["InboxList", "IncidentDetail"]);
    // And the list came back with what was typed into its search.
    expect(
      within(screen.getByTestId("list-pane")).getByLabelText(
        "Search incidents and episodes",
      ),
    ).toHaveProp("value", "checkout");
    expect(screen.getByLabelText(CHECKOUT_LABEL)).toBeSelected();
    expect(screen.queryByText("Search is slow")).toBeNull();
  });

  test("folding with an incident open keeps it on screen, with Back to the same filtered list", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderInbox();

    await fireEvent.press(screen.getByRole("button", { name: "Active only" }));
    await fireEvent.changeText(
      screen.getByLabelText("Search incidents and episodes"),
      "search",
    );
    await fireEvent.press(
      screen.getByLabelText(
        "Incident INC-8, Search is slow. State: Created. Severity: Critical.",
      ),
    );

    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(navigationRef.getCurrentRoute()?.name).toBe("IncidentDetail");
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      incidentId: SEARCH._id,
      projectId: PROJECT_ID,
    });

    await act(async (): Promise<void> => {
      navigationRef.goBack();
    });

    // The list was drawn afresh on the folded phone, with its search and filter.
    expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
    expect(screen.getByLabelText("Search incidents and episodes")).toHaveProp(
      "value",
      "search",
    );
    expect(screen.getByRole("button", { name: "Active only" })).toBeSelected();
    expect(
      screen.getByRole("button", { name: "All states" }),
    ).not.toBeSelected();
  });

  test("unfolding with an incident open on the phone puts it beside the list", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderInbox();

    await fireEvent.press(screen.getByLabelText(CHECKOUT_LABEL));
    expect(screen.queryByTestId("list-pane")).toBeNull();

    await resizeWindow(TEST_WINDOWS.innerScreen);

    expect(
      within(screen.getByTestId("detail-pane")).getByRole("header", {
        name: "Checkout is down",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("list-pane")).getByLabelText(CHECKOUT_LABEL),
    ).toBeSelected();
    expect(inboxRoutes(navigationRef)).toEqual(["InboxList", "IncidentDetail"]);
  });
});

describe("Half closing the phone on a table loses nothing either", () => {
  /*
   * The posture comes from the platform; a stand-in source reports it here.
   * The inner screen on its side, an incident open beside the inbox and a
   * note half written, is half closed into a tabletop: the incident moves
   * above the fold and the inbox below it, and the note is exactly as far
   * along as it was. Opened flat again, everything is back side by side.
   */
  const SIZE: { width: number; height: number } =
    TEST_WINDOWS.innerScreenOnItsSide;
  const FLAT: FoldReport = {
    windowWidth: SIZE.width,
    windowHeight: SIZE.height,
    folds: [],
  };
  const HALF_CLOSED: FoldReport = {
    windowWidth: SIZE.width,
    windowHeight: SIZE.height,
    folds: [
      {
        x: 0,
        y: SIZE.height / 2,
        width: SIZE.width,
        height: 0,
        orientation: "horizontal",
        separating: true,
      },
    ],
  };

  function postureSource(): PostureSource & {
    emit: (report: FoldReport) => void;
  } {
    let current: FoldReport = FLAT;
    const listeners: Set<(report: FoldReport | null) => void> = new Set();
    return {
      getCurrent: (): FoldReport => {
        return current;
      },
      subscribe: (listener: (report: FoldReport | null) => void) => {
        listeners.add(listener);
        return (): void => {
          listeners.delete(listener);
        };
      },
      emit: (report: FoldReport): void => {
        current = report;
        for (const listener of Array.from(listeners)) {
          listener(report);
        }
      },
    };
  }

  test("a half-written note survives the tabletop and the way back", async () => {
    setWindowSize(SIZE);
    const source: ReturnType<typeof postureSource> = postureSource();
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderInbox(source);

    await fireEvent.press(screen.getByLabelText(CHECKOUT_LABEL));
    await fireEvent.press(screen.getByTestId("add-note-button"));
    await fireEvent.changeText(
      screen.getByTestId("add-note-input"),
      "Rolled back to v1.42; error rate falling",
    );

    await act(async () => {
      source.emit(HALF_CLOSED);
    });

    // The incident above the fold, the inbox below it, the note untouched.
    expect(screen.getByTestId("list-pane")).toHaveStyle({ borderTopWidth: 1 });
    expect(
      within(screen.getByTestId("detail-pane")).getByRole("header", {
        name: "Checkout is down",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("list-pane")).getByLabelText(CHECKOUT_LABEL),
    ).toBeSelected();
    expect(screen.getByTestId("add-note-sheet")).toBeTruthy();
    expect(screen.getByTestId("add-note-input")).toHaveProp(
      "value",
      "Rolled back to v1.42; error rate falling",
    );
    // Half a screen below the fold: the Inbox title gives its height to the list.
    expect(screen.queryByRole("header", { name: "Inbox" })).toBeNull();

    await act(async () => {
      source.emit(FLAT);
    });

    expect(screen.getByTestId("list-pane")).toHaveStyle({
      borderRightWidth: 1,
    });
    expect(screen.getByTestId("add-note-input")).toHaveProp(
      "value",
      "Rolled back to v1.42; error rate falling",
    );
    expect(inboxRoutes(navigationRef)).toEqual(["InboxList", "IncidentDetail"]);
  });

  test("below the fold, another incident from the list replaces the one above", async () => {
    setWindowSize(SIZE);
    const source: ReturnType<typeof postureSource> = postureSource();
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderInbox(source);
    await act(async () => {
      source.emit(HALF_CLOSED);
    });

    await fireEvent.press(
      within(screen.getByTestId("list-pane")).getByLabelText(CHECKOUT_LABEL),
    );

    expect(
      within(screen.getByTestId("detail-pane")).getByRole("header", {
        name: "Checkout is down",
      }),
    ).toBeTruthy();
    expect(inboxRoutes(navigationRef)).toEqual(["InboxList", "IncidentDetail"]);
  });
});

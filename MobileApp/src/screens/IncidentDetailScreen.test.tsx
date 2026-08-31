import React from "react";
import { Alert } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import IncidentDetailScreen from "./IncidentDetailScreen";
import * as incidentsApi from "../api/incidents";
import * as incidentNotesApi from "../api/incidentNotes";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeFeedItem,
  makeIncident,
  makeIncidentState,
  makeNamedEntityWithColor,
  makeNote,
} from "../__tests__/testSupport";
import type {
  FeedItem,
  IncidentItem,
  IncidentState,
  NoteItem,
  StateTimelineItem,
} from "../api/types";

/*
 * The twin of AlertDetailScreen, and the screen a paged responder lands on
 * when the thing burning is an incident rather than an alert. Everything said
 * in AlertDetailScreen.test.tsx applies here, including the reason this suite
 * exists at all:
 *
 * the screen read only `data` and `isLoading` from useIncidentDetail, so an
 * expired token, a 502, a tunnel and an incident that really had been deleted
 * all ended at the same "Incident not found." - a sentence that tells a
 * responder the outage they were woken for is imaginary, with nothing to
 * press. Checkout was still down.
 *
 * The read hooks are faked because what is under test is which of their states
 * this screen turns into which sentence; useIncidentDetail.test.tsx owns how
 * the hooks reach those states. The QueryClient is real, because the
 * optimistic state write and its rollback are cache operations on a
 * hand-written key and faking the cache would leave them asserted against a
 * mock.
 */

const PROJECT_ID: string = "project-1";
const INCIDENT_ID: string = "incident-1";
const INCIDENT_QUERY_KEY: string[] = ["incident", PROJECT_ID, INCIDENT_ID];

type IncidentDetailState = UseQueryResult<IncidentItem | null, Error>;
type IncidentStatesState = UseQueryResult<IncidentState[], Error>;
type IncidentTimelineState = UseQueryResult<StateTimelineItem[], Error>;
type IncidentFeedState = UseQueryResult<FeedItem[], Error>;
type IncidentNotesState = UseQueryResult<NoteItem[], Error>;

const mockIncidentDetail: { current: IncidentDetailState } = {
  current: {} as IncidentDetailState,
};
const mockIncidentStates: { current: IncidentStatesState } = {
  current: {} as IncidentStatesState,
};
const mockIncidentTimeline: { current: IncidentTimelineState } = {
  current: {} as IncidentTimelineState,
};
const mockIncidentFeed: { current: IncidentFeedState } = {
  current: {} as IncidentFeedState,
};
const mockIncidentNotes: { current: IncidentNotesState } = {
  current: {} as IncidentNotesState,
};

jest.mock("../hooks/useIncidentDetail", () => {
  return {
    useIncidentDetail: () => {
      return mockIncidentDetail.current;
    },
    useIncidentStates: () => {
      return mockIncidentStates.current;
    },
    useIncidentStateTimeline: () => {
      return mockIncidentTimeline.current;
    },
    useIncidentFeed: () => {
      return mockIncidentFeed.current;
    },
  };
});

jest.mock("../hooks/useIncidentNotes", () => {
  return {
    useIncidentNotes: () => {
      return mockIncidentNotes.current;
    },
  };
});

jest.mock("../api/incidents", () => {
  return {
    changeIncidentState: jest.fn(),
  };
});

jest.mock("../api/incidentNotes", () => {
  return {
    createIncidentNote: jest.fn(),
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

const changeIncidentStateMock: jest.Mock =
  incidentsApi.changeIncidentState as unknown as jest.Mock;
const createIncidentNoteMock: jest.Mock =
  incidentNotesApi.createIncidentNote as unknown as jest.Mock;

const TRIAGE_STATE: IncidentState = makeIncidentState({
  _id: "incident-state-triage",
  name: "Triage",
  order: 1,
});
const ACKNOWLEDGED_STATE: IncidentState = makeIncidentState({
  _id: "incident-state-acknowledged",
  name: "Acknowledged",
  isCreatedState: false,
  isAcknowledgedState: true,
  order: 2,
});
const RESOLVED_STATE: IncidentState = makeIncidentState({
  _id: "incident-state-resolved",
  name: "Resolved",
  isCreatedState: false,
  isResolvedState: true,
  order: 3,
});

/**
 * A hook result in whatever state a test needs it in.
 *
 * Only the five fields this screen reads are filled in, which is also the
 * point: if the screen ever starts reading a sixth, the tests that drive it
 * through this helper will be the ones to say so.
 */
function queryState<TData>(
  overrides: Partial<UseQueryResult<TData, Error>> = {},
): UseQueryResult<TData, Error> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(async () => {
      return undefined;
    }),
    ...overrides,
  } as unknown as UseQueryResult<TData, Error>;
}

/**
 * An incident in the state a responder is most likely to open one in: live,
 * unacknowledged, with a state whose name cannot be confused with the
 * "Created" and "Declared" labels in the details table.
 */
function makeLoadedIncident(
  overrides: Partial<IncidentItem> = {},
): IncidentItem {
  return makeIncident({
    _id: INCIDENT_ID,
    incidentNumberWithPrefix: "INC-7",
    currentIncidentState: makeNamedEntityWithColor({
      _id: TRIAGE_STATE._id,
      name: TRIAGE_STATE.name,
    }),
    ...overrides,
  });
}

type IncidentDetailProps = React.ComponentProps<typeof IncidentDetailScreen>;

const route: IncidentDetailProps["route"] = {
  key: "IncidentDetail-test",
  name: "IncidentDetail",
  params: { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
} as IncidentDetailProps["route"];

const navigation: IncidentDetailProps["navigation"] =
  {} as IncidentDetailProps["navigation"];

function renderScreen(client: QueryClient): ReturnType<typeof render> {
  return render(
    <IncidentDetailScreen route={route} navigation={navigation} />,
    { wrapper: createQueryWrapper(client) },
  );
}

interface Deferred {
  promise: Promise<void>;
  settle: () => void;
}

/**
 * A request that is still in the air until the test says otherwise.
 *
 * The optimistic write and the disabled button only exist between the press
 * and the response, so a mock that resolves immediately never gives the test a
 * moment in which to look at them.
 */
function deferRequest(): Deferred {
  let settle: () => void = (): void => {
    return undefined;
  };

  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    settle = resolve;
  });

  return { promise, settle };
}

/**
 * A client that keeps what is put into it by hand.
 *
 * createTestQueryClient sets gcTime to 0 so that one test's cache cannot
 * answer the next test's query, and that is right for the hook suites - but an
 * entry with no observer watching it is then collected on the very next tick.
 * The tests below seed the cache the way the real hook would have, press a
 * button, and read the entry back after an await, so for them the entry has to
 * outlive that tick. Nothing else about the client changes.
 */
function createSeedableClient(): QueryClient {
  const client: QueryClient = createTestQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
  });
  return client;
}

describe("While the incident is still on its way", () => {
  beforeEach(() => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      isLoading: true,
    });
    mockIncidentStates.current = queryState<IncidentState[]>();
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>();
    mockIncidentFeed.current = queryState<FeedItem[]>();
    mockIncidentNotes.current = queryState<NoteItem[]>();
  });

  test("the placeholder stands in and the screen makes no claim either way", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByLabelText("Loading content")).toBeTruthy();
    expect(screen.queryByText("Incident not found")).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});

describe("An incident that loaded", () => {
  beforeEach(() => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident(),
    });
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>();
    mockIncidentFeed.current = queryState<FeedItem[]>({ data: [] });
    mockIncidentNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("the number, the title, the state and the severity are all on the header", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("INC-7")).toBeTruthy();
    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.getByText("Triage")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("an incident whose number was never prefixed still shows its number", async () => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        incidentNumberWithPrefix: undefined as unknown as string,
        incidentNumber: 7,
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("#7")).toBeTruthy();
  });

  test("the description and every monitor caught up in it are rendered", async () => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        monitors: [
          { _id: "monitor-1", name: "api.example.com" },
          { _id: "monitor-2", name: "checkout.example.com" },
        ],
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.getByText("Checkout returns 500 for every request."),
    ).toBeTruthy();
    expect(screen.getByText("Monitors")).toBeTruthy();
    expect(
      screen.getByText("api.example.com, checkout.example.com"),
    ).toBeTruthy();
  });

  test("an incident declared by hand renders without a monitor row rather than throwing", async () => {
    /*
     * The type says `monitors` is always an array, the payload disagrees: an
     * incident declared by a human has none, and detaching the last one leaves
     * the field off the response entirely. This screen is what a page opens
     * on, so anything it throws is a blank screen where the outage should be.
     */
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        monitors: undefined as unknown as IncidentItem["monitors"],
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.queryByText("Monitors")).toBeNull();
  });

  test("an incident that was never declared leaves the declared row off", async () => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        declaredAt: undefined as unknown as string,
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.queryByText("Declared")).toBeNull();
    expect(screen.getByText("Created")).toBeTruthy();
  });

  test("an incident nobody has diagnosed says the root cause is missing rather than showing an empty card", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("No root cause documented yet.")).toBeTruthy();
  });

  test("a root cause that was recorded is shown in place of that", async () => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        rootCause: "A bad deploy took the payments service with it.",
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.getByText("A bad deploy took the payments service with it."),
    ).toBeTruthy();
    expect(screen.queryByText("No root cause documented yet.")).toBeNull();
  });
});

describe("When the incident cannot be shown", () => {
  beforeEach(() => {
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>();
    mockIncidentFeed.current = queryState<FeedItem[]>({ data: [] });
    mockIncidentNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("a request that failed offers another go instead of declaring the incident gone", async () => {
    /*
     * The heart of it. "Incident not found." was shown for every failure this
     * screen could suffer, and a responder who reads it stops looking for the
     * outage.
     */
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      isError: true,
      error: new Error("Request failed with status code 502"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Incident not found")).toBeNull();
  });

  test("pressing Retry asks for the incident again", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      isError: true,
      error: new Error("Network request failed"),
      refetch: refetch as unknown as IncidentDetailState["refetch"],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  test("a request that succeeded and found nothing says the incident is gone, and offers nothing to retry", async () => {
    /*
     * `null`, not undefined: that is what `fetchIncidentById` resolves for an
     * incident that has been deleted, and react-query caches it as ordinary
     * settled data. This ending is therefore reached with no error at all, and
     * a Retry here would send the responder round a loop that can never come
     * out differently.
     */
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: null,
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Incident not found")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("an error is a failure whatever it says, including one about undefined data", async () => {
    /*
     * The screen used to read the tail of the error message to decide whether
     * an incident was deleted, because react-query manufactures a "data is
     * undefined" failure when a query function resolves `undefined` - which is
     * how the api layer used to report a missing row. It reports `null` now, so
     * no error can mean "gone" any more, and the message is written out by hand
     * here ON PURPOSE: the assertion is that these words no longer steer the
     * screen anywhere. If message-sniffing ever comes back, this test fails.
     */
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      isError: true,
      error: new Error(
        'Query data cannot be undefined. ["incident"] data is undefined',
      ),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Incident not found")).toBeNull();
  });

  test("a refresh that fails leaves the incident that is already on screen alone", async () => {
    /*
     * Pull-to-refresh in a lift with no signal. What is in hand is stale by
     * seconds and worth far more than an apology page.
     */
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident(),
      isError: true,
      error: new Error("Network request failed"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByText("Incident not found")).toBeNull();
  });
});

describe("The controls a responder is offered", () => {
  beforeEach(() => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident(),
    });
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>();
    mockIncidentFeed.current = queryState<FeedItem[]>({ data: [] });
    mockIncidentNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("a live incident can be acknowledged or resolved", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Resolve incident" }),
    ).toBeTruthy();
  });

  test("an incident that is already acknowledged is only offered Resolve", async () => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        currentIncidentState: makeNamedEntityWithColor({
          _id: ACKNOWLEDGED_STATE._id,
          name: ACKNOWLEDGED_STATE.name,
        }),
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge incident" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Resolve incident" }),
    ).toBeTruthy();
  });

  test("a resolved incident is offered nothing to press", async () => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident({
        currentIncidentState: makeNamedEntityWithColor({
          _id: RESOLVED_STATE._id,
          name: RESOLVED_STATE.name,
        }),
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge incident" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolve incident" }),
    ).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });

  test("a project with no acknowledged state offers only the state it does have", async () => {
    /*
     * Incident states are configured per project, and a project can perfectly
     * well have no acknowledged state at all. Offering an Acknowledge button
     * there would post a state id that does not exist.
     */
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, RESOLVED_STATE],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge incident" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Resolve incident" }),
    ).toBeTruthy();
  });

  test("states that never arrived offer no controls at all, and the incident is still readable", async () => {
    mockIncidentStates.current = queryState<IncidentState[]>({
      isError: true,
      error: new Error("Request failed with status code 500"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Acknowledge incident" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolve incident" }),
    ).toBeNull();
  });
});

describe("Acknowledging and resolving", () => {
  let alertSpy: jest.SpyInstance;
  let incidentFixture: IncidentItem;
  let refetchIncident: jest.Mock;
  let refetchTimeline: jest.Mock;
  let refetchFeed: jest.Mock;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
    incidentFixture = makeLoadedIncident();
    refetchIncident = jest.fn(async () => {
      return undefined;
    });
    refetchTimeline = jest.fn(async () => {
      return undefined;
    });
    refetchFeed = jest.fn(async () => {
      return undefined;
    });

    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: incidentFixture,
      refetch: refetchIncident as unknown as IncidentDetailState["refetch"],
    });
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>({
      refetch: refetchTimeline as unknown as IncidentTimelineState["refetch"],
    });
    mockIncidentFeed.current = queryState<FeedItem[]>({
      data: [],
      refetch: refetchFeed as unknown as IncidentFeedState["refetch"],
    });
    mockIncidentNotes.current = queryState<NoteItem[]>({ data: [] });
    changeIncidentStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("the state that was pressed is the state that is sent", async () => {
    const client: QueryClient = createSeedableClient();
    client.setQueryData(INCIDENT_QUERY_KEY, incidentFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );

    await waitFor(() => {
      expect(changeIncidentStateMock).toHaveBeenCalledWith(
        PROJECT_ID,
        INCIDENT_ID,
        ACKNOWLEDGED_STATE._id,
      );
    });
  });

  test("the new state is in the cache before the request comes back", async () => {
    /*
     * The optimistic write is the reason the chip flips the instant a thumb
     * lands rather than a second later, and it is a hand-written key that
     * nothing type-checks against the hook. If it drifts, the write lands in
     * an entry nobody reads: the responder acknowledges the page and the
     * screen keeps saying Triage, with nothing thrown anywhere.
     */
    const inFlight: Deferred = deferRequest();
    changeIncidentStateMock.mockReturnValue(inFlight.promise);
    const client: QueryClient = createSeedableClient();
    client.setQueryData(INCIDENT_QUERY_KEY, incidentFixture);

    await renderScreen(client);

    /*
     * Not awaited, and that is the point: awaiting the press would wait on the
     * request handler itself, which this test is deliberately holding open.
     */
    fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );

    await waitFor(() => {
      expect(changeIncidentStateMock).toHaveBeenCalled();
    });

    const optimistic: IncidentItem | undefined =
      client.getQueryData<IncidentItem>(INCIDENT_QUERY_KEY);
    expect(optimistic?.currentIncidentState.name).toBe("Acknowledged");
    expect(optimistic?.title).toBe("Checkout is down");

    inFlight.settle();

    await waitFor(() => {
      expect(refetchIncident).toHaveBeenCalled();
    });
  });

  test("a change that lands refreshes everything the change rewrote", async () => {
    const client: QueryClient = createSeedableClient();
    client.setQueryData(INCIDENT_QUERY_KEY, incidentFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve incident" }),
    );

    await waitFor(() => {
      expect(refetchIncident).toHaveBeenCalled();
    });
    expect(refetchTimeline).toHaveBeenCalled();
    expect(refetchFeed).toHaveBeenCalled();
  });

  test("the incidents list is invalidated too, so it cannot go on showing the old state", async () => {
    /*
     * The responder came here from the list and will go straight back to it. A
     * list still showing "Triage" for an incident that was just resolved is
     * how an incident gets worked twice.
     */
    const client: QueryClient = createSeedableClient();
    client.setQueryData(INCIDENT_QUERY_KEY, incidentFixture);
    client.setQueryData(["incidents"], [incidentFixture]);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve incident" }),
    );

    await waitFor(() => {
      expect(client.getQueryState(["incidents"])?.isInvalidated).toBe(true);
    });
  });

  test("a change that fails puts the old state back and says so", async () => {
    /*
     * Without the rollback the screen would keep claiming the incident was
     * acknowledged when the server never heard about it - the worst possible
     * outcome here, because the responder stops watching.
     */
    changeIncidentStateMock.mockRejectedValue(
      new Error("Request failed with status code 500"),
    );
    const client: QueryClient = createSeedableClient();
    client.setQueryData(INCIDENT_QUERY_KEY, incidentFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        "Failed to change state to Acknowledged.",
      );
    });
    expect(client.getQueryData<IncidentItem>(INCIDENT_QUERY_KEY)).toEqual(
      incidentFixture,
    );
  });

  test("a second press while the first change is in flight sends nothing", async () => {
    /*
     * A press that looks like it did nothing gets pressed again. Both writes
     * would post to the state timeline, which is an audit log, so the incident
     * would carry two acknowledgements a second apart from one thumb.
     */
    const inFlight: Deferred = deferRequest();
    changeIncidentStateMock.mockReturnValue(inFlight.promise);
    const client: QueryClient = createSeedableClient();
    client.setQueryData(INCIDENT_QUERY_KEY, incidentFixture);

    await renderScreen(client);

    fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );

    /*
     * Waiting here is what lets the disabled state reach the button; a press
     * that is not blocked would call the api synchronously, so the count below
     * is settled by the time it is read either way.
     */
    await waitFor(() => {
      expect(changeIncidentStateMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );

    expect(changeIncidentStateMock).toHaveBeenCalledTimes(1);

    inFlight.settle();

    await waitFor(() => {
      expect(refetchIncident).toHaveBeenCalled();
    });
  });
});

describe("Adding a note", () => {
  const NOTE_PLACEHOLDER: string = "Write a note...";
  let alertSpy: jest.SpyInstance;
  let refetchNotes: jest.Mock;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
    refetchNotes = jest.fn(async () => {
      return undefined;
    });

    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident(),
    });
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>();
    mockIncidentFeed.current = queryState<FeedItem[]>({ data: [] });
    mockIncidentNotes.current = queryState<NoteItem[]>({
      data: [],
      refetch: refetchNotes as unknown as IncidentNotesState["refetch"],
    });
    createIncidentNoteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("an incident with no notes says so rather than showing an empty space", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  test("the notes that exist are listed with who wrote them", async () => {
    mockIncidentNotes.current = queryState<NoteItem[]>({
      data: [
        makeNote({ note: "Rolled back the payments deploy." }),
        makeNote({
          _id: "note-2",
          note: "Checkout is answering again.",
          createdByUser: { _id: "user-2", name: "Grace Hopper" },
        }),
      ],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Rolled back the payments deploy.")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Checkout is answering again.")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.queryByText("No notes yet.")).toBeNull();
  });

  test("a note that posts is filed, the list is refreshed and the sheet closes", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    await fireEvent.press(screen.getByText("Add Note"));

    await fireEvent.changeText(
      screen.getByPlaceholderText(NOTE_PLACEHOLDER),
      "Rolled back the payments deploy.",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(createIncidentNoteMock).toHaveBeenCalledWith(
        PROJECT_ID,
        INCIDENT_ID,
        "Rolled back the payments deploy.",
      );
    });
    expect(refetchNotes).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(NOTE_PLACEHOLDER)).toBeNull();
    });
  });

  test("a note that fails to post keeps the sheet open with the words still in it", async () => {
    /*
     * A note is often the only written record of what somebody did in the
     * middle of the night, typed with one thumb. Closing the sheet on a failed
     * POST would throw it away with nothing to retry from.
     */
    createIncidentNoteMock.mockRejectedValue(
      new Error("Network request failed"),
    );
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    await fireEvent.press(screen.getByText("Add Note"));
    await fireEvent.changeText(
      screen.getByPlaceholderText(NOTE_PLACEHOLDER),
      "Rolled back the payments deploy.",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Error", "Failed to add note.");
    });
    expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER).props.value).toBe(
      "Rolled back the payments deploy.",
    );
    expect(refetchNotes).not.toHaveBeenCalled();
  });
});

describe("The activity feed", () => {
  beforeEach(() => {
    mockIncidentDetail.current = queryState<IncidentItem | null>({
      data: makeLoadedIncident(),
    });
    mockIncidentStates.current = queryState<IncidentState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockIncidentTimeline.current = queryState<StateTimelineItem[]>();
    mockIncidentNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("what happened to the incident is listed under its own heading", async () => {
    mockIncidentFeed.current = queryState<FeedItem[]>({
      data: [
        makeFeedItem({
          _id: "feed-1",
          feedInfoInMarkdown: "Incident declared by Ada Lovelace",
        }),
        makeFeedItem({
          _id: "feed-2",
          feedInfoInMarkdown: "The payments team was paged",
        }),
      ],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Activity Feed")).toBeTruthy();
    expect(screen.getByText("Incident declared by Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("The payments team was paged")).toBeTruthy();
  });

  test("an incident with nothing in its feed leaves the heading off", async () => {
    mockIncidentFeed.current = queryState<FeedItem[]>({ data: [] });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.queryByText("Activity Feed")).toBeNull();
  });

  test("a feed that failed to load leaves the heading off too, and the incident stays readable", async () => {
    mockIncidentFeed.current = queryState<FeedItem[]>({
      isError: true,
      error: new Error("Request failed with status code 401"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.queryByText("Activity Feed")).toBeNull();
  });
});

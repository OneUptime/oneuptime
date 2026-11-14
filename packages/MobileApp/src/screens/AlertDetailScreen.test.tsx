import React from "react";
import { Alert } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import * as passOnApi from "../api/onCallPassOn";
import type { OnCallPassOnPage } from "../api/onCallPassOn";
import * as observerApi from "../api/onCallObserverPages";
import type { OnCallObserverPage } from "../api/onCallObserverPages";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import AlertDetailScreen from "./AlertDetailScreen";
import { lightColors } from "../theme";
import * as alertsApi from "../api/alerts";
import * as alertNotesApi from "../api/alertNotes";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlert,
  makeAlertState,
  makeFeedItem,
  makeNamedEntityWithColor,
  makeNote,
} from "../__tests__/testSupport";
import type {
  AlertItem,
  AlertState,
  FeedItem,
  NoteItem,
  StateTimelineItem,
} from "../api/types";

/*
 * This is the screen a page lands on. A responder is woken by a push
 * notification, taps it, and this is what they get - so every state it can be
 * in is a state somebody is reading at 3am with a service on fire.
 *
 * The state that mattered most was the one it got wrong. The screen read only
 * `data` and `isLoading` from useAlertDetail, so once loading finished with no
 * data it printed "Alert not found." - an expired token, a 502, a phone with
 * one bar and an alert that really had been deleted were all the same dead
 * end, and none of them offered anything to press. That is why the failure
 * paths below outnumber the happy one.
 *
 * The four read hooks are faked rather than the network, because what is under
 * test here is which of their states this screen turns into which sentence;
 * useAlertDetail.test.tsx owns the question of how the hooks reach those
 * states. The `mock` prefix is what lets jest.mock's hoisted factories reach
 * the holders.
 *
 * The QueryClient underneath, though, is REAL. The optimistic state change is
 * a hand-written cache write on a key nothing type-checks, and its rollback is
 * a second write of whatever was there before - faking the client would leave
 * both of those asserted against a mock rather than against a cache.
 */

const PROJECT_ID: string = "project-1";
const ALERT_ID: string = "alert-1";
const ALERT_QUERY_KEY: string[] = ["alert", PROJECT_ID, ALERT_ID];

type AlertDetailState = UseQueryResult<AlertItem | null, Error>;
type AlertStatesState = UseQueryResult<AlertState[], Error>;
type AlertTimelineState = UseQueryResult<StateTimelineItem[], Error>;
type AlertFeedState = UseQueryResult<FeedItem[], Error>;
type AlertNotesState = UseQueryResult<NoteItem[], Error>;

const mockAlertDetail: { current: AlertDetailState } = {
  current: {} as AlertDetailState,
};
const mockAlertStates: { current: AlertStatesState } = {
  current: {} as AlertStatesState,
};
const mockAlertTimeline: { current: AlertTimelineState } = {
  current: {} as AlertTimelineState,
};
const mockAlertFeed: { current: AlertFeedState } = {
  current: {} as AlertFeedState,
};
const mockAlertNotes: { current: AlertNotesState } = {
  current: {} as AlertNotesState,
};

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 248;
    },
  };
});

jest.mock("../hooks/useAlertDetail", () => {
  return {
    useAlertDetail: () => {
      return mockAlertDetail.current;
    },
    useAlertStates: () => {
      return mockAlertStates.current;
    },
    useAlertStateTimeline: () => {
      return mockAlertTimeline.current;
    },
    useAlertFeed: () => {
      return mockAlertFeed.current;
    },
  };
});

jest.mock("../hooks/useAlertNotes", () => {
  return {
    useAlertNotes: () => {
      return mockAlertNotes.current;
    },
  };
});

jest.mock("../api/alerts", () => {
  return {
    changeAlertState: jest.fn(),
  };
});

jest.mock("../api/alertNotes", () => {
  return {
    createAlertNote: jest.fn(),
  };
});

/*
 * Whether the signed-in person is being paged about it, for Escalate
 * (hooks/usePassOnAction.test.tsx owns how that works). Unless a test says,
 * the answer never comes: the screen renders as it always did, and nothing
 * updates it after a test has looked.
 */
const mockPassOnPages: { current: OnCallPassOnPage[] | null } = {
  current: null,
};

jest.mock("../api/onCallPassOn", () => {
  return {
    fetchOnCallPassOnPages: jest.fn(() => {
      return mockPassOnPages.current
        ? Promise.resolve(mockPassOnPages.current)
        : new Promise<never>(() => {
            // Never answers.
          });
    }),
    passOnOnCallPages: jest.fn(async () => {
      return [];
    }),
    acknowledgeOnCallPagesAgain: jest.fn(async () => {
      return 1;
    }),
  };
});

/*
 * Whether the signed-in person is paged about it as an observer, with a page
 * they can still say they have seen (hooks/useObserverPageAction.test.tsx
 * owns how that works). Unless a test says, they are not: the screen is as
 * it always was. Null is a question the server never answers.
 */
const mockObserverPages: { current: OnCallObserverPage[] | null } = {
  current: [],
};

jest.mock("../api/onCallObserverPages", () => {
  return {
    fetchOnCallObserverPages: jest.fn(() => {
      return mockObserverPages.current
        ? Promise.resolve(mockObserverPages.current)
        : new Promise<never>(() => {
            // Never answers.
          });
    }),
    markOnCallObserverPagesSeen: jest.fn(async () => {
      return 1;
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

const changeAlertStateMock: jest.Mock =
  alertsApi.changeAlertState as unknown as jest.Mock;
const createAlertNoteMock: jest.Mock =
  alertNotesApi.createAlertNote as unknown as jest.Mock;

const TRIAGE_STATE: AlertState = makeAlertState({
  _id: "alert-state-triage",
  name: "Triage",
  order: 1,
});
const ACKNOWLEDGED_STATE: AlertState = makeAlertState({
  _id: "alert-state-acknowledged",
  name: "Acknowledged",
  isCreatedState: false,
  isAcknowledgedState: true,
  order: 2,
});
const RESOLVED_STATE: AlertState = makeAlertState({
  _id: "alert-state-resolved",
  name: "Resolved",
  isCreatedState: false,
  isResolvedState: true,
  order: 3,
});
/*
 * A state the project placed after Resolved, without the resolved flag: by
 * the one resolved rule (utils/resolvedState) a record in it is resolved.
 */
const CLOSED_STATE: AlertState = makeAlertState({
  _id: "alert-state-closed",
  name: "Closed",
  isCreatedState: false,
  order: 4,
});

/**
 * A hook result in whatever state a test needs it in.
 *
 * Only the five fields these screens read are filled in, which is also the
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
 * An alert in the state a responder is most likely to open one in: live,
 * unacknowledged, with a state whose name cannot be confused with the
 * "Created" label in the details table.
 */
function makeLoadedAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return makeAlert({
    _id: ALERT_ID,
    alertNumberWithPrefix: "ALRT-12",
    currentAlertState: makeNamedEntityWithColor({
      _id: TRIAGE_STATE._id,
      name: TRIAGE_STATE.name,
    }),
    ...overrides,
  });
}

type AlertDetailProps = React.ComponentProps<typeof AlertDetailScreen>;

const route: AlertDetailProps["route"] = {
  key: "AlertDetail-test",
  name: "AlertDetail",
  params: { alertId: ALERT_ID, projectId: PROJECT_ID },
} as AlertDetailProps["route"];

const navigation: AlertDetailProps["navigation"] =
  {} as AlertDetailProps["navigation"];

function renderScreen(client: QueryClient): ReturnType<typeof render> {
  return render(<AlertDetailScreen route={route} navigation={navigation} />, {
    wrapper: createQueryWrapper(client),
  });
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

describe("While the alert is still on its way", () => {
  beforeEach(() => {
    mockAlertDetail.current = queryState<AlertItem | null>({ isLoading: true });
    mockAlertStates.current = queryState<AlertState[]>();
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>();
    mockAlertNotes.current = queryState<NoteItem[]>();
  });

  test("the placeholder stands in and the screen makes no claim either way", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByLabelText("Loading content")).toBeTruthy();
    expect(screen.queryByText("Alert not found")).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});

describe("An alert that loaded", () => {
  beforeEach(() => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("the number, the title, the state and the severity are all on the header", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("ALRT-12")).toBeTruthy();
    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(screen.getByText("Triage")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("an alert whose number was never prefixed still shows its number", async () => {
    /*
     * alertNumberWithPrefix is what the server composes from the project's
     * prefix; older rows and projects without one send nothing. The raw number
     * is the only handle a responder has for quoting the alert to a colleague,
     * so it has to survive that.
     */
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        alertNumberWithPrefix: undefined as unknown as string,
        alertNumber: 12,
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("#12")).toBeTruthy();
  });

  test("the description and the monitor that raised it are rendered", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("The primary volume is at 94%.")).toBeTruthy();
    expect(screen.getByText("Monitor")).toBeTruthy();
    expect(screen.getByText("api.example.com")).toBeTruthy();
  });

  test("an alert nobody has diagnosed says the root cause is missing rather than showing an empty card", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("No root cause documented yet.")).toBeTruthy();
  });

  test("a root cause that was recorded is shown in place of that", async () => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        rootCause: "The log rotation job stopped running on 12 August.",
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.getByText("The log rotation job stopped running on 12 August."),
    ).toBeTruthy();
    expect(screen.queryByText("No root cause documented yet.")).toBeNull();
  });

  test("an alert raised by no monitor at all leaves the monitor row off", async () => {
    /*
     * `monitor` is typed as nullable and arrives null for anything raised by
     * the API or by a workflow rather than by a check.
     */
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({ monitor: null }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(screen.queryByText("Monitor")).toBeNull();
  });
});

describe("When the alert cannot be shown", () => {
  beforeEach(() => {
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("a request that failed offers another go instead of declaring the alert gone", async () => {
    /*
     * The heart of it. An expired token, a 502 and a tunnel all arrive here,
     * and "Alert not found." told a responder the page they were woken for
     * does not exist - while it did, and was still burning.
     */
    mockAlertDetail.current = queryState<AlertItem | null>({
      isError: true,
      error: new Error("Request failed with status code 502"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Alert not found")).toBeNull();
  });

  test("pressing Retry asks for the alert again", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    mockAlertDetail.current = queryState<AlertItem | null>({
      isError: true,
      error: new Error("Network request failed"),
      refetch: refetch as unknown as AlertDetailState["refetch"],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  test("a request that succeeded and found nothing says the alert is gone, and offers nothing to retry", async () => {
    /*
     * `null`, not undefined: that is what `fetchAlertById` resolves for an
     * alert that has been deleted, and react-query caches it as ordinary
     * settled data. So this ending is reached with no error at all, and a
     * Retry button here would send the responder round a loop that can never
     * come out differently.
     */
    mockAlertDetail.current = queryState<AlertItem | null>({ data: null });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Alert not found")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("an error is a failure whatever it says, including one about undefined data", async () => {
    /*
     * The screen used to read the tail of the error message to decide whether
     * an alert was deleted, because react-query manufactures a "data is
     * undefined" failure when a query function resolves `undefined` - which is
     * how the api layer used to report a missing row. It reports `null` now, so
     * no error can mean "gone" any more, and the message is written out by hand
     * here ON PURPOSE: the assertion is that these words no longer steer the
     * screen anywhere. If message-sniffing ever comes back, this test is the
     * one that fails.
     */
    mockAlertDetail.current = queryState<AlertItem | null>({
      isError: true,
      error: new Error(
        'Query data cannot be undefined. ["alert"] data is undefined',
      ),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Alert not found")).toBeNull();
  });

  test("a refresh that fails leaves the alert that is already on screen alone", async () => {
    /*
     * Pull-to-refresh in a lift with no signal. The alert in hand is stale by
     * seconds and worth far more than an apology page, so an error with data
     * behind it must not replace what the responder is reading.
     */
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
      isError: true,
      error: new Error("Network request failed"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByText("Alert not found")).toBeNull();
  });
});

describe("The controls a responder is offered", () => {
  beforeEach(() => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("a live alert can be acknowledged or resolved", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.getByRole("button", { name: "Acknowledge alert" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resolve alert" })).toBeTruthy();
  });

  test("an alert that is already acknowledged is only offered Resolve", async () => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: ACKNOWLEDGED_STATE._id,
          name: ACKNOWLEDGED_STATE.name,
        }),
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve alert" })).toBeTruthy();
  });

  test("a resolved alert is offered nothing to press", async () => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: RESOLVED_STATE._id,
          name: RESOLVED_STATE.name,
        }),
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve alert" })).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });

  test("a alert in a state placed after Resolved is offered nothing to press either", async () => {
    /*
     * "Closed" comes after Resolved and does not carry the resolved flag. The
     * alert is resolved all the same, so there is nothing to acknowledge -
     * and no Resolve, which could only move it back up the list.
     */
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE, CLOSED_STATE],
    });
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: CLOSED_STATE._id,
          name: CLOSED_STATE.name,
        }),
      }),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve alert" })).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
    expect(screen.getByText("Response complete")).toBeTruthy();
  });

  test("a project with no acknowledged state offers only the state it does have", async () => {
    /*
     * Alert states are configured per project, and a project can perfectly
     * well have no acknowledged state at all. Offering an Acknowledge button
     * there would post a state id that does not exist.
     */
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, RESOLVED_STATE],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve alert" })).toBeTruthy();
  });

  test("states that never arrived offer no controls at all, and the alert is still readable", async () => {
    mockAlertStates.current = queryState<AlertState[]>({
      isError: true,
      error: new Error("Request failed with status code 500"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve alert" })).toBeNull();
  });
});

describe("Acknowledging and resolving", () => {
  let alertSpy: jest.SpyInstance;
  let alertFixture: AlertItem;
  let refetchAlert: jest.Mock;
  let refetchTimeline: jest.Mock;
  let refetchFeed: jest.Mock;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
    alertFixture = makeLoadedAlert();
    refetchAlert = jest.fn(async () => {
      return undefined;
    });
    refetchTimeline = jest.fn(async () => {
      return undefined;
    });
    refetchFeed = jest.fn(async () => {
      return undefined;
    });

    mockAlertDetail.current = queryState<AlertItem | null>({
      data: alertFixture,
      refetch: refetchAlert as unknown as AlertDetailState["refetch"],
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>({
      refetch: refetchTimeline as unknown as AlertTimelineState["refetch"],
    });
    mockAlertFeed.current = queryState<FeedItem[]>({
      data: [],
      refetch: refetchFeed as unknown as AlertFeedState["refetch"],
    });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
    changeAlertStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("the state that was pressed is the state that is sent", async () => {
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge alert" }),
    );

    await waitFor(() => {
      expect(changeAlertStateMock).toHaveBeenCalledWith(
        PROJECT_ID,
        ALERT_ID,
        ACKNOWLEDGED_STATE._id,
      );
    });
  });

  test("Resolve sends the project's resolved state - the first flagged from the top - whatever order the states arrive in", async () => {
    /*
     * A project may flag a second state resolved further down. Resolve means
     * the first one from the top (utils/resolvedState), so a list that
     * arrives with the lower one first still resolves into Resolved.
     */
    const autoClosedState: AlertState = makeAlertState({
      _id: "alert-state-auto-closed",
      name: "Auto-closed",
      isCreatedState: false,
      isResolvedState: true,
      order: 5,
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [autoClosedState, TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve alert" }),
    );

    await waitFor(() => {
      expect(changeAlertStateMock).toHaveBeenCalledWith(
        PROJECT_ID,
        ALERT_ID,
        RESOLVED_STATE._id,
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
    changeAlertStateMock.mockReturnValue(inFlight.promise);
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);

    await renderScreen(client);

    /*
     * Not awaited, and that is the point: awaiting the press would wait on the
     * request handler itself, which this test is deliberately holding open.
     */
    fireEvent.press(screen.getByRole("button", { name: "Acknowledge alert" }));

    await waitFor(() => {
      expect(changeAlertStateMock).toHaveBeenCalled();
    });

    const optimistic: AlertItem | undefined =
      client.getQueryData<AlertItem>(ALERT_QUERY_KEY);
    expect(optimistic?.currentAlertState.name).toBe("Acknowledged");
    expect(optimistic?.title).toBe("Disk almost full");

    inFlight.settle();

    await waitFor(() => {
      expect(refetchAlert).toHaveBeenCalled();
    });
  });

  test("a change that lands refreshes everything the change rewrote", async () => {
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve alert" }),
    );

    await waitFor(() => {
      expect(refetchAlert).toHaveBeenCalled();
    });
    expect(refetchTimeline).toHaveBeenCalled();
    expect(refetchFeed).toHaveBeenCalled();
  });

  test("the alerts list is invalidated too, so it cannot go on showing the old state", async () => {
    /*
     * The responder came here from the list and will go straight back to it.
     * A list still showing "Triage" for an alert that was just resolved is the
     * kind of thing that gets an alert worked twice.
     */
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);
    client.setQueryData(["alerts"], [alertFixture]);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve alert" }),
    );

    await waitFor(() => {
      expect(client.getQueryState(["alerts"])?.isInvalidated).toBe(true);
    });
  });

  test("a change that fails puts the old state back and says so", async () => {
    /*
     * Without the rollback the screen would keep claiming the alert was
     * acknowledged when the server never heard about it - the worst possible
     * outcome here, because the responder stops watching.
     */
    changeAlertStateMock.mockRejectedValue(
      new Error("Request failed with status code 500"),
    );
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge alert" }),
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        "Failed to change state to Acknowledged.",
      );
    });
    expect(client.getQueryData<AlertItem>(ALERT_QUERY_KEY)).toEqual(
      alertFixture,
    );
  });

  test("a second press while the first change is in flight sends nothing", async () => {
    /*
     * A press that looks like it did nothing gets pressed again. Both writes
     * would post to the state timeline, which is an audit log, so the alert
     * would carry two acknowledgements a second apart from one thumb.
     */
    const inFlight: Deferred = deferRequest();
    changeAlertStateMock.mockReturnValue(inFlight.promise);
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERT_QUERY_KEY, alertFixture);

    await renderScreen(client);

    fireEvent.press(screen.getByRole("button", { name: "Acknowledge alert" }));

    /*
     * Waiting here is what lets the disabled state reach the button; a press
     * that is not blocked would call the api synchronously, so the count below
     * is settled by the time it is read either way.
     */
    await waitFor(() => {
      expect(changeAlertStateMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(screen.getByRole("button", { name: "Acknowledge alert" }));

    expect(changeAlertStateMock).toHaveBeenCalledTimes(1);

    inFlight.settle();

    await waitFor(() => {
      expect(refetchAlert).toHaveBeenCalled();
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

    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({
      data: [],
      refetch: refetchNotes as unknown as AlertNotesState["refetch"],
    });
    createAlertNoteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("an alert with no notes says so rather than showing an empty space", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  test("the notes that exist are listed with who wrote them", async () => {
    mockAlertNotes.current = queryState<NoteItem[]>({
      data: [
        makeNote({ note: "Paged the storage team." }),
        makeNote({
          _id: "note-2",
          note: "Log rotation restarted.",
          createdByUser: { _id: "user-2", name: "Grace Hopper" },
        }),
      ],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Paged the storage team.")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Log rotation restarted.")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.queryByText("No notes yet.")).toBeNull();
  });

  test("a note that posts is filed, the list is refreshed and the sheet closes", async () => {
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    await fireEvent.press(screen.getByText("Add Note"));

    await fireEvent.changeText(
      screen.getByPlaceholderText(NOTE_PLACEHOLDER),
      "Restarted the log rotation job.",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(createAlertNoteMock).toHaveBeenCalledWith(
        PROJECT_ID,
        ALERT_ID,
        "Restarted the log rotation job.",
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
    createAlertNoteMock.mockRejectedValue(new Error("Network request failed"));
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    await fireEvent.press(screen.getByText("Add Note"));
    await fireEvent.changeText(
      screen.getByPlaceholderText(NOTE_PLACEHOLDER),
      "Restarted the log rotation job.",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Error", "Failed to add note.");
    });
    expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER).props.value).toBe(
      "Restarted the log rotation job.",
    );
    expect(refetchNotes).not.toHaveBeenCalled();
  });
});

describe("The activity feed", () => {
  beforeEach(() => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("what happened to the alert is listed under its own heading", async () => {
    mockAlertFeed.current = queryState<FeedItem[]>({
      data: [
        makeFeedItem({
          _id: "feed-1",
          feedInfoInMarkdown: "Alert created by the disk check",
        }),
        makeFeedItem({
          _id: "feed-2",
          feedInfoInMarkdown: "Ada Lovelace was paged",
        }),
      ],
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Activity Feed")).toBeTruthy();
    expect(screen.getByText("Alert created by the disk check")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace was paged")).toBeTruthy();
  });

  test("an alert with nothing in its feed leaves the heading off", async () => {
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.queryByText("Activity Feed")).toBeNull();
  });

  test("a feed that failed to load leaves the heading off too, and the alert stays readable", async () => {
    mockAlertFeed.current = queryState<FeedItem[]>({
      isError: true,
      error: new Error("Request failed with status code 401"),
    });
    const client: QueryClient = createTestQueryClient();

    await renderScreen(client);

    expect(screen.getByText("Disk almost full")).toBeTruthy();
    expect(screen.queryByText("Activity Feed")).toBeNull();
  });
});

describe("Readable response controls and bottom reachability", () => {
  beforeEach(() => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({ description: "Context for the responder" }),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  test("response actions are placed before context so they are immediately discoverable", async () => {
    await renderScreen(createTestQueryClient());
    const contentOrder: string[] = screen
      .getAllByText(/^(Acknowledge|Description)$/)
      .map((element: ReturnType<typeof screen.getByText>) => {
        return String(element.props.children);
      });
    expect(contentOrder).toEqual(["Acknowledge", "Description"]);
    expect(screen.queryByText("Actions")).toBeNull();
    expect(
      screen.getByText(
        "Acknowledge to let your team know you are responding. Resolve once recovery is confirmed.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Acknowledge alert" }),
    ).toBeTruthy();
  });

  test("resolved alerts explain the next step and retain reachable team notes", async () => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: RESOLVED_STATE._id,
          name: RESOLVED_STATE.name,
        }),
      }),
    });
    await renderScreen(createTestQueryClient());
    expect(
      screen.getByText(
        "This alert is resolved. Review the context and team notes below.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resolve alert" })).toBeNull();
    expect(
      screen.getByTestId("detail-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBe(248);
  });
});

describe("Guidance and actions for each alert stage", () => {
  beforeEach(() => {
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  function loadInState(state: AlertState): void {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: state._id,
          name: state.name,
        }),
      }),
    });
  }

  test("an unacknowledged alert asks for a responder, with Acknowledge as the primary action", async () => {
    loadInState(TRIAGE_STATE);
    await renderScreen(createTestQueryClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(within(guidance).getByText("Needs a responder")).toBeTruthy();
    expect(
      within(guidance).getByRole("button", { name: "Acknowledge alert" }),
    ).toHaveStyle({ backgroundColor: lightColors.actionPrimary });
    expect(
      within(guidance).getByRole("button", { name: "Resolve alert" }),
    ).toHaveStyle({ backgroundColor: lightColors.backgroundElevated });
  });

  test("an acknowledged alert is in progress, and Resolve becomes the primary action", async () => {
    loadInState(ACKNOWLEDGED_STATE);
    await renderScreen(createTestQueryClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(within(guidance).getByText("Response in progress")).toBeTruthy();
    expect(
      within(guidance).getByText(
        "A responder has acknowledged this alert. Resolve it once recovery is confirmed.",
      ),
    ).toBeTruthy();
    expect(
      within(guidance).getByRole("button", { name: "Resolve alert" }),
    ).toHaveStyle({ backgroundColor: lightColors.actionPrimary });
    expect(
      within(guidance).queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
  });

  test("a resolved alert says the response is complete and offers no buttons", async () => {
    loadInState(RESOLVED_STATE);
    await renderScreen(createTestQueryClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(within(guidance).getByText("Response complete")).toBeTruthy();
    expect(within(guidance).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByText("Resolved")).toHaveLength(1);
  });

  test("the sections sit in cards under icon headings, in reading order", async () => {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({ description: "The primary volume is at 94%." }),
    });
    mockAlertFeed.current = queryState<FeedItem[]>({
      data: [makeFeedItem({ feedInfoInMarkdown: "Alert created" })],
    });
    await renderScreen(createTestQueryClient());

    const headings: string[] = screen
      .getAllByRole("header")
      .map((heading: ReturnType<typeof screen.getByText>) => {
        return String(heading.props.children);
      });
    expect(headings).toEqual([
      "Disk almost full",
      "Description",
      "Details",
      "Root Cause",
      "Activity Feed",
      "Internal Notes",
    ]);
    expect(screen.getAllByTestId("response-section-card")).toHaveLength(4);
  });
});

describe("Acknowledged by the order of the project's states (utils/acknowledgedState)", () => {
  /*
   * A state the project placed between Acknowledged and Resolved, without
   * the acknowledged flag. An alert in it has been acknowledged - on-call
   * stopped paging when it got there - so Acknowledge, a move back up the
   * list the server refuses, is not offered.
   */
  const INVESTIGATING_STATE: AlertState = makeAlertState({
    _id: "alert-state-investigating",
    name: "Investigating",
    isCreatedState: false,
    order: 3,
  });
  const LATER_RESOLVED_STATE: AlertState = makeAlertState({
    _id: "alert-state-resolved",
    name: "Resolved",
    isCreatedState: false,
    isResolvedState: true,
    order: 4,
  });
  const SECOND_ACKNOWLEDGED_STATE: AlertState = makeAlertState({
    _id: "alert-state-second-acknowledged",
    name: "Escalated",
    isCreatedState: false,
    isAcknowledgedState: true,
    order: 3,
  });

  beforeEach(() => {
    mockAlertStates.current = queryState<AlertState[]>({
      data: [
        TRIAGE_STATE,
        ACKNOWLEDGED_STATE,
        INVESTIGATING_STATE,
        LATER_RESOLVED_STATE,
      ],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
    changeAlertStateMock.mockResolvedValue(undefined);
  });

  function loadInState(state: AlertState): void {
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: state._id,
          name: state.name,
        }),
      }),
    });
  }

  test("an alert in a state after Acknowledged is not offered Acknowledge, only Resolve", async () => {
    loadInState(INVESTIGATING_STATE);
    await renderScreen(createTestQueryClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(
      within(guidance).queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(
      within(guidance).getByRole("button", { name: "Resolve alert" }),
    ).toHaveStyle({ backgroundColor: lightColors.actionPrimary });
    expect(within(guidance).getByText("Response in progress")).toBeTruthy();
    expect(
      within(guidance).getByText(
        "A responder has acknowledged this alert. Resolve it once recovery is confirmed.",
      ),
    ).toBeTruthy();
  });

  test("a second state flagged acknowledged further down counts as acknowledged too", async () => {
    mockAlertStates.current = queryState<AlertState[]>({
      data: [
        TRIAGE_STATE,
        ACKNOWLEDGED_STATE,
        SECOND_ACKNOWLEDGED_STATE,
        LATER_RESOLVED_STATE,
      ],
    });
    loadInState(SECOND_ACKNOWLEDGED_STATE);
    await renderScreen(createTestQueryClient());

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve alert" })).toBeTruthy();
  });

  test("Acknowledge sends the project's acknowledged state - the first flagged from the top - whatever order the states arrive in", async () => {
    mockAlertStates.current = queryState<AlertState[]>({
      data: [
        SECOND_ACKNOWLEDGED_STATE,
        LATER_RESOLVED_STATE,
        TRIAGE_STATE,
        ACKNOWLEDGED_STATE,
      ],
    });
    loadInState(TRIAGE_STATE);
    const client: QueryClient = createSeedableClient();
    client.setQueryData(
      ALERT_QUERY_KEY,
      mockAlertDetail.current.data as AlertItem,
    );

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge alert" }),
    );

    await waitFor(() => {
      expect(changeAlertStateMock).toHaveBeenCalledWith(
        PROJECT_ID,
        ALERT_ID,
        ACKNOWLEDGED_STATE._id,
      );
    });
  });
});

describe("Escalating the page", () => {
  const fetchPassOnMock: jest.Mock =
    passOnApi.fetchOnCallPassOnPages as unknown as jest.Mock;

  const PASS_ON_PAGE: OnCallPassOnPage = {
    executionLogId: "run-1",
    policyName: "Payments",
    sentence:
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
  };

  afterEach(() => {
    mockPassOnPages.current = null;
  });

  test("the person being paged about this alert is offered Escalate", async () => {
    fetchPassOnMock.mockClear();
    mockPassOnPages.current = [PASS_ON_PAGE];

    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });

    await renderScreen(createTestQueryClient());

    expect(
      await screen.findByRole("button", { name: "Escalate this alert" }),
    ).toBeTruthy();
    expect(fetchPassOnMock).toHaveBeenCalledWith(PROJECT_ID, "alert", ALERT_ID);
  });
});
describe("Paged again, and answering a page from its push", () => {
  /*
   * The same rule as an incident's (IncidentDetailScreen.test.tsx holds it
   * in full): a page again gets Acknowledge again first, and a push's
   * Acknowledge or Escalate is done once the alert, its states and the
   * reader's pages are read.
   */
  let alertSpy: jest.SpyInstance;
  let setParams: jest.Mock;
  const acknowledgeAgainMock: jest.Mock =
    passOnApi.acknowledgeOnCallPagesAgain as unknown as jest.Mock;

  const PAGE: OnCallPassOnPage = {
    executionLogId: "run-1",
    policyName: "Payments",
    sentence:
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
  };

  function renderWithPush(pushAction: unknown): ReturnType<typeof render> {
    return render(
      <AlertDetailScreen
        route={
          {
            ...route,
            params: { alertId: ALERT_ID, projectId: PROJECT_ID, pushAction },
          } as AlertDetailProps["route"]
        }
        navigation={{ setParams } as unknown as AlertDetailProps["navigation"]}
      />,
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
  }

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
    setParams = jest.fn();
    acknowledgeAgainMock.mockClear();
    changeAlertStateMock.mockReset();
    changeAlertStateMock.mockResolvedValue(undefined);
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  afterEach(() => {
    alertSpy.mockRestore();
    mockPassOnPages.current = null;
  });

  test("paged again about an acknowledged alert: Acknowledge again, then Resolve, then Escalate", async () => {
    mockPassOnPages.current = [{ ...PAGE, isPageAgain: true }];
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: ACKNOWLEDGED_STATE._id,
          name: ACKNOWLEDGED_STATE.name,
        }),
      }),
    });

    await renderScreen(createTestQueryClient());

    await screen.findByRole("button", { name: "Acknowledge this alert again" });
    expect(
      within(screen.getByTestId("response-actions"))
        .getAllByRole("button")
        .map((button: { props: { accessibilityLabel?: string } }) => {
          return button.props.accessibilityLabel;
        }),
    ).toEqual([
      "Acknowledge this alert again",
      "Resolve alert",
      "Escalate this alert",
    ]);
    expect(
      screen.getByText(
        "This alert is still not resolved. Acknowledge again if you're still on it, or escalate it.",
      ),
    ).toBeTruthy();
  });

  /*
   * Somebody asked for the reader by hand - a page sent from a chat, or a
   * policy started by hand - about an alert somebody else acknowledged
   * (#7596): the same buttons as a page again, but the reader never took
   * it, so they are paged to help, not paged again.
   */
  test("paged to help with an alert somebody else acknowledged: the same buttons, and paged - not paged again", async () => {
    mockPassOnPages.current = [
      { ...PAGE, isPageAgain: true, isAskedFor: true },
    ];
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: ACKNOWLEDGED_STATE._id,
          name: ACKNOWLEDGED_STATE.name,
        }),
      }),
    });

    await renderScreen(createTestQueryClient());

    await screen.findByRole("button", {
      name: "Acknowledge this alert again",
    });
    expect(
      within(screen.getByTestId("response-actions"))
        .getAllByRole("button")
        .map((button: { props: { accessibilityLabel?: string } }) => {
          return button.props.accessibilityLabel;
        }),
    ).toEqual([
      "Acknowledge this alert again",
      "Resolve alert",
      "Escalate this alert",
    ]);
    expect(screen.getByText("You're being paged")).toBeTruthy();
    expect(screen.queryByText("You're being paged again")).toBeNull();
    expect(
      screen.getByText(
        "A responder has acknowledged this alert, and you're being paged to help. Acknowledge again to answer your page, or escalate it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/still on it/)).toBeNull();
  });

  test("the push's Acknowledge acknowledges the alert, once", async () => {
    mockPassOnPages.current = [PAGE];

    await renderWithPush({ kind: "acknowledge", id: "n-1:ACKNOWLEDGE_PAGE" });

    await waitFor(() => {
      return expect(changeAlertStateMock).toHaveBeenCalledWith(
        PROJECT_ID,
        ALERT_ID,
        ACKNOWLEDGED_STATE._id,
      );
    });
    expect(changeAlertStateMock).toHaveBeenCalledTimes(1);
    expect(setParams).toHaveBeenCalledWith({ pushAction: undefined });
  });

  test("the push's Escalate asks first", async () => {
    mockPassOnPages.current = [PAGE];

    await renderWithPush({ kind: "escalate", id: "n-2:ESCALATE_PAGE" });

    await waitFor(() => {
      return expect(alertSpy).toHaveBeenCalledWith(
        "Escalate Alert?",
        `${PAGE.sentence}\n\nYou will not be paged again for this alert.`,
        expect.any(Array),
      );
    });
  });
});

/*
 * Paged about it only as an observer (oncall/observerPage.ts): kept informed
 * while others respond. The screen says FYI (observer), offers "I've seen
 * it" first and filled, and never offers the record's own Acknowledge for
 * the page - which would take it on, stop everybody else's page and make the
 * reader its commander. The push's "I've seen it" marks the page seen, and
 * never changes the record's state. Once seen, the screen is as for anybody.
 */
describe("Paged as an observer", () => {
  let setParams: jest.Mock;
  let observerAlertSpy: jest.SpyInstance;
  const markSeenMock: jest.Mock =
    observerApi.markOnCallObserverPagesSeen as unknown as jest.Mock;
  const fetchObserverMock: jest.Mock =
    observerApi.fetchOnCallObserverPages as unknown as jest.Mock;

  const OBSERVER_PAGE: OnCallObserverPage = {
    executionLogId: "run-observer",
    policyName: "Oversight",
  };

  async function renderObserverScreen(pushAction?: unknown): Promise<void> {
    const props: AlertDetailProps = {
      route: {
        key: "AlertDetail-observer",
        name: "AlertDetail",
        params: {
          alertId: ALERT_ID,
          projectId: PROJECT_ID,
          ...(pushAction ? { pushAction } : {}),
        },
      },
      navigation: { setParams },
    } as unknown as AlertDetailProps;

    await render(<AlertDetailScreen {...props} />, {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });
  }

  function actionLabels(): Array<string> {
    return within(screen.getByTestId("response-actions"))
      .getAllByRole("button")
      .map((button: { props: { accessibilityLabel?: string } }) => {
        return button.props.accessibilityLabel ?? "";
      });
  }

  beforeEach(() => {
    setParams = jest.fn();
    observerAlertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
    markSeenMock.mockClear();
    fetchObserverMock.mockClear();
    changeAlertStateMock.mockReset();
    changeAlertStateMock.mockResolvedValue(undefined);
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert(),
    });
    mockAlertStates.current = queryState<AlertState[]>({
      data: [TRIAGE_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    });
    mockAlertTimeline.current = queryState<StateTimelineItem[]>();
    mockAlertFeed.current = queryState<FeedItem[]>({ data: [] });
    mockAlertNotes.current = queryState<NoteItem[]>({ data: [] });
  });

  afterEach(() => {
    observerAlertSpy.mockRestore();
    mockObserverPages.current = [];
    mockPassOnPages.current = null;
  });

  test("on a alert nobody has taken: FYI (observer), then I've seen it and Resolve - and no Acknowledge or Escalate", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    // The record's open pages for Escalate say this one is an observer's.
    mockPassOnPages.current = [
      {
        executionLogId: "run-observer",
        policyName: "Oversight",
        sentence: "This will page the next level of observers.",
        isObserverPage: true,
      },
    ];

    await renderObserverScreen();

    await screen.findByRole("button", { name: "I've seen this alert" });
    expect(actionLabels()).toEqual(["I've seen this alert", "Resolve alert"]);
    expect(screen.getByText("I've seen it")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Acknowledge alert" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Escalate this alert" }),
    ).toBeNull();
    expect(screen.getByText("FYI (observer)")).toBeTruthy();
    expect(
      screen.getByText(
        "You're paged as an observer: the people responding stay on this alert. Saying you've seen it does not acknowledge the alert.",
      ),
    ).toBeTruthy();
    expect(fetchObserverMock).toHaveBeenCalledWith(
      PROJECT_ID,
      "alert",
      ALERT_ID,
    );
  });

  test("on a alert the responders acknowledged - the usual case - FYI (observer), then I've seen it and Resolve", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    mockPassOnPages.current = [];
    mockAlertDetail.current = queryState<AlertItem | null>({
      data: makeLoadedAlert({
        currentAlertState: makeNamedEntityWithColor({
          _id: ACKNOWLEDGED_STATE._id,
          name: ACKNOWLEDGED_STATE.name,
        }),
      }),
    });

    await renderObserverScreen();

    await screen.findByRole("button", { name: "I've seen this alert" });
    expect(actionLabels()).toEqual(["I've seen this alert", "Resolve alert"]);
    expect(screen.getByText("FYI (observer)")).toBeTruthy();
  });

  test("I've seen it marks the page seen - no state change - and then the screen is as for anybody", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    mockPassOnPages.current = [];

    await renderObserverScreen();

    const seen: unknown = await screen.findByRole("button", {
      name: "I've seen this alert",
    });
    mockObserverPages.current = [];
    await fireEvent.press(seen as Parameters<typeof fireEvent.press>[0]);

    expect(markSeenMock).toHaveBeenCalledWith(PROJECT_ID, "alert", ALERT_ID);
    expect(changeAlertStateMock).not.toHaveBeenCalled();
    await waitFor(() => {
      return expect(
        screen.queryByRole("button", { name: "I've seen this alert" }),
      ).toBeNull();
    });
    expect(screen.queryByText("FYI (observer)")).toBeNull();
    // Stepping in is theirs to choose now, as it is anybody's.
    expect(actionLabels()).toEqual(["Acknowledge alert", "Resolve alert"]);
  });

  test("the push's I've seen it marks the page seen once everything is read, and leaves the params - never acknowledging the alert", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    mockPassOnPages.current = [];

    await renderObserverScreen({ kind: "seen", id: "n-1:MARK_PAGE_SEEN" });

    await waitFor(() => {
      return expect(markSeenMock).toHaveBeenCalledWith(
        PROJECT_ID,
        "alert",
        ALERT_ID,
      );
    });
    expect(markSeenMock).toHaveBeenCalledTimes(1);
    expect(changeAlertStateMock).not.toHaveBeenCalled();
    expect(passOnApi.acknowledgeOnCallPagesAgain).not.toHaveBeenCalled();
    expect(setParams).toHaveBeenCalledWith({ pushAction: undefined });
    expect(observerAlertSpy).not.toHaveBeenCalled();
  });

  test("the push's I've seen it waits for the reader's observer pages before it decides", async () => {
    mockObserverPages.current = null;
    mockPassOnPages.current = [];

    await renderObserverScreen({ kind: "seen", id: "n-2:MARK_PAGE_SEEN" });

    await waitFor(() => {
      return expect(fetchObserverMock).toHaveBeenCalled();
    });
    expect(markSeenMock).not.toHaveBeenCalled();
    expect(setParams).not.toHaveBeenCalled();
  });

  test("the push's I've seen it on a page somebody already answered says so, and marks nothing", async () => {
    mockObserverPages.current = [];
    mockPassOnPages.current = [];

    await renderObserverScreen({ kind: "seen", id: "n-3:MARK_PAGE_SEEN" });

    await waitFor(() => {
      return expect(observerAlertSpy).toHaveBeenCalledWith(
        "Already marked as seen",
        "This page has already been marked as seen.",
      );
    });
    expect(markSeenMock).not.toHaveBeenCalled();
    expect(changeAlertStateMock).not.toHaveBeenCalled();
  });
});

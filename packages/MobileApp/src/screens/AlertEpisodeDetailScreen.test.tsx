import React from "react";
import { Alert } from "react-native";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import * as passOnApi from "../api/onCallPassOn";
import type { OnCallPassOnPage } from "../api/onCallPassOn";
import * as observerApi from "../api/onCallObserverPages";
import type { OnCallObserverPage } from "../api/onCallObserverPages";
import { QueryClient } from "@tanstack/react-query";
import AlertEpisodeDetailScreen from "./AlertEpisodeDetailScreen";
import {
  changeAlertEpisodeState,
  createAlertEpisodeNote,
} from "../api/alertEpisodes";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlertEpisode,
  makeAlertState,
  makeFeedItem,
  makeNamedEntityWithColor,
  makeNote,
} from "../__tests__/testSupport";
import type {
  AlertEpisodeItem,
  AlertState,
  FeedItem,
  NoteItem,
} from "../api/types";

/*
 * An alert episode is a bundle of alerts that fired for the same reason, and
 * this screen is where a responder disposes of the whole bundle in one press.
 * That makes it the screen with the widest blast radius in the app: one tap
 * moves every alert inside the episode, so the two things it owes are that the
 * press lands everywhere it claims to, and that a responder can tell which of
 * the two buttons they are about to press.
 *
 * Three things are pinned here that used to be wrong:
 *
 *   - resolving the episode marked only the episode list stale, so the Alerts
 *     tab the responder returned to still showed every member alert open;
 *   - every failure - a 502, an expired session, a dead connection - rendered
 *     "Episode not found.", a sentence that reads as "somebody already dealt
 *     with this" and offered nothing to press;
 *   - the Acknowledge and Resolve controls had no accessible name at all, and
 *     lost even their visible text the moment a change went in flight.
 *
 * The hooks are stand-ins whose state each test sets directly: what is under
 * test is what this screen does with a given hook state, and
 * useAlertEpisodeDetail.test.tsx already owns how the hooks reach one. The
 * query client, though, is REAL - the invalidation this file cares most about
 * is a fact about the cache, and reading it back out of the cache is the only
 * way to assert it without pointing a mock at itself. The `mock` prefix is
 * what lets jest.mock's hoisted factories reach the holders.
 *
 * One tooling note, learned the hard way: fireEvent in
 * @testing-library/react-native 14 is ASYNC. An un-awaited `fireEvent.press`
 * returns before React has flushed the state it caused, so the press appears
 * to do nothing at all and the assertion after it fails against the screen as
 * it was BEFORE the press. Every fireEvent here is awaited except the ones
 * routed through `pressAndLeaveInFlight` below, which have the opposite
 * problem.
 */

const PROJECT_ID: string = "project-1";
const EPISODE_ID: string = "alert-episode-1";
const EPISODE_QUERY_KEY: string[] = ["alert-episode", PROJECT_ID, EPISODE_ID];
const ALERTS_LIST_KEY: string[] = ["alerts", "all-projects"];
const EPISODES_LIST_KEY: string[] = ["alert-episodes", "all-projects"];

interface EpisodeQueryState {
  data: AlertEpisodeItem | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: jest.Mock;
}

const mockEpisodeQuery: { current: EpisodeQueryState } = {
  current: {} as EpisodeQueryState,
};

const mockStates: { current: AlertState[] | undefined } = {
  current: undefined,
};
const mockFeed: { current: FeedItem[] | undefined } = { current: undefined };
const mockNotes: { current: NoteItem[] | undefined } = { current: undefined };
const mockRefetchTimeline: { current: jest.Mock } = { current: jest.fn() };
const mockRefetchFeed: { current: jest.Mock } = { current: jest.fn() };
const mockRefetchNotes: { current: jest.Mock } = { current: jest.fn() };

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 248;
    },
  };
});

jest.mock("../hooks/useAlertEpisodeDetail", () => {
  return {
    useAlertEpisodeDetail: () => {
      return mockEpisodeQuery.current;
    },
    useAlertEpisodeStates: () => {
      return { data: mockStates.current };
    },
    useAlertEpisodeStateTimeline: () => {
      return { refetch: mockRefetchTimeline.current };
    },
    useAlertEpisodeFeed: () => {
      return { data: mockFeed.current, refetch: mockRefetchFeed.current };
    },
    useAlertEpisodeNotes: () => {
      return { data: mockNotes.current, refetch: mockRefetchNotes.current };
    },
  };
});

jest.mock("../api/alertEpisodes", () => {
  return {
    changeAlertEpisodeState: jest.fn(),
    createAlertEpisodeNote: jest.fn(),
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

const mockChangeState: jest.Mock =
  changeAlertEpisodeState as unknown as jest.Mock;
const mockCreateNote: jest.Mock =
  createAlertEpisodeNote as unknown as jest.Mock;

const acknowledgedState: AlertState = makeAlertState({
  _id: "alert-state-ack",
  name: "Acknowledged",
  isAcknowledgedState: true,
  isCreatedState: false,
  order: 2,
});

const resolvedState: AlertState = makeAlertState({
  _id: "alert-state-resolved",
  name: "Resolved",
  isResolvedState: true,
  isCreatedState: false,
  order: 3,
});

/*
 * A state the project placed after Resolved, without the resolved flag: by
 * the one resolved rule (utils/resolvedState) a record in it is resolved.
 */
const closedState: AlertState = makeAlertState({
  _id: "alert-state-closed",
  name: "Closed",
  isCreatedState: false,
  order: 4,
});

const createdState: AlertState = makeAlertState();

/*
 * The shared client garbage-collects a query the instant it has no observers,
 * which is exactly right for isolation and exactly wrong for the one thing
 * this suite most needs to see. Nothing here subscribes to the alert list, so
 * a row seeded with setQueryData would be swept out of the cache before the
 * screen ever got the chance to invalidate it, and the assertion would fail
 * for a reason that has nothing to do with the app.
 *
 * Giving the seeded entries a lifetime lets the test read the fact it cares
 * about straight back out of the cache - the list was marked stale - instead
 * of inferring it from a spy on the client's own method.
 */
/*
 * Every client this suite hands out, so afterEach can empty it.
 *
 * The gcTime below is what makes the seeding above work, and it is also a
 * timer: react-query arms a 60 second collection timeout per cached entry, and
 * an armed timer keeps the jest worker's event loop alive long after the test
 * that created it has passed. A whole directory of suites run together then
 * ends in "A worker process has failed to exit gracefully" - a warning that
 * costs a minute of CI on every run and, worse, trains everyone reading the
 * output to ignore it. clear() destroys the entries and cancels their timers.
 */
const seedableClients: Array<QueryClient> = [];

function createSeedableClient(): QueryClient {
  const client: QueryClient = createTestQueryClient();

  client.setDefaultOptions({
    queries: {
      retry: false,
      gcTime: 60000,
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });

  seedableClients.push(client);

  return client;
}

/*
 * A press whose handler is deliberately left hanging.
 *
 * fireEvent awaits whatever the handler RETURNS, and `onPress` on these
 * controls returns `handleStateChange(...)` - the very promise the in-flight
 * tests hold open on purpose. Awaiting such a press means waiting for the
 * request the test is refusing to answer, and the test sits there until jest
 * kills it.
 *
 * The dispatch itself is synchronous, so firing it and then watching the
 * render through waitFor sees everything an awaited press would have seen,
 * without the deadlock.
 */
function pressAndLeaveInFlight(element: unknown): void {
  fireEvent.press(element as never);
}

type ScreenProps = React.ComponentProps<typeof AlertEpisodeDetailScreen>;

async function renderScreen(client: QueryClient): Promise<void> {
  const props: ScreenProps = {
    route: {
      key: "AlertEpisodeDetail-1",
      name: "AlertEpisodeDetail",
      params: { episodeId: EPISODE_ID, projectId: PROJECT_ID },
    },
  } as unknown as ScreenProps;

  await render(<AlertEpisodeDetailScreen {...props} />, {
    wrapper: createQueryWrapper(client),
  });
}

function episodeStateWith(
  overrides: Partial<EpisodeQueryState> = {},
): EpisodeQueryState {
  return {
    data: makeAlertEpisode(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockEpisodeQuery.current = episodeStateWith();
  mockStates.current = [createdState, acknowledgedState, resolvedState];
  mockFeed.current = [];
  mockNotes.current = [];
  mockRefetchTimeline.current = jest.fn();
  mockRefetchFeed.current = jest.fn();
  mockRefetchNotes.current = jest.fn();
  mockChangeState.mockResolvedValue(undefined);
  mockCreateNote.mockResolvedValue(undefined);
  jest.spyOn(Alert, "alert").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();

  /* See createSeedableClient: an uncollected entry is an armed timer. */
  while (seedableClients.length > 0) {
    seedableClients.pop()?.clear();
  }
});

describe("While the episode is still loading", () => {
  test("nothing on screen claims the episode is missing or broken", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: undefined,
      isLoading: true,
    });

    await renderScreen(createSeedableClient());

    expect(screen.queryByText("Episode not found")).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});

describe("When the episode could not be fetched", () => {
  beforeEach(() => {
    mockEpisodeQuery.current = episodeStateWith({
      data: undefined,
      isError: true,
      error: new Error("Request failed with status code 502"),
    });
  });

  test("a failed request is not reported as a missing episode", async () => {
    /*
     * This is the whole point of the branch. "Episode not found." tells a
     * responder that somebody else has already dealt with the page they were
     * just woken by, and there was nothing on the screen to contradict it.
     */
    await renderScreen(createSeedableClient());

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("Episode not found")).toBeNull();
  });

  test("the responder is told the difference in words, not just in tone", async () => {
    await renderScreen(createSeedableClient());

    expect(
      screen.getByText(/not the same as it no longer existing/i),
    ).toBeTruthy();
  });

  test("there is a way to ask again", async () => {
    const refetch: jest.Mock = jest.fn();
    mockEpisodeQuery.current = episodeStateWith({
      data: undefined,
      isError: true,
      error: new Error("Network Error"),
      refetch,
    });

    await renderScreen(createSeedableClient());

    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  test("an episode already on screen survives a failed refresh", async () => {
    /*
     * react-query hands back the last good payload alongside the error when a
     * background refetch fails. Replacing a readable episode with an error
     * page in that case would take work away from a responder who is mid
     * response, so the error screen is reserved for a failure that left
     * nothing behind.
     */
    mockEpisodeQuery.current = episodeStateWith({
      isError: true,
      error: new Error("Network Error"),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("Repeated disk pressure")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});

describe("When the episode genuinely no longer exists", () => {
  test("it says so, and does not offer a retry that can never work", async () => {
    /*
     * A deleted episode reaches this screen as settled DATA that happens to be
     * `null` - `fetchAlertEpisodeById` resolves null rather than undefined
     * precisely so that react-query caches the miss instead of rejecting the
     * query. There is no error here to misread, and a Retry would leave the
     * responder pressing at a row that is never coming back.
     */
    mockEpisodeQuery.current = episodeStateWith({ data: null });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("Episode not found")).toBeTruthy();
    expect(
      screen.getByText(
        "This alert episode no longer exists, or it is not part of this project.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("an error is a failure whatever it says, including one about undefined data", async () => {
    /*
     * The screen used to separate "deleted" from "broken" by matching the tail
     * of react-query's manufactured "data is undefined" message, which is what
     * an api layer resolving `undefined` produced. It resolves `null` now, so
     * an error can only mean the request failed - and the message is written
     * out by hand here ON PURPOSE, because the assertion is that these
     * particular words no longer steer the screen anywhere.
     */
    mockEpisodeQuery.current = episodeStateWith({
      data: undefined,
      isError: true,
      error: new Error(
        'Query data cannot be undefined. ["alert-episode"] data is undefined',
      ),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Episode not found")).toBeNull();
  });
});

describe("When the episode loads", () => {
  test("the episode number, title, state and severity are on screen", async () => {
    /*
     * The state carries a name of its own here rather than the fixture's
     * default, because "Created" is also the label on the Details row that
     * holds the creation timestamp - so the default would have this assertion
     * matching a static label instead of the episode's actual state.
     */
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: makeNamedEntityWithColor({ name: "Investigating" }),
      }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("Repeated disk pressure")).toBeTruthy();
    expect(screen.getByText("Investigating")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("an episode with no prefixed number still shows its number", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        episodeNumber: 41,
        episodeNumberWithPrefix: undefined,
      }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("#41")).toBeTruthy();
  });

  test("the number of alerts bundled into the episode is on screen", async () => {
    /*
     * The member count is what tells a responder whether they are about to
     * dispose of one alert or forty, and it is the only thing on this screen
     * that distinguishes an episode from a plain alert.
     */
    await renderScreen(createSeedableClient());

    expect(screen.getByText("Alerts")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  test("an episode whose count never arrived reads as zero rather than blank", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({ alertCount: undefined }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("0")).toBeTruthy();
  });

  test("an episode with no root cause says so instead of leaving a hole", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({ rootCause: "   " }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("No root cause documented yet.")).toBeTruthy();
  });

  test("a root cause that exists is shown instead of the placeholder", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({ rootCause: "The log volume filled up." }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByText("The log volume filled up.")).toBeTruthy();
    expect(screen.queryByText("No root cause documented yet.")).toBeNull();
  });

  test("an episode with no description does not render an empty section", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({ description: "" }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.queryByText("Description")).toBeNull();
  });

  test("an empty activity feed does not render a heading over nothing", async () => {
    mockFeed.current = [];

    await renderScreen(createSeedableClient());

    expect(screen.queryByText("Activity Feed")).toBeNull();
  });

  test("an activity feed with entries is shown", async () => {
    mockFeed.current = [makeFeedItem()];

    await renderScreen(createSeedableClient());

    expect(screen.getByText("Activity Feed")).toBeTruthy();
  });

  test("an episode with no notes says so", async () => {
    mockNotes.current = [];

    await renderScreen(createSeedableClient());

    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  test("notes that exist are shown with their author", async () => {
    mockNotes.current = [makeNote()];

    await renderScreen(createSeedableClient());

    expect(screen.getByText("Paged the database team.")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });
});

describe("The state-change controls", () => {
  test("both controls announce what they do", async () => {
    /*
     * Without an accessibility label these were two unnamed shapes, announced
     * only by whatever text happened to be inside them - on the one screen in
     * the app where pressing the wrong one has consequences.
     */
    await renderScreen(createSeedableClient());

    expect(
      screen.getByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    ).toBeTruthy();
  });

  test("an acknowledged episode is no longer offered acknowledgement", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: {
          _id: acknowledgedState._id,
          name: acknowledgedState.name,
          color: acknowledgedState.color,
        },
      }),
    });

    await renderScreen(createSeedableClient());

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    ).toBeTruthy();
  });

  test("a resolved episode offers neither control", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: {
          _id: resolvedState._id,
          name: resolvedState.name,
          color: resolvedState.color,
        },
      }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.queryByText("Actions")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolve alert episode" }),
    ).toBeNull();
  });

  test("an episode in a state placed after Resolved offers neither control either", async () => {
    /*
     * "Closed" comes after Resolved and does not carry the resolved flag. The
     * episode is resolved all the same: nothing to acknowledge, and no
     * Resolve to move it back up the list.
     */
    mockStates.current = [
      createdState,
      acknowledgedState,
      resolvedState,
      closedState,
    ];
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: {
          _id: closedState._id,
          name: closedState.name,
          color: closedState.color,
        },
      }),
    });

    await renderScreen(createSeedableClient());

    expect(screen.queryByText("Actions")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolve alert episode" }),
    ).toBeNull();
    expect(screen.getByText("Response complete")).toBeTruthy();
  });

  test("acknowledging sends the acknowledged state for this episode", async () => {
    await renderScreen(createSeedableClient());

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge alert episode" }),
    );

    await waitFor(() => {
      expect(mockChangeState).toHaveBeenCalledWith(
        PROJECT_ID,
        EPISODE_ID,
        acknowledgedState._id,
      );
    });
  });

  test("resolving marks the ALERT list stale as well as the episode list", async () => {
    /*
     * The regression this file exists for. Resolving an episode resolves every
     * alert inside it server-side, so a cache that only drops the episode list
     * sends the responder back to an Alerts tab where the members they just
     * resolved are still sitting there open - which is either work somebody
     * repeats, or a reason to doubt that the resolve landed at all.
     */
    const client: QueryClient = createSeedableClient();
    client.setQueryData(ALERTS_LIST_KEY, { data: [] });
    client.setQueryData(EPISODES_LIST_KEY, { data: [] });

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    );

    await waitFor(() => {
      expect(client.getQueryState(EPISODES_LIST_KEY)?.isInvalidated).toBe(true);
    });

    expect(client.getQueryState(ALERTS_LIST_KEY)?.isInvalidated).toBe(true);
  });

  test("the episode reads as resolved before the server has answered", async () => {
    const client: QueryClient = createSeedableClient();
    const episode: AlertEpisodeItem = makeAlertEpisode();
    client.setQueryData(EPISODE_QUERY_KEY, episode);
    mockEpisodeQuery.current = episodeStateWith({ data: episode });

    let releaseStateChange: (() => void) | undefined;
    mockChangeState.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void): void => {
        releaseStateChange = resolve;
      });
    });

    await renderScreen(client);

    pressAndLeaveInFlight(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    );

    await waitFor(() => {
      const optimistic: AlertEpisodeItem | undefined =
        client.getQueryData(EPISODE_QUERY_KEY);
      expect(optimistic?.currentAlertState?.name).toBe("Resolved");
    });

    releaseStateChange?.();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Resolve alert episode" }),
      ).toBeTruthy();
    });
  });

  test("the controls keep an accessible name while the change is in flight", async () => {
    /*
     * In flight the button's children are replaced by a bare ActivityIndicator,
     * so a label derived from its text disappears exactly when the responder
     * most needs to know what is happening.
     */
    let releaseStateChange: (() => void) | undefined;
    mockChangeState.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void): void => {
        releaseStateChange = resolve;
      });
    });

    await renderScreen(createSeedableClient());

    pressAndLeaveInFlight(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Resolve alert episode, state change in progress",
        }),
      ).toBeTruthy();
    });

    expect(
      screen.getByRole("button", {
        name: "Acknowledge alert episode, state change in progress",
      }),
    ).toBeTruthy();

    releaseStateChange?.();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Resolve alert episode" }),
      ).toBeTruthy();
    });
  });

  test("pressing again while a change is in flight does not send it twice", async () => {
    let releaseStateChange: (() => void) | undefined;
    mockChangeState.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void): void => {
        releaseStateChange = resolve;
      });
    });

    await renderScreen(createSeedableClient());

    pressAndLeaveInFlight(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    );

    const inFlight: unknown = await waitFor(() => {
      return screen.getByRole("button", {
        name: "Resolve alert episode, state change in progress",
      });
    });

    pressAndLeaveInFlight(inFlight);

    expect(mockChangeState).toHaveBeenCalledTimes(1);

    releaseStateChange?.();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Resolve alert episode" }),
      ).toBeTruthy();
    });
  });

  test("a failed change is undone, named and admitted to the responder", async () => {
    const client: QueryClient = createSeedableClient();
    const episode: AlertEpisodeItem = makeAlertEpisode();
    client.setQueryData(EPISODE_QUERY_KEY, episode);
    client.setQueryData(ALERTS_LIST_KEY, { data: [] });
    mockEpisodeQuery.current = episodeStateWith({ data: episode });
    mockChangeState.mockRejectedValue(new Error("Request failed"));

    await renderScreen(client);

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    );

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        "Failed to change state to Resolved.",
      );
    });

    const rolledBack: AlertEpisodeItem | undefined =
      client.getQueryData(EPISODE_QUERY_KEY);
    expect(rolledBack?.currentAlertState?.name).toBe("Created");

    /*
     * Nothing moved server-side, so nothing downstream is stale. Dropping the
     * alert list here would send every open list off to refetch on the
     * strength of a request that failed.
     */
    expect(client.getQueryState(ALERTS_LIST_KEY)?.isInvalidated).toBe(false);
  });

  test("the controls come back after a failure so the change can be retried", async () => {
    mockChangeState.mockRejectedValue(new Error("Request failed"));

    await renderScreen(createSeedableClient());

    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    );

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
    });

    expect(
      screen.getByRole("button", { name: "Resolve alert episode" }),
    ).toBeTruthy();
  });

  test("no state can be changed while the episode's states are unknown", async () => {
    /*
     * The states list is a separate request. Until it lands there is no way to
     * know which id means "resolved", so offering a button would mean guessing
     * at what to send.
     */
    mockStates.current = undefined;

    await renderScreen(createSeedableClient());

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolve alert episode" }),
    ).toBeNull();
  });
});

describe("Adding a note", () => {
  test("a submitted note is filed against the episode and the list refreshed", async () => {
    await renderScreen(createSeedableClient());

    await fireEvent.press(screen.getByText("Add Note"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("Write a note..."),
      "Paged the storage team.",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalledWith(
        PROJECT_ID,
        EPISODE_ID,
        "Paged the storage team.",
      );
    });

    expect(mockRefetchNotes.current).toHaveBeenCalled();
  });

  test("a note that failed to file leaves the responder something to retry", async () => {
    /*
     * The note is often the only written record of what somebody did to the
     * incident, so a failure has to keep the modal - and the typed draft -
     * where they are.
     */
    mockCreateNote.mockRejectedValue(new Error("Request failed"));

    await renderScreen(createSeedableClient());

    await fireEvent.press(screen.getByText("Add Note"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("Write a note..."),
      "Rebooted the node.",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith("Error", "Failed to add note.");
    });

    expect(screen.getByDisplayValue("Rebooted the node.")).toBeTruthy();
  });
});

describe("Episode response guidance", () => {
  test("the responder sees the scope of an episode action before pressing it", async () => {
    await renderScreen(createSeedableClient());
    expect(
      screen.getByText(
        "Actions on this episode apply to its grouped alerts. Acknowledge to take responsibility, or resolve when recovery is confirmed.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeTruthy();
    expect(
      screen.getByTestId("detail-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBe(248);
  });
});

describe("Episode guidance for each response stage", () => {
  test("an open episode asks for a responder and explains the grouped scope", async () => {
    await renderScreen(createSeedableClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(within(guidance).getByText("Needs a responder")).toBeTruthy();
    expect(
      within(guidance).getByText(/apply to its grouped alerts/),
    ).toBeTruthy();
    expect(
      within(guidance).getByRole("button", {
        name: "Acknowledge alert episode",
      }),
    ).toBeTruthy();
    expect(
      within(guidance).getByRole("button", { name: "Resolve alert episode" }),
    ).toBeTruthy();
  });

  test("an acknowledged episode is in progress and only offers Resolve", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: {
          _id: acknowledgedState._id,
          name: acknowledgedState.name,
          color: acknowledgedState.color,
        },
      }),
    });

    await renderScreen(createSeedableClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(within(guidance).getByText("Response in progress")).toBeTruthy();
    expect(
      within(guidance).getByText(
        "A responder has acknowledged this alert episode. Resolve it once recovery is confirmed.",
      ),
    ).toBeTruthy();
    expect(within(guidance).getAllByRole("button")).toHaveLength(1);
  });

  test("a resolved episode says the response is complete, with nothing to press", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: {
          _id: resolvedState._id,
          name: resolvedState.name,
          color: resolvedState.color,
        },
      }),
    });

    await renderScreen(createSeedableClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(within(guidance).getByText("Response complete")).toBeTruthy();
    expect(
      within(guidance).getByText(
        "This alert episode is resolved. Review the context and team notes below.",
      ),
    ).toBeTruthy();
    expect(within(guidance).queryAllByRole("button")).toHaveLength(0);
  });

  test("loading shows the detail skeleton rather than a bare spinner", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: undefined,
      isLoading: true,
    });

    await renderScreen(createSeedableClient());

    expect(screen.getByTestId("response-detail-skeleton")).toBeTruthy();
    expect(screen.getByLabelText("Loading content")).toBeTruthy();
  });

  test("a failed load uses the error illustration and keeps Retry", async () => {
    mockEpisodeQuery.current = episodeStateWith({
      data: undefined,
      isError: true,
      error: new Error("Network request failed"),
    });

    await renderScreen(createSeedableClient());

    expect(
      screen.getByRole("header", { name: "Something went wrong" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("Acknowledged by the order of the project's states (utils/acknowledgedState)", () => {
  /*
   * A state the project placed between Acknowledged and Resolved, without
   * the acknowledged flag. An episode in it has been acknowledged - on-call
   * stopped paging when it got there - so Acknowledge, a move back up the
   * list the server refuses, is not offered.
   */
  const investigatingState: AlertState = makeAlertState({
    _id: "alert-state-investigating",
    name: "Investigating",
    isCreatedState: false,
    order: 3,
  });
  const laterResolvedState: AlertState = makeAlertState({
    _id: "alert-state-resolved",
    name: "Resolved",
    isResolvedState: true,
    isCreatedState: false,
    order: 4,
  });
  const secondAcknowledgedState: AlertState = makeAlertState({
    _id: "alert-state-second-acknowledged",
    name: "Escalated",
    isAcknowledgedState: true,
    isCreatedState: false,
    order: 3,
  });

  function loadInState(state: AlertState): void {
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: {
          _id: state._id,
          name: state.name,
          color: state.color,
        },
      }),
    });
  }

  test("an episode in a state after Acknowledged is not offered Acknowledge, only Resolve", async () => {
    mockStates.current = [
      createdState,
      acknowledgedState,
      investigatingState,
      laterResolvedState,
    ];
    loadInState(investigatingState);

    await renderScreen(createSeedableClient());

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("response-guidance");
    expect(
      within(guidance).queryByRole("button", {
        name: "Acknowledge alert episode",
      }),
    ).toBeNull();
    expect(
      within(guidance).getByRole("button", {
        name: "Resolve alert episode",
      }),
    ).toBeTruthy();
    expect(within(guidance).getByText("Response in progress")).toBeTruthy();
    expect(
      within(guidance).getByText(
        "A responder has acknowledged this alert episode. Resolve it once recovery is confirmed.",
      ),
    ).toBeTruthy();
  });

  test("a second state flagged acknowledged further down counts as acknowledged too", async () => {
    mockStates.current = [
      createdState,
      acknowledgedState,
      secondAcknowledgedState,
      laterResolvedState,
    ];
    loadInState(secondAcknowledgedState);

    await renderScreen(createSeedableClient());

    expect(
      screen.queryByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeNull();
  });

  test("Acknowledge sends the project's acknowledged state - the first flagged from the top - whatever order the states arrive in", async () => {
    mockStates.current = [
      secondAcknowledgedState,
      laterResolvedState,
      createdState,
      acknowledgedState,
    ];

    await renderScreen(createSeedableClient());

    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge alert episode" }),
    );

    await waitFor(() => {
      expect(mockChangeState).toHaveBeenCalledWith(
        PROJECT_ID,
        EPISODE_ID,
        acknowledgedState._id,
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

  test("the person being paged about this alert episode is offered Escalate", async () => {
    fetchPassOnMock.mockClear();
    mockPassOnPages.current = [PASS_ON_PAGE];

    await renderScreen(createTestQueryClient());

    expect(
      await screen.findByRole("button", {
        name: "Escalate this alert episode",
      }),
    ).toBeTruthy();
    expect(fetchPassOnMock).toHaveBeenCalledWith(
      PROJECT_ID,
      "alert-episode",
      EPISODE_ID,
    );
  });
});
describe("Paged again, and answering a page from its push", () => {
  /*
   * The same rule as an incident's (IncidentDetailScreen.test.tsx holds it
   * in full), for an alert episode.
   */
  let setParams: jest.Mock;
  const acknowledgeAgainMock: jest.Mock =
    passOnApi.acknowledgeOnCallPagesAgain as unknown as jest.Mock;

  const PAGE: OnCallPassOnPage = {
    executionLogId: "run-1",
    policyName: "Payments",
    sentence:
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
  };

  async function renderWithPush(pushAction?: unknown): Promise<void> {
    const props: ScreenProps = {
      route: {
        key: "AlertEpisodeDetail-1",
        name: "AlertEpisodeDetail",
        params: {
          episodeId: EPISODE_ID,
          projectId: PROJECT_ID,
          ...(pushAction ? { pushAction } : {}),
        },
      },
      navigation: { setParams },
    } as unknown as ScreenProps;

    await render(<AlertEpisodeDetailScreen {...props} />, {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });
  }

  function acknowledgedEpisode(): EpisodeQueryState {
    return episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: makeNamedEntityWithColor({
          _id: acknowledgedState._id,
          name: acknowledgedState.name,
        }),
      }),
    });
  }

  beforeEach(() => {
    setParams = jest.fn();
    acknowledgeAgainMock.mockClear();
  });

  afterEach(() => {
    mockPassOnPages.current = null;
  });

  test("paged again about an acknowledged episode: Acknowledge again, then Resolve, then Escalate", async () => {
    mockPassOnPages.current = [{ ...PAGE, isPageAgain: true }];
    mockEpisodeQuery.current = acknowledgedEpisode();

    await renderWithPush();

    await screen.findByRole("button", {
      name: "Acknowledge this alert episode again",
    });
    expect(
      within(screen.getByTestId("response-actions"))
        .getAllByRole("button")
        .map((button: { props: { accessibilityLabel?: string } }) => {
          return button.props.accessibilityLabel;
        }),
    ).toEqual([
      "Acknowledge this alert episode again",
      "Resolve alert episode",
      "Escalate this alert episode",
    ]);
    expect(screen.getByText("You're being paged again")).toBeTruthy();
    expect(
      screen.getByText(
        "This alert episode is still not resolved. Acknowledge again if you're still on it, or escalate it.",
      ),
    ).toBeTruthy();
  });

  /*
   * Somebody asked for the reader by hand - a page sent from a chat, or a
   * policy started by hand - about an episode somebody else acknowledged
   * (#7596): the same buttons as a page again, but the reader never took
   * it, so they are paged to help, not paged again.
   */
  test("paged to help with an episode somebody else acknowledged: the same buttons, and paged - not paged again", async () => {
    mockPassOnPages.current = [
      { ...PAGE, isPageAgain: true, isAskedFor: true },
    ];
    mockEpisodeQuery.current = acknowledgedEpisode();

    await renderWithPush();

    await screen.findByRole("button", {
      name: "Acknowledge this alert episode again",
    });
    expect(
      within(screen.getByTestId("response-actions"))
        .getAllByRole("button")
        .map((button: { props: { accessibilityLabel?: string } }) => {
          return button.props.accessibilityLabel;
        }),
    ).toEqual([
      "Acknowledge this alert episode again",
      "Resolve alert episode",
      "Escalate this alert episode",
    ]);
    expect(screen.getByText("You're being paged")).toBeTruthy();
    expect(screen.queryByText("You're being paged again")).toBeNull();
    expect(
      screen.getByText(
        "A responder has acknowledged this alert episode, and you're being paged to help. Acknowledge again to answer your page, or escalate it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/still on it/)).toBeNull();
  });

  test("the push's Acknowledge on a page again acknowledges it again, and changes no state", async () => {
    mockPassOnPages.current = [{ ...PAGE, isPageAgain: true }];
    mockEpisodeQuery.current = acknowledgedEpisode();

    await renderWithPush({ kind: "acknowledge", id: "n-1:ACKNOWLEDGE_PAGE" });

    await waitFor(() => {
      return expect(acknowledgeAgainMock).toHaveBeenCalledWith(
        PROJECT_ID,
        "alert-episode",
        EPISODE_ID,
      );
    });
    expect(mockChangeState).not.toHaveBeenCalled();
    expect(setParams).toHaveBeenCalledWith({ pushAction: undefined });
  });

  test("the push's Acknowledge on an episode nobody took acknowledges it", async () => {
    mockPassOnPages.current = [PAGE];

    await renderWithPush({ kind: "acknowledge", id: "n-2:ACKNOWLEDGE_PAGE" });

    await waitFor(() => {
      return expect(mockChangeState).toHaveBeenCalledWith(
        PROJECT_ID,
        EPISODE_ID,
        acknowledgedState._id,
      );
    });
    expect(mockChangeState).toHaveBeenCalledTimes(1);
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
    const props: ScreenProps = {
      route: {
        key: "AlertEpisodeDetail-observer",
        name: "AlertEpisodeDetail",
        params: {
          episodeId: EPISODE_ID,
          projectId: PROJECT_ID,
          ...(pushAction ? { pushAction } : {}),
        },
      },
      navigation: { setParams },
    } as unknown as ScreenProps;

    await render(<AlertEpisodeDetailScreen {...props} />, {
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
    mockChangeState.mockClear();
  });

  afterEach(() => {
    observerAlertSpy.mockRestore();
    mockObserverPages.current = [];
    mockPassOnPages.current = null;
  });

  test("on a alert episode nobody has taken: FYI (observer), then I've seen it and Resolve - and no Acknowledge or Escalate", async () => {
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

    await screen.findByRole("button", { name: "I've seen this alert episode" });
    expect(actionLabels()).toEqual([
      "I've seen this alert episode",
      "Resolve alert episode",
    ]);
    expect(screen.getByText("I've seen it")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Acknowledge alert episode" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Escalate this alert episode" }),
    ).toBeNull();
    expect(screen.getByText("FYI (observer)")).toBeTruthy();
    expect(
      screen.getByText(
        "You're paged as an observer: the people responding stay on this alert episode. Saying you've seen it does not acknowledge the alert episode.",
      ),
    ).toBeTruthy();
    expect(fetchObserverMock).toHaveBeenCalledWith(
      PROJECT_ID,
      "alert-episode",
      EPISODE_ID,
    );
  });

  test("on a alert episode the responders acknowledged - the usual case - FYI (observer), then I've seen it and Resolve", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    mockPassOnPages.current = [];
    mockEpisodeQuery.current = episodeStateWith({
      data: makeAlertEpisode({
        currentAlertState: makeNamedEntityWithColor({
          _id: acknowledgedState._id,
          name: acknowledgedState.name,
        }),
      }),
    });

    await renderObserverScreen();

    await screen.findByRole("button", { name: "I've seen this alert episode" });
    expect(actionLabels()).toEqual([
      "I've seen this alert episode",
      "Resolve alert episode",
    ]);
    expect(screen.getByText("FYI (observer)")).toBeTruthy();
  });

  test("I've seen it marks the page seen - no state change - and then the screen is as for anybody", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    mockPassOnPages.current = [];

    await renderObserverScreen();

    const seen: unknown = await screen.findByRole("button", {
      name: "I've seen this alert episode",
    });
    mockObserverPages.current = [];
    await fireEvent.press(seen as Parameters<typeof fireEvent.press>[0]);

    expect(markSeenMock).toHaveBeenCalledWith(
      PROJECT_ID,
      "alert-episode",
      EPISODE_ID,
    );
    expect(mockChangeState).not.toHaveBeenCalled();
    await waitFor(() => {
      return expect(
        screen.queryByRole("button", { name: "I've seen this alert episode" }),
      ).toBeNull();
    });
    expect(screen.queryByText("FYI (observer)")).toBeNull();
    // Stepping in is theirs to choose now, as it is anybody's.
    expect(actionLabels()).toEqual([
      "Acknowledge alert episode",
      "Resolve alert episode",
    ]);
  });

  test("the push's I've seen it marks the page seen once everything is read, and leaves the params - never acknowledging the alert episode", async () => {
    mockObserverPages.current = [OBSERVER_PAGE];
    mockPassOnPages.current = [];

    await renderObserverScreen({ kind: "seen", id: "n-1:MARK_PAGE_SEEN" });

    await waitFor(() => {
      return expect(markSeenMock).toHaveBeenCalledWith(
        PROJECT_ID,
        "alert-episode",
        EPISODE_ID,
      );
    });
    expect(markSeenMock).toHaveBeenCalledTimes(1);
    expect(mockChangeState).not.toHaveBeenCalled();
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
    expect(mockChangeState).not.toHaveBeenCalled();
  });
});

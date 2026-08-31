import React from "react";
import { Alert } from "react-native";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
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

    expect(screen.queryByText("Episode not found.")).toBeNull();
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
    expect(screen.queryByText("Episode not found.")).toBeNull();
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

    expect(screen.getByText("Episode not found.")).toBeTruthy();
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
    expect(screen.queryByText("Episode not found.")).toBeNull();
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

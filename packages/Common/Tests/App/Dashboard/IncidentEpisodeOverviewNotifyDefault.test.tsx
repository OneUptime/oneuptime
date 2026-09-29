import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident episode overview page, rendered for real with every heavy
 * card stubbed. An episode created without notifying status page subscribers
 * must hand the feed a "notify subscribers" default of false, so a public
 * note posted from the feed starts unticked. Everything else keeps notifying.
 *
 * The episode's state change header is not handed a default: its form only
 * takes a private note, so there is no public note for the flag to govern.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

const recordedProps: Record<string, Array<Record<string, unknown>>> = {};
const mountCounts: Record<string, number> = {};

/*
 * Function declarations, so they are hoisted along with the jest.mock calls
 * that use them. Everything they touch is dereferenced lazily, at render
 * time, after the module's consts are initialised.
 */
function recordProps(key: string, props: Record<string, unknown>): void {
  if (!recordedProps[key]) {
    recordedProps[key] = [];
  }

  recordedProps[key]!.push(props);
}

function stubModule(key: string): {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordProps(key, props);

      React.useEffect(() => {
        mountCounts[key] = (mountCounts[key] || 0) + 1;
      }, []);

      return React.createElement("div", { "data-testid": `stub-${key}` });
    },
  };
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return stubModule("EpisodeDetails");
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState",
  () => {
    return stubModule("ChangeEpisodeState");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed",
  () => {
    return stubModule("IncidentEpisodeFeed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment",
  () => {
    return stubModule("Roles");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard",
  () => {
    return stubModule("EpisodeMembers");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel",
  () => {
    return stubModule("TelemetrySnapshot");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicies",
  () => {
    return stubModule("OnCallPolicies");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/User/User",
  () => {
    return stubModule("User");
  },
);

import IncidentEpisodeView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_EPISODE_ID: string = "22222222-2222-4222-8222-222222222222";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const EPISODE_FLAG: string =
  "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated";

const START: Date = new Date("2026-09-14T18:00:00.000Z");

const CHANGE_STATE_KEY: string = "ChangeEpisodeState";
const FEED_KEY: string = "IncidentEpisodeFeed";
const DETAILS_KEY: string = "EpisodeDetails";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
}

interface RecordedCardProps {
  episodeId?: ObjectID;
  incidentEpisodeId?: ObjectID;
  refreshToken?: number;
  notifyStatusPageSubscribersByDefault?: boolean;
  onActionComplete?: () => void | Promise<void>;
  onSaveSuccess?: () => void;
}

function propsHistory(key: string): Array<RecordedCardProps> {
  return (recordedProps[key] || []) as unknown as Array<RecordedCardProps>;
}

function latestProps(key: string): RecordedCardProps {
  const history: Array<RecordedCardProps> = propsHistory(key);

  if (history.length === 0) {
    throw new Error(`${key} was never rendered`);
  }

  return history[history.length - 1]!;
}

// Every notify default the feed was rendered with for the given episode.
function feedDefaultsFor(episodeId: string): Array<boolean | undefined> {
  return propsHistory(FEED_KEY)
    .filter((props: RecordedCardProps): boolean => {
      return props.incidentEpisodeId?.toString() === episodeId;
    })
    .map((props: RecordedCardProps): boolean | undefined => {
      return props.notifyStatusPageSubscribersByDefault;
    });
}

interface ListResultShape {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

const listResult: (data: Array<unknown>) => ListResultShape = (
  data: Array<unknown>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: 10000 };
};

interface EpisodeRow {
  id?: string;
  incidentCount?: number;
  // Left out of the row entirely when the key is absent.
  notifyOnCreate?: boolean | null;
}

const buildEpisode: (row: EpisodeRow) => IncidentEpisode = (
  row: EpisodeRow,
): IncidentEpisode => {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode.id = new ObjectID(row.id || EPISODE_ID);
  episode.declaredAt = START;
  episode.createdAt = START;
  episode.incidentCount = row.incidentCount ?? 2;

  if (Object.prototype.hasOwnProperty.call(row, "notifyOnCreate")) {
    episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated =
      row.notifyOnCreate as boolean;
  }

  return episode;
};

const buildStates: () => Array<IncidentState> = (): Array<IncidentState> => {
  const created: IncidentState = new IncidentState();
  created.id = new ObjectID(CREATED_STATE_ID);
  created.name = "Created";
  created.isCreatedState = true;

  const acknowledged: IncidentState = new IncidentState();
  acknowledged.id = new ObjectID(ACKNOWLEDGED_STATE_ID);
  acknowledged.name = "Acknowledged";
  acknowledged.isAcknowledgedState = true;

  const resolved: IncidentState = new IncidentState();
  resolved.id = new ObjectID(RESOLVED_STATE_ID);
  resolved.name = "Resolved";
  resolved.isResolvedState = true;

  return [created, acknowledged, resolved];
};

const buildTimeline: () => Array<IncidentEpisodeStateTimeline> =
  (): Array<IncidentEpisodeStateTimeline> => {
    const timeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    timeline.incidentStateId = new ObjectID(CREATED_STATE_ID);
    timeline.startsAt = START;
    return [timeline];
  };

type ServeFunction = (row: EpisodeRow) => void;

const serve: ServeFunction = (row: EpisodeRow): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentState) {
      return Promise.resolve(listResult(buildStates()));
    }

    if (request.modelType === IncidentEpisodeStateTimeline) {
      return Promise.resolve(listResult(buildTimeline()));
    }

    if (request.modelType === Incident) {
      return Promise.resolve(listResult([]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });

  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildEpisode(row));
  });
};

const renderPage: () => RenderResult = (): RenderResult => {
  return render(<IncidentEpisodeView {...pageProps} />);
};

type WaitForPageFunction = () => Promise<void>;

const waitForPage: WaitForPageFunction = async (): Promise<void> => {
  await screen.findByTestId(`stub-${FEED_KEY}`);
  await waitFor(() => {
    expect(mountCounts[FEED_KEY]).toBeGreaterThanOrEqual(1);
    expect(mountCounts[CHANGE_STATE_KEY]).toBeGreaterThanOrEqual(1);
  });
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

// Runs the header's "the state changed" callback and waits for its reload.
async function completeStateChange(): Promise<void> {
  await act(async () => {
    await latestProps(CHANGE_STATE_KEY).onActionComplete!();
  });
}

interface EpisodeItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

const episodeItemRequests: () => Array<EpisodeItemRequest> =
  (): Array<EpisodeItemRequest> => {
    return getItemMock.mock.calls
      .map((args: Array<unknown>): EpisodeItemRequest => {
        return args[0] as EpisodeItemRequest;
      })
      .filter((request: EpisodeItemRequest): boolean => {
        return request.modelType === IncidentEpisode;
      });
  };

// The id in the URL. Tests move the reader to another episode by changing it.
let currentEpisodeId: string = EPISODE_ID;

beforeEach(() => {
  currentEpisodeId = EPISODE_ID;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentEpisodeId);
    });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();

  for (const key of Object.keys(recordedProps)) {
    delete recordedProps[key];
  }

  for (const key of Object.keys(mountCounts)) {
    delete mountCounts[key];
  }

  jest.restoreAllMocks();
});

describe("incident episode overview: where Notify Status Page Subscribers starts", () => {
  describe("reading the episode", () => {
    test("selects the notify-on-create flag in the same episode read as the timing fields", async () => {
      serve({ notifyOnCreate: false });

      renderPage();
      await waitForPage();

      const requests: Array<EpisodeItemRequest> = episodeItemRequests();

      // One read: the flag costs no request of its own.
      expect(requests).toHaveLength(1);
      expect(requests[0]!.id.toString()).toBe(EPISODE_ID);
      expect(requests[0]!.select[EPISODE_FLAG]).toBe(true);
      // Still read alongside what the stat bar needs.
      expect(requests[0]!.select["declaredAt"]).toBe(true);
      expect(requests[0]!.select["createdAt"]).toBe(true);
      expect(requests[0]!.select["resolvedAt"]).toBe(true);
      expect(requests[0]!.select["incidentCount"]).toBe(true);
    });

    test("every refresh after a state change selects the flag again", async () => {
      serve({ notifyOnCreate: false });

      renderPage();
      await waitForPage();

      await completeStateChange();

      expect(episodeItemRequests()).toHaveLength(2);

      for (const request of episodeItemRequests()) {
        expect(request.id.toString()).toBe(EPISODE_ID);
        expect(request.select[EPISODE_FLAG]).toBe(true);
      }
    });

    test("an edit saved in the details card reads the flag again too", async () => {
      serve({ notifyOnCreate: false });

      renderPage();
      await waitForPage();

      act(() => {
        latestProps(DETAILS_KEY).onSaveSuccess!();
      });

      await waitFor(() => {
        expect(episodeItemRequests()).toHaveLength(2);
      });

      expect(episodeItemRequests()[1]!.select[EPISODE_FLAG]).toBe(true);
    });
  });

  describe("handing the default to the feed", () => {
    interface NotifyCase {
      name: string;
      row: EpisodeRow;
      expected: boolean;
    }

    const cases: Array<NotifyCase> = [
      {
        name: "created without notifying subscribers: the feed starts unticked",
        row: { notifyOnCreate: false },
        expected: false,
      },
      {
        name: "created with subscribers notified: the feed starts ticked",
        row: { notifyOnCreate: true },
        expected: true,
      },
      {
        name: "flag missing from the row: the feed keeps the long-standing ticked default",
        row: {},
        expected: true,
      },
      {
        name: "flag read back as null: the feed keeps the long-standing ticked default",
        row: { notifyOnCreate: null },
        expected: true,
      },
    ];

    test.each(cases)("$name", async (notifyCase: NotifyCase) => {
      serve(notifyCase.row);

      renderPage();
      await waitForPage();

      const feed: RecordedCardProps = latestProps(FEED_KEY);

      expect(feed.notifyStatusPageSubscribersByDefault).toBe(
        notifyCase.expected,
      );
      expect(feed.incidentEpisodeId?.toString()).toBe(EPISODE_ID);

      /*
       * Not one render with the other value: the form reads its starting
       * value when it opens, so a default that flipped after mount could
       * already have been used.
       */
      expect(new Set(feedDefaultsFor(EPISODE_ID))).toEqual(
        new Set([notifyCase.expected]),
      );
    });

    test("the state change header is not handed a notify default", async () => {
      serve({ notifyOnCreate: false });

      renderPage();
      await waitForPage();

      const header: RecordedCardProps = latestProps(CHANGE_STATE_KEY);

      expect(header.episodeId?.toString()).toBe(EPISODE_ID);
      expect(header).not.toHaveProperty("notifyStatusPageSubscribersByDefault");
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
    });

    test("the feed is not rendered with a default before the episode has loaded", async () => {
      const item: Deferred<IncidentEpisode> = createDeferred<IncidentEpisode>();

      serve({ notifyOnCreate: false });
      getItemMock.mockImplementation(() => {
        return item.promise;
      });

      renderPage();
      await flush();

      expect(screen.getByRole("status")).toHaveTextContent("Loading episode");
      expect(propsHistory(FEED_KEY)).toEqual([]);
      expect(propsHistory(CHANGE_STATE_KEY)).toEqual([]);

      await act(async () => {
        item.resolve(buildEpisode({ notifyOnCreate: false }));
      });
      await waitForPage();

      expect(new Set(feedDefaultsFor(EPISODE_ID))).toEqual(new Set([false]));
    });

    test("a failed first load shows the error and never renders the feed", async () => {
      serve({ notifyOnCreate: false });
      getItemMock.mockImplementation(() => {
        return Promise.reject(new Error("Episode service down"));
      });

      renderPage();

      expect(
        await screen.findByText("Episode service down"),
      ).toBeInTheDocument();
      expect(propsHistory(FEED_KEY)).toEqual([]);
    });
  });

  describe("background refresh", () => {
    test("a state change keeps a quiet episode's default unticked without remounting the feed", async () => {
      serve({ notifyOnCreate: false, incidentCount: 2 });

      renderPage();
      await waitForPage();

      const refreshTokenBefore: number | undefined =
        latestProps(FEED_KEY).refreshToken;

      serve({ notifyOnCreate: false, incidentCount: 3 });

      await completeStateChange();

      // The feed was told to reload in place, not remounted.
      expect(latestProps(FEED_KEY).refreshToken).not.toBe(refreshTokenBefore);
      expect(mountCounts[FEED_KEY]).toBe(1);
      expect(new Set(feedDefaultsFor(EPISODE_ID))).toEqual(new Set([false]));
    });

    test("a refresh that reads a different flag moves the default with it", async () => {
      serve({ notifyOnCreate: true });

      renderPage();
      await waitForPage();

      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        true,
      );

      serve({ notifyOnCreate: false });

      await completeStateChange();

      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
      expect(mountCounts[FEED_KEY]).toBe(1);
    });

    test("a failed refresh keeps the quiet default instead of falling back to notifying", async () => {
      serve({ notifyOnCreate: false });

      renderPage();
      await waitForPage();

      getItemMock.mockImplementationOnce(() => {
        return Promise.reject(new Error("Gateway timeout"));
      });

      await completeStateChange();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't refresh episode timings: Gateway timeout",
      );

      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
      expect(new Set(feedDefaultsFor(EPISODE_ID))).toEqual(new Set([false]));
      expect(mountCounts[FEED_KEY]).toBe(1);
    });
  });

  /*
   * Following a link to another episode re-renders this page with a new id
   * instead of remounting it, so the previous episode is still in state when
   * the next one starts loading.
   */
  describe("moving to another episode on the same route", () => {
    type MoveToFunction = (
      first: EpisodeRow,
    ) => Promise<Deferred<IncidentEpisode>>;

    // Opens `first`, moves to the other episode and leaves its read pending.
    const moveTo: MoveToFunction = async (
      first: EpisodeRow,
    ): Promise<Deferred<IncidentEpisode>> => {
      serve(first);

      const view: RenderResult = renderPage();
      await waitForPage();

      const nextItem: Deferred<IncidentEpisode> =
        createDeferred<IncidentEpisode>();

      getItemMock.mockImplementation((...args: Array<unknown>) => {
        const request: EpisodeItemRequest = args[0] as EpisodeItemRequest;

        if (request.id.toString() === OTHER_EPISODE_ID) {
          return nextItem.promise;
        }

        return Promise.resolve(buildEpisode(first));
      });

      currentEpisodeId = OTHER_EPISODE_ID;
      view.rerender(<IncidentEpisodeView {...pageProps} />);
      await flush();

      // Still loading: nothing rendered for the next episode yet.
      expect(screen.getByRole("status")).toHaveTextContent("Loading episode");
      expect(feedDefaultsFor(OTHER_EPISODE_ID)).toEqual([]);

      return nextItem;
    };

    type MoveBetweenFunction = (
      first: EpisodeRow,
      next: EpisodeRow,
    ) => Promise<void>;

    const moveBetween: MoveBetweenFunction = async (
      first: EpisodeRow,
      next: EpisodeRow,
    ): Promise<void> => {
      const nextItem: Deferred<IncidentEpisode> = await moveTo(first);

      await act(async () => {
        nextItem.resolve(buildEpisode({ ...next, id: OTHER_EPISODE_ID }));
      });

      await waitFor(() => {
        expect(latestProps(FEED_KEY).incidentEpisodeId?.toString()).toBe(
          OTHER_EPISODE_ID,
        );
      });
      await flush();
    };

    test("from a quiet episode to one that notified, the next one starts ticked from its first render", async () => {
      await moveBetween({ notifyOnCreate: false }, { notifyOnCreate: true });

      expect(new Set(feedDefaultsFor(EPISODE_ID))).toEqual(new Set([false]));
      expect(new Set(feedDefaultsFor(OTHER_EPISODE_ID))).toEqual(
        new Set([true]),
      );
    });

    test("from an episode that notified to a quiet one, the next one starts unticked from its first render", async () => {
      await moveBetween({ notifyOnCreate: true }, { notifyOnCreate: false });

      expect(new Set(feedDefaultsFor(EPISODE_ID))).toEqual(new Set([true]));
      expect(new Set(feedDefaultsFor(OTHER_EPISODE_ID))).toEqual(
        new Set([false]),
      );
    });

    test("a next episode that fails to load shows the error, not a feed with the previous default", async () => {
      const nextItem: Deferred<IncidentEpisode> = await moveTo({
        notifyOnCreate: true,
      });

      await act(async () => {
        nextItem.reject(new Error("Episode not found"));
      });

      expect(await screen.findByText("Episode not found")).toBeInTheDocument();
      expect(feedDefaultsFor(OTHER_EPISODE_ID)).toEqual([]);
      expect(screen.queryByTestId(`stub-${FEED_KEY}`)).toBeNull();
    });
  });
});

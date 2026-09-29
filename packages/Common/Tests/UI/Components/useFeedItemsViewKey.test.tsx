import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  renderHook,
  RenderHookResult,
} from "@testing-library/react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Blue500 } from "../../../Types/BrandColors";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import {
  FeedOptions,
  getFeedOptionsKey,
} from "../../../UI/Components/Feed/FeedOptions";
import useFeedItems, {
  FeedPage,
  UseFeedItemsResult,
} from "../../../UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "../../../UI/Components/Feed/useFeedOptions";

/*
 * The viewKey contract of useFeedItems: a change of sort order or event type
 * filter re-reads the feed from its first window, exactly like moving to
 * another resource. LimitMax is deliberately not mocked here, so every window
 * below is the real DEFAULT_LIMIT.
 */

interface TestFeedModel {
  id: string;
}

// What a feed page passes the hook on one render.
interface FeedView {
  resourceKey: string;
  viewKey?: string | undefined;
  refreshToken?: number | undefined;
}

interface FeedRequestTarget {
  resourceKey: string;
  viewKey: string | undefined;
  limit: number;
}

/*
 * One getItems call. The fake API never answers on its own: each test answers
 * or fails the requests itself, in whatever order the race it is about needs.
 */
interface FeedRequest extends FeedRequestTarget {
  respond: (itemNames: Array<string>, count?: number) => Promise<void>;
  fail: (message: string) => Promise<void>;
}

interface FakeFeedApi {
  requests: Array<FeedRequest>;
  getItems: (target: FeedRequestTarget) => Promise<FeedPage<TestFeedModel>>;
}

// Plenty more rows on the server, so More stays available.
const SERVER_ROW_COUNT: number = 1000;

const NEWEST_FIRST: string = getFeedOptionsKey({
  sortOrder: SortOrder.Descending,
  eventTypes: [],
});
const OLDEST_FIRST: string = getFeedOptionsKey({
  sortOrder: SortOrder.Ascending,
  eventTypes: [],
});

type GetItemKey = (
  target: { resourceKey: string; viewKey: string | undefined },
  itemName: string,
) => string;

// Every row names the resource and view it was read for.
const getItemKey: GetItemKey = (
  target: { resourceKey: string; viewKey: string | undefined },
  itemName: string,
): string => {
  return `${target.resourceKey}/${String(target.viewKey)}/${itemName}`;
};

type GetRequestName = (
  resourceKey: string,
  viewKey: string | undefined,
  limit: number,
) => string;

const getRequestName: GetRequestName = (
  resourceKey: string,
  viewKey: string | undefined,
  limit: number,
): string => {
  return `${resourceKey} ${String(viewKey)} ${limit}`;
};

type CreateFakeFeedApi = () => FakeFeedApi;

const createFakeFeedApi: CreateFakeFeedApi = (): FakeFeedApi => {
  const requests: Array<FeedRequest> = [];

  return {
    requests: requests,
    getItems: (target: FeedRequestTarget): Promise<FeedPage<TestFeedModel>> => {
      return new Promise<FeedPage<TestFeedModel>>(
        (
          resolvePage: (page: FeedPage<TestFeedModel>) => void,
          rejectPage: (error: Error) => void,
        ): void => {
          requests.push({
            ...target,
            respond: async (
              itemNames: Array<string>,
              count: number = SERVER_ROW_COUNT,
            ): Promise<void> => {
              await act(async (): Promise<void> => {
                resolvePage({
                  data: itemNames.map((itemName: string): TestFeedModel => {
                    return { id: getItemKey(target, itemName) };
                  }),
                  count: count,
                });
                await Promise.resolve();
              });
            },
            fail: async (message: string): Promise<void> => {
              await act(async (): Promise<void> => {
                rejectPage(new Error(message));
                await Promise.resolve();
              });
            },
          });
        },
      );
    },
  };
};

type GetRequest = (api: FakeFeedApi, index: number) => FeedRequest;

const getRequest: GetRequest = (
  api: FakeFeedApi,
  index: number,
): FeedRequest => {
  const request: FeedRequest | undefined = api.requests[index];

  if (!request) {
    throw new Error(`No feed request #${index} was made`);
  }

  return request;
};

type GetLatestRequest = (api: FakeFeedApi) => FeedRequest;

const getLatestRequest: GetLatestRequest = (api: FakeFeedApi): FeedRequest => {
  return getRequest(api, api.requests.length - 1);
};

type GetRequestNames = (api: FakeFeedApi) => Array<string>;

const getRequestNames: GetRequestNames = (api: FakeFeedApi): Array<string> => {
  return api.requests.map((request: FeedRequest): string => {
    return getRequestName(request.resourceKey, request.viewKey, request.limit);
  });
};

type MapTestItems = (items: Array<TestFeedModel>) => Array<FeedItemProps>;

const mapTestItems: MapTestItems = (
  items: Array<TestFeedModel>,
): Array<FeedItemProps> => {
  return items.map((item: TestFeedModel): FeedItemProps => {
    return {
      key: item.id,
      textInMarkdown: item.id,
      itemDateTime: new Date("2026-09-21T12:00:00.000Z"),
      icon: IconProp.Activity,
      color: Blue500,
    };
  });
};

type GetItemKeys = (feed: UseFeedItemsResult) => Array<string>;

const getItemKeys: GetItemKeys = (feed: UseFeedItemsResult): Array<string> => {
  return feed.feedItems.map((item: FeedItemProps): string => {
    return item.key;
  });
};

// What one render of the page would have had to work with.
interface RenderSnapshot {
  resourceKey: string;
  viewKey: string | undefined;
  isCurrentFeedLoaded: boolean;
  itemKeys: Array<string>;
}

interface FeedHarness {
  result: { current: UseFeedItemsResult };
  renders: Array<RenderSnapshot>;
  show: (view: FeedView) => void;
}

type RenderFeed = (api: FakeFeedApi, view: FeedView) => FeedHarness;

const renderFeed: RenderFeed = (
  api: FakeFeedApi,
  view: FeedView,
): FeedHarness => {
  const renders: Array<RenderSnapshot> = [];

  const hook: RenderHookResult<UseFeedItemsResult, FeedView> = renderHook(
    (props: FeedView): UseFeedItemsResult => {
      const feed: UseFeedItemsResult = useFeedItems<TestFeedModel>({
        resourceKey: props.resourceKey,
        viewKey: props.viewKey,
        refreshToken: props.refreshToken,
        // A new closure over this render's view, as on the feed pages.
        getItems: (limit: number): Promise<FeedPage<TestFeedModel>> => {
          return api.getItems({
            resourceKey: props.resourceKey,
            viewKey: props.viewKey,
            limit: limit,
          });
        },
        mapItems: mapTestItems,
      });

      renders.push({
        resourceKey: props.resourceKey,
        viewKey: props.viewKey,
        isCurrentFeedLoaded: feed.isCurrentFeedLoaded,
        itemKeys: getItemKeys(feed),
      });

      return feed;
    },
    { initialProps: view },
  );

  return {
    result: hook.result,
    renders: renders,
    show: (nextView: FeedView): void => {
      hook.rerender(nextView);
    },
  };
};

type LoadMore = (feed: FeedHarness) => void;

// The reader pressing More.
const loadMore: LoadMore = (feed: FeedHarness): void => {
  act(() => {
    feed.result.current.loadMore();
  });
};

enum TestFeedEventType {
  IncidentCreated = "IncidentCreated",
  IncidentStateChanged = "IncidentStateChanged",
}

type DescribeOptions = (options: FeedOptions) => string;

// What a feed page's getItems puts in its query and sort.
const describeOptions: DescribeOptions = (options: FeedOptions): string => {
  return `sort=${options.sortOrder} types=${options.eventTypes.join(",")}`;
};

interface OptionsFeed {
  feedOptions: UseFeedOptionsResult;
  feed: UseFeedItemsResult;
}

interface OptionsFeedProps {
  resourceKey: string;
}

type OptionsFeedHook = RenderHookResult<OptionsFeed, OptionsFeedProps>;

type RenderOptionsFeed = (
  api: FakeFeedApi,
  resourceKey: string,
) => OptionsFeedHook;

/*
 * Wired the way every dashboard feed wires the two hooks: the resource id is
 * both useFeedOptions' resetKey and useFeedItems' resourceKey, optionsKey is
 * the viewKey, and getItems builds its request from this render's options.
 */
const renderOptionsFeed: RenderOptionsFeed = (
  api: FakeFeedApi,
  resourceKey: string,
): OptionsFeedHook => {
  return renderHook(
    (props: OptionsFeedProps): OptionsFeed => {
      const feedOptions: UseFeedOptionsResult = useFeedOptions({
        eventTypes: Object.values(TestFeedEventType),
        resetKey: props.resourceKey,
      });

      const feed: UseFeedItemsResult = useFeedItems<TestFeedModel>({
        resourceKey: props.resourceKey,
        viewKey: feedOptions.optionsKey,
        getItems: (limit: number): Promise<FeedPage<TestFeedModel>> => {
          return api.getItems({
            resourceKey: props.resourceKey,
            viewKey: describeOptions(feedOptions.options),
            limit: limit,
          });
        },
        mapItems: mapTestItems,
      });

      return { feedOptions: feedOptions, feed: feed };
    },
    { initialProps: { resourceKey: resourceKey } },
  );
};

type GetForeignPaintedItems = (renders: Array<RenderSnapshot>) => Array<string>;

/*
 * The feed pages paint rows only once isCurrentFeedLoaded is true, so that is
 * when a row read for another resource or view must never be in feedItems.
 */
const getForeignPaintedItems: GetForeignPaintedItems = (
  renders: Array<RenderSnapshot>,
): Array<string> => {
  const foreignItems: Array<string> = [];

  for (const snapshot of renders) {
    if (!snapshot.isCurrentFeedLoaded) {
      continue;
    }

    const ownPrefix: string = getItemKey(snapshot, "");

    for (const itemKey of snapshot.itemKeys) {
      if (!itemKey.startsWith(ownPrefix)) {
        foreignItems.push(`${itemKey} painted under ${ownPrefix}`);
      }
    }
  }

  return foreignItems;
};

type GetPaintedItemKeys = (renders: Array<RenderSnapshot>) => Array<string>;

const getPaintedItemKeys: GetPaintedItemKeys = (
  renders: Array<RenderSnapshot>,
): Array<string> => {
  return renders
    .filter((snapshot: RenderSnapshot): boolean => {
      return snapshot.isCurrentFeedLoaded;
    })
    .flatMap((snapshot: RenderSnapshot): Array<string> => {
      return snapshot.itemKeys;
    });
};

afterEach(() => {
  cleanup();
});

describe("useFeedItems viewKey", () => {
  test("re-reads from DEFAULT_LIMIT when the view changes, even after More widened the window", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    await getLatestRequest(api).respond(["newest"]);
    loadMore(feed);
    await getLatestRequest(api).respond(["newest", "next"]);

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT * 2),
    ]);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    expect(getRequestNames(api)).toHaveLength(3);
    expect(getRequestNames(api)[2]).toBe(
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
    );

    await getLatestRequest(api).respond(["oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);
    expect(feed.result.current.hasMore).toBe(true);

    // More on the new view widens from its own first window.
    loadMore(feed);

    expect(getRequestNames(api)[3]).toBe(
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
    );
  });

  /*
   * The feed pages build the query and sort inside getItems from the options
   * of the render that made it, so the re-read must use the new render's
   * getItems - not the one the effect saw first.
   */
  test("hands getItems the sort order and filter the reader just chose", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const hook: OptionsFeedHook = renderOptionsFeed(api, "incident-1");

    await getLatestRequest(api).respond(["newest"]);
    act(() => {
      hook.result.current.feed.loadMore();
    });
    await getLatestRequest(api).respond(["newest", "next"]);

    act(() => {
      hook.result.current.feedOptions.setOptions({
        sortOrder: SortOrder.Ascending,
        eventTypes: [TestFeedEventType.IncidentStateChanged],
      });
    });

    expect(hook.result.current.feed.isCurrentFeedLoaded).toBe(false);

    await getLatestRequest(api).respond(["first-state-change"]);

    expect(hook.result.current.feed.isCurrentFeedLoaded).toBe(true);

    act(() => {
      hook.result.current.feedOptions.setOptions({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      });
    });

    expect(getRequestNames(api)).toEqual([
      getRequestName("incident-1", "sort=DESC types=", DEFAULT_LIMIT),
      getRequestName("incident-1", "sort=DESC types=", DEFAULT_LIMIT * 2),
      getRequestName(
        "incident-1",
        "sort=ASC types=IncidentStateChanged",
        DEFAULT_LIMIT,
      ),
      getRequestName("incident-1", "sort=ASC types=", DEFAULT_LIMIT),
    ]);
  });

  /*
   * The dashboard moves from one incident to the next without remounting the
   * feed. The filter was chosen for the first incident, so not even the first
   * read for the next one may carry it; the sort order is a preference and
   * carries on.
   */
  test("the first read for the next resource drops the previous resource's filter and keeps its sort order", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const hook: OptionsFeedHook = renderOptionsFeed(api, "incident-1");

    await getLatestRequest(api).respond(["newest"]);

    act(() => {
      hook.result.current.feedOptions.setOptions({
        sortOrder: SortOrder.Ascending,
        eventTypes: [TestFeedEventType.IncidentStateChanged],
      });
    });
    await getLatestRequest(api).respond(["first-state-change"]);

    hook.rerender({ resourceKey: "incident-2" });

    // Exactly one read for the next incident, and it is unfiltered.
    expect(getRequestNames(api)).toEqual([
      getRequestName("incident-1", "sort=DESC types=", DEFAULT_LIMIT),
      getRequestName(
        "incident-1",
        "sort=ASC types=IncidentStateChanged",
        DEFAULT_LIMIT,
      ),
      getRequestName("incident-2", "sort=ASC types=", DEFAULT_LIMIT),
    ]);

    await getLatestRequest(api).respond(["oldest"]);

    expect(hook.result.current.feed.isCurrentFeedLoaded).toBe(true);
    expect(hook.result.current.feedOptions.isFiltered).toBe(false);

    // Back on the first incident, its old filter does not come back either.
    hook.rerender({ resourceKey: "incident-1" });

    expect(getRequestNames(api).slice(3)).toEqual([
      getRequestName("incident-1", "sort=ASC types=", DEFAULT_LIMIT),
    ]);
  });

  test("while the new view loads, the feed is not loaded and the old view's rows are gone", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    await getLatestRequest(api).respond(["newest", "next"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.feedItems).toHaveLength(2);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    const firstNewViewRender: RenderSnapshot | undefined = feed.renders.find(
      (snapshot: RenderSnapshot): boolean => {
        return snapshot.viewKey === OLDEST_FIRST;
      },
    );

    // Not even the render that first sees the new view counts as loaded.
    expect(firstNewViewRender?.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.isLoading).toBe(true);
    expect(feed.result.current.feedItems).toEqual([]);
    expect(feed.result.current.hasMore).toBe(false);

    await getLatestRequest(api).respond(["oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.isLoading).toBe(false);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  test("ignores a slow response for the old view that lands after the switch", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    const slowOldViewRequest: FeedRequest = getLatestRequest(api);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    const newViewRequest: FeedRequest = getLatestRequest(api);

    await slowOldViewRequest.respond(["late-newest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.isLoading).toBe(true);
    expect(feed.result.current.feedItems).toEqual([]);

    await newViewRequest.respond(["oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  test("ignores a slow response for the old view that lands after the new view's own", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    const slowOldViewRequest: FeedRequest = getLatestRequest(api);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    await getLatestRequest(api).respond(["oldest"]);
    await slowOldViewRequest.respond(["late-newest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.isLoading).toBe(false);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  test("ignores a failure for the old view that lands after the switch", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    const slowOldViewRequest: FeedRequest = getLatestRequest(api);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    await slowOldViewRequest.fail("The old view's request failed");

    expect(feed.result.current.error).toBeUndefined();
    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.isLoading).toBe(true);

    await getLatestRequest(api).respond(["oldest"]);

    expect(feed.result.current.error).toBeUndefined();
    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
  });

  test("a More still in flight for the old view neither lands nor blocks More on the new view", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    await getLatestRequest(api).respond(["newest"]);
    loadMore(feed);

    const oldViewMoreRequest: FeedRequest = getLatestRequest(api);

    expect(feed.result.current.isLoadingMore).toBe(true);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    expect(feed.result.current.isLoadingMore).toBe(false);

    const newViewRequest: FeedRequest = getLatestRequest(api);

    await oldViewMoreRequest.respond(["newest", "next"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.feedItems).toEqual([]);

    await newViewRequest.respond(["oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.hasMore).toBe(true);

    loadMore(feed);

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT * 2),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  /*
   * Back on the first view, the response it was waiting for before the switch
   * carries the same resource and view - only the request generation tells it
   * apart from the fresh one.
   */
  test("switching A -> B -> A ends on A's fresh data, not the response A was waiting for before", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    const firstNewestRequest: FeedRequest = getLatestRequest(api);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    const oldestRequest: FeedRequest = getLatestRequest(api);

    feed.show({ resourceKey: "monitor-1", viewKey: NEWEST_FIRST });

    const freshNewestRequest: FeedRequest = getLatestRequest(api);

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
    ]);

    await firstNewestRequest.respond(["stale"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.feedItems).toEqual([]);

    await oldestRequest.respond(["oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.feedItems).toEqual([]);

    await freshNewestRequest.respond(["fresh"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.isLoading).toBe(false);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: NEWEST_FIRST }, "fresh"),
    ]);
    expect(getPaintedItemKeys(feed.renders)).not.toContain(
      getItemKey({ resourceKey: "monitor-1", viewKey: NEWEST_FIRST }, "stale"),
    );
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  test("switching A -> B -> A starts A from its first window again", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    await getLatestRequest(api).respond(["newest"]);
    loadMore(feed);
    await getLatestRequest(api).respond(["newest", "next"]);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });
    await getLatestRequest(api).respond(["oldest"]);

    feed.show({ resourceKey: "monitor-1", viewKey: NEWEST_FIRST });

    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.feedItems).toEqual([]);

    await getLatestRequest(api).respond(["fresh"]);

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT * 2),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
    ]);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: NEWEST_FIRST }, "fresh"),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  test("does not refetch when the viewKey is unchanged across re-renders", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: OLDEST_FIRST,
    });

    await getLatestRequest(api).respond(["oldest"]);

    // New props, a new getItems closure and a freshly built, equal key.
    feed.show({
      resourceKey: "monitor-1",
      viewKey: getFeedOptionsKey({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      }),
    });
    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
    ]);
    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.isLoading).toBe(false);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);
  });

  test("without a viewKey the feed is keyed by its resource alone, as before", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, { resourceKey: "monitor-1" });

    await getLatestRequest(api).respond(["first"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);

    loadMore(feed);
    await getLatestRequest(api).respond(["first", "second"]);

    feed.show({ resourceKey: "monitor-1" });
    feed.show({ resourceKey: "monitor-1", viewKey: undefined });

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", undefined, DEFAULT_LIMIT),
      getRequestName("monitor-1", undefined, DEFAULT_LIMIT * 2),
    ]);
    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.feedItems).toHaveLength(2);

    // The reader moves on while a More for the first resource is in flight.
    loadMore(feed);

    const slowFirstResourceRequest: FeedRequest = getLatestRequest(api);

    feed.show({ resourceKey: "monitor-2" });

    expect(getRequestNames(api).slice(2)).toEqual([
      getRequestName("monitor-1", undefined, DEFAULT_LIMIT * 3),
      getRequestName("monitor-2", undefined, DEFAULT_LIMIT),
    ]);
    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.feedItems).toEqual([]);

    await getLatestRequest(api).respond(["other"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-2", viewKey: undefined }, "other"),
    ]);

    // That late More for the first resource lands nowhere.
    await slowFirstResourceRequest.respond(["late"]);

    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-2", viewKey: undefined }, "other"),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  test("a refreshToken bump re-reads the current view at its current window", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
      refreshToken: 0,
    });

    await getLatestRequest(api).respond(["newest"]);

    feed.show({
      resourceKey: "monitor-1",
      viewKey: OLDEST_FIRST,
      refreshToken: 0,
    });
    await getLatestRequest(api).respond(["oldest"]);
    loadMore(feed);
    await getLatestRequest(api).respond(["oldest", "next"]);

    feed.show({
      resourceKey: "monitor-1",
      viewKey: OLDEST_FIRST,
      refreshToken: 1,
    });

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
    ]);

    // A refresh keeps the rows on screen while it reads.
    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "next"),
    ]);

    await getLatestRequest(api).respond(["oldest", "next", "new"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(feed.result.current.feedItems).toHaveLength(3);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });

  /*
   * The view change itself always reads DEFAULT_LIMIT rows. What a refresh
   * reads is the remembered window, and until the new view's first read lands
   * nothing has replaced the window More widened on the old view - so the
   * view change has to reset it, or a refresh in that gap reads the old view's
   * wider window for the new one.
   */
  test("a refresh before the new view's first read lands asks for DEFAULT_LIMIT, not the old view's widened window", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
      refreshToken: 0,
    });

    await getLatestRequest(api).respond(["newest"]);
    loadMore(feed);
    await getLatestRequest(api).respond(["newest", "next"]);

    feed.show({
      resourceKey: "monitor-1",
      viewKey: OLDEST_FIRST,
      refreshToken: 0,
    });

    const supersededRequest: FeedRequest = getLatestRequest(api);

    feed.show({
      resourceKey: "monitor-1",
      viewKey: OLDEST_FIRST,
      refreshToken: 1,
    });

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT * 2),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
    ]);

    const refreshRequest: FeedRequest = getLatestRequest(api);

    await supersededRequest.respond(["superseded"]);
    await refreshRequest.respond(["oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);
    expect(getPaintedItemKeys(feed.renders)).not.toContain(
      getItemKey(
        { resourceKey: "monitor-1", viewKey: OLDEST_FIRST },
        "superseded",
      ),
    );

    // More on the new view widens from its own first window.
    loadMore(feed);

    expect(getRequestNames(api).slice(4)).toEqual([
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
    ]);
  });

  /*
   * A failed read leaves the remembered window as it was, so after the new
   * view's first read fails only the view change's own reset keeps the
   * reader's retry from reading the old view's wider window.
   */
  test("a refresh after the new view's first read failed asks for DEFAULT_LIMIT", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: NEWEST_FIRST,
    });

    await getLatestRequest(api).respond(["newest"]);
    loadMore(feed);
    await getLatestRequest(api).respond(["newest", "next"]);

    feed.show({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST });
    await getLatestRequest(api).fail("The new view's read failed");

    expect(typeof feed.result.current.error).toBe("string");
    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);

    // The reader presses the feed's Refresh button.
    act(() => {
      feed.result.current.refresh().catch(() => {
        // fetchItems converts request failures into the error state.
      });
    });

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", NEWEST_FIRST, DEFAULT_LIMIT * 2),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
    ]);

    await getLatestRequest(api).respond(["oldest"]);

    expect(feed.result.current.error).toBeUndefined();
    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey({ resourceKey: "monitor-1", viewKey: OLDEST_FIRST }, "oldest"),
    ]);

    loadMore(feed);

    expect(getRequestNames(api).slice(4)).toEqual([
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
    ]);
  });

  test("changing resourceKey while a viewKey is set still resets the feed", async () => {
    const api: FakeFeedApi = createFakeFeedApi();
    const feed: FeedHarness = renderFeed(api, {
      resourceKey: "monitor-1",
      viewKey: OLDEST_FIRST,
    });

    await getLatestRequest(api).respond(["oldest"]);
    loadMore(feed);
    await getLatestRequest(api).respond(["oldest", "next"]);

    feed.show({ resourceKey: "monitor-2", viewKey: OLDEST_FIRST });

    expect(getRequestNames(api)).toEqual([
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT),
      getRequestName("monitor-1", OLDEST_FIRST, DEFAULT_LIMIT * 2),
      getRequestName("monitor-2", OLDEST_FIRST, DEFAULT_LIMIT),
    ]);
    expect(feed.result.current.isCurrentFeedLoaded).toBe(false);
    expect(feed.result.current.feedItems).toEqual([]);
    expect(feed.result.current.hasMore).toBe(false);

    await getLatestRequest(api).respond(["other-oldest"]);

    expect(feed.result.current.isCurrentFeedLoaded).toBe(true);
    expect(getItemKeys(feed.result.current)).toEqual([
      getItemKey(
        { resourceKey: "monitor-2", viewKey: OLDEST_FIRST },
        "other-oldest",
      ),
    ]);
    expect(getForeignPaintedItems(feed.renders)).toEqual([]);
  });
});

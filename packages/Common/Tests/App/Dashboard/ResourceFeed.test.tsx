import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * ModelAPI is the only thing between this component and the network. Stubbed
 * inline rather than through a helper because jest.mock is hoisted above the
 * imports - a helper imported from another module is not initialised yet when
 * the factory runs. The names carry the "mock" prefix jest requires of
 * anything a hoisted factory closes over.
 */
type GetListRequest = Record<string, unknown>;

const mockGetListCalls: Array<GetListRequest> = [];

let mockGetListResponse: (
  request: GetListRequest,
) => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({ data: [], count: 0 });
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise!(value);
    },
  };
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: GetListRequest): Promise<unknown> => {
        mockGetListCalls.push(request);
        return mockGetListResponse(request);
      },
    },
  };
});

/*
 * The real Icon draws an SVG that says nothing about which icon it is. This
 * one names the icon, so the checklist's icons and the trigger's glyph can be
 * read back off the page. Everything else the module exports (SizeProp,
 * ThickProp, IconType) stays real - components across the feed read those at
 * render time.
 */
jest.mock("../../../UI/Components/Icon/Icon", () => {
  const actualIconModule: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Icon/Icon",
  ) as Record<string, unknown>;

  return {
    ...actualIconModule,
    __esModule: true,
    default: (props: { icon: string }): React.ReactElement => {
      return <span data-icon={props.icon} aria-hidden="true" />;
    },
  };
});

import ResourceFeed, {
  GetResourceFeedIconFunction,
  getIconForEventType,
  resolveResourceFeedIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceFeed/ResourceFeed";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { Green500 } from "../../../Types/BrandColors";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Includes from "../../../Types/BaseDatabase/Includes";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import {
  DEFAULT_FEED_OPTIONS,
  FEED_OPTIONS_TEXT,
  FILTERED_FEED_NO_ITEMS_MESSAGE,
  FeedOptions,
  getFeedOptionsSummary,
} from "../../../UI/Components/Feed/FeedOptions";
import { getSortOrderStorageKey } from "../../../UI/Components/Feed/useFeedOptions";

/*
 * One component serves all ten resource feeds, parameterised by the two
 * column names that differ between them. That is what makes it worth testing
 * once and worth testing carefully: the query column and the event-type column
 * arrive as strings, so a typo in either compiles perfectly and produces an
 * empty feed (wrong query column) or an every-item-looks-the-same timeline
 * (wrong event-type column).
 */

const CLUSTER_ID: ObjectID = ObjectID.generate();

const ALL_EVENT_TYPES: Array<string> = Object.values(
  KubernetesClusterFeedEventType,
);

const NO_ITEMS_MESSAGE: string =
  "No activity has been recorded for this Kubernetes cluster yet.";

function feedItem(
  eventType: KubernetesClusterFeedEventType,
  markdown: string,
  postedAt: Date = new Date("2024-01-15T10:30:00.000Z"),
): KubernetesClusterFeed {
  const item: KubernetesClusterFeed = new KubernetesClusterFeed(
    ObjectID.generate(),
  );
  item.feedInfoInMarkdown = markdown;
  item.kubernetesClusterFeedEventType = eventType;
  item.displayColor = Green500;
  item.postedAt = postedAt;
  return item;
}

function getFeedElement(resourceId: ObjectID = CLUSTER_ID): React.ReactElement {
  return (
    <ResourceFeed<KubernetesClusterFeed>
      modelType={KubernetesClusterFeed}
      resourceIdColumn="kubernetesClusterId"
      resourceId={resourceId}
      eventTypeColumn="kubernetesClusterFeedEventType"
      eventTypes={ALL_EVENT_TYPES}
      title="Kubernetes Cluster Feed"
      description="Everything that has happened to this Kubernetes cluster."
      noItemsMessage={NO_ITEMS_MESSAGE}
    />
  );
}

function renderFeed(
  resourceId: ObjectID = CLUSTER_ID,
): ReturnType<typeof render> {
  return render(getFeedElement(resourceId));
}

const RESOURCE_ID_COLUMN: string = "kubernetesClusterId";

const EVENT_TYPE_COLUMN: string = "kubernetesClusterFeedEventType";

type GetQuery = (request: GetListRequest) => Record<string, unknown>;

const getQuery: GetQuery = (
  request: GetListRequest,
): Record<string, unknown> => {
  return request["query"] as Record<string, unknown>;
};

type GetRequestsFor = (resourceId: ObjectID) => Array<GetListRequest>;

// Every request made so far for this cluster's feed, oldest first.
const getRequestsFor: GetRequestsFor = (
  resourceId: ObjectID,
): Array<GetListRequest> => {
  return mockGetListCalls.filter((request: GetListRequest) => {
    return (
      String(getQuery(request)[RESOURCE_ID_COLUMN]) === resourceId.toString()
    );
  });
};

type WaitForFeed = (requestCount: number) => Promise<void>;

// The feed has asked the API `requestCount` times and drawn the last answer.
const waitForFeed: WaitForFeed = async (
  requestCount: number,
): Promise<void> => {
  await waitFor(() => {
    expect(mockGetListCalls).toHaveLength(requestCount);
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
};

type GetFilterAndSortButton = () => HTMLElement;

/*
 * Found the way a screen reader finds it: by its label. What the feed is
 * showing is the button's description, not part of its name, so the name
 * stays "Filter & Sort" whatever is chosen - and the count badge, which is
 * aria-hidden, never joins it either.
 */
const getFilterAndSortButton: GetFilterAndSortButton = (): HTMLElement => {
  return screen.getByRole("button", { name: "Filter & Sort" });
};

type OpenFilterAndSort = () => HTMLElement;

// Presses Filter & Sort and returns the panel it opens.
const openFilterAndSort: OpenFilterAndSort = (): HTMLElement => {
  fireEvent.click(getFilterAndSortButton());

  return screen.getByRole("dialog", { name: FEED_OPTIONS_TEXT.panelLabel });
};

type CloseFilterAndSort = () => void;

// A press anywhere outside the panel - on the way to another page, say.
const closeFilterAndSort: CloseFilterAndSort = (): void => {
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
};

type GetExpectedSummary = (options: FeedOptions) => string;

/*
 * The sentence the trigger is described by, for this feed's event types.
 * Built by the same function the button uses, so the wording can change
 * without this suite noticing - what is pinned is that the description
 * follows the feed's live order and filter, counted over this feed's own
 * event types.
 */
const getExpectedSummary: GetExpectedSummary = (
  options: FeedOptions,
): string => {
  return getFeedOptionsSummary({
    options: options,
    eventTypeCount: ALL_EVENT_TYPES.length,
  });
};

type GetTriggerIcon = () => string | null;

// The glyph in front of the trigger's label: a funnel, or the sort arrows.
const getTriggerIcon: GetTriggerIcon = (): string | null => {
  return (
    getFilterAndSortButton()
      .querySelector("[data-icon]")
      ?.getAttribute("data-icon") || null
  );
};

type GetStoredSortOrderKeys = () => Array<string>;

/*
 * Every remembered feed sort order in this browser, whichever feed wrote it.
 * The prefix is whatever getSortOrderStorageKey puts in front of a feed's
 * name, so it is read from there rather than copied.
 */
const getStoredSortOrderKeys: GetStoredSortOrderKeys = (): Array<string> => {
  const prefix: string = getSortOrderStorageKey("");
  const keys: Array<string> = [];

  for (let index: number = 0; index < window.localStorage.length; index++) {
    const key: string | null = window.localStorage.key(index);

    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }

  return keys;
};

beforeEach(() => {
  mockGetListCalls.length = 0;
  mockGetListResponse = (): Promise<unknown> => {
    return Promise.resolve({ data: [], count: 0 });
  };
  // The chosen sort order is remembered, so one test's choice must not leak.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ResourceFeed", () => {
  test("queries the feed for the resource it was given", async () => {
    renderFeed();

    await waitFor(() => {
      expect(mockGetListCalls.length).toBe(1);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request: any = mockGetListCalls[0]!;

    expect(request.modelType).toBe(KubernetesClusterFeed);
    expect(request.query.kubernetesClusterId).toBe(CLUSTER_ID);

    /*
     * The event type drives the icon. Forgetting to select it renders every
     * item with the fallback dot and nothing else goes wrong, so nothing else
     * would catch it.
     */
    expect(request.select.kubernetesClusterFeedEventType).toBe(true);
    expect(request.select.feedInfoInMarkdown).toBe(true);
    expect(request.select.postedAt).toBe(true);
    expect(request.skip).toBe(0);
    expect(request.limit).toBe(DEFAULT_LIMIT);
    expect(request.sort).toEqual({ postedAt: SortOrder.Descending });
  });

  test("renders the items it is given", async () => {
    mockGetListResponse = (): Promise<unknown> => {
      return Promise.resolve({
        data: [
          feedItem(
            KubernetesClusterFeedEventType.KubernetesClusterCreated,
            "cluster was created automatically",
          ),
          feedItem(
            KubernetesClusterFeedEventType.OwnerUserAdded,
            "Jane Doe was added as an owner",
          ),
        ],
        count: 2,
      });
    };

    renderFeed();

    /*
     * The first test to render markdown pays for the lazy MarkdownViewer
     * chunk: until import() settles, each item shows the "Loading content"
     * placeholder. On a loaded CI runner that took longer than waitFor's
     * default 1s, so give the cold load room (later tests hit the warm cache).
     */
    await waitFor(
      () => {
        expect(
          screen.getByText(/cluster was created automatically/),
        ).toBeInTheDocument();
      },
      { timeout: 20000 },
    );

    expect(
      screen.getByText(/Jane Doe was added as an owner/),
    ).toBeInTheDocument();
  });

  test("shows the newest page first and reveals older activity through More", async () => {
    const items: Array<KubernetesClusterFeed> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `activity-${index + 1}`,
          new Date(Date.UTC(2024, 0, index + 1)),
        );
      },
    );

    const newestFirst: Array<KubernetesClusterFeed> = [...items].reverse();

    /* Mirror the API's descending sort and requested top-N window. */
    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      return Promise.resolve({
        data: newestFirst.slice(0, request["limit"] as number),
        count: items.length,
      });
    };

    renderFeed();

    await waitFor(() => {
      expect(screen.getByText("activity-12")).toBeInTheDocument();
    });

    const visibleActivity: Array<HTMLElement> =
      screen.getAllByText(/activity-\d+/);
    expect(visibleActivity).toHaveLength(10);
    expect(visibleActivity[0]).toHaveTextContent("activity-12");
    expect(visibleActivity[9]).toHaveTextContent("activity-3");
    expect(screen.queryByText("activity-2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    await waitFor(() => {
      expect(screen.getByText("activity-2")).toBeInTheDocument();
      expect(screen.getByText("activity-1")).toBeInTheDocument();
    });

    /*
     * More re-reads the newest top N rather than offset-appending, which is
     * safe when a live feed receives a new event between clicks.
     */
    expect(mockGetListCalls).toHaveLength(2);
    expect(mockGetListCalls[1]?.["skip"]).toBe(0);
    expect(mockGetListCalls[1]?.["limit"]).toBe(DEFAULT_LIMIT * 2);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  test("expands ten at a time and preserves the expanded window on refresh", async () => {
    const newestFirst: Array<KubernetesClusterFeed> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `entry-${25 - index}`,
          new Date(Date.UTC(2024, 0, 25 - index)),
        );
      },
    );

    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      return Promise.resolve({
        data: newestFirst.slice(0, request["limit"] as number),
        count: newestFirst.length,
      });
    };

    renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/entry-\d+/)).toHaveLength(DEFAULT_LIMIT);
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getAllByText(/entry-\d+/)).toHaveLength(DEFAULT_LIMIT * 2);
    });
    expect(mockGetListCalls[1]?.["limit"]).toBe(DEFAULT_LIMIT * 2);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getAllByText(/entry-\d+/)).toHaveLength(25);
    });
    expect(mockGetListCalls[2]?.["limit"]).toBe(DEFAULT_LIMIT * 3);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(mockGetListCalls).toHaveLength(4);
    });
    expect(mockGetListCalls[3]?.["limit"]).toBe(DEFAULT_LIMIT * 3);
  });

  test("replaces the newest window when activity arrives between More clicks", async () => {
    const initialItems: Array<KubernetesClusterFeed> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `live-entry-${12 - index}`,
          new Date(Date.UTC(2024, 0, 12 - index)),
        );
      },
    );
    const newItem: KubernetesClusterFeed = feedItem(
      KubernetesClusterFeedEventType.KubernetesClusterUpdated,
      "live-entry-13",
      new Date(Date.UTC(2024, 0, 13)),
    );
    let requestNumber: number = 0;

    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      requestNumber += 1;
      const currentItems: Array<KubernetesClusterFeed> =
        requestNumber === 1 ? initialItems : [newItem, ...initialItems];

      return Promise.resolve({
        data: currentItems.slice(0, request["limit"] as number),
        count: currentItems.length,
      });
    };

    renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/live-entry-/)).toHaveLength(DEFAULT_LIMIT);
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getAllByText(/live-entry-/)).toHaveLength(13);
    });

    const labels: Array<string> = screen
      .getAllByText(/live-entry-/)
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
    expect(labels[0]).toBe("live-entry-13");
    expect(new Set(labels).size).toBe(13);
  });

  test("resets the expanded window when navigating to another resource", async () => {
    const nextClusterId: ObjectID = ObjectID.generate();
    const items: Array<KubernetesClusterFeed> = Array.from(
      { length: 15 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `resource-entry-${index}`,
          new Date(Date.UTC(2024, 0, 15 - index)),
        );
      },
    );

    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      return Promise.resolve({
        data: items.slice(0, request["limit"] as number),
        count: items.length,
      });
    };

    const view: ReturnType<typeof render> = renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/resource-entry-/)).toHaveLength(
        DEFAULT_LIMIT,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getAllByText(/resource-entry-/)).toHaveLength(15);
    });

    view.rerender(getFeedElement(nextClusterId));
    expect(screen.queryByText(/resource-entry-/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetListCalls).toHaveLength(3);
    });

    const navigationRequest: GetListRequest = mockGetListCalls[2]!;
    expect(navigationRequest["limit"]).toBe(DEFAULT_LIMIT);
    expect(
      (navigationRequest["query"] as Record<string, unknown>)[
        "kubernetesClusterId"
      ],
    ).toBe(nextClusterId);
  });

  test("ignores an in-flight More response after navigating to another resource", async () => {
    const nextClusterId: ObjectID = ObjectID.generate();
    const oldItems: Array<KubernetesClusterFeed> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `old-resource-${12 - index}`,
          new Date(Date.UTC(2024, 0, 12 - index)),
        );
      },
    );
    const nextItem: KubernetesClusterFeed = feedItem(
      KubernetesClusterFeedEventType.KubernetesClusterUpdated,
      "next-resource-only",
    );
    const loadMoreRequest: Deferred<unknown> = createDeferred<unknown>();
    const nextResourceRequest: Deferred<unknown> = createDeferred<unknown>();

    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      const query: Record<string, unknown> = request["query"] as Record<
        string,
        unknown
      >;
      const requestedId: ObjectID = query["kubernetesClusterId"] as ObjectID;

      if (requestedId.toString() === nextClusterId.toString()) {
        return nextResourceRequest.promise;
      }

      if ((request["limit"] as number) > DEFAULT_LIMIT) {
        return loadMoreRequest.promise;
      }

      return Promise.resolve({
        data: oldItems.slice(0, DEFAULT_LIMIT),
        count: oldItems.length,
      });
    };

    const view: ReturnType<typeof render> = renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/old-resource-/)).toHaveLength(DEFAULT_LIMIT);
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(mockGetListCalls).toHaveLength(2);
    });

    view.rerender(getFeedElement(nextClusterId));
    expect(screen.queryByText(/old-resource-/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetListCalls).toHaveLength(3);
    });

    await act(async (): Promise<void> => {
      nextResourceRequest.resolve({ data: [nextItem], count: 1 });
      await Promise.resolve();
    });
    expect(screen.getByText("next-resource-only")).toBeVisible();

    await act(async (): Promise<void> => {
      loadMoreRequest.resolve({ data: oldItems, count: oldItems.length });
      await Promise.resolve();
    });

    expect(screen.getByText("next-resource-only")).toBeVisible();
    expect(screen.queryByText(/old-resource-/)).not.toBeInTheDocument();
  });

  test("keeps the current entries and allows a retry when More fails", async () => {
    const items: Array<KubernetesClusterFeed> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `retry-entry-${index}`,
          new Date(Date.UTC(2024, 0, 12 - index)),
        );
      },
    );
    let shouldFailMore: boolean = true;

    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      if ((request["limit"] as number) > DEFAULT_LIMIT && shouldFailMore) {
        return Promise.reject(new Error("older activity unavailable"));
      }

      return Promise.resolve({
        data: items.slice(0, request["limit"] as number),
        count: items.length,
      });
    };

    renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/retry-entry-/)).toHaveLength(DEFAULT_LIMIT);
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getByText(/older activity unavailable/)).toBeVisible();
    });
    expect(screen.getAllByText(/retry-entry-/)).toHaveLength(DEFAULT_LIMIT);
    expect(screen.getByRole("button", { name: "More" })).toBeEnabled();

    shouldFailMore = false;
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getAllByText(/retry-entry-/)).toHaveLength(12);
    });
    expect(screen.queryByText(/older activity unavailable/)).toBeNull();
  });

  test("does not carry a failed More error to another resource", async () => {
    const nextClusterId: ObjectID = ObjectID.generate();
    const items: Array<KubernetesClusterFeed> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `stale-error-entry-${index}`,
          new Date(Date.UTC(2024, 0, 12 - index)),
        );
      },
    );

    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      const query: Record<string, unknown> = request["query"] as Record<
        string,
        unknown
      >;
      const requestedId: ObjectID = query["kubernetesClusterId"] as ObjectID;

      if (requestedId.toString() === nextClusterId.toString()) {
        return Promise.resolve({ data: [], count: 0 });
      }

      if ((request["limit"] as number) > DEFAULT_LIMIT) {
        return Promise.reject(new Error("old resource More failed"));
      }

      return Promise.resolve({
        data: items.slice(0, DEFAULT_LIMIT),
        count: items.length,
      });
    };

    const view: ReturnType<typeof render> = renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/stale-error-entry-/)).toHaveLength(
        DEFAULT_LIMIT,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByText("old resource More failed")).toBeVisible();

    view.rerender(getFeedElement(nextClusterId));

    expect(screen.queryByText("old resource More failed")).toBeNull();
    expect(screen.queryByText(/stale-error-entry-/)).toBeNull();
  });

  test("says so when the resource has no history yet", async () => {
    renderFeed();

    await waitFor(() => {
      expect(
        screen.getByText(
          "No activity has been recorded for this Kubernetes cluster yet.",
        ),
      ).toBeInTheDocument();
    });
  });

  test("surfaces a failed load instead of an empty timeline", async () => {
    /*
     * An error rendered as "no activity" is worse than an error: it tells the
     * reader the resource has no history when the truth is unknown.
     */
    mockGetListResponse = (): Promise<unknown> => {
      return Promise.reject(new Error("nope"));
    };

    renderFeed();

    expect(await screen.findByText("nope")).toBeVisible();
    expect(
      screen.queryByText(
        "No activity has been recorded for this Kubernetes cluster yet.",
      ),
    ).not.toBeInTheDocument();
  });
});

describe("getIconForEventType", () => {
  test("gives each resource lifecycle event its own icon", () => {
    /*
     * Matched on the suffix, because every family names these after its own
     * model - KubernetesClusterCreated, DockerHostCreated, ServiceCreated and
     * so on. One mapping, nine enums.
     */
    for (const model of [
      "KubernetesCluster",
      "DockerHost",
      "DockerSwarmCluster",
      "CephCluster",
      "PodmanHost",
      "ProxmoxCluster",
      "VMwareVCenter",
      "Host",
      "CloudResource",
      "Service",
    ]) {
      expect(getIconForEventType(`${model}Created`)).toBe(IconProp.Add);
      expect(getIconForEventType(`${model}Updated`)).toBe(IconProp.Edit);
      expect(getIconForEventType(`${model}Archived`)).toBe(IconProp.Archive);
      expect(getIconForEventType(`${model}Restored`)).toBe(IconProp.Refresh);
    }
  });

  test("distinguishes owners being added from owners being removed", () => {
    expect(getIconForEventType("OwnerUserAdded")).toBe(IconProp.User);
    expect(getIconForEventType("OwnerTeamAdded")).toBe(IconProp.Team);
    expect(getIconForEventType("OwnerUserRemoved")).toBe(IconProp.Close);
    expect(getIconForEventType("OwnerTeamRemoved")).toBe(IconProp.Close);
  });

  test("marks rule-driven events apart from hand-made ones", () => {
    expect(getIconForEventType("OwnerRuleExecuted")).toBe(IconProp.Team);
    expect(getIconForEventType("LabelRuleExecuted")).toBe(IconProp.Label);
  });

  test("falls back rather than throwing on an event it has never seen", () => {
    expect(getIconForEventType("SomethingNobodyHasWrittenYet")).toBe(
      IconProp.Circle,
    );
    expect(getIconForEventType("")).toBe(IconProp.Circle);
  });
});

/*
 * A feed whose events the suffix rules cannot express - the SLO feed's
 * StatusChanged, BurnRateAlertRaised, MonitorsDetached - passes getIcon. The
 * contract: the feed's own answer wins, "no answer" falls back to the shared
 * rules, and a feed that passes nothing renders exactly as before.
 */
describe("resolveResourceFeedIcon", () => {
  const getOwnIcon: GetResourceFeedIconFunction = (
    eventType: string,
  ): IconProp | undefined => {
    return eventType === "StatusChanged"
      ? IconProp.ArrowCircleRight
      : undefined;
  };

  test("uses the feed's own icon when it has one", () => {
    expect(
      resolveResourceFeedIcon({
        eventType: "StatusChanged",
        getIcon: getOwnIcon,
      }),
    ).toBe(IconProp.ArrowCircleRight);
  });

  test("falls back to the shared rules when the feed has no answer", () => {
    expect(
      resolveResourceFeedIcon({
        eventType: "ServiceLevelObjectiveCreated",
        getIcon: getOwnIcon,
      }),
    ).toBe(IconProp.Add);
    expect(
      resolveResourceFeedIcon({
        eventType: "OwnerTeamRemoved",
        getIcon: getOwnIcon,
      }),
    ).toBe(IconProp.Close);
    expect(
      resolveResourceFeedIcon({ eventType: "Unknown", getIcon: getOwnIcon }),
    ).toBe(IconProp.Circle);
  });

  test("without getIcon it is exactly the shared rules", () => {
    for (const eventType of [
      "KubernetesClusterCreated",
      "ServiceArchived",
      "OwnerUserAdded",
      "LabelRuleExecuted",
      "StatusChanged",
      "",
    ]) {
      expect(resolveResourceFeedIcon({ eventType: eventType })).toBe(
        getIconForEventType(eventType),
      );
    }
  });
});

describe("ResourceFeed - a feed's own icons", () => {
  test("asks getIcon about every item it renders, by that item's event type", async () => {
    const askedEventTypes: Array<string> = [];

    const getIcon: GetResourceFeedIconFunction = (
      eventType: string,
    ): IconProp | undefined => {
      askedEventTypes.push(eventType);
      return undefined;
    };

    mockGetListResponse = (): Promise<unknown> => {
      return Promise.resolve({
        data: [
          feedItem(
            KubernetesClusterFeedEventType.KubernetesClusterCreated,
            "created-item",
          ),
          feedItem(KubernetesClusterFeedEventType.OwnerUserAdded, "owner-item"),
        ],
        count: 2,
      });
    };

    render(
      <ResourceFeed<KubernetesClusterFeed>
        modelType={KubernetesClusterFeed}
        resourceIdColumn="kubernetesClusterId"
        resourceId={CLUSTER_ID}
        eventTypeColumn="kubernetesClusterFeedEventType"
        eventTypes={ALL_EVENT_TYPES}
        title="Kubernetes Cluster Feed"
        description="Everything that has happened to this Kubernetes cluster."
        noItemsMessage={NO_ITEMS_MESSAGE}
        getIcon={getIcon}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/owner-item/)).toBeInTheDocument();
    });

    expect(screen.getByText(/created-item/)).toBeInTheDocument();
    expect(askedEventTypes).toContain(
      KubernetesClusterFeedEventType.KubernetesClusterCreated,
    );
    expect(askedEventTypes).toContain(
      KubernetesClusterFeedEventType.OwnerUserAdded,
    );
  });

  test("gives the Filter & Sort checklist the same icons, one entry per event type", async () => {
    const askedEventTypes: Array<string> = [];

    /*
     * One event type gets an icon of the feed's own that the shared rules
     * would never pick for it, so its row can only show it if the checklist
     * really goes through getIcon.
     */
    const ownIconEventType: string =
      KubernetesClusterFeedEventType.OwnerUserAdded;
    const ownIcon: IconProp = IconProp.Fire;

    expect(getIconForEventType(ownIconEventType)).not.toBe(ownIcon);

    const getIcon: GetResourceFeedIconFunction = (
      eventType: string,
    ): IconProp | undefined => {
      askedEventTypes.push(eventType);
      return eventType === ownIconEventType ? ownIcon : undefined;
    };

    render(
      <ResourceFeed<KubernetesClusterFeed>
        modelType={KubernetesClusterFeed}
        resourceIdColumn="kubernetesClusterId"
        resourceId={CLUSTER_ID}
        eventTypeColumn="kubernetesClusterFeedEventType"
        eventTypes={ALL_EVENT_TYPES}
        title="Kubernetes Cluster Feed"
        description="Everything that has happened to this Kubernetes cluster."
        noItemsMessage={NO_ITEMS_MESSAGE}
        getIcon={getIcon}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(NO_ITEMS_MESSAGE)).toBeInTheDocument();
    });

    // The feed is empty, so only the checklist can have asked.
    for (const eventType of ALL_EVENT_TYPES) {
      expect(askedEventTypes).toContain(eventType);
    }

    const panel: HTMLElement = openFilterAndSort();

    /*
     * Exactly one box per event type of this feed's own enum: none missing,
     * none repeated, and nothing from another feed.
     */
    const checkboxTestIds: Array<string> = within(panel)
      .getAllByRole("checkbox")
      .map((checkbox: HTMLElement): string => {
        return checkbox.getAttribute("data-testid") || "";
      });

    expect([...checkboxTestIds].sort()).toEqual(
      ALL_EVENT_TYPES.map((eventType: string): string => {
        return `feed-options-event-type-${eventType}`;
      }).sort(),
    );

    type GetRowIcon = (eventType: string) => string | null;

    const getRowIcon: GetRowIcon = (eventType: string): string | null => {
      return (
        within(panel)
          .getByTestId(`feed-options-event-type-${eventType}`)
          .closest("label")
          ?.querySelector("[data-icon]")
          ?.getAttribute("data-icon") || null
      );
    };

    // The feed's own answer wins...
    expect(getRowIcon(ownIconEventType)).toBe(ownIcon);

    // ...and "no answer" falls back to the shared rules, row by row.
    for (const eventType of ALL_EVENT_TYPES) {
      if (eventType === ownIconEventType) {
        continue;
      }

      expect(getRowIcon(eventType)).toBe(getIconForEventType(eventType));
    }
  });
});

/*
 * Filter & Sort is applied by the API, not to the rows already loaded, and
 * the event type filter is keyed by the same string column as the icon - so
 * a typo there would filter on a column that does not exist.
 */
describe("ResourceFeed - Filter & Sort", () => {
  test("puts Filter & Sort first in the header, and an untouched feed sends exactly the query it always sent", async () => {
    renderFeed();

    await waitFor(() => {
      expect(mockGetListCalls.length).toBe(1);
    });

    expect(
      Object.keys(mockGetListCalls[0]!["query"] as Record<string, unknown>),
    ).toEqual(["kubernetesClusterId"]);

    const optionsButton: HTMLElement = getFilterAndSortButton();
    const refreshButton: HTMLElement = screen.getByRole("button", {
      name: "Refresh",
    });

    expect(
      optionsButton.compareDocumentPosition(refreshButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    /*
     * The state behind the button is read out as its description - and shown
     * as its tooltip - so the reader need not open it to know what the feed
     * is showing.
     */
    const summary: string = getExpectedSummary(DEFAULT_FEED_OPTIONS);

    expect(summary.length).toBeGreaterThan(0);
    expect(optionsButton).toHaveAccessibleDescription(summary);
    expect(optionsButton).toHaveAttribute("title", summary);

    // An untouched feed: the funnel, no count, and nothing remembered.
    expect(getTriggerIcon()).toBe(IconProp.Filter);
    expect(screen.queryByTestId("feed-options-count")).not.toBeInTheDocument();
    expect(getStoredSortOrderKeys()).toEqual([]);
  });

  test("filters on the feed's own event type column and says so when nothing matches", async () => {
    renderFeed();

    await waitFor(() => {
      expect(screen.getByText(NO_ITEMS_MESSAGE)).toBeInTheDocument();
    });

    const panel: HTMLElement = openFilterAndSort();

    fireEvent.click(
      within(panel).getByTestId(
        `feed-options-event-type-${KubernetesClusterFeedEventType.OwnerUserAdded}`,
      ),
    );

    await waitFor(() => {
      expect(mockGetListCalls).toHaveLength(2);
    });

    const request: GetListRequest = mockGetListCalls[1]!;
    const query: Record<string, unknown> = request["query"] as Record<
      string,
      unknown
    >;
    const eventTypeFilter: unknown = query["kubernetesClusterFeedEventType"];

    expect(query["kubernetesClusterId"]).toBe(CLUSTER_ID);
    expect(eventTypeFilter).toBeInstanceOf(Includes);
    expect((eventTypeFilter as Includes).values).toEqual([
      KubernetesClusterFeedEventType.OwnerUserAdded,
    ]);
    expect(request["skip"]).toBe(0);
    expect(request["limit"]).toBe(DEFAULT_LIMIT);

    /*
     * An empty filtered feed must not claim the cluster has no history at
     * all.
     */
    expect(
      await screen.findByText(FILTERED_FEED_NO_ITEMS_MESSAGE),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_ITEMS_MESSAGE)).not.toBeInTheDocument();

    /*
     * The trigger keeps its name with a count on it, and its description now
     * says the feed is narrowed - to one of this feed's event types.
     */
    const optionsButton: HTMLElement = getFilterAndSortButton();

    expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^1$/);
    expect(optionsButton).toHaveAccessibleDescription(
      getExpectedSummary({
        sortOrder: SortOrder.Descending,
        eventTypes: [KubernetesClusterFeedEventType.OwnerUserAdded],
      }),
    );
    expect(optionsButton).not.toHaveAccessibleDescription(
      getExpectedSummary(DEFAULT_FEED_OPTIONS),
    );
  });

  test("Oldest first re-reads the first window in ascending order, draws it exactly as the API returned it, and remembers it under this feed's key only", async () => {
    // sort-entry-0 is the newest event, sort-entry-11 the oldest.
    const newestFirst: Array<KubernetesClusterFeed> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): KubernetesClusterFeed => {
        return feedItem(
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          `sort-entry-${index}`,
          new Date(Date.UTC(2024, 0, 12 - index)),
        );
      },
    );
    const oldestFirst: Array<KubernetesClusterFeed> = [
      ...newestFirst,
    ].reverse();

    /*
     * The stub answers each order with its own rows, as the API would. The
     * ascending window (entry-11 down to entry-2) is neither the newest window
     * reversed nor anything a client-side sort by time would draw, so the
     * page can only show it by showing the API's rows as they came.
     */
    mockGetListResponse = (request: GetListRequest): Promise<unknown> => {
      const sort: Record<string, unknown> = request["sort"] as Record<
        string,
        unknown
      >;
      const rows: Array<KubernetesClusterFeed> =
        sort["postedAt"] === SortOrder.Ascending ? oldestFirst : newestFirst;

      return Promise.resolve({
        data: rows.slice(0, request["limit"] as number),
        count: rows.length,
      });
    };

    type GetDrawnEntries = () => Array<string>;

    const getDrawnEntries: GetDrawnEntries = (): Array<string> => {
      return screen
        .getAllByText(/sort-entry-/)
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        });
    };

    type GetMarkdown = (items: Array<KubernetesClusterFeed>) => Array<string>;

    const getMarkdown: GetMarkdown = (
      items: Array<KubernetesClusterFeed>,
    ): Array<string> => {
      return items.map((item: KubernetesClusterFeed): string => {
        return item.feedInfoInMarkdown || "";
      });
    };

    renderFeed();
    await waitFor(() => {
      expect(screen.getAllByText(/sort-entry-/)).toHaveLength(DEFAULT_LIMIT);
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => {
      expect(screen.getAllByText(/sort-entry-/)).toHaveLength(12);
    });

    // Nothing is remembered until the reader changes something.
    expect(getStoredSortOrderKeys()).toEqual([]);

    const panel: HTMLElement = openFilterAndSort();

    fireEvent.click(
      within(panel).getByTestId(`feed-options-sort-${SortOrder.Ascending}`),
    );

    await waitForFeed(3);

    // Reversing the loaded rows would show the newest twelve upside down.
    const request: GetListRequest = mockGetListCalls[2]!;

    expect(request["sort"]).toEqual({
      postedAt: SortOrder.Ascending,
    });
    expect(request["skip"]).toBe(0);
    expect(request["limit"]).toBe(DEFAULT_LIMIT);
    expect(Object.keys(getQuery(request))).toEqual([RESOURCE_ID_COLUMN]);

    await waitFor(() => {
      expect(getDrawnEntries()).toEqual(
        getMarkdown(oldestFirst.slice(0, DEFAULT_LIMIT)),
      );
    });

    /*
     * The trigger says so without being opened: the sort glyph instead of the
     * funnel, and a description that leads with the new order.
     */
    expect(getTriggerIcon()).toBe(IconProp.BarsArrowUp);
    expect(getFilterAndSortButton()).toHaveAccessibleDescription(
      getExpectedSummary({ sortOrder: SortOrder.Ascending, eventTypes: [] }),
    );

    /*
     * Remembered under this feed's own key, and only there: another
     * product's feed must not open oldest first because of this one.
     */
    const storageKey: string = getSortOrderStorageKey(EVENT_TYPE_COLUMN);

    expect(window.localStorage.getItem(storageKey)).toBe(SortOrder.Ascending);
    expect(
      window.localStorage.getItem(
        getSortOrderStorageKey("dockerHostFeedEventType"),
      ),
    ).toBeNull();
    expect(getStoredSortOrderKeys()).toEqual([storageKey]);
  });

  test("drops the event type filter when the feed moves to another cluster, and keeps the sort order", async () => {
    /*
     * The dashboard moves between clusters without remounting the feed. The
     * filter was chosen for one cluster's investigation, so the next cluster
     * must start unfiltered - from its very first request, or the API is
     * asked for the old cluster's filter and the reader briefly sees a feed
     * with events missing. The sort order is a preference and stays.
     */
    const clusterA: ObjectID = CLUSTER_ID;
    const clusterB: ObjectID = ObjectID.generate();
    const tickedEventType: string =
      KubernetesClusterFeedEventType.OwnerUserAdded;

    type ExpectUnfilteredOldestFirst = (
      request: GetListRequest,
      resourceId: ObjectID,
    ) => void;

    const expectUnfilteredOldestFirst: ExpectUnfilteredOldestFirst = (
      request: GetListRequest,
      resourceId: ObjectID,
    ): void => {
      const query: Record<string, unknown> = getQuery(request);

      expect(Object.keys(query)).toEqual([RESOURCE_ID_COLUMN]);
      expect(String(query[RESOURCE_ID_COLUMN])).toBe(resourceId.toString());
      expect(request["sort"]).toEqual({ postedAt: SortOrder.Ascending });
      expect(request["skip"]).toBe(0);
      expect(request["limit"]).toBe(DEFAULT_LIMIT);
    };

    type ExpectNothingTicked = () => void;

    // Reopens the panel on the feed as it is now, and closes it again.
    const expectNothingTicked: ExpectNothingTicked = (): void => {
      const reopenedPanel: HTMLElement = openFilterAndSort();
      const checkboxes: Array<HTMLElement> =
        within(reopenedPanel).getAllByRole("checkbox");

      expect(checkboxes).toHaveLength(ALL_EVENT_TYPES.length);

      for (const checkbox of checkboxes) {
        expect(checkbox).not.toBeChecked();
      }

      expect(
        within(reopenedPanel).getByTestId(
          `feed-options-sort-${SortOrder.Ascending}`,
        ),
      ).toHaveAttribute("aria-checked", "true");

      closeFilterAndSort();
    };

    const view: ReturnType<typeof render> = renderFeed(clusterA);
    await waitForFeed(1);

    // On cluster A: oldest first, then only owners being added.
    const panel: HTMLElement = openFilterAndSort();

    fireEvent.click(
      within(panel).getByTestId(`feed-options-sort-${SortOrder.Ascending}`),
    );
    await waitForFeed(2);

    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: FEED_OPTIONS_TEXT.panelLabel }),
      ).getByTestId(`feed-options-event-type-${tickedEventType}`),
    );
    await waitForFeed(3);

    const filteredRequest: GetListRequest = mockGetListCalls[2]!;
    const eventTypeFilter: unknown =
      getQuery(filteredRequest)[EVENT_TYPE_COLUMN];

    expect(eventTypeFilter).toBeInstanceOf(Includes);
    expect((eventTypeFilter as Includes).values).toEqual([tickedEventType]);
    expect(filteredRequest["sort"]).toEqual({ postedAt: SortOrder.Ascending });
    expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^1$/);

    closeFilterAndSort();

    // To cluster B.
    view.rerender(getFeedElement(clusterB));
    await waitForFeed(4);

    const requestsForB: Array<GetListRequest> = getRequestsFor(clusterB);

    /*
     * One request for B, and it was already unfiltered - not a filtered one
     * that a later reset then replaced.
     */
    expect(requestsForB).toHaveLength(1);
    expectUnfilteredOldestFirst(requestsForB[0]!, clusterB);

    // An empty unfiltered feed says the cluster has no history, not "no match".
    expect(await screen.findByText(NO_ITEMS_MESSAGE)).toBeInTheDocument();
    expect(
      screen.queryByText(FILTERED_FEED_NO_ITEMS_MESSAGE),
    ).not.toBeInTheDocument();

    expect(screen.queryByTestId("feed-options-count")).not.toBeInTheDocument();
    expect(getTriggerIcon()).toBe(IconProp.BarsArrowUp);
    expect(getFilterAndSortButton()).toHaveAccessibleDescription(
      getExpectedSummary({ sortOrder: SortOrder.Ascending, eventTypes: [] }),
    );
    expectNothingTicked();

    // Nothing asked B for the old filter afterwards either.
    expect(getRequestsFor(clusterB)).toHaveLength(1);

    // The sort order is still remembered, for this feed only.
    expect(getStoredSortOrderKeys()).toEqual([
      getSortOrderStorageKey(EVENT_TYPE_COLUMN),
    ]);
    expect(
      window.localStorage.getItem(getSortOrderStorageKey(EVENT_TYPE_COLUMN)),
    ).toBe(SortOrder.Ascending);

    // Back to cluster A: its old filter does not come back with it.
    const requestCountBeforeReturn: number = mockGetListCalls.length;

    view.rerender(getFeedElement(clusterA));
    await waitForFeed(requestCountBeforeReturn + 1);

    const requestsAfterReturn: Array<GetListRequest> = mockGetListCalls.slice(
      requestCountBeforeReturn,
    );

    expect(requestsAfterReturn).toHaveLength(1);
    expectUnfilteredOldestFirst(requestsAfterReturn[0]!, clusterA);

    expect(await screen.findByText(NO_ITEMS_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("feed-options-count")).not.toBeInTheDocument();
    expect(getFilterAndSortButton()).toHaveAccessibleDescription(
      getExpectedSummary({ sortOrder: SortOrder.Ascending, eventTypes: [] }),
    );
    expectNothingTicked();
  });
});

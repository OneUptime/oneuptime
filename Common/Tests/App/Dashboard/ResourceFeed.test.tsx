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

import ResourceFeed, {
  getIconForEventType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceFeed/ResourceFeed";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { Green500 } from "../../../Types/BrandColors";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";

/*
 * One component serves all ten resource feeds, parameterised by the two
 * column names that differ between them. That is what makes it worth testing
 * once and worth testing carefully: the query column and the event-type column
 * arrive as strings, so a typo in either compiles perfectly and produces an
 * empty feed (wrong query column) or an every-item-looks-the-same timeline
 * (wrong event-type column).
 */

const CLUSTER_ID: ObjectID = ObjectID.generate();

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
      title="Kubernetes Cluster Feed"
      description="Everything that has happened to this Kubernetes cluster."
      noItemsMessage="No activity has been recorded for this Kubernetes cluster yet."
    />
  );
}

function renderFeed(
  resourceId: ObjectID = CLUSTER_ID,
): ReturnType<typeof render> {
  return render(getFeedElement(resourceId));
}

beforeEach(() => {
  mockGetListCalls.length = 0;
  mockGetListResponse = (): Promise<unknown> => {
    return Promise.resolve({ data: [], count: 0 });
  };
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

    await waitFor(() => {
      expect(
        screen.getByText(/cluster was created automatically/),
      ).toBeInTheDocument();
    });

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

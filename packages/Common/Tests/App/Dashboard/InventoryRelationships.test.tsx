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
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The inventory item page's Connections card. It used to download both
 * directions of the item's relationships itself — 10,000 rows each, sorted
 * by recency — and resolve every other end with one IN list, so a cluster,
 * namespace or node with more connections than that was silently cut off.
 * It now asks the server's all-time Topology endpoint, which counts every
 * connection the inventory holds and returns the first rows of each
 * section. Pinned here against a fake API behind the real request and
 * decoding code:
 *
 *   - one all-time request per item: the key and type, never a range;
 *   - exact totals per section ("N+" when the server stopped counting);
 *   - rows phrased from this item's end, linking to the other item, and
 *     ends no longer in inventory shown by key, unlinked;
 *   - "Show more" appending the next page and moving focus to it, a list
 *     that changed underneath offering a reload, per-section failures;
 *   - a failed load that can be retried, or reloaded when outdated;
 *   - never the previous item's rows under another item.
 */

const postMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "project-1" };
      },
    },
  };
});
jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string) => {
          return value;
        },
        translateValue: (value: React.ReactNode) => {
          return value;
        },
      };
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import InventoryRelationships, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryRelationships";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiLimits,
  TopologyConnectionRowJSON,
  TopologyConnectionSection,
  TopologyConnectionSectionJSON,
  TopologyEntityAllTimeConnectionsResponseJSON,
  TopologyEntityAllTimeResponseJSON,
  TopologyEntityDetailJSON,
} from "../../../Types/Topology/TopologyApi";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b2f5b1c-0000-4000-8000-000000000001",
);
const NAMESPACE_ID: string = "1a1a0000-0000-4000-8000-000000000001";
const PAGE: number = TopologyApiLimits.EntityOtherRows;

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  options: { signal?: AbortSignal };
}

type Answer = JSONObject | HTTPErrorResponse | Promise<JSONObject>;

interface Deferred {
  promise: Promise<JSONObject>;
  resolve: (value: JSONObject) => void;
}

function deferred(): Deferred {
  let resolve: (value: JSONObject) => void = () => {
    return undefined;
  };
  const promise: Promise<JSONObject> = new Promise<JSONObject>(
    (res: (value: JSONObject) => void) => {
      resolve = res;
    },
  );
  return { promise, resolve };
}

function asJSON(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function podId(index: number): string {
  return `2b2b0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function entityRow(
  overrides: Partial<TopologyEntityDetailJSON> = {},
): TopologyEntityDetailJSON {
  return {
    id: NAMESPACE_ID,
    key: "ns-payments",
    type: EntityType.KubernetesNamespace,
    name: "payments",
    source: "discovered",
    lastSeenAt: null,
    firstSeenAt: null,
    resourceType: null,
    resourceId: null,
    identifyingAttributes: null,
    descriptiveAttributes: null,
    ...overrides,
  };
}

function connection(
  overrides: Partial<TopologyConnectionRowJSON>,
): TopologyConnectionRowJSON {
  return {
    relationshipType: "part-of",
    direction: "in",
    otherKey: "other",
    otherKnown: true,
    otherId: podId(0),
    otherName: "Other",
    otherType: EntityType.KubernetesPod,
    callCount: null,
    errorCount: null,
    avgDurationMs: null,
    lastSeenAt: null,
    ...overrides,
  };
}

/* A pod that is part of the namespace. */
function pod(index: number): TopologyConnectionRowJSON {
  return connection({
    otherKey: `pod-${index}`,
    otherId: podId(index),
    otherName: `api-pod-${index}`,
  });
}

function pods(from: number, to: number): Array<TopologyConnectionRowJSON> {
  const rows: Array<TopologyConnectionRowJSON> = [];
  for (let index: number = from; index <= to; index++) {
    rows.push(pod(index));
  }
  return rows;
}

function sectionOf(
  rows: Array<TopologyConnectionRowJSON>,
  overrides: Partial<TopologyConnectionSectionJSON> = {},
): TopologyConnectionSectionJSON {
  return {
    total: rows.length,
    unknownTotal: 0,
    rows: rows,
    nextOffset: null,
    ...overrides,
  };
}

const EMPTY: Record<TopologyConnectionSection, TopologyConnectionSectionJSON> =
  {
    calls: sectionOf([]),
    calledBy: sectionOf([]),
    runsOn: sectionOf([]),
    related: sectionOf([]),
  };

function entityResponse(
  entity: TopologyEntityDetailJSON | null,
  sections: Partial<
    Record<TopologyConnectionSection, TopologyConnectionSectionJSON>
  > = {},
  isScanLimited: boolean = false,
): JSONObject {
  const response: TopologyEntityAllTimeResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    generatedAt: "2026-09-26T10:15:00.000Z",
    entity: entity,
    sections: { ...EMPTY, ...sections },
    isScanLimited: isScanLimited,
  };
  return asJSON(response);
}

function pageResponse(
  section: TopologyConnectionSection,
  connections: TopologyConnectionSectionJSON,
): JSONObject {
  const response: TopologyEntityAllTimeConnectionsResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    generatedAt: "2026-09-26T10:15:00.000Z",
    section: section,
    connections: connections,
    isScanLimited: false,
  };
  return asJSON(response);
}

/*
 * A namespace with far more pods than one page: the first PAGE of 57 rows,
 * one of them long gone from inventory.
 */
const HUB_TOTAL: number = PAGE * 2 + 7;

function hubResponse(): JSONObject {
  return entityResponse(entityRow(), {
    calledBy: sectionOf([
      connection({
        relationshipType: "depends-on",
        otherKey: "svc-billing",
        otherId: "3c3c0000-0000-4000-8000-000000000001",
        otherName: "billing",
        otherType: EntityType.Service,
        lastSeenAt: Date.parse("2026-09-26T09:00:00.000Z"),
      }),
    ]),
    related: sectionOf(
      [
        connection({
          relationshipType: "part-of",
          direction: "out",
          otherKey: "cluster-prod",
          otherId: "4d4d0000-0000-4000-8000-000000000001",
          otherName: "prod",
          otherType: EntityType.KubernetesCluster,
        }),
        ...pods(1, PAGE - 2),
        connection({
          otherKey: "0123456789abcdef0123",
          otherKnown: false,
          otherId: null,
          otherName: null,
          otherType: null,
        }),
      ],
      { total: HUB_TOTAL, unknownTotal: 4, nextOffset: PAGE },
    ),
  });
}

function isPageRequest(request: PostRequest): boolean {
  return request.url.toString().endsWith("/entity/all-time/connections");
}

function requests(): Array<PostRequest> {
  return postMock.mock.calls.map((call: Array<unknown>): PostRequest => {
    return call[0] as PostRequest;
  });
}

function pageRequests(): Array<PostRequest> {
  return requests().filter(isPageRequest);
}

/* Answer each request by what it asks for, not by the order it came in. */
function serve(answer: (request: PostRequest) => Answer): void {
  postMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: PostRequest = args[0] as PostRequest;
    const result: Answer = answer(request);
    if (result instanceof HTTPErrorResponse) {
      return result;
    }
    return new HTTPResponse<JSONObject>(200, await result, {});
  });
}

function serveHub(page?: (request: PostRequest) => Answer): void {
  serve((request: PostRequest): Answer => {
    if (isPageRequest(request)) {
      if (!page) {
        throw new Error("No page is served in this test.");
      }
      return page(request);
    }
    return hubResponse();
  });
}

function renderPanel(overrides: Partial<ComponentProps> = {}): RenderResult {
  return render(
    <InventoryRelationships
      entityKey="ns-payments"
      entityType={EntityType.KubernetesNamespace}
      {...overrides}
    />,
  );
}

async function waitForConnections(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
}

function relatedRows(): Array<HTMLElement> {
  return within(
    screen.getByTestId("inventory-connections-related"),
  ).getAllByRole("listitem");
}

beforeEach(() => {
  postMock.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("loading an item's connections", () => {
  test("asks the all-time endpoint once, with the key and type and never a range", async () => {
    const answer: Deferred = deferred();
    serve((): Answer => {
      return answer.promise;
    });

    renderPanel();

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    await act(async () => {
      answer.resolve(hubResponse());
    });
    await waitForConnections();

    expect(requests()).toHaveLength(1);
    expect(requests()[0]!.url.toString()).toMatch(
      /\/telemetry\/topology\/entity\/all-time$/,
    );
    expect(requests()[0]!.data).toEqual({
      entityKey: "ns-payments",
      entityType: EntityType.KubernetesNamespace,
    });
    expect(requests()[0]!.options.signal).toBeInstanceOf(AbortSignal);
  });

  test("every non-empty section shows its exact total, in the drawer's order", async () => {
    serveHub();
    renderPanel();
    await waitForConnections();

    const headings: Array<string> = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });
    expect(headings).toEqual([
      "Called by (1)",
      `Related (${HUB_TOTAL.toLocaleString()})`,
    ]);
    // Sections with nothing in them are not rendered at all.
    expect(
      screen.queryByTestId("inventory-connections-calls"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("inventory-connections-runsOn"),
    ).not.toBeInTheDocument();
    expect(relatedRows()).toHaveLength(PAGE);
    expect(
      within(screen.getByTestId("inventory-connections-related")).getByText(
        `Showing ${PAGE} of ${HUB_TOTAL}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("inventory-connections-scan-limited"),
    ).not.toBeInTheDocument();
  });

  test("a total the server stopped counting reads as a lower bound", async () => {
    serve((): Answer => {
      return entityResponse(
        entityRow(),
        {
          related: sectionOf(pods(1, PAGE), {
            total: TopologyApiLimits.EntityConnectionScanLimit,
            nextOffset: PAGE,
          }),
        },
        true,
      );
    });
    renderPanel();
    await waitForConnections();

    const total: string = `${TopologyApiLimits.EntityConnectionScanLimit.toLocaleString()}+`;
    expect(
      screen.getByRole("heading", { name: `Related (${total})` }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Showing ${PAGE} of ${total}`)).toBeInTheDocument();
    expect(
      screen.getByTestId("inventory-connections-scan-limited"),
    ).toHaveTextContent("totals are lower bounds");
  });

  test("an item with no connections explains where they come from", async () => {
    serve((): Answer => {
      return entityResponse(entityRow());
    });
    renderPanel();
    await waitForConnections();

    expect(
      screen.getByText(/Nothing is connected to this item yet/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  test("an item the inventory no longer has says so", async () => {
    serve((): Answer => {
      return entityResponse(null);
    });
    renderPanel();
    await waitForConnections();

    expect(
      screen.getByText(/This item is no longer in the inventory/),
    ).toBeInTheDocument();
  });
});

describe("each row", () => {
  test("reads from this item's end and links to the item at the other end", async () => {
    serveHub();
    renderPanel();
    await waitForConnections();

    const [cluster, firstPod] = relatedRows();
    // The stored edge is ns → cluster (part-of) and pod → ns (part-of).
    expect(cluster).toHaveTextContent("is part of");
    expect(firstPod).toHaveTextContent("contains");

    const clusterLink: HTMLElement = within(cluster!).getByRole("link", {
      name: "prod",
    });
    expect(clusterLink.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID.toString()}/inventory/item/4d4d0000-0000-4000-8000-000000000001`,
    );
    expect(
      within(cluster!).getByText("Kubernetes Cluster"),
    ).toBeInTheDocument();

    const caller: HTMLElement = within(
      screen.getByTestId("inventory-connections-calledBy"),
    ).getByRole("listitem");
    expect(caller).toHaveTextContent("is depended on by");
    expect(
      within(caller).getByRole("link", { name: "billing" }),
    ).toBeInTheDocument();
  });

  test("an end no longer in inventory shows its key, unlinked, and the section counts it", async () => {
    serveHub();
    renderPanel();
    await waitForConnections();

    const gone: HTMLElement = relatedRows()[PAGE - 1]!;
    expect(within(gone).queryByRole("link")).not.toBeInTheDocument();
    // The first 16 characters of the key: the connection is still real.
    expect(within(gone).getByText("0123456789abcdef")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("inventory-connections-related")).getByText(
        "4 no longer in inventory",
      ),
    ).toBeInTheDocument();
  });
});

describe("show more", () => {
  test("fetches the next page of that section from where it stopped, appends it and focuses its first row", async () => {
    serveHub((request: PostRequest): Answer => {
      const offset: number = request.data["offset"] as number;
      return pageResponse(
        "related",
        sectionOf(pods(offset, offset + PAGE - 1), {
          total: HUB_TOTAL,
          unknownTotal: 4,
          nextOffset: offset + PAGE,
        }),
      );
    });
    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Related" }));

    await waitFor(() => {
      expect(relatedRows()).toHaveLength(PAGE * 2);
    });
    expect(pageRequests()).toHaveLength(1);
    expect(pageRequests()[0]!.url.toString()).toMatch(
      /\/telemetry\/topology\/entity\/all-time\/connections$/,
    );
    expect(pageRequests()[0]!.data).toEqual({
      entityKey: "ns-payments",
      entityType: EntityType.KubernetesNamespace,
      section: "related",
      offset: PAGE,
      limit: PAGE,
    });
    expect(
      screen.getByText(`Showing ${PAGE * 2} of ${HUB_TOTAL}`),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(relatedRows()[PAGE]);
    });
    // Only that section was fetched again; the item was not.
    expect(requests()).toHaveLength(2);
  });

  test("the last page takes the control away", async () => {
    serveHub((): Answer => {
      return pageResponse(
        "related",
        sectionOf(pods(PAGE, HUB_TOTAL - 1), {
          total: HUB_TOTAL,
          unknownTotal: 4,
          nextOffset: null,
        }),
      );
    });
    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Related" }));

    await waitFor(() => {
      expect(relatedRows()).toHaveLength(HUB_TOTAL);
    });
    expect(
      screen.queryByRole("button", { name: "Show more: Related" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("inventory-connections-related-changed"),
    ).not.toBeInTheDocument();
  });

  test("is busy while its page loads, and a second click asks nothing more", async () => {
    const answer: Deferred = deferred();
    serveHub((): Answer => {
      return answer.promise;
    });
    renderPanel();
    await waitForConnections();

    const button: HTMLElement = screen.getByRole("button", {
      name: "Show more: Related",
    });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Loading…");
    fireEvent.click(button);
    expect(pageRequests()).toHaveLength(1);

    await act(async () => {
      answer.resolve(
        pageResponse(
          "related",
          sectionOf(pods(PAGE, PAGE * 2 - 1), {
            total: HUB_TOTAL,
            unknownTotal: 4,
            nextOffset: PAGE * 2,
          }),
        ),
      );
    });
    expect(
      screen.getByRole("button", { name: "Show more: Related" }),
    ).not.toBeDisabled();
  });

  test("a list that changed while paging says so, and its reload replaces the section from the start", async () => {
    serveHub((request: PostRequest): Answer => {
      if (request.data["offset"] === 0) {
        return pageResponse(
          "related",
          sectionOf(pods(1, HUB_TOTAL - 10), {
            total: HUB_TOTAL - 10,
            nextOffset: null,
          }),
        );
      }
      // Ten pods were pruned above the offset: the list shrank under us.
      return pageResponse(
        "related",
        sectionOf(pods(PAGE + 10, PAGE * 2 + 9), {
          total: HUB_TOTAL - 10,
          unknownTotal: 4,
          nextOffset: PAGE * 2,
        }),
      );
    });
    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Related" }));

    const reload: HTMLElement = await screen.findByRole("button", {
      name: "Reload list: Related",
    });
    expect(
      screen.getByTestId("inventory-connections-related-changed"),
    ).toHaveTextContent("This list changed while you were browsing.");
    // The rows that did arrive are still shown.
    expect(relatedRows()).toHaveLength(PAGE * 2);

    fireEvent.click(reload);

    await waitFor(() => {
      expect(relatedRows()).toHaveLength(HUB_TOTAL - 10);
    });
    expect(pageRequests()[1]!.data).toEqual({
      entityKey: "ns-payments",
      entityType: EntityType.KubernetesNamespace,
      section: "related",
      offset: 0,
      limit: Math.min(
        TopologyApiLimits.EntityConnectionsPageSizeMax,
        PAGE * 2 + PAGE,
      ),
    });
    expect(
      screen.queryByTestId("inventory-connections-related-changed"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: `Related (${(HUB_TOTAL - 10).toLocaleString()})`,
      }),
    ).toBeInTheDocument();
  });

  test("a failed page says so, keeps what is shown, and can be tried again", async () => {
    let fail: boolean = true;
    serveHub((): Answer => {
      if (fail) {
        return new HTTPErrorResponse(
          500,
          { message: "The database is having a moment." },
          {},
        );
      }
      return pageResponse(
        "related",
        sectionOf(pods(PAGE, PAGE * 2 - 1), {
          total: HUB_TOTAL,
          unknownTotal: 4,
          nextOffset: PAGE * 2,
        }),
      );
    });
    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Related" }));

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load more connections. The database is having a moment.",
    );
    expect(relatedRows()).toHaveLength(PAGE);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Show more: Related" }));
    await waitFor(() => {
      expect(relatedRows()).toHaveLength(PAGE * 2);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a server that no longer speaks this format offers a page reload instead", async () => {
    const reload: SpyInstance<() => void> = jest
      .spyOn(Navigation, "reload")
      .mockImplementation(() => {
        return undefined;
      });
    serveHub((): Answer => {
      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    });
    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Related" }));

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Topology was updated. Reload the page.");
    expect(
      screen.queryByRole("button", { name: "Show more: Related" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("a failed load", () => {
  test("says what went wrong and asks again on refresh", async () => {
    let fail: boolean = true;
    serve((): Answer => {
      if (fail) {
        return new HTTPErrorResponse(
          500,
          { message: "Postgres is unavailable." },
          {},
        );
      }
      return hubResponse();
    });
    renderPanel();

    expect(
      await screen.findByText(
        "Could not load this item's connections. Postgres is unavailable.",
      ),
    ).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(relatedRows()).toHaveLength(PAGE);
    });
    expect(requests()).toHaveLength(2);
  });

  test("a busy server says to try again in a moment", async () => {
    serve((): Answer => {
      return new HTTPErrorResponse(429, { message: "Too many requests" }, {});
    });
    renderPanel();

    expect(
      await screen.findByText(
        "Could not load this item's connections. The topology service is busy. Try again in a moment.",
      ),
    ).toBeInTheDocument();
  });

  test("an outdated bundle reloads the page instead of asking again", async () => {
    const reload: SpyInstance<() => void> = jest
      .spyOn(Navigation, "reload")
      .mockImplementation(() => {
        return undefined;
      });
    serve((): Answer => {
      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    });
    renderPanel();

    await screen.findByText(
      "Could not load this item's connections. Topology was updated. Reload the page.",
    );
    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(requests()).toHaveLength(1);
  });
});

describe("moving to another item", () => {
  test("drops the previous item's request and never shows its rows", async () => {
    const first: Deferred = deferred();
    serve((request: PostRequest): Answer => {
      if (request.data["entityKey"] === "ns-payments") {
        return first.promise;
      }
      return entityResponse(entityRow({ key: "ns-orders", name: "orders" }), {
        related: sectionOf([pod(900)]),
      });
    });

    const rendered: RenderResult = renderPanel();
    rendered.rerender(
      <InventoryRelationships
        entityKey="ns-orders"
        entityType={EntityType.KubernetesNamespace}
      />,
    );

    await waitFor(() => {
      expect(relatedRows()).toHaveLength(1);
    });
    expect(requests()[0]!.options.signal!.aborted).toBe(true);

    // The first item's answer arrives late: it is ignored.
    await act(async () => {
      first.resolve(hubResponse());
    });
    expect(relatedRows()).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "api-pod-900" }),
    ).toBeInTheDocument();
  });
});

describe("the card", () => {
  test("offers the full map, and drops its frame when the page has its own", async () => {
    serveHub();
    const rendered: RenderResult = renderPanel({
      fullMapRoute: new Route("/dashboard/project/topology?focus=ns-payments"),
    });
    await waitForConnections();

    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open full map" }).getAttribute("href"),
    ).toBe("/dashboard/project/topology?focus=ns-payments");

    rendered.unmount();
    renderPanel({ showCard: false });
    await waitForConnections();
    expect(screen.queryByText("Connections")).not.toBeInTheDocument();
    expect(relatedRows()).toHaveLength(PAGE);
  });
});

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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The topology detail drawer. It opens on what the map already knows (the
 * header renders at once), then asks the server for the entity's full row
 * and its connections — classified, ordered and counted over the whole
 * inventory — and pages further rows on "Show more". Pinned here against a
 * fake Topology API behind the real request and decoding code:
 *
 *   - the header before the data, a busy status while loading;
 *   - exact server totals ("Calls (N)", "N+" when the scan stopped early),
 *     server order, and paging that appends and moves focus;
 *   - connections to resources nothing reported as static text;
 *   - a key no item has any more, failures with an in-drawer retry;
 *   - never a row fetched for another entity or range;
 *   - best-effort links resolved once, from the full row;
 *   - where each row leads.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
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
jest.mock("../../../UI/Components/SideOver/SideOver", () => {
  return {
    __esModule: true,
    SideOverSize: { Small: "small" },
    default: (props: {
      title: string;
      description: string;
      children: React.ReactNode;
    }) => {
      return (
        <section aria-label={props.title}>
          <p data-testid="drawer-description">{props.description}</p>
          {props.children}
        </section>
      );
    },
  };
});

import EntityDetailPanel, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import { EntityDetailTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyConnectionRowJSON,
  TopologyConnectionSection,
  TopologyConnectionSectionJSON,
  TopologyEntityConnectionsResponseJSON,
  TopologyEntityDetailJSON,
  TopologyEntityResponseJSON,
} from "../../../Types/Topology/TopologyApi";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b2f5b1c-0000-4000-8000-000000000001",
);
const SERVICE_ID: string = "5e7f0000-0000-4000-8000-000000000001";
const ITEM_ID: string = "1a1a0000-0000-4000-8000-000000000001";
const RANGE_START: Date = new Date("2026-09-26T10:00:00.000Z");
const LATER_RANGE_START: Date = new Date("2026-09-26T11:00:00.000Z");

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  options: { signal?: AbortSignal };
}

type Answer = JSONObject | HTTPErrorResponse | Promise<JSONObject>;

interface Deferred {
  promise: Promise<JSONObject>;
  resolve: (value: JSONObject) => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve: (value: JSONObject) => void = () => {
    return undefined;
  };
  let reject: (error: unknown) => void = () => {
    return undefined;
  };
  const promise: Promise<JSONObject> = new Promise<JSONObject>(
    (res: (value: JSONObject) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

function asJSON(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function entityRow(
  overrides: Partial<TopologyEntityDetailJSON> = {},
): TopologyEntityDetailJSON {
  return {
    id: ITEM_ID,
    key: "svc",
    type: EntityType.Service,
    name: "Checkout API",
    source: "telemetry",
    lastSeenAt: Date.parse("2026-09-26T10:14:00.000Z"),
    firstSeenAt: Date.parse("2026-08-01T00:00:00.000Z"),
    resourceType: "Service",
    resourceId: SERVICE_ID,
    identifyingAttributes: { "service.name": "Checkout API" },
    descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
    ...overrides,
  };
}

function connection(
  overrides: Partial<TopologyConnectionRowJSON>,
): TopologyConnectionRowJSON {
  return {
    relationshipType: "depends-on",
    direction: "out",
    otherKey: "other",
    otherKnown: true,
    otherName: "Other",
    otherType: EntityType.Service,
    callCount: null,
    errorCount: null,
    avgDurationMs: null,
    lastSeenAt: null,
    ...overrides,
  };
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

function pod(index: number): TopologyConnectionRowJSON {
  return connection({
    relationshipType: "runs-on",
    otherKey: `pod-${index}`,
    otherName: `checkout-pod-${index}`,
    otherType: EntityType.KubernetesPod,
  });
}

function pods(from: number, to: number): Array<TopologyConnectionRowJSON> {
  const rows: Array<TopologyConnectionRowJSON> = [];
  for (let index: number = from; index <= to; index++) {
    rows.push(pod(index));
  }
  return rows;
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
  const response: TopologyEntityResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: RANGE_START.toISOString(),
    generatedAt: "2026-09-26T10:15:00.000Z",
    entity: entity,
    sections: { ...EMPTY, ...sections },
    isScanLimited: isScanLimited,
  };
  return asJSON(response);
}

function connectionsResponse(
  section: TopologyConnectionSection,
  connections: TopologyConnectionSectionJSON,
  isScanLimited: boolean = false,
): JSONObject {
  const response: TopologyEntityConnectionsResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: RANGE_START.toISOString(),
    generatedAt: "2026-09-26T10:15:00.000Z",
    section: section,
    connections: connections,
    isScanLimited: isScanLimited,
  };
  return asJSON(response);
}

/* The service the drawer usually shows: calls, callers and where it runs. */
function checkoutResponse(): JSONObject {
  return entityResponse(entityRow(), {
    calls: sectionOf([
      connection({
        otherKey: "db",
        otherName: "Orders database",
        otherType: EntityType.Database,
        callCount: 100,
        errorCount: 2,
        avgDurationMs: 30,
      }),
      connection({
        otherKey: "missing",
        otherKnown: false,
        otherName: null,
        otherType: null,
      }),
    ]),
    calledBy: sectionOf([
      connection({
        direction: "in",
        otherKey: "web",
        otherName: "Web frontend",
      }),
    ]),
    runsOn: sectionOf(pods(1, 25), {
      total: 40,
      unknownTotal: 3,
      nextOffset: 25,
    }),
  });
}

function isConnectionsRequest(request: PostRequest): boolean {
  return request.url.toString().endsWith("/entity/connections");
}

function requests(): Array<PostRequest> {
  return postMock.mock.calls.map((call: Array<unknown>): PostRequest => {
    return call[0] as PostRequest;
  });
}

function entityRequests(): Array<PostRequest> {
  return requests().filter((request: PostRequest): boolean => {
    return !isConnectionsRequest(request);
  });
}

/*
 * Answer each request by its SHAPE (which endpoint, which key), so tests pin
 * what was asked for rather than the order requests were issued in.
 */
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

function serveEntity(response: JSONObject): void {
  serve((request: PostRequest): Answer => {
    if (isConnectionsRequest(request)) {
      throw new Error("No page is served in this test.");
    }
    return response;
  });
}

const CHECKOUT: EntityDetailTarget = {
  entityKey: "svc",
  entityType: EntityType.Service,
  displayName: "Checkout API",
};

function renderPanel(overrides: Partial<ComponentProps> = {}): RenderResult {
  return render(
    <EntityDetailPanel
      entity={CHECKOUT}
      rangeStart={RANGE_START}
      metricsWindowSeconds={60}
      onClose={() => {
        return undefined;
      }}
      {...overrides}
    />,
  );
}

async function waitForConnections(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  postMock.mockReset();
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("opening the drawer", () => {
  test("the header renders from the preview before the server answers", async () => {
    const answer: Deferred = deferred();
    serve((): Answer => {
      return answer.promise;
    });

    renderPanel();

    expect(
      screen.getByRole("region", { name: "Checkout API" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("drawer-description")).toHaveTextContent(
      "Service",
    );
    const status: HTMLElement = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading connections…");
    expect(screen.queryByTestId("entity-detail-calls")).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory details")).not.toBeInTheDocument();

    await act(async () => {
      answer.resolve(checkoutResponse());
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("entity-detail-calls")).toBeInTheDocument();
  });

  test("asks for the entity once, with the key, the known type and the map's range start", async () => {
    serveEntity(checkoutResponse());

    renderPanel();
    await waitForConnections();

    expect(entityRequests()).toHaveLength(1);
    expect(entityRequests()[0]!.url.toString()).toMatch(
      /\/telemetry\/topology\/entity$/,
    );
    expect(entityRequests()[0]!.data).toEqual({
      rangeStart: RANGE_START.toISOString(),
      entityKey: "svc",
      entityType: EntityType.Service,
    });
  });

  test("a deep link that knows only the key shows the key until the row arrives", async () => {
    const answer: Deferred = deferred();
    serve((): Answer => {
      return answer.promise;
    });

    renderPanel({ entity: { entityKey: "pod-key" } });

    expect(screen.getByRole("region", { name: "pod-key" })).toBeInTheDocument();
    expect(entityRequests()[0]!.data).toEqual({
      rangeStart: RANGE_START.toISOString(),
      entityKey: "pod-key",
    });

    await act(async () => {
      answer.resolve(
        entityResponse(
          entityRow({
            key: "pod-key",
            type: EntityType.KubernetesPod,
            name: "checkout-7d9f",
          }),
        ),
      );
    });

    expect(
      screen.getByRole("region", { name: "checkout-7d9f" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("drawer-description")).toHaveTextContent(
      "K8s Pod",
    );
  });

  test("without a range start yet, nothing is requested and the drawer keeps loading", () => {
    serveEntity(checkoutResponse());

    renderPanel({ rangeStart: null });

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading connections…",
    );
  });

  test("closing the drawer mid-load cancels the request", async () => {
    const answer: Deferred = deferred();
    serve((): Answer => {
      return answer.promise;
    });

    const view: RenderResult = renderPanel();
    const signal: AbortSignal | undefined = entityRequests()[0]!.options.signal;
    expect(signal?.aborted).toBe(false);

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});

describe("connection sections", () => {
  test("headers carry the server's exact totals, not the rows it sent", async () => {
    serveEntity(checkoutResponse());

    renderPanel();
    await waitForConnections();

    expect(
      within(screen.getByTestId("entity-detail-calls")).getByRole("heading"),
    ).toHaveTextContent("Calls (2)");
    expect(
      within(screen.getByTestId("entity-detail-called-by")).getByRole(
        "heading",
      ),
    ).toHaveTextContent("Called by (1)");
    expect(
      within(screen.getByTestId("entity-detail-runs-on")).getByRole("heading"),
    ).toHaveTextContent("Runs on (40)");
    expect(
      within(screen.getByTestId("entity-detail-runs-on")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(25);
    expect(screen.getByText("Showing 25 of 40")).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-detail-related"),
    ).not.toBeInTheDocument();
  });

  test("large totals are grouped, and a limited scan marks every total as a lower bound", async () => {
    serveEntity(
      entityResponse(
        entityRow(),
        {
          related: sectionOf(pods(1, 25), {
            total: 100_000,
            nextOffset: 25,
          }),
          calledBy: sectionOf(
            [connection({ direction: "in", otherKey: "web" })],
            { total: 1 },
          ),
        },
        true,
      ),
    );

    renderPanel();
    await waitForConnections();

    expect(
      within(screen.getByTestId("entity-detail-related")).getByRole("heading"),
    ).toHaveTextContent("Related infrastructure (100,000+)");
    expect(
      within(screen.getByTestId("entity-detail-called-by")).getByRole(
        "heading",
      ),
    ).toHaveTextContent("Called by (1+)");
    expect(screen.getByTestId("entity-detail-scan-limited")).toHaveTextContent(
      "totals are lower bounds",
    );
  });

  test("an exact response says nothing about lower bounds", async () => {
    serveEntity(checkoutResponse());

    renderPanel();
    await waitForConnections();

    expect(
      screen.queryByTestId("entity-detail-scan-limited"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\+\)/)).not.toBeInTheDocument();
  });

  test("rows keep the server's order", async () => {
    serveEntity(
      entityResponse(entityRow(), {
        related: sectionOf([
          connection({
            relationshipType: "member-of",
            otherKey: "z",
            otherName: "Zulu",
            otherType: EntityType.KubernetesNamespace,
          }),
          connection({
            relationshipType: "member-of",
            otherKey: "a",
            otherName: "Alpha",
            otherType: EntityType.KubernetesNamespace,
          }),
        ]),
      }),
    );

    renderPanel();
    await waitForConnections();

    const items: Array<HTMLElement> = within(
      screen.getByTestId("entity-detail-related"),
    ).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Checkout API member of Zulu");
    expect(items[1]).toHaveTextContent("Checkout API member of Alpha");
  });

  test("outbound rows read from the entity, inbound rows towards it, with call metrics", async () => {
    serveEntity(checkoutResponse());

    renderPanel();
    await waitForConnections();

    expect(
      screen.getByText("Checkout API depends on Orders database"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Web frontend depends on Checkout API"),
    ).toBeInTheDocument();
    expect(screen.getByText(/100\/min/)).toHaveTextContent("2.0% errors");
    expect(screen.getByText(/100\/min/)).toHaveTextContent("avg 30ms");
    expect(screen.getByText(/100\/min/)).toHaveTextContent("Database");
  });

  test("connections to resources nothing reported are static text, never broken actions", async () => {
    serveEntity(checkoutResponse());

    renderPanel({
      onSelectEntity: () => {
        return undefined;
      },
    });
    await waitForConnections();

    expect(
      screen.getByText("Checkout API depends on Undiscovered resource"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /View details for Undiscovered/ }),
    ).not.toBeInTheDocument();
  });

  test("where it runs and related infrastructure say how many ends are no longer in inventory", async () => {
    serveEntity(
      entityResponse(entityRow(), {
        runsOn: sectionOf(pods(1, 2), { total: 5, unknownTotal: 3 }),
        related: sectionOf(
          [
            connection({
              relationshipType: "member-of",
              otherKey: "gone",
              otherKnown: false,
              otherName: null,
              otherType: null,
            }),
          ],
          { unknownTotal: 1 },
        ),
        calls: sectionOf(
          [
            connection({
              otherKey: "gone-dep",
              otherKnown: false,
              otherName: null,
            }),
          ],
          { unknownTotal: 1 },
        ),
      }),
    );

    renderPanel();
    await waitForConnections();

    expect(
      within(screen.getByTestId("entity-detail-runs-on")).getByText(
        "3 no longer in inventory",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("entity-detail-related")).getByText(
        "1 no longer in inventory",
      ),
    ).toBeInTheDocument();
    /* Calls name their unknown ends row by row instead. */
    expect(
      within(screen.getByTestId("entity-detail-calls")).queryByText(
        /no longer in inventory/,
      ),
    ).not.toBeInTheDocument();
  });

  test("a known resource without a name is unnamed, not undiscovered", async () => {
    serveEntity(
      entityResponse(entityRow(), {
        related: sectionOf([
          connection({
            relationshipType: "member-of",
            otherKey: "ns",
            otherName: null,
            otherType: EntityType.KubernetesNamespace,
          }),
        ]),
      }),
    );

    renderPanel({
      onSelectEntity: () => {
        return undefined;
      },
    });
    await waitForConnections();

    expect(
      screen.getByRole("button", { name: "View details for Unnamed resource" }),
    ).toHaveTextContent("Checkout API member of Unnamed resource");
  });

  test("a self-loop appears once, as an outbound row", async () => {
    serveEntity(
      entityResponse(entityRow(), {
        calls: sectionOf([
          connection({ otherKey: "svc", otherName: "Checkout API" }),
        ]),
      }),
    );

    renderPanel();
    await waitForConnections();

    expect(
      within(screen.getByTestId("entity-detail-calls")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    expect(
      screen.getByText("Checkout API depends on Checkout API"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-detail-called-by"),
    ).not.toBeInTheDocument();
  });

  test("an entity with no connections in range says so", async () => {
    serveEntity(entityResponse(entityRow()));

    renderPanel();
    await waitForConnections();

    expect(
      screen.getByText("No connections in the selected time range."),
    ).toBeInTheDocument();
  });
});

describe("Show more", () => {
  function servePaging(
    page: (request: PostRequest) => Answer = (): Answer => {
      return connectionsResponse(
        "runsOn",
        sectionOf(pods(26, 40), {
          total: 40,
          unknownTotal: 3,
          nextOffset: null,
        }),
      );
    },
  ): void {
    serve((request: PostRequest): Answer => {
      return isConnectionsRequest(request) ? page(request) : checkoutResponse();
    });
  }

  test("fetches the next page of that section, appends it, and moves focus to the first new row", async () => {
    servePaging();
    const onOpenInfrastructure: MockFunction = getJestMockFunction();

    renderPanel({ onOpenInfrastructure });
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));

    await waitFor(() => {
      expect(
        within(screen.getByTestId("entity-detail-runs-on")).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(40);
    });

    const pageRequests: Array<PostRequest> =
      requests().filter(isConnectionsRequest);
    expect(pageRequests).toHaveLength(1);
    expect(pageRequests[0]!.url.toString()).toMatch(
      /\/telemetry\/topology\/entity\/connections$/,
    );
    expect(pageRequests[0]!.data).toEqual({
      rangeStart: RANGE_START.toISOString(),
      entityKey: "svc",
      entityType: EntityType.Service,
      section: "runsOn",
      offset: 25,
      limit: 25,
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", {
          name: "View details for checkout-pod-26",
        }),
      );
    });
    /* The last page reached the end: no more paging. */
    expect(
      screen.queryByRole("button", { name: "Show more: Runs on" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    /* Only that section was fetched again; the entity was not. */
    expect(entityRequests()).toHaveLength(1);
  });

  test("when the first new row cannot be opened, focus lands on the row itself", async () => {
    servePaging((): Answer => {
      return connectionsResponse(
        "runsOn",
        sectionOf(
          [
            connection({
              relationshipType: "runs-on",
              otherKey: "gone-pod",
              otherKnown: false,
              otherName: null,
              otherType: null,
            }),
          ],
          { total: 40, unknownTotal: 3, nextOffset: 26 },
        ),
      );
    });

    renderPanel({
      onSelectEntity: () => {
        return undefined;
      },
    });
    await waitForConnections();
    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));

    const row: HTMLElement = await screen.findByText(
      "Checkout API runs on Undiscovered resource",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(row.closest("li"));
    });
  });

  test("keeps paging from the offset the server returned", async () => {
    servePaging((request: PostRequest): Answer => {
      const offset: number = request.data["offset"] as number;
      return connectionsResponse(
        "runsOn",
        sectionOf(pods(offset + 1, offset + 5), {
          total: 40,
          nextOffset: offset + 5,
        }),
      );
    });

    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    await screen.findByText("Showing 30 of 40");
    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    await screen.findByText("Showing 35 of 40");

    expect(
      requests()
        .filter(isConnectionsRequest)
        .map((request: PostRequest): unknown => {
          return request.data["offset"];
        }),
    ).toEqual([25, 30]);
  });

  test("the button is busy while its page loads and cannot fire twice", async () => {
    const page: Deferred = deferred();
    servePaging((): Answer => {
      return page.promise;
    });

    renderPanel();
    await waitForConnections();

    const button: HTMLElement = screen.getByRole("button", {
      name: "Show more: Runs on",
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveTextContent("Loading…");
    fireEvent.click(button);
    expect(requests().filter(isConnectionsRequest)).toHaveLength(1);

    await act(async () => {
      page.resolve(
        connectionsResponse(
          "runsOn",
          sectionOf(pods(26, 30), { total: 40, nextOffset: 30 }),
        ),
      );
    });
    expect(button).not.toBeDisabled();
  });

  test("a failed page is reported in its section and can be retried", async () => {
    let fail: boolean = true;
    servePaging((): Answer => {
      if (fail) {
        return new HTTPErrorResponse(500, { message: "Database busy" }, {});
      }
      return connectionsResponse(
        "runsOn",
        sectionOf(pods(26, 40), { total: 40, nextOffset: null }),
      );
    });

    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    const alert: HTMLElement = await within(
      screen.getByTestId("entity-detail-runs-on"),
    ).findByRole("alert");
    expect(alert).toHaveTextContent("Could not load more connections.");
    expect(alert).toHaveTextContent("Database busy");
    /* What was already shown stays. */
    expect(
      within(screen.getByTestId("entity-detail-runs-on")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(25);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("entity-detail-runs-on")).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(40);
    });
    expect(
      within(screen.getByTestId("entity-detail-runs-on")).queryByRole("alert"),
    ).not.toBeInTheDocument();
  });

  test("a page that reports a limited scan turns the totals into lower bounds", async () => {
    servePaging((): Answer => {
      return connectionsResponse(
        "runsOn",
        sectionOf(pods(26, 30), { total: 41, nextOffset: 30 }),
        true,
      );
    });

    renderPanel();
    await waitForConnections();

    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));

    await waitFor(() => {
      expect(
        within(screen.getByTestId("entity-detail-runs-on")).getByRole(
          "heading",
        ),
      ).toHaveTextContent("Runs on (41+)");
    });
    expect(
      within(screen.getByTestId("entity-detail-calls")).getByRole("heading"),
    ).toHaveTextContent("Calls (2+)");
  });

  test("a page that arrives after the drawer moved to another range is dropped", async () => {
    const page: Deferred = deferred();
    servePaging((): Answer => {
      return page.promise;
    });

    const view: RenderResult = renderPanel();
    await waitForConnections();
    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    const pageSignal: AbortSignal | undefined =
      requests().filter(isConnectionsRequest)[0]!.options.signal;

    view.rerender(
      <EntityDetailPanel
        entity={CHECKOUT}
        rangeStart={LATER_RANGE_START}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
      />,
    );
    expect(pageSignal?.aborted).toBe(true);
    await waitForConnections();

    await act(async () => {
      page.resolve(
        connectionsResponse(
          "runsOn",
          sectionOf(pods(26, 40), { total: 40, nextOffset: null }),
        ),
      );
    });

    expect(
      within(screen.getByTestId("entity-detail-runs-on")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(25);
  });
});

describe("a resource that is gone, and failures", () => {
  test("a key no item has any more keeps the header and says it is gone", async () => {
    serveEntity(entityResponse(null));
    const onFocus: MockFunction = getJestMockFunction();

    renderPanel({ onFocus });
    await waitForConnections();

    expect(
      screen.getByRole("region", { name: "Checkout API" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This resource is no longer in Inventory."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Explore connections" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory details")).not.toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No connections in the selected time range."),
    ).not.toBeInTheDocument();
  });

  test("a failed load is an alert with an in-drawer retry", async () => {
    let fail: boolean = true;
    serve((): Answer => {
      if (fail) {
        return new HTTPErrorResponse(
          500,
          { message: "Inventory is unavailable" },
          {},
        );
      }
      return checkoutResponse();
    });

    renderPanel();

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load this resource's connections.",
    );
    expect(alert).toHaveTextContent("Inventory is unavailable");
    expect(
      screen.getByRole("region", { name: "Checkout API" }),
    ).toBeInTheDocument();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByTestId("entity-detail-calls"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(entityRequests()).toHaveLength(2);
  });

  test("a server without the endpoint asks for a reload", async () => {
    serve((): Answer => {
      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    });

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Topology was updated. Reload the page.",
    );
  });

  test("a response in another format asks for a reload too", async () => {
    serve((): Answer => {
      return { ...checkoutResponse(), formatVersion: 999 };
    });

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Topology was updated. Reload the page.",
    );
  });
});

describe("switching entities and ranges", () => {
  function webResponse(): JSONObject {
    return entityResponse(
      entityRow({
        id: "2b2b0000-0000-4000-8000-000000000002",
        key: "web",
        name: "Web frontend",
        resourceId: null,
        resourceType: null,
      }),
      {
        calls: sectionOf([
          connection({ otherKey: "svc", otherName: "Checkout API" }),
        ]),
      },
    );
  }

  test("a new entity never shows the previous entity's rows, even without a remount", async () => {
    const web: Deferred = deferred();
    serve((request: PostRequest): Answer => {
      return request.data["entityKey"] === "web"
        ? web.promise
        : checkoutResponse();
    });

    const view: RenderResult = renderPanel();
    await screen.findByText("Checkout API depends on Orders database");

    view.rerender(
      <EntityDetailPanel
        entity={{
          entityKey: "web",
          entityType: EntityType.Service,
          displayName: "Web frontend",
        }}
        rangeStart={RANGE_START}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.queryByText("Checkout API depends on Orders database"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Orders database/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Web frontend" }),
    ).toBeInTheDocument();

    await act(async () => {
      web.resolve(webResponse());
    });

    expect(
      screen.getByText("Web frontend depends on Checkout API"),
    ).toBeInTheDocument();
  });

  test("an answer for the previous entity that arrives late is ignored", async () => {
    const checkout: Deferred = deferred();
    serve((request: PostRequest): Answer => {
      return request.data["entityKey"] === "web"
        ? webResponse()
        : checkout.promise;
    });

    const view: RenderResult = renderPanel();
    const firstSignal: AbortSignal | undefined =
      entityRequests()[0]!.options.signal;

    view.rerender(
      <EntityDetailPanel
        entity={{ entityKey: "web", displayName: "Web frontend" }}
        rangeStart={RANGE_START}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
      />,
    );
    expect(firstSignal?.aborted).toBe(true);
    await screen.findByText("Web frontend depends on Checkout API");

    await act(async () => {
      checkout.resolve(checkoutResponse());
    });

    expect(
      screen.queryByText("Checkout API depends on Orders database"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Web frontend depends on Checkout API"),
    ).toBeInTheDocument();
  });

  test("a new range reloads the connections instead of showing the old range's", async () => {
    const later: Deferred = deferred();
    serve((request: PostRequest): Answer => {
      return request.data["rangeStart"] === LATER_RANGE_START.toISOString()
        ? later.promise
        : checkoutResponse();
    });

    const view: RenderResult = renderPanel();
    await screen.findByText("Checkout API depends on Orders database");

    view.rerender(
      <EntityDetailPanel
        entity={CHECKOUT}
        rangeStart={new Date(LATER_RANGE_START.getTime())}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.queryByText("Checkout API depends on Orders database"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      later.resolve(
        entityResponse(entityRow(), {
          calledBy: sectionOf([
            connection({
              direction: "in",
              otherKey: "cron",
              otherName: "cron",
            }),
          ]),
        }),
      );
    });
    expect(
      screen.getByText("cron depends on Checkout API"),
    ).toBeInTheDocument();
  });

  test("re-rendering with an equal preview and range does not refetch", async () => {
    serveEntity(checkoutResponse());

    const view: RenderResult = renderPanel();
    await waitForConnections();

    view.rerender(
      <EntityDetailPanel
        entity={{ ...CHECKOUT }}
        rangeStart={new Date(RANGE_START.getTime())}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
      />,
    );
    await waitForConnections();

    expect(entityRequests()).toHaveLength(1);
  });
});

describe("best-effort links from the full row", () => {
  function serviceLookups(): Array<unknown> {
    return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { modelType: { name: string } }).modelType.name ===
        "Service"
      );
    });
  }

  test("the traces link uses the row's own Service pointer, with no lookup", async () => {
    serveEntity(checkoutResponse());

    renderPanel();

    const link: HTMLElement = await screen.findByText(
      "Traces for this service",
    );
    expect(link.closest("a")?.getAttribute("href")).toContain(SERVICE_ID);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("without a pointer the Service is found by name — once per row, never from the preview", async () => {
    const first: Deferred = deferred();
    let served: number = 0;
    serve((): Answer => {
      served++;
      return served === 1
        ? first.promise
        : entityResponse(entityRow({ resourceType: null, resourceId: null }));
    });
    getListMock.mockImplementation(async () => {
      return { data: [{ _id: SERVICE_ID }], count: 1 };
    });

    const view: RenderResult = renderPanel();
    /* The preview is a named service, but it is not the row. */
    expect(serviceLookups()).toHaveLength(0);

    await act(async () => {
      first.resolve(
        entityResponse(entityRow({ resourceType: null, resourceId: null })),
      );
    });
    const link: HTMLElement = await screen.findByText(
      "Traces for this service",
    );
    expect(link.closest("a")?.getAttribute("href")).toContain(SERVICE_ID);
    expect(serviceLookups()).toHaveLength(1);
    expect(
      (serviceLookups()[0] as Array<{ query: JSONObject }>)[0]!.query,
    ).toEqual({ projectId: PROJECT_ID, name: "Checkout API" });

    /* A new range reloads the row; the same row is not looked up again. */
    view.rerender(
      <EntityDetailPanel
        entity={CHECKOUT}
        rangeStart={LATER_RANGE_START}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
      />,
    );
    await waitForConnections();
    await screen.findByText("Traces for this service");

    expect(entityRequests()).toHaveLength(2);
    expect(serviceLookups()).toHaveLength(1);
  });

  test("a host is matched to the network device of the same name", async () => {
    serveEntity(
      entityResponse(
        entityRow({
          key: "host-key",
          type: EntityType.Host,
          name: "web-1.example.com",
          resourceType: null,
          resourceId: null,
        }),
      ),
    );
    getListMock.mockImplementation(async () => {
      return {
        data: [
          { _id: "d0d0d0d0-0000-4000-8000-000000000001", name: "core-sw" },
          {
            _id: "d0d0d0d0-0000-4000-8000-000000000002",
            name: "rack-7",
            hostname: "WEB-1",
          },
        ],
        count: 2,
      };
    });

    renderPanel({
      entity: { entityKey: "host-key", entityType: EntityType.Host },
    });

    const link: HTMLElement = await screen.findByText(/Network device:/);
    expect(link).toHaveTextContent("Network device: rack-7");
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("the inventory link opens the row the server returned", async () => {
    serveEntity(checkoutResponse());

    renderPanel();

    const link: HTMLElement = await screen.findByText("Inventory details");
    expect(link.closest("a")?.getAttribute("href")).toContain(ITEM_ID);
  });

  test("details come from the full row's attributes", async () => {
    serveEntity(
      entityResponse(
        entityRow({
          key: "pg",
          type: EntityType.Database,
          name: "orders",
          resourceType: null,
          resourceId: null,
          identifyingAttributes: { "db.system.name": "postgresql" },
          descriptiveAttributes: {
            "k8s.pod.name": "orders",
            "host.ip": 10,
          },
        }),
      ),
    );

    renderPanel({
      entity: { entityKey: "pg", entityType: EntityType.Database },
    });

    expect(
      (await screen.findByText("Database engine")).parentElement,
    ).toHaveTextContent("postgresql");
    /* A value equal to the name, or not a string, is not repeated. */
    expect(screen.queryByText("Pod name")).not.toBeInTheDocument();
    expect(screen.queryByText("IP Address")).not.toBeInTheDocument();
    expect(screen.getByText("First seen")).toBeInTheDocument();
  });
});

describe("where rows lead", () => {
  test("dependencies and callers open in place, with what the drawer knows about them", async () => {
    serveEntity(checkoutResponse());
    const onSelectEntity: MockFunction = getJestMockFunction();

    renderPanel({ onSelectEntity });
    await waitForConnections();

    fireEvent.click(
      screen.getByRole("button", { name: "View details for Orders database" }),
    );
    expect(onSelectEntity).toHaveBeenLastCalledWith({
      entityKey: "db",
      entityType: EntityType.Database,
      displayName: "Orders database",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Web frontend" }),
    );
    expect(onSelectEntity).toHaveBeenLastCalledWith({
      entityKey: "web",
      entityType: EntityType.Service,
      displayName: "Web frontend",
    });
  });

  test("placements open in the Infrastructure view when the page offers it", async () => {
    serveEntity(checkoutResponse());
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    const onSelectEntity: MockFunction = getJestMockFunction();

    renderPanel({ onOpenInfrastructure, onSelectEntity });
    await waitForConnections();

    fireEvent.click(
      screen.getByRole("button", { name: "View details for checkout-pod-1" }),
    );
    expect(onOpenInfrastructure).toHaveBeenCalledWith("pod-1");
    expect(onSelectEntity).not.toHaveBeenCalled();
  });

  test("without an Infrastructure view, placements open in place too", async () => {
    serveEntity(checkoutResponse());
    const onSelectEntity: MockFunction = getJestMockFunction();

    renderPanel({ onSelectEntity });
    await waitForConnections();

    fireEvent.click(
      screen.getByRole("button", { name: "View details for checkout-pod-1" }),
    );
    expect(onSelectEntity).toHaveBeenCalledWith({
      entityKey: "pod-1",
      entityType: EntityType.KubernetesPod,
      displayName: "checkout-pod-1",
    });
  });

  test("related infrastructure opens in place, never in the Infrastructure view", async () => {
    serveEntity(
      entityResponse(entityRow(), {
        related: sectionOf([
          connection({
            relationshipType: "member-of",
            otherKey: "ns",
            otherName: "shop",
            otherType: EntityType.KubernetesNamespace,
          }),
        ]),
      }),
    );
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    const onSelectEntity: MockFunction = getJestMockFunction();

    renderPanel({ onOpenInfrastructure, onSelectEntity });
    await waitForConnections();

    fireEvent.click(
      screen.getByRole("button", { name: "View details for shop" }),
    );
    expect(onSelectEntity).toHaveBeenCalledWith({
      entityKey: "ns",
      entityType: EntityType.KubernetesNamespace,
      displayName: "shop",
    });
    expect(onOpenInfrastructure).not.toHaveBeenCalled();
  });

  test("callers without navigation support keep readable static connections", async () => {
    serveEntity(checkoutResponse());

    renderPanel();
    await waitForConnections();

    expect(
      screen.getByText("Checkout API depends on Orders database"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /View details for/ }),
    ).not.toBeInTheDocument();
  });

  test("the explore action is offered only by callers that can show it, with their wording", async () => {
    serveEntity(checkoutResponse());
    const onFocus: MockFunction = getJestMockFunction();

    const view: RenderResult = renderPanel({ onFocus });
    fireEvent.click(
      screen.getByRole("button", { name: "Explore connections" }),
    );
    expect(onFocus).toHaveBeenCalledWith("svc");
    await waitForConnections();
    view.unmount();

    renderPanel({ onFocus, focusButtonLabel: "Show where it is" });
    expect(
      screen.getByRole("button", { name: "Show where it is" }),
    ).toBeInTheDocument();
    await waitForConnections();
    cleanup();

    renderPanel();
    expect(
      screen.queryByRole("button", { name: "Explore connections" }),
    ).not.toBeInTheDocument();
    await waitForConnections();
  });
});

describe("service map context", () => {
  test("leads with status and the traffic in both directions", async () => {
    serveEntity(checkoutResponse());

    renderPanel({
      traffic: {
        inbound: { calls: 0, errors: 0, avgDurationMs: null },
        outbound: { calls: 60, errors: 0, avgDurationMs: 4 },
        statusLabel: "Entry point",
        statusColor: "#6366f1",
        subtitle: "Service · Node.js",
      },
    });

    expect(screen.getByTestId("entity-detail-status")).toHaveTextContent(
      "Entry point",
    );
    expect(screen.getByTestId("drawer-description")).toHaveTextContent(
      "Service · Node.js",
    );
    expect(
      screen.getByText("Requests it answered").parentElement,
    ).toHaveTextContent("None observed");
    expect(screen.getByText("Calls it made").parentElement).toHaveTextContent(
      "60/min",
    );
    expect(screen.getByText("Calls it made").parentElement).toHaveTextContent(
      "4ms",
    );
    await waitForConnections();
  });

  test("lists active incidents and alerts for the service", async () => {
    serveEntity(checkoutResponse());

    renderPanel({
      incidentStatus: {
        serviceId: SERVICE_ID,
        activeIncidentCount: 1,
        worstIncidentSeverityName: "Sev 1",
        worstIncidentSeverityColor: "#f00",
        incidents: [
          {
            id: "a1a1a1a1-0000-4000-8000-000000000001",
            title: "Checkout is down",
            severityName: "Sev 1",
            severityColor: "#f00",
          },
        ],
        activeAlertCount: 0,
        worstAlertSeverityName: null,
        worstAlertSeverityColor: null,
        alerts: [],
      },
    });

    expect(screen.getByText("Checkout is down")).toBeInTheDocument();
    expect(screen.getByText(/Active incidents/)).toHaveTextContent(
      "Active incidents (1)",
    );
    expect(screen.queryByText(/Active alerts/)).not.toBeInTheDocument();
    await waitForConnections();
  });
});

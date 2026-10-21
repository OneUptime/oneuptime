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
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Lifecycle edges of the topology detail drawer that EntityDetailPanel.test
 * does not reach:
 *
 *   - React 18 StrictMode replays the drawer's mount effects in development.
 *     It must come out with one live entity request (the discarded one
 *     aborted and ignored), resolve its best-effort Service link once, and
 *     append a "Show more" page once — its state updates are replayed too.
 *   - Closing the drawer mid-"Show more" aborts the page request, and a page
 *     or a best-effort lookup that finishes afterwards changes nothing.
 *
 * Same seam as EntityDetailPanel.test: the real request and decoding code
 * behind a fake API.post.
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

import EntityDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import { EntityDetailTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
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

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  options: { signal?: AbortSignal };
}

/* One request the fake server received, answerable by the test. */
interface Pending {
  request: PostRequest;
  resolve: (value: JSONObject) => void;
}

let pending: Array<Pending> = [];

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
    /* No Service pointer: the traces link is looked up by name. */
    resourceType: null,
    resourceId: null,
    identifyingAttributes: { "service.name": "Checkout API" },
    descriptiveAttributes: {},
    ...overrides,
  };
}

function pod(index: number): TopologyConnectionRowJSON {
  return {
    relationshipType: "runs-on",
    direction: "out",
    otherKey: `pod-${index}`,
    otherKnown: true,
    otherName: `checkout-pod-${index}`,
    otherType: EntityType.KubernetesPod,
    callCount: null,
    errorCount: null,
    avgDurationMs: null,
    lastSeenAt: null,
  };
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

function entityResponse(
  entity: TopologyEntityDetailJSON | null,
  runsOn: TopologyConnectionSectionJSON = sectionOf(pods(1, 25), {
    total: 40,
    nextOffset: 25,
  }),
): JSONObject {
  const empty: TopologyConnectionSectionJSON = sectionOf([]);
  const response: TopologyEntityResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: RANGE_START.toISOString(),
    generatedAt: "2026-09-26T10:15:00.000Z",
    entity: entity,
    sections: {
      calls: empty,
      calledBy: empty,
      runsOn: runsOn,
      related: empty,
    },
    isScanLimited: false,
  };
  return asJSON(response);
}

function connectionsResponse(
  section: TopologyConnectionSection,
  connections: TopologyConnectionSectionJSON,
): JSONObject {
  const response: TopologyEntityConnectionsResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: RANGE_START.toISOString(),
    generatedAt: "2026-09-26T10:15:00.000Z",
    section: section,
    connections: connections,
    isScanLimited: false,
  };
  return asJSON(response);
}

function isConnectionsRequest(request: PostRequest): boolean {
  return request.url.toString().endsWith("/entity/connections");
}

function entityRequests(): Array<Pending> {
  return pending.filter((entry: Pending): boolean => {
    return !isConnectionsRequest(entry.request);
  });
}

function pageRequests(): Array<Pending> {
  return pending.filter((entry: Pending): boolean => {
    return isConnectionsRequest(entry.request);
  });
}

function isLive(entry: Pending): boolean {
  return !entry.request.options.signal?.aborted;
}

/* Every request waits until the test answers it. */
function serveOnDemand(): void {
  postMock.mockImplementation((...args: Array<unknown>) => {
    const request: PostRequest = args[0] as PostRequest;
    return new Promise<HTTPResponse<JSONObject>>(
      (resolve: (value: HTTPResponse<JSONObject>) => void): void => {
        pending.push({
          request,
          resolve: (value: JSONObject): void => {
            resolve(new HTTPResponse<JSONObject>(200, value, {}));
          },
        });
      },
    );
  });
}

function serviceLookups(): Array<Array<unknown>> {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType: { name: string } }).modelType.name === "Service"
    );
  });
}

function runsOnRows(): Array<HTMLElement> {
  return within(screen.getByTestId("entity-detail-runs-on")).getAllByRole(
    "listitem",
  );
}

const CHECKOUT: EntityDetailTarget = {
  entityKey: "svc",
  entityType: EntityType.Service,
  displayName: "Checkout API",
};

function panel(): React.ReactElement {
  return (
    <EntityDetailPanel
      entity={CHECKOUT}
      rangeStart={RANGE_START}
      metricsWindowSeconds={60}
      onClose={() => {
        return undefined;
      }}
    />
  );
}

function strictPanel(): React.ReactElement {
  return <React.StrictMode>{panel()}</React.StrictMode>;
}

let consoleError: SpyInstance<(...data: Array<unknown>) => void>;

/*
 * console.error calls other than the testing library's one-time
 * "ReactDOMTestUtils.act is deprecated" notice, which lands in whichever
 * test first calls act().
 */
function unexpectedConsoleErrors(): Array<string> {
  return consoleError.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return !message.includes("ReactDOMTestUtils.act");
    });
}

beforeEach(() => {
  pending = [];
  postMock.mockReset();
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [{ _id: SERVICE_ID }], count: 1 };
  });
  serveOnDemand();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  consoleError = jest.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("StrictMode's double mount", () => {
  test("leaves one live entity request, and the discarded one cannot land", async () => {
    render(strictPanel());

    /*
     * React 18 replays mount effects under StrictMode in development: the
     * drawer asked twice, and aborted the first ask.
     */
    expect(entityRequests()).toHaveLength(2);
    const [discarded, current]: Array<Pending> = entityRequests();
    expect(isLive(discarded!)).toBe(false);
    expect(isLive(current!)).toBe(true);
    expect(current!.request.data).toEqual(discarded!.request.data);

    await act(async () => {
      discarded!.resolve(
        entityResponse(entityRow({ name: "Stale checkout" }), sectionOf([])),
      );
    });
    /* Still loading, still the preview's name. */
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading connections…",
    );
    expect(
      screen.getByRole("region", { name: "Checkout API" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Stale checkout")).not.toBeInTheDocument();

    await act(async () => {
      current!.resolve(entityResponse(entityRow()));
    });
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(runsOnRows()).toHaveLength(25);
    expect(entityRequests()).toHaveLength(2);
  });

  test("resolves the best-effort Service link once, from the full row", async () => {
    render(strictPanel());
    /* The preview alone never triggers a lookup, replayed or not. */
    expect(serviceLookups()).toHaveLength(0);

    await act(async () => {
      entityRequests()[1]!.resolve(entityResponse(entityRow()));
    });
    const link: HTMLElement = await screen.findByText(
      "Traces for this service",
    );
    expect(link.closest("a")?.getAttribute("href")).toContain(SERVICE_ID);
    expect(serviceLookups()).toHaveLength(1);
  });

  test("a Show more page is requested once and appended once", async () => {
    render(strictPanel());
    await act(async () => {
      entityRequests()[1]!.resolve(entityResponse(entityRow()));
    });
    await waitFor(() => {
      expect(runsOnRows()).toHaveLength(25);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    expect(pageRequests()).toHaveLength(1);

    await act(async () => {
      pageRequests()[0]!.resolve(
        connectionsResponse(
          "runsOn",
          sectionOf(pods(26, 40), { total: 40, nextOffset: null }),
        ),
      );
    });

    await waitFor(() => {
      expect(runsOnRows()).toHaveLength(40);
    });
    /* Replayed state updates must not append the page twice. */
    const keys: Array<string> = runsOnRows().map((row: HTMLElement): string => {
      return row.textContent || "";
    });
    expect(new Set<string>(keys).size).toBe(40);
    expect(pageRequests()).toHaveLength(1);
  });
});

describe("closing the drawer", () => {
  test("mid-Show more aborts the page request, and its late answer changes nothing", async () => {
    const view: RenderResult = render(panel());
    await act(async () => {
      entityRequests()[0]!.resolve(entityResponse(entityRow()));
    });
    await waitFor(() => {
      expect(runsOnRows()).toHaveLength(25);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more: Runs on" }));
    expect(pageRequests()).toHaveLength(1);
    const page: Pending = pageRequests()[0]!;
    expect(isLive(page)).toBe(true);

    /* Only what happens from here on is under test. */
    consoleError.mockClear();
    view.unmount();

    expect(isLive(page)).toBe(false);
    await act(async () => {
      page.resolve(
        connectionsResponse(
          "runsOn",
          sectionOf(pods(26, 40), { total: 40, nextOffset: null }),
        ),
      );
    });

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(unexpectedConsoleErrors()).toEqual([]);
  });

  test("while the best-effort Service lookup is pending drops its answer quietly", async () => {
    let finishLookup: (value: unknown) => void = () => {
      return undefined;
    };
    getListMock.mockImplementation(() => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finishLookup = resolve;
      });
    });

    const view: RenderResult = render(panel());
    await act(async () => {
      entityRequests()[0]!.resolve(entityResponse(entityRow()));
    });
    await waitFor(() => {
      expect(serviceLookups()).toHaveLength(1);
    });
    expect(screen.queryByText("Traces for this service")).toBeNull();

    /* Only what happens from here on is under test. */
    consoleError.mockClear();
    view.unmount();
    await act(async () => {
      finishLookup({ data: [{ _id: SERVICE_ID }], count: 1 });
    });

    expect(serviceLookups()).toHaveLength(1);
    expect(unexpectedConsoleErrors()).toEqual([]);
  });
});

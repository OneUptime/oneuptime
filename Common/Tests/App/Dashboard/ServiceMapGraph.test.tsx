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
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import TimeRange from "../../../Types/Time/TimeRange";
import { ServiceOperationalStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import ServiceMapGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
import getJestMockFunction, { MockFunction } from "../../MockType";

const mockFitView: MockFunction = getJestMockFunction();
mockFitView.mockReturnValue(true);
const mockSetQuery: MockFunction = getJestMockFunction();
mockSetQuery.mockImplementation((values: Record<string, string | null>) => {
  const url: URL = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.replaceState({}, "", url.toString());
});
let mockStatuses: Map<string, ServiceOperationalStatus> = new Map<
  string,
  ServiceOperationalStatus
>();

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
jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getFirstParam: () => {
        return null;
      },
      getQueryStringByName: (key: string) => {
        return new URLSearchParams(window.location.search).get(key);
      },
      setQueryString: (values: Record<string, string | null>) => {
        mockSetQuery(values);
      },
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay",
  () => {
    return {
      fetchServiceOperationalStatuses: async () => {
        return mockStatuses;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entity: InventoryItem;
        onClose: () => void;
        onFocus: (key: string) => void;
        onSelectEntity?: (key: string) => void;
      }) => {
        return (
          <div role="dialog" aria-label="Service details">
            <p>{props.entity.displayName}</p>
            <button onClick={props.onClose}>Close service</button>
            <button
              onClick={() => {
                props.onFocus(props.entity.entityKey!);
              }}
            >
              Focus this service
            </button>
            <button
              onClick={() => {
                props.onSelectEntity?.("db");
              }}
            >
              View related service
            </button>
          </div>
        );
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: { onClose: () => void }) => {
        return (
          <div role="dialog" aria-label="Connection details">
            <button onClick={props.onClose}>Close connection</button>
          </div>
        );
      },
    };
  },
);
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    MarkerType: { ArrowClosed: "arrowclosed" },
    BackgroundVariant: { Dots: "dots" },
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: { Top: "top", Bottom: "bottom" },
    default: (props: {
      nodes: Array<{ id: string; data: { label: string; dimmed: boolean } }>;
      edges: Array<{ id: string; label?: string; animated?: boolean }>;
      onInit: (value: unknown) => void;
      onNodeClick: (event: React.MouseEvent, node: unknown) => void;
      onEdgeClick: (event: React.MouseEvent, edge: unknown) => void;
    }) => {
      React.useEffect(() => {
        props.onInit({ fitView: mockFitView });
      }, []);
      return (
        <div data-testid="rendered-graph">
          {props.nodes.map(
            (node: {
              id: string;
              data: { label: string; dimmed: boolean };
            }) => {
              return (
                <button
                  key={node.id}
                  data-testid={`map-node-${node.id}`}
                  data-context={String(node.data.dimmed)}
                  onClick={(event: React.MouseEvent) => {
                    props.onNodeClick(event, node);
                  }}
                >
                  {node.data.label}
                </button>
              );
            },
          )}
          {props.edges.map(
            (edge: { id: string; label?: string; animated?: boolean }) => {
              return (
                <button
                  key={edge.id}
                  data-testid={`map-edge-${edge.id}`}
                  data-animated={String(edge.animated)}
                  onClick={(event: React.MouseEvent) => {
                    props.onEdgeClick(event, edge);
                  }}
                >
                  {edge.label || "Connection"}
                </button>
              );
            },
          )}
        </div>
      );
    },
  };
});

const SERVICES: Array<InventoryItem> = [
  "web",
  "api",
  "db",
  "archive",
  "worker",
].map((key: string) => {
  return {
    entityKey: key,
    displayName: key,
    entityType: EntityType.Service,
  } as InventoryItem;
});
function edge(
  from: string,
  to: string,
  calls: number,
  errors: number,
): InventoryItemRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.DependsOn,
    callCount: calls,
    errorCount: errors,
    avgDurationMs: 25,
  } as InventoryItemRelationship;
}
const RELATIONSHIPS: Array<InventoryItemRelationship> = [
  edge("web", "api", 100, 6),
  edge("api", "db", 100, 0),
  edge("db", "archive", 100, 0),
];

async function renderGraph(
  entities: Array<InventoryItem> = SERVICES,
  relationships: Array<InventoryItemRelationship> = RELATIONSHIPS,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ServiceMapGraph
          entities={entities}
          relationships={relationships}
          metricsWindowSeconds={60}
          timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  mockStatuses = new Map<string, ServiceOperationalStatus>();
  mockSetQuery.mockClear();
  mockFitView.mockClear();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("service directory interactions", () => {
  const largeCatalog: Array<InventoryItem> = Array.from(
    { length: 1000 },
    (_value: unknown, index: number) => {
      const key: string = `service-${String(index).padStart(4, "0")}`;
      return {
        entityKey: key,
        displayName: key,
        entityType: EntityType.Service,
      } as InventoryItem;
    },
  );

  test("large catalogs render 40 services per page with working navigation", async () => {
    await renderGraph(largeCatalog, []);
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(40);
    expect(screen.getByTestId("service-map-pagination")).toHaveTextContent(
      "Showing 1–40 of 1000 services",
    );
    expect(
      screen.getByRole("button", { name: "Previous service page" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next service page" }));
    expect(screen.getByTestId("service-map-pagination")).toHaveTextContent(
      "Showing 41–80 of 1000 services",
    );
    expect(
      screen.getByRole("button", { name: "service-0040", exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "service-0000", exact: true }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Previous service page" }),
    );
    expect(
      screen.getByRole("button", { name: "service-0000", exact: true }),
    ).toBeInTheDocument();
  });

  test("search finds services beyond the current page and resets pagination", async () => {
    await renderGraph(largeCatalog, []);
    fireEvent.click(screen.getByRole("button", { name: "Next service page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "0999" },
    });
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "service-0999", exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("service-map-pagination"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-map-reset-filters"));
    expect(screen.getByTestId("service-map-pagination")).toHaveTextContent(
      "Showing 1–40 of 1000 services",
    );
  });

  test("connection navigation in the drawer selects the related service", async () => {
    await renderGraph();
    fireEvent.click(screen.getByRole("button", { name: "api", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "View related service" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Service details" }),
    ).toHaveTextContent("db");
  });
  test("a fresh project explains how to discover services and provides setup documentation", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <ServiceMapGraph
            entities={[]}
            relationships={[]}
            metricsWindowSeconds={60}
            timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
          />
        </MemoryRouter>,
      );
    });
    expect(screen.getByText("No services discovered yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View telemetry setup documentation/ }),
    ).toHaveAttribute("href");
    expect(screen.queryByTestId("service-map-list")).not.toBeInTheDocument();
  });

  test("operational incidents are included in attention and take precedence over traffic status", async () => {
    mockStatuses.set("worker", {
      serviceId: "worker-id",
      activeIncidentCount: 2,
      worstIncidentSeverityName: "Critical",
      worstIncidentSeverityColor: "#dc2626",
      incidents: [],
      activeAlertCount: 1,
      worstAlertSeverityName: "Warning",
      worstAlertSeverityColor: "#f59e0b",
      alerts: [],
    });
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-attention-filter"));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(2);
    expect(screen.getByText("2 active incidents")).toBeInTheDocument();
  });

  test("starts with a readable list and summary instead of a miniature graph", async () => {
    await renderGraph();
    expect(screen.getByTestId("service-map-view-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(5);
    expect(screen.queryByTestId("service-map-canvas")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-map-summary")).toHaveTextContent(
      "Without connections",
    );
    expect(screen.getAllByTestId("service-map-list-row")[0]).toHaveTextContent(
      "api",
    );
    expect(screen.getByTestId("service-map-result-count")).toHaveTextContent(
      "5 of 5 services",
    );
  });

  test("search removes unrelated list rows and reports result count", async () => {
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "API" },
    });
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(1);
    expect(screen.getByTestId("service-map-list-row")).toHaveTextContent("api");
    expect(screen.getByTestId("service-map-result-count")).toHaveTextContent(
      "1 of 5 services",
    );
  });

  test("search updates the shareable URL once typing pauses", async () => {
    jest.useFakeTimers();
    await renderGraph();
    const search: HTMLElement = screen.getByRole("textbox", {
      name: "Search services",
    });
    fireEvent.change(search, { target: { value: "a" } });
    fireEvent.change(search, { target: { value: "api" } });
    expect(window.location.search).toBe("");
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(window.location.search).toContain("search=api");
    expect(mockSetQuery).toHaveBeenCalledTimes(1);
  });

  test("a search miss gives a clear recovery action", async () => {
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "missing" },
    });
    expect(
      screen.getByText("No services match your filters"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(5);
    expect(
      screen.getByRole("textbox", { name: "Search services" }),
    ).toHaveValue("");
  });

  test("attention filtering leaves only affected services in the list", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-attention-filter"));
    expect(screen.getByTestId("service-map-attention-filter")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(1);
    expect(screen.getByTestId("service-map-list-row")).toHaveTextContent(
      "High error rate",
    );
    fireEvent.click(screen.getByTestId("service-map-reset-filters"));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(5);
  });

  test("no incoming traffic is distinguished from healthy traffic", async () => {
    await renderGraph();
    const workerRow: HTMLElement = screen
      .getByRole("button", { name: "worker", exact: true })
      .closest("tr")!;
    expect(workerRow).toHaveTextContent("No incoming calls");
    expect(workerRow).not.toHaveTextContent("No call errors");
    expect(workerRow).toHaveTextContent("0 callers · 0 dependencies");
  });

  test("service names open details and drawer focus opens its dependency map", async () => {
    await renderGraph();
    fireEvent.click(screen.getByRole("button", { name: "api", exact: true }));
    expect(
      screen.getByRole("dialog", { name: "Service details" }),
    ).toHaveTextContent("api");
    fireEvent.click(screen.getByRole("button", { name: "Focus this service" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-map-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText("Direct connections of", { exact: false }),
    ).toHaveTextContent("api");
    expect(screen.getByTestId("map-node-web")).toBeInTheDocument();
    expect(screen.queryByTestId("map-node-archive")).not.toBeInTheDocument();
  });
});

describe("dependency map interactions", () => {
  test("view connections reveals only direct callers and dependencies", async () => {
    await renderGraph();
    fireEvent.click(
      screen.getByRole("button", { name: "View connections for api" }),
    );
    expect(screen.getByTestId("map-node-api")).toBeInTheDocument();
    expect(screen.getByTestId("map-node-web")).toBeInTheDocument();
    expect(screen.getByTestId("map-node-db")).toBeInTheDocument();
    expect(screen.queryByTestId("map-node-archive")).not.toBeInTheDocument();
    expect(window.location.search).toContain("serviceView=map");
    expect(window.location.search).toContain("focus=api");
    fireEvent.click(screen.getByTestId("service-map-clear-focus"));
    expect(screen.getByTestId("map-node-archive")).toBeInTheDocument();
    expect(screen.getByTestId("map-node-worker")).toBeInTheDocument();
  });

  test("saved map URLs restore map selection, search and focus", async () => {
    window.history.replaceState(
      {},
      "",
      "/?serviceView=map&focus=api&search=api",
    );
    await renderGraph();
    expect(screen.getByTestId("service-map-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Search services" }),
    ).toHaveValue("api");
    expect(screen.getByTestId("map-node-web")).toHaveAttribute(
      "data-context",
      "true",
    );
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-context",
      "false",
    );
    expect(screen.queryByTestId("map-node-archive")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-map-result-count")).toHaveTextContent(
      "2 connected services for context",
    );
  });

  test("map metrics stay quiet until selected, with no animated edges", async () => {
    window.history.replaceState({}, "", "/?serviceView=map");
    await renderGraph();
    const connection: HTMLElement = screen.getByTestId("map-edge-web->api");
    expect(connection).toHaveTextContent("Connection");
    expect(connection).toHaveAttribute("data-animated", "false");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Connection labels" }),
      { target: { value: "errors" } },
    );
    expect(connection).toHaveTextContent("6.0% errors");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Connection labels" }),
      { target: { value: "latency" } },
    );
    expect(connection).toHaveTextContent("25ms");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Connection labels" }),
      { target: { value: "calls" } },
    );
    expect(connection).toHaveTextContent("100/min");
  });

  test("service and connection drawers remain exclusive", async () => {
    window.history.replaceState({}, "", "/?serviceView=map");
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    expect(
      screen.getByRole("dialog", { name: "Service details" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-edge-web->api"));
    expect(
      screen.queryByRole("dialog", { name: "Service details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Connection details" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-node-web"));
    expect(
      screen.queryByRole("dialog", { name: "Connection details" }),
    ).not.toBeInTheDocument();
  });

  test("reframes new search matches even when their node count is unchanged", async () => {
    window.history.replaceState({}, "", "/?serviceView=map");
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "web" },
    });
    mockFitView.mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "archive" },
    });
    expect(mockFitView).toHaveBeenCalled();
    expect(screen.getByTestId("map-node-archive")).toBeInTheDocument();
    expect(screen.queryByTestId("map-node-web")).not.toBeInTheDocument();
  });

  test("fit-to-screen control provides an explicit way to recover the viewport", async () => {
    window.history.replaceState({}, "", "/?serviceView=map");
    await renderGraph();
    mockFitView.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(mockFitView).toHaveBeenCalledWith({
      padding: 0.18,
      maxZoom: 1,
      duration: 300,
    });
  });

  test("switching back to the list preserves current search", async () => {
    window.history.replaceState({}, "", "/?serviceView=map&search=api");
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(1);
    expect(
      within(screen.getByTestId("service-map-list-row")).getByRole("button", {
        name: "api",
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(window.location.search).not.toContain("serviceView");
  });

  test("unmount cancels a pending search URL update instead of leaking it to another tab", async () => {
    jest.useFakeTimers();
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "api" },
    });
    cleanup();
    mockSetQuery.mockClear();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(mockSetQuery).not.toHaveBeenCalled();
  });
});

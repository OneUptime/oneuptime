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
import EntitySource from "../../../Types/Telemetry/EntitySource";
import TimeRange from "../../../Types/Time/TimeRange";
import { ServiceOperationalStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import ServiceMapGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Service Map component: what a person sees first, how they narrow it
 * down, and how they get to details. Graph drawing itself (React Flow) is
 * replaced by a stand-in that renders nodes and edges as buttons, so these
 * tests exercise the component's decisions, not the canvas.
 */

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
        traffic?: { statusLabel: string; subtitle: string };
        onClose: () => void;
        onFocus: (key: string) => void;
        onSelectEntity?: (key: string) => void;
      }) => {
        return (
          <div role="dialog" aria-label="Service details">
            <p>{props.entity.displayName}</p>
            <p data-testid="drawer-status">{props.traffic?.statusLabel}</p>
            <p data-testid="drawer-subtitle">{props.traffic?.subtitle}</p>
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
                props.onSelectEntity?.("postgres");
              }}
            >
              View related dependency
            </button>
            <button
              onClick={() => {
                props.onSelectEntity?.("pod-1");
              }}
            >
              View placement
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
      default: (props: {
        onClose: () => void;
        fromEntity: InventoryItem;
        toEntity: InventoryItem;
      }) => {
        return (
          <div role="dialog" aria-label="Connection details">
            <p>
              {props.fromEntity.displayName} → {props.toEntity.displayName}
            </p>
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
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    default: (props: {
      nodes: Array<{
        id: string;
        position: { x: number; y: number };
        data: { label: string; dimmed: boolean; footer?: string };
      }>;
      edges: Array<{
        id: string;
        label?: string;
        animated?: boolean;
        labelShowBg?: boolean;
        labelStyle?: React.CSSProperties;
        labelBgStyle?: React.CSSProperties;
        labelBgPadding?: [number, number];
        labelBgBorderRadius?: number;
      }>;
      onInit: (value: unknown) => void;
      onNodeClick: (event: React.MouseEvent, node: unknown) => void;
      onEdgeClick: (event: React.MouseEvent, edge: unknown) => void;
      onEdgeMouseEnter: (event: React.MouseEvent, edge: unknown) => void;
      onEdgeMouseLeave: () => void;
    }) => {
      React.useEffect(() => {
        props.onInit({ fitView: mockFitView });
      }, []);
      return (
        <div data-testid="rendered-graph">
          {props.nodes.map(
            (node: {
              id: string;
              position: { x: number; y: number };
              data: { label: string; dimmed: boolean; footer?: string };
            }) => {
              return (
                <button
                  key={node.id}
                  data-testid={`map-node-${node.id}`}
                  data-context={String(node.data.dimmed)}
                  data-x={String(node.position.x)}
                  data-footer={node.data.footer || ""}
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
            (edge: {
              id: string;
              label?: string;
              animated?: boolean;
              labelShowBg?: boolean;
              labelStyle?: React.CSSProperties;
              labelBgStyle?: React.CSSProperties;
              labelBgPadding?: [number, number];
              labelBgBorderRadius?: number;
            }) => {
              return (
                <button
                  key={edge.id}
                  data-testid={`map-edge-${edge.id}`}
                  data-animated={String(edge.animated)}
                  data-label-show-background={String(edge.labelShowBg)}
                  data-label-color={String(edge.labelStyle?.fill || "")}
                  data-label-background={String(edge.labelBgStyle?.fill || "")}
                  data-label-background-opacity={String(
                    edge.labelBgStyle?.fillOpacity || "",
                  )}
                  data-label-border={String(edge.labelBgStyle?.stroke || "")}
                  data-label-border-width={String(
                    edge.labelBgStyle?.strokeWidth || "",
                  )}
                  data-label-padding={edge.labelBgPadding?.join(",") || ""}
                  data-label-border-radius={String(
                    edge.labelBgBorderRadius || "",
                  )}
                  onClick={(event: React.MouseEvent) => {
                    props.onEdgeClick(event, edge);
                  }}
                  onMouseEnter={(event: React.MouseEvent) => {
                    props.onEdgeMouseEnter(event, edge);
                  }}
                  onMouseLeave={() => {
                    props.onEdgeMouseLeave();
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

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");

function item(
  key: string,
  type: EntityType,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    entityKey: key,
    displayName: key,
    entityType: type,
    source: EntitySource.Discovered,
    lastSeenAt: NOW,
    ...overrides,
  } as InventoryItem;
}

function edge(
  from: string,
  to: string,
  calls?: number,
  errors?: number,
  type: EntityRelationshipType = EntityRelationshipType.DependsOn,
): InventoryItemRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: type,
    callCount: calls,
    errorCount: errors,
    avgDurationMs: calls === undefined ? undefined : 25,
  } as InventoryItemRelationship;
}

const ENTITIES: Array<InventoryItem> = [
  item("web", EntityType.Service),
  item("api", EntityType.Service),
  item("worker", EntityType.Service),
  item("postgres", EntityType.Database, {
    descriptiveAttributes: { "db.system.name": "postgresql" },
  }),
  item("pod-1", EntityType.KubernetesPod),
  item("legacy", EntityType.Service, {
    lastSeenAt: new Date("2026-08-01T00:00:00Z"),
  }),
];

const RELATIONSHIPS: Array<InventoryItemRelationship> = [
  edge("web", "api", 600, 60),
  edge("api", "postgres", 900, 0),
  edge("api", "pod-1", undefined, undefined, EntityRelationshipType.RunsOn),
];

async function renderGraph(
  options: {
    entities?: Array<InventoryItem>;
    relationships?: Array<InventoryItemRelationship>;
    includeInactive?: boolean;
    onOpenInfrastructure?: (key: string) => void;
  } = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ServiceMapGraph
          entities={options.entities || ENTITIES}
          relationships={options.relationships || RELATIONSHIPS}
          metricsWindowSeconds={60}
          timeRange={{ range: TimeRange.PAST_ONE_DAY }}
          rangeStart={RANGE_START}
          includeInactive={options.includeInactive}
          onOpenInfrastructure={options.onOpenInfrastructure}
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

describe("first impression", () => {
  test("a fresh project explains how to discover services", async () => {
    await renderGraph({ entities: [], relationships: [] });
    expect(screen.getByText("No services discovered yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View telemetry setup documentation/ }),
    ).toHaveAttribute("href");
  });

  test("opens on the map, drawing services and the databases they call", async () => {
    await renderGraph();
    expect(screen.getByTestId("service-map-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("map-node-web")).toBeInTheDocument();
    expect(screen.getByTestId("map-node-api")).toBeInTheDocument();
    expect(screen.getByTestId("map-node-postgres")).toBeInTheDocument();
    expect(screen.queryByTestId("map-node-pod-1")).not.toBeInTheDocument();
    // Callers sit left of what they call.
    expect(
      Number(screen.getByTestId("map-node-web").getAttribute("data-x")),
    ).toBeLessThan(
      Number(screen.getByTestId("map-node-api").getAttribute("data-x")),
    );
  });

  test("summarizes services, dependencies, connections and attention", async () => {
    await renderGraph();
    const summary: HTMLElement = screen.getByTestId("service-map-summary");
    expect(summary).toHaveTextContent("Services3");
    expect(summary).toHaveTextContent("1 inactive not shown");
    expect(summary).toHaveTextContent("Dependencies1");
    expect(summary).toHaveTextContent("Connections2");
    expect(summary).toHaveTextContent("Need attention1");
  });

  test("services with no calls are listed beside the map, not scattered on it", async () => {
    await renderGraph();
    expect(screen.queryByTestId("map-node-worker")).not.toBeInTheDocument();
    const tray: HTMLElement = screen.getByTestId("service-map-unconnected");
    expect(tray).toHaveTextContent("Not connected to anything in this view");
    fireEvent.click(within(tray).getByRole("button", { name: /worker/ }));
    expect(
      screen.getByRole("dialog", { name: "Service details" }),
    ).toHaveTextContent("worker");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "No calls observed",
    );
  });

  test("where a service runs is part of its card", async () => {
    await renderGraph();
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-footer",
      "Runs on 1 pod",
    );
    expect(screen.getByTestId("map-node-postgres")).toHaveAttribute(
      "data-footer",
      "Called by 1 service",
    );
  });
});

describe("a project with services but no observed calls", () => {
  const entities: Array<InventoryItem> = [
    item("dashboard", EntityType.Service),
    item("probe", EntityType.Service),
  ];

  test("explains how calls are discovered and still lists every service", async () => {
    await renderGraph({ entities, relationships: [] });
    const explainer: HTMLElement = screen.getByTestId(
      "service-map-no-connections",
    );
    expect(explainer).toHaveTextContent(
      "No calls between services in this time range",
    );
    expect(explainer).toHaveTextContent("traceparent");
    expect(explainer).toHaveTextContent("db.system.name");
    expect(explainer).toHaveTextContent("eBPF");
    expect(
      within(explainer).getByRole("link", { name: /Set up tracing/ }),
    ).toHaveAttribute("href");
    expect(screen.getAllByTestId("service-map-unconnected-item")).toHaveLength(
      2,
    );
    expect(screen.queryByTestId("service-map-canvas")).not.toBeInTheDocument();
  });
});

describe("activity", () => {
  test("show inactive brings back services that did not report", async () => {
    await renderGraph({ includeInactive: true });
    expect(screen.getByTestId("service-map-summary")).toHaveTextContent(
      "Services4",
    );
    expect(
      within(screen.getByTestId("service-map-unconnected")).getByRole(
        "button",
        { name: /legacy/ },
      ),
    ).toBeInTheDocument();
  });

  test("when nothing reported at all, says so instead of showing an empty map", async () => {
    await renderGraph({
      entities: [
        item("legacy", EntityType.Service, {
          lastSeenAt: new Date("2026-08-01T00:00:00Z"),
        }),
      ],
      relationships: [],
    });
    expect(screen.getByTestId("service-map-no-results")).toHaveTextContent(
      "No service reported in the selected time range",
    );
  });
});

describe("narrowing the map", () => {
  test("search keeps matches and dims their neighbours as context", async () => {
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "postgres" },
    });
    expect(screen.getByTestId("map-node-postgres")).toHaveAttribute(
      "data-context",
      "false",
    );
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-context",
      "true",
    );
    expect(screen.queryByTestId("map-node-web")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-map-result-count")).toHaveTextContent(
      "1 of 4 items · 1 connected for context",
    );
  });

  test("a search miss offers a way back", async () => {
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "missing" },
    });
    expect(
      screen.getByText("No services match your filters"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("map-node-web")).toBeInTheDocument();
  });

  test("needs attention keeps only the services with trouble", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-attention-filter"));
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(1);
    expect(screen.getByTestId("service-map-list-row")).toHaveTextContent(
      "High error rate",
    );
    fireEvent.click(screen.getByTestId("service-map-reset-filters"));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(4);
  });

  test("search reaches the URL once typing pauses, and never after unmount", async () => {
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

    fireEvent.change(search, { target: { value: "web" } });
    cleanup();
    mockSetQuery.mockClear();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(mockSetQuery).not.toHaveBeenCalled();
  });

  test("focus from a shared link shows one node's direct connections", async () => {
    window.history.replaceState({}, "", "/?focus=postgres");
    await renderGraph();
    expect(
      screen.getByText("Direct connections of", { exact: false }),
    ).toHaveTextContent("postgres");
    expect(screen.getByTestId("map-node-api")).toBeInTheDocument();
    expect(screen.queryByTestId("map-node-web")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-map-clear-focus"));
    expect(screen.getByTestId("map-node-web")).toBeInTheDocument();
  });

  test("a new set of matches is re-framed", async () => {
    await renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "web" },
    });
    mockFitView.mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "postgres" },
    });
    expect(mockFitView).toHaveBeenCalled();
  });

  test("fit to screen recovers the viewport", async () => {
    await renderGraph();
    mockFitView.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(mockFitView).toHaveBeenCalledWith({
      padding: 0.18,
      maxZoom: 1,
      duration: 300,
    });
  });
});

describe("connections", () => {
  test("labels appear on hover by default and on demand for every edge", async () => {
    await renderGraph();
    const connection: HTMLElement = screen.getByTestId("map-edge-web->api");
    expect(connection).toHaveTextContent("Connection");
    expect(connection).toHaveAttribute("data-animated", "false");
    fireEvent.mouseEnter(connection);
    expect(screen.getByTestId("map-edge-web->api")).toHaveTextContent(
      "600/min",
    );
    fireEvent.mouseLeave(screen.getByTestId("map-edge-web->api"));
    expect(screen.getByTestId("map-edge-web->api")).toHaveTextContent(
      "Connection",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Connection labels" }),
      { target: { value: "errors" } },
    );
    expect(screen.getByTestId("map-edge-web->api")).toHaveTextContent(
      "10.0% errors",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Connection labels" }),
      { target: { value: "latency" } },
    );
    expect(screen.getByTestId("map-edge-api->postgres")).toHaveTextContent(
      "25ms",
    );
  });

  test("connection metric chips use theme-aware readable styling", async () => {
    await renderGraph();

    const expectReadableMetricChip: (connection: HTMLElement) => void = (
      connection: HTMLElement,
    ): void => {
      expect(connection).toHaveAttribute("data-label-show-background", "true");
      expect(connection).toHaveAttribute(
        "data-label-color",
        "var(--ou-text-secondary, #4b5563)",
      );
      expect(connection).toHaveAttribute(
        "data-label-background",
        "var(--ou-surface-primary, #ffffff)",
      );
      expect(connection).toHaveAttribute("data-label-background-opacity", "1");
      expect(connection).toHaveAttribute(
        "data-label-border",
        "var(--ou-border-default, #e5e7eb)",
      );
      expect(connection).toHaveAttribute("data-label-border-width", "1");
      expect(connection).toHaveAttribute("data-label-padding", "6,3");
      expect(connection).toHaveAttribute("data-label-border-radius", "6");
    };

    const hoveredConnection: HTMLElement =
      screen.getByTestId("map-edge-web->api");
    fireEvent.mouseEnter(hoveredConnection);
    expect(hoveredConnection).toHaveTextContent("600/min");
    expectReadableMetricChip(hoveredConnection);

    for (const metric of ["calls", "errors", "latency"]) {
      fireEvent.change(
        screen.getByRole("combobox", { name: "Connection labels" }),
        { target: { value: metric } },
      );
      expectReadableMetricChip(screen.getByTestId("map-edge-api->postgres"));
    }
  });

  test("service and connection drawers are exclusive", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    expect(
      screen.getByRole("dialog", { name: "Service details" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-edge-api->postgres"));
    expect(
      screen.queryByRole("dialog", { name: "Service details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Connection details" }),
    ).toHaveTextContent("api → postgres");
    fireEvent.click(screen.getByTestId("map-node-web"));
    expect(
      screen.queryByRole("dialog", { name: "Connection details" }),
    ).not.toBeInTheDocument();
  });
});

describe("details", () => {
  test("the drawer navigates to map nodes and hands infrastructure to its own view", async () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    await renderGraph({ onOpenInfrastructure });
    fireEvent.click(screen.getByTestId("map-node-api"));
    expect(screen.getByTestId("drawer-subtitle")).toHaveTextContent("Service");
    fireEvent.click(
      screen.getByRole("button", { name: "View related dependency" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Service details" }),
    ).toHaveTextContent("postgres");
    expect(screen.getByTestId("drawer-subtitle")).toHaveTextContent(
      "Database · PostgreSQL",
    );
    fireEvent.click(screen.getByRole("button", { name: "View placement" }));
    expect(onOpenInfrastructure).toHaveBeenCalledWith("pod-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("focusing from the drawer opens that node's connections on the map", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    fireEvent.click(
      screen.getByRole("button", { name: "postgres", exact: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus this service" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-map-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.location.search).toContain("focus=postgres");
    expect(screen.queryByTestId("map-node-web")).not.toBeInTheDocument();
  });

  test("incidents take precedence over traffic in status", async () => {
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
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(screen.getByText("2 active incidents")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-map-attention-filter"));
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(2);
  });
});

describe("table", () => {
  test("describes entry points, dependencies and quiet services in words", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(window.location.search).toContain("serviceView=list");
    const row: (name: string) => HTMLElement = (name: string): HTMLElement => {
      return screen
        .getByRole("button", { name, exact: true })
        .closest("tr") as HTMLElement;
    };
    expect(row("web")).toHaveTextContent("Entry point");
    expect(row("web")).toHaveTextContent("0 callers · 1 dependency");
    expect(row("postgres")).toHaveTextContent("Database · PostgreSQL");
    expect(row("postgres")).toHaveTextContent("Healthy");
    expect(row("worker")).toHaveTextContent("No calls observed");
    expect(row("api")).toHaveTextContent("Service · 1 pod");
  });

  test("a large catalog opens as a paged table with a hint to narrow it", async () => {
    const many: Array<InventoryItem> = Array.from(
      { length: 130 },
      (_value: unknown, index: number) => {
        return item(
          `service-${String(index).padStart(3, "0")}`,
          EntityType.Service,
        );
      },
    );
    await renderGraph({ entities: many, relationships: [] });
    expect(screen.getByTestId("service-map-view-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(/too many services to draw at once/),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(40);
    expect(screen.getByTestId("service-map-pagination")).toHaveTextContent(
      "Showing 1–40 of 130",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      screen.getByRole("button", { name: "service-040", exact: true }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "service-129" },
    });
    expect(screen.getAllByTestId("service-map-list-row")).toHaveLength(1);
    expect(
      screen.queryByTestId("service-map-pagination"),
    ).not.toBeInTheDocument();
    // A narrowed result is small enough to draw again.
    fireEvent.click(
      screen.getByRole("button", { name: "Show on map service-129" }),
    );
    expect(screen.getByTestId("service-map-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

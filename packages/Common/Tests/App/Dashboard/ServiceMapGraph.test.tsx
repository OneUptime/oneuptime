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
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import TimeRange from "../../../Types/Time/TimeRange";
import { ServiceOperationalStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import ServiceMapGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
import {
  EntityDetailTarget,
  TopologyEntity,
  TopologyRelationship,
  TopologyRunsOnCount,
  TopologyRunsOnCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Service Map component: what a person sees first, how they narrow it
 * down, and how they get to details. Graph drawing itself (React Flow) is
 * replaced by a stand-in that renders nodes and edges as buttons, and the
 * detail drawer (which fetches its own connections) by a stand-in that
 * records the props it was given, so these tests exercise the component's
 * decisions, not the canvas or the drawer.
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
/* Every drawer instance, by the entity it was mounted for. */
const mockDrawerMounts: Array<string> = [];
/* The props of the drawer as last rendered. */
let mockDrawerProps: Record<string, unknown> | null = null;

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
/*
 * The drawer's props contract: a preview of the entity (it fetches the rest
 * itself), the server's range start, and callbacks. Its connection rows are
 * stood in for by buttons that call back the way the real rows do: a
 * "runs on" row opens the Infrastructure view when it can, every other row
 * asks the map to select what it points at.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
  () => {
    type Target = {
      entityKey: string;
      entityType?: string;
      displayName?: string;
    };
    return {
      __esModule: true,
      default: (props: {
        entity: Target;
        rangeStart?: Date | null;
        traffic?: { statusLabel: string; subtitle: string };
        incidentStatus?: { activeIncidentCount: number } | null;
        onClose: () => void;
        onFocus?: (key: string) => void;
        focusButtonLabel?: string;
        onSelectEntity?: (target: Target) => void;
        onOpenInfrastructure?: (key: string) => void;
      }) => {
        mockDrawerProps = props as unknown as Record<string, unknown>;
        const [mountedFor] = React.useState<string>(props.entity.entityKey);
        React.useEffect(() => {
          mockDrawerMounts.push(props.entity.entityKey);
        }, []);
        const select: (target: Target) => void = (target: Target): void => {
          props.onSelectEntity?.(target);
        };
        return (
          <div
            role="dialog"
            aria-label="Service details"
            data-mounted-for={mountedFor}
          >
            <p data-testid="drawer-name">
              {props.entity.displayName || props.entity.entityKey}
            </p>
            <p data-testid="drawer-type">{props.entity.entityType || ""}</p>
            <p data-testid="drawer-status">{props.traffic?.statusLabel}</p>
            <p data-testid="drawer-subtitle">{props.traffic?.subtitle}</p>
            <p data-testid="drawer-incidents">
              {String(props.incidentStatus?.activeIncidentCount ?? "none")}
            </p>
            <button onClick={props.onClose}>Close service</button>
            {props.onFocus ? (
              <button
                onClick={() => {
                  props.onFocus?.(props.entity.entityKey);
                }}
              >
                {props.focusButtonLabel || "Focus"}
              </button>
            ) : (
              <></>
            )}
            <button
              onClick={() => {
                select({
                  entityKey: "postgres",
                  entityType: "database",
                  displayName: "postgres",
                });
              }}
            >
              View related dependency
            </button>
            <button
              onClick={() => {
                select({
                  entityKey: "web",
                  entityType: "service",
                  displayName: "web",
                });
              }}
            >
              View caller
            </button>
            <button
              onClick={() => {
                select({
                  entityKey: "legacy",
                  entityType: "service",
                  displayName: "legacy",
                });
              }}
            >
              View inactive caller
            </button>
            <button
              onClick={() => {
                select({
                  entityKey: "api-instance-1",
                  entityType: "service.instance",
                  displayName: "api-instance-1",
                });
              }}
            >
              View related instance
            </button>
            <button
              onClick={() => {
                select({ entityKey: "mystery-key" });
              }}
            >
              View untyped resource
            </button>
            <button
              onClick={() => {
                select({
                  entityKey: "node-7",
                  entityType: "k8s.node",
                  displayName: "node-7",
                });
              }}
            >
              View related node
            </button>
            <button
              onClick={() => {
                if (props.onOpenInfrastructure) {
                  props.onOpenInfrastructure("pod-1");
                } else {
                  select({
                    entityKey: "pod-1",
                    entityType: "k8s.pod",
                    displayName: "pod-1",
                  });
                }
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
        fromEntity: TopologyEntity;
        toEntity: TopologyEntity;
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
  type: EntityType | string,
  overrides: Partial<TopologyEntity> = {},
): TopologyEntity {
  return {
    entityKey: key,
    displayName: key,
    entityType: type,
    source: EntitySource.Discovered,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function edge(
  from: string,
  to: string,
  calls?: number,
  errors?: number,
  type: EntityRelationshipType = EntityRelationshipType.DependsOn,
): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: type,
    callCount: calls,
    errorCount: errors,
    avgDurationMs: calls === undefined ? undefined : 25,
  };
}

function runsOn(
  entityType: string,
  active: number,
  total: number,
): TopologyRunsOnCount {
  return { entityType, active, total };
}

/*
 * What the Service Map payload carries: services, what they call and the
 * depends-on rows between them — no pods or hosts. Where services run comes
 * as counts.
 */
const ENTITIES: Array<TopologyEntity> = [
  item("web", EntityType.Service),
  item("api", EntityType.Service),
  item("worker", EntityType.Service),
  item("postgres", EntityType.Database, {
    descriptiveAttributes: { "db.system.name": "postgresql" },
  }),
  item("legacy", EntityType.Service, {
    lastSeenAt: new Date("2026-08-01T00:00:00Z"),
  }),
];

const RELATIONSHIPS: Array<TopologyRelationship> = [
  edge("web", "api", 600, 60),
  edge("api", "postgres", 900, 0),
];

const RUNS_ON_COUNTS: TopologyRunsOnCounts = new Map<
  string,
  Array<TopologyRunsOnCount>
>([
  ["api", [runsOn(EntityType.KubernetesPod, 1, 3)]],
  ["worker", [runsOn(EntityType.Host, 0, 2)]],
  ["legacy", [runsOn(EntityType.Host, 0, 1)]],
]);

async function renderGraph(
  options: {
    entities?: Array<TopologyEntity>;
    relationships?: Array<TopologyRelationship>;
    /* null renders without counts, the way full rows are fed. */
    runsOnCounts?: TopologyRunsOnCounts | null;
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
          runsOnCounts={
            options.runsOnCounts === undefined
              ? RUNS_ON_COUNTS
              : options.runsOnCounts || undefined
          }
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

function drawer(): HTMLElement {
  return screen.getByRole("dialog", { name: "Service details" });
}

function drawerTarget(): EntityDetailTarget {
  return mockDrawerProps!["entity"] as EntityDetailTarget;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  mockStatuses = new Map<string, ServiceOperationalStatus>();
  mockSetQuery.mockClear();
  mockFitView.mockClear();
  mockDrawerMounts.length = 0;
  mockDrawerProps = null;
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

describe("where services run", () => {
  test("comes from the server's counts of what reported in the range", async () => {
    await renderGraph();
    // api runs on 1 active pod of 3; web has no counts at all.
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-footer",
      "Runs on 1 pod",
    );
    expect(screen.getByTestId("map-node-web")).toHaveAttribute(
      "data-footer",
      "",
    );
    // worker runs on 2 hosts, neither of which reported: nothing to say.
    expect(
      within(screen.getByTestId("service-map-unconnected")).getByRole(
        "button",
        { name: /worker/ },
      ),
    ).toHaveTextContent(/^workerService$/);
  });

  test("counts every resource when inactive ones are shown", async () => {
    await renderGraph({ includeInactive: true });
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-footer",
      "Runs on 3 pods",
    );
    const tray: HTMLElement = screen.getByTestId("service-map-unconnected");
    expect(
      within(tray).getByRole("button", { name: /worker/ }),
    ).toHaveTextContent("Service · 2 hosts");
    expect(
      within(tray).getByRole("button", { name: /legacy/ }),
    ).toHaveTextContent("Service · 1 host");
  });

  test("reads several types most first, in the table too", async () => {
    await renderGraph({
      runsOnCounts: new Map<string, Array<TopologyRunsOnCount>>([
        [
          "api",
          [
            runsOn(EntityType.Host, 2, 2),
            runsOn(EntityType.KubernetesPod, 12, 12),
          ],
        ],
      ]),
    });
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-footer",
      "Runs on 12 pods · 2 hosts",
    );
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(
      screen.getByRole("button", { name: "api", exact: true }).closest("tr"),
    ).toHaveTextContent("Service · 12 pods · 2 hosts");
  });

  test("without counts, is counted from runs-on rows to resources it was given", async () => {
    await renderGraph({
      entities: [
        ...ENTITIES,
        item("pod-1", EntityType.KubernetesPod),
        item("pod-2", EntityType.KubernetesPod),
        item("old-host", EntityType.Host, {
          lastSeenAt: new Date("2026-08-01T00:00:00Z"),
        }),
      ],
      relationships: [
        ...RELATIONSHIPS,
        edge(
          "api",
          "pod-1",
          undefined,
          undefined,
          EntityRelationshipType.RunsOn,
        ),
        edge(
          "api",
          "pod-2",
          undefined,
          undefined,
          EntityRelationshipType.RunsOn,
        ),
        edge(
          "api",
          "old-host",
          undefined,
          undefined,
          EntityRelationshipType.HostedOn,
        ),
      ],
      runsOnCounts: null,
    });
    expect(screen.getByTestId("map-node-api")).toHaveAttribute(
      "data-footer",
      "Runs on 2 pods",
    );
    // Infrastructure is never a node of the Service Map.
    expect(screen.queryByTestId("map-node-pod-1")).not.toBeInTheDocument();
  });
});

describe("a project with services but no observed calls", () => {
  const entities: Array<TopologyEntity> = [
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
  test("the drawer opens on a preview of the node and the server's range start", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    expect(drawer()).toHaveAttribute("data-mounted-for", "api");
    expect(drawerTarget()).toEqual({
      entityKey: "api",
      entityType: EntityType.Service,
      displayName: "api",
    });
    expect(mockDrawerProps!["rangeStart"]).toBe(RANGE_START);
    expect(mockDrawerProps!["metricsWindowSeconds"]).toBe(60);
    expect(mockDrawerProps!["focusButtonLabel"]).toBe("Show its connections");
    expect(screen.getByTestId("drawer-subtitle")).toHaveTextContent("Service");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "High error rate",
    );
    // The drawer fetches connections itself: the map hands it no rows.
    expect(mockDrawerProps).not.toHaveProperty("relationships");
    expect(mockDrawerProps).not.toHaveProperty("entityByKey");
  });

  test("an unnamed node's preview leaves naming to the drawer", async () => {
    await renderGraph({
      entities: [
        item("svc", EntityType.Service, { displayName: undefined }),
        item("db", EntityType.Database, { displayName: undefined }),
      ],
      relationships: [edge("svc", "db", 5, 0)],
    });
    fireEvent.click(screen.getByTestId("map-node-db"));
    expect(drawerTarget()).toEqual({
      entityKey: "db",
      entityType: EntityType.Database,
      displayName: undefined,
    });
  });

  test("a row pointing at a node of the map selects that node", async () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    await renderGraph({ onOpenInfrastructure });
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(
      screen.getByRole("button", { name: "View related dependency" }),
    );
    expect(drawer()).toHaveAttribute("data-mounted-for", "postgres");
    expect(screen.getByTestId("drawer-name")).toHaveTextContent("postgres");
    expect(screen.getByTestId("drawer-subtitle")).toHaveTextContent(
      "Database · PostgreSQL",
    );
    // A new drawer for the new node, never the old one re-used.
    expect(mockDrawerMounts).toEqual(["api", "postgres"]);
    expect(onOpenInfrastructure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View caller" }));
    expect(screen.getByTestId("drawer-name")).toHaveTextContent("web");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "Entry point",
    );
    expect(mockDrawerMounts).toEqual(["api", "postgres", "web"]);
  });

  test("a runs-on row opens the Infrastructure view and closes the drawer", async () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    await renderGraph({ onOpenInfrastructure });
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(screen.getByRole("button", { name: "View placement" }));
    expect(onOpenInfrastructure).toHaveBeenCalledTimes(1);
    expect(onOpenInfrastructure).toHaveBeenCalledWith("pod-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("any other infrastructure a row points at opens in the Infrastructure view", async () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    await renderGraph({ onOpenInfrastructure });
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(screen.getByRole("button", { name: "View related node" }));
    expect(onOpenInfrastructure).toHaveBeenCalledWith("node-7");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("without an Infrastructure view, infrastructure opens in the drawer", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(screen.getByRole("button", { name: "View placement" }));
    expect(drawer()).toHaveAttribute("data-mounted-for", "pod-1");
    expect(drawerTarget()).toEqual({
      entityKey: "pod-1",
      entityType: EntityType.KubernetesPod,
      displayName: "pod-1",
    });
    // Not a node of this map: no traffic, and nothing to focus on.
    expect(screen.getByTestId("drawer-status")).toBeEmptyDOMElement();
    expect(mockDrawerProps!["onFocus"]).toBeUndefined();
    expect(mockDrawerProps!["onOpenInfrastructure"]).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Show its connections" }),
    ).not.toBeInTheDocument();
  });

  test("a service that is not on the map opens in the drawer, not elsewhere", async () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    await renderGraph({ onOpenInfrastructure });
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(
      screen.getByRole("button", { name: "View inactive caller" }),
    );
    expect(onOpenInfrastructure).not.toHaveBeenCalled();
    expect(drawer()).toHaveAttribute("data-mounted-for", "legacy");
    expect(drawerTarget()).toEqual({
      entityKey: "legacy",
      entityType: EntityType.Service,
      displayName: "legacy",
    });
    expect(screen.getByTestId("drawer-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("drawer-incidents")).toHaveTextContent("none");
    expect(
      screen.queryByRole("button", { name: "Show its connections" }),
    ).not.toBeInTheDocument();
  });

  test("application types and untyped resources open in the drawer", async () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    await renderGraph({ onOpenInfrastructure });
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(
      screen.getByRole("button", { name: "View related instance" }),
    );
    expect(drawer()).toHaveAttribute("data-mounted-for", "api-instance-1");
    fireEvent.click(
      screen.getByRole("button", { name: "View untyped resource" }),
    );
    expect(drawer()).toHaveAttribute("data-mounted-for", "mystery-key");
    expect(drawerTarget()).toEqual({ entityKey: "mystery-key" });
    expect(onOpenInfrastructure).not.toHaveBeenCalled();
  });

  test("from a drawer off the map, rows and the map lead back onto it", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(
      screen.getByRole("button", { name: "View inactive caller" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View related dependency" }),
    );
    expect(drawer()).toHaveAttribute("data-mounted-for", "postgres");
    expect(
      screen.getByRole("button", { name: "Show its connections" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "View inactive caller" }),
    );
    fireEvent.click(screen.getByTestId("map-node-web"));
    expect(drawer()).toHaveAttribute("data-mounted-for", "web");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "Entry point",
    );
  });

  test("a connection closes a drawer that is open off the map", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(
      screen.getByRole("button", { name: "View inactive caller" }),
    );
    fireEvent.click(screen.getByTestId("map-edge-api->postgres"));
    expect(
      screen.queryByRole("dialog", { name: "Service details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Connection details" }),
    ).toBeInTheDocument();
  });

  test("with inactive services shown, the same service is a node again", async () => {
    await renderGraph({ includeInactive: true });
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(
      screen.getByRole("button", { name: "View inactive caller" }),
    );
    expect(drawer()).toHaveAttribute("data-mounted-for", "legacy");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "No calls observed",
    );
    expect(
      screen.getByRole("button", { name: "Show its connections" }),
    ).toBeInTheDocument();
  });

  test("closing the drawer clears the selection", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    fireEvent.click(screen.getByRole("button", { name: "Close service" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-node-api"));
    expect(mockDrawerMounts).toEqual(["api", "api"]);
  });

  test("focusing from the drawer opens that node's connections on the map", async () => {
    await renderGraph();
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    fireEvent.click(
      screen.getByRole("button", { name: "postgres", exact: true }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show its connections" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-map-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.location.search).toContain("focus=postgres");
    expect(screen.queryByTestId("map-node-web")).not.toBeInTheDocument();
  });

  test("a service's incidents reach its drawer; a dependency's never do", async () => {
    mockStatuses.set("api", {
      serviceId: "api-id",
      activeIncidentCount: 2,
      worstIncidentSeverityName: "Critical",
      worstIncidentSeverityColor: "#dc2626",
      incidents: [],
      activeAlertCount: 0,
      worstAlertSeverityName: null,
      worstAlertSeverityColor: null,
      alerts: [],
    });
    mockStatuses.set("postgres", {
      serviceId: "postgres-id",
      activeIncidentCount: 5,
      worstIncidentSeverityName: "Critical",
      worstIncidentSeverityColor: "#dc2626",
      incidents: [],
      activeAlertCount: 0,
      worstAlertSeverityName: null,
      worstAlertSeverityColor: null,
      alerts: [],
    });
    await renderGraph();
    fireEvent.click(screen.getByTestId("map-node-api"));
    expect(screen.getByTestId("drawer-incidents")).toHaveTextContent("2");
    fireEvent.click(
      screen.getByRole("button", { name: "View related dependency" }),
    );
    expect(screen.getByTestId("drawer-incidents")).toHaveTextContent("none");
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
    const many: Array<TopologyEntity> = Array.from(
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

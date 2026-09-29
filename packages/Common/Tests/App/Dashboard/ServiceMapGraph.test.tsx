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
import {
  Edge,
  FitViewOptions,
  Node,
  NodeChange,
  ReactFlowInstance,
  Viewport,
} from "reactflow";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import TimeRange from "../../../Types/Time/TimeRange";
import { ComponentProps as FlowViewportGuardProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewportGuard";
import {
  FlowExtent,
  UNBOUNDED_FLOW_EXTENT,
  noticeOffsetInCanvas,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewport";
import { ServiceOperationalStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import ServiceMapGraph, {
  OUT_OF_VIEW_NOTICE_DELAY_MS,
  SERVICE_MAP_PAN_MARGIN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
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
 * down, how they get to details, and how the map stays on its canvas.
 *
 * Graph drawing itself (React Flow) is replaced by a stand-in that renders
 * nodes and edges as buttons, renders its children and records every props
 * object it is given, so a test can tell a rebuilt nodes array from the one
 * handed back unchanged; its Controls record their props too. The viewport
 * guard (which reads React Flow's store) is replaced by a stand-in that keeps
 * the real guard's side of the contract with the map: it reports a React
 * Flow instance once the viewport is ready and, on unmount, withdraws it and
 * reports the drawing in view and the pan extent unbounded. What the real
 * guard measures on a canvas (the pan extent, whether the drawing is in
 * view) the tests report through the props it was last given, and a pan or
 * zoom by hand through React Flow's recorded onMoveStart and onMoveEnd, the
 * way React Flow reports one. The detail drawer (which fetches its own
 * connections) is a stand-in that records the props it was given, and a
 * background tab is stood in for by shadowing document.visibilityState.
 * jsdom lays nothing out, so where the canvas is on screen, the window's
 * height and the out-of-view notice's height are stood in for as well (see
 * standInForLayout). So these tests exercise the component's decisions, not
 * the canvas, the guard or the drawer.
 */

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
/*
 * While set, the operational overlay answers only once this settles, so a
 * test can have the cards drawn (and measured) before the overlay arrives
 * and draws them again.
 */
let mockStatusesReady: Promise<void> | null = null;
/*
 * Every drawer instance, by the entity it was mounted for. The map keeps one
 * drawer while the user moves between entities (a remount would replay the
 * slide-in and drop keyboard focus), so a new entry means a new drawer.
 */
const mockDrawerMounts: Array<string> = [];
/* The props of the drawer as last rendered. */
let mockDrawerProps: Record<string, unknown> | null = null;

/* What the map hands React Flow, as far as these tests look at it. */
interface MockFlowProps {
  nodes: Array<Node>;
  edges: Array<Edge>;
  children?: React.ReactNode;
  translateExtent?: FlowExtent;
  minZoom?: number;
  maxZoom?: number;
  zoomOnScroll?: boolean;
  zoomOnPinch?: boolean;
  panOnScroll?: boolean;
  preventScrolling?: boolean;
  zoomOnDoubleClick?: boolean;
  nodesDraggable?: boolean;
  fitView?: boolean;
  onInit?: (instance: ReactFlowInstance) => void;
  onNodesChange: (changes: Array<NodeChange>) => void;
  /*
   * React Flow reports a pan or zoom by hand (one with a source event) as it
   * starts, and again as it ends if the transform changed at all. A move it
   * makes itself (a fit, a zoom button, setViewport) reports neither.
   */
  onMoveStart: (event: MouseEvent | TouchEvent, viewport: Viewport) => void;
  onMoveEnd: (event: MouseEvent | TouchEvent, viewport: Viewport) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
  onEdgeMouseEnter: (event: React.MouseEvent, edge: Edge) => void;
  onEdgeMouseLeave: (event: React.MouseEvent, edge: Edge) => void;
}

/* What the map hands React Flow's zoom and fit buttons. */
interface MockControlsProps {
  showInteractive?: boolean;
  fitViewOptions?: FitViewOptions;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

/* The part of a React Flow instance the map uses. */
interface MockFlowInstance {
  fitView: MockFunction;
  viewportInitialized: boolean;
}

/* Every props object React Flow was rendered with, oldest first. */
const mockFlowRenders: Array<MockFlowProps> = [];
/* How many times React Flow was mounted: each one draws the canvas afresh. */
let mockFlowMounts: number = 0;
/* The props of React Flow's controls as last rendered. */
let mockControlsProps: MockControlsProps | null = null;
/* The props of the viewport guard as last rendered. */
let mockGuardProps: FlowViewportGuardProps | null = null;
/* One instance per mount of the viewport guard, oldest first. */
const mockFlowInstances: Array<MockFlowInstance> = [];
/*
 * Whether a newly mounted canvas has a usable viewport. The real guard
 * reports no instance until it has one.
 */
let mockViewportInitialized: boolean = true;
/*
 * What document.visibilityState says while a test stands in for the tab
 * (see setTabVisibility), or null while jsdom's own getter answers: jsdom's
 * tab is always visible.
 */
let mockTabVisibility: DocumentVisibilityState | null = null;
/*
 * Hands jsdom back what a test stood in for with standInForLayout, run by
 * afterEach, last first.
 */
const mockLayoutRestores: Array<() => void> = [];

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
        if (mockStatusesReady) {
          await mockStatusesReady;
        }
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
            data-entity-key={props.entity.entityKey}
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
/*
 * The viewport guard, keeping the real guard's side of its contract with
 * the map: it reports the live React Flow instance once the viewport is
 * ready (none until then) and, on unmount, withdraws it and reports the
 * drawing in view and the pan extent unbounded. Each mount reports an
 * instance of its own, so a test can tell the canvas on screen from one
 * that is gone.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewportGuard",
  () => {
    return {
      __esModule: true,
      default: (props: FlowViewportGuardProps) => {
        mockGuardProps = props;
        const latest: React.MutableRefObject<FlowViewportGuardProps> =
          React.useRef<FlowViewportGuardProps>(props);
        latest.current = props;
        React.useEffect(() => {
          const instance: MockFlowInstance = {
            fitView: getJestMockFunction().mockReturnValue(true),
            viewportInitialized: mockViewportInitialized,
          };
          mockFlowInstances.push(instance);
          latest.current.onInstance(
            instance.viewportInitialized
              ? (instance as unknown as ReactFlowInstance)
              : null,
          );
          return () => {
            latest.current.onInstance(null);
            latest.current.onDrawingInViewChange(true);
            latest.current.onExtentChange(UNBOUNDED_FLOW_EXTENT);
          };
        }, []);
        return <></>;
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
    Controls: (props: MockControlsProps) => {
      mockControlsProps = props;
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    default: (props: MockFlowProps) => {
      mockFlowRenders.push(props);
      React.useEffect(() => {
        mockFlowMounts += 1;
      }, []);
      return (
        <div data-testid="rendered-graph">
          {props.nodes.map((node: Node) => {
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
          })}
          {props.edges.map((edge: Edge) => {
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
                onMouseLeave={(event: React.MouseEvent) => {
                  props.onEdgeMouseLeave(event, edge);
                }}
              >
                {edge.label || "Connection"}
              </button>
            );
          })}
          {props.children}
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

/* How every fit of the map frames it: the guard, the toolbar, the controls. */
const MAP_FRAMING: FitViewOptions = { padding: 0.18, maxZoom: 1 };
/* Fit to screen: the same framing, animated. */
const ANIMATED_FIT: FitViewOptions = {
  padding: 0.18,
  maxZoom: 1,
  duration: 300,
};

/* The props React Flow was last rendered with. */
function flowProps(): MockFlowProps {
  const latest: MockFlowProps | undefined =
    mockFlowRenders[mockFlowRenders.length - 1];
  if (!latest) {
    throw new Error("React Flow was never rendered");
  }
  return latest;
}

/* The props the viewport guard was last rendered with. */
function guardProps(): FlowViewportGuardProps {
  if (!mockGuardProps) {
    throw new Error("The viewport guard was never rendered");
  }
  return mockGuardProps;
}

/* The props React Flow's controls were last rendered with. */
function controlsProps(): MockControlsProps {
  if (!mockControlsProps) {
    throw new Error("React Flow's controls were never rendered");
  }
  return mockControlsProps;
}

/* The instance of the guard mounted `index`-th, reported or withheld. */
function flowInstance(index: number): MockFlowInstance {
  const instance: MockFlowInstance | undefined = mockFlowInstances[index];
  if (!instance) {
    throw new Error(`No viewport guard was mounted at #${index}`);
  }
  return instance;
}

/* The instance the guard of the canvas on screen reported. */
function liveInstance(): MockFlowInstance {
  const instance: MockFlowInstance = flowInstance(mockFlowInstances.length - 1);
  expect(instance.viewportInitialized).toBe(true);
  return instance;
}

function nodeById(nodes: Array<Node>, id: string): Node {
  const node: Node | undefined = nodes.find((candidate: Node): boolean => {
    return candidate.id === id;
  });
  if (!node) {
    throw new Error(`No node ${id} was drawn`);
  }
  return node;
}

function edgeById(edges: Array<Edge>, id: string): Edge {
  const found: Edge | undefined = edges.find((candidate: Edge): boolean => {
    return candidate.id === id;
  });
  if (!found) {
    throw new Error(`No edge ${id} was drawn`);
  }
  return found;
}

function idsOf(nodes: Array<Node>): Array<string> {
  return nodes.map((node: Node): string => {
    return node.id;
  });
}

/* The guard's report of whether any of the drawing is on the canvas. */
function reportDrawingInView(inView: boolean): void {
  act(() => {
    guardProps().onDrawingInViewChange(inView);
  });
}

/* Let time pass on the fake clock. */
function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function outOfViewNotice(): HTMLElement | null {
  return screen.queryByTestId("service-map-out-of-view");
}

/* The out-of-view notice's own box: its message and its button. */
function outOfViewNoticeBox(): HTMLElement {
  return within(screen.getByTestId("service-map-out-of-view")).getByRole(
    "status",
  );
}

/*
 * The page, as far as placing the out-of-view notice goes. jsdom lays
 * nothing out: every box it measures is empty, and its window is always 768
 * pixels high.
 */
interface PageLayout {
  /* The canvas's top, down from the window's: negative once scrolled past. */
  canvasTop: number;
  canvasHeight: number;
  /* The window's height (window.innerHeight). */
  windowHeight: number;
  /* The notice's own height, once it is drawn. */
  noticeHeight: number;
}

/* The notice's box, for the stand-in for its height. */
const OUT_OF_VIEW_NOTICE_BOX: string =
  '[data-testid="service-map-out-of-view"] > [role="status"]';

/*
 * Lay the page out as `page` says, for the rest of the test. The canvas's
 * box, the window's height and the notice's height are read from it each
 * time they are measured, so changing it lays the page out anew. Returns
 * the canvas's measurements, one call each.
 */
function standInForLayout(page: PageLayout): MockFunction {
  const measureCanvas: MockFunction = getJestMockFunction().mockImplementation(
    (): DOMRect => {
      const box: Omit<DOMRect, "toJSON"> = {
        x: 0,
        y: page.canvasTop,
        left: 0,
        top: page.canvasTop,
        right: 1024,
        bottom: page.canvasTop + page.canvasHeight,
        width: 1024,
        height: page.canvasHeight,
      };
      return {
        ...box,
        toJSON: (): Omit<DOMRect, "toJSON"> => {
          return box;
        },
      };
    },
  );
  // The canvas goes at cleanup, and its stand-in with it.
  screen.getByTestId("service-map-canvas").getBoundingClientRect =
    measureCanvas;

  const jsdomWindowHeight: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    get: (): number => {
      return page.windowHeight;
    },
  });
  const jsdomOffsetHeight: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    enumerable: true,
    get(this: HTMLElement): number {
      if (this.matches(OUT_OF_VIEW_NOTICE_BOX)) {
        return page.noticeHeight;
      }
      return jsdomOffsetHeight?.get
        ? Number(jsdomOffsetHeight.get.call(this))
        : 0;
    },
  });

  mockLayoutRestores.push((): void => {
    if (jsdomWindowHeight) {
      Object.defineProperty(window, "innerHeight", jsdomWindowHeight);
    } else {
      Reflect.deleteProperty(window, "innerHeight");
    }
    if (jsdomOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        jsdomOffsetHeight,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
    }
  });
  return measureCanvas;
}

/* The page scrolling: the document, or an element the page scrolls in. */
function scrollPage(scroller: Document | HTMLElement = document): void {
  fireEvent.scroll(scroller);
}

/* The browser window being resized. */
function resizeWindow(): void {
  fireEvent(window, new Event("resize"));
}

/* The browser drawing its next frame: one every 16 ms on the fake clock. */
function nextFrame(): void {
  advance(16);
}

/*
 * A view the automatic framing left a large map in, as React Flow reported
 * it in a browser: the whole drawing fitted at an eighth of its size, where
 * the pan extent pins it.
 */
const FRAMED_VIEW: Viewport = { x: 720.3138, y: 67.1186, zoom: 0.1269 };
/*
 * The same view as React Flow reports it after a press on it: d3-zoom
 * re-applies the pan extent on every pointer move, and the view comes back
 * a rounding error from where it was.
 */
const FRAMED_VIEW_AFTER_PRESS: Viewport = {
  x: 720.3138,
  y: 67.11864406779664,
  zoom: 0.1269,
};
/*
 * A view the automatic framing left a smaller map in: drawn at full size,
 * where the pan extent leaves the view a little room, so the pointer's slip
 * during a click pans it. (Its coordinates are exact in binary, so a slip of
 * exactly 4 px is 4 px, not a rounding error either side of it.)
 */
const SMALL_MAP_VIEW: Viewport = { x: 296.5, y: 104.25, zoom: 1 };

/* React Flow reporting that a pan or zoom by hand began, and where. */
function startGesture(at: Viewport): void {
  act(() => {
    flowProps().onMoveStart(new MouseEvent("mousedown"), at);
  });
}

/* React Flow reporting where a pan or zoom by hand left the view. */
function endGesture(at: Viewport): void {
  act(() => {
    flowProps().onMoveEnd(new MouseEvent("mouseup"), at);
  });
}

/* A whole pan or zoom by hand: where it began, then where it came to rest. */
function gesture(from: Viewport, to: Viewport): void {
  startGesture(from);
  endGesture(to);
}

/*
 * Put the page in a tab that is hidden or seen, without telling it so. The
 * getter shadows jsdom's (on Document.prototype) until afterEach hands the
 * document its own back.
 */
function setTabVisibility(state: DocumentVisibilityState): void {
  if (mockTabVisibility === null) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): DocumentVisibilityState => {
        return mockTabVisibility || "visible";
      },
    });
  }
  mockTabVisibility = state;
}

/* The browser hiding or showing the tab, and telling the page so. */
function changeTabVisibility(state: DocumentVisibilityState): void {
  setTabVisibility(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  mockStatuses = new Map<string, ServiceOperationalStatus>();
  mockStatusesReady = null;
  mockSetQuery.mockClear();
  mockDrawerMounts.length = 0;
  mockDrawerProps = null;
  mockFlowRenders.length = 0;
  mockFlowMounts = 0;
  mockControlsProps = null;
  mockGuardProps = null;
  mockFlowInstances.length = 0;
  mockViewportInitialized = true;
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  if (mockTabVisibility !== null) {
    // Drop the shadowing getter: jsdom's own, on the prototype, answers again.
    Reflect.deleteProperty(document, "visibilityState");
    mockTabVisibility = null;
  }
  for (const restore of mockLayoutRestores.splice(0).reverse()) {
    restore();
  }
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
    const webDrawing: string = guardProps().drawingKey;
    expect(webDrawing.split("|").sort()).toEqual(["api", "web"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "postgres" },
    });
    /*
     * The guard frames the drawing again whenever the one it is handed
     * changes, once React Flow holds it: the key names exactly the cards
     * React Flow was given, in order.
     */
    expect(guardProps().drawingKey).not.toBe(webDrawing);
    expect(guardProps().drawingKey).toBe(idsOf(flowProps().nodes).join("|"));
    expect(guardProps().drawingKey.split("|").sort()).toEqual([
      "api",
      "postgres",
    ]);
    expect(guardProps().fitViewOptions).toEqual(MAP_FRAMING);
    // The canvas on screen re-frames; it is not drawn again from scratch.
    expect(mockFlowMounts).toBe(1);
  });

  test("fit to screen recovers the viewport", async () => {
    await renderGraph();
    const instance: MockFlowInstance = liveInstance();
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(instance.fitView).toHaveBeenCalledTimes(1);
    expect(instance.fitView).toHaveBeenCalledWith({
      padding: 0.18,
      maxZoom: 1,
      duration: 300,
    });
    // It fitted, so the canvas is left as it is.
    expect(mockFlowMounts).toBe(1);
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
    expect(drawer()).toHaveAttribute("data-entity-key", "api");
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
    expect(drawer()).toHaveAttribute("data-entity-key", "postgres");
    expect(screen.getByTestId("drawer-name")).toHaveTextContent("postgres");
    expect(screen.getByTestId("drawer-subtitle")).toHaveTextContent(
      "Database · PostgreSQL",
    );
    // The open drawer carries on to the new node: never a remount.
    expect(mockDrawerMounts).toEqual(["api"]);
    expect(drawer()).toHaveAttribute("data-mounted-for", "api");
    expect(onOpenInfrastructure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View caller" }));
    expect(screen.getByTestId("drawer-name")).toHaveTextContent("web");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "Entry point",
    );
    expect(mockDrawerMounts).toEqual(["api"]);
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
    expect(drawer()).toHaveAttribute("data-entity-key", "pod-1");
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
    expect(drawer()).toHaveAttribute("data-entity-key", "legacy");
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
    expect(drawer()).toHaveAttribute("data-entity-key", "api-instance-1");
    fireEvent.click(
      screen.getByRole("button", { name: "View untyped resource" }),
    );
    expect(drawer()).toHaveAttribute("data-entity-key", "mystery-key");
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
    expect(drawer()).toHaveAttribute("data-entity-key", "postgres");
    expect(
      screen.getByRole("button", { name: "Show its connections" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "View inactive caller" }),
    );
    fireEvent.click(screen.getByTestId("map-node-web"));
    expect(drawer()).toHaveAttribute("data-entity-key", "web");
    expect(screen.getByTestId("drawer-status")).toHaveTextContent(
      "Entry point",
    );
    /* Rows and map clicks alike moved the one open drawer along. */
    expect(mockDrawerMounts).toEqual(["api"]);
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
    expect(drawer()).toHaveAttribute("data-entity-key", "legacy");
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

/*
 * Issue #4117: the map went blank at random and only a page reload brought
 * it back. Hovering a connection handed React Flow a new array of cards
 * without their sizes, which could leave every card unmeasured (hidden) for
 * good; and the wheel, a double-click or a dragged card could carry the
 * drawing off the canvas with nothing to bring it back. The map now builds
 * cards only when they change and hands back the sizes React Flow measured,
 * leaves the wheel to the page, holds the view to the drawing the guard
 * measured, says when none of the drawing is in view, and draws the canvas
 * again when a fit cannot bring it back.
 *
 * The view stays the automatic framing, which the guard fits again when the
 * canvas is resized, until a gesture really moves it: a press on a map the
 * pan extent pins in place comes back a rounding error away, and React Flow
 * reports that as a move. The out-of-view notice sits at the canvas's
 * top-left, and a map drawn in a background tab (where nothing is measured)
 * is judged only once the tab is seen.
 */
describe("keeping the map on screen (issue #4117)", () => {
  test("the wheel scrolls the page, a double-click does not zoom and cards cannot be dragged away", async () => {
    await renderGraph();
    const flow: MockFlowProps = flowProps();
    expect(flow.zoomOnScroll).toBe(false);
    expect(flow.preventScrolling).toBe(false);
    expect(flow.panOnScroll).not.toBe(true);
    // React Flow reads Ctrl + wheel as a pinch, so both still zoom.
    expect(flow.zoomOnPinch).not.toBe(false);
    expect(flow.zoomOnDoubleClick).toBe(false);
    // Holding a card past the edge used to pan the whole map away.
    expect(flow.nodesDraggable).toBe(false);
    // Framing is the guard's, once React Flow has measured the drawing.
    expect(flow.fitView).toBeUndefined();
    expect(flow.onInit).toBeUndefined();
  });

  test("hovering or selecting a connection redraws connections, never the cards", async () => {
    await renderGraph();
    const cards: Array<Node> = flowProps().nodes;
    const connections: Array<Edge> = flowProps().edges;
    const rendersBefore: number = mockFlowRenders.length;

    fireEvent.mouseEnter(screen.getByTestId("map-edge-web->api"));
    expect(screen.getByTestId("map-edge-web->api")).toHaveTextContent(
      "600/min",
    );
    expect(flowProps().edges).not.toBe(connections);
    fireEvent.mouseLeave(screen.getByTestId("map-edge-web->api"));
    expect(screen.getByTestId("map-edge-web->api")).toHaveTextContent(
      "Connection",
    );

    fireEvent.click(screen.getByTestId("map-edge-api->postgres"));
    expect(
      screen.getByRole("dialog", { name: "Connection details" }),
    ).toBeInTheDocument();
    // The selected connection is drawn thicker...
    expect(
      Number(edgeById(flowProps().edges, "api->postgres").style?.strokeWidth),
    ).toBeGreaterThan(
      Number(edgeById(connections, "api->postgres").style?.strokeWidth),
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Connection labels" }),
      { target: { value: "latency" } },
    );
    expect(screen.getByTestId("map-edge-api->postgres")).toHaveTextContent(
      "25ms",
    );

    // ...but not one of these renders handed React Flow new cards.
    const renders: Array<MockFlowProps> = mockFlowRenders.slice(rendersBefore);
    expect(renders.length).toBeGreaterThanOrEqual(4);
    for (const flowRender of renders) {
      expect(flowRender.nodes).toBe(cards);
    }
  });

  test("sizes React Flow measured are handed back on every card drawn again", async () => {
    await renderGraph();
    const unmeasured: Array<Node> = flowProps().nodes;
    expect(nodeById(unmeasured, "web")).not.toHaveProperty("width");
    act(() => {
      flowProps().onNodesChange([
        {
          id: "web",
          type: "dimensions",
          dimensions: { width: 256, height: 110 },
        },
        {
          id: "api",
          type: "dimensions",
          dimensions: { width: 256, height: 128 },
        },
        // A card that grew is measured again; the latest size is the one kept.
        {
          id: "api",
          type: "dimensions",
          dimensions: { width: 256, height: 146 },
        },
      ]);
    });

    // Selecting a card draws every card again.
    fireEvent.click(screen.getByTestId("map-node-api"));
    const redrawn: Array<Node> = flowProps().nodes;
    expect(redrawn).not.toBe(unmeasured);
    expect(nodeById(redrawn, "api").data.selected).toBe(true);
    expect(nodeById(redrawn, "web")).toMatchObject({ width: 256, height: 110 });
    expect(nodeById(redrawn, "api")).toMatchObject({ width: 256, height: 146 });
    // A card React Flow has not measured yet is left for it to measure.
    expect(nodeById(redrawn, "postgres")).not.toHaveProperty("width");
    expect(nodeById(redrawn, "postgres")).not.toHaveProperty("height");
  });

  test("cards drawn again when the incident overlay arrives keep their measured sizes", async () => {
    let releaseOverlay: () => void = (): void => {};
    mockStatusesReady = new Promise<void>((resolve: () => void): void => {
      releaseOverlay = resolve;
    });
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
    await renderGraph();
    const drawn: Array<Node> = flowProps().nodes;
    expect(nodeById(drawn, "api").data.entry.incidentCount).toBe(0);
    act(() => {
      flowProps().onNodesChange(
        drawn.map((node: Node): NodeChange => {
          return {
            id: node.id,
            type: "dimensions",
            dimensions: { width: 256, height: 128 },
          };
        }),
      );
    });

    // The overlay lands just after React Flow measured the cards.
    await act(async () => {
      releaseOverlay();
    });
    const redrawn: Array<Node> = flowProps().nodes;
    expect(redrawn).not.toBe(drawn);
    expect(nodeById(redrawn, "api").data.entry.incidentCount).toBe(2);
    expect(idsOf(redrawn)).toEqual(idsOf(drawn));
    for (const node of redrawn) {
      expect(node).toMatchObject({ width: 256, height: 128 });
    }
  });

  test("only a real measured size is kept: other changes and empty sizes are not", async () => {
    await renderGraph();
    const before: Array<Node> = flowProps().nodes;
    act(() => {
      flowProps().onNodesChange([
        { id: "web", type: "position", position: { x: 40, y: 40 } },
        { id: "web", type: "select", selected: true },
        { id: "api", type: "dimensions" },
        {
          id: "api",
          type: "dimensions",
          dimensions: { width: 0, height: 0 },
        },
        {
          id: "postgres",
          type: "dimensions",
          dimensions: { width: 256, height: 0 },
        },
        { id: "postgres", type: "remove" },
      ]);
    });
    fireEvent.click(screen.getByTestId("map-node-web"));
    expect(flowProps().nodes).not.toBe(before);
    for (const node of flowProps().nodes) {
      expect(node).not.toHaveProperty("width");
      expect(node).not.toHaveProperty("height");
    }
  });

  test("the view pans within the drawing the guard measured, and a new canvas starts unbounded", async () => {
    await renderGraph();
    // Until the guard has measured the drawing there is nothing to hold to.
    expect(flowProps().translateExtent).toEqual(UNBOUNDED_FLOW_EXTENT);
    expect(guardProps().panMargin).toBe(SERVICE_MAP_PAN_MARGIN);
    /*
     * The slack around the drawing is less than the least the canvas ever
     * shows, so the view cannot come to rest in it with no card in sight.
     */
    const canvasHeight: number = parseFloat(
      screen.getByTestId("service-map-canvas").style.height,
    );
    expect(SERVICE_MAP_PAN_MARGIN).toBeGreaterThan(0);
    expect(SERVICE_MAP_PAN_MARGIN).toBeLessThan(
      canvasHeight / (flowProps().maxZoom || 1),
    );

    const measured: FlowExtent = [
      [-128, -128],
      [1060, 404],
    ];
    act(() => {
      guardProps().onExtentChange(measured);
    });
    expect(flowProps().translateExtent).toBe(measured);

    fireEvent.click(screen.getByTestId("service-map-view-list"));
    const rendersBefore: number = mockFlowRenders.length;
    fireEvent.click(screen.getByTestId("service-map-view-map"));
    expect(mockFlowMounts).toBe(2);
    /*
     * The old drawing's extent must not hold the new canvas before its
     * guard has measured the new drawing.
     */
    expect(mockFlowRenders[rendersBefore]?.translateExtent).toEqual(
      UNBOUNDED_FLOW_EXTENT,
    );
    expect(flowProps().translateExtent).toEqual(UNBOUNDED_FLOW_EXTENT);
  });

  test("moving the view by hand ends the automatic framing; fitting restores it", async () => {
    await renderGraph();
    const autoFrame: React.MutableRefObject<boolean> = guardProps().autoFrame;
    expect(autoFrame.current).toBe(true);

    // A pan or zoom by hand: a resized canvas no longer re-frames the map.
    gesture(FRAMED_VIEW, { x: 120, y: -40, zoom: 0.6 });
    expect(autoFrame.current).toBe(false);
    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(autoFrame.current).toBe(true);

    act(() => {
      controlsProps().onZoomIn();
    });
    expect(autoFrame.current).toBe(false);
    act(() => {
      controlsProps().onFitView();
    });
    expect(autoFrame.current).toBe(true);
    act(() => {
      controlsProps().onZoomOut();
    });
    expect(autoFrame.current).toBe(false);

    // Every fit frames the map the same way, whichever button asked.
    expect(controlsProps().fitViewOptions).toEqual(MAP_FRAMING);
    expect(controlsProps().showInteractive).toBe(false);
    expect(guardProps().fitViewOptions).toEqual(MAP_FRAMING);
    expect(guardProps().autoFrame).toBe(autoFrame);
  });

  test("a press that leaves the view where it was keeps the automatic framing", async () => {
    await renderGraph();
    const autoFrame: React.MutableRefObject<boolean> = guardProps().autoFrame;

    /*
     * A press, or a drag attempt, on a map the pan extent pins in place:
     * nothing moved, but React Flow reports the view a rounding error away.
     * Taking that for a move left the next narrower window with the drawing
     * off the canvas.
     */
    gesture(FRAMED_VIEW, FRAMED_VIEW_AFTER_PRESS);
    expect(autoFrame.current).toBe(true);

    // Nor does a zoom change of 0.05%.
    gesture(FRAMED_VIEW, { ...FRAMED_VIEW, zoom: FRAMED_VIEW.zoom * 1.0005 });
    expect(autoFrame.current).toBe(true);
  });

  test("the slip of a click, up to 4 px each way, keeps the automatic framing", async () => {
    await renderGraph();
    const autoFrame: React.MutableRefObject<boolean> = guardProps().autoFrame;
    /*
     * The pointer slips a pixel or two during a click, and where the pan
     * extent leaves the view room, the view slips with it. Taking that for
     * the user's move left the drawing clipped by the next narrower window.
     * The slop allowed is 4 px along each axis, the drag threshold operating
     * systems use.
     */
    const slips: Array<[string, Viewport]> = [
      ["a pixel right", { ...SMALL_MAP_VIEW, x: SMALL_MAP_VIEW.x + 1 }],
      ["a pixel up", { ...SMALL_MAP_VIEW, y: SMALL_MAP_VIEW.y - 1 }],
      ["4 px left", { ...SMALL_MAP_VIEW, x: SMALL_MAP_VIEW.x - 4 }],
      ["4 px down", { ...SMALL_MAP_VIEW, y: SMALL_MAP_VIEW.y + 4 }],
      [
        "4 px right and 4 px up",
        { ...SMALL_MAP_VIEW, x: SMALL_MAP_VIEW.x + 4, y: SMALL_MAP_VIEW.y - 4 },
      ],
      [
        "4 px left and 0.05% closer",
        {
          x: SMALL_MAP_VIEW.x - 4,
          y: SMALL_MAP_VIEW.y,
          zoom: SMALL_MAP_VIEW.zoom * 1.0005,
        },
      ],
    ];
    for (const [slip, to] of slips) {
      gesture(SMALL_MAP_VIEW, to);
      expect([slip, autoFrame.current]).toEqual([slip, true]);
    }
  });

  test("a pan of more than 4 px or a zoom of 0.2% ends the automatic framing", async () => {
    await renderGraph();
    const autoFrame: React.MutableRefObject<boolean> = guardProps().autoFrame;
    const moves: Array<[string, Viewport]> = [
      ["4.1 px right", { ...SMALL_MAP_VIEW, x: SMALL_MAP_VIEW.x + 4.1 }],
      ["4.1 px left", { ...SMALL_MAP_VIEW, x: SMALL_MAP_VIEW.x - 4.1 }],
      ["4.1 px up", { ...SMALL_MAP_VIEW, y: SMALL_MAP_VIEW.y - 4.1 }],
      ["4.1 px down", { ...SMALL_MAP_VIEW, y: SMALL_MAP_VIEW.y + 4.1 }],
      ["0.2% closer", { ...SMALL_MAP_VIEW, zoom: SMALL_MAP_VIEW.zoom * 1.002 }],
      [
        "0.2% further",
        { ...SMALL_MAP_VIEW, zoom: SMALL_MAP_VIEW.zoom / 1.002 },
      ],
    ];
    for (const [move, to] of moves) {
      // Fit to screen hands the view back to the automatic framing.
      fireEvent.click(screen.getByTestId("service-map-fit"));
      expect([move, autoFrame.current]).toEqual([move, true]);
      gesture(SMALL_MAP_VIEW, to);
      expect([move, autoFrame.current]).toEqual([move, false]);
    }
  });

  test("a move reported without its start ends the automatic framing", async () => {
    await renderGraph();
    const autoFrame: React.MutableRefObject<boolean> = guardProps().autoFrame;
    // With nothing to compare it with, a move counts as a move, never as noise.
    endGesture(FRAMED_VIEW_AFTER_PRESS);
    expect(autoFrame.current).toBe(false);
  });

  test("each gesture is judged from its own start, which is forgotten once it ends", async () => {
    await renderGraph();
    const autoFrame: React.MutableRefObject<boolean> = guardProps().autoFrame;

    // React Flow reports no end for a press that changed nothing at all...
    startGesture({ x: 64, y: 32, zoom: 1 });
    // ...and none for a move of its own, such as a fit.
    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(autoFrame.current).toBe(true);

    // The next press is judged from where it began, not where the last did.
    gesture(FRAMED_VIEW, FRAMED_VIEW_AFTER_PRESS);
    expect(autoFrame.current).toBe(true);

    // Its start went with it: a later end on its own is a move.
    endGesture(FRAMED_VIEW_AFTER_PRESS);
    expect(autoFrame.current).toBe(false);
  });

  test("an empty canvas is announced only once it has stayed empty for a moment", async () => {
    jest.useFakeTimers();
    await renderGraph();
    // A new drawing is hidden for a frame or two while React Flow measures it.
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS - 1);
    reportDrawingInView(true);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 2);
    expect(outOfViewNotice()).not.toBeInTheDocument();

    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS - 1);
    expect(outOfViewNotice()).not.toBeInTheDocument();
    advance(1);
    const notice: HTMLElement = screen.getByTestId("service-map-out-of-view");
    expect(within(notice).getByRole("status")).toHaveTextContent(
      "The map is out of view.",
    );
    expect(
      within(notice).getByRole("button", { name: "Fit to screen" }),
    ).toBeInTheDocument();

    // As soon as any of the drawing is back in view, the notice goes.
    reportDrawingInView(true);
    expect(outOfViewNotice()).not.toBeInTheDocument();
  });

  test("the notice sits on the canvas's left, clear of a drawer, and still announces itself", async () => {
    jest.useFakeTimers();
    await renderGraph();
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);

    const notice: HTMLElement = screen.getByTestId("service-map-out-of-view");
    // Over the whole canvas, and cut off at its edges...
    expect(screen.getByTestId("service-map-canvas")).toContainElement(notice);
    expect(notice).toHaveClass("absolute", "inset-0", "overflow-hidden");
    // ...yet only the notice itself takes the pointer; the rest is the map's.
    expect(notice).toHaveClass("pointer-events-none");

    const box: HTMLElement = outOfViewNoticeBox();
    expect(box).toHaveClass("pointer-events-auto", "absolute");
    /*
     * On the canvas's left, clear of a drawer open on the right, and never
     * wider than the canvas less an inset on each side. How far down is for
     * the part of the canvas on screen to say (see noticeOffsetInCanvas); a
     * canvas with no height, which is all jsdom lays out, keeps the notice
     * at the inset.
     */
    expect(box.style.left).toBe("16px");
    expect(box.style.maxWidth).toBe("calc(100% - 32px)");
    expect(box.style.top).toBe("16px");
    expect(box).toHaveTextContent("The map is out of view.");
    expect(
      within(box).getByRole("button", { name: "Fit to screen" }),
    ).toBeInTheDocument();
  });

  test("the notice follows the part of the canvas on screen as the page scrolls and the window resizes", async () => {
    jest.useFakeTimers();
    await renderGraph();
    /*
     * A canvas 880 px tall whose top the page has scrolled 280 px past, in a
     * window 600 px high: the notice goes in the middle of the part of the
     * canvas on screen, less half its own height.
     */
    const page: PageLayout = {
      canvasTop: -280,
      canvasHeight: 880,
      windowHeight: 600,
      noticeHeight: 54,
    };
    const measureCanvas: MockFunction = standInForLayout(page);
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);
    expect(outOfViewNoticeBox().style.top).toBe(
      `${noticeOffsetInCanvas(-280, 880, 600, 54, 16)}px`,
    );

    /*
     * The page scrolls 200 px further: the notice follows in the next frame,
     * measuring the canvas once however many scroll events the frame brings.
     */
    page.canvasTop = -480;
    const measured: number = measureCanvas.mock.calls.length;
    scrollPage();
    scrollPage();
    nextFrame();
    expect(measureCanvas).toHaveBeenCalledTimes(measured + 1);
    expect(outOfViewNoticeBox().style.top).toBe(
      `${noticeOffsetInCanvas(-480, 880, 600, 54, 16)}px`,
    );

    // The window is made shorter.
    page.windowHeight = 300;
    resizeWindow();
    nextFrame();
    expect(outOfViewNoticeBox().style.top).toBe(
      `${noticeOffsetInCanvas(-480, 880, 300, 54, 16)}px`,
    );

    /*
     * A page that scrolls in an element rather than the document: the
     * element's scroll does not bubble up to the document, and still counts.
     */
    page.canvasTop = -380;
    scrollPage(document.body);
    nextFrame();
    expect(outOfViewNoticeBox().style.top).toBe(
      `${noticeOffsetInCanvas(-380, 880, 300, 54, 16)}px`,
    );
  });

  test("once the notice goes, the page's scrolls and resizes are no longer followed", async () => {
    jest.useFakeTimers();
    await renderGraph();
    const page: PageLayout = {
      canvasTop: -280,
      canvasHeight: 880,
      windowHeight: 600,
      noticeHeight: 54,
    };
    const measureCanvas: MockFunction = standInForLayout(page);
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);
    expect(outOfViewNotice()).toBeInTheDocument();

    /*
     * The drawing is back in view: the notice goes, and stops listening. No
     * frame is pending as it goes, so a listener left behind would ask for
     * one, and be caught measuring the canvas.
     */
    reportDrawingInView(true);
    expect(outOfViewNotice()).not.toBeInTheDocument();
    const measuredAtHiding: number = measureCanvas.mock.calls.length;
    page.canvasTop = -480;
    page.windowHeight = 300;
    scrollPage();
    scrollPage(document.body);
    resizeWindow();
    nextFrame();
    expect(measureCanvas).toHaveBeenCalledTimes(measuredAtHiding);

    // Shown again, the notice is placed for the page as it is now...
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);
    expect(outOfViewNoticeBox().style.top).toBe(
      `${noticeOffsetInCanvas(-480, 880, 300, 54, 16)}px`,
    );
    // ...and follows it again.
    page.canvasTop = -380;
    scrollPage();
    nextFrame();
    expect(outOfViewNoticeBox().style.top).toBe(
      `${noticeOffsetInCanvas(-380, 880, 300, 54, 16)}px`,
    );

    // A frame a scroll asked for is dropped if the notice goes before it.
    page.canvasTop = -280;
    scrollPage();
    reportDrawingInView(true);
    expect(outOfViewNotice()).not.toBeInTheDocument();
    const measuredAtSecondHiding: number = measureCanvas.mock.calls.length;
    nextFrame();
    expect(measureCanvas).toHaveBeenCalledTimes(measuredAtSecondHiding);
  });

  test("a map drawn in a background tab is judged only once the tab is seen", async () => {
    jest.useFakeTimers();
    setTabVisibility("hidden");
    await renderGraph();
    // A hidden tab measures nothing, so no card is reported in view...
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 5);
    // ...and nothing is said about a map no one can see.
    expect(outOfViewNotice()).not.toBeInTheDocument();
    // A visibilitychange that leaves the tab hidden changes nothing.
    changeTabVisibility("hidden");
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 2);
    expect(outOfViewNotice()).not.toBeInTheDocument();

    // Once the tab is seen the map has the usual moment to be measured.
    changeTabVisibility("visible");
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS - 1);
    expect(outOfViewNotice()).not.toBeInTheDocument();
    advance(1);
    const notice: HTMLElement = screen.getByTestId("service-map-out-of-view");
    expect(within(notice).getByRole("status")).toHaveTextContent(
      "The map is out of view.",
    );
  });

  test("a map measured in view once its tab is seen never shows the notice", async () => {
    jest.useFakeTimers();
    setTabVisibility("hidden");
    await renderGraph();
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 5);

    changeTabVisibility("visible");
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS - 1);
    // React Flow measures the cards in the first frames back: they are in view.
    reportDrawingInView(true);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 5);
    expect(outOfViewNotice()).not.toBeInTheDocument();
  });

  test("a map back in view before its tab is seen leaves nothing waiting for the tab", async () => {
    jest.useFakeTimers();
    setTabVisibility("hidden");
    await renderGraph();
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);
    /*
     * The guard needs no measuring to say the drawing is in view again: it
     * does for a canvas with no cards, and for one that goes.
     */
    reportDrawingInView(true);

    changeTabVisibility("visible");
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 5);
    expect(outOfViewNotice()).not.toBeInTheDocument();
  });

  test("the notice's Fit to screen frames the map with the canvas on screen", async () => {
    jest.useFakeTimers();
    await renderGraph();
    const instance: MockFlowInstance = liveInstance();
    gesture(FRAMED_VIEW, { x: -4000, y: 0, zoom: 0.4 });
    expect(guardProps().autoFrame.current).toBe(false);
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);

    fireEvent.click(
      within(screen.getByTestId("service-map-out-of-view")).getByRole(
        "button",
        { name: "Fit to screen" },
      ),
    );
    expect(instance.fitView).toHaveBeenCalledTimes(1);
    expect(instance.fitView).toHaveBeenCalledWith(ANIMATED_FIT);
    expect(guardProps().autoFrame.current).toBe(true);
    expect(mockFlowMounts).toBe(1);
    // The fit brings the drawing back into view, and the notice goes.
    reportDrawingInView(true);
    expect(outOfViewNotice()).not.toBeInTheDocument();
  });

  test("a canvas that cannot fit is drawn again from scratch", async () => {
    jest.useFakeTimers();
    await renderGraph();
    const stuck: MockFlowInstance = liveInstance();
    // React Flow has no measured card to frame: fitView does nothing.
    stuck.fitView.mockReturnValue(false);
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);

    fireEvent.click(
      within(screen.getByTestId("service-map-out-of-view")).getByRole(
        "button",
        { name: "Fit to screen" },
      ),
    );
    expect(stuck.fitView).toHaveBeenCalledWith(ANIMATED_FIT);
    expect(mockFlowMounts).toBe(2);
    expect(outOfViewNotice()).not.toBeInTheDocument();
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 2);
    expect(outOfViewNotice()).not.toBeInTheDocument();

    // The fresh canvas draws the same map, and is the one fitted from now on.
    expect(guardProps().drawingKey).toBe(idsOf(flowProps().nodes).join("|"));
    const fresh: MockFlowInstance = liveInstance();
    expect(fresh).not.toBe(stuck);
    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(fresh.fitView).toHaveBeenCalledWith(ANIMATED_FIT);
    expect(stuck.fitView).toHaveBeenCalledTimes(1);
    expect(mockFlowMounts).toBe(2);
  });

  test("with no live canvas, Fit to screen draws it again rather than doing nothing", async () => {
    // The first canvas never reports a usable viewport.
    mockViewportInitialized = false;
    await renderGraph();
    const unready: MockFlowInstance = flowInstance(0);
    mockViewportInitialized = true;

    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(unready.fitView).not.toHaveBeenCalled();
    expect(mockFlowMounts).toBe(2);

    // The fresh canvas is ready, and Fit to screen now frames the map with it.
    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(liveInstance().fitView).toHaveBeenCalledWith(ANIMATED_FIT);
    expect(mockFlowMounts).toBe(2);
  });

  test("after Map, Table, Map, Fit to screen fits the new canvas, never the one that is gone", async () => {
    await renderGraph();
    const first: MockFlowInstance = liveInstance();
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(screen.queryByTestId("rendered-graph")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-map-view-map"));
    const second: MockFlowInstance = liveInstance();
    expect(second).not.toBe(first);

    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(second.fitView).toHaveBeenCalledTimes(1);
    expect(second.fitView).toHaveBeenCalledWith(ANIMATED_FIT);
    expect(first.fitView).not.toHaveBeenCalled();
    expect(mockFlowMounts).toBe(2);
  });

  test("a canvas that is gone is never fitted, even before the new one is ready", async () => {
    await renderGraph();
    const gone: MockFlowInstance = liveInstance();
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    mockViewportInitialized = false;
    fireEvent.click(screen.getByTestId("service-map-view-map"));

    fireEvent.click(screen.getByTestId("service-map-fit"));
    expect(gone.fitView).not.toHaveBeenCalled();
    // With nothing live to fit, the canvas is drawn again instead.
    expect(mockFlowMounts).toBe(3);
  });

  test("leaving the map while it is out of view brings no stale notice back", async () => {
    jest.useFakeTimers();
    await renderGraph();
    reportDrawingInView(false);
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS);
    expect(outOfViewNotice()).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(outOfViewNotice()).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-map-view-map"));
    advance(OUT_OF_VIEW_NOTICE_DELAY_MS * 2);
    expect(outOfViewNotice()).not.toBeInTheDocument();
  });

  test("the zoom hint shows with the map, not the table", async () => {
    await renderGraph();
    expect(screen.getByTestId("service-map-zoom-hint")).toHaveTextContent(
      "Ctrl + scroll or pinch to zoom",
    );
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(
      screen.queryByTestId("service-map-zoom-hint"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-map-view-map"));
    expect(screen.getByTestId("service-map-zoom-hint")).toBeInTheDocument();
  });
});

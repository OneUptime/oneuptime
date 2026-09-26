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
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import type { SpyInstance } from "jest-mock";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import ObjectID from "../../../Types/ObjectID";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Navigation from "../../../UI/Utils/Navigation";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import InfrastructureExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer";
import type {
  CollectionPage,
  CollectionPageRequest,
  CollectionSearchRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi";
import {
  EntityDetailTarget,
  InfrastructureCollection,
  InfrastructureTotals,
  TopologyEntity,
  TopologyRelationship,
  TopologyTruncation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import { TopologyOutdatedError } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyApi";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Infrastructure explorer: a tree of things that contain things, a table
 * of what is inside the selected scope, a map of one level, and search. The
 * estate used here is the one that motivated the redesign — application pods
 * that reported themselves as hosts, most of them long gone — plus, where it
 * matters, a collection too large to ship row by row and a tree too large to
 * open fully.
 *
 * The map, the details drawer and the collection transport are the
 * boundaries replaced here; each has its own tests.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("dde060c6-fe0d-49ce-b44c-4035a13bc1db");
      },
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph",
  () => {
    return {
      __esModule: true,
      default: (props: {
        model: unknown;
        nodeIds: Array<string>;
        onOpenNode: (id: string) => void;
        onOpenService?: (key: string) => void;
        onOpenTraffic?: (link: { from: string; to: string }) => void;
        onShowAll?: () => void;
        metricsWindowSeconds?: number;
      }): React.ReactElement => {
        /* The real traffic between the cards the page asked for. */
        const { computeInfrastructureTraffic } = jest.requireActual(
          "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel",
        ) as {
          computeInfrastructureTraffic: (
            model: unknown,
            cardIds: Array<string>,
          ) => { links: Array<{ from: string; to: string }> };
        };
        const links: Array<{ from: string; to: string }> =
          computeInfrastructureTraffic(props.model, props.nodeIds).links;
        return (
          <div
            data-testid="infrastructure-map-stub"
            data-metrics-window={props.metricsWindowSeconds}
          >
            {props.onOpenTraffic &&
              links.map(
                (link: { from: string; to: string }): React.ReactElement => {
                  return (
                    <button
                      type="button"
                      key={`${link.from}->${link.to}`}
                      onClick={() => {
                        props.onOpenTraffic?.(link);
                      }}
                    >
                      {`Map traffic ${link.from} -> ${link.to}`}
                    </button>
                  );
                },
              )}
            {props.nodeIds.map((id: string): React.ReactElement => {
              return (
                <button
                  type="button"
                  key={id}
                  data-testid={`map-card-${id}`}
                  onClick={() => {
                    props.onOpenNode(id);
                  }}
                >
                  {id}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                props.onOpenService?.("api");
              }}
            >
              Map service api
            </button>
            <button type="button" onClick={props.onShowAll}>
              Map show all
            </button>
          </div>
        );
      },
    };
  },
);

/*
 * The drawer fetches its own details; here it only shows what it was handed
 * (the preview target) and exposes its callbacks. Every mount and every
 * render is recorded, so a test can see what the page asked it to show and
 * whether it kept one drawer or built a new one.
 */
interface DrawerProps {
  entity: EntityDetailTarget;
  rangeStart: Date | null | undefined;
  metricsWindowSeconds: number;
  onClose: () => void;
  onFocus?: ((key: string) => void) | undefined;
  focusButtonLabel?: string | undefined;
  onSelectEntity?: ((target: EntityDetailTarget) => void) | undefined;
  onOpenInfrastructure?: ((key: string) => void) | undefined;
}
const mockDrawerMounts: Array<DrawerProps> = [];
const mockDrawerRenders: Array<DrawerProps> = [];
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
  () => {
    const MockDrawer: (props: DrawerProps) => React.ReactElement = (
      props: DrawerProps,
    ): React.ReactElement => {
      mockDrawerRenders.push(props);
      React.useEffect(() => {
        mockDrawerMounts.push(props);
      }, []);
      return (
        <div
          role="dialog"
          aria-label={props.entity.displayName || props.entity.entityKey}
          data-entity-type={props.entity.entityType || ""}
          data-range-start={props.rangeStart?.toISOString() || ""}
          data-metrics-window={props.metricsWindowSeconds}
          data-opens-infrastructure={String(
            Boolean(props.onOpenInfrastructure),
          )}
        >
          <button type="button" onClick={props.onClose}>
            Close resource details
          </button>
          {props.onFocus && (
            <button
              type="button"
              onClick={() => {
                props.onFocus?.(props.entity.entityKey);
              }}
            >
              {props.focusButtonLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              props.onSelectEntity?.({
                entityKey: "api",
                entityType: EntityType.Service,
                displayName: "api",
              });
            }}
          >
            Select the api service
          </button>
        </div>
      );
    };
    return { __esModule: true, default: MockDrawer };
  },
);

/*
 * A traffic line's history panel fetches its own charts; here it shows the
 * call it was asked about and exposes its close button.
 */
interface EdgePanelProps {
  fromEntity: TopologyEntity;
  toEntity: TopologyEntity;
  relationship: TopologyRelationship;
  timeRange: RangeStartAndEndDateTime;
  metricsWindowSeconds: number;
  onClose: () => void;
}
const mockEdgePanelRenders: Array<EdgePanelProps> = [];
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: EdgePanelProps): React.ReactElement => {
        mockEdgePanelRenders.push(props);
        return (
          <div
            role="dialog"
            aria-label={`${props.fromEntity.displayName} calls ${props.toEntity.displayName}`}
          >
            <button type="button" onClick={props.onClose}>
              Close call history
            </button>
          </div>
        );
      },
    };
  },
);

/*
 * Only the two requests are replaced: how a failure is classified (a busy
 * server, a newer format) is the real module's, so the page is tested
 * against what the transport really reports.
 */
const mockFetchCollectionPage: MockFunction = getJestMockFunction();
const mockFetchCollectionSearchCounts: MockFunction = getJestMockFunction();
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchCollectionPage: (...args: Array<unknown>): unknown => {
        return mockFetchCollectionPage(...args);
      },
      fetchCollectionSearchCounts: (...args: Array<unknown>): unknown => {
        return mockFetchCollectionSearchCounts(...args);
      },
    };
  },
);

const NOW: Date = new Date();
const LONG_AGO: Date = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000);
const RANGE_START: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

function entity(
  key: string,
  type: EntityType,
  name: string = key,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    lastSeenAt,
    source: EntitySource.Discovered,
  };
}
function relationship(
  from: string,
  to: string,
  type: EntityRelationshipType,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
}
function hostedOn(from: string, to: string): TopologyRelationship {
  return relationship(from, to, EntityRelationshipType.HostedOn);
}

const APP_GROUP: string = "group:category:compute:host|oneuptime-app";
const IOT: string = "collection:iot.device";

interface Fixture {
  entities: Array<TopologyEntity>;
  relationships: Array<TopologyRelationship>;
  collections?: Array<InfrastructureCollection>;
  totals?: InfrastructureTotals;
  truncation?: TopologyTruncation | null;
}

function fixtures(): Fixture {
  return {
    entities: [
      entity("api", EntityType.Service),
      entity("home", EntityType.Service),
      entity("h1", EntityType.Host, "oneuptime-app-685856b7d7-48xkt"),
      entity("h2", EntityType.Host, "oneuptime-app-685856b7d7-4vnkt"),
      entity("h3", EntityType.Host, "oneuptime-app-7bf488c9d5-5jgp4"),
      entity(
        "gone",
        EntityType.Host,
        "oneuptime-app-6f8cc8d9b4-6652k",
        LONG_AGO,
      ),
      entity("home-1", EntityType.Host, "oneuptime-home-56d657f4b4-7kslf"),
      entity("home-2", EntityType.Host, "oneuptime-home-56d657f4b4-zvcr6"),
      entity("builder", EntityType.Host, "build-server"),
    ],
    relationships: [
      hostedOn("api", "h1"),
      hostedOn("api", "h2"),
      hostedOn("api", "h3"),
      hostedOn("api", "gone"),
      hostedOn("home", "home-1"),
      hostedOn("home", "home-2"),
    ],
  };
}

/* The same estate plus 5,000 IoT devices the server summarized. */
function withCollection(): Fixture {
  const base: Fixture = fixtures();
  return {
    ...base,
    entities: [
      ...base.entities,
      entity("switch", EntityType.NetworkDevice, "core-switch"),
    ],
    collections: [
      {
        entityType: EntityType.IoTDevice,
        total: 5000,
        active: 4200,
        lastSeenAt: NOW,
        activeLastSeenAt: NOW,
      },
    ],
  };
}

/*
 * More than 200 containers: 250 hosts that each hold a container, plus one
 * Kubernetes cluster → namespace → deployment → pods. Too many to open the
 * whole tree by default.
 */
function largeFixture(): Fixture {
  const entities: Array<TopologyEntity> = [
    entity("cluster", EntityType.KubernetesCluster, "prod"),
    entity("ns", EntityType.KubernetesNamespace, "shop"),
    entity("deploy", EntityType.KubernetesDeployment, "checkout"),
    entity("pod-1", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-x2k9p"),
    entity("pod-2", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-q8zwm"),
  ];
  const relationships: Array<TopologyRelationship> = [
    relationship("ns", "cluster", EntityRelationshipType.MemberOf),
    relationship("deploy", "ns", EntityRelationshipType.MemberOf),
    relationship("pod-1", "deploy", EntityRelationshipType.PartOf),
    relationship("pod-2", "deploy", EntityRelationshipType.PartOf),
  ];
  for (let index: number = 0; index < 250; index++) {
    const host: string = `host-${String(index).padStart(3, "0")}`;
    entities.push(entity(host, EntityType.Host, `${host}.internal`));
    entities.push(
      entity(`${host}/c`, EntityType.Container, `${host}-container`),
    );
    relationships.push(
      relationship(`${host}/c`, host, EntityRelationshipType.PartOf),
    );
  }
  return { entities, relationships };
}

function page(
  items: Array<TopologyEntity>,
  total: number,
  nextCursor: { name: string; key: string } | null,
): CollectionPage {
  return {
    rangeStart: RANGE_START,
    entityType: EntityType.IoTDevice,
    total,
    items,
    nextCursor,
  };
}

interface ExplorerOptions {
  data?: Fixture;
  includeInactive?: boolean;
  onOpenServiceMap?: (key: string) => void;
  timeRange?: RangeStartAndEndDateTime;
}

function explorer(options: ExplorerOptions = {}): React.ReactElement {
  const data: Fixture = options.data || fixtures();
  return (
    <MemoryRouter>
      <InfrastructureExplorer
        entities={data.entities}
        relationships={data.relationships}
        collections={data.collections}
        totals={data.totals}
        truncation={data.truncation}
        metricsWindowSeconds={900}
        timeRange={options.timeRange}
        rangeStart={RANGE_START}
        includeInactive={options.includeInactive}
        onOpenServiceMap={options.onOpenServiceMap}
      />
    </MemoryRouter>
  );
}

/*
 * Renders the explorer; rerender it through the result with `explorer(...)`
 * and the SAME fixture object, as TopologyPage does when only "Show
 * inactive" changes (the explorer is not remounted for that).
 */
function renderExplorer(options: ExplorerOptions = {}): RenderResult {
  return render(explorer(options));
}

function search(value: string): void {
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search infrastructure" }),
    { target: { value } },
  );
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId("infrastructure-row");
}

/*
 * The large fixture's tree is queried by label rather than by role: jsdom
 * computes styles for every candidate of a role query, which made those
 * tests take seconds each.
 */
function tree(): HTMLElement {
  const aside: HTMLElement | null = document.querySelector(
    'aside[aria-label="Infrastructure tree"]',
  );
  if (!aside) {
    throw new Error("the tree is not on the page");
  }
  return aside;
}

/* What the drawer was last asked to show. */
function lastDrawer(): DrawerProps {
  const props: DrawerProps | undefined =
    mockDrawerRenders[mockDrawerRenders.length - 1];
  if (!props) {
    throw new Error("the drawer never opened");
  }
  return props;
}

function pageRequest(index: number): CollectionPageRequest {
  const call: Array<unknown> | undefined =
    mockFetchCollectionPage.mock.calls[index];
  if (!call) {
    throw new Error(`no collection page request #${index + 1}`);
  }
  return call[1] as CollectionPageRequest;
}

function lastPageRequest(): CollectionPageRequest {
  return pageRequest(mockFetchCollectionPage.mock.calls.length - 1);
}

/* A page of IoT devices "iot-<from>" .. "iot-<to>" that says where the next starts. */
function iotPage(
  from: number,
  to: number,
  total: number,
  hasMore: boolean = true,
): CollectionPage {
  const items: Array<TopologyEntity> = [];
  for (let index: number = from; index <= to; index++) {
    const name: string = `sensor-${String(index).padStart(3, "0")}`;
    items.push(entity(`iot-${index}`, EntityType.IoTDevice, name));
  }
  const last: TopologyEntity | undefined = items[items.length - 1];
  return page(
    items,
    total,
    hasMore && last
      ? { name: last.displayName || "", key: last.entityKey || "" }
      : null,
  );
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard/project/topology/overview?tab=Infrastructure",
  );
  mockDrawerMounts.length = 0;
  mockDrawerRenders.length = 0;
  mockFetchCollectionPage.mockReset();
  mockFetchCollectionSearchCounts.mockReset();
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("overview", () => {
  test("groups replicas by workload and hides resources that went quiet", () => {
    renderExplorer();
    const names: Array<string> = rows().map((row: HTMLElement) => {
      return row.querySelector("button")!.textContent || "";
    });
    expect(names).toEqual(["oneuptime-app", "oneuptime-home", "build-server"]);
    expect(rows()[0]).toHaveTextContent("Host replicas");
    expect(rows()[0]).toHaveTextContent("3 hosts");
    expect(rows()[0]).toHaveTextContent("api");
    expect(rows()[2]).toHaveTextContent("Active");
  });

  test("summarizes resources, workloads, placed services and what was hidden", () => {
    renderExplorer();
    const cards: HTMLElement = screen.getByTestId("infrastructure-explorer");
    expect(cards).toHaveTextContent("Resources6");
    expect(cards).toHaveTextContent("Workloads2");
    expect(cards).toHaveTextContent("Services placed2");
    expect(cards).toHaveTextContent("Inactive not shown1");
  });

  test("when a safety cap was hit the summary reports the server's exact totals", () => {
    renderExplorer({
      data: {
        ...fixtures(),
        totals: { resources: 250000, activeResources: 180000 },
        truncation: { shown: 200000, total: 250000 },
      },
    });
    const cards: HTMLElement = screen.getByTestId("infrastructure-explorer");
    expect(cards).toHaveTextContent("Resources180,000");
    expect(cards).toHaveTextContent("Inactive not shown70,000");
  });

  test("without a cap the totals do not replace what the map counted", () => {
    renderExplorer({
      data: {
        ...fixtures(),
        totals: { resources: 9, activeResources: 8 },
        truncation: null,
      },
    });
    expect(screen.getByTestId("infrastructure-explorer")).toHaveTextContent(
      "Resources6",
    );
  });

  test("show inactive includes quiet resources, marked as inactive", () => {
    renderExplorer({ includeInactive: true });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${APP_GROUP}`));
    expect(rows()).toHaveLength(4);
    const gone: HTMLElement = rows().find((row: HTMLElement) => {
      return row.textContent?.includes("6652k");
    })!;
    expect(gone).toHaveTextContent("Inactive");
  });

  test("a catalog with nothing active explains how to see it", () => {
    renderExplorer({
      data: {
        entities: [entity("gone", EntityType.Host, "old-host", LONG_AGO)],
        relationships: [],
      },
    });
    expect(screen.getByTestId("infrastructure-all-inactive")).toHaveTextContent(
      "Nothing reported in this time range",
    );
  });

  test("an empty catalog explains how to populate it", () => {
    renderExplorer({ data: { entities: [], relationships: [] } });
    expect(
      screen.getByText("No infrastructure topology discovered yet"),
    ).toBeInTheDocument();
  });
});

describe("navigation", () => {
  test("opening a group lists its members and breadcrumbs lead back", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Open oneuptime-app" }));
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "oneuptime-app",
    );
    expect(rows()).toHaveLength(3);
    expect(window.location.search).toContain(
      `infraFocus=${encodeURIComponent(APP_GROUP)}`,
    );
    const location: HTMLElement = screen.getByRole("navigation", {
      name: "Infrastructure location",
    });
    expect(location).toHaveTextContent("Hosts & containers");
    fireEvent.click(
      within(location).getByRole("button", { name: "All infrastructure" }),
    );
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "All infrastructure",
    );
  });

  test("the tree holds only containers and can be collapsed", () => {
    renderExplorer();
    expect(
      within(tree()).getByTestId(`infrastructure-tree-${APP_GROUP}`),
    ).toBeInTheDocument();
    expect(within(tree()).queryByText("build-server")).not.toBeInTheDocument();
    fireEvent.click(
      within(tree()).getByRole("button", {
        name: "Collapse Hosts & containers",
      }),
    );
    expect(
      within(tree()).queryByTestId(`infrastructure-tree-${APP_GROUP}`),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(tree()).getByRole("button", { name: "Expand Hosts & containers" }),
    );
    expect(
      within(tree()).getByTestId(`infrastructure-tree-${APP_GROUP}`),
    ).toBeInTheDocument();
  });

  test("a plain resource opens its details from the preview it already has", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "View details for build-server" }),
    );
    expect(
      screen.getByRole("dialog", { name: "build-server" }),
    ).toBeInTheDocument();
    expect(lastDrawer().entity).toEqual({
      entityKey: "builder",
      entityType: EntityType.Host,
      displayName: "build-server",
    });
    // The drawer judges activity against the range the server used.
    const drawer: HTMLElement = screen.getByRole("dialog");
    expect(drawer).toHaveAttribute(
      "data-range-start",
      RANGE_START.toISOString(),
    );
    expect(drawer).toHaveAttribute("data-metrics-window", "900");
    // Its connections stay in the drawer: this page is Infrastructure already.
    expect(drawer).toHaveAttribute("data-opens-infrastructure", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show where it is" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "Hosts & containers",
    );
  });

  test("choosing a connection in the drawer shows that entity instead", () => {
    const onOpenServiceMap: MockFunction = getJestMockFunction();
    renderExplorer({ onOpenServiceMap });
    fireEvent.click(
      screen.getByRole("button", { name: "View details for build-server" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select the api service" }),
    );
    expect(screen.getByRole("dialog", { name: "api" })).toHaveAttribute(
      "data-entity-type",
      EntityType.Service,
    );
    /*
     * The same drawer shows the new entity: it is not torn down and built
     * again (that would drop keyboard focus to the page and replay the
     * slide-in); the drawer itself handles the switch.
     */
    expect(mockDrawerMounts).toHaveLength(1);
    expect(lastDrawer().entity).toEqual({
      entityKey: "api",
      entityType: EntityType.Service,
      displayName: "api",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Show on the service map" }),
    );
    expect(onOpenServiceMap).toHaveBeenCalledWith("api");
  });

  test("a service has nowhere to be shown without the Service Map", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "View details for build-server" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select the api service" }),
    );
    expect(screen.getByRole("dialog", { name: "api" })).toBeInTheDocument();
    expect(lastDrawer().onFocus).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Show on the service map" }),
    ).not.toBeInTheDocument();
  });

  test("a shared link to a resource opens its scope and its details", async () => {
    window.history.replaceState({}, "", "?tab=Infrastructure&infraFocus=h2");
    renderExplorer();
    await waitFor(() => {
      expect(
        screen.getByTestId("infrastructure-scope-title"),
      ).toHaveTextContent("oneuptime-app");
    });
    expect(
      screen.getByRole("dialog", { name: "oneuptime-app-685856b7d7-4vnkt" }),
    ).toBeInTheDocument();
  });

  test("a link to a resource the tree does not hold opens the drawer for that key", async () => {
    window.history.replaceState({}, "", "?infraFocus=missing");
    renderExplorer();
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "All infrastructure",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "missing" }),
      ).toBeInTheDocument();
    });
    expect(lastDrawer().entity).toEqual({ entityKey: "missing" });
    // Nothing on this page to show it on.
    expect(lastDrawer().onFocus).toBeUndefined();
  });

  test("a stale link to a group falls back to the overview without a drawer", () => {
    window.history.replaceState(
      {},
      "",
      "?infraFocus=group:category:compute:host|renamed",
    );
    renderExplorer();
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "All infrastructure",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("service chips open the service on the Service Map", () => {
    const onOpenServiceMap: MockFunction = getJestMockFunction();
    renderExplorer({ onOpenServiceMap });
    fireEvent.click(
      within(rows()[0]!).getByRole("button", {
        name: "Show api on the service map",
      }),
    );
    expect(onOpenServiceMap).toHaveBeenCalledWith("api");
    // The chip does not also open the row it sits in.
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "All infrastructure",
    );
  });
});

describe("a large tree", () => {
  test("a small tree opens fully by default", () => {
    renderExplorer({
      data: {
        entities: largeFixture().entities.slice(0, 5),
        relationships: largeFixture().relationships.slice(0, 4),
      },
    });
    // cluster → namespace → deployment, all listed without a click.
    expect(
      within(tree()).getByTestId("infrastructure-tree-deploy"),
    ).toBeInTheDocument();
  });

  test("more than 200 containers open only the categories", () => {
    renderExplorer({ data: largeFixture() });
    expect(
      within(tree()).getByTestId("infrastructure-tree-cluster"),
    ).toBeInTheDocument();
    expect(
      within(tree()).queryByTestId("infrastructure-tree-ns"),
    ).not.toBeInTheDocument();
    fireEvent.click(within(tree()).getByLabelText("Expand prod"));
    expect(
      within(tree()).getByTestId("infrastructure-tree-ns"),
    ).toBeInTheDocument();
  });

  test("a level with hundreds of containers lists the first ones and offers the rest", () => {
    renderExplorer({ data: largeFixture() });
    expect(
      within(tree()).getByTestId("infrastructure-tree-host-099"),
    ).toBeInTheDocument();
    expect(
      within(tree()).queryByTestId("infrastructure-tree-host-100"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(tree()).getByLabelText("Show all 250 in Hosts & containers"),
    );
    expect(
      within(tree()).getByTestId("infrastructure-tree-host-249"),
    ).toBeInTheDocument();
  });

  test("a deep link opens every ancestor and marks where it landed", async () => {
    window.history.replaceState({}, "", "?infraFocus=pod-2");
    renderExplorer({ data: largeFixture() });
    await waitFor(() => {
      expect(
        within(tree()).getByTestId("infrastructure-tree-deploy"),
      ).toHaveAttribute("aria-current", "true");
    });
    for (const name of ["prod", "shop"]) {
      expect(within(tree()).getByLabelText(`Collapse ${name}`)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "checkout",
    );
    expect(lastDrawer().entity.entityKey).toBe("pod-2");
  });

  test("a deep link past the listed ones still shows the way to it", async () => {
    window.history.replaceState({}, "", "?infraFocus=host-230/c");
    renderExplorer({ data: largeFixture() });
    await waitFor(() => {
      expect(
        within(tree()).getByTestId("infrastructure-tree-host-230"),
      ).toHaveAttribute("aria-current", "true");
    });
    expect(
      within(tree()).queryByTestId("infrastructure-tree-host-229"),
    ).not.toBeInTheDocument();
  });
});

describe("search", () => {
  test("finds resources by name, type and the services running on them", () => {
    renderExplorer();
    search("home");
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "Search results",
    );
    expect(
      rows().map((row: HTMLElement) => {
        return row.querySelector("button")!.textContent;
      }),
    ).toEqual([
      "oneuptime-home",
      "oneuptime-home-56d657f4b4-7kslf",
      "oneuptime-home-56d657f4b4-zvcr6",
    ]);
    expect(rows()[1]).toHaveTextContent("in oneuptime-home");
    search("api");
    expect(rows().length).toBeGreaterThanOrEqual(4);
  });

  test("a miss can be cleared", () => {
    renderExplorer();
    search("nothing-like-this");
    expect(
      screen.getByText("No resources match your search"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(rows()).toHaveLength(3);
  });

  test("without collections the server is never asked", async () => {
    renderExplorer();
    search("home");
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 400);
    });
    expect(mockFetchCollectionSearchCounts).not.toHaveBeenCalled();
  });
});

describe("collections", () => {
  test("a collection is one row with its exact count, listed before plain resources", () => {
    renderExplorer({ data: withCollection() });
    const network: HTMLElement = screen.getByRole("region", {
      name: "Network & devices",
    });
    const collectionRow: HTMLElement =
      within(network).getAllByTestId("infrastructure-row")[0]!;
    expect(collectionRow).toHaveTextContent("IoT Devices");
    expect(collectionRow).toHaveTextContent("Collection");
    expect(collectionRow).toHaveTextContent("4,200 IoT devices");
    expect(screen.getByTestId("infrastructure-explorer")).toHaveTextContent(
      "Resources4,207",
    );
    // 800 silent IoT devices and one silent host.
    expect(screen.getByTestId("infrastructure-explorer")).toHaveTextContent(
      "Inactive not shown801",
    );
    expect(
      within(tree()).getByTestId(`infrastructure-tree-${IOT}`),
    ).toBeInTheDocument();
  });

  test("opening a collection pages its items from the server", async () => {
    mockFetchCollectionPage
      .mockResolvedValueOnce(
        page(
          [
            entity("iot-1", EntityType.IoTDevice, "sensor-001"),
            entity("iot-2", EntityType.IoTDevice, "sensor-002", LONG_AGO),
          ],
          4200,
          { name: "sensor-002", key: "iot-2" },
        ),
      )
      .mockResolvedValueOnce(
        page([entity("iot-3", EntityType.IoTDevice, "sensor-003")], 4200, {
          name: "sensor-003",
          key: "iot-3",
        }),
      )
      .mockResolvedValueOnce(
        page([entity("iot-1", EntityType.IoTDevice, "sensor-001")], 4200, {
          name: "sensor-001",
          key: "iot-1",
        }),
      );
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByRole("button", { name: "Open IoT Devices" }));
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "IoT Devices",
    );
    expect(window.location.search).toContain(
      `infraFocus=${encodeURIComponent(IOT)}`,
    );
    expect(screen.getByText("Loading IoT Devices…")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await waitFor(() => {
      expect(
        screen.getAllByTestId("infrastructure-collection-row"),
      ).toHaveLength(2);
    });
    const [rangeStart, request, options] = mockFetchCollectionPage.mock
      .calls[0] as [Date, CollectionPageRequest, { signal: AbortSignal }];
    expect(rangeStart).toBe(RANGE_START);
    expect(request).toEqual({
      entityType: EntityType.IoTDevice,
      includeInactive: false,
      nameTerms: [],
      cursor: null,
      limit: 50,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByText("Page 1 of 84 · 4,200 IoT devices")).toBeVisible();
    // An item that went quiet says so.
    expect(
      screen.getAllByTestId("infrastructure-collection-row")[1],
    ).toHaveTextContent("Inactive");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        screen.getByText("Page 2 of 84 · 4,200 IoT devices"),
      ).toBeVisible();
    });
    expect(
      (mockFetchCollectionPage.mock.calls[1]![1] as CollectionPageRequest)
        .cursor,
    ).toEqual({ name: "sensor-002", key: "iot-2" });
    expect(
      screen.getByRole("button", { name: "View details for sensor-003" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(
        screen.getByText("Page 1 of 84 · 4,200 IoT devices"),
      ).toBeVisible();
    });
    expect(
      (mockFetchCollectionPage.mock.calls[2]![1] as CollectionPageRequest)
        .cursor,
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "View details for sensor-001" }),
    );
    expect(lastDrawer().entity).toEqual({
      entityKey: "iot-1",
      entityType: EntityType.IoTDevice,
      displayName: "sensor-001",
    });
    // Not a node of the tree: nothing to show it on.
    expect(lastDrawer().onFocus).toBeUndefined();
  });

  test("the last page has no Next", async () => {
    mockFetchCollectionPage.mockResolvedValue(
      page([entity("iot-1", EntityType.IoTDevice, "sensor-001")], 1, null),
    );
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 1 · 1 IoT device")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("with inactive shown the whole collection is listed", async () => {
    mockFetchCollectionPage.mockResolvedValue(page([], 0, null));
    renderExplorer({ data: withCollection(), includeInactive: true });
    fireEvent.click(screen.getByRole("button", { name: "Open IoT Devices" }));
    await waitFor(() => {
      expect(mockFetchCollectionPage).toHaveBeenCalled();
    });
    expect(
      (mockFetchCollectionPage.mock.calls[0]![1] as CollectionPageRequest)
        .includeInactive,
    ).toBe(true);
  });

  test("a failed page says why and can be retried", async () => {
    mockFetchCollectionPage
      .mockRejectedValueOnce(new Error("Server Error. Please try again"))
      .mockResolvedValueOnce(
        page([entity("iot-1", EntityType.IoTDevice, "sensor-001")], 1, null),
      );
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByRole("button", { name: "Open IoT Devices" }));
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Server Error. Please try again");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(
        screen.getAllByTestId("infrastructure-collection-row"),
      ).toHaveLength(1);
    });
    expect(mockFetchCollectionPage).toHaveBeenCalledTimes(2);
  });

  test("the map view of a collection is its list", async () => {
    mockFetchCollectionPage.mockResolvedValue(
      page([entity("iot-1", EntityType.IoTDevice, "sensor-001")], 1, null),
    );
    window.history.replaceState({}, "", `?infraView=map&infraFocus=${IOT}`);
    renderExplorer({ data: withCollection() });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("infrastructure-collection-row"),
      ).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("infrastructure-map-stub"),
    ).not.toBeInTheDocument();
  });

  test("the overview map draws a collection as a card that opens it", () => {
    mockFetchCollectionPage.mockReturnValue(new Promise(() => {}));
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    fireEvent.click(screen.getByTestId(`map-card-${IOT}`));
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "IoT Devices",
    );
  });

  test("search asks the server how many items of each collection match", async () => {
    mockFetchCollectionSearchCounts.mockResolvedValue(
      new Map<string, number>([[EntityType.IoTDevice, 1234]]),
    );
    mockFetchCollectionPage.mockResolvedValue(
      page([entity("iot-7", EntityType.IoTDevice, "sensor-007")], 1234, {
        name: "sensor-007",
        key: "iot-7",
      }),
    );
    renderExplorer({ data: withCollection() });
    search("Sensor");
    expect(screen.getByText("Searching large collections…")).toBeVisible();
    const match: HTMLElement = await screen.findByTestId(
      "infrastructure-collection-match",
    );
    expect(match).toHaveTextContent("1,234 matching IoT devices");
    expect(match).toHaveTextContent("in IoT Devices");
    // Nothing in the tree matches, but the collection does: not a miss.
    expect(
      screen.queryByText("No resources match your search"),
    ).not.toBeInTheDocument();
    expect(mockFetchCollectionSearchCounts).toHaveBeenCalledTimes(1);
    const [rangeStart, request] = mockFetchCollectionSearchCounts.mock
      .calls[0] as [Date, CollectionSearchRequest];
    expect(rangeStart).toBe(RANGE_START);
    expect(request).toEqual({
      includeInactive: false,
      types: [{ entityType: EntityType.IoTDevice, nameTerms: ["sensor"] }],
    });

    fireEvent.click(match);
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "IoT Devices",
    );
    await waitFor(() => {
      expect(
        screen.getAllByTestId("infrastructure-collection-row"),
      ).toHaveLength(1);
    });
    expect(
      (mockFetchCollectionPage.mock.calls[0]![1] as CollectionPageRequest)
        .nameTerms,
    ).toEqual(["sensor"]);
    expect(screen.getByText("Names containing “sensor”")).toBeVisible();

    // Clearing the filter lists the whole collection again.
    fireEvent.click(
      screen.getByRole("button", { name: "Show all IoT devices" }),
    );
    await waitFor(() => {
      expect(mockFetchCollectionPage).toHaveBeenCalledTimes(2);
    });
    expect(
      (mockFetchCollectionPage.mock.calls[1]![1] as CollectionPageRequest)
        .nameTerms,
    ).toEqual([]);
  });

  test("typing is debounced into one count request", async () => {
    mockFetchCollectionSearchCounts.mockResolvedValue(
      new Map<string, number>([[EntityType.IoTDevice, 3]]),
    );
    renderExplorer({ data: withCollection() });
    search("s");
    search("se");
    search("sen");
    await screen.findByTestId("infrastructure-collection-match");
    expect(mockFetchCollectionSearchCounts).toHaveBeenCalledTimes(1);
    expect(
      (
        mockFetchCollectionSearchCounts.mock
          .calls[0]![1] as CollectionSearchRequest
      ).types[0]!.nameTerms,
    ).toEqual(["sen"]);
  });

  test("a query the type label answers counts every item without asking", () => {
    renderExplorer({ data: withCollection() });
    search("iot");
    const match: HTMLElement = screen.getByTestId(
      "infrastructure-collection-match",
    );
    expect(match).toHaveTextContent("4,200 matching IoT devices");
    expect(mockFetchCollectionSearchCounts).not.toHaveBeenCalled();
  });

  test("label terms are left out of the name terms the server matches", async () => {
    mockFetchCollectionSearchCounts.mockResolvedValue(
      new Map<string, number>(),
    );
    renderExplorer({ data: withCollection() });
    search("iot sensor");
    await waitFor(() => {
      expect(mockFetchCollectionSearchCounts).toHaveBeenCalled();
    });
    expect(
      (
        mockFetchCollectionSearchCounts.mock
          .calls[0]![1] as CollectionSearchRequest
      ).types,
    ).toEqual([{ entityType: EntityType.IoTDevice, nameTerms: ["sensor"] }]);
    await waitFor(() => {
      expect(
        screen.getByText("No resources match your search"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("infrastructure-collection-match"),
    ).not.toBeInTheDocument();
  });

  test("a failed count says so and can be retried", async () => {
    mockFetchCollectionSearchCounts
      .mockRejectedValueOnce(new Error("Server Error. Please try again"))
      .mockResolvedValueOnce(
        new Map<string, number>([[EntityType.IoTDevice, 9]]),
      );
    renderExplorer({ data: withCollection() });
    search("sensor");
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not search large collections.");
    expect(
      screen.queryByText("No resources match your search"),
    ).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByTestId("infrastructure-collection-match"),
    ).toHaveTextContent("9 matching IoT devices");
  });

  test("resources and collection matches are counted together", async () => {
    mockFetchCollectionSearchCounts.mockResolvedValue(
      new Map<string, number>([[EntityType.IoTDevice, 20]]),
    );
    renderExplorer({ data: withCollection() });
    search("core");
    await screen.findByTestId("infrastructure-collection-match");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("21 matches")).toBeVisible();
  });
});

describe("map", () => {
  test("draws the workloads of the scope and opens groups from their cards", () => {
    const onOpenServiceMap: MockFunction = getJestMockFunction();
    renderExplorer({ onOpenServiceMap });
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    expect(window.location.search).toContain("infraView=map");
    expect(screen.getByTestId(`map-card-${APP_GROUP}`)).toBeInTheDocument();
    expect(screen.getByTestId("map-card-builder")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`map-card-${APP_GROUP}`));
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "oneuptime-app",
    );
    expect(screen.getByTestId("map-card-h1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-card-h1"));
    expect(
      screen.getByRole("dialog", { name: "oneuptime-app-685856b7d7-48xkt" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Map service api" }));
    expect(onOpenServiceMap).toHaveBeenCalledWith("api");
  });

  test("a service card opens its details when there is no Service Map", () => {
    renderExplorer();
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    fireEvent.click(screen.getByRole("button", { name: "Map service api" }));
    expect(lastDrawer().entity).toEqual({
      entityKey: "api",
      entityType: EntityType.Service,
      displayName: "api",
    });
  });

  test("the map is handed the page's rate window", () => {
    renderExplorer();
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    expect(screen.getByTestId("infrastructure-map-stub")).toHaveAttribute(
      "data-metrics-window",
      "900",
    );
  });

  test("the overflow card switches to the complete list", () => {
    window.history.replaceState({}, "", "?infraView=map");
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Map show all" }));
    expect(screen.getByTestId("infrastructure-view-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rows()).toHaveLength(3);
  });
});

/*
 * Issue #3972: the map joins the cards whose services call each other, and a
 * line opens the history of the call it stands for — the Service Map's own
 * drill-down, since traffic is measured per service pair.
 */
describe("traffic on the map", () => {
  const HOME_GROUP: string = "group:category:compute:host|oneuptime-home";
  const TIME_RANGE: RangeStartAndEndDateTime = {
    range: TimeRange.PAST_ONE_DAY,
  };

  function tracedFixture(): Fixture {
    const base: Fixture = fixtures();
    return {
      ...base,
      relationships: [
        ...base.relationships,
        {
          ...relationship("api", "home", EntityRelationshipType.DependsOn),
          callCount: 120,
          errorCount: 1,
          avgDurationMs: 30,
        },
        {
          ...relationship("home", "api", EntityRelationshipType.DependsOn),
          callCount: 12,
        },
      ],
    };
  }

  beforeEach(() => {
    mockEdgePanelRenders.length = 0;
  });

  test("a line opens the history of the busiest call it stands for", () => {
    renderExplorer({ data: tracedFixture(), timeRange: TIME_RANGE });
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Map traffic ${APP_GROUP} -> ${HOME_GROUP}`,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "api calls home" }),
    ).toBeInTheDocument();
    const panel: EdgePanelProps =
      mockEdgePanelRenders[mockEdgePanelRenders.length - 1]!;
    expect(panel.fromEntity).toMatchObject({
      entityKey: "api",
      entityType: EntityType.Service,
      displayName: "api",
    });
    expect(panel.toEntity).toMatchObject({
      entityKey: "home",
      entityType: EntityType.Service,
    });
    expect(panel.relationship).toEqual({
      fromEntityKey: "api",
      toEntityKey: "home",
      relationshipType: EntityRelationshipType.DependsOn,
      callCount: 120,
      errorCount: 1,
      avgDurationMs: 30,
    });
    expect(panel.timeRange).toBe(TIME_RANGE);
    expect(panel.metricsWindowSeconds).toBe(900);

    fireEvent.click(screen.getByRole("button", { name: "Close call history" }));
    expect(
      screen.queryByRole("dialog", { name: "api calls home" }),
    ).not.toBeInTheDocument();
  });

  test("the other direction is its own line, with its own call", () => {
    renderExplorer({ data: tracedFixture(), timeRange: TIME_RANGE });
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Map traffic ${HOME_GROUP} -> ${APP_GROUP}`,
      }),
    );
    const panel: EdgePanelProps =
      mockEdgePanelRenders[mockEdgePanelRenders.length - 1]!;
    expect(panel.relationship).toEqual({
      fromEntityKey: "home",
      toEntityKey: "api",
      relationshipType: EntityRelationshipType.DependsOn,
      callCount: 12,
      errorCount: 0,
    });
  });

  test("one drawer at a time: opening a resource closes the call's history", () => {
    renderExplorer({ data: tracedFixture(), timeRange: TIME_RANGE });
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Map traffic ${APP_GROUP} -> ${HOME_GROUP}`,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "api calls home" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Map service api" }));
    expect(
      screen.queryByRole("dialog", { name: "api calls home" }),
    ).not.toBeInTheDocument();
    expect(lastDrawer().entity.entityKey).toBe("api");
  });

  test("without the page's time range there is no history to open", () => {
    renderExplorer({ data: tracedFixture() });
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    expect(
      screen.queryByRole("button", { name: /^Map traffic/ }),
    ).not.toBeInTheDocument();
  });
});

/*
 * A fake collection server: two IoT devices a page, keyset-paged by the
 * last key, with 4,200 active devices and 5,000 with inactive ones included.
 */
function serveIotPages(
  options: { emptyAfter?: number; emptyTotal?: number } = {},
): void {
  mockFetchCollectionPage.mockImplementation(
    (_rangeStart: unknown, request: unknown): Promise<CollectionPage> => {
      const pageRequest: CollectionPageRequest =
        request as CollectionPageRequest;
      const total: number = pageRequest.includeInactive ? 5000 : 4200;
      const start: number = pageRequest.cursor
        ? Number(pageRequest.cursor.key.replace("iot-", "")) + 1
        : 1;
      if (options.emptyAfter !== undefined && start > options.emptyAfter) {
        // Everything past the cursor went away between the two requests.
        return Promise.resolve(
          page([], options.emptyTotal ?? total - 50, null),
        );
      }
      return Promise.resolve(iotPage(start, start + 1, total));
    },
  );
}

async function expectPageLabel(label: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText(label)).toBeVisible();
  });
}

describe("collection paging", () => {
  test("a collection always opens on its first page, however it is reopened", async () => {
    serveIotPages();
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 3 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toEqual({
      name: "sensor-004",
      key: "iot-4",
    });

    // Away to the overview and back from the tree.
    fireEvent.click(screen.getByTestId("infrastructure-tree-root"));
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "All infrastructure",
    );
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toBeNull();

    // The collection's own tree row, while it is open.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toBeNull();

    // Its breadcrumb.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Infrastructure location" }),
      ).getByRole("button", { name: "IoT Devices" }),
    );
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toBeNull();

    // A search match that lists the whole collection.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");
    search("iot");
    fireEvent.click(screen.getByTestId("infrastructure-collection-match"));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toBeNull();

    // Its card on the overview map.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByTestId("infrastructure-tree-root"));
    fireEvent.click(screen.getByTestId("infrastructure-view-map"));
    fireEvent.click(screen.getByTestId(`map-card-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toBeNull();
  });

  test("an empty page past the first says so and leads back to the first page", async () => {
    serveIotPages({ emptyAfter: 2 });
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const empty: HTMLElement = await screen.findByTestId(
      "infrastructure-collection-page-empty",
    );
    expect(empty).toHaveTextContent("No more items on this page.");
    expect(
      screen.queryByText("Nothing inside this resource."),
    ).not.toBeInTheDocument();
    // The pager is still there, with the way back.
    expect(screen.getByText("Page 2 of 83 · 4,150 IoT devices")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(
      within(empty).getByRole("button", { name: "Back to the first page" }),
    );
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(lastPageRequest().cursor).toBeNull();
    expect(screen.getAllByTestId("infrastructure-collection-row")).toHaveLength(
      2,
    );

    // Previous gets there too.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByTestId("infrastructure-collection-page-empty");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
  });

  test("an emptied page never claims to be past the last page", async () => {
    // Pages 1 and 2 were read; then most of the fleet was pruned (60 left).
    serveIotPages({ emptyAfter: 4, emptyTotal: 60 });
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByTestId("infrastructure-collection-page-empty");
    expect(screen.getByText("Page 3 of 3 · 60 IoT devices")).toBeVisible();
    expect(screen.queryByText(/Page 3 of 2/)).not.toBeInTheDocument();
  });

  test("an empty first page still reads as an empty collection", async () => {
    mockFetchCollectionPage.mockResolvedValue(page([], 0, null));
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    expect(
      await screen.findByText("Nothing inside this resource."),
    ).toBeVisible();
    expect(
      screen.queryByTestId("infrastructure-collection-page-empty"),
    ).not.toBeInTheDocument();
  });
});

describe("Show inactive with a collection open or searched", () => {
  test("toggling it lists the open collection again from its first page, with the new total", async () => {
    serveIotPages();
    const data: Fixture = withCollection();
    const view: RenderResult = renderExplorer({ data });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectPageLabel("Page 2 of 84 · 4,200 IoT devices");

    view.rerender(explorer({ data, includeInactive: true }));
    await expectPageLabel("Page 1 of 100 · 5,000 IoT devices");
    expect(lastPageRequest()).toEqual({
      entityType: EntityType.IoTDevice,
      includeInactive: true,
      nameTerms: [],
      cursor: null,
      limit: 50,
    });
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "IoT Devices",
    );

    /*
     * And straight back to active only: page 1 again, never the page-2
     * cursor the active-only listing had before the toggle.
     */
    const before: number = mockFetchCollectionPage.mock.calls.length;
    view.rerender(explorer({ data, includeInactive: false }));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    const after: number = mockFetchCollectionPage.mock.calls.length;
    expect(after).toBeGreaterThan(before);
    for (let index: number = before; index < after; index++) {
      expect(pageRequest(index)).toEqual({
        entityType: EntityType.IoTDevice,
        includeInactive: false,
        nameTerms: [],
        cursor: null,
        limit: 50,
      });
    }
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  test("toggling it asks the server again how many collection items match", async () => {
    mockFetchCollectionSearchCounts.mockImplementation(
      (
        _rangeStart: unknown,
        request: unknown,
      ): Promise<Map<string, number>> => {
        return Promise.resolve(
          new Map<string, number>([
            [
              EntityType.IoTDevice,
              (request as CollectionSearchRequest).includeInactive
                ? 1500
                : 1234,
            ],
          ]),
        );
      },
    );
    const data: Fixture = withCollection();
    const view: RenderResult = renderExplorer({ data });
    search("sensor");
    expect(
      await screen.findByTestId("infrastructure-collection-match"),
    ).toHaveTextContent("1,234 matching IoT devices");
    expect(mockFetchCollectionSearchCounts).toHaveBeenCalledTimes(1);

    view.rerender(explorer({ data, includeInactive: true }));
    await waitFor(() => {
      expect(
        screen.getByTestId("infrastructure-collection-match"),
      ).toHaveTextContent("1,500 matching IoT devices");
    });
    expect(mockFetchCollectionSearchCounts).toHaveBeenCalledTimes(2);
    expect(mockFetchCollectionSearchCounts.mock.calls[1]![1]).toEqual({
      includeInactive: true,
      types: [{ entityType: EntityType.IoTDevice, nameTerms: ["sensor"] }],
    });
    expect(screen.getByText("1,500 matches")).toBeVisible();
  });
});

describe("collection request failures", () => {
  const BUSY: string = "The topology service is busy. Try again in a moment.";

  function tooManyRequests(): HTTPErrorResponse {
    return new HTTPErrorResponse(
      429,
      { message: "Too many topology requests are running. Try again shortly." },
      {},
    );
  }

  test("a busy server (429) on a page says so and offers another try", async () => {
    mockFetchCollectionPage
      .mockRejectedValueOnce(tooManyRequests())
      .mockResolvedValueOnce(iotPage(1, 2, 4200));
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    const alert: HTMLElement = await screen.findByRole("alert");
    // The page's own (translated) copy, not the server's wording.
    expect(alert).toHaveTextContent(BUSY);
    expect(alert).not.toHaveTextContent("Too many topology requests");
    expect(alert).not.toHaveTextContent("Topology was updated");
    expect(
      within(alert).queryByRole("button", { name: "Reload page" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await expectPageLabel("Page 1 of 84 · 4,200 IoT devices");
    expect(mockFetchCollectionPage).toHaveBeenCalledTimes(2);
  });

  test("a busy server (429) on a search says so and offers another try", async () => {
    mockFetchCollectionSearchCounts
      .mockRejectedValueOnce(tooManyRequests())
      .mockResolvedValueOnce(
        new Map<string, number>([[EntityType.IoTDevice, 9]]),
      );
    renderExplorer({ data: withCollection() });
    search("sensor");
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      `Could not search large collections. ${BUSY}`,
    );
    expect(alert).not.toHaveTextContent("Too many topology requests");
    expect(
      within(alert).queryByRole("button", { name: "Reload page" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByTestId("infrastructure-collection-match"),
    ).toHaveTextContent("9 matching IoT devices");
  });

  test("a newer server format offers a reload, since trying again cannot help", async () => {
    const reload: SpyInstance<() => void> = jest
      .spyOn(Navigation, "reload")
      .mockImplementation(() => {
        return undefined;
      });
    mockFetchCollectionPage.mockRejectedValue(new TopologyOutdatedError(99));
    renderExplorer({ data: withCollection() });
    fireEvent.click(screen.getByTestId(`infrastructure-tree-${IOT}`));
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Topology was updated. Reload the page.");
    expect(
      within(alert).queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mockFetchCollectionPage).toHaveBeenCalledTimes(1);
  });

  test("a newer server format on a search offers a reload too", async () => {
    const reload: SpyInstance<() => void> = jest
      .spyOn(Navigation, "reload")
      .mockImplementation(() => {
        return undefined;
      });
    mockFetchCollectionSearchCounts.mockRejectedValue(
      new TopologyOutdatedError(99),
    );
    renderExplorer({ data: withCollection() });
    search("sensor");
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not search large collections. Topology was updated. Reload the page.",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import ObjectID from "../../../Types/ObjectID";
import InfrastructureExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Infrastructure explorer: a tree of things that contain things, a table
 * of what is inside the selected scope, a map of one level, and search. The
 * estate used here is the one that motivated the redesign — application pods
 * that reported themselves as hosts, most of them long gone.
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
        nodeIds: Array<string>;
        onOpenNode: (id: string) => void;
        onOpenService?: (key: string) => void;
        onShowAll?: () => void;
      }): React.ReactElement => {
        return (
          <div data-testid="infrastructure-map-stub">
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
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entity: InventoryItem;
        onClose: () => void;
        onFocus: (key: string) => void;
        focusButtonLabel?: string;
      }): React.ReactElement => {
        return (
          <div role="dialog" aria-label={props.entity.displayName}>
            <button type="button" onClick={props.onClose}>
              Close resource details
            </button>
            <button
              type="button"
              onClick={() => {
                props.onFocus(props.entity.entityKey!);
              }}
            >
              {props.focusButtonLabel}
            </button>
          </div>
        );
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
): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = key;
  item.entityType = type;
  item.displayName = name;
  item.lastSeenAt = lastSeenAt;
  item.source = EntitySource.Discovered;
  return item;
}
function hostedOn(from: string, to: string): InventoryItemRelationship {
  const item: InventoryItemRelationship = new InventoryItemRelationship();
  item.fromEntityKey = from;
  item.toEntityKey = to;
  item.relationshipType = EntityRelationshipType.HostedOn;
  return item;
}

const APP_GROUP: string = "group:category:compute:host|oneuptime-app";

function fixtures(): {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
} {
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

function renderExplorer(
  options: {
    data?: ReturnType<typeof fixtures>;
    includeInactive?: boolean;
    onOpenServiceMap?: (key: string) => void;
  } = {},
): void {
  render(
    <MemoryRouter>
      <InfrastructureExplorer
        {...(options.data || fixtures())}
        metricsWindowSeconds={900}
        rangeStart={RANGE_START}
        includeInactive={options.includeInactive}
        onOpenServiceMap={options.onOpenServiceMap}
      />
    </MemoryRouter>,
  );
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

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard/project/topology/overview?tab=Infrastructure",
  );
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
    const tree: HTMLElement = screen.getByRole("complementary", {
      name: "Infrastructure tree",
    });
    expect(
      within(tree).getByTestId(`infrastructure-tree-${APP_GROUP}`),
    ).toBeInTheDocument();
    expect(within(tree).queryByText("build-server")).not.toBeInTheDocument();
    fireEvent.click(
      within(tree).getByRole("button", { name: "Collapse Hosts & containers" }),
    );
    expect(
      within(tree).queryByTestId(`infrastructure-tree-${APP_GROUP}`),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(tree).getByRole("button", { name: "Expand Hosts & containers" }),
    );
    expect(
      within(tree).getByTestId(`infrastructure-tree-${APP_GROUP}`),
    ).toBeInTheDocument();
  });

  test("a plain resource opens its details", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "View details for build-server" }),
    );
    expect(
      screen.getByRole("dialog", { name: "build-server" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show where it is" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "Hosts & containers",
    );
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

  test("a stale shared link falls back to the overview", () => {
    window.history.replaceState({}, "", "?infraFocus=missing");
    renderExplorer();
    expect(screen.getByTestId("infrastructure-scope-title")).toHaveTextContent(
      "All infrastructure",
    );
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

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
import ObjectID from "../../../Types/ObjectID";
import InfrastructureExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer";

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
        entities: Array<InventoryItem>;
        onSelectResource?: (key: string) => void;
      }): React.ReactElement => {
        return (
          <div data-testid="infrastructure-map">
            {props.entities.map((item: InventoryItem): React.ReactElement => {
              return (
                <button
                  type="button"
                  key={item.entityKey}
                  onClick={() => {
                    props.onSelectResource?.(item.entityKey!);
                  }}
                >
                  {item.displayName}
                </button>
              );
            })}
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
              Explore this resource
            </button>
          </div>
        );
      },
    };
  },
);

function entity(
  key: string,
  type: EntityType = EntityType.Host,
  name: string = key,
): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = key;
  item.entityType = type;
  item.displayName = name;
  return item;
}
function edge(from: string, to: string): InventoryItemRelationship {
  const item: InventoryItemRelationship = new InventoryItemRelationship();
  item.fromEntityKey = from;
  item.toEntityKey = to;
  item.relationshipType = EntityRelationshipType.HostedOn;
  return item;
}
function fixtures(): {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
} {
  return {
    entities: [
      entity("api", EntityType.Service, "Checkout API"),
      entity("web", EntityType.Service, "Web frontend"),
      entity("api-host", EntityType.Host, "API worker"),
      entity("shared", EntityType.Host, "Shared worker"),
      entity("web-host", EntityType.Host, "Web worker"),
      entity("quiet", EntityType.Host, "Quiet host"),
    ],
    relationships: [
      edge("api", "api-host"),
      edge("api", "shared"),
      edge("web", "shared"),
      edge("web", "web-host"),
    ],
  };
}
function renderExplorer(
  data: {
    entities: Array<InventoryItem>;
    relationships: Array<InventoryItemRelationship>;
  } = fixtures(),
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <InfrastructureExplorer {...data} metricsWindowSeconds={900} />
    </MemoryRouter>,
  );
}
function search(value: string): void {
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search infrastructure" }),
    { target: { value } },
  );
}
function types(): ReturnType<typeof within> {
  return within(screen.getByRole("complementary", { name: "Resource types" }));
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

describe("Infrastructure explorer", () => {
  test("starts with meaningful groups and resource categories instead of a dense canvas", () => {
    renderExplorer();
    expect(
      screen.getByRole("button", { name: "Explore Checkout API" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Explore Web frontend" }),
    ).toBeVisible();
    expect(screen.getByText("Browse resources")).toBeVisible();
    expect(screen.getByText("Unlinked resources")).toBeVisible();
    expect(screen.queryByTestId("infrastructure-map")).not.toBeInTheDocument();
  });
  test("drills into one group's resources and returns through a breadcrumb", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "Explore Checkout API" }),
    );
    expect(screen.getByText("API worker")).toBeVisible();
    expect(screen.getByText("Shared worker")).toBeVisible();
    expect(screen.queryByText("Web worker")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("infraFocus")).toBe(
      "api",
    );
    const breadcrumb: HTMLElement = screen.getByRole("navigation", {
      name: "Infrastructure location",
    });
    expect(
      within(breadcrumb).getByRole("button", { name: "Checkout API" }),
    ).toHaveAttribute("aria-current", "location");
    fireEvent.click(screen.getByRole("button", { name: "All infrastructure" }));
    expect(
      screen.getByRole("button", { name: "Explore Web frontend" }),
    ).toBeVisible();
    expect(new URLSearchParams(window.location.search).has("infraFocus")).toBe(
      false,
    );
  });
  test("search reports matches and combines them with a resource-type filter", () => {
    renderExplorer();
    fireEvent.click(types().getByRole("button", { name: /^Host / }));
    search("worker");
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 matching resources",
    );
    expect(screen.getByText("API worker")).toBeVisible();
    expect(screen.queryByText("Quiet host")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Explore Checkout API/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Explore Checkout API" }),
    ).toBeVisible();
  });
  test("a search with no matches has an actionable reset and can expand beyond the group", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "Explore Checkout API" }),
    );
    search("web worker");
    expect(screen.getByText("No resources match your filters")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Search all infrastructure" }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Explore Web frontend" }),
    ).toBeVisible();
  });
  test("restores shareable scope, search, type, and map state and preserves service search parameters", async () => {
    window.history.replaceState(
      {},
      "",
      "?tab=Infrastructure&infraFocus=api&infraSearch=worker&infraType=host&infraView=map&search=checkout&focus=service-id",
    );
    renderExplorer();
    expect(screen.getByRole("searchbox")).toHaveValue("worker");
    const map: HTMLElement = screen.getByTestId("infrastructure-map");
    expect(within(map).getByText("API worker")).toBeVisible();
    expect(within(map).getByText("Shared worker")).toBeVisible();
    expect(within(map).queryByText("Web worker")).not.toBeInTheDocument();
    search("api");
    await waitFor(() => {
      expect(
        new URLSearchParams(window.location.search).get("infraSearch"),
      ).toBe("api");
    });
    expect(new URLSearchParams(window.location.search).get("search")).toBe(
      "checkout",
    );
    expect(new URLSearchParams(window.location.search).get("focus")).toBe(
      "service-id",
    );
  });
  test("switches views without losing a selected group or its resource filter", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "Explore Checkout API" }),
    );
    search("api worker");
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Infrastructure view" }),
      ).getByRole("button", { name: "Map" }),
    );
    expect(screen.getByTestId("infrastructure-map")).toHaveTextContent(
      "API worker",
    );
    expect(screen.getByTestId("infrastructure-map")).not.toHaveTextContent(
      "Shared worker",
    );
    expect(new URLSearchParams(window.location.search).get("infraView")).toBe(
      "map",
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Infrastructure view" }),
      ).getByRole("button", { name: "Explore" }),
    );
    expect(screen.queryByTestId("infrastructure-map")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("api worker");
    expect(new URLSearchParams(window.location.search).get("infraFocus")).toBe(
      "api",
    );
  });
  test("opens inventory details from a result and uses the same selection action from the map", () => {
    renderExplorer();
    search("api worker");
    fireEvent.click(screen.getByRole("button", { name: /API worker Host/ }));
    expect(screen.getByRole("dialog", { name: "API worker" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Close resource details" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Infrastructure view" }),
      ).getByRole("button", { name: "Map" }),
    );
    fireEvent.click(
      within(screen.getByTestId("infrastructure-map")).getByRole("button", {
        name: "API worker",
      }),
    );
    expect(screen.getByRole("dialog", { name: "API worker" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Explore this resource" }),
    );
    expect(new URLSearchParams(window.location.search).get("infraFocus")).toBe(
      "api-host",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  test("explains missing inventory details and shows known connections for an unresolved endpoint", () => {
    renderExplorer({
      entities: [entity("api", EntityType.Service, "Checkout API")],
      relationships: [edge("api", "missing-host")],
    });
    search("missing-host");
    fireEvent.click(
      screen.getByRole("button", {
        name: /Undiscovered resource · missing-host/,
      }),
    );
    const panel: HTMLElement = screen.getByRole("dialog", {
      name: "Undiscovered resource",
    });
    expect(within(panel).getByText("Known connections")).toBeVisible();
    expect(
      within(panel).getByText(/inventory details have not been discovered yet/),
    ).toBeVisible();
    expect(within(panel).getByText(/Checkout API hosted on/)).toBeVisible();
  });
  test("paginates large inventories and returns to the first page when search changes", () => {
    const entities: Array<InventoryItem> = Array.from(
      { length: 85 },
      (_value: unknown, index: number): InventoryItem => {
        return entity(
          `host-${String(index).padStart(3, "0")}`,
          EntityType.Host,
          `Host ${String(index).padStart(3, "0")}`,
        );
      },
    );
    renderExplorer({ entities, relationships: [] });
    fireEvent.click(types().getByRole("button", { name: /^Host 85$/ }));
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(40);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 / 3")).toBeVisible();
    expect(screen.queryByText("Host 000")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    search("host-000");
    expect(screen.getByText("Host 000")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
  });
  test("falls back from stale scope links and explains how to populate an empty catalog", () => {
    window.history.replaceState({}, "", "?infraFocus=deleted-item");
    const view: ReturnType<typeof render> = renderExplorer();
    expect(
      screen.getByRole("button", { name: "Explore Checkout API" }),
    ).toBeVisible();
    view.unmount();
    renderExplorer({ entities: [], relationships: [] });
    expect(
      screen.getByText("No infrastructure topology discovered yet"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Connect your infrastructure" }),
    ).toBeVisible();
  });
});

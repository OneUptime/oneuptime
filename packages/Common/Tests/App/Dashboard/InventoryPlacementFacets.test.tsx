import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { chooseDropdownOption } from "../../DropdownPicks";
import {
  FILTER_OPERATOR_LABELS,
  FilterOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import InventoryTable, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable";
import {
  InventoryPlacementChoice,
  InventoryPlacementOptionsRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryPlacementApi";
import { InventoryPlacementLevel } from "../../../Utils/Inventory/InventoryItemPlacement";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNoneOrNull from "../../../Types/BaseDatabase/IncludesNoneOrNull";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

/*
 * Inventory > All Items, filtered by where an item sits (#11470): the
 * Cluster, Host and Datacenter chips of the production list, driven as a
 * person drives them. ModelTable is the fetch boundary - its query is
 * captured and its topContent (the chips) rendered - and the server's
 * choices come from a stand-in for the placement route, which records what
 * each chip asked. Every pick travels through the real chip, its state and
 * the query merge.
 */

interface CapturedTableProps {
  query: Record<string, unknown>;
  topContent: ReactElement;
  currentFacetState: JSONObject;
  onFacetStateRestored: (state: JSONObject | null) => void;
  id: string;
}

let capturedTableProps: CapturedTableProps | null = null;
let capturedQueries: Array<Record<string, unknown>> = [];
const asked: Array<InventoryPlacementOptionsRequest> = [];

const CHOICES: Record<InventoryPlacementLevel, Array<InventoryPlacementChoice>> =
  {
    [InventoryPlacementLevel.Cluster]: [
      { value: "cluster-alpha", count: 10552 },
      { value: "prod-eu", count: 1 },
    ],
    [InventoryPlacementLevel.Host]: [
      { value: "esx-node-07.acme.lan", count: 10250 },
      { value: "esx-node-08.acme.lan", count: 302 },
    ],
    [InventoryPlacementLevel.Datacenter]: [{ value: "DC-NORTH", count: 10554 }],
  };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryPlacementApi",
  () => {
    return {
      __esModule: true,
      fetchInventoryPlacementOptions: async (
        request: InventoryPlacementOptionsRequest,
      ): Promise<Array<InventoryPlacementChoice>> => {
        asked.push(request);
        return CHOICES[request.level].filter(
          (choice: InventoryPlacementChoice): boolean => {
            return choice.value
              .toLowerCase()
              .includes(request.search.toLowerCase());
          },
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      capturedTableProps = props;
      capturedQueries.push(props.query);
      return <div>{props.topContent}</div>;
    },
  };
});

jest.mock("../../../UI/Components/Icon/Icon", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/useCustomFieldFacets",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { facets: [], isLoading: false };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
        unarchiveBulkActions: [],
      };
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();

function renderInventory(props: ComponentProps = {}): void {
  render(
    <MemoryRouter>
      <InventoryTable {...props} />
    </MemoryRouter>,
  );
}

function getTable(): CapturedTableProps {
  expect(capturedTableProps).not.toBeNull();
  return capturedTableProps!;
}

function chipButton(label: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${label}(?:$| ·)`),
  });
}

function openFacet(label: string): HTMLElement {
  const chip: HTMLElement = chipButton(label);
  if (chip.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(chip);
  }
  return chip
    .closest('[data-testid="filter-chip"]')!
    .parentElement!.querySelector('[role="dialog"]') as HTMLElement;
}

// Opens the chip and waits for the server's choices to be drawn.
async function openLoaded(label: string, firstChoice: string): Promise<HTMLElement> {
  const dialog: HTMLElement = openFacet(label);
  await waitFor(() => {
    expect(within(dialog).getByText(firstChoice, { exact: true })).toBeVisible();
  });
  return dialog;
}

async function choose(label: string, choice: string): Promise<void> {
  const dialog: HTMLElement = await openLoaded(label, choice);
  fireEvent.click(
    within(dialog).getByText(choice, { exact: true }).closest('[role="option"]')!,
  );
}

function setOperator(label: string, operator: FilterOperator): void {
  chooseDropdownOption(
    within(openFacet(label)).getByRole("combobox", {
      name: `${label} operator`,
    }),
    FILTER_OPERATOR_LABELS[operator],
  );
}

function expectFilter(
  field: string,
  values: Array<string>,
  excluded: boolean = false,
): void {
  const value: unknown = getTable().query[field];
  expect(value).toBeInstanceOf(excluded ? IncludesNoneOrNull : Includes);
  expect((value as Includes | IncludesNoneOrNull).values).toEqual(values);
}

beforeEach(() => {
  capturedTableProps = null;
  capturedQueries = [];
  asked.length = 0;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(TableFilterUrlState, "read").mockReturnValue(null);
  jest.spyOn(TableFilterUrlState, "write").mockImplementation(() => {});
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID.toString()}/inventory/items`,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Cluster, Host and Datacenter chips", () => {
  test("are on All Items, after Status, before anything is asked of the server", () => {
    renderInventory();
    const labels: Array<string> = screen
      .getAllByTestId("filter-chip")
      .map((chip: HTMLElement): string => {
        return chip.textContent || "";
      });
    const status: number = labels.findIndex((label: string): boolean => {
      return label.startsWith("Status");
    });
    expect(labels.slice(status, status + 4)).toEqual([
      expect.stringMatching(/^Status/),
      expect.stringMatching(/^Cluster/),
      expect.stringMatching(/^Host/),
      expect.stringMatching(/^Datacenter/),
    ]);
    // Nothing is read until a chip is opened.
    expect(asked).toEqual([]);
    expect(getTable().query).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
  });

  test("opening Host asks the server for the live list's hosts, and lists each with its item count", async () => {
    renderInventory();
    const dialog: HTMLElement = await openLoaded("Host", "esx-node-07.acme.lan");

    expect(asked).toEqual([
      { level: InventoryPlacementLevel.Host, search: "", isArchived: false },
    ]);
    expect(within(dialog).getByText("esx-node-08.acme.lan")).toBeVisible();
    expect(within(dialog).getByText(/^10,?250 items$/)).toBeVisible();
    expect(within(dialog).getByText("302 items")).toBeVisible();
    expect(within(dialog).getByPlaceholderText("Search hosts...")).toBeVisible();
  });

  test("what is typed is asked of the server, which narrows the choices", async () => {
    renderInventory();
    const dialog: HTMLElement = await openLoaded("Cluster", "cluster-alpha");

    fireEvent.change(within(dialog).getByPlaceholderText("Search clusters..."), {
      target: { value: "prod" },
    });

    await waitFor(() => {
      expect(asked).toContainEqual({
        level: InventoryPlacementLevel.Cluster,
        search: "prod",
        isArchived: false,
      });
    });
    await waitFor(() => {
      expect(within(dialog).queryByText("cluster-alpha")).toBeNull();
    });
    expect(within(dialog).getByText("prod-eu")).toBeVisible();
  });

  test("choosing a host filters the list to the items on it, on the server", async () => {
    renderInventory();
    await choose("Host", "esx-node-07.acme.lan");

    expectFilter("placementHost", ["esx-node-07.acme.lan"]);
    expect(
      screen.getByRole("button", { name: /^Host · esx-node-07\.acme\.lan/ }),
    ).toBeVisible();
    expect(getTable().currentFacetState["facetSelections"]).toEqual({
      inventoryHost: ["esx-node-07.acme.lan"],
    });
  });

  test("two hosts are either; is not keeps the items on no host", async () => {
    renderInventory();
    await choose("Host", "esx-node-07.acme.lan");
    await choose("Host", "esx-node-08.acme.lan");
    expectFilter("placementHost", [
      "esx-node-07.acme.lan",
      "esx-node-08.acme.lan",
    ]);

    setOperator("Host", "is_not");
    expectFilter(
      "placementHost",
      ["esx-node-07.acme.lan", "esx-node-08.acme.lan"],
      true,
    );
  });

  test("a cluster, a datacenter and a type add up, none replacing another", async () => {
    renderInventory();
    await choose("Cluster", "cluster-alpha");
    await choose("Datacenter", "DC-NORTH");
    fireEvent.click(
      within(openFacet("Type"))
        .getByText("VMware Virtual Machine", { exact: true })
        .closest('[role="option"]')!,
    );

    expectFilter("placementCluster", ["cluster-alpha"]);
    expectFilter("placementDatacenter", ["DC-NORTH"]);
    expectFilter("entityType", [EntityType.VMwareVirtualMachine]);
  });

  test("the Archived list's chips ask for the archived items' places", async () => {
    renderInventory({ archivedOnly: true });
    await openLoaded("Datacenter", "DC-NORTH");
    expect(asked).toEqual([
      {
        level: InventoryPlacementLevel.Datacenter,
        search: "",
        isArchived: true,
      },
    ]);
  });

  test("a saved view's places filter the first request, and read as chosen", async () => {
    jest.spyOn(TableFilterUrlState, "read").mockReturnValue({
      facetSelections: {
        inventoryCluster: ["cluster-alpha"],
        inventoryHost: ["esx-node-07.acme.lan"],
      },
      facetOperators: { inventoryHost: "is_not" },
    });
    renderInventory();

    expect(capturedQueries.length).toBeGreaterThan(0);
    for (const query of capturedQueries) {
      expect(query["placementCluster"]).toEqual(new Includes(["cluster-alpha"]));
      expect(query["placementHost"]).toEqual(
        new IncludesNoneOrNull(["esx-node-07.acme.lan"]),
      );
    }
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Cluster · cluster-alpha/ }),
      ).toBeVisible();
    });
    expect(
      screen.getByRole("button", { name: "Clear Host filter" }),
    ).toBeVisible();
  });

  test("restoring a view sets the places, and resetting it clears them", () => {
    renderInventory();
    act(() => {
      getTable().onFacetStateRestored({
        facetSelections: { inventoryDatacenter: ["DC-NORTH"] },
        facetOperators: {},
      });
    });
    expectFilter("placementDatacenter", ["DC-NORTH"]);

    act(() => {
      getTable().onFacetStateRestored(null);
    });
    expect(getTable().query).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
  });
});

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
import React, { ReactElement } from "react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
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
  INVENTORY_ARCHIVED_TABLE_ID,
  INVENTORY_ITEMS_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryFacets";
import InventoryItems from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Items";
import useResourceOwners, {
  ResourceFacet,
  UseResourceOwnersResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

/*
 * Render the production inventory table and facet hook together. ModelTable is
 * the fetch boundary: capture its query and render its actual topContent so
 * every selection below travels through the real chip, state and query merge.
 * This catches a visible chip that fails to filter, a hidden Type/Status chip,
 * and restored selections that are lost before the table's first request.
 */
interface CapturedTableProps {
  query: Record<string, unknown>;
  topContent: ReactElement;
  currentFacetState: JSONObject;
  onFacetStateRestored: (state: JSONObject | null) => void;
  noItemsMessage: string | ReactElement;
  id: string;
}

let capturedTableProps: CapturedTableProps | null = null;
let capturedQueries: Array<Record<string, unknown>> = [];

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
      return { archiveBulkActions: [], unarchiveBulkActions: [] };
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();

type RenderInventoryFunction = (props?: ComponentProps) => void;

const renderInventory: RenderInventoryFunction = (
  props: ComponentProps = {},
): void => {
  render(
    <MemoryRouter>
      <InventoryTable {...props} />
    </MemoryRouter>,
  );
};

type GetTableFunction = () => CapturedTableProps;

const getTable: GetTableFunction = (): CapturedTableProps => {
  expect(capturedTableProps).not.toBeNull();
  return capturedTableProps!;
};

type OpenFacetFunction = (label: string) => HTMLElement;

const openFacet: OpenFacetFunction = (label: string): HTMLElement => {
  const chip: HTMLElement = screen.getByRole("button", {
    name: new RegExp(`^${label}(?:$| ·)`),
  });

  if (chip.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(chip);
  }

  return chip.parentElement!.querySelector('[role="dialog"]') as HTMLElement;
};

type SelectOptionFunction = (label: string, option: string) => void;

const selectOption: SelectOptionFunction = (
  label: string,
  option: string,
): void => {
  fireEvent.click(
    within(openFacet(label))
      .getByText(option, { exact: true })
      .closest('[role="option"]')!,
  );
};

type SetOperatorFunction = (label: string, operator: string) => void;

const setOperator: SetOperatorFunction = (
  label: string,
  operator: string,
): void => {
  fireEvent.change(
    within(openFacet(label)).getByRole("combobox", {
      name: `${label} operator`,
    }),
    { target: { value: operator } },
  );
};

type ExpectIncludedFunction = (
  field: string,
  values: Array<string>,
  excluded?: boolean,
) => void;

const expectIncluded: ExpectIncludedFunction = (
  field: string,
  values: Array<string>,
  excluded: boolean = false,
): void => {
  const value: unknown = getTable().query[field];
  expect(value).toBeInstanceOf(excluded ? IncludesNone : Includes);
  expect((value as Includes | IncludesNone).values).toEqual(values);
};

beforeEach(() => {
  capturedTableProps = null;
  capturedQueries = [];
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
  window.history.replaceState(null, "", "/");
});

describe("inventory Items navigation with real URL persistence", () => {
  type RenderItemsPageFunction = () => void;

  const renderItemsPage: RenderItemsPageFunction = (): void => {
    render(
      <BrowserRouter>
        <InventoryItems
          pageRoute={
            new Route(`/dashboard/${PROJECT_ID.toString()}/inventory/items`)
          }
          currentProject={null}
          hasPaymentMethod={false}
        />
      </BrowserRouter>,
    );
  };

  beforeEach(() => {
    // These route tests exercise the browser URL and real persistence layer.
    jest.spyOn(TableFilterUrlState, "read").mockRestore();
    jest.spyOn(TableFilterUrlState, "write").mockRestore();
  });

  test("converts an Overview scope into visible facets before the first table request", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID.toString()}/inventory/items?type=service&source=discovered&stale=true&tab=all#items`,
    );
    renderItemsPage();

    await waitFor(() => {
      expect(capturedTableProps).not.toBeNull();
    });

    for (const query of capturedQueries) {
      expect(query["entityType"]).toEqual(new Includes([EntityType.Service]));
      expect(query["source"]).toEqual(new Includes([EntitySource.Discovered]));
      expect(query["inventoryStatus"]).toEqual(new Includes(["stale"]));
    }

    expect(
      screen.getByRole("button", { name: /^Type · Service/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Status · Stale/ }),
    ).toBeVisible();
    const params: URLSearchParams = new URLSearchParams(window.location.search);
    expect(params.has("type")).toBe(false);
    expect(params.has("source")).toBe(false);
    expect(params.has("stale")).toBe(false);
    expect(params.get("tab")).toBe("all");
    expect(params.has(`${INVENTORY_ITEMS_TABLE_ID}-facets`)).toBe(true);
    expect(window.location.hash).toBe("#items");
  });

  test("keeps edits and clearing after remount instead of reapplying the legacy type", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID.toString()}/inventory/items?type=service`,
    );
    renderItemsPage();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Type · Service/ }),
      ).toBeVisible();
    });

    selectOption("Type", "Host");
    selectOption("Type", "Service");
    selectOption("Status", "Live");
    expectIncluded("entityType", [EntityType.Host]);

    cleanup();
    capturedQueries = [];
    renderItemsPage();

    expectIncluded("entityType", [EntityType.Host]);
    expectIncluded("inventoryStatus", ["live"]);
    expect(capturedQueries[0]!["entityType"]).toEqual(
      new Includes([EntityType.Host]),
    );
    expect(new URLSearchParams(window.location.search).has("type")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    cleanup();
    capturedQueries = [];
    renderItemsPage();

    expect(capturedQueries[0]).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
    expect(screen.getByRole("button", { name: "Type" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Status" })).toBeVisible();
    expect(
      new URLSearchParams(window.location.search).has(
        `${INVENTORY_ITEMS_TABLE_ID}-facets`,
      ),
    ).toBe(false);
  });
});

describe("inventory Type and Status facet controls", () => {
  test("renders Type, Source, Status and Last Seen on the inventory list", () => {
    renderInventory();

    for (const label of ["Type", "Source", "Status", "Last Seen"]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }

    expect(screen.queryByRole("button", { name: "Owner" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(getTable().query).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
  });

  test("filters a single type using its stored value and its readable label", () => {
    renderInventory();
    selectOption("Type", "Kubernetes Pod");

    expectIncluded("entityType", [EntityType.KubernetesPod]);
    expect(
      screen.getByRole("button", { name: /^Type · Kubernetes Pod/ }),
    ).toBeVisible();
    expect(getTable().currentFacetState["facetSelections"]).toEqual({
      inventoryType: [EntityType.KubernetesPod],
    });
    expect(getTable().noItemsMessage).toBe(
      "No inventory item matches the facets above.",
    );
  });

  test("keeps multiple selected types and can deselect one without clearing the other", () => {
    renderInventory();
    selectOption("Type", "Kubernetes Pod");
    selectOption("Type", "Host");

    expectIncluded("entityType", [EntityType.KubernetesPod, EntityType.Host]);
    expect(within(openFacet("Type")).getByRole("listbox")).toHaveAttribute(
      "aria-multiselectable",
      "true",
    );

    selectOption("Type", "Kubernetes Pod");
    expectIncluded("entityType", [EntityType.Host]);
  });

  test("excludes multiple types with is not", () => {
    renderInventory();
    selectOption("Type", "Kubernetes Pod");
    selectOption("Type", "Host");
    setOperator("Type", "is_not");

    expectIncluded(
      "entityType",
      [EntityType.KubernetesPod, EntityType.Host],
      true,
    );
    expect(getTable().currentFacetState["facetOperators"]).toEqual({
      inventoryType: "is_not",
    });
  });

  test("searches the type catalog without changing the current selection", () => {
    renderInventory();
    selectOption("Type", "Host");
    const dialog: HTMLElement = openFacet("Type");

    fireEvent.change(
      within(dialog).getByPlaceholderText("Search inventory types..."),
      { target: { value: "Kubernetes Pod" } },
    );

    expect(
      within(within(dialog).getByRole("listbox")).getAllByRole("option"),
    ).toHaveLength(1);
    expect(
      within(dialog).getByRole("option", { name: /^Kubernetes Pod / }),
    ).toBeVisible();
    expectIncluded("entityType", [EntityType.Host]);
  });

  test.each([
    ["Live", "live"],
    ["Recent", "recent"],
    ["Stale", "stale"],
    ["Never seen", "never"],
    ["Not tracked", "not-tracked"],
  ])(
    "filters %s using the matching status value",
    (label: string, value: string) => {
      renderInventory();
      selectOption("Status", label);

      expectIncluded("inventoryStatus", [value]);
      expect(
        screen.getByRole("button", { name: new RegExp(`^Status · ${label}`) }),
      ).toBeVisible();
      expect(getTable().currentFacetState["facetSelections"]).toEqual({
        inventoryStatus: [value],
      });
    },
  );

  test("selects several statuses and switches between inclusion and exclusion", () => {
    renderInventory();
    selectOption("Status", "Live");
    selectOption("Status", "Recent");
    selectOption("Status", "Never seen");

    expectIncluded("inventoryStatus", ["live", "recent", "never"]);
    setOperator("Status", "is_not");
    expectIncluded("inventoryStatus", ["live", "recent", "never"], true);
    setOperator("Status", "is");
    expectIncluded("inventoryStatus", ["live", "recent", "never"]);
  });

  test("offers only inclusion and exclusion operators for Status", () => {
    renderInventory();
    const dialog: HTMLElement = openFacet("Status");
    const operator: HTMLElement = within(dialog).getByRole("combobox", {
      name: "Status operator",
    });

    expect(
      within(operator)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return (option as HTMLOptionElement).value;
        }),
    ).toEqual(["is", "is_not"]);
    expect(within(dialog).getByRole("listbox")).toHaveAttribute(
      "aria-multiselectable",
      "true",
    );
  });

  test("combines Type, Status, Source and Last Seen without overwriting any dimension", () => {
    renderInventory();
    selectOption("Type", "Kubernetes Pod");
    selectOption("Status", "Never seen");
    selectOption("Source", "Discovered");
    setOperator("Last Seen", "is_empty");

    expectIncluded("entityType", [EntityType.KubernetesPod]);
    expectIncluded("inventoryStatus", ["never"]);
    expectIncluded("source", [EntitySource.Discovered]);
    expect(getTable().query["lastSeenAt"]).toBeInstanceOf(IsNull);
    expect(getTable().query["projectId"]).toEqual(PROJECT_ID);
    expect(getTable().query["isArchived"]).toBe(false);
  });

  test.each([
    ["Status", "Stale", "inventoryStatus", "Live", "live"],
    ["Type", "Host", "entityType", "Kubernetes Pod", EntityType.KubernetesPod],
    ["Source", "Discovered", "source", "Added by you", EntitySource.Manual],
  ])(
    "clears an excluded %s and resets its operator while preserving other facets",
    (
      label: string,
      selected: string,
      field: string,
      nextLabel: string,
      nextValue: string,
    ) => {
      renderInventory();
      const preservesType: boolean = label !== "Type";
      selectOption(
        preservesType ? "Type" : "Status",
        preservesType ? "Host" : "Live",
      );
      selectOption(label, selected);
      setOperator(label, "is_not");
      fireEvent.click(
        screen.getByRole("button", { name: `Clear ${label} filter` }),
      );

      expect(getTable().query).not.toHaveProperty(field);
      expectIncluded(
        preservesType ? "entityType" : "inventoryStatus",
        preservesType ? [EntityType.Host] : ["live"],
      );
      selectOption(label, nextLabel);
      expectIncluded(field, [nextValue]);
    },
  );

  test.each(["Enter", " "])(
    "clears a selected Type with the %p key while preserving Status",
    (key: string) => {
      renderInventory();
      selectOption("Type", "Host");
      selectOption("Status", "Live");
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Clear Type filter" }),
        {
          key: key,
        },
      );

      expect(getTable().query).not.toHaveProperty("entityType");
      expectIncluded("inventoryStatus", ["live"]);
      expect(screen.getByRole("button", { name: "Type" })).toBeVisible();
    },
  );

  test("clears every facet and removes the persisted state", () => {
    renderInventory();
    selectOption("Type", "Host");
    selectOption("Status", "Stale");
    setOperator("Status", "is_not");
    selectOption("Source", "Discovered");
    setOperator("Last Seen", "is_empty");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(getTable().query).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
    expect(getTable().currentFacetState["facetSelections"]).toEqual({});
    expect(getTable().currentFacetState["facetOperators"]).toEqual({});
    expect(TableFilterUrlState.write).toHaveBeenLastCalledWith(
      INVENTORY_ITEMS_TABLE_ID,
      "facets",
      null,
    );
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    expect(typeof getTable().noItemsMessage).not.toBe("string");
  });
});

describe("inventory facet persistence and embedded scopes", () => {
  test("restores Type and Status from a shared URL before the first table query", () => {
    jest.spyOn(TableFilterUrlState, "read").mockReturnValue({
      facetSelections: {
        inventoryType: [EntityType.Host, EntityType.KubernetesPod],
        inventoryStatus: ["live", "recent"],
      },
      facetOperators: { inventoryStatus: "is_not" },
    });
    renderInventory();

    expect(capturedQueries.length).toBeGreaterThan(0);
    for (const query of capturedQueries) {
      expect(query["entityType"]).toEqual(
        new Includes([EntityType.Host, EntityType.KubernetesPod]),
      );
      expect(query["inventoryStatus"]).toEqual(
        new IncludesNone(["live", "recent"]),
      );
    }
    expect(
      screen.getByRole("button", { name: "Clear Type filter" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear Status filter" }),
    ).toBeVisible();
    expect(TableFilterUrlState.read).toHaveBeenCalledWith(
      INVENTORY_ITEMS_TABLE_ID,
      "facets",
    );
  });

  test("restores a saved view with all four facets and resets it through ModelTable", () => {
    renderInventory();
    act(() => {
      getTable().onFacetStateRestored({
        facetSelections: {
          inventoryType: [EntityType.Host],
          inventorySource: [EntitySource.Discovered],
          inventoryStatus: ["stale", "recent"],
          inventoryLastSeen: ["2026-09-01T00:00:00.000Z"],
        },
        facetOperators: {
          inventoryType: "is_not",
          inventoryLastSeen: "before",
        },
      });
    });

    expectIncluded("entityType", [EntityType.Host], true);
    expectIncluded("source", [EntitySource.Discovered]);
    expectIncluded("inventoryStatus", ["stale", "recent"]);
    expect(getTable().query["lastSeenAt"]).toBeInstanceOf(LessThan);
    expect(
      screen.getByRole("button", { name: "Clear Last Seen filter" }),
    ).toBeVisible();

    act(() => {
      getTable().onFacetStateRestored(null);
    });

    expect(getTable().query).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  test("preserves a locked type scope while leaving Status available", () => {
    renderInventory({ query: { entityType: EntityType.Service } });

    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
    selectOption("Status", "Live");

    expect(getTable().query["entityType"]).toBe(EntityType.Service);
    expectIncluded("inventoryStatus", ["live"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(getTable().query["entityType"]).toBe(EntityType.Service);
  });

  test("preserves a locked status scope while leaving Type available", () => {
    renderInventory({
      query: { inventoryStatus: new Includes(["recent"]) },
    });

    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    selectOption("Type", "Host");

    expectIncluded("inventoryStatus", ["recent"]);
    expectIncluded("entityType", [EntityType.Host]);
  });

  test("provides the same facets on archived items using their own persistence key", () => {
    renderInventory({ archivedOnly: true });
    selectOption("Type", "Host");
    selectOption("Status", "Stale");

    expect(getTable().id).toBe(INVENTORY_ARCHIVED_TABLE_ID);
    expect(getTable().query["isArchived"]).toBe(true);
    expectIncluded("entityType", [EntityType.Host]);
    expectIncluded("inventoryStatus", ["stale"]);
    expect(TableFilterUrlState.write).toHaveBeenLastCalledWith(
      INVENTORY_ARCHIVED_TABLE_ID,
      "facets",
      getTable().currentFacetState,
    );
  });
});

describe("clearing nullable extra option facets", () => {
  const nullableFacets: Array<ResourceFacet> = [
    {
      key: "nullableSource",
      queryField: "source",
      label: "Nullable source",
      isMultiSelect: true,
      options: [{ value: EntitySource.Discovered, label: "Discovered" }],
      supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
      exclusiveWith: ["explicitSource"],
    },
    {
      key: "explicitSource",
      queryField: "source",
      label: "Specified source",
      isMultiSelect: true,
      options: [{ value: EntitySource.Discovered, label: "Discovered" }],
      supportedOperators: ["is", "is_not"],
    },
  ];

  let nullableHook: UseResourceOwnersResult<InventoryItem> | null = null;

  type NullableFacetHarnessFunction = () => ReactElement;

  const NullableFacetHarness: NullableFacetHarnessFunction =
    (): ReactElement => {
      const result: UseResourceOwnersResult<InventoryItem> =
        useResourceOwners<InventoryItem>({
          showOwnerFacet: false,
          showLabelsFacet: false,
          extraFacets: nullableFacets,
        });
      nullableHook = result;
      return result.filterBar;
    };

  type GetNullableHookFunction = () => UseResourceOwnersResult<InventoryItem>;

  const getNullableHook: GetNullableHookFunction =
    (): UseResourceOwnersResult<InventoryItem> => {
      expect(nullableHook).not.toBeNull();
      return nullableHook!;
    };

  beforeEach(() => {
    nullableHook = null;
  });

  test("clearing is empty removes its query and active state without needing a selected value", () => {
    render(<NullableFacetHarness />);
    setOperator("Nullable source", "is_empty");

    expect(getNullableHook().facetSelections["nullableSource"]).toEqual([]);
    expect(getNullableHook().mergeFiltersIntoQuery({}).source).toBeInstanceOf(
      IsNull,
    );
    expect(getNullableHook().hasActiveFilters).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Clear Nullable source filter" }),
    );

    expect(getNullableHook().mergeFiltersIntoQuery({})).toEqual({});
    expect(getNullableHook().hasActiveFilters).toBe(false);
    expect(getNullableHook().facetOperators["nullableSource"]).toBe("is");
    expect(
      screen.getByRole("button", { name: "Nullable source" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  test("clearing a restored empty facet preserves a currently active conflicting facet", () => {
    render(<NullableFacetHarness />);

    // A saved view may predate a conflict rule and restore both chips as active.
    act(() => {
      getNullableHook().restoreFacetState({
        facetSelections: { explicitSource: [EntitySource.Discovered] },
        facetOperators: { nullableSource: "is_empty" },
      });
    });

    expect(
      screen.getByRole("button", { name: "Clear Nullable source filter" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear Specified source filter" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear Nullable source filter" }),
    );

    expect(getNullableHook().mergeFiltersIntoQuery({}).source).toEqual(
      new Includes([EntitySource.Discovered]),
    );
    expect(getNullableHook().facetSelections["explicitSource"]).toEqual([
      EntitySource.Discovered,
    ]);
    expect(getNullableHook().facetOperators["nullableSource"]).toBe("is");
    expect(getNullableHook().hasActiveFilters).toBe(true);
    expect(
      screen.getByRole("button", { name: "Nullable source" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear Specified source filter" }),
    ).toBeVisible();
  });
});

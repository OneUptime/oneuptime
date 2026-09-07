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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { BrowserRouter, Link } from "react-router-dom";
import InventoryItems from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Items";
import { INVENTORY_ITEMS_TABLE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryFacets";
import {
  FacetSelectionState,
  parseFacetSelectionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";
import Route from "../../../Types/API/Route";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

interface InventoryTableProps {
  query?: Record<string, unknown> | undefined;
  cardTitle: string;
}

let capturedTable: InventoryTableProps | null = null;
let capturedFacetStates: Array<FacetSelectionState> = [];

// Exercise the real page and browser navigation without fetching table rows.
// Capture the same URL state the table's facet hook reads on its first render.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable",
  () => {
    return {
      __esModule: true,
      default: (props: InventoryTableProps): ReactElement => {
        capturedTable = props;
        capturedFacetStates.push(
          parseFacetSelectionState(
            TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "facets"),
          ),
        );

        return <h1 data-testid="inventory-table">{props.cardTitle}</h1>;
      },
    };
  },
);

const ITEMS_PATH: string = "/dashboard/project/inventory/items";

function renderPage(search: string): void {
  window.history.replaceState(null, "", `${ITEMS_PATH}${search}`);
  render(
    <BrowserRouter>
      <Link to={`${ITEMS_PATH}?type=k8s.pod`}>Pods</Link>
      <Link to={`${ITEMS_PATH}?source=manual`}>Added by You</Link>
      <Link to={ITEMS_PATH}>All Items</Link>
      <InventoryItems
        pageRoute={new Route(ITEMS_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </BrowserRouter>,
  );
}

function expectNoScopeBanner(): void {
  expect(
    screen.queryByTestId("inventory-scope-banner"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Filtered view")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Dismiss this to see everything/),
  ).not.toBeInTheDocument();
}

function readFacetSelections(): Record<string, Array<string>> {
  return parseFacetSelectionState(
    TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "facets"),
  ).facetSelections;
}

describe("Inventory Items without the scope banner", () => {
  beforeEach(() => {
    capturedTable = null;
    capturedFacetStates = [];
  });

  afterEach(() => {
    cleanup();
  });

  const SCOPES: Array<[string, string, Record<string, Array<string>>]> = [
    ["all items", "", {}],
    ["a type", "?type=k8s.pod", { inventoryType: [EntityType.KubernetesPod] }],
    ["a source", "?source=manual", { inventorySource: [EntitySource.Manual] }],
    [
      "Gone Quiet",
      "?source=discovered&stale=true",
      {
        inventorySource: [EntitySource.Discovered],
        inventoryStatus: ["stale"],
      },
    ],
    [
      "a combined type, source and stale scope",
      "?type=host&source=discovered&stale=true",
      {
        inventoryType: [EntityType.Host],
        inventorySource: [EntitySource.Discovered],
        inventoryStatus: ["stale"],
      },
    ],
  ];

  test.each(SCOPES)(
    "renders %s without a banner and restores its editable facets before table mount",
    async (
      _name: string,
      search: string,
      expectedSelections: Record<string, Array<string>>,
    ) => {
      renderPage(search);

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "All Items" }),
        ).toBeInTheDocument();
      });
      expect(capturedTable).not.toBeNull();
      expect(capturedTable?.query).toBeUndefined();
      expect(capturedFacetStates.length).toBeGreaterThan(0);
      for (const state of capturedFacetStates) {
        expect(state.facetSelections).toEqual(expectedSelections);
        for (const key of Object.keys(expectedSelections)) {
          expect(state.facetOperators[key]).toBe("is");
        }
      }
      expect(readFacetSelections()).toEqual(expectedSelections);
      const params: URLSearchParams = new URLSearchParams(
        window.location.search,
      );
      for (const name of ["type", "source", "stale"]) {
        expect(params.has(name)).toBe(false);
      }
      expectNoScopeBanner();
    },
  );

  test("updates and clears the scope when only the query string changes", async () => {
    renderPage("?source=discovered&stale=true");
    const goneQuietTable: HTMLElement =
      await screen.findByTestId("inventory-table");

    fireEvent.click(screen.getByRole("link", { name: "Pods" }));

    await waitFor(() => {
      expect(readFacetSelections()).toEqual({
        inventoryType: [EntityType.KubernetesPod],
      });
    });
    expect(capturedTable?.query).toBeUndefined();
    const podsTable: HTMLElement = screen.getByTestId("inventory-table");
    expect(podsTable).not.toBe(goneQuietTable);
    expectNoScopeBanner();

    fireEvent.click(screen.getByRole("link", { name: "Added by You" }));

    await waitFor(() => {
      expect(readFacetSelections()).toEqual({
        inventorySource: [EntitySource.Manual],
      });
    });
    expect(capturedTable?.query).toBeUndefined();
    const manualTable: HTMLElement = screen.getByTestId("inventory-table");
    expect(manualTable).not.toBe(podsTable);
    expectNoScopeBanner();

    fireEvent.click(screen.getByRole("link", { name: "All Items" }));

    await waitFor(() => {
      expect(readFacetSelections()).toEqual({});
    });
    expect(capturedTable?.query).toBeUndefined();
    expect(screen.getByTestId("inventory-table")).not.toBe(manualTable);
    expect(window.location.search).toBe("");
    expectNoScopeBanner();
  });
});

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import InventoryItems from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Items";
import { InventoryScopeQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryScope";
import Route from "../../../Types/API/Route";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";

interface InventoryTableProps {
  query?: InventoryScopeQuery | undefined;
  cardTitle: string;
}

let capturedTable: InventoryTableProps | null = null;

// Exercise the real page, router and query builder without fetching table rows.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable",
  () => {
    return {
      __esModule: true,
      default: (props: InventoryTableProps): ReactElement => {
        capturedTable = props;

        return <h1 data-testid="inventory-table">{props.cardTitle}</h1>;
      },
    };
  },
);

const ITEMS_PATH: string = "/dashboard/project/inventory/items";
const NOW: Date = new Date("2026-09-07T12:00:00.000Z");
const STALE_CUTOFF: Date = new Date("2026-09-06T12:00:00.000Z");

function renderPage(search: string): void {
  render(
    <MemoryRouter initialEntries={[`${ITEMS_PATH}${search}`]}>
      <Link to={`${ITEMS_PATH}?type=k8s.pod`}>Pods</Link>
      <Link to={`${ITEMS_PATH}?source=manual`}>Added by You</Link>
      <Link to={ITEMS_PATH}>All Items</Link>
      <InventoryItems
        pageRoute={new Route(ITEMS_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
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

describe("Inventory Items without the scope banner", () => {
  beforeEach(() => {
    capturedTable = null;
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  const SCOPES: Array<[string, string, InventoryScopeQuery | undefined]> = [
    ["all items", "", undefined],
    ["a type", "?type=k8s.pod", { entityType: EntityType.KubernetesPod }],
    ["a source", "?source=manual", { source: EntitySource.Manual }],
    [
      "Gone Quiet",
      "?source=discovered&stale=true",
      {
        source: EntitySource.Discovered,
        lastSeenAt: new LessThan<Date>(STALE_CUTOFF),
      },
    ],
    [
      "a combined type, source and stale scope",
      "?type=host&source=discovered&stale=true",
      {
        entityType: EntityType.Host,
        source: EntitySource.Discovered,
        lastSeenAt: new LessThan<Date>(STALE_CUTOFF),
      },
    ],
  ];

  test.each(SCOPES)(
    "renders %s without a banner and preserves its table query",
    (
      _name: string,
      search: string,
      expectedQuery: InventoryScopeQuery | undefined,
    ) => {
      renderPage(search);

      expect(
        screen.getByRole("heading", { name: "All Items" }),
      ).toBeInTheDocument();
      expect(capturedTable).not.toBeNull();
      expect(capturedTable?.query).toEqual(expectedQuery);
      expectNoScopeBanner();
    },
  );

  test("updates and clears the scope when only the query string changes", () => {
    renderPage("?source=discovered&stale=true");
    const goneQuietTable: HTMLElement = screen.getByTestId("inventory-table");

    fireEvent.click(screen.getByRole("link", { name: "Pods" }));

    expect(capturedTable?.query).toEqual({
      entityType: EntityType.KubernetesPod,
    });
    const podsTable: HTMLElement = screen.getByTestId("inventory-table");
    expect(podsTable).not.toBe(goneQuietTable);
    expectNoScopeBanner();

    fireEvent.click(screen.getByRole("link", { name: "Added by You" }));

    expect(capturedTable?.query).toEqual({ source: EntitySource.Manual });
    const manualTable: HTMLElement = screen.getByTestId("inventory-table");
    expect(manualTable).not.toBe(podsTable);
    expectNoScopeBanner();

    fireEvent.click(screen.getByRole("link", { name: "All Items" }));

    expect(capturedTable?.query).toBeUndefined();
    expect(screen.getByTestId("inventory-table")).not.toBe(manualTable);
    expectNoScopeBanner();
  });
});

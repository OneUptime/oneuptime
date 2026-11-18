import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * TABLES SAYS WHICH ARE LATE, ON THE SERVER, AND THE LATE TABLES COUNTS OPEN
 * IT (#6550).
 *
 * Tables, and a database's own Tables tab, offer a Freshness chip - Late or
 * Fresh, asked of when each table goes late (DataAsset.lateAt) on the
 * server - in the list's own URL namespace, where the Late Tables counts set
 * it. The dropped tables, collected no more, are neither. The Freshness
 * column sorts by the same time. Only the props the list hands its table and
 * its chips are under test, so both are captured instead of drawn.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];
const mockCapturedOwnerOptions: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    return {
      __esModule: true,
      default: (options: Record<string, unknown>): Record<string, unknown> => {
        mockCapturedOwnerOptions.push(options);
        return {
          onResourcesFetched: (): void => {
            return undefined;
          },
          getOwnersForResource: (): Array<unknown> => {
            return [];
          },
          isLoadingOwners: false,
          filterBar: null,
          emptyState: undefined,
          mergeFiltersIntoQuery: (query: unknown): unknown => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: (): void => {
            return undefined;
          },
        };
      },
    };
  },
);

const mockStoreView: { current: Record<string, unknown> } = { current: {} };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/StoreViewContext",
  () => {
    return {
      __esModule: true,
      useStoreView: (): Record<string, unknown> => {
        return mockStoreView.current;
      },
    };
  },
);

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

import Route from "../../../Types/API/Route";
import {
  DataObservabilityCollector,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import DataAssetTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAssetTable";
import {
  FRESHNESS_FACET_KEY,
  STORE_TABLES_LIST_ID,
  TABLES_LIST_ID,
  getLateTablesRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityListRoutes";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import StoreOverviewPage, {
  STORE_LATE_TABLES_TILE_LINK_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const STORE: string = "10000000-0000-4000-8000-000000000001";

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
}

function latestTableProps(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function latestOwnerOptions(): Record<string, unknown> {
  expect(mockCapturedOwnerOptions.length).toBeGreaterThan(0);
  return mockCapturedOwnerOptions[mockCapturedOwnerOptions.length - 1]!;
}

function facets(): Array<ResourceFacet> {
  return (latestOwnerOptions()["extraFacets"] || []) as Array<ResourceFacet>;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-observability/tables`);
  mockCapturedTableProps.length = 0;
  mockCapturedOwnerOptions.length = 0;
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Tables", () => {
  test("offers Freshness, asked of when each table goes late, in the namespace the Late Tables count writes", async () => {
    await act(async () => {
      render(<DataAssetTable isDropped={false} />);
    });

    expect(latestOwnerOptions()["persistKey"]).toBe(TABLES_LIST_ID);
    expect(latestTableProps()["id"]).toBe(TABLES_LIST_ID);
    expect(latestTableProps()["userPreferencesKey"]).toBe(TABLES_LIST_ID);

    const freshness: ResourceFacet | undefined = facets().find(
      (facet: ResourceFacet): boolean => {
        return facet.key === FRESHNESS_FACET_KEY;
      },
    );

    expect(freshness?.queryField).toBe("lateAt");
    expect(freshness?.label).toBe("Freshness");
  });

  test("its Freshness column sorts by the same time: the most overdue first", async () => {
    await act(async () => {
      render(<DataAssetTable isDropped={false} />);
    });

    const column: CapturedColumn | undefined = (
      latestTableProps()["columns"] as Array<CapturedColumn>
    ).find((each: CapturedColumn): boolean => {
      return each.title === "Freshness";
    });

    expect(column?.field).toEqual({ lateAt: true });
  });

  test("a database's own Tables tab: the same chip, in that list's own namespace", async () => {
    await act(async () => {
      render(
        <DataAssetTable isDropped={false} dataStoreId={new ObjectID(STORE)} />,
      );
    });

    expect(latestOwnerOptions()["persistKey"]).toBe(STORE_TABLES_LIST_ID);
    expect(latestTableProps()["userPreferencesKey"]).toBe(STORE_TABLES_LIST_ID);
    expect(
      facets().some((facet: ResourceFacet): boolean => {
        return facet.key === FRESHNESS_FACET_KEY;
      }),
    ).toBe(true);
    expect(latestTableProps()["query"]).toMatchObject({
      isDropped: false,
    });
  });

  test("the dropped tables, collected no more, are neither late nor fresh: no chip", async () => {
    await act(async () => {
      render(<DataAssetTable isDropped={true} />);
    });

    expect(facets()).toEqual([]);
  });
});

describe("a database's Late Tables", () => {
  function storeSummary(lateAssetCount: number): DataObservabilityStoreSummary {
    return {
      dataStoreId: STORE,
      name: "orders-db",
      kind: "PostgreSQL",
      isTableHealthEnabled: true,
      collector: DataObservabilityCollector.OneUptime,
      probeName: null,
      status: "Collected",
      message: null,
      collectedAt: new Date().toISOString(),
      assetCount: 12,
      lateAssetCount,
      alertMonitorCount: 1,
    };
  }

  async function openStore(lateAssetCount: number): Promise<void> {
    mockStoreView.current = {
      dataStoreId: new ObjectID(STORE),
      store: storeSummary(lateAssetCount),
      refresh: (): void => {
        return undefined;
      },
    };

    await act(async () => {
      render(
        <MemoryRouter>
          <StoreOverviewPage
            {...({
              pageRoute: new Route("/"),
              currentProject: null,
              hasPaymentMethod: false,
            } as unknown as PageComponentProps)}
          />
        </MemoryRouter>,
      );
    });
  }

  test("open its own Tables tab, showing the late ones", async () => {
    await openStore(3);

    const link: HTMLElement = screen.getByTestId(
      STORE_LATE_TABLES_TILE_LINK_TEST_ID,
    );

    expect(link).toHaveTextContent("3");
    expect(link.getAttribute("href")).toBe(
      getLateTablesRoute(STORE).toString(),
    );
  });

  test("none late: a count, not a link", async () => {
    await openStore(0);

    expect(screen.queryByTestId(STORE_LATE_TABLES_TILE_LINK_TEST_ID)).toBeNull();
  });
});

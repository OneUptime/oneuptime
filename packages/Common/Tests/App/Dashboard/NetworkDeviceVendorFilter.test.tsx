import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
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

/*
 * OneUptime issue #9363, on the three lists that filter network devices by
 * Vendor: Network -> Devices, its Archived list, and a site's Devices tab.
 *
 * The Devices list's Vendor / Model column names a device's maker by its
 * asset facts - for a device imported from Discovered Devices, the maker the
 * list knew it by - and its Vendor filter searched the `vendor` column, which
 * such a device leaves empty: "Sunnovo International" in the column, no row
 * for a Vendor filter of "Sunnovo". The column's sort read `vendor` too, and
 * put the device where a device with no maker goes; a site's Devices tab
 * showed the bare `vendor` column, empty for it.
 *
 * Now each of them reads the maker the server keeps on every device
 * (manufacturer, worked out by the function the cell draws): the filter
 * matches it, the column sorts by it, and the site's tab shows it. What the
 * cell draws is unchanged.
 *
 * ModelTable is replaced by a prop recorder: the point is what each page
 * hands it, not re-testing the table.
 */

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

type CapturedFilter = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  type?: string | undefined;
};

type CapturedColumn = {
  id?: string | undefined;
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  type?: string | undefined;
  disableSort?: boolean | undefined;
  selectedProperty?: string | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
  getExportValue?: ((item: unknown) => string) | undefined;
};

type CapturedTableProps = {
  filters?: Array<CapturedFilter> | undefined;
  columns?: Array<CapturedColumn> | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  renamedFilterKeys?: Record<string, string> | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          filterBar: null,
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          hasActiveFilters: false,
          facetSelections: {},
          facetOperators: {},
          setFacetSelection: () => {
            // no-op
          },
          clearAllFacets: () => {
            // no-op
          },
          facetSaveState: {},
          restoreFacetState: () => {
            // no-op
          },
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async () => {
        return [];
      },
    },
  };
});

import NetworkDevicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import NetworkDeviceArchivedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Archived";
import NetworkSiteDevices from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/Devices";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { buildDiscoveredListEntries } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS,
  getStoredNetworkDeviceManufacturer,
} from "../../../Utils/NetworkDevice/NetworkDeviceStoredManufacturer";
import { getColumnSortKey } from "../../../UI/Components/ModelTable/ColumnSort";
import { getColumnBaseId } from "../../../UI/Components/ModelTable/ColumnPreference";
import buildQueryFromFilterData, {
  renameFilterDataKeys,
  sanitizeFilterData,
} from "../../../UI/Components/ModelTable/FilterDataToQuery";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/network-devices"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function renderPage(
  page: (props: PageComponentProps) => ReactElement,
): Promise<CapturedTableProps> {
  const Page: (props: PageComponentProps) => ReactElement = page;

  render(
    <MemoryRouter>
      <Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return capturedTableProps!;
}

function vendorFilterOf(props: CapturedTableProps): CapturedFilter {
  const vendorFilters: Array<CapturedFilter> = (props.filters || []).filter(
    (filter: CapturedFilter): boolean => {
      return filter.title === "Vendor";
    },
  );

  expect(vendorFilters).toHaveLength(1);
  return vendorFilters[0]!;
}

// No filter of the list reads the bare vendor column any more.
function expectNoFilterOnTheVendorColumn(props: CapturedTableProps): void {
  for (const filter of props.filters || []) {
    expect(Object.keys(filter.field || {})).not.toContain("vendor");
  }
}

/*
 * A link or a bookmark made when the Vendor filter read `vendor` - the
 * table's filter state on the URL - still filters by Vendor: the table
 * reads it under the new key, as it restores the URL.
 */
function expectOldVendorLinksToStillFilter(props: CapturedTableProps): void {
  const old: StartsWith<string> = new StartsWith("Sun");

  expect(props.renamedFilterKeys).toEqual({ vendor: "manufacturer" });
  expect(
    sanitizeFilterData({
      filterData: renameFilterDataKeys({
        filterData: { vendor: old } as never,
        renamedKeys: props.renamedFilterKeys,
      }),
      filters: props.filters as never,
    }),
  ).toEqual({ manufacturer: old });
}

function columnTitled(
  props: CapturedTableProps,
  title: string,
): CapturedColumn {
  const column: CapturedColumn | undefined = (props.columns || []).find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();
  return column!;
}

function listVendor(vendor: string): JSONObject {
  return buildDiscoveredListEntries({
    reading: {
      endpointId: "40000000-0000-4000-8000-000000000001",
      name: "PROFUSION-733451",
      vendor: vendor,
    },
    readAt: new Date("2026-11-17T08:00:00.000Z"),
  }) as unknown as JSONObject;
}

// A row as the list's request reads it.
function rowWith(fields: Record<string, unknown>): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();

  for (const [key, value] of Object.entries(fields)) {
    (device as unknown as Record<string, unknown>)[key] = value;
  }

  return device;
}

function textOf(element: ReactElement): string {
  const { container, unmount } = render(<MemoryRouter>{element}</MemoryRouter>);
  const text: string = container.textContent || "";
  unmount();
  return text;
}

describe("the lists that filter network devices by Vendor", () => {
  beforeEach(() => {
    capturedTableProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("the Devices list", () => {
    test("its Vendor filter matches the maker the server keeps, not the bare vendor column", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      const filter: CapturedFilter = vendorFilterOf(props);
      expect(filter.field).toEqual({ manufacturer: true });
      expect(filter.type).toBe(FieldType.Text);
      expectNoFilterOnTheVendorColumn(props);
    });

    test("what the chip sends is a filter of the maker the column shows", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      // What typing "Sunnovo" into the Vendor chip writes, under its own key.
      const chipKey: string = Object.keys(
        vendorFilterOf(props).field || {},
      )[0]!;
      const query: Query<NetworkDevice> = buildQueryFromFilterData({
        filterData: sanitizeFilterData({
          filterData: { [chipKey]: new Search("Sunnovo") } as never,
          filters: props.filters as never,
        }),
        filters: props.filters as never,
      }) as Query<NetworkDevice>;

      expect(Object.keys(query)).toEqual(["manufacturer"]);
      expect((query as Record<string, unknown>)["manufacturer"]).toBeInstanceOf(
        Search,
      );
    });

    test("a link made when its Vendor filter read the bare column still filters by Vendor", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expectOldVendorLinksToStillFilter(props);
    });

    test("its Vendor / Model column sorts by that maker", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      const column: CapturedColumn = columnTitled(props, "Vendor / Model");

      expect(column.field).toEqual({ manufacturer: true });
      expect(column.disableSort).not.toBe(true);
      expect(getColumnSortKey(column as never)).toBe("manufacturer");
      // Hidden or moved with Customize Columns before, it stays so.
      expect(getColumnBaseId(column as never)).toBe("vendor");
    });

    test("its cell still draws the device's asset facts: a maker from discovery only, and a saved one over it", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      const column: CapturedColumn = columnTitled(props, "Vendor / Model");

      const fromTheList: NetworkDevice = rowWith({
        name: "PROFUSION-733451",
        hostname: "10.34.15.10",
        discoveredDetails: listVendor("Sunnovo International"),
      });
      const saved: NetworkDevice = rowWith({
        name: "label-printer-03",
        vendor: "Zebra",
        discoveredDetails: listVendor("Sunnovo International"),
      });

      expect(textOf(column.getElement!(fromTheList))).toContain(
        "Sunnovo International",
      );
      expect(column.getExportValue!(fromTheList)).toBe("Sunnovo International");
      expect(textOf(column.getElement!(saved))).toContain("Zebra");
      expect(textOf(column.getElement!(saved))).not.toContain("Sunnovo");
      expect(column.getExportValue!(saved)).toBe("Zebra");

      // What it draws is what the server keeps, so the filter finds the row.
      for (const row of [fromTheList, saved]) {
        expect(column.getExportValue!(row) || null).toBe(
          getStoredNetworkDeviceManufacturer(row),
        );
      }
    });

    test("reads every column the maker is worked out from, though the column is keyed by the kept one", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      for (const column of NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS) {
        expect([column, props.selectMoreFields?.[column]]).toEqual([
          column,
          true,
        ]);
      }
    });
  });

  test("the Archived list's Vendor filter matches the same maker", async () => {
    const props: CapturedTableProps = await renderPage(
      NetworkDeviceArchivedPage as unknown as (
        props: PageComponentProps,
      ) => ReactElement,
    );

    expect(vendorFilterOf(props).field).toEqual({ manufacturer: true });
    expectNoFilterOnTheVendorColumn(props);
    expectOldVendorLinksToStillFilter(props);
  });

  test("a site's Devices tab shows, filters and sorts by the same maker", async () => {
    // The site the tab is of, as its route names it.
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID("55555555-5555-4555-8555-555555555555"));

    const props: CapturedTableProps = await renderPage(
      NetworkSiteDevices as unknown as (
        props: PageComponentProps,
      ) => ReactElement,
    );

    expect(vendorFilterOf(props).field).toEqual({ manufacturer: true });
    expectNoFilterOnTheVendorColumn(props);
    expectOldVendorLinksToStillFilter(props);

    const column: CapturedColumn = columnTitled(props, "Vendor");
    expect(column.field).toEqual({ manufacturer: true });
    expect(column.type).toBe(FieldType.Text);
    expect(getColumnSortKey(column as never)).toBe("manufacturer");
    expect(getColumnBaseId(column as never)).toBe("vendor");
  });
});

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
 * Where the customer looks: Network -> Devices -> Bulk Actions. The three
 * actions they asked for have to be on that menu, in the place onboarding a
 * discovered estate reaches for them first - where a device is (its site),
 * what it is (its role), what it collects (its vendor template) - and the
 * rows have to carry what the actions read off them, whichever columns the
 * viewer has hidden.
 *
 * ModelTable is a prop recorder here; what is pinned is what the page hands
 * it. The new actions' own behaviour is in UseBulkSiteAndRoleActions and
 * UseBulkApplyVendorTemplate.
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

type CapturedTableProps = {
  bulkActions?:
    | { buttons?: Array<{ title?: string | undefined }> | undefined }
    | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CLEAR_SITE_ACTION_TITLE,
  SET_SITE_ACTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSiteActions";
import {
  CLEAR_DEVICE_ROLE_ACTION_TITLE,
  SET_DEVICE_ROLE_ACTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkDeviceRoleActions";
import { APPLY_VENDOR_TEMPLATE_ACTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkApplyVendorTemplate";
import { SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSnmpCredentialProfileActions";
import { SHORTEN_DEVICE_NAMES_ACTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkShortenDeviceNames";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/network-devices"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function renderDevicesPage(): Promise<CapturedTableProps> {
  const Page: (props: PageComponentProps) => ReactElement =
    NetworkDevicesPage as unknown as (
      props: PageComponentProps,
    ) => ReactElement;

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

function titles(props: CapturedTableProps): Array<string> {
  return (props.bulkActions?.buttons || []).map(
    (button: { title?: string | undefined }): string => {
      return button.title || "";
    },
  );
}

describe("Network -> Devices bulk actions: site, role and vendor template", () => {
  beforeEach(() => {
    capturedTableProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("the menu offers Set/Clear Site, Set/Clear Device Role and Apply Vendor Template", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(titles(props)).toEqual(
      expect.arrayContaining([
        SET_SITE_ACTION_TITLE,
        CLEAR_SITE_ACTION_TITLE,
        SET_DEVICE_ROLE_ACTION_TITLE,
        CLEAR_DEVICE_ROLE_ACTION_TITLE,
        APPLY_VENDOR_TEMPLATE_ACTION_TITLE,
      ]),
    );
  });

  test("site and role lead the menu, in that order, ahead of labels", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(titles(props).slice(0, 4)).toEqual([
      SET_SITE_ACTION_TITLE,
      CLEAR_SITE_ACTION_TITLE,
      SET_DEVICE_ROLE_ACTION_TITLE,
      CLEAR_DEVICE_ROLE_ACTION_TITLE,
    ]);
    expect(titles(props).indexOf(CLEAR_DEVICE_ROLE_ACTION_TITLE)).toBeLessThan(
      titles(props).indexOf("Add Labels"),
    );
  });

  test("the vendor template sits with the other collection actions, ahead of the OID Collection Template", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const all: Array<string> = titles(props);

    expect(all.indexOf(APPLY_VENDOR_TEMPLATE_ACTION_TITLE)).toBeGreaterThan(
      all.indexOf("Remove Labels"),
    );
    expect(all.indexOf(APPLY_VENDOR_TEMPLATE_ACTION_TITLE)).toBeLessThan(
      all.indexOf("Set OID Collection Template"),
    );
    expect(all.indexOf("Set OID Collection Template")).toBeLessThan(
      all.indexOf(SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE),
    );
  });

  test("the existing actions are all still there, with Archive still last of them", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const all: Array<string> = titles(props);

    for (const title of [
      "Add Labels",
      "Remove Labels",
      "Set OID Collection Template",
      "Clear OID Collection Template",
      SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
      SHORTEN_DEVICE_NAMES_ACTION_TITLE,
      "Archive",
    ]) {
      expect(all).toContain(title);
    }

    expect(all[all.length - 1]).toBe("Archive");
  });

  test("every action appears once", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const all: Array<string> = titles(props);

    expect(new Set(all).size).toBe(all.length);
  });

  /*
   * The Site, Role and Template columns can be hidden - two of them are by
   * default - and a hidden column is not selected. These fields are what
   * "Clear Site" / "Clear Device Role" decide their visibility and their
   * count from, and what the vendor template dialog previews each device's
   * template from.
   */
  test("the rows carry what the new actions read, whatever columns are shown", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(props.selectMoreFields).toEqual(
      expect.objectContaining({
        siteId: true,
        networkDeviceRoleId: true,
        oidTemplateId: true,
        sysObjectId: true,
        sysDescr: true,
        monitoringMethod: true,
      }),
    );
  });
});

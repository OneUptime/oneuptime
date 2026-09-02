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
 * Issue #3559, on the two screens it was reported against.
 *
 * Network -> Devices offered Add/Remove Labels, Set/Clear OID Template,
 * Archive and Export CSV over a selection of 916 devices, and no way to
 * delete any of them. Deleting a batch of stale, duplicated or test devices
 * out of a fleet of 7,489 meant deleting them one at a time.
 *
 * The action itself is ModelTable's - it adds a default bulk "Delete" to any
 * table that already offers bulk actions, for anyone the model lets delete
 * (asserted end to end in BaseModelTableBulkDelete.test.tsx). Two things about
 * these pages have to hold for that to reach the user, and neither is visible
 * from the component:
 *
 *   1. the page keeps handing ModelTable a non-empty `bulkActions` - the
 *      default Delete is not injected into a table that offers none, because
 *      the row checkboxes only exist for tables that do;
 *   2. the page fills in what the generic confirmation cannot know. Deleting
 *      a device takes its interfaces, links, endpoints and auto-created
 *      monitor with it, and Archive is the reversible alternative. "This
 *      action cannot be undone" on its own does not say that, and at 900 rows
 *      the difference is not recoverable.
 *
 * ModelTable is replaced by a prop recorder here: the point is what these two
 * pages hand it, not re-testing the table.
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

type CapturedBulkActions = {
  buttons?: Array<{ title?: string | undefined }> | undefined;
  deleteConfirmationWarning?: string | undefined;
};

type CapturedTableProps = {
  bulkActions?: CapturedBulkActions | undefined;
  isDeleteable?: boolean | undefined;
  cardProps?: { description?: string | undefined } | undefined;
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

/*
 * The facet bar fetches sites, labels and probes on mount and owns the query
 * the table is given. None of that is what these tests are about.
 */
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

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        bulkActions: [{ title: "Add Labels" }, { title: "Remove Labels" }],
        modals: null,
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkOidTemplateActions",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          bulkActions: [
            { title: "Set OID Collection Template" },
            { title: "Clear OID Collection Template" },
          ],
          modals: null,
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/network-devices"),
  currentProject: null,
  hasPaymentMethod: true,
};

type RenderPageFunction = (
  page: (props: PageComponentProps) => ReactElement,
) => Promise<CapturedTableProps>;

const renderPage: RenderPageFunction = async (
  page: (props: PageComponentProps) => ReactElement,
): Promise<CapturedTableProps> => {
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
};

type ButtonTitlesFunction = (props: CapturedTableProps) => Array<string>;

const buttonTitles: ButtonTitlesFunction = (
  props: CapturedTableProps,
): Array<string> => {
  return (props.bulkActions?.buttons || []).map(
    (button: { title?: string | undefined }): string => {
      return button.title || "";
    },
  );
};

describe("Network Devices bulk delete wiring", () => {
  beforeEach(() => {
    capturedTableProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("the Devices list", () => {
    test("still offers bulk actions, so the default Delete is added to them", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(buttonTitles(props)).toEqual(
        expect.arrayContaining([
          "Add Labels",
          "Remove Labels",
          "Set OID Collection Template",
          "Archive",
        ]),
      );
      expect(props.bulkActions?.buttons?.length).toBeGreaterThan(0);
    });

    /*
     * The page deliberately has no per-row Delete. Bulk deletion does not hang
     * off that flag, and this is here so that stays a deliberate pairing
     * rather than looking like an oversight in either direction.
     */
    test("has no per-row Delete button", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(props.isDeleteable).toBe(false);
    });

    test("warns what leaves with the devices, and points at Archive", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      const warning: string =
        props.bulkActions?.deleteConfirmationWarning || "";

      expect(warning).toContain("interfaces");
      expect(warning).toContain("links");
      expect(warning).toContain("monitor");
      expect(warning.toLowerCase()).toContain("archive");
    });
  });

  describe("the Archived devices list", () => {
    test("still offers bulk actions, so the default Delete is added to them", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDeviceArchivedPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(buttonTitles(props)).toEqual(
        expect.arrayContaining(["Unarchive"]),
      );
    });

    /*
     * Archiving then deleting is the clean-up path the issue describes, so
     * the warning here points back at Unarchive rather than at Archive.
     */
    test("warns what leaves with the devices, and points at Unarchive", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDeviceArchivedPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      const warning: string =
        props.bulkActions?.deleteConfirmationWarning || "";

      expect(warning).toContain("interfaces");
      expect(warning).toContain("monitor");
      expect(warning.toLowerCase()).toContain("unarchive");
    });

    test("tells the reader the list is where devices get deleted for good", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDeviceArchivedPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(props.cardProps?.description || "").toContain("delete");
    });
  });
});

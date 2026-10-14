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
 * The action itself is ModelTable's - it adds a default bulk "Delete" to a
 * table whose rows are deleted from it (`isDeleteable`, which also puts
 * Delete in each row's ⋯ menu) and that offers bulk actions, for anyone the
 * model lets delete (asserted end to end in BaseModelTableBulkDelete.test.tsx).
 * Three things about these pages have to hold for that to reach the user, and
 * none is visible from the component:
 *
 *   1. the page keeps handing ModelTable a non-empty `bulkActions` - the
 *      row checkboxes only exist for tables that offer bulk actions;
 *   2. the page's rows are deleted from it (`isDeleteable`);
 *   3. the confirmation says what the generic sentence cannot. Deleting a
 *      device takes its interfaces, links, endpoints and auto-created monitor
 *      with it - DeleteConsequences' sentence, said by every Delete of a
 *      device - and on the live list Archive is the reversible alternative.
 *      At 900 rows the difference is not recoverable.
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
  deleteConfirmationWarning?: string | undefined;
  cardProps?: { description?: string | undefined } | undefined;
  searchableFields?: Array<string> | undefined;
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
import { SHORTEN_DEVICE_NAMES_ACTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkShortenDeviceNames";
import Route from "../../../Types/API/Route";
import { getDeleteConsequence } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";

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
          SHORTEN_DEVICE_NAMES_ACTION_TITLE,
          "Archive",
        ]),
      );
      expect(props.bulkActions?.buttons?.length).toBeGreaterThan(0);
    });

    /*
     * Issue #3678: the fleet imported under full DNS names before the scan
     * setting existed is fixed from this list. It is a rename, not a removal,
     * so it sits with the other non-destructive actions ahead of Archive.
     */
    test("offers Shorten Names to Hostname ahead of Archive", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      const titles: Array<string> = buttonTitles(props);

      expect(titles.indexOf(SHORTEN_DEVICE_NAMES_ACTION_TITLE)).toBeGreaterThan(
        -1,
      );
      expect(titles.indexOf(SHORTEN_DEVICE_NAMES_ACTION_TITLE)).toBeLessThan(
        titles.indexOf("Archive"),
      );
    });

    /*
     * Delete in each row's ⋯ menu as well: one switch for the row's Delete
     * and the bulk one, so the two always go together.
     */
    test("deletes from each row's menu too", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(props.isDeleteable).toBe(true);
    });

    /*
     * A device renamed to its short hostname - by the scan setting or by the
     * bulk action - still has to be findable by the full name people know it
     * by, which is now its DNS name.
     */
    test("searches the DNS name as well as the name", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(props.searchableFields).toEqual(
        expect.arrayContaining(["name", "description", "dnsName"]),
      );
    });

    /*
     * The bulk rename plans its confirmation from the rows and compares each
     * row's name against a fresh read. A column the viewer has hidden is not
     * selected, so these cannot be left to the Name and Hostname columns.
     */
    test("selects every field the Shorten Names action reads off a row", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(props.selectMoreFields).toEqual(
        expect.objectContaining({
          name: true,
          hostname: true,
          sysName: true,
          dnsName: true,
        }),
      );
    });

    test("warns what leaves with the devices, and points at Archive", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDevicesPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      // What leaves with a device: the model's own sentence, said by every Delete.
      const consequence: string = getDeleteConsequence("NetworkDevice");

      expect(consequence).toContain("interfaces");
      expect(consequence).toContain("links");
      expect(consequence).toContain("monitor");

      // Archive, the reversible alternative, in the row's and the bulk dialog.
      expect(props.deleteConfirmationWarning).toBe(ARCHIVE_INSTEAD_OF_DELETE);
      expect(props.bulkActions?.deleteConfirmationWarning).toBeUndefined();
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
     * Archiving then deleting is the clean-up path the issue describes: here
     * the devices are off the main list already, so the dialog says what
     * goes with them (DeleteConsequences) and offers no way round it - as
     * every Archived page's Delete does.
     */
    test("deletes from each row's menu too, saying only what leaves with the devices", async () => {
      const props: CapturedTableProps = await renderPage(
        NetworkDeviceArchivedPage as unknown as (
          props: PageComponentProps,
        ) => ReactElement,
      );

      expect(props.isDeleteable).toBe(true);
      expect(props.deleteConfirmationWarning).toBeUndefined();
      expect(props.bulkActions?.deleteConfirmationWarning).toBeUndefined();
      expect(getDeleteConsequence("NetworkDevice")).toContain("interfaces");
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

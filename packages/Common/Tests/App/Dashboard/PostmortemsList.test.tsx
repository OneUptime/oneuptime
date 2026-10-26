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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Incidents > Postmortems, the list the customer asked for: "is there any
 * way I can view and filter postmortem reports across all incidents - by
 * team/owner, severity, postmortem status (not started, draft and a few
 * custom statuses)?"
 *
 * The page is rendered for real - its tiles, each row's status pill, the
 * Change Postmortem Status bulk action - with only the network stubbed and
 * two heavy pieces replaced by recorders:
 *
 *   - ModelTable records the props the page hands it and draws each column
 *     of a few incidents with the page's own getElement, so a row's cells
 *     are the page's;
 *   - useResourceOwners keeps the chips' selections in state and merges them
 *     into the query with the real per-chip builder (FacetColumnQuery), so a
 *     tile's click reaches the table's query as it does in the product.
 *
 * The dialog of the bulk action (BasicFormModal) is a recorder too: its
 * contract is the field it declares and onSubmit.
 */

const mockGetList: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();
const mockTableProps: Array<Record<string, unknown>> = [];
const mockResourceOwnersOptions: Array<Record<string, unknown>> = [];
const mockModalProps: Array<Record<string, unknown>> = [];
const mockRows: Array<unknown> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): {
        permissions: Array<Record<string, unknown>>;
      } => {
        return {
          permissions: permissionsForTest.map(
            (permission: string): Record<string, unknown> => {
              return {
                permission,
                labelIds: [],
                _type: "UserPermission",
              };
            },
          ),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: permissionsForTest };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

// The table: its props recorded, each row drawn with the page's own cells.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockTableProps.push(props);

      const columns: Array<{
        title: string;
        getElement?: (item: unknown) => ReactElement;
      }> = props["columns"] as Array<{
        title: string;
        getElement?: (item: unknown) => ReactElement;
      }>;

      return (
        <div
          data-testid="model-table"
          data-refresh={String(props["refreshToggle"])}
        >
          {mockRows.map((row: unknown) => {
            const id: string = String((row as { _id: string })._id);

            return (
              <div key={id} data-testid={`row-${id}`}>
                {columns.map(
                  (column: {
                    title: string;
                    getElement?: (item: unknown) => ReactElement;
                  }) => {
                    return (
                      <div key={column.title} data-column={column.title}>
                        {column.getElement ? column.getElement(row) : null}
                      </div>
                    );
                  },
                )}
              </div>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockModalProps.push(props);
      return <div data-testid="bulk-status-dialog" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return (
          <a href={props.to?.toString()} className={props.className}>
            {props.children}
          </a>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="owners-cell" />;
      },
    };
  },
);

/*
 * The facet bar: the chips' selections kept in state, merged into the query
 * by the real builder over the chips the page hands in.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    const ReactActual: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    interface FacetColumnQueryModule {
      buildFacetColumnQuery: (data: {
        facet: { key: string; queryField?: string };
        operator: string;
        values: Array<string>;
        existingValue: unknown;
      }) => { field: string; value: unknown } | null;
    }

    const facetColumnQuery: FacetColumnQueryModule = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery",
    ) as FacetColumnQueryModule;

    return {
      ...actual,
      __esModule: true,
      default: (options: Record<string, unknown>) => {
        mockResourceOwnersOptions.push(options);

        const [selections, setSelections] = ReactActual.useState<
          Record<string, Array<string>>
        >({});
        const [operators, setOperators] = ReactActual.useState<
          Record<string, string>
        >({});

        const facets: Array<{ key: string; queryField?: string }> =
          (options["extraFacets"] as Array<{
            key: string;
            queryField?: string;
          }>) || [];

        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
          filterBar: <div data-testid="filter-bar" />,
          emptyState: {},
          mergeFiltersIntoQuery: (base: Record<string, unknown>) => {
            const merged: Record<string, unknown> = { ...base };

            for (const facet of facets) {
              const columnQuery: { field: string; value: unknown } | null =
                facetColumnQuery.buildFacetColumnQuery({
                  facet: facet,
                  operator: operators[facet.key] || "is",
                  values: selections[facet.key] || [],
                  existingValue: merged[facet.queryField || facet.key],
                });

              if (columnQuery) {
                merged[columnQuery.field] = columnQuery.value;
              }
            }

            return merged;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {
            // no-op
          },
          facetSelections: selections,
          facetOperators: operators,
          setFacetSelection: (
            key: string,
            values: Array<string>,
            operator?: string,
          ) => {
            setSelections((previous: Record<string, Array<string>>) => {
              return { ...previous, [key]: values };
            });
            setOperators((previous: Record<string, string>) => {
              return { ...previous, [key]: operator || "is" };
            });
          },
        };
      },
    };
  },
);

import PostmortemsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Postmortems";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { POSTMORTEM_LIST_FACETS } from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemListFacets";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  hasMinWidthClassName,
  hasMaxWidthClassName,
} from "../../../UI/Components/Table/TableLayout";
import { isFillingNameColumn } from "../../../UI/Components/Table/CellClassName";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const WAIT: { timeout: number } = { timeout: 20000 };

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/incidents/postmortems`),
  currentProject: null,
  hasPaymentMethod: false,
};

const OWNER: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

const VIEWER: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.Viewer,
];

// The project's statuses: the four it started with, its own In Review, one archived.
const NOT_STARTED: string = "9a000000-0000-4000-8000-000000000001";
const DRAFT: string = "9a000000-0000-4000-8000-000000000002";
const IN_REVIEW: string = "9a000000-0000-4000-8000-000000000003";
const COMPLETED: string = "9a000000-0000-4000-8000-000000000004";
const NOT_NEEDED: string = "9a000000-0000-4000-8000-000000000005";
const OLD_PROCESS: string = "9a000000-0000-4000-8000-000000000006";

function postmortemStatus(
  id: string,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): IncidentPostmortemStatus {
  const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  status._id = id;
  status.name = name;
  status.order = order;
  status.description = `${name}: what it means.`;
  status.color = new Color("#6b7280");
  status.isNotStartedStatus = Boolean(flags["isNotStartedStatus"]);
  status.isDraftStatus = Boolean(flags["isDraftStatus"]);
  status.isCompletedStatus = Boolean(flags["isCompletedStatus"]);
  status.isArchived = Boolean(flags["isArchived"]);
  return status;
}

const STATUSES: Array<IncidentPostmortemStatus> = [
  postmortemStatus(NOT_STARTED, "Not Started", 1, {
    isNotStartedStatus: true,
  }),
  postmortemStatus(DRAFT, "Draft", 2, { isDraftStatus: true }),
  postmortemStatus(IN_REVIEW, "In Review", 3),
  postmortemStatus(COMPLETED, "Completed", 4, { isCompletedStatus: true }),
  postmortemStatus(NOT_NEEDED, "Not Needed", 5),
  postmortemStatus(OLD_PROCESS, "Old Process", 6, { isArchived: true }),
];

// How many incidents' postmortems are in each status.
let counts: Record<string, number> = {};

const INCIDENT_A: string = "9b000000-0000-4000-8000-00000000000a";
const INCIDENT_B: string = "9b000000-0000-4000-8000-00000000000b";
const INCIDENT_C: string = "9b000000-0000-4000-8000-00000000000c";

function incident(
  id: string,
  number: number,
  title: string,
  statusId: string | null,
): Incident {
  const row: Incident = new Incident();
  row._id = id;
  row.incidentNumber = number;
  row.incidentNumberWithPrefix = `INC-${number}`;
  row.title = title;

  if (statusId) {
    row.postmortemStatusId = new ObjectID(statusId);
  }

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  severity.color = new Color("#dc2626");
  row.incidentSeverity = severity;

  return row;
}

function lastTable(): Record<string, unknown> {
  expect(mockTableProps.length).toBeGreaterThan(0);
  return mockTableProps[mockTableProps.length - 1]!;
}

function countCalls(): Array<Record<string, unknown>> {
  return mockCount.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { query: Record<string, unknown> }).query;
    },
  );
}

beforeEach(() => {
  permissionsForTest = OWNER;
  PermissionGate.clearPermissionPropsCache();
  goTo(`/dashboard/${PROJECT_ID}/incidents/postmortems`);

  mockTableProps.length = 0;
  mockResourceOwnersOptions.length = 0;
  mockModalProps.length = 0;
  mockRows.length = 0;
  mockRows.push(
    incident(INCIDENT_A, 41, "Checkout is down", NOT_STARTED),
    incident(INCIDENT_B, 42, "Search is slow", DRAFT),
    // An incident from before statuses: none yet.
    incident(INCIDENT_C, 7, "An old outage", null),
  );

  counts = {
    [NOT_STARTED]: 12,
    [DRAFT]: 3,
    [IN_REVIEW]: 1,
    [COMPLETED]: 20,
    [NOT_NEEDED]: 4,
  };

  mockGetList.mockReset();
  mockGetList.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === IncidentPostmortemStatus) {
        return {
          data: STATUSES,
          count: STATUSES.length,
          skip: 0,
          limit: 100,
        };
      }

      return { data: [], count: 0, skip: 0, limit: 100 };
    },
  );

  mockCount.mockReset();
  mockCount.mockImplementation(
    async (...args: Array<unknown>): Promise<number> => {
      const query: Record<string, unknown> = (
        args[0] as { query: Record<string, unknown> }
      ).query;

      return counts[String(query["postmortemStatusId"])] || 0;
    },
  );

  mockUpdateById.mockReset();
  mockUpdateById.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<PostmortemsPage {...PAGE_PROPS} />);
  });

  // The statuses have answered: the rows draw them by name.
  await waitFor(() => {
    expect(
      within(screen.getByTestId(`row-${INCIDENT_B}`)).getByTestId(
        "postmortem-row-status-pill",
      ),
    ).toHaveTextContent("Draft");
  }, WAIT);
}

async function waitForTiles(): Promise<HTMLElement> {
  const strip: HTMLElement = await screen.findByTestId(
    "postmortem-status-summary-cards",
    {},
    WAIT,
  );

  await within(strip).findByTestId(
    `postmortem-status-count-${NOT_STARTED}`,
    {},
    WAIT,
  );

  return strip;
}

function tileButton(name: string, count: number): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${name}: ${count}\\.`),
  });
}

function rowStatus(incidentId: string): HTMLElement {
  return within(screen.getByTestId(`row-${incidentId}`)).getByTestId(
    "postmortem-row-status",
  );
}

describe("the Postmortems list", () => {
  test("lists the project's incidents, each read with its postmortem's status", async () => {
    await renderPage();

    const table: Record<string, unknown> = lastTable();

    expect(table["modelType"]).toBe(Incident);
    expect(table["id"]).toBe("postmortems-table");
    expect(table["userPreferencesKey"]).toBe("postmortems-table");
    expect(table["urlStateKey"]).toBe("postmortems-table");
    expect(table["saveFilterProps"]).toEqual({ tableId: "postmortems-table" });
    expect(
      (table["query"] as Record<string, unknown>)["projectId"]!.toString(),
    ).toBe(PROJECT_ID);
    expect(table["selectMoreFields"]).toEqual({
      incidentNumberWithPrefix: true,
      postmortemStatusId: true,
    });
    expect(table["cardProps"]).toEqual({
      title: "Postmortems",
      description:
        "Every incident's postmortem: where it stands and who owns it. Filter by owner, severity or status to see which are still owed.",
    });
    expect(table["searchableFields"]).toEqual(["title"]);
  });

  test("its columns: the incident, its title, where its postmortem stands, severity, owners and when it was declared; labels from Columns", async () => {
    await renderPage();

    const columns: Array<Record<string, unknown>> = lastTable()[
      "columns"
    ] as Array<Record<string, unknown>>;

    expect(
      columns.map((column: Record<string, unknown>): string => {
        return String(column["title"]);
      }),
    ).toEqual([
      "Incident",
      "Title",
      "Postmortem Status",
      "Severity",
      "Owners",
      "Declared",
      "Labels",
    ]);

    // The row's name stays whatever columns the reader picks.
    expect(columns[0]!["isNotCustomizable"]).toBe(true);
    expect(columns[6]!["isHiddenByDefault"]).toBe(true);

    /*
     * The day an incident was declared, not the minute: what a list of
     * postmortems is read by, and what leaves the columns their room beside
     * the side menu in German (57px past the card at 1280px with the time).
     */
    expect(columns[5]!["type"]).toBe(FieldType.Date);

    // The status column is read with the status's name and colour.
    expect(columns[2]!["field"]).toEqual({
      postmortemStatus: { _id: true, name: true, color: true },
    });

    const row: HTMLElement = screen.getByTestId(`row-${INCIDENT_A}`);

    expect(within(row).getByText("INC-41")).toBeInTheDocument();
    expect(within(row).getByText("Checkout is down")).toBeInTheDocument();
    expect(within(row).getByText("Critical")).toBeInTheDocument();
  });

  test("nothing is created, edited or deleted from it; a row opens its incident's Postmortem page", async () => {
    await renderPage();

    const table: Record<string, unknown> = lastTable();

    expect(table["isCreateable"]).toBe(false);
    expect(table["isEditable"]).toBe(false);
    expect(table["isDeleteable"]).toBe(false);
    expect(table["isViewable"]).toBe(true);
    expect(table["viewButtonText"]).toBe("View");

    const viewRoute: Route = await (
      table["onViewPage"] as (item: Incident) => Promise<Route>
    )(mockRows[0] as Incident);

    expect(viewRoute.toString()).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_A}/postmortem`,
    );

    // The number and the title link there too.
    const row: HTMLElement = screen.getByTestId(`row-${INCIDENT_A}`);

    for (const text of ["INC-41", "Checkout is down"]) {
      expect(within(row).getByText(text).closest("a")).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_A}/postmortem`,
      );
    }
  });

  test("its chips: the incidents' owners and labels, with Postmortem Status, Severity, Incident State and what it affects", async () => {
    await renderPage();

    const options: Record<string, unknown> = mockResourceOwnersOptions[0]!;

    expect(options["persistKey"]).toBe("postmortems-table");
    expect(options["ownerUserModelType"]).toBe(IncidentOwnerUser);
    expect(options["ownerTeamModelType"]).toBe(IncidentOwnerTeam);
    expect(options["resourceIdField"]).toBe("incidentId");
    expect(options["showLabelsFacet"]).toBe(true);
    expect(options["extraFacets"]).toBe(POSTMORTEM_LIST_FACETS);
  });

  test("with no incidents yet it says what will be listed, under a write-up's icon, and offers nothing to create", async () => {
    await renderPage();

    expect(lastTable()["emptyState"]).toEqual({
      title: "No postmortems yet",
      description:
        "When an incident is declared, its postmortem shows up here.",
      // The side menu's icon for Postmortems, not the incident's warning sign.
      icon: IconProp.DocumentText,
      hideCreateButton: true,
    });
  });

  test("the incident's number names its own floor, so the spare room of a table that fits goes to the title", async () => {
    await renderPage();

    const columns: Array<Record<string, unknown>> = lastTable()[
      "columns"
    ] as Array<Record<string, unknown>>;

    const incidentColumn: Record<string, unknown> = columns[0]!;
    const contentClassName: string = String(
      incidentColumn["contentClassName"] || "",
    );

    /*
     * Left to the table, the first column is the row's name and takes a
     * fitting table's spare room with a 10rem floor: 184px around
     * "INC-101" while the titles wrapped to three lines at 1280px.
     */
    expect(hasMinWidthClassName(contentClassName)).toBe(true);
    expect(
      isFillingNameColumn(
        incidentColumn as unknown as Parameters<typeof isFillingNameColumn>[0],
        true,
      ),
    ).toBe(false);

    // A floor, never a cap: a cap on a line that cannot wrap is #3585.
    expect(hasMaxWidthClassName(contentClassName)).toBe(false);

    // The title wraps, under a cap of its own (TableWrapContentInvariants).
    expect(columns[1]!["wrapContent"]).toBe(true);
    expect(String(columns[1]!["wrapMaxWidthClassName"])).toContain("max-w-");
  });
});

describe("the tiles above it", () => {
  test("count the project's incidents in each status it uses, top first, one count each; an archived status gets none", async () => {
    await renderPage();

    const strip: HTMLElement = await waitForTiles();

    const queries: Array<Record<string, unknown>> = countCalls();

    expect(
      queries.map((query: Record<string, unknown>): string => {
        return String(query["postmortemStatusId"]);
      }),
    ).toEqual([NOT_STARTED, DRAFT, IN_REVIEW, COMPLETED, NOT_NEEDED]);

    for (const query of queries) {
      expect(String(query["projectId"])).toBe(PROJECT_ID);
      expect(query["postmortemStatusId"]).toBeInstanceOf(ObjectID);
    }

    for (const [id, count] of Object.entries(counts)) {
      expect(
        within(strip).getByTestId(`postmortem-status-count-${id}`),
      ).toHaveTextContent(String(count));
    }

    expect(within(strip).queryByText("Old Process")).toBeNull();
    expect(within(strip).getByText("In Review: what it means.")).toBeTruthy();
  });

  test("a status's description is a caption of at most three lines, whole on hover, and left out on a phone", async () => {
    await renderPage();

    const strip: HTMLElement = await waitForTiles();

    const caption: HTMLElement = within(strip).getByTestId(
      `postmortem-status-caption-${IN_REVIEW}`,
    );
    const text: HTMLElement = within(caption).getByText(
      "In Review: what it means.",
    );

    // Long descriptions of a project's own keep the tiles level.
    expect(text.className).toContain("line-clamp-3");
    expect(text).toHaveAttribute("title", "In Review: what it means.");

    // Below sm the name and the count say enough.
    expect(caption.className.split(" ")).toContain("max-sm:hidden");
    // Never the bare class a foreign stylesheet hides at every width.
    expect(caption.className.split(" ")).not.toContain("hidden");
  });

  test("two tiles to a line on a tablet: the four share one line from lg up only", async () => {
    await renderPage();

    const strip: HTMLElement = await waitForTiles();

    expect(strip.className).toContain("grid-cols-2");
    expect(strip.className).toContain("lg:grid-cols-");
    expect(strip.className).not.toContain("md:grid-cols-");
  });

  test("a tile filters the list to its status and lights; a second click shows them all again", async () => {
    await renderPage();
    await waitForTiles();

    expect(tileButton("Not Started", 12)).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await act(async () => {
      fireEvent.click(tileButton("Not Started", 12));
    });

    await waitFor(() => {
      expect(
        (lastTable()["query"] as Record<string, unknown>)["postmortemStatus"],
      ).toBeInstanceOf(Includes);
    }, WAIT);

    const filtered: Includes = (
      lastTable()["query"] as Record<string, unknown>
    )["postmortemStatus"] as Includes;

    expect(
      filtered.values.map((value: unknown): string => {
        return String(value);
      }),
    ).toEqual([NOT_STARTED]);
    expect(tileButton("Not Started", 12)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(tileButton("Not Started", 12)).toHaveAccessibleName(
      /Filtering the postmortems below/,
    );
    expect(tileButton("Draft", 3)).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(tileButton("Not Started", 12));
    });

    await waitFor(() => {
      expect(
        (lastTable()["query"] as Record<string, unknown>)["postmortemStatus"],
      ).toBeUndefined();
    }, WAIT);
    expect(tileButton("Not Started", 12)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("a project with no incident yet shows no tiles: nothing to count", async () => {
    counts = {};

    await renderPage();

    await waitFor(() => {
      expect(mockCount).toHaveBeenCalledTimes(5);
    }, WAIT);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("postmortem-status-summary-cards")).toBeNull();
  });

  test("counts that cannot be read hide the tiles, and leave the list", async () => {
    mockCount.mockImplementation(async (): Promise<number> => {
      throw new Error("count failed");
    });

    await renderPage();

    await waitFor(() => {
      expect(mockCount).toHaveBeenCalled();
    }, WAIT);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("postmortem-status-summary-cards")).toBeNull();
    expect(screen.getByTestId("model-table")).toBeInTheDocument();
  });

  test("statuses that cannot be read leave the list without tiles, and nothing over the page", async () => {
    mockGetList.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Not allowed");
    });

    await act(async () => {
      render(<PostmortemsPage {...PAGE_PROPS} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("model-table")).toBeInTheDocument();
    expect(screen.queryByTestId("postmortem-status-summary-cards")).toBeNull();
    expect(mockCount).not.toHaveBeenCalled();
    expect(screen.queryByText("Not allowed")).toBeNull();
  });
});

describe("a row's postmortem status", () => {
  test("each row shows where its postmortem stands; one with none yet reads Not Started", async () => {
    await renderPage();

    expect(rowStatus(INCIDENT_A)).toHaveTextContent("Not Started");
    expect(rowStatus(INCIDENT_B)).toHaveTextContent("Draft");
    expect(rowStatus(INCIDENT_C)).toHaveTextContent("Not Started");
  });

  test("its pill moves the postmortem at once - every status not archived offered - and the counts and rows read again", async () => {
    await renderPage();
    await waitForTiles();

    const countsBefore: number = mockCount.mock.calls.length;
    const refreshBefore: string = screen
      .getByTestId("model-table")
      .getAttribute("data-refresh")!;

    fireEvent.click(
      within(rowStatus(INCIDENT_B)).getByRole("button", {
        name: /Postmortem status: Draft/,
      }),
    );

    const options: Array<HTMLElement> = await screen.findAllByTestId(
      "postmortem-row-status-option",
      {},
      WAIT,
    );

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(["Not Started", "Draft", "In Review", "Completed", "Not Needed"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "In Review" }));
    });

    await waitFor(() => {
      expect(mockUpdateById).toHaveBeenCalledTimes(1);
    }, WAIT);

    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = mockUpdateById.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(update.modelType).toBe(Incident);
    expect(update.id.toString()).toBe(INCIDENT_B);
    expect(Object.keys(update.data)).toEqual(["postmortemStatusId"]);
    expect(String(update.data["postmortemStatusId"])).toBe(IN_REVIEW);

    await waitFor(() => {
      expect(rowStatus(INCIDENT_B)).toHaveTextContent("In Review");
    }, WAIT);

    // The counts recount, and the rows read again.
    await waitFor(() => {
      expect(mockCount.mock.calls.length).toBe(countsBefore + 5);
    }, WAIT);
    expect(
      screen.getByTestId("model-table").getAttribute("data-refresh"),
    ).not.toBe(refreshBefore);
  });

  test("a reader who cannot edit incidents sees each status with no menu", async () => {
    permissionsForTest = VIEWER;
    PermissionGate.clearPermissionPropsCache();

    await renderPage();

    expect(rowStatus(INCIDENT_B)).toHaveTextContent("Draft");
    expect(
      within(rowStatus(INCIDENT_B)).queryByRole("button", {
        name: /Postmortem status/,
      }),
    ).toBeNull();
  });
});

describe("Change Postmortem Status, for many at once", () => {
  interface BulkButton {
    title: string;
    disabled?: boolean;
    tooltip?: string;
    onClick: (props: BulkActionOnClickProps<Incident>) => Promise<void>;
  }

  function bulkButtons(): Array<BulkButton> {
    return (lastTable()["bulkActions"] as { buttons: Array<BulkButton> })
      .buttons;
  }

  interface BulkRun {
    progress: Array<ProgressInfo<Incident>>;
    started: number;
    ended: number;
  }

  async function openDialog(items: Array<Incident>): Promise<BulkRun> {
    const run: BulkRun = { progress: [], started: 0, ended: 0 };

    await act(async () => {
      await bulkButtons()[0]!.onClick({
        items: items,
        onProgressInfo: (info: ProgressInfo<Incident>) => {
          run.progress.push(info);
        },
        onBulkActionStart: () => {
          run.started += 1;
        },
        onBulkActionEnd: () => {
          run.ended += 1;
        },
      });
    });

    await screen.findByTestId("bulk-status-dialog", {}, WAIT);

    return run;
  }

  function dialogProps(): Record<string, unknown> {
    expect(mockModalProps.length).toBeGreaterThan(0);
    return mockModalProps[mockModalProps.length - 1]!;
  }

  test("is the list's first bulk action, beside Add Owner and Remove Owner", async () => {
    await renderPage();

    expect(
      bulkButtons().map((button: BulkButton): string => {
        return button.title;
      }),
    ).toEqual(["Change Postmortem Status", "Add Owner", "Remove Owner"]);
    expect(bulkButtons()[0]!.disabled).toBe(false);
  });

  test("offers every status not archived, top first", async () => {
    await renderPage();
    await openDialog([mockRows[0] as Incident]);

    const props: Record<string, unknown> = dialogProps();

    expect(props["title"]).toBe("Change Postmortem Status");
    expect(props["submitButtonText"]).toBe("Change Postmortem Status");

    const field: Record<string, unknown> = (
      props["formProps"] as { fields: Array<Record<string, unknown>> }
    ).fields[0]!;

    expect(field["field"]).toEqual({ postmortemStatusId: true });
    expect(field["required"]).toBe(true);
    expect(
      (field["dropdownOptions"] as Array<{ label: string; value: string }>).map(
        (option: { label: string; value: string }): string => {
          return `${option.label}:${option.value}`;
        },
      ),
    ).toEqual([
      `Not Started:${NOT_STARTED}`,
      `Draft:${DRAFT}`,
      `In Review:${IN_REVIEW}`,
      `Completed:${COMPLETED}`,
      `Not Needed:${NOT_NEEDED}`,
    ]);
  });

  test("moves each selected incident's postmortem to the status picked, one update each, then reads the list again", async () => {
    await renderPage();
    await waitForTiles();

    const countsBefore: number = mockCount.mock.calls.length;
    const items: Array<Incident> = mockRows.slice(0, 3) as Array<Incident>;
    const run: BulkRun = await openDialog(items);

    await act(async () => {
      await (
        dialogProps()["onSubmit"] as (
          data: Record<string, unknown>,
        ) => Promise<void>
      )({ postmortemStatusId: NOT_NEEDED });
    });

    expect(
      mockUpdateById.mock.calls.map((call: Array<unknown>): string => {
        const request: {
          modelType: unknown;
          id: ObjectID;
          data: Record<string, unknown>;
        } = call[0] as {
          modelType: unknown;
          id: ObjectID;
          data: Record<string, unknown>;
        };

        expect(request.modelType).toBe(Incident);
        expect(Object.keys(request.data)).toEqual(["postmortemStatusId"]);

        return `${request.id.toString()}:${String(request.data["postmortemStatusId"])}`;
      }),
    ).toEqual([
      `${INCIDENT_A}:${NOT_NEEDED}`,
      `${INCIDENT_B}:${NOT_NEEDED}`,
      `${INCIDENT_C}:${NOT_NEEDED}`,
    ]);

    expect(run.started).toBe(1);
    expect(run.ended).toBe(1);
    /*
     * Through the shared runner: the first done is reported at once, the
     * rest at most ten times a second, the end always.
     */
    expect(run.progress.length).toBeGreaterThanOrEqual(2);

    const lastProgress: (typeof run.progress)[number] =
      run.progress[run.progress.length - 1]!;
    expect(lastProgress.successItems).toHaveLength(3);
    expect(lastProgress.failed).toHaveLength(0);
    expect(lastProgress.inProgressItems).toHaveLength(0);

    // The dialog closed; the counts recount.
    expect(screen.queryByTestId("bulk-status-dialog")).toBeNull();
    await waitFor(() => {
      expect(mockCount.mock.calls.length).toBe(countsBefore + 5);
    }, WAIT);
  });

  test("an incident the server refuses is reported with the reason; the others still move", async () => {
    mockUpdateById.mockImplementation(
      async (...args: Array<unknown>): Promise<unknown> => {
        const id: string = (args[0] as { id: ObjectID }).id.toString();

        if (id === INCIDENT_B) {
          throw new Error("You cannot edit this incident.");
        }

        return {};
      },
    );

    await renderPage();

    const run: BulkRun = await openDialog(
      mockRows.slice(0, 3) as Array<Incident>,
    );

    await act(async () => {
      await (
        dialogProps()["onSubmit"] as (
          data: Record<string, unknown>,
        ) => Promise<void>
      )({ postmortemStatusId: COMPLETED });
    });

    expect(mockUpdateById).toHaveBeenCalledTimes(3);

    const last: ProgressInfo<Incident> = run.progress[run.progress.length - 1]!;

    expect(last.successItems).toHaveLength(2);
    expect(last.failed).toHaveLength(1);
    expect(
      (last.failed[0] as BulkActionFailed<Incident>).item._id?.toString(),
    ).toBe(INCIDENT_B);
    expect(String(last.failed[0]!.failedMessage)).toContain(
      "You cannot edit this incident.",
    );
    expect(run.ended).toBe(1);
  });

  test("closing the dialog moves nothing", async () => {
    await renderPage();
    await openDialog([mockRows[0] as Incident]);

    await act(async () => {
      (dialogProps()["onClose"] as () => void)();
    });

    expect(screen.queryByTestId("bulk-status-dialog")).toBeNull();
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("a reader who cannot edit incidents finds it locked, saying why", async () => {
    permissionsForTest = VIEWER;
    PermissionGate.clearPermissionPropsCache();

    await renderPage();

    const button: BulkButton = bulkButtons()[0]!;

    expect(button.title).toBe("Change Postmortem Status");
    expect(button.disabled).toBe(true);
    expect(button.tooltip).toBeTruthy();
  });

  test("the statuses are read once, top first, archived ones too", async () => {
    await renderPage();

    const statusReads: Array<Array<unknown>> = mockGetList.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType ===
          IncidentPostmortemStatus
        );
      },
    );

    expect(statusReads).toHaveLength(1);

    const request: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      select: Record<string, unknown>;
    } = statusReads[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    expect(request.sort).toEqual({ order: SortOrder.Ascending });
    expect(request.select["isArchived"]).toBe(true);
  });
});

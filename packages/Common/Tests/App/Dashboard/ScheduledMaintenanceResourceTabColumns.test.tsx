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
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A RESOURCE'S OWN SCHEDULED MAINTENANCE TAB LEAVES OUT ITS AFFECTED
 * RESOURCES, AND FITS ITS CARD.
 *
 * Every event a cloud resource's (or an App Platforms environment's)
 * Scheduled Maintenance tab lists holds that resource, so the column only
 * said the resource again - cut short beside the side menu, where the list
 * has the least room (#6150's review) - and its filter chip only offered
 * it. The tab leaves both out. Even so its row ran 1,420px in a 938px card
 * at 1280px, when an event starts and ends out of sight to its right
 * (#6239's review): so its quieter columns fold where the row does not fit
 * - how long under when it starts, the status pages, labels and owners
 * under the title - and a phone's card says when the event starts. Every
 * other list of events keeps every column and chip as it was
 * (ScheduledMaintenanceTable.isResourceOwnTab, opt-in).
 *
 * The real pages and the real shared table are rendered; the table's own
 * ModelTable is stood in for, to keep the columns, query and chips it is
 * handed.
 */

interface HandedTable {
  columnTitles: Array<string>;
  query: Record<string, unknown>;
  // The chips over the list (useResourceOwners' filter bar).
  topContent: React.ReactNode;
}

const mockHandedTables: Array<HandedTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      columns?: Array<{ title: string }>;
      query?: Record<string, unknown>;
      topContent?: React.ReactNode;
    }): null => {
      mockHandedTables.push({
        columnTitles: (props.columns || []).map(
          (column: { title: string }): string => {
            return column.title;
          },
        ),
        query: props.query || {},
        topContent: props.topContent,
      });
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getItem: () => {
        return Promise.resolve(null);
      },
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

import ScheduledMaintenancesTable, {
  AFFECTED_RESOURCES_COLUMN_TITLE,
  RESOURCE_TAB_COLUMN_LAYOUT,
  getScheduledMaintenanceColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import CloudResourceScheduledMaintenance from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/ScheduledMaintenance";
import AppPlatformEnvironmentScheduledMaintenance from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/ScheduledMaintenance";
import HostScheduledMaintenance from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ScheduledMaintenance";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Includes from "../../../Types/BaseDatabase/Includes";
import Columns from "../../../UI/Components/ModelTable/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const RESOURCE_ID: string = "c0000000-0000-4000-8000-00000000000a";
const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";
const HOST_ID: string = "40000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mockHandedTables.length = 0;

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(
  path: string,
  page: React.ReactElement,
): Promise<HandedTable> {
  goTo(path);

  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });

  expect(mockHandedTables.length).toBeGreaterThan(0);

  return mockHandedTables[mockHandedTables.length - 1]!;
}

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Column = Columns<ScheduledMaintenance>[number];

// The chip a list of events filters by the resources they hold.
const AFFECTED_RESOURCES_CHIP: string = "Affected Resources";

// Draws the chips a list was handed, as the page draws them over it.
async function renderChips(table: HandedTable): Promise<void> {
  cleanup();

  await act(async () => {
    render(<MemoryRouter>{table.topContent}</MemoryRouter>);
  });

  // The bar is drawn: its other chips are there.
  expect(screen.getByText("State")).toBeInTheDocument();
}

describe("getScheduledMaintenanceColumns", () => {
  // The shared table's columns, in its order and with its phone flags.
  const COLUMNS: Columns<ScheduledMaintenance> = [
    { field: { title: true }, title: "Title", type: FieldType.Text },
    {
      field: { monitors: { name: true } },
      title: AFFECTED_RESOURCES_COLUMN_TITLE,
      type: FieldType.EntityArray,
      hideOnMobile: true,
    },
    {
      field: { statusPages: { name: true } },
      title: "Shown on Status Page",
      type: FieldType.EntityArray,
      hideOnMobile: true,
    },
    {
      field: { startsAt: true },
      title: "Starts At",
      type: FieldType.DateTime,
      hideOnMobile: true,
    },
    {
      field: { startsAt: true, endsAt: true },
      title: "Duration",
      type: FieldType.Element,
    },
    {
      field: { endsAt: true },
      title: "Ends At",
      type: FieldType.DateTime,
      hideOnMobile: true,
    },
    {
      field: { labels: { name: true } },
      title: "Labels",
      type: FieldType.EntityArray,
      hideOnMobile: true,
    },
    {
      field: { _id: true },
      title: "Owners",
      type: FieldType.Element,
      hideOnMobile: true,
    },
  ];

  function columnOf(
    columns: Columns<ScheduledMaintenance>,
    title: string,
  ): Column {
    return columns.find((column: Column): boolean => {
      return column.title === title;
    })!;
  }

  test("leaves out Affected Resources, and only it, on a resource's own tab", () => {
    expect(
      getScheduledMaintenanceColumns(true, COLUMNS).map(
        (column: Column): string => {
          return column.title;
        },
      ),
    ).toEqual([
      "Title",
      "Shown on Status Page",
      "Starts At",
      "Duration",
      "Ends At",
      "Labels",
      "Owners",
    ]);
  });

  test("folds how long an event lasts under when it starts, and its pages, labels and owners under its title, where the row does not fit", () => {
    const columns: Columns<ScheduledMaintenance> =
      getScheduledMaintenanceColumns(true, COLUMNS);

    expect(columnOf(columns, "Duration")).toMatchObject({
      hideBelowLargeScreen: true,
      foldInto: "startsAt",
    });

    for (const title of ["Shown on Status Page", "Labels", "Owners"]) {
      expect(columnOf(columns, title)).toMatchObject({
        hideBelowLargeScreen: true,
        foldInto: "title",
      });
    }

    // A status page's name under a title does not say what it is by itself.
    expect(columnOf(columns, "Shown on Status Page").showTitleWhenFolded).toBe(
      true,
    );
    expect(columnOf(columns, "Labels").showTitleWhenFolded).toBeUndefined();
    expect(columnOf(columns, "Owners").showTitleWhenFolded).toBeUndefined();

    // Which event, its state, and when it starts and ends stay columns.
    for (const title of ["Title", "Starts At", "Ends At"]) {
      expect(columnOf(columns, title).foldInto).toBeUndefined();
      expect(columnOf(columns, title).hideBelowLargeScreen).toBeUndefined();
    }

    // Each fold names a column the tab draws.
    for (const layout of Object.values(RESOURCE_TAB_COLUMN_LAYOUT)) {
      if (layout.foldInto) {
        expect(
          columns.some((column: Column): boolean => {
            return Object.keys(column.field || {})[0] === layout.foldInto;
          }),
        ).toBe(true);
      }
    }
  });

  test("a phone's card says when an event starts, not only how long it lasts", () => {
    const columns: Columns<ScheduledMaintenance> =
      getScheduledMaintenanceColumns(true, COLUMNS);

    expect(columnOf(columns, "Starts At").hideOnMobile).toBe(false);
    expect(columnOf(columns, "Duration").hideOnMobile).toBeUndefined();
    // The rest of a phone's card as every list's.
    for (const title of ["Ends At", "Labels", "Owners"]) {
      expect(columnOf(columns, title).hideOnMobile).toBe(true);
    }
  });

  test("lays out only the columns it names, and leaves the shared ones as they were", () => {
    expect(Object.keys(RESOURCE_TAB_COLUMN_LAYOUT).sort()).toEqual([
      "Duration",
      "Labels",
      "Owners",
      "Shown on Status Page",
      "Starts At",
    ]);

    getScheduledMaintenanceColumns(true, COLUMNS);

    expect(columnOf(COLUMNS, "Duration").foldInto).toBeUndefined();
    expect(columnOf(COLUMNS, "Starts At").hideOnMobile).toBe(true);
  });

  test("keeps every column on every other list, as it was", () => {
    expect(getScheduledMaintenanceColumns(false, COLUMNS)).toBe(COLUMNS);
    expect(getScheduledMaintenanceColumns(undefined, COLUMNS)).toBe(COLUMNS);
  });

  test("names the column as the table titles it", () => {
    expect(AFFECTED_RESOURCES_COLUMN_TITLE).toBe("Affected Resources");
  });
});

describe("the lists of events", () => {
  test("a cloud resource's tab lists the events that hold it, without the column that says it again", async () => {
    const table: HandedTable = await renderPage(
      `/dashboard/${PROJECT_ID}/cloud/${RESOURCE_ID}/scheduled-maintenance`,
      <CloudResourceScheduledMaintenance {...PAGE_PROPS} />,
    );

    expect(table.columnTitles).not.toContain(AFFECTED_RESOURCES_COLUMN_TITLE);
    // The rest of the list as it was: its number, title, state and times.
    expect(table.columnTitles).toEqual(
      expect.arrayContaining([
        "Scheduled Maintenance Number",
        "Title",
        "Current State",
        "Starts At",
        "Ends At",
      ]),
    );
    expect(
      (table.query["cloudResources"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([RESOURCE_ID]);

    // Nor a chip that would only offer it.
    await renderChips(table);
    expect(screen.queryByText(AFFECTED_RESOURCES_CHIP)).toBeNull();
  });

  test("an App Platforms environment's tab lists the events that hold it, without the column either", async () => {
    const table: HandedTable = await renderPage(
      `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}/scheduled-maintenance`,
      <AppPlatformEnvironmentScheduledMaintenance {...PAGE_PROPS} />,
    );

    expect(table.columnTitles).not.toContain(AFFECTED_RESOURCES_COLUMN_TITLE);
    expect(table.columnTitles).toContain("Title");
    expect(
      (table.query["cloudResources"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([ENVIRONMENT_ID]);

    await renderChips(table);
    expect(screen.queryByText(AFFECTED_RESOURCES_CHIP)).toBeNull();
  });

  test("a host's tab keeps it: the change is the cloud tabs' own", async () => {
    const table: HandedTable = await renderPage(
      `/dashboard/${PROJECT_ID}/hosts/${HOST_ID}/scheduled-maintenance`,
      <HostScheduledMaintenance {...PAGE_PROPS} />,
    );

    expect(table.columnTitles).toContain(AFFECTED_RESOURCES_COLUMN_TITLE);

    await renderChips(table);
    expect(screen.getByText(AFFECTED_RESOURCES_CHIP)).toBeInTheDocument();
  });

  test("the project's lists keep it", async () => {
    const table: HandedTable = await renderPage(
      `/dashboard/${PROJECT_ID}/scheduled-maintenance-events`,
      <ScheduledMaintenancesTable
        query={{ projectId: new ObjectID(PROJECT_ID) }}
      />,
    );

    expect(table.columnTitles).toContain(AFFECTED_RESOURCES_COLUMN_TITLE);

    await renderChips(table);
    expect(screen.getByText(AFFECTED_RESOURCES_CHIP)).toBeInTheDocument();
  });
});

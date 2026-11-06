import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A RESOURCE'S OWN SCHEDULED MAINTENANCE TAB LEAVES OUT ITS AFFECTED
 * RESOURCES COLUMN.
 *
 * Every event a cloud resource's (or an App Platforms environment's)
 * Scheduled Maintenance tab lists holds that resource, so the column only
 * said the resource again - cut short beside the side menu, where the list
 * has the least room (#6150's review). The tab leaves it out; every other
 * list of events keeps it, and the shared table's own columns are as they
 * were (ScheduledMaintenanceTable.leaveOutAffectedResources, opt-in).
 *
 * The real pages and the real shared table are rendered; the table's own
 * ModelTable is stood in for, to keep the columns and query it is handed.
 */

interface HandedTable {
  columnTitles: Array<string>;
  query: Record<string, unknown>;
}

const mockHandedTables: Array<HandedTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      columns?: Array<{ title: string }>;
      query?: Record<string, unknown>;
    }): null => {
      mockHandedTables.push({
        columnTitles: (props.columns || []).map(
          (column: { title: string }): string => {
            return column.title;
          },
        ),
        query: props.query || {},
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

describe("getScheduledMaintenanceColumns", () => {
  const COLUMNS: Columns<ScheduledMaintenance> = [
    { field: { title: true }, title: "Title", type: FieldType.Text },
    {
      field: { monitors: { name: true } },
      title: AFFECTED_RESOURCES_COLUMN_TITLE,
      type: FieldType.EntityArray,
    },
    { field: { startsAt: true }, title: "Starts At", type: FieldType.Date },
  ];

  test("leaves out Affected Resources, and only it, on a resource's own tab", () => {
    expect(
      getScheduledMaintenanceColumns(true, COLUMNS).map(
        (column: Columns<ScheduledMaintenance>[number]): string => {
          return column.title;
        },
      ),
    ).toEqual(["Title", "Starts At"]);
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
  });

  test("a host's tab keeps it: the change is the cloud tabs' own", async () => {
    const table: HandedTable = await renderPage(
      `/dashboard/${PROJECT_ID}/hosts/${HOST_ID}/scheduled-maintenance`,
      <HostScheduledMaintenance {...PAGE_PROPS} />,
    );

    expect(table.columnTitles).toContain(AFFECTED_RESOURCES_COLUMN_TITLE);
  });

  test("the project's lists keep it", async () => {
    const table: HandedTable = await renderPage(
      `/dashboard/${PROJECT_ID}/scheduled-maintenance-events`,
      <ScheduledMaintenancesTable
        query={{ projectId: new ObjectID(PROJECT_ID) }}
      />,
    );

    expect(table.columnTitles).toContain(AFFECTED_RESOURCES_COLUMN_TITLE);
  });
});

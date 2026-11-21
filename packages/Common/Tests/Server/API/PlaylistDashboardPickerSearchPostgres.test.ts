import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  IS_POSTGRES_PICKER_SEARCH_RUN,
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DashboardPlaylistDashboard } from "../../../Types/Dashboard/DashboardPlaylist";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withSearch } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import { getAddablePlaylistDashboardsQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PLAYLIST'S DASHBOARDS PICKER, SEARCHED THROUGH THE REAL SERVER (#10580).
 *
 * A playlist's Dashboards field read the project's first 10,000 dashboards
 * when it opened and picked from those in the browser: a dashboard whose
 * name sorted past them was never offered, and one in the list past them
 * read as "Dashboard not available". The picker now searches the server as
 * the editor types (EntityDropdown with getAddablePlaylistDashboardsQuery:
 * not archived, not in the list yet, 50 by name), and counts what is left
 * to add the same way.
 *
 * A project of 10,050 dashboards named before "WB"; each read goes through
 * the dashboard list route the app registers, as a member
 * (PostgresListRouteHarness).
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
 */
const describePostgres: typeof describe.skip = IS_POSTGRES_PICKER_SEARCH_RUN
  ? describe
  : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source is the harness's; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

const DASHBOARDS_BEFORE_WB: number = 10050;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "a playlist's dashboards picker, searched through the real server (#10580)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "playlist_picker",
      tables: ["Dashboard", "DashboardLabel"],
    });

    // The dashboard list route, as the app registers it.
    new DashboardAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const named: Record<string, string> = {};

    const insertDashboard: (data: {
      name: string;
      isArchived?: boolean | undefined;
      inProject?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      isArchived?: boolean | undefined;
      inProject?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("Dashboard", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `dashboard-${id.toString()}`,
        dashboardViewConfig: JSON.stringify({
          _type: "DashboardViewConfig",
          components: [],
        }),
        isArchived: Boolean(data.isArchived),
      });

      named[data.name] = id.toString();
    };

    // A search typed into the picker, as EntityDropdown sends it.
    const search: (
      text: string,
      inList: Array<DashboardPlaylistDashboard>,
    ) => Promise<ListedPage<Dashboard>> = async (
      text: string,
      inList: Array<DashboardPlaylistDashboard>,
    ): Promise<ListedPage<Dashboard>> => {
      return await harness.list<Dashboard>({
        path: "/dashboard",
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(
            Dashboard,
            getAddablePlaylistDashboardsQuery(inList) as Record<
              string,
              unknown
            >,
          ),
          "name",
          text,
        ),
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: PICKER_PAGE_SIZE,
        userId: memberId,
        projectId: projectId,
      });
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      // More dashboards than the field ever read, all named before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Dashboard" ("_id", "version", "projectId", "name", "slug", "dashboardViewConfig", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0') || ' overview', 'dashboard-' || gen_random_uuid(), '{"_type":"DashboardViewConfig","components":[]}'::jsonb, false
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), DASHBOARDS_BEFORE_WB],
      );

      await insertDashboard({ name: "WB1500 kiosk overview" });
      await insertDashboard({ name: "WB1500 kiosk network" });
      // Archived: the player skips it, so it is never added.
      await insertDashboard({
        name: "WB1500 kiosk overview (old)",
        isArchived: true,
      });
      // Another project's.
      await insertDashboard({
        name: "WB1500 kiosk overview (another project)",
        inProject: otherProjectId,
      });

      await harness.analyze("Dashboard");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the field's old read never had WB1500 kiosk overview: the first 10,000 by name", async () => {
      const read: ListedPage<Dashboard> = await harness.list<Dashboard>({
        path: "/dashboard",
        query: {},
        select: { _id: true, name: true, isArchived: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "name")).not.toContain("WB1500 kiosk overview");
    });

    test("the picker's search finds it past the 10,000th", async () => {
      const page: ListedPage<Dashboard> = await search("WB1500 kiosk", []);

      expect(valuesOf(page, "name")).toEqual([
        "WB1500 kiosk network",
        "WB1500 kiosk overview",
      ]);
    });

    test("never offers an archived dashboard, one in the list, or another project's", async () => {
      const page: ListedPage<Dashboard> = await search("WB1500", [
        { dashboardId: named["WB1500 kiosk network"]! },
      ]);

      expect(valuesOf(page, "name")).toEqual(["WB1500 kiosk overview"]);
    });

    test("counts what is left to add with the same query", async () => {
      const page: ListedPage<Dashboard> = await search("", [
        { dashboardId: named["WB1500 kiosk network"]! },
      ]);

      expect(page.rows).toHaveLength(PICKER_PAGE_SIZE);
      // Every live dashboard of the project but the one in the list.
      expect(page.count).toBe(DASHBOARDS_BEFORE_WB + 1);
    });
  },
);

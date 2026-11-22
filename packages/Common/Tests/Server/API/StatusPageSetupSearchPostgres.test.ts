import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import MonitorGroupAPI from "../../../Server/API/MonitorGroupAPI";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  NO_STATUS_PAGE_SETUP_FILTER,
  STATUS_PAGE_SETUP_PAGE_SIZE,
  StatusPageSetupFilter,
  getStatusPageSetupSearchQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE STATUS PAGE GUIDED SETUP'S LIST OF MONITORS, SEARCHED THROUGH THE REAL
 * SERVER (#10580).
 *
 * Step 1 read the project's first 10,000 monitors by name and searched them
 * by name and label in the browser: a monitor whose name sorted late -
 * "WB1500KSK02" - was never listed, and a search for it found nothing. Each
 * search now asks the server for the name and the label
 * (getStatusPageSetupSearchQuery on top of the project), a page of
 * monitors and of monitor groups by name, with how many match.
 *
 * A project of 10,050 monitors named before "WB"; each read goes through
 * the monitor and monitor group list routes the app registers, as a member
 * (PostgresListRouteHarness).
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"] === "true"
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

const MONITORS_BEFORE_WB: number = 10050;

describePostgres(
  "the status page guided setup's list, searched through the real server (#10580)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "status_page_setup",
      tables: ["Monitor", "MonitorLabel", "MonitorGroup", "MonitorGroupLabel"],
    });

    // The list routes, as the app registers them.
    new MonitorAPI();
    new MonitorGroupAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    const insertMonitor: (data: {
      name: string;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("Monitor", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `monitor-${id.toString()}`,
        monitorType: MonitorType.Ping,
        currentMonitorStatusId: monitorStatusId,
        isArchived: false,
      });

      if (data.labelId) {
        await harness.insert("MonitorLabel", {
          monitorId: id,
          labelId: data.labelId,
        });
      }
    };

    const insertGroup: (data: {
      name: string;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("MonitorGroup", {
        _id: id,
        version: 1,
        projectId: projectId,
        name: data.name,
        slug: `group-${id.toString()}`,
      });

      if (data.labelId) {
        await harness.insert("MonitorGroupLabel", {
          monitorGroupId: id,
          labelId: data.labelId,
        });
      }
    };

    // A search of step 1's list, as StatusPageSetupApi sends it.
    const search: <TModel extends BaseModel>(data: {
      path: string;
      filter: StatusPageSetupFilter;
      asUserId?: ObjectID | undefined;
    }) => Promise<ListedPage<TModel>> = async <TModel extends BaseModel>(data: {
      path: string;
      filter: StatusPageSetupFilter;
      asUserId?: ObjectID | undefined;
    }): Promise<ListedPage<TModel>> => {
      return await harness.list<TModel>({
        path: data.path,
        query: {
          projectId: projectId,
          ...getStatusPageSetupSearchQuery(data.filter),
        },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: STATUS_PAGE_SETUP_PAGE_SIZE,
        userId: data.asUserId || memberId,
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

      await harness.insertLabel({
        id: kioskLabelId,
        projectId: projectId,
        name: "SubCategory: Kiosk",
      });

      await harness.insertMember({
        userId: kioskMemberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
        labelIds: [kioskLabelId],
      });

      // More monitors than the step ever read, all named before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'monitor-' || gen_random_uuid(), $2, $3, false
         FROM generate_series(1, $4) AS i`,
        [
          projectId.toString(),
          MonitorType.Ping,
          monitorStatusId.toString(),
          MONITORS_BEFORE_WB,
        ],
      );

      await insertMonitor({ name: "WB1500 KSK02", labelId: kioskLabelId });
      await insertMonitor({ name: "WB1500 KSK03" });
      // Another project's.
      await insertMonitor({ name: "WB1500 KSK04", inProject: otherProjectId });

      await insertGroup({ name: "WB kiosks", labelId: kioskLabelId });
      await insertGroup({ name: "AP routers" });

      await harness.analyze("Monitor");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the step's old read never had WB1500 KSK02: the first 10,000 by name", async () => {
      const read: ListedPage<Monitor> = await harness.list<Monitor>({
        path: "/monitor",
        query: { projectId: projectId },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "name")).not.toContain("WB1500 KSK02");
    });

    test("a search finds it past the 10,000th, and never another project's", async () => {
      const page: ListedPage<Monitor> = await search<Monitor>({
        path: "/monitor",
        filter: { search: "wb1500", labelId: null },
      });

      expect(valuesOf(page, "name")).toEqual(["WB1500 KSK02", "WB1500 KSK03"]);
      expect(page.count).toBe(2);
    });

    test("a search reads the name however its spaces run", async () => {
      const page: ListedPage<Monitor> = await search<Monitor>({
        path: "/monitor",
        filter: { search: "  WB1500    KSK0 ", labelId: null },
      });

      expect(valuesOf(page, "name")).toEqual(["WB1500 KSK02", "WB1500 KSK03"]);
    });

    test("a label narrows the monitors and the groups on the server", async () => {
      const filter: StatusPageSetupFilter = {
        search: "",
        labelId: kioskLabelId.toString(),
      };

      expect(
        valuesOf(await search<Monitor>({ path: "/monitor", filter }), "name"),
      ).toEqual(["WB1500 KSK02"]);
      expect(
        valuesOf(await search({ path: "/monitor-group", filter }), "name"),
      ).toEqual(["WB kiosks"]);
    });

    test("monitor groups are found by name too", async () => {
      expect(
        valuesOf(
          await search({
            path: "/monitor-group",
            filter: { search: "kiosk", labelId: null },
          }),
          "name",
        ),
      ).toEqual(["WB kiosks"]);
    });

    test("with nothing typed, the first page by name, counting every monitor", async () => {
      const page: ListedPage<Monitor> = await search<Monitor>({
        path: "/monitor",
        filter: NO_STATUS_PAGE_SETUP_FILTER,
      });

      expect(page.rows).toHaveLength(STATUS_PAGE_SETUP_PAGE_SIZE);
      expect(page.count).toBe(MONITORS_BEFORE_WB + 2);
    });

    test("a member limited to a label finds only that label's monitors", async () => {
      const page: ListedPage<Monitor> = await search<Monitor>({
        path: "/monitor",
        filter: { search: "WB1500", labelId: null },
        asUserId: kioskMemberId,
      });

      expect(valuesOf(page, "name")).toEqual(["WB1500 KSK02"]);
    });
  },
);

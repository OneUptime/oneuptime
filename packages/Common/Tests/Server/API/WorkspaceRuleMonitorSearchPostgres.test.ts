import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withSearch } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import RecordsById from "../../../UI/Utils/RecordsById";
import { MONITOR_CONDITION_QUERY } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/MonitorConditionPicker";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A WORKSPACE RULE'S "MONITOR IS ANY OF ...", SEARCHED AND READ THROUGH THE
 * REAL SERVER (#10646).
 *
 * The rules and summaries pages read every monitor of the project - the
 * first 10,000 by name - to offer them in the condition and to name a
 * rule's monitors on its card. A monitor whose name sorts past the
 * 10,000th ("WB1500KSK02") could not be picked, and one a rule held read
 * "No longer in this project".
 *
 * The condition's search (MonitorConditionPicker: EntityDropdown with its
 * query, 50 by name) and the reads by id that name what a rule holds go
 * through the monitor list route as a member, on migrated Postgres
 * (PostgresListRouteHarness): the late monitor is found and named, an
 * archived monitor is never offered but is named - marked - when a rule
 * holds it, and another project's monitor is never either.
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

const MONITORS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "a workspace rule's monitors condition, searched and read through the real server (#10646)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "workspace_rule_monitors",
      tables: ["Monitor", "MonitorLabel"],
    });

    // The list route, as the app registers it.
    new MonitorAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    const lateMonitorId: ObjectID = ObjectID.generate();
    const archivedMonitorId: ObjectID = ObjectID.generate();
    const otherProjectMonitorId: ObjectID = ObjectID.generate();
    // Never inserted: a monitor a rule holds, deleted since.
    const deletedMonitorId: ObjectID = ObjectID.generate();

    const insertMonitor: (data: {
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      await harness.insert("Monitor", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `monitor-${data.id.toString()}`,
        monitorType: MonitorType.Ping,
        currentMonitorStatusId: monitorStatusId,
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await harness.insert("MonitorLabel", {
          monitorId: data.id,
          labelId: data.labelId,
        });
      }
    };

    // A search typed into the condition, as EntityDropdown sends it.
    const search: (data: {
      text: string;
      asUserId?: ObjectID | undefined;
    }) => Promise<ListedPage<Monitor>> = async (data: {
      text: string;
      asUserId?: ObjectID | undefined;
    }): Promise<ListedPage<Monitor>> => {
      return await harness.list<Monitor>({
        path: "/monitor",
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(Monitor, MONITOR_CONDITION_QUERY),
          "name",
          data.text,
        ),
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: PICKER_PAGE_SIZE,
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

      // More monitors than the pages ever read, all named before "WB".
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

      await insertMonitor({
        id: lateMonitorId,
        name: "WB1500KSK02",
        labelId: kioskLabelId,
      });
      await insertMonitor({ id: ObjectID.generate(), name: "WB1500KSK03" });
      await insertMonitor({
        id: archivedMonitorId,
        name: "WB1500KSK09",
        isArchived: true,
      });
      await insertMonitor({
        id: otherProjectMonitorId,
        name: "WB1500KSK04",
        inProject: otherProjectId,
      });

      await harness.analyze("Monitor");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the pages' old read never had WB1500KSK02: the first 10,000 by name", async () => {
      const read: ListedPage<Monitor> = await harness.list<Monitor>({
        path: "/monitor",
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "name")).not.toContain("WB1500KSK02");
    });

    test("the condition finds WB1500KSK02 past the 10,000th, never an archived monitor", async () => {
      const page: ListedPage<Monitor> = await search({ text: "WB1500KSK0" });

      expect(valuesOf(page, "name")).toEqual(["WB1500KSK02", "WB1500KSK03"]);
      expect(page.count).toBe(2);
    });

    test("with nothing typed, lists 50 by name and counts every live monitor of the project", async () => {
      const page: ListedPage<Monitor> = await search({ text: "" });

      expect(page.rows).toHaveLength(PICKER_PAGE_SIZE);
      expect(page.count).toBe(MONITORS_BEFORE_WB + 2);
    });

    test("never another project's monitor", async () => {
      expect(valuesOf(await search({ text: "WB1500KSK04" }), "name")).toEqual(
        [],
      );
    });

    test("a member limited to a label finds only that label's monitors", async () => {
      expect(
        valuesOf(
          await search({ text: "WB1500", asUserId: kioskMemberId }),
          "name",
        ),
      ).toEqual(["WB1500KSK02"]);
    });

    test("what a rule holds is named by its ids: the late one, the archived one marked, the deleted one not there", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const monitors: Array<Monitor> = await RecordsById.read<Monitor>({
        modelType: Monitor,
        ids: [
          lateMonitorId.toString(),
          archivedMonitorId.toString(),
          deletedMonitorId.toString(),
          otherProjectMonitorId.toString(),
        ],
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
      });

      expect(
        monitors
          .map((monitor: Monitor): string => {
            return `${monitor.name}${monitor.isArchived ? " (archived)" : ""}`;
          })
          .sort(),
      ).toEqual(["WB1500KSK02", "WB1500KSK09 (archived)"]);

      // One read, of the four held: never the project's monitors whole.
      expect(reads).toHaveLength(1);
      expect(reads[0]!.limit).toBe(4);
    });
  },
);

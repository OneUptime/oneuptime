import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  IS_POSTGRES_PICKER_SEARCH_RUN,
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import ServiceLevelObjectiveAPI from "../../../Server/API/ServiceLevelObjectiveAPI";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withSearch } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import { getEntityModelDef } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DASHBOARD WIDGET'S ENTITY PICKER, SEARCHED THROUGH THE REAL SERVER
 * (#10580).
 *
 * A Monitor List widget's monitors were picked from the first 1,000 by
 * name, read when its settings opened and searched in the browser: in a
 * project with more, a monitor whose name sorted late - "WB1500KSK02" - was
 * never offered. The picker now searches the server as the reader types
 * (EntityDropdown: the kind's pickable query, ArchivedValuePicker,
 * withSearch, 50 by name), so it is found however many monitors there are;
 * an SLO widget keeps leaving archived SLOs out.
 *
 * A project of 1,050 monitors named before "WB" and SLOs beside an archived
 * one; each read goes through the list route the app registers, as a member
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

// The widget's old read, and how many monitors sort before "WB".
const OLD_CAP: number = 1000;
const MONITORS_BEFORE_WB: number = 1050;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "a dashboard widget's entity picker, searched through the real server (#10580)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "widget_picker",
      tables: [
        "Monitor",
        "MonitorLabel",
        "ServiceLevelObjective",
        "ServiceLevelObjectiveLabel",
      ],
    });

    // The list routes, as the app registers them.
    new MonitorAPI();
    new ServiceLevelObjectiveAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    const insertMonitor: (data: {
      name: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
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
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await harness.insert("MonitorLabel", {
          monitorId: id,
          labelId: data.labelId,
        });
      }
    };

    const insertSlo: (data: {
      name: string;
      isArchived?: boolean | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      isArchived?: boolean | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("ServiceLevelObjective", {
        _id: id,
        version: 1,
        projectId: projectId,
        name: data.name,
        slug: `slo-${id.toString()}`,
        targetPercentage: 99.9,
        isArchived: Boolean(data.isArchived),
      });
    };

    /*
     * A search typed into the widget's picker, as EntityDropdown sends it:
     * the kind's pickable query, values that can be archived left out,
     * the text searched by name, 50 by name.
     */
    const search: <TModel extends BaseModel>(data: {
      kind: EntityFilterModelType;
      path: string;
      text: string;
      asUserId?: ObjectID | undefined;
    }) => Promise<ListedPage<TModel>> = async <TModel extends BaseModel>(data: {
      kind: EntityFilterModelType;
      path: string;
      text: string;
      asUserId?: ObjectID | undefined;
    }): Promise<ListedPage<TModel>> => {
      const def: ReturnType<typeof getEntityModelDef> = getEntityModelDef(
        data.kind,
      );

      return await harness.list<TModel>({
        path: data.path,
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(
            def.modelType,
            def.pickableQuery as Record<string, unknown> | undefined,
          ),
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

      // More monitors than the widget ever read, all named before "WB".
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

      await insertMonitor({ name: "WB1500KSK02", labelId: kioskLabelId });
      await insertMonitor({ name: "WB1500KSK03" });
      // Another project's.
      await insertMonitor({ name: "WB1500KSK04", inProject: otherProjectId });

      await insertSlo({ name: "Checkout latency" });
      await insertSlo({ name: "Checkout errors" });
      // Retired: never offered for a new widget.
      await insertSlo({ name: "Checkout uptime (old)", isArchived: true });

      await harness.analyze("Monitor");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    describe("a Monitor List widget's monitors", () => {
      test("the widget's old read never had WB1500KSK02: the first 1,000 by name", async () => {
        const read: ListedPage<Monitor> = await harness.list<Monitor>({
          path: "/monitor",
          query: { projectId: projectId },
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: OLD_CAP,
          userId: memberId,
          projectId: projectId,
        });

        expect(read.rows).toHaveLength(OLD_CAP);
        expect(read.count).toBe(MONITORS_BEFORE_WB + 2);
        expect(valuesOf(read, "name")).not.toContain("WB1500KSK02");
      });

      test("the picker's search finds WB1500KSK02 past the 1,000th", async () => {
        const page: ListedPage<Monitor> = await search<Monitor>({
          kind: EntityFilterModelType.Monitor,
          path: "/monitor",
          text: "WB1500KSK0",
        });

        expect(valuesOf(page, "name")).toEqual(["WB1500KSK02", "WB1500KSK03"]);
        expect(page.count).toBe(2);
      });

      test("with nothing typed, lists 50 by name and counts every monitor of the project", async () => {
        const page: ListedPage<Monitor> = await search<Monitor>({
          kind: EntityFilterModelType.Monitor,
          path: "/monitor",
          text: "",
        });

        expect(page.rows).toHaveLength(PICKER_PAGE_SIZE);
        expect(page.count).toBe(MONITORS_BEFORE_WB + 2);
      });

      test("never another project's monitor", async () => {
        expect(
          valuesOf(
            await search<Monitor>({
              kind: EntityFilterModelType.Monitor,
              path: "/monitor",
              text: "WB1500KSK04",
            }),
            "name",
          ),
        ).toEqual([]);
      });

      test("a member limited to a label finds only that label's monitors", async () => {
        const page: ListedPage<Monitor> = await search<Monitor>({
          kind: EntityFilterModelType.Monitor,
          path: "/monitor",
          text: "WB1500",
          asUserId: kioskMemberId,
        });

        expect(valuesOf(page, "name")).toEqual(["WB1500KSK02"]);
      });
    });

    describe("an SLO widget", () => {
      test("offers the SLOs that are not archived, never the archived one", async () => {
        const page: ListedPage<ServiceLevelObjective> =
          await search<ServiceLevelObjective>({
            kind: EntityFilterModelType.ServiceLevelObjective,
            path: "/service-level-objective",
            text: "checkout",
          });

        expect(valuesOf(page, "name")).toEqual([
          "Checkout errors",
          "Checkout latency",
        ]);
      });
    });
  },
);

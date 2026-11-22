import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import InventoryItemService, {
  InventoryItemService as InventoryItemServiceType,
} from "../../../Server/Services/InventoryItemService";
import ServiceService, {
  Service as ServiceServiceType,
} from "../../../Server/Services/ServiceService";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withSearchIn } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import {
  INFRASTRUCTURE_ENTITY_PICKER,
  TELEMETRY_SERVICE_PICKER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TelemetryScopePickers";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A TELEMETRY MONITOR STEP'S "FILTER BY SERVICE" AND "FILTER BY
 * INFRASTRUCTURE ENTITY", SEARCHED AND READ THROUGH THE REAL SERVER
 * (#10646).
 *
 * The step offered the project's first 10,000 services and inventory items
 * by name. A pod past them - "WB1500KSK02-7d9f" in a project of 10,050
 * named before it - could not be picked, and one a monitor filtered on
 * showed as nothing. The two fields search the server now
 * (TelemetryScopePickers: EntityDropdown, 50 by name; an inventory item by
 * its name or its key, a key being what the step holds), and what a step
 * holds is read by that value: the list routes the app registers, as a
 * member, on migrated Postgres (PostgresListRouteHarness).
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

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "a telemetry step's services and infrastructure entities, searched through the real server (#10646)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "telemetry_scope",
      tables: ["Service", "InventoryItem"],
    });

    // The list routes, as the app registers them.
    new BaseAPI<Service, ServiceServiceType>(Service, ServiceService);
    new BaseAPI<InventoryItem, InventoryItemServiceType>(
      InventoryItem,
      InventoryItemService,
    );

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const lateServiceId: ObjectID = ObjectID.generate();

    // A search typed into one of the step's fields, as EntityDropdown sends it.
    const search: (data: {
      picker: typeof INFRASTRUCTURE_ENTITY_PICKER;
      path: string;
      text: string;
    }) => Promise<ListedPage> = async (data: {
      picker: typeof INFRASTRUCTURE_ENTITY_PICKER;
      path: string;
      text: string;
    }): Promise<ListedPage> => {
      return await harness.list({
        path: data.path,
        query: withSearchIn(
          ArchivedValuePicker.getPickerQuery(
            data.picker.type,
            data.picker.query,
          ),
          data.picker.searchFields || [data.picker.labelField],
          data.text,
        ),
        select: {
          _id: true,
          [data.picker.labelField]: true,
          [data.picker.valueField]: true,
          ...(data.picker.descriptionField
            ? { [data.picker.descriptionField]: true }
            : {}),
        },
        sort: { [data.picker.labelField]: SortOrder.Ascending },
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

      // More of each than the step ever read, all named before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Service" ("_id", "version", "projectId", "name", "slug")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'service-' || gen_random_uuid()
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), BEFORE_WB],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."InventoryItem" ("_id", "version", "projectId", "entityType", "entityKey", "displayName")
         SELECT gen_random_uuid(), 1, $1, 'k8s.pod', 'k8s.pod/AP' || lpad(i::text, 6, '0'), 'AP' || lpad(i::text, 6, '0')
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), BEFORE_WB],
      );

      await harness.insert("Service", {
        _id: lateServiceId,
        version: 1,
        projectId: projectId,
        name: "WB-checkout",
        slug: `service-${lateServiceId.toString()}`,
      });

      for (const [inProject, entityKey, displayName] of [
        [projectId, "k8s.pod/WB1500KSK02-7d9f", "WB1500KSK02-7d9f"],
        // A node no name was ever reported for: found by its key.
        [projectId, "k8s.node/ip-10-0-0-1", null],
        [otherProjectId, "k8s.pod/WB1500KSK04-0000", "WB1500KSK04-0000"],
      ] as Array<[ObjectID, string, string | null]>) {
        await harness.insert("InventoryItem", {
          _id: ObjectID.generate(),
          version: 1,
          projectId: inProject,
          entityType: entityKey.startsWith("k8s.node") ? "k8s.node" : "k8s.pod",
          entityKey: entityKey,
          displayName: displayName,
        });
      }

      await harness.analyze("Service");
      await harness.analyze("InventoryItem");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the step's old read never had the late pod: the first 10,000 by name", async () => {
      const read: ListedPage = await harness.list({
        path: "/inventory-item",
        query: { projectId: projectId },
        select: { _id: true, entityKey: true, displayName: true },
        sort: { displayName: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "entityKey")).not.toContain(
        "k8s.pod/WB1500KSK02-7d9f",
      );
    });

    test("Filter by Infrastructure Entity finds the late pod by its name, with its key and type", async () => {
      const page: ListedPage = await search({
        picker: INFRASTRUCTURE_ENTITY_PICKER,
        path: "/inventory-item",
        text: "WB1500KSK0",
      });

      expect(valuesOf(page, "entityKey")).toEqual(["k8s.pod/WB1500KSK02-7d9f"]);
      expect(valuesOf(page, "entityType")).toEqual(["k8s.pod"]);
    });

    test("Filter by Infrastructure Entity finds a node with no name by its key", async () => {
      expect(
        valuesOf(
          await search({
            picker: INFRASTRUCTURE_ENTITY_PICKER,
            path: "/inventory-item",
            text: "ip-10-0",
          }),
          "entityKey",
        ),
      ).toEqual(["k8s.node/ip-10-0-0-1"]);
    });

    test("never another project's", async () => {
      expect(
        valuesOf(
          await search({
            picker: INFRASTRUCTURE_ENTITY_PICKER,
            path: "/inventory-item",
            text: "WB1500KSK04",
          }),
          "entityKey",
        ),
      ).toEqual([]);
    });

    test("what a step holds is read by its keys: the late pod named, one gone not there", async () => {
      const read: ListedPage = await harness.list({
        path: "/inventory-item",
        query: {
          entityKey: new Includes([
            "k8s.pod/WB1500KSK02-7d9f",
            "k8s.pod/gone-0000",
            "k8s.pod/WB1500KSK04-0000",
          ]),
        },
        select: { _id: true, entityKey: true, displayName: true },
        sort: {},
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(valuesOf(read, "displayName")).toEqual(["WB1500KSK02-7d9f"]);
    });

    test("Filter by Service finds the late service, and names it by its id", async () => {
      expect(
        valuesOf(
          await search({
            picker: TELEMETRY_SERVICE_PICKER,
            path: "/service",
            text: "WB-check",
          }),
          "name",
        ),
      ).toEqual(["WB-checkout"]);

      const read: ListedPage = await harness.list({
        path: "/service",
        query: { _id: new Includes([lateServiceId]) },
        select: { _id: true, name: true },
        sort: {},
        limit: 1,
        userId: memberId,
        projectId: projectId,
      });

      expect(valuesOf(read, "name")).toEqual(["WB-checkout"]);
    });
  },
);

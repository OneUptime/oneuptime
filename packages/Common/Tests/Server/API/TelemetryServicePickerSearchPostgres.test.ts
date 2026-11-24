import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import RumApplicationService, {
  Service as RumApplicationServiceType,
} from "../../../Server/Services/RumApplicationService";
import ServiceService, {
  Service as ServiceServiceType,
} from "../../../Server/Services/ServiceService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { withSearchIn } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import RecordsById from "../../../UI/Utils/RecordsById";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  TELEMETRY_SCOPE_SERVICE_SELECT,
  readTelemetryScopeHeldOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryServiceScope";
import { TELEMETRY_ROW_SERVICE_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryServicesOnPage";
import { LLM_APP_NAME_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/useLlmServiceNames";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE TELEMETRY SERVICE PICKERS, SEARCHED AND READ BY ID THROUGH THE REAL
 * SERVER (#10764).
 *
 * The Metrics and Traces Insights tabs' service scope, the Traces and
 * Profiles lists' Service filter and the AI conversations' App filter each
 * read the project's first 10,000 services by name, to offer them and to
 * name what they held and what their telemetry came from. A service past
 * them - "WB-kiosk-api" in a project of 10,050 named before it - could not
 * be picked, and was named by none of them. They search the server now (an
 * EntityDropdown over Service, 50 by name, archived services offered with
 * their switch), and read what they hold, and what the page's telemetry
 * names, by id: the list routes the app registers, as a member - one
 * limited to a label too, since a Service is guarded by its labels - on
 * migrated Postgres (PostgresListRouteHarness). The dashboard's own read
 * code runs through them (routeModelAPIReads).
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

const SERVICES_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "the telemetry service pickers, searched and read by id through the real server (#10764)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "telemetry_service_pickers",
      tables: ["Service", "ServiceLabel", "RumApplication"],
    });

    // The list routes, as the app registers them.
    new BaseAPI<Service, ServiceServiceType>(Service, ServiceService);
    new BaseAPI<RumApplication, RumApplicationServiceType>(
      RumApplication,
      RumApplicationService,
    );

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();

    const lateServiceId: ObjectID = ObjectID.generate();
    const otherLateServiceId: ObjectID = ObjectID.generate();
    const archivedServiceId: ObjectID = ObjectID.generate();
    const otherProjectServiceId: ObjectID = ObjectID.generate();
    const rumApplicationId: ObjectID = ObjectID.generate();
    // Never inserted: a service a scope or a filter holds, deleted since.
    const deletedServiceId: ObjectID = ObjectID.generate();

    const insertService: (data: {
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
      await harness.insert("Service", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `service-${data.id.toString()}`,
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await harness.insert("ServiceLabel", {
          serviceId: data.id,
          labelId: data.labelId,
        });
      }
    };

    /*
     * A search typed into the scope picker, a list's Service filter or the
     * App filter, as EntityDropdown sends it: a list's filter, so archived
     * services are offered (listsArchivedValues), each read with its archive
     * switch (marksArchivedRecords) and its colour (the dot it draws).
     */
    const search: (data: {
      text: string;
      asUserId?: ObjectID | undefined;
    }) => Promise<ListedPage<Service>> = async (data: {
      text: string;
      asUserId?: ObjectID | undefined;
    }): Promise<ListedPage<Service>> => {
      return await harness.list<Service>({
        path: "/service",
        query: withSearchIn({}, ["name"], data.text),
        select: {
          _id: true,
          name: true,
          serviceColor: true,
          isArchived: true,
        },
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

      // More services than any picker ever read, all named before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Service" ("_id", "version", "projectId", "name", "slug", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'service-' || gen_random_uuid(), false
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), SERVICES_BEFORE_WB],
      );

      await insertService({
        id: lateServiceId,
        name: "WB-kiosk-api",
        labelId: kioskLabelId,
      });
      await insertService({ id: otherLateServiceId, name: "WB-kiosk-web" });
      await insertService({
        id: archivedServiceId,
        name: "WB-kiosk-legacy",
        isArchived: true,
        labelId: kioskLabelId,
      });
      await insertService({
        id: otherProjectServiceId,
        name: "WB-kiosk-other",
        inProject: otherProjectId,
      });

      // A RUM application, whose telemetry a scope can be handed.
      await harness.insert("RumApplication", {
        _id: rumApplicationId,
        version: 1,
        projectId: projectId,
        name: "checkout-web",
        slug: `rum-${rumApplicationId.toString()}`,
        appIdentifier: "checkout-web",
      });

      await harness.analyze("Service");
    }, 600000);

    beforeEach(() => {
      TelemetryEntityNameResolver.clearCache();
    });

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the pickers' old read never had WB-kiosk-api: the first 10,000 by name", async () => {
      const read: ListedPage<Service> = await harness.list<Service>({
        path: "/service",
        query: { projectId: projectId },
        select: { _id: true, name: true, serviceColor: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "name")).not.toContain("WB-kiosk-api");
    });

    test("a search finds WB-kiosk-api past the 10,000th by name, and offers an archived service with its switch", async () => {
      const page: ListedPage<Service> = await search({ text: "WB-kiosk" });

      expect(valuesOf(page, "name")).toEqual([
        "WB-kiosk-api",
        "WB-kiosk-legacy",
        "WB-kiosk-web",
      ]);
      expect(valuesOf(page, "isArchived")).toEqual(["false", "true", "false"]);
      expect(page.count).toBe(3);
    });

    test("an archived service stays findable: a list's filter keeps no archive condition", () => {
      // What the pickers search within: the caller's query, never narrowed.
      expect(ArchivedValuePicker.getPickerQuery(Service, {})).toEqual({});
    });

    test("with nothing typed, lists 50 by name and counts every service of the project", async () => {
      const page: ListedPage<Service> = await search({ text: "" });

      expect(page.rows).toHaveLength(PICKER_PAGE_SIZE);
      expect(page.count).toBe(SERVICES_BEFORE_WB + 3);
    });

    test("never another project's service", async () => {
      expect(
        valuesOf(await search({ text: "WB-kiosk-other" }), "name"),
      ).toEqual([]);
    });

    test("a member limited to a label finds only that label's services", async () => {
      expect(
        valuesOf(
          await search({ text: "WB-kiosk", asUserId: kioskMemberId }),
          "name",
        ),
      ).toEqual(["WB-kiosk-api", "WB-kiosk-legacy"]);
    });

    test("what an Insights scope holds is named by its ids: a service past the 10,000th, an archived one marked, a RUM application by its own table, the telemetry that named no service, and one gone", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const named: Map<string, DropdownOption> =
        await readTelemetryScopeHeldOptions({
          ids: [
            lateServiceId.toString(),
            archivedServiceId.toString(),
            rumApplicationId.toString(),
            projectId.toString(),
            deletedServiceId.toString(),
            otherProjectServiceId.toString(),
          ],
          projectId: projectId.toString(),
        });

      const read: (id: ObjectID) => DropdownOption | undefined = (
        id: ObjectID,
      ): DropdownOption | undefined => {
        return named.get(id.toString().toLowerCase());
      };

      expect(read(lateServiceId)).toMatchObject({
        label: "WB-kiosk-api",
        isUserContent: true,
      });
      expect(read(lateServiceId)!.isArchived).toBeUndefined();
      expect(read(archivedServiceId)).toMatchObject({
        label: "WB-kiosk-legacy",
        isArchived: true,
      });
      // Named by its own table, never read as gone.
      expect(read(rumApplicationId)).toMatchObject({
        label: "checkout-web",
        isUserContent: true,
      });
      expect(read(rumApplicationId)!.isNotFound).toBeUndefined();
      // The project's own id: the stand-in, in the reader's words.
      expect(read(projectId)).toMatchObject({
        label: "Unknown Service",
        isUserContent: false,
      });
      // Deleted since, and another project's: no longer available.
      expect(read(deletedServiceId)!.isNotFound).toBe(true);
      expect(read(otherProjectServiceId)!.isNotFound).toBe(true);

      // The Service table first, by the ids it holds: never by name.
      expect(reads[0]!.path).toBe("/service");
      expect(reads[0]!.query["_id"]).toBeInstanceOf(Includes);
      expect(reads[0]!.limit).toBe(5);
      expect(reads[0]!.select).toMatchObject(
        TELEMETRY_SCOPE_SERVICE_SELECT as Record<string, unknown>,
      );

      // Then the other telemetry tables, for the ids no service answered.
      const rumRead: ListRequest | undefined = reads.find(
        (request: ListRequest): boolean => {
          return request.path === "/rum-application";
        },
      );

      expect(rumRead).toBeDefined();
      expect(
        ((rumRead!.query["_id"] as Includes).values as Array<string>).map(
          (id: string): string => {
            return id.toString().toLowerCase();
          },
        ),
      ).not.toContain(lateServiceId.toString().toLowerCase());
    });

    test("the services a page's telemetry names are read by those ids: the cards, the health table's rows and the lists' rows", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const services: Array<Service> = await RecordsById.read<Service>({
        modelType: Service,
        ids: [
          lateServiceId.toString(),
          otherLateServiceId.toString(),
          deletedServiceId.toString(),
          otherProjectServiceId.toString(),
        ],
        select: TELEMETRY_ROW_SERVICE_SELECT,
      });

      expect(
        services
          .map((service: Service): string => {
            return service.name || "";
          })
          .sort(),
      ).toEqual(["WB-kiosk-api", "WB-kiosk-web"]);

      // One read, of the ids held: never the project's services whole.
      expect(reads).toHaveLength(1);
      expect(reads[0]!.limit).toBe(4);
    });

    test("a member limited to a label reads by id only that label's services", async () => {
      harness.routeModelAPIReads({
        userId: kioskMemberId,
        projectId: projectId,
      });

      const services: Array<Service> = await RecordsById.read<Service>({
        modelType: Service,
        ids: [lateServiceId.toString(), otherLateServiceId.toString()],
        select: TELEMETRY_ROW_SERVICE_SELECT,
      });

      expect(
        services.map((service: Service): string => {
          return service.name || "";
        }),
      ).toEqual(["WB-kiosk-api"]);
    });

    test("the Metrics tab counts the project's services on the server: one row and the count", async () => {
      const read: ListedPage<Service> = await harness.list<Service>({
        path: "/service",
        query: { projectId: projectId },
        select: { _id: true },
        sort: {},
        limit: 1,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(1);
      // Every one, archived too, past the 10,000th: the quiet services' population.
      expect(read.count).toBe(SERVICES_BEFORE_WB + 3);

      const kioskRead: ListedPage<Service> = await harness.list<Service>({
        path: "/service",
        query: { projectId: projectId },
        select: { _id: true },
        sort: {},
        limit: 1,
        userId: kioskMemberId,
        projectId: projectId,
      });

      // A member limited to a label counts the services they can read.
      expect(kioskRead.count).toBe(2);
    });

    test("a list's Service filter names what it holds by its ids, with its archive switch, its colour and the labels that guard it", async () => {
      const read: ListedPage<Service> = await harness.list<Service>({
        path: "/service",
        query: {
          _id: new Includes([
            lateServiceId,
            archivedServiceId,
            deletedServiceId,
          ]),
        },
        // As BaseModelTable reads a held filter value (getEntityFilterSelect).
        select: {
          name: true,
          _id: true,
          serviceColor: true,
          isArchived: true,
          labels: { _id: true, name: true, color: true },
        },
        sort: {},
        limit: 3,
        userId: memberId,
        projectId: projectId,
      });

      expect(valuesOf(read, "name").sort()).toEqual([
        "WB-kiosk-api",
        "WB-kiosk-legacy",
      ]);

      const legacy: Service | undefined = read.rows.find(
        (service: Service): boolean => {
          return service.name === "WB-kiosk-legacy";
        },
      );

      expect(legacy!.isArchived).toBe(true);
      expect(
        (legacy!.labels || []).map((label: { name?: string }): string => {
          return label.name || "";
        }),
      ).toEqual(["SubCategory: Kiosk"]);
    });

    test("the AI conversations name their apps by the ids the rows hold, and the App filter its held app", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const apps: Array<Service> = await RecordsById.read<Service>({
        modelType: Service,
        ids: [lateServiceId.toString(), deletedServiceId.toString()],
        select: LLM_APP_NAME_SELECT,
      });

      expect(
        apps.map((app: Service): string => {
          return app.name || "";
        }),
      ).toEqual(["WB-kiosk-api"]);
      expect(reads[0]!.limit).toBe(2);
      expect(reads[0]!.query["_id"]).toBeInstanceOf(Includes);
    });
  },
);

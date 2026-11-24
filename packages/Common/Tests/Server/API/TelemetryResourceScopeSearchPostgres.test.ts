import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import HostService, {
  Service as HostServiceType,
} from "../../../Server/Services/HostService";
import RumApplicationService, {
  Service as RumApplicationServiceType,
} from "../../../Server/Services/RumApplicationService";
import ServiceService, {
  Service as ServiceServiceType,
} from "../../../Server/Services/ServiceService";
import Host from "../../../Models/DatabaseModels/Host";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SERVICE_SCOPE_FACET_KEY,
  TELEMETRY_SCOPE_SEARCH_PAGE_SIZE,
  readTelemetryResourceScopeHeldOptions,
  searchTelemetryScope,
  toTelemetryScopeKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryResourceScope";
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
 * LOGS > INSIGHTS' SCOPE, SEARCHED AND READ BY ID THROUGH THE REAL SERVER
 * (#10921).
 *
 * "All services and hosts" offered the window's first 200 of each kind and
 * named them from the project's first 10,000 services by name: a service
 * or a host past them - "WB-kiosk-api", "WB-kiosk-host" in a project of
 * 10,050 of each named before them - could not be found, picked or named.
 * The picker searches the services and every kind of resource the page's
 * logs list on the server now (TelemetryResourceScope.searchTelemetryScope:
 * each kind by its name and identifier, 50 a kind, archived ones offered
 * with their switch), and names what its scope holds by its ids
 * (readTelemetryResourceScopeHeldOptions). Here the dashboard's own read
 * code runs through the list routes the app registers, as a member - one
 * limited to a label too - on migrated Postgres (PostgresListRouteHarness,
 * routeModelAPIReads).
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
const HOSTS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

describePostgres(
  "Logs Insights' scope, searched and read by id through the real server (#10921)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "telemetry_resource_scope",
      tables: [
        "Service",
        "ServiceLabel",
        "Host",
        "HostLabel",
        "RumApplication",
      ],
    });

    // The list routes, as the app registers them.
    new BaseAPI<Service, ServiceServiceType>(Service, ServiceService);
    new BaseAPI<Host, HostServiceType>(Host, HostService);
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
    const archivedServiceId: ObjectID = ObjectID.generate();
    const lateHostId: ObjectID = ObjectID.generate();
    const archivedHostId: ObjectID = ObjectID.generate();
    const namelessHostId: ObjectID = ObjectID.generate();
    const otherProjectHostId: ObjectID = ObjectID.generate();
    const rumApplicationId: ObjectID = ObjectID.generate();
    // Never inserted: a service and a host a scope holds, deleted since.
    const deletedServiceId: ObjectID = ObjectID.generate();
    const deletedHostId: ObjectID = ObjectID.generate();

    const insertService: (data: {
      id: ObjectID;
      name: string;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      await harness.insert("Service", {
        _id: data.id,
        version: 1,
        projectId: projectId,
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

    const insertHost: (data: {
      id: ObjectID;
      name: string;
      hostIdentifier: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      hostIdentifier: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      await harness.insert("Host", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `host-${data.id.toString()}`,
        hostIdentifier: data.hostIdentifier,
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await harness.insert("HostLabel", {
          hostId: data.id,
          labelId: data.labelId,
        });
      }
    };

    const recordNames: (records: Array<Service>) => Array<string> = (
      records: Array<Service>,
    ): Array<string> => {
      return records.map((record: Service): string => {
        return `${record.name}|${String(record._id).split(":")[0]}${
          (record as unknown as Record<string, unknown>)["isArchived"] === true
            ? "|archived"
            : ""
        }`;
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

      // More services and hosts than any picker ever read, all before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Service" ("_id", "version", "projectId", "name", "slug", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'service-' || gen_random_uuid(), false
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), SERVICES_BEFORE_WB],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."Host" ("_id", "version", "projectId", "name", "slug", "hostIdentifier", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AH' || lpad(i::text, 6, '0'), 'host-' || gen_random_uuid(), 'ah' || lpad(i::text, 6, '0') || '.internal', false
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), HOSTS_BEFORE_WB],
      );

      await insertService({
        id: lateServiceId,
        name: "WB-kiosk-api",
        labelId: kioskLabelId,
      });
      await insertService({
        id: archivedServiceId,
        name: "WB-kiosk-legacy",
        isArchived: true,
      });
      await insertHost({
        id: lateHostId,
        name: "WB-kiosk-host",
        hostIdentifier: "kiosk-01.internal",
        labelId: kioskLabelId,
      });
      await insertHost({
        id: archivedHostId,
        name: "WB-kiosk-old-host",
        hostIdentifier: "kiosk-00.internal",
        isArchived: true,
      });
      // Its agent never named it: found and named by its identifier.
      await insertHost({
        id: namelessHostId,
        name: "",
        hostIdentifier: "wb-kiosk-edge-7",
      });
      await insertHost({
        id: otherProjectHostId,
        name: "WB-kiosk-other-host",
        hostIdentifier: "kiosk-99.internal",
        inProject: otherProjectId,
      });

      // A RUM application, whose logs name it as their own entity.
      await harness.insert("RumApplication", {
        _id: rumApplicationId,
        version: 1,
        projectId: projectId,
        name: "checkout-web",
        slug: `rum-${rumApplicationId.toString()}`,
        appIdentifier: "checkout-web",
      });

      await harness.analyze("Service");
      await harness.analyze("Host");
    }, 600000);

    beforeEach(() => {
      TelemetryEntityNameResolver.clearCache();
      /*
       * A project member reads a service's and a host's archive switch
       * (their read permissions are the tables'), as the browser's
       * permission snapshot says once it lands.
       */
      jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(true);
    });

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the picker's old reads never had WB-kiosk-host: the first 10,000 hosts by name, as the explorers read them", async () => {
      const read: ListedPage<Host> = await harness.list<Host>({
        path: "/host",
        query: { projectId: projectId },
        select: { _id: true, name: true, hostIdentifier: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "name")).not.toContain("WB-kiosk-host");
    });

    test("one search finds services and hosts past their 10,000th - a host by its identifier too - archived ones with their switch, a page of each kind", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const found: { records: Array<Service>; count: number } =
        await searchTelemetryScope({
          kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
          searchText: "kiosk",
        });

      expect(recordNames(found.records)).toEqual([
        "WB-kiosk-api|primaryEntityId",
        "WB-kiosk-legacy|primaryEntityId|archived",
        // No name: found by its identifier, named by it, listed first.
        "wb-kiosk-edge-7|hostId",
        "WB-kiosk-host|hostId",
        "WB-kiosk-old-host|hostId|archived",
      ]);
      expect(found.count).toBe(5);

      // Each kind once, a page of each, by its own route.
      expect(
        reads.map((request: ListRequest): string => {
          return `${request.path}|${request.limit}`;
        }),
      ).toEqual([
        `/service|${TELEMETRY_SCOPE_SEARCH_PAGE_SIZE}`,
        `/host|${TELEMETRY_SCOPE_SEARCH_PAGE_SIZE}`,
      ]);
      expect(
        Object.values(reads[1]!.query).some((value: unknown): boolean => {
          return value instanceof MultiSearch;
        }),
      ).toBe(true);
    });

    test("with nothing typed, a fair share of 50 for each kind, and every record of both counted", async () => {
      harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

      const found: { records: Array<Service>; count: number } =
        await searchTelemetryScope({
          kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
          searchText: "",
        });

      expect(found.records).toHaveLength(TELEMETRY_SCOPE_SEARCH_PAGE_SIZE);
      expect(
        found.records.filter((record: Service): boolean => {
          return String(record._id).startsWith("hostId:");
        }),
      ).toHaveLength(TELEMETRY_SCOPE_SEARCH_PAGE_SIZE / 2);
      expect(found.count).toBe(SERVICES_BEFORE_WB + 2 + (HOSTS_BEFORE_WB + 3));
    });

    test("never another project's host", async () => {
      harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

      const found: { records: Array<Service>; count: number } =
        await searchTelemetryScope({
          kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
          searchText: "WB-kiosk-other",
        });

      expect(found.records).toEqual([]);
    });

    test("a member limited to a label finds only that label's services and hosts", async () => {
      harness.routeModelAPIReads({
        userId: kioskMemberId,
        projectId: projectId,
      });

      const found: { records: Array<Service>; count: number } =
        await searchTelemetryScope({
          kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
          searchText: "kiosk",
        });

      expect(recordNames(found.records)).toEqual([
        "WB-kiosk-api|primaryEntityId",
        "WB-kiosk-host|hostId",
      ]);
    });

    test("what the scope holds is named by its ids: a service and a host past their 10,000th, archived ones marked, a RUM application by its own table, the logs that named no service, and the ones gone", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const values: Array<string> = [
        `primaryEntityId:${lateServiceId.toString()}`,
        `primaryEntityId:${archivedServiceId.toString()}`,
        `primaryEntityId:${rumApplicationId.toString()}`,
        `primaryEntityId:${projectId.toString()}`,
        `primaryEntityId:${deletedServiceId.toString()}`,
        `hostId:${lateHostId.toString()}`,
        `hostId:${archivedHostId.toString()}`,
        `hostId:${namelessHostId.toString()}`,
        `hostId:${deletedHostId.toString()}`,
        `hostId:${otherProjectHostId.toString()}`,
      ];

      const named: Map<string, DropdownOption> =
        await readTelemetryResourceScopeHeldOptions({
          values: values,
          projectId: projectId.toString(),
        });

      const read: (value: string) => DropdownOption = (
        value: string,
      ): DropdownOption => {
        return named.get(toTelemetryScopeKey(value))!;
      };

      expect(read(values[0]!)).toMatchObject({ label: "WB-kiosk-api" });
      expect(read(values[0]!).isArchived).toBeUndefined();
      expect(read(values[1]!)).toMatchObject({
        label: "WB-kiosk-legacy",
        isArchived: true,
      });
      expect(read(values[2]!)).toMatchObject({ label: "checkout-web" });
      expect(read(values[2]!).isNotFound).toBeUndefined();
      expect(read(values[3]!)).toMatchObject({
        label: "Unknown Service",
        isUserContent: false,
      });
      expect(read(values[4]!).isNotFound).toBe(true);

      expect(read(values[5]!)).toEqual({
        value: values[5],
        label: "WB-kiosk-host",
        isUserContent: true,
      });
      expect(read(values[6]!)).toMatchObject({
        label: "WB-kiosk-old-host",
        isArchived: true,
      });
      expect(read(values[7]!)).toMatchObject({ label: "wb-kiosk-edge-7" });
      // Deleted since, and another project's: no longer available.
      expect(read(values[8]!).isNotFound).toBe(true);
      expect(read(values[9]!).isNotFound).toBe(true);

      /*
       * Hosts by the ids the scope holds, with their switch, in one read;
       * the only other read of hosts is the resolver's, by the one id no
       * service answered (the RUM application's). Never a list.
       */
      const hostReads: Array<ListRequest> = reads.filter(
        (request: ListRequest): boolean => {
          return request.path === "/host";
        },
      );

      for (const request of hostReads) {
        expect(request.query["_id"]).toBeInstanceOf(Includes);
        expect(request.limit).toBeLessThanOrEqual(5);
      }

      const scopeRead: ListRequest | undefined = hostReads.find(
        (request: ListRequest): boolean => {
          return request.select["isArchived"] === true;
        },
      );

      expect(scopeRead).toBeDefined();
      expect((scopeRead!.query["_id"] as Includes).values).toHaveLength(5);
      expect(hostReads.length).toBeLessThanOrEqual(2);
    });
  },
);

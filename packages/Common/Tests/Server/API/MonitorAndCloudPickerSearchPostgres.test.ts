import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import HostAPI from "../../../Server/API/HostAPI";
import OnCallDutyPolicyAPI from "../../../Server/API/OnCallDutyPolicyAPI";
import OpenStackResourceAPI from "../../../Server/API/OpenStackResourceAPI";
import MetricTypeService, {
  Service as MetricTypeServiceType,
} from "../../../Server/Services/MetricTypeService";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import Permission from "../../../Types/Permission";
import {
  withSearch,
  withSearchIn,
} from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import RecordsById from "../../../UI/Utils/RecordsById";
import { getOpenStackProjectPicker } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProjectPicker";
import MetricTypeSearch from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricTypeSearch";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A MONITOR'S ON-CALL POLICIES, AN OPENSTACK CLOUD'S PROJECTS, AN
 * INFRASTRUCTURE MONITOR'S HOST AND A METRIC QUERY'S METRIC, SEARCHED AND
 * READ THROUGH THE REAL SERVER (#10646).
 *
 * Each picker offered a list read when its form opened - the first 10,000
 * policies, hosts or metric names by name, or the first 500 to 1,000 of a
 * cloud's projects - and a record past it could not be picked, and showed
 * as nothing (or was dropped) when a form held it. Each searches the server
 * now, within its own rules, and reads what it holds by its value: the list
 * routes the app registers, as a member, on migrated Postgres
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

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "monitor and cloud pickers, searched and read through the real server (#10646)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "monitor_cloud_pickers",
      tables: ["OnCallDutyPolicy", "OpenStackResource", "Host", "MetricType"],
    });

    // The list routes, as the app registers them.
    new OnCallDutyPolicyAPI();
    new OpenStackResourceAPI();
    new HostAPI();
    new BaseAPI<MetricType, MetricTypeServiceType>(
      MetricType,
      MetricTypeService,
    );

    const projectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const cloudId: ObjectID = ObjectID.generate();
    const otherCloudId: ObjectID = ObjectID.generate();
    const latePolicyId: ObjectID = ObjectID.generate();

    const list: (request: {
      path: string;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort?: Record<string, unknown> | undefined;
      limit: number;
    }) => Promise<ListedPage> = async (request: {
      path: string;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort?: Record<string, unknown> | undefined;
      limit: number;
    }): Promise<ListedPage> => {
      return await harness.list({
        ...request,
        userId: memberId,
        projectId: projectId,
      });
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");
      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      // More of each than the pickers ever read, all named before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'policy-' || gen_random_uuid()
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), BEFORE_WB],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."OpenStackResource" ("_id", "version", "projectId", "openStackCloudId", "kind", "externalId", "name", "lastSeenAt")
         SELECT gen_random_uuid(), 1, $1, $2, $3, 'ext-' || i, 'AP' || lpad(i::text, 6, '0'), now()
         FROM generate_series(1, 1050) AS i`,
        [
          projectId.toString(),
          cloudId.toString(),
          OpenStackResourceKind.Project,
        ],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."Host" ("_id", "version", "projectId", "name", "slug", "hostIdentifier", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'host-' || gen_random_uuid(), 'host-AP' || lpad(i::text, 6, '0'), false
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), BEFORE_WB],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."MetricType" ("_id", "version", "projectId", "name")
         SELECT gen_random_uuid(), 1, $1, 'k8s.a' || lpad(i::text, 6, '0')
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), BEFORE_WB],
      );

      await harness.insert("OnCallDutyPolicy", {
        _id: latePolicyId,
        version: 1,
        projectId: projectId,
        name: "WB Payments Escalation",
        slug: `policy-${latePolicyId.toString()}`,
      });

      for (const [inCloud, kind, externalId, name] of [
        [cloudId, OpenStackResourceKind.Project, "6b0c3e7f", "WB-payments"],
        [otherCloudId, OpenStackResourceKind.Project, "other", "WB-other"],
        [cloudId, OpenStackResourceKind.Hypervisor, "hv-1", "WB-hypervisor"],
      ] as Array<[ObjectID, string, string, string]>) {
        await harness.insert("OpenStackResource", {
          _id: ObjectID.generate(),
          version: 1,
          projectId: projectId,
          openStackCloudId: inCloud,
          kind: kind,
          externalId: externalId,
          name: name,
          lastSeenAt: new Date(),
        });
      }

      for (const [identifier, name, isArchived] of [
        ["host-WB1500KSK02", "WB1500KSK02", false],
        ["host-WB-retired", "WB-retired", true],
      ] as Array<[string, string, boolean]>) {
        const id: ObjectID = ObjectID.generate();

        await harness.insert("Host", {
          _id: id,
          version: 1,
          projectId: projectId,
          name: name,
          slug: `host-${id.toString()}`,
          hostIdentifier: identifier,
          isArchived: isArchived,
        });
      }

      await harness.insert("MetricType", {
        _id: ObjectID.generate(),
        version: 1,
        projectId: projectId,
        name: "k8s.pod.WB.network.io",
        unit: "By",
      });

      for (const table of [
        "OnCallDutyPolicy",
        "OpenStackResource",
        "Host",
        "MetricType",
      ]) {
        await harness.analyze(table);
      }
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    describe("a monitor criteria's on-call policies", () => {
      test("the old read never had the late policy; the picker's search finds it, and a read by id names it", async () => {
        const old: ListedPage = await list({
          path: "/on-call-duty-policy",
          query: { projectId: projectId },
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
        });

        expect(valuesOf(old, "name")).not.toContain("WB Payments Escalation");

        const search: ListedPage = await list({
          path: "/on-call-duty-policy",
          query: withSearch(
            ArchivedValuePicker.getPickerQuery(OnCallDutyPolicy, {}),
            "name",
            "WB Pay",
          ),
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: PICKER_PAGE_SIZE,
        });

        expect(valuesOf(search, "name")).toEqual(["WB Payments Escalation"]);

        const held: ListedPage = await list({
          path: "/on-call-duty-policy",
          query: { _id: new Includes([latePolicyId]) },
          select: { _id: true, name: true },
          limit: 1,
        });

        expect(valuesOf(held, "name")).toEqual(["WB Payments Escalation"]);
      });
    });

    describe("an OpenStack cloud's projects", () => {
      test("the picker finds a project past the 1,000th by name or by its id, only the cloud's, only projects", async () => {
        const picker: ReturnType<typeof getOpenStackProjectPicker> =
          getOpenStackProjectPicker(cloudId);

        const search: (text: string) => Promise<ListedPage> = async (
          text: string,
        ): Promise<ListedPage> => {
          return await list({
            path: "/openstack-resource",
            query: withSearchIn(picker.query || {}, picker.searchFields!, text),
            select: { _id: true, name: true, externalId: true },
            sort: { name: SortOrder.Ascending },
            limit: PICKER_PAGE_SIZE,
          });
        };

        expect(valuesOf(await search("WB-"), "externalId")).toEqual([
          "6b0c3e7f",
        ]);
        expect(valuesOf(await search("6b0c3e"), "name")).toEqual([
          "WB-payments",
        ]);
      });

      test("what a budget holds is read by the cloud's id for it, within the cloud", async () => {
        const reads: Array<ListRequest> = harness.routeModelAPIReads({
          userId: memberId,
          projectId: projectId,
        });

        const projects: Array<OpenStackResource> =
          await RecordsById.read<OpenStackResource>({
            modelType: OpenStackResource,
            ids: ["6b0c3e7f", "other", "gone"],
            column: "externalId",
            query: getOpenStackProjectPicker(cloudId).heldValueQuery as never,
            select: { name: true, externalId: true },
          });

        expect(
          projects.map((project: OpenStackResource): string => {
            return project.name || "";
          }),
        ).toEqual(["WB-payments"]);
        expect(reads).toHaveLength(1);
      });
    });

    describe("an infrastructure monitor's host", () => {
      test("the field's search finds the late host by name or identifier, never an archived one", async () => {
        const search: (text: string) => Promise<ListedPage> = async (
          text: string,
        ): Promise<ListedPage> => {
          return await list({
            path: "/host",
            query: withSearchIn(
              { isArchived: false },
              ["name", "hostIdentifier"],
              text,
            ),
            select: { _id: true, name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
            limit: PICKER_PAGE_SIZE,
          });
        };

        expect(valuesOf(await search("WB"), "hostIdentifier")).toEqual([
          "host-WB1500KSK02",
        ]);
        expect(valuesOf(await search("host-WB15"), "name")).toEqual([
          "WB1500KSK02",
        ]);
      });

      test("the host a step watches is read by its identifier, an archived one too", async () => {
        const held: ListedPage = await list({
          path: "/host",
          query: {
            hostIdentifier: new Includes(["host-WB-retired", "host-gone"]),
          },
          select: { _id: true, name: true, isArchived: true },
          limit: LIMIT_PER_PROJECT,
        });

        expect(valuesOf(held, "name")).toEqual(["WB-retired"]);
        expect(valuesOf(held, "isArchived")).toEqual(["true"]);
      });
    });

    describe("a metric query's metric", () => {
      test("the picker's search finds a metric name past the 10,000th, and the one a query holds is read by its name", async () => {
        harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

        expect(
          (await MetricTypeSearch.search(".WB.")).map(
            (metric: MetricType): string => {
              return metric.name || "";
            },
          ),
        ).toEqual(["k8s.pod.WB.network.io"]);
        expect(
          (await MetricTypeSearch.readByName("k8s.pod.WB.network.io"))?.unit,
        ).toBe("By");
      });

      /*
       * #10691: the Metrics explorer and a dashboard read the project's
       * first 10,000 metric types by name, and named a charted one past
       * them by nothing: no unit, no kind of counter.
       */
      test("the metrics a page charts are read by their names, past the 10,000th, in one read", async () => {
        const reads: Array<ListRequest> = harness.routeModelAPIReads({
          userId: memberId,
          projectId: projectId,
        });

        const read: Array<MetricType> = await MetricTypeSearch.readByNames([
          "k8s.pod.WB.network.io",
          "k8s.a000001",
          "a.metric.nobody.sends",
        ]);

        expect(
          read
            .map((metric: MetricType): string => {
              return `${metric.name}:${metric.unit || ""}`;
            })
            .sort(),
        ).toEqual(["k8s.a000001:", "k8s.pod.WB.network.io:By"]);
        expect(reads).toHaveLength(1);
      });
    });
  },
);

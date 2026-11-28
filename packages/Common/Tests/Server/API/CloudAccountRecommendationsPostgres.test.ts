import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import RecommendationDismissalService from "../../../Server/Services/RecommendationDismissalService";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { MonitorRecommendationResourceType } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  CloudAccountRecommendationCoverage,
  CloudAccountRecommendationResources,
  loadCloudAccountRecommendationCoverage,
  loadCloudAccountRecommendationResources,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountRecommendationData";
import CloudAccountRecommendationPlan, {
  CloudAccountRecommendationGroup,
  CloudAccountRecommendationRow,
  CloudAccountRecommendationTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountRecommendationPlan";
import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import { RecommendationStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
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
 * A CLOUD ACCOUNT'S RECOMMENDATIONS, READ FROM POSTGRES (#11210).
 *
 * The account's Recommendations tab and its menu's count read the
 * account's first 10,000 resources and the project's first 10,000
 * dismissals: an account with more resources offered the rest nothing,
 * and in a project with more dismissals a dismissed recommendation came
 * back as one to set up. The Dashboard's own loaders run here
 * (CloudAccountRecommendationData), every read they make answered by the
 * real list routes on migrated Postgres as a member of the project
 * (PostgresListRouteHarness.routeModelAPIReads): an account of 10,050 EC2
 * instances, and a project whose first 10,040 dismissals are another
 * account's. The old reads are made too, to show where they stopped.
 *
 * Which recommendations a monitor covers is the server's coverage query
 * (#11074), pinned on Postgres by MonitorRecommendationCoveragePostgres:
 * here no monitor covers any.
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

// More resources in the account than the page read.
const PAST_THE_CAP: number = 10_050;
// Another account's dismissals, more than the page read of the project's.
const OTHER_DISMISSALS: number = 10_040;

const ACCOUNT: string = "123456789012";
const OTHER_ACCOUNT: string = "999999999999";

const STATUS_CHECKS: string = "CloudResource:cloud-aws-ec2-status-check-failed";
const HIGH_CPU: string = "CloudResource:cloud-aws-ec2-high-cpu";

const nameOf: (n: number) => string = (n: number): string => {
  return `vm ${String(n).padStart(5, "0")}`;
};

describePostgres(
  "a cloud account's recommendations weigh every resource and every dismissal, on Postgres (#11210)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "cloud_account_recs",
      tables: ["CloudResource", "CloudConnection", "RecommendationDismissal"],
    });

    // The list routes, as the app registers them.
    new BaseAPI(
      CloudResource as { new (): BaseModel },
      CloudResourceService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      CloudConnection as { new (): BaseModel },
      CloudConnectionService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      RecommendationDismissal as { new (): BaseModel },
      RecommendationDismissalService as unknown as DatabaseService<BaseModel>,
    );

    const projectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    // A member who may read the account's resources, and no dismissals.
    const resourcesOnlyMemberId: ObjectID = ObjectID.generate();
    const connectionId: ObjectID = ObjectID.generate();

    // The account's first and last resources by name, by id.
    let firstResourceId: string = "";
    let lastResourceId: string = "";

    const accountQuery: Record<string, unknown> = {
      projectId: projectId,
      cloudProvider: "aws",
      cloudAccountId: new Includes([ACCOUNT]),
      isArchived: false,
      cloudResourceKind: CloudResourceKind.Resource,
    };

    const readAccount: () => Promise<CloudAccountRecommendationResources> =
      async (): Promise<CloudAccountRecommendationResources> => {
        return await loadCloudAccountRecommendationResources({
          projectId: projectId,
          provider: "aws",
          cloudAccountId: ACCOUNT,
        });
      };

    const targetOf: (
      groups: Array<CloudAccountRecommendationGroup>,
      recommendationId: string,
      name: string,
    ) => CloudAccountRecommendationTarget | undefined = (
      groups: Array<CloudAccountRecommendationGroup>,
      recommendationId: string,
      name: string,
    ): CloudAccountRecommendationTarget | undefined => {
      for (const group of groups) {
        const row: CloudAccountRecommendationRow | undefined = group.rows.find(
          (candidate: CloudAccountRecommendationRow): boolean => {
            return candidate.recommendationId === recommendationId;
          },
        );
        const target: CloudAccountRecommendationTarget | undefined =
          row?.targets.find((candidate: CloudAccountRecommendationTarget) => {
            return candidate.resource.resourceName === name;
          });

        if (target) {
          return target;
        }
      }

      return undefined;
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Cloud");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      await harness.insertMember({
        userId: resourcesOnlyMemberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadCloudResource,
      });

      await harness.insert("CloudConnection", {
        _id: connectionId,
        version: 1,
        projectId: projectId,
        name: "AWS production",
        provider: "aws",
        config: JSON.stringify({ readIntervalInMinutes: 5 }),
        // Kept encrypted, and never read here.
        secrets: "{}",
      });

      // The account's EC2 instances, each reporting its metrics.
      const insertInstances: (data: {
        account: string;
        prefix: string;
        count: number;
      }) => Promise<void> = async (data: {
        account: string;
        prefix: string;
        count: number;
      }): Promise<void> => {
        await harness.query(
          `INSERT INTO "${harness.schema}"."CloudResource" ("_id", "version", "projectId", "name", "slug", "resourceIdentifier", "cloudResourceKind", "isArchived", "cloudProvider", "cloudAccountId", "cloudRegion", "cloudResourceType", "cloudConnectionId", "telemetryAttributes", "cloudReadings", "cloudProperties")
           SELECT gen_random_uuid(), 1, $1, $2 || lpad(n::text, 5, '0'), $3 || '-' || n, 'arn:aws:ec2:us-east-1:' || $4 || ':instance/i-' || n, $5, false, 'aws', $4, 'us-east-1', 'AWS::EC2::Instance', $6,
             jsonb_build_object('Namespace', 'AWS/EC2', 'resource.cloud.account.id', $4::text, 'resource.cloud.region', 'us-east-1', 'Dimensions.InstanceId', 'i-' || n),
             '{}'::jsonb, '{}'::jsonb
           FROM generate_series(1, $7::int) AS n`,
          [
            projectId.toString(),
            data.prefix,
            data.prefix.trim(),
            data.account,
            CloudResourceKind.Resource,
            connectionId.toString(),
            data.count,
          ],
        );
      };

      await insertInstances({
        account: ACCOUNT,
        prefix: "vm ",
        count: PAST_THE_CAP,
      });
      await insertInstances({
        account: OTHER_ACCOUNT,
        prefix: "other vm ",
        count: 20,
      });

      const [first, last] = (await harness.query(
        `SELECT "_id" FROM "${harness.schema}"."CloudResource" WHERE "name" IN ($1, $2) ORDER BY "name"`,
        [nameOf(1), nameOf(PAST_THE_CAP)],
      )) as [{ _id: string }, { _id: string }];

      firstResourceId = first._id;
      lastResourceId = last._id;

      // The project's dismissals: another account's first, then this account's own.
      await harness.query(
        `INSERT INTO "${harness.schema}"."RecommendationDismissal" ("_id", "version", "projectId", "recommendationType", "resourceType", "resourceId", "recommendationId", "dismissalReason")
         SELECT gen_random_uuid(), 1, $1, 'Monitor', $2, r."_id", 'CloudResource:other-' || n, 'Not needed'
         FROM generate_series(1, $3::int) AS n
         JOIN (SELECT "_id", row_number() OVER (ORDER BY "name") AS position FROM "${harness.schema}"."CloudResource" WHERE "cloudAccountId" = $4) r
           ON r.position = (n % 20) + 1`,
        [
          projectId.toString(),
          MonitorRecommendationResourceType.CloudResource,
          OTHER_DISMISSALS,
          OTHER_ACCOUNT,
        ],
      );

      for (const [id, recommendationId] of [
        [firstResourceId, HIGH_CPU],
        [lastResourceId, STATUS_CHECKS],
      ] as Array<[string, string]>) {
        await harness.insert("RecommendationDismissal", {
          _id: ObjectID.generate(),
          version: 1,
          projectId: projectId,
          recommendationType: "Monitor",
          resourceType: MonitorRecommendationResourceType.CloudResource,
          resourceId: id,
          recommendationId: recommendationId,
          dismissalReason: "Not needed",
        });
      }

      await harness.analyze("CloudResource");
      await harness.analyze("RecommendationDismissal");
    }, 600_000);

    afterAll(async () => {
      await harness.tearDown();
    });

    let reads: Array<ListRequest> = [];

    beforeEach(() => {
      reads = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      // No monitor covers any recommendation here (#11074's own suite says which do).
      getJestSpyOn(
        MonitorRecommendationCoverageApi,
        "findCoveringMonitors",
      ).mockResolvedValue(new Map<string, ObjectID>() as never);
    });

    test(`the account's ${PAST_THE_CAP} resources, every one: where the old read stopped at the first 10,000`, async () => {
      // The old read: one page, the most the list route holds.
      const oldRead: ListedPage<CloudResource> = await harness.list({
        path: "/cloud-resource",
        query: accountQuery,
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(oldRead.count).toBe(PAST_THE_CAP);
      expect(oldRead.rows).toHaveLength(LIMIT_PER_PROJECT);

      const read: CloudAccountRecommendationResources = await readAccount();

      expect(read.resources).toHaveLength(PAST_THE_CAP);
      expect(
        new Set(
          read.resources.map((resource: { resourceId: string }): string => {
            return resource.resourceId;
          }),
        ).size,
      ).toBe(PAST_THE_CAP);
      // In name order, the last one past the old cap included.
      expect(read.resources[0]!.resourceName).toBe(nameOf(1));
      expect(read.resources[PAST_THE_CAP - 1]!.resourceName).toBe(
        nameOf(PAST_THE_CAP),
      );
      // Read with what decides its monitors: the metrics' attributes.
      expect(
        read.resources[PAST_THE_CAP - 1]!.context.cloudTelemetryAttributes,
      ).toMatchObject({ Namespace: "AWS/EC2" });
      // And its connection's interval (#10028).
      expect(
        read.resources[PAST_THE_CAP - 1]!.context.cloudReadIntervalInMinutes,
      ).toBe(5);
    });

    test("read a page at a time, by name and then id, through the list route", async () => {
      await readAccount();

      const resourceReads: Array<ListRequest> = reads.filter(
        (request: ListRequest): boolean => {
          return request.path === "/cloud-resource";
        },
      );

      expect(
        resourceReads.map((request: ListRequest): number => {
          return request.skip || 0;
        }),
      ).toEqual([0, 2500, 5000, 7500, 10_000]);
      expect(
        reads.some((request: ListRequest): boolean => {
          return request.path === "/cloud-connection";
        }),
      ).toBe(true);
    });

    test("every dismissal of the account's resources: where the old read of the project's first 10,000 stopped", async () => {
      // The old read: the project's first 10,000 dismissals of cloud resources.
      const oldRead: ListedPage<RecommendationDismissal> = await harness.list({
        path: "/recommendation-dismissal",
        query: {
          recommendationType: "Monitor",
          resourceType: MonitorRecommendationResourceType.CloudResource,
        },
        select: { _id: true, resourceId: true, recommendationId: true },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(oldRead.count).toBe(OTHER_DISMISSALS + 2);
      expect(oldRead.rows).toHaveLength(LIMIT_PER_PROJECT);

      const read: CloudAccountRecommendationResources = await readAccount();
      const coverage: CloudAccountRecommendationCoverage =
        await loadCloudAccountRecommendationCoverage(read.resources);

      expect(
        coverage.dismissals
          .map((row: RecommendationDismissal): string => {
            return `${String(row.resourceId)} ${String(row.recommendationId)}`;
          })
          .sort(),
      ).toEqual(
        [
          `${firstResourceId} ${HIGH_CPU}`,
          `${lastResourceId} ${STATUS_CHECKS}`,
        ].sort(),
      );

      // Read by the account's own resources: 500 at a time.
      expect(
        reads.filter((request: ListRequest): boolean => {
          return request.path === "/recommendation-dismissal";
        }),
      ).toHaveLength(Math.ceil(PAST_THE_CAP / 500));
    });

    test("a dismissed recommendation is dismissed on the last resource as on the first, and the count leaves both out", async () => {
      const read: CloudAccountRecommendationResources = await readAccount();
      const coverage: CloudAccountRecommendationCoverage =
        await loadCloudAccountRecommendationCoverage(read.resources);

      const groups: Array<CloudAccountRecommendationGroup> =
        CloudAccountRecommendationPlan.buildGroups({
          resources: read.resources,
          coveredMonitorIds: coverage.coveredMonitorIds,
          dismissals: coverage.dismissals,
        });

      expect(
        targetOf(groups, STATUS_CHECKS, nameOf(PAST_THE_CAP))?.status,
      ).toBe(RecommendationStatus.Dismissed);
      expect(targetOf(groups, HIGH_CPU, nameOf(1))?.status).toBe(
        RecommendationStatus.Dismissed,
      );
      expect(targetOf(groups, HIGH_CPU, nameOf(PAST_THE_CAP))?.status).toBe(
        RecommendationStatus.Available,
      );

      const counts: ReturnType<
        typeof CloudAccountRecommendationPlan.getCounts
      > = CloudAccountRecommendationPlan.getCounts(groups);

      expect(counts.dismissed).toBe(2);
      expect(counts.available).toBe(counts.total - 2);
      // Every resource of the account is offered its monitors.
      expect(groups[0]!.resources).toHaveLength(PAST_THE_CAP);
    });

    test("a member who may read the resources but no dismissals is refused the answer, never shown a dismissed one as to set up", async () => {
      reads = harness.routeModelAPIReads({
        userId: resourcesOnlyMemberId,
        projectId: projectId,
      });

      const read: CloudAccountRecommendationResources = await readAccount();

      expect(read.resources).toHaveLength(PAST_THE_CAP);

      await expect(
        loadCloudAccountRecommendationCoverage(read.resources),
      ).rejects.toThrow();
    });
  },
);

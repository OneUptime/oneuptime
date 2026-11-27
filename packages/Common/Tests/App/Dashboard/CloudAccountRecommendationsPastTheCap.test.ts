import CappedListServer, { CappedListCall } from "./CappedListServer";
import {
  ACCOUNT_RESOURCES_PAGE_SIZE,
  CloudAccountRecommendationCoverage,
  CloudAccountRecommendationResources,
  DISMISSALS_RESOURCES_PER_READ,
  loadCloudAccountDismissals,
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
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { MonitorRecommendationResourceType } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CLOUD ACCOUNT'S RECOMMENDATIONS WEIGH EVERY RESOURCE AND EVERY
 * DISMISSAL (#11210).
 *
 * The account's resources were one read of the first 10,000, and what the
 * team dismissed one read of the project's first 10,000 dismissals. An
 * account with 10,050 resources offered the last 50 nothing, and in a
 * project with more dismissals than that, a dismissed recommendation came
 * back as one to set up. Here the account holds 10,050 resources and the
 * project 10,040 dismissals of another account's before this account's
 * own, answered by CappedListServer, which pages and counts as the list
 * route does: the old reads stop where they stopped, and the page's reads
 * reach every one.
 *
 * What Postgres answers to the same reads is
 * CloudAccountRecommendationsPostgres's.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ACCOUNT: string = "123456789012";
const OTHER_ACCOUNT: string = "999999999999";
const CONNECTION_ID: string = "20000000-0000-4000-8000-000000000001";

const PAST_THE_CAP: number = 10_050;
const OTHER_DISMISSALS: number = 10_040;

const STATUS_CHECKS: string = "CloudResource:cloud-aws-ec2-status-check-failed";
const HIGH_CPU: string = "CloudResource:cloud-aws-ec2-high-cpu";

const resourceId: (n: number, account?: string) => string = (
  n: number,
  account?: string,
): string => {
  return `${account === OTHER_ACCOUNT ? "40000001" : "40000000"}-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const nameOf: (n: number) => string = (n: number): string => {
  return `vm ${String(n).padStart(5, "0")}`;
};

// An EC2 instance of the account, reporting its metrics: offered monitors.
const instance: (n: number, account?: string) => Record<string, unknown> = (
  n: number,
  account?: string,
): Record<string, unknown> => {
  return {
    _id: resourceId(n, account),
    name: account === OTHER_ACCOUNT ? `other ${nameOf(n)}` : nameOf(n),
    projectId: PROJECT_ID,
    cloudProvider: "aws",
    cloudAccountId: account || ACCOUNT,
    cloudResourceKind: CloudResourceKind.Resource,
    isArchived: false,
    cloudResourceType: "AWS::EC2::Instance",
    telemetryAttributes: {
      Namespace: "AWS/EC2",
      "resource.cloud.account.id": account || ACCOUNT,
      "resource.cloud.region": "us-east-1",
      "Dimensions.InstanceId": `i-${n}`,
    },
    cloudReadings: {},
    cloudProperties: {},
    cloudConnectionId: CONNECTION_ID,
    cloudRegion: "us-east-1",
  };
};

const dismissal: (data: {
  resourceId: string;
  recommendationId: string;
}) => Record<string, unknown> = (data: {
  resourceId: string;
  recommendationId: string;
}): Record<string, unknown> => {
  return {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID,
    recommendationType: "Monitor",
    resourceType: MonitorRecommendationResourceType.CloudResource,
    resourceId: new ObjectID(data.resourceId),
    recommendationId: data.recommendationId,
    dismissalReason: "Not needed",
  };
};

let resources: Array<Record<string, unknown>> = [];
let dismissals: Array<Record<string, unknown>> = [];

beforeAll(() => {
  resources = [];

  for (let n: number = 1; n <= PAST_THE_CAP; n++) {
    resources.push(instance(n));
  }

  // Another account's resources: never weighed here.
  for (let n: number = 1; n <= 20; n++) {
    resources.push(instance(n, OTHER_ACCOUNT));
  }

  /*
   * The project's dismissals: 10,040 of another account's first - the
   * first 10,000 the old read took - then this account's own, of its
   * first resource and of its last.
   */
  dismissals = [];

  for (let n: number = 1; n <= OTHER_DISMISSALS; n++) {
    dismissals.push(
      dismissal({
        resourceId: resourceId((n % 20) + 1, OTHER_ACCOUNT),
        recommendationId: `CloudResource:other-${n}`,
      }),
    );
  }

  dismissals.push(
    dismissal({ resourceId: resourceId(1), recommendationId: HIGH_CPU }),
    dismissal({
      resourceId: resourceId(PAST_THE_CAP),
      recommendationId: STATUS_CHECKS,
    }),
  );
});

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer().install();
  server.add(CloudResource, resources);
  server.add(RecommendationDismissal, dismissals);
  server.add(CloudConnection, [
    { _id: CONNECTION_ID, provider: "aws", config: {}, streamSummary: {} },
  ]);

  // Which recommendations a monitor covers is the server's (#11074): none here.
  jest
    .spyOn(MonitorRecommendationCoverageApi, "findCoveringMonitors")
    .mockResolvedValue(new Map<string, ObjectID>());
});

afterEach(() => {
  jest.restoreAllMocks();
});

const readAccount: () => Promise<CloudAccountRecommendationResources> =
  async (): Promise<CloudAccountRecommendationResources> => {
    return await loadCloudAccountRecommendationResources({
      projectId: PROJECT_ID,
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

describe("the account's resources", () => {
  test(`every one of ${PAST_THE_CAP}: where one read stopped at the first 10,000`, async () => {
    // The old read: one page, the most the list route holds.
    const oldRead: ListResult<CloudResource> = await ModelAPI.getList({
      modelType: CloudResource,
      query: {
        projectId: PROJECT_ID,
        cloudProvider: "aws",
        cloudAccountId: new Includes([ACCOUNT]),
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Resource,
      },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    expect(oldRead.data).toHaveLength(LIMIT_PER_PROJECT);
    expect(
      oldRead.data.some((resource: CloudResource): boolean => {
        return resource.name === nameOf(PAST_THE_CAP);
      }),
    ).toBe(false);

    const read: CloudAccountRecommendationResources = await readAccount();

    expect(read.resources).toHaveLength(PAST_THE_CAP);
    expect(
      new Set(
        read.resources.map((resource: { resourceId: string }): string => {
          return resource.resourceId;
        }),
      ).size,
    ).toBe(PAST_THE_CAP);
    expect(read.resources[PAST_THE_CAP - 1]!.resourceName).toBe(
      nameOf(PAST_THE_CAP),
    );
  });

  test("a page at a time, by name, never larger than the page the account reads in", async () => {
    await readAccount();

    const calls: Array<CappedListCall> = server.callsFor(CloudResource);

    expect(
      calls.map((call: CappedListCall): number => {
        return call.skip;
      }),
    ).toEqual([0, 2500, 5000, 7500, 10_000]);

    for (const call of calls) {
      expect(call.limit).toBe(ACCOUNT_RESOURCES_PAGE_SIZE);
      expect(Object.keys(call.sort)).toEqual(["name", "_id"]);
      // The account's own live resources, never an App Platforms environment.
      expect(call.query["cloudResourceKind"]).toBe(CloudResourceKind.Resource);
      expect(call.query["isArchived"]).toBe(false);
      expect(call.query["cloudProvider"]).toBe("aws");
      // What decides each one's monitors.
      expect(call.select).toMatchObject({
        telemetryAttributes: true,
        cloudReadings: true,
        cloudProperties: true,
        cloudConnectionId: true,
      });
    }
  });

  test("another account's resources are never among them", async () => {
    const read: CloudAccountRecommendationResources = await readAccount();

    expect(
      read.resources.some((resource: { resourceName: string }): boolean => {
        return resource.resourceName.startsWith("other ");
      }),
    ).toBe(false);
  });

  test("the last resource is offered its monitors, as the first is", async () => {
    const read: CloudAccountRecommendationResources = await readAccount();
    const groups: Array<CloudAccountRecommendationGroup> =
      CloudAccountRecommendationPlan.buildGroups({
        resources: read.resources,
        coveredMonitorIds: new Map<string, ObjectID>(),
        dismissals: [],
      });

    for (const name of [nameOf(1), nameOf(PAST_THE_CAP)]) {
      expect(targetOf(groups, HIGH_CPU, name)?.status).toBe(
        RecommendationStatus.Available,
      );
    }

    // Every resource, in the group of its type.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.resources).toHaveLength(PAST_THE_CAP);
  });
});

describe("what the team dismissed", () => {
  test("every dismissal of the account's resources, where one read of the project's first 10,000 had none of them", async () => {
    // The old read: the project's first 10,000 dismissals of cloud resources.
    const oldRead: ListResult<RecommendationDismissal> = await ModelAPI.getList(
      {
        modelType: RecommendationDismissal,
        query: {
          recommendationType: "Monitor",
          resourceType: MonitorRecommendationResourceType.CloudResource,
        } as never,
        select: { resourceId: true, recommendationId: true },
        sort: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      },
    );

    expect(oldRead.data).toHaveLength(LIMIT_PER_PROJECT);
    expect(
      oldRead.data.filter((row: RecommendationDismissal): boolean => {
        return String(row.resourceId).startsWith("40000000-");
      }),
    ).toHaveLength(0);

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
        `${resourceId(1)} ${HIGH_CPU}`,
        `${resourceId(PAST_THE_CAP)} ${STATUS_CHECKS}`,
      ].sort(),
    );
  });

  test("a dismissed recommendation is counted as dismissed, on the last resource as on the first, and never offered again", async () => {
    const read: CloudAccountRecommendationResources = await readAccount();
    const coverage: CloudAccountRecommendationCoverage =
      await loadCloudAccountRecommendationCoverage(read.resources);

    const groups: Array<CloudAccountRecommendationGroup> =
      CloudAccountRecommendationPlan.buildGroups({
        resources: read.resources,
        coveredMonitorIds: coverage.coveredMonitorIds,
        dismissals: coverage.dismissals,
      });

    expect(targetOf(groups, STATUS_CHECKS, nameOf(PAST_THE_CAP))?.status).toBe(
      RecommendationStatus.Dismissed,
    );
    expect(targetOf(groups, HIGH_CPU, nameOf(1))?.status).toBe(
      RecommendationStatus.Dismissed,
    );
    // The rest of the same two resources' recommendations are still offered.
    expect(targetOf(groups, HIGH_CPU, nameOf(PAST_THE_CAP))?.status).toBe(
      RecommendationStatus.Available,
    );

    const counts: ReturnType<typeof CloudAccountRecommendationPlan.getCounts> =
      CloudAccountRecommendationPlan.getCounts(groups);

    // The badge counts what is still to set up: the two dismissed are not.
    expect(counts.dismissed).toBe(2);
    expect(counts.available).toBe(counts.total - 2);

    // Neither is in what Add would make.
    const toMake: Array<CloudAccountRecommendationTarget> =
      CloudAccountRecommendationPlan.getAvailableTargets(groups[0]!);

    expect(
      toMake.some((target: CloudAccountRecommendationTarget): boolean => {
        return (
          target.resource.resourceName === nameOf(PAST_THE_CAP) &&
          target.recommendation.recommendationId === STATUS_CHECKS
        );
      }),
    ).toBe(false);
  });

  test(`read by the account's own resources, ${DISMISSALS_RESOURCES_PER_READ} at a time, never the project's whole list`, async () => {
    const read: CloudAccountRecommendationResources = await readAccount();

    await loadCloudAccountRecommendationCoverage(read.resources);

    const calls: Array<CappedListCall> = server.callsFor(
      RecommendationDismissal,
    );

    expect(calls).toHaveLength(Math.ceil(PAST_THE_CAP / 500));

    const asked: Set<string> = new Set<string>();

    for (const call of calls) {
      const ids: Includes = call.query["resourceId"] as Includes;

      expect(ids).toBeInstanceOf(Includes);
      expect(ids.values.length).toBeLessThanOrEqual(
        DISMISSALS_RESOURCES_PER_READ,
      );
      expect(call.query["recommendationType"]).toBe("Monitor");
      expect(call.query["resourceType"]).toBe(
        MonitorRecommendationResourceType.CloudResource,
      );

      for (const id of ids.values) {
        asked.add(id.toString());
      }
    }

    // Every resource of the account, and nothing else.
    expect(asked.size).toBe(PAST_THE_CAP);
    expect(asked.has(resourceId(PAST_THE_CAP))).toBe(true);
    expect(asked.has(resourceId(1, OTHER_ACCOUNT))).toBe(false);
  });

  test("a resource dismissed more often than one page holds still has every dismissal read", async () => {
    // One resource, dismissed 10,050 times over (one row per recommendation id).
    const busy: CappedListServer = new CappedListServer();
    const many: Array<Record<string, unknown>> = [];

    for (let n: number = 1; n <= PAST_THE_CAP; n++) {
      many.push(
        dismissal({
          resourceId: resourceId(7),
          recommendationId: `CloudResource:template-${n}`,
        }),
      );
    }

    busy.add(RecommendationDismissal, many);
    jest.restoreAllMocks();
    busy.install();

    const read: Array<RecommendationDismissal> =
      await loadCloudAccountDismissals([resourceId(7)]);

    expect(read).toHaveLength(PAST_THE_CAP);
    expect(busy.callsFor(RecommendationDismissal).length).toBe(2);
  });

  test("an id that is no id is never sent, and one given twice is asked once", async () => {
    await loadCloudAccountDismissals([
      resourceId(1),
      resourceId(1).toUpperCase(),
      "not-an-id",
      "",
    ]);

    const calls: Array<CappedListCall> = server.callsFor(
      RecommendationDismissal,
    );

    expect(calls).toHaveLength(1);
    expect(
      (calls[0]!.query["resourceId"] as Includes).values.map(
        (id: unknown): string => {
          return String(id);
        },
      ),
    ).toEqual([resourceId(1)]);
  });

  test("no resources: nothing is read", async () => {
    expect(await loadCloudAccountDismissals([])).toEqual([]);
    expect(server.callsFor(RecommendationDismissal)).toHaveLength(0);
  });

  test("a read that fails fails the answer: no dismissed recommendation is offered again as not dismissed", async () => {
    jest.restoreAllMocks();
    jest
      .spyOn(MonitorRecommendationCoverageApi, "findCoveringMonitors")
      .mockResolvedValue(new Map<string, ObjectID>());
    jest
      .spyOn(ModelAPI, "getList")
      .mockRejectedValue(
        new Error("The dismissals could not be read.") as never,
      );

    await expect(
      loadCloudAccountRecommendationCoverage([
        {
          resourceId: resourceId(1),
          resourceName: nameOf(1),
          context: {},
        },
      ]),
    ).rejects.toThrow("The dismissals could not be read.");
  });
});

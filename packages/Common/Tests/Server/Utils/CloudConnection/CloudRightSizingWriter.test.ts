import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudCostRecommendation from "../../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudCostRecommendationService from "../../../../Server/Services/CloudCostRecommendationService";
import CloudCostService from "../../../../Server/Services/CloudCostService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import MetricService from "../../../../Server/Services/MetricService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import CloudRightSizingWriter, {
  CLOUD_RIGHT_SIZING_ACTION,
  CLOUD_RIGHT_SIZING_EFFORT,
  CLOUD_RIGHT_SIZING_MAX_RESOURCES,
  CloudRightSizingCandidate,
  CloudRightSizingReadGroup,
  CloudRightSizingRecord,
  CloudRightSizingWriteResult,
} from "../../../../Server/Utils/CloudConnection/CloudRightSizingWriter";
import logger from "../../../../Server/Utils/Logger";
import AggregateBy from "../../../../Types/BaseDatabase/AggregateBy";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudSavingKind,
} from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import {
  CLOUD_DAYS_IN_AVERAGE_MONTH,
  CLOUD_RIGHT_SIZING_WINDOW_DAYS,
  CLOUD_SAVINGS_SOURCE_ONEUPTIME,
  CloudRightSizing,
  CloudRightSizingVerdict,
  CloudUsageObservation,
  buildCloudRightSizing,
  getCloudRightSizingProfile,
  getCloudRightSizingRecommendationId,
} from "../../../../Types/Cloud/CloudRightSizing";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Metric from "../../../../Models/AnalyticsModels/Metric";

/*
 * OneUptime's own right-sizing, kept among an account's ways to spend
 * less: which resources it sizes, its grouped reads of their CPU and
 * memory, what they cost a day, and the rows it keeps in step - created,
 * brought up to date, removed when no longer true or when a recommender
 * speaks for the resource.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const CONNECTION: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a2",
);
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b1",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

const WEB_1: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000c1");
const WEB_2: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000c2");
const BATCH: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000c3");
const OLD: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000c4");
const KEPT_ROW: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000d1");
const STALE_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000d2",
);

function arn(id: string): string {
  return `arn:aws:ec2:us-east-1:123456789012:instance/${id}`;
}

function ec2(
  id: ObjectID,
  instanceId: string,
  fields: Partial<CloudResource> = {},
): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: id.toString(),
    id,
    name: instanceId,
    cloudProvider: CloudProvider.AWS,
    cloudResourceType: "AWS::EC2::Instance",
    cloudResourceKind: CloudResourceKind.Resource,
    cloudProperties: { InstanceType: "m5.2xlarge" },
    telemetryAttributes: {
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": instanceId,
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    },
    providerResourceId: arn(instanceId),
    cloudAccountId: "123456789012",
    cloudRegion: "us-east-1",
    isArchived: false,
    ...fields,
  });
}

function candidate(
  resource: CloudResource,
): CloudRightSizingCandidate | undefined {
  return CloudRightSizingWriter.selectCandidates({
    resources: [resource],
    coveredByRecommender: new Set(),
  })[0];
}

function row(
  attributes: Record<string, string>,
  value: number,
  timestamp: Date = new Date(NOW.getTime() - 14 * 24 * HOUR),
): AggregatedModel {
  return { attributes, value, timestamp };
}

describe("which resources it sizes", () => {
  test("a type it can size, with a known size that is no burstable one, scoped to its metrics", () => {
    const sized: CloudRightSizingCandidate | undefined = candidate(
      ec2(WEB_1, "i-0web1"),
    );
    expect(sized).toMatchObject({
      name: "i-0web1",
      provider: CloudProvider.AWS,
      type: "AWS::EC2::Instance",
      size: "m5.2xlarge",
      accountId: "123456789012",
      region: "us-east-1",
      providerResourceId: arn("i-0web1"),
    });
    expect(sized!.profile).toBe(
      getCloudRightSizingProfile("aws", "AWS::EC2::Instance"),
    );

    for (const left of [
      ec2(WEB_1, "i-0web1", { isArchived: true }),
      ec2(WEB_1, "i-0web1", { cloudProperties: { InstanceType: "t3.large" } }),
      ec2(WEB_1, "i-0web1", { cloudProperties: { InstanceType: "m5.metal" } }),
      ec2(WEB_1, "i-0web1", { cloudProperties: {} }),
      ec2(WEB_1, "i-0web1", { telemetryAttributes: {} }),
      ec2(WEB_1, "i-0web1", { cloudResourceType: "AWS::S3::Bucket" }),
      ec2(WEB_1, "i-0web1", { cloudProvider: "oracle" as never }),
    ]) {
      expect(candidate(left)).toBeUndefined();
    }
  });

  test("a resource its cloud's recommender speaks for is left to it", () => {
    expect(
      CloudRightSizingWriter.selectCandidates({
        resources: [ec2(WEB_1, "i-0web1"), ec2(WEB_2, "i-0web2")],
        coveredByRecommender: new Set([WEB_1.toString()]),
      }).map((entry: CloudRightSizingCandidate) => {
        return entry.id.toString();
      }),
    ).toEqual([WEB_2.toString()]);
  });

  test("at most the cap a run, the first listed first", () => {
    const many: Array<CloudResource> = Array.from(
      { length: CLOUD_RIGHT_SIZING_MAX_RESOURCES + 3 },
      (_value: unknown, index: number): CloudResource => {
        return ec2(ObjectID.generate(), `i-${index}`);
      },
    );
    const candidates: Array<CloudRightSizingCandidate> =
      CloudRightSizingWriter.selectCandidates({
        resources: many,
        coveredByRecommender: new Set(),
      });
    expect(candidates).toHaveLength(CLOUD_RIGHT_SIZING_MAX_RESOURCES);
    expect(candidates[0]!.name).toBe("i-0");
  });

  test("an empty attribute value is no attribute", () => {
    expect(
      candidate(
        ec2(WEB_1, "i-0web1", {
          telemetryAttributes: { Namespace: "AWS/EC2", "x.y": " ", n: 5 },
        }),
      )!.telemetryAttributes,
    ).toEqual({ Namespace: "AWS/EC2" });
  });
});

describe("its grouped reads", () => {
  test("resources of a type told apart by the same attributes are one read: the shared ones its filter", () => {
    const groups: Array<CloudRightSizingReadGroup> =
      CloudRightSizingWriter.groupForReads([
        candidate(ec2(WEB_1, "i-0web1"))!,
        candidate(ec2(WEB_2, "i-0web2"))!,
        candidate(
          ec2(BATCH, "i-0batch", {
            telemetryAttributes: {
              Namespace: "AWS/EC2",
              "Dimensions.InstanceId": "i-0batch",
            },
          }),
        )!,
      ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.keys).toEqual([
      "Dimensions.InstanceId",
      "Namespace",
      "resource.cloud.account.id",
      "resource.cloud.region",
    ]);
    expect(groups[0]!.filter).toEqual({
      Namespace: "AWS/EC2",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    });
    expect(groups[0]!.candidates).toHaveLength(2);
    // A group of one shares every attribute.
    expect(groups[1]!.filter).toEqual({
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": "i-0batch",
    });
  });

  test("a row is its resource's by every grouped attribute; rows of none are left out", () => {
    const group: CloudRightSizingReadGroup =
      CloudRightSizingWriter.groupForReads([
        candidate(ec2(WEB_1, "i-0web1"))!,
        candidate(ec2(WEB_2, "i-0web2"))!,
      ])[0]!;
    const attributes: (instance: string) => Record<string, string> = (
      instance: string,
    ): Record<string, string> => {
      return {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": instance,
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      };
    };

    const matched: Map<string, AggregatedModel> =
      CloudRightSizingWriter.matchRows(group, [
        row(attributes("i-0web2"), 7),
        row(attributes("i-other"), 9),
        { value: 1, timestamp: NOW } as AggregatedModel,
        row(attributes("i-0web1"), 5),
        // The first row of a resource wins.
        row(attributes("i-0web1"), 99),
      ]);

    expect(matched.get(WEB_1.toString())?.value).toBe(5);
    expect(matched.get(WEB_2.toString())?.value).toBe(7);
    expect(matched.size).toBe(2);
  });

  test("the readings, in percent: Google Cloud's shares made percents, the hours from the first reading", () => {
    const resource: CloudResource = Object.assign(new CloudResource(), {
      id: BATCH,
      name: "etl-runner-1",
      cloudProvider: CloudProvider.GCP,
      cloudResourceType: "gce_instance",
      cloudProperties: {
        machineType:
          "https://www.googleapis.com/compute/v1/projects/acme/zones/europe-west1-b/machineTypes/n2-standard-16",
      },
      telemetryAttributes: {
        "resource.gcp.resource_type": "gce_instance",
        "resource.instance_id": "4711",
      },
      cloudAccountId: "acme",
      isArchived: false,
    });
    const group: CloudRightSizingReadGroup =
      CloudRightSizingWriter.groupForReads([candidate(resource)!])[0]!;
    const attributes: Record<string, string> = {
      "resource.gcp.resource_type": "gce_instance",
      "resource.instance_id": "4711",
    };

    const observations: Map<string, CloudUsageObservation> =
      CloudRightSizingWriter.toObservations({
        group,
        cpuP95: [row(attributes, 0.21, new Date(NOW.getTime() - 100 * HOUR))],
        cpuMax: [row(attributes, 0.38)],
        cpuCount: [row(attributes, 6000.4)],
        memoryMax: [],
        end: NOW,
      });

    expect(observations.get(BATCH.toString())).toEqual({
      cpuP95Percent: 21,
      cpuMaxPercent: 38,
      memoryPeakPercent: null,
      samples: 6000,
      observedHours: 100,
    });
  });

  test("a resource with no 95th percentile has no observation", () => {
    const group: CloudRightSizingReadGroup =
      CloudRightSizingWriter.groupForReads([
        candidate(ec2(WEB_1, "i-0web1"))!,
      ])[0]!;
    expect(
      CloudRightSizingWriter.toObservations({
        group,
        cpuP95: [],
        cpuMax: [],
        cpuCount: [],
        memoryMax: [],
        end: NOW,
      }).size,
    ).toBe(0);
  });
});

describe("reading the metrics", () => {
  let asked: Array<AggregateBy<Metric>> = [];
  let answers: Map<AggregationType, Array<AggregatedModel>> = new Map();

  beforeEach(() => {
    asked = [];
    answers = new Map();
    jest
      .spyOn(MetricService, "aggregateBy")
      .mockImplementation(
        async (aggregateBy: AggregateBy<Metric>): Promise<AggregatedResult> => {
          asked.push(aggregateBy);
          return { data: answers.get(aggregateBy.aggregationType) || [] };
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cacheAttributes: Record<string, string> = {
    Namespace: "AWS/ElastiCache",
    "Dimensions.CacheClusterId": "sessions",
  };

  function cache(): CloudRightSizingCandidate {
    return candidate(
      Object.assign(new CloudResource(), {
        id: BATCH,
        name: "sessions",
        cloudProvider: CloudProvider.AWS,
        cloudResourceType: "AWS::ElastiCache::CacheCluster",
        cloudProperties: { CacheNodeType: "cache.r6g.xlarge" },
        telemetryAttributes: cacheAttributes,
        cloudAccountId: "123456789012",
        isArchived: false,
      }),
    )!;
  }

  test("four grouped reads over the last 14 days: the CPU's 95th percentile, its highest, its count, and memory's peak", async () => {
    answers.set(AggregationType.P95, [row(cacheAttributes, 12)]);
    answers.set(AggregationType.Max, [row(cacheAttributes, 20)]);
    answers.set(AggregationType.Count, [row(cacheAttributes, 4032)]);

    const observations: Map<string, CloudUsageObservation> =
      await CloudRightSizingWriter.readObservations({
        projectId: PROJECT,
        candidates: [cache()],
        now: NOW,
      });

    expect(
      asked.map((entry: AggregateBy<Metric>) => {
        return entry.aggregationType;
      }),
    ).toEqual([
      AggregationType.P95,
      AggregationType.Max,
      AggregationType.Count,
      AggregationType.Max,
    ]);

    for (const entry of asked) {
      expect(entry.aggregationInterval).toBe(AggregationInterval.Total);
      expect(entry.aggregateColumnName).toBe("value");
      expect(entry.groupByAttributeKeys).toEqual([
        "Dimensions.CacheClusterId",
        "Namespace",
      ]);
      expect(entry.endTimestamp).toEqual(NOW);
      expect(entry.startTimestamp).toEqual(
        new Date(NOW.getTime() - CLOUD_RIGHT_SIZING_WINDOW_DAYS * 24 * HOUR),
      );
      const query: Record<string, unknown> = entry.query as Record<
        string,
        unknown
      >;
      expect(query["projectId"]).toEqual(PROJECT);
      expect(query["attributes"]).toEqual(cacheAttributes);
    }

    // CPU, then memory, by the names their readings are stored under.
    expect((asked[0]!.query as Record<string, unknown>)["name"]).toBe(
      "amazonaws.com/aws/elasticache/cpuutilization",
    );
    expect((asked[3]!.query as Record<string, unknown>)["name"]).toBe(
      "amazonaws.com/aws/elasticache/databasememoryusagepercentage",
    );

    expect(observations.get(BATCH.toString())).toMatchObject({
      cpuP95Percent: 12,
      cpuMaxPercent: 20,
      memoryPeakPercent: 20,
      samples: 4032,
      observedHours: 14 * 24,
    });
  });

  test("an Azure metric is read under every aggregation it may be stored with", async () => {
    const vm: CloudRightSizingCandidate = candidate(
      Object.assign(new CloudResource(), {
        id: WEB_1,
        name: "shop-web-1",
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: "Microsoft.Compute/virtualMachines",
        cloudProperties: { vmSize: "Standard_D8s_v5" },
        telemetryAttributes: {
          "azuremonitor.resource_id":
            "/subscriptions/s/resourceGroups/shop/providers/Microsoft.Compute/virtualMachines/shop-web-1",
        },
        cloudAccountId: "s",
        isArchived: false,
      }),
    )!;
    answers.set(AggregationType.P95, [row(vm.telemetryAttributes, 10)]);

    await CloudRightSizingWriter.readObservations({
      projectId: PROJECT,
      candidates: [vm],
      now: NOW,
    });

    const name: unknown = (asked[0]!.query as Record<string, unknown>)["name"];
    expect(name).toBeInstanceOf(Includes);
    expect((name as Includes).values).toEqual([
      "azure_percentage_cpu_average",
      "azure_percentage_cpu_maximum",
      "azure_percentage_cpu_minimum",
      "azure_percentage_cpu_total",
    ]);
    // Sized by CPU only: no memory read.
    expect(asked).toHaveLength(3);
  });

  test("no CPU readings at all: nothing more is read, and nothing observed", async () => {
    const observations: Map<string, CloudUsageObservation> =
      await CloudRightSizingWriter.readObservations({
        projectId: PROJECT,
        candidates: [cache()],
        now: NOW,
      });
    expect(asked).toHaveLength(1);
    expect(observations.size).toBe(0);
  });

  test("a group told apart by more attributes than a read groups by is not read", async () => {
    const attributes: Record<string, string> = {};
    for (let index: number = 0; index < 11; index++) {
      attributes[`k${index}`] = `v${index}`;
    }
    const wide: CloudRightSizingCandidate = {
      ...cache(),
      telemetryAttributes: attributes,
    };
    await CloudRightSizingWriter.readObservations({
      projectId: PROJECT,
      candidates: [wide],
      now: NOW,
    });
    expect(asked).toHaveLength(0);
  });

  test("a group whose read fails is logged, and the others are read", async () => {
    jest.restoreAllMocks();
    const errors: Array<string> = [];
    jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    let calls: number = 0;
    jest
      .spyOn(MetricService, "aggregateBy")
      .mockImplementation(async (): Promise<AggregatedResult> => {
        calls++;
        if (calls === 1) {
          throw new Error("ClickHouse is away");
        }
        return { data: [] };
      });

    const ec2Candidate: CloudRightSizingCandidate = candidate(
      ec2(WEB_1, "i-0web1"),
    )!;
    await CloudRightSizingWriter.readObservations({
      projectId: PROJECT,
      candidates: [cache(), ec2Candidate],
      now: NOW,
    });

    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ClickHouse is away");
  });
});

describe("what a resource cost a day", () => {
  test("its cost key's sum and its billed days over the last 30, in the table's own words", () => {
    const statement: Statement =
      CloudRightSizingWriter.buildDailyCostsStatement({
        projectId: PROJECT,
        resourceKeys: [arn("i-0web1")],
        start: new Date("2026-10-22T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
      });

    expect(statement.query).toContain("sum(cost) AS total");
    expect(statement.query).toContain("uniqExact(toDate(day, 'UTC')) AS days");
    expect(statement.query).toContain("GROUP BY resourceKey, currencyCode");
    expect(statement.query).toContain("max_execution_time");
    expect(Object.values(statement.query_params)).toContain("CloudCostV1");
    expect(Object.values(statement.query_params)).toContain(PROJECT.toString());
    expect(JSON.stringify(statement.query_params)).toContain(arn("i-0web1"));
  });

  test("each resource's currency with the most, a day's cost over the days billed", () => {
    const costs: Map<
      string,
      { amount: number; currency: string; days: number }
    > = CloudRightSizingWriter.readDailyCostRows([
      { resourceKey: "a", currencyCode: "USD", total: 140, days: 14 },
      { resourceKey: "a", currencyCode: "EUR", total: 2, days: 1 },
      { resourceKey: "b", currencyCode: "EUR", total: "60", days: "30" },
      // Nothing billed, or no days: no cost.
      { resourceKey: "c", currencyCode: "USD", total: 0, days: 3 },
      { resourceKey: "d", currencyCode: "USD", total: 5, days: 0 },
      { resourceKey: "", currencyCode: "USD", total: 5, days: 1 },
      { resourceKey: "e", total: 31, days: 31 },
    ] as Array<JSONObject>);

    expect(costs.get("a")).toEqual({ amount: 10, currency: "USD", days: 14 });
    expect(costs.get("b")).toEqual({ amount: 2, currency: "EUR", days: 30 });
    expect(costs.has("c")).toBe(false);
    expect(costs.has("d")).toBe(false);
    expect(costs.get("e")).toEqual({
      amount: 1,
      currency: CLOUD_COST_DEFAULT_CURRENCY,
      days: 30,
    });
  });

  test("no cost key, no query; a query that fails is no cost, logged", async () => {
    const executeQuery: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CloudCostService,
      "executeQuery",
    );
    expect(
      (
        await CloudRightSizingWriter.readDailyCosts({
          projectId: PROJECT,
          candidates: [
            { ...candidate(ec2(WEB_1, "i-0web1"))!, providerResourceId: "" },
          ],
          now: NOW,
        })
      ).size,
    ).toBe(0);
    expect(executeQuery).not.toHaveBeenCalled();

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    executeQuery.mockImplementation(async (): Promise<never> => {
      throw new Error("timeout");
    });
    expect(
      (
        await CloudRightSizingWriter.readDailyCosts({
          projectId: PROJECT,
          candidates: [candidate(ec2(WEB_1, "i-0web1"))!],
          now: NOW,
        })
      ).size,
    ).toBe(0);
    jest.restoreAllMocks();
  });
});

describe("the row a right-sizing is kept as", () => {
  test("over-provisioned with a size to change to: its change, saving, cost and evidence", () => {
    const sized: CloudRightSizingCandidate = candidate(ec2(WEB_1, "i-0web1"))!;
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: sized.profile,
      size: sized.size,
      observation: {
        cpuP95Percent: 14,
        cpuMaxPercent: 30,
        memoryPeakPercent: null,
        samples: 4032,
        observedHours: 14 * 24,
      },
      dailyCost: { amount: 9.2, currency: "USD", days: 30 },
    });

    const record: CloudRightSizingRecord | null =
      CloudRightSizingWriter.toRecord({ candidate: sized, sizing });

    expect(record).toMatchObject({
      accountId: "123456789012",
      recommendationId: getCloudRightSizingRecommendationId(WEB_1.toString()),
      region: "us-east-1",
      resourceId: arn("i-0web1"),
      resourceType: "EC2 Instance",
      resourceName: "i-0web1",
      currentConfiguration: "m5.2xlarge",
      recommendedConfiguration: "m5.xlarge",
      monthlySavings: sizing.monthlySavings,
      monthlyCost: Math.round(9.2 * CLOUD_DAYS_IN_AVERAGE_MONTH * 100) / 100,
      currency: "USD",
      evidence: {
        cpuP95Percent: 14,
        cpuMaxPercent: 30,
        memoryPeakPercent: null,
        observedDays: 14,
        factor: 2,
        isSavingUpperBound: false,
      },
    });
    expect(record!.cloudResourceId.toString()).toBe(WEB_1.toString());
  });

  test("anything else is no row: right-sized, under-provisioned, or over-provisioned at its smallest size", () => {
    const sized: CloudRightSizingCandidate = candidate(ec2(WEB_1, "i-0web1"))!;
    for (const fields of [
      { cpuP95Percent: 50, cpuMaxPercent: 70 },
      { cpuP95Percent: 95, cpuMaxPercent: 100 },
    ]) {
      expect(
        CloudRightSizingWriter.toRecord({
          candidate: sized,
          sizing: buildCloudRightSizing({
            profile: sized.profile,
            size: sized.size,
            observation: {
              memoryPeakPercent: null,
              samples: 4032,
              observedHours: 14 * 24,
              ...fields,
            },
          }),
        }),
      ).toBeNull();
    }

    const smallest: CloudRightSizingCandidate = candidate(
      ec2(WEB_1, "i-0web1", { cloudProperties: { InstanceType: "m5.large" } }),
    )!;
    const atSmallest: CloudRightSizing = buildCloudRightSizing({
      profile: smallest.profile,
      size: smallest.size,
      observation: {
        cpuP95Percent: 2,
        cpuMaxPercent: 4,
        memoryPeakPercent: null,
        samples: 4032,
        observedHours: 14 * 24,
      },
    });
    expect(atSmallest.verdict).toBe(CloudRightSizingVerdict.Overprovisioned);
    expect(
      CloudRightSizingWriter.toRecord({
        candidate: smallest,
        sizing: atSmallest,
      }),
    ).toBeNull();
  });
});

describe("a run", () => {
  let created: Array<CloudCostRecommendation> = [];
  let updated: Array<{ id: string; data: Partial<CloudCostRecommendation> }> =
    [];
  let removed: Array<{ query: Record<string, unknown> }> = [];
  let existing: Array<CloudCostRecommendation> = [];
  let resources: Array<CloudResource> = [];
  let resourceQueries: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    created = [];
    updated = [];
    removed = [];
    resourceQueries = [];
    resources = [
      // Over-provisioned, billed by name.
      ec2(WEB_1, "i-0web1"),
      // A recommender speaks for it.
      ec2(WEB_2, "i-0web2"),
      // Busy: right-sized.
      ec2(BATCH, "i-0batch"),
      // Archived: its right-sizing goes.
      ec2(OLD, "i-0old", { isArchived: true }),
    ];
    existing = [
      Object.assign(new CloudCostRecommendation(), {
        id: KEPT_ROW,
        recommendationId: getCloudRightSizingRecommendationId(WEB_1.toString()),
        cloudResourceId: WEB_1,
        kind: CloudSavingKind.Rightsize,
      }),
      Object.assign(new CloudCostRecommendation(), {
        id: ObjectID.generate(),
        recommendationId: "rec-hub-1",
        cloudResourceId: WEB_2,
        kind: CloudSavingKind.Rightsize,
      }),
      Object.assign(new CloudCostRecommendation(), {
        id: STALE_ROW,
        recommendationId: getCloudRightSizingRecommendationId(OLD.toString()),
        cloudResourceId: OLD,
        kind: CloudSavingKind.Rightsize,
      }),
      // A commitment says nothing of a resource's size.
      Object.assign(new CloudCostRecommendation(), {
        id: ObjectID.generate(),
        recommendationId: "rec-hub-2",
        cloudResourceId: BATCH,
        kind: CloudSavingKind.Commitment,
      }),
    ];

    jest
      .spyOn(CloudResourceService, "findBy")
      .mockImplementation(
        async (input: { query: unknown }): Promise<Array<CloudResource>> => {
          resourceQueries.push(input.query as Record<string, unknown>);
          return resources;
        },
      );
    jest
      .spyOn(CloudCostRecommendationService, "findBy")
      .mockImplementation(async (): Promise<Array<CloudCostRecommendation>> => {
        return existing;
      });
    jest
      .spyOn(CloudCostRecommendationService, "updateOneById")
      .mockImplementation(
        async (input: { id: ObjectID; data: unknown }): Promise<number> => {
          updated.push({
            id: input.id.toString(),
            data: input.data as Partial<CloudCostRecommendation>,
          });
          return 1;
        },
      );
    jest
      .spyOn(CloudCostRecommendationService, "create")
      .mockImplementation(
        async (input: {
          data: CloudCostRecommendation;
        }): Promise<CloudCostRecommendation> => {
          created.push(input.data);
          return input.data;
        },
      );
    jest
      .spyOn(CloudCostRecommendationService, "hardDeleteBy")
      .mockImplementation(
        async (input: { query: unknown }): Promise<number> => {
          removed.push({ query: input.query as Record<string, unknown> });
          return 1;
        },
      );
    jest
      .spyOn(MetricService, "aggregateBy")
      .mockImplementation(
        async (aggregateBy: AggregateBy<Metric>): Promise<AggregatedResult> => {
          const attributes: (instance: string) => Record<string, string> = (
            instance: string,
          ): Record<string, string> => {
            return {
              Namespace: "AWS/EC2",
              "Dimensions.InstanceId": instance,
              "resource.cloud.account.id": "123456789012",
              "resource.cloud.region": "us-east-1",
            };
          };
          const values: Record<string, [number, number, number]> = {
            // A quarter's peak would pass 100%: half its size.
            "i-0web1": [12, 30, 4032],
            "i-0batch": [70, 96, 4032],
          };
          const index: number =
            aggregateBy.aggregationType === AggregationType.P95
              ? 0
              : aggregateBy.aggregationType === AggregationType.Max
                ? 1
                : 2;

          return {
            data: Object.entries(values).map(
              ([instance, numbers]: [string, [number, number, number]]) => {
                return row(attributes(instance), numbers[index]!);
              },
            ),
          };
        },
      );
    jest
      .spyOn(CloudCostService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
        return {
          json: async (): Promise<{ data: Array<JSONObject> }> => {
            return {
              data: [
                {
                  resourceKey: arn("i-0web1"),
                  currencyCode: "USD",
                  total: 276,
                  days: 30,
                },
              ],
            };
          },
        } as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function run(): Promise<CloudRightSizingWriteResult> {
    return await CloudRightSizingWriter.run({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accountRows: new Map([["123456789012", ACCOUNT_ROW]]),
      now: NOW,
    });
  }

  test("sizes the connection's resources no recommender speaks for, keeps the over-provisioned, removes what is no longer true", async () => {
    const result: CloudRightSizingWriteResult = await run();

    // The connection's own resources, of the types it can size.
    expect(resourceQueries[0]).toMatchObject({
      projectId: PROJECT,
      cloudConnectionId: CONNECTION,
      cloudResourceKind: CloudResourceKind.Resource,
    });
    expect(
      (resourceQueries[0]!["cloudResourceType"] as Includes).values,
    ).toEqual([
      "AWS::EC2::Instance",
      "AWS::RDS::DBInstance",
      "AWS::ElastiCache::CacheCluster",
      "AWS::ElastiCache::ReplicationGroup",
    ]);

    expect(result).toEqual({ judged: 2, kept: 1, removed: 2 });

    // web-1 is kept up to date, as OneUptime's own Rightsize.
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.id).toBe(KEPT_ROW.toString());
    expect(updated[0]!.data).toMatchObject({
      kind: CloudSavingKind.Rightsize,
      action: CLOUD_RIGHT_SIZING_ACTION,
      effort: CLOUD_RIGHT_SIZING_EFFORT,
      source: CLOUD_SAVINGS_SOURCE_ONEUPTIME,
      currentConfiguration: "m5.2xlarge",
      recommendedConfiguration: "m5.xlarge",
      currency: "USD",
      lastSeenAt: NOW,
    });
    expect(updated[0]!.data.cloudAccountId?.toString()).toBe(
      ACCOUNT_ROW.toString(),
    );
    const monthly: number =
      Math.round((276 / 30) * CLOUD_DAYS_IN_AVERAGE_MONTH * 100) / 100;
    expect(updated[0]!.data.monthlyCost).toBe(monthly);
    expect(updated[0]!.data.monthlySavings).toBe(
      Math.round(monthly * 50) / 100,
    );
    expect(updated[0]!.data.evidence).toMatchObject({
      cpuP95Percent: 12,
      cpuMaxPercent: 30,
      observedDays: 14,
      factor: 2,
    });

    // The archived resource's right-sizing goes, and those of resources gone.
    expect(removed).toHaveLength(2);
    expect((removed[0]!.query["_id"] as Includes).values).toEqual([STALE_ROW]);
    expect(removed[1]!.query).toEqual({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      source: CLOUD_SAVINGS_SOURCE_ONEUPTIME,
      cloudResourceId: new IsNull(),
    });
  });

  test("a new right-sizing is created with its own id, linked to its resource and account", async () => {
    existing = [];
    await run();

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      provider: CloudProvider.AWS,
      recommendationId: getCloudRightSizingRecommendationId(WEB_1.toString()),
      source: CLOUD_SAVINGS_SOURCE_ONEUPTIME,
    });
    expect(created[0]!.projectId?.toString()).toBe(PROJECT.toString());
    expect(created[0]!.cloudResourceId?.toString()).toBe(WEB_1.toString());
    expect(created[0]!.cloudAccountId?.toString()).toBe(ACCOUNT_ROW.toString());
    // No stale row to remove; the orphans' sweep still runs.
    expect(removed).toHaveLength(1);
  });

  test("a resource no recommender spoke for until now loses OneUptime's right-sizing to it", async () => {
    existing.push(
      Object.assign(new CloudCostRecommendation(), {
        id: ObjectID.generate(),
        recommendationId: "rec-hub-3",
        cloudResourceId: WEB_1,
        kind: CloudSavingKind.Upgrade,
      }),
    );

    const result: CloudRightSizingWriteResult = await run();

    expect(result.kept).toBe(0);
    expect(updated).toHaveLength(0);
    expect(
      (removed[0]!.query["_id"] as Includes).values.map(
        (id: unknown): string => {
          return String(id);
        },
      ),
    ).toEqual([KEPT_ROW.toString(), STALE_ROW.toString()]);
  });

  test("a resource of an account OneUptime holds no row for is not kept", async () => {
    existing = [];
    const result: CloudRightSizingWriteResult =
      await CloudRightSizingWriter.run({
        projectId: PROJECT,
        connectionId: CONNECTION,
        provider: CloudProvider.AWS,
        accountRows: new Map(),
        now: NOW,
      });
    expect(result.kept).toBe(0);
    expect(created).toHaveLength(0);
  });

  test("a run that fails is logged, never thrown", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest
      .spyOn(CloudResourceService, "findBy")
      .mockImplementation(async (): Promise<never> => {
        throw new Error("Postgres is away");
      });
    expect(await run()).toEqual({ judged: 0, kept: 0, removed: 0 });
    expect(created).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  test("a provider with no type it can size reads nothing", async () => {
    const result: CloudRightSizingWriteResult =
      await CloudRightSizingWriter.run({
        projectId: PROJECT,
        connectionId: CONNECTION,
        provider: "oracle" as CloudProvider,
        accountRows: new Map(),
        now: NOW,
      });
    expect(resourceQueries).toHaveLength(0);
    expect(result).toEqual({ judged: 0, kept: 0, removed: 1 });
  });
});

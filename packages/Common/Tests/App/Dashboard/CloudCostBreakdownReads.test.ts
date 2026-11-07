import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CloudAccountCostSummary,
  CloudCostState,
} from "../../../Types/Cloud/CloudCost";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_PLATFORM_ALL_BILLED_SERVICES,
  CloudPlatformCostRow,
  CloudPlatformTaggedCostRow,
  ELASTIC_BEANSTALK_ENVIRONMENT_TAG,
} from "../../../Types/Cloud/CloudPlatformCosts";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import {
  CloudCostBreakdownResult,
  CloudCostPlatformLists,
  CloudCostScope,
  fetchCloudCostBreakdown,
  fetchCloudCostPlatformLists,
  fetchCloudCostRows,
  fetchCloudCostTagRows,
  isCloudCostColumnDimension,
  mergeCloudCostTagKeys,
  sortCloudCostShares,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostReads";

/*
 * Cloud > Costs' breakdowns that are not a column of the costs: by App
 * Platforms environment, by app and by a tag's value. What each reads -
 * the costs summed by account, Region and service (and resource, for
 * apps), a tag's value through /aggregate's attribute grouping, the
 * project's environments and apps - and what it shows: the shares, and
 * under them what the rest came to, all of it adding up to the period's
 * spend.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const START: Date = new Date("2026-11-01T00:00:00.000Z");
const END: Date = new Date("2026-11-20T15:00:00.000Z");
const ECS_ENV: string = "20000000-0000-4000-8000-0000000000e1";
const EB_ENV: string = "20000000-0000-4000-8000-0000000000e2";
const RUN_ENV: string = "20000000-0000-4000-8000-0000000000e3";
const CHECKOUT_APP: string = "30000000-0000-4000-8000-0000000000a1";
const SHOP_APP: string = "30000000-0000-4000-8000-0000000000a2";
const ORDERS_APP: string = "30000000-0000-4000-8000-0000000000a3";

function scope(overrides: Partial<CloudCostScope> = {}): CloudCostScope {
  return {
    projectId: PROJECT,
    currency: "USD",
    startDate: START,
    endDate: END,
    ...overrides,
  };
}

function summary(
  overrides: Partial<CloudAccountCostSummary> = {},
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
    readAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

const LISTS: CloudCostPlatformLists = {
  environments: [
    {
      id: ECS_ENV,
      name: "shop-ecs",
      platform: ManagedCloudPlatform.AwsEcs,
      provider: "aws",
      accountId: "123456789012",
      region: "us-east-1",
    },
    {
      id: RUN_ENV,
      name: "run-eu",
      platform: ManagedCloudPlatform.GcpCloudRun,
      provider: "gcp",
      accountId: "acme-prod",
      region: "europe-west1",
    },
  ],
  apps: [
    { id: CHECKOUT_APP, environmentId: RUN_ENV, name: "checkout" },
    { id: ORDERS_APP, environmentId: ECS_ENV, name: "orders" },
  ],
};

const EB_LISTS: CloudCostPlatformLists = {
  environments: [
    ...LISTS.environments,
    {
      id: EB_ENV,
      name: "shop-eb",
      platform: ManagedCloudPlatform.AwsElasticBeanstalk,
      provider: "aws",
      accountId: "123456789012",
      region: "us-east-1",
    },
  ],
  apps: [
    ...LISTS.apps,
    {
      id: SHOP_APP,
      environmentId: EB_ENV,
      name: "shop",
      groupName: "shop-prod",
    },
  ],
};

type AggregateRequest = {
  modelType: unknown;
  aggregateBy: AggregateBy<CloudCost>;
};

/*
 * /aggregate stubbed by what a request groups by: "accountId,region,service"
 * for the costs by place and service, with ",resourceId" for apps, and
 * "tag:<key>" (plus ",accountId,region" when by place too) for a tag.
 */
function stubAggregate(
  answers: Record<string, Array<Record<string, unknown>>>,
): jest.SpyInstance<any, any> {
  return getJestSpyOn(AnalyticsModelAPI, "aggregate").mockImplementation(
    async (request: AggregateRequest): Promise<unknown> => {
      const columns: Array<string> = Object.keys(
        request.aggregateBy.groupBy || {},
      );
      const key: string = request.aggregateBy.groupByAttributeKeys
        ? [
            `tag:${request.aggregateBy.groupByAttributeKeys.join(",")}`,
            ...columns,
          ].join(",")
        : columns.join(",");
      const answer: Array<Record<string, unknown>> | undefined = answers[key];

      if (!answer) {
        throw new Error(`No answer for ${key}`);
      }

      return { data: answer };
    },
  );
}

function requestsOf(
  spy: jest.SpyInstance<any, any>,
): Array<AggregateBy<CloudCost>> {
  return spy.mock.calls.map((call: Array<any>): AggregateBy<CloudCost> => {
    return (call[0] as AggregateRequest).aggregateBy;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the dimensions", () => {
  test("a column of the costs is read as one; an environment, an app and a tag are not", () => {
    for (const dimension of [
      "service",
      "region",
      "cloudAccountId",
      "resourceId",
    ] as const) {
      expect(isCloudCostColumnDimension(dimension)).toBe(true);
    }

    for (const dimension of ["environment", "app", "tag"] as const) {
      expect(isCloudCostColumnDimension(dimension)).toBe(false);
    }
  });

  test("shares as a list shows them: the costliest first, by key on a tie, none that rounds to nothing", () => {
    expect(
      sortCloudCostShares([
        { key: "b", amount: 5 },
        { key: "zero", amount: 0.004 },
        { key: "a", amount: 5 },
        { key: "credit", amount: -0.001 },
        { key: "c", amount: 9 },
        { key: "refund", amount: -3 },
      ]),
    ).toEqual([
      { key: "c", amount: 9 },
      { key: "a", amount: 5 },
      { key: "b", amount: 5 },
      { key: "refund", amount: -3 },
    ]);
  });
});

describe("the tags a breakdown by tag offers", () => {
  test("each account's tags, added up by key in the page's currency, the costliest first", () => {
    expect(
      mergeCloudCostTagKeys({
        summaries: [
          summary({
            tagKeys: [
              { key: "team", amount: 300 },
              { key: "env", amount: 120 },
            ],
          }),
          summary({
            tagKeys: [
              { key: "env", amount: 200 },
              { key: "cost-center", amount: 20 },
            ],
          }),
          // Another currency, an account not read, none read and no account.
          summary({
            currency: "EUR",
            tagKeys: [{ key: "owner", amount: 900 }],
          }),
          summary({
            state: CloudCostState.NotAllowed,
            tagKeys: [{ key: "squad", amount: 800 }],
          }),
          summary({}),
          null,
        ],
        currency: "usd",
      }),
    ).toEqual([
      { key: "env", amount: 320 },
      { key: "team", amount: 300 },
      { key: "cost-center", amount: 20 },
    ]);
  });

  test("a tie is by key, as a computer orders it: the same in every language", () => {
    expect(
      mergeCloudCostTagKeys({
        summaries: [
          summary({
            tagKeys: [
              { key: "b", amount: 5 },
              { key: "B", amount: 5 },
              { key: "a", amount: 5 },
            ],
          }),
        ],
        currency: "USD",
      }).map((entry: { key: string }): string => {
        return entry.key;
      }),
    ).toEqual(["B", "a", "b"]);
  });
});

describe("the costs summed by their columns", () => {
  test("the whole period by the columns asked, in one currency; every column read as text, every sum as a number", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      "accountId,region,service": [
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon EC2",
          value: "41.5",
        },
        { accountId: null, service: "Tax", value: 3 },
        { accountId: "123456789012", region: "", service: "", value: "x" },
      ],
    });

    const rows: Array<CloudPlatformCostRow> = await fetchCloudCostRows({
      scope: scope(),
      groupBy: ["accountId", "region", "service"],
    });

    expect(rows).toEqual([
      {
        accountId: "123456789012",
        region: "us-east-1",
        service: "Amazon EC2",
        resourceId: "",
        amount: 41.5,
      },
      { accountId: "", region: "", service: "Tax", resourceId: "", amount: 3 },
      {
        accountId: "123456789012",
        region: "",
        service: "",
        resourceId: "",
        amount: 0,
      },
    ]);

    const request: AggregateBy<CloudCost> = requestsOf(aggregate)[0]!;
    expect(request.aggregationInterval).toBe(AggregationInterval.Total);
    expect(request.groupBy).toEqual({
      accountId: true,
      region: true,
      service: true,
    });
    expect(request.query).toMatchObject({
      projectId: PROJECT,
      currency: "USD",
    });
    expect(request.query).not.toHaveProperty("service");
    expect(request.groupByAttributeKeys).toBeUndefined();
  });

  test("only the services asked for, when a list is given", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      "accountId,region,service,resourceId": [],
    });

    await fetchCloudCostRows({
      scope: scope(),
      groupBy: ["accountId", "region", "service", "resourceId"],
      services: ["Cloud Run", "AWS App Runner"],
    });

    expect(
      requestsOf(aggregate)[0]!.query["service" as keyof CloudCost] as unknown,
    ).toEqual(new Includes(["Cloud Run", "AWS App Runner"]));
  });
});

describe("the costs summed by a tag's value", () => {
  test("the one key asked, through the attribute grouping; a cost without the tag is ''", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      "tag:team": [
        { attributes: { team: "web" }, value: 120 },
        { attributes: { team: "" }, value: "30" },
        { attributes: null, value: 5 },
        { value: 1 },
      ],
    });

    const rows: Array<CloudPlatformTaggedCostRow> = await fetchCloudCostTagRows(
      { scope: scope(), tagKey: "team" },
    );

    expect(rows).toEqual([
      { accountId: "", region: "", value: "web", amount: 120 },
      { accountId: "", region: "", value: "", amount: 30 },
      { accountId: "", region: "", value: "", amount: 5 },
      { accountId: "", region: "", value: "", amount: 1 },
    ]);

    const request: AggregateBy<CloudCost> = requestsOf(aggregate)[0]!;
    expect(request.groupByAttributeKeys).toEqual(["team"]);
    expect(request.groupBy).toBeUndefined();
    expect(request.aggregationInterval).toBe(AggregationInterval.Total);
  });

  test("by place too, when asked: the account and Region of each value's costs", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      [`tag:${ELASTIC_BEANSTALK_ENVIRONMENT_TAG},accountId,region`]: [
        {
          attributes: { [ELASTIC_BEANSTALK_ENVIRONMENT_TAG]: "shop-prod" },
          accountId: "123456789012",
          region: "us-east-1",
          value: 70,
        },
      ],
    });

    expect(
      await fetchCloudCostTagRows({
        scope: scope(),
        tagKey: ELASTIC_BEANSTALK_ENVIRONMENT_TAG,
        byPlace: true,
      }),
    ).toEqual([
      {
        accountId: "123456789012",
        region: "us-east-1",
        value: "shop-prod",
        amount: 70,
      },
    ]);
    expect(requestsOf(aggregate)[0]!.groupBy).toEqual({
      accountId: true,
      region: true,
    });
  });
});

describe("the project's environments and apps", () => {
  test("the environments App Platforms holds and every app, each with what finds its costs", async () => {
    const environment: CloudResource = new CloudResource();
    environment._id = ECS_ENV;
    environment.name = "shop-ecs";
    environment.cloudPlatform = ManagedCloudPlatform.AwsEcs;
    environment.cloudProvider = "aws" as never;
    environment.cloudAccountId = "123456789012";
    environment.cloudRegion = "us-east-1";

    // No platform: not an environment a cost can be found by.
    const unknown: CloudResource = new CloudResource();
    unknown._id = "20000000-0000-4000-8000-0000000000ff";
    unknown.name = "unknown";

    const app: CloudApp = new CloudApp();
    app._id = ORDERS_APP;
    app.name = "orders";
    app.cloudResourceId = new ObjectID(ECS_ENV);

    const eb: CloudApp = new CloudApp();
    eb._id = SHOP_APP;
    eb.name = "shop";
    eb.cloudResourceId = new ObjectID(EB_ENV);
    eb.groupName = "shop-prod";

    // An app of no environment: none of its costs can be found.
    const orphan: CloudApp = new CloudApp();
    orphan._id = "30000000-0000-4000-8000-0000000000ff";
    orphan.name = "orphan";

    const getList: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockImplementation(
      async (request: { modelType: unknown }): Promise<unknown> => {
        return request.modelType === CloudResource
          ? { data: [environment, unknown], count: 2 }
          : { data: [app, eb, orphan], count: 3 };
      },
    );

    expect(await fetchCloudCostPlatformLists()).toEqual({
      environments: [
        {
          id: ECS_ENV,
          name: "shop-ecs",
          platform: ManagedCloudPlatform.AwsEcs,
          provider: "aws",
          accountId: "123456789012",
          region: "us-east-1",
        },
      ],
      apps: [
        {
          id: ORDERS_APP,
          environmentId: ECS_ENV,
          name: "orders",
          groupName: undefined,
        },
        {
          id: SHOP_APP,
          environmentId: EB_ENV,
          name: "shop",
          groupName: "shop-prod",
        },
      ],
    });

    const requests: Array<{
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
    }> = getList.mock.calls.map((call: Array<any>) => {
      return call[0];
    });
    const environments: { query: Record<string, unknown> } = requests.find(
      (request: { modelType: unknown }): boolean => {
        return request.modelType === CloudResource;
      },
    )!;

    expect(environments.query).toEqual({
      cloudResourceKind: CloudResourceKind.Environment,
    });
    expect(
      requests.some((request: { modelType: unknown }): boolean => {
        return request.modelType === CloudApp;
      }),
    ).toBe(true);
  });
});

describe("a breakdown", () => {
  test("by a column: its shares, adding up to the period's spend, and no rest", async () => {
    stubAggregate({
      service: [
        { service: "Amazon EC2", value: 70 },
        { service: "Amazon S3", value: 30 },
      ],
    });

    expect(
      await fetchCloudCostBreakdown({ scope: scope(), dimension: "service" }),
    ).toEqual({
      shares: [
        { key: "Amazon EC2", amount: 70 },
        { key: "Amazon S3", amount: 30 },
      ],
      rest: [],
      total: 100,
    });
  });

  test("by a tag: each value its share, the costs without it said under the list", async () => {
    stubAggregate({
      "tag:team": [
        { attributes: { team: "web" }, value: 120 },
        { attributes: { team: "data" }, value: 80 },
        { attributes: { team: "" }, value: 50 },
      ],
    });

    const result: CloudCostBreakdownResult = await fetchCloudCostBreakdown({
      scope: scope(),
      dimension: "tag",
      tagKey: "team",
    });

    expect(result).toEqual({
      shares: [
        { key: "web", amount: 120 },
        { key: "data", amount: 80 },
      ],
      rest: [{ kind: "without-tag", amount: 50 }],
      total: 250,
    });
  });

  test("by a tag every cost carries: no rest", async () => {
    stubAggregate({
      "tag:team": [{ attributes: { team: "web" }, value: 120 }],
    });

    expect(
      (
        await fetchCloudCostBreakdown({
          scope: scope(),
          dimension: "tag",
          tagKey: "team",
        })
      ).rest,
    ).toEqual([]);
  });

  test("by a tag, before any is chosen: nothing read", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({});

    expect(
      await fetchCloudCostBreakdown({ scope: scope(), dimension: "tag" }),
    ).toEqual({ shares: [], rest: [], total: 0 });
    expect(aggregate).not.toHaveBeenCalled();
  });

  test("by environment: each environment's platform costs, what is in none said under the list", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      "accountId,region,service": [
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon Elastic Container Service",
          value: 200,
        },
        {
          accountId: "acme-prod",
          region: "europe-west1",
          service: "Cloud Run",
          value: 90,
        },
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon EC2",
          value: 110,
        },
      ],
    });

    const result: CloudCostBreakdownResult = await fetchCloudCostBreakdown({
      scope: scope(),
      dimension: "environment",
      lists: LISTS,
    });

    expect(result).toEqual({
      shares: [
        { key: ECS_ENV, amount: 200 },
        { key: RUN_ENV, amount: 90 },
      ],
      rest: [{ kind: "not-in-environment", amount: 110 }],
      total: 400,
    });
    // No Elastic Beanstalk environment: its tag is not read.
    expect(
      requestsOf(aggregate).some((request: AggregateBy<CloudCost>): boolean => {
        return Boolean(request.groupByAttributeKeys);
      }),
    ).toBe(false);
  });

  test("by environment with an Elastic Beanstalk one: what carries its name, by place", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      "accountId,region,service": [
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon EC2",
          value: 110,
        },
      ],
      [`tag:${ELASTIC_BEANSTALK_ENVIRONMENT_TAG},accountId,region`]: [
        {
          attributes: { [ELASTIC_BEANSTALK_ENVIRONMENT_TAG]: "shop-prod" },
          accountId: "123456789012",
          region: "us-east-1",
          value: 60,
        },
        {
          attributes: { [ELASTIC_BEANSTALK_ENVIRONMENT_TAG]: "" },
          accountId: "123456789012",
          region: "us-east-1",
          value: 50,
        },
      ],
    });

    const result: CloudCostBreakdownResult = await fetchCloudCostBreakdown({
      scope: scope(),
      dimension: "environment",
      lists: EB_LISTS,
    });

    expect(result).toEqual({
      shares: [{ key: EB_ENV, amount: 60 }],
      rest: [{ kind: "not-in-environment", amount: 50 }],
      total: 110,
    });
    expect(
      requestsOf(aggregate).find((request: AggregateBy<CloudCost>): boolean => {
        return Boolean(request.groupByAttributeKeys);
      })!.groupByAttributeKeys,
    ).toEqual([ELASTIC_BEANSTALK_ENVIRONMENT_TAG]);
  });

  test("by app: each app's billed resources; what its environment is billed that is no one app's, and what is in none, under the list", async () => {
    const aggregate: jest.SpyInstance<any, any> = stubAggregate({
      "accountId,region,service": [
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon Elastic Container Service",
          value: 200,
        },
        {
          accountId: "acme-prod",
          region: "europe-west1",
          service: "Cloud Run",
          value: 90,
        },
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon EC2",
          value: 110,
        },
      ],
      "accountId,region,service,resourceId": [
        // ECS bills its tasks, never an app: the environment's.
        {
          accountId: "123456789012",
          region: "us-east-1",
          service: "Amazon Elastic Container Service",
          resourceId: "",
          value: 200,
        },
        {
          accountId: "acme-prod",
          region: "europe-west1",
          service: "Cloud Run",
          resourceId:
            "//run.googleapis.com/projects/acme-prod/locations/europe-west1/services/checkout",
          value: 75,
        },
        {
          accountId: "acme-prod",
          region: "europe-west1",
          service: "Cloud Run",
          resourceId: "",
          value: 15,
        },
      ],
    });

    const result: CloudCostBreakdownResult = await fetchCloudCostBreakdown({
      scope: scope(),
      dimension: "app",
      lists: LISTS,
    });

    expect(result).toEqual({
      shares: [{ key: CHECKOUT_APP, amount: 75 }],
      rest: [
        { kind: "not-one-app", amount: 215 },
        { kind: "not-in-environment", amount: 110 },
      ],
      total: 400,
    });
    expect(
      result.shares.reduce((sum: number, share: { amount: number }) => {
        return sum + share.amount;
      }, 0) +
        result.rest.reduce((sum: number, rest: { amount: number }) => {
          return sum + rest.amount;
        }, 0),
    ).toBe(result.total);

    // The resources read are the platforms' services alone.
    const byResource: AggregateBy<CloudCost> = requestsOf(aggregate).find(
      (request: AggregateBy<CloudCost>): boolean => {
        return Boolean(request.groupBy && "resourceId" in request.groupBy);
      },
    )!;
    expect(byResource.query["service" as keyof CloudCost] as unknown).toEqual(
      new Includes([...CLOUD_PLATFORM_ALL_BILLED_SERVICES]),
    );
  });

  test("by environment, with none in the accounts: the whole spend is the rest", async () => {
    stubAggregate({
      "accountId,region,service": [
        {
          accountId: "1",
          region: "us-east-1",
          service: "Amazon EC2",
          value: 40,
        },
      ],
    });

    expect(
      await fetchCloudCostBreakdown({
        scope: scope(),
        dimension: "environment",
      }),
    ).toEqual({
      shares: [],
      rest: [{ kind: "not-in-environment", amount: 40 }],
      total: 40,
    });
  });
});

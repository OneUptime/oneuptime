import {
  AWS_RESOURCE_COSTS_INTERVAL_MS,
  AWS_RESOURCE_COST_ACTION,
  AWS_RESOURCE_COST_DAYS,
  AWS_RESOURCE_COST_MAX_PAGES,
  AWS_RESOURCE_COST_RECENT_DAYS,
  AwsResourceCost,
  AwsResourcePlace,
  AwsResourcePlaces,
  describeAwsResourceCostFailure,
  getAwsArnTail,
  getAwsResourceCostServices,
  getAwsResourceCostWindow,
  getCloudCostDays,
  getEarlierCostDay,
  isAwsResourceCostsDue,
  isAwsResourceKey,
  parseAwsArn,
  readAwsResourceCosts,
  splitAwsCostsByResource,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsResourceCosts";
import {
  CloudConnectorCallOptions,
  CloudCostRecord,
  CloudKnownResource,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * What each resource of an AWS account costs, from Cost Explorer's
 * resource-level data (opt-in, 14 days): the days a read takes and when it
 * is due, the services it asks for, where each resource is kept (under
 * OneUptime's own id for it when OneUptime holds it), how the resources
 * are laid over the account's own figures so they still add up - and the
 * read itself against Cost Explorer stood in: its request, its pages, its
 * limit, a throttled answer, and the errors that say what to do.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const ACCOUNT: string = "123456789012";
const OTHER_ACCOUNT: string = "210987654321";
const CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAEXAMPLEEXAMPLE00",
  secretAccessKey: "secret-example-secret-example-secret0000",
};
const EC2: string = "Amazon Elastic Compute Cloud - Compute";
const RDS: string = "Amazon Relational Database Service";
const S3: string = "Amazon Simple Storage Service";

function known(fields: Partial<CloudKnownResource>): CloudKnownResource {
  return {
    providerResourceId: "",
    resourceType: "",
    name: "",
    region: "us-east-1",
    accountId: ACCOUNT,
    resourceGroup: "",
    ...fields,
  };
}

const KNOWN: Array<CloudKnownResource> = [
  known({
    providerResourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
    resourceType: "AWS::EC2::Instance",
    name: "web-1",
  }),
  known({
    providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
    resourceType: "AWS::RDS::DBInstance",
    name: "orders-db",
  }),
  known({
    providerResourceId: "arn:aws:s3:::acme-assets",
    resourceType: "AWS::S3::Bucket",
    name: "acme-assets",
    region: "us-east-1",
  }),
  // Two resources whose ARNs end in one name: never guessed between.
  known({
    providerResourceId: "arn:aws:s3:::orders",
    resourceType: "AWS::S3::Bucket",
    name: "orders",
  }),
  known({
    providerResourceId: "arn:aws:dynamodb:us-east-1:123456789012:table/orders",
    resourceType: "AWS::DynamoDB::Table",
    name: "orders",
  }),
  known({
    providerResourceId: "arn:aws:ec2:eu-west-1:210987654321:instance/i-0eu",
    resourceType: "AWS::EC2::Instance",
    name: "eu-1",
    region: "eu-west-1",
    accountId: OTHER_ACCOUNT,
  }),
];

function record(fields: Partial<CloudCostRecord>): CloudCostRecord {
  return {
    accountId: ACCOUNT,
    day: "2026-11-19",
    service: EC2,
    region: "us-east-1",
    resourceId: "",
    currency: "USD",
    amount: 100,
    ...fields,
  };
}

function cost(fields: Partial<AwsResourceCost>): AwsResourceCost {
  return {
    day: "2026-11-19",
    service: EC2,
    resourceId: "",
    currency: "USD",
    amount: 0,
    ...fields,
  };
}

function options(api: FakeProviderApi): CloudConnectorCallOptions {
  return {
    transport: api.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

function budget(maxRequests: number = 50): CloudReadBudget {
  return new CloudReadBudget({ maxRequests, maxDurationMs: 60_000 });
}

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

// One day's groups, as GetCostAndUsageWithResources answers them.
function period(
  day: string,
  groups: Array<[string, string, string]>,
): JSONObject {
  return {
    TimePeriod: { Start: day, End: day },
    Estimated: true,
    Groups: groups.map(
      ([service, resource, amount]: [string, string, string]) => {
        return {
          Keys: [service, resource],
          Metrics: { UnblendedCost: { Amount: amount, Unit: "USD" } },
        };
      },
    ),
  };
}

function costExplorer(pages: Array<FakeResponse>): FakeProviderApi {
  let index: number = 0;

  return createFakeProviderApi([
    {
      path: "/",
      host: "ce.us-east-1.amazonaws.com",
      respond: (): FakeResponse => {
        const page: FakeResponse = pages[Math.min(index, pages.length - 1)]!;
        index++;
        return page;
      },
    },
  ]);
}

describe("when the costs per resource are read, and over which days", () => {
  test(`the first read takes the ${AWS_RESOURCE_COST_DAYS} days Cost Explorer keeps, today among them`, () => {
    const window: { start: Date; end: Date; isFirstRead: boolean } =
      getAwsResourceCostWindow({ now: NOW });

    expect(window.isFirstRead).toBe(true);
    expect(window.start.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-21T00:00:00.000Z");
    expect(getCloudCostDays(window).size).toBe(AWS_RESOURCE_COST_DAYS);
  });

  test(`a read a day after the last takes the last ${AWS_RESOURCE_COST_RECENT_DAYS} days again: the ones AWS still finishes`, () => {
    const window: { start: Date; end: Date; isFirstRead: boolean } =
      getAwsResourceCostWindow({
        now: NOW,
        lastReadAt: "2026-11-19T11:00:00.000Z",
      });

    expect(window.isFirstRead).toBe(false);
    expect(window.start.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(Array.from(getCloudCostDays(window))).toEqual([
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
  });

  test("after a gap, every day since the last read - never further than Cost Explorer keeps", () => {
    expect(
      getAwsResourceCostWindow({
        now: NOW,
        lastReadAt: "2026-11-14T08:00:00.000Z",
      }).start.toISOString(),
    ).toBe("2026-11-12T00:00:00.000Z");
    expect(
      getAwsResourceCostWindow({
        now: NOW,
        lastReadAt: "2026-09-01T08:00:00.000Z",
      }).start.toISOString(),
    ).toBe("2026-11-07T00:00:00.000Z");
    // A stored time that is not one is no read: the first read's days.
    expect(
      getAwsResourceCostWindow({ now: NOW, lastReadAt: "soon" }).isFirstRead,
    ).toBe(true);
  });

  test("once a day: due with none read, or a day after the last", () => {
    expect(isAwsResourceCostsDue({ now: NOW })).toBe(true);
    expect(
      isAwsResourceCostsDue({
        now: NOW,
        lastReadAt: new Date(
          NOW.getTime() - AWS_RESOURCE_COSTS_INTERVAL_MS + 1000,
        ).toISOString(),
      }),
    ).toBe(false);
    expect(
      isAwsResourceCostsDue({
        now: NOW,
        lastReadAt: new Date(
          NOW.getTime() - AWS_RESOURCE_COSTS_INTERVAL_MS,
        ).toISOString(),
      }),
    ).toBe(true);
    expect(AWS_RESOURCE_COSTS_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("the earlier of two starts, as the day it is", () => {
    expect(
      getEarlierCostDay(
        new Date("2026-11-13T00:00:00.000Z"),
        new Date("2026-11-07T15:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-11-07T00:00:00.000Z");
  });
});

describe("the services a read asks for", () => {
  test("those billed on the window's days, the costliest first, once each", () => {
    expect(
      getAwsResourceCostServices({
        records: [
          record({ service: S3, amount: 5 }),
          record({ service: RDS, amount: 80 }),
          record({ service: EC2, amount: 50 }),
          record({ service: EC2, region: "eu-west-1", amount: 40 }),
          // Before the window: not asked.
          record({ service: "AWS Glue", day: "2026-11-01", amount: 900 }),
          record({ service: "", amount: 1 }),
        ],
        start: new Date("2026-11-17T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
      }),
    ).toEqual([EC2, RDS, S3]);
  });
});

describe("what Cost Explorer's keys and ARNs say", () => {
  test("a cost no resource is named for, in any of Cost Explorer's spellings", () => {
    expect(isAwsResourceKey("NoResourceId")).toBe(false);
    expect(isAwsResourceKey("No resource ID")).toBe(false);
    expect(isAwsResourceKey(" ")).toBe(false);
    expect(isAwsResourceKey("i-0web1")).toBe(true);
  });

  test("an ARN's parts, and its tail", () => {
    expect(parseAwsArn("arn:aws:rds:us-east-1:123456789012:db:orders")).toEqual(
      { service: "rds", region: "us-east-1", accountId: "123456789012" },
    );
    expect(parseAwsArn("arn:aws:s3:::acme-assets")).toEqual({
      service: "s3",
      region: "",
      accountId: "",
    });
    expect(parseAwsArn("i-0web1")).toBeNull();
    expect(parseAwsArn("arn:aws:s3")).toBeNull();
    expect(getAwsArnTail("arn:aws:ec2:us-east-1:1:instance/i-0web1")).toBe(
      "i-0web1",
    );
    expect(getAwsArnTail("arn:aws:rds:us-east-1:1:db:orders")).toBe("orders");
    expect(getAwsArnTail("plain")).toBe("plain");
  });
});

describe("where a resource is kept", () => {
  const places: AwsResourcePlaces = new AwsResourcePlaces({
    knownResources: KNOWN,
    onlyAccountId: ACCOUNT,
  });

  test("a resource OneUptime holds, under its own id: so its page and its right-sizing find its costs", () => {
    // Cost Explorer names an instance by its id; OneUptime holds its ARN.
    expect(places.placeOf("i-0web1")).toEqual({
      resourceKey: "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
      accountId: ACCOUNT,
      region: "us-east-1",
    });
    // A bucket by its name.
    expect(places.placeOf("acme-assets")!.resourceKey).toBe(
      "arn:aws:s3:::acme-assets",
    );
    // An ARN Cost Explorer writes whole, in any case.
    expect(
      places.placeOf("ARN:AWS:RDS:US-EAST-1:123456789012:DB:ORDERS-DB")!
        .resourceKey,
    ).toBe("arn:aws:rds:us-east-1:123456789012:db:orders-db");
  });

  test("two resources of one name are never guessed between", () => {
    const place: AwsResourcePlace | null = places.placeOf("orders");

    // Kept under Cost Explorer's own id, in the one account read.
    expect(place).toEqual({
      resourceKey: "orders",
      accountId: ACCOUNT,
      region: "",
    });
  });

  test("a resource OneUptime does not hold: its ARN's account and Region, or the one account read", () => {
    expect(
      places.placeOf("arn:aws:lambda:eu-west-1:123456789012:function:resize"),
    ).toEqual({
      resourceKey: "arn:aws:lambda:eu-west-1:123456789012:function:resize",
      accountId: ACCOUNT,
      region: "eu-west-1",
    });
    expect(places.placeOf("vol-0gone")).toEqual({
      resourceKey: "vol-0gone",
      accountId: ACCOUNT,
      region: "",
    });
  });

  test("in an organization, a plain id OneUptime does not hold names no account: it is not kept apart", () => {
    const organization: AwsResourcePlaces = new AwsResourcePlaces({
      knownResources: KNOWN,
      onlyAccountId: "",
    });

    expect(organization.placeOf("vol-0gone")).toBeNull();
    expect(organization.placeOf("i-0eu")).toEqual({
      resourceKey: "arn:aws:ec2:eu-west-1:210987654321:instance/i-0eu",
      accountId: OTHER_ACCOUNT,
      region: "eu-west-1",
    });
  });
});

describe("the resources, laid over the account's own figures", () => {
  const places: AwsResourcePlaces = new AwsResourcePlaces({
    knownResources: KNOWN,
    onlyAccountId: ACCOUNT,
  });
  const COVERED: Set<string> = new Set<string>(["2026-11-19"]);

  function sumOf(records: Array<CloudCostRecord>): number {
    return records.reduce((sum: number, entry: CloudCostRecord): number => {
      return sum + entry.amount;
    }, 0);
  }

  test("a figure of a day read becomes its resources' costs and the rest: the same total", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [record({ amount: 100 }), record({ service: RDS, amount: 60 })],
      resourceCosts: [
        cost({ resourceId: "i-0web1", amount: 70 }),
        // An instance gone since: no Region of its own, but EC2 was billed
        // in one Region that day.
        cost({ resourceId: "i-0gone", amount: 12.5 }),
        cost({
          service: RDS,
          resourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
          amount: 60,
        }),
      ],
      coveredDays: COVERED,
      places,
    });

    expect(
      records.map((entry: CloudCostRecord) => {
        return [entry.service, entry.resourceId, entry.amount, entry.region];
      }),
    ).toEqual([
      [
        EC2,
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
        70,
        "us-east-1",
      ],
      [EC2, "i-0gone", 12.5, "us-east-1"],
      [EC2, "", 17.5, "us-east-1"],
      [RDS, "arn:aws:rds:us-east-1:123456789012:db:orders-db", 60, "us-east-1"],
    ]);
    expect(sumOf(records)).toBe(160);
    // None of these is a whole-service figure: the day was read.
    expect(
      records.every((entry: CloudCostRecord): boolean => {
        return !entry.isServiceTotal;
      }),
    ).toBe(true);
  });

  test("a resource with no Region of its own, of a service billed in two Regions, stays in the rest: never counted twice", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [
        record({ amount: 100 }),
        record({ region: "eu-west-1", amount: 40 }),
      ],
      resourceCosts: [cost({ resourceId: "i-0gone", amount: 30 })],
      coveredDays: COVERED,
      places,
    });

    expect(
      records.map((entry: CloudCostRecord) => {
        return [entry.region, entry.resourceId, entry.amount];
      }),
    ).toEqual([
      ["us-east-1", "", 100],
      ["eu-west-1", "", 40],
    ]);
  });

  test("resources that come to more than a figure read a little earlier are the newer figure: the rest is never below nothing", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [record({ amount: 50 })],
      resourceCosts: [cost({ resourceId: "i-0web1", amount: 52.25 })],
      coveredDays: COVERED,
      places,
    });

    expect(
      records.map((entry: CloudCostRecord) => {
        return [entry.resourceId, entry.amount];
      }),
    ).toEqual([["arn:aws:ec2:us-east-1:123456789012:instance/i-0web1", 52.25]]);
  });

  test("a day the read did not cover is the whole of its service and Region: what it was split into before is kept", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [
        record({ day: "2026-11-15", amount: 90 }),
        record({ amount: 100 }),
      ],
      resourceCosts: [
        // Cost Explorer's figure for a day not covered is not used.
        cost({ day: "2026-11-15", resourceId: "i-0web1", amount: 90 }),
        cost({ resourceId: "i-0web1", amount: 25 }),
      ],
      coveredDays: COVERED,
      places,
    });

    expect(
      records.map((entry: CloudCostRecord) => {
        return [
          entry.day,
          entry.resourceId,
          entry.amount,
          entry.isServiceTotal,
        ];
      }),
    ).toEqual([
      ["2026-11-15", "", 90, true],
      [
        "2026-11-19",
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
        25,
        undefined,
      ],
      ["2026-11-19", "", 75, undefined],
    ]);
  });

  test("no day read at all: every figure keeps its splits", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [record({ amount: 10 }), record({ service: S3, amount: 2 })],
      resourceCosts: [],
      coveredDays: new Set<string>(),
      places,
    });

    expect(
      records.every((entry: CloudCostRecord): boolean => {
        return entry.isServiceTotal === true;
      }),
    ).toBe(true);
    expect(sumOf(records)).toBe(12);
  });

  test("an organization's figures are by account and service: its resources go under them, by account", () => {
    const organization: AwsResourcePlaces = new AwsResourcePlaces({
      knownResources: KNOWN,
      onlyAccountId: "",
    });
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [
        record({ region: "", amount: 100 }),
        record({ accountId: OTHER_ACCOUNT, region: "", amount: 30 }),
      ],
      resourceCosts: [
        cost({ resourceId: "i-0web1", amount: 40 }),
        cost({ resourceId: "i-0eu", amount: 20 }),
        // A plain id in an organization: no account to keep it under.
        cost({ resourceId: "vol-0gone", amount: 5 }),
      ],
      coveredDays: COVERED,
      places: organization,
    });

    expect(
      records.map((entry: CloudCostRecord) => {
        return [entry.accountId, entry.region, entry.resourceId, entry.amount];
      }),
    ).toEqual([
      [ACCOUNT, "", "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1", 40],
      [ACCOUNT, "", "", 60],
      [
        OTHER_ACCOUNT,
        "",
        "arn:aws:ec2:eu-west-1:210987654321:instance/i-0eu",
        20,
      ],
      [OTHER_ACCOUNT, "", "", 10],
    ]);
  });

  test("a resource's costs of one day on two pages are added up", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [record({ amount: 100 })],
      resourceCosts: [
        cost({ resourceId: "i-0web1", amount: 30 }),
        cost({
          resourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
          amount: 10,
        }),
      ],
      coveredDays: COVERED,
      places,
    });

    expect(records[0]).toEqual(
      expect.objectContaining({
        resourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1",
        amount: 40,
      }),
    );
    expect(records[1]).toEqual(
      expect.objectContaining({ resourceId: "", amount: 60 }),
    );
  });
});

describe("the read, against Cost Explorer", () => {
  test("asks for the services' resources by day, without credits and refunds, page by page", async () => {
    const api: FakeProviderApi = costExplorer([
      json({
        ResultsByTime: [
          period("2026-11-18", [
            [EC2, "i-0web1", "70.5"],
            // No resource named: what the account's own figure keeps.
            [EC2, "NoResourceId", "29.5"],
            [S3, "acme-assets", "0"],
          ]),
        ],
        NextPageToken: "page-2",
      }),
      json({
        ResultsByTime: [
          period("2026-11-19", [
            [RDS, "arn:aws:rds:us-east-1:123456789012:db:orders-db", "60"],
          ]),
        ],
      }),
    ]);

    const read: { costs: Array<AwsResourceCost>; complete: boolean } =
      await readAwsResourceCosts({
        credentials: CREDENTIALS,
        region: "us-east-1",
        services: [EC2, RDS, S3],
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.complete).toBe(true);
    expect(read.costs).toEqual([
      {
        day: "2026-11-18",
        service: EC2,
        resourceId: "i-0web1",
        currency: "USD",
        amount: 70.5,
      },
      {
        day: "2026-11-19",
        service: RDS,
        resourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
        currency: "USD",
        amount: 60,
      },
    ]);

    expect(api.requests).toHaveLength(2);
    expect((api.requests[0]!.headers || {})["X-Amz-Target"]).toBe(
      "AWSInsightsIndexService.GetCostAndUsageWithResources",
    );
    expect(bodyOf(api.requests[0]!)).toEqual({
      TimePeriod: { Start: "2026-11-18", End: "2026-11-21" },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      Filter: {
        And: [
          { Dimensions: { Key: "SERVICE", Values: [EC2, RDS, S3] } },
          {
            Not: {
              Dimensions: { Key: "RECORD_TYPE", Values: ["Credit", "Refund"] },
            },
          },
        ],
      },
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "DIMENSION", Key: "RESOURCE_ID" },
      ],
    });
    expect(bodyOf(api.requests[1]!)["NextPageToken"]).toBe("page-2");
  });

  test("no service billed: nothing asked, nothing paid", async () => {
    const api: FakeProviderApi = costExplorer([json({ ResultsByTime: [] })]);

    const read: { costs: Array<AwsResourceCost>; complete: boolean } =
      await readAwsResourceCosts({
        credentials: CREDENTIALS,
        region: "us-east-1",
        services: [],
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read).toEqual({ costs: [], complete: true });
    expect(api.requests).toHaveLength(0);
  });

  test(`stops at ${AWS_RESOURCE_COST_MAX_PAGES} pages ($0.01 each), and says it did not finish`, async () => {
    const api: FakeProviderApi = costExplorer([
      json({ ResultsByTime: [], NextPageToken: "more" }),
      json({ ResultsByTime: [], NextPageToken: "even-more" }),
    ]);
    let token: number = 0;
    const endless: FakeProviderApi = createFakeProviderApi([
      {
        path: "/",
        host: "ce.us-east-1.amazonaws.com",
        respond: (): FakeResponse => {
          token++;
          return json({ ResultsByTime: [], NextPageToken: `page-${token}` });
        },
      },
    ]);

    const read: { costs: Array<AwsResourceCost>; complete: boolean } =
      await readAwsResourceCosts({
        credentials: CREDENTIALS,
        region: "us-east-1",
        services: [EC2],
        start: new Date("2026-11-07T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(endless),
        budget: budget(100),
      });

    expect(read.complete).toBe(false);
    expect(endless.requests).toHaveLength(AWS_RESOURCE_COST_MAX_PAGES);
    expect(api.requests).toHaveLength(0);
  });

  test("a throttled answer is asked again, within the read's budget", async () => {
    const api: FakeProviderApi = costExplorer([
      {
        status: 400,
        body: '{"__type":"LimitExceededException","message":"Rate exceeded"}',
      },
      json({
        ResultsByTime: [period("2026-11-19", [[EC2, "i-0web1", "5"]])],
      }),
    ]);
    const spent: CloudReadBudget = budget(5);

    const read: { costs: Array<AwsResourceCost>; complete: boolean } =
      await readAwsResourceCosts({
        credentials: CREDENTIALS,
        region: "us-east-1",
        services: [EC2],
        start: new Date("2026-11-19T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: spent,
      });

    expect(read.costs).toHaveLength(1);
    expect(api.requests).toHaveLength(2);
    // Each try is a request of the budget: Cost Explorer charges for both.
    expect(spent.getUsed()).toBe(2);
  });

  test("a spent budget stops the read where it is", async () => {
    const api: FakeProviderApi = costExplorer([
      json({ ResultsByTime: [], NextPageToken: "more" }),
    ]);

    await expect(
      readAwsResourceCosts({
        credentials: CREDENTIALS,
        region: "us-east-1",
        services: [EC2],
        start: new Date("2026-11-19T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(1),
      }),
    ).rejects.toBeInstanceOf(CloudReadBudgetSpent);
  });
});

describe("why the costs per resource could not be read", () => {
  function refusal(body: string): LlmProviderError {
    return new LlmProviderError({
      message: `AWS resource cost request failed: ${body}`,
      kind: CloudConnectionFailureKind.Permission,
      statusCode: 400,
      responseBody: body,
    });
  }

  test("resource-level data not turned on: where to turn it on", () => {
    const outcome: { state: CloudCostState; message: string } =
      describeAwsResourceCostFailure(
        new LlmProviderError({
          message: "AWS resource cost request failed",
          kind: CloudConnectionFailureKind.Other,
          statusCode: 400,
          responseBody:
            '{"__type":"DataUnavailableException","message":"Data is not available."}',
        }),
      );

    expect(outcome.state).toBe(CloudCostState.NotSetUp);
    expect(outcome.message).toContain(
      "Turn on resource-level data at daily granularity",
    );
    expect(outcome.message).toContain("Cost Management preferences");
    expect(
      describeAwsResourceCostFailure(
        new Error(
          "ValidationException: Resource-level data is not opted in for this account.",
        ),
      ).state,
    ).toBe(CloudCostState.NotSetUp);
  });

  test("a role made before the setup command allowed it: run the command again, naming the action", () => {
    const outcome: { state: CloudCostState; message: string } =
      describeAwsResourceCostFailure(
        refusal(
          '{"__type":"AccessDeniedException","message":"not authorized to perform: ce:GetCostAndUsageWithResources"}',
        ),
      );

    expect(outcome.state).toBe(CloudCostState.NotAllowed);
    expect(outcome.message).toContain(AWS_RESOURCE_COST_ACTION);
    expect(outcome.message).toContain("Run the setup command again");
    expect(AWS_RESOURCE_COST_ACTION).toBe("ce:GetCostAndUsageWithResources");
  });

  test("the read's limit, and anything else: read again, in the cloud's words, cut short", () => {
    expect(describeAwsResourceCostFailure(new CloudReadBudgetSpent())).toEqual({
      state: CloudCostState.Failed,
      message: expect.stringContaining("read again tomorrow"),
    });

    const outcome: { state: CloudCostState; message: string } =
      describeAwsResourceCostFailure(new Error("x".repeat(900)));

    expect(outcome.state).toBe(CloudCostState.Failed);
    expect(outcome.message).toHaveLength(500);
  });
});

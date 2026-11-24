import {
  AWS_AMORTIZED_METRIC,
  AWS_BILLED_METRIC,
  AWS_COST_REQUESTS,
  AWS_NET_METRIC,
  readAwsCostAndUsage,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCosts";
import {
  AWS_RESOURCE_COST_METRICS,
  AwsResourceCost,
  AwsResourcePlaces,
  readAwsResourceCosts,
  splitAwsCostsByResource,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsResourceCosts";
import {
  CloudConnectorCallOptions,
  CloudCostRecord,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * AWS on every basis (#11007): billed and amortized from one Cost
 * Explorer request that leaves credits and refunds out, net from a second
 * that counts them, and costs per resource with all three metrics in the
 * one request they already make. AWS is stood in, answering each request
 * by what it asks: its metrics, and whether it filters record types.
 *
 * The scenario the issue names: a Savings Plan bought all upfront. Its fee
 * is billed on the day it was bought, and the instances it covers are
 * billed nothing after; amortized, the fee is spread over the days and
 * instances it covered.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAEXAMPLEEXAMPLE00",
  secretAccessKey: "secret-example-secret-example-secret0000",
};

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

type Metrics = Record<string, string>;

// One day's groups, each with the metrics asked.
function period(day: string, groups: Array<[Array<string>, Metrics]>): JSONObject {
  return {
    TimePeriod: { Start: day, End: day },
    Groups: groups.map(([keys, metrics]: [Array<string>, Metrics]) => {
      return {
        Keys: keys,
        Metrics: Object.fromEntries(
          Object.entries(metrics).map(([name, amount]: [string, string]) => {
            return [name, { Amount: amount, Unit: "USD" }];
          }),
        ),
      };
    }),
  };
}

/*
 * Cost Explorer answering by what is asked: the billed and amortized
 * request (filtered) its pages, the net request (unfiltered) its own.
 */
function costExplorer(data: {
  filtered: Array<FakeResponse>;
  unfiltered: Array<FakeResponse>;
}): FakeProviderApi {
  const index: { filtered: number; unfiltered: number } = {
    filtered: 0,
    unfiltered: 0,
  };

  return createFakeProviderApi([
    {
      path: "/",
      host: "ce.us-east-1.amazonaws.com",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const body: JSONObject = bodyOf(request);
        const which: "filtered" | "unfiltered" = body["Filter"]
          ? "filtered"
          : "unfiltered";
        const pages: Array<FakeResponse> = data[which];
        const page: FakeResponse =
          pages[Math.min(index[which], pages.length - 1)]!;
        index[which]++;
        return page;
      },
    },
  ]);
}

describe("the requests a window of costs takes", () => {
  test("billed and amortized without credits and refunds, then net with them", () => {
    expect(AWS_COST_REQUESTS).toHaveLength(2);
    expect(AWS_COST_REQUESTS[0]!.metrics).toEqual([
      AWS_BILLED_METRIC,
      AWS_AMORTIZED_METRIC,
    ]);
    expect(JSON.stringify(AWS_COST_REQUESTS[0]!.filter)).toContain(
      '"Values":["Credit","Refund"]',
    );
    expect(AWS_COST_REQUESTS[1]!.metrics).toEqual([AWS_NET_METRIC]);
    expect(AWS_COST_REQUESTS[1]!.filter).toBeUndefined();
    expect([AWS_BILLED_METRIC, AWS_AMORTIZED_METRIC, AWS_NET_METRIC]).toEqual([
      "UnblendedCost",
      "AmortizedCost",
      "NetAmortizedCost",
    ]);
  });
});

describe("an account's costs on every basis", () => {
  test("a Savings Plan bought all upfront: its fee billed on its day, spread when amortized", async () => {
    const api: FakeProviderApi = costExplorer({
      filtered: [
        json({
          ResultsByTime: [
            period("2026-11-17", [
              [
                ["Savings Plans for AWS Compute usage", "global"],
                { UnblendedCost: "8760", AmortizedCost: "0" },
              ],
              [
                ["Amazon Elastic Compute Cloud - Compute", "us-east-1"],
                { UnblendedCost: "0", AmortizedCost: "24" },
              ],
            ]),
            period("2026-11-18", [
              [
                ["Amazon Elastic Compute Cloud - Compute", "us-east-1"],
                { UnblendedCost: "0", AmortizedCost: "24" },
              ],
            ]),
          ],
        }),
      ],
      unfiltered: [
        json({
          ResultsByTime: [
            period("2026-11-17", [
              [
                ["Savings Plans for AWS Compute usage", "global"],
                { NetAmortizedCost: "0" },
              ],
              [
                ["Amazon Elastic Compute Cloud - Compute", "us-east-1"],
                { NetAmortizedCost: "21.6" },
              ],
              // A credit the account received: net only.
              [["Credits", "NoRegion"], { NetAmortizedCost: "-50" }],
            ]),
            period("2026-11-18", [
              [
                ["Amazon Elastic Compute Cloud - Compute", "us-east-1"],
                { NetAmortizedCost: "21.6" },
              ],
            ]),
          ],
        }),
      ],
    });

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-17T00:00:00.000Z"),
        end: new Date("2026-11-19T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.complete).toBe(true);
    expect(api.requests).toHaveLength(2);

    const first: JSONObject = bodyOf(api.requests[0]!);
    const second: JSONObject = bodyOf(api.requests[1]!);
    expect(first["Metrics"]).toEqual(["UnblendedCost", "AmortizedCost"]);
    expect(first["Filter"]).toBeDefined();
    expect(second["Metrics"]).toEqual(["NetAmortizedCost"]);
    expect(second["Filter"]).toBeUndefined();
    expect(second["GroupBy"]).toEqual(first["GroupBy"]);
    expect(second["TimePeriod"]).toEqual(first["TimePeriod"]);

    const byKey: Map<string, CloudCostRecord> = new Map(
      read.records.map((entry: CloudCostRecord) => {
        return [`${entry.day}|${entry.service}|${entry.region}`, entry];
      }),
    );

    expect(
      byKey.get("2026-11-17|Savings Plans for AWS Compute usage|"),
    ).toMatchObject({ amount: 8760, amortizedAmount: 0, netAmount: 0 });
    expect(
      byKey.get("2026-11-17|Amazon Elastic Compute Cloud - Compute|us-east-1"),
    ).toMatchObject({ amount: 0, amortizedAmount: 24, netAmount: 21.6 });
    expect(byKey.get("2026-11-17|Credits|")).toMatchObject({
      amount: 0,
      amortizedAmount: 0,
      netAmount: -50,
    });
    expect(read.records).toHaveLength(4);

    // Billed: the fee on its day. Amortized: the instances' share each day.
    const sum: (key: "amount" | "amortizedAmount" | "netAmount") => number = (
      key: "amount" | "amortizedAmount" | "netAmount",
    ): number => {
      return read.records.reduce((total: number, entry: CloudCostRecord) => {
        return total + (Number(entry[key]) || 0);
      }, 0);
    };
    expect(sum("amount")).toBe(8760);
    expect(sum("amortizedAmount")).toBe(48);
    expect(sum("netAmount")).toBeCloseTo(-6.8, 6);
  });

  test("an organization's are by account and service on both requests", async () => {
    const api: FakeProviderApi = costExplorer({
      filtered: [
        json({
          ResultsByTime: [
            period("2026-11-18", [
              [
                ["210987654321", "Amazon Simple Storage Service"],
                { UnblendedCost: "5", AmortizedCost: "5" },
              ],
            ]),
          ],
        }),
      ],
      unfiltered: [
        json({
          ResultsByTime: [
            period("2026-11-18", [
              [
                ["210987654321", "Amazon Simple Storage Service"],
                { NetAmortizedCost: "4.5" },
              ],
            ]),
          ],
        }),
      ],
    });

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "",
        groupByAccount: true,
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-19T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(bodyOf(api.requests[1]!)["GroupBy"]).toEqual([
      { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
      { Type: "DIMENSION", Key: "SERVICE" },
    ]);
    expect(read.records).toEqual([
      {
        accountId: "210987654321",
        day: "2026-11-18",
        service: "Amazon Simple Storage Service",
        region: "",
        resourceId: "",
        currency: "USD",
        amount: 5,
        amortizedAmount: 5,
        netAmount: 4.5,
      },
    ]);
  });

  test("each request follows its own pages", async () => {
    const api: FakeProviderApi = costExplorer({
      filtered: [
        json({
          ResultsByTime: [
            period("2026-11-18", [
              [["Amazon EC2", "us-east-1"], { UnblendedCost: "1", AmortizedCost: "1" }],
            ]),
          ],
          NextPageToken: "filtered-2",
        }),
        json({
          ResultsByTime: [
            period("2026-11-18", [
              [["Amazon S3", "us-east-1"], { UnblendedCost: "2", AmortizedCost: "2" }],
            ]),
          ],
        }),
      ],
      unfiltered: [
        json({
          ResultsByTime: [
            period("2026-11-18", [
              [["Amazon EC2", "us-east-1"], { NetAmortizedCost: "0.9" }],
              [["Amazon S3", "us-east-1"], { NetAmortizedCost: "1.8" }],
            ]),
          ],
        }),
      ],
    });

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-19T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(api.requests).toHaveLength(3);
    expect(bodyOf(api.requests[1]!)["NextPageToken"]).toBe("filtered-2");
    expect(bodyOf(api.requests[2]!)["NextPageToken"]).toBeUndefined();
    expect(read.complete).toBe(true);
    expect(
      read.records
        .map((entry: CloudCostRecord) => {
          return `${entry.service}:${entry.amount}/${entry.amortizedAmount}/${entry.netAmount}`;
        })
        .sort(),
    ).toEqual(["Amazon EC2:1/1/0.9", "Amazon S3:2/2/1.8"]);
  });

  test("a net request that stops at its page limit leaves the read incomplete", async () => {
    const api: FakeProviderApi = costExplorer({
      filtered: [json({ ResultsByTime: [] })],
      unfiltered: [json({ ResultsByTime: [], NextPageToken: "more" }), json({ ResultsByTime: [], NextPageToken: "more-2" })],
    });

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-19T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.complete).toBe(false);
  });

  test("a group the cloud answers with nothing on every metric is no record", async () => {
    const api: FakeProviderApi = costExplorer({
      filtered: [
        json({
          ResultsByTime: [
            period("2026-11-18", [
              [["Tax", "NoRegion"], { UnblendedCost: "0", AmortizedCost: "0" }],
            ]),
          ],
        }),
      ],
      unfiltered: [
        json({
          ResultsByTime: [
            period("2026-11-18", [[["Tax", "NoRegion"], { NetAmortizedCost: "0" }]]),
          ],
        }),
      ],
    });

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-19T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.records).toEqual([]);
  });
});

describe("costs per resource on every basis", () => {
  test("one request asks for all three metrics, and a resource a plan covers is kept though billed nothing", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/",
        host: "ce.us-east-1.amazonaws.com",
        respond: (): FakeResponse => {
          return json({
            ResultsByTime: [
              period("2026-11-18", [
                [
                  ["Amazon Elastic Compute Cloud - Compute", "i-0abc"],
                  {
                    UnblendedCost: "0",
                    AmortizedCost: "12",
                    NetAmortizedCost: "10.8",
                  },
                ],
                [
                  ["Amazon Elastic Compute Cloud - Compute", "NoResourceId"],
                  {
                    UnblendedCost: "3",
                    AmortizedCost: "3",
                    NetAmortizedCost: "3",
                  },
                ],
              ]),
            ],
          });
        },
      },
    ]);

    const read: { costs: Array<AwsResourceCost>; complete: boolean } =
      await readAwsResourceCosts({
        credentials: CREDENTIALS,
        region: "us-east-1",
        services: ["Amazon Elastic Compute Cloud - Compute"],
        start: new Date("2026-11-18T00:00:00.000Z"),
        end: new Date("2026-11-19T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(api.requests).toHaveLength(1);
    expect(bodyOf(api.requests[0]!)["Metrics"]).toEqual([
      ...AWS_RESOURCE_COST_METRICS,
    ]);
    expect(read.costs).toEqual([
      {
        day: "2026-11-18",
        service: "Amazon Elastic Compute Cloud - Compute",
        resourceId: "i-0abc",
        currency: "USD",
        amount: 0,
        amortizedAmount: 12,
        netAmount: 10.8,
      },
    ]);
  });

  const places: AwsResourcePlaces = new AwsResourcePlaces({
    knownResources: [],
    onlyAccountId: "123456789012",
  });

  function figure(overrides: Partial<CloudCostRecord>): CloudCostRecord {
    return {
      accountId: "123456789012",
      day: "2026-11-18",
      service: "Amazon EC2",
      region: "us-east-1",
      resourceId: "",
      currency: "USD",
      amount: 100,
      amortizedAmount: 120,
      netAmount: 90,
      ...overrides,
    };
  }

  function cost(overrides: Partial<AwsResourceCost>): AwsResourceCost {
    return {
      day: "2026-11-18",
      service: "Amazon EC2",
      resourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
      currency: "USD",
      amount: 60,
      amortizedAmount: 80,
      netAmount: 75,
      ...overrides,
    };
  }

  test("each figure is split into its resources and the rest on every basis, the parts adding up", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [figure({})],
      resourceCosts: [cost({})],
      coveredDays: new Set<string>(["2026-11-18"]),
      places,
    });
    const resource: CloudCostRecord = records.find((entry: CloudCostRecord) => {
      return entry.resourceId !== "";
    })!;
    const rest: CloudCostRecord = records.find((entry: CloudCostRecord) => {
      return entry.resourceId === "";
    })!;

    expect(resource).toMatchObject({
      amount: 60,
      amortizedAmount: 80,
      netAmount: 75,
    });
    // The rest carries the figure's credits and discounts no resource did: net may go below nothing.
    expect(rest).toMatchObject({ amount: 40, amortizedAmount: 40, netAmount: 15 });
    expect(resource.amount + rest.amount).toBe(100);
    expect(resource.amortizedAmount! + rest.amortizedAmount!).toBe(120);
    expect(resource.netAmount! + rest.netAmount!).toBe(90);
  });

  test("a month of credits takes the net rest below nothing", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [figure({ amount: 100, amortizedAmount: 100, netAmount: -400 })],
      resourceCosts: [cost({ amount: 100, amortizedAmount: 100, netAmount: 100 })],
      coveredDays: new Set<string>(["2026-11-18"]),
      places,
    });
    const rest: CloudCostRecord | undefined = records.find(
      (entry: CloudCostRecord) => {
        return entry.resourceId === "";
      },
    );

    expect(rest).toMatchObject({ amount: 0, amortizedAmount: 0, netAmount: -500 });
  });

  test("resources newer than the figure are the newer figure on every basis", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [figure({ amount: 50, amortizedAmount: 70, netAmount: 60 })],
      resourceCosts: [cost({ amount: 60, amortizedAmount: 80, netAmount: 75 })],
      coveredDays: new Set<string>(["2026-11-18"]),
      places,
    });

    // The rest is nothing billed and amortized, and the net keeps the figure's own discount.
    const rest: CloudCostRecord | undefined = records.find(
      (entry: CloudCostRecord) => {
        return entry.resourceId === "";
      },
    );
    expect(rest).toMatchObject({ amount: 0, amortizedAmount: 0, netAmount: -5 });
  });

  test("a day the resource read did not cover stays a whole-service figure, with its bases", () => {
    const records: Array<CloudCostRecord> = splitAwsCostsByResource({
      records: [figure({ day: "2026-11-10" })],
      resourceCosts: [],
      coveredDays: new Set<string>(["2026-11-18"]),
      places,
    });

    expect(records).toEqual([
      { ...figure({ day: "2026-11-10" }), isServiceTotal: true },
    ]);
  });
});

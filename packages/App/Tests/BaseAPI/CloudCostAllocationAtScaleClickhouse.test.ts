import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import CloudCostGroupService from "Common/Server/Services/CloudCostGroupService";
import CloudCostLineItemService from "Common/Server/Services/CloudCostLineItemService";
import CloudCostService from "Common/Server/Services/CloudCostService";
import CloudCostViewService from "Common/Server/Services/CloudCostViewService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import CloudCostAllocation, {
  CloudCostAllocationClass,
  CloudCostLoadedGroup,
} from "Common/Server/Utils/CloudCost/CloudCostAllocation";
import CloudCostAllocationFacts from "Common/Server/Utils/CloudCost/CloudCostAllocationFacts";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostBucketAmounts,
  CloudCostSharedSplit,
  CloudCostSplitResult,
  splitCloudCostSharedGroups,
  toCloudCostMonth,
} from "Common/Types/Cloud/CloudCostAllocation";
import { roundCost, toCloudCostDay } from "Common/Types/Cloud/CloudCost";
import {
  CloudCostPartPlacement,
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  CloudCostRuleOperator,
  placeCloudCost,
} from "Common/Types/Cloud/CloudCostRules";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SeededRandom,
  seededRandom,
} from "Common/Tests/Helpers/SeededRandom";
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
 * ------------------------------------------------------------------
 * COST GROUPS OVER A YEAR OF A BUSY PROJECT'S COSTS, IN CLICKHOUSE
 * (#11006).
 *
 * A year of a project's costs - RESOURCE_COUNT resources across six
 * accounts, twenty-five services, eight Regions, three tags, owner teams
 * and labels, each billed every day it lived - stored in the product's own
 * CloudCost table. Two views read it:
 *
 *   - a view of fifteen groups whose rules use every field and operator a
 *     rule has, overlapping on purpose, with a shared group split by its
 *     month's share of the spend;
 *   - one group per value of the team tag.
 *
 * Every group's total, the unallocated spend and the window's spend, as
 * ClickHouse sorts them, are held to what the TypeScript matcher
 * (CloudCostRules.placeCloudCost) and the split (splitCloudCostSharedGroups)
 * make of the same costs, to the cent: for last month by the day, for the
 * whole year by the month, and for a window across a month's end. A read
 * split into parts adds up to the same. How long each read took is printed
 * (the issue's "check the read cost on a large project's year of costs").
 *
 * Opt in as CloudCostAllocationClickhouse does; set
 * CLOUD_COST_SCALE_RESOURCES to read a larger project (5000 is about two
 * million rows).
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(900000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_cost_groups_scale_${process.pid}_${Date.now()}`;

const RESOURCE_COUNT: number =
  Number(process.env["CLOUD_COST_SCALE_RESOURCES"]) || 1200;

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000f0001");
const VIEW: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000f0002");
const CONNECTION: string = "0192f1a0-1100-7000-8000-0000000f0003";

const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
// A year of days, the oldest first, ending today.
const DAYS: Array<Date> = Array.from(
  { length: 365 },
  (_value: unknown, index: number): Date => {
    return new Date(
      Date.UTC(2026, 10, 24) - (364 - index) * DAY_MS,
    );
  },
);

const ACCOUNTS: Array<string> = Array.from(
  { length: 6 },
  (_value: unknown, index: number): string => {
    return `0192f1a0-1100-7000-8000-00000000a${String(index).padStart(3, "0")}`;
  },
);
const TEAMS: Array<string> = Array.from(
  { length: 6 },
  (_value: unknown, index: number): string => {
    return `0192f1a0-1100-7000-8000-00000000b${String(index).padStart(3, "0")}`;
  },
);
const LABELS: Array<string> = Array.from(
  { length: 4 },
  (_value: unknown, index: number): string => {
    return `0192f1a0-1100-7000-8000-00000000d${String(index).padStart(3, "0")}`;
  },
);
const SERVICES: Array<string> = [
  "Amazon Elastic Compute Cloud - Compute",
  "Amazon Simple Storage Service",
  "Amazon Relational Database Service",
  "Amazon CloudFront",
  "AWS Lambda",
  "Amazon DynamoDB",
  "Amazon Elastic Container Service",
  "Amazon Elastic Kubernetes Service",
  "AmazonCloudWatch",
  "AWS Support (Business)",
  "Virtual Machines",
  "Storage",
  "Azure Kubernetes Service",
  "Azure Database for PostgreSQL",
  "Bandwidth",
  "Compute Engine",
  "Cloud Storage",
  "BigQuery",
  "Cloud Run",
  "Kubernetes Engine",
  "Cloud SQL",
  "Networking",
  "Elastic Load Balancing",
  "Amazon Route 53",
  "Amazon ElastiCache",
];
const REGIONS: Array<string> = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "westeurope",
  "europe-west1",
  "",
];
const TEAM_TAGS: Array<string> = [
  "payments",
  "search",
  "platform",
  "data",
  "Payments",
  "growth",
];
const ENVIRONMENTS: Array<string> = ["prod", "staging", "dev"];
const COST_CENTERS: Array<string> = ["cc-100", "cc-200", "cc-300", "cc-410", "cc-999"];

interface Resource {
  key: string;
  account: string;
  provider: string;
  service: string;
  region: string;
  tags: Record<string, string>;
  owners: Array<string>;
  labels: Array<string>;
  // The day it began and ended (indexes into DAYS), and what it costs a day.
  firstDay: number;
  lastDay: number;
  base: number;
}

function pick<T>(random: SeededRandom, values: ReadonlyArray<T>): T {
  return values[random(values.length)]!;
}

function makeResources(): Array<Resource> {
  const random: SeededRandom = seededRandom(11006);
  const resources: Array<Resource> = [];

  for (let index: number = 0; index < RESOURCE_COUNT; index++) {
    const tags: Record<string, string> = {};

    if (random() < 0.7) {
      tags["team"] = pick(random, TEAM_TAGS);
    }

    if (random() < 0.5) {
      tags["env"] = pick(random, ENVIRONMENTS);
    }

    if (random() < 0.3) {
      tags["cost-center"] = pick(random, COST_CENTERS);
    }

    const owners: Array<string> = [];

    if (random() < 0.35) {
      const count: number = 1 + random(3);

      while (owners.length < count) {
        const team: string = pick(random, TEAMS);

        if (!owners.includes(team)) {
          owners.push(team);
        }
      }
    }

    const labels: Array<string> = random() < 0.25 ? [pick(random, LABELS)] : [];
    const firstDay: number = random(300);
    const service: string = pick(random, SERVICES);

    resources.push({
      key:
        index % 3 === 0
          ? `i-${index.toString(16).padStart(8, "0")}`
          : index % 3 === 1
            ? `/subscriptions/sub/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm-${index}`
            : `//compute.googleapis.com/projects/p/zones/z/instances/${index}`,
      account: pick(random, ACCOUNTS),
      provider: pick(random, ["aws", "azure", "gcp"]),
      service,
      region: pick(random, REGIONS),
      tags,
      owners,
      labels,
      firstDay,
      lastDay: Math.min(364, firstDay + 30 + random(365)),
      base: Math.round((0.5 + random() * 80) * 100) / 100,
    });
  }

  return resources;
}

// What a resource cost on a day: its base, varied by the day, to the cent.
function dailyCost(resource: Resource, day: number, index: number): number {
  return roundCost(resource.base * (0.6 + (((day * 7 + index) % 10) / 10) * 0.8));
}

const RESOURCES: Array<Resource> = makeResources();

// Account labels: the second label carried by the first two accounts.
const ACCOUNT_LABELS: Map<string, Array<string>> = new Map([
  [ACCOUNTS[0]!, [LABELS[1]!]],
  [ACCOUNTS[1]!, [LABELS[1]!]],
]);

function condition(
  field: CloudCostRuleField,
  operator: CloudCostRuleOperator,
  values: Array<string>,
  key?: string,
): CloudCostRuleCondition {
  return { field, operator, values, ...(key ? { key } : {}) };
}

function rule(...conditions: Array<CloudCostRuleCondition>): CloudCostRule {
  return { conditions };
}

const SUPPORT_ID: string = "0192f1a0-1100-7000-8000-00000000ee0e";

// Fifteen groups using every field and operator a rule has, overlapping.
const EVERY_KIND: Array<{
  id: string;
  name: string;
  rules: Array<CloudCostRule>;
  isShared?: boolean;
}> = [
  {
    id: SUPPORT_ID,
    name: "Support plan",
    isShared: true,
    rules: [
      rule(
        condition(CloudCostRuleField.Service, CloudCostRuleOperator.Is, [
          "aws support (business)",
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee01",
    name: "Payments",
    rules: [
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Is,
          ["payments"],
          "team",
        ),
      ),
      rule(
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
          TEAMS[0]!,
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee02",
    name: "Search in Europe",
    rules: [
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Is,
          ["search"],
          "team",
        ),
        condition(CloudCostRuleField.Region, CloudCostRuleOperator.StartsWith, [
          "eu",
          "europe",
          "west",
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee03",
    name: "Search",
    rules: [
      rule(
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
          TEAMS[1]!,
          TEAMS[2]!,
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee04",
    name: "Production labelled",
    rules: [
      rule(
        condition(CloudCostRuleField.Label, CloudCostRuleOperator.Is, [
          LABELS[0]!,
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee05",
    name: "Account labelled",
    rules: [
      rule(
        condition(CloudCostRuleField.Label, CloudCostRuleOperator.Is, [
          LABELS[1]!,
        ]),
        condition(CloudCostRuleField.Service, CloudCostRuleOperator.Contains, [
          "storage",
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee06",
    name: "Kubernetes",
    rules: [
      rule(
        condition(CloudCostRuleField.Service, CloudCostRuleOperator.Contains, [
          "KUBERNETES",
        ]),
        condition(CloudCostRuleField.Label, CloudCostRuleOperator.IsNot, [
          LABELS[2]!,
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee07",
    name: "Untagged dev",
    rules: [
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.DoesNotExist,
          [],
          "team",
        ),
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Is,
          ["DEV"],
          "env",
        ),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee08",
    name: "Cost centers",
    rules: [
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Exists,
          [],
          "cost-center",
        ),
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.IsNot,
          ["cc-999"],
          "cost-center",
        ),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee09",
    name: "Two accounts",
    rules: [
      rule(
        condition(CloudCostRuleField.Account, CloudCostRuleOperator.Is, [
          ACCOUNTS[3]!,
          ACCOUNTS[4]!,
        ]),
        condition(CloudCostRuleField.Service, CloudCostRuleOperator.DoesNotContain, [
          "amazon",
          "azure",
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee10",
    name: "Google",
    rules: [
      rule(
        condition(CloudCostRuleField.Provider, CloudCostRuleOperator.Is, ["gcp"]),
        condition(CloudCostRuleField.Resource, CloudCostRuleOperator.EndsWith, [
          "0",
          "5",
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee11",
    name: "Global",
    rules: [
      rule(condition(CloudCostRuleField.Region, CloudCostRuleOperator.Is, [""])),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee12",
    name: "Not owned by the rest",
    rules: [
      rule(
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.IsNot, [
          TEAMS[0]!,
          TEAMS[1]!,
          TEAMS[2]!,
        ]),
        condition(CloudCostRuleField.Resource, CloudCostRuleOperator.Contains, [
          "virtualmachines",
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee13",
    name: "Growth",
    rules: [
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.StartsWith,
          ["gro"],
          "team",
        ),
      ),
      rule(
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
          TEAMS[5]!,
        ]),
      ),
    ],
  },
  {
    id: "0192f1a0-1100-7000-8000-00000000ee14",
    name: "Data",
    rules: [
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Contains,
          ["dat"],
          "team",
        ),
      ),
    ],
  },
];

// One group per value of the team tag, as a view made per tag value is.
const PER_TEAM_TAG: typeof EVERY_KIND = Array.from(
  new Set(
    TEAM_TAGS.map((value: string): string => {
      return value.toLowerCase();
    }),
  ),
).map((value: string, index: number) => {
  return {
    id: `0192f1a0-1100-7000-8000-00000000ef${String(index).padStart(2, "0")}`,
    name: value,
    rules: [
      rule(
        condition(CloudCostRuleField.Tag, CloudCostRuleOperator.Is, [value], "team"),
      ),
    ],
  };
});

let viewGroups: typeof EVERY_KIND = EVERY_KIND;

function models(groups: typeof EVERY_KIND): Array<CloudCostGroup> {
  return groups.map((entry: (typeof EVERY_KIND)[number], index: number) => {
    const made: CloudCostGroup = new CloudCostGroup();
    made.id = new ObjectID(entry.id);
    made.name = entry.name;
    made.order = index + 1;
    made.rules = entry.rules;
    made.isShared = Boolean(entry.isShared);
    made.sharedSplit = CloudCostSharedSplit.Proportional;
    made.sharedPercentages = {};
    made.createdAt = new Date("2026-01-01T00:00:00Z");
    return made;
  });
}

/*
 * What the TypeScript matcher and split make of the same costs: each
 * group's total and the unallocated, over the days asked.
 */
function expected(data: {
  groups: typeof EVERY_KIND;
  firstDay: number;
  lastDay: number;
}): { totals: Map<string, number>; unallocated: number; total: number } {
  const loaded: Array<CloudCostLoadedGroup> = CloudCostAllocationClass.toLoadedGroups(
    models(data.groups),
  );
  const cloud: CloudCostBucketAmounts = new Map();
  const monthSpend: Map<string, Map<string, number>> = new Map();
  let total: number = 0;

  const add: (
    map: Map<string, Map<string, number>>,
    outer: string,
    inner: string,
    amount: number,
  ) => void = (
    map: Map<string, Map<string, number>>,
    outer: string,
    inner: string,
    amount: number,
  ): void => {
    const byInner: Map<string, number> = map.get(outer) || new Map();
    byInner.set(inner, (byInner.get(inner) || 0) + amount);
    map.set(outer, byInner);
  };

  RESOURCES.forEach((resource: Resource, index: number): void => {
    const placement: Array<CloudCostPartPlacement> = placeCloudCost({
      groups: loaded,
      facts: {
        cloudAccountId: resource.account,
        provider: resource.provider,
        service: resource.service,
        region: resource.region,
        resourceId: resource.key,
        tags: resource.tags,
        ownerTeamIds: resource.owners,
        labelIds: [
          ...resource.labels,
          ...(ACCOUNT_LABELS.get(resource.account) || []),
        ],
      },
    });

    for (let day: number = resource.firstDay; day <= resource.lastDay; day++) {
      const amount: number = dailyCost(resource, day, index);
      const month: string = toCloudCostMonth(toCloudCostDay(DAYS[day]!));

      for (const part of placement) {
        const groupId: string =
          part.groupIndex < 0 ? "" : loaded[part.groupIndex]!.id;

        // A month's spend, whatever the window: what a split weighs.
        add(monthSpend, month, groupId, amount * part.share);

        if (day >= data.firstDay && day <= data.lastDay) {
          add(cloud, groupId, month, amount * part.share);
        }
      }

      if (day >= data.firstDay && day <= data.lastDay) {
        total += amount;
      }
    }
  });

  const split: CloudCostSplitResult = splitCloudCostSharedGroups({
    groups: loaded.map((group: CloudCostLoadedGroup) => {
      return { id: group.id, isShared: group.isShared, split: group.split };
    }),
    amounts: cloud,
    monthSpend,
    monthOf: toCloudCostMonth,
  });
  const sum: (map: CloudCostBucketAmounts, id: string) => number = (
    map: CloudCostBucketAmounts,
    id: string,
  ): number => {
    return Array.from(map.get(id)?.values() || []).reduce(
      (value: number, amount: number): number => {
        return value + amount;
      },
      0,
    );
  };
  const totals: Map<string, number> = new Map();

  for (const group of loaded) {
    totals.set(
      group.name,
      sum(cloud, group.id) +
        sum(split.received, group.id) -
        sum(split.given, group.id),
    );
  }

  return { totals, unallocated: sum(cloud, ""), total };
}

function expectCents(actual: number, wanted: number): void {
  expect(Math.abs(actual - wanted)).toBeLessThan(0.02 + Math.abs(wanted) * 1e-9);
}

function expectMatches(
  result: CloudCostAllocationResult,
  wanted: ReturnType<typeof expected>,
): void {
  for (const group of result.groups) {
    expectCents(group.total, wanted.totals.get(group.name)!);
  }

  expectCents(result.unallocated.total, wanted.unallocated);
  expectCents(result.total, wanted.total);
  expectCents(
    result.groups.reduce(
      (sum: number, group: CloudCostAllocationGroupResult): number => {
        return sum + group.total;
      },
      0,
    ) + result.unallocated.total,
    result.total,
  );
}

// Whether the read times are printed: when a size is asked for, to measure it.
const IS_BENCHMARK: boolean = Boolean(process.env["CLOUD_COST_SCALE_RESOURCES"]);

function report(line: string): void {
  if (IS_BENCHMARK) {
    // eslint-disable-next-line no-console
    console.info(line);
  }
}

async function timed<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const started: number = Date.now();
  const answer: T = await run();
  report(`${label}: ${Date.now() - started} ms over ${RESOURCE_COUNT} resources`);
  return answer;
}

function read(
  overrides: Partial<Parameters<typeof CloudCostAllocation.read>[0]>,
): Promise<CloudCostAllocationResult> {
  return CloudCostAllocation.read({
    projectId: PROJECT,
    viewId: VIEW,
    startDate: DAYS[0]!,
    endDate: DAYS[364]!,
    currency: "USD",
    props: { isRoot: true },
    now: NOW,
    ...overrides,
  });
}

integration("cost groups over a year of a busy project's costs", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let saved: { database: ClickhouseDatabase; databaseClient: unknown } | null =
    null;
  let rowCount: number = 0;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 300000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    const model: AnalyticsBaseModel = new CloudCost();
    const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
      modelType: CloudCost as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    const service: { database: ClickhouseDatabase; databaseClient: unknown } =
      CloudCostService as unknown as {
        database: ClickhouseDatabase;
        databaseClient: unknown;
      };
    saved = { database: service.database, databaseClient: service.databaseClient };
    service.database = clickhouse;
    service.databaseClient = client;

    // A day's rows at a time, so the suite never holds the year at once.
    const readAt: string = OneUptimeDate.toClickhouseDateTime(NOW);
    let batch: Array<JSONObject> = [];

    const flush: () => Promise<void> = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }

      await client.insert({
        table: `${database}.${model.tableName}`,
        values: batch,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0 },
      });
      rowCount += batch.length;
      batch = [];
    };

    for (let day: number = 0; day < DAYS.length; day++) {
      const dayText: string = OneUptimeDate.toClickhouseDateTime(DAYS[day]!);

      RESOURCES.forEach((resource: Resource, index: number): void => {
        if (day < resource.firstDay || day > resource.lastDay) {
          return;
        }

        batch.push({
          _id: ObjectID.generate().toString(),
          projectId: PROJECT.toString(),
          cloudAccountId: resource.account,
          cloudConnectionId: CONNECTION,
          provider: resource.provider,
          accountId: resource.account.slice(-6),
          day: dayText,
          service: resource.service,
          region: resource.region,
          resourceId: resource.key,
          cost: dailyCost(resource, day, index),
          currency: "USD",
          tags: resource.tags,
          readAt,
        });
      });

      if (batch.length >= 100000) {
        await flush();
      }
    }

    await flush();
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    if (saved) {
      const service: { database: ClickhouseDatabase; databaseClient: unknown } =
        CloudCostService as unknown as {
          database: ClickhouseDatabase;
          databaseClient: unknown;
        };
      service.database = saved.database;
      service.databaseClient = saved.databaseClient;
    }

    if (client) {
      try {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${database} SYNC`,
        });
      } finally {
        await client.close();
      }
    }
  });

  beforeEach((): void => {
    jest.restoreAllMocks();
    viewGroups = EVERY_KIND;

    jest.spyOn(CloudCostViewService, "findOneBy").mockImplementation(async () => {
      const view: CloudCostView = new CloudCostView();
      view.id = VIEW;
      view.name = "Every kind of rule";
      return view;
    });
    jest.spyOn(CloudCostGroupService, "findBy").mockImplementation(async () => {
      return models(viewGroups);
    });
    jest
      .spyOn(CloudCostLineItemService, "findBy")
      .mockImplementation(async () => {
        return [];
      });
    jest
      .spyOn(CloudCostAllocationFacts, "readOwnerTeams")
      .mockImplementation(async () => {
        const owners: Map<string, Set<string>> = new Map();

        for (const resource of RESOURCES) {
          if (resource.owners.length > 0) {
            owners.set(resource.key, new Set(resource.owners));
          }
        }

        return owners;
      });
    jest
      .spyOn(CloudCostAllocationFacts, "readResourceLabels")
      .mockImplementation(
        async (data: { labelIds: Array<string> }) => {
          const labels: Map<string, Set<string>> = new Map();

          for (const resource of RESOURCES) {
            const asked: Array<string> = resource.labels.filter(
              (label: string): boolean => {
                return data.labelIds.includes(label);
              },
            );

            if (asked.length > 0) {
              labels.set(resource.key, new Set(asked));
            }
          }

          return labels;
        },
      );
    jest
      .spyOn(CloudCostAllocationFacts, "readAccountLabels")
      .mockImplementation(async (data: { labelIds: Array<string> }) => {
        const accounts: Map<string, Array<string>> = new Map();

        for (const [account, labels] of ACCOUNT_LABELS.entries()) {
          const asked: Array<string> = labels.filter((label: string) => {
            return data.labelIds.includes(label);
          });

          if (asked.length > 0) {
            accounts.set(account, asked);
          }
        }

        return accounts;
      });
  });

  test("the year's rows are stored", () => {
    expect(rowCount).toBeGreaterThan(RESOURCE_COUNT * 30);
    report(`${rowCount} cost rows over ${RESOURCE_COUNT} resources`);
  });

  test("last month by the day: every group as the matcher sorts it", async () => {
    const result: CloudCostAllocationResult = await timed(
      "October by the day",
      () => {
        return read({
          startDate: new Date("2026-10-01T00:00:00Z"),
          endDate: new Date("2026-10-31T00:00:00Z"),
          interval: CloudCostAllocationInterval.Day,
        });
      },
    );
    const first: number = DAYS.findIndex((day: Date): boolean => {
      return toCloudCostDay(day) === "2026-10-01";
    });

    expect(result.buckets).toHaveLength(31);
    expectMatches(result, expected({ groups: EVERY_KIND, firstDay: first, lastDay: first + 30 }));
    // The support plan is split away whole: it keeps nothing.
    expectCents(
      result.groups.find((group: CloudCostAllocationGroupResult) => {
        return group.name === "Support plan";
      })!.total,
      0,
    );
  });

  test("the whole year by the month, compared with the year before", async () => {
    const result: CloudCostAllocationResult = await timed(
      "a year by the month",
      () => {
        return read({ interval: CloudCostAllocationInterval.Month });
      },
    );

    expect(result.interval).toBe(CloudCostAllocationInterval.Month);
    expect(result.buckets).toHaveLength(13);
    expectMatches(result, expected({ groups: EVERY_KIND, firstDay: 0, lastDay: 364 }));
    // Nothing is stored before the year: the year before cost nothing.
    expect(result.previousTotal).toBe(0);
  });

  test("a window across a month's end", async () => {
    const result: CloudCostAllocationResult = await timed(
      "45 days by the day",
      () => {
        return read({
          startDate: DAYS[200]!,
          endDate: DAYS[244]!,
        });
      },
    );

    expect(result.buckets).toHaveLength(45);
    expectMatches(result, expected({ groups: EVERY_KIND, firstDay: 200, lastDay: 244 }));
  });

  test("one group per value of the team tag", async () => {
    viewGroups = PER_TEAM_TAG;

    const result: CloudCostAllocationResult = await timed(
      "a year per tag value",
      () => {
        return read({ interval: CloudCostAllocationInterval.Month });
      },
    );
    const wanted: ReturnType<typeof expected> = expected({
      groups: PER_TEAM_TAG,
      firstDay: 0,
      lastDay: 364,
    });

    expectMatches(result, wanted);
    // "Payments" and "payments" are one value: one group takes both.
    expect(result.groups.map((group: CloudCostAllocationGroupResult) => {
      return group.name;
    })).toEqual(["payments", "search", "platform", "data", "growth"]);
  });

  test("a read split into parts adds up to the whole", async () => {
    const whole: CloudCostAllocationResult = await read({
      startDate: new Date("2026-11-01T00:00:00Z"),
      endDate: new Date("2026-11-24T00:00:00Z"),
    });
    const actual: typeof CloudCostAllocationClass.partition =
      CloudCostAllocationClass.partition.bind(CloudCostAllocationClass);

    jest
      .spyOn(CloudCostAllocationClass, "partition")
      .mockImplementation(
        (
          ctx: Parameters<typeof CloudCostAllocationClass.partition>[0],
        ): ReturnType<typeof CloudCostAllocationClass.partition> => {
          return actual(ctx, Math.ceil(RESOURCE_COUNT / 50));
        },
      );

    const parted: CloudCostAllocationResult = await timed(
      "November in parts",
      () => {
        return read({
          startDate: new Date("2026-11-01T00:00:00Z"),
          endDate: new Date("2026-11-24T00:00:00Z"),
        });
      },
    );

    whole.groups.forEach(
      (group: CloudCostAllocationGroupResult, index: number): void => {
        expectCents(parted.groups[index]!.total, group.total);
        expectCents(parted.groups[index]!.wouldMatch || 0, group.wouldMatch || 0);
      },
    );
    expectCents(parted.unallocated.total, whole.unallocated.total);
    expect(parted.unallocated.topServices.map((share: { key: string }) => {
      return share.key;
    })).toEqual(
      whole.unallocated.topServices.map((share: { key: string }) => {
        return share.key;
      }),
    );
  });
});

describe("the cost groups' at-scale ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

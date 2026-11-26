import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OwnerNotificationDelivery from "Common/Models/DatabaseModels/OwnerNotificationDelivery";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import CloudAccountService from "Common/Server/Services/CloudAccountService";
import CloudBudgetService from "Common/Server/Services/CloudBudgetService";
import CloudCostGroupService from "Common/Server/Services/CloudCostGroupService";
import CloudCostLineItemService from "Common/Server/Services/CloudCostLineItemService";
import CloudCostService from "Common/Server/Services/CloudCostService";
import CloudCostSettingService from "Common/Server/Services/CloudCostSettingService";
import CloudCostViewService from "Common/Server/Services/CloudCostViewService";
import ProjectService from "Common/Server/Services/ProjectService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import CloudBudgetEvaluator, {
  CloudBudgetAlertState,
  CloudBudgetAnomalyDay,
  formatCloudBudgetAlertDay,
} from "Common/Server/Utils/CloudConnection/CloudBudgetEvaluator";
import CloudBudgetFigures, {
  CloudBudgetFiguresRead,
} from "Common/Server/Utils/CloudCost/CloudBudgetFigures";
import CloudBudgetNotices from "Common/Server/Utils/CloudCost/CloudBudgetNotices";
import CloudBudgetSpendReader, {
  CloudBudgetDailyServiceTotals,
  CloudBudgetScopeRead,
} from "Common/Server/Utils/CloudCost/CloudBudgetSpendReader";
import CloudCostAllocation from "Common/Server/Utils/CloudCost/CloudCostAllocation";
import CloudCostAllocationFacts from "Common/Server/Utils/CloudCost/CloudCostAllocationFacts";
import {
  CloudBudgetCheckWindow,
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
  getCloudBudgetCheckWindow,
} from "Common/Types/Cloud/CloudBudget";
import { daysInUtcMonth, projectCloudMonthCost } from "Common/Types/Cloud/CloudCost";
import { CloudCostSharedSplit } from "Common/Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "Common/Types/Cloud/CloudCostBasis";
import {
  CloudCostForecast,
  CloudCostForecastMethod,
  CloudCostForecastMonth,
  CloudCostForecastMonthKind,
  getCloudCostForecastAhead,
} from "Common/Types/Cloud/CloudCostForecast";
import {
  CloudCostRule,
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "Common/Types/Cloud/CloudCostRules";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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
 * CLOUD BUDGETS AND FORECASTS AGAINST A REAL CLICKHOUSE (#11008).
 *
 * A budget for a cost group, a filter, every account or one, by month,
 * quarter or fiscal year, reads what it is checked against from the
 * product's own CloudCost table - built from its model in a database of
 * this suite's own - with every statement CloudBudgetSpendReader builds
 * run by the server itself: the filter's rules compiled as a cost group's,
 * the cost group's spend through the allocation, each basis's column, the
 * days by service its unusual days are judged on. What Postgres would hand
 * it (the view, its groups, the budget, its people) is handed in as
 * fixtures, as CloudCostAllocationClickhouse does.
 *
 * A project's thirteen and a half months, from 1 October 2025 to
 * 19 November 2026 - the cloud has reported up to yesterday - a cost a day
 * per series:
 *
 *   series       account  service            Region     tags           a day
 *   pay-api      prod     Amazon EC2         us-east-1  team=payments    10, 200 on 17 Nov 2026
 *   search-api   prod     Amazon EC2         us-west-2  team=search       6
 *   pay-db       prod     Amazon RDS         us-east-1  team=payments     4
 *   lake         data     Amazon S3          us-east-1  -                5
 *   shop-cdn     prod     Amazon CloudFront  us-east-1  team=payments     2, 20 every December
 *   agent        data     Amazon Bedrock     us-east-1  team=search       3, from 1 Oct 2026
 *
 * pay-api runs under a Savings Plan: amortized at 80% of what it is
 * billed, net at 70%; every other series costs the same on every basis.
 * Expected figures are summed here, in TypeScript, from the same series.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm --name <a name of your own> -p 127.0.0.1:18808:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7.38.18
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18808 \
 *     npx jest Tests/BaseAPI/CloudBudgetsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_budgets_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011008");
const CONNECTION: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000c1008",
);
const VIEW: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000e1008");
const PROD: string = "0192f1a0-1100-7000-8000-00000000ad01";
const DATA: string = "0192f1a0-1100-7000-8000-00000000ad02";
const AWS_ACCOUNT: Record<string, string> = {
  [PROD]: "111111111111",
  [DATA]: "222222222222",
};
const PAYMENTS: string = "0192f1a0-1100-7000-8000-00000000d001";
const SEARCH: string = "0192f1a0-1100-7000-8000-00000000d002";
const PAYMENTS_TEAM: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000a1008",
);
const FINANCE_LEAD: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000b1008",
);
const ON_CALL: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000f1008");
const SEVERITY: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000051008");

// Noon on 20 November 2026: the cloud has reported up to the 19th.
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const FIRST_DAY: string = "2025-10-01";
const LAST_DAY: string = "2026-11-19";
const SPIKE_DAY: string = "2026-11-17";

interface Series {
  name: string;
  account: string;
  service: string;
  region: string;
  resourceId: string;
  tags: Record<string, string>;
  // The first day it is billed, when not the first of the history.
  from?: string;
  // What a day is billed.
  cost: (day: string) => number;
  // Amortized and net, as a share of billed.
  amortized: number;
  net: number;
}

const SERIES: Array<Series> = [
  {
    name: "pay-api",
    account: PROD,
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    tags: { team: "payments" },
    cost: (day: string): number => {
      return day === SPIKE_DAY ? 200 : 10;
    },
    amortized: 0.8,
    net: 0.7,
  },
  {
    name: "search-api",
    account: PROD,
    service: "Amazon EC2",
    region: "us-west-2",
    resourceId: "i-0search0api",
    tags: { team: "search" },
    cost: (): number => {
      return 6;
    },
    amortized: 1,
    net: 1,
  },
  {
    name: "pay-db",
    account: PROD,
    service: "Amazon RDS",
    region: "us-east-1",
    resourceId: "arn:aws:rds:us-east-1:111111111111:db:payments",
    tags: { team: "payments" },
    cost: (): number => {
      return 4;
    },
    amortized: 1,
    net: 1,
  },
  {
    name: "lake",
    account: DATA,
    service: "Amazon S3",
    region: "us-east-1",
    resourceId: "data-lake-bucket",
    tags: {},
    cost: (): number => {
      return 5;
    },
    amortized: 1,
    net: 1,
  },
  {
    name: "shop-cdn",
    account: PROD,
    service: "Amazon CloudFront",
    region: "us-east-1",
    resourceId: "E2SHOPCDN",
    tags: { team: "payments" },
    cost: (day: string): number => {
      return day.slice(5, 7) === "12" ? 20 : 2;
    },
    amortized: 1,
    net: 1,
  },
  {
    name: "agent",
    account: DATA,
    service: "Amazon Bedrock",
    region: "us-east-1",
    resourceId: "",
    tags: { team: "search" },
    from: "2026-10-01",
    cost: (): number => {
      return 3;
    },
    amortized: 1,
    net: 1,
  },
];

function utcDays(start: string, end: string): Array<string> {
  const days: Array<string> = [];

  for (
    let day: Date = new Date(`${start}T00:00:00.000Z`);
    day.getTime() <= new Date(`${end}T00:00:00.000Z`).getTime();
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    days.push(day.toISOString().slice(0, 10));
  }

  return days;
}

function utc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function amountOn(series: Series, day: string, basis: CloudCostBasis): number {
  if (day < (series.from || FIRST_DAY) || day > LAST_DAY) {
    return 0;
  }

  const billed: number = series.cost(day);

  if (basis === CloudCostBasis.Amortized) {
    return billed * series.amortized;
  }

  if (basis === CloudCostBasis.Net) {
    return billed * series.net;
  }

  return billed;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

// What the series a scope counts cost each day, as this suite sums them.
function expectedDays(data: {
  counts: (series: Series) => boolean;
  start: string;
  end: string;
  basis?: CloudCostBasis;
}): Map<string, number> {
  const days: Map<string, number> = new Map();

  for (const day of utcDays(data.start, data.end)) {
    let total: number = 0;

    for (const series of SERIES) {
      if (data.counts(series)) {
        total += amountOn(series, day, data.basis || CloudCostBasis.Billed);
      }
    }

    if (total !== 0) {
      days.set(day, cents(total));
    }
  }

  return days;
}

// The same, by the month: "2026-10" -> amount.
function expectedMonths(data: {
  counts: (series: Series) => boolean;
  start: string;
  end: string;
  basis?: CloudCostBasis;
}): Map<string, number> {
  const months: Map<string, number> = new Map();

  for (const [day, amount] of expectedDays(data)) {
    const month: string = day.slice(0, 7);
    months.set(month, cents((months.get(month) || 0) + amount));
  }

  return months;
}

function sumOf(amounts: Map<string, number>): number {
  let total: number = 0;

  for (const amount of amounts.values()) {
    total += amount;
  }

  return cents(total);
}

function rounded(amounts: Map<string, number>): Map<string, number> {
  const out: Map<string, number> = new Map();

  for (const [key, amount] of amounts) {
    out.set(key, cents(amount));
  }

  return out;
}

const isPayments: (series: Series) => boolean = (series: Series): boolean => {
  return series.tags["team"] === "payments";
};

function costRows(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (const day of utcDays(FIRST_DAY, LAST_DAY)) {
    for (const series of SERIES) {
      if (day < (series.from || FIRST_DAY)) {
        continue;
      }

      rows.push({
        _id: ObjectID.generate().toString(),
        projectId: PROJECT.toString(),
        cloudAccountId: series.account,
        cloudConnectionId: CONNECTION.toString(),
        provider: "aws",
        accountId: AWS_ACCOUNT[series.account]!,
        day: OneUptimeDate.toClickhouseDateTime(utc(day)),
        service: series.service,
        region: series.region,
        resourceId: series.resourceId,
        cost: amountOn(series, day, CloudCostBasis.Billed),
        amortizedCost: amountOn(series, day, CloudCostBasis.Amortized),
        netCost: amountOn(series, day, CloudCostBasis.Net),
        currency: "USD",
        tags: series.tags,
        readAt: OneUptimeDate.toClickhouseDateTime(NOW),
      });
    }
  }

  // A cost billed in euros is never added to a budget in dollars.
  rows.push({
    _id: ObjectID.generate().toString(),
    projectId: PROJECT.toString(),
    cloudAccountId: PROD,
    cloudConnectionId: CONNECTION.toString(),
    provider: "aws",
    accountId: AWS_ACCOUNT[PROD]!,
    day: OneUptimeDate.toClickhouseDateTime(utc("2026-11-03")),
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    cost: 999,
    amortizedCost: 999,
    netCost: 999,
    currency: "EUR",
    tags: { team: "payments" },
    readAt: OneUptimeDate.toClickhouseDateTime(NOW),
  });

  // Another project's cost under the same account: never read.
  rows.push({
    _id: ObjectID.generate().toString(),
    projectId: ObjectID.generate().toString(),
    cloudAccountId: PROD,
    cloudConnectionId: CONNECTION.toString(),
    provider: "aws",
    accountId: AWS_ACCOUNT[PROD]!,
    day: OneUptimeDate.toClickhouseDateTime(utc("2026-11-03")),
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    cost: 5000,
    amortizedCost: 5000,
    netCost: 5000,
    currency: "USD",
    tags: { team: "payments" },
    readAt: OneUptimeDate.toClickhouseDateTime(NOW),
  });

  return rows;
}

function condition(
  field: CloudCostRuleField,
  values: Array<string>,
  extra: { key?: string; operator?: CloudCostRuleOperator } = {},
): CloudCostRule["conditions"][number] {
  return {
    field,
    operator: extra.operator || CloudCostRuleOperator.Is,
    ...(extra.key ? { key: extra.key } : {}),
    values,
  };
}

// EC2 in us-east-1: one service in one Region.
const EC2_EAST: Array<CloudCostRule> = [
  {
    conditions: [
      condition(CloudCostRuleField.Service, ["Amazon EC2"]),
      condition(CloudCostRuleField.Region, ["us-east-1"]),
    ],
  },
];

function costGroup(data: {
  id: string;
  name: string;
  order: number;
  team: string;
  teamId?: ObjectID;
}): CloudCostGroup {
  const made: CloudCostGroup = new CloudCostGroup();
  made.id = new ObjectID(data.id);
  made.name = data.name;
  made.order = data.order;
  made.rules = [
    {
      conditions: [
        condition(CloudCostRuleField.Tag, [data.team], { key: "team" }),
      ],
    },
  ];
  made.isShared = false;
  made.sharedSplit = CloudCostSharedSplit.Proportional;
  made.sharedPercentages = {};
  made.createdAt = new Date(`2026-01-0${data.order}T00:00:00Z`);
  made.cloudCostViewId = VIEW;

  if (data.teamId) {
    made.teamId = data.teamId;
  }

  return made;
}

function groups(): Array<CloudCostGroup> {
  return [
    costGroup({
      id: PAYMENTS,
      name: "Payments",
      order: 1,
      team: "payments",
      teamId: PAYMENTS_TEAM,
    }),
    costGroup({ id: SEARCH, name: "Search", order: 2, team: "search" }),
  ];
}

function scopeRead(
  overrides: Partial<CloudBudgetScopeRead> = {},
): CloudBudgetScopeRead {
  return {
    projectId: PROJECT,
    scope: CloudBudgetScope.AllAccounts,
    currency: "USD",
    basis: CloudCostBasis.Billed,
    props: { isRoot: true },
    now: NOW,
    ...overrides,
  };
}

const PAYMENTS_READ: Partial<CloudBudgetScopeRead> = {
  scope: CloudBudgetScope.CostGroup,
  cloudCostGroupId: new ObjectID(PAYMENTS),
};

function quarterWindow(amount: number): CloudBudgetCheckWindow {
  return getCloudBudgetCheckWindow({
    period: CloudBudgetPeriod.Quarter,
    fiscalYearStartMonth: 1,
    amount,
    planSplit: CloudBudgetPlanSplit.None,
    monthlyPlan: null,
    now: NOW,
  });
}

// A budget as Postgres would hand the evaluator one (BUDGET_SELECT's columns).
function budget(overrides: Partial<CloudBudget> = {}): CloudBudget {
  const made: CloudBudget = new CloudBudget();
  made.id = ObjectID.generate();
  made.projectId = PROJECT;
  made.name = "Payments this quarter";
  made.isEnabled = true;
  made.scope = CloudBudgetScope.CostGroup;
  made.cloudCostGroupId = new ObjectID(PAYMENTS);
  made.monthlyAmount = 1200;
  made.currency = "USD";
  made.period = CloudBudgetPeriod.Quarter;
  made.fiscalYearStartMonth = 1;
  made.planSplit = CloudBudgetPlanSplit.None;
  made.alertThresholds = "80,100";
  made.alertOnProjection = false;
  made.alertOnAnomaly = false;
  made.alertSeverityId = SEVERITY;
  made.notifyCostGroupTeam = true;
  made.notifyUsers = [];
  made.notifyTeams = [];
  made.onCallDutyPolicies = [];

  return Object.assign(made, overrides);
}

function person(id: ObjectID, email: string): User {
  const made: User = new User();
  made.id = id;
  made.email = email as never;
  made.name = "Fran Finance" as never;
  return made;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new CloudCost();
  const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
    modelType: CloudCost as unknown as { new (): AnalyticsBaseModel },
    database: clickhouse,
  }).toColumnsCreateStatement(model.tableColumns);

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

integration("cloud budgets and forecasts against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let saved:
    | { database: ClickhouseDatabase; databaseClient: unknown }
    | undefined;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    // Connecting creates the database.
    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);
    await createTable(client, clickhouse);

    const service: { database: ClickhouseDatabase; databaseClient: unknown } =
      CloudCostService as unknown as {
        database: ClickhouseDatabase;
        databaseClient: unknown;
      };
    saved = {
      database: service.database,
      databaseClient: service.databaseClient,
    };
    service.database = clickhouse;
    service.databaseClient = client;

    await client.insert({
      table: `${database}.${new CloudCost().tableName}`,
      values: costRows(),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
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

    // What Postgres would answer, from the fixtures.
    jest
      .spyOn(CloudCostSettingService, "getCostBasisOfProject")
      .mockResolvedValue(CloudCostBasis.Billed);
    jest
      .spyOn(CloudCostViewService, "findOneBy")
      .mockImplementation(async () => {
        const view: CloudCostView = new CloudCostView();
        view.id = VIEW;
        view.name = "By team";
        return view;
      });
    jest.spyOn(CloudCostGroupService, "findBy").mockImplementation(async () => {
      return groups();
    });
    jest
      .spyOn(CloudCostGroupService, "findOneBy")
      .mockImplementation(async (data: { query: Record<string, unknown> }) => {
        const asked: string = String(data.query["_id"]).toLowerCase();

        return (
          groups().find((entry: CloudCostGroup): boolean => {
            return entry.id!.toString() === asked;
          }) || null
        );
      });
    jest.spyOn(CloudCostLineItemService, "findBy").mockResolvedValue([]);
    jest.spyOn(CloudAccountService, "findBy").mockImplementation(async () => {
      return [PROD, DATA].map((id: string): CloudAccount => {
        const account: CloudAccount = new CloudAccount();
        account.id = new ObjectID(id);
        account.provider = "aws" as never;
        return account;
      });
    });
    jest
      .spyOn(CloudCostAllocationFacts, "readOwnerTeams")
      .mockResolvedValue(new Map());
    jest
      .spyOn(CloudCostAllocationFacts, "readResourceLabels")
      .mockResolvedValue(new Map());
    jest
      .spyOn(CloudCostAllocationFacts, "readAccountLabels")
      .mockResolvedValue(new Map());
  });

  describe("what a budget's scope cost", () => {
    test("a filter of one service in one Region - EC2 in us-east-1 - counts that service there alone, by the day and by the month, in its currency and its project", async () => {
      const read: CloudBudgetScopeRead = scopeRead({
        scope: CloudBudgetScope.Filter,
        filterRules: EC2_EAST,
      });
      const counts: (series: Series) => boolean = (
        series: Series,
      ): boolean => {
        return series.name === "pay-api";
      };

      const days: Map<string, number> = await CloudBudgetSpendReader.readDays(
        read,
        utc("2026-11-01"),
        utc("2026-11-20"),
      );

      expect(rounded(days)).toEqual(
        expectedDays({ counts, start: "2026-11-01", end: "2026-11-20" }),
      );
      // The euros on the 3rd and the other project's dollars are not in it.
      expect(days.get("2026-11-03")).toBe(10);
      expect(days.get(SPIKE_DAY)).toBe(200);
      // Today is not reported yet.
      expect(days.has("2026-11-20")).toBe(false);

      const months: Map<string, number> =
        await CloudBudgetSpendReader.readMonths(
          read,
          utc("2025-11-01"),
          utc("2026-10-31"),
        );

      expect(rounded(months)).toEqual(
        expectedMonths({ counts, start: "2025-11-01", end: "2026-10-31" }),
      );
      expect(months.get("2026-02")).toBe(280);
      expect(months.size).toBe(12);
    });

    test("every account, and one account, as the budgets made before scopes count them", async () => {
      const all: Map<string, number> = await CloudBudgetSpendReader.readMonths(
        scopeRead(),
        utc("2026-09-01"),
        utc("2026-10-31"),
      );

      expect(rounded(all)).toEqual(
        expectedMonths({
          counts: (): boolean => {
            return true;
          },
          start: "2026-09-01",
          end: "2026-10-31",
        }),
      );
      // September before the agent: 10 + 6 + 4 + 5 + 2 = 27 a day.
      expect(all.get("2026-09")).toBe(810);

      const data: Map<string, number> = await CloudBudgetSpendReader.readMonths(
        scopeRead({
          scope: CloudBudgetScope.Account,
          cloudAccountId: new ObjectID(DATA),
        }),
        utc("2026-09-01"),
        utc("2026-10-31"),
      );

      expect(rounded(data)).toEqual(
        new Map([
          ["2026-09", 150],
          ["2026-10", 248],
        ]),
      );
    });

    test("a filter's rules read as a cost group's: any rule matches, and all of a rule's conditions must", async () => {
      // S3 anywhere, or a search-team cost of Amazon Bedrock.
      const either: Map<string, number> =
        await CloudBudgetSpendReader.readMonths(
          scopeRead({
            scope: CloudBudgetScope.Filter,
            filterRules: [
              { conditions: [condition(CloudCostRuleField.Service, ["Amazon S3"])] },
              {
                conditions: [
                  condition(CloudCostRuleField.Tag, ["search"], { key: "team" }),
                  condition(CloudCostRuleField.Service, ["Amazon Bedrock"]),
                ],
              },
            ],
          }),
          utc("2026-10-01"),
          utc("2026-10-31"),
        );

      expect(rounded(either)).toEqual(new Map([["2026-10", 155 + 93]]));

      // The payments team's costs that are not EC2.
      const notEc2: Map<string, number> =
        await CloudBudgetSpendReader.readMonths(
          scopeRead({
            scope: CloudBudgetScope.Filter,
            filterRules: [
              {
                conditions: [
                  condition(CloudCostRuleField.Tag, ["payments"], {
                    key: "team",
                  }),
                  condition(CloudCostRuleField.Service, ["Amazon EC2"], {
                    operator: CloudCostRuleOperator.IsNot,
                  }),
                ],
              },
            ],
          }),
          utc("2026-10-01"),
          utc("2026-10-31"),
        );

      expect(rounded(notEc2)).toEqual(new Map([["2026-10", 124 + 62]]));
    });

    test("a cost group's spend is what its page says it is charged: its rules' costs, as its view sorts them", async () => {
      const months: Map<string, number> =
        await CloudBudgetSpendReader.readMonths(
          scopeRead(PAYMENTS_READ),
          utc("2025-11-01"),
          utc("2026-10-31"),
        );

      expect(rounded(months)).toEqual(
        expectedMonths({
          counts: isPayments,
          start: "2025-11-01",
          end: "2026-10-31",
        }),
      );
      // December's peak: 310 + 124 + 620.
      expect(months.get("2025-12")).toBe(1054);

      const days: Map<string, number> = await CloudBudgetSpendReader.readDays(
        scopeRead(PAYMENTS_READ),
        utc("2026-11-01"),
        utc("2026-11-19"),
      );

      expect(rounded(days)).toEqual(
        expectedDays({
          counts: isPayments,
          start: "2026-11-01",
          end: "2026-11-19",
        }),
      );

      // The group's own page reads the same November.
      const page: { group: { total: number } } =
        await CloudCostAllocation.readGroup({
          projectId: PROJECT,
          groupId: new ObjectID(PAYMENTS),
          startDate: utc("2026-11-01"),
          endDate: utc("2026-11-19"),
          currency: "USD",
          basis: CloudCostBasis.Billed,
          compareWithPrevious: false,
          props: { isRoot: true },
          now: NOW,
        });

      expect(cents(page.group.total)).toBe(sumOf(days));
      expect(sumOf(days)).toBe(494);
    });

    test("on the budget's cost basis: pay-api's Savings Plan amortized and net, the rest as billed", async () => {
      for (const basis of [CloudCostBasis.Amortized, CloudCostBasis.Net]) {
        const filter: Map<string, number> =
          await CloudBudgetSpendReader.readMonths(
            scopeRead({
              scope: CloudBudgetScope.Filter,
              filterRules: EC2_EAST,
              basis,
            }),
            utc("2026-10-01"),
            utc("2026-10-31"),
          );

        expect(rounded(filter)).toEqual(
          new Map([
            ["2026-10", basis === CloudCostBasis.Amortized ? 248 : 217],
          ]),
        );

        const group: Map<string, number> =
          await CloudBudgetSpendReader.readMonths(
            scopeRead({ ...PAYMENTS_READ, basis }),
            utc("2026-10-01"),
            utc("2026-10-31"),
          );

        expect(rounded(group)).toEqual(
          expectedMonths({
            counts: isPayments,
            start: "2026-10-01",
            end: "2026-10-31",
            basis,
          }),
        );
      }
    });

    test("its unusual day: the spike on 17 November, judged on the scope's own days by service, told once, the day it began", async () => {
      const today: Date = utc("2026-11-20");

      for (const read of [
        scopeRead({ scope: CloudBudgetScope.Filter, filterRules: EC2_EAST }),
        scopeRead(PAYMENTS_READ),
        scopeRead(),
      ]) {
        const totals: CloudBudgetDailyServiceTotals =
          await CloudBudgetSpendReader.readDaysByService(
            read,
            utc("2026-10-23"),
            today,
          );

        expect(totals.get(SPIKE_DAY)?.get("Amazon EC2")).toBe(
          read.scope === CloudBudgetScope.AllAccounts ? 206 : 200,
        );

        const days: Array<CloudBudgetAnomalyDay> =
          CloudBudgetEvaluator.getScopeAnomalyDays({
            dailyServiceTotals: totals,
            rule: null,
            scope: "the costs its filter counts",
            now: NOW,
          });

        expect(
          days.map((day: CloudBudgetAnomalyDay): string => {
            return day.day;
          }),
        ).toEqual([SPIKE_DAY]);
        expect(
          days[0]!.anomalies.some((anomaly: { service?: string }): boolean => {
            return anomaly.service === "Amazon EC2";
          }),
        ).toBe(true);
      }
    });

    test("what cost the most this period, the costliest first", async () => {
      const top: Array<{ service: string; amount: number }> =
        await CloudBudgetSpendReader.readTopServices(
          scopeRead(),
          utc("2026-11-01"),
          utc("2026-11-20"),
          3,
        );

      // EC2: 380 + 114; S3: 95; RDS: 76 - ahead of Bedrock's 57.
      expect(top).toEqual([
        { service: "Amazon EC2", amount: 494 },
        { service: "Amazon S3", amount: 95 },
        { service: "Amazon RDS", amount: 76 },
      ]);

      const group: Array<{ service: string; amount: number }> =
        await CloudBudgetSpendReader.readTopServices(
          scopeRead(PAYMENTS_READ),
          utc("2026-11-01"),
          utc("2026-11-19"),
          5,
        );

      expect(group).toEqual([
        { service: "Amazon EC2", amount: 380 },
        { service: "Amazon RDS", amount: 76 },
        { service: "Amazon CloudFront", amount: 38 },
      ]);
    });
  });

  describe("a budget's figures", () => {
    test("a quarterly budget for a cost group: October as it cost, November so far and at the last full week's pace, December as forecast", async () => {
      const figures: CloudBudgetFiguresRead = await CloudBudgetFigures.read({
        read: scopeRead(PAYMENTS_READ),
        window: quarterWindow(1200),
        now: NOW,
      });
      const november: Map<string, number> = expectedDays({
        counts: isPayments,
        start: "2026-11-01",
        end: "2026-11-19",
      });
      const october: number = 496;

      expect(sumOf(november)).toBe(494);
      expect(cents(figures.period.spent)).toBe(october + 494);
      expect(figures.pastMonths.get("2026-10")).toBe(october);

      // The pace: the 12th to the 18th, the spike in it, for the 11 days left.
      const pace: number = (6 * 16 + 206) / 7;
      expect(cents(figures.month.dailyPace)).toBe(cents(pace));
      expect(cents(figures.month.projectedMonth)).toBe(cents(494 + pace * 11));

      const december: CloudCostForecastMonth | undefined =
        figures.forecast?.months.find(
          (month: CloudCostForecastMonth): boolean => {
            return month.month === "2026-12";
          },
        );

      expect(december?.kind).toBe(CloudCostForecastMonthKind.Forecast);
      expect(cents(figures.period.projected)).toBe(
        cents(october + 494 + pace * 11 + december!.amount),
      );
      // A quarter is not split: the window is the period.
      expect(figures.window).toEqual(figures.period);
      expect(figures.hasData).toBe(true);
    });

    test("a monthly budget reads this month and the week before it, and no history", async () => {
      const readMonths: jest.SpiedFunction<
        typeof CloudBudgetSpendReader.readMonths
      > = jest.spyOn(CloudBudgetSpendReader, "readMonths");
      const figures: CloudBudgetFiguresRead = await CloudBudgetFigures.read({
        read: scopeRead({
          scope: CloudBudgetScope.Filter,
          filterRules: EC2_EAST,
        }),
        window: getCloudBudgetCheckWindow({
          period: CloudBudgetPeriod.Month,
          fiscalYearStartMonth: 1,
          amount: 500,
          planSplit: CloudBudgetPlanSplit.None,
          monthlyPlan: null,
          now: NOW,
        }),
        now: NOW,
      });

      expect(readMonths).not.toHaveBeenCalled();
      expect(figures.forecast).toBeUndefined();
      expect(figures.window.spent).toBe(380);
      expect(
        Array.from(figures.dailyTotals.keys()).sort()[0],
      ).toBe("2026-11-01");
    });

    test("a yearly budget from April split by month: November against its own share, the year beside it", async () => {
      // April to March: November 400, December 1,100.
      const plan: Array<number> = [
        500, 500, 500, 500, 500, 500, 500, 400, 1100, 500, 500, 500,
      ];
      const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
        period: CloudBudgetPeriod.Year,
        fiscalYearStartMonth: 4,
        amount: 6000,
        planSplit: CloudBudgetPlanSplit.ByMonth,
        monthlyPlan: plan,
        now: NOW,
      });

      expect(window.isPlanMonth).toBe(true);
      expect(window.key).toBe("2026-11/1");
      // November is the plan's eighth month.
      expect(window.amount).toBe(400);

      const figures: CloudBudgetFiguresRead = await CloudBudgetFigures.read({
        read: scopeRead(PAYMENTS_READ),
        window,
        now: NOW,
      });
      const aprilToOctober: number = sumOf(
        expectedMonths({
          counts: isPayments,
          start: "2026-04-01",
          end: "2026-10-31",
        }),
      );

      expect(cents(figures.window.spent)).toBe(494);
      expect(cents(figures.period.spent)).toBe(cents(aprilToOctober + 494));
      expect(figures.window.spent).toBeLessThan(figures.period.spent);
    });
  });

  describe("a forecast, from the months ClickHouse keeps", () => {
    test("a year with a December peak: the trend and the season, so next December peaks too", async () => {
      const { forecast } = await CloudBudgetFigures.forecast({
        read: scopeRead({
          scope: CloudBudgetScope.Filter,
          filterRules: [
            {
              conditions: [
                condition(CloudCostRuleField.Service, ["Amazon CloudFront"]),
              ],
            },
          ],
        }),
        now: NOW,
      });

      // The full months kept: November 2025 to October 2026.
      expect(forecast.method).toBe(CloudCostForecastMethod.TrendAndSeason);
      expect(forecast.monthsOfHistory).toBe(12);
      expect(forecast.historyFrom).toBe("2025-11");
      expect(forecast.historyTo).toBe("2026-10");

      const ahead: Array<CloudCostForecastMonth> =
        getCloudCostForecastAhead(forecast);
      const month: (key: string) => CloudCostForecastMonth = (
        key: string,
      ): CloudCostForecastMonth => {
        return ahead.find((entry: CloudCostForecastMonth): boolean => {
          return entry.month === key;
        })!;
      };

      expect(ahead).toHaveLength(12);
      expect(ahead[0]!.month).toBe("2026-12");
      // December runs ten times its usual month, as last December did.
      expect(month("2026-12").amount).toBeGreaterThan(
        5 * month("2027-01").amount,
      );
      expect(cents(month("2027-01").amount)).toBeCloseTo(62, -1);

      for (const entry of ahead) {
        expect(entry.low).toBeLessThanOrEqual(entry.amount);
        expect(entry.high).toBeGreaterThanOrEqual(entry.amount);
      }
    });

    test("a service that began last month: the last full week's pace carried forward, with no range claimed", async () => {
      const { forecast } = await CloudBudgetFigures.forecast({
        read: scopeRead({
          scope: CloudBudgetScope.Filter,
          filterRules: [
            {
              conditions: [
                condition(CloudCostRuleField.Service, ["Amazon Bedrock"]),
              ],
            },
          ],
        }),
        now: NOW,
      });

      expect(forecast.method).toBe(CloudCostForecastMethod.Pace);
      // The months before its first are left out: it is forecast from October.
      expect(forecast.monthsOfHistory).toBe(1);
      expect(forecast.dailyPace).toBe(3);

      for (const entry of getCloudCostForecastAhead(forecast)) {
        expect(entry.low).toBeUndefined();
        expect(entry.high).toBeUndefined();
        expect(cents(entry.amount)).toBe(
          3 * daysInUtcMonth(utc(`${entry.month}-01`)),
        );
      }
    });

    test("this month as a budget projects it, whatever is forecast", async () => {
      const read: CloudBudgetScopeRead = scopeRead(PAYMENTS_READ);
      const { forecast }: { forecast: CloudCostForecast } =
        await CloudBudgetFigures.forecast({ read, now: NOW });
      const current: CloudCostForecastMonth | undefined = forecast.months.find(
        (entry: CloudCostForecastMonth): boolean => {
          return entry.kind === CloudCostForecastMonthKind.Current;
        },
      );
      const projected: { projectedMonth: number; monthToDate: number } =
        projectCloudMonthCost({
          dailyTotals: await CloudBudgetSpendReader.readDays(
            read,
            utc("2026-11-01"),
            utc("2026-11-20"),
          ),
          now: NOW,
        });

      expect(current?.month).toBe("2026-11");
      expect(cents(current!.spent || 0)).toBe(494);
      expect(cents(current!.amount)).toBe(cents(projected.projectedMonth));
    });
  });

  describe("a budget's check, from its costs", () => {
    let created: Array<Alert>;
    let planned: Array<{ threshold: number; people: Array<User> }>;
    let told: number;
    let written: Array<JSONObject>;
    let current: CloudBudget;

    beforeEach((): void => {
      created = [];
      planned = [];
      told = 0;
      written = [];

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
      jest
        .spyOn(CloudBudgetService, "findOneById")
        .mockImplementation(async () => {
          return current;
        });
      jest
        .spyOn(CloudBudgetService, "updateOneById")
        .mockImplementation(async (data: { data: unknown }) => {
          written.push(data.data as JSONObject);
          return 1;
        });
      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementation(async () => {
          const project: Project = new Project();
          project.name = "Acme";
          return project;
        });
      jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
      jest
        .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
        .mockResolvedValue([]);
      jest
        .spyOn(AlertService, "create")
        .mockImplementation(async (data: { data: Alert }) => {
          data.data.id = ObjectID.generate();
          created.push(data.data);
          return data.data;
        });
      jest
        .spyOn(CloudBudgetNotices, "getBudgetLink")
        .mockResolvedValue("https://oneuptime.example/budget");
      // The people a budget names, each of whom may read the project's budgets.
      jest
        .spyOn(CloudBudgetNotices, "getPeople")
        .mockImplementation(
          async (data: {
            userIds: Array<ObjectID>;
            teamIds: Array<ObjectID>;
          }) => {
            return [...data.userIds, ...data.teamIds].length > 0
              ? [person(FINANCE_LEAD, "fran@example.com")]
              : [];
          },
        );
      jest
        .spyOn(CloudBudgetNotices, "whoCanRead")
        .mockImplementation(async (data: { people: Array<User> }) => {
          return data.people;
        });
      jest
        .spyOn(CloudBudgetNotices, "plan")
        .mockImplementation(
          async (data: { threshold: number; people: Array<User> }) => {
            planned.push({ threshold: data.threshold, people: data.people });
            return new OwnerNotificationDelivery();
          },
        );
      jest.spyOn(CloudBudgetNotices, "tell").mockImplementation(async () => {
        told += 1;
        return 1;
      });
    });

    async function check(made: CloudBudget): Promise<JSONObject> {
      current = made;
      await CloudBudgetEvaluator.evaluateBudgetById(made.id!);
      expect(written).toHaveLength(1);
      return written[0]!;
    }

    test("a quarterly cost group budget past 80%: the group's team is told, by email and chat, and no alert is raised", async () => {
      // 990 of 1,200: 82.5%.
      const state: JSONObject = await check(budget());

      expect(created).toEqual([]);
      expect(planned).toHaveLength(1);
      expect(planned[0]!.threshold).toBe(80);
      expect(planned[0]!.people[0]!.id!.toString()).toBe(
        FINANCE_LEAD.toString(),
      );
      expect(told).toBe(1);
      expect(cents(Number(state["spentThisPeriod"]))).toBe(990);
      expect(cents(Number(state["spentThisMonth"]))).toBe(494);

      const alertState: CloudBudgetAlertState =
        state["alertState"] as unknown as CloudBudgetAlertState;
      expect(alertState.month).toBe("2026-10/3");
      expect(alertState.thresholds).toEqual([80]);
      expect(alertState.alertIds).toEqual([]);

      // Read again within the quarter: told once.
      written = [];
      planned = [];
      const again: JSONObject = await check(
        budget({ id: current.id!, alertState: alertState as never }),
      );

      expect(planned).toEqual([]);
      expect(created).toEqual([]);
      expect(
        (again["alertState"] as unknown as CloudBudgetAlertState).thresholds,
      ).toEqual([80]);
    });

    test("the same budget with nobody to tell raises its alert at 80%, as budgets always have", async () => {
      await check(budget({ notifyCostGroupTeam: false }));

      expect(planned).toEqual([]);
      expect(created).toHaveLength(1);
      expect(created[0]!.title).toContain("80%");
      expect(created[0]!.seriesFingerprint).toBeTruthy();
    });

    test("past 100%: an alert its people own, paging its on-call policies, and the services that cost the most as its root cause", async () => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = ON_CALL;
      const team: Team = new Team();
      team.id = PAYMENTS_TEAM;

      await check(
        budget({
          monthlyAmount: 900,
          onCallDutyPolicies: [policy],
          notifyTeams: [team],
        }),
      );

      // 80 and 100 passed in one read: the highest, as an alert.
      expect(planned).toEqual([]);
      expect(created).toHaveLength(1);
      expect(created[0]!.title).toContain("100%");
      expect(created[0]!.onCallDutyPolicies?.[0]?.id?.toString()).toBe(
        ON_CALL.toString(),
      );
      expect(created[0]!.rootCause).toContain("Amazon EC2");
      expect(AlertService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          miscDataProps: expect.objectContaining({
            ownerTeams: [PAYMENTS_TEAM],
          }),
        }),
      );
    });

    test("on course to pass, with December's peak forecast: one warning a quarter, before the money is spent", async () => {
      const figures: CloudBudgetFiguresRead = await CloudBudgetFigures.read({
        read: scopeRead(PAYMENTS_READ),
        window: quarterWindow(2200),
        now: NOW,
      });

      // Without December's peak the quarter would come to under 2,000.
      expect(figures.period.projected).toBeGreaterThan(2200);
      expect(990 + figures.month.dailyPace * 11 + 500).toBeLessThan(2200);

      const state: JSONObject = await check(
        budget({ monthlyAmount: 2200, alertOnProjection: true }),
      );

      expect(created).toHaveLength(1);
      expect(created[0]!.title.toLowerCase()).toContain("on course");
      expect(cents(Number(state["projectedThisPeriod"]))).toBe(
        cents(figures.period.projected),
      );
      expect(
        (state["alertState"] as unknown as CloudBudgetAlertState).projection,
      ).toBe(true);
    });

    test("a yearly budget from April split by month: November over its own share alerts; one whose November is within it does not, though October ran over", async () => {
      const plan: (november: number) => Array<number> = (
        november: number,
      ): Array<number> => {
        // April to March; October (300) ran over at 496.
        return [500, 500, 500, 500, 500, 500, 300, november, 1100, 500, 500, 500];
      };
      const yearly: (november: number) => CloudBudget = (
        november: number,
      ): CloudBudget => {
        return budget({
          period: CloudBudgetPeriod.Year,
          fiscalYearStartMonth: 4,
          planSplit: CloudBudgetPlanSplit.ByMonth,
          monthlyPlan: plan(november),
          monthlyAmount: plan(november).reduce((a: number, b: number) => {
            return a + b;
          }, 0),
          notifyCostGroupTeam: false,
        });
      };

      // November's share is 400: 494 is past 100%.
      const over: JSONObject = await check(yearly(400));

      expect(created).toHaveLength(1);
      expect(created[0]!.title).toContain("100%");
      expect(
        (over["alertState"] as unknown as CloudBudgetAlertState).month,
      ).toBe("2026-11/1");

      // November's share is 1,000: under half of it spent, nothing to say.
      created = [];
      written = [];
      const within: JSONObject = await check(yearly(1000));

      expect(created).toEqual([]);
      expect(cents(Number(within["spentThisMonth"]))).toBe(494);
      // The year so far is kept for its page.
      expect(Number(within["spentThisPeriod"])).toBeGreaterThan(494);
    });

    test("a filter budget's unusual day: one alert, the day after, naming EC2 - and never again for the same day", async () => {
      const first: JSONObject = await check(
        budget({
          name: "Edge compute",
          scope: CloudBudgetScope.Filter,
          cloudCostGroupId: undefined as never,
          filterRules: EC2_EAST,
          period: CloudBudgetPeriod.Month,
          monthlyAmount: 100000,
          alertOnAnomaly: true,
          notifyCostGroupTeam: false,
        }),
      );

      expect(created).toHaveLength(1);
      expect(created[0]!.title).toContain("cost far more than usual on");
      expect(created[0]!.description).toContain(
        formatCloudBudgetAlertDay(SPIKE_DAY, "long"),
      );
      expect(created[0]!.description).toContain("Amazon EC2 cost");

      const state: CloudBudgetAlertState =
        first["alertState"] as unknown as CloudBudgetAlertState;
      expect(state.month).toBe("2026-11");
      expect(state.anomalies).toEqual([`scope|${SPIKE_DAY}`]);

      created = [];
      written = [];
      await check(
        budget({
          id: current.id!,
          name: "Edge compute",
          scope: CloudBudgetScope.Filter,
          cloudCostGroupId: undefined as never,
          filterRules: EC2_EAST,
          period: CloudBudgetPeriod.Month,
          monthlyAmount: 100000,
          alertOnAnomaly: true,
          notifyCostGroupTeam: false,
          alertState: state as never,
        }),
      );

      expect(created).toEqual([]);
    });

    test("a budget whose cost group is gone is not checked", async () => {
      current = budget({ cloudCostGroupId: ObjectID.generate() });
      await CloudBudgetEvaluator.evaluateBudgetById(current.id!);

      expect(written).toEqual([]);
      expect(created).toEqual([]);
    });
  });
});

describe("the cloud budgets' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostLineItem from "Common/Models/DatabaseModels/CloudCostLineItem";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import CloudAccountService from "Common/Server/Services/CloudAccountService";
import CloudCostGroupService from "Common/Server/Services/CloudCostGroupService";
import CloudCostLineItemService from "Common/Server/Services/CloudCostLineItemService";
import CloudCostService from "Common/Server/Services/CloudCostService";
import CloudCostSettingService from "Common/Server/Services/CloudCostSettingService";
import CloudCostViewService from "Common/Server/Services/CloudCostViewService";
import KubernetesCostAllocationService from "Common/Server/Services/KubernetesCostAllocationService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import CloudCostAllocation, {
  CloudCostAllocationClass,
} from "Common/Server/Utils/CloudCost/CloudCostAllocation";
import CloudCostAllocationFacts from "Common/Server/Utils/CloudCost/CloudCostAllocationFacts";
import { emptyCloudCostQueryFacts } from "Common/Server/Utils/CloudCost/CloudCostAllocationQuery";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
  CloudCostSharedSplit,
} from "Common/Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "Common/Types/Cloud/CloudCostBasis";
import {
  CloudCostRule,
  CloudCostRuleField,
  CloudCostRuleOperator,
  makeCloudCostRule,
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
 * COST GROUPS AGAINST A REAL CLICKHOUSE (#11006).
 *
 * The allocation (Common/Server/Utils/CloudCost/CloudCostAllocation) reads
 * the product's own CloudCost and KubernetesCostAllocation tables, built
 * from their models in a database of this suite's own, with every
 * statement it builds - the multiIf that sorts each cost into its group,
 * the owner teams' arrayJoin, the hashed resource facts, the unallocated
 * spend's top services and tag values - run by the server itself. What
 * Postgres would hand it (the view, its groups, owners, line items) is
 * handed in as fixtures; CloudCostAllocationPostgres runs those reads.
 *
 * A project's November, a cost a day per series, so every figure below is
 * a daily amount times 30:
 *
 *   series        account  service              owners           tags              a day
 *   pay-api       prod     Amazon EC2           -                team=payments       10
 *   data-lake     data     Amazon S3            -                -                    5
 *   search-db     prod     Amazon RDS           Search           -                    4
 *   shared-vm     prod     Amazon EC2           Payments, Search -                    6
 *   logs          prod     AmazonCloudWatch     -                env=prod             2
 *   pay-worker    prod     Amazon EC2           Search           team=payments        3
 *   pay-in-data   data     Amazon EC2           -                team=payments        1
 *   support       shared   AWS Support          -                -                   20
 *
 * A "By team" view of three groups - Payments by tag, Data by account,
 * Search by owner team - takes 420, 150 and 210 of it, and 750 is
 * unallocated: 1,530 in all, nothing counted twice.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm --name <a name of your own> -p 127.0.0.1:18606:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7.38.18
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18606 \
 *     npx jest Tests/BaseAPI/CloudCostAllocationClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_cost_groups_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011006");
const CONNECTION: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000c0001",
);
const VIEW: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000e0001");

// CloudAccount rows, and the accounts' ids in AWS.
const PROD: string = "0192f1a0-1100-7000-8000-00000000ac01";
const DATA: string = "0192f1a0-1100-7000-8000-00000000ac02";
const SHARED: string = "0192f1a0-1100-7000-8000-00000000ac03";
const AWS_ACCOUNT: Record<string, string> = {
  [PROD]: "111111111111",
  [DATA]: "222222222222",
  [SHARED]: "333333333333",
};

const PAYMENTS_TEAM: string = "0192f1a0-1100-7000-8000-0000000a0001";
const SEARCH_TEAM: string = "0192f1a0-1100-7000-8000-0000000a0002";

const PAYMENTS: string = "0192f1a0-1100-7000-8000-00000000c001";
const DATA_GROUP: string = "0192f1a0-1100-7000-8000-00000000c002";
const SEARCH: string = "0192f1a0-1100-7000-8000-00000000c003";
const SUPPORT: string = "0192f1a0-1100-7000-8000-00000000c004";
const CLUSTER_GROUP: string = "0192f1a0-1100-7000-8000-00000000c005";
const CLUSTER: string = "0192f1a0-1100-7000-8000-0000000b0001";

const SUPPORT_SERVICE: string = "AWS Support (Business)";

// The read's "today": November is whole, December two days in.
const NOW: Date = new Date("2026-12-02T12:00:00.000Z");
const NOVEMBER: { startDate: Date; endDate: Date } = {
  startDate: new Date("2026-11-01T00:00:00.000Z"),
  endDate: new Date("2026-11-30T00:00:00.000Z"),
};
const OCTOBER: { startDate: Date; endDate: Date } = {
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  endDate: new Date("2026-10-31T00:00:00.000Z"),
};

interface Series {
  name: string;
  account: string;
  service: string;
  region: string;
  resourceId: string;
  tags: Record<string, string>;
  // Per day, in November; October costs half of it.
  amount: number;
  owners: Array<string>;
}

const SERIES: Array<Series> = [
  {
    name: "pay-api",
    account: PROD,
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    tags: { team: "payments" },
    amount: 10,
    owners: [],
  },
  {
    name: "data-lake",
    account: DATA,
    service: "Amazon S3",
    region: "us-east-1",
    resourceId: "data-lake-bucket",
    tags: {},
    amount: 5,
    owners: [],
  },
  {
    name: "search-db",
    account: PROD,
    service: "Amazon RDS",
    region: "eu-west-1",
    resourceId: "arn:aws:rds:eu-west-1:111111111111:db:search",
    tags: {},
    amount: 4,
    owners: [SEARCH_TEAM],
  },
  {
    name: "shared-vm",
    account: PROD,
    service: "Amazon EC2",
    region: "us-west-2",
    resourceId: "i-0shared0vm",
    tags: {},
    amount: 6,
    owners: [PAYMENTS_TEAM, SEARCH_TEAM],
  },
  {
    name: "logs",
    account: PROD,
    service: "AmazonCloudWatch",
    region: "us-east-1",
    resourceId: "",
    tags: { env: "prod" },
    amount: 2,
    owners: [],
  },
  {
    name: "pay-worker",
    account: PROD,
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0worker",
    tags: { team: "payments" },
    amount: 3,
    owners: [SEARCH_TEAM],
  },
  {
    name: "pay-in-data",
    account: DATA,
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0data",
    tags: { team: "payments" },
    amount: 1,
    owners: [],
  },
  {
    name: "support",
    account: SHARED,
    service: SUPPORT_SERVICE,
    region: "",
    resourceId: "",
    tags: {},
    amount: 20,
    owners: [],
  },
];

// A Kubernetes cluster's nodes, billed in prod and tagged by EKS.
const CLUSTER_NODES: Series = {
  name: "prod-cluster-nodes",
  account: PROD,
  service: "Amazon EC2",
  region: "us-east-1",
  resourceId: "i-0node0one",
  tags: { "eks:cluster-name": "prod" },
  amount: 30,
  owners: [],
};

function utcDays(start: string, end: string): Array<Date> {
  const days: Array<Date> = [];

  for (
    let day: Date = new Date(`${start}T00:00:00.000Z`);
    day.getTime() <= new Date(`${end}T00:00:00.000Z`).getTime();
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    days.push(day);
  }

  return days;
}

function costRows(series: Array<Series>): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (const day of utcDays("2026-10-01", "2026-11-30")) {
    const isOctober: boolean = day.getUTCMonth() === 9;

    for (const entry of series) {
      rows.push({
        _id: ObjectID.generate().toString(),
        projectId: PROJECT.toString(),
        cloudAccountId: entry.account,
        cloudConnectionId: CONNECTION.toString(),
        provider: "aws",
        accountId: AWS_ACCOUNT[entry.account]!,
        day: OneUptimeDate.toClickhouseDateTime(day),
        service: entry.service,
        region: entry.region,
        resourceId: entry.resourceId,
        cost: isOctober ? entry.amount / 2 : entry.amount,
        currency: "USD",
        tags: entry.tags,
        readAt: OneUptimeDate.toClickhouseDateTime(NOW),
      });
    }
  }

  // A cost billed in another currency is never read beside dollars.
  rows.push({
    _id: ObjectID.generate().toString(),
    projectId: PROJECT.toString(),
    cloudAccountId: PROD,
    cloudConnectionId: CONNECTION.toString(),
    provider: "aws",
    accountId: AWS_ACCOUNT[PROD]!,
    day: OneUptimeDate.toClickhouseDateTime(new Date("2026-11-03T00:00:00Z")),
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    cost: 999,
    currency: "EUR",
    tags: { team: "payments" },
    readAt: OneUptimeDate.toClickhouseDateTime(NOW),
  });

  // Another project's cost of the same account ids: never read.
  rows.push({
    _id: ObjectID.generate().toString(),
    projectId: ObjectID.generate().toString(),
    cloudAccountId: PROD,
    cloudConnectionId: CONNECTION.toString(),
    provider: "aws",
    accountId: AWS_ACCOUNT[PROD]!,
    day: OneUptimeDate.toClickhouseDateTime(new Date("2026-11-03T00:00:00Z")),
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    cost: 5000,
    currency: "USD",
    tags: { team: "payments" },
    readAt: OneUptimeDate.toClickhouseDateTime(NOW),
  });

  return rows;
}

/*
 * The cluster's namespaces each November day, as its cost engine priced
 * them: payments 50, search 30 and 20 idle - a hundred a day the cloud's
 * bill never carries, which must never be added to it.
 */
function namespaceRows(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  const slices: Array<{
    namespace: string;
    labels: Record<string, string>;
    cost: number;
  }> = [
    {
      namespace: "payments",
      labels: { team: "payments", app: "api" },
      cost: 30,
    },
    {
      namespace: "payments",
      labels: { team: "payments", app: "worker" },
      cost: 20,
    },
    { namespace: "search", labels: { team: "search" }, cost: 30 },
    { namespace: "__idle__", labels: {}, cost: 20 },
  ];

  for (const day of utcDays("2026-11-01", "2026-11-30")) {
    for (const slice of slices) {
      rows.push({
        _id: ObjectID.generate().toString(),
        projectId: PROJECT.toString(),
        kubernetesClusterId: CLUSTER,
        clusterName: "prod",
        windowStart: OneUptimeDate.toClickhouseDateTime(day),
        windowEnd: OneUptimeDate.toClickhouseDateTime(
          new Date(day.getTime() + 24 * 60 * 60 * 1000),
        ),
        namespace: slice.namespace,
        controllerKind: "Deployment",
        controllerName: slice.labels["app"] || slice.namespace,
        podName: `${slice.namespace}-pod`,
        containerName: "main",
        labels: slice.labels,
        labelKeys: Object.keys(slice.labels),
        totalCost: slice.cost,
        currency: "USD",
        retentionDate: OneUptimeDate.toClickhouseDateTime(
          new Date("2027-12-31T00:00:00Z"),
        ),
      });
    }
  }

  return rows;
}

/*
 * EACH COST ON THREE BASES (#11007), in a project of its own so the
 * figures above stay as they are. A November of:
 *
 *   series       account  service        tags            billed  amortized  net
 *   pay-api      prod     Amazon EC2     team=payments     10        7        6   a day
 *   data-lake    data     Amazon S3      -                  5        5        4   a day
 *   support      shared   AWS Support    -                  3        3        3   a day
 *   plan fee     prod     Savings Plans  -                300        0        0   on the 1st
 *
 * The Savings Plan bought up front is billed on the 1st, and amortized
 * into the usage it covers: pay-api's billed 10 a day ran at 7 under it.
 * Net takes the credits off too.
 */
const BASES_PROJECT: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-000000011007",
);

function basesRows(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  const row: (data: {
    day: Date;
    account: string;
    service: string;
    resourceId: string;
    tags: Record<string, string>;
    cost: number;
    amortizedCost: number;
    netCost: number;
  }) => JSONObject = (data: {
    day: Date;
    account: string;
    service: string;
    resourceId: string;
    tags: Record<string, string>;
    cost: number;
    amortizedCost: number;
    netCost: number;
  }): JSONObject => {
    return {
      _id: ObjectID.generate().toString(),
      projectId: BASES_PROJECT.toString(),
      cloudAccountId: data.account,
      cloudConnectionId: CONNECTION.toString(),
      provider: "aws",
      accountId: AWS_ACCOUNT[data.account]!,
      day: OneUptimeDate.toClickhouseDateTime(data.day),
      service: data.service,
      region: "us-east-1",
      resourceId: data.resourceId,
      cost: data.cost,
      amortizedCost: data.amortizedCost,
      netCost: data.netCost,
      currency: "USD",
      tags: data.tags,
      readAt: OneUptimeDate.toClickhouseDateTime(NOW),
    };
  };

  for (const day of utcDays("2026-11-01", "2026-11-30")) {
    rows.push(
      row({
        day,
        account: PROD,
        service: "Amazon EC2",
        resourceId: "i-0bases0pay",
        tags: { team: "payments" },
        cost: 10,
        amortizedCost: 7,
        netCost: 6,
      }),
      row({
        day,
        account: DATA,
        service: "Amazon S3",
        resourceId: "bases-data-bucket",
        tags: {},
        cost: 5,
        amortizedCost: 5,
        netCost: 4,
      }),
      row({
        day,
        account: SHARED,
        service: SUPPORT_SERVICE,
        resourceId: "",
        tags: {},
        cost: 3,
        amortizedCost: 3,
        netCost: 3,
      }),
    );
  }

  rows.push(
    row({
      day: new Date("2026-11-01T00:00:00Z"),
      account: PROD,
      service: "Savings Plans for AWS Compute usage",
      resourceId: "",
      tags: {},
      cost: 300,
      amortizedCost: 0,
      netCost: 0,
    }),
  );

  return rows;
}

// The basis the project shows, as its Cost Settings would answer.
let projectBasis: CloudCostBasis = CloudCostBasis.Billed;

// The view's groups, as the test sets them, in order.
let groups: Array<CloudCostGroup> = [];
let lineItems: Array<CloudCostLineItem> = [];

function group(data: {
  id: string;
  name: string;
  order: number;
  rules: Array<CloudCostRule>;
  isShared?: boolean;
  sharedSplit?: CloudCostSharedSplit;
  kubernetesClusterId?: string;
}): CloudCostGroup {
  const made: CloudCostGroup = new CloudCostGroup();
  made.id = new ObjectID(data.id);
  made.name = data.name;
  made.order = data.order;
  made.rules = data.rules;
  made.isShared = Boolean(data.isShared);
  made.sharedSplit = data.sharedSplit || CloudCostSharedSplit.Proportional;
  made.sharedPercentages = {};
  made.createdAt = new Date(`2026-01-0${Math.min(9, data.order)}T00:00:00Z`);

  if (data.kubernetesClusterId) {
    made.kubernetesClusterId = new ObjectID(data.kubernetesClusterId);
  }

  return made;
}

const PAYMENTS_BY_TAG: CloudCostRule = makeCloudCostRule({
  field: CloudCostRuleField.Tag,
  key: "team",
  value: "payments",
});
const DATA_BY_ACCOUNT: CloudCostRule = makeCloudCostRule({
  field: CloudCostRuleField.Account,
  value: DATA,
});
const SEARCH_BY_OWNER: CloudCostRule = makeCloudCostRule({
  field: CloudCostRuleField.OwnerTeam,
  value: SEARCH_TEAM,
});

function byTeam(): Array<CloudCostGroup> {
  return [
    group({
      id: PAYMENTS,
      name: "Payments",
      order: 1,
      rules: [PAYMENTS_BY_TAG],
    }),
    group({ id: DATA_GROUP, name: "Data", order: 2, rules: [DATA_BY_ACCOUNT] }),
    group({ id: SEARCH, name: "Search", order: 3, rules: [SEARCH_BY_OWNER] }),
  ];
}

function read(
  overrides: Partial<Parameters<typeof CloudCostAllocation.read>[0]> = {},
): Promise<CloudCostAllocationResult> {
  return CloudCostAllocation.read({
    projectId: PROJECT,
    viewId: VIEW,
    ...NOVEMBER,
    currency: "USD",
    props: { isRoot: true },
    now: NOW,
    ...overrides,
  });
}

function totals(result: CloudCostAllocationResult): Record<string, number> {
  const byName: Record<string, number> = {};

  for (const entry of result.groups) {
    byName[entry.name] = entry.total;
  }

  byName["(unallocated)"] = result.unallocated.total;

  return byName;
}

function sumOfTotals(result: CloudCostAllocationResult): number {
  return (
    result.groups.reduce(
      (sum: number, entry: CloudCostAllocationGroupResult): number => {
        return sum + entry.total;
      },
      0,
    ) + result.unallocated.total
  );
}

function byName(
  result: CloudCostAllocationResult,
  name: string,
): CloudCostAllocationGroupResult {
  const found: CloudCostAllocationGroupResult | undefined = result.groups.find(
    (entry: CloudCostAllocationGroupResult): boolean => {
      return entry.name === name;
    },
  );

  if (!found) {
    throw new Error(`No group ${name} in the read.`);
  }

  return found;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  model: AnalyticsBaseModel,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
    modelType,
    database: clickhouse,
  }).toColumnsCreateStatement(model.tableColumns);

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

integration("cost groups against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const saved: Array<{
    service: { database: ClickhouseDatabase; databaseClient: unknown };
    database: ClickhouseDatabase;
    databaseClient: unknown;
  }> = [];

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
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(
      client,
      clickhouse,
      new CloudCost(),
      CloudCost as unknown as { new (): AnalyticsBaseModel },
    );
    await createTable(
      client,
      clickhouse,
      new KubernetesCostAllocation(),
      KubernetesCostAllocation as unknown as { new (): AnalyticsBaseModel },
    );

    for (const service of [
      CloudCostService,
      KubernetesCostAllocationService,
    ] as unknown as Array<{
      database: ClickhouseDatabase;
      databaseClient: unknown;
    }>) {
      saved.push({
        service,
        database: service.database,
        databaseClient: service.databaseClient,
      });
      service.database = clickhouse;
      service.databaseClient = client;
    }

    await client.insert({
      table: `${database}.${new CloudCost().tableName}`,
      values: [...costRows([...SERIES, CLUSTER_NODES]), ...basesRows()],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
    await client.insert({
      table: `${database}.${new KubernetesCostAllocation().tableName}`,
      values: namespaceRows(),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    for (const entry of saved) {
      entry.service.database = entry.database;
      entry.service.databaseClient = entry.databaseClient;
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
    groups = byTeam();
    lineItems = [];
    projectBasis = CloudCostBasis.Billed;

    // What Postgres would answer, from the fixtures.
    jest
      .spyOn(CloudCostSettingService, "getCostBasisOfProject")
      .mockImplementation(async () => {
        return projectBasis;
      });
    jest
      .spyOn(CloudCostViewService, "findOneBy")
      .mockImplementation(async () => {
        const view: CloudCostView = new CloudCostView();
        view.id = VIEW;
        view.name = "By team";
        return view;
      });
    jest.spyOn(CloudCostGroupService, "findBy").mockImplementation(async () => {
      return groups;
    });
    jest
      .spyOn(CloudCostGroupService, "findOneBy")
      .mockImplementation(async (data: { query: Record<string, unknown> }) => {
        const asked: string = String(data.query["_id"]).toLowerCase();
        const found: CloudCostGroup | undefined = groups.find(
          (entry: CloudCostGroup): boolean => {
            return entry.id!.toString() === asked;
          },
        );

        if (found) {
          found.cloudCostViewId = VIEW;
        }

        return found || null;
      });
    jest
      .spyOn(CloudCostLineItemService, "findBy")
      .mockImplementation(async () => {
        return lineItems;
      });
    jest.spyOn(CloudAccountService, "findBy").mockImplementation(async () => {
      return [PROD, DATA, SHARED].map((id: string): CloudAccount => {
        const account: CloudAccount = new CloudAccount();
        account.id = new ObjectID(id);
        account.provider = "aws" as never;
        return account;
      });
    });
    jest
      .spyOn(CloudCostAllocationFacts, "readOwnerTeams")
      .mockImplementation(async () => {
        const owners: Map<string, Set<string>> = new Map();

        for (const entry of [...SERIES, CLUSTER_NODES]) {
          if (entry.owners.length > 0) {
            owners.set(entry.resourceId, new Set(entry.owners));
          }
        }

        return owners;
      });
    jest
      .spyOn(CloudCostAllocationFacts, "readResourceLabels")
      .mockImplementation(async () => {
        return new Map();
      });
    jest
      .spyOn(CloudCostAllocationFacts, "readAccountLabels")
      .mockImplementation(async () => {
        return new Map();
      });
  });

  test("a By team view - one group by tag, one by account, one by owner team - sorts the month with nothing counted twice", async () => {
    const result: CloudCostAllocationResult = await read();

    expect(totals(result)).toEqual({
      Payments: 420,
      Data: 150,
      Search: 210,
      "(unallocated)": 750 + 900,
    });
    // The groups and the unallocated add up to the month's total.
    expect(result.total).toBe(1530 + 900);
    expect(sumOfTotals(result)).toBeCloseTo(result.total, 6);
    expect(result.cloud).toBe(result.total);
    expect(result.lineItems).toBe(0);
    // Read by the day: thirty buckets, each a thirtieth.
    expect(result.interval).toBe(CloudCostAllocationInterval.Day);
    expect(result.buckets).toHaveLength(30);
    expect(
      byName(result, "Payments").series.every((value: number) => {
        return value === 14;
      }),
    ).toBe(true);
  });

  test("against last month: October cost half as much", async () => {
    const result: CloudCostAllocationResult = await read();

    expect(result.previousStart).toBe("2026-10-01");
    expect(result.previousLastDay).toBe("2026-10-31");
    // October has 31 days at half the daily amount.
    expect(byName(result, "Payments").previousTotal).toBeCloseTo(
      (14 / 2) * 31,
      6,
    );
    expect(result.previousTotal).toBeCloseTo(((51 + 30) / 2) * 31, 6);
  });

  test("a resource owned by two teams splits evenly: Search takes its half, Payments' half is unallocated", async () => {
    const result: CloudCostAllocationResult = await read();

    expect(result.unallocated.topOwnerTeams).toEqual([
      { key: PAYMENTS_TEAM, amount: 90 },
    ]);
    // Search: its database whole (120) and half the shared VM (90).
    expect(byName(result, "Search").cloud).toBe(210);
  });

  test("unallocated lists the largest unmatched services, accounts and tag values", async () => {
    const result: CloudCostAllocationResult = await read();

    expect(result.unallocated.topServices).toEqual([
      { key: "Amazon EC2", amount: 990 },
      { key: SUPPORT_SERVICE, amount: 600 },
      { key: "AmazonCloudWatch", amount: 60 },
    ]);
    expect(result.unallocated.topAccounts).toEqual([
      { key: PROD, amount: 1050 },
      { key: SHARED, amount: 600 },
    ]);
    expect(result.unallocated.topTagValues).toEqual([
      { key: "eks:cluster-name", value: "prod", amount: 900 },
      { key: "env", value: "prod", amount: 60 },
    ]);
  });

  test("a rule started from an unallocated service or tag value moves it into the group", async () => {
    groups[2]!.rules = [
      SEARCH_BY_OWNER,
      makeCloudCostRule({
        field: CloudCostRuleField.Tag,
        key: "env",
        value: "prod",
      }),
    ];
    groups.push(
      group({
        id: SUPPORT,
        name: "Support",
        order: 4,
        rules: [
          makeCloudCostRule({
            field: CloudCostRuleField.Service,
            value: SUPPORT_SERVICE,
          }),
        ],
      }),
    );

    const result: CloudCostAllocationResult = await read();

    expect(totals(result)).toEqual({
      Payments: 420,
      Data: 150,
      Search: 270,
      Support: 600,
      "(unallocated)": 90 + 900,
    });
    expect(result.unallocated.topServices).toEqual([
      { key: "Amazon EC2", amount: 990 },
    ]);
    expect(sumOfTotals(result)).toBeCloseTo(result.total, 6);
  });

  test("a shared support plan is split across the others by their share of the month's spend", async () => {
    groups.push(
      group({
        id: SUPPORT,
        name: "Support",
        order: 4,
        isShared: true,
        sharedSplit: CloudCostSharedSplit.Proportional,
        rules: [
          makeCloudCostRule({
            field: CloudCostRuleField.Service,
            value: SUPPORT_SERVICE,
          }),
        ],
      }),
    );

    const result: CloudCostAllocationResult = await read();
    const support: CloudCostAllocationGroupResult = byName(result, "Support");

    // 600 split 420 : 150 : 210 of 780.
    expect(byName(result, "Payments").sharedIn).toBeCloseTo(
      (600 * 420) / 780,
      3,
    );
    expect(byName(result, "Data").sharedIn).toBeCloseTo((600 * 150) / 780, 3);
    expect(byName(result, "Search").sharedIn).toBeCloseTo((600 * 210) / 780, 3);
    expect(byName(result, "Payments").total).toBeCloseTo(
      420 + (600 * 420) / 780,
      3,
    );
    expect(support.cloud).toBe(600);
    expect(support.sharedOut).toBeCloseTo(600, 3);
    expect(support.total).toBeCloseTo(0, 3);
    expect(
      support.sharedTo!.map((share: { key: string }): string => {
        return share.key;
      }),
    ).toEqual([PAYMENTS, SEARCH, DATA_GROUP]);
    expect(byName(result, "Payments").sharedFrom).toEqual([
      { key: SUPPORT, amount: expect.closeTo((600 * 420) / 780, 3) },
    ]);
    // The unallocated spend never takes a share.
    expect(result.unallocated.total).toBe(90 + 60 + 900);
    expect(sumOfTotals(result)).toBeCloseTo(result.total, 3);
  });

  test("the same month read by the month splits to what it does by the day", async () => {
    groups.push(
      group({
        id: SUPPORT,
        name: "Support",
        order: 4,
        isShared: true,
        rules: [
          makeCloudCostRule({
            field: CloudCostRuleField.Service,
            value: SUPPORT_SERVICE,
          }),
        ],
      }),
    );

    const byDay: CloudCostAllocationResult = await read();
    const byMonth: CloudCostAllocationResult = await read({
      interval: CloudCostAllocationInterval.Month,
    });

    expect(byMonth.buckets).toEqual(["2026-11-01"]);

    for (const name of ["Payments", "Data", "Search", "Support"]) {
      expect(byName(byMonth, name).total).toBeCloseTo(
        byName(byDay, name).total,
        3,
      );
      expect(byName(byMonth, name).series[0]).toBeCloseTo(
        byName(byDay, name).total,
        3,
      );
    }
  });

  test("changing a rule restates last month too, with nothing to backfill", async () => {
    const before: CloudCostAllocationResult = await read(OCTOBER);

    expect(byName(before, "Payments").total).toBeCloseTo((14 / 2) * 31, 6);

    // Payments takes the whole prod account now, ahead of Search.
    groups[0]!.rules = [
      makeCloudCostRule({ field: CloudCostRuleField.Account, value: PROD }),
    ];

    const after: CloudCostAllocationResult = await read(OCTOBER);
    const prodPerDay: number = 10 + 4 + 6 + 2 + 3 + 30;

    expect(byName(after, "Payments").total).toBeCloseTo(
      (prodPerDay / 2) * 31,
      6,
    );
    expect(byName(after, "Search").total).toBe(0);
    expect(after.total).toBeCloseTo(before.total, 6);
  });

  test("what an earlier group takes is said: a group's rules would match more than it gets", async () => {
    groups.push(
      group({
        id: SUPPORT,
        name: "Compute",
        order: 4,
        rules: [
          {
            conditions: [
              {
                field: CloudCostRuleField.Service,
                operator: CloudCostRuleOperator.Is,
                values: ["Amazon EC2"],
              },
            ],
          },
        ],
      }),
    );

    const result: CloudCostAllocationResult = await read();
    const compute: CloudCostAllocationGroupResult = byName(result, "Compute");

    // Every EC2 cost: pay-api 300, shared-vm 180, pay-worker 90, pay-in-data 30, nodes 900.
    expect(compute.wouldMatch).toBe(1500);
    // What is left once Payments and Search took theirs.
    expect(compute.cloud).toBe(90 + 900);
  });

  test("a group no rule can ever reach names the earlier group that takes it all", async () => {
    groups.push(
      group({
        id: SUPPORT,
        name: "Payments again",
        order: 4,
        rules: [
          {
            conditions: [
              {
                field: CloudCostRuleField.Tag,
                key: "team",
                operator: CloudCostRuleOperator.Is,
                values: ["payments"],
              },
              {
                field: CloudCostRuleField.Region,
                operator: CloudCostRuleOperator.Is,
                values: ["us-east-1"],
              },
            ],
          },
        ],
      }),
    );

    const result: CloudCostAllocationResult = await read();

    expect(byName(result, "Payments again").coveredByGroupId).toBe(PAYMENTS);
    expect(byName(result, "Payments again").total).toBe(0);
  });

  test("a Kubernetes cluster's nodes split by its namespaces' labels, never counted twice", async () => {
    groups[2]!.rules = [
      SEARCH_BY_OWNER,
      makeCloudCostRule({
        field: CloudCostRuleField.Tag,
        key: "team",
        value: "search",
      }),
    ];
    groups.push(
      group({
        id: CLUSTER_GROUP,
        name: "Prod cluster",
        order: 4,
        isShared: true,
        sharedSplit: CloudCostSharedSplit.Kubernetes,
        kubernetesClusterId: CLUSTER,
        rules: [
          makeCloudCostRule({
            field: CloudCostRuleField.Tag,
            key: "eks:cluster-name",
            value: "prod",
          }),
        ],
      }),
    );

    const result: CloudCostAllocationResult = await read();
    const cluster: CloudCostAllocationGroupResult = byName(
      result,
      "Prod cluster",
    );

    // 900 of nodes: payments half, search three tenths, the idle fifth stays.
    expect(cluster.cloud).toBe(900);
    expect(byName(result, "Payments").sharedIn).toBeCloseTo(450, 3);
    expect(byName(result, "Search").sharedIn).toBeCloseTo(270, 3);
    expect(cluster.total).toBeCloseTo(180, 3);
    // The cluster's own engine priced 3,000 that month: none of it is added.
    expect(result.total).toBe(1530 + 900);
    expect(sumOfTotals(result)).toBeCloseTo(result.total, 3);
    expect(result.unallocated.total).toBe(750);
  });

  test("custom line items: an account's goes through the rules, a group's to the group, both apart from the cloud's", async () => {
    const credit: CloudCostLineItem = new CloudCostLineItem();
    credit.id = ObjectID.generate();
    credit.kind = CloudCostLineItemKind.Credit;
    credit.amount = 60;
    credit.recurrence = CloudCostLineItemRecurrence.Monthly;
    credit.startDate = new Date("2026-01-15T00:00:00Z");
    credit.cloudAccountId = new ObjectID(DATA);

    const fee: CloudCostLineItem = new CloudCostLineItem();
    fee.id = ObjectID.generate();
    fee.kind = CloudCostLineItemKind.Charge;
    fee.amount = 120;
    fee.recurrence = CloudCostLineItemRecurrence.Once;
    fee.startDate = new Date("2026-11-15T09:00:00Z");
    fee.cloudCostGroupId = new ObjectID(SEARCH);

    // An account no group takes: its line item is unallocated.
    const orphan: CloudCostLineItem = new CloudCostLineItem();
    orphan.id = ObjectID.generate();
    orphan.kind = CloudCostLineItemKind.Charge;
    orphan.amount = 30;
    orphan.recurrence = CloudCostLineItemRecurrence.Monthly;
    orphan.startDate = new Date("2026-11-01T00:00:00Z");
    orphan.cloudAccountId = new ObjectID(SHARED);

    lineItems = [credit, fee, orphan];

    const result: CloudCostAllocationResult = await read();

    expect(byName(result, "Data").lineItems).toBeCloseTo(-60, 3);
    expect(byName(result, "Data").cloud).toBe(150);
    expect(byName(result, "Data").total).toBeCloseTo(90, 3);
    expect(byName(result, "Search").lineItems).toBe(120);
    expect(result.unallocated.lineItems).toBeCloseTo(30, 3);
    expect(result.lineItems).toBeCloseTo(90, 3);
    expect(result.cloud).toBe(1530 + 900);
    expect(result.total).toBeCloseTo(1530 + 900 + 90, 3);
    expect(sumOfTotals(result)).toBeCloseTo(result.total, 3);
    // The one-off fee lands on its day.
    const fifteenth: number = result.buckets.indexOf("2026-11-15");
    expect(byName(result, "Search").series[fifteenth]).toBeCloseTo(7 + 120, 3);
  });

  test("a group's own read: its top services, resources and accounts", async () => {
    const read: {
      allocation: CloudCostAllocationResult;
      group: CloudCostAllocationGroupResult;
    } = await CloudCostAllocation.readGroup({
      projectId: PROJECT,
      groupId: new ObjectID(PAYMENTS),
      ...NOVEMBER,
      currency: "USD",
      props: { isRoot: true },
      now: NOW,
    });

    expect(read.group.name).toBe("Payments");
    expect(read.group.total).toBe(420);
    expect(read.group.topServices).toEqual([
      { key: "Amazon EC2", amount: 420 },
    ]);
    expect(read.group.topResources).toEqual([
      { key: "i-0pay0api", amount: 300 },
      { key: "i-0pay0worker", amount: 90 },
      { key: "i-0pay0data", amount: 30 },
    ]);
    expect(read.group.topAccounts).toEqual([
      { key: PROD, amount: 390 },
      { key: DATA, amount: 30 },
    ]);
  });

  test("a read of one account's costs", async () => {
    const result: CloudCostAllocationResult = await read({
      cloudAccountIds: [new ObjectID(DATA)],
    });

    expect(totals(result)).toEqual({
      Payments: 30,
      Data: 150,
      Search: 0,
      "(unallocated)": 0,
    });
  });

  test("a read in euros reads the euros alone", async () => {
    const result: CloudCostAllocationResult = await read({ currency: "eur" });

    expect(result.currency).toBe("EUR");
    expect(result.total).toBe(999);
    expect(byName(result, "Payments").total).toBe(999);
  });

  test("reads split into parts when the facts name many resources add up to the same", async () => {
    const whole: CloudCostAllocationResult = await read();
    const actual: typeof CloudCostAllocationClass.partition =
      CloudCostAllocationClass.partition.bind(CloudCostAllocationClass);
    // One resource a part, as many parts as a read makes.
    jest
      .spyOn(CloudCostAllocationClass, "partition")
      .mockImplementation(
        (
          ctx: Parameters<typeof CloudCostAllocationClass.partition>[0],
        ): ReturnType<typeof CloudCostAllocationClass.partition> => {
          return actual(ctx, 1);
        },
      );

    const parted: CloudCostAllocationResult = await read();

    expect(CloudCostAllocationClass.partition).toHaveBeenCalled();
    expect(
      actual(
        {
          databaseName: database,
          tableName: "CloudCostV1",
          where: new Statement(),
          groups: [],
          facts: {
            ...emptyCloudCostQueryFacts(),
            resourceHashes: ["0A", "1B", "2C", "3D"],
            resourceClasses: [1, 1, 1, 1],
          },
        },
        1,
      ),
    ).toHaveLength(4);
    expect(totals(parted)).toEqual(totals(whole));
    expect(parted.unallocated.topServices).toEqual(
      whole.unallocated.topServices,
    );
    expect(parted.unallocated.topOwnerTeams).toEqual(
      whole.unallocated.topOwnerTeams,
    );
  });

  describe("on each cost basis (#11007)", () => {
    const SAVINGS_PLAN_FEE: string = "Savings Plans for AWS Compute usage";

    const supportGroup: () => CloudCostGroup = (): CloudCostGroup => {
      return group({
        id: SUPPORT,
        name: "Support",
        order: 4,
        isShared: true,
        sharedSplit: CloudCostSharedSplit.Proportional,
        rules: [
          makeCloudCostRule({
            field: CloudCostRuleField.Service,
            value: SUPPORT_SERVICE,
          }),
        ],
      });
    };

    const readBases: (
      overrides?: Partial<Parameters<typeof CloudCostAllocation.read>[0]>,
    ) => Promise<CloudCostAllocationResult> = (
      overrides: Partial<Parameters<typeof CloudCostAllocation.read>[0]> = {},
    ): Promise<CloudCostAllocationResult> => {
      return read({
        projectId: BASES_PROJECT,
        compareWithPrevious: false,
        ...overrides,
      });
    };

    test("each basis sums its own column: the plan's fee is billed on the 1st, and amortized into the usage it paid for", async () => {
      const billed: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Billed,
      });
      const amortized: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Amortized,
      });
      const net: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Net,
      });

      expect([billed.basis, amortized.basis, net.basis]).toEqual([
        CloudCostBasis.Billed,
        CloudCostBasis.Amortized,
        CloudCostBasis.Net,
      ]);

      // Billed: pay-api's 10 a day, and the plan's 300 nobody's rule takes.
      expect(byName(billed, "Payments").total).toBe(300);
      expect(byName(billed, "Data").total).toBe(150);
      expect(billed.unallocated.total).toBe(300 + 90);
      expect(billed.total).toBe(840);
      expect(billed.unallocated.topServices).toEqual([
        { key: SAVINGS_PLAN_FEE, amount: 300 },
        { key: SUPPORT_SERVICE, amount: 90 },
      ]);

      // Amortized: the fee is in the usage it covered, 7 a day, and gone from the 1st.
      expect(byName(amortized, "Payments").total).toBe(210);
      expect(byName(amortized, "Data").total).toBe(150);
      expect(amortized.unallocated.total).toBe(90);
      expect(amortized.total).toBe(450);
      expect(amortized.unallocated.topServices).toEqual([
        { key: SUPPORT_SERVICE, amount: 90 },
      ]);
      expect(byName(amortized, "Payments").series[0]).toBe(7);
      expect(byName(billed, "Payments").series[0]).toBe(10);

      // Net: the credits off too.
      expect(byName(net, "Payments").total).toBe(180);
      expect(byName(net, "Data").total).toBe(120);
      expect(net.total).toBe(390);

      for (const result of [billed, amortized, net]) {
        expect(sumOfTotals(result)).toBeCloseTo(result.total, 6);
      }
    });

    test("a shared group splits by each group's spend on the same basis", async () => {
      groups = [...byTeam(), supportGroup()];

      const billed: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Billed,
      });
      const amortized: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Amortized,
      });
      const net: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Net,
      });

      // Support's 90: Payments 300 of 450 billed, 210 of 360 amortized, 180 of 300 net.
      expect(byName(billed, "Payments").sharedIn).toBeCloseTo(60, 6);
      expect(byName(billed, "Data").sharedIn).toBeCloseTo(30, 6);
      expect(byName(amortized, "Payments").sharedIn).toBeCloseTo(52.5, 6);
      expect(byName(amortized, "Data").sharedIn).toBeCloseTo(37.5, 6);
      expect(byName(net, "Payments").sharedIn).toBeCloseTo(54, 6);
      expect(byName(net, "Data").sharedIn).toBeCloseTo(36, 6);

      expect(byName(billed, "Payments").total).toBeCloseTo(360, 6);
      expect(byName(amortized, "Payments").total).toBeCloseTo(262.5, 6);
      expect(byName(net, "Payments").total).toBeCloseTo(234, 6);
      expect(byName(amortized, "Support").total).toBeCloseTo(0, 6);

      // The split moves spend between groups; the month's total stays the basis's own.
      expect(billed.total).toBe(840);
      expect(amortized.total).toBe(450);
      expect(net.total).toBe(390);
    });

    test("asked for none, a read is on the project's basis", async () => {
      projectBasis = CloudCostBasis.Net;

      const result: CloudCostAllocationResult = await readBases();

      expect(result.basis).toBe(CloudCostBasis.Net);
      expect(byName(result, "Payments").total).toBe(180);
      expect(CloudCostSettingService.getCostBasisOfProject).toHaveBeenCalled();
    });

    test("asked for one, the project's is not read", async () => {
      projectBasis = CloudCostBasis.Net;

      const result: CloudCostAllocationResult = await readBases({
        basis: CloudCostBasis.Amortized,
      });

      expect(result.basis).toBe(CloudCostBasis.Amortized);
      expect(byName(result, "Payments").total).toBe(210);
      expect(
        CloudCostSettingService.getCostBasisOfProject,
      ).not.toHaveBeenCalled();
    });

    test("one group's own spend is on the basis asked", async () => {
      const own: {
        allocation: CloudCostAllocationResult;
        group: CloudCostAllocationGroupResult;
      } = await CloudCostAllocation.readGroup({
        projectId: BASES_PROJECT,
        groupId: new ObjectID(PAYMENTS),
        ...NOVEMBER,
        currency: "USD",
        basis: CloudCostBasis.Amortized,
        compareWithPrevious: false,
        props: { isRoot: true },
        now: NOW,
      });

      expect(own.allocation.basis).toBe(CloudCostBasis.Amortized);
      expect(own.group.total).toBe(210);
      expect(own.group.series[0]).toBe(7);
    });
  });
});

describe("the cost groups' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

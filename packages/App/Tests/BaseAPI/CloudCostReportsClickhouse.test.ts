import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostReport from "Common/Models/DatabaseModels/CloudCostReport";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import CloudAccountService from "Common/Server/Services/CloudAccountService";
import CloudBudgetService from "Common/Server/Services/CloudBudgetService";
import CloudConnectionService from "Common/Server/Services/CloudConnectionService";
import CloudCostGroupService from "Common/Server/Services/CloudCostGroupService";
import CloudCostLineItemService from "Common/Server/Services/CloudCostLineItemService";
import CloudCostRecommendationService from "Common/Server/Services/CloudCostRecommendationService";
import CloudCostService from "Common/Server/Services/CloudCostService";
import CloudCostSettingService from "Common/Server/Services/CloudCostSettingService";
import CloudCostViewService from "Common/Server/Services/CloudCostViewService";
import KubernetesCostAllocationService from "Common/Server/Services/KubernetesCostAllocationService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import CloudCostAllocation from "Common/Server/Utils/CloudCost/CloudCostAllocation";
import CloudCostAllocationFacts from "Common/Server/Utils/CloudCost/CloudCostAllocationFacts";
import {
  CloudCostBreakdownAnswer,
  CloudCostBreakdownAnswerShare,
  answerCloudCostBreakdown,
  readCloudCostBreakdownBody,
  toCloudCostBreakdownAnswerCsv,
} from "Common/Server/Utils/CloudCost/CloudCostBreakdownAnswer";
import CloudCostFocusExport from "Common/Server/Utils/CloudCost/CloudCostFocusExport";
import CloudCostReportBuilder from "Common/Server/Utils/CloudCost/CloudCostReportBuilder";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudCostAllocationResult } from "Common/Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "Common/Types/Cloud/CloudCostBasis";
import { CloudCostState } from "Common/Types/Cloud/CloudCost";
import { CLOUD_COST_FOCUS_COLUMNS } from "Common/Types/Cloud/CloudCostFocus";
import {
  CloudCostReportContent,
  CloudCostReportLine,
  CloudCostReportPeriod,
  CloudCostReportScope,
} from "Common/Types/Cloud/CloudCostReport";
import {
  CloudCostRule,
  CloudCostRuleField,
  makeCloudCostRule,
} from "Common/Types/Cloud/CloudCostRules";
import { GCP_BILLING_EXPORT_TABLE_FIELD_KEY } from "Common/Types/CloudConnection/CloudConnectionCatalog";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
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
 * COST REPORTS, BREAKDOWNS AND THE FOCUS EXPORT AGAINST A REAL
 * CLICKHOUSE (#11009).
 *
 * The product's own CloudCost table, built from its model in a database of
 * this suite's own, holds a project's October and November; every figure
 * the API's breakdown, a scheduled report and the FOCUS file give is read
 * by the server's own statements, and checked against the table summed by
 * hand (plain SQL here): what a report says is what Costs shows for the
 * same days, view and basis. What Postgres would answer - the accounts,
 * the view's groups, budgets - is handed in as fixtures.
 *
 * November, a day:          billed  amortized  net   tags
 *   pay-api   prod  EC2        10        7       6   team=payments
 *   data-lake data  S3          5        5       4   -
 *   search-db prod  RDS         4        4       4   team=search
 *   az-vm     azure VMs         3        3       3   team=payments
 *   gcp-run   gcp   Cloud Run   2        2       2   -
 *   tax       prod  Tax         1        1       1   -
 * plus 100 more on pay-api on 18 November, an unusual day. October costs
 * half of each, a day. 850 billed in November, 760 amortized, 700 net.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm --name <a name of your own> -p 127.0.0.1:18606:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7.38.18
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18606 \
 *     npx jest Tests/BaseAPI/CloudCostReportsClickhouse.test.ts
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_cost_reports_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011009");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-000000099999",
);
const VIEW: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000e0009");
const AWS_CONNECTION: string = "0192f1a0-1100-7000-8000-0000000c0001";
const GCP_CONNECTION: string = "0192f1a0-1100-7000-8000-0000000c0002";
const AZURE_CONNECTION: string = "0192f1a0-1100-7000-8000-0000000c0003";

const PROD: string = "0192f1a0-1100-7000-8000-00000000ac01";
const DATA: string = "0192f1a0-1100-7000-8000-00000000ac02";
const AZURE: string = "0192f1a0-1100-7000-8000-00000000ac03";
const GCP: string = "0192f1a0-1100-7000-8000-00000000ac04";

const PAYMENTS: string = "0192f1a0-1100-7000-8000-00000000c001";
const SEARCH: string = "0192f1a0-1100-7000-8000-00000000c002";
const DATA_GROUP: string = "0192f1a0-1100-7000-8000-00000000c003";

interface AccountFixture {
  id: string;
  name: string;
  provider: string;
  accountId: string;
  connectionId: string;
}

const ACCOUNTS: Array<AccountFixture> = [
  {
    id: PROD,
    name: "Production AWS",
    provider: "aws",
    accountId: "111111111111",
    connectionId: AWS_CONNECTION,
  },
  {
    id: DATA,
    name: "Data AWS",
    provider: "aws",
    accountId: "222222222222",
    connectionId: AWS_CONNECTION,
  },
  {
    id: AZURE,
    name: "Shop Azure",
    provider: "azure",
    accountId: "00000000-1111-2222-3333-444444444444",
    connectionId: AZURE_CONNECTION,
  },
  {
    id: GCP,
    name: "shop-prod",
    provider: "gcp",
    accountId: "shop-prod",
    connectionId: GCP_CONNECTION,
  },
];

interface Series {
  account: string;
  service: string;
  region: string;
  resourceId: string;
  tags: Record<string, string>;
  cost: number;
  amortizedCost: number;
  netCost: number;
}

const SERIES: Array<Series> = [
  {
    account: PROD,
    service: "Amazon Elastic Compute Cloud",
    region: "us-east-1",
    resourceId: "i-0pay0api",
    tags: { team: "payments" },
    cost: 10,
    amortizedCost: 7,
    netCost: 6,
  },
  {
    account: DATA,
    service: "Amazon Simple Storage Service",
    region: "us-east-1",
    resourceId: "data-lake-bucket",
    tags: {},
    cost: 5,
    amortizedCost: 5,
    netCost: 4,
  },
  {
    account: PROD,
    service: "Amazon Relational Database Service",
    region: "eu-west-1",
    resourceId: "arn:aws:rds:eu-west-1:111111111111:db:search",
    tags: { team: "search" },
    cost: 4,
    amortizedCost: 4,
    netCost: 4,
  },
  {
    account: AZURE,
    service: "Virtual Machines",
    region: "westeurope",
    resourceId:
      "/subscriptions/00000000-1111-2222-3333-444444444444/resourceGroups/shop/providers/Microsoft.Compute/virtualMachines/vm-1",
    tags: { team: "payments" },
    cost: 3,
    amortizedCost: 3,
    netCost: 3,
  },
  {
    account: GCP,
    service: "Cloud Run",
    region: "us-central1",
    resourceId: "//run.googleapis.com/projects/shop-prod/services/checkout",
    tags: {},
    cost: 2,
    amortizedCost: 2,
    netCost: 2,
  },
  {
    account: PROD,
    service: "Tax",
    region: "",
    resourceId: "",
    tags: {},
    cost: 1,
    amortizedCost: 1,
    netCost: 1,
  },
];

const UNUSUAL_DAY: string = "2026-11-18";

// The reads' "today": two days into December.
const NOW: Date = new Date("2026-12-02T12:00:00.000Z");
// When a monthly report is due: 09:00 on 1 December in Berlin.
const DUE: Date = new Date("2026-12-01T08:00:00.000Z");

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

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

function accountIdOf(id: string): string {
  return ACCOUNTS.find((account: AccountFixture) => {
    return account.id === id;
  })!.accountId;
}

function providerOf(id: string): string {
  return ACCOUNTS.find((account: AccountFixture) => {
    return account.id === id;
  })!.provider;
}

function row(data: {
  project?: ObjectID;
  series: Series;
  day: Date;
  scale?: number;
  currency?: string;
  extra?: number;
}): JSONObject {
  const scale: number = data.scale ?? 1;
  const extra: number = data.extra ?? 0;

  return {
    _id: ObjectID.generate().toString(),
    projectId: (data.project || PROJECT).toString(),
    cloudAccountId: data.series.account,
    cloudConnectionId: ACCOUNTS.find((account: AccountFixture) => {
      return account.id === data.series.account;
    })!.connectionId,
    provider: providerOf(data.series.account),
    accountId: accountIdOf(data.series.account),
    day: OneUptimeDate.toClickhouseDateTime(data.day),
    service: data.series.service,
    region: data.series.region,
    resourceId: data.series.resourceId,
    cost: extra || data.series.cost * scale,
    amortizedCost: extra || data.series.amortizedCost * scale,
    netCost: extra || data.series.netCost * scale,
    currency: data.currency || "USD",
    tags: data.series.tags,
    readAt: OneUptimeDate.toClickhouseDateTime(NOW),
  };
}

function costRows(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (const day of utcDays("2026-10-01", "2026-11-30")) {
    const isOctober: boolean = day.getUTCMonth() === 9;

    for (const series of SERIES) {
      rows.push(row({ series, day, scale: isOctober ? 0.5 : 1 }));
    }
  }

  // The unusual day: a hundred more on pay-api.
  rows.push(
    row({
      series: SERIES[0]!,
      day: new Date(`${UNUSUAL_DAY}T00:00:00.000Z`),
      extra: 100,
    }),
  );

  // Billed in euros: never added to dollars, but in the FOCUS file as itself.
  rows.push(
    row({
      series: SERIES[0]!,
      day: new Date("2026-11-03T00:00:00.000Z"),
      extra: 999,
      currency: "EUR",
    }),
  );

  // Another project's cost of the same accounts: never read.
  rows.push(
    row({
      project: OTHER_PROJECT,
      series: SERIES[0]!,
      day: new Date("2026-11-03T00:00:00.000Z"),
      extra: 5000,
    }),
  );

  return rows;
}

function accountsFixture(): Array<CloudAccount> {
  return ACCOUNTS.map((fixture: AccountFixture): CloudAccount => {
    const account: CloudAccount = new CloudAccount();
    account.id = new ObjectID(fixture.id);
    account.name = fixture.name;
    account.provider = fixture.provider as never;
    account.accountId = fixture.accountId;
    account.cloudConnectionId = new ObjectID(fixture.connectionId);
    account.costSummary = {
      state: CloudCostState.Reading,
      currency: "USD",
      monthToDate: 0,
      lastMonth: 0,
      monthFullDays: 0,
      lastMonthToDate: 0,
      projectedMonth: 0,
      last30Days: 0,
      topServices: [],
    } as unknown as JSONObject;
    return account;
  });
}

function group(data: {
  id: string;
  name: string;
  order: number;
  rules: Array<CloudCostRule>;
}): CloudCostGroup {
  const made: CloudCostGroup = new CloudCostGroup();
  made.id = new ObjectID(data.id);
  made.name = data.name;
  made.order = data.order;
  made.rules = data.rules;
  made.isShared = false;
  made.sharedPercentages = {};
  made.createdAt = new Date(`2026-01-0${data.order}T00:00:00Z`);
  made.cloudCostViewId = VIEW;
  return made;
}

const GROUPS: Array<CloudCostGroup> = [
  group({
    id: PAYMENTS,
    name: "Payments",
    order: 1,
    rules: [
      makeCloudCostRule({
        field: CloudCostRuleField.Tag,
        key: "team",
        value: "payments",
      }),
    ],
  }),
  group({
    id: SEARCH,
    name: "Search",
    order: 2,
    rules: [
      makeCloudCostRule({
        field: CloudCostRuleField.Tag,
        key: "team",
        value: "search",
      }),
    ],
  }),
  group({
    id: DATA_GROUP,
    name: "Data",
    order: 3,
    rules: [
      makeCloudCostRule({ field: CloudCostRuleField.Account, value: DATA }),
    ],
  }),
];

function reportOf(overrides: Partial<CloudCostReport> = {}): CloudCostReport {
  const report: CloudCostReport = new CloudCostReport();
  report.id = new ObjectID("0192f1a0-1100-7000-8000-0000000f0009");
  report.projectId = PROJECT;
  report.name = "Monthly cloud costs";
  report.scope = CloudCostReportScope.AllAccounts;
  report.period = CloudCostReportPeriod.LastMonth;
  report.timezone = "Europe/Berlin" as never;
  Object.assign(report, overrides);
  return report;
}

function build(
  report: CloudCostReport,
  extra: { groupId?: ObjectID; props?: DatabaseCommonInteractionProps } = {},
): Promise<CloudCostReportContent> {
  return CloudCostReportBuilder.build({
    report,
    projectId: PROJECT,
    projectName: "Acme",
    props: extra.props || ROOT,
    at: DUE,
    groupId: extra.groupId,
    dashboardUrl: URL.fromString("https://oneuptime.example/dashboard"),
  });
}

function sharesByName(
  shares: Array<CloudCostBreakdownAnswerShare | CloudCostReportLine>,
): Record<string, number> {
  const byName: Record<string, number> = {};

  for (const share of shares) {
    byName[share.name] = share.amount;
  }

  return byName;
}

// A CSV read back: header names to each row's values.
function readCsv(text: string): Array<Record<string, string>> {
  const lines: Array<Array<string>> = [];
  let row: Array<string> = [];
  let field: string = "";
  let isQuoted: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const char: string = text.charAt(index);

    if (isQuoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        isQuoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      isQuoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      lines.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  const header: Array<string> = lines[0] || [];

  return lines.slice(1).map((values: Array<string>) => {
    const record: Record<string, string> = {};

    header.forEach((name: string, position: number) => {
      record[name] = values[position] ?? "";
    });

    return record;
  });
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

integration("cost reports, breakdowns and FOCUS against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const saved: Array<{
    service: { database: ClickhouseDatabase; databaseClient: unknown };
    database: ClickhouseDatabase;
    databaseClient: unknown;
  }> = [];
  let projectBasis: CloudCostBasis = CloudCostBasis.Billed;
  let budgets: Array<CloudBudget> = [];

  // The table summed by hand: what every figure must come to.
  async function sumOf(data: {
    by?: string;
    basis?: CloudCostBasis;
    start: string;
    end: string;
    accounts?: Array<string>;
  }): Promise<Record<string, number>> {
    const column: string =
      data.basis === CloudCostBasis.Amortized
        ? "amortizedCost"
        : data.basis === CloudCostBasis.Net
          ? "netCost"
          : "cost";
    const key: string = data.by || "'total'";
    const result: { json: () => Promise<unknown> } = (await client.query({
      query: `SELECT toString(${key}) AS k, sum(${column}) AS v FROM ${database}.${new CloudCost().tableName}
        WHERE toString(projectId) = {project:String} AND currency = 'USD'
          AND day >= toDateTime({start:String}, 'UTC') AND day <= toDateTime({end:String}, 'UTC')
          ${data.accounts ? "AND has({accounts:Array(String)}, toString(cloudAccountId))" : ""}
        GROUP BY k`,
      query_params: {
        project: PROJECT.toString(),
        start: `${data.start} 00:00:00`,
        end: `${data.end} 23:59:59`,
        ...(data.accounts ? { accounts: data.accounts } : {}),
      },
      format: "JSONEachRow",
    })) as unknown as { json: () => Promise<unknown> };
    const rows: Array<{ k: string; v: number }> =
      (await result.json()) as Array<{
        k: string;
        v: number;
      }>;
    const sums: Record<string, number> = {};

    for (const entry of rows) {
      sums[entry.k] = Math.round(Number(entry.v) * 10000) / 10000;
    }

    return sums;
  }

  function answer(
    body: JSONObject,
    props: DatabaseCommonInteractionProps = ROOT,
  ): Promise<CloudCostBreakdownAnswer> {
    return answerCloudCostBreakdown({
      projectId: PROJECT,
      props,
      request: readCloudCostBreakdownBody(body, NOW),
      now: NOW,
    });
  }

  beforeAll(async (): Promise<void> => {
    const parsed: globalThis.URL = new globalThis.URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${parsed.protocol}//${parsed.host}`,
      username: decodeURIComponent(parsed.username) || "default",
      password: decodeURIComponent(parsed.password),
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
      values: costRows(),
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
    projectBasis = CloudCostBasis.Billed;
    budgets = [];

    // What Postgres would answer, from the fixtures.
    jest.spyOn(CloudAccountService, "findBy").mockImplementation((async () => {
      return accountsFixture();
    }) as never);
    jest
      .spyOn(CloudCostSettingService, "getCostBasisOfProject")
      .mockImplementation(async () => {
        return projectBasis;
      });
    jest
      .spyOn(CloudCostViewService, "findOneBy")
      .mockImplementation((async () => {
        const view: CloudCostView = new CloudCostView();
        view.id = VIEW;
        view.name = "By team";
        return view;
      }) as never);
    jest
      .spyOn(CloudCostGroupService, "findBy")
      .mockImplementation((async () => {
        return GROUPS;
      }) as never);
    jest
      .spyOn(CloudCostGroupService, "findOneBy")
      .mockImplementation((async (data: { query: Record<string, unknown> }) => {
        const asked: string = String(data.query["_id"]).toLowerCase();
        return (
          GROUPS.find((entry: CloudCostGroup): boolean => {
            return entry.id!.toString() === asked;
          }) || null
        );
      }) as never);
    jest
      .spyOn(CloudCostLineItemService, "findBy")
      .mockImplementation((async () => {
        return [];
      }) as never);
    jest
      .spyOn(CloudCostAllocationFacts, "readOwnerTeams")
      .mockImplementation(async () => {
        return new Map();
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
    jest.spyOn(CloudBudgetService, "findBy").mockImplementation((async () => {
      return budgets;
    }) as never);
    jest
      .spyOn(CloudCostRecommendationService, "findBy")
      .mockImplementation((async () => {
        return [];
      }) as never);
    jest
      .spyOn(CloudConnectionService, "findBy")
      .mockImplementation((async () => {
        const aws: CloudConnection = new CloudConnection();
        aws.id = new ObjectID(AWS_CONNECTION);
        aws.name = "Acme organization";
        // The organization's management account reads the bill.
        aws.config = {
          roleArn: "arn:aws:iam::999999999999:role/OneUptimeReader",
          externalId: "never written to the file",
        };
        const gcp: CloudConnection = new CloudConnection();
        gcp.id = new ObjectID(GCP_CONNECTION);
        gcp.name = "Acme billing";
        gcp.config = {
          [GCP_BILLING_EXPORT_TABLE_FIELD_KEY]:
            "billing-project.billing.gcp_billing_export_v1_01A2B3_C4D5E6_F7A8B9",
        };
        const azure: CloudConnection = new CloudConnection();
        azure.id = new ObjectID(AZURE_CONNECTION);
        azure.name = "Acme Azure";
        azure.config = {};
        return [aws, gcp, azure];
      }) as never);
  });

  describe("the API's breakdown is the table's own", () => {
    test.each([
      ["service", "service"],
      ["region", "region"],
      ["account", "cloudAccountId"],
      ["resource", "resourceId"],
    ])(
      "by %s, on every basis, last month against the month before",
      async (by: string, column: string) => {
        for (const basis of [
          CloudCostBasis.Billed,
          CloudCostBasis.Amortized,
          CloudCostBasis.Net,
        ]) {
          const result: CloudCostBreakdownAnswer = await answer({
            by,
            period: "last-month",
            basis,
          });
          const november: Record<string, number> = await sumOf({
            by: column,
            basis,
            start: "2026-11-01",
            end: "2026-11-30",
          });
          const october: Record<string, number> = await sumOf({
            by: column,
            basis,
            start: "2026-10-01",
            end: "2026-10-31",
          });

          expect([basis, result.start, result.lastDay]).toEqual([
            basis,
            "2026-11-01",
            "2026-11-30",
          ]);
          expect([result.previousStart, result.previousLastDay]).toEqual([
            "2026-10-01",
            "2026-10-31",
          ]);
          expect(result.basis).toBe(basis);
          expect(result.currency).toBe("USD");

          const amounts: Record<string, number> = {};
          const previous: Record<string, number> = {};

          for (const share of result.shares) {
            amounts[share.key] = share.amount;
            previous[share.key] = share.previousAmount || 0;
          }

          expect(amounts).toEqual(november);
          expect(previous).toEqual(october);
          expect(result.total).toBeCloseTo(
            Object.values(november).reduce((a: number, b: number) => {
              return a + b;
            }, 0),
            6,
          );
        }
      },
    );

    test("the totals are the ones said: 850 billed, 760 amortized, 700 net", async () => {
      expect(
        (await answer({ by: "service", period: "last-month" })).total,
      ).toBe(850);
      expect(
        (
          await answer({
            by: "service",
            period: "last-month",
            basis: "amortized",
          })
        ).total,
      ).toBe(760);
      expect(
        (await answer({ by: "service", period: "last-month", basis: "net" }))
          .total,
      ).toBe(700);
    });

    test("an account is named as the page names it, costliest first", async () => {
      const result: CloudCostBreakdownAnswer = await answer({
        by: "account",
        period: "last-month",
      });

      expect(
        result.shares.map((share: CloudCostBreakdownAnswerShare) => {
          return [share.name, share.amount];
        }),
      ).toEqual([
        ["Production AWS", 550],
        ["Data AWS", 150],
        ["Shop Azure", 90],
        ["shop-prod", 60],
      ]);
    });

    test("by a tag's value, with what carries none said apart", async () => {
      const result: CloudCostBreakdownAnswer = await answer({
        by: "tag",
        tagKey: "team",
        period: "last-month",
      });
      const byValue: Record<string, number> = await sumOf({
        by: "tags['team']",
        start: "2026-11-01",
        end: "2026-11-30",
      });

      expect(sharesByName(result.shares)).toEqual({
        payments: byValue["payments"],
        search: byValue["search"],
      });
      expect(result.rest).toEqual([
        {
          kind: "without-tag",
          name: "Without the tag",
          amount: byValue[""],
          // October's 31 days at half: 77.5 + 31 + 15.5.
          previousAmount: 124,
        },
      ]);
      expect(result.total).toBe(850);
    });

    test("one account's breakdown reads that account alone", async () => {
      const result: CloudCostBreakdownAnswer = await answer({
        by: "service",
        period: "last-month",
        cloudAccountIds: [DATA],
      });

      expect(sharesByName(result.shares)).toEqual({
        "Amazon Simple Storage Service": 150,
      });
    });

    test("last month's spend by cost group - what `oneuptime cloud-cost breakdown --by group` asks - is the view's allocation", async () => {
      const result: CloudCostBreakdownAnswer = await answer({
        by: "group",
        cloudCostViewId: VIEW.toString(),
        period: "last-month",
      });
      const allocation: CloudCostAllocationResult =
        await CloudCostAllocation.read({
          projectId: PROJECT,
          viewId: VIEW,
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          endDate: new Date("2026-11-30T23:59:59.999Z"),
          currency: "USD",
          props: ROOT,
          now: NOW,
        });

      expect(result.viewName).toBe("By team");
      expect(
        result.shares.map((share: CloudCostBreakdownAnswerShare) => {
          return [share.name, share.amount, share.previousAmount];
        }),
      ).toEqual([
        // pay-api 300 and its unusual day's 100, and the Azure VM's 90.
        ["Payments", 490, 201.5],
        ["Data", 150, 77.5],
        ["Search", 120, 62],
      ]);
      expect(result.rest).toEqual([
        {
          kind: "not-in-group",
          name: "Unallocated",
          amount: 90,
          previousAmount: 46.5,
        },
      ]);
      expect(result.total).toBe(allocation.total);
      expect(
        Object.fromEntries(
          allocation.groups.map((entry: { name: string; total: number }) => {
            return [entry.name, entry.total];
          }),
        ),
      ).toEqual({ Payments: 490, Search: 120, Data: 150 });

      // Its CSV, as the CLI writes it with --format csv.
      const csv: Array<Record<string, string>> = readCsv(
        toCloudCostBreakdownAnswerCsv(result),
      );

      expect(
        csv.map((entry: Record<string, string>) => {
          return [
            entry["cost_group"],
            entry["amount"],
            entry["previous_amount"],
          ];
        }),
      ).toEqual([
        ["Payments", "490", "201.5"],
        ["Data", "150", "77.5"],
        ["Search", "120", "62"],
        ["Unallocated", "90", "46.5"],
      ]);
      expect(csv[0]!["period_start"]).toBe("2026-11-01");
      expect(csv[0]!["cost_basis"]).toBe("billed");
    });

    test("the period alone, when the period before is not asked", async () => {
      const result: CloudCostBreakdownAnswer = await answer({
        by: "service",
        startDate: "2026-11-18",
        endDate: "2026-11-18",
        compareWithPrevious: false,
      });

      expect(result.previousStart).toBeUndefined();
      expect(result.previousTotal).toBeUndefined();
      expect(result.total).toBe(125);
      expect(
        result.shares.find((share: CloudCostBreakdownAnswerShare) => {
          return share.key === "Amazon Elastic Compute Cloud";
        })!.amount,
      ).toBe(110);
    });

    test("one who may not read the costs is answered nothing", async () => {
      const outsider: DatabaseCommonInteractionProps = {
        tenantId: PROJECT,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: {
          [PROJECT.toString()]: {
            projectId: PROJECT,
            _type: "UserTenantAccessPermission",
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.ReadDashboard,
                labelIds: [],
                isBlockPermission: false,
              },
            ],
          },
        },
      } as DatabaseCommonInteractionProps;

      await expect(
        answer({ by: "service", period: "last-month" }, outsider),
      ).rejects.toThrow();
    });
  });

  describe("a scheduled report says what Costs shows", () => {
    test("every account, last month: the total, the movers, an unusual day and the budget, on the table's figures", async () => {
      budgets = [
        Object.assign(new CloudBudget(), {
          name: "Cloud",
          monthlyAmount: 1000,
          costBasis: CloudCostBasis.Billed,
        }),
      ];

      const content: CloudCostReportContent = await build(reportOf());
      const byService: Record<string, number> = await sumOf({
        by: "service",
        start: "2026-11-01",
        end: "2026-11-30",
      });
      const page: CloudCostBreakdownAnswer = await answer({
        by: "service",
        period: "last-month",
      });

      expect([content.start, content.lastDay]).toEqual([
        "2026-11-01",
        "2026-11-30",
      ]);
      expect([content.previousStart, content.previousLastDay]).toEqual([
        "2026-10-01",
        "2026-10-31",
      ]);
      expect(content.basis).toBe(CloudCostBasis.Billed);
      expect(content.section.total).toBe(850);
      expect(content.section.total).toBe(page.total);
      // October: 31 days at 12.50.
      expect(content.section.previousTotal).toBe(387.5);
      expect(content.section.rises[0]).toEqual({
        key: "Amazon Elastic Compute Cloud",
        name: "Amazon Elastic Compute Cloud",
        amount: byService["Amazon Elastic Compute Cloud"],
        previousAmount: 155,
      });
      expect(content.section.falls).toEqual([]);
      expect(content.section.budgets).toEqual([
        {
          name: "Cloud",
          amount: 1000,
          spent: 850,
          month: "2026-11",
          basis: CloudCostBasis.Billed,
        },
      ]);
      expect(
        content.section.unusualDays.some(
          (day: { day: string; amount: number }) => {
            return day.day === UNUSUAL_DAY && day.amount >= 110;
          },
        ),
      ).toBe(true);
      expect(content.costsUrl).toBe(
        `https://oneuptime.example/dashboard/${PROJECT.toString()}/cloud/costs?start=2026-11-01&end=2026-11-30&basis=billed`,
      );

      // The CSV attached: every service, the page's figures.
      const csv: Array<Record<string, string>> = readCsv(content.csv);
      const fromCsv: Record<string, number> = {};

      for (const entry of csv) {
        fromCsv[entry["key"]!] = Number(entry["amount"]);
      }

      expect(fromCsv).toEqual(byService);
      expect(content.csvFileName).toBe(
        "cloud-costs-by-service-billed-2026-11-01-to-2026-11-30.csv",
      );
    });

    test("on the report's own basis, whatever the project's", async () => {
      projectBasis = CloudCostBasis.Net;

      expect(
        (await build(reportOf({ costBasis: CloudCostBasis.Amortized }))).section
          .total,
      ).toBe(760);
      // Without one, the project's.
      expect((await build(reportOf())).section.total).toBe(700);
    });

    test("a cost view's report: its groups and what no group takes, as the view's page reads them", async () => {
      const content: CloudCostReportContent = await build(
        reportOf({
          scope: CloudCostReportScope.CostView,
          cloudCostViewId: VIEW,
        }),
      );

      expect(content.section.name).toBe("By team");
      expect(content.section.total).toBe(850);
      expect(sharesByName(content.section.groups || [])).toEqual({
        Payments: 490,
        Data: 150,
        Search: 120,
      });
      expect(content.section.unallocated).toEqual({
        amount: 90,
        previousAmount: 46.5,
      });
      expect(content.costsUrl).toContain(`by=group&view=${VIEW.toString()}`);

      const csv: Array<Record<string, string>> = readCsv(content.csv);
      expect(
        csv.map((entry: Record<string, string>) => {
          return [entry["group"], entry["total"]];
        }),
      ).toEqual([
        ["Payments", "490"],
        ["Search", "120"],
        ["Data", "150"],
        ["Unallocated", "90"],
      ]);
    });

    test("a group's own section: its spend alone, against the month before", async () => {
      const content: CloudCostReportContent = await build(
        reportOf({
          scope: CloudCostReportScope.CostView,
          cloudCostViewId: VIEW,
        }),
        { groupId: new ObjectID(PAYMENTS) },
      );

      expect(content.section.kind).toBe("group");
      expect(content.section.name).toBe("Payments");
      expect(content.section.total).toBe(490);
      expect(content.section.previousTotal).toBe(201.5);
    });

    test("one account's report reads that account alone", async () => {
      const content: CloudCostReportContent = await build(
        reportOf({
          scope: CloudCostReportScope.Account,
          cloudAccountId: new ObjectID(PROD),
        }),
      );
      const prod: Record<string, number> = await sumOf({
        start: "2026-11-01",
        end: "2026-11-30",
        accounts: [PROD],
      });

      expect(content.section.name).toBe("Production AWS");
      expect(content.section.total).toBe(prod["total"]);
      expect(content.section.total).toBe(550);
      expect(content.costsUrl).toContain(`/cloud/accounts/${PROD}/costs?`);
    });

    test("last week, sent on a Monday in Berlin: Monday to Sunday", async () => {
      const content: CloudCostReportContent =
        await CloudCostReportBuilder.build({
          report: reportOf({ period: CloudCostReportPeriod.LastWeek }),
          projectId: PROJECT,
          projectName: "Acme",
          props: ROOT,
          at: new Date("2026-11-23T08:00:00.000Z"),
          dashboardUrl: URL.fromString("https://oneuptime.example/dashboard"),
        });
      const week: Record<string, number> = await sumOf({
        start: "2026-11-16",
        end: "2026-11-22",
      });

      expect([content.start, content.lastDay]).toEqual([
        "2026-11-16",
        "2026-11-22",
      ]);
      expect(content.section.total).toBe(week["total"]);
      expect(content.section.previousTotal).toBe(175);
    });
  });

  describe("the FOCUS 1.2 export", () => {
    async function exportOf(data: {
      start: string;
      end: string;
      props?: DatabaseCommonInteractionProps;
    }): Promise<{ text: string; rows: number }> {
      let text: string = "";
      const written: { rows: number } = await CloudCostFocusExport.write({
        projectId: PROJECT,
        props: data.props || ROOT,
        window: {
          start: new Date(`${data.start}T00:00:00.000Z`),
          lastDay: new Date(`${data.end}T00:00:00.000Z`),
        },
        write: (chunk: string): void => {
          text += chunk;
        },
      });

      return { text, rows: written.rows };
    }

    test("every cost of the period, as FOCUS rows: usage, the credits apart, every currency as itself", async () => {
      const { text, rows } = await exportOf({
        start: "2026-11-01",
        end: "2026-11-30",
      });
      const focus: Array<Record<string, string>> = readCsv(text);

      // The header is FOCUS's columns.
      expect(text.slice(0, text.indexOf("\n"))).toBe(
        CLOUD_COST_FOCUS_COLUMNS.join(","),
      );

      /*
       * 6 costs a day, the unusual day's and the euros', and a credit row
       * for each day of pay-api and data-lake.
       */
      const costs: number = 6 * 30 + 2;
      expect(rows).toBe(costs + 2 * 30);
      expect(focus).toHaveLength(rows);

      const usd: Array<Record<string, string>> = focus.filter(
        (entry: Record<string, string>) => {
          return entry["BillingCurrency"] === "USD";
        },
      );
      const sum: (
        list: Array<Record<string, string>>,
        column: string,
      ) => number = (
        list: Array<Record<string, string>>,
        column: string,
      ): number => {
        return (
          Math.round(
            list.reduce((total: number, entry: Record<string, string>) => {
              return total + Number(entry[column]);
            }, 0) * 10000,
          ) / 10000
        );
      };
      const charges: Array<Record<string, string>> = usd.filter(
        (entry: Record<string, string>) => {
          return entry["ChargeCategory"] !== "Credit";
        },
      );

      // What was billed, what it cost amortized, and with the credits net.
      expect(sum(charges, "BilledCost")).toBe(850);
      expect(sum(charges, "EffectiveCost")).toBe(760);
      expect(sum(usd, "EffectiveCost")).toBe(700);
      expect(
        usd.filter((entry: Record<string, string>) => {
          return entry["ChargeCategory"] === "Credit";
        }),
      ).toHaveLength(60);

      // The euros are their own row, never another project's.
      expect(
        focus
          .filter((entry: Record<string, string>) => {
            return entry["BillingCurrency"] === "EUR";
          })
          .map((entry: Record<string, string>) => {
            return entry["BilledCost"];
          }),
      ).toEqual(["999"]);
      expect(
        focus.some((entry: Record<string, string>) => {
          return entry["BilledCost"] === "5000";
        }),
      ).toBe(false);

      // Who bills what: AWS's organization, Google Cloud's billing account.
      const ec2: Record<string, string> = usd.find(
        (entry: Record<string, string>) => {
          return entry["ServiceName"] === "Amazon Elastic Compute Cloud";
        },
      )!;
      expect(ec2).toMatchObject({
        ProviderName: "AWS",
        BillingAccountId: "999999999999",
        BillingAccountName: "Acme organization",
        SubAccountId: "111111111111",
        SubAccountName: "Production AWS",
        ServiceCategory: "Compute",
        RegionName: "US East (N. Virginia)",
        ChargePeriodStart: "2026-11-01T00:00:00Z",
        ChargePeriodEnd: "2026-11-02T00:00:00Z",
        BillingPeriodStart: "2026-11-01T00:00:00Z",
        BillingPeriodEnd: "2026-12-01T00:00:00Z",
      });
      expect(JSON.parse(ec2["Tags"]!)).toEqual({ team: "payments" });

      const run: Record<string, string> = usd.find(
        (entry: Record<string, string>) => {
          return entry["ServiceName"] === "Cloud Run";
        },
      )!;
      expect(run).toMatchObject({
        ProviderName: "Google Cloud",
        BillingAccountId: "01A2B3-C4D5E6-F7A8B9",
        SubAccountId: "shop-prod",
        RegionName: "Iowa",
        ResourceName: "checkout",
      });

      const vm: Record<string, string> = usd.find(
        (entry: Record<string, string>) => {
          return entry["ServiceName"] === "Virtual Machines";
        },
      )!;
      expect(vm).toMatchObject({
        ProviderName: "Microsoft",
        // Azure's billing account is not read: the subscription stands for it.
        BillingAccountId: "00000000-1111-2222-3333-444444444444",
        ResourceName: "vm-1",
        RegionName: "West Europe",
      });

      const tax: Array<Record<string, string>> = usd.filter(
        (entry: Record<string, string>) => {
          return entry["ServiceName"] === "Tax";
        },
      );
      expect(tax).toHaveLength(30);
      expect(
        tax.every((entry: Record<string, string>) => {
          return entry["ChargeCategory"] === "Tax";
        }),
      ).toBe(true);

      // A connection's settings beyond the IDs they name are never written.
      expect(text).not.toContain("never written to the file");
      expect(text).not.toContain("OneUptimeReader");
    });

    test("one day's export has that day's rows only", async () => {
      const { text } = await exportOf({
        start: UNUSUAL_DAY,
        end: UNUSUAL_DAY,
      });
      const focus: Array<Record<string, string>> = readCsv(text);

      expect(
        new Set(
          focus.map((entry: Record<string, string>) => {
            return entry["ChargePeriodStart"];
          }),
        ),
      ).toEqual(new Set([`${UNUSUAL_DAY}T00:00:00Z`]));
    });

    test("at most a quarter at a time", async () => {
      await expect(
        exportOf({ start: "2026-01-01", end: "2026-11-30" }),
      ).rejects.toThrow(BadDataException);
    });
  });
});

describe("the cost reports' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

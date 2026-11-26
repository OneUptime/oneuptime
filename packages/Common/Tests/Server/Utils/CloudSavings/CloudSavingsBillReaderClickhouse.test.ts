import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CloudCost from "../../../../Models/AnalyticsModels/CloudCost";
import CloudSavingsAction from "../../../../Models/DatabaseModels/CloudSavingsAction";
import { ClickHouseClientConfigOptions } from "../../../../Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "../../../../Server/Infrastructure/ClickhouseDatabase";
import CloudCostService from "../../../../Server/Services/CloudCostService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import CloudSavingsActionService from "../../../../Server/Services/CloudSavingsActionService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import UpdateByID from "../../../../Server/Types/Database/UpdateByID";
import CloudSavingsBillReader from "../../../../Server/Utils/CloudSavings/CloudSavingsBillReader";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionStatus,
  CloudSavingsMeasurement,
  CloudSavingsTargetType,
} from "../../../../Types/Cloud/CloudSavingsAction";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import timers from "timers";

/*
 * PROVED BY THE BILL, AGAINST CLICKHOUSE (#11010): the bill reader's one
 * statement, as ClickHouse runs it over the cloud cost table the cost lane
 * writes - what a resource was billed the week before its change and on
 * the settled days after, under every id its cloud's bill may name it by,
 * and whether the account's costs were read through to the end.
 *
 * Opt in with TEST_CLICKHOUSE_URL, a local, disposable server, e.g.
 *
 *   TEST_CLICKHOUSE_URL=http://default:password@127.0.0.1:8123 \
 *   npx jest Tests/Server/Utils/CloudSavings/CloudSavingsBillReaderClickhouse.test.ts
 *
 * It creates a database of its own, and drops it afterwards. Common's
 * jest environment is jsdom, whose timers the ClickHouse client cannot
 * unref: the suite runs on Node's own.
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

jest.setTimeout(120000);

const database: string = `cloud_savings_bill_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = ObjectID.generate();
const ACCOUNT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: ObjectID = ObjectID.generate();
const VOLUME: string = "vol-0123456789abcdef0";
const VOLUME_ARN: string = `arn:aws:ec2:eu-west-1:123456789012:volume/${VOLUME}`;
const SUBSCRIPTION: string = "6f0b7c1a-1d2e-4f3a-9b8c-7d6e5f4a3b2c";
const DISK_ARM_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/RG-Dev/providers/Microsoft.Compute/disks/Orders-Data`;

// The change: a volume deleted on 10 November 2026, mid-afternoon UTC.
const APPLIED_AT: Date = new Date("2026-11-10T15:00:00Z");

function utcDay(iso: string, days: number = 0): Date {
  return OneUptimeDate.addRemoveDays(new Date(`${iso}T00:00:00Z`), days);
}

interface CostRow {
  projectId?: ObjectID;
  resourceId: string;
  day: Date;
  cost: number;
  provider?: CloudProvider;
}

function row(data: CostRow): JSONObject {
  return {
    projectId: (data.projectId || PROJECT_ID).toString(),
    cloudAccountId: ACCOUNT_ID.toString(),
    cloudConnectionId: CONNECTION_ID.toString(),
    provider: data.provider || CloudProvider.AWS,
    accountId: "123456789012",
    day: OneUptimeDate.toClickhouseDateTime(data.day),
    service: "Amazon Elastic Compute Cloud",
    region: "eu-west-1",
    resourceId: data.resourceId,
    cost: data.cost,
    currency: "USD",
    readAt: OneUptimeDate.toClickhouseDateTime(data.day),
    tags: {},
  };
}

// A day's rows from the 3rd to `lastDay`: the volume's, and another resource's.
function bill(data: {
  volumeKey: string;
  provider?: CloudProvider;
  volumeAfter: number;
  lastDay: string;
}): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (
    let day: Date = utcDay("2026-11-03");
    day.getTime() <= utcDay(data.lastDay).getTime();
    day = OneUptimeDate.addRemoveDays(day, 1)
  ) {
    const isBefore: boolean = day.getTime() < utcDay("2026-11-10").getTime();
    const isChangeDay: boolean =
      day.getTime() === utcDay("2026-11-10").getTime();

    rows.push(
      row({
        resourceId: data.volumeKey,
        day,
        // 10 a day before; the change's own day is in neither window.
        cost: isBefore ? 10 : isChangeDay ? 6 : data.volumeAfter,
        ...(data.provider ? { provider: data.provider } : {}),
      }),
    );
    // The account's other costs, every day: its costs were read.
    rows.push(row({ resourceId: "i-0other00000000000", day, cost: 5 }));
    // Another project's volume of the same id is never counted.
    rows.push(
      row({
        projectId: OTHER_PROJECT_ID,
        resourceId: data.volumeKey,
        day,
        cost: 1000,
      }),
    );
  }

  return rows;
}

function action(
  overrides: Partial<Record<keyof CloudSavingsAction, unknown>> = {},
): CloudSavingsAction {
  const change: CloudSavingsAction = new CloudSavingsAction();

  change.id = ObjectID.generate();
  change.projectId = PROJECT_ID;
  change.cloudAccountId = ACCOUNT_ID;
  change.provider = CloudProvider.AWS;
  change.resourceId = VOLUME_ARN;
  change.target = {
    provider: CloudProvider.AWS,
    type: CloudSavingsTargetType.Volume,
    id: VOLUME,
    location: "eu-west-1",
    account: "123456789012",
  };
  change.monthlySavings = 300;
  change.status = CloudSavingsActionStatus.Applied;
  change.appliedAt = APPLIED_AT;

  return Object.assign(change, overrides);
}

integration("the bill reader, against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original:
    | { database: ClickhouseDatabase; databaseClient: ClickhouseClient | null }
    | undefined;
  const written: Array<JSONObject> = [];
  const jsdomTimers: {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  } = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  async function load(rows: Array<JSONObject>): Promise<void> {
    await client.command({
      query: `TRUNCATE TABLE ${database}.${new CloudCost().tableName}`,
    });
    await client.insert({
      table: `${database}.${new CloudCost().tableName}`,
      values: rows,
      format: "JSONEachRow",
    });
  }

  async function measure(
    change: CloudSavingsAction,
    now: string,
  ): Promise<{ done: boolean; update: JSONObject }> {
    written.length = 0;
    const done: boolean = await CloudSavingsBillReader.measure({
      action: change,
      now: new Date(now),
    });

    return { done, update: written[0] || {} };
  }

  beforeAll(async (): Promise<void> => {
    globalThis.setTimeout = timers.setTimeout as typeof globalThis.setTimeout;
    globalThis.clearTimeout =
      timers.clearTimeout as typeof globalThis.clearTimeout;

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
      database,
      request_timeout: 60000,
    };

    // Connecting creates the database.
    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    const model: AnalyticsBaseModel = new CloudCost();
    const generator: StatementGenerator<AnalyticsBaseModel> =
      new StatementGenerator<AnalyticsBaseModel>({
        modelType: CloudCost as unknown as { new (): AnalyticsBaseModel },
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    original = {
      database: CloudCostService.database,
      databaseClient: CloudCostService.databaseClient,
    };
    CloudCostService.database = clickhouse;
    CloudCostService.databaseClient = client;

    // What the reader writes back to the change.
    jest
      .spyOn(CloudSavingsActionService, "updateOneById")
      .mockImplementation(
        async (data: UpdateByID<CloudSavingsAction>): Promise<number> => {
          written.push(data.data as unknown as JSONObject);
          return 1;
        },
      );
    jest.spyOn(CloudResourceService, "findOneById").mockResolvedValue(null);
  });

  afterEach(() => {
    written.length = 0;
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    if (original) {
      CloudCostService.database = original.database;
      CloudCostService.databaseClient = original.databaseClient;
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
    }

    globalThis.setTimeout = jsdomTimers.setTimeout;
    globalThis.clearTimeout = jsdomTimers.clearTimeout;
  });

  test("a deleted volume's bill fell to nothing: realised, the fall made a month", async () => {
    await load(
      bill({ volumeKey: VOLUME_ARN, volumeAfter: 0, lastDay: "2026-11-15" }),
    );

    // On the 16th the 11th to the 14th have settled.
    const { done, update } = await measure(action(), "2026-11-16T09:00:00Z");

    expect(done).toBe(true);
    expect(update).toMatchObject({
      measurement: CloudSavingsMeasurement.Realised,
      costBeforeDaily: 10,
      costAfterDaily: 0,
      realisedMonthlySavings: 304.38,
    });
  });

  test("a resource billed by its bare id is found by the id its change was made to", async () => {
    await load(
      bill({ volumeKey: VOLUME, volumeAfter: 0, lastDay: "2026-11-15" }),
    );

    expect(
      (await measure(action(), "2026-11-16T09:00:00Z")).update,
    ).toMatchObject({ measurement: CloudSavingsMeasurement.Realised });
  });

  test("an Azure disk is found whatever case its bill writes its ARM id in", async () => {
    await load(
      bill({
        volumeKey: DISK_ARM_ID.toLowerCase(),
        provider: CloudProvider.Azure,
        volumeAfter: 0,
        lastDay: "2026-11-15",
      }),
    );

    const { update } = await measure(
      action({
        provider: CloudProvider.Azure,
        resourceId: DISK_ARM_ID,
        target: {
          provider: CloudProvider.Azure,
          type: CloudSavingsTargetType.Volume,
          resourceGroup: "RG-Dev",
          id: "Orders-Data",
          armId: DISK_ARM_ID,
          location: "westeurope",
          account: SUBSCRIPTION,
        },
      }),
      "2026-11-16T09:00:00Z",
    );

    expect(update).toMatchObject({
      measurement: CloudSavingsMeasurement.Realised,
      costBeforeDaily: 10,
    });
  });

  test("a bill that hardly fell is not seen", async () => {
    await load(
      bill({ volumeKey: VOLUME_ARN, volumeAfter: 9.5, lastDay: "2026-11-15" }),
    );

    expect(
      (await measure(action(), "2026-11-16T09:00:00Z")).update,
    ).toMatchObject({
      measurement: CloudSavingsMeasurement.NotSeen,
      costAfterDaily: 9.5,
      realisedMonthlySavings: 15.22,
    });
  });

  test("while the account's costs are not read through the settled days, it keeps measuring", async () => {
    // The account's last costs read are the 12th's: the 13th and 14th are not in yet.
    await load(
      bill({ volumeKey: VOLUME_ARN, volumeAfter: 0, lastDay: "2026-11-12" }),
    );

    const { done, update } = await measure(action(), "2026-11-16T09:00:00Z");

    expect(done).toBe(false);
    expect(update).toMatchObject({
      measurement: CloudSavingsMeasurement.Measuring,
      costBeforeDaily: 10,
    });
  });

  test("a resource its cloud never billed by name cannot be measured", async () => {
    await load(
      bill({
        volumeKey: "vol-0ffffffffffffffff",
        volumeAfter: 0,
        lastDay: "2026-11-15",
      }),
    );

    expect(
      (await measure(action(), "2026-11-16T09:00:00Z")).update,
    ).toMatchObject({ measurement: CloudSavingsMeasurement.CannotMeasure });
  });

  test("a change undone the day after it is too short to prove, and says so", async () => {
    await load(
      bill({ volumeKey: VOLUME_ARN, volumeAfter: 0, lastDay: "2026-11-15" }),
    );

    expect(
      (
        await measure(
          action({
            status: CloudSavingsActionStatus.Undone,
            undoneAt: new Date("2026-11-12T09:00:00Z"),
          }),
          "2026-11-16T09:00:00Z",
        )
      ).update,
    ).toMatchObject({ measurement: CloudSavingsMeasurement.CannotMeasure });
  });
});

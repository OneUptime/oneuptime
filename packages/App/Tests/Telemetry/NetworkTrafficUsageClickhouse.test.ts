import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import NetworkTrafficUsage from "Common/Models/AnalyticsModels/NetworkTrafficUsage";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import NetworkControllerConnectionService from "Common/Server/Services/NetworkControllerConnectionService";
import NetworkTrafficUsageAggregationService, {
  NetworkTrafficUsageAggregates,
  NetworkTrafficUsageFreshness,
  NetworkTrafficUsageQuery,
} from "Common/Server/Services/NetworkTrafficUsageAggregationService";
import NetworkTrafficUsageService from "Common/Server/Services/NetworkTrafficUsageService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import NetworkControllerReadRunner, {
  NetworkControllerReadOutcome,
} from "Common/Server/Utils/NetworkController/NetworkControllerReadRunner";
import { NetworkTrafficUsageStoredEnds } from "Common/Server/Utils/NetworkController/NetworkControllerTypes";
import { TelemetryServiceFilter } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import { JSONObject } from "Common/Types/JSON";
import {
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageKind,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import NetworkControllerProvider from "Common/Types/NetworkController/NetworkControllerProvider";
import ObjectID from "Common/Types/ObjectID";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  TestClock,
  buildBranchOrganization,
  createFakeMerakiApi,
  createTestClock,
} from "Common/Tests/Server/Utils/NetworkController/FakeMerakiApi";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The Meraki side of the Traffic pages (issue #5140) against a real
 * ClickHouse server.
 *
 * The unit tests check the SQL as text. What they cannot show is that
 * ClickHouse runs it - each window's share of the range, the chart's ARRAY
 * JOIN that splits a window over its buckets, the stored windows and their
 * ends the read runner checks before it writes, the bound parameters, the
 * 'throw' settings - and that it adds up. So this suite builds the
 * NetworkTrafficUsage table from the model and runs the REAL read runner
 * against a fake Meraki dashboard API of three branches on a test clock
 * (Postgres played by spies), then checks every number a page shows
 * against traffic whose rates are known:
 *
 *   three MX appliances, each wan1 at 10,000 B/s up and 50,000 B/s down and
 *   wan2 at 100 and 200; one application (Microsoft Teams, 1,000 up and
 *   3,000 down) and one client (100 up, 400 down) on each network. The MX
 *   of the first branch is a device in OneUptime; the other two are the
 *   project's bucket. Another project's rows are written too - and no read
 *   of this project may ever count them.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/NetworkTrafficUsageClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `network_traffic_usage_test_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const CONNECTION: ObjectID = ObjectID.generate();
const OTHER_CONNECTION: ObjectID = ObjectID.generate();
const MX_DEVICE: ObjectID = ObjectID.generate();

const START: Date = new Date("2026-10-24T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const RANGE_START: Date = new Date("2026-10-24T10:00:00.000Z");
const RANGE_END: Date = new Date("2026-10-24T11:00:00.000Z");

// Each MX's uplinks, a second, and the hour of the range.
const UPLINK_SENT_PER_SECOND: number = 10000 + 100;
const UPLINK_RECEIVED_PER_SECOND: number = 50000 + 200;
const RANGE_SECONDS: number = 3600;

const EVERY_DEVICE: TelemetryServiceFilter = {};

function query(
  overrides: Partial<NetworkTrafficUsageQuery> = {},
  filters: NetworkTrafficUsageFilters = {},
): NetworkTrafficUsageQuery {
  return {
    projectId: PROJECT,
    startTime: RANGE_START,
    endTime: RANGE_END,
    devices: EVERY_DEVICE,
    filters,
    ...overrides,
  };
}

async function aggregates(
  overrides: Partial<NetworkTrafficUsageQuery> = {},
  filters: NetworkTrafficUsageFilters = {},
  primaryKind: NetworkTrafficUsageKind = NetworkTrafficUsageKind.Uplink,
): Promise<NetworkTrafficUsageAggregates> {
  return await NetworkTrafficUsageAggregationService.getAggregates({
    query: query(overrides, filters),
    bucketSeconds: 300,
    primaryKind,
  });
}

function connectionOf(
  projectId: ObjectID,
  id: ObjectID,
): NetworkControllerConnection {
  const connection: NetworkControllerConnection =
    new NetworkControllerConnection();
  connection.id = id;
  connection.projectId = projectId;
  connection.name = "Acme Retail";
  connection.provider = NetworkControllerProvider.Meraki;
  connection.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "",
    readIntervalInMinutes: 5,
  };
  connection.secrets = JSON.stringify({ apiKey: FAKE_API_KEY });
  connection.isEnabled = true;
  connection.pullState = {};
  return connection;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new NetworkTrafficUsage();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: NetworkTrafficUsage as unknown as {
        new (): AnalyticsBaseModel;
      },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

integration("Meraki traffic reads against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Partial<typeof NetworkTrafficUsageService> | undefined;
  let waitForAsyncInsertBefore: string | undefined = undefined;
  let clock: TestClock;
  let api: FakeMerakiApi;
  let connections: Map<string, NetworkControllerConnection>;
  let failBookkeeping: boolean = false;
  let firstOutcome: NetworkControllerReadOutcome;

  async function read(
    connectionId: ObjectID,
  ): Promise<NetworkControllerReadOutcome> {
    return await NetworkControllerReadRunner.run(connectionId, {
      transport: api.transport,
      now: clock.now,
      sleep: clock.sleep,
      isTelemetryAllowed: async () => {
        return true;
      },
      findDevices: async () => {
        return [
          { id: MX_DEVICE, serialNumber: "Q2XX-AAAA-0000", macAddress: "" },
        ];
      },
    });
  }

  async function count(where: string = ""): Promise<number> {
    const result: { json: () => Promise<unknown> } =
      (await NetworkTrafficUsageService.executeQuery(
        `SELECT count() AS rows FROM ${database}.NetworkTrafficUsageV1 ${where}`,
      )) as unknown as { json: () => Promise<unknown> };
    const body: { data?: Array<{ rows?: unknown }> } =
      (await result.json()) as { data?: Array<{ rows?: unknown }> };
    return Number(body.data?.[0]?.rows || 0);
  }

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
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse);

    original = {
      database: NetworkTrafficUsageService.database,
      databaseClient: NetworkTrafficUsageService.databaseClient,
      ingestDatabase: NetworkTrafficUsageService.ingestDatabase,
      ingestDatabaseClient: NetworkTrafficUsageService.ingestDatabaseClient,
    };

    NetworkTrafficUsageService.database = clickhouse;
    NetworkTrafficUsageService.databaseClient = client;
    NetworkTrafficUsageService.ingestDatabase = clickhouse;
    NetworkTrafficUsageService.ingestDatabaseClient = client;

    waitForAsyncInsertBefore = process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = "true";

    // Postgres, played by the connections themselves.
    connections = new Map([
      [CONNECTION.toString(), connectionOf(PROJECT, CONNECTION)],
      [
        OTHER_CONNECTION.toString(),
        connectionOf(OTHER_PROJECT, OTHER_CONNECTION),
      ],
    ]);
    jest
      .spyOn(NetworkControllerConnectionService, "findOneById")
      .mockImplementation((async (data: { id: ObjectID }) => {
        return connections.get(data.id.toString()) || null;
      }) as never);
    jest
      .spyOn(NetworkControllerConnectionService, "updateOneById")
      .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
        if (failBookkeeping) {
          throw new Error("Postgres is not answering");
        }

        const stored: NetworkControllerConnection | undefined = connections.get(
          data.id.toString(),
        );

        if (stored && data.data["pullState"] !== undefined) {
          stored.pullState = JSON.parse(JSON.stringify(data.data["pullState"]));
        }
      }) as never);

    clock = createTestClock(START);
    api = createFakeMerakiApi({
      organizations: [
        buildBranchOrganization({
          id: "549236",
          name: "Acme Retail",
          count: 3,
        }),
      ],
      now: clock.now,
    });

    firstOutcome = await read(CONNECTION);

    // Another project's organization, read the same way: never ours to count.
    clock.advance(-clock.now().getTime() + START.getTime());
    await read(OTHER_CONNECTION);
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    if (original) {
      Object.assign(NetworkTrafficUsageService, original);
    }

    if (waitForAsyncInsertBefore === undefined) {
      delete process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    } else {
      process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = waitForAsyncInsertBefore;
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the read stored the organization's last day", async () => {
    expect(firstOutcome.status).toBe("success");
    // 34 uplink windows of three MXs on two uplinks, and each network's applications and clients.
    expect(firstOutcome.summary?.rowsWritten).toBe(34 * 3 * 2 + 3 + 3);
    expect(await count(`WHERE projectId = '${PROJECT.toString()}'`)).toBe(
      34 * 3 * 2 + 3 + 3,
    );
  });

  test("an hour's uplinks: every window's share of the range, and no other project's", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates();

    expect(result.totals.sentOctets).toBe(
      3 * UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
    expect(result.totals.receivedOctets).toBe(
      3 * UPLINK_RECEIVED_PER_SECOND * RANGE_SECONDS,
    );
  });

  test("a range across an hour window and five-minute ones counts each for the part inside", async () => {
    // 10:30-11:30: half of the 10:00 hour window, and six five-minute windows.
    const result: NetworkTrafficUsageAggregates = await aggregates({
      startTime: new Date("2026-10-24T10:30:00.000Z"),
      endTime: new Date("2026-10-24T11:30:00.000Z"),
    });

    expect(result.totals.sentOctets).toBe(
      3 * UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
  });

  test("the chart splits the hour window over its twelve five-minute buckets", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates();

    expect(result.series).toHaveLength(12);
    expect(result.series[0]!.time).toBe("2026-10-24T10:00:00.000Z");

    for (const point of result.series) {
      expect(point.sentOctets).toBe(3 * UPLINK_SENT_PER_SECOND * 300);
      expect(point.receivedOctets).toBe(3 * UPLINK_RECEIVED_PER_SECOND * 300);
    }
  });

  test("the busiest networks and uplinks; the MX that is a device names it", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates();

    expect(result.topNetworks).toHaveLength(3);
    expect(result.topNetworks[0]!.sentOctets).toBe(
      UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
    expect(result.topUplinks).toHaveLength(6);

    const wan1: Array<NetworkTrafficUsageAggregates["topUplinks"][number]> =
      result.topUplinks.filter((row: { interfaceName: string }) => {
        return row.interfaceName === "wan1";
      });
    expect(wan1).toHaveLength(3);
    expect(wan1[0]!.sentOctets).toBe(10000 * RANGE_SECONDS);

    const mx1: NetworkTrafficUsageAggregates["topUplinks"][number] = wan1.find(
      (row: { deviceSerial: string }) => {
        return row.deviceSerial === "Q2XX-AAAA-0000";
      },
    )!;
    expect(mx1.networkDeviceId).toBe(MX_DEVICE.toString());
    expect(mx1.deviceName).toBe("MX 1");
    expect(mx1.controllerNetworkName).toBe("Branch 1");

    // The others are the project's bucket: no device to link to.
    expect(
      wan1.filter((row: { networkDeviceId?: string | undefined }) => {
        return row.networkDeviceId === undefined;
      }),
    ).toHaveLength(2);
  });

  test("the applications, destinations and clients: a day's window, its hour's share", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates();

    // Meraki's window ran a day and a few seconds: an hour of it is ~1/24.
    expect(
      Math.abs(result.applicationTotals.sentOctets - 3 * 1000 * RANGE_SECONDS),
    ).toBeLessThan(3 * 1000 * RANGE_SECONDS * 0.001);
    expect(result.topApplications).toHaveLength(1);
    expect(result.topApplications[0]!.application).toBe("Microsoft Teams");
    expect(result.topApplications[0]!.flows).toBe(3 * 60);
    expect(result.topDestinations[0]).toMatchObject({
      destination: "teams.microsoft.com",
      application: "Microsoft Teams",
    });
    expect(result.topClients).toHaveLength(3);
    expect(result.topClients[0]!.manufacturer).toBe("Dell");
    expect(
      Math.abs(getUsageOctets(result.clientTotals) - 3 * 500 * RANGE_SECONDS),
    ).toBeLessThan(3 * 500 * RANGE_SECONDS * 0.001);
    expect(result.totals.flows).toBe(3 * 60);
  });

  test("an organization without uplinks totals its applications instead", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates(
      {},
      {},
      NetworkTrafficUsageKind.Application,
    );

    expect(result.primaryKind).toBe(NetworkTrafficUsageKind.Application);
    expect(result.totals.sentOctets).toBe(result.applicationTotals.sentOctets);
  });

  test("a reader of one device reads that device's traffic only", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates({
      devices: { serviceIds: [MX_DEVICE] },
    });

    expect(result.totals.sentOctets).toBe(
      UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
    expect(
      result.topNetworks.map((row: { name: string }) => {
        return row.name;
      }),
    ).toEqual(["Branch 1"]);
    expect(result.topClients).toHaveLength(1);
  });

  test("the project's bucket holds the appliances that are no device", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates({
      devices: { serviceIds: [PROJECT] },
    });

    expect(result.totals.sentOctets).toBe(
      2 * UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
  });

  test("a blocked device is left out, whatever else is read", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates({
      devices: { excludedServiceIds: [MX_DEVICE] },
    });

    expect(result.totals.sentOctets).toBe(
      2 * UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
  });

  test("a network filter holds every kind to it; an appliance's, its uplinks", async () => {
    const network: NetworkTrafficUsageAggregates = await aggregates(
      {},
      { controllerNetworkId: "L_1001" },
    );

    expect(network.totals.sentOctets).toBe(
      UPLINK_SENT_PER_SECOND * RANGE_SECONDS,
    );
    expect(network.topClients).toHaveLength(1);

    const appliance: NetworkTrafficUsageAggregates = await aggregates(
      {},
      { controllerNetworkId: "L_1001", deviceSerial: "Q2XX-AAAA-0001" },
    );

    expect(appliance.topUplinks).toHaveLength(2);
    expect(
      appliance.topUplinks.every((row: { deviceSerial: string }) => {
        return row.deviceSerial === "Q2XX-AAAA-0001";
      }),
    ).toBe(true);
  });

  test("a filter that is SQL is a value, and matches nothing", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates(
      {},
      { controllerNetworkId: "L_1000' OR '1'='1" },
    );

    expect(result.totals.sentOctets).toBe(0);
    expect(result.topNetworks).toEqual([]);
  });

  test("how fresh the page is", async () => {
    const freshness: NetworkTrafficUsageFreshness =
      await NetworkTrafficUsageAggregationService.getFreshness({
        projectId: PROJECT,
        devices: EVERY_DEVICE,
        now: START,
      });

    expect(freshness.lastUplinkAt).toBe("2026-10-24T11:55:00.000Z");
    expect(Date.parse(freshness.lastAnalyticsAt!)).toBeGreaterThanOrEqual(
      START.getTime(),
    );
  });

  test("the runner's own reads: which windows are stored, and where they end", async () => {
    const keys: Set<string> =
      await NetworkTrafficUsageAggregationService.findStoredWindowKeys({
        projectId: PROJECT,
        connectionId: CONNECTION,
        windows: [
          {
            kind: NetworkTrafficUsageKind.Uplink,
            controllerNetworkId: "",
            windowStartAt: new Date(START.getTime() - 24 * HOUR),
          },
          {
            kind: NetworkTrafficUsageKind.Uplink,
            controllerNetworkId: "",
            windowStartAt: new Date("2026-10-24T11:50:00.000Z"),
          },
        ],
      });

    expect(keys.size).toBe(34 + 3 + 3);
    expect(
      keys.has(`uplink||${new Date("2026-10-24T11:50:00.000Z").getTime()}`),
    ).toBe(true);

    const ends: NetworkTrafficUsageStoredEnds =
      await NetworkTrafficUsageAggregationService.findStoredWindowEnds({
        projectId: PROJECT,
        connectionId: CONNECTION,
        since: new Date(START.getTime() - 25 * HOUR),
      });

    expect(ends.uplinkEnd?.toISOString()).toBe("2026-10-24T11:55:00.000Z");
    expect(Array.from(ends.analyticsEnds.keys()).sort()).toEqual([
      "L_1000",
      "L_1001",
      "L_1002",
    ]);
  });

  test("a read whose cursor was not recorded reads on from the stored rows, and nothing is counted twice", async () => {
    const before: NetworkTrafficUsageAggregates = await aggregates();
    const rowsBefore: number = await count(
      `WHERE projectId = '${PROJECT.toString()}'`,
    );

    // The bookkeeping fails after the rows are stored: the cursors stay behind.
    connections.get(CONNECTION.toString())!.pullState = {};
    failBookkeeping = true;
    clock.advance(-clock.now().getTime() + START.getTime() + 5 * 60 * 1000);
    await read(CONNECTION);
    failBookkeeping = false;

    const rowsAfterFailure: number = await count(
      `WHERE projectId = '${PROJECT.toString()}'`,
    );
    // One new five-minute window of six uplinks: nothing of the day again.
    expect(rowsAfterFailure - rowsBefore).toBe(6);

    clock.advance(5 * 60 * 1000);
    await read(CONNECTION);

    const after: NetworkTrafficUsageAggregates = await aggregates();
    expect(after.totals).toEqual(before.totals);
    expect(after.applicationTotals).toEqual(before.applicationTotals);
    expect(after.clientTotals).toEqual(before.clientTotals);
  });

  test("a read that runs out of time is an error, never an empty answer", async () => {
    let caught: unknown = null;

    try {
      await NetworkTrafficUsageService.executeQuery(
        "SELECT count() FROM numbers(100000000000) SETTINGS max_execution_time = 1, timeout_overflow_mode = 'throw'",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(NetworkTrafficUsageAggregationService.isTimeout(caught)).toBe(true);
  });
});

describe("Meraki traffic ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

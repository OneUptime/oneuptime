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
  NetworkTrafficUsageApplianceRow,
  NetworkTrafficUsageFreshness,
  NetworkTrafficUsageListQuery,
  NetworkTrafficUsageQuery,
  NetworkTrafficUsageRefile,
  NetworkTrafficUsageStorageTable,
} from "Common/Server/Services/NetworkTrafficUsageAggregationService";
import NetworkTrafficUsageService from "Common/Server/Services/NetworkTrafficUsageService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import NetworkControllerReadRunner, {
  NetworkControllerReadOutcome,
} from "Common/Server/Utils/NetworkController/NetworkControllerReadRunner";
import {
  NetworkTrafficUsageRecord,
  NetworkTrafficUsageStoredEnds,
} from "Common/Server/Utils/NetworkController/NetworkControllerTypes";
import { toUsageRow } from "Common/Server/Utils/NetworkController/NetworkTrafficUsageRows";
import { TelemetryServiceFilter } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import { JSONObject } from "Common/Types/JSON";
import {
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import NetworkControllerProvider from "Common/Types/NetworkController/NetworkControllerProvider";
import ObjectID from "Common/Types/ObjectID";
import { MAX_UPLINK_HEALTH_WINDOWS_PER_READ } from "Common/Server/Utils/NetworkController/Meraki/MerakiTrafficReader";
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
 *   three MX appliances, each wan1 at 10,000 B/s up and 50,000 B/s down,
 *   losing 0.5% with a latency of 20 ms, and wan2 at 100 and 200, losing
 *   1.5% at 40 ms; one application (Microsoft Teams, 1,000 up and 3,000
 *   down) and one client (100 up, 400 down) on each network. The MX of the
 *   first branch is a device in OneUptime; the other two are the project's
 *   bucket. Another project's rows are written too - and no read
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
// Of the rows a test writes itself: no read of CONNECTION ever counts them.
const WRITTEN_BY_A_TEST: ObjectID = ObjectID.generate();
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
      /*
       * The device list's details go to Postgres, which this suite does
       * not run: no device here is a Meraki device.
       */
      findControllerCandidates: async () => {
        return [];
      },
      mergeControllerReadings: async () => {
        return 0;
      },
      /*
       * Nor does it hold the list's serial numbers, MACs or addresses: what
       * the read counts for Add devices is read from Postgres too.
       */
      findIdentityHolders: async () => {
        return [];
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
    /*
     * 34 uplink windows of three MXs on two uplinks, each network's
     * applications and clients, and the windows of health read back.
     */
    const rows: number =
      34 * 3 * 2 + 3 + 3 + MAX_UPLINK_HEALTH_WINDOWS_PER_READ * 3 * 2;

    expect(firstOutcome.status).toBe("success");
    expect(firstOutcome.summary?.rowsWritten).toBe(rows);
    expect(await count(`WHERE projectId = '${PROJECT.toString()}'`)).toBe(rows);
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
    expect(result.topApplications[0]).toMatchObject({
      protocol: "UDP",
      port: 3478,
    });
    expect(result.topDestinations[0]).toMatchObject({
      destination: "teams.microsoft.com",
      application: "Microsoft Teams",
      protocol: "UDP",
      port: 3478,
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

  test("who talks to whom: each network's destination, protocol and port", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates();

    expect(result.topConversations).toHaveLength(3);
    expect(
      result.topConversations
        .map((row: { controllerNetworkName: string }) => {
          return row.controllerNetworkName;
        })
        .sort(),
    ).toEqual(["Branch 1", "Branch 2", "Branch 3"]);
    expect(result.topConversations[0]).toMatchObject({
      destination: "teams.microsoft.com",
      application: "Microsoft Teams",
      protocol: "UDP",
      port: 3478,
      flows: 60,
      clients: 12,
    });
    // A day's window: an hour of it is ~1/24, in the same share as the rest.
    expect(
      Math.abs(result.topConversations[0]!.sentOctets - 1000 * RANGE_SECONDS),
    ).toBeLessThan(1000 * RANGE_SECONDS * 0.001);
  });

  test("a network filter holds who talks to whom to it", async () => {
    const result: NetworkTrafficUsageAggregates = await aggregates(
      {},
      { controllerNetworkId: "L_1001" },
    );

    expect(result.topConversations).toHaveLength(1);
    expect(result.topConversations[0]!.controllerNetworkName).toBe("Branch 2");
  });

  test("traffic Meraki names only by its application stays apart by it, the busiest window's rest left out", async () => {
    const empty: Omit<
      NetworkTrafficUsageRecord,
      "application" | "receivedOctets"
    > = {
      kind: NetworkTrafficUsageKind.Application,
      controllerNetworkId: "L_NO_DESTINATIONS",
      controllerNetworkName: "No destinations",
      deviceSerial: "",
      deviceName: "",
      interfaceName: "",
      destination: "",
      protocol: "TCP",
      port: 443,
      clientKey: "",
      clientName: "",
      clientIp: "",
      clientMac: "",
      clientManufacturer: "",
      sentOctets: 0,
      flows: 0,
      clients: 0,
      lossPercent: null,
      latencyMs: null,
      windowStartAt: new Date("2026-10-24T10:00:00.000Z"),
      windowEndAt: new Date("2026-10-24T11:00:00.000Z"),
    };

    await NetworkTrafficUsageService.insertJsonRows(
      (
        [
          ["Microsoft Teams", 5000],
          ["Dropbox", 2000],
          ["", 1000],
        ] as Array<[string, number]>
      ).map(([application, receivedOctets]: [string, number]): JSONObject => {
        return toUsageRow({
          record: { ...empty, application, receivedOctets },
          projectId: PROJECT,
          connectionId: WRITTEN_BY_A_TEST,
          matches: { bySerial: new Map(), byNetwork: new Map() },
          ingestedAt: START,
        });
      }),
    );

    const result: NetworkTrafficUsageAggregates = await aggregates(
      {},
      { controllerNetworkId: "L_NO_DESTINATIONS" },
    );

    expect(
      result.topConversations.map(
        (row: { application: string; receivedOctets: number }) => {
          return [row.application, row.receivedOctets];
        },
      ),
    ).toEqual([
      ["Microsoft Teams", 5000],
      ["Dropbox", 2000],
    ]);
  });

  describe("an uplink's filter", () => {
    test("narrows the numbers, the chart and the lists of uplinks to it, on every appliance", async () => {
      const result: NetworkTrafficUsageAggregates = await aggregates(
        {},
        { interfaceName: "wan2" },
      );

      expect(result.totals.sentOctets).toBe(3 * 100 * RANGE_SECONDS);
      expect(result.totals.receivedOctets).toBe(3 * 200 * RANGE_SECONDS);
      expect(result.series).toHaveLength(12);
      expect(result.series[0]!.sentOctets).toBe(3 * 100 * 300);
      expect(result.topUplinks).toHaveLength(3);
      expect(
        result.topUplinks.every((row: { interfaceName: string }) => {
          return row.interfaceName === "wan2";
        }),
      ).toBe(true);
      // Top networks says which sites use it.
      expect(result.topNetworks[0]!.sentOctets).toBe(100 * RANGE_SECONDS);
    });

    test("with an appliance's, one uplink of one appliance: wan2 without wan1", async () => {
      const result: NetworkTrafficUsageAggregates = await aggregates(
        {},
        {
          controllerNetworkId: "L_1001",
          deviceSerial: "Q2XX-AAAA-0001",
          interfaceName: "wan2",
        },
      );

      expect(result.totals.sentOctets).toBe(100 * RANGE_SECONDS);
      expect(result.topUplinks).toHaveLength(1);
      expect(result.topUplinks[0]!.interfaceName).toBe("wan2");
    });

    test("leaves the applications, the clients and the flows the network's", async () => {
      const everything: NetworkTrafficUsageAggregates = await aggregates();
      const narrowed: NetworkTrafficUsageAggregates = await aggregates(
        {},
        { interfaceName: "wan2" },
      );

      expect(narrowed.applicationTotals).toEqual(everything.applicationTotals);
      expect(narrowed.clientTotals).toEqual(everything.clientTotals);
      expect(narrowed.totals.flows).toBe(everything.totals.flows);
      expect(narrowed.topConversations).toEqual(everything.topConversations);
    });

    test("an uplink nothing carried matches nothing", async () => {
      const result: NetworkTrafficUsageAggregates = await aggregates(
        {},
        { interfaceName: "cellular" },
      );

      expect(result.totals.sentOctets).toBe(0);
      expect(result.topUplinks).toEqual([]);
    });

    test("a name that is SQL is a value, and matches nothing", async () => {
      const result: NetworkTrafficUsageAggregates = await aggregates(
        {},
        { interfaceName: "wan1' OR '1'='1" },
      );

      expect(result.totals.sentOctets).toBe(0);
    });
  });

  describe("the page's uplinks, side by side", () => {
    test("each carried what it should, on every appliance", async () => {
      const result: NetworkTrafficUsageAggregates = await aggregates();

      expect(result.uplinkInterfaces).toHaveLength(2);

      const [wan1, wan2] = result.uplinkInterfaces;

      expect(wan1).toMatchObject({
        interfaceName: "wan1",
        applianceCount: 3,
        sentOctets: 3 * 10000 * RANGE_SECONDS,
        receivedOctets: 3 * 50000 * RANGE_SECONDS,
      });
      expect(wan2).toMatchObject({
        interfaceName: "wan2",
        applianceCount: 3,
        sentOctets: 3 * 100 * RANGE_SECONDS,
        receivedOctets: 3 * 200 * RANGE_SECONDS,
      });
    });

    test("narrowed to wan2, wan1 stays beside it, whole", async () => {
      const everything: NetworkTrafficUsageAggregates = await aggregates();
      const narrowed: NetworkTrafficUsageAggregates = await aggregates(
        {},
        { interfaceName: "wan2" },
      );

      expect(narrowed.uplinkInterfaces).toEqual(everything.uplinkInterfaces);
      expect(narrowed.uplinkSeries).toEqual(everything.uplinkSeries);
    });

    test("an appliance's filter holds them to it, and a device's reader to theirs", async () => {
      const appliance: NetworkTrafficUsageAggregates = await aggregates(
        {},
        { deviceSerial: "Q2XX-AAAA-0001" },
      );

      expect(appliance.uplinkInterfaces[0]).toMatchObject({
        applianceCount: 1,
        sentOctets: 10000 * RANGE_SECONDS,
      });

      const device: NetworkTrafficUsageAggregates = await aggregates({
        devices: { serviceIds: [MX_DEVICE] },
      });

      expect(device.uplinkInterfaces[0]).toMatchObject({
        applianceCount: 1,
        sentOctets: 10000 * RANGE_SECONDS,
      });
    });

    test("the chart splits every window over its buckets, uplink by uplink", async () => {
      const result: NetworkTrafficUsageAggregates = await aggregates();

      // Twelve five-minute buckets of two uplinks, the hour window split evenly.
      expect(result.uplinkSeries).toHaveLength(24);

      const wan1: Array<NetworkTrafficUsageAggregates["uplinkSeries"][number]> =
        result.uplinkSeries.filter((point: { interfaceName: string }) => {
          return point.interfaceName === "wan1";
        });

      expect(wan1).toHaveLength(12);
      expect(wan1[0]!.time).toBe("2026-10-24T10:00:00.000Z");

      for (const point of wan1) {
        expect(point.sentOctets).toBe(3 * 10000 * 300);
        expect(point.receivedOctets).toBe(3 * 50000 * 300);
      }
    });

    test("what Meraki measured, averaged over the range: the health reads back two hours", async () => {
      // The newest two hours are the ones measured.
      const result: NetworkTrafficUsageAggregates = await aggregates({
        startTime: new Date("2026-10-24T11:00:00.000Z"),
        endTime: new Date("2026-10-24T11:55:00.000Z"),
      });

      const [wan1, wan2] = result.uplinkInterfaces;

      expect(wan1!.lossPercent).toBeCloseTo(0.5, 6);
      expect(wan1!.latencyMs).toBeCloseTo(20, 6);
      expect(wan2!.lossPercent).toBeCloseTo(1.5, 6);
      expect(wan2!.latencyMs).toBeCloseTo(40, 6);

      const measured: Array<
        NetworkTrafficUsageAggregates["uplinkSeries"][number]
      > = result.uplinkSeries.filter((point: { interfaceName: string }) => {
        return point.interfaceName === "wan2";
      });

      expect(measured).toHaveLength(11);
      expect(measured[0]!.latencyMs).toBeCloseTo(40, 6);
    });

    test("traffic from before any measurement is unknown: null, never a perfect 0", async () => {
      // The day's backfill of usage reaches back here; the health's two hours do not.
      const result: NetworkTrafficUsageAggregates = await aggregates({
        startTime: new Date("2026-10-24T02:00:00.000Z"),
        endTime: new Date("2026-10-24T03:00:00.000Z"),
      });

      expect(result.uplinkInterfaces[0]!.sentOctets).toBeGreaterThan(0);
      expect(result.uplinkInterfaces[0]!.lossPercent).toBeNull();
      expect(result.uplinkInterfaces[0]!.latencyMs).toBeNull();
      expect(result.uplinkSeries[0]!.sentOctets).toBeGreaterThan(0);
      expect(result.uplinkSeries[0]!.latencyMs).toBeNull();
    });

    test("a standby line that carried nothing is compared all the same, by its measurements", async () => {
      await NetworkTrafficUsageService.insertJsonRows([
        toUsageRow({
          record: {
            kind: NetworkTrafficUsageKind.UplinkHealth,
            controllerNetworkId: "L_1000",
            controllerNetworkName: "Branch 1",
            deviceSerial: "Q2XX-AAAA-0000",
            deviceName: "MX 1",
            interfaceName: "cellular",
            application: "",
            destination: "",
            protocol: "",
            port: 0,
            clientKey: "",
            clientName: "",
            clientIp: "",
            clientMac: "",
            clientManufacturer: "",
            sentOctets: 0,
            receivedOctets: 0,
            flows: 0,
            clients: 0,
            lossPercent: 0,
            latencyMs: 71,
            windowStartAt: new Date("2026-10-24T11:30:00.000Z"),
            windowEndAt: new Date("2026-10-24T11:35:00.000Z"),
          },
          projectId: PROJECT,
          connectionId: WRITTEN_BY_A_TEST,
          matches: { bySerial: new Map(), byNetwork: new Map() },
          ingestedAt: START,
        }),
      ]);

      const result: NetworkTrafficUsageAggregates = await aggregates({
        startTime: new Date("2026-10-24T11:00:00.000Z"),
        endTime: new Date("2026-10-24T11:55:00.000Z"),
      });

      expect(
        result.uplinkInterfaces.find((row: { interfaceName: string }) => {
          return row.interfaceName === "cellular";
        }),
      ).toEqual({
        interfaceName: "cellular",
        applianceCount: 0,
        sentOctets: 0,
        receivedOctets: 0,
        lossPercent: 0,
        latencyMs: 71,
      });
      expect(
        result.uplinkSeries.filter((point: { interfaceName: string }) => {
          return point.interfaceName === "cellular";
        }),
      ).toHaveLength(1);
    });

    test("the rows of every other kind hold no measurement, and none is taken for one", async () => {
      expect(
        await count(
          `WHERE projectId = '${PROJECT.toString()}' AND kind != 'uplinkHealth' AND (lossPercent IS NOT NULL OR latencyMs IS NOT NULL)`,
        ),
      ).toBe(0);
    });

    test("the health rows hold no bytes: they are no traffic, and no page total counts them", async () => {
      expect(
        await count(
          `WHERE projectId = '${PROJECT.toString()}' AND kind = 'uplinkHealth' AND (sentOctets != 0 OR receivedOctets != 0)`,
        ),
      ).toBe(0);
    });
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
    // This project's connection and no other's: the other's read the same way.
    expect(Array.from(freshness.uplinkEnds.keys())).toEqual([
      CONNECTION.toString(),
    ]);
    expect(freshness.uplinkEnds.get(CONNECTION.toString())?.toISOString()).toBe(
      "2026-10-24T11:55:00.000Z",
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

    expect(keys.size).toBe(34 + 3 + 3 + MAX_UPLINK_HEALTH_WINDOWS_PER_READ);
    expect(
      keys.has(`uplink||${new Date("2026-10-24T11:50:00.000Z").getTime()}`),
    ).toBe(true);
    // The organization's, as an uplink window is: no network in its key.
    expect(
      keys.has(
        `uplinkHealth||${new Date("2026-10-24T11:50:00.000Z").getTime()}`,
      ),
    ).toBe(true);

    const ends: NetworkTrafficUsageStoredEnds =
      await NetworkTrafficUsageAggregationService.findStoredWindowEnds({
        projectId: PROJECT,
        connectionId: CONNECTION,
        since: new Date(START.getTime() - 25 * HOUR),
      });

    expect(ends.uplinkEnd?.toISOString()).toBe("2026-10-24T11:55:00.000Z");
    expect(ends.uplinkHealthEnd?.toISOString()).toBe(
      "2026-10-24T11:55:00.000Z",
    );
    expect(Array.from(ends.analyticsEnds.keys()).sort()).toEqual([
      "L_1000",
      "L_1001",
      "L_1002",
    ]);
    // Each network's end is its analytics' own, a whole read after the health's.
    for (const end of ends.analyticsEnds.values()) {
      expect(end.getTime()).toBeGreaterThanOrEqual(START.getTime());
    }
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
    /*
     * One new five-minute window of six uplinks, and its six of health:
     * nothing of the day again.
     */
    expect(rowsAfterFailure - rowsBefore).toBe(6 + 6);

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

  /*
   * Issue #5762, on a project of its own whose rows the tests write: an
   * estate of 30 stores, each an MX on wan1 - store i receives (200 - i)
   * thousand bytes in the hour and sends i * 500, so the busiest in total
   * and in is store 101, the busiest out store 130 - with twelve
   * applications on the first store's network and fifteen clients on the
   * second's. Every appliance is in the project's bucket until a refile
   * files one under a device.
   */
  describe("whole lists, the appliances to link and refiles", () => {
    const ESTATE: ObjectID = ObjectID.generate();
    const ESTATE_CONNECTION: ObjectID = ObjectID.generate();
    const ANOTHER_ESTATE_CONNECTION: ObjectID = ObjectID.generate();
    const ROUTER: ObjectID = ObjectID.generate();
    const STORES: number = 30;
    const TOWNS: Array<string> = ["Leeds", "York", "Bath", "Derby", "Hull"];
    const SINCE: Date = new Date("2026-10-01T00:00:00.000Z");
    // Where the refile is written: the table itself, on a server of one node.
    const ONE_NODE_TABLE: NetworkTrafficUsageStorageTable = {
      databaseName: database,
      storageTable: "NetworkTrafficUsageV1",
      onCluster: "",
    };

    function store(index: number): {
      id: string;
      name: string;
      serial: string;
      appliance: string;
      received: number;
      sent: number;
    } {
      const number: number = 100 + index;

      return {
        id: `L_77${number}`,
        name: `Store ${number} · ${TOWNS[(index - 1) % TOWNS.length]}`,
        serial: `Q2ST-0000-0${number}`,
        appliance: `ST${number} MX67`,
        received: (200 - index) * 1000,
        sent: index * 500,
      };
    }

    function blank(
      overrides: Partial<NetworkTrafficUsageRecord>,
    ): NetworkTrafficUsageRecord {
      return {
        kind: NetworkTrafficUsageKind.Uplink,
        controllerNetworkId: "",
        controllerNetworkName: "",
        deviceSerial: "",
        deviceName: "",
        interfaceName: "",
        application: "",
        destination: "",
        protocol: "",
        port: 0,
        clientKey: "",
        clientName: "",
        clientIp: "",
        clientMac: "",
        clientManufacturer: "",
        sentOctets: 0,
        receivedOctets: 0,
        flows: 0,
        clients: 0,
        lossPercent: null,
        latencyMs: null,
        windowStartAt: RANGE_START,
        windowEndAt: RANGE_END,
        ...overrides,
      };
    }

    async function write(
      records: Array<NetworkTrafficUsageRecord>,
      connectionId: ObjectID = ESTATE_CONNECTION,
    ): Promise<void> {
      await NetworkTrafficUsageService.insertJsonRows(
        records.map((record: NetworkTrafficUsageRecord): JSONObject => {
          return toUsageRow({
            record,
            projectId: ESTATE,
            connectionId,
            matches: { bySerial: new Map(), byNetwork: new Map() },
            ingestedAt: START,
          });
        }),
      );
    }

    function estate(
      overrides: Partial<NetworkTrafficUsageQuery> = {},
    ): NetworkTrafficUsageQuery {
      return query({ projectId: ESTATE, ...overrides });
    }

    async function list(
      overrides: Partial<NetworkTrafficUsageListQuery>,
    ): Promise<NetworkTrafficUsageListResult> {
      return await NetworkTrafficUsageAggregationService.getList({
        query: estate(),
        list: NetworkTrafficUsageListKind.Networks,
        primaryKind: NetworkTrafficUsageKind.Uplink,
        search: "",
        sortBy: NetworkTrafficUsageListSort.Total,
        skip: 0,
        limit: 25,
        ...overrides,
      });
    }

    function names(result: NetworkTrafficUsageListResult): Array<string> {
      return result.networks.map((row: { name: string }): string => {
        return row.name;
      });
    }

    async function estateAggregates(
      devices: TelemetryServiceFilter,
    ): Promise<NetworkTrafficUsageAggregates> {
      return await NetworkTrafficUsageAggregationService.getAggregates({
        query: estate({ devices }),
        bucketSeconds: 300,
        primaryKind: NetworkTrafficUsageKind.Uplink,
      });
    }

    // A mutation runs in the background: wait for what it makes true.
    async function eventually(
      what: string,
      check: () => Promise<boolean>,
    ): Promise<void> {
      const deadline: number = Date.now() + 60000;

      while (Date.now() < deadline) {
        if (await check()) {
          return;
        }

        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 200);
        });
      }

      throw new Error(`Still waiting for ${what}`);
    }

    function refileOf(
      overrides: Partial<NetworkTrafficUsageRefile>,
    ): NetworkTrafficUsageRefile {
      return {
        projectId: ESTATE,
        connectionId: ESTATE_CONNECTION,
        fromDeviceId: ESTATE,
        appliances: [],
        networks: [],
        since: SINCE,
        ...overrides,
      };
    }

    beforeAll(async (): Promise<void> => {
      const records: Array<NetworkTrafficUsageRecord> = [];

      for (let index: number = 1; index <= STORES; index++) {
        const each: ReturnType<typeof store> = store(index);

        records.push(
          blank({
            kind: NetworkTrafficUsageKind.Uplink,
            controllerNetworkId: each.id,
            controllerNetworkName: each.name,
            deviceSerial: each.serial,
            deviceName: each.appliance,
            interfaceName: "wan1",
            sentOctets: each.sent,
            receivedOctets: each.received,
          }),
        );
      }

      for (let index: number = 1; index <= 12; index++) {
        records.push(
          blank({
            kind: NetworkTrafficUsageKind.Application,
            controllerNetworkId: store(1).id,
            controllerNetworkName: store(1).name,
            application: `App ${String.fromCharCode(64 + index)}`,
            protocol: "TCP",
            port: 443,
            sentOctets: index * 10,
            receivedOctets: (13 - index) * 100,
            flows: 1,
          }),
        );
      }

      for (let index: number = 1; index <= 15; index++) {
        records.push(
          blank({
            kind: NetworkTrafficUsageKind.Client,
            controllerNetworkId: store(2).id,
            controllerNetworkName: store(2).name,
            clientKey: `k${index}`,
            clientName: index % 5 === 0 ? "" : `Till ${index}`,
            clientIp: `10.80.0.${index}`,
            clientMac: `00:1b:63:00:00:${String(index).padStart(2, "0")}`,
            clientManufacturer: "Ingenico",
            sentOctets: index * 5,
            receivedOctets: (16 - index) * 50,
          }),
        );
      }

      await write(records);
    });

    test("the totals say how many networks, applications and clients the top lists are of", async () => {
      const result: NetworkTrafficUsageAggregates =
        await estateAggregates(EVERY_DEVICE);

      expect(result.networkCount).toBe(STORES);
      expect(result.applicationCount).toBe(12);
      expect(result.clientCount).toBe(15);
      // The top lists stop at ten; the counts are what "View all" opens.
      expect(result.topNetworks).toHaveLength(10);
      expect(result.topNetworks[0]!.name).toBe(store(1).name);
    });

    test("a whole list, paged by the database: every network once, the busiest first", async () => {
      const first: NetworkTrafficUsageListResult = await list({});
      const second: NetworkTrafficUsageListResult = await list({ skip: 25 });

      expect(first.count).toBe(STORES);
      expect(second.count).toBe(STORES);
      expect(names(first)).toEqual(
        Array.from({ length: 25 }, (_unused: unknown, index: number) => {
          return store(index + 1).name;
        }),
      );
      expect(names(second)).toEqual(
        Array.from({ length: 5 }, (_unused: unknown, index: number) => {
          return store(index + 26).name;
        }),
      );
      expect(first.networks[0]).toEqual({
        controllerNetworkId: store(1).id,
        name: store(1).name,
        sentOctets: store(1).sent,
        receivedOctets: store(1).received,
      });
      expect(first.applications).toEqual([]);
      expect(first.clients).toEqual([]);
    });

    test("sorted by what went out, or by what came in", async () => {
      const out: NetworkTrafficUsageListResult = await list({
        sortBy: NetworkTrafficUsageListSort.Out,
        limit: 3,
      });
      const into: NetworkTrafficUsageListResult = await list({
        sortBy: NetworkTrafficUsageListSort.In,
        limit: 3,
      });

      expect(names(out)).toEqual([
        store(30).name,
        store(29).name,
        store(28).name,
      ]);
      expect(names(into)).toEqual([
        store(1).name,
        store(2).name,
        store(3).name,
      ]);
    });

    test("a search is a part of a network's name or ID, case aside, and counted as such", async () => {
      const byName: NetworkTrafficUsageListResult = await list({
        search: "STORE 12",
      });

      expect(byName.count).toBe(10);
      expect(names(byName)).toEqual(
        Array.from({ length: 10 }, (_unused: unknown, index: number) => {
          return store(index + 20).name;
        }),
      );

      const byId: NetworkTrafficUsageListResult = await list({
        search: "l_7711",
      });

      expect(byId.count).toBe(10);
      expect(byId.networks[0]!.controllerNetworkId).toBe(store(10).id);

      // Paged inside the search.
      expect(
        names(await list({ search: "store 12", skip: 8, limit: 5 })),
      ).toEqual([store(28).name, store(29).name]);
    });

    test("a search that is SQL, or a pattern, is only text: it matches nothing", async () => {
      for (const search of ["' OR 1=1 --", "%", "Store_1", ".*"]) {
        const result: NetworkTrafficUsageListResult = await list({ search });

        expect(result.count).toBe(0);
        expect(result.networks).toEqual([]);
      }
    });

    test("the applications' whole list: counted, sorted and paged", async () => {
      const result: NetworkTrafficUsageListResult = await list({
        list: NetworkTrafficUsageListKind.Applications,
        limit: 5,
      });

      expect(result.count).toBe(12);
      expect(
        result.applications.map((row: { application: string }) => {
          return row.application;
        }),
      ).toEqual(["App A", "App B", "App C", "App D", "App E"]);
      expect(result.applications[0]).toMatchObject({
        protocol: "TCP",
        port: 443,
        sentOctets: 10,
        receivedOctets: 1200,
        flows: 1,
      });
      expect(result.networks).toEqual([]);
    });

    test("the clients' whole list, searched by an address or a name", async () => {
      const byAddress: NetworkTrafficUsageListResult = await list({
        list: NetworkTrafficUsageListKind.Clients,
        search: "10.80.0.1",
      });

      // 10.80.0.1 and 10.80.0.10 to 10.80.0.15.
      expect(byAddress.count).toBe(7);
      expect(
        byAddress.clients.map((row: { clientKey: string }) => {
          return row.clientKey;
        }),
      ).toEqual(["k1", "k10", "k11", "k12", "k13", "k14", "k15"]);

      const byName: NetworkTrafficUsageListResult = await list({
        list: NetworkTrafficUsageListKind.Clients,
        search: "till 1",
      });

      // Till 1 and Till 11 to Till 14: clients 10 and 15 have no name.
      expect(byName.count).toBe(5);
      expect(byName.clients[0]).toMatchObject({
        clientKey: "k1",
        name: "Till 1",
        ip: "10.80.0.1",
        manufacturer: "Ingenico",
        controllerNetworkName: store(2).name,
      });
    });

    test("the appliances to link: each once, by its newest window, with what it carried", async () => {
      const appliances: Array<NetworkTrafficUsageApplianceRow> =
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId: ESTATE,
          devices: EVERY_DEVICE,
          since: SINCE,
          limit: 100,
        });

      expect(appliances).toHaveLength(STORES);
      expect(
        appliances.map((row: NetworkTrafficUsageApplianceRow) => {
          return row.serial;
        }),
      ).toEqual(
        Array.from({ length: STORES }, (_unused: unknown, index: number) => {
          return store(index + 1).serial;
        }),
      );
      expect(appliances[0]).toEqual({
        serial: store(1).serial,
        name: store(1).appliance,
        controllerNetworkId: store(1).id,
        controllerNetworkName: store(1).name,
        connectionId: ESTATE_CONNECTION.toString(),
        networkDeviceId: ESTATE.toString(),
        lastWindowEndAt: RANGE_END.toISOString(),
        octets: store(1).sent + store(1).received,
      });

      const some: Array<NetworkTrafficUsageApplianceRow> =
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId: ESTATE,
          devices: EVERY_DEVICE,
          since: SINCE,
          serials: [store(2).serial, "Q2ST-NONE-0000"],
          limit: 100,
        });

      expect(
        some.map((row: NetworkTrafficUsageApplianceRow) => {
          return row.serial;
        }),
      ).toEqual([store(2).serial]);

      expect(
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId: ESTATE,
          devices: EVERY_DEVICE,
          since: SINCE,
          limit: 5,
        }),
      ).toHaveLength(5);
    });

    test("an appliance renamed in Meraki reads as it is called now", async () => {
      await write([
        blank({
          controllerNetworkId: store(3).id,
          controllerNetworkName: store(3).name,
          deviceSerial: store(3).serial,
          deviceName: "ST103 MX68",
          interfaceName: "wan1",
          sentOctets: 1,
          receivedOctets: 1,
          windowStartAt: RANGE_END,
          windowEndAt: new Date(RANGE_END.getTime() + HOUR),
        }),
      ]);

      const renamed: Array<NetworkTrafficUsageApplianceRow> =
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId: ESTATE,
          devices: EVERY_DEVICE,
          since: SINCE,
          serials: [store(3).serial],
          limit: 100,
        });

      expect(renamed).toHaveLength(1);
      expect(renamed[0]!.name).toBe("ST103 MX68");
      expect(renamed[0]!.lastWindowEndAt).toBe(
        new Date(RANGE_END.getTime() + HOUR).toISOString(),
      );
    });

    test("nothing to file queues nothing", async () => {
      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refileOf({
            appliances: [{ serial: "Q2ST-NONE-0000", deviceId: ROUTER }],
          }),
          ONE_NODE_TABLE,
        ),
      ).toBe(false);

      // The router holds nothing yet, so it has nothing to give back.
      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refileOf({
            fromDeviceId: ROUTER,
            appliances: [{ serial: store(1).serial, deviceId: ESTATE }],
          }),
          ONE_NODE_TABLE,
        ),
      ).toBe(false);

      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refileOf({}),
          ONE_NODE_TABLE,
        ),
      ).toBe(false);
    });

    test("a link files the appliance's stored rows and its network's under the router, and an unlink files them back", async () => {
      // The same appliance as another connection reads it: not this refile's.
      await write(
        [
          blank({
            controllerNetworkId: store(1).id,
            controllerNetworkName: store(1).name,
            deviceSerial: store(1).serial,
            deviceName: store(1).appliance,
            interfaceName: "wan2",
            sentOctets: 7,
            receivedOctets: 9,
          }),
        ],
        ANOTHER_ESTATE_CONNECTION,
      );

      const before: NetworkTrafficUsageAggregates =
        await estateAggregates(EVERY_DEVICE);

      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refileOf({
            appliances: [{ serial: store(1).serial, deviceId: ROUTER }],
            networks: [{ controllerNetworkId: store(1).id, deviceId: ROUTER }],
          }),
          ONE_NODE_TABLE,
        ),
      ).toBe(true);

      await eventually("the router's traffic", async () => {
        return (
          (await estateAggregates({ serviceIds: [ROUTER] })).totals
            .receivedOctets === store(1).received
        );
      });

      // The router's page: its MX's uplink and its network's applications.
      const router: NetworkTrafficUsageAggregates = await estateAggregates({
        serviceIds: [ROUTER],
      });

      expect(router.totals.sentOctets).toBe(store(1).sent);
      expect(router.applicationCount).toBe(12);
      expect(router.clientCount).toBe(0);
      expect(
        router.topNetworks.map((row: { name: string }) => {
          return row.name;
        }),
      ).toEqual([store(1).name]);

      // The bucket keeps the rest, and the other connection's row.
      const bucket: NetworkTrafficUsageAggregates = await estateAggregates({
        serviceIds: [ESTATE],
      });

      expect(bucket.networkCount).toBe(STORES);
      expect(bucket.totals.receivedOctets).toBe(
        before.totals.receivedOctets - store(1).received,
      );
      expect(bucket.applicationCount).toBe(0);
      expect(bucket.clientCount).toBe(15);

      // The project's page adds up the same: nothing lost, nothing twice.
      const after: NetworkTrafficUsageAggregates =
        await estateAggregates(EVERY_DEVICE);

      expect(after.totals).toEqual(before.totals);
      expect(after.networkCount).toBe(before.networkCount);
      expect(after.applicationCount).toBe(before.applicationCount);

      // The appliance now reads as the router's.
      const linked: Array<NetworkTrafficUsageApplianceRow> =
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId: ESTATE,
          devices: { serviceIds: [ROUTER] },
          since: SINCE,
          limit: 100,
        });

      expect(linked).toHaveLength(1);
      expect(linked[0]!.serial).toBe(store(1).serial);
      expect(linked[0]!.networkDeviceId).toBe(ROUTER.toString());

      // Unlinked: back in the bucket, the router's page empty again.
      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refileOf({
            fromDeviceId: ROUTER,
            appliances: [{ serial: store(1).serial, deviceId: ESTATE }],
            networks: [{ controllerNetworkId: store(1).id, deviceId: ESTATE }],
          }),
          ONE_NODE_TABLE,
        ),
      ).toBe(true);

      await eventually("the router's traffic to go back", async () => {
        return (
          (await estateAggregates({ serviceIds: [ROUTER] })).totals
            .receivedOctets === 0
        );
      });

      const unlinked: NetworkTrafficUsageAggregates = await estateAggregates({
        serviceIds: [ESTATE],
      });

      expect(unlinked.totals).toEqual(before.totals);
      expect(unlinked.applicationCount).toBe(12);
    });

    test("a refile reaches back only as far as it is told", async () => {
      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refileOf({
            appliances: [{ serial: store(4).serial, deviceId: ROUTER }],
            since: RANGE_END,
          }),
          ONE_NODE_TABLE,
        ),
      ).toBe(false);
    });
  });
});

describe("Meraki traffic ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

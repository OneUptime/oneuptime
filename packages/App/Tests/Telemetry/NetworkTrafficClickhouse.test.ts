import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import NetworkFlow from "Common/Models/AnalyticsModels/NetworkFlow";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import NetworkFlowService from "Common/Server/Services/NetworkFlowService";
import NetworkTrafficAggregationService, {
  NetworkTrafficAggregates,
  NetworkTrafficQuery,
} from "Common/Server/Services/NetworkTrafficAggregationService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import NetworkFlowIngest, {
  FlowIngestResult,
} from "Common/Server/Utils/NetworkFlow/NetworkFlowIngest";
import { FlowExporterAttribution } from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import {
  NetworkTrafficDeviceRow,
  NetworkTrafficFilters,
  NetworkTrafficInterfaceRow,
  NetworkTrafficSource,
} from "Common/Types/NetFlow/NetworkTraffic";
import ObjectID from "Common/Types/ObjectID";
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
 * The Traffic pages' reads against a real ClickHouse server.
 *
 * The unit tests check the SQL as text. What they cannot show is that
 * ClickHouse runs it - the ARRAY JOIN that counts an interface's in and out
 * in one scan, the service-port expression, the bucket's exporter grouping,
 * the bound parameters, the 'throw' settings - and that it adds up. So this
 * suite builds the NetworkFlow table from the model, writes flows the way
 * ingest does (NetworkFlowIngest.buildRows -> insertJsonRows), and checks
 * every number a page shows against flows whose sums are known:
 *
 *   router A (10.0.0.1, NetFlow v9): an HTTPS download and its requests, a
 *     DNS lookup, a ping - through interfaces 1, 2 and 3;
 *   switch B (10.0.0.2, sFlow 1 in 1000): one UDP stream;
 *   10.9.9.9: an exporter that is no device of the project (its bucket);
 *   a row of router A from before the window, a row from an older probe
 *   (no format, rate or count), and another project's flow - which no read
 *   of this project may ever count.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/NetworkTrafficClickhouse.test.ts
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

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `network_traffic_test_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();
const SWITCH: ObjectID = ObjectID.generate();
const OTHER_PROJECT_DEVICE: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();

// The window every read covers: one hour.
const WINDOW_START: Date = new Date("2026-09-01T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-01T11:00:00.000Z");

function at(minutes: number): Date {
  return OneUptimeDate.addRemoveMinutes(WINDOW_START, minutes);
}

interface FlowFixture {
  exporter: string;
  record: Partial<NetworkFlowRecord>;
}

function flow(
  exporter: string,
  record: Partial<NetworkFlowRecord> &
    Pick<
      NetworkFlowRecord,
      | "sourceIpAddress"
      | "destinationIpAddress"
      | "protocolNumber"
      | "octets"
      | "flowStartAt"
    >,
): FlowFixture {
  return {
    exporter: exporter,
    record: {
      sourcePort: 0,
      destinationPort: 0,
      packets: 1,
      flowEndAt: record.flowStartAt,
      inputInterfaceIndex: 0,
      outputInterfaceIndex: 0,
      flowFormat: NetworkFlowFormat.NetFlowV9,
      samplingRate: 1,
      flowCount: 1,
      ...record,
    },
  };
}

const ROUTER_FLOWS: Array<FlowFixture> = [
  // The client's requests to HTTPS: in through 1, out through 2.
  flow("10.0.0.1", {
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "198.51.100.20",
    destinationPort: 443,
    protocolNumber: 6,
    octets: 1_000_000,
    packets: 1000,
    flowCount: 3,
    inputInterfaceIndex: 1,
    outputInterfaceIndex: 2,
    flowStartAt: at(10),
  }),
  // The download back: in through 2, out through 1.
  flow("10.0.0.1", {
    sourceIpAddress: "198.51.100.20",
    destinationIpAddress: "10.0.0.5",
    sourcePort: 443,
    protocolNumber: 6,
    octets: 9_000_000,
    packets: 6000,
    inputInterfaceIndex: 2,
    outputInterfaceIndex: 1,
    flowStartAt: at(10),
  }),
  // A DNS lookup: in through 1, out through 3.
  flow("10.0.0.1", {
    sourceIpAddress: "10.0.0.6",
    destinationIpAddress: "10.0.0.53",
    destinationPort: 53,
    protocolNumber: 17,
    octets: 50_000,
    packets: 400,
    inputInterfaceIndex: 1,
    outputInterfaceIndex: 3,
    flowStartAt: at(20),
  }),
  // A ping (NetFlow v5 puts ICMP's type and code in the destination port).
  flow("10.0.0.1", {
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "192.0.2.8",
    destinationPort: 2048,
    protocolNumber: 1,
    octets: 8_400,
    packets: 100,
    inputInterfaceIndex: 1,
    flowStartAt: at(30),
  }),
  // Before the window: never counted by its reads.
  flow("10.0.0.1", {
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "198.51.100.20",
    destinationPort: 443,
    protocolNumber: 6,
    octets: 777_777_777,
    flowStartAt: OneUptimeDate.addRemoveMinutes(WINDOW_START, -120),
  }),
];

const SWITCH_FLOWS: Array<FlowFixture> = [
  flow("10.0.0.2", {
    sourceIpAddress: "10.1.0.7",
    destinationIpAddress: "10.2.0.8",
    sourcePort: 5000,
    destinationPort: 5001,
    protocolNumber: 17,
    octets: 5_000_000,
    packets: 4000,
    flowFormat: NetworkFlowFormat.SFlow,
    samplingRate: 1000,
    flowStartAt: at(40),
  }),
];

const UNKNOWN_EXPORTER_FLOWS: Array<FlowFixture> = [
  flow("10.9.9.9", {
    sourceIpAddress: "10.3.0.1",
    destinationIpAddress: "8.8.8.8",
    destinationPort: 53,
    protocolNumber: 17,
    octets: 2_000,
    packets: 10,
    flowFormat: NetworkFlowFormat.Ipfix,
    flowStartAt: at(50),
  }),
];

const OTHER_PROJECT_FLOWS: Array<FlowFixture> = [
  flow("10.0.0.1", {
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "198.51.100.20",
    destinationPort: 443,
    protocolNumber: 6,
    octets: 123_456_789,
    flowStartAt: at(15),
  }),
];

// The same project's bytes, in the window, from a probe older than formats.
const OLD_PROBE_OCTETS: number = 3_000;

const PROJECT_OCTETS: number =
  1_000_000 + 9_000_000 + 50_000 + 8_400 + 5_000_000 + 2_000 + OLD_PROBE_OCTETS;

function attribution(exporter: string): FlowExporterAttribution {
  if (exporter === "10.0.0.1") {
    return {
      devices: [{ networkDeviceId: ROUTER, projectId: PROJECT }],
      unmatchedProjectId: null,
    };
  }

  if (exporter === "10.0.0.2") {
    return {
      devices: [{ networkDeviceId: SWITCH, projectId: PROJECT }],
      unmatchedProjectId: null,
    };
  }

  return { devices: [], unmatchedProjectId: PROJECT };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new NetworkFlow();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: NetworkFlow as unknown as { new (): AnalyticsBaseModel },
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

function query(
  devices: TelemetryServiceFilter,
  filters: NetworkTrafficFilters = {},
): NetworkTrafficQuery {
  return {
    projectId: PROJECT,
    startTime: WINDOW_START,
    endTime: WINDOW_END,
    devices: devices,
    filters: filters,
  };
}

async function aggregates(
  devices: TelemetryServiceFilter,
  filters: NetworkTrafficFilters = {},
  options?: { includeInterfaces?: boolean; includeDevices?: boolean },
): Promise<NetworkTrafficAggregates> {
  return NetworkTrafficAggregationService.getAggregates({
    query: query(devices, filters),
    bucketSeconds: 60,
    includeInterfaces: options?.includeInterfaces ?? false,
    includeDevices: options?.includeDevices ?? true,
  });
}

const EVERY_DEVICE: TelemetryServiceFilter = {};

const ONLY_ROUTER: TelemetryServiceFilter = { serviceIds: [ROUTER] };

integration("network traffic reads against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Partial<typeof NetworkFlowService> | undefined;
  let waitForAsyncInsertBefore: string | undefined = undefined;
  const ingestedAt: Date = OneUptimeDate.getCurrentDate();

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
      database: NetworkFlowService.database,
      databaseClient: NetworkFlowService.databaseClient,
      ingestDatabase: NetworkFlowService.ingestDatabase,
      ingestDatabaseClient: NetworkFlowService.ingestDatabaseClient,
    };

    NetworkFlowService.database = clickhouse;
    NetworkFlowService.databaseClient = client;
    NetworkFlowService.ingestDatabase = clickhouse;
    NetworkFlowService.ingestDatabaseClient = client;

    waitForAsyncInsertBefore = process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = "true";

    // Written the way ingest writes them.
    const ingest: (
      fixtures: Array<FlowFixture>,
      attribute: (exporter: string) => FlowExporterAttribution,
    ) => Promise<FlowIngestResult> = async (
      fixtures: Array<FlowFixture>,
      attribute: (exporter: string) => FlowExporterAttribution,
    ): Promise<FlowIngestResult> => {
      const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
        probe: { id: PROBE, projectId: PROJECT },
        rawRecords: fixtures.map((fixture: FlowFixture): JSONObject => {
          return {
            ...fixture.record,
            exporterIpAddress: fixture.exporter,
            flowStartAt: fixture.record.flowStartAt!.toISOString(),
            flowEndAt: fixture.record.flowEndAt!.toISOString(),
          } as unknown as JSONObject;
        }),
        ingestedAt: ingestedAt,
        attribute: async (
          _probe: unknown,
          exporter: string,
        ): Promise<FlowExporterAttribution> => {
          return attribute(exporter);
        },
      });

      await NetworkFlowService.insertJsonRows(result.rows);

      return result;
    };

    const written: FlowIngestResult = await ingest(
      [...ROUTER_FLOWS, ...SWITCH_FLOWS, ...UNKNOWN_EXPORTER_FLOWS],
      attribution,
    );

    expect(written.unmatchedKept).toBe(1);
    expect(written.malformed).toBe(0);

    await ingest(OTHER_PROJECT_FLOWS, (): FlowExporterAttribution => {
      return {
        devices: [
          { networkDeviceId: OTHER_PROJECT_DEVICE, projectId: OTHER_PROJECT },
        ],
        unmatchedProjectId: null,
      };
    });

    // A row an older probe wrote: no format, rate, count or probe.
    await NetworkFlowService.insertJsonRows([
      {
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(ingestedAt),
        projectId: PROJECT.toString(),
        networkDeviceId: ROUTER.toString(),
        exporterIp: "10.0.0.1",
        srcIp: "10.0.0.7",
        dstIp: "10.0.0.8",
        srcPort: 0,
        dstPort: 22,
        protocol: 6,
        inputInterfaceIndex: 0,
        outputInterfaceIndex: 0,
        octets: OLD_PROBE_OCTETS,
        packets: 30,
        flowStartAt: OneUptimeDate.toClickhouseDateTime64(at(5)),
        flowEndAt: OneUptimeDate.toClickhouseDateTime64(at(5)),
        ingestedAt: OneUptimeDate.toClickhouseDateTime64(ingestedAt),
      },
    ]);
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(NetworkFlowService, original);
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

  test("the network's totals are this project's flows in the window - estimates, every record counted", async () => {
    const result: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE);

    expect(result.totals.octets).toBe(PROJECT_OCTETS);
    // 3 summed records + 1 + 1 + 1 (router) + 1 (switch) + 1 (unknown) + 1 (old probe).
    expect(result.totals.flows).toBe(9);
    expect(result.totals.packets).toBe(1000 + 6000 + 400 + 100 + 4000 + 10 + 30);
    // The switch samples 1 in 1000; the page says its numbers are estimates.
    expect(result.maxSamplingRate).toBe(1000);
  });

  test("traffic over time adds up to the totals, in the buckets the flows started in", async () => {
    const result: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE);

    const sum: number = result.series.reduce(
      (total: number, point: { octets: number }): number => {
        return total + point.octets;
      },
      0,
    );

    expect(sum).toBe(PROJECT_OCTETS);
    expect(result.series[0]!.time.startsWith("2026-09-01 10:05")).toBe(true);

    const tenPast: { time: string; octets: number } | undefined =
      result.series.find((point: { time: string }) => {
        return point.time.startsWith("2026-09-01 10:10");
      });

    expect(tenPast!.octets).toBe(10_000_000);
  });

  test("top sources, destinations and conversations rank by bytes", async () => {
    const result: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE);

    expect(
      result.topSources.map((row: { ip: string; octets: number }) => {
        return [row.ip, row.octets];
      }),
    ).toEqual([
      ["198.51.100.20", 9_000_000],
      ["10.1.0.7", 5_000_000],
      ["10.0.0.5", 1_008_400],
      ["10.0.0.6", 50_000],
      ["10.0.0.7", OLD_PROBE_OCTETS],
      ["10.3.0.1", 2_000],
    ]);

    expect(result.topDestinations[0]).toMatchObject({
      ip: "10.0.0.5",
      octets: 9_000_000,
    });

    expect(result.topConversations[0]).toMatchObject({
      sourceIp: "198.51.100.20",
      destinationIp: "10.0.0.5",
      octets: 9_000_000,
      packets: 6000,
    });
  });

  test("applications are named by their service port, whichever side it is on; ICMP has none", async () => {
    const result: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE);

    expect(
      result.topApplications.map(
        (row: { protocolNumber: number; port: number; octets: number }) => {
          return [row.protocolNumber, row.port, row.octets];
        },
      ),
    ).toEqual([
      // The requests (to 443) and the download (from 443) are one application.
      [6, 443, 10_000_000],
      // Two registered ports: the lower names it.
      [17, 5000, 5_000_000],
      [17, 53, 52_000],
      [1, 0, 8_400],
      [6, 22, OLD_PROBE_OCTETS],
    ]);
  });

  test("the devices sending the most, with the unknown exporter told apart by its address", async () => {
    const result: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE);

    expect(
      result.topDevices.map((row: NetworkTrafficDeviceRow) => {
        return [row.networkDeviceId, row.exporterIp, row.octets];
      }),
    ).toEqual([
      [
        ROUTER.toString(),
        "10.0.0.1",
        1_000_000 + 9_000_000 + 50_000 + 8_400 + OLD_PROBE_OCTETS,
      ],
      [SWITCH.toString(), "10.0.0.2", 5_000_000],
      [PROJECT.toString(), "10.9.9.9", 2_000],
    ]);
  });

  test("a device's interfaces count each flow in through one and out through another", async () => {
    const result: NetworkTrafficAggregates = await aggregates(
      ONLY_ROUTER,
      {},
      { includeInterfaces: true, includeDevices: false },
    );

    expect(
      result.topInterfaces.map((row: NetworkTrafficInterfaceRow) => {
        return [row.interfaceIndex, row.inOctets, row.outOctets];
      }),
    ).toEqual([
      [1, 1_000_000 + 50_000 + 8_400, 9_000_000],
      [2, 9_000_000, 1_000_000],
      [3, 0, 50_000],
    ]);

    // Interface 0 (unknown) is never a row.
    expect(
      result.topInterfaces.some((row: NetworkTrafficInterfaceRow) => {
        return row.interfaceIndex === 0;
      }),
    ).toBe(false);

    expect(result.topDevices).toEqual([]);
  });

  test("an interface filter keeps the flows through it and splits the series in and out", async () => {
    const result: NetworkTrafficAggregates = await aggregates(
      ONLY_ROUTER,
      { interfaceIndex: 2 },
      { includeInterfaces: true, includeDevices: false },
    );

    expect(result.totals.octets).toBe(10_000_000);

    const tenPast: { inOctets?: number; outOctets?: number } | undefined =
      result.series.find((point: { time: string }) => {
        return point.time.startsWith("2026-09-01 10:10");
      });

    expect(tenPast).toMatchObject({ inOctets: 9_000_000, outOctets: 1_000_000 });
  });

  test("every filter narrows the whole page: host, source, destination, application, exporter, device", async () => {
    const host: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      hostIp: "10.0.0.5",
    });
    expect(host.totals.octets).toBe(1_000_000 + 9_000_000 + 8_400);

    const source: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      sourceIp: "10.0.0.5",
    });
    expect(source.totals.octets).toBe(1_000_000 + 8_400);

    const destination: NetworkTrafficAggregates = await aggregates(
      EVERY_DEVICE,
      { destinationIp: "10.0.0.5" },
    );
    expect(destination.totals.octets).toBe(9_000_000);

    const https: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      protocolNumber: 6,
      port: 443,
    });
    expect(https.totals.octets).toBe(10_000_000);

    const dns: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      protocolNumber: 17,
      port: 53,
    });
    expect(dns.totals.octets).toBe(52_000);

    const unknown: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      exporterIp: "10.9.9.9",
    });
    expect(unknown.totals.octets).toBe(2_000);

    const oneDevice: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      networkDeviceId: SWITCH.toString(),
    });
    expect(oneDevice.totals.octets).toBe(5_000_000);
  });

  test("the caller's read scope decides whose flows count: some devices, a block, or none", async () => {
    const switchOnly: NetworkTrafficAggregates = await aggregates({
      serviceIds: [SWITCH],
    });
    expect(switchOnly.totals.octets).toBe(5_000_000);
    // A grant limited to devices never reads the project's bucket.
    expect(
      switchOnly.topDevices.map((row: NetworkTrafficDeviceRow) => {
        return row.networkDeviceId;
      }),
    ).toEqual([SWITCH.toString()]);

    const routerBlocked: NetworkTrafficAggregates = await aggregates({
      excludedServiceIds: [ROUTER],
    });
    expect(routerBlocked.totals.octets).toBe(5_000_000 + 2_000);

    const nothing: NetworkTrafficAggregates = await aggregates({
      serviceIds: [new ObjectID(TelemetryReadScopeUtil.NO_RESOURCE_ID)],
    });
    expect(nothing.totals.octets).toBe(0);
    expect(nothing.series).toEqual([]);
    expect(nothing.topSources).toEqual([]);
  });

  test("another project's flows are never counted, whatever the filters", async () => {
    const result: NetworkTrafficAggregates = await aggregates(EVERY_DEVICE, {
      sourceIp: "10.0.0.5",
      destinationIp: "198.51.100.20",
    });

    expect(result.totals.octets).toBe(1_000_000);
    expect(
      result.topDevices.some((row: NetworkTrafficDeviceRow) => {
        return row.networkDeviceId === OTHER_PROJECT_DEVICE.toString();
      }),
    ).toBe(false);
  });

  test("who is sending: one row per device and address, with its format, rate and newest flow", async () => {
    const sources: Array<NetworkTrafficSource> =
      await NetworkTrafficAggregationService.getSources({
        projectId: PROJECT,
        devices: EVERY_DEVICE,
        now: WINDOW_END,
      });

    const byExporter: Map<string, NetworkTrafficSource> = new Map(
      sources.map((source: NetworkTrafficSource) => {
        return [source.exporterIp, source];
      }),
    );

    expect(byExporter.size).toBe(3);
    // The flow from before the window is outside the last hour too.
    expect(byExporter.get("10.0.0.1")).toMatchObject({
      networkDeviceId: ROUTER.toString(),
      flowFormat: NetworkFlowFormat.NetFlowV9,
      samplingRate: 1,
      flows: 3 + 1 + 1 + 1 + 1,
      probeId: PROBE.toString(),
    });
    expect(byExporter.get("10.0.0.2")).toMatchObject({
      networkDeviceId: SWITCH.toString(),
      flowFormat: NetworkFlowFormat.SFlow,
      samplingRate: 1000,
      octets: 5_000_000,
    });
    expect(byExporter.get("10.9.9.9")).toMatchObject({
      networkDeviceId: PROJECT.toString(),
      flowFormat: NetworkFlowFormat.Ipfix,
    });
    expect(byExporter.get("10.0.0.1")!.lastFlowAt).toBeTruthy();
  });

  test("a device's newest flow is found reading the sort key backwards", async () => {
    const newest: string | null =
      await NetworkTrafficAggregationService.getLastFlowAt({
        projectId: PROJECT,
        networkDeviceId: ROUTER,
      });

    expect(newest?.startsWith("2026-09-01 10:30:00")).toBe(true);

    expect(
      await NetworkTrafficAggregationService.getLastFlowAt({
        projectId: PROJECT,
        networkDeviceId: ObjectID.generate(),
      }),
    ).toBeNull();
  });

  test("a read ClickHouse cannot finish in time is an error the page can explain, not an empty page", async () => {
    let caught: unknown = null;

    try {
      await NetworkFlowService.executeQuery(
        "SELECT count() FROM numbers(100000000000) SETTINGS max_execution_time = 1, timeout_overflow_mode = 'throw'",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(NetworkTrafficAggregationService.isTimeout(caught)).toBe(true);
  });
});

describe("network traffic ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

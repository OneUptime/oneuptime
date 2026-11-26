import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import NetworkFlow from "Common/Models/AnalyticsModels/NetworkFlow";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkFlowService from "Common/Server/Services/NetworkFlowService";
import ThreatIntelIndicatorService from "Common/Server/Services/ThreatIntelIndicatorService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { DnsResolutionCache } from "Common/Server/Utils/Monitor/DnsResolutionCache";
import NetworkFlowIngest from "Common/Server/Utils/NetworkFlow/NetworkFlowIngest";
import { FlowExporterAttribution } from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import OneUptimeProbeAddresses, {
  OneUptimeProbeAddressSource,
} from "Common/Server/Utils/Probe/OneUptimeProbeAddresses";
import FlowSecurityScan from "Common/Server/Utils/SecurityEvent/TelemetryScan/FlowSecurityScan";
import ProbeJobReader from "Common/Server/Utils/SecurityEvent/TelemetryScan/ProbeJobReader";
import { TelemetryWindowRead } from "Common/Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeProbeKind from "Common/Types/Probe/OneUptimeProbeKind";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import {
  PROBE_FLOW_ATTRIBUTES,
  ProbeFlowTraffic,
} from "Common/Utils/SecurityEvent/TelemetryScan/ProbeFlowSignals";
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
 * OneUptime's own probes in a window of network flows, against a real
 * ClickHouse server (#10429).
 *
 * Common's suites pin the statements and stand in for their answers; this
 * one shows what ClickHouse makes of them, on flows written the way ingest
 * writes them:
 *
 *   - everyone's scans and sweeps are read with the probes' addresses left
 *     out (srcIp NOT IN one array parameter), and the probes' alone (IN);
 *   - a probe's sweep is read again host by host, by protocol, with the
 *     name the collecting probe gave each host;
 *   - and the window comes out as the scan stores it: the probe's SNMP
 *     polling set aside, its SSH sweep beyond its work reported, and a
 *     neighbour doing the probe's exact polling reported as anyone's.
 *
 * Postgres - the probes, and what each is set to do - is stood in for.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/ProbeOwnTrafficClickhouse.test.ts
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

const database: string = `probe_own_traffic_test_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();
const COLLECTOR: ObjectID = ObjectID.generate();
const OFFICE_PROBE: ObjectID = ObjectID.generate();

const OFFICE_ADDRESS: string = "10.0.0.250";
const NEIGHBOUR_ADDRESS: string = "10.0.0.251";

// When the flows arrived, and so the window that reads them.
const INGESTED_AT: Date = new Date("2026-11-21T10:02:00.000Z");
const FLOW_START: Date = new Date("2026-11-21T10:00:30.000Z");

function hostsOf(prefix: string, count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${prefix}${index + 1}`;
  });
}

const DEVICES: Array<string> = hostsOf("10.0.0.", 40);
const STRANGERS: Array<string> = hostsOf("10.7.0.", 45);

function record(data: {
  src: string;
  dst: string;
  port: number;
  protocol: number;
}): Partial<NetworkFlowRecord> {
  return {
    sourceIpAddress: data.src,
    destinationIpAddress: data.dst,
    sourcePort: data.protocol === 1 ? 0 : 40000,
    destinationPort: data.port,
    protocolNumber: data.protocol,
    octets: 120,
    packets: 1,
    flowStartAt: FLOW_START,
    flowEndAt: FLOW_START,
    inputInterfaceIndex: 0,
    outputInterfaceIndex: 0,
    flowFormat: NetworkFlowFormat.NetFlowV5,
    samplingRate: 1,
    flowCount: 1,
  };
}

// A poll is ping-first: an echo request (NetFlow v5's "port" 2048), then SNMP.
function polling(
  src: string,
  devices: Array<string>,
): Array<Partial<NetworkFlowRecord>> {
  return devices.flatMap((dst: string): Array<Partial<NetworkFlowRecord>> => {
    return [
      record({ src, dst, port: 2048, protocol: 1 }),
      record({ src, dst, port: 161, protocol: 17 }),
    ];
  });
}

const FLOWS: Array<Partial<NetworkFlowRecord>> = [
  ...polling(OFFICE_ADDRESS, DEVICES),
  ...polling(NEIGHBOUR_ADDRESS, DEVICES),
  ...STRANGERS.map((dst: string): Partial<NetworkFlowRecord> => {
    return record({ src: OFFICE_ADDRESS, dst, port: 22, protocol: 6 });
  }),
];

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

function signalOf(event: NormalizedSecurityEvent): unknown {
  return event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE];
}

integration(
  "OneUptime's own probes in a window of flows, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: Partial<typeof NetworkFlowService> | undefined;
    let waitForAsyncInsertBefore: string | undefined = undefined;
    // The scans name their tables by the configured database: this test's, while it runs.
    let databaseNameBefore: string | undefined = undefined;
    let read: TelemetryWindowRead;
    const statements: Array<string> = [];

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

      await client.command({
        query: `CREATE DATABASE IF NOT EXISTS ${database}`,
      });
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
      databaseNameBefore = process.env["CLICKHOUSE_DATABASE"];
      process.env["CLICKHOUSE_DATABASE"] = database;

      // Written the way ingest writes them, by a probe collecting the router's flows.
      const written: { rows: Array<JSONObject> } =
        await NetworkFlowIngest.buildRows({
          probe: { id: COLLECTOR, projectId: PROJECT },
          rawRecords: FLOWS.map(
            (flow: Partial<NetworkFlowRecord>): JSONObject => {
              return {
                ...flow,
                exporterIpAddress: "10.0.0.1",
                flowStartAt: flow.flowStartAt!.toISOString(),
                flowEndAt: flow.flowEndAt!.toISOString(),
              } as unknown as JSONObject;
            },
          ),
          ingestedAt: INGESTED_AT,
          attribute: async (): Promise<FlowExporterAttribution> => {
            return {
              devices: [{ networkDeviceId: ROUTER, projectId: PROJECT }],
              unmatchedProjectId: null,
            };
          },
        });

      await NetworkFlowService.insertJsonRows(written.rows);

      // What Postgres holds: the office probe, checking in, polling its 40 devices.
      jest
        .spyOn(OneUptimeProbeAddresses, "readProjectProbes")
        .mockResolvedValue({
          probes: [
            {
              kind: OneUptimeProbeKind.Project,
              probeId: OFFICE_PROBE.toString(),
              name: "Office probe",
              lastAlive: INGESTED_AT,
              addresses: [
                {
                  value: OFFICE_ADDRESS,
                  source: OneUptimeProbeAddressSource.Interface,
                },
              ],
            },
          ],
          isComplete: true,
        });
      jest
        .spyOn(OneUptimeProbeAddresses, "readGlobalProbes")
        .mockResolvedValue({ probes: [], isComplete: true });
      jest
        .spyOn(OneUptimeProbeAddresses, "getOneUptimeCloud")
        .mockReturnValue(null);
      jest.spyOn(NetworkDeviceService, "findAllBy").mockResolvedValue(
        DEVICES.map((hostname: string): NetworkDevice => {
          const device: NetworkDevice = new NetworkDevice();
          device.hostname = hostname;
          device.snmpPort = 161;
          return device;
        }),
      );
      jest
        .spyOn(NetworkDeviceDiscoveryScanService, "findBy")
        .mockResolvedValue([]);
      jest
        .spyOn(MonitorProbeService, "findAllBy")
        .mockResolvedValue([] as Array<MonitorProbe>);
      jest
        .spyOn(ThreatIntelIndicatorService, "hasIndicatorsForProject")
        .mockResolvedValue(false);
      ProbeJobReader.setDnsCacheForTests(
        new DnsResolutionCache({
          resolver: async (): Promise<Array<string>> => {
            return [];
          },
        }),
      );

      const executeQuery: typeof NetworkFlowService.executeQuery =
        NetworkFlowService.executeQuery.bind(NetworkFlowService);

      jest
        .spyOn(NetworkFlowService, "executeQuery")
        .mockImplementation(
          async (
            statement: string | Statement,
            options?: Parameters<typeof NetworkFlowService.executeQuery>[1],
          ) => {
            statements.push(
              typeof statement === "string" ? statement : statement.query,
            );
            return executeQuery(statement, options);
          },
        );

      read = await FlowSecurityScan.readWindow({
        window: {
          projectId: PROJECT,
          arrivedAfter: OneUptimeDate.addRemoveMinutes(INGESTED_AT, -1),
          arrivedUntil: OneUptimeDate.addRemoveMinutes(INGESTED_AT, 1),
          happenedAfter: OneUptimeDate.addRemoveMinutes(FLOW_START, -60),
        },
      });
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();

      if (original) {
        Object.assign(NetworkFlowService, original);
      }

      if (waitForAsyncInsertBefore === undefined) {
        delete process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
      } else {
        process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] =
          waitForAsyncInsertBefore;
      }

      if (databaseNameBefore === undefined) {
        delete process.env["CLICKHOUSE_DATABASE"];
      } else {
        process.env["CLICKHOUSE_DATABASE"] = databaseNameBefore;
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("everyone's reads leave the probe's address out, and the probe's are read alone", () => {
      expect(
        statements.filter((query: string): boolean => {
          return query.includes(" AND srcIp NOT IN (");
        }),
      ).toHaveLength(2);
      expect(
        statements.filter((query: string): boolean => {
          return query.includes(" AND srcIp IN (");
        }),
      ).toHaveLength(2);
    });

    test("the probe's SNMP polling and its echo requests are set aside, Informational, naming it", () => {
      const setAside: Array<NormalizedSecurityEvent> = read.events.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return (
            signalOf(event) === SecurityTelemetrySignal.OneUptimeProbeTraffic
          );
        },
      );

      expect(
        setAside
          .map((event: NormalizedSecurityEvent): string => {
            return String(
              event.attributes[PROBE_FLOW_ATTRIBUTES.destinationPort],
            );
          })
          .sort(),
      ).toEqual(["161", "2048"]);

      for (const event of setAside) {
        expect(event.severityName).toBe(OcsfSeverity.Informational);
        expect(event.principalIp).toBe(OFFICE_ADDRESS);
        expect(event.attributes).toMatchObject({
          [PROBE_FLOW_ATTRIBUTES.probeId]: OFFICE_PROBE.toString(),
          [PROBE_FLOW_ATTRIBUTES.traffic]: ProbeFlowTraffic.OwnWork,
          [PROBE_FLOW_ATTRIBUTES.ownWorkCount]: "40",
          [PROBE_FLOW_ATTRIBUTES.otherCount]: "0",
        });
      }
    });

    test("the probe's SSH sweep beyond its work, and the neighbour's polling, are reported", () => {
      const sweeps: Array<string> = read.events
        .filter((event: NormalizedSecurityEvent): boolean => {
          return signalOf(event) === SecurityTelemetrySignal.NetworkSweep;
        })
        .map((event: NormalizedSecurityEvent): string => {
          return `${event.principalIp}:${event.targetPort} ${event.attributes["network.distinct_hosts"]} ${String(
            event.attributes[PROBE_FLOW_ATTRIBUTES.traffic] || "anyone's",
          )}`;
        })
        .sort();

      expect(sweeps).toEqual([
        `${OFFICE_ADDRESS}:22 45 ${ProbeFlowTraffic.BeyondOwnWork}`,
        `${NEIGHBOUR_ADDRESS}:161 40 anyone's`,
        `${NEIGHBOUR_ADDRESS}:2048 40 anyone's`,
      ]);
    });

    test("the hosts read again count as rows read", () => {
      // The probe's three sweep rows; 40 + 40 + 45 hosts read again; the neighbour's two rows.
      expect(read.recordsRead).toBe(3 + 125 + 2);
    });
  },
);

describe("probe own traffic ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});

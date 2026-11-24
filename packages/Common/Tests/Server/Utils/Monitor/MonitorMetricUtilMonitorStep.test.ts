import Label from "../../../../Models/DatabaseModels/Label";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../Server/Utils/Logger";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../../Types/Monitor/MonitorStepSeries";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeStatusMonitorResponse from "../../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY ROW A CHECK WRITES NAMES ITS STEP (#10906).
 *
 * A monitor with several steps writes each step's checks into the same
 * series; the step on every row is what lets a window of one step read that
 * step's checks alone. So every kind of row a check writes - a probe's
 * online, response time, status code and phase timings, a ping, an NTP
 * answer, a database's metrics, an SNMP device's interfaces and OIDs, a
 * script's run and the metrics it captures, a server's every metric and
 * disk, a probe status monitor's counts, and a filter's match history -
 * names it, written in one pass over the finished rows so none can miss it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STEP_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_STEP_ID: string = "55555555-5555-4555-8555-555555555555";

// A probe check that writes every kind of row a probe check can.
function everyProbeRow(): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    probeId: PROBE_ID,
    failureCause: "",
    monitoredAt: new Date("2026-11-24T12:00:00.000Z"),
    isOnline: true,
    responseTimeInMs: 250,
    responseCode: 200,
    httpTimings: {
      dnsLookupInMs: 5,
      tcpConnectInMs: 10,
      tlsHandshakeInMs: 20,
      timeToFirstByteInMs: 100,
      downloadInMs: 15,
    },
    portTimings: { dnsLookupInMs: 4, tcpConnectInMs: 9 },
    pingResponse: { packetLossPercent: 0, jitterInMs: 2 },
    ntpResponse: {
      isOnline: true,
      stratum: 2,
      isSynchronized: true,
      clockOffsetInMs: 3,
      rootDispersionInMs: 7,
    },
    databaseMonitorResponse: {
      isOnline: true,
      responseTimeInMs: 30,
      failureCause: "",
      metrics: { [MonitorMetricType.DatabaseConnectionsUsedPercent]: 40 },
      collectedGroups: [],
      unavailableGroups: [],
    },
    snmpResponse: {
      interfaces: [
        {
          interfaceIndex: 1,
          name: "eth0",
          isOperationallyUp: true,
          inBitsPerSecond: 100,
          outBitsPerSecond: 200,
          utilizationPercent: 5,
          errorsPerSecond: 0,
        },
      ],
      oidResponses: [{ oid: "1.3.6.1.2.1.1.3.0", name: "uptime", value: 42 }],
    },
    customCodeMonitorResponse: {
      executionTimeInMS: 80,
      capturedMetrics: [
        {
          name: "queue_depth",
          value: 7,
          // A script cannot file its datapoints under another step.
          attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: OTHER_STEP_ID, queue: "a" },
        },
      ],
    },
    syntheticMonitorResponse: [
      {
        executionTimeInMS: 900,
        browserType: "Chromium",
        screenSizeType: "Desktop",
        capturedMetrics: [{ name: "lcp", value: 1200 }],
      },
    ],
  } as unknown as ProbeMonitorResponse;
}

// A server's report that writes every kind of row a report can.
function everyServerRow(): ServerMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    hostname: "db-01",
    requestReceivedAt: new Date(),
    onlyCheckRequestReceivedAt: false,
    processes: [{ pid: 1, name: "init", command: "/sbin/init" }],
    basicInfrastructureMetrics: {
      cpuMetrics: {
        percentUsed: 12,
        cores: 4,
        timeUserPercent: 5,
        timeSystemPercent: 2,
        timeIoWaitPercent: 1,
        timeIdlePercent: 88,
        timeStealPercent: 0,
      },
      memoryMetrics: {
        total: 100,
        free: 60,
        used: 40,
        percentFree: 60,
        percentUsed: 40,
        swapPercentUsed: 3,
        available: 55,
      },
      diskMetrics: [
        {
          total: 100,
          free: 10,
          used: 90,
          diskPath: "/data",
          percentUsed: 90,
          percentFree: 10,
          device: "sdb1",
          fstype: "ext4",
          readBytes: 1000,
          writeBytes: 2000,
          readCount: 10,
          writeCount: 20,
        },
      ],
      loadMetrics: { load1: 0.5, load5: 0.4, load15: 0.3 },
      networkMetrics: {
        interfaces: [
          {
            interfaceName: "eth0",
            bytesReceived: 1,
            bytesSent: 2,
            packetsReceived: 3,
            packetsSent: 4,
            errorsIn: 0,
            errorsOut: 0,
          },
        ],
        connectionsEstablished: 12,
        connectionsListen: 4,
      },
      hostMetrics: { uptimeSeconds: 3600 },
    },
  } as unknown as ServerMonitorResponse;
}

function probeStatusCounts(): ProbeStatusMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    probes: [],
    connectedProbeCount: 3,
    disconnectedProbeCount: 1,
  } as unknown as ProbeStatusMonitorResponse;
}

describe("MonitorMetricUtil: every row a check writes names its step", () => {
  let insertedRows: Array<JSONObject>;

  beforeEach(() => {
    insertedRows = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (_data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          return undefined;
        },
      );
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function save(input: {
    dataToProcess: DataToProcess;
    monitorStepId?: ObjectID | string | undefined;
    monitorLabels?: Array<Label> | undefined;
  }): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: input.dataToProcess,
      monitorName: "Checkout",
      probeName: "London Probe",
      monitorStepId: input.monitorStepId,
      monitorLabels: input.monitorLabels,
    });
  }

  function attributesOf(row: JSONObject): Record<string, string> {
    return (row["attributes"] as Record<string, string>) || {};
  }

  function namesOf(rows: Array<JSONObject>): Array<string> {
    return Array.from(
      new Set(
        rows.map((row: JSONObject): string => {
          return row["name"] as string;
        }),
      ),
    ).sort();
  }

  function expectEveryRowNamesTheStep(stepId: string): void {
    expect(insertedRows.length).toBeGreaterThan(0);

    for (const row of insertedRows) {
      expect(attributesOf(row)[MONITOR_STEP_ID_ATTRIBUTE]).toBe(stepId);
      // The key the presence filter of a read prunes on, kept in step.
      expect(row["attributeKeys"] as Array<string>).toContain(
        MONITOR_STEP_ID_ATTRIBUTE,
      );
      expect(row["attributeKeys"]).toEqual(
        Object.keys(attributesOf(row)).sort(),
      );
    }
  }

  test("a probe check: every series it writes, from online to a script's captured metrics", async () => {
    await save({ dataToProcess: everyProbeRow(), monitorStepId: STEP_ID });

    // The check really wrote every kind of row a probe check writes.
    expect(namesOf(insertedRows)).toEqual(
      [
        MonitorMetricType.ExecutionTime,
        MonitorMetricType.ResponseTime,
        MonitorMetricType.DatabaseConnectionsUsedPercent,
        MonitorMetricType.SnmpInterfaceOperStatus,
        MonitorMetricType.SnmpInterfaceInBitsPerSecond,
        MonitorMetricType.SnmpInterfaceOutBitsPerSecond,
        MonitorMetricType.SnmpInterfaceUtilizationPercent,
        MonitorMetricType.SnmpInterfaceErrorsPerSecond,
        MonitorMetricType.SnmpOidValue,
        MonitorMetricType.DnsLookupTime,
        MonitorMetricType.TcpConnectTime,
        MonitorMetricType.TlsHandshakeTime,
        MonitorMetricType.TimeToFirstByte,
        MonitorMetricType.DownloadTime,
        MonitorMetricType.PortDnsLookupTime,
        MonitorMetricType.PortTcpConnectTime,
        MonitorMetricType.NtpClockOffset,
        MonitorMetricType.NtpStratum,
        MonitorMetricType.NtpIsSynchronized,
        MonitorMetricType.NtpRootDispersion,
        MonitorMetricType.PacketLossPercent,
        MonitorMetricType.Jitter,
        MonitorMetricType.IsOnline,
        MonitorMetricType.ResponseStatusCode,
        "custom.monitor.queue_depth",
        "custom.monitor.lcp",
      ].sort(),
    );

    expectEveryRowNamesTheStep(STEP_ID.toString());

    // The probe is kept beside the step on every row that names one.
    for (const row of insertedRows) {
      expect(attributesOf(row)["probeId"]).toBe(PROBE_ID.toString());
    }
  });

  test("a script's captured metric names the step it ran in, never one the script wrote", async () => {
    await save({ dataToProcess: everyProbeRow(), monitorStepId: STEP_ID });

    const captured: JSONObject | undefined = insertedRows.find(
      (row: JSONObject): boolean => {
        return row["name"] === "custom.monitor.queue_depth";
      },
    );

    expect(attributesOf(captured!)[MONITOR_STEP_ID_ATTRIBUTE]).toBe(
      STEP_ID.toString(),
    );
    // Its own attributes are kept.
    expect(attributesOf(captured!)["queue"]).toBe("a");
    // And the operator is told which key was dropped.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(MONITOR_STEP_ID_ATTRIBUTE),
    );
  });

  test("a server's report: its online, CPU, memory, every disk and interface, load and uptime", async () => {
    await save({ dataToProcess: everyServerRow(), monitorStepId: STEP_ID });

    expect(namesOf(insertedRows)).toEqual(
      expect.arrayContaining([
        MonitorMetricType.IsOnline,
        MonitorMetricType.CPUUsagePercent,
        MonitorMetricType.MemoryUsagePercent,
        MonitorMetricType.DiskUsagePercent,
        MonitorMetricType.DiskReadBytesTotal,
        MonitorMetricType.LoadAverage1Min,
        MonitorMetricType.SwapUsagePercent,
        MonitorMetricType.CPUTimeIoWaitPercent,
        MonitorMetricType.NetworkBytesReceivedTotal,
        MonitorMetricType.NetworkConnectionsEstablished,
        MonitorMetricType.HostUptimeSeconds,
        MonitorMetricType.ProcessCountTotal,
      ]),
    );

    expectEveryRowNamesTheStep(STEP_ID.toString());

    // Each disk is still a series of its own, beside the step.
    const disk: JSONObject | undefined = insertedRows.find(
      (row: JSONObject): boolean => {
        return row["name"] === MonitorMetricType.DiskUsagePercent;
      },
    );
    expect(attributesOf(disk!)["diskPath"]).toBe("/data");
  });

  test("a probe status monitor's counts", async () => {
    await save({ dataToProcess: probeStatusCounts(), monitorStepId: STEP_ID });

    expect(namesOf(insertedRows)).toEqual(
      [
        MonitorMetricType.ConnectedProbes,
        MonitorMetricType.DisconnectedProbes,
        MonitorMetricType.ProbesBehind,
      ].sort(),
    );
    expectEveryRowNamesTheStep(STEP_ID.toString());
  });

  test("the step is written beside the monitor's labels, and the labels keep theirs", async () => {
    const label: Label = new Label();
    label.name = "team:payments";

    await save({
      dataToProcess: everyProbeRow(),
      monitorStepId: STEP_ID.toString(),
      monitorLabels: [label],
    });

    expectEveryRowNamesTheStep(STEP_ID.toString());

    for (const row of insertedRows) {
      expect(
        Object.keys(attributesOf(row)).some((key: string): boolean => {
          return key.startsWith("oneuptime.label.");
        }),
      ).toBe(true);
    }
  });

  test("a caller that judges no step writes rows as before, naming none", async () => {
    await save({ dataToProcess: everyProbeRow() });

    expect(insertedRows.length).toBeGreaterThan(0);

    for (const row of insertedRows) {
      expect(attributesOf(row)[MONITOR_STEP_ID_ATTRIBUTE]).toBeUndefined();
      expect(row["attributeKeys"] as Array<string>).not.toContain(
        MONITOR_STEP_ID_ATTRIBUTE,
      );
    }
  });

  test("a step with no id names none: an empty id is never written as a step", async () => {
    await save({ dataToProcess: everyProbeRow(), monitorStepId: "" });

    for (const row of insertedRows) {
      expect(attributesOf(row)[MONITOR_STEP_ID_ATTRIBUTE]).toBeUndefined();
    }
  });

  test("a filter's match history names the step too, beside its filter key and probe", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      probeId: PROBE_ID,
      monitorStepId: STEP_ID,
      matches: [
        { filterKey: "a".repeat(32), matched: true },
        { filterKey: "b".repeat(32), matched: false },
      ],
    });

    expect(insertedRows).toHaveLength(2);
    expectEveryRowNamesTheStep(STEP_ID.toString());

    expect(
      insertedRows.map((row: JSONObject): string => {
        return `${row["name"] as string}:${attributesOf(row)[CRITERIA_FILTER_KEY_ATTRIBUTE]}:${attributesOf(row)["probeId"]}:${String(row["value"])}`;
      }),
    ).toEqual([
      `${CRITERIA_FILTER_MATCH_METRIC_NAME}:${"a".repeat(32)}:${PROBE_ID.toString()}:1`,
      `${CRITERIA_FILTER_MATCH_METRIC_NAME}:${"b".repeat(32)}:${PROBE_ID.toString()}:0`,
    ]);
  });

  test("a match history recorded without a step names none, as before", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      probeId: PROBE_ID,
      matches: [{ filterKey: "c".repeat(32), matched: true }],
    });

    expect(
      attributesOf(insertedRows[0]!)[MONITOR_STEP_ID_ATTRIBUTE],
    ).toBeUndefined();
  });

  describe("applyMonitorStepToMetricRows", () => {
    test("overwrites whatever a row held under the key, and keeps its keys sorted", () => {
      const rows: Array<JSONObject> = [
        {
          attributes: { zeta: "1", [MONITOR_STEP_ID_ATTRIBUTE]: OTHER_STEP_ID },
          attributeKeys: ["monitorStepId", "zeta"],
        },
        { attributes: {}, attributeKeys: [] },
        {},
      ];

      MonitorMetricUtil.applyMonitorStepToMetricRows({
        metricRows: rows,
        monitorStepId: STEP_ID,
      });

      expect(rows).toEqual([
        {
          attributes: { zeta: "1", [MONITOR_STEP_ID_ATTRIBUTE]: STEP_ID.toString() },
          attributeKeys: ["monitorStepId", "zeta"],
        },
        {
          attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: STEP_ID.toString() },
          attributeKeys: ["monitorStepId"],
        },
        {
          attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: STEP_ID.toString() },
          attributeKeys: ["monitorStepId"],
        },
      ]);
    });

    test("leaves every row as it is without a step", () => {
      const row: JSONObject = { attributes: { probeId: "p" }, attributeKeys: ["probeId"] };

      MonitorMetricUtil.applyMonitorStepToMetricRows({
        metricRows: [row],
        monitorStepId: undefined,
      });

      expect(row).toEqual({ attributes: { probeId: "p" }, attributeKeys: ["probeId"] });
    });
  });
});

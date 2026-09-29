import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import PortMonitorTimings from "../../../../Types/Monitor/PortMonitor/PortMonitorTimings";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function buildResponse(input: {
  portTimings?: PortMonitorTimings;
  responseTimeInMs?: number;
  includeHttpTimings?: boolean;
}): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: PROBE_ID,
    failureCause: "",
    monitoredAt: new Date("2026-08-07T12:00:00.000Z"),
    portTimings: input.portTimings,
    responseTimeInMs: input.responseTimeInMs,
    httpTimings: input.includeHttpTimings
      ? { dnsLookupInMs: 11, tcpConnectInMs: 22 }
      : undefined,
  };
}

describe("MonitorMetricUtil Port connection phase persistence", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMaps: Array<Dictionary<MetricType>>;

  beforeEach(() => {
    insertedRows = [];
    indexedMaps = [];

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
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          indexedMaps.push(data.metricNameServiceNameMap);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function save(response: ProbeMonitorResponse): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: response,
      monitorName: "Database Port",
      probeName: "London Probe",
    });
  }

  function rowByName(name: MonitorMetricType): JSONObject | undefined {
    return insertedRows.find((row: JSONObject) => {
      return row["name"] === name;
    });
  }

  test("persists DNS and TCP phases under Port-specific metric names", async () => {
    await save(
      buildResponse({
        portTimings: {
          dnsLookupInMs: 120,
          tcpConnectInMs: 35,
          totalConnectionInMs: 155,
        },
      }),
    );

    expect(insertedRows).toHaveLength(2);
    expect(rowByName(MonitorMetricType.PortDnsLookupTime)?.["value"]).toBe(120);
    expect(rowByName(MonitorMetricType.PortTcpConnectTime)?.["value"]).toBe(35);
    expect(rowByName(MonitorMetricType.DnsLookupTime)).toBeUndefined();
    expect(rowByName(MonitorMetricType.TcpConnectTime)).toBeUndefined();
  });

  test("adds monitor and probe identity to every phase row", async () => {
    await save(
      buildResponse({
        portTimings: {
          dnsLookupInMs: 10,
          tcpConnectInMs: 20,
          totalConnectionInMs: 30,
        },
      }),
    );

    for (const row of insertedRows) {
      expect(row["primaryEntityId"]).toBe(MONITOR_ID.toString());
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["attributes"]).toEqual(
        expect.objectContaining({
          monitorId: MONITOR_ID.toString(),
          projectId: PROJECT_ID.toString(),
          probeId: PROBE_ID.toString(),
          monitorName: "Database Port",
          probeName: "London Probe",
        }),
      );
    }
  });

  test("registers both Port phase metric types with millisecond units", async () => {
    await save(
      buildResponse({
        portTimings: {
          dnsLookupInMs: 10,
          tcpConnectInMs: 20,
          totalConnectionInMs: 30,
        },
      }),
    );

    expect(indexedMaps).toHaveLength(1);
    const metricMap: Dictionary<MetricType> = indexedMaps[0]!;
    expect(metricMap[MonitorMetricType.PortDnsLookupTime]?.unit).toBe("ms");
    expect(metricMap[MonitorMetricType.PortTcpConnectTime]?.unit).toBe("ms");
    expect(
      metricMap[MonitorMetricType.PortDnsLookupTime]?.description,
    ).toContain("DNS lookup");
    expect(
      metricMap[MonitorMetricType.PortTcpConnectTime]?.description,
    ).toContain("TCP connect");
  });

  test("keeps total connection time in the existing ResponseTime metric", async () => {
    await save(
      buildResponse({
        responseTimeInMs: 155,
        portTimings: {
          dnsLookupInMs: 120,
          tcpConnectInMs: 35,
          totalConnectionInMs: 155,
        },
      }),
    );

    expect(rowByName(MonitorMetricType.ResponseTime)?.["value"]).toBe(155);
    expect(
      insertedRows.some((row: JSONObject) => {
        return String(row["name"]).includes("port.total");
      }),
    ).toBe(false);
  });

  test("omits DNS for an IP literal while still persisting TCP", async () => {
    await save(
      buildResponse({
        portTimings: { tcpConnectInMs: 18, totalConnectionInMs: 18 },
      }),
    );

    expect(rowByName(MonitorMetricType.PortDnsLookupTime)).toBeUndefined();
    expect(rowByName(MonitorMetricType.PortTcpConnectTime)?.["value"]).toBe(18);
  });

  test("persists legitimate zero-millisecond phases", async () => {
    await save(
      buildResponse({
        portTimings: {
          dnsLookupInMs: 0,
          tcpConnectInMs: 0,
          totalConnectionInMs: 0,
        },
      }),
    );

    expect(rowByName(MonitorMetricType.PortDnsLookupTime)?.["value"]).toBe(0);
    expect(rowByName(MonitorMetricType.PortTcpConnectTime)?.["value"]).toBe(0);
  });

  test("skips absent and non-finite phase data", async () => {
    await save(
      buildResponse({
        portTimings: {
          dnsLookupInMs: Number.NaN,
          tcpConnectInMs: Number.POSITIVE_INFINITY,
          totalConnectionInMs: 100,
        },
      }),
    );

    expect(insertedRows).toEqual([]);
    expect(MetricService.insertJsonRows).not.toHaveBeenCalled();
    expect(indexedMaps).toEqual([{}]);
  });

  test("keeps HTTP and Port phase series distinct when both payloads are present", async () => {
    await save(
      buildResponse({
        includeHttpTimings: true,
        portTimings: {
          dnsLookupInMs: 33,
          tcpConnectInMs: 44,
          totalConnectionInMs: 77,
        },
      }),
    );

    expect(rowByName(MonitorMetricType.DnsLookupTime)?.["value"]).toBe(11);
    expect(rowByName(MonitorMetricType.TcpConnectTime)?.["value"]).toBe(22);
    expect(rowByName(MonitorMetricType.PortDnsLookupTime)?.["value"]).toBe(33);
    expect(rowByName(MonitorMetricType.PortTcpConnectTime)?.["value"]).toBe(44);
  });
});

import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import NetworkDeviceMetricUtil, {
  NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME,
} from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import PingMonitorResponse from "../../../../Types/Monitor/PingMonitor/PingMonitorResponse";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Device-scoped metrics under ping-first polling. The split that matters:
 *
 *   IsOnline      - device reachability (ping OR walk), every poll.
 *   ResponseTime  - the SNMP walk's time ONLY; absent on a ping-only poll.
 *   ping RTT/loss - from the probe's ping, when it ran one; the loss and
 *                   jitter series are the Ping monitor's, the RTT has its
 *                   own name because ResponseTime is taken.
 *
 * Every row is keyed to the NetworkDevice, not a monitor, so the device
 * pages chart a device no monitor watches.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const WALK: SnmpMonitorResponse = {
  isOnline: true,
  responseTimeInMs: 42,
  failureCause: "",
  oidResponses: [],
};

const OK_PING: PingMonitorResponse = {
  packetsSent: 2,
  packetsReceived: 2,
  packetLossPercent: 0,
  avgRoundTripTimeInMs: 1.5,
};

describe("NetworkDeviceMetricUtil.saveWalkMetrics", () => {
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

  async function save(input: {
    isOnline: boolean;
    snmpResponse?: SnmpMonitorResponse | undefined;
    pingResponse?: PingMonitorResponse | undefined;
  }): Promise<void> {
    await NetworkDeviceMetricUtil.saveWalkMetrics({
      projectId: PROJECT_ID,
      networkDeviceId: DEVICE_ID,
      deviceName: "core-sw-01",
      probeId: PROBE_ID,
      snmpResponse: input.snmpResponse,
      // Exactly what the walk pipeline passes: the walk's time or nothing.
      responseTimeInMs: input.snmpResponse?.responseTimeInMs,
      isOnline: input.isOnline,
      pingResponse: input.pingResponse,
    });
  }

  function valuesNamed(metricName: string): Array<number> {
    return insertedRows
      .filter((row: JSONObject) => {
        return row["name"] === metricName;
      })
      .map((row: JSONObject) => {
        return row["value"] as number;
      });
  }

  function descriptionOf(metricName: string): string | undefined {
    return indexedMaps[0]?.[metricName]?.description;
  }

  test("an snmp poll with no ping (an old probe) writes reachability and walk time, and no ping series", async () => {
    await save({ isOnline: true, snmpResponse: WALK });

    expect(valuesNamed(MonitorMetricType.IsOnline)).toEqual([1]);
    expect(valuesNamed(MonitorMetricType.ResponseTime)).toEqual([42]);
    expect(
      valuesNamed(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME),
    ).toEqual([]);
    expect(valuesNamed(MonitorMetricType.PacketLossPercent)).toEqual([]);
    expect(valuesNamed(MonitorMetricType.Jitter)).toEqual([]);
  });

  test("a ping-only poll writes reachability, RTT and loss - and NO response time, which is the walk's", async () => {
    await save({ isOnline: true, pingResponse: OK_PING });

    expect(valuesNamed(MonitorMetricType.IsOnline)).toEqual([1]);
    expect(valuesNamed(MonitorMetricType.ResponseTime)).toEqual([]);
    expect(
      valuesNamed(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME),
    ).toEqual([1.5]);
    expect(valuesNamed(MonitorMetricType.PacketLossPercent)).toEqual([0]);
    // Jitter is not measured by the reachability ping; nothing is invented.
    expect(valuesNamed(MonitorMetricType.Jitter)).toEqual([]);
  });

  test("an snmp poll with a ping writes both halves", async () => {
    await save({
      isOnline: true,
      snmpResponse: WALK,
      pingResponse: { ...OK_PING, jitterInMs: 0.2 },
    });

    expect(valuesNamed(MonitorMetricType.IsOnline)).toEqual([1]);
    expect(valuesNamed(MonitorMetricType.ResponseTime)).toEqual([42]);
    expect(
      valuesNamed(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME),
    ).toEqual([1.5]);
    expect(valuesNamed(MonitorMetricType.PacketLossPercent)).toEqual([0]);
    expect(valuesNamed(MonitorMetricType.Jitter)).toEqual([0.2]);
  });

  test("an unreachable ping-only poll writes 0 reachability and full loss, and no RTT for a ping that got no answer", async () => {
    await save({
      isOnline: false,
      pingResponse: {
        packetsSent: 2,
        packetsReceived: 0,
        packetLossPercent: 100,
        avgRoundTripTimeInMs: undefined,
      },
    });

    expect(valuesNamed(MonitorMetricType.IsOnline)).toEqual([0]);
    expect(valuesNamed(MonitorMetricType.PacketLossPercent)).toEqual([100]);
    expect(
      valuesNamed(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME),
    ).toEqual([]);
    expect(valuesNamed(MonitorMetricType.ResponseTime)).toEqual([]);
  });

  /*
   * ICMP-filtered SNMP gear: the ping fails but the walk succeeds. The
   * device is reachable (the pipeline's isOnline), the walk time is
   * written, and the ping's total loss is recorded as what it is.
   */
  test("ping failed but the walk succeeded: reachable, walk time written, loss recorded honestly", async () => {
    await save({
      isOnline: true,
      snmpResponse: WALK,
      pingResponse: {
        packetsSent: 2,
        packetsReceived: 0,
        packetLossPercent: 100,
      },
    });

    expect(valuesNamed(MonitorMetricType.IsOnline)).toEqual([1]);
    expect(valuesNamed(MonitorMetricType.ResponseTime)).toEqual([42]);
    expect(valuesNamed(MonitorMetricType.PacketLossPercent)).toEqual([100]);
  });

  test("the descriptions say what the series now mean", async () => {
    await save({ isOnline: true, snmpResponse: WALK, pingResponse: OK_PING });

    expect(descriptionOf(MonitorMetricType.IsOnline)).toContain("ping or SNMP");
    expect(descriptionOf(MonitorMetricType.ResponseTime)).toContain(
      "SNMP walk time",
    );
    expect(
      descriptionOf(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME),
    ).toContain("round-trip");
  });

  /*
   * ResponseTime is the walk's, so the RTT cannot share it; it lives in the
   * Ping monitor's namespace beside the loss and jitter series it is
   * emitted with.
   */
  test("the RTT series is namespaced with the Ping monitor's packet series and is not ResponseTime", () => {
    expect(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME).toBe(
      "oneuptime.monitor.ping.round.trip.time",
    );
    expect(
      NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME.startsWith(
        "oneuptime.monitor.ping.",
      ),
    ).toBe(true);
    expect(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME).not.toBe(
      MonitorMetricType.ResponseTime,
    );
    expect(
      MonitorMetricType.PacketLossPercent.startsWith("oneuptime.monitor.ping."),
    ).toBe(true);
  });

  test("every row is keyed to the device, with the probe and device name as attributes", async () => {
    await save({ isOnline: true, snmpResponse: WALK, pingResponse: OK_PING });

    expect(insertedRows.length).toBeGreaterThan(0);

    for (const row of insertedRows) {
      expect(row["primaryEntityId"]).toBe(DEVICE_ID.toString());
      expect(row["projectId"]).toBe(PROJECT_ID.toString());

      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["networkDeviceId"]).toBe(DEVICE_ID.toString());
      expect(attributes["probeId"]).toBe(PROBE_ID.toString());
      expect(attributes["deviceName"]).toBe("core-sw-01");
    }
  });
});

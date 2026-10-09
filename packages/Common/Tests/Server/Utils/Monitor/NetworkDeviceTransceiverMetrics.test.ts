import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../Server/Utils/Logger";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  NetworkDeviceTransceiver,
  SnmpTransceiverResult,
  TransceiverHealth,
  TransceiverMeasurements,
  TransceiverMibSource,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
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
 * Every transceiver reading is a device-scoped metric series - port,
 * reading and lane - so a month of received power or temperature can be
 * charted and alerted on like any other metric, in the units the page shows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const QSFP_MEASUREMENTS: TransceiverMeasurements = {
  temperature: { readings: [{ value: 41.3 }] },
  voltage: { readings: [{ value: 3.29 }] },
  biasCurrent: {
    readings: [
      { value: 6.2, lane: 1 },
      { value: 6.4, lane: 2 },
    ],
  },
  txPower: {
    readings: [
      { value: -1.1, lane: 1 },
      { value: -1.3, lane: 2 },
    ],
  },
  rxPower: {
    readings: [
      { value: -2.4, lane: 1 },
      { value: -9.8, lane: 2 },
    ],
  },
};

function judged(
  interfaceIndex: number,
  overrides: Partial<NetworkDeviceTransceiver> = {},
): NetworkDeviceTransceiver {
  return {
    interfaceIndex: interfaceIndex,
    interfaceName: `Et${interfaceIndex}/1`,
    isPresent: true,
    measurements: QSFP_MEASUREMENTS,
    health: TransceiverHealth.NotJudged,
    ...overrides,
  };
}

function read(interfaceIndex: number): SnmpTransceiverResult {
  return {
    interfaceIndex: interfaceIndex,
    measurements: QSFP_MEASUREMENTS,
    source: TransceiverMibSource.AristaEntitySensor,
  };
}

function walk(input: {
  transceivers: Array<NetworkDeviceTransceiver>;
  results: Array<SnmpTransceiverResult> | undefined;
}): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 42,
    failureCause: "",
    oidResponses: [],
    transceiverResults: input.results,
    transceivers: input.transceivers,
  };
}

describe("NetworkDeviceMetricUtil - transceiver series", () => {
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

  async function save(snmpResponse: SnmpMonitorResponse): Promise<void> {
    await NetworkDeviceMetricUtil.saveWalkMetrics({
      projectId: PROJECT_ID,
      networkDeviceId: DEVICE_ID,
      deviceName: "dc-leaf-1",
      probeId: PROBE_ID,
      snmpResponse: snmpResponse,
      responseTimeInMs: snmpResponse.responseTimeInMs,
      isOnline: true,
    });
  }

  function rowsNamed(metricName: string): Array<JSONObject> {
    return insertedRows.filter((row: JSONObject) => {
      return row["name"] === metricName;
    });
  }

  test("one series per port, reading and lane, in display units", async () => {
    await save(walk({ transceivers: [judged(49)], results: [read(49)] }));

    const rx: Array<JSONObject> = rowsNamed(
      MonitorMetricType.SnmpTransceiverRxPower,
    );

    expect(
      rx.map((row: JSONObject) => {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        return [
          row["value"],
          attributes["interfaceName"],
          attributes["interfaceIndex"],
          attributes["lane"],
        ];
      }),
    ).toEqual([
      [-2.4, "Et49/1", "49", "1"],
      [-9.8, "Et49/1", "49", "2"],
    ]);

    // A module-wide reading has no lane.
    const temperature: Array<JSONObject> = rowsNamed(
      MonitorMetricType.SnmpTransceiverTemperature,
    );
    expect(temperature).toHaveLength(1);
    expect(temperature[0]!["value"]).toBe(41.3);
    expect(
      (temperature[0]!["attributes"] as JSONObject)["lane"],
    ).toBeUndefined();

    expect(rowsNamed(MonitorMetricType.SnmpTransceiverVoltage)).toHaveLength(
      1,
    );
    expect(
      rowsNamed(MonitorMetricType.SnmpTransceiverBiasCurrent),
    ).toHaveLength(2);
    expect(rowsNamed(MonitorMetricType.SnmpTransceiverTxPower)).toHaveLength(
      2,
    );

    // Keyed to the device like every other device series.
    for (const row of rx) {
      expect(row["primaryEntityId"]).toBe(DEVICE_ID.toString());
      expect((row["attributes"] as JSONObject)["deviceName"]).toBe(
        "dc-leaf-1",
      );
    }
  });

  test("each series is described with its unit", async () => {
    await save(walk({ transceivers: [judged(49)], results: [read(49)] }));

    const types: Dictionary<MetricType> = indexedMaps[0]!;

    expect(types[MonitorMetricType.SnmpTransceiverRxPower]!.unit).toBe("dBm");
    expect(types[MonitorMetricType.SnmpTransceiverTxPower]!.unit).toBe("dBm");
    expect(types[MonitorMetricType.SnmpTransceiverTemperature]!.unit).toBe(
      "°C",
    );
    expect(types[MonitorMetricType.SnmpTransceiverVoltage]!.unit).toBe("V");
    expect(types[MonitorMetricType.SnmpTransceiverBiasCurrent]!.unit).toBe(
      "mA",
    );
    expect(types[MonitorMetricType.SnmpTransceiverRxPower]!.description).toBe(
      "Transceiver rx power of a network device port (SFP, SFP+, QSFP)",
    );
  });

  test("an optic that is not detected writes nothing", async () => {
    await save(
      walk({
        transceivers: [
          judged(1, {
            isPresent: false,
            measurements: {},
            health: TransceiverHealth.NotDetected,
          }),
        ],
        results: [],
      }),
    );

    expect(rowsNamed(MonitorMetricType.SnmpTransceiverRxPower)).toEqual([]);
  });

  test("a failed read charts nothing - the stored readings the criteria judge are not new points", async () => {
    await save(walk({ transceivers: [judged(1)], results: undefined }));

    for (const metricName of [
      MonitorMetricType.SnmpTransceiverRxPower,
      MonitorMetricType.SnmpTransceiverTxPower,
      MonitorMetricType.SnmpTransceiverTemperature,
      MonitorMetricType.SnmpTransceiverVoltage,
      MonitorMetricType.SnmpTransceiverBiasCurrent,
    ]) {
      expect(rowsNamed(metricName)).toEqual([]);
    }

    // The rest of the poll is still charted.
    expect(rowsNamed(MonitorMetricType.IsOnline)).toHaveLength(1);
  });

  test("only the optics read on this poll are charted", async () => {
    await save(
      walk({
        transceivers: [judged(1), judged(2)],
        results: [read(2)],
      }),
    );

    expect(
      rowsNamed(MonitorMetricType.SnmpTransceiverTemperature).map(
        (row: JSONObject) => {
          return (row["attributes"] as JSONObject)["interfaceIndex"];
        },
      ),
    ).toEqual(["2"]);
  });

  test("a muted port's optic, pruned from the judged list, is not charted", async () => {
    await save(walk({ transceivers: [], results: [read(1)] }));

    expect(rowsNamed(MonitorMetricType.SnmpTransceiverRxPower)).toEqual([]);
  });

  test(`at most ${NetworkDeviceMetricUtil.maxTransceiverPoints} readings a poll, with a warning`, async () => {
    const warn: jest.SpiedFunction<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    // Eight readings per optic: two lanes of three, plus two module-wide.
    const count: number =
      Math.ceil(NetworkDeviceMetricUtil.maxTransceiverPoints / 8) + 3;
    const indexes: Array<number> = Array.from(
      { length: count },
      (_v: unknown, i: number) => {
        return i + 1;
      },
    );

    await save(
      walk({
        transceivers: indexes.map((index: number) => {
          return judged(index);
        }),
        results: indexes.map((index: number) => {
          return read(index);
        }),
      }),
    );

    const transceiverRows: number = insertedRows.filter((row: JSONObject) => {
      return String(row["name"]).startsWith(
        "oneuptime.monitor.snmp.transceiver.",
      );
    }).length;

    expect(transceiverRows).toBe(NetworkDeviceMetricUtil.maxTransceiverPoints);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      `first ${NetworkDeviceMetricUtil.maxTransceiverPoints} of ${count * 8} transceiver readings`,
    );
  });

  test("getTransceiverAttributes names the port, and the lane when there is one", () => {
    expect(
      NetworkDeviceMetricUtil.getTransceiverAttributes(judged(7), 3),
    ).toEqual({ interfaceIndex: "7", interfaceName: "Et7/1", lane: "3" });
    expect(
      NetworkDeviceMetricUtil.getTransceiverAttributes(
        judged(7, { interfaceName: undefined }),
        undefined,
      ),
    ).toEqual({ interfaceIndex: "7" });
  });

  test("the five metric names live under the SNMP transceiver namespace", () => {
    expect([
      MonitorMetricType.SnmpTransceiverTemperature,
      MonitorMetricType.SnmpTransceiverVoltage,
      MonitorMetricType.SnmpTransceiverBiasCurrent,
      MonitorMetricType.SnmpTransceiverTxPower,
      MonitorMetricType.SnmpTransceiverRxPower,
    ]).toEqual([
      "oneuptime.monitor.snmp.transceiver.temperature",
      "oneuptime.monitor.snmp.transceiver.voltage",
      "oneuptime.monitor.snmp.transceiver.bias.current",
      "oneuptime.monitor.snmp.transceiver.tx.power",
      "oneuptime.monitor.snmp.transceiver.rx.power",
    ]);
  });
});

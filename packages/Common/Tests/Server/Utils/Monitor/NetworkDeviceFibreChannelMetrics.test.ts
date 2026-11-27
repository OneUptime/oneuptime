import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import {
  FIBRE_CHANNEL_COUNTERS,
  FibreChannelCounter,
  FibreChannelCounterValues,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
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
 * A SAN switch port's Fibre Channel counters, per second, as one metric -
 * oneuptime.monitor.snmp.interface.fibre.channel.per.second - with the
 * port and the counter as attributes: what the Interfaces page's Fibre
 * Channel card charts, one counter at a time, one line per port.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function port(
  interfaceIndex: number,
  name: string,
  ratesPerSecond: FibreChannelCounterValues | undefined,
): SnmpInterface {
  return {
    interfaceIndex: interfaceIndex,
    name: name,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    interfaceType: 56,
    fibreChannel: {
      counters: {},
      ...(ratesPerSecond ? { ratesPerSecond: ratesPerSecond } : {}),
    },
  };
}

describe("NetworkDeviceMetricUtil: Fibre Channel counters", () => {
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

  async function save(interfaces: Array<SnmpInterface>): Promise<void> {
    const snmpResponse: SnmpMonitorResponse = {
      isOnline: true,
      responseTimeInMs: 42,
      failureCause: "",
      oidResponses: [],
      interfaces: interfaces,
    };

    await NetworkDeviceMetricUtil.saveWalkMetrics({
      projectId: PROJECT_ID,
      networkDeviceId: DEVICE_ID,
      deviceName: "fabric-b-mds-01",
      probeId: undefined,
      snmpResponse: snmpResponse,
      responseTimeInMs: 42,
      isOnline: true,
    });
  }

  function fibreChannelRows(): Array<JSONObject> {
    return insertedRows.filter((row: JSONObject) => {
      return (
        row["name"] === MonitorMetricType.SnmpInterfaceFibreChannelPerSecond
      );
    });
  }

  function attributesOf(row: JSONObject): JSONObject {
    const attributes: unknown = row["attributes"];

    return (
      typeof attributes === "string" ? JSON.parse(attributes) : attributes
    ) as JSONObject;
  }

  test("one point per port and counter with a rate, named by both", async () => {
    await save([
      port(16785408, "fc1/3", {
        [FibreChannelCounter.CrcErrors]: 2,
        [FibreChannelCounter.InvalidTransmissionWords]: 6,
      }),
      port(16793600, "fc1/5", {
        [FibreChannelCounter.CreditLoss]: 0.05,
      }),
    ]);

    const points: Array<[string, string, string, number]> = fibreChannelRows()
      .map((row: JSONObject): [string, string, string, number] => {
        const attributes: JSONObject = attributesOf(row);

        return [
          attributes["interfaceName"] as string,
          attributes["interfaceIndex"] as string,
          attributes["fibreChannelCounter"] as string,
          row["value"] as number,
        ];
      })
      .sort();

    expect(points).toEqual(
      [
        ["fc1/3", "16785408", FibreChannelCounter.CrcErrors, 2],
        ["fc1/3", "16785408", FibreChannelCounter.InvalidTransmissionWords, 6],
        ["fc1/5", "16793600", FibreChannelCounter.CreditLoss, 0.05],
      ].sort(),
    );
  });

  test("the points carry the device, so the chart can scope to it", async () => {
    await save([port(1, "0/0", { [FibreChannelCounter.CrcErrors]: 1 })]);

    const attributes: JSONObject = attributesOf(fibreChannelRows()[0]!);

    expect(attributes["networkDeviceId"]).toBe(DEVICE_ID.toString());
  });

  test("one description and a per-second unit for the metric, whatever the counter", async () => {
    await save([
      port(1, "0/0", {
        [FibreChannelCounter.CrcErrors]: 1,
        [FibreChannelCounter.Discards]: 2,
      }),
    ]);

    const metricType: MetricType | undefined =
      indexedMaps[0]?.[MonitorMetricType.SnmpInterfaceFibreChannelPerSecond];

    expect(metricType?.description).toMatch(/Fibre Channel/);
    expect(metricType?.unit).toBe("/s");
  });

  test("a port with no rates yet (its first poll) writes nothing", async () => {
    await save([port(1, "0/0", undefined)]);

    expect(fibreChannelRows()).toEqual([]);
  });

  test("an Ethernet port writes no Fibre Channel points", async () => {
    await save([
      {
        interfaceIndex: 2,
        name: "eth0",
        isOperationallyUp: true,
        isAdministrativelyUp: true,
        errorsPerSecond: 3,
      },
    ]);

    expect(fibreChannelRows()).toEqual([]);
  });

  test("a rate that is not a finite number is skipped", async () => {
    await save([
      port(1, "0/0", {
        [FibreChannelCounter.CrcErrors]: NaN,
        [FibreChannelCounter.LinkFailures]: 0,
      }),
    ]);

    expect(
      fibreChannelRows().map((row: JSONObject) => {
        return attributesOf(row)["fibreChannelCounter"];
      }),
    ).toEqual([FibreChannelCounter.LinkFailures]);
  });

  test("a director's worth of ports is capped, not unbounded", async () => {
    const everyCounter: FibreChannelCounterValues = {};

    for (const counter of FIBRE_CHANNEL_COUNTERS) {
      everyCounter[counter] = 1;
    }

    const ports: Array<SnmpInterface> = [];

    for (let index: number = 1; index <= 600; index++) {
      ports.push(port(index, `fc1/${index}`, everyCounter));
    }

    await save(ports);

    expect(fibreChannelRows().length).toBeLessThanOrEqual(
      NetworkDeviceMetricUtil.maxFibreChannelPoints,
    );
    expect(fibreChannelRows().length).toBeGreaterThan(0);
  });
});

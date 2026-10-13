import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SnmpTrapLogWriter from "../../FeatureSet/Telemetry/Services/SnmpTrapLogWriter";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import LogService from "Common/Server/Services/LogService";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrap, {
  SnmpTrapVarbind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * The standard SNMP traps, stored as the network events they are: a
 * linkDown trap and the syslog line a device writes for the same link are
 * both `event.name` = interface.down on the device's log, so a search, a
 * monitor or the Events page finds the link going down however it was
 * reported.
 *
 * Everything a trap's row carried before is still there, under the same
 * keys: the trap criteria of Network Device monitors and saved searches
 * read them.
 */

type MockedFn = jest.Mock;

const PROJECT: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();
const SWITCH: ObjectID = ObjectID.generate();
const SERVICE: ObjectID = ObjectID.generate();

const LINK_DOWN: string = "1.3.6.1.6.3.1.1.5.3";
const LINK_UP: string = "1.3.6.1.6.3.1.1.5.4";
const COLD_START: string = "1.3.6.1.6.3.1.1.5.1";
const WARM_START: string = "1.3.6.1.6.3.1.1.5.2";
const AUTHENTICATION_FAILURE: string = "1.3.6.1.6.3.1.1.5.5";

const RECEIVED_AT: Date = new Date("2026-10-13T10:11:12.000Z");

function switchDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(SWITCH);

  device.projectId = PROJECT;
  device.name = "Core Switch";
  device.hostname = "10.0.0.2";

  return device;
}

function trap(
  trapOid: string,
  varbinds: Array<SnmpTrapVarbind> = [],
): SnmpTrap {
  return {
    sourceIpAddress: "10.0.0.2",
    trapOid: trapOid,
    snmpVersion: "2c",
    receivedAt: RECEIVED_AT,
    varbinds: varbinds,
  };
}

function linkVarbinds(index: number): Array<SnmpTrapVarbind> {
  return [
    { oid: `1.3.6.1.2.1.2.2.1.1.${index}`, value: String(index) },
    { oid: `1.3.6.1.2.1.2.2.1.7.${index}`, value: "1" },
    { oid: `1.3.6.1.2.1.2.2.1.8.${index}`, value: "2" },
  ];
}

let insertedRows: Array<JSONObject> = [];
let findInterface: MockedFn;
let interfaceNamesByIndex: Record<number, string> = {};

beforeEach(() => {
  insertedRows = [];
  interfaceNamesByIndex = { 10101: "GigabitEthernet1/0/1" };

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: SERVICE,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);

  jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ): Promise<void> => {
    insertedRows.push(...rows);
  }) as never);

  findInterface = jest
    .spyOn(NetworkInterfaceService, "findOneBy")
    .mockImplementation((async (data: {
      query: { interfaceIndex: number };
    }): Promise<NetworkInterface | null> => {
      const name: string | undefined =
        interfaceNamesByIndex[data.query.interfaceIndex];

      if (!name) {
        return null;
      }

      const networkInterface: NetworkInterface = new NetworkInterface();

      networkInterface.name = name;

      return networkInterface;
    }) as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function write(snmpTrap: SnmpTrap): Promise<Record<string, unknown>> {
  insertedRows = [];

  await SnmpTrapLogWriter.writeTrapLogRows({
    snmpTrap: snmpTrap,
    probeId: PROBE,
    devices: [switchDevice()],
  });

  expect(insertedRows).toHaveLength(1);

  return (insertedRows[0] as JSONObject)["attributes"] as Record<
    string,
    unknown
  >;
}

describe("a link trap", () => {
  test("is the interface.down event of its device, with everything a trap's row always carried", async () => {
    const snmpTrap: SnmpTrap = trap(LINK_DOWN, linkVarbinds(10101));
    const attributes: Record<string, unknown> = await write(snmpTrap);

    expect(attributes).toEqual({
      "event.domain": "network",
      "event.name": "interface.down",
      "network.interface.name": "GigabitEthernet1/0/1",
      "oneuptime.service.id": SERVICE.toString(),
      "oneuptime.service.name": "Core Switch",
      "snmpTrap.oid": LINK_DOWN,
      "snmpTrap.sourceIp": "10.0.0.2",
      "snmpTrap.version": "2c",
      "snmpTrap.varbindCount": 3,
      "snmpTrap.name": "linkDown",
      "snmpTrap.varbinds": JSON.stringify(snmpTrap.varbinds),
      "probe.id": PROBE.toString(),
      "networkDevice.id": SWITCH.toString(),
      "networkDevice.name": "Core Switch",
    });

    const row: JSONObject = insertedRows[0] as JSONObject;

    expect(row["body"]).toBe(
      `SNMP trap ${LINK_DOWN} (linkDown) received from 10.0.0.2`,
    );
    expect((row["attributeKeys"] as Array<string>).slice().sort()).toEqual(
      Object.keys(attributes).sort(),
    );
  });

  test("the interface's name is looked up by this device and the trap's index, as the server itself", async () => {
    await write(trap(LINK_UP, linkVarbinds(10101)));

    expect(findInterface).toHaveBeenCalledTimes(1);
    expect(findInterface).toHaveBeenCalledWith({
      query: { networkDeviceId: SWITCH, interfaceIndex: 10101 },
      select: { name: true },
      props: { isRoot: true },
    });
  });

  test("linkUp is interface.up, on the same interface name: the pair a monitor resolves on", async () => {
    const down: Record<string, unknown> = await write(
      trap(LINK_DOWN, linkVarbinds(10101)),
    );
    const up: Record<string, unknown> = await write(
      trap(LINK_UP, linkVarbinds(10101)),
    );

    expect(up["event.name"]).toBe("interface.up");
    expect(up["network.interface.name"]).toBe(down["network.interface.name"]);
  });

  test("an interface the device's walk has not recorded is named by its index", async () => {
    const attributes: Record<string, unknown> = await write(
      trap(LINK_DOWN, linkVarbinds(42)),
    );

    expect(attributes["network.interface.name"]).toBe("ifIndex 42");
  });

  test("a trap that names its interface is not looked up at all", async () => {
    const attributes: Record<string, unknown> = await write(
      trap(LINK_DOWN, [
        ...linkVarbinds(10101),
        { oid: "1.3.6.1.2.1.31.1.1.1.1.10101", value: "Gi1/0/1" },
      ]),
    );

    expect(attributes["network.interface.name"]).toBe("Gi1/0/1");
    expect(findInterface).not.toHaveBeenCalled();
  });

  test("a lookup that fails never loses the trap: the interface is named by its index", async () => {
    findInterface.mockRejectedValue(new Error("database is down") as never);

    const attributes: Record<string, unknown> = await write(
      trap(LINK_DOWN, linkVarbinds(10101)),
    );

    expect(attributes["event.name"]).toBe("interface.down");
    expect(attributes["network.interface.name"]).toBe("ifIndex 10101");
  });
});

describe("the other standard traps", () => {
  test("coldStart and warmStart are device.reboot, and nothing is looked up for them", async () => {
    for (const oid of [COLD_START, WARM_START]) {
      const attributes: Record<string, unknown> = await write(trap(oid));

      expect(attributes["event.domain"]).toBe("network");
      expect(attributes["event.name"]).toBe("device.reboot");
      expect(Object.keys(attributes)).not.toContain("network.interface.name");
    }

    expect(findInterface).not.toHaveBeenCalled();
  });

  test("any other trap is stored as it always was, and is no event", async () => {
    for (const oid of [AUTHENTICATION_FAILURE, "1.3.6.1.4.1.9.9.43.2.0.1"]) {
      const attributes: Record<string, unknown> = await write(
        trap(oid, linkVarbinds(10101)),
      );

      expect(Object.keys(attributes)).not.toContain("event.name");
      expect(Object.keys(attributes)).not.toContain("event.domain");
      expect(Object.keys(attributes)).not.toContain("network.interface.name");
      expect(attributes["snmpTrap.oid"]).toBe(oid);
    }

    expect(findInterface).not.toHaveBeenCalled();
  });
});

describe("a varbind cannot stand in for what ingest sets", () => {
  test("an interface named like an attribute key is only ever the interface's name", async () => {
    const attributes: Record<string, unknown> = await write(
      trap(LINK_DOWN, [
        { oid: "1.3.6.1.2.1.31.1.1.1.1.7", value: "networkDevice.id" },
      ]),
    );

    expect(attributes["network.interface.name"]).toBe("networkDevice.id");
    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
    expect(attributes["event.name"]).toBe("interface.down");
  });
});

describe("a trap from an address that is no device", () => {
  test("is the same event, kept for the project and marked as from no device; no interface is looked up", async () => {
    await SnmpTrapLogWriter.writeUnmatchedTrapLogRow({
      snmpTrap: trap(LINK_DOWN, linkVarbinds(10101)),
      probeId: PROBE,
      projectId: PROJECT,
    });

    expect(insertedRows).toHaveLength(1);

    const attributes: Record<string, unknown> = (insertedRows[0] as JSONObject)[
      "attributes"
    ] as Record<string, unknown>;

    expect(attributes["event.name"]).toBe("interface.down");
    expect(attributes["event.domain"]).toBe("network");
    expect(attributes["network.interface.name"]).toBe("ifIndex 10101");
    expect(attributes["snmpTrap.unmatched"]).toBe(true);
    expect(attributes["oneuptime.service.name"]).toBe("network-devices");
    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    expect(findInterface).not.toHaveBeenCalled();
  });
});

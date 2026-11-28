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
import ProjectMilestoneService, {
  ReachMilestoneData,
} from "Common/Server/Services/ProjectMilestoneService";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrap, {
  SnmpTrapVarbind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
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
      "event.kind": "problem",
      "event.category": "interface",
      "event.device": "Core Switch",
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

describe("which device a trap that is an event is about", () => {
  test("is the device's name, on every standard trap", async () => {
    for (const oid of [LINK_DOWN, LINK_UP, COLD_START, WARM_START]) {
      expect(
        (await write(trap(oid, linkVarbinds(10101))))["event.device"],
      ).toBe("Core Switch");
    }
  });

  test("a trap that is no event says nothing of it", async () => {
    expect(
      Object.keys(await write(trap(AUTHENTICATION_FAILURE))),
    ).not.toContain("event.device");
  });

  test("linkDown and linkUp carry the kind a monitor resolves on", async () => {
    expect(await write(trap(LINK_DOWN, linkVarbinds(10101)))).toMatchObject({
      "event.kind": "problem",
      "event.category": "interface",
    });
    expect(await write(trap(LINK_UP, linkVarbinds(10101)))).toMatchObject({
      "event.kind": "recovery",
      "event.category": "interface",
    });
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
    // Known by its address until it is added.
    expect(attributes["event.device"]).toBe("10.0.0.2");
    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    expect(Object.keys(attributes)).not.toContain("networkSite.id");
    expect(findInterface).not.toHaveBeenCalled();
  });

  test("names the site whose default credentials signed it, for Add as device to file it there (#11174)", async () => {
    const site: ObjectID = ObjectID.generate();

    await SnmpTrapLogWriter.writeUnmatchedTrapLogRow({
      snmpTrap: {
        ...trap(COLD_START),
        snmpVersion: "3",
        securityName: "site-default",
        securityLevel: SnmpSecurityLevel.AuthPriv,
      },
      probeId: PROBE,
      projectId: PROJECT,
      siteId: site,
    });

    const attributes: Record<string, unknown> = (insertedRows[0] as JSONObject)[
      "attributes"
    ] as Record<string, unknown>;

    expect(attributes["networkSite.id"]).toBe(site.toString());
    expect(attributes["snmpTrap.unmatched"]).toBe(true);
    expect(attributes["event.name"]).toBe("device.reboot");
  });

  test("never names a site on a device's own row", async () => {
    const attributes: Record<string, unknown> = await write(trap(COLD_START));

    expect(Object.keys(attributes)).not.toContain("networkSite.id");
  });
});

describe("who holds the credential that signed it is how it was matched, never what is kept", () => {
  test("no attribute and no word of the row says it, not even another project's ID", async () => {
    const otherProject: string = "11720000-0000-4000-8000-000000060be8";
    const attributes: Record<string, unknown> = await write({
      ...trap(LINK_DOWN, linkVarbinds(10101)),
      snmpVersion: "3",
      securityName: "san-monitor",
      securityLevel: SnmpSecurityLevel.AuthPriv,
      signedBy: {
        projectIds: [PROJECT.toString(), otherProject],
        deviceIds: [SWITCH.toString()],
        siteIds: [],
      },
    });

    expect(JSON.stringify(insertedRows[0])).not.toContain(otherProject);
    expect(Object.keys(attributes).join(" ")).not.toContain("signedBy");
  });
});

/*
 * A device's traps are in the Logs explorer beside its syslog, so its first
 * trap is the project's first logs (#6897): kept once ClickHouse took the
 * row, never for an insert that failed.
 */
describe("the project's first logs", () => {
  let reached: Array<ReachMilestoneData> = [];

  beforeEach(() => {
    reached = [];
    jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation((data: ReachMilestoneData): void => {
        reached.push(data);
      });
  });

  test("a device's first trap keeps them, once stored", async () => {
    await write(trap(COLD_START));

    expect(insertedRows).toHaveLength(1);
    expect(reached).toEqual([
      {
        projectId: PROJECT.toString(),
        milestone: ActivationMilestone.FirstLogsReceived,
      },
    ]);
  });

  test("so does a trap from an address that is no device yet", async () => {
    await SnmpTrapLogWriter.writeUnmatchedTrapLogRow({
      snmpTrap: trap(WARM_START),
      probeId: PROBE,
      projectId: PROJECT,
    });

    expect(reached).toEqual([
      {
        projectId: PROJECT.toString(),
        milestone: ActivationMilestone.FirstLogsReceived,
      },
    ]);
  });

  test("an insert that failed keeps nothing, and the trap's failure stays the writer's", async () => {
    jest
      .spyOn(LogService, "insertJsonRows")
      .mockImplementation((async (): Promise<void> => {
        throw new Error("ClickHouse is down.");
      }) as never);

    await SnmpTrapLogWriter.writeTrapLogRows({
      snmpTrap: trap(COLD_START),
      probeId: PROBE,
      devices: [switchDevice()],
    });
    await SnmpTrapLogWriter.writeUnmatchedTrapLogRow({
      snmpTrap: trap(COLD_START),
      probeId: PROBE,
      projectId: PROJECT,
    });

    expect(reached).toEqual([]);
  });
});

/*
 * The trap history says what arrived (#11005): an inform says so, and an
 * SNMPv3 trap the user it was authenticated as, its security level, the
 * engine that sent it and its context - beside the OID and the varbinds.
 * Each only when the probe said it, and only as what it can be: a v1 or
 * v2c trap's row is what it always was.
 */
describe("who sent it, and how", () => {
  test("an SNMPv3 authPriv trap names its user, level, engine and context", async () => {
    const attributes: Record<string, unknown> = await write({
      ...trap(LINK_DOWN, linkVarbinds(10101)),
      snmpVersion: "3",
      isInform: false,
      securityName: "san-monitor",
      securityLevel: SnmpSecurityLevel.AuthPriv,
      engineId: "80001F8880D5E4C3B2A1",
      contextName: "vf-128",
    });

    expect(attributes).toMatchObject({
      "snmpTrap.version": "3",
      "snmpTrap.securityName": "san-monitor",
      "snmpTrap.securityLevel": "authPriv",
      "snmpTrap.engineId": "80001F8880D5E4C3B2A1",
      "snmpTrap.contextName": "vf-128",
      "event.name": "interface.down",
    });
    expect(attributes).not.toHaveProperty("snmpTrap.isInform");
    expect(insertedRows[0]!["body"]).toBe(
      `SNMPv3 trap ${LINK_DOWN} (linkDown) received from 10.0.0.2`,
    );
    expect(
      (insertedRows[0]!["attributeKeys"] as Array<string>).slice().sort(),
    ).toEqual(Object.keys(attributes).sort());
  });

  test("an inform says it is one, whatever its version", async () => {
    const v3: Record<string, unknown> = await write({
      ...trap(LINK_UP),
      snmpVersion: "3",
      isInform: true,
      securityName: "san-monitor",
      securityLevel: SnmpSecurityLevel.AuthNoPriv,
    });

    expect(v3["snmpTrap.isInform"]).toBe(true);
    expect(insertedRows[0]!["body"]).toBe(
      `SNMPv3 inform ${LINK_UP} (linkUp) received from 10.0.0.2`,
    );

    const v2c: Record<string, unknown> = await write({
      ...trap(LINK_UP),
      isInform: true,
    });

    expect(v2c["snmpTrap.isInform"]).toBe(true);
    expect(v2c).not.toHaveProperty("snmpTrap.securityName");
    expect(insertedRows[0]!["body"]).toBe(
      `SNMP inform ${LINK_UP} (linkUp) received from 10.0.0.2`,
    );
  });

  test("a community string is never written into the history", async () => {
    const attributes: Record<string, unknown> = await write({
      ...trap(COLD_START),
      community: "s3cr3t-community",
    });

    expect(JSON.stringify(attributes)).not.toContain("s3cr3t-community");
    expect(JSON.stringify(insertedRows)).not.toContain("s3cr3t-community");
  });

  test("each only as what it can be: a sender's values are text from the network", () => {
    expect(
      SnmpTrapLogWriter.getSenderAttributes({
        ...trap(COLD_START),
        snmpVersion: "3",
        isInform: "yes" as unknown as boolean,
        securityName: "evil\u001b[31m-user-name-far-longer-than-snmp-allows",
        securityLevel: "superPriv" as unknown as SnmpSecurityLevel,
        engineId: "<img src=x>",
        contextName: "ctx\u0000name",
      }),
    ).toEqual({
      "snmpTrap.securityName": "evil?[31m-user-name-far-longer-t",
      "snmpTrap.contextName": "ctx?name",
    });
  });

  test("a v2c trap's row gains nothing", () => {
    expect(SnmpTrapLogWriter.getSenderAttributes(trap(COLD_START))).toEqual({});
  });
});

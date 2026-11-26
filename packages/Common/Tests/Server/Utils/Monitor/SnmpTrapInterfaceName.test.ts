import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import SnmpTrapInterfaceName from "../../../../Server/Utils/Monitor/SnmpTrapInterfaceName";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SnmpTrap from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { getSnmpTrapInterfaceLabel } from "../../../../Utils/NetworkEvent/SnmpTrapEvent";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * The interface a trap is about, as an alert's title says it. A link trap
 * that carries only the interface's index (all RFC 2863 asks of it) and an
 * RMON alarm on a port's counter (an MDS port-monitor policy) name it by
 * its ifIndex alone; the server looks the name up in the device's walk,
 * once per device the trap matched - logical switches sharing an address
 * number their interfaces each their own way.
 */

const DEVICE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const FC1_5: number = 0x1000000 + 4 * 0x1000;

function trap(
  trapOid: string,
  varbinds: Array<[string, string]>,
): Pick<SnmpTrap, "trapOid" | "varbinds"> {
  return {
    trapOid: trapOid,
    varbinds: varbinds.map(([oid, value]: [string, string]) => {
      return { oid: oid, value: value };
    }),
  };
}

const LINK_DOWN_BY_INDEX: Pick<SnmpTrap, "trapOid" | "varbinds"> = trap(
  "1.3.6.1.6.3.1.1.5.3",
  [
    [`1.3.6.1.2.1.2.2.1.1.${FC1_5}`, `${FC1_5}`],
    [`1.3.6.1.2.1.2.2.1.7.${FC1_5}`, "1"],
    [`1.3.6.1.2.1.2.2.1.8.${FC1_5}`, "2"],
  ],
);

const CREDIT_LOSS_ALARM: Pick<SnmpTrap, "trapOid" | "varbinds"> = trap(
  "1.3.6.1.2.1.16.29.2.0.1",
  [
    [
      "1.3.6.1.2.1.16.29.1.1.1.1.3.4",
      `1.3.6.1.4.1.9.9.289.1.2.1.1.37.${FC1_5}`,
    ],
  ],
);

describe("SnmpTrapInterfaceName.getInterfaceIndex", () => {
  test("a link trap that names its interface by index alone", () => {
    expect(SnmpTrapInterfaceName.getInterfaceIndex(LINK_DOWN_BY_INDEX)).toBe(
      FC1_5,
    );
  });

  test("an RMON alarm on an interface's counter", () => {
    expect(SnmpTrapInterfaceName.getInterfaceIndex(CREDIT_LOSS_ALARM)).toBe(
      FC1_5,
    );
  });

  test("none for a link trap that names its interface itself, and for any other trap", () => {
    expect(
      SnmpTrapInterfaceName.getInterfaceIndex(
        trap("1.3.6.1.6.3.1.1.5.3", [
          [`1.3.6.1.2.1.2.2.1.1.${FC1_5}`, `${FC1_5}`],
          [`1.3.6.1.2.1.31.1.1.1.1.${FC1_5}`, "fc1/5"],
        ]),
      ),
    ).toBeNull();
    expect(
      SnmpTrapInterfaceName.getInterfaceIndex(
        trap("1.3.6.1.4.1.9.9.294.1.4.0.6", []),
      ),
    ).toBeNull();
    // An alarm on a counter that is not an interface's.
    expect(
      SnmpTrapInterfaceName.getInterfaceIndex(
        trap("1.3.6.1.2.1.16.0.1", [
          ["1.3.6.1.2.1.16.3.1.1.3.1", "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1"],
        ]),
      ),
    ).toBeNull();
  });
});

describe("SnmpTrapInterfaceName.findForDevice", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the name the device's walk recorded for the index, on that device", async () => {
    const findOneBy: SpyInstance<typeof NetworkInterfaceService.findOneBy> =
      jest.spyOn(NetworkInterfaceService, "findOneBy").mockResolvedValue({
        name: " fc1/5 ",
      } as NetworkInterface);

    expect(
      await SnmpTrapInterfaceName.findForDevice({
        trap: LINK_DOWN_BY_INDEX,
        networkDeviceId: DEVICE,
      }),
    ).toBe("fc1/5");

    const query: JSONObject = (
      findOneBy.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;

    expect(query["networkDeviceId"]).toEqual(DEVICE);
    expect(query["interfaceIndex"]).toBe(FC1_5);
  });

  test("no lookup at all for a trap that names no interface by index", async () => {
    const findOneBy: SpyInstance<typeof NetworkInterfaceService.findOneBy> =
      jest.spyOn(NetworkInterfaceService, "findOneBy");

    expect(
      await SnmpTrapInterfaceName.findForDevice({
        trap: trap("1.3.6.1.4.1.9.9.294.1.4.0.6", []),
        networkDeviceId: DEVICE,
      }),
    ).toBeUndefined();
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("an index the walk never saw, or a blank name, is no name", async () => {
    jest.spyOn(NetworkInterfaceService, "findOneBy").mockResolvedValue(null);

    expect(
      await SnmpTrapInterfaceName.findForDevice({
        trap: CREDIT_LOSS_ALARM,
        networkDeviceId: DEVICE,
      }),
    ).toBeUndefined();

    jest
      .spyOn(NetworkInterfaceService, "findOneBy")
      .mockResolvedValue({ name: "  " } as NetworkInterface);

    expect(
      await SnmpTrapInterfaceName.findForDevice({
        trap: CREDIT_LOSS_ALARM,
        networkDeviceId: DEVICE,
      }),
    ).toBeUndefined();
  });

  test("a failed lookup never loses the trap: no name, no throw", async () => {
    jest
      .spyOn(NetworkInterfaceService, "findOneBy")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      SnmpTrapInterfaceName.findForDevice({
        trap: LINK_DOWN_BY_INDEX,
        networkDeviceId: DEVICE,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("getSnmpTrapInterfaceLabel", () => {
  test("the name the trap carries, ifName before ifDescr", () => {
    expect(
      getSnmpTrapInterfaceLabel(
        trap("1.3.6.1.6.3.1.1.5.3", [
          ["1.3.6.1.2.1.2.2.1.2.7", "GigabitEthernet0/7"],
          ["1.3.6.1.2.1.31.1.1.1.1.7", "Gi0/7"],
        ]),
        "known",
      ),
    ).toBe("Gi0/7");
  });

  test("a vendor's link trap with IF-MIB varbinds - Cisco's cieLinkDown", () => {
    expect(
      getSnmpTrapInterfaceLabel(
        trap("1.3.6.1.4.1.9.9.276.0.1", [
          [`1.3.6.1.2.1.2.2.1.1.${FC1_5}`, `${FC1_5}`],
          [`1.3.6.1.2.1.31.1.1.1.1.${FC1_5}`, "fc1/5"],
        ]),
      ),
    ).toBe("fc1/5");
  });

  test("else the name the device's walk knows, else the index", () => {
    expect(getSnmpTrapInterfaceLabel(LINK_DOWN_BY_INDEX, " fc1/5 ")).toBe(
      "fc1/5",
    );
    expect(getSnmpTrapInterfaceLabel(LINK_DOWN_BY_INDEX)).toBe(
      `ifIndex ${FC1_5}`,
    );
  });

  test("nothing for a trap that names no interface", () => {
    expect(
      getSnmpTrapInterfaceLabel(trap("1.3.6.1.4.1.9.9.294.1.4.0.6", [])),
    ).toBe("");
    expect(getSnmpTrapInterfaceLabel(null)).toBe("");
  });
});

describe("{{trapInterface}} in an alert's title", () => {
  function storageMapFor(snmpTrap: Partial<SnmpTrap>): JSONObject {
    const response: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      monitoredAt: new Date("2026-11-26T10:00:00.000Z"),
      snmpTrapResponse: {
        sourceIpAddress: "10.20.0.6",
        snmpVersion: "v2c",
        receivedAt: new Date("2026-11-26T10:00:00.000Z"),
        trapOid: "",
        varbinds: [],
        ...snmpTrap,
      } as SnmpTrap,
    } as ProbeMonitorResponse;

    return MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.NetworkDevice,
      dataToProcess: response,
    });
  }

  test("cieLinkDown names its interface from its own ifName", () => {
    expect(
      storageMapFor({
        trapOid: "1.3.6.1.4.1.9.9.276.0.1",
        varbinds: [
          { oid: `1.3.6.1.2.1.2.2.1.1.${FC1_5}`, value: `${FC1_5}` },
          { oid: `1.3.6.1.2.1.31.1.1.1.1.${FC1_5}`, value: "fc1/5" },
        ],
      })["trapInterface"],
    ).toBe("fc1/5");
  });

  test("a link down by index alone takes the name the server found for it", () => {
    expect(
      storageMapFor({
        trapOid: "1.3.6.1.6.3.1.1.5.3",
        varbinds: [{ oid: `1.3.6.1.2.1.2.2.1.1.${FC1_5}`, value: `${FC1_5}` }],
        interfaceName: "fc1/5",
      })["trapInterface"],
    ).toBe("fc1/5");
  });

  test("a trap about no interface leaves it blank, not a raw placeholder", () => {
    expect(
      storageMapFor({ trapOid: "1.3.6.1.4.1.9.9.294.1.4.0.6" })[
        "trapInterface"
      ],
    ).toBe("");
  });
});

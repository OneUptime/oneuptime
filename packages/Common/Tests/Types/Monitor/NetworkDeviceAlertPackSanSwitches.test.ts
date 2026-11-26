import SnmpMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import MonitorTemplateUtil from "../../../Server/Utils/Monitor/MonitorTemplateUtil";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import { FibreChannelCounter } from "../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * The recommended alerts a SAN switch gets (#11014, #11015): the common
 * pack, with a Fibre Channel errors item in place of "Interface errors",
 * the slow-drain counters, and the fabric's own traps - an inter-switch
 * link down, a fabric segmented, a zone change, a FRU failure, MAPS and
 * port-monitor alarms. Every trap item is checked against a trap shaped as
 * the switch sends it, through the criteria that evaluate it.
 */

function items(vendorTemplateId: string): Array<NetworkDeviceAlertPackItem> {
  return NetworkDeviceAlertPackUtil.getPackItems(
    SnmpVendorTemplateUtil.getById(vendorTemplateId)?.tables,
    vendorTemplateId,
  );
}

function item(vendorTemplateId: string, name: string): NetworkDeviceAlertPackItem {
  const found: NetworkDeviceAlertPackItem | undefined = items(
    vendorTemplateId,
  ).find((candidate: NetworkDeviceAlertPackItem) => {
    return candidate.name === name;
  });

  expect(found).toBeDefined();
  return found!;
}

function names(vendorTemplateId: string | undefined): Array<string> {
  return NetworkDeviceAlertPackUtil.getPackItems(undefined, vendorTemplateId).map(
    (candidate: NetworkDeviceAlertPackItem) => {
      return candidate.name;
    },
  );
}

function trapResponse(trap: Partial<SnmpTrap>): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-11-26T10:00:00.000Z"),
    snmpTrapResponse: {
      sourceIpAddress: "10.20.0.5",
      snmpVersion: "v2c",
      receivedAt: new Date("2026-11-26T10:00:00.000Z"),
      trapOid: "",
      varbinds: [],
      ...trap,
    } as SnmpTrap,
  } as ProbeMonitorResponse;
}

// Whether an item fires for a trap, its filters combined as the item says.
async function fires(
  packItem: NetworkDeviceAlertPackItem,
  response: ProbeMonitorResponse,
): Promise<boolean> {
  const results: Array<string | null> = [];

  for (const filter of packItem.filters) {
    results.push(
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        criteriaFilter: filter,
      }),
    );
  }

  return packItem.filterCondition === FilterCondition.Any
    ? results.some(Boolean)
    : results.every(Boolean);
}

describe("what a SAN switch's pack holds", () => {
  test.each(["brocade-fos", "cisco-mds"])(
    "%s: Fibre Channel port errors in place of Interface errors",
    (id: string) => {
      expect(names(id)).toContain("Fibre Channel port errors");
      expect(names(id)).not.toContain("Interface errors");
      // The rest of the common pack stays.
      expect(names(id)).toContain("Interface down");
    },
  );

  test("no other device's pack changes", () => {
    const common: Array<string> = names(undefined);

    expect(common).toContain("Interface errors");
    expect(common).not.toContain("Fibre Channel port errors");

    for (const other of ["cisco-ios", "juniper-junos", "sophos-sfos", "nope"]) {
      expect(names(other)).toEqual(common);
    }
  });

  test("Fibre Channel port errors: more than once in ten seconds, per port, on SNMP Interface Errors (per second)", () => {
    const filter: CriteriaFilter = item("brocade-fos", "Fibre Channel port errors")
      .filters[0]!;

    expect(filter).toEqual({
      checkOn: CheckOn.SnmpInterfaceErrorsPerSecond,
      filterType: FilterType.GreaterThan,
      value: 0.1,
      snmpMonitorOptions: { interfaceName: "*" },
    });
  });

  test("the slow-drain items compare their own counters, raised once per interface", () => {
    expect(item("cisco-mds", "Credit loss (slow drain)").filters).toEqual([
      {
        checkOn: CheckOn.SnmpFibreChannelCounterPerSecond,
        filterType: FilterType.GreaterThan,
        value: 0,
        snmpMonitorOptions: {
          interfaceName: "*",
          fibreChannelCounter: FibreChannelCounter.CreditLoss,
        },
      },
    ]);
    expect(
      item("cisco-mds", "Timeout discards (slow drain)").filters[0]
        ?.snmpMonitorOptions?.fibreChannelCounter,
    ).toBe(FibreChannelCounter.TimeoutDiscards);
    expect(
      item("brocade-fos", "Fibre Channel frames discarded").filters[0]
        ?.snmpMonitorOptions?.fibreChannelCounter,
    ).toBe(FibreChannelCounter.Discards);
  });

  test("a switch that is not online is an incident; every other SAN item an alert", () => {
    expect(item("brocade-fos", "Switch not online").createIncidents).toBe(true);

    for (const id of ["brocade-fos", "cisco-mds"]) {
      const vendorItems: Array<NetworkDeviceAlertPackItem> =
        NetworkDeviceAlertPackUtil.getVendorAlerts(id)!.items;

      for (const vendorItem of vendorItems) {
        if (vendorItem.name === "Switch not online") {
          continue;
        }

        expect([vendorItem.name, vendorItem.createAlerts]).toEqual([
          vendorItem.name,
          true,
        ]);
        expect(vendorItem.description).toMatch(/\.$/);
      }
    }
  });

  test("the criteria instances carry each item's condition and title", () => {
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        vendorTemplateId: "cisco-mds",
      });
    const portMonitor: MonitorCriteriaInstance | undefined = instances.find(
      (instance: MonitorCriteriaInstance) => {
        return instance.data?.name === "Port monitor alarm";
      },
    );

    expect(portMonitor?.data?.filterCondition).toBe(FilterCondition.Any);
    expect(portMonitor?.data?.alerts[0]?.title).toBe(
      "Port monitor: {{trapAlarmCounter}} {{trapAlarmDirection}} on {{trapInterface}}",
    );

    const errors: MonitorCriteriaInstance | undefined = instances.find(
      (instance: MonitorCriteriaInstance) => {
        return instance.data?.name === "Fibre Channel port errors";
      },
    );

    expect(errors?.data?.filterCondition).toBe(FilterCondition.All);
    expect(errors?.data?.alerts[0]?.title).toBe("Fibre Channel port errors");
  });
});

describe("Brocade Fabric OS traps", () => {
  const SW_TRAPS: string = "1.3.6.1.4.1.1588.2.1.1.1.0";

  test("an E-Port going offline is an inter-switch link down", async () => {
    const islDown: NetworkDeviceAlertPackItem = item(
      "brocade-fos",
      "Inter-switch link down",
    );

    // swFCPortScn: swFCPortOpStatus offline(2), swFCPortPrevType e-port(5).
    expect(
      await fires(
        islDown,
        trapResponse({
          trapOid: `${SW_TRAPS}.3`,
          varbinds: [
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4.5", value: "2" },
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.11.5", value: "4" },
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.1.35.5", value: "5" },
          ],
        }),
      ),
    ).toBe(true);

    // An F-Port to a host going offline is not an ISL.
    expect(
      await fires(
        islDown,
        trapResponse({
          trapOid: `${SW_TRAPS}.3`,
          varbinds: [
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4.1", value: "2" },
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.1.35.1", value: "4" },
          ],
        }),
      ),
    ).toBe(false);

    // An E-Port coming back online is not a link down.
    expect(
      await fires(
        islDown,
        trapResponse({
          trapOid: `${SW_TRAPS}.3`,
          varbinds: [
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4.5", value: "1" },
            { oid: "1.3.6.1.4.1.1588.2.1.1.1.1.35.5", value: "5" },
          ],
        }),
      ),
    ).toBe(false);
  });

  test.each([
    ["Fabric segmented", `${SW_TRAPS}.10`],
    ["Fabric reconfigured", `${SW_TRAPS}.9`],
    ["Zone configuration changed", `${SW_TRAPS}.16`],
    ["MAPS alert", "1.3.6.1.4.1.1588.3.1.4.0.1"],
    ["Field-replaceable unit changed", "1.3.6.1.4.1.1588.2.1.2.2.0.1"],
    ["Field-replaceable unit changed", "1.3.6.1.4.1.1588.2.1.2.2.0.2"],
  ])("%s fires on %s", async (name: string, trapOid: string) => {
    expect(
      await fires(item("brocade-fos", name), trapResponse({ trapOid: trapOid })),
    ).toBe(true);
  });

  test("a trap is only its own item's: a zone change is no FRU failure", async () => {
    const zoneChange: ProbeMonitorResponse = trapResponse({
      trapOid: `${SW_TRAPS}.16`,
    });

    expect(
      await fires(item("brocade-fos", "Field-replaceable unit changed"), zoneChange),
    ).toBe(false);
    expect(await fires(item("brocade-fos", "Fabric segmented"), zoneChange)).toBe(
      false,
    );
  });
});

describe("Cisco MDS traps", () => {
  test.each([
    ["Link down (trap)", "1.3.6.1.6.3.1.1.5.3"],
    ["Link down (trap)", "1.3.6.1.4.1.9.9.276.0.1"],
    ["Module, power supply or fan changed", "1.3.6.1.4.1.9.9.117.2.0.1"],
    ["Module, power supply or fan changed", "1.3.6.1.4.1.9.9.117.2.0.2"],
    ["Module, power supply or fan changed", "1.3.6.1.4.1.9.9.117.2.0.4"],
    ["Module, power supply or fan changed", "1.3.6.1.4.1.9.9.117.2.0.6"],
    ["Zone set activated", "1.3.6.1.4.1.9.9.294.1.4.0.6"],
    ["Zone merge failed", "1.3.6.1.4.1.9.9.294.1.4.0.2"],
    ["VSAN changed", "1.3.6.1.4.1.9.9.282.1.3.0.1"],
    ["VSAN changed", "1.3.6.1.4.1.9.9.282.1.3.0.2"],
    ["Fabric changed", "1.3.6.1.4.1.9.9.302.1.3.0.3"],
    ["Fabric changed", "1.3.6.1.4.1.9.9.302.1.3.0.2"],
    ["Port monitor alarm", "1.3.6.1.2.1.16.0.1"],
    ["Port monitor alarm", "1.3.6.1.2.1.16.0.2"],
    ["Port monitor alarm", "1.3.6.1.2.1.16.29.2.0.1"],
    ["Port monitor alarm", "1.3.6.1.2.1.16.29.2.0.2"],
    ["Port monitor alarm", "1.3.6.1.4.1.9.10.93.2.0.1"],
    ["Port monitor alarm", "1.3.6.1.4.1.9.10.93.2.0.2"],
  ])("%s fires on %s", async (name: string, trapOid: string) => {
    expect(
      await fires(item("cisco-mds", name), trapResponse({ trapOid: trapOid })),
    ).toBe(true);
  });

  test("a port-monitor alarm opens an alert naming the counter and the interface", async () => {
    const FC1_5: number = 0x1000000 + 4 * 0x1000;
    const alarm: ProbeMonitorResponse = trapResponse({
      trapOid: "1.3.6.1.2.1.16.29.2.0.1",
      varbinds: [
        {
          oid: "1.3.6.1.2.1.16.29.1.1.1.1.3.4",
          value: `1.3.6.1.4.1.9.9.289.1.2.1.1.37.${FC1_5}`,
        },
        { oid: "1.3.6.1.2.1.16.29.1.1.1.1.5.4", value: "3" },
        { oid: "1.3.6.1.2.1.16.29.1.1.1.1.8.4", value: "1" },
      ],
      // Filled in by the server from the device's walk.
      interfaceName: "fc1/5",
    });

    const portMonitor: NetworkDeviceAlertPackItem = item(
      "cisco-mds",
      "Port monitor alarm",
    );

    expect(await fires(portMonitor, alarm)).toBe(true);

    const message: string | null =
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: alarm,
        criteriaFilter: portMonitor.filters.find((filter: CriteriaFilter) => {
          return filter.value === "1.3.6.1.2.1.16.29.2.0.1";
        })!,
      });

    expect(message).toBe(
      "Alarm: Credit loss on fc1/5 rose past its threshold (value 3, threshold 1). SNMP trap 1.3.6.1.2.1.16.29.2.0.1 received from 10.20.0.5.",
    );

    const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.NetworkDevice,
      dataToProcess: alarm,
    });

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: portMonitor.title,
        storageMap: storageMap,
      }),
    ).toBe("Port monitor: Credit loss rising on fc1/5");
  });

  test("a port-monitor alarm the device's walk cannot name still names the interface, by MDS numbering", () => {
    const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.NetworkDevice,
      dataToProcess: trapResponse({
        trapOid: "1.3.6.1.2.1.16.0.2",
        varbinds: [
          {
            oid: "1.3.6.1.2.1.16.3.1.1.3.2",
            value: "1.3.6.1.4.1.9.9.289.1.2.1.1.6.16781312",
          },
        ],
      }),
    });

    expect(storageMap["trapInterface"]).toBe("fc1/2");
    expect(storageMap["trapAlarmCounter"]).toBe("Invalid CRCs");
    expect(storageMap["trapAlarmDirection"]).toBe("falling");
  });

  test("a link down trap's title names its interface", () => {
    const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.NetworkDevice,
      dataToProcess: trapResponse({
        trapOid: "1.3.6.1.6.3.1.1.5.3",
        varbinds: [{ oid: "1.3.6.1.2.1.2.2.1.1.16793600", value: "16793600" }],
        interfaceName: "fc1/5",
      }),
    });

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: item("cisco-mds", "Link down (trap)").title,
        storageMap: storageMap,
      }),
    ).toBe("Link down: fc1/5");
    // Not an alarm: its variables are empty, never a raw placeholder.
    expect(storageMap["trapAlarmCounter"]).toBe("");
  });

  test("a trap from another maker's arc fires no MDS item but its own", async () => {
    const brocadeZone: ProbeMonitorResponse = trapResponse({
      trapOid: "1.3.6.1.4.1.1588.2.1.1.1.0.16",
    });

    for (const mdsItem of NetworkDeviceAlertPackUtil.getVendorAlerts(
      "cisco-mds",
    )!.items) {
      if (
        mdsItem.filters.every((filter: CriteriaFilter) => {
          return filter.checkOn === CheckOn.SnmpTrapReceived;
        })
      ) {
        expect(await fires(mdsItem, brocadeZone)).toBe(false);
      }
    }
  });
});

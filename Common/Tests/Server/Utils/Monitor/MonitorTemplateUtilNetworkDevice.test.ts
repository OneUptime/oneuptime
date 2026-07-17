import { describe, expect, test } from "@jest/globals";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpTrap from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpDataType from "../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The MonitorType.NetworkDevice branch of buildTemplateStorageMap defines the
 * template-variable surface incident/alert titles can reference for SNMP
 * monitors ("{{downInterfaces.0.name}} on {{sysName}} is down"). These tests
 * pin that surface: the admin-up convention behind the interface counts,
 * the {name, alias, interfaceIndex} shape of downInterfaces, empty-string
 * defaulting of the system-group identity fields (and the guard protecting a
 * user's custom OID named sysName), and the trap payload appearing only on
 * trap-triggered checks.
 */

function buildResponse(options?: {
  snmp?: Partial<SnmpMonitorResponse> | undefined;
  trap?: SnmpTrap | undefined;
}): ProbeMonitorResponse {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 25,
    failureCause: "",
    oidResponses: [],
    ...options?.snmp,
  };

  const response: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-07-16T12:00:00.000Z"),
    isOnline: true,
    snmpResponse: snmpResponse,
  } as ProbeMonitorResponse;

  if (options?.trap) {
    response.snmpTrapResponse = options.trap;
  }

  return response;
}

function buildMap(response: ProbeMonitorResponse): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.NetworkDevice,
    dataToProcess: response,
  });
}

function iface(overrides: Partial<SnmpInterface>): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    ...overrides,
  };
}

describe("MonitorTemplateUtil.buildTemplateStorageMap — NetworkDevice base fields", () => {
  test("online status, timing and failure fields come from the SNMP response", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          responseTimeInMs: 42,
          failureCause: "timed out",
          isTimeout: true,
        },
      }),
    );

    expect(map["isOnline"]).toBe(true);
    expect(map["responseTimeInMs"]).toBe(42);
    expect(map["failureCause"]).toBe("timed out");
    expect(map["isTimeout"]).toBe(true);
  });

  test("OID responses are exposed both as a list and by name", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          oidResponses: [
            {
              oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
              name: "cpuLoad",
              value: 37,
              type: SnmpDataType.Integer,
            },
          ],
        },
      }),
    );

    expect(map["oidResponses"]).toEqual([
      {
        oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
        name: "cpuLoad",
        value: 37,
        type: SnmpDataType.Integer,
      },
    ]);
    expect(map["cpuLoad"]).toBe(37);
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — interface walk variables", () => {
  test("downInterfaces contains only admin-up interfaces that are oper-down", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          interfaces: [
            iface({ interfaceIndex: 1, name: "Gi0/1" }),
            iface({
              interfaceIndex: 2,
              name: "Gi0/2",
              alias: "uplink-to-core",
              isOperationallyUp: false,
            }),
            /*
             * Administratively disabled: intentionally down, must never be
             * reported as a failure in templates.
             */
            iface({
              interfaceIndex: 3,
              name: "Gi0/3",
              isAdministrativelyUp: false,
              isOperationallyUp: false,
            }),
          ],
        },
      }),
    );

    expect(map["downInterfaces"]).toEqual([
      {
        name: "Gi0/2",
        alias: "uplink-to-core",
        interfaceIndex: 2,
      },
    ]);
  });

  test("a down interface with no alias renders alias as an empty string", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          interfaces: [
            iface({
              interfaceIndex: 4,
              name: "Gi0/4",
              isOperationallyUp: false,
            }),
          ],
        },
      }),
    );

    expect(map["downInterfaces"]).toEqual([
      { name: "Gi0/4", alias: "", interfaceIndex: 4 },
    ]);
  });

  test("counts follow the admin-up convention (admin-down is neither up nor down)", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          interfaces: [
            iface({ interfaceIndex: 1 }), // admin-up, oper-up
            iface({ interfaceIndex: 2, isOperationallyUp: false }), // admin-up, oper-down
            iface({
              interfaceIndex: 3,
              isAdministrativelyUp: false,
              isOperationallyUp: false,
            }), // admin-down
            iface({ interfaceIndex: 4 }), // admin-up, oper-up
          ],
        },
      }),
    );

    expect(map["interfacesTotal"]).toBe(4);
    expect(map["interfacesUp"]).toBe(2);
    expect(map["interfacesDown"]).toBe(1);
    // Sanity: the admin-down interface is excluded from both up and down.
    expect(
      (map["interfacesUp"] as number) + (map["interfacesDown"] as number),
    ).toBeLessThan(map["interfacesTotal"] as number);
  });

  test("all interfaces healthy yields an empty downInterfaces list", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          interfaces: [
            iface({ interfaceIndex: 1 }),
            iface({ interfaceIndex: 2 }),
          ],
        },
      }),
    );

    expect(map["interfacesDown"]).toBe(0);
    expect(map["downInterfaces"]).toEqual([]);
  });

  test("a check without an interface walk exposes no interface variables", () => {
    const map: JSONObject = buildMap(buildResponse());

    expect(map).not.toHaveProperty("interfacesTotal");
    expect(map).not.toHaveProperty("interfacesUp");
    expect(map).not.toHaveProperty("interfacesDown");
    expect(map).not.toHaveProperty("downInterfaces");
  });

  test("an empty interface walk exposes no interface variables either", () => {
    const map: JSONObject = buildMap(
      buildResponse({ snmp: { interfaces: [] } }),
    );

    expect(map).not.toHaveProperty("interfacesTotal");
    expect(map).not.toHaveProperty("downInterfaces");
  });

  test("interfaceWalkFailure passes through when the walk failed", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: { interfaceWalkFailure: "ifTable walk timed out" },
      }),
    );

    expect(map["interfaceWalkFailure"]).toBe("ifTable walk timed out");
  });

  test("interfaceWalkFailure is absent when the walk succeeded", () => {
    const map: JSONObject = buildMap(buildResponse());

    expect(map).not.toHaveProperty("interfaceWalkFailure");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — system identity variables", () => {
  test("sysName/sysDescr/sysObjectId/sysLocation come from the system group", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          systemInfo: {
            sysName: "core-sw-01",
            sysDescr: "Cisco IOS Software",
            sysObjectId: "1.3.6.1.4.1.9.1.1208",
            sysLocation: "rack 12",
          },
        },
      }),
    );

    expect(map["sysName"]).toBe("core-sw-01");
    expect(map["sysDescr"]).toBe("Cisco IOS Software");
    expect(map["sysObjectId"]).toBe("1.3.6.1.4.1.9.1.1208");
    expect(map["sysLocation"]).toBe("rack 12");
  });

  /*
   * Missing fields default to "" so a template renders blank instead of a
   * raw {{sysLocation}} placeholder.
   */
  test("fields the device did not report default to empty strings", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          systemInfo: { sysName: "core-sw-01" },
        },
      }),
    );

    expect(map["sysName"]).toBe("core-sw-01");
    expect(map["sysDescr"]).toBe("");
    expect(map["sysObjectId"]).toBe("");
    expect(map["sysLocation"]).toBe("");
  });

  test("no systemInfo at all leaves the identity variables off the map", () => {
    const map: JSONObject = buildMap(buildResponse());

    expect(map).not.toHaveProperty("sysName");
    expect(map).not.toHaveProperty("sysDescr");
  });

  /*
   * A user may already expose a custom OID named "sysName". When the walked
   * system group has no sysName of its own, the empty-string defaulting must
   * not clobber the user's value.
   */
  test("an unreported field never clobbers a custom OID of the same name", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          oidResponses: [
            {
              oid: "1.3.6.1.2.1.1.5.0",
              name: "sysName",
              value: "name-from-custom-oid",
              type: SnmpDataType.OctetString,
            },
          ],
          systemInfo: { sysLocation: "rack 12" },
        },
      }),
    );

    expect(map["sysName"]).toBe("name-from-custom-oid");
    expect(map["sysLocation"]).toBe("rack 12");
  });

  test("a value the walk did collect takes precedence over the custom OID", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          oidResponses: [
            {
              oid: "1.3.6.1.2.1.1.5.0",
              name: "sysName",
              value: "name-from-custom-oid",
              type: SnmpDataType.OctetString,
            },
          ],
          systemInfo: { sysName: "name-from-system-group" },
        },
      }),
    );

    expect(map["sysName"]).toBe("name-from-system-group");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — trap payload", () => {
  const trap: SnmpTrap = {
    sourceIpAddress: "10.0.0.7",
    trapOid: "1.3.6.1.6.3.1.1.5.3", // linkDown
    snmpVersion: "2c",
    receivedAt: new Date("2026-07-16T11:59:00.000Z"),
    varbinds: [
      { oid: "1.3.6.1.2.1.2.2.1.1.2", value: "2" },
      { oid: "1.3.6.1.2.1.2.2.1.7.2", value: "1" },
    ],
  };

  test("trap variables are present on a trap-triggered check", () => {
    const map: JSONObject = buildMap(buildResponse({ trap: trap }));

    expect(map["trapOid"]).toBe("1.3.6.1.6.3.1.1.5.3");
    expect(map["trapSourceIp"]).toBe("10.0.0.7");
    expect(map["trapVarbinds"]).toEqual([
      { oid: "1.3.6.1.2.1.2.2.1.1.2", value: "2" },
      { oid: "1.3.6.1.2.1.2.2.1.7.2", value: "1" },
    ]);
  });

  test("trap variables are absent on a scheduled poll", () => {
    const map: JSONObject = buildMap(buildResponse());

    expect(map).not.toHaveProperty("trapOid");
    expect(map).not.toHaveProperty("trapSourceIp");
    expect(map).not.toHaveProperty("trapVarbinds");
  });

  test("a trap-triggered check keeps its poll variables alongside the trap payload", () => {
    const map: JSONObject = buildMap(
      buildResponse({
        snmp: {
          systemInfo: { sysName: "core-sw-01" },
        },
        trap: trap,
      }),
    );

    expect(map["sysName"]).toBe("core-sw-01");
    expect(map["trapOid"]).toBe("1.3.6.1.6.3.1.1.5.3");
  });
});

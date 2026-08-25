import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  isImportableDiscoveredHost,
  monitoringMethodForDiscoveredHost,
} from "Common/Utils/NetworkDiscovery/DiscoveryImportEligibility";

describe("isImportableDiscoveredHost", () => {
  test("host that answered SNMP is importable", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      sysName: "switch-01",
      snmpReachable: true,
    };
    expect(isImportableDiscoveredHost(host)).toBe(true);
  });

  test("ping-only host is importable too, as a monitor-backed device", () => {
    /*
     * This used to be refused. A ping-only host is a real box on the
     * network — issue #3023 is what excluding it looks like from the
     * outside: "devices I monitor manually don't appear in the topology".
     */
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.42",
      snmpReachable: false,
    };
    expect(isImportableDiscoveredHost(host)).toBe(true);
  });

  test("legacy host without the field (undefined) stays importable", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.9",
      sysName: "legacy-router",
    };
    expect(isImportableDiscoveredHost(host)).toBe(true);
    expect(
      isImportableDiscoveredHost({
        ipAddress: "10.0.0.10",
        snmpReachable: undefined,
      }),
    ).toBe(true);
  });
});

describe("monitoringMethodForDiscoveredHost", () => {
  test("an SNMP responder imports as an SNMP-polled device", () => {
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.5",
        snmpReachable: true,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Snmp);
  });

  test("a ping-only host imports as monitor-backed", () => {
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.42",
        snmpReachable: false,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Monitor);
  });

  test("a legacy row with no field imports as SNMP, not monitor-backed", () => {
    /*
     * Every host on a scan stored before the field existed answered SNMP —
     * ping-only sweeps did not exist yet. Reading undefined as ping-only
     * would retroactively strip those devices of their polling.
     */
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.9",
        sysName: "legacy-router",
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Snmp);
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.10",
        snmpReachable: undefined,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Snmp);
  });

  test("only snmpReachable decides — every other field is ignored", () => {
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.12",
        isAlreadyRegistered: true,
        sysDescr: "Some host",
        snmpReachable: false,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Monitor);
  });
});

import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  isImportableDiscoveredHost,
  isPingOnlyDiscoveredHost,
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

  test("ping-only host is importable too, as a device the probe pings", () => {
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
  test("an SNMP responder imports as a Probe device", () => {
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.5",
        snmpReachable: true,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("a ping-only host imports as a Probe device too, not monitor-backed", () => {
    /*
     * The scan's probe just proved the host answers ping, and pinging is all
     * a probe-polled device needs to have a status. The monitor-backed
     * import — no probe, polling off, "Pending" until a Ping monitor was
     * hand-bound (issue #3447) — is gone.
     */
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.42",
        snmpReachable: false,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("a legacy row with no field imports as a Probe device", () => {
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.9",
        sysName: "legacy-router",
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.10",
        snmpReachable: undefined,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("no field on the host can make it Monitor", () => {
    expect(
      monitoringMethodForDiscoveredHost({
        ipAddress: "10.0.0.12",
        isAlreadyRegistered: true,
        sysDescr: "Some host",
        snmpReachable: false,
      }),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });
});

describe("isPingOnlyDiscoveredHost", () => {
  /*
   * The question the method used to answer, and the one that still tells
   * the Review dialog's two groups apart: a ping-only host imports with no
   * credentials and is pinged by the scan's probe; an SNMP host imports with
   * the credential set that answered it.
   */
  test("an SNMP responder is not ping-only", () => {
    expect(
      isPingOnlyDiscoveredHost({ ipAddress: "10.0.0.5", snmpReachable: true }),
    ).toBe(false);
  });

  test("an explicit snmpReachable === false is ping-only", () => {
    expect(
      isPingOnlyDiscoveredHost({
        ipAddress: "10.0.0.42",
        snmpReachable: false,
      }),
    ).toBe(true);
  });

  test("a legacy row with no field is not ping-only", () => {
    /*
     * Every host on a scan stored before the field existed answered SNMP —
     * ping-only sweeps did not exist yet. Reading undefined as ping-only
     * would strip those devices of the scan's credentials on import.
     */
    expect(
      isPingOnlyDiscoveredHost({
        ipAddress: "10.0.0.9",
        sysName: "legacy-router",
      }),
    ).toBe(false);
    expect(
      isPingOnlyDiscoveredHost({
        ipAddress: "10.0.0.10",
        snmpReachable: undefined,
      }),
    ).toBe(false);
  });

  test("only snmpReachable decides — every other field is ignored", () => {
    expect(
      isPingOnlyDiscoveredHost({
        ipAddress: "10.0.0.12",
        isAlreadyRegistered: true,
        sysDescr: "Some host",
        snmpReachable: false,
      }),
    ).toBe(true);
  });
});

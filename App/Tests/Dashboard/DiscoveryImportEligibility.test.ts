import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { isImportableDiscoveredHost } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImportEligibility";

describe("isImportableDiscoveredHost", () => {
  test("host that answered SNMP is importable", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      sysName: "switch-01",
      snmpReachable: true,
    };
    expect(isImportableDiscoveredHost(host)).toBe(true);
  });

  test("ping-only host (snmpReachable === false) is NOT importable", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.42",
      snmpReachable: false,
    };
    expect(isImportableDiscoveredHost(host)).toBe(false);
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

  test("eligibility ignores every other field — only snmpReachable matters", () => {
    // Already-registered is handled separately by the Discovery page.
    expect(
      isImportableDiscoveredHost({
        ipAddress: "10.0.0.11",
        isAlreadyRegistered: true,
        snmpReachable: true,
      }),
    ).toBe(true);
    expect(
      isImportableDiscoveredHost({
        ipAddress: "10.0.0.12",
        isAlreadyRegistered: false,
        sysDescr: "Some host",
        snmpReachable: false,
      }),
    ).toBe(false);
  });
});

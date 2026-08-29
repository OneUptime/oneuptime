import {
  isImportableDiscoveredHost,
  monitoringMethodForDiscoveredHost,
} from "../../../Utils/NetworkDiscovery/DiscoveryImportEligibility";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import type { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";

/*
 * monitoringMethodForDiscoveredHost is the single decision, shared by the
 * dashboard's Review dialog and the server-side auto-import rule engine, for
 * HOW a discovered host imports. The two must never disagree: the group a
 * host is shown under and the method a rule imports it with are the same call.
 *
 * The one subtlety it guards (issue #3023 / legacy scans): only an EXPLICIT
 * snmpReachable === false is ping-only. undefined means a legacy scan row from
 * before the field existed, where every host answered SNMP, so it must read as
 * SNMP — not Monitor. And a nullish host must not throw, because a single junk
 * element in the jsonb array used to take the whole page down from a table cell.
 */

function host(
  overrides: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return { ipAddress: "10.0.0.1", ...overrides } as DiscoveredNetworkDevice;
}

describe("monitoringMethodForDiscoveredHost", () => {
  test("an explicit snmpReachable === false is a monitor-backed device", () => {
    expect(
      monitoringMethodForDiscoveredHost(host({ snmpReachable: false })),
    ).toBe(NetworkDeviceMonitoringMethod.Monitor);
  });

  test("snmpReachable === true is an SNMP device", () => {
    expect(
      monitoringMethodForDiscoveredHost(host({ snmpReachable: true })),
    ).toBe(NetworkDeviceMonitoringMethod.Snmp);
  });

  test("undefined snmpReachable (legacy scan) reads as SNMP, not Monitor", () => {
    expect(monitoringMethodForDiscoveredHost(host({}))).toBe(
      NetworkDeviceMonitoringMethod.Snmp,
    );
    expect(
      monitoringMethodForDiscoveredHost(host({ snmpReachable: undefined })),
    ).toBe(NetworkDeviceMonitoringMethod.Snmp);
  });

  test("a null host reads as SNMP rather than throwing", () => {
    expect(monitoringMethodForDiscoveredHost(null)).toBe(
      NetworkDeviceMonitoringMethod.Snmp,
    );
  });

  test("an undefined host reads as SNMP rather than throwing", () => {
    expect(monitoringMethodForDiscoveredHost(undefined)).toBe(
      NetworkDeviceMonitoringMethod.Snmp,
    );
  });
});

describe("isImportableDiscoveredHost", () => {
  test("every alive discovered host is importable", () => {
    expect(isImportableDiscoveredHost(host({ snmpReachable: true }))).toBe(
      true,
    );
    expect(isImportableDiscoveredHost(host({ snmpReachable: false }))).toBe(
      true,
    );
    expect(isImportableDiscoveredHost(host({}))).toBe(true);
  });
});

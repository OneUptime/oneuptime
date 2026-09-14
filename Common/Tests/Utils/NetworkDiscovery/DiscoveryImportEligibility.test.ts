import {
  isImportableDiscoveredHost,
  isPingOnlyDiscoveredHost,
  monitoringMethodForDiscoveredHost,
} from "../../../Utils/NetworkDiscovery/DiscoveryImportEligibility";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import type { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";

/*
 * The two decisions, shared by the dashboard's Review dialog and the
 * server-side auto-import rule engine, for HOW a discovered host imports.
 * The two must never disagree: the group a host is shown under and the
 * device a rule imports it as are the same call.
 *
 * Under ping-first polling every host imports as a Probe device — the scan's
 * probe pings it, and walks it over SNMP when it has credentials — so
 * `monitoringMethodForDiscoveredHost` has one answer for every input, and the
 * host-level question that still matters is `isPingOnlyDiscoveredHost`:
 * whether the host carries the scan's credentials or none.
 *
 * The one subtlety that predicate guards (issue #3023 / legacy scans): only an
 * EXPLICIT snmpReachable === false is ping-only. undefined means a legacy scan
 * row from before the field existed, where every host answered SNMP, so it
 * must read as an SNMP host. And a nullish host must not throw, because a
 * single junk element in the jsonb array used to take the whole page down from
 * a table cell.
 */

function host(
  overrides: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return { ipAddress: "10.0.0.1", ...overrides } as DiscoveredNetworkDevice;
}

describe("monitoringMethodForDiscoveredHost", () => {
  /*
   * Ping-only hosts used to import as monitor-backed devices with no probe
   * and polling off, and sat on "Pending" until an operator hand-bound a
   * Ping monitor (issue #3447). Reachability is a built-in capability of
   * every probe-polled device now, so the host the probe just pinged is a
   * Probe device like any other.
   */
  test("an explicit snmpReachable === false is a Probe device, not a monitor-backed one", () => {
    expect(
      monitoringMethodForDiscoveredHost(host({ snmpReachable: false })),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("snmpReachable === true is a Probe device", () => {
    expect(
      monitoringMethodForDiscoveredHost(host({ snmpReachable: true })),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("undefined snmpReachable (legacy scan) is a Probe device", () => {
    expect(monitoringMethodForDiscoveredHost(host({}))).toBe(
      NetworkDeviceMonitoringMethod.Probe,
    );
    expect(
      monitoringMethodForDiscoveredHost(host({ snmpReachable: undefined })),
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("a null host reads as Probe rather than throwing", () => {
    expect(monitoringMethodForDiscoveredHost(null)).toBe(
      NetworkDeviceMonitoringMethod.Probe,
    );
  });

  test("an undefined host reads as Probe rather than throwing", () => {
    expect(monitoringMethodForDiscoveredHost(undefined)).toBe(
      NetworkDeviceMonitoringMethod.Probe,
    );
  });

  /*
   * Discovery never has grounds to choose the Monitor override: every host it
   * offers was reached by the probe that found it. Stated as a sweep over
   * every shape the field can take, so a future "return Monitor when X"
   * cannot creep back in on one branch.
   */
  test("never answers Monitor, whatever the host looks like", () => {
    const hosts: Array<DiscoveredNetworkDevice | null | undefined> = [
      host({ snmpReachable: false }),
      host({ snmpReachable: true }),
      host({}),
      host({ snmpReachable: false, isAlreadyRegistered: true }),
      null,
      undefined,
    ];

    for (const candidate of hosts) {
      expect(monitoringMethodForDiscoveredHost(candidate)).not.toBe(
        NetworkDeviceMonitoringMethod.Monitor,
      );
    }
  });
});

describe("isPingOnlyDiscoveredHost", () => {
  test("an explicit snmpReachable === false is ping-only", () => {
    expect(isPingOnlyDiscoveredHost(host({ snmpReachable: false }))).toBe(true);
  });

  test("snmpReachable === true is an SNMP host", () => {
    expect(isPingOnlyDiscoveredHost(host({ snmpReachable: true }))).toBe(false);
  });

  test("undefined snmpReachable (legacy scan) reads as an SNMP host, not ping-only", () => {
    /*
     * Every host on a scan stored before the field existed answered SNMP —
     * ping-only sweeps did not exist yet. Reading undefined as ping-only
     * would strip those devices of the scan's credentials on import.
     */
    expect(isPingOnlyDiscoveredHost(host({}))).toBe(false);
    expect(isPingOnlyDiscoveredHost(host({ snmpReachable: undefined }))).toBe(
      false,
    );
  });

  test("a nullish host reads as an SNMP host rather than throwing", () => {
    expect(isPingOnlyDiscoveredHost(null)).toBe(false);
    expect(isPingOnlyDiscoveredHost(undefined)).toBe(false);
  });

  test("only snmpReachable decides — every other field is ignored", () => {
    expect(
      isPingOnlyDiscoveredHost(
        host({
          isAlreadyRegistered: true,
          sysDescr: "Some host",
          sysName: "named-anyway",
          snmpReachable: false,
        }),
      ),
    ).toBe(true);
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

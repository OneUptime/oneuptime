import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  NetworkDeviceDiscoveredDetails,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import {
  DiscoveredDeviceScanSource,
  buildNetworkDeviceFromDiscoveredHost,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { getNetworkDeviceAssetFacts } from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";

/*
 * A device imported from a discovery scan starts with what the scan read
 * about it, as its discovered details (issue #5185): its SNMP system group,
 * its reverse-DNS and NetBIOS names, and that the scan found it - credited to
 * the scan by id and name, at the time the scan read it. So a host that
 * answered ping only reads its maker, OS and location from the moment it is
 * imported, instead of "Unknown" for what the scan already knew; and nothing
 * of it is ever written into the device's own SNMP columns, which are its
 * poll's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SCAN_ID: string = "33333333-3333-4333-8333-333333333333";
const STARTED_AT: Date = new Date("2026-10-23T08:50:00.000Z");
const COMPLETED_AT: Date = new Date("2026-10-23T09:00:00.000Z");

function scan(
  overrides: Partial<DiscoveredDeviceScanSource> = {},
): DiscoveredDeviceScanSource {
  return {
    _id: SCAN_ID,
    name: "Store subnets",
    cidr: "10.20.12.0/24",
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    probeId: PROBE_ID,
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    useShortDeviceNames: false,
    ...overrides,
  };
}

function build(
  host: DiscoveredNetworkDevice,
  scanSource: DiscoveredDeviceScanSource = scan(),
): NetworkDevice {
  return buildNetworkDeviceFromDiscoveredHost({
    projectId: PROJECT_ID,
    host: host,
    scan: scanSource,
  });
}

const SNMP_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.20.12.7",
  sysName: "edge-sw-07",
  sysDescr:
    "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8, RELEASE SOFTWARE (fc3)",
  sysObjectId: "1.3.6.1.4.1.9.1.1208",
  sysLocation: "Store 12, back office rack",
  dnsHostname: "edge-sw-07.store-12.acme.example",
  snmpReachable: true,
};

const PING_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.20.12.30",
  dnsHostname: "kds-03.store-12.acme.example",
  netbiosName: "WB0012KDS03",
  snmpReachable: false,
};

describe("an imported device starts with what its scan read", () => {
  test("an SNMP host: its system group, its PTR name, and the scan that found it", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(build(SNMP_HOST).discoveredDetails);

    expect(details.values.sysName?.value).toBe("edge-sw-07");
    expect(details.values.sysObjectId?.value).toBe("1.3.6.1.4.1.9.1.1208");
    expect(details.values.sysLocation?.value).toBe(
      "Store 12, back office rack",
    );
    expect(details.values.dnsName?.value).toBe(
      "edge-sw-07.store-12.acme.example",
    );
    expect(details.foundBy).toEqual({
      readBy: { type: "discoveryScan", id: SCAN_ID, name: "Store subnets" },
      readAt: COMPLETED_AT.toISOString(),
    });
  });

  test("a ping-only host: its names, and nothing of SNMP", () => {
    const device: NetworkDevice = build(PING_HOST);
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(device.discoveredDetails);

    expect(details.values.netbiosName?.value).toBe("WB0012KDS03");
    expect(details.values.dnsName?.value).toBe("kds-03.store-12.acme.example");
    expect(details.values.sysDescr).toBeUndefined();
    expect(details.foundBy?.readBy.id).toBe(SCAN_ID);
  });

  test("never in the device's own SNMP columns: those are its poll's", () => {
    const device: NetworkDevice = build(SNMP_HOST);

    expect(device.sysName).toBeUndefined();
    expect(device.sysDescr).toBeUndefined();
    expect(device.sysObjectId).toBeUndefined();
    expect(device.sysLocation).toBeUndefined();
    expect(device.vendor).toBeUndefined();
  });

  test("so the imported device reads its maker, OS and location before its first walk", () => {
    const device: NetworkDevice = build(SNMP_HOST);

    expect(getNetworkDeviceAssetFacts(device)).toMatchObject({
      hostname: "edge-sw-07",
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS",
      osVersion: "15.2(7)E8",
      location: "Store 12, back office rack",
      deviceType: "Switch",
    });
  });

  test("a scan without a name is credited under its target", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(
        build(SNMP_HOST, scan({ name: undefined })).discoveredDetails,
      );

    expect(details.foundBy?.readBy.name).toBe("10.20.12.0/24");
  });

  test("a host from a scan still sweeping is dated by its run's start", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(
        build(
          SNMP_HOST,
          scan({
            // The previous run's end, left on the row while this run sweeps.
            completedAt: new Date("2026-10-22T09:00:00.000Z"),
            startedAt: STARTED_AT,
          }),
        ).discoveredDetails,
      );

    expect(details.foundBy?.readAt).toBe(STARTED_AT.toISOString());
  });

  test("a scan with no id or no time to credit: no discovered details", () => {
    expect(build(SNMP_HOST, scan({ _id: undefined })).discoveredDetails).toBe(
      undefined,
    );
    expect(
      build(SNMP_HOST, scan({ completedAt: undefined, startedAt: undefined }))
        .discoveredDetails,
    ).toBeUndefined();
  });
});

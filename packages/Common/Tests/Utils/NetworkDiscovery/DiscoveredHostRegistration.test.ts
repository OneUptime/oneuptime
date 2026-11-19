import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "../../../Types/ObjectID";
import {
  AmbiguousAddressReason,
  DeviceAtAddressLike,
  NoDeviceReason,
  SeenDeviceReason,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import {
  DISCOVERED_HOST_REGISTRATION_FIELDS,
  getSharedAddress,
  hasStoredRegistration,
  withRegistration,
  withoutRegistration,
} from "../../../Utils/NetworkDiscovery/DiscoveredHostRegistration";
import { describe, expect, it } from "@jest/globals";

/*
 * WHETHER A SCAN'S HOST IS A DEVICE: WORKED OUT ON EVERY READ, NEVER STORED
 * (OneUptime issues #9905, #9906).
 *
 * The probe's report keeps none of it (withoutRegistration), and a read sets
 * all of it from the inventory (withRegistration), with why a host at an
 * address several devices share is the device it is, or a device that
 * cannot be named (getSharedAddress).
 */

const ROUTER_A: string = "d0000000-0000-4000-8000-00000000000a";
const ROUTER_B: string = "d0000000-0000-4000-8000-00000000000b";
const ROUTER_C: string = "d0000000-0000-4000-8000-00000000000c";

function at(...ids: Array<string>): Array<DeviceAtAddressLike> {
  return ids.map((id: string): DeviceAtAddressLike => {
    return { id: id };
  });
}

describe("withoutRegistration", () => {
  it("drops every field only a read works out, and keeps the rest as reported", () => {
    const reported: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      sysName: "core-1",
      snmpReachable: true,
      snmpConfigId: "config-core",
      dnsHostname: "core-1.example.test",
      isAlreadyRegistered: true,
      registeredDeviceId: ROUTER_A,
      sharedAddress: {
        deviceCount: 2,
        seenReason: SeenDeviceReason.PolledByTheProbes,
      },
    };

    expect(withoutRegistration(reported)).toEqual({
      ipAddress: "10.0.0.5",
      sysName: "core-1",
      snmpReachable: true,
      snmpConfigId: "config-core",
      dnsHostname: "core-1.example.test",
    });
  });

  it("copies, never changes the host it is handed", () => {
    const reported: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      isAlreadyRegistered: false,
    };

    const kept: DiscoveredNetworkDevice = withoutRegistration(reported);

    expect(kept).not.toBe(reported);
    expect(reported).toEqual({
      ipAddress: "10.0.0.5",
      isAlreadyRegistered: false,
    });
  });

  it("hands back a row that is no host as it is", () => {
    for (const row of [null, undefined, 42, "10.0.0.5", true]) {
      expect(withoutRegistration(row)).toBe(row);
    }

    const list: Array<unknown> = [{ isAlreadyRegistered: true }];
    expect(withoutRegistration(list)).toBe(list);
  });

  it("names the three fields, so the ingest and the read agree", () => {
    expect([...DISCOVERED_HOST_REGISTRATION_FIELDS].sort()).toEqual([
      "isAlreadyRegistered",
      "registeredDeviceId",
      "sharedAddress",
    ]);
  });
});

describe("hasStoredRegistration", () => {
  it("says whether a row carries any of the fields, set or not", () => {
    expect(hasStoredRegistration({ ipAddress: "10.0.0.5" })).toBe(false);
    expect(
      hasStoredRegistration({
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: false,
      }),
    ).toBe(true);
    expect(
      hasStoredRegistration({
        ipAddress: "10.0.0.5",
        sharedAddress: undefined,
      }),
    ).toBe(true);
    expect(hasStoredRegistration(null)).toBe(false);
    expect(hasStoredRegistration("10.0.0.5")).toBe(false);
  });
});

describe("getSharedAddress", () => {
  it("says nothing of an address one device has", () => {
    expect(
      getSharedAddress({
        seen: {
          kind: "device",
          device: { id: ROUTER_A },
          reason: SeenDeviceReason.PolledByTheProbes,
        },
        devicesAtAddress: at(ROUTER_A),
      }),
    ).toBeUndefined();
  });

  it("says how the probe told which of several devices the host is", () => {
    expect(
      getSharedAddress({
        seen: {
          kind: "device",
          device: { id: ROUTER_A },
          reason: SeenDeviceReason.OnlyOneInTheirSites,
        },
        devicesAtAddress: at(ROUTER_A, ROUTER_B, ROUTER_C),
      }),
    ).toEqual({
      deviceCount: 3,
      seenReason: SeenDeviceReason.OnlyOneInTheirSites,
    });
  });

  it("counts a device read twice, or in another case, once", () => {
    expect(
      getSharedAddress({
        seen: {
          kind: "device",
          device: { id: ROUTER_A },
          reason: SeenDeviceReason.PolledByTheProbes,
        },
        devicesAtAddress: at(ROUTER_A, ROUTER_A.toUpperCase()),
      }),
    ).toBeUndefined();
  });

  it("names the devices the probe cannot tell apart, and why, in the order read", () => {
    expect(
      getSharedAddress({
        seen: {
          kind: "ambiguous",
          devices: [
            { id: new ObjectID(ROUTER_B) },
            { id: ROUTER_A },
            { id: ROUTER_B.toUpperCase() },
          ],
          reason: AmbiguousAddressReason.PollSeveral,
        },
        devicesAtAddress: at(ROUTER_A, ROUTER_B, ROUTER_C),
      }),
    ).toEqual({
      deviceCount: 3,
      ambiguousReason: AmbiguousAddressReason.PollSeveral,
      ambiguousDeviceIds: [ROUTER_B, ROUTER_A],
    });
  });

  it("counts two devices at least when it cannot tell them apart", () => {
    expect(
      getSharedAddress({
        seen: {
          kind: "ambiguous",
          devices: [{ id: ROUTER_A }, { id: ROUTER_B }],
          reason: AmbiguousAddressReason.ReachUnknown,
        },
        devicesAtAddress: [],
      }),
    ).toEqual({
      deviceCount: 2,
      ambiguousReason: AmbiguousAddressReason.ReachUnknown,
      ambiguousDeviceIds: [ROUTER_A, ROUTER_B],
    });
  });

  it("says nothing when the probe sees none of them, or nothing was seen", () => {
    expect(
      getSharedAddress({
        seen: { kind: "none", reason: NoDeviceReason.NoneInTheirSites },
        devicesAtAddress: at(ROUTER_A, ROUTER_B),
      }),
    ).toBeUndefined();
    expect(
      getSharedAddress({ seen: undefined, devicesAtAddress: at(ROUTER_A) }),
    ).toBeUndefined();
  });
});

describe("withRegistration", () => {
  const STORED: DiscoveredNetworkDevice = {
    ipAddress: "10.0.0.5",
    sysName: "core-1",
    isAlreadyRegistered: true,
    registeredDeviceId: ROUTER_C,
    sharedAddress: {
      deviceCount: 5,
      ambiguousReason: AmbiguousAddressReason.ReachUnknown,
      ambiguousDeviceIds: [ROUTER_C],
    },
  };

  it("a host the probe sees as one device names it, with why when the address is shared", () => {
    expect(
      withRegistration(STORED, {
        isAlreadyRegistered: true,
        deviceId: ROUTER_A,
        sharedAddress: {
          deviceCount: 2,
          seenReason: SeenDeviceReason.PolledByTheProbes,
        },
      }),
    ).toEqual({
      ipAddress: "10.0.0.5",
      sysName: "core-1",
      isAlreadyRegistered: true,
      registeredDeviceId: ROUTER_A,
      sharedAddress: {
        deviceCount: 2,
        seenReason: SeenDeviceReason.PolledByTheProbes,
      },
    });
  });

  it("a host of devices the probe cannot tell apart is a device, named by none", () => {
    expect(
      withRegistration(STORED, {
        isAlreadyRegistered: true,
        sharedAddress: {
          deviceCount: 2,
          ambiguousReason: AmbiguousAddressReason.SeveralInTheirSites,
          ambiguousDeviceIds: [ROUTER_A, ROUTER_B],
        },
      }),
    ).toEqual({
      ipAddress: "10.0.0.5",
      sysName: "core-1",
      isAlreadyRegistered: true,
      sharedAddress: {
        deviceCount: 2,
        ambiguousReason: AmbiguousAddressReason.SeveralInTheirSites,
        ambiguousDeviceIds: [ROUTER_A, ROUTER_B],
      },
    });
  });

  it("a new host says it is not a device, and keeps nothing a stored row said", () => {
    const read: DiscoveredNetworkDevice = withRegistration(STORED, {
      isAlreadyRegistered: false,
      // An explanation for a host that is not a device is never shown.
      sharedAddress: {
        deviceCount: 2,
        seenReason: SeenDeviceReason.PolledByTheProbes,
      },
    });

    expect(read).toEqual({
      ipAddress: "10.0.0.5",
      sysName: "core-1",
      isAlreadyRegistered: false,
    });
    expect(Object.keys(read)).not.toContain("registeredDeviceId");
    expect(Object.keys(read)).not.toContain("sharedAddress");
  });

  it("a named device is a device, whatever else it is told", () => {
    expect(
      withRegistration(
        { ipAddress: "10.0.0.5" },
        { isAlreadyRegistered: false, deviceId: ROUTER_A },
      ),
    ).toEqual({
      ipAddress: "10.0.0.5",
      isAlreadyRegistered: true,
      registeredDeviceId: ROUTER_A,
    });
  });

  it("never changes the host it is handed", () => {
    const stored: DiscoveredNetworkDevice = { ...STORED };

    withRegistration(stored, { isAlreadyRegistered: false });

    expect(stored).toEqual(STORED);
  });
});

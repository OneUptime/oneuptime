import EndpointUplinkInferenceUtil, {
  InferredUplink,
  MAX_MACS_ON_ACCESS_PORT,
  UplinkInferenceDeviceInput,
  UplinkInferenceEndpointInput,
  UplinkInferenceResult,
  UplinkRefusal,
} from "../../../Utils/Monitor/EndpointUplinkInferenceUtil";
import DeviceReachabilityUtil from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkEndpointAttachmentSource from "../../../Types/NetworkDevice/NetworkEndpointAttachmentSource";

const NOW: Date = new Date("2024-06-01T12:00:00.000Z");

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

/*
 * Every switch below polls every five minutes unless a test says otherwise,
 * and DeviceReachabilityUtil.getStaleWindowInMinutes(5) is
 * max(5 * 10, 60) = 60 minutes. These two dates sit either side of that.
 */
const FRESH: Date = minutesAgo(5);
const STALE: Date = minutesAgo(600);

const aSwitch: (
  id: string,
  overrides?: Partial<UplinkInferenceDeviceInput>,
) => UplinkInferenceDeviceInput = (
  id: string,
  overrides?: Partial<UplinkInferenceDeviceInput>,
): UplinkInferenceDeviceInput => {
  return {
    id: id,
    siteId: "site-1",
    monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
    collectEndpoints: true,
    pollingIntervalInMinutes: 5,
    ...overrides,
  };
};

// A monitor-backed device: the ICMP-only box this feature exists to place.
const aTill: (
  id: string,
  overrides?: Partial<UplinkInferenceDeviceInput>,
) => UplinkInferenceDeviceInput = (
  id: string,
  overrides?: Partial<UplinkInferenceDeviceInput>,
): UplinkInferenceDeviceInput => {
  return {
    id: id,
    siteId: "site-1",
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    ...overrides,
  };
};

/*
 * A NetworkEndpoint row that would place a device on switch-1 port 12: an
 * FDB attachment a walk confirmed five minutes ago. Every refusal test below
 * breaks exactly one field of it.
 */
const anEndpoint: (
  id: string,
  overrides?: Partial<UplinkInferenceEndpointInput>,
) => UplinkInferenceEndpointInput = (
  id: string,
  overrides?: Partial<UplinkInferenceEndpointInput>,
): UplinkInferenceEndpointInput => {
  return {
    id: id,
    macAddress: "aa:bb:cc:dd:ee:01",
    attachedNetworkDeviceId: "switch-1",
    attachedInterfaceIndex: 12,
    attachedPortName: "Gi1/0/12",
    attachmentSource: NetworkEndpointAttachmentSource.Fdb,
    attachmentLastSeenAt: FRESH,
    ipAddressLastSeenAt: FRESH,
    ...overrides,
  };
};

const inferFrom: (
  devices: Array<UplinkInferenceDeviceInput>,
  endpoints: Array<UplinkInferenceEndpointInput>,
) => UplinkInferenceResult = (
  devices: Array<UplinkInferenceDeviceInput>,
  endpoints: Array<UplinkInferenceEndpointInput>,
): UplinkInferenceResult => {
  return EndpointUplinkInferenceUtil.infer({
    devices: devices,
    endpoints: endpoints,
    now: NOW,
  });
};

const reasonsOf: (result: UplinkInferenceResult) => Array<string> = (
  result: UplinkInferenceResult,
): Array<string> => {
  return result.refusals.map((refusal: UplinkRefusal) => {
    return refusal.reason;
  });
};

describe("EndpointUplinkInferenceUtil.infer - placing a device", () => {
  it("places a device whose hostname is the IPv4 literal an endpoint row carries", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("switch-1"), aTill("till-1", { hostname: "10.18.166.51" })],
      [
        anEndpoint("endpoint-1", {
          ipAddress: "10.18.166.51",
          vlanId: 20,
        }),
      ],
    );

    expect(result.uplinks).toEqual([
      {
        endpointId: "endpoint-1",
        deviceId: "till-1",
        switchDeviceId: "switch-1",
        switchInterfaceIndex: 12,
        switchPortName: "Gi1/0/12",
        vlanId: 20,
        macAddress: "aa:bb:cc:dd:ee:01",
        ipAddress: "10.18.166.51",
        lastSeenAt: FRESH,
        matchedOn: "ip",
      },
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.promotedEndpointIds).toEqual(new Set<string>(["endpoint-1"]));
  });

  it("places a device by an interface MAC, whatever spelling either side uses", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-1", {
          hostname: "till-01.branch.example.com",
          macAddresses: ["AA-BB-CC-DD-EE-01"],
        }),
      ],
      [anEndpoint("endpoint-1", { macAddress: "aabb.ccdd.ee01" })],
    );

    expect(result.uplinks).toEqual([
      {
        endpointId: "endpoint-1",
        deviceId: "till-1",
        switchDeviceId: "switch-1",
        switchInterfaceIndex: 12,
        switchPortName: "Gi1/0/12",
        vlanId: undefined,
        macAddress: "aabb.ccdd.ee01",
        ipAddress: undefined,
        lastSeenAt: FRESH,
        matchedOn: "mac",
      },
    ]);
    expect(result.refusals).toEqual([]);
  });

  it("prefers the MAC match when the row's IP would name a different device", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-mac", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
        aTill("till-ip", { hostname: "10.0.0.7" }),
      ],
      [anEndpoint("endpoint-1", { ipAddress: "10.0.0.7" })],
    );

    expect(result.uplinks.length).toBe(1);
    expect(result.uplinks[0]?.deviceId).toBe("till-mac");
    expect(result.uplinks[0]?.matchedOn).toBe("mac");
    // The device the weaker key pointed at is simply not placed.
    expect(result.refusals).toEqual([
      { deviceId: "till-ip", reason: "noEndpointMatch" },
    ]);
  });

  it("reports nothing for a device that was placed despite an earlier refused row", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aSwitch("router-1"),
        aTill("till-1", {
          macAddresses: ["aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:02"],
        }),
      ],
      [
        /*
         * MAC-sorted, so the router's ARP row is walked FIRST and refused for
         * till-1 before the switch's FDB row places it.
         */
        anEndpoint("endpoint-arp", {
          macAddress: "aa:bb:cc:dd:ee:01",
          attachedNetworkDeviceId: "router-1",
          attachedInterfaceIndex: 100,
          attachedPortName: "Vlan10",
          attachmentSource: NetworkEndpointAttachmentSource.Arp,
        }),
        anEndpoint("endpoint-fdb", { macAddress: "aa:bb:cc:dd:ee:02" }),
      ],
    );

    expect(result.uplinks.length).toBe(1);
    expect(result.uplinks[0]?.deviceId).toBe("till-1");
    expect(result.uplinks[0]?.endpointId).toBe("endpoint-fdb");
    expect(result.refusals).toEqual([]);
  });
});

describe("EndpointUplinkInferenceUtil.infer - refusal reasons", () => {
  it("refuses with endpointCollectionOff when no device in the site reads MAC tables", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1", { collectEndpoints: false }),
        aTill("till-1", { hostname: "10.0.0.5" }),
      ],
      [],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      { deviceId: "till-1", reason: "endpointCollectionOff" },
    ]);
  });

  it("refuses with noMatchableAddress for a DNS hostname and no known MAC", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("switch-1"), aTill("till-1", { hostname: "till.example.com" })],
      [anEndpoint("endpoint-1", { ipAddress: "10.0.0.5" })],
    );

    expect(result.refusals).toEqual([
      { deviceId: "till-1", reason: "noMatchableAddress" },
    ]);
  });

  it("refuses with deviceHasNoSite when the device is unfiled and others are sited", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1", { siteId: "site-1" }),
        aTill("till-1", { siteId: undefined, hostname: "10.0.0.5" }),
      ],
      /*
       * A row that carries the address exists - it just belongs to a site the
       * unfiled device can never be correlated within.
       */
      [anEndpoint("endpoint-1", { ipAddress: "10.0.0.5" })],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      { deviceId: "till-1", reason: "deviceHasNoSite" },
    ]);
  });

  it("matches an unsited device fine when nothing in the project has a site", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1", { siteId: undefined }),
        aTill("till-1", { siteId: undefined, hostname: "10.0.0.5" }),
      ],
      [anEndpoint("endpoint-1", { ipAddress: "10.0.0.5" })],
    );

    expect(result.uplinks.length).toBe(1);
    expect(result.uplinks[0]?.deviceId).toBe("till-1");
    expect(result.uplinks[0]?.switchDeviceId).toBe("switch-1");
    expect(result.refusals).toEqual([]);
  });

  it("refuses with noEndpointMatch when collection is on but no row carries the address", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("switch-1"), aTill("till-1", { hostname: "10.0.0.5" })],
      [anEndpoint("endpoint-1", { ipAddress: "10.0.0.9" })],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      { deviceId: "till-1", reason: "noEndpointMatch" },
    ]);
  });

  it("refuses with arpOnlyAttachment for a row a router's ARP table wrote", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("router-1"), aTill("till-1", { hostname: "10.0.0.5" })],
      [
        anEndpoint("endpoint-1", {
          ipAddress: "10.0.0.5",
          attachedNetworkDeviceId: "router-1",
          attachedInterfaceIndex: 100,
          attachedPortName: "Vlan10",
          attachmentSource: NetworkEndpointAttachmentSource.Arp,
        }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "arpOnlyAttachment",
        endpointId: "endpoint-1",
        switchDeviceId: "router-1",
      },
    ]);
  });

  it("refuses a row with no recorded provenance as attachmentSourceUnknown, not arpOnlyAttachment", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("switch-1"), aTill("till-1", { hostname: "10.0.0.5" })],
      [
        anEndpoint("endpoint-1", {
          ipAddress: "10.0.0.5",
          attachmentSource: undefined,
        }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "attachmentSourceUnknown",
        endpointId: "endpoint-1",
        switchDeviceId: "switch-1",
      },
    ]);
    expect(reasonsOf(result)).not.toContain("arpOnlyAttachment");
  });

  it("refuses with attachmentStale when nothing re-confirmed the port lately", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-1", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
      ],
      [anEndpoint("endpoint-1", { attachmentLastSeenAt: STALE })],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "attachmentStale",
        endpointId: "endpoint-1",
        switchDeviceId: "switch-1",
      },
    ]);
  });

  it("refuses with ipBindingStale when the matched address is not re-confirmed", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("switch-1"), aTill("till-1", { hostname: "10.0.0.5" })],
      [
        anEndpoint("endpoint-1", {
          ipAddress: "10.0.0.5",
          attachmentLastSeenAt: FRESH,
          ipAddressLastSeenAt: STALE,
        }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "ipBindingStale",
        endpointId: "endpoint-1",
        switchDeviceId: "switch-1",
      },
    ]);
  });

  it("does not refuse a MAC match for a stale IP binding", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-1", {
          hostname: "10.0.0.5",
          macAddresses: ["aa:bb:cc:dd:ee:01"],
        }),
      ],
      [
        anEndpoint("endpoint-1", {
          ipAddress: "10.0.0.5",
          attachmentLastSeenAt: FRESH,
          ipAddressLastSeenAt: STALE,
        }),
      ],
    );

    expect(result.uplinks.length).toBe(1);
    expect(result.uplinks[0]?.matchedOn).toBe("mac");
    expect(result.refusals).toEqual([]);
  });

  it("refuses with transitPort when the port carries more MACs than an access port may", () => {
    const portRows: Array<UplinkInferenceEndpointInput> = Array.from(
      { length: MAX_MACS_ON_ACCESS_PORT + 1 },
      (_value: unknown, index: number): UplinkInferenceEndpointInput => {
        return anEndpoint(`endpoint-${index}`, {
          macAddress: `aa:bb:cc:dd:ee:0${index + 1}`,
        });
      },
    );

    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-1", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
      ],
      portRows,
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "transitPort",
        endpointId: "endpoint-0",
        switchDeviceId: "switch-1",
        portMacCount: MAX_MACS_ON_ACCESS_PORT + 1,
      },
    ]);
  });

  it("refuses both devices with portHasMultipleDevices when two resolve to one port", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-a", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
        aTill("till-b", { macAddresses: ["aa:bb:cc:dd:ee:02"] }),
      ],
      [
        anEndpoint("endpoint-a", { macAddress: "aa:bb:cc:dd:ee:01" }),
        anEndpoint("endpoint-b", { macAddress: "aa:bb:cc:dd:ee:02" }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-a",
        reason: "portHasMultipleDevices",
        endpointId: "endpoint-a",
        switchDeviceId: "switch-1",
        portMacCount: 2,
      },
      {
        deviceId: "till-b",
        reason: "portHasMultipleDevices",
        endpointId: "endpoint-b",
        switchDeviceId: "switch-1",
        portMacCount: 2,
      },
    ]);
  });

  it("refuses with ambiguous when two devices in a site claim one hostname", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-a", { hostname: "10.0.0.5" }),
        aTill("till-b", { hostname: "10.0.0.5" }),
      ],
      [anEndpoint("endpoint-1", { ipAddress: "10.0.0.5" })],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      { deviceId: "till-a", reason: "ambiguous" },
      { deviceId: "till-b", reason: "ambiguous" },
    ]);
  });

  it("refuses with ambiguous when two endpoint rows claim one address", () => {
    const result: UplinkInferenceResult = inferFrom(
      [aSwitch("switch-1"), aTill("till-1", { hostname: "10.0.0.5" })],
      [
        anEndpoint("endpoint-1", {
          macAddress: "aa:bb:cc:dd:ee:01",
          ipAddress: "10.0.0.5",
        }),
        anEndpoint("endpoint-2", {
          macAddress: "aa:bb:cc:dd:ee:02",
          ipAddress: "10.0.0.5",
          attachedInterfaceIndex: 13,
          attachedPortName: "Gi1/0/13",
        }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      { deviceId: "till-1", reason: "ambiguous" },
    ]);
  });

  it("refuses with ambiguous when two rows on different switches resolve to one device", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aSwitch("switch-2"),
        aTill("till-1", {
          hostname: "10.0.0.5",
          macAddresses: ["aa:bb:cc:dd:ee:01"],
        }),
      ],
      [
        // The MAC still in switch-1's FDB after a re-patch...
        anEndpoint("endpoint-mac", { macAddress: "aa:bb:cc:dd:ee:01" }),
        // ...and the address answering on switch-2.
        anEndpoint("endpoint-ip", {
          macAddress: "bb:bb:cc:dd:ee:02",
          ipAddress: "10.0.0.5",
          attachedNetworkDeviceId: "switch-2",
          attachedInterfaceIndex: 3,
          attachedPortName: "Gi1/0/3",
        }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "ambiguous",
        endpointId: "endpoint-mac",
        switchDeviceId: "switch-1",
      },
    ]);
  });

  it("refuses with selfAttachment when the matched row hangs off the device itself", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-1", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
      ],
      [anEndpoint("endpoint-1", { attachedNetworkDeviceId: "till-1" })],
    );

    expect(result.uplinks).toEqual([]);
    expect(result.refusals).toEqual([
      {
        deviceId: "till-1",
        reason: "selfAttachment",
        endpointId: "endpoint-1",
      },
    ]);
  });

  it("infers nothing at all when the endpoint list was truncated", () => {
    const devices: Array<UplinkInferenceDeviceInput> = [
      aSwitch("switch-1"),
      aTill("till-b", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
      aTill("till-a", { hostname: "10.0.0.5" }),
    ];
    const endpoints: Array<UplinkInferenceEndpointInput> = [
      anEndpoint("endpoint-1", { ipAddress: "10.0.0.5" }),
    ];

    // The same data without the cap places a device, so the cap is what differs.
    expect(inferFrom(devices, endpoints).uplinks.length).toBe(1);

    const result: UplinkInferenceResult = EndpointUplinkInferenceUtil.infer({
      devices: devices,
      endpoints: endpoints,
      now: NOW,
      isEndpointListTruncated: true,
    });

    expect(result.uplinks).toEqual([]);
    expect(result.promotedEndpointIds).toEqual(new Set<string>());
    expect(result.refusals).toEqual([
      { deviceId: "till-a", reason: "endpointListTruncated" },
      { deviceId: "till-b", reason: "endpointListTruncated" },
    ]);
  });
});

describe("EndpointUplinkInferenceUtil.infer - scoping and correctness", () => {
  it("resolves the same address to the right device in each site, never across them", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-a", { siteId: "site-a" }),
        aSwitch("switch-b", { siteId: "site-b" }),
        aTill("till-a", { siteId: "site-a", hostname: "10.0.0.42" }),
        aTill("till-b", { siteId: "site-b", hostname: "10.0.0.42" }),
      ],
      [
        anEndpoint("endpoint-a", {
          macAddress: "aa:bb:cc:dd:ee:0a",
          ipAddress: "10.0.0.42",
          attachedNetworkDeviceId: "switch-a",
          attachedInterfaceIndex: 1,
          attachedPortName: "Gi1/0/1",
        }),
        anEndpoint("endpoint-b", {
          macAddress: "bb:bb:cc:dd:ee:0b",
          ipAddress: "10.0.0.42",
          attachedNetworkDeviceId: "switch-b",
          attachedInterfaceIndex: 2,
          attachedPortName: "Gi1/0/2",
        }),
      ],
    );

    expect(
      result.uplinks.map((uplink: InferredUplink) => {
        return {
          deviceId: uplink.deviceId,
          switchDeviceId: uplink.switchDeviceId,
          endpointId: uplink.endpointId,
        };
      }),
    ).toEqual([
      {
        deviceId: "till-a",
        switchDeviceId: "switch-a",
        endpointId: "endpoint-a",
      },
      {
        deviceId: "till-b",
        switchDeviceId: "switch-b",
        endpointId: "endpoint-b",
      },
    ]);
    expect(result.refusals).toEqual([]);
  });

  it("never places an SNMP device, including one whose method is unset", () => {
    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aSwitch("device-snmp", { hostname: "10.0.0.5" }),
        aSwitch("device-legacy", {
          hostname: "10.0.0.6",
          monitoringMethod: undefined,
        }),
      ],
      [
        anEndpoint("endpoint-snmp", {
          macAddress: "aa:bb:cc:dd:ee:01",
          ipAddress: "10.0.0.5",
        }),
        anEndpoint("endpoint-legacy", {
          macAddress: "aa:bb:cc:dd:ee:02",
          ipAddress: "10.0.0.6",
          attachedInterfaceIndex: 13,
          attachedPortName: "Gi1/0/13",
        }),
      ],
    );

    expect(result.uplinks).toEqual([]);
    // Not candidates at all, so not something to report as unplaced either.
    expect(result.refusals).toEqual([]);
  });

  it("suppresses the refusal for a device that already has a link", () => {
    const devices: Array<UplinkInferenceDeviceInput> = [
      aSwitch("switch-1"),
      aTill("till-1", { hostname: "10.0.0.5" }),
      aTill("till-2", { hostname: "10.0.0.6" }),
    ];

    expect(reasonsOf(inferFrom(devices, []))).toEqual([
      "noEndpointMatch",
      "noEndpointMatch",
    ]);

    const result: UplinkInferenceResult = EndpointUplinkInferenceUtil.infer({
      devices: devices,
      endpoints: [],
      now: NOW,
      alreadyLinkedDeviceIds: new Set<string>(["till-1"]),
    });

    expect(result.refusals).toEqual([
      { deviceId: "till-2", reason: "noEndpointMatch" },
    ]);
  });

  it("scales the freshness window with the attaching switch's poll interval", () => {
    /*
     * getStaleWindowInMinutes is max(interval * 10, 60), so a five-minute
     * switch allows 60 minutes and a four-hour one allows 2400. A row
     * confirmed 90 minutes ago falls on opposite sides of those two.
     */
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(5)).toBe(60);
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(240)).toBe(2400);

    const ninetyMinutesAgo: Date = minutesAgo(90);

    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-fast", { pollingIntervalInMinutes: 5 }),
        aSwitch("switch-slow", { pollingIntervalInMinutes: 240 }),
        aTill("till-fast", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
        aTill("till-slow", { macAddresses: ["bb:bb:cc:dd:ee:02"] }),
      ],
      [
        anEndpoint("endpoint-fast", {
          macAddress: "aa:bb:cc:dd:ee:01",
          attachedNetworkDeviceId: "switch-fast",
          attachmentLastSeenAt: ninetyMinutesAgo,
        }),
        anEndpoint("endpoint-slow", {
          macAddress: "bb:bb:cc:dd:ee:02",
          attachedNetworkDeviceId: "switch-slow",
          attachmentLastSeenAt: ninetyMinutesAgo,
        }),
      ],
    );

    expect(result.uplinks.length).toBe(1);
    expect(result.uplinks[0]?.deviceId).toBe("till-slow");
    expect(result.uplinks[0]?.switchDeviceId).toBe("switch-slow");
    expect(result.refusals).toEqual([
      {
        deviceId: "till-fast",
        reason: "attachmentStale",
        endpointId: "endpoint-fast",
        switchDeviceId: "switch-fast",
      },
    ]);
  });

  it("counts only live attachments towards a port's occupancy", () => {
    const staleRows: Array<UplinkInferenceEndpointInput> = Array.from(
      { length: 20 },
      (_value: unknown, index: number): UplinkInferenceEndpointInput => {
        return anEndpoint(`endpoint-stale-${index}`, {
          macAddress: `bb:bb:cc:dd:ee:${(index + 16).toString(16)}`,
          attachmentLastSeenAt: STALE,
        });
      },
    );

    const result: UplinkInferenceResult = inferFrom(
      [
        aSwitch("switch-1"),
        aTill("till-1", { macAddresses: ["aa:bb:cc:dd:ee:01"] }),
      ],
      [...staleRows, anEndpoint("endpoint-live")],
    );

    expect(result.uplinks.length).toBe(1);
    expect(result.uplinks[0]?.endpointId).toBe("endpoint-live");
    expect(result.refusals).toEqual([]);
  });

  it("produces identical output however the input arrays are ordered", () => {
    const devices: Array<UplinkInferenceDeviceInput> = [
      aSwitch("switch-a", { siteId: "site-a" }),
      aSwitch("switch-b", { siteId: "site-b" }),
      aTill("till-a", { siteId: "site-a", hostname: "10.0.0.42" }),
      aTill("till-b", { siteId: "site-b", hostname: "10.0.0.42" }),
      aTill("till-arp", {
        siteId: "site-a",
        macAddresses: ["cc:cc:cc:cc:cc:01"],
      }),
      aTill("till-lost", { siteId: "site-a", hostname: "10.0.0.99" }),
    ];

    const endpoints: Array<UplinkInferenceEndpointInput> = [
      anEndpoint("endpoint-a", {
        macAddress: "aa:bb:cc:dd:ee:0a",
        ipAddress: "10.0.0.42",
        attachedNetworkDeviceId: "switch-a",
        attachedInterfaceIndex: 1,
        attachedPortName: "Gi1/0/1",
      }),
      anEndpoint("endpoint-b", {
        macAddress: "bb:bb:cc:dd:ee:0b",
        ipAddress: "10.0.0.42",
        attachedNetworkDeviceId: "switch-b",
        attachedInterfaceIndex: 2,
        attachedPortName: "Gi1/0/2",
      }),
      anEndpoint("endpoint-arp", {
        macAddress: "cc:cc:cc:cc:cc:01",
        attachedNetworkDeviceId: "switch-a",
        attachedInterfaceIndex: 100,
        attachedPortName: "Vlan10",
        attachmentSource: NetworkEndpointAttachmentSource.Arp,
      }),
    ];

    const forward: UplinkInferenceResult = inferFrom(devices, endpoints);
    const shuffled: UplinkInferenceResult = inferFrom(
      [...devices].reverse(),
      [...endpoints].reverse(),
    );

    expect(forward.uplinks.length).toBe(2);
    expect(reasonsOf(forward)).toEqual([
      "arpOnlyAttachment",
      "noEndpointMatch",
    ]);
    expect(shuffled.uplinks).toEqual(forward.uplinks);
    expect(shuffled.refusals).toEqual(forward.refusals);
    expect(shuffled.promotedEndpointIds).toEqual(forward.promotedEndpointIds);
  });
});

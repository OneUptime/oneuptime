import EndpointAttachmentUtil, {
  ENDPOINT_LAST_SEEN_REFRESH_MS,
  EndpointAttachment,
  EndpointAttachmentResult,
  EndpointExistingRowSnapshot,
  EndpointUpsertContext,
  EndpointUpsertDecision,
  normalizeMac,
} from "../../../Utils/Monitor/EndpointAttachmentUtil";
import FdbEntry from "../../../Types/Monitor/SnmpMonitor/FdbEntry";
import ArpEntry from "../../../Types/Monitor/SnmpMonitor/ArpEntry";

describe("EndpointAttachmentUtil.normalizeMac", () => {
  it("normalizes colon form to lowercase", () => {
    expect(normalizeMac("AA:BB:CC:DD:EE:FF")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("normalizes dash form", () => {
    expect(normalizeMac("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("normalizes Cisco dot form", () => {
    expect(normalizeMac("aabb.ccdd.eeff")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("normalizes bare hex", () => {
    expect(normalizeMac("aabbccddeeff")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("normalizes 0x-prefixed hex and trims whitespace", () => {
    expect(normalizeMac(" 0xAABBCCDDEEFF ")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("normalizes space-separated octets", () => {
    expect(normalizeMac("aa bb cc dd ee ff")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("is idempotent on already-normalized input", () => {
    expect(normalizeMac("aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("rejects malformed values", () => {
    expect(normalizeMac(undefined)).toBeUndefined();
    expect(normalizeMac("")).toBeUndefined();
    expect(normalizeMac("aa:bb:cc")).toBeUndefined();
    expect(normalizeMac("aa:bb:cc:dd:ee:ff:00")).toBeUndefined();
    expect(normalizeMac("zz:bb:cc:dd:ee:ff")).toBeUndefined();
    expect(normalizeMac("not-a-mac")).toBeUndefined();
  });
});

type ComputeInput = Parameters<
  typeof EndpointAttachmentUtil.computeEndpointAttachments
>[0];

describe("EndpointAttachmentUtil.computeEndpointAttachments", () => {
  const baseSnapshot: ComputeInput = {
    deviceId: "device-1",
    interfaces: [
      { interfaceIndex: 1, name: "Gi0/1", macAddress: "00:00:5e:00:53:01" },
      { interfaceIndex: 2, name: "Gi0/2", macAddress: "00:00:5e:00:53:02" },
      { interfaceIndex: 24, name: "Gi0/24", macAddress: "00:00:5e:00:53:18" },
    ],
  };

  it("turns a learned FDB entry into an attachment with the port name", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [
          {
            macAddress: "AA-BB-CC-DD-EE-01",
            bridgePort: 1,
            interfaceIndex: 1,
            vlanId: 42,
            status: "learned",
          },
        ],
      });

    expect(result.attachments).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:01",
        attachedInterfaceIndex: 1,
        attachedPortName: "Gi0/1",
        vlanId: 42,
      },
    ]);
  });

  it("excludes FDB entries on LLDP uplink interfaces as transit MACs", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        lldpNeighbors: [
          { localInterfaceIndex: 24, remoteSysName: "core-switch" },
        ],
        fdbEntries: [
          { macAddress: "aa:bb:cc:dd:ee:01", bridgePort: 1, interfaceIndex: 1 },
          {
            macAddress: "aa:bb:cc:dd:ee:02",
            bridgePort: 24,
            interfaceIndex: 24,
          },
        ],
      });

    expect(result.uplinkInterfaceIndexes).toEqual([24]);
    expect(
      result.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:01"]);
  });

  it("excludes FDB entries on CDP uplink interfaces as transit MACs", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        cdpNeighbors: [{ localInterfaceIndex: 2, remoteDeviceId: "core-sw" }],
        fdbEntries: [
          { macAddress: "aa:bb:cc:dd:ee:03", bridgePort: 2, interfaceIndex: 2 },
          { macAddress: "aa:bb:cc:dd:ee:04", bridgePort: 1, interfaceIndex: 1 },
        ],
      });

    expect(result.uplinkInterfaceIndexes).toEqual([2]);
    expect(
      result.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:04"]);
  });

  it("merges LLDP and CDP uplinks, sorted and deduplicated", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        lldpNeighbors: [
          { localInterfaceIndex: 24, remoteSysName: "core" },
          { localInterfaceIndex: 2, remoteSysName: "dist" },
        ],
        cdpNeighbors: [
          { localInterfaceIndex: 24, remoteDeviceId: "core" },
          { localInterfaceIndex: 1, remoteDeviceId: "edge" },
        ],
      });

    expect(result.uplinkInterfaceIndexes).toEqual([1, 2, 24]);
  });

  it("excludes the device's own interface MACs from FDB and ARP", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [
          // Self MAC spelled differently than the interface row.
          {
            macAddress: "0000.5e00.5301",
            bridgePort: 1,
            interfaceIndex: 1,
          },
          { macAddress: "aa:bb:cc:dd:ee:05", bridgePort: 2, interfaceIndex: 2 },
        ],
        arpEntries: [
          {
            ipAddress: "10.0.0.1",
            macAddress: "00-00-5E-00-53-02",
            interfaceIndex: 2,
          },
          {
            ipAddress: "10.0.0.9",
            macAddress: "aa:bb:cc:dd:ee:05",
            interfaceIndex: 2,
          },
        ],
      });

    expect(result.selfMacs).toEqual([
      "00:00:5e:00:53:01",
      "00:00:5e:00:53:02",
      "00:00:5e:00:53:18",
    ]);
    expect(
      result.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:05"]);
    expect(result.ipBindings).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:05",
        ipAddress: "10.0.0.9",
        routerInterfaceIndex: 2,
      },
    ]);
  });

  it("keeps learned/undefined FDB statuses and drops self/mgmt rows", () => {
    const entryFor: (mac: string, status?: string) => FdbEntry = (
      mac: string,
      status?: string,
    ): FdbEntry => {
      return {
        macAddress: mac,
        bridgePort: 1,
        interfaceIndex: 1,
        ...(status !== undefined ? { status } : {}),
      };
    };

    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [
          entryFor("aa:bb:cc:dd:ee:01", "learned"),
          entryFor("aa:bb:cc:dd:ee:02", "Learned"),
          entryFor("aa:bb:cc:dd:ee:03"),
          entryFor("aa:bb:cc:dd:ee:04", "self"),
          entryFor("aa:bb:cc:dd:ee:05", "mgmt"),
          entryFor("aa:bb:cc:dd:ee:06", "invalid"),
        ],
      });

    expect(
      result.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:03"]);
  });

  it("skips FDB entries whose bridge port did not resolve to an ifIndex", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [
          { macAddress: "aa:bb:cc:dd:ee:01", bridgePort: 7 },
          { macAddress: "aa:bb:cc:dd:ee:02", bridgePort: 1, interfaceIndex: 1 },
        ],
      });

    expect(
      result.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:02"]);
  });

  it("skips multicast and broadcast MACs everywhere", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [
          { macAddress: "01:00:5e:00:00:fb", bridgePort: 1, interfaceIndex: 1 },
          { macAddress: "ff:ff:ff:ff:ff:ff", bridgePort: 1, interfaceIndex: 1 },
          { macAddress: "aa:bb:cc:dd:ee:01", bridgePort: 1, interfaceIndex: 1 },
        ],
        arpEntries: [
          {
            ipAddress: "224.0.0.251",
            macAddress: "01:00:5e:00:00:fb",
            interfaceIndex: 1,
          },
        ],
      });

    expect(
      result.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:01"]);
    expect(result.ipBindings).toEqual([]);
  });

  it("passes the VLAN through and collapses per-VLAN duplicates deterministically", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [
          {
            macAddress: "aa:bb:cc:dd:ee:01",
            bridgePort: 1,
            interfaceIndex: 1,
            vlanId: 200,
          },
          {
            macAddress: "aa:bb:cc:dd:ee:01",
            bridgePort: 1,
            interfaceIndex: 1,
            vlanId: 100,
          },
        ],
      });

    expect(result.attachments).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:01",
        attachedInterfaceIndex: 1,
        attachedPortName: "Gi0/1",
        vlanId: 100,
      },
    ]);
  });

  it("drops invalid ARP rows and collapses per-MAC ARP duplicates to the smallest IP", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        arpEntries: [
          {
            ipAddress: "10.0.0.7",
            macAddress: "aa:bb:cc:dd:ee:01",
            interfaceIndex: 2,
            entryType: "dynamic",
          },
          {
            ipAddress: "10.0.0.3",
            macAddress: "aa:bb:cc:dd:ee:01",
            interfaceIndex: 1,
            entryType: "static",
          },
          {
            ipAddress: "10.0.0.5",
            macAddress: "aa:bb:cc:dd:ee:02",
            interfaceIndex: 1,
            entryType: "invalid",
          },
        ],
      });

    expect(result.ipBindings).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:01",
        ipAddress: "10.0.0.3",
        routerInterfaceIndex: 1,
      },
    ]);
  });

  it("orders attachments and bindings by MAC regardless of input order", () => {
    const fdbEntries: Array<FdbEntry> = [
      { macAddress: "cc:cc:cc:cc:cc:cc", bridgePort: 1, interfaceIndex: 1 },
      { macAddress: "aa:aa:aa:aa:aa:aa", bridgePort: 2, interfaceIndex: 2 },
    ];
    const arpEntries: Array<ArpEntry> = [
      {
        ipAddress: "10.0.0.2",
        macAddress: "cc:cc:cc:cc:cc:cc",
        interfaceIndex: 1,
      },
      {
        ipAddress: "10.0.0.1",
        macAddress: "aa:aa:aa:aa:aa:aa",
        interfaceIndex: 2,
      },
    ];

    const forward: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries,
        arpEntries,
      });
    const reversed: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        ...baseSnapshot,
        fdbEntries: [...fdbEntries].reverse(),
        arpEntries: [...arpEntries].reverse(),
      });

    expect(forward).toEqual(reversed);
    expect(
      forward.attachments.map((a) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:aa:aa:aa:aa:aa", "cc:cc:cc:cc:cc:cc"]);
    expect(
      forward.ipBindings.map((b) => {
        return b.macAddress;
      }),
    ).toEqual(["aa:aa:aa:aa:aa:aa", "cc:cc:cc:cc:cc:cc"]);
  });

  it("returns empty results for an empty snapshot", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        deviceId: "device-1",
      });

    expect(result).toEqual({
      uplinkInterfaceIndexes: [],
      selfMacs: [],
      attachments: [],
      ipBindings: [],
    });
  });

  it("returns empty results for empty arrays", () => {
    const result: EndpointAttachmentResult =
      EndpointAttachmentUtil.computeEndpointAttachments({
        deviceId: "device-1",
        fdbEntries: [],
        arpEntries: [],
        lldpNeighbors: [],
        cdpNeighbors: [],
        interfaces: [],
      });

    expect(result.attachments).toEqual([]);
    expect(result.ipBindings).toEqual([]);
  });
});

describe("EndpointAttachmentUtil.decideUpsert", () => {
  const mac: string = "aa:bb:cc:dd:ee:01";
  const fdbAttachment: {
    interfaceIndex: number;
    portName?: string | undefined;
    vlanId?: number | undefined;
  } = { interfaceIndex: 7, portName: "Gi0/7", vlanId: 12 };
  const ipBinding: { ipAddress: string; routerInterfaceIndex: number } = {
    ipAddress: "10.1.2.3",
    routerInterfaceIndex: 3,
  };

  it("does nothing when the observation carries neither kind", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(null, {
        macAddress: mac,
        deviceId: "switch-1",
      });

    expect(decision.action).toBe("none");
    expect(decision.setAttachment).toBe(false);
    expect(decision.setIpAddress).toBe(false);
  });

  it("creates from an FDB attachment with all attachment fields", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(null, {
        macAddress: mac,
        deviceId: "switch-1",
        attachment: fdbAttachment,
      });

    expect(decision).toEqual({
      action: "create",
      setAttachment: true,
      attachedInterfaceIndex: 7,
      attachedPortName: "Gi0/7",
      vlanId: 12,
      setIpAddress: false,
    });
  });

  it("creates from an ARP-only sighting, attached to the router interface", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(null, {
        macAddress: mac,
        deviceId: "router-1",
        ipBinding,
      });

    expect(decision.action).toBe("create");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(3);
    expect(decision.attachedPortName).toBeUndefined();
    expect(decision.vlanId).toBeUndefined();
    expect(decision.setIpAddress).toBe(true);
    expect(decision.ipAddress).toBe("10.1.2.3");
  });

  it("creates from a combined FDB+ARP walk with the FDB attachment winning", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(null, {
        macAddress: mac,
        deviceId: "l3-switch-1",
        attachment: fdbAttachment,
        ipBinding,
      });

    expect(decision.action).toBe("create");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(7);
    expect(decision.setIpAddress).toBe(true);
    expect(decision.ipAddress).toBe("10.1.2.3");
  });

  it("lets an FDB attachment steal a row attached to another device", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { attachedNetworkDeviceId: "another-switch" },
        {
          macAddress: mac,
          deviceId: "switch-1",
          attachment: fdbAttachment,
        },
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(7);
  });

  it("never lets ARP steal an attachment owned by a different device", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { attachedNetworkDeviceId: "switch-1" },
        {
          macAddress: mac,
          deviceId: "router-1",
          ipBinding,
        },
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(false);
    expect(decision.setIpAddress).toBe(true);
    expect(decision.ipAddress).toBe("10.1.2.3");
  });

  it("lets ARP refresh an attachment it already owns", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { attachedNetworkDeviceId: "router-1" },
        {
          macAddress: mac,
          deviceId: "router-1",
          ipBinding,
        },
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(3);
    expect(decision.setIpAddress).toBe(true);
  });

  it("lets ARP claim a row that has no attachment", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { attachedNetworkDeviceId: undefined },
        {
          macAddress: mac,
          deviceId: "router-1",
          ipBinding,
        },
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(3);
  });

  it("leaves port/vlan undefined when the FDB knew neither", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { attachedNetworkDeviceId: "switch-1" },
        {
          macAddress: mac,
          deviceId: "switch-1",
          attachment: { interfaceIndex: 4 },
        },
      );

    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(4);
    expect(decision.attachedPortName).toBeUndefined();
    expect(decision.vlanId).toBeUndefined();
  });
});

/*
 * The unchanged-since-last-poll short circuit. Without it a stable
 * 4096-MAC switch issues 4096 writes every poll purely to bump
 * lastSeenAt — and that path runs inline on probe ingest. The rule has
 * to be conservative in both directions: never suppress a write that
 * carries new information, and never let lastSeenAt drift far enough to
 * make a live endpoint look down (NetworkTopologyUtil calls it down at
 * 15 minutes).
 */
describe("EndpointAttachmentUtil.decideUpsert — unchanged sightings", () => {
  const mac: string = "aa:bb:cc:dd:ee:01";
  const NOW: Date = new Date("2026-07-22T12:00:00Z");
  const ONE_MINUTE_AGO: Date = new Date("2026-07-22T11:59:00Z");
  const TEN_MINUTES_AGO: Date = new Date("2026-07-22T11:50:00Z");
  const LONG_AGO: Date = new Date("2026-07-01T00:00:00Z");

  const context: EndpointUpsertContext = { now: NOW };

  // A row that exactly matches what the walk below is about to report.
  const stableRow: EndpointExistingRowSnapshot = {
    attachedNetworkDeviceId: "switch-1",
    attachedInterfaceIndex: 7,
    attachedPortName: "Gi0/7",
    vlanId: 12,
    firstSeenAt: LONG_AGO,
    lastSeenAt: ONE_MINUTE_AGO,
  };

  const stableSighting: {
    macAddress: string;
    deviceId: string;
    attachment: {
      interfaceIndex: number;
      portName?: string | undefined;
      vlanId?: number | undefined;
    };
  } = {
    macAddress: mac,
    deviceId: "switch-1",
    attachment: { interfaceIndex: 7, portName: "Gi0/7", vlanId: 12 },
  };

  it("keeps the refresh threshold at 5 minutes", () => {
    /*
     * Stored lastSeenAt lags reality by at most (threshold + poll
     * interval). 5 minutes keeps that under the 15-minute down window
     * for any poll interval up to 10 minutes; slower polls always land
     * past the threshold and fall back to writing every poll.
     */
    expect(ENDPOINT_LAST_SEEN_REFRESH_MS).toBe(5 * 60 * 1000);
  });

  it("collapses an unchanged re-sighting to no write at all", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(stableRow, stableSighting, context);

    expect(decision).toEqual({
      action: "none",
      setAttachment: false,
      setIpAddress: false,
    });
  });

  it("still writes when the caller passes no context", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(stableRow, stableSighting);

    expect(decision.action).toBe("update");
  });

  it("refreshes lastSeenAt once it ages past the threshold", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: TEN_MINUTES_AGO },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("honours a caller-supplied refresh threshold", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: TEN_MINUTES_AGO },
        stableSighting,
        { now: NOW, lastSeenRefreshMs: 30 * 60 * 1000 },
      );

    expect(decision.action).toBe("none");
  });

  it("writes when lastSeenAt sits in the future (clock skew)", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: new Date("2026-07-22T12:05:00Z") },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("writes when the row has no lastSeenAt to compare against", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: undefined },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("writes when the row still owes a firstSeenAt backfill", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, firstSeenAt: undefined },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("writes when the endpoint moved to a different port", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, attachedInterfaceIndex: 8 },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
    expect(decision.attachedInterfaceIndex).toBe(7);
  });

  it("writes when the port was renamed", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, attachedPortName: "GigabitEthernet0/7" },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("writes when the endpoint moved to a different VLAN", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, vlanId: 13 },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("writes when the endpoint moved to a different switch", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, attachedNetworkDeviceId: "switch-2" },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(true);
  });

  it("does not treat a port/vlan the walk did not report as a change", () => {
    // Undefined never clears a stored value, so it is not new information.
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        stableRow,
        {
          macAddress: mac,
          deviceId: "switch-1",
          attachment: { interfaceIndex: 7 },
        },
        context,
      );

    expect(decision.action).toBe("none");
  });

  it("writes when the site the device belongs to changed", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(stableRow, stableSighting, {
        now: NOW,
        siteId: "site-2",
      });

    expect(decision.action).toBe("update");
  });

  it("stays quiet when the site is unchanged", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, siteId: "site-1" },
        stableSighting,
        { now: NOW, siteId: "site-1" },
      );

    expect(decision.action).toBe("none");
  });

  it("writes when the endpoint's IP changed", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, ipAddress: "10.1.2.3" },
        {
          ...stableSighting,
          ipBinding: { ipAddress: "10.1.2.4", routerInterfaceIndex: 3 },
        },
        context,
      );

    expect(decision.action).toBe("update");
    expect(decision.setIpAddress).toBe(true);
    expect(decision.ipAddress).toBe("10.1.2.4");
  });

  it("stays quiet when the ARP binding repeats the stored IP", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, ipAddress: "10.1.2.3" },
        {
          ...stableSighting,
          ipBinding: { ipAddress: "10.1.2.3", routerInterfaceIndex: 3 },
        },
        context,
      );

    expect(decision.action).toBe("none");
  });

  it("stays quiet for an ARP-only re-sighting that cannot claim the attachment", () => {
    /*
     * setAttachment is false here (a switch owns the port), so only the
     * IP could carry news — and it does not.
     */
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, ipAddress: "10.1.2.3" },
        {
          macAddress: mac,
          deviceId: "router-1",
          ipBinding: { ipAddress: "10.1.2.3", routerInterfaceIndex: 3 },
        },
        context,
      );

    expect(decision.action).toBe("none");
  });

  it("never suppresses a create", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(null, stableSighting, context);

    expect(decision.action).toBe("create");
  });
});

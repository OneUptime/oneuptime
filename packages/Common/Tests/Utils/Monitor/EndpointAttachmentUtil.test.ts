import EndpointAttachmentUtil, {
  CONTROLLER_SIGHTING_CURRENT_FOR_MS,
  ENDPOINT_LAST_SEEN_REFRESH_MS,
  ENDPOINT_REFRESH_GROUPS,
  ENDPOINT_WALK_WINDOW_MS,
  EndpointAttachment,
  EndpointAttachmentResult,
  EndpointExistingRowSnapshot,
  EndpointIncomingObservation,
  EndpointIpBinding,
  EndpointUpsertContext,
  EndpointUpsertDecision,
  endpointRefreshSlot,
  normalizeMac,
} from "../../../Utils/Monitor/EndpointAttachmentUtil";
import { getEndpointSightingWindowMs } from "../../../Utils/Monitor/NetworkTopologyUtil";
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
      forward.attachments.map((a: EndpointAttachment) => {
        return a.macAddress;
      }),
    ).toEqual(["aa:aa:aa:aa:aa:aa", "cc:cc:cc:cc:cc:cc"]);
    expect(
      forward.ipBindings.map((b: EndpointIpBinding) => {
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
 * make a live endpoint look down (the map calls it down once it is older
 * than the walk window, an hour).
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

  /*
   * When this MAC's own refresh window last turned, at or before `at`: the
   * first second its endpointRefreshSlot reads what it reads at `at`.
   */
  function windowTurnedAt(at: Date, refreshMs?: number): Date {
    const windowMs: number = refreshMs ?? ENDPOINT_LAST_SEEN_REFRESH_MS;
    const slotAt: (time: number) => number = (time: number): number => {
      return endpointRefreshSlot({
        time,
        macAddress: mac,
        refreshMs: windowMs,
      });
    };
    let time: number = at.getTime();

    while (slotAt(time - 1000) === slotAt(at.getTime())) {
      time -= 1000;
    }

    return new Date(time);
  }

  it("keeps the refresh window at 15 minutes, counted in fifteen groups", () => {
    /*
     * As an interface's is: a stable endpoint is written every third
     * five-minute poll, a third of a switch's endpoints on each. It was 5
     * minutes - every poll - and then just under two polls. Stored
     * lastSeenAt lags reality by at most (window + poll interval), 20
     * minutes, well inside the walk window.
     */
    expect(ENDPOINT_LAST_SEEN_REFRESH_MS).toBe(15 * 60 * 1000);
    expect(ENDPOINT_REFRESH_GROUPS).toBe(15);
  });

  it("skips a row last written in the endpoint's current window, however lately the window turned", () => {
    const turned: Date = windowTurnedAt(NOW);

    /*
     * aa:bb:cc:dd:ee:01 is group 1 (its hex digits sum to 121), so its
     * window turns at :14, :29, :44 and :59.
     */
    expect(turned).toEqual(new Date("2026-07-22T11:59:00Z"));

    for (const lastSeenAt of [
      turned,
      new Date("2026-07-22T11:59:30Z"),
      new Date("2026-07-22T11:59:59Z"),
    ]) {
      expect(
        EndpointAttachmentUtil.decideUpsert(
          { ...stableRow, lastSeenAt },
          stableSighting,
          context,
        ).action,
      ).toBe("none");
    }
  });

  it("writes a row last written before the window turned, however lately that was", () => {
    const justBefore: Date = new Date(windowTurnedAt(NOW).getTime() - 1000);

    for (const lastSeenAt of [justBefore, TEN_MINUTES_AGO]) {
      expect(
        EndpointAttachmentUtil.decideUpsert(
          { ...stableRow, lastSeenAt },
          stableSighting,
          context,
        ).action,
      ).toBe("update");
    }
  });

  it("writes a stable endpoint every third five-minute poll, never more than a window and a poll apart", () => {
    const POLL: number = 5 * 60 * 1000;
    let lastSeenAt: Date = new Date("2026-07-22T00:00:30Z");
    const writes: Array<number> = [];

    for (let poll: number = 1; poll <= 12 * 24; poll++) {
      const now: Date = new Date(
        new Date("2026-07-22T00:00:30Z").getTime() + poll * POLL,
      );
      const action: string = EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt },
        stableSighting,
        { now },
      ).action;

      if (action === "update") {
        writes.push(now.getTime() - lastSeenAt.getTime());
        lastSeenAt = now;
      }
    }

    // A day of polls: four writes an hour.
    expect(writes).toHaveLength(4 * 24);
    for (const gap of writes) {
      expect(gap).toBeLessThanOrEqual(ENDPOINT_LAST_SEEN_REFRESH_MS + POLL);
    }
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

  it("refreshes lastSeenAt once a whole window has passed, whichever group the MAC is in", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        {
          ...stableRow,
          lastSeenAt: new Date(NOW.getTime() - ENDPOINT_LAST_SEEN_REFRESH_MS),
        },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("update");
  });

  it("honours a caller-supplied refresh window", () => {
    const longer: number = 30 * 60 * 1000;
    // In the 30-minute window that holds NOW, before the 15-minute one turned.
    const between: Date = new Date(
      windowTurnedAt(NOW, longer).getTime() + 30 * 1000,
    );

    expect(between.getTime()).toBeLessThan(windowTurnedAt(NOW).getTime());
    expect(
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: between },
        stableSighting,
        context,
      ).action,
    ).toBe("update");
    expect(
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: between },
        stableSighting,
        { now: NOW, lastSeenRefreshMs: longer },
      ).action,
    ).toBe("none");
  });

  /*
   * A sighting from before the row's lastSeenAt: an older poll processed
   * after a newer one (issue #7389), or a row stamped by a clock a little
   * ahead. The write keeps the later lastSeenAt (NetworkEndpointService), so
   * an unchanged sighting has nothing to write - and a changed one still
   * writes what changed.
   */
  it("writes nothing for an unchanged sighting from before the stored one", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: new Date("2026-07-22T12:05:00Z") },
        stableSighting,
        context,
      );

    expect(decision.action).toBe("none");
  });

  it("still writes a sighting from before the stored one that says something new", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        { ...stableRow, lastSeenAt: new Date("2026-07-22T12:05:00Z") },
        {
          ...stableSighting,
          attachment: { interfaceIndex: 9, portName: "Gi0/9", vlanId: 12 },
        },
        context,
      );

    expect(decision.action).toBe("update");
    expect(decision.attachedInterfaceIndex).toBe(9);
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

describe("a network controller's report against a walk (#5379)", () => {
  const NOW: Date = new Date("2026-11-01T12:00:00Z");
  const HOUR: number = 60 * 60 * 1000;
  const hoursAgo: (hours: number) => Date = (hours: number): Date => {
    return new Date(NOW.getTime() - hours * HOUR);
  };

  const controllerRow: (ageInHours: number) => EndpointExistingRowSnapshot = (
    ageInHours: number,
  ): EndpointExistingRowSnapshot => {
    return {
      attachedNetworkDeviceId: "switch-a",
      attachedPortName: "Port 7",
      attachmentSource: "meraki",
      hostname: "kds-1",
      firstSeenAt: hoursAgo(100),
      lastSeenAt: hoursAgo(ageInHours),
    };
  };

  const walkOf: (deviceId: string) => EndpointIncomingObservation = (
    deviceId: string,
  ): EndpointIncomingObservation => {
    return {
      macAddress: "aa:bb:cc:00:00:01",
      deviceId: deviceId,
      attachment: { interfaceIndex: 49, portName: "port49" },
    };
  };

  const reportOf: (
    deviceId: string,
    portName: string,
    seenAt?: Date,
  ) => EndpointIncomingObservation = (
    deviceId: string,
    portName: string,
    seenAt: Date = NOW,
  ): EndpointIncomingObservation => {
    return {
      macAddress: "aa:bb:cc:00:00:01",
      deviceId: deviceId,
      attachment: { portName: portName },
      ipBinding: { ipAddress: "10.18.166.51" },
      controller: { source: "meraki", hostname: "kds-1", seenAt: seenAt },
    };
  };

  test("a walk does nothing to a row the controller placed within the window", () => {
    expect(
      EndpointAttachmentUtil.decideUpsert(
        controllerRow(5.9),
        walkOf("switch-b"),
        {
          now: NOW,
        },
      ).action,
    ).toBe("none");
  });

  test("an ARP-only sighting does nothing either: it would keep the row current for ever", () => {
    expect(
      EndpointAttachmentUtil.decideUpsert(
        controllerRow(1),
        {
          macAddress: "aa:bb:cc:00:00:01",
          deviceId: "router",
          ipBinding: { ipAddress: "10.18.166.99", routerInterfaceIndex: 2 },
        },
        { now: NOW },
      ).action,
    ).toBe("none");
  });

  test("past the window the walk takes the row, and it stops being the controller's", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        controllerRow(6.1),
        walkOf("switch-b"),
        { now: NOW },
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachedInterfaceIndex).toBe(49);
    expect(decision.attachmentSource).toBeUndefined();
  });

  test("without a clock the old behaviour stands, so an existing caller is not held", () => {
    expect(
      EndpointAttachmentUtil.decideUpsert(controllerRow(1), walkOf("switch-b"))
        .setAttachment,
    ).toBe(true);
  });

  test("a row with no source is a walk's, whatever its age", () => {
    const row: EndpointExistingRowSnapshot = {
      ...controllerRow(0.5),
      attachmentSource: undefined,
    };

    expect(
      EndpointAttachmentUtil.decideUpsert(row, walkOf("switch-b"), { now: NOW })
        .setAttachment,
    ).toBe(true);
  });

  test("the controller always takes the row, even from a fresh walk", () => {
    const decision: EndpointUpsertDecision =
      EndpointAttachmentUtil.decideUpsert(
        {
          attachedNetworkDeviceId: "switch-b",
          attachedInterfaceIndex: 49,
          attachedPortName: "port49",
          firstSeenAt: hoursAgo(100),
          lastSeenAt: hoursAgo(0.01),
        },
        reportOf("switch-a", "Port 7"),
        { now: NOW },
      );

    expect(decision.action).toBe("update");
    expect(decision.setAttachment).toBe(true);
    expect(decision.attachmentSource).toBe("meraki");
    expect(decision.attachedPortName).toBe("Port 7");
    // That ifIndex was the old switch's port.
    expect(decision.attachedInterfaceIndex).toBeUndefined();
  });

  test("the same port keeps its ifIndex, which is what its counters are found by", () => {
    expect(
      EndpointAttachmentUtil.decideUpsert(
        {
          attachedNetworkDeviceId: "switch-a",
          attachedInterfaceIndex: 7,
          attachedPortName: "Port 7",
          lastSeenAt: hoursAgo(2),
        },
        reportOf("switch-a", "Port 7"),
        { now: NOW },
      ).attachedInterfaceIndex,
    ).toBe(7);
  });

  test("the same port name on another switch is another port", () => {
    expect(
      EndpointAttachmentUtil.decideUpsert(
        {
          attachedNetworkDeviceId: "switch-b",
          attachedInterfaceIndex: 7,
          attachedPortName: "Port 7",
          lastSeenAt: hoursAgo(2),
        },
        reportOf("switch-a", "Port 7"),
        { now: NOW },
      ).attachedInterfaceIndex,
    ).toBeUndefined();
  });

  test("lastSeenAt is when the controller saw it, and never earlier than what is stored", () => {
    const stored: EndpointExistingRowSnapshot = {
      attachedNetworkDeviceId: "switch-a",
      lastSeenAt: hoursAgo(1),
    };

    expect(
      EndpointAttachmentUtil.decideUpsert(
        stored,
        reportOf("switch-a", "Port 7", hoursAgo(0.5)),
        { now: NOW },
      ).lastSeenAt,
    ).toEqual(hoursAgo(0.5));
    expect(
      EndpointAttachmentUtil.decideUpsert(
        stored,
        reportOf("switch-a", "Port 7", hoursAgo(2)),
        { now: NOW },
      ).lastSeenAt,
    ).toEqual(hoursAgo(1));
  });

  test("a new name is a change worth a write, inside the refresh window too", () => {
    const stored: EndpointExistingRowSnapshot = {
      attachedNetworkDeviceId: "switch-a",
      attachedPortName: "Port 7",
      ipAddress: "10.18.166.51",
      attachmentSource: "meraki",
      hostname: "old-name",
      firstSeenAt: hoursAgo(100),
      lastSeenAt: hoursAgo(0.01),
    };

    expect(
      EndpointAttachmentUtil.decideUpsert(
        stored,
        reportOf("switch-a", "Port 7", hoursAgo(0.01)),
        { now: NOW },
      ).action,
    ).toBe("update");
    expect(
      EndpointAttachmentUtil.decideUpsert(
        { ...stored, hostname: "kds-1" },
        reportOf("switch-a", "Port 7", hoursAgo(0.01)),
        { now: NOW },
      ).action,
    ).toBe("none");
  });

  test("a sighting's window is a walk's unless a controller saw it", () => {
    const WALK_WINDOW_MS: number = 15 * 60 * 1000;

    expect(
      EndpointAttachmentUtil.getSightingWindowMs(undefined, WALK_WINDOW_MS),
    ).toBe(WALK_WINDOW_MS);
    expect(
      EndpointAttachmentUtil.getSightingWindowMs("meraki", WALK_WINDOW_MS),
    ).toBe(CONTROLLER_SIGHTING_CURRENT_FOR_MS);
    // It is never shorter than a slow walk's own window.
    expect(
      EndpointAttachmentUtil.getSightingWindowMs("meraki", 24 * HOUR),
    ).toBe(24 * HOUR);
  });
});

/*
 * The refresh window of an endpoint the walk finds unchanged
 * (endpointRefreshSlot): 15 minutes, counted on a clock of the endpoint's
 * own, offset by its MAC in fifteen groups a minute apart. A switch's
 * endpoints then come due a third at a time on five-minute polls - so one
 * statement rewrites a third of each page, which the table's free space
 * takes as HOT updates - and never so late that the map, the "Connected to"
 * card or the Discovered Devices list would read an endpoint as gone.
 */
describe("endpointRefreshSlot", () => {
  const MINUTE: number = 60 * 1000;
  const WINDOW: number = ENDPOINT_LAST_SEEN_REFRESH_MS;

  function macOf(n: number): string {
    return n
      .toString(16)
      .padStart(12, "0")
      .replace(/(..)(?!$)/g, "$1:");
  }

  function slotOf(macAddress: string, time: number): number {
    return endpointRefreshSlot({ time, macAddress, refreshMs: WINDOW });
  }

  // The minute past the quarter-hour at which a MAC's window turns.
  function turnMinute(macAddress: string): number {
    const hour: number = Date.UTC(2026, 6, 22, 12, 0, 0);

    for (let minute: number = 1; minute <= 15; minute++) {
      if (
        slotOf(macAddress, hour + minute * MINUTE) !==
        slotOf(macAddress, hour + minute * MINUTE - 1)
      ) {
        return minute % 15;
      }
    }

    throw new Error(`no turn for ${macAddress}`);
  }

  test("a slot is a window long, for every MAC", () => {
    for (const macAddress of [macOf(0), macOf(1), macOf(14), macOf(0xabcdef)]) {
      const at: number = Date.UTC(2026, 6, 22, 12, 7, 0);
      expect(slotOf(macAddress, at + WINDOW)).toBe(slotOf(macAddress, at) + 1);
    }
  });

  test("MACs that differ by one turn a minute apart, through all fifteen groups", () => {
    const minutes: Array<number> = [];

    for (let n: number = 0; n < ENDPOINT_REFRESH_GROUPS; n++) {
      minutes.push(turnMinute(macOf(0x1c697a000000 + n)));
    }

    expect(new Set(minutes).size).toBe(ENDPOINT_REFRESH_GROUPS);
    for (let n: number = 1; n < minutes.length; n++) {
      expect((minutes[n - 1]! - minutes[n]! + 15) % 15).toBe(1);
    }
  });

  test("reads the MAC's twelve hex digits however it is written", () => {
    const at: number = Date.UTC(2026, 6, 22, 12, 7, 0);
    const slot: number = slotOf("aa:bb:cc:dd:ee:01", at);

    for (const written of [
      "AA:BB:CC:DD:EE:01",
      "aa-bb-cc-dd-ee-01",
      "aabb.ccdd.ee01",
      "AABBCCDDEE01",
    ]) {
      expect(slotOf(written, at)).toBe(slot);
    }
  });

  test("a MAC with no hex digits counts in the first group rather than failing", () => {
    const at: number = Date.UTC(2026, 6, 22, 12, 7, 0);

    expect(slotOf("", at)).toBe(slotOf(macOf(0), at));
    expect(slotOf("not a mac", at)).toBe(slotOf(macOf(0), at));
  });

  test("a switch's endpoints come due a third at a time on five-minute polls", () => {
    const POLL: number = 5 * MINUTE;
    const start: number = Date.UTC(2026, 6, 22, 0, 0, 30);
    const macs: Array<string> = [];

    for (let n: number = 0; n < 48; n++) {
      macs.push(macOf(0x001b54000100 + n));
    }

    const written: Map<string, number> = new Map();
    for (const macAddress of macs) {
      written.set(macAddress, start);
    }

    const perPoll: Array<number> = [];
    for (let poll: number = 1; poll <= 24; poll++) {
      const now: number = start + poll * POLL;
      let due: number = 0;

      for (const macAddress of macs) {
        if (
          slotOf(macAddress, now) > slotOf(macAddress, written.get(macAddress)!)
        ) {
          due++;
          written.set(macAddress, now);
        }
      }

      perPoll.push(due);
    }

    /*
     * 48 endpoints in fifteen groups of three or four, five groups a poll:
     * 15 to 18 - a third, give or take a group. (These MACs put their three
     * groups of four in one poll: 18, then 15 and 15.)
     */
    for (const due of perPoll) {
      expect(due).toBeGreaterThanOrEqual(15);
      expect(due).toBeLessThanOrEqual(18);
    }
    expect(
      perPoll.reduce((sum: number, due: number) => {
        return sum + due;
      }, 0),
    ).toBe(48 * 8);
  });

  test("the walk window is the map's: an hour, the device staleness window at the default interval", () => {
    expect(ENDPOINT_WALK_WINDOW_MS).toBe(60 * MINUTE);
    expect(getEndpointSightingWindowMs(undefined)).toBe(
      ENDPOINT_WALK_WINDOW_MS,
    );
  });

  /*
   * The bound the window exists to keep: how far an answering endpoint's
   * stored lastSeenAt can lag, for a device polled every N minutes. Each
   * poll writes an endpoint whose window turned since its last write, so
   * the lag is at most the window and one poll - inside the walk window
   * for every interval up to 45 minutes - and a device polled less often
   * than the window writes on every poll, as it did before any refresh rule.
   */
  test("never lets an endpoint the walk still sees read as gone that did not before", () => {
    for (const interval of [1, 2, 3, 5, 7, 10, 14, 15, 16, 30, 45, 60, 120]) {
      const poll: number = interval * MINUTE;

      for (const macAddress of [macOf(0), macOf(7), macOf(0x1c697a0000ee)]) {
        const start: number = Date.UTC(2026, 6, 22, 0, 0, 30);
        let lastWrite: number = start;
        let worstGap: number = 0;
        let everyPoll: boolean = true;

        for (let n: number = 1; n * poll <= 6 * 60 * MINUTE; n++) {
          const now: number = start + n * poll;

          if (slotOf(macAddress, now) > slotOf(macAddress, lastWrite)) {
            worstGap = Math.max(worstGap, now - lastWrite);
            lastWrite = now;
          } else {
            everyPoll = false;
          }
        }

        expect(worstGap).toBeLessThanOrEqual(WINDOW + poll);
        if (interval <= 45) {
          expect(worstGap).toBeLessThanOrEqual(ENDPOINT_WALK_WINDOW_MS);
        }
        if (poll >= WINDOW) {
          expect(everyPoll).toBe(true);
        }
      }
    }
  });
});

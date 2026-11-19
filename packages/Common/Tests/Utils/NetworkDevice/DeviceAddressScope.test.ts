import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import {
  AmbiguousAddressReason,
  DeviceAtAddressLike,
  DeviceSeenFrom,
  NO_SITE_KEY,
  NoDeviceReason,
  ProbeReach,
  ProbeReachFacts,
  ProbeReachIndex,
  SeenDeviceReason,
  SiteForReach,
  WhenReachUnknown,
  buildProbeReachIndex,
  getProbeIdKeys,
  getSiteKey,
  getSiteKeysOf,
  isAmongDevicesSeen,
  isDecidedByPolledDevice,
  pickDeviceSeenFrom,
  readProbeReachFacts,
  toIdKey,
  toProbeReach,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import { describe, expect, it } from "@jest/globals";

/*
 * TWO SITES' DEVICES AT ONE ADDRESS (OneUptime issue #9677).
 *
 * Every branch can have a 10.0.0.5. Which device an address is depends on
 * where it is seen from: a scan's probe, a monitor's probes. These are the
 * rule's cases, as a person would meet them: two branches at the same
 * private address, a branch whose host is not a device yet beside another
 * branch's device, a project that uses no sites at all, and probes whose
 * site OneUptime cannot know.
 */

// Two branches, each with its own probe and its own 10.0.0.5.
const SITE_A: string = "a1000000-0000-4000-8000-000000000001";
const SITE_B: string = "b1000000-0000-4000-8000-000000000001";
const SITE_C: string = "c1000000-0000-4000-8000-000000000001";
const PROBE_A: string = "a2000000-0000-4000-8000-000000000001";
const PROBE_A_SPARE: string = "a2000000-0000-4000-8000-000000000002";
const PROBE_B: string = "b2000000-0000-4000-8000-000000000001";
const PROBE_C: string = "c2000000-0000-4000-8000-000000000001";
const PROBE_FRESH: string = "f2000000-0000-4000-8000-000000000001";

interface TestDevice extends DeviceAtAddressLike {
  id: string;
  name: string;
}

function device(data: {
  name: string;
  id: string;
  siteId?: string | undefined;
  probeId?: string | undefined;
}): TestDevice {
  return {
    id: data.id,
    name: data.name,
    ...(data.siteId ? { siteId: data.siteId } : {}),
    ...(data.probeId ? { probeId: data.probeId } : {}),
  };
}

// Site A's 10.0.0.5, polled by its probe.
const BRANCH_A_ROUTER: TestDevice = device({
  name: "branch-a-router",
  id: "d0000000-0000-4000-8000-00000000000a",
  siteId: SITE_A,
  probeId: PROBE_A,
});

// Site B's 10.0.0.5, polled by its probe.
const BRANCH_B_ROUTER: TestDevice = device({
  name: "branch-b-router",
  id: "d0000000-0000-4000-8000-00000000000b",
  siteId: SITE_B,
  probeId: PROBE_B,
});

// A switch in each site, polled by the site's probe: what the probe reaches.
const BRANCH_A_SWITCH: TestDevice = device({
  name: "branch-a-switch",
  id: "d0000000-0000-4000-8000-0000000000a2",
  siteId: SITE_A,
  probeId: PROBE_A,
});
const BRANCH_B_SWITCH: TestDevice = device({
  name: "branch-b-switch",
  id: "d0000000-0000-4000-8000-0000000000b2",
  siteId: SITE_B,
  probeId: PROBE_B,
});

const SITES: Array<SiteForReach> = [
  { id: SITE_A, probeId: PROBE_A },
  { id: SITE_B, probeId: PROBE_B },
  { id: SITE_C, probeId: PROBE_C },
];

function reachOf(data: {
  probeIds: Array<string>;
  devices: Array<DeviceAtAddressLike>;
  sites?: Array<SiteForReach> | undefined;
  siteKeys: Array<string>;
}): ProbeReach {
  const index: ProbeReachIndex = buildProbeReachIndex({
    devices: data.devices,
    sites: data.sites || [],
  });

  return toProbeReach(
    readProbeReachFacts({
      index: index,
      probeIds: data.probeIds,
      siteKeys: data.siteKeys,
    }),
  );
}

interface SeenFromData {
  probeIds: Array<string>;
  candidates: Array<TestDevice>;
  projectDevices?: Array<TestDevice> | undefined;
  sites?: Array<SiteForReach> | undefined;
  whenReachUnknown?: WhenReachUnknown | undefined;
}

/*
 * What the probes see at the address of `candidates`, worked out from every
 * device and site of the project, as the backfill does and the server's
 * reads mirror: the whole answer, with its reason.
 */
function seenFrom(data: SeenFromData): DeviceSeenFrom<TestDevice> {
  const projectDevices: Array<TestDevice> =
    data.projectDevices || data.candidates;
  const reach: ProbeReach = reachOf({
    probeIds: data.probeIds,
    devices: projectDevices,
    sites: data.sites || SITES,
    siteKeys: getSiteKeysOf(data.candidates),
  });

  return pickDeviceSeenFrom({
    candidates: data.candidates,
    reach: reach,
    whenReachUnknown:
      data.whenReachUnknown || WhenReachUnknown.OnlyDeviceAnywhere,
  });
}

// Which device of `candidates` the probes see, by name, or why none.
function seen(data: SeenFromData): string {
  const picked: DeviceSeenFrom<TestDevice> = seenFrom(data);

  return picked.kind === "device" ? picked.device.name : picked.kind;
}

// The answer as a person is told it: the device or devices, and the reason.
function explained(data: SeenFromData): {
  kind: string;
  devices: Array<string>;
  reason: string;
} {
  const picked: DeviceSeenFrom<TestDevice> = seenFrom(data);

  return {
    kind: picked.kind,
    devices:
      picked.kind === "device"
        ? [picked.device.name]
        : picked.kind === "ambiguous"
          ? picked.devices.map((each: TestDevice): string => {
              return each.name;
            })
          : [],
    reason: picked.reason,
  };
}

describe("two sites with a device each at the same private address", () => {
  const projectDevices: Array<TestDevice> = [
    BRANCH_A_ROUTER,
    BRANCH_B_ROUTER,
    BRANCH_A_SWITCH,
    BRANCH_B_SWITCH,
  ];

  it("site A's probe sees site A's device, and site B's probe site B's", () => {
    expect(
      seen({
        probeIds: [PROBE_A],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
      }),
    ).toBe("branch-a-router");
    expect(
      seen({
        probeIds: [PROBE_B],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
      }),
    ).toBe("branch-b-router");
  });

  it("does not depend on the order the devices were read in", () => {
    expect(
      seen({
        probeIds: [PROBE_A],
        candidates: [BRANCH_B_ROUTER, BRANCH_A_ROUTER],
        projectDevices: projectDevices,
      }),
    ).toBe("branch-a-router");
  });

  it("a second probe in site A, polling another of its devices, sees site A's", () => {
    const spareSwitch: TestDevice = device({
      name: "branch-a-spare-switch",
      id: "d0000000-0000-4000-8000-0000000000a3",
      siteId: SITE_A,
      probeId: PROBE_A_SPARE,
    });

    expect(
      seen({
        probeIds: [PROBE_A_SPARE],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: [...projectDevices, spareSwitch],
      }),
    ).toBe("branch-a-router");
  });

  it("a site's default probe that polls nothing yet still looks into its site", () => {
    const branchCRouter: TestDevice = device({
      name: "branch-c-router",
      id: "d0000000-0000-4000-8000-00000000000c",
      siteId: SITE_C,
      // Polled by another probe, named on the device itself.
      probeId: PROBE_A_SPARE,
    });

    expect(
      seen({
        probeIds: [PROBE_C],
        candidates: [BRANCH_A_ROUTER, branchCRouter],
        projectDevices: [...projectDevices, branchCRouter],
      }),
    ).toBe("branch-c-router");
  });

  it("a monitor that runs on both sites' probes checks two hosts: it is tied to neither", () => {
    expect(
      seen({
        probeIds: [PROBE_A, PROBE_B],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("ambiguous");
  });
});

describe("one site's device, another site's host at the same address", () => {
  // Site C has its own 10.0.0.5, which is not a device yet.
  const branchCSwitch: TestDevice = device({
    name: "branch-c-switch",
    id: "d0000000-0000-4000-8000-0000000000c2",
    siteId: SITE_C,
    probeId: PROBE_C,
  });

  it("site C's probe does not see site A's device: the host is new to it", () => {
    expect(
      seen({
        probeIds: [PROBE_C],
        candidates: [BRANCH_A_ROUTER],
        projectDevices: [BRANCH_A_ROUTER, BRANCH_A_SWITCH, branchCSwitch],
      }),
    ).toBe("none");
  });

  it("nor does a monitor on site C's probe count as site A's device's", () => {
    expect(
      seen({
        probeIds: [PROBE_C],
        candidates: [BRANCH_A_ROUTER],
        projectDevices: [BRANCH_A_ROUTER, branchCSwitch],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("none");
  });

  it("site A's own probe still sees it", () => {
    expect(
      seen({
        probeIds: [PROBE_A],
        candidates: [BRANCH_A_ROUTER],
        projectDevices: [BRANCH_A_ROUTER, branchCSwitch],
      }),
    ).toBe("branch-a-router");
  });
});

describe("a project that puts no device in a site", () => {
  const officeRouter: TestDevice = device({
    name: "office-router",
    id: "e0000000-0000-4000-8000-000000000001",
    probeId: PROBE_A,
  });
  const officePrinter: TestDevice = device({
    name: "office-printer",
    id: "e0000000-0000-4000-8000-000000000002",
    probeId: PROBE_B,
  });

  it("matches by address as before, whichever of its probes looks", () => {
    // Probe B polls another device in no site: the same network.
    expect(
      seen({
        probeIds: [PROBE_B],
        candidates: [officeRouter],
        projectDevices: [officeRouter, officePrinter],
        sites: [],
      }),
    ).toBe("office-router");
  });

  it("ties a monitor to it as before", () => {
    expect(
      seen({
        probeIds: [PROBE_B],
        candidates: [officeRouter],
        projectDevices: [officeRouter, officePrinter],
        sites: [],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("office-router");
  });

  it("two devices at one address, one polled by the probe, are told apart", () => {
    const secondAtSameAddress: TestDevice = device({
      name: "office-router-copy",
      id: "e0000000-0000-4000-8000-000000000003",
      probeId: PROBE_B,
    });

    expect(
      seen({
        probeIds: [PROBE_A],
        candidates: [officeRouter, secondAtSameAddress],
        projectDevices: [officeRouter, secondAtSameAddress],
        sites: [],
      }),
    ).toBe("office-router");
  });
});

describe("devices nobody has put in a site yet, in a project with sites", () => {
  // Imported from site A's scan, never placed in site A.
  const unplacedInA: TestDevice = device({
    name: "unplaced-in-a",
    id: "f0000000-0000-4000-8000-00000000000a",
    probeId: PROBE_A,
  });
  // Imported from site C's scan, never placed in site C.
  const unplacedInC: TestDevice = device({
    name: "unplaced-in-c",
    id: "f0000000-0000-4000-8000-00000000000c",
    probeId: PROBE_C,
  });

  it("a site's probe sees the unplaced device it polls", () => {
    expect(
      seen({
        probeIds: [PROBE_A],
        candidates: [unplacedInA],
        projectDevices: [unplacedInA, unplacedInC],
      }),
    ).toBe("unplaced-in-a");
  });

  it("but not another probe's unplaced device at the same address", () => {
    /*
     * Probe C is site C's default probe and polls an unplaced device of its
     * own: it looks into site C, not into every unplaced device.
     */
    expect(
      seen({
        probeIds: [PROBE_C],
        candidates: [unplacedInA],
        projectDevices: [unplacedInA, unplacedInC],
      }),
    ).toBe("none");
  });
});

describe("probes whose site cannot be known", () => {
  const unplacedRouter: TestDevice = device({
    name: "unplaced-router",
    id: "f1000000-0000-4000-8000-000000000001",
    probeId: PROBE_A,
  });

  it("a scan's host is the one device at the address, wherever it is", () => {
    expect(
      seen({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toBe("branch-a-router");
  });

  it("several devices there are ambiguous, never a free address", () => {
    expect(
      seen({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toBe("ambiguous");
  });

  it("a monitor is not tied to a device in a site", () => {
    expect(
      seen({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("none");
  });

  it("a monitor is tied to the one device at the address when it is in no site", () => {
    expect(
      seen({
        probeIds: [PROBE_FRESH],
        candidates: [unplacedRouter],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("unplaced-router");
  });

  it("a monitor with no probes at all is read the same way", () => {
    expect(
      seen({
        probeIds: [],
        candidates: [BRANCH_A_ROUTER],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("none");
    expect(
      seen({
        probeIds: [],
        candidates: [unplacedRouter],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("unplaced-router");
  });

  it("nor is a monitor tied when two devices share the address", () => {
    expect(
      seen({
        probeIds: [PROBE_FRESH],
        candidates: [
          unplacedRouter,
          device({
            name: "another-unplaced-router",
            id: "f1000000-0000-4000-8000-000000000002",
          }),
        ],
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toBe("ambiguous");
  });
});

/*
 * Each answer says why (issues #9903, #9904, #9905): Review Results says
 * which device a host at a shared address is and why, and a device's page
 * why a monitor on its address could not be tied for a person.
 */
describe("why the probes see what they see at a shared address", () => {
  const projectDevices: Array<TestDevice> = [
    BRANCH_A_ROUTER,
    BRANCH_B_ROUTER,
    BRANCH_A_SWITCH,
    BRANCH_B_SWITCH,
  ];

  it("site A's probe sees site A's device because it polls it", () => {
    expect(
      explained({
        probeIds: [PROBE_A],
        candidates: [BRANCH_B_ROUTER, BRANCH_A_ROUTER],
        projectDevices: projectDevices,
      }),
    ).toEqual({
      kind: "device",
      devices: ["branch-a-router"],
      reason: SeenDeviceReason.PolledByTheProbes,
    });
  });

  it("a probe that polls another device in site A sees site A's as the only one in its sites", () => {
    const spareSwitch: TestDevice = device({
      name: "branch-a-spare-switch",
      id: "d0000000-0000-4000-8000-0000000000a3",
      siteId: SITE_A,
      probeId: PROBE_A_SPARE,
    });

    expect(
      explained({
        probeIds: [PROBE_A_SPARE],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: [...projectDevices, spareSwitch],
      }),
    ).toEqual({
      kind: "device",
      devices: ["branch-a-router"],
      reason: SeenDeviceReason.OnlyOneInTheirSites,
    });
  });

  it("a site's default probe that polls nothing sees its site's device the same way", () => {
    expect(
      explained({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
        sites: [
          { id: SITE_A, probeId: PROBE_FRESH },
          { id: SITE_B, probeId: PROBE_B },
        ],
      }),
    ).toEqual({
      kind: "device",
      devices: ["branch-a-router"],
      reason: SeenDeviceReason.OnlyOneInTheirSites,
    });
  });

  it("site C's probe sees neither: the host there is its own network's", () => {
    const branchCSwitch: TestDevice = device({
      name: "branch-c-switch",
      id: "d0000000-0000-4000-8000-0000000000c2",
      siteId: SITE_C,
      probeId: PROBE_C,
    });

    expect(
      explained({
        probeIds: [PROBE_C],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: [...projectDevices, branchCSwitch],
      }),
    ).toEqual({
      kind: "none",
      devices: [],
      reason: NoDeviceReason.NoneInTheirSites,
    });
  });

  it("probes in both sites poll both devices: the two cannot be told apart", () => {
    expect(
      explained({
        probeIds: [PROBE_A, PROBE_B],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
      }),
    ).toEqual({
      kind: "ambiguous",
      devices: ["branch-a-router", "branch-b-router"],
      reason: AmbiguousAddressReason.PollSeveral,
    });
  });

  it("a probe that is both sites' default, and polls neither device, looks into both", () => {
    expect(
      explained({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
        sites: [
          { id: SITE_A, probeId: PROBE_FRESH },
          { id: SITE_B, probeId: PROBE_FRESH },
        ],
      }),
    ).toEqual({
      kind: "ambiguous",
      devices: ["branch-a-router", "branch-b-router"],
      reason: AmbiguousAddressReason.SeveralInTheirSites,
    });
  });

  it("a probe nobody's site names, polling nothing, cannot tell the two apart", () => {
    expect(
      explained({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
      }),
    ).toEqual({
      kind: "ambiguous",
      devices: ["branch-a-router", "branch-b-router"],
      reason: AmbiguousAddressReason.ReachUnknown,
    });
  });

  it("nor can a monitor with no probes", () => {
    expect(
      explained({
        probeIds: [],
        candidates: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
        projectDevices: projectDevices,
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toEqual({
      kind: "ambiguous",
      devices: ["branch-a-router", "branch-b-router"],
      reason: AmbiguousAddressReason.ReachUnknown,
    });
  });

  it("where the probes look is unknown, one site's device is a scan's host but no monitor's", () => {
    expect(
      explained({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER],
        projectDevices: projectDevices,
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toEqual({
      kind: "device",
      devices: ["branch-a-router"],
      reason: SeenDeviceReason.OnlyOneAtTheAddress,
    });
    expect(
      explained({
        probeIds: [PROBE_FRESH],
        candidates: [BRANCH_A_ROUTER],
        projectDevices: projectDevices,
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      }),
    ).toEqual({
      kind: "none",
      devices: [],
      reason: NoDeviceReason.ReachUnknownDeviceInASite,
    });
  });

  it("an address no device has is none at the address, whatever the probes", () => {
    expect(
      explained({
        probeIds: [PROBE_A],
        candidates: [],
        projectDevices: projectDevices,
      }),
    ).toEqual({
      kind: "none",
      devices: [],
      reason: NoDeviceReason.NoneAtTheAddress,
    });
  });
});

describe("isAmongDevicesSeen", () => {
  const twoRouters: Array<TestDevice> = [BRANCH_A_ROUTER, BRANCH_B_ROUTER];

  it("names the device the probes pick", () => {
    const picked: DeviceSeenFrom<TestDevice> = seenFrom({
      probeIds: [PROBE_A],
      candidates: twoRouters,
    });

    expect(
      isAmongDevicesSeen({ seen: picked, deviceId: BRANCH_A_ROUTER.id }),
    ).toBe(true);
    expect(
      isAmongDevicesSeen({ seen: picked, deviceId: BRANCH_B_ROUTER.id }),
    ).toBe(false);
  });

  it("names each device the probes cannot tell apart, whatever its case", () => {
    const picked: DeviceSeenFrom<TestDevice> = seenFrom({
      probeIds: [PROBE_A, PROBE_B],
      candidates: twoRouters,
    });

    expect(
      isAmongDevicesSeen({
        seen: picked,
        deviceId: BRANCH_A_ROUTER.id.toUpperCase(),
      }),
    ).toBe(true);
    expect(
      isAmongDevicesSeen({
        seen: picked,
        deviceId: new ObjectID(BRANCH_B_ROUTER.id),
      }),
    ).toBe(true);
    expect(
      isAmongDevicesSeen({
        seen: picked,
        deviceId: BRANCH_A_SWITCH.id,
      }),
    ).toBe(false);
  });

  it("names none when the probes see no device there, or no device is asked about", () => {
    const picked: DeviceSeenFrom<TestDevice> = seenFrom({
      probeIds: [PROBE_C],
      candidates: twoRouters,
    });

    expect(
      isAmongDevicesSeen({ seen: picked, deviceId: BRANCH_A_ROUTER.id }),
    ).toBe(false);
    expect(
      isAmongDevicesSeen({
        seen: seenFrom({ probeIds: [PROBE_A], candidates: twoRouters }),
        deviceId: "",
      }),
    ).toBe(false);
    expect(
      isAmongDevicesSeen({
        seen: seenFrom({ probeIds: [PROBE_A], candidates: twoRouters }),
        deviceId: null,
      }),
    ).toBe(false);
  });
});

describe("pickDeviceSeenFrom", () => {
  const knownReach: ProbeReach = {
    probeIds: new Set<string>([PROBE_A]),
    siteKeys: new Set<string>([SITE_A, SITE_B]),
    isKnown: true,
  };

  it("says none when no device is at the address", () => {
    expect(
      pickDeviceSeenFrom({
        candidates: [],
        reach: knownReach,
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toEqual({ kind: "none", reason: NoDeviceReason.NoneAtTheAddress });
  });

  it("puts the device the probes poll before one in a site they look into", () => {
    const picked: DeviceSeenFrom<TestDevice> = pickDeviceSeenFrom({
      candidates: [BRANCH_B_ROUTER, BRANCH_A_ROUTER],
      reach: knownReach,
      whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
    });

    expect(picked).toEqual({
      kind: "device",
      device: BRANCH_A_ROUTER,
      reason: SeenDeviceReason.PolledByTheProbes,
    });
  });

  it("is ambiguous when the probes poll two devices at one address", () => {
    const copy: TestDevice = device({
      name: "copy",
      id: "d0000000-0000-4000-8000-0000000000ff",
      siteId: SITE_A,
      probeId: PROBE_A,
    });

    expect(
      pickDeviceSeenFrom({
        candidates: [BRANCH_A_ROUTER, copy, BRANCH_B_ROUTER],
        reach: knownReach,
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toEqual({
      kind: "ambiguous",
      // The two it polls, not every device at the address.
      devices: [BRANCH_A_ROUTER, copy],
      reason: AmbiguousAddressReason.PollSeveral,
    });
  });

  it("is ambiguous when two sites they look into each have a device there", () => {
    const inSiteA: TestDevice = device({
      name: "a",
      id: "d0000000-0000-4000-8000-0000000000f1",
      siteId: SITE_A,
    });
    const inSiteB: TestDevice = device({
      name: "b",
      id: "d0000000-0000-4000-8000-0000000000f2",
      siteId: SITE_B,
    });
    const inSiteC: TestDevice = device({
      name: "c",
      id: "d0000000-0000-4000-8000-0000000000f3",
      siteId: SITE_C,
    });

    expect(
      pickDeviceSeenFrom({
        candidates: [inSiteA, inSiteC, inSiteB],
        reach: { ...knownReach, probeIds: new Set<string>([PROBE_FRESH]) },
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toEqual({
      kind: "ambiguous",
      // Site C is not one they look into: its device is not among them.
      devices: [inSiteA, inSiteB],
      reason: AmbiguousAddressReason.SeveralInTheirSites,
    });
  });

  it("reads one device read twice as one", () => {
    expect(
      pickDeviceSeenFrom({
        candidates: [BRANCH_A_ROUTER, { ...BRANCH_A_ROUTER }],
        reach: {
          probeIds: new Set<string>(),
          siteKeys: new Set<string>(),
          isKnown: false,
        },
        whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
      }),
    ).toEqual({
      kind: "device",
      device: BRANCH_A_ROUTER,
      reason: SeenDeviceReason.OnlyOneAtTheAddress,
    });
  });

  it("compares ids whatever their case, and reads a NetworkDevice as it is", () => {
    const stored: NetworkDevice = new NetworkDevice();
    stored.id = new ObjectID(BRANCH_A_ROUTER.id);
    stored.siteId = new ObjectID(SITE_A);
    stored.probeId = new ObjectID(PROBE_A.toUpperCase());

    const picked: DeviceSeenFrom<NetworkDevice> = pickDeviceSeenFrom({
      candidates: [stored],
      reach: {
        probeIds: getProbeIdKeys([PROBE_A]),
        siteKeys: new Set<string>(),
        isKnown: true,
      },
      whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
    });

    expect(picked).toEqual({
      kind: "device",
      device: stored,
      reason: SeenDeviceReason.PolledByTheProbes,
    });
  });
});

describe("toProbeReach", () => {
  function facts(overrides: Partial<ProbeReachFacts>): ProbeReachFacts {
    return {
      probeIds: [PROBE_A],
      sites: [],
      pollsDeviceInASite: false,
      pollsDeviceInNoSite: false,
      isDefaultProbeOfASite: false,
      ...overrides,
    };
  }

  it("knows nothing of no probes", () => {
    expect(
      toProbeReach(facts({ probeIds: [], pollsDeviceInASite: true })),
    ).toEqual({
      probeIds: new Set<string>(),
      siteKeys: new Set<string>(),
      isKnown: false,
    });
  });

  it("knows nothing of probes that poll no device and are no site's default", () => {
    const reach: ProbeReach = toProbeReach(facts({}));

    expect(reach.isKnown).toBe(false);
    expect(Array.from(reach.siteKeys)).toEqual([]);
  });

  it("looks into a site they poll a device in, or that names one their default", () => {
    const reach: ProbeReach = toProbeReach(
      facts({
        sites: [
          { siteKey: SITE_A, hasDevicePolled: true, hasProbeAsDefault: false },
          { siteKey: SITE_B, hasDevicePolled: false, hasProbeAsDefault: true },
          { siteKey: SITE_C, hasDevicePolled: false, hasProbeAsDefault: false },
        ],
        pollsDeviceInASite: true,
        isDefaultProbeOfASite: true,
      }),
    );

    expect(reach.isKnown).toBe(true);
    expect(Array.from(reach.siteKeys).sort()).toEqual([SITE_A, SITE_B].sort());
  });

  it("looks outside the sites only when the probes are no site's", () => {
    expect(
      Array.from(toProbeReach(facts({ pollsDeviceInNoSite: true })).siteKeys),
    ).toEqual([NO_SITE_KEY]);

    expect(
      Array.from(
        toProbeReach(
          facts({ pollsDeviceInNoSite: true, isDefaultProbeOfASite: true }),
        ).siteKeys,
      ),
    ).toEqual([]);

    expect(
      Array.from(
        toProbeReach(
          facts({ pollsDeviceInNoSite: true, pollsDeviceInASite: true }),
        ).siteKeys,
      ),
    ).toEqual([]);
  });

  it("knows where probes look that are a site's but poll nothing asked about", () => {
    const reach: ProbeReach = toProbeReach(
      facts({ isDefaultProbeOfASite: true }),
    );

    expect(reach.isKnown).toBe(true);
    expect(Array.from(reach.siteKeys)).toEqual([]);
  });

  it("never files the network outside the sites as an asked site", () => {
    const reach: ProbeReach = toProbeReach(
      facts({
        sites: [
          {
            siteKey: NO_SITE_KEY,
            hasDevicePolled: true,
            hasProbeAsDefault: true,
          },
        ],
      }),
    );

    expect(reach.isKnown).toBe(false);
    expect(Array.from(reach.siteKeys)).toEqual([]);
  });
});

describe("buildProbeReachIndex and readProbeReachFacts", () => {
  const REGION: string = "90000000-0000-4000-8000-000000000001";
  const MARKET: string = "90000000-0000-4000-8000-000000000002";
  const STORE: string = "90000000-0000-4000-8000-000000000003";

  it("gives a site the default probe of the nearest site above it", () => {
    const index: ProbeReachIndex = buildProbeReachIndex({
      devices: [],
      sites: [
        { id: REGION, probeId: PROBE_A },
        { id: MARKET, parentSiteId: REGION },
        { id: STORE, parentSiteId: MARKET, probeId: PROBE_B },
      ],
    });

    expect(index.defaultProbeBySiteKey.get(MARKET)).toBe(PROBE_A);
    expect(index.defaultProbeBySiteKey.get(STORE)).toBe(PROBE_B);

    const facts: ProbeReachFacts = readProbeReachFacts({
      index: index,
      probeIds: [PROBE_A],
      siteKeys: [MARKET, STORE, NO_SITE_KEY],
    });

    expect(facts.sites).toEqual([
      { siteKey: MARKET, hasDevicePolled: false, hasProbeAsDefault: true },
      { siteKey: STORE, hasDevicePolled: false, hasProbeAsDefault: false },
    ]);
    expect(facts.isDefaultProbeOfASite).toBe(true);
  });

  it("stops at a loop of sites rather than following it for ever", () => {
    const index: ProbeReachIndex = buildProbeReachIndex({
      devices: [],
      sites: [
        { id: MARKET, parentSiteId: STORE },
        { id: STORE, parentSiteId: MARKET },
      ],
    });

    expect(index.defaultProbeBySiteKey.size).toBe(0);
  });

  it("files every device under the probe that polls it", () => {
    const facts: ProbeReachFacts = readProbeReachFacts({
      index: buildProbeReachIndex({
        devices: [
          BRANCH_A_ROUTER,
          device({
            name: "unplaced",
            id: "f2000000-0000-4000-8000-000000000001",
            probeId: PROBE_A,
          }),
          device({
            name: "unpolled",
            id: "f2000000-0000-4000-8000-000000000002",
          }),
        ],
        sites: SITES,
      }),
      probeIds: [PROBE_A.toUpperCase()],
      siteKeys: [SITE_A, SITE_B],
    });

    expect(facts).toEqual({
      probeIds: [PROBE_A],
      sites: [
        { siteKey: SITE_A, hasDevicePolled: true, hasProbeAsDefault: true },
        { siteKey: SITE_B, hasDevicePolled: false, hasProbeAsDefault: false },
      ],
      pollsDeviceInASite: true,
      pollsDeviceInNoSite: true,
      isDefaultProbeOfASite: true,
    });
  });
});

describe("helpers", () => {
  it("reads ids and site keys as the rule compares them", () => {
    expect(toIdKey(new ObjectID(PROBE_A.toUpperCase()))).toBe(PROBE_A);
    expect(toIdKey(null)).toBe("");
    expect(toIdKey(undefined)).toBe("");
    expect(getSiteKey(undefined)).toBe(NO_SITE_KEY);
    expect(Array.from(getProbeIdKeys([PROBE_A, "", null, PROBE_A]))).toEqual([
      PROBE_A,
    ]);
  });

  it("lists the sites of the devices at an address once each", () => {
    expect(
      getSiteKeysOf([
        BRANCH_A_ROUTER,
        BRANCH_A_SWITCH,
        device({
          name: "unplaced",
          id: "f3000000-0000-4000-8000-000000000001",
        }),
      ]).sort(),
    ).toEqual([NO_SITE_KEY, SITE_A].sort());
  });

  it("says when a device the probes poll decides it without asking more", () => {
    expect(
      isDecidedByPolledDevice({
        candidates: [BRANCH_B_ROUTER, BRANCH_A_ROUTER],
        probeIds: [PROBE_A],
      }),
    ).toBe(true);
    expect(
      isDecidedByPolledDevice({
        candidates: [BRANCH_B_ROUTER],
        probeIds: [PROBE_A],
      }),
    ).toBe(false);
  });
});

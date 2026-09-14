import DeviceMacLearningUtil, {
  MacLearningCandidateDevice,
  MacLearningIpBinding,
  MacLearningPlanEntry,
  siteKeyOf,
} from "../../../Utils/Monitor/DeviceMacLearningUtil";

/*
 * The planner decides which managed devices get a MAC written from a walked
 * router's ARP table. Every rule in it is a refusal, and every refusal exists
 * because the alternative draws a WRONG cable on the topology - a register
 * hung off another store's switch, a handset flip-flopping between two
 * routers' opinions. So the cases here are mostly about what is NOT planned,
 * and about the one thing that is: exactly one device, at exactly one
 * address, bound to exactly one MAC, in the router's own site, with nothing
 * in its MAC column yet.
 *
 * Pure and deterministic, so it is pinned without a database; the server
 * util that applies the plan is covered in
 * Tests/Server/Utils/Monitor/NetworkDeviceMacLearningUtil.test.ts.
 */

const SITE_A: string = "site-a";
const SITE_B: string = "site-b";

const REGISTER_IP: string = "10.0.0.5";
const REGISTER_MAC: string = "aa:bb:cc:dd:ee:01";
const HANDSET_IP: string = "10.0.0.6";
const HANDSET_MAC: string = "aa:bb:cc:dd:ee:02";

function binding(ipAddress: string, macAddress: string): MacLearningIpBinding {
  return { ipAddress, macAddress };
}

function device(
  id: string,
  hostname: string | undefined,
  overrides?: Partial<MacLearningCandidateDevice>,
): MacLearningCandidateDevice {
  return { id, hostname, ...overrides };
}

function plan(data: {
  ipBindings: Array<MacLearningIpBinding>;
  devices: Array<MacLearningCandidateDevice>;
  observingSiteId?: string | null | undefined;
}): Array<MacLearningPlanEntry> {
  return DeviceMacLearningUtil.planMacLearning(data);
}

describe("DeviceMacLearningUtil.siteKeyOf", () => {
  it("reads null, undefined, empty and whitespace as the same no-site key", () => {
    expect(siteKeyOf(null)).toBe("");
    expect(siteKeyOf(undefined)).toBe("");
    expect(siteKeyOf("")).toBe("");
    expect(siteKeyOf("   ")).toBe("");
  });

  it("trims a real site id so a padded value still keys the same site", () => {
    expect(siteKeyOf(SITE_A)).toBe(SITE_A);
    expect(siteKeyOf(`  ${SITE_A}  `)).toBe(SITE_A);
  });
});

describe("DeviceMacLearningUtil.planMacLearning", () => {
  it("plans the one device at a bound address, in the router's site, with an empty MAC", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([
      {
        deviceId: "register",
        macAddress: REGISTER_MAC,
        previousMacAddress: null,
        ipAddress: REGISTER_IP,
      },
    ]);
  });

  it("writes the MAC in normalized colon form whatever form the ARP table used", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, "AA-BB-CC-DD-EE-01")],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.macAddress).toBe(REGISTER_MAC);
  });

  it("refuses a device in a different site from the router", () => {
    /*
     * Every branch has a 10.0.0.5. The router at site A binding that address
     * says nothing about the register registered at site B.
     */
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("register", REGISTER_IP, { siteId: SITE_B })],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("plans a device with no site when the router has no site either", () => {
    // A project that never set up sites: everything shares the no-site key.
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("register", REGISTER_IP)],
      observingSiteId: undefined,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.deviceId).toBe("register");
  });

  it("refuses a device with a site when the router has none", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: undefined,
    });

    expect(result).toEqual([]);
  });

  it("refuses a device with no site when the router has one", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("register", REGISTER_IP)],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("treats a null router site the same as an undefined one", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("register", REGISTER_IP, { siteId: "" })],
      observingSiteId: null,
    });

    expect(result).toHaveLength(1);
  });

  it("refuses a device that already carries a MAC", () => {
    /*
     * What an operator typed is theirs; what an earlier walk learned is
     * left for the topology to reconcile rather than flip-flopped between
     * two routers' tables.
     */
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [
        device("register", REGISTER_IP, {
          siteId: SITE_A,
          macAddress: "00:11:22:33:44:55",
        }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("reads an empty-string or whitespace MAC column as empty", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [
        binding(REGISTER_IP, REGISTER_MAC),
        binding(HANDSET_IP, HANDSET_MAC),
      ],
      devices: [
        device("handset", HANDSET_IP, { siteId: SITE_A, macAddress: "   " }),
        device("register", REGISTER_IP, { siteId: SITE_A, macAddress: "" }),
      ],
      observingSiteId: SITE_A,
    });

    expect(
      result.map((entry: MacLearningPlanEntry) => {
        return entry.deviceId;
      }),
    ).toEqual(["handset", "register"]);
  });

  it("refuses an address two devices are registered at, and still plans the rest", () => {
    /*
     * Two devices at one address is a contradiction the planner cannot
     * resolve - but it is a contradiction about THAT address only, so the
     * handset at its own address is still planned in the same call.
     */
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [
        binding(REGISTER_IP, REGISTER_MAC),
        binding(HANDSET_IP, HANDSET_MAC),
      ],
      devices: [
        device("register-1", REGISTER_IP, { siteId: SITE_A }),
        device("register-2", REGISTER_IP, { siteId: SITE_A }),
        device("handset", HANDSET_IP, { siteId: SITE_A }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([
      {
        deviceId: "handset",
        macAddress: HANDSET_MAC,
        previousMacAddress: null,
        ipAddress: HANDSET_IP,
      },
    ]);
  });

  it("a second device at the address in ANOTHER site does not make the first ambiguous", () => {
    // Site scoping runs before the one-device-per-address count.
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [
        device("register-a", REGISTER_IP, { siteId: SITE_A }),
        device("register-b", REGISTER_IP, { siteId: SITE_B }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.deviceId).toBe("register-a");
  });

  it("refuses an address the ARP table binds to two different MACs", () => {
    // Proxy ARP, or a stale duplicate: neither MAC can be trusted.
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [
        binding(REGISTER_IP, REGISTER_MAC),
        binding(REGISTER_IP, "aa:bb:cc:dd:ee:99"),
      ],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("one MAC written in two spellings is still one MAC", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [
        binding(REGISTER_IP, "AA:BB:CC:DD:EE:01"),
        binding(REGISTER_IP, "aabb.ccdd.ee01"),
      ],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.macAddress).toBe(REGISTER_MAC);
  });

  it("tolerates whitespace around the device hostname and the bound address", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(`  ${REGISTER_IP}  `, REGISTER_MAC)],
      devices: [device("register", ` ${REGISTER_IP} `, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.ipAddress).toBe(REGISTER_IP);
  });

  it("ignores a binding whose MAC cannot be parsed", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, "not-a-mac")],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("an unparseable MAC beside a good one does not make the address ambiguous", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [
        binding(REGISTER_IP, "zz:zz:zz:zz:zz:zz"),
        binding(REGISTER_IP, REGISTER_MAC),
      ],
      devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.macAddress).toBe(REGISTER_MAC);
  });

  it("ignores a binding with a blank address and a device with no hostname", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding("   ", REGISTER_MAC), binding("", HANDSET_MAC)],
      devices: [
        device("nameless", undefined, { siteId: SITE_A }),
        device("blank", "   ", { siteId: SITE_A }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("a device at an address the ARP table never bound is not planned", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [device("handset", HANDSET_IP, { siteId: SITE_A })],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("plans nothing from empty bindings or an empty device list", () => {
    expect(
      plan({
        ipBindings: [],
        devices: [device("register", REGISTER_IP, { siteId: SITE_A })],
        observingSiteId: SITE_A,
      }),
    ).toEqual([]);

    expect(
      plan({
        ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
        devices: [],
        observingSiteId: SITE_A,
      }),
    ).toEqual([]);
  });

  it("orders the plan by device id regardless of input order", () => {
    /*
     * The same input must plan the same writes in the same order - the
     * server util applies them one by one, and a log that reads differently
     * on every walk is a log nobody can diff.
     */
    const bindings: Array<MacLearningIpBinding> = [
      binding("10.0.0.3", "aa:bb:cc:dd:ee:03"),
      binding("10.0.0.1", "aa:bb:cc:dd:ee:01"),
      binding("10.0.0.2", "aa:bb:cc:dd:ee:02"),
    ];

    const forward: Array<MacLearningPlanEntry> = plan({
      ipBindings: bindings,
      devices: [
        device("c", "10.0.0.3", { siteId: SITE_A }),
        device("a", "10.0.0.1", { siteId: SITE_A }),
        device("b", "10.0.0.2", { siteId: SITE_A }),
      ],
      observingSiteId: SITE_A,
    });

    const reversed: Array<MacLearningPlanEntry> = plan({
      ipBindings: [...bindings].reverse(),
      devices: [
        device("b", "10.0.0.2", { siteId: SITE_A }),
        device("a", "10.0.0.1", { siteId: SITE_A }),
        device("c", "10.0.0.3", { siteId: SITE_A }),
      ],
      observingSiteId: SITE_A,
    });

    const ids: (entries: Array<MacLearningPlanEntry>) => Array<string> = (
      entries: Array<MacLearningPlanEntry>,
    ): Array<string> => {
      return entries.map((entry: MacLearningPlanEntry) => {
        return entry.deviceId;
      });
    };

    expect(ids(forward)).toEqual(["a", "b", "c"]);
    expect(ids(reversed)).toEqual(["a", "b", "c"]);
    expect(reversed).toEqual(forward);
  });

  it("returns a fresh array and leaves both inputs untouched", () => {
    const bindings: Array<MacLearningIpBinding> = [
      binding(HANDSET_IP, "AA-BB-CC-DD-EE-02"),
      binding(REGISTER_IP, REGISTER_MAC),
    ];
    const devices: Array<MacLearningCandidateDevice> = [
      device("register", ` ${REGISTER_IP} `, { siteId: SITE_A }),
      device("handset", HANDSET_IP, { siteId: SITE_A, macAddress: "" }),
    ];
    const bindingsBefore: Array<MacLearningIpBinding> = JSON.parse(
      JSON.stringify(bindings),
    );
    const devicesBefore: Array<MacLearningCandidateDevice> = JSON.parse(
      JSON.stringify(devices),
    );

    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: bindings,
      devices: devices,
      observingSiteId: SITE_A,
    });

    expect(result).toHaveLength(2);
    expect(result).not.toBe(bindings);
    expect(result).not.toBe(devices);
    // Normalization happened on the way out, never in place.
    expect(bindings).toEqual(bindingsBefore);
    expect(devices).toEqual(devicesBefore);
  });
});

/*
 * A learned value is the pass's own answer, and an ARP table is exactly
 * the evidence that goes stale - so the pass may correct itself, and only
 * itself. What an operator typed is never touched.
 */
describe("DeviceMacLearningUtil.planMacLearning — correcting a learned MAC", () => {
  const STALE_MAC: string = "de:ad:be:ef:00:01";

  it("corrects a learned MAC the table now contradicts, compare-and-set on the old value", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [
        device("register", REGISTER_IP, {
          siteId: SITE_A,
          macAddress: STALE_MAC,
          isMacAddressLearned: true,
        }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([
      {
        deviceId: "register",
        macAddress: REGISTER_MAC,
        previousMacAddress: STALE_MAC,
        ipAddress: REGISTER_IP,
      },
    ]);
  });

  it("leaves a typed MAC alone however much the table disagrees", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [
        device("register", REGISTER_IP, {
          siteId: SITE_A,
          macAddress: STALE_MAC,
          isMacAddressLearned: false,
        }),
        device("handset", "10.0.0.6", {
          siteId: SITE_A,
          macAddress: STALE_MAC,
        }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("plans nothing for a learned MAC the table still agrees with, in any spelling", () => {
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [
        device("register", REGISTER_IP, {
          siteId: SITE_A,
          macAddress: REGISTER_MAC.toUpperCase().replace(/:/g, "-"),
          isMacAddressLearned: true,
        }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result).toEqual([]);
  });

  it("hands the writer the stored value verbatim, so its compare-and-set matches the column", () => {
    const storedSpelling: string = "DE-AD-BE-EF-00-01";
    const result: Array<MacLearningPlanEntry> = plan({
      ipBindings: [binding(REGISTER_IP, REGISTER_MAC)],
      devices: [
        device("register", REGISTER_IP, {
          siteId: SITE_A,
          macAddress: storedSpelling,
          isMacAddressLearned: true,
        }),
      ],
      observingSiteId: SITE_A,
    });

    expect(result[0]?.previousMacAddress).toBe(storedSpelling);
  });
});

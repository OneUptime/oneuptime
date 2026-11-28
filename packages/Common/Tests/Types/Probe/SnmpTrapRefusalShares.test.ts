import {
  DNS_NAMED_ACME_PROJECT_ID,
  DNS_NAMED_DEVICES,
  DNS_NAMED_GLOBEX_PROJECT_ID,
  DnsNamedDevice,
  DnsNamedDeviceKey,
  refusedDnsNamedTraps,
} from "../../Helpers/Snmp/DnsNamedDeviceSnmpV3Traps";
import {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  MAX_SNMP_TRAP_REFUSAL_DEVICES,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";
import SnmpTrapRefusalShares, {
  SnmpTrapRefusalShareDevice,
} from "../../../Types/Probe/SnmpTrapRefusalShares";
import { describe, expect, test } from "@jest/globals";

/*
 * A GLOBAL PROBE'S REFUSED SNMPv3 TRAPS, SPLIT BY PROJECT (#11173, #11406).
 *
 * A global probe serves many projects, and what it refused names source
 * addresses and user names. Each refusal goes to the one project whose
 * device has its source address - typed, or what its DNS name resolves to -
 * worded as that project would see it and naming that project's devices it
 * came from, and to nobody else: the point of every test here is what a
 * project must NOT read.
 */

const ACME: string = "11730000-0000-4000-8000-00000000ac0e";
const GLOBEX: string = "11730000-0000-4000-8000-000000060be8";

function refusal(fields: Partial<SnmpTrapRefusal>): SnmpTrapRefusal {
  return {
    sourceAddress: "203.0.113.10",
    reason: SnmpTrapRefusalReason.UnknownUser,
    userName: "san-monitor",
    count: 3,
    firstSeenAt: "2026-11-27T08:00:00.000Z",
    lastSeenAt: "2026-11-27T09:00:00.000Z",
    ...fields,
  };
}

let deviceCount: number = 0;

function device(
  projectId: string,
  ...addresses: Array<string>
): SnmpTrapRefusalShareDevice {
  deviceCount++;

  return {
    id: `11406000-0000-4000-8000-${String(deviceCount).padStart(12, "0")}`,
    projectId: projectId,
    addresses: addresses,
  };
}

// The refusal as a share keeps it: naming the devices it came from.
function from(
  kept: SnmpTrapRefusal,
  ...devices: Array<SnmpTrapRefusalShareDevice>
): SnmpTrapRefusal {
  return {
    ...kept,
    deviceIds: devices
      .map((sender: SnmpTrapRefusalShareDevice): string => {
        return sender.id;
      })
      .sort(),
  };
}

function split(data: {
  refusals: Array<SnmpTrapRefusal>;
  devices: Array<SnmpTrapRefusalShareDevice>;
  userNamesByProject?: Record<string, Array<string>>;
}): Record<string, Array<SnmpTrapRefusal>> {
  const shares: Map<
    string,
    Array<SnmpTrapRefusal>
  > = SnmpTrapRefusalShares.split({
    refusals: data.refusals,
    devices: data.devices,
    userNamesByProject: new Map(
      Object.entries(data.userNamesByProject || {}).map(
        ([projectId, names]: [string, Array<string>]) => {
          return [projectId, new Set(names)];
        },
      ),
    ),
  });

  return Object.fromEntries(shares);
}

describe("which project a refusal goes to", () => {
  test("the one project whose device has its source address", () => {
    const acmes: SnmpTrapRefusal = refusal({ sourceAddress: "203.0.113.10" });
    const globexs: SnmpTrapRefusal = refusal({
      sourceAddress: "198.51.100.20",
      userName: "globex-traps",
    });

    const acmeSwitch: SnmpTrapRefusalShareDevice = device(ACME, "203.0.113.10");
    const globexSwitch: SnmpTrapRefusalShareDevice = device(
      GLOBEX,
      "198.51.100.20",
    );

    expect(
      split({
        refusals: [acmes, globexs],
        devices: [acmeSwitch, globexSwitch],
      }),
    ).toEqual({
      [ACME]: [from(acmes, acmeSwitch)],
      [GLOBEX]: [from(globexs, globexSwitch)],
    });
  });

  test("never a refusal from another project's address, nor its user name", () => {
    const shares: Record<string, Array<SnmpTrapRefusal>> = split({
      refusals: [
        refusal({ sourceAddress: "203.0.113.10", userName: "acme-secret-ish" }),
        refusal({ sourceAddress: "198.51.100.20", userName: "globex-only" }),
      ],
      devices: [device(ACME, "203.0.113.10"), device(GLOBEX, "198.51.100.20")],
    });

    expect(JSON.stringify(shares[ACME])).not.toContain("198.51.100.20");
    expect(JSON.stringify(shares[ACME])).not.toContain("globex-only");
    expect(JSON.stringify(shares[GLOBEX])).not.toContain("203.0.113.10");
    expect(JSON.stringify(shares[GLOBEX])).not.toContain("acme-secret-ish");
  });

  test("an address no device has goes to nobody: a probe on the internet hears every scanner", () => {
    expect(
      split({
        refusals: [refusal({ sourceAddress: "192.0.2.99" })],
        devices: [device(ACME, "203.0.113.10")],
      }),
    ).toEqual({});
  });

  test("an address devices of two projects have goes to neither: each would read the other's user name", () => {
    expect(
      split({
        refusals: [refusal({ sourceAddress: "203.0.113.10" })],
        devices: [device(ACME, "203.0.113.10"), device(GLOBEX, "203.0.113.10")],
      }),
    ).toEqual({});
  });

  test("several devices of one project at one address (a NAT) are still that project's", () => {
    const behindNat: SnmpTrapRefusal = refusal({
      sourceAddress: "203.0.113.10",
    });
    const first: SnmpTrapRefusalShareDevice = device(
      ACME,
      "10.0.0.1",
      "203.0.113.10",
    );
    const second: SnmpTrapRefusalShareDevice = device(
      ACME,
      "10.0.0.2",
      "203.0.113.10",
    );

    expect(
      split({
        refusals: [behindNat],
        devices: [first, second],
      }),
    ).toEqual({ [ACME]: [from(behindNat, first, second)] });
  });

  test("a device's Other Addresses count, IPv6 however it is written", () => {
    const v6: SnmpTrapRefusal = refusal({ sourceAddress: "2001:db8::10" });
    const dualStack: SnmpTrapRefusalShareDevice = device(
      ACME,
      "10.0.0.1",
      "2001:DB8:0:0::10",
    );

    expect(
      split({
        refusals: [v6],
        devices: [dualStack],
      }),
    ).toEqual({ [ACME]: [from(v6, dualStack)] });
  });

  test("a device with no address, or a name, takes nothing", () => {
    expect(
      split({
        refusals: [refusal({})],
        devices: [device(ACME), device(GLOBEX, "switch-01.example.com", "")],
      }),
    ).toEqual({});
  });
});

describe("the reason, as the project would see it", () => {
  test("a reason only a known user can have reads as an unknown user to a project without that name", () => {
    for (const reason of [
      SnmpTrapRefusalReason.WrongDigest,
      SnmpTrapRefusalReason.DecryptionError,
      SnmpTrapRefusalReason.NotInTimeWindow,
      SnmpTrapRefusalReason.UnsupportedSecurityLevel,
    ]) {
      const shares: Record<string, Array<SnmpTrapRefusal>> = split({
        refusals: [refusal({ reason: reason, userName: "monitor" })],
        devices: [device(ACME, "203.0.113.10")],
        // Another project gave the probe "monitor"; Acme did not.
        userNamesByProject: { [GLOBEX]: ["monitor"] },
      });

      expect(shares[ACME]?.[0]?.reason).toBe(SnmpTrapRefusalReason.UnknownUser);
    }
  });

  test("and as it was to a project that has that user name", () => {
    for (const reason of [
      SnmpTrapRefusalReason.WrongDigest,
      SnmpTrapRefusalReason.DecryptionError,
      SnmpTrapRefusalReason.NotInTimeWindow,
      SnmpTrapRefusalReason.UnsupportedSecurityLevel,
    ]) {
      expect(
        split({
          refusals: [refusal({ reason: reason, userName: "monitor" })],
          devices: [device(ACME, "203.0.113.10")],
          userNamesByProject: { [ACME]: ["monitor"] },
        })[ACME]?.[0]?.reason,
      ).toBe(reason);
    }
  });

  test("an unknown user, and an inform to another engine ID, read as they were", () => {
    for (const reason of [
      SnmpTrapRefusalReason.UnknownUser,
      SnmpTrapRefusalReason.UnknownEngineId,
    ]) {
      expect(
        split({
          refusals: [refusal({ reason: reason })],
          devices: [device(ACME, "203.0.113.10")],
        })[ACME]?.[0]?.reason,
      ).toBe(reason);
    }
  });

  test("two reasons that read as one are one row, counted together, from first to last", () => {
    const acmeSwitch: SnmpTrapRefusalShareDevice = device(ACME, "203.0.113.10");

    expect(
      split({
        refusals: [
          refusal({
            reason: SnmpTrapRefusalReason.WrongDigest,
            count: 2,
            firstSeenAt: "2026-11-27T07:00:00.000Z",
            lastSeenAt: "2026-11-27T08:00:00.000Z",
          }),
          refusal({
            reason: SnmpTrapRefusalReason.UnknownUser,
            count: 5,
            firstSeenAt: "2026-11-27T07:30:00.000Z",
            lastSeenAt: "2026-11-27T09:30:00.000Z",
          }),
        ],
        devices: [acmeSwitch],
      })[ACME],
    ).toEqual([
      from(
        refusal({
          reason: SnmpTrapRefusalReason.UnknownUser,
          count: 7,
          firstSeenAt: "2026-11-27T07:00:00.000Z",
          lastSeenAt: "2026-11-27T09:30:00.000Z",
        }),
        acmeSwitch,
      ),
    ]);
  });
});

test("each share is the most recent first, at most a report's worth", () => {
  const refusals: Array<SnmpTrapRefusal> = Array.from(
    { length: MAX_REPORTED_SNMP_TRAP_REFUSALS + 10 },
    (_: unknown, index: number) => {
      return refusal({
        userName: `user-${index}`,
        lastSeenAt: new Date(Date.UTC(2026, 10, 27, 0, index)).toISOString(),
      });
    },
  );

  const share: Array<SnmpTrapRefusal> =
    split({ refusals: refusals, devices: [device(ACME, "203.0.113.10")] })[
      ACME
    ] || [];

  expect(share).toHaveLength(MAX_REPORTED_SNMP_TRAP_REFUSALS);
  expect(share[0]?.userName).toBe(
    `user-${MAX_REPORTED_SNMP_TRAP_REFUSALS + 9}`,
  );

  for (let index: number = 1; index < share.length; index++) {
    expect(share[index - 1]!.lastSeenAt >= share[index]!.lastSeenAt).toBe(true);
  }
});

test("a user name is compared as a refusal shows it", () => {
  expect(SnmpTrapRefusalShares.toRefusalUserName("bad\u0007name")).toBe(
    "bad?name",
  );
  expect(SnmpTrapRefusalShares.toRefusalUserName("x".repeat(40))).toBe(
    "x".repeat(32),
  );
});

describe("a device added by its DNS name (#11406)", () => {
  /*
   * As SnmpTrapReceiverReports reads it: the address its name resolved to
   * is one of its addresses, beside what was typed in.
   */
  test("the address its name resolves to is its own: its project's share has the refusal, naming it", () => {
    const dnsNamed: SnmpTrapRefusalShareDevice = device(ACME, "198.51.100.7");
    const refused: SnmpTrapRefusal = refusal({
      sourceAddress: "198.51.100.7",
    });

    expect(split({ refusals: [refused], devices: [dnsNamed] })).toEqual({
      [ACME]: [from(refused, dnsNamed)],
    });
  });

  test("a name that resolves to an address another project's device has typed in gives the refusal to neither", () => {
    expect(
      split({
        refusals: [refusal({ sourceAddress: "198.51.100.7" })],
        devices: [
          // Globex typed the address; Acme's name resolves to it.
          device(GLOBEX, "198.51.100.7"),
          device(ACME, "198.51.100.7"),
        ],
      }),
    ).toEqual({});
  });

  test("two projects' names that resolve to one address give it to neither", () => {
    expect(
      split({
        refusals: [
          refusal({ sourceAddress: "198.51.100.7", userName: "acme-traps" }),
        ],
        devices: [device(ACME, "198.51.100.7"), device(GLOBEX, "198.51.100.7")],
      }),
    ).toEqual({});
  });

  test("a name and a typed address of one project at one address: that project's, naming both", () => {
    const typed: SnmpTrapRefusalShareDevice = device(ACME, "198.51.100.7");
    const named: SnmpTrapRefusalShareDevice = device(ACME, "198.51.100.7");
    const refused: SnmpTrapRefusal = refusal({
      sourceAddress: "198.51.100.7",
    });

    expect(
      split({ refusals: [refused], devices: [named, typed] })[ACME],
    ).toEqual([from(refused, typed, named)]);
  });

  test("a device that has an address several ways is named once", () => {
    const everyWay: SnmpTrapRefusalShareDevice = device(
      ACME,
      "198.51.100.7",
      "198.51.100.7",
      "198.51.100.7",
    );
    const refused: SnmpTrapRefusal = refusal({
      sourceAddress: "198.51.100.7",
    });

    expect(
      split({ refusals: [refused], devices: [everyWay] })[ACME]?.[0]?.deviceIds,
    ).toEqual([everyWay.id]);
  });

  test("a share names only its own project's devices, never another's", () => {
    const acmeDevice: SnmpTrapRefusalShareDevice = device(ACME, "198.51.100.7");
    const globexDevice: SnmpTrapRefusalShareDevice = device(
      GLOBEX,
      "198.51.100.8",
    );

    const shares: Record<string, Array<SnmpTrapRefusal>> = split({
      refusals: [
        refusal({ sourceAddress: "198.51.100.7" }),
        refusal({ sourceAddress: "198.51.100.8" }),
      ],
      devices: [acmeDevice, globexDevice],
    });

    expect(JSON.stringify(shares[ACME])).not.toContain(globexDevice.id);
    expect(JSON.stringify(shares[GLOBEX])).not.toContain(acmeDevice.id);
    expect(shares[ACME]?.[0]?.deviceIds).toEqual([acmeDevice.id]);
    expect(shares[GLOBEX]?.[0]?.deviceIds).toEqual([globexDevice.id]);
  });

  test("a device with no ID still says whose its address is: two projects there is still nobody's", () => {
    expect(
      split({
        refusals: [refusal({ sourceAddress: "198.51.100.7" })],
        devices: [
          device(ACME, "198.51.100.7"),
          { id: "", projectId: GLOBEX, addresses: ["198.51.100.7"] },
        ],
      }),
    ).toEqual({});
  });

  test(`a refusal names at most ${MAX_SNMP_TRAP_REFUSAL_DEVICES} devices, in order`, () => {
    const many: Array<SnmpTrapRefusalShareDevice> = Array.from(
      { length: MAX_SNMP_TRAP_REFUSAL_DEVICES + 5 },
      (): SnmpTrapRefusalShareDevice => {
        return device(ACME, "198.51.100.7");
      },
    ).reverse();

    const named: Array<string> =
      split({
        refusals: [refusal({ sourceAddress: "198.51.100.7" })],
        devices: many,
      })[ACME]?.[0]?.deviceIds || [];

    expect(named).toHaveLength(MAX_SNMP_TRAP_REFUSAL_DEVICES);
    expect(named).toEqual([...named].sort());
  });
});

describe("the recorded refusals of devices added by DNS names, on a global probe (#11406)", () => {
  // What SnmpTrapReceiverReports hands the split for each recorded device.
  function onTheProbe(
    keys: Array<DnsNamedDeviceKey>,
  ): Array<SnmpTrapRefusalShareDevice> {
    return keys.map((key: DnsNamedDeviceKey): SnmpTrapRefusalShareDevice => {
      const recorded: DnsNamedDevice = DNS_NAMED_DEVICES[key];

      return {
        id: recorded.id,
        projectId: recorded.projectId,
        addresses: [
          ...(recorded.resolvesTo.length === 0 ? [recorded.hostname] : []),
          ...recorded.resolvesTo,
        ],
      };
    });
  }

  const shares: Record<string, Array<SnmpTrapRefusal>> = split({
    refusals: refusedDnsNamedTraps(),
    devices: onTheProbe([
      "acmeCore",
      "acmeEdge",
      "globexDist",
      "acmeBranch",
      "globexNat",
      "acmeLab",
      "globexLab",
    ]),
    userNamesByProject: { [DNS_NAMED_ACME_PROJECT_ID]: ["acme-edge"] },
  });

  function sources(projectId: string): Array<string> {
    return (shares[projectId] || []).map((kept: SnmpTrapRefusal): string => {
      return kept.sourceAddress;
    });
  }

  test("Acme's devices named by DNS get their refusals, each naming the device it came from", () => {
    expect(sources(DNS_NAMED_ACME_PROJECT_ID).sort()).toEqual([
      "127.0.11.6",
      "127.0.11.7",
    ]);

    const byAddress: Map<string, SnmpTrapRefusal> = new Map(
      (shares[DNS_NAMED_ACME_PROJECT_ID] || []).map(
        (kept: SnmpTrapRefusal): [string, SnmpTrapRefusal] => {
          return [kept.sourceAddress, kept];
        },
      ),
    );

    expect(byAddress.get("127.0.11.6")).toMatchObject({
      userName: "acme-core",
      reason: SnmpTrapRefusalReason.UnknownUser,
      deviceIds: [DNS_NAMED_DEVICES.acmeCore.id],
    });

    // Acme handed the probe "acme-edge": its wrong key reads as one.
    expect(byAddress.get("127.0.11.7")).toMatchObject({
      userName: "acme-edge",
      reason: SnmpTrapRefusalReason.WrongDigest,
      deviceIds: [DNS_NAMED_DEVICES.acmeEdge.id],
    });
  });

  test("Globex's gets its own, and nothing of Acme's", () => {
    expect(shares[DNS_NAMED_GLOBEX_PROJECT_ID]).toEqual([
      expect.objectContaining({
        sourceAddress: "127.0.11.8",
        userName: "globex-dist",
        reason: SnmpTrapRefusalReason.UnknownUser,
        deviceIds: [DNS_NAMED_DEVICES.globexDist.id],
      }),
    ]);

    const globex: string = JSON.stringify(shares[DNS_NAMED_GLOBEX_PROJECT_ID]);

    for (const acmeOnly of [
      "acme-core",
      "acme-edge",
      "127.0.11.6",
      "127.0.11.7",
      DNS_NAMED_DEVICES.acmeCore.id,
      DNS_NAMED_DEVICES.acmeEdge.id,
    ]) {
      expect(globex).not.toContain(acmeOnly);
    }
  });

  test("the address Acme typed in and Globex's name resolves to is nobody's, and so is the one both names resolve to, and the scanner's", () => {
    const everything: string = JSON.stringify(shares);

    for (const nobodys of [
      "127.0.11.9",
      "nat-member",
      "127.0.11.10",
      "scanner",
    ]) {
      expect(everything).not.toContain(nobodys);
    }
  });

  test("on Acme's own probe the whole report is kept, each refusal naming its device", () => {
    const attributed: Array<SnmpTrapRefusal> =
      SnmpTrapRefusalShares.attributeToDevices({
        refusals: refusedDnsNamedTraps(),
        devices: onTheProbe(["acmeCore", "acmeEdge", "acmeBranch", "acmeLab"]),
      });

    expect(
      attributed.map((kept: SnmpTrapRefusal) => {
        return [kept.sourceAddress, kept.deviceIds];
      }),
    ).toEqual([
      ["127.0.11.6", [DNS_NAMED_DEVICES.acmeCore.id]],
      ["127.0.11.7", [DNS_NAMED_DEVICES.acmeEdge.id]],
      ["127.0.11.8", undefined],
      ["127.0.11.9", [DNS_NAMED_DEVICES.acmeBranch.id]],
      ["127.0.11.10", [DNS_NAMED_DEVICES.acmeLab.id]],
    ]);
  });
});

describe("attributeToDevices: a project's own probe keeps its report whole (#11406)", () => {
  test("each refusal names the devices at its address, as reported otherwise", () => {
    const typed: SnmpTrapRefusalShareDevice = device(ACME, "203.0.113.10");
    const named: SnmpTrapRefusalShareDevice = device(ACME, "203.0.113.11");
    const reported: Array<SnmpTrapRefusal> = [
      refusal({ sourceAddress: "203.0.113.10", count: 4 }),
      refusal({
        sourceAddress: "203.0.113.11",
        reason: SnmpTrapRefusalReason.WrongDigest,
      }),
    ];

    expect(
      SnmpTrapRefusalShares.attributeToDevices({
        refusals: reported,
        devices: [typed, named],
      }),
    ).toEqual([from(reported[0]!, typed), from(reported[1]!, named)]);
  });

  test("a refusal no device sent names none, and is kept for the probe's own page", () => {
    const scanner: SnmpTrapRefusal = refusal({ sourceAddress: "192.0.2.99" });

    expect(
      SnmpTrapRefusalShares.attributeToDevices({
        refusals: [scanner],
        devices: [device(ACME, "203.0.113.10")],
      }),
    ).toEqual([scanner]);
  });

  test("devices a refusal came with are never kept: it names only those found", () => {
    const found: SnmpTrapRefusalShareDevice = device(ACME, "203.0.113.10");

    expect(
      SnmpTrapRefusalShares.attributeToDevices({
        refusals: [
          {
            ...refusal({ sourceAddress: "203.0.113.10" }),
            deviceIds: ["11406000-0000-4000-8000-0000000fffff"],
          },
          {
            ...refusal({ sourceAddress: "192.0.2.99" }),
            deviceIds: ["11406000-0000-4000-8000-0000000eeeee"],
          },
        ],
        devices: [found],
      }).map((kept: SnmpTrapRefusal) => {
        return kept.deviceIds;
      }),
    ).toEqual([[found.id], undefined]);
  });

  test("nothing refused, nothing named", () => {
    expect(
      SnmpTrapRefusalShares.attributeToDevices({
        refusals: [],
        devices: [device(ACME, "203.0.113.10")],
      }),
    ).toEqual([]);
  });
});

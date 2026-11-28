import {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";
import SnmpTrapRefusalShares, {
  SnmpTrapRefusalShareDevice,
} from "../../../Types/Probe/SnmpTrapRefusalShares";
import { describe, expect, test } from "@jest/globals";

/*
 * A GLOBAL PROBE'S REFUSED SNMPv3 TRAPS, SPLIT BY PROJECT (#11173).
 *
 * A global probe serves many projects, and what it refused names source
 * addresses and user names. Each refusal goes to the one project whose
 * device has its source address, worded as that project would see it, and
 * to nobody else: the point of every test here is what a project must NOT
 * read.
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

function device(
  projectId: string,
  ...addresses: Array<string>
): SnmpTrapRefusalShareDevice {
  return { projectId: projectId, addresses: addresses };
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

    expect(
      split({
        refusals: [acmes, globexs],
        devices: [
          device(ACME, "203.0.113.10"),
          device(GLOBEX, "198.51.100.20"),
        ],
      }),
    ).toEqual({ [ACME]: [acmes], [GLOBEX]: [globexs] });
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

    expect(
      split({
        refusals: [behindNat],
        devices: [
          device(ACME, "10.0.0.1", "203.0.113.10"),
          device(ACME, "10.0.0.2", "203.0.113.10"),
        ],
      }),
    ).toEqual({ [ACME]: [behindNat] });
  });

  test("a device's Other Addresses count, IPv6 however it is written", () => {
    const v6: SnmpTrapRefusal = refusal({ sourceAddress: "2001:db8::10" });

    expect(
      split({
        refusals: [v6],
        devices: [device(ACME, "10.0.0.1", "2001:DB8:0:0::10")],
      }),
    ).toEqual({ [ACME]: [v6] });
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
        devices: [device(ACME, "203.0.113.10")],
      })[ACME],
    ).toEqual([
      refusal({
        reason: SnmpTrapRefusalReason.UnknownUser,
        count: 7,
        firstSeenAt: "2026-11-27T07:00:00.000Z",
        lastSeenAt: "2026-11-27T09:30:00.000Z",
      }),
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

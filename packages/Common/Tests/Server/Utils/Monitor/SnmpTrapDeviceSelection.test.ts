import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import SnmpTrapDeviceSelection, {
  SnmpTrapSourceTiers,
} from "../../../../Server/Utils/Monitor/SnmpTrapDeviceSelection";
import SnmpTrap from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpSecurityLevel from "../../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import ObjectID from "../../../../Types/ObjectID";
import { SnmpV3CredentialHolders } from "../../../../Types/Probe/SnmpV3CredentialHolders";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH OF THE DEVICES AT A TRAP'S ADDRESS SENT IT (#11172).
 *
 * Devices behind one NAT address, and blades that send from their
 * chassis's address, all have the address a trap comes from. Matched by the
 * address alone, a trap went to whichever had it first, or to all of them.
 * An authenticated SNMPv3 trap is matched by all it says: whose credential
 * signed it, which devices carry it, and the engine it was sent as. Each
 * test names what the old match got wrong, where it got something wrong.
 */

const ACME: ObjectID = new ObjectID("11720000-0000-4000-8000-00000000ac0e");
const GLOBEX: ObjectID = new ObjectID("11720000-0000-4000-8000-000000060be8");

const NAT: string = "203.0.113.7";

const ENGINE_A: string = "800000090300AABBCC000001";
const ENGINE_B: string = "800000090300AABBCC000002";
const ENGINE_C: string = "800000090300AABBCC000003";

let counter: number = 0;

function device(
  name: string,
  fields: {
    projectId?: ObjectID;
    snmpEngineId?: string;
    snmpV3ContextName?: string;
  } = {},
): NetworkDevice {
  counter++;
  const model: NetworkDevice = new NetworkDevice(
    new ObjectID(
      `11720000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    ),
  );
  model.name = name;
  model.projectId = fields.projectId || ACME;

  if (fields.snmpEngineId !== undefined) {
    model.snmpEngineId = fields.snmpEngineId;
  }

  if (fields.snmpV3ContextName !== undefined) {
    model.snmpV3ContextName = fields.snmpV3ContextName;
  }

  return model;
}

function tiers(data: Partial<SnmpTrapSourceTiers>): SnmpTrapSourceTiers {
  return {
    hostname: data.hostname || [],
    otherAddress: data.otherAddress || [],
    dns: data.dns || [],
  };
}

function signedBy(
  devices: Array<NetworkDevice>,
  extra: Partial<SnmpV3CredentialHolders> = {},
): SnmpV3CredentialHolders {
  return {
    projectIds: Array.from(
      new Set(
        devices.map((model: NetworkDevice): string => {
          return model.projectId!.toString();
        }),
      ),
    ),
    deviceIds: devices.map((model: NetworkDevice): string => {
      return model.id!.toString();
    }),
    siteIds: [],
    ...extra,
  };
}

function trap(fields: Partial<SnmpTrap> = {}): SnmpTrap {
  return {
    sourceIpAddress: NAT,
    trapOid: "1.3.6.1.6.3.1.1.5.3",
    snmpVersion: "3",
    securityName: "monitor",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    receivedAt: new Date("2026-11-27T10:00:00.000Z"),
    varbinds: [],
    ...fields,
  };
}

function names(devices: Array<NetworkDevice>): Array<string> {
  return devices.map((model: NetworkDevice): string => {
    return model.name || "";
  });
}

function select(
  sourceTiers: SnmpTrapSourceTiers,
  receivedTrap: SnmpTrap,
): Array<string> {
  return names(
    SnmpTrapDeviceSelection.select({ tiers: sourceTiers, trap: receivedTrap }),
  );
}

describe("isAuthenticatedSnmpV3", () => {
  test("an SNMPv3 trap signed with a key, however the version and level are written", () => {
    expect(SnmpTrapDeviceSelection.isAuthenticatedSnmpV3(trap())).toBe(true);
    expect(
      SnmpTrapDeviceSelection.isAuthenticatedSnmpV3(
        trap({ securityLevel: SnmpSecurityLevel.AuthNoPriv }),
      ),
    ).toBe(true);
    expect(
      SnmpTrapDeviceSelection.isAuthenticatedSnmpV3(
        trap({ securityLevel: "AuthPriv" as SnmpSecurityLevel }),
      ),
    ).toBe(true);
  });

  test("not v1, v2c, noAuthNoPriv or a trap that says no level", () => {
    for (const fields of [
      { snmpVersion: "2c" },
      { snmpVersion: "1" },
      { securityLevel: SnmpSecurityLevel.NoAuthNoPriv },
      { securityLevel: undefined },
      { securityLevel: "made-up" as SnmpSecurityLevel },
    ]) {
      expect(SnmpTrapDeviceSelection.isAuthenticatedSnmpV3(trap(fields))).toBe(
        false,
      );
    }
  });
});

describe("devices behind one NAT address, signed by different users", () => {
  test("each trap goes to the device that carries the credential that signed it", () => {
    const switchA: NetworkDevice = device("switch-a");
    const switchB: NetworkDevice = device("switch-b");
    const behindNat: SnmpTrapSourceTiers = tiers({
      hostname: [switchA, switchB],
    });

    expect(
      select(behindNat, trap({ signedBy: signedBy([switchA]) })),
    ).toEqual(["switch-a"]);
    expect(
      select(behindNat, trap({ signedBy: signedBy([switchB]) })),
    ).toEqual(["switch-b"]);
  });

  test("the old match: without who signed it (a probe older than #11172), both get both traps", () => {
    const switchA: NetworkDevice = device("switch-a");
    const switchB: NetworkDevice = device("switch-b");

    expect(
      select(tiers({ hostname: [switchA, switchB] }), trap()),
    ).toEqual(["switch-a", "switch-b"]);
  });

  test("a NAT gateway registered at the address no longer takes the traps of the devices behind it", () => {
    const gateway: NetworkDevice = device("nat-gateway");
    const behind: NetworkDevice = device("behind-the-nat");
    const atNat: SnmpTrapSourceTiers = tiers({
      hostname: [gateway],
      otherAddress: [behind],
    });

    // The old match: the gateway, the device whose hostname the address is.
    expect(select(atNat, trap())).toEqual(["nat-gateway"]);

    expect(select(atNat, trap({ signedBy: signedBy([behind]) }))).toEqual([
      "behind-the-nat",
    ]);
    expect(select(atNat, trap({ signedBy: signedBy([gateway]) }))).toEqual([
      "nat-gateway",
    ]);
  });

  test("blades behind their chassis's address, the chassis registered too", () => {
    const chassis: NetworkDevice = device("chassis");
    const blade1: NetworkDevice = device("blade-1");
    const blade2: NetworkDevice = device("blade-2");
    const atChassis: SnmpTrapSourceTiers = tiers({
      hostname: [chassis],
      otherAddress: [blade1, blade2],
    });

    expect(select(atChassis, trap({ signedBy: signedBy([blade2]) }))).toEqual([
      "blade-2",
    ]);
  });

  test("a credential several of them carry narrows to those", () => {
    const a: NetworkDevice = device("a");
    const b: NetworkDevice = device("b");
    const c: NetworkDevice = device("c");

    expect(
      select(
        tiers({ otherAddress: [a, b, c] }),
        trap({ signedBy: signedBy([a, c]) }),
      ),
    ).toEqual(["a", "c"]);
  });

  test("a credential none of them carries leaves the address's own answer", () => {
    const a: NetworkDevice = device("a");
    const b: NetworkDevice = device("b");
    const elsewhere: NetworkDevice = device("elsewhere");

    expect(
      select(
        tiers({ hostname: [a], otherAddress: [b] }),
        trap({ signedBy: signedBy([elsewhere]) }),
      ),
    ).toEqual(["a"]);
  });

  test("a credential with no device list (too many carry it) narrows nothing by device", () => {
    const a: NetworkDevice = device("a");
    const b: NetworkDevice = device("b");

    expect(
      select(
        tiers({ hostname: [a, b] }),
        trap({ signedBy: { projectIds: [ACME.toString()] } }),
      ),
    ).toEqual(["a", "b"]);
  });

  test("a device alone at its address gets every trap from it, whoever signed it", () => {
    const alone: NetworkDevice = device("alone");
    const elsewhere: NetworkDevice = device("elsewhere");

    expect(
      select(
        tiers({ hostname: [alone] }),
        trap({ signedBy: signedBy([elsewhere]), engineId: ENGINE_C }),
      ),
    ).toEqual(["alone"]);
  });
});

describe("only devices of a project whose own credential signed it", () => {
  test("another project's device at the same address never gets it", () => {
    const acmes: NetworkDevice = device("acme-switch");
    const globexs: NetworkDevice = device("globex-switch", {
      projectId: GLOBEX,
    });

    expect(
      select(
        tiers({ hostname: [acmes, globexs] }),
        trap({ signedBy: signedBy([acmes]) }),
      ),
    ).toEqual(["acme-switch"]);
  });

  test("not even when it is the only device at the address: the trap is then from no device of it", () => {
    const globexs: NetworkDevice = device("globex-switch", {
      projectId: GLOBEX,
    });
    const acmes: NetworkDevice = device("acme-elsewhere");

    expect(
      select(
        tiers({ hostname: [globexs] }),
        trap({ signedBy: signedBy([acmes]) }),
      ),
    ).toEqual([]);
  });

  test("a credential both projects hold reaches both projects' devices at the address", () => {
    const acmes: NetworkDevice = device("acme-switch");
    const globexs: NetworkDevice = device("globex-switch", {
      projectId: GLOBEX,
    });

    expect(
      select(
        tiers({ hostname: [acmes, globexs] }),
        trap({
          signedBy: {
            projectIds: [ACME.toString(), GLOBEX.toString()],
          },
        }),
      ),
    ).toEqual(["acme-switch", "globex-switch"]);
  });

  test("what the queue carried is read as what it can be: holders that do not read narrow nothing", () => {
    const a: NetworkDevice = device("a");
    const b: NetworkDevice = device("b", { projectId: GLOBEX });

    expect(
      select(
        tiers({ hostname: [a, b] }),
        trap({
          signedBy: { projectIds: ["not-an-id"] } as SnmpV3CredentialHolders,
        }),
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("the engine it was sent as, read from each device's SNMPv3 polls", () => {
  test("devices sharing an address and a credential (a site's default) are told apart by it", () => {
    const a: NetworkDevice = device("a", { snmpEngineId: ENGINE_A });
    const b: NetworkDevice = device("b", { snmpEngineId: ENGINE_B });
    const sharedCredential: SnmpV3CredentialHolders = signedBy([a, b]);
    const atNat: SnmpTrapSourceTiers = tiers({ otherAddress: [a, b] });

    expect(
      select(atNat, trap({ signedBy: sharedCredential, engineId: ENGINE_A })),
    ).toEqual(["a"]);
    expect(
      select(atNat, trap({ signedBy: sharedCredential, engineId: ENGINE_B })),
    ).toEqual(["b"]);
  });

  test("engine IDs are compared however they are written", () => {
    const a: NetworkDevice = device("a", { snmpEngineId: ENGINE_A });
    const b: NetworkDevice = device("b", { snmpEngineId: ENGINE_B });

    expect(
      select(
        tiers({ hostname: [a, b] }),
        trap({
          signedBy: signedBy([a, b]),
          engineId: `0x${ENGINE_A.toLowerCase()}`,
        }),
      ),
    ).toEqual(["a"]);
  });

  test("one not polled over SNMPv3 yet is told from the ones whose engine is known to be another", () => {
    const polled: NetworkDevice = device("polled", { snmpEngineId: ENGINE_A });
    const notYet: NetworkDevice = device("not-yet");
    const shared: SnmpV3CredentialHolders = signedBy([polled, notYet]);
    const atNat: SnmpTrapSourceTiers = tiers({ otherAddress: [polled, notYet] });

    expect(
      select(atNat, trap({ signedBy: shared, engineId: ENGINE_B })),
    ).toEqual(["not-yet"]);
    expect(
      select(atNat, trap({ signedBy: shared, engineId: ENGINE_A })),
    ).toEqual(["polled"]);
  });

  test("the credential wins over an engine known to be another: a replaced device keeps its own credential", () => {
    const replaced: NetworkDevice = device("replaced", {
      snmpEngineId: ENGINE_A,
    });
    const neighbour: NetworkDevice = device("neighbour");

    expect(
      select(
        tiers({ hostname: [replaced, neighbour] }),
        trap({ signedBy: signedBy([replaced]), engineId: ENGINE_C }),
      ),
    ).toEqual(["replaced"]);
  });

  test("an engine none of them is, with every engine known, leaves the address's own answer", () => {
    const a: NetworkDevice = device("a", { snmpEngineId: ENGINE_A });
    const b: NetworkDevice = device("b", { snmpEngineId: ENGINE_B });

    expect(
      select(
        tiers({ hostname: [a], otherAddress: [b] }),
        trap({ signedBy: signedBy([a, b]), engineId: ENGINE_C }),
      ),
    ).toEqual(["a"]);
  });

  test("a probe older than #11172 sends the engine ID without who signed it: the engine still tells them apart", () => {
    const a: NetworkDevice = device("a", { snmpEngineId: ENGINE_A });
    const b: NetworkDevice = device("b", { snmpEngineId: ENGINE_B });

    expect(
      select(tiers({ hostname: [a, b] }), trap({ engineId: ENGINE_B })),
    ).toEqual(["b"]);
  });

  test("a noAuthNoPriv trap's engine ID and user are anyone's to send: matched by its address alone", () => {
    const a: NetworkDevice = device("a", { snmpEngineId: ENGINE_A });
    const b: NetworkDevice = device("b", { snmpEngineId: ENGINE_B });

    expect(
      select(
        tiers({ hostname: [a, b] }),
        trap({
          securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
          engineId: ENGINE_B,
          signedBy: signedBy([b]),
        }),
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("the SNMPv3 context still comes first", () => {
  test("a Brocade chassis's logical switches share an engine: the context picks the switch", () => {
    const fid128: NetworkDevice = device("fid-128", {
      snmpEngineId: ENGINE_A,
    });
    const fid20: NetworkDevice = device("fid-20", {
      snmpEngineId: ENGINE_A,
      snmpV3ContextName: "VF:20",
    });
    const chassis: SnmpTrapSourceTiers = tiers({ hostname: [fid128, fid20] });
    const credential: SnmpV3CredentialHolders = signedBy([fid128, fid20]);

    expect(
      select(
        chassis,
        trap({ signedBy: credential, engineId: ENGINE_A, contextName: "VF:20" }),
      ),
    ).toEqual(["fid-20"]);
    expect(
      select(chassis, trap({ signedBy: credential, engineId: ENGINE_A })),
    ).toEqual(["fid-128", "fid-20"]);
  });
});

describe("v1, v2c and what nothing tells apart: as before", () => {
  test("the first way the address finds a device: hostname, then Other Addresses, then DNS", () => {
    const byHostname: NetworkDevice = device("by-hostname");
    const byOther: NetworkDevice = device("by-other-address");
    const byDns: NetworkDevice = device("by-dns");

    for (const version of ["1", "2c"]) {
      expect(
        select(
          tiers({
            hostname: [byHostname],
            otherAddress: [byOther],
            dns: [byDns],
          }),
          trap({ snmpVersion: version, securityLevel: undefined }),
        ),
      ).toEqual(["by-hostname"]);
      expect(
        select(
          tiers({ otherAddress: [byOther], dns: [byDns] }),
          trap({ snmpVersion: version, securityLevel: undefined }),
        ),
      ).toEqual(["by-other-address"]);
      expect(
        select(
          tiers({ dns: [byDns] }),
          trap({ snmpVersion: version, securityLevel: undefined }),
        ),
      ).toEqual(["by-dns"]);
    }
  });

  test("a v2c trap that claims a signer is matched by its address: only the probe's SNMPv3 path sets one", () => {
    const a: NetworkDevice = device("a");
    const b: NetworkDevice = device("b");

    expect(
      select(
        tiers({ hostname: [a, b] }),
        trap({
          snmpVersion: "2c",
          securityLevel: undefined,
          signedBy: signedBy([b]),
        }),
      ),
    ).toEqual(["a", "b"]);
  });

  test("no device at the address is none", () => {
    expect(select(tiers({}), trap({ signedBy: signedBy([device("x")]) }))).toEqual(
      [],
    );
    expect(select(tiers({}), trap({ snmpVersion: "2c" }))).toEqual([]);
  });

  test("a device listed two ways is one device", () => {
    const both: NetworkDevice = device("both");
    const other: NetworkDevice = device("other");

    expect(
      select(
        tiers({ hostname: [both], otherAddress: [both, other] }),
        trap({ signedBy: signedBy([both, other]) }),
      ),
    ).toEqual(["both"]);
    expect(
      SnmpTrapDeviceSelection.countDevices(
        tiers({ hostname: [both], otherAddress: [both, other] }),
      ),
    ).toBe(2);
  });
});

describe("getSigners and withoutSigners", () => {
  test("who signed it is read only from an authenticated SNMPv3 trap", () => {
    const holders: SnmpV3CredentialHolders = signedBy([device("a")]);

    expect(SnmpTrapDeviceSelection.getSigners(trap({ signedBy: holders }))).toEqual(
      holders,
    );
    expect(
      SnmpTrapDeviceSelection.getSigners(
        trap({
          securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
          signedBy: holders,
        }),
      ),
    ).toBeNull();
    expect(SnmpTrapDeviceSelection.getSigners(trap())).toBeNull();
  });

  test("the trap is kept without who holds its credential, and nothing else changes", () => {
    const holders: SnmpV3CredentialHolders = {
      projectIds: [ACME.toString(), GLOBEX.toString()],
    };
    const received: SnmpTrap = trap({ signedBy: holders, engineId: ENGINE_A });
    const kept: SnmpTrap = SnmpTrapDeviceSelection.withoutSigners(received);

    expect(kept).not.toHaveProperty("signedBy");
    expect(JSON.stringify(kept)).not.toContain(GLOBEX.toString());
    expect({ ...kept, signedBy: holders }).toEqual(received);
    // The received trap is not changed: matching still reads it.
    expect(received.signedBy).toEqual(holders);

    const unsigned: SnmpTrap = trap();
    expect(SnmpTrapDeviceSelection.withoutSigners(unsigned)).toBe(unsigned);
  });
});

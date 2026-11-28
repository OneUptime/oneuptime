import SnmpV3UserTable, {
  MAX_CANDIDATES_PER_MESSAGE,
  MAX_LOCALIZED_KEYS,
  UsmLocalizedKeys,
  UsmUser,
} from "../../../../Utils/Snmp/V3/SnmpV3UserTable";
import UsmCrypto from "../../../../Utils/Snmp/V3/UsmCrypto";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import { SnmpTrapReceiverUser } from "Common/Types/Probe/SnmpTrapReceiver";
import { SnmpV3CredentialHolders } from "Common/Types/Probe/SnmpV3CredentialHolders";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The SNMPv3 users the trap receiver accepts. Replaced whole every thirty
 * seconds; a user's slow key (Ku) is derived once and kept for as long as
 * the user is, and its passphrases are let go once it is; keys localized to
 * an engine are kept for the most recent pairs only.
 */

const ENGINE: Buffer = Buffer.from("80001F8880D5E4C3B2A1", "hex");

function name(userName: string): Buffer {
  return Buffer.from(userName, "utf8");
}

const SAN: SnmpTrapReceiverUser = {
  userName: "san-monitor",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.SHA,
  authKey: "auth-passphrase-1",
  privProtocol: SnmpPrivProtocol.AES,
  privKey: "priv-passphrase-1",
  addresses: ["10.20.0.5"],
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("replace", () => {
  test("the table becomes exactly the users handed over", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();

    expect(table.isLoaded()).toBe(false);
    table.replace([SAN]);

    expect(table.isLoaded()).toBe(true);
    expect(table.getUserCount()).toBe(1);
    expect(table.getCandidates(name("san-monitor"), "10.20.0.5")).toHaveLength(
      1,
    );

    table.replace([]);
    expect(table.isLoaded()).toBe(true);
    expect(table.getUserCount()).toBe(0);
    expect(table.getCandidates(name("san-monitor"), "10.20.0.5")).toHaveLength(
      0,
    );
  });

  test("the same credential on many devices is one user, at all their addresses", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      SAN,
      { ...SAN, addresses: ["10.20.0.6"] },
      { ...SAN, addresses: ["2001:DB8::1"] },
    ]);

    expect(table.getUserCount()).toBe(1);

    const user: UsmUser = table.getCandidates(name("san-monitor"), "x")[0]!;
    expect(Array.from(user.addresses).sort()).toEqual([
      "10.20.0.5",
      "10.20.0.6",
      "2001:db8::1",
    ]);
  });

  test("a user the receiver could not honour is left out, the rest kept", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      SAN,
      { ...SAN, userName: "no-key", authKey: undefined },
      { ...SAN, userName: "x".repeat(33) },
      {
        ...SAN,
        userName: "bad-level",
        securityLevel: "everything" as SnmpSecurityLevel,
      },
    ]);

    expect(table.getUserCount()).toBe(1);
  });

  test("names are compared as octets: case and accents matter, as on the device", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([{ ...SAN, userName: "Überwachung" }]);

    expect(table.getCandidates(name("Überwachung"), "x")).toHaveLength(1);
    expect(table.getCandidates(name("überwachung"), "x")).toHaveLength(0);
    expect(table.getCandidates(name("Uberwachung"), "x")).toHaveLength(0);
  });
});

describe("who holds each user (#11172)", () => {
  const HELD_BY: SnmpV3CredentialHolders = {
    projectIds: ["11720000-0000-4000-8000-0000000000a1"],
    deviceIds: ["11720000-0000-4000-8000-000000000d01"],
    siteIds: [],
  };

  test("is kept beside the user, as OneUptime handed it", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([{ ...SAN, heldBy: HELD_BY }]);

    expect(
      table.getCandidates(name("san-monitor"), "10.20.0.5")[0]!.heldBy,
    ).toEqual(HELD_BY);
  });

  test("is none when OneUptime did not say (a server older than #11172)", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([SAN]);

    expect(
      table.getCandidates(name("san-monitor"), "10.20.0.5")[0]!.heldBy,
    ).toBeUndefined();
  });

  test("one credential handed twice is held by both", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      { ...SAN, heldBy: HELD_BY },
      {
        ...SAN,
        addresses: ["10.20.0.6"],
        heldBy: {
          projectIds: ["11720000-0000-4000-8000-0000000000a1"],
          deviceIds: ["11720000-0000-4000-8000-000000000d02"],
          siteIds: ["11720000-0000-4000-8000-000000000501"],
        },
      },
    ]);

    expect(
      table.getCandidates(name("san-monitor"), "10.20.0.5")[0]!.heldBy,
    ).toEqual({
      projectIds: ["11720000-0000-4000-8000-0000000000a1"],
      deviceIds: [
        "11720000-0000-4000-8000-000000000d01",
        "11720000-0000-4000-8000-000000000d02",
      ],
      siteIds: ["11720000-0000-4000-8000-000000000501"],
    });
  });

  test("handed twice, once without, is held by nothing known", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([{ ...SAN, heldBy: HELD_BY }, { ...SAN }]);

    expect(
      table.getCandidates(name("san-monitor"), "10.20.0.5")[0]!.heldBy,
    ).toBeUndefined();
  });

  test("two users of one name with other keys each keep their own", () => {
    const other: SnmpV3CredentialHolders = {
      projectIds: ["11720000-0000-4000-8000-0000000000a1"],
      deviceIds: ["11720000-0000-4000-8000-000000000d09"],
      siteIds: [],
    };
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      { ...SAN, heldBy: HELD_BY },
      { ...SAN, privKey: "another-priv-passphrase", heldBy: other },
    ]);

    expect(
      table.getCandidates(name("san-monitor"), "x").map((user: UsmUser) => {
        return user.heldBy;
      }),
    ).toEqual([HELD_BY, other]);
  });

  test("who holds a user is no part of its credential: the same keys keep their derived keys", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([{ ...SAN, heldBy: HELD_BY }]);
    const fingerprint: string = table.getCandidates(
      name("san-monitor"),
      "x",
    )[0]!.fingerprint;

    table.replace([
      {
        ...SAN,
        heldBy: { ...HELD_BY, deviceIds: [] },
      },
    ]);

    expect(table.getCandidates(name("san-monitor"), "x")[0]!.fingerprint).toBe(
      fingerprint,
    );
  });
});

describe("candidates", () => {
  test("the users of the devices at the source address come first", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      { ...SAN, authKey: "key-of-a", addresses: ["10.0.0.1"] },
      { ...SAN, authKey: "key-of-b", addresses: ["10.0.0.2"] },
      { ...SAN, authKey: "key-of-c", addresses: ["10.0.0.3"] },
    ]);

    expect(
      Array.from(
        table.getCandidates(name("san-monitor"), "10.0.0.3")[0]!.addresses,
      ),
    ).toEqual(["10.0.0.3"]);
    expect(
      Array.from(
        table.getCandidates(name("san-monitor"), "10.0.0.2")[0]!.addresses,
      ),
    ).toEqual(["10.0.0.2"]);
    expect(table.getCandidates(name("san-monitor"), "10.9.9.9")).toHaveLength(
      3,
    );
  });

  test("an IPv6 source matches however its address was written", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      { ...SAN, authKey: "key-of-a", addresses: ["10.0.0.1"] },
      { ...SAN, authKey: "key-of-b", addresses: ["2001:DB8:0:0:0:0:0:5"] },
    ]);

    expect(
      Array.from(
        table.getCandidates(name("san-monitor"), "2001:db8::5")[0]!.addresses,
      ),
    ).toEqual(["2001:db8::5"]);
  });

  test("at most MAX_CANDIDATES_PER_MESSAGE are tried for one message", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace(
      Array.from(
        { length: MAX_CANDIDATES_PER_MESSAGE + 10 },
        (_value: unknown, index: number): SnmpTrapReceiverUser => {
          return { ...SAN, authKey: `per-device-key-${index}` };
        },
      ),
    );

    expect(table.getUserCount()).toBe(MAX_CANDIDATES_PER_MESSAGE + 10);
    expect(table.getCandidates(name("san-monitor"), "10.20.0.5")).toHaveLength(
      MAX_CANDIDATES_PER_MESSAGE,
    );
  });

  test("an unknown name has none", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([SAN]);

    expect(table.getCandidates(name("stranger"), "10.20.0.5")).toEqual([]);
    expect(table.getCandidates(Buffer.alloc(0), "10.20.0.5")).toEqual([]);
  });
});

describe("keys", () => {
  test("localized keys are the ones RFC 3414 derives, for authentication and privacy", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([SAN]);

    const keys: UsmLocalizedKeys = table.getLocalizedKeys(
      table.getCandidates(name("san-monitor"), "x")[0]!,
      ENGINE,
    );

    expect(
      keys.authKey!.equals(
        UsmCrypto.localizeKey(
          SnmpAuthProtocol.SHA,
          UsmCrypto.passwordToKu(SnmpAuthProtocol.SHA, "auth-passphrase-1"),
          ENGINE,
        ),
      ),
    ).toBe(true);
    expect(keys.privacyKey!.protocol).toBe(SnmpPrivProtocol.AES);
    expect(keys.privacyKey!.key.length).toBe(16);
  });

  test("Ku is derived once per user, and a replace() that keeps the user keeps it", () => {
    const passwordToKu: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UsmCrypto,
      "passwordToKu",
    );
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([SAN]);

    const user: UsmUser = table.getCandidates(name("san-monitor"), "x")[0]!;
    table.getLocalizedKeys(user, ENGINE);
    table.getLocalizedKeys(user, Buffer.from("80001F88800102030405", "hex"));
    // Authentication and privacy: two derivations, for any number of engines.
    expect(passwordToKu).toHaveBeenCalledTimes(2);

    table.replace([SAN, { ...SAN, userName: "another" }]);
    table.getLocalizedKeys(
      table.getCandidates(name("san-monitor"), "x")[0]!,
      Buffer.from("80001F888009", "hex"),
    );
    expect(passwordToKu).toHaveBeenCalledTimes(2);
  });

  test("a passphrase changed is a new user, with new keys", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([SAN]);
    const before: Buffer = table.getLocalizedKeys(
      table.getCandidates(name("san-monitor"), "x")[0]!,
      ENGINE,
    ).authKey!;

    table.replace([{ ...SAN, authKey: "rotated-passphrase" }]);
    const after: Buffer = table.getLocalizedKeys(
      table.getCandidates(name("san-monitor"), "x")[0]!,
      ENGINE,
    ).authKey!;

    expect(after.equals(before)).toBe(false);
  });

  test("a noAuthNoPriv user has no keys", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      {
        userName: "lab",
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        addresses: [],
      },
    ]);

    expect(
      table.getLocalizedKeys(table.getCandidates(name("lab"), "x")[0]!, ENGINE),
    ).toEqual({});
  });

  test("warmUp derives the slow keys a few at a time, and says how many are left", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace(
      Array.from({ length: 5 }, (_value: unknown, index: number) => {
        return { ...SAN, userName: `user-${index}` };
      }),
    );

    expect(table.warmUp(2)).toBe(3);
    expect(table.warmUp(2)).toBe(1);
    expect(table.warmUp(2)).toBe(0);
    expect(table.warmUp(2)).toBe(0);

    const passwordToKu: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UsmCrypto,
      "passwordToKu",
    );
    table.getLocalizedKeys(
      table.getCandidates(name("user-3"), "x")[0]!,
      ENGINE,
    );
    expect(passwordToKu).not.toHaveBeenCalled();
  });

  test("keys localized to engines are kept for the most recent pairs only", () => {
    const table: SnmpV3UserTable = new SnmpV3UserTable();
    table.replace([
      {
        ...SAN,
        securityLevel: SnmpSecurityLevel.AuthNoPriv,
        privKey: undefined,
        privProtocol: undefined,
      },
    ]);
    const user: UsmUser = table.getCandidates(name("san-monitor"), "x")[0]!;
    const localizeKey: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UsmCrypto,
      "localizeKey",
    );

    for (let index: number = 0; index <= MAX_LOCALIZED_KEYS; index++) {
      const engine: Buffer = Buffer.alloc(8);
      engine.writeUInt32BE(index, 4);
      table.getLocalizedKeys(user, engine);
    }

    expect(localizeKey).toHaveBeenCalledTimes(MAX_LOCALIZED_KEYS + 1);

    // The first engine was dropped to make room: localized again.
    table.getLocalizedKeys(user, Buffer.alloc(8));
    expect(localizeKey).toHaveBeenCalledTimes(MAX_LOCALIZED_KEYS + 2);

    // The most recent is still kept.
    const recent: Buffer = Buffer.alloc(8);
    recent.writeUInt32BE(MAX_LOCALIZED_KEYS, 4);
    table.getLocalizedKeys(user, recent);
    expect(localizeKey).toHaveBeenCalledTimes(MAX_LOCALIZED_KEYS + 2);
  });

  test("the fingerprint tells credentials apart by every field, and is hex", () => {
    const fingerprint: string = SnmpV3UserTable.getFingerprint(SAN);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(SnmpV3UserTable.getFingerprint({ ...SAN })).toBe(fingerprint);

    for (const changed of [
      { ...SAN, userName: "other" },
      { ...SAN, securityLevel: SnmpSecurityLevel.AuthNoPriv },
      { ...SAN, authProtocol: SnmpAuthProtocol.SHA256 },
      { ...SAN, authKey: "other-auth-key" },
      { ...SAN, privProtocol: SnmpPrivProtocol.DES },
      { ...SAN, privKey: "other-priv-key" },
    ]) {
      expect(SnmpV3UserTable.getFingerprint(changed)).not.toBe(fingerprint);
    }

    // Addresses are where a user is, not who it is.
    expect(
      SnmpV3UserTable.getFingerprint({ ...SAN, addresses: ["192.0.2.1"] }),
    ).toBe(fingerprint);
  });
});

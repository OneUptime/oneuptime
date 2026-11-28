import SnmpTrapReceiverUtil, {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES,
  MAX_SNMP_TRAP_RECEIVER_USERS,
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";
import { SnmpV3CredentialHolders } from "../../../Types/Probe/SnmpV3CredentialHolders";
import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import { describe, expect, test } from "@jest/globals";

/*
 * What a probe says of its SNMP trap receiver is kept on the probe and
 * shown on two pages, and what OneUptime hands a probe are passphrases: so
 * both are read here only as what they can be, whatever was posted.
 */

const REFUSAL: SnmpTrapRefusal = {
  sourceAddress: "10.20.0.5",
  reason: SnmpTrapRefusalReason.UnknownUser,
  userName: "san-monitor",
  count: 12,
  firstSeenAt: "2026-11-24T10:00:00.000Z",
  lastSeenAt: "2026-11-24T11:00:00.000Z",
};

const REPORT: SnmpTrapReceiverReport = {
  isEnabled: true,
  port: 162,
  engineId: "8000B98380A1B2C3D4E5F60718293A4B",
  userCount: 3,
  lastReceivedAt: "2026-11-24T11:05:00.000Z",
  refusals: [REFUSAL],
};

describe("normalizeEngineId", () => {
  test("hex of 5 to 32 octets, in capitals, without what people copy around it", () => {
    expect(SnmpTrapReceiverUtil.normalizeEngineId("8000b98380a1")).toBe(
      "8000B98380A1",
    );
    expect(SnmpTrapReceiverUtil.normalizeEngineId(" 0x80:00:1F:88:80 ")).toBe(
      "80001F8880",
    );
    expect(SnmpTrapReceiverUtil.normalizeEngineId("80 00 1f 88 80-c7.11")).toBe(
      "80001F8880C711",
    );
    expect(SnmpTrapReceiverUtil.normalizeEngineId("AB".repeat(32))).toBe(
      "AB".repeat(32),
    );
  });

  test("anything else is none", () => {
    for (const value of [
      "",
      "0x",
      "8000",
      "8000B9838",
      "AB".repeat(33),
      "zz000000000000",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(SnmpTrapReceiverUtil.normalizeEngineId(value)).toBeNull();
    }
  });
});

describe("sanitizeReport", () => {
  test("a report is kept as it was sent", () => {
    expect(SnmpTrapReceiverUtil.sanitizeReport(REPORT)).toEqual(REPORT);
  });

  test("a receiver that is off is only that", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeReport({
        isEnabled: false,
        port: 162,
        refusals: [REFUSAL],
      }),
    ).toEqual({ isEnabled: false, refusals: [] });
  });

  test("what is not a report is none", () => {
    for (const value of [null, undefined, "report", [], { isEnabled: "yes" }]) {
      expect(SnmpTrapReceiverUtil.sanitizeReport(value)).toBeNull();
    }
  });

  test("each field only as what it can be; anything else, and unknown keys, dropped", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeReport({
        isEnabled: true,
        port: 70000,
        listenError: "<script>",
        engineId: "not hex",
        userCount: -1,
        lastReceivedAt: "yesterday",
        refusals: "many",
        secret: "dropped",
      }),
    ).toEqual({ isEnabled: true, refusals: [] });

    expect(
      SnmpTrapReceiverUtil.sanitizeReport({
        isEnabled: true,
        listenError: "EACCES",
        userCount: MAX_SNMP_TRAP_RECEIVER_USERS + 1,
        refusals: [],
      }),
    ).toEqual({ isEnabled: true, listenError: "EACCES", refusals: [] });
  });

  test("refusals: only real ones, canonical, user names made safe to show, the most recent first", () => {
    const report: SnmpTrapReceiverReport | null =
      SnmpTrapReceiverUtil.sanitizeReport({
        isEnabled: true,
        refusals: [
          REFUSAL,
          { ...REFUSAL, sourceAddress: "not an address" },
          { ...REFUSAL, reason: "becauseISaidSo" },
          { ...REFUSAL, count: 0 },
          { ...REFUSAL, count: 1.5 },
          { ...REFUSAL, firstSeenAt: "never" },
          {
            ...REFUSAL,
            sourceAddress: "2001:DB8::5",
            userName: "evil\u0000\u001b[31mname-that-is-far-too-long-for-snmp",
            lastSeenAt: "2026-11-24T12:00:00.000Z",
          },
          { ...REFUSAL, userName: 42 },
        ],
      });

    expect(report!.refusals).toEqual([
      {
        ...REFUSAL,
        sourceAddress: "2001:db8::5",
        userName: "evil??[31mname-that-is-far-too-l",
        lastSeenAt: "2026-11-24T12:00:00.000Z",
      },
      REFUSAL,
      { ...REFUSAL, userName: "" },
    ]);
  });

  test(`at most ${MAX_REPORTED_SNMP_TRAP_REFUSALS} refusals are kept`, () => {
    const report: SnmpTrapReceiverReport | null =
      SnmpTrapReceiverUtil.sanitizeReport({
        isEnabled: true,
        refusals: Array.from(
          { length: MAX_REPORTED_SNMP_TRAP_REFUSALS + 20 },
          () => {
            return REFUSAL;
          },
        ),
      });

    expect(report!.refusals).toHaveLength(MAX_REPORTED_SNMP_TRAP_REFUSALS);
  });

  test("a stored report reads the same way (parseReport)", () => {
    expect(SnmpTrapReceiverUtil.parseReport(REPORT)).toEqual(REPORT);
    expect(SnmpTrapReceiverUtil.parseReport(null)).toBeNull();
  });
});

describe("getRefusalsFromAddresses", () => {
  const report: SnmpTrapReceiverReport = {
    ...REPORT,
    refusals: [
      REFUSAL,
      { ...REFUSAL, sourceAddress: "10.20.0.6", count: 3 },
      { ...REFUSAL, sourceAddress: "2001:db8::5", count: 4 },
    ],
  };

  test("a device's own: its hostname and its Other Addresses, however written", () => {
    expect(
      SnmpTrapReceiverUtil.getRefusalsFromAddresses(report, [
        "10.20.0.5",
        "2001:DB8:0:0:0:0:0:5",
      ]).map((refusal: SnmpTrapRefusal) => {
        return refusal.sourceAddress;
      }),
    ).toEqual(["10.20.0.5", "2001:db8::5"]);
  });

  test("a hostname that is a DNS name matches nothing, and nothing is resolved", () => {
    expect(
      SnmpTrapReceiverUtil.getRefusalsFromAddresses(report, [
        "switch-01.example.com",
        null,
        undefined,
        "",
      ]),
    ).toEqual([]);
  });

  test("no report, no refusals", () => {
    expect(
      SnmpTrapReceiverUtil.getRefusalsFromAddresses(null, ["10.20.0.5"]),
    ).toEqual([]);
  });

  test("they add up", () => {
    expect(SnmpTrapReceiverUtil.countRefused(report.refusals)).toBe(19);
  });
});

describe("sanitizeUser", () => {
  const AUTH_PRIV: SnmpTrapReceiverUser = {
    userName: "san-monitor",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    authProtocol: SnmpAuthProtocol.SHA256,
    authKey: "auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES256,
    privKey: "priv-passphrase",
    addresses: ["10.20.0.5"],
  };

  test("a user is taken as it was handed over", () => {
    expect(SnmpTrapReceiverUtil.sanitizeUser(AUTH_PRIV)).toEqual(AUTH_PRIV);
  });

  test("protocols and levels are read the poller's way", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        securityLevel: "AuthPriv",
        authProtocol: "SHA-256",
        privProtocol: "aes-256",
      }),
    ).toEqual(AUTH_PRIV);
  });

  test("a level whose keys are missing is no user: the receiver does not guess", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({ ...AUTH_PRIV, privKey: "" }),
    ).toBeNull();
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        authProtocol: "SHA-3",
      }),
    ).toBeNull();
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        privProtocol: undefined,
      }),
    ).toBeNull();
  });

  test("an authNoPriv user keeps no privacy key, a noAuthNoPriv user no keys", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        securityLevel: SnmpSecurityLevel.AuthNoPriv,
      }),
    ).toEqual({
      userName: "san-monitor",
      securityLevel: SnmpSecurityLevel.AuthNoPriv,
      authProtocol: SnmpAuthProtocol.SHA256,
      authKey: "auth-passphrase",
      addresses: ["10.20.0.5"],
    });
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
      }),
    ).toEqual({
      userName: "san-monitor",
      securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
      addresses: ["10.20.0.5"],
    });
  });

  test("a user name SNMPv3 cannot carry is no user", () => {
    for (const userName of ["", "x".repeat(33), 7, undefined]) {
      expect(
        SnmpTrapReceiverUtil.sanitizeUser({ ...AUTH_PRIV, userName: userName }),
      ).toBeNull();
    }
  });

  test("addresses: IP addresses only, canonical, each once, a bounded number", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        addresses: ["2001:DB8::1", "2001:db8:0:0:0:0:0:1", "not-an-ip", 5],
      })!.addresses,
    ).toEqual(["2001:db8::1"]);

    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        addresses: Array.from({ length: 300 }, (_v: unknown, index: number) => {
          return `10.0.${Math.floor(index / 250)}.${(index % 250) + 1}`;
        }),
      })!.addresses,
    ).toHaveLength(MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES);
  });

  test("who holds the credential is kept, read as what it can be (#11172)", () => {
    const heldBy: SnmpV3CredentialHolders = {
      projectIds: ["11720000-0000-4000-8000-0000000000a1"],
      deviceIds: ["11720000-0000-4000-8000-000000000d01"],
      siteIds: ["11720000-0000-4000-8000-000000000501"],
    };

    expect(
      SnmpTrapReceiverUtil.sanitizeUser({ ...AUTH_PRIV, heldBy: heldBy }),
    ).toEqual({ ...AUTH_PRIV, heldBy: heldBy });

    // From a server older than #11172, or not readable: the user still is.
    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        heldBy: { projectIds: ["not-an-id"] },
      }),
    ).toEqual(AUTH_PRIV);
    expect(SnmpTrapReceiverUtil.sanitizeUser(AUTH_PRIV)).not.toHaveProperty(
      "heldBy",
    );
  });

  test("a noAuthNoPriv user keeps who holds it too", () => {
    const heldBy: SnmpV3CredentialHolders = {
      projectIds: ["11720000-0000-4000-8000-0000000000a1"],
    };

    expect(
      SnmpTrapReceiverUtil.sanitizeUser({
        ...AUTH_PRIV,
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        heldBy: heldBy,
      })?.heldBy,
    ).toEqual(heldBy);
  });

  test("sanitizeUsers keeps the users and leaves out the rest", () => {
    expect(
      SnmpTrapReceiverUtil.sanitizeUsers([
        AUTH_PRIV,
        null,
        "x",
        { userName: "" },
      ]),
    ).toEqual([AUTH_PRIV]);
    expect(SnmpTrapReceiverUtil.sanitizeUsers("users")).toEqual([]);
  });
});

describe("toSharedReport: what of a global probe's report belongs to no project (#11173)", () => {
  test("whether it is on, its port, why it cannot listen and its engine ID", () => {
    expect(
      SnmpTrapReceiverUtil.toSharedReport({
        ...REPORT,
        listenError: "EADDRINUSE",
      }),
    ).toStrictEqual({
      isEnabled: true,
      port: 162,
      listenError: "EADDRINUSE",
      engineId: "8000B98380A1B2C3D4E5F60718293A4B",
      refusals: [],
    });
  });

  test("never its refusals, how many users it takes, or when it last took a trap", () => {
    const shared: SnmpTrapReceiverReport =
      SnmpTrapReceiverUtil.toSharedReport(REPORT);

    expect(shared.refusals).toEqual([]);
    expect(shared).not.toHaveProperty("userCount");
    expect(shared).not.toHaveProperty("lastReceivedAt");
    expect(JSON.stringify(shared)).not.toContain(REFUSAL.sourceAddress);
    expect(JSON.stringify(shared)).not.toContain(REFUSAL.userName);
  });

  test("a receiver that is off is only that", () => {
    expect(
      SnmpTrapReceiverUtil.toSharedReport({ isEnabled: false, refusals: [] }),
    ).toStrictEqual({ isEnabled: false, refusals: [] });
  });

  test("what is not in the report is not made up", () => {
    expect(
      SnmpTrapReceiverUtil.toSharedReport({ isEnabled: true, refusals: [] }),
    ).toStrictEqual({ isEnabled: true, refusals: [] });
  });

  test("it reads back as a report", () => {
    expect(
      SnmpTrapReceiverUtil.parseReport(
        SnmpTrapReceiverUtil.toSharedReport(REPORT),
      ),
    ).toEqual(SnmpTrapReceiverUtil.toSharedReport(REPORT));
  });
});

test("toDisplayableUserName shows a user name as it was sent, safely", () => {
  expect(SnmpTrapReceiverUtil.toDisplayableUserName("san-monitor")).toBe(
    "san-monitor",
  );
  expect(SnmpTrapReceiverUtil.toDisplayableUserName("a\tb\u007fc")).toBe(
    "a?b?c",
  );
  expect(SnmpTrapReceiverUtil.toDisplayableUserName("überwachung")).toBe(
    "überwachung",
  );
});

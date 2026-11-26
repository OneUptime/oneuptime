// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  NetSnmpToolResult,
  NetSnmpTools,
  findNetSnmpTools,
} from "../TestingUtils/NetSnmpTools";
import {
  HARNESS_ENGINE_ID,
  SnmpTrapListenerHarness,
  startSnmpTrapListenerHarness,
} from "../TestingUtils/SnmpTrapListenerHarness";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
  SnmpTrapReceiverUser,
} from "Common/Types/Probe/SnmpTrapReceiver";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * REAL SNMPv3 TRAPS AND INFORMS, FROM NET-SNMP'S OWN TOOLS (OneUptime issue
 * #11005).
 *
 * snmptrap and snmpinform send each notification over UDP to a real trap
 * listener on loopback - the same SnmpTrapListener a probe runs, with the
 * users OneUptime would hand it - and every assertion is on what crossed
 * the wire: what was forwarded, what the sender heard back (an inform's
 * acknowledgement, or a Report naming the failure), and what the probe's
 * page would count.
 *
 * Needs Net-SNMP's tools on PATH, or NET_SNMP_TOOLS_DOCKER_IMAGE naming an
 * image that has them (see TestingUtils/NetSnmpTools). Without either, the
 * suite is skipped - the same exchanges are covered against net-snmp's own
 * stack in SnmpTrapReceiverV3EndToEnd.
 */

// Each tool run may start a container: seconds, not milliseconds.
jest.setTimeout(180000);

const tools: NetSnmpTools | null = findNetSnmpTools();
const describeWithTools: typeof describe.skip = tools
  ? describe
  : describe.skip;

const LINK_DOWN: string = "1.3.6.1.6.3.1.1.5.3";
const LINK_UP: string = "1.3.6.1.6.3.1.1.5.4";
const IF_INDEX: string = "1.3.6.1.2.1.2.2.1.1.7";

// The device's own engine ID, as a switch's would be.
const DEVICE_ENGINE_ID: string = "0x80001F88804F6E6555707469";

const SAN_MONITOR: SnmpTrapReceiverUser = {
  userName: "san-monitor",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.SHA,
  authKey: "auth-passphrase-1",
  privProtocol: SnmpPrivProtocol.AES,
  privKey: "priv-passphrase-1",
  addresses: ["127.0.0.1"],
};

const SHA256_AES256: SnmpTrapReceiverUser = {
  userName: "fabric-sha256",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.SHA256,
  authKey: "sha256-auth-passphrase",
  privProtocol: SnmpPrivProtocol.AES256,
  privKey: "aes256-priv-passphrase",
  addresses: ["127.0.0.1"],
};

const SHA512_AES256: SnmpTrapReceiverUser = {
  userName: "fabric-sha512",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.SHA512,
  authKey: "sha512-auth-passphrase",
  privProtocol: SnmpPrivProtocol.AES256,
  privKey: "aes256-priv-passphrase-2",
  addresses: ["127.0.0.1"],
};

const MD5_DES: SnmpTrapReceiverUser = {
  userName: "legacy-md5",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.MD5,
  authKey: "md5-auth-passphrase",
  privProtocol: SnmpPrivProtocol.DES,
  privKey: "des-priv-passphrase",
  addresses: ["127.0.0.1"],
};

const SHA_DES: SnmpTrapReceiverUser = {
  userName: "legacy-sha-des",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.SHA,
  authKey: "sha-auth-passphrase",
  privProtocol: SnmpPrivProtocol.DES,
  privKey: "des-priv-passphrase-2",
  addresses: ["127.0.0.1"],
};

const AUTH_ONLY: SnmpTrapReceiverUser = {
  userName: "auth-only",
  securityLevel: SnmpSecurityLevel.AuthNoPriv,
  authProtocol: SnmpAuthProtocol.SHA256,
  authKey: "auth-only-passphrase",
  addresses: ["127.0.0.1"],
};

const NO_AUTH: SnmpTrapReceiverUser = {
  userName: "lab-noauth",
  securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
  addresses: ["127.0.0.1"],
};

const USERS: Array<SnmpTrapReceiverUser> = [
  SAN_MONITOR,
  SHA256_AES256,
  SHA512_AES256,
  MD5_DES,
  SHA_DES,
  AUTH_ONLY,
  NO_AUTH,
];

const NET_SNMP_AUTH: Record<SnmpAuthProtocol, string> = {
  [SnmpAuthProtocol.MD5]: "MD5",
  [SnmpAuthProtocol.SHA]: "SHA",
  [SnmpAuthProtocol.SHA256]: "SHA-256",
  [SnmpAuthProtocol.SHA512]: "SHA-512",
};

const NET_SNMP_PRIV: Record<SnmpPrivProtocol, string> = {
  [SnmpPrivProtocol.DES]: "DES",
  [SnmpPrivProtocol.AES]: "AES",
  [SnmpPrivProtocol.AES256]: "AES-256",
};

// snmptrap / snmpinform arguments for a user, as a device would be configured.
function v3Args(
  user: SnmpTrapReceiverUser,
  overrides?: { authKey?: string; privKey?: string; level?: string },
): Array<string> {
  const args: Array<string> = [
    "-v",
    "3",
    "-u",
    user.userName,
    "-l",
    overrides?.level || user.securityLevel,
  ];

  if (user.authProtocol) {
    args.push(
      "-a",
      NET_SNMP_AUTH[user.authProtocol],
      "-A",
      overrides?.authKey || user.authKey!,
    );
  }

  if (user.privProtocol) {
    args.push(
      "-x",
      NET_SNMP_PRIV[user.privProtocol],
      "-X",
      overrides?.privKey || user.privKey!,
    );
  }

  return args;
}

function supports(user: SnmpTrapReceiverUser): boolean {
  return (
    (!user.authProtocol ||
      tools!.authProtocols.includes(NET_SNMP_AUTH[user.authProtocol])) &&
    (!user.privProtocol ||
      tools!.privProtocols.includes(NET_SNMP_PRIV[user.privProtocol]))
  );
}

describeWithTools("SNMPv3 traps and informs from Net-SNMP's tools", () => {
  let harness: SnmpTrapListenerHarness;

  beforeAll(async () => {
    harness = await startSnmpTrapListenerHarness({ users: USERS });
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(() => {
    harness.forwarded.length = 0;
  });

  function target(): string {
    return `udp:127.0.0.1:${harness.port}`;
  }

  async function sendTrap(
    args: Array<string>,
    trapOid: string = LINK_DOWN,
  ): Promise<NetSnmpToolResult> {
    return tools!.run("snmptrap", [
      ...args,
      target(),
      "",
      trapOid,
      IF_INDEX,
      "i",
      "7",
    ]);
  }

  async function sendInform(
    args: Array<string>,
    trapOid: string = LINK_UP,
  ): Promise<NetSnmpToolResult> {
    return tools!.run(
      "snmpinform",
      [
        "-t",
        "2",
        "-r",
        "1",
        ...args,
        target(),
        "",
        trapOid,
        IF_INDEX,
        "i",
        "7",
      ],
      60000,
    );
  }

  function refusalFor(userName: string): SnmpTrapRefusal | undefined {
    return harness.listener
      .getReport()
      .refusals.find((refusal: SnmpTrapRefusal) => {
        return refusal.userName === userName;
      });
  }

  test(`the tools are there (${tools?.describe || "none"})`, () => {
    expect(tools!.authProtocols).toContain("SHA");
    expect(tools!.privProtocols).toContain("AES");
  });

  describe("authPriv traps raise what a v2c trap raises", () => {
    test.each(
      [SAN_MONITOR, SHA256_AES256, SHA512_AES256].map(
        (user: SnmpTrapReceiverUser): [string, SnmpTrapReceiverUser] => {
          return [`${user.authProtocol}/${user.privProtocol}`, user];
        },
      ),
    )("%s", async (_label: string, user: SnmpTrapReceiverUser) => {
      if (!supports(user)) {
        return;
      }

      const result: NetSnmpToolResult = await sendTrap([
        ...v3Args(user),
        "-e",
        DEVICE_ENGINE_ID,
      ]);
      expect(result.exitCode).toBe(0);

      await harness.waitForForwarded(1);
      const trap: SnmpTrap = harness.forwarded[0]!;

      expect(trap.trapOid).toBe(LINK_DOWN);
      expect(trap.snmpVersion).toBe("3");
      expect(trap.isInform).toBe(false);
      expect(trap.securityName).toBe(user.userName);
      expect(trap.securityLevel).toBe(SnmpSecurityLevel.AuthPriv);
      expect(trap.sourceIpAddress).toBe("127.0.0.1");
      expect(trap.engineId).toBe("80001F88804F6E6555707469");
      expect(trap.varbinds).toEqual(
        expect.arrayContaining([
          { oid: "1.3.6.1.6.3.1.1.4.1.0", value: LINK_DOWN },
          { oid: IF_INDEX, value: "7" },
        ]),
      );
    });
  });

  describe("DES privacy, on OpenSSL 3", () => {
    test.each(
      [MD5_DES, SHA_DES].map(
        (user: SnmpTrapReceiverUser): [string, SnmpTrapReceiverUser] => {
          return [`${user.authProtocol}/DES`, user];
        },
      ),
    )("%s", async (_label: string, user: SnmpTrapReceiverUser) => {
      const result: NetSnmpToolResult = await sendTrap([
        ...v3Args(user),
        "-e",
        DEVICE_ENGINE_ID,
      ]);

      /*
       * A Net-SNMP built on OpenSSL 3 without its legacy provider cannot
       * encrypt DES itself: then there is nothing to receive.
       */
      if (result.exitCode !== 0) {
        expect(`${result.stderr}${result.stdout}`).toMatch(
          /DES|encrypt|cipher|unsupported/i,
        );
        return;
      }

      await harness.waitForForwarded(1);
      expect(harness.forwarded[0]!.securityName).toBe(user.userName);
      expect(harness.forwarded[0]!.securityLevel).toBe(
        SnmpSecurityLevel.AuthPriv,
      );
    });
  });

  test("an authNoPriv trap", async () => {
    const result: NetSnmpToolResult = await sendTrap(v3Args(AUTH_ONLY));
    expect(result.exitCode).toBe(0);

    await harness.waitForForwarded(1);
    expect(harness.forwarded[0]!.securityName).toBe("auth-only");
    expect(harness.forwarded[0]!.securityLevel).toBe(
      SnmpSecurityLevel.AuthNoPriv,
    );
  });

  test("a noAuthNoPriv trap from a user configured without authentication", async () => {
    const result: NetSnmpToolResult = await sendTrap(v3Args(NO_AUTH));
    expect(result.exitCode).toBe(0);

    await harness.waitForForwarded(1);
    expect(harness.forwarded[0]!.securityName).toBe("lab-noauth");
    expect(harness.forwarded[0]!.securityLevel).toBe(
      SnmpSecurityLevel.NoAuthNoPriv,
    );
  });

  describe("informs are acknowledged, so the sender stops retrying", () => {
    test("an SNMPv3 authPriv inform: discovery, then the acknowledgement", async () => {
      const result: NetSnmpToolResult = await sendInform(v3Args(SAN_MONITOR));

      // snmpinform exits 0 only once it has the Response; a lost one is "Timeout".
      expect(`${result.stderr}`).not.toMatch(/Timeout/);
      expect(result.exitCode).toBe(0);

      await harness.waitForForwarded(1);
      const inform: SnmpTrap = harness.forwarded[0]!;
      expect(inform.isInform).toBe(true);
      expect(inform.trapOid).toBe(LINK_UP);
      expect(inform.securityName).toBe("san-monitor");
      expect(inform.securityLevel).toBe(SnmpSecurityLevel.AuthPriv);
    });

    test("SHA-256 / AES-256 informs", async () => {
      if (!supports(SHA256_AES256)) {
        return;
      }

      const result: NetSnmpToolResult = await sendInform(v3Args(SHA256_AES256));
      expect(result.exitCode).toBe(0);
      await harness.waitForForwarded(1);
      expect(harness.forwarded[0]!.securityName).toBe("fabric-sha256");
    });

    test("an authNoPriv inform", async () => {
      const result: NetSnmpToolResult = await sendInform(v3Args(AUTH_ONLY));
      expect(result.exitCode).toBe(0);
      await harness.waitForForwarded(1);
      expect(harness.forwarded[0]!.isInform).toBe(true);
    });

    test("a v2c inform", async () => {
      const result: NetSnmpToolResult = await sendInform([
        "-v",
        "2c",
        "-c",
        "public",
      ]);

      expect(result.exitCode).toBe(0);
      await harness.waitForForwarded(1);
      expect(harness.forwarded[0]!.snmpVersion).toBe("2c");
      expect(harness.forwarded[0]!.isInform).toBe(true);
      expect(harness.forwarded[0]!.community).toBe("public");
    });
  });

  describe("v1 and v2c traps are taken as before", () => {
    test("v2c", async () => {
      expect(
        (await sendTrap(["-v", "2c", "-c", "any-community"])).exitCode,
      ).toBe(0);
      await harness.waitForForwarded(1);
      expect(harness.forwarded[0]!.snmpVersion).toBe("2c");
      expect(harness.forwarded[0]!.trapOid).toBe(LINK_DOWN);
    });

    test("v1, mapped to its v2 notification OID", async () => {
      const result: NetSnmpToolResult = await tools!.run("snmptrap", [
        "-v",
        "1",
        "-c",
        "public",
        target(),
        "1.3.6.1.4.1.8072",
        "127.0.0.1",
        "2",
        "0",
        "",
        IF_INDEX,
        "i",
        "7",
      ]);

      expect(result.exitCode).toBe(0);
      await harness.waitForForwarded(1);
      expect(harness.forwarded[0]!.snmpVersion).toBe("1");
      expect(harness.forwarded[0]!.trapOid).toBe(LINK_DOWN);
    });
  });

  describe("refused, counted, and never forwarded", () => {
    test("an unknown user", async () => {
      const stranger: SnmpTrapReceiverUser = {
        ...SAN_MONITOR,
        userName: "stranger",
      };

      expect((await sendTrap(v3Args(stranger))).exitCode).toBe(0);
      await harness.settle();

      expect(harness.forwarded).toHaveLength(0);
      expect(refusalFor("stranger")).toMatchObject({
        sourceAddress: "127.0.0.1",
        reason: SnmpTrapRefusalReason.UnknownUser,
        count: 1,
      });
    });

    test("a wrong authentication passphrase", async () => {
      const wrongAuth: SnmpTrapReceiverUser = {
        ...SHA256_AES256,
        userName: "fabric-sha256",
      };

      await sendTrap(v3Args(wrongAuth, { authKey: "not-the-passphrase" }));
      await harness.settle();

      expect(harness.forwarded).toHaveLength(0);
      expect(refusalFor("fabric-sha256")?.reason).toBe(
        SnmpTrapRefusalReason.WrongDigest,
      );
    });

    test("a wrong privacy passphrase", async () => {
      await sendTrap(
        v3Args(SHA512_AES256, { privKey: "not-the-privacy-passphrase" }),
      );
      await harness.settle();

      expect(harness.forwarded).toHaveLength(0);
      expect(refusalFor("fabric-sha512")?.reason).toBe(
        SnmpTrapRefusalReason.DecryptionError,
      );
    });

    test("a trap sent without the encryption its user is configured for", async () => {
      await sendTrap(["-v", "3", "-u", "san-monitor", "-l", "noAuthNoPriv"]);
      await harness.settle();

      expect(harness.forwarded).toHaveLength(0);
      expect(refusalFor("san-monitor")?.reason).toBe(
        SnmpTrapRefusalReason.UnsupportedSecurityLevel,
      );
    });

    test("a trap from before the engine's last one (outside the time window)", async () => {
      const engine: string = "0x80001F888011223344556677";

      expect(
        (await sendTrap([...v3Args(AUTH_ONLY), "-e", engine, "-Z", "7,50000"]))
          .exitCode,
      ).toBe(0);
      await harness.waitForForwarded(1);
      expect(harness.forwarded).toHaveLength(1);

      // Same boots, its clock 49,000 seconds back: a replay, or a delayed copy.
      await sendTrap([...v3Args(AUTH_ONLY), "-e", engine, "-Z", "7,1000"]);
      await harness.settle();

      expect(harness.forwarded).toHaveLength(1);
      expect(refusalFor("auth-only")?.reason).toBe(
        SnmpTrapRefusalReason.NotInTimeWindow,
      );

      // A restart that counted itself (boots 8) is taken again.
      expect(
        (await sendTrap([...v3Args(AUTH_ONLY), "-e", engine, "-Z", "8,3"]))
          .exitCode,
      ).toBe(0);
      await harness.waitForForwarded(2);
      expect(harness.forwarded).toHaveLength(2);
      // ...and the refusal it had is put right.
      expect(refusalFor("auth-only")).toBeUndefined();
    });

    test("an inform with a wrong authentication passphrase is answered with a Report", async () => {
      const result: NetSnmpToolResult = await sendInform(
        v3Args(SAN_MONITOR, { authKey: "not-the-passphrase" }),
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toMatch(
        /Authentication failure|incorrect password/i,
      );
      expect(harness.forwarded).toHaveLength(0);
      expect(refusalFor("san-monitor")?.reason).toBe(
        SnmpTrapRefusalReason.WrongDigest,
      );
    });

    test("an inform from an unknown user is answered with a Report", async () => {
      const result: NetSnmpToolResult = await sendInform(
        v3Args({ ...SAN_MONITOR, userName: "nobody-here" }),
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toMatch(/Unknown user/i);
      expect(refusalFor("nobody-here")?.reason).toBe(
        SnmpTrapRefusalReason.UnknownUser,
      );
    });

    test("an inform sent to another engine ID than the probe's (a mistyped remote engine ID)", async () => {
      const result: NetSnmpToolResult = await sendInform([
        ...v3Args(SAN_MONITOR),
        "-e",
        "0x8000B98380000000000000000000000001",
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(harness.forwarded).toHaveLength(0);
      expect(refusalFor("san-monitor")?.reason).toBe(
        SnmpTrapRefusalReason.UnknownEngineId,
      );
    });
  });

  test("the probe's engine ID is what an inform sender discovers", async () => {
    const result: NetSnmpToolResult = await sendInform([
      ...v3Args(SAN_MONITOR),
      "-e",
      `0x${HARNESS_ENGINE_ID.toString("hex")}`,
    ]);

    // Told the probe's engine ID up front, as Cisco IOS is, the inform goes straight through.
    expect(result.exitCode).toBe(0);
    await harness.waitForForwarded(1);
    expect(harness.forwarded[0]!.isInform).toBe(true);
  });
});

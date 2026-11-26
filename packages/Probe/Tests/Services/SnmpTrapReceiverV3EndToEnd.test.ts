// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  HARNESS_ENGINE_ID,
  SnmpTrapListenerHarness,
  sleep,
  startSnmpTrapListenerHarness,
} from "../TestingUtils/SnmpTrapListenerHarness";
import { buildTestV3Message } from "../TestingUtils/SnmpV3TestMessages";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
} from "Common/Types/Probe/SnmpTrapReceiver";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";

/*
 * SNMPv3 TRAPS AND INFORMS OVER A REAL UDP SOCKET, SENT BY NET-SNMP'S OWN
 * STACK (OneUptime issue #11005).
 *
 * net-snmp's Session is what the probe polls with, and the stack of many
 * Node-based agents: here it sends v3 traps and informs to a real trap
 * listener on loopback, for every protocol OneUptime's credentials name.
 * An inform's callback fires only once its Response arrives, decrypted and
 * authenticated by net-snmp - so a callback without an error IS the sender
 * having stopped retrying.
 *
 * The users change while the listener runs, as they do when a device's
 * credentials, its profile or its probe change: the listener is never
 * restarted, and traps sent meanwhile are not lost.
 *
 * SnmpTrapReceiverNetSnmpTools runs the same exchanges with Net-SNMP's own
 * snmptrap and snmpinform, where they are installed.
 */

jest.setTimeout(60000);

const LINK_DOWN: string = "1.3.6.1.6.3.1.1.5.3";
const LINK_UP: string = "1.3.6.1.6.3.1.1.5.4";

const AUTH: Record<SnmpAuthProtocol, snmp.AuthProtocols> = {
  [SnmpAuthProtocol.MD5]: snmp.AuthProtocols.md5,
  [SnmpAuthProtocol.SHA]: snmp.AuthProtocols.sha,
  [SnmpAuthProtocol.SHA256]: snmp.AuthProtocols.sha256,
  [SnmpAuthProtocol.SHA512]: snmp.AuthProtocols.sha512,
};

const PRIV: Record<SnmpPrivProtocol, snmp.PrivProtocols> = {
  [SnmpPrivProtocol.DES]: snmp.PrivProtocols.des,
  [SnmpPrivProtocol.AES]: snmp.PrivProtocols.aes,
  [SnmpPrivProtocol.AES256]: snmp.PrivProtocols.aes256b,
};

const LEVEL: Record<SnmpSecurityLevel, snmp.SecurityLevel> = {
  [SnmpSecurityLevel.NoAuthNoPriv]: snmp.SecurityLevel.noAuthNoPriv,
  [SnmpSecurityLevel.AuthNoPriv]: snmp.SecurityLevel.authNoPriv,
  [SnmpSecurityLevel.AuthPriv]: snmp.SecurityLevel.authPriv,
};

function receiverUser(
  userName: string,
  authProtocol: SnmpAuthProtocol,
  privProtocol?: SnmpPrivProtocol,
): SnmpTrapReceiverUser {
  return {
    userName: userName,
    securityLevel: privProtocol
      ? SnmpSecurityLevel.AuthPriv
      : SnmpSecurityLevel.AuthNoPriv,
    authProtocol: authProtocol,
    authKey: `${userName}-authentication`,
    ...(privProtocol
      ? { privProtocol: privProtocol, privKey: `${userName}-privacy` }
      : {}),
    addresses: ["127.0.0.1"],
  };
}

// The sender's side of a receiver user: what the device is configured with.
function senderUser(
  user: SnmpTrapReceiverUser,
  overrides?: { authKey?: string; privKey?: string },
): snmp.User {
  const sender: snmp.User = {
    name: user.userName,
    level: LEVEL[user.securityLevel],
  };

  if (user.authProtocol) {
    sender.authProtocol = AUTH[user.authProtocol];
    sender.authKey = overrides?.authKey || user.authKey!;
  }

  if (user.privProtocol) {
    sender.privProtocol = PRIV[user.privProtocol];
    sender.privKey = overrides?.privKey || user.privKey!;
  }

  return sender;
}

function openSession(port: number, user: snmp.User): snmp.Session {
  return snmp.createV3Session("127.0.0.1", user, {
    port: port,
    trapPort: port,
    timeout: 1500,
    retries: 1,
  });
}

function sendTrap(
  session: snmp.Session,
  trapOid: string = LINK_DOWN,
): Promise<void> {
  return new Promise((resolve: () => void, reject: (err: Error) => void) => {
    session.trap(
      trapOid,
      [
        {
          oid: "1.3.6.1.2.1.2.2.1.1.7",
          type: snmp.ObjectType.Integer,
          value: 7,
        },
      ],
      (error: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      },
    );
  });
}

type InformSession = {
  inform: (
    typeOrOid: string,
    varbinds: Array<snmp.Varbind>,
    callback: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
  ) => void;
};

// Resolves with the varbinds of the probe's Response, or rejects with why there was none.
function sendInform(
  session: snmp.Session,
  trapOid: string = LINK_UP,
): Promise<Array<snmp.Varbind>> {
  return new Promise(
    (
      resolve: (varbinds: Array<snmp.Varbind>) => void,
      reject: (err: Error) => void,
    ) => {
      (session as unknown as InformSession).inform(
        trapOid,
        [
          {
            oid: "1.3.6.1.2.1.2.2.1.1.7",
            type: snmp.ObjectType.Integer,
            value: 7,
          },
        ],
        (error: Error | null, varbinds?: Array<snmp.Varbind>) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(varbinds || []);
        },
      );
    },
  );
}

const PROTOCOL_MATRIX: Array<SnmpTrapReceiverUser> = [
  receiverUser("md5-des", SnmpAuthProtocol.MD5, SnmpPrivProtocol.DES),
  receiverUser("md5-aes", SnmpAuthProtocol.MD5, SnmpPrivProtocol.AES),
  receiverUser("md5-aes256", SnmpAuthProtocol.MD5, SnmpPrivProtocol.AES256),
  receiverUser("sha-des", SnmpAuthProtocol.SHA, SnmpPrivProtocol.DES),
  receiverUser("sha-aes", SnmpAuthProtocol.SHA, SnmpPrivProtocol.AES),
  receiverUser("sha-aes256", SnmpAuthProtocol.SHA, SnmpPrivProtocol.AES256),
  receiverUser("sha256-des", SnmpAuthProtocol.SHA256, SnmpPrivProtocol.DES),
  receiverUser("sha256-aes", SnmpAuthProtocol.SHA256, SnmpPrivProtocol.AES),
  receiverUser(
    "sha256-aes256",
    SnmpAuthProtocol.SHA256,
    SnmpPrivProtocol.AES256,
  ),
  receiverUser("sha512-des", SnmpAuthProtocol.SHA512, SnmpPrivProtocol.DES),
  receiverUser("sha512-aes", SnmpAuthProtocol.SHA512, SnmpPrivProtocol.AES),
  receiverUser(
    "sha512-aes256",
    SnmpAuthProtocol.SHA512,
    SnmpPrivProtocol.AES256,
  ),
  receiverUser("md5-only", SnmpAuthProtocol.MD5),
  receiverUser("sha-only", SnmpAuthProtocol.SHA),
  receiverUser("sha256-only", SnmpAuthProtocol.SHA256),
  receiverUser("sha512-only", SnmpAuthProtocol.SHA512),
];

let harness: SnmpTrapListenerHarness | null = null;
const sessions: Array<snmp.Session> = [];

function session(user: snmp.User): snmp.Session {
  const opened: snmp.Session = openSession(harness!.port, user);
  sessions.push(opened);
  return opened;
}

afterEach(async () => {
  for (const opened of sessions.splice(0)) {
    opened.close();
  }

  await harness?.stop();
  harness = null;
});

function refusalOf(userName: string): SnmpTrapRefusal | undefined {
  return harness!.listener
    .getReport()
    .refusals.find((refusal: SnmpTrapRefusal) => {
      return refusal.userName === userName;
    });
}

describe("every protocol OneUptime's credentials name", () => {
  test("a trap of each is authenticated, decrypted and forwarded as itself", async () => {
    harness = await startSnmpTrapListenerHarness({ users: PROTOCOL_MATRIX });

    for (const user of PROTOCOL_MATRIX) {
      await sendTrap(session(senderUser(user)));
    }

    await harness.waitForForwarded(PROTOCOL_MATRIX.length);

    expect(
      harness.forwarded
        .map((trap: SnmpTrap) => {
          return `${trap.securityName} ${trap.securityLevel}`;
        })
        .sort(),
    ).toEqual(
      PROTOCOL_MATRIX.map((user: SnmpTrapReceiverUser) => {
        return `${user.userName} ${user.securityLevel}`;
      }).sort(),
    );

    for (const trap of harness.forwarded) {
      expect(trap.snmpVersion).toBe("3");
      expect(trap.trapOid).toBe(LINK_DOWN);
      expect(trap.isInform).toBe(false);
      // net-snmp's sessions are engines of their own: the trap names it.
      expect(trap.engineId).toMatch(/^8000B98380[0-9A-F]{24}$/);
      expect(trap.varbinds).toEqual(
        expect.arrayContaining([
          { oid: "1.3.6.1.6.3.1.1.4.1.0", value: LINK_DOWN },
          { oid: "1.3.6.1.2.1.2.2.1.1.7", value: "7" },
        ]),
      );
    }

    expect(harness.listener.getReport().refusals).toEqual([]);
  });

  test("an inform of each is acknowledged, and its sender hears the Response", async () => {
    harness = await startSnmpTrapListenerHarness({ users: PROTOCOL_MATRIX });

    for (const user of PROTOCOL_MATRIX) {
      const response: Array<snmp.Varbind> = await sendInform(
        session(senderUser(user)),
      );

      // The Response echoes the inform's varbinds: decrypted and authenticated by the sender.
      expect(
        response.map((varbind: snmp.Varbind) => {
          return varbind.oid;
        }),
      ).toEqual([
        "1.3.6.1.2.1.1.3.0",
        "1.3.6.1.6.3.1.1.4.1.0",
        "1.3.6.1.2.1.2.2.1.1.7",
      ]);
    }

    await harness.waitForForwarded(PROTOCOL_MATRIX.length);

    for (const inform of harness.forwarded) {
      expect(inform.isInform).toBe(true);
      expect(inform.trapOid).toBe(LINK_UP);
      // net-snmp names the probe's own engine as an inform's context: not the sender's.
      expect(inform.engineId).toBeUndefined();
    }
  });
});

describe("an inform is forwarded once, however often it is acknowledged", () => {
  test("a retried copy - an acknowledgement lost on the way back - is acknowledged again, not forwarded again", async () => {
    harness = await startSnmpTrapListenerHarness({ users: PROTOCOL_MATRIX });
    const user: SnmpTrapReceiverUser = PROTOCOL_MATRIX[4]!;

    // The probe's engine boots and time, as a sender has them after discovery.
    const datagram: Buffer = buildTestV3Message({
      credential: {
        userName: user.userName,
        authProtocol: user.authProtocol,
        authPassphrase: user.authKey,
        privProtocol: user.privProtocol,
        privPassphrase: user.privKey,
      },
      engineId: HARNESS_ENGINE_ID,
      engineTime: Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1000),
      pduType: 0xa6,
    });

    const replies: Array<Buffer> = [];
    const socket: dgram.Socket = dgram.createSocket("udp4");
    socket.on("message", (reply: Buffer) => {
      replies.push(reply);
    });
    await new Promise<void>((resolve: () => void) => {
      socket.bind(0, "127.0.0.1", resolve);
    });

    try {
      for (let copy: number = 0; copy < 3; copy++) {
        socket.send(datagram, harness.port, "127.0.0.1");
        await sleep(150);
      }

      await harness.settle();

      expect(replies).toHaveLength(3);
      expect(harness.forwarded).toHaveLength(1);
    } finally {
      socket.close();
    }
  });
});

describe("refused, counted, never forwarded", () => {
  test("wrong keys, unknown users and a missing encryption, each counted for the probe's page", async () => {
    harness = await startSnmpTrapListenerHarness({ users: PROTOCOL_MATRIX });
    const sha: SnmpTrapReceiverUser = PROTOCOL_MATRIX[4]!;
    const sha512: SnmpTrapReceiverUser = PROTOCOL_MATRIX[11]!;

    await sendTrap(session(senderUser(sha, { authKey: "a wrong passphrase" })));
    await sendTrap(
      session(senderUser(sha512, { privKey: "a wrong privacy one" })),
    );
    await sendTrap(
      session(senderUser({ ...sha, userName: "san-monitor-typo" })),
    );
    await sendTrap(
      session({ name: "sha-aes", level: snmp.SecurityLevel.noAuthNoPriv }),
    );
    await sendTrap(
      session(senderUser({ ...sha, userName: "san-monitor-typo" })),
    );
    await harness.settle(500);

    expect(harness.forwarded).toEqual([]);

    const report: SnmpTrapReceiverReport = harness.listener.getReport();
    const byUser: Map<string, Array<SnmpTrapRefusal>> = new Map();

    for (const refusal of report.refusals) {
      byUser.set(refusal.userName, [
        ...(byUser.get(refusal.userName) || []),
        refusal,
      ]);
    }

    expect(
      (byUser.get("sha-aes") || [])
        .map((refusal: SnmpTrapRefusal) => {
          return refusal.reason;
        })
        .sort(),
    ).toEqual(
      [
        SnmpTrapRefusalReason.UnsupportedSecurityLevel,
        SnmpTrapRefusalReason.WrongDigest,
      ].sort(),
    );
    expect(byUser.get("sha512-aes256")?.[0]?.reason).toBe(
      SnmpTrapRefusalReason.DecryptionError,
    );
    expect(byUser.get("san-monitor-typo")?.[0]).toMatchObject({
      sourceAddress: "127.0.0.1",
      reason: SnmpTrapRefusalReason.UnknownUser,
      count: 2,
    });
  });

  test("an inform with a wrong key is answered with a Report, so its sender says why instead of timing out", async () => {
    harness = await startSnmpTrapListenerHarness({ users: PROTOCOL_MATRIX });

    await expect(
      sendInform(
        session(
          senderUser(PROTOCOL_MATRIX[4]!, { authKey: "a wrong passphrase" }),
        ),
      ),
    ).rejects.toThrow(/Wrong Digest|incorrect password/i);

    await expect(
      sendInform(
        session(senderUser({ ...PROTOCOL_MATRIX[4]!, userName: "nobody" })),
      ),
    ).rejects.toThrow(/Unknown User Name/i);

    expect(harness.forwarded).toEqual([]);
  });
});

describe("the users change while the receiver keeps listening", () => {
  test("a credential added, changed and removed is taken at the next hand-over, and no trap in between is lost", async () => {
    const original: SnmpTrapReceiverUser = PROTOCOL_MATRIX[4]!;
    harness = await startSnmpTrapListenerHarness({ users: [original] });

    // Before: taken.
    await sendTrap(session(senderUser(original)));
    await harness.waitForForwarded(1);

    // A device added, with a user of its own.
    const added: SnmpTrapReceiverUser = PROTOCOL_MATRIX[8]!;
    await sendTrap(session(senderUser(added)));
    await harness.settle();
    expect(harness.forwarded).toHaveLength(1);
    expect(refusalOf(added.userName)?.reason).toBe(
      SnmpTrapRefusalReason.UnknownUser,
    );

    harness.listener.setUsers([original, added]);
    await sendTrap(session(senderUser(added)));
    await harness.waitForForwarded(2);
    expect(harness.forwarded[1]!.securityName).toBe(added.userName);
    // ...and the page stops saying it is refused.
    expect(refusalOf(added.userName)).toBeUndefined();

    // Its privacy passphrase rotated on the device and in OneUptime.
    const rotated: SnmpTrapReceiverUser = {
      ...added,
      privKey: "a-rotated-privacy-passphrase",
    };
    harness.listener.setUsers([original, rotated]);
    await sendTrap(session(senderUser(rotated)));
    await harness.waitForForwarded(3);
    await sendTrap(session(senderUser(added)));
    await harness.settle();
    expect(harness.forwarded).toHaveLength(3);
    expect(refusalOf(added.userName)?.reason).toBe(
      SnmpTrapRefusalReason.DecryptionError,
    );

    // The device moved to another probe: its user is no longer this one's.
    harness.listener.setUsers([original]);
    await sendTrap(session(senderUser(rotated)));
    await harness.settle();
    expect(harness.forwarded).toHaveLength(3);

    // Throughout, the device that did not change was never refused.
    await sendTrap(session(senderUser(original)));
    await harness.waitForForwarded(4);
    expect(refusalOf(original.userName)).toBeUndefined();
    expect(harness.listener.getUserCount()).toBe(1);
  });

  test("traps keep arriving while the users are replaced over and over", async () => {
    const steady: SnmpTrapReceiverUser = PROTOCOL_MATRIX[1]!;
    harness = await startSnmpTrapListenerHarness({ users: [steady] });
    const sender: snmp.Session = session(senderUser(steady));

    const replacing: ReturnType<typeof setInterval> = setInterval(() => {
      harness?.listener.setUsers([steady, PROTOCOL_MATRIX[2]!]);
      harness?.listener.setUsers([steady]);
    }, 5);

    try {
      for (let index: number = 0; index < 40; index++) {
        await sendTrap(sender);
      }

      await harness.waitForForwarded(40);
    } finally {
      clearInterval(replacing);
    }

    expect(harness.forwarded).toHaveLength(40);
    expect(harness.listener.getReport().refusals).toEqual([]);
  });
});

describe("until OneUptime hands over the first users", () => {
  test("SNMPv3 traps wait, and are taken once the users arrive - not refused as from an unknown user", async () => {
    const user: SnmpTrapReceiverUser = PROTOCOL_MATRIX[4]!;
    harness = await startSnmpTrapListenerHarness();

    await sendTrap(session(senderUser(user)));
    await sendTrap(session(senderUser(user)));
    await harness.settle();

    expect(harness.forwarded).toHaveLength(0);
    expect(harness.listener.getReport().refusals).toEqual([]);

    harness.listener.setUsers([user]);
    await harness.waitForForwarded(2);

    expect(harness.forwarded).toHaveLength(2);
    expect(harness.listener.getReport().refusals).toEqual([]);
  });

  test("they wait a minute at most: with no users by then, they are refused as they would be", async () => {
    const user: SnmpTrapReceiverUser = PROTOCOL_MATRIX[4]!;
    harness = await startSnmpTrapListenerHarness({ usersLoadWaitMs: 400 });

    await sendTrap(session(senderUser(user)));
    await harness.settle(800);

    expect(harness.forwarded).toHaveLength(0);
    expect(refusalOf(user.userName)?.reason).toBe(
      SnmpTrapRefusalReason.UnknownUser,
    );
  });

  test("v1 and v2c traps never wait", async () => {
    harness = await startSnmpTrapListenerHarness();
    const v2c: snmp.Session = snmp.createSession("127.0.0.1", "public", {
      trapPort: harness.port,
      version: snmp.Version2c,
    });
    sessions.push(v2c);

    await sendTrap(v2c);
    await harness.waitForForwarded(1);

    expect(harness.forwarded[0]!.snmpVersion).toBe("2c");
  });
});

describe("what the probe reports", () => {
  test("its engine ID, its users and when it last took a trap", async () => {
    harness = await startSnmpTrapListenerHarness({ users: PROTOCOL_MATRIX });

    const before: SnmpTrapReceiverReport = harness.listener.getReport();
    expect(before).toEqual({
      isEnabled: true,
      port: harness.port,
      engineId: HARNESS_ENGINE_ID.toString("hex").toUpperCase(),
      userCount: PROTOCOL_MATRIX.length,
      refusals: [],
    });

    await sendTrap(session(senderUser(PROTOCOL_MATRIX[0]!)));
    await harness.waitForForwarded(1);

    const after: SnmpTrapReceiverReport = harness.listener.getReport();
    expect(after.lastReceivedAt).toMatch(/:00\.000Z$/);
    expect(Date.parse(after.lastReceivedAt!)).toBeLessThanOrEqual(Date.now());
  });
});

describe("SNMPv3 never reaches net-snmp's own receiver", () => {
  test("a noAuthNoPriv trap from a user nobody configured - which net-snmp's receiver took, as 2c - is refused", async () => {
    harness = await startSnmpTrapListenerHarness({ users: [] });

    await sendTrap(
      session({ name: "anybody", level: snmp.SecurityLevel.noAuthNoPriv }),
    );
    await harness.settle();

    expect(harness.forwarded).toEqual([]);
    expect(refusalOf("anybody")?.reason).toBe(
      SnmpTrapRefusalReason.UnknownUser,
    );
  });
});

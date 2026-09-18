// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";
import {
  decryptPduDes,
  encryptPduDes,
  isNativeDesCbcAvailable,
} from "../../../Utils/Snmp/SnmpDesPrivacyCompat";

/*
 * A full SNMP v3 authPriv exchange with DES privacy, over a real UDP socket on
 * loopback: a net-snmp agent answers a net-snmp client, so every layer the
 * customer's failing poll used is exercised — engine discovery, the SHA
 * authentication digest, DES encryption of the scoped PDU, and decryption of
 * the reply.
 *
 * The unit tests around it prove the cipher is right; this one proves the
 * patch is actually reached when a message is built and parsed, which is the
 * part a mocked test can never show.
 */

const SYS_DESCR: string = "OneUptime SNMPv3 DES test device";
const SYS_DESCR_OID: string = "1.3.6.1.2.1.1.1.0";

const V3_USER: snmp.User = {
  name: "monitoring",
  level: snmp.SecurityLevel.authPriv,
  authProtocol: snmp.AuthProtocols.sha,
  authKey: "auth-passphrase-1234",
  privProtocol: snmp.PrivProtocols.des,
  privKey: "priv-passphrase-1234",
};

/*
 * net-snmp's agent cannot report the port it settled on, so a free one is
 * found and released first. Binding a fixed port would collide with whatever
 * else the CI host is running.
 */
function findFreeUdpPort(): Promise<number> {
  return new Promise(
    (resolve: (port: number) => void, reject: (reason?: Error) => void) => {
      const socket: dgram.Socket = dgram.createSocket("udp4");

      socket.once("error", (error: Error) => {
        reject(error);
      });

      socket.bind(0, "127.0.0.1", () => {
        const port: number = socket.address().port;
        socket.close(() => {
          resolve(port);
        });
      });
    },
  );
}

type SnmpAgent = {
  getAuthorizer: () => { addUser: (user: snmp.User) => void };
  getMib: () => {
    registerProvider: (provider: unknown) => void;
    setScalarValue: (name: string, value: unknown) => void;
  };
  close: () => void;
};

let agent: SnmpAgent | undefined = undefined;
let agentPort: number = 0;

function getSysDescr(session: snmp.Session): Promise<string> {
  return new Promise(
    (resolve: (value: string) => void, reject: (reason?: Error) => void) => {
      session.get(
        [SYS_DESCR_OID],
        (error: Error | null, varbinds: Array<snmp.Varbind> | undefined) => {
          if (error) {
            reject(error);
            return;
          }

          const varbind: snmp.Varbind | undefined = varbinds?.[0];

          if (!varbind) {
            reject(new Error("No varbinds returned"));
            return;
          }

          if (snmp.isVarbindError(varbind)) {
            reject(new Error(snmp.varbindError(varbind)));
            return;
          }

          resolve(String(varbind.value));
        },
      );
    },
  );
}

function createClientSession(): snmp.Session {
  return snmp.createV3Session("127.0.0.1", V3_USER, {
    port: agentPort,
    timeout: 4000,
    retries: 0,
    version: snmp.Version3,
  });
}

beforeAll(async () => {
  agentPort = await findFreeUdpPort();

  agent = snmp.createAgent(
    { port: agentPort, disableAuthorization: false },
    () => {
      // Agent-side errors surface to the client as a timeout; nothing to do.
    },
  ) as unknown as SnmpAgent;

  agent.getAuthorizer().addUser(V3_USER);

  agent.getMib().registerProvider({
    name: "sysDescr",
    type: snmp.MibProviderType.Scalar,
    oid: "1.3.6.1.2.1.1.1",
    scalarType: snmp.ObjectType.OctetString,
    maxAccess: snmp.MaxAccess["read-only"],
  });
  agent.getMib().setScalarValue("sysDescr", SYS_DESCR);
});

afterAll(() => {
  agent?.close();
});

describe("SNMP v3 authPriv with DES privacy — end to end over UDP", () => {
  /*
   * The customer's exact configuration: v3, authPriv, SHA authentication, DES
   * privacy. Before the fix this failed with error:0308010C on every attempt.
   */
  test("a DES authPriv GET returns the device's sysDescr", async () => {
    const session: snmp.Session = createClientSession();

    try {
      await expect(getSysDescr(session)).resolves.toBe(SYS_DESCR);
    } finally {
      session.close();
    }
  }, 20000);

  test("repeated DES polls keep working, so the fresh per-message salt round-trips", async () => {
    const session: snmp.Session = createClientSession();

    try {
      for (let poll: number = 0; poll < 5; poll++) {
        await expect(getSysDescr(session)).resolves.toBe(SYS_DESCR);
      }
    } finally {
      session.close();
    }
  }, 30000);

  /*
   * Reinstates net-snmp's own DES functions to show the failure this change
   * repairs, then puts the compat implementations back. Without this the suite
   * would still pass if the patch silently stopped being applied.
   *
   * On a runtime that still has single des-cbc the library works unpatched, so
   * the assertion flips rather than being skipped.
   */
  test("the same poll fails with the reported OpenSSL error on stock net-snmp", async () => {
    const desEntry: {
      encryptPdu: typeof snmp.Encryption.encryptPduDes;
      decryptPdu: typeof snmp.Encryption.decryptPduDes;
    } = snmp.Encryption.algorithms[snmp.PrivProtocols.des];

    const session: snmp.Session = createClientSession();

    try {
      desEntry.encryptPdu = snmp.Encryption.encryptPduDes;
      desEntry.decryptPdu = snmp.Encryption.decryptPduDes;

      if (isNativeDesCbcAvailable()) {
        await expect(getSysDescr(session)).resolves.toBe(SYS_DESCR);
      } else {
        await expect(getSysDescr(session)).rejects.toThrow(
          /unsupported|not supported|Unknown cipher/i,
        );
      }
    } finally {
      desEntry.encryptPdu =
        encryptPduDes as unknown as typeof snmp.Encryption.encryptPduDes;
      desEntry.decryptPdu =
        decryptPduDes as unknown as typeof snmp.Encryption.decryptPduDes;
      session.close();
    }
  }, 20000);

  // The repaired path must still work once the patch is back in place.
  test("polling recovers immediately after the compat layer is restored", async () => {
    const session: snmp.Session = createClientSession();

    try {
      await expect(getSysDescr(session)).resolves.toBe(SYS_DESCR);
    } finally {
      session.close();
    }
  }, 20000);
});

describe("SNMP v3 authPriv with AES privacy — end to end over UDP", () => {
  /*
   * AES was never affected by the OpenSSL 3 change. Polling a second agent
   * with an AES user confirms the DES patch did not disturb the privacy path
   * that was already working.
   */
  test("an AES authPriv GET still returns the device's sysDescr", async () => {
    const aesPort: number = await findFreeUdpPort();
    const aesUser: snmp.User = {
      ...V3_USER,
      name: "monitoring-aes",
      privProtocol: snmp.PrivProtocols.aes,
    };

    const aesAgent: SnmpAgent = snmp.createAgent(
      { port: aesPort, disableAuthorization: false },
      () => {
        // See above.
      },
    ) as unknown as SnmpAgent;

    aesAgent.getAuthorizer().addUser(aesUser);
    aesAgent.getMib().registerProvider({
      name: "sysDescr",
      type: snmp.MibProviderType.Scalar,
      oid: "1.3.6.1.2.1.1.1",
      scalarType: snmp.ObjectType.OctetString,
      maxAccess: snmp.MaxAccess["read-only"],
    });
    aesAgent.getMib().setScalarValue("sysDescr", SYS_DESCR);

    const session: snmp.Session = snmp.createV3Session("127.0.0.1", aesUser, {
      port: aesPort,
      timeout: 4000,
      retries: 0,
      version: snmp.Version3,
    });

    try {
      await expect(getSysDescr(session)).resolves.toBe(SYS_DESCR);
    } finally {
      session.close();
      aesAgent.close();
    }
  }, 20000);
});

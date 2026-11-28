// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  SnmpTrapListenerHarness,
  startSnmpTrapListenerHarness,
} from "../TestingUtils/SnmpTrapListenerHarness";
import {
  RECORDED_SHARED_ADDRESS_TRAPS,
  SHARED_ADDRESS,
  SHARED_ADDRESS_DEVICES,
  SHARED_ADDRESS_RECEIVER_USERS,
  SYS_UP_TIME_OID,
  SharedAddressDeviceKey,
  forwardedSharedAddressTrap,
} from "Common/Tests/Helpers/Snmp/SharedAddressSnmpV3Traps";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverUser,
  SnmpTrapRefusal,
} from "Common/Types/Probe/SnmpTrapReceiver";
import { SnmpV3CredentialHolders } from "Common/Types/Probe/SnmpV3CredentialHolders";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";

/*
 * SNMPv3 TRAPS FROM DEVICES THAT SHARE ONE ADDRESS, THROUGH A REAL RECEIVER
 * (OneUptime issue #11172).
 *
 * Every trap below comes from 127.0.0.1, as traps from devices behind one
 * NAT address or blades behind their chassis's address come from one
 * address. The receiver takes each with the key that signs it and forwards
 * it with the records OneUptime said hold that key (SnmpTrap.signedBy) and
 * the engine it was sent as: what tells the server which device sent it.
 *
 *   - Recorded: four traps Net-SNMP 5.9.4's snmptrap sent, two blades with
 *     users of their own and two switches sharing their site's default
 *     credential (Common/Tests/Helpers/Snmp/SharedAddressSnmpV3Traps),
 *     replayed as they arrived.
 *   - Live: net-snmp's own Session - the stack many Node-based agents use,
 *     and the one the probe polls with - as two devices with their own
 *     engine IDs, sending from one socket address.
 *
 * SnmpTrapReceiverNetSnmpTools runs Net-SNMP's tools live, where they are
 * installed.
 */

jest.setTimeout(60000);

const harnesses: Array<SnmpTrapListenerHarness> = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.stop();
  }
});

async function listener(
  users: Array<SnmpTrapReceiverUser>,
): Promise<SnmpTrapListenerHarness> {
  const harness: SnmpTrapListenerHarness = await startSnmpTrapListenerHarness({
    users: users,
  });
  harnesses.push(harness);
  return harness;
}

function sendDatagram(port: number, datagram: Buffer): Promise<void> {
  return new Promise((resolve: () => void, reject: (err: Error) => void) => {
    const socket: dgram.Socket = dgram.createSocket("udp4");

    socket.send(datagram, port, SHARED_ADDRESS, (err: Error | null) => {
      socket.close();

      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

// What was forwarded, but when, and the sysUpTime each sender read for itself.
function withoutTimes(trap: SnmpTrap): Omit<SnmpTrap, "receivedAt"> {
  const kept: Partial<SnmpTrap> = { ...trap };
  delete kept.receivedAt;
  return {
    ...(kept as Omit<SnmpTrap, "receivedAt">),
    varbinds: trap.varbinds.filter((varbind: { oid: string }) => {
      return varbind.oid !== SYS_UP_TIME_OID;
    }),
  };
}

describe("traps Net-SNMP's snmptrap recorded from four devices at one address", () => {
  test("each is taken with the key that signed it and forwarded with who holds that key and its engine", async () => {
    const harness: SnmpTrapListenerHarness = await listener(
      SHARED_ADDRESS_RECEIVER_USERS,
    );

    for (const recorded of RECORDED_SHARED_ADDRESS_TRAPS) {
      await sendDatagram(harness.port, Buffer.from(recorded.datagram, "hex"));
    }

    await harness.waitForForwarded(RECORDED_SHARED_ADDRESS_TRAPS.length);

    expect(harness.listener.getReport().refusals).toEqual([]);
    expect(harness.forwarded.map(withoutTimes)).toEqual(
      RECORDED_SHARED_ADDRESS_TRAPS.map(
        (recorded: { device: SharedAddressDeviceKey }) => {
          return forwardedSharedAddressTrap(recorded.device);
        },
      ),
    );

    // A sysUpTime each sender read for itself, as TimeTicks.
    for (const trap of harness.forwarded) {
      expect(trap.varbinds[0]!.oid).toBe(SYS_UP_TIME_OID);
      expect(trap.varbinds[0]!.value).toMatch(/^\d+$/);
    }
  });

  test("the two blades, at one address and both SNMPv3, are told apart by who holds the key that signed each", async () => {
    const harness: SnmpTrapListenerHarness = await listener(
      SHARED_ADDRESS_RECEIVER_USERS,
    );

    for (const recorded of RECORDED_SHARED_ADDRESS_TRAPS.slice(0, 2)) {
      await sendDatagram(harness.port, Buffer.from(recorded.datagram, "hex"));
    }

    await harness.waitForForwarded(2);

    const signers: Array<Array<string> | undefined> = harness.forwarded.map(
      (trap: SnmpTrap) => {
        return trap.signedBy?.deviceIds;
      },
    );

    expect(signers).toEqual([
      [SHARED_ADDRESS_DEVICES.blade1.id],
      [SHARED_ADDRESS_DEVICES.blade2.id],
    ]);
    expect(
      harness.forwarded.map((trap: SnmpTrap) => {
        return trap.sourceIpAddress;
      }),
    ).toEqual([SHARED_ADDRESS, SHARED_ADDRESS]);
  });

  test("the two switches sharing their site's default carry the same holders: only their engines tell them apart", async () => {
    const harness: SnmpTrapListenerHarness = await listener(
      SHARED_ADDRESS_RECEIVER_USERS,
    );

    for (const recorded of RECORDED_SHARED_ADDRESS_TRAPS.slice(2)) {
      await sendDatagram(harness.port, Buffer.from(recorded.datagram, "hex"));
    }

    await harness.waitForForwarded(2);

    expect(harness.forwarded[0]!.signedBy).toEqual(
      harness.forwarded[1]!.signedBy,
    );
    expect(
      harness.forwarded.map((trap: SnmpTrap) => {
        return trap.engineId;
      }),
    ).toEqual([
      SHARED_ADDRESS_DEVICES.siteSwitch1.engineId,
      SHARED_ADDRESS_DEVICES.siteSwitch2.engineId,
    ]);
  });

  test("from a server older than #11172, which says no holders, the same traps are forwarded without them", async () => {
    const harness: SnmpTrapListenerHarness = await listener(
      SHARED_ADDRESS_RECEIVER_USERS.map((user: SnmpTrapReceiverUser) => {
        const withoutHolders: SnmpTrapReceiverUser = { ...user };
        delete withoutHolders.heldBy;
        return withoutHolders;
      }),
    );

    await sendDatagram(
      harness.port,
      Buffer.from(RECORDED_SHARED_ADDRESS_TRAPS[0]!.datagram, "hex"),
    );
    await harness.waitForForwarded(1);

    expect(harness.forwarded[0]!.securityName).toBe("blade-1-monitor");
    expect(harness.forwarded[0]).not.toHaveProperty("signedBy");
  });

  test("a key OneUptime does not have for that user is still refused, and nothing is forwarded", async () => {
    const harness: SnmpTrapListenerHarness = await listener(
      SHARED_ADDRESS_RECEIVER_USERS.map((user: SnmpTrapReceiverUser) => {
        return user.userName === "blade-1-monitor"
          ? { ...user, authKey: "not-what-blade-1-is-given" }
          : user;
      }),
    );

    await sendDatagram(
      harness.port,
      Buffer.from(RECORDED_SHARED_ADDRESS_TRAPS[0]!.datagram, "hex"),
    );
    await harness.settle();

    expect(harness.forwarded).toEqual([]);
    expect(
      harness.listener.getReport().refusals.map((refusal: SnmpTrapRefusal) => {
        return `${refusal.sourceAddress} ${refusal.userName} ${refusal.reason}`;
      }),
    ).toEqual(["127.0.0.1 blade-1-monitor wrongDigest"]);
  });
});

describe("net-snmp's own stack, as two devices sending from one address", () => {
  const ROUTER_A: SnmpV3CredentialHolders = {
    projectIds: ["11720000-0000-4000-8000-00000000ac0e"],
    deviceIds: ["11720000-0000-4000-8000-00000000a001"],
    siteIds: [],
  };
  const ROUTER_B: SnmpV3CredentialHolders = {
    projectIds: ["11720000-0000-4000-8000-00000000ac0e"],
    deviceIds: ["11720000-0000-4000-8000-00000000a002"],
    siteIds: [],
  };

  // One user name, each its own keys: told apart by the key that signs.
  const USERS: Array<SnmpTrapReceiverUser> = [
    {
      userName: "router-monitor",
      securityLevel: SnmpSecurityLevel.AuthPriv,
      authProtocol: SnmpAuthProtocol.SHA256,
      authKey: "router-a-auth-passphrase",
      privProtocol: SnmpPrivProtocol.AES,
      privKey: "router-a-priv-passphrase",
      addresses: [SHARED_ADDRESS],
      heldBy: ROUTER_A,
    },
    {
      userName: "router-monitor",
      securityLevel: SnmpSecurityLevel.AuthPriv,
      authProtocol: SnmpAuthProtocol.SHA256,
      authKey: "router-b-auth-passphrase",
      privProtocol: SnmpPrivProtocol.AES,
      privKey: "router-b-priv-passphrase",
      addresses: [SHARED_ADDRESS],
      heldBy: ROUTER_B,
    },
  ];

  function sendAs(data: {
    port: number;
    engineId: string;
    authKey: string;
    privKey: string;
  }): Promise<void> {
    const session: snmp.Session = snmp.createV3Session(
      SHARED_ADDRESS,
      {
        name: "router-monitor",
        level: snmp.SecurityLevel.authPriv,
        authProtocol: snmp.AuthProtocols.sha256,
        authKey: data.authKey,
        privProtocol: snmp.PrivProtocols.aes,
        privKey: data.privKey,
      },
      {
        port: data.port,
        trapPort: data.port,
        // The device's own engine: a trap is sent as it (RFC 3414).
        engineID: data.engineId,
        timeout: 1500,
        retries: 1,
      },
    );

    return new Promise((resolve: () => void, reject: (err: Error) => void) => {
      session.trap(
        "1.3.6.1.6.3.1.1.5.3",
        [
          {
            oid: "1.3.6.1.2.1.2.2.1.1.9",
            type: snmp.ObjectType.Integer,
            value: 9,
          },
        ],
        (error: Error | null) => {
          session.close();

          if (error) {
            reject(error);
            return;
          }

          resolve();
        },
      );
    });
  }

  test("each trap is forwarded with the holders of the device whose key signed it", async () => {
    const harness: SnmpTrapListenerHarness = await listener(USERS);

    await sendAs({
      port: harness.port,
      engineId: "8000B98380AA00000000000A01",
      authKey: "router-a-auth-passphrase",
      privKey: "router-a-priv-passphrase",
    });
    await sendAs({
      port: harness.port,
      engineId: "8000B98380AA00000000000B02",
      authKey: "router-b-auth-passphrase",
      privKey: "router-b-priv-passphrase",
    });
    await harness.waitForForwarded(2);

    expect(
      harness.forwarded.map((trap: SnmpTrap) => {
        return {
          from: trap.sourceIpAddress,
          user: trap.securityName,
          engineId: trap.engineId,
          signedBy: trap.signedBy,
        };
      }),
    ).toEqual([
      {
        from: SHARED_ADDRESS,
        user: "router-monitor",
        engineId: "8000B98380AA00000000000A01",
        signedBy: ROUTER_A,
      },
      {
        from: SHARED_ADDRESS,
        user: "router-monitor",
        engineId: "8000B98380AA00000000000B02",
        signedBy: ROUTER_B,
      },
    ]);
  });

  test("a noAuthNoPriv trap from the same address carries no holders: its user name is anyone's", async () => {
    const harness: SnmpTrapListenerHarness = await listener([
      {
        userName: "open-traps",
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        addresses: [SHARED_ADDRESS],
        heldBy: ROUTER_A,
      },
    ]);

    const session: snmp.Session = snmp.createV3Session(
      SHARED_ADDRESS,
      { name: "open-traps", level: snmp.SecurityLevel.noAuthNoPriv },
      {
        port: harness.port,
        trapPort: harness.port,
        timeout: 1500,
        retries: 1,
      },
    );

    await new Promise<void>(
      (resolve: () => void, reject: (err: Error) => void) => {
        session.trap(snmp.TrapType.ColdStart, (error: Error | null) => {
          session.close();

          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      },
    );

    await harness.waitForForwarded(1);

    expect(harness.forwarded[0]!.securityName).toBe("open-traps");
    expect(harness.forwarded[0]).not.toHaveProperty("signedBy");
  });
});

// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  SnmpTrapListenerHarness,
  startSnmpTrapListenerHarness,
} from "../TestingUtils/SnmpTrapListenerHarness";
import {
  RECORDED_UNKNOWN_SENDER_TRAPS,
  RecordedUnknownSenderTrap,
  SYS_UP_TIME_OID,
  UNKNOWN_SENDER_RECEIVER_USERS,
  forwardedUnknownSenderTrap,
} from "Common/Tests/Helpers/Snmp/UnknownSenderSnmpTraps";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dgram from "dgram";

/*
 * SNMP TRAPS FROM SENDERS THAT ARE NOT DEVICES YET, THROUGH A REAL RECEIVER
 * (OneUptime issue #11407).
 *
 * Three traps Net-SNMP 5.9.4's snmptrap sent, each from a loopback address
 * of its own (Common/Tests/Helpers/Snmp/UnknownSenderSnmpTraps): a Brocade
 * port state change and a linkDown over v2c, and a Cisco configuration
 * change over SNMPv3 signed with a site's default credentials. The probe
 * forwards each as it is - it never knows which addresses are devices - and
 * what it forwards is what the server's ProcessSnmpTrapUnknownSenders hands
 * the trap ingest, which keeps each as from an unknown source.
 */

jest.setTimeout(60000);

const harnesses: Array<SnmpTrapListenerHarness> = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.stop();
  }
});

function sendFrom(data: {
  source: string;
  port: number;
  datagram: Buffer;
}): Promise<void> {
  return new Promise((resolve: () => void, reject: (err: Error) => void) => {
    const socket: dgram.Socket = dgram.createSocket("udp4");

    socket.once("error", (err: Error) => {
      socket.close();
      reject(err);
    });

    socket.bind(0, data.source, () => {
      socket.send(
        data.datagram,
        data.port,
        "127.0.0.1",
        (err: Error | null) => {
          socket.close();

          if (err) {
            reject(err);
            return;
          }

          resolve();
        },
      );
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

describe("three traps Net-SNMP sent from senders that are not devices yet", () => {
  test("each is forwarded from the address it came from, as it was sent", async () => {
    const harness: SnmpTrapListenerHarness = await startSnmpTrapListenerHarness(
      { users: UNKNOWN_SENDER_RECEIVER_USERS },
    );
    harnesses.push(harness);

    for (const recorded of RECORDED_UNKNOWN_SENDER_TRAPS) {
      await sendFrom({
        source: recorded.source,
        port: harness.port,
        datagram: Buffer.from(recorded.datagram, "hex"),
      });
    }

    await harness.waitForForwarded(RECORDED_UNKNOWN_SENDER_TRAPS.length);

    expect(harness.listener.getReport().refusals).toEqual([]);
    expect(harness.forwarded.map(withoutTimes)).toEqual(
      RECORDED_UNKNOWN_SENDER_TRAPS.map(
        (recorded: RecordedUnknownSenderTrap) => {
          return forwardedUnknownSenderTrap(recorded.key);
        },
      ),
    );
  });

  test("the configuration change is taken with the site's default credentials, and forwarded with the site that holds them", async () => {
    const harness: SnmpTrapListenerHarness = await startSnmpTrapListenerHarness(
      { users: UNKNOWN_SENDER_RECEIVER_USERS },
    );
    harnesses.push(harness);

    const cisco: RecordedUnknownSenderTrap = RECORDED_UNKNOWN_SENDER_TRAPS.find(
      (recorded: RecordedUnknownSenderTrap) => {
        return recorded.key === "ciscoConfig";
      },
    )!;

    await sendFrom({
      source: cisco.source,
      port: harness.port,
      datagram: Buffer.from(cisco.datagram, "hex"),
    });
    await harness.waitForForwarded(1);

    expect(harness.forwarded[0]!.signedBy).toEqual(
      UNKNOWN_SENDER_RECEIVER_USERS[0]!.heldBy,
    );
  });

  test("without the site's default, the SNMPv3 one is refused and the v2c ones still come", async () => {
    const harness: SnmpTrapListenerHarness = await startSnmpTrapListenerHarness(
      { users: [] },
    );
    harnesses.push(harness);

    for (const recorded of RECORDED_UNKNOWN_SENDER_TRAPS) {
      await sendFrom({
        source: recorded.source,
        port: harness.port,
        datagram: Buffer.from(recorded.datagram, "hex"),
      });
    }

    await harness.waitForForwarded(2);
    await harness.settle();

    expect(
      harness.forwarded.map((trap: SnmpTrap) => {
        return trap.sourceIpAddress;
      }),
    ).toEqual(["127.0.12.20", "127.0.12.21"]);
    expect(harness.listener.getReport().refusals).toEqual([
      expect.objectContaining({
        sourceAddress: "127.0.12.22",
        userName: "branch-default",
      }),
    ]);
  });
});

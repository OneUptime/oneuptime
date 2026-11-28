// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  SnmpTrapListenerHarness,
  startSnmpTrapListenerHarness,
} from "../TestingUtils/SnmpTrapListenerHarness";
import {
  DNS_NAMED_RECEIVER_USERS,
  RECORDED_DNS_NAMED_REFUSALS,
  RecordedRefusedTrap,
} from "Common/Tests/Helpers/Snmp/DnsNamedDeviceSnmpV3Traps";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
  SnmpTrapRefusal,
} from "Common/Types/Probe/SnmpTrapReceiver";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dgram from "dgram";

/*
 * SNMPv3 TRAPS FROM DEVICES NAMED BY DNS NAMES, REFUSED BY A REAL RECEIVER
 * (OneUptime issue #11406).
 *
 * Five traps Net-SNMP 5.9.4's snmptrap sent, each from a loopback address of
 * its own (Common/Tests/Helpers/Snmp/DnsNamedDeviceSnmpV3Traps), replayed
 * from that address into the receiver a probe runs, with the one user
 * OneUptime handed it. The receiver refuses all five, and its report says
 * where each came from, as whom and why: what OneUptime then matches to the
 * devices whose DNS names resolve to those addresses
 * (App/Tests/Telemetry/ProbeIngestSnmpTrapReceiverDnsNames). The report
 * never names a device: the probe knows addresses only.
 */

jest.setTimeout(60000);

const harnesses: Array<SnmpTrapListenerHarness> = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.stop();
  }
});

// A datagram sent from a loopback address of its own, as the device sent it.
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

async function replayed(
  recorded: Array<RecordedRefusedTrap>,
): Promise<SnmpTrapListenerHarness> {
  const harness: SnmpTrapListenerHarness = await startSnmpTrapListenerHarness({
    users: DNS_NAMED_RECEIVER_USERS,
  });
  harnesses.push(harness);

  for (const trap of recorded) {
    await sendFrom({
      source: trap.source,
      port: harness.port,
      datagram: Buffer.from(trap.datagram, "hex"),
    });
  }

  // Until every one is counted: a refused trap is never forwarded.
  for (let attempt: number = 0; attempt < 100; attempt++) {
    if (
      SnmpTrapReceiverUtil.countRefused(
        harness.listener.getReport().refusals,
      ) >= recorded.length
    ) {
      break;
    }

    await harness.settle(20);
  }

  return harness;
}

function bySource(refusals: Array<SnmpTrapRefusal>): Array<SnmpTrapRefusal> {
  return [...refusals].sort((a: SnmpTrapRefusal, b: SnmpTrapRefusal) => {
    return a.sourceAddress.localeCompare(b.sourceAddress, undefined, {
      numeric: true,
    });
  });
}

describe("five SNMPv3 traps Net-SNMP sent from devices added by DNS names", () => {
  test("each is refused, counted by the address it came from, as whom and why", async () => {
    const harness: SnmpTrapListenerHarness = await replayed(
      RECORDED_DNS_NAMED_REFUSALS,
    );

    await harness.settle();

    expect(harness.forwarded).toEqual([]);

    expect(
      bySource(harness.listener.getReport().refusals).map(
        (refusal: SnmpTrapRefusal) => {
          return {
            sourceAddress: refusal.sourceAddress,
            reason: refusal.reason,
            userName: refusal.userName,
            count: refusal.count,
          };
        },
      ),
    ).toEqual(
      RECORDED_DNS_NAMED_REFUSALS.map((recorded: RecordedRefusedTrap) => {
        return {
          sourceAddress: recorded.source,
          reason: recorded.reason,
          userName: recorded.userName,
          count: 1,
        };
      }),
    );
  });

  test("the edge firewall still signs with its old passphrase: a wrong digest, under the user OneUptime handed over", async () => {
    const harness: SnmpTrapListenerHarness = await replayed(
      RECORDED_DNS_NAMED_REFUSALS.filter((recorded: RecordedRefusedTrap) => {
        return recorded.userName === "acme-edge";
      }),
    );

    const refusals: Array<SnmpTrapRefusal> =
      harness.listener.getReport().refusals;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      sourceAddress: "127.0.11.7",
      reason: "wrongDigest",
      userName: "acme-edge",
      count: 1,
    });
  });

  test("a trap sent twice from one address, as one user, is one refusal counted twice", async () => {
    const core: RecordedRefusedTrap = RECORDED_DNS_NAMED_REFUSALS[0]!;
    const harness: SnmpTrapListenerHarness = await replayed([core, core]);

    expect(harness.listener.getReport().refusals).toEqual([
      expect.objectContaining({
        sourceAddress: core.source,
        userName: core.userName,
        count: 2,
      }),
    ]);
  });

  test("what the probe reports names no device: it is read by the server as addresses only", async () => {
    const harness: SnmpTrapListenerHarness = await replayed(
      RECORDED_DNS_NAMED_REFUSALS,
    );

    const report: SnmpTrapReceiverReport = harness.listener.getReport();

    for (const refusal of report.refusals) {
      expect(refusal.deviceIds).toBeUndefined();
    }

    // As the report route reads it: the same refusals, still with no devices.
    expect(
      SnmpTrapReceiverUtil.sanitizeReport(
        JSON.parse(JSON.stringify(report)),
      )!.refusals.map((refusal: SnmpTrapRefusal) => {
        return refusal.sourceAddress;
      }),
    ).toEqual(
      report.refusals.map((refusal: SnmpTrapRefusal) => {
        return refusal.sourceAddress;
      }),
    );
  });
});

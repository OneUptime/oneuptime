import SnmpEngineDiscovery from "../../../Utils/Snmp/SnmpEngineDiscovery";
import { BerTag } from "../../../Utils/Snmp/V3/SnmpBer";
import {
  ParsedSnmpV3Message,
  ScopedPdu,
  parseScopedPdu,
  parseV3Message,
} from "../../../Utils/Snmp/V3/SnmpV3Message";
import {
  NET_SNMP_AGENT_ENGINE_ID,
  NET_SNMP_DISCOVERY_MSG_ID,
  NET_SNMP_DISCOVERY_REPORT,
  NET_SNMP_DISCOVERY_REQUEST,
  NET_SNMP_DISCOVERY_REQUEST_ID,
} from "../../TestingUtils/NetSnmpEngineDiscoveryRecording";
import RecordedSnmpAgent, {
  simulatorRecording,
} from "../../TestingUtils/RecordedSnmpAgent";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";

/*
 * AN SNMP AGENT'S ENGINE ID, BY SNMPv3 ENGINE DISCOVERY (OneUptime issue
 * #11405).
 *
 * What the probe sends a device it polls over v1 or v2c when its community
 * cannot read snmpEngineID: one discovery request, as Net-SNMP's own
 * manager sends it, and the engine ID the agent's Report says. Against a
 * recording of Net-SNMP 5.9.4's request and its agent's answer, against
 * net-snmp's own agent over a real socket, and against everything that is
 * not that answer.
 */

jest.setTimeout(60000);

const SWITCH_A: string = simulatorRecording("switch-a", "public.snmprec");

const agents: Array<RecordedSnmpAgent> = [];
const sockets: Array<dgram.Socket> = [];

afterEach(() => {
  for (const agent of agents.splice(0)) {
    agent.close();
  }

  for (const socket of sockets.splice(0)) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
});

async function agent(
  options: Partial<Parameters<typeof RecordedSnmpAgent.start>[0]> = {},
): Promise<RecordedSnmpAgent> {
  const started: RecordedSnmpAgent = await RecordedSnmpAgent.start({
    recording: SWITCH_A,
    community: "public",
    ...options,
  });
  agents.push(started);
  return started;
}

// A UDP socket that answers every datagram with what `answer` makes of it.
function responder(
  answer: (request: Buffer) => Buffer | null,
): Promise<{ port: number; received: Array<Buffer> }> {
  const received: Array<Buffer> = [];
  const socket: dgram.Socket = dgram.createSocket("udp4");
  sockets.push(socket);

  socket.on("message", (request: Buffer, rinfo: dgram.RemoteInfo): void => {
    received.push(request);
    const reply: Buffer | null = answer(request);

    if (reply) {
      socket.send(reply, rinfo.port, rinfo.address);
    }
  });

  return new Promise(
    (resolve: (value: { port: number; received: Array<Buffer> }) => void) => {
      socket.bind(0, "127.0.0.1", () => {
        resolve({ port: socket.address().port, received: received });
      });
    },
  );
}

// The request's msgID and request-id, as the agent reads them.
function idsOf(request: Buffer): { msgId: number; requestId: number } {
  const parsed: ParsedSnmpV3Message = parseV3Message(request);
  return {
    msgId: parsed.msgId,
    requestId: parseScopedPdu(parsed.scopedPdu!).requestId,
  };
}

/*
 * Net-SNMP's recorded Report, made the answer to `request`: its msgID and
 * request-id rewritten in place, as the agent would have written them.
 */
function netSnmpReportFor(request: Buffer): Buffer {
  const ids: { msgId: number; requestId: number } = idsOf(request);
  const report: Buffer = Buffer.from(NET_SNMP_DISCOVERY_REPORT, "hex");

  const recordedMsgId: Buffer = Buffer.alloc(4);
  recordedMsgId.writeUInt32BE(NET_SNMP_DISCOVERY_MSG_ID);
  const recordedRequestId: Buffer = Buffer.alloc(4);
  recordedRequestId.writeUInt32BE(NET_SNMP_DISCOVERY_REQUEST_ID);

  const msgId: Buffer = Buffer.alloc(4);
  msgId.writeUInt32BE(ids.msgId);
  const requestId: Buffer = Buffer.alloc(4);
  requestId.writeUInt32BE(ids.requestId);

  // Both IDs are 4-octet INTEGERs (02 04 ...) in the recording.
  const atMsgId: number = report.indexOf(
    Buffer.concat([Buffer.from([0x02, 0x04]), recordedMsgId]),
  );
  const atRequestId: number = report.indexOf(
    Buffer.concat([Buffer.from([0x02, 0x04]), recordedRequestId]),
  );

  if (atMsgId < 0 || atRequestId < 0) {
    throw new Error("The recording no longer holds its IDs where expected");
  }

  // Positive 31-bit IDs keep their 4-octet INTEGER form when their top bit is clear.
  if (ids.msgId > 0x7fffffff || ids.requestId > 0x7fffffff) {
    throw new Error("An ID the recording's encoding cannot hold");
  }

  msgId.copy(report, atMsgId + 2);
  requestId.copy(report, atRequestId + 2);

  return report;
}

describe("the request", () => {
  test("is the one Net-SNMP's own manager sends: no engine, no user, noAuthNoPriv, reportable, a GetRequest for nothing", () => {
    const ours: ParsedSnmpV3Message = parseV3Message(
      SnmpEngineDiscovery.buildRequest({
        msgId: NET_SNMP_DISCOVERY_MSG_ID,
        requestId: NET_SNMP_DISCOVERY_REQUEST_ID,
      }),
    );
    const netSnmps: ParsedSnmpV3Message = parseV3Message(
      Buffer.from(NET_SNMP_DISCOVERY_REQUEST, "hex"),
    );

    for (const message of [ours, netSnmps]) {
      expect(message.flags).toEqual({
        isAuthenticated: false,
        isEncrypted: false,
        isReportable: true,
      });
      expect(message.securityModel).toBe(3);
      expect(message.engineId).toEqual(Buffer.alloc(0));
      expect(message.userName).toEqual(Buffer.alloc(0));
      expect(message.engineBoots).toBe(0);
      expect(message.engineTime).toBe(0);
      expect(message.authParameters).toEqual(Buffer.alloc(0));
      expect(message.privParameters).toEqual(Buffer.alloc(0));
      expect(message.msgMaxSize).toBe(65507);

      const pdu: ScopedPdu = parseScopedPdu(message.scopedPdu!);
      expect(pdu.pduType).toBe(BerTag.GetRequestPdu);
      expect(pdu.contextEngineId).toEqual(Buffer.alloc(0));
      expect(pdu.contextName).toEqual(Buffer.alloc(0));
      expect(pdu.varbinds).toEqual([]);
      expect(pdu.errorStatus).toBe(0);
      expect(pdu.errorIndex).toBe(0);
    }

    // With the same IDs, the very bytes Net-SNMP sent.
    expect(
      SnmpEngineDiscovery.buildRequest({
        msgId: NET_SNMP_DISCOVERY_MSG_ID,
        requestId: NET_SNMP_DISCOVERY_REQUEST_ID,
      }).toString("hex"),
    ).toBe(NET_SNMP_DISCOVERY_REQUEST);
  });

  test("names no user, so an agent cannot count it as a failed login", () => {
    const request: Buffer = SnmpEngineDiscovery.buildRequest({
      msgId: 7,
      requestId: 9,
    });

    expect(parseV3Message(request).userName.length).toBe(0);
    expect(request.toString("latin1")).not.toMatch(/[a-z]{3,}/i);
  });
});

describe("the answer", () => {
  test("Net-SNMP's agent's Report says its engine ID", () => {
    expect(
      SnmpEngineDiscovery.readEngineId({
        datagram: Buffer.from(NET_SNMP_DISCOVERY_REPORT, "hex"),
        msgId: NET_SNMP_DISCOVERY_MSG_ID,
        requestId: NET_SNMP_DISCOVERY_REQUEST_ID,
      }),
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("net-snmp's agent's Report, which carries the msgID as its request-id, says its engine ID too", () => {
    // Recorded from net-snmp 3.26.1's agent, answering Net-SNMP's request.
    const netSnmpAgentReport: Buffer = Buffer.from(
      "3067020103301102046e2ebab6020300ffe3040104020103041c301a040c800000090300aabbcc11405102010002010a0400040004003031040c800000090300aabbcc1140510400a81f02046e2ebab60201000201003011300f060a2b060106030f01010400410101",
      "hex",
    );

    expect(
      SnmpEngineDiscovery.readEngineId({
        datagram: netSnmpAgentReport,
        msgId: NET_SNMP_DISCOVERY_MSG_ID,
        requestId: NET_SNMP_DISCOVERY_REQUEST_ID,
      }),
    ).toBe("800000090300AABBCC114051");
  });

  test("is only the answer to this request: another msgID or request-id is someone else's", () => {
    const report: Buffer = Buffer.from(NET_SNMP_DISCOVERY_REPORT, "hex");

    expect(
      SnmpEngineDiscovery.readEngineId({
        datagram: report,
        msgId: NET_SNMP_DISCOVERY_MSG_ID + 1,
        requestId: NET_SNMP_DISCOVERY_REQUEST_ID,
      }),
    ).toBeUndefined();
    expect(
      SnmpEngineDiscovery.readEngineId({
        datagram: report,
        msgId: NET_SNMP_DISCOVERY_MSG_ID,
        requestId: NET_SNMP_DISCOVERY_REQUEST_ID + 1,
      }),
    ).toBeUndefined();
  });

  test("what is no SNMPv3 Report is no answer: garbage, a v2c response, a request, nothing", () => {
    const v2cResponse: Buffer = Buffer.from(
      "302902010104067075626c6963a21c020449dd11d70201000201003010300e06082b060102010105000402737731",
      "hex",
    );

    for (const datagram of [
      Buffer.alloc(0),
      Buffer.from("not snmp"),
      Buffer.from([0x30, 0x03, 0x02, 0x01, 0x03]),
      v2cResponse,
      Buffer.from(NET_SNMP_DISCOVERY_REQUEST, "hex"),
      Buffer.from(NET_SNMP_DISCOVERY_REPORT, "hex").subarray(0, 40),
    ]) {
      expect(
        SnmpEngineDiscovery.readEngineId({
          datagram: datagram,
          msgId: NET_SNMP_DISCOVERY_MSG_ID,
          requestId: NET_SNMP_DISCOVERY_REQUEST_ID,
        }),
      ).toBeUndefined();
    }
  });
});

describe("discover, over a real socket", () => {
  test("net-snmp's agent answers with its engine ID", async () => {
    const lab: RecordedSnmpAgent = await agent({
      engineId: "800000090300AABBCC114051",
    });

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: lab.port,
        timeoutMs: 3000,
      }),
    ).toBe("800000090300AABBCC114051");

    // One datagram, and SNMPv3: nothing was asked over the community.
    expect(lab.requests).toHaveLength(1);
    expect(lab.requests[0]!.isSnmpV3).toBe(true);
  });

  test("an engine the agent made up for itself, as net-snmp does", async () => {
    const lab: RecordedSnmpAgent = await agent({});

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: lab.port,
        timeoutMs: 3000,
      }),
    ).toBe(lab.engineId);
  });

  test("Net-SNMP's agent's recorded answer, sent back over the wire, is read the same", async () => {
    const netSnmp: { port: number; received: Array<Buffer> } =
      await responder(netSnmpReportFor);

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: netSnmp.port,
        timeoutMs: 3000,
      }),
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
    expect(netSnmp.received).toHaveLength(1);
  });

  test("an agent with no SNMPv3 never answers: nothing, within the timeout", async () => {
    const v2cOnly: RecordedSnmpAgent = await agent({
      engineId: "800000090300AABBCC114052",
      answersSnmpV3: false,
    });

    const startedAt: number = Date.now();

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: v2cOnly.port,
        timeoutMs: 300,
      }),
    ).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(v2cOnly.requests).toHaveLength(1);
  });

  test("what else arrives first is passed over: it waits for the agent's own answer", async () => {
    const noisy: dgram.Socket = dgram.createSocket("udp4");
    sockets.push(noisy);

    noisy.on("message", (request: Buffer, rinfo: dgram.RemoteInfo): void => {
      const stale: Buffer = Buffer.from(NET_SNMP_DISCOVERY_REPORT, "hex");

      // Noise, an answer to someone else's request, then the answer.
      noisy.send(Buffer.from("noise"), rinfo.port, rinfo.address, () => {
        noisy.send(stale, rinfo.port, rinfo.address, () => {
          noisy.send(netSnmpReportFor(request), rinfo.port, rinfo.address);
        });
      });
    });

    await new Promise<void>((resolve: () => void) => {
      noisy.bind(0, "127.0.0.1", resolve);
    });

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: noisy.address().port,
        timeoutMs: 3000,
      }),
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("an answer that is someone else's alone is no answer", async () => {
    const stale: { port: number; received: Array<Buffer> } = await responder(
      (): Buffer => {
        return Buffer.from(NET_SNMP_DISCOVERY_REPORT, "hex");
      },
    );

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: stale.port,
        timeoutMs: 300,
      }),
    ).toBeUndefined();
    expect(stale.received).toHaveLength(1);
  });

  test("a port nothing listens on, a name that does not resolve, and no host at all: nothing, never a throw", async () => {
    const closed: dgram.Socket = dgram.createSocket("udp4");
    const closedPort: number = await new Promise(
      (resolve: (port: number) => void) => {
        closed.bind(0, "127.0.0.1", () => {
          const port: number = closed.address().port;
          closed.close(() => {
            resolve(port);
          });
        });
      },
    );

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: closedPort,
        timeoutMs: 300,
      }),
    ).toBeUndefined();
    expect(
      await SnmpEngineDiscovery.discover({
        host: "no-such-agent.invalid",
        port: 161,
        timeoutMs: 300,
      }),
    ).toBeUndefined();
    expect(
      await SnmpEngineDiscovery.discover({ host: "", port: 161 }),
    ).toBeUndefined();
    expect(
      await SnmpEngineDiscovery.discover({ host: "127.0.0.1", port: 0 }),
    ).toBeUndefined();
  });

  test("an IPv6 agent is asked over IPv6", async () => {
    const v6: dgram.Socket = dgram.createSocket("udp6");
    sockets.push(v6);

    const isBound: boolean = await new Promise(
      (resolve: (bound: boolean) => void) => {
        v6.once("error", () => {
          resolve(false);
        });
        v6.bind(0, "::1", () => {
          resolve(true);
        });
      },
    );

    if (!isBound) {
      // No IPv6 loopback on this host: nothing to ask over.
      return;
    }

    v6.on("message", (request: Buffer, rinfo: dgram.RemoteInfo): void => {
      v6.send(netSnmpReportFor(request), rinfo.port, rinfo.address);
    });

    expect(
      await SnmpEngineDiscovery.discover({
        host: "::1",
        port: v6.address().port,
        timeoutMs: 3000,
      }),
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("the agent answers net-snmp's own discovery with the same engine", async () => {
    const lab: RecordedSnmpAgent = await agent({
      engineId: "800000090300AABBCC114053",
      users: [
        {
          name: "lab",
          level: snmp.SecurityLevel.authNoPriv,
          authProtocol: snmp.AuthProtocols.sha,
          authKey: "lab-auth-passphrase",
        },
      ],
    });

    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: lab.port,
        timeoutMs: 3000,
      }),
    ).toBe(lab.engineId);
  });
});

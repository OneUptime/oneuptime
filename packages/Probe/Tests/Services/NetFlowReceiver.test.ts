// Set required env vars before importing NetFlowReceiver (which imports Config.ts)
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE"] = "100";
// ProbeAPIRequest stamps every forward with the probe's identity.
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import NetFlowReceiver, {
  FlowExporterStatistics,
} from "../../Services/NetFlowReceiver";
import FlowAggregator from "../../Utils/NetFlow/FlowAggregator";
import {
  PROBE_INGEST_URL,
  PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE,
} from "../../Config";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The collector between the flow decoders and the ingest endpoint.
 *
 * The decoders have their own tests; what those cannot show is what the
 * collector does with what they return: which datagrams it accepts at all,
 * that the same conversation arriving twice is forwarded once (summed), that
 * the rate limit counts datagrams rather than flow records and never spends a
 * slot on a datagram with no flows in it (templates only), that a buffer
 * nobody is draining sheds its OLDEST conversations rather than growing
 * without bound, and that a failed forward drops its batch instead of
 * re-queueing it - flow export is UDP and lossy by design, so re-queueing
 * while the server is unreachable is how a probe runs itself out of memory.
 *
 * One of these is a regression test with a name: the flush builds its URL from
 * a fresh copy of PROBE_INGEST_URL because Route.addRoute mutates in place, so
 * calling it on the shared global would permanently append
 * "/probe/network-flow" to the base URL every other probe request uses. The
 * second flush below is what would catch that.
 */

const EXPORTER_IP: string = "10.0.0.1";
const HEADER_LENGTH_BYTES: number = 24;
const RECORD_LENGTH_BYTES: number = 48;
const SYS_UPTIME_MS: number = 3600000;

/*
 * The collector's own statics, reached past `private`. They are process-wide,
 * so each test resets them.
 */
type ReceiverInternals = {
  handleDatagram: (
    datagram: Buffer,
    source: string | { address: string; port: number },
  ) => void;
  flush: () => Promise<void>;
  aggregator: FlowAggregator;
  isFlushing: boolean;
  acceptedThisMinute: number;
  droppedThisMinute: number;
  minuteWindowStartedAt: number;
  exporterStatistics: Map<string, FlowExporterStatistics>;
};

const receiver: ReceiverInternals =
  NetFlowReceiver as unknown as ReceiverInternals;

type V5RecordFields = {
  srcAddr: [number, number, number, number];
  dstAddr: [number, number, number, number];
  srcPort: number;
  dstPort: number;
  prot: number;
  dPkts: number;
  dOctets: number;
};

function buildV5Datagram(
  records: Array<V5RecordFields>,
  options?: { version?: number },
): Buffer {
  const buffer: Buffer = Buffer.alloc(
    HEADER_LENGTH_BYTES + records.length * RECORD_LENGTH_BYTES,
  );

  buffer.writeUInt16BE(options?.version ?? 5, 0);
  buffer.writeUInt16BE(records.length, 2);
  buffer.writeUInt32BE(SYS_UPTIME_MS, 4);
  buffer.writeUInt32BE(1750000000, 8);
  buffer.writeUInt32BE(0, 12);
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt8(1, 20);
  buffer.writeUInt8(7, 21);
  buffer.writeUInt16BE(0, 22);

  records.forEach((fields: V5RecordFields, index: number) => {
    const offset: number = HEADER_LENGTH_BYTES + index * RECORD_LENGTH_BYTES;
    for (let byte: number = 0; byte < 4; byte++) {
      buffer.writeUInt8(fields.srcAddr[byte] as number, offset + byte);
      buffer.writeUInt8(fields.dstAddr[byte] as number, offset + 4 + byte);
    }
    buffer.writeUInt16BE(2, offset + 12); // input interface
    buffer.writeUInt16BE(3, offset + 14); // output interface
    buffer.writeUInt32BE(fields.dPkts, offset + 16);
    buffer.writeUInt32BE(fields.dOctets, offset + 20);
    buffer.writeUInt32BE(SYS_UPTIME_MS - 60000, offset + 24);
    buffer.writeUInt32BE(SYS_UPTIME_MS - 1000, offset + 28);
    buffer.writeUInt16BE(fields.srcPort, offset + 32);
    buffer.writeUInt16BE(fields.dstPort, offset + 34);
    buffer.writeUInt8(fields.prot, offset + 38);
  });

  return buffer;
}

function oneFlow(
  overrides: Partial<V5RecordFields> = {},
): Array<V5RecordFields> {
  return [
    {
      srcAddr: [10, 0, 0, 5],
      dstAddr: [192, 168, 1, 20],
      srcPort: 54321,
      dstPort: 443,
      prot: 6,
      dPkts: 100,
      dOctets: 123456,
      ...overrides,
    },
  ];
}

// A minimal sFlow v5 datagram: one flow sample with an IPv4 summary record.
function buildSFlowDatagram(agent: [number, number, number, number]): Buffer {
  const record: Buffer = Buffer.alloc(8 + 32);
  record.writeUInt32BE(3, 0); // sampled_ipv4
  record.writeUInt32BE(32, 4);
  record.writeUInt32BE(1500, 8); // length
  record.writeUInt32BE(6, 12); // protocol
  Buffer.from([10, 0, 0, 7]).copy(record, 16);
  Buffer.from([10, 0, 0, 8]).copy(record, 20);
  record.writeUInt32BE(40000, 24);
  record.writeUInt32BE(443, 28);
  record.writeUInt32BE(0x18, 32);
  record.writeUInt32BE(0, 36);

  const sample: Buffer = Buffer.alloc(8 + 32);
  sample.writeUInt32BE(1, 0); // flow sample
  sample.writeUInt32BE(32 + record.length, 4);
  sample.writeUInt32BE(1, 8); // sequence
  sample.writeUInt32BE(3, 12); // source id
  sample.writeUInt32BE(1000, 16); // sampling rate
  sample.writeUInt32BE(1000, 20); // pool
  sample.writeUInt32BE(0, 24); // drops
  sample.writeUInt32BE(7, 28); // input
  sample.writeUInt32BE(9, 32); // output
  sample.writeUInt32BE(1, 36); // records

  const header: Buffer = Buffer.alloc(28);
  header.writeUInt32BE(5, 0);
  header.writeUInt32BE(1, 4);
  Buffer.from(agent).copy(header, 8);
  header.writeUInt32BE(0, 12);
  header.writeUInt32BE(1, 16);
  header.writeUInt32BE(1000, 20);
  header.writeUInt32BE(1, 24);

  return Buffer.concat([header, sample, record]);
}

function buffered(): Array<NetworkFlowRecord> {
  // Peek without draining: drain a copy-preserving list and put it back.
  const records: Array<NetworkFlowRecord> = receiver.aggregator.drain(1e9);
  for (const record of records) {
    receiver.aggregator.add(record);
  }
  return records;
}

function resetReceiver(): void {
  receiver.aggregator = new FlowAggregator(15000);
  receiver.isFlushing = false;
  receiver.acceptedThisMinute = 0;
  receiver.droppedThisMinute = 0;
  receiver.minuteWindowStartedAt = Date.now();
  receiver.exporterStatistics = new Map();
}

beforeEach(() => {
  resetReceiver();
});

afterEach(() => {
  jest.restoreAllMocks();
  resetReceiver();
});

describe("NetFlowReceiver listening ports", () => {
  test("listens on the NetFlow, IPFIX and sFlow ports by default", () => {
    expect(NetFlowReceiver.getListeningPorts()).toEqual([2055, 4739, 6343]);
  });
});

describe("NetFlowReceiver datagram handling", () => {
  test("buffers a v5 datagram's records as estimated, normalized flows of the exporter", () => {
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    const records: Array<NetworkFlowRecord> = buffered();
    expect(records).toHaveLength(1);
    const record: NetworkFlowRecord = records[0]!;
    expect(record.exporterIpAddress).toBe(EXPORTER_IP);
    expect(record.sourceIpAddress).toBe("10.0.0.5");
    expect(record.destinationIpAddress).toBe("192.168.1.20");
    // The client's ephemeral port is folded away; the service port stays.
    expect(record.sourcePort).toBe(0);
    expect(record.destinationPort).toBe(443);
    expect(record.protocolNumber).toBe(6);
    expect(record.packets).toBe(100);
    expect(record.octets).toBe(123456);
    expect(record.inputInterfaceIndex).toBe(2);
    expect(record.outputInterfaceIndex).toBe(3);
    expect(record.flowFormat).toBe(NetworkFlowFormat.NetFlowV5);
    expect(record.samplingRate).toBe(1);
    expect(record.flowCount).toBe(1);
    expect(record.flowStartAt).toBeInstanceOf(Date);
    expect(record.flowEndAt).toBeInstanceOf(Date);
  });

  test("every conversation in a multi-record datagram is kept", () => {
    receiver.handleDatagram(
      buildV5Datagram([
        ...oneFlow(),
        ...oneFlow({ srcPort: 1111, dstPort: 80 }),
        ...oneFlow({ srcPort: 2222, dstPort: 53, prot: 17 }),
      ]),
      EXPORTER_IP,
    );

    expect(
      buffered().map((record: NetworkFlowRecord) => {
        return record.destinationPort;
      }),
    ).toEqual([443, 80, 53]);
  });

  test("the same conversation in two datagrams is forwarded once, summed", () => {
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    // Another connection from the same client to the same service.
    receiver.handleDatagram(
      buildV5Datagram(oneFlow({ srcPort: 60001, dPkts: 4, dOctets: 400 })),
      EXPORTER_IP,
    );

    const records: Array<NetworkFlowRecord> = buffered();
    expect(records).toHaveLength(1);
    expect(records[0]!.packets).toBe(104);
    expect(records[0]!.octets).toBe(123856);
    expect(records[0]!.flowCount).toBe(2);
  });

  test("a datagram too short to hold a version is skipped, and counted as unreadable", () => {
    receiver.handleDatagram(Buffer.alloc(0), EXPORTER_IP);
    receiver.handleDatagram(Buffer.alloc(1), EXPORTER_IP);

    expect(receiver.aggregator.size).toBe(0);
    // A skipped datagram must not spend a rate-limit slot either.
    expect(receiver.acceptedThisMinute).toBe(0);
    expect(
      receiver.exporterStatistics.get(EXPORTER_IP)!.malformedDatagrams,
    ).toBe(2);
  });

  test("an unsupported NetFlow version is skipped without spending a slot, and named", () => {
    for (const version of [1, 7, 8]) {
      receiver.handleDatagram(
        buildV5Datagram(oneFlow(), { version: version }),
        EXPORTER_IP,
      );
    }

    expect(receiver.aggregator.size).toBe(0);
    expect(receiver.acceptedThisMinute).toBe(0);

    const statistics: FlowExporterStatistics =
      receiver.exporterStatistics.get(EXPORTER_IP)!;
    expect(statistics.unsupportedDatagrams).toBe(3);
    expect(statistics.unsupportedFormat).toBe("NetFlow v8");
  });

  test("a v5 datagram whose body is truncated is skipped", () => {
    const truncated: Buffer = buildV5Datagram(oneFlow()).subarray(
      0,
      HEADER_LENGTH_BYTES + 10,
    );

    receiver.handleDatagram(truncated, EXPORTER_IP);

    expect(receiver.aggregator.size).toBe(0);
    expect(receiver.acceptedThisMinute).toBe(0);
  });

  test("records from different exporters keep their own exporter address", () => {
    receiver.handleDatagram(buildV5Datagram(oneFlow()), "10.0.0.1");
    receiver.handleDatagram(buildV5Datagram(oneFlow()), {
      address: "10.0.0.2",
      port: 9995,
    });

    expect(
      buffered().map((record: NetworkFlowRecord) => {
        return record.exporterIpAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  test("an sFlow datagram is the agent's, scaled by its sampling rate", () => {
    // Sent from a NAT address; the agent names the switch behind it.
    receiver.handleDatagram(buildSFlowDatagram([172, 16, 0, 2]), {
      address: "203.0.113.50",
      port: 40000,
    });

    const records: Array<NetworkFlowRecord> = buffered();
    expect(records).toHaveLength(1);
    expect(records[0]!.exporterIpAddress).toBe("172.16.0.2");
    expect(records[0]!.flowFormat).toBe(NetworkFlowFormat.SFlow);
    expect(records[0]!.samplingRate).toBe(1000);
    expect(records[0]!.packets).toBe(1000);
    expect(records[0]!.octets).toBe(1500 * 1000);
    expect(records[0]!.inputInterfaceIndex).toBe(7);
    expect(records[0]!.outputInterfaceIndex).toBe(9);
    expect(receiver.exporterStatistics.has("172.16.0.2")).toBe(true);
    expect(receiver.exporterStatistics.has("203.0.113.50")).toBe(false);
  });

  test("statistics count what each exporter sent", () => {
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    receiver.handleDatagram(
      buildV5Datagram([...oneFlow(), ...oneFlow({ dstPort: 22 })]),
      EXPORTER_IP,
    );

    const statistics: FlowExporterStatistics | undefined =
      NetFlowReceiver.getExporterStatisticsSnapshot().find(
        (entry: FlowExporterStatistics) => {
          return entry.exporterAddress === EXPORTER_IP;
        },
      );

    expect(statistics).toBeDefined();
    expect(statistics!.datagrams).toBe(2);
    expect(statistics!.flows).toBe(3);
    expect(statistics!.format).toBe(NetworkFlowFormat.NetFlowV5);
    expect(statistics!.lastSeenAt).toBeGreaterThan(0);
  });
});

describe("NetFlowReceiver rate limiting", () => {
  // Read back rather than restated, so the two cannot drift apart.
  const LIMIT: number = PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE;

  test("counts datagrams, not flow records", () => {
    // Ten records in one datagram spend one slot, not ten.
    receiver.handleDatagram(
      buildV5Datagram(
        Array.from({ length: 10 }, (_unused: unknown, index: number) => {
          return oneFlow({ dstPort: 1000 + index })[0] as V5RecordFields;
        }),
      ),
      EXPORTER_IP,
    );

    expect(receiver.aggregator.size).toBe(10);
    expect(receiver.acceptedThisMinute).toBe(1);
  });

  test("drops datagrams past the limit, keeps everything up to it, and counts the drops", () => {
    jest.spyOn(receiver, "flush").mockResolvedValue(undefined);

    for (let index: number = 0; index < LIMIT; index++) {
      receiver.handleDatagram(
        buildV5Datagram(oneFlow({ dstPort: 1000 + index })),
        EXPORTER_IP,
      );
    }

    expect(receiver.acceptedThisMinute).toBe(LIMIT);
    expect(receiver.aggregator.size).toBe(LIMIT);

    // One more is over the limit.
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.aggregator.size).toBe(LIMIT);
    expect(receiver.droppedThisMinute).toBe(1);
    expect(receiver.acceptedThisMinute).toBe(LIMIT);
    expect(
      receiver.exporterStatistics.get(EXPORTER_IP)!.droppedDatagrams,
    ).toBe(1);
  });

  test("the window rolls over after a minute and accepting resumes", () => {
    receiver.acceptedThisMinute = LIMIT;
    receiver.droppedThisMinute = 5;
    receiver.minuteWindowStartedAt = Date.now() - 60001;

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.aggregator.size).toBe(1);
    expect(receiver.acceptedThisMinute).toBe(1);
    expect(receiver.droppedThisMinute).toBe(0);
  });

  test("a datagram that carries no flows (a malformed one) spends no slot", () => {
    receiver.handleDatagram(Buffer.from([0, 9, 0, 0]), EXPORTER_IP);

    expect(receiver.acceptedThisMinute).toBe(0);
  });
});

describe("NetFlowReceiver buffer bound", () => {
  test("sheds the OLDEST conversations once the cap is passed", () => {
    receiver.aggregator = new FlowAggregator(3);

    for (const port of [1001, 1002, 1003, 1004]) {
      receiver.handleDatagram(
        buildV5Datagram(oneFlow({ dstPort: port })),
        EXPORTER_IP,
      );
    }

    expect(
      buffered().map((record: NetworkFlowRecord) => {
        return record.destinationPort;
      }),
    ).toEqual([1002, 1003, 1004]);
  });

  test("a buffer under the cap is left alone", () => {
    receiver.aggregator = new FlowAggregator(3);

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    receiver.handleDatagram(
      buildV5Datagram(oneFlow({ dstPort: 22 })),
      EXPORTER_IP,
    );

    expect(receiver.aggregator.size).toBe(2);
  });
});

describe("NetFlowReceiver flush", () => {
  function mockFetch(): jest.SpyInstance {
    return jest.spyOn(API, "fetch").mockResolvedValue({} as never);
  }

  test("posts the buffered records to the ingest route and empties the buffer", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    await receiver.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = fetchSpy.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(String(call["url"])).toContain("/probe/network-flow");
    const data: Record<string, unknown> = call["data"] as Record<
      string,
      unknown
    >;
    const sent: Array<Record<string, unknown>> = data["flowRecords"] as Array<
      Record<string, unknown>
    >;
    expect(sent).toHaveLength(1);
    // The server learns the format, the rate and how many records it sums.
    expect(sent[0]!["flowFormat"]).toBe(NetworkFlowFormat.NetFlowV5);
    expect(sent[0]!["samplingRate"]).toBe(1);
    expect(sent[0]!["flowCount"]).toBe(1);
    expect(receiver.aggregator.size).toBe(0);
  });

  test("the shared ingest URL is not mutated by building the route", async () => {
    const before: string = PROBE_INGEST_URL.toString();
    mockFetch();

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    await receiver.flush();
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    await receiver.flush();

    /*
     * Route.addRoute mutates in place. Called on the shared global, the second
     * flush would post to ".../probe/network-flow/probe/network-flow" and
     * every other probe request would be misrouted from then on.
     */
    expect(PROBE_INGEST_URL.toString()).toBe(before);
  });

  test("a failed forward drops its batch rather than re-queueing it", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockRejectedValue(new Error("ingest unreachable") as never);
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    await expect(receiver.flush()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Dropped, not re-buffered: a re-queue would grow without bound.
    expect(receiver.aggregator.size).toBe(0);
    // And the receiver is not left wedged.
    expect(receiver.isFlushing).toBe(false);
  });

  test("an empty buffer does not call the ingest endpoint at all", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();

    await receiver.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a flush already in progress is not started again", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    receiver.isFlushing = true;

    await receiver.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(receiver.aggregator.size).toBe(1);
  });

  test("a buffer larger than one batch is posted in several capped batches", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();

    // FLUSH_RECORD_BATCH_SIZE is 1500; 1501 conversations must take two POSTs.
    for (let index: number = 0; index < 1501; index++) {
      receiver.aggregator.add({
        exporterIpAddress: EXPORTER_IP,
        sourceIpAddress: "10.0.0.5",
        destinationIpAddress: "10.0.0.6",
        sourcePort: 0,
        destinationPort: index + 1,
        protocolNumber: 17,
        octets: 100,
        packets: 1,
        flowStartAt: new Date(),
        flowEndAt: new Date(),
      });
    }

    await receiver.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const batchSizes: Array<number> = fetchSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return (
          (call[0] as Record<string, unknown>)["data"] as Record<
            string,
            Array<unknown>
          >
        )["flowRecords"]!.length;
      },
    );
    expect(batchSizes).toEqual([1500, 1]);
    expect(receiver.aggregator.size).toBe(0);
  });

  test("the forward carries the probe's own credentials", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    await receiver.flush();

    const data: Record<string, unknown> = (
      fetchSpy.mock.calls[0]?.[0] as Record<string, unknown>
    )["data"] as Record<string, unknown>;
    expect(data["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(data["probeKey"]).toBeDefined();
    expect(data["probeCapabilities"]).toBeDefined();
    expect(data["flowRecords"]).toHaveLength(1);
  });

  test("conversations past the batch size are flushed without waiting for the timer", () => {
    const flushSpy: jest.SpyInstance = jest
      .spyOn(receiver, "flush")
      .mockResolvedValue(undefined);

    // 50 datagrams of 30 distinct conversations: 1500 waiting.
    for (let datagram: number = 0; datagram < 50; datagram++) {
      receiver.handleDatagram(
        buildV5Datagram(
          Array.from({ length: 30 }, (_unused: unknown, index: number) => {
            return oneFlow({ dstPort: datagram * 30 + index + 1 })[0]!;
          }),
        ),
        EXPORTER_IP,
      );
    }

    expect(flushSpy).toHaveBeenCalled();
  });
});

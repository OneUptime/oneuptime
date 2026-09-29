// Set required env vars before importing NetFlowReceiver (which imports Config.ts)
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE"] = "100";
// ProbeAPIRequest stamps every forward with the probe's identity.
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import NetFlowReceiver from "../../Services/NetFlowReceiver";
import {
  PROBE_INGEST_URL,
  PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE,
} from "../../Config";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The receiver between the NetFlow parsers and the ingest endpoint.
 *
 * The two parsers have their own tests, and what those cannot show is what the
 * receiver does with what they return: which datagrams it accepts at all, that
 * the rate limit counts datagrams rather than flow records, that a buffer
 * nobody is draining sheds its OLDEST records rather than growing without
 * bound, and that a failed forward drops its batch instead of re-queueing it
 * -- NetFlow is UDP and lossy by design, so re-queueing while the server is
 * unreachable is how a probe runs itself out of memory.
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
 * The receiver's own statics, reached past `private`. They are process-wide,
 * so each test resets them; the v9 parser's template cache is deliberately
 * left alone (it is not what is under test here).
 */
type ReceiverInternals = {
  handleDatagram: (datagram: Buffer, exporterIpAddress: string) => void;
  flush: () => Promise<void>;
  buffer: Array<NetworkFlowRecord>;
  bufferedDatagramCount: number;
  isFlushing: boolean;
  acceptedThisMinute: number;
  droppedThisMinute: number;
  minuteWindowStartedAt: number;
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

function resetReceiver(): void {
  receiver.buffer = [];
  receiver.bufferedDatagramCount = 0;
  receiver.isFlushing = false;
  receiver.acceptedThisMinute = 0;
  receiver.droppedThisMinute = 0;
  receiver.minuteWindowStartedAt = Date.now();
}

beforeEach(() => {
  resetReceiver();
});

afterEach(() => {
  jest.restoreAllMocks();
  resetReceiver();
});

describe("NetFlowReceiver datagram handling", () => {
  test("buffers a v5 datagram's records, tagged with the exporter", () => {
    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(1);
    const record: NetworkFlowRecord = receiver.buffer[0] as NetworkFlowRecord;
    expect(record.exporterIpAddress).toBe(EXPORTER_IP);
    expect(record.sourceIpAddress).toBe("10.0.0.5");
    expect(record.destinationIpAddress).toBe("192.168.1.20");
    expect(record.sourcePort).toBe(54321);
    expect(record.destinationPort).toBe(443);
    expect(record.protocolNumber).toBe(6);
    expect(record.packets).toBe(100);
    expect(record.octets).toBe(123456);
    expect(record.flowStartAt).toBeInstanceOf(Date);
    expect(record.flowEndAt).toBeInstanceOf(Date);
    expect(receiver.bufferedDatagramCount).toBe(1);
  });

  test("every record in a multi-record datagram is kept", () => {
    receiver.handleDatagram(
      buildV5Datagram([
        ...oneFlow(),
        ...oneFlow({ srcPort: 1111, dstPort: 80 }),
        ...oneFlow({ srcPort: 2222, dstPort: 53, prot: 17 }),
      ]),
      EXPORTER_IP,
    );

    expect(receiver.buffer).toHaveLength(3);
    expect(
      receiver.buffer.map((record: NetworkFlowRecord) => {
        return record.destinationPort;
      }),
    ).toEqual([443, 80, 53]);
    // Three records, but one datagram.
    expect(receiver.bufferedDatagramCount).toBe(1);
  });

  test("a datagram too short to hold a version is skipped", () => {
    receiver.handleDatagram(Buffer.alloc(0), EXPORTER_IP);
    receiver.handleDatagram(Buffer.alloc(1), EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.bufferedDatagramCount).toBe(0);
    // A skipped datagram must not spend a rate-limit slot either.
    expect(receiver.acceptedThisMinute).toBe(0);
  });

  test("an unsupported NetFlow version is skipped without spending a slot", () => {
    for (const version of [1, 7, 8, 10]) {
      receiver.handleDatagram(
        buildV5Datagram(oneFlow(), { version: version }),
        EXPORTER_IP,
      );
    }

    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.acceptedThisMinute).toBe(0);
  });

  test("a v5 datagram whose body is truncated is skipped", () => {
    const truncated: Buffer = buildV5Datagram(oneFlow()).subarray(
      0,
      HEADER_LENGTH_BYTES + 10,
    );

    receiver.handleDatagram(truncated, EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.acceptedThisMinute).toBe(0);
  });

  test("records from different exporters keep their own exporter address", () => {
    receiver.handleDatagram(buildV5Datagram(oneFlow()), "10.0.0.1");
    receiver.handleDatagram(buildV5Datagram(oneFlow()), "10.0.0.2");

    expect(
      receiver.buffer.map((record: NetworkFlowRecord) => {
        return record.exporterIpAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
  });
});

describe("NetFlowReceiver rate limiting", () => {
  // Read back rather than restated, so the two cannot drift apart.
  const LIMIT: number = PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE;

  test("counts datagrams, not flow records", () => {
    // Ten records in one datagram spends one slot, not ten.
    receiver.handleDatagram(
      buildV5Datagram(
        Array.from({ length: 10 }, () => {
          return oneFlow()[0] as V5RecordFields;
        }),
      ),
      EXPORTER_IP,
    );

    expect(receiver.buffer).toHaveLength(10);
    expect(receiver.acceptedThisMinute).toBe(1);
  });

  test("drops datagrams past the limit, and keeps everything up to it", () => {
    /*
     * A hundred datagrams crosses FLUSH_DATAGRAM_BATCH_SIZE twice, and the
     * auto-flush would drain the buffer out from under the assertion. The
     * flush has its own tests below.
     */
    jest.spyOn(receiver, "flush").mockResolvedValue(undefined);

    for (let index: number = 0; index < LIMIT; index++) {
      receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);
    }

    expect(receiver.acceptedThisMinute).toBe(LIMIT);
    expect(receiver.buffer).toHaveLength(LIMIT);

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(LIMIT);
    expect(receiver.droppedThisMinute).toBe(1);
    expect(receiver.acceptedThisMinute).toBe(LIMIT);
  });

  test("the window rolls over after a minute and accepting resumes", () => {
    receiver.acceptedThisMinute = LIMIT;
    receiver.droppedThisMinute = 5;
    receiver.minuteWindowStartedAt = Date.now() - 60001;

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(1);
    expect(receiver.acceptedThisMinute).toBe(1);
    expect(receiver.droppedThisMinute).toBe(0);
  });
});

describe("NetFlowReceiver buffer bound", () => {
  // FLUSH_DATAGRAM_BATCH_SIZE (50) * 30 * 10.
  const MAX_BUFFERED_RECORDS: number = 15000;

  test("sheds the OLDEST records once the cap is passed", () => {
    // Fill past the cap directly: the shed happens on the next datagram.
    receiver.buffer = Array.from(
      { length: MAX_BUFFERED_RECORDS },
      (_unused: unknown, index: number) => {
        return { sourcePort: index } as unknown as NetworkFlowRecord;
      },
    );

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(MAX_BUFFERED_RECORDS);
    // The very first record is gone; the newest one is at the end.
    expect(
      (receiver.buffer[0] as unknown as { sourcePort: number }).sourcePort,
    ).toBe(1);
    expect(
      (receiver.buffer[MAX_BUFFERED_RECORDS - 1] as NetworkFlowRecord)
        .exporterIpAddress,
    ).toBe(EXPORTER_IP);
  });

  test("a buffer under the cap is left alone", () => {
    receiver.buffer = Array.from({ length: 10 }, () => {
      return {} as NetworkFlowRecord;
    });

    receiver.handleDatagram(buildV5Datagram(oneFlow()), EXPORTER_IP);

    expect(receiver.buffer).toHaveLength(11);
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
    expect(data["flowRecords"]).toHaveLength(1);
    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.bufferedDatagramCount).toBe(0);
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
    expect(receiver.buffer).toHaveLength(0);
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
    expect(receiver.buffer).toHaveLength(1);
  });

  test("a buffer larger than one batch is posted in several capped batches", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();
    // FLUSH_RECORD_BATCH_SIZE is 1500; 1501 records must take two POSTs.
    receiver.buffer = Array.from({ length: 1501 }, () => {
      return {} as NetworkFlowRecord;
    });

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
    expect(receiver.buffer).toHaveLength(0);
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
});

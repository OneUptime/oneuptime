import net from "net";
import zlib from "zlib";
import KafkaClient, {
  KafkaAuthenticationError,
  KafkaConnectionError,
} from "../../../../Server/Utils/CloudConnection/Kafka/KafkaClient";
import {
  KafkaProtocolError,
  KafkaReader,
  KafkaRecord,
  KafkaWriter,
  crc32c,
  decodeRecordSet,
  frameRequest,
  oauthBearerInitialResponse,
} from "../../../../Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import {
  FakeEventHubsBroker,
  encodeBatch,
  encodeMessageV0V1,
  slowCrc32c,
} from "./Helpers/FakeEventHubs";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The few Kafka messages a partition reader needs, checked two ways: the
 * codec against byte layouts written by hand from the protocol guide (the
 * fake's own encoder, its own bit-by-bit CRC-32C), and the client against a
 * fake Event Hubs namespace on a real socket - the sign-in, the event
 * hub's partitions, offsets and record batches, and every way a broker can
 * fail a reader: a refused token, an answer that never comes, a frame past
 * what is taken, a connection that drops.
 */

describe("the primitives", () => {
  test("64-bit integers go both ways, negatives too, and past 2^53 are refused", () => {
    for (const value of [0, 1, -1, -2, 4294967295, 4294967296, 1793959141000, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      const bytes: Buffer = new KafkaWriter().int64(value).toBuffer();

      expect(bytes).toHaveLength(8);
      expect(new KafkaReader(bytes).int64()).toBe(value);
    }

    const tooLarge: Buffer = Buffer.from([0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => {
      return new KafkaReader(tooLarge).int64();
    }).toThrow(KafkaProtocolError);
    expect(() => {
      return new KafkaWriter().int64(2 ** 60);
    }).toThrow(KafkaProtocolError);
    // -1 is all ones, as Kafka writes "no value".
    expect(new KafkaWriter().int64(-1).toBuffer()).toEqual(Buffer.alloc(8, 0xff));
  });

  test("varints read zigzag, as the record format writes them", () => {
    const cases: Array<[Array<number>, number]> = [
      [[0x00], 0],
      [[0x01], -1],
      [[0x02], 1],
      [[0x03], -2],
      [[0x7f], -64],
      [[0x80, 0x01], 64],
      [[0xac, 0x02], 150],
      [[0xfe, 0xff, 0xff, 0xff, 0x0f], 2147483647],
    ];

    for (const [bytes, value] of cases) {
      expect(new KafkaReader(Buffer.from(bytes)).varint()).toBe(value);
    }

    expect(() => {
      return new KafkaReader(Buffer.alloc(11, 0x80)).varint();
    }).toThrow(KafkaProtocolError);
  });

  test("CRC-32C is Castagnoli's: the check value of 123456789, and the slow way's for anything", () => {
    expect(crc32c(Buffer.from("123456789"))).toBe(0xe3069283);
    expect(slowCrc32c(Buffer.from("123456789"))).toBe(0xe3069283);

    const data: Buffer = Buffer.from(Array.from({ length: 4096 }, (_v: unknown, index: number) => {
      return (index * 31) % 256;
    }));
    expect(crc32c(data)).toBe(slowCrc32c(data));
  });

  test("a read past the end of a message is refused, never read from beyond it", () => {
    expect(() => {
      return new KafkaReader(Buffer.from([0, 5, 65])).string();
    }).toThrow(KafkaProtocolError);
    expect(() => {
      return new KafkaReader(Buffer.from([0, 0, 0, 9, 1])).bytes();
    }).toThrow(KafkaProtocolError);
    expect(() => {
      return new KafkaReader(Buffer.from([0x7f, 0xff, 0xff, 0xff])).array(() => {
        return 0;
      });
    }).toThrow(KafkaProtocolError);
  });

  test("a request is framed as its size, a v1 header and its body", () => {
    const frame: Buffer = frameRequest({
      apiKey: 3,
      apiVersion: 1,
      correlationId: 7,
      clientId: "oneuptime",
      body: Buffer.from([1, 2]),
    });

    expect(frame.readInt32BE(0)).toBe(frame.length - 4);
    expect(frame.readInt16BE(4)).toBe(3);
    expect(frame.readInt16BE(6)).toBe(1);
    expect(frame.readInt32BE(8)).toBe(7);
    expect(frame.readInt16BE(12)).toBe(9);
    expect(frame.toString("utf8", 14, 23)).toBe("oneuptime");
    expect(Array.from(frame.subarray(23))).toEqual([1, 2]);
  });

  test("OAUTHBEARER's message is RFC 7628's: a GS2 header and the bearer field", () => {
    expect(oauthBearerInitialResponse("abc").toString("utf8")).toBe(
      "n,,\u0001auth=Bearer abc\u0001\u0001",
    );
  });
});

describe("record sets", () => {
  const events: Array<{ value: Buffer; timestampMs: number }> = [
    { value: Buffer.from('{"records":[1]}'), timestampMs: 1793959141000 },
    { value: Buffer.from('{"records":[2]}'), timestampMs: 1793959142500 },
    { value: Buffer.from('{"records":[3]}'), timestampMs: 1793959143000 },
  ];

  test("a v2 batch's records come with their offsets, times and values", () => {
    const read: ReturnType<typeof decodeRecordSet> = decodeRecordSet(
      encodeBatch({ baseOffset: 40, events }),
    );

    expect(
      read.records.map((record: KafkaRecord) => {
        return [record.offset, record.timestampMs, record.value?.toString("utf8")];
      }),
    ).toEqual([
      [40, 1793959141000, '{"records":[1]}'],
      [41, 1793959142500, '{"records":[2]}'],
      [42, 1793959143000, '{"records":[3]}'],
    ]);
    expect(read.nextOffset).toBe(43);
    expect(read.skippedBatches).toBe(0);
  });

  test("several batches are read in order; one cut off at the end is left for the next fetch", () => {
    const first: Buffer = encodeBatch({ baseOffset: 0, events: events.slice(0, 2) });
    const second: Buffer = encodeBatch({ baseOffset: 2, events: events.slice(2) });
    const read: ReturnType<typeof decodeRecordSet> = decodeRecordSet(
      Buffer.concat([first, second.subarray(0, second.length - 5)]),
    );

    expect(read.records).toHaveLength(2);
    expect(read.nextOffset).toBe(2);
  });

  test("a batch whose checksum is wrong is left out, and passed", () => {
    const read: ReturnType<typeof decodeRecordSet> = decodeRecordSet(
      Buffer.concat([
        encodeBatch({ baseOffset: 0, events: events.slice(0, 1), corruptCrc: true }),
        encodeBatch({ baseOffset: 1, events: events.slice(1, 2) }),
      ]),
    );

    expect(
      read.records.map((record: KafkaRecord) => {
        return record.offset;
      }),
    ).toEqual([1]);
    expect(read.skippedBatches).toBe(1);
    expect(read.nextOffset).toBe(2);
  });

  test("a control batch holds no event but moves the offset on", () => {
    const read: ReturnType<typeof decodeRecordSet> = decodeRecordSet(
      encodeBatch({ baseOffset: 5, events: events.slice(0, 1), control: true }),
    );

    expect(read.records).toEqual([]);
    expect(read.nextOffset).toBe(6);
  });

  test("a gzip batch is read; one of a compression it does not read is left out, and passed", () => {
    const plain: Buffer = encodeBatch({ baseOffset: 0, events });
    // The records, after the count, gzipped, with the checksum made again.
    const headerEnd: number = 12 + 4 + 1 + 4 + 2 + 4 + 8 + 8 + 8 + 2 + 4 + 4;
    const records: Buffer = plain.subarray(headerEnd);
    const gzipped: Buffer = zlib.gzipSync(records);
    const afterCrc: Buffer = Buffer.concat([
      plain.subarray(21, headerEnd),
      gzipped,
    ]);
    afterCrc.writeInt16BE(1, 0);
    const batch: Buffer = Buffer.concat([
      plain.subarray(0, 8),
      Buffer.alloc(4),
      plain.subarray(12, 17),
      Buffer.alloc(4),
      afterCrc,
    ]);
    batch.writeInt32BE(batch.length - 12, 8);
    batch.writeUInt32BE(slowCrc32c(afterCrc), 17);

    const read: ReturnType<typeof decodeRecordSet> = decodeRecordSet(batch);
    expect(read.records).toHaveLength(3);
    expect(read.records[2]!.value?.toString("utf8")).toBe('{"records":[3]}');

    const snappy: Buffer = Buffer.from(batch);
    snappy.writeInt16BE(2, 21);
    snappy.writeUInt32BE(slowCrc32c(snappy.subarray(21)), 17);
    const skipped: ReturnType<typeof decodeRecordSet> = decodeRecordSet(snappy);
    expect(skipped.records).toEqual([]);
    expect(skipped.skippedBatches).toBe(1);
    expect(skipped.nextOffset).toBe(3);
  });

  test("the older message formats are read too", () => {
    const read: ReturnType<typeof decodeRecordSet> = decodeRecordSet(
      Buffer.concat([
        encodeMessageV0V1({ offset: 9, magic: 0, value: Buffer.from("zero") }),
        encodeMessageV0V1({ offset: 10, magic: 1, value: Buffer.from("one"), timestampMs: 1793959141000 }),
      ]),
    );

    expect(
      read.records.map((record: KafkaRecord) => {
        return [record.offset, record.timestampMs, record.value?.toString("utf8")];
      }),
    ).toEqual([
      [9, 0, "zero"],
      [10, 1793959141000, "one"],
    ]);
    expect(read.nextOffset).toBe(11);
  });

  test("a batch of a magic no format has is refused", () => {
    const batch: Buffer = encodeBatch({ baseOffset: 0, events: events.slice(0, 1) });
    batch.writeInt8(7, 16);

    expect(() => {
      return decodeRecordSet(batch);
    }).toThrow(KafkaProtocolError);
  });
});

describe("the client, against a fake Event Hubs namespace on a real socket", () => {
  let broker: FakeEventHubsBroker;

  beforeEach(async () => {
    broker = new FakeEventHubsBroker();
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  function client(options: { timeoutMs?: number; maxFrameBytes?: number } = {}): KafkaClient {
    return new KafkaClient({
      host: broker.host,
      port: 9093,
      clientId: "oneuptime",
      timeoutMs: options.timeoutMs ?? 2000,
      maxFrameBytes: options.maxFrameBytes ?? 4 * 1024 * 1024,
      socketFactory: (): net.Socket => {
        return broker.connect();
      },
    });
  }

  test("signs in with the Entra token, finds the event hub's partitions and reads their events", async () => {
    broker.addEvents(0, ["a", "b", "c"]);
    broker.addEvents(1, ["d"]);

    const reader: KafkaClient = client();
    await reader.connect();
    await reader.readApiVersions();
    await reader.authenticateWithToken("entra-token");

    const metadata: Awaited<ReturnType<KafkaClient["getMetadata"]>> =
      await reader.getMetadata("oneuptime");
    expect(metadata.brokers).toEqual([{ nodeId: 0, host: broker.host, port: 9093 }]);
    expect(
      metadata.topic?.partitions.map((partition: { partition: number }) => {
        return partition.partition;
      }),
    ).toEqual([0, 1]);

    expect(
      await reader.listOffsets({ topic: "oneuptime", partitions: [0, 1], timestamp: -1 }),
    ).toEqual([
      { partition: 0, errorCode: 0, offset: 3 },
      { partition: 1, errorCode: 0, offset: 1 },
    ]);

    const fetched: Awaited<ReturnType<KafkaClient["fetch"]>> = await reader.fetch({
      topic: "oneuptime",
      partitions: [
        { partition: 0, offset: 1, maxBytes: 1024 * 1024 },
        { partition: 1, offset: 0, maxBytes: 1024 * 1024 },
      ],
      maxWaitMs: 100,
      minBytes: 1,
      maxBytes: 4 * 1024 * 1024,
    });

    // The batch holding offset 1 starts at 0: the reader sees it whole.
    expect(
      fetched.partitions[0]!.records.map((record: KafkaRecord) => {
        return record.value?.toString("utf8");
      }),
    ).toEqual(["a", "b", "c"]);
    expect(fetched.partitions[0]!.highWatermark).toBe(3);
    expect(fetched.partitions[1]!.records[0]!.value?.toString("utf8")).toBe("d");

    // The broker was asked in the versions this client says it sends.
    expect(
      broker.requests.map((request: { apiKey: number; apiVersion: number }) => {
        return [request.apiKey, request.apiVersion];
      }),
    ).toEqual([
      [18, 0],
      [17, 1],
      [36, 0],
      [3, 1],
      [2, 1],
      [1, 4],
    ]);
    expect(broker.tokens).toEqual(["entra-token"]);
    reader.close();
  });

  test("a refused token is an authentication error, said as the broker said it", async () => {
    const reader: KafkaClient = client();
    await reader.connect();
    await reader.readApiVersions();

    await expect(reader.authenticateWithToken("someone-elses")).rejects.toThrow(
      KafkaAuthenticationError,
    );
    await expect(reader.authenticateWithToken("someone-elses")).rejects.toThrow(
      "lacks the Listen claim",
    );
    reader.close();
  });

  test("a broker without OAUTHBEARER is refused before any token is sent", async () => {
    broker.mechanisms = ["PLAIN"];

    const reader: KafkaClient = client();
    await reader.connect();

    await expect(reader.authenticateWithToken("entra-token")).rejects.toThrow(
      KafkaAuthenticationError,
    );
    expect(broker.tokens).toEqual([]);
    reader.close();
  });

  test("an answer that never comes fails its request in time, and closes the connection", async () => {
    broker.silentApiKey = 18;

    const reader: KafkaClient = client({ timeoutMs: 200 });
    await reader.connect();

    await expect(reader.readApiVersions()).rejects.toThrow(KafkaConnectionError);
    await expect(reader.getMetadata("oneuptime")).rejects.toThrow(KafkaConnectionError);
  });

  test("an answer claiming more than is taken closes the connection before it is held", async () => {
    broker.hugeFrame = 512 * 1024 * 1024;

    const reader: KafkaClient = client({ maxFrameBytes: 1024 });
    await reader.connect();

    await expect(reader.readApiVersions()).rejects.toThrow("past the 1024 taken");
  });

  test("a namespace that is not there is a connection error", async () => {
    const reader: KafkaClient = new KafkaClient({
      host: "nowhere.servicebus.windows.net",
      port: 9093,
      clientId: "oneuptime",
      timeoutMs: 2000,
      maxFrameBytes: 1024,
      socketFactory: (): net.Socket => {
        return net.connect({ host: "127.0.0.1", port: 1 });
      },
    });

    await expect(reader.connect()).rejects.toThrow(KafkaConnectionError);
  });

  test("a broker that closes mid-request fails every request waiting", async () => {
    const reader: KafkaClient = client();
    await reader.connect();
    broker.silentApiKey = 18;

    const waiting: Promise<void> = reader.readApiVersions();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
    await broker.stop();

    await expect(waiting).rejects.toThrow(KafkaConnectionError);
    // The next test's broker.
    broker = new FakeEventHubsBroker();
    await broker.start();
  });
});

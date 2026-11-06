import net from "net";
import { AddressInfo } from "net";

/*
 * A FAKE AZURE EVENT HUBS NAMESPACE, SPEAKING KAFKA ON A REAL SOCKET.
 *
 * What a namespace's Kafka endpoint answers a partition reader - the six
 * requests KafkaClient sends (ApiVersions v0, SaslHandshake v1,
 * SaslAuthenticate v0, Metadata v1, ListOffsets v1, Fetch v4), each answer
 * in the Kafka protocol's own layout, its record batches in the v2 format
 * with their CRC-32C - for one event hub of partitions of events. Written
 * from the protocol guide alone: nothing here reuses the client's codec,
 * so a misreading of the protocol on one side is not mirrored on the
 * other. Not a test file itself.
 *
 * A test sets what the namespace holds and how it behaves: the token it
 * takes, a role that is missing, a partition's events and the earliest
 * offset retention left, how many events a batch holds, an answer cut off
 * at the fetch's limit, an answer that never comes, a frame larger than
 * any reader takes.
 */

export interface FakeEvent {
  value: Buffer;
  timestampMs: number;
}

export interface FakePartition {
  // The offset of events[0]: what retention left.
  earliest: number;
  events: Array<FakeEvent>;
}

export interface FakeRequest {
  apiKey: number;
  apiVersion: number;
  clientId: string;
}

// ---- Writing, by hand ------------------------------------------------------

function int8(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(1);
  buffer.writeInt8(value, 0);
  return buffer;
}

function int16(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  return buffer;
}

function int32(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function uint32(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

// A signed 64-bit integer, two's complement, high half first.
function int64(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(8);
  const high: number = Math.floor(value / 4294967296);
  const low: number = value - high * 4294967296;
  buffer.writeInt32BE(high, 0);
  buffer.writeUInt32BE(low, 4);
  return buffer;
}

function readInt64(buffer: Buffer, offset: number): number {
  return buffer.readInt32BE(offset) * 4294967296 + buffer.readUInt32BE(offset + 4);
}

function kafkaString(value: string | null): Buffer {
  if (value === null) {
    return int16(-1);
  }

  const bytes: Buffer = Buffer.from(value, "utf8");
  return Buffer.concat([int16(bytes.length), bytes]);
}

function kafkaBytes(value: Buffer | null): Buffer {
  return value === null ? int32(-1) : Buffer.concat([int32(value.length), value]);
}

function kafkaArray(items: Array<Buffer>): Buffer {
  return Buffer.concat([int32(items.length), ...items]);
}

// A zigzag varint, as the record format writes lengths and deltas.
function varint(value: number): Buffer {
  let zigzag: number = value >= 0 ? value * 2 : -value * 2 - 1;
  const bytes: Array<number> = [];

  do {
    let byte: number = zigzag % 128;
    zigzag = Math.floor(zigzag / 128);

    if (zigzag > 0) {
      byte += 128;
    }

    bytes.push(byte);
  } while (zigzag > 0);

  return Buffer.from(bytes);
}

// CRC-32C, bit by bit (Castagnoli, reflected): the slow way, on purpose.
export function slowCrc32c(data: Buffer): number {
  let crc: number = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;

    for (let bit: number = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

// One record batch, v2: its events at baseOffset onwards.
export function encodeBatch(data: {
  baseOffset: number;
  events: Array<FakeEvent>;
  corruptCrc?: boolean;
  compression?: number;
  control?: boolean;
}): Buffer {
  const baseTimestamp: number = data.events[0]?.timestampMs ?? 0;
  const records: Buffer = Buffer.concat(
    data.events.map((event: FakeEvent, index: number): Buffer => {
      const body: Buffer = Buffer.concat([
        int8(0),
        varint(event.timestampMs - baseTimestamp),
        varint(index),
        varint(-1),
        varint(event.value.length),
        event.value,
        varint(0),
      ]);

      return Buffer.concat([varint(body.length), body]);
    }),
  );
  const attributes: number =
    (data.compression || 0) | (data.control ? 0x20 : 0);
  const afterCrc: Buffer = Buffer.concat([
    int16(attributes),
    int32(Math.max(0, data.events.length - 1)),
    int64(baseTimestamp),
    int64(data.events[data.events.length - 1]?.timestampMs ?? 0),
    int64(-1),
    int16(-1),
    int32(-1),
    int32(data.events.length),
    records,
  ]);
  const crc: number = slowCrc32c(afterCrc);
  const afterLength: Buffer = Buffer.concat([
    int32(0),
    int8(2),
    uint32(data.corruptCrc ? (crc ^ 1) >>> 0 : crc),
    afterCrc,
  ]);

  return Buffer.concat([int64(data.baseOffset), int32(afterLength.length), afterLength]);
}

// One message of the older formats, v0 or v1, uncompressed.
export function encodeMessageV0V1(data: {
  offset: number;
  magic: 0 | 1;
  value: Buffer;
  timestampMs?: number;
}): Buffer {
  const message: Buffer = Buffer.concat([
    int8(data.magic),
    int8(0),
    ...(data.magic === 1 ? [int64(data.timestampMs || 0)] : []),
    kafkaBytes(null),
    kafkaBytes(data.value),
  ]);
  const withCrc: Buffer = Buffer.concat([uint32(0), message]);

  return Buffer.concat([int64(data.offset), int32(withCrc.length), withCrc]);
}

// ---- The broker --------------------------------------------------------------

export class FakeEventHubsBroker {
  public host: string = "oneuptime-6f1c3a2e-eastus.servicebus.windows.net";
  public hub: string = "oneuptime";
  public partitions: Array<FakePartition> = [
    { earliest: 0, events: [] },
    { earliest: 0, events: [] },
  ];
  // The token SaslAuthenticate takes.
  public token: string = "entra-token";
  public mechanisms: Array<string> = ["PLAIN", "OAUTHBEARER"];
  // The app holds no Data Receiver role: its topic is not its to read.
  public isTopicDenied: boolean = false;
  // The event hub is not made yet.
  public isTopicMissing: boolean = false;
  // Events per batch.
  public batchSize: number = 2;
  // A fetch's last batch, cut short as a fetch's byte limit cuts it.
  public cutsLastBatch: boolean = false;
  // Answers nothing to this API key.
  public silentApiKey: number | null = null;
  // Answers every request with a frame claiming this many bytes.
  public hugeFrame: number | null = null;
  public throttleTimeMs: number = 0;

  public requests: Array<FakeRequest> = [];
  public tokens: Array<string> = [];
  public fetches: Array<Array<{ partition: number; offset: number; maxBytes: number }>> =
    [];
  public connections: number = 0;

  private server: net.Server | null = null;
  private port: number = 0;
  private sockets: Set<net.Socket> = new Set();

  public addEvents(partition: number, values: Array<string | Buffer>, startMs: number = Date.UTC(2026, 10, 6, 10, 0, 0)): void {
    const target: FakePartition = this.partitions[partition]!;

    values.forEach((value: string | Buffer, index: number): void => {
      target.events.push({
        value: Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"),
        timestampMs: startMs + (target.events.length + index) * 1000,
      });
    });
  }

  public latest(partition: number): number {
    const target: FakePartition = this.partitions[partition]!;
    return target.earliest + target.events.length;
  }

  public async start(): Promise<number> {
    this.server = net.createServer((socket: net.Socket) => {
      this.connections++;
      this.sockets.add(socket);
      socket.on("close", () => {
        this.sockets.delete(socket);
      });
      this.serve(socket);
    });
    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
    return this.port;
  }

  public async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    await new Promise<void>((resolve: () => void) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }

  // The socket a client of this namespace talks on: plain TCP to the fake.
  public connect(): net.Socket {
    return net.connect({ host: "127.0.0.1", port: this.port });
  }

  private serve(socket: net.Socket): void {
    let received: Buffer = Buffer.alloc(0);

    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);

      while (received.length >= 4) {
        const size: number = received.readInt32BE(0);

        if (received.length < 4 + size) {
          return;
        }

        const frame: Buffer = received.subarray(4, 4 + size);
        received = received.subarray(4 + size);
        this.answer(socket, frame);
      }
    });
    socket.on("error", () => {
      // The client went away.
    });
  }

  private answer(socket: net.Socket, frame: Buffer): void {
    const apiKey: number = frame.readInt16BE(0);
    const apiVersion: number = frame.readInt16BE(2);
    const correlationId: number = frame.readInt32BE(4);
    const clientIdLength: number = frame.readInt16BE(8);
    const clientId: string =
      clientIdLength >= 0 ? frame.toString("utf8", 10, 10 + clientIdLength) : "";
    const body: Buffer = frame.subarray(10 + Math.max(0, clientIdLength));

    this.requests.push({ apiKey, apiVersion, clientId });

    if (this.silentApiKey === apiKey) {
      return;
    }

    if (this.hugeFrame !== null) {
      socket.write(Buffer.concat([int32(this.hugeFrame), int32(correlationId)]));
      return;
    }

    let response: Buffer;

    switch (apiKey) {
      case 18:
        response = this.apiVersions();
        break;
      case 17:
        response = this.saslHandshake(body);
        break;
      case 36:
        response = this.saslAuthenticate(body);
        break;
      case 3:
        response = this.metadata();
        break;
      case 2:
        response = this.listOffsets(body);
        break;
      case 1:
        response = this.fetch(body);
        break;
      default:
        response = int16(35);
    }

    const message: Buffer = Buffer.concat([int32(correlationId), response]);
    socket.write(Buffer.concat([int32(message.length), message]));
  }

  private apiVersions(): Buffer {
    const ranges: Array<[number, number, number]> = [
      [0, 0, 7],
      [1, 0, 11],
      [2, 0, 5],
      [3, 0, 9],
      [17, 0, 1],
      [18, 0, 3],
      [36, 0, 2],
    ];

    return Buffer.concat([
      int16(0),
      kafkaArray(
        ranges.map(([key, min, max]: [number, number, number]): Buffer => {
          return Buffer.concat([int16(key), int16(min), int16(max)]);
        }),
      ),
    ]);
  }

  private saslHandshake(body: Buffer): Buffer {
    const length: number = body.readInt16BE(0);
    const mechanism: string = body.toString("utf8", 2, 2 + length);

    return Buffer.concat([
      int16(this.mechanisms.includes(mechanism) ? 0 : 33),
      kafkaArray(
        this.mechanisms.map((name: string): Buffer => {
          return kafkaString(name);
        }),
      ),
    ]);
  }

  private saslAuthenticate(body: Buffer): Buffer {
    const length: number = body.readInt32BE(0);
    const message: string = body.toString("utf8", 4, 4 + length);
    // n,,\x01auth=Bearer <token>\x01\x01
    const marker: string = "auth=Bearer ";
    const at: number = message.indexOf(marker);
    const end: number = message.indexOf("\u0001", at);
    const token: string =
      message.startsWith("n,,\u0001") && at >= 0 && end > at
        ? message.slice(at + marker.length, end)
        : "";

    this.tokens.push(token);

    return token === this.token
      ? Buffer.concat([int16(0), kafkaString(null), kafkaBytes(Buffer.alloc(0))])
      : Buffer.concat([
          int16(58),
          kafkaString("Invalid SAS token or the principal lacks the Listen claim."),
          kafkaBytes(Buffer.alloc(0)),
        ]);
  }

  private metadata(): Buffer {
    const broker: Buffer = Buffer.concat([
      int32(0),
      kafkaString(this.host),
      int32(9093),
      kafkaString(null),
    ]);
    const partitions: Array<Buffer> = this.partitions.map(
      (_partition: FakePartition, index: number): Buffer => {
        return Buffer.concat([
          int16(0),
          int32(index),
          int32(0),
          kafkaArray([int32(0)]),
          kafkaArray([int32(0)]),
        ]);
      },
    );
    const errorCode: number = this.isTopicDenied ? 29 : this.isTopicMissing ? 3 : 0;
    const topic: Buffer = Buffer.concat([
      int16(errorCode),
      kafkaString(this.hub),
      int8(0),
      kafkaArray(errorCode === 0 ? partitions : []),
    ]);

    return Buffer.concat([kafkaArray([broker]), int32(0), kafkaArray([topic])]);
  }

  private listOffsets(body: Buffer): Buffer {
    let position: number = 4; // replica id
    const topics: number = body.readInt32BE(position);
    position += 4;
    const answers: Array<Buffer> = [];

    for (let topicIndex: number = 0; topicIndex < topics; topicIndex++) {
      const nameLength: number = body.readInt16BE(position);
      position += 2 + nameLength;
      const partitions: number = body.readInt32BE(position);
      position += 4;
      const partitionAnswers: Array<Buffer> = [];

      for (let index: number = 0; index < partitions; index++) {
        const partition: number = body.readInt32BE(position);
        const timestamp: number = readInt64(body, position + 4);
        position += 12;
        const target: FakePartition | undefined = this.partitions[partition];
        const offset: number = !target
          ? -1
          : timestamp === -2
            ? target.earliest
            : target.earliest + target.events.length;

        partitionAnswers.push(
          Buffer.concat([
            int32(partition),
            int16(target ? 0 : 3),
            int64(-1),
            int64(offset),
          ]),
        );
      }

      answers.push(Buffer.concat([kafkaString(this.hub), kafkaArray(partitionAnswers)]));
    }

    return kafkaArray(answers);
  }

  private fetch(body: Buffer): Buffer {
    let position: number = 4 + 4 + 4 + 4 + 1; // replica, wait, min, max, isolation
    const topics: number = body.readInt32BE(position);
    position += 4;
    const topicAnswers: Array<Buffer> = [];
    const asked: Array<{ partition: number; offset: number; maxBytes: number }> = [];

    for (let topicIndex: number = 0; topicIndex < topics; topicIndex++) {
      const nameLength: number = body.readInt16BE(position);
      position += 2 + nameLength;
      const partitions: number = body.readInt32BE(position);
      position += 4;
      const partitionAnswers: Array<Buffer> = [];

      for (let index: number = 0; index < partitions; index++) {
        const partition: number = body.readInt32BE(position);
        const offset: number = readInt64(body, position + 4);
        const maxBytes: number = body.readInt32BE(position + 12);
        position += 16;
        asked.push({ partition, offset, maxBytes });
        partitionAnswers.push(this.fetchPartition(partition, offset, maxBytes));
      }

      topicAnswers.push(Buffer.concat([kafkaString(this.hub), kafkaArray(partitionAnswers)]));
    }

    this.fetches.push(asked);

    return Buffer.concat([int32(this.throttleTimeMs), kafkaArray(topicAnswers)]);
  }

  private fetchPartition(partition: number, offset: number, maxBytes: number): Buffer {
    const target: FakePartition | undefined = this.partitions[partition];

    if (this.isTopicDenied) {
      return this.partitionAnswer(partition, 29, 0, null);
    }

    if (!target) {
      return this.partitionAnswer(partition, 3, 0, null);
    }

    const latest: number = target.earliest + target.events.length;

    if (offset < target.earliest || offset > latest) {
      return this.partitionAnswer(partition, 1, latest, null);
    }

    // Whole batches from the one holding the offset, at least one, within maxBytes.
    const batches: Array<Buffer> = [];
    let size: number = 0;
    let index: number =
      Math.floor((offset - target.earliest) / this.batchSize) * this.batchSize;

    while (index < target.events.length) {
      const events: Array<FakeEvent> = target.events.slice(index, index + this.batchSize);
      const batch: Buffer = encodeBatch({ baseOffset: target.earliest + index, events });

      if (batches.length > 0 && size + batch.length > maxBytes) {
        if (this.cutsLastBatch) {
          batches.push(batch.subarray(0, Math.max(1, maxBytes - size)));
        }

        break;
      }

      batches.push(batch);
      size += batch.length;
      index += this.batchSize;
    }

    return this.partitionAnswer(partition, 0, latest, Buffer.concat(batches));
  }

  private partitionAnswer(
    partition: number,
    errorCode: number,
    highWatermark: number,
    records: Buffer | null,
  ): Buffer {
    return Buffer.concat([
      int32(partition),
      int16(errorCode),
      int64(highWatermark),
      int64(highWatermark),
      kafkaArray([]),
      kafkaBytes(records),
    ]);
  }
}

import zlib from "zlib";

/*
 * THE FEW KAFKA PROTOCOL MESSAGES A PARTITION READER NEEDS.
 *
 * Azure Event Hubs takes Kafka clients on its namespace's own host, port
 * 9093 (Standard tier and up), and OneUptime reads a connection's event
 * hubs that way (AzureEventHubsStream) - one partition at a time, from the
 * offset it read to last, with no consumer group to join. That is six
 * requests of the Apache Kafka protocol ("Kafka protocol guide",
 * kafka.apache.org), each in one version every Kafka 1.0 broker and Event
 * Hubs takes:
 *
 *   ApiVersions (18) v0        what the broker takes
 *   SaslHandshake (17) v1      the SASL mechanism: OAUTHBEARER
 *   SaslAuthenticate (36) v0   the Entra token
 *   Metadata (3) v1            the event hub's partitions and their leader
 *   ListOffsets (2) v1         a partition's earliest and latest offsets
 *   Fetch (1) v4               a partition's record batches from an offset
 *
 * Every request is framed as its size, then a v1 header (api key, version,
 * correlation id, client id) and its body; every response as its size,
 * the correlation id, and its body. A fetch answers record batches in the
 * v2 format (magic 2: varints, CRC-32C over the batch) - older message
 * sets (magic 0 and 1) are read too - and the last batch may be cut off by
 * the fetch's byte limit: it is left for the next fetch.
 *
 * 64-bit integers are carried as JavaScript numbers: an offset or a time
 * past 2^53 is not one Event Hubs writes, and is refused rather than
 * rounded. Nothing here opens a socket (KafkaClient does); every read is
 * bounded by the buffer it is given, and malformed bytes throw a
 * KafkaProtocolError.
 */

export class KafkaProtocolError extends Error {}

export const API_KEY_FETCH: number = 1;
export const API_KEY_LIST_OFFSETS: number = 2;
export const API_KEY_METADATA: number = 3;
export const API_KEY_SASL_HANDSHAKE: number = 17;
export const API_KEY_API_VERSIONS: number = 18;
export const API_KEY_SASL_AUTHENTICATE: number = 36;

// The version of each request OneUptime sends.
export const KAFKA_REQUEST_VERSIONS: Readonly<Record<number, number>> = {
  [API_KEY_FETCH]: 4,
  [API_KEY_LIST_OFFSETS]: 1,
  [API_KEY_METADATA]: 1,
  [API_KEY_SASL_HANDSHAKE]: 1,
  [API_KEY_API_VERSIONS]: 0,
  [API_KEY_SASL_AUTHENTICATE]: 0,
};

// ListOffsets' timestamps for a partition's first and next offset.
export const EARLIEST_OFFSET: number = -2;
export const LATEST_OFFSET: number = -1;

// Error codes a reader acts on.
export const KAFKA_ERROR_NONE: number = 0;
export const KAFKA_ERROR_OFFSET_OUT_OF_RANGE: number = 1;
export const KAFKA_ERROR_UNKNOWN_TOPIC_OR_PARTITION: number = 3;
export const KAFKA_ERROR_TOPIC_AUTHORIZATION_FAILED: number = 29;
export const KAFKA_ERROR_SASL_AUTHENTICATION_FAILED: number = 58;

const TWO_TO_32: number = 4294967296;

/*
 * ---- Writing ---------------------------------------------------------------
 */

export class KafkaWriter {
  private chunks: Array<Buffer> = [];

  public int8(value: number): this {
    const buffer: Buffer = Buffer.alloc(1);
    buffer.writeInt8(value, 0);
    this.chunks.push(buffer);
    return this;
  }

  public int16(value: number): this {
    const buffer: Buffer = Buffer.alloc(2);
    buffer.writeInt16BE(value, 0);
    this.chunks.push(buffer);
    return this;
  }

  public int32(value: number): this {
    const buffer: Buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value, 0);
    this.chunks.push(buffer);
    return this;
  }

  // A signed 64-bit integer, from a safe JavaScript integer.
  public int64(value: number): this {
    if (!Number.isSafeInteger(value)) {
      throw new KafkaProtocolError(
        `${value} is not a 64-bit integer this writes.`,
      );
    }

    const high: number = Math.floor(value / TWO_TO_32);
    const low: number = value - high * TWO_TO_32;
    const buffer: Buffer = Buffer.alloc(8);
    buffer.writeInt32BE(high, 0);
    buffer.writeUInt32BE(low, 4);
    this.chunks.push(buffer);
    return this;
  }

  public string(value: string | null): this {
    if (value === null) {
      return this.int16(-1);
    }

    const bytes: Buffer = Buffer.from(value, "utf8");
    this.int16(bytes.length);
    this.chunks.push(bytes);
    return this;
  }

  public bytes(value: Buffer | null): this {
    if (value === null) {
      return this.int32(-1);
    }

    this.int32(value.length);
    this.chunks.push(value);
    return this;
  }

  public array<T>(items: Array<T> | null, write: (item: T) => void): this {
    if (items === null) {
      return this.int32(-1);
    }

    this.int32(items.length);

    for (const item of items) {
      write(item);
    }

    return this;
  }

  public raw(value: Buffer): this {
    this.chunks.push(value);
    return this;
  }

  public toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/*
 * ---- Reading ---------------------------------------------------------------
 */

export class KafkaReader {
  private buffer: Buffer;
  private offset: number;

  public constructor(buffer: Buffer, offset: number = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  public get position(): number {
    return this.offset;
  }

  public get remaining(): number {
    return this.buffer.length - this.offset;
  }

  private need(length: number): void {
    if (length < 0 || this.offset + length > this.buffer.length) {
      throw new KafkaProtocolError(
        "The message ends before what it says it holds.",
      );
    }
  }

  public int8(): number {
    this.need(1);
    const value: number = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  public int16(): number {
    this.need(2);
    const value: number = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  public int32(): number {
    this.need(4);
    const value: number = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  public uint32(): number {
    this.need(4);
    const value: number = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  public int64(): number {
    this.need(8);
    const high: number = this.buffer.readInt32BE(this.offset);
    const low: number = this.buffer.readUInt32BE(this.offset + 4);
    this.offset += 8;

    const value: number = high * TWO_TO_32 + low;

    if (!Number.isSafeInteger(value)) {
      throw new KafkaProtocolError("A 64-bit integer past what this reads.");
    }

    return value;
  }

  public string(): string | null {
    const length: number = this.int16();

    if (length === -1) {
      return null;
    }

    this.need(length);
    const value: string = this.buffer.toString(
      "utf8",
      this.offset,
      this.offset + length,
    );
    this.offset += length;
    return value;
  }

  public bytes(): Buffer | null {
    const length: number = this.int32();

    if (length === -1) {
      return null;
    }

    this.need(length);
    const value: Buffer = this.buffer.subarray(
      this.offset,
      this.offset + length,
    );
    this.offset += length;
    return value;
  }

  // An array of at most `limit` items: a count past it is no message this reads.
  public array<T>(read: () => T, limit: number = 100_000): Array<T> | null {
    const count: number = this.int32();

    if (count === -1) {
      return null;
    }

    if (count < 0 || count > limit) {
      throw new KafkaProtocolError(
        `An array of ${count} items is past what this reads.`,
      );
    }

    const items: Array<T> = [];

    for (let index: number = 0; index < count; index++) {
      items.push(read());
    }

    return items;
  }

  /*
   * A zigzag varint of up to 64 bits (records' lengths and deltas), as a
   * safe integer.
   */
  public varint(): number {
    let result: number = 0;
    let multiplier: number = 1;

    for (let index: number = 0; index < 10; index++) {
      this.need(1);
      const byte: number = this.buffer[this.offset]!;
      this.offset += 1;
      result += (byte & 0x7f) * multiplier;

      if ((byte & 0x80) === 0) {
        // Zigzag: 0, -1, 1, -2, 2 ...
        const isNegative: boolean = result % 2 === 1;
        const value: number = isNegative ? -(result + 1) / 2 : result / 2;

        if (!Number.isSafeInteger(value)) {
          throw new KafkaProtocolError("A varint past what this reads.");
        }

        return value;
      }

      multiplier *= 128;
    }

    throw new KafkaProtocolError("A varint longer than ten bytes.");
  }

  public slice(length: number): Buffer {
    this.need(length);
    const value: Buffer = this.buffer.subarray(
      this.offset,
      this.offset + length,
    );
    this.offset += length;
    return value;
  }

  public skip(length: number): void {
    this.need(length);
    this.offset += length;
  }
}

/*
 * ---- CRC-32C, the checksum of a v2 record batch ------------------------------
 */

const CRC32C_TABLE: Uint32Array = ((): Uint32Array => {
  const table: Uint32Array = new Uint32Array(256);

  for (let index: number = 0; index < 256; index++) {
    let value: number = index;

    for (let bit: number = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

export function crc32c(data: Buffer): number {
  let crc: number = 0xffffffff;

  for (let index: number = 0; index < data.length; index++) {
    crc = CRC32C_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/*
 * ---- Requests --------------------------------------------------------------
 */

// One request as it goes on the wire: its size, its header and its body.
export function frameRequest(data: {
  apiKey: number;
  apiVersion: number;
  correlationId: number;
  clientId: string;
  body: Buffer;
}): Buffer {
  const message: Buffer = new KafkaWriter()
    .int16(data.apiKey)
    .int16(data.apiVersion)
    .int32(data.correlationId)
    .string(data.clientId)
    .raw(data.body)
    .toBuffer();

  return Buffer.concat([
    new KafkaWriter().int32(message.length).toBuffer(),
    message,
  ]);
}

export function encodeSaslHandshake(mechanism: string): Buffer {
  return new KafkaWriter().string(mechanism).toBuffer();
}

export function encodeSaslAuthenticate(authBytes: Buffer): Buffer {
  return new KafkaWriter().bytes(authBytes).toBuffer();
}

// The OAUTHBEARER mechanism's one message (RFC 7628): the token, as a GS2 header and a bearer field.
export function oauthBearerInitialResponse(token: string): Buffer {
  return Buffer.from(`n,,\u0001auth=Bearer ${token}\u0001\u0001`, "utf8");
}

export function encodeMetadata(topics: Array<string>): Buffer {
  const writer: KafkaWriter = new KafkaWriter();

  writer.array(topics, (topic: string): void => {
    writer.string(topic);
  });

  return writer.toBuffer();
}

export function encodeListOffsets(data: {
  topic: string;
  partitions: Array<number>;
  timestamp: number;
}): Buffer {
  const writer: KafkaWriter = new KafkaWriter();

  writer.int32(-1);
  writer.array([data.topic], (topic: string): void => {
    writer.string(topic);
    writer.array(data.partitions, (partition: number): void => {
      writer.int32(partition);
      writer.int64(data.timestamp);
    });
  });

  return writer.toBuffer();
}

export interface FetchPartitionRequest {
  partition: number;
  offset: number;
  maxBytes: number;
}

export function encodeFetch(data: {
  topic: string;
  partitions: Array<FetchPartitionRequest>;
  maxWaitMs: number;
  minBytes: number;
  maxBytes: number;
}): Buffer {
  const writer: KafkaWriter = new KafkaWriter();

  writer.int32(-1);
  writer.int32(data.maxWaitMs);
  writer.int32(data.minBytes);
  writer.int32(data.maxBytes);
  // Read uncommitted: Event Hubs has no transactions.
  writer.int8(0);
  writer.array([data.topic], (topic: string): void => {
    writer.string(topic);
    writer.array(data.partitions, (partition: FetchPartitionRequest): void => {
      writer.int32(partition.partition);
      writer.int64(partition.offset);
      writer.int32(partition.maxBytes);
    });
  });

  return writer.toBuffer();
}

/*
 * ---- Responses -------------------------------------------------------------
 */

export interface ApiVersionRange {
  apiKey: number;
  minVersion: number;
  maxVersion: number;
}

export function decodeApiVersions(body: Buffer): {
  errorCode: number;
  versions: Array<ApiVersionRange>;
} {
  const reader: KafkaReader = new KafkaReader(body);
  const errorCode: number = reader.int16();
  const versions: Array<ApiVersionRange> =
    reader.array((): ApiVersionRange => {
      return {
        apiKey: reader.int16(),
        minVersion: reader.int16(),
        maxVersion: reader.int16(),
      };
    }, 1000) || [];

  return { errorCode, versions };
}

export function decodeSaslHandshake(body: Buffer): {
  errorCode: number;
  mechanisms: Array<string>;
} {
  const reader: KafkaReader = new KafkaReader(body);
  const errorCode: number = reader.int16();
  const mechanisms: Array<string> = (
    reader.array((): string | null => {
      return reader.string();
    }, 100) || []
  ).filter((mechanism: string | null): mechanism is string => {
    return Boolean(mechanism);
  });

  return { errorCode, mechanisms };
}

export function decodeSaslAuthenticate(body: Buffer): {
  errorCode: number;
  errorMessage: string;
} {
  const reader: KafkaReader = new KafkaReader(body);
  const errorCode: number = reader.int16();
  const errorMessage: string = reader.string() || "";

  return { errorCode, errorMessage };
}

export interface KafkaBroker {
  nodeId: number;
  host: string;
  port: number;
}

export interface KafkaPartitionMetadata {
  errorCode: number;
  partition: number;
  leader: number;
}

export interface KafkaTopicMetadata {
  errorCode: number;
  topic: string;
  partitions: Array<KafkaPartitionMetadata>;
}

export function decodeMetadata(body: Buffer): {
  brokers: Array<KafkaBroker>;
  topics: Array<KafkaTopicMetadata>;
} {
  const reader: KafkaReader = new KafkaReader(body);
  const brokers: Array<KafkaBroker> =
    reader.array((): KafkaBroker => {
      const broker: KafkaBroker = {
        nodeId: reader.int32(),
        host: reader.string() || "",
        port: reader.int32(),
      };
      reader.string(); // rack
      return broker;
    }, 1000) || [];

  reader.int32(); // controller id

  const topics: Array<KafkaTopicMetadata> =
    reader.array((): KafkaTopicMetadata => {
      const errorCode: number = reader.int16();
      const topic: string = reader.string() || "";
      reader.int8(); // is internal
      const partitions: Array<KafkaPartitionMetadata> =
        reader.array((): KafkaPartitionMetadata => {
          const partition: KafkaPartitionMetadata = {
            errorCode: reader.int16(),
            partition: reader.int32(),
            leader: reader.int32(),
          };
          reader.array((): number => {
            return reader.int32();
          }, 1000); // replicas
          reader.array((): number => {
            return reader.int32();
          }, 1000); // in sync
          return partition;
        }, 1024) || [];

      return { errorCode, topic, partitions };
    }, 1000) || [];

  return { brokers, topics };
}

export interface KafkaPartitionOffset {
  partition: number;
  errorCode: number;
  offset: number;
}

export function decodeListOffsets(body: Buffer): Array<KafkaPartitionOffset> {
  const reader: KafkaReader = new KafkaReader(body);
  const offsets: Array<KafkaPartitionOffset> = [];

  reader.array((): void => {
    reader.string(); // topic
    reader.array((): void => {
      const partition: number = reader.int32();
      const errorCode: number = reader.int16();
      reader.int64(); // timestamp
      const offset: number = reader.int64();
      offsets.push({ partition, errorCode, offset });
    }, 1024);
  }, 100);

  return offsets;
}

export interface KafkaRecord {
  offset: number;
  timestampMs: number;
  value: Buffer | null;
}

export interface KafkaFetchedPartition {
  partition: number;
  errorCode: number;
  highWatermark: number;
  records: Array<KafkaRecord>;
  /*
   * The offset to fetch from next: past the last whole batch read - which
   * may be past the last record, when a batch held only control records or
   * records compacted away.
   */
  nextOffset: number | null;
  // Batches left out: a compression this does not read, or a broken checksum.
  skippedBatches: number;
}

export function decodeFetch(body: Buffer): {
  throttleTimeMs: number;
  partitions: Array<KafkaFetchedPartition>;
} {
  const reader: KafkaReader = new KafkaReader(body);
  const throttleTimeMs: number = reader.int32();
  const partitions: Array<KafkaFetchedPartition> = [];

  reader.array((): void => {
    reader.string(); // topic
    reader.array((): void => {
      const partition: number = reader.int32();
      const errorCode: number = reader.int16();
      const highWatermark: number = reader.int64();
      reader.int64(); // last stable offset
      reader.array((): void => {
        reader.int64();
        reader.int64();
      }, 100_000); // aborted transactions
      const records: Buffer | null = reader.bytes();
      const read: {
        records: Array<KafkaRecord>;
        nextOffset: number | null;
        skippedBatches: number;
      } = records
        ? decodeRecordSet(records)
        : { records: [], nextOffset: null, skippedBatches: 0 };

      partitions.push({
        partition,
        errorCode,
        highWatermark,
        ...read,
      });
    }, 1024);
  }, 100);

  return { throttleTimeMs, partitions };
}

const COMPRESSION_NONE: number = 0;
const COMPRESSION_GZIP: number = 1;
const CONTROL_BATCH: number = 0x20;
// A batch's records, once decompressed, are at most this many bytes.
export const MAX_DECOMPRESSED_BATCH_BYTES: number = 16 * 1024 * 1024;

/*
 * The records of a fetch's record set, every whole batch of it: v2 batches,
 * and v0 and v1 message sets. A batch the set cuts off at its end is left
 * for the next fetch.
 */
export function decodeRecordSet(data: Buffer): {
  records: Array<KafkaRecord>;
  nextOffset: number | null;
  skippedBatches: number;
} {
  const records: Array<KafkaRecord> = [];
  let nextOffset: number | null = null;
  let skippedBatches: number = 0;
  let position: number = 0;

  // A batch's header up to its magic byte: base offset, length, epoch.
  while (data.length - position >= 17) {
    const header: KafkaReader = new KafkaReader(data, position);
    const baseOffset: number = header.int64();
    const length: number = header.int32();

    if (length < 0) {
      throw new KafkaProtocolError("A batch of a negative length.");
    }

    // Cut off by the fetch's limit: left for the next fetch.
    if (data.length - position - 12 < length) {
      break;
    }

    const batch: Buffer = data.subarray(position + 12, position + 12 + length);
    const magic: number = batch.length > 4 ? batch.readInt8(4) : -1;

    if (magic === 2) {
      const read: {
        records: Array<KafkaRecord>;
        lastOffset: number;
        isSkipped: boolean;
      } = decodeBatchV2(baseOffset, batch);

      records.push(...read.records);
      nextOffset = read.lastOffset + 1;

      if (read.isSkipped) {
        skippedBatches++;
      }
    } else if (magic === 0 || magic === 1) {
      const read: { record: KafkaRecord | null } = decodeMessageV0V1(
        baseOffset,
        batch,
        magic,
      );

      if (read.record) {
        records.push(read.record);
      } else {
        skippedBatches++;
      }

      nextOffset = baseOffset + 1;
    } else {
      throw new KafkaProtocolError(`A batch of magic ${magic}.`);
    }

    position += 12 + length;
  }

  return { records, nextOffset, skippedBatches };
}

function decodeBatchV2(
  baseOffset: number,
  batch: Buffer,
): { records: Array<KafkaRecord>; lastOffset: number; isSkipped: boolean } {
  const reader: KafkaReader = new KafkaReader(batch);

  reader.int32(); // partition leader epoch
  reader.int8(); // magic
  const crc: number = reader.uint32();
  const checked: Buffer = batch.subarray(reader.position);
  const attributes: number = reader.int16();
  const lastOffsetDelta: number = reader.int32();
  const baseTimestamp: number = reader.int64();
  reader.int64(); // max timestamp
  reader.int64(); // producer id
  reader.int16(); // producer epoch
  reader.int32(); // base sequence
  const count: number = reader.int32();
  const lastOffset: number = baseOffset + lastOffsetDelta;

  if (crc32c(checked) !== crc) {
    return { records: [], lastOffset, isSkipped: true };
  }

  // Transaction markers hold no event.
  if ((attributes & CONTROL_BATCH) !== 0) {
    return { records: [], lastOffset, isSkipped: false };
  }

  const compression: number = attributes & 0x07;
  let body: Buffer = batch.subarray(reader.position);

  if (compression === COMPRESSION_GZIP) {
    try {
      body = zlib.gunzipSync(body, {
        maxOutputLength: MAX_DECOMPRESSED_BATCH_BYTES,
      });
    } catch {
      return { records: [], lastOffset, isSkipped: true };
    }
  } else if (compression !== COMPRESSION_NONE) {
    return { records: [], lastOffset, isSkipped: true };
  }

  if (count < 0 || count > 1_000_000) {
    throw new KafkaProtocolError(`A batch of ${count} records.`);
  }

  const records: Array<KafkaRecord> = [];
  const recordReader: KafkaReader = new KafkaReader(body);

  for (let index: number = 0; index < count; index++) {
    const length: number = recordReader.varint();
    const record: KafkaReader = new KafkaReader(recordReader.slice(length));

    record.int8(); // attributes
    const timestampDelta: number = record.varint();
    const offsetDelta: number = record.varint();
    const keyLength: number = record.varint();

    if (keyLength > 0) {
      record.skip(keyLength);
    }

    const valueLength: number = record.varint();
    const value: Buffer | null =
      valueLength >= 0 ? record.slice(valueLength) : null;

    records.push({
      offset: baseOffset + offsetDelta,
      timestampMs: baseTimestamp + timestampDelta,
      value,
    });
  }

  return { records, lastOffset, isSkipped: false };
}

function decodeMessageV0V1(
  offset: number,
  message: Buffer,
  magic: number,
): { record: KafkaRecord | null } {
  const reader: KafkaReader = new KafkaReader(message);

  reader.uint32(); // crc
  reader.int8(); // magic
  const attributes: number = reader.int8();
  const timestampMs: number = magic === 1 ? reader.int64() : 0;

  reader.bytes(); // key
  const value: Buffer | null = reader.bytes();

  // A compressed message wraps a message set of its own: not read.
  if ((attributes & 0x07) !== COMPRESSION_NONE) {
    return { record: null };
  }

  return { record: { offset, timestampMs, value } };
}

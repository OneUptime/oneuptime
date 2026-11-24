/*
 * MESSAGEPACK, AS A DATADOG TRACER WRITES IT: COUNTED BEFORE IT IS DECODED.
 *
 * A Datadog tracing library posts its traces to the Agent's /v0.4/traces
 * and /v0.5/traces as MessagePack (https://github.com/msgpack/msgpack/
 * blob/master/spec.md). In MessagePack one byte is a value - 0x90 is an
 * empty array - so a body of a few megabytes is millions of arrays once
 * decoded: gigabytes of heap and seconds of the App's request thread. So a
 * body is walked once first, on its bytes alone (count), and every value in
 * it - nil, a boolean, a number, a string, a binary, an extension, an array
 * and a map, a map's keys too - is counted, as JsonElementCount counts a
 * JSON body. The walk allocates nothing, keeps its place in a small stack
 * rather than recursing, stops as soon as the count passes the limit, and
 * refuses a body nested deeper than the decoder below will go. A container
 * that declares more values than there are bytes left is malformed at once:
 * every value is at least a byte.
 *
 * Only a body the walk counted is decoded (decode), into plain values:
 *
 *   - a map is a Map, its keys of any type (v0.5's are numbers), so a key
 *     named __proto__ is a key like any other;
 *   - a 64-bit integer (0xcf, 0xd3) is a bigint, so a trace ID, a span ID
 *     and a time in nanoseconds keep every digit; a smaller one is a number;
 *   - a string is decoded as UTF-8, a byte that is not one becoming U+FFFD,
 *     as the trace-agent repairs it; a binary is a Buffer of the body;
 *   - an extension, which no tracer writes, is null.
 *
 * Only the first value is read: the trace-agent's decoder leaves whatever
 * follows it, and so does this one.
 */

export enum MsgpackElementCountOutcome {
  Counted = "counted",
  // More values than the limit: the walk stopped there.
  OverLimit = "over-limit",
  // Not one MessagePack value: cut short, a byte no value starts with, or nested too deep.
  Malformed = "malformed",
}

export interface MsgpackElementCount {
  outcome: MsgpackElementCountOutcome;
  // How many were counted (when not Counted, how many before the stop).
  elements: number;
}

export type MsgpackValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | Array<MsgpackValue>
  | Map<MsgpackValue, MsgpackValue>;

/*
 * The deepest a body is nested, the top-level value at depth 0. A tracer's
 * traces are an array of traces of spans, each a map whose meta, links and
 * events are maps and arrays of maps: depth 5 at most.
 */
export const MSGPACK_MAX_DEPTH: number = 32;

export class MsgpackDecodeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MsgpackDecodeError";
  }
}

// How many bytes a value of a fixed size takes, header byte included, by its first byte.
const FIXED_SIZES: ReadonlyMap<number, number> = new Map<number, number>([
  [0xc0, 1], // nil
  [0xc2, 1], // false
  [0xc3, 1], // true
  [0xca, 5], // float 32
  [0xcb, 9], // float 64
  [0xcc, 2], // uint 8
  [0xcd, 3], // uint 16
  [0xce, 5], // uint 32
  [0xcf, 9], // uint 64
  [0xd0, 2], // int 8
  [0xd1, 3], // int 16
  [0xd2, 5], // int 32
  [0xd3, 9], // int 64
  [0xd4, 3], // fixext 1
  [0xd5, 4], // fixext 2
  [0xd6, 6], // fixext 4
  [0xd7, 10], // fixext 8
  [0xd8, 18], // fixext 16
]);

class Malformed extends Error {}

interface Cursor {
  position: number;
}

export default class Msgpack {
  /*
   * The values the first value of `body` holds, itself included, counted
   * up to `limit`.
   */
  public static count(
    body: Uint8Array,
    limit: number,
    maxDepth: number = MSGPACK_MAX_DEPTH,
  ): MsgpackElementCount {
    const bytes: Buffer = Msgpack.asBuffer(body);
    // The values still to read in each container open, the body itself first.
    const remaining: Array<number> = [1];
    let position: number = 0;
    let elements: number = 0;

    while (remaining.length > 0) {
      const top: number = remaining.length - 1;

      if (remaining[top] === 0) {
        remaining.pop();
        continue;
      }

      remaining[top] = remaining[top]! - 1;

      if (position >= bytes.length) {
        return Msgpack.counted(MsgpackElementCountOutcome.Malformed, elements);
      }

      elements++;

      if (elements > limit) {
        return Msgpack.counted(MsgpackElementCountOutcome.OverLimit, elements);
      }

      const head: number = bytes[position]!;
      let size: number;
      let values: number = 0;

      try {
        if (head <= 0x7f || head >= 0xe0) {
          // A positive or negative fixint.
          size = 1;
        } else if (head <= 0x8f) {
          size = 1;
          values = (head & 0x0f) * 2;
        } else if (head <= 0x9f) {
          size = 1;
          values = head & 0x0f;
        } else if (head <= 0xbf) {
          size = 1 + (head & 0x1f);
        } else {
          const fixed: number | undefined = FIXED_SIZES.get(head);

          if (fixed !== undefined) {
            size = fixed;
          } else {
            const variable: { size: number; values: number } =
              Msgpack.variableHeader(bytes, position, head);
            size = variable.size;
            values = variable.values;
          }
        }
      } catch (error) {
        if (error instanceof Malformed) {
          return Msgpack.counted(
            MsgpackElementCountOutcome.Malformed,
            elements,
          );
        }

        throw error;
      }

      position += size;

      if (position > bytes.length) {
        return Msgpack.counted(MsgpackElementCountOutcome.Malformed, elements);
      }

      if (values > 0) {
        // Each value it declares takes at least a byte of what is left.
        if (values > bytes.length - position || remaining.length > maxDepth) {
          return Msgpack.counted(
            MsgpackElementCountOutcome.Malformed,
            elements,
          );
        }

        remaining.push(values);
      }
    }

    return Msgpack.counted(MsgpackElementCountOutcome.Counted, elements);
  }

  /*
   * The first value of `body`. For a body count() has counted: it throws a
   * MsgpackDecodeError for one that is not MessagePack, or is nested past
   * `maxDepth`.
   */
  public static decode(
    body: Uint8Array,
    maxDepth: number = MSGPACK_MAX_DEPTH,
  ): MsgpackValue {
    const bytes: Buffer = Msgpack.asBuffer(body);
    const cursor: Cursor = { position: 0 };

    try {
      return Msgpack.read(bytes, cursor, 0, maxDepth);
    } catch (error) {
      if (error instanceof Malformed) {
        throw new MsgpackDecodeError("The body is not MessagePack.");
      }

      throw error;
    }
  }

  // A value as an unsigned 64-bit integer, as the trace-agent reads an ID: a negative int64 is its two's complement.
  public static toUint64(value: MsgpackValue | undefined): bigint | null {
    if (typeof value === "bigint") {
      return value < BigInt(0) ? value + BigInt("18446744073709551616") : value;
    }

    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value < 0
        ? BigInt(value) + BigInt("18446744073709551616")
        : BigInt(value);
    }

    return null;
  }

  // A value as a signed 64-bit integer, a time or a duration: an unsigned one past int64 is none.
  public static toInt64(value: MsgpackValue | undefined): bigint | null {
    if (typeof value === "bigint") {
      return value > BigInt("9223372036854775807") ? null : value;
    }

    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return BigInt(value);
    }

    return null;
  }

  // A value as a number: a float, or an integer of any size (the agent reads float64 so).
  public static toNumber(value: MsgpackValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    return null;
  }

  // A value as text: a string, or a binary read as UTF-8 (both are strings to the agent); nil is "".
  public static toText(value: MsgpackValue | undefined): string {
    if (typeof value === "string") {
      return value;
    }

    if (Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }

    return "";
  }

  public static isMap(
    value: MsgpackValue | undefined,
  ): value is Map<MsgpackValue, MsgpackValue> {
    return value instanceof Map;
  }

  private static counted(
    outcome: MsgpackElementCountOutcome,
    elements: number,
  ): MsgpackElementCount {
    return { outcome: outcome, elements: elements };
  }

  private static asBuffer(body: Uint8Array): Buffer {
    return Buffer.isBuffer(body)
      ? body
      : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  /*
   * A header whose size is in the bytes after it: a str, bin or ext of 8,
   * 16 or 32 bits of length, or an array or map of 16 or 32 bits of count.
   * Its size in bytes - a string's, binary's or extension's payload
   * included - and how many values follow it.
   */
  private static variableHeader(
    bytes: Buffer,
    position: number,
    head: number,
  ): { size: number; values: number } {
    const lengthAt: (width: number) => number = (width: number): number => {
      if (position + 1 + width > bytes.length) {
        throw new Malformed();
      }

      if (width === 1) {
        return bytes.readUInt8(position + 1);
      }

      if (width === 2) {
        return bytes.readUInt16BE(position + 1);
      }

      return bytes.readUInt32BE(position + 1);
    };

    switch (head) {
      case 0xc4: // bin 8
      case 0xd9: // str 8
        return { size: 2 + lengthAt(1), values: 0 };
      case 0xc5: // bin 16
      case 0xda: // str 16
        return { size: 3 + lengthAt(2), values: 0 };
      case 0xc6: // bin 32
      case 0xdb: // str 32
        return { size: 5 + lengthAt(4), values: 0 };
      case 0xc7: // ext 8: a type byte, then the data
        return { size: 3 + lengthAt(1), values: 0 };
      case 0xc8: // ext 16
        return { size: 4 + lengthAt(2), values: 0 };
      case 0xc9: // ext 32
        return { size: 6 + lengthAt(4), values: 0 };
      case 0xdc: // array 16
        return { size: 3, values: lengthAt(2) };
      case 0xdd: // array 32
        return { size: 5, values: lengthAt(4) };
      case 0xde: // map 16
        return { size: 3, values: lengthAt(2) * 2 };
      case 0xdf: // map 32
        return { size: 5, values: lengthAt(4) * 2 };
      default:
        // 0xc1: never used.
        throw new Malformed();
    }
  }

  private static read(
    bytes: Buffer,
    cursor: Cursor,
    depth: number,
    maxDepth: number,
  ): MsgpackValue {
    if (cursor.position >= bytes.length) {
      throw new Malformed();
    }

    const head: number = bytes[cursor.position]!;
    const at: number = cursor.position;

    if (head <= 0x7f) {
      cursor.position++;
      return head;
    }

    if (head >= 0xe0) {
      cursor.position++;
      return head - 0x100;
    }

    if (head <= 0x8f) {
      cursor.position++;
      return Msgpack.readMap(bytes, cursor, head & 0x0f, depth, maxDepth);
    }

    if (head <= 0x9f) {
      cursor.position++;
      return Msgpack.readArray(bytes, cursor, head & 0x0f, depth, maxDepth);
    }

    if (head <= 0xbf) {
      return Msgpack.readString(bytes, cursor, at + 1, head & 0x1f);
    }

    // Every byte a value of a fixed size needs is there before it is read.
    const fixed: number | undefined = FIXED_SIZES.get(head);

    if (fixed !== undefined) {
      if (at + fixed > bytes.length) {
        throw new Malformed();
      }

      cursor.position = at + fixed;

      return Msgpack.readFixed(bytes, at, head);
    }

    // A str, bin, ext, array or map whose length follows: its header checked.
    const variable: { size: number; values: number } = Msgpack.variableHeader(
      bytes,
      at,
      head,
    );

    switch (head) {
      case 0xd9:
      case 0xda:
      case 0xdb: {
        const headerSize: number = Msgpack.headerSize(head);

        return Msgpack.readString(
          bytes,
          cursor,
          at + headerSize,
          variable.size - headerSize,
        );
      }
      case 0xc4:
      case 0xc5:
      case 0xc6: {
        const headerSize: number = Msgpack.headerSize(head);

        return Msgpack.readBinary(
          bytes,
          cursor,
          at + headerSize,
          variable.size - headerSize,
        );
      }
      case 0xdc:
      case 0xdd:
        cursor.position = at + variable.size;
        return Msgpack.readArray(
          bytes,
          cursor,
          variable.values,
          depth,
          maxDepth,
        );
      case 0xde:
      case 0xdf:
        cursor.position = at + variable.size;
        return Msgpack.readMap(
          bytes,
          cursor,
          variable.values / 2,
          depth,
          maxDepth,
        );
      default:
        // An extension (ext 8, 16, 32): stepped over, as no tracer writes one.
        if (at + variable.size > bytes.length) {
          throw new Malformed();
        }

        cursor.position = at + variable.size;
        return null;
    }
  }

  // A value of a fixed size, its bytes known to be there.
  private static readFixed(
    bytes: Buffer,
    at: number,
    head: number,
  ): MsgpackValue {
    switch (head) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xca:
        return bytes.readFloatBE(at + 1);
      case 0xcb:
        return bytes.readDoubleBE(at + 1);
      case 0xcc:
        return bytes.readUInt8(at + 1);
      case 0xcd:
        return bytes.readUInt16BE(at + 1);
      case 0xce:
        return bytes.readUInt32BE(at + 1);
      case 0xcf:
        return bytes.readBigUInt64BE(at + 1);
      case 0xd0:
        return bytes.readInt8(at + 1);
      case 0xd1:
        return bytes.readInt16BE(at + 1);
      case 0xd2:
        return bytes.readInt32BE(at + 1);
      case 0xd3:
        return bytes.readBigInt64BE(at + 1);
      default:
        // A fixext: stepped over, as no tracer writes one.
        return null;
    }
  }

  // The bytes before a str's or bin's payload: its first byte and its length.
  private static headerSize(head: number): number {
    if (head === 0xd9 || head === 0xc4) {
      return 2;
    }

    if (head === 0xda || head === 0xc5) {
      return 3;
    }

    return 5;
  }

  private static readString(
    bytes: Buffer,
    cursor: Cursor,
    start: number,
    length: number,
  ): string {
    const end: number = start + length;

    if (end > bytes.length) {
      throw new Malformed();
    }

    cursor.position = end;

    return bytes.toString("utf8", start, end);
  }

  private static readBinary(
    bytes: Buffer,
    cursor: Cursor,
    start: number,
    length: number,
  ): Buffer {
    const end: number = start + length;

    if (end > bytes.length) {
      throw new Malformed();
    }

    cursor.position = end;

    return bytes.subarray(start, end);
  }

  private static readArray(
    bytes: Buffer,
    cursor: Cursor,
    length: number,
    depth: number,
    maxDepth: number,
  ): Array<MsgpackValue> {
    Msgpack.checkContainer(bytes, cursor, length, depth, maxDepth);

    const values: Array<MsgpackValue> = [];

    for (let index: number = 0; index < length; index++) {
      values.push(Msgpack.read(bytes, cursor, depth + 1, maxDepth));
    }

    return values;
  }

  private static readMap(
    bytes: Buffer,
    cursor: Cursor,
    length: number,
    depth: number,
    maxDepth: number,
  ): Map<MsgpackValue, MsgpackValue> {
    Msgpack.checkContainer(bytes, cursor, length * 2, depth, maxDepth);

    const map: Map<MsgpackValue, MsgpackValue> = new Map<
      MsgpackValue,
      MsgpackValue
    >();

    for (let index: number = 0; index < length; index++) {
      const key: MsgpackValue = Msgpack.read(
        bytes,
        cursor,
        depth + 1,
        maxDepth,
      );
      map.set(key, Msgpack.read(bytes, cursor, depth + 1, maxDepth));
    }

    return map;
  }

  private static checkContainer(
    bytes: Buffer,
    cursor: Cursor,
    values: number,
    depth: number,
    maxDepth: number,
  ): void {
    if (cursor.position > bytes.length) {
      throw new Malformed();
    }

    if (values > 0 && depth + 1 > maxDepth) {
      throw new Malformed();
    }

    if (values > bytes.length - cursor.position) {
      throw new Malformed();
    }
  }
}

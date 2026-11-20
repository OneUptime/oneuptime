/*
 * A MessagePack encoder for the tests, written from the specification
 * (https://github.com/msgpack/msgpack/blob/master/spec.md) the way the
 * Datadog tracers' encoders write it: every integer in its smallest form
 * (Go's msgp, the C msgpack dd-trace-py builds on, Java's msgpack-core),
 * a 64-bit one in 0xcf or 0xd3, a fraction as a float 64, strings as str
 * (or bin when a Buffer), arrays and maps with the smallest header.
 *
 * Values: null, a boolean, a number (an integer, or a fraction), a bigint
 * (written as uint 64, or int 64 when negative), a string, a Buffer, an
 * array, a Map (keys of any type) or a plain object (string keys). An
 * Int64 or Float32 wraps a value that must be written in that form, and
 * Raw bytes are written as they are.
 */

export class Int64 {
  public constructor(public readonly value: bigint) {}
}

export class Float32 {
  public constructor(public readonly value: number) {}
}

export class Raw {
  public constructor(public readonly bytes: Buffer) {}
}

export type Encodable =
  | null
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | Int64
  | Float32
  | Raw
  | Array<Encodable>
  | Map<Encodable, Encodable>
  | { [key: string]: Encodable };

export function encodeMsgpack(value: Encodable): Buffer {
  const chunks: Array<Buffer> = [];
  write(chunks, value);
  return Buffer.concat(chunks);
}

function byte(value: number): Buffer {
  return Buffer.from([value]);
}

function header(code: number, length: number, width: 1 | 2 | 4): Buffer {
  const buffer: Buffer = Buffer.alloc(1 + width);
  buffer[0] = code;

  if (width === 1) {
    buffer.writeUInt8(length, 1);
  } else if (width === 2) {
    buffer.writeUInt16BE(length, 1);
  } else {
    buffer.writeUInt32BE(length, 1);
  }

  return buffer;
}

function writeInteger(chunks: Array<Buffer>, value: number): void {
  if (value >= 0) {
    if (value <= 0x7f) {
      chunks.push(byte(value));
    } else if (value <= 0xff) {
      chunks.push(header(0xcc, value, 1));
    } else if (value <= 0xffff) {
      chunks.push(header(0xcd, value, 2));
    } else if (value <= 0xffffffff) {
      chunks.push(header(0xce, value, 4));
    } else {
      writeBigInt(chunks, BigInt(value));
    }

    return;
  }

  if (value >= -32) {
    chunks.push(byte(0x100 + value));
  } else if (value >= -0x80) {
    const buffer: Buffer = Buffer.alloc(2);
    buffer[0] = 0xd0;
    buffer.writeInt8(value, 1);
    chunks.push(buffer);
  } else if (value >= -0x8000) {
    const buffer: Buffer = Buffer.alloc(3);
    buffer[0] = 0xd1;
    buffer.writeInt16BE(value, 1);
    chunks.push(buffer);
  } else if (value >= -0x80000000) {
    const buffer: Buffer = Buffer.alloc(5);
    buffer[0] = 0xd2;
    buffer.writeInt32BE(value, 1);
    chunks.push(buffer);
  } else {
    writeBigInt(chunks, BigInt(value));
  }
}

function writeBigInt(chunks: Array<Buffer>, value: bigint): void {
  const buffer: Buffer = Buffer.alloc(9);

  if (value < BigInt(0)) {
    buffer[0] = 0xd3;
    buffer.writeBigInt64BE(value, 1);
  } else {
    buffer[0] = 0xcf;
    buffer.writeBigUInt64BE(value, 1);
  }

  chunks.push(buffer);
}

function writeLength(
  chunks: Array<Buffer>,
  length: number,
  fix: { code: number; max: number } | null,
  codes: [number, number, number] | [null, number, number],
): void {
  if (fix && length <= fix.max) {
    chunks.push(byte(fix.code | length));
  } else if (codes[0] !== null && length <= 0xff) {
    chunks.push(header(codes[0], length, 1));
  } else if (length <= 0xffff) {
    chunks.push(header(codes[1], length, 2));
  } else {
    chunks.push(header(codes[2], length, 4));
  }
}

function write(chunks: Array<Buffer>, value: Encodable): void {
  if (value === null) {
    chunks.push(byte(0xc0));
    return;
  }

  if (value === true || value === false) {
    chunks.push(byte(value ? 0xc3 : 0xc2));
    return;
  }

  if (value instanceof Raw) {
    chunks.push(value.bytes);
    return;
  }

  if (value instanceof Int64) {
    const buffer: Buffer = Buffer.alloc(9);
    buffer[0] = 0xd3;
    buffer.writeBigInt64BE(value.value, 1);
    chunks.push(buffer);
    return;
  }

  if (value instanceof Float32) {
    const buffer: Buffer = Buffer.alloc(5);
    buffer[0] = 0xca;
    buffer.writeFloatBE(value.value, 1);
    chunks.push(buffer);
    return;
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      writeInteger(chunks, value);
      return;
    }

    const buffer: Buffer = Buffer.alloc(9);
    buffer[0] = 0xcb;
    buffer.writeDoubleBE(value, 1);
    chunks.push(buffer);
    return;
  }

  if (typeof value === "bigint") {
    writeBigInt(chunks, value);
    return;
  }

  if (typeof value === "string") {
    const bytes: Buffer = Buffer.from(value, "utf8");
    writeLength(
      chunks,
      bytes.length,
      { code: 0xa0, max: 31 },
      [0xd9, 0xda, 0xdb],
    );
    chunks.push(bytes);
    return;
  }

  if (Buffer.isBuffer(value)) {
    writeLength(chunks, value.length, null, [0xc4, 0xc5, 0xc6]);
    chunks.push(value);
    return;
  }

  if (Array.isArray(value)) {
    writeLength(
      chunks,
      value.length,
      { code: 0x90, max: 15 },
      [null, 0xdc, 0xdd],
    );

    for (const item of value) {
      write(chunks, item);
    }

    return;
  }

  const entries: Array<[Encodable, Encodable]> =
    value instanceof Map
      ? Array.from(value.entries())
      : Object.keys(value).map((key: string): [Encodable, Encodable] => {
          return [key, (value as { [key: string]: Encodable })[key]!];
        });

  writeLength(
    chunks,
    entries.length,
    { code: 0x80, max: 15 },
    [null, 0xde, 0xdf],
  );

  for (const [key, item] of entries) {
    write(chunks, key);
    write(chunks, item);
  }
}

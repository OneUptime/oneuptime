import protobuf from "protobufjs";
import { JSONObject } from "Common/Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * OTLP PROTOBUF, READ STRAIGHT INTO THE OBJECT INGEST READS.
 *
 * An OTLP/HTTP protobuf body was read in two passes: protobufjs decoded it
 * into message objects - a long.js Long for every 64-bit field (each span's
 * two times, each log's two, each metric point's), a Buffer for every id -
 * and `.toJSON()` (protobufjs' generic toObject) copied that tree into the
 * plain object the ingest services read: each Long turned into decimal
 * digits by long.js' division loop, each id into base64 by a JavaScript
 * encoder. Under OTLP load that was 8% of the App's busy time and a quarter
 * of everything it allocated (#6086).
 *
 * This reads the wire format once, into that same plain object: the same
 * keys in the same order, the same values. Each message type is compiled
 * once from the protobufjs reflection the decoder already loads, and every
 * primitive is read by protobufjs' own Reader, so malformed input fails the
 * way it did. What differs is only how the result is built:
 *
 *   - 64-bit integers: fixed64 / sfixed64 are read as two 32-bit halves and
 *     written in decimal without long.js; varint ones (an attribute's int,
 *     a bucket count) are read by the Reader and written the same way;
 *   - bytes: base64 straight from the body, by Buffer;
 *   - each message's fields are written as they arrive and, when a sender
 *     wrote them out of field-number order, put back into it.
 *
 * toObject's rules, which this keeps (protobufjs 7, its toJSON options:
 * longs and enums as strings, bytes as base64, json: true):
 *   - a singular field is written when the wire carried it, whatever its
 *     value; the last one on the wire wins, a message field too (protobufjs
 *     replaces it rather than merging);
 *   - a repeated field is written when it holds at least one value; packed
 *     and unpacked runs of a scalar add up, in wire order;
 *   - keys follow field-number order;
 *   - an enum is its name, or the number when the enum has no such name;
 *   - a double or float that is not finite is "NaN", "Infinity" or
 *     "-Infinity";
 *   - nesting past protobufjs' recursion limit throws, as decode() does.
 *
 * OtlpWireDecoder.test.ts holds it to protobufjs over every OTLP shape and
 * thousands of generated messages - shuffled field order, unknown fields,
 * duplicates, packed and unpacked runs, every enum and 64-bit edge - and
 * to throwing where protobufjs throws on corrupted bodies.
 * ---------------------------------------------------------------------------
 */

const enum Kind {
  Message,
  Enum,
  String,
  Bytes,
  Bool,
  Int32,
  Uint32,
  Sint32,
  Fixed32,
  Sfixed32,
  Int64,
  Uint64,
  Sint64,
  Fixed64,
  Sfixed64,
  Double,
  Float,
}

const SCALAR_KINDS: ReadonlyMap<string, Kind> = new Map<string, Kind>([
  ["string", Kind.String],
  ["bytes", Kind.Bytes],
  ["bool", Kind.Bool],
  ["int32", Kind.Int32],
  ["uint32", Kind.Uint32],
  ["sint32", Kind.Sint32],
  ["fixed32", Kind.Fixed32],
  ["sfixed32", Kind.Sfixed32],
  ["int64", Kind.Int64],
  ["uint64", Kind.Uint64],
  ["sint64", Kind.Sint64],
  ["fixed64", Kind.Fixed64],
  ["sfixed64", Kind.Sfixed64],
  ["double", Kind.Double],
  ["float", Kind.Float],
]);

interface CompiledField {
  name: string;
  id: number;
  kind: Kind;
  repeated: boolean;
  // protobufjs reads a packed run for every repeated scalar but strings and bytes.
  packable: boolean;
  message: CompiledType | null;
  // Enum value names by number (protobufjs' valuesById), for Kind.Enum.
  enumNames: Readonly<Record<string, string>> | null;
}

interface CompiledType {
  name: string;
  // By field number; a number with no field is skipped, as protobufjs skips it.
  fieldsById: Array<CompiledField | undefined>;
  // In field-number order: the order toObject writes keys in.
  ordered: Array<CompiledField>;
}

const compiled: Map<protobuf.Type, CompiledType> = new Map();

/*
 * The compiled form of `type` and every message type it holds, once. Throws
 * for what toObject would write differently from the rules above (a map
 * field, a field named like an Object.prototype member): such a type is not
 * read here at all.
 */
function compile(type: protobuf.Type): CompiledType {
  const known: CompiledType | undefined = compiled.get(type);

  if (known) {
    return known;
  }

  const result: CompiledType = {
    name: type.fullName,
    fieldsById: [],
    ordered: [],
  };

  // Cached before its fields, so a type that holds itself (AnyValue) resolves.
  compiled.set(type, result);

  try {
    type.resolveAll();

    for (const field of type.fieldsArray) {
      field.resolve();

      if (field.map) {
        throw new Error(`${type.fullName}.${field.name} is a map field`);
      }

      if (field.name in Object.prototype) {
        throw new Error(`${type.fullName}.${field.name} names a prototype key`);
      }

      if (!Number.isInteger(field.id) || field.id < 1 || field.id > 4096) {
        throw new Error(`${type.fullName}.${field.name} has id ${field.id}`);
      }

      const resolved: protobuf.ReflectionObject | null = field.resolvedType;
      let kind: Kind;
      let message: CompiledType | null = null;
      let enumNames: Readonly<Record<string, string>> | null = null;

      if (resolved instanceof protobuf.Type) {
        kind = Kind.Message;
        message = compile(resolved);
      } else if (resolved instanceof protobuf.Enum) {
        kind = Kind.Enum;
        enumNames = resolved.valuesById as unknown as Record<string, string>;
      } else {
        const scalar: Kind | undefined = SCALAR_KINDS.get(field.type);

        if (scalar === undefined) {
          throw new Error(
            `${type.fullName}.${field.name} has type ${field.type}`,
          );
        }

        kind = scalar;
      }

      const compiledField: CompiledField = {
        name: field.name,
        id: field.id,
        kind: kind,
        repeated: field.repeated,
        packable:
          field.repeated &&
          kind !== Kind.Message &&
          kind !== Kind.String &&
          kind !== Kind.Bytes,
        message: message,
        enumNames: enumNames,
      };

      result.fieldsById[field.id] = compiledField;
      result.ordered.push(compiledField);
    }

    result.ordered.sort((a: CompiledField, b: CompiledField) => {
      return a.id - b.id;
    });
  } catch (error) {
    compiled.delete(type);
    throw error;
  }

  return result;
}

const TWO_POW_32: number = 4294967296;
const BASE_1E7: number = 10000000;

/*
 * An unsigned 64-bit integer given as two unsigned 32-bit halves, in
 * decimal digits - what long.js' toString gives, without its division
 * loop. Past 2^53 a double cannot hold the value, so it is split into three
 * base-10^7 digits (bits 0-23, 24-47 and 48-63, each multiplied out with
 * products that stay under 2^53) and carried.
 */
export function unsignedDecimal(low: number, high: number): string {
  if (high <= 0x1fffff) {
    return String(high * TWO_POW_32 + low);
  }

  const bits0: number = low & 0xffffff;
  const bits24: number = ((low >>> 24) | (high << 8)) & 0xffffff;
  const bits48: number = (high >>> 16) & 0xffff;

  // 2^24 = 1·10^7 + 6777216; 2^48 = 2·10^14 + 8147497·10^7 + 6710656.
  let digitA: number = bits0 + bits24 * 6777216 + bits48 * 6710656;
  let digitB: number = bits24 + bits48 * 8147497;
  let digitC: number = bits48 * 2;

  if (digitA >= BASE_1E7) {
    digitB += Math.floor(digitA / BASE_1E7);
    digitA %= BASE_1E7;
  }

  if (digitB >= BASE_1E7) {
    digitC += Math.floor(digitB / BASE_1E7);
    digitB %= BASE_1E7;
  }

  // high > 0x1fffff, so the value is at least 2^53: digitC is never 0.
  return (
    String(digitC) +
    String(digitB).padStart(7, "0") +
    String(digitA).padStart(7, "0")
  );
}

// A signed (two's complement) 64-bit integer given as two 32-bit halves.
export function signedDecimal(low: number, high: number): string {
  if ((high & 0x80000000) === 0) {
    return unsignedDecimal(low >>> 0, high >>> 0);
  }

  // Negate: invert and add one, carrying from the low half into the high.
  const negatedLow: number = (~low + 1) >>> 0;
  const negatedHigh: number = (~high + (negatedLow === 0 ? 1 : 0)) >>> 0;

  return "-" + unsignedDecimal(negatedLow, negatedHigh);
}

function indexOutOfRange(
  reader: protobuf.Reader,
  writeLength: number,
): RangeError {
  // protobufjs' own message for the same overrun.
  return RangeError(
    "index out of range: " +
      reader.pos +
      " + " +
      (writeLength || 1) +
      " > " +
      reader.len,
  );
}

// A fixed64 or sfixed64 field, as protobufjs reads it: little-endian halves.
function readFixed64(reader: protobuf.Reader, signed: boolean): string {
  if (reader.pos + 8 > reader.len) {
    throw indexOutOfRange(reader, 8);
  }

  const buf: Uint8Array = reader.buf;
  const at: number = reader.pos;
  const low: number =
    (buf[at]! |
      (buf[at + 1]! << 8) |
      (buf[at + 2]! << 16) |
      (buf[at + 3]! << 24)) >>>
    0;
  const high: number =
    (buf[at + 4]! |
      (buf[at + 5]! << 8) |
      (buf[at + 6]! << 16) |
      (buf[at + 7]! << 24)) >>>
    0;

  reader.pos = at + 8;

  return signed ? signedDecimal(low, high) : unsignedDecimal(low, high);
}

interface LongLike {
  low: number;
  high: number;
}

/*
 * A varint 64-bit field, read by protobufjs' Reader: a Long when long.js is
 * loaded (it is a dependency of protobufjs), otherwise a number - which
 * toObject writes with String(), as here.
 */
function longDecimal(long: LongLike | number, signed: boolean): string {
  if (typeof long === "number") {
    return String(long);
  }

  return signed
    ? signedDecimal(long.low, long.high)
    : unsignedDecimal(long.low >>> 0, long.high >>> 0);
}

/*
 * A bytes field in base64, as protobufjs' reader slices it and toObject
 * encodes it (with padding, the standard alphabet), but without the slice.
 */
function readBytesAsBase64(reader: protobuf.Reader): string {
  const length: number = reader.uint32();
  const start: number = reader.pos;
  const end: number = start + length;

  if (end > reader.len) {
    throw indexOutOfRange(reader, length);
  }

  reader.pos = end;

  if (start === end) {
    return "";
  }

  const buf: Uint8Array = reader.buf;

  if (Buffer.isBuffer(buf)) {
    return buf.toString("base64", start, end);
  }

  return Buffer.from(buf.buffer, buf.byteOffset + start, length).toString(
    "base64",
  );
}

function jsonNumber(value: number): number | string {
  return Number.isFinite(value) ? value : String(value);
}

// One value of a scalar or enum field, as toObject writes it.
function readScalar(
  reader: protobuf.Reader,
  field: CompiledField,
): string | number | boolean {
  switch (field.kind) {
    case Kind.String:
      return reader.string();
    case Kind.Bytes:
      return readBytesAsBase64(reader);
    case Kind.Bool:
      return reader.bool();
    case Kind.Enum: {
      const value: number = reader.int32();
      const name: string | undefined = field.enumNames![value];
      return name === undefined ? value : name;
    }
    case Kind.Int32:
      return reader.int32();
    case Kind.Uint32:
      return reader.uint32();
    case Kind.Sint32:
      return reader.sint32();
    case Kind.Fixed32:
      return reader.fixed32();
    case Kind.Sfixed32:
      return reader.sfixed32();
    case Kind.Int64:
      return longDecimal(reader.int64() as unknown as LongLike, true);
    case Kind.Uint64:
      return longDecimal(reader.uint64() as unknown as LongLike, false);
    case Kind.Sint64:
      return longDecimal(reader.sint64() as unknown as LongLike, true);
    case Kind.Fixed64:
      return readFixed64(reader, false);
    case Kind.Sfixed64:
      return readFixed64(reader, true);
    case Kind.Double:
      return jsonNumber(reader.double());
    case Kind.Float:
      return jsonNumber(reader.float());
    default:
      throw new Error(`OtlpWireDecoder: no reader for field ${field.name}`);
  }
}

// Keys back in field-number order, for a message written out of it.
function inFieldOrder(type: CompiledType, message: JSONObject): JSONObject {
  const ordered: JSONObject = {};

  for (const field of type.ordered) {
    if (Object.prototype.hasOwnProperty.call(message, field.name)) {
      ordered[field.name] = message[field.name]!;
    }
  }

  return ordered;
}

function decodeMessage(
  reader: protobuf.Reader,
  type: CompiledType,
  length: number | undefined,
  depth: number,
): JSONObject {
  if (depth > protobuf.Reader.recursionLimit) {
    throw Error("maximum nesting depth exceeded");
  }

  let end: number;
  let outerLen: number = reader.len;

  if (length === undefined) {
    end = reader.len;
  } else {
    end = reader.pos + length;

    if (end > reader.len) {
      throw RangeError("index out of range");
    }

    outerLen = reader.len;
    reader.len = end;
  }

  const message: JSONObject = {};
  // The highest field number written so far; a lower one means out of order.
  let lastId: number = 0;
  let outOfOrder: boolean = false;

  while (reader.pos < end) {
    const tag: number = reader.uint32();
    const field: CompiledField | undefined = type.fieldsById[tag >>> 3];

    if (field === undefined) {
      reader.skipType(tag & 7, depth);
      continue;
    }

    const isNew: boolean = !Object.prototype.hasOwnProperty.call(
      message,
      field.name,
    );

    if (!field.repeated) {
      if (isNew) {
        if (field.id < lastId) {
          outOfOrder = true;
        } else {
          lastId = field.id;
        }
      }

      message[field.name] =
        field.kind === Kind.Message
          ? decodeMessage(reader, field.message!, reader.uint32(), depth + 1)
          : readScalar(reader, field);
      continue;
    }

    let values: Array<unknown> | undefined = isNew
      ? undefined
      : (message[field.name] as unknown as Array<unknown>);

    if (field.packable && (tag & 7) === 2) {
      const runEnd: number = reader.uint32() + reader.pos;

      if (runEnd > reader.len) {
        throw RangeError("index out of range");
      }

      reader.len = runEnd;

      while (reader.pos < runEnd) {
        const value: string | number | boolean = readScalar(reader, field);

        if (values === undefined) {
          values = [];
          message[field.name] = values as never;

          if (field.id < lastId) {
            outOfOrder = true;
          } else {
            lastId = field.id;
          }
        }

        values.push(value);
      }

      if (reader.pos !== runEnd) {
        throw RangeError("index out of range");
      }

      reader.len = end;
      continue;
    }

    const value: unknown =
      field.kind === Kind.Message
        ? decodeMessage(reader, field.message!, reader.uint32(), depth + 1)
        : readScalar(reader, field);

    if (values === undefined) {
      values = [];
      message[field.name] = values as never;

      if (field.id < lastId) {
        outOfOrder = true;
      } else {
        lastId = field.id;
      }
    }

    values.push(value);
  }

  if (length !== undefined) {
    if (reader.pos !== end) {
      throw RangeError("index out of range");
    }

    reader.len = outerLen;
  }

  return outOfOrder ? inFieldOrder(type, message) : message;
}

function readerFor(body: Uint8Array): protobuf.Reader {
  return protobuf.Reader.create(body);
}

export default class OtlpWireDecoder {
  /*
   * Whether `type` can be read here: every OTLP message type can. A type
   * that cannot (a map field, say, in some later proto) is decoded by
   * protobufjs instead - see decode below.
   */
  public static supports(type: protobuf.Type): boolean {
    try {
      compile(type);
      return true;
    } catch {
      return false;
    }
  }

  /*
   * `body` as `type.decode(body).toJSON()` returns it: the plain object the
   * ingest services read.
   */
  public static decode(type: protobuf.Type, body: Uint8Array): JSONObject {
    if (!OtlpWireDecoder.supports(type)) {
      return type.decode(body).toJSON() as JSONObject;
    }

    return decodeMessage(readerFor(body), compile(type), undefined, 0);
  }

  /*
   * Length-delimited messages, one after another, each as
   * `type.decodeDelimited(reader).toJSON()` returns it.
   */
  public static decodeAllDelimited(
    type: protobuf.Type,
    body: Uint8Array,
  ): Array<JSONObject> {
    const reader: protobuf.Reader = readerFor(body);
    const messages: Array<JSONObject> = [];

    if (!OtlpWireDecoder.supports(type)) {
      while (reader.pos < reader.len) {
        messages.push(type.decodeDelimited(reader).toJSON() as JSONObject);
      }
      return messages;
    }

    const compiledType: CompiledType = compile(type);

    while (reader.pos < reader.len) {
      messages.push(decodeMessage(reader, compiledType, reader.uint32(), 0));
    }

    return messages;
  }
}

import protobuf from "protobufjs";

/*
 * HOW MANY OBJECTS A PROTOBUF BODY WILL BECOME, COUNTED BEFORE IT IS
 * DECODED.
 *
 * A protobuf decoder makes an object for every embedded message and an
 * array entry for every repeated value it reads, and a message can be two
 * bytes long: a snappy body of a megabyte or two that decompresses to
 * 32 MiB of empty Prometheus series would become sixteen million objects,
 * gigabytes of memory, and seconds of a blocked event loop. So a body is
 * walked once first, on its wire format alone - no object, no copy - and
 * every message and repeated value the schema below would decode into one
 * is counted. The walk stops as soon as the count passes the limit.
 *
 * Only what a decoder allocates is counted: a known embedded message, each
 * value of a repeated number field (packed or not) and each string of a
 * repeated string field. Unknown fields, and scalars and strings of a
 * message's own, are stepped over: a decoder skips or keeps them inside
 * the object already counted.
 */

export interface ProtobufCountSchema {
  // Embedded message fields, by field number: each one read is counted.
  messages?: Readonly<Record<number, ProtobufCountSchema>> | undefined;
  // Repeated varint fields (int, uint, sint, enum), packed or not.
  varints?: ReadonlySet<number> | undefined;
  // Repeated 64-bit fields (double, fixed64), packed or not.
  fixed64s?: ReadonlySet<number> | undefined;
  // Repeated string or bytes fields.
  strings?: ReadonlySet<number> | undefined;
}

export enum ProtobufElementCountOutcome {
  Counted = "counted",
  // More elements than the limit: the walk stopped there.
  OverLimit = "over-limit",
  // The bytes are not a valid encoding of the schema's message.
  Malformed = "malformed",
}

export interface ProtobufElementCount {
  outcome: ProtobufElementCountOutcome;
  // How many were counted (when over the limit, how many before the stop).
  elements: number;
}

const WIRE_VARINT: number = 0;
const WIRE_FIXED64: number = 1;
const WIRE_LENGTH_DELIMITED: number = 2;
const WIRE_FIXED32: number = 5;

class OverLimit extends Error {}
class Malformed extends Error {}

export default class ProtobufElementCounter {
  public static count(
    body: Uint8Array,
    schema: ProtobufCountSchema,
    limit: number,
  ): ProtobufElementCount {
    const counter: { elements: number } = { elements: 0 };

    try {
      const reader: protobuf.Reader = protobuf.Reader.create(body);
      ProtobufElementCounter.walk(reader, body.length, schema, counter, limit);
    } catch (error) {
      if (error instanceof OverLimit) {
        return {
          outcome: ProtobufElementCountOutcome.OverLimit,
          elements: counter.elements,
        };
      }

      // A Malformed of ours, or protobufjs' RangeError past the end.
      return {
        outcome: ProtobufElementCountOutcome.Malformed,
        elements: counter.elements,
      };
    }

    return {
      outcome: ProtobufElementCountOutcome.Counted,
      elements: counter.elements,
    };
  }

  private static add(
    counter: { elements: number },
    amount: number,
    limit: number,
  ): void {
    counter.elements += amount;

    if (counter.elements > limit) {
      throw new OverLimit();
    }
  }

  // One message's fields, from the reader's position up to `end`.
  private static walk(
    reader: protobuf.Reader,
    end: number,
    schema: ProtobufCountSchema,
    counter: { elements: number },
    limit: number,
  ): void {
    while (reader.pos < end) {
      const tag: number = reader.uint32();
      const field: number = tag >>> 3;
      const wireType: number = tag & 7;

      if (field === 0) {
        throw new Malformed();
      }

      const message: ProtobufCountSchema | undefined = schema.messages?.[field];

      if (message) {
        if (wireType !== WIRE_LENGTH_DELIMITED) {
          throw new Malformed();
        }

        const length: number = reader.uint32();
        const messageEnd: number = reader.pos + length;

        if (messageEnd > end) {
          throw new Malformed();
        }

        ProtobufElementCounter.add(counter, 1, limit);
        ProtobufElementCounter.walk(reader, messageEnd, message, counter, limit);

        if (reader.pos !== messageEnd) {
          throw new Malformed();
        }

        continue;
      }

      if (schema.varints?.has(field)) {
        if (wireType === WIRE_VARINT) {
          reader.skipType(WIRE_VARINT);
          ProtobufElementCounter.add(counter, 1, limit);
          continue;
        }

        if (wireType !== WIRE_LENGTH_DELIMITED) {
          throw new Malformed();
        }

        // Packed: one varint after another, up to the length.
        const length: number = reader.uint32();
        const packedEnd: number = reader.pos + length;

        if (packedEnd > end) {
          throw new Malformed();
        }

        while (reader.pos < packedEnd) {
          reader.skipType(WIRE_VARINT);
          ProtobufElementCounter.add(counter, 1, limit);
        }

        if (reader.pos !== packedEnd) {
          throw new Malformed();
        }

        continue;
      }

      if (schema.fixed64s?.has(field)) {
        if (wireType === WIRE_FIXED64) {
          reader.skip(8);
          ProtobufElementCounter.add(counter, 1, limit);
          continue;
        }

        if (wireType !== WIRE_LENGTH_DELIMITED) {
          throw new Malformed();
        }

        const length: number = reader.uint32();

        if (length % 8 !== 0 || reader.pos + length > end) {
          throw new Malformed();
        }

        ProtobufElementCounter.add(counter, length / 8, limit);
        reader.skip(length);
        continue;
      }

      if (schema.strings?.has(field)) {
        if (wireType !== WIRE_LENGTH_DELIMITED) {
          throw new Malformed();
        }

        const length: number = reader.uint32();

        if (reader.pos + length > end) {
          throw new Malformed();
        }

        ProtobufElementCounter.add(counter, 1, limit);
        reader.skip(length);
        continue;
      }

      // A field the schema does not decode into anything of its own.
      if (
        wireType !== WIRE_VARINT &&
        wireType !== WIRE_FIXED64 &&
        wireType !== WIRE_LENGTH_DELIMITED &&
        wireType !== WIRE_FIXED32
      ) {
        // Groups (3, 4) are proto2's; nothing here sends them.
        throw new Malformed();
      }

      if (wireType === WIRE_LENGTH_DELIMITED) {
        const length: number = reader.uint32();

        if (reader.pos + length > end) {
          throw new Malformed();
        }

        reader.skip(length);
        continue;
      }

      reader.skipType(wireType);
    }

    if (reader.pos > end) {
      throw new Malformed();
    }
  }
}

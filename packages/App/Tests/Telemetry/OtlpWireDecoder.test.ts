import protobuf from "protobufjs";
import path from "path";
import OtlpWireDecoder, {
  signedDecimal,
  unsignedDecimal,
} from "../../FeatureSet/Telemetry/Utils/OtlpWireDecoder";
import {
  OtlpSignal,
  otlpRootType,
  otlpShapes,
  toProtobuf,
} from "./Helpers/OtlpShapeFixtures";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * ---------------------------------------------------------------------------
 * OtlpWireDecoder READS WHAT protobufjs READS (#6086).
 *
 * The decoder replaces `type.decode(body).toJSON()` on every OTLP/HTTP
 * protobuf body, so what it returns must be that object exactly: the same
 * keys, in the same order (JSON.stringify of a log body or a scope lands in
 * stored rows), and the same values. Here it is held to protobufjs itself:
 *
 *   - over every OTLP shape the ingest fixtures send;
 *   - over thousands of messages generated from the protos' own reflection,
 *     written the way no SDK writes them on purpose: fields shuffled out of
 *     order, singular fields repeated, unknown fields of every wire type,
 *     packed and unpacked runs mixed, enum numbers with no name, 64-bit
 *     integers at every edge, NaN and infinities, invalid UTF-8;
 *   - over those messages corrupted - truncated, bytes flipped, bytes
 *     inserted - where it must fail exactly when protobufjs fails, with the
 *     same error, and read the same object when protobufjs reads one;
 *   - at protobufjs' nesting limit.
 * ---------------------------------------------------------------------------
 */

const PROTO_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Telemetry/ProtoFiles/OTel/v1",
);

const profilesRoot: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "profiles.proto"),
);

const ROOT_TYPES: Array<protobuf.Type> = [
  otlpRootType("logs"),
  otlpRootType("traces"),
  otlpRootType("metrics"),
  profilesRoot.lookupType("ProfilesData"),
];

// Draws from the shared seeded generator: the same messages on every run.
type Random = () => number;

function int(random: Random, below: number): number {
  return Math.floor(random() * below);
}

function pick<T>(random: Random, items: ReadonlyArray<T>): T {
  return items[int(random, items.length)]!;
}

// long.js, as protobufjs loads it.
interface LongValue {
  toString(): string;
}

interface LongStatic {
  fromBits(low: number, high: number, unsigned: boolean): LongValue;
}

const Long: LongStatic = protobuf.util.Long as unknown as LongStatic;

// BigInt(), not literals: the tests compile for a target before ES2020.
const HALF_BITS: bigint = BigInt(32);
const LOW_HALF: bigint = BigInt(0xffffffff);

const EDGE_HALVES: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0xffffffff, 0],
  [0, 1],
  [0xffffffff, 0x1fffff],
  [0, 0x200000],
  [1, 0x200000],
  [0xffffffff, 0x7fffffff],
  [0, 0x80000000],
  [1, 0x80000000],
  [0xffffffff, 0xffffffff],
  [0xfffffffe, 0xffffffff],
  // 1792231872345678901, a nanosecond time.
  [
    Number(BigInt("1792231872345678901") & LOW_HALF),
    Number(BigInt("1792231872345678901") >> HALF_BITS),
  ],
];

function randomHalves(random: Random): [number, number] {
  if (random() < 0.3) {
    return pick(random, EDGE_HALVES);
  }
  return [int(random, 4294967296), int(random, 4294967296)];
}

function randomString(random: Random): string {
  const pieces: Array<string> = [
    "",
    "a",
    "service.name",
    "naïve",
    "日本語",
    "🚀",
    // U+2028, the line separator (written so: a formatter unescapes it).
    String.fromCharCode(0x2028),
    '"',
    "\\",
    "\n",
    "\u0000",
    "x".repeat(200),
  ];
  let text: string = "";
  const count: number = int(random, 4);
  for (let i: number = 0; i < count; i++) {
    text += pick(random, pieces);
  }
  return text;
}

function randomDouble(random: Random): number {
  return pick(random, [
    0,
    -0,
    1,
    -1.5,
    3.25,
    1e300,
    -1e-300,
    5e-324,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    random() * 1e6,
  ]);
}

const PACKED_WIRE: number = 2;

function wireTypeOf(field: protobuf.Field): number {
  if (field.resolvedType instanceof protobuf.Type) {
    return 2;
  }
  if (field.resolvedType instanceof protobuf.Enum) {
    return 0;
  }
  switch (field.type) {
    case "double":
    case "fixed64":
    case "sfixed64":
      return 1;
    case "float":
    case "fixed32":
    case "sfixed32":
      return 5;
    case "string":
    case "bytes":
      return 2;
    default:
      return 0;
  }
}

// One value of `field`'s scalar or enum type, written as the wire carries it.
function writeScalar(
  writer: protobuf.Writer,
  field: protobuf.Field,
  random: Random,
): void {
  if (field.resolvedType instanceof protobuf.Enum) {
    const known: Array<number> = Object.values(
      field.resolvedType.values,
    ) as Array<number>;
    writer.int32(
      random() < 0.75
        ? pick(random, known)
        : pick(random, [7, 99, -1, 1 << 30]),
    );
    return;
  }

  const [low, high] = randomHalves(random);

  switch (field.type) {
    case "string":
      if (random() < 0.05) {
        // Not UTF-8: read with replacement characters by both.
        writer.bytes(Buffer.from([0xff, 0xfe, 0x41, 0xc3]));
      } else {
        writer.string(randomString(random));
      }
      return;
    case "bytes":
      writer.bytes(
        Buffer.from(
          Array.from({ length: int(random, 20) }, () => {
            return int(random, 256);
          }),
        ),
      );
      return;
    case "bool":
      // A bool is any varint; non-zero is true.
      writer.uint32(pick(random, [0, 1, 2, 300]));
      return;
    case "int32":
      writer.int32(pick(random, [0, 1, -1, 2147483647, -2147483648, low | 0]));
      return;
    case "uint32":
      writer.uint32(pick(random, [0, 1, 4294967295, low]));
      return;
    case "sint32":
      writer.sint32(pick(random, [0, 1, -1, -2147483648, low | 0]));
      return;
    case "fixed32":
      writer.fixed32(low);
      return;
    case "sfixed32":
      writer.sfixed32(low | 0);
      return;
    case "int64":
      writer.int64(Long.fromBits(low, high, false) as never);
      return;
    case "uint64":
      writer.uint64(Long.fromBits(low, high, true) as never);
      return;
    case "sint64":
      writer.sint64(Long.fromBits(low, high, false) as never);
      return;
    case "fixed64":
      writer.fixed64(Long.fromBits(low, high, true) as never);
      return;
    case "sfixed64":
      writer.sfixed64(Long.fromBits(low, high, false) as never);
      return;
    case "double":
      writer.double(randomDouble(random));
      return;
    case "float":
      writer.float(randomDouble(random));
      return;
    default:
      throw new Error(`no writer for ${field.type}`);
  }
}

function writeUnknownField(
  writer: protobuf.Writer,
  type: protobuf.Type,
  random: Random,
): void {
  let id: number = 1 + int(random, 40);
  while (type.fieldsById[id]) {
    id++;
  }

  const wireType: number = pick(random, [0, 1, 2, 3, 5]);

  writer.uint32(((id << 3) | wireType) >>> 0);

  switch (wireType) {
    case 0:
      writer.uint64(
        Long.fromBits(
          int(random, 4294967296),
          int(random, 4294967296),
          true,
        ) as never,
      );
      return;
    case 1:
      writer.fixed64(Long.fromBits(1, 2, true) as never);
      return;
    case 2:
      writer.bytes(Buffer.from(randomString(random)));
      return;
    case 3:
      // A group with one varint inside, closed by its end tag.
      writer.uint32(((1 << 3) | 0) >>> 0).uint32(5);
      writer.uint32(((id << 3) | 4) >>> 0);
      return;
    default:
      writer.fixed32(7);
  }
}

/*
 * A message of `type`, written field by field: in field order or shuffled,
 * with unknown fields among them, singular fields sometimes twice, repeated
 * scalars packed, unpacked or both.
 */
function writeMessage(
  writer: protobuf.Writer,
  type: protobuf.Type,
  random: Random,
  depth: number,
): void {
  type.resolveAll();
  const entries: Array<() => void> = [];

  for (const field of type.fieldsArray) {
    if (random() < 0.35) {
      continue;
    }

    const isMessage: boolean = field.resolvedType instanceof protobuf.Type;

    if (isMessage && depth > 5) {
      continue;
    }

    const times: number = field.repeated
      ? int(random, 4)
      : random() < 0.1
        ? 2
        : 1;

    if (
      field.repeated &&
      !isMessage &&
      field.type !== "string" &&
      field.type !== "bytes" &&
      random() < 0.6
    ) {
      // A packed run, sometimes empty, sometimes beside unpacked values.
      entries.push(() => {
        writer.uint32(((field.id << 3) | PACKED_WIRE) >>> 0).fork();
        for (let i: number = 0; i < times; i++) {
          writeScalar(writer, field, random);
        }
        writer.ldelim();
      });
      if (random() < 0.3) {
        entries.push(() => {
          writer.uint32(((field.id << 3) | wireTypeOf(field)) >>> 0);
          writeScalar(writer, field, random);
        });
      }
      continue;
    }

    for (let i: number = 0; i < times; i++) {
      entries.push(() => {
        writer.uint32(((field.id << 3) | wireTypeOf(field)) >>> 0);
        if (isMessage) {
          writer.fork();
          writeMessage(
            writer,
            field.resolvedType as protobuf.Type,
            random,
            depth + 1,
          );
          writer.ldelim();
        } else {
          writeScalar(writer, field, random);
        }
      });
    }
  }

  const unknown: number = random() < 0.3 ? int(random, 3) + 1 : 0;
  for (let i: number = 0; i < unknown; i++) {
    entries.push(() => {
      writeUnknownField(writer, type, random);
    });
  }

  if (random() < 0.4) {
    for (let i: number = entries.length - 1; i > 0; i--) {
      const j: number = int(random, i + 1);
      const swap: () => void = entries[i]!;
      entries[i] = entries[j]!;
      entries[j] = swap;
    }
  }

  for (const entry of entries) {
    entry();
  }
}

function generate(type: protobuf.Type, random: Random): Buffer {
  const writer: protobuf.Writer = protobuf.Writer.create();
  writeMessage(writer, type, random, 0);
  return Buffer.from(writer.finish());
}

interface Outcome {
  json?: string;
  value?: JSONObject;
  error?: string;
}

function referenceOf(type: protobuf.Type, body: Buffer): Outcome {
  try {
    const value: JSONObject = type.decode(body).toJSON() as JSONObject;
    return { json: JSON.stringify(value), value: value };
  } catch (error) {
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

function fastOf(type: protobuf.Type, body: Buffer): Outcome {
  try {
    const value: JSONObject = OtlpWireDecoder.decode(type, body);
    return { json: JSON.stringify(value), value: value };
  } catch (error) {
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

function expectSame(type: protobuf.Type, body: Buffer): Outcome {
  const reference: Outcome = referenceOf(type, body);
  const fast: Outcome = fastOf(type, body);

  // Same keys in the same order, same values; or the same failure.
  expect(fast.error).toBe(reference.error);
  expect(fast.json).toBe(reference.json);
  expect(fast.value).toEqual(reference.value);

  return reference;
}

// Every message type the four roots reach.
function allTypes(): Array<protobuf.Type> {
  const seen: Set<protobuf.Type> = new Set();
  const visit: (type: protobuf.Type) => void = (type: protobuf.Type) => {
    if (seen.has(type)) {
      return;
    }
    seen.add(type);
    type.resolveAll();
    for (const field of type.fieldsArray) {
      if (field.resolvedType instanceof protobuf.Type) {
        visit(field.resolvedType);
      }
    }
  };
  for (const root of ROOT_TYPES) {
    visit(root);
  }
  return Array.from(seen);
}

describe("OtlpWireDecoder reads every OTLP shape as protobufjs does", () => {
  for (const signal of ["logs", "traces", "metrics"] as Array<OtlpSignal>) {
    test(`the ${signal} fixtures`, () => {
      const type: protobuf.Type = otlpRootType(signal);
      const body: Buffer = toProtobuf(signal, otlpShapes(signal));
      const outcome: Outcome = expectSame(type, body);

      expect(outcome.error).toBeUndefined();
      expect(outcome.json!.length).toBeGreaterThan(1000);
    });
  }

  test("every message type is read here, none handed back to protobufjs", () => {
    const types: Array<protobuf.Type> = allTypes();

    expect(types.length).toBeGreaterThan(30);

    for (const type of types) {
      expect([type.fullName, OtlpWireDecoder.supports(type)]).toEqual([
        type.fullName,
        true,
      ]);
    }
  });

  test("an empty body is an empty object", () => {
    for (const type of ROOT_TYPES) {
      expect(OtlpWireDecoder.decode(type, Buffer.alloc(0))).toEqual({});
    }
  });
});

describe("OtlpWireDecoder over generated messages", () => {
  for (const root of ROOT_TYPES) {
    test(`${root.name}: 400 messages, any field order, unknown fields, duplicates`, () => {
      const random: Random = seededRandom(0x5eed + root.name.length);
      let decoded: number = 0;

      for (let i: number = 0; i < 400; i++) {
        const outcome: Outcome = expectSame(root, generate(root, random));
        if (!outcome.error) {
          decoded++;
        }
      }

      // The generator writes valid messages: every one decodes.
      expect(decoded).toBe(400);
    });
  }

  test("every message type on its own, 150 messages each", () => {
    const random: Random = seededRandom(0xabc);

    for (const type of allTypes()) {
      for (let i: number = 0; i < 150; i++) {
        const outcome: Outcome = expectSame(type, generate(type, random));
        expect(outcome.error).toBeUndefined();
      }
    }
  });

  test("corrupted bodies fail where protobufjs fails, with its error, and read the same otherwise", () => {
    const random: Random = seededRandom(0xbad);
    let failed: number = 0;
    let read: number = 0;

    for (let i: number = 0; i < 1500; i++) {
      const type: protobuf.Type = pick(random, ROOT_TYPES);
      const body: Buffer = generate(type, random);

      if (body.length === 0) {
        continue;
      }

      const corrupted: Buffer = Buffer.from(body);
      const mode: number = int(random, 3);

      let mutated: Buffer;
      if (mode === 0) {
        mutated = corrupted.subarray(0, int(random, corrupted.length));
      } else if (mode === 1) {
        for (let flips: number = 0; flips < 1 + int(random, 3); flips++) {
          corrupted[int(random, corrupted.length)] = int(random, 256);
        }
        mutated = corrupted;
      } else {
        const at: number = int(random, corrupted.length);
        mutated = Buffer.concat([
          corrupted.subarray(0, at),
          Buffer.from([int(random, 256), int(random, 256)]),
          corrupted.subarray(at),
        ]);
      }

      const outcome: Outcome = expectSame(type, mutated);
      if (outcome.error) {
        failed++;
      } else {
        read++;
      }
    }

    // Both kinds of outcome were exercised.
    expect(failed).toBeGreaterThan(100);
    expect(read).toBeGreaterThan(100);
  });
});

describe("OtlpWireDecoder at protobufjs' nesting limit", () => {
  const anyValue: protobuf.Type = otlpRootType("logs").lookupType(
    "opentelemetry.proto.common.v1.AnyValue",
  );

  /*
   * An AnyValue holding arrays `levels` deep (each array one message level,
   * each value in it another), around `innermost` - the bytes of the last
   * AnyValue - or, with `innermost` null, around an empty last array.
   */
  function nested(levels: number, innermost: Buffer | null): Buffer {
    let inner: Buffer | null = innermost;

    for (let i: number = 0; i < levels; i++) {
      const array: protobuf.Writer = protobuf.Writer.create();
      if (inner !== null) {
        array.uint32((1 << 3) | 2).bytes(inner);
      }
      inner = Buffer.from(
        protobuf.Writer.create()
          .uint32((5 << 3) | 2)
          .bytes(array.finish())
          .finish(),
      );
    }

    return inner!;
  }

  const DEEP: Buffer = Buffer.from(
    anyValue.encode(anyValue.fromObject({ stringValue: "deep" })).finish(),
  );

  test.each([10, 49, 50, 51, 60])("%i arrays deep", (levels: number) => {
    expectSame(anyValue, nested(levels, DEEP));
  });

  test("past the limit both fail", () => {
    const outcome: Outcome = expectSame(anyValue, nested(51, DEEP));
    expect(outcome.error).toBe("Error: maximum nesting depth exceeded");
  });

  test("an empty array exactly at the limit is read; one level past it fails", () => {
    // The last (empty) array of 50 sits at depth 99, of 51 at depth 101.
    const inside: Outcome = expectSame(anyValue, nested(50, null));
    expect(inside.error).toBeUndefined();

    const past: Outcome = expectSame(anyValue, nested(51, null));
    expect(past.error).toBe("Error: maximum nesting depth exceeded");
  });

  test("an unknown group at the deepest level is skipped at that depth, so it fails there as protobufjs does", () => {
    const withGroup: (levels: number) => Buffer = (levels: number): Buffer => {
      // An AnyValue holding only an unknown field 15, a group of one varint.
      const unknownGroup: Buffer = Buffer.from(
        protobuf.Writer.create()
          .uint32((15 << 3) | 3)
          .uint32((1 << 3) | 0)
          .uint32(7)
          .uint32((15 << 3) | 4)
          .finish(),
      );
      return nested(levels, unknownGroup);
    };

    // The group's AnyValue at depth 98: read. At depth 100: its varint at 101.
    expect(expectSame(anyValue, withGroup(49)).error).toBeUndefined();
    expect(expectSame(anyValue, withGroup(50)).error).toBe(
      "Error: maximum nesting depth exceeded",
    );
  });
});

describe("OtlpWireDecoder.decodeAllDelimited", () => {
  test("reads length-delimited messages as decodeDelimited does", () => {
    const metrics: protobuf.Type = otlpRootType("metrics");
    const random: Random = seededRandom(42);
    const writer: protobuf.Writer = protobuf.Writer.create();

    for (let i: number = 0; i < 20; i++) {
      writer.bytes(generate(metrics, random));
    }

    const body: Buffer = Buffer.from(writer.finish());
    const reference: Array<JSONObject> = [];
    const reader: protobuf.Reader = protobuf.Reader.create(body);

    while (reader.pos < reader.len) {
      reference.push(metrics.decodeDelimited(reader).toJSON() as JSONObject);
    }

    const fast: Array<JSONObject> = OtlpWireDecoder.decodeAllDelimited(
      metrics,
      body,
    );

    expect(JSON.stringify(fast)).toBe(JSON.stringify(reference));
    expect(fast).toHaveLength(20);
  });
});

describe("64-bit integers in decimal, without long.js", () => {
  function bigUnsigned(low: number, high: number): string {
    return ((BigInt(high) << HALF_BITS) | BigInt(low)).toString();
  }

  function bigSigned(low: number, high: number): string {
    return BigInt.asIntN(
      64,
      (BigInt(high) << HALF_BITS) | BigInt(low),
    ).toString();
  }

  test("every edge, and 20,000 random values, as BigInt and long.js write them", () => {
    const random: Random = seededRandom(7);
    const values: Array<[number, number]> = [...EDGE_HALVES];

    for (let i: number = 0; i < 20000; i++) {
      values.push([int(random, 4294967296), int(random, 4294967296)]);
    }
    // Around 2^53, where a double stops holding every integer.
    for (let low: number = 0xfffffff0; low <= 0xffffffff; low++) {
      values.push([low, 0x1fffff]);
    }
    for (let low: number = 0; low < 16; low++) {
      values.push([low, 0x200000]);
    }

    for (const [low, high] of values) {
      expect(unsignedDecimal(low, high)).toBe(bigUnsigned(low, high));
      expect(signedDecimal(low | 0, high | 0)).toBe(bigSigned(low, high));
      expect(unsignedDecimal(low, high)).toBe(
        Long.fromBits(low, high, true).toString(),
      );
      expect(signedDecimal(low | 0, high | 0)).toBe(
        Long.fromBits(low, high, false).toString(),
      );
    }
  });
});

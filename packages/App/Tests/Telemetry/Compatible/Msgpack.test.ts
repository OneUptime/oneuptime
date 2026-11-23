import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import Msgpack, {
  MSGPACK_MAX_DEPTH,
  MsgpackDecodeError,
  MsgpackElementCount,
  MsgpackElementCountOutcome,
  MsgpackValue,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/Msgpack";
import {
  Encodable,
  Float32,
  Int64,
  Raw,
  encodeMsgpack,
} from "./MsgpackTestEncoder";

/*
 * MessagePack as a Datadog tracer writes it, counted before it is decoded:
 * a byte can be an empty array, so a tracer's /v0.4 and /v0.5 bodies are
 * walked first and refused over the limit before anything is made of them.
 * The count must equal the values the decoder makes - checked over
 * generated documents - and the decoder must read every form the
 * specification has, 64-bit IDs to the last digit.
 */

const MIB: number = 1024 * 1024;

const count: (body: Buffer, limit?: number) => MsgpackElementCount = (
  body: Buffer,
  limit?: number,
): MsgpackElementCount => {
  return Msgpack.count(body, limit ?? Number.MAX_SAFE_INTEGER);
};

// What the decoder made of a body: every value, a map's keys too.
const decodedValues: (value: MsgpackValue) => number = (
  value: MsgpackValue,
): number => {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item: MsgpackValue): number => {
      return sum + decodedValues(item);
    }, 1);
  }

  if (value instanceof Map) {
    let sum: number = 1;

    for (const [key, item] of value) {
      sum += decodedValues(key) + decodedValues(item);
    }

    return sum;
  }

  return 1;
};

const generate: (next: () => number, depth: number) => Encodable = (
  next: () => number,
  depth: number,
): Encodable => {
  const kind: number = Math.floor(next() * (depth > 3 ? 7 : 9));

  switch (kind) {
    case 0:
      return null;
    case 1:
      return next() > 0.5;
    case 2:
      return Math.floor((next() - 0.5) * 2 ** (1 + Math.floor(next() * 40)));
    case 3:
      return next() * 1000;
    case 4:
      return BigInt(Math.floor(next() * 2 ** 31)) * BigInt(2 ** 31);
    case 5:
      return "x".repeat(Math.floor(next() * 300));
    case 6:
      return Buffer.alloc(Math.floor(next() * 40), 7);
    case 7: {
      const items: Array<Encodable> = [];
      const length: number = Math.floor(next() * 20);

      for (let index: number = 0; index < length; index++) {
        items.push(generate(next, depth + 1));
      }

      return items;
    }
    default: {
      const map: Map<Encodable, Encodable> = new Map<Encodable, Encodable>();
      const length: number = Math.floor(next() * 20);

      for (let index: number = 0; index < length; index++) {
        map.set(
          next() > 0.7 ? index : `key-${index}`,
          generate(next, depth + 1),
        );
      }

      return map;
    }
  }
};

describe("Msgpack.decode", () => {
  test("reads every integer form, 64-bit ones as bigints", () => {
    const cases: Array<[Buffer, MsgpackValue]> = [
      [Buffer.from([0x00]), 0],
      [Buffer.from([0x7f]), 127],
      [Buffer.from([0xff]), -1],
      [Buffer.from([0xe0]), -32],
      [Buffer.from([0xcc, 0xff]), 255],
      [Buffer.from([0xcd, 0xff, 0xff]), 65535],
      [Buffer.from([0xce, 0xff, 0xff, 0xff, 0xff]), 4294967295],
      [
        Buffer.from([0xcf, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        BigInt("18446744073709551615"),
      ],
      [Buffer.from([0xd0, 0x80]), -128],
      [Buffer.from([0xd1, 0x80, 0x00]), -32768],
      [Buffer.from([0xd2, 0x80, 0x00, 0x00, 0x00]), -2147483648],
      [
        Buffer.from([0xd3, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
        BigInt("-9223372036854775808"),
      ],
    ];

    for (const [body, expected] of cases) {
      expect(count(body).outcome).toBe(MsgpackElementCountOutcome.Counted);
      expect(Msgpack.decode(body)).toEqual(expected);
    }
  });

  test("reads nil, booleans, floats, strings and binaries of every width", () => {
    expect(Msgpack.decode(Buffer.from([0xc0]))).toBeNull();
    expect(Msgpack.decode(Buffer.from([0xc2]))).toBe(false);
    expect(Msgpack.decode(Buffer.from([0xc3]))).toBe(true);
    expect(Msgpack.decode(encodeMsgpack(new Float32(1.5)))).toBe(1.5);
    expect(Msgpack.decode(encodeMsgpack(0.1))).toBe(0.1);

    for (const length of [0, 31, 32, 255, 256, 65535, 65536]) {
      const text: string = "é".repeat(Math.ceil(length / 2)).slice(0, length);
      expect(Msgpack.decode(encodeMsgpack(text))).toBe(text);

      const bytes: Buffer = Buffer.alloc(length, 3);
      expect(Msgpack.decode(encodeMsgpack(bytes))).toEqual(bytes);
    }
  });

  test("reads arrays and maps of every width, a map's keys of any type", () => {
    for (const length of [0, 15, 16, 65535, 65536]) {
      const items: Array<Encodable> = new Array(length).fill(1);
      const decoded: MsgpackValue = Msgpack.decode(encodeMsgpack(items));
      expect(Array.isArray(decoded) && decoded.length).toBe(length);
    }

    const map: MsgpackValue = Msgpack.decode(
      encodeMsgpack(
        new Map<Encodable, Encodable>([
          [1, "one"],
          ["two", 2],
          [BigInt("18446744073709551615"), true],
        ]),
      ),
    );

    expect(map).toEqual(
      new Map<MsgpackValue, MsgpackValue>([
        [1, "one"],
        ["two", 2],
        [BigInt("18446744073709551615"), true],
      ]),
    );
  });

  test("a key named __proto__ is a key like any other", () => {
    const decoded: MsgpackValue = Msgpack.decode(
      encodeMsgpack({ __proto__: "x", polluted: "y" } as unknown as Encodable),
    );

    expect(decoded instanceof Map).toBe(true);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("a string that is not UTF-8 reads with U+FFFD, as the trace-agent repairs it", () => {
    const body: Buffer = Buffer.from([0xa3, 0x61, 0xff, 0x62]);

    expect(Msgpack.decode(body)).toBe("a�b");
  });

  test("an extension, which no tracer writes, is stepped over as null", () => {
    const body: Buffer = encodeMsgpack([
      new Raw(Buffer.from([0xd4, 0x01, 0x02])),
      new Raw(Buffer.from([0xc7, 0x02, 0x05, 0xaa, 0xbb])),
      "after",
    ]);

    expect(Msgpack.decode(body)).toEqual([null, null, "after"]);
    expect(count(body)).toEqual({
      outcome: MsgpackElementCountOutcome.Counted,
      elements: 4,
    });
  });

  test("reads only the first value, as the trace-agent does", () => {
    const body: Buffer = Buffer.concat([
      encodeMsgpack([1, 2]),
      Buffer.from([0xc1, 0xc1]),
    ]);

    expect(Msgpack.decode(body)).toEqual([1, 2]);
    expect(count(body).outcome).toBe(MsgpackElementCountOutcome.Counted);
  });

  test("refuses what is not MessagePack", () => {
    for (const body of [
      Buffer.from([]),
      Buffer.from([0xc1]),
      Buffer.from([0xcf, 0x01]),
      Buffer.from([0xd9, 0x05, 0x61]),
      Buffer.from([0x92, 0x01]),
    ]) {
      expect(count(body).outcome).toBe(MsgpackElementCountOutcome.Malformed);
      expect(() => {
        return Msgpack.decode(body);
      }).toThrow(MsgpackDecodeError);
    }
  });
});

describe("Msgpack.count", () => {
  test("equals the values the decoder makes, over many generated documents", () => {
    const next: () => number = seededRandom(7);

    for (let run: number = 0; run < 400; run++) {
      const body: Buffer = encodeMsgpack(generate(next, 0));
      const counted: MsgpackElementCount = count(body);

      expect(counted.outcome).toBe(MsgpackElementCountOutcome.Counted);
      expect(counted.elements).toBe(decodedValues(Msgpack.decode(body)));
    }
  });

  test("stops at the first value past the limit", () => {
    const body: Buffer = encodeMsgpack(new Array(1000).fill([]));

    expect(count(body, 1001)).toEqual({
      outcome: MsgpackElementCountOutcome.Counted,
      elements: 1001,
    });
    expect(count(body, 1000)).toEqual({
      outcome: MsgpackElementCountOutcome.OverLimit,
      elements: 1001,
    });
  });

  test("a container that declares more values than there are bytes is malformed at once", () => {
    // An array of four billion values, in five bytes.
    const array: Buffer = Buffer.from([0xdd, 0xff, 0xff, 0xff, 0xff]);
    // A map of four billion entries, then one byte.
    const map: Buffer = Buffer.from([0xdf, 0xff, 0xff, 0xff, 0xff, 0x01]);

    expect(count(array)).toEqual({
      outcome: MsgpackElementCountOutcome.Malformed,
      elements: 1,
    });
    expect(count(map).outcome).toBe(MsgpackElementCountOutcome.Malformed);
  });

  test("a body nested past the decoder's depth is malformed, the decoder refuses it too", () => {
    const deepest: Buffer = Buffer.concat([
      Buffer.alloc(MSGPACK_MAX_DEPTH, 0x91),
      Buffer.from([0x90]),
    ]);
    const tooDeep: Buffer = Buffer.concat([
      Buffer.alloc(MSGPACK_MAX_DEPTH + 1, 0x91),
      Buffer.from([0x90]),
    ]);

    expect(count(deepest).outcome).toBe(MsgpackElementCountOutcome.Counted);
    expect(() => {
      return Msgpack.decode(deepest);
    }).not.toThrow();

    expect(count(tooDeep).outcome).toBe(MsgpackElementCountOutcome.Malformed);
    expect(() => {
      return Msgpack.decode(tooDeep);
    }).toThrow(MsgpackDecodeError);
  });

  test("a million nested arrays end the walk without a stack overflow", () => {
    const body: Buffer = Buffer.alloc(MIB, 0x91);

    expect(count(body).outcome).toBe(MsgpackElementCountOutcome.Malformed);
  });

  test("32 MiB of empty arrays is counted to the limit in well under a second, nothing decoded", () => {
    const body: Buffer = Buffer.concat([
      Buffer.from([0xdd, 0x02, 0x00, 0x00, 0x00]),
      Buffer.alloc(32 * MIB, 0x90),
    ]);
    const timed: FastestRun<MsgpackElementCount> = fastestRun({
      run: (): MsgpackElementCount => {
        return count(body, 1_000_000);
      },
      limitInMs: 1000,
    });

    expect(timed.result).toEqual({
      outcome: MsgpackElementCountOutcome.OverLimit,
      elements: 1_000_001,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });

  test("a large real payload of spans is counted whole, quickly", () => {
    const spans: Array<Encodable> = [];

    for (let index: number = 0; index < 20_000; index++) {
      spans.push({
        service: "checkout",
        name: "flask.request",
        resource: "GET /users/<int:id>",
        trace_id: BigInt("12345678901234567890"),
        span_id: BigInt(index + 1),
        parent_id: 0,
        start: BigInt("1700000000123456789"),
        duration: 1234567,
        error: 0,
        meta: { "http.method": "GET", "http.status_code": "200" },
        metrics: { _sampling_priority_v1: 1 },
        type: "web",
      });
    }

    const body: Buffer = encodeMsgpack([spans]);
    const timed: FastestRun<MsgpackElementCount> = fastestRun({
      run: (): MsgpackElementCount => {
        return count(body);
      },
      limitInMs: 2000,
    });
    const counted: MsgpackElementCount = timed.result;

    expect(counted.outcome).toBe(MsgpackElementCountOutcome.Counted);
    expect(counted.elements).toBe(decodedValues(Msgpack.decode(body)));
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("Msgpack's readers", () => {
  test("an ID is an unsigned 64-bit integer, a negative int64 its two's complement (old JVMs)", () => {
    expect(Msgpack.toUint64(BigInt("18446744073709551615"))).toBe(
      BigInt("18446744073709551615"),
    );
    expect(Msgpack.toUint64(BigInt(-1))).toBe(BigInt("18446744073709551615"));
    expect(Msgpack.toUint64(-2)).toBe(BigInt("18446744073709551614"));
    expect(Msgpack.toUint64(42)).toBe(BigInt(42));
    expect(Msgpack.toUint64("42")).toBeNull();
    expect(Msgpack.toUint64(1.5)).toBeNull();
  });

  test("a time is a signed 64-bit integer; an unsigned one past it is none", () => {
    expect(Msgpack.toInt64(BigInt("1700000000123456789"))).toBe(
      BigInt("1700000000123456789"),
    );
    expect(Msgpack.toInt64(BigInt("9223372036854775808"))).toBeNull();
    expect(Msgpack.toInt64(-5)).toBe(BigInt(-5));
  });

  test("a number is a float or an integer of any size; text is a string or a binary", () => {
    expect(Msgpack.toNumber(2.5)).toBe(2.5);
    expect(Msgpack.toNumber(BigInt(7))).toBe(7);
    expect(Msgpack.toNumber(Number.NaN)).toBeNull();
    expect(Msgpack.toText(Buffer.from("bin"))).toBe("bin");
    expect(Msgpack.toText("str")).toBe("str");
    expect(Msgpack.toText(null)).toBe("");
    expect(Msgpack.decode(encodeMsgpack(new Int64(BigInt(5))))).toBe(BigInt(5));
  });
});

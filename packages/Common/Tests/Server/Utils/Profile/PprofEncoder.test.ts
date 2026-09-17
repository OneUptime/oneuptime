import PprofEncoder, {
  PprofProfile,
} from "../../../../Server/Utils/Profile/PprofEncoder";
import protobuf from "protobufjs";
import zlib from "zlib";
import { describe, expect, test } from "@jest/globals";

/*
 * Test-local mirror of the perftools.profiles.Profile descriptor the
 * encoder embeds. Decoding with an independently-written descriptor (same
 * field ids, per google/pprof profile.proto) proves the wire bytes follow
 * the pprof schema rather than just round-tripping through one shared
 * protobuf.Type instance.
 */
const DECODER_DESCRIPTOR: protobuf.INamespace = {
  nested: {
    perftools: {
      nested: {
        profiles: {
          nested: {
            Profile: {
              fields: {
                sampleType: { rule: "repeated", type: "ValueType", id: 1 },
                sample: { rule: "repeated", type: "Sample", id: 2 },
                location: { rule: "repeated", type: "Location", id: 4 },
                function: { rule: "repeated", type: "Function", id: 5 },
                stringTable: { rule: "repeated", type: "string", id: 6 },
                timeNanos: { type: "int64", id: 9 },
                durationNanos: { type: "int64", id: 10 },
                periodType: { type: "ValueType", id: 11 },
                period: { type: "int64", id: 12 },
              },
            },
            ValueType: {
              fields: {
                type: { type: "int64", id: 1 },
                unit: { type: "int64", id: 2 },
              },
            },
            Sample: {
              fields: {
                locationId: { rule: "repeated", type: "uint64", id: 1 },
                value: { rule: "repeated", type: "int64", id: 2 },
                label: { rule: "repeated", type: "Label", id: 3 },
              },
            },
            Label: {
              fields: {
                key: { type: "int64", id: 1 },
                str: { type: "int64", id: 2 },
              },
            },
            Location: {
              fields: {
                id: { type: "uint64", id: 1 },
                line: { rule: "repeated", type: "Line", id: 4 },
              },
            },
            Line: {
              fields: {
                functionId: { type: "uint64", id: 1 },
                line: { type: "int64", id: 2 },
              },
            },
            Function: {
              fields: {
                id: { type: "uint64", id: 1 },
                name: { type: "int64", id: 2 },
                systemName: { type: "int64", id: 3 },
                filename: { type: "int64", id: 4 },
              },
            },
          },
        },
      },
    },
  },
};

interface DecodedValueType {
  type: number;
  unit: number;
}

interface DecodedLabel {
  key: number;
  str: number;
}

interface DecodedSample {
  locationId: Array<number>;
  value: Array<number>;
  label: Array<DecodedLabel>;
}

interface DecodedLine {
  functionId: number;
  line: number;
}

interface DecodedLocation {
  id: number;
  line: Array<DecodedLine>;
}

interface DecodedFunction {
  id: number;
  name: number;
  filename: number;
}

interface DecodedProfile {
  sampleType: Array<DecodedValueType>;
  sample: Array<DecodedSample>;
  location: Array<DecodedLocation>;
  function: Array<DecodedFunction>;
  stringTable: Array<string>;
  timeNanos: number;
  durationNanos: number;
  periodType: DecodedValueType;
  period: number;
}

interface ResolvedFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
}

const DecoderRoot: protobuf.Root = protobuf.Root.fromJSON(DECODER_DESCRIPTOR);
const DecoderProfileMessage: protobuf.Type = DecoderRoot.lookupType(
  "perftools.profiles.Profile",
);

const decodeProfile: (compressed: Buffer) => DecodedProfile = (
  compressed: Buffer,
): DecodedProfile => {
  /*
   * Casts bridge the Uint8Array generics mismatch between the installed
   * @types/node Buffers and the zlib / protobufjs typings — the runtime
   * values are plain byte buffers either way.
   */
  const raw: Buffer = zlib.gunzipSync(
    compressed as unknown as Uint8Array,
  ) as Buffer;
  const message: protobuf.Message = DecoderProfileMessage.decode(
    raw as unknown as Uint8Array,
  );
  return DecoderProfileMessage.toObject(message, {
    longs: Number,
    defaults: true,
    arrays: true,
  }) as unknown as DecodedProfile;
};

/*
 * Follow the pprof indirection for a sample's location id: location ->
 * line -> function -> string table. This is exactly the walk `go tool
 * pprof` does, so it breaks if any of the cross-references are off-by-one.
 */
const resolveFrame: (
  decoded: DecodedProfile,
  locationId: number,
) => ResolvedFrame = (
  decoded: DecodedProfile,
  locationId: number,
): ResolvedFrame => {
  const location: DecodedLocation | undefined = decoded.location.find(
    (loc: DecodedLocation) => {
      return loc.id === locationId;
    },
  );
  expect(location).toBeDefined();
  expect(location!.line.length).toBe(1);

  const line: DecodedLine = location!.line[0]!;
  const func: DecodedFunction | undefined = decoded.function.find(
    (fn: DecodedFunction) => {
      return fn.id === line.functionId;
    },
  );
  expect(func).toBeDefined();

  return {
    functionName: decoded.stringTable[func!.name]!,
    fileName: decoded.stringTable[func!.filename]!,
    lineNumber: line.line,
  };
};

describe("PprofEncoder.encodeAndCompress", () => {
  const profile: PprofProfile = {
    profileId: "test-profile-id",
    profileType: "cpu",
    unit: "nanoseconds",
    periodType: "cpu",
    period: 10000000,
    startTimeNanos: 1700000000000000,
    endTimeNanos: 1700000060000000,
    durationNanos: 60000000,
    samples: [
      {
        stacktrace: ["main@main.go:10", "work@main.go:22"],
        value: 123,
        labels: { thread: "worker-1" },
      },
    ],
  };

  test("emits a gzipped buffer", async () => {
    const compressed: Buffer = await PprofEncoder.encodeAndCompress(profile);

    // RFC 1952 gzip magic bytes — pprof consumers sniff these.
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  test("round-trips the string table, samples, and frame indirection", async () => {
    const compressed: Buffer = await PprofEncoder.encodeAndCompress(profile);
    const decoded: DecodedProfile = decodeProfile(compressed);

    // pprof requires the empty string at string-table index 0.
    expect(decoded.stringTable[0]).toBe("");

    // Function / file names survive into the string table.
    expect(decoded.stringTable).toContain("main");
    expect(decoded.stringTable).toContain("work");
    expect(decoded.stringTable).toContain("main.go");
    expect(decoded.stringTable).toContain("cpu");
    expect(decoded.stringTable).toContain("nanoseconds");

    // Sample values survive.
    expect(decoded.sample.length).toBe(1);
    expect(decoded.sample[0]!.value).toEqual([123]);

    /*
     * Stored stacktraces are leaf-first wire order; the encoder must
     * preserve array order into Sample.location_id.
     */
    expect(decoded.sample[0]!.locationId.length).toBe(2);
    expect(resolveFrame(decoded, decoded.sample[0]!.locationId[0]!)).toEqual({
      functionName: "main",
      fileName: "main.go",
      lineNumber: 10,
    });
    expect(resolveFrame(decoded, decoded.sample[0]!.locationId[1]!)).toEqual({
      functionName: "work",
      fileName: "main.go",
      lineNumber: 22,
    });

    // Sample labels survive via string-table indirection.
    expect(decoded.sample[0]!.label.length).toBe(1);
    const label: DecodedLabel = decoded.sample[0]!.label[0]!;
    expect(decoded.stringTable[label.key]).toBe("thread");
    expect(decoded.stringTable[label.str]).toBe("worker-1");
  });

  test("sample_type, period_type, and timing metadata match the source profile", async () => {
    const compressed: Buffer = await PprofEncoder.encodeAndCompress(profile);
    const decoded: DecodedProfile = decodeProfile(compressed);

    expect(decoded.sampleType.length).toBe(1);
    expect(decoded.stringTable[decoded.sampleType[0]!.type]).toBe("cpu");
    expect(decoded.stringTable[decoded.sampleType[0]!.unit]).toBe(
      "nanoseconds",
    );

    expect(decoded.stringTable[decoded.periodType.type]).toBe("cpu");
    expect(decoded.stringTable[decoded.periodType.unit]).toBe("nanoseconds");

    expect(decoded.period).toBe(profile.period);
    expect(decoded.timeNanos).toBe(profile.startTimeNanos);
    expect(decoded.durationNanos).toBe(profile.durationNanos);
  });
});

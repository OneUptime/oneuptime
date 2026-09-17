import { JSONObject } from "../../../Types/JSON";
import protobuf from "protobufjs";
import zlib from "zlib";

/**
 * Encodes profile data into the standard pprof wire format: a gzipped
 * `perftools.profiles.Profile` protobuf message, openable with
 * `go tool pprof`, Speedscope, and every other pprof consumer.
 *
 * Stacktrace frames arrive as denormalized "function@file:line" strings
 * (the format ProfileSample rows store and Dashboard ProfileUtil parses);
 * the encoder rebuilds the string table / function / location indirection
 * that pprof requires.
 */

/*
 * Inline protobuf descriptor for the pprof Profile message, mirroring
 * google/pprof profile.proto. Embedded as JSON (rather than loaded from
 * a .proto file at runtime) so this module works in any deployment
 * without carrying proto assets next to the compiled output.
 */
const PPROF_DESCRIPTOR: protobuf.INamespace = {
  nested: {
    perftools: {
      nested: {
        profiles: {
          nested: {
            Profile: {
              fields: {
                sampleType: { rule: "repeated", type: "ValueType", id: 1 },
                sample: { rule: "repeated", type: "Sample", id: 2 },
                mapping: { rule: "repeated", type: "Mapping", id: 3 },
                location: { rule: "repeated", type: "Location", id: 4 },
                function: { rule: "repeated", type: "Function", id: 5 },
                stringTable: { rule: "repeated", type: "string", id: 6 },
                dropFrames: { type: "int64", id: 7 },
                keepFrames: { type: "int64", id: 8 },
                timeNanos: { type: "int64", id: 9 },
                durationNanos: { type: "int64", id: 10 },
                periodType: { type: "ValueType", id: 11 },
                period: { type: "int64", id: 12 },
                comment: { rule: "repeated", type: "int64", id: 13 },
                defaultSampleType: { type: "int64", id: 15 },
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
                num: { type: "int64", id: 3 },
                numUnit: { type: "int64", id: 4 },
              },
            },
            Mapping: {
              fields: {
                id: { type: "uint64", id: 1 },
                memoryStart: { type: "uint64", id: 2 },
                memoryLimit: { type: "uint64", id: 3 },
                fileOffset: { type: "uint64", id: 4 },
                filename: { type: "int64", id: 5 },
                buildId: { type: "int64", id: 6 },
                hasFunctions: { type: "bool", id: 7 },
                hasFilenames: { type: "bool", id: 8 },
                hasLineNumbers: { type: "bool", id: 9 },
                hasInlineFrames: { type: "bool", id: 10 },
              },
            },
            Location: {
              fields: {
                id: { type: "uint64", id: 1 },
                mappingId: { type: "uint64", id: 2 },
                address: { type: "uint64", id: 3 },
                line: { rule: "repeated", type: "Line", id: 4 },
                isFolded: { type: "bool", id: 5 },
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
                startLine: { type: "int64", id: 5 },
              },
            },
          },
        },
      },
    },
  },
};

const PprofRoot: protobuf.Root = protobuf.Root.fromJSON(PPROF_DESCRIPTOR);
const PprofProfileMessage: protobuf.Type = PprofRoot.lookupType(
  "perftools.profiles.Profile",
);

export interface PprofSample {
  stacktrace: Array<string>;
  value: number;
  labels: JSONObject | undefined;
}

export interface PprofProfile {
  profileId: string;
  profileType: string;
  unit: string;
  periodType: string;
  period: number;
  startTimeNanos: number;
  endTimeNanos: number;
  durationNanos: number;
  samples: Array<PprofSample>;
}

export interface PprofFunction {
  id: number;
  name: number; // string table index
  filename: number; // string table index
}

export interface PprofLocation {
  id: number;
  line: Array<{
    functionId: number;
    line: number;
  }>;
}

export interface PprofProto {
  stringTable: Array<string>;
  functions: Array<PprofFunction>;
  locations: Array<PprofLocation>;
  samples: Array<{
    locationId: Array<number>;
    value: Array<number>;
    label: Array<{ key: number; str: number }>;
  }>;
  sampleType: Array<{ type: number; unit: number }>;
  periodType: { type: number; unit: number };
  period: number;
  timeNanos: number;
  durationNanos: number;
}

export default class PprofEncoder {
  /**
   * Build a pprof-like JSON structure from denormalized profile data.
   * The output is a JSON object that mirrors the pprof proto structure,
   * using string table indirection for compact representation.
   */
  public static encode(profile: PprofProfile): PprofProto {
    const stringTable: Array<string> = [""];
    const stringIndex: Map<string, number> = new Map([["", 0]]);

    const getStringIndex: (s: string) => number = (s: string): number => {
      const existing: number | undefined = stringIndex.get(s);
      if (existing !== undefined) {
        return existing;
      }
      const idx: number = stringTable.length;
      stringTable.push(s);
      stringIndex.set(s, idx);
      return idx;
    };

    const functions: Array<PprofFunction> = [];
    const functionIndex: Map<string, number> = new Map();
    const locations: Array<PprofLocation> = [];
    const locationIndex: Map<string, number> = new Map();

    const getOrCreateFunction: (name: string, fileName: string) => number = (
      name: string,
      fileName: string,
    ): number => {
      const key: string = `${name}@${fileName}`;
      const existing: number | undefined = functionIndex.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id: number = functions.length + 1;
      functions.push({
        id,
        name: getStringIndex(name),
        filename: getStringIndex(fileName),
      });
      functionIndex.set(key, id);
      return id;
    };

    const getOrCreateLocation: (
      functionName: string,
      fileName: string,
      lineNumber: number,
    ) => number = (
      functionName: string,
      fileName: string,
      lineNumber: number,
    ): number => {
      const key: string = `${functionName}@${fileName}:${lineNumber}`;
      const existing: number | undefined = locationIndex.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const funcId: number = getOrCreateFunction(functionName, fileName);
      const id: number = locations.length + 1;
      locations.push({
        id,
        line: [{ functionId: funcId, line: lineNumber }],
      });
      locationIndex.set(key, id);
      return id;
    };

    // Build samples
    const pprofSamples: Array<{
      locationId: Array<number>;
      value: Array<number>;
      label: Array<{ key: number; str: number }>;
    }> = [];

    for (const sample of profile.samples) {
      const locationIds: Array<number> = [];

      /*
       * Stored stacktrace arrays preserve the wire order of their
       * sources — pprof `Sample.location_id` and OTLP `Stack.
       * location_indices` are both leaf-first — so emitting
       * location_ids in array order keeps the leaf-first ordering
       * pprof consumers require.
       */
      for (const frame of sample.stacktrace) {
        const atIndex: number = frame.indexOf("@");
        let functionName: string = frame;
        let fileName: string = "";
        let lineNumber: number = 0;

        if (atIndex !== -1) {
          functionName = frame.substring(0, atIndex);
          const rest: string = frame.substring(atIndex + 1);
          const lastColon: number = rest.lastIndexOf(":");
          if (lastColon !== -1) {
            fileName = rest.substring(0, lastColon);
            lineNumber = parseInt(rest.substring(lastColon + 1), 10) || 0;
          } else {
            fileName = rest;
          }
        }

        locationIds.push(
          getOrCreateLocation(functionName, fileName, lineNumber),
        );
      }

      // Build labels
      const labels: Array<{ key: number; str: number }> = [];
      if (sample.labels) {
        for (const [key, value] of Object.entries(sample.labels)) {
          labels.push({
            key: getStringIndex(key),
            str: getStringIndex(String(value)),
          });
        }
      }

      pprofSamples.push({
        locationId: locationIds,
        value: [sample.value],
        label: labels,
      });
    }

    // Build sample type
    const typeIdx: number = getStringIndex(profile.profileType);
    const unitIdx: number = getStringIndex(profile.unit || "count");
    const periodTypeIdx: number = getStringIndex(
      profile.periodType || profile.profileType,
    );

    return {
      stringTable,
      functions,
      locations,
      samples: pprofSamples,
      sampleType: [{ type: typeIdx, unit: unitIdx }],
      periodType: { type: periodTypeIdx, unit: unitIdx },
      period: profile.period,
      timeNanos: profile.startTimeNanos,
      durationNanos: profile.durationNanos,
    };
  }

  /**
   * Serialize the profile as a gzipped `perftools.profiles.Profile`
   * protobuf — the on-disk format `go tool pprof` and friends expect.
   * The intermediate structure from `encode` already uses the proto's
   * camelCased field names, so it maps onto the message verbatim.
   */
  public static async encodeAndCompress(
    profile: PprofProfile,
  ): Promise<Buffer> {
    const pprofData: PprofProto = PprofEncoder.encode(profile);

    const message: protobuf.Message = PprofProfileMessage.fromObject({
      sampleType: pprofData.sampleType,
      sample: pprofData.samples,
      location: pprofData.locations,
      function: pprofData.functions,
      stringTable: pprofData.stringTable,
      timeNanos: pprofData.timeNanos,
      durationNanos: pprofData.durationNanos,
      periodType: pprofData.periodType,
      period: pprofData.period,
    });

    const encoded: Uint8Array = PprofProfileMessage.encode(message).finish();

    return new Promise<Buffer>(
      (resolve: (value: Buffer) => void, reject: (reason: Error) => void) => {
        zlib.gzip(encoded, (err: Error | null, result: Buffer) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      },
    );
  }
}

import { JSONObject } from "../../../Types/JSON";
import zlib from "zlib";

/**
 * Encodes profile data into a simplified pprof-compatible JSON format.
 * This produces a gzipped JSON representation that captures the essential
 * profile information (stacktraces, values, metadata) in a format that
 * can be consumed by tools that support pprof JSON.
 *
 * For full protobuf pprof support, a protobuf serializer (e.g., protobufjs
 * with the pprof proto) would be needed. This implementation provides a
 * practical export format.
 */

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

      // Parse each frame in the stacktrace
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
   * Encode and gzip the pprof JSON for download.
   */
  public static async encodeAndCompress(
    profile: PprofProfile,
  ): Promise<Buffer> {
    const pprofData: PprofProto = PprofEncoder.encode(profile);
    const jsonBytes: Buffer = Buffer.from(JSON.stringify(pprofData), "utf-8");

    return new Promise<Buffer>(
      (resolve: (value: Buffer) => void, reject: (reason: Error) => void) => {
        zlib.gzip(jsonBytes, (err: Error | null, result: Buffer) => {
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

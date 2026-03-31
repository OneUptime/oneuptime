import inspector from "inspector";
import http from "http";
import https from "https";
import zlib from "zlib";
import { URL as NodeURL } from "url";
import Dictionary from "../../Types/Dictionary";
import {
  AppVersion,
  Env,
  DisableTelemetry,
  EnableProfiling,
} from "../EnvironmentConfig";
import logger from "./Logger";

// V8 CPU Profile types from the inspector module
interface V8CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface V8CpuProfileNode {
  id: number;
  callFrame: V8CallFrame;
  hitCount: number;
  children?: Array<number>;
}

interface V8CpuProfile {
  nodes: Array<V8CpuProfileNode>;
  startTime: number; // microseconds (monotonic clock)
  endTime: number; // microseconds (monotonic clock)
  samples: Array<number>; // node IDs
  timeDeltas: Array<number>; // microseconds between samples
}

export default class Profiling {
  private static session: inspector.Session | null = null;
  private static intervalId: ReturnType<typeof setInterval> | null = null;
  private static serviceName: string = "";
  private static isCollecting: boolean = false;

  // Profile every 60 seconds, sample for 10 seconds each time
  private static readonly PROFILING_INTERVAL_MS: number = 60_000;
  private static readonly PROFILING_DURATION_MS: number = 10_000;

  public static init(data: { serviceName: string }): void {
    if (!EnableProfiling) {
      return;
    }

    if (DisableTelemetry) {
      return;
    }

    const endpoint: string | null = this.getOtlpProfilesEndpoint();
    const headers: Dictionary<string> = this.getHeaders();

    if (!endpoint || Object.keys(headers).length === 0) {
      logger.warn(
        "Profiling enabled but OTLP endpoint or headers not configured. Skipping profiling initialization.",
      );
      return;
    }

    this.serviceName = data.serviceName;

    try {
      this.session = new inspector.Session();
      this.session.connect();

      this.postToSession("Profiler.enable")
        .then(() => {
          logger.info(
            `CPU profiling initialized for service: ${data.serviceName}`,
          );
          this.startProfilingLoop();
        })
        .catch((err: unknown) => {
          logger.error("Failed to enable V8 profiler:");
          logger.error(err);
        });
    } catch (err) {
      logger.error("Failed to initialize profiling session:");
      logger.error(err);
    }

    process.on("SIGTERM", () => {
      this.stop();
    });
  }

  public static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.session) {
      try {
        this.session.post("Profiler.disable");
        this.session.disconnect();
      } catch {
        // Ignore errors during cleanup
      }
      this.session = null;
    }
  }

  private static getOtlpProfilesEndpoint(): string | null {
    const base: string | undefined =
      process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"];
    if (!base) {
      return null;
    }
    return `${base}/v1/profiles`;
  }

  private static getHeaders(): Dictionary<string> {
    if (!process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"]) {
      return {};
    }

    const headersStrings: Array<string> =
      process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"].split(";");

    const headers: Dictionary<string> = {};

    for (const headerString of headersStrings) {
      const parts: Array<string> = headerString.split("=");
      if (parts.length === 2) {
        headers[parts[0]!.toString()] = parts[1]!.toString();
      }
    }

    return headers;
  }

  private static startProfilingLoop(): void {
    // Start the first collection after a short delay
    setTimeout(() => {
      this.collectAndSendProfile().catch((err: unknown) => {
        logger.error("Error in initial profile collection:");
        logger.error(err);
      });
    }, 5000);

    this.intervalId = setInterval(() => {
      this.collectAndSendProfile().catch((err: unknown) => {
        logger.error("Error in profile collection:");
        logger.error(err);
      });
    }, this.PROFILING_INTERVAL_MS);
  }

  private static async collectAndSendProfile(): Promise<void> {
    if (!this.session || this.isCollecting) {
      return;
    }

    this.isCollecting = true;
    const wallClockStartMs: number = Date.now();

    try {
      await this.postToSession("Profiler.start");

      await new Promise<void>((resolve: () => void) => {
        return setTimeout(resolve, this.PROFILING_DURATION_MS);
      });

      const wallClockEndMs: number = Date.now();
      const result: unknown = await this.postToSession("Profiler.stop");
      const profile: V8CpuProfile | undefined = (
        result as { profile?: V8CpuProfile }
      )?.profile;

      if (!profile || !profile.samples || profile.samples.length === 0) {
        return;
      }

      const otlpPayload: object = this.convertV8ProfileToOTLP(
        profile,
        wallClockStartMs,
        wallClockEndMs,
      );

      await this.sendProfile(otlpPayload);
    } catch (err) {
      logger.error("Error collecting/sending profile:");
      logger.error(err);
    } finally {
      this.isCollecting = false;
    }
  }

  private static postToSession(
    method: string,
    params?: object,
  ): Promise<unknown> {
    return new Promise<unknown>(
      (resolve: (value: unknown) => void, reject: (reason: Error) => void) => {
        if (!this.session) {
          reject(new Error("Inspector session not available"));
          return;
        }

        this.session.post(
          method,
          params || {},
          (err: Error | null, result?: object) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          },
        );
      },
    );
  }

  private static convertV8ProfileToOTLP(
    v8Profile: V8CpuProfile,
    wallClockStartMs: number,
    wallClockEndMs: number,
  ): object {
    // Build node lookup and parent maps
    const nodeMap: Map<number, V8CpuProfileNode> = new Map<
      number,
      V8CpuProfileNode
    >();
    const parentMap: Map<number, number> = new Map<number, number>();

    for (const node of v8Profile.nodes) {
      nodeMap.set(node.id, node);
      if (node.children) {
        for (const childId of node.children) {
          parentMap.set(childId, node.id);
        }
      }
    }

    // String table with deduplication
    const stringTable: Array<string> = [""];
    const stringIndexMap: Map<string, number> = new Map<string, number>();
    stringIndexMap.set("", 0);

    const getStringIndex: (s: string) => number = (s: string): number => {
      let idx: number | undefined = stringIndexMap.get(s);
      if (idx === undefined) {
        idx = stringTable.length;
        stringTable.push(s);
        stringIndexMap.set(s, idx);
      }
      return idx;
    };

    // Predefined string indices for sample types
    const cpuTypeIdx: number = getStringIndex("cpu");
    const nanosecondsIdx: number = getStringIndex("nanoseconds");
    const samplesTypeIdx: number = getStringIndex("samples");
    const countIdx: number = getStringIndex("count");

    // Build function and location tables
    const functionTable: Array<{ name: number; filename: number }> = [];
    const locationTable: Array<{
      line: Array<{ functionIndex: number; line: number }>;
    }> = [];

    const funcIndexMap: Map<string, number> = new Map<string, number>();
    const locationIndexMap: Map<string, number> = new Map<string, number>();

    const getLocationIndex: (node: V8CpuProfileNode) => number = (
      node: V8CpuProfileNode,
    ): number => {
      const locKey: string = `${node.callFrame.functionName}|${node.callFrame.url}|${node.callFrame.lineNumber}`;
      let locIdx: number | undefined = locationIndexMap.get(locKey);
      if (locIdx !== undefined) {
        return locIdx;
      }

      // Ensure function entry exists
      const fKey: string = `${node.callFrame.functionName}|${node.callFrame.url}`;
      let fIdx: number | undefined = funcIndexMap.get(fKey);
      if (fIdx === undefined) {
        fIdx = functionTable.length;
        functionTable.push({
          name: getStringIndex(node.callFrame.functionName || "(anonymous)"),
          filename: getStringIndex(node.callFrame.url || ""),
        });
        funcIndexMap.set(fKey, fIdx);
      }

      locIdx = locationTable.length;
      locationTable.push({
        line: [
          {
            functionIndex: fIdx,
            line: Math.max(0, node.callFrame.lineNumber + 1), // V8 uses 0-based line numbers
          },
        ],
      });
      locationIndexMap.set(locKey, locIdx);

      return locIdx;
    };

    // Build stack table from samples
    const stackTable: Array<{ locationIndices: Array<number> }> = [];
    const stackKeyMap: Map<string, number> = new Map<string, number>();

    const getStackIndex: (leafNodeId: number) => number = (
      leafNodeId: number,
    ): number => {
      const locationIndices: Array<number> = [];
      let currentId: number | undefined = leafNodeId;

      while (currentId !== undefined) {
        const node: V8CpuProfileNode | undefined = nodeMap.get(currentId);
        if (!node) {
          break;
        }

        // Skip V8 internal nodes
        const fnName: string = node.callFrame.functionName;
        if (
          fnName !== "(root)" &&
          fnName !== "(program)" &&
          fnName !== "(idle)" &&
          fnName !== "(garbage collector)"
        ) {
          locationIndices.push(getLocationIndex(node));
        }

        currentId = parentMap.get(currentId);
      }

      const key: string = locationIndices.join(",");
      let stackIdx: number | undefined = stackKeyMap.get(key);
      if (stackIdx === undefined) {
        stackIdx = stackTable.length;
        stackTable.push({ locationIndices });
        stackKeyMap.set(key, stackIdx);
      }

      return stackIdx;
    };

    // Use wall clock for absolute timestamps (V8 uses monotonic clock)
    const NANOS_PER_MS: bigint = BigInt(1000000);
    const NANOS_PER_US: bigint = BigInt(1000);
    const ZERO: bigint = BigInt(0);

    const startTimeNano: bigint = BigInt(wallClockStartMs) * NANOS_PER_MS;
    const endTimeNano: bigint = BigInt(wallClockEndMs) * NANOS_PER_MS;

    // Build sample entries
    const samples: Array<{
      stackIndex: number;
      value: Array<string>;
      timestampsUnixNano: Array<string>;
    }> = [];

    let cumulativeDeltaNano: bigint = ZERO;
    const totalV8DurationUs: bigint = BigInt(
      v8Profile.endTime - v8Profile.startTime,
    );
    const totalWallDurationNano: bigint = endTimeNano - startTimeNano;

    for (let i: number = 0; i < v8Profile.samples.length; i++) {
      const nodeId: number = v8Profile.samples[i]!;
      const node: V8CpuProfileNode | undefined = nodeMap.get(nodeId);

      // Accumulate time delta
      const deltaUs: bigint = BigInt(v8Profile.timeDeltas[i] || 0);
      cumulativeDeltaNano = cumulativeDeltaNano + deltaUs * NANOS_PER_US;

      if (!node) {
        continue;
      }

      // Skip idle/root/program/gc samples
      const fnName: string = node.callFrame.functionName;
      if (
        fnName === "(idle)" ||
        fnName === "(root)" ||
        fnName === "(program)" ||
        fnName === "(garbage collector)"
      ) {
        continue;
      }

      // Map V8 monotonic time to wall clock time proportionally
      const sampleTimeNano: bigint =
        totalV8DurationUs > ZERO
          ? startTimeNano +
            (cumulativeDeltaNano * totalWallDurationNano) /
              (totalV8DurationUs * NANOS_PER_US)
          : startTimeNano + cumulativeDeltaNano;

      const timeDeltaNano: bigint = deltaUs * NANOS_PER_US;

      const stackIndex: number = getStackIndex(nodeId);

      samples.push({
        stackIndex,
        value: [timeDeltaNano.toString(), "1"],
        timestampsUnixNano: [sampleTimeNano.toString()],
      });
    }

    // If no meaningful samples were collected, return an empty payload
    if (samples.length === 0) {
      return { resourceProfiles: [] };
    }

    // Compute average sampling period in nanoseconds
    const avgPeriodNs: number =
      v8Profile.samples.length > 0
        ? Math.trunc(
            ((v8Profile.endTime - v8Profile.startTime) * 1000) /
              v8Profile.samples.length,
          )
        : 1_000_000; // default 1ms

    // Generate a random profile ID (16 bytes as base64)
    const profileIdBytes: Buffer = Buffer.alloc(16);
    for (let i: number = 0; i < 16; i++) {
      profileIdBytes[i] = Math.floor(Math.random() * 256);
    }
    const profileId: string = profileIdBytes.toString("base64");

    return {
      resourceProfiles: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: this.serviceName },
              },
              {
                key: "service.version",
                value: { stringValue: AppVersion },
              },
              {
                key: "deployment.environment",
                value: { stringValue: Env },
              },
            ],
          },
          scopeProfiles: [
            {
              scope: {
                name: "oneuptime-node-profiler",
                version: "1.0.0",
              },
              profiles: [
                {
                  profileId: profileId,
                  startTimeUnixNano: startTimeNano.toString(),
                  endTimeUnixNano: endTimeNano.toString(),
                  attributes: [
                    {
                      key: "profiler.name",
                      value: { stringValue: "v8-cpu-profiler" },
                    },
                    {
                      key: "runtime.name",
                      value: { stringValue: "nodejs" },
                    },
                    {
                      key: "runtime.version",
                      value: { stringValue: process.version },
                    },
                  ],
                  profile: {
                    stringTable,
                    sampleType: [
                      { type: cpuTypeIdx, unit: nanosecondsIdx },
                      { type: samplesTypeIdx, unit: countIdx },
                    ],
                    sample: samples,
                    locationTable,
                    functionTable,
                    stackTable,
                    linkTable: [],
                    attributeTable: [],
                    periodType: { type: cpuTypeIdx, unit: nanosecondsIdx },
                    period: avgPeriodNs.toString(),
                  },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  private static async sendProfile(payload: object): Promise<void> {
    const endpoint: string | null = this.getOtlpProfilesEndpoint();
    if (!endpoint) {
      return;
    }

    const resourceProfiles: Array<unknown> = (
      payload as { resourceProfiles: Array<unknown> }
    ).resourceProfiles;
    if (!resourceProfiles || resourceProfiles.length === 0) {
      return;
    }

    const headers: Dictionary<string> = this.getHeaders();
    const jsonData: string = JSON.stringify(payload);

    const compressed: Buffer = await new Promise<Buffer>(
      (resolve: (value: Buffer) => void, reject: (reason: Error) => void) => {
        zlib.gzip(jsonData, (err: Error | null, result: Buffer) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      },
    );

    const url: NodeURL = new NodeURL(endpoint);
    const isHttps: boolean = url.protocol === "https:";
    const httpModule: typeof http | typeof https = isHttps ? https : http;

    return new Promise<void>((resolve: () => void) => {
      const req: http.ClientRequest = httpModule.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            ...headers,
          },
        },
        (res: http.IncomingMessage) => {
          let data: string = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              logger.debug(
                `Profile sent successfully for service: ${this.serviceName}`,
              );
            } else {
              logger.warn(
                `Profile export failed with status ${res.statusCode}: ${data}`,
              );
            }
            resolve();
          });
        },
      );

      req.on("error", (err: Error) => {
        logger.warn(`Profile export error: ${err.message}`);
        resolve(); // Don't throw - profiling failures should not crash the service
      });

      req.write(compressed);
      req.end();
    });
  }
}

import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import EventLoop from "Common/Server/Utils/EventLoop";
import logger from "Common/Server/Utils/Logger";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import protobuf from "protobufjs";
import path from "path";
import zlib from "zlib";
import ProfilesQueueService from "./Queue/ProfilesQueueService";

// Load pprof proto schema
const PprofProto: protobuf.Root = protobuf.loadSync(
  path.resolve(__dirname, "..", "ProtoFiles", "pprof", "profile.proto"),
);
const PprofProfile: protobuf.Type = PprofProto.lookupType(
  "perftools.profiles.Profile",
);

// Load Pyroscope push proto schema (used by Grafana Alloy's pyroscope.write)
const PushProto: protobuf.Root = protobuf.loadSync(
  path.resolve(__dirname, "..", "ProtoFiles", "pyroscope", "push.proto"),
);
const PushRequest: protobuf.Type = PushProto.lookupType("push.v1.PushRequest");

// Interfaces for parsed Pyroscope push data
interface PyroscopeLabelPair {
  name: string;
  value: string;
}

interface PyroscopeRawSample {
  rawProfile: Uint8Array;
  id?: string;
}

interface PyroscopeRawProfileSeries {
  labels: Array<PyroscopeLabelPair>;
  samples: Array<PyroscopeRawSample>;
}

// Interfaces for parsed pprof data
interface PprofValueType {
  type: number;
  unit: number;
}

interface PprofSample {
  locationId: Array<number | string>;
  value: Array<number | string>;
  label?: Array<{ key: number; str?: number; num?: number; numUnit?: number }>;
}

interface PprofLocation {
  id: number | string;
  line: Array<{ functionId: number | string; line: number }>;
  address?: number | string;
}

interface PprofFunction {
  id: number | string;
  name: number;
  systemName?: number;
  filename: number;
  startLine?: number;
}

interface PprofProfileData {
  stringTable: Array<string>;
  sampleType: Array<PprofValueType>;
  sample: Array<PprofSample>;
  location: Array<PprofLocation>;
  function: Array<PprofFunction>;
  timeNanos: number | string;
  durationNanos: number | string;
  periodType?: PprofValueType;
  period: number | string;
}

// One parsed line of folded / collapsed profile text.
interface FoldedStack {
  // Frames in the order they appear on the line: root first, leaf last.
  frames: Array<string>;
  value: number;
}

/*
 * Returned when a client uploads JFR data. pyroscope-java ships JFR by
 * default; we have no JFR parser, so failing fast with guidance beats
 * silently producing an empty profile.
 */
const JFR_UNSUPPORTED_MESSAGE: string =
  "JFR format is not supported. Send profiles in pprof format instead, " +
  "or collect via Grafana Alloy's eBPF profiler (pyroscope.ebpf) which " +
  "pushes pprof to /pyroscope/push.v1.PusherService/Push.";

export default class PyroscopeIngestService {
  @CaptureSpan()
  public static async ingestPyroscopeProfile(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      // Extract query params
      const appName: string = this.parseAppName(
        (req.query["name"] as string) || "unknown",
      );
      /*
       * Pyroscope SDKs usually send unix seconds, but the param also
       * accepts relative forms like "now-10s" that parseInt turns into
       * NaN — which would poison every derived timestamp downstream.
       * Treat anything non-numeric as "not provided" (0) and let the
       * converter fall back to ingestion time.
       */
      const parsedFrom: number = parseInt(
        (req.query["from"] as string) || "0",
        10,
      );
      const fromSeconds: number = Number.isFinite(parsedFrom) ? parsedFrom : 0;
      const parsedUntil: number = parseInt(
        (req.query["until"] as string) || "0",
        10,
      );
      const untilSeconds: number = Number.isFinite(parsedUntil)
        ? parsedUntil
        : 0;
      const format: string = ((req.query["format"] as string) || "")
        .toLowerCase()
        .trim();

      if (format === "jfr") {
        throw new BadRequestException(JFR_UNSUPPORTED_MESSAGE);
      }

      // Extract pprof data from request
      const pprofBuffer: Buffer | null = this.extractPprofFromRequest(req);

      if (!pprofBuffer || pprofBuffer.length === 0) {
        throw new BadRequestException("No profile data found in request body.");
      }

      // Decompress if gzipped
      const decompressed: Buffer = await this.decompressIfNeeded(pprofBuffer);

      /*
       * pyroscope-java omits format=jfr on some versions — catch the
       * payload by its magic bytes too, before a doomed pprof decode
       * turns it into an opaque protobuf parse error.
       */
      if (this.isJfrPayload(decompressed)) {
        throw new BadRequestException(JFR_UNSUPPORTED_MESSAGE);
      }

      let otlpBody: JSONObject;

      if (format === "folded" || format === "collapsed") {
        const stacks: Array<FoldedStack> | null =
          this.parseFoldedText(decompressed);
        if (!stacks) {
          throw new BadRequestException(
            'Request body is not valid folded/collapsed profile text. Expected UTF-8 lines of "frame;frame;frame <value>".',
          );
        }
        otlpBody = this.convertFoldedToOTLP({
          stacks,
          appName,
          fromSeconds,
          untilSeconds,
        });
      } else {
        try {
          // Parse pprof protobuf and convert to OTLP profiles format
          const pprofData: PprofProfileData = this.parsePprof(decompressed);
          otlpBody = this.convertPprofToOTLP({
            pprofData,
            appName,
            fromSeconds,
            untilSeconds,
          });
        } catch (parseError) {
          /*
           * Several Pyroscope SDKs upload collapsed text without a
           * format query param — fall back to folded parsing before
           * rejecting the payload outright.
           */
          const stacks: Array<FoldedStack> | null =
            this.parseFoldedText(decompressed);
          if (!stacks) {
            logger.debug("Pyroscope ingest: pprof decode failed:");
            logger.debug(parseError);
            throw new BadRequestException(
              "Unable to parse profile payload. Send pprof (optionally gzipped) or folded/collapsed text (format=folded).",
            );
          }
          otlpBody = this.convertFoldedToOTLP({
            stacks,
            appName,
            fromSeconds,
            untilSeconds,
          });
        }
      }

      // Set the converted body on the request for the queue processor
      req.body = otlpBody;

      /*
       * The queue worker resolves the decoder from productType — the
       * route middleware sets it, but keep a guard for callers that
       * assemble the request by hand.
       */
      if (!(req as TelemetryRequest).productType) {
        (req as TelemetryRequest).productType = ProductType.Profiles;
      }

      // Respond immediately and queue for async processing
      Response.sendEmptySuccessResponse(req, res);

      try {
        await ProfilesQueueService.addProfileIngestJob(req as TelemetryRequest);
      } catch (enqueueError) {
        /*
         * The 200 is already on the wire, so the client cannot be told
         * — and next(enqueueError) would attempt a second response
         * write. Log loudly instead: this is dropped data.
         */
        logger.error(
          "Pyroscope ingest: failed to enqueue profile job — payload dropped:",
        );
        logger.error(enqueueError);
      }
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async ingestPyroscopePush(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      // Extract raw body (protobuf-encoded PushRequest)
      const rawBody: Buffer | null = this.extractRawBody(req);

      if (!rawBody || rawBody.length === 0) {
        throw new BadRequestException("No push data found in request body.");
      }

      // Decompress if gzipped
      const decompressed: Buffer = await this.decompressIfNeeded(rawBody);

      // Decode the PushRequest protobuf
      const pushMessage: protobuf.Message = PushRequest.decode(
        new Uint8Array(
          decompressed.buffer,
          decompressed.byteOffset,
          decompressed.byteLength,
        ),
      );
      const pushData: Record<string, unknown> = PushRequest.toObject(
        pushMessage,
        {
          longs: Number,
          defaults: true,
          arrays: true,
          bytes: Buffer,
        },
      ) as Record<string, unknown>;

      const series: Array<PyroscopeRawProfileSeries> =
        (pushData["series"] as Array<PyroscopeRawProfileSeries>) || [];

      // Collect all OTLP resource profiles from all series/samples
      const allResourceProfiles: Array<JSONObject> = [];

      for (const s of series) {
        // Extract service name from labels
        const serviceNameLabel: PyroscopeLabelPair | undefined = s.labels.find(
          (l: PyroscopeLabelPair) => {
            return l.name === "__name__" || l.name === "service_name";
          },
        );
        const rawName: string = serviceNameLabel
          ? serviceNameLabel.value
          : "unknown";
        const appName: string = this.parseAppName(rawName);

        for (const sample of s.samples || []) {
          if (!sample.rawProfile || sample.rawProfile.length === 0) {
            continue;
          }

          /*
           * Each non-empty sample is gzip-decompressed, pprof-parsed and
           * converted to OTLP below — heavy, variable-cost work (often
           * 10-50ms per profile). Yield before every sample so a burst of
           * large profiles can't hold the event loop long enough to starve
           * the health probes.
           */
          await EventLoop.yieldToEventLoop();

          const profileBuffer: Buffer = Buffer.isBuffer(sample.rawProfile)
            ? sample.rawProfile
            : Buffer.from(sample.rawProfile);

          // Decompress if the embedded profile is gzipped
          const decompressedProfile: Buffer =
            await this.decompressIfNeeded(profileBuffer);

          // Parse the embedded pprof
          const pprofData: PprofProfileData =
            this.parsePprof(decompressedProfile);

          // Use pprof timestamps; fall back to current time
          const nowSeconds: number = Math.floor(Date.now() / 1000);
          const fromSeconds: number = pprofData.timeNanos
            ? Math.floor(Number(pprofData.timeNanos) / 1_000_000_000)
            : nowSeconds;
          const untilSeconds: number = pprofData.durationNanos
            ? fromSeconds +
              Math.floor(Number(pprofData.durationNanos) / 1_000_000_000)
            : nowSeconds;

          const otlpBody: JSONObject = this.convertPprofToOTLP({
            pprofData,
            appName,
            fromSeconds,
            untilSeconds,
          });

          const resourceProfiles: Array<JSONObject> = (
            otlpBody as Record<string, unknown>
          )["resourceProfiles"] as Array<JSONObject>;
          if (resourceProfiles) {
            allResourceProfiles.push(...resourceProfiles);
          }
        }
      }

      if (allResourceProfiles.length === 0) {
        // No valid profiles found — still respond OK
        Response.sendEmptySuccessResponse(req, res);
        return;
      }

      // Set the merged OTLP body on the request for the queue processor
      req.body = { resourceProfiles: allResourceProfiles };

      /*
       * The queue worker resolves the decoder from productType — the
       * route middleware sets it, but keep a guard for callers that
       * assemble the request by hand.
       */
      if (!(req as TelemetryRequest).productType) {
        (req as TelemetryRequest).productType = ProductType.Profiles;
      }

      // Respond immediately and queue for async processing
      Response.sendEmptySuccessResponse(req, res);

      try {
        await ProfilesQueueService.addProfileIngestJob(req as TelemetryRequest);
      } catch (enqueueError) {
        /*
         * The 200 is already on the wire, so the client cannot be told
         * — and next(enqueueError) would attempt a second response
         * write. Log loudly instead: this is dropped data.
         */
        logger.error(
          "Pyroscope push: failed to enqueue profile job — payload dropped:",
        );
        logger.error(enqueueError);
      }
    } catch (err) {
      return next(err);
    }
  }

  private static extractRawBody(req: ExpressRequest): Buffer | null {
    if (Buffer.isBuffer(req.body)) {
      return req.body as Buffer;
    }
    if (req.body instanceof Uint8Array) {
      return Buffer.from(req.body);
    }
    return null;
  }

  private static parseAppName(name: string): string {
    /*
     * Pyroscope name format: "appName.profileType{label1=value1,label2=value2}"
     * Extract just the app name part (before the first '{' or '.')
     */
    const braceIndex: number = name.indexOf("{");
    if (braceIndex >= 0) {
      name = name.substring(0, braceIndex);
    }

    // Remove profile type suffix (e.g., ".cpu", ".wall", ".alloc_objects")
    const knownSuffixes: Array<string> = [
      ".cpu",
      ".wall",
      ".alloc_objects",
      ".alloc_space",
      ".inuse_objects",
      ".inuse_space",
      ".goroutine",
      ".mutex_count",
      ".mutex_duration",
      ".block_count",
      ".block_duration",
      ".contention",
      ".itimer",
    ];

    for (const suffix of knownSuffixes) {
      if (name.endsWith(suffix)) {
        return name.substring(0, name.length - suffix.length);
      }
    }

    return name;
  }

  private static extractPprofFromRequest(req: ExpressRequest): Buffer | null {
    // Check multer files (multipart/form-data)
    const files: Array<{ fieldname: string; buffer: Buffer }> | undefined =
      req.files as Array<{ fieldname: string; buffer: Buffer }> | undefined;

    if (files && files.length > 0) {
      // Find the 'profile' field
      const profileFile: { fieldname: string; buffer: Buffer } | undefined =
        files.find((f: { fieldname: string; buffer: Buffer }) => {
          return f.fieldname === "profile";
        });

      if (profileFile) {
        return profileFile.buffer;
      }

      // If no 'profile' field, use the first file
      return files[0]!.buffer;
    }

    // Check raw body (application/octet-stream)
    if (Buffer.isBuffer(req.body)) {
      return req.body as Buffer;
    }

    if (req.body instanceof Uint8Array) {
      return Buffer.from(req.body);
    }

    return null;
  }

  private static async decompressIfNeeded(data: Buffer): Promise<Buffer> {
    // Check for gzip magic bytes (0x1f, 0x8b)
    if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
      return new Promise<Buffer>(
        (resolve: (value: Buffer) => void, reject: (reason: Error) => void) => {
          zlib.gunzip(
            data as unknown as Uint8Array,
            (err: Error | null, result: Buffer) => {
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
    return data;
  }

  /*
   * JFR (Java Flight Recorder) chunks start with the magic bytes
   * "FLR\0". We cannot parse JFR, so detect it explicitly to give the
   * client an actionable error instead of a protobuf decode failure.
   */
  private static isJfrPayload(data: Buffer): boolean {
    return (
      data.length >= 4 &&
      data[0] === 0x46 && // 'F'
      data[1] === 0x4c && // 'L'
      data[2] === 0x52 && // 'R'
      data[3] === 0x00
    );
  }

  /*
   * Parse folded / collapsed profile text: one stack per line, frames
   * separated by ';' (root first, leaf last), with the sample value as
   * the last whitespace-separated token. Returns null when the body is
   * not parseable as folded text (binary content, malformed lines) so
   * callers can fall through to a proper error.
   */
  private static parseFoldedText(data: Buffer): Array<FoldedStack> | null {
    // Collapsed text never contains NUL bytes — cheap binary guard.
    if (data.includes(0)) {
      return null;
    }

    const text: string = data.toString("utf-8");

    // Invalid UTF-8 sequences decode to U+FFFD — also binary content.
    if (text.includes("�")) {
      return null;
    }

    const stacks: Array<FoldedStack> = [];

    for (const rawLine of text.split("\n")) {
      const line: string = rawLine.trim();
      if (!line) {
        continue;
      }

      const lastSpace: number = line.lastIndexOf(" ");
      if (lastSpace <= 0) {
        return null;
      }

      const value: number = Number(line.substring(lastSpace + 1));
      if (!Number.isFinite(value) || value < 0) {
        return null;
      }

      const frames: Array<string> = line
        .substring(0, lastSpace)
        .split(";")
        .map((frame: string) => {
          return frame.trim();
        })
        .filter((frame: string) => {
          return frame.length > 0;
        });

      if (frames.length === 0) {
        return null;
      }

      stacks.push({ frames, value });
    }

    return stacks.length > 0 ? stacks : null;
  }

  /*
   * Build a synthetic single-valued pprof structure from folded stacks
   * and reuse the pprof -> OTLP converter, so folded uploads flow
   * through the exact same normalization as protobuf uploads.
   */
  private static convertFoldedToOTLP(data: {
    stacks: Array<FoldedStack>;
    appName: string;
    fromSeconds: number;
    untilSeconds: number;
  }): JSONObject {
    const stringTable: Array<string> = [""];
    const stringIndexMap: Map<string, number> = new Map<string, number>([
      ["", 0],
    ]);

    const getStringIndex: (s: string) => number = (s: string): number => {
      const existing: number | undefined = stringIndexMap.get(s);
      if (existing !== undefined) {
        return existing;
      }
      const index: number = stringTable.length;
      stringTable.push(s);
      stringIndexMap.set(s, index);
      return index;
    };

    const functions: Array<PprofFunction> = [];
    const locations: Array<PprofLocation> = [];
    const locationIdByFrame: Map<string, number> = new Map<string, number>();

    /*
     * Folded frames are bare names (no file / line information), so
     * every unique frame maps 1:1 to one function and one location.
     * pprof ids are 1-based; 0 means "unset".
     */
    const getOrCreateLocationId: (frame: string) => number = (
      frame: string,
    ): number => {
      const existing: number | undefined = locationIdByFrame.get(frame);
      if (existing !== undefined) {
        return existing;
      }
      const id: number = locations.length + 1;
      functions.push({
        id,
        name: getStringIndex(frame),
        filename: 0,
      });
      locations.push({
        id,
        line: [{ functionId: id, line: 0 }],
      });
      locationIdByFrame.set(frame, id);
      return id;
    };

    const samples: Array<PprofSample> = data.stacks.map(
      (stack: FoldedStack): PprofSample => {
        /*
         * Folded lines are root-first; pprof `location_id` arrays are
         * leaf-first — reverse while mapping so the converted stacks
         * match what real pprof uploads produce.
         */
        const locationId: Array<number> = [];
        for (let i: number = stack.frames.length - 1; i >= 0; i--) {
          locationId.push(getOrCreateLocationId(stack.frames[i]!));
        }
        return {
          locationId,
          value: [stack.value],
        };
      },
    );

    const pprofData: PprofProfileData = {
      stringTable,
      sampleType: [
        {
          type: getStringIndex("samples"),
          unit: getStringIndex("count"),
        },
      ],
      sample: samples,
      location: locations,
      function: functions,
      timeNanos: data.fromSeconds * 1_000_000_000,
      durationNanos:
        Math.max(0, data.untilSeconds - data.fromSeconds) * 1_000_000_000,
      period: 0,
    };

    return this.convertPprofToOTLP({
      pprofData,
      appName: data.appName,
      fromSeconds: data.fromSeconds,
      untilSeconds: data.untilSeconds,
    });
  }

  private static parsePprof(data: Buffer): PprofProfileData {
    const message: protobuf.Message = PprofProfile.decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    const obj: Record<string, unknown> = PprofProfile.toObject(message, {
      longs: Number,
      defaults: true,
      arrays: true,
    }) as Record<string, unknown>;

    return obj as unknown as PprofProfileData;
  }

  @CaptureSpan()
  private static convertPprofToOTLP(data: {
    pprofData: PprofProfileData;
    appName: string;
    fromSeconds: number;
    untilSeconds: number;
  }): JSONObject {
    const { pprofData, appName, fromSeconds, untilSeconds } = data;

    const stringTable: Array<string> = pprofData.stringTable || [];

    // Build function ID → index map
    const functionIdToIndex: Map<string, number> = new Map<string, number>();
    const functionTable: Array<JSONObject> = [];

    for (let i: number = 0; i < (pprofData.function || []).length; i++) {
      const fn: PprofFunction = pprofData.function[i]!;
      functionIdToIndex.set(fn.id.toString(), i);
      functionTable.push({
        name: fn.name,
        filename: fn.filename,
      });
    }

    // Build location ID → index map
    const locationIdToIndex: Map<string, number> = new Map<string, number>();
    const locationTable: Array<JSONObject> = [];

    for (let i: number = 0; i < (pprofData.location || []).length; i++) {
      const loc: PprofLocation = pprofData.location[i]!;
      locationIdToIndex.set(loc.id.toString(), i);

      const lines: Array<JSONObject> = (loc.line || []).map(
        (line: { functionId: number | string; line: number }) => {
          const fnIndex: number =
            functionIdToIndex.get(line.functionId.toString()) || 0;
          return {
            functionIndex: fnIndex,
            line: line.line || 0,
          };
        },
      );

      locationTable.push({ line: lines });
    }

    // Build stack table and samples from pprof samples
    const stackTable: Array<JSONObject> = [];
    const stackKeyMap: Map<string, number> = new Map<string, number>();
    const otlpSamples: Array<JSONObject> = [];

    /*
     * Compute timestamps. A missing/zero capture time would land every
     * sample at the 1970 epoch — outside any dashboard window and
     * instantly past retention — so fall back to ingestion time when
     * neither the pprof payload nor the query params carry one.
     */
    const nowNanos: number =
      OneUptimeDate.getCurrentDate().getTime() * 1_000_000;
    const startNanos: number = pprofData.timeNanos
      ? Number(pprofData.timeNanos)
      : fromSeconds > 0
        ? fromSeconds * 1_000_000_000
        : nowNanos;
    const endNanos: number = pprofData.durationNanos
      ? startNanos + Number(pprofData.durationNanos)
      : untilSeconds > 0
        ? untilSeconds * 1_000_000_000
        : startNanos;
    const startTimeNanos: string = startNanos.toString();
    const endTimeNanos: string = endNanos.toString();

    for (const sample of pprofData.sample || []) {
      // Convert location IDs to location indices
      const locationIndices: Array<number> = (sample.locationId || []).map(
        (locId: number | string) => {
          return locationIdToIndex.get(locId.toString()) || 0;
        },
      );

      // Deduplicate stacks
      const stackKey: string = locationIndices.join(",");
      let stackIndex: number | undefined = stackKeyMap.get(stackKey);
      if (stackIndex === undefined) {
        stackIndex = stackTable.length;
        stackTable.push({ locationIndices });
        stackKeyMap.set(stackKey, stackIndex);
      }

      // Convert values to strings
      const values: Array<string> = (sample.value || []).map(
        (v: number | string) => {
          return v.toString();
        },
      );

      otlpSamples.push({
        stackIndex,
        value: values,
        timestampsUnixNano: [startTimeNanos],
      });
    }

    // Build sample types
    const sampleType: Array<JSONObject> = (pprofData.sampleType || []).map(
      (st: PprofValueType) => {
        return {
          type: st.type,
          unit: st.unit,
        };
      },
    );

    // Build period type
    const periodType: JSONObject = pprofData.periodType
      ? { type: pprofData.periodType.type, unit: pprofData.periodType.unit }
      : { type: 0, unit: 0 };

    // Generate profile ID
    const profileId: string = ObjectID.generate().toString();
    const profileIdBase64: string = Buffer.from(profileId, "hex").toString(
      "base64",
    );

    return {
      resourceProfiles: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: appName },
              },
              {
                key: "telemetry.sdk.name",
                value: { stringValue: "pyroscope" },
              },
            ],
          },
          scopeProfiles: [
            {
              scope: {
                name: "pyroscope",
                version: "1.0.0",
              },
              profiles: [
                {
                  profileId: profileIdBase64,
                  startTimeUnixNano: startTimeNanos,
                  endTimeUnixNano: endTimeNanos,
                  attributes: [],
                  profile: {
                    stringTable,
                    sampleType,
                    sample: otlpSamples,
                    locationTable,
                    functionTable,
                    stackTable,
                    linkTable: [],
                    attributeTable: [],
                    periodType,
                    period: (pprofData.period || 0).toString(),
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as JSONObject;
  }
}

import protobuf from "protobufjs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import OtlpJson, {
  OTLP_SEVERITY_UNSPECIFIED,
  OtlpKeyValue,
  OtlpSeverity,
} from "./OtlpJson";

/*
 * LOKI'S PUSH API, AS OPENTELEMETRY LOGS.
 *
 * Promtail, Grafana Alloy (loki.write), Fluent Bit's and Vector's loki
 * outputs, the Docker Loki driver and the OpenTelemetry Collector's loki
 * exporter all post to /loki/api/v1/push, in one of two encodings
 * (https://grafana.com/docs/loki/latest/reference/loki-http-api/#ingest-logs):
 *
 *   - JSON: {"streams": [{"stream": {labels}, "values": [["<ns>", "<line>",
 *     {structured metadata}], ...]}]} - or the older {"streams":
 *     [{"labels": "{...}", "entries": [{"ts": "<RFC 3339>", "line": "..."}]}]}.
 *   - protobuf: a snappy-compressed logproto.PushRequest, whose labels are a
 *     label set string ({app="checkout", env="prod"}).
 *
 * Both become one OTLP ExportLogsServiceRequest, queued like any OTLP
 * export.
 *
 * WHAT A STREAM BECOMES
 *
 * Every entry is a log record: its line the body, its time its own (Loki
 * timestamps are nanoseconds), its stream's labels and its structured
 * metadata its attributes, under the names they have in Loki - so a LogQL
 * selector moved over still names them. The service is found as Loki 3
 * finds service_name: the first of service_name, service, app,
 * application, name, app_kubernetes_io_name, container, container_name,
 * k8s_container_name, component, workload and job that a stream has (an
 * x-oneuptime-service-name header names it instead). A host or hostname
 * label is also the resource's host.name.
 *
 * The level comes from a level, detected_level, severity, lvl, loglevel or
 * log_level label or metadata, else - as Loki detects it - from a
 * logfmt `level=` or a JSON line's top-level level or severity field. A
 * trace_id / span_id in the structured metadata (Alloy puts them there)
 * links the record to its trace.
 */

export class LokiPushError extends Error {
  public readonly statusCode: number;

  public constructor(message: string) {
    super(message);
    this.name = "LokiPushError";
    this.statusCode = 400;
  }
}

export interface LokiEntry {
  // Nanoseconds since the epoch, as a decimal string; "" when unreadable.
  timeUnixNano: string;
  line: string;
  structuredMetadata: Array<[string, string]>;
}

export interface LokiStream {
  labels: Array<[string, string]>;
  entries: Array<LokiEntry>;
}

export interface LokiTranslation {
  logs: JSONObject | null;
  entryCount: number;
}

// Loki 3's discover_service_name, with service_name itself first.
const SERVICE_NAME_LABELS: ReadonlyArray<string> = [
  "service_name",
  "service",
  "app",
  "application",
  "name",
  "app_kubernetes_io_name",
  "container",
  "container_name",
  "k8s_container_name",
  "component",
  "workload",
  "job",
];

const HOST_LABELS: ReadonlyArray<string> = ["host", "hostname"];

const LEVEL_LABELS: ReadonlyArray<string> = [
  "level",
  "detected_level",
  "severity",
  "lvl",
  "loglevel",
  "log_level",
];

const TRACE_ID_KEYS: ReadonlyArray<string> = ["trace_id", "traceID", "traceId"];
const SPAN_ID_KEYS: ReadonlyArray<string> = ["span_id", "spanID", "spanId"];

// A line longer than this is not parsed as JSON to find its level.
const MAX_LEVEL_DETECTION_JSON_LENGTH: number = 16 * 1024;

const LOGFMT_LEVEL_KEYS: ReadonlyArray<string> = [
  "level=",
  "lvl=",
  "severity=",
];

const WHITESPACE: RegExp = /\s/;
// A label name's characters (Prometheus allows [a-zA-Z_:][a-zA-Z0-9_:]*; Loki's clients send dots too).
const LABEL_NAME_CHARACTER: RegExp = /[A-Za-z0-9_.:]/;
const HEX_DIGITS: RegExp = /^[0-9a-fA-F]+$/;
const LETTER: RegExp = /[A-Za-z]/;
// Nanoseconds since the epoch fit in 20 digits.
const NANOSECOND_DIGITS: RegExp = /^\d{1,20}$/;
const DIGITS: RegExp = /^\d+$/;

const PushRequest: protobuf.Type = protobuf
  .loadSync(
    path.resolve(__dirname, "..", "..", "ProtoFiles", "Loki", "push.proto"),
  )
  .lookupType("logproto.PushRequest");

export { PushRequest as LokiPushRequestType };

export default class LokiPush {
  // A JSON push body (decompressed), as streams.
  public static parseJson(body: Buffer | string): Array<LokiStream> {
    const text: string =
      typeof body === "string" ? body : body.toString("utf8");

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LokiPushError("The body is not valid JSON.");
    }

    if (!LokiPush.isObject(parsed) || !Array.isArray(parsed["streams"])) {
      throw new LokiPushError(
        'The body has no "streams" array. Send {"streams": [{"stream": {...}, "values": [["<unix ns>", "<line>"]]}]}.',
      );
    }

    const streams: Array<LokiStream> = [];

    for (const stream of parsed["streams"] as Array<unknown>) {
      if (!LokiPush.isObject(stream)) {
        continue;
      }

      const labels: Array<[string, string]> = LokiPush.isObject(
        stream["stream"],
      )
        ? LokiPush.stringPairs(stream["stream"] as JSONObject)
        : typeof stream["labels"] === "string"
          ? LokiPush.parseLabelSet(stream["labels"] as string)
          : [];

      const entries: Array<LokiEntry> = [];

      if (Array.isArray(stream["values"])) {
        for (const value of stream["values"] as Array<unknown>) {
          const entry: LokiEntry | null = LokiPush.entryFromValue(value);

          if (entry) {
            entries.push(entry);
          }
        }
      } else if (Array.isArray(stream["entries"])) {
        // The legacy shape: {"ts": "<RFC 3339>", "line": "..."}.
        for (const legacy of stream["entries"] as Array<unknown>) {
          if (
            !LokiPush.isObject(legacy) ||
            typeof legacy["line"] !== "string"
          ) {
            continue;
          }

          entries.push({
            timeUnixNano: LokiPush.timeFromRfc3339(legacy["ts"]),
            line: legacy["line"] as string,
            structuredMetadata: [],
          });
        }
      }

      streams.push({ labels: labels, entries: entries });
    }

    return streams;
  }

  // A protobuf push body (snappy already undone), as streams.
  public static parseProtobuf(body: Uint8Array): Array<LokiStream> {
    let decoded: JSONObject;

    try {
      decoded = PushRequest.toObject(PushRequest.decode(body), {
        longs: String,
        defaults: false,
        arrays: true,
      }) as JSONObject;
    } catch {
      throw new LokiPushError(
        "The body is not a snappy-compressed logproto.PushRequest.",
      );
    }

    const streams: Array<LokiStream> = [];

    for (const stream of (decoded["streams"] || []) as Array<JSONObject>) {
      const labels: Array<[string, string]> = LokiPush.parseLabelSet(
        typeof stream["labels"] === "string" ? stream["labels"] : "",
      );

      const entries: Array<LokiEntry> = [];

      for (const entry of (stream["entries"] || []) as Array<JSONObject>) {
        const timestamp: JSONObject = LokiPush.isObject(entry["timestamp"])
          ? (entry["timestamp"] as JSONObject)
          : {};

        entries.push({
          timeUnixNano: LokiPush.timeFromSecondsAndNanos(
            timestamp["seconds"],
            timestamp["nanos"],
          ),
          line: typeof entry["line"] === "string" ? entry["line"] : "",
          structuredMetadata: (
            (entry["structuredMetadata"] || []) as Array<JSONObject>
          )
            .filter((pair: JSONObject): boolean => {
              return typeof pair["name"] === "string" && pair["name"] !== "";
            })
            .map((pair: JSONObject): [string, string] => {
              return [
                pair["name"] as string,
                typeof pair["value"] === "string" ? pair["value"] : "",
              ];
            }),
        });
      }

      streams.push({ labels: labels, entries: entries });
    }

    return streams;
  }

  public static toOtlp(
    streams: Array<LokiStream>,
    options?: {
      nowInMs?: number | undefined;
      serviceName?: string | undefined;
    },
  ): LokiTranslation {
    const observedTimeUnixNano: string = OtlpJson.nowUnixNano(options?.nowInMs);
    const serviceOverride: string = (options?.serviceName || "").trim();

    const resources: Map<
      string,
      { attributes: Array<OtlpKeyValue>; logRecords: Array<JSONObject> }
    > = new Map();
    let entryCount: number = 0;

    for (const stream of streams) {
      if (stream.entries.length === 0) {
        continue;
      }

      const labels: Map<string, string> = new Map<string, string>(
        stream.labels,
      );
      const serviceName: string =
        serviceOverride || LokiPush.firstOf(labels, SERVICE_NAME_LABELS);
      const hostName: string = LokiPush.firstOf(labels, HOST_LABELS);
      const key: string = JSON.stringify([serviceName, hostName]);

      let resource:
        | { attributes: Array<OtlpKeyValue>; logRecords: Array<JSONObject> }
        | undefined = resources.get(key);

      if (!resource) {
        const attributes: Array<OtlpKeyValue> = [];

        OtlpJson.pushAll(
          attributes,
          OtlpJson.stringAttribute("service.name", serviceName),
          OtlpJson.stringAttribute("host.name", hostName),
        );

        resource = { attributes: attributes, logRecords: [] };
        resources.set(key, resource);
      }

      const labelLevel: OtlpSeverity = OtlpJson.severityFromWord(
        LokiPush.firstOf(labels, LEVEL_LABELS),
      );

      for (const entry of stream.entries) {
        const metadata: Map<string, string> = new Map<string, string>(
          entry.structuredMetadata,
        );

        // Labels, then structured metadata; a name in both keeps the metadata's.
        const merged: Map<string, string> = new Map<string, string>(labels);

        for (const [name, value] of metadata) {
          merged.set(name, value);
        }

        const attributes: Array<OtlpKeyValue> = [];

        for (const [name, value] of merged) {
          if (name) {
            attributes.push({ key: name, value: { stringValue: value } });
          }
        }

        let severity: OtlpSeverity = OtlpJson.severityFromWord(
          LokiPush.firstOf(metadata, LEVEL_LABELS),
        );

        if (severity === OTLP_SEVERITY_UNSPECIFIED) {
          severity = labelLevel;
        }

        if (severity === OTLP_SEVERITY_UNSPECIFIED) {
          severity = LokiPush.detectLevel(entry.line);
        }

        const logRecord: JSONObject = {
          timeUnixNano: entry.timeUnixNano || observedTimeUnixNano,
          observedTimeUnixNano: observedTimeUnixNano,
          severityNumber: severity.number,
          severityText: severity.text,
          body: { stringValue: entry.line },
          attributes: attributes as unknown as JSONObject[],
        };

        const traceId: string = OtlpJson.hexId(
          LokiPush.firstOf(metadata, TRACE_ID_KEYS),
          32,
        );
        const spanId: string = OtlpJson.hexId(
          LokiPush.firstOf(metadata, SPAN_ID_KEYS),
          16,
        );

        if (traceId) {
          logRecord["traceId"] = traceId;
        }

        if (spanId) {
          logRecord["spanId"] = spanId;
        }

        resource.logRecords.push(logRecord);
        entryCount++;
      }
    }

    if (entryCount === 0) {
      return { logs: null, entryCount: 0 };
    }

    return {
      logs: {
        resourceLogs: Array.from(resources.values()).map(
          (resource: {
            attributes: Array<OtlpKeyValue>;
            logRecords: Array<JSONObject>;
          }): JSONObject => {
            return {
              resource: {
                attributes: resource.attributes as unknown as JSONObject[],
              },
              scopeLogs: [
                {
                  scope: { name: "loki-push" },
                  logRecords: resource.logRecords,
                },
              ],
            };
          },
        ),
      },
      entryCount: entryCount,
    };
  }

  /*
   * A label set as Prometheus and Loki write one: {name="value", ...},
   * braces optional, values double-quoted (single quotes and backticks
   * read too) with Go's escapes. A malformed set is refused, not guessed.
   */
  public static parseLabelSet(text: string): Array<[string, string]> {
    const labels: Array<[string, string]> = [];
    let position: number = 0;
    const input: string = text.trim();

    const skipSpace: () => void = (): void => {
      while (position < input.length && WHITESPACE.test(input[position]!)) {
        position++;
      }
    };

    const fail: () => never = (): never => {
      throw new LokiPushError(
        `The stream's labels are not a valid label set: ${input.slice(0, 200)}`,
      );
    };

    if (input === "" || input === "{}") {
      return labels;
    }

    const hasBraces: boolean = input.startsWith("{");

    if (hasBraces) {
      if (!input.endsWith("}")) {
        fail();
      }

      position = 1;
    }

    const end: number = hasBraces ? input.length - 1 : input.length;

    while (true) {
      skipSpace();

      if (position >= end) {
        break;
      }

      const nameStart: number = position;

      while (position < end && LABEL_NAME_CHARACTER.test(input[position]!)) {
        position++;
      }

      const name: string = input.slice(nameStart, position);

      if (!name) {
        fail();
      }

      skipSpace();

      if (input[position] !== "=") {
        fail();
      }

      position++;
      skipSpace();

      const quote: string | undefined = input[position];

      if (quote !== '"' && quote !== "'" && quote !== "`") {
        fail();
      }

      position++;
      let value: string = "";

      while (true) {
        if (position >= end) {
          fail();
        }

        const char: string = input[position]!;

        if (char === quote) {
          position++;
          break;
        }

        if (char === "\\" && quote !== "`") {
          const escape: { text: string; length: number } | null =
            LokiPush.readEscape(input, position);

          if (!escape) {
            fail();
          }

          value += escape!.text;
          position += escape!.length;
          continue;
        }

        value += char;
        position++;
      }

      labels.push([name, value]);
      skipSpace();

      if (position < end) {
        if (input[position] !== ",") {
          fail();
        }

        position++;
      }
    }

    return labels;
  }

  private static readEscape(
    input: string,
    position: number,
  ): { text: string; length: number } | null {
    const next: string | undefined = input[position + 1];

    switch (next) {
      case '"':
      case "'":
      case "\\":
        return { text: next, length: 2 };
      case "n":
        return { text: "\n", length: 2 };
      case "t":
        return { text: "\t", length: 2 };
      case "r":
        return { text: "\r", length: 2 };
      case "a":
        return { text: "\u0007", length: 2 };
      case "b":
        return { text: "\b", length: 2 };
      case "f":
        return { text: "\f", length: 2 };
      case "v":
        return { text: "\v", length: 2 };
      case "x":
        return LokiPush.hexEscape(input, position, 2);
      case "u":
        return LokiPush.hexEscape(input, position, 4);
      case "U":
        return LokiPush.hexEscape(input, position, 8);
      default:
        return null;
    }
  }

  private static hexEscape(
    input: string,
    position: number,
    digits: number,
  ): { text: string; length: number } | null {
    const hex: string = input.slice(position + 2, position + 2 + digits);

    if (hex.length !== digits || !HEX_DIGITS.test(hex)) {
      return null;
    }

    const codePoint: number = parseInt(hex, 16);

    if (codePoint > 0x10ffff) {
      return null;
    }

    return { text: String.fromCodePoint(codePoint), length: 2 + digits };
  }

  // A level a line states as logfmt (level=error) or JSON ("level": "warn").
  public static detectLevel(line: string): OtlpSeverity {
    const trimmed: string = line.trimStart();

    if (
      trimmed.startsWith("{") &&
      trimmed.length <= MAX_LEVEL_DETECTION_JSON_LENGTH
    ) {
      try {
        const parsed: unknown = JSON.parse(trimmed);

        if (LokiPush.isObject(parsed)) {
          for (const key of ["level", "severity", "lvl", "log.level"]) {
            const severity: OtlpSeverity = OtlpJson.severityFromWord(
              parsed[key],
            );

            if (severity !== OTLP_SEVERITY_UNSPECIFIED) {
              return severity;
            }
          }
        }
      } catch {
        // Not JSON after all: logfmt below.
      }
    }

    for (const key of LOGFMT_LEVEL_KEYS) {
      const index: number = line.indexOf(key);

      if (index === -1) {
        continue;
      }

      // The key must start a field: at the line's start or after a space.
      if (index > 0 && line[index - 1] !== " " && line[index - 1] !== "\t") {
        continue;
      }

      let valueStart: number = index + key.length;

      if (line[valueStart] === '"') {
        valueStart++;
      }

      let valueEnd: number = valueStart;

      while (
        valueEnd < line.length &&
        valueEnd - valueStart < 16 &&
        LETTER.test(line[valueEnd]!)
      ) {
        valueEnd++;
      }

      const severity: OtlpSeverity = OtlpJson.severityFromWord(
        line.slice(valueStart, valueEnd),
      );

      if (severity !== OTLP_SEVERITY_UNSPECIFIED) {
        return severity;
      }
    }

    return OTLP_SEVERITY_UNSPECIFIED;
  }

  // A JSON entry: ["<ns>", "<line>"] or ["<ns>", "<line>", {metadata}].
  private static entryFromValue(value: unknown): LokiEntry | null {
    if (!Array.isArray(value) || value.length < 2) {
      return null;
    }

    const line: unknown = value[1];

    if (typeof line !== "string") {
      return null;
    }

    const metadata: unknown = value[2];

    return {
      timeUnixNano: LokiPush.timeFromNanos(value[0]),
      line: line,
      structuredMetadata: LokiPush.isObject(metadata)
        ? LokiPush.stringPairs(metadata as JSONObject)
        : [],
    };
  }

  // Nanoseconds as Loki's JSON writes them: a decimal string, or a number.
  private static timeFromNanos(value: unknown): string {
    if (typeof value === "string" && NANOSECOND_DIGITS.test(value.trim())) {
      const text: string = value.trim().replace(/^0+(?=\d)/, "");
      return text === "0" ? "" : text;
    }

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return BigInt(Math.trunc(value)).toString();
    }

    return "";
  }

  private static timeFromSecondsAndNanos(
    seconds: unknown,
    nanos: unknown,
  ): string {
    const wholeSeconds: string =
      typeof seconds === "string" && DIGITS.test(seconds)
        ? seconds
        : typeof seconds === "number" && Number.isSafeInteger(seconds)
          ? String(seconds)
          : "";

    if (!wholeSeconds || wholeSeconds === "0") {
      return "";
    }

    const fraction: number =
      typeof nanos === "number" && Number.isInteger(nanos) && nanos > 0
        ? Math.min(nanos, 999_999_999)
        : 0;

    return (
      BigInt(wholeSeconds) * BigInt(1_000_000_000) +
      BigInt(fraction)
    ).toString();
  }

  private static timeFromRfc3339(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    const milliseconds: number = Date.parse(value);

    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      return "";
    }

    // Keep sub-millisecond digits Date.parse drops.
    const fraction: RegExpMatchArray | null = value.match(/\.(\d+)/);
    const nanosWithinSecond: string = (fraction ? fraction[1]! : "")
      .slice(0, 9)
      .padEnd(9, "0");
    const wholeSeconds: number = Math.floor(milliseconds / 1000);

    return (
      BigInt(wholeSeconds) * BigInt(1_000_000_000) +
      BigInt(nanosWithinSecond)
    ).toString();
  }

  private static stringPairs(record: JSONObject): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];

    for (const name of Object.keys(record)) {
      const value: unknown = record[name];

      if (typeof value === "string") {
        pairs.push([name, value]);
      } else if (typeof value === "number" || typeof value === "boolean") {
        pairs.push([name, String(value)]);
      }
    }

    return pairs;
  }

  private static firstOf(
    values: Map<string, string>,
    names: ReadonlyArray<string>,
  ): string {
    for (const name of names) {
      const value: string | undefined = values.get(name);

      if (value && value.trim()) {
        return value.trim();
      }
    }

    return "";
  }

  private static isObject(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}

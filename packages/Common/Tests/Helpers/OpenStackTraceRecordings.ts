import fs from "fs";
import path from "path";
import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * What OSProfiler's OTLP driver really sent, on real clouds. Tests/Ops/openstack-e2e/
 * traces-record.sh turns it on, signs requests and records the driver's output, and
 * import-trace-recording.py keeps a small true part of that here. Not a test file itself, so
 * jest does not run it.
 */

const FIXTURES: string = path.join(__dirname, "../Fixtures/OpenStack/traces");

// As OTLP numbers them.
const KIND_NAMES: Array<string> = [
  "SPAN_KIND_UNSPECIFIED",
  "SPAN_KIND_INTERNAL",
  "SPAN_KIND_SERVER",
  "SPAN_KIND_CLIENT",
  "SPAN_KIND_PRODUCER",
  "SPAN_KIND_CONSUMER",
];

export interface RecordedScene {
  scene: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  exitCode: number;
  traceIds: Array<string>;
  spansMade: number;
  expectsNoSpans: boolean;
  mustSucceed: boolean;
}

export interface RecordedSpan {
  driverService: string;
  block: JSONObject;
  wire: JSONObject;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  startNano: bigint;
  endNano: bigint;
  // Flat, as the row's map holds them before the driver's reader has been at it.
  attributes: JSONObject;
  events: JSONValue | undefined;
}

export function getRecordedTraceReleases(): Array<string> {
  return fs.readdirSync(FIXTURES).sort();
}

export class OpenStackTraceRecording {
  public constructor(public readonly release: string) {}

  public text(name: string): string {
    return fs.readFileSync(path.join(FIXTURES, this.release, name), "utf8");
  }

  public json<T = JSONObject>(name: string): T {
    return JSON.parse(this.text(name)) as T;
  }

  public scenes(): Array<RecordedScene> {
    return this.json<Array<RecordedScene>>("scenes.json");
  }

  public scene(name: string): RecordedScene {
    const scene: RecordedScene | undefined = this.scenes().find(
      (candidate: RecordedScene): boolean => {
        return candidate.scene === name;
      },
    );

    if (!scene) {
      throw new Error(`${this.release} has no scene ${name}`);
    }

    return scene;
  }

  // What was sent for a scene, as OTLP: a fresh copy each time, because the reader edits it.
  public otlp(name: string, folder: string = "driver"): JSONObject {
    return this.json(`${folder}/${name}.json`);
  }

  public spans(name: string, folder: string = "driver"): Array<RecordedSpan> {
    return readRecordedSpans(this.otlp(name, folder));
  }

  public instance(key: string): { id: string; name: string } {
    return this.json<{ id: string; name: string }>(
      `context/${key}-server.json`,
    );
  }

  public requestIdOf(key: string): string {
    const events: Array<JSONObject> = this.json<Array<JSONObject>>(
      `context/${key}-events.json`,
    );

    return events[0]!["Request ID"] as string;
  }

  // What the services logged for a request while a scene ran.
  public journal(
    name: string,
  ): Array<{ time: number; unit: string; message: string }> {
    return this.text(`journal/${name}.jsonl`)
      .split("\n")
      .filter((line: string): boolean => {
        return line.length > 0;
      })
      .map((line: string) => {
        return JSON.parse(line) as {
          time: number;
          unit: string;
          message: string;
        };
      });
  }
}

function readValue(value: JSONObject | undefined): JSONValue {
  if (!value) {
    return null;
  }

  for (const key of ["stringValue", "boolValue", "intValue", "doubleValue"]) {
    if (key in value) {
      return value[key] as JSONValue;
    }
  }

  return null;
}

export function readRecordedAttributes(attributes: unknown): JSONObject {
  const out: JSONObject = {};

  if (Array.isArray(attributes)) {
    for (const attribute of attributes as Array<JSONObject>) {
      out[attribute["key"] as string] = readValue(
        attribute["value"] as JSONObject | undefined,
      );
    }
  }

  return out;
}

export function readRecordedSpans(otlp: JSONObject): Array<RecordedSpan> {
  const spans: Array<RecordedSpan> = [];

  for (const block of otlp["resourceSpans"] as Array<JSONObject>) {
    const resource: JSONObject = readRecordedAttributes(
      (block["resource"] as JSONObject)["attributes"],
    );

    for (const scopeBlock of block["scopeSpans"] as Array<JSONObject>) {
      for (const span of scopeBlock["spans"] as Array<JSONObject>) {
        spans.push({
          driverService: resource["service.name"] as string,
          block: block,
          wire: span,
          traceId: span["traceId"] as string,
          spanId: span["spanId"] as string,
          parentSpanId: (span["parentSpanId"] as string) || "",
          name: span["name"] as string,
          kind: KIND_NAMES[span["kind"] as number] || "SPAN_KIND_UNSPECIFIED",
          startNano: BigInt(span["startTimeUnixNano"] as string),
          endNano: BigInt(span["endTimeUnixNano"] as string),
          attributes: readRecordedAttributes(span["attributes"]),
          events: span["events"] as JSONValue | undefined,
        });
      }
    }
  }

  return spans;
}

// The ID a client printed, as the trace it names.
export function traceIdOfPrinted(printed: string): string {
  return printed.split("-").join("").toLowerCase();
}

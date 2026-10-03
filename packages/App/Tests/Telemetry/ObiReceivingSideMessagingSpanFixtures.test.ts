import {
  isObiReceivingSideMessagingSpan,
  normalizeObiReceivingSideMessagingSpanKind,
} from "../../FeatureSet/Telemetry/Utils/ObiReceivingSideMessagingSpan";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * Spans OBI v0.13.0 and v0.14.0 exported in KinD from a real nats-server
 * 2.11 with JetStream (in the cluster, on the host network, and outside the
 * cluster where OBI cannot name it) and its nats.js clients, and from
 * mosquitto 2 and its MQTT clients, with the kubernetes-agent chart's OBI
 * config (Fixtures/ObiMessaging; each file's "description" and "captures"
 * say how). Every span is listed with the event type OBI's own trace
 * printer logged for it and the workload's role, so the kind it should be
 * stored with comes from OBI, not from the attributes the rule reads.
 *
 * The shapes are those of ObiReceivingSideMessagingSpan.test.ts, spelled
 * out in each file's "shapes": on a NATS client C1 (its PUB), C2 (the MSG
 * OBI splits off its ack, pull or request) and C3 (a MSG OBI reversed); on
 * nats-server B1 (a PUB it read), B2 (a MSG it delivered), B3 (the MSG OBI
 * splits off an exchange the broker wrote first), B3-main (that exchange's
 * PUB) and B4 (a MSG it wrote), the last two typed client-side; and
 * mosquitto's and its clients' MQTT spans.
 */

type OtlpValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};
type OtlpAttribute = { key: string; value: OtlpValue };
type OtlpSpan = {
  spanId: string;
  kind: number;
  attributes: Array<OtlpAttribute>;
};
type OtlpBody = {
  resourceSpans: Array<{
    resource: { attributes: Array<OtlpAttribute> };
    scopeSpans: Array<{ spans: Array<OtlpSpan> }>;
  }>;
};

type SpanTruth = {
  spanId: string;
  shape: string;
  capture: string;
  workload: string;
  role: "broker" | "client";
  obiEventType: string;
  exportedKind: SpanKind;
  v013Kind: SpanKind;
  expectedStoredKind: SpanKind;
};

type CaptureFixture = {
  obiVersion: string;
  captures: Record<string, string>;
  shapes: Record<string, string>;
  spans: Array<SpanTruth>;
  body: OtlpBody;
};

type CapturedSpan = SpanTruth & {
  obiVersion: string;
  kind: SpanKind;
  attributes: Record<string, unknown>;
};

const FIXTURE_DIR: string = path.join(__dirname, "Fixtures", "ObiMessaging");
const OBI_VERSIONS: Array<string> = ["v0.13.0", "v0.14.0"];

// OTLP kinds on the wire, as OtelTracesIngestService.mapSpanKind reads them.
const KIND_BY_NUMBER: Record<number, SpanKind> = {
  1: SpanKind.Internal,
  2: SpanKind.Server,
  3: SpanKind.Client,
  4: SpanKind.Producer,
  5: SpanKind.Consumer,
};

// TelemetryUtil.getAttributeValues for the scalar values OBI sends.
function attributeValue(value: OtlpValue): unknown {
  if ("stringValue" in value) {
    return value.stringValue ?? "";
  }
  if ("intValue" in value) {
    return value.intValue;
  }
  if ("doubleValue" in value) {
    return value.doubleValue;
  }
  return value.boolValue;
}

// Span keys bare, resource keys `resource.`-prefixed, as ingest builds them.
function attributeMap(
  items: Array<OtlpAttribute>,
  prefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of items) {
    result[`${prefix}${item.key}`] = attributeValue(item.value);
  }
  return result;
}

function loadFixture(obiVersion: string): CaptureFixture {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, `obi-${obiVersion}.json`), "utf8"),
  ) as CaptureFixture;
}

function bodySpans(
  fixture: CaptureFixture,
): Map<string, { kind: SpanKind; attributes: Record<string, unknown> }> {
  const spans: Map<
    string,
    { kind: SpanKind; attributes: Record<string, unknown> }
  > = new Map();
  for (const resourceSpans of fixture.body.resourceSpans) {
    const resource: Record<string, unknown> = attributeMap(
      resourceSpans.resource.attributes,
      "resource.",
    );
    for (const scopeSpans of resourceSpans.scopeSpans) {
      for (const span of scopeSpans.spans) {
        spans.set(span.spanId, {
          kind: KIND_BY_NUMBER[span.kind] ?? (String(span.kind) as SpanKind),
          attributes: { ...resource, ...attributeMap(span.attributes, "") },
        });
      }
    }
  }
  return spans;
}

function capturedSpans(fixture: CaptureFixture): Array<CapturedSpan> {
  const spans: Map<
    string,
    { kind: SpanKind; attributes: Record<string, unknown> }
  > = bodySpans(fixture);
  return fixture.spans.map((truth: SpanTruth): CapturedSpan => {
    const span:
      | { kind: SpanKind; attributes: Record<string, unknown> }
      | undefined = spans.get(truth.spanId);
    if (!span) {
      throw new Error(`${fixture.obiVersion}: no span ${truth.spanId}`);
    }
    return { ...truth, obiVersion: fixture.obiVersion, ...span };
  });
}

const FIXTURES: Array<CaptureFixture> = OBI_VERSIONS.map(loadFixture);
const CAPTURED: Array<CapturedSpan> = FIXTURES.flatMap(capturedSpans);

function storedKind(
  span: CapturedSpan,
  attributes: Record<string, unknown> = span.attributes,
): SpanKind {
  return normalizeObiReceivingSideMessagingSpanKind({
    kind: span.kind,
    attributes: attributes,
  });
}

function hasPeerName(span: CapturedSpan): boolean {
  return (
    span.attributes["service.peer.name"] !== undefined ||
    span.attributes["peer.service"] !== undefined
  );
}

// A client-typed span from an install that does not select service.peer.name.
function clientTypedWithoutPeerName(span: CapturedSpan): boolean {
  return !span.obiEventType.endsWith("Server") && !hasPeerName(span);
}

function withoutKeys(
  attributes: Record<string, unknown>,
  keys: Array<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...attributes };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

// Every NATS shape OBI emitted, on an in-cluster and a host-network broker.
const NATS_SHAPES: Array<string> = [
  "C1",
  "C1 host-network broker",
  "C1 external broker",
  "C1 app named like broker",
  "C2",
  "C2 host-network broker",
  "C2 external broker",
  "C2 app named like broker",
  "C3",
  "B1",
  "B2",
  "B3",
  "B3-main",
  "B4",
  "host-network B1",
  "host-network B2",
  "host-network B3",
  "host-network B3-main",
  "host-network B4",
];

// A broker's spans that keep a messaging client kind, as v0.13 sent them.
const BROKER_SHAPES_KEPT_AS_EXPORTED: Array<string> = [
  "B3-main",
  "host-network B3-main",
  "MQTT broker publish",
];

describe("OBI NATS and MQTT spans captured from nats-server and mosquitto (Fixtures/ObiMessaging)", () => {
  test.each(FIXTURES)(
    "$obiVersion: the body holds exactly the spans the truth table lists, OBI's, with the kind on the wire, at most two per shape",
    (fixture: CaptureFixture) => {
      const listed: Array<string> = fixture.spans
        .map((span: SpanTruth): string => {
          return span.spanId;
        })
        .sort();
      expect(Array.from(bodySpans(fixture).keys()).sort()).toEqual(listed);
      expect(new Set<string>(listed).size).toBe(listed.length);

      const perShape: Map<string, number> = new Map();
      for (const span of capturedSpans(fixture)) {
        expect({
          spanId: span.spanId,
          kind: span.kind,
          distro: span.attributes["resource.telemetry.distro.name"],
          version: span.attributes["resource.telemetry.distro.version"],
          shape: fixture.shapes[span.shape] !== undefined,
          capture: fixture.captures[span.capture] !== undefined,
        }).toEqual({
          spanId: span.spanId,
          kind: span.exportedKind,
          distro: "opentelemetry-ebpf-instrumentation",
          version: fixture.obiVersion,
          shape: true,
          capture: true,
        });
        const key: string = `${span.shape}|${hasPeerName(span)}`;
        perShape.set(key, (perShape.get(key) || 0) + 1);
      }
      for (const [key, count] of perShape) {
        expect({ key: key, atMostTwo: count <= 2 }).toEqual({
          key: key,
          atMostTwo: true,
        });
      }
    },
  );

  test.each(OBI_VERSIONS)(
    "%s: every NATS shape is captured, and MQTT's",
    (obiVersion: string) => {
      const shapes: Set<string> = new Set(
        CAPTURED.filter((span: CapturedSpan): boolean => {
          return span.obiVersion === obiVersion;
        }).map((span: CapturedSpan): string => {
          return span.shape;
        }),
      );
      for (const shape of [
        ...NATS_SHAPES,
        "MQTT client publish",
        "MQTT client reversed delivery",
        "MQTT broker receiving-side",
        "MQTT broker publish",
      ]) {
        expect({ shape: shape, captured: shapes.has(shape) }).toEqual({
          shape: shape,
          captured: true,
        });
      }
    },
  );

  test("v0.14 is captured with and without service.peer.name for every client-typed NATS shape", () => {
    for (const shape of [
      "C1",
      "C1 external broker",
      "C1 app named like broker",
      "B3-main",
      "B4",
      "host-network B4",
    ]) {
      const spans: Array<CapturedSpan> = CAPTURED.filter(
        (span: CapturedSpan): boolean => {
          return span.obiVersion === "v0.14.0" && span.shape === shape;
        },
      );
      expect({
        shape: shape,
        withPeerName: spans.some(hasPeerName),
        withoutPeerName: spans.some((span: CapturedSpan): boolean => {
          return !hasPeerName(span);
        }),
      }).toEqual({ shape: shape, withPeerName: true, withoutPeerName: true });
    }
  });

  test.each(CAPTURED)(
    "$obiVersion $shape, $workload ($capture, $obiEventType): $exportedKind is stored as $expectedStoredKind",
    (span: CapturedSpan) => {
      expect(storedKind(span)).toBe(span.expectedStoredKind);
    },
  );

  test("v0.13: every kind OBI v0.13 sent is kept, but a MSG a broker wrote (B4), which is SERVER", () => {
    for (const span of CAPTURED.filter((s: CapturedSpan): boolean => {
      return s.obiVersion === "v0.13.0";
    })) {
      expect({
        spanId: span.spanId,
        shape: span.shape,
        stored: storedKind(span),
      }).toEqual({
        spanId: span.spanId,
        shape: span.shape,
        stored: span.shape.endsWith("B4") ? SpanKind.Server : span.kind,
      });
    }
  });

  test("v0.14: the kind v0.13 gives the same span, but a client's split delivery naming its broker (C2, its own consumption: CONSUMER) and a MSG a broker wrote (B4: SERVER)", () => {
    for (const span of CAPTURED.filter((s: CapturedSpan): boolean => {
      return s.obiVersion === "v0.14.0";
    })) {
      let expected: SpanKind = span.v013Kind;
      if (span.shape === "C2" || span.shape === "C2 host-network broker") {
        expected = SpanKind.Consumer;
      } else if (span.shape.endsWith("B4")) {
        expected = SpanKind.Server;
      }
      expect({
        spanId: span.spanId,
        shape: span.shape,
        stored: storedKind(span),
      }).toEqual({ spanId: span.spanId, shape: span.shape, stored: expected });
    }
  });

  test("a broker's span is SERVER, but the PUB nats-server read beside a split delivery and mosquitto's PUBLISH to a subscriber, which keep OBI's PRODUCER", () => {
    for (const span of CAPTURED.filter((s: CapturedSpan): boolean => {
      return s.role === "broker";
    })) {
      expect({
        spanId: span.spanId,
        shape: span.shape,
        stored: storedKind(span),
      }).toEqual({
        spanId: span.spanId,
        shape: span.shape,
        stored: BROKER_SHAPES_KEPT_AS_EXPORTED.includes(span.shape)
          ? SpanKind.Producer
          : SpanKind.Server,
      });
    }
  });

  test("an install that does not select service.peer.name stores every span the same", () => {
    for (const span of CAPTURED) {
      expect({
        spanId: span.spanId,
        shape: span.shape,
        stored: storedKind(
          span,
          withoutKeys(span.attributes, ["service.peer.name", "peer.service"]),
        ),
      }).toEqual({
        spanId: span.spanId,
        shape: span.shape,
        stored: span.expectedStoredKind,
      });
    }
  });

  test("an install whose attributes.select drops network.peer.port leaves the address to decide: right for every span but these shapes, which keep OBI v0.14's kind", () => {
    const missed: Set<string> = new Set();
    for (const span of CAPTURED) {
      if (
        storedKind(
          span,
          withoutKeys(span.attributes, ["network.peer.port"]),
        ) !== span.expectedStoredKind
      ) {
        missed.add(
          `${span.obiVersion} ${span.shape}${clientTypedWithoutPeerName(span) ? " without service.peer.name" : ""}`,
        );
      }
    }
    expect(Array.from(missed).sort()).toEqual([
      // The split delivery names the subscriber, not nats-server.
      "v0.14.0 B3",
      // Typed client-side, but only the ports would say so.
      "v0.14.0 B4 without service.peer.name",
      // An app named like its broker reads as the broker by its address.
      "v0.14.0 C1 app named like broker without service.peer.name",
      // The address names the node, not the service.
      "v0.14.0 host-network B1",
      "v0.14.0 host-network B2",
      "v0.14.0 host-network B3",
      "v0.14.0 host-network B4 without service.peer.name",
    ]);
  });

  test("a client-typed span on a client keeps its kind, with or without service.peer.name", () => {
    for (const span of CAPTURED.filter((s: CapturedSpan): boolean => {
      return s.role === "client" && !s.obiEventType.endsWith("Server");
    })) {
      for (const attributes of [
        span.attributes,
        withoutKeys(span.attributes, ["service.peer.name"]),
      ]) {
        expect({
          spanId: span.spanId,
          shape: span.shape,
          receivingSide: isObiReceivingSideMessagingSpan(attributes),
        }).toEqual({
          spanId: span.spanId,
          shape: span.shape,
          receivingSide: false,
        });
      }
    }
  });
});

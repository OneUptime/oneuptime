import {
  ObiStoredSpan,
  applyObiSpanSemantics,
} from "../../FeatureSet/Telemetry/Utils/ObiSpanSemantics";
import {
  OBI_SPAN_METRICS_SKIP_ATTRIBUTES,
  removeObiSpanMetricsSkip,
} from "../../FeatureSet/Telemetry/Utils/ObiSpanMetricsSkip";
import {
  CLIENT_SPAN_KIND,
  CONSUMER_SPAN_KIND,
  OBI_DISTRO_ATTRIBUTE,
  OBI_TELEMETRY_DISTRO_NAME,
  isObiSpan,
} from "../../FeatureSet/Telemetry/Utils/ObiSpan";
import type { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { describe, expect, test } from "@jest/globals";

/*
 * What ingest does to an OBI span before its row is built, as one step:
 * OBI's span.metrics.skip note comes off every OBI span, a ClickHouse
 * statement sent over HTTP and a BullMQ queue operation get their
 * protocol's semantics, and a span that is not OBI's is left exactly as it
 * came.
 */

type Attributes = Record<string, unknown>;

// SpanKind's values, checked against the enum when this compiles.
function spanKind(text: `${SpanKind}`): SpanKind {
  return text as SpanKind;
}

const CLIENT: SpanKind = spanKind("SPAN_KIND_CLIENT");
const SERVER: SpanKind = spanKind("SPAN_KIND_SERVER");
const CONSUMER: SpanKind = spanKind("SPAN_KIND_CONSUMER");

const OBI_RESOURCE: Attributes = {
  "resource.service.name": "oneuptime-app",
  "resource.telemetry.distro.name": "opentelemetry-ebpf-instrumentation",
  "resource.telemetry.distro.version": "v0.14.0",
};

const SDK_RESOURCE: Attributes = {
  "resource.service.name": "oneuptime-app",
  "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
};

// An OBI HTTP server span as OBI v0.14 writes it, span.metrics.skip and all.
function obiRequest(overrides: Attributes = {}): Attributes {
  return {
    ...OBI_RESOURCE,
    "server.port": "3002",
    "server.address": "oneuptime-app",
    "http.request.method": "GET",
    "http.response.status_code": "200",
    "url.path": "/status/ready",
    "http.route": "/status/ready",
    "span.metrics.skip": true,
    ...overrides,
  };
}

const CLICKHOUSE_QUERY_STRING: string =
  "query_id=1472fec1-bab2-4dbf-b613-b94c6d8bc0e2&async_insert=1&wait_for_async_insert=0&async_insert_deduplicate=1&insert_deduplication_token=fanin%3ALogItemV3%3A01a17c37-62b6-7a50-a87a-adb5cc36ec4b&database=oneuptime&query=INSERT+INTO+LogItemV3+FORMAT";

function clickHouseInsert(resource: Attributes = OBI_RESOURCE): Attributes {
  return {
    ...resource,
    "server.address": "oneuptime-clickhouse",
    "server.port": "4129",
    "service.peer.name": "oneuptime-clickhouse",
    "http.request.method": "POST",
    "http.response.status_code": "200",
    "url.scheme": "http",
    "url.full": `/?${CLICKHOUSE_QUERY_STRING}`,
    "url.query": CLICKHOUSE_QUERY_STRING,
    "span.metrics.skip": true,
    "resource.span.metrics.skip": true,
  };
}

function bullMqCall(
  queryText: string,
  resource: Attributes = OBI_RESOURCE,
): Attributes {
  return {
    ...resource,
    "server.address": "oneuptime-valkey-master",
    "server.port": "6379",
    "db.system.name": "redis",
    "db.operation.name": "evalsha",
    "db.query.text": queryText,
    "span.metrics.skip": true,
  };
}

const SHA: string = "d898c9a1b24ab7ed9510995fa28eb5874d0cf10e";

const MOVE_TO_FINISHED_TEXT: string = `evalsha ${SHA} 14 bull:Telemetry:wait bull:Telemetry:active bull:Telemetry:prioritized bull:Telemetry:events bull:Telemetry:stalled bull:Telemetry:limiter bull:Telemetry:delay`;

function apply(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
): ObiStoredSpan {
  return applyObiSpanSemantics({ name, kind, attributes });
}

describe("ObiSpan", () => {
  test("OBI is known by its resource's distro name", () => {
    expect(OBI_TELEMETRY_DISTRO_NAME).toBe(
      "opentelemetry-ebpf-instrumentation",
    );
    expect(OBI_DISTRO_ATTRIBUTE).toBe("resource.telemetry.distro.name");
    expect(isObiSpan(obiRequest())).toBe(true);
    expect(isObiSpan({ ...obiRequest(), ...SDK_RESOURCE })).toBe(false);
    expect(
      isObiSpan({ "telemetry.distro.name": OBI_TELEMETRY_DISTRO_NAME }),
    ).toBe(false);
    expect(isObiSpan(null)).toBe(false);
    expect(isObiSpan(undefined)).toBe(false);
  });

  test("the kinds the rules compare and set are SpanKind's", () => {
    expect(CLIENT_SPAN_KIND).toBe("SPAN_KIND_CLIENT");
    expect(CONSUMER_SPAN_KIND).toBe("SPAN_KIND_CONSUMER");
  });
});

describe("removeObiSpanMetricsSkip", () => {
  test("both spellings come off an OBI span, and nothing else", () => {
    const attributes: Attributes = clickHouseInsert();
    const expected: Attributes = { ...attributes };
    delete expected["span.metrics.skip"];
    delete expected["resource.span.metrics.skip"];

    expect(removeObiSpanMetricsSkip(attributes)).toBe(true);
    expect(attributes).toEqual(expected);
    expect(OBI_SPAN_METRICS_SKIP_ATTRIBUTES).toEqual([
      "span.metrics.skip",
      "resource.span.metrics.skip",
    ]);
  });

  test("either spelling alone, whatever its value", () => {
    for (const key of OBI_SPAN_METRICS_SKIP_ATTRIBUTES) {
      for (const value of [true, false, "true", null, 0]) {
        const attributes: Attributes = { ...OBI_RESOURCE, [key]: value };
        expect({
          key,
          value,
          removed: removeObiSpanMetricsSkip(attributes),
        }).toEqual({
          key,
          value,
          removed: true,
        });
        expect(attributes).toEqual(OBI_RESOURCE);
      }
    }
  });

  test("an OBI span without it is left as it is", () => {
    const attributes: Attributes = { ...OBI_RESOURCE, "url.path": "/" };
    expect(removeObiSpanMetricsSkip(attributes)).toBe(false);
    expect(attributes).toEqual({ ...OBI_RESOURCE, "url.path": "/" });
  });

  test("an SDK's span keeps it", () => {
    const attributes: Attributes = {
      ...SDK_RESOURCE,
      "span.metrics.skip": true,
      "resource.span.metrics.skip": true,
    };
    expect(removeObiSpanMetricsSkip(attributes)).toBe(false);
    expect(attributes).toEqual({
      ...SDK_RESOURCE,
      "span.metrics.skip": true,
      "resource.span.metrics.skip": true,
    });
  });

  test("no attributes", () => {
    expect(removeObiSpanMetricsSkip(null)).toBe(false);
    expect(removeObiSpanMetricsSkip(undefined)).toBe(false);
  });
});

describe("applyObiSpanSemantics", () => {
  test("a span that is not OBI's is returned as it came, attributes untouched", () => {
    for (const attributes of [
      clickHouseInsert(SDK_RESOURCE),
      bullMqCall(MOVE_TO_FINISHED_TEXT, SDK_RESOURCE),
      { "span.metrics.skip": true },
      {},
    ]) {
      const before: Attributes = { ...attributes };
      expect(apply("POST /", CLIENT, attributes)).toEqual({
        name: "POST /",
        kind: CLIENT,
      });
      expect(attributes).toEqual(before);
    }
  });

  test("an OBI ClickHouse insert: database semantics, its name, still CLIENT, no span.metrics.skip", () => {
    const attributes: Attributes = clickHouseInsert();
    expect(apply("POST /", CLIENT, attributes)).toEqual({
      name: "INSERT LogItemV3",
      kind: CLIENT,
    });
    expect(attributes).toMatchObject({
      "db.system.name": "clickhouse",
      "db.namespace": "oneuptime",
      "db.query.text": "INSERT INTO LogItemV3 FORMAT",
      "db.operation.name": "INSERT",
      "db.collection.name": "LogItemV3",
      "url.query": CLICKHOUSE_QUERY_STRING,
      "http.request.method": "POST",
    });
    expect(attributes).not.toHaveProperty("span.metrics.skip");
    expect(attributes).not.toHaveProperty("resource.span.metrics.skip");
  });

  test("an OBI BullMQ settle: its queue, its name, stored as CONSUMER", () => {
    const attributes: Attributes = bullMqCall(MOVE_TO_FINISHED_TEXT);
    expect(apply("evalsha", CLIENT, attributes)).toEqual({
      name: "settle Telemetry",
      kind: CONSUMER,
    });
    expect(attributes).toMatchObject({
      "messaging.system": "bullmq",
      "messaging.destination.name": "Telemetry",
      "messaging.operation.type": "settle",
      "messaging.operation.name": "settle",
      "db.system.name": "redis",
      "db.query.text": MOVE_TO_FINISHED_TEXT,
    });
    expect(attributes).not.toHaveProperty("span.metrics.skip");
  });

  test("any other OBI span keeps its name and kind and loses only span.metrics.skip", () => {
    for (const kind of [SERVER, CLIENT]) {
      const attributes: Attributes = obiRequest();
      const expected: Attributes = obiRequest();
      delete expected["span.metrics.skip"];
      expect(apply("GET /status/ready", kind, attributes)).toEqual({
        name: "GET /status/ready",
        kind: kind,
      });
      expect(attributes).toEqual(expected);
    }
  });

  test("ClickHouse's own server span keeps its HTTP name", () => {
    const attributes: Attributes = clickHouseInsert();
    expect(apply("POST /", SERVER, attributes)).toEqual({
      name: "POST /",
      kind: SERVER,
    });
    expect(attributes).not.toHaveProperty("db.system.name");
  });
});

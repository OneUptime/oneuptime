import { describe, expect, it } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import VercelLogDrain from "../../FeatureSet/Telemetry/Utils/VercelLogDrain";

/*
 * Vercel's log drain records (https://vercel.com/docs/drains/reference/logs)
 * as OTLP logs: one resource per Vercel project, environment and
 * deployment, named after the project; each record's time, level, message
 * and trace context kept, its request under OpenTelemetry's names.
 */

const REQUEST_LOG: JSONObject = {
  id: "1573817187330377061717300000",
  message: "Payment failed for order 42",
  timestamp: 1573817187330,
  type: "stdout",
  source: "lambda",
  projectId: "prj_storefront",
  projectName: "storefront",
  deploymentId: "dpl_233NRGRjVZX1caZrXWtz5g1TAksD",
  buildId: "bld_cotnkcr76",
  host: "storefront-abc.vercel.app",
  entrypoint: "api/checkout.ts",
  environment: "production",
  branch: "main",
  level: "error",
  requestId: "643af4e3-975a-4cc7-9e7a-1eda11539d90",
  statusCode: 500,
  executionRegion: "iad1",
  traceId: "4BF92F3577B34DA6A3CE929D0E0E4736",
  spanId: "00f067aa0ba902b7",
  proxy: {
    timestamp: 1573817250172,
    method: "POST",
    host: "shop.acme.com",
    path: "/api/checkout?step=pay",
    userAgent: ["Mozilla/5.0", "(Macintosh)"],
    referer: "https://shop.acme.com/cart",
    region: "sfo1",
    statusCode: 500,
    clientIp: "203.0.113.7",
    scheme: "https",
    responseByteSize: 1024,
    vercelCache: "MISS",
    pathType: "func",
    wafAction: "log",
  },
};

const attributesOf: (logRecord: JSONObject) => Record<string, unknown> = (
  logRecord: JSONObject,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const attribute of logRecord["attributes"] as Array<{
    key: string;
    value: Record<string, unknown>;
  }>) {
    result[attribute.key] = Object.values(attribute.value)[0];
  }

  return result;
};

describe("VercelLogDrain.parseBody", () => {
  it("reads a JSON array of records", () => {
    expect(
      VercelLogDrain.parseBody(
        Buffer.from(
          JSON.stringify([{ id: "1" }, { id: "2" }, "not-a-record", 7]),
        ),
      ),
    ).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("reads NDJSON, a record a line, skipping lines that are not records", () => {
    expect(
      VercelLogDrain.parseBody(
        '{"id":"1"}\n\n  {"id":"2"}\r\nnot json\n[1,2]\n{"id":"3"}',
      ),
    ).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  it("reads one record on its own, and nothing from an empty or broken body", () => {
    expect(VercelLogDrain.parseBody('{"id":"1"}')).toEqual([{ id: "1" }]);
    expect(VercelLogDrain.parseBody("")).toEqual([]);
    expect(VercelLogDrain.parseBody("   \n ")).toEqual([]);
    expect(VercelLogDrain.parseBody("[{broken")).toEqual([]);
  });
});

describe("VercelLogDrain.toOtlpLogs", () => {
  it("makes each Vercel project a service, with its deployment and environment", () => {
    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([REQUEST_LOG], {
      observedAtInMs: 1700000000000,
    });

    const resourceLogs: Array<JSONObject> = otlp[
      "resourceLogs"
    ] as Array<JSONObject>;
    expect(resourceLogs).toHaveLength(1);

    expect((resourceLogs[0]!["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "service.name", value: { stringValue: "storefront" } },
      { key: "cloud.provider", value: { stringValue: "vercel" } },
      { key: "vercel.project.id", value: { stringValue: "prj_storefront" } },
      { key: "vercel.project.name", value: { stringValue: "storefront" } },
      {
        key: "deployment.environment.name",
        value: { stringValue: "production" },
      },
      {
        key: "vercel.deployment.id",
        value: { stringValue: "dpl_233NRGRjVZX1caZrXWtz5g1TAksD" },
      },
    ]);
  });

  it("keeps the record's time, level, message and trace context", () => {
    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([REQUEST_LOG], {
      observedAtInMs: 1700000000000,
    });

    const logRecord: JSONObject = (
      (
        (otlp["resourceLogs"] as Array<JSONObject>)[0]![
          "scopeLogs"
        ] as Array<JSONObject>
      )[0]!["logRecords"] as Array<JSONObject>
    )[0]!;

    expect(logRecord).toMatchObject({
      timeUnixNano: "1573817187330000000",
      observedTimeUnixNano: "1700000000000000000",
      severityNumber: 17,
      severityText: "ERROR",
      body: { stringValue: "Payment failed for order 42" },
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });
  });

  it("keeps the record's fields as attributes, the request's under OpenTelemetry's names", () => {
    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([REQUEST_LOG]);

    const logRecord: JSONObject = (
      (
        (otlp["resourceLogs"] as Array<JSONObject>)[0]![
          "scopeLogs"
        ] as Array<JSONObject>
      )[0]!["logRecords"] as Array<JSONObject>
    )[0]!;

    expect(attributesOf(logRecord)).toEqual({
      "vercel.log.id": "1573817187330377061717300000",
      "vercel.source": "lambda",
      "vercel.host": "storefront-abc.vercel.app",
      "vercel.request.id": "643af4e3-975a-4cc7-9e7a-1eda11539d90",
      "vercel.entrypoint": "api/checkout.ts",
      "vercel.type": "stdout",
      "vercel.build.id": "bld_cotnkcr76",
      "vercel.execution_region": "iad1",
      "vercel.branch": "main",
      "http.response.status_code": "500",
      "http.request.method": "POST",
      "server.address": "shop.acme.com",
      "url.path": "/api/checkout?step=pay",
      "http.request.header.referer": "https://shop.acme.com/cart",
      "client.address": "203.0.113.7",
      "url.scheme": "https",
      "vercel.proxy.region": "sfo1",
      "vercel.cache": "MISS",
      "vercel.path_type": "func",
      "vercel.waf.action": "log",
      "user_agent.original": "Mozilla/5.0 (Macintosh)",
      "vercel.proxy.status_code": "500",
      "http.response.body.size": "1024",
    });
  });

  it("writes a request logged without a message as the request itself", () => {
    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([
      {
        id: "2",
        timestamp: 1573817187330,
        source: "static",
        level: "info",
        projectId: "prj_storefront",
        proxy: { method: "GET", path: "/pricing", statusCode: 200 },
      },
    ]);

    const logRecord: JSONObject = (
      (
        (otlp["resourceLogs"] as Array<JSONObject>)[0]![
          "scopeLogs"
        ] as Array<JSONObject>
      )[0]!["logRecords"] as Array<JSONObject>
    )[0]!;

    expect(logRecord["body"]).toEqual({ stringValue: "GET /pricing 200" });
    expect(logRecord["severityText"]).toBe("INFO");
    expect(logRecord["severityNumber"]).toBe(9);
  });

  it("groups records by project, environment and deployment, and names a project with no name by its ID", () => {
    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([
      { ...REQUEST_LOG, id: "a" },
      { ...REQUEST_LOG, id: "b" },
      { ...REQUEST_LOG, id: "c", environment: "preview" },
      {
        id: "d",
        projectId: "prj_docs",
        level: "warning",
        message: "slow",
        timestamp: 1,
      },
      { id: "e", level: "fatal", message: "?" },
    ]);

    const resourceLogs: Array<JSONObject> = otlp[
      "resourceLogs"
    ] as Array<JSONObject>;

    expect(resourceLogs).toHaveLength(4);
    expect(
      resourceLogs.map((resource: JSONObject) => {
        return (
          (resource["scopeLogs"] as Array<JSONObject>)[0]![
            "logRecords"
          ] as Array<JSONObject>
        ).length;
      }),
    ).toEqual([2, 1, 1, 1]);

    const serviceNames: Array<unknown> = resourceLogs.map(
      (resource: JSONObject) => {
        return (
          (resource["resource"] as JSONObject)["attributes"] as Array<{
            value: { stringValue: string };
          }>
        )[0]!.value.stringValue;
      },
    );
    expect(serviceNames).toEqual([
      "storefront",
      "storefront",
      "prj_docs",
      "vercel",
    ]);
  });

  it("drops trace and span IDs that are not hex of the right length, and takes Vercel's dotted spelling", () => {
    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([
      { id: "1", traceId: "not-a-trace-id", spanId: "zz", message: "x" },
      {
        id: "2",
        "trace.id": "0af7651916cd43dd8448eb211c80319c",
        "span.id": "b7ad6b7169203331",
        message: "y",
      },
    ]);

    const records: Array<JSONObject> = (
      (otlp["resourceLogs"] as Array<JSONObject>)[0]![
        "scopeLogs"
      ] as Array<JSONObject>
    )[0]!["logRecords"] as Array<JSONObject>;

    expect(records[0]).not.toHaveProperty("traceId");
    expect(records[0]).not.toHaveProperty("spanId");
    expect(records[1]).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    });
  });

  it("keeps a long message whole, without reading it with a pattern", () => {
    const message: string = "x".repeat(256 * 1024);

    const otlp: JSONObject = VercelLogDrain.toOtlpLogs([
      { id: "1", message: message, level: "info" },
    ]);

    const logRecord: JSONObject = (
      (
        (otlp["resourceLogs"] as Array<JSONObject>)[0]![
          "scopeLogs"
        ] as Array<JSONObject>
      )[0]!["logRecords"] as Array<JSONObject>
    )[0]!;

    expect(
      (logRecord["body"] as { stringValue: string }).stringValue,
    ).toHaveLength(message.length);
  });

  it("writes milliseconds as OTLP's nanoseconds", () => {
    expect(VercelLogDrain.toUnixNano(1573817187330)).toBe(
      "1573817187330000000",
    );
    expect(VercelLogDrain.toUnixNano(1573817187330.9)).toBe(
      "1573817187330000000",
    );
  });
});

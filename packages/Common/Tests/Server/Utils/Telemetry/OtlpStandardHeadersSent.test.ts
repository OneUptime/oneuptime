import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import path from "path";
import {
  OtlpSignal,
  readOtlpExporterHeaders,
  readStandardOtlpSignalHeaders,
} from "../../../../Server/Utils/Telemetry/OtlpExporterHeaders";

/*
 * Issue #8884 rests on what the OTLP exporters do with the OpenTelemetry
 * standard's header variables, so here a real one - the trace exporter
 * Telemetry.init builds - exports a span to a server of the test's own, and
 * the test reads the headers it arrives with: OTEL_EXPORTER_OTLP_HEADERS and
 * OTEL_EXPORTER_OTLP_TRACES_HEADERS are sent though OneUptime hands the
 * exporter none of them, the signal's own variable wins over the other, and
 * OneUptime's own headers win over both by name. So an exporter whose only
 * headers are in those variables has headers to send, as the export gate
 * now reads it, and OneUptime need not hand them over itself.
 *
 * The export runs in a Node.js process of its own: Common's suites run in
 * jsdom, where the exporter would take its browser transport instead.
 */

const COMMON_DIR: string = path.resolve(__dirname, "../../../..");

const EXPORT_ONE_SPAN: string = `
const http = require("http");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
const { BasicTracerProvider, SimpleSpanProcessor } = require("@opentelemetry/sdk-trace-base");

const server = http.createServer((request, response) => {
  const headers = request.headers;
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/x-protobuf" });
    response.end();
    process.stdout.write(JSON.stringify(headers) + "\\n");
  });
});

server.listen(0, "127.0.0.1", async () => {
  const exporter = new OTLPTraceExporter({
    url: "http://127.0.0.1:" + server.address().port + "/v1/traces",
    headers: JSON.parse(process.env.OWN_HEADERS),
  });
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  provider.getTracer("otlp-standard-headers").startSpan("export").end();
  await provider.forceFlush();
  await provider.shutdown();
  server.closeAllConnections();
  server.close();
});
`;

// The headers one span is exported with, by a trace exporter given `own`.
const headersOfAnExport: (data: {
  own: Record<string, string>;
  environment: Record<string, string>;
}) => Record<string, string> = (data: {
  own: Record<string, string>;
  environment: Record<string, string>;
}): Record<string, string> => {
  const environment: NodeJS.ProcessEnv = { ...process.env };

  for (const name of Object.keys(environment)) {
    if (name.startsWith("OTEL_")) {
      delete environment[name];
    }
  }

  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["-e", EXPORT_ONE_SPAN],
    {
      cwd: COMMON_DIR,
      env: {
        ...environment,
        ...data.environment,
        OWN_HEADERS: JSON.stringify(data.own),
      },
      encoding: "utf8",
      timeout: 30000,
    },
  );

  expect({ status: result.status, stderr: result.stderr }).toEqual({
    status: 0,
    stderr: "",
  });

  const lines: Array<string> = result.stdout.trim().split("\n");

  expect(lines).toHaveLength(1);

  return JSON.parse(lines[0] as string) as Record<string, string>;
};

describe("a real OTLP exporter and the standard's header variables", () => {
  test("sends OTEL_EXPORTER_OTLP_HEADERS when OneUptime hands it no header", () => {
    const sent: Record<string, string> = headersOfAnExport({
      own: {},
      environment: {
        OTEL_EXPORTER_OTLP_HEADERS:
          "x-oneuptime-token=standard-key,Authorization=Basic%20dXNlcjpwYXNzd29yZA==",
      },
    });

    expect(sent["x-oneuptime-token"]).toBe("standard-key");
    expect(sent["authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
  });

  test("sends the signal's own variable over OTEL_EXPORTER_OTLP_HEADERS, as readStandardOtlpSignalHeaders reads them", () => {
    const environment: Record<string, string> = {
      OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=every-signal,x-tenant=eu",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-oneuptime-token=traces-only",
    };
    const sent: Record<string, string> = headersOfAnExport({
      own: {},
      environment,
    });

    expect(sent["x-oneuptime-token"]).toBe("traces-only");
    expect(sent["x-tenant"]).toBe("eu");
    expect(
      readStandardOtlpSignalHeaders(environment, OtlpSignal.Traces),
    ).toEqual({
      "x-oneuptime-token": "traces-only",
      "x-tenant": "eu",
    });
  });

  test("sends OneUptime's own headers over the standard's by name, and the rest of both", () => {
    const sent: Record<string, string> = headersOfAnExport({
      own: readOtlpExporterHeaders("x-oneuptime-token=own-key;x-scope=all")
        .headers,
      environment: {
        OTEL_EXPORTER_OTLP_HEADERS:
          "x-oneuptime-token=standard-key,x-tenant=eu",
      },
    });

    expect(sent["x-oneuptime-token"]).toBe("own-key");
    expect(sent["x-scope"]).toBe("all");
    expect(sent["x-tenant"]).toBe("eu");
  });

  test("leaves out what follows a ';' in the standard's variable, as readStandardOtlpSignalHeaders does", () => {
    const environment: Record<string, string> = {
      OTEL_EXPORTER_OTLP_HEADERS: "x-tenant=eu;x-oneuptime-token=never-sent",
    };
    const sent: Record<string, string> = headersOfAnExport({
      own: {},
      environment,
    });

    expect(sent["x-tenant"]).toBe("eu");
    expect(sent["x-oneuptime-token"]).toBeUndefined();
    expect(
      readStandardOtlpSignalHeaders(environment, OtlpSignal.Traces),
    ).toEqual({ "x-tenant": "eu" });
  });

  test("sends none of them when none is set", () => {
    const sent: Record<string, string> = headersOfAnExport({
      own: {},
      environment: {},
    });

    expect(sent["x-oneuptime-token"]).toBeUndefined();
    expect(sent["x-tenant"]).toBeUndefined();
  });
});

import { describe, expect, test, beforeAll, afterAll } from "@jest/globals";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";
import { Worker } from "worker_threads";
import OtelDecode, {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelDecode";
import {
  DecodeRequestMessage,
  DecodeResponseMessage,
} from "../../FeatureSet/Telemetry/Utils/DecodeWorkerThread";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * THE core guarantee of the decode thread pool: a REAL worker thread
 * running DecodeWorkerThread.ts returns results deep-equal to the
 * inline OtelDecode.decodeBody, across the full product × format ×
 * encoding matrix. If this holds, routing a payload to the pool can
 * never change what downstream consumers see.
 *
 * The worker is spawned exactly the way DecodeThreadPool spawns it:
 * the .ts entry file with `-r ts-node/register/transpile-only` in
 * execArgv — explicitly, because THIS spawning process (jest/ts-jest)
 * has no ts-node registered. (`--no-node-snapshot` is deliberately
 * absent: Node rejects process-level flags in worker execArgv.)
 *
 * One worker is spawned in beforeAll and reused by every test in the
 * file — a ts-node thread spawn costs seconds, so per-test spawns
 * would blow the suite budget for no extra coverage.
 */

const WORKER_ENTRY_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "Utils",
  "DecodeWorkerThread.ts",
);

const APP_TSCONFIG_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "tsconfig.json",
);

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

const LogsDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "logs.proto"))
  .lookupType("LogsData");
const TracesDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "traces.proto"))
  .lookupType("TracesData");
const MetricsDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "metrics.proto"))
  .lookupType("MetricsData");

const TRACE_ID_BASE64: string = Buffer.from([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]).toString("base64");
const SPAN_ID_BASE64: string = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString(
  "base64",
);

const logsPayload: JSONObject = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout-service" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "manual-instrumentation", version: "1.2.3" },
          logRecords: [
            {
              timeUnixNano: "1700000000000000000",
              severityNumber: "SEVERITY_NUMBER_INFO",
              severityText: "INFO",
              body: { stringValue: "payment accepted — naïve check ✓" },
              traceId: TRACE_ID_BASE64,
              spanId: SPAN_ID_BASE64,
            },
          ],
        },
      ],
    },
  ],
};

const tracesPayload: JSONObject = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "api-gateway" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "http-server-instrumentation" },
          spans: [
            {
              traceId: TRACE_ID_BASE64,
              spanId: SPAN_ID_BASE64,
              name: "GET /status",
              kind: "SPAN_KIND_SERVER",
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000001000000000",
              attributes: [
                { key: "http.status_code", value: { intValue: "200" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const metricsPayload: JSONObject = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "telemetry-worker" } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "queue-metrics" },
          metrics: [
            {
              name: "queue.size",
              unit: "1",
              gauge: {
                dataPoints: [
                  { timeUnixNano: "1700000000000000000", asInt: "42" },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

function encodeProtoFixture(
  protoType: protobuf.Type,
  plainPayload: JSONObject,
): Buffer {
  const message: protobuf.Message<Record<string, unknown>> =
    protoType.fromObject(plainPayload);
  return Buffer.from(protoType.encode(message).finish());
}

function gzipCompress(buffer: Buffer): Buffer {
  // Cast: pinned @types/node Buffer vs TS 5.7+ generic typed arrays.
  return zlib.gzipSync(buffer as unknown as Uint8Array);
}

let worker: Worker;
let nextRequestId: number = 1;

/*
 * Send one decode request to the real worker and await its
 * id-correlated response. Copies the body into a fresh ArrayBuffer and
 * transfers it — the same handoff DecodeThreadPool performs.
 */
function decodeViaWorkerThread(input: {
  productType: ProductType;
  format: OtelPayloadFormat;
  encoding: OtelPayloadEncoding;
  body: Buffer;
}): Promise<DecodeResponseMessage> {
  const requestId: number = nextRequestId;
  nextRequestId += 1;

  const transferable: ArrayBuffer = new ArrayBuffer(input.body.length);
  new Uint8Array(transferable).set(input.body as unknown as Uint8Array);

  const message: DecodeRequestMessage = {
    id: requestId,
    productType: input.productType,
    format: input.format,
    encoding: input.encoding,
    payload: transferable,
  };

  return new Promise<DecodeResponseMessage>(
    (
      resolve: (response: DecodeResponseMessage) => void,
      reject: (error: Error) => void,
    ) => {
      const onMessage: (response: DecodeResponseMessage) => void = (
        response: DecodeResponseMessage,
      ): void => {
        if (response.id !== requestId) {
          return; // Another test's late response; not ours.
        }
        worker.off("message", onMessage);
        worker.off("error", onError);
        resolve(response);
      };
      const onError: (error: Error) => void = (error: Error): void => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        reject(error);
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.postMessage(message, [transferable]);
    },
  );
}

beforeAll(() => {
  worker = new Worker(WORKER_ENTRY_PATH, {
    execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    env: {
      ...process.env,
      TS_NODE_PROJECT: APP_TSCONFIG_PATH,
    },
  });
});

afterAll(async () => {
  await worker.terminate();
});

interface MatrixCase {
  label: string;
  productType: ProductType;
  format: OtelPayloadFormat;
  encoding: OtelPayloadEncoding;
  body: Buffer;
}

function buildMatrix(): Array<MatrixCase> {
  const products: Array<{
    label: string;
    productType: ProductType;
    protoType: protobuf.Type;
    jsonPayload: JSONObject;
  }> = [
    {
      label: "logs",
      productType: ProductType.Logs,
      protoType: LogsDataType,
      jsonPayload: logsPayload,
    },
    {
      label: "traces",
      productType: ProductType.Traces,
      protoType: TracesDataType,
      jsonPayload: tracesPayload,
    },
    {
      label: "metrics",
      productType: ProductType.Metrics,
      protoType: MetricsDataType,
      jsonPayload: metricsPayload,
    },
  ];

  const matrix: Array<MatrixCase> = [];
  for (const product of products) {
    const protoBuffer: Buffer = encodeProtoFixture(
      product.protoType,
      product.jsonPayload,
    );
    const jsonBuffer: Buffer = Buffer.from(
      JSON.stringify(product.jsonPayload),
      "utf-8",
    );

    matrix.push({
      label: `${product.label} protobuf none`,
      productType: product.productType,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: protoBuffer,
    });
    matrix.push({
      label: `${product.label} protobuf gzip`,
      productType: product.productType,
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      body: gzipCompress(protoBuffer),
    });
    matrix.push({
      label: `${product.label} json none`,
      productType: product.productType,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      body: jsonBuffer,
    });
    matrix.push({
      label: `${product.label} json gzip`,
      productType: product.productType,
      format: OtelPayloadFormat.Json,
      encoding: "gzip",
      body: gzipCompress(jsonBuffer),
    });
  }
  return matrix;
}

describe("DecodeWorkerThread — equivalence with inline OtelDecode.decodeBody", () => {
  test("the full product × format × encoding matrix decodes identically in-thread and inline", async () => {
    const matrix: Array<MatrixCase> = buildMatrix();
    expect(matrix.length).toBe(12);

    for (const matrixCase of matrix) {
      const inlineResult: JSONObject = await OtelDecode.decodeBody({
        productType: matrixCase.productType,
        format: matrixCase.format,
        encoding: matrixCase.encoding,
        body: matrixCase.body,
      });

      const threadResponse: DecodeResponseMessage = await decodeViaWorkerThread(
        {
          productType: matrixCase.productType,
          format: matrixCase.format,
          encoding: matrixCase.encoding,
          body: matrixCase.body,
        },
      );

      if (!threadResponse.ok) {
        throw new Error(
          `worker decode failed for ${matrixCase.label}: ${threadResponse.errorMessage}`,
        );
      }
      expect(threadResponse.result).toEqual(inlineResult);
    }
  }, 60000);

  test("malformed payload answers ok:false with the error text — and the thread survives", async () => {
    const malformedResponse: DecodeResponseMessage =
      await decodeViaWorkerThread({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "gzip",
        body: Buffer.from("not gzip at all", "utf-8"),
      });

    expect(malformedResponse.ok).toBe(false);
    if (malformedResponse.ok) {
      throw new Error("expected an ok:false response");
    }
    expect(malformedResponse.errorMessage).toMatch(
      /incorrect header check|unknown compression method/,
    );

    /*
     * The per-message failure must NOT have killed the thread: the very
     * same worker decodes the next payload successfully.
     */
    const followUpBody: Buffer = encodeProtoFixture(LogsDataType, logsPayload);
    const followUpResponse: DecodeResponseMessage = await decodeViaWorkerThread(
      {
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        body: followUpBody,
      },
    );

    if (!followUpResponse.ok) {
      throw new Error(
        `follow-up decode failed: ${followUpResponse.errorMessage}`,
      );
    }
    expect(followUpResponse.result).toEqual(logsPayload);
  }, 60000);

  test("the 'no proto type' error crosses the thread boundary verbatim", async () => {
    const response: DecodeResponseMessage = await decodeViaWorkerThread({
      productType: ProductType.SessionReplay,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: Buffer.alloc(0),
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("expected an ok:false response");
    }
    expect(response.errorMessage).toMatch(/OtelPayloadDecoder: no proto type/);
  }, 60000);
});

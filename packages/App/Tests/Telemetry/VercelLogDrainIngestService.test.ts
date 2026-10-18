import crypto from "crypto";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import VercelLogDrainIngestService from "../../FeatureSet/Telemetry/Services/VercelLogDrainIngestService";

/*
 * The Vercel log drain takes a delivery only when Vercel signed it - with
 * the integration's client secret (a OneUptime resource's drains) or with
 * the project's ingestion key (a drain a team set up by hand, its secret
 * set to the key) - and queues its records as OTLP logs.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    VercelMarketplaceClientSecret: "integration-secret",
  };
});

const INGESTION_KEY: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";

const BODY: string = JSON.stringify([
  {
    id: "1",
    message: "hello from vercel",
    timestamp: 1573817187330,
    level: "info",
    source: "lambda",
    projectId: "prj_1",
    projectName: "storefront",
  },
]);

const sign: (body: Buffer | string, secret: string) => string = (
  body: Buffer | string,
  secret: string,
): string => {
  return crypto.createHmac("sha1", secret).update(body).digest("hex");
};

interface FakeResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
}

const response: () => FakeResponse = (): FakeResponse => {
  const res: FakeResponse = {
    statusCode: 0,
    body: undefined,
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    json: (body: unknown): FakeResponse => {
      res.body = body;
      return res;
    },
  };
  return res;
};

const request: (data: {
  body: Buffer;
  signature?: string;
  key?: string;
  contentEncoding?: string;
}) => ExpressRequest = (data: {
  body: Buffer;
  signature?: string;
  key?: string;
  contentEncoding?: string;
}): ExpressRequest => {
  return {
    body: data.body,
    headers: {
      "content-type": "application/json",
      ...(data.signature ? { "x-vercel-signature": data.signature } : {}),
      ...(data.key ? { "x-oneuptime-token": data.key } : {}),
      ...(data.contentEncoding
        ? { "content-encoding": data.contentEncoding }
        : {}),
    },
  } as unknown as ExpressRequest;
};

const verify: (req: ExpressRequest) => Promise<{
  res: FakeResponse;
  next: jest.Mock;
}> = async (
  req: ExpressRequest,
): Promise<{ res: FakeResponse; next: jest.Mock }> => {
  const res: FakeResponse = response();
  const next: jest.Mock = jest.fn();

  await VercelLogDrainIngestService.verifySignature(
    req,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { res, next };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VercelLogDrainIngestService.verifySignature", () => {
  it("takes a delivery Vercel signed with the integration's client secret", async () => {
    const { res, next } = await verify(
      request({
        body: Buffer.from(BODY),
        signature: sign(BODY, "integration-secret"),
        key: INGESTION_KEY,
      }),
    );

    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(0);
  });

  it("takes a drain set up by hand, signed with the ingestion key it sends", async () => {
    const { next } = await verify(
      request({
        body: Buffer.from(BODY),
        signature: sign(BODY, INGESTION_KEY),
        key: INGESTION_KEY,
      }),
    );

    expect(next).toHaveBeenCalledWith();
  });

  it("refuses a delivery Vercel did not sign, whatever key it carries", async () => {
    for (const signature of [
      undefined,
      sign(BODY, "someone-else"),
      sign(`${BODY} `, "integration-secret"),
      // Signed with a key, but not the one it sends.
      sign(BODY, "another-ingestion-key"),
    ]) {
      const { res, next } = await verify(
        request({
          body: Buffer.from(BODY),
          ...(signature ? { signature } : {}),
          key: INGESTION_KEY,
        }),
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect((res.body as { message: string }).message).toContain(
        "x-vercel-signature",
      );
    }
  });

  it("checks a compressed delivery over the bytes sent, then over the body they decompress to", async () => {
    const compressed: Buffer = zlib.gzipSync(Buffer.from(BODY));

    const overCompressed: { next: jest.Mock } = await verify(
      request({
        body: compressed,
        signature: sign(compressed, "integration-secret"),
        contentEncoding: "gzip",
      }),
    );
    expect(overCompressed.next).toHaveBeenCalledWith();

    const req: ExpressRequest = request({
      body: compressed,
      signature: sign(BODY, "integration-secret"),
      contentEncoding: "gzip",
    });
    const overDecompressed: { next: jest.Mock } = await verify(req);

    expect(overDecompressed.next).toHaveBeenCalledWith();
    // Decompressed once, for the handler.
    expect((req.body as Buffer).toString()).toBe(BODY);
    expect(req.headers["content-encoding"]).toBeUndefined();
  });
});

describe("VercelLogDrainIngestService.ingest", () => {
  let ingestLogs: jest.SpyInstance;

  beforeEach(() => {
    ingestLogs = jest
      .spyOn(OtelLogsIngestService, "ingestLogs")
      .mockResolvedValue(undefined);
  });

  it("queues the records as an OTLP logs export", async () => {
    const req: ExpressRequest = request({ body: Buffer.from(BODY) });
    const next: jest.Mock = jest.fn();

    await VercelLogDrainIngestService.ingest(
      req,
      response() as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(ingestLogs).toHaveBeenCalledTimes(1);
    const body: JSONObject = req.body as JSONObject;
    expect(Object.keys(body)).toEqual(["resourceLogs"]);
    expect(JSON.stringify(body)).toContain("hello from vercel");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(next).not.toHaveBeenCalled();
  });

  it("decompresses a delivery that is still compressed, and reads NDJSON", async () => {
    const ndjson: string = `${JSON.stringify({ id: "1", message: "a" })}\n${JSON.stringify({ id: "2", message: "b" })}\n`;
    const req: ExpressRequest = request({
      body: zlib.gzipSync(Buffer.from(ndjson)),
      contentEncoding: "gzip",
    });

    await VercelLogDrainIngestService.ingest(
      req,
      response() as unknown as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );

    const records: Array<unknown> = (
      ((req.body as JSONObject)["resourceLogs"] as Array<JSONObject>)[0]![
        "scopeLogs"
      ] as Array<JSONObject>
    )[0]!["logRecords"] as Array<unknown>;
    expect(records).toHaveLength(2);
    expect(req.headers["content-encoding"]).toBeUndefined();
  });

  it("answers an empty or test delivery with success, queueing nothing", async () => {
    const sent: jest.SpyInstance = jest
      .spyOn(Response, "sendEmptySuccessResponse")
      .mockImplementation((): void => {});

    await VercelLogDrainIngestService.ingest(
      request({ body: Buffer.from("[]") }),
      response() as unknown as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );

    expect(sent).toHaveBeenCalledTimes(1);
    expect(ingestLogs).not.toHaveBeenCalled();
  });

  it("counts a delivery as logs", () => {
    const req: TelemetryRequest = {} as TelemetryRequest;
    const next: jest.Mock = jest.fn();

    VercelLogDrainIngestService.setProductType(
      req,
      response() as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(req.productType).toBe(ProductType.Logs);
    expect(next).toHaveBeenCalled();
  });
});

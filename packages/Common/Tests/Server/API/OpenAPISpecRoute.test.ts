import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";
import OpenAPI from "../../../Server/API/OpenAPI";
import LocalCache from "../../../Server/Infrastructure/LocalCache";
import JsonToCsv from "../../../Server/Utils/JsonToCsv";
import OpenAPIUtil, {
  OpenAPISpecResponse,
} from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";

/*
 * GET /api/openapi/spec serves the spec the App built at boot and keeps
 * gzipped (OpenAPIUtil.getOpenAPISpecResponse): 0.6 MB, where the document
 * kept as objects was 33 MB of the App's heap. These hold the route to
 * serving what it served before - the same JSON, as JSON, with an ETag a
 * client can send back - now gzipped to every client that accepts gzip.
 *
 * The spec here is a small stand-in; OpenAPISpecResponse.test.ts builds the
 * real one.
 */

const DOCUMENT: JSONObject = {
  openapi: "3.0.0",
  info: {
    title: "OneUptime OpenAPI Specification",
    version: "1.0.0",
    // Past Latin-1, as the real spec's descriptions are.
    description: "Monitors \u{2014} and incidents.",
  },
  paths: { "/monitor/get-list": { post: { summary: "List monitors" } } },
};
const JSON_TEXT: string = JSON.stringify(DOCUMENT);
const SPEC: OpenAPISpecResponse = {
  gzip: zlib.gzipSync(Buffer.from(JSON_TEXT, "utf8")),
  etag: 'W/"8a-abcdefghijklmnopqrstuvwxyz0"',
  bytes: Buffer.byteLength(JSON_TEXT, "utf8"),
};

interface RawResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let server: http.Server;
let baseUrl: string = "";

function request(
  requestPath: string,
  init?: { method?: string; headers?: Record<string, string> },
): Promise<RawResult> {
  return new Promise<RawResult>(
    (resolve: (result: RawResult) => void, reject: (error: Error) => void) => {
      const clientRequest: http.ClientRequest = http.request(
        `${baseUrl}${requestPath}`,
        { method: init?.method || "GET", headers: init?.headers || {} },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });
          response.on("error", reject);
        },
      );
      clientRequest.on("error", reject);
      clientRequest.end();
    },
  );
}

beforeAll(async () => {
  jest.spyOn(OpenAPIUtil, "getOpenAPISpecResponse").mockReturnValue(SPEC);
  const buildSpy: unknown = jest.spyOn(OpenAPIUtil, "buildOpenAPISpec");
  expect(buildSpy).toBeDefined();

  const app: express.Express = express();
  app.use("/api", OpenAPI.getRouter());
  server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  jest.restoreAllMocks();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

describe("GET /api/openapi/spec", () => {
  test("sends the kept gzip as it is to a client that accepts gzip", async () => {
    const result: RawResult = await request("/api/openapi/spec", {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });

    expect(result.status).toBe(200);
    expect(result.headers["content-encoding"]).toBe("gzip");
    expect(result.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(String(result.headers["vary"])).toContain("Accept-Encoding");
    expect(result.headers["etag"]).toBe(SPEC.etag);
    expect(result.headers["content-length"]).toBe(String(SPEC.gzip.length));
    expect(result.body.equals(SPEC.gzip)).toBe(true);
    expect(JSON.parse(zlib.gunzipSync(result.body).toString("utf8"))).toEqual(
      DOCUMENT,
    );
  });

  test.each([
    ["no Accept-Encoding", {}],
    ["Accept-Encoding without gzip", { "accept-encoding": "br, deflate" }],
    ["gzip refused (q=0)", { "accept-encoding": "gzip;q=0, identity" }],
  ])(
    "sends the JSON itself to a client with %s",
    async (_name: string, headers: Record<string, string>) => {
      const result: RawResult = await request("/api/openapi/spec", {
        headers: headers,
      });

      expect(result.status).toBe(200);
      expect(result.headers["content-encoding"]).toBeUndefined();
      expect(result.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(result.headers["etag"]).toBe(SPEC.etag);
      expect(result.headers["content-length"]).toBe(String(SPEC.bytes));
      expect(result.body.toString("utf8")).toBe(JSON_TEXT);
    },
  );

  test("answers 304 to a client that has it (If-None-Match), with no body", async () => {
    const result: RawResult = await request("/api/openapi/spec", {
      headers: { "if-none-match": SPEC.etag, "accept-encoding": "gzip" },
    });

    expect(result.status).toBe(304);
    expect(result.headers["etag"]).toBe(SPEC.etag);
    expect(result.body.length).toBe(0);
  });

  test("sends it again to a client with another ETag", async () => {
    const result: RawResult = await request("/api/openapi/spec", {
      headers: { "if-none-match": 'W/"1-other"' },
    });

    expect(result.status).toBe(200);
    expect(result.body.toString("utf8")).toBe(JSON_TEXT);
  });

  test("answers HEAD with the headers alone", async () => {
    const result: RawResult = await request("/api/openapi/spec", {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
    });

    expect(result.status).toBe(200);
    expect(result.headers["content-encoding"]).toBe("gzip");
    expect(result.headers["content-length"]).toBe(String(SPEC.gzip.length));
    expect(result.body.length).toBe(0);
  });

  test("still takes ?output-type=csv, as every JSON response does", async () => {
    const result: RawResult = await request(
      "/api/openapi/spec?output-type=csv",
    );

    expect(result.status).toBe(200);
    expect(result.body.toString("utf8")).toBe(JsonToCsv.ToCsv([DOCUMENT]));
  });

  test("serves the kept response: it never builds the spec or keeps the document", async () => {
    await request("/api/openapi/spec", {
      headers: { "accept-encoding": "gzip" },
    });

    expect(OpenAPIUtil.buildOpenAPISpec).not.toHaveBeenCalled();
    expect(LocalCache.getJSON("openapi", "spec")).toBeUndefined();
  });
});

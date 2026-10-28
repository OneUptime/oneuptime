import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import zlib from "zlib";
import LocalCache from "../../../Server/Infrastructure/LocalCache";
import OpenAPIUtil, {
  OpenAPISpecResponse,
} from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";

/*
 * The App builds the OpenAPI spec at boot and keeps only its gzipped JSON
 * (OpenAPIUtil.getOpenAPISpecResponse), which GET /api/openapi/spec serves:
 * 0.6 MB, where generateOpenAPISpec's document kept 33 MB of the App's heap.
 * These build the real spec and hold the kept response to being exactly
 * that document, as JSON, without the App keeping the document itself.
 */

const WEAK_ETAG: RegExp = /^W\/"[0-9a-f]+-[A-Za-z0-9+/]{27}"$/u;

describe("the OpenAPI spec the App keeps", () => {
  let response: OpenAPISpecResponse;
  let json: string = "";

  test("is built without keeping the document", () => {
    expect(LocalCache.getJSON("openapi", "spec")).toBeUndefined();

    response = OpenAPIUtil.getOpenAPISpecResponse();
    json = zlib.gunzipSync(response.gzip).toString("utf8");

    // The 33 MB document is garbage once its JSON is gzipped.
    expect(LocalCache.getJSON("openapi", "spec")).toBeUndefined();
    expect(json.length).toBeGreaterThan(1000000);
  }, 180000);

  test("is kept: asked again, it is the same response, built once", () => {
    expect(OpenAPIUtil.getOpenAPISpecResponse()).toBe(response);
  });

  test("is the document generateOpenAPISpec builds, as JSON, byte for byte", () => {
    const document: JSONObject = OpenAPIUtil.generateOpenAPISpec();

    expect(json).toBe(JSON.stringify(document));
    expect(response.bytes).toBe(Buffer.byteLength(json, "utf8"));
  }, 180000);

  test("is a fraction of the JSON's size, in a buffer of its own", () => {
    expect(response.gzip.length).toBeLessThan(response.bytes / 10);
    // Not a slice that keeps a bigger buffer alive.
    expect(response.gzip.buffer.byteLength - response.gzip.length).toBeLessThan(
      64 * 1024,
    );
  });

  test("has a weak ETag of the JSON: its length and its SHA-1", () => {
    const buffer: Buffer = Buffer.from(json, "utf8");
    const hash: string = crypto
      .createHash("sha1")
      .update(buffer)
      .digest("base64")
      .slice(0, 27);

    expect(response.etag).toMatch(WEAK_ETAG);
    expect(response.etag).toBe(`W/"${buffer.length.toString(16)}-${hash}"`);
  });

  test("is still a well-formed OpenAPI 3 document", () => {
    const document: JSONObject = JSON.parse(json) as JSONObject;

    expect(String(document["openapi"])).toMatch(/^3\./u);
    expect(Object.keys(document["paths"] as JSONObject).length).toBeGreaterThan(
      100,
    );
    expect(
      Object.keys(
        (document["components"] as JSONObject)["schemas"] as JSONObject,
      ).length,
    ).toBeGreaterThan(100);
  });
});

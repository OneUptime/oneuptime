import TaxiiClient, {
  TAXII_DATE_ADDED_LAST_HEADER,
  TAXII_MEDIA_TYPE,
  TaxiiObjectsPage,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/TaxiiClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The TAXII 2.1 client contract: request construction (URL, media type,
 * auth precedence) and envelope/header parsing — everything the poller
 * depends on but cannot see from its own call site. The transport is the
 * injected seam, so these tests exercise the real code against fixtures
 * with no network and no DNS.
 */

const API_ROOT: string = "https://taxii.example.com/api1/";
const COLLECTION_ID: string = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";

interface CapturedRequest {
  request: DataSourceHttpRequest | null;
}

function buildClient(options: {
  apiToken?: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  apiRootUrl?: string;
  response?: Partial<DataSourceHttpResponse>;
  captured?: CapturedRequest;
}): TaxiiClient {
  return new TaxiiClient({
    apiRootUrl: options.apiRootUrl || API_ROOT,
    collectionId: COLLECTION_ID,
    apiToken: options.apiToken,
    basicAuthUsername: options.basicAuthUsername,
    basicAuthPassword: options.basicAuthPassword,
    fetchImplementation: (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (options.captured) {
        options.captured.request = request;
      }

      return Promise.resolve({
        statusCode: 200,
        bodyText: "",
        bodyJson: { objects: [], more: false },
        headers: {},
        ...options.response,
      });
    },
  });
}

describe("TaxiiClient — validation", () => {
  test("accepts http(s) roots and rejects everything else", () => {
    expect(() => {
      return TaxiiClient.validateApiRootUrl("https://taxii.example.com/api1/");
    }).not.toThrow();
    expect(() => {
      return TaxiiClient.validateApiRootUrl("http://taxii.internal:9000/root");
    }).not.toThrow();

    expect(() => {
      return TaxiiClient.validateApiRootUrl("not a url");
    }).toThrow(BadDataException);
    expect(() => {
      return TaxiiClient.validateApiRootUrl("ftp://taxii.example.com/");
    }).toThrow(BadDataException);
    expect(() => {
      return TaxiiClient.validateApiRootUrl(
        "https://taxii.example.com/api1/?next=abc",
      );
    }).toThrow(BadDataException);
    expect(() => {
      return TaxiiClient.validateApiRootUrl("");
    }).toThrow(BadDataException);
  });

  test("collection ids are plain identifiers — no slashes, no spaces", () => {
    expect(() => {
      return TaxiiClient.validateCollectionId(COLLECTION_ID);
    }).not.toThrow();
    expect(() => {
      return TaxiiClient.validateCollectionId("collection_1.v2-x~y");
    }).not.toThrow();

    expect(() => {
      return TaxiiClient.validateCollectionId("");
    }).toThrow(BadDataException);
    expect(() => {
      return TaxiiClient.validateCollectionId("a/b");
    }).toThrow(BadDataException);
    expect(() => {
      return TaxiiClient.validateCollectionId("a b");
    }).toThrow(BadDataException);
    expect(() => {
      return TaxiiClient.validateCollectionId("a?b=c");
    }).toThrow(BadDataException);
  });
});

describe("TaxiiClient — request construction", () => {
  test("builds the objects URL with match[type]=indicator, limit, added_after and next", () => {
    const client: TaxiiClient = buildClient({});

    const url: string = client.buildObjectsUrl({
      limit: 500,
      addedAfter: "2026-08-01T00:00:00.000Z",
      next: "page-2-token",
    });

    expect(url).toContain(
      `https://taxii.example.com/api1/collections/${COLLECTION_ID}/objects/?`,
    );
    expect(url).toContain("limit=500");
    expect(url).toContain("added_after=2026-08-01T00%3A00%3A00.000Z");
    expect(url).toContain("next=page-2-token");
    // URLSearchParams percent-encodes the brackets; the server decodes them.
    expect(url).toContain("match%5Btype%5D=indicator");
  });

  test("a root without a trailing slash gets one — the collection path never fuses onto the root", () => {
    const client: TaxiiClient = buildClient({
      apiRootUrl: "https://taxii.example.com/api1",
    });

    expect(client.buildObjectsUrl({ limit: 10 })).toContain(
      "/api1/collections/",
    );
  });

  test("sends the TAXII 2.1 media type on every request", async () => {
    const captured: CapturedRequest = { request: null };
    const client: TaxiiClient = buildClient({ captured });

    await client.fetchIndicatorObjects({ limit: 10 });

    expect(captured.request?.headers?.["Accept"]).toBe(TAXII_MEDIA_TYPE);
    expect(captured.request?.method).toBe("GET");
    expect(captured.request?.timeoutInMs).toBeGreaterThan(0);
  });

  test("anonymous collections send no Authorization header", async () => {
    const captured: CapturedRequest = { request: null };
    const client: TaxiiClient = buildClient({ captured });

    await client.fetchIndicatorObjects({ limit: 10 });

    expect(captured.request?.headers?.["Authorization"]).toBeUndefined();
  });

  test("an API token becomes a Bearer header and wins over basic auth", async () => {
    const captured: CapturedRequest = { request: null };
    const client: TaxiiClient = buildClient({
      captured,
      apiToken: "secret-token",
      basicAuthUsername: "alice",
      basicAuthPassword: "hunter2",
    });

    await client.fetchIndicatorObjects({ limit: 10 });

    expect(captured.request?.headers?.["Authorization"]).toBe(
      "Bearer secret-token",
    );
  });

  test("basic-auth credentials become a base64 Basic header", async () => {
    const captured: CapturedRequest = { request: null };
    const client: TaxiiClient = buildClient({
      captured,
      basicAuthUsername: "alice",
      basicAuthPassword: "hunter2",
    });

    await client.fetchIndicatorObjects({ limit: 10 });

    const expected: string = `Basic ${Buffer.from("alice:hunter2").toString(
      "base64",
    )}`;
    expect(captured.request?.headers?.["Authorization"]).toBe(expected);
  });
});

describe("TaxiiClient — response parsing", () => {
  test("parses envelope objects, more, next and the date-added-last header", async () => {
    const indicator: JSONObject = {
      type: "indicator",
      id: "indicator--0001",
    };

    const client: TaxiiClient = buildClient({
      response: {
        bodyJson: {
          objects: [indicator],
          more: true,
          next: "token-2",
        },
        headers: {
          [TAXII_DATE_ADDED_LAST_HEADER]: "2026-08-27T10:00:00.000Z",
        },
      },
    });

    const page: TaxiiObjectsPage = await client.fetchIndicatorObjects({
      limit: 10,
    });

    expect(page.objects).toEqual([indicator]);
    expect(page.more).toBe(true);
    expect(page.next).toBe("token-2");
    expect(page.dateAddedLast).toBe("2026-08-27T10:00:00.000Z");
  });

  test("an envelope with no objects, no more and no header parses to the empty page", async () => {
    const client: TaxiiClient = buildClient({
      response: { bodyJson: {} },
    });

    const page: TaxiiObjectsPage = await client.fetchIndicatorObjects({
      limit: 10,
    });

    expect(page.objects).toEqual([]);
    expect(page.more).toBe(false);
    expect(page.next).toBeNull();
    expect(page.dateAddedLast).toBeNull();
  });

  test("non-object entries inside objects are dropped, not crashed on", async () => {
    const client: TaxiiClient = buildClient({
      response: {
        bodyJson: {
          objects: [{ type: "indicator", id: "x" }, "garbage", 42, null, []],
        },
      },
    });

    const page: TaxiiObjectsPage = await client.fetchIndicatorObjects({
      limit: 10,
    });

    expect(page.objects).toEqual([{ type: "indicator", id: "x" }]);
  });

  test("a response with headers missing entirely still parses (older transports)", async () => {
    const client: TaxiiClient = buildClient({
      response: { bodyJson: { objects: [] }, headers: undefined },
    });

    const page: TaxiiObjectsPage = await client.fetchIndicatorObjects({
      limit: 10,
    });

    expect(page.dateAddedLast).toBeNull();
  });

  test("a non-envelope body is an error, not an empty page — silence would look like a drained feed", async () => {
    const clientArray: TaxiiClient = buildClient({
      response: { bodyJson: ["not", "an", "envelope"] },
    });

    await expect(
      clientArray.fetchIndicatorObjects({ limit: 10 }),
    ).rejects.toThrow(BadDataException);

    const clientText: TaxiiClient = buildClient({
      response: { bodyJson: undefined, bodyText: "<html>login</html>" },
    });

    await expect(
      clientText.fetchIndicatorObjects({ limit: 10 }),
    ).rejects.toThrow(BadDataException);
  });
});

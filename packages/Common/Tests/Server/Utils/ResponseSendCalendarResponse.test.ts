import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil, {
  CALENDAR_RESPONSE_CONTENT_TYPE,
  CALENDAR_RESPONSE_FILE_NAME,
  CALENDAR_RESPONSE_MAX_AGE_SECONDS,
} from "../../../Server/Utils/Response";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { createHash } from "crypto";

/*
 * sendCalendarResponse is what every on-call calendar feed goes out through,
 * and calendar clients are unforgiving about headers: Google refuses a feed
 * whose Content-Type is not text/calendar, Outlook re-fetches on every open
 * when it sees Pragma: no-cache next to a max-age, and a missing ETag or
 * Last-Modified turns every hourly poll into a full download. These tests pin
 * the header set, the one header that must be ABSENT, and the conditional
 * request behaviour Express provides on top.
 */

const SAMPLE_BODY: string =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//OneUptime//On-Call//EN\r\nEND:VCALENDAR\r\n";

const SAMPLE_LAST_MODIFIED: Date = new Date("2026-08-30T10:11:12.345Z");

interface CapturedResponse {
  headers: Record<string, string>;
  removedHeaders: Array<string>;
  statusCode: number | null;
  body: unknown;
  logBody: unknown;
}

function buildFakeResponse(): {
  response: ExpressResponse;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = {
    headers: {},
    removedHeaders: [],
    statusCode: null,
    body: undefined,
    logBody: undefined,
  };

  const response: Record<string, unknown> = {
    set: (key: string, value: string): void => {
      captured.headers[key] = value;
    },
    setHeader: (key: string, value: string): void => {
      captured.headers[key] = value;
    },
    removeHeader: (key: string): void => {
      captured.removedHeaders.push(key);
      delete captured.headers[key];
    },
    status: (code: number): unknown => {
      captured.statusCode = code;
      return response;
    },
    send: (body: unknown): void => {
      captured.body = body;
    },
  };

  Object.defineProperty(response, "logBody", {
    set: (value: unknown): void => {
      captured.logBody = value;
    },
    get: (): unknown => {
      return captured.logBody;
    },
  });

  return {
    response: response as unknown as ExpressResponse,
    captured,
  };
}

describe("Response.getCalendarETag", () => {
  test("is the quoted first 32 hex characters of the body's SHA-256", () => {
    const expected: string = createHash("sha256")
      .update(SAMPLE_BODY, "utf8")
      .digest("hex")
      .slice(0, 32);

    expect(ResponseUtil.getCalendarETag(SAMPLE_BODY)).toBe(`"${expected}"`);
    expect(ResponseUtil.getCalendarETag(SAMPLE_BODY)).toHaveLength(34);
  });

  test("is a strong tag, never W/-prefixed", () => {
    expect(ResponseUtil.getCalendarETag(SAMPLE_BODY).startsWith("W/")).toBe(
      false,
    );
  });

  test("is deterministic for the same bytes", () => {
    expect(ResponseUtil.getCalendarETag(SAMPLE_BODY)).toBe(
      ResponseUtil.getCalendarETag(SAMPLE_BODY),
    );
  });

  test("changes when a single byte of the body changes", () => {
    expect(ResponseUtil.getCalendarETag(SAMPLE_BODY)).not.toBe(
      ResponseUtil.getCalendarETag(SAMPLE_BODY.replace("2.0", "2.1")),
    );
  });

  test("hashes UTF-8 bytes, so two bodies differing only in a multi-byte character differ", () => {
    expect(ResponseUtil.getCalendarETag("SUMMARY:Åsa")).not.toBe(
      ResponseUtil.getCalendarETag("SUMMARY:Asa"),
    );
  });
});

describe("Response.sendCalendarResponse (unit)", () => {
  let nowSpy: ReturnType<typeof jest.spyOn>;
  const NOW: number = Date.parse("2026-08-31T12:00:00.000Z");

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return NOW;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function send(overrides: {
    body?: string;
    etag?: string;
    lastModified?: Date;
    prepare?: (response: ExpressResponse) => void;
  }): CapturedResponse {
    const { response, captured } = buildFakeResponse();

    if (overrides.prepare) {
      overrides.prepare(response);
    }

    ResponseUtil.sendCalendarResponse({} as ExpressRequest, response, {
      body: overrides.body ?? SAMPLE_BODY,
      etag: overrides.etag ?? ResponseUtil.getCalendarETag(SAMPLE_BODY),
      lastModified: overrides.lastModified ?? SAMPLE_LAST_MODIFIED,
    });

    return captured;
  }

  test("sends the body with a 200", () => {
    const captured: CapturedResponse = send({});

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toBe(SAMPLE_BODY);
  });

  test("declares text/calendar with a UTF-8 charset", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Content-Type"]).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(CALENDAR_RESPONSE_CONTENT_TYPE).toBe("text/calendar; charset=utf-8");
  });

  test("is inline with the documented .ics filename", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Content-Disposition"]).toBe(
      'inline; filename="oneuptime-on-call.ics"',
    );
    expect(CALENDAR_RESPONSE_FILE_NAME).toBe("oneuptime-on-call.ics");
  });

  test("is private with a 300 second max-age", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Cache-Control"]).toBe("private, max-age=300");
    expect(CALENDAR_RESPONSE_MAX_AGE_SECONDS).toBe(300);
  });

  test("never marks the body public or shared-cacheable", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Cache-Control"]).not.toMatch(/public/);
    expect(captured.headers["Cache-Control"]).not.toMatch(/s-maxage/);
  });

  test("sets Expires 300 seconds from now, in RFC 1123 form", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Expires"]).toBe(
      new Date(NOW + 300 * 1000).toUTCString(),
    );
    expect(captured.headers["Expires"]).toBe("Mon, 31 Aug 2026 12:05:00 GMT");
  });

  test("sets Last-Modified from the supplied date, in RFC 1123 form", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Last-Modified"]).toBe(
      "Sun, 30 Aug 2026 10:11:12 GMT",
    );
  });

  test("passes a quoted strong ETag through unchanged", () => {
    const etag: string = ResponseUtil.getCalendarETag(SAMPLE_BODY);
    const captured: CapturedResponse = send({ etag });

    expect(captured.headers["ETag"]).toBe(etag);
  });

  test("quotes a bare ETag", () => {
    const captured: CapturedResponse = send({ etag: "abcdef0123456789" });

    expect(captured.headers["ETag"]).toBe('"abcdef0123456789"');
  });

  test("strengthens a weak ETag", () => {
    const captured: CapturedResponse = send({ etag: 'W/"abcdef"' });

    expect(captured.headers["ETag"]).toBe('"abcdef"');
  });

  test("strips characters that would break the ETag header", () => {
    const captured: CapturedResponse = send({ etag: 'ab"c\r\nd' });

    expect(captured.headers["ETag"]).toBe('"abcd"');
  });

  test("forbids sniffing and indexing", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(captured.headers["X-Robots-Tag"]).toBe("noindex");
  });

  test("sends no Pragma header", () => {
    const captured: CapturedResponse = send({});

    expect(captured.headers["Pragma"]).toBeUndefined();
    expect(captured.removedHeaders).toContain("Pragma");
  });

  /*
   * The reason this helper exists rather than sendCustomResponse: a
   * no-cache middleware upstream may already have stamped the trio, and the
   * feed must undo all three, not just two.
   */
  test("removes a Pragma set earlier and overrides an earlier no-store", () => {
    const captured: CapturedResponse = send({
      prepare: (response: ExpressResponse): void => {
        ResponseUtil.setNoCacheHeaders(response);
      },
    });

    expect(captured.headers["Pragma"]).toBeUndefined();
    expect(captured.headers["Cache-Control"]).toBe("private, max-age=300");
    expect(captured.headers["Expires"]).not.toBe("0");
  });

  test("sends exactly the documented header set", () => {
    const captured: CapturedResponse = send({});

    expect(Object.keys(captured.headers).sort()).toEqual(
      [
        "Cache-Control",
        "Content-Disposition",
        "Content-Type",
        "ETag",
        "Expires",
        "Last-Modified",
        "X-Content-Type-Options",
        "X-Robots-Tag",
      ].sort(),
    );
  });

  test("logs the size and type of what went out, never the body", () => {
    const captured: CapturedResponse = send({});

    expect(captured.logBody).toEqual({
      contentType: "text/calendar; charset=utf-8",
      bytes: Buffer.byteLength(SAMPLE_BODY, "utf8"),
    });
    expect(JSON.stringify(captured.logBody)).not.toContain("VCALENDAR");
  });

  test("counts bytes, not characters, in the log", () => {
    const body: string = "SUMMARY:Åsa Ö\r\n";
    const captured: CapturedResponse = send({ body });

    expect((captured.logBody as { bytes: number }).bytes).toBe(
      Buffer.byteLength(body, "utf8"),
    );
    expect((captured.logBody as { bytes: number }).bytes).toBeGreaterThan(
      body.length,
    );
  });

  test("does not inspect the request", () => {
    const { response, captured } = buildFakeResponse();

    expect(() => {
      ResponseUtil.sendCalendarResponse(
        undefined as unknown as ExpressRequest,
        response,
        {
          body: SAMPLE_BODY,
          etag: "x",
          lastModified: SAMPLE_LAST_MODIFIED,
        },
      );
    }).not.toThrow();

    expect(captured.statusCode).toBe(200);
  });
});

/*
 * The conditional-request and HEAD behaviour is Express's, driven by the
 * headers the helper sets. That only shows up against a real response object,
 * so these run a throwaway Express app on an ephemeral port.
 */
describe("Response.sendCalendarResponse (through Express)", () => {
  let server: http.Server;
  let baseUrl: string;

  const etag: string = ResponseUtil.getCalendarETag(SAMPLE_BODY);

  beforeAll(async () => {
    const app: express.Express = express();

    app.get("/feed.ics", (req: express.Request, res: express.Response) => {
      ResponseUtil.sendCalendarResponse(
        req as unknown as ExpressRequest,
        res as unknown as ExpressResponse,
        {
          body: SAMPLE_BODY,
          etag,
          lastModified: SAMPLE_LAST_MODIFIED,
        },
      );
    });

    /* A route that stamps the no-cache trio first, as a middleware might. */
    app.get(
      "/feed-after-nocache.ics",
      (req: express.Request, res: express.Response) => {
        ResponseUtil.setNoCacheHeaders(res as unknown as ExpressResponse);
        ResponseUtil.sendCalendarResponse(
          req as unknown as ExpressRequest,
          res as unknown as ExpressResponse,
          {
            body: SAMPLE_BODY,
            etag,
            lastModified: SAMPLE_LAST_MODIFIED,
          },
        );
      },
    );

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address: AddressInfo = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  interface HttpResult {
    status: number;
    headers: Headers;
    body: string;
  }

  /*
   * A header bag with the `get()` shape of the Fetch API's Headers, over
   * Node's lower-cased IncomingHttpHeaders. The jest environment here is
   * jsdom, which has no fetch, so the request goes out through http.request.
   */
  class Headers {
    public constructor(private raw: http.IncomingHttpHeaders) {}

    public get(name: string): string | null {
      const value: string | Array<string> | undefined =
        this.raw[name.toLowerCase()];

      if (value === undefined) {
        return null;
      }

      return Array.isArray(value) ? value.join(", ") : value;
    }
  }

  function request(
    path: string,
    init?: { method?: string; headers?: Record<string, string> },
  ): Promise<HttpResult> {
    return new Promise<HttpResult>(
      (
        resolve: (result: HttpResult) => void,
        reject: (error: Error) => void,
      ) => {
        const clientRequest: http.ClientRequest = http.request(
          `${baseUrl}${path}`,
          { method: init?.method || "GET", headers: init?.headers || {} },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                headers: new Headers(response.headers),
                body: Buffer.concat(chunks).toString("utf8"),
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

  test("a plain GET is a 200 with the body and the calendar headers", async () => {
    const result: HttpResult = await request("/feed.ics");

    expect(result.status).toBe(200);
    expect(result.body).toBe(SAMPLE_BODY);
    expect(result.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(result.headers.get("etag")).toBe(etag);
    expect(result.headers.get("last-modified")).toBe(
      "Sun, 30 Aug 2026 10:11:12 GMT",
    );
    expect(result.headers.get("cache-control")).toBe("private, max-age=300");
    expect(result.headers.get("content-disposition")).toBe(
      'inline; filename="oneuptime-on-call.ics"',
    );
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("x-robots-tag")).toBe("noindex");
    expect(result.headers.get("pragma")).toBeNull();
  });

  test("Express keeps our strong ETag rather than generating its own weak one", async () => {
    const result: HttpResult = await request("/feed.ics");

    expect(result.headers.get("etag")).toBe(etag);
    expect(result.headers.get("etag")?.startsWith("W/")).toBe(false);
  });

  test("If-None-Match with the current ETag is answered 304 with no body", async () => {
    const result: HttpResult = await request("/feed.ics", {
      headers: { "If-None-Match": etag },
    });

    expect(result.status).toBe(304);
    expect(result.body).toBe("");
  });

  test("a weak If-None-Match still matches (clients such as Outlook send W/)", async () => {
    const result: HttpResult = await request("/feed.ics", {
      headers: { "If-None-Match": `W/${etag}` },
    });

    expect(result.status).toBe(304);
  });

  test("If-None-Match with a stale ETag gets the full body", async () => {
    const result: HttpResult = await request("/feed.ics", {
      headers: { "If-None-Match": '"stale"' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe(SAMPLE_BODY);
  });

  test("If-Modified-Since at or after Last-Modified is answered 304", async () => {
    const result: HttpResult = await request("/feed.ics", {
      headers: { "If-Modified-Since": "Sun, 30 Aug 2026 10:11:12 GMT" },
    });

    expect(result.status).toBe(304);
  });

  test("If-Modified-Since before Last-Modified gets the full body", async () => {
    const result: HttpResult = await request("/feed.ics", {
      headers: { "If-Modified-Since": "Sat, 29 Aug 2026 00:00:00 GMT" },
    });

    expect(result.status).toBe(200);
  });

  /*
   * Google's fetcher sends Cache-Control: no-cache with its If-None-Match,
   * and Express's `fresh` treats that as "do not answer 304". Pinned so the
   * ETag tests above are not read as a promise about Google.
   */
  test("a client that sends Cache-Control: no-cache gets the full body even with a matching ETag", async () => {
    const result: HttpResult = await request("/feed.ics", {
      headers: { "If-None-Match": etag, "Cache-Control": "no-cache" },
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe(SAMPLE_BODY);
  });

  test("HEAD is answered natively with the headers and no body", async () => {
    const result: HttpResult = await request("/feed.ics", { method: "HEAD" });

    expect(result.status).toBe(200);
    expect(result.body).toBe("");
    expect(result.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(result.headers.get("etag")).toBe(etag);
    expect(result.headers.get("content-length")).toBe(
      String(Buffer.byteLength(SAMPLE_BODY, "utf8")),
    );
  });

  test("a Pragma stamped by an earlier middleware does not reach the wire", async () => {
    const result: HttpResult = await request("/feed-after-nocache.ics");

    expect(result.status).toBe(200);
    expect(result.headers.get("pragma")).toBeNull();
    expect(result.headers.get("cache-control")).toBe("private, max-age=300");
    expect(result.headers.get("expires")).not.toBe("0");
  });
});

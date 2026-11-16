import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil from "../../../Server/Utils/Response";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

jest.mock("../../../Server/Utils/Logger");

/*
 * sendCachedFileResponse is how a status page's images go out from memory
 * (StatusPageImageCache): the safe Content-Type and Content-Disposition of
 * sendFileResponse, the Cache-Control its caller chose, a strong ETag - and
 * 304 with no body to a browser whose If-None-Match names it. Pinned on a
 * stand-in response, and end to end through a real Express server.
 */

const BYTES: Buffer = Buffer.from("PNG image bytes");
const ETAG: string = '"0123456789abcdef0123456789abcdef"';
const CACHE_CONTROL: string = "public, max-age=300";

interface Captured {
  headers: Record<string, string>;
  removed: Array<string>;
  status: number | null;
  body: unknown;
  ended: boolean;
}

function fakeResponse(): { response: ExpressResponse; captured: Captured } {
  const captured: Captured = {
    headers: {},
    removed: [],
    status: null,
    body: undefined,
    ended: false,
  };

  const response: Record<string, unknown> = {
    set: (key: string, value: string): void => {
      captured.headers[key.toLowerCase()] = value;
    },
    setHeader: (key: string, value: string): void => {
      captured.headers[key.toLowerCase()] = value;
    },
    removeHeader: (key: string): void => {
      captured.removed.push(key);
      delete captured.headers[key.toLowerCase()];
    },
    status: (code: number): unknown => {
      captured.status = code;
      return response;
    },
    send: (body: unknown): void => {
      captured.body = body;
    },
    end: (): void => {
      captured.ended = true;
    },
  };

  return { response: response as unknown as ExpressResponse, captured };
}

function requestWith(ifNoneMatch?: string | Array<string>): ExpressRequest {
  return {
    headers: ifNoneMatch === undefined ? {} : { "if-none-match": ifNoneMatch },
  } as unknown as ExpressRequest;
}

function send(
  ifNoneMatch?: string | Array<string>,
  file?: { fileType?: string; name?: string },
): Captured {
  const { response, captured } = fakeResponse();

  // As an earlier middleware might have left them.
  captured.headers["pragma"] = "no-cache";
  captured.headers["expires"] = "0";

  ResponseUtil.sendCachedFileResponse(
    requestWith(ifNoneMatch),
    response,
    {
      bytes: BYTES,
      fileType: file?.fileType ?? "image/png",
      name: file?.name ?? "logo.png",
      etag: ETAG,
    },
    CACHE_CONTROL,
  );

  return captured;
}

describe("Response.sendCachedFileResponse", () => {
  test("sends the bytes with the Cache-Control asked for, the ETag, and the safe file headers", () => {
    const captured: Captured = send();

    expect(captured.status).toBe(200);
    expect(captured.body).toBe(BYTES);
    expect(captured.headers["cache-control"]).toBe(CACHE_CONTROL);
    expect(captured.headers["etag"]).toBe(ETAG);
    expect(captured.headers["content-type"]).toBe("image/png");
    expect(captured.headers["x-content-type-options"]).toBe("nosniff");
    expect(captured.headers["content-security-policy"]).toContain("sandbox");
    expect(captured.headers["x-frame-options"]).toBe("DENY");
    expect(captured.headers["content-disposition"]).toMatch(/^inline;/);
  });

  test("takes off the no-cache headers an earlier middleware set: max-age and no-cache together are asked for every time", () => {
    const captured: Captured = send();

    expect(captured.headers["pragma"]).toBeUndefined();
    expect(captured.headers["expires"]).toBeUndefined();
    expect(captured.removed).toEqual(
      expect.arrayContaining(["Pragma", "Expires"]),
    );
  });

  test.each([
    ["the tag itself", ETAG],
    ["its weak form", `W/${ETAG}`],
    ["the tag among others", `"another", ${ETAG}, "a third"`],
    ["any tag", "*"],
    ["the tag in a repeated header", ['"another"', ETAG]],
  ])(
    "answers 304 with no body to a browser whose If-None-Match names %s",
    (_name: string, ifNoneMatch: string | Array<string>) => {
      const captured: Captured = send(ifNoneMatch);

      expect(captured.status).toBe(304);
      expect(captured.ended).toBe(true);
      expect(captured.body).toBeUndefined();
      expect(captured.headers["etag"]).toBe(ETAG);
      expect(captured.headers["cache-control"]).toBe(CACHE_CONTROL);
      // As res.send answers a 304: no Content-Type either.
      expect(captured.headers["content-type"]).toBeUndefined();
    },
  );

  test.each([
    ["no If-None-Match", undefined],
    ["an empty one", ""],
    ["another tag", '"another"'],
    ["a tag that only starts like it", ETAG.slice(0, 10)],
  ])("sends the bytes for %s", (_name: string, ifNoneMatch?: string) => {
    const captured: Captured = send(ifNoneMatch);

    expect(captured.status).toBe(200);
    expect(captured.body).toBe(BYTES);
  });

  test("a type it does not know goes out as opaque bytes, to download - never rendered", () => {
    const captured: Captured = send(undefined, { fileType: "text/html" });

    expect(captured.headers["content-type"]).toBe("application/octet-stream");
    expect(captured.headers["content-disposition"]).toMatch(/^attachment;/);
  });
});

describe("Response.isETagMatched", () => {
  test("never matches a request without If-None-Match", () => {
    expect(ResponseUtil.isETagMatched(requestWith(), ETAG)).toBe(false);
  });

  test("compares weakly, whichever side is weak", () => {
    expect(ResponseUtil.isETagMatched(requestWith(ETAG), `W/${ETAG}`)).toBe(
      true,
    );
    expect(ResponseUtil.isETagMatched(requestWith(`W/${ETAG}`), ETAG)).toBe(
      true,
    );
  });
});

describe("Response.sendCachedFileResponse through Express", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app: express.Express = express();

    app.get("/image", (req: express.Request, res: express.Response) => {
      ResponseUtil.sendCachedFileResponse(
        req as unknown as ExpressRequest,
        res as unknown as ExpressResponse,
        { bytes: BYTES, fileType: "image/png", name: "logo.png", etag: ETAG },
        CACHE_CONTROL,
      );
    });

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  function get(headers?: Record<string, string>): Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }> {
    return new Promise(
      (
        resolve: (value: {
          status: number;
          headers: http.IncomingHttpHeaders;
          body: Buffer;
        }) => void,
        reject: (err: Error) => void,
      ) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            path: "/image",
            method: "GET",
            headers: headers || {},
          },
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
          },
        );

        request.on("error", reject);
        request.end();
      },
    );
  }

  test("a first request gets the image, its ETag and its Cache-Control", async () => {
    const answer: {
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
    } = await get();

    expect(answer.status).toBe(200);
    expect(answer.body.equals(BYTES)).toBe(true);
    expect(answer.headers["etag"]).toBe(ETAG);
    expect(answer.headers["cache-control"]).toBe(CACHE_CONTROL);
  });

  test("a browser that has it gets 304 and no body", async () => {
    const answer: {
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
    } = await get({ "If-None-Match": ETAG });

    expect(answer.status).toBe(304);
    expect(answer.body.length).toBe(0);
    expect(answer.headers["etag"]).toBe(ETAG);
    expect(answer.headers["cache-control"]).toBe(CACHE_CONTROL);
  });

  test("a browser holding an older image gets the new one", async () => {
    const answer: {
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
    } = await get({ "If-None-Match": '"an-older-image"' });

    expect(answer.status).toBe(200);
    expect(answer.body.equals(BYTES)).toBe(true);
  });
});

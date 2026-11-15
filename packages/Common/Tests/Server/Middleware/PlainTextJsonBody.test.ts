import GzipRequestBodyMiddleware from "../../../Server/Middleware/GzipRequestBody";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  NextFunction,
} from "../../../Server/Utils/Express";
import PlainTextJsonBody, {
  TEXT_BODY_CONTENT_TYPE,
} from "../../../Server/Middleware/PlainTextJsonBody";
import { JSONObject } from "../../../Types/JSON";
import {
  SNS_CONFIRMATION_HEADERS,
  snsSubscriptionConfirmation,
} from "../../Utils/Monitor/SubscriptionConfirmationFixtures";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";

/*
 * JSON SENT AS TEXT/PLAIN IS READ AS JSON.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * Amazon SNS posts its subscription confirmations and notifications as JSON
 * with "Content-Type: text/plain; charset=UTF-8", and an Incoming Request
 * monitor read only JSON and form bodies: an SNS topic pointed at a monitor
 * delivered empty bodies. A text/plain body is now kept as the JSON object
 * or array it holds; any other text still arrives empty, and nothing that
 * was accepted is refused.
 */

describe("the body a text/plain request is kept as", () => {
  test("a JSON object is kept as the object", () => {
    expect(
      PlainTextJsonBody.fromText(JSON.stringify(snsSubscriptionConfirmation())),
    ).toEqual(snsSubscriptionConfirmation());
  });

  test("a JSON array is kept as the array", () => {
    expect(PlainTextJsonBody.fromText('[{"a":1},{"b":2}]')).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  test("JSON after a byte order mark is still JSON", () => {
    expect(PlainTextJsonBody.fromText('﻿{"status":"up"}')).toEqual({
      status: "up",
    });
  });

  test("JSON with whitespace around it is still JSON", () => {
    expect(PlainTextJsonBody.fromText('\n  {"status":"up"}\n')).toEqual({
      status: "up",
    });
  });

  test.each([
    ["plain text", "backup finished"],
    ["text that only starts like JSON", '{"status": "up"'],
    ["a JSON string", '"error"'],
    ["a JSON number", "42"],
    ["JSON true", "true"],
    ["JSON null", "null"],
    ["nothing", ""],
  ])("%s is kept empty, as before", (_label: string, text: string) => {
    expect(PlainTextJsonBody.fromText(text)).toEqual({});
  });

  test.each([
    ["undefined", undefined],
    ["a Buffer", Buffer.from('{"a":1}')],
    ["an object", { a: 1 }],
  ])(
    "%s, which is not text, is kept empty",
    (_label: string, value: unknown) => {
      expect(PlainTextJsonBody.fromText(value)).toEqual({});
    },
  );

  test("reads the type SNS sends", () => {
    expect(TEXT_BODY_CONTENT_TYPE).toBe("text/plain");
    expect(SNS_CONFIRMATION_HEADERS["content-type"]).toContain(
      TEXT_BODY_CONTENT_TYPE,
    );
  });
});

describe("the reader, behind the parsers OneUptime runs, over HTTP", () => {
  let server: http.Server;
  let port: number = 0;

  interface Answer {
    statusCode: number;
    body: JSONObject;
  }

  const send: (request: {
    headers: Record<string, string>;
    body: Buffer | string;
    path?: string;
  }) => Promise<Answer> = (request: {
    headers: Record<string, string>;
    body: Buffer | string;
    path?: string;
  }): Promise<Answer> => {
    return new Promise(
      (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: "POST",
            path: request.path || "/incoming-request/key",
            headers: request.headers,
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                statusCode: response.statusCode || 0,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              });
            });
          },
        );
        outgoing.on("error", reject);
        outgoing.write(request.body);
        outgoing.end();
      },
    );
  };

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();

    // As StartServer: a gzip body inflated first, then JSON, then forms.
    app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (String(req.headers["content-encoding"] || "").includes("gzip")) {
        GzipRequestBodyMiddleware.parseBody(req, res, next);
        return;
      }

      ExpressJson({ limit: "50mb" })(req, res, next);
    });
    app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));

    app.post(
      "/incoming-request/:secretkey",
      PlainTextJsonBody.getReader("4kb"),
      (req: ExpressRequest, res: ExpressResponse) => {
        res.json({
          body: Buffer.isBuffer(req.body) ? "a Buffer" : req.body,
        });
      },
    );

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      server.once("listening", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      server.close(resolve);
    });
  });

  test("an SNS subscription confirmation, as SNS sends it, is kept as its JSON", async () => {
    const answer: Answer = await send({
      headers: { ...SNS_CONFIRMATION_HEADERS },
      body: JSON.stringify(snsSubscriptionConfirmation()),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual(snsSubscriptionConfirmation());
  });

  test("plain text is kept empty, as before", async () => {
    const answer: Answer = await send({
      headers: { "content-type": "text/plain" },
      body: "backup finished",
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
  });

  test("a JSON body is read as it always was", async () => {
    const answer: Answer = await send({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "up" }),
    });

    expect(answer.body["body"]).toEqual({ status: "up" });
  });

  test("a form body is read as it always was", async () => {
    const answer: Answer = await send({
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "status=up&version=1.2.3",
    });

    expect(answer.body["body"]).toEqual({ status: "up", version: "1.2.3" });
  });

  test("a text over the limit is kept empty, not refused", async () => {
    const answer: Answer = await send({
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ padding: "x".repeat(8192) }),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
  });

  test("a text in a charset nothing can read is kept empty, not refused", async () => {
    const answer: Answer = await send({
      headers: { "content-type": "text/plain; charset=no-such-charset" },
      body: '{"status":"up"}',
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
  });

  /*
   * The App inflates a gzip body into a Buffer before any route and does
   * not mark it read: reading its spent stream again would fail the
   * request. It is left as it was.
   */
  test("a gzip text the App already inflated is left as it was, and answered", async () => {
    const answer: Answer = await send({
      headers: { "content-type": "text/plain", "content-encoding": "gzip" },
      body: zlib.gzipSync(JSON.stringify({ status: "up" })),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toBe("a Buffer");
  });
});

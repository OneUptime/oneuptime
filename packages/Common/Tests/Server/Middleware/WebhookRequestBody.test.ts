import GzipRequestBodyMiddleware from "../../../Server/Middleware/GzipRequestBody";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "../../../Server/Utils/Express";
import WebhookRequestBody, {
  JSON_SUFFIX_CONTENT_TYPE,
  TEXT_BODY_CONTENT_TYPE,
  WEBHOOK_BODY_CONTENT_TYPES,
} from "../../../Server/Middleware/WebhookRequestBody";
import { JSONObject } from "../../../Types/JSON";
import {
  SNS_CONFIRMATION_HEADERS,
  snsSubscriptionConfirmation,
} from "../../Utils/Monitor/SubscriptionConfirmationFixtures";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";

/*
 * THE BODY OF A REQUEST TO AN ENDPOINT THAT TAKES WHATEVER A TEAM POINTS AT
 * IT: AN INCOMING REQUEST MONITOR'S URL, A WORKFLOW'S WEBHOOK TRIGGER, A
 * PROBE'S INCOMING REQUEST INGRESS.
 *
 *   - https://github.com/OneUptime/oneuptime/issues/7723: Amazon SNS posts
 *     its subscription confirmations and notifications as JSON with
 *     "Content-Type: text/plain; charset=UTF-8", and the endpoints read only
 *     JSON and form bodies, so an SNS topic delivered empty bodies. A
 *     text/plain body is kept as the JSON object or array it holds.
 *   - https://github.com/OneUptime/oneuptime/issues/8430: any other text
 *     arrived empty too - "backup failed" posted as text/plain could never
 *     match the default criteria, which looks for `error`. It is kept as the
 *     text it is.
 *   - https://github.com/OneUptime/oneuptime/issues/8429: Azure Event Grid
 *     delivers a CloudEvents subscription's events as
 *     application/cloudevents+json, which arrived empty. A +json body is
 *     kept as its JSON.
 *
 * Nothing that was accepted is refused: a text over the limit, or in a
 * charset nothing can read, is kept empty, as before.
 */

describe("the body a text is kept as", () => {
  test("a JSON object is kept as the object", () => {
    expect(
      WebhookRequestBody.fromText(
        JSON.stringify(snsSubscriptionConfirmation()),
      ),
    ).toEqual(snsSubscriptionConfirmation());
  });

  test("a JSON array is kept as the array", () => {
    expect(WebhookRequestBody.fromText('[{"a":1},{"b":2}]')).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  test("JSON after a byte order mark is still JSON", () => {
    expect(WebhookRequestBody.fromText('﻿{"status":"up"}')).toEqual({
      status: "up",
    });
  });

  test("JSON with whitespace around it is still JSON", () => {
    expect(WebhookRequestBody.fromText('\n  {"status":"up"}\n')).toEqual({
      status: "up",
    });
  });

  test.each([
    ["plain text", "backup failed: error 42"],
    ["a status line", "OK"],
    ["text over several lines", "line one\nline two\r\n"],
    ["text that only starts like JSON", '{"status": "up"'],
    ["a JSON string", '"error"'],
    ["a JSON number", "42"],
    ["JSON true", "true"],
    ["JSON null", "null"],
    ["text in another script", "Sicherung fehlgeschlagen: Fehler 42 ✗"],
  ])("%s is kept as the text it is", (_label: string, text: string) => {
    expect(WebhookRequestBody.fromText(text)).toBe(text);
  });

  test("a byte order mark is no part of the text", () => {
    expect(WebhookRequestBody.fromText("﻿backup failed")).toBe("backup failed");
  });

  /*
   * #10183: a text/plain body was parsed whatever it held, before the
   * monitor's key was checked: 50 MB of "[]," made 17 million arrays.
   */
  test("a text that holds more JSON values than the route reads is kept as the text, never parsed", () => {
    const bomb: string = `[${"[],".repeat(200)}[]]`;
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    try {
      expect(
        WebhookRequestBody.fromText(bomb, {
          values: 100,
          objectsArraysAndStrings: 100,
        }),
      ).toBe(bomb);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  test("a text within the route's limit is still kept as its JSON", () => {
    expect(
      WebhookRequestBody.fromText('{"Type":"Notification","n":[1,2]}', {
        values: 7,
        objectsArraysAndStrings: 7,
      }),
    ).toEqual({ Type: "Notification", n: [1, 2] });
  });

  test.each([
    ["nothing", ""],
    ["only spaces", "   "],
    ["only line breaks", "\r\n\n"],
    ["only a byte order mark", "﻿"],
  ])("%s is an empty body", (_label: string, text: string) => {
    expect(WebhookRequestBody.fromText(text)).toEqual({});
  });

  test.each([
    ["undefined", undefined],
    ["a Buffer", Buffer.from('{"a":1}')],
    ["an object", { a: 1 }],
    ["a number", 42],
  ])(
    "%s, which is not text, is kept empty",
    (_label: string, value: unknown) => {
      expect(WebhookRequestBody.fromText(value)).toEqual({});
    },
  );

  test("reads the type SNS sends, and every +json type", () => {
    expect(TEXT_BODY_CONTENT_TYPE).toBe("text/plain");
    expect(JSON_SUFFIX_CONTENT_TYPE).toBe("application/*+json");
    expect([...WEBHOOK_BODY_CONTENT_TYPES]).toEqual([
      TEXT_BODY_CONTENT_TYPE,
      JSON_SUFFIX_CONTENT_TYPE,
    ]);
    expect(SNS_CONFIRMATION_HEADERS["content-type"]).toContain(
      TEXT_BODY_CONTENT_TYPE,
    );
  });
});

interface Answer {
  statusCode: number;
  body: JSONObject;
}

interface SentRequest {
  headers: Record<string, string>;
  body: Buffer | string;
  path?: string;
}

type SendFunction = (request: SentRequest) => Promise<Answer>;

/*
 * An app behind the parsers OneUptime runs - a gzip body inflated first,
 * then JSON, then forms - whose one route reads with `reader` and answers
 * with what it read: the body, or a note of the bytes it read.
 */
function serve(reader: RequestHandler): {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  send: SendFunction;
} {
  let server: http.Server;
  let port: number = 0;

  const send: SendFunction = (request: SentRequest): Promise<Answer> => {
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

  return {
    start: async (): Promise<void> => {
      const app: ExpressApplication = createExpressApp();

      app.use(
        (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
          if (String(req.headers["content-encoding"] || "").includes("gzip")) {
            GzipRequestBodyMiddleware.parseBody(req, res, next);
            return;
          }

          ExpressJson({ limit: "50mb" })(req, res, next);
        },
      );
      app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));

      app.post(
        "/incoming-request/:secretkey",
        reader,
        (req: ExpressRequest, res: ExpressResponse) => {
          const rawBodyBytes: Buffer | undefined = (req as OneUptimeRequest)
            .rawBodyBytes;

          res.json({
            body: Buffer.isBuffer(req.body)
              ? { bytes: req.body.toString("base64") }
              : req.body,
            // The bytes kept to check a signature over, when any were.
            rawBodyBytes: rawBodyBytes ? rawBodyBytes.toString("base64") : null,
          });
        },
      );

      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve: (value: unknown) => void) => {
        server.once("listening", resolve);
      });
      port = (server.address() as AddressInfo).port;
    },
    stop: async (): Promise<void> => {
      await new Promise((resolve: (value: unknown) => void) => {
        server.close(resolve);
      });
    },
    send: send,
  };
}

describe("the reader, behind the parsers OneUptime runs, over HTTP", () => {
  const app: ReturnType<typeof serve> = serve(
    WebhookRequestBody.getReader("4kb"),
  );

  beforeAll(app.start);
  afterAll(app.stop);

  test("an SNS subscription confirmation, as SNS sends it, is kept as its JSON", async () => {
    const answer: Answer = await app.send({
      headers: { ...SNS_CONFIRMATION_HEADERS },
      body: JSON.stringify(snsSubscriptionConfirmation()),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual(snsSubscriptionConfirmation());
  });

  test("plain text is kept as the text it is", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain" },
      body: "backup failed: error 42",
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toBe("backup failed: error 42");
  });

  test("text in the charset it names is read in that charset", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
      body: Buffer.from("café: sauvegarde échouée", "latin1"),
    });

    expect(answer.body["body"]).toBe("café: sauvegarde échouée");
  });

  test("an empty text is an empty body", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain" },
      body: "",
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
  });

  test("an Azure Event Grid CloudEvent, as application/cloudevents+json, is kept as its JSON", async () => {
    const event: JSONObject = {
      specversion: "1.0",
      type: "Microsoft.Storage.BlobCreated",
      source: "/subscriptions/x/resourceGroups/ops",
      id: "9aeb0fdf-c01e-0131-0922-9eb54906e209",
      time: "2026-11-13T15:59:14.000Z",
      data: { api: "PutBlob" },
    };

    const answer: Answer = await app.send({
      headers: {
        "content-type": "application/cloudevents+json; charset=utf-8",
      },
      body: JSON.stringify(event),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual(event);
  });

  test("a batch of CloudEvents is kept as its array", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/cloudevents-batch+json" },
      body: JSON.stringify([{ id: "1" }, { id: "2" }]),
    });

    expect(answer.body["body"]).toEqual([{ id: "1" }, { id: "2" }]);
  });

  test("a +json body that holds no JSON is kept as its text, not refused", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/cloudevents+json" },
      body: "{not json",
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toBe("{not json");
  });

  test("a JSON body is read as it always was", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "up" }),
    });

    expect(answer.body["body"]).toEqual({ status: "up" });
  });

  test("a form body is read as it always was", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "status=up&version=1.2.3",
    });

    expect(answer.body["body"]).toEqual({ status: "up", version: "1.2.3" });
  });

  test("a body of any other type is still empty", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/octet-stream" },
      body: "backup failed",
    });

    expect(answer.body["body"]).toEqual({});
  });

  test("a text over the limit is kept empty, not refused", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain" },
      body: "x".repeat(8192),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
  });

  test("a text in a charset nothing can read is kept empty, not refused", async () => {
    const answer: Answer = await app.send({
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
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain", "content-encoding": "gzip" },
      body: zlib.gzipSync(JSON.stringify({ status: "up" })),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({
      bytes: Buffer.from(JSON.stringify({ status: "up" })).toString("base64"),
    });
  });
});

/*
 * A probe relays these bodies as the bytes that came, with their
 * Content-Type, so OneUptime reads them as it would have directly.
 */
describe("the raw reader a relay reads with, over HTTP", () => {
  const app: ReturnType<typeof serve> = serve(
    WebhookRequestBody.getRawReader("4kb"),
  );

  beforeAll(app.start);
  afterAll(app.stop);

  function bytesOf(answer: Answer): Buffer {
    return Buffer.from(
      (answer.body["body"] as JSONObject)["bytes"] as string,
      "base64",
    );
  }

  test("plain text is kept as the bytes that came", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain" },
      body: "backup failed",
    });

    expect(bytesOf(answer).toString("utf8")).toBe("backup failed");
  });

  test("text in another charset is kept as its own bytes, for OneUptime to decode", async () => {
    const latin1: Buffer = Buffer.from("café", "latin1");

    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
      body: latin1,
    });

    expect(bytesOf(answer).equals(latin1)).toBe(true);
  });

  test("JSON sent as text/plain, as SNS sends it, is kept as its bytes too", async () => {
    const text: string = JSON.stringify(snsSubscriptionConfirmation());

    const answer: Answer = await app.send({
      headers: { ...SNS_CONFIRMATION_HEADERS },
      body: text,
    });

    expect(bytesOf(answer).toString("utf8")).toBe(text);
  });

  test("a +json body is kept as its bytes", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/cloudevents+json" },
      body: '{"id":"1"}',
    });

    expect(bytesOf(answer).toString("utf8")).toBe('{"id":"1"}');
  });

  test("a JSON or form body is still parsed", async () => {
    expect(
      (
        await app.send({
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "up" }),
        })
      ).body["body"],
    ).toEqual({ status: "up" });
    expect(
      (
        await app.send({
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "status=up",
        })
      ).body["body"],
    ).toEqual({ status: "up" });
  });

  test("a text over the limit is kept empty, not refused", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain" },
      body: "x".repeat(8192),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
  });

  test("a body of any other type is still empty", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/octet-stream" },
      body: "backup failed",
    });

    expect(answer.body["body"]).toEqual({});
  });
});

/*
 * The bytes of a signed body no parser reads (issue #8500): read only to
 * check the signature over, and only for a request that carries one - the
 * route still gets the body empty, as before.
 */
describe("the signed body reader, behind the parsers OneUptime runs, over HTTP", () => {
  const isSigned: (req: ExpressRequest) => boolean = (
    req: ExpressRequest,
  ): boolean => {
    return Boolean(req.headers["x-signature-for-the-test"]);
  };

  const textReader: RequestHandler = WebhookRequestBody.getReader("4kb");
  const signedReader: RequestHandler = WebhookRequestBody.getSignedBodyReader(
    "4kb",
    isSigned,
  );

  const app: ReturnType<typeof serve> = serve(
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      textReader(req, res, (): void => {
        signedReader(req, res, next);
      });
    },
  );

  beforeAll(app.start);
  afterAll(app.stop);

  test("a signed body of another type is read as its bytes, and the route still gets it empty", async () => {
    const bytes: Buffer = Buffer.from([0, 1, 2, 250, 251, 252]);

    const answer: Answer = await app.send({
      headers: {
        "content-type": "application/octet-stream",
        "x-signature-for-the-test": "yes",
      },
      body: bytes,
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
    expect(answer.body["rawBodyBytes"]).toBe(bytes.toString("base64"));
  });

  test("an unsigned body of another type is not read at all", async () => {
    const answer: Answer = await app.send({
      headers: { "content-type": "application/octet-stream" },
      body: "backup failed",
    });

    expect(answer.body["body"]).toEqual({});
    expect(answer.body["rawBodyBytes"]).toBeNull();
  });

  test("a signed JSON body is left to the JSON parser that read it", async () => {
    const answer: Answer = await app.send({
      headers: {
        "content-type": "application/json",
        "x-signature-for-the-test": "yes",
      },
      body: '{"status":"up"}',
    });

    expect(answer.body["body"]).toEqual({ status: "up" });
    expect(answer.body["rawBodyBytes"]).toBeNull();
  });

  // A signature is made over a text's bytes before its charset is decoded.
  test("a text's bytes are kept as they came, in the charset it names", async () => {
    const latin1: Buffer = Buffer.from(
      "Sicherung fehlgeschlagen: café",
      "latin1",
    );

    const answer: Answer = await app.send({
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
      body: latin1,
    });

    expect(answer.body["body"]).toBe("Sicherung fehlgeschlagen: café");
    expect(answer.body["rawBodyBytes"]).toBe(latin1.toString("base64"));
  });

  test("a signed text is read once, by the text reader, its bytes kept", async () => {
    const answer: Answer = await app.send({
      headers: {
        "content-type": "text/plain",
        "x-signature-for-the-test": "yes",
      },
      body: "backup failed: error 42",
    });

    expect(answer.body["body"]).toBe("backup failed: error 42");
    expect(answer.body["rawBodyBytes"]).toBe(
      Buffer.from("backup failed: error 42").toString("base64"),
    );
  });

  test("a signed body over the limit is not refused: its signature is checked over nothing", async () => {
    const answer: Answer = await app.send({
      headers: {
        "content-type": "application/octet-stream",
        "x-signature-for-the-test": "yes",
      },
      body: "x".repeat(8192),
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.body["body"]).toEqual({});
    expect(answer.body["rawBodyBytes"]).toBeNull();
  });
});

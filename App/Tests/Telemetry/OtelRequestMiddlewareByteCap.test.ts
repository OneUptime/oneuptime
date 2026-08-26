import OpenTelemetryRequestMiddleware, {
  MAX_OTLP_REQUEST_BYTES,
} from "../../FeatureSet/Telemetry/Middleware/OtelRequestMiddleware";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { describe, expect, test } from "@jest/globals";
import { EventEmitter } from "events";

/*
 * OtelRequestMiddleware.parseBody reads the socket itself, which means
 * none of StartServer's global body-parser limits apply to it - it is
 * mounted on routes that StartServer's dispatcher deliberately bypasses.
 * Until this cap existed the only bound on an OTLP ingest body was
 * whatever the ingress happened to allow, and a deployment reached
 * directly had none at all.
 *
 * SessionReplayRequestMiddleware's header comment called this out
 * explicitly ("the byte cap the OTLP equivalent does not have"); these
 * tests are that comment turned into an assertion.
 */

interface FakeRequest extends EventEmitter {
  body?: unknown;
  headers: Record<string, string>;
  destroy: () => void;
  resume: () => void;
  destroyed: boolean;
  resumed: boolean;
}

interface FakeResponse {
  statusCode: number;
  headersSent: boolean;
  jsonBody: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
}

function buildRequest(headers?: Record<string, string>): FakeRequest {
  const req: FakeRequest = new EventEmitter() as FakeRequest;

  req.headers = headers || {};
  req.destroyed = false;
  req.resumed = false;
  req.destroy = (): void => {
    req.destroyed = true;
  };
  req.resume = (): void => {
    req.resumed = true;
  };

  return req;
}

function buildResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 0,
    headersSent: false,
    jsonBody: undefined,
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    json: (body: unknown): FakeResponse => {
      res.jsonBody = body;
      res.headersSent = true;
      return res;
    },
  };

  return res;
}

interface Harness {
  req: FakeRequest;
  res: FakeResponse;
  nextCalls: Array<unknown>;
  done: Promise<void>;
}

function start(headers?: Record<string, string>): Harness {
  const req: FakeRequest = buildRequest(headers);
  const res: FakeResponse = buildResponse();
  const nextCalls: Array<unknown> = [];

  const done: Promise<void> = OpenTelemetryRequestMiddleware.parseBody(
    req as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
    ((err?: unknown): void => {
      nextCalls.push(err);
    }) as NextFunction,
  );

  return { req: req, res: res, nextCalls: nextCalls, done: done };
}

describe("OtelRequestMiddleware.parseBody - the body still gets through", () => {
  test("a normal body is handed on as a Buffer", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.from("hello "));
    harness.req.emit("data", Buffer.from("otlp"));
    harness.req.emit("end");

    await harness.done;

    expect(harness.nextCalls).toEqual([undefined]);
    expect(Buffer.isBuffer(harness.req.body)).toBe(true);
    expect((harness.req.body as Buffer).toString()).toBe("hello otlp");
    expect(harness.res.statusCode).toBe(0);
  });

  test("string chunks are decoded as utf-8, as before", async () => {
    const harness: Harness = start();

    harness.req.emit("data", "héllo");
    harness.req.emit("end");

    await harness.done;

    expect((harness.req.body as Buffer).toString("utf-8")).toBe("héllo");
  });

  test("an empty body is an empty Buffer, not a rejection", async () => {
    const harness: Harness = start();

    harness.req.emit("end");

    await harness.done;

    expect(harness.nextCalls).toEqual([undefined]);
    expect((harness.req.body as Buffer).length).toBe(0);
  });

  test("a body one byte UNDER the cap is accepted", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.alloc(MAX_OTLP_REQUEST_BYTES - 1));
    harness.req.emit("end");

    await harness.done;

    expect(harness.res.statusCode).toBe(0);
    expect((harness.req.body as Buffer).length).toBe(
      MAX_OTLP_REQUEST_BYTES - 1,
    );
  });

  test("a body exactly ON the cap is accepted", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.alloc(MAX_OTLP_REQUEST_BYTES));
    harness.req.emit("end");

    await harness.done;

    expect(harness.res.statusCode).toBe(0);
    expect((harness.req.body as Buffer).length).toBe(MAX_OTLP_REQUEST_BYTES);
  });

  test("an already-parsed body short-circuits rather than double-reading", async () => {
    const harness: Harness = start();
    harness.req.body = Buffer.from("set upstream");

    /* parseBody was already called by start(); call again on the same req. */
    const nextCalls: Array<unknown> = [];

    await OpenTelemetryRequestMiddleware.parseBody(
      harness.req as unknown as ExpressRequest,
      harness.res as unknown as ExpressResponse,
      ((err?: unknown): void => {
        nextCalls.push(err);
      }) as NextFunction,
    );

    expect(nextCalls).toEqual([undefined]);
    expect((harness.req.body as Buffer).toString()).toBe("set upstream");

    harness.req.emit("end");
    await harness.done;
  });
});

describe("OtelRequestMiddleware.parseBody - the cap", () => {
  test("one byte OVER the cap is a 413 and next() never runs", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.alloc(MAX_OTLP_REQUEST_BYTES + 1));

    await harness.done;

    expect(harness.res.statusCode).toBe(413);
    expect(harness.nextCalls).toHaveLength(0);
    expect(harness.req.body).toBeUndefined();
    expect(
      (harness.res.jsonBody as { error: string; message: string }).error,
    ).toBe("payload-too-large");
  });

  test("the cap counts ACROSS chunks, not per chunk", async () => {
    const harness: Harness = start();

    /* Three chunks, each comfortably legal, together over the line. */
    const third: number = Math.ceil(MAX_OTLP_REQUEST_BYTES / 3) + 1;

    harness.req.emit("data", Buffer.alloc(third));
    expect(harness.res.statusCode).toBe(0);

    harness.req.emit("data", Buffer.alloc(third));
    expect(harness.res.statusCode).toBe(0);

    harness.req.emit("data", Buffer.alloc(third));

    await harness.done;

    expect(harness.res.statusCode).toBe(413);
    expect(harness.nextCalls).toHaveLength(0);
  });

  test("an over-cap Content-Length is refused before a byte is read", async () => {
    const harness: Harness = start({
      "content-length": String(MAX_OTLP_REQUEST_BYTES + 1),
    });

    await harness.done;

    expect(harness.res.statusCode).toBe(413);
    expect(harness.nextCalls).toHaveLength(0);

    /* Nothing was ever wired to the stream - the cheapest possible refusal. */
    expect(harness.req.listenerCount("data")).toBe(0);
    expect(harness.req.listenerCount("end")).toBe(0);
  });

  test("a Content-Length at the cap is not refused", async () => {
    const harness: Harness = start({
      "content-length": String(MAX_OTLP_REQUEST_BYTES),
    });

    harness.req.emit("data", Buffer.from("small"));
    harness.req.emit("end");

    await harness.done;

    expect(harness.res.statusCode).toBe(0);
    expect(harness.nextCalls).toEqual([undefined]);
  });

  test("a garbage Content-Length is ignored rather than trusted", async () => {
    const harness: Harness = start({ "content-length": "not-a-number" });

    harness.req.emit("data", Buffer.from("ok"));
    harness.req.emit("end");

    await harness.done;

    expect(harness.res.statusCode).toBe(0);
    expect(harness.nextCalls).toEqual([undefined]);
  });

  test("the 413 is answered, the socket is not destroyed, and the rest is drained", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.alloc(MAX_OTLP_REQUEST_BYTES + 1));

    await harness.done;

    expect(harness.res.statusCode).toBe(413);
    /*
     * A destroyed socket reads as a network error, and OTel exporters
     * retry those. 413 is a 4xx, which the spec tells them not to retry -
     * so a misconfigured batch size stops instead of looping.
     */
    expect(harness.req.destroyed).toBe(false);
    expect(harness.req.resumed).toBe(true);
  });

  test("data arriving after the 413 does not produce a second response", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.alloc(MAX_OTLP_REQUEST_BYTES + 1));

    await harness.done;

    expect(harness.res.statusCode).toBe(413);

    const firstBody: unknown = harness.res.jsonBody;

    harness.res.statusCode = 0;
    harness.req.emit("data", Buffer.alloc(1024));
    harness.req.emit("end");

    expect(harness.res.statusCode).toBe(0);
    expect(harness.res.jsonBody).toBe(firstBody);
    expect(harness.nextCalls).toHaveLength(0);
  });

  test("a response that already has headers is not written to again", async () => {
    const harness: Harness = start({
      "content-length": String(MAX_OTLP_REQUEST_BYTES + 1),
    });

    await harness.done;
    expect(harness.res.statusCode).toBe(413);

    /* Second request, response already committed by something upstream. */
    const req: FakeRequest = buildRequest({
      "content-length": String(MAX_OTLP_REQUEST_BYTES + 1),
    });
    const res: FakeResponse = buildResponse();
    res.headersSent = true;

    await OpenTelemetryRequestMiddleware.parseBody(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {}) as NextFunction,
    );

    expect(res.statusCode).toBe(0);
    expect(res.jsonBody).toBeUndefined();
  });

  test("the cap is the app-wide 50 MiB body-parser number", () => {
    expect(MAX_OTLP_REQUEST_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("OtelRequestMiddleware.parseBody - stream errors", () => {
  test("a request error reaches Express instead of hanging", async () => {
    const harness: Harness = start();

    const failure: Error = new Error("ECONNRESET");

    harness.req.emit("data", Buffer.from("partial"));
    harness.req.emit("error", failure);

    await harness.done;

    expect(harness.nextCalls).toEqual([failure]);
    expect(harness.res.statusCode).toBe(0);
    expect(harness.req.body).toBeUndefined();
  });

  test("an error AFTER a 413 does not turn into a second outcome", async () => {
    const harness: Harness = start();

    harness.req.emit("data", Buffer.alloc(MAX_OTLP_REQUEST_BYTES + 1));

    await harness.done;

    expect(harness.res.statusCode).toBe(413);

    harness.req.emit("error", new Error("late"));

    expect(harness.nextCalls).toHaveLength(0);
  });
});

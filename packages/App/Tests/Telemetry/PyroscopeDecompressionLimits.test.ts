import { describe, expect, jest, test } from "@jest/globals";

/*
 * Pyroscope ingest used to hand the request payload to a bare
 * `zlib.gunzip` with no output ceiling - the same decompression-bomb
 * shape GHSA-cp58-wc9q-qv53 fixed in the global request reader, one
 * layer in. It sits behind TelemetryIngest.isAuthorizedServiceMiddleware,
 * so it needs a valid project ingest key, but any holder of one could
 * turn the ~1 MiB nginx allows on /pyroscope into roughly a gigabyte of
 * resident Buffer.
 *
 * Two ceilings, because on the push route neither one alone is enough:
 *
 *   - the PER-PROFILE ceiling bounds one gzip member;
 *   - the PER-REQUEST budget bounds the sum, because
 *     ingestPyroscopePush walks series[].samples[] and inflates each one,
 *     so a per-profile cap on its own just multiplies by the sample
 *     count.
 */

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addProfileIngestJob: jest.fn(async (): Promise<void> => {
          return undefined;
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import PyroscopeIngestService, {
  MAX_DECOMPRESSED_PROFILE_BYTES,
  MAX_DECOMPRESSED_REQUEST_BYTES,
} from "../../FeatureSet/Telemetry/Services/PyroscopeIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ObjectID from "Common/Types/ObjectID";
import protobuf from "protobufjs";
import path from "path";
import zlib from "zlib";

/*
 * The ceilings under test are 32 and 64 MiB, so the fixtures that probe
 * them are tens of MiB of real gzip and real inflation, and an ACCEPTED
 * large sample is then pprof-parsed (protobufjs spends ~4s per 24 MiB).
 * None of that fits in the 30s App default.
 */
jest.setTimeout(180_000);

const PushProto: protobuf.Root = protobuf.loadSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "ProtoFiles",
    "pyroscope",
    "push.proto",
  ),
);
const PushRequestType: protobuf.Type = PushProto.lookupType(
  "push.v1.PushRequest",
);

function gzip(buffer: Buffer): Buffer {
  return zlib.gzipSync(buffer as unknown as Uint8Array);
}

/*
 * A gzip member that inflates to `bytes`. Zero-filled, so it compresses at
 * roughly a thousand to one - which is the whole point: the fixtures below
 * are tens of kilobytes and the payloads they stand for are hundreds of
 * megabytes.
 */
function bombOf(bytes: number): Buffer {
  return gzip(Buffer.alloc(bytes));
}

/* Folded/collapsed profile text, which the ingest path parses without pprof. */
function foldedText(): Buffer {
  return Buffer.from("main;work;inner 12\nmain;idle 3\n");
}

interface Outcome {
  req: TelemetryRequest;
  nextCalls: Array<unknown>;
  responded: boolean;
}

function buildResponse(onSend: () => void): ExpressResponse {
  return {
    status: (): unknown => {
      return { send: onSend, json: onSend };
    },
    send: onSend,
    json: onSend,
    end: onSend,
    setHeader: (): void => {},
    headersSent: false,
  } as unknown as ExpressResponse;
}

async function ingestProfile(options: {
  body?: unknown;
  files?: Array<{ fieldname: string; buffer: Buffer }>;
  query?: Record<string, string>;
}): Promise<Outcome> {
  const nextCalls: Array<unknown> = [];
  let responded: boolean = false;

  const req: TelemetryRequest = {
    projectId: ObjectID.generate(),
    query: options.query || {},
    headers: {},
    body: options.body,
    files: options.files,
  } as unknown as TelemetryRequest;

  await PyroscopeIngestService.ingestPyroscopeProfile(
    req as unknown as ExpressRequest,
    buildResponse((): void => {
      responded = true;
    }),
    ((err?: unknown): void => {
      nextCalls.push(err);
    }) as NextFunction,
  );

  return { req: req, nextCalls: nextCalls, responded: responded };
}

async function ingestPush(rawBody: Buffer): Promise<Outcome> {
  const nextCalls: Array<unknown> = [];
  let responded: boolean = false;

  const req: TelemetryRequest = {
    projectId: ObjectID.generate(),
    query: {},
    headers: {},
    body: rawBody,
  } as unknown as TelemetryRequest;

  await PyroscopeIngestService.ingestPyroscopePush(
    req as unknown as ExpressRequest,
    buildResponse((): void => {
      responded = true;
    }),
    ((err?: unknown): void => {
      nextCalls.push(err);
    }) as NextFunction,
  );

  return { req: req, nextCalls: nextCalls, responded: responded };
}

function encodePush(
  samples: Array<Buffer>,
  options?: { padBytes?: number },
): Buffer {
  /*
   * `padBytes` inflates the ENVELOPE without adding samples, by parking
   * the bytes in a label value the ingest path never reads (__name__ is
   * the only label it looks at). Used to spend the request budget before
   * the sample loop starts.
   */
  const labels: Array<{ name: string; value: string }> = [
    { name: "__name__", value: "myapp.cpu" },
  ];

  if (options?.padBytes) {
    labels.push({ name: "pad", value: "a".repeat(options.padBytes) });
  }

  const message: protobuf.Message = PushRequestType.create({
    series: [
      {
        labels: labels,
        samples: samples.map((s: Buffer) => {
          return { rawProfile: new Uint8Array(s), id: "" };
        }),
      },
    ],
  });

  return Buffer.from(PushRequestType.encode(message).finish());
}

function thrownException(outcome: Outcome): Exception | undefined {
  return outcome.nextCalls[0] as Exception | undefined;
}

describe("Pyroscope ingest - the ceilings are set where they were measured", () => {
  test("the per-profile ceiling is 32 MiB and the per-request budget is 64 MiB", () => {
    expect(MAX_DECOMPRESSED_PROFILE_BYTES).toBe(32 * 1024 * 1024);
    expect(MAX_DECOMPRESSED_REQUEST_BYTES).toBe(64 * 1024 * 1024);
  });

  test("the budget is larger than one profile, so a single profile is never budget-limited", () => {
    expect(MAX_DECOMPRESSED_REQUEST_BYTES).toBeGreaterThan(
      MAX_DECOMPRESSED_PROFILE_BYTES,
    );
  });
});

describe("Pyroscope /ingest - decompression bombs", () => {
  test("a profile over the per-profile ceiling is refused with 413", async () => {
    const outcome: Outcome = await ingestProfile({
      body: bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1),
      query: { format: "folded" },
    });

    const err: Exception | undefined = thrownException(outcome);

    expect(err).toBeInstanceOf(Exception);
    expect(err!.code).toBe(ExceptionCode.PayloadTooLargeException);
    expect(err!.code).toBe(413);
    expect(outcome.responded).toBe(false);
  });

  test("the bomb fixture really is a bomb - four figures of amplification", () => {
    const compressed: Buffer = bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1);

    expect(compressed.length).toBeLessThan(
      MAX_DECOMPRESSED_PROFILE_BYTES / 500,
    );
  });

  test("the refusal does not leak how much was received or how much is left", async () => {
    const outcome: Outcome = await ingestProfile({
      body: bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1),
    });

    const message: string = thrownException(outcome)!.message;

    expect(message).not.toMatch(/\d{4,}/);
    expect(message.toLowerCase()).toContain("too large");
  });

  test("a bomb arriving as a multipart file is refused too", async () => {
    const outcome: Outcome = await ingestProfile({
      files: [
        {
          fieldname: "profile",
          buffer: bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1),
        },
      ],
      query: { format: "folded" },
    });

    expect(thrownException(outcome)!.code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
  });

  test("a legitimate gzipped profile still goes through", async () => {
    const outcome: Outcome = await ingestProfile({
      body: gzip(foldedText()),
      query: { format: "folded", name: "myapp.cpu" },
    });

    expect(outcome.nextCalls).toHaveLength(0);
    expect(outcome.responded).toBe(true);
    expect(
      (outcome.req.body as Record<string, unknown>)["resourceProfiles"],
    ).toBeDefined();
  });

  test("an uncompressed profile is untouched by the ceiling", async () => {
    const outcome: Outcome = await ingestProfile({
      body: foldedText(),
      query: { format: "folded", name: "myapp.cpu" },
    });

    expect(outcome.nextCalls).toHaveLength(0);
    expect(outcome.responded).toBe(true);
  });

  test("a gzipped profile comfortably under the ceiling is accepted", async () => {
    /* 5 MiB of real folded text - well within the ceiling, far past a chunk. */
    const big: Buffer = Buffer.from("main;work;inner 12\n".repeat(300_000));

    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    expect(big.length).toBeLessThan(MAX_DECOMPRESSED_PROFILE_BYTES);

    const outcome: Outcome = await ingestProfile({
      body: gzip(big),
      query: { format: "folded", name: "myapp.cpu" },
    });

    expect(outcome.nextCalls).toHaveLength(0);
    expect(outcome.responded).toBe(true);
  });

  test("a corrupt gzip payload is still a decode error, not a size error", async () => {
    const corrupt: Buffer = Buffer.concat([
      Buffer.from([0x1f, 0x8b]) as unknown as Uint8Array,
      Buffer.from("this is not a gzip stream") as unknown as Uint8Array,
    ]);

    const outcome: Outcome = await ingestProfile({ body: corrupt });

    const err: unknown = outcome.nextCalls[0];

    expect(err).toBeDefined();
    expect((err as Exception).code).not.toBe(
      ExceptionCode.PayloadTooLargeException,
    );
  });
});

describe("Pyroscope /push - the per-request budget", () => {
  test("one oversized embedded sample is refused with 413", async () => {
    const outcome: Outcome = await ingestPush(
      encodePush([bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1)]),
    );

    expect(thrownException(outcome)!.code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect(outcome.responded).toBe(false);
  });

  test("the budget is SHARED - an envelope that ate most of it makes an otherwise-legal sample illegal", async () => {
    /*
     * The case a per-payload cap can never catch. The sample below is
     * 30 MiB inflated, comfortably inside the 32 MiB per-profile ceiling,
     * and the control test underneath proves it is accepted on its own.
     * It is refused here only because the gzipped ENVELOPE already spent
     * ~40 MiB of the 64 MiB request budget.
     *
     * Padding the envelope rather than sending several large samples is
     * deliberate: every sample that IS accepted then gets pprof-parsed,
     * and protobufjs takes ~4s per 24 MiB of it. This shape proves the
     * same property - the allowance is per request, not per payload -
     * without paying for parses the assertion does not care about.
     */
    const envelope: Buffer = encodePush([bombOf(30 * 1024 * 1024)], {
      padBytes: 40 * 1024 * 1024,
    });

    const outcome: Outcome = await ingestPush(gzip(envelope));

    expect(thrownException(outcome)!.code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect(outcome.responded).toBe(false);
  });

  test("control: the SAME sample is accepted when the envelope did not eat the budget", async () => {
    /*
     * Same 30 MiB sample, identity-encoded envelope. If this were refused
     * too, the test above would be measuring the per-profile ceiling
     * rather than the shared budget and would prove nothing.
     */
    const outcome: Outcome = await ingestPush(
      encodePush([bombOf(30 * 1024 * 1024)]),
    );

    expect(outcome.nextCalls).toHaveLength(0);
    expect(outcome.responded).toBe(true);
  });

  test("a gzipped push ENVELOPE over the ceiling is refused before any protobuf decode", async () => {
    const outcome: Outcome = await ingestPush(
      bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1),
    );

    expect(thrownException(outcome)!.code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
  });

  test("an empty push body is a 400, not a 413", async () => {
    const outcome: Outcome = await ingestPush(Buffer.alloc(0));

    const err: Exception | undefined = thrownException(outcome);

    expect(err!.code).toBe(ExceptionCode.BadDataException);
  });

  test("a push with no series responds OK and enqueues nothing", async () => {
    const outcome: Outcome = await ingestPush(encodePush([]));

    expect(outcome.nextCalls).toHaveLength(0);
    expect(outcome.responded).toBe(true);
  });
});

/*
 * The budget arithmetic itself, exercised directly.
 *
 * `decompressIfNeeded` is private, so this reaches it through a cast. That
 * is deliberate: the arithmetic is what an attacker actually plays
 * against, the boundaries are exact, and driving them through the HTTP
 * entry points would cost tens of seconds of inflation per assertion to
 * prove the same four facts.
 */
type DecompressFunction = (
  data: Buffer,
  budgetBytes: number,
) => Promise<Buffer>;

const decompressIfNeeded: DecompressFunction = (
  PyroscopeIngestService as unknown as {
    decompressIfNeeded: DecompressFunction;
  }
).decompressIfNeeded.bind(PyroscopeIngestService) as DecompressFunction;

describe("decompressIfNeeded - the ceiling arithmetic", () => {
  test("inflates normally when the budget is ample", async () => {
    const out: Buffer = await decompressIfNeeded(
      gzip(Buffer.from("profile bytes")),
      MAX_DECOMPRESSED_REQUEST_BYTES,
    );

    expect(out.toString()).toBe("profile bytes");
  });

  test("a payload exactly AT the remaining budget is allowed", async () => {
    const out: Buffer = await decompressIfNeeded(bombOf(1024), 1024);

    expect(out.length).toBe(1024);
  });

  test("one byte over the remaining budget is refused", async () => {
    await expect(decompressIfNeeded(bombOf(1025), 1024)).rejects.toMatchObject({
      code: ExceptionCode.PayloadTooLargeException,
    });
  });

  test("the per-profile ceiling still applies when the budget is larger", async () => {
    await expect(
      decompressIfNeeded(
        bombOf(MAX_DECOMPRESSED_PROFILE_BYTES + 1),
        MAX_DECOMPRESSED_REQUEST_BYTES,
      ),
    ).rejects.toMatchObject({
      code: ExceptionCode.PayloadTooLargeException,
    });
  });

  test("an EXHAUSTED budget refuses instead of meaning 'unlimited'", async () => {
    /*
     * zlib reads maxOutputLength: 0 as "no limit", not "nothing allowed",
     * so a spent budget would otherwise reopen the hole completely - the
     * exact moment the guard matters most.
     */
    await expect(
      decompressIfNeeded(bombOf(64 * 1024 * 1024), 0),
    ).rejects.toMatchObject({ code: ExceptionCode.PayloadTooLargeException });
  });

  test("a negative budget is treated as exhausted, not as unlimited", async () => {
    await expect(
      decompressIfNeeded(bombOf(1024 * 1024), -1),
    ).rejects.toMatchObject({
      code: ExceptionCode.PayloadTooLargeException,
    });
  });

  test("identity bytes pass through untouched, whatever the budget", async () => {
    const plain: Buffer = Buffer.from("not gzip at all");

    const out: Buffer = await decompressIfNeeded(plain, 0);

    /* Same object: no copy, no inflate, no budget spent. */
    expect(out).toBe(plain);
  });

  test("a payload whose first two bytes are not the gzip magic is not inflated", async () => {
    const plain: Buffer = Buffer.from([0x1f, 0x00, 0x01, 0x02]);

    const out: Buffer = await decompressIfNeeded(plain, 0);

    expect(out).toBe(plain);
  });

  test("a corrupt gzip stream surfaces as a decode error, not a size error", async () => {
    const corrupt: Buffer = Buffer.concat([
      Buffer.from([0x1f, 0x8b]) as unknown as Uint8Array,
      Buffer.from("garbage") as unknown as Uint8Array,
    ]);

    await expect(
      decompressIfNeeded(corrupt, MAX_DECOMPRESSED_REQUEST_BYTES),
    ).rejects.not.toMatchObject({
      code: ExceptionCode.PayloadTooLargeException,
    });
  });
});

/*
 * The reason `decompressIfNeeded` uses zlib's CONVENIENCE api rather than a
 * stream. Node honours `maxOutputLength` on gunzip/gunzipSync only; on a
 * createGunzip STREAM it is accepted and silently ignored, so "simplifying"
 * this into a stream would remove the ceiling while looking like it kept
 * it. If a future Node starts honouring it, this test fails and the choice
 * can be revisited.
 */
describe("maxOutputLength only works on the convenience api", () => {
  test("gunzipSync honours it", () => {
    const compressed: Buffer = bombOf(8 * 1024 * 1024);

    expect(() => {
      zlib.gunzipSync(compressed as unknown as Uint8Array, {
        maxOutputLength: 1024 * 1024,
      });
    }).toThrow();
  });

  test("createGunzip does not", async () => {
    const compressed: Buffer = bombOf(8 * 1024 * 1024);

    const emitted: number = await new Promise<number>(
      (resolve: (value: number) => void): void => {
        const stream: zlib.Gunzip = zlib.createGunzip({
          maxOutputLength: 1024 * 1024,
        });

        let out: number = 0;

        stream.on("data", (chunk: Buffer): void => {
          out += chunk.length;
        });
        stream.on("error", (): void => {
          resolve(-1);
        });
        stream.on("end", (): void => {
          resolve(out);
        });

        stream.end(compressed as unknown as Uint8Array);
      },
    );

    expect(emitted).toBe(8 * 1024 * 1024);
  });
});

import PyroscopeAPI from "../../FeatureSet/Telemetry/API/Pyroscope";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { LARGE_REQUEST_BODY_BYTES } from "Common/Server/Utils/RequestBodyLimit";
import { REQUEST_BODY_REFUSAL_MESSAGES } from "Common/Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import {
  BodyServer,
  CONNECTIONS,
  Connection,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  sendWithFetch,
  startBodyServer,
} from "Common/Tests/Server/TestingUtils/RequestBodyOverHttp";
import { UNEXPLAINED_ERROR_MESSAGES } from "Common/Types/Exception/UnexplainedError";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import zlib from "zlib";

/*
 * PYROSCOPE'S PROFILE UPLOADS, OVER HTTP, through StartServer's own
 * middleware - as the App mounts it - the real Pyroscope router and the
 * real ingest-key check, with real clients (#10643, #10644). Only the key
 * lookup, the body store and the queue are stubbed.
 *
 * /pyroscope/ingest reads a profile two ways, each with a reader of its own
 * after StartServer:
 *
 *   - raw, as pyroscope-nodejs posts it (application/octet-stream), once
 *     the ingest key is checked. body-parser read a profile over 50 MB to
 *     its end before the 413 - 64 MiB sent were 64 MiB read, a chunked one
 *     for as long as its client went on sending (#10644). It is now refused
 *     with the rest unread, the connection closed.
 *   - multipart, as pyroscope-dotnet and others post it, before the key is
 *     checked. multer read the request itself: a gzip body StartServer had
 *     already inflated was read again from its spent stream, and a deflate
 *     or malformed one was not read at all - each a 500 with an error-level
 *     log line, from any client - and a body it refused was read to its end
 *     first, and logged. Now the body is read as every body is, held to the
 *     route's 50 MB, and multer parses the bytes read.
 */

jest.setTimeout(180000);

const KEY: string = "8021b000-0000-4000-8000-0000000010644";

const FOLDED_PATH: string = "/pyroscope/ingest?name=checkout&format=folded";

// A profile as collapsed stacks, which /ingest takes as format=folded.
const FOLDED: Buffer = Buffer.from("main;work;inner 12\nmain;idle 3\n");

// The most /pyroscope takes (RequestBodyLimit), as sent and once inflated.
const LIMIT: number = LARGE_REQUEST_BODY_BYTES;

// What a client sends of a refused body, at most: far more than is read.
const SENT: number = 64 * MIB;

const BOUNDARY: string = "----pyroscope-boundary-10643";

const MULTIPART_TYPE: string = `multipart/form-data; boundary=${BOUNDARY}`;

interface Part {
  name: string;
  value: Buffer;
  filename?: string;
}

function multipart(parts: Array<Part>): Buffer {
  const chunks: Array<Buffer> = [];

  for (const part of parts) {
    const disposition: string = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;

    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`,
      ),
      part.value,
      Buffer.from("\r\n"),
    );
  }

  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));

  return Buffer.concat(chunks as unknown as Array<Uint8Array>);
}

const MULTIPART_PROFILE: Buffer = multipart([
  { name: "profile", value: FOLDED, filename: "profile.txt" },
]);

const RIGHT_KEY: Record<string, string> = { authorization: `Bearer ${KEY}` };

let server: BodyServer;
let queued: number = 0;

type MockCalls = { mock: { calls: Array<Array<unknown>> } };

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(
      async (
        secretKey: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        return secretKey === KEY
          ? {
              ingestionKeyId: ObjectID.generate(),
              projectId: ObjectID.generate(),
              keyType: TelemetryIngestionKeyType.Server,
              allowedOrigins: [],
              pinnedServiceName: null,
              isEnabled: true,
              expiresAt: null,
              requestsPerMinuteLimit: null,
              ingestionBudgets: null,
            }
          : null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {});
  jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (): Promise<string> => {
      return `telemetry:body:${ObjectID.generate().toString()}`;
    });
  jest
    .spyOn(Queue, "addJob")
    .mockImplementation(
      async (): Promise<Awaited<ReturnType<typeof Queue.addJob>>> => {
        queued++;
        return {} as Awaited<ReturnType<typeof Queue.addJob>>;
      },
    );

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], PyroscopeAPI);
  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
  jest.restoreAllMocks();
});

beforeEach(() => {
  queued = 0;
  (logger.error as unknown as jest.Mock).mockClear();
  (logger.debug as unknown as jest.Mock).mockClear();
});

// The lines logged at debug that say a body was refused, of a type.
function refusalsLogged(type: string): number {
  return (logger.debug as unknown as MockCalls).mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return String(call[0]).includes(`Refused a request body (${type})`);
    },
  ).length;
}

describe("a raw profile (#10644)", () => {
  test("within the limit, uncompressed or gzip-encoded, it is ingested", async () => {
    const uncompressed: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: { "content-type": "application/octet-stream", ...RIGHT_KEY },
      body: FOLDED,
    });

    expect(uncompressed.answer.status).toBe(200);

    const gzipped: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
        ...RIGHT_KEY,
      },
      body: zlib.gzipSync(FOLDED),
    });

    expect(gzipped.answer.status).toBe(200);
    expect(queued).toBe(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each([...CONNECTIONS])(
    "over 50 MB with the right key, declared: refused 413 before a byte of it is read (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: FOLDED_PATH,
        headers: { "content-type": "application/octet-stream", ...RIGHT_KEY },
        connection: connection,
        bytes: SENT,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.connection).toBe("close");
      expect(sent.answer.json).toEqual({
        error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
      });
      // body-parser alone read all 64 MiB first.
      expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
      expect(queued).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test.each([...CONNECTIONS])(
    "over 50 MB with the right key, chunked: refused 413 at the limit, the rest unread (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: FOLDED_PATH,
        headers: { "content-type": "application/octet-stream", ...RIGHT_KEY },
        connection: connection,
        chunked: true,
        bytes: SENT,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.connection).toBe("close");

      const read: number = await server.readInAll(sent.tag);

      expect(read).toBeGreaterThan(LIMIT);
      expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
      expect(queued).toBe(0);
    },
  );

  test("sent with fetch, over 50 MB: the 413 is read, the rest unread", async () => {
    const sent: SentRequest = await sendWithFetch(server, {
      path: FOLDED_PATH,
      headers: { "content-type": "application/octet-stream", ...RIGHT_KEY },
      bytes: SENT,
    });

    expect(sent.answer.clientError).toBeNull();
    expect(sent.answer.status).toBe(413);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
      LIMIT + READ_OR_TWO,
    );
  });

  test("with a wrong key, it is refused 401 and never read", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: {
        "content-type": "application/octet-stream",
        authorization: "Bearer not-the-key",
      },
      bytes: SENT,
    });

    expect(sent.answer.status).toBe(401);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test("gzip that does not inflate is refused 400 at debug, never at error", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
        ...RIGHT_KEY,
      },
      body: Buffer.from("this is not gzip"),
    });

    expect(sent.answer.status).toBe(400);
    expect(sent.answer.json).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(refusalsLogged("entity.inflate.failed")).toBe(1);
  });

  test("a gzip bomb is refused 413 at the limit as it inflates, with a socket read or two read", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
        ...RIGHT_KEY,
      },
      chunked: true,
      body: zlib.gzipSync(Buffer.alloc(SENT)),
    });

    expect(sent.answer.status).toBe(413);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expect(queued).toBe(0);
  });
});

describe("a multipart profile (#10643)", () => {
  test.each([
    ["uncompressed", undefined, MULTIPART_PROFILE],
    [
      "gzip, which StartServer inflated first",
      "gzip",
      zlib.gzipSync(MULTIPART_PROFILE),
    ],
    ["deflate", "deflate", zlib.deflateSync(MULTIPART_PROFILE)],
  ])(
    "%s, it is ingested: never a 500, never logged at error",
    async (_how: string, encoding: string | undefined, body: Buffer) => {
      for (const chunked of [false, true]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: FOLDED_PATH,
          headers: {
            "content-type": MULTIPART_TYPE,
            ...(encoding ? { "content-encoding": encoding } : {}),
            ...RIGHT_KEY,
          },
          chunked: chunked,
          body: body,
        });

        expect(sent.answer.status).toBe(200);
      }

      expect(queued).toBe(2);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("a body that is no multipart form is refused 400 in a sentence of its own, at debug", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: { "content-type": MULTIPART_TYPE, ...RIGHT_KEY },
      body: Buffer.from("this is not a multipart body"),
    });

    expect(sent.answer.status).toBe(400);
    expect(sent.answer.json).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(refusalsLogged("multipart.malformed")).toBe(1);
  });

  test("one file too many is refused 413 as it was, at debug and never at error", async () => {
    const files: Array<Part> = Array.from(
      { length: 51 },
      (_v: unknown, i: number): Part => {
        return { name: `f${i}`, value: Buffer.from("x"), filename: `f${i}` };
      },
    );

    const sent: SentRequest = await sendOverHttp(server, {
      path: FOLDED_PATH,
      headers: { "content-type": MULTIPART_TYPE, ...RIGHT_KEY },
      body: multipart(files),
    });

    expect(sent.answer.status).toBe(413);
    expect(sent.answer.json).toEqual({
      error: "Multipart request rejected: LIMIT_FILE_COUNT.",
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(refusalsLogged("multipart.limit")).toBe(1);
  });

  test.each([...CONNECTIONS])(
    "over 50 MB, with no key at all: refused 413, declared or chunked, the rest unread (%s)",
    async (connection: Connection) => {
      const head: Buffer = Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="profile"; filename="big"\r\n\r\n`,
      );
      const body: Buffer = Buffer.concat([
        head,
        Buffer.alloc(SENT - head.length, 0x61),
      ] as unknown as Array<Uint8Array>);

      const declared: SentRequest = await sendOverHttp(server, {
        path: FOLDED_PATH,
        headers: { "content-type": MULTIPART_TYPE },
        connection: connection,
        body: body,
      });

      expect(declared.answer.status).toBe(413);
      expect(declared.answer.connection).toBe("close");
      expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
        READ_OR_TWO,
      );

      const chunked: SentRequest = await sendOverHttp(server, {
        path: FOLDED_PATH,
        headers: { "content-type": MULTIPART_TYPE },
        connection: connection,
        chunked: true,
        body: body,
      });

      expect(chunked.answer.status).toBe(413);
      expect(chunked.answer.connection).toBe("close");

      // multer read all 64 MiB before it answered.
      const read: number = await server.readInAll(chunked.tag);

      expect(read).toBeGreaterThan(LIMIT);
      expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );
});

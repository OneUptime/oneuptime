import DsymIngestAPI from "../../FeatureSet/Telemetry/API/DsymIngest";
import PyroscopeAPI from "../../FeatureSet/Telemetry/API/Pyroscope";
import SourceMapIngestAPI from "../../FeatureSet/Telemetry/API/SourceMapIngest";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import TelemetryDsym from "Common/Models/DatabaseModels/TelemetryDsym";
import TelemetrySourceMap from "Common/Models/DatabaseModels/TelemetrySourceMap";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryDsymService from "Common/Server/Services/TelemetryDsymService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetrySourceMapService from "Common/Server/Services/TelemetrySourceMapService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import {
  LARGE_REQUEST_BODY_BYTES,
  LARGE_REQUEST_BODY_JSON_VALUES,
  TELEMETRY_ROUTE_PREFIXES,
  readsBodyAfterAuthentication,
} from "Common/Server/Utils/RequestBodyLimit";
import { getTooManyJsonValuesMessage } from "Common/Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
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
import {
  APP_SYMBOLS,
  APP_TEXT_END_OFFSET,
  APP_UUID,
  buildAppMachO,
} from "Common/Tests/Server/Utils/Telemetry/AppleDebugSymbols/MachOFixtures";
import { UNEXPLAINED_ERROR_MESSAGES } from "Common/Types/Exception/UnexplainedError";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { JsonElementLimit } from "Common/Utils/JsonElementCount";
import { encodeAppleSymbols } from "Common/Utils/Telemetry/AppleSymbols";
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
import { Readable } from "stream";
import zlib from "zlib";

/*
 * AN UPLOAD IS READ ONLY ONCE ITS INGEST KEY IS RIGHT (#10673), over HTTP,
 * through StartServer's own middleware - as the App mounts it - the real
 * routers of Pyroscope's /ingest, source maps and dSYMs, and the real key
 * check, with real clients. Only the key lookup and what a taken upload is
 * stored with (the queue, the source map and dSYM tables) are stubbed.
 *
 * The three routes mounted the multipart middleware before TelemetryIngest,
 * and StartServer inflated a gzip body and parsed a JSON one before routing:
 * a client with no key had 40 MiB read, inflated and held by multer, or
 * parsed as JSON, before it was refused 401. Every SDK sends its key in a
 * header (Authorization, Bearer or Basic, or x-oneuptime-token) and the check
 * reads only headers, so the key is checked first now, and the body read
 * after it (RequestBodyAfterAuthentication.readUpload).
 *
 * What each request cost is counted where it is spent: the bytes the server
 * read off the connection (by the time it closed it), the bytes zlib
 * inflated, the JSON parsed, and - when the key was checked - what had been
 * inflated by then.
 */

jest.setTimeout(300000);

const KEY: string = "8021b000-0000-4000-8000-0000000010673";

// The most these routes take (RequestBodyLimit), as sent and once inflated.
const LIMIT: number = LARGE_REQUEST_BODY_BYTES;

// What a client sends of a body refused for its key: far more than is read.
const UNKEYED: number = 40 * MIB;

// What a client sends of a body over the limit.
const OVER: number = 64 * MIB;

const BOUNDARY: string = "----upload-boundary-10673";

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

// Bytes drawn from the shared seeded generator: they do not compress.
function noise(bytes: number, random: SeededRandom): Buffer {
  const buffer: Buffer = Buffer.alloc(bytes);

  for (let offset: number = 0; offset + 4 <= bytes; offset += 4) {
    buffer.writeUInt32LE(random(4294967296), offset);
  }

  return buffer;
}

const RANDOM: SeededRandom = seededRandom(10673);

// 40 MiB of noise, the file a client with no key sends.
const UNKEYED_FILE: Buffer = noise(UNKEYED, RANDOM);

// 64 MiB of noise gzipped: over the limit as it is sent, not only inflated.
let incompressibleOver: Buffer;

// 40 MiB of JSON a client with no key sends, as it is and gzipped.
let unkeyedJson: Buffer;
let unkeyedJsonGzip: Buffer;

const FOLDED: Buffer = Buffer.from("main;work;inner 12\nmain;idle 3\n");

const SOURCE_MAP: Buffer = Buffer.from(
  JSON.stringify({
    version: 3,
    sources: ["src/index.ts"],
    names: [],
    mappings: "AAAA",
  }),
);

// One binary as the OneUptime CLI sends it.
const CLI_DSYMS: Buffer = Buffer.from(
  JSON.stringify({
    appName: "storefront-ios",
    symbolFiles: [
      {
        debugId: APP_UUID.replace(/-/g, "").toLowerCase(),
        architecture: "arm64",
        binaryName: "MyApp",
        symbols: encodeAppleSymbols({
          symbols: [...APP_SYMBOLS],
          textEndOffset: APP_TEXT_END_OFFSET,
        }),
      },
    ],
  }),
);

interface Upload {
  // Who sends it so.
  how: string;
  headers: Record<string, string>;
  body: Buffer;
}

interface UploadRoute {
  name: string;
  path: string;
  // The parts that come before an upload's file, and the file's field.
  fields: Array<Part>;
  fileField: string;
  // Uploads its clients send, each of which the route takes.
  uploads: Array<Upload>;
  // What shows an upload was read and taken.
  isTaken: (sent: SentRequest) => void;
  // How many uploads were taken: queued, or kept.
  taken: () => number;
}

const BEARER: Record<string, string> = { authorization: `Bearer ${KEY}` };

function gzipped(upload: Upload): Upload {
  return {
    how: `${upload.how}, gzip-encoded`,
    headers: { ...upload.headers, "content-encoding": "gzip" },
    body: zlib.gzipSync(upload.body),
  };
}

const PROFILE_FORM: Upload = {
  how: "a multipart form, as pyroscope-go and pyroscope-dotnet up to 0.13 post it",
  headers: { "content-type": MULTIPART_TYPE, ...BEARER },
  body: multipart([
    { name: "profile", value: FOLDED, filename: "profile.pprof" },
    { name: "sample_type_config", value: Buffer.from("{}") },
  ]),
};

const SOURCE_MAP_FORM: Upload = {
  how: "a multipart form, as the documented curl posts it",
  headers: { "content-type": MULTIPART_TYPE, "x-oneuptime-token": KEY },
  body: multipart([
    { name: "serviceName", value: Buffer.from("my-web-app") },
    { name: "serviceVersion", value: Buffer.from("1.4.2") },
    {
      name: "sourcemap",
      value: SOURCE_MAP,
      filename: "main.a8f1b2.js.map",
    },
  ]),
};

const DSYM_FORM: Upload = {
  how: "a dSYM's DWARF file in a multipart form, as the documented curl posts it",
  headers: { "content-type": MULTIPART_TYPE, "x-oneuptime-token": KEY },
  body: multipart([
    { name: "appName", value: Buffer.from("storefront-ios") },
    {
      name: "dsym",
      value: buildAppMachO({ uuid: APP_UUID }),
      filename: "MyApp",
    },
  ]),
};

const DSYM_JSON: Upload = {
  how: "the symbol tables the OneUptime CLI reads, as JSON",
  headers: { "content-type": "application/json", "x-oneuptime-token": KEY },
  body: CLI_DSYMS,
};

let queued: number = 0;
const storedSourceMaps: Array<string> = [];
const storedDsyms: Array<string> = [];

const ROUTES: Array<UploadRoute> = [
  {
    name: "Pyroscope's /ingest",
    path: "/pyroscope/ingest?name=checkout&format=folded",
    fields: [],
    fileField: "profile",
    uploads: [
      PROFILE_FORM,
      gzipped(PROFILE_FORM),
      {
        how: "a multipart form, deflate-encoded",
        headers: { ...PROFILE_FORM.headers, "content-encoding": "deflate" },
        body: zlib.deflateSync(PROFILE_FORM.body),
      },
      {
        how: "the profile itself, as pyroscope-nodejs 0.6.2 and later post it",
        headers: { "content-type": "application/octet-stream", ...BEARER },
        body: FOLDED,
      },
      gzipped({
        how: "the profile itself, as the pyroscope-rs SDKs post it",
        headers: {
          "content-type": "binary/octet-stream",
          authorization: `Basic ${Buffer.from(`oneuptime:${KEY}`).toString("base64")}`,
        },
        body: FOLDED,
      }),
    ],
    isTaken: (sent: SentRequest): void => {
      expect(sent.answer.status).toBe(200);
    },
    taken: (): number => {
      return queued;
    },
  },
  {
    name: "source maps",
    path: "/source-maps/v1/upload",
    fields: [
      { name: "serviceName", value: Buffer.from("my-web-app") },
      { name: "serviceVersion", value: Buffer.from("1.4.2") },
    ],
    fileField: "sourcemap",
    uploads: [SOURCE_MAP_FORM, gzipped(SOURCE_MAP_FORM)],
    isTaken: (sent: SentRequest): void => {
      expect(sent.answer.status).toBe(200);
      expect(sent.answer.json).toMatchObject({
        serviceName: "my-web-app",
        serviceVersion: "1.4.2",
        sourceMaps: [{ bundlePath: "main.a8f1b2.js" }],
      });
    },
    taken: (): number => {
      return storedSourceMaps.length;
    },
  },
  {
    name: "dSYMs",
    path: "/dsyms/v1/upload",
    fields: [{ name: "appName", value: Buffer.from("storefront-ios") }],
    fileField: "dsym",
    uploads: [DSYM_JSON, gzipped(DSYM_JSON), DSYM_FORM, gzipped(DSYM_FORM)],
    isTaken: (sent: SentRequest): void => {
      expect(sent.answer.status).toBe(200);
      expect(sent.answer.json).toMatchObject({
        appName: "storefront-ios",
        dsyms: [{ debugId: APP_UUID, binaryName: "MyApp" }],
      });
    },
    taken: (): number => {
      return storedDsyms.length;
    },
  },
];

// A form with the route's fields and one file of `file`'s bytes.
function formWithFile(route: UploadRoute, file: Buffer): Buffer {
  return multipart([
    ...route.fields,
    { name: route.fileField, value: file, filename: "upload.bin" },
  ]);
}

/*
 * What zlib inflated, counted where its streams hand their output on (its
 * own functions are read-only), and what had been when each key was checked.
 */
const watched: { inflated: number } = { inflated: 0 };
const inflatedAtKeyCheck: Array<number> = [];

const readablePush: Readable["push"] = Readable.prototype.push;

const ZLIB_STREAMS: Array<{ push: Readable["push"] }> = [
  (zlib as unknown as { Gunzip: { prototype: { push: Readable["push"] } } })
    .Gunzip.prototype,
  (zlib as unknown as { Inflate: { prototype: { push: Readable["push"] } } })
    .Inflate.prototype,
];

let watchers: Array<ReturnType<typeof jest.spyOn>> = [];
let jsonParse: ReturnType<typeof jest.spyOn>;

// The longest text JSON.parse was handed since the test began.
function longestJsonParsed(): number {
  return (jsonParse.mock.calls as Array<Array<unknown>>).reduce(
    (longest: number, call: Array<unknown>): number => {
      return typeof call[0] === "string"
        ? Math.max(longest, call[0].length)
        : longest;
    },
    0,
  );
}

let server: BodyServer;

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
        inflatedAtKeyCheck.push(watched.inflated);

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

  // Pyroscope: a profile taken is queued.
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

  // Source maps: the service found by its name, each map kept.
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation(
      async (data: {
        serviceName: string;
      }): Promise<TelemetryServiceMetadata> => {
        return {
          serviceName: data.serviceName,
          primaryEntityId: ObjectID.generate(),
          primaryEntityType: ServiceType.OpenTelemetry,
        } as TelemetryServiceMetadata;
      },
    );
  jest
    .spyOn(TelemetrySourceMapService, "getStoredBundlePathsForRelease")
    .mockResolvedValue([]);
  jest
    .spyOn(TelemetrySourceMapService, "replaceSourceMap")
    .mockImplementation(
      async (data: { bundlePath: string }): Promise<TelemetrySourceMap> => {
        storedSourceMaps.push(data.bundlePath);

        const map: TelemetrySourceMap = new TelemetrySourceMap();
        map._id = ObjectID.generate().toString();
        return map;
      },
    );

  // dSYMs: each binary kept.
  jest
    .spyOn(TelemetryDsymService, "replaceSymbolFile")
    .mockImplementation(
      async (data: {
        file: { debugId: string; symbols: Array<unknown> };
      }): Promise<TelemetryDsym> => {
        storedDsyms.push(data.file.debugId);

        const dsym: TelemetryDsym = new TelemetryDsym();
        dsym._id = ObjectID.generate().toString();
        dsym.symbolCount = data.file.symbols.length;
        return dsym;
      },
    );

  incompressibleOver = zlib.gzipSync(noise(OVER, RANDOM), { level: 1 });

  unkeyedJson = Buffer.from(
    JSON.stringify({
      appName: "storefront-ios",
      padding: UNKEYED_FILE.toString("base64").slice(0, UNKEYED - 64),
    }),
  );
  unkeyedJsonGzip = zlib.gzipSync(unkeyedJson, { level: 1 });

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], PyroscopeAPI);
  app.use(["/telemetry", "/"], SourceMapIngestAPI);
  app.use(["/telemetry", "/"], DsymIngestAPI);
  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
  jest.restoreAllMocks();
});

beforeEach(() => {
  (logger.error as unknown as jest.Mock).mockClear();
  queued = 0;
  storedSourceMaps.length = 0;
  storedDsyms.length = 0;
  inflatedAtKeyCheck.length = 0;
  watched.inflated = 0;

  watchers = ZLIB_STREAMS.map(
    (prototype: { push: Readable["push"] }): ReturnType<typeof jest.spyOn> => {
      return jest.spyOn(prototype, "push").mockImplementation(function (
        this: Readable,
        chunk: unknown,
        encoding?: Parameters<Readable["push"]>[1],
      ): boolean {
        if (Buffer.isBuffer(chunk)) {
          watched.inflated += chunk.length;
        }

        return readablePush.call(this, chunk, encoding);
      });
    },
  );
  jsonParse = jest.spyOn(JSON, "parse");
});

afterEach(() => {
  for (const watcher of watchers) {
    watcher.mockRestore();
  }

  watchers = [];
  jsonParse.mockRestore();
});

// Nothing of a refused upload was taken: queued, or kept.
function expectNothingTaken(): void {
  expect(queued).toBe(0);
  expect(storedSourceMaps).toEqual([]);
  expect(storedDsyms).toEqual([]);
}

describe("the routes", () => {
  test("are read after their key, under every prefix: StartServer leaves their bodies unread", () => {
    for (const route of ROUTES) {
      const path: string = route.path.split("?")[0]!;

      for (const prefix of TELEMETRY_ROUTE_PREFIXES) {
        expect({
          path: `${prefix}${path}`,
          afterKey: readsBodyAfterAuthentication(`${prefix}${path}`),
        }).toEqual({ path: `${prefix}${path}`, afterKey: true });
      }
    }

    /*
     * Pyroscope's push.v1 route is no upload, and is read once its key is
     * right too (#10702): IngestKeyBeforeBodyOverHttp drives it.
     */
    expect(
      readsBodyAfterAuthentication("/pyroscope/push.v1.PusherService/Push"),
    ).toBe(true);
  });
});

describe.each(ROUTES)("$name", (route: UploadRoute) => {
  test.each(
    route.uploads.map((upload: Upload): [string, Upload] => {
      return [upload.how, upload];
    }),
  )(
    "with the right key, %s is taken, declared and chunked, on kept and closed connections",
    async (_how: string, upload: Upload) => {
      for (const connection of CONNECTIONS) {
        for (const chunked of [false, true]) {
          const sent: SentRequest = await sendOverHttp(server, {
            path: route.path,
            headers: upload.headers,
            connection: connection,
            chunked: chunked,
            body: upload.body,
          });

          route.isTaken(sent);
          expect(sent.answer.clientError).toBeNull();
        }
      }

      // One each time: on two connections, declared and chunked.
      expect(route.taken()).toBe(4);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("the key is checked from the headers before a byte of the body is inflated", async () => {
    const upload: Upload = gzipped(route.uploads[0]!);

    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: upload.headers,
      body: upload.body,
    });

    route.isTaken(sent);
    // Once, with nothing inflated yet; then the upload, whole.
    expect(inflatedAtKeyCheck).toEqual([0]);
    expect(watched.inflated).toBe(route.uploads[0]!.body.length);
  });

  test.each([...CONNECTIONS])(
    "with no key, 40 MiB are refused 401, declared or chunked, with a socket read or two read: nothing inflated or parsed (%s)",
    async (connection: Connection) => {
      const body: Buffer = formWithFile(route, UNKEYED_FILE);

      for (const chunked of [false, true]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: route.path,
          headers: { "content-type": MULTIPART_TYPE },
          connection: connection,
          chunked: chunked,
          body: body,
        });

        expect(sent.answer.status).toBe(401);
        expect(sent.answer.json).toEqual({
          message:
            "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
        });
        expect(sent.answer.clientError).toBeNull();
        // Closed under the rest, which is never read.
        expect(sent.answer.connection).toBe("close");
        expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
          READ_OR_TWO,
        );
      }

      expect(watched.inflated).toBe(0);
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
      expectNothingTaken();
    },
  );

  test.each([...CONNECTIONS])(
    "with a wrong key, 40 MiB are refused 401 the same way, unread (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: {
          "content-type": MULTIPART_TYPE,
          authorization: "Bearer 00000000-0000-4000-8000-000000000000",
        },
        connection: connection,
        body: formWithFile(route, UNKEYED_FILE),
      });

      expect(sent.answer.status).toBe(401);
      expect(sent.answer.json).toEqual({
        message:
          "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.",
      });
      expect(sent.answer.connection).toBe("close");
      expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
      expect(watched.inflated).toBe(0);
      expectNothingTaken();
    },
  );

  test("with no key, a gzip upload is refused 401 with nothing of it inflated", async () => {
    const body: Buffer = zlib.gzipSync(
      formWithFile(route, Buffer.alloc(UNKEYED, 0x61)),
    );

    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: { "content-type": MULTIPART_TYPE, "content-encoding": "gzip" },
      body: body,
    });

    expect(sent.answer.status).toBe(401);
    // StartServer inflated all 40 MiB of it before routing, for anyone.
    expect(watched.inflated).toBe(0);
    expect(inflatedAtKeyCheck).toEqual([]);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expectNothingTaken();
  });

  test("with no key, sent with fetch: the 401 is read, the rest unread", async () => {
    const sent: SentRequest = await sendWithFetch(server, {
      path: route.path,
      headers: { "content-type": MULTIPART_TYPE },
      bytes: UNKEYED,
    });

    expect(sent.answer.clientError).toBeNull();
    expect(sent.answer.status).toBe(401);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test("a key sent in the body alone was never a key: refused 401 as one with none, now unread", async () => {
    /*
     * No client sends its key only in the body: every Pyroscope SDK sends it
     * as Authorization (Bearer or Basic, or the URL's user, which they send
     * as Basic) or a custom header, the CLI and the documented curl as
     * x-oneuptime-token. And the check reads only headers, so a key in a
     * form field was refused before as well - once all of the body had been
     * read and parsed.
     */
    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: { "content-type": MULTIPART_TYPE },
      body: multipart([
        { name: "x-oneuptime-token", value: Buffer.from(KEY) },
        { name: "authorization", value: Buffer.from(`Bearer ${KEY}`) },
        ...route.fields,
        { name: route.fileField, value: UNKEYED_FILE, filename: "upload.bin" },
      ]),
    });

    expect(sent.answer.status).toBe(401);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expectNothingTaken();
  });

  test.each([...CONNECTIONS])(
    "with the right key, over 50 MB uncompressed: refused 413 before a byte is read when declared, at the limit when chunked (%s)",
    async (connection: Connection) => {
      const body: Buffer = formWithFile(route, Buffer.alloc(OVER, 0x61));
      const headers: Record<string, string> = {
        "content-type": MULTIPART_TYPE,
        ...BEARER,
      };

      const declared: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headers,
        connection: connection,
        body: body,
      });

      expect(declared.answer.status).toBe(413);
      expect(declared.answer.json).toEqual({
        error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
      });
      expect(declared.answer.connection).toBe("close");
      expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
        READ_OR_TWO,
      );

      const chunked: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headers,
        connection: connection,
        chunked: true,
        body: body,
      });

      expect(chunked.answer.status).toBe(413);
      expect(chunked.answer.connection).toBe("close");

      const read: number = await server.readInAll(chunked.tag);

      expect(read).toBeGreaterThan(LIMIT);
      expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
      expectNothingTaken();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("with the right key, a gzip upload over 50 MB is refused 413 in the same words: as it inflates, and as it is sent", async () => {
    const headers: Record<string, string> = {
      "content-type": MULTIPART_TYPE,
      "content-encoding": "gzip",
      ...BEARER,
    };

    // 64 MiB of one byte in about 64 KiB: refused once 50 MB have inflated.
    const bomb: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: headers,
      chunked: true,
      body: zlib.gzipSync(formWithFile(route, Buffer.alloc(OVER, 0x61))),
    });

    expect(bomb.answer.status).toBe(413);
    expect(bomb.answer.json).toEqual({
      error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
    expect(bomb.answer.connection).toBe("close");
    expect(await server.readInAll(bomb.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expect(watched.inflated).toBeGreaterThan(LIMIT);
    expect(watched.inflated).toBeLessThanOrEqual(LIMIT + MIB);

    // 64 MiB that do not compress: over the limit as sent, declared or not.
    const declared: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: headers,
      body: incompressibleOver,
    });

    expect(declared.answer.status).toBe(413);
    expect(declared.answer.json).toEqual({
      error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
    expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
      READ_OR_TWO,
    );

    const chunked: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: headers,
      chunked: true,
      body: incompressibleOver,
    });

    expect(chunked.answer.status).toBe(413);
    expect(chunked.answer.json).toEqual({
      error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });

    const read: number = await server.readInAll(chunked.tag);

    expect(read).toBeGreaterThan(LIMIT);
    expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
    expectNothingTaken();
  });
});

describe("JSON, which dSYMs take", () => {
  test.each([...CONNECTIONS])(
    "with no key, 40 MiB of JSON are refused 401 unread, never parsed (%s)",
    async (connection: Connection) => {
      for (const encoding of [undefined, "gzip"]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: "/dsyms/v1/upload",
          headers: {
            "content-type": "application/json",
            ...(encoding ? { "content-encoding": encoding } : {}),
          },
          connection: connection,
          body: encoding ? unkeyedJsonGzip : unkeyedJson,
        });

        expect(sent.answer.status).toBe(401);
        expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
          READ_OR_TWO,
        );
      }

      // StartServer parsed it before routing, for anyone.
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
      expect(watched.inflated).toBe(0);
      expectNothingTaken();
    },
  );

  test("with the right key, JSON holding more values than a large route reads is refused 413 before it is parsed, as StartServer refused it", async () => {
    const values: Buffer = Buffer.from(
      `{"symbolFiles":[${"0,".repeat(LARGE_REQUEST_BODY_JSON_VALUES)}0]}`,
    );

    for (const encoding of [undefined, "gzip"]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/dsyms/v1/upload",
        headers: {
          "content-type": "application/json",
          ...(encoding ? { "content-encoding": encoding } : {}),
          ...BEARER,
        },
        body: encoding ? zlib.gzipSync(values) : values,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.json).toEqual({
        error: getTooManyJsonValuesMessage(
          JsonElementLimit.Values,
          LARGE_REQUEST_BODY_JSON_VALUES,
        ),
      });
    }

    expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
    expectNothingTaken();
  });

  test("source maps take no JSON, and say what is missing as they did", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/source-maps/v1/upload",
      headers: { "content-type": "application/json", ...BEARER },
      body: Buffer.from(
        JSON.stringify({ serviceName: "my-web-app", serviceVersion: "1.4.2" }),
      ),
    });

    expect(sent.answer.status).toBe(400);
    expect(sent.answer.json).toMatchObject({
      error:
        "No source map files were uploaded. Attach at least one .map file as a multipart file part.",
    });
  });
});

describe("a raw profile, which Pyroscope's /ingest takes", () => {
  test.each([...CONNECTIONS])(
    "with no key, 40 MiB are refused 401 unread, gzip-encoded or not (%s)",
    async (connection: Connection) => {
      for (const encoding of [undefined, "gzip"]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: "/pyroscope/ingest?name=checkout",
          headers: {
            "content-type": "binary/octet-stream",
            ...(encoding ? { "content-encoding": encoding } : {}),
          },
          connection: connection,
          body: encoding
            ? zlib.gzipSync(Buffer.alloc(UNKEYED, 0x61))
            : UNKEYED_FILE,
        });

        expect(sent.answer.status).toBe(401);
        expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
          READ_OR_TWO,
        );
      }

      expect(watched.inflated).toBe(0);
      expectNothingTaken();
    },
  );

  test("with the right key, a profile of any type is read as its bytes: folded text sent as text/plain is taken", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/pyroscope/ingest?name=checkout&format=folded",
      headers: { "content-type": "text/plain", ...BEARER },
      body: FOLDED,
    });

    expect(sent.answer.status).toBe(200);
    expect(queued).toBe(1);
  });

  test("with the right key, JSON is no profile: refused 400 in the handler's words", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/pyroscope/ingest?name=checkout",
      headers: { "content-type": "application/json", ...BEARER },
      body: Buffer.from(JSON.stringify({ profile: "nothing" })),
    });

    expect(sent.answer.status).toBe(400);
    expectNothingTaken();
  });
});

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * Router-capture pattern (see SessionReplayIngestAPI.test.ts): mock the
 * Express router so importing the route module records its middleware
 * chain, then drive the captured handlers with hand-built requests.
 */
const registeredPostHandlers: Record<string, Array<unknown>> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (uri: string, ...handlers: Array<unknown>) => {
            registeredPostHandlers[uri] = handlers;
          },
        };
      },
    },
  };
});

const authMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: authMiddleware,
    },
  };
});

const ingestionDisabledMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: ingestionDisabledMiddleware,
      isDisabled: jest.fn().mockReturnValue(false),
    },
  };
});

/*
 * The two source map knobs, read from the REAL config module rather than
 * repeated as literals: this suite is about the route and the ingest service
 * honouring whatever an operator configured, and
 * Common/Tests/Server/Utils/Telemetry/SourceMapLimits.test.ts is what pins the
 * numbers themselves.
 */
interface SourceMapConfigShape {
  SourceMapMaxFilesPerRequest: number;
  SourceMapMaxMapsPerRelease: number;
}

const realEnvironmentConfig: SourceMapConfigShape = jest.requireActual(
  "Common/Server/EnvironmentConfig",
) as SourceMapConfigShape;

/*
 * Both knobs are served through live accessors, so one file can cover several
 * differently configured deployments. That works because the ingest service
 * reads each constant at call time. The ROUTE reads the per-request one once,
 * at import time, so reassigning these never re-mounts the middleware —
 * SourceMapIngestRouteMultipart.test.ts covers that side.
 */
let mockMaxFilesPerRequest: number =
  realEnvironmentConfig.SourceMapMaxFilesPerRequest;
let mockMaxMapsPerRelease: number =
  realEnvironmentConfig.SourceMapMaxMapsPerRelease;

/*
 * Only SOURCE_MAP_MAX_FILES_PER_REQUEST is replaced; every other export stays
 * real, because SourceMapResolver — deliberately unmocked so content
 * validation runs for real — reads its own size ceiling from this module.
 *
 * It has to be an accessor installed with defineProperty rather than a getter
 * in an object literal: object spread compiles to Object.assign, which READS
 * every accessor it copies and flattens it to whatever it returned at that
 * moment.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "SourceMapMaxFilesPerRequest", {
    get: (): number => {
      return mockMaxFilesPerRequest;
    },
  });

  return mocked;
});

const multipartMiddleware: unknown = jest.fn();

/*
 * Real value from the middleware: the shared ceiling every route that mounts
 * the multipart parser is held to. Before this change it was ALSO the ingest
 * service's per-request file guard.
 */
const MAX_MULTIPART_FILES: number = 50;

interface MultipartMiddlewareBuild {
  maxFiles: number;
  middleware: unknown;
}

/*
 * Every getMultipartFormDataMiddleware() call the route module made. A plain
 * array rather than a jest.fn's call log: the route builds its middleware once,
 * at import time, and the jest.clearAllMocks() in beforeEach would wipe that
 * single call long before any test could read it.
 */
const multipartMiddlewareBuilds: Array<MultipartMiddlewareBuild> = [];

jest.mock("Common/Server/Middleware/MultipartFormData", () => {
  return {
    __esModule: true,
    default: multipartMiddleware,
    MAX_MULTIPART_FILES: MAX_MULTIPART_FILES,
    /*
     * Mirrors the real builder closely enough that identity means the same
     * thing here as in production: maxFiles is clamped into
     * [1, MAX_MULTIPART_FILES], and a caller that narrows nothing gets the
     * SHARED default instance back rather than a second multer.
     */
    getMultipartFormDataMiddleware: (options: {
      maxFiles: number;
    }): unknown => {
      const clampedMaxFiles: number = Math.max(
        1,
        Math.min(options.maxFiles, MAX_MULTIPART_FILES),
      );

      const middleware: unknown =
        clampedMaxFiles === MAX_MULTIPART_FILES ? multipartMiddleware : jest.fn();

      multipartMiddlewareBuilds.push({
        maxFiles: options.maxFiles,
        middleware: middleware,
      });

      return middleware;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (): void => {
        // No-op decorator: the real one needs a live tracer provider.
      };
    },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    default: {
      telemetryServiceFromName: jest.fn(),
    },
  };
});

/*
 * Only the database-touching service is mocked. Content validation runs
 * for real: the ingest service calls
 * SourceMapResolver.validateSourceMapContent, and that module is pure
 * (no DB), so it is deliberately NOT mocked here.
 */
jest.mock("Common/Server/Services/TelemetrySourceMapService", () => {
  const mocked: Record<string, unknown> = {
    __esModule: true,
    default: {
      replaceSourceMap: jest.fn(),
      getStoredBundlePathsForRelease: jest.fn(),
    },
  };

  /*
   * = SourceMapMaxMapsPerRelease in the real service, so it defaults to the
   * shipped ceiling. A live accessor, so this file can also exercise a
   * deployment that configured the ceiling LOWER — the only shape in which
   * "re-upload every bundle this release holds" is a request small enough to
   * send.
   */
  Object.defineProperty(mocked, "MAX_SOURCE_MAPS_PER_RELEASE", {
    get: (): number => {
      return mockMaxMapsPerRelease;
    },
  });

  return mocked;
});

import Response from "Common/Server/Utils/Response";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetrySourceMapService, {
  MAX_SOURCE_MAPS_PER_RELEASE,
} from "Common/Server/Services/TelemetrySourceMapService";
import { SourceMapMaxFilesPerRequest } from "Common/Server/EnvironmentConfig";
import SourceMapIngestService from "../../FeatureSet/Telemetry/Services/SourceMapIngestService";
// Importing the router module registers the routes on the mocked router.
import "../../FeatureSet/Telemetry/API/SourceMapIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const telemetryServiceFromNameMock: MockedFn =
  OTelIngestService.telemetryServiceFromName as unknown as MockedFn;
const replaceSourceMapMock: MockedFn =
  TelemetrySourceMapService.replaceSourceMap as unknown as MockedFn;
const getStoredBundlePathsMock: MockedFn =
  TelemetrySourceMapService.getStoredBundlePathsForRelease as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

const UPLOAD_ROUTE: string = "/source-maps/v1/upload";

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const VALID_MAP: string = JSON.stringify({
  version: 3,
  sources: ["src/index.ts"],
  names: [],
  mappings: "AAAA",
});

interface FilePart {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

type MakeFileFunction = (originalname: string, content?: string) => FilePart;

const makeFile: MakeFileFunction = (
  originalname: string,
  content?: string,
): FilePart => {
  return {
    fieldname: "sourcemap",
    originalname: originalname,
    buffer: Buffer.from(content ?? VALID_MAP, "utf8"),
  };
};

type BundlePathsFunction = (prefix: string, count: number) => Array<string>;

/*
 * `count` distinct bundle paths under one prefix — "chunk" for what a release
 * already holds, "new" for what a request is adding. Route-split builds are
 * exactly this shape, and the prefix is what keeps "replaces an existing
 * bundle" and "adds a bundle" unambiguous in the per-release arithmetic.
 */
const bundlePaths: BundlePathsFunction = (
  prefix: string,
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${prefix}-${index}.js`;
  });
};

type FilesForFunction = (paths: Array<string>) => Array<FilePart>;

// The upload parts a CI job would send for those bundles: <bundlePath>.map.
const filesFor: FilesForFunction = (paths: Array<string>): Array<FilePart> => {
  return paths.map((path: string): FilePart => {
    return makeFile(`${path}.map`);
  });
};

type MakeRequestFunction = (data: {
  body?: Record<string, unknown>;
  files?: Array<FilePart>;
  headers?: Record<string, string>;
}) => ExpressRequest;

const makeRequest: MakeRequestFunction = (data: {
  body?: Record<string, unknown>;
  files?: Array<FilePart>;
  headers?: Record<string, string>;
}): ExpressRequest => {
  return {
    projectId: PROJECT_ID,
    body: data.body || {},
    files: data.files || [],
    headers: data.headers || {},
  } as unknown as ExpressRequest;
};

type InvokeHandlerFunction = (req: ExpressRequest) => Promise<Error | null>;

/*
 * Runs the route's terminal handler (which delegates to
 * SourceMapIngestService.uploadSourceMaps); returns whatever error it
 * passed to next(), or null on success.
 */
const invokeHandler: InvokeHandlerFunction = async (
  req: ExpressRequest,
): Promise<Error | null> => {
  const handlers: Array<unknown> = registeredPostHandlers[UPLOAD_ROUTE]!;
  const terminalHandler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> = handlers[handlers.length - 1] as never;

  let nextError: Error | null = null;

  await terminalHandler(
    req,
    {} as ExpressResponse,
    ((err?: unknown): void => {
      if (err) {
        nextError = err as Error;
      }
    }) as NextFunction,
  );

  return nextError;
};

beforeEach(() => {
  jest.clearAllMocks();

  /*
   * Back to the shipped configuration: a case that moves a knob is describing
   * a different deployment, and must not leak that into the next one.
   */
  mockMaxFilesPerRequest = realEnvironmentConfig.SourceMapMaxFilesPerRequest;
  mockMaxMapsPerRelease = realEnvironmentConfig.SourceMapMaxMapsPerRelease;

  telemetryServiceFromNameMock.mockResolvedValue({
    serviceName: "my-web-app",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: "OpenTelemetry",
  } as never);

  replaceSourceMapMock.mockResolvedValue({
    id: ObjectID.generate(),
  } as never);

  getStoredBundlePathsMock.mockResolvedValue([] as never);
});

describe("route registration", () => {
  test("registers POST /source-maps/v1/upload", () => {
    expect(registeredPostHandlers[UPLOAD_ROUTE]).toBeDefined();
  });

  test("middleware order: ingestion-disabled gate → multipart → bearer adapter → auth → handler", () => {
    const handlers: Array<unknown> = registeredPostHandlers[UPLOAD_ROUTE]!;

    expect(handlers).toHaveLength(5);
    expect(handlers[0]).toBe(ingestionDisabledMiddleware);
    expect(handlers[1]).toBe(multipartMiddleware);
    // handlers[2] is the local bearer-token adapter (asserted behaviourally below)
    expect(handlers[3]).toBe(authMiddleware);
  });

  test("the mounted multipart middleware is built from SOURCE_MAP_MAX_FILES_PER_REQUEST", () => {
    /*
     * The route asks the middleware module for an instance sized to the knob
     * instead of mounting the shared default export directly. At the shipped
     * default the builder hands that very instance back — so what matters here
     * is that the knob is what was passed, because that is what makes lowering
     * it narrow the mount. SourceMapIngestRouteMultipart.test.ts loads the
     * route at other values and asserts the mount actually changes.
     */
    expect(multipartMiddlewareBuilds).toHaveLength(1);
    expect(multipartMiddlewareBuilds[0]!.maxFiles).toBe(
      realEnvironmentConfig.SourceMapMaxFilesPerRequest,
    );
    expect(registeredPostHandlers[UPLOAD_ROUTE]![1]).toBe(
      multipartMiddlewareBuilds[0]!.middleware,
    );
  });

  test("the multipart middleware is built once at module load, not per request", async () => {
    /*
     * Every build constructs a multer instance. Building it inside the request
     * handler would allocate one per upload, which is why the route hoists the
     * call to module scope.
     */
    await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("main.js.map")],
      }),
    );
    await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("vendor.js.map")],
      }),
    );

    expect(multipartMiddlewareBuilds).toHaveLength(1);
  });

  test("the bearer adapter copies Authorization: Bearer into x-oneuptime-token", () => {
    const bearerAdapter: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => void = registeredPostHandlers[UPLOAD_ROUTE]![2] as never;

    const req: ExpressRequest = makeRequest({
      headers: { authorization: "Bearer secret-token" },
    });
    const next: MockedFn = jest.fn();

    bearerAdapter(req, {} as ExpressResponse, next as never);

    expect(req.headers["x-oneuptime-token"]).toBe("secret-token");
    expect(next).toHaveBeenCalled();
  });

  test("the bearer adapter does not overwrite an existing token", () => {
    const bearerAdapter: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => void = registeredPostHandlers[UPLOAD_ROUTE]![2] as never;

    const req: ExpressRequest = makeRequest({
      headers: {
        "x-oneuptime-token": "already-set",
        authorization: "Bearer other",
      },
    });

    bearerAdapter(req, {} as ExpressResponse, jest.fn() as never);

    expect(req.headers["x-oneuptime-token"]).toBe("already-set");
  });
});

describe("uploadSourceMaps", () => {
  test("stores one map per file, deriving the bundle path from the file name", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [
          makeFile("main.abc123.js.map"),
          makeFile("vendor.9c3d4e.js.map"),
        ],
      }),
    );

    expect(error).toBeNull();

    expect(telemetryServiceFromNameMock).toHaveBeenCalledWith({
      serviceName: "my-web-app",
      projectId: PROJECT_ID,
    });

    expect(replaceSourceMapMock).toHaveBeenCalledTimes(2);
    expect(replaceSourceMapMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      serviceVersion: "1.4.2",
      bundlePath: "main.abc123.js",
      content: VALID_MAP,
    });
    expect(replaceSourceMapMock).toHaveBeenCalledWith(
      expect.objectContaining({ bundlePath: "vendor.9c3d4e.js" }),
    );

    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    const responseBody: Record<string, unknown> = sendJsonMock.mock
      .calls[0]![2] as never;
    expect(responseBody["serviceId"]).toBe(SERVICE_ID.toString());
    expect((responseBody["sourceMaps"] as Array<unknown>).length).toBe(2);
  });

  test("an explicit bundlePath field overrides the file name for a single file", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: {
          serviceName: "my-web-app",
          serviceVersion: "1.4.2",
          bundlePath: "assets/entry.js",
        },
        files: [makeFile("whatever.map")],
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledWith(
      expect.objectContaining({ bundlePath: "assets/entry.js" }),
    );
  });

  test("rejects an over-long serviceName with a 400 instead of an opaque insert failure", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: {
          serviceName: "s".repeat(101),
          serviceVersion: "1.4.2",
        },
        files: [makeFile("main.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(telemetryServiceFromNameMock).not.toHaveBeenCalled();
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("rejects an upload that would take the release past the per-release map limit", async () => {
    // A release already at the ceiling; this upload adds a new bundle.
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", MAX_SOURCE_MAPS_PER_RELEASE) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("brand-new.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("replacing an already-stored bundle does not count against the per-release limit", async () => {
    // At the limit, but the upload replaces an existing bundle.
    const storedPaths: Array<string> = bundlePaths(
      "chunk",
      MAX_SOURCE_MAPS_PER_RELEASE,
    );
    storedPaths[0] = "main.abc123.js";

    getStoredBundlePathsMock.mockResolvedValue(storedPaths as never);

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("main.abc123.js.map")],
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(1);
  });

  test("rejects a missing serviceName", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceVersion: "1.4.2" },
        files: [makeFile("main.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("rejects a missing serviceVersion", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app" },
        files: [makeFile("main.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("rejects a serviceVersion longer than the column can store", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: {
          serviceName: "my-web-app",
          serviceVersion: "v".repeat(101),
        },
        files: [makeFile("main.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("rejects a request without any files", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("rejects bundlePath combined with multiple files", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: {
          serviceName: "my-web-app",
          serviceVersion: "1.4.2",
          bundlePath: "main.js",
        },
        files: [makeFile("a.js.map"), makeFile("b.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("rejects two files that resolve to the same bundle path", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("main.js.map"), makeFile("main.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("rejects an empty file", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("main.js.map", "")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("validates every file before saving any, so one bad file stores nothing", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("good.js.map"), makeFile("bad.js.map", "{not json")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
    expect(telemetryServiceFromNameMock).not.toHaveBeenCalled();
  });

  test("rejects a file that is not a version 3 source map", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("main.js.map", JSON.stringify({ version: 2 }))],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
  });
});

/*
 * The per-request file cap.
 *
 * It used to be MAX_MULTIPART_FILES — the shared multipart ceiling every route
 * that parses a multipart body is held to. It is SOURCE_MAP_MAX_FILES_PER_REQUEST
 * now. The two are the same number by default (the knob is clamped to that
 * ceiling and can only be lowered), so the boundary cases below pin the edge at
 * the knob's value and the lowered case is what proves WHICH of the two the
 * service reads.
 */
describe("per-request file cap", () => {
  test("accepts exactly SOURCE_MAP_MAX_FILES_PER_REQUEST files in one request", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("chunk", SourceMapMaxFilesPerRequest)),
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(
      SourceMapMaxFilesPerRequest,
    );
  });

  test("rejects one file more than SOURCE_MAP_MAX_FILES_PER_REQUEST", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("chunk", SourceMapMaxFilesPerRequest + 1)),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("the rejection names the per-request limit and the per-release one, so splitting the upload reads as the fix", async () => {
    /*
     * These are different numbers now — 50 per request, a thousand per release
     * — and a message that quoted only one of them would read as "your release
     * is full" for a CI job that simply sent too many files at once.
     */
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("chunk", SourceMapMaxFilesPerRequest + 1)),
      }),
    );

    const message: string = (error as BadDataException).message;

    expect(message).toContain(
      `At most ${SourceMapMaxFilesPerRequest} source maps can be uploaded in one request.`,
    );
    expect(message).toContain("Split the upload across requests");
    expect(message).toContain(
      `up to ${MAX_SOURCE_MAPS_PER_RELEASE} maps are kept per release.`,
    );
  });

  test("an over-sized request is rejected before any service lookup, so it costs no database work", async () => {
    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("chunk", SourceMapMaxFilesPerRequest + 1)),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(telemetryServiceFromNameMock).not.toHaveBeenCalled();
    expect(getStoredBundlePathsMock).not.toHaveBeenCalled();
  });

  test("a lowered SOURCE_MAP_MAX_FILES_PER_REQUEST caps the request, not the shared multipart ceiling", async () => {
    /*
     * The regression this guards: six files is comfortably under
     * MAX_MULTIPART_FILES, which is what the guard used to read, so an operator
     * who narrowed the knob would have seen it ignored.
     */
    mockMaxFilesPerRequest = 5;

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("chunk", 6)),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toContain(
      "At most 5 source maps can be uploaded in one request.",
    );
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("a lowered SOURCE_MAP_MAX_FILES_PER_REQUEST still accepts a request exactly at it", async () => {
    mockMaxFilesPerRequest = 5;

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("chunk", 5)),
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(5);
  });

  test("the per-request cap does not cap the release: a later request tops the same release up past it", async () => {
    /*
     * "Split the upload across requests" has to actually work, which it only
     * does because the per-request cap and the per-release ceiling are separate
     * limits.
     */
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", SourceMapMaxFilesPerRequest) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("later", SourceMapMaxFilesPerRequest)),
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(
      SourceMapMaxFilesPerRequest,
    );
  });
});

/*
 * The per-release ceiling.
 *
 * It was a hardcoded 100 that also bounded what the resolver would READ, so it
 * could not safely be raised: more stored maps than the reader would look at
 * meant maps that uploaded fine and then silently never resolved. It is an
 * operator knob with a far higher default now, and a byte budget bounds the
 * read path instead — so the arithmetic below is the whole of what decides
 * whether a route-split build's CI upload succeeds.
 */
describe("per-release ceiling", () => {
  test("a release holding the old hardcoded 100 maps now accepts more", async () => {
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", 100) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("brand-new.js.map")],
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(1);
  });

  test("a release one under the ceiling accepts one more bundle", async () => {
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", MAX_SOURCE_MAPS_PER_RELEASE - 1) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("brand-new.js.map")],
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(1);
  });

  test("stored plus new that lands exactly on the ceiling is accepted", async () => {
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", MAX_SOURCE_MAPS_PER_RELEASE - 10) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("new", 10)),
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(10);
  });

  test("one bundle past the ceiling is rejected, and nothing from that request is stored", async () => {
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", MAX_SOURCE_MAPS_PER_RELEASE - 10) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(bundlePaths("new", 11)),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    // The ten that would have fit are not written either — the gate is all or nothing.
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("re-uploading bundles the release already holds does not count them twice", async () => {
    /*
     * The common case for a rebuild of an unchanged release: at the ceiling,
     * every file in the request replaces a stored bundle, so the release's
     * distinct-bundle count does not move.
     */
    const storedPaths: Array<string> = bundlePaths(
      "chunk",
      MAX_SOURCE_MAPS_PER_RELEASE,
    );
    getStoredBundlePathsMock.mockResolvedValue(storedPaths as never);

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(storedPaths.slice(0, SourceMapMaxFilesPerRequest)),
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(
      SourceMapMaxFilesPerRequest,
    );
  });

  test("a request that mixes replacements with one new bundle is rejected at the ceiling", async () => {
    const storedPaths: Array<string> = bundlePaths(
      "chunk",
      MAX_SOURCE_MAPS_PER_RELEASE,
    );
    getStoredBundlePathsMock.mockResolvedValue(storedPaths as never);

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor([...storedPaths.slice(0, 9), "brand-new.js"]),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(replaceSourceMapMock).not.toHaveBeenCalled();
  });

  test("at a lower configured ceiling, re-uploading every stored bundle still succeeds", async () => {
    // Small enough that "every bundle this release holds" fits in one request.
    mockMaxMapsPerRelease = 3;

    const storedPaths: Array<string> = bundlePaths("chunk", 3);
    getStoredBundlePathsMock.mockResolvedValue(storedPaths as never);

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: filesFor(storedPaths),
      }),
    );

    expect(error).toBeNull();
    expect(replaceSourceMapMock).toHaveBeenCalledTimes(3);
  });

  test("at a lower configured ceiling, one bundle past it is rejected", async () => {
    mockMaxMapsPerRelease = 3;

    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", 3) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("brand-new.js.map")],
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toContain(
      "past the limit of 3 per release",
    );
  });

  test("the rejection names the env var an operator raises to make room", async () => {
    /*
     * The ceiling is configuration now, so the 400 has to say so — otherwise
     * the only readings left are "delete maps" and "this product cannot hold
     * my build", neither of which is true.
     */
    getStoredBundlePathsMock.mockResolvedValue(
      bundlePaths("chunk", MAX_SOURCE_MAPS_PER_RELEASE) as never,
    );

    const error: Error | null = await invokeHandler(
      makeRequest({
        body: { serviceName: "my-web-app", serviceVersion: "1.4.2" },
        files: [makeFile("brand-new.js.map")],
      }),
    );

    const message: string = (error as BadDataException).message;

    expect(message).toContain(
      `This release already has ${MAX_SOURCE_MAPS_PER_RELEASE} source maps`,
    );
    expect(message).toContain(
      `past the limit of ${MAX_SOURCE_MAPS_PER_RELEASE} per release.`,
    );
    expect(
      message.endsWith(
        "Delete unused maps, use a new serviceVersion, or raise SOURCE_MAP_MAX_MAPS_PER_RELEASE.",
      ),
    ).toBe(true);
  });
});

describe("bundlePathFromFileName", () => {
  test("strips a trailing .map", () => {
    expect(
      SourceMapIngestService.bundlePathFromFileName("main.abc123.js.map"),
    ).toBe("main.abc123.js");
  });

  test("is case-insensitive about the extension", () => {
    expect(SourceMapIngestService.bundlePathFromFileName("MAIN.JS.MAP")).toBe(
      "MAIN.JS",
    );
  });

  test("leaves a non-.map name unchanged", () => {
    expect(SourceMapIngestService.bundlePathFromFileName("main.js")).toBe(
      "main.js",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(
      SourceMapIngestService.bundlePathFromFileName("  main.js.map "),
    ).toBe("main.js");
  });
});

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

const multipartMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/MultipartFormData", () => {
  return {
    __esModule: true,
    default: multipartMiddleware,
    // Real value from the middleware — the per-request file guard uses it.
    MAX_MULTIPART_FILES: 50,
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
  return {
    __esModule: true,
    default: {
      replaceSourceMap: jest.fn(),
      getStoredBundlePathsForRelease: jest.fn(),
    },
    MAX_SOURCE_MAPS_PER_RELEASE: 100,
  };
});

import Response from "Common/Server/Utils/Response";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetrySourceMapService from "Common/Server/Services/TelemetrySourceMapService";
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
    // 100 distinct bundles already stored; this upload adds a new one.
    getStoredBundlePathsMock.mockResolvedValue(
      Array.from({ length: 100 }, (_: unknown, i: number) => {
        return `chunk-${i}.js`;
      }) as never,
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
    getStoredBundlePathsMock.mockResolvedValue(
      Array.from({ length: 100 }, (_: unknown, i: number) => {
        return i === 0 ? "main.abc123.js" : `chunk-${i}.js`;
      }) as never,
    );

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

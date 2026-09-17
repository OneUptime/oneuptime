import { describe, expect, jest, test } from "@jest/globals";

/*
 * What the source map upload route mounts for multipart parsing.
 *
 * It used to mount the SHARED middleware — the module's default export, one
 * multer instance every route that parses a multipart body shares. It now
 * mounts one built for SOURCE_MAP_MAX_FILES_PER_REQUEST, so an operator who
 * lowers that knob narrows what multer will accept on this route.
 *
 * The direction is the whole point: the parse runs BEFORE the route's auth
 * check, so the shared ceiling is the limit an unauthenticated caller is held
 * to across every route that mounts it. A per-route knob that could raise it
 * would widen that surface, so the builder clamps and the route can only
 * narrow.
 *
 * The route reads the knob once, at module load, so each case here loads the
 * module afresh inside jest.isolateModules with a different configured value.
 */

// Router-capture pattern, as in SourceMapIngestAPI.test.ts.
let registeredPostHandlers: Record<string, Array<unknown>> = {};

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

/*
 * forSurface returns the SAME sentinel the route table used to get from
 * isAuthorizedServiceMiddleware, so the mount and ordering assertions below
 * keep measuring what they always measured. Which surface each route names is
 * pinned separately, by TelemetryIngestSurfaceWiring.test.ts.
 */
jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: authMiddleware,
      forSurface: jest.fn(() => {
        return authMiddleware;
      }),
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

interface MultipartModuleShape {
  default: unknown;
  MAX_MULTIPART_FILES: number;
  getMultipartFormDataMiddleware: (options: { maxFiles: number }) => unknown;
}

/*
 * The REAL middleware module, not a hand-written stand-in.
 *
 * A local re-implementation of the clamp would make every "cannot widen"
 * assertion below a statement about this file rather than about the shipped
 * builder: it would keep passing if the real clamp were deleted, and it would
 * have to be kept in step with it by hand. Delegating means the clamp under
 * test is the one that ships, and the shared instance these tests compare
 * against by identity is the actual default export the other routes mount.
 *
 * Safe to pull in here even though this file mocks Common/Server/Utils/Express:
 * MultipartFormData uses that module for types only, so the import is erased
 * and the real multer instances it builds are never driven by this suite.
 */
const actualMultipartModule: MultipartModuleShape = jest.requireActual(
  "Common/Server/Middleware/MultipartFormData",
) as MultipartModuleShape;

/* The shared ceiling the builder clamps to, read rather than repeated. */
const MAX_MULTIPART_FILES: number = actualMultipartModule.MAX_MULTIPART_FILES;

/*
 * The module's default export — the ONE shared instance every route that
 * parses a multipart body mounts. Every assertion below about "the shared
 * middleware" is an identity check against it, which is exactly what the real
 * builder's fast path returns.
 */
const sharedMultipartMiddleware: unknown = actualMultipartModule.default;

interface MultipartMiddlewareBuild {
  maxFiles: number;
  middleware: unknown;
}

const multipartMiddlewareBuilds: Array<MultipartMiddlewareBuild> = [];

jest.mock("Common/Server/Middleware/MultipartFormData", () => {
  return {
    __esModule: true,
    default: sharedMultipartMiddleware,
    MAX_MULTIPART_FILES: MAX_MULTIPART_FILES,
    /*
     * Pass-through to the real builder, recording what the route asked for.
     * The clamp, and the fast path that returns the shared instance, are the
     * shipped ones.
     */
    getMultipartFormDataMiddleware: (options: {
      maxFiles: number;
    }): unknown => {
      const middleware: unknown =
        actualMultipartModule.getMultipartFormDataMiddleware(options);

      multipartMiddlewareBuilds.push({
        maxFiles: options.maxFiles,
        middleware: middleware,
      });

      return middleware;
    },
  };
});

let mockMaxFilesPerRequest: number = MAX_MULTIPART_FILES;

/*
 * A minimal stand-in rather than a spread of the real module: with the ingest
 * service mocked below, SOURCE_MAP_MAX_FILES_PER_REQUEST is the only export
 * anything in this graph reads.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const mocked: Record<string, unknown> = {
    __esModule: true,
  };

  Object.defineProperty(mocked, "SourceMapMaxFilesPerRequest", {
    get: (): number => {
      return mockMaxFilesPerRequest;
    },
  });

  return mocked;
});

/*
 * Mocked so loading the route does not drag in the database-backed service
 * graph. This file is about the middleware chain the route mounts; what the
 * terminal handler does with a request is SourceMapIngestAPI.test.ts's job.
 */
jest.mock("../../FeatureSet/Telemetry/Services/SourceMapIngestService", () => {
  return {
    __esModule: true,
    default: {
      uploadSourceMaps: jest.fn(),
    },
  };
});

const UPLOAD_ROUTE: string = "/source-maps/v1/upload";

type LoadRouteFunction = (maxFilesPerRequest: number) => Array<unknown>;

/*
 * Loads the route module with SOURCE_MAP_MAX_FILES_PER_REQUEST configured to
 * `maxFilesPerRequest` and returns the middleware chain it mounted.
 * isolateModules gives the require a private module registry, so the module
 * body — where the knob is read and the middleware built — runs again per case
 * instead of being served from cache.
 */
const loadRoute: LoadRouteFunction = (
  maxFilesPerRequest: number,
): Array<unknown> => {
  mockMaxFilesPerRequest = maxFilesPerRequest;
  multipartMiddlewareBuilds.length = 0;
  registeredPostHandlers = {};

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../FeatureSet/Telemetry/API/SourceMapIngest");
    /* eslint-enable @typescript-eslint/no-var-requires */
  });

  return registeredPostHandlers[UPLOAD_ROUTE]!;
};

describe("POST /source-maps/v1/upload multipart mount", () => {
  test("mounts a middleware built from SOURCE_MAP_MAX_FILES_PER_REQUEST rather than the shared default export", () => {
    const handlers: Array<unknown> = loadRoute(10);

    expect(multipartMiddlewareBuilds).toHaveLength(1);
    expect(multipartMiddlewareBuilds[0]!.maxFiles).toBe(10);
    expect(handlers[1]).toBe(multipartMiddlewareBuilds[0]!.middleware);
    expect(handlers[1]).not.toBe(sharedMultipartMiddleware);
  });

  test("a narrowed route mounts the shared default export nowhere in its chain", () => {
    const handlers: Array<unknown> = loadRoute(1);

    expect(handlers).not.toContain(sharedMultipartMiddleware);
  });

  test("at the shipped default the knob resolves to the shared instance, so no second multer is built", () => {
    /*
     * SOURCE_MAP_MAX_FILES_PER_REQUEST defaults to the shared ceiling. Going
     * through the builder still matters — it is what makes lowering the knob
     * take effect — but at the default it must not cost a duplicate multer,
     * because every instance buffers uploads in this process's memory.
     */
    const handlers: Array<unknown> = loadRoute(MAX_MULTIPART_FILES);

    expect(multipartMiddlewareBuilds).toHaveLength(1);
    expect(multipartMiddlewareBuilds[0]!.maxFiles).toBe(MAX_MULTIPART_FILES);
    /*
     * Both halves matter. The first says the mounted handler is what the
     * builder returned — without it this passes just as well for a route that
     * mounted the default export directly and never called the builder at
     * all. The second says what the builder returned at the default IS the
     * shared instance.
     */
    expect(handlers[1]).toBe(multipartMiddlewareBuilds[0]!.middleware);
    expect(handlers[1]).toBe(sharedMultipartMiddleware);
  });

  test("a knob set above the shared ceiling cannot widen this route's pre-auth parse", () => {
    /*
     * EnvironmentConfig already clamps the knob, so this is the second of two
     * clamps. It is the one that holds if the config ever stops clamping: the
     * parse runs before authentication, so widening it here would widen what an
     * unauthenticated caller can make the process buffer.
     */
    const handlers: Array<unknown> = loadRoute(MAX_MULTIPART_FILES * 100);

    /*
     * The route handed the builder the raw, over-ceiling value — it does no
     * clamping of its own — and the builder is what refused to widen. Pinning
     * both is what stops this reading as a pass for a route that quietly
     * mounted the shared export without consulting the knob at all.
     */
    expect(multipartMiddlewareBuilds).toHaveLength(1);
    expect(multipartMiddlewareBuilds[0]!.maxFiles).toBe(
      MAX_MULTIPART_FILES * 100,
    );
    expect(handlers[1]).toBe(multipartMiddlewareBuilds[0]!.middleware);
    expect(handlers[1]).toBe(sharedMultipartMiddleware);
  });

  test("builds exactly one middleware per module load", () => {
    // Each build constructs a multer instance, so the route hoists the call.
    loadRoute(10);

    expect(multipartMiddlewareBuilds).toHaveLength(1);
  });

  test("the narrowed parse still sits between the ingestion-disabled gate and the auth check", () => {
    /*
     * Order is what makes the clamp necessary in the first place: multipart
     * parsing happens before isAuthorizedServiceMiddleware, so swapping in a
     * per-route instance must not move it later (which would parse
     * unauthenticated bodies with different limits than the gate expects) or
     * earlier than the disabled gate (which would parse for a project that has
     * ingestion switched off).
     */
    const handlers: Array<unknown> = loadRoute(10);

    expect(handlers).toHaveLength(5);
    expect(handlers[0]).toBe(ingestionDisabledMiddleware);
    expect(handlers[1]).toBe(multipartMiddlewareBuilds[0]!.middleware);
    expect(handlers[3]).toBe(authMiddleware);
  });
});

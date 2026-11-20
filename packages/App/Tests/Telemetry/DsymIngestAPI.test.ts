import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * POST /dsyms/v1/upload (#9922): an iOS app's dSYMs after a build - the
 * CLI's symbol tables as JSON, or the dSYMs themselves as multipart file
 * parts - stored one row per binary, a UUID uploaded again replacing its
 * rows. The router is captured as in SourceMapIngestAPI.test.ts; the dSYM
 * readers run for real, on Mach-O files and zips built byte by byte.
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

/*
 * The surfaces the route module named, kept in a plain array: it names
 * them once, at import, and clearAllMocks would wipe a mock's call log.
 */
const namedSurfaces: Array<unknown> = [];

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      forSurface: (surface: unknown) => {
        namedSurfaces.push(surface);
        return authMiddleware;
      },
    },
  };
});

const ingestionDisabledMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: { middleware: ingestionDisabledMiddleware },
  };
});

const multipartMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/MultipartFormData", () => {
  return {
    __esModule: true,
    default: multipartMiddleware,
    getMultipartFormDataMiddleware: (): unknown => {
      return multipartMiddleware;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { sendJsonObjectResponse: jest.fn() },
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

jest.mock("Common/Server/Services/TelemetryDsymService", () => {
  return {
    __esModule: true,
    default: { replaceSymbolFile: jest.fn() },
  };
});

import Response from "Common/Server/Utils/Response";
import TelemetryDsymService from "Common/Server/Services/TelemetryDsymService";
import TelemetryDsym from "Common/Models/DatabaseModels/TelemetryDsym";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { JSONObject } from "Common/Types/JSON";
import {
  AppleSymbolFile,
  encodeAppleSymbols,
} from "Common/Utils/Telemetry/AppleSymbols";
import DsymIngestService, {
  DSYM_UPLOAD_ZIP_LIMITS,
  MAX_DSYM_FILES_PER_REQUEST,
  PINNED_KEY_DSYM_REFUSAL,
} from "../../FeatureSet/Telemetry/Services/DsymIngestService";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import {
  APP_SYMBOLS,
  APP_TEXT_END_OFFSET,
  APP_UUID,
  CPU_SUBTYPE_ARM64_ALL,
  CPU_TYPE_ARM64,
  FRAMEWORK_UUID,
  buildAppMachO,
  buildTinyMachO,
  ZipFixtureEntry,
  buildZip,
  dsymBundleEntries,
} from "Common/Tests/Server/Utils/Telemetry/AppleDebugSymbols/MachOFixtures";
import { DEFAULT_MAX_ZIP_ENTRY_BYTES } from "Common/Server/Utils/Telemetry/AppleDebugSymbols/ZipArchive";
// Importing the router module registers the route on the mocked router.
import "../../FeatureSet/Telemetry/API/DsymIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const replaceSymbolFileMock: MockedFn =
  TelemetryDsymService.replaceSymbolFile as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

const UPLOAD_ROUTE: string = "/dsyms/v1/upload";
const PROJECT_ID: ObjectID = ObjectID.generate();

interface FilePart {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

function request(data: {
  body?: JSONObject;
  files?: Array<FilePart>;
  pinnedServiceName?: string;
}): {
  req: ExpressRequest;
  res: ExpressResponse;
  next: jest.Mock;
} {
  return {
    req: {
      projectId: PROJECT_ID,
      body: data.body || {},
      files: data.files,
      headers: {},
      ...(data.pinnedServiceName
        ? { ingestionKeyPolicy: { pinnedServiceName: data.pinnedServiceName } }
        : {}),
    } as unknown as ExpressRequest,
    res: {} as ExpressResponse,
    next: jest.fn(),
  };
}

async function upload(data: {
  body?: JSONObject;
  files?: Array<FilePart>;
  pinnedServiceName?: string;
}): Promise<{ next: jest.Mock; sent: JSONObject | null }> {
  const { req, res, next } = request(data);

  await DsymIngestService.uploadDsyms(req, res, next as NextFunction);

  const call: Array<unknown> | undefined = sendJsonMock.mock.calls[0];

  return { next, sent: call ? (call[2] as JSONObject) : null };
}

function refusal(next: jest.Mock): Error {
  expect(next).toHaveBeenCalledTimes(1);

  const error: Error = next.mock.calls[0]![0] as Error;

  expect(error).toBeInstanceOf(BadDataException);

  return error;
}

// One binary as the CLI sends it.
function cliFile(overrides: Partial<JSONObject> = {}): JSONObject {
  return {
    debugId: APP_UUID.replace(/-/g, "").toLowerCase(),
    architecture: "arm64",
    binaryName: "MyApp",
    symbols: encodeAppleSymbols({
      symbols: [...APP_SYMBOLS],
      textEndOffset: APP_TEXT_END_OFFSET,
    }),
    ...overrides,
  };
}

function storedFiles(): Array<AppleSymbolFile> {
  return replaceSymbolFileMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { file: AppleSymbolFile }).file;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  replaceSymbolFileMock.mockImplementation(
    async (data: { file: AppleSymbolFile }) => {
      const dsym: TelemetryDsym = new TelemetryDsym();
      dsym._id = ObjectID.generate().toString();
      dsym.symbolCount = data.file.symbols.length;
      return dsym;
    },
  );
});

describe("the route", () => {
  test("checks the key as a dSYM upload, which no browser key may make, after the multipart parse and the Bearer mapping", () => {
    const handlers: Array<unknown> = registeredPostHandlers[UPLOAD_ROUTE]!;

    expect(handlers).toHaveLength(5);
    expect(handlers[0]).toBe(ingestionDisabledMiddleware);
    expect(handlers[1]).toBe(multipartMiddleware);
    expect(handlers[3]).toBe(authMiddleware);
    expect(namedSurfaces).toEqual([TelemetryIngestSurface.Dsym]);
  });

  test("takes the key from Authorization: Bearer, for CI tools that speak only that", () => {
    const mapBearer: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => void = registeredPostHandlers[UPLOAD_ROUTE]![2] as never;
    const req: ExpressRequest = {
      headers: { authorization: "Bearer key-1" },
    } as unknown as ExpressRequest;
    const next: jest.Mock = jest.fn();

    mapBearer(req, {} as ExpressResponse, next as NextFunction);

    expect(req.headers["x-oneuptime-token"]).toBe("key-1");
    expect(next).toHaveBeenCalled();
  });
});

describe("the key it is sent with", () => {
  test("a key pinned to one service - the kind an app ships with - is refused, and nothing is stored", async () => {
    const { next, sent } = await upload({
      body: { symbolFiles: [cliFile()] },
      pinnedServiceName: "storefront-ios",
    });

    expect(next).toHaveBeenCalledTimes(1);

    const error: Error = next.mock.calls[0]![0] as Error;

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(PINNED_KEY_DSYM_REFUSAL);
    expect(replaceSymbolFileMock).not.toHaveBeenCalled();
    expect(sent).toBe(null);
  });
});

describe("what the CLI sends", () => {
  test("each binary is stored by its UUID, and the answer lists them", async () => {
    const { next, sent } = await upload({
      body: { appName: " storefront-ios ", symbolFiles: [cliFile()] },
    });

    expect(next).not.toHaveBeenCalled();
    expect(storedFiles()).toHaveLength(1);
    expect(storedFiles()[0]).toMatchObject({
      debugId: APP_UUID,
      architecture: "arm64",
      binaryName: "MyApp",
      textEndOffset: APP_TEXT_END_OFFSET,
    });
    expect(storedFiles()[0]!.symbols).toHaveLength(APP_SYMBOLS.length);
    expect(replaceSymbolFileMock.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      appName: "storefront-ios",
    });
    expect(sent).toMatchObject({
      appName: "storefront-ios",
      dsyms: [
        {
          debugId: APP_UUID,
          architecture: "arm64",
          binaryName: "MyApp",
          symbolCount: APP_SYMBOLS.length,
        },
      ],
    });
  });

  test("a UUID given twice is stored once, as it was given last", async () => {
    await upload({
      body: {
        symbolFiles: [
          cliFile({ binaryName: "Old" }),
          cliFile({ debugId: APP_UUID, binaryName: "MyApp" }),
        ],
      },
    });

    expect(
      storedFiles().map((file: AppleSymbolFile) => {
        return file.binaryName;
      }),
    ).toEqual(["MyApp"]);
  });

  test("nothing is stored when any binary is wrong: no UUID, no name, or a table the CLI never writes", async () => {
    for (const [file, message] of [
      [cliFile({ debugId: "nope" }), "Symbol file 2 has no binary UUID"],
      [
        cliFile({ binaryName: "" }),
        "Symbol file 2 needs its binaryName and architecture.",
      ],
      [
        cliFile({ symbols: "1 main" }),
        "are not a table the OneUptime CLI writes",
      ],
    ] as Array<[JSONObject, string]>) {
      jest.clearAllMocks();

      const { next } = await upload({
        body: { symbolFiles: [cliFile(), file] },
      });

      expect(refusal(next).message).toContain(message);
      expect(replaceSymbolFileMock).not.toHaveBeenCalled();
    }
  });

  test("an empty upload is refused with what to send", async () => {
    const { next } = await upload({ body: {} });

    expect(refusal(next).message).toBe(
      "Send symbolFiles, as the OneUptime CLI reads them from your dSYMs, or the dSYMs themselves as multipart file parts.",
    );
  });

  test("at most so many binaries a request", async () => {
    const { next } = await upload({
      body: {
        symbolFiles: Array.from(
          { length: MAX_DSYM_FILES_PER_REQUEST + 1 },
          () => {
            return cliFile();
          },
        ),
      },
    });

    expect(refusal(next).message).toBe(
      `At most ${MAX_DSYM_FILES_PER_REQUEST} symbol files can be uploaded in one request.`,
    );
  });
});

describe("dSYMs sent as they are", () => {
  test("a dSYM's DWARF file", async () => {
    const { next, sent } = await upload({
      files: [
        {
          fieldname: "dsym",
          originalname: "MyApp",
          buffer: buildAppMachO({ uuid: APP_UUID }),
        },
      ],
    });

    expect(next).not.toHaveBeenCalled();
    expect(storedFiles()).toEqual([
      {
        debugId: APP_UUID,
        architecture: "arm64",
        binaryName: "MyApp",
        symbols: [...APP_SYMBOLS],
        textEndOffset: APP_TEXT_END_OFFSET,
      },
    ]);
    expect((sent!["dsyms"] as Array<JSONObject>)[0]!["debugId"]).toBe(APP_UUID);
  });

  test("a zip of .dSYM bundles, as App Store Connect gives them: every binary in it", async () => {
    const archive: Buffer = buildZip([
      ...dsymBundleEntries({
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: buildAppMachO({ uuid: APP_UUID }),
      }),
      ...dsymBundleEntries({
        bundle: "CartKit.framework.dSYM",
        binary: "CartKit",
        dwarf: buildAppMachO({ uuid: FRAMEWORK_UUID }),
      }),
    ]);

    const { next } = await upload({
      files: [
        { fieldname: "dsym", originalname: "dSYMs.zip", buffer: archive },
      ],
    });

    expect(next).not.toHaveBeenCalled();
    expect(
      storedFiles()
        .map((file: AppleSymbolFile) => {
          return `${file.binaryName} ${file.debugId}`;
        })
        .sort(),
    ).toEqual([`CartKit ${FRAMEWORK_UUID}`, `MyApp ${APP_UUID}`]);
  });

  test("a file that is no dSYM is refused, and nothing is stored", async () => {
    const { next } = await upload({
      files: [
        {
          fieldname: "dsym",
          originalname: "MyApp",
          buffer: buildAppMachO({ uuid: APP_UUID }),
        },
        {
          fieldname: "dsym",
          originalname: "notes.txt",
          buffer: Buffer.from("not a dSYM"),
        },
      ],
    });

    expect(refusal(next).message).toBe(
      "notes.txt is neither a dSYM's DWARF file nor a zip of dSYMs.",
    );
    expect(replaceSymbolFileMock).not.toHaveBeenCalled();
  });

  test("a zip that says it inflates past what an upload may is refused before it is read into memory", async () => {
    const entries: Array<ZipFixtureEntry> = dsymBundleEntries({
      bundle: "MyApp.app.dSYM",
      binary: "MyApp",
      dwarf: buildAppMachO({ uuid: APP_UUID }),
    });
    const dwarf: ZipFixtureEntry = entries[entries.length - 1]!;

    dwarf.declaredUncompressedSize = DSYM_UPLOAD_ZIP_LIMITS.maxEntryBytes! + 1;

    const { next } = await upload({
      files: [
        {
          fieldname: "dsym",
          originalname: "dSYMs.zip",
          buffer: buildZip(entries),
        },
      ],
    });

    expect(refusal(next).message).toContain(
      `more than the ${DSYM_UPLOAD_ZIP_LIMITS.maxEntryBytes} OneUptime reads from one zip entry`,
    );
    expect(replaceSymbolFileMock).not.toHaveBeenCalled();
    // The CLI reads a team's own files: it is held to far more.
    expect(DSYM_UPLOAD_ZIP_LIMITS.maxEntryBytes).toBeLessThan(
      DEFAULT_MAX_ZIP_ENTRY_BYTES,
    );
  });

  test("an empty part is refused", async () => {
    const { next } = await upload({
      files: [
        { fieldname: "dsym", originalname: "MyApp", buffer: Buffer.alloc(0) },
      ],
    });

    expect(refusal(next).message).toBe("MyApp is empty.");
  });

  test("a stripped binary is left out beside the others, and refused alone", async () => {
    const stripped: Buffer = buildTinyMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
      uuid: FRAMEWORK_UUID,
    });

    // A stripped binary: what the readers make of one with no symbols.
    const strippedFile: AppleSymbolFile = {
      debugId: FRAMEWORK_UUID,
      architecture: "arm64",
      binaryName: "CartKit",
      symbols: [],
      textEndOffset: 0x1100,
    };

    expect(
      DsymIngestService.normalizeSymbolFiles([
        {
          debugId: APP_UUID,
          architecture: "arm64",
          binaryName: "MyApp",
          symbols: [...APP_SYMBOLS],
          textEndOffset: APP_TEXT_END_OFFSET,
        },
        strippedFile,
      ]).map((file: AppleSymbolFile) => {
        return file.binaryName;
      }),
    ).toEqual(["MyApp"]);

    expect(() => {
      return DsymIngestService.normalizeSymbolFiles([strippedFile]);
    }).toThrow(
      `There are no function symbols in CartKit (${FRAMEWORK_UUID}): a binary stripped before its dSYM is made leaves none.`,
    );

    // A tiny binary with its one function still reads, and is kept.
    expect(
      DsymIngestService.readSymbolFilesFromParts([
        { fieldname: "dsym", originalname: "Tiny", buffer: stripped },
      ])[0]!.symbols,
    ).toEqual([{ offset: 0x1000, name: "main" }]);
  });
});

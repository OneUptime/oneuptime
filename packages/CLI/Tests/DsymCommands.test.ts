import { Command } from "commander";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  AppleSymbolFile,
  decodeAppleSymbols,
} from "Common/Utils/Telemetry/AppleSymbols";
import {
  APP_SYMBOLS,
  APP_TEXT_END_OFFSET,
  APP_UUID,
  CPU_SUBTYPE_ARM64_ALL,
  CPU_TYPE_ARM64,
  FRAMEWORK_UUID,
  buildAppMachO,
  buildMachO,
  buildZip,
  dsymBundleEntries,
} from "Common/Tests/Server/Utils/Telemetry/AppleDebugSymbols/MachOFixtures";
import {
  DSYM_UPLOAD_PATH,
  DsymUploadFile,
  buildDsymUploads,
  describeDsymUpload,
  readDsymFiles,
} from "../Commands/DsymCommands";
import { buildProgram } from "../Program";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * oneuptime dsym upload (#9922) reads an iOS app's dSYMs on the machine
 * that built it - bundles, folders and zips of them, or DWARF files - and
 * sends only each binary's UUID, architecture and function symbols, with a
 * telemetry ingestion key, in requests that fit the upload's body cap.
 */

const CONFIG_FILE: string = path.join(
  os.homedir(),
  ".oneuptime",
  "config.json",
);
const URL_ENV: string = "ONEUPTIME_URL";
const KEY_ENV: string = "ONEUPTIME_TELEMETRY_INGESTION_KEY";

// A binary with a UUID and code, but no symbols: stripped before its dSYM.
function strippedMachO(uuid: string): Buffer {
  return buildMachO({
    cpuType: CPU_TYPE_ARM64,
    cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
    uuid,
    segments: [
      {
        name: "__TEXT",
        address: 0x100000000,
        size: 0x2000,
        sections: [],
      },
    ],
    symbols: [],
  });
}

// A .dSYM bundle on disk, as Xcode writes one.
function writeBundle(
  directory: string,
  bundle: string,
  binary: string,
  dwarf: Buffer,
): string {
  const dwarfDirectory: string = path.join(
    directory,
    bundle,
    "Contents",
    "Resources",
    "DWARF",
  );

  fs.mkdirSync(dwarfDirectory, { recursive: true });
  fs.writeFileSync(path.join(dwarfDirectory, binary), dwarf);

  return path.join(directory, bundle);
}

function symbolFile(
  name: string,
  uuid: string,
  count: number,
): AppleSymbolFile {
  return {
    debugId: uuid,
    architecture: "arm64",
    binaryName: name,
    symbols: Array.from({ length: count }, (_: unknown, index: number) => {
      return { offset: 0x4000 + index * 16, name: `function_${index}` };
    }),
    textEndOffset: 0x4000 + count * 16,
  };
}

describe("what is read of the dSYMs", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsym-upload-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("a .dSYM bundle: its binary's UUID, architecture and functions", () => {
    const bundle: string = writeBundle(
      directory,
      "MyApp.app.dSYM",
      "MyApp",
      buildAppMachO({ uuid: APP_UUID }),
    );

    expect(readDsymFiles([bundle])).toEqual({
      files: [
        {
          debugId: APP_UUID,
          architecture: "arm64",
          binaryName: "MyApp",
          symbols: [...APP_SYMBOLS],
          textEndOffset: APP_TEXT_END_OFFSET,
        },
      ],
      withoutSymbols: [],
    });
  });

  test("an archive's dSYMs folder, and a zip of them, read every binary in them once", () => {
    writeBundle(
      directory,
      "MyApp.app.dSYM",
      "MyApp",
      buildAppMachO({ uuid: APP_UUID }),
    );
    writeBundle(
      directory,
      "CartKit.framework.dSYM",
      "CartKit",
      buildAppMachO({ uuid: FRAMEWORK_UUID }),
    );

    const archive: string = path.join(directory, "dSYMs.zip");
    fs.writeFileSync(
      archive,
      buildZip(
        dsymBundleEntries({
          bundle: "MyApp.app.dSYM",
          binary: "MyApp",
          dwarf: buildAppMachO({ uuid: APP_UUID }),
        }),
      ),
    );

    const read: Array<string> = readDsymFiles([directory, archive])
      .files.map((file: AppleSymbolFile) => {
        return `${file.binaryName} ${file.debugId}`;
      })
      .sort();

    expect(read).toEqual([`CartKit ${FRAMEWORK_UUID}`, `MyApp ${APP_UUID}`]);
  });

  test("a stripped binary is set aside to be warned of, and alone is nothing to upload", () => {
    const app: string = writeBundle(
      directory,
      "MyApp.app.dSYM",
      "MyApp",
      buildAppMachO({ uuid: APP_UUID }),
    );
    const stripped: string = writeBundle(
      directory,
      "CartKit.framework.dSYM",
      "CartKit",
      strippedMachO(FRAMEWORK_UUID),
    );

    const read: {
      files: Array<AppleSymbolFile>;
      withoutSymbols: Array<AppleSymbolFile>;
    } = readDsymFiles([app, stripped]);

    expect(
      read.files.map((file: AppleSymbolFile) => {
        return file.binaryName;
      }),
    ).toEqual(["MyApp"]);
    expect(
      read.withoutSymbols.map((file: AppleSymbolFile) => {
        return file.binaryName;
      }),
    ).toEqual(["CartKit"]);

    expect(() => {
      return readDsymFiles([stripped]);
    }).toThrow(
      `There are no function symbols in CartKit (arm64, ${FRAMEWORK_UUID}): a binary stripped before its dSYM is made leaves none.`,
    );
  });

  test("no path, a missing one, or one with no dSYM in it is an error", () => {
    expect(() => {
      return readDsymFiles([]);
    }).toThrow("Name the dSYMs to upload");

    const missing: string = path.join(directory, "Missing.dSYM");

    expect(() => {
      return readDsymFiles([missing]);
    }).toThrow(`${missing} does not exist.`);

    fs.mkdirSync(path.join(directory, "empty"));

    expect(() => {
      return readDsymFiles([path.join(directory, "empty")]);
    }).toThrow("There is no dSYM in");
  });
});

describe("the requests they are sent in", () => {
  test("each binary's symbols as OneUptime keeps them", () => {
    const uploads: Array<Array<DsymUploadFile>> = buildDsymUploads([
      symbolFile("MyApp", APP_UUID, 3),
    ]);

    expect(uploads).toHaveLength(1);
    expect(uploads[0]![0]).toMatchObject({
      debugId: APP_UUID,
      architecture: "arm64",
      binaryName: "MyApp",
    });
    expect(decodeAppleSymbols(uploads[0]![0]!.symbols)!.names).toEqual([
      "function_0",
      "function_1",
      "function_2",
    ]);
  });

  test("as many binaries a request as fit, and one larger than that alone", () => {
    const files: Array<AppleSymbolFile> = [
      symbolFile("A", APP_UUID, 10),
      symbolFile("B", FRAMEWORK_UUID, 10),
      symbolFile("C", "11111111-2222-3333-4444-555555555555", 400),
      symbolFile("D", "66666666-7777-8888-9999-AAAAAAAAAAAA", 10),
    ];

    const uploads: Array<Array<DsymUploadFile>> = buildDsymUploads(files, {
      maxBytes: 2000,
      maxFiles: 100,
    });

    expect(
      uploads.map((upload: Array<DsymUploadFile>) => {
        return upload.map((file: DsymUploadFile) => {
          return file.binaryName;
        });
      }),
    ).toEqual([["A", "B"], ["C"], ["D"]]);

    expect(
      buildDsymUploads(files, { maxBytes: 10_000_000, maxFiles: 3 }).map(
        (upload: Array<DsymUploadFile>) => {
          return upload.length;
        },
      ),
    ).toEqual([3, 1]);
  });

  test("what OneUptime stored, in one line", () => {
    expect(
      describeDsymUpload([
        { binaryName: "MyApp", architecture: "arm64", debugId: APP_UUID },
        {
          binaryName: "CartKit",
          architecture: "arm64",
          debugId: FRAMEWORK_UUID,
        },
      ]),
    ).toBe(
      `Uploaded 2 dSYMs: MyApp (arm64, ${APP_UUID}), CartKit (arm64, ${FRAMEWORK_UUID}).`,
    );
    expect(
      describeDsymUpload([
        { binaryName: "MyApp", architecture: "arm64", debugId: APP_UUID },
      ]),
    ).toBe(`Uploaded 1 dSYM: MyApp (arm64, ${APP_UUID}).`);
    expect(describeDsymUpload([])).toBe("Uploaded no dSYM.");
  });
});

describe("oneuptime dsym upload", () => {
  let directory: string;
  let post: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }

    delete process.env[URL_ENV];
    delete process.env[KEY_ENV];
    process.env["NO_COLOR"] = "1";
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsym-upload-"));
    post = jest.spyOn(API, "post").mockImplementation((async (request: {
      data: JSONObject;
    }) => {
      const files: Array<JSONObject> = request.data[
        "symbolFiles"
      ] as Array<JSONObject>;

      return new HTTPResponse<JSONObject>(
        200,
        {
          dsyms: files.map((file: JSONObject) => {
            return {
              debugId: file["debugId"],
              architecture: file["architecture"],
              binaryName: file["binaryName"],
            };
          }),
        },
        {},
      );
    }) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env[URL_ENV];
    delete process.env[KEY_ENV];
    delete process.env["NO_COLOR"];
  });

  async function upload(args: Array<string>): Promise<void> {
    const program: Command = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "oneuptime", "dsym", "upload", ...args]);
  }

  test("sends each binary's symbols with the ingestion key, and says what was stored", async () => {
    const bundle: string = writeBundle(
      directory,
      "MyApp.app.dSYM",
      "MyApp",
      buildAppMachO({ uuid: APP_UUID }),
    );

    await upload([
      bundle,
      "--app",
      "storefront-ios",
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "key-1",
    ]);

    const request: JSONObject = post.mock.calls[0][0] as JSONObject;

    expect(String(request["url"])).toBe(
      `https://oneuptime.example.com${DSYM_UPLOAD_PATH}`,
    );
    expect((request["headers"] as JSONObject)["x-oneuptime-token"]).toBe(
      "key-1",
    );
    expect(request["options"]).toEqual({ sameServerRedirectsOnly: true });
    expect((request["data"] as JSONObject)["appName"]).toBe("storefront-ios");
    expect(
      ((request["data"] as JSONObject)["symbolFiles"] as Array<JSONObject>)[0],
    ).toMatchObject({ debugId: APP_UUID, binaryName: "MyApp" });
    expect(logSpy).toHaveBeenCalledWith(
      `Uploaded 1 dSYM: MyApp (arm64, ${APP_UUID}).`,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("warns of a stripped binary it leaves out, on standard error", async () => {
    const app: string = writeBundle(
      directory,
      "MyApp.app.dSYM",
      "MyApp",
      buildAppMachO({ uuid: APP_UUID }),
    );
    const stripped: string = writeBundle(
      directory,
      "CartKit.framework.dSYM",
      "CartKit",
      strippedMachO(FRAMEWORK_UUID),
    );

    await upload([
      app,
      stripped,
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "key-1",
    ]);

    expect(errorSpy.mock.calls.flat().join(" ")).toContain(
      `Left out CartKit (arm64, ${FRAMEWORK_UUID}), with no function symbols`,
    );
    expect(logSpy).toHaveBeenCalledWith(
      `Uploaded 1 dSYM: MyApp (arm64, ${APP_UUID}).`,
    );
  });

  test("with no ingestion key, says where to make one and sends nothing", async () => {
    const bundle: string = writeBundle(
      directory,
      "MyApp.app.dSYM",
      "MyApp",
      buildAppMachO({ uuid: APP_UUID }),
    );

    await upload([bundle, "--url", "https://oneuptime.example.com"]);

    expect(post).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).toContain(
      "No telemetry ingestion key found.",
    );
    expect(exitSpy).toHaveBeenCalled();
  });
});

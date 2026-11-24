import TelemetryDsymService, {
  DSYM_RETENTION_DAYS,
  MAX_DSYM_SYMBOLS_SIZE_IN_BYTES,
} from "../../../Server/Services/TelemetryDsymService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import TelemetryDsym from "../../../Models/DatabaseModels/TelemetryDsym";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  APPLE_SYMBOLS_HEADER,
  AppleSymbolFile,
  AppleSymbolTable,
  encodeAppleSymbols,
} from "../../../Utils/Telemetry/AppleSymbols";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * #9922: one row per build of an iOS app's binary, its function symbols as
 * OneUptime keeps them. What is pinned here: what an upload must say for a
 * row to be kept, that a UUID uploaded again replaces its rows, and that
 * ingest reads the newest table of each UUID a crash names.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const APP_UUID: string = "70B89F27-1634-3580-A695-57CDB41D7743";
const FRAMEWORK_UUID: string = "5A5A5A5A-0000-1111-2222-333344445555";

const SYMBOLS: string = encodeAppleSymbols({
  symbols: [
    { offset: 20000, name: "main" },
    { offset: 229064, name: "$s5MyApp18CartViewControllerC8checkoutyyF" },
  ],
  textEndOffset: 400000,
});

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeCreateBy(
  overrides: Partial<TelemetryDsym> = {},
): CreateBy<TelemetryDsym> {
  const dsym: TelemetryDsym = new TelemetryDsym();
  dsym.projectId = PROJECT_ID;
  dsym.debugId = "70b89f2716343580a69557cdb41d7743";
  dsym.binaryName = "  MyApp  ";
  dsym.architecture = "arm64";
  dsym.symbols = SYMBOLS;

  Object.assign(dsym, overrides);

  return { data: dsym, props: { isRoot: true } } as CreateBy<TelemetryDsym>;
}

async function onBeforeCreate(
  createBy: CreateBy<TelemetryDsym>,
): Promise<CreateBy<TelemetryDsym>> {
  await (
    TelemetryDsymService as unknown as {
      onBeforeCreate: (createBy: CreateBy<TelemetryDsym>) => Promise<unknown>;
    }
  ).onBeforeCreate(createBy);

  return createBy;
}

async function rejection(createBy: CreateBy<TelemetryDsym>): Promise<Error> {
  try {
    await onBeforeCreate(createBy);
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected onBeforeCreate to reject, but it resolved.");
}

describe("what an uploaded dSYM must say", () => {
  test("its UUID, in the form crashes are matched by, and what it weighs", async () => {
    const created: CreateBy<TelemetryDsym> =
      await onBeforeCreate(makeCreateBy());

    expect(created.data.debugId).toBe(APP_UUID);
    expect(created.data.binaryName).toBe("MyApp");
    expect(created.data.symbolCount).toBe(2);
    expect(created.data.sizeInBytes).toBe(Buffer.byteLength(SYMBOLS, "utf8"));
  });

  test("is refused without a UUID, symbols as OneUptime keeps them, a binary or an architecture", async () => {
    for (const [overrides, message] of [
      [{ debugId: "not-a-uuid" }, "The binary's UUID is required"],
      [{ symbols: "" }, "The dSYM's symbols are required."],
      [{ symbols: "1 main" }, "not in the form OneUptime keeps them"],
      [{ binaryName: "   " }, "The binary's name is required."],
      [{ architecture: "" }, "The binary's architecture is required."],
    ] as Array<[Partial<TelemetryDsym>, string]>) {
      const error: Error = await rejection(makeCreateBy(overrides));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toContain(message);
    }
  });

  test("is refused past the most a build's symbols may weigh", async () => {
    const tooLarge: string = `${APPLE_SYMBOLS_HEADER}\n0\n${"1 x\n".repeat(
      Math.ceil(MAX_DSYM_SYMBOLS_SIZE_IN_BYTES / 4) + 1,
    )}`;

    const error: Error = await rejection(makeCreateBy({ symbols: tooLarge }));

    expect(error.message).toBe(
      "The dSYM's symbols are too large: at most 64\u00A0MB are kept per binary.",
    );
  });

  test("is kept for over a year: a release stays on phones, and crashes, for months", () => {
    expect(DSYM_RETENTION_DAYS).toBeGreaterThanOrEqual(365);
  });
});

describe("a UUID uploaded again", () => {
  test("replaces what was uploaded for it, in the project it was sent to", async () => {
    const hardDeleteBy: jest.SpiedFunction<
      typeof TelemetryDsymService.hardDeleteBy
    > = jest
      .spyOn(TelemetryDsymService, "hardDeleteBy")
      .mockResolvedValue(undefined as never);
    const create: jest.SpiedFunction<typeof TelemetryDsymService.create> = jest
      .spyOn(TelemetryDsymService, "create")
      .mockImplementation(async (createBy: CreateBy<TelemetryDsym>) => {
        return createBy.data;
      });

    const file: AppleSymbolFile = {
      debugId: "70b89f2716343580a69557cdb41d7743",
      architecture: "arm64",
      binaryName: "MyApp",
      symbols: [
        { offset: 229064, name: "$s5MyApp18CartViewControllerC8checkoutyyF" },
        { offset: 20000, name: "main" },
      ],
      textEndOffset: 400000,
    };

    const stored: TelemetryDsym = await TelemetryDsymService.replaceSymbolFile({
      projectId: PROJECT_ID,
      file,
      appName: "storefront-ios",
    });

    expect(hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(hardDeleteBy.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      debugId: APP_UUID,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(stored.debugId).toBe(APP_UUID);
    expect(stored.appName).toBe("storefront-ios");
    expect(stored.symbols).toBe(SYMBOLS);
  });

  test("a binary with no UUID is refused before anything is deleted", async () => {
    const hardDeleteBy: jest.SpiedFunction<
      typeof TelemetryDsymService.hardDeleteBy
    > = jest
      .spyOn(TelemetryDsymService, "hardDeleteBy")
      .mockResolvedValue(undefined as never);

    await expect(
      TelemetryDsymService.replaceSymbolFile({
        projectId: PROJECT_ID,
        file: {
          debugId: "",
          architecture: "arm64",
          binaryName: "MyApp",
          symbols: [{ offset: 1, name: "main" }],
          textEndOffset: 10,
        },
      }),
    ).rejects.toThrow("MyApp has no UUID to match its crashes by.");
    expect(hardDeleteBy).not.toHaveBeenCalled();
  });
});

describe("the tables ingest reads", () => {
  function row(debugId: string, symbols: string): TelemetryDsym {
    const dsym: TelemetryDsym = new TelemetryDsym();
    dsym.debugId = debugId;
    dsym.symbols = symbols;
    return dsym;
  }

  test("one read for the UUIDs a crash names, each in one form, the newest row of each kept", async () => {
    const older: string = encodeAppleSymbols({
      symbols: [{ offset: 20000, name: "older build of main" }],
      textEndOffset: 400000,
    });
    const findBy: jest.SpiedFunction<typeof TelemetryDsymService.findBy> = jest
      .spyOn(TelemetryDsymService, "findBy")
      .mockResolvedValue([
        row(APP_UUID, SYMBOLS),
        row(APP_UUID, older),
        row(FRAMEWORK_UUID, "not a table"),
      ]);

    const tables: Map<string, AppleSymbolTable> =
      await TelemetryDsymService.getSymbolTables({
        projectId: PROJECT_ID,
        debugIds: [
          "70b89f2716343580a69557cdb41d7743",
          APP_UUID,
          FRAMEWORK_UUID,
          "not a uuid",
        ],
      });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0].query.projectId).toEqual(PROJECT_ID);
    expect(findBy.mock.calls[0]![0].sort).toEqual({
      createdAt: SortOrder.Descending,
    });
    expect([...tables.keys()]).toEqual([APP_UUID]);
    expect(tables.get(APP_UUID)!.names).toEqual([
      "main",
      "$s5MyApp18CartViewControllerC8checkoutyyF",
    ]);
  });

  test("no UUID, no read", async () => {
    const findBy: jest.SpiedFunction<typeof TelemetryDsymService.findBy> =
      jest.spyOn(TelemetryDsymService, "findBy");

    expect(
      (
        await TelemetryDsymService.getSymbolTables({
          projectId: PROJECT_ID,
          debugIds: ["", "nope"],
        })
      ).size,
    ).toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });
});
